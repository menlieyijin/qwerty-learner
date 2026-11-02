import type { IWordRecord } from '@/utils/db/record'
import dayjs from 'dayjs'
import type { Activity } from 'react-activity-calendar'

/**
 * 统计页的纯聚合层（v11.6.1，从 `useWordStats.ts` 抽出）。
 *
 * 为什么抽出来：聚合是「日桶 + 去重词数 + WPM + 正确率 + 错误键」五套口径叠在一起，
 * 之前埋在 React hook 文件里，只能靠打开统计页肉眼验证。抽成纯函数后：
 * - 可以用脏记录（缺列、NaN、字符串时间戳）直接断言；
 * - 可以拿它和旧实现跑同一批数据做性能对照（`npm run test:word-stats`）；
 * - hook 只剩「读库 + 取消过期请求 + 错误态」。
 *
 * 口径与 v9.14 之后完全一致，没有改任何展示含义。
 */

/** PAGES-008：单个按键的错误统计（保留全量按键，展示层再决定能否映射到键盘图） */
export type WrongKeyStat = {
  /** 规范化后的原始按键：字母统一大写，空格保留 ' '，其它（数字/标点/特殊键）保留原样 */
  key: string
  /** 展示名：字母为 A-Z，空格为「空格」，其它保留原 key */
  label: string
  /** 错误次数 */
  value: number
  /** 是否属于键盘热力图可映射的 A-Z（false 的键只在柱状图中展示） */
  mappable: boolean
}

export type WordStats = {
  isEmpty?: boolean
  exerciseRecord: Activity[]
  wordRecord: Activity[]
  wpmRecord: [string, number][]
  accuracyRecord: [string, number][]
  wrongTimeRecord: WrongKeyStat[]
}

/** 空格键的展示名 */
export const SPACE_KEY_LABEL = '空格'

/**
 * 规范化 e.key：
 * - 单字符（字母/数字/标点）统一转大写，保证 'a' 与 'A' 合并；
 * - 空格保持 ' '（展示层映射为「空格」）；
 * - 多字符键（如 'Backspace'）保留原样，不再被旧实现的 toUpperCase 变成 'BACKSPACE'。
 */
export function normalizeWrongKey(rawKey: string): string {
  const key = String(rawKey ?? '')
  if (!key) return ''
  if (key === ' ') return ' '
  return key.length === 1 ? key.toUpperCase() : key
}

/** 键盘图可映射的键：A-Z */
export function isMappableKeyboardKey(key: string): boolean {
  return /^[A-Z]$/.test(key)
}

/** 把「按键 → 次数」的 Map 转成排好序的展示数组（同值按名称排序，保证渲染稳定） */
export function toWrongKeyStats(counter: ReadonlyMap<string, number>): WrongKeyStat[] {
  return Array.from(counter.entries())
    .filter(([key]) => !!key)
    .map(([key, value]) => ({
      key,
      label: key === ' ' ? SPACE_KEY_LABEL : key,
      value,
      mappable: isMappableKeyboardKey(key),
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
}

/**
 * PAGES-008：把 mistakes 里的原始按键聚合为全量统计。
 * 保留给「已有一维按键数组」的调用方；聚合主路径见 `aggregateWordRecords`（不再展开数组）。
 */
export function buildWrongKeyStats(rawKeys: readonly string[]): WrongKeyStat[] {
  const counter = new Map<string, number>()
  for (const rawKey of rawKeys) {
    const key = normalizeWrongKey(rawKey)
    if (!key) continue
    counter.set(key, (counter.get(key) ?? 0) + 1)
  }
  return toWrongKeyStats(counter)
}

/** 两个时间戳之间的所有日期（YYYY-MM-DD，含首尾） */
export function getDatesBetween(start: number, end: number): string[] {
  const dates: string[] = []
  let curr = dayjs(start).startOf('day')
  const last = dayjs(end).endOf('day')
  while (curr.diff(last) < 0) {
    dates.push(curr.format('YYYY-MM-DD'))
    curr = curr.add(1, 'day')
  }
  return dates
}

/** 日历热力图分级（与上游一致：0 / <4 / <8 / <12 / ≥12） */
export function getLevel(value: number): Activity['level'] {
  if (value === 0) return 0
  if (value < 4) return 1
  if (value < 8) return 2
  if (value < 12) return 3
  return 4
}

type Bucket = {
  exerciseTime: number
  words: Set<string>
  wordCount: number
  charLength: number
  totalTime: number
  wrongCount: number
}

/**
 * 聚合统计区间的练习记录。
 *
 * 关键点：
 * 1) 只遍历一次记录，按天就地累加（旧实现用 `[...arr, x]`，全年数据是 O(n²)）；
 * 2) 错误键按「Map 合并」累计，**不再**把每个错误展开成数组元素
 *    （旧实现 `flatMap + Array.from({length: count})` 会造出与错误次数等长的数组，
 *    十万级错误时是几百万个字符串）；
 * 3) 脏记录逐条跳过：备份导入不校验列，旧备份可能缺 timeStamp/word/timing/mistakes。
 */
export function aggregateWordRecords(records: readonly IWordRecord[], startTimeStamp: number, endTimeStamp: number): WordStats {
  const empty: WordStats = {
    isEmpty: true,
    exerciseRecord: [],
    wordRecord: [],
    wpmRecord: [],
    accuracyRecord: [],
    wrongTimeRecord: [],
  }
  if (!Array.isArray(records) || records.length === 0) return empty

  const data = new Map<string, Bucket>()
  for (const date of getDatesBetween(startTimeStamp * 1000, endTimeStamp * 1000)) {
    data.set(date, { exerciseTime: 0, words: new Set(), wordCount: 0, charLength: 0, totalTime: 0, wrongCount: 0 })
  }

  const wrongKeys = new Map<string, number>()

  for (const record of records) {
    if (!record || typeof record.word !== 'string' || !record.word) continue
    if (typeof record.timeStamp !== 'number' || !Number.isFinite(record.timeStamp)) continue
    const date = dayjs(record.timeStamp * 1000).format('YYYY-MM-DD')
    const bucket = data.get(date)
    if (!bucket) continue

    bucket.exerciseTime += 1
    bucket.words.add(record.word)
    bucket.wordCount += 1
    bucket.charLength += record.word.length

    const timing = Array.isArray(record.timing) ? record.timing : []
    for (const ms of timing) bucket.totalTime += Number(ms) || 0
    bucket.wrongCount += Number(record.wrongCount) || 0

    const mistakes = record.mistakes ?? {}
    for (const keys of Object.values(mistakes)) {
      if (!Array.isArray(keys)) continue
      for (const rawKey of keys) {
        const key = normalizeWrongKey(rawKey)
        if (!key) continue
        wrongKeys.set(key, (wrongKeys.get(key) ?? 0) + 1)
      }
    }
  }

  const entries = [...data.entries()]

  const exerciseRecord: Activity[] = entries.map(([date, { exerciseTime }]) => ({
    date,
    count: exerciseTime,
    level: getLevel(exerciseTime),
  }))
  const wordRecord: Activity[] = entries.map(([date, { words }]) => ({
    date,
    count: words.size,
    level: getLevel(words.size),
  }))
  // wpm = 练习词数（不去重）/ 总时间；totalTime 为 0 时给 0，避免 Infinity 进入图表
  const wpmRecord: [string, number][] = entries
    .map<[string, number]>(([date, { wordCount, totalTime }]) => [
      date,
      totalTime > 0 ? Math.round(wordCount / (totalTime / 1000 / 60)) : 0,
    ])
    .filter(([, value]) => Number.isFinite(value) && value > 0)
  // 正确率 = 字符数合计 /（字符数合计 + 错误次数）
  const accuracyRecord: [string, number][] = entries
    .map<[string, number]>(([date, { charLength, wrongCount }]) => {
      const denominator = charLength + wrongCount
      return [date, denominator > 0 ? Math.round((charLength / denominator) * 100) : 0]
    })
    .filter(([, value]) => Number.isFinite(value) && value > 0)

  return { exerciseRecord, wordRecord, wpmRecord, accuracyRecord, wrongTimeRecord: toWrongKeyStats(wrongKeys) }
}
