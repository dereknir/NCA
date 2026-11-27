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
