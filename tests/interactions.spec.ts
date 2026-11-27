import { test, expect, type Page } from '@playwright/test';

// 真的去「操作」的測試: 指令列、扭蛋、足跡篩選、日文詞小卡。
// 其他 spec 大多只確認頁面打得開, 這裡是按鍵、點擊之後狀態有沒有對。
// 外部請求一律擋掉 (跟 smoke 一樣); 一律等狀態, 不用 waitForTimeout。
const SONG = '/translations/nishina-wawon/';

async function stubExternal(page: Page) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'font') return route.fulfill({ status: 404, body: '' });
    if (type === 'stylesheet') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (type === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    if (type === 'document') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test.beforeEach(async ({ page }) => { await stubExternal(page); });

/* ---------- 指令列 ---------- */
// 手機 (pointer: coarse) 的膠囊是 N247i, 指令列主要給實體鍵盤用, 只跑桌機
test.describe('指令列', () => {
  test.skip(({ isMobile }) => isMobile, '指令列靠實體鍵盤, 手機是 N247i');

  const input = (page: Page) => page.locator('.sh-cli input[role="combobox"]');
  const options = (page: Page) => page.locator('#sh-cli-out [role="option"]');

  async function ready(page: Page, path: string) {
    await page.goto(path);
    // 指令列在 site-index.json 抓到之後才建
    await expect(page.locator('.sh-cli .sh-cli-pill')).toBeAttached();
  }

  test('按 / 打開, 打字篩選, 方向鍵選 + Enter 換頁', async ({ page }) => {
    const errors = watchPageErrors(page);
    await ready(page, '/');
    await page.keyboard.press('/');
    await expect(page.locator('.sh-cli')).toHaveClass(/\bopen\b/);
    await expect(input(page)).toBeFocused();

    // 只打 / 列出全部指令; 再打 live 只剩 /live 開頭的
    await page.keyboard.type('/');
    await expect(options(page).first()).toBeVisible();
    const all = await options(page).count();
    await page.keyboard.type('live');
    await expect(input(page)).toHaveValue('/live');
    await expect.poll(() => options(page).count()).toBeLessThan(all);
    const keys = await options(page).locator('span:first-child').allTextContents();
    expect(keys.length).toBeGreaterThanOrEqual(2);
    for (const k of keys) expect(k).toMatch(/^\/live/);

    // 一開始選第一個; ↓ 換到第二個, aria-activedescendant 跟著走; ↑ 再回來; ↓ 再過去
    await expect(options(page).nth(0)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(options(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(options(page).nth(0)).toHaveAttribute('aria-selected', 'false');
    await expect(input(page)).toHaveAttribute('aria-activedescendant', 'sh-cli-o1');
    await page.keyboard.press('ArrowUp');
    await expect(options(page).nth(0)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(options(page).nth(1)).toHaveAttribute('aria-selected', 'true');

    const href = (await options(page).nth(1).getAttribute('href'))!;
    expect(href).toMatch(/^\/live\/./);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(href.replace(/\/$/, '') + '/?$'));
    expect(errors).toEqual([]);
  });

  test('搜歌名: 第一個結果就是那首歌, Enter 打開歌詞頁', async ({ page }) => {
    await ready(page, '/');
    await page.keyboard.press('/');
    await expect(input(page)).toBeFocused();
    await page.keyboard.type('わをん');
    const first = options(page).first();
    await expect(first).toBeVisible();
    // 在首頁搜: 頁面排前面, 但「わをん」不是頁名, 所以第一個就是歌
    await expect(first).toHaveAttribute('href', '/translations/nishina-wawon');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/translations\/nishina-wawon\/?$/);
  });

  test('Esc 關掉, 焦點回到打開前停的地方; 沒有結果時顯示 command not found', async ({ page }) => {
    await ready(page, '/about/');
    const before = page.locator('main a[href]').first();
    await before.focus();
    await expect(before).toBeFocused();

    await page.keyboard.press('/');
    await expect(input(page)).toBeFocused();
    await page.keyboard.type('zzzz-沒有這個');
    await expect(page.locator('#sh-cli-out .none')).toContainText('command not found');
    await expect(input(page)).toHaveAttribute('aria-expanded', 'false');

    await page.keyboard.press('Escape');
    await expect(page.locator('.sh-cli')).not.toHaveClass(/\bopen\b/);
    await expect(input(page)).toHaveValue('');
    await expect(before).toBeFocused();
    // 關掉之後再按 / 還開得起來 (Esc 沒有被別的東西吃掉)
    await page.keyboard.press('/');
    await expect(page.locator('.sh-cli')).toHaveClass(/\bopen\b/);
  });
});

/* ---------- 扭蛋 ---------- */
// 旋鈕在 120×110 的場景座標 (52, 66), canvas 等比放大, 換算成畫面上的點
async function clickKnob(page: Page) {
  const box = (await page.locator('#machine').boundingBox())!;
  await page.locator('#machine').click({ position: { x: (52.5 / 120) * box.width, y: (66.5 / 110) * box.height } });
}

test('扭蛋: 點旋鈕抽一張, 卡片下面的歌連結打得開、是同一首歌', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/gacha/');
  // 卡池、字型載完, 提示才會換成「點機器抽一張」
  await expect(page.locator('#hint')).toContainText('點機器抽一張');
  await expect(page.locator('#hero')).toBeHidden();

  await clickKnob(page);
  await expect(page.locator('#hint')).toContainText('抽選中');
  // 演出大約 3 秒 (SR 會多搖兩下)
  await expect(page.locator('#hero')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#heroRarity')).toHaveText(/^(N|R|SR|LIVE)$/);

  const link = page.locator('#heroSong a');
  await expect(link).toBeVisible();
  const href = (await link.getAttribute('href'))!;
  expect(href).toMatch(/^\/translations\/[a-z0-9-]+$/);
  const title = (await link.textContent())!.replace(/\s*→\s*#\d+$/, '').trim();
  expect(title.length).toBeGreaterThan(0);

  const res = await page.request.get(href);
  expect(res.ok()).toBe(true);
  expect(await res.text()).toContain(title);

  // 收進圖鑑: 卡片收起來, 圖鑑數字變成 1 / N
  await page.locator('#heroKeep').click();
  await expect(page.locator('#hero')).toBeHidden();
  await expect(page.locator('#bookCount')).toHaveText(/^1 \/ \d+$/);
  expect(errors).toEqual([]);
});

/* ---------- 足跡篩選 ---------- */
// 公演 / 出演兩個圖層: 關掉一個, 地圖上的縣、每縣的數字、右邊清單、下面的「N縣」要一起變
async function mapState(page: Page) {
  return page.evaluate(() => {
    const hits = [...document.querySelectorAll('#map .tile.hit')].map((t) => (t as HTMLElement).dataset.p!);
    const nums = [...document.querySelectorAll('#map text.tnum')].reduce((n, t) => n + Number(t.textContent), 0);
    const facts = document.getElementById('facts')!.textContent!;
    const nPref = Number(/・(\d+)縣/.exec(facts)?.[1] ?? NaN);
    return { hits, nums, nPref };
  });
}
const sideCount = async (page: Page) => Number(/(\d+) 場/.exec((await page.locator('#side h3').textContent())!)?.[1]);

test('足跡: 關掉出演圖層, 地圖、清單、縣數一起變; 打開回到原樣', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/live/footprint/');
  await expect(page.locator('#facts .fact').first()).toBeVisible();

  const all = await mapState(page);
  expect(all.hits.length).toBeGreaterThan(0);
  expect(all.nPref).toBe(all.hits.length);

  // 東京公演、出演都有: 點下去看右邊清單
  await page.locator('#map .tile.hit[data-p="東京"]').click();
  await expect(page.locator('#side h3')).toContainText('東京');
  const tokyoAll = await sideCount(page);
  const tokyoOne = Number(/♪ 公演 ×(\d+)/.exec((await page.locator('#side').textContent())!)?.[1]);
  expect(tokyoOne).toBeGreaterThan(0);
  expect(tokyoAll).toBeGreaterThan(tokyoOne);

  // 關掉出演: 只剩公演站
  await page.locator('#lyApp').click();
  await expect(page.locator('#lyApp')).not.toHaveClass(/\bon\b/);
  await expect(page.locator('#side h3')).toContainText(`(${tokyoOne} 場)`);
  await expect(page.locator('#side .sgh')).toHaveCount(1);
  const oneOnly = await mapState(page);
  expect(oneOnly.hits.length).toBeLessThan(all.hits.length);
  expect(oneOnly.nums).toBeLessThan(all.nums);
  expect(oneOnly.nPref).toBe(oneOnly.hits.length);
  // 地圖上東京那塊的數字 (滑過去的 title) 跟清單一致
  await expect(page.locator('#map .tile.hit[data-p="東京"] title')).toHaveText(`東京・${tokyoOne} 場`);

  // 打開回來: 全部回到一開始的樣子
  await page.locator('#lyApp').click();
  await expect(page.locator('#lyApp')).toHaveClass(/\bon\b/);
  await expect(page.locator('#side h3')).toContainText(`(${tokyoAll} 場)`);
  await expect(page.locator('#map .tile.hit[data-p="東京"] title')).toHaveText(`東京・${tokyoAll} 場`);
  expect(await mapState(page)).toEqual(all);
  expect(errors).toEqual([]);
});

test('足跡: 兩層都關掉, 清單空掉、0縣; 再打開一層就回來', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/live/footprint/');
  await expect(page.locator('#facts .fact').first()).toBeVisible();
  await page.locator('#map .tile.hit[data-p="東京"]').click();
  await expect(page.locator('#side h3')).toContainText('東京');
  await page.locator('#lyApp').click();
  await page.locator('#lyOne').click();
  await expect(page.locator('#side h3')).toContainText('(0 場)');
  await expect(page.locator('#side .ev')).toHaveCount(0);
  await expect(page.locator('#map .tile.hit')).toHaveCount(0);
  await expect(page.locator('#facts')).toContainText('0縣');
  await page.locator('#lyOne').click();
  await expect(page.locator('#side .ev').first()).toBeVisible();
  expect((await mapState(page)).nPref).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

/* ---------- 日文詞小卡 ---------- */
// 找一個有讀音的詞 (資料在頁面裡的 JSON), 回傳它在所有 .w 裡的序號
async function wordWithReading(page: Page) {
  await expect(page.locator('[data-song-content] .lyrics-line .ja .w').first()).toBeAttached();
  return page.evaluate(() => {
    const D = JSON.parse(document.querySelector('[data-lyric-words]')!.textContent!);
    const ws = [...document.querySelectorAll<HTMLElement>('[data-song-content] .lyrics-line .ja .w')];
    const i = ws.findIndex((w) => D.words[w.dataset.l!]?.read);
    const w = D.words[ws[i].dataset.l!];
    return { i, head: w.head as string, read: w.read as string };
  });
}
const words = (page: Page) => page.locator('[data-song-content] .lyrics-line .ja .w');

test('日文詞小卡: 點詞打開 (有讀音), Esc 關掉、焦點回到詞上; 點外面也關', async ({ page, isMobile }) => {
  const errors = watchPageErrors(page);
  await page.goto(SONG);
  const { i, head, read } = await wordWithReading(page);
  const w = words(page).nth(i);
  const card = page.locator('.wcard');

  if (isMobile) await w.tap(); else await w.click();
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('role', 'dialog');
  await expect(card.locator('.wcard-hd b')).toHaveText(head);
  await expect(card.locator('.wcard-hd .rd')).toHaveText(read);
  await expect(w).toHaveAttribute('aria-expanded', 'true');
  await expect(card.locator('.x')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(w).toHaveAttribute('aria-expanded', 'false');
  await expect(w).toBeFocused();

  // 再開一次, 點小卡裡面不關, 點外面才關
  if (isMobile) await w.tap(); else await w.click();
  await expect(card).toBeVisible();
  await card.locator('.wcard-meta').click();
  await expect(card).toBeVisible();
  await page.locator('h1').first().click();
  await expect(card).toBeHidden();
  await expect(w).toHaveAttribute('aria-expanded', 'false');

  // 同一個詞再點一次是收起來
  if (isMobile) await w.tap(); else await w.click();
  await expect(card).toBeVisible();
  if (isMobile) await w.tap({ force: true }); else await w.click({ force: true });
  await expect(card).toBeHidden();
  expect(errors).toEqual([]);
});

test('日文詞小卡: 只用鍵盤 Tab 到詞、Enter 打開、Esc 關掉', async ({ page, isMobile }) => {
  test.skip(isMobile, '鍵盤操作看桌機');
  await page.goto(SONG);
  const { i, head } = await wordWithReading(page);
  const w = words(page).nth(i);
  // 從前一個可聚焦的東西 Tab 過來 (詞是 <button>, 本來就在 Tab 順序裡)
  if (i > 0) { await words(page).nth(i - 1).focus(); await page.keyboard.press('Tab'); }
  else await w.focus();
  await expect(w).toBeFocused();
  await page.keyboard.press('Enter');
  const card = page.locator('.wcard');
  await expect(card).toBeVisible();
  await expect(card.locator('.wcard-hd b')).toHaveText(head);
  await expect(card.locator('.x')).toBeFocused();
  // 關閉鈕用 Enter 也關得掉, 焦點回到詞
  await page.keyboard.press('Enter');
  await expect(card).toBeHidden();
  await expect(w).toBeFocused();
  // 空白鍵開、Esc 關
  await page.keyboard.press('Space');
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(w).toBeFocused();
});
