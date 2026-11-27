import { test, expect } from '@playwright/test';

// 手機點擊區至少 24px (WCAG 2.5.8)。11/27 用 390 寬把 20 頁掃一遍找到的: 宇宙頁彗星卡的 ✕ 只有 11×15,
// 左上「← Derek's Site」只有 15 高。(kwic 勾選框在整個 label 裡、公演史「U+」那行只有它一個連結, 不算)

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.fulfill({ status: 204, body: '' }));
});

test('/galaxy/ 彗星卡 ✕ 與回首頁連結夠大, ✕ 有名稱、按了會收起', async ({ page }) => {
  await page.goto('/galaxy/');
  const card = page.locator('#cometCard');
  await card.evaluate((el) => el.classList.add('show'));
  const x = card.locator('.cc-x');
  await expect(x).toHaveAccessibleName('收起');
  const xb = (await x.boundingBox())!;
  expect(Math.min(xb.width, xb.height)).toBeGreaterThanOrEqual(24);
  // ✕ 不能蓋到卡片標題的字
  await card.locator('.cc-n').evaluate((el) => { el.textContent = 'ほうき星 長い名前のテストですよ'; });
  const textRight = await card.locator('.cc-n').evaluate((el) => {
    const r = document.createRange(); r.selectNodeContents(el);
    return Math.max(...[...r.getClientRects()].map((q) => q.right));
  });
  expect(textRight).toBeLessThanOrEqual(xb.x + 1);
  await x.click();
  await expect(card).not.toHaveClass(/show/);

  const back = page.locator('#title a[href="/"]');
  const bb = (await back.boundingBox())!;
  expect(bb.height).toBeGreaterThanOrEqual(24);
});
