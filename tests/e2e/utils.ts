import type { Page } from '@playwright/test'

/**
 * 关闭首页右上角的「收藏我们」提示卡（StarCard）。
 *
 * 背景（v9.6 / dsh）：`src/components/StarCard/**` 已作为死代码在 v9.5 清理中删除
 * （它从 v7 起就没有任何 import 点，只有 e2e 还在依赖它的 `aria-label="关闭提示"`）。
 * 因此：
 *   - 打线上站点（默认 baseURL）时该提示卡仍然存在 → 正常点击关闭，行为与历史一致；
 *   - 打本地构建（QZ_E2E_BASE_URL=http://127.0.0.1:3000）时该按钮不存在 →
 *     直接跳过，避免 4 个 spec 的 beforeEach 全部 30s 超时。
 *
 * @returns 是否点到了该按钮（便于后续排查）
 */
export async function dismissPromoIfPresent(page: Page): Promise<boolean> {
  const closeButton = page.getByLabel('关闭提示')
  if ((await closeButton.count()) === 0) return false
  await closeButton.first().click()
  return true
}
