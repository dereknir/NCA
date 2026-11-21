#!/usr/bin/env node
/**
 * full_live_plan.mjs — 把網站現在的完整 Live 排段印成 JSON (跟建站 / 瀏覽器同一份 src/lib/fullLive.ts)
 * scripts/full_live_vocals.py (量每句開口 / 唱完的時間) 和切點驗收用。
 *
 *   node scripts/full_live_plan.mjs          只印能上架 (complete) 的歌
 *   node scripts/full_live_plan.mjs --all    全部有 live 素材的歌
 * 輸出: [{ id, n, complete, segs: [{ v, from, to, start, end, live, long }] }]
 * (Node 22.18+ / 24 可以直接 import .ts)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { plan, summary } = await import(pathToFileURL(join(root, 'src/lib/fullLive.ts')).href);
const songs = JSON.parse(readFileSync(join(root, 'src/data/full_live.json'), 'utf8')).songs;
const all = process.argv.includes('--all');
const out = [];
for (const s of songs) {
  const complete = summary(s).complete;
  if (!all && !complete) continue;
  out.push({
    id: s.id, n: s.lines.length, complete,
    segs: plan(s).filter(g => !g.gap).map(g => ({
      v: g.v, from: g.from, to: g.to, start: +g.start.toFixed(2), end: +g.end.toFixed(2), live: g.live,
      long: s.shorts.some(x => x.v === g.v && x.long),
    })),
  });
}
process.stdout.write(JSON.stringify(out));
