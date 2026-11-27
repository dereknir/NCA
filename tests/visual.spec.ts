import { test, expect } from '@playwright/test';

// 視覺回歸: 幾個主要頁面的第一屏, 桌機 1440 / 手機 390 各存一張基準圖。
//
// 改了版面、確定新畫面是對的 → 更新基準:
//   npm run build && npx playwright test tests/visual.spec.ts --update-snapshots
// 基準圖在 tests/visual.spec.ts-snapshots/。

const PAGES: [string, string][] = [
  ['home', '/'],
  ['translations', '/translations/'],
  ['song-wawon', '/translations/nishina-wawon/'],
  ['live', '/live/'],
  ['about', '/about/'],
];

// /live/ 的數字、下一場、雷達點是排程自動抓的資料, 每天都可能變 → 遮掉, 只看版面
const MASK: Record<string, string[]> = {
  live: ['.sh-chip', '.lr-box', '.hub-num'],
};

// 固定時間 (首頁房間的今日の一曲 / 月曆 / 鬧鐘看日期畫) + 固定亂數 (星星位置)
const FIXED_TIME = new Date('2026-11-20T21:30:00+08:00');

for (const [name, path] of PAGES) {
  test(`visual ${name}`, async ({ page, context }) => {
    // 外部請求 (Google Fonts、YouTube 縮圖) 擋掉, 只看本站
    await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
    await page.clock.setFixedTime(FIXED_TIME);
    await page.addInitScript(() => {
      let s = 20261120;
      Math.random = () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
      };
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.goto(path, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot(`${name}.png`, {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.01,
      mask: (MASK[name] ?? []).map((sel) => page.locator(sel)),
    });
  });
}
