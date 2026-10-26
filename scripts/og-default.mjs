/**
 * og-default.mjs — 全站預設 OG 分享圖 (像素風, 1200×630 = 基底 240×126 ×5)
 *
 * 用法 (repo root):  node scripts/og-default.mjs   → public/og/default.png
 * 風格與 live/og-gen.mjs 的三張同一套 (星空底 + accent 框 + fusion-pixel 12px 字)。
 * 字型來源讀 fonts_src/ (gitignored) — 先跑 scripts/build_pixel_fonts.py 會自動下載。
 * src/config.ts 的 defaultOGImage 指向這張; 沒有自訂封面的頁面 (首頁/日記/列表頁…) 都用它。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 240, H = 126, SCALE = 5;
const P = { bg: [10, 10, 21], deep: [30, 42, 74], accent: [61, 99, 255], dim: [139, 152, 184],
            light: [158, 180, 255], text: [242, 244, 250], gold: [232, 201, 74] };

const fonts = [
  { name: 'JP12', data: readFileSync(path.join(ROOT, 'fonts_src/fusion-pixel-12px-proportional-ja.ttf')), weight: 400, style: 'normal' },
  { name: 'TC12', data: readFileSync(path.join(ROOT, 'fonts_src/fusion-pixel-12px-proportional-zh_hant.ttf')), weight: 400, style: 'normal' },
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

// 右側一顆小行星 (地球色系, 呼應 /translations 的「地球」hero)
function drawPlanet(px, rect) {
  const cx = 196, cy = 60, r = 24;
  let s = 20260625;
  const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const d2 = x * x + y * y;
    if (d2 > r * r) continue;
    const shade = (x + r) / (2 * r);                 // 左暗右亮
    const land = rnd() < 0.35;
    const c = land ? [58 + 40 * shade, 140 + 50 * shade, 90 + 30 * shade]
                   : [36 + 30 * shade, 80 + 60 * shade, 190 + 50 * shade];
    px(cx + x, cy + y, c.map(v => v | 0));
  }
  // 外緣一圈 accent 光暈
  for (let a = 0; a < 360; a += 3) {
    const x = cx + Math.round((r + 2) * Math.cos(a * Math.PI / 180));
    const y = cy + Math.round((r + 2) * Math.sin(a * Math.PI / 180));
    px(x, y, P.deep);
  }
}

const { buf, px, rect } = baseBuffer(20210625);
drawPlanet(px, rect);
const bgPng = await sharp(Buffer.from(buf), { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
const svg = await satori(
  h('div', { width: W + 'px', height: H + 'px', position: 'relative', fontFamily: 'JP12' }, [
    t("DEREK'S SITE", 14, 12, 12, 'JP12', P.dim),
    t('にしな', 14, 30, 24, 'JP12', P.gold),
    t('歌詞翻譯・歌詞宇宙・Live 記錄', 14, 62, 12, 'TC12', P.text),
    t('LYRICS・SETLISTS・SHORTS・GACHA', 14, 80, 12, 'JP12', P.light),
    t('derekni.com', 14, 102, 12, 'JP12', P.dim),
  ]),
  { width: W, height: H, fonts });
const raw = new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
const ti = await sharp(Buffer.from(raw)).ensureAlpha().raw().toBuffer();
for (let i = 3; i < ti.length; i += 4) ti[i] = ti[i] >= 128 ? 255 : 0;   // 字緣二值化, 保持像素感
const textPng = await sharp(ti, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
const out = await sharp(bgPng).composite([{ input: textPng }])
  .resize(W * SCALE, H * SCALE, { kernel: 'nearest' }).png({ palette: true }).toBuffer();
const outDir = path.join(ROOT, 'public/og');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'default.png'), out);
console.log(`✓ public/og/default.png (${(out.length / 1024).toFixed(0)}KB, ${W * SCALE}×${H * SCALE})`);
