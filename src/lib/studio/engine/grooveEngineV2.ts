/**
 * Groove Engine — microtiming, velocity curves, ghost hits, accents.
 *
 * Professional psytrance has a "groove" — not just quantized 16th notes.
 * The groove comes from:
 *   - Microtiming: offbeats slightly delayed (swing)
 *   - Velocity curves: downbeats louder, ghost notes softer
 *   - Ghost hits: very quiet hits that add texture without dominating
 *   - Accents: specific steps get emphasis
 *   - Fills: last bar of phrase has busier pattern
 *
 * Variation is CONTROLLED — tiny shifts, not random humanization.
 * The groove must remain tight (psytrance is precise, not loose).
 */

export interface GrooveParams {
  swing: number;        // 0..1 (0 = straight, 1 = full swing)
  microTiming: number;  // 0..1 (amount of timing variation)
  velocityCurve: number;// 0..1 (amount of velocity variation)
  ghostProbability: number; // 0..1 (chance of ghost notes)
  accentPattern: number[];  // velocity multipliers per 16th step
  fillDensity: number;  // 0..1 (density of fills at phrase ends)
}

export interface GrooveEvent {
  step: number;          // 16th step in bar (0-15)
  time: number;          // absolute time (seconds)
  velocity: number;      // 0..1
  isGhost: boolean;
  isAccent: boolean;
  isFill: boolean;
}

export class GrooveEngine {
  private params: GrooveParams;
  private s16: number; // seconds per 16th note

  constructor(bpm: number, params?: Partial<GrooveParams>) {
    this.s16 = 60 / bpm / 4;
    this.params = {
      swing: params?.swing ?? 0.1,
      microTiming: params?.microTiming ?? 0.3,
      velocityCurve: params?.velocityCurve ?? 0.4,
      ghostProbability: params?.ghostProbability ?? 0.15,
      accentPattern: params?.accentPattern ?? [
        1.0, 0.6, 0.7, 0.6, 0.85, 0.6, 0.7, 0.6,  // beats 1-2
        0.9, 0.6, 0.7, 0.6, 0.8, 0.6, 0.7, 0.65,  // beats 3-4
      ],
      fillDensity: params?.fillDensity ?? 0.5,
    };
  }

  /** Update BPM. */
  setBPM(bpm: number) { this.s16 = 60 / bpm / 4; }

  /** Update groove parameters. */
  setParams(params: Partial<GrooveParams>) {
    this.params = { ...this.params, ...params };
  }

  /**
   * Process a step — returns the actual timing and velocity after groove.
   * This is the core groove transformation.
   */
  processStep(step: number, baseTime: number, baseVelocity: number, bar: number, section: string): GrooveEvent {
    const sb = step % 16;
    const isOffbeat = sb % 2 === 1;
    const isDownbeat = sb % 4 === 0;
    const isBackbeat = sb === 4 || sb === 12;

    // ── MICROTIMING ──
    // Offbeats get delayed (swing), downbeats stay tight
    let timingOffset = 0;
    if (isOffbeat) {
      timingOffset = this.params.swing * this.s16 * 0.5; // max half a 32nd delay
    }
    // Tiny random micro-variation (±2ms — imperceptible but adds life)
    if (this.params.microTiming > 0) {
      const microVar = (this.seededRandom(step + bar * 16) - 0.5) * 0.004 * this.params.microTiming;
      timingOffset += microVar;
    }

    // ── VELOCITY CURVE ──
    let velocity = baseVelocity;
    if (this.params.velocityCurve > 0) {
      const accent = this.params.accentPattern[sb] ?? 0.7;
      velocity *= accent;
    }

    // ── ACCENTS ──
    const isAccent = isDownbeat || isBackbeat;
    if (isAccent) {
      velocity *= 1.0 + this.params.velocityCurve * 0.1;
    }

    // ── GHOST NOTES ──
    const isGhost = !isDownbeat && !isBackbeat && this.seededRandom(step + bar * 16 + 999) < this.params.ghostProbability;
    if (isGhost) {
      velocity *= 0.3; // ghost notes are quiet
    }

    // ── FILLS (last bar of 4-bar phrase) ──
    const isFillBar = bar % 4 === 3 && sb >= 12;
    const isFill = isFillBar && section !== 'break' && this.seededRandom(step) < this.params.fillDensity;

    // Clamp velocity
    velocity = Math.max(0.05, Math.min(1, velocity));

    return {
      step: sb,
      time: baseTime + timingOffset,
      velocity,
      isGhost,
      isAccent,
      isFill,
    };
  }

  /**
   * Get fill pattern for last bar of phrase.
   * Returns extra percussion events for steps 12-15.
   */
  getFillEvents(bar: number, baseTime: number): GrooveEvent[] {
    const events: GrooveEvent[] = [];
    if (bar % 4 !== 3) return events; // only last bar of 4-bar phrase

    // Fill pattern: steps 12,13,14,15 get progressively busier
    const fillSteps = [12, 13, 14, 15];
    const fillVelocities = [0.5, 0.6, 0.7, 0.9]; // rising energy

    for (let i = 0; i < fillSteps.length; i++) {
      if (this.seededRandom(fillSteps[i] + bar) < this.params.fillDensity) {
        events.push({
          step: fillSteps[i],
          time: baseTime + fillSteps[i] * this.s16,
          velocity: fillVelocities[i],
          isGhost: false,
          isAccent: i === fillSteps.length - 1, // last fill step is accent
          isFill: true,
        });
      }
    }

    return events;
  }

  /** Seeded deterministic random (same seed = same result). */
  private seededRandom(seed: number): number {
    const s = (seed * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  }

  /** Get current groove parameters. */
  getParams(): GrooveParams { return { ...this.params }; }
}

/**
 * World-specific groove presets.
 * Different worlds have different groove characteristics.
 */
export const GROOVE_PRESETS: Record<string, Partial<GrooveParams>> = {
  'progressive-psy': {
    swing: 0.08,      // tight, minimal swing
    microTiming: 0.2, // subtle variation
    velocityCurve: 0.35,
    ghostProbability: 0.1,
    fillDensity: 0.4,
  },
  'dark-psy': {
    swing: 0.04,      // very tight (dark-psy is precise)
    microTiming: 0.15,
    velocityCurve: 0.5,
    ghostProbability: 0.2,
    fillDensity: 0.6,
  },
  'goa': {
    swing: 0.06,
    microTiming: 0.25,
    velocityCurve: 0.4,
    ghostProbability: 0.15,
    fillDensity: 0.5,
  },
  'morning-psy': {
    swing: 0.1,
    microTiming: 0.3,
    velocityCurve: 0.35,
    ghostProbability: 0.12,
    fillDensity: 0.45,
  },
  'forest': {
    swing: 0.05,
    microTiming: 0.2,
    velocityCurve: 0.45,
    ghostProbability: 0.18,
    fillDensity: 0.55,
  },
  'hypnotic': {
    swing: 0.08,
    microTiming: 0.35,
    velocityCurve: 0.3,
    ghostProbability: 0.08,
    fillDensity: 0.3,
  },
  'cosmic': {
    swing: 0.1,
    microTiming: 0.4,
    velocityCurve: 0.3,
    ghostProbability: 0.1,
    fillDensity: 0.35,
  },
  'acid-psy': {
    swing: 0.06,
    microTiming: 0.25,
    velocityCurve: 0.45,
    ghostProbability: 0.15,
    fillDensity: 0.5,
  },
};
