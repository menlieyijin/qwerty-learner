import type { groupedWordRecords } from '../type'
import { db } from '@/utils/db'
import { useEffect, useState } from 'react'

/**
 * 读错题本分组（v9.16，dsh 从 `ErrorBook/index.tsx` 抽出）。
 *
 * 行为与原实现逐行一致：只查 `wrongCount > 0` 的记录，按 dict+word 用 Map 分组
 * （原先是 `groups.find` 的 O(n·m)，v9.14 已改 Map，这里保持），
 * 并区分「加载中 / 加载失败 / 空」三种状态，避免数据库异常时永久空白。
 *
 * @param reload 传入一个会变化的值即可触发重新读取（调用方用布尔翻转）
 */
export function useGroupedWrongRecords(reload: boolean): {
  groupedRecords: groupedWordRecords[]
  isLoading: boolean
  loadError: boolean
} {
  const [groupedRecords, setGroupedRecords] = useState<groupedWordRecords[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setLoadError(false)

    db.wordRecords
      .where('wrongCount')
      .above(0)
      .toArray()
      .then((records) => {
        if (cancelled) return
        const groups: groupedWordRecords[] = []
        // key 用 \u0000 分隔，避免 dict+word 直接拼接撞键。插入顺序与结果集合不变。
        const groupMap = new Map<string, groupedWordRecords>()

        records.forEach((record) => {
          const key = `${record.dict}\u0000${record.word}`
          let group = groupMap.get(key)
          if (!group) {
            group = { word: record.word, dict: record.dict, records: [], wrongCount: 0 }
            groupMap.set(key, group)
            groups.push(group)
          }
          group.records.push(record)
        })

        groups.forEach((group) => {
          group.wrongCount = group.records.reduce((acc, cur) => {
            acc += cur.wrongCount
            return acc
          }, 0)
        })

        setGroupedRecords(groups)
      })
      .catch((error) => {
        if (cancelled) return
        // IndexedDB 打不开/查询失败时给出可重试的错误态，而不是静默空白
        console.error('错题本读取失败：', error)
        setLoadError(true)
        setGroupedRecords([])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [reload])

  return { groupedRecords, isLoading, loadError }
}
