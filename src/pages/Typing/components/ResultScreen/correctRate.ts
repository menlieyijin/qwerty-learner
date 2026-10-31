/**
 * 结果页正确率（v10.4，dsh，F5-005 收尾）。
 *
 * 抽成纯函数的原因：原先它写在 `ResultScreen` 的 `useMemo` 里，空词表时 `0/0 = NaN`
 * 只能在页面里复现，而「空词表进结果页」这条路径在正常使用中几乎走不到，
 * 于是这个边界既没有自动化断言、也没人敢改。抽出来之后可以直接在 node 里断言。
 *
 * 约定（已写入发布说明）：没有词就没有「正确率」可言，按 0% 处理。
 */

/** 正确率：0~100 的整数百分比；`chapterLength <= 0` 时返回 0（不是 NaN） */
export function computeCorrectRate(chapterLength: number, wrongWordCount: number): number {
  if (!Number.isFinite(chapterLength) || chapterLength <= 0) return 0
  const wrong = Number.isFinite(wrongWordCount) ? wrongWordCount : 0
  const correctCount = chapterLength - wrong
  // 脏数据（wrong 大于词数 / 负数）不应产生负数或 >100 的百分比：结果页只认 0~100
  const rate = Math.floor((correctCount / chapterLength) * 100)
  return Math.min(100, Math.max(0, rate))
}

/** 结果页的「错误分级」：>=85 绿、>=70 黄、其余红（与原实现的分档逐字一致） */
export function mistakeLevelOf(correctRate: number): 0 | 1 | 2 {
  if (correctRate >= 85) return 0
  if (correctRate >= 70) return 1
  return 2
}
