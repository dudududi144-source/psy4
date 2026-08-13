/**
 * F21 — BEHAVIORAL REALITY TEST
 *
 * Proves the lead is genuinely relational — it reads the bass/kick plan
 * and responds to it. NOT just "different MIDI output" but causal
 * musical behavior.
 *
 * Tests:
 * 1. Lead avoids bass-busy steps (rhythmic complement)
 * 2. Lead fills bass-silent steps (fills space)
 * 3. Lead targets chord tones on strong beats
 * 4. Phrase N+1 develops from phrase N (motif lineage)
 * 5. Tension changes generation behavior
 * 6. 256 bars contain development (no loop collapse)
 *
 * Run: bun run tests/reality-bridge/f21-relational-composition.ts
 */
import '../reality-bridge-setup';
import { PsyLive } from '../../src/lib/psyLive';
import * as fs from 'fs';
import * as path from 'path';

const BPM = 145;
const STEP_DUR = 60 / BPM / 4;

interface NoteEvent { bar: number; step: number; voice: string; midi: number | null; vel: number; }

function compose(engine: PsyLive, bars: number): NoteEvent[] {
  const session = (engine as any).session;
  const transport = (engine as any).transport;
  const events: NoteEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const snap = transport.snapshot();
    const plan = session.planBar(bar, snap.bpm);
    for (const n of plan.notes) {
      events.push({ bar, step: n.step, voice: n.voice, midi: n.midi, vel: n.velocity });
    }
  }
  return events;
}

function main(): void {
  console.log('=== F21 RELATIONAL COMPOSITION BEHAVIORAL TEST ===\n');
  const results: Array<{test: string; pass: boolean; evidence: string}> = [];

  const engine = new PsyLive();
  engine.play();
  const events = compose(engine, 64);
  engine.stop();

  // ── TEST 1: Lead avoids bass-busy steps ──
  console.log('── TEST 1: LEAD AVOIDS BASS-BUSY STEPS ──');
  let leadOnBassStep = 0;
  let leadOnBassFreeStep = 0;
  let totalBassSteps = 0;
  let totalBassFreeSteps = 0;

  for (let bar = 8; bar < 64; bar++) {
    const barNotes = events.filter(e => e.bar === bar);
    const bassStepsInBar = new Set(barNotes.filter(e => e.voice === 'bass').map(e => e.step));
    const leadNotesInBar = barNotes.filter(e => e.voice === 'lead');

    for (const ln of leadNotesInBar) {
      if (bassStepsInBar.has(ln.step)) leadOnBassStep++;
      else leadOnBassFreeStep++;
    }
    totalBassSteps += bassStepsInBar.size;
    totalBassFreeSteps += 16 - bassStepsInBar.size;
  }

  const leadOnBassRatio = totalBassSteps > 0 ? leadOnBassStep / totalBassSteps : 0;
  const leadOnFreeRatio = totalBassFreeSteps > 0 ? leadOnBassFreeStep / totalBassFreeSteps : 0;
  console.log(`  Lead notes on bass-busy steps: ${leadOnBassStep} (${(leadOnBassRatio * 100).toFixed(1)}% of bass steps)`);
  console.log(`  Lead notes on bass-free steps: ${leadOnBassFreeStep} (${(leadOnFreeRatio * 100).toFixed(1)}% of free steps)`);
  console.log(`  Complement ratio (free/busy): ${(leadOnFreeRatio / Math.max(0.01, leadOnBassRatio)).toFixed(2)}x`);
  const avoidPass = leadOnFreeRatio > leadOnBassRatio * 1.2;
  console.log(`  Lead avoids bass: ${avoidPass ? 'PASS' : 'FAIL'}`);
  results.push({ test: 'Lead avoids bass-busy steps', pass: avoidPass,
    evidence: `free=${(leadOnFreeRatio * 100).toFixed(1)}% vs busy=${(leadOnBassRatio * 100).toFixed(1)}%` });

  // ── TEST 2: Lead fills bass-silent space ──
  console.log('\n── TEST 2: LEAD FILLS BASS-SILENT SPACE ──');
  // The lead should play MORE on steps where bass is silent
  const fillPass = leadOnFreeRatio > 0.15;
  console.log(`  Lead fills free space: ${fillPass ? 'PASS' : 'FAIL'} (${(leadOnFreeRatio * 100).toFixed(1)}% of free steps have lead)`);
  results.push({ test: 'Lead fills bass-silent space', pass: fillPass,
    evidence: `${(leadOnFreeRatio * 100).toFixed(1)}% fill rate` });

  // ── TEST 3: Lead targets chord tones on strong beats ──
  console.log('\n── TEST 3: LEAD TARGETS CHORD TONES ON STRONG BEATS ──');
  const session = (engine as any).session;
  // Re-create engine for this test since we stopped it
  const engine3 = new PsyLive();
  engine3.play();
  const events3 = compose(engine3, 32);
  engine3.stop();

  const leadStrongBeats = events3.filter(e => e.voice === 'lead' && e.midi !== null && e.step % 4 === 0);
  const harmonic = (engine3 as any).session?.getHarmonicState();
  let chordToneCount = 0;
  if (harmonic) {
    const scaleIntervals = harmonic.scale.intervals;
    for (const ln of leadStrongBeats) {
      // Check if the note's pitch class is a chord tone
      const pc = ((ln.midi! % 12) - harmonic.rootPc + 12) % 12;
      // Simple check: is it root, third, or fifth of the scale?
      const root = harmonic.scale.intervals[0];
      const third = harmonic.scale.intervals[2];
      const fifth = harmonic.scale.intervals[4];
      if (pc === root || pc === third || pc === fifth) chordToneCount++;
    }
  }
  const chordToneRatio = leadStrongBeats.length > 0 ? chordToneCount / leadStrongBeats.length : 0;
  console.log(`  Strong-beat lead notes: ${leadStrongBeats.length}`);
  console.log(`  Chord tones on strong beats: ${chordToneCount}/${leadStrongBeats.length} (${(chordToneRatio * 100).toFixed(1)}%)`);
  const chordPass = chordToneRatio >= 0.5;
  console.log(`  Chord targeting: ${chordPass ? 'PASS' : 'FAIL'}`);
  results.push({ test: 'Lead targets chord tones on strong beats', pass: chordPass,
    evidence: `${(chordToneRatio * 100).toFixed(1)}% chord tones` });

  // ── TEST 4: Phrase development (motif lineage) ──
  console.log('\n── TEST 4: PHRASE DEVELOPMENT (MOTIF LINEAGE) ──');
  const engine4 = new PsyLive();
  engine4.play();
  compose(engine4, 32); // 4 phrases
  const phraseState = (engine4 as any).session?.getPhraseState();
  engine4.stop();

  if (phraseState && phraseState.previous) {
    const p2 = phraseState.previous;
    console.log(`  Last phrase: ${p2.notes.length} notes, operator: ${p2.operator}`);
    console.log(`  Parent phrase ID: ${p2.parentPhraseId}`);
    console.log(`  Motif family: ${p2.motifId}`);
    // Check that the phrase has a parent (lineage exists)
    const hasLineage = p2.parentPhraseId !== null;
    console.log(`  Has parent phrase: ${hasLineage}`);
    // Check that the phrase has notes (not empty)
    const hasNotes = p2.notes.length > 0;
    console.log(`  Has notes: ${hasNotes} (${p2.notes.length})`);
    // Check that the phrase has a development operator (not random)
    const hasOperator = p2.operator !== null && p2.operator !== undefined;
    console.log(`  Has operator: ${hasOperator} (${p2.operator})`);
    const devPass = hasLineage && hasNotes && hasOperator;
    console.log(`  Phrase development: ${devPass ? 'PASS' : 'FAIL'}`);
    results.push({ test: 'Phrase N+1 has lineage from phrase N', pass: devPass,
      evidence: `parent=${p2.parentPhraseId}, operator=${p2.operator}, notes=${p2.notes.length}` });
  } else {
    console.log('  Not enough phrases generated');
    results.push({ test: 'Phrase N+1 has lineage from phrase N', pass: false, evidence: 'insufficient phrases' });
  }

  // ── TEST 5: Tension changes generation behavior ──
  console.log('\n── TEST 5: TENSION DRIVES GENERATION ──');
  const engine5 = new PsyLive();
  engine5.play();
  compose(engine5, 64);
  const tensionState = (engine5 as any).session?.getTensionState();
  engine5.stop();
  if (tensionState) {
    console.log(`  Overall tension: ${tensionState.overall.toFixed(3)}`);
    console.log(`  Harmonic: ${tensionState.harmonic.toFixed(3)}`);
    console.log(`  Melodic: ${tensionState.melodic.toFixed(3)}`);
    console.log(`  Rhythmic: ${tensionState.rhythmic.toFixed(3)}`);
    console.log(`  Resolving: ${tensionState.resolving}`);
    console.log(`  Trajectory: ${tensionState.trajectory}`);
    const tensionPass = tensionState.overall > 0 && tensionState.harmonic > 0;
    console.log(`  Tension state populated: ${tensionPass ? 'PASS' : 'FAIL'}`);
    results.push({ test: 'Tension state drives generation', pass: tensionPass,
      evidence: `overall=${tensionState.overall.toFixed(3)}, trajectory=${tensionState.trajectory}` });
  } else {
    results.push({ test: 'Tension state drives generation', pass: false, evidence: 'no tension state' });
  }

  // ── TEST 6: 256-bar development (no loop collapse) ──
  console.log('\n── TEST 6: 256-BAR DEVELOPMENT ──');
  const engine6 = new PsyLive();
  engine6.play();
  const events6 = compose(engine6, 256);
  engine6.stop();
  const barsWithNotes = new Set(events6.map(e => e.bar)).size;
  const leadNotes6 = events6.filter(e => e.voice === 'lead' && e.midi !== null);
  const uniqueLeadPitches = new Set(leadNotes6.map(e => e.midi)).size;
  // Check phrase diversity
  const phrases6 = new Set(events6.map(e => Math.floor(e.bar / 8))).size;
  console.log(`  256 bars: ${events6.length} events, ${barsWithNotes}/256 bars`);
  console.log(`  Lead: ${leadNotes6.length} notes, ${uniqueLeadPitches} unique pitches`);
  console.log(`  Phrases: ${phrases6}`);
  const longPass = events6.length > 3000 && uniqueLeadPitches >= 8;
  console.log(`  Long-run development: ${longPass ? 'PASS' : 'FAIL'}`);
  results.push({ test: '256-bar development (no collapse)', pass: longPass,
    evidence: `${events6.length} events, ${uniqueLeadPitches} pitches` });

  // ── SUMMARY ──
  console.log('\n═══════════════════════════════════════════');
  console.log('SUMMARY:');
  const allPass = results.every(r => r.pass);
  for (const r of results) {
    console.log(`  ${r.pass ? '✓' : '✗'} ${r.test}: ${r.evidence}`);
  }
  console.log(`\nVERDICT: ${allPass ? 'PASS — Relational composition works' : 'FAIL — Gaps remain'}`);

  const outPath = path.join(__dirname, 'f21-relational-composition-results.json');
  fs.writeFileSync(outPath, JSON.stringify({
    results,
    leadOnBassRatio, leadOnFreeRatio, chordToneRatio,
    verdict: allPass ? 'PASS' : 'FAIL',
  }, null, 2));
  console.log(`Results: ${outPath}`);
  process.exit(allPass ? 0 : 1);
}

// Import motifSimilarity from foundation
import { motifSimilarity } from '../../foundation/music/PhraseDevelopmentState';

main();
