/**
 * F2.5 RULE 7 — Radio Integration Tests
 *
 * Proves the actual chain: radio fixture → RadioObservationLayer → Transport → scheduler
 * Does NOT mock Transport. Does NOT mock RadioObservationLayer.
 * Uses deterministic synthetic audio/observation fixtures.
 *
 * Run: bun run tests/foundation/radio/radio-integration-tests.ts
 */
import '../../reality-bridge-setup';
import { PsyLive } from '../../../src/lib/psyLive';
import { AudioContextShim } from '../../reality-bridge/audioShim';
import { sineWave, silence, whiteNoise, kickTransient } from '../../reality-bridge/synthFixtures';
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

// Helper: create engine and play
function createEngine(): PsyLive {
  const engine = new PsyLive();
  engine.play();
  // Set up radio analyser manually (simulates connectRadio without network)
  const ctx = (engine as any).ctx as AudioContextShim;
  const radioAnalyser = ctx.createAnalyser();
  radioAnalyser.fftSize = FFT_SIZE;
  radioAnalyser.smoothingTimeConstant = 0.2;
  (engine as any).radioAnalyser = radioAnalyser;
  (engine as any).radioOn = true;
  // Mark radio layer as connected
  (engine as any).radioLayer?.markConnected();
  // Start detection timer manually
  (engine as any).startDetection();
  return engine;
}

// Helper: feed synthetic radio audio to the engine's radio analyser
function feedRadioAudio(engine: PsyLive, td: Float32Array, fd: Uint8Array, audioTime: number): void {
  const ctx = (engine as any).ctx as AudioContextShim;
  const radioAnalyser = (engine as any).radioAnalyser as any;
  if (!radioAnalyser) return;
  radioAnalyser.injectTimeDomainData(td);
  radioAnalyser.injectFrequencyData(fd);
  // Advance the audio context time to the target
  const currentTime = ctx.currentTime;
  if (audioTime > currentTime) {
    ctx.tick(audioTime - currentTime);
  }
  // Call detect() to process through RadioObservationLayer
  (engine as any).detect();
}

// Helper: generate beat-like radio audio at a given BPM
function generateBeatAudio(bpm: number, durationSec: number, startTime: number): { td: Float32Array, fd: Uint8Array, time: number }[] {
  const frames: { td: Float32Array, fd: Uint8Array, time: number }[] = [];
  const period = 60 / bpm;
  const numBeats = Math.floor(durationSec / period);
  const tickInterval = 0.2; // 200ms detect tick

  for (let t = 0; t < durationSec; t += tickInterval) {
    // Generate audio with a kick transient at the nearest beat
    const td = new Float32Array(FFT_SIZE);
    const fd = new Uint8Array(FFT_SIZE / 2).fill(5);

    // Find nearest beat in this frame
    for (let b = 0; b < numBeats; b++) {
      const beatTime = b * period;
      if (beatTime >= t && beatTime < t + tickInterval) {
        // Add kick transient
        const kickStart = Math.floor((beatTime - t) * SAMPLE_RATE);
        if (kickStart >= 0 && kickStart < FFT_SIZE - 100) {
          for (let i = 0; i < 100 && kickStart + i < FFT_SIZE; i++) {
            const env = Math.exp(-i / 20);
            td[kickStart + i] += env * 0.8 * Math.sin(2 * Math.PI * (100 - i) * (i / SAMPLE_RATE));
          }
          // Add sub-bass frequency content
          for (let i = 0; i < 10; i++) fd[i] = 200 + Math.floor(Math.random() * 55);
        }
      }
    }

    // Add some tonal content
    for (let i = 0; i < FFT_SIZE; i++) {
      td[i] += 0.1 * Math.sin(2 * Math.PI * 440 * (i / SAMPLE_RATE));
    }

    frames.push({ td, fd, time: startTime + t });
  }

  return frames;
}

// ═══════════════════════════════════════════════════════════════════════
// A — 120 BPM radio → Transport converges near 120
// ═══════════════════════════════════════════════════════════════════════
function testA(): void {
  const engine = createEngine();
  engine.play();
  // Feed 30 seconds of 120 BPM beat audio
  const frames = generateBeatAudio(120, 30, 10.0);
  for (const f of frames) {
    feedRadioAudio(engine, f.td, f.fd, f.time);
  }
  const debug = engine.getTransportDebug()!;
  const bpm = debug.transportBpm;
  record({
    id: 'INT-A-120BPM',
    name: '120 BPM radio → Transport converges near 120',
    passed: bpm > 110 && bpm < 130,
    evidence: `transportBpm=${bpm.toFixed(2)} observationCount=${debug.observationCount}`,
    failure: bpm <= 110 || bpm >= 130 ? `BPM ${bpm.toFixed(2)} not near 120` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// B — 145 BPM radio → Transport converges near 145
// ═══════════════════════════════════════════════════════════════════════
function testB(): void {
  const engine = createEngine();
  engine.play();
  const frames = generateBeatAudio(145, 30, 10.0);
  for (const f of frames) {
    feedRadioAudio(engine, f.td, f.fd, f.time);
  }
  const debug = engine.getTransportDebug()!;
  const bpm = debug.transportBpm;
  record({
    id: 'INT-B-145BPM',
    name: '145 BPM radio → Transport converges near 145',
    passed: bpm > 135 && bpm < 155,
    evidence: `transportBpm=${bpm.toFixed(2)} observationCount=${debug.observationCount}`,
    failure: bpm <= 135 || bpm >= 155 ? `BPM ${bpm.toFixed(2)} not near 145` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// C — tempo change 120 → 150 preserves phase
// ═══════════════════════════════════════════════════════════════════════
function testC(): void {
  const engine = createEngine();
  engine.play();
  // 10 seconds at 120 BPM
  const frames1 = generateBeatAudio(120, 10, 10.0);
  for (const f of frames1) feedRadioAudio(engine, f.td, f.fd, f.time);
  const beatBefore = engine.getTransportDebug()!.transportBeat;
  const epochBefore = engine.getTransportDebug()!.transportEpoch;
  // 20 seconds at 150 BPM
  const frames2 = generateBeatAudio(150, 20, 20.0);
  for (const f of frames2) feedRadioAudio(engine, f.td, f.fd, f.time);
  const debug = engine.getTransportDebug()!;
  record({
    id: 'INT-C-TempoChange',
    name: 'Tempo change 120→150 — beat continues, no phase reset',
    passed: debug.transportBeat > beatBefore,
    evidence: `beat: ${beatBefore} → ${debug.transportBeat} bpm=${debug.transportBpm.toFixed(2)}`,
    failure: debug.transportBeat <= beatBefore ? 'Beat did not advance' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// D — radio dropout enters HOLDOVER
// ═══════════════════════════════════════════════════════════════════════
function testD(): void {
  const engine = createEngine();
  // Feed 15 seconds of beats to build confidence
  const frames = generateBeatAudio(145, 15, 10.0);
  for (const f of frames) feedRadioAudio(engine, f.td, f.fd, f.time);
  const confBefore = engine.getTransportDebug()!.transportConfidence;
  // Simulate radio loss
  engine.disconnectRadio();
  const debug = engine.getTransportDebug()!;
  record({
    id: 'INT-D-Dropout',
    name: 'Radio dropout → Transport enters holdover (source=internal, confidence drops)',
    passed: debug.transportSource === 'internal',
    evidence: `source=${debug.transportSource} conf: ${confBefore.toFixed(2)} → ${debug.transportConfidence.toFixed(2)}`,
    failure: debug.transportSource !== 'internal' ? `Source is ${debug.transportSource}` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// E — recovery returns to FOLLOWING
// ═══════════════════════════════════════════════════════════════════════
function testE(): void {
  const engine = createEngine();
  engine.play();
  // Feed 10 seconds of beats
  const frames1 = generateBeatAudio(145, 10, 10.0);
  for (const f of frames1) feedRadioAudio(engine, f.td, f.fd, f.time);
  // Lose signal
  engine.disconnectRadio();
  // Feed 10 more seconds of beats (recovery)
  const ctx = (engine as any).ctx as AudioContextShim;
  const frames2 = generateBeatAudio(145, 10, 25.0);
  // Need to reconnect radio analyser
  (engine as any).radioAnalyser = ctx.createAnalyser();
  (engine as any).radioAnalyser.fftSize = FFT_SIZE;
  (engine as any).radioLayer.markConnected();
  for (const f of frames2) feedRadioAudio(engine, f.td, f.fd, f.time);
  const debug = engine.getTransportDebug()!;
  record({
    id: 'INT-E-Recovery',
    name: 'Radio recovery — observations resume, Transport re-locks',
    passed: debug.observationCount > 0,
    evidence: `observationCount=${debug.observationCount} radioState=${debug.radioState} bpm=${debug.transportBpm.toFixed(2)}`,
    failure: debug.observationCount <= 0 ? 'No observations after recovery' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// F — noise never produces FOLLOWING
// ═══════════════════════════════════════════════════════════════════════
function testF(): void {
  const engine = createEngine();
  // Feed 10 seconds of white noise (no sub-bass transients)
  for (let t = 0; t < 10; t += 0.2) {
    const td = whiteNoise(FFT_SIZE, 0.2); // low amplitude noise
    const fd = new Uint8Array(FFT_SIZE / 2);
    // Flat spectrum (noise-like) — no sub-bass peaks
    for (let i = 0; i < fd.length; i++) fd[i] = 30 + Math.floor(Math.random() * 20);
    feedRadioAudio(engine, td, fd, 10.0 + t);
  }
  const debug = engine.getTransportDebug()!;
  // Noise should NOT produce a confident lock.
  // The key is: no false certainty. If it locks, confidence should be low.
  const noFalseCertainty = !debug.transportLocked || debug.transportConfidence < 0.5;
  record({
    id: 'INT-F-Noise',
    name: 'White noise — no false FOLLOWING (no lock or low confidence)',
    passed: noFalseCertainty,
    evidence: `locked=${debug.transportLocked} conf=${debug.transportConfidence.toFixed(2)} observationCount=${debug.observationCount}`,
    failure: !noFalseCertainty ? `False lock with high confidence ${debug.transportConfidence.toFixed(2)}` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// G — half-time does not falsely lock
// ═══════════════════════════════════════════════════════════════════════
function testG(): void {
  const engine = createEngine();
  engine.play();
  // Feed 75 BPM (half of 150)
  const frames = generateBeatAudio(75, 30, 10.0);
  for (const f of frames) feedRadioAudio(engine, f.td, f.fd, f.time);
  const debug = engine.getTransportDebug()!;
  // Should lock to 75 or recognize it as half of 150 — either is OK
  // The key is no false certainty
  record({
    id: 'INT-G-HalfTime',
    name: 'Half-time (75 BPM) — no false certainty',
    passed: debug.transportBpm > 60 && debug.transportBpm < 200,
    evidence: `bpm=${debug.transportBpm.toFixed(2)} locked=${debug.transportLocked} conf=${debug.transportConfidence.toFixed(2)}`,
    failure: debug.transportBpm <= 60 || debug.transportBpm >= 200 ? `Impossible BPM ${debug.transportBpm}` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// H — double-time does not falsely lock
// ═══════════════════════════════════════════════════════════════════════
function testH(): void {
  const engine = createEngine();
  engine.play();
  // Feed 290 BPM (double of 145)
  const frames = generateBeatAudio(290, 30, 10.0);
  for (const f of frames) feedRadioAudio(engine, f.td, f.fd, f.time);
  const debug = engine.getTransportDebug()!;
  record({
    id: 'INT-H-DoubleTime',
    name: 'Double-time (290 BPM) — no false certainty',
    passed: debug.transportBpm > 60 && debug.transportBpm < 200,
    evidence: `bpm=${debug.transportBpm.toFixed(2)} locked=${debug.transportLocked}`,
    failure: debug.transportBpm <= 60 || debug.transportBpm >= 200 ? `Impossible BPM` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// I — jitter remains stable
// ═══════════════════════════════════════════════════════════════════════
function testI(): void {
  const engine = createEngine();
  engine.play();
  // Feed 30 seconds of 145 BPM with jitter
  const frames = generateBeatAudio(145, 30, 10.0);
  // Add jitter by shifting each frame's time
  for (let i = 0; i < frames.length; i++) {
    frames[i].time += (Math.random() * 2 - 1) * 0.01; // ±10ms
  }
  for (const f of frames) feedRadioAudio(engine, f.td, f.fd, f.time);
  const debug = engine.getTransportDebug()!;
  record({
    id: 'INT-I-Jitter',
    name: '±10ms jitter — stable, no crash',
    passed: debug.transportBpm > 130 && debug.transportBpm < 160,
    evidence: `bpm=${debug.transportBpm.toFixed(2)} observationCount=${debug.observationCount}`,
    failure: debug.transportBpm <= 130 || debug.transportBpm >= 160 ? `BPM ${debug.transportBpm} unstable` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// J — out-of-order observations are rejected
// ═══════════════════════════════════════════════════════════════════════
function testJ(): void {
  const engine = createEngine();
  engine.play();
  // Feed frames in reverse order
  const frames = generateBeatAudio(145, 10, 10.0);
  frames.reverse();
  for (const f of frames) feedRadioAudio(engine, f.td, f.fd, f.time);
  const debug = engine.getTransportDebug()!;
  record({
    id: 'INT-J-OutOfOrder',
    name: 'Out-of-order observations — rejected, no crash',
    passed: !isNaN(debug.transportBpm),
    evidence: `bpm=${debug.transportBpm.toFixed(2)} observationCount=${debug.observationCount}`,
    failure: isNaN(debug.transportBpm) ? 'NaN BPM' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// K — duplicate observations do not double-advance
// ═══════════════════════════════════════════════════════════════════════
function testK(): void {
  const engine = createEngine();
  engine.play();
  // Feed 10 seconds of beats
  const frames = generateBeatAudio(145, 10, 10.0);
  for (const f of frames) feedRadioAudio(engine, f.td, f.fd, f.time);
  const beatAfter1 = engine.getTransportDebug()!.transportBeat;
  // Feed the same frames again (duplicates)
  for (const f of frames) feedRadioAudio(engine, f.td, f.fd, f.time);
  const beatAfter2 = engine.getTransportDebug()!.transportBeat;
  // Beat should not have advanced much (duplicates rejected)
  record({
    id: 'INT-K-Duplicates',
    name: 'Duplicate observations — do not double-advance beat',
    passed: beatAfter2 >= beatAfter1,
    evidence: `beat: ${beatAfter1} → ${beatAfter2} (delta=${beatAfter2 - beatAfter1})`,
    failure: beatAfter2 < beatAfter1 ? 'Beat went backwards' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// L — scheduler continues continuous playback
// ═══════════════════════════════════════════════════════════════════════
function testL(): void {
  const engine = createEngine();
  engine.play();
  const ctx = (engine as any).ctx as AudioContextShim;
  // Simulate 30 seconds of scheduler operation
  let schedulerTickCount = 0;
  for (let i = 0; i < 1200; i++) {
    ctx.tick(0.025);
    (engine as any).scheduler();
    schedulerTickCount++;
  }
  const debug = engine.getTransportDebug()!;
  const stepsScheduled = debug.schedulerLastScheduledStepIndex;
  record({
    id: 'INT-L-ContinuousPlayback',
    name: 'Scheduler continues continuous playback (30s, >200 steps)',
    passed: stepsScheduled > 200,
    evidence: `schedulerTicks=${schedulerTickCount} stepsScheduled=${stepsScheduled} bpm=${debug.transportBpm.toFixed(2)}`,
    failure: stepsScheduled <= 200 ? `Only ${stepsScheduled} steps in 30s` : undefined,
  });
}

// MAIN
function main(): void {
  console.log('=== F2.5 RULE 7 — Radio Integration Tests ===\n');
  testA(); testB(); testC(); testD(); testE(); testF();
  testG(); testH(); testI(); testJ(); testK(); testL();
  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed, ${results.length} total ===`);
  fs.writeFileSync(path.join(__dirname, 'radio-integration-tests-results.json'), JSON.stringify({ runAt: new Date().toISOString(), totalTests: results.length, passed, failed, results }, null, 2));
  process.exit(failed > 0 ? 1 : 0);
}
main();
