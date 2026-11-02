import type { WordStats } from './wordStatsAggregate'
import { aggregateWordRecords } from './wordStatsAggregate'
import { db } from '@/utils/db'
import type { IWordRecord } from '@/utils/db/record'
import { useEffect, useState } from 'react'

// 纯聚合与按键规范化在 `wordStatsAggregate.ts`（v11.6.1 抽出，供单测与性能对照复用）
export { SPACE_KEY_LABEL, buildWrongKeyStats, getLevel, isMappableKeyboardKey, normalizeWrongKey } from './wordStatsAggregate'
export type { WrongKeyStat } from './wordStatsAggregate'

const EMPTY_STATS: WordStats = {
  exerciseRecord: [],
  wordRecord: [],
  wpmRecord: [],
  accuracyRecord: [],
  wrongTimeRecord: [],
}

export function useWordStats(startTimeStamp: number, endTimeStamp: number) {
  const [wordStats, setWordStats] = useState<WordStats>(EMPTY_STATS)
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

async function getChapterStats(startTimeStamp: number, endTimeStamp: number): Promise<WordStats> {
  // indexedDB 查找某个数字范围内的数据；聚合本身是纯函数（见 wordStatsAggregate.ts）
  const records: IWordRecord[] = await db.wordRecords.where('timeStamp').between(startTimeStamp, endTimeStamp).toArray()
  return aggregateWordRecords(records, startTimeStamp, endTimeStamp)
}
