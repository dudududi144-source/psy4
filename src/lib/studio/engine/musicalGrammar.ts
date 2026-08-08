/**
 * Musical Grammar Engine — port of PSY3's psy_gen.py.
 *
 * PSY3 uses controlled mutation, not randomness:
 *   - EvolvingSequence: 16-step motif with single-step mutation every N bars
 *   - EvolvingParam: bounded random walk with mean-reversion
 *   - tension_at(): arc/rise/fall/wave/plateau shapes for section energy
 *   - density_at(): probability gating with downbeat+offbeat accents
 *
 * This replaces PSY4's previous `pick([0,0,2,4,7])` random note selection
 * with intentional musical phrase generation.
 *
 * Key principle: variation happens through CONTROLLED MUTATION, not random chaos.
 * The same phrase is recognizable; it evolves over time.
 */

// ─── Scales ────────────────────────────────────────────────────────────────

export const SCALES: Record<string, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  doubleHarmonic: [0, 1, 4, 5, 7, 8, 11],
  minorPentatonic: [0, 3, 5, 7, 10],
};

// ─── Chord Progressions (scale degrees) ────────────────────────────────────

export const PROGRESSIONS: Record<string, number[]> = {
  minor: [0, 5, 3, 4],
  phrygian: [0, 3, 4, 2],
  harmonicMinor: [0, 4, 5, 3],
  dorian: [0, 3, 4, 6],
  phrygianDominant: [0, 3, 4, 6],
};

// ─── Seeded RNG (deterministic) ────────────────────────────────────────────

export class SeededRng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number { this.s = (this.s * 1664525 + 1013904223) >>> 0; return this.s / 4294967296; }
  int(min: number, max: number): number { return Math.floor(this.next() * (max - min + 1)) + min; }
  pick<T>(a: T[]): T { return a[Math.floor(this.next() * a.length)]; }
  chance(p: number): boolean { return this.next() < p; }
  gauss(m: number, sd: number): number { return m + sd * (this.next() + this.next() + this.next() - 1.5); }
}

// ─── Scale helper ──────────────────────────────────────────────────────────

export function scaleNote(root: number, scale: string, deg: number): number {
  const sc = SCALES[scale] || SCALES.minor;
  const n = sc.length;
  const oct = Math.floor(deg / n);
  const idx = ((deg % n) + n) % n;
  return root + 12 * oct + sc[idx];
}

export function mtof(m: number): number { return 440 * Math.pow(2, (m - 69) / 12); }

// ─── EvolvingParam: bounded random walk with mean-reversion ────────────────
// Port of PSY3 EvolvingParam. Never escapes its range.

export class EvolvingParam {
  private base: number;
  private range: number;
  private walkRate: number;
  private rng: SeededRng;
  private walk = 0;
  value: number;

  constructor(base: number, range: number, walkRate: number, rng: SeededRng) {
    this.base = base;
    this.range = range;
    this.walkRate = walkRate;
    this.rng = rng;
    this.value = base;
  }

  step() {
    this.walk += this.rng.gauss(0, this.walkRate);
    this.walk = Math.max(-this.range, Math.min(this.range, this.walk));
    this.walk *= 0.992; // mean reversion
    this.value = this.base + this.walk;
  }
}

// ─── EvolvingSequence: 16-step motif with controlled mutation ──────────────
// Port of PSY3 EvolvingSequence.
// Generates a 16-note pattern that mutates ONE note every N bars.
// This preserves musical identity while creating evolution.

export class EvolvingSequence {
  private root: number;
  private scale: string;
  private rng: SeededRng;
  private mutateEvery: number;
  private motifRange: number;
  private pattern: number[] = [];
  private pos = 0;
  private cnt = 0;

  constructor(root: number, scale: string, rng: SeededRng, mutateEvery = 4, motifRange = 5) {
    this.root = root;
    this.scale = scale;
    this.rng = rng;
    this.mutateEvery = mutateEvery;
    this.motifRange = motifRange;
    this.regenerate();
  }

  regenerate() {
    this.pattern = [0];
    for (let i = 1; i < 16; i++) {
      const step = this.rng.pick([-2, -1, -1, 0, 1, 1, 2]);
      this.pattern.push(Math.max(-this.motifRange, Math.min(this.motifRange, this.pattern[i - 1] + step)));
    }
    this.cnt = 0;
  }

  next(): number {
    const note = scaleNote(this.root, this.scale, this.pattern[this.pos]);
    this.pos = (this.pos + 1) % 16;
    this.cnt++;
    // Mutate ONE note every mutateEvery * 16 steps
    if (this.cnt >= this.mutateEvery * 16) {
      const i = this.rng.int(0, 15);
      const step = this.rng.pick([-2, -1, 1, 2]);
      this.pattern[i] = Math.max(-this.motifRange, Math.min(this.motifRange, this.pattern[i] + step));
      this.cnt = 0;
    }
    return note;
  }

  /** Get the current pattern (for display/debugging). */
  getPattern(): number[] { return [...this.pattern]; }

  /** Force a mutation (for section transitions). */
  forceMutate() {
    const i = this.rng.int(0, 15);
    const step = this.rng.pick([-2, -1, 1, 2]);
    this.pattern[i] = Math.max(-this.motifRange, Math.min(this.motifRange, this.pattern[i] + step));
  }
}

// ─── Tension Shapes ────────────────────────────────────────────────────────
// Port of PSY3 tension_at(). Controls energy/density across a section.

export type TensionShape = 'arc' | 'rise' | 'fall' | 'wave' | 'plateau';

export function tensionAt(p: number, shape: TensionShape = 'arc'): number {
  p = Math.max(0, Math.min(1, p));
  switch (shape) {
    case 'rise': return p;
    case 'fall': return 1 - p;
    case 'arc': return 4 * p * (1 - p);
    case 'wave': return 0.5 + 0.5 * Math.sin(2 * Math.PI * p * 2 - Math.PI / 2);
    case 'plateau':
      return p < 0.15 ? p / 0.15 : (p > 0.85 ? (1 - p) / 0.15 : 1);
  }
  return p;
}

export function densityAt(p: number, base: number, shape: TensionShape = 'arc'): number {
  return Math.max(0.15, base * (0.4 + 0.6 * tensionAt(p, shape)));
}

// ─── Bass Grammar: Explicit psytrance bass patterns ────────────────────────
// Instead of random pick(), use explicit patterns that encode musical intent.
// Each pattern is 8 steps (half a bar of 16th notes).

export type BassPattern = {
  name: string;
  steps: number[];     // scale degree per step (0 = root, 4 = fifth, 7 = octave, -1 = rest)
  accents: number[];   // velocity multiplier per step (0..1)
};

export const BASS_PATTERNS: Record<string, BassPattern[]> = {
  // Rolling psy bass (dark-psy, forest) — 16th note rolls
  roll: [
    {
      name: 'roll-root',
      steps: [0, 0, 0, 0, 0, 0, 0, 0],
      accents: [1.0, 0.7, 0.8, 0.6, 1.0, 0.7, 0.8, 0.6],
    },
    {
      name: 'roll-walk',
      steps: [0, 0, 4, 0, 7, 0, 4, 0],
      accents: [1.0, 0.7, 0.8, 0.6, 0.9, 0.7, 0.8, 0.6],
    },
    {
      name: 'roll-passing',
      steps: [0, 0, 2, 4, 7, 4, 2, 0],
      accents: [1.0, 0.7, 0.6, 0.7, 0.9, 0.7, 0.6, 0.7],
    },
  ],
  // Offbeat bass (progressive, morning) — plays on offbeats
  off: [
    {
      name: 'off-root',
      steps: [-1, 0, -1, 0, -1, 0, -1, 0],
      accents: [0, 0.9, 0, 0.8, 0, 0.9, 0, 0.8],
    },
    {
      name: 'off-walk',
      steps: [-1, 0, -1, 4, -1, 7, -1, 4],
      accents: [0, 0.9, 0, 0.8, 0, 0.9, 0, 0.8],
    },
  ],
  // Acid bass (goa, acid-psy) — denser with ghost notes
  acid: [
    {
      name: 'acid-1',
      steps: [0, 0, 0, 4, 0, 0, 7, 0],
      accents: [1.0, 0.6, 0.7, 0.8, 1.0, 0.6, 0.9, 0.6],
    },
    {
      name: 'acid-2',
      steps: [0, 4, 0, 7, 0, 4, 0, 2],
      accents: [1.0, 0.7, 0.8, 0.9, 1.0, 0.7, 0.8, 0.6],
    },
  ],
};

// ─── Lead Motif: AABA structure with development ──────────────────────────

export class LeadMotif {
  private seq: EvolvingSequence;
  private phrasePos = 0;
  private phraseLength = 16; // 1 bar of 16th notes

  constructor(root: number, scale: string, rng: SeededRng) {
    this.seq = new EvolvingSequence(root + 12, scale, rng, 4, 5);
  }

  /**
   * Get the next lead note for step `step` in a phrase.
   * Returns null if no note should play (rest).
   * Uses AABA structure: bars 0-1 = A, bar 2 = B (contrast), bar 3 = A' (return).
   */
  nextNote(step: number, bar: number, energy: number, rng: SeededRng): { note: number; velocity: number } | null {
    const phraseBar = bar % 4;
    const isBSection = phraseBar === 2; // B section = contrasting

    // Density: B section plays more, A sections are more sparse
    const density = isBSection ? 0.7 : 0.5;
    if (!rng.chance(density * energy)) return null;

    const note = this.seq.next();
    // B section plays an octave higher for contrast
    const finalNote = isBSection ? note + 12 : note;
    // Velocity: downbeat accent
    const beatPos = step % 4;
    const velocity = (beatPos === 0 ? 0.8 : 0.5) * energy;

    return { note: finalNote, velocity };
  }

  /** Force a mutation at section boundaries. */
  evolve() {
    this.seq.forceMutate();
  }
}

// ─── Acid Pattern: Stored patterns with controlled mutation ────────────────

export class AcidPattern {
  private pattern: number[] = [];
  private pos = 0;
  private rng: SeededRng;
  private root: number;
  private scale: string;

  // Classic acid pattern: root, root, fifth, root, octave, root, fifth, third
  private static PATTERNS: number[][] = [
    [0, 0, 4, 0, 7, 0, 4, 7],   // root-fifth-octave
    [0, 4, 7, 4, 0, 7, 4, 0],   // walking
    [0, 0, 7, 0, 4, 0, 7, 12],  // with octave
    [0, 2, 4, 7, 4, 2, 0, -1],  // descending with rest
  ];

  constructor(root: number, scale: string, rng: SeededRng) {
    this.root = root + 12;
    this.scale = scale;
    this.rng = rng;
    this.pattern = [...rng.pick(AcidPattern.PATTERNS)];
  }

  next(): number | null {
    const degree = this.pattern[this.pos];
    this.pos = (this.pos + 1) % this.pattern.length;
    if (degree < 0) return null; // rest
    return scaleNote(this.root, this.scale, degree);
  }

  /** Mutate one step (controlled variation). */
  mutate() {
    const i = this.rng.int(0, this.pattern.length - 1);
    const newDegree = this.rng.pick([0, 4, 7, 12, -1, 2]);
    this.pattern[i] = newDegree;
  }
}
