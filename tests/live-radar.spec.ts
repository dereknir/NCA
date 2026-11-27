import { test, expect, type Page } from '@playwright/test';

// /live/ 的雷達版面:
//   手機 (390): 雷達是標題下面的一條橫列 — 整個 hero (標題 + 雷達) 不超過第一屏的 62% (原本約 72%),
//               雷達整個在第一屏裡、看得到; 點擊目標夠大; 鍵盤選到的提示框不會跑出畫面。
//   桌機 (1440): 跟原本一樣 — 雷達 240×240 浮在 hero 右側, 跟標題同一列。
// 外部請求一律擋掉 (跟 smoke.spec.ts 一樣), 測試不吃網路。

const HERO_SHARE_MAX = 0.62;

async function stubExternal(page: Page) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: '' }));
}

async function boxes(page: Page) {
  return page.evaluate(() => {
    const r = (s: string) => {
      const b = document.querySelector(s)!.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height };
    };
    return {
      vh: innerHeight, vw: document.documentElement.clientWidth,
      hero: r('.sh-hero'), text: r('.sh-hero-text'), title: r('.sh-title'),
      radar: r('.lr'), box: r('.lr-box'), caption: r('.lr figcaption'),
      position: getComputedStyle(document.querySelector('.lr')!).position,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await stubExternal(page);
  await page.goto('/live/', { waitUntil: 'load' });
  await expect(page.locator('.lr-box')).toBeVisible();
});

test('手機: 雷達是標題下面的橫列, 標題區不超過第一屏 62%', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', '只看手機版面');
  const b = await boxes(page);

  // 標題區 (hero 底) 佔第一屏的比例
  expect(b.hero.bottom / b.vh, `hero 佔第一屏 ${(b.hero.bottom / b.vh * 100).toFixed(1)}%`).toBeLessThanOrEqual(HERO_SHARE_MAX);

  // 雷達整個在第一屏、在標題下面、沒有超出左右
  expect(b.radar.top).toBeGreaterThanOrEqual(b.title.bottom);
  expect(b.radar.bottom).toBeLessThanOrEqual(b.vh);
  expect(b.radar.left).toBeGreaterThanOrEqual(0);
  expect(b.radar.right).toBeLessThanOrEqual(b.vw);
  await expect(page.locator('.lr canvas')).toBeInViewport({ ratio: 1 });

  // 橫列: 說明在雷達右邊, 跟雷達垂直置中在同一列
  expect(b.caption.left).toBeGreaterThanOrEqual(b.box.right);
  expect(b.caption.top).toBeGreaterThanOrEqual(b.box.top);
  expect(b.caption.bottom).toBeLessThanOrEqual(b.box.bottom);
  expect(b.box.width).toBe(120);
});

test('手機: 鍵盤選場次, 提示框留在畫面裡', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', '只看手機版面');
  await page.locator('.lr-box').focus();
  const tip = page.locator('.lr-tip');
  for (const key of ['Home', 'End', 'ArrowLeft']) {
    await page.keyboard.press(key);
    await expect(tip).toBeVisible();
    const r = await tip.boundingBox();
    const vw = await page.evaluate(() => document.documentElement.clientWidth);
    expect(r!.x, key).toBeGreaterThanOrEqual(0);
    expect(r!.x + r!.width, key).toBeLessThanOrEqual(vw);
  }
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
});

test('桌機: 雷達還是在 hero 右側, 跟標題同一列', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', '只看桌機版面');
  const b = await boxes(page);

  expect(b.position).toBe('absolute');
  expect(b.box.width).toBe(240);
  expect(b.box.height).toBe(240);
  // 在文字欄右邊, 不重疊
  expect(b.radar.left).toBeGreaterThanOrEqual(b.text.right);
  expect(b.radar.right).toBeLessThanOrEqual(b.vw);
  // 垂直方向在 hero 裡面, 而且跟標題同一列 (不是排到標題下面)
  expect(b.radar.top).toBeGreaterThanOrEqual(b.hero.top);
  expect(b.radar.bottom).toBeLessThanOrEqual(b.hero.bottom);
  expect(b.radar.top).toBeLessThan(b.title.bottom);
  // 說明置中在雷達下方
  expect(b.caption.top).toBeGreaterThanOrEqual(b.box.bottom);
  expect(await page.locator('.lr figcaption').evaluate((e) => getComputedStyle(e).textAlign)).toBe('center');
  // hero 高度沒有因為雷達變高 (原本 342px)
  expect(b.hero.height).toBeLessThanOrEqual(360);
});
