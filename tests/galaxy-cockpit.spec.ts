import { test, expect } from '@playwright/test';

// 選過操縦席的人 (localStorage 記著) 一進來就是操縦席模式。
// 之前 renderCockpit 在宣告雷達位置 (RX) 之前就拿它畫彗星青點 → TDZ 錯, rAF 迴圈斷掉, 切回星図天體也不動了。
test('銀河: 一進來就是操縦席也不丟錯, 切回星図天體照常公轉', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.route('**/*', (r) => (r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort('blockedbyclient')));
  await context.addInitScript(() => { try { localStorage.setItem('nishina-galaxy-mode', 'cockpit'); } catch (e) {} });
  await page.goto('/galaxy/');
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'cockpit');
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);

  await page.locator('#modeBtn').click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'map');
  const pos = () => page.locator('.body-cv').evaluateAll((els) => els.map((e) => (e as HTMLElement).style.left + ',' + (e as HTMLElement).style.top).join('|'));
  const a = await pos();
  await expect.poll(pos, { timeout: 5000 }).not.toBe(a);
  expect(errors).toEqual([]);
});
