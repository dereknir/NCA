import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// 標注頁 🤖 機器建議面板: 評級 C 的原因提示 (not_single_song / ambiguous_start)。
// auto_anchors.json 用 route 換成假資料, 不動真的資料檔; 外部請求 (YouTube 等) 一律擋掉。

const queue = JSON.parse(readFileSync('public/annotate/annotation_queue.json', 'utf-8')).queue;
const first = Object.values(queue).flat()[0] as { videoId: string; songId: string };

const fixture = {
  meta: {},
  items: {
    [first.videoId]: {
      videoId: first.videoId, songId: first.songId, queueSongId: first.songId, matchMethod: 'hashtag',
      songCandidates: [], transcript: [], anchors: [], confidence: 70, conflict: false,
      grade: 'C', needsReview: ['ambiguous_start', 'not_single_song'], nonSong: ['title', 'foreign'],
    },
  },
};

test('待審面板顯示「可能不是單曲」與「副歌重複」提示', async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.fulfill({ status: 200, body: '' }));
  await page.route('**/annotate/auto_anchors.json', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }));
  await page.goto('/annotate/');
  const drawer = page.locator('#queueToggle');   // 手機版清單收在抽屜裡
  if (await drawer.isVisible()) await drawer.click();
  await page.locator('.short-item').first().click();
  const why = page.locator('#autoPanel .why');
  await expect(why).toHaveCount(2);
  await expect(why.nth(0)).toContainText('可能不是單曲: 標題像活動 / 宣傳、轉寫大半像另一首歌');
  await expect(why.nth(1)).toContainText('副歌重複, 可能選到另一次');
  const box = await why.nth(0).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(24);
  if (process.env.SHOT_DIR) {
    await why.nth(0).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.SHOT_DIR}/hint-${page.viewportSize()!.width}.png` });
    await page.locator('#autoPanel').screenshot({ path: `${process.env.SHOT_DIR}/panel-${page.viewportSize()!.width}.png` });
  }
});
