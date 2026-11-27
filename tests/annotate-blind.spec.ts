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
