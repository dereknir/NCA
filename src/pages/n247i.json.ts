/**
 * /n247i.json — 像素ガラケー N247i 要用的資料 (public/js/n247i.js 打開手機時才抓)
 *   songs     能完整播的歌 (今日の一曲每天輪一首): 歌名 / 專輯 / 小封面 / 歌詞
 *   upcoming  e+ 上的未來場次 (待受顯示離下一場幾天, 新着メール也會提)
 */
import { getCollection } from 'astro:content';
import data from '../data/full_live.json';
import upcoming from '../../live/upcoming.json';
import { summary, type FLSong } from '../lib/fullLive';
import { coverAt } from '../lib/covers';

export async function GET() {
  const meta = Object.fromEntries((await getCollection('translations')).map(t => [t.id, t.data]));
  const songs = (data.songs as FLSong[])
    .filter(s => summary(s).complete)
    .map(s => ({
      id: s.id, title: s.title, album: meta[s.id]?.album ?? '',
      cover: coverAt(meta[s.id]?.coverImage, 80) ?? null,
      lines: s.lines.filter(l => l.ja),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const events = upcoming.events.map(e => ({ date: e.date, name: e.name, venue: e.venue }));
  return new Response(JSON.stringify({ songs, upcoming: events }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
