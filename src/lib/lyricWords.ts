/**
 * 翻譯頁「點歌詞裡的詞」要用的資料: 從歌詞索引 (src/data/kwic_index.json, scripts/build_kwic.py 產生) 挑出這首歌用到的詞,
 * 每個詞附上讀音、詞性、在幾首歌出現幾句、常見的變化形、其他歌裡的例句 (一首一句, 最多 3 句)。
 * 只帶這首歌自己的份, 不把整份索引 (~400KB) 塞進每一頁。
 */
import kwic from '../data/kwic_index.json';

type Line = { id: number; song: string; title: string; ja: string; zh?: string };
type Vocab = { lemma: string; lines: number; forms: Record<string, number>; head?: string; read?: string; pos?: string };

const lines = kwic.lines as Line[];
const postings = kwic.postings as unknown as Record<string, [number, number, number][]>;   // JSON 推出來是 number[][], 實際每筆固定 3 個數字
const vocab = new Map((kwic.vocab as Vocab[]).map(v => [v.lemma, v]));

// 每一行有哪些詞 (位置), 只算一次
const byLine = new Map<number, [number, number, string][]>();
for (const [lemma, posts] of Object.entries(postings)) {
  for (const [lid, s, e] of posts) {
    if (!byLine.has(lid)) byLine.set(lid, []);
    byLine.get(lid)!.push([s, e, lemma]);
  }
}
for (const v of byLine.values()) v.sort((a, b) => a[0] - b[0]);

export type WordInfo = {
  head: string; read: string; pos: string; lines: number; songs: number;
  forms: [string, number][]; ex: { ja: string; zh: string; s: number; e: number; title: string; id: string }[]; more: number;
};
export type LyricWords = { toks: Record<string, [number, number, string][]>; words: Record<string, WordInfo> };

export function lyricWordsFor(songId: string): LyricWords | null {
  const mine = lines.filter(l => l.song === songId);
  if (!mine.length) return null;
  const toks: LyricWords['toks'] = {};
  const words: LyricWords['words'] = {};
  for (const l of mine) {
    const spans = byLine.get(l.id) ?? [];
    toks[l.ja] = spans;
    for (const [, , lemma] of spans) {
      if (words[lemma]) continue;
      const posts = postings[lemma] ?? [];
      const songs = new Set(posts.map(p => lines[p[0]].song));
      const ex: WordInfo['ex'] = [];
      const seen = new Set<string>();
      for (const [lid, s, e] of posts) {
        const L = lines[lid];
        if (L.song === songId || seen.has(L.song)) continue;
        seen.add(L.song);
        ex.push({ ja: L.ja, zh: L.zh ?? '', s, e, title: L.title, id: L.song });
        if (ex.length === 3) break;
      }
      const v = vocab.get(lemma);
      songs.delete(songId);
      words[lemma] = {
        head: v?.head || lemma, read: v?.read ?? '', pos: v?.pos ?? '', lines: v?.lines ?? posts.length, songs: songs.size + 1,
        forms: Object.entries(v?.forms ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 4), ex, more: Math.max(0, songs.size - ex.length),
      };
    }
  }
  return { toks, words };
}
