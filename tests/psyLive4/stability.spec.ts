// tests/psyLive4/stability.spec.ts
// Automated stability test: engine must play 60s without stopping.
// This is the regression test for the "engine stops after a few minutes" bug.

import { test, expect, type Page } from '@playwright/test';

async function startEngine(page: Page) {
  await page.goto('/');
  // Wait for engine ready
  await page.waitForFunction(() => !!(window as any).__psyLive4, { timeout: 10000 });
  // Click POWER
  await page.getByRole('button', { name: /OFF|POWER/ }).click();
  // Wait for playing=true
  await page.waitForFunction(() => (window as any).__psyLive4?.getState().playing === true, { timeout: 5000 });
}

test.describe('PSY4 Stability', () => {
  test('engine plays 60s without stopping', async ({ page }) => {
    await startEngine(page);

    // Sample at T=0, T=30s, T=60s
    const t0 = await page.evaluate(() => {
      const s = (window as any).__psyLive4.getState();
      return { bar: s.bar, kicks: s.kickCount, playing: s.playing };
    });
    expect(t0.playing).toBe(true);

    await page.waitForTimeout(30000);
    const t30 = await page.evaluate(() => {
      const s = (window as any).__psyLive4.getState();
      return { bar: s.bar, kicks: s.kickCount, playing: s.playing, staleMs: s.schedulerStaleMs };
    });
    expect(t30.playing).toBe(true);
    expect(t30.bar).toBeGreaterThan(t0.bar);
    expect(t30.kicks).toBeGreaterThan(t0.kicks);
    expect(t30.staleMs).toBeLessThan(200);

    await page.waitForTimeout(30000);
    const t60 = await page.evaluate(() => {
      const s = (window as any).__psyLive4.getState();
      return { bar: s.bar, kicks: s.kickCount, playing: s.playing, peak: s.peakDb };
    });
    expect(t60.playing).toBe(true);
    expect(t60.bar).toBeGreaterThan(t30.bar);
    expect(t60.kicks).toBeGreaterThan(t30.kicks);
    // Peak should be healthy (not silence, not clipping)
    expect(t60.peak).toBeGreaterThan(-40);
    expect(t60.peak).toBeLessThan(0.5);
  });

  test('engine survives background tab simulation', async ({ page }) => {
    await startEngine(page);
    const before = await page.evaluate(() => (window as any).__psyLive4.getState().bar);

    // Simulate background via visibilitychange
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(5000);

    // Simulate foreground
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(3000);

    const after = await page.evaluate(() => {
      const s = (window as any).__psyLive4.getState();
      return { bar: s.bar, playing: s.playing, ctxState: s.ctxState };
    });
    expect(after.playing).toBe(true);
    expect(after.ctxState).toBe('running');
    expect(after.bar).toBeGreaterThanOrEqual(before);
  });
});
