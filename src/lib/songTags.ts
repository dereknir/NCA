/**
 * 翻譯歌曲的標籤: md 裡只有一個 tags 陣列, 這裡照 src/data/song_tags.json 分成三組
 *   曲風 (genre) / 主題 (theme, 固定 18 個, 每首 1~3 個) / 合作與出處 (credit, feat、動畫主題曲…)
 * 詞彙表跟規則由 scripts/check_data.py 把關, 這裡只負責分組跟給連結。
 */
import taxonomy from '../data/song_tags.json';

export interface TagDef { name: string; slug: string; desc?: string }
export type TagGroup = 'genre' | 'theme' | 'credit';

export const GENRES: TagDef[] = taxonomy.genres;
export const THEMES: TagDef[] = taxonomy.themes;
export const CREDITS: string[] = taxonomy.credits;

const GENRE = new Map(GENRES.map(t => [t.name, t]));
const THEME = new Map(THEMES.map(t => [t.name, t]));

export const tagHref = (t: TagDef) => `/translations/tags/${t.slug}/`;

/** 有自己一頁的標籤 (曲風 + 主題), 用 slug 找 */
export const PAGED: Array<TagDef & { group: Exclude<TagGroup, 'credit'> }> = [
  ...THEMES.map(t => ({ ...t, group: 'theme' as const })),
  ...GENRES.map(t => ({ ...t, group: 'genre' as const })),
];

/** 依詞彙表分三組, 組內保持 md 裡寫的順序 (主題第一個是主要的) */
export function splitTags(tags: string[]) {
  return {
    genres: tags.flatMap(t => GENRE.get(t) ?? []),
    themes: tags.flatMap(t => THEME.get(t) ?? []),
    credits: tags.filter(t => !GENRE.has(t) && !THEME.has(t)),
  };
}
