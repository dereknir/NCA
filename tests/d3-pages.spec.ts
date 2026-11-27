import { test, expect, type Page } from '@playwright/test';

// 歌詞宇宙、星圖改用只留用到部分的 d3 之後, 真的去拖、去縮放一次。
// 少 export 一個函式的話頁面會直接丟 TypeError (被 pageerror 抓到), 或圖畫不出來。

async function open(page: Page, path: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.context().route('**/*', (route) => {
    const u = route.request().url();
    return u.startsWith('http://127.0.0.1') ? route.continue() : route.abort('blockedbyclient');
  });
  await page.goto(path);
  return errors;
}

test('歌詞宇宙: 力導向圖畫得出來, 節點拖得動, 點了側欄有內容', async ({ page }) => {
  const errors = await open(page, '/lyric-universe/');
  const nodes = page.locator('#net circle');
  await expect.poll(() => nodes.count()).toBeGreaterThan(5);
  await expect.poll(() => page.evaluate(() => typeof (window as any).d3?.forceSimulation)).toBe('function');

  const n = nodes.first();
  // 先點再拖: d3-drag 拖完會吞掉緊接著的那一下 click (本來就這樣設計)。
  // 節點還在模擬裡飄, 用座標點會點空, 所以直接對這顆派 click。
  await n.dispatchEvent('click');
  await expect(page.locator('#netside')).toContainText('出現');
  await n.scrollIntoViewIfNeeded();
  const cx0 = Number(await n.getAttribute('cx'));
  const box = (await n.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 8 });
  // 拖曳中節點固定在指標下 (fx), 位置要跟著動
  await expect.poll(async () => Math.abs(Number(await n.getAttribute('cx')) - cx0)).toBeGreaterThan(20);
  await page.mouse.up();

  expect(errors).toEqual([]);
});

test('星圖: 星星畫得出來, 滾輪縮放、重設鈕回原位', async ({ page }) => {
  const errors = await open(page, '/star-map/');
  await expect.poll(() => page.locator('#sky circle').count()).toBeGreaterThan(5);
  await expect(page.locator('#side')).not.toContainText('D3 載入失敗');

  const root = page.locator('#sky > g').first();
  const sky = (await page.locator('#sky').boundingBox())!;
  await page.mouse.move(sky.x + sky.width / 2, sky.y + sky.height / 2);
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await root.getAttribute('transform')) ?? '').toMatch(/scale\((?!1\))/);

  await page.locator('#reset').click();
  // 重設用 transition 回到 identity (d3-transition 沒帶到的話這裡會丟錯)
  await expect.poll(async () => (await root.getAttribute('transform')) ?? '', { timeout: 3000 }).toMatch(/translate\(0,0\) scale\(1\)/);
  expect(errors).toEqual([]);
});
