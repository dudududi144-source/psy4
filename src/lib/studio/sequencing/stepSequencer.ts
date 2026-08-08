/**
 * SEQUENCING — Step sequencer + pattern model + Elektron-style parameter locks.
 * SIMULATED HARDWARE BEHAVIOR (mirrors Rytm/Digitakt sequencing logic).
 *
 * The sequencer reads from the transport clock and emits note events at
 * sample-accurate positions. Parameter locks + probability + retrigs mirror
 * the Elektron workflow that defines the rig's rhythmic identity.
 */

import { Transport } from '../clock';
import { Rng } from '../rng';

export interface StepEvent {
  /** Sample offset (absolute) when the event fires. */
  sample: number;
  /** MIDI note (for synths) or drum-voice index. */
  note: number;
  velocity: number;     // 0..1
  duration: number;     // samples
  /** Parameter locks attached to this step. */
  locks?: Record<string, number>;
  /** Micro-timing offset in samples (humanize / swing). */
  offset?: number;
  /** Retrigger count (Elektron retrigs). */
  retrig?: number;
  /** Retrigger rate (samples between retriggers). */
  retrigRate?: number;
  /** Optional pitch offset for retrig accumulations. */
  retrigPitch?: number;
}

export interface Pattern {
  steps: number;                // typically 16
  events: StepEvent[];          // resolved events for the pattern
  swing: number;                // 0..0.5
  length: number;               // steps actually used (<=steps)
}

/**
 * Pattern generator. Given a recipe, produces resolved StepEvents with
 * deterministic micro-timing + probability gating.
 */
export interface PatternRecipe {
  steps: number;
  /** Per-step gate (true = note fires). */
  gates: boolean[];
  /** Per-step note/voice. */
  notes: number[];
  /** Per-step velocity 0..1. */
  velocities: number[];
  /** Per-step durations in sixteenths. */
  durations: number[];
  /** Per-step probability 0..1 (gate must pass AND roll). */
  probabilities: number[];
  /** Per-step parameter locks. */
  locks?: Record<number, Record<string, number>>;
  swing?: number;
  length?: number;
  /** Per-step retrig count + rate (sixteenths divisor). */
  retrigs?: { count: number; rate: number; pitch?: number }[];
}

export function resolvePattern(
  recipe: PatternRecipe,
  transport: Transport,
  rng: Rng,
  startBar = 0
): Pattern {
  const events: StepEvent[] = [];
  const sps = transport.samplesPerSixteenth();
  const startSample = startBar * transport.samplesPerBar();
  const swing = recipe.swing ?? 0;
  const length = recipe.length ?? recipe.steps;

  for (let i = 0; i < length; i++) {
    if (!recipe.gates[i]) continue;
    if (!rng.chance(recipe.probabilities[i])) continue;

    let samplePos = startSample + i * sps;
    // swing: delay odd 16ths
    if (swing > 0 && i % 2 === 1) {
      samplePos += sps * swing;
    }
    // tiny humanize (±2 samples)
    samplePos += rng.int(-2, 2);

    const retrig = recipe.retrigs?.[i];
    const baseDur = recipe.durations[i] * sps;

    if (retrig && retrig.count > 1) {
      const retrigGap = sps / retrig.rate;
      for (let r = 0; r < retrig.count; r++) {
        events.push({
          sample: Math.floor(samplePos + r * retrigGap),
          note: recipe.notes[i] + (retrig.pitch ?? 0) * r,
          velocity: recipe.velocities[i] * (1 - r * 0.08),
          duration: Math.floor(retrigGap * 0.9),
          locks: recipe.locks?.[i],
          retrig: r,
          retrigRate: Math.floor(retrigGap),
        });
      }
    } else {
      events.push({
        sample: Math.floor(samplePos),
        note: recipe.notes[i],
        velocity: recipe.velocities[i],
        duration: Math.floor(baseDur),
        locks: recipe.locks?.[i],
      });
    }
  }

  // sort by sample
  events.sort((a, b) => a.sample - b.sample);

  return { steps: recipe.steps, events, swing, length };
}

/** Helper: build a 16-step gate pattern from a string like "x...x...x...x...". */
export function gateFromString(s: string): boolean[] {
  return s.split('').map((c) => c === 'x' || c === 'X' || c === 'o');
}

/** Helper: velocities from string of digits 0-9. */
export function velFromString(s: string): number[] {
  return s.split('').map((c) => (parseInt(c, 10) || 0) / 9);
}

/** Build a psytrance kick pattern: 4-on-floor. */
export function kickPattern(): PatternRecipe {
  const g = 'x...x...x...x...';
  const v = '9...9...9...9...';
  return {
    steps: 16,
    gates: gateFromString(g),
    notes: new Array(16).fill(36), // C2 kick
    velocities: velFromString(v),
    durations: new Array(16).fill(1),
    probabilities: new Array(16).fill(1),
  };
}

/** Build a psytrance off-beat bass: notes on the off-16ths. */
export function bassPattern(roots: number[], octave = 2): PatternRecipe {
  // psytrance bass: 16th off-beats (1.5, 2.5, 3.5, 4.5 ...) → steps 2,4,6,8,10,12,14,16
  const gates: boolean[] = [];
  const notes: number[] = [];
  const vels: number[] = [];
  for (let i = 0; i < 16; i++) {
    const isBass = i % 2 === 1;
    gates.push(isBass);
    notes.push(isBass ? roots[i % roots.length] + octave * 12 : 0);
    vels.push(isBass ? 0.85 : 0);
  }
  return {
    steps: 16,
    gates,
    notes,
    velocities: vels,
    durations: new Array(16).fill(0.9),
    probabilities: new Array(16).fill(1),
  };
}
