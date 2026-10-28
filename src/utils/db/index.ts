import type { IChapterRecord, IMemoryRecord, IReviewRecord, IRevisionDictRecord, IWordRecord, LetterMistakes } from './record'
import { ChapterRecord, ReviewRecord, WordRecord } from './record'
import { MEMORY_GRADUATE_STAGE, adaptiveDaysFromRecord, clampStage, ladderDays } from '@/utils/memoryLadder'
import { removeMemoryCache, upsertMemoryCache } from '@/utils/memoryCache'
import { legacyMemoryKey, memoryKey, memoryKeyCandidates, normalizeWordKeyWord } from '@/utils/memoryKey'
import { computeDue, evaluateWrong, shouldCountSlow } from '@/utils/srsRules'
import type { Table } from 'dexie'
import Dexie from 'dexie'

class RecordDB extends Dexie {
  wordRecords!: Table<IWordRecord, number>
  chapterRecords!: Table<IChapterRecord, number>
  reviewRecords!: Table<IReviewRecord, number>
  memoryRecords!: Table<IMemoryRecord, string>

  revisionDictRecords!: Table<IRevisionDictRecord, number>
  revisionWordRecords!: Table<IWordRecord, number>

  constructor() {
    super('RecordDB')
    this.version(1).stores({
      wordRecords: '++id,word,timeStamp,dict,chapter,errorCount,[dict+chapter]',
      chapterRecords: '++id,timeStamp,dict,chapter,time,[dict+chapter]',
    })
    this.version(2).stores({
      wordRecords: '++id,word,timeStamp,dict,chapter,wrongCount,[dict+chapter]',
      chapterRecords: '++id,timeStamp,dict,chapter,time,[dict+chapter]',
    })
    this.version(3).stores({
      wordRecords: '++id,word,timeStamp,dict,chapter,wrongCount,[dict+chapter]',
      chapterRecords: '++id,timeStamp,dict,chapter,time,[dict+chapter]',
      reviewRecords: '++id,dict,createTime,isFinished',
    })
    // v7：记忆曲线记录（Dexie 内部版本号会映射为 IDB 40；升级保留旧数据）
    this.version(4).stores({
      memoryRecords: 'key,word,dict,due,[dict+due]',
    })
  }
}

export const db = new RecordDB()

db.wordRecords.mapToClass(WordRecord)
db.chapterRecords.mapToClass(ChapterRecord)
db.reviewRecords.mapToClass(ReviewRecord)

// v9.9（Batch6 / DATA-001 验收缺陷修复）：启动即清理「导入中途被强杀」残留的 RecordDB-import-* 临时库。
// 之前只有下一次导入开始时才清理 → 强杀一次会留下永久残留（实测 9 轮有 6 轮残留）。
// - 动态 import：data-export.ts 静态依赖 `db` 与 `../memory`，静态 import 会形成循环；
// - 只在浏览器有 indexedDB.databases() 时生效（Node/仿真环境直接跳过），失败只 warn，绝不阻塞启动。
void (async () => {
  try {
    const { cleanupStaleTempImportDbs } = await import('./temp-import-db')
    await cleanupStaleTempImportDbs()
  } catch (e) {
    console.warn('[QZ] 启动清理残留临时导入库失败（不影响启动，下次导入会重试）：', e)
  }
})()

// ---------------------------------------------------------------------------
// v9.5（数据修复 DATA-003）：记忆记录 key 大小写拆分后的「读写兼容层」
//
// v9.4 及之前 memoryKey = `${dict}::${trim+lower(word)}`，导致 March / march、China / china、
// IT / it 等**不同词条**共用一条 SRS 记录。v9.5 起 key 保留大小写（memoryKey），并对旧记录做一次性
// 迁移（memory.ts: memoryKeyCaseV2，只复制不删旧记录）。因此所有「按 key 读/写/删」的入口都要兼容
// legacy key（trim+lower）：读取 miss 时回退；删除时新旧都删（但要避免误删同名不同大小写的兄弟词条）。
// ---------------------------------------------------------------------------

/**
 * 读取某个词的记忆记录（兼容 legacy key）。
 *
 * - 新 key 命中，且记录的 word 与目标单词**大小写一致** → 直接返回；
 * - 新 key 命中但 word 大小写不同 → 该 key 被「同名不同大小写的旧记录」占用（旧数据、尚未迁移），
 *   视为未命中，避免把另一个词的档位/到期时间继承过来（这正是 DATA-003 要修的问题）；
 * - 新 key miss → 回退 legacy key；仅当 legacy 记录的 word 与目标单词大小写一致时才采用，
 *   并返回一份改写到新 key 的副本（调用方 put 时会落到新 key，legacy 原记录保留不动）。
 */
async function readMemoryRecordForWord(dict: string, word: string): Promise<IMemoryRecord | undefined> {
  const key = memoryKey(dict, word)
  const target = normalizeWordKeyWord(word)
  const direct = await db.memoryRecords.get(key)
  if (direct) return normalizeWordKeyWord(direct.word) === target ? direct : undefined
  const legacyKey = legacyMemoryKey(dict, word)
  if (legacyKey === key) return undefined
  const legacy = await db.memoryRecords.get(legacyKey)
  if (!legacy) return undefined
  if (normalizeWordKeyWord(legacy.word) !== target) return undefined
  return { ...legacy, key }
}

/**
 * v9.5：删除某个词的全部记忆记录（新 key + 可能的 legacy key）。
 *
 * legacy key 可能已被「同名不同大小写的另一个词」占用（例如 `dict::march` 现在属于小写 march），
 * 所以只在「记录里的 word 与待删单词大小写一致」时才删 legacy；返回实际删除条数。
 *
 * 仅供 `@/hooks/useRecordMutations` 的 `useDeleteWordRecord` 使用（原为模块私有）。
 */
export async function deleteMemoryRecordForWord(dict: string, word: string): Promise<number> {
  const target = normalizeWordKeyWord(word)
  let deleted = 0
  for (const key of memoryKeyCandidates(dict, word)) {
    const rec = await db.memoryRecords.get(key)
    if (!rec) continue
    if (normalizeWordKeyWord(rec.word) !== target) continue
    await db.memoryRecords.delete(key)
    removeMemoryCache(key)
    deleted += 1
  }
  return deleted
}

/** v7：根据一次作答更新记忆曲线记录（在背单词完成后调用）；v9.3 接入 srsRules 并显式传递 refresh */
export async function updateMemoryProgress(
  dict: string,
  word: string,
  wrongCount: number,
  totalMs = 0,
  trans?: string[],
  phone?: string,
  isRefreshRequested = false,
): Promise<void> {
  try {
    const key = memoryKey(dict, word)
    const now = Date.now()
    // v9.5（DATA-003）：新旧 key 兼容读取；未迁移的旧记录（legacy key）会以副本形式落到新 key
    const prev = await readMemoryRecordForWord(dict, word)
    const isNew = !prev
    const prevDue = Number(prev?.due) || 0
    const prevLastSeen = Number(prev?.lastSeen) || 0
    const clockRollback = !!prev && now < prevLastSeen
    // 只有新词 / 已到期词（含时钟回拨）才升档；同会话循环/回看只记 early-ok
    const wasDue = isNew || clockRollback || prevDue <= now
    // v9.3：refresh 只在“未到期”时生效；到期词即使带着旧 refresh 标记也按正常复习升档
    const isRefresh = !!isRefreshRequested && !wasDue && !isNew
    const ok = Number(wrongCount) === 0
    const rec: IMemoryRecord = prev
      ? { ...prev }
      : {
          key,
          word,
          dict,
          trans: trans || [],
          phone: phone || '',
          stage: 0,
          interval: 0,
          ease: 2.5,
          due: 0,
          lastSeen: 0,
          createdAt: now,
          attempts: 0,
          correct: 0,
          wrong: 0,
          slow: 0,
          lapses: 0,
          lastResult: '',
        }
    rec.word = word
    rec.dict = dict
    if (trans && trans.length) rec.trans = trans
    if (phone) rec.phone = phone
    rec.attempts += 1
    rec.lastSeen = now
    // 时钟回拨：把未来 due 校正到 now，否则会永远 early-ok（P1-4）
    if (clockRollback && prev) rec.due = now
    // 慢词统计与作答分支无关（refresh-ok 也计数，P2-9）
    if (shouldCountSlow(totalMs)) rec.slow += 1

    const finalize = async () => {
      // v8.3 影子调度：只记录自适应估算，不改变 due
      rec.shadowInterval = adaptiveDaysFromRecord(rec)
      rec.shadowDue = now + Math.round(rec.shadowInterval * 24 * 3600 * 1000)
      rec.shadowAt = now
      await db.memoryRecords.put(rec)
      upsertMemoryCache(rec)
      // v9.3：完成一次作答后清掉 Skip/suspended；持续遗忘（lapses>=4）自动挂起为“待攻克”
      // 动态 import autoLevel，避免 db → autoLevel → learningPath 在应用启动阶段形成 TDZ 循环
      try {
        const { clearSkip, suspendWord } = await import('@/utils/autoLevel')
        clearSkip(dict, word)
        if (!ok && rec.lapses >= 4) suspendWord(dict, word)
      } catch { /* ignore */ }
    }

    if (isRefresh) {
      // 随机回顾：答对只刷新记忆，不延长间隔；答错按分级降档处理
      if (ok) {
        rec.correct += 1
        rec.lastResult = 'refresh-ok'
      } else {
        const w = evaluateWrong(prev, wrongCount)
        rec.wrong += 1
        rec.stage = w.stage
        rec.ease = w.ease
        rec.lapses += w.lapseDelta
        rec.interval = ladderDays(rec.stage)
        rec.due = computeDue(now, rec.interval)
        rec.lastResult = 'refresh-wrong'
      }
      await finalize()
      return
    }

    if (ok) {
      rec.correct += 1
      if (wasDue) {
        rec.stage = isNew ? MEMORY_GRADUATE_STAGE : clampStage(rec.stage + 1)
        rec.ease = Math.min(3, Math.round((rec.ease + 0.1) * 100) / 100)
        rec.interval = ladderDays(rec.stage)
        rec.due = computeDue(now, rec.interval)
        rec.lastResult = 'ok'
      } else {
        // 同会话提前重练：只刷新记忆，不推进档位、不延长到期时间
        rec.lastResult = 'early-ok'
      }
    } else {
      const w = evaluateWrong(prev, wrongCount)
      rec.wrong += 1
      rec.stage = w.stage
      rec.ease = w.ease
      rec.lapses += w.lapseDelta
      rec.interval = ladderDays(rec.stage)
      rec.due = computeDue(now, rec.interval)
      rec.lastResult = 'wrong'
    }
    await finalize()
  } catch (e) {
    console.error('update memory progress failed', e)
  }
}

export type WordKeyLogger = {
  letterTimeArray: number[]
  letterMistake: LetterMistakes
}

/**
 * v9.3：Skip 时把该词的 due 顺延（至少 N×24h），避免立刻再次出现。
 *
 * v9.7（DATA-009）：Skip 的承诺是「至少 N 天」= 精确 N×24 小时，不能用 computeDue 的
 * 「目标本地自然日 00:00」语义（23:50 Skip 只隔 10 分钟就再次到期）。
 * 正常 SRS 排程（updateMemoryProgress）仍走 computeDue 的本地自然日 00:00，故只改本函数：
 * - 保留 Math.max：已更远的 due 不缩短（只延后、不回退）；
 * - 保留 days 的既有兜底（0/负数/NaN/非有限值 → 约 30 分钟），避免写出 now/NaN；
 * - 用 epoch 毫秒做绝对时长，不受本地时区/DST 影响（中国无 DST；DST 地区代价见 DATA009-AUDIT）。
 */
export async function deferMemoryDue(dict: string, word: string, days = 1): Promise<void> {
  try {
    // v9.5（DATA-003）：兼容 legacy key；副本记录的 key 已是新 key
    const rec = await readMemoryRecordForWord(dict, word)
    if (!rec) return
    const now = Date.now()
    const requestedDays = Number(days)
    const spanDays = Number.isFinite(requestedDays) && requestedDays > 0 ? Math.max(0.0208, requestedDays) : 0.0208
    const minDue = now + Math.round(spanDays * 24 * 60 * 60 * 1000)
    rec.due = Math.max(Number(rec.due) || 0, minDue)
    await db.memoryRecords.put(rec)
    upsertMemoryCache(rec)
  } catch (e) {
    console.error('defer memory due failed', e)
  }
}
