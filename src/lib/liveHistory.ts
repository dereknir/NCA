// 每首歌的「現場履歷」: 從巡演 setlist (setlists.json) + 各巡演的場次 (tour_stops.json) 算
// - setlist 是每個巡演的代表曲目 (官方 playlist), 一個巡演內每場大致相同, 所以「唱過幾場」標「約」
// - 沒有 setlist 的巡演 (tracks 空) 不算進分母
import setlists from '../data/setlists.json';
import tourStops from '../../live/data/tour_stops.json';

type Track = { index: number; title: string; matched_song_id?: string | null };
type SLTour = { title: string; date: string; tracks: Track[] };

export type TourRow = {
  title: string;
  date: string;          // setlist 上的期間文字, 例如 2026.3.29 - 2026.6.20
  year: string;
  stops: number | null;  // 這個巡演幾場 (對不到 tour_stops 時是 null)
  pos: number | null;    // 這首在 setlist 第幾首; 沒唱 = null
  total: number;         // setlist 總曲數
};

export type LiveHistory = {
  rows: TourRow[];       // 舊 → 新, 只含有 setlist 的巡演
  sung: number;          // 唱過幾次巡演
  shows: number;         // 約幾場 (只算對得到場次的巡演)
  first?: TourRow;
  latest?: TourRow;
  slot?: string;         // 通常排在哪: 開場 / 前段 / 中段 / 後段 / 最後一首
};

// 「ツアー2026「日々散漫」」跟「日々散漫」要對得起來: 拿掉括號、年份、ワンマン/ライブ/ツアー 這類字再比
const norm = (s: string) => s
  .replace(/[「」『』\s]/g, '')
  .replace(/20\d\d年?/g, '')
  .replace(/ZEPPTOUR|ワンマン|ライブ|ツアー|東阪/gi, '')
  .toLowerCase();

const stopsByName = new Map(tourStops.tours.map(t => [norm(t.name), t.stops.length]));

const ROWS_BASE = (setlists.tours as SLTour[])
  .filter(t => t.tracks.length > 0)
  .map(t => ({ t, year: (t.date.match(/20\d\d/) ?? [''])[0] }))
  .reverse();   // setlists.json 是新 → 舊 (日期是「2024.11.10」這種文字, 不能直接字串排序)

function slotOf(rows: TourRow[]): string | undefined {
  const sung = rows.filter(r => r.pos !== null);
  if (!sung.length) return undefined;
  if (sung.every(r => r.pos === 1)) return '開場';
  if (sung.every(r => r.pos === r.total)) return '最後一首';
  const rel = sung.map(r => (r.pos! - 1) / Math.max(r.total - 1, 1)).sort((a, b) => a - b);
  const mid = rel[Math.floor(rel.length / 2)];
  return mid < 1 / 3 ? '前段' : mid < 2 / 3 ? '中段' : '後段';
}

export function liveHistory(songId: string): LiveHistory {
  const rows: TourRow[] = ROWS_BASE.map(({ t, year }) => {
    const hit = t.tracks.find(tr => tr.matched_song_id === songId);
    return {
      title: t.title, date: t.date, year,
      stops: stopsByName.get(norm(t.title)) ?? null,
      pos: hit ? hit.index : null,
      total: t.tracks.length,
    };
  });
  const sungRows = rows.filter(r => r.pos !== null);
  return {
    rows,
    sung: sungRows.length,
    shows: sungRows.reduce((n, r) => n + (r.stops ?? 0), 0),
    first: sungRows[0],
    latest: sungRows.at(-1),
    slot: slotOf(rows),
  };
}
