import { test, expect } from '@playwright/test';

// 縮小版的圖 (/img/... WebP、歌詞頁播放模式的封面背景) 都要真的載得到, 不能是破圖
test('setlist 巡演封面與作品集封面用 WebP 縮圖且載得到', async ({ page }) => {
  for (const url of ['/setlists/', '/projects/', '/projects/rpu-system/']) {
    await page.goto(url);
    const imgs = page.locator('img[src^="/img/"]');
    expect(await imgs.count(), `${url} 應該有 /img/ 縮圖`).toBeGreaterThan(0);
    for (const img of await imgs.all()) {
      await img.scrollIntoViewIfNeeded();
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), { message: `${url} ${await img.getAttribute('src')}` }).toBe(true);
    }
  }
});

test('作品集分享圖維持原本的 jpg (社群平台不一定吃 WebP)', async ({ page }) => {
  await page.goto('/projects/rpu-system/');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /rpu-cover\.jpg$/);
});

test('播放模式的封面背景用 w448 縮圖', async ({ page, request }) => {
  await page.goto('/translations/nishina-wawon/');
  const src = await page.locator('#live-stage').getAttribute('data-cover-image');
  expect(src).toMatch(/^\/covers\/w448\/.+\.webp$/);
  expect((await request.get(src!)).status()).toBe(200);
});
