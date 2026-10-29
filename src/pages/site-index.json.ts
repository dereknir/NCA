/**
 * /site-index.json — 頁首選單 + 指令列的資料
 * 靜態頁 (public/ 底下的歌詞宇宙、索引、星圖、ガチャ、live/*) 沒有 Astro layout,
 * 頁首要從這裡拿選單; 指令列搜尋歌名 / 日記 / 作品也查這份。
 */
import { getCollection } from 'astro:content';
import { NAV_GROUPS, PLANETS } from '../config';

export async function GET() {
  const songs = (await getCollection('translations'))
    .map(t => ({
      id: t.id,
      title: t.data.title,
      album: t.data.album ?? '單曲',
      track: t.data.trackNumber ?? 0,
      year: t.data.albumYear ?? 0,
      artist: t.data.artist,
      cover: t.data.coverImage ?? null,
      instrumental: t.data.instrumental === true,
    }))
    .sort((a, b) => b.year - a.year || a.album.localeCompare(b.album) || a.track - b.track);
  const diary = (await getCollection('diary'))
    .filter(d => !d.data.isPrivate)
    .map(d => ({ title: d.data.title, href: `/diary/${d.id}` }));
  const projects = (await getCollection('projects'))
    .map(p => ({ title: p.data.title, href: `/projects/${p.id}` }));

  return new Response(JSON.stringify({ groups: NAV_GROUPS, planets: PLANETS, songs, diary, projects }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
