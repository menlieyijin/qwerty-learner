import { db } from '@/utils/db'
import { useEffect, useState } from 'react'

/** 词库卡片进度：当前词库已学词数（来自记忆曲线记录） */
export function useMemoryDictStats(dictID: string, isVisible: boolean) {
  const [learnedCount, setLearnedCount] = useState<number | null>(null)
  useEffect(() => {
    if (!isVisible) return
    let cancelled = false
    db.memoryRecords
      .where('dict')
      .equals(dictID)
      .count()
      .then((count) => {
        if (!cancelled) setLearnedCount(count)
      })
      .catch(() => {
        if (!cancelled) setLearnedCount(0)
      })
    return () => {
      cancelled = true
    }
  }, [dictID, isVisible])
  return learnedCount
}
