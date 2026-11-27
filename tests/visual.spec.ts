import { test, expect } from '@playwright/test';

// 視覺回歸: 幾個主要頁面的第一屏, 桌機 1440 / 手機 390 各存一張基準圖。
//
// 改了版面、確定新畫面是對的 → 更新基準:
//   npm run build && npx playwright test tests/visual.spec.ts --update-snapshots
// 基準圖在 tests/visual.spec.ts-snapshots/, 檔名帶平台 (*-linux.png)。
// 只能在 Linux 上更新 (這台或 CI 同款的 ubuntu): 在 Mac 跑會另外產一組 *-darwin.png, CI 不會用到, 也比不到 linux 那組。
// CI 的 ubuntu runner 目前跟本機 Linux 渲染一致 (第一次推上去就全過, 沒有重試)。
//
// mobile project 只模擬 viewport 390 + touch, UA 還是桌機 Chrome (見 playwright.config.ts)。

const PAGES: [string, string][] = [
  ['home', '/'],
  ['translations', '/translations/'],
  ['song-wawon', '/translations/nishina-wawon/'],
  ['live', '/live/'],
  ['about', '/about/'],
];

// /live/ 的數字、下一場、雷達點是排程自動抓的資料, 每天都可能變 → 遮掉, 只看版面
// 關於頁底下 du -h 那張表 (shorts 數、場數、日記數、最近翻譯日期) 一樣會跟著資料變
// 「下一場」那行名稱長短會改變行數、把下面整頁推下去 (手機試過換一個長名稱 → 6% 像素差), 所以截圖時直接拿掉
const HIDE: Record<string, string> = {
  live: '.sh-row:has([data-next-date]) { display: none !important; }',
};
const MASK: Record<string, string[]> = {
  live: ['.sh-facts', '.lr-box', '.hub-num'],
  about: ['.ab-term ul'],
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

    if (HIDE[name]) await page.addStyleTag({ content: HIDE[name] });

    await expect(page).toHaveScreenshot(`${name}.png`, {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.01,
      mask: (MASK[name] ?? []).map((sel) => page.locator(sel)),
    });
  });
}
