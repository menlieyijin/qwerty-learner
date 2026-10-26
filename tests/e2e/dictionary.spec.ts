import { dictEntry, dismissPromoIfPresent, galleryRadio, openGallery } from './utils'
import { expect, test } from '@playwright/test'

/**
 * 词库管理用例。
 *
 * v9.10（Batch6 / dsh）对齐当前 UI：
 *   - v7 起「按章节背单词」下线，默认是「自动进阶（按词汇水平）」；首页入口显示当前级别，
 *     点击进入词库画廊 `/gallery`，在画廊里选词库会自动切到「手动选择」模式。
 *   - 原用例里的 `getByText('CET-4')`（首页）、`词典切换`、`第 N 章`/`章节切换` 都已不存在
 *     （章节流程已删除 → 对应用例标 skip 并写明原因）。
 */
test.describe('Dictionary manage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // v9.6：StarCard 已从源码删除，本地构建里没有「关闭提示」，存在才点（见 ./utils）
    await dismissPromoIfPresent(page)
  })

  test('Homepage shows current level/dictionary entry with tooltip', async ({ page }) => {
    const entry = dictEntry(page)
    await expect(entry).toBeVisible()

    // 悬停提示会说明当前模式（自动进阶：按词汇水平循序渐进…点击可切换词库）
    await entry.hover()
    await expect(page.getByText(/点击可切换词库/).first()).toBeVisible()
  })

  test('Switch language', async ({ page }) => {
    await openGallery(page)

    await expect(galleryRadio(page, /^英语$/)).toHaveAttribute('aria-checked', 'true')

    await galleryRadio(page, /^日语$/).click()
    await expect(galleryRadio(page, /^日语$/)).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText(/词 · 已学/).first()).toBeVisible()

    await galleryRadio(page, /^Code$/).click()
    await expect(galleryRadio(page, /^Code$/)).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText(/词 · 已学/).first()).toBeVisible()
  })

  test('Switch category', async ({ page }) => {
    await openGallery(page)

    // 默认分类就是「大学英语」，列表里应有 CET-4 卡片（卡片名/描述/词数是三个独立节点，只能按名字定位）
    await expect(galleryRadio(page, /^大学英语$/)).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText('CET-4', { exact: true }).first()).toBeVisible()

    await galleryRadio(page, /^考研$/).click()
    await expect(galleryRadio(page, /^考研$/)).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText(/词 · 已学/).first()).toBeVisible()

    await galleryRadio(page, /^GRE$/).click()
    await expect(galleryRadio(page, /^GRE$/)).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText(/词 · 已学/).first()).toBeVisible()
  })

  test('Switch dictionary', async ({ page }) => {
    await openGallery(page)

    // 选词库卡片（点卡片里的词库名即可，事件冒泡到卡片）→ 回首页并切换为「手动选择」模式
    await page.getByText('CET-4', { exact: true }).first().click()
    await expect(page).toHaveURL(/#\/$/)
    await expect(dictEntry(page)).toContainText('CET-4')

    await dictEntry(page).hover()
    await expect(page.getByText(/点击可切换词库|切换词库（点击词库将改为手动选择）/).first()).toBeVisible()
  })

  test('Close dictionary settings', async ({ page }) => {
    await openGallery(page)

    // 画廊右上角的关闭图标（v9.x 使用 IconX，class 带 absolute right-20 top-10）
    await page.locator('svg[class*="right-20"]').first().click()
    await expect(page).toHaveURL(/#\/$/)
    await expect(dictEntry(page)).toBeVisible()
  })

  test('Switch dictionary chapter', async () => {
    // v7 起已下线「按章节练习」：源码里 `第 N 章` / `章节切换` 均 0 命中，
    // 本用例的前提（章节列表 + 章节切换菜单）不存在，且新流程没有对应语义 → skip，不伪造通过。
    test.skip(true, '章节练习流程已在 v7 下线（无 第 N 章 / 章节切换 UI），用例前提不存在')
  })
})
