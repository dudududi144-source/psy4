/**
 * Musicality metrics and health reporting.
 *
 * `measureMusicality` computes diversity metrics from a flat list of MIDI
 * events. `healthReport` compares those metrics against empirically-justified
 * healthy bounds — the bounds were calibrated against the PSY4 failure mode
 * (3 unique pitches / 2 pitch classes / ~92% exact bar repeats over 64 bars)
 * and represent the minimum variation a listener perceives as "not a stuck
 * loop".
 */

export interface MusicalityMetrics {
  /** Unique pitches / total notes. */
  uniquePitchRatio: number
  /** Unique pitch classes / 12. */
  pitchClassDiversity: number
  /** Unique intervals / total intervals. */
  intervalDiversity: number
  /** Unique rhythm patterns / total bars. */
  rhythmicDiversity: number
  /** Repeated motifs / total motifs. */
  motifReuseRatio: number
  /** Transformed motifs / total motifs. */
  transformationRatio: number
  /** Exact bar repeats / total bars. */
  exactRepeatRatio: number
  /** Register range used / possible range. */
  registerDiversity: number
  /** How much the music changes over time (0..1). */
  structuralEvolution: number
}

export interface MusicalityHealthReport {
  metrics: MusicalityMetrics
  healthy: boolean
  /** Human-readable issue descriptions (empty if healthy). */
  issues: string[]
  /** Overall musicality score 0..1. */
  score: number
}

export interface MeasureOptions {
  bars: number
  stepsPerBar: number
}

interface InputNote {
  midi: number
  step: number
  bar: number
}

const HEALTH_BOUNDS = {
  pitchClassDiversityMin: 0.25,
  uniquePitchRatioMin: 0.15,
  exactRepeatRatioMax: 0.5,
  motifReuseRatioMax: 0.7,
  transformationRatioMin: 0.2,
  intervalDiversityMin: 0.2,
  rhythmicDiversityMin: 0.25,
  registerDiversityMin: 0.15,
  structuralEvolutionMin: 0.2,
} as const

/**
 * Compute musicality metrics from a flat list of MIDI events.
 *
 * `notes` should carry absolute bar indices and step positions within the
 * bar (0..stepsPerBar-1). The function never mutates the input.
 */
export function measureMusicality(notes: InputNote[], opts: MeasureOptions): MusicalityMetrics {
  const { bars, stepsPerBar } = opts
  const total = notes.length
  if (total === 0 || bars <= 0) {
    return zeroMetrics()
  }

  // Unique pitches.
  const pitchSet = new Set<number>()
  const pcSet = new Set<number>()
  let minMidi = Number.POSITIVE_INFINITY
  let maxMidi = Number.NEGATIVE_INFINITY
  for (const n of notes) {
    pitchSet.add(n.midi)
    pcSet.add(((n.midi % 12) + 12) % 12)
    if (n.midi < minMidi) minMidi = n.midi
    if (n.midi > maxMidi) maxMidi = n.midi
  }
  const uniquePitchRatio = pitchSet.size / total
  const pitchClassDiversity = pcSet.size / 12
  const registerSpan = Math.max(0, maxMidi - minMidi)
  // Possible range: assume a 4-octave window (48 semitones) is the practical
  // ceiling for a single musical line.
  const registerDiversity = Math.min(1, registerSpan / 48)

  // Intervals: compute across the global time-ordered sequence.
  const sorted = notes
    .slice()
    .sort((a, b) => a.bar * stepsPerBar + a.step - (b.bar * stepsPerBar + b.step))
  const intervals: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1] as InputNote
    const cur = sorted[i] as InputNote
    intervals.push(cur.midi - prev.midi)
  }
  const intervalSet = new Set<number>(intervals)
  const intervalDiversity = intervals.length > 0 ? intervalSet.size / intervals.length : 0

  // Rhythmic diversity: pattern of hit steps per bar.
  const barPatterns = new Set<string>()
  let nonEmptyBars = 0
  for (let bar = 0; bar < bars; bar++) {
    const hits = new Array<boolean>(stepsPerBar).fill(false)
    let count = 0
    for (const n of notes) {
      if (n.bar === bar && n.step >= 0 && n.step < stepsPerBar) {
        hits[n.step] = true
        count++
      }
    }
    if (count > 0) {
      nonEmptyBars++
      barPatterns.add(hits.map((b) => (b ? '1' : '0')).join(''))
    }
  }
  const rhythmicDiversity = nonEmptyBars > 0 ? barPatterns.size / nonEmptyBars : 0

  // Exact bar repeats: count bars whose rhythm+pitch pattern matches another bar.
  const barFullPatterns = new Map<number, string>()
  for (let bar = 0; bar < bars; bar++) {
    const cells = new Array<string>(stepsPerBar).fill('-')
    for (const n of notes) {
      if (n.bar === bar && n.step >= 0 && n.step < stepsPerBar) {
        cells[n.step] = `${n.midi}`
      }
    }
    barFullPatterns.set(bar, cells.join('|'))
  }
  const seenPatterns = new Map<string, number>()
  let exactRepeats = 0
  for (let bar = 0; bar < bars; bar++) {
    const p = barFullPatterns.get(bar) ?? ''
    if (p === '') continue
    const seen = seenPatterns.get(p)
    if (seen !== undefined) {
      exactRepeats++
    } else {
      seenPatterns.set(p, bar)
    }
  }
  const exactRepeatRatio = bars > 0 ? exactRepeats / bars : 0

  // Motif reuse / transformation: approximate by counting repeated (pitch-class
  // sequence) substrings across bars. We use a 4-bar sliding window and count
  // how many windows repeat.
  const barPitchSequences: string[] = []
  for (let bar = 0; bar < bars; bar++) {
    const pcs: number[] = []
    for (const n of notes) {
      if (n.bar === bar) pcs.push(((n.midi % 12) + 12) % 12)
    }
    barPitchSequences.push(pcs.join(','))
  }
  const seqSeen = new Map<string, number>()
  let repeatedWindows = 0
  let totalWindows = 0
  for (let bar = 0; bar < bars; bar++) {
    const seq = barPitchSequences[bar] ?? ''
    if (seq === '') continue
    totalWindows++
    const seen = seqSeen.get(seq)
    if (seen !== undefined) {
      repeatedWindows++
    } else {
      seqSeen.set(seq, bar)
    }
  }
  const motifReuseRatio = totalWindows > 0 ? repeatedWindows / totalWindows : 0

  // Transformation ratio: estimate by checking how many bars' pitch sequences
  // differ from the previous bar's by a recognisable transform (e.g., transposed
  // by a constant, or interval-inverted). This is necessarily a heuristic from
  // raw notes alone.
  let transformedBars = 0
  let comparableBars = 0
  for (let bar = 1; bar < bars; bar++) {
    const prev = barPitchSequences[bar - 1] ?? ''
    const cur = barPitchSequences[bar] ?? ''
    if (prev === '' || cur === '') continue
    comparableBars++
    if (isTransformedVariant(prev, cur)) transformedBars++
  }
  const transformationRatio = comparableBars > 0 ? transformedBars / comparableBars : 0

  // Structural evolution: how much the bar-to-bar pitch-class set changes.
  let evolutionSum = 0
  let evolutionCount = 0
  for (let bar = 1; bar < bars; bar++) {
    const prevSet = new Set<number>()
    const curSet = new Set<number>()
    for (const n of notes) {
      if (n.bar === bar - 1) prevSet.add(((n.midi % 12) + 12) % 12)
      if (n.bar === bar) curSet.add(((n.midi % 12) + 12) % 12)
    }
    if (prevSet.size === 0 && curSet.size === 0) continue
    const union = new Set<number>([...prevSet, ...curSet])
    let diff = 0
    for (const pc of union) {
      if (prevSet.has(pc) !== curSet.has(pc)) diff++
    }
    evolutionSum += union.size > 0 ? diff / union.size : 0
    evolutionCount++
  }
  const structuralEvolution = evolutionCount > 0 ? evolutionSum / evolutionCount : 0

  return {
    uniquePitchRatio,
    pitchClassDiversity,
    intervalDiversity,
    rhythmicDiversity,
    motifReuseRatio,
    transformationRatio,
    exactRepeatRatio,
    registerDiversity,
    structuralEvolution,
  }
}

/**
 * Heuristic: is `cur` a transformed variant of `prev`? Detects:
 *  - exact transposition (all pitch classes shifted by a constant mod 12)
 *  - inversion (intervals negated)
 *  - retrograde (sequence reversed)
 */
function isTransformedVariant(prev: string, cur: string): boolean {
  if (prev === cur) return false // exact repeat is not a transform
  const prevPcs = prev
    .split(',')
    .map(Number)
    .filter((n) => !Number.isNaN(n))
  const curPcs = cur
    .split(',')
    .map(Number)
    .filter((n) => !Number.isNaN(n))
  if (prevPcs.length === 0 || curPcs.length === 0) return false
  if (prevPcs.length !== curPcs.length) return false

  // Transposition: constant offset mod 12.
  const offset = ((curPcs[0] as number) - (prevPcs[0] as number) + 12) % 12
  let isTranspose = true
  for (let i = 1; i < prevPcs.length; i++) {
    const expected = ((((prevPcs[i] as number) + offset) % 12) + 12) % 12
    if (((curPcs[i] as number) + 12) % 12 !== expected) {
      isTranspose = false
      break
    }
  }
  if (isTranspose && offset !== 0) return true

  // Inversion: mirror around first note.
  const pivot = prevPcs[0] as number
  let isInversion = true
  for (let i = 1; i < prevPcs.length; i++) {
    const mirrored = (((pivot - (prevPcs[i] as number) + pivot) % 12) + 12) % 12
    if (((curPcs[i] as number) + 12) % 12 !== mirrored) {
      isInversion = false
      break
    }
  }
  if (isInversion) return true

  // Retrograde: reversed sequence (with possible transposition).
  const reversed = prevPcs.slice().reverse()
  const rOffset = ((curPcs[0] as number) - (reversed[0] as number) + 12) % 12
  let isRetrograde = true
  for (let i = 1; i < reversed.length; i++) {
    const expected = ((((reversed[i] as number) + rOffset) % 12) + 12) % 12
    if (((curPcs[i] as number) + 12) % 12 !== expected) {
      isRetrograde = false
      break
    }
  }
  if (isRetrograde) return true

  return false
}

function zeroMetrics(): MusicalityMetrics {
  return {
    uniquePitchRatio: 0,
    pitchClassDiversity: 0,
    intervalDiversity: 0,
    rhythmicDiversity: 0,
    motifReuseRatio: 0,
    transformationRatio: 0,
    exactRepeatRatio: 0,
    registerDiversity: 0,
    structuralEvolution: 0,
  }
}

/**
 * Build a {@link MusicalityHealthReport} from raw metrics. Issues are listed
 * only when a metric crosses the unhealthy threshold; the overall score is a
 * weighted average of how close each metric is to its healthy bound.
 */
export function healthReport(metrics: MusicalityMetrics): MusicalityHealthReport {
  const issues: string[] = []

  if (metrics.pitchClassDiversity < HEALTH_BOUNDS.pitchClassDiversityMin) {
    issues.push(
      `pitchClassDiversity too low (${metrics.pitchClassDiversity.toFixed(2)} < ${HEALTH_BOUNDS.pitchClassDiversityMin})`
    )
  }
  if (metrics.uniquePitchRatio < HEALTH_BOUNDS.uniquePitchRatioMin) {
    issues.push(
      `uniquePitchRatio too low (${metrics.uniquePitchRatio.toFixed(2)} < ${HEALTH_BOUNDS.uniquePitchRatioMin})`
    )
  }
  if (metrics.exactRepeatRatio > HEALTH_BOUNDS.exactRepeatRatioMax) {
    issues.push(
      `exactRepeatRatio too high (${metrics.exactRepeatRatio.toFixed(2)} > ${HEALTH_BOUNDS.exactRepeatRatioMax})`
    )
  }
  if (metrics.motifReuseRatio > HEALTH_BOUNDS.motifReuseRatioMax) {
    issues.push(
      `motifReuseRatio too high (${metrics.motifReuseRatio.toFixed(2)} > ${HEALTH_BOUNDS.motifReuseRatioMax})`
    )
  }
  if (metrics.transformationRatio < HEALTH_BOUNDS.transformationRatioMin) {
    issues.push(
      `transformationRatio too low (${metrics.transformationRatio.toFixed(2)} < ${HEALTH_BOUNDS.transformationRatioMin})`
    )
  }
  if (metrics.intervalDiversity < HEALTH_BOUNDS.intervalDiversityMin) {
    issues.push(
      `intervalDiversity too low (${metrics.intervalDiversity.toFixed(2)} < ${HEALTH_BOUNDS.intervalDiversityMin})`
    )
  }
  if (metrics.rhythmicDiversity < HEALTH_BOUNDS.rhythmicDiversityMin) {
    issues.push(
      `rhythmicDiversity too low (${metrics.rhythmicDiversity.toFixed(2)} < ${HEALTH_BOUNDS.rhythmicDiversityMin})`
    )
  }
  if (metrics.registerDiversity < HEALTH_BOUNDS.registerDiversityMin) {
    issues.push(
      `registerDiversity too low (${metrics.registerDiversity.toFixed(2)} < ${HEALTH_BOUNDS.registerDiversityMin})`
    )
  }
  if (metrics.structuralEvolution < HEALTH_BOUNDS.structuralEvolutionMin) {
    issues.push(
      `structuralEvolution too low (${metrics.structuralEvolution.toFixed(2)} < ${HEALTH_BOUNDS.structuralEvolutionMin})`
    )
  }

  // Score: average of how close each metric is to its healthy target.
  const scores: number[] = []
  scores.push(ratioBelow(metrics.pitchClassDiversity, HEALTH_BOUNDS.pitchClassDiversityMin))
  scores.push(ratioBelow(metrics.uniquePitchRatio, HEALTH_BOUNDS.uniquePitchRatioMin))
  scores.push(ratioAbove(metrics.exactRepeatRatio, HEALTH_BOUNDS.exactRepeatRatioMax))
  scores.push(ratioAbove(metrics.motifReuseRatio, HEALTH_BOUNDS.motifReuseRatioMax))
  scores.push(ratioBelow(metrics.transformationRatio, HEALTH_BOUNDS.transformationRatioMin))
  scores.push(ratioBelow(metrics.intervalDiversity, HEALTH_BOUNDS.intervalDiversityMin))
  scores.push(ratioBelow(metrics.rhythmicDiversity, HEALTH_BOUNDS.rhythmicDiversityMin))
  scores.push(ratioBelow(metrics.registerDiversity, HEALTH_BOUNDS.registerDiversityMin))
  scores.push(ratioBelow(metrics.structuralEvolution, HEALTH_BOUNDS.structuralEvolutionMin))
  const score = scores.reduce((a, b) => a + b, 0) / scores.length

  return {
    metrics,
    healthy: issues.length === 0,
    issues,
    score,
  }
}

/** How close `value` is to the healthy minimum (1 = at/above target). */
function ratioBelow(value: number, target: number): number {
  if (value >= target) return 1
  if (value <= 0) return 0
  return Math.max(0, Math.min(1, value / target))
}

/** How close `value` is to the healthy maximum (1 = at/below target). */
function ratioAbove(value: number, target: number): number {
  if (value <= target) return 1
  if (value >= 1) return 0
  if (target >= 1) return 0
  return Math.max(0, Math.min(1, (1 - value) / (1 - target)))
}

/** Healthy-bound constants exposed for tests / callers. */
export const MUSICALITY_BOUNDS = HEALTH_BOUNDS
