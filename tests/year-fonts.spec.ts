import { test, expect } from '@playwright/test';

// 年度回顧的粉圓 (N49): build 時 src/integrations/page-fonts.mjs 照這頁印出來的字, 從共用切片切出自己的小檔
// (/fonts/openhuninn/page/<hash>.woff2)。這頁只該抓共用第 0 片 + 自己的小檔。
// 以前一頁抓 12 片粉圓、字型 849 KB; 改完 484 KB。多抓共用切片 = 小檔漏收了頁面上的字 (pageText 沒抓到)。
// 字型上限照 perf-budget 的算法: 現況 × 1.12 進位到 10。
const FONT_KB = 550;

test('年度回顧只抓第 0 片粉圓 + 自己的小檔', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route('**/*', (r) => (r.request().url().startsWith(origin) ? r.continue() : r.abort('blockedbyclient')));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const reqs = new Map<string, { url?: string; type?: string; bytes?: number }>();
  cdp.on('Network.responseReceived', (e) => reqs.set(e.requestId, { ...reqs.get(e.requestId), url: e.response.url, type: e.type }));
  cdp.on('Network.loadingFinished', (e) => reqs.set(e.requestId, { ...reqs.get(e.requestId), bytes: e.encodedDataLength }));

  await page.goto('/year/2026/', { waitUntil: 'load' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);

  const fonts = [...reqs.values()].filter((r) => r.type === 'Font' && r.bytes != null && r.url?.startsWith(origin));
  const paths = fonts.map((r) => new URL(r.url!).pathname);
  const shared = paths.filter((p) => /^\/fonts\/openhuninn\/oh-\d+\.woff2$/.test(p));
  expect(shared, '共用粉圓切片只該剩第 0 片').toEqual(['/fonts/openhuninn/oh-00.woff2']);
  expect(paths.some((p) => p.startsWith('/fonts/openhuninn/page/')), '這頁自己的粉圓小檔').toBe(true);
  const kb = fonts.reduce((n, r) => n + r.bytes!, 0) / 1024;
  expect(kb, `字型總量 ${kb.toFixed(1)} KB`).toBeLessThan(FONT_KB);
});
