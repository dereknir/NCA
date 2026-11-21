/**
 * 完整 Live — 排段規則 (建站時判斷哪些歌能完整播, 瀏覽器播放 / 出錯換片也用同一份)
 *
 * 一句要算「有唱到」, 得知道它從哪一秒唱到哪一秒:
 *   結束 = 同一支 short 下一句的開始; 那支只拍到這句為止, 就用 live 量到的這句長度估, 而且影片要夠長。
 *   (人工確認過「最後一句唱到幾秒」的 short 會帶 end, 那句就直接用 end; 見 data/full_live_overrides.json)
 * 切點 (scripts/full_live_vocals.py 用人聲分離量的 vo / vt; 沒量到的照上面用錨點):
 *   段落開始 = 第一句起音前 LEAD_IN 秒, 但不早於上一句人聲結束 (不吃到上一句尾巴, 也不吃掉這句的頭)
 *   段落結束 = 同一支影片下一句起音前 CUT_GAP 秒 (前一句的尾音 / 換氣完整留著, 不播到下一句);
 *             影片裡沒有下一句: 人聲唱完再留 TAIL 秒, 後面有下一句的頭就切在它之前;
 *             整首最後一句: 唱完再播 OUTRO 秒尾奏。
 * 排段: 每一句優先用 live; 沒有 live 拍到的句子才用 MV 等其他版本補, 而且一接得回 live 就換回去。
 *       整首用動態規劃找總成本最低的排法: 每段 1 分, 結尾 / 開頭切在沒把握的地方另外罰分 (startPen / endPen),
 *       所以會盡量讓每段結束在「同一支影片下一句也有錨點」的地方 (切在下一句起音前, 最乾淨)。
 *   song.skip 裡的句子 (確認沒有任何 short 拍到, 見 overrides) 沒人唱到就直接跳過, 不算缺; 有人拍到還是照排。
 *   long: true 的是官方長片補段 (shorts 沒拍到的句子才標), 排段時跟 shorts 一樣看待, 只是不算進「幾支 shorts」。
 * 能不能上架: 每句都有人唱到, 而且非 live 的段數不超過總段數 30% 或非 live 的句數不超過總句數 30% (任一成立)。
 *   (只看段數的話, live 段越長、總段數越少, 一兩段 MV 就超標)
 * 素材由 scripts/build_full_live.py 產生 (src/data/full_live.json)。
 */

export interface FLShort {
  v: string; title: string; views: number; dur: number | null; live: boolean; type: string; am: [number, number][]; end?: number; long?: boolean;
  vo?: [number, number, number, number?][];                    // [句, 起音, 前一段人聲結束, 換句品質] (人聲分離量的; 品質見 onsetOf)
  vt?: [number, number, number | null, number, number?, number?];  // [最後一句, 唱完, 下一句起音 | null, 人聲唱到影片結束 0/1, 多唱秒數, MMS 分數]
  ci?: [number, number][]; co?: [number, number][];            // 人工確認過的切入 / 切出點 [句, 秒] (overrides 的 cuts)
  no?: number[];                                               // 不准用這支唱的句子 (overrides 的 avoid)
}
export interface FLSong { id: string; title: string; lines: { ja: string; zh: string }[]; L: number[]; shorts: FLShort[]; skip?: number[] }
export type FLSeg =
  | { gap: true; from: number; to: number; len: number }
  | { gap?: false; v: string; title: string; views: number; live: boolean; kind: string; from: number; to: number;
      start: number; end: number; safe: number; sung?: number; cues: [number, number][] };
      // safe = 下一段還沒好時, 這段最多能多播到哪 (不會播到下一句); sung = 只有整首最後一段: 人聲唱完的時間 (結尾淡出只淡這之後)

export const NON_LIVE_MAX = 0.3;
const PRE = 0.2;                        // 沒量到起音: 從錨點前多少秒切入 (實測三成錨點比起音晚, 最多約 0.3 秒)
const LEAD_IN = 0.15;                   // 量到起音: 從起音前多少秒切入
const FIRST_LEAD = 0.5;                 // 整首第一句多留一點前奏
const CUT_GAP = 0.05;                   // 下一句起音前多少秒切掉
const NO_ON_CUT = 0.12;                 // 下一句沒量到起音 (連唱沒換氣): 切在它錨點前多少秒
const TAIL = 0.6;                       // 影片裡沒有下一句: 唱完後再留多久餘韻
const OUTRO = 3;                        // 整首最後一句: 唱完後再播多久尾奏
const ON_OK: [number, number] = [-0.8, 0.5];   // 量到的起音要落在錨點 -0.8〜+0.5 秒內才採用 (之外當成量錯; 細的規則在 full_live_vocals.py)
export const KIND: Record<string, string> = { mv: 'MV', other: '其他版本', tft: 'THE FIRST TAKE', acoustic: '不插電版', audio: '錄音室版' };

type Prepared = FLShort & { at: Map<number, number>; last: number; on: Map<number, [number, number, number]>;
  cin: Map<number, number>; cout: Map<number, number>; ban: Set<number> };
const prepared = new WeakMap<FLShort, Prepared>();
const prep = (s: FLShort): Prepared => {
  let p = prepared.get(s);
  if (!p) prepared.set(s, p = { ...s, at: new Map(s.am), last: s.am.length ? s.am[s.am.length - 1][0] : -1,
    on: new Map((s.vo ?? []).map(([l, on, gap, q]) => [l, [on, gap, q ?? 2]])),
    cin: new Map(s.ci ?? []), cout: new Map(s.co ?? []), ban: new Set(s.no ?? []) });
  return p;
};

/** 第 l 句量到的 [起音, 前一段人聲結束, 換句品質] — 離錨點太遠的不採用; 長片那一塊的下一句 (沒錨點) 拿 end 當參考
 *  品質 2 = 換氣 ≥ 0.15 秒 / 1 = 換氣很短 / 0 = 連唱沒換氣 (起音 = 錨點附近最小聲的地方) / -1 = 影片一開頭就在唱 (頭被切掉) */
function onsetOf(s: Prepared, l: number): [number, number, number] | null {
  const o = s.on.get(l);
  const ref = s.at.get(l) ?? (s.long && l === s.last + 1 ? s.end : undefined);
  if (!o || ref == null) return null;
  const prev = s.at.get(l - 1);
  if (prev != null && o[0] < prev + 0.25) return null;        // 比上一句的錨點還早: 量到的是上一句 (上一句很短又連唱時會這樣)
  return o[0] - ref >= ON_OK[0] && o[0] - ref <= ON_OK[1] ? o : null;
}

/** 量到的起音能不能直接拿來切: 換氣 ≥ 0.15 秒的一定是起音; 換氣很短的要離錨點 0.25 秒內 (不然可能是上一句最後一個字) */
function trusted(o: [number, number, number], ref: number | undefined): boolean {
  return o[2] === 2 || (o[2] === 1 && (ref == null || Math.abs(o[0] - ref) <= 0.25));
}

/** 這支影片第 i 句從哪裡切入 */
function startOf(s: Prepared, i: number): number {
  const ci = s.cin.get(i);
  if (ci != null) return ci;                                   // 人工確認過
  const o = onsetOf(s, i), lead = i === 0 ? FIRST_LEAD : LEAD_IN;
  if (o && o[2] >= 1 && trusted(o, s.at.get(i))) return Math.max(0, o[1] + 0.02, o[0] - lead);
  if (o && o[2] === 0) return Math.max(0, o[0]);              // 連唱: 從最小聲的地方切入
  if (o && o[2] === -1) return Math.max(0, o[0]);             // 影片一開頭就在唱: 從頭
  return Math.max(0, s.at.get(i)! - (i === 0 ? FIRST_LEAD : PRE));
}

/** 這支影片第 l 句唱完要切在哪 (null = 這支沒完整唱到這句); n = 整首句數 */
function endOf(s: Prepared, l: number, L: number[], n: number): number | null {
  const t = s.at.get(l);
  if (t == null || s.ban.has(l)) return null;
  const co = s.cout.get(l);
  if (co != null) return co;                                   // 人工確認過
  const nx = s.at.get(l + 1);
  if (nx != null && nx > t) {                                  // 同一支影片有下一句: 切在它起音前
    const o = onsetOf(s, l + 1);
    const cut = !o ? nx - NO_ON_CUT : o[2] === 0 ? o[0] : o[2] >= 1 && trusted(o, nx) ? o[0] - CUT_GAP : nx - NO_ON_CUT;
    return Math.max(t + 0.3, cut);
  }
  const final = l === n - 1;
  if (l === s.last && s.long) {                                // 長片補段: 下一句的起音 (量到的) 或 end
    const o = onsetOf(s, l + 1);
    return !final && o ? o[0] - CUT_GAP : s.end ?? null;
  }
  const dur = s.dur ?? Infinity;
  const oldOk = !!s.dur && s.dur >= t + L[l] - 0.3;
  if (l === s.last && s.end != null && s.end > t) return s.end;   // 人工確認過唱完的時間 (overrides 的 ends)
  if (l === s.last && s.vt && s.vt[0] === l) {                 // 影片裡沒有下一句: 看人聲唱到哪
    const [, sung, next, touches] = s.vt;
    // 唱完之前影片就結束 (人聲一路到最後) 又不夠長 → 沒唱完; 人工確認過 (end) 的除外
    if (!(oldOk || !touches || next != null || s.end != null)) return null;
    const e = final ? Math.min(dur, sung + OUTRO) : next != null ? next - CUT_GAP : Math.min(dur, sung + TAIL);
    return Math.max(e, t + 0.3);
  }
  if (!oldOk) return null;
  return final ? Math.min(dur, t + L[l] * 1.5 + 2) : t + L[l];   // 沒量過: 最後一句多留一點 (後面沒有別句, 不怕重疊)
}

/** 下一段還沒開始播時, 這段最多能多播到哪: 只有「影片裡後面沒有下一句」才能多播 */
function safeOf(s: Prepared, l: number, end: number, n: number): number {
  if (l === n - 1 || (l === s.last && !s.long && s.vt && s.vt[0] === l && s.vt[2] == null)) return Math.max(end, s.dur ?? end);
  return end;
}

/** 整首最後一句唱完的時間 (播放器結尾的淡出只放在這之後, 不把最後一個字淡掉); undefined = 不知道, 照舊淡出 */
function sungOf(s: Prepared, l: number, end: number, L: number[]): number | undefined {
  const t = s.at.get(l)!;
  if (s.cout.has(l) || s.long) return undefined;                          // 人工切點 / 長片: 不知道唱到哪
  if (l === s.last && s.end != null && s.end > t) return Math.min(end, s.end);   // 人工確認過唱完的時間
  if (l === s.last && s.vt && s.vt[0] === l)                              // 最後一句的 vt 會把唱完後的觀眾聲 / MC 也算進去 → 用句長封頂
    return Math.min(end, s.vt[1], (onsetOf(s, l)?.[0] ?? t) + 2.5 * L[l]);
  return Math.min(end, t + L[l]);                                          // 沒量過: 句長估
}

/* 排段的成本: 每段 1, 加上「切點不乾淨」的罰分 — 寧可多換一段, 也不要結尾切在沒把握的地方 */
const GAP_PEN = 10;
const Q_PEN: Record<number, number> = { 2: 0, 1: 0.1, 0: 0.6, [-1]: 0.6 };   // 換句品質 → 罰分 (影片一開頭就唱: 字頭多半還在, 只是沒換氣空間)
function startPen(s: Prepared, i: number): number {
  if (s.long || s.cin.has(i)) return 0;
  const o = onsetOf(s, i);
  if (o) return Q_PEN[o[2]] ?? 0.3;                            // 換氣夠長最乾淨; 連唱 / 影片一開頭就在唱 (頭被切掉) 重罰
  return s.at.get(i)! < 0.25 ? 1 : 0.3;                        // 沒量過
}
function endPen(s: Prepared, l: number, n: number): number {
  if (s.cout.has(l)) return 0;
  if (s.at.has(l + 1)) {                                       // 同一支有下一句: 切在它起音前
    const o = onsetOf(s, l + 1);
    return o ? Q_PEN[o[2]] ?? 0.3 : 0.3;
  }
  if (s.long) return 0;
  const vt = s.vt && s.vt[0] === l ? s.vt : null;
  if (l === n - 1) return vt && vt[3] ? 0.5 : 0;               // 整首最後一句: 後面沒有別句
  if (s.end != null) return 0.2;                               // 人工確認過唱完的時間
  if (!vt) return 1.5;                                         // 沒量過, 只能用句長估
  if ((vt[5] ?? 0) >= 0.15) return vt[3] ? 1 : 0.3;            // MMS 對齊確認過唱到哪 (人聲一路到影片結束仍重罰)
  if (vt[3] || (vt[4] ?? 0) > 0) return 1.5;                   // 人聲一路唱到影片結束 / 比句長多唱一大段: 可能有下一句的頭
  return vt[2] != null ? 1.2 : 0.4;                            // 後面疑似有下一句的頭 / 唱完就沒了 (乾淨)
}

/** 從第 from 句排到最後; bad = 播不了要跳過的 videoId
 *  動態規劃: 整首一起找總成本最低的排法 (live 優先: 有 live 拍到的句子只用 live; 沒有才用其他版本, 一接得回 live 就換回去) */
export function plan(song: FLSong, bad: Set<string> = new Set(), from = 0): FLSeg[] {
  const n = song.lines.length, L = song.L, skip = new Set(song.skip ?? []);
  const pool = song.shorts.filter(s => !bad.has(s.v)).map(prep);
  const live = pool.filter(s => s.live), other = pool.filter(s => !s.live);
  const memo = new Map<Prepared, (number | null | undefined)[]>();
  const E = (s: Prepared, l: number) => {
    let a = memo.get(s);
    if (!a) memo.set(s, a = new Array(n));
    if (a[l] === undefined) a[l] = endOf(s, l, L, n);
    return a[l] as number | null;
  };
  const liveAt = Array.from({ length: n }, (_, l) => live.some(s => E(s, l) != null));
  const best = new Array<number>(n + 1).fill(Infinity);
  const choice = new Array<{ s: Prepared; j: number } | null>(n + 1).fill(null);
  best[n] = 0;
  for (let i = n - 1; i >= from; i--) {
    for (const s of liveAt[i] ? live : other) {
      if (E(s, i) == null) continue;
      const sp = startPen(s, i);
      for (let j = i; j < n; j++) {
        if (j > i && (E(s, j) == null || (!s.live && liveAt[j]))) break;
        const c = 1 + sp + endPen(s, j, n) + best[j + 1] - s.views * 1e-12;
        if (c < best[i]) { best[i] = c; choice[i] = { s, j }; }
      }
    }
    if (!choice[i]) best[i] = (skip.has(i) ? 0 : GAP_PEN) + best[i + 1];
  }
  const segs: FLSeg[] = [];
  for (let i = from; i < n;) {
    const c = choice[i];
    if (!c) { if (!skip.has(i)) segs.push({ gap: true, from: i, to: i, len: L[i] }); i++; continue; }
    const { s, j } = c;
    const end = E(s, j)!;
    segs.push({
      v: s.v, title: s.title, views: s.views, live: s.live, kind: KIND[s.type] || '其他版本', from: i, to: j,
      start: startOf(s, i), end, safe: safeOf(s, j, end, n), ...(j === n - 1 ? { sung: sungOf(s, j, end, L) } : {}),
      // 歌詞亮起的時間: 量到起音就用起音, 沒有就用錨點
      cues: Array.from({ length: j - i + 1 }, (_, d) => [i + d, onsetOf(s, i + d)?.[0] ?? s.at.get(i + d)!] as [number, number]),
    });
    i = j + 1;
  }
  return segs;
}

export function summary(song: FLSong) {
  const segs = plan(song);
  const real = segs.filter((s): s is Extract<FLSeg, { v: string }> => !s.gap);
  const nonLive = real.filter(s => !s.live);
  const missing = segs.filter(s => s.gap).map(s => s.from);
  const nonLiveLines = nonLive.reduce((a, s) => a + s.to - s.from + 1, 0);
  const sung = new Set(real.flatMap(s => Array.from({ length: s.to - s.from + 1 }, (_, d) => s.from + d)));
  return {
    skipped: (song.skip ?? []).filter(l => !sung.has(l)),
    segs: real.length,
    nonLive: nonLive.length,
    nonLiveLines,
    liveShorts: song.shorts.filter(s => s.live && !s.long).length,
    longSegs: real.filter(s => song.shorts.some(x => x.long && x.v === s.v)).length,
    missing,
    duration: segs.reduce((a, s) => a + (s.gap ? s.len : s.end - s.start), 0),
    complete: missing.length === 0 && real.length > 0
      && (nonLive.length <= real.length * NON_LIVE_MAX || nonLiveLines <= song.lines.length * NON_LIVE_MAX),
  };
}
