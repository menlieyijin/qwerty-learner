import type { Word } from '@/typings'
import type { IMemoryRecord } from './db/record'
import { db } from './db'
import { idDictionaryMap } from '@/resources/dictionary'
import { LEARNING_PATH, loadDictWords, loadLevelWords } from './learningPath'
import { markRefresh } from './refreshMarker'
import { takeRequeueWord } from './sessionRequeue'

export const MEMORY_MIGRATED_KEY = 'memoryMigratedV1'

export type LearningMode = 'auto' | 'manual' | 'custom'

export type LevelInfo = {
  id: string
  name: string
  index: number
  unseen: number
  total: number
  done: boolean
}

export type PickResult = {
  word: Word
  dict: string
  level: LevelInfo | null
  refresh: boolean
  /** v8：retry=会话内错词重练，review=随机回顾 */
  hint?: 'retry' | 'review'
}

export function normalizeWordName(name: string): string {
  return String(name || '').trim().toLowerCase()
}

export function memoryKey(dict: string, word: string): string {
  return `${dict}::${normalizeWordName(word)}`
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

async function migrateMemoryRecords(): Promise<void> {
  if (localStorage.getItem(MEMORY_MIGRATED_KEY)) return
  try {
    const rows = await db.wordRecords.toArray()
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
      const stage = a.wrong === 0 ? 3 : a.wrong < 3 ? 2 : 1
      records.push({
        key: a.key,
        word: a.word,
        dict: a.dict,
        trans: a.trans || [],
        phone: a.phone || '',
        stage,
        interval: [10 / 1440, 30 / 1440, 0.5, 1, 2, 4, 7, 15, 30, 60, 120, 240][stage],
        ease: 2.5,
        due: now,
        lastSeen: a.lastSeen || now,
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
  } catch (e) {
    console.error('migrate memory records failed', e)
  }
  localStorage.setItem(MEMORY_MIGRATED_KEY, String(Date.now()))
}

export async function getMemoryRecords(): Promise<IMemoryRecord[]> {
  try {
    const records = await db.memoryRecords.toArray()
    await fillMissingTransInRecords(records)
    return records
  } catch {
    return []
  }
}

/** v8.5：开始页概览（今日新学 / 到期复习 / 已学总数），只读 memoryRecords */
export async function getLearningSummary(): Promise<{ learned: number; due: number; todayNew: number }> {
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
    return { learned: records.length, due, todayNew }
  } catch {
    return { learned: 0, due: 0, todayNew: 0 }
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

async function resolveAutoLevel(records: IMemoryRecord[]): Promise<{ info: LevelInfo; unseen: Word[] } | null> {
  const known = new Set(records.map((r) => normalizeWordName(r.word)))
  for (let i = 0; i < LEARNING_PATH.length; i++) {
    const level = LEARNING_PATH[i]
    const words = await loadLevelWords(level)
    const unseen = words.filter((w) => !known.has(normalizeWordName(w.name)))
    if (unseen.length > 0) {
      return {
        info: { id: level.id, name: level.name, index: i, unseen: unseen.length, total: words.length, done: false },
        unseen,
      }
    }
  }
  const last = LEARNING_PATH[LEARNING_PATH.length - 1]
  const words = await loadLevelWords(last)
  return {
    info: { id: last.id, name: last.name, index: LEARNING_PATH.length - 1, unseen: 0, total: words.length, done: true },
    unseen: [],
  }
}

/**
 * 动态取下一个词（不是预生成列表）：
 * 1. 到期复习词（任意词库）与当前水平的未学词随机混排，到期优先；
 * 2. 约 12% 概率抽一个已学会但未到期的词做「随机回顾」，答对不延长间隔；
 * 3. 跨词库按单词去重，已学过的词不会作为新词再次出现。
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

  let levelInfo: LevelInfo | null = null
  let newWords: Word[] = []
  if (opts.mode === 'auto') {
    const level = await resolveAutoLevel(opts.records)
    if (level) {
      levelInfo = level.info
      newWords = level.unseen
    }
  } else {
    newWords = (opts.manualWords || []).filter((w) => !known.has(normalizeWordName(w.name)))
  }
  newWords = newWords.filter((w) => !recentSet.has(normalizeWordName(w.name)))

  // v8 错词当场重现：答错的词隔几个词优先拉回一次，避免只等 10 分钟档而本次练习再也见不到
  const requeued = takeRequeueWord()
  if (requeued) {
    markRefresh(memoryKey(requeued.dict, requeued.word.name))
    return { word: requeued.word, dict: requeued.dict, level: levelInfo, refresh: true, hint: 'retry' }
  }

  const dueByWord = new Map<string, IMemoryRecord>()
  const refreshRecords: IMemoryRecord[] = []
  for (const rec of opts.records) {
    const key = normalizeWordName(rec.word)
    if (!key || recentSet.has(key)) continue
    if ((Number(rec.due) || 0) <= now) {
      if (!dueByWord.has(key)) dueByWord.set(key, rec)
    } else {
      refreshRecords.push(rec)
    }
  }
  const due = Array.from(dueByWord.values())
  const randOf = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

  // 随机回顾：让「认为已经会了」的词也会不定时出现
  if (refreshRecords.length > 0 && Math.random() < 0.12) {
    const rec = randOf(refreshRecords)
    markRefresh(rec.key)
    return { word: recordToWord(rec), dict: rec.dict, level: levelInfo, refresh: true, hint: 'review' }
  }

  const newDict = opts.mode === 'auto' ? 'auto:' + (levelInfo?.id || 'level') : opts.manualDict || 'manual'
  const makeNew = (w: Word): PickResult => ({ word: w, dict: w.dict || newDict, level: levelInfo, refresh: false })
  const makeDue = (rec: IMemoryRecord): PickResult => ({ word: recordToWord(rec), dict: rec.dict, level: levelInfo, refresh: false })

  if (due.length > 0 && newWords.length > 0) {
    return Math.random() < 0.7 ? makeDue(randOf(due)) : makeNew(randOf(newWords))
  }
  if (due.length > 0) return makeDue(randOf(due))
  if (newWords.length > 0) return makeNew(randOf(newWords))
  // 全部学完且没有到期词：随机回顾一个已学词
  if (refreshRecords.length > 0) {
    const rec = randOf(refreshRecords)
    markRefresh(rec.key)
    return { word: recordToWord(rec), dict: rec.dict, level: levelInfo, refresh: true, hint: 'review' }
  }
  return null
}
