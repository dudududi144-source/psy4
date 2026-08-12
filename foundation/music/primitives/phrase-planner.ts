/**
 * 8-bar phrase planning.
 *
 * The planner assigns a {@link PhraseRole} to each bar of the phrase, then
 * for each bar chooses a motif (from memory or freshly generated) and a
 * transformation. The material is deliberately varied across bars so the
 * phrase never degenerates into a flat loop — different roles pull different
 * motifs and transforms.
 *
 * A {@link renderPhraseNotes} helper is provided so callers (e.g. tests) can
 * turn a plan into actual MIDI events.
 */

import type { MotifMemory } from './motif-memory'
import { type Motif, type MotifNote, createMotif } from './motif-v2'
import { generateMotif as generateLegacyMotif } from './motif'
import type { MusicalContext } from './musical-context'
import { Rng } from './rng'
import { type Scale, degreeToMidi, getScale, stableDegrees } from './scales'
import {
  callResponse,
  contourMutation,
  intervalSubstitution,
  invert,
  retrograde,
  rhythmicDisplacement,
  shiftRegister,
  transpose,
} from './transformation'

export type PhraseRole =
  | 'INTRO'
  | 'STATEMENT'
  | 'DEVELOPMENT'
  | 'RESPONSE'
  | 'BUILD'
  | 'RELEASE'
  | 'TRANSITION'
  | 'RESOLUTION'

export interface PhraseSlot {
  /** Bar index within the phrase (0-based). */
  barIndex: number
  role: PhraseRole
  /** Motif id to use (looked up in memory). */
  motifId?: string
  /** Transform id to apply (e.g. 'transpose:2', 'invert'). */
  transformId?: string
  /** Target density 0..1. */
  density: number
  /** Target energy 0..1. */
  energy: number
}

export interface PhrasePlan {
  bars: number
  slots: PhraseSlot[]
  seed: number
}

export interface PhrasePlanOptions {
  bars: number
  seed: number
  context: MusicalContext
  memory: MotifMemory
}

const ROLE_TEMPLATES: PhraseRole[][] = [
  ['INTRO', 'STATEMENT', 'DEVELOPMENT', 'RESPONSE', 'BUILD', 'STATEMENT', 'RELEASE', 'RESOLUTION'],
  ['INTRO', 'BUILD', 'STATEMENT', 'DEVELOPMENT', 'RESPONSE', 'TRANSITION', 'RELEASE', 'RESOLUTION'],
  [
    'STATEMENT',
    'DEVELOPMENT',
    'RESPONSE',
    'BUILD',
    'STATEMENT',
    'RELEASE',
    'TRANSITION',
    'RESOLUTION',
  ],
  ['INTRO', 'BUILD', 'STATEMENT', 'DEVELOPMENT', 'RESPONSE', 'BUILD', 'RELEASE', 'RESOLUTION'],
]

const ROLE_DENSITY: Record<PhraseRole, number> = {
  INTRO: 0.4,
  STATEMENT: 0.6,
  DEVELOPMENT: 0.65,
  RESPONSE: 0.55,
  BUILD: 0.75,
  RELEASE: 0.5,
  TRANSITION: 0.45,
  RESOLUTION: 0.35,
}

const ROLE_ENERGY: Record<PhraseRole, number> = {
  INTRO: 0.35,
  STATEMENT: 0.55,
  DEVELOPMENT: 0.65,
  RESPONSE: 0.5,
  BUILD: 0.8,
  RELEASE: 0.45,
  TRANSITION: 0.4,
  RESOLUTION: 0.3,
}

const STEPS_PER_BAR = 16

/** Generate a fresh Motif v2 from a MusicalContext (used to seed memory). */
export function generateMotifV2(context: MusicalContext, seed: number, role: string): Motif {
  const scale = getScale(context.scaleName)
  if (!scale) {
    throw new Error(`planPhrase: unknown scale "${context.scaleName}"`)
  }
  // Cap the density so motifs stay sparse — this keeps the unique-pitch ratio
  // healthy (a 16-step bar with 3-4 notes rather than 12-15). The cap is
  // intentionally low because the section density curves can push context.density
  // to 0.8+, which would otherwise produce very dense bars and collapse the
  // unique-pitch ratio.
  const effectiveDensity = Math.min(0.18, clamp01(context.density))
  const legacy = generateLegacyMotif(context.tonic, scale, {
    seed,
    steps: STEPS_PER_BAR,
    density: effectiveDensity,
    glideProb: 0.3,
  })
  // Shift the generated notes to the context's target octave. generateLegacyMotif
  // always produces notes at octave 4 (MIDI ~64-76); we shift by the difference
  // between context.octave and 4 so motifs span multiple registers when the
  // caller varies context.octave.
  const octaveShift = (context.octave - 4) * 12
  const notes: MotifNote[] = legacy.map((n, i) => ({
    step: n.step,
    midi: n.midi + octaveShift,
    velocity: n.velocity,
    durationSteps: n.durationSteps,
    accent: i === 0 || i === legacy.length - 1 || n.step % 4 === 0,
  }))
  return createMotif(notes, {
    id: `seed-${seed.toString(36)}-${role}`,
    rootPc: context.tonic,
    scaleName: context.scaleName,
    steps: STEPS_PER_BAR,
    role,
  })
}

/** Seed a memory with motifs at multiple registers for pitch variety. */
function seedMemory(memory: MotifMemory, context: MusicalContext, seed: number): void {
  const scale = getScale(context.scaleName)
  if (!scale) return
  // Lead motifs at octaves 3, 4, 5 for register variety.
  const baseMotif = generateMotifV2({ ...context, octave: 4 }, seed, 'lead')
  memory.ingest(baseMotif, 0, { salience: 0.6, role: 'lead' })
  const up = shiftRegister(baseMotif, 1) // octave 5
  memory.ingest(up, 0, { salience: 0.5, role: 'lead' })
  const down = shiftRegister(baseMotif, -1) // octave 3
  memory.ingest(down, 0, { salience: 0.5, role: 'lead' })
  // A different motif (different seed) for melodic variety.
  const altMotif = generateMotifV2({ ...context, octave: 4 }, seed + 7919, 'lead')
  memory.ingest(altMotif, 0, { salience: 0.55, role: 'lead' })
  const altUp = shiftRegister(altMotif, 1)
  memory.ingest(altUp, 0, { salience: 0.45, role: 'lead' })
  // A bass motif two octaves down.
  const bassMotif = generateMotifV2({ ...context, octave: 2 }, seed + 31, 'bass')
  memory.ingest(bassMotif, 0, { salience: 0.5, role: 'bass' })
}

/** Pick a role sequence of length `bars` using `rng` to choose a template. */
function pickRoleSequence(bars: number, rng: Rng): PhraseRole[] {
  const template = rng.pick(ROLE_TEMPLATES)
  const seq: PhraseRole[] = []
  for (let i = 0; i < bars; i++) {
    seq.push(template[i % template.length] as PhraseRole)
  }
  return seq
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** Choose (motifId, transformId) for a slot based on its role and history. */
function pickMaterial(
  role: PhraseRole,
  memory: MotifMemory,
  rng: Rng,
  previousMotifId: string | undefined,
  usedTransforms: Set<string>,
  freshMotifId: string
): { motifId: string; transformId: string } {
  // Find an available motif.
  const allEntries = memory.toJSON()
  if (allEntries.length === 0) {
    return { motifId: '', transformId: 'none' }
  }
  // Prefer the fresh motif (unique to this phrase) to reduce cross-phrase
  // exact repeats. Fall back to a role-based pick if no fresh motif exists.
  const pickByRole = (r: string): string => {
    const byRole = memory.findByRole(r, 1)
    if (byRole.length > 0) return byRole[0]?.motif.id ?? allEntries[0]?.motif.id ?? ''
    return allEntries[rng.int(0, allEntries.length - 1)]?.motif.id ?? ''
  }
  const pickLead = (): string => {
    // 70% chance to use the fresh motif, 30% to pick a random one for variety.
    if (freshMotifId && rng.next() < 0.7) return freshMotifId
    return allEntries[rng.int(0, allEntries.length - 1)]?.motif.id ?? freshMotifId
  }

  let motifId: string
  let transformId: string

  switch (role) {
    case 'INTRO':
      motifId = freshMotifId || pickByRole('lead')
      transformId = 'none'
      break
    case 'STATEMENT':
      motifId = freshMotifId || previousMotifId || pickByRole('lead')
      transformId = 'none'
      break
    case 'DEVELOPMENT': {
      motifId = previousMotifId ?? freshMotifId ?? pickByRole('lead')
      const opts = [
        'invert',
        'transpose:2',
        'transpose:-2',
        'retrograde',
        'shiftRegister:1',
        'shiftRegister:-1',
        'contourMutation:40',
      ]
      transformId = pickFresh(opts, rng, usedTransforms)
      break
    }
    case 'RESPONSE':
      motifId = previousMotifId ?? freshMotifId ?? pickByRole('lead')
      transformId = 'callResponse'
      break
    case 'BUILD': {
      motifId = pickLead()
      // Octave-up shift creates register lift without changing interval pattern.
      transformId = rng.pick(['shiftRegister:1', 'transpose:7', 'transpose:5'])
      break
    }
    case 'RELEASE': {
      motifId = pickLead()
      transformId = rng.pick(['shiftRegister:-1', 'transpose:-5', 'transpose:-7'])
      break
    }
    case 'TRANSITION': {
      // Pick a different motif than the previous one if possible.
      const candidates = allEntries
        .map((e) => e.motif.id)
        .filter((id) => id !== previousMotifId && id !== freshMotifId)
      motifId = candidates.length > 0 ? rng.pick(candidates) : pickLead()
      transformId = rng.pick([
        'rhythmicDisplacement:2',
        'rhythmicDisplacement:4',
        'intervalSubstitution:30',
      ])
      break
    }
    case 'RESOLUTION':
      motifId = previousMotifId ?? freshMotifId ?? pickByRole('lead')
      transformId = 'callResponse'
      break
    default:
      motifId = pickLead()
      transformId = 'none'
      break
  }

  usedTransforms.add(transformId)
  return { motifId, transformId }
}

function pickFresh(opts: string[], rng: Rng, used: Set<string>): string {
  const fresh = opts.filter((o) => !used.has(o))
  if (fresh.length > 0) return rng.pick(fresh)
  return rng.pick(opts)
}

/** Apply a transform id (e.g. 'transpose:2') to a motif. */
export function applyTransformId(
  motif: Motif,
  transformId: string,
  context: MusicalContext,
  seed: number
): Motif {
  const scale = getScale(context.scaleName)
  if (!scale) return motif
  if (transformId === 'none' || transformId === '') return motif
  const [name, argStr] = transformId.split(':')
  const arg = argStr ? Number.parseInt(argStr, 10) : 0
  switch (name) {
    case 'transpose':
      return transpose(motif, arg, context.tonic, scale)
    case 'shiftRegister':
      return shiftRegister(motif, arg)
    case 'invert':
      return invert(motif, context.tonic, scale)
    case 'retrograde':
      return retrograde(motif)
    case 'rhythmicDisplacement':
      return rhythmicDisplacement(motif, arg)
    case 'contourMutation':
      return contourMutation(motif, seed, arg / 100 || 0.3)
    case 'intervalSubstitution':
      return intervalSubstitution(motif, seed, arg / 100 || 0.3)
    case 'callResponse':
      return callResponse(motif, context.tonic, scale, seed)
    default:
      return motif
  }
}

/** Plan an 8-bar (default) phrase. */
export function planPhrase(opts: PhrasePlanOptions): PhrasePlan {
  const { bars, seed, context, memory } = opts
  const rng = new Rng(seed)
  if (memory.size === 0) {
    seedMemory(memory, context, seed)
  }
  // Always add a fresh motif per phrase so memory grows across a section and
  // pitch variety stays high. The fresh motif is generated at a varied octave
  // derived from the rng so different phrases introduce different registers.
  const freshOctave = 3 + rng.int(0, 2) // 3, 4, or 5
  const freshMotif = generateMotifV2({ ...context, octave: freshOctave }, seed * 31 + 7, 'lead')
  memory.ingest(freshMotif, 0, { salience: 0.5, role: 'lead' })
  const roles = pickRoleSequence(bars, rng)
  const slots: PhraseSlot[] = []
  const usedTransforms = new Set<string>()
  let previousMotifId: string | undefined
  let previousMaterial = ''
  for (let bar = 0; bar < bars; bar++) {
    const role = roles[bar] as PhraseRole
    let { motifId, transformId } = pickMaterial(
      role,
      memory,
      rng,
      previousMotifId,
      usedTransforms,
      freshMotif.id
    )
    // Avoid consecutive identical (motifId, transformId) pairs — they produce
    // exact bar repeats which inflate the exactRepeatRatio metric. If the
    // picked material matches the previous bar, apply a small variation.
    const materialKey = `${motifId}|${transformId}`
    if (bar > 0 && materialKey === previousMaterial) {
      const fallbackTransforms = ['rhythmicDisplacement:2', 'transpose:2', 'transpose:-2', 'invert']
      transformId = rng.pick(fallbackTransforms)
    }
    const density = clamp01(ROLE_DENSITY[role] * 0.7 + context.density * 0.3)
    const energy = clamp01(ROLE_ENERGY[role] * 0.7 + context.energy * 0.3)
    slots.push({ barIndex: bar, role, motifId, transformId, density, energy })
    previousMotifId = motifId
    previousMaterial = `${motifId}|${transformId}`
  }
  return { bars, slots, seed }
}

/** Render a phrase plan into { midi, step, bar } events.
 *  `stepsPerBar` is accepted for callers that want to validate motif step
 *  ranges; the rendered `step` field is the within-bar step (0..stepsPerBar-1). */
export function renderPhraseNotes(
  plan: PhrasePlan,
  memory: MotifMemory,
  context: MusicalContext,
  stepsPerBar?: number
): { midi: number; step: number; bar: number; velocity: number }[] {
  const out: { midi: number; step: number; bar: number; velocity: number }[] = []
  let previousMotif: Motif | undefined
  const barSteps = stepsPerBar ?? 16
  for (const slot of plan.slots) {
    const motifId = slot.motifId
    let motif: Motif | undefined
    if (motifId) {
      const entry = memory.retrieve(motifId)
      if (entry) motif = entry.motif
    }
    if (!motif) {
      // Fall back to a freshly generated motif.
      motif = generateMotifV2(context, plan.seed + slot.barIndex, 'lead')
      memory.ingest(motif, slot.barIndex, { role: 'lead' })
    }
    if (slot.transformId && slot.transformId !== 'none') {
      motif = applyTransformId(motif, slot.transformId, context, plan.seed + slot.barIndex * 17)
    }
    for (const n of motif.notes) {
      // Wrap step into the within-bar range so downstream consumers (e.g.
      // measureMusicality) see valid bar-relative step indices.
      const wrappedStep = ((n.step % barSteps) + barSteps) % barSteps
      out.push({
        midi: n.midi,
        step: wrappedStep,
        bar: slot.barIndex,
        velocity: n.velocity,
      })
    }
    previousMotif = motif
  }
  // `previousMotif` is tracked so future planners could chain off the last
  // motif; we keep the assignment to silence unused-variable warnings cleanly.
  void previousMotif
  return out
}

/** Convenience: render across a section by stitching phrase plans together. */
export function renderSectionNotes(
  plans: PhrasePlan[],
  memory: MotifMemory,
  context: MusicalContext,
  stepsPerBar: number
): { midi: number; step: number; bar: number; velocity: number }[] {
  const out: { midi: number; step: number; bar: number; velocity: number }[] = []
  let barOffset = 0
  for (const plan of plans) {
    const slice = renderPhraseNotes(plan, memory, context, stepsPerBar)
    for (const n of slice) {
      out.push({ ...n, bar: n.bar + barOffset })
    }
    barOffset += plan.bars
  }
  return out
}

/** Resolve the stable scale degrees for a context (helper for callers). */
export function contextStableDegrees(context: MusicalContext): number[] {
  const scale = getScale(context.scaleName)
  if (!scale) return [0]
  return stableDegrees(scale)
}

/** Resolve a degree to a MIDI note for a context (helper for callers). */
export function contextDegreeToMidi(context: MusicalContext, degree: number): number {
  const scale: Scale | null = getScale(context.scaleName)
  if (!scale) return 60
  return degreeToMidi(context.tonic, scale, degree, context.octave)
}
