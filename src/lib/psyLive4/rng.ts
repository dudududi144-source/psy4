// src/lib/psyLive4/rng.ts
// Deterministic PRNG — mulberry32. Same as composition-worker-v2.js and
// psysynth.js. Determinism is required for bit-identical offline renders
// (shim-sync / render-harness pattern from /tmp/psysynth-audit/).

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Range helper: float in [lo, hi)
export function range(rng: () => number, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

// Int helper: integer in [lo, hi] (inclusive)
export function int(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}
