import { test, expect } from '@playwright/test';

// 效能預算: 每頁實際傳輸的 JS / 字型 / 總量 (KB) + CLS。
// 只算本站 (127.0.0.1) 的請求, 外部網域 (Google Fonts、YouTube 縮圖…) 直接擋掉不算。
// 量法跟 N10 基準一樣: CDP Network.loadingFinished 的 encodedDataLength (實際上線的 bytes)。
// 不用 Lighthouse, 純 Playwright, 跑在既有 E2E 裡。
//
// 兩層:
//   hard   = CI 硬上限, 超過就紅。字型 / 總量 = 現況 × ~1.12 (進位到 10)。
//            為什麼不直接用報告的數字: 歌詞 md 一推, refresh-lyric-data 就重切字型子集,
//            新歌多幾十個漢字字型就 +40 KB 左右 (試過 60 個新漢字: わをん 1007 → 1047)。
//            上限貼著現況的話 develop 很快就紅, 而那不是退化。12% 吃得下正常的字集成長, 真的退化 (多載一整包字型、多一支大 JS) 還是會擋。
//   target = N10 報告訂的目標值。超過只在 log + test annotations 提醒, 不擋 CI。
// JS 不會因為內容變多而長, hard 直接用現況 + ~5 KB。CLS 是頁面本身的問題, hard 就是目標。
// 修好一項就收緊一項 (字型瘦身完把 font / total 的 hard 降到新的現況 × 1.12; 降到 target 以下就可以把 hard 改成 target)。
//
// 註: playwright.config 的 mobile project 只模擬 viewport 390 + touch, UA 還是桌機 Chrome;
// 站上如果之後依 UA 分流 (例如給手機不同的字型), 這裡量不到。

type Limits = { js: number; font: number; total: number; cls: number };
type Budget = { path: string; hard: Limits; target: Limits };

// N10 報告: JS ≤35 (歌詞宇宙 110)、字型 ≤1050 歌詞頁 / 680 其他、總量 ≤1200 歌詞頁 / 800 其他、CLS ≤0.05
const TARGET_OTHER: Limits = { js: 35, font: 680, total: 800, cls: 0.05 };
const TARGET_LYRIC: Limits = { js: 35, font: 1050, total: 1200, cls: 0.05 };

const budget = (path: string, hard: Limits, target = TARGET_OTHER): Budget => ({ path, hard, target });

// 單位 KB。行尾 = 2026-11 現況 (桌機 / 手機取大的): js / font / total / cls
export const BUDGETS: Record<string, Budget> = {
  // CLS 見下面 HOME_CLS 的說明
  home: budget('/',                              { js: 28,  font: 340,  total: 580,  cls: 0.05 }), // 23.6 / 298 / 438~516 / 0
  translations: budget('/translations/',                 { js: 21,  font: 630,  total: 770,  cls: 0.05 }), // 16.3 / 557 / 683 / 0
  // 歌詞頁字型含自己放的 DotGothic16 (N25, 168 KB; 以前從 Google Fonts 載, 外部請求這裡擋掉不算)。
  // 粉圓改成「第 0 片 + 每首歌自己的小檔」(N17) 之後: わをん 1175 → 758、真白 1103 → 755, 上限照 × 1.12 收緊。
  'song-wawon': budget('/translations/nishina-wawon/',   { js: 35,  font: 850,  total: 1000, cls: 0.05 }, TARGET_LYRIC), // 30.8 / 758 / 894 / 0
  'song-mashiro': budget('/translations/nishina-mashiro/', { js: 35,  font: 850,  total: 1000, cls: 0.05 }, TARGET_LYRIC), // 30.8 / 755 / 890 / 0
  live: budget('/live/',                         { js: 18,  font: 630,  total: 690,  cls: 0.05 }), // 13.1 / 557 / 610 / 0
  'live-full': budget('/live/full/nishina-1999/',       { js: 24,  font: 670,  total: 730,  cls: 0.05 }), // 19.1 / 591 / 651 / 0
  setlists: budget('/setlists/',                     { js: 15,  font: 630,  total: 810,  cls: 0.05 }), // 10.5 / 557 / 722 / 0
  about: budget('/about/',                        { js: 15,  font: 720,  total: 770,  cls: 0.05 }), // 10.5 / 636 / 681 / 0
  // 作品集已經超過 target (N10 基準時 596 / 742): 頁面字變多 → 要載的 oh-* 字型分包跟著變多。字型瘦身後拉回來。
  projects: budget('/projects/',                     { js: 15,  font: 810,  total: 970,  cls: 0.05 }), // 10.5 / 715 / 861 / 0
  // CLS 以前桌機 0.079: 天體 canvas 的 left/top 要等第一個 rAF frame() 才設, 在那之前先被排版在 (0,0)。
  // 現在 script 結尾先 placeBodies() 一次, 第一次排版就在定位上。剩下的是行星每幀公轉 (left/top) 的零頭。
  galaxy: budget('/galaxy/',                       { js: 5,   font: 460,  total: 500,  cls: 0.05 }), // 0 / 409 / 439 / 0.001
  kwic: budget('/kwic/',                         { js: 15,  font: 420,  total: 590,  cls: 0.05 }), // 10.5 / 370 / 524 / 0
  // d3 只留這頁用到的部分 (力導向 + 拖曳 + select + max): JS 102 → 23 KB
  'lyric-universe': budget('/lyric-universe/',               { js: 28,  font: 420,  total: 490,  cls: 0.05 }), // 22.9 / 370 / 437 / 0
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
    // CLS 照 web-vitals 的定義: layout-shift 分 session window (跟前一筆間隔 <1s、整個視窗 ≤5s), 取最大的那個視窗。
    // 每筆順便記下是哪些元素動了, 超標時印出來。
    await page.addInitScript(() => {
      const w = window as any;
      w.__clsMax = { value: 0, entries: [] };
      let cur = { value: 0, entries: [] as any[] };
      let first = 0, last = 0;
      const sel = (n: any) => {
        if (!n || !n.nodeName) return '?';
        const cls = typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
        return n.nodeName.toLowerCase() + (n.id ? '#' + n.id : '') + cls;
      };
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as any[]) {
          if (e.hadRecentInput) continue;
          if (cur.entries.length && (e.startTime - last >= 1000 || e.startTime - first >= 5000)) cur = { value: 0, entries: [] };
          if (!cur.entries.length) first = e.startTime;
          last = e.startTime;
          cur.value += e.value;
          cur.entries.push({ t: Math.round(e.startTime), v: +e.value.toFixed(4), src: (e.sources || []).map((x: any) => sel(x.node)) });
          if (cur.value > w.__clsMax.value) w.__clsMax = { value: cur.value, entries: cur.entries.slice() };
        }
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
    const clsWin: { value: number; entries: { t: number; v: number; src: string[] }[] } = await page.evaluate(
      () => (window as any).__clsMax,
    );
    const cls = clsWin.value;

    const kb = { js: 0, font: 0, total: 0 };
    const own: { url: string; bytes: number }[] = [];
    for (const r of reqs.values()) {
      if (r.bytes == null || !r.url?.startsWith(origin)) continue;
      const k = kindOf(r.url, r.type ?? '', r.mime ?? '');
      if (k !== 'other') kb[k] += r.bytes / 1024;
      kb.total += r.bytes / 1024;
      own.push({ url: r.url.slice(origin.length), bytes: r.bytes });
    }

    const got = { js: +kb.js.toFixed(1), font: +kb.font.toFixed(1), total: +kb.total.toFixed(1), cls: +cls.toFixed(3) };
    testInfo.annotations.push({ type: 'perf', description: JSON.stringify(got) });
    console.log(`[perf] ${testInfo.project.name} ${name} js=${got.js}KB font=${got.font}KB total=${got.total}KB cls=${got.cls}`);

    const unit = (k: keyof Limits) => (k === 'cls' ? '' : ' KB');
    const keys = ['js', 'font', 'total', 'cls'] as const;

    // 超過 target: 只提醒
    const soft = keys.filter((k) => got[k] > b.target[k] && got[k] <= b.hard[k]);
    for (const k of soft) {
      const msg = `${name} ${b.path} ${k} ${got[k]}${unit(k)} 超過目標 ${b.target[k]}${unit(k)} (硬上限 ${b.hard[k]}${unit(k)})`;
      testInfo.annotations.push({ type: 'perf-target', description: msg });
      console.warn(`[perf] ⚠ ${testInfo.project.name} ${msg}`);
    }

    // 超過 hard: 紅, 附上最大的請求 / CLS 來源
    const over = keys.filter((k) => got[k] > b.hard[k]);
    const lines = over.map((k) => `${name} ${b.path} ${k} ${got[k]}${unit(k)} / 上限 ${b.hard[k]}${unit(k)} (目標 ${b.target[k]}${unit(k)})`);
    if (over.some((k) => k !== 'cls')) {
      lines.push('最大的 5 個請求:');
      for (const r of own.sort((x, y) => y.bytes - x.bytes).slice(0, 5)) lines.push(`  ${(r.bytes / 1024).toFixed(1)} KB  ${r.url}`);
    }
    if (over.includes('cls')) {
      lines.push('CLS 最大視窗裡的 layout-shift (時間 ms / 值 / 元素):');
      for (const e of clsWin.entries.slice(0, 10)) lines.push(`  ${e.t}ms  ${e.v}  ${e.src.join(', ')}`);
    }

    // 同一個字型檔不該抓兩次 (例如兩組 @font-face 指到同一檔、preload 跟 @font-face 的 crossorigin 對不上)
    const fontUrls = [...reqs.values()]
      .filter((r) => r.bytes != null && r.url?.startsWith(origin) && kindOf(r.url, r.type ?? '', r.mime ?? '') === 'font')
      .map((r) => r.url!.slice(origin.length));
    const dup = fontUrls.filter((u, i) => fontUrls.indexOf(u) !== i);
    expect.soft(dup, `${name} ${b.path} 字型重複下載: ${[...new Set(dup)].join(', ')}`).toEqual([]);

    expect(over, `超出效能預算:\n${lines.join('\n')}`).toEqual([]);
  });
}
