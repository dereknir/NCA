/**
 * /n247i/uta/<歌曲 id>.json — N247i「着うた」裡一首歌: 逐句日文 / 中文, 「歌曲介紹」那一節拿來當解說, 有沒有完整 Live
 */
import { getCollection } from 'astro:content';
import lyrics from '../../../../data/lyrics.json';
import data from '../../../data/full_live.json';
import { summary, type FLSong } from '../../../lib/fullLive';

// markdown → 純文字段落 (粗體 / 連結 / 標籤拿掉, 空行分段)
const plain = (md: string) => md
  .replace(/<[^>]+>/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*|__|\*|`/g, '')
  .split(/\n\s*\n/).map(p => p.replace(/\s*\n\s*/g, '').trim()).filter(p => p && !/^(-{3,}|#)/.test(p));

export async function getStaticPaths() {
  return (await getCollection('translations')).map(t => ({ params: { id: t.id }, props: { t } }));
}

export function GET({ props }: { props: { t: any } }) {
  const { t } = props;
  const song = (lyrics.songs as any[]).find(s => s.id === t.id);
  const intro = (t.body ?? '').split(/^## /m).find((s: string) => s.startsWith('歌曲介紹'));
  const fl = (data.songs as FLSong[]).find(s => s.id === t.id);
  return new Response(JSON.stringify({
    id: t.id, title: t.data.title, artist: t.data.artist, album: t.data.album ?? '單曲', year: t.data.albumYear ?? null,
    lines: (song?.lyric_lines ?? []).filter((l: any) => l.ja).map((l: any) => ({ ja: l.ja, zh: l.zh ?? '' })),
    note: intro ? plain(intro.replace(/^歌曲介紹\s*/, '')).slice(0, 12) : [],
    full: !!fl && summary(fl).complete,
  }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
