/**
 * Deterministic PRNG — mulberry32.
 *
 * All forensic rendering uses this. No Math.random() anywhere.
 * Same seed => same output, always.
 */

export class Rng {
  private state: number;

  constructor(seed: number) {
    // Ensure non-zero state
    this.state = (seed >>> 0) || 1;
  }

  /** Float in [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Pick from array */
  pick<T>(arr: T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }

  /** Boolean with probability p */
  chance(p: number): boolean {
    return this.next() < p;
  }
}
