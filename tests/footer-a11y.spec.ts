import { test, expect, type Page } from '@playwright/test';

// 頁尾狀態列與指令列按鈕: 版權字不跟圖示疊、開過指令列頁尾不會變寬、按鈕名稱包含畫面上的字
test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.fulfill({ status: 204, body: '' }));
});

const overlap = (page: Page) => page.evaluate(() => {
  const a = document.querySelector('.sf-copy')!.getBoundingClientRect(), b = document.querySelector('.sf-ico')!.getBoundingClientRect();
  const sameRow = a.bottom > b.top && a.top < b.bottom;
  return sameRow ? Math.max(0, a.right - b.left) : 0;
});

test('有網域多一顆 RSS 時, 版權字也不疊在圖示上 (390 寬)', async ({ page, isMobile }) => {
  test.skip(!isMobile, '手機寬度');
  await page.goto('/about/');
  await page.waitForTimeout(1000);
  // 沒設 SITE_URL 的 build 沒有 RSS: 照 RSS 的樣子補一顆再重算
  await page.evaluate(() => {
    const ico = document.querySelector('.sf-ico')!, a = ico.querySelector('a')!.cloneNode(true) as HTMLElement;
    a.setAttribute('aria-label', 'RSS'); ico.prepend(a); dispatchEvent(new Event('resize'));
  });
  expect(await overlap(page)).toBe(0);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(390);
});

test('打開指令列時改視窗大小, 關掉後頁尾不會變寬', async ({ page, isMobile }) => {
  test.skip(isMobile, '桌機的指令列');
  await page.goto('/about/');
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /guest@nishina/ }).click();
  await expect(page.locator('.sh-cli.open')).toBeVisible();
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sh-cli.open')).toHaveCount(0);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(1400);
  expect(await overlap(page)).toBe(0);
});

test('指令列按鈕的名稱包含畫面上的字', async ({ page, isMobile }) => {
  await page.goto('/about/');
  const name = isMobile ? /^N247i/ : /^guest@nishina/;
  await expect(page.getByRole('button', { name })).toBeVisible();
});
