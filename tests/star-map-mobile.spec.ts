import { test, expect, type Page } from '@playwright/test';

// 窄版 (≤820px) 星圖: 側欄放不下所以平常收起; 點一顆星要看得到那句歌詞 —
// 以前點了沒反應 (側欄 display:none), 現在改成貼在畫面底部的卡片, × 或 Esc 收起。

async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.context().route('**/*', (route) => {
    const u = route.request().url();
    return u.startsWith('http://127.0.0.1') ? route.continue() : route.abort('blockedbyclient');
  });
  await page.goto('/star-map/');
  await expect(page.locator('#sky circle[data-name]').first()).toBeAttached();
  return errors;
}

// 星圖可見範圍裡、真的點得到 (最上層) 的一顆星的中心
const visibleStar = (page: Page) =>
  page.evaluate(() => {
    const sky = document.getElementById('sky')!.getBoundingClientRect();
    for (const c of document.querySelectorAll('#sky circle[data-name]')) {
      const r = c.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      if (y > sky.top + 30 && y < sky.bottom - 30 && x > sky.left + 30 && x < sky.right - 30 && document.elementFromPoint(x, y) === c)
        return { x, y, name: c.getAttribute('data-name') ?? '' };
    }
    throw new Error('找不到點得到的星');
  });

test('手機: 點星 → 底部卡片出現那句歌詞, 整張卡在畫面內; × 收起', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', '只測窄版');
  const errors = await open(page);
  const side = page.locator('#side');
  await expect(side).toBeHidden();

  const s = await visibleStar(page);
  await page.touchscreen.tap(s.x, s.y);
  await expect(side).toBeVisible();
  await expect(side.locator('.pin .ja')).toHaveText(s.name);
  const box = (await side.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);

  // 收起鈕夠大好按 (24px 以上)
  const x = side.locator('.x');
  const xb = (await x.boundingBox())!;
  expect(Math.min(xb.width, xb.height)).toBeGreaterThanOrEqual(24);
  await x.tap();
  await expect(side).toBeHidden();
  expect(errors).toEqual([]);
});

test('手機: 鍵盤 Enter 釘選也看得到卡片, Esc 收起、焦點回到那顆星', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', '只測窄版');
  const errors = await open(page);
  await page.locator('#sky circle[tabindex="0"]').focus();
  await page.keyboard.press('Enter');
  const side = page.locator('#side');
  await expect(side).toBeVisible();
  await expect(side.locator('.pin .ja')).not.toBeEmpty();
  await page.keyboard.press('Escape');
  await expect(side).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.tagName.toLowerCase())).toBe('circle');
  expect(errors).toEqual([]);
});

test('桌機: 側欄照舊在右邊, 沒有 × 鈕', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', '只測桌機');
  const errors = await open(page);
  const s = await visibleStar(page);
  await page.mouse.click(s.x, s.y);
  const side = page.locator('#side');
  await expect(side.locator('.pin .ja')).toHaveText(s.name);
  await expect(side.locator('.x')).toBeHidden();
  const sb = (await side.boundingBox())!, sky = (await page.locator('#sky').boundingBox())!;
  expect(sb.x).toBeGreaterThanOrEqual(sky.x + sky.width - 1);
  expect(errors).toEqual([]);
});

test('手機: 點星後把圖拖走, 按 × 收起時鏡頭不跳回那顆星', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', '只測窄版');
  const errors = await open(page);
  const s = await visibleStar(page);
  await page.touchscreen.tap(s.x, s.y);
  await expect(page.locator('#side')).toBeVisible();
  // 在離那顆星遠的角落放大, 把它推出畫面 (等同手指把圖拖走)
  const sky = (await page.locator('#sky').boundingBox())!;
  const cx = s.x < sky.x + sky.width / 2 ? sky.x + sky.width - 15 : sky.x + 15;
  const cy = s.y < sky.y + sky.height / 2 ? sky.y + sky.height - 15 : sky.y + 15;
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(80); }
  const out = await page.evaluate(() => {
    const el = document.querySelector('#sky circle[aria-pressed="true"]')!.getBoundingClientRect();
    const v = document.getElementById('sky')!.getBoundingClientRect();
    return el.right < v.left || el.left > v.right || el.bottom < v.top || el.top > v.bottom;
  });
  expect(out).toBe(true);   // 前提: 釘選的星真的跑出畫面了
  const moved = await page.evaluate(() => document.querySelector('#sky > g')!.getAttribute('transform'));
  expect(moved).not.toBeNull();
  await page.locator('#side .x').tap();
  await expect(page.locator('#side')).toBeHidden();
  const after = await page.evaluate(() => document.querySelector('#sky > g')!.getAttribute('transform'));
  expect(after).toBe(moved);
  expect(errors).toEqual([]);
});

test('手機: 星圖夠高, 圖例只佔一排 (390×844 ≥ 400px; 375×667、橫放也看得到圖)', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', '只測窄版');
  const errors = await open(page);
  for (const [w, h, min] of [[390, 844, 400], [375, 667, 320], [740, 360, 300]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.reload();
    await expect(page.locator('#sky circle[data-name]').first()).toBeAttached();
    const sky = (await page.locator('#sky').boundingBox())!;
    expect(sky.height, `${w}×${h} 星圖高度`).toBeGreaterThanOrEqual(min);
    const lg = (await page.locator('#legend').boundingBox())!;
    expect(lg.height, `${w}×${h} 圖例高度`).toBeLessThan(60);
    // 頁面不能左右滑 (圖例自己橫滑)
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(w);
  }
  expect(errors).toEqual([]);
});

test('手機: 點靠近底部的星, 那顆星不會被卡片蓋住', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', '只測窄版');
  const errors = await open(page);
  // 找可見範圍最下面、點得到的星
  const pt = await page.evaluate(() => {
    const sky = document.getElementById('sky')!.getBoundingClientRect();
    let best: { x: number; y: number } | null = null;
    for (const c of document.querySelectorAll('#sky circle[data-name]')) {
      const r = c.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      if (y < sky.bottom - 10 && y < innerHeight - 10 && x > sky.left + 10 && x < sky.right - 10 && document.elementFromPoint(x, y) === c && (!best || y > best.y)) best = { x, y };
    }
    return best!;
  });
  await page.touchscreen.tap(pt.x, pt.y);
  const side = page.locator('#side');
  await expect(side).toBeVisible();
  const card = (await side.boundingBox())!;
  const star = (await page.locator('#sky circle[aria-pressed="true"]').boundingBox())!;
  expect(star.y + star.height).toBeLessThanOrEqual(card.y);
  expect(errors).toEqual([]);
});
