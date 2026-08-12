/**
 * Chord types: 18 named qualities with alias lookup, voice-leading, and a
 * tension heuristic. Pitch classes are 0..11 (0 = C). MIDI note 60 = C4.
 */

export interface ChordType {
  name: string
  intervals: number[]
  aliases?: string[]
}

export const CHORD_TYPES: ChordType[] = [
  { name: 'major', intervals: [0, 4, 7], aliases: ['maj', 'M'] },
  { name: 'minor', intervals: [0, 3, 7], aliases: ['min', 'm'] },
  { name: 'diminished', intervals: [0, 3, 6], aliases: ['dim', 'o'] },
  { name: 'augmented', intervals: [0, 4, 8], aliases: ['aug', '+'] },
  { name: 'sus2', intervals: [0, 2, 7] },
  { name: 'sus4', intervals: [0, 5, 7] },
  { name: 'maj7', intervals: [0, 4, 7, 11], aliases: ['M7'] },
  { name: 'min7', intervals: [0, 3, 7, 10], aliases: ['m7'] },
  { name: 'dom7', intervals: [0, 4, 7, 10], aliases: ['7', 'dominant7'] },
  { name: 'min7b5', intervals: [0, 3, 6, 10], aliases: ['half-diminished', 'm7b5'] },
  { name: 'dim7', intervals: [0, 3, 6, 9] },
  { name: 'min-maj7', intervals: [0, 3, 7, 11], aliases: ['mMaj7', 'mM7'] },
  { name: 'maj6', intervals: [0, 4, 7, 9], aliases: ['M6', '6'] },
  { name: 'min6', intervals: [0, 3, 7, 9], aliases: ['m6'] },
  { name: 'min9', intervals: [0, 3, 7, 10, 14], aliases: ['m9'] },
  { name: 'maj9', intervals: [0, 4, 7, 11, 14], aliases: ['M9'] },
  { name: 'dom9', intervals: [0, 4, 7, 10, 14], aliases: ['9', 'dominant9'] },
  { name: 'min11', intervals: [0, 3, 7, 10, 14, 17], aliases: ['m11'] },
]

/** Lookup a chord type by name or alias (case-insensitive). Returns null if not found. */
export function getChordType(name: string): ChordType | null {
  const lower = name.toLowerCase()
  for (const c of CHORD_TYPES) {
    if (c.name.toLowerCase() === lower) return c
    if (c.aliases) {
      for (const a of c.aliases) {
        if (a.toLowerCase() === lower) return c
      }
    }
  }
  return null
}

/** All registered chord types. */
export function listChordTypes(): ChordType[] {
  return CHORD_TYPES.slice()
}

/** Pitch classes of `type` rooted at `rootPc` (0..11 each). */
export function chordPcs(rootPc: number, type: ChordType): number[] {
  return type.intervals.map((iv) => (((rootPc + iv) % 12) + 12) % 12)
}

/** MIDI notes of `type` rooted at `rootPc` at the given octave (C4 = 60). */
export function chordNotes(rootPc: number, type: ChordType, octave = 4): number[] {
  const baseMidi = 12 * (octave + 1) + rootPc
  return type.intervals.map((iv) => baseMidi + iv)
}

/**
 * Voice `type` rooted at `rootPc` with greedy nearest-note voice leading
 * relative to `previousVoicing`. Each chord tone is placed in the octave
 * closest to the corresponding previous note. If no previous voicing is
 * supplied, the default close-position voicing is returned.
 */
export function voiceChord(
  rootPc: number,
  type: ChordType,
  previousVoicing: number[] | undefined,
  octave = 4
): number[] {
  const pcs = chordPcs(rootPc, type)
  if (!previousVoicing || previousVoicing.length === 0) {
    return chordNotes(rootPc, type, octave)
  }
  return pcs.map((pc, i) => {
    const prev = previousVoicing[i] ?? previousVoicing[previousVoicing.length - 1] ?? 60
    const k = Math.round((prev - pc) / 12)
    return pc + 12 * k
  })
}

/**
 * Tension heuristic in [0, 1]. Tritones add 0.3, chord extensions (9ths/11ths/13ths
 * — intervals >= 14) add 0.15 each, augmented fifths add 0.2. Capped at 1.
 */
export function chordTension(type: ChordType): number {
  const intervals = type.intervals
  let tension = 0.1
  let hasTritone = false
  for (let i = 0; i < intervals.length && !hasTritone; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      if (Math.abs((intervals[j] as number) - (intervals[i] as number)) === 6) {
        hasTritone = true
        break
      }
    }
  }
  if (hasTritone) tension += 0.3
  for (const iv of intervals) {
    if (iv >= 14) tension += 0.15
  }
  if (intervals.includes(8)) tension += 0.2
  return Math.min(1, tension)
}
