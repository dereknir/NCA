/**
 * 抄歌詞的卡片: 把選的 1–4 句抄在一張白色橫線筆記紙上 (1080×1350, IG 直式貼文的比例)
 * - 頁首: 筆記本印好的 TITLE / DATE 欄位, 歌名、日期用手寫填上; 右上角斜貼一張拍立得 (封面)
 * - 歌詞: 日文 Klee One、中文霞鶩文楷, 每一行對著紙的中線置中、字落在線上
 * - 換行只斷在詞組之間 (BudouX 切日文 / 中文, 拼音用空格); 同樣行數下讓每行差不多長
 * - 字太多就整張一起縮 (1 → 0.4), 封面在的話歌詞一律從封面下面那條線開始寫, 不會疊到
 * - 右下角: 頁尾那顆小行星 + derekkk
 * 這支只在打開卡片時才載入 (CopyLyrics.astro 用 import() 抓), 字型也是那時才去 Google Fonts 拿
 */
import { Parser, jaModel, zhHantModel } from 'budoux';
import { PLANET } from './brandPlanet';

export type CardLine = { ja: string; zh: string; ro: string };
export type CardOpts = { lines: CardLine[]; withRo: boolean; photo: HTMLImageElement | null; title: string; artist: string };
type Kind = 'ro' | 'ja' | 'zh';

const W = 1080, H = 1350;
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Klee+One:wght@400;600&family=LXGW+WenKai+TC&display=swap';
const STY: Record<Kind, { px: number; w: string; fam: string; c: string }> = {
  ro: { px: 30, w: 'italic ', fam: '"Klee One", serif', c: '#7a7468' },
  ja: { px: 56, w: '600 ', fam: '"Klee One", serif', c: '#1d1b19' },
  zh: { px: 44, w: '', fam: '"LXGW WenKai TC", serif', c: '#4a4540' },
};
// 版面: 第一條線 TOP, 線畫到 RULE_END, 字最多寫到 TEXT_END, 下面是頁尾
const TOP = 250, LEFT = 150, RULE_END = H - 110, TEXT_END = H - 140;
// 拍立得: 右上角, 右緣離紙邊 70、上緣 48
const PH = { cx: W - 70 - 118, cy: 48 + 118, w: 236, h: 270 };
const PHOTO_BOTTOM = PH.cy - 118 + PH.h + 14;   // 含旋轉、陰影多留一點
const PHOTO_LEFT = PH.cx - 118 - 12, FULL = W - 90 - LEFT;
const CENTER = (LEFT + W - 90) / 2;   // 歌詞置中的中線
const PUNCT = /[\s、。，,！？!?）」』…]$/;

const parsers = { ja: new Parser(jaModel), zh: new Parser(zhHantModel) };

// 手寫字型: 第一次開卡片才把 Google Fonts 的 CSS 掛上去, 等它載完再等這次要用到的字
let fontsCss: Promise<void> | null = null;
export async function loadFonts(text: string) {
  fontsCss ??= new Promise<void>(res => {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = FONTS_CSS;
    l.onload = l.onerror = () => res();
    document.head.append(l);
  });
  await fontsCss;
  await Promise.all([
    document.fonts.load('56px "Klee One"', text), document.fonts.load('600 56px "Klee One"', text),
    document.fonts.load('44px "LXGW WenKai TC"', text),
  ]).catch(() => {});
}

export async function drawCard(cv: HTMLCanvasElement, o: CardOpts) {
  const g = cv.getContext('2d')!;
  cv.width = W; cv.height = H;
  await loadFonts(o.lines.map(l => l.ja + l.zh).join('') + o.title + o.artist + '0123456789.「」derekkTITLEDA');
  const photo = o.photo && o.photo.naturalWidth ? o.photo : null;

  // 紙 + 纖維 (固定種子: 同樣的句子每次畫出來一樣, 切選項不會閃)
  g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, W, H);
  let s = 0; for (const ch of o.lines.map(l => l.ja).join('')) s = (s * 31 + ch.charCodeAt(0)) % 233280;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(120,110,90,${rnd() * .04})`; g.fillRect(rnd() * W, rnd() * H, 2, 2); }

  // 要寫的東西: 每句 (拼音) 日文 中文, 句與句之間空一條線
  const items: ({ text: string; kind: Kind } | null)[] = [];
  o.lines.forEach((p, i) => {
    if (o.withRo && p.ro) items.push({ text: p.ro, kind: 'ro' });
    if (p.ja) items.push({ text: p.ja, kind: 'ja' });
    if (p.zh) items.push({ text: p.zh, kind: 'zh' });
    if (i < o.lines.length - 1) items.push(null);
  });

  // 拆成詞組: 日文 / 中文用 BudouX, 拼音用空格; 詞組裡有空格或標點的話在那裡再切一刀
  const segs = (text: string, kind: Kind) => {
    if (kind === 'ro') return text.split(/(?<=\s)/);
    const out: string[] = [];
    for (const ph of parsers[kind].parse(text)) {
      let cur = '';
      for (const ch of ph) { cur += ch; if (PUNCT.test(ch)) { out.push(cur); cur = ''; } }
      if (cur) out.push(cur);
    }
    return out;
  };
  // 換行: 行數由寬度決定, 同樣行數下找「最長那行最短」的斷法 (每行差不多長, 不會留兩個字的尾巴);
  // 斷在空格 / 標點後面的打個折扣, 比較會被選
  const wrapLines = (text: string, kind: Kind, font: string, maxW: number) => {
    g.font = font;
    const ps = segs(text, kind).flatMap(p => g.measureText(p).width > maxW ? [...p] : [p]);   // 單一詞組太長就逐字
    const width = (a: number, b: number) => g.measureText(ps.slice(a, b).join('').trim()).width;
    let n = 1, acc = 0;
    for (const p of ps) { const w = g.measureText(p).width; if (acc && acc + w > maxW) { n++; acc = w; } else acc += w; }
    if (n === 1) return [text.trim()];
    const m = ps.length, memo = new Map<string, [number, number[] | null]>();
    const best = (start: number, k: number): [number, number[] | null] => {
      const key = start + ':' + k; const hit = memo.get(key); if (hit) return hit;
      let res: [number, number[] | null] = [Infinity, null];
      if (k === 1) { const w = width(start, m); if (w <= maxW) res = [w, []]; }
      else for (let e = start + 1; e <= m - k + 1; e++) {
        const w = width(start, e); if (w > maxW) break;
        const sub = best(e, k - 1); if (!sub[1]) continue;
        const c = Math.max(w * (PUNCT.test(ps[e - 1]) ? .82 : 1), sub[0]);
        if (c < res[0]) res = [c, [e, ...sub[1]]];
      }
      memo.set(key, res); return res;
    };
    const cuts = best(0, n)[1];
    if (!cuts) return [text];
    const out: string[] = []; let a = 0;
    for (const e of [...cuts, m]) { out.push(ps.slice(a, e).join('').trim()); a = e; }
    return out;
  };
  type Row = { slot: number; t: string; f: string; c: string; px: number };
  // 從第 s0 條線開始一行一行寫, 寫不下回傳 null
  const place = (kk: number, s0: number) => {
    const rule = Math.round(92 * kk), out: Row[] = [];
    const lastSlot = Math.floor((TEXT_END - TOP) / rule);
    let slot = s0;
    for (const it of items) {
      if (!it) { slot++; continue; }
      const st = STY[it.kind], px = st.px * kk, f = `${st.w}${px}px ${st.fam}`;
      for (const t of wrapLines(it.text, it.kind, f, FULL)) out.push({ slot: slot++, t, f, c: st.c, px });
      if (slot - 1 > lastSlot) return null;
    }
    return { rule, out, end: slot - 1, lastSlot };
  };
  const firstSlot = (kk: number) => photo ? Math.max(1, Math.ceil((PHOTO_BOTTOM + 74 * kk - TOP) / Math.round(92 * kk))) : 1;
  let k = .4, layout = place(.4, firstSlot(.4))!;
  for (let kk = 1; kk >= .4 - 1e-9; kk = +(kk - .05).toFixed(2)) {
    const f0 = firstSlot(kk), top = place(kk, f0);
    if (!top) continue;
    // 垂直置中: 剩下的空線一半放上面
    layout = place(kk, f0 + Math.floor((top.lastSlot - top.end) / 2)) || top; k = kk; break;
  }

  // 橫線 + 左邊界線 (淡藍)
  g.strokeStyle = 'rgba(110,150,200,.45)'; g.lineWidth = 2;
  for (let y = TOP; y < RULE_END; y += layout.rule) { g.beginPath(); g.moveTo(60, y); g.lineTo(W - 60, y); g.stroke(); }
  g.strokeStyle = 'rgba(110,150,200,.3)'; g.beginPath(); g.moveTo(LEFT - 24, 60); g.lineTo(LEFT - 24, H - 60); g.stroke();

  // 頁首: TITLE 一行、DATE 在它正下方
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.fillStyle = 'rgba(90,110,140,.7)'; g.font = '26px "LXGW WenKai TC", serif';
  const HEAD_R = photo ? PHOTO_LEFT - 30 : W - 90;
  g.fillText('TITLE', LEFT, 122); g.fillText('DATE', LEFT, 196);
  g.strokeStyle = 'rgba(90,110,140,.5)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(LEFT + 90, 126); g.lineTo(HEAD_R, 126); g.moveTo(LEFT + 90, 200); g.lineTo(LEFT + 420, 200); g.stroke();
  g.fillStyle = '#1d1b19';
  const title = `${o.artist}「${o.title}」`;
  let tf = 44; g.font = `${tf}px "Klee One", serif`;
  while (g.measureText(title).width > HEAD_R - LEFT - 110 && tf > 24) { tf -= 2; g.font = `${tf}px "Klee One", serif`; }   // 歌名太長就縮字
  g.fillText(title, LEFT + 100, 116);
  const d = new Date(); g.font = '40px "Klee One", serif';
  g.fillText(`${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`, LEFT + 100, 190);

  // 歌詞: 字落在線上
  const boxes: { x1: number; x2: number; y1: number; y2: number }[] = [];
  for (const r of layout.out) {
    const base = TOP + r.slot * layout.rule - Math.round(18 * k);
    g.font = r.f; g.fillStyle = r.c;
    const w = g.measureText(r.t).width, x = Math.round(CENTER - w / 2);
    g.fillText(r.t, x, base);
    boxes.push({ x1: x, x2: x + w, y1: base - r.px * .9, y2: base + r.px * .15 });
  }

  // 拍立得 + 紙膠帶, 斜斜貼在右上
  if (photo) {
    g.save(); g.translate(PH.cx, PH.cy); g.rotate(.06);
    g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(-112, -112, PH.w, PH.h);
    g.fillStyle = '#fff'; g.fillRect(-118, -118, PH.w, PH.h);
    g.drawImage(photo, -102, -102, 204, 204);
    g.fillStyle = 'rgba(232,201,74,.55)'; g.rotate(-.18); g.fillRect(-60, -140, 120, 40);
    g.restore();
  }

  // 右下: 小行星 + derekkk
  g.font = '34px "Klee One", serif'; g.fillStyle = 'rgba(70,80,110,.85)'; g.textAlign = 'right';
  const brandW = g.measureText('derekkk').width;
  g.fillText('derekkk', W - 96, H - 58); g.textAlign = 'left';
  const PX = 4, ox = W - 96 - brandW - 16 * PX - 10, oy = H - 58 - 10 * PX;
  const INK: Record<string, string> = { '#c9c3e6': '#8f86c4', '#9d95c9': '#6f66a8' };   // 環的淡紫在白紙上太淡, 壓深一階
  for (const [x, y, w, h, c] of PLANET) { g.fillStyle = INK[c] || c; g.fillRect(ox + x * PX, oy + y * PX, w * PX, h * PX); }

  // 給測試看的版面資訊: 縮放、每行的框、封面的框
  return { k, rows: layout.out.length, boxes, photoBox: photo ? { x1: PH.cx - 128, x2: PH.cx + 128, y1: PH.cy - 148, y2: PHOTO_BOTTOM } : null, textEnd: TEXT_END, width: W };
}
