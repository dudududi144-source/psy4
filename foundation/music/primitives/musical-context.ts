/**
 * MusicalContext: the live musical situation at a given bar/beat.
 *
 * Carries tonal (tonic, scale, harmonic context), temporal (bpm, meter,
 * positions), and shaping (density / energy / tension / pressures) state.
 * The phrase and section planners read it to decide which motif material to
 * place and how strongly to repeat vs vary it.
 */

export interface MusicalContext {
  /** Root pitch class 0-11. */
  tonic: number
  /** Scale name (matches {@link Scale.name} or one of its aliases). */
  scaleName: string
  /** Register reference octave (4 = middle). */
  octave: number
  /** Tempo reference (bpm). */
  bpm: number
  /** Meter: beats per bar. */
  beatsPerBar: number
  /** Current beat within bar (0-based). */
  beatPosition: number
  /** Current bar within section (0-based). */
  barPosition: number
  /** Current bar within phrase (0-based). */
  phrasePosition: number
  /** Active chord pitch classes (empty = no chord / single tonic). */
  harmonicContext: number[]
  /** Target density 0..1. */
  density: number
  /** Target energy 0..1. */
  energy: number
  /** Target tension 0..1. */
  tension: number
  /** Section role label. */
  sectionRole: string
  /** 0..1 — how much the context wants repetition. */
  repetitionPressure: number
  /** 0..1 — how much the context wants novelty. */
  noveltyPressure: number
}

/** Build a MusicalContext, applying sensible defaults for omitted fields. */
export function createMusicalContext(opts: Partial<MusicalContext> = {}): MusicalContext {
  const defaults: MusicalContext = {
    tonic: 4, // E
    scaleName: 'phrygian-dominant',
    octave: 4,
    bpm: 145,
    beatsPerBar: 4,
    beatPosition: 0,
    barPosition: 0,
    phrasePosition: 0,
    harmonicContext: [],
    density: 0.5,
    energy: 0.5,
    tension: 0.3,
    sectionRole: 'ESTABLISH',
    repetitionPressure: 0.5,
    noveltyPressure: 0.5,
  }
  return { ...defaults, ...opts }
}

/** Whether the context's harmonicContext is empty (no chord). */
export function hasChord(ctx: MusicalContext): boolean {
  return ctx.harmonicContext.length > 0
}
