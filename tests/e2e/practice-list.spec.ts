import { dismissPromoIfPresent } from './utils'
import { expect, test } from '@playwright/test'

test.describe('Practice List', () => {
  test.beforeEach(async ({ page }) => {
    test.slow()
    await page.goto('/')
    // v9.6：StarCard 已从源码删除，本地构建里没有「关闭提示」，存在才点（见 ./utils）
    await dismissPromoIfPresent(page)
    await page.waitForTimeout(1000)

    // should use testId
    await page.locator('#root > div').locator('.fixed').locator('svg').last().click()
    await page.waitForTimeout(1000)
  })

  test('Practice list button click to open the list ', async ({ page }) => {
    await expect(await page.getByRole('heading', { name: 'CET-4 第 1 章' }).isVisible()).toBeTruthy()
    // should use testId
    await page.locator('#headlessui-portal-root').locator('div > p', { hasText: 'cancel' }).click()
  })

  test('Close practice list', async ({ page }) => {
    await page.getByRole('heading', { name: 'CET-4 第 1 章' }).getByRole('img').click()
    await page.waitForTimeout(1000)
    await expect(await page.locator('h3', { hasText: 'CET-4 第 1 章' }).isVisible()).not.toBeTruthy()
  })
})
