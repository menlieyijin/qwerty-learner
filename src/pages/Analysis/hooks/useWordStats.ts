import { db } from '@/utils/db'
import type { IWordRecord } from '@/utils/db/record'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import type { Activity } from 'react-activity-calendar'

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
  // 只有单个字符才需要大小写归一；多字符键名（Backspace/Enter 等）保持原样便于阅读
  return key.length === 1 ? key.toUpperCase() : key
}

/** 键盘图可映射的键：A-Z */
export function isMappableKeyboardKey(key: string): boolean {
  return /^[A-Z]$/.test(key)
}

/**
 * PAGES-008：把 mistakes 里的原始按键聚合为全量统计。
 * 旧实现只保留 A-Z（且对 ' ' 之外的多字符键做了 toUpperCase），空格/数字/标点等真实高频错误
 * 在柱状图与热力图中被静默丢弃；这里保留全量键，排序后由图表决定展示方式。
 */
export function buildWrongKeyStats(rawKeys: readonly string[]): WrongKeyStat[] {
  const counter = new Map<string, number>()
  for (const rawKey of rawKeys) {
    const key = normalizeWrongKey(rawKey)
    if (!key) continue
    counter.set(key, (counter.get(key) ?? 0) + 1)
  }

  return Array.from(counter.entries())
    .map(([key, value]) => ({
      key,
      label: key === ' ' ? SPACE_KEY_LABEL : key,
      value,
      mappable: isMappableKeyboardKey(key),
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
}

interface IWordStats {
  isEmpty?: boolean
  exerciseRecord: Activity[]
  wordRecord: Activity[]
  wpmRecord: [string, number][]
  accuracyRecord: [string, number][]
  wrongTimeRecord: WrongKeyStat[]
}

// 获取两个日期之间的所有日期，使用dayjs计算
function getDatesBetween(start: number, end: number) {
  const dates = []
  let curr = dayjs(start).startOf('day')
  const last = dayjs(end).endOf('day')

  while (curr.diff(last) < 0) {
    dates.push(curr.clone().format('YYYY-MM-DD'))
    curr = curr.add(1, 'day')
  }

  return dates
}

function getLevel(value: number) {
  if (value === 0) return 0
  else if (value < 4) return 1
  else if (value < 8) return 2
  else if (value < 12) return 3
  else return 4
}

export function useWordStats(startTimeStamp: number, endTimeStamp: number) {
  const [wordStats, setWordStats] = useState<IWordStats>({
    exerciseRecord: [],
    wordRecord: [],
    wpmRecord: [],
    accuracyRecord: [],
    wrongTimeRecord: [],
  })
  // v9.14（dsh，M4-003）：区分「没有数据」与「读取失败」；此前无 catch，失败会被渲染成空热力图
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    // v9.14（dsh，M4-003）：区间变化时丢弃过期查询的结果，避免乱序返回的旧结果覆盖新结果
    let cancelled = false
    setHasError(false)

    const fetchWordStats = async () => {
      try {
        const stats = await getChapterStats(startTimeStamp, endTimeStamp)
        if (cancelled) return
        setWordStats(stats)
      } catch (error) {
        if (cancelled) return
        console.error('统计读取失败：', error)
        setHasError(true)
      }
    }

    fetchWordStats()

    return () => {
      cancelled = true
    }
  }, [startTimeStamp, endTimeStamp])

  return { ...wordStats, hasError }
}

async function getChapterStats(startTimeStamp: number, endTimeStamp: number): Promise<IWordStats> {
  // indexedDB查找某个数字范围内的数据
  const records: IWordRecord[] = await db.wordRecords.where('timeStamp').between(startTimeStamp, endTimeStamp).toArray()

  if (records.length === 0) {
    return { isEmpty: true, exerciseRecord: [], wordRecord: [], wpmRecord: [], accuracyRecord: [], wrongTimeRecord: [] }
  }

  let data: {
    [x: string]: {
      exerciseTime: number //练习次数
      words: string[] //练习词数组（不去重）
      totalTime: number //总计用时
      wrongCount: number //错误次数
      wrongKeys: string[] //按错的按键
    }
  } = {}

  const dates = getDatesBetween(startTimeStamp * 1000, endTimeStamp * 1000)
  data = dates
    .map((date) => ({ [date]: { exerciseTime: 0, words: [], totalTime: 0, wrongCount: 0, wrongKeys: [] } }))
    .reduce((acc, curr) => ({ ...acc, ...curr }), {})

  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    // v9.14（dsh，M4-003）：备份导入路径不校验列，旧备份可能缺 timeStamp/word/timing/mistakes；
    // 逐条容错跳过脏记录，避免一条坏数据让整页统计抛 TypeError。
    if (!record || typeof record.word !== 'string' || !record.word) continue
    if (typeof record.timeStamp !== 'number' || !Number.isFinite(record.timeStamp)) continue
    const date = dayjs(record.timeStamp * 1000).format('YYYY-MM-DD')
    const bucket = data[date]
    if (!bucket) continue

    bucket.exerciseTime += 1
    bucket.words = [...bucket.words, record.word]
    const timing = Array.isArray(record.timing) ? record.timing : []
    bucket.totalTime += timing.reduce((acc, curr) => acc + (Number(curr) || 0), 0)
    bucket.wrongCount += Number(record.wrongCount) || 0
    bucket.wrongKeys = [...bucket.wrongKeys, ...Object.values(record.mistakes ?? {}).flat()]
  }

  const RecordArray = Object.entries(data)

  // 练习次数统计
  const exerciseRecord: IWordStats['exerciseRecord'] = RecordArray.map(([date, { exerciseTime }]) => ({
    date,
    count: exerciseTime,
    level: getLevel(exerciseTime),
  }))
  // 练习词数统计（去重）
  const wordRecord: IWordStats['wordRecord'] = RecordArray.map(([date, { words }]) => ({
    date,
    count: Array.from(new Set(words)).length,
    level: getLevel(Array.from(new Set(words)).length),
  }))
  // wpm=练习词数（不去重）/总时间
  // PAGES-007：totalTime 为 0（timing 全 0/空、导入数据）时不能产生 Infinity/NaN 进入图表
  const wpmRecord: IWordStats['wpmRecord'] = RecordArray.map<[string, number]>(([date, { words, totalTime }]) => [
    date,
    totalTime > 0 ? Math.round(words.length / (totalTime / 1000 / 60)) : 0,
  ]).filter(([, value]) => Number.isFinite(value) && value > 0)
  // 正确率=每个单词的长度合计/(每个单词的长度合计+总错误次数)
  const accuracyRecord: IWordStats['accuracyRecord'] = RecordArray.map<[string, number]>(([date, { words, wrongCount }]) => {
    const totalChars = words.join('').length
    const denominator = totalChars + wrongCount
    return [date, denominator > 0 ? Math.round((totalChars / denominator) * 100) : 0]
  }).filter(([, value]) => Number.isFinite(value) && value > 0)
  // 错误键统计（PAGES-008）：保留全量原始按键（大小写合并，空格/数字/标点/特殊键均保留），
  // 展示层再区分是否可映射到键盘图，避免空格/数字等高频错误被静默丢弃。
  const allWrongTime = RecordArray.flatMap(([, { wrongKeys }]) => wrongKeys)
  const wrongTimeRecord = buildWrongKeyStats(allWrongTime)

  return { exerciseRecord, wordRecord, wpmRecord, accuracyRecord, wrongTimeRecord }
}
