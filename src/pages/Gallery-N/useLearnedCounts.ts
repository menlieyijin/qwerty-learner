import { db } from '@/utils/db'
import type { IMemoryRecord } from '@/utils/db/record'
import { canonicalizeMemoryRecords } from '@/utils/memory'
import { getMemoryCache } from '@/utils/memoryCache'
import { useEffect, useMemo, useState } from 'react'

// 内存缓存优先（练习页已加载过全量记录时零 DB 读）；无缓存时读库并短暂复用
let memoryRowsCache: { at: number; promise: Promise<IMemoryRecord[]> } | null = null
function loadMemoryRows(): Promise<IMemoryRecord[]> {
  const cached = getMemoryCache()
  if (cached) return Promise.resolve(cached)
  const now = Date.now()
  if (!memoryRowsCache || now - memoryRowsCache.at > 5000) {
    memoryRowsCache = { at: now, promise: db.memoryRecords.toArray().catch(() => [] as IMemoryRecord[]) }
  }
  return memoryRowsCache.promise
}

/**
 * v9.14（dsh，M4-011）：按词典统计「已学词数」（canonical 去重后）。
 *
 * 旧实现放在每张词库卡片里（`useCanonicalLearnedCount`）：卡片进入视口时各自跑一次全量
 * `canonicalizeMemoryRecords`，一次渲染 20~60 张卡片就是 20~60 次 O(n) 聚合 + Map 分配。
 * 现在提升到词库页只算一次：原始行只读一次，去重规则与计数口径完全不变，
 * 结果按 `records` 记忆（`useMemo`），卡片侧只做一次 Map 查找。
 *
 * 返回 null 表示「尚未读到数据」，卡片据此隐藏「已学 N」（与原实现一致）。
 */
export function useLearnedCounts(): Map<string, number> | null {
  const [rows, setRows] = useState<IMemoryRecord[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadMemoryRows().then((result) => {
      if (!cancelled) setRows(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return useMemo(() => {
    if (!rows) return null
    const counts = new Map<string, number>()
    for (const record of canonicalizeMemoryRecords(rows)) {
      if (!record?.dict) continue
      counts.set(record.dict, (counts.get(record.dict) ?? 0) + 1)
    }
    return counts
  }, [rows])
}
