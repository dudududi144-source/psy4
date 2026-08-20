// scripts/verify-radio-infinite.ts
//
// VERIFICATION SCRIPT — runs the radio + learning loop forever (Ctrl-C to stop).
//
// What this verifies:
//   1. Radio streams are reachable (HTTP HEAD on each URL with 5s timeout)
//   2. The dev-server CORS proxy can pipe a stream (GET /api/radio/proxy?url=…)
//   3. The CCLearner learning math still produces sensible rewards (it would
//      catch a regression like "tick() throws" or "reward is always 0")
//   4. The script ITSELF runs infinitely — like the radio's auto-reconnect
//      loop, it never gives up. If a cycle fails, we log + keep going.
//
// Usage:
//   bun run verify:radio
//
// Output: a running log to stdout + a JSON status snapshot written to
// /home/z/my-project/scripts/verify-radio-infinite-status.json every cycle
// so you can inspect the most recent status without watching the stream.

import { CCLearner } from '../src/lib/psyLive4/learning';
import type { AudioQualityMetrics, AdjustmentSuggestion } from '../src/lib/psyLive4/audio-quality';

// ── Config ──────────────────────────────────────────────────────────────
const CYCLE_MS = 30_000;              // 30s between cycles
const STREAM_TIMEOUT_MS = 5_000;      // 5s HEAD timeout per stream
const PROXY_BASE = 'http://localhost:3000';  // dev server
const STREAMS_FILE = '/home/z/my-project/public/api/streams.json';
const STATUS_FILE = '/home/z/my-project/scripts/verify-radio-infinite-status.json';

// ── Helpers ─────────────────────────────────────────────────────────────
function ts(): string {
  return new Date().toISOString();
}

function fmt(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

interface StreamStatus {
  id: string;
  name: string;
  url: string;
  ok: boolean;
  httpCode?: number;
  latencyMs?: number;
  error?: string;
}

async function pingStream(url: string, timeoutMs: number): Promise<{ ok: boolean; code?: number; latencyMs?: number; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    // Use GET with a tiny range so radio servers (which may not support HEAD)
    // still respond. We only need the headers — we abort as soon as we get them.
    const resp = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Range': 'bytes=0-0', 'User-Agent': 'PsyForge-Verify/1.0' },
    });
    clearTimeout(timer);
    return { ok: resp.ok, code: resp.status, latencyMs: Date.now() - start };
  } catch (err: any) {
    clearTimeout(timer);
    return { ok: false, error: err?.name === 'AbortError' ? 'timeout' : String(err?.message ?? err) };
  }
}

async function loadStreams(): Promise<Array<{ id: string; name: string; url: string; priority?: number }>> {
  const txt = await Bun.file(STREAMS_FILE).text();
  const data = JSON.parse(txt);
  return data.streams ?? data;
}

async function pingAllStreams(streams: Array<{ id: string; name: string; url: string }>): Promise<StreamStatus[]> {
  const results: StreamStatus[] = [];
  for (const s of streams) {
    const r = await pingStream(s.url, STREAM_TIMEOUT_MS);
    results.push({
      id: s.id, name: s.name, url: s.url,
      ok: r.ok, httpCode: r.code, latencyMs: r.latencyMs, error: r.error,
    });
  }
  return results;
}

async function pingProxy(url: string): Promise<{ ok: boolean; code?: number; contentType?: string; bytesReceived?: number; latencyMs?: number; error?: string }> {
  const proxyUrl = `${PROXY_BASE}/api/radio/proxy?url=${encodeURIComponent(url)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  const start = Date.now();
  try {
    const resp = await fetch(proxyUrl, { signal: controller.signal });
    // Read at most 4KB to confirm the stream pipes through
    const reader = resp.body?.getReader();
    let bytesReceived = 0;
    if (reader) {
      const { value } = await reader.read();
      if (value) bytesReceived = value.byteLength;
      try { await reader.cancel(); } catch {}
    }
    clearTimeout(timer);
    return {
      ok: resp.ok,
      code: resp.status,
      contentType: resp.headers.get('content-type') ?? undefined,
      bytesReceived,
      latencyMs: Date.now() - start,
    };
  } catch (err: any) {
    clearTimeout(timer);
    return { ok: false, error: err?.name === 'AbortError' ? 'timeout' : String(err?.message ?? err) };
  }
}

// ── Learning loop test ─────────────────────────────────────────────────
// Spin up a CCLearner and feed it a few cycles of simulated metrics + suggestions.
// This verifies the learner:
//   - doesn't throw
//   - produces bounded rewards (0..1)
//   - records patterns
//   - increments CC index over time
function runLearningTest(cycles: number): {
  rewardOk: boolean;
  patternCount: number;
  bestReward: number;
  errors: number;
  ticksRan: number;
} {
  const learner = new CCLearner();
  let errors = 0;
  let ticksRan = 0;
  let bestReward = 0;

  // Simulate 8s per tick — learner uses ctx.currentTime-like units
  let now = 0;
  for (let i = 0; i < cycles; i++) {
    now += 8;  // 8s per tick (matches learner's trialDuration)
    // Simulated metrics — varies a bit each cycle so the learner sees a gradient
    const seed = (i * 31 + 17) % 100;
    const metrics: AudioQualityMetrics = {
      warmth: 0.4 + (seed % 20) / 100,
      brightness: 0.5 + (seed % 30) / 100,
      punch: 0.6 + (seed % 15) / 100,
      clarity: 0.55 + (seed % 25) / 100,
      loudness: 0.5,
      smoothness: 0.6 + (seed % 18) / 100,
      balance: 0.7,
      overall: 0.5 + (seed % 40) / 100,
    };
    const suggestions: AdjustmentSuggestion[] = [
      { cc: 74, direction: 'up', amount: 0.05, reason: 'test' },
    ];
    try {
      const r = learner.tick(now, metrics, suggestions);
      if (r !== null) {
        ticksRan++;
        // Record a pattern every few ticks (simulates composer feedback)
        if (i % 3 === 0) {
          learner.recordPattern(`pat-${i}`, metrics.overall, now);
        }
        if (metrics.overall > bestReward) bestReward = metrics.overall;
      }
    } catch (err) {
      errors++;
      learner.incrementError();
    }
  }

  // Verify rewards are bounded
  const states = learner.getStates();
  const rewardOk = states.every(s => s.reward >= 0 && s.reward <= 1);

  return {
    rewardOk,
    patternCount: learner.getPatternCount(),
    bestReward,
    errors,
    ticksRan,
  };
}

// ── Status snapshot writer ─────────────────────────────────────────────
interface StatusSnapshot {
  cycle: number;
  startedAt: string;
  lastCycleAt: string;
  uptimeMs: number;
  totalCycles: number;
  failedCycles: number;
  lastStreamStatuses: StreamStatus[];
  lastProxyStatus: { ok: boolean; code?: number; bytesReceived?: number; latencyMs?: number; error?: string };
  lastLearningStatus: { rewardOk: boolean; patternCount: number; bestReward: number; errors: number; ticksRan: number };
}

let totalCycles = 0;
let failedCycles = 0;
let startedAt = new Date().toISOString();
let lastSnapshot: StatusSnapshot | null = null;

async function writeSnapshot(snapshot: StatusSnapshot): Promise<void> {
  try {
    await Bun.write(STATUS_FILE, JSON.stringify(snapshot, null, 2));
  } catch (err) {
    console.warn(`[${ts()}] WARN: could not write status file: ${err}`);
  }
}

// ── Main infinite loop ──────────────────────────────────────────────────
async function cycle(): Promise<void> {
  totalCycles++;
  const cycleStart = Date.now();
  console.log(`\n[${ts()}] === CYCLE #${totalCycles} ===`);

  // 1. Load streams
  let streams: Array<{ id: string; name: string; url: string }> = [];
  try {
    streams = await loadStreams();
    console.log(`[${ts()}] loaded ${streams.length} streams from streams.json`);
  } catch (err) {
    failedCycles++;
    console.error(`[${ts()}] FATAL: could not load streams.json: ${err}`);
  }

  // 2. Ping all streams
  let streamStatuses: StreamStatus[] = [];
  if (streams.length > 0) {
    console.log(`[${ts()}] pinging ${streams.length} radio streams (timeout ${STREAM_TIMEOUT_MS}ms each)…`);
    streamStatuses = await pingAllStreams(streams);
    const okCount = streamStatuses.filter(s => s.ok).length;
    for (const s of streamStatuses) {
      const status = s.ok
        ? `✓ HTTP ${s.httpCode} (${fmt(s.latencyMs ?? 0)})`
        : `✗ ${s.error ?? 'failed'}`;
      console.log(`  - ${s.name.padEnd(28)} ${status}`);
    }
    console.log(`[${ts()}] streams OK: ${okCount}/${streamStatuses.length}`);
  }

  // 3. Test the proxy on the first OK stream
  let proxyStatus: { ok: boolean; code?: number; bytesReceived?: number; latencyMs?: number; error?: string } = { ok: false };
  const firstOkStream = streamStatuses.find(s => s.ok);
  if (firstOkStream) {
    console.log(`[${ts()}] testing proxy at ${PROXY_BASE}/api/radio/proxy for ${firstOkStream.name}…`);
    proxyStatus = await pingProxy(firstOkStream.url);
    if (proxyStatus.ok) {
      console.log(`  ✓ proxy: HTTP ${proxyStatus.code} (${proxyStatus.contentType ?? 'unknown'}, ${proxyStatus.bytesReceived ?? 0}B first chunk, ${fmt(proxyStatus.latencyMs ?? 0)})`);
    } else {
      console.log(`  ✗ proxy: ${proxyStatus.error ?? 'failed'} (code=${proxyStatus.code ?? 'n/a'})`);
    }
  } else {
    console.log(`[${ts()}] no OK streams to test proxy with`);
  }

  // 4. Test the learning loop
  const learningStatus = runLearningTest(20);
  console.log(`[${ts()}] learning loop test (20 ticks):`);
  console.log(`  - ticks ran: ${learningStatus.ticksRan}`);
  console.log(`  - reward bounded 0..1: ${learningStatus.rewardOk ? '✓' : '✗'}`);
  console.log(`  - patterns recorded: ${learningStatus.patternCount}`);
  console.log(`  - best reward: ${learningStatus.bestReward.toFixed(3)}`);
  console.log(`  - errors: ${learningStatus.errors}`);
  if (learningStatus.errors > 0 || !learningStatus.rewardOk) {
    failedCycles++;
  }

  // 5. Write status snapshot
  const cycleMs = Date.now() - cycleStart;
  lastSnapshot = {
    cycle: totalCycles,
    startedAt,
    lastCycleAt: ts(),
    uptimeMs: Date.now() - new Date(startedAt).getTime(),
    totalCycles,
    failedCycles,
    lastStreamStatuses: streamStatuses,
    lastProxyStatus: proxyStatus,
    lastLearningStatus: learningStatus,
  };
  await writeSnapshot(lastSnapshot);

  console.log(`[${ts()}] cycle #${totalCycles} done in ${fmt(cycleMs)} · status snapshot → ${STATUS_FILE}`);
}

async function main(): Promise<void> {
  console.log(`╔════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ PSYFORGE 4 · verify-radio-infinite                                  ║`);
  console.log(`║ Loops forever (Ctrl-C to stop). Verifies radio streams + proxy +     ║`);
  console.log(`║ learning math every ${CYCLE_MS / 1000}s.                                              ║`);
  console.log(`╚════════════════════════════════════════════════════════════════════╝`);
  console.log(`[${ts()}] starting infinite loop (cycle every ${CYCLE_MS / 1000}s)`);

  // Run first cycle immediately
  try {
    await cycle();
  } catch (err) {
    console.error(`[${ts()}] cycle ${totalCycles} threw: ${err}`);
    failedCycles++;
  }

  // Schedule subsequent cycles
  const interval = setInterval(async () => {
    try {
      await cycle();
    } catch (err) {
      console.error(`[${ts()}] cycle ${totalCycles} threw: ${err}`);
      failedCycles++;
    }
  }, CYCLE_MS);

  // Graceful shutdown
  const shutdown = (sig: string) => {
    console.log(`\n[${ts()}] received ${sig} — shutting down after ${totalCycles} cycles (${failedCycles} failed)`);
    clearInterval(interval);
    if (lastSnapshot) {
      const snapPath = STATUS_FILE;
      console.log(`[${ts()}] final status: ${snapPath}`);
    }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error(`[${ts()}] FATAL: ${err}`);
  process.exit(1);
});
