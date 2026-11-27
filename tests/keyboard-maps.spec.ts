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

const active = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as Element | null;
    return {
      tag: a?.tagName.toLowerCase(),
      role: a?.getAttribute('role'),
      label: a?.getAttribute('aria-label') ?? '',
      inSide: !!a?.closest('#side, #netside'),
    };
  });

// 從圖前面的東西按一下 Tab 進圖, 然後把整套鍵盤流程走一遍
async function walk(page: Page, svg: string, side: string, before: string, sideHasLink: boolean) {
  const circles = page.locator(`${svg} circle[role="button"]`);
  await expect.poll(() => circles.count()).toBeGreaterThan(5);
  // 只有一個 Tab 停點
  await expect(page.locator(`${svg} circle[tabindex="0"]`)).toHaveCount(1);
  const placeholder = (await page.locator(side).textContent())!.trim().slice(0, 6);

  await page.locator(before).evaluate((el) => {
    el.setAttribute('tabindex', '-1');
    (el as HTMLElement).focus();
  });
  await page.keyboard.press('Tab');
  const first = await active(page);
  expect(first).toMatchObject({ tag: 'circle', role: 'button' });
  expect(first.label).not.toBe('');
  // 焦點框有畫出來
  await expect(page.locator(`${svg} .ring`)).toBeVisible();

  // 方向鍵會換到別的節點 (第一顆可能剛好在邊上, 四個方向總有一個走得動)
  let moved = first;
  for (const k of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
    await page.keyboard.press(k);
    moved = await active(page);
    if (moved.label !== first.label) break;
  }
  expect(moved.tag).toBe('circle');
  expect(moved.label).not.toBe(first.label);
  // 換過去之後它就是新的 Tab 停點
  await expect(page.locator(`${svg} circle[tabindex="0"]`)).toHaveAttribute('aria-label', moved.label);

  await page.evaluate(() => { (window as any).__node = document.activeElement; });
  await page.keyboard.press('Enter');
  // 側欄內容 = 這個節點的名稱 (星: 句子; 詞: 那個詞)
  const name = moved.label.split(/ — |, /)[0];
  await expect(page.locator(side)).toContainText(name);
  await expect(page.locator(side)).not.toContainText(placeholder);

  if (sideHasLink) {
    // Tab 走進側欄 (歌曲連結), 從那裡按 Esc
    await page.keyboard.press('Tab');
    expect((await active(page)).inSide).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator(side)).toContainText(placeholder);
  expect(await page.evaluate(() => document.activeElement === (window as any).__node)).toBe(true);

  // Space 跟 Enter 一樣
  await page.keyboard.press(' ');
  await expect(page.locator(side)).toContainText(name);
}

test('星圖: 鍵盤 Tab 進圖、方向鍵換星、Enter 釘選、Esc 收起焦點回來', async ({ page }, info) => {
  const errors = await open(page, '/star-map/');
  // 手機寬側欄本來就藏起來, 只檢查內容, 不 Tab 進去
  await walk(page, '#sky', '#side', '#reset', info.project.name !== 'mobile');
  expect(errors).toEqual([]);
});

test('歌詞宇宙: 鍵盤 Tab 進網絡圖、方向鍵換詞、Enter 看句子、Esc 收起焦點回來', async ({ page }) => {
  const errors = await open(page, '/lyric-universe/');
  await page.locator('#s-net').scrollIntoViewIfNeeded();
  await walk(page, '#net', '#netside', '#s-net h2', true);
  expect(errors).toEqual([]);
});
