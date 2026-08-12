/**
 * F4 RULE 2 — Musical Instrumentation Harness
 *
 * Proves the "one note" failure with actual measured numbers.
 * Runs the psyLive engine for 64 bars and measures:
 * - unique pitches
 * - pitch-class histogram
 * - repeated-note ratio
 * - note density
 * - identical-bar ratio
 * - bar-to-bar entropy
 *
 * Run: bun run tests/foundation/music/musical-instrumentation.ts
 */
import '../../reality-bridge-setup';
import { PsyLive } from '../../../src/lib/psyLive';
import { AudioContextShim } from '../../reality-bridge/audioShim';
import * as fs from 'fs';
import * as path from 'path';

const SAMPLE_RATE = 44100;
const BPM = 145;
const BARS = 64;
const STEPS_PER_BAR = 16;
const TOTAL_STEPS = BARS * STEPS_PER_BAR;
const STEP_DUR = 60 / BPM / 4;

interface NoteEvent {
  step: number;
  bar: number;
  stepInBar: number;
  voice: string;
  midi: number | null;
  freq: number | null;
}

const noteEvents: NoteEvent[] = [];

function instrumentEngine(engine: PsyLive): void {
  const origScheduleStep = (engine as any).scheduleStep.bind(engine);
  (engine as any).scheduleStep = (stepIndex: number, time: number) => {
    const snap = (engine as any).transport.snapshot();
    const s16 = stepIndex % 16;
    const bar = Math.floor(stepIndex / 16);
    const p = (engine as any).getPreset();
    const v = (engine as any).getVariant();
    const root = (engine as any).harmonicLocked && (engine as any).harmonicRoot
      ? (engine as any).harmonicRoot : p.root;
    const pat = (engine as any).livePattern || p.patterns;
    const density = (engine as any).musicState.density;
    const occupancy = (engine as any).occupancy;

    const kickAvailable = occupancy.kick < 0.7;
    const bassAvailable = occupancy.bass < 0.75;
    const leadAvailable = occupancy.lead < 0.85;

    if (kickAvailable && pat.kick && pat.kick[s16]) {
      noteEvents.push({ step: stepIndex, bar, stepInBar: s16, voice: 'kick', midi: null, freq: null });
    }
    if (pat.hat && pat.hat[s16]) {
      noteEvents.push({ step: stepIndex, bar, stepInBar: s16, voice: 'hat', midi: null, freq: null });
    }
    if (bassAvailable) {
      const bn = pat.bass ? pat.bass[s16] : null;
      if (bn !== null && bn !== undefined) {
        const midi = root + bn;
        noteEvents.push({ step: stepIndex, bar, stepInBar: s16, voice: 'bass', midi, freq: 440 * Math.pow(2, (midi - 69) / 12) });
      }
    }
    if (leadAvailable && density > 0.4) {
      const ln = pat.lead ? pat.lead[s16] : null;
      if (ln !== null && ln !== undefined) {
        const midi = root + 24 + ln;
        noteEvents.push({ step: stepIndex, bar, stepInBar: s16, voice: 'lead', midi, freq: 440 * Math.pow(2, (midi - 69) / 12) });
      }
    }

    origScheduleStep(stepIndex, time);
  };
}

function runAnalysis(): void {
  const leadNotes = noteEvents.filter(e => e.voice === 'lead' && e.midi !== null);
  const bassNotes = noteEvents.filter(e => e.voice === 'bass' && e.midi !== null);
  const allPitched = [...leadNotes, ...bassNotes];

  const uniqueLeadPitches = new Set(leadNotes.map(e => e.midi));
  const uniqueBassPitches = new Set(bassNotes.map(e => e.midi));

  const pcHist = new Array(12).fill(0);
  for (const n of allPitched) {
    if (n.midi !== null) pcHist[((n.midi % 12) + 12) % 12]++;
  }

  let repeatedLead = 0;
  for (let i = 1; i < leadNotes.length; i++) {
    if (leadNotes[i].midi === leadNotes[i - 1].midi) repeatedLead++;
  }
  const repeatedLeadRatio = leadNotes.length > 1 ? repeatedLead / (leadNotes.length - 1) : 0;

  const barPatterns: string[] = [];
  for (let b = 0; b < BARS; b++) {
    const barNotes = noteEvents
      .filter(e => e.bar === b)
      .map(e => `${e.voice}:${e.stepInBar}:${e.midi ?? 'drum'}`)
      .sort()
      .join('|');
    barPatterns.push(barNotes);
  }
  const firstBar = barPatterns[0];
  const identicalBars = barPatterns.filter(p => p === firstBar).length;
  const identicalBarRatio = identicalBars / BARS;
  const uniqueBars = new Set(barPatterns).size;

  const densityPerBar = new Array(BARS).fill(0);
  for (const e of noteEvents) densityPerBar[e.bar]++;

  console.log('=== F4 MUSICAL INSTRUMENTATION — 64 BARS AT 145 BPM ===\n');

  console.log('── PITCH DIVERSITY ──');
  console.log(`  Lead notes played: ${leadNotes.length}`);
  console.log(`  Unique lead pitches: ${uniqueLeadPitches.size}`);
  console.log(`  Unique lead MIDIs: ${[...uniqueLeadPitches].sort((a, b) => a - b).join(', ')}`);
  console.log(`  Bass notes played: ${bassNotes.length}`);
  console.log(`  Unique bass pitches: ${uniqueBassPitches.size}`);
  console.log(`  Unique bass MIDIs: ${[...uniqueBassPitches].sort((a, b) => a - b).join(', ')}`);
  console.log(`  Repeated-note ratio (lead): ${(repeatedLeadRatio * 100).toFixed(1)}%`);
  console.log(`  Pitch-class histogram: [${pcHist.join(', ')}]`);
  console.log('');

  console.log('── RHYTHMIC DIVERSITY ──');
  console.log(`  Total note events: ${noteEvents.length}`);
  console.log(`  Identical bars (vs bar 0): ${identicalBars}/${BARS} (${(identicalBarRatio * 100).toFixed(1)}%)`);
  console.log(`  Unique bar patterns: ${uniqueBars}/${BARS}`);
  console.log(`  Avg notes/bar: ${(noteEvents.length / BARS).toFixed(1)}`);
  console.log('');

  console.log('── STRUCTURAL DIVERSITY ──');
  console.log(`  Bars 1-16 unique: ${new Set(barPatterns.slice(0, 16)).size}/16`);
  console.log(`  Bars 17-32 unique: ${new Set(barPatterns.slice(16, 32)).size}/16`);
  console.log(`  Bars 33-48 unique: ${new Set(barPatterns.slice(32, 48)).size}/16`);
  console.log(`  Bars 49-64 unique: ${new Set(barPatterns.slice(48, 64)).size}/16`);
  console.log('');

  console.log('── QUALITY GATES ──');
  const gates = {
    'unique lead pitches > 3': uniqueLeadPitches.size > 3,
    'repeated-note ratio < 50%': repeatedLeadRatio < 0.5,
    'identical-bar ratio < 80%': identicalBarRatio < 0.8,
    'unique bar patterns > 4': uniqueBars > 4,
    'pitch-class diversity > 3': pcHist.filter(v => v > 0).length > 3,
  };
  for (const [gate, passed] of Object.entries(gates)) {
    console.log(`  ${passed ? '✓' : '✗'} ${gate}`);
  }
  console.log('');

  const allGatesPass = Object.values(gates).every(v => v === true);
  console.log(`=== VERDICT: ${allGatesPass ? 'PASS' : 'FAIL — one-note/flat-loop failure PROVEN'} ===`);

  const outPath = path.join(__dirname, 'musical-instrumentation-results.json');
  fs.writeFileSync(outPath, JSON.stringify({
    bpm: BPM, bars: BARS, totalNotes: noteEvents.length,
    leadNotes: leadNotes.length, bassNotes: bassNotes.length,
    uniqueLeadPitches: uniqueLeadPitches.size,
    uniqueLeadMIDIs: [...uniqueLeadPitches].sort((a, b) => a - b),
    uniqueBassPitches: uniqueBassPitches.size,
    repeatedLeadRatio, pitchClassHistogram: pcHist,
    identicalBarRatio, uniqueBarPatterns: uniqueBars,
    gates, verdict: allGatesPass ? 'PASS' : 'FAIL',
  }, null, 2));
  console.log(`Results: ${outPath}`);

  process.exit(0); // Always exit 0 — this is a measurement tool, not a pass/fail test
}

function main(): void {
  const engine = new PsyLive();
  engine.play();
  instrumentEngine(engine);

  const ctx = (engine as any).ctx as AudioContextShim;
  const totalDuration = BARS * 4 * STEP_DUR;

  for (let i = 0; i < totalDuration / 0.025; i++) {
    ctx.tick(0.025);
    (engine as any).scheduler();
  }

  runAnalysis();
}

main();
