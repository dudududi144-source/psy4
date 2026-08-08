/**
 * DSP PRIMITIVES — Noise + wavetable factories.
 * REAL IMPLEMENTATION.
 */

import { Rng } from '../rng';

/** White noise generator. */
export class WhiteNoise {
  private rng: Rng;
  constructor(seed = 99) { this.rng = new Rng(seed); }
  process(): number { return this.rng.next() * 2 - 1; }
}

/** Pink noise (Paul Kellet's filter). */
export class PinkNoise {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private b3 = 0;
  private b4 = 0;
  private b5 = 0;
  private b6 = 0;
  private rng: Rng;
  constructor(seed = 99) { this.rng = new Rng(seed); }
  process(): number {
    const white = this.rng.next() * 2 - 1;
    this.b0 = 0.99886 * this.b0 + white * 0.0555179;
    this.b1 = 0.99332 * this.b1 + white * 0.0750759;
    this.b2 = 0.96900 * this.b2 + white * 0.1538520;
    this.b3 = 0.86650 * this.b3 + white * 0.3104856;
    this.b4 = 0.55000 * this.b4 + white * 0.5329522;
    this.b5 = -0.7616 * this.b5 - white * 0.0168980;
    const pink = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + white * 0.5362;
    this.b6 = white * 0.115926;
    return pink * 0.11;
  }
}

/** Generate a wavetable from a harmonic recipe. */
export function additiveWavetable(harmonics: { n: number; amp: number }[], size = 1024): Float32Array {
  const wt = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const t = i / size;
    let v = 0;
    for (const h of harmonics) v += h.amp * Math.sin(2 * Math.PI * h.n * t);
    wt[i] = v;
  }
  let max = 0;
  for (let i = 0; i < size; i++) max = Math.max(max, Math.abs(wt[i]));
  if (max > 0) for (let i = 0; i < size; i++) wt[i] /= max;
  return wt;
}

/** Standard wavetable bank for the Iridium-style texture engine. */
export const WAVETABLE_BANK: { name: string; table: Float32Array }[] = [
  { name: 'sine', table: additiveWavetable([{ n: 1, amp: 1 }]) },
  { name: 'saw', table: additiveWavetable([1,2,3,4,5,6,7,8,9,10,11,12].map((n) => ({ n, amp: 1/n }))) },
  { name: 'square', table: additiveWavetable([1,3,5,7,9,11,13,15].map((n) => ({ n, amp: 1/n }))) },
  { name: 'bright', table: additiveWavetable([1,2,3,4,5,6,7,8].map((n) => ({ n, amp: Math.pow(0.85, n) }))) },
  { name: 'warm', table: additiveWavetable([{n:1,amp:1},{n:2,amp:0.5},{n:3,amp:0.2},{n:4,amp:0.1}]) },
  { name: 'formant', table: additiveWavetable([
    {n:1,amp:1},{n:5,amp:0.6},{n:6,amp:0.8},{n:7,amp:0.5},{n:12,amp:0.3}
  ]) },
  { name: 'clang', table: additiveWavetable([
    {n:1,amp:1},{n:3,amp:0.4},{n:7,amp:0.6},{n:11,amp:0.3},{n:15,amp:0.2}
  ]) },
  { name: 'shimmer', table: additiveWavetable([
    {n:1,amp:1},{n:2,amp:0.7},{n:4,amp:0.4},{n:8,amp:0.2},{n:16,amp:0.1}
  ]) },
];

/** Convert MIDI note to frequency. */
export function mtof(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/** Convert frequency to MIDI note. */
export function ftom(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

/** Note name from MIDI. */
export function noteName(note: number): string {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return names[note % 12] + Math.floor(note / 12 - 1);
}

/** Common psytrance scales (root-relative semitone offsets). */
export const SCALES: Record<string, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  minorPentatonic: [0, 3, 5, 7, 10],
  doubleHarmonic: [0, 1, 4, 5, 7, 8, 11],
};

/** Map a scale degree to a MIDI note. */
export function scaleNote(root: number, scale: number[], degree: number): number {
  const oct = Math.floor(degree / scale.length);
  const idx = ((degree % scale.length) + scale.length) % scale.length;
  return root + scale[idx] + oct * 12;
}
