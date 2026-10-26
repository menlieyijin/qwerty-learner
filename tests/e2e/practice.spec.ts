import { dismissPromoIfPresent, readCurrentWord, typeWord, waitForNextWord } from './utils'
import { expect, test } from '@playwright/test'

/**
 * 练习主流程用例。
 *
 * v9.10（Batch6 / dsh）对齐当前 UI：
 *   - 起始提示仍为「按任意键开始 / 继续」（WordPanel 渲染），按 Enter 或任意字母即开始；
 *   - 词表不再固定为 CET-4 第 1 章的 cancel/explosive…（v7 起按记忆曲线动态出词），
 *     所以用例改为「从 DOM 读出当前词再输入」，不再硬编码单词；
 *   - 练习中的「输入数 / 正确数 / 正确率」HUD 与「第 N 章 / 下一章节」流程已下线，
 *     对应用例标 skip 并写明原因（不伪造通过）。
 */
test.describe('Practice', () => {
  test.beforeEach(async ({ page }) => {
    test.slow()
    await page.goto('/')
    // v9.6：StarCard 已从源码删除，本地构建里没有「关闭提示」，存在才点（见 ./utils）
    await dismissPromoIfPresent(page)
  })

  test('Press any key to start', async ({ page }) => {
    await expect(page.getByText('按任意键开始').first()).toBeVisible()

    await page.keyboard.press('Enter')
    await expect(page.getByText('按任意键开始').first()).toBeHidden()
  })

  test('Enter the correct word, should advance to next word', async ({ page }) => {
    await page.keyboard.press('Enter')
    const word = await readCurrentWord(page)
    expect(word.length).toBeGreaterThan(0)

    await typeWord(page, word)

    // 整词答对后自动出下一词
    const next = await waitForNextWord(page, word)
    expect(next.length).toBeGreaterThan(0)
    expect(next).not.toBe(word)
  })

  test('Enter the correct letter, should show green color', async ({ page }) => {
    await page.keyboard.press('Enter')
    const word = await readCurrentWord(page)
    expect(word.length).toBeGreaterThan(0)

    await page.keyboard.press(word[0])
    await expect(page.locator('span.font-mono').first()).toHaveClass(/text-green-600/)
  })

  test('Enter the wrong letter, should show red color then reset', async ({ page }) => {
    await page.keyboard.press('Enter')
    const word = await readCurrentWord(page)
    expect(word.length).toBeGreaterThan(0)

    const wrongKey = word[0].toLowerCase() === 'z' ? 'x' : 'z'
    await page.keyboard.press(wrongKey)

    await expect(page.locator('span.font-mono').first()).toHaveClass(/text-red-600/)
    // 输错后 Word 组件自动清空输入并把字母恢复常态
    await expect(page.locator('span.font-mono').first()).toHaveClass(/text-gray-600/, { timeout: 5000 })
  })

  test('Enter the wrong word (HUD counters removed)', async () => {
    // 「输入数 / 正确数 / 正确率」这一类练习中 HUD 已随 v9 重做下线：
    // grep 源码 `输入数`、`正确数` 均 0 命中（正确率只剩结果页/统计页）。
    // 原用例的断言对象不存在，且没有等价的当前 UI → skip，不伪造通过。
    test.skip(true, '练习中 HUD（输入数/正确数）已下线，无等价断言对象')
  })

  test('Complete the exercises for 1 chapter, enter the next chapter', async () => {
    // v7 起改为「按记忆曲线动态出词」，没有固定章节词表、没有「下一章节」「表现不错！全对了！」：
    // grep `第 1 章`、`下一章节`、`表现不错` 均 0 命中 → skip，不伪造通过。
    test.skip(true, '章节流程已下线（动态出词，无固定章节词表与下一章节）')
  })
})
