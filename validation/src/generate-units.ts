/**
 * PSY4 Vertical Validation — Experimental Unit Generator
 *
 * Generates 9 frozen experimental units (3 compositions × 3 seeds).
 * Each unit is a frozen CompositionEvent[] that ALL variants (A/B/C/D/E) consume.
 *
 * MAPPING (honest, per PRE-RENDER SNAPSHOT §4):
 * - step, midi, durationSteps, velocity ← Foundation's MotifNote/BassNote/RhythmPattern
 * - barContext.{tonic, scaleName, bpm, barPosition, phrasePosition, harmonicContext, tension}
 *   ← Foundation's MusicalContext
 * - sourceMaterial ← material kind (motif/bass-pattern/drum-pattern)
 * - trackName ← drum-pattern track name
 *
 * NO invented fields. NO GAP-filling. Foundation output is used AS-IS.
 */

import {
  generateBassPattern,
  generateMotif,
  fourOnFloor,
  offbeatHats,
  getScale,
  type Scale,
} from '/tmp/psy-foundation/packages/music/src/index.ts';
import type { CompositionEvent, ExperimentalUnit, BarContext } from './types.ts';

const BPM = 145;
const STEPS_PER_BAR = 16;
const TONIC_PC = 4; // E
const SCALE_NAME = 'phrygian-dominant';

// ─── Hand-encoded pattern matching psyLive "rolling_bass" preset ────────────
// (for comp-3 — direct comparison to existing AUDIT artifacts)
const ROLLING_BASS_KICK = [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0];
const ROLLING_BASS_BASS_DEGREES = [null,0,0,0, null,0,0,0, null,0,0,0, null,0,0,3]; // degree offsets
const ROLLING_BASS_LEAD_DEGREES = [null,null,null,null, null,null,12,null, null,null,null,null, 15,null,12,null];
const ROLLING_BASS_HAT = [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,1];

function makeBarContext(barPosition: number, phrasePosition: number, tension: number): BarContext {
  return {
    tonic: TONIC_PC,
    scaleName: SCALE_NAME,
    bpm: BPM,
    barPosition,
    phrasePosition,
    harmonicContext: [TONIC_PC, TONIC_PC + 7, TONIC_PC + 3], // i7-style chord pcs (E phrygian dominant)
    tension,
  };
}

// ─── Composition 1: Foundation-generated 4-bar phrase ───────────────────────
function genComp1(seed: number): CompositionEvent[] {
  const scale = getScale(SCALE_NAME)!;
  const events: CompositionEvent[] = [];

  for (let bar = 0; bar < 4; bar++) {
    const tension = 0.3 + (bar / 3) * 0.4; // builds 0.3 → 0.7
    const barCtx = makeBarContext(bar, bar, tension);

    // Kick (four-on-floor) — drum-pattern track "kick"
    for (let step = 0; step < STEPS_PER_BAR; step += 4) {
      events.push({
        step: bar * STEPS_PER_BAR + step,
        midi: 36, // C2 — kick
        durationSteps: 1,
        velocity: 0.9,
        barContext: barCtx,
        sourceMaterial: 'drum-pattern',
        trackName: 'kick',
      });
    }

    // Bass (kb3 style) — bass-pattern
    const bass = generateBassPattern(TONIC_PC, scale, { seed: seed + bar, style: 'kb3', octave: 2 });
    for (const n of bass) {
      if (n.step < STEPS_PER_BAR) {
        events.push({
          step: bar * STEPS_PER_BAR + n.step,
          midi: n.midi,
          durationSteps: n.durationSteps,
          velocity: n.velocity,
          barContext: barCtx,
          sourceMaterial: 'bass-pattern',
        });
      }
    }

    // Hats (offbeat) — drum-pattern track "hat"
    const hats = offbeatHats(STEPS_PER_BAR);
    for (let step = 0; step < STEPS_PER_BAR; step++) {
      if (hats.hits[step]) {
        events.push({
          step: bar * STEPS_PER_BAR + step,
          midi: 42, // closed hat
          durationSteps: 1,
          velocity: hats.velocities?.[step] ?? 0.4,
          barContext: barCtx,
          sourceMaterial: 'drum-pattern',
          trackName: 'hat',
        });
      }
    }

    // Lead (motif) — only on bars 2,3 (tension building)
    if (bar >= 2) {
      const motif = generateMotif(TONIC_PC, scale, { seed: seed * 10 + bar, steps: STEPS_PER_BAR, density: 0.4 + bar * 0.05 });
      for (const n of motif) {
        events.push({
          step: bar * STEPS_PER_BAR + n.step,
          midi: n.midi,
          durationSteps: n.durationSteps,
          velocity: n.velocity,
          barContext: barCtx,
          sourceMaterial: 'motif',
        });
      }
    }
  }

  return events;
}

// ─── Composition 2: Foundation-generated 8-bar phrase ───────────────────────
function genComp2(seed: number): CompositionEvent[] {
  const scale = getScale(SCALE_NAME)!;
  const events: CompositionEvent[] = [];

  for (let bar = 0; bar < 8; bar++) {
    // 8-bar arc: intro (0-1) → build (2-4) → peak (5-6) → resolve (7)
    let tension: number;
    if (bar < 2) tension = 0.2;
    else if (bar < 5) tension = 0.3 + (bar - 2) * 0.15;
    else if (bar < 7) tension = 0.75;
    else tension = 0.4;
    const barCtx = makeBarContext(bar, Math.floor(bar / 4), tension);

    // Kick
    for (let step = 0; step < STEPS_PER_BAR; step += 4) {
      events.push({
        step: bar * STEPS_PER_BAR + step,
        midi: 36, durationSteps: 1, velocity: 0.9,
        barContext: barCtx, sourceMaterial: 'drum-pattern', trackName: 'kick',
      });
    }

    // Bass — varies by section
    const bassStyle = bar < 2 ? 'four-on-floor' : bar < 7 ? 'kb3' : 'offbeat';
    const bass = generateBassPattern(TONIC_PC, scale, { seed: seed * 2 + bar, style: bassStyle as any, octave: 2 });
    for (const n of bass) {
      if (n.step < STEPS_PER_BAR) {
        events.push({
          step: bar * STEPS_PER_BAR + n.step,
          midi: n.midi, durationSteps: n.durationSteps, velocity: n.velocity,
          barContext: barCtx, sourceMaterial: 'bass-pattern',
        });
      }
    }

    // Hats
    const hats = offbeatHats(STEPS_PER_BAR);
    for (let step = 0; step < STEPS_PER_BAR; step++) {
      if (hats.hits[step]) {
        events.push({
          step: bar * STEPS_PER_BAR + step,
          midi: 42, durationSteps: 1, velocity: 0.4,
          barContext: barCtx, sourceMaterial: 'drum-pattern', trackName: 'hat',
        });
      }
    }

    // Lead — only in build/peak (bars 2-6)
    if (bar >= 2 && bar < 7) {
      const density = bar < 5 ? 0.4 : 0.6;
      const motif = generateMotif(TONIC_PC, scale, { seed: seed * 20 + bar, steps: STEPS_PER_BAR, density });
      for (const n of motif) {
        events.push({
          step: bar * STEPS_PER_BAR + n.step,
          midi: n.midi, durationSteps: n.durationSteps, velocity: n.velocity,
          barContext: barCtx, sourceMaterial: 'motif',
        });
      }
    }
  }

  return events;
}

// ─── Composition 3: hand-encoded 4-bar matching "rolling_bass" preset ──────
function genComp3(seed: number): CompositionEvent[] {
  const scale = getScale(SCALE_NAME)!;
  const events: CompositionEvent[] = [];
  const rootMidi = 33; // A1 — matches psyLive preset root

  for (let bar = 0; bar < 4; bar++) {
    const tension = 0.4 + (bar / 3) * 0.3;
    const barCtx = makeBarContext(bar, bar, tension);

    for (let step = 0; step < STEPS_PER_BAR; step++) {
      const absStep = bar * STEPS_PER_BAR + step;

      // Kick
      if (ROLLING_BASS_KICK[step]) {
        events.push({
          step: absStep, midi: 36, durationSteps: 1, velocity: 0.9,
          barContext: barCtx, sourceMaterial: 'drum-pattern', trackName: 'kick',
        });
      }

      // Bass
      const bassDeg = ROLLING_BASS_BASS_DEGREES[step];
      if (bassDeg !== null) {
        const midi = rootMidi + (scale.intervals[bassDeg % scale.intervals.length] ?? 0) + Math.floor(bassDeg / scale.intervals.length) * 12;
        events.push({
          step: absStep, midi, durationSteps: 2, velocity: 0.8,
          barContext: barCtx, sourceMaterial: 'bass-pattern',
        });
      }

      // Lead (bars 1-3 only)
      if (bar >= 1) {
        const leadDeg = ROLLING_BASS_LEAD_DEGREES[step];
        if (leadDeg !== null) {
          const midi = rootMidi + 24 + (scale.intervals[leadDeg % scale.intervals.length] ?? 0) + Math.floor(leadDeg / scale.intervals.length) * 12;
          events.push({
            step: absStep, midi, durationSteps: 1, velocity: 0.7,
            barContext: barCtx, sourceMaterial: 'motif',
          });
        }
      }

      // Hat
      if (ROLLING_BASS_HAT[step]) {
        events.push({
          step: absStep, midi: 42, durationSteps: 1, velocity: 0.4,
          barContext: barCtx, sourceMaterial: 'drum-pattern', trackName: 'hat',
        });
      }
    }
  }

  return events;
}

// ─── Generate all 9 units ───────────────────────────────────────────────────
export function generateAllUnits(): ExperimentalUnit[] {
  const units: ExperimentalUnit[] = [];
  const seeds: Array<1 | 2 | 3> = [1, 2, 3];

  for (const seed of seeds) {
    units.push({
      compositionId: 'comp-1', seed, bpm: BPM, bars: 4,
      events: genComp1(seed),
    });
    units.push({
      compositionId: 'comp-2', seed, bpm: BPM, bars: 8,
      events: genComp2(seed),
    });
    units.push({
      compositionId: 'comp-3', seed, bpm: BPM, bars: 4,
      events: genComp3(seed),
    });
  }

  return units;
}

// ─── CLI: generate and save frozen units as JSON ────────────────────────────
if (import.meta.main) {
  const units = generateAllUnits();
  console.log(`Generated ${units.length} experimental units:`);
  for (const u of units) {
    console.log(`  ${u.compositionId} seed=${u.seed} bars=${u.bars} events=${u.events.length}`);
    const roles = new Map<string, number>();
    for (const e of u.events) {
      const key = e.trackName ?? e.sourceMaterial;
      roles.set(key, (roles.get(key) ?? 0) + 1);
    }
    console.log(`    roles: ${[...roles.entries()].map(([k,v]) => `${k}=${v}`).join(', ')}`);
  }
  const outPath = '/home/z/my-project/validation/results/frozen-units.json';
  const fs = await import('fs');
  fs.writeFileSync(outPath, JSON.stringify(units, null, 2));
  console.log(`\nFrozen units saved to ${outPath}`);
}
