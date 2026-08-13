/**
 * Deterministic mulberry32 PRNG with convenience sampling helpers.
 * Same seed -> identical sequence across runs and platforms.
 */
export class Rng {
  private state: number
  constructor(seed: number) {
    this.state = seed >>> 0
  }
  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }
  /** Random element of `arr` (must be non-empty). */
  pick<T>(arr: T[]): T {
    if (arr.length === 0) throw new Error('Rng.pick: empty array')
    return arr[this.int(0, arr.length - 1)] as T
  }
}
