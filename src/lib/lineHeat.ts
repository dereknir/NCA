/**
 * 這句的現場: 每一句歌詞有幾支短片唱到 (現場 / 其他版本), 跟整首歌的「聲波」
 * - 歌詞頁 (LineLive.astro) build 時算好畫出來; LIVE 播放器 (LiveStage.astro) 在瀏覽器裡畫同一種
 * - 聲波: 一句一根, 金 = 現場、上面疊紫 = THE FIRST TAKE / MV 等, 下半是淡淡的倒影;
 *   高度用平方根 (只有 2、3 支的句子也看得出起伏), 2px 一階
 */
export type HeatShort = { versionType?: string | null; anchors: { t: number; line: number }[] };
export type Heat = { live: number[]; other: number[]; max: number };

export function lineHeat(shorts: HeatShort[], lineCount: number): Heat {
  const n = Math.max(lineCount, ...shorts.flatMap(s => s.anchors.map(a => a.line + 1)), 0);
  const live = Array(n).fill(0), other = Array(n).fill(0);
  for (const s of shorts) {
    for (const ln of new Set(s.anchors.map(a => a.line))) {
      if (s.versionType === 'live') live[ln]++; else other[ln]++;
    }
  }
  return { live, other, max: Math.max(1, ...live.map((v, i) => v + other[i])) };
}

/** 一根的高度 (px): 0 支 = 0; 其他照平方根比例, 2px 一階, 最少 2px */
const bar = (v: number, max: number, half: number) => v ? Math.max(2, Math.round(Math.sqrt(v / max) * half / 2) * 2) : 0;

/** 聲波的 HTML; tag = 'button' 可以點 (歌詞開頭那條), 'span' 純看 (黏頂條、播放器裡) */
export function waveHTML(h: Heat, half: number, tag: 'button' | 'span') {
  return h.live.map((lv, i) => {
    const ot = h.other[i], l = bar(lv, h.max, half), o = Math.max(0, bar(lv + ot, h.max, half) - l);
    const attrs = tag === 'button'
      ? `type="button" tabindex="${i ? -1 : 0}" ${lv + ot ? '' : 'disabled'} aria-label="第 ${i + 1} 句: ${lv} 支現場${ot ? `、${ot} 支其他版本` : ''}"`
      : '';
    return `<${tag} class="wv-b${lv + ot ? '' : ' none'}" data-i="${i}" ${attrs} style="--l:${l}px;--o:${o}px"><i class="o"></i><i class="l"></i><i class="r"></i></${tag}>`;
  }).join('');
}

/** 標出讀到 / 播到哪: now = 那一句 (白), read = 之前的 (亮金); range = 這支短片唱的範圍 (其他變暗) */
export function paintWave(root: Element, now: number, range?: [number, number]) {
  root.querySelectorAll<HTMLElement>('.wv-b').forEach((b, i) => {
    b.classList.toggle('now', i === now);
    b.classList.toggle('read', !range && i < now);
    b.classList.toggle('in', !!range && i >= range[0] && i <= range[1]);
    b.classList.toggle('dim', !!range && (i < range[0] || i > range[1]));
  });
}
