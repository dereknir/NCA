import { test, expect } from '@playwright/test';

// 加到主畫面 (N14): manifest 齊全、service worker 註冊得起來、斷線時看過的頁還打得開、資料檔不進快取。
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

test.describe('service worker', () => {
  test.skip(({ browserName }) => browserName !== 'chromium');

  test('斷線時看過的頁還打得開, 資料檔不快取', async ({ page, context }) => {
    await context.addInitScript(() => { (window as any).__swTest = true; });
    await page.goto('/translations/');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    // 第一次載入時頁面還沒被 SW 接管, 重新整理一次讓它經過 SW 進快取
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    // 少打斜線的網址 (Vercel 上會轉址) 經過 SW 也要打得開
    const r = await page.goto('/gacha');
    expect(r?.ok()).toBe(true);
    await page.goto('/about/');
    const title = await page.title();

    await context.setOffline(true);
    await page.goto('/about/');
    expect(await page.title()).toBe(title);
    // 沒看過的頁: 退回首頁 (不是瀏覽器的斷線恐龍)
    const res = await page.goto('/setlists/');
    expect(res?.ok()).toBe(true);
    await context.setOffline(false);

    const keys = await page.evaluate(async () => {
      const out: string[] = [];
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
      return out;
    });
    expect(keys).toContain('/about/');
    expect(keys.filter((k) => k.endsWith('.json'))).toEqual([]);
    expect(keys.filter((k) => k.startsWith('/annotate/'))).toEqual([]);
  });
});
