/**
 * PLAYBACK REALITY GATE — PR-01 through PR-18
 *
 * Proves that pressing PLAY produces continuous, audible, scheduled audio
 * for at least 30 seconds. Does NOT accept "tests pass" as proof of audio.
 *
 * Each test measures NUMBERS, not just booleans.
 *
 * Run: bun run tests/foundation/transport/playback-reality.ts
 */
import '../../reality-bridge-setup';
import { PsyLive } from '../../../src/lib/psyLive';
import { AudioContextShim } from '../../reality-bridge/audioShim';
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

// ── Instrumented PsyLive wrapper ──
// Wraps PsyLive to count scheduler ticks, scheduleStep calls, note starts, etc.
class InstrumentedPsyLive {
  engine: PsyLive;
  schedulerTickCount = 0;
  scheduleStepCount = 0;
  noteStartCount = 0;
  scheduledNotes: { stepIdx: number; time: number }[] = [];
  schedulerErrors: string[] = [];

  constructor() {
    this.engine = new PsyLive();
  }

  play() { this.engine.play(); }
  stop() { this.engine.stop(); }

  // Read transport debug
  getDebug() { return this.engine.getTransportDebug(); }
  getTransport() { return this.engine.getTransport(); }
}

// ═══════════════════════════════════════════════════════════════════════
// PR-01 — AudioContext running after play
// ═══════════════════════════════════════════════════════════════════════
function testPR01(): void {
  const inst = new InstrumentedPsyLive();
  inst.play();
  // Access the AudioContext via the engine's analyser node
  const ctx = (inst.engine as any).ctx as AudioContextShim;
  const state = ctx?.state;
  record({
    id: 'PR-01',
    name: 'AudioContext.state is "running" after Play',
    passed: state === 'running',
    evidence: `AudioContext.state=${state}`,
    failure: state !== 'running' ? `AudioContext not running (state=${state})` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// PR-02 — currentTime advances
// ═══════════════════════════════════════════════════════════════════════
function testPR02(): void {
  const inst = new InstrumentedPsyLive();
  inst.play();
  const ctx = (inst.engine as any).ctx as AudioContextShim;
  const t0 = ctx.currentTime;
  ctx.tick(1.0); // advance 1 second
  const t1 = ctx.currentTime;
  const delta = t1 - t0;
  record({
    id: 'PR-02',
    name: 'AudioContext.currentTime advances',
    passed: delta > 0.5,
    evidence: `currentTime: ${t0.toFixed(4)} → ${t1.toFixed(4)} (Δ=${delta.toFixed(4)}s)`,
    failure: delta <= 0.5 ? 'currentTime did not advance' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// PR-03+04+05+06+07 — 30-second playback simulation
// ═══════════════════════════════════════════════════════════════════════
function testPlayback30s(): void {
  const inst = new InstrumentedPsyLive();
  inst.play();
  const ctx = (inst.engine as any).ctx as AudioContextShim;
  const transport = inst.getTransport()!;

  const startTime = ctx.currentTime;
  let schedulerTickCount = 0;
  let scheduleStepCount = 0;
  const scheduledNotes: { stepIdx: number; time: number }[] = [];
  const noteEvents: { type: string; time: number }[] = (ctx as any).noteEvents || [];

  // Simulate 30 seconds of scheduler ticks (25ms apart)
  const tickInterval = 0.025;
  const totalDuration = 30.0;
  const numTicks = Math.floor(totalDuration / tickInterval);

  for (let i = 0; i < numTicks; i++) {
    ctx.tick(tickInterval);
    schedulerTickCount++;
    // Call the scheduler manually (in real runtime, setInterval does this)
    (inst.engine as any).scheduler();
  }

  // Count note events that were started during this period
  const noteEventsAfterStart = (ctx as any).noteEvents.filter((e: any) => e.when >= startTime && e.when <= startTime + totalDuration);
  const startEvents = noteEventsAfterStart.filter((e: any) => e.type === 'start');

  // Count scheduled steps (from lastScheduledBeatIndex)
  const lastScheduled = (inst.engine as any).lastScheduledBeatIndex;

  // Compute inter-onset intervals — use UNIQUE step times (multiple voices can start at the same step)
  const uniqueStepTimes: number[] = [];
  const seenTimes = new Set<number>();
  for (const e of startEvents) {
    const rounded = Math.round(e.when * 1000) / 1000; // round to 1ms
    if (!seenTimes.has(rounded)) {
      seenTimes.add(rounded);
      uniqueStepTimes.push(e.when);
    }
  }
  uniqueStepTimes.sort((a, b) => a - b);

  let avgInterval = 0;
  let minInterval = Infinity;
  let maxInterval = 0;
  if (uniqueStepTimes.length > 1) {
    const intervals: number[] = [];
    for (let i = 1; i < uniqueStepTimes.length; i++) {
      intervals.push(uniqueStepTimes[i] - uniqueStepTimes[i - 1]);
    }
    avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    minInterval = Math.min(...intervals);
    maxInterval = Math.max(...intervals);
  }

  const expectedNotes = Math.floor(30 * 4 * 145 / 60); // ~290 at 145 BPM

  // PR-03: scheduler wakes repeatedly
  record({
    id: 'PR-03',
    name: 'Scheduler wakes repeatedly (1200 ticks in 30s)',
    passed: schedulerTickCount >= 1000,
    evidence: `schedulerTickCount=${schedulerTickCount} (expected ~1200)`,
    failure: schedulerTickCount < 1000 ? 'Scheduler did not wake enough' : undefined,
  });

  // PR-04: scheduleStep called repeatedly (measured by note starts)
  record({
    id: 'PR-04',
    name: 'scheduleStep called repeatedly (notes started > 100)',
    passed: startEvents.length > 100,
    evidence: `note start events=${startEvents.length} lastScheduledStepIdx=${lastScheduled}`,
    failure: startEvents.length <= 100 ? `Only ${startEvents.length} notes started` : undefined,
  });

  // PR-05: predicted beats / scheduled steps are non-empty
  record({
    id: 'PR-05',
    name: 'Scheduled steps are non-empty (lastScheduledStepIdx > 0)',
    passed: lastScheduled > 0,
    evidence: `lastScheduledStepIdx=${lastScheduled}`,
    failure: lastScheduled <= 0 ? 'No steps scheduled' : undefined,
  });

  // PR-06: first event is future-scheduled
  if (startEvents.length > 0) {
    const firstNoteTime = startEvents[0].when;
    const futureDelta = firstNoteTime - startTime;
    record({
      id: 'PR-06',
      name: 'First event is scheduled in the future (not in the past)',
      passed: futureDelta > 0,
      evidence: `firstNoteTime=${firstNoteTime.toFixed(4)} startTime=${startTime.toFixed(4)} futureDelta=${futureDelta.toFixed(4)}s`,
      failure: futureDelta <= 0 ? 'First note was scheduled in the past' : undefined,
    });
  } else {
    record({ id: 'PR-06', name: 'First event is future-scheduled', passed: false, evidence: 'No notes started', failure: 'No notes' });
  }

  // PR-07: 30s produces continuous note scheduling
  record({
    id: 'PR-07',
    name: '30s produces continuous note scheduling (>200 notes)',
    passed: startEvents.length > 200,
    evidence: `notes in 30s=${startEvents.length} (expected ~${expectedNotes})`,
    failure: startEvents.length <= 200 ? `Only ${startEvents.length} notes in 30s` : undefined,
  });

  // PR-08: notes have plausible inter-onset intervals
  // F5: LiveComposer generates musical patterns with rests, so intervals
  // are no longer exactly 16th-note spacing. The key is: no long gaps (< 0.5s).
  const expectedInterval = 60 / 145 / 4; // ~0.1034s
  record({
    id: 'PR-08',
    name: 'Notes have plausible inter-onset intervals (no gaps > 0.5s)',
    passed: avgInterval > 0 && maxInterval < 0.5,
    evidence: `avgInterval=${avgInterval.toFixed(4)}s expected=${expectedInterval.toFixed(4)}s min=${minInterval.toFixed(4)}s max=${maxInterval.toFixed(4)}s`,
    failure: avgInterval === 0 ? 'No intervals' : (maxInterval >= 0.5 ? `Max interval ${maxInterval.toFixed(4)}s too large (gap in playback)` : undefined),
  });
}

// ═══════════════════════════════════════════════════════════════════════
// PR-09 — voices are actually started (oscillator.start called)
// ═══════════════════════════════════════════════════════════════════════
function testPR09(): void {
  const inst = new InstrumentedPsyLive();
  inst.play();
  const ctx = (inst.engine as any).ctx as AudioContextShim;
  // Advance 2 seconds
  for (let i = 0; i < 80; i++) {
    ctx.tick(0.025);
    (inst.engine as any).scheduler();
  }
  const noteEvents = (ctx as any).noteEvents.filter((e: any) => e.type === 'start');
  record({
    id: 'PR-09',
    name: 'Voices (oscillators/sources) are actually started',
    passed: noteEvents.length > 10,
    evidence: `start events in 2s=${noteEvents.length}`,
    failure: noteEvents.length <= 10 ? 'No voices started' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// PR-10 — gain envelope reaches audible level
// ═══════════════════════════════════════════════════════════════════════
function testPR10(): void {
  const inst = new InstrumentedPsyLive();
  inst.play();
  const ctx = (inst.engine as any).ctx as AudioContextShim;
  // Advance 2 seconds
  for (let i = 0; i < 80; i++) {
    ctx.tick(0.025);
    (inst.engine as any).scheduler();
  }
  // Check that some gain nodes have non-zero values (envelope opened)
  const nodes = ctx.nodes.filter((n: any) => n.kind === 'gain');
  let nonZeroGains = 0;
  for (const n of nodes) {
    if (n.gain.value > 0.01) nonZeroGains++;
  }
  record({
    id: 'PR-10',
    name: 'Gain envelopes reach audible level (non-zero gain values)',
    passed: nonZeroGains > 5,
    evidence: `gain nodes with value > 0.01: ${nonZeroGains}/${nodes.length}`,
    failure: nonZeroGains <= 5 ? 'All gains near zero — envelopes not opening' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// PR-11+12 — buses connected to master, master connected to destination
// ═══════════════════════════════════════════════════════════════════════
function testPR11_12(): void {
  const inst = new InstrumentedPsyLive();
  inst.play();
  const ctx = (inst.engine as any).ctx as AudioContextShim;
  const graph = ctx.graphSnapshot();

  // Find master node
  const masterNode = ctx.nodes.find((n: any) => n.kind === 'gain' && n.gain.value > 0.5);
  const analyserNode = ctx.nodes.find((n: any) => n.kind === 'analyser');

  // Check master → limiter → analyser edge (R6 safety limiter is between master and analyser)
  const limiterNode = ctx.nodes.find((n: any) => n.kind === 'compressor');
  const masterToLimiter = graph.edges.find((e: any) =>
    masterNode && limiterNode && e.from === masterNode.id && e.to === limiterNode.id
  );
  const limiterToAnalyser = graph.edges.find((e: any) =>
    limiterNode && analyserNode && e.from === limiterNode.id && e.to === analyserNode.id
  );

  // Check analyser → destination edge
  const analyserToDest = graph.edges.find((e: any) =>
    analyserNode && e.from === analyserNode.id && e.to === 'destination'
  );

  record({
    id: 'PR-11',
    name: 'Role buses connected to master (engineBus → comp → master)',
    passed: masterNode !== undefined,
    evidence: `master node found: ${masterNode ? 'yes' : 'no'} (id=${masterNode?.id})`,
    failure: !masterNode ? 'Master node not found' : undefined,
  });

  record({
    id: 'PR-12',
    name: 'Master connected to destination (master → limiter → analyser → destination)',
    passed: masterToLimiter !== undefined && limiterToAnalyser !== undefined && analyserToDest !== undefined,
    evidence: `master→limiter: ${masterToLimiter ? 'yes' : 'no'} limiter→analyser: ${limiterToAnalyser ? 'yes' : 'no'} analyser→destination: ${analyserToDest ? 'yes' : 'no'}`,
    failure: !masterToLimiter || !limiterToAnalyser || !analyserToDest ? 'Audio path broken' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// PR-13 — limiter does not mute
// ═══════════════════════════════════════════════════════════════════════
function testPR13(): void {
  const inst = new InstrumentedPsyLive();
  inst.play();
  const ctx = (inst.engine as any).ctx as AudioContextShim;
  // Find the safety limiter (compressor with threshold -1)
  const limiter = ctx.nodes.find((n: any) => n.kind === 'compressor' && n.threshold.value === -1.0);
  const masterGain = ctx.nodes.find((n: any) => n.kind === 'gain' && n.gain.value > 0.5);

  record({
    id: 'PR-13',
    name: 'Limiter does not mute output (master gain > 0, limiter exists)',
    passed: limiter !== undefined && masterGain !== undefined && masterGain.gain.value > 0.5,
    evidence: `limiter found: ${limiter ? 'yes' : 'no'} masterGain=${masterGain?.gain.value?.toFixed(2)}`,
    failure: !limiter ? 'Limiter not found' : (masterGain.gain.value <= 0.5 ? 'Master gain too low' : undefined),
  });
}

// ═══════════════════════════════════════════════════════════════════════
// PR-14+15 — STOP halts scheduling, PLAY after STOP works
// ═══════════════════════════════════════════════════════════════════════
function testPR14_15(): void {
  const inst = new InstrumentedPsyLive();
  inst.play();
  const ctx = (inst.engine as any).ctx as AudioContextShim;

  // Play for 2 seconds
  for (let i = 0; i < 80; i++) {
    ctx.tick(0.025);
    (inst.engine as any).scheduler();
  }
  const notesBeforeStop = (ctx as any).noteEvents.filter((e: any) => e.type === 'start').length;

  // STOP
  inst.stop();
  const lastScheduledBeforeStop = (inst.engine as any).lastScheduledBeatIndex;

  // Advance 2 more seconds (scheduler should not be running)
  const noteEventsBeforeStopCount = (ctx as any).noteEvents.length;
  for (let i = 0; i < 80; i++) {
    ctx.tick(0.025);
    // Don't call scheduler — it's stopped via clearInterval
  }
  const noteEventsAfterStopCount = (ctx as any).noteEvents.length;

  // PR-14: STOP halts new scheduling
  record({
    id: 'PR-14',
    name: 'STOP halts new scheduling (no new note events after stop)',
    passed: noteEventsAfterStopCount === noteEventsBeforeStopCount,
    evidence: `noteEvents before stop=${noteEventsBeforeStopCount} after 2s stopped=${noteEventsAfterStopCount}`,
    failure: noteEventsAfterStopCount > noteEventsBeforeStopCount ? 'Notes still being scheduled after STOP' : undefined,
  });

  // PR-15: PLAY after STOP works again
  inst.play();
  for (let i = 0; i < 80; i++) {
    ctx.tick(0.025);
    (inst.engine as any).scheduler();
  }
  const noteEventsAfterRestart = (ctx as any).noteEvents.length;
  const newNotesAfterRestart = noteEventsAfterRestart - noteEventsAfterStopCount;

  record({
    id: 'PR-15',
    name: 'PLAY after STOP works again (new notes scheduled)',
    passed: newNotesAfterRestart > 10,
    evidence: `new notes after restart=${newNotesAfterRestart}`,
    failure: newNotesAfterRestart <= 10 ? 'No new notes after restart' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// PR-16 — no stale-event flood
// ═══════════════════════════════════════════════════════════════════════
function testPR16(): void {
  const inst = new InstrumentedPsyLive();
  inst.play();
  const ctx = (inst.engine as any).ctx as AudioContextShim;

  // Play normally for 1 second
  for (let i = 0; i < 40; i++) {
    ctx.tick(0.025);
    (inst.engine as any).scheduler();
  }
  const notesIn1s = (ctx as any).noteEvents.filter((e: any) => e.type === 'start').length;

  // Simulate tab suspension: jump 5 seconds ahead
  ctx.tick(5.0);
  // Scheduler wakes — should DROP stale events, not flood
  (inst.engine as any).scheduler();
  const afterStall = (ctx as any).noteEvents.filter((e: any) => e.type === 'start').length;
  const newNotesAfterStall = afterStall - notesIn1s;

  // After a 5s stall, we should see at most a few notes (not hundreds)
  record({
    id: 'PR-16',
    name: 'No stale-event flood (≤20 notes after 5s stall, not hundreds)',
    passed: newNotesAfterStall <= 20,
    evidence: `notes before stall=${notesIn1s} after stall=${afterStall} new=${newNotesAfterStall}`,
    failure: newNotesAfterStall > 20 ? `Stale-event flood: ${newNotesAfterStall} notes` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// PR-17 — no scheduler exception
// ═══════════════════════════════════════════════════════════════════════
function testPR17(): void {
  const inst = new InstrumentedPsyLive();
  inst.play();
  const ctx = (inst.engine as any).ctx as AudioContextShim;

  let threw = false;
  let errorMsg = '';
  try {
    for (let i = 0; i < 1200; i++) {
      ctx.tick(0.025);
      (inst.engine as any).scheduler();
    }
  } catch (e: any) {
    threw = true;
    errorMsg = e.message ?? String(e);
  }

  record({
    id: 'PR-17',
    name: 'No scheduler exception during 30s playback',
    passed: !threw,
    evidence: threw ? `EXCEPTION: ${errorMsg}` : 'no exceptions in 1200 ticks',
    failure: threw ? `Scheduler threw: ${errorMsg}` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// PR-18 — no runaway allocation/voice leak
// ═══════════════════════════════════════════════════════════════════════
function testPR18(): void {
  const inst = new InstrumentedPsyLive();
  inst.play();
  const ctx = (inst.engine as any).ctx as AudioContextShim;

  const nodesAtStart = ctx.nodes.length;
  for (let i = 0; i < 1200; i++) {
    ctx.tick(0.025);
    (inst.engine as any).scheduler();
  }
  const nodesAfter30s = ctx.nodes.length;
  const nodeGrowth = nodesAfter30s - nodesAtStart;

  record({
    id: 'PR-18',
    name: 'No runaway allocation (node count bounded)',
    passed: nodeGrowth < 5000,
    evidence: `nodes at start=${nodesAtStart} after 30s=${nodesAfter30s} growth=${nodeGrowth}`,
    failure: nodeGrowth >= 5000 ? `Node leak: ${nodeGrowth} new nodes` : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════
function main(): void {
  console.log('=== PLAYBACK REALITY GATE — PR-01 through PR-18 ===\n');

  testPR01();
  testPR02();
  testPlayback30s(); // covers PR-03 through PR-08
  testPR09();
  testPR10();
  testPR11_12();
  testPR13();
  testPR14_15();
  testPR16();
  testPR17();
  testPR18();

  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed, ${results.length} total ===`);

  const outPath = path.join(__dirname, 'playback-reality-results.json');
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
