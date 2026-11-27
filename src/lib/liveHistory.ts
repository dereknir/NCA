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
  before: boolean;       // 巡演結束時這首還沒發行 (不算進分母)
};

export type LiveHistory = {
  rows: TourRow[];       // 舊 → 新, 只含有 setlist 的巡演
  eligible: number;      // 發行之後的巡演數 (分母)
  sung: number;          // 唱過幾次巡演
  missing: number;       // 有巡演但抓不到 setlist 的 (tracks 空), 不在 rows 裡
  shows: number;         // 約幾場 (只算對得到場次的巡演)
  first?: TourRow;       // 最早出現在 setlist 的巡演 (抓不到 setlist 的巡演可能更早)
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

// 「2024.11.10 - 2024.11.29」「2022.4.2 - 4.17」「2021.6.25」→ 開始 / 結束日 (結束沒寫年份就用開始那年)
function range(date: string): { start: string; end: string } {
  const [a, b] = date.split('-').map(x => x.trim());
  const m = a.match(/(\d{4})\.(\d+)\.(\d+)/);
  if (!m) return { start: '', end: '' };
  const iso = (y: string, mo: string, d: string) => `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const start = iso(m[1], m[2], m[3]);
  const e = b?.match(/(?:(\d{4})\.)?(\d+)\.(\d+)/);
  return { start, end: e ? iso(e[1] ?? m[1], e[2], e[3]) : start };
}

const ALL = (setlists.tours as SLTour[]).map(t => ({ t, ...range(t.date) }));
// 不靠 setlists.json 的排列順序 (那是外部頁面的順序), 自己照開始日排
const ROWS_BASE = ALL
  .filter(x => x.t.tracks.length > 0)
  .map(x => ({ ...x, year: x.start.slice(0, 4) }))
  .sort((a, b) => a.start.localeCompare(b.start));
const MISSING = ALL.filter(x => x.t.tracks.length === 0);

function slotOf(rows: TourRow[]): string | undefined {
  const sung = rows.filter(r => r.pos !== null);
  if (!sung.length) return undefined;
  if (sung.every(r => r.pos === 1)) return '開場';
  if (sung.every(r => r.pos === r.total)) return '最後一首';
  const rel = sung.map(r => (r.pos! - 1) / Math.max(r.total - 1, 1)).sort((a, b) => a - b);
  const mid = rel[Math.floor(rel.length / 2)];
  return mid < 1 / 3 ? '前段' : mid < 2 / 3 ? '中段' : '後段';
}

/** released: 歌的發行日 (YYYY-MM-DD); 巡演結束前還沒發行的不算「沒唱」 */
export function liveHistory(songId: string, released?: string): LiveHistory {
  // 有的歌發行前就先在巡演唱了, 也有發行日寫晚了的: 實際「出現」= 發行日與第一次進 setlist 取早的
  const firstLive = ROWS_BASE.find(x => x.t.tracks.some(tr => tr.matched_song_id === songId))?.start;
  if (released && firstLive && firstLive < released) released = firstLive;
  const rows: TourRow[] = ROWS_BASE.map(({ t, year, end }) => {
    const hit = t.tracks.find(tr => tr.matched_song_id === songId);
    return {
      title: t.title, date: t.date, year,
      stops: stopsByName.get(norm(t.title)) ?? null,
      pos: hit ? hit.index : null,
      total: t.tracks.length,
      before: !hit && !!released && end < released,
    };
  });
  const sungRows = rows.filter(r => r.pos !== null);
  return {
    rows,
    eligible: rows.filter(r => !r.before).length,
    missing: MISSING.filter(x => !released || x.end >= released).length,
    sung: sungRows.length,
    shows: sungRows.reduce((n, r) => n + (r.stops ?? 0), 0),
    first: sungRows[0],
    latest: sungRows.at(-1),
    slot: slotOf(rows),
  };
}
