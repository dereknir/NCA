import { test, expect, type Page } from '@playwright/test';

// 歌詞宇宙共現網絡: 窄版 (≤760px) 側欄排在圖下面。以前點詞後句子在畫面外 (圖底剛好貼著畫面底時整個看不到),
// 現在點了會直接捲到側欄整個露出來; 桌機側欄在右邊, 點了不捲。

async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.context().route('**/*', (route) => {
    const u = route.request().url();
    return u.startsWith('http://127.0.0.1') ? route.continue() : route.abort('blockedbyclient');
  });
  await page.goto('/lyric-universe/');
  await expect.poll(() => page.locator('#net circle[role="button"]').count()).toBeGreaterThan(5);
  return errors;
}

// 把頁面捲到網絡圖的底邊剛好貼著畫面底 (使用者往下捲、剛看到整張圖的位置), 等力學停下來
async function graphAtBottom(page: Page) {
  await page.evaluate(() => {
    const b = document.getElementById('net')!.getBoundingClientRect();
    scrollTo({ top: scrollY + b.bottom - innerHeight, behavior: 'instant' });
  });
  await page.waitForTimeout(3000);
}

// 圖上看得到、真的點得到 (最上層) 的一個詞的中心
const visibleWord = (page: Page) =>
  page.evaluate(() => {
    const net = document.getElementById('net')!.getBoundingClientRect();
    const top = Math.max(net.top, 56) + 20, bottom = Math.min(net.bottom, innerHeight) - 20;
    for (const c of document.querySelectorAll('#net circle[data-name]')) {
      const r = c.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      if (y > top && y < bottom && document.elementFromPoint(x, y) === c) return { x, y, name: c.getAttribute('data-name') ?? '' };
    }
    throw new Error('找不到點得到的詞');
  });

// 側欄整個在畫面內, 而且沒被頂端 sticky 標頭蓋住
const sideInView = (page: Page) =>
  page.evaluate(() => {
    const s = document.getElementById('netside')!.getBoundingClientRect();
    const hd = document.querySelector('[data-sh-header]')!.getBoundingClientRect();
    return { top: s.top, bottom: s.bottom, hd: hd.bottom, ih: innerHeight };
  });

test('歌詞宇宙手機: 點詞 → 側欄整個捲進畫面、看得到那個詞的句子', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', '只測窄版');
  const errors = await open(page);
  await graphAtBottom(page);
  const w = await visibleWord(page);
  await page.touchscreen.tap(w.x, w.y);
  const side = page.locator('#netside');
  await expect(side.locator('b').first()).toHaveText(w.name);
  await expect(side.locator('.refline').first()).toBeInViewport();
  const m = await sideInView(page);
  expect(m.top).toBeGreaterThanOrEqual(m.hd);
  expect(m.bottom).toBeLessThanOrEqual(m.ih);
  expect(errors).toEqual([]);
});

test('歌詞宇宙手機: 鍵盤 Enter 也捲到側欄, Esc 收起、焦點回到那個詞', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', '只測窄版');
  const errors = await open(page);
  await graphAtBottom(page);
  await page.locator('#net circle[tabindex="0"]').focus({ preventScroll: true } as never);
  const name = await page.locator('#net circle[tabindex="0"]').getAttribute('data-name');
  await page.keyboard.press('Enter');
  const side = page.locator('#netside');
  await expect(side.locator('b').first()).toHaveText(name!);
  const m = await sideInView(page);
  expect(m.top).toBeGreaterThanOrEqual(m.hd);
  expect(m.bottom).toBeLessThanOrEqual(m.ih);
  await page.keyboard.press('Escape');
  await expect(side).toContainText('點一個詞');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-name'))).toBe(name);
  expect(errors).toEqual([]);
});

test('歌詞宇宙桌機: 側欄照舊在圖右邊, 點詞不捲頁面', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', '只測桌機');
  const errors = await open(page);
  await page.locator('#net').scrollIntoViewIfNeeded();
  await page.waitForTimeout(3000);
  const y0 = await page.evaluate(() => scrollY);
  const w = await visibleWord(page);
  await page.mouse.click(w.x, w.y);
  await expect(page.locator('#netside b').first()).toHaveText(w.name);
  expect(await page.evaluate(() => scrollY)).toBe(y0);
  const sb = (await page.locator('#netside').boundingBox())!, net = (await page.locator('#net').boundingBox())!;
  expect(sb.x).toBeGreaterThanOrEqual(net.x + net.width - 1);
  expect(errors).toEqual([]);
});
