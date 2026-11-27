/**
 * /annotate/eval_seen.json — eval 快照 (scripts/eval_seen.txt) 的 videoId, 只給標注頁用。
 * 標注頁在 public/ 底下, 執行時讀不到 scripts/ 的檔案, 所以 build 時把它轉成 JSON;
 * 頁面拿來算「快照之後才盲標 / 從零手標完」的有幾支 (跟 eval_golden.py --split fresh 同一份清單)。
 * 重拍快照 (--snapshot) 後下一次 build 就跟著換, 不用手動同步。
 * 沒有快照檔 (eval_golden.py 也當作沒快照) 時不能讓整個網站 build 掛掉 → 輸出 ids: null, 頁面顯示 ?。
 */
import type { APIRoute } from 'astro';

const files = import.meta.glob<string>('../../../scripts/eval_seen.txt', { query: '?raw', import: 'default', eager: true });

export const GET: APIRoute = () => {
  const raw = Object.values(files)[0];
  let body: { label: string; ids: string[] | null } = { label: '', ids: null };
  if (raw !== undefined) {
    const lines = raw.split(/\r?\n/).map(l => l.trim());
    const label = (lines.find(l => l.startsWith('#')) ?? '').replace(/^#\s*/, '');
    const ids = lines.filter(l => l && !l.startsWith('#'));
    body = { label, ids: ids.length ? ids : null };   // 空快照 eval_golden 也當沒快照 (--split fresh 直接結束)
  }
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
