/**
 * /n247i/uta.json — N247i「着うた」App 的資料夾: 照專輯分, 新的在前 (歌詞本身在 /n247i/uta/<id>.json, 點進去才抓)
 */
import { getCollection } from 'astro:content';
import data from '../../data/full_live.json';
import { summary, type FLSong } from '../../lib/fullLive';

export async function GET() {
  const full = new Set((data.songs as FLSong[]).filter(s => summary(s).complete).map(s => s.id));
  const albums = new Map<string, { album: string; year: number; songs: { id: string; title: string; track: number; full: boolean }[] }>();
  for (const t of await getCollection('translations')) {
    const name = t.data.album ?? '單曲';
    if (!albums.has(name)) albums.set(name, { album: name, year: t.data.albumYear ?? 0, songs: [] });
    albums.get(name)!.songs.push({ id: t.id, title: t.data.title, track: t.data.trackNumber ?? 99, full: full.has(t.id) });
  }
  const list = [...albums.values()]
    .map(a => ({ ...a, songs: a.songs.sort((x, y) => x.track - y.track) }))
    .sort((a, b) => b.year - a.year || a.album.localeCompare(b.album));
  return new Response(JSON.stringify({ albums: list }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
