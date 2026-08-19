// src/lib/psyLive4/learning.ts
// Reinforcement learner for CC parameter exploration.
// Uses REAL audio quality metrics (not just loudness).
//
// FIXES (claims-vs-reality roast):
// - bestParams persisted to localStorage (was: in-memory only, lost on refresh)
// - reset() no longer wipes bestParams (was: enabling learning destroyed memory)
// - getCurrentTrial uses ctx.currentTime consistently (was: mixed Date.now vs ctx.currentTime → always 0)
// - Trial timer is now the ACTUAL cadence control (was: overwritten by per-poll delta adjustments)

import type { AudioQualityMetrics, AdjustmentSuggestion } from './audio-quality';

export interface CCExplorationState {
  cc: number;
  value: number;
  reward: number;
  history: Array<{ value: number; reward: number; metrics: Partial<AudioQualityMetrics> }>;
  epsilon: number;
}

const EXPLORABLE_CCS = [74, 71, 5, 12, 14, 15];
const HISTORY_MAX = 20;
const STORAGE_KEY = 'psy4-learning-best-v1';

export class CCLearner {
  private states: Map<number, CCExplorationState> = new Map();
  private currentIdx = 0;
  private trialStartTime = 0;       // ctx.currentTime when trial began
  private trialDuration = 8;        // seconds per trial
  private bestReward = 0;
  private bestParams: Record<number, number> = {};

  constructor() {
    for (const cc of EXPLORABLE_CCS) {
      this.states.set(cc, {
        cc, value: 0.5, reward: 0,
        history: [], epsilon: 0.3,
      });
    }
    this.loadBest();
  }

  /**
   * Called by the host every poll tick.
   * Uses real audio quality metrics (not just peak dB).
   * `now` MUST be ctx.currentTime (NOT Date.now()) — see roast GAP 6.
   */
  tick(now: number, metrics: AudioQualityMetrics, suggestions: AdjustmentSuggestion[]): { cc: number; value: number } | null {
    const cc = EXPLORABLE_CCS[this.currentIdx];
    const state = this.states.get(cc)!;

    if (now - this.trialStartTime >= this.trialDuration) {
      // Reward = overall quality (weighted combination of 7 metrics)
      const reward = metrics.overall;
      state.reward = reward;
      state.history.push({ value: state.value, reward, metrics: { warmth: metrics.warmth, brightness: metrics.brightness, smoothness: metrics.smoothness } });
      if (state.history.length > HISTORY_MAX) state.history.shift();

      // Track best params — PERSIST to localStorage
      if (reward > this.bestReward) {
        this.bestReward = reward;
        this.bestParams[cc] = state.value;
        this.saveBest();
      }

      // Pick next value: epsilon-greedy with suggestion-guided exploration
      if (Math.random() < state.epsilon) {
        // Explore: check if there's a suggestion for this CC
        const suggestion = suggestions.find(s => s.cc === cc);
        if (suggestion) {
          // Guided exploration — move in the suggested direction
          const delta = suggestion.amount * (suggestion.direction === 'up' ? 1 : -1);
          state.value = Math.max(0.05, Math.min(0.95, state.value + delta));
        } else {
          // Random exploration
          state.value = 0.2 + Math.random() * 0.6;
        }
      } else {
        // Exploit: use best historical value (or persisted best)
        const best = state.history.reduce((a, b) => b.reward > a.reward ? b : a, state.history[0]);
        state.value = best?.value ?? this.bestParams[cc] ?? 0.5;
      }

      state.epsilon = Math.max(0.05, state.epsilon * 0.98);

      this.currentIdx = (this.currentIdx + 1) % EXPLORABLE_CCS.length;
      this.trialStartTime = now;
      return { cc, value: state.value };
    }
    return null;
  }

  getStates(): CCExplorationState[] {
    return Array.from(this.states.values());
  }

  /**
   * FIX GAP 6: uses ctx.currentTime consistently.
   * Caller passes `now = ctx.currentTime`.
   */
  getCurrentTrial(now: number): { cc: number; remainingSec: number } {
    return {
      cc: EXPLORABLE_CCS[this.currentIdx],
      remainingSec: Math.max(0, this.trialDuration - (now - this.trialStartTime)),
    };
  }

  getBestReward(): number { return this.bestReward; }
  getBestParams(): Record<number, number> { return { ...this.bestParams }; }

  /**
   * Reset trial state — does NOT wipe bestParams (roast GAP 5).
   * Use forgetAll() for a full wipe.
   */
  reset(): void {
    for (const state of this.states.values()) {
      state.value = this.bestParams[state.cc] ?? 0.5;  // START from best known
      state.reward = 0;
      state.history = [];
      state.epsilon = 0.3;
    }
    this.currentIdx = 0;
    this.trialStartTime = 0;
    console.log('[CCLearner] reset — restored best known params (not wiped)');
  }

  /** Full wipe — explicit only. */
  forgetAll(): void {
    for (const state of this.states.values()) {
      state.value = 0.5;
      state.reward = 0;
      state.history = [];
      state.epsilon = 0.3;
    }
    this.currentIdx = 0;
    this.trialStartTime = 0;
    this.bestReward = 0;
    this.bestParams = {};
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    console.log('[CCLearner] forgetAll — wiped all memory');
  }

  private loadBest(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.bestReward === 'number') this.bestReward = data.bestReward;
      if (data.bestParams && typeof data.bestParams === 'object') {
        this.bestParams = { ...data.bestParams };
        // Restore current values from best
        for (const [ccStr, val] of Object.entries(this.bestParams)) {
          const cc = Number(ccStr);
          const state = this.states.get(cc);
          if (state && typeof val === 'number') state.value = val;
        }
        console.log(`[CCLearner] loaded ${Object.keys(this.bestParams).length} best params from localStorage (bestReward=${this.bestReward.toFixed(3)})`);
      }
    } catch {
      // localStorage unavailable (SSR, privacy mode) — non-fatal
    }
  }

  private saveBest(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        bestReward: this.bestReward,
        bestParams: this.bestParams,
        savedAt: Date.now(),
      }));
    } catch {
      // non-fatal
    }
  }
}
