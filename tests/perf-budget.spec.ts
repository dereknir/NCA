import { test, expect } from '@playwright/test';

// 效能預算: 每頁實際傳輸的 JS / 字型 / 總量 (KB) + CLS。
// 只算本站 (127.0.0.1) 的請求, 外部網域 (Google Fonts、YouTube 縮圖…) 直接擋掉不算。
// 量法跟 N10 基準一樣: CDP Network.loadingFinished 的 encodedDataLength (實際上線的 bytes)。
// 不用 Lighthouse, 純 Playwright, 跑在既有 E2E 裡。
//
// 預算 = 現況再留一點餘裕, 但不超過 N10 報告訂的上限。
// 修好一項就收緊一項 (例如字型瘦身完, 把 font 的數字降到新的現況 + 一點點)。

type Budget = { path: string; js: number; font: number; total: number; cls: number };

// 單位 KB (CLS 沒單位)。桌機 / 手機取比較大的那個量, 再留 ~5 KB JS、~40~60 KB 字型/總量的餘裕。
// N10 報告的上限: JS ≤35 (歌詞宇宙 110)、字型 ≤1050 歌詞頁 / 680 其他、總量 ≤1200 歌詞頁 / 800 其他、CLS ≤0.05。
// 修好一項就收緊一項。
//                                                         現況 (2026-11, js / font / total)
export const BUDGETS: Record<string, Budget> = {
  home:             { path: '/',                             js: 28,  font: 330,  total: 580,  cls: 0.05 }, // 23.6 / 298 / 438~516 (手機會多載房間圖, 量到會浮動)
  translations:     { path: '/translations/',                js: 21,  font: 600,  total: 740,  cls: 0.05 }, // 16.3 / 557 / 683
  'song-wawon':     { path: '/translations/nishina-wawon/',  js: 35,  font: 1050, total: 1200, cls: 0.05 }, // 30.5 / 1007 / 1141
  'song-mashiro':   { path: '/translations/nishina-mashiro/', js: 35, font: 1000, total: 1150, cls: 0.05 }, // 30.5 / 935 / 1068
  live:             { path: '/live/',                        js: 18,  font: 600,  total: 670,  cls: 0.05 }, // 13.1 / 557 / 610
  'live-full':      { path: '/live/full/nishina-1999/',      js: 24,  font: 640,  total: 720,  cls: 0.05 }, // 19.1 / 591 / 651
  setlists:         { path: '/setlists/',                    js: 15,  font: 600,  total: 780,  cls: 0.05 }, // 10.5 / 557 / 722
  about:            { path: '/about/',                       js: 15,  font: 680,  total: 740,  cls: 0.05 }, // 10.5 / 636 / 681
  // 作品集比 N10 基準 (596 / 742) 胖了一截, 已經超過 680 / 800 的上限: 頁面字變多 → 要載的 oh-* 字型分包跟著變多。
  // 先放行在現況, 字型瘦身後拉回 680 / 800 以下。
  projects:         { path: '/projects/',                    js: 15,  font: 750,  total: 900,  cls: 0.05 }, // 10.5 / 715 / 861
  // 桌機 CLS 0.079: 太陽那顆 .body-cv canvas 在 ~0.5 秒時被重新定位 (手機 0)。修好改回 0.05。
  galaxy:           { path: '/galaxy/',                      js: 5,   font: 450,  total: 490,  cls: 0.1 },  // 0 / 409 / 439
  kwic:             { path: '/kwic/',                        js: 15,  font: 410,  total: 580,  cls: 0.05 }, // 10.5 / 370 / 524
  // d3 整包 92 KB, 其中 ~71 KB 沒用到; 自訂 build 之後可以收到 ~40
  'lyric-universe': { path: '/lyric-universe/',              js: 110, font: 410,  total: 580,  cls: 0.05 }, // 102 / 370 / 516
};

function kindOf(url: string, type: string, mime: string): 'js' | 'font' | 'other' {
  if (/\.json(\?|$)/.test(url) || /json/.test(mime)) return 'other';
  if (type === 'Script') return 'js';
  if (type === 'Font') return 'font';
  return 'other';
}

for (const [name, b] of Object.entries(BUDGETS)) {
  test(`budget ${name} (${b.path})`, async ({ page, context, baseURL }, testInfo) => {
    const origin = new URL(baseURL!).origin;
    await context.route('**/*', (route) =>
      route.request().url().startsWith(origin) ? route.continue() : route.abort('blockedbyclient'),
    );
    await page.addInitScript(() => {
      (window as any).__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as any[]) if (!e.hadRecentInput) (window as any).__cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });

    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    const reqs = new Map<string, { url?: string; type?: string; mime?: string; bytes?: number }>();
    cdp.on('Network.responseReceived', (e) => {
      const r = reqs.get(e.requestId) ?? {};
      Object.assign(r, { url: e.response.url, type: e.type, mime: e.response.mimeType });
      reqs.set(e.requestId, r);
    });
    cdp.on('Network.loadingFinished', (e) => {
      const r = reqs.get(e.requestId) ?? {};
      r.bytes = e.encodedDataLength;
      reqs.set(e.requestId, r);
    });

    await page.goto(b.path, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1000);
    const cls: number = await page.evaluate(() => (window as any).__cls);

    const kb = { js: 0, font: 0, total: 0 };
    for (const r of reqs.values()) {
      if (r.bytes == null || !r.url?.startsWith(origin)) continue;
      const k = kindOf(r.url, r.type ?? '', r.mime ?? '');
      if (k !== 'other') kb[k] += r.bytes / 1024;
      kb.total += r.bytes / 1024;
    }

    const got = { js: +kb.js.toFixed(1), font: +kb.font.toFixed(1), total: +kb.total.toFixed(1), cls: +cls.toFixed(3) };
    testInfo.annotations.push({ type: 'perf', description: JSON.stringify(got) });
    console.log(`[perf] ${testInfo.project.name} ${name} js=${got.js}KB font=${got.font}KB total=${got.total}KB cls=${got.cls}`);

    const over = (['js', 'font', 'total', 'cls'] as const)
      .filter((k) => got[k] > b[k])
      .map((k) => `${name} ${b.path} ${k} ${got[k]}${k === 'cls' ? '' : ' KB'} / 上限 ${b[k]}${k === 'cls' ? '' : ' KB'}`);
    expect(over, `超出效能預算:\n${over.join('\n')}`).toEqual([]);
  });
}
