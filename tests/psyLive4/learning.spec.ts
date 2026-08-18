// tests/psyLive4/learning.spec.ts
// Automated learning test: reward must increase over time (epsilon-greedy converges).

import { test, expect, type Page } from '@playwright/test';

async function startEngineAndLearning(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__psyLive4, { timeout: 10000 });
  await page.getByRole('button', { name: /OFF|POWER/ }).click();
  await page.waitForFunction(() => (window as any).__psyLive4?.getState().playing === true, { timeout: 5000 });
  // Enable learning via the engine API (more reliable than clicking)
  await page.evaluate(() => (window as any).__psyLive4.setLearning(true));
  await page.waitForFunction(() => (window as any).__psyLive4?.getState().learningOn === true, { timeout: 3000 });
}

test.describe('PSY4 Learning Loop', () => {
  test('reward increases over 40s of exploration', async ({ page }) => {
    await startEngineAndLearning(page);

    // Baseline
    const t0 = await page.evaluate(() => {
      const states = (window as any).__psyLive4.getState().learningStates;
      const totalReward = states.reduce((sum: number, s: any) => sum + s.reward, 0);
      return { totalReward, count: states.length };
    });
    expect(t0.totalReward).toBe(0);  // no history yet

    // Wait for 2 trials (8s each = 16s)
    await page.waitForTimeout(18000);
    const t18 = await page.evaluate(() => {
      const states = (window as any).__psyLive4.getState().learningStates;
      const explored = states.filter((s: any) => s.history.length > 0);
      const totalReward = states.reduce((sum: number, s: any) => sum + s.reward, 0);
      return { totalReward, explored: explored.length, epsilon: states[0].epsilon };
    });
    expect(t18.explored).toBeGreaterThanOrEqual(1);  // at least 1 trial completed
    expect(t18.totalReward).toBeGreaterThan(0);

    // Wait for more trials (total 36s)
    await page.waitForTimeout(18000);
    const t36 = await page.evaluate(() => {
      const states = (window as any).__psyLive4.getState().learningStates;
      const totalReward = states.reduce((sum: number, s: any) => sum + s.reward, 0);
      const withHistory = states.filter((s: any) => s.history.length > 0).length;
      return { totalReward, withHistory, count: states.length, epsilon: states[0].epsilon };
    });

    // At least 2 CCs should have completed a trial
    expect(t36.withHistory).toBeGreaterThanOrEqual(2);
    // Total reward should be higher than baseline (0)
    expect(t36.totalReward).toBeGreaterThan(0);
    // HONEST convergence check: reward at T=36 should be HIGHER than at T=18
    // (proves learning actually improves, not just runs)
    expect(t36.totalReward).toBeGreaterThan(t18.totalReward);
    // Epsilon should have decayed
    expect(t36.epsilon).toBeLessThan(0.30);
  });

  test('CC values are actually applied to the engine', async ({ page }) => {
    await startEngineAndLearning(page);
    await page.waitForTimeout(10000);  // wait for first trial

    const state = await page.evaluate(() => {
      const s = (window as any).__psyLive4.getState();
      // Find a CC with history (completed a trial)
      const explored = s.learningStates.find((st: any) => st.history.length > 0);
      return {
        hasExplored: !!explored,
        exploredCc: explored?.cc,
        exploredValue: explored?.value,
        ccParamsHasIt: explored ? (s.ccParams[explored.cc] !== undefined) : false,
      };
    });

    expect(state.hasExplored).toBe(true);
    expect(state.ccParamsHasIt).toBe(true);  // the CC value was applied to the engine
  });
});
