/**
 * F2.7 — Radio Observation Adversarial Tests
 *
 * Designed to break the radio observation layer.
 * Goal: no crashes, no NaN, no negative confidence, no confidence > 1,
 * no impossible BPM, no false FOLLOWING state.
 *
 * Run: bun run tests/foundation/radio/radio-adversarial.ts
 */
import { BeatObservationEngine } from '../../../foundation/radio/BeatObservationEngine';
import { RadioObservationLayer } from '../../../foundation/radio/RadioObservationLayer';
import { DEFAULT_RADIO_CONFIG } from '../../../foundation/radio/RadioObservationTypes';
import { sineWave, silence, whiteNoise } from '../../reality-bridge/synthFixtures';
import * as fs from 'fs';
import * as path from 'path';

interface TestResult {
  id: string; name: string; passed: boolean; evidence: string; failure?: string;
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

// Helper: check validity of an observation
function isValid(obs: any): boolean {
  if (!obs) return true;
  if (isNaN(obs.estimatedBpm)) return false;
  if (obs.confidence < 0 || obs.confidence > 1) return false;
  if (obs.estimatedBpm < 0) return false;
  return true;
}

// ADV-1: 100 random beat bursts
function testADV1(): void {
  const engine = new BeatObservationEngine({ ...DEFAULT_RADIO_CONFIG, sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  let crashed = false;
  try {
    for (let i = 0; i < 100; i++) {
      engine.processBeat({
        time: 10.0 + Math.random() * 1.0,
        subBassEnergy: 0.5 + Math.random() * 0.5,
        localAverage: 0.3,
        localMax: 0.8,
        spectralEnergy: 0.5,
      });
    }
  } catch { crashed = true; }
  const obs = engine.getObservation();
  record({
    id: 'ADV-1-100Bursts',
    name: '100 random beat bursts — no crash, valid state',
    passed: !crashed && isValid(obs),
    evidence: `crashed=${crashed} bpm=${obs?.estimatedBpm?.toFixed(2)} valid=${isValid(obs)}`,
    failure: crashed ? 'Crashed' : (!isValid(obs) ? 'Invalid state' : undefined),
  });
}

// ADV-2: 500 duplicate observations
function testADV2(): void {
  const engine = new BeatObservationEngine({ ...DEFAULT_RADIO_CONFIG, sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  let crashed = false;
  try {
    for (let i = 0; i < 500; i++) {
      engine.processBeat({ time: 10.0, subBassEnergy: 0.7, localAverage: 0.3, localMax: 0.8, spectralEnergy: 0.5 });
    }
  } catch { crashed = true; }
  const obs = engine.getObservation();
  record({
    id: 'ADV-2-500Duplicates',
    name: '500 duplicate observations — no crash, valid state',
    passed: !crashed && isValid(obs),
    evidence: `crashed=${crashed} bpm=${obs?.estimatedBpm?.toFixed(2)} valid=${isValid(obs)}`,
    failure: crashed ? 'Crashed' : (!isValid(obs) ? 'Invalid state' : undefined),
  });
}

// ADV-3: out-of-order timestamps
function testADV3(): void {
  const engine = new BeatObservationEngine({ ...DEFAULT_RADIO_CONFIG, sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  const times = [20, 10, 30, 15, 25, 5, 35];
  let crashed = false;
  try {
    for (const t of times) {
      engine.processBeat({ time: t, subBassEnergy: 0.7, localAverage: 0.3, localMax: 0.8, spectralEnergy: 0.5 });
    }
  } catch { crashed = true; }
  const obs = engine.getObservation();
  record({
    id: 'ADV-3-OutOfOrder',
    name: 'Out-of-order timestamps — no crash, valid state',
    passed: !crashed && isValid(obs),
    evidence: `crashed=${crashed} valid=${isValid(obs)}`,
    failure: crashed ? 'Crashed' : undefined,
  });
}

// ADV-4: impossible timestamps (negative, NaN, Infinity)
function testADV4(): void {
  const engine = new BeatObservationEngine({ ...DEFAULT_RADIO_CONFIG, sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  let crashed = false;
  try {
    engine.processBeat({ time: -1, subBassEnergy: 0.7, localAverage: 0.3, localMax: 0.8, spectralEnergy: 0.5 });
    engine.processBeat({ time: NaN, subBassEnergy: 0.7, localAverage: 0.3, localMax: 0.8, spectralEnergy: 0.5 });
    engine.processBeat({ time: Infinity, subBassEnergy: 0.7, localAverage: 0.3, localMax: 0.8, spectralEnergy: 0.5 });
  } catch { crashed = true; }
  const obs = engine.getObservation();
  record({
    id: 'ADV-4-Impossible',
    name: 'Impossible timestamps (negative, NaN, Infinity) — no crash',
    passed: !crashed,
    evidence: `crashed=${crashed} valid=${isValid(obs)}`,
    failure: crashed ? 'Crashed on impossible input' : undefined,
  });
}

// ADV-5: tempo jumps 80→180→90
function testADV5(): void {
  const engine = new BeatObservationEngine({ ...DEFAULT_RADIO_CONFIG, sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  let crashed = false;
  try {
    // 80 BPM for 7 beats
    let t = 10.0;
    const p1 = 60 / 80;
    for (let i = 0; i < 7; i++) { engine.processBeat({ time: t, subBassEnergy: 0.7, localAverage: 0.3, localMax: 0.8, spectralEnergy: 0.5 }); t += p1; }
    // 180 BPM for 7 beats
    const p2 = 60 / 180;
    for (let i = 0; i < 7; i++) { engine.processBeat({ time: t, subBassEnergy: 0.7, localAverage: 0.3, localMax: 0.8, spectralEnergy: 0.5 }); t += p2; }
    // 90 BPM for 7 beats
    const p3 = 60 / 90;
    for (let i = 0; i < 7; i++) { engine.processBeat({ time: t, subBassEnergy: 0.7, localAverage: 0.3, localMax: 0.8, spectralEnergy: 0.5 }); t += p3; }
  } catch { crashed = true; }
  const obs = engine.getObservation();
  record({
    id: 'ADV-5-TempoJumps',
    name: 'Tempo jumps 80→180→90 — no crash, BPM in valid range',
    passed: !crashed && isValid(obs) && obs!.estimatedBpm >= 60 && obs!.estimatedBpm <= 200,
    evidence: `crashed=${crashed} bpm=${obs?.estimatedBpm?.toFixed(2)}`,
    failure: crashed ? 'Crashed' : undefined,
  });
}

// ADV-6: half/double ambiguity
function testADV6(): void {
  const engine = new BeatObservationEngine({ ...DEFAULT_RADIO_CONFIG, sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  let crashed = false;
  try {
    // Alternate between 150 and 75 BPM intervals
    let t = 10.0;
    for (let i = 0; i < 20; i++) {
      engine.processBeat({ time: t, subBassEnergy: 0.7, localAverage: 0.3, localMax: 0.8, spectralEnergy: 0.5 });
      t += i % 2 === 0 ? 60/150 : 60/75;
    }
  } catch { crashed = true; }
  const obs = engine.getObservation();
  record({
    id: 'ADV-6-HalfDouble',
    name: 'Half/double tempo ambiguity — no crash, valid state',
    passed: !crashed && isValid(obs),
    evidence: `crashed=${crashed} bpm=${obs?.estimatedBpm?.toFixed(2)}`,
    failure: crashed ? 'Crashed' : undefined,
  });
}

// ADV-7: silence → signal → silence
function testADV7(): void {
  const layer = new RadioObservationLayer({ ...DEFAULT_RADIO_CONFIG, sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  layer.markConnected();
  const sig = sineWave(440, FFT_SIZE, SAMPLE_RATE, 0.8);
  const sigFd = new Uint8Array(FFT_SIZE / 2).fill(200);
  const sil = silence(FFT_SIZE);
  const silFd = new Uint8Array(FFT_SIZE / 2);

  const s1 = layer.process(sig, sigFd, 10.0);
  const s2 = layer.process(sil, silFd, 11.0);
  const s3 = layer.process(sil, silFd, 12.0);
  const s4 = layer.process(sig, sigFd, 13.0);

  record({
    id: 'ADV-7-SilenceSignalSilence',
    name: 'Silence → signal → silence → signal — no crash',
    passed: s1.signal.state !== 'NO_SIGNAL' && s4.signal.state !== 'NO_SIGNAL',
    evidence: `states: ${s1.signal.state} → ${s2.signal.state} → ${s3.signal.state} → ${s4.signal.state}`,
    failure: s4.signal.state === 'NO_SIGNAL' ? 'Did not recover' : undefined,
  });
}

// ADV-8: signal → noise → signal
function testADV8(): void {
  const layer = new RadioObservationLayer({ ...DEFAULT_RADIO_CONFIG, sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  layer.markConnected();
  const sig = sineWave(440, FFT_SIZE, SAMPLE_RATE, 0.8);
  const sigFd = new Uint8Array(FFT_SIZE / 2).fill(200);
  const noi = whiteNoise(FFT_SIZE, 0.5);
  const noiFd = new Uint8Array(FFT_SIZE / 2);
  for (let i = 0; i < noiFd.length; i++) noiFd[i] = 100 + Math.floor(Math.random() * 20);

  const s1 = layer.process(sig, sigFd, 10.0);
  const s2 = layer.process(noi, noiFd, 11.0);
  const s3 = layer.process(sig, sigFd, 12.0);

  record({
    id: 'ADV-8-SignalNoiseSignal',
    name: 'Signal → noise → signal — no crash',
    passed: !s1.signal.state.includes('ERROR') && !s3.signal.state.includes('ERROR'),
    evidence: `states: ${s1.signal.state} → ${s2.signal.state} → ${s3.signal.state}`,
  });
}

// ADV-9: pitch jumps across 2 octaves
function testADV9(): void {
  const layer = new RadioObservationLayer({ ...DEFAULT_RADIO_CONFIG, sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  layer.markConnected();
  // 220 Hz then 880 Hz (2 octaves)
  const td1 = sineWave(220, FFT_SIZE, SAMPLE_RATE, 0.8);
  const td2 = sineWave(880, FFT_SIZE, SAMPLE_RATE, 0.8);
  const fd1 = new Uint8Array(FFT_SIZE / 2).fill(2); fd1[Math.floor(220 / (SAMPLE_RATE / FFT_SIZE))] = 255;
  const fd2 = new Uint8Array(FFT_SIZE / 2).fill(2); fd2[Math.floor(880 / (SAMPLE_RATE / FFT_SIZE))] = 255;

  let crashed = false;
  try {
    layer.process(td1, fd1, 10.0);
    layer.process(td2, fd2, 10.4);
  } catch { crashed = true; }

  record({
    id: 'ADV-9-PitchJump2Octaves',
    name: 'Pitch jump 220→880 Hz (2 octaves) — no crash',
    passed: !crashed,
    evidence: `crashed=${crashed}`,
    failure: crashed ? 'Crashed on pitch jump' : undefined,
  });
}

// ADV-10: kick + melody simultaneously
function testADV10(): void {
  const layer = new RadioObservationLayer({ ...DEFAULT_RADIO_CONFIG, sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  layer.markConnected();
  // Strong low end (kick) + 440 Hz melody
  const td = sineWave(440, FFT_SIZE, SAMPLE_RATE, 0.5);
  // Add low frequency
  for (let i = 0; i < FFT_SIZE; i++) {
    td[i] += 0.5 * Math.sin(2 * Math.PI * 60 * (i / SAMPLE_RATE));
  }
  const fd = new Uint8Array(FFT_SIZE / 2).fill(100);
  fd[0] = 255; fd[1] = 255; // strong sub-bass
  fd[Math.floor(440 / (SAMPLE_RATE / FFT_SIZE))] = 200;

  const snap = layer.process(td, fd, 10.0);
  record({
    id: 'ADV-10-KickPlusMelody',
    name: 'Kick + melody simultaneously — no crash, pitch may be rejected',
    passed: !snap.signal.state.includes('ERROR'),
    evidence: `state=${snap.signal.state} pitch=${snap.pitch ? 'present' : 'null (rejected by kick gate)'}`,
  });
}

// ADV-11: 30-second jitter stream
function testADV11(): void {
  const engine = new BeatObservationEngine({ ...DEFAULT_RADIO_CONFIG, sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  const bpm = 145;
  const period = 60 / bpm;
  let crashed = false;
  try {
    for (let i = 0; i < 30 * bpm / 60; i++) {
      const jitter = (Math.random() * 2 - 1) * 0.05;
      engine.processBeat({ time: 10.0 + i * period + jitter, subBassEnergy: 0.7, localAverage: 0.3, localMax: 0.8, spectralEnergy: 0.5 });
    }
  } catch { crashed = true; }
  const obs = engine.getObservation();
  record({
    id: 'ADV-11-30sJitter',
    name: '30-second jitter stream — no crash, valid state',
    passed: !crashed && isValid(obs),
    evidence: `crashed=${crashed} bpm=${obs?.estimatedBpm?.toFixed(2)}`,
    failure: crashed ? 'Crashed' : undefined,
  });
}

// ADV-12: 10-minute simulated observation stream
function testADV12(): void {
  const engine = new BeatObservationEngine({ ...DEFAULT_RADIO_CONFIG, sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  const bpm = 145;
  const period = 60 / bpm;
  const totalBeats = 10 * 60 * bpm / 60; // 10 minutes
  let crashed = false;
  let nanCount = 0;
  try {
    for (let i = 0; i < totalBeats; i++) {
      const obs = engine.processBeat({ time: 10.0 + i * period, subBassEnergy: 0.7, localAverage: 0.3, localMax: 0.8, spectralEnergy: 0.5 });
      if (obs && (isNaN(obs.estimatedBpm) || isNaN(obs.confidence))) nanCount++;
    }
  } catch { crashed = true; }
  const obs = engine.getObservation();
  record({
    id: 'ADV-12-10min',
    name: '10-minute observation stream — no crash, no NaN',
    passed: !crashed && nanCount === 0 && isValid(obs),
    evidence: `crashed=${crashed} nanCount=${nanCount} bpm=${obs?.estimatedBpm?.toFixed(2)}`,
    failure: crashed ? 'Crashed' : (nanCount > 0 ? `${nanCount} NaN values` : undefined),
  });
}

// MAIN
function main(): void {
  console.log('=== F2.7 — Radio Observation Adversarial Tests ===\n');
  testADV1(); testADV2(); testADV3(); testADV4(); testADV5(); testADV6();
  testADV7(); testADV8(); testADV9(); testADV10(); testADV11(); testADV12();
  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed, ${results.length} total ===`);
  fs.writeFileSync(path.join(__dirname, 'radio-adversarial-results.json'), JSON.stringify({ runAt: new Date().toISOString(), totalTests: results.length, passed, failed, results }, null, 2));
  process.exit(failed > 0 ? 1 : 0);
}
main();
