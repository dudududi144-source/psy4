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
    const velScale = 0.7 + req.energy * 0.3;

    // ── Snap to the bar boundary that contains startTime ──
    // barZero = audio time of the most recent bar boundary ≤ startTime.
    // This keeps the grid aligned across compose calls.
    const barZero = req.startTime - (((req.startTime % barLen) + barLen) % barLen);

    const events: NoteEvent[] = [];
    let t = barZero;
    let bassNote = req.prev?.lastBassNote ?? 36;   // C2
    let motifStep = req.prev?.motifStep ?? 0;
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
      for (let b = 0; b < 4; b++) {
        const at = t + b * beat;
        if (at >= req.startTime && at < end) {
          const vel = b === 0 ? 0.95 : 0.85;
          events.push({
            at, role: 'kick' as SynthRole, note: 36,
            velocity: Math.min(1, vel * velScale), duration: beat * 0.8,
          });
        }
      }

      // ── BASS: rolling 16ths (always — even in BREAKDOWN for groove) ──
      if (section !== 'OUTRO') {
        const bassVelMult = section === 'BREAKDOWN' ? 0.5 : 1.0;
        const acidBass = g.acidBass && (section === 'DROP' || section === 'REBUILD');
        for (const step of g.bassSteps) {
          const at = t + step * sixteenth;
          if (at >= req.startTime && at < end) {
            const isDownbeat = step % 4 === 0;
            const isAfterKick = step % 4 === 2;
            if (isDownbeat || isAfterKick || rng() < 0.3) {
              const vel = (isDownbeat ? 0.8 : (isAfterKick ? 0.6 : 0.4)) * bassVelMult;
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
      }

      // ── HATS: 8th notes ──
      if (section === 'GROOVE' || section === 'DROP' || section === 'REBUILD' || section === 'BREAKDOWN') {
        for (let step = 0; step < 16; step += 2) {
          const at = t + step * sixteenth;
          if (at >= req.startTime && at < end) {
            const isOpen = step % 8 === 6;
            events.push({
              at, role: 'hat' as SynthRole, note: isOpen ? 46 : 42,
              velocity: Math.min(1, (isOpen ? 0.3 : 0.4) * velScale),
              duration: sixteenth * 0.3,
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

      // ── LEAD/ACID: motif (GROOVE=soft, DROP/REBUILD=full) ──
      // FIX: lead was only in DROP/REBUILD (bar 16+), user heard nothing for 2+ minutes
      // Now lead plays from GROOVE (bar 8) with lower velocity, full in DROP
      if (section === 'GROOVE' || section === 'DROP' || section === 'REBUILD') {
        if (section === 'GROOVE' ? barIdx >= 8 : true) {
          const leadVelMult = section === 'GROOVE' ? 0.4 : 0.6;
          for (let i = 0; i < g.motifSteps.length; i++) {
            const step = g.motifSteps[i];
            const at = t + step * sixteenth;
            if (at >= req.startTime && at < end) {
              const interval = g.motifIntervals[i % g.motifIntervals.length];
              events.push({
                at,
                role: (g.acidBass ? 'acid' : 'lead') as SynthRole,
                note: leadRoot + interval,
                velocity: Math.min(1, leadVelMult * velScale),
                duration: sixteenth * (section === 'GROOVE' ? 3 : 2),  // longer notes in groove
              });
              motifStep = (motifStep + 1) % g.motifIntervals.length;
            }
          }
        }
      }

      // ── LEAD: atmospheric pad-like layer in INTRO (very soft) ──
      if (section === 'INTRO' && barIdx >= 4) {
        // Soft sustained lead notes for melody hint
        const at = t;
        if (at >= req.startTime && at < end) {
          events.push({
            at,
            role: 'lead' as SynthRole,
            note: leadRoot,
            velocity: Math.min(1, 0.25 * velScale),
            duration: beat * 4,  // whole bar
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
    };
    return { events, next };
  }
}
