/**
 * 封面縮圖: /covers/nishina/x.jpg → /covers/w80/nishina/x.webp
 * 檔案由 src/pages/covers/[w]/[...file].ts 在 build 時用 sharp 產生 (不放大, 原圖不夠寬就維持原寬)。
 * 列表縮圖顯示 40px → w80; 封面牆一格約 160px → w320; 歌曲頁封面 224px、唱片櫃 200px → w448 (都是 2 倍螢幕的尺寸)。
 */
export const COVER_WIDTHS = [80, 320, 448] as const;
export type CoverWidth = typeof COVER_WIDTHS[number];

export function coverAt(src: string | undefined | null, w: CoverWidth): string | undefined {
  if (!src) return undefined;
  const m = src.match(/^\/covers\/(.+)\.(jpe?g|png)$/i);
  return m ? `/covers/w${w}/${m[1]}.webp` : src;
}
