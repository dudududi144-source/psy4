/**
 * Scales and modes: 18 named scales with alias lookup and degree/pitch-class
 * conversion helpers. Pitch classes are 0..11 (0 = C). MIDI note 60 = C4.
 */

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export interface Scale {
  name: string
  intervals: number[]
  aliases?: string[]
}

export const SCALES: Scale[] = [
  { name: 'major', intervals: [0, 2, 4, 5, 7, 9, 11], aliases: ['ionian'] },
  { name: 'minor', intervals: [0, 2, 3, 5, 7, 8, 10], aliases: ['natural-minor', 'aeolian'] },
  { name: 'harmonic-minor', intervals: [0, 2, 3, 5, 7, 8, 11] },
  { name: 'melodic-minor', intervals: [0, 2, 3, 5, 7, 9, 11] },
  { name: 'dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'phrygian', intervals: [0, 1, 3, 5, 7, 8, 10] },
  { name: 'lydian', intervals: [0, 2, 4, 6, 7, 9, 11] },
  { name: 'mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
  { name: 'locrian', intervals: [0, 1, 3, 5, 6, 8, 10] },
  {
    name: 'phrygian-dominant',
    intervals: [0, 1, 4, 5, 7, 8, 10],
    aliases: ['spanish-gypsy', 'phrygian-major'],
  },
  { name: 'double-harmonic', intervals: [0, 1, 4, 5, 7, 8, 11] },
  { name: 'hungarian-major', intervals: [0, 3, 4, 6, 7, 9, 10] },
  { name: 'neapolitan-minor', intervals: [0, 1, 3, 5, 7, 8, 11] },
  { name: 'major-pentatonic', intervals: [0, 2, 4, 7, 9] },
  { name: 'minor-pentatonic', intervals: [0, 3, 5, 7, 10] },
  { name: 'blues', intervals: [0, 3, 5, 6, 7, 10] },
  { name: 'whole-tone', intervals: [0, 2, 4, 6, 8, 10] },
  { name: 'diminished', intervals: [0, 2, 3, 5, 6, 8, 9, 11] },
]

/** Lookup a scale by name or alias (case-insensitive). Returns null if not found. */
export function getScale(name: string): Scale | null {
  const lower = name.toLowerCase()
  for (const s of SCALES) {
    if (s.name.toLowerCase() === lower) return s
    if (s.aliases) {
      for (const a of s.aliases) {
        if (a.toLowerCase() === lower) return s
      }
    }
  }
  return null
}

/** All registered scales. */
export function listScales(): Scale[] {
  return SCALES.slice()
}

/** Pitch class 0..11 -> note name ("C", "C#", ...). Wraps negatives. */
export function pcToName(pc: number): string {
  return NOTE_NAMES[((pc % 12) + 12) % 12] as string
}

/** Note name -> pitch class, or -1 if not recognised. */
export function nameToPc(name: string): number {
  const idx = NOTE_NAMES.indexOf(name as (typeof NOTE_NAMES)[number])
  return idx >= 0 ? idx : -1
}

/** Pitch classes of `scale` rooted at `rootPc` (0..11 each). */
export function scalePcs(rootPc: number, scale: Scale): number[] {
  return scale.intervals.map((iv) => (((rootPc + iv) % 12) + 12) % 12)
}

/** MIDI notes of `scale` rooted at `rootPc` within [fromMidi, toMidi] inclusive. */
export function scaleNotes(
  rootPc: number,
  scale: Scale,
  fromMidi: number,
  toMidi: number
): number[] {
  const out: number[] = []
  for (let m = fromMidi; m <= toMidi; m++) {
    if (isInScale(rootPc, scale, m)) out.push(m)
  }
  return out
}

/** Scale degree (0-indexed, may be negative or exceed length) -> pitch class. */
export function degreeToPc(rootPc: number, scale: Scale, degree: number): number {
  const len = scale.intervals.length
  if (len === 0) return ((rootPc % 12) + 12) % 12
  const idx = ((degree % len) + len) % len
  const interval = scale.intervals[idx] as number
  return (((rootPc + interval) % 12) + 12) % 12
}

/**
 * Scale degree -> MIDI note. `degree` may be negative or exceed scale length;
 * octave bumps are applied automatically. C4 = 60.
 */
export function degreeToMidi(rootPc: number, scale: Scale, degree: number, octave = 4): number {
  const len = scale.intervals.length
  const baseMidi = 12 * (octave + 1) + rootPc
  if (len === 0) return baseMidi
  const octaveOffset = Math.floor(degree / len)
  const idx = ((degree % len) + len) % len
  const interval = scale.intervals[idx] as number
  return baseMidi + 12 * octaveOffset + interval
}

/** Whether `midi` belongs to `scale` rooted at `rootPc`. */
export function isInScale(rootPc: number, scale: Scale, midi: number): boolean {
  const pc = ((midi % 12) + 12) % 12
  const pcs = scalePcs(rootPc, scale)
  return pcs.includes(pc)
}

/** Index of the scale degree whose pitch class is closest to `midi`. */
export function nearestDegree(rootPc: number, scale: Scale, midi: number): number {
  const pc = ((midi % 12) + 12) % 12
  const pcs = scalePcs(rootPc, scale)
  let best = 0
  let bestDist = 12
  for (let i = 0; i < pcs.length; i++) {
    const spc = pcs[i] as number
    const dist = Math.min((spc - pc + 12) % 12, (pc - spc + 12) % 12)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}

/**
 * Stable scale degrees: the root (0) and the degree closest to a perfect fifth
 * (interval class 7). For 7-note major/minor scales this is [0, 4].
 */
export function stableDegrees(scale: Scale): number[] {
  const intervals = scale.intervals
  if (intervals.length < 2) return [0]
  let fifthIdx = 1
  let bestDist = 12
  for (let i = 1; i < intervals.length; i++) {
    const iv = intervals[i] as number
    const dist = Math.min((iv - 7 + 12) % 12, (7 - iv + 12) % 12)
    if (dist < bestDist) {
      bestDist = dist
      fifthIdx = i
    }
  }
  return [0, fifthIdx]
}
