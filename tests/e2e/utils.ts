import type { Page } from '@playwright/test'

/**
 * 关闭首页右上角的「收藏我们」提示卡（StarCard）。
 *
 * 背景（v9.6 / dsh）：`src/components/StarCard/**` 已作为死代码在 v9.5 清理中删除
 * （它从 v7 起就没有任何 import 点，只有 e2e 还在依赖它的 `aria-label="关闭提示"`）。
 * 因此：
 *   - 打线上站点（默认 baseURL）时该提示卡仍然存在 → 正常点击关闭，行为与历史一致；
 *   - 打本地构建（QZ_E2E_BASE_URL=http://127.0.0.1:5173）时该按钮不存在 →
 *     直接跳过，避免 4 个 spec 的 beforeEach 全部超时。
 *
 * @returns 是否点到了该按钮（便于后续排查）
 */
export async function dismissPromoIfPresent(page: Page): Promise<boolean> {
  const closeButton = page.getByLabel('关闭提示')
  if ((await closeButton.count()) === 0) return false
  await closeButton.first().click()
  return true
}

/** 首页词库/水平入口（v9.x：自动进阶显示当前级别，点击进入词库画廊） */
export function dictEntry(page: Page) {
  return page.locator('a[href="#/gallery"]').first()
}

/** 进入词库画廊 */
export async function openGallery(page: Page) {
  await dictEntry(page).click()
  await page.waitForTimeout(600)
}

/** 画廊里的语言/分类切换按钮（radix ToggleGroup，role=radio） */
export function galleryRadio(page: Page, text: string | RegExp) {
  return page.getByRole('radio').filter({ hasText: text }).first()
}

/**
 * 读取当前练习单词（v9.x WordPanel 把每个字母渲染成 `span.font-mono`）。
 * 返回按显示顺序拼接的字符串（含空格占位）。
 */
export async function readCurrentWord(page: Page): Promise<string> {
  await page.waitForSelector('span.font-mono', { timeout: 10000 })
  const letters = page.locator('span.font-mono')
  const count = await letters.count()
  const chars: string[] = []
  for (let i = 0; i < count; i++) {
    const t = (await letters.nth(i).innerText()).trim()
    if (t.length === 1) chars.push(t)
  }
  return chars.join('')
}

/** 逐字母输入一个单词（空格用 Space） */
export async function typeWord(page: Page, word: string) {
  for (const ch of word) {
    if (ch === ' ') await page.keyboard.press('Space')
    else await page.keyboard.press(ch)
    await page.waitForTimeout(20)
  }
}

/** 等当前单词变成新词（用于断言「答完自动出下一词」） */
export async function waitForNextWord(page: Page, previous: string, timeout = 10000): Promise<string> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const current = await readCurrentWord(page)
    if (current && current !== previous) return current
    await page.waitForTimeout(150)
  }
  return readCurrentWord(page)
}
