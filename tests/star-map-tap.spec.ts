import { test, expect, type Page } from '@playwright/test';

// 星圖點星的容錯: 星只有 7~8px, 手指點不準。點一下 (不是拖) 時取手指 22px (螢幕像素) 內最近的星;
// 星本身的外觀、hover 都不變。拖曳不算點, 22px 外沒星就跟以前一樣什麼都不做。

async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.context().route('**/*', (route) => {
    const u = route.request().url();
    return u.startsWith('http://127.0.0.1') ? route.continue() : route.abort('blockedbyclient');
  });
  await page.goto('/star-map/');
  await expect(page.locator('#sky circle[data-name]').first()).toBeAttached();
  return errors;
}


// 在畫面裡找「離某顆星中心 off px、但手指底下不是任何星」的點, 而且 22px 內最近的就是那顆星
const besideStar = (page: Page, off: number, skip = 0) =>
  page.evaluate(([off, skip]) => {
    const idx = (c: Element) => [...document.querySelectorAll('#sky circle[data-name]')].indexOf(c);
    const sky = document.getElementById('sky')!.getBoundingClientRect();
    const top = Math.max(sky.top, 0) + 40, bottom = Math.min(sky.bottom, innerHeight) - 40;
    const stars = [...document.querySelectorAll('#sky circle[data-name]')].map((c) => {
      const r = c.getBoundingClientRect();
      return { c, x: r.x + r.width / 2, y: r.y + r.height / 2, r: r.width / 2 };
    });
    for (const s of stars) {
      if (s.y < top || s.y > bottom || s.x < sky.left + 40 || s.x > sky.right - 40) continue;
      if (document.elementFromPoint(s.x, s.y) !== s.c) continue;
      if (off > 0 && off - s.r < 6) continue;   // 要真的在星外面 (大顆的星半徑可能就有十幾 px)
      if (off === 0) return { x: s.x, y: s.y, name: s.c.getAttribute('data-name') ?? '', i: idx(s.c) };
      for (let a = 0; a < 16; a++) {
        const x = s.x + Math.cos((a / 16) * Math.PI * 2) * off, y = s.y + Math.sin((a / 16) * Math.PI * 2) * off;
        const under = document.elementFromPoint(x, y);
        if (under && under.matches('circle[data-name]')) continue;
        const mine = Math.max(0, off - s.r);
        // 別的星都要明顯比較遠 (邊緣距離多 6px 以上), 才不會測到模稜兩可的點
        if (stars.some((o) => o !== s && Math.hypot(o.x - x, o.y - y) - o.r < mine + 6)) continue;
        if (skip-- > 0) break;
        return { x, y, name: s.c.getAttribute('data-name') ?? '', i: idx(s.c) };
      }
    }
    throw new Error('找不到合適的點');
  }, [off, skip]);

// 兩顆靠很近的星 A、B: 回傳 A 外緣旁 (往 B 的方向) 的點, 和 B 外緣旁 (往 A 的方向) 的點
const closePair = (page: Page) =>
  page.evaluate(() => {
    const idx = (c: Element) => [...document.querySelectorAll('#sky circle[data-name]')].indexOf(c);
    const sky = document.getElementById('sky')!.getBoundingClientRect();
    const top = Math.max(sky.top, 0) + 40, bottom = Math.min(sky.bottom, innerHeight) - 40;
    const stars = [...document.querySelectorAll('#sky circle[data-name]')].map((c) => {
      const r = c.getBoundingClientRect();
      return { c, x: r.x + r.width / 2, y: r.y + r.height / 2, r: r.width / 2 };
    }).filter((s) => s.y > top && s.y < bottom && s.x > sky.left + 40 && s.x < sky.right - 40);
    const near = (x: number, y: number) => {
      let best = null as null | (typeof stars)[number], bd = Infinity;
      for (const o of stars) { const d = Math.max(0, Math.hypot(o.x - x, o.y - y) - o.r); if (d < bd) { bd = d; best = o; } }
      return { best, bd };
    };
    for (const a of stars) for (const b of stars) {
      if (a === b) continue;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d - a.r - b.r < 10 || d > 26) continue;
      const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
      const pa = { x: a.x + ux * (a.r + 3), y: a.y + uy * (a.r + 3) };
      const pb = { x: b.x - ux * (b.r + 3), y: b.y - uy * (b.r + 3) };
      const ok = (p: { x: number; y: number }, want: typeof a) => {
        const u = document.elementFromPoint(p.x, p.y);
        if (u && u.matches('circle[data-name]')) return false;
        const n = near(p.x, p.y);
        if (n.best !== want) return false;
        // 第二近的要遠一點, 免得浮點誤差
        return stars.every((o) => o === want || Math.max(0, Math.hypot(o.x - p.x, o.y - p.y) - o.r) > n.bd + 2);
      };
      if (ok(pa, a) && ok(pb, b))
        return { a: { ...pa, i: idx(a.c) }, b: { ...pb, i: idx(b.c) }, d };
    }
    throw new Error('找不到靠很近的兩顆星');
  });

// 22px 內都沒有星的空白點
const blankSpot = (page: Page) =>
  page.evaluate(() => {
    const sky = document.getElementById('sky')!.getBoundingClientRect();
    const top = Math.max(sky.top, 0) + 20, bottom = Math.min(sky.bottom, innerHeight) - 20;
    const stars = [...document.querySelectorAll('#sky circle[data-name]')].map((c) => {
      const r = c.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, r: r.width / 2 };
    });
    for (let y = top; y < bottom; y += 7) for (let x = sky.left + 20; x < sky.right - 20; x += 7)
      if (stars.every((s) => Math.hypot(s.x - x, s.y - y) - s.r > 40)) return { x, y };
    throw new Error('找不到空白處');
  });

// 目前釘選的是第幾顆星 (同一句歌詞可能出現在好幾顆星, 不能用文字比)
const pinnedIdx = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('#sky circle[data-name]')].findIndex((c) => c.getAttribute('aria-pressed') === 'true'));

// Playwright 的 touchscreen 只有 tap; 拖曳用 CDP 送觸控事件
async function touchDrag(page: Page, from: { x: number; y: number }, path: [number, number][]) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (const [dx, dy] of path) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + dx, y: from.y + dy }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('手機: 點在星旁邊 15px (手指底下不是星) 也會開那顆星的卡片', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', '只測窄版');
  const errors = await open(page);
  const side = page.locator('#side');
  // 換 8 顆不同的星各點一次 (Chromium 自己有一點觸控吸附, 碰巧吸對一顆不算數)
  for (let k = 0; k < 8; k++) {
    await page.reload();
    await expect(page.locator('#sky circle[data-name]').first()).toBeAttached();
    const p = await besideStar(page, 15, k);
    await page.touchscreen.tap(p.x, p.y);
    await expect(side, `第 ${k + 1} 顆`).toBeVisible();
    await expect.poll(() => pinnedIdx(page), { message: `第 ${k + 1} 顆` }).toBe(p.i);
  }
  expect(errors).toEqual([]);
});

test('手機: 兩顆星靠很近, 點哪邊就拿離手指最近的那顆', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', '只測窄版');
  const errors = await open(page);
  const { a, b } = await closePair(page);
  await page.evaluate((i) => {
    const r = document.querySelectorAll('#sky circle[data-name]')[i].getBoundingClientRect();
    (window as any).__b0 = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, b.i);
  const side = page.locator('#side');
  await page.touchscreen.tap(a.x, a.y);
  await expect(side).toBeVisible();
  await expect.poll(() => pinnedIdx(page)).toBe(a.i);
  await page.waitForTimeout(600);   // 隔開一點, 不然兩下會被當成雙擊放大
  // 釘選時鏡頭可能平移 (讓星不被卡片蓋住), B 旁邊那個點跟著星一起移
  const shift = await page.evaluate(([i, x, y]) => {
    const r = document.querySelectorAll('#sky circle[data-name]')[i].getBoundingClientRect();
    return { x: x + (r.x + r.width / 2) - (window as any).__b0.x, y: y + (r.y + r.height / 2) - (window as any).__b0.y };
  }, [b.i, b.x, b.y]);
  await page.touchscreen.tap(shift.x, shift.y);
  await expect(side).toBeVisible();
  await expect.poll(() => pinnedIdx(page)).toBe(b.i);
  expect(errors).toEqual([]);
});

test('手機: 放大之後 22px 是螢幕上的 22px (不是跟著圖放大)', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', '只測窄版');
  const errors = await open(page);
  const sky = (await page.locator('#sky').boundingBox())!;
  await page.mouse.move(sky.x + sky.width / 2, sky.y + Math.min(sky.height, 500) / 2);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(80); }
  await page.waitForTimeout(300);
  const side = page.locator('#side');
  // 放大後星變大, 旁邊 15px 已經可能還在星上; 取外緣外 15px
  const p = await page.evaluate(() => {
    const idx = (c: Element) => [...document.querySelectorAll('#sky circle[data-name]')].indexOf(c);
    const vp = document.getElementById('sky')!.getBoundingClientRect();
    const top = Math.max(vp.top, 0) + 40, bottom = Math.min(vp.bottom, innerHeight) - 40;
    const stars = [...document.querySelectorAll('#sky circle[data-name]')].map((c) => {
      const r = c.getBoundingClientRect();
      return { c, x: r.x + r.width / 2, y: r.y + r.height / 2, r: r.width / 2 };
    });
    const k = (document.querySelector('#sky > g') as SVGGElement).getScreenCTM()!.a;
    for (const s of stars) {
      if (s.y < top || s.y > bottom || s.x < vp.left + 60 || s.x > vp.right - 60) continue;
      for (let a = 0; a < 16; a++) {
        const ux = Math.cos((a / 16) * Math.PI * 2), uy = Math.sin((a / 16) * Math.PI * 2);
        const p1 = { x: s.x + ux * (s.r + 15), y: s.y + uy * (s.r + 15) };
        const p2 = { x: s.x + ux * (s.r + 30), y: s.y + uy * (s.r + 30) };
        const clear = (q: { x: number; y: number }, lim: number) =>
          stars.every((o) => o === s || Math.hypot(o.x - q.x, o.y - q.y) - o.r > lim);
        const onStar = (q: { x: number; y: number }) => document.elementFromPoint(q.x, q.y)?.matches('circle[data-name]');
        if (p2.y > bottom || p2.y < top || p2.x < vp.left + 10 || p2.x > vp.right - 10) continue;
        if (onStar(p1) || onStar(p2) || !clear(p1, 21) || !clear(p2, 26)) continue;
        return { p1, p2, i: idx(s.c), r: s.r, k };
      }
    }
    throw new Error('找不到');
  });
  expect(p.k).toBeGreaterThan(2);   // 前提: 真的放大了 (22px 如果跟著放大, 30px 外也會被吸到)
  await page.touchscreen.tap(p.p2.x, p.p2.y);   // 外緣外 30px: 太遠, 不開
  await page.waitForTimeout(600);
  await expect(side).toBeHidden();
  await page.touchscreen.tap(p.p1.x, p.p1.y);   // 外緣外 15px: 開
  await expect(side).toBeVisible();
  await expect.poll(() => pinnedIdx(page)).toBe(p.i);
  expect(errors).toEqual([]);
});

test('手機: 從星旁邊拖曳 (移動超過幾 px) 不會開卡片, 拖回原處放手也一樣', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', '只測窄版');
  const errors = await open(page);
  const side = page.locator('#side');
  const p = await besideStar(page, 10);
  await touchDrag(page, p, [[10, 0], [20, 4], [30, 8], [40, 10]]);
  await page.waitForTimeout(300);
  await expect(side).toBeHidden();
  // 拖曳會移動圖; 重新找一個點, 這次拖出去再拖回來
  const q = await besideStar(page, 10);
  await touchDrag(page, q, [[6, 0], [14, 0], [20, 0], [10, 0], [0, 0]]);
  await page.waitForTimeout(300);
  await expect(side).toBeHidden();
  expect(errors).toEqual([]);
});

test('手機: 點空白處 (22px 內沒星) 跟原本一樣 — 沒釘選就不開, 已釘選就留著', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', '只測窄版');
  const errors = await open(page);
  const side = page.locator('#side');
  const b = await blankSpot(page);
  await page.touchscreen.tap(b.x, b.y);
  await page.waitForTimeout(600);
  await expect(side).toBeHidden();
  const p = await besideStar(page, 0);   // 直接點在星上
  await page.touchscreen.tap(p.x, p.y);
  await expect(side).toBeVisible();
  await expect.poll(() => pinnedIdx(page)).toBe(p.i);
  await page.waitForTimeout(600);
  const b2 = await blankSpot(page);   // 釘選時鏡頭可能移過, 重找
  await page.touchscreen.tap(b2.x, b2.y);
  await page.waitForTimeout(600);
  await expect(side).toBeVisible();
  await expect.poll(() => pinnedIdx(page)).toBe(p.i);
  expect(errors).toEqual([]);
});

test('桌機: 滑鼠點星旁 15px 也釘選那顆; hover 在旁邊不會跳提示', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', '只測桌機');
  const errors = await open(page);
  const p = await besideStar(page, 15);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(150);
  await expect(page.locator('#tip')).toBeHidden();
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => pinnedIdx(page)).toBe(p.i);
  expect(errors).toEqual([]);
});
