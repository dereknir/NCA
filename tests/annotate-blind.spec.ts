import { test, expect } from '@playwright/test';

// 標註頁 🙈 盲標: 開著時, 依影片 ID 固定挑一半的待審片段藏起機器答案 (變成從零標),
// 另一半照舊; 🤖 待審模式不盲標; 可以把機器答案放回來; 開關記在 localStorage。
// 外站一律擋掉 (YouTube 播放器載不到也沒關係, 只測狀態與面板)。

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.fulfill({ status: 204, body: '' }));
});

type Seeded = { picked: string; other: string };

async function seed(page: import('@playwright/test').Page): Promise<Seeded> {
  await page.goto('/annotate/');
  await page.waitForFunction(() => (window as any).eval('typeof S !== "undefined" && S.queue && Object.keys(S.queue).length > 0'));
  // auto_anchors.json 晚到會把 S.auto 整份換掉 → 等它載完再塞測試資料
  await page.waitForLoadState('networkidle');
  return page.evaluate(() => {
    const g = window as any;
    const S = g.eval('S'), blindPick = g.eval('blindPick');
    const items = Object.values(S.queue).flat() as any[];
    const withSong = items.filter((x) => x.songId && S.songs[x.songId]);
    const picked = withSong.find((x) => blindPick(x.videoId));
    const other = withSong.find((x) => !blindPick(x.videoId));
    for (const it of [picked, other]) {
      const anchors = [{ t: 1.5, line: 1 }, { t: 4.2, line: 2 }, { t: 7.9, line: 3 }];
      S.ann[it.videoId] = { songId: it.songId, anchors: anchors.map((a) => ({ ...a })), status: 'auto', source: 'auto', autoGrade: 'A', versionType: null, instrumental: false };
      S.auto[it.videoId] = { songId: it.songId, anchors, grade: 'A', confidence: 0.9 };
    }
    return { picked: picked.videoId, other: other.videoId };
  });
}

const ann = (page: import('@playwright/test').Page, vid: string) =>
  page.evaluate((v) => JSON.parse(JSON.stringify((window as any).eval('S').ann[v])), vid);

const load = (page: import('@playwright/test').Page, vid: string) =>
  page.evaluate((v) => {
    const g = window as any, S = g.eval('S');
    const it = (Object.values(S.queue).flat() as any[]).find((x) => x.videoId === v);
    g.eval('loadShort')(it);
  }, vid);

test('盲標開著: 被挑中的待審片段藏起機器答案, 沒挑中的照舊', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { picked, other } = await seed(page);
  const btn = page.locator('#blindBtn');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');

  await load(page, picked);
  const a = await ann(page, picked);
  expect(a.anchors).toEqual([]);
  expect(a.status).toBe('pending');
  expect(a.source).toBe('manual');
  expect(a.blind).toBe(true);
  expect(a.autoGrade).toBeUndefined();
  await expect(page.locator('#autoPanel')).toContainText('盲標');
  await expect(page.locator('#autoPanel')).not.toContainText('機器建議');

  await load(page, other);
  const b = await ann(page, other);
  expect(b.status).toBe('auto');
  expect(b.anchors).toHaveLength(3);
  expect(b.blind).toBeUndefined();
  await expect(page.locator('#autoPanel')).toContainText('機器建議');
  expect(errors).toEqual([]);
});

test('盲標的片段可以把機器答案放回來', async ({ page }) => {
  const { picked } = await seed(page);
  await page.locator('#blindBtn').click();
  await load(page, picked);
  await page.locator('#unblindBtn').click();
  const a = await ann(page, picked);
  expect(a.status).toBe('auto');
  expect(a.anchors).toHaveLength(3);
  expect(a.autoGrade).toBe('A');
  expect(a.blind).toBeUndefined();
  await expect(page.locator('#autoPanel')).toContainText('機器建議');
});

test('盲標關著或在 🤖 待審模式: 不盲標', async ({ page }) => {
  const { picked } = await seed(page);
  await load(page, picked);
  expect((await ann(page, picked)).status).toBe('auto');

  await page.evaluate(() => { (window as any).eval('S').reviewOnly = 'all'; });
  await page.locator('#blindBtn').click();   // 正在看的這支也不會因為按下開關被盲標
  await load(page, picked);
  const a = await ann(page, picked);
  expect(a.status).toBe('auto');
  expect(a.blind).toBeUndefined();
});

test('盲標標完 = 沒有 autoGrade 的 done, 開關重新整理後還在', async ({ page }) => {
  const { picked } = await seed(page);
  await page.locator('#blindBtn').click();
  await load(page, picked);
  await page.evaluate(() => {
    const g = window as any, S = g.eval('S');
    S.ann[S.cur.videoId].anchors = [{ t: 2.0, line: 1 }, { t: 5.0, line: 2 }, { t: 8.0, line: 3 }];
    g.eval('finishCurrent')('done');
  });
  const a = await ann(page, picked);
  expect(a.status).toBe('done');
  expect(a.blind).toBe(true);
  expect(a.autoGrade).toBeUndefined();

  await page.reload();
  await expect(page.locator('#blindBtn')).toHaveAttribute('aria-pressed', 'true');
});

test('盲標了沒動就離開: 機器答案放回去 (留在 🤖 待審); 打過點的維持盲標', async ({ page }) => {
  const { picked, other } = await seed(page);
  await page.locator('#blindBtn').click();
  await load(page, picked);
  expect((await ann(page, picked)).status).toBe('pending');
  await load(page, other);
  const a = await ann(page, picked);
  expect(a.status).toBe('auto');
  expect(a.anchors).toHaveLength(3);
  expect(a.autoGrade).toBe('A');
  expect(a.blind).toBeUndefined();

  // 再點開 = 同一個 ID 重新盲標; 這次打了點才離開 → 不放回去
  await load(page, picked);
  await page.evaluate(() => { const S = (window as any).eval('S'); S.ann[S.cur.videoId].anchors.push({ t: 2.0, line: 1 }); });
  await load(page, other);
  const b = await ann(page, picked);
  expect(b.status).toBe('pending');
  expect(b.blind).toBe(true);
  expect(b.anchors).toEqual([{ t: 2.0, line: 1 }]);
});

test('關掉盲標: 正在看、還沒動的那支也放回去', async ({ page }) => {
  const { picked } = await seed(page);
  const btn = page.locator('#blindBtn');
  await btn.click();
  await load(page, picked);
  await btn.click();
  const a = await ann(page, picked);
  expect(a.status).toBe('auto');
  expect(a.anchors).toHaveLength(3);
  await expect(page.locator('#autoPanel')).toContainText('機器建議');
});

test('盲標中的片段: 🧩 完整 Live 提示不拿機器 anchors 算 (不洩漏機器標到第幾句)', async ({ page }) => {
  const { picked } = await seed(page);
  await page.locator('#blindBtn').click();
  await load(page, picked);
  const hint = await page.evaluate((v) => {
    const g = window as any, S = g.eval('S');
    const sid = S.ann[v].songId;
    S.flp = { [sid]: { title: 'x', missing: [1, 2, 3], mv: [], complete: false } };
    return g.eval('flpHint')(v, sid);
  }, picked);
  expect(hint).toBeNull();
});

test('blindPick 固定且大約一半', async ({ page }) => {
  await page.goto('/annotate/');
  const r = await page.evaluate(() => {
    const blindPick = (window as any).eval('blindPick');
    const ids = Array.from({ length: 2000 }, (_, i) => 'v' + i.toString(36).padStart(10, 'x'));
    return { n: ids.filter(blindPick).length, stable: ids.every((v) => blindPick(v) === blindPick(v)) };
  });
  expect(r.stable).toBe(true);
  expect(r.n).toBeGreaterThan(900);
  expect(r.n).toBeLessThan(1100);
});

test('盲標開著: 被挑中的不出現在 🤖 待審 (避免高信心的先被看著答案審掉), 關掉就回來', async ({ page }) => {
  const { picked, other } = await seed(page);
  const inReview = (v: string) => page.evaluate((x) => (window as any).eval('isReviewItem')(x), v);
  expect(await inReview(picked)).toBe(true);
  await page.locator('#blindBtn').click();
  expect(await inReview(picked)).toBe(false);
  expect(await inReview(other)).toBe(true);
  await page.locator('#blindBtn').click();
  expect(await inReview(picked)).toBe(true);
});

test('把機器答案放回來的片段會記 blindAborted', async ({ page }) => {
  const { picked } = await seed(page);
  await page.locator('#blindBtn').click();
  await load(page, picked);
  await page.locator('#unblindBtn').click();
  expect((await ann(page, picked)).blindAborted).toBe(true);
});

test('盲標進度「盲標從零手標 n / 20」: 關著不顯示, 開著顯示, 盲標完一支 +1', async ({ page }) => {
  await page.goto('/annotate/');
  await page.waitForFunction(() => (window as any).eval('typeof S !== "undefined" && S.queue && Object.keys(S.queue).length > 0 && S.evalSeen && S.evalSeen.size > 0'));
  await page.waitForLoadState('networkidle');
  // 挑一支不在 eval 快照裡、被盲標挑中的真歌片段
  const vid = await page.evaluate(() => {
    const g = window as any, S = g.eval('S'), blindPick = g.eval('blindPick');
    const it = (Object.values(S.queue).flat() as any[]).find((x) =>
      x.songId && S.songs[x.songId]?.lyric_lines?.length && !S.evalSeen.has(x.videoId) && blindPick(x.videoId));
    const anchors = [{ t: 1.5, line: 1 }, { t: 4.2, line: 2 }, { t: 7.9, line: 3 }];
    S.ann[it.videoId] = { songId: it.songId, anchors: anchors.map((a) => ({ ...a })), status: 'auto', source: 'auto', autoGrade: 'A', versionType: null, instrumental: false };
    S.auto[it.videoId] = { songId: it.songId, anchors, grade: 'A', confidence: 0.9 };
    return it.videoId as string;
  });
  const prog = page.locator('#blindProg');
  await expect(prog).toBeHidden();
  await page.locator('#blindBtn').click();
  await expect(prog).toBeVisible();
  const before = Number((await prog.textContent())!.match(/(\d+) \/ 20/)![1]);
  await expect(prog).toHaveText(`盲標從零手標 ${before} / 20`);
  const box = await prog.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(24);

  await load(page, vid);
  await page.evaluate(() => {
    const g = window as any, S = g.eval('S');
    S.ann[S.cur.videoId].anchors = [{ t: 2.0, line: 1 }, { t: 5.0, line: 2 }, { t: 8.0, line: 3 }];
    g.eval('finishCurrent')('done');
  });
  expect((await ann(page, vid)).autoGrade).toBeUndefined();
  await expect(prog).toHaveText(`盲標從零手標 ${before + 1} / 20`);

  await page.locator('#blindBtn').click();
  await expect(prog).toBeHidden();
});

test('盲標進度: 完成後刪 anchor 掉到 < 3 支, 數字跟著少 (不用等下一次 updateProgress)', async ({ page }) => {
  await page.goto('/annotate/');
  await page.waitForFunction(() => (window as any).eval('typeof S !== "undefined" && S.queue && Object.keys(S.queue).length > 0 && S.evalSeen && S.evalSeen.size > 0'));
  await page.waitForLoadState('networkidle');
  const vid = await page.evaluate(() => {
    const g = window as any, S = g.eval('S');
    const it = (Object.values(S.queue).flat() as any[]).find((x) =>
      x.songId && S.songs[x.songId]?.lyric_lines?.length && !S.songs[x.songId].instrumental && !S.evalSeen.has(x.videoId));
    S.ann[it.videoId] = { songId: it.songId, anchors: [{ t: 1, line: 1 }, { t: 3, line: 2 }, { t: 5, line: 3 }], status: 'done', source: 'manual', versionType: null, instrumental: false };
    return it.videoId as string;
  });
  const prog = page.locator('#blindProg');
  await page.locator('#blindBtn').click();
  const before = Number((await prog.textContent())!.match(/(\d+) \/ 20/)![1]);
  await load(page, vid);
  await page.locator('#anchorList .anchor-row .del').first().click();
  expect((await ann(page, vid)).anchors.length).toBe(2);
  await expect(prog).toHaveText(`盲標從零手標 ${before - 1} / 20`);
});

test('盲標進度: GitHub baseline 晚到換掉 S.ann 之後要重算', async ({ page }) => {
  // 用 baseline 帶進一支快照之後、從零手標完的真歌片段 (本機 localStorage 是空的)
  const fresh = await (await page.request.get('/annotate/annotation_queue.json')).json();
  const lyrics = await (await page.request.get('/annotate/lyrics.json')).json();
  const seen = new Set((await (await page.request.get('/annotate/eval_seen.json')).json()).ids);
  const real = new Set(lyrics.songs.filter((s: any) => !s.instrumental && s.lyric_lines?.length).map((s: any) => s.id));
  const it = (Object.values(fresh.queue).flat() as any[]).find((x) => real.has(x.songId) && !seen.has(x.videoId));
  const baseline = { [it.videoId]: { songId: it.songId, anchors: [{ t: 1, line: 1 }, { t: 3, line: 2 }, { t: 5, line: 3 }], status: 'done', source: 'manual' } };
  await page.route(/^https:\/\/api\.github\.com\/repos\/.*\/contents\//, async (route) => {
    await new Promise((r) => setTimeout(r, 1500));                    // 確定 eval_seen.json 先到、先畫過一次
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ sha: 'x', content: Buffer.from(JSON.stringify(baseline)).toString('base64') }) });
  });
  await page.addInitScript(() => {
    localStorage.setItem('nishina-annotator-gh-token', 'test-token');
    localStorage.setItem('nishina-annotator-blind', '1');
  });
  await page.goto('/annotate/');
  const prog = page.locator('#blindProg');
  await expect(prog).toHaveText('盲標從零手標 0 / 20');
  await expect(prog).toHaveText('盲標從零手標 1 / 20', { timeout: 5000 });
});

test('盲標進度: eval_seen.json 讀不到就顯示 ?, 頁面不報錯', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/annotate/eval_seen.json', (route) => route.fulfill({ status: 404, body: 'nope' }));
  await page.addInitScript(() => localStorage.setItem('nishina-annotator-blind', '1'));
  await page.goto('/annotate/');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#blindProg')).toHaveText('盲標從零手標 ? / 20');
  expect(errors).toEqual([]);
});
