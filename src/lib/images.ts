/**
 * public 底下幾個資料夾的圖, build 時另外產生一份縮小的 WebP: /setlists/covers/x.jpg → /img/setlists/covers/x.webp
 * 檔案由 src/pages/img/[...file].ts 用 sharp 產生 (不放大)。原圖留著, 分享圖 (og:image) 還是用原本的 jpg。
 * 寬度是顯示尺寸的 2 倍: setlist 巡演封面顯示 112px → 224; 作品集封面最寬約 800px 的一整欄 → 1200 (原圖就是 1200)。
 */
export const IMAGE_DIRS = {
  'setlists/covers': 224,
  'images/projects': 1200,
} as const;

export function webpOf(src: string | undefined | null): string | undefined {
  if (!src) return undefined;
  const m = src.match(/^\/(.+)\/([^/]+)\.(jpe?g|png)$/i);
  if (!m || !(m[1] in IMAGE_DIRS)) return src;
  return `/img/${m[1]}/${m[2]}.webp`;
}
