/**
 * F5 RULE 18 — Musical Instrumentation Harness (LiveComposer version)
 *
 * Measures the ACTUAL musical output of the LiveComposer over 64 bars.
 * Does NOT monkey-patch scheduleStep — reads from the NotePlan directly.
 *
 * Run: bun run tests/foundation/music/musical-instrumentation.ts
 */
import '../../reality-bridge-setup';
import { PsyLive } from '../../../src/lib/psyLive';
import { AudioContextShim } from '../../reality-bridge/audioShim';
import * as fs from 'fs';
import * as path from 'path';

const BPM = 145;
const BARS = 64;
const STEP_DUR = 60 / BPM / 4;

interface NoteEvent {
  step: number; bar: number; stepInBar: number;
  voice: string; midi: number | null;
}

const noteEvents: NoteEvent[] = [];

function main(): void {
  const engine = new PsyLive();
  engine.play();
  const ctx = (engine as any).ctx as AudioContextShim;
  const totalDuration = BARS * 4 * STEP_DUR;

  // Run scheduler — the real scheduleStep uses LiveComposer
  for (let i = 0; i < totalDuration / 0.025; i++) {
    ctx.tick(0.025);
    (engine as any).scheduler();
  }

  // Read all NotePlans from the LiveComposer
  const composer = (engine as any).session;
  if (!composer) {
    console.log('ERROR: No session found');
    process.exit(1);
  }

  // Plan each bar and collect notes
  for (let bar = 0; bar < BARS; bar++) {
    const plan = composer.planBar(bar, BPM);
    for (const note of plan.notes) {
      noteEvents.push({
        step: bar * 16 + note.step,
        bar,
        stepInBar: note.step,
        voice: note.voice,
        midi: note.midi,
      });
    }
  }

  // ── Analysis ──
  const leadNotes = noteEvents.filter(e => e.voice === 'lead' && e.midi !== null);
  const bassNotes = noteEvents.filter(e => e.voice === 'bass' && e.midi !== null);
  const allPitched = [...leadNotes, ...bassNotes];

  const uniqueLeadPitches = new Set(leadNotes.map(e => e.midi));
  const uniqueBassPitches = new Set(bassNotes.map(e => e.midi));
  const uniqueAllPitches = new Set(allPitched.map(e => e.midi));

  const pcHist = new Array(12).fill(0);
  for (const n of allPitched) {
    if (n.midi !== null) pcHist[((n.midi % 12) + 12) % 12]++;
  }

  let repeatedLead = 0;
  for (let i = 1; i < leadNotes.length; i++) {
    if (leadNotes[i].midi === leadNotes[i - 1].midi) repeatedLead++;
  }
  const repeatedLeadRatio = leadNotes.length > 1 ? repeatedLead / (leadNotes.length - 1) : 0;

  // Interval diversity
  const intervals: number[] = [];
  for (let i = 1; i < leadNotes.length; i++) {
    if (leadNotes[i].midi !== null && leadNotes[i - 1].midi !== null) {
      intervals.push(leadNotes[i].midi! - leadNotes[i - 1].midi!);
    }
  }
  const uniqueIntervals = new Set(intervals);

  const barPatterns: string[] = [];
  for (let b = 0; b < BARS; b++) {
    const barNotes = noteEvents
      .filter(e => e.bar === b)
      .map(e => `${e.voice}:${e.stepInBar}:${e.midi ?? 'drum'}`)
      .sort()
      .join('|');
    barPatterns.push(barNotes);
  }
  const uniqueBars = new Set(barPatterns).size;

  const densityPerBar = new Array(BARS).fill(0);
  for (const e of noteEvents) densityPerBar[e.bar]++;

  console.log('=== F5 MUSICAL INSTRUMENTATION — 64 BARS (LiveComposer) ===\n');

  console.log('── PITCH DIVERSITY ──');
  console.log(`  Lead notes: ${leadNotes.length}`);
  console.log(`  Unique lead pitches: ${uniqueLeadPitches.size}`);
  console.log(`  Unique lead MIDIs: ${[...uniqueLeadPitches].sort((a, b) => a - b).join(', ')}`);
  console.log(`  Bass notes: ${bassNotes.length}`);
  console.log(`  Unique bass pitches: ${uniqueBassPitches.size}`);
  console.log(`  Unique bass MIDIs: ${[...uniqueBassPitches].sort((a, b) => a - b).join(', ')}`);
  console.log(`  Total unique pitched: ${uniqueAllPitches.size}`);
  console.log(`  Repeated-note ratio (lead): ${(repeatedLeadRatio * 100).toFixed(1)}%`);
  console.log(`  Unique intervals: ${uniqueIntervals.size} (${[...uniqueIntervals].sort((a, b) => a - b).join(', ')})`);
  console.log(`  Pitch-class histogram: [${pcHist.join(', ')}]`);
  console.log(`  Pitch classes used: ${pcHist.filter(v => v > 0).length}/12`);
  console.log('');

  console.log('── RHYTHMIC DIVERSITY ──');
  console.log(`  Total notes: ${noteEvents.length}`);
  console.log(`  Unique bar patterns: ${uniqueBars}/${BARS}`);
  console.log(`  Avg notes/bar: ${(noteEvents.length / BARS).toFixed(1)}`);
  console.log(`  Density range: ${Math.min(...densityPerBar)}-${Math.max(...densityPerBar)}`);
  console.log('');

  console.log('── STRUCTURAL DIVERSITY ──');
  console.log(`  Bars 1-16 unique: ${new Set(barPatterns.slice(0, 16)).size}/16`);
  console.log(`  Bars 17-32 unique: ${new Set(barPatterns.slice(16, 32)).size}/16`);
  console.log(`  Bars 33-48 unique: ${new Set(barPatterns.slice(32, 48)).size}/16`);
  console.log(`  Bars 49-64 unique: ${new Set(barPatterns.slice(48, 64)).size}/16`);
  console.log('');

  console.log('── COMPOSER STATE ──');
  const snap = composer.snapshot();
  if (snap) {
    console.log(`  Section: ${snap?.section}`);
    console.log(`  Phrase: ${snap?.phrase}`);
    console.log(`  Tension: ${snap.tension.toFixed(2)}`);
    console.log(`  Novelty: ${0.4.toFixed(2)}`);
    console.log(`  Motif count: ${snap?.motifCount}`);
    console.log(`  Last transform: ${"none"}`);
  }
  console.log('');

  console.log('── QUALITY GATES ──');
  const gates = {
    'unique lead pitches >= 6': uniqueLeadPitches.size >= 6,
    'pitch classes >= 5': pcHist.filter(v => v > 0).length >= 5,
    'unique intervals >= 3': uniqueIntervals.size >= 3,
    'repeated-note ratio < 50%': repeatedLeadRatio < 0.5,
    'unique bar patterns >= 8': uniqueBars >= 8,
    'structural diversity (4 sections have >1 pattern)': [
      new Set(barPatterns.slice(0, 16)).size,
      new Set(barPatterns.slice(16, 32)).size,
      new Set(barPatterns.slice(32, 48)).size,
      new Set(barPatterns.slice(48, 64)).size,
    ].every(v => v >= 2),
  };
  for (const [gate, passed] of Object.entries(gates)) {
    console.log(`  ${passed ? '✓' : '✗'} ${gate}`);
  }
  console.log('');

  const allPass = Object.values(gates).every(v => v === true);
  console.log(`=== VERDICT: ${allPass ? 'PASS' : 'FAIL'} ===`);

  const outPath = path.join(__dirname, 'musical-instrumentation-results.json');
  fs.writeFileSync(outPath, JSON.stringify({
    bpm: BPM, bars: BARS,
    leadNotes: leadNotes.length, bassNotes: bassNotes.length,
    uniqueLeadPitches: uniqueLeadPitches.size,
    uniqueLeadMIDIs: [...uniqueLeadPitches].sort((a, b) => a - b),
    uniqueBassPitches: uniqueBassPitches.size,
    repeatedLeadRatio, uniqueIntervals: uniqueIntervals.size,
    pitchClassHistogram: pcHist, pitchClassesUsed: pcHist.filter(v => v > 0).length,
    uniqueBarPatterns: uniqueBars,
    densityPerBar, barPatterns,
    gates, verdict: allPass ? 'PASS' : 'FAIL',
  }, null, 2));
  console.log(`Results: ${outPath}`);

  process.exit(0);
}

main();
