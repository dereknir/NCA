import { test, expect } from '@playwright/test';

// DotGothic16 改自己放 (public/fonts/dotgothic16/dg16-site.woff2, @font-face 在 site-shell.css):
// 用到它的頁面不能再跟 Google 要 DotGothic16, 自己的字型檔要抓得到, 而且真的有套上去。

const PAGES = ['/translations/nishina-1999/', '/live/timeline/', '/live/concerts/', '/live/footprint/'];
const SELF = '/fonts/dotgothic16/dg16-site.woff2';

for (const path of PAGES) {
  test(`DotGothic16 自己放: ${path}`, async ({ page }) => {
    const googleDG: string[] = [];
    // 外站一律擋掉 (測試不吃網路); 擋之前先記下有沒有人跟 Google 要 DotGothic16
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => {
      const url = route.request().url();
      if (/fonts\.(googleapis|gstatic)\.com/.test(url) && /dotgothic/i.test(url)) googleDG.push(url);
      return route.abort();
    });
    const self = page.waitForResponse((r) => new URL(r.url()).pathname === SELF, { timeout: 15_000 });

    const res = await page.goto(path, { waitUntil: 'load' });
    expect(res?.status()).toBe(200);
    expect(await res!.text()).not.toContain('family=DotGothic16');

    expect((await self).status()).toBe(200);

    await page.evaluate(() => document.fonts.ready);
    const faces = await page.evaluate(() =>
      [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'DotGothic16').map((f) => f.status),
    );
    expect(faces).toContain('loaded');
    expect(googleDG).toEqual([]);
  });
}
