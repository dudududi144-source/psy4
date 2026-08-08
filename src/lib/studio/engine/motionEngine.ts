/**
 * MOTION ENGINE — coordinated, phrase-aware psychedelic movement.
 *
 * Instead of independent random LFOs, this engine creates macro trajectories
 * that move multiple parameters together over musical time (bars/phrases/sections).
 *
 * Example:
 *   8-bar build: brightness 0.35 → 0.55, filter opens, delay increases
 *   breakdown: space 0.30 → 0.65, width increases, density decreases
 *   drop: everything snaps to high energy, then settles
 *
 * All movement is deterministic (seeded) and phrase-aware.
 *
 * REAL IMPLEMENTATION.
 */

import { Rng } from '../rng';

export interface MotionState {
  /** Current target values (0..1) for each dimension. */
  brightness: number;
  filterOpenness: number;
  delaySend: number;
  reverbSend: number;
  stereoWidth: number;
  panOffset: number;
  fmAmount: number;
  density: number;
  /** Phrase counter for deterministic variation. */
  phraseCount: number;
}

export interface MotionTarget {
  brightness: number;
  filterOpenness: number;
  delaySend: number;
  reverbSend: number;
  stereoWidth: number;
  panOffset: number;
  fmAmount: number;
  density: number;
}

/** Create initial motion state. */
export function createMotionState(): MotionState {
  return {
    brightness: 0.5,
    filterOpenness: 0.5,
    delaySend: 0.2,
    reverbSend: 0.3,
    stereoWidth: 0.5,
    panOffset: 0,
    fmAmount: 0.2,
    density: 0.5,
    phraseCount: 0,
  };
}

/** Update motion targets based on section type + phrase position.
 *  This is the core of coordinated psychedelic movement. */
export function updateMotionForSection(
  state: MotionState,
  sectionType: string,
  sectionProgress: number,  // 0..1 within the section
  macros: { energy: number; psychedelia: number; evolution: number; space: number },
  rng: Rng
): MotionState {
  const p = sectionProgress;
  const e = macros.energy;
  const psy = macros.psychedelia;
  const space = macros.space;

  let target: MotionTarget;

  switch (sectionType) {
    case 'intro':
      // gentle, dark, narrow → slowly opening
      target = {
        brightness: 0.3 + p * 0.2,
        filterOpenness: 0.4 + p * 0.2,
        delaySend: 0.15 + p * 0.1,
        reverbSend: 0.4 + p * 0.1,
        stereoWidth: 0.3 + p * 0.2,
        panOffset: 0,
        fmAmount: 0.1 + p * 0.1,
        density: 0.2 + p * 0.2,
      };
      break;

    case 'groove':
      // establish the groove, moderate energy
      target = {
        brightness: 0.45,
        filterOpenness: 0.5,
        delaySend: 0.2,
        reverbSend: 0.3,
        stereoWidth: 0.5,
        panOffset: 0,
        fmAmount: 0.15 + psy * 0.15,
        density: 0.45 * e,
      };
      break;

    case 'development':
      // introduce variation, slight increase
      target = {
        brightness: 0.5 + p * 0.1,
        filterOpenness: 0.55 + p * 0.1,
        delaySend: 0.2 + p * 0.1,
        reverbSend: 0.3,
        stereoWidth: 0.55 + p * 0.1,
        panOffset: rng.gaussian(0, 0.05),
        fmAmount: 0.2 + psy * 0.2,
        density: 0.55 * e,
      };
      break;

    case 'tension':
    case 'build':
      // rising — filter opens, delay increases, width expands
      target = {
        brightness: 0.5 + p * 0.35,
        filterOpenness: 0.55 + p * 0.4,
        delaySend: 0.2 + p * 0.25,
        reverbSend: 0.25 + p * 0.15,
        stereoWidth: 0.55 + p * 0.3,
        panOffset: 0,
        fmAmount: 0.2 + p * 0.2 + psy * 0.2,
        density: 0.6 + p * 0.2,
      };
      break;

    case 'drop':
    case 'second-drop':
      // full impact, then settle slightly
      const dropSettle = p > 0.3 ? 0.95 : 1.0;
      target = {
        brightness: 0.75 * dropSettle,
        filterOpenness: 0.85 * dropSettle,
        delaySend: 0.3,
        reverbSend: 0.3,
        stereoWidth: 0.75,
        panOffset: 0,
        fmAmount: 0.3 + psy * 0.3,
        density: 0.85 * e,
      };
      break;

    case 'breakdown':
      // spacious, exposed, reduced density, more reverb
      target = {
        brightness: 0.4 - p * 0.1,
        filterOpenness: 0.3 + p * 0.2,
        delaySend: 0.35 + p * 0.15,
        reverbSend: 0.5 + p * 0.3,
        stereoWidth: 0.7 + p * 0.2,
        panOffset: rng.gaussian(0, 0.08),
        fmAmount: 0.15 + psy * 0.15,
        density: 0.2 + p * 0.1,
      };
      break;

    case 'rebuild':
      // reintroduce elements, rising toward second drop
      target = {
        brightness: 0.5 + p * 0.3,
        filterOpenness: 0.5 + p * 0.35,
        delaySend: 0.25 + p * 0.1,
        reverbSend: 0.4 - p * 0.15,
        stereoWidth: 0.6 + p * 0.15,
        panOffset: 0,
        fmAmount: 0.2 + p * 0.15 + psy * 0.15,
        density: 0.5 + p * 0.3,
      };
      break;

    case 'outro':
      // gentle descent, narrowing
      target = {
        brightness: 0.4 - p * 0.15,
        filterOpenness: 0.4 - p * 0.15,
        delaySend: 0.3 + p * 0.1,
        reverbSend: 0.4 + p * 0.2,
        stereoWidth: 0.5 - p * 0.2,
        panOffset: 0,
        fmAmount: 0.1,
        density: 0.2 - p * 0.1,
      };
      break;

    default: // 'loop'
      // sustained groove with subtle evolution
      const evolution = macros.evolution;
      target = {
        brightness: 0.5 + Math.sin(p * Math.PI * 2) * 0.1 * evolution,
        filterOpenness: 0.6 + Math.sin(p * Math.PI * 2 + 1) * 0.1 * evolution,
        delaySend: 0.25 + Math.sin(p * Math.PI * 2 + 2) * 0.05 * evolution,
        reverbSend: 0.3 + space * 0.2,
        stereoWidth: 0.6 + Math.sin(p * Math.PI * 2 + 3) * 0.1 * evolution,
        panOffset: rng.gaussian(0, 0.03 * evolution),
        fmAmount: 0.2 + psy * 0.2,
        density: 0.7 * e,
      };
  }

  // smooth interpolation toward target (avoid abrupt jumps)
  const smoothRate = 0.005;  // per sample
  return {
    brightness: lerp(state.brightness, target.brightness, smoothRate * 256), // approximate per-block
    filterOpenness: lerp(state.filterOpenness, target.filterOpenness, smoothRate * 256),
    delaySend: lerp(state.delaySend, target.delaySend, smoothRate * 256),
    reverbSend: lerp(state.reverbSend, target.reverbSend, smoothRate * 256),
    stereoWidth: lerp(state.stereoWidth, target.stereoWidth, smoothRate * 256),
    panOffset: lerp(state.panOffset, target.panOffset, smoothRate * 256),
    fmAmount: lerp(state.fmAmount, target.fmAmount, smoothRate * 256),
    density: lerp(state.density, target.density, smoothRate * 256),
    phraseCount: state.phraseCount,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, t);
}
