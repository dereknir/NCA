import { test, expect, type Page } from '@playwright/test';

// 全站找 bug 清單的 #6 ~ #11, 一個 bug 一個測試守著
// 外部請求一律擋掉 (跟 smoke 一樣), 測試不吃網路
const SONG = '/translations/nishina-wawon/';

async function stubExternal(page: Page) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'font') return route.fulfill({ status: 404, body: '' });
    if (type === 'stylesheet') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (type === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    if (type === 'document') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

test.beforeEach(async ({ page }) => { await stubExternal(page); });

// 點 (x, y) 實際會點到的元素在不在 sel 裡面
const hitInside = (page: Page, x: number, y: number, sel: string) =>
  page.evaluate(([x, y, sel]) => !!document.elementFromPoint(x as number, y as number)?.closest(sel as string), [x, y, sel]);

test('#6 手機: 日文詞小卡、這句的現場小卡蓋在左下角 N247i 按鈕上面', async ({ page, isMobile }) => {
  test.skip(!isMobile, '手機才是底部抽屜');
  await page.goto(SONG);
  const pill = page.locator('.sh-cli-pill');
  await expect(pill).toBeVisible();
  const p = (await pill.boundingBox())!;
  const cx = p.x + p.width / 2, cy = p.y + p.height / 2;

  await page.locator('[data-song-content] .lyrics-line .ja .w').first().click();
  await expect(page.locator('.wcard')).toBeVisible();
  expect(await hitInside(page, cx, cy, '.wcard')).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.wcard')).toBeHidden();

  await page.locator('[data-song-content] .ll-mark').first().click();
  await expect(page.locator('[data-ll-pop]')).toBeVisible();
  expect(await hitInside(page, cx, cy, '[data-ll-pop]')).toBe(true);
});

test('#7 /gacha 沒有斜線也能載入: 腳本、卡池都用絕對路徑', async ({ page }) => {
  const bad: string[] = [];
  page.on('response', (r) => { if (r.url().startsWith('http://127.0.0.1') && r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  page.on('pageerror', (e) => bad.push(`pageerror: ${e.message}`));
  const pool = page.waitForResponse((r) => r.url().endsWith('/gacha/pool.json'));
  await page.goto('/gacha');
  expect((await pool).ok()).toBe(true);
  await page.waitForTimeout(500);
  expect(bad).toEqual([]);
});

test('#8 歌詞列表: 選了專輯點進一首歌, 按上一頁回來篩選還在', async ({ page }) => {
  await page.goto('/translations/');
  const tab = page.locator('[data-song-tabs] button[data-tab]:not([data-tab=""])').nth(1);
  const name = (await tab.getAttribute('data-tab'))!;
  await tab.click();
  await expect(tab).toHaveAttribute('aria-pressed', 'true');
  const row = page.locator(`[data-song-rows] a[data-tab="${name}"]`).first();
  const href = (await row.getAttribute('href'))!;
  await row.click();
  await expect(page).toHaveURL(new RegExp(href + '/?$'));
  await page.goBack();
  await expect(page.locator('[data-song-tabs]')).toBeVisible();
  await expect(page.locator(`[data-song-tabs] button[data-tab="${name}"]`)).toHaveAttribute('aria-pressed', 'true');
  // 別張專輯的歌是藏起來的
  const shown = await page.$$eval('[data-song-rows] a', (as) => [...new Set(as.filter((a) => !(a as HTMLElement).hidden).map((a) => (a as HTMLElement).dataset.tab))]);
  expect(shown).toEqual([name]);
  // 重新整理也還在 (網址帶著)
  await page.reload();
  await expect(page.locator(`[data-song-tabs] button[data-tab="${name}"]`)).toHaveAttribute('aria-pressed', 'true');
});
