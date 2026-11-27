import { test, expect, type Page } from '@playwright/test';

// 粉圓每首歌一個小檔 (N17): 歌詞頁只該抓共用第 0 片 + 這首歌自己的 doc/<歌>.woff2,
// 不再為了零散的罕見字抓十幾片共用切片。檔案跟 index.json 由 scripts/build_pixel_fonts.py 產生。

const SONGS = ['nishina-wawon', 'nishina-mashiro', 'nishina-1999'];

function watchOpenhuninn(page: Page) {
  const got: string[] = [];
  page.on('requestfinished', (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith('/fonts/openhuninn/')) got.push(p);
  });
  return got;
}

for (const id of SONGS) {
  test(`粉圓每首歌一個小檔: ${id}`, async ({ page }) => {
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
    const got = watchOpenhuninn(page);
    await page.goto(`/translations/${id}/`, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.evaluate(() => document.fonts.ready);

    expect(got).toContain(`/fonts/openhuninn/doc/${id}.woff2`);
    // 共用切片應該只剩第 0 片。多抓好幾片 = 這首歌的小檔漏收了頁面上的字 (build_pixel_fonts.py 的 OH_SONG_PAGE)。
    // 留 1 片的空間: 巡演 setlist 自己更新 (不會重切字型) 時, 新巡演名的字可能暫時落在別片, 下次重切就回來
    expect(got.filter((p) => /\/oh-\d+\.woff2$/.test(p) && !p.endsWith('/oh-00.woff2')).length).toBeLessThanOrEqual(1);
  });
}

test('換頁 (ClientRouter) 之後換成下一首歌自己的小檔', async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
  await page.goto('/translations/nishina-wawon/', { waitUntil: 'load' });
  const link = page.locator('a.tr-adj').first();
  const href = await link.getAttribute('href');
  const next = href!.replace(/\/$/, '').split('/').pop()!;
  const got = watchOpenhuninn(page);
  await link.click();
  await page.waitForURL(new RegExp(`/translations/${next}/?$`));
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);

  expect(got).toContain(`/fonts/openhuninn/doc/${next}.woff2`);
  // 上一首的 @font-face 跟著舊頁面一起拿掉, 不會留著蓋掉這首的字
  const srcs = await page.evaluate(() =>
    [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').filter((t) => t.includes('/fonts/openhuninn/doc/')),
  );
  expect(srcs.join('\n')).toContain(`/doc/${next}.woff2`);
  expect(srcs.join('\n')).not.toContain('/doc/nishina-wawon.woff2');
});
