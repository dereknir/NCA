/**
 * /annotate/eval_seen.json — eval 快照 (scripts/eval_seen.txt) 的 videoId, 只給標注頁用。
 * 標注頁在 public/ 底下, 執行時讀不到 scripts/ 的檔案, 所以 build 時把它轉成 JSON;
 * 頁面拿來算「快照之後才盲標 / 從零手標完」的有幾支 (跟 eval_golden.py --split fresh 同一份清單)。
 * 重拍快照 (--snapshot) 後下一次 build 就跟著換, 不用手動同步。
 */
import type { APIRoute } from 'astro';
import raw from '../../../scripts/eval_seen.txt?raw';

export const GET: APIRoute = () => {
  const lines = raw.split(/\r?\n/).map(l => l.trim());
  const label = (lines.find(l => l.startsWith('#')) ?? '').replace(/^#\s*/, '');
  const ids = lines.filter(l => l && !l.startsWith('#'));
  return new Response(JSON.stringify({ label, ids }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
