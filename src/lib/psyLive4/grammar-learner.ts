// src/lib/psyLive4/grammar-learner.ts
// REAL musical learning — based on the PSY6 grammar system.
//
// The existing CCLearner just hill-climbs CC parameters (knob values) —
// it doesn't learn anything musical. The user reported "no learning at all,
// it's a circle that repeats" — because tweaking CC74 (cutoff) by ±0.05
// doesn't change what's played, just the timbre.
//
// This GrammarLearner learns what's actually played:
//   - BASS grammar: 12x12 pitch-class transition matrix — "after bass note
//     with PC X, what PC comes next?"
//   - MELODIC grammar: 25-bucket interval histogram (-12..+12) — "what
//     melodic intervals does the lead favor?"
//   - RHYTHM grammar: 16-step kick onset probability — "where do kicks
//     land in the bar?"
//
// The learner:
//   - Observes every note the engine plays (via observeNote())
//   - Updates the statistical distributions
//   - Decays every 50 observations (so the system can adapt to new styles
//     without forgetting everything)
//   - Exposes sampleBass(pc) / sampleMelodicInterval() / sampleKickOnset(step)
//     so the composer can sample from the learned distributions
//
// Confidence is a 0..1 metric: min(total/20, 1) per grammar, averaged.
// When confidence is high, the composer trusts the grammar; when low, it
// falls back to the built-in style banks.

export interface GrammarStats {
  bass: {
    total: number;           // total observations
    matrixNonzero: number;   // count of non-zero cells in the 12x12 (sparsity)
    topTransition: { from: number; to: number; count: number } | null;
  };
  melodic: {
    total: number;
    topInterval: { interval: number; count: number } | null;
    contourUp: number;
    contourDown: number;
    contourSame: number;
  };
  rhythm: {
    total: number;
    topStep: { step: number; count: number } | null;
    density: number;  // average kicks per bar (0..16)
  };
  confidence: number;  // 0..1 overall
}

export class GrammarLearner {
  // 12x12 bass pitch-class transition matrix (counts)
  private bassTransitions: number[][] = Array.from({ length: 12 }, () => Array(12).fill(0));
  private bassTotal = 0;
  private bassLastPc: number | null = null;

  // 25-bucket melodic interval histogram (-12..+12)
  private melodicIntervals: number[] = Array(25).fill(0);
  private melodicTotal = 0;
  private melodicLastMidi: number | null = null;
  private melodicContourUp = 0;
  private melodicContourDown = 0;
  private melodicContourSame = 0;

  // 16-step kick onset counts
  private kickOnsets: number[] = Array(16).fill(0);
  private kickTotal = 0;

  private errorCount = 0;
  private static readonly DECAY = 0.95;
  private static readonly DECAY_EVERY = 50;  // decay every 50 observations

  /**
   * Observe a note the engine just played.
   * @param role 'bass' | 'lead' | 'arp' | 'kick' | 'pad'
   * @param midi the MIDI note number
   * @param step 0..15 step within the bar (for kick rhythm)
   */
  observeNote(role: string, midi: number, step: number = -1): void {
    try {
      if (role === 'bass') {
        const pc = ((midi % 12) + 12) % 12;
        if (this.bassLastPc !== null) {
          this.bassTransitions[this.bassLastPc][pc]++;
          this.bassTotal++;
          if (this.bassTotal > 0 && this.bassTotal % GrammarLearner.DECAY_EVERY === 0) {
            this.decayBass();
          }
        }
        this.bassLastPc = pc;
      } else if (role === 'lead' || role === 'arp') {
        if (this.melodicLastMidi !== null) {
          const interval = Math.max(-12, Math.min(12, midi - this.melodicLastMidi));
          this.melodicIntervals[interval + 12]++;
          this.melodicTotal++;
          if (interval > 0) this.melodicContourUp++;
          else if (interval < 0) this.melodicContourDown++;
          else this.melodicContourSame++;
          if (this.melodicTotal > 0 && this.melodicTotal % GrammarLearner.DECAY_EVERY === 0) {
            this.decayMelodic();
          }
        }
        this.melodicLastMidi = midi;
      } else if (role === 'kick') {
        if (step >= 0 && step < 16) {
          this.kickOnsets[step]++;
          this.kickTotal++;
        }
      }
    } catch (err) {
      this.errorCount++;
      // never throw — learning is best-effort
    }
  }

  private decayBass(): void {
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) {
        this.bassTransitions[i][j] *= GrammarLearner.DECAY;
      }
    }
    this.bassTotal *= GrammarLearner.DECAY;
  }

  private decayMelodic(): void {
    for (let i = 0; i < 25; i++) {
      this.melodicIntervals[i] *= GrammarLearner.DECAY;
    }
    this.melodicTotal *= GrammarLearner.DECAY;
  }

  /**
   * Sample the next bass pitch class given the last one.
   * Returns null if there's not enough data (caller falls back to style bank).
   */
  sampleBassPc(lastPc: number | null): number | null {
    if (this.bassTotal < 4) return null;
    const from = lastPc ?? this.bassLastPc ?? 0;
    const row = this.bassTransitions[from];
    const total = row.reduce((a, b) => a + b, 0);
    if (total === 0) return null;
    let r = Math.random() * total;
    for (let pc = 0; pc < 12; pc++) {
      r -= row[pc];
      if (r <= 0) return pc;
    }
    return 0;
  }

  /**
   * Sample a melodic interval (-12..+12) from the learned histogram.
   * Returns null if not enough data.
   */
  sampleMelodicInterval(): number | null {
    if (this.melodicTotal < 4) return null;
    const total = this.melodicIntervals.reduce((a, b) => a + b, 0);
    if (total === 0) return null;
    let r = Math.random() * total;
    for (let i = 0; i < 25; i++) {
      r -= this.melodicIntervals[i];
      if (r <= 0) return i - 12;
    }
    return 0;
  }

  /**
   * Sample whether a kick should fire at the given step (0..15).
   * Returns true/false, or null if not enough data.
   */
  sampleKickOnset(step: number): boolean | null {
    if (this.kickTotal < 4) return null;
    if (step < 0 || step >= 16) return null;
    const total = this.kickOnsets.reduce((a, b) => a + b, 0);
    if (total === 0) return null;
    const prob = this.kickOnsets[step] / total * 16;  // normalize: 0..~16
    return Math.random() < prob / 16;
  }

  /**
   * Bias an existing kick pattern toward the learned rhythm.
   * For each step where we have data, nudge the probability.
   * Returns the modified pattern (or null if no data).
   */
  biasKickPattern(existing: boolean[]): boolean[] | null {
    if (this.kickTotal < 4) return null;
    const total = this.kickOnsets.reduce((a, b) => a + b, 0);
    if (total === 0) return null;
    const result = [...existing];
    for (let s = 0; s < 16 && s < result.length; s++) {
      const learnedProb = this.kickOnsets[s] / total * 16;  // 0..~16
      const normalizedProb = Math.min(1, learnedProb / 16);
      // 70% chance to follow the learned distribution, 30% keep existing
      if (Math.random() < 0.7) {
        result[s] = Math.random() < normalizedProb;
      }
    }
    return result;
  }

  getErrorCount(): number { return this.errorCount; }

  /**
   * Compute stats for UI display + confidence metric.
   */
  getStats(): GrammarStats {
    // Bass top transition
    let bassTop: { from: number; to: number; count: number } | null = null;
    let bassNonzero = 0;
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) {
        const c = this.bassTransitions[i][j];
        if (c > 0) {
          bassNonzero++;
          if (!bassTop || c > bassTop.count) {
            bassTop = { from: i, to: j, count: c };
          }
        }
      }
    }

    // Melodic top interval
    let melTop: { interval: number; count: number } | null = null;
    for (let i = 0; i < 25; i++) {
      const c = this.melodicIntervals[i];
      if (!melTop || c > melTop.count) {
        melTop = { interval: i - 12, count: c };
      }
    }

    // Rhythm top step
    let rhyTop: { step: number; count: number } | null = null;
    let rhySum = 0;
    for (let s = 0; s < 16; s++) {
      const c = this.kickOnsets[s];
      rhySum += c;
      if (!rhyTop || c > rhyTop.count) {
        rhyTop = { step: s, count: c };
      }
    }

    const bassConf = Math.min(this.bassTotal / 20, 1);
    const melConf = Math.min(this.melodicTotal / 20, 1);
    const rhyConf = Math.min(this.kickTotal / 20, 1);
    const confidence = (bassConf + melConf + rhyConf) / 3;

    return {
      bass: {
        total: Math.round(this.bassTotal),
        matrixNonzero: bassNonzero,
        topTransition: bassTop,
      },
      melodic: {
        total: Math.round(this.melodicTotal),
        topInterval: melTop,
        contourUp: this.melodicContourUp,
        contourDown: this.melodicContourDown,
        contourSame: this.melodicContourSame,
      },
      rhythm: {
        total: Math.round(this.kickTotal),
        topStep: rhyTop,
        density: this.kickTotal > 0 ? rhySum / this.kickTotal : 0,
      },
      confidence,
    };
  }

  /**
   * Reset all grammars (e.g. when user clears the learning).
   */
  reset(): void {
    this.bassTransitions = Array.from({ length: 12 }, () => Array(12).fill(0));
    this.bassTotal = 0;
    this.bassLastPc = null;
    this.melodicIntervals = Array(25).fill(0);
    this.melodicTotal = 0;
    this.melodicLastMidi = null;
    this.melodicContourUp = 0;
    this.melodicContourDown = 0;
    this.melodicContourSame = 0;
    this.kickOnsets = Array(16).fill(0);
    this.kickTotal = 0;
  }
}
