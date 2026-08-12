/**
 * Explainable candidate scoring.
 *
 * The CandidateScorer rates each candidate motif against the current
 * {@link MusicalContext} and {@link PhraseSlot} along six orthogonal axes
 * (harmonic, rhythmic, continuity, novelty, repetition penalty, learned
 * preference). The final score is a weighted average; the explanation string
 * lists the strongest contributors so callers can surface a human-readable
 * reason for the choice.
 */

import type { MotifMemory } from './motif-memory'
import { type Motif, motifSimilarity } from './motif-v2'
import type { MusicalContext } from './musical-context'
import type { PhraseSlot } from './phrase-planner'
import { type Scale, getScale, isInScale, scalePcs } from './scales'

export interface CandidateScoreBreakdown {
  /** 0..1 — scale compatibility. */
  harmonic: number
  /** 0..1 — rhythm fits the phrase slot. */
  rhythmic: number
  /** 0..1 — connects to previous motif. */
  continuity: number
  /** 0..1 — how new vs memory. */
  novelty: number
  /** 0..1 — penalty for over-repetition. */
  repetitionPenalty: number
  /** 0..1 — learned weight from learning system. */
  learnedPreference: number
}

export interface CandidateScore {
  candidate: Motif
  scores: CandidateScoreBreakdown
  /** 0..1 weighted average. */
  final: number
  /** Human-readable explanation. */
  explanation: string
}

export interface CandidateScorerOptions {
  memory: MotifMemory
  /** Optional learned weights keyed by motif id (0..1). */
  learnedWeights?: Map<string, number>
  /** Optional axis weights (default: balanced). */
  weights?: Partial<CandidateScoreBreakdown>
}

const DEFAULT_WEIGHTS: CandidateScoreBreakdown = {
  harmonic: 0.25,
  rhythmic: 0.15,
  continuity: 0.15,
  novelty: 0.2,
  repetitionPenalty: 0.15,
  learnedPreference: 0.1,
}

export class CandidateScorer {
  private memory: MotifMemory
  private learnedWeights: Map<string, number>
  private weights: CandidateScoreBreakdown

  constructor(opts: CandidateScorerOptions) {
    this.memory = opts.memory
    this.learnedWeights = opts.learnedWeights ?? new Map()
    this.weights = { ...DEFAULT_WEIGHTS, ...opts.weights }
  }

  /**
   * Score a single candidate against the context, slot and (optional)
   * previous motif. All subscores are clamped to [0, 1].
   */
  score(
    candidate: Motif,
    context: MusicalContext,
    slot: PhraseSlot,
    previousMotif?: Motif
  ): CandidateScore {
    const scale = getScale(context.scaleName)
    const harmonic = this.scoreHarmonic(candidate, context, scale)
    const rhythmic = this.scoreRhythmic(candidate, slot)
    const continuity = this.scoreContinuity(candidate, previousMotif)
    const novelty = this.scoreNovelty(candidate)
    const repetitionPenalty = this.scoreRepetitionPenalty(candidate)
    const learnedPreference = this.scoreLearned(candidate)
    const scores: CandidateScoreBreakdown = {
      harmonic,
      rhythmic,
      continuity,
      novelty,
      repetitionPenalty,
      learnedPreference,
    }
    const finalScore =
      harmonic * this.weights.harmonic +
      rhythmic * this.weights.rhythmic +
      continuity * this.weights.continuity +
      novelty * this.weights.novelty +
      repetitionPenalty * this.weights.repetitionPenalty +
      learnedPreference * this.weights.learnedPreference

    const explanation = this.buildExplanation(scores, finalScore)
    return { candidate, scores, final: finalScore, explanation }
  }

  /** Score every candidate (preserves input order). */
  scoreAll(
    candidates: Motif[],
    context: MusicalContext,
    slot: PhraseSlot,
    previousMotif?: Motif
  ): CandidateScore[] {
    return candidates.map((c) => this.score(c, context, slot, previousMotif))
  }

  /** Return the highest-scoring candidate. */
  pickBest(
    candidates: Motif[],
    context: MusicalContext,
    slot: PhraseSlot,
    previousMotif?: Motif
  ): CandidateScore {
    const scored = this.scoreAll(candidates, context, slot, previousMotif)
    if (scored.length === 0) {
      throw new Error('CandidateScorer.pickBest: no candidates')
    }
    let best = scored[0] as CandidateScore
    for (let i = 1; i < scored.length; i++) {
      const cur = scored[i] as CandidateScore
      if (cur.final > best.final) best = cur
    }
    return best
  }

  /** Harmonic: fraction of candidate notes that belong to the context scale. */
  private scoreHarmonic(candidate: Motif, context: MusicalContext, scale: Scale | null): number {
    if (!scale) return 0.5
    if (candidate.notes.length === 0) return 0
    let inScale = 0
    for (const n of candidate.notes) {
      if (isInScale(context.tonic, scale, n.midi)) inScale++
    }
    const base = inScale / candidate.notes.length
    // Bonus if candidate rootPc matches context tonic.
    const rootBonus = candidate.rootPc === context.tonic ? 0.1 : 0
    // Bonus for chord-tone overlap when a chord is active.
    let chordBonus = 0
    if (context.harmonicContext.length > 0) {
      const chordPcs = new Set(context.harmonicContext)
      const candidatePcs = new Set(candidate.pitchClasses)
      let overlap = 0
      for (const pc of chordPcs) {
        if (candidatePcs.has(pc)) overlap++
      }
      chordBonus = 0.15 * (overlap / Math.max(1, chordPcs.size))
    }
    return clamp01(base + rootBonus + chordBonus)
  }

  /** Rhythmic: how well candidate density matches the slot's target density. */
  private scoreRhythmic(candidate: Motif, slot: PhraseSlot): number {
    const target = slot.density
    const actual = candidate.rhythmicDensity
    const diff = Math.abs(target - actual)
    return clamp01(1 - diff)
  }

  /** Continuity: similarity to the previous motif (0 if none). */
  private scoreContinuity(candidate: Motif, previousMotif?: Motif): number {
    if (!previousMotif) return 0.5
    return motifSimilarity(previousMotif, candidate)
  }

  /** Novelty: 1 - max similarity to any known motif in memory. */
  private scoreNovelty(candidate: Motif): number {
    if (this.memory.size === 0) return 1
    const similar = this.memory.findSimilar(candidate, 1)
    if (similar.length === 0) return 1
    const sim = motifSimilarity(similar[0]?.motif ?? candidate, candidate)
    return clamp01(1 - sim)
  }

  /** Repetition penalty: lower if the candidate has been over-used recently. */
  private scoreRepetitionPenalty(candidate: Motif): number {
    const entry = this.memory.retrieve(candidate.id)
    if (!entry) return 1
    // Penalise motifs used more than 4 times recently.
    const overuse = Math.max(0, entry.usageCount - 4)
    const penalty = Math.min(1, overuse / 6)
    return clamp01(1 - penalty * 0.7)
  }

  /** Learned preference: weight from external learning system (default 0.5). */
  private scoreLearned(candidate: Motif): number {
    const w = this.learnedWeights.get(candidate.id)
    if (w === undefined) return 0.5
    return clamp01(w)
  }

  /** Build a concise human-readable explanation. */
  private buildExplanation(scores: CandidateScoreBreakdown, final: number): string {
    const entries: { name: string; value: number }[] = [
      { name: 'harmonic', value: scores.harmonic },
      { name: 'rhythmic', value: scores.rhythmic },
      { name: 'continuity', value: scores.continuity },
      { name: 'novelty', value: scores.novelty },
      { name: 'repetitionPenalty', value: scores.repetitionPenalty },
      { name: 'learnedPreference', value: scores.learnedPreference },
    ]
    entries.sort((a, b) => b.value - a.value)
    const top = entries.slice(0, 2)
    const bottom = entries.slice(-1)
    const topStr = top.map((e) => `${e.name}=${e.value.toFixed(2)}`).join(', ')
    const bottomStr = bottom.map((e) => `${e.name}=${e.value.toFixed(2)}`).join(', ')
    return `final=${final.toFixed(3)} (strong: ${topStr}; weak: ${bottomStr})`
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** Convenience: extract the pitch-class set the scorer would consider in-scale. */
export function contextScalePcs(context: MusicalContext): number[] {
  const scale = getScale(context.scaleName)
  if (!scale) return []
  return scalePcs(context.tonic, scale)
}
