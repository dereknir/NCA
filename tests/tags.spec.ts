import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// 歌曲標籤頁: 總覽分三組、18 個主題各有一頁、歌曲頁的 # 主題連得過去。
// 外站一律擋掉 (跟 smoke.spec.ts 一樣, 不吃網路)。

const taxonomy = JSON.parse(readFileSync('src/data/song_tags.json', 'utf-8')) as {
  themes: { name: string; slug: string }[];
  genres: { name: string; slug: string }[];
};

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.fulfill({ status: 204, body: '' }));
});

test('標籤總覽: 主題 / 曲風 / 合作與出處三段', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const res = await page.goto('/translations/tags/');
  expect(res?.status()).toBe(200);
  await expect(page.locator('h1').first()).toBeVisible();
  for (const h of ['主題', '曲風', '合作與出處']) {
    await expect(page.getByRole('heading', { level: 2, name: h, exact: true })).toBeVisible();
  }
  // 18 個主題, 每個都至少 2 首
  const cards = page.locator('.tg-theme');
  await expect(cards).toHaveCount(taxonomy.themes.length);
  for (const n of await cards.locator('.n').allTextContents()) {
    expect(parseInt(n, 10)).toBeGreaterThanOrEqual(2);
  }
  await expect(page.locator('.tg-chip')).toHaveCount(taxonomy.genres.length);
  await expect(page.locator('.tg-credits dt', { hasText: 'feat' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('每個主題頁都有歌, 點進去是那首歌', async ({ page }) => {
  for (const t of taxonomy.themes) {
    const res = await page.goto(`/translations/tags/${t.slug}/`);
    expect(res?.status(), t.slug).toBe(200);
    await expect(page.locator('h1').first()).toContainText(t.name);
    expect(await page.locator('[data-tag-songs] a').count(), t.slug).toBeGreaterThanOrEqual(2);
  }
  await page.goto('/translations/tags/night/');
  const first = page.locator('[data-tag-songs] a').first();
  const href = await first.getAttribute('href');
  await first.click();
  await expect(page).toHaveURL(new RegExp(`${href}/?$`));
});

test('歌曲頁: 主題標籤連到主題頁, 舊的零散標籤不見了', async ({ page }) => {
  await page.goto('/translations/nishina-darling/');
  const facts = page.locator('.sh-facts');
  await expect(facts.locator('a[href="/translations/tags/dark/"]')).toContainText('黑暗美學');
  await expect(facts.locator('a[href="/translations/tags/farewell/"]')).toContainText('分手・告別');
  await expect(facts).not.toContainText('同居分手');
  await facts.locator('a[href="/translations/tags/dark/"]').click();
  await expect(page).toHaveURL(/\/translations\/tags\/dark\/$/);
  await expect(page.locator('[data-tag-songs] a[href="/translations/nishina-darling"]')).toBeVisible();
});
