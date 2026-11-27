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

// 切小檔只是省流量: 字型檔壞掉 / 讀不到 site-shell.css 時只 warn, 那頁照舊用共用切片, 不能把整個 build 擋下來
test.describe('page-fonts 出錯時降級, 不擋 build', () => {
  const PAGE = '<html><head><title>t</title></head><body><p>海</p></body></html>';
  const FACES = "@font-face { font-family: 'openhuninn'; src: url('/fonts/openhuninn/oh-00.woff2') format('woff2'); font-display: swap; unicode-range: U+21-7E; }\n"
    + "@font-face { font-family: 'openhuninn'; src: url('/fonts/openhuninn/oh-01.woff2') format('woff2'); font-display: swap; unicode-range: U+6D77; }\n";

  async function run(setup: (tmp: string) => Promise<void>) {
    const { mkdtemp, mkdir, writeFile, readFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const { default: pageFonts } = await import('../src/integrations/page-fonts.mjs');
    const tmp = await mkdtemp(join(tmpdir(), 'page-fonts-'));
    await mkdir(join(tmp, 'dist/year/2026'), { recursive: true });
    await writeFile(join(tmp, 'dist/year/2026/index.html'), PAGE);
    await setup(tmp);
    const warns: string[] = [];
    const logger = { warn: (m: string) => warns.push(m), info: () => {} };
    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      await pageFonts({ pages: ['year'] }).hooks['astro:build:done']({ dir: pathToFileURL(join(tmp, 'dist') + '/'), logger } as never);
    } finally { process.chdir(cwd); }
    return { warns, html: await readFile(join(tmp, 'dist/year/2026/index.html'), 'utf-8') };
  }

  test('切片字型壞掉: 不丟錯、HTML 不動', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { warns, html } = await run(async (tmp) => {
      await mkdir(join(tmp, 'public/css'), { recursive: true });
      await mkdir(join(tmp, 'public/fonts/openhuninn'), { recursive: true });
      await writeFile(join(tmp, 'public/css/site-shell.css'), FACES);
      await writeFile(join(tmp, 'public/fonts/openhuninn/oh-01.woff2'), 'not a font');
    });
    expect(html).toBe(PAGE);
    expect(warns.join('\n')).toContain('共用切片');
  });

  test('讀不到 site-shell.css: 不丟錯、HTML 不動', async () => {
    const { warns, html } = await run(async () => {});
    expect(html).toBe(PAGE);
    expect(warns.length).toBeGreaterThan(0);
  });
});
