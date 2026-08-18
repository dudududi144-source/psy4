// src/lib/psyLive4/learning.ts
// Lightweight reinforcement learner for CC parameter exploration.
//
// Principle: the engine's audio output has a measurable quality (peak dB near
// -1dB = "loud and present", -40dB = "too quiet", 0dB = "clipping"). We treat
// this as a reward signal and use epsilon-greedy exploration to find CC values
// that maximize it.
//
// This is intentionally simple (~100 lines). The old learning system was
// 4000 lines of dead code. This one actually runs and actually changes sound.

export interface CCExplorationState {
  cc: number;                // which CC we're exploring (74=cutoff, 71=resonance, etc.)
  value: number;              // current value being tested (0..1)
  reward: number;             // last measured reward
  history: Array<{ value: number; reward: number }>;  // last N trials
  epsilon: number;            // exploration rate (0..1)
}

const EXPLORABLE_CCS = [74, 71, 5, 12];  // cutoff, resonance, glide, energyMacro
const HISTORY_MAX = 20;

export class CCLearner {
  private states: Map<number, CCExplorationState> = new Map();
  private currentIdx = 0;
  private trialStartTime = 0;
  private trialDuration = 8;  // seconds per trial

  constructor() {
    for (const cc of EXPLORABLE_CCS) {
      this.states.set(cc, {
        cc, value: 0.5, reward: 0,
        history: [], epsilon: 0.3,
      });
    }
  }

  /** Called by the host every poll tick. Returns the CC to adjust + its value. */
  tick(now: number, peakDb: number): { cc: number; value: number } | null {
    const cc = EXPLORABLE_CCS[this.currentIdx];
    const state = this.states.get(cc)!;

    // If trial duration passed, evaluate reward + move to next
    if (now - this.trialStartTime >= this.trialDuration) {
      // Reward: peak near -1dB = 1.0, -40dB = 0, 0dB (clipping) = 0
      const reward = this.computeReward(peakDb);
      state.reward = reward;
      state.history.push({ value: state.value, reward });
      if (state.history.length > HISTORY_MAX) state.history.shift();

      // Pick next value: epsilon-greedy
      if (Math.random() < state.epsilon) {
        // Explore: random value
        state.value = 0.2 + Math.random() * 0.6;
      } else {
        // Exploit: use best historical value
        const best = state.history.reduce((a, b) => b.reward > a.reward ? b : a, state.history[0]);
        state.value = best?.value ?? 0.5;
      }
      // Decay epsilon
      state.epsilon = Math.max(0.1, state.epsilon * 0.98);

      // Move to next CC
      this.currentIdx = (this.currentIdx + 1) % EXPLORABLE_CCS.length;
      this.trialStartTime = now;
      return { cc, value: state.value };
    }
    return null;
  }

  /** Reward function: peak dB near -1dB = high reward. */
  private computeReward(peakDb: number): number {
    if (peakDb === -Infinity) return 0;
    if (peakDb > -0.3) return 0.2;  // clipping — bad
    if (peakDb < -20) return 0.1;   // too quiet — bad
    // Bell curve centered at -3dB
    const dist = Math.abs(peakDb - (-3));
    return Math.max(0, 1 - dist / 10);
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

  reset(): void {
    for (const state of this.states.values()) {
      state.value = 0.5;
      state.reward = 0;
      state.history = [];
      state.epsilon = 0.3;
    }
    this.currentIdx = 0;
  }
}
