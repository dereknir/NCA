/**
 * 完整 Live — 排段規則 (建站時判斷哪些歌能完整播, 瀏覽器播放 / 出錯換片也用同一份)
 *
 * 一句要算「有唱到」, 得知道它從哪一秒唱到哪一秒:
 *   結束 = 同一支 short 下一句的開始; 那支只拍到這句為止, 就用 live 量到的這句長度估, 而且影片要夠長。
 * 排段: 每一句優先用 live, 一支能撐越多句越好 (一樣長挑觀看數高的);
 *       沒有 live 拍到的句子才用 MV 等其他版本補, 而且一接得回 live 就換回去。
 * 能不能上架: 每句都有人唱到, 而且非 live 的段數不超過總段數 30%。
 * 素材由 scripts/build_full_live.py 產生 (src/data/full_live.json)。
 */

export interface FLShort { v: string; title: string; views: number; dur: number | null; live: boolean; type: string; am: [number, number][] }
export interface FLSong { id: string; title: string; lines: { ja: string; zh: string }[]; L: number[]; shorts: FLShort[] }
export type FLSeg =
  | { gap: true; from: number; to: number; len: number }
  | { gap?: false; v: string; title: string; views: number; live: boolean; kind: string; from: number; to: number;
      start: number; end: number; cues: [number, number][] };

export const NON_LIVE_MAX = 0.3;
const PRE = 0.15;                       // 每段從那句開始前多少秒切入 (留一點換氣)
export const KIND: Record<string, string> = { mv: 'MV', other: '其他版本', tft: 'THE FIRST TAKE', acoustic: '不插電版' };

type Prepared = FLShort & { at: Map<number, number> };
const prepared = new WeakMap<FLShort, Prepared>();
const prep = (s: FLShort): Prepared => {
  let p = prepared.get(s);
  if (!p) prepared.set(s, p = { ...s, at: new Map(s.am) });
  return p;
};

function endOf(s: Prepared, l: number, L: number[]): number | null {
  const t = s.at.get(l);
  if (t == null) return null;
  const nx = s.at.get(l + 1);
  if (nx != null && nx > t) return nx;
  const e = t + L[l];
  return s.dur && s.dur >= e - 0.3 ? e : null;
}

/** 從第 from 句排到最後; bad = 播不了要跳過的 videoId */
export function plan(song: FLSong, bad: Set<string> = new Set(), from = 0): FLSeg[] {
  const n = song.lines.length, L = song.L, segs: FLSeg[] = [];
  const pool = song.shorts.filter(s => !bad.has(s.v)).map(prep);
  const live = pool.filter(s => s.live), other = pool.filter(s => !s.live);
  const hasLive = (l: number) => live.some(s => endOf(s, l, L) != null);
  const pick = (cands: Prepared[], i: number, stopAtLive: boolean) => {
    let best: { s: Prepared; j: number } | null = null;
    for (const s of cands) {
      if (endOf(s, i, L) == null) continue;
      let j = i;
      while (j + 1 < n && endOf(s, j + 1, L) != null && !(stopAtLive && hasLive(j + 1))) j++;
      if (!best || j > best.j || (j === best.j && s.views > best.s.views)) best = { s, j };
    }
    return best;
  };
  for (let i = from; i < n;) {
    const best = pick(live, i, false) || pick(other, i, true);
    if (!best) { segs.push({ gap: true, from: i, to: i, len: L[i] }); i++; continue; }
    const { s, j } = best;
    segs.push({
      v: s.v, title: s.title, views: s.views, live: s.live, kind: KIND[s.type] || '其他版本', from: i, to: j,
      start: Math.max(0, s.at.get(i)! - PRE), end: endOf(s, j, L)!,
      cues: Array.from({ length: j - i + 1 }, (_, d) => [i + d, s.at.get(i + d)!] as [number, number]),
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
  return {
    segs: real.length,
    nonLive: nonLive.length,
    nonLiveLines: nonLive.reduce((a, s) => a + s.to - s.from + 1, 0),
    liveShorts: song.shorts.filter(s => s.live).length,
    missing,
    duration: segs.reduce((a, s) => a + (s.gap ? s.len : s.end - s.start), 0),
    complete: missing.length === 0 && real.length > 0 && nonLive.length <= real.length * NON_LIVE_MAX,
  };
}
