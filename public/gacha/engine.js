/**
 * gacha/engine.js — 像素引擎瀏覽器版(自 src/pixelArt.ts + renderPixel.ts 忠實移植)
 * 純 JS、零依賴、無 DOM——node 可 import 做 parity 測試。
 * 任何演算法修改必須同步回 node 版並重跑 scripts/test-parity.ts。
 */
export const W = 168, H = 126, SCALE = 5;
export const MARGIN = 12;
const contentW = () => W - MARGIN * 2;

/* ---------- 色盤 ---------- */
export const hex2rgb = h => {
  const v = h.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
};
const mix = (a, b, t) => [0, 1, 2].map(i => Math.round(a[i] * (1 - t) + b[i] * t));
export function makePalette(accentHex) {
  const bg = [12, 18, 32], white = [242, 244, 250];
  const accent = hex2rgb(accentHex);
  return {
    bg, bgSoft: mix(bg, accent, 0.10), accent,
    accentDim: mix(accent, bg, 0.45), accentDeep: mix(accent, bg, 0.72),
    light: mix(accent, white, 0.55), text: white, dim: [139, 152, 184], gold: [232, 201, 74],
  };
}

/* ---------- RNG(mulberry32,與 node 版一致) ---------- */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 畫布 ---------- */
export class Buf {
  constructor() { this.data = new Uint8Array(W * H * 3); }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2];
  }
  rect(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
  }
  frameRect(x, y, w, h, c, t = 1) {
    this.rect(x, y, w, t, c); this.rect(x, y + h - t, w, t, c);
    this.rect(x, y, t, h, c); this.rect(x + w - t, y, t, h, c);
  }
}

/* ---------- 抖色 / 星空 / 圖標 / 邊框(與 node 版逐行一致) ---------- */
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
export function ditherField(b, p, zones, dir, strength) {
  const inZ = (x, y) => zones.some(z => x >= z.x - 2 && x < z.x + z.w + 2 && y >= z.y - 2 && y < z.y + z.h + 2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (zones.length && inZ(x, y)) continue;
    let t = dir === 'right' ? (x / W - 0.55) / 0.45
      : dir === 'bottom' ? (y / H - 0.55) / 0.45
      : ((x / W + y / H) / 2 - 0.5) / 0.5;
    t *= strength;
    if (t <= 0) continue;
    const th = BAYER[y % 4][x % 4] / 16;
    if (t > th + 0.55) b.set(x, y, p.accentDim);
    else if (t > th) b.set(x, y, p.accentDeep);
  }
}
export function starfield(b, p, zones, r, count) {
  const inZ = (x, y) => zones.some(z => x >= z.x - 2 && x < z.x + z.w + 2 && y >= z.y - 2 && y < z.y + z.h + 2);
  for (let i = 0; i < count; i++) {
    const x = Math.floor(r() * W), y = Math.floor(r() * H);
    if (zones.length && inZ(x, y)) continue;
    const roll = r();
    if (roll < 0.72) b.set(x, y, roll < 0.4 ? p.dim : p.light);
    else if (roll < 0.92) b.rect(x, y, 2, 2, p.accentDim);
    else {
      b.set(x, y, p.gold); b.set(x - 1, y, p.gold); b.set(x + 1, y, p.gold);
      b.set(x, y - 1, p.gold); b.set(x, y + 1, p.gold);
    }
  }
}
const MOTIFS = {
  moon: ['..LLLL..', '.LLLL...', 'LLLL....', 'LLLL....', 'LLLL....', 'LLLL....', '.LLLL...', '..LLLLLL'],
  star: ['...G...', '..GGG..', 'GGGGGGG', '.GGGGG.', '..G.G..', '.G...G.'],
  drop: ['...A...', '..AAA..', '..AAA..', '.AAAAA.', '.AAAAA.', 'AAALAAA', 'AALLAAA', '.AAAAA.', '..AAA..'],
  note: ['....AA.', '....A.A', '....A..', '....A..', '....A..', '.AAA...', 'AAAA...', '.AA....'],
  planet: ['..DAAD..', '.AAAAAA.', 'DAALLAAD', 'GAALLAAG', '.GAAAAG.', '..DGGD..'],
  fruit: ['...T....', '..AAA...', '.AAAAA..', 'AAAAAAA.', 'AAALAAA.', 'AAALAAA.', '.AAAAA..', '..AAA...'],
  heart: ['.AA.AA.', 'AAAAAAA', 'AAAAAAA', '.AAAAA.', '..AAA..', '...A...'],
  wave: ['AA......', 'AAAA..AA', '..AAAAAA', '......AA'],
};
export const MOTIF_KEYS = Object.keys(MOTIFS);
export const motifSize = n => ({ w: MOTIFS[n][0].length, h: MOTIFS[n].length });
export function blitMotif(b, p, name, ox, oy) {
  const map = MOTIFS[name];
  if (!map) return;
  const C = { A: p.accent, L: p.light, D: p.accentDim, G: p.gold, T: p.text };
  map.forEach((row, j) => [...row].forEach((ch, i) => { if (C[ch]) b.set(ox + i, oy + j, C[ch]); }));
}
export function frame(b, p, style, gold = false) {
  const main = gold ? p.gold : p.accent;
  if (style === 0) {
    b.frameRect(2, 2, W - 4, H - 4, main, 2);
    b.frameRect(6, 6, W - 12, H - 12, gold ? p.accentDim : p.accentDeep, 1);
  } else if (style === 1) {
    b.frameRect(2, 2, W - 4, H - 4, p.accentDim, 1);
    b.frameRect(5, 5, W - 10, H - 10, p.accentDim, 1);
  } else {
    const L = 14, t = 2;
    for (const [cx, cy, dx, dy] of [[2, 2, 1, 1], [W - 3, 2, -1, 1], [2, H - 3, 1, -1], [W - 3, H - 3, -1, -1]]) {
      for (let i = 0; i < L; i++) { b.rect(cx + dx * i, cy, 1, t, main); b.rect(cx, cy + dy * i, t, 1, main); }
    }
  }
  b.rect(2, H - 5, W - 4, 3, main);
}
export function scanlines(b) {
  for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    b.data[i] = Math.max(0, b.data[i] - 6);
    b.data[i + 1] = Math.max(0, b.data[i + 1] - 6);
    b.data[i + 2] = Math.max(0, b.data[i + 2] - 5);
  }
}
export function snapToPalette(data, p) {
  const pal = [p.bg, p.bgSoft, p.accent, p.accentDim, p.accentDeep, p.light, p.text, p.dim, p.gold, [6, 12, 27]];
  for (let i = 0; i < data.length; i += 3) {
    let best = 0, bd = Infinity;
    for (let k = 0; k < pal.length; k++) {
      const d = (data[i] - pal[k][0]) ** 2 + (data[i + 1] - pal[k][1]) ** 2 + (data[i + 2] - pal[k][2]) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    data[i] = pal[best][0]; data[i + 1] = pal[best][1]; data[i + 2] = pal[best][2];
  }
}

/* ---------- 版面(與 node 版一致) ---------- */
const isFullWidth = ch => /[\u1100-\uFFE6]/.test(ch) && !/[\uFF61-\uFF9F]/.test(ch);
export const textWidth = (s, size) =>
  [...s].reduce((w, ch) => w + (isFullWidth(ch) ? size : size / 2), 0);
const TITLE_LADDER = [24, 20, 16, 12, 10, 8];
const fitSize = (text, ladder, maxW) => ladder.find(sz => textWidth(text, sz) <= maxW) ?? 0;
export const famJP = { 24: 'JP12', 20: 'JP10', 16: 'JP8', 12: 'JP12', 10: 'JP10', 8: 'JP8' };
export const famTC = { 12: 'TC12', 10: 'TC10', 8: 'TC8' };

export function computeLayout(d) {
  const cw = contentW();
  const titleSize = fitSize(d.titleJa, TITLE_LADDER, cw);
  const lyricCap = titleSize >= 16 ? 12 : titleSize === 12 ? 10 : 8;
  const lyricLadder = [12, 10, 8].filter(sz => sz <= lyricCap);
  const lyricSize = d.lyricJa ? fitSize(d.lyricJa, lyricLadder, cw) : lyricCap;
  const zhLadder = [12, 10, 8].filter(sz => sz <= (lyricSize || lyricCap));
  let zhSize = d.lyricZh ? fitSize(d.lyricZh, zhLadder, cw) : 0;
  const zhDropped = !!d.lyricZh && zhSize === 0;
  if (zhDropped) zhSize = 0;
  const TITLE_TOP = 32;
  const titleBottom = TITLE_TOP + titleSize;
  const blockH = (d.lyricJa ? lyricSize : 0) + (d.lyricJa && zhSize ? 5 : 0) + zhSize;
  const spaceTop = titleBottom + 6, spaceBottom = H - 12;
  const lyricTop = spaceTop + Math.max(0, Math.floor((spaceBottom - spaceTop - blockH) * 0.6));
  const zhTop = lyricTop + (d.lyricJa ? lyricSize + 5 : 0);
  const contentBottom = zhTop + zhSize;
  const fits = titleSize > 0 && (!d.lyricJa || lyricSize > 0) && contentBottom <= H - 10;
  return { titleSize, lyricSize, zhSize, zhDropped, lyricTop, zhTop, contentBottom, fits };
}

/* ---------- 變體 + 背景組裝(RNG 消耗順序與 node 版一致) ---------- */
export function makeVariant(seed, motifGiven) {
  const r = rng(seed);
  const motif = motifGiven ?? MOTIF_KEYS[Math.floor(r() * MOTIF_KEYS.length)];
  const motifPos = [];
  const n = 1 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const { w, h } = motifSize(motif);
    motifPos.push([12 + Math.floor(r() * (W - w - 24)), 12 + Math.floor(r() * (H - h - 30))]);
  }
  return {
    dither: ['right', 'bottom', 'corner'][Math.floor(r() * 3)],
    ditherStrength: 0.7 + r() * 0.6,
    stars: Math.round((60 + Math.floor(r() * 90)) * W / 240),
    scan: r() < 0.45, frameStyle: Math.floor(r() * 3),
    motif, motifPos,
  };
}

export function motifAvoidZones(L, d) {
  const z = [
    { x: 8, y: 8, w: 60, h: 14 },
    { x: W - 80, y: 8, w: 76, h: 14 },
    { x: MARGIN - 2, y: 32, w: contentW() + 4, h: L.titleSize + 2 },
  ];
  if (d.lyricJa) z.push({ x: MARGIN - 2, y: L.lyricTop - 2, w: contentW() + 4, h: L.lyricSize + 4 });
  if (L.zhSize) z.push({ x: MARGIN - 2, y: L.zhTop - 2, w: contentW() + 4, h: L.zhSize + 4 });
  return z;
}

/** 稀有度 → 邊框政策:N 隨機 / R 實線 / SR·LIVE 金框 */
export function buildCardArt(d, L, seed, rarity = 'N') {
  const p = makePalette(d.accent);
  const v = makeVariant(seed, d.motif);
  if (rarity === 'R') v.frameStyle = 0;
  const gold = rarity === 'SR' || rarity === 'LIVE';
  if (gold) v.frameStyle = 0;
  const avoid = motifAvoidZones(L, d);
  const b = new Buf();
  b.rect(0, 0, W, H, p.bg);
  ditherField(b, p, [], v.dither, v.ditherStrength);
  starfield(b, p, [], rng(seed ^ 0x9e3779b9), v.stars);
  for (const [mx, my] of v.motifPos) {
    const { w, h: mh } = motifSize(v.motif);
    if (!avoid.some(z => mx < z.x + z.w && mx + w > z.x && my < z.y + z.h && my + mh > z.y))
      blitMotif(b, p, v.motif, mx, my);
  }
  if (v.scan) scanlines(b);
  frame(b, p, v.frameStyle, gold);
  return { buf: b, palette: p, variant: v };
}
