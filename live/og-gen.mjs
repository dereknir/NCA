/**
 * og-gen.mjs — 三個 live 頁的 OG 分享圖(像素風,1200×630 = 基底 240×126 ×5)
 * 用法: node og-gen.mjs  → og/timeline.png, og/concerts.png, og/footprint.png
 * 整合(Claude Code):og/ 部署到站上,三頁 <head> 加
 *   <meta property="og:image" content="https://<site>/og/<page>.png">
 *   <meta name="twitter:card" content="summary_large_image">
 * 資料更新後與 inject.py 一起重跑。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';

const W = 240, H = 126, SCALE = 5;
const P = { bg: [10, 10, 21], deep: [30, 42, 74], accent: [61, 99, 255], dim: [139, 152, 184],
            light: [158, 180, 255], text: [242, 244, 250], gold: [232, 201, 74] };
const CAT = { LIVE: [58, 169, 129], RELEASE: [226, 96, 58], TIEUP: [138, 99, 201],
              COLLAB: [225, 81, 142], GOODS: [239, 159, 39], OTHER: [124, 141, 181] };

const events = JSON.parse(readFileSync('data/nishina_live_events.json', 'utf-8'));
const tours = JSON.parse(readFileSync('data/tour_stops.json', 'utf-8'));
const news = JSON.parse(readFileSync('data/nishina_news_classified.json', 'utf-8'));
const japan = JSON.parse(readFileSync('data/japan_paths.json', 'utf-8'));
// GEO 規則直接取自 footprint 模板,口徑保證一致
const tpl = readFileSync('footprint.template.html', 'utf-8');
const GEO = [...tpl.match(/const GEO = \[([\s\S]*?)\];/)[1]
  .matchAll(/\['([^']+)','([^']+)'\]/g)].map(m => [m[1], m[2]]);

const litPrefs = new Set(tours.tours.flatMap(t => t.stops.map(s => s.pref)));
for (const ev of events.appearance) {
  const src = ev.name + ' ' + (ev.venue || '');
  const hit = GEO.find(([k]) => src.includes(k));
  if (hit) litPrefs.add(hit[1]);
}
const nStops = tours.tours.reduce((n, t) => n + t.stops.length, 0);

const fonts = [
  { name: 'JP12', data: readFileSync('fonts/fusion-pixel-12px-proportional-ja.ttf'), weight: 400, style: 'normal' },
  { name: 'TC12', data: readFileSync('fonts/fusion-pixel-12px-proportional-zh_hant.ttf'), weight: 400, style: 'normal' },
];

function baseBuffer(seed) {
  const buf = new Uint8Array(W * H * 3);
  const px = (x, y, c) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; };
  const rect = (x, y, w, h, c) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) px(i, j, c); };
  rect(0, 0, W, H, P.bg);
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 130; i++) {
    const x = (rnd() * W) | 0, y = (rnd() * H) | 0, r = rnd();
    px(x, y, r < .5 ? P.dim : r < .86 ? P.light : P.gold);
  }
  const fr = (x, y, w, h, c, t) => { rect(x, y, w, t, c); rect(x, y + h - t, w, t, c); rect(x, y, t, h, c); rect(x + w - t, y, t, h, c); };
  fr(2, 2, W - 4, H - 4, P.accent, 2);
  rect(2, H - 5, W - 4, 3, P.accent);
  return { buf, px, rect };
}

const h = (type, style, ...children) => ({
  type, props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0] : children } });
const t = (str, x, y, size, fam, c) =>
  h('div', { position: 'absolute', left: x + 'px', top: y + 'px', fontSize: size + 'px',
             fontFamily: fam, color: `rgb(${c[0]},${c[1]},${c[2]})` }, str);

async function render(name, drawExtra, texts) {
  const { buf, px, rect } = baseBuffer(name.length * 7919 + 20210625);
  drawExtra && drawExtra(px, rect);
  const bgPng = await sharp(Buffer.from(buf), { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  const svg = await satori(
    h('div', { width: W + 'px', height: H + 'px', position: 'relative', fontFamily: 'JP12' }, ...texts),
    { width: W, height: H, fonts });
  const raw = new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
  const ti = await sharp(Buffer.from(raw)).ensureAlpha().raw().toBuffer();
  for (let i = 3; i < ti.length; i += 4) ti[i] = ti[i] >= 128 ? 255 : 0;
  const textPng = await sharp(ti, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  const out = await sharp(bgPng).composite([{ input: textPng }])
    .resize(W * SCALE, H * SCALE, { kernel: 'nearest' }).png().toBuffer();
  writeFileSync(`og/${name}.png`, out);
  console.log(`✓ og/${name}.png(${(out.length / 1024).toFixed(0)}KB)`);
}

mkdirSync('og', { recursive: true });

// ---- timeline ----
const catCounts = {};
for (const i of news) catCounts[i.class] = (catCounts[i.class] || 0) + 1;
await render('timeline',
  (px, rect) => {
    let x = 14;
    for (const [k, c] of Object.entries(CAT)) {
      rect(x, 96, 5, 5, c);
      x += 34;
    }
  },
  [
    t('にしな', 12, 10, 12, 'JP12', P.dim),
    t('年表', 14, 30, 24, 'JP12', P.gold),
    t('2021-2026・NEWS 119件', 14, 62, 12, 'JP12', P.text),
    t('公演・発行・媒體・合作の全記録', 14, 78, 12, 'TC12', P.dim),
    ...Object.entries(CAT).map(([k], i) =>
      t(String(catCounts[k] || 0), 22 + i * 34, 92, 12, 'JP12', P.dim)),
  ]);

// ---- concerts ----
await render('concerts', null, [
  t('にしな', 12, 10, 12, 'JP12', P.dim),
  t('公演史', 14, 30, 24, 'JP12', P.gold),
  t('10 TOURS・' + nStops + ' STOPS', 14, 62, 12, 'JP12', P.text),
  t('hatsu(2021) → 日々散漫(2026)', 14, 80, 12, 'JP12', P.dim),
  t('SETLIST・参戦記録', 14, 98, 12, 'TC12', P.dim),
]);

// ---- footprint(右側迷你日本) ----
await render('footprint',
  (px, rect) => {
    const sc = 0.115, ox = 148, oy = 8;
    for (const [name, pp] of Object.entries(japan.prefs)) {
      const x = ox + Math.round(pp.cx * sc), y = oy + Math.round(pp.cy * sc);
      if (litPrefs.has(name)) { rect(x - 1, y - 1, 3, 3, P.gold); px(x, y - 2, P.light); }
      else px(x, y, P.deep);
    }
  },
  [
    t('にしな', 12, 10, 12, 'JP12', P.dim),
    t('出演足跡', 14, 30, 24, 'JP12', P.gold),
    t('67場・' + nStops + '站', 14, 62, 12, 'TC12', P.text),
    t(litPrefs.size + ' 都道府県', 14, 80, 12, 'JP12', P.light),
    t('2021 → 2026', 14, 98, 12, 'JP12', P.dim),
  ]);
