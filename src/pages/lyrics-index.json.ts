/**
 * /lyrics-index.json — 指令列搜歌詞用的全文索引: 每首歌的每一句 (日文、中文、羅馬拼音)
 * 來源是 data/lyrics.json (scripts/export_lyrics_json.py 從翻譯 md 產生, GitHub Actions 會跟著 md 自動更新)。
 * 指令列真的開始搜的時候才抓 (site-shell.js), 不在每一頁載入。
 * 格式盡量省: songs = [[id, 歌名], …]; lines = [[第幾首, 第幾句 (0 起算), 日文, 中文, 拼音], …]
 * 第幾句 = 翻譯頁上第幾個 .lyrics-line, 所以連結寫 /translations/<id>/#L<第幾句+1>
 */
import type { APIRoute } from 'astro';
import lyrics from '../../data/lyrics.json';

type Line = { index: number; ja?: string | null; zh?: string | null; romaji?: string | null };
type Song = { id: string; title: string; instrumental?: boolean; lyric_lines: Line[] };

export const GET: APIRoute = () => {
  const songs = (lyrics.songs as Song[]).filter(s => !s.instrumental && s.lyric_lines.length);
  const out = {
    songs: songs.map(s => [s.id, s.title]),
    lines: songs.flatMap((s, i) => s.lyric_lines
      .filter(l => l.ja || l.zh)
      .map(l => [i, l.index, l.ja ?? '', l.zh ?? '', l.romaji ?? ''])),
  };
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
