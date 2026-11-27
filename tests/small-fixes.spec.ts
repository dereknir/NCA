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

test('#9 指令列: 打 / 指令不重複, /live/full 打得開', async ({ page }) => {
  await page.goto('/about/');
  await page.waitForFunction(() => !!(window as any).__shellCli);
  await page.keyboard.press('/');
  const input = page.locator('.sh-cli input');
  await expect(input).toBeFocused();
  await input.fill('/');
  const keys = await page.$$eval('#sh-cli-out a > span:first-child', (s) => s.map((x) => x.textContent!.trim()));
  expect(keys.length).toBeGreaterThan(5);
  expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  expect(keys).toContain('/live');
  expect(keys).toContain('/live/full');

  await input.fill('/live/full');
  await expect(page.locator('#sh-cli-out a').first()).toContainText('/live/full');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/live\/full\/$/);
});

test('#10 /star-map/ 頁首 logo、選單跟其他靜態頁同一個位置', async ({ page }) => {
  const boxes = async (url: string) => {
    await page.goto(url);
    await expect(page.locator('.sh-hd .sh-logo')).toBeVisible();
    return page.evaluate(() => {
      const r = (s: string) => { const b = document.querySelector(s)!.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round); };
      const nav = getComputedStyle(document.querySelector('.sh-burger')!).display === 'none' ? '.sh-nav' : '.sh-burger';
      return { hd: r('.sh-hd'), logo: r('.sh-logo'), nav: r(nav) };
    });
  };
  const ref = await boxes('/kwic/');
  const star = await boxes('/star-map/');
  expect(star).toEqual(ref);
});

test.describe('#11 手機點擊區至少 24px', () => {
  test.skip(({ isMobile }) => !isMobile, '只看手機');

  test('timeline「今日のにしな」的切換圓點', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-27T12:00:00+09:00'));   // 這天有兩則, 會出現圓點
    await page.goto('/live/timeline/');
    const dots = page.locator('#today .dot');
    await expect(dots.first()).toBeVisible();
    expect(await dots.count()).toBeGreaterThan(1);
    for (const b of await dots.all()) {
      const r = (await b.boundingBox())!;
      expect(r.width).toBeGreaterThanOrEqual(24);
      expect(r.height).toBeGreaterThanOrEqual(24);
    }
    await dots.nth(1).click();
    await expect(dots.nth(1)).toHaveClass(/\bon\b/);
  });

  test('完整 Live 的段落', async ({ page }) => {
    await page.goto('/live/full/nishina-bugs/');   // 段落最多、最窄的一場
    const segs = page.locator('.flp-seg');
    await expect(segs.first()).toBeVisible();
    const sizes = await segs.evaluateAll((es) => es.map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(24);
    // 段落沒有擠出軌道
    const over = await page.evaluate(() => { const t = document.querySelector('[data-track]')!; return t.scrollWidth - t.clientWidth; });
    expect(over).toBeLessThanOrEqual(0);
  });

  test('現場熱度條: 點在兩根之間也算點到最近那根', async ({ page }) => {
    await page.goto(SONG);
    const gap = await page.evaluate(() => {
      const bs = [...document.querySelectorAll<HTMLButtonElement>('[data-ll-head] .wv-b')];
      for (let i = 0; i + 1 < bs.length; i++) {
        if (bs[i].disabled || bs[i + 1].disabled) continue;
        const a = bs[i].getBoundingClientRect(), b = bs[i + 1].getBoundingClientRect();
        if (b.left - a.right < 1) continue;
        bs[i].scrollIntoView({ block: 'center' });
        const a2 = bs[i].getBoundingClientRect(), b2 = bs[i + 1].getBoundingClientRect();
        return { x: (a2.right + b2.left) / 2, y: a2.top + a2.height / 2, h: a2.height };
      }
      return null;
    });
    expect(gap).not.toBeNull();
    expect(gap!.h).toBeGreaterThanOrEqual(24);
    await page.mouse.click(gap!.x, gap!.y);
    await expect(page.locator('[data-ll-pop]')).toBeVisible();
  });
});
