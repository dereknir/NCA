import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { parseShow } from '../scripts/og-show.mjs';

// 完整 Live 分享圖卡: 每一頁的 og:image 要嘛是自己的 live-full 卡, 要嘛退回歌曲卡 (新上架還沒畫);
// 不比對「png 清單 = 頁面清單」— full_live.json 每天自動更新, 圖不會跟著重畫
test('每個完整 Live 頁的分享圖卡都在, 而且是 1200×630 png', async ({ request }) => {
  const ids = readdirSync('dist/live/full', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) {
    const html = readFileSync(`dist/live/full/${id}/index.html`, 'utf-8');
    const og = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
    const tw = html.match(/<meta name="twitter:image" content="([^"]+)"/)?.[1];
    expect(og, id).toMatch(new RegExp(`/og/(live-full|song)/${id}\\.png$`));
    expect(tw, id).toBe(og);
    const res = await request.get(new URL(og!, 'http://x').pathname);
    expect(res.status(), id).toBe(200);
    const buf = await res.body();
    expect(buf.subarray(1, 4).toString('ascii'), id).toBe('PNG');
    expect([buf.readUInt32BE(16), buf.readUInt32BE(20)], id).toEqual([1200, 630]);
  }
});

test('完整 Live 用到的 live shorts, 標題有 @ 的都抓得到場次', () => {
  const songs = JSON.parse(readFileSync('src/data/full_live.json', 'utf-8')).songs as { shorts: { title: string; live: boolean }[] }[];
  const titles = songs.flatMap((s) => s.shorts).filter((s) => s.live && s.title.includes('@')).map((s) => s.title);
  for (const title of titles) expect(parseShow(title), title).not.toBeNull();
  expect(parseShow('hatsu @Zepp Tokyo 2021.6.25')).toEqual({ name: 'hatsu', venue: 'Zepp Tokyo', date: '2021.6.25' });
  expect(parseShow('MUSICK @foo @東京国際フォーラム 2025-04-12 Day2 #shorts')).toEqual({ name: 'MUSICK', venue: '東京国際フォーラム', date: '2025.4.12' });
  expect(parseShow('2026.4.4 at Zepp Namba')).toBeNull();
});
