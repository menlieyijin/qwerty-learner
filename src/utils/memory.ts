import type { Word } from '@/typings'
import type { IMemoryRecord } from './db/record'
import { db } from './db'
import { idDictionaryMap } from '@/resources/dictionary'
import { LEARNING_PATH, loadDictWords, loadLevelWords } from './learningPath'
import { clearMemoryCache, getMemoryCache, setMemoryCache } from './memoryCache'
import { legacyMemoryKey, memoryKey, normalizeWordKeyWord, normalizeWordName } from './memoryKey'
import {
  applyPendingResumeLapses,
  computeLevelProgress,
  getLevelIndex,
  getLevelName,
  getMixRatio,
  getNewRatio,
  getPersistedLevelId,
  getRefreshChance,
  getSuspendedKeys,
  loadAutoLevelState,
  migrateAutoLevelStateKeys,
  resolveCurrentLevel,
} from './autoLevel'
import type { LevelProgress } from './autoLevel'
import { takeRequeueWord } from './sessionRequeue'
import { computeDue, correctClockRollback, effectiveDueOf, migrateStage } from './srsRules'

export { memoryKey, normalizeWordName }

export const MEMORY_MIGRATED_KEY = 'memoryMigratedV1'
/** v9.3.1（SRS-002）：时钟回拨/未来 due 的一次性校准标记（记录最近一次校准时间，仅用于避免重复扫描） */
export const MEMORY_FUTURE_DUE_FIXED_KEY = 'memoryFutureDueFixedV1'
/** v9.5（DATA-003）：记忆记录 key 大小写拆分迁移的一次性标记 */
export const MEMORY_KEY_CASE_MIGRATED_KEY = 'memoryKeyCaseV2'
/**
 * v9.6（Batch3 / DATA-003 收尾）：autoLevel 状态旧 key（trim+lower）迁移的一次性标记。
 * 与 `memoryKeyCaseV2` **独立**——v9.5 老用户已有记录迁移标记，不能因为该标记短路而漏掉状态迁移。
 */
export const AUTO_LEVEL_STATE_KEYS_MIGRATED_KEY = 'autoLevelStateKeysV1'

export type LearningMode = 'auto' | 'manual' | 'custom'

export type LevelInfo = {
  id: string
  name: string
  index: number
  unseen: number
  total: number
  done: boolean
  /** v9.3：自动进阶观测字段 */
  seen?: number
  mastered?: number
  suspended?: number
}

export type PickResult = {
  word: Word
  dict: string
  level: LevelInfo | null
  refresh: boolean
  /** v8：retry=会话内错词重练，review=随机回顾 */
  hint?: 'retry' | 'review'
  /**
   * v9.10：true = 本级掌握度达 70% 后掺入的 **下一级** 词（只展示/记录，不推进 levelId）。
   * 调用方据此维护会话窗口（见 autoLevel.MIX_WINDOW_CAP），不需要区分时可忽略。
   */
  preview?: boolean
}

/** 读取旧版官方练习记录，迁移为记忆曲线记录（只执行一次；不修改旧记录） */
let migratePromise: Promise<void> | null = null
export function ensureMemoryMigrated(): Promise<void> {
  if (!migratePromise) {
    // v9.3.1：迁移后再跑一次性校准：
    //  - SRS-002「时钟回拨/未来 due」保守校准
    //  - SRS-005「外部恢复待攻克」对账（enhance.js 直接清空 suspended + reload，不会调用 resumeWord）
    // v9.5：wordRecords→memoryRecords 迁移之后，再做 key 大小写拆分迁移（DATA-003）
    migratePromise = migrateMemoryRecords()
      .then(() => migrateMemoryKeyCase())
      .then(() => ensureFutureDueCorrected())
      .then(() => applyPendingResumeLapses())
      .then(() => undefined)
  }
  return migratePromise
}

// ---------------------------------------------------------------------------
// v9.5（数据修复 DATA-003）：memoryRecords key 大小写拆分迁移
// ---------------------------------------------------------------------------

/**
 * v9.6（Batch3 / DATA-003 收尾）：根据记忆记录构建 autoLevel 状态「旧 key → 新 key」映射。
 *
 * v9.4 及之前的 autoLevel 状态键（`qzAutoLevelState.skipped` / `suspended`）是 trim+lower 的
 * memoryKey；v9.5 起新 key 保留大小写。记录里的 `word` 保留了词的原始大小写，是解析旧键归属的
 * 唯一可靠依据（只有「含大写 / 内部空白」的词新旧 key 才不同）：
 * - 只收集 `legacyMemoryKey !== memoryKey` 的词（小写词的旧键即新键，无需改名，也保证幂等）；
 * - 「旧键已被某个词的规范记录占用」（存在 `rec.key === memoryKey(rec.dict, rec.word)` 的记录）时
 *   **保守跳过改名**：这种键在 v9.5 之后可能正是某个小写词的新 key（recordSkip 写的就是新 key），
 *   改名会把该词的 Skip 计数/挂起状态抢给大小写变体；
 * - 同一旧键对应多个新 key（同词库同时存在 March / MARCH 这类极端变体）时取**字典序最小**者，
 *   保证结果与记录遍历顺序无关、可复现，并 console.warn 提示歧义。
 *
 * 已知边界：只被 Skip 过、从未产生记忆记录的词没有 `word` 字段可依据，其旧键无法判定大小写归属
 * （这类键在 v9.5 的新 key 体系下本来也匹配不到，迁移后维持原样，不会更差）。
 */
function buildAutoLevelKeyRenameMap(rows: IMemoryRecord[]): Map<string, string> {
  const canonicalKeys = new Set<string>()
  for (const rec of rows) {
    if (!rec || !rec.dict || !rec.word || !rec.key) continue
    if (rec.key === memoryKey(rec.dict, rec.word)) canonicalKeys.add(rec.key)
  }
  const renameMap = new Map<string, string>()
  for (const rec of rows) {
    if (!rec || !rec.dict || !rec.word) continue
    const legacy = legacyMemoryKey(rec.dict, rec.word)
    const next = memoryKey(rec.dict, rec.word)
    if (legacy === next) continue
    if (canonicalKeys.has(legacy)) continue
    const prev = renameMap.get(legacy)
    if (prev === undefined) {
      renameMap.set(legacy, next)
    } else if (prev !== next) {
      const chosen = next < prev ? next : prev
      renameMap.set(legacy, chosen)
      console.warn(`[memory] autoLevel 旧 key 迁移存在歧义：${legacy} → ${prev} / ${next}，取字典序最小者 ${chosen}`)
    }
  }
  return renameMap
}

/**
 * v9.6（Batch3）：执行一次 autoLevel 状态旧 key 迁移（自带独立标记 `autoLevelStateKeysV1`）。
 * 成功才写标记；失败只 console.warn，返回 false 让调用方保留重试机会（下次启动重跑）。
 *
 * @param rows 已读取的记忆记录（复用外层迁移的 toArray 结果，避免重复全表扫描）；缺省时自行读取
 * @returns true=已迁移或无需迁移；false=失败
 */
async function migrateAutoLevelStateKeysOnce(rows?: IMemoryRecord[]): Promise<boolean> {
  try {
    if (localStorage.getItem(AUTO_LEVEL_STATE_KEYS_MIGRATED_KEY)) return true
    const records = rows || (await db.memoryRecords.toArray())
    const renameMap = buildAutoLevelKeyRenameMap(records)
    const result = migrateAutoLevelStateKeys(renameMap)
    if (!result.persisted) {
      console.warn('[memory] autoLevel 旧 key 迁移未能写入 localStorage（下次启动重试）')
      return false
    }
    if (result.changed) {
      console.info(
        `[memory] autoLevel 旧 key 迁移：skipped ${result.skippedMoved} / suspended ${result.suspendedMoved} / snapshot ${result.snapshotMoved}`,
      )
    }
    localStorage.setItem(AUTO_LEVEL_STATE_KEYS_MIGRATED_KEY, String(Date.now()))
    return true
  } catch (e) {
    console.warn('[memory] autoLevel 旧 key 迁移失败（下次启动重试）', e)
    return false
  }
}

/**
 * 一次性迁移：把 v9.4 及之前的「trim+lower」key 记录复制到「保留大小写」的新 key，
 * 并收尾迁移 autoLevel 状态里的旧 key（v9.6 / Batch3）。
 *
 * 记录迁移：
 * - 只复制、不删除旧记录（旧记录保留作兼容/回滚依据，读取侧 canonicalizeMemoryRecords 会去重）；
 * - 只处理 `key !== memoryKey(dict, word)` 的记录（即单词含大写/内部空白的历史记录）；
 * - 新 key 已存在同名记录时跳过，绝不覆盖；
 * - 成功才写 localStorage 标记 `memoryKeyCaseV2`，失败只记录日志、下次启动重试；
 * - 迁移后清 memoryCache，保证本次会话后续读取拿到的是一致视图。
 *
 * v9.6 autoLevel 状态迁移：
 * - 映射来自同一份记录（word 保留原始大小写），由 migrateAutoLevelStateKeys 同步改名；
 * - 状态迁移失败时不写外层 `memoryKeyCaseV2` 标记 → 下次启动整体重试（记录复制幂等：
 *   已存在的规范 key 会被 existingKeys 跳过，不会重复写入）；状态迁移自身的标记也只在成功后写；
 * - v9.5 老用户已有 `memoryKeyCaseV2` 标记：这里先补跑状态迁移（独立标记 + 幂等），再返回 0。
 *
 * @returns 复制的记录条数；-1 表示失败（未写标记，下次重试）
 */
export async function migrateMemoryKeyCase(): Promise<number> {
  try {
    if (localStorage.getItem(MEMORY_KEY_CASE_MIGRATED_KEY)) {
      // v9.6：v9.5 老用户的记录 key 迁移已完成，但 autoLevel 状态旧 key 可能还没迁移 → 独立补跑
      await migrateAutoLevelStateKeysOnce()
      return 0
    }
    const rows = await db.memoryRecords.toArray()
    const existingKeys = new Set<string>()
    for (const rec of rows) if (rec && rec.key) existingKeys.add(rec.key)
    const copies: IMemoryRecord[] = []
    for (const rec of rows) {
      if (!rec || !rec.key || !rec.word || !rec.dict) continue
      const newKey = memoryKey(rec.dict, rec.word)
      if (newKey === rec.key) continue
      if (existingKeys.has(newKey)) continue
      copies.push({ ...rec, key: newKey })
      existingKeys.add(newKey)
    }
    if (copies.length) await db.memoryRecords.bulkPut(copies)
    clearMemoryCache()
    if (!(await migrateAutoLevelStateKeysOnce(rows))) return -1
    localStorage.setItem(MEMORY_KEY_CASE_MIGRATED_KEY, String(Date.now()))
    return copies.length
  } catch (e) {
    console.error('memoryKey 大小写拆分迁移失败（下次启动重试）', e)
    return -1
  }
}

/**
 * v9.5（DATA-003）：读取侧规范化视图。
 *
 * 迁移后同一单词可能同时存在「legacy key 旧记录」与「新 key 规范记录」（只复制不删旧记录的代价）；
 * 若直接参与统计/取词，会出现「已学数翻倍、同一词被抽两次」。这里按
 * `memoryKey(dict, word)`（保留大小写）分组：
 * - 优先保留 `key === memoryKey(dict, word)` 的规范记录；
 * - 只有 legacy 记录（尚未迁移的数据）时保留 legacy，保证功能可用；
 * - `march` 与 `March` 的 canonical key 不同 → 两条都会保留（这正是本次修复的目标）。
 */
export function canonicalizeMemoryRecords(records: IMemoryRecord[]): IMemoryRecord[] {
  if (!Array.isArray(records) || records.length === 0) return records || []
  const byCanonicalKey = new Map<string, IMemoryRecord>()
  const order: string[] = []
  for (const rec of records) {
    if (!rec || !rec.word) continue
    const canonicalKey = memoryKey(rec.dict, rec.word)
    const existing = byCanonicalKey.get(canonicalKey)
    if (!existing) {
      byCanonicalKey.set(canonicalKey, rec)
      order.push(canonicalKey)
      continue
    }
    // 同组内优先保留「key 与自身 word 一致」的规范记录
    if (existing.key !== canonicalKey && rec.key === canonicalKey) {
      byCanonicalKey.set(canonicalKey, rec)
    }
  }
  return order.map((key) => byCanonicalKey.get(key) as IMemoryRecord)
}

// ---------------------------------------------------------------------------
// v9.3.1（SRS-002）：时钟回拨 / 未来 due 的保守校准
// ---------------------------------------------------------------------------

/** 同一会话内只做一次（模块级 promise 去重） */
let futureDueFixPromise: Promise<number> | null = null
/** 距上次校准不足该间隔则跳过，避免数据页/取词反复触发全表扫描 */
const FUTURE_DUE_FIX_SKIP_MS = 5 * 60 * 1000

/**
 * 一次性校准入口（memory 初始化 / 取词前调用，内部去重）：
 * 只有在 `now < lastSeen`（时钟回拨、从时钟超前的机器导入数据）时，才把该词的 due 保守地
 * 压回 `min(due, now + interval)`；正常记录（`now >= lastSeen`）**完全不动**，不会误伤正常长间隔词。
 *
 * @returns 被修正的记录条数
 */
export function ensureFutureDueCorrected(): Promise<number> {
  if (!futureDueFixPromise) futureDueFixPromise = correctFutureDueRecords()
  return futureDueFixPromise
}

/**
 * 执行一次「未来 due」校准并写回 DB（幂等，可重复调用）。
 * - 只处理 `now < lastSeen` 的记录：这是唯一能确定「时间戳来自超前时钟」的信号；
 * - 修正值 = `correctClockRollback(now, lastSeen, due, interval)` = `min(due, now + interval)`；
 * - 用 localStorage 标记最近一次校准时间，5 分钟内重复调用直接返回 0（避免每次取词都全表扫）；
 * - 全程 try/catch，失败只 console.warn，绝不阻塞取词/迁移。
 */
export async function correctFutureDueRecords(): Promise<number> {
  try {
    const now = Date.now()
    try {
      const last = Number(localStorage.getItem(MEMORY_FUTURE_DUE_FIXED_KEY)) || 0
      if (last > 0 && now - last >= 0 && now - last < FUTURE_DUE_FIX_SKIP_MS) return 0
    } catch {
      // localStorage 不可用：继续执行（结果不落库也不致命）
    }
    const rows = await db.memoryRecords.toArray()
    if (!rows.length) return 0
    const fixed: IMemoryRecord[] = []
    for (const rec of rows) {
      if (!rec || !rec.key) continue
      const lastSeen = Number(rec.lastSeen) || 0
      // 只处理「记录时间戳在未来」的记录：正常记录（含 240 天档）一律不动
      if (!(now < lastSeen)) continue
      const due = Number(rec.due) || 0
      const next = correctClockRollback(now, lastSeen, due, Number(rec.interval) || 0)
      if (!Number.isFinite(next) || next === due) continue
      rec.due = next
      fixed.push(rec)
    }
    if (fixed.length) {
      await db.memoryRecords.bulkPut(fixed)
      clearMemoryCache()
      console.info(`[memory] 时钟回拨校准：${fixed.length} 条记录 due 压回 now+interval`)
    }
    try {
      localStorage.setItem(MEMORY_FUTURE_DUE_FIXED_KEY, String(now))
    } catch {
      // 标记写不进去只影响「5 分钟内重复调用」的优化，不影响正确性
    }
    return fixed.length
  } catch (e) {
    console.warn('[memory] correctFutureDueRecords failed', e)
    return 0
  }
}

async function fillTransFromDicts(agg: Map<string, { dict: string; word: string; trans?: string[]; phone?: string }>): Promise<void> {
  // 只关心「哪些词库有缺释义的词」；每个词库下的具体词名不需要（原实现的 Set<string> 值从未被读取）
  const dicts = new Set<string>()
  for (const a of agg.values()) {
    if (a.trans && a.trans.length) continue
    dicts.add(a.dict)
  }
  for (const dict of dicts) {
    const info = idDictionaryMap[dict]
    if (!info || !info.url) continue
    const file = info.url.split('/').pop() || ''
    if (!file) continue
    try {
      const list = await loadDictWords(file)
      const map = new Map(list.map((w) => [normalizeWordName(w.name), w]))
      for (const a of agg.values()) {
        if (a.dict !== dict || (a.trans && a.trans.length)) continue
        const w = map.get(normalizeWordName(a.word))
        if (w) {
          a.trans = w.trans
          a.phone = w.usphone || w.ukphone || ''
        }
      }
    } catch (e) {
      console.error('fill trans failed', dict, e)
    }
  }
}

function hashKey(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

async function migrateMemoryRecords(): Promise<void> {
  // v9.3：标记与数据同源校验——
  // - memoryRecords 非空：认为已迁移/已有新数据，只补标记，不覆盖；
  // - marker 存在但 memoryRecords 为空（如导入旧库只恢复 DB）：允许重新迁移；
  // - wordRecords 为空：不写标记，等有数据时再说。
  let existingCount = 0
  try {
    existingCount = await db.memoryRecords.count()
  } catch { /* ignore */ }
  const marker = localStorage.getItem(MEMORY_MIGRATED_KEY)
  if (existingCount > 0) {
    if (!marker) localStorage.setItem(MEMORY_MIGRATED_KEY, String(Date.now()))
    return
  }
  try {
    const rows = await db.wordRecords.toArray()
    if (!rows.length) return
    const existing = new Set((await db.memoryRecords.toArray()).map((r) => r.key))
    const agg = new Map<
      string,
      { key: string; word: string; dict: string; trans?: string[]; phone?: string; attempts: number; wrong: number; lastSeen: number; created: number; slow: number }
    >()
    for (const r of rows) {
      if (!r || !r.word || !r.dict) continue
      const key = memoryKey(r.dict, r.word)
      const ts = Number(r.timeStamp) ? Number(r.timeStamp) * 1000 : 0
      const prev = agg.get(key) ?? { key, word: r.word, dict: r.dict, attempts: 0, wrong: 0, lastSeen: 0, created: 0, slow: 0 }
      prev.attempts += 1
      prev.wrong += Math.max(0, Number(r.wrongCount) || 0)
      // v9.3：迁移时补慢词统计，方便后续 shadow/报告分析
      const totalMs = Array.isArray(r.timing) ? r.timing.reduce((acc, cur) => acc + (Number(cur) || 0), 0) : 0
      if (totalMs > 6000) prev.slow += 1
      if (ts) {
        prev.lastSeen = Math.max(prev.lastSeen, ts)
        if (!prev.created || ts < prev.created) prev.created = ts
      }
      agg.set(key, prev)
    }
    await fillTransFromDicts(agg)
    const now = Date.now()
    const records: IMemoryRecord[] = []
    for (const a of agg.values()) {
      if (existing.has(a.key)) continue
      const stage = migrateStage(a.wrong)
      const interval = [10 / 1440, 30 / 1440, 0.5, 1, 2, 4, 7, 15, 30, 60, 120, 240][stage]
      const lastSeen = a.lastSeen || now
      // v9.3：旧记录按 lastSeen + interval 算 due；已过期的摊到未来 14 天（避免首课复习雪崩）
      let due = lastSeen + interval * 24 * 3600 * 1000
      if (due <= now) due = computeDue(now, 0) + (hashKey(a.key) % (14 * 24 * 60)) * 60 * 1000
      records.push({
        key: a.key,
        word: a.word,
        dict: a.dict,
        trans: a.trans || [],
        phone: a.phone || '',
        stage,
        interval,
        ease: 2.5,
        due,
        lastSeen,
        createdAt: a.created || now,
        attempts: a.attempts,
        correct: Math.max(0, a.attempts - a.wrong),
        wrong: a.wrong,
        slow: a.slow,
        lapses: 0,
        lastResult: '',
      })
    }
    if (records.length) await db.memoryRecords.bulkPut(records)
    clearMemoryCache()
    // v8.9：只有真正成功才写「已迁移」标记；之前失败也会写，导致进度永远补不回来
    localStorage.setItem(MEMORY_MIGRATED_KEY, String(Date.now()))
  } catch (e) {
    console.error('migrate memory records failed', e)
  }
}

export async function getMemoryRecords(): Promise<IMemoryRecord[]> {
  // v8.9：命中内存缓存后不再每词全表反序列化；写入/删除会增量更新缓存
  // v9.5（DATA-003）：返回前按 canonical key 去重（legacy 旧记录 + 新记录并存时只算一次）
  const cached = getMemoryCache()
  if (cached) return canonicalizeMemoryRecords(cached)
  try {
    const records = await db.memoryRecords.toArray()
    await fillMissingTransInRecords(records)
    setMemoryCache(records)
    return canonicalizeMemoryRecords(records)
  } catch {
    return []
  }
}

/**
 * v8.5：开始页概览（今日新学 / 到期复习 / 已学总数），只读 memoryRecords；v9.0 追加今日练习词数统一口径。
 *
 * v9.3.1（SRS-001 后半）：`due` 与 `pickDynamicWord` 的到期池**完全同口径**——
 * - 按 memoryKey 去重（与取词池一致）；
 * - 排除已挂起（待攻克）的词：它们不会出现在到期复习里，不能计入「复习债」，
 *   否则会出现「顶栏显示 N 个到期，但一直刷不到第 N 个词」；
 * - 时钟回拨记录用 `effectiveDueOf` 校正值（SRS-002）。
 */
export async function getLearningSummary(): Promise<{ learned: number; due: number; todayNew: number; todayPracticed: number }> {
  try {
    const now = Date.now()
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const startTs = start.getTime()
    const rows = await db.memoryRecords.toArray()
    // v9.5（DATA-003）：legacy 旧记录与新 key 记录并存时按 canonical key 去重（已学/今日新学不翻倍）
    const records = canonicalizeMemoryRecords(rows)
    const suspendedKeys = new Set(getSuspendedKeys())
    const dueKeys = new Set<string>()
    let todayNew = 0
    for (const r of records) {
      if ((Number(r.createdAt) || 0) >= startTs) todayNew += 1
      const key = r.key || memoryKey(r.dict, r.word)
      if (key && suspendedKeys.has(key)) continue
      // 与取词池同口径（SRS-002 校正 + SRS-001 排除 suspended）
      if (effectiveDueOf(now, r) <= now) dueKeys.add(key || `${r.dict}::${r.word}`)
    }
    const due = dueKeys.size
    // v9.0：与数据页/分析页统一为「今日练过的词（按单词去重）」，含复习
    let todayPracticed = 0
    try {
      const rows = await db.wordRecords.where('timeStamp').aboveOrEqual(Math.floor(startTs / 1000)).toArray()
      const seen = new Set<string>()
      for (const row of rows) {
        const name = String(row.word || '').trim().toLowerCase()
        if (name) seen.add(name)
      }
      todayPracticed = seen.size
    } catch { /* ignore */ }
    return { learned: records.length, due, todayNew, todayPracticed }
  } catch {
    return { learned: 0, due: 0, todayNew: 0, todayPracticed: 0 }
  }
}

/** 老版本迁移时可能没有写释义；这里在读取时补齐，保证跨词库复习也能显示简洁释义 */
let fillingTrans = false
async function fillMissingTransInRecords(records: IMemoryRecord[]): Promise<void> {
  if (fillingTrans) return
  const missing = records.filter((r) => !r.trans || r.trans.length === 0)
  if (!missing.length) return
  fillingTrans = true
  try {
    const byDict = new Map<string, IMemoryRecord[]>()
    for (const r of missing) {
      const list = byDict.get(r.dict) || []
      list.push(r)
      byDict.set(r.dict, list)
    }
    const updated: IMemoryRecord[] = []
    for (const [dict, list] of byDict) {
      const info = idDictionaryMap[dict]
      if (!info || !info.url) continue
      const file = info.url.split('/').pop() || ''
      try {
        const words = await loadDictWords(file)
        const map = new Map(words.map((w) => [normalizeWordName(w.name), w]))
        for (const rec of list) {
          const w = map.get(normalizeWordName(rec.word))
          if (w) {
            rec.trans = w.trans
            rec.phone = w.usphone || w.ukphone || ''
            updated.push(rec)
          }
        }
      } catch { /* ignore */ }
    }
    // 个别旧词库（如 Google 高频词）缺少释义：到初级教材词表里找同名释义兜底
    const stillMissing = missing.filter((r) => !r.trans || r.trans.length === 0)
    if (stillMissing.length) {
      const fallback = new Map<string, Word>()
      for (let i = 0; i < Math.min(6, LEARNING_PATH.length); i++) {
        const words = await loadLevelWords(LEARNING_PATH[i])
        for (const w of words) {
          const k = normalizeWordName(w.name)
          if (!fallback.has(k)) fallback.set(k, w)
        }
      }
      for (const rec of stillMissing) {
        const w = fallback.get(normalizeWordName(rec.word))
        if (w) {
          rec.trans = w.trans
          rec.phone = w.usphone || w.ukphone || ''
          updated.push(rec)
        }
      }
    }
    if (updated.length) await db.memoryRecords.bulkPut(updated)
  } finally {
    fillingTrans = false
  }
}

function recordToWord(rec: IMemoryRecord): Word {
  return {
    name: rec.word,
    trans: Array.isArray(rec.trans) ? rec.trans : [],
    usphone: rec.phone || '',
    ukphone: rec.phone || '',
  }
}

function progressToInfo(progress: LevelProgress): LevelInfo {
  return {
    id: progress.levelId,
    name: progress.name,
    index: progress.index,
    unseen: progress.unseen,
    total: progress.total,
    done: progress.done,
    seen: progress.seen,
    mastered: progress.mastered,
    suspended: progress.suspended,
  }
}

/** 不触发词库加载的轻量级别信息（到期/回顾取词时用于顶栏展示） */
function levelInfoFromState(): LevelInfo | null {
  try {
    const state = loadAutoLevelState()
    const id = state.levelId || getPersistedLevelId()
    if (!id) return null
    const cached = state.cached
    const total = cached ? Number(cached.total) || 0 : 0
    const seen = cached ? Number(cached.seen) || 0 : 0
    const suspended = cached ? Number(cached.suspendedCount) || 0 : 0
    return {
      id,
      name: getLevelName(id),
      index: getLevelIndex(id),
      unseen: Math.max(0, total - seen - suspended),
      total,
      done: false,
      seen,
      mastered: cached ? Number(cached.mastered) || 0 : 0,
      suspended,
    }
  } catch {
    return null
  }
}

/**
 * v9.10：「70% 掌握即掺入上级词」的抽词实现。
 *
 * 从 **下一级**（LEARNING_PATH[index+1]，末级 cet6 无下一级）的未学词里抽 1 个：
 * - 词表加载失败 / 没有新词 / 全部落在 recent 窗口内 → 返回 null（调用方必须 fallthrough，不能直接返回 null）；
 * - 池子与现有新词一致：排除 recent（按 word 归一化去重）、按文件顺序前 20 个随机，保留教材顺序；
 * - 返回的 level 仍是 **本级** 进度信息，避免顶栏/进度条跳到下一级（只标 preview=true）。
 */
async function pickPreviewWord(
  records: IMemoryRecord[],
  progress: LevelProgress,
  recentSet: Set<string>,
): Promise<PickResult | null> {
  const nextLevel = LEARNING_PATH[progress.index + 1]
  if (!nextLevel) return null
  let next: LevelProgress
  try {
    next = await computeLevelProgress(records, nextLevel.id)
  } catch {
    return null
  }
  if (next.error || !next.newWords.length) return null
  const pool = next.newWords.filter((w) => w && w.name && !recentSet.has(normalizeWordKeyWord(w.name)))
  if (!pool.length) return null
  const batch = pool.slice(0, 20)
  const w = batch[Math.floor(Math.random() * batch.length)]
  if (!w) return null
  return {
    word: w,
    dict: w.dict || `auto:${nextLevel.id}`,
    level: progressToInfo(progress),
    refresh: false,
    preview: true,
  }
}

/**
 * 动态取下一个词（v9.3）：
 * 1. 先收集到期（按 key，排除 suspended/recent）与随机回顾；按 due 数量算新词比例；
 * 2. 随机回顾先抽（due 多时自动关闭）；
 * 3. 到期优先，剩余概率取新词；只有取新词时才计算/推进自动级别；
 * 4. 新词从本级未学词按文件顺序前 20 个随机（保留教材/词频顺序）。
 *
 * v9.10：本级没有新词可出时，若掌握度达 70% 且调用方给了 previewBudget（会话窗口剩余额度），
 * 按 getMixRatio() 的概率掺入 1 个下一级的未学词（preview=true，不影响本级完成判定）。
 */
export async function pickDynamicWord(opts: {
  records: IMemoryRecord[]
  recent: string[]
  mode: LearningMode
  manualDict?: string
  manualWords?: Word[]
  /**
   * v9.10：本次允许掺入上级词的额度（会话窗口 MIX_WINDOW_CAP - 窗口内已掺入次数）。
   * 缺省 0 = 不掺入（未接入窗口的调用方保持既有确定性：不掷骰、不消耗随机序列）。
   */
  previewBudget?: number
}): Promise<PickResult | null> {
  const now = Date.now()
  const recentSet = new Set(opts.recent.map(normalizeWordKeyWord))
  // v9.5（DATA-003）：known / recent 改用「保留大小写」的比较口径。
  // 旧口径按小写比较，导致同词库 March / march 被当成同一个词：学完 march 后 March 永不进新词池。
  // 仍然按 word（而不是 key）比较，保留 v9.3 的「跨词库同名同词不重复教」语义。
  const known = new Set(opts.records.map((r) => normalizeWordKeyWord(r.word)))
  const suspendedKeys = new Set(getSuspendedKeys())
  // v9.3.1（SRS-002）：取词前顺带触发一次性时钟回拨校准（内部去重，失败静默；不阻塞本次取词）
  void ensureFutureDueCorrected()

  // 错词当场重现（若已被挂起则丢弃）
  const requeued = takeRequeueWord()
  if (requeued && !suspendedKeys.has(memoryKey(requeued.dict, requeued.word.name))) {
    return { word: requeued.word, dict: requeued.dict, level: null, refresh: true, hint: 'retry' }
  }

  // 到期/回顾池：按 key 去重（同词不同词库都能被抽到），排除 suspended/recent
  const dueByKey = new Map<string, IMemoryRecord>()
  const refreshRecords: IMemoryRecord[] = []
  for (const rec of opts.records) {
    if (!rec || !rec.word) continue
    const key = rec.key || memoryKey(rec.dict, rec.word)
    if (suspendedKeys.has(key)) continue
    if (recentSet.has(normalizeWordKeyWord(rec.word))) continue
    // v9.3.1（SRS-002）：时钟回拨/未来 lastSeen 的记录用「校正后的 due」分类，
    // 否则它的 due 落在未来很久，永远进不了到期池（v9.3 只修了答题路径）。
    const due = effectiveDueOf(now, rec)
    if (due <= now) {
      if (!dueByKey.has(key)) dueByKey.set(key, rec)
    } else {
      refreshRecords.push(rec)
    }
  }
  const due = Array.from(dueByKey.values())
  const dueCount = due.length
  const randOf = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
  const refreshChance = getRefreshChance(dueCount)
  const newRatio = getNewRatio(dueCount)

  // 随机回顾：答对只刷新不升档；due 积压多时概率自动降为 0
  if (refreshRecords.length > 0 && Math.random() < refreshChance) {
    const rec = randOf(refreshRecords)
    return { word: recordToWord(rec), dict: rec.dict, level: levelInfoFromState(), refresh: true, hint: 'review' }
  }

  const wantNew = dueCount === 0 || Math.random() < newRatio
  let progress: LevelProgress | null = null
  const ensureProgress = async (): Promise<LevelProgress | null> => {
    if (progress) return progress
    try {
      progress = await resolveCurrentLevel(opts.records)
      return progress
    } catch (e) {
      console.error('resolve auto level failed', e)
      return null
    }
  }

  if (wantNew) {
    if (opts.mode === 'auto') {
      const p = await ensureProgress()
      if (p && !p.error) {
        const newWords = p.newWords.filter((w) => !recentSet.has(normalizeWordKeyWord(w.name)))
        if (newWords.length) {
          const batch = newWords.slice(0, 20)
          const w = randOf(batch)
          return { word: w, dict: w.dict || `auto:${p.levelId}`, level: progressToInfo(p), refresh: false }
        }
      }
    } else {
      const manualNew = (opts.manualWords || []).filter(
        (w) => w && w.name && !known.has(normalizeWordKeyWord(w.name)) && !recentSet.has(normalizeWordKeyWord(w.name)),
      )
      if (manualNew.length) {
        const w = randOf(manualNew)
        return { word: w, dict: w.dict || opts.manualDict || 'manual', level: null, refresh: false }
      }
    }
  }

  // v9.10：本级新词出完之后，按掌握度掺入下一级词。
  // 注意：只有 mix>0 时才掷骰——mix<=0 绝不调用 Math.random()，否则既有确定性随机序列整体位移。
  if (opts.mode === 'auto' && dueCount > 0 && (opts.previewBudget || 0) > 0) {
    const p = await ensureProgress()
    if (p && !p.error) {
      const mix = getMixRatio(p.mastered, p.required)
      if (mix > 0 && Math.random() < mix) {
        const preview = await pickPreviewWord(opts.records, p, recentSet)
        // 抽不到（末级/加载失败/无新词）必须继续走 due 兜底，不能返回 null
        if (preview) return preview
      }
    }
  }

  if (dueCount > 0) {
    const rec = randOf(due)
    const p = opts.mode === 'auto' ? progress || (await ensureProgress()) : null
    return { word: recordToWord(rec), dict: rec.dict, level: p ? progressToInfo(p) : levelInfoFromState(), refresh: false }
  }

  // 全部学完/没有新词：随机回顾兜底
  if (refreshRecords.length > 0) {
    const rec = randOf(refreshRecords)
    return { word: recordToWord(rec), dict: rec.dict, level: levelInfoFromState(), refresh: true, hint: 'review' }
  }
  return null
}
