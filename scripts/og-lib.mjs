/**
 * og-lib.mjs — OG 分享圖共用畫法 (og-default.mjs / og-pages.mjs 共用)
 * 基底 240×126, 最後 nearest 放大 ×5 = 1200×630; 字用 fusion-pixel 12px, 字緣二值化保持像素感。
 * 字型讀 fonts_src/ (gitignored) — 先跑 scripts/build_pixel_fonts.py 會自動下載。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const W = 240, H = 126, SCALE = 5;
export const P = { bg: [10, 10, 21], deep: [30, 42, 74], accent: [61, 99, 255], dim: [139, 152, 184],
                   light: [158, 180, 255], text: [242, 244, 250], gold: [232, 201, 74] };

const fontFile = n => path.join(ROOT, 'fonts_src', n);
export const fonts = [
  { name: 'JP12', data: readFileSync(fontFile('fusion-pixel-12px-proportional-ja.ttf')), weight: 400, style: 'normal' },
  { name: 'TC12', data: readFileSync(fontFile('fusion-pixel-12px-proportional-zh_hant.ttf')), weight: 400, style: 'normal' },
];
/** 字串在某字型某大小下的實際寬 (px): satori 畫一次, 找最右邊不透明的像素。排版前用來決定字級 / 截斷 */
export async function measure(str, size, fam = 'JP12') {
  const MW = 1200, MH = size * 2;
  const svg = await satori(h('div', { width: MW + 'px', height: MH + 'px', fontSize: size + 'px', fontFamily: fam, color: '#fff' }, str),
    { width: MW, height: MH, fonts });
  const { data, info } = await sharp(Buffer.from(new Resvg(svg).render().asPng())).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  let right = 0;
  for (let y = 0; y < info.height; y++) for (let x = info.width - 1; x > right; x--)
    if (data[(y * info.width + x) * 4 + 3] >= 128) { right = x; break; }
  return right + 1;
}
/** 超過 maxW 就從尾巴砍字補「…」(二分找最長能放下的長度) */
export async function fit(str, size, fam, maxW) {
  if (await measure(str, size, fam) <= maxW) return str;
  const cs = [...str];
  let lo = 0, hi = cs.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (await measure(cs.slice(0, mid).join('').trimEnd() + '…', size, fam) <= maxW) lo = mid; else hi = mid - 1;
  }
  return cs.slice(0, lo).join('').trimEnd() + '…';
}

export function baseBuffer(seed, frame = P.accent) {
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
  fr(2, 2, W - 4, H - 4, frame, 2);
  rect(2, H - 5, W - 4, 3, frame);
  return { buf, px, rect };
}

export const h = (type, style, ...children) => ({
  type, props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0] : children } });
export const t = (str, x, y, size, fam, c) =>
  h('div', { position: 'absolute', left: x + 'px', top: y + 'px', fontSize: size + 'px',
             fontFamily: fam, color: `rgb(${c[0]},${c[1]},${c[2]})` }, str);

/** 背景 buffer + 文字 → 1200×630 PNG buffer */
export async function compose(buf, texts, { palette = true } = {}) {
  const bgPng = await sharp(Buffer.from(buf), { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  const svg = await satori(
    h('div', { width: W + 'px', height: H + 'px', position: 'relative', fontFamily: 'JP12' }, ...texts),
    { width: W, height: H, fonts });
  const raw = new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
  const ti = await sharp(Buffer.from(raw)).ensureAlpha().raw().toBuffer();
  for (let i = 3; i < ti.length; i += 4) ti[i] = ti[i] >= 128 ? 255 : 0;   // 字緣二值化, 保持像素感
  const textPng = await sharp(ti, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  // sharp 同一條鏈裡 resize 一定先於 composite 執行 (跟寫的順序無關), 所以先合成成一張再放大
  const flat = await sharp(bgPng).composite([{ input: textPng }]).png().toBuffer();
  return sharp(flat).resize(W * SCALE, H * SCALE, { kernel: 'nearest' }).png({ palette }).toBuffer();
}

// 48×48 像素行星, 跟 public/js/site-shell.js 的 orb() 同一套 (定格在 rot=0)
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) >>> 0; h = (h ^ (h >>> 13)) * 1274126177 >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const vnoise = (x, y) => {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
export function drawOrb(px, ox, oy, { palette: pal, kind }) {
  const N = 48, ring = kind === 'ring', R = ring ? 15 : 20;
  const put = (x, y, c) => px(ox + x, oy + y, c);
  if (kind === 'belt') {
    for (const [cx, cy, rr] of [[14, 30, 7], [31, 17, 9], [36, 34, 5], [22, 12, 4]])
      for (let y = cy - rr; y <= cy + rr; y++) for (let x = cx - rr; x <= cx + rr; x++) {
        const dx = (x - cx) / rr, dy = (y - cy) / rr, wob = .75 + .3 * vnoise(Math.atan2(dy, dx) * 2 + cx, cy);
        if (dx * dx + dy * dy > wob * wob || x < 0 || y < 0 || x >= N || y >= N) continue;
        const lit = .6 - .5 * dx - .4 * dy + vnoise(x * .5, y * .5) * .4 + BAYER[(y % 4) * 4 + x % 4] / 40;
        put(x, y, pal[Math.max(0, Math.min(4, 4 - Math.floor(lit * 3.2)))]);
      }
    return;
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x - 24 + .5) / R, dy = (y - 24 + .5) / R, d = dx * dx + dy * dy;
    if (d > 1) continue;
    const z = Math.sqrt(1 - d), lon = Math.atan2(dx, z), lat = Math.asin(dy);
    let lit = Math.max(0, -.5 * dx - .45 * dy + .75 * z);
    let tex = 0, land = false;
    if (kind === 'gas' || ring) tex = Math.sin(lat * 9 + vnoise(lon * 2, lat * 3) * 2) * .5 + vnoise(lon * 4, lat * 12) * .3 - .15;
    else if (kind === 'wet') { const n = vnoise(lon * 2.6 + 9, lat * 3) * .7 + vnoise(lon * 6, lat * 6) * .3; land = n > .55; tex = land ? .1 : -.05; }
    else if (kind === 'star') tex = vnoise(lon * 5, lat * 5) * .4;
    else tex = vnoise(lon * 5, lat * 5) * .5 - .25 - (vnoise(lon * 11 + 3, lat * 11) > .78 ? .35 : 0);
    if (kind === 'star') lit = .55 + z * .5;
    const v = lit * 1.05 + tex * .35 + BAYER[(y % 4) * 4 + x % 4] / 16 * .28 - .14;
    let i = v > .85 ? 0 : v > .6 ? 1 : v > .38 ? 2 : v > .18 ? 3 : 4;
    if (kind === 'wet') i = land ? (v > .5 ? 2 : 3) : (v > .62 ? 0 : v > .3 ? 1 : 4);
    put(x, y, pal[i]);
  }
  if (ring) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x - 24 + .5), dy = (y - 24 + .5) * 3.2 + dx * .35, e = Math.sqrt(dx * dx + dy * dy);
    if (e < 18 || e > 23.5 || (e > 20.2 && e < 20.9)) continue;
    const front = dy > 0 || Math.hypot((x - 24 + .5) / R, (y - 24 + .5) / R) > 1;
    if (front) put(x, y, pal[(BAYER[(y % 4) * 4 + x % 4] > 8 ? 1 : 2) + (e > 21.5 ? 1 : 0)]);
  }
}
