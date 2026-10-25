/**
 * 「随机回顾」标记：到期词之外被抽中复习的已学词。
 * 答对时只刷新记忆、不延长间隔；答错则按答错处理（回到 10 分钟档）。
 */
const refreshKeys = new Set<string>()

export function markRefresh(key: string): void {
  refreshKeys.add(key)
}

export function consumeRefresh(key: string): boolean {
  return refreshKeys.delete(key)
}

export function clearRefreshMarks(): void {
  refreshKeys.clear()
}
