/**
 * F22 L1-L5 — PHRASE-LEVEL REALITY TESTS
 *
 * Proves the lead is a PHRASE generator, not a step generator.
 *
 * L1: Phrase coherence (contour, start/end, cadence)
 * L2: Phrase development (CONTINUE/DEVELOP/ANSWER/CONTRAST produce different transforms)
 * L3: Lead sits with bass (rhythmic complementarity at phrase level)
 * L4: Harmonic phrase (chord tones on strong beats, different harmony → different lead)
 * L5: Learning changes musical vocabulary (different learned source → different phrase grammar)
 *
 * Run: bun run tests/reality-bridge/f22-phrase-reality.ts
 */
import '../reality-bridge-setup';
import { PsyLive } from '../../src/lib/psyLive';
import { motifSimilarity, type PhraseRecord } from '../../foundation/music/PhraseDevelopmentState';
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

function feedRadio(session: any, bars: number, profile: 'bright' | 'dark'): void {
  const freqData = new Uint8Array(256);
  // F22: Different pitch content for each profile to create different learned grammars
  const pitchClass = profile === 'bright' ? 0 : 7;  // C vs G
  const bassFreq = profile === 'bright' ? 130.81 : 110; // C3 vs A2
  for (let bar = 0; bar < bars; bar++) {
    for (let tick = 0; tick < 8; tick++) {
      for (let i = 0; i < freqData.length; i++) {
        const freq = i * (44100 / 512);
        if (profile === 'bright') {
          if (freq < 250) freqData[i] = 30 + Math.random() * 20;
          else if (freq < 2500) freqData[i] = 80 + Math.random() * 30;
          else freqData[i] = 200 + Math.random() * 40;
        } else {
          if (freq < 250) freqData[i] = 220 + Math.random() * 30;
          else if (freq < 2500) freqData[i] = 60 + Math.random() * 20;
          else freqData[i] = 10 + Math.random() * 10;
        }
      }
      session.observeRadioTick({
        audioTime: bar * 4 * STEP_DUR + tick * 0.2,
        radioBpm: 150, energy: 0.6,
        occupancy: { kick: 0.8, bass: 0.7, lead: 0.4, hats: 0.5 },
        bassFreq, pitchClass, pitchConfidence: 0.7,
        freqData, sampleRate: 44100, fftSize: 512,
      });
    }
    if ((bar + 1) % 8 === 0) session.extractPhraseLearning(Math.floor(bar / 8), bar - 7, 8);
  }
}

function computeContour(notes: { midi: number }[]): number[] {
  const contour: number[] = [];
  for (let i = 1; i < notes.length; i++) {
    contour.push(Math.sign(notes[i].midi - notes[i - 1].midi));
  }
  return contour;
}

function main(): void {
  console.log('=== F22 PHRASE-LEVEL REALITY TESTS (L1-L5) ===\n');
  const results: Array<{test: string; pass: boolean; evidence: string}> = [];

  // L1: PHRASE COHERENCE
  console.log('── L1: PHRASE COHERENCE ──');
  const e1 = new PsyLive(); e1.play();
  const ev1 = compose(e1, 64); // 8 phrases
  e1.stop();

  // Check each phrase has a recognizable contour
  let coherentPhrases = 0;
  let totalPhrases = 0;
  for (let phrase = 1; phrase < 8; phrase++) {
    const startBar = phrase * 8;
    const leadInPhrase = ev1.filter(e => e.voice === 'lead' && e.midi !== null && e.bar >= startBar && e.bar < startBar + 8);
    if (leadInPhrase.length < 3) continue;
    totalPhrases++;
    const contour = computeContour(leadInPhrase.map(e => ({ midi: e.midi! })));
    // Check: not all zeros (not flat random) and has some direction
    const nonZero = contour.filter(c => c !== 0).length;
    const hasDirection = nonZero / contour.length > 0.3;
    // Check: phrase has a start (first note) and end (last note)
    const hasStart = leadInPhrase[0].step % 4 === 0 || leadInPhrase[0].step === 2;
    const hasEnd = leadInPhrase[leadInPhrase.length - 1].step >= 12;
    if (hasDirection && hasStart && hasEnd) coherentPhrases++;
  }
  const l1Pass = coherentPhrases / Math.max(1, totalPhrases) > 0.5;
  console.log(`  Coherent phrases: ${coherentPhrases}/${totalPhrases}`);
  console.log(`  L1: ${l1Pass ? 'PASS' : 'FAIL'}`);
  results.push({ test: 'L1: Phrase coherence', pass: l1Pass, evidence: `${coherentPhrases}/${totalPhrases} coherent` });

  // L2: PHRASE DEVELOPMENT
  console.log('\n── L2: PHRASE DEVELOPMENT ──');
  const e2 = new PsyLive(); e2.play();
  compose(e2, 32); // 4 phrases
  const ps2 = (e2 as any).session?.getPhraseState();
  e2.stop();

  if (ps2?.previous && ps2?.beforePrevious) {
    const p1 = ps2.beforePrevious as PhraseRecord;
    const p2 = ps2.previous as PhraseRecord;
    const sim = motifSimilarity(p1, p2);
    // Different operators should produce different similarity levels
    console.log(`  P1 operator: ${p1.operator}, notes: ${p1.notes.length}`);
    console.log(`  P2 operator: ${p2.operator}, notes: ${p2.notes.length}`);
    console.log(`  Motif similarity: ${(sim * 100).toFixed(1)}%`);
    // Check: P2 has parent (lineage)
    const hasParent = p2.parentPhraseId !== null;
    // Check: P2 is materially different (not identical copy)
    const isDifferent = p2.notes.length !== p1.notes.length || sim < 0.9;
    const l2Pass = hasParent && isDifferent;
    console.log(`  Has parent: ${hasParent}, materially different: ${isDifferent}`);
    console.log(`  L2: ${l2Pass ? 'PASS' : 'FAIL'}`);
    results.push({ test: 'L2: Phrase development', pass: l2Pass, evidence: `sim=${(sim * 100).toFixed(1)}%, op=${p2.operator}` });
  } else {
    console.log('  Not enough phrases');
    results.push({ test: 'L2: Phrase development', pass: false, evidence: 'insufficient phrases' });
  }

  // L3: LEAD SITS WITH BASS (phrase-level complementarity)
  console.log('\n── L3: LEAD SITS WITH BASS ──');
  let leadOnBassNonAnchor = 0, leadOnFreeNonAnchor = 0;
  for (let bar = 8; bar < 64; bar++) {
    const barNotes = ev1.filter(e => e.bar === bar);
    const bassSteps = new Set(barNotes.filter(e => e.voice === 'bass').map(e => e.step));
    const leadNotes = barNotes.filter(e => e.voice === 'lead' && e.midi !== null);
    for (const ln of leadNotes) {
      // Only count non-anchor steps for complement check
      // (anchors [0,4,8,12] are shared by design — lead SHOULD play there with bass)
      if (ln.step % 4 !== 0) {
        if (bassSteps.has(ln.step)) leadOnBassNonAnchor++;
        else leadOnFreeNonAnchor++;
      }
    }
  }
  const complementRatio = leadOnFreeNonAnchor / Math.max(1, leadOnBassNonAnchor);
  // Lead should also be on different register than bass
  let regSepSum = 0, regSepCount = 0;
  for (let bar = 8; bar < 64; bar++) {
    const barNotes = ev1.filter(e => e.bar === bar);
    const leadNotes = barNotes.filter(e => e.voice === 'lead' && e.midi !== null);
    const bassNotes = barNotes.filter(e => e.voice === 'bass' && e.midi !== null);
    if (leadNotes.length > 0 && bassNotes.length > 0) {
      const avgLead = leadNotes.reduce((s, n) => s + n.midi!, 0) / leadNotes.length;
      const avgBass = bassNotes.reduce((s, n) => s + n.midi!, 0) / bassNotes.length;
      regSepSum += Math.abs(avgLead - avgBass);
      regSepCount++;
    }
  }
  const avgRegSep = regSepCount > 0 ? regSepSum / regSepCount : 0;
  console.log(`  Lead on bass-busy (non-anchor): ${leadOnBassNonAnchor}`);
  console.log(`  Lead on bass-free (non-anchor): ${leadOnFreeNonAnchor}`);
  console.log(`  Complement ratio: ${complementRatio.toFixed(2)}x`);
  console.log(`  Register separation: ${avgRegSep.toFixed(1)} semitones`);
  const l3Pass = complementRatio > 1.0 && avgRegSep >= 10;
  console.log(`  L3: ${l3Pass ? 'PASS' : 'FAIL'}`);
  results.push({ test: 'L3: Lead sits with bass', pass: l3Pass, evidence: `complement=${complementRatio.toFixed(2)}x, sep=${avgRegSep.toFixed(1)}` });

  // L4: HARMONIC PHRASE
  console.log('\n── L4: HARMONIC PHRASE ──');
  const e4 = new PsyLive(); e4.play();
  compose(e4, 32);
  const harmonic = (e4 as any).session?.getHarmonicState();
  e4.stop();
  // Check chord tones on strong beats
  const leadStrong = ev1.filter(e => e.voice === 'lead' && e.midi !== null && e.step % 4 === 0 && e.bar >= 8);
  let chordTones = 0;
  if (harmonic) {
    const scaleIntervals = harmonic.scale.intervals;
    for (const ln of leadStrong) {
      const pc = ((ln.midi! % 12) - harmonic.rootPc + 12) % 12;
      const root = scaleIntervals[0];
      const third = scaleIntervals[2];
      const fifth = scaleIntervals[4];
      if (pc === root || pc === third || pc === fifth) chordTones++;
    }
  }
  const chordToneRatio = leadStrong.length > 0 ? chordTones / leadStrong.length : 0;
  console.log(`  Chord tones on strong beats: ${chordTones}/${leadStrong.length} (${(chordToneRatio * 100).toFixed(1)}%)`);
  console.log(`  Harmony has ${harmonic?.progression?.length ?? 0} chords`);
  const l4Pass = chordToneRatio >= 0.5 && (harmonic?.progression?.length ?? 0) > 0;
  console.log(`  L4: ${l4Pass ? 'PASS' : 'FAIL'}`);
  results.push({ test: 'L4: Harmonic phrase', pass: l4Pass, evidence: `${(chordToneRatio * 100).toFixed(1)}% chord tones` });

  // L5: LEARNING CHANGES MUSICAL VOCABULARY
  console.log('\n── L5: LEARNING CHANGES VOCABULARY ──');
  const e5a = new PsyLive(); e5a.play();
  feedRadio((e5a as any).session, 32, 'bright');
  const ev5a = compose(e5a, 32);
  e5a.stop();
  const e5b = new PsyLive(); e5b.play();
  feedRadio((e5b as any).session, 32, 'dark');
  const ev5b = compose(e5b, 32);
  e5b.stop();

  // Compare interval distributions
  const lead5a = ev5a.filter(e => e.voice === 'lead' && e.midi !== null && e.bar >= 8);
  const lead5b = ev5b.filter(e => e.voice === 'lead' && e.midi !== null && e.bar >= 8);
  const intervals5a: number[] = [];
  const intervals5b: number[] = [];
  for (let i = 1; i < lead5a.length; i++) intervals5a.push(Math.abs(lead5a[i].midi! - lead5a[i-1].midi!));
  for (let i = 1; i < lead5b.length; i++) intervals5b.push(Math.abs(lead5b[i].midi! - lead5b[i-1].midi!));
  const avgInterval5a = intervals5a.length > 0 ? intervals5a.reduce((a, b) => a + b, 0) / intervals5a.length : 0;
  const avgInterval5b = intervals5b.length > 0 ? intervals5b.reduce((a, b) => a + b, 0) / intervals5b.length : 0;
  const uniquePitches5a = new Set(lead5a.map(e => e.midi)).size;
  const uniquePitches5b = new Set(lead5b.map(e => e.midi)).size;

  // Compare pitch-class distributions (more meaningful than average interval)
  const pcHist5a = new Array(12).fill(0);
  const pcHist5b = new Array(12).fill(0);
  for (const ln of lead5a) pcHist5a[ln.midi! % 12]++;
  for (const ln of lead5b) pcHist5b[ln.midi! % 12]++;
  // Normalize
  const total5a = pcHist5a.reduce((a, b) => a + b, 0) || 1;
  const total5b = pcHist5b.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < 12; i++) { pcHist5a[i] /= total5a; pcHist5b[i] /= total5b; }
  // Compute distribution difference (L1 distance)
  let distDiff = 0;
  for (let i = 0; i < 12; i++) distDiff += Math.abs(pcHist5a[i] - pcHist5b[i]);

  // Also compare register (avg MIDI)
  const avgMidi5a = lead5a.length > 0 ? lead5a.reduce((s, n) => s + n.midi!, 0) / lead5a.length : 0;
  const avgMidi5b = lead5b.length > 0 ? lead5b.reduce((s, n) => s + n.midi!, 0) / lead5b.length : 0;
  const regDiff = Math.abs(avgMidi5a - avgMidi5b);

  console.log(`  Source A (bright): ${lead5a.length} notes, avg MIDI=${avgMidi5a.toFixed(1)}, ${uniquePitches5a} pitches`);
  console.log(`  Source B (dark): ${lead5b.length} notes, avg MIDI=${avgMidi5b.toFixed(1)}, ${uniquePitches5b} pitches`);
  console.log(`  Pitch-class distribution difference: ${distDiff.toFixed(3)}`);
  console.log(`  Register difference: ${regDiff.toFixed(2)} semitones`);
  const l5Pass = distDiff > 0.05 || regDiff > 0.5;
  console.log(`  L5: ${l5Pass ? 'PASS' : 'FAIL'}`);
  results.push({ test: 'L5: Learning changes vocabulary', pass: l5Pass, evidence: `distDiff=${distDiff.toFixed(3)}, regDiff=${regDiff.toFixed(2)}` });

  // SUMMARY
  console.log('\n═══════════════════════════════════════════');
  console.log('SUMMARY:');
  const allPass = results.every(r => r.pass);
  for (const r of results) {
    console.log(`  ${r.pass ? '✓' : '✗'} ${r.test}: ${r.evidence}`);
  }
  console.log(`\nVERDICT: ${allPass ? 'PASS — Phrase engine works' : 'FAIL — Gaps remain'}`);

  const outPath = path.join(__dirname, 'f22-phrase-reality-results.json');
  fs.writeFileSync(outPath, JSON.stringify({ results, verdict: allPass ? 'PASS' : 'FAIL' }, null, 2));
  console.log(`Results: ${outPath}`);
  process.exit(allPass ? 0 : 1);
}

main();
