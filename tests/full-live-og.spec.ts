import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// 完整 Live 分享圖卡: 隨便挑兩首, og:image / twitter:image 指到自己那張, 而且真的是 1200×630 的 png
const songs: string[] = readFileSync('dist/live/full/index.html', 'utf-8').match(/\/live\/full\/[^/"?#]+\//g)
  ?.map((h) => h.split('/')[3]).filter((id, i, a) => id && a.indexOf(id) === i) ?? [];
// 每個 worker 都會重新載入這個檔, 挑的歌要一樣 (不然 test 名對不上) — 用 CI run id / 當天日期當種子, 每次跑換一組
let seed = Number(process.env.GITHUB_RUN_ID ?? new Date().toISOString().slice(0, 10).replace(/-/g, '')) >>> 0;
const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
const pool = [...songs], pick: string[] = [];
while (pick.length < 2 && pool.length) pick.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);

test('完整 Live 頁有資料可以挑', () => {
  expect(songs.length).toBeGreaterThanOrEqual(2);
});

for (const [i, id] of pick.entries()) {
  test(`完整 Live 分享圖卡 #${i + 1} (${id})`, async ({ page, request }) => {
    await page.goto(`/live/full/${id}/`);
    const og = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(og).toContain(`/og/live-full/${id}.png`);
    expect(await page.locator('meta[name="twitter:image"]').getAttribute('content')).toBe(og);
    const res = await request.get(new URL(og!, page.url()).pathname);
    expect(res.status()).toBe(200);
    const buf = await res.body();
    expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([1200, 630]);
  });
}
