import { test, expect, type Page } from '@playwright/test';
import { readdirSync, existsSync } from 'node:fs';

// 每一頁: 狀態碼對、沒有 console error / 未捕捉的例外、沒有橫向捲動、主要區塊有出現。
// 外部請求 (YouTube、GitHub API、Google Fonts…) 一律在這裡擋掉, 回空的假回應,
// 測試不吃網路、也不會因為外站慢或掛掉而紅。

const STATIC_PAGES = [
  '/', '/about/', '/diary/', '/projects/', '/translations/', '/translations/tags/', '/extras/', '/setlists/',
  '/live/', '/live/full/', '/live/timeline/', '/live/concerts/', '/live/footprint/',
  '/lyric-universe/', '/kwic/', '/star-map/', '/gacha/', '/galaxy/',
  '/annotate/', '/admin/', '/year/2026/',
];

// 動態路由: 從 dist/ 抽頭、中、尾三個 (E2E_ALL=1 時全部跑)
function sample(route: string): string[] {
  const dir = `dist${route}`;
  if (!existsSync(dir)) return [];
  const ids = readdirSync(dir, { withFileTypes: true })
    // /translations/tags/ 是標籤頁, 不是一首歌 (上面 STATIC_PAGES 已經有)
    .filter((d) => d.isDirectory() && d.name !== 'tags' && existsSync(`${dir}${d.name}/index.html`))
    .map((d) => d.name)
    .sort();
  const picked = process.env.E2E_ALL ? ids : [...new Set([ids[0], ids[Math.floor(ids.length / 2)], ids[ids.length - 1]])];
  return picked.filter(Boolean).map((id) => `${route}${id}/`);
}
const DYNAMIC_PAGES = ['/translations/', '/live/full/', '/diary/', '/projects/'].flatMap(sample);

// 主要區塊預設是 h1 + main; 版面特殊的頁面另外指定
//   /galaxy/   全畫面 canvas, 子元素都是 fixed, main 本身高度 0
//   /annotate/ 手機版刻意把 h1 收起來 (一欄版面)
const READY: Record<string, string[]> = {
  '/galaxy/': ['canvas#space', '#title'],
  '/annotate/': ['main'],
};

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function stubExternal(page: Page) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => {
    const req = route.request();
    const type = req.resourceType();
    if (type === 'image') return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
    if (type === 'stylesheet') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (type === 'document') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' });
    if (type === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    if (type === 'font') return route.fulfill({ status: 404, body: '' });
    // fetch / xhr: GitHub API 之類, 回空陣列
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // 擋掉的外部字型 (404) 不算; 其他 404 要算
    const url = msg.location()?.url ?? '';
    if (/Failed to load resource/.test(text) && url && !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) return;
    errors.push(`${text}${url ? ` (${url})` : ''}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const over = doc.scrollWidth - doc.clientWidth;
    if (over <= 1) return null;
    const cw = doc.clientWidth;
    const culprits = [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > cw + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).split(' ').slice(0, 2).join('.')}`);
    return { over, culprits };
  });
}

for (const path of [...STATIC_PAGES, ...DYNAMIC_PAGES]) {
  test(`smoke ${path}`, async ({ page }) => {
    await stubExternal(page);
    const errors = watchErrors(page);

    const res = await page.goto(path, { waitUntil: 'load' });
    expect(res?.status(), 'HTTP status').toBe(200);

    // 主要區塊: 每頁都有 h1; 有 <main> 的頁面 main 要看得到
    const ready = READY[path] ?? ['h1', ...((await page.locator('main').count()) ? ['main'] : [])];
    for (const sel of ready) await expect(page.locator(sel).first(), sel).toBeVisible();

    await page.waitForTimeout(500);   // 讓 load 之後才跑的腳本 (canvas、資料注入) 有機會報錯
    expect(await horizontalOverflow(page), 'horizontal overflow').toBeNull();
    expect(errors, 'console errors').toEqual([]);
  });
}

test('404 頁', async ({ page }) => {
  await stubExternal(page);
  const res = await page.goto('/no-such-page/');
  expect(res?.status()).toBe(404);
  await expect(page.locator('h1').first()).toBeVisible();
  expect(await horizontalOverflow(page)).toBeNull();
});
