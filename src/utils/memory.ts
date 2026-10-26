import type { Word } from '@/typings'
import type { IMemoryRecord } from './db/record'
import { db } from './db'
import { idDictionaryMap } from '@/resources/dictionary'
import { LEARNING_PATH, loadDictWords, loadLevelWords } from './learningPath'
import { clearMemoryCache, getMemoryCache, setMemoryCache } from './memoryCache'
import { memoryKey, normalizeWordName } from './memoryKey'
import {
  getLevelIndex,
  getLevelName,
  getNewRatio,
  getPersistedLevelId,
  getRefreshChance,
  getSuspendedKeys,
  loadAutoLevelState,
  resolveCurrentLevel,
} from './autoLevel'
import type { LevelProgress } from './autoLevel'
import { takeRequeueWord } from './sessionRequeue'
import { computeDue, migrateStage } from './srsRules'

export { memoryKey, normalizeWordName }

export const MEMORY_MIGRATED_KEY = 'memoryMigratedV1'

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
}

/** 读取旧版官方练习记录，迁移为记忆曲线记录（只执行一次；不修改旧记录） */
let migratePromise: Promise<void> | null = null
export function ensureMemoryMigrated(): Promise<void> {
  if (!migratePromise) migratePromise = migrateMemoryRecords()
  return migratePromise
}

async function fillTransFromDicts(agg: Map<string, { dict: string; word: string; trans?: string[]; phone?: string }>): Promise<void> {
  const byDict = new Map<string, Set<string>>()
  for (const a of agg.values()) {
    if (a.trans && a.trans.length) continue
    if (!byDict.has(a.dict)) byDict.set(a.dict, new Set())
    byDict.get(a.dict)!.add(normalizeWordName(a.word))
  }
  for (const [dict, names] of byDict) {
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
  const cached = getMemoryCache()
  if (cached) return cached
  try {
    const records = await db.memoryRecords.toArray()
    await fillMissingTransInRecords(records)
    setMemoryCache(records)
    return records
  } catch {
    return []
  }
}

/** v8.5：开始页概览（今日新学 / 到期复习 / 已学总数），只读 memoryRecords；v9.0 追加今日练习词数统一口径 */
export async function getLearningSummary(): Promise<{ learned: number; due: number; todayNew: number; todayPracticed: number }> {
  try {
    const now = Date.now()
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const startTs = start.getTime()
    const records = await db.memoryRecords.toArray()
    let due = 0
    let todayNew = 0
    for (const r of records) {
      if ((Number(r.due) || 0) <= now) due += 1
      if ((Number(r.createdAt) || 0) >= startTs) todayNew += 1
    }
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
 * 动态取下一个词（v9.3）：
 * 1. 先收集到期（按 key，排除 suspended/recent）与随机回顾；按 due 数量算新词比例；
 * 2. 随机回顾先抽（due 多时自动关闭）；
 * 3. 到期优先，剩余概率取新词；只有取新词时才计算/推进自动级别；
 * 4. 新词从本级未学词按文件顺序前 20 个随机（保留教材/词频顺序）。
 */
export async function pickDynamicWord(opts: {
  records: IMemoryRecord[]
  recent: string[]
  mode: LearningMode
  manualDict?: string
  manualWords?: Word[]
}): Promise<PickResult | null> {
  const now = Date.now()
  const recentSet = new Set(opts.recent.map(normalizeWordName))
  const known = new Set(opts.records.map((r) => normalizeWordName(r.word)))
  const suspendedKeys = new Set(getSuspendedKeys())

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
    if (recentSet.has(normalizeWordName(rec.word))) continue
    const due = Number(rec.due) || 0
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
        const newWords = p.newWords.filter((w) => !recentSet.has(normalizeWordName(w.name)))
        if (newWords.length) {
          const batch = newWords.slice(0, 20)
          const w = randOf(batch)
          return { word: w, dict: w.dict || `auto:${p.levelId}`, level: progressToInfo(p), refresh: false }
        }
      }
    } else {
      const manualNew = (opts.manualWords || []).filter(
        (w) => w && w.name && !known.has(normalizeWordName(w.name)) && !recentSet.has(normalizeWordName(w.name)),
      )
      if (manualNew.length) {
        const w = randOf(manualNew)
        return { word: w, dict: w.dict || opts.manualDict || 'manual', level: null, refresh: false }
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
