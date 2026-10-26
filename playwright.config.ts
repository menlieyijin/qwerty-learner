import { defineConfig, devices } from '@playwright/test'

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests/e2e',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [['list'], ['html']],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    // 默认打线上站点（历史上的 e2e 就是线上巡检）。
    // v9.6/v9.10（dsh）：支持本地构建验证，用 QZ_E2E_BASE_URL 覆盖即可。
    //   1) 先起本地 dev server（默认端口 5173，注意显式绑 127.0.0.1）：
    //        npm run dev -- --port 5173 --strictPort --host 127.0.0.1
    //   2) 再跑（跨平台，已封装成 npm script）：
    //        npm run test:e2e:local
    //      等价于 QZ_E2E_BASE_URL=http://127.0.0.1:5173 playwright test --project=chromium
    //   3) 首次需要浏览器：npx playwright install chromium
    // 说明：本地模式下 tests/e2e 已对齐当前 UI（v9.10 起）；打线上站点仍按线上 UI 断言，
    //       两者差异见 D:\整理\audit\baseline\e2e-local-result.txt。
    baseURL: process.env.QZ_E2E_BASE_URL || 'https://qwerty.kaiyi.cool',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },
  timeout: 30 * 1000, // default 30s

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://127.0.0.1:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
})
