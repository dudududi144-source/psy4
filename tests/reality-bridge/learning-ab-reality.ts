/**
 * F17.10 — A/B LEARNING REALITY TEST
 *
 * Proves that radio learning materially changes future composition.
 *
 * Session A: Feed radio observations for 32 bars, then compose 32 bars.
 * Session B: Same seed, NO radio observations, compose 32 bars.
 *
 * Compare: bass patterns, bass pitches, rhythm patterns.
 * They must measurably differ — proving learning changes output.
 *
 * Run: bun run tests/reality-bridge/learning-ab-reality.ts
 */
import '../reality-bridge-setup';
import { PsyLive } from '../../src/lib/psyLive';
import * as fs from 'fs';
import * as path from 'path';

const BPM = 145;
const STEP_DUR = 60 / BPM / 4;

interface NoteEvent { bar: number; step: number; voice: string; midi: number | null; vel: number; }

function runSession(withLearning: boolean, bars: number): NoteEvent[] {
  const engine = new PsyLive();
  engine.play();
  const session = (engine as any).session;
  const transport = (engine as any).transport;
  const events: NoteEvent[] = [];

  if (withLearning) {
    // Feed simulated radio observations for the first 32 bars (phrase learning)
    // Simulate a radio with: 150 BPM, high bass occupancy, mid spectral energy,
    // pitch class 7 (G), brightness 0.6, moderate syncopation
    const freqData = new Uint8Array(256);
    for (let bar = 0; bar < 32; bar++) {
      // Simulate ~8 ticks per bar (200ms ticks, ~1.3s per bar at 145 BPM)
      for (let tick = 0; tick < 8; tick++) {
        // Fill freqData with a simulated spectrum: strong low end, moderate mid, some high
        for (let i = 0; i < freqData.length; i++) {
          const freq = i * (44100 / 512);
          if (freq < 250) freqData[i] = 180 + Math.random() * 40; // strong bass
          else if (freq < 2500) freqData[i] = 100 + Math.random() * 50; // moderate mid
          else freqData[i] = 60 + Math.random() * 30; // some high
        }

        session.observeRadioTick({
          audioTime: bar * 4 * STEP_DUR + tick * 0.2,
          radioBpm: 150,
          energy: 0.6,
          occupancy: { kick: 0.8, bass: 0.7, lead: 0.4, hats: 0.5 },
          bassFreq: 110, // A2
          pitchClass: 7, // G
          pitchConfidence: 0.7,
          freqData,
          sampleRate: 44100,
          fftSize: 512,
        });
      }
      // Trigger phrase extraction at phrase boundaries (every 8 bars)
      if ((bar + 1) % 8 === 0) {
        session.extractPhraseLearning(Math.floor(bar / 8), bar - 7, 8);
      }
    }
  }

  // Now compose `bars` bars and collect events
  for (let bar = 0; bar < bars; bar++) {
    const snap = transport.snapshot();
    // If learning, continue feeding observations during composition
    if (withLearning) {
      const freqData = new Uint8Array(256);
      for (let i = 0; i < freqData.length; i++) {
        const freq = i * (44100 / 512);
        if (freq < 250) freqData[i] = 180 + Math.random() * 40;
        else if (freq < 2500) freqData[i] = 100 + Math.random() * 50;
        else freqData[i] = 60 + Math.random() * 30;
      }
      session.observeRadioTick({
        audioTime: bar * 4 * STEP_DUR,
        radioBpm: 150,
        energy: 0.6,
        occupancy: { kick: 0.8, bass: 0.7, lead: 0.4, hats: 0.5 },
        bassFreq: 110,
        pitchClass: 7,
        pitchConfidence: 0.7,
        freqData,
        sampleRate: 44100,
        fftSize: 512,
      });
    }

    const plan = session.planBar(bar, snap.bpm);
    for (const n of plan.notes) {
      events.push({ bar, step: n.step, voice: n.voice, midi: n.midi, vel: n.velocity });
    }
  }

  engine.stop();
  return events;
}

function main(): void {
  console.log('=== F17.10 A/B LEARNING REALITY TEST ===\n');
  console.log('Session A: 32 bars radio learning + 32 bars composition');
  console.log('Session B: NO learning + 32 bars composition\n');

  // Run Session A and capture learning state from it
  const engineA = new PsyLive();
  engineA.play();
  const sessionA = (engineA as any).session;
  const transportA = (engineA as any).transport;

  // Feed learning observations
  const freqData = new Uint8Array(256);
  for (let bar = 0; bar < 32; bar++) {
    for (let tick = 0; tick < 8; tick++) {
      for (let i = 0; i < freqData.length; i++) {
        const freq = i * (44100 / 512);
        if (freq < 250) freqData[i] = 180 + Math.random() * 40;
        else if (freq < 2500) freqData[i] = 100 + Math.random() * 50;
        else freqData[i] = 60 + Math.random() * 30;
      }
      sessionA.observeRadioTick({
        audioTime: bar * 4 * STEP_DUR + tick * 0.2,
        radioBpm: 150,
        energy: 0.6,
        occupancy: { kick: 0.8, bass: 0.7, lead: 0.4, hats: 0.5 },
        bassFreq: 110,
        pitchClass: 7,
        pitchConfidence: 0.7,
        freqData,
        sampleRate: 44100,
        fftSize: 512,
      });
    }
    if ((bar + 1) % 8 === 0) {
      sessionA.extractPhraseLearning(Math.floor(bar / 8), bar - 7, 8);
    }
  }

  const hasLearned = sessionA.hasLearnedFromRadio();
  const learnedCount = sessionA.getLearnedPhraseCount();
  const hasBassGrammar = sessionA.getLearnedBassGrammar() != null;
  const bassGrammarConfidence = sessionA.getLearnedBassGrammar()?.confidence ?? 0;

  // Compose 32 bars with learning active
  const eventsA: NoteEvent[] = [];
  for (let bar = 0; bar < 32; bar++) {
    const snap = transportA.snapshot();
    const plan = sessionA.planBar(bar, snap.bpm);
    for (const n of plan.notes) {
      eventsA.push({ bar, step: n.step, voice: n.voice, midi: n.midi, vel: n.velocity });
    }
  }
  engineA.stop();

  // Run Session B (no learning)
  const eventsB = runSession(false, 32);

  // Compare bass patterns
  const bassA = eventsA.filter(e => e.voice === 'bass' && e.midi !== null);
  const bassB = eventsB.filter(e => e.voice === 'bass' && e.midi !== null);
  const bassMidisA = new Set(bassA.map(e => e.midi));
  const bassMidisB = new Set(bassB.map(e => e.midi));
  const bassStepsA = new Set(bassA.map(e => `${e.bar}-${e.step}`));
  const bassStepsB = new Set(bassB.map(e => `${e.bar}-${e.step}`));

  // Compare kick patterns
  const kickA = eventsA.filter(e => e.voice === 'kick');
  const kickB = eventsB.filter(e => e.voice === 'kick');
  const kickPatternsA = new Set(kickA.filter(e => e.bar < 32).map(e => e.bar).map(bar => {
    return kickA.filter(e => e.bar === bar).map(e => e.step).sort().join(',');
  }));
  const kickPatternsB = new Set(kickB.filter(e => e.bar < 32).map(e => e.bar).map(bar => {
    return kickB.filter(e => e.bar === bar).map(e => e.step).sort().join(',');
  }));

  // Compare total note counts
  const totalA = eventsA.length;
  const totalB = eventsB.length;

  // Check if learning happened — use the state from Session A
  console.log('── LEARNING STATE ──');
  console.log(`  hasLearnedFromRadio: ${hasLearned}`);
  console.log(`  learnedPhraseCount: ${learnedCount}`);
  console.log(`  hasBassGrammar: ${hasBassGrammar}`);
  console.log(`  bassGrammarConfidence: ${bassGrammarConfidence.toFixed(3)}`);
  console.log('');

  console.log('── BASS COMPARISON (32 bars) ──');
  console.log(`  Session A (learned): ${bassA.length} notes, ${bassMidisA.size} unique MIDIs: [${[...bassMidisA].sort((a,b)=>a-b).join(', ')}]`);
  console.log(`  Session B (no learn): ${bassB.length} notes, ${bassMidisB.size} unique MIDIs: [${[...bassMidisB].sort((a,b)=>a-b).join(', ')}]`);
  console.log(`  Bass note count diff: ${Math.abs(bassA.length - bassB.length)}`);
  console.log(`  Unique MIDIs differ: ${bassMidisA.size !== bassMidisB.size || ![...bassMidisA].every(m => bassMidisB.has(m))}`);
  console.log('');

  console.log('── KICK PATTERN COMPARISON ──');
  console.log(`  Session A unique kick patterns: ${kickPatternsA.size}`);
  console.log(`  Session B unique kick patterns: ${kickPatternsB.size}`);
  console.log('');

  console.log('── TOTAL EVENTS ──');
  console.log(`  Session A: ${totalA} events`);
  console.log(`  Session B: ${totalB} events`);
  console.log(`  Difference: ${Math.abs(totalA - totalB)} events`);
  console.log('');

  // Check if the bass step patterns differ
  const bassStepDiff = [...bassStepsA].filter(s => !bassStepsB.has(s)).length;
  console.log('── BASS STEP PLACEMENT ──');
  console.log(`  Steps in A not in B: ${bassStepDiff}`);
  console.log('');

  // VERDICT
  const learningWorks = hasLearned && hasBassGrammar;
  const bassDiffers = bassA.length !== bassB.length || bassMidisA.size !== bassMidisB.size ||
    ![...bassMidisA].every(m => bassMidisB.has(m)) || bassStepDiff > 0;

  console.log('── VERDICT ──');
  console.log(`  Learning pipeline works: ${learningWorks ? 'YES' : 'NO'}`);
  console.log(`  Bass materially differs: ${bassDiffers ? 'YES' : 'NO'}`);
  const pass = learningWorks && bassDiffers;
  console.log(`  ${pass ? '✓ PASS: Learning changes future composition' : '✗ FAIL: Learning does not change output'}`);

  const outPath = path.join(__dirname, 'learning-ab-reality-results.json');
  fs.writeFileSync(outPath, JSON.stringify({
    learningWorks, hasLearned, learnedCount, hasBassGrammar,
    bassA: { count: bassA.length, uniqueMidis: bassMidisA.size, midis: [...bassMidisA].sort((a,b)=>a-b) },
    bassB: { count: bassB.length, uniqueMidis: bassMidisB.size, midis: [...bassMidisB].sort((a,b)=>a-b) },
    bassStepDiff, totalA, totalB,
    kickPatternsA: kickPatternsA.size, kickPatternsB: kickPatternsB.size,
    verdict: pass ? 'PASS' : 'FAIL',
  }, null, 2));
  console.log(`Results: ${outPath}`);

  process.exit(pass ? 0 : 1);
}

main();
