/**
 * 「随机回顾」标记：到期词之外被抽中复习的已学词。
 * 答对时只刷新记忆、不延长间隔；答错则按答错处理（回到 10 分钟档）。
 *
 * v8.9：
 * - 标记加 30 分钟 TTL，过期自动忽略（避免「标记后没答、下次正常答对却被当成回顾」导致档位冻结、永远到期）；
 * - 换词库/换模式/新会话时由调用方 clearRefreshMarks() 清理；
 * - key 统一由 memoryKey() 生成，避免 trim/大小写不一致。
 */
const REFRESH_TTL_MS = 30 * 60 * 1000
const marks = new Map<string, number>()

function prune(now: number): void {
  marks.forEach((ts, key) => {
    if (now - ts > REFRESH_TTL_MS) marks.delete(key)
  })
}

export function markRefresh(key: string): void {
  const now = Date.now()
  if (marks.size > 200) prune(now)
  marks.set(key, now)
}

export function consumeRefresh(key: string): boolean {
  const ts = marks.get(key)
  if (ts === undefined) return false
  marks.delete(key)
  return Date.now() - ts <= REFRESH_TTL_MS
}

export function clearRefreshMarks(): void {
  marks.clear()
}
