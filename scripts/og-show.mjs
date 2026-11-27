/**
 * og-show.mjs — 從官方 shorts 標題抓場次 (og-pages.mjs 的完整 Live 卡用; tests/full-live-og.spec.ts 也會測)
 *   「hatsu @Zepp Tokyo 2021.6.25」→ { name: 'hatsu', venue: 'Zepp Tokyo', date: '2021.6.25' }
 * 日期分隔 . / - 都收, 日期後面可以接別的字 (#shorts、Day2…); 標題裡有好幾個 @ 時場地取最後一個 @ 之後。
 * 抓不到 (沒有 @ 或沒有日期) 回 null。
 * @param {string} title
 * @returns {{ name: string, venue: string, date: string } | null}
 */
export function parseShow(title) {
  const at = title.lastIndexOf('@');
  if (at < 0) return null;
  const m = title.slice(at + 1).match(/^\s*(.+?)\s+(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?!\d)/);
  if (!m) return null;
  const name = title.slice(0, title.indexOf('@')).trim();
  return { name, venue: m[1].trim(), date: `${m[2]}.${+m[3]}.${+m[4]}` };
}
