import { test, expect } from '@playwright/test';

// 320 寬的小手機 (iPhone SE 一代那種): 主要頁面不能左右滑。
// 之前頁尾右下的圖示列太寬, 每頁都會多出十幾 px 可以橫滑。
// 跟 smoke.spec.ts 一樣把外站擋掉, 不吃網路。

const PAGES = ['/', '/translations/', '/translations/nishina-1999/', '/translations/nishina-panda-girl/', '/translations/nishina-eden/', '/lyric-universe/', '/live/', '/live/full/', '/setlists/', '/about/'];

test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });

test.beforeEach(async ({ page }, info) => {
  // 寬度是上面寫死的, 兩個 project 跑一樣的東西, 留一個就好
  test.skip(info.project.name !== 'mobile', '只在 mobile project 跑');
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.fulfill({ status: 204, body: '' }));
});

for (const path of PAGES) {
  test(`320 寬不橫向捲動 ${path}`, async ({ page }) => {
    const res = await page.goto(path, { waitUntil: 'load' });
    expect(res?.status()).toBe(200);
    // 頁尾會等左下角指令列膠囊出來 (約 800ms 後) 再算一次版權字的位置, 要等它算完
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const se = document.scrollingElement!;
      const culprits = [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > 321)
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(' ')[0]}`);
      return { w: se.scrollWidth, culprits };
    });
    expect(r.w, `scrollWidth (超出的元素: ${r.culprits.join(', ')})`).toBeLessThanOrEqual(320);
  });
}
