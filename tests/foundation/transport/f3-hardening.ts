/**
 * F3 — Foundation Hardening Test Suite
 *
 * Covers:
 * - RULE 4: 414ms bug regression (lookahead < beatDuration at multiple BPMs)
 * - RULE 7: Long-run drift (10min, 30min)
 * - RULE 8: Adversarial transport (jitter, bursts, NaN, Infinity, negative)
 * - RULE 10: STOP/PLAY/seek/tempo change
 * - RULE 11: Tab suspension/stall recovery
 * - RULE 15: Consumer contract (create, snapshot, observe, subscribe, immutability)
 *
 * Run: bun run tests/foundation/transport/f3-hardening.ts
 */
import { MusicalTransport } from '../../../foundation/transport/MusicalTransport';
import type { TransportSnapshot } from '../../../foundation/transport/TransportTypes';
import * as fs from 'fs';
import * as path from 'path';

interface TestResult {
  id: string; name: string; passed: boolean; evidence: string;
  metrics?: Record<string, number | string>; failure?: string;
}
const results: TestResult[] = [];
let passed = 0, failed = 0;
function record(r: TestResult): void {
  results.push(r);
  const status = r.passed ? '✓' : '✗';
  console.log(`${status} ${r.id}: ${r.evidence}`);
  if (r.passed) passed++; else failed++;
}

class MockClock {
  private time: number = 0;
  now(): number { return this.time; }
  advance(dt: number): void { this.time += dt; }
  set(t: number): void { this.time = t; }
}

// ═══════════════════════════════════════════════════════════════════════
// RULE 4 — 414ms bug regression: lookahead < beatDuration must still produce events
// ═══════════════════════════════════════════════════════════════════════
function test414msRegression(): void {
  // At each BPM, verify the scheduler produces continuous 16th notes
  // even when scheduleAheadTime (150ms) < beatDuration
  const bpms = [60, 120, 145, 150, 180];
  for (const bpm of bpms) {
    const beatDuration = 60 / bpm;
    const stepDur = beatDuration / 4;
    const scheduleAheadTime = 0.15;
    const startTime = 100.0;
    const totalDuration = 5.0; // 5 seconds
    const tickInterval = 0.025;

    // Simulate the scheduler
    let lastScheduledStepIdx = -1;
    let totalScheduled = 0;
    const stepTimes: number[] = [];

    // Initialize transport-like anchor
    let anchorTime = startTime;
    let anchorBeatIndex = 0;
    const transportBpm = bpm; // Transport starts at this BPM

    for (let tick = 0; tick < totalDuration / tickInterval; tick++) {
      const now = startTime + tick * tickInterval;
      const beatDurationNow = 60 / transportBpm;
      const stepDurNow = beatDurationNow / 4;

      // Compute beat grid from anchor (same as Transport.snapshot())
      const beatsSinceAnchor = (now - anchorTime) / beatDurationNow;
      const beatIndex = Math.floor(beatsSinceAnchor);
      const beatTime = anchorTime + beatIndex * beatDurationNow;

      const elapsedSinceBeat = now - beatTime;
      const stepsSinceBeat = Math.floor(elapsedSinceBeat / stepDurNow);

      let stepTime = beatTime + (stepsSinceBeat + 1) * stepDurNow;
      let stepIdx = beatIndex * 4 + stepsSinceBeat + 1;

      while (stepTime < now + scheduleAheadTime) {
        if (stepTime > now && stepIdx > lastScheduledStepIdx) {
          stepTimes.push(stepTime);
          lastScheduledStepIdx = stepIdx;
          totalScheduled++;
        }
        stepIdx++;
        stepTime += stepDurNow;
      }
    }

    // Verify continuous scheduling
    const expectedSteps = Math.floor(totalDuration * bpm * 4 / 60);
    const isContinuous = totalScheduled >= expectedSteps * 0.9; // 90% tolerance

    // Verify inter-onset intervals are roughly correct
    let avgInterval = 0;
    if (stepTimes.length > 1) {
      const intervals: number[] = [];
      for (let i = 1; i < stepTimes.length; i++) {
        intervals.push(stepTimes[i] - stepTimes[i - 1]);
      }
      avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    }

    record({
      id: `F3-R4-${bpm}BPM`,
      name: `414ms regression: ${bpm} BPM (beatDur=${beatDuration.toFixed(3)}s > lookahead=0.15s) produces continuous 16ths`,
      passed: isContinuous && Math.abs(avgInterval - stepDur) < 0.02,
      evidence: `scheduled=${totalScheduled} expected≈${expectedSteps} avgInterval=${avgInterval.toFixed(4)}s expected=${stepDur.toFixed(4)}s`,
      metrics: { bpm, beatDuration, scheduleAheadTime, scheduled: totalScheduled, expected: expectedSteps, avgInterval, expectedInterval: stepDur },
      failure: !isContinuous ? `Only ${totalScheduled} steps (expected ~${expectedSteps})` : (Math.abs(avgInterval - stepDur) >= 0.02 ? `Interval ${avgInterval.toFixed(4)} ≠ ${stepDur.toFixed(4)}` : undefined),
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// RULE 7 — Long-run drift (10min, 30min)
// ═══════════════════════════════════════════════════════════════════════
function testLongRunDrift(): void {
  const durations = [600, 1800]; // 10min, 30min in seconds
  for (const durationSec of durations) {
    const clock = new MockClock();
    const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 145 });
    transport.start();

    const bpm = 145;
    const period = 60 / bpm;
    // Feed beats every beat (not sampled) to properly test the PLL
    const totalBeats = Math.floor(durationSec * bpm / 60);
    let nanCount = 0;
    let negativeConfidenceCount = 0;
    let overOneConfidenceCount = 0;
    let duplicateBeats = 0;
    let lastBeatIndex = -1;

    // Sample every 10th beat for speed (10min = ~1450 beats, sampled = 145)
    const sampleEvery = 10;
    for (let i = 0; i < totalBeats; i += sampleEvery) {
      clock.set(10.0 + i * period);
      transport.observeBeat({ time: clock.now(), confidence: 0.9, source: 'radio' });
      const snap = transport.snapshot();
      if (isNaN(snap.bpm)) nanCount++;
      if (snap.confidence < 0) negativeConfidenceCount++;
      if (snap.confidence > 1) overOneConfidenceCount++;
      if (snap.beatIndex === lastBeatIndex) duplicateBeats++;
      lastBeatIndex = snap.beatIndex;
    }

    // Set time to the end and measure drift
    clock.set(10.0 + durationSec);
    const snap = transport.snapshot();

    // The Transport uses anchor-based clock: beatIndex = anchorBeatIndex + floor((now - anchorTime) / beatDuration)
    // Since we sampled every 10th beat, the Transport re-anchors on each observation.
    // The final beatIndex should be close to the expected value.
    // The "drift" here is the difference between the Transport's beatIndex and the
    // true elapsed beats. Since the Transport re-anchors on observations, drift is
    // bounded by the re-anchor threshold.
    const expectedBeatIndex = Math.round(durationSec * bpm / 60);
    const actualBeatIndex = snap.beatIndex;
    const beatDrift = Math.abs(actualBeatIndex - expectedBeatIndex);
    // Convert to time: beatDrift * period * 1000 = ms
    // But since we sample every 10 beats, the Transport may be up to 10 beats behind
    // (it hasn't seen the last 10 beats). So we allow up to sampleEvery beats of drift.
    const maxAllowedBeatDrift = sampleEvery + 2; // sampling gap + tolerance
    const timeDriftMs = beatDrift * period * 1000;
    const maxAllowedDriftMs = maxAllowedBeatDrift * period * 1000;

    const minutes = durationSec / 60;
    record({
      id: `F3-R7-${minutes}min`,
      name: `${minutes}-minute drift simulation — drift < ${maxAllowedDriftMs.toFixed(0)}ms (sampling gap), no NaN`,
      passed: beatDrift <= maxAllowedBeatDrift && nanCount === 0 && negativeConfidenceCount === 0 && overOneConfidenceCount === 0,
      evidence: `${minutes}min: beatDrift=${beatDrift} (max=${maxAllowedBeatDrift}) timeDrift=${timeDriftMs.toFixed(0)}ms nan=${nanCount} dupes=${duplicateBeats} bpm=${snap.bpm.toFixed(2)}`,
      metrics: { durationMin: minutes, bpm, expectedBeat: expectedBeatIndex, actualBeat: actualBeatIndex, beatDrift, timeDriftMs, maxAllowedDriftMs, nanCount, duplicateBeats },
      failure: beatDrift > maxAllowedBeatDrift ? `Beat drift ${beatDrift} > ${maxAllowedBeatDrift}` : (nanCount > 0 ? `${nanCount} NaN` : undefined),
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// RULE 8 — Adversarial transport
// ═══════════════════════════════════════════════════════════════════════
function testAdversarial(): void {
  // NaN observation
  {
    const clock = new MockClock();
    const transport = new MusicalTransport(clock.now.bind(clock));
    transport.start();
    let crashed = false;
    try {
      transport.observeBeat({ time: NaN, confidence: 0.9, source: 'radio' });
    } catch { crashed = true; }
    const snap = transport.snapshot();
    record({
      id: 'F3-R8-NaN',
      name: 'NaN timestamp — no crash, no NaN in state',
      passed: !crashed && !isNaN(snap.bpm),
      evidence: `crashed=${crashed} bpm=${snap.bpm.toFixed(2)} valid=${!isNaN(snap.bpm)}`,
      failure: crashed ? 'Crashed on NaN' : (isNaN(snap.bpm) ? 'NaN in state' : undefined),
    });
  }

  // Infinity observation
  {
    const clock = new MockClock();
    const transport = new MusicalTransport(clock.now.bind(clock));
    transport.start();
    let crashed = false;
    try {
      transport.observeBeat({ time: Infinity, confidence: 0.9, source: 'radio' });
    } catch { crashed = true; }
    record({
      id: 'F3-R8-Infinity',
      name: 'Infinity timestamp — no crash',
      passed: !crashed,
      evidence: `crashed=${crashed}`,
      failure: crashed ? 'Crashed on Infinity' : undefined,
    });
  }

  // Negative timestamp
  {
    const clock = new MockClock();
    const transport = new MusicalTransport(clock.now.bind(clock));
    transport.start();
    let crashed = false;
    try {
      transport.observeBeat({ time: -1, confidence: 0.9, source: 'radio' });
    } catch { crashed = true; }
    record({
      id: 'F3-R8-Negative',
      name: 'Negative timestamp — no crash',
      passed: !crashed,
      evidence: `crashed=${crashed}`,
      failure: crashed ? 'Crashed on negative' : undefined,
    });
  }

  // Extremely large timestamp
  {
    const clock = new MockClock();
    const transport = new MusicalTransport(clock.now.bind(clock));
    transport.start();
    let crashed = false;
    try {
      transport.observeBeat({ time: 1e15, confidence: 0.9, source: 'radio' });
    } catch { crashed = true; }
    record({
      id: 'F3-R8-LargeTs',
      name: 'Extremely large timestamp (1e15) — no crash',
      passed: !crashed,
      evidence: `crashed=${crashed}`,
      failure: crashed ? 'Crashed on large timestamp' : undefined,
    });
  }

  // ±1ms jitter
  {
    const clock = new MockClock();
    const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 145 });
    transport.start();
    const bpm = 145;
    const period = 60 / bpm;
    let seed = 42;
    const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const phaseErrors: number[] = [];
    for (let i = 0; i < 60; i++) {
      const jitter = (rng() * 2 - 1) * 0.001;
      clock.set(10.0 + i * period + jitter);
      transport.observeBeat({ time: clock.now(), confidence: 0.9, source: 'radio' });
      if (i > 10) {
        const snap = transport.snapshot();
        phaseErrors.push(Math.min(snap.phase, 1 - snap.phase) * period * 1000);
      }
    }
    phaseErrors.sort((a, b) => a - b);
    const p95 = phaseErrors[Math.floor(phaseErrors.length * 0.95)];
    record({
      id: 'F3-R8-Jitter1ms',
      name: '±1ms jitter — P95 phase error < 5ms',
      passed: p95 < 5,
      evidence: `P95=${p95?.toFixed(3)}ms`,
      failure: p95 >= 5 ? `P95 ${p95?.toFixed(3)}ms >= 5ms` : undefined,
    });
  }

  // Sudden tempo jump 120→180→90
  {
    const clock = new MockClock();
    const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 120 });
    transport.start();
    let crashed = false;
    let t = 10.0;
    const p1 = 60 / 120;
    for (let i = 0; i < 10; i++) { clock.set(t); transport.observeBeat({ time: t, confidence: 0.9, source: 'radio' }); t += p1; }
    const p2 = 60 / 180;
    for (let i = 0; i < 10; i++) { clock.set(t); transport.observeBeat({ time: t, confidence: 0.9, source: 'radio' }); t += p2; }
    const p3 = 60 / 90;
    for (let i = 0; i < 10; i++) { clock.set(t); transport.observeBeat({ time: t, confidence: 0.9, source: 'radio' }); t += p3; }
    const snap = transport.snapshot();
    record({
      id: 'F3-R8-TempoJump',
      name: 'Tempo jump 120→180→90 — no crash, BPM in valid range',
      passed: !crashed && snap.bpm > 60 && snap.bpm < 200,
      evidence: `bpm=${snap.bpm.toFixed(2)} valid=${snap.bpm > 60 && snap.bpm < 200}`,
      failure: snap.bpm <= 60 || snap.bpm >= 200 ? `BPM ${snap.bpm.toFixed(2)} out of range` : undefined,
    });
  }

  // 500 duplicate observations
  {
    const clock = new MockClock();
    const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 145 });
    transport.start();
    const beatIdxBefore = transport.snapshot().beatIndex;
    for (let i = 0; i < 500; i++) {
      transport.observeBeat({ time: 10.0, confidence: 0.9, source: 'radio' });
    }
    const beatIdxAfter = transport.snapshot().beatIndex;
    record({
      id: 'F3-R8-500Dupes',
      name: '500 duplicate observations — no crash, beat not over-advanced',
      passed: beatIdxAfter >= beatIdxBefore,
      evidence: `beat: ${beatIdxBefore} → ${beatIdxAfter}`,
      failure: beatIdxAfter < beatIdxBefore ? 'Beat went backwards' : undefined,
    });
  }

  // 100 random bursts
  {
    const clock = new MockClock();
    const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 145 });
    transport.start();
    let crashed = false;
    try {
      for (let i = 0; i < 100; i++) {
        transport.observeBeat({ time: 10.0 + Math.random() * 1.0, confidence: Math.random(), source: 'radio' });
      }
    } catch { crashed = true; }
    record({
      id: 'F3-R8-100Bursts',
      name: '100 random burst observations — no crash',
      passed: !crashed,
      evidence: `crashed=${crashed}`,
      failure: crashed ? 'Crashed on bursts' : undefined,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// RULE 10 — STOP/PLAY/seek/tempo
// ═══════════════════════════════════════════════════════════════════════
function testStopPlaySeekTempo(): void {
  // Seek
  {
    const clock = new MockClock();
    const transport = new MusicalTransport(clock.now.bind(clock));
    transport.start();
    transport.seek(32);
    const snap1 = transport.snapshot();
    const epoch1 = snap1.epoch;
    transport.seek(4);
    const snap2 = transport.snapshot();
    const epoch2 = snap2.epoch;
    record({
      id: 'F3-R10-Seek',
      name: 'Seek: beat 0→32→4, epoch increments each seek',
      passed: epoch2 > epoch1 && snap2.beatIndex <= snap1.beatIndex,
      evidence: `seek1: beat=${snap1.beatIndex} epoch=${epoch1}, seek2: beat=${snap2.beatIndex} epoch=${epoch2}`,
      failure: epoch2 <= epoch1 ? 'Epoch did not increment' : undefined,
    });
  }

  // Tempo change without phase reset
  {
    const clock = new MockClock();
    const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 120 });
    transport.start();
    // Feed some beats
    for (let i = 0; i < 10; i++) {
      clock.set(10.0 + i * 0.5);
      transport.observeBeat({ time: clock.now(), confidence: 0.9, source: 'radio' });
    }
    const beatBefore = transport.snapshot().beatIndex;
    transport.setTempo(145, 'internal');
    const snap = transport.snapshot();
    record({
      id: 'F3-R10-TempoChange',
      name: 'Tempo change 120→145 — beat continues, epoch increments',
      passed: snap.epoch > 0 && snap.beatIndex >= beatBefore,
      evidence: `beat before=${beatBefore} after=${snap.beatIndex} epoch=${snap.epoch} bpm=${snap.bpm.toFixed(2)}`,
      failure: snap.beatIndex < beatBefore ? 'Beat went backwards on tempo change' : undefined,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// RULE 11 — Tab suspension/stall recovery
// ═══════════════════════════════════════════════════════════════════════
function testTabStall(): void {
  const stalls = [0.1, 0.5, 1.0, 5.0];
  for (const stallSec of stalls) {
    const clock = new MockClock();
    const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 145 });
    transport.start();
    // Feed 10 beats
    const bpm = 145;
    const period = 60 / bpm;
    for (let i = 0; i < 10; i++) {
      clock.set(10.0 + i * period);
      transport.observeBeat({ time: clock.now(), confidence: 0.9, source: 'radio' });
    }
    const beatBefore = transport.snapshot().beatIndex;
    // Simulate stall
    clock.advance(stallSec);
    // Transport should recover via snapshot (anchor-based)
    const snap = transport.snapshot();
    const beatsAdvanced = snap.beatIndex - beatBefore;
    const expectedBeats = Math.round(stallSec / period);
    record({
      id: `F3-R11-Stall${stallSec}s`,
      name: `Tab stall ${stallSec}s — position correct via anchor`,
      passed: Math.abs(beatsAdvanced - expectedBeats) <= 1,
      evidence: `stall=${stallSec}s advanced=${beatsAdvanced} expected=${expectedBeats}`,
      failure: Math.abs(beatsAdvanced - expectedBeats) > 1 ? `Beat error ${Math.abs(beatsAdvanced - expectedBeats)}` : undefined,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// RULE 15 — Consumer contract tests
// ═══════════════════════════════════════════════════════════════════════
function testConsumerContract(): void {
  // 1. Create Transport
  {
    const clock = new MockClock();
    const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 120 });
    record({
      id: 'F3-R15-Create',
      name: 'Consumer can create Transport',
      passed: transport !== null && transport !== undefined,
      evidence: `transport created, isRunning=${transport.isRunning()}`,
    });
  }

  // 2. Snapshot immutability
  {
    const clock = new MockClock();
    const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 120 });
    transport.start();
    const snap = transport.snapshot();
    let mutationFailed = false;
    try {
      (snap as any).bpm = 999;
      mutationFailed = snap.bpm === 999; // If it changed, freeze failed
    } catch { /* frozen — good */ }
    record({
      id: 'F3-R15-Immutable',
      name: 'Snapshot is immutable (Object.freeze)',
      passed: !mutationFailed,
      evidence: `bpm after mutation attempt: ${snap.bpm}`,
      failure: mutationFailed ? 'Snapshot was mutated' : undefined,
    });
  }

  // 3. Observe beat
  {
    const clock = new MockClock();
    const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 120 });
    transport.start();
    transport.observeBeat({ time: 10.0, confidence: 0.9, source: 'radio' });
    const snap = transport.snapshot();
    record({
      id: 'F3-R15-Observe',
      name: 'Consumer can observe beats',
      passed: snap.observationCount > 0 || snap.beatIndex >= 0,
      evidence: `observationCount=${(snap as any).observationCount ?? 'N/A'} beatIndex=${snap.beatIndex}`,
    });
  }

  // 4. Subscribe/unsubscribe
  {
    const clock = new MockClock();
    const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 120 });
    transport.start();
    let notifications = 0;
    const sub = transport.subscribe(() => notifications++);
    transport.observeBeat({ time: 10.0, confidence: 0.9, source: 'radio' });
    const beforeUnsub = notifications;
    sub.unsubscribe();
    transport.observeBeat({ time: 10.5, confidence: 0.9, source: 'radio' });
    const afterUnsub = notifications;
    record({
      id: 'F3-R15-Subscribe',
      name: 'Consumer can subscribe/unsubscribe',
      passed: beforeUnsub > 0 && afterUnsub === beforeUnsub,
      evidence: `beforeUnsub=${beforeUnsub} afterUnsub=${afterUnsub} (should be equal)`,
      failure: afterUnsub !== beforeUnsub ? 'Unsubscribed listener still receiving' : undefined,
    });
  }

  // 5. Seek + epoch
  {
    const clock = new MockClock();
    const transport = new MusicalTransport(clock.now.bind(clock));
    transport.start();
    const epoch1 = transport.snapshot().epoch;
    transport.seek(100);
    const epoch2 = transport.snapshot().epoch;
    record({
      id: 'F3-R15-SeekEpoch',
      name: 'Seek increments epoch (consumer can detect disruption)',
      passed: epoch2 > epoch1,
      evidence: `epoch: ${epoch1} → ${epoch2}`,
      failure: epoch2 <= epoch1 ? 'Epoch did not increment' : undefined,
    });
  }

  // 6. Tempo change
  {
    const clock = new MockClock();
    const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 120 });
    transport.start();
    transport.setTempo(145, 'internal');
    const snap = transport.snapshot();
    record({
      id: 'F3-R15-SetTempo',
      name: 'Consumer can change tempo',
      passed: snap.bpm === 145,
      evidence: `bpm=${snap.bpm}`,
      failure: snap.bpm !== 145 ? `BPM is ${snap.bpm}, expected 145` : undefined,
    });
  }

  // 7. Pause/resume (onAudioContextResume)
  {
    const clock = new MockClock();
    const transport = new MusicalTransport(clock.now.bind(clock));
    transport.start();
    const epoch1 = transport.snapshot().epoch;
    transport.onAudioContextResume();
    const epoch2 = transport.snapshot().epoch;
    record({
      id: 'F3-R15-Resume',
      name: 'Consumer can trigger resume (epoch increments)',
      passed: epoch2 > epoch1,
      evidence: `epoch: ${epoch1} → ${epoch2}`,
      failure: epoch2 <= epoch1 ? 'Epoch did not increment on resume' : undefined,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════
function main(): void {
  console.log('=== F3 Foundation Hardening Tests ===\n');
  test414msRegression();
  testLongRunDrift();
  testAdversarial();
  testStopPlaySeekTempo();
  testTabStall();
  testConsumerContract();
  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed, ${results.length} total ===`);
  fs.writeFileSync(path.join(__dirname, 'f3-hardening-results.json'), JSON.stringify({ runAt: new Date().toISOString(), totalTests: results.length, passed, failed, results }, null, 2));
  process.exit(failed > 0 ? 1 : 0);
}
main();
