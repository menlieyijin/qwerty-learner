import { dismissPromoIfPresent } from './utils'
import { expect, test } from '@playwright/test'

/**
 * 练习词表抽屉（Practice List）用例 —— v9.10（Batch6 / dsh）整体 skip。
 *
 * 原因：该抽屉由 `src/pages/Typing/components/WordList/`（含 WordCard）渲染，
 * 这组组件在 v9.6 的死代码清理中已被删除（删除前全仓 `<WordList`、`WordCard` 只有自身/同目录引用，
 * 可达性脚本判定不可达）。因此：
 *   - 打开抽屉的入口按钮（`#root > div .fixed svg`）不存在；
 *   - 抽屉标题 `CET-4 第 1 章`（章节制）也不存在（v7 起改为记忆曲线动态出词）；
 *   - 抽屉里的词卡（点击 cancel）自然也不存在。
 * 没有等价的当前 UI 可以断言，所以保留文件但整体 skip，写明原因，不伪造通过。
 *
 * 若将来重新引入「本轮词表」抽屉，请给入口和容器加 data-testid（原用例注释里也写着
 * "should use testId"），再把本文件恢复为真实用例。
 */
test.describe.skip('Practice List（UI 已下线：WordList 抽屉在 v9.6 删除）', () => {
  test.beforeEach(async ({ page }) => {
    test.slow()
    await page.goto('/')
    await dismissPromoIfPresent(page)
    await page.waitForTimeout(1000)
  })

  test('Practice list button click to open the list', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /第 1 章/ })).toBeVisible()
  })

  test('Close practice list', async ({ page }) => {
    await expect(page.locator('h3', { hasText: /第 1 章/ })).toBeHidden()
  })
})
