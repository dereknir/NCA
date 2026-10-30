/**
 * /annotate/full_live_progress.json — 完整 Live 的進度, 只給審片工具看 (網站上不公開)
 * 每首歌: 還缺哪幾句 (沒人唱到)、哪幾句目前是用 MV 等非 live 補的; 審片工具拿來提示「審這支可以補上」。
 */
import data from '../../data/full_live.json';
import { plan, summary, type FLSong } from '../../lib/fullLive';

export function GET() {
  const songs = Object.fromEntries((data.songs as FLSong[]).map(song => {
    const sum = summary(song);
    const mv = plan(song).flatMap(s => !s.gap && !s.live ? Array.from({ length: s.to - s.from + 1 }, (_, d) => s.from + d) : []);
    return [song.id, { title: song.title, complete: sum.complete, missing: sum.missing, mv, segs: sum.segs }];
  }));
  return new Response(JSON.stringify({ songs }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
