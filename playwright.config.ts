import { defineConfig, devices } from '@playwright/test';

// 冒煙測試: 對 build 好的 dist/ 起 astro preview, 每頁在桌機 1440 / 手機 390 各開一次。
// 跑法: npm run test:e2e (會先 build)。已經 build 過可以直接 npx playwright test。
// 埠可以用 PW_PORT 換 (同一台機器同時跑好幾份測試時各用各的, 不會打到別人的 preview)。不設就是 4321。
const PORT = Number(process.env.PW_PORT) || 4321;

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
  ],
  webServer: {
    command: `npx astro preview --ignore-lock --host 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
