/**
 * F1.15 — Adversarial Tests for MusicalTransport
 *
 * Tests designed to BREAK the transport, not to make it pass.
 * Goal: "What's the worst case where the system still stays musical?"
 *
 * Run: bun run tests/foundation/transport/transport-adversarial.ts
 */
import { MusicalTransport } from '../../../foundation/transport/MusicalTransport';
import * as fs from 'fs';
import * as path from 'path';

interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  metrics: Record<string, number | string>;
  evidence: string;
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

class MockClock {
  private time: number = 0;
  now(): number { return this.time; }
  advance(dt: number): void { this.time += dt; }
  set(t: number): void { this.time = t; }
}

// ═══════════════════════════════════════════════════════════════════════
// ADV-1 — Bursts: 10 observations in 100ms
// ═══════════════════════════════════════════════════════════════════════
function testADV1(): void {
  const clock = new MockClock();
  const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 145 });
  transport.start();

  // Feed normal beats for 20 beats
  const period = 60 / 145;
  for (let i = 0; i < 20; i++) {
    clock.set(10.0 + i * period);
    transport.observeBeat({ time: clock.now(), confidence: 0.9, source: 'radio' });
  }

  const bpmBefore = transport.snapshot().bpm;

  // Burst: 10 observations in 100ms (way too fast — false detections)
  for (let i = 0; i < 10; i++) {
    clock.set(10.0 + 20 * period + i * 0.01);
    transport.observeBeat({ time: clock.now(), confidence: 0.5, source: 'radio' });
  }

  const snap = transport.snapshot();
  const bpmAfter = snap.bpm;
  const bpmChange = Math.abs(bpmAfter - bpmBefore);

  // The transport should NOT have jumped to a crazy high BPM
  // It should have rejected most of the burst (interval too short)
  record({
    id: 'ADV-1-Burst',
    name: '10 observations in 100ms — transport rejects burst, stays stable',
    passed: bpmChange < 10 && snap.bpm < 200,
    metrics: { bpmBefore, bpmAfter, bpmChange, finalBpm: snap.bpm },
    evidence: `bpm: ${bpmBefore.toFixed(2)} → ${bpmAfter.toFixed(2)} (Δ=${bpmChange.toFixed(2)})`,
    failure: bpmChange >= 10 ? `BPM jumped by ${bpmChange.toFixed(2)}` : (snap.bpm >= 200 ? `BPM ${snap.bpm.toFixed(2)} too high` : undefined),
  });
}

// ═══════════════════════════════════════════════════════════════════════
// ADV-2 — Out-of-order: observation from the past
// ═══════════════════════════════════════════════════════════════════════
function testADV2(): void {
  const clock = new MockClock();
  const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 145 });
  transport.start();

  const period = 60 / 145;
  for (let i = 0; i < 20; i++) {
    clock.set(10.0 + i * period);
    transport.observeBeat({ time: clock.now(), confidence: 0.9, source: 'radio' });
  }

  const beatIndexBefore = transport.snapshot().beatIndex;
  const epochBefore = transport.snapshot().epoch;

  // Feed an observation from the PAST (earlier than lastObsTime)
  transport.observeBeat({ time: 10.0 + 5 * period, confidence: 0.9, source: 'radio' });

  const snap = transport.snapshot();
  // The transport should have rejected the out-of-order observation
  // (beatIndex should not decrease, epoch should not change)
  const beatIndexAfter = snap.beatIndex;
  const epochAfter = snap.epoch;

  record({
    id: 'ADV-2-OutOfOrder',
    name: 'Out-of-order observation — rejected, no backward time travel',
    passed: beatIndexAfter >= beatIndexBefore && epochAfter === epochBefore,
    metrics: { beatIndexBefore, beatIndexAfter, epochBefore, epochAfter },
    evidence: `beatIndex: ${beatIndexBefore} → ${beatIndexAfter} epoch: ${epochBefore} → ${epochAfter}`,
    failure: beatIndexAfter < beatIndexBefore ? 'Beat index decreased' : (epochAfter !== epochBefore ? 'Epoch changed on rejected obs' : undefined),
  });
}

// ═══════════════════════════════════════════════════════════════════════
// ADV-3 — Late observations: 500ms after the beat
// ═══════════════════════════════════════════════════════════════════════
function testADV3(): void {
  const clock = new MockClock();
  const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 145 });
  transport.start();

  const bpm = 145;
  const period = 60 / bpm;
  const lateDelay = 0.5; // 500ms late

  // Feed 30 beats, each 500ms late
  for (let i = 0; i < 30; i++) {
    clock.set(10.0 + i * period + lateDelay);
    transport.observeBeat({ time: clock.now(), confidence: 0.7, source: 'radio' });
  }

  const snap = transport.snapshot();
  // The transport should still converge to ~145 BPM despite late observations
  const bpmError = Math.abs(snap.bpm - bpm);

  record({
    id: 'ADV-3-LateObs',
    name: 'Late observations (500ms) — transport still converges',
    passed: bpmError < 5.0,
    metrics: { bpm, finalBpm: snap.bpm, bpmError, lateDelayMs: lateDelay * 1000 },
    evidence: `finalBpm=${snap.bpm.toFixed(2)} bpmErr=${bpmError.toFixed(2)} lateDelay=${lateDelay * 1000}ms`,
    failure: bpmError >= 5.0 ? `BPM error ${bpmError.toFixed(2)} too high` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// ADV-4 — Noise: random observations with 0.3 confidence
// ═══════════════════════════════════════════════════════════════════════
function testADV4(): void {
  const clock = new MockClock();
  const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 145 });
  transport.start();

  // Feed 60 random observations with low confidence
  let seed = 12345;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  for (let i = 0; i < 60; i++) {
    const randomTime = 10.0 + rng() * 30; // random time in [10, 40]
    const randomConf = 0.2 + rng() * 0.2; // confidence in [0.2, 0.4]
    clock.set(randomTime);
    transport.observeBeat({ time: clock.now(), confidence: randomConf, source: 'radio' });
  }

  const snap = transport.snapshot();
  // With all low-confidence noise, transport should NOT be locked
  // and should stay near the initial BPM (145)
  const bpmError = Math.abs(snap.bpm - 145);

  record({
    id: 'ADV-4-Noise',
    name: 'Random noise observations (conf 0.2-0.4) — transport stays stable',
    passed: !snap.locked && bpmError < 20,
    metrics: { finalBpm: snap.bpm, bpmError, locked: snap.locked ? 1 : 0, confidence: snap.confidence },
    evidence: `finalBpm=${snap.bpm.toFixed(2)} bpmErr=${bpmError.toFixed(2)} locked=${snap.locked} conf=${snap.confidence.toFixed(2)}`,
    failure: snap.locked ? 'Locked on noise' : (bpmError >= 20 ? `BPM drifted by ${bpmError.toFixed(2)}` : undefined),
  });
}

// ═══════════════════════════════════════════════════════════════════════
// ADV-5 — Tempo jump: 120→180→100 in 20 beats
// ═══════════════════════════════════════════════════════════════════════
function testADV5(): void {
  const clock = new MockClock();
  const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 120 });
  transport.start();

  // Phase 1: 7 beats at 120 BPM
  let t = 10.0;
  const p1 = 60 / 120;
  for (let i = 0; i < 7; i++) {
    clock.set(t);
    transport.observeBeat({ time: clock.now(), confidence: 0.9, source: 'radio' });
    t += p1;
  }

  // Phase 2: 7 beats at 180 BPM
  const p2 = 60 / 180;
  for (let i = 0; i < 7; i++) {
    clock.set(t);
    transport.observeBeat({ time: clock.now(), confidence: 0.9, source: 'radio' });
    t += p2;
  }

  // Phase 3: 7 beats at 100 BPM
  const p3 = 60 / 100;
  for (let i = 0; i < 7; i++) {
    clock.set(t);
    transport.observeBeat({ time: clock.now(), confidence: 0.9, source: 'radio' });
    t += p3;
  }

  const snap = transport.snapshot();
  // The transport should NOT crash and should be tracking SOME tempo
  // (not necessarily exactly 100, but in a reasonable range)
  const inRange = snap.bpm >= 80 && snap.bpm <= 220;

  record({
    id: 'ADV-5-TempoJump',
    name: 'Tempo jump 120→180→100 — transport survives, stays in range',
    passed: inRange,
    metrics: { finalBpm: snap.bpm, locked: snap.locked ? 1 : 0, confidence: snap.confidence },
    evidence: `finalBpm=${snap.bpm.toFixed(2)} locked=${snap.locked} conf=${snap.confidence.toFixed(2)}`,
    failure: !inRange ? `BPM ${snap.bpm.toFixed(2)} out of range [80, 220]` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// ADV-6 — Duplicate kicks: same timestamp, different confidence
// ═══════════════════════════════════════════════════════════════════════
function testADV6(): void {
  const clock = new MockClock();
  const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 145 });
  transport.start();

  const period = 60 / 145;
  for (let i = 0; i < 20; i++) {
    clock.set(10.0 + i * period);
    // Feed two observations at the SAME time with different confidence
    transport.observeBeat({ time: clock.now(), confidence: 0.9, source: 'radio' });
    transport.observeBeat({ time: clock.now(), confidence: 0.6, source: 'radio' });
  }

  const snap = transport.snapshot();
  // The transport should handle duplicates gracefully (not crash, not double-count)
  const bpmError = Math.abs(snap.bpm - 145);

  record({
    id: 'ADV-6-DuplicateKicks',
    name: 'Duplicate kicks (same time, different conf) — handled gracefully',
    passed: bpmError < 5.0,
    metrics: { finalBpm: snap.bpm, bpmError, locked: snap.locked ? 1 : 0 },
    evidence: `finalBpm=${snap.bpm.toFixed(2)} bpmErr=${bpmError.toFixed(2)} locked=${snap.locked}`,
    failure: bpmError >= 5.0 ? `BPM error ${bpmError.toFixed(2)} too high` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════
function main(): void {
  console.log('=== F1.15 — Transport Adversarial Tests ===\n');

  testADV1();
  testADV2();
  testADV3();
  testADV4();
  testADV5();
  testADV6();

  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed, ${results.length} total ===`);

  const outPath = path.join(__dirname, 'transport-adversarial-results.json');
  fs.writeFileSync(outPath, JSON.stringify({
    runAt: new Date().toISOString(),
    totalTests: results.length,
    passed, failed,
    results,
  }, null, 2));
  console.log(`Results: ${outPath}`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
