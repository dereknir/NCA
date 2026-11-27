import { test, expect, type Page } from '@playwright/test';

// 歌詞頁、足跡頁幾個修過的 bug, 各留一個測試守著 (2026-11-27 全站找 bug 的前五個)
// 外部請求一律擋掉 (跟 smoke 一樣), 測試不吃網路
const SONG = '/translations/nishina-wawon/';   // 有 shorts (很多張)、有中文 id 的小節

async function stubExternal(page: Page) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => {
    const type = route.request().resourceType();
    if (type === 'image') return route.fulfill({ status: 404, body: '' });
    if (type === 'stylesheet') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (type === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    if (type === 'document') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' });
    if (type === 'font') return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

test.beforeEach(async ({ page }) => { await stubExternal(page); });

test('#1 寬 900~1280 記住打開的目錄側欄: 點得到側欄的連結, 不會點到歌詞', async ({ page, isMobile }) => {
  test.skip(isMobile, '側欄只在寬螢幕還原');
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.addInitScript(() => { try { localStorage.setItem('nca-toc-open', '1'); } catch (e) {} });
  await page.goto(SONG);
  const drawer = page.locator('#toc-drawer');
  await expect(drawer).toHaveAttribute('open', '');
  // 捲到歌詞那一段, 側欄底下就是歌詞
  await page.locator('#L1').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const blocked = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>('#toc-drawer .toc-item').forEach((a) => {
      const r = a.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !a.contains(hit)) out.push(`${a.textContent} → ${hit?.tagName}.${hit?.className}`);
    });
    return out;
  });
  expect(blocked).toEqual([]);
  // 側欄的關閉鈕沒被頁首蓋住
  const closeHit = await page.evaluate(() => {
    const c = document.querySelector('#toc-drawer .toc-close')!, r = c.getBoundingClientRect();
    return c.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  });
  expect(closeHit).toBe(true);
  // 真的點一下: 網址換成那一節
  await page.locator('#toc-drawer .toc-item').last().click({ timeout: 3000 });
  await expect(page).toHaveURL(/#/);
});

test('#2 有 shorts 的歌: 只看歌詞 (H) 會把 shorts 架藏起來', async ({ page }) => {
  await page.goto(SONG);
  await expect(page.locator('.lyr-modes')).toBeVisible();
  const shelf = page.locator('article .shelf');
  await expect(shelf).toBeVisible();
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('h');
  await expect(page.locator('html')).toHaveClass(/lyr-focus/);
  await expect(shelf).toBeHidden();
  await expect(page.locator('#L1')).toBeVisible();
  await page.keyboard.press('h');
  await expect(shelf).toBeVisible();
});

test('#3 目錄會標出現在讀到的那一節 (中文 id)', async ({ page }) => {
  await page.goto(SONG);
  await page.waitForFunction(() => document.querySelectorAll('#toc-drawer .toc-item').length > 0);
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('.prose h2')].find((x) => x.id === '翻譯筆記')!;
    window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 100);
  });
  const cur = page.locator('#toc-drawer .toc-item[aria-current="true"]');
  await expect(cur).toHaveCount(1);
  await expect(cur).toHaveText('翻譯筆記');
});

test('#4 桌機 shorts 架超出時, 一開始就看得到右箭頭', async ({ page, isMobile }) => {
  test.skip(isMobile, '手機沒有箭頭 (用滑的)');
  await page.goto(SONG);
  const row = page.locator('article .shelf .shelf-row');
  await expect(row).toBeVisible();
  const overflows = await row.evaluate((el) => el.scrollWidth > el.clientWidth + 4);
  expect(overflows).toBe(true);
  await expect(page.locator('article .shelf .shelf-arrow-right')).toBeVisible();
  await expect(page.locator('article .shelf .shelf-arrow-left')).toBeHidden();
});

test('#5 足跡頁: 公演、出演都關掉不丟錯, 數字跟著變', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/live/footprint/');
  const facts = page.locator('#facts');
  await expect(facts).not.toBeEmpty();
  await page.locator('#lyOne').click();
  await page.locator('#lyApp').click();
  expect(errors).toEqual([]);
  await expect(facts).toContainText('0縣');
  await expect(facts).not.toContainText('最常出沒');
  // 再打開一個, 數字回來
  await page.locator('#lyApp').click();
  expect(errors).toEqual([]);
  await expect(facts).toContainText('最常出沒');
});
