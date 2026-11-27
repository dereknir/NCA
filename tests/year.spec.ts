import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

// 年度回顧: 分享圖卡要指到真的存在的檔案; 頁面上的數字要跟資料 (也是 og-pages.mjs 畫圖卡用的同一份) 算出來的一樣
const json = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));
const Y = '2026';
const stops = json('live/data/tour_stops.json').tours.flatMap((t: any) => t.stops).filter((s: any) => s.date.startsWith(Y)).length;
const fests = json('live/data/nishina_live_events.json').appearance.filter((a: any) => (a.event_date ?? '').startsWith(Y)).length;
const translated = Object.values(json('src/data/translation_dates.json') as Record<string, any>)
  .filter((d) => (d.translated ?? '').startsWith(Y)).length;

test('年度回顧 2026: 分享圖卡與數字', async ({ page }) => {
  await page.goto(`/year/${Y}/`);
  const og = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(og).toContain(`/og/year-${Y}.png`);
  expect(existsSync(`public/og/year-${Y}.png`)).toBe(true);
  const nums = (await page.locator('.yr-n').allTextContents()).map((n) => parseInt(n.replace(/,/g, ''), 10));
  expect(nums.length).toBeGreaterThanOrEqual(5);
  expect(nums[0]).toBe(stops);
  expect(nums[1]).toBe(fests);
  expect(nums).toContain(translated);
  await expect(page.getByText('MOCK')).toHaveCount(0);
  await expect(page.getByText('模型')).toHaveCount(0);
});
