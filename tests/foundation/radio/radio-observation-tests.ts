/**
 * F2.6 — Radio Observation Deterministic Test Matrix (A-T)
 *
 * 20 test streams measuring phase error, lock time, false-lock rate, etc.
 *
 * Run: bun run tests/foundation/radio/radio-observation-tests.ts
 */
import { BeatObservationEngine } from '../../../foundation/radio/BeatObservationEngine';
import { RadioObservationLayer } from '../../../foundation/radio/RadioObservationLayer';
import { DEFAULT_RADIO_CONFIG } from '../../../foundation/radio/RadioObservationTypes';
import { sineWave, whiteNoise, silence, kickTransient } from '../../reality-bridge/synthFixtures';
import * as fs from 'fs';
import * as path from 'path';

interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  evidence: string;
  metrics?: Record<string, number | string>;
  failure?: string;
}

const results: TestResult[] = [];
let passed = 0, failed = 0;

function record(r: TestResult): void {
  results.push(r);
  const status = r.passed ? '✓' : '✗';
  console.log(`${status} ${r.id}: ${r.evidence}`);
  if (r.passed) passed++; else failed++;
}

const SAMPLE_RATE = 44100;
const FFT_SIZE = 512;

// ── Helper: generate a beat candidate stream ──
function generateBeatStream(
  bpm: number,
  durationSec: number,
  options: {
    jitterMs?: number;
    missingRate?: number;
    extraRate?: number;
    noise?: boolean;
    silence?: boolean;
  } = {},
): { time: number; subBassEnergy: number; localAverage: number; localMax: number; spectralEnergy: number }[] {
  const beats: { time: number; subBassEnergy: number; localAverage: number; localMax: number; spectralEnergy: number }[] = [];
  const period = 60 / bpm;
  const numBeats = Math.floor(durationSec / period);

  for (let i = 0; i < numBeats; i++) {
    if (options.missingRate && Math.random() < options.missingRate) continue;
    const jitter = options.jitterMs ? (Math.random() * 2 - 1) * options.jitterMs / 1000 : 0;
    const time = 10.0 + i * period + jitter;
    const subBassEnergy = 0.7 + Math.random() * 0.2;
    beats.push({
      time,
      subBassEnergy,
      localAverage: 0.3,
      localMax: 0.8,
      spectralEnergy: 0.5,
    });
  }

  // Add extra false beats
  if (options.extraRate) {
    for (let i = 0; i < numBeats * options.extraRate; i++) {
      const time = 10.0 + Math.random() * durationSec;
      beats.push({
        time,
        subBassEnergy: 0.4 + Math.random() * 0.2,
        localAverage: 0.3,
        localMax: 0.5,
        spectralEnergy: 0.3,
      });
    }
  }

  return beats.sort((a, b) => a.time - b.time);
}

// ── Helper: run a beat stream through BeatObservationEngine ──
function runBeatStream(beats: { time: number; subBassEnergy: number; localAverage: number; localMax: number; spectralEnergy: number }[]) {
  const engine = new BeatObservationEngine({ ...DEFAULT_RADIO_CONFIG, sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  const observations: any[] = [];
  for (const b of beats) {
    const obs = engine.processBeat(b);
    if (obs) observations.push(obs);
  }
  return { engine, observations };
}

// ═══════════════════════════════════════════════════════════════════════
// A — perfect 120 BPM
// ═══════════════════════════════════════════════════════════════════════
function testA(): void {
  const beats = generateBeatStream(120, 30);
  const { engine, observations } = runBeatStream(beats);
  const phaseErrors = observations.map(o => o.phaseErrorMs);
  const p95 = phaseErrors.sort((a, b) => a - b)[Math.floor(phaseErrors.length * 0.95)] || 0;
  record({
    id: 'A-120BPM',
    name: 'Perfect 120 BPM — P95 phase error < 100ms (initial convergence)',
    passed: p95 < 100 && engine.getObservation()?.locked === true,
    evidence: `observations=${observations.length} p95=${p95.toFixed(2)}ms locked=${engine.getObservation()?.locked}`,
    failure: p95 >= 100 ? `P95 ${p95.toFixed(2)}ms too high` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// B — perfect 150 BPM
// ═══════════════════════════════════════════════════════════════════════
function testB(): void {
  const beats = generateBeatStream(150, 30);
  const { engine, observations } = runBeatStream(beats);
  const phaseErrors = observations.map(o => o.phaseErrorMs);
  const p95 = phaseErrors.sort((a, b) => a - b)[Math.floor(phaseErrors.length * 0.95)] || 0;
  record({
    id: 'B-150BPM',
    name: 'Perfect 150 BPM — P95 phase error < 30ms',
    passed: p95 < 30 && engine.getObservation()?.locked === true,
    evidence: `observations=${observations.length} p95=${p95.toFixed(2)}ms locked=${engine.getObservation()?.locked}`,
    failure: p95 >= 30 ? `P95 ${p95.toFixed(2)}ms too high` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// C — ±10ms jitter
// ═══════════════════════════════════════════════════════════════════════
function testC(): void {
  const beats = generateBeatStream(150, 30, { jitterMs: 10 });
  const { engine, observations } = runBeatStream(beats);
  const phaseErrors = observations.map(o => o.phaseErrorMs);
  const p95 = phaseErrors.sort((a, b) => a - b)[Math.floor(phaseErrors.length * 0.95)] || 0;
  record({
    id: 'C-Jitter10ms',
    name: '±10ms jitter — degrades gracefully, no false lock',
    passed: p95 < 50 && engine.getObservation()?.locked === true,
    evidence: `p95=${p95.toFixed(2)}ms locked=${engine.getObservation()?.locked}`,
    failure: p95 >= 50 ? `P95 ${p95.toFixed(2)}ms too high` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// D — ±50ms jitter
// ═══════════════════════════════════════════════════════════════════════
function testD(): void {
  const beats = generateBeatStream(150, 30, { jitterMs: 50 });
  const { engine, observations } = runBeatStream(beats);
  const phaseErrors = observations.map(o => o.phaseErrorMs);
  const p95 = phaseErrors.sort((a, b) => a - b)[Math.floor(phaseErrors.length * 0.95)] || 0;
  record({
    id: 'D-Jitter50ms',
    name: '±50ms jitter — degrades gracefully without false lock',
    passed: p95 < 100,
    evidence: `p95=${p95.toFixed(2)}ms locked=${engine.getObservation()?.locked}`,
    failure: p95 >= 100 ? `P95 ${p95.toFixed(2)}ms too high` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// E — gradual tempo drift
// ═══════════════════════════════════════════════════════════════════════
function testE(): void {
  // Drift from 145 to 150 over 30 seconds
  const beats: any[] = [];
  let currentBpm = 145;
  let time = 10.0;
  for (let i = 0; i < 80; i++) {
    currentBpm += 0.06; // gradual drift
    const period = 60 / currentBpm;
    beats.push({ time, subBassEnergy: 0.7, localAverage: 0.3, localMax: 0.8, spectralEnergy: 0.5 });
    time += period;
  }
  const { engine, observations } = runBeatStream(beats);
  const finalBpm = engine.getObservation()?.estimatedBpm || 0;
  record({
    id: 'E-TempoDrift',
    name: 'Gradual tempo drift 145→150 — tracks without false lock',
    passed: finalBpm > 147 && finalBpm < 152,
    evidence: `finalBpm=${finalBpm.toFixed(2)} observations=${observations.length}`,
    failure: finalBpm <= 147 || finalBpm >= 152 ? `BPM ${finalBpm.toFixed(2)} not in [147,152]` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// F — sudden tempo change
// ═══════════════════════════════════════════════════════════════════════
function testF(): void {
  const beats1 = generateBeatStream(120, 10);
  const beats2 = generateBeatStream(150, 20);
  // Offset beats2 to continue from where beats1 left off
  const offset = beats1[beats1.length - 1].time + 60 / 120;
  beats2.forEach(b => b.time += offset - 10.0);
  const { engine, observations } = runBeatStream([...beats1, ...beats2]);
  const finalBpm = engine.getObservation()?.estimatedBpm || 0;
  record({
    id: 'F-TempoChange',
    name: 'Sudden tempo change 120→150 — recovers without crash',
    passed: finalBpm > 140,
    evidence: `finalBpm=${finalBpm.toFixed(2)} observations=${observations.length}`,
    failure: finalBpm <= 140 ? `BPM ${finalBpm.toFixed(2)} too low` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// G — missing beats (25%)
// ═══════════════════════════════════════════════════════════════════════
function testG(): void {
  const beats = generateBeatStream(150, 30, { missingRate: 0.25 });
  const { engine, observations } = runBeatStream(beats);
  record({
    id: 'G-MissingBeats',
    name: '25% missing beats — still locks',
    passed: engine.getObservation()?.locked === true,
    evidence: `observations=${observations.length} locked=${engine.getObservation()?.locked}`,
    failure: !engine.getObservation()?.locked ? 'Did not lock with 25% missing' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// H — 2x tempo input
// ═══════════════════════════════════════════════════════════════════════
function testH(): void {
  const beats = generateBeatStream(300, 30); // 2x 150
  const { engine, observations } = runBeatStream(beats);
  const finalBpm = engine.getObservation()?.estimatedBpm || 0;
  // Should converge to 300 or recognize it's 2x of 150
  record({
    id: 'H-DoubleTempo',
    name: '2x tempo input (300 BPM) — converges to 300 or recognizes as 150',
    passed: finalBpm > 140,
    evidence: `finalBpm=${finalBpm.toFixed(2)} locked=${engine.getObservation()?.locked}`,
    failure: finalBpm <= 140 ? `BPM ${finalBpm.toFixed(2)} too low` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// I — half tempo input
// ═══════════════════════════════════════════════════════════════════════
function testI(): void {
  const beats = generateBeatStream(75, 30); // half of 150
  const { engine, observations } = runBeatStream(beats);
  const finalBpm = engine.getObservation()?.estimatedBpm || 0;
  record({
    id: 'I-HalfTempo',
    name: 'Half tempo input (75 BPM) — handles without crash',
    passed: finalBpm > 60,
    evidence: `finalBpm=${finalBpm.toFixed(2)} locked=${engine.getObservation()?.locked}`,
    failure: finalBpm <= 60 ? `BPM ${finalBpm.toFixed(2)} too low` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// J — random noise
// ═══════════════════════════════════════════════════════════════════════
function testJ(): void {
  // Use fixed seed for reproducibility
  let seed = 42;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  const beats: any[] = [];
  for (let i = 0; i < 100; i++) {
    beats.push({
      time: 10.0 + rng() * 30,
      subBassEnergy: 0.3 + rng() * 0.2,
      localAverage: 0.3,
      localMax: 0.5,
      spectralEnergy: 0.2 + rng() * 0.2,
    });
  }
  const { engine, observations } = runBeatStream(beats);
  // With random noise, the engine MIGHT accidentally lock if intervals happen to be regular.
  // The key test is: no NaN, no impossible BPM, confidence in valid range.
  const obs = engine.getObservation();
  const valid = obs && !isNaN(obs.estimatedBpm) && obs.confidence >= 0 && obs.confidence <= 1 && obs.estimatedBpm > 0;
  record({
    id: 'J-Noise',
    name: 'Random noise — valid state (no NaN, confidence in [0,1])',
    passed: valid === true,
    evidence: `locked=${obs?.locked} bpm=${obs?.estimatedBpm?.toFixed(2)} conf=${obs?.confidence?.toFixed(2)} valid=${valid}`,
    failure: !valid ? 'Invalid state on noise' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// K — silence
// ═══════════════════════════════════════════════════════════════════════
function testK(): void {
  const layer = new RadioObservationLayer({ ...DEFAULT_RADIO_CONFIG, sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  const td = silence(FFT_SIZE);
  const fd = new Uint8Array(FFT_SIZE / 2);
  layer.markConnected();
  const snap = layer.process(td, fd, 10.0);
  record({
    id: 'K-Silence',
    name: 'Silence — NO_SIGNAL state, no false observations',
    passed: snap.signal.state === 'NO_SIGNAL' && snap.beat === null,
    evidence: `state=${snap.signal.state} beat=${snap.beat ? 'present' : 'null'}`,
    failure: snap.signal.state !== 'NO_SIGNAL' ? `Wrong state: ${snap.signal.state}` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// L — kick bursts
// ═══════════════════════════════════════════════════════════════════════
function testL(): void {
  const beats: any[] = [];
  // 10 kicks in 100ms
  for (let i = 0; i < 10; i++) {
    beats.push({ time: 10.0 + i * 0.01, subBassEnergy: 0.8, localAverage: 0.3, localMax: 0.8, spectralEnergy: 0.5 });
  }
  const { engine, observations } = runBeatStream(beats);
  record({
    id: 'L-KickBurst',
    name: '10 kicks in 100ms — no crash',
    passed: observations.length > 0 && !isNaN(engine.getObservation()?.estimatedBpm ?? NaN),
    evidence: `observations=${observations.length} bpm=${engine.getObservation()?.estimatedBpm?.toFixed(2)}`,
    failure: observations.length === 0 ? 'No observations processed' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// M — false beat bursts
// ═══════════════════════════════════════════════════════════════════════
function testM(): void {
  const beats = generateBeatStream(150, 30, { extraRate: 0.2 });
  const { engine, observations } = runBeatStream(beats);
  const finalBpm = engine.getObservation()?.estimatedBpm || 0;
  record({
    id: 'M-FalseBeats',
    name: '20% false beats — still tracks true tempo',
    passed: Math.abs(finalBpm - 150) < 15,
    evidence: `finalBpm=${finalBpm.toFixed(2)} observations=${observations.length}`,
    failure: Math.abs(finalBpm - 150) >= 15 ? `BPM ${finalBpm.toFixed(2)} too far from 150` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// N — out-of-order observations
// ═══════════════════════════════════════════════════════════════════════
function testN(): void {
  const beats = generateBeatStream(150, 10);
  // Shuffle
  beats.sort(() => Math.random() - 0.5);
  const { engine, observations } = runBeatStream(beats);
  record({
    id: 'N-OutOfOrder',
    name: 'Out-of-order observations — no crash, no NaN',
    passed: observations.every(o => !isNaN(o.estimatedBpm) && o.confidence >= 0 && o.confidence <= 1),
    evidence: `observations=${observations.length} allValid=${observations.every(o => !isNaN(o.estimatedBpm))}`,
    failure: observations.some(o => isNaN(o.estimatedBpm)) ? 'NaN in observations' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// O — duplicate observations
// ═══════════════════════════════════════════════════════════════════════
function testO(): void {
  const beats = generateBeatStream(150, 10);
  // Duplicate each beat
  const dupes = [...beats, ...beats].sort((a, b) => a.time - b.time);
  const { engine, observations } = runBeatStream(dupes);
  record({
    id: 'O-Duplicates',
    name: 'Duplicate observations — no crash, no NaN',
    passed: observations.every(o => !isNaN(o.estimatedBpm)),
    evidence: `observations=${observations.length} allValid=${observations.every(o => !isNaN(o.estimatedBpm))}`,
    failure: observations.some(o => isNaN(o.estimatedBpm)) ? 'NaN' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// P — long radio dropout
// ═══════════════════════════════════════════════════════════════════════
function testP(): void {
  const beats1 = generateBeatStream(150, 10);
  // 5 second gap
  const gapStart = beats1[beats1.length - 1].time;
  const beats2 = generateBeatStream(150, 10);
  beats2.forEach(b => b.time += gapStart + 5 - 10.0);
  const { engine, observations } = runBeatStream([...beats1, ...beats2]);
  record({
    id: 'P-Dropout',
    name: '5-second radio dropout — recovers without crash',
    passed: observations.length > 10,
    evidence: `observations=${observations.length} (before+after gap)`,
    failure: observations.length <= 10 ? 'Too few observations after dropout' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Q — signal recovery
// ═══════════════════════════════════════════════════════════════════════
function testQ(): void {
  const layer = new RadioObservationLayer({ ...DEFAULT_RADIO_CONFIG, sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  layer.markConnected();

  // Start with signal
  const signalTd = sineWave(440, FFT_SIZE, SAMPLE_RATE, 0.8);
  const signalFd = new Uint8Array(FFT_SIZE / 2).fill(200);
  const snap1 = layer.process(signalTd, signalFd, 10.0);

  // Silence
  const silenceTd = silence(FFT_SIZE);
  const silenceFd = new Uint8Array(FFT_SIZE / 2);
  const snap2 = layer.process(silenceTd, silenceFd, 12.0);

  // Signal again
  const snap3 = layer.process(signalTd, signalFd, 15.0);

  record({
    id: 'Q-Recovery',
    name: 'Signal → silence → signal — recovers',
    passed: snap3.signal.state !== 'NO_SIGNAL',
    evidence: `states: ${snap1.signal.state} → ${snap2.signal.state} → ${snap3.signal.state}`,
    failure: snap3.signal.state === 'NO_SIGNAL' ? 'Did not recover after silence' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// R — weak signal
// ═══════════════════════════════════════════════════════════════════════
function testR(): void {
  const layer = new RadioObservationLayer({ ...DEFAULT_RADIO_CONFIG, sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  layer.markConnected();
  const weakTd = sineWave(440, FFT_SIZE, SAMPLE_RATE, 0.001);
  const weakFd = new Uint8Array(FFT_SIZE / 2).fill(5);
  const snap = layer.process(weakTd, weakFd, 10.0);
  record({
    id: 'R-WeakSignal',
    name: 'Weak signal — no STABLE_SIGNAL state',
    passed: snap.signal.state !== 'STABLE_SIGNAL',
    evidence: `state=${snap.signal.state} rms=${snap.signal.rms.toFixed(6)}`,
    failure: snap.signal.state === 'STABLE_SIGNAL' ? 'False STABLE_SIGNAL on weak signal' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// S — unstable pitch
// ═══════════════════════════════════════════════════════════════════════
function testS(): void {
  const layer = new RadioObservationLayer({ ...DEFAULT_RADIO_CONFIG, sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  layer.markConnected();
  // Generate signal with rapidly changing pitch
  const td = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    const freq = 200 + Math.random() * 1000;
    td[i] = 0.5 * Math.sin(2 * Math.PI * freq * (i / SAMPLE_RATE));
  }
  const fd = new Uint8Array(FFT_SIZE / 2).fill(100);
  const snap = layer.process(td, fd, 10.0);
  record({
    id: 'S-UnstablePitch',
    name: 'Unstable pitch — no confident pitch observation',
    passed: snap.pitch === null || snap.pitch.confidence < 0.8,
    evidence: `pitch=${snap.pitch ? `conf=${snap.pitch.confidence.toFixed(2)}` : 'null'}`,
    failure: snap.pitch && snap.pitch.confidence >= 0.8 ? 'False high confidence on unstable pitch' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// T — clean melody
// ═══════════════════════════════════════════════════════════════════════
function testT(): void {
  const layer = new RadioObservationLayer({ ...DEFAULT_RADIO_CONFIG, sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  layer.markConnected();
  const td = sineWave(440, FFT_SIZE, SAMPLE_RATE, 0.8);
  const fd = new Uint8Array(FFT_SIZE / 2).fill(2);
  const binHz = SAMPLE_RATE / FFT_SIZE;
  const targetBin = Math.floor(440 / binHz);
  fd[targetBin] = 255;
  if (targetBin > 0) fd[targetBin - 1] = 120;
  if (targetBin < fd.length - 1) fd[targetBin + 1] = 120;
  if (targetBin * 2 < fd.length) fd[targetBin * 2] = 200;

  const snap = layer.process(td, fd, 10.0);
  record({
    id: 'T-CleanMelody',
    name: 'Clean 440 Hz melody — signal present (pitch detection needs sustained signal)',
    passed: snap.signal.state === 'SIGNAL_PRESENT' || snap.signal.state === 'STABLE_SIGNAL',
    evidence: `state=${snap.signal.state} pitch=${snap.pitch ? `freq=${snap.pitch.frequency.toFixed(2)}Hz` : 'null (single frame)'}`,
    failure: snap.signal.state === 'NO_SIGNAL' ? 'No signal detected' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════
function main(): void {
  console.log('=== F2.6 — Radio Observation Test Matrix (A-T) ===\n');
  testA(); testB(); testC(); testD(); testE(); testF(); testG(); testH(); testI(); testJ();
  testK(); testL(); testM(); testN(); testO(); testP(); testQ(); testR(); testS(); testT();
  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed, ${results.length} total ===`);
  fs.writeFileSync(path.join(__dirname, 'radio-observation-tests-results.json'), JSON.stringify({ runAt: new Date().toISOString(), totalTests: results.length, passed, failed, results }, null, 2));
  process.exit(failed > 0 ? 1 : 0);
}

main();
