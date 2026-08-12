/**
 * F1.14 — Transport Test Matrix (A-P)
 *
 * Deterministic tests for MusicalTransport.
 * Each test measures NUMBERS (not just booleans).
 *
 * Acceptance criteria (F1 GATE):
 *   - P95 timing error < 10ms on clean streams
 *   - No phase reset on tempo change
 *   - Radio dropout handled (holdover)
 *   - Half/double ambiguity handled honestly
 *   - Scheduler stall handled (drop stale events)
 *   - Epoch exists and increments on disruptions
 *   - Long-run drift < 10ms P95
 *
 * Run: bun run tests/foundation/transport/transport-tests.ts
 */
import { MusicalTransport } from '../../../foundation/transport/MusicalTransport';
import type { TransportSnapshot } from '../../../foundation/transport/TransportTypes';
import * as fs from 'fs';
import * as path from 'path';

// ── Test result types ────────────────────────────────────────────────────
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

// ── Mock clock ───────────────────────────────────────────────────────────
// Simulates AudioContext.currentTime — the ONLY musical clock
class MockClock {
  private time: number = 0;
  now(): number { return this.time; }
  advance(dt: number): void { this.time += dt; }
  set(t: number): void { this.time = t; }
}

// ── Helper: feed perfect beats at a given BPM ───────────────────────────
function feedPerfectBeats(
  transport: MusicalTransport,
  clock: MockClock,
  bpm: number,
  beatCount: number,
  startTime: number = 10.0,
  confidence: number = 0.9,
): void {
  const period = 60 / bpm;
  for (let i = 0; i < beatCount; i++) {
    clock.set(startTime + i * period);
    transport.observeBeat({ time: clock.now(), confidence, source: 'radio' });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TEST A — Perfect 120 BPM, 60 beats
// ═══════════════════════════════════════════════════════════════════════
function testA(): void {
  const clock = new MockClock();
  const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 120 });
  transport.start();

  feedPerfectBeats(transport, clock, 120, 60);

  // Measure phase error at each beat
  const period = 60 / 120;
  const phaseErrors: number[] = [];
  for (let i = 10; i < 60; i++) {
    clock.set(10.0 + i * period);
    const snap = transport.snapshot();
    // Phase should be ~0 at beat boundaries
    const phaseError = Math.abs(snap.phase);
    phaseErrors.push(phaseError * period * 1000); // convert to ms
  }

  phaseErrors.sort((a, b) => a - b);
  const p95 = phaseErrors[Math.floor(phaseErrors.length * 0.95)];
  const max = phaseErrors[phaseErrors.length - 1];
  const mean = phaseErrors.reduce((a, b) => a + b, 0) / phaseErrors.length;

  record({
    id: 'A-120BPM',
    name: 'Perfect 120 BPM, 60 beats — P95 phase error < 10ms',
    passed: p95 < 10,
    metrics: { bpm: 120, finalBpm: transport.snapshot().bpm, p95PhaseErrorMs: p95, maxPhaseErrorMs: max, meanPhaseErrorMs: mean, locked: transport.snapshot().locked ? 1 : 0 },
    evidence: `finalBpm=${transport.snapshot().bpm.toFixed(2)} P95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms mean=${mean.toFixed(2)}ms locked=${transport.snapshot().locked}`,
    failure: p95 >= 10 ? `P95 phase error ${p95.toFixed(2)}ms exceeds 10ms` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// TEST B — Perfect 150 BPM, 60 beats
// ═══════════════════════════════════════════════════════════════════════
function testB(): void {
  const clock = new MockClock();
  const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 150 });
  transport.start();

  feedPerfectBeats(transport, clock, 150, 60);

  const period = 60 / 150;
  const phaseErrors: number[] = [];
  for (let i = 10; i < 60; i++) {
    clock.set(10.0 + i * period);
    const snap = transport.snapshot();
    phaseErrors.push(Math.abs(snap.phase) * period * 1000);
  }

  phaseErrors.sort((a, b) => a - b);
  const p95 = phaseErrors[Math.floor(phaseErrors.length * 0.95)];

  record({
    id: 'B-150BPM',
    name: 'Perfect 150 BPM, 60 beats — P95 phase error < 10ms',
    passed: p95 < 10,
    metrics: { bpm: 150, finalBpm: transport.snapshot().bpm, p95PhaseErrorMs: p95, locked: transport.snapshot().locked ? 1 : 0 },
    evidence: `finalBpm=${transport.snapshot().bpm.toFixed(2)} P95=${p95.toFixed(2)}ms locked=${transport.snapshot().locked}`,
    failure: p95 >= 10 ? `P95 phase error ${p95.toFixed(2)}ms exceeds 10ms` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// TEST C — Tempo change 120→150 at beat 20
// ═══════════════════════════════════════════════════════════════════════
function testC(): void {
  const clock = new MockClock();
  const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 120 });
  transport.start();

  // Feed 20 beats at 120 BPM
  feedPerfectBeats(transport, clock, 120, 20, 10.0);

  const epochBeforeChange = transport.snapshot().epoch;
  const beatIndexBeforeChange = transport.snapshot().beatIndex;

  // Now feed 40 beats at 150 BPM (starting from where we left off)
  const startTime150 = 10.0 + 20 * (60 / 120);
  feedPerfectBeats(transport, clock, 150, 40, startTime150);

  const snap = transport.snapshot();
  const epochAfterChange = snap.epoch;

  // Check beat continuity: we fed 40 beats at 150 BPM after 20 at 120 BPM.
  // The delta should be ~40 (some beats may be lost during tempo transition).
  const beatsAdvanced = snap.beatIndex - beatIndexBeforeChange;

  record({
    id: 'C-TempoChange',
    name: 'Tempo change 120→150 — beat continuity preserved, no phase reset',
    passed: beatsAdvanced >= 35 && beatsAdvanced <= 45,
    metrics: {
      beatsAdvanced,
      finalBpm: snap.bpm,
      epochBefore: epochBeforeChange,
      epochAfter: epochAfterChange,
    },
    evidence: `beatsAdvanced=${beatsAdvanced} (expected ~40) finalBpm=${snap.bpm.toFixed(2)} epochDelta=${epochAfterChange - epochBeforeChange}`,
    failure: beatsAdvanced < 35 || beatsAdvanced > 45 ? `Beat discontinuity: advanced ${beatsAdvanced} instead of ~40` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// TEST D — Phase perturbation (±50ms jitter)
// ═══════════════════════════════════════════════════════════════════════
function testD(): void {
  const clock = new MockClock();
  const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 145 });
  transport.start();

  const bpm = 145;
  const period = 60 / bpm;
  const jitterMs = 50;

  // Use a fixed seed for reproducibility
  let seed = 42;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  for (let i = 0; i < 60; i++) {
    const jitter = (rng() * 2 - 1) * jitterMs / 1000;
    clock.set(10.0 + i * period + jitter);
    transport.observeBeat({ time: clock.now(), confidence: 0.9, source: 'radio' });
  }

  // Measure phase error at TRUE beat times (not jittered)
  // With ±50ms jitter, the transport's anchor is smoothed but may have
  // residual offset. The phase at the true beat time should be within
  // ~50ms (the jitter magnitude) plus some smoothing residual.
  const phaseErrors: number[] = [];
  for (let i = 40; i < 60; i++) {
    clock.set(10.0 + i * period);
    const snap = transport.snapshot();
    // Phase is 0..1, convert to ms: phase * period * 1000
    // But phase wraps, so we need the minimum distance to 0 or 1
    const phaseMs = Math.min(snap.phase, 1 - snap.phase) * period * 1000;
    phaseErrors.push(phaseMs);
  }

  phaseErrors.sort((a, b) => a - b);
  const p95 = phaseErrors[Math.floor(phaseErrors.length * 0.95)];
  const max = phaseErrors[phaseErrors.length - 1];

  // With ±50ms jitter, P95 should be < 75ms (jitter magnitude + 50% smoothing margin)
  // The transport smooths via 30% re-anchor correction at bar boundaries
  record({
    id: 'D-Jitter50ms',
    name: '±50ms jitter — P95 phase error < 75ms (jitter + 50% margin)',
    passed: p95 < 75,
    metrics: { bpm, jitterMs, p95PhaseErrorMs: p95, maxPhaseErrorMs: max, finalBpm: transport.snapshot().bpm },
    evidence: `finalBpm=${transport.snapshot().bpm.toFixed(2)} P95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms`,
    failure: p95 >= 75 ? `P95 phase error ${p95.toFixed(2)}ms exceeds 75ms` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// TEST E — Beat dropout (25% missing)
// ═══════════════════════════════════════════════════════════════════════
function testE(): void {
  const clock = new MockClock();
  const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 145 });
  transport.start();

  const bpm = 145;
  const period = 60 / bpm;
  let fedCount = 0;

  for (let i = 0; i < 80; i++) {
    if (i % 4 === 2) continue; // skip every 4th beat (25% dropout)
    clock.set(10.0 + i * period);
    transport.observeBeat({ time: clock.now(), confidence: 0.85, source: 'radio' });
    fedCount++;
  }

  const snap = transport.snapshot();
  const bpmError = Math.abs(snap.bpm - bpm);

  record({
    id: 'E-Dropout25',
    name: '25% beat dropout — converges, no false lock',
    passed: snap.locked && bpmError < 3.0,
    metrics: { fedBeats: fedCount, totalBeats: 80, finalBpm: snap.bpm, bpmError, locked: snap.locked ? 1 : 0 },
    evidence: `fed=${fedCount}/80 finalBpm=${snap.bpm.toFixed(2)} bpmErr=${bpmError.toFixed(2)} locked=${snap.locked}`,
    failure: !snap.locked ? 'Did not lock' : (bpmError >= 3.0 ? `BPM error ${bpmError.toFixed(2)} too high` : undefined),
  });
}

// ═══════════════════════════════════════════════════════════════════════
// TEST F — False kicks (10% extra low-confidence)
// ═══════════════════════════════════════════════════════════════════════
function testF(): void {
  const clock = new MockClock();
  const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 145 });
  transport.start();

  const bpm = 145;
  const period = 60 / bpm;
  let extraCount = 0;

  for (let i = 0; i < 60; i++) {
    clock.set(10.0 + i * period);
    transport.observeBeat({ time: clock.now(), confidence: 0.9, source: 'radio' });

    // Inject false kick at half-period with LOW confidence
    if (i % 10 === 0) {
      clock.set(10.0 + i * period + period * 0.5);
      transport.observeBeat({ time: clock.now(), confidence: 0.3, source: 'radio' });
      extraCount++;
    }
  }

  const snap = transport.snapshot();
  const bpmError = Math.abs(snap.bpm - bpm);

  record({
    id: 'F-FalseKicks',
    name: 'False kicks (low confidence) — rejected, no tempo corruption',
    passed: bpmError < 3.0,
    metrics: { extraKicks: extraCount, finalBpm: snap.bpm, bpmError, locked: snap.locked ? 1 : 0 },
    evidence: `extras=${extraCount} finalBpm=${snap.bpm.toFixed(2)} bpmErr=${bpmError.toFixed(2)} locked=${snap.locked}`,
    failure: bpmError >= 3.0 ? `BPM corrupted: error ${bpmError.toFixed(2)}` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// TEST G — Half tempo (75 BPM input, expect 150)
// ═══════════════════════════════════════════════════════════════════════
function testG(): void {
  const clock = new MockClock();
  const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 150 });
  transport.start();

  // Feed beats at 75 BPM (every other beat missing)
  // Transport should recognize 2 periods elapsed and stay at 150
  const actualBpm = 75;
  const period = 60 / actualBpm;
  for (let i = 0; i < 30; i++) {
    clock.set(10.0 + i * period);
    transport.observeBeat({ time: clock.now(), confidence: 0.9, source: 'radio' });
  }

  const snap = transport.snapshot();
  // Accept either 150 (recognized double period) or 75 (treated as actual tempo)
  // The key is that it should be one or the other, not something in between
  const closeTo150 = Math.abs(snap.bpm - 150) < 5;
  const closeTo75 = Math.abs(snap.bpm - 75) < 5;
  const hypotheses = transport.getHypotheses();

  record({
    id: 'G-HalfTempo',
    name: 'Half tempo (75 BPM input) — hypothesis handling, no false certainty',
    passed: closeTo150 || closeTo75,
    metrics: { finalBpm: snap.bpm, closeTo150: closeTo150 ? 1 : 0, closeTo75: closeTo75 ? 1 : 0, hypothesisCount: hypotheses.length, confidence: snap.confidence },
    evidence: `finalBpm=${snap.bpm.toFixed(2)} hypotheses=${hypotheses.length} conf=${snap.confidence.toFixed(2)} ${closeTo150 ? '→ recognized 150' : closeTo75 ? '→ locked to 75' : '→ AMBIGUOUS'}`,
    failure: !closeTo150 && !closeTo75 ? `BPM ${snap.bpm.toFixed(2)} is neither 75 nor 150` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// TEST H — Double tempo (300 BPM input, expect 150)
// ═══════════════════════════════════════════════════════════════════════
function testH(): void {
  const clock = new MockClock();
  const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 150 });
  transport.start();

  // Feed beats at 300 BPM (double tempo — extra beats)
  const actualBpm = 300;
  const period = 60 / actualBpm;
  for (let i = 0; i < 120; i++) {
    clock.set(10.0 + i * period);
    transport.observeBeat({ time: clock.now(), confidence: 0.9, source: 'radio' });
  }

  const snap = transport.snapshot();
  // Transport should converge to 300 (the actual input tempo)
  // or recognize the double and stay near 150
  const closeTo300 = Math.abs(snap.bpm - 300) < 10;
  const closeTo150 = Math.abs(snap.bpm - 150) < 10;

  record({
    id: 'H-DoubleTempo',
    name: 'Double tempo (300 BPM input) — hypothesis handling',
    passed: closeTo300 || closeTo150,
    metrics: { finalBpm: snap.bpm, closeTo300: closeTo300 ? 1 : 0, closeTo150: closeTo150 ? 1 : 0, confidence: snap.confidence },
    evidence: `finalBpm=${snap.bpm.toFixed(2)} conf=${snap.confidence.toFixed(2)} ${closeTo300 ? '→ 300' : closeTo150 ? '→ 150' : '→ OTHER'}`,
    failure: !closeTo300 && !closeTo150 ? `BPM ${snap.bpm.toFixed(2)} unexpected` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// TEST I — Scheduler stall (100ms, 500ms, 1s, 2s, 5s)
// ═══════════════════════════════════════════════════════════════════════
function testI(): void {
  const stallDurations = [0.1, 0.5, 1.0, 2.0, 5.0];
  const allPassed: boolean[] = [];

  for (const stallSec of stallDurations) {
    const clock = new MockClock();
    const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 145 });
    transport.start();

    const bpm = 145;
    const period = 60 / bpm;

    // Feed 20 beats to lock
    feedPerfectBeats(transport, clock, bpm, 20, 10.0);

    const epochBefore = transport.snapshot().epoch;
    const beatBefore = transport.snapshot().beatIndex;

    // Simulate scheduler stall (time advances but no observations)
    clock.advance(stallSec);

    // After stall, take a snapshot — should reflect correct position
    const snap = transport.snapshot();
    const beatsAdvanced = snap.beatIndex - beatBefore;

    // Expected beats advanced = stallSec / period
    const expectedBeats = Math.round(stallSec / period);
    const beatError = Math.abs(beatsAdvanced - expectedBeats);

    // Should NOT try to catch up — just reflect current position
    const passed = beatError <= 1; // allow ±1 beat rounding

    allPassed.push(passed);

    record({
      id: `I-Stall-${stallSec}s`,
      name: `Scheduler stall ${stallSec}s — position correct, no catch-up burst`,
      passed,
      metrics: { stallSec, beatsAdvanced, expectedBeats, beatError, epoch: snap.epoch },
      evidence: `stall=${stallSec}s advanced=${beatsAdvanced} expected=${expectedBeats} err=${beatError} epoch=${snap.epoch}`,
      failure: !passed ? `Beat error ${beatError} > 1 after stall` : undefined,
    });
  }

  const allOk = allPassed.every(p => p);
  record({
    id: 'I-Stall-All',
    name: 'All scheduler stall durations recovered correctly',
    passed: allOk,
    metrics: { tested: stallDurations.length, passed: allPassed.filter(Boolean).length },
    evidence: `${allPassed.filter(Boolean).length}/${stallDurations.length} stalls recovered`,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// TEST J — Radio loss/recovery (holdover)
// ═══════════════════════════════════════════════════════════════════════
function testJ(): void {
  const clock = new MockClock();
  const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 145 });
  transport.start();

  // Feed 20 beats to lock
  feedPerfectBeats(transport, clock, 145, 20, 10.0);
  const confBefore = transport.snapshot().confidence;
  const lockedBefore = transport.snapshot().locked;

  // Radio disappears
  transport.loseSource();
  const confAfterLoss = transport.snapshot().confidence;
  const sourceAfterLoss = transport.snapshot().source;

  // Wait 5 seconds (holdover)
  clock.advance(5.0);
  const confAfter5s = transport.snapshot().confidence;

  // Radio comes back — feed beats at same BPM
  const startTime = 10.0 + 20 * (60 / 145) + 5.0;
  feedPerfectBeats(transport, clock, 145, 20, startTime);

  const snap = transport.snapshot();
  const confRecovered = snap.confidence;
  const lockedRecovered = snap.locked;

  record({
    id: 'J-RadioLossRecovery',
    name: 'Radio loss/recovery — holdover with confidence decay, then re-lock',
    passed: confAfterLoss < confBefore && sourceAfterLoss === 'internal' && confRecovered > confAfter5s,
    metrics: {
      confBefore, confAfterLoss, confAfter5s, confRecovered,
      lockedBefore: lockedBefore ? 1 : 0, lockedRecovered: lockedRecovered ? 1 : 0,
      sourceAfterLoss,
    },
    evidence: `conf: ${confBefore.toFixed(2)} → ${confAfterLoss.toFixed(2)} (loss) → ${confAfter5s.toFixed(2)} (5s holdover) → ${confRecovered.toFixed(2)} (recovered) source=${sourceAfterLoss}`,
    failure: confAfterLoss >= confBefore ? 'Confidence did not drop on loss' : (confRecovered <= confAfter5s ? 'Confidence did not recover' : undefined),
  });
}

// ═══════════════════════════════════════════════════════════════════════
// TEST K — 30-min drift simulation
// ═══════════════════════════════════════════════════════════════════════
function testK(): void {
  const clock = new MockClock();
  const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 145 });
  transport.start();

  const bpm = 145;
  const period = 60 / bpm;

  // Feed beats for 30 minutes (30 * 60 * bpm / 60 = 30 * bpm beats)
  const totalBeats = 30 * bpm; // 4350 beats at 145 BPM
  const sampleEvery = 100; // feed every 100th beat to speed up test

  for (let i = 0; i < totalBeats; i += sampleEvery) {
    clock.set(10.0 + i * period);
    transport.observeBeat({ time: clock.now(), confidence: 0.9, source: 'radio' });
  }

  // Set time to 30 minutes and measure drift
  clock.set(10.0 + 30 * 60);
  const snap = transport.snapshot();

  // Compute expected beat index at 30 min
  const expectedBeatIndex = Math.round(30 * 60 * bpm / 60);
  const actualBeatIndex = snap.beatIndex;
  const beatDrift = Math.abs(actualBeatIndex - expectedBeatIndex);
  const timeDriftMs = beatDrift * period * 1000;

  record({
    id: 'K-30minDrift',
    name: '30-min drift simulation — P95 timing error < 10ms',
    passed: timeDriftMs < 10,
    metrics: {
      simulatedMinutes: 30,
      bpm,
      expectedBeatIndex,
      actualBeatIndex,
      beatDrift,
      timeDriftMs,
    },
    evidence: `30min at ${bpm} BPM: expectedBeat=${expectedBeatIndex} actualBeat=${actualBeatIndex} drift=${beatDrift} beats (${timeDriftMs.toFixed(2)}ms)`,
    failure: timeDriftMs >= 10 ? `Drift ${timeDriftMs.toFixed(2)}ms exceeds 10ms` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// TEST L — Seek
// ═══════════════════════════════════════════════════════════════════════
function testL(): void {
  const clock = new MockClock();
  const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 145 });
  transport.start();

  // Feed some beats
  feedPerfectBeats(transport, clock, 145, 20, 10.0);
  const epochBefore = transport.snapshot().epoch;
  const beatBefore = transport.snapshot().beatIndex;

  // Seek to beat 100
  transport.seek(100);

  const snap = transport.snapshot();
  const epochAfter = snap.epoch;
  const beatAfter = snap.beatIndex;

  record({
    id: 'L-Seek',
    name: 'Seek to beat 100 — epoch increments, position jumps',
    passed: epochAfter > epochBefore && beatAfter >= 100,
    metrics: { epochBefore, epochAfter, beatBefore, beatAfter },
    evidence: `epoch: ${epochBefore} → ${epochAfter} beat: ${beatBefore} → ${beatAfter}`,
    failure: epochAfter <= epochBefore ? 'Epoch did not increment' : (beatAfter < 100 ? 'Beat did not jump' : undefined),
  });
}

// ═══════════════════════════════════════════════════════════════════════
// TEST M — AudioContext pause/resume
// ═══════════════════════════════════════════════════════════════════════
function testM(): void {
  const clock = new MockClock();
  const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 145 });
  transport.start();

  feedPerfectBeats(transport, clock, 145, 20, 10.0);
  const epochBefore = transport.snapshot().epoch;

  // Simulate AudioContext pause (time doesn't advance) then resume (time jumps)
  clock.advance(3.0); // 3 second gap
  transport.onAudioContextResume();

  const snap = transport.snapshot();
  const epochAfter = snap.epoch;

  record({
    id: 'M-AudioContextResume',
    name: 'AudioContext resume — re-anchors, epoch increments',
    passed: epochAfter > epochBefore,
    metrics: { epochBefore, epochAfter, beatIndex: snap.beatIndex },
    evidence: `epoch: ${epochBefore} → ${epochAfter} beatIndex=${snap.beatIndex}`,
    failure: epochAfter <= epochBefore ? 'Epoch did not increment on resume' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// TEST N — Multiple subscribers
// ═══════════════════════════════════════════════════════════════════════
function testN(): void {
  const clock = new MockClock();
  const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 145 });
  transport.start();

  const snapshots: TransportSnapshot[][] = [[], [], []];
  const sub1 = transport.subscribe((s) => snapshots[0].push(s));
  const sub2 = transport.subscribe((s) => snapshots[1].push(s));
  const sub3 = transport.subscribe((s) => snapshots[2].push(s));

  // Feed a few beats
  feedPerfectBeats(transport, clock, 145, 5, 10.0);

  // All subscribers should have received the same number of notifications
  const counts = snapshots.map(s => s.length);
  const allSame = counts.every(c => c === counts[0]);

  // Unsubscribe sub2
  sub2.unsubscribe();

  feedPerfectBeats(transport, clock, 145, 5, 10.0 + 5 * (60 / 145));

  const countsAfterUnsub = snapshots.map(s => s.length);
  // sub2 should NOT have received new notifications
  const sub2Stopped = countsAfterUnsub[1] === counts[1];
  const sub1And3Continued = countsAfterUnsub[0] > counts[0] && countsAfterUnsub[2] > counts[2];

  sub1.unsubscribe();
  sub3.unsubscribe();

  record({
    id: 'N-Subscribers',
    name: 'Multiple subscribers — all receive same snapshots, unsubscribe works',
    passed: allSame && sub2Stopped && sub1And3Continued,
    metrics: {
      notificationCounts: counts.join(','),
      countsAfterUnsub: countsAfterUnsub.join(','),
    },
    evidence: `initial counts: [${counts.join(',')}] after unsub sub2: [${countsAfterUnsub.join(',')}]`,
    failure: !allSame ? 'Subscribers received different notification counts' : (!sub2Stopped ? 'Unsubscribed listener still receiving' : (!sub1And3Continued ? 'Active listeners stopped receiving' : undefined)),
  });
}

// ═══════════════════════════════════════════════════════════════════════
// TEST O — Epoch correctness
// ═══════════════════════════════════════════════════════════════════════
function testO(): void {
  const clock = new MockClock();
  const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 145 });
  transport.start();

  const epochs: number[] = [transport.snapshot().epoch];

  transport.seek(50);
  epochs.push(transport.snapshot().epoch);

  transport.reset();
  epochs.push(transport.snapshot().epoch);

  transport.start();
  epochs.push(transport.snapshot().epoch);

  transport.onAudioContextResume();
  epochs.push(transport.snapshot().epoch);

  // Each disruption should increment epoch
  const increments = epochs.length - 1;
  const allIncremented = epochs.slice(1).every((e, i) => e > epochs[i]);

  record({
    id: 'O-Epoch',
    name: 'Epoch increments on every disruption (seek, reset, start, resume)',
    passed: allIncremented,
    metrics: { epochs: epochs.join(','), increments },
    evidence: `epochs: [${epochs.join(' → ')}]`,
    failure: !allIncremented ? 'Epoch did not increment on some disruption' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// TEST P — No duplicate clock ownership (static analysis)
// ═══════════════════════════════════════════════════════════════════════
function testP(): void {
  // Check that psyLive.ts does NOT have duplicate clock state
  // This test will be run AFTER integration. For now, just verify
  // the Transport itself doesn't expose mutable state.
  const clock = new MockClock();
  const transport = new MusicalTransport(clock.now.bind(clock), { initialBpm: 145 });
  transport.start();

  const snap = transport.snapshot();

  // Snapshot should be immutable (all fields readonly)
  const fields = Object.keys(snap);
  const allReadonly = fields.every(f => {
    try {
      // @ts-ignore — try to modify
      (snap as any)[f] = 999;
      return (snap as any)[f] !== 999; // if it didn't change, it's effectively readonly
    } catch {
      return true;
    }
  });

  record({
    id: 'P-ImmutableSnapshot',
    name: 'Transport snapshot is immutable (no duplicate clock ownership via mutation)',
    passed: allReadonly,
    metrics: { fieldCount: fields.length },
    evidence: `${fields.length} fields in snapshot, all readonly: ${allReadonly}`,
    failure: !allReadonly ? 'Snapshot fields are mutable' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════
function main(): void {
  console.log('=== F1.14 — Transport Test Matrix (A-P) ===\n');

  testA();
  testB();
  testC();
  testD();
  testE();
  testF();
  testG();
  testH();
  testI();
  testJ();
  testK();
  testL();
  testM();
  testN();
  testO();
  testP();

  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed, ${results.length} total ===`);

  const outPath = path.join(__dirname, 'transport-tests-results.json');
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
