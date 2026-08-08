/**
 * GROOVE ENGINE — shared musical timing model.
 *
 * Every rhythmic instrument consumes the same GrooveState. No independent
 * timing randomness. The kick is the temporal anchor (zero variance).
 * Bass locks to kick. Hats/shakers/percussion get controlled variation.
 *
 * REAL IMPLEMENTATION.
 */

import { Rng } from '../rng';

export interface GrooveState {
  tempo: number;
  swing: number;          // 0..0.5 (0 = straight, 0.5 = full swing)
  /** Per-instrument microtiming in samples (positive = late, negative = early). */
  microTiming: {
    kick: number;
    bass: number;
    hat: number;
    shaker: number;
    percussion: number;
    clap: number;
  };
  /** Velocity curve: downbeat, backbeat, offbeat, ghost, accent. */
  velocityCurve: {
    downbeat: number;
    backbeat: number;
    offbeat: number;
    ghost: number;
    accent: number;
  };
  /** Accent pattern (16 steps, 0..1). */
  accentPattern: number[];
  /** Syncopation amount (0..1). */
  syncopation: number;
  /** Density (0..1). */
  density: number;
  /** Humanization (0..1) — deterministic variation amount. */
  humanization: number;
}

/** Build a GrooveState from world parameters + macros. */
export function createGrooveState(
  tempo: number,
  swing: number,
  density: number,
  grooveMacro: number,
  rng: Rng
): GrooveState {
  const sr = 22050; // default sample rate for microtiming calculation
  const humanization = grooveMacro * 0.5;

  // Microtiming: kick = rock solid, bass = tight, hats/shakers = more alive
  // All deterministic from rng — no Math.random()
  const kickVariance = 0;  // kick is the anchor
  const bassVariance = humanization * 1;   // ±1 sample max
  const hatVariance = humanization * 3;
  const shakerVariance = humanization * 5;
  const percVariance = humanization * 4;

  // Accent pattern: downbeats strong, backbeats medium, syncopation on offbeats
  const accentPattern: number[] = [];
  for (let s = 0; s < 16; s++) {
    let accent = 0.6;
    if (s % 4 === 0) accent = 1.0;        // downbeat
    else if (s % 4 === 2) accent = 0.8;   // backbeat
    else if (s % 2 === 1) accent = 0.5 + syncopationLevel(swing, density) * 0.3; // offbeat
    else accent = 0.4;
    accentPattern.push(accent);
  }

  return {
    tempo,
    swing,
    microTiming: {
      kick: kickVariance,
      bass: rng.int(-bassVariance, bassVariance),
      hat: rng.int(-hatVariance, hatVariance),
      shaker: rng.int(-shakerVariance, shakerVariance),
      percussion: rng.int(-percVariance, percVariance),
      clap: rng.int(-percVariance, percVariance),
    },
    velocityCurve: {
      downbeat: 1.0,
      backbeat: 0.88,
      offbeat: 0.75,
      ghost: 0.45,
      accent: 1.0,
    },
    accentPattern,
    syncopation: syncopationLevel(swing, density),
    density,
    humanization,
  };
}

function syncopationLevel(swing: number, density: number): number {
  return swing * 0.5 + density * 0.3;
}

/** Get velocity for a specific step using the groove state. */
export function getVelocity(groove: GrooveState, step: number, baseVelocity: number): number {
  const accent = groove.accentPattern[step % 16] || 0.6;
  let role: keyof GrooveState['velocityCurve'] = 'offbeat';
  if (step % 4 === 0) role = 'downbeat';
  else if (step % 4 === 2) role = 'backbeat';
  else if (step % 2 === 1) role = 'offbeat';
  const roleVel = groove.velocityCurve[role];
  // blend role velocity with accent pattern
  const blended = roleVel * 0.6 + accent * 0.4;
  return baseVelocity * blended;
}

/** Get swing offset for a step (delayed odd 16ths). */
export function getSwingOffset(groove: GrooveState, step: number, samplesPerSixteenth: number): number {
  if (groove.swing > 0 && step % 2 === 1) {
    return Math.floor(samplesPerSixteenth * groove.swing);
  }
  return 0;
}

/** Get microtiming offset for an instrument. */
export function getMicroTiming(groove: GrooveState, instrument: keyof GrooveState['microTiming']): number {
  return groove.microTiming[instrument];
}
