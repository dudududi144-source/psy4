/**
 * Deterministic Pseudo-Random Number Generator.
 *
 * REAL IMPLEMENTATION.
 *
 * Used everywhere in the studio so that every "random" choice is reproducible
 * from a seed. This is what makes the psychedelic generation engine deterministic
 * and the reproducibility tests pass.
 *
 * Algorithm: mulberry32 — fast, full 32-bit period, good distribution,
 * deterministic across all JS runtimes.
 */

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** Raw 32-bit unsigned integer in [0, 4294967295]. */
  nextUint32(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Boolean true with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Pick a random element. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }

  /** Gaussian-ish value via sum of uniforms (Irwin–Hall, n=3). */
  gaussian(mean = 0, spread = 1): number {
    const r = (this.next() + this.next() + this.next()) / 3 - 0.5;
    return mean + r * 2 * spread;
  }

  /** Spawn a derived generator with a deterministic sub-seed. */
  fork(label: number): Rng {
    return new Rng(this.nextUint32() ^ (label >>> 0));
  }

  snapshot(): number {
    return this.state;
  }
}

/** Hash a string into a 32-bit seed (for named seeds). */
export function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
