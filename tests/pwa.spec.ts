import { test, expect, type Page } from '@playwright/test';

// 加到主畫面 (N14): manifest 齊全、service worker 規則 (見 public/sw.js)。
// 本機 127.0.0.1 平常不註冊 SW (免得其他測試吃到快取), 這裡用 __swTest 打開。

test('manifest 與圖示', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/manifest.webmanifest');
  const m = await (await request.get(href!)).json();
  expect(m.display).toBe('standalone');
  expect(m.start_url).toBe('/');
  const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  for (const i of m.icons) expect((await request.get(i.src)).ok()).toBe(true);
});

const cached = (page: Page) => page.evaluate(async () => {
  const out: string[] = [];
  for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
  return out;
});

async function withSW(page: Page, url: string) {
  await page.context().addInitScript(() => { (window as any).__swTest = true; });
  await page.goto(url);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();   // 第一次載入還沒被 SW 接管
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test.describe('service worker', () => {
  test('斷線: 看過的頁打得開 (含少斜線), 沒看過的給離線頁 503', async ({ page, context }) => {
    await withSW(page, '/about/');
    const title = await page.title();
    await expect.poll(async () => (await cached(page)).includes('/about/')).toBe(true);

    await context.setOffline(true);
    await page.goto('/about/');
    expect(await page.title()).toBe(title);
    await page.goto('/about');
    expect(await page.title()).toBe(title);
    const res = await page.goto('/setlists/');
    expect(res?.status()).toBe(503);
    await expect(page.getByRole('heading', { name: '目前離線' })).toBeVisible();
    await context.setOffline(false);
  });

  test('翻譯頁圈內 (ClientRouter 換頁) 看過的頁也存下來', async ({ page, context }) => {
    await withSW(page, '/translations/nishina-wawon/');
    const link = page.locator('main a[href^="/translations/nishina-"]:not([href*="wawon"])').first();
    const href = (await link.getAttribute('href'))!;
    const key = href.endsWith('/') ? href : href + '/';
    await link.click();
    await expect.poll(() => new URL(page.url()).pathname.replace(/\/?$/, '/')).toBe(key);
    await expect.poll(async () => (await cached(page)).includes(key)).toBe(true);
    const title = await page.title();
    await context.setOffline(true);
    await page.goto(key);
    expect(await page.title()).toBe(title);
    await context.setOffline(false);
  });

  test('資料檔、標注工具、404 不進快取; css 部署後馬上拿新版', async ({ page }) => {
    await withSW(page, '/');
    await page.evaluate(async () => {
      await fetch('/site-index.json');
      await fetch('/annotate/');
      await fetch('/no-such-page-xyz/');
    });
    await page.goto('/no-such-page-xyz/');
    await page.goto('/');
    await page.waitForTimeout(300);
    const keys = await cached(page);
    expect(keys.filter((k) => k.endsWith('.json'))).toEqual([]);
    expect(keys.filter((k) => k.startsWith('/annotate/'))).toEqual([]);
    expect(keys).not.toContain('/no-such-page-xyz/');
    // 未 hash 的 css: 先走網路 → 回應要跟伺服器上的一樣, 不是快取的舊版
    const css = await page.evaluate(async () => {
      const c = await caches.open('shell-v1');
      await c.put('/css/site-shell.css', new Response('/* stale */', { headers: { 'content-type': 'text/css' } }));
      return (await fetch('/css/site-shell.css')).text();
    });
    expect(css).not.toBe('/* stale */');
  });
});
