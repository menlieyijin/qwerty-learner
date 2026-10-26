import { dismissPromoIfPresent } from './utils'
import { expect, test } from '@playwright/test'

test.describe('Theme switch', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // v9.6：StarCard 已从源码删除，本地构建里没有「关闭提示」，存在才点（见 ./utils）
    await dismissPromoIfPresent(page)
  })

  test('Has theme switch button', async ({ page }) => {
    await expect(await page.getByLabel('开关深色模式').isVisible()).toBeTruthy()
  })

  test('Theme mode switch', async ({ page }) => {
    // light to dark
    await page.getByLabel('开关深色模式').click()
    await expect(await page.locator('html').getAttribute('class')).toBe('dark')

    await page.waitForTimeout(500)

    // dark to light
    await page.getByLabel('开关深色模式').click()
    await expect(await page.locator('html').getAttribute('class')).toBe('')
  })
})
