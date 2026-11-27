import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';

// 年度回顧: 分享圖卡要指到真的存在的檔案, 數字卡片都要有東西
test('年度回顧 2026: 分享圖卡與數字', async ({ page }) => {
  await page.goto('/year/2026/');
  const og = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(og).toContain('/og/year-2026.png');
  expect(existsSync('public/og/year-2026.png')).toBe(true);
  const cards = page.locator('.yr-card');
  expect(await cards.count()).toBeGreaterThanOrEqual(8);
  for (const n of await page.locator('.yr-n').allTextContents()) expect(n).toMatch(/^\d[\d,]*/);
  await expect(page.getByText('MOCK')).toHaveCount(0);
});
