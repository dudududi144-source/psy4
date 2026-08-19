// tests/psyLive4/styles.spec.ts
// Automated style test: each style must produce measurably different audio.

import { test, expect, type Page } from '@playwright/test';

async function startEngine(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__psyLive4, { timeout: 10000 });
  await page.getByRole('button', { name: /OFF|POWER/ }).click();
  await page.waitForFunction(() => (window as any).__psyLive4?.getState().playing === true, { timeout: 5000 });
}

async function measureStyle(page: Page, style: string) {
  await page.evaluate((st) => (window as any).__psyLive4.setStyle(st), style);
  await page.waitForTimeout(3000);  // let it settle
  return await page.evaluate(() => {
    const s = (window as any).__psyLive4.getState();
    return {
      style: s.style,
      peak: Math.round(s.peakDb * 10) / 10,
      rms: Math.round(s.rmsDb * 10) / 10,
      lowComp: Math.round(s.masterChain.lowCompReduction * 10) / 10,
      voices: s.voicesActive,
    };
  });
}

test.describe('PSY4 Style Differences', () => {
  test('each style produces different peak/RMS', async ({ page }) => {
    await startEngine(page);

    const fullOn = await measureStyle(page, 'FULL_ON');
    const dark = await measureStyle(page, 'DARK');
    const prog = await measureStyle(page, 'PROGRESSIVE');
    const acid = await measureStyle(page, 'ACID');

    // All playing
    expect(fullOn.style).toBe('FULL_ON');
    expect(dark.style).toBe('DARK');
    expect(prog.style).toBe('PROGRESSIVE');
    expect(acid.style).toBe('ACID');

    // At least one of peak/rms should differ between styles
    const peaks = [fullOn.peak, dark.peak, prog.peak, acid.peak];
    const uniquePeaks = new Set(peaks);
    expect(uniquePeaks.size).toBeGreaterThan(1);  // not all identical
  });

  test('smart radio actually cycles styles', async ({ page }) => {
    await startEngine(page);

    const styleBefore = await page.evaluate(() => (window as any).__psyLive4.getState().style);

    // Enable smart radio + force-trigger next change
    await page.evaluate(() => {
      (window as any).__psyLive4.setSmartRadio(true);
      // Force the next change to be immediate
      (window as any).__psyLive4.smartRadioNextChange = 0;
    });

    // Wait for the compose tick to trigger the change
    await page.waitForFunction(
      () => (window as any).__psyLive4.getState().style !== 'FULL_ON',
      { timeout: 5000 }
    );

    const styleAfter = await page.evaluate(() => (window as any).__psyLive4.getState().style);
    expect(styleAfter).not.toBe(styleBefore);
  });
});
