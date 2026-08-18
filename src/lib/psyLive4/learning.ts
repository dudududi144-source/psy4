// src/lib/psyLive4/learning.ts
// Reinforcement learner for CC parameter exploration.
// Uses REAL audio quality metrics (not just loudness).
// The learner receives 7 quality metrics + actionable suggestions.

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

export class CCLearner {
  private states: Map<number, CCExplorationState> = new Map();
  private currentIdx = 0;
  private trialStartTime = 0;
  private trialDuration = 8;
  private bestReward = 0;
  private bestParams: Record<number, number> = {};

  constructor() {
    for (const cc of EXPLORABLE_CCS) {
      this.states.set(cc, {
        cc, value: 0.5, reward: 0,
        history: [], epsilon: 0.3,
      });
    }
  }

  /**
   * Called by the host every poll tick.
   * Uses real audio quality metrics (not just peak dB).
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

      // Track best params
      if (reward > this.bestReward) {
        this.bestReward = reward;
        this.bestParams[cc] = state.value;
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
        // Exploit: use best historical value
        const best = state.history.reduce((a, b) => b.reward > a.reward ? b : a, state.history[0]);
        state.value = best?.value ?? 0.5;
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

  getCurrentTrial(): { cc: number; remainingSec: number } {
    return {
      cc: EXPLORABLE_CCS[this.currentIdx],
      remainingSec: Math.max(0, this.trialDuration - (Date.now() / 1000 - this.trialStartTime)),
    };
  }

  getBestReward(): number { return this.bestReward; }
  getBestParams(): Record<number, number> { return { ...this.bestParams }; }

  reset(): void {
    for (const state of this.states.values()) {
      state.value = 0.5;
      state.reward = 0;
      state.history = [];
      state.epsilon = 0.3;
    }
    this.currentIdx = 0;
    this.bestReward = 0;
    this.bestParams = {};
  }
}
