import { expect, test } from '@playwright/test'

/**
 * 视觉回归基线（v10.4，dsh）。
 *
 * 背景：v10.2.1 全仓跑了一次 prettier（含 prettier-plugin-tailwindcss 的 class 排序），
 * 那次只有 DOM/行为断言兜底，没有像素级验证 —— 这是当时明确记录的「残余风险」。
 * 这个 spec 把它变成可检测项：
 *
 *   生成/重建基线：npx playwright test visual.spec.ts --project=chromium --update-snapshots
 *   日常回归校验：npm run test:visual
 *
 * 只截**静态页面**，原因写在下面（这是跑出来的结论，不是想当然）：
 * - 错题本空态：无随机内容，最稳；
 * - 设置面板（音效设置）：纯静态表单，开关状态来自默认配置；
 * - **练习页不截**：当前词随机、计时/进度每秒变，即使 mask 掉词与数字仍有 ~1% 像素抖动
 *   （实测 1916 px / ratio 0.01），会持续误报。练习页的正确性由 test:typing 的行为断言覆盖。
 *
 * 注意：基线是「本机 + Chromium + 本 DPI」的产物；换机器/改系统缩放会整体漂移，
 * 那时用 --update-snapshots 重建一次即可（基线文件随仓库提交，便于 review 视觉变化）。
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('button[title="打开设置对话框"]', { timeout: 30000 })
  // 首次启动的「词汇起点」弹层会挡住页面，先按「以后再说」关掉（干净 profile 才出现）
  const later = page.getByRole('button', { name: /以后再说|暂不选择/ })
  if ((await later.count()) > 0) {
    await later.first().click()
    await page.waitForTimeout(300)
  }
})

test('错题本（空态）', async ({ page }) => {
  await page.goto('/#/error-book')
  await page.waitForTimeout(900)
  await expect(page).toHaveScreenshot('error-book.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.002,
  })
})

test('设置面板（音效设置）', async ({ page }) => {
  await page.locator('button[title="打开设置对话框"]').click()
  await expect(page.getByRole('tab', { name: '音效设置' })).toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(600)
  await expect(page).toHaveScreenshot('settings-sound.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.002,
  })
})
