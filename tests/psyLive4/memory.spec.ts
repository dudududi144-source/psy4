// tests/psyLive4/memory.spec.ts
// Automated memory leak test: heap must not grow unboundedly over 60s.

import { test, expect, type Page } from '@playwright/test';

async function startEngine(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__psyLive4, { timeout: 10000 });
  await page.getByRole('button', { name: /OFF|POWER/ }).click();
  await page.waitForFunction(() => (window as any).__psyLive4?.getState().playing === true, { timeout: 5000 });
}

test.describe('PSY4 Memory', () => {
  test('heap does not grow over 60s', async ({ page }) => {
    await startEngine(page);

    const getHeap = () => page.evaluate(() => ({
      used: Math.round((performance as any).memory?.usedJSHeapSize / 1024 / 1024) || 0,
      total: Math.round((performance as any).memory?.totalJSHeapSize / 1024 / 1024) || 0,
    }));

    const t0 = await getHeap();
    await page.waitForTimeout(30000);
    const t30 = await getHeap();
    await page.waitForTimeout(30000);
    const t60 = await getHeap();

    // Used heap should not grow by more than 50MB (allowing for GC variance)
    const growth = t60.used - t0.used;
    expect(growth).toBeLessThan(50);

    // Total heap should be stable (±10MB)
    const totalDelta = Math.abs(t60.total - t0.total);
    expect(totalDelta).toBeLessThan(10);
  });

  test('voice pool does not exhaust over 60s', async ({ page }) => {
    await startEngine(page);

    const t0 = await page.evaluate(() => {
      const s = (window as any).__psyLive4.getState();
      return { voices: s.voicesActive, kicks: s.kickCount };
    });

    await page.waitForTimeout(60000);

    const t60 = await page.evaluate(() => {
      const s = (window as any).__psyLive4.getState();
      return { voices: s.voicesActive, kicks: s.kickCount, playing: s.playing };
    });

    expect(t60.playing).toBe(true);
    expect(t60.kicks).toBeGreaterThan(t0.kicks);
    // Voices should stay under 32 (pool limit)
    expect(t60.voices).toBeLessThan(32);
  });
});
