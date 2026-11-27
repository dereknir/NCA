import { test, expect, type Page } from '@playwright/test';

// 公演史三頁 (年表 / 公演史 / 足跡) 只用鍵盤也要能用:
// 篩選、展開站點、SETLIST 選單、地圖點縣、蓋章、翻頁、參戰卡, 焦點都看得到、按了有反應、Esc 關得掉、焦點不掉回頁首。
// 三頁是 live/*.template.html + 資料產生的, 修正改範本 (inject.py 重產)。

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
    const a = document.activeElement as HTMLElement | null;
    return {
      tag: a?.tagName.toLowerCase(),
      cls: a?.getAttribute('class') ?? '',
      text: (a?.textContent ?? '').trim(),
      p: a?.getAttribute('data-p') ?? '',
      inSide: !!a?.closest('#side'),
      inModal: !!a?.closest('#cardModal'),
    };
  });

// 從 before 那個元素按一下 Tab (跟 keyboard-maps 一樣, 不用從頁首 Tab 幾十下)
async function tabFrom(page: Page, before: string) {
  await page.locator(before).first().evaluate((el) => {
    if (!el.hasAttribute('tabindex') && !(el as HTMLElement).matches('a,button,input')) el.setAttribute('tabindex', '-1');
    (el as HTMLElement).focus();
  });
  await page.keyboard.press('Tab');
}

// 用鍵盤聚焦時焦點框要看得到: 缺角按鈕有 clip-path, 畫在外面的框 (outline-offset >= 0) 會整個被切掉
const ringInside = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement;
    const cs = getComputedStyle(a);
    return {
      visible: a.matches(':focus-visible'),
      ok: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 &&
        (cs.clipPath === 'none' || parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth) <= 0),
    };
  });

// 焦點元素沒被黏在上面的頁首 / 篩選列蓋住
const notCovered = (page: Page, sticky: string) =>
  page.evaluate((sticky) => {
    const a = document.activeElement!.getBoundingClientRect();
    const bottom = Math.max(...[...document.querySelectorAll(sticky)].map((e) => e.getBoundingClientRect().bottom));
    return a.top >= bottom - 1;
  }, sticky);

test('年表: 篩選鈕焦點框看得到、Space 切換; Shift+Tab 往回走焦點不被黏著的篩選列蓋住', async ({ page }) => {
  const errors = await open(page, '/live/timeline/');
  await tabFrom(page, '#q');
  const chip = await active(page);
  expect(chip.cls).toContain('chip');
  expect(await ringInside(page)).toEqual({ visible: true, ok: true });
  const first = page.locator('#chips .chip').first();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  const n0 = await page.locator('#tl .item').count();
  await page.keyboard.press(' ');
  await expect(first).toHaveAttribute('aria-pressed', 'false');
  expect(await page.locator('#tl .item').count()).toBeLessThan(n0);
  await page.keyboard.press('Enter');
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  // 參戰鈕 (最後一顆) 也一樣
  await page.locator('#chips .chip.mine').focus();
  expect(await ringInside(page)).toEqual({ visible: true, ok: true });

  // 往下 Tab 到年表很裡面, 再 Shift+Tab 往回走
  await tabFrom(page, '#chips .chip.mine');
  for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Shift+Tab');
    if ((await active(page)).cls.includes('chip')) break;
    expect(await notCovered(page, '.sh-hd, #chips')).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('年表: 今日のにしな 用鍵盤按圓點焦點不掉、焦點在裡面時不自動輪播; 「在年表看這一年」焦點跟過去', async ({ page }) => {
  // 8/28 往年有好幾場 → 有圓點可以換
  await page.clock.install({ time: new Date('2026-08-28T12:00:00+09:00') });
  const errors = await open(page, '/live/timeline/');
  const dots = page.locator('#today .dot');
  await expect.poll(() => dots.count()).toBeGreaterThan(1);
  await page.locator('#today .dot[data-i="0"]').focus();
  await page.keyboard.press('Tab');
  expect((await active(page)).cls).toContain('dot');
  await page.keyboard.press('Enter');
  await expect(page.locator('#today .dot.on')).toHaveAttribute('data-i', '1');
  // 重畫之後焦點還在第 2 顆圓點上
  expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.i)).toBe('1');
  expect(await ringInside(page)).toMatchObject({ visible: true });
  // 焦點在卡片裡: 過了好幾輪也不換, 焦點也不被重畫弄掉
  await page.clock.runFor(15_000);
  await expect(page.locator('#today .dot.on')).toHaveAttribute('data-i', '1');
  expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.i)).toBe('1');

  await page.locator('#today .go').focus();
  const y = await page.locator('#today .go').getAttribute('data-y');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => document.activeElement!.id)).toBe(`y${y}`);
  expect(await notCovered(page, '.sh-hd, #chips')).toBe(true);
  // 下一個 Tab 是那一年的第一則
  await page.keyboard.press('Tab');
  expect(await page.evaluate((y) => !!document.activeElement!.closest(`.tl[data-y="${y}"]`), y)).toBe(true);
  expect(errors).toEqual([]);
});

test('年表: 今日のにしな 用滑鼠 / 手指點過圓點, 自動輪播照樣繼續 (只有鍵盤停在裡面才暫停)', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-08-28T12:00:00+09:00') });
  const errors = await open(page, '/live/timeline/');
  await expect.poll(() => page.locator('#today .dot').count()).toBeGreaterThan(1);
  await page.locator('#today .dot[data-i="1"]').click();
  await expect(page.locator('#today .dot.on')).toHaveAttribute('data-i', '1');
  await page.clock.runFor(8_000);
  await expect(page.locator('#today .dot.on')).not.toHaveAttribute('data-i', '1');
  expect(errors).toEqual([]);
});

test('公演史: 「N 站 ▾」Tab 得到、Enter / Space 展開; SETLIST 選單 Space 開、Esc 關焦點回來、Tab 出去會收', async ({ page }) => {
  const errors = await open(page, '/live/concerts/');
  const card = page.locator('.card', { has: page.locator('[data-tg]') }).first();
  const tg = card.locator('[data-tg]');
  await tabFrom(page, `#${await card.getAttribute('id')} .period`);
  expect((await active(page)).cls).toBe('stops');
  expect((await tg.boundingBox())!.height).toBeGreaterThanOrEqual(24);   // 手機點得到
  expect(await ringInside(page)).toMatchObject({ visible: true });
  await expect(tg).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await expect(card).toHaveClass(/expanded/);
  await expect(tg).toHaveAttribute('aria-expanded', 'true');
  // 展開後 Tab 進得去逐站的參戰章
  await page.keyboard.press('Tab');
  expect((await active(page)).cls).toContain('stx');
  await page.keyboard.press(' ');
  await expect(card.locator('.stx.on')).toHaveCount(1);
  await tg.focus();
  await page.keyboard.press(' ');
  await expect(card).not.toHaveClass(/expanded/);

  // 新聞連結、参戦鈕: 焦點框畫在缺角裡面
  await card.locator('.links a').first().focus();
  expect(await ringInside(page)).toEqual({ visible: true, ok: true });
  await card.locator('.stbtn').focus();
  expect(await ringInside(page)).toEqual({ visible: true, ok: true });
  await page.keyboard.press('Enter');
  await expect(card).toHaveClass(/stamped/);

  const sl = card.locator('[data-sl]');
  const menu = card.locator('.slmenu');
  await sl.focus();
  await page.keyboard.press(' ');
  await expect(menu).toBeVisible();
  await expect(sl).toHaveAttribute('aria-expanded', 'true');
  // 裡面是一般連結不是 menu: 用 disclosure 的 aria-expanded 就好, 不宣告 haspopup
  await expect(sl).not.toHaveAttribute('aria-haspopup', /.*/);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement!.closest('.slmenu'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(sl).toHaveAttribute('aria-expanded', 'false');
  await expect(sl).toBeFocused();
  // Enter 開, 一路 Tab 走出選單就收起來
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  const items = await menu.locator('a').count();
  for (let i = 0; i <= items; i++) await page.keyboard.press('Tab');
  await expect(menu).toBeHidden();
  expect(errors).toEqual([]);
});

test('公演史: Shift+Tab 往回走焦點不被黏著的頁首蓋住', async ({ page }) => {
  const errors = await open(page, '/live/concerts/');
  await tabFrom(page, '.card:last-child .num');
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Shift+Tab');
    if (await page.evaluate(() => !!document.activeElement!.closest('.sh-hd, .sh-hero'))) break;
    expect(await notCovered(page, '.sh-hd')).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('足跡: 地圖 Tab 得到、方向鍵換縣有焦點框、Enter 打開、蓋章 / 翻頁焦點不掉、Esc 收起焦點回縣', async ({ page }) => {
  const errors = await open(page, '/live/footprint/');
  const tiles = page.locator('#map .tile.hit');
  await expect.poll(() => tiles.count()).toBeGreaterThan(5);
  // 整張圖只有一個 Tab 停點; 外層有名稱告訴讀螢幕怎麼用
  await expect(page.locator('#map [tabindex="0"]')).toHaveCount(1);
  await expect(page.locator('#map')).toHaveAttribute('role', 'group');
  await expect(page.locator('#map')).toHaveAttribute('aria-label', /方向鍵/);
  await tabFrom(page, '#lyApp');
  const first = await active(page);
  expect(first.tag).toBe('path');
  expect(first.p).not.toBe('');
  expect(await page.evaluate(() => document.activeElement!.getAttribute('role'))).toBe('button');
  await expect(page.locator('#map .fring.fg')).toHaveCount(1);

  let now = first;
  for (const k of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
    await page.keyboard.press(k);
    now = await active(page);
    if (now.p !== first.p) break;
  }
  expect(now.tag).toBe('path');
  expect(now.p).not.toBe(first.p);
  await expect(page.locator('#map [tabindex="0"]')).toHaveCount(1);
  await expect(page.locator('#map [tabindex="0"]')).toHaveAttribute('data-p', now.p);
  // 焦點框跟著換過去 (框就是那個縣的邊)
  expect(await page.locator('#map .fring.fg').getAttribute('d')).toBe(
    await page.locator(`#map .tile[data-p="${now.p}"]`).getAttribute('d'));

  // 東京場次多 (會分頁), 方向鍵走到東京
  const goTo = async (name: string) => {
    for (let i = 0; i < 60 && (await active(page)).p !== name; i++) {
      const pos = await page.evaluate((name) => {
        const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
        const a = document.activeElement!.getBoundingClientRect();
        const b = r(`#map .tile[data-p="${name}"]`);
        return { dx: b.x + b.width / 2 - (a.x + a.width / 2), dy: b.y + b.height / 2 - (a.y + a.height / 2) };
      }, name);
      const k = Math.abs(pos.dx) > Math.abs(pos.dy) ? (pos.dx > 0 ? 'ArrowRight' : 'ArrowLeft') : (pos.dy > 0 ? 'ArrowDown' : 'ArrowUp');
      await page.keyboard.press(k);
    }
    expect((await active(page)).p).toBe(name);
  };
  await goTo('東京');
  await page.keyboard.press('Enter');
  await expect(page.locator('#side h3')).toContainText('東京');
  // 重畫過地圖, 焦點還在東京, 而且是「按下去」的狀態
  expect((await active(page)).p).toBe('東京');
  await expect(page.locator('#map .tile[data-p="東京"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#map .fring.fg')).toHaveCount(1);

  // Tab 進側欄, 第一個是蓋章鈕: Space 蓋章, 側欄重畫後焦點還在那顆章上
  await page.keyboard.press('Tab');
  const stx = await active(page);
  expect(stx.inSide).toBe(true);
  expect(stx.cls).toContain('stx');
  await page.keyboard.press(' ');
  expect((await active(page)).cls).toContain('stx on');
  await page.keyboard.press(' ');
  expect((await active(page)).cls).not.toContain('on');

  // 翻頁: 焦點留在翻頁鈕
  const nx = page.locator('#pgNext');
  await expect(nx).toBeVisible();
  await nx.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#sideNav .pg')).toContainText('2 /');
  expect(await page.evaluate(() => document.activeElement!.closest('#sideNav') !== null)).toBe(true);

  // Esc 收起: 側欄回到提示, 焦點回東京
  await page.keyboard.press('Escape');
  await expect(page.locator('#side .ph')).toBeVisible();
  expect((await active(page)).p).toBe('東京');
  await expect(page.locator('#map .tile[data-p="東京"]')).toHaveAttribute('aria-pressed', 'false');

  // Space 跟 Enter 一樣; Alt+方向鍵留給瀏覽器
  await page.keyboard.press(' ');
  await expect(page.locator('#side h3')).toContainText('東京');
  await page.keyboard.press('Alt+ArrowRight');
  expect((await active(page)).p).toBe('東京');
  expect(errors).toEqual([]);
});

test('足跡: 圖層 / 旅程鈕焦點框看得到; 參戰卡 Enter 打開焦點進去、Tab 不跑出去、Esc 關掉焦點回按鈕', async ({ page }) => {
  const errors = await open(page, '/live/footprint/');
  for (const sel of ['#play', '#lyOne', '#lyApp', '#mkcard']) {
    await tabFrom(page, sel);
    await page.keyboard.press('Shift+Tab');
    expect(await ringInside(page), sel).toEqual({ visible: true, ok: true });
  }
  await page.locator('#lyOne').focus();
  await page.keyboard.press(' ');
  await expect(page.locator('#lyOne')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press(' ');
  await expect(page.locator('#lyOne')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#mkcard').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#cardModal')).toBeVisible();
  await expect.poll(async () => (await active(page)).inModal).toBe(true);
  expect(await ringInside(page)).toEqual({ visible: true, ok: true });
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    expect((await active(page)).inModal).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect((await active(page)).inModal).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#cardModal')).toBeHidden();
  await expect(page.locator('#mkcard')).toBeFocused();
  expect(errors).toEqual([]);
});

test('足跡: 參戰卡開著時滑鼠點過卡片, Esc 照樣關得掉、Shift+Tab 不跑到後面的頁面', async ({ page }) => {
  const errors = await open(page, '/live/footprint/');
  const modal = page.locator('#cardModal');
  await page.locator('#mkcard').focus();
  await page.keyboard.press('Enter');
  await expect(modal).toBeVisible();
  // 點 canvas: 焦點掉到 body
  await page.locator('#passCv').click();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(page.locator('#mkcard')).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(modal).toBeVisible();
  await page.locator('#passCv').click();
  await page.keyboard.press('Shift+Tab');
  expect((await active(page)).inModal).toBe(true);
  await page.keyboard.press('Tab');
  expect((await active(page)).inModal).toBe(true);
  expect(errors).toEqual([]);
});
