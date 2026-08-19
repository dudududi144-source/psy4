// src/lib/psyLive4/learning.ts
// Reinforcement learner for CC parameter exploration.
//
// ROUND 1 (surface fixes): persistence, time math, dedicated interval.
// ROUND 2 (deep roast v2):
//   - DEEP GAP G: hill-climbing exploration (was: pure random epsilon-greedy)
//     If the last trial moved CC in direction D and reward increased,
//     continue in D. If reward decreased, reverse. This gives the learner
//     a gradient signal instead of random walk.
//   - DEEP GAP A: pattern memory hook — the learner records which
//     composition bar fingerprints got high rewards, so the composer
//     can bias toward reusing them. (Composition learning, step 1.)
//   - DEEP GAP E: error counter — if a tick throws, log + continue
//     instead of silently dying.

import type { AudioQualityMetrics, AdjustmentSuggestion } from './audio-quality';

export interface CCExplorationState {
  cc: number;
  value: number;
  reward: number;
  history: Array<{ value: number; reward: number; metrics: Partial<AudioQualityMetrics> }>;
  epsilon: number;
  // DEEP GAP G: hill-climbing state
  lastDirection: number;   // -1, 0, +1 — which way we moved last
  lastReward: number;      // reward at last trial (for gradient comparison)
  stepSize: number;        // current hill-climb step size (adapts)
}

export interface PatternMemoryEntry {
  fingerprint: string;   // bar content hash
  reward: number;
  hits: number;           // how many times this pattern has been reused
  lastUsed: number;       // ctx.currentTime of last use
}

const EXPLORABLE_CCS = [74, 71, 5, 12, 14, 15];
const HISTORY_MAX = 20;
const STORAGE_KEY = 'psy4-learning-best-v1';
const PATTERN_STORAGE_KEY = 'psy4-patterns-v1';
const PATTERN_MAX = 32;

export class CCLearner {
  private states: Map<number, CCExplorationState> = new Map();
  private currentIdx = 0;
  private trialStartTime = 0;
  private trialDuration = 8;
  private bestReward = 0;
  private bestParams: Record<number, number> = {};

  // DEEP GAP A: pattern memory — composition learning
  private patternMemory: Map<string, PatternMemoryEntry> = new Map();

  // DEEP GAP E: error tracking
  private errorCount = 0;

  constructor() {
    for (const cc of EXPLORABLE_CCS) {
      this.states.set(cc, {
        cc, value: 0.5, reward: 0,
        history: [], epsilon: 0.3,
        lastDirection: 0, lastReward: 0, stepSize: 0.05,
      });
    }
    this.loadBest();
    this.loadPatterns();
  }

  /**
   * Called by the host every learning tick (4s).
   * `now` MUST be ctx.currentTime.
   *
   * DEEP GAP G: hill-climbing — instead of random exploration, use
   * gradient information from the last trial to decide direction.
   */
  tick(now: number, metrics: AudioQualityMetrics, suggestions: AdjustmentSuggestion[]): { cc: number; value: number } | null {
    const cc = EXPLORABLE_CCS[this.currentIdx];
    const state = this.states.get(cc)!;

    if (now - this.trialStartTime >= this.trialDuration) {
      const reward = metrics.overall;
      state.reward = reward;
      state.history.push({ value: state.value, reward, metrics: { warmth: metrics.warmth, brightness: metrics.brightness, smoothness: metrics.smoothness } });
      if (state.history.length > HISTORY_MAX) state.history.shift();

      // Track best params — persist to localStorage
      if (reward > this.bestReward) {
        this.bestReward = reward;
        this.bestParams[cc] = state.value;
        this.saveBest();
      }

      // DEEP GAP G: hill-climbing exploration
      // Compare current reward to last reward to determine gradient.
      const rewardDelta = reward - state.lastReward;
      let nextValue = state.value;
      let nextDirection = state.lastDirection;

      if (Math.random() < state.epsilon) {
        // Exploration phase
        const suggestion = suggestions.find(s => s.cc === cc);
        if (suggestion) {
          // Suggestion-guided: move in the suggested direction
          nextDirection = suggestion.direction === 'up' ? 1 : -1;
          nextValue = state.value + nextDirection * suggestion.amount;
        } else if (state.lastDirection !== 0 && Math.abs(rewardDelta) < 0.02) {
          // Reward plateau — try the opposite direction
          nextDirection = -state.lastDirection;
          nextValue = state.value + nextDirection * state.stepSize;
        } else if (state.lastDirection !== 0 && rewardDelta > 0) {
          // Reward INCREASED in lastDirection — continue (hill climbing)
          nextValue = state.value + state.lastDirection * state.stepSize;
          // Accelerate slightly (adaptive step size)
          state.stepSize = Math.min(0.12, state.stepSize * 1.2);
        } else if (state.lastDirection !== 0 && rewardDelta < 0) {
          // Reward DECREASED — reverse direction + reduce step
          nextDirection = -state.lastDirection;
          nextValue = state.value + nextDirection * state.stepSize * 0.5;
          state.stepSize = Math.max(0.02, state.stepSize * 0.7);
        } else {
          // No prior direction — pick one at random
          nextDirection = Math.random() < 0.5 ? 1 : -1;
          nextValue = state.value + nextDirection * state.stepSize;
        }
      } else {
        // Exploitation: use best historical value
        const best = state.history.reduce((a, b) => b.reward > a.reward ? b : a, state.history[0]);
        nextValue = best?.value ?? this.bestParams[cc] ?? 0.5;
        nextDirection = 0;
      }

      nextValue = Math.max(0.05, Math.min(0.95, nextValue));
      state.lastDirection = nextDirection;
      state.lastReward = reward;
      state.value = nextValue;
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

  getCurrentTrial(now: number): { cc: number; remainingSec: number } {
    return {
      cc: EXPLORABLE_CCS[this.currentIdx],
      remainingSec: Math.max(0, this.trialDuration - (now - this.trialStartTime)),
    };
  }

  getBestReward(): number { return this.bestReward; }
  getBestParams(): Record<number, number> { return { ...this.bestParams }; }
  getErrorCount(): number { return this.errorCount; }
  incrementError(): void { this.errorCount++; }

  // ── DEEP GAP A: pattern memory ──────────────────────────────────────
  // The composer records bar fingerprints + rewards. The learner keeps
  // the top-N highest-reward patterns. The composer can then bias toward
  // reusing them. This is the first step toward composition learning:
  // the engine remembers WHAT it played when it sounded good.

  /** Record a bar fingerprint with its reward. Called by the host after each bar. */
  recordPattern(fingerprint: string, reward: number, now: number): void {
    const existing = this.patternMemory.get(fingerprint);
    if (existing) {
      // Update with exponential moving average
      existing.reward = existing.reward * 0.7 + reward * 0.3;
      existing.hits++;
      existing.lastUsed = now;
    } else {
      this.patternMemory.set(fingerprint, {
        fingerprint, reward, hits: 1, lastUsed: now,
      });
      // Prune: keep only top PATTERN_MAX by reward
      if (this.patternMemory.size > PATTERN_MAX * 2) {
        const entries = Array.from(this.patternMemory.entries());
        entries.sort((a, b) => b[1].reward - a[1].reward);
        this.patternMemory = new Map(entries.slice(0, PATTERN_MAX));
      }
    }
    // Persist periodically (not every bar — too much I/O)
    if (Math.random() < 0.05) this.savePatterns();
  }

  /** Get the top-N highest-reward patterns. Composer biases toward these. */
  getTopPatterns(n: number = 5): PatternMemoryEntry[] {
    return Array.from(this.patternMemory.values())
      .sort((a, b) => b.reward - a.reward)
      .slice(0, n);
  }

  /** Get a random high-reward pattern (for composer reuse). */
  pickGoodPattern(): PatternMemoryEntry | null {
    const top = this.getTopPatterns(8);
    if (top.length === 0) return null;
    // Weighted random: higher reward = more likely
    const totalWeight = top.reduce((s, p) => s + p.reward, 0);
    if (totalWeight <= 0) return top[Math.floor(Math.random() * top.length)];
    let r = Math.random() * totalWeight;
    for (const p of top) {
      r -= p.reward;
      if (r <= 0) return p;
    }
    return top[top.length - 1];
  }

  getPatternCount(): number { return this.patternMemory.size; }

  reset(): void {
    for (const state of this.states.values()) {
      state.value = this.bestParams[state.cc] ?? 0.5;
      state.reward = 0;
      state.history = [];
      state.epsilon = 0.3;
      state.lastDirection = 0;
      state.lastReward = 0;
      state.stepSize = 0.05;
    }
    this.currentIdx = 0;
    this.trialStartTime = 0;
    this.errorCount = 0;
    console.log('[CCLearner] reset — restored best known params (hill-climb state cleared)');
  }

  forgetAll(): void {
    for (const state of this.states.values()) {
      state.value = 0.5;
      state.reward = 0;
      state.history = [];
      state.epsilon = 0.3;
      state.lastDirection = 0;
      state.lastReward = 0;
      state.stepSize = 0.05;
    }
    this.currentIdx = 0;
    this.trialStartTime = 0;
    this.bestReward = 0;
    this.bestParams = {};
    this.patternMemory.clear();
    this.errorCount = 0;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(PATTERN_STORAGE_KEY);
    } catch {}
    console.log('[CCLearner] forgetAll — wiped all memory (params + patterns)');
  }

  private loadBest(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.bestReward === 'number') this.bestReward = data.bestReward;
      if (data.bestParams && typeof data.bestParams === 'object') {
        this.bestParams = { ...data.bestParams };
        for (const [ccStr, val] of Object.entries(this.bestParams)) {
          const cc = Number(ccStr);
          const state = this.states.get(cc);
          if (state && typeof val === 'number') state.value = val;
        }
        console.log(`[CCLearner] loaded ${Object.keys(this.bestParams).length} best params from localStorage (bestReward=${this.bestReward.toFixed(3)})`);
      }
    } catch {
      // non-fatal
    }
  }

  private saveBest(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        bestReward: this.bestReward,
        bestParams: this.bestParams,
        savedAt: Date.now(),
      }));
    } catch {}
  }

  private loadPatterns(): void {
    try {
      const raw = localStorage.getItem(PATTERN_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        for (const p of data) {
          if (p && typeof p.fingerprint === 'string' && typeof p.reward === 'number') {
            this.patternMemory.set(p.fingerprint, p);
          }
        }
        console.log(`[CCLearner] loaded ${this.patternMemory.size} patterns from localStorage`);
      }
    } catch {}
  }

  private savePatterns(): void {
    try {
      const arr = Array.from(this.patternMemory.values()).slice(0, PATTERN_MAX);
      localStorage.setItem(PATTERN_STORAGE_KEY, JSON.stringify(arr));
    } catch {}
  }
}
