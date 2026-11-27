import { test, expect, type Page } from '@playwright/test';

// 星圖、歌詞宇宙不用滑鼠也要能用: Tab 進圖 → 方向鍵換節點 → Enter 開側欄 → Esc 收起、焦點回原節點。
// 整張圖只佔一個 Tab 停點 (roving tabindex), 不然星圖 1000 多顆星要 Tab 到天荒地老。

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

// 名稱用 data-name 拿 (歌詞本身可能有「, 」「 — 」, 不能拆 aria-label)
const active = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as Element | null;
    return {
      tag: a?.tagName.toLowerCase(),
      role: a?.getAttribute('role'),
      name: a?.getAttribute('data-name') ?? '',
      label: a?.getAttribute('aria-label') ?? '',
      inSide: !!a?.closest('#side, #netside'),
    };
  });

// 焦點元素整顆在 sel 的框裡面 (tol = 容許差幾 px)
const focusInside = (page: Page, sel: string, tol = 0) =>
  page.evaluate(([sel, tol]) => {
    const a = document.activeElement!.getBoundingClientRect();
    const v = document.querySelector(sel as string)!.getBoundingClientRect();
    const t = tol as number;
    return a.width > 0 && a.left >= v.left - t && a.right <= v.right + t && a.top >= v.top - t && a.bottom <= v.bottom + t;
  }, [sel, tol]);

// 從 before 那個元素按一下 Tab 進圖
async function tabIn(page: Page, before: string) {
  await page.locator(before).evaluate((el) => {
    el.setAttribute('tabindex', '-1');
    (el as HTMLElement).focus();
  });
  await page.keyboard.press('Tab');
}

// 四個方向按一輪, 回傳第一次換到別顆的結果 (第一顆可能剛好在邊上)
async function moveSomewhere(page: Page) {
  const from = await active(page);
  for (const k of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
    await page.keyboard.press(k);
    const now = await active(page);
    if (now.name !== from.name) return now;
  }
  return from;
}

async function walk(page: Page, svg: string, side: string, live: string, before: string, sideHasLink: boolean) {
  const circles = page.locator(`${svg} circle[role="button"]`);
  await expect.poll(() => circles.count()).toBeGreaterThan(5);
  // 只有一個 Tab 停點
  await expect(page.locator(`${svg} circle[tabindex="0"]`)).toHaveCount(1);
  const placeholder = (await page.locator(side).textContent())!.trim().slice(0, 6);

  await tabIn(page, before);
  const first = await active(page);
  expect(first).toMatchObject({ tag: 'circle', role: 'button' });
  expect(first.name).not.toBe('');
  expect(first.label).toContain(first.name);
  // 焦點框有畫出來, 而且包住焦點元素
  await expect(page.locator(`${svg} .ring`)).toBeVisible();
  expect(await focusInside(page, `${svg} .ring .fg`, 1)).toBe(true);

  const moved = await moveSomewhere(page);
  expect(moved.tag).toBe('circle');
  expect(moved.name).not.toBe(first.name);
  expect(await focusInside(page, `${svg} .ring .fg`, 1)).toBe(true);
  // 換過去之後它就是新的 Tab 停點, 而且只有它
  await expect(page.locator(`${svg} circle[tabindex="0"]`)).toHaveCount(1);
  await expect(page.locator(`${svg} circle[tabindex="0"]`)).toHaveAttribute('data-name', moved.name);

  await page.evaluate(() => { (window as any).__node = document.activeElement; });
  await page.keyboard.press('Enter');
  // 側欄內容 = 這個節點的名稱 (星: 句子; 詞: 那個詞)
  await expect(page.locator(side)).toContainText(moved.name);
  await expect(page.locator(side)).not.toContainText(placeholder);
  await expect(page.locator(`${svg} circle[aria-pressed="true"]`)).toHaveCount(1);
  await expect(page.locator(`${svg} circle[aria-pressed="true"]`)).toHaveAttribute('data-name', moved.name);
  await expect(page.locator(live)).toContainText(moved.name);

  if (sideHasLink) {
    // Tab 走進側欄 (歌曲連結), 從那裡按 Esc
    await page.keyboard.press('Tab');
    expect((await active(page)).inSide).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator(side)).toContainText(placeholder);
  expect(await page.evaluate(() => document.activeElement === (window as any).__node)).toBe(true);
  await expect(page.locator(`${svg} circle[aria-pressed="true"]`)).toHaveCount(0);

  // Space 跟 Enter 一樣
  await page.keyboard.press(' ');
  await expect(page.locator(side)).toContainText(moved.name);

  // Alt+方向鍵留給瀏覽器 (上一頁), 圖不能吃掉
  const before2 = await active(page);
  await page.keyboard.press('Alt+ArrowRight');
  expect((await active(page)).name).toBe(before2.name);
}

test('星圖: 鍵盤 Tab 進圖、方向鍵換星、Enter 釘選、Esc 收起焦點回來', async ({ page }, info) => {
  const errors = await open(page, '/star-map/');
  // 手機寬側欄本來就藏起來, 只檢查內容, 不 Tab 進去
  await walk(page, '#sky', '#side', '#sky-live', '#reset', info.project.name !== 'mobile');
  expect(errors).toEqual([]);
});

test('星圖: 放大之後方向鍵跳到的星都在畫面裡 (視角會跟過去)', async ({ page }) => {
  const errors = await open(page, '/star-map/');
  await expect.poll(() => page.locator('#sky circle[role="button"]').count()).toBeGreaterThan(5);
  const root = page.locator('#sky > g').first();
  const sky = (await page.locator('#sky').boundingBox())!;
  await page.mouse.move(sky.x + sky.width / 2, sky.y + sky.height / 2);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -500);
  await expect.poll(async () => Number(/scale\(([\d.]+)\)/.exec((await root.getAttribute('transform')) ?? '')?.[1] ?? 1)).toBeGreaterThan(4);

  await tabIn(page, '#reset');
  expect(await focusInside(page, '#sky')).toBe(true);
  const seen = new Set<string>();
  for (const k of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowUp', 'ArrowUp']) {
    await page.keyboard.press(k);
    seen.add((await active(page)).name);
    expect(await focusInside(page, '#sky')).toBe(true);
  }
  expect(seen.size).toBeGreaterThan(3);
  expect(errors).toEqual([]);
});

test('星圖: 有過濾字時 Tab 停點跟方向鍵只在亮著的星之間', async ({ page }) => {
  const errors = await open(page, '/star-map/');
  await expect.poll(() => page.locator('#sky circle[role="button"]').count()).toBeGreaterThan(5);
  const q = '僕';   // 中文翻譯不會出現這個字, 亮的星 = 日文句子有它的
  await page.locator('#filter').fill(q);
  await expect(page.locator('#sky circle[tabindex="0"]')).toHaveCount(1);
  expect(await page.locator('#sky circle[tabindex="0"]').getAttribute('data-name')).toContain(q);

  await tabIn(page, '#reset');
  expect((await active(page)).name).toContain(q);
  const seen = new Set<string>();
  for (const k of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
    await page.keyboard.press(k);
    const now = await active(page);
    expect(now.name).toContain(q);
    seen.add(now.name);
  }
  expect(seen.size).toBeGreaterThan(1);

  await page.locator('#filter').fill('zzzqqq');
  await expect(page.locator('#sky-live')).toHaveText('沒有相符的星');
  expect(errors).toEqual([]);
});

test('歌詞宇宙: 鍵盤 Tab 進網絡圖、方向鍵換詞、Enter 看句子、Esc 收起焦點回來', async ({ page }) => {
  const errors = await open(page, '/lyric-universe/');
  await page.locator('#s-net').scrollIntoViewIfNeeded();
  await walk(page, '#net', '#netside', '#net-live', '#s-net h2', true);
  expect(errors).toEqual([]);
});

test('歌詞宇宙: 方向鍵換詞不會順便捲頁面 (矮視窗)', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  const errors = await open(page, '/lyric-universe/');
  await expect.poll(() => page.locator('#net circle[role="button"]').count()).toBeGreaterThan(5);
  await page.waitForTimeout(3000);   // 等力學停下來, 節點位置才不會一直變
  await tabIn(page, '#s-net h2');
  // 圖比視窗高: 新的詞還在視窗裡就一格都不能捲 (方向鍵預設會捲頁面);
  // 跑出視窗才准捲, 而且捲完要看得到它
  for (const k of ['ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
    const y0 = await page.evaluate(() => scrollY);
    await page.keyboard.press(k);
    const { y1, top, bottom, ih } = await page.evaluate(() => {
      const b = document.activeElement!.getBoundingClientRect();
      return { y1: scrollY, top: b.top, bottom: b.bottom, ih: innerHeight };
    });
    expect(top).toBeGreaterThanOrEqual(-1);
    expect(bottom).toBeLessThanOrEqual(ih + 1);
    if (y1 !== y0) {
      // 捲之前它在哪 (換回捲動前的座標) — 一定是在視窗外
      const top0 = top + (y1 - y0), bottom0 = bottom + (y1 - y0);
      expect(top0 < 0 || bottom0 > ih).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});
