import type { IMemoryRecord } from './db/record'

/**
 * v8.9：memoryRecords 内存缓存。
 *
 * 以前每次换词都会 db.memoryRecords.toArray()（O(N) 反序列化 + 逐词过滤），
 * 学习记录越多出词越慢。现在只在首次读取时全表加载，之后：
 * - 新增/更新记录时 upsert 单条；
 * - 删除记录时 remove 单条；
 * - 迁移/批量写时 clear，下次读取重新加载。
 */
let cache: IMemoryRecord[] | null = null

export function getMemoryCache(): IMemoryRecord[] | null {
  return cache
}

export function setMemoryCache(list: IMemoryRecord[]): void {
  cache = list
}

export function upsertMemoryCache(rec: IMemoryRecord): void {
  if (!cache) return
  const index = cache.findIndex((item) => item.key === rec.key)
  if (index >= 0) cache[index] = rec
  else cache.push(rec)
}

export function removeMemoryCache(key: string): void {
  if (!cache) return
  const index = cache.findIndex((item) => item.key === key)
  if (index >= 0) cache.splice(index, 1)
}

export function clearMemoryCache(): void {
  cache = null
}
