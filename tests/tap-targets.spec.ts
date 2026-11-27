import { test, expect } from '@playwright/test';

// 手機點擊區至少 24px (WCAG 2.5.8)。11/27 用 390 寬把 20 頁掃一遍找到的: 宇宙頁彗星卡的 ✕ 只有 11×15,
// 左上「← Derek's Site」只有 15 高。(kwic 勾選框在整個 label 裡、公演史「U+」那行只有它一個連結, 不算)

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.fulfill({ status: 204, body: '' }));
});

test('/galaxy/ 彗星卡 ✕ 與回首頁連結夠大, ✕ 有名稱、按了會收起', async ({ page }) => {
  await page.goto('/galaxy/');
  const card = page.locator('#cometCard');
  await card.evaluate((el) => el.classList.add('show'));
  const x = card.locator('.cc-x');
  await expect(x).toHaveAccessibleName('收起');
  const xb = (await x.boundingBox())!;
  expect(Math.min(xb.width, xb.height)).toBeGreaterThanOrEqual(24);
  // ✕ 不能蓋到卡片標題的字
  await card.locator('.cc-n').evaluate((el) => { el.textContent = 'ほうき星 長い名前のテストですよ'; });
  const textRight = await card.locator('.cc-n').evaluate((el) => {
    const r = document.createRange(); r.selectNodeContents(el);
    return Math.max(...[...r.getClientRects()].map((q) => q.right));
  });
  // 桌機卡片依內容變寬, ✕ 會跟著移 → 換完標題再量一次
  const xb2 = (await x.boundingBox())!;
  expect(textRight).toBeLessThanOrEqual(xb2.x + 1);
  await x.click();
  await expect(card).not.toHaveClass(/show/);

  const back = page.locator('#title a[href="/"]');
  const bb = (await back.boundingBox())!;
  expect(bb.height).toBeGreaterThanOrEqual(24);
});

// 日記 / 作品集內頁文章最底下的「← 返回」只有 16 高, 而且是單獨一個連結 (不在句子裡), 不適用行內例外
for (const path of ['/diary/2026-03-23-first-diary/', '/projects/how-nca-works/']) {
  test(`${path} 「← 返回」連結夠大, 位置不變`, async ({ page }) => {
    await page.goto(path);
    const back = page.locator('a.sh-back').first();
    const bb = (await back.boundingBox())!;
    expect(bb.height).toBeGreaterThanOrEqual(24);
    // 加大點擊區不能讓連結文字或下面的內容移動: 比較只用行內排版時, 文字本身與整篇文章的位置 / 高度
    const shift = await back.evaluate((el) => {
      const art = el.closest('article') ?? document.body;
      const measure = () => {
        const r = document.createRange(); r.selectNodeContents(el);
        const t = r.getClientRects()[0];
        const a = art.getBoundingClientRect();
        return [t.top, t.left, a.height];
      };
      const before = measure();
      const s = (el as HTMLElement).style;
      s.display = 'inline'; s.padding = '0'; s.margin = '0';
      const after = measure();
      s.display = s.padding = s.margin = '';
      return Math.max(...before.map((v, i) => Math.abs(v - after[i])));
    });
    expect(shift).toBeLessThanOrEqual(1);
    await back.click();
    await expect(page).toHaveURL(/\/(diary|projects)\/?$/);
  });
}
