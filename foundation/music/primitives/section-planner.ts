/**
 * 32-64 bar section planning.
 *
 * Generates density / energy / novelty curves across a section, assigns a
 * {@link SectionRole} to each bar, and embeds 8-bar {@link PhrasePlan}s at
 * phrase boundaries. Different seeds produce different valid structures —
 * the curve template, role boundaries, and per-bar noise all derive from the
 * seed.
 */

import { MotifMemory } from './motif-memory'
import type { MusicalContext } from './musical-context'
import { type PhrasePlan, planPhrase, renderPhraseNotes } from './phrase-planner'
import { Rng } from './rng'

export type SectionRole =
  | 'ESTABLISH'
  | 'REPEAT_VARIATION'
  | 'DEVELOPMENT'
  | 'CONTRAST'
  | 'RETURN'
  | 'ESCALATION'
  | 'PEAK'
  | 'RELEASE'

export interface SectionSlot {
  barIndex: number
  sectionRole: SectionRole
  /** Density curve value 0..1. */
  density: number
  /** Energy curve value 0..1. */
  energy: number
  /** Novelty pressure 0..1. */
  novelty: number
  /** Target register (MIDI octave). */
  registerTarget: number
  /** Phrase plan attached at phrase-start bars (every 8 bars). */
  phrasePlan?: PhrasePlan
}

export interface SectionPlan {
  bars: number
  slots: SectionSlot[]
  seed: number
}

export interface SectionPlanOptions {
  bars: number
  seed: number
  context: MusicalContext
  /** Optional shared memory; a fresh one is created if omitted. */
  memory?: MotifMemory
}

type CurveTemplate = 'arc' | 'build' | 'wave' | 'valley'

const CURVE_TEMPLATES: CurveTemplate[] = ['arc', 'build', 'wave', 'valley']

const PHRASE_BARS = 8

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** Density curve value at normalised position t in [0, 1]. */
function curveDensity(curve: CurveTemplate, t: number): number {
  switch (curve) {
    case 'arc':
      return 0.4 + 0.5 * (1 - Math.abs(2 * t - 1))
    case 'build':
      return 0.35 + 0.55 * t
    case 'wave':
      return 0.5 + 0.3 * Math.sin(t * Math.PI * 4)
    case 'valley':
      return 0.4 + 0.5 * Math.abs(2 * t - 1)
    default:
      return 0.5
  }
}

/** Energy curve value at normalised position t in [0, 1]. */
function curveEnergy(curve: CurveTemplate, t: number): number {
  switch (curve) {
    case 'arc':
      return 0.3 + 0.65 * (1 - Math.abs(2 * t - 1))
    case 'build':
      return 0.25 + 0.7 * t * t
    case 'wave':
      return 0.45 + 0.4 * Math.sin(t * Math.PI * 2 + 0.3)
    case 'valley':
      return 0.35 + 0.6 * (1 - (1 - Math.abs(2 * t - 1)) ** 2)
    default:
      return 0.5
  }
}

/** Novelty pressure curve value at normalised position t in [0, 1]. */
function curveNovelty(curve: CurveTemplate, t: number): number {
  switch (curve) {
    case 'arc':
      return 0.3 + 0.5 * Math.max(1 - Math.abs(2 * t - 1), t > 0.85 ? (t - 0.85) / 0.15 : 0)
    case 'build':
      return 0.4 + 0.4 * t
    case 'wave':
      return 0.4 + 0.45 * Math.abs(Math.sin(t * Math.PI * 3))
    case 'valley':
      return 0.4 + 0.4 * (1 - Math.abs(2 * t - 1))
    default:
      return 0.5
  }
}

/** Pick a SectionRole for normalised position t with optional rng jitter. */
function roleForT(t: number, jitter: number): SectionRole {
  const jt = clamp01(t + jitter)
  if (jt < 0.12) return 'ESTABLISH'
  if (jt < 0.24) return 'REPEAT_VARIATION'
  if (jt < 0.38) return 'DEVELOPMENT'
  if (jt < 0.5) return 'CONTRAST'
  if (jt < 0.62) return 'RETURN'
  if (jt < 0.78) return 'ESCALATION'
  if (jt < 0.92) return 'PEAK'
  return 'RELEASE'
}

/** Plan a section of `bars` bars (typically 32-64). */
export function planSection(opts: SectionPlanOptions): SectionPlan {
  const { bars, seed, context } = opts
  const rng = new Rng(seed)
  const curve = rng.pick(CURVE_TEMPLATES)
  const memory = opts.memory ?? new MotifMemory()

  const slots: SectionSlot[] = []
  for (let bar = 0; bar < bars; bar++) {
    const t = bars > 1 ? bar / (bars - 1) : 0
    const jitter = rng.range(-0.03, 0.03)
    const density = clamp01(curveDensity(curve, t) + jitter)
    const energy = clamp01(curveEnergy(curve, t) + rng.range(-0.04, 0.04))
    const novelty = clamp01(curveNovelty(curve, t) + rng.range(-0.04, 0.04))
    const registerTarget = context.octave + Math.round(energy * 2 - 0.5)
    slots.push({
      barIndex: bar,
      sectionRole: roleForT(t, jitter),
      density,
      energy,
      novelty,
      registerTarget,
    })
  }

  // Attach an 8-bar phrase plan at each phrase-start bar.
  for (let phraseStart = 0; phraseStart + PHRASE_BARS <= bars; phraseStart += PHRASE_BARS) {
    const slot = slots[phraseStart]
    if (!slot) continue
    const phraseContext: MusicalContext = {
      ...context,
      octave: slot.registerTarget,
      density: slot.density,
      energy: slot.energy,
      tension: 0.3 + 0.5 * slot.energy,
      barPosition: phraseStart,
      phrasePosition: 0,
      sectionRole: slot.sectionRole,
      repetitionPressure: clamp01(1 - slot.novelty),
      noveltyPressure: slot.novelty,
    }
    const phrasePlan = planPhrase({
      bars: PHRASE_BARS,
      seed: seed + phraseStart * 101,
      context: phraseContext,
      memory,
    })
    slot.phrasePlan = phrasePlan
    // Mark each motif used in this phrase so the memory ages correctly.
    for (let b = 0; b < phrasePlan.slots.length; b++) {
      const ps = phrasePlan.slots[b]
      if (ps?.motifId) memory.markUsed(ps.motifId, phraseStart + b, true)
    }
  }

  return { bars, slots, seed }
}

/**
 * Render every phrase plan embedded in a section into MIDI events. The
 * `memory` MUST be the same instance passed to {@link planSection} (or one
 * that already contains the referenced motif ids).
 */
export function renderSectionNotes(
  plan: SectionPlan,
  memory: MotifMemory,
  context: MusicalContext,
  stepsPerBar: number
): { midi: number; step: number; bar: number; velocity: number }[] {
  const out: { midi: number; step: number; bar: number; velocity: number }[] = []
  for (const slot of plan.slots) {
    if (!slot.phrasePlan) continue
    const slice = renderPhraseNotes(slot.phrasePlan, memory, context, stepsPerBar)
    for (const n of slice) {
      out.push({ ...n, bar: n.bar + slot.barIndex })
    }
  }
  return out
}
