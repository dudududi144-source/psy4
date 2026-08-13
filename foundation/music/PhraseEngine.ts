/**
 * PhraseEngine — F22 P0-C: Phrase-level lead composition.
 *
 * Instead of making 16 independent per-step decisions, this engine:
 * 1. Constructs a PhrasePlan (shape, contour, rhythm, harmonic targets)
 * 2. Generates a motif from the plan
 * 3. Transforms it using the development operator
 * 4. Realizes it as ScheduledNotes, conditioned on kick/bass/groove
 *
 * The 16 steps are the REALIZATION GRID, not the composition algorithm.
 */

import { type Scale, degreeToMidi } from './primitives/scales';
import { Rng } from './primitives/rng';
import { type HarmonicState, getChordAtStep, nearestChordTone, type ChordVoicing } from './HarmonicState';
import { type GrooveState } from './GrooveState';
import { type TensionState } from './TensionState';
import { type PhraseNote, type PhraseRecord, type DevelopmentOperator, transformPhrase } from './PhraseDevelopmentState';

export type PhraseShape = 'RISE' | 'FALL' | 'ARC' | 'WAVE' | 'FLAT';

export interface PhrasePlan {
  shape: PhraseShape;
  /** Target contour direction per segment (-1=down, 0=flat, +1=up) */
  contourSegments: number[];
  /** Steps that should have notes (rhythmic skeleton) */
  rhythmSkeleton: boolean[];
  /** Steps that are anchors (strong beat targets) */
  anchorSteps: number[];
  /** Steps that are passing/tension */
  passingSteps: number[];
  /** Cadence step (where phrase resolves) */
  cadenceStep: number;
  /** Start register (MIDI) */
  startRegister: number;
  /** Target register at climax (MIDI) */
  climaxRegister: number;
  /** Target register at end (MIDI) */
  endRegister: number;
  /** Climax position (step 0-15) */
  climaxPosition: number;
  /** Number of notes target */
  noteCount: number;
  /** Interval range (max semitones) */
  maxInterval: number;
}

export interface PhraseContext {
  rootPc: number;
  scale: Scale;
  barInPhrase: number;
  density: number;
  harmonic: HarmonicState | null;
  groove: GrooveState;
  tension: TensionState;
  prevPhrase: PhraseRecord | null;
  operator: DevelopmentOperator;
  leadLastMidi: number;
  kickSteps: Set<number>;
  bassSteps: Set<number>;
  bassMidiByStep: Map<number, number>;
  learnedIntervalHist: number[] | null;
  learnedRestDensity: number;
  learnedRegisterPref: number;
}

/**
 * Build a phrase plan from the musical context.
 * This is the COMPOSITION step — it decides what shape the phrase will have
 * before any notes are generated.
 */
export function buildPhrasePlan(ctx: PhraseContext): PhrasePlan {
  const { barInPhrase, density, tension, groove, prevPhrase, operator } = ctx;

  // 1. PHRASE SHAPE — determined by bar position and tension
  const shape: PhraseShape =
    barInPhrase === 0 ? 'ARC'
    : barInPhrase === 7 ? 'FALL'
    : tension.trajectory === 'rising' ? 'RISE'
    : tension.resolving ? 'FALL'
    : tension.melodic > 0.5 ? 'WAVE'
    : tension.melodic < 0.15 ? 'FLAT'
    : 'ARC';

  // 2. CONTOUR SEGMENTS — divide 16 steps into 4 segments of 4
  const contourSegments: number[] = [];
  switch (shape) {
    case 'RISE':  contourSegments.push(1, 1, 1, 1); break;
    case 'FALL':  contourSegments.push(-1, -1, -1, -1); break;
    case 'ARC':   contourSegments.push(1, 1, -1, -1); break;
    case 'WAVE':  contourSegments.push(1, -1, 1, -1); break;
    case 'FLAT':  contourSegments.push(0, 0, 0, 0); break;
  }

  // 3. RHYTHM SKELETON — which steps should have notes
  const rhythmSkeleton = new Array(16).fill(false);
  const noteCount = Math.round(density * 16 * (0.7 + tension.rhythmic * 0.3));

  // Strong beats always in skeleton
  for (const s of [0, 4, 8, 12]) rhythmSkeleton[s] = true;

  // Add offbeats based on density and groove space
  const rng = new Rng(42 + barInPhrase);
  const offbeatCandidates = [2, 6, 10, 14, 1, 3, 5, 7, 9, 11, 13, 15];
  let notesAdded = 4; // 4 strong beats
  for (const s of offbeatCandidates) {
    if (notesAdded >= noteCount) break;
    // Higher probability where groove has space and bass is absent
    const spaceProb = groove.spaceMap[s] ?? 0.5;
    const bassFree = !ctx.bassSteps.has(s);
    const prob = spaceProb * (bassFree ? 1.3 : 0.5) * density;
    if (rng.next() < prob) {
      rhythmSkeleton[s] = true;
      notesAdded++;
    }
  }

  // 4. ANCHOR STEPS (strong beats — target chord tones)
  const anchorSteps = [0, 4, 8, 12];

  // 5. PASSING STEPS (weak beats — can use non-chord tones)
  const passingSteps: number[] = [];
  for (let s = 0; s < 16; s++) {
    if (rhythmSkeleton[s] && !anchorSteps.includes(s)) passingSteps.push(s);
  }

  // 6. CADENCE STEP — phrase resolves here
  const cadenceStep = barInPhrase === 7 ? 15 : (barInPhrase === 6 ? 14 : -1);

  // 7. REGISTER TARGETS — driven by tension and shape
  const baseRegister = ctx.leadLastMidi > 0 ? ctx.leadLastMidi : degreeToMidi(ctx.rootPc, ctx.scale, 0, 3);
  const tensionRegBoost = Math.round(tension.register * 12); // up to +12 semitones
  const startRegister = Math.max(48, Math.min(72, baseRegister));
  const climaxRegister = Math.max(48, Math.min(72, startRegister + tensionRegBoost));
  const endRegister = tension.resolving
    ? Math.max(48, Math.min(72, startRegister - 4))  // descend on resolution
    : startRegister;

  // 8. CLIMAX POSITION
  const climaxPosition = shape === 'RISE' ? 12 : shape === 'ARC' ? 8 : shape === 'FALL' ? 4 : 8;

  // 9. INTERVAL RANGE — driven by melodic tension
  const maxInterval = Math.round(2 + tension.melodic * 7); // 2-9 semitones

  return {
    shape, contourSegments, rhythmSkeleton, anchorSteps, passingSteps,
    cadenceStep, startRegister, climaxRegister, endRegister,
    climaxPosition, noteCount: notesAdded, maxInterval,
  };
}

/**
 * Generate a motif from the phrase plan.
 * The motif is a sequence of (step, midi, velocity) that follows the plan's
 * contour, rhythm, and register targets.
 */
export function generateMotifFromPlan(
  plan: PhrasePlan,
  ctx: PhraseContext,
  rng: Rng,
): PhraseNote[] {
  const { rootPc, scale, harmonic, bassMidiByStep, learnedIntervalHist } = ctx;
  const notes: PhraseNote[] = [];

  let currentMidi = plan.startRegister;
  let noteIdx = 0;
  const totalNotes = plan.rhythmSkeleton.filter(Boolean).length;

  for (let step = 0; step < 16; step++) {
    if (!plan.rhythmSkeleton[step]) continue;

    const isAnchor = plan.anchorSteps.includes(step);
    const isCadence = step === plan.cadenceStep;
    const segmentIdx = Math.floor(step / 4);
    const contourDir = plan.contourSegments[segmentIdx] ?? 0;

    // PROGRESS through the phrase — 0 at start, 1 at end
    const progress = noteIdx / Math.max(1, totalNotes - 1);

    // TARGET REGISTER based on shape and progress
    let targetRegister: number;
    if (progress < 0.5) {
      // First half: moving toward climax
      const climbProgress = progress * 2; // 0-1
      targetRegister = plan.startRegister + (plan.climaxRegister - plan.startRegister) * climbProgress;
    } else {
      // Second half: moving from climax toward end
      const descendProgress = (progress - 0.5) * 2; // 0-1
      targetRegister = plan.climaxRegister + (plan.endRegister - plan.climaxRegister) * descendProgress;
    }

    // CHOOSE INTERVAL
    let interval: number;
    if (isCadence) {
      // Cadence: resolve toward root
      const rootMidi = degreeToMidi(rootPc, scale, 0, 3);
      interval = rootMidi - currentMidi;
    } else if (isAnchor && harmonic) {
      // Anchor: target chord tone
      const chordTone = nearestChordTone(harmonic, Math.round(targetRegister), step, ctx.barInPhrase);
      interval = chordTone - currentMidi;
      // Clamp to maxInterval
      if (Math.abs(interval) > plan.maxInterval) {
        interval = Math.sign(interval) * plan.maxInterval;
      }
    } else {
      // Passing tone: sample interval from learned histogram or contour
      // F22: When learned histogram is available, use it 80% of the time
      // (this makes learning actually change the output vocabulary)
      if (learnedIntervalHist && rng.next() < 0.8) {
        // Sample from learned histogram
        let r = rng.next();
        let idx = 12;
        for (let i = 0; i < learnedIntervalHist.length; i++) {
          r -= learnedIntervalHist[i];
          if (r <= 0) { idx = i; break; }
        }
        interval = idx - 12;
        // Apply contour direction
        if (contourDir > 0 && interval < 0) interval = Math.abs(interval);
        if (contourDir < 0 && interval > 0) interval = -interval;
      } else {
        // Generate from contour + tension
        const baseInterval = contourDir * Math.round(1 + rng.next() * plan.maxInterval * 0.5);
        const noise = Math.round((rng.next() - 0.5) * plan.maxInterval * 0.3);
        interval = baseInterval + noise;
      }
    }

    // APPLY INTERVAL
    let newMidi = currentMidi + interval;

    // NUDGE TOWARD TARGET REGISTER (keeps phrase shape coherent)
    const regDiff = targetRegister - newMidi;
    if (Math.abs(regDiff) > 3) {
      newMidi += Math.sign(regDiff) * Math.min(2, Math.abs(regDiff) - 3);
    }

    // CLAMP to lead register
    newMidi = Math.max(48, Math.min(72, newMidi));

    // REGISTER SEPARATION — avoid bass register
    if (bassMidiByStep.has(step)) {
      const bassMidi = bassMidiByStep.get(step)!;
      if (Math.abs(newMidi - bassMidi) < 7) {
        newMidi = Math.min(72, bassMidi + 12);
      }
    }

    // ANTI-REPEAT — if last 3 notes were identical, force change
    if (notes.length >= 3) {
      const last3 = notes.slice(-3);
      if (last3.every(n => n.midi === newMidi)) {
        newMidi = Math.max(48, Math.min(72, newMidi + (rng.next() > 0.5 ? 2 : -2)));
      }
    }

    currentMidi = newMidi;

    // VELOCITY — anchors louder, passing softer, cadence accented
    let vel = isAnchor ? 0.75 : 0.5;
    if (isCadence) vel = 0.7;
    // Climax accent
    if (Math.abs(step - plan.climaxPosition) <= 1) vel = Math.min(0.95, vel + 0.1);

    notes.push({ step, midi: currentMidi, velocity: vel });
    noteIdx++;
  }

  return notes;
}

/**
 * Full phrase generation pipeline:
 * Plan → Motif → Transform (if previous phrase) → Realize
 */
export function generatePhrase(
  ctx: PhraseContext,
  rng: Rng,
): PhraseNote[] {
  // 1. Build plan
  const plan = buildPhrasePlan(ctx);

  // 2. Generate motif from plan
  let motif = generateMotifFromPlan(plan, ctx, rng);

  // 3. If we have a previous phrase, transform the motif using the operator
  if (ctx.prevPhrase && ctx.prevPhrase.notes.length > 0) {
    const scaleIntervals = ctx.scale.intervals;
    const transformed = transformPhrase(ctx.prevPhrase, ctx.operator, ctx.rootPc, scaleIntervals);

    // Blend: use transformed notes where they exist, fill with plan-generated notes
    if (transformed.length > 0) {
      const blended: PhraseNote[] = [];
      const transformedByStep = new Map<number, PhraseNote>();
      for (const t of transformed) transformedByStep.set(t.step, t);

      for (const m of motif) {
        const t = transformedByStep.get(m.step);
        if (t) {
          // Use transformed note but respect plan's register targets
          let midi = t.midi;
          // Snap to plan contour
          const segIdx = Math.floor(m.step / 4);
          const dir = plan.contourSegments[segIdx] ?? 0;
          if (dir > 0 && midi < m.midi) midi = m.midi; // keep higher if rising
          if (dir < 0 && midi > m.midi) midi = m.midi; // keep lower if falling
          // Harmonic targeting on anchors
          if (ctx.harmonic && plan.anchorSteps.includes(m.step)) {
            midi = nearestChordTone(ctx.harmonic, midi, m.step, ctx.barInPhrase);
          }
          blended.push({ step: m.step, midi: Math.max(48, Math.min(72, midi)), velocity: m.velocity });
        } else {
          blended.push(m);
        }
      }
      motif = blended;
    }
  }

  return motif;
}
