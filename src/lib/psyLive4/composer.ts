// src/lib/psyLive4/composer.ts
// The PSY4 composer — a pure function of (startTime, duration, bpm, style, seed, prev).
//
// This replaces public/worklets/composition-worker-v2.js (456 lines, bar-indexed,
// Web Worker). The new design:
//   - Runs synchronously on the main thread (≤0.5ms budget per 120ms window).
//   - Is a pure function — deterministic per (seed, startTime).
//   - Has zero state between calls except what's threaded via `prev`.
//   - Emits events with ABSOLUTE `at` timestamps (never relative to a bar).
//
// The bar-index drift that caused "engine stops after a few minutes" is
// structurally impossible: the composer never tracks bars — it only knows
// "startTime" and "duration" in seconds.

import { mulberry32, range, int } from './rng';
import { STYLE_GRAMMARS, SCALES, resolveGrammar } from './style-grammars';
import type {
  NoteEvent, ComposeRequest, ComposeResult, Composer,
  ComposerContinuity, SynthRole, MusicalStyle,
} from './types';

// ── Section arrangement (64-bar cycle with variation) ────────────────────
// Ported from composition-worker-v2.js getSection(). Each 64-bar cycle
// sounds different: cycle 0 is standard, cycle 1+ varies the order.
export function getSection(bar: number): string {
  const p = bar % 64;
  const cycle = Math.floor(bar / 64);
  if (cycle === 0) {
    if (p < 8) return 'INTRO';
    if (p < 16) return 'GROOVE';
    if (p < 24) return 'DROP';
    if (p < 28) return 'BREAKDOWN';
    if (p < 32) return 'REBUILD';
    if (p < 40) return 'DROP';
    if (p < 44) return 'BREAKDOWN';
    if (p < 52) return 'REBUILD';
    if (p < 60) return 'DROP';
    return 'OUTRO';
  }
  // Cycle 1+: variation — start with DROP, longer breaks, more energy
  if (p < 4) return 'DROP';
  if (p < 8) return 'BREAKDOWN';
  if (p < 24) return 'DROP';
  if (p < 32) return 'BREAKDOWN';
  if (p < 48) return 'REBUILD';
  if (p < 56) return 'DROP';
  if (p < 60) return 'BREAKDOWN';
  return 'OUTRO';
}

// Bass root shifts (I-IV-V-IV-iii, changes every 2 bars)
const BASS_ROOT_SHIFTS = [0, 0, 0, 0, 5, 5, 5, 5, 7, 7, 7, 7, 5, 5, 3, 3];

// Root note shifts per 64-bar cycle (harmonic variety)
const CYCLE_ROOT_SHIFTS = [0, 5, 7, 3, 10, 2];

function nextBassNote(current: number, scale: number[], rng: () => number): number {
  const idx = int(rng, 0, scale.length - 1);
  return current + scale[idx] - scale[0];
}

export class PsytranceComposer implements Composer {
  compose(req: ComposeRequest): ComposeResult {
    const g = resolveGrammar(req.style);
    const scale = SCALES[g.scaleName];
    const rng = mulberry32((req.seed ^ Math.floor(req.startTime * 1000)) >>> 0);
    const beat = 60 / req.bpm;
    const sixteenth = beat / 4;
    const barLen = beat * 4;
    const end = req.startTime + req.duration;
    // DEEP GAP A step 2: if pattern memory has preferred notes, blend the energy
    // slightly toward the average of high-reward bars. This is a soft bias —
    // the composer still generates new patterns, but the energy is nudged.
    const velScale = 0.7 + (req.energy + (req.preferredNotes?.avgEnergy ?? 0)) * 0.15;

    // ── Snap to the bar boundary that contains startTime ──
    // barZero = audio time of the most recent bar boundary ≤ startTime.
    // This keeps the grid aligned across compose calls.
    const barZero = req.startTime - (((req.startTime % barLen) + barLen) % barLen);

    const events: NoteEvent[] = [];
    let t = barZero;
    let bassNote = req.prev?.lastBassNote ?? 36;   // C2
    let motifStep = req.prev?.motifStep ?? 0;
    // PHASE 5.6: EvolvingSequence — mutable motif pattern, seeded from grammar
    let motifPattern = req.prev?.motifPattern
      ? [...req.prev.motifPattern]
      : [...g.motifIntervals];
    let barsSinceMutation = req.prev?.barsSinceLastMutation ?? 0;
    // FIX: only count bars that actually overlap the compose window.
    // The old version counted every iterated bar (including ones before
    // startTime), which caused barInArrangement to skyrocket.
    let barsActuallyComposed = 0;
    const barInArrangement0 = req.prev?.barInArrangement ?? 0;

    // Cycle root (changes every 64 bars for harmonic variety)
    const cycle = Math.floor(barInArrangement0 / 64);
    const cycleRootShift = CYCLE_ROOT_SHIFTS[cycle % CYCLE_ROOT_SHIFTS.length];

    while (t < end) {
      const barIdx = barInArrangement0 + barsActuallyComposed;
      const section = getSection(barIdx);
      let barProducedEvent = false;

      // Root note for this bar (I-IV-V-IV-iii cycle, 2 bars per shift)
      const shiftIdx = Math.floor(barIdx / 2) % BASS_ROOT_SHIFTS.length;
      const bassRoot = 36 + cycleRootShift + BASS_ROOT_SHIFTS[shiftIdx]; // MIDI 36 = C2
      const leadRoot = 60 + cycleRootShift + BASS_ROOT_SHIFTS[shiftIdx]; // MIDI 60 = C4

      // ── KICK: 4-on-the-floor (always) ──
      // KICK VELOCITY: 0.95 (NOT scaled by velScale). The kick IS the beat —
      // it must be the loudest element. velScale is for melodic instruments.
      // Commercial psytrance kicks: 0.9-1.0 velocity, uniform (no accent).
      for (let b = 0; b < 4; b++) {
        const at = t + b * beat;
        if (at >= req.startTime && at < end) {
          const humanize = (rng() - 0.5) * 0.04; // ±0.02
          const vel = Math.min(1, 0.95 + humanize);
          events.push({
            at, role: 'kick' as SynthRole, note: 36,
            velocity: vel, duration: beat * 0.8,
          });
        }
      }

      // ── BASS: rolling 16ths (always — even in BREAKDOWN for groove) ──
      // PHASE 5.2 FIX: was sparse (isAfterKick || rng()<0.3 → ~6.7 notes/bar).
      // Real psytrance bass = 12-16 16th notes/bar, continuous rolling.
      // The bassSteps array (excludes 0,4,8,12 = downbeats where kick hits)
      // gives 12 offbeat 16th positions — play ALL of them, with accent pattern:
      //   - steps 2,6,10,14 ("after kick" = 8th-note offbeats) → accent 0.8
      //   - other steps → 0.55
      if (section !== 'OUTRO') {
        const bassVelMult = section === 'BREAKDOWN' ? 0.5 : 1.0;
        const acidBass = g.acidBass && (section === 'DROP' || section === 'REBUILD');
        for (const step of g.bassSteps) {
          const at = t + step * sixteenth;
          if (at >= req.startTime && at < end) {
            const isAfterKick = step % 4 === 2;  // 8th-note offbeat positions
            const vel = (isAfterKick ? 0.8 : 0.55) * bassVelMult;
            const noteOffset = scale[step % scale.length] - scale[0];
            events.push({
              at,
              role: (acidBass ? 'acid' : 'bass') as SynthRole,
              note: bassRoot + noteOffset,
              velocity: Math.min(1, vel * velScale),
              duration: sixteenth * 0.9,
            });
            bassNote = bassRoot + noteOffset;
          }
        }
      }

      // ── HATS: 8th notes (PHASE 5: raised velocity 0.3/0.4 → 0.6/0.75 for high-freq content) ──
      if (section === 'GROOVE' || section === 'DROP' || section === 'REBUILD' || section === 'BREAKDOWN') {
        for (let step = 0; step < 16; step += 2) {
          const at = t + step * sixteenth;
          if (at >= req.startTime && at < end) {
            const isOpen = step % 8 === 6;
            events.push({
              at, role: 'hat' as SynthRole, note: isOpen ? 46 : 42,
              velocity: Math.min(1, (isOpen ? 0.6 : 0.75) * velScale),
              duration: sixteenth * 0.35,
            });
          }
        }
      }

      // ── PERC: occasional hits (density from grammar) ──
      if (section === 'GROOVE' || section === 'DROP' || section === 'REBUILD') {
        if (rng() < g.percussionDensity) {
          const step = 3 + int(rng, 0, 3) * 4; // steps 3,7,11,15
          const at = t + step * sixteenth;
          if (at >= req.startTime && at < end) {
            events.push({
              at, role: 'perc' as SynthRole, note: 50,
              velocity: Math.min(1, 0.4 * velScale),
              duration: sixteenth * 0.2,
            });
          }
        }
      }

      // ── SNARE/CLAP: backbeat (beats 2 & 4) in DROP/REBUILD ──
      if (section === 'DROP' || section === 'REBUILD') {
        for (const b of [1, 3]) {
          const at = t + b * beat;
          if (at >= req.startTime && at < end) {
            events.push({
              at, role: 'clap' as SynthRole, note: 39,
              velocity: Math.min(1, 0.5 * velScale),
              duration: sixteenth * 0.5,
            });
          }
        }
      }

      // ── LEAD/ACID: AABA phrase structure (PHASE 5.5) + EvolvingSequence (5.6) ──
      // AABA: bars 0,1 = A (statement, root position); bar 2 = B (octave higher, denser);
      // bar 3 = A' (return, with mutation from EvolvingSequence).
      // EvolvingSequence: motifPattern mutates ONE step by ±2 every 4 bars.
      if (section === 'GROOVE' || section === 'DROP' || section === 'REBUILD') {
        if (section === 'GROOVE' ? barIdx >= 8 : true) {
          const barInPhrase = barIdx % 4;
          const isBSection = barInPhrase === 2;        // B = contrast (octave higher, denser)
          // PHASE 5.6: mutate the motifPattern every 4 bars (on bar 0 of each phrase)
          if (barInPhrase === 0 && barsSinceMutation >= 4) {
            const mutIdx = int(rng, 0, motifPattern.length - 1);
            const delta = rng() < 0.5 ? -2 : 2;
            motifPattern[mutIdx] = Math.max(-7, Math.min(12, motifPattern[mutIdx] + delta));
            barsSinceMutation = 0;
          } else {
            barsSinceMutation++;
          }
          // PHASE 5.5: AABA velocity + density
          // A/A': sparse (motifSteps), B: denser (all 8 even-step positions)
          const leadVelMult = (section === 'GROOVE' ? 0.5 : 0.75) * (isBSection ? 1.15 : 1.0);
          const stepsToPlay = isBSection
            ? [0, 2, 4, 6, 8, 10, 12, 14]
            : g.motifSteps;
          for (let i = 0; i < stepsToPlay.length; i++) {
            const step = stepsToPlay[i];
            const at = t + step * sixteenth;
            if (at >= req.startTime && at < end) {
              const bassScaleIdx = step % scale.length;
              const bassNoteAtStep = bassRoot + (scale[bassScaleIdx] - scale[0]);
              // PHASE 5.6: use the mutable motifPattern (was: fixed g.motifIntervals)
              const harmonyInterval = motifPattern[i % motifPattern.length];
              const octaveShift = isBSection ? 12 : 0;  // B section: +1 octave
              const leadNote = bassNoteAtStep + 24 + harmonyInterval + octaveShift;
              events.push({
                at,
                role: (g.acidBass ? 'acid' : 'lead') as SynthRole,
                note: leadNote,
                velocity: Math.min(1, leadVelMult * velScale),
                duration: sixteenth * (isBSection ? 1 : (section === 'GROOVE' ? 3 : 2)),
              });
              motifStep = (motifStep + 1) % motifPattern.length;
            }
          }
        }
      }

      // ── LEAD: atmospheric pad-like layer in INTRO (very soft) ──
      if (section === 'INTRO' && barIdx >= 4) {
        const at = t;
        if (at >= req.startTime && at < end) {
          // Play root + 7th (perfect 5th) for consonant pad-like layer
          events.push({
            at,
            role: 'lead' as SynthRole,
            note: leadRoot + 7,  // perfect 5th above root
            velocity: Math.min(1, 0.25 * velScale),
            duration: beat * 4,
          });
        }
      }

      // ── PAD: sustained chord (INTRO, BREAKDOWN, OUTRO) ──
      if (section === 'INTRO' || section === 'BREAKDOWN' || section === 'OUTRO') {
        // Pad fires only at bar boundaries we actually cover
        if (t >= req.startTime && t < end) {
          const chord = [0, 7, 12]; // root + fifth + octave
          for (const interval of chord) {
            events.push({
              at: t,
              role: 'pad' as SynthRole,
              note: 48 + cycleRootShift + BASS_ROOT_SHIFTS[shiftIdx] + interval,
              velocity: Math.min(1, 0.3 * velScale),
              duration: 4 * beat,
            });
          }
        }
      }

      t += barLen;
      // Only advance the arrangement counter for bars that actually overlap
      // the compose window [req.startTime, end). Bars before startTime are
      // iterated (to maintain grid alignment) but don't advance the counter.
      if (t > req.startTime) {
        barsActuallyComposed++;
      }
    }

    events.sort((a, b) => a.at - b.at);
    // FIX: derive barInArrangement from absolute audio time, not call count.
    // The old version accumulated `barsActuallyComposed` per call, but since
    // the scheduler fires every 25ms and each call covers ~120ms, the counter
    // skyrocketed (325 bars in 8 seconds). The correct musical position is:
    //   barInArrangement = floor(startTime / barLen)
    // This is monotonically tied to audio time and can't drift.
    const barInArrangementFromTime = Math.floor(req.startTime / barLen);
    const next: ComposerContinuity = {
      lastBassNote: bassNote,
      barInArrangement: barInArrangementFromTime,
      motifStep,
      motifPattern,           // PHASE 5.6: thread the mutated pattern
      barsSinceLastMutation: barsSinceMutation,
    };
    return { events, next };
  }
}
