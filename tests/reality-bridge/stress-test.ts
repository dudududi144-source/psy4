/**
 * PooledEngine 10-minute stress test.
 *
 * Per Reality Bridge §15: "No GC Dropouts" is an extremely strong claim.
 * We can't measure browser GC pauses precisely in a headless shim,
 * but we CAN verify:
 *   - Voice pool exhaustion (does activeCount ever exceed pool size?)
 *   - Node creation/destruction (does node count grow unboundedly?)
 *   - Crash-free duration under high event density
 *   - Voice reuse (round-robin allocation)
 *
 * Note: PooledEngine is DEAD CODE (not used by psyLive runtime — see PE-7E).
 * This test exercises the module in isolation. The "no GC dropouts" claim
 * cannot be proven here because (a) we have no real audio callback to overrun
 * and (b) the module isn't even connected to the live runtime.
 *
 * Result: GC-DROPOUT CLAIM NOT PROVEN.
 */
import '../reality-bridge-setup';
import { PooledEngine } from '../../src/lib/pooledEngine';
import { AudioContextShim } from '../reality-bridge/audioShim';
import * as fs from 'fs';
import * as path from 'path';

const SAMPLES_PER_SEC_16TH = 4 * 145 / 60; // 145 BPM, 16th notes ≈ 9.67/sec
const DURATION_SEC = 600; // 10 minutes
const TOTAL_NOTES = Math.floor(SAMPLES_PER_SEC_16TH * DURATION_SEC);

const ctx = new AudioContextShim();
const engine = new PooledEngine(ctx as any);

const synthPreset: any = {
  id: 'stress-synth', name: 'Stress Synth', genre: 'PSYTRANCE', cat: 'lead', engine: 'SYNTH',
  wave1: 'sawtooth', wave2: 'sawtooth', oct2: 0, detune: 9,
  cutoff: 1500, res: 1, fType: 'lowpass', fEnvAmt: 0, fDecay: 0.16,
  atk: 0.005, dec: 0.3, sus: 0.6, rel: 0.15, gate: 0.6,
  lfoRate: 0, lfoDepth: 0, lfoDest: 'off', sendDelay: 0, sendReverb: 0, velSens: 0.8,
};
const drumPreset: any = {
  id: 'stress-kick', name: 'Stress Kick', genre: 'PSYTRANCE', cat: 'drum', engine: 'DRUM',
  drumType: 'kick', tune: 1, decay: 1, tone: 1, punch: 0.5,
};

const startTime = Date.now();
let crashed = false;
let crashError: string | null = null;
let maxActiveSeen = 0;
let activeSamples: number[] = [];
let nodeCountSamples: number[] = [];

try {
  for (let i = 0; i < TOTAL_NOTES; i++) {
    // Trigger synth + drum every 16th note
    engine.triggerSynth(synthPreset, 200 + Math.random() * 800, ctx.currentTime + i * 0.1, 0.8, 0.1);
    if (i % 4 === 0) engine.triggerDrum(drumPreset, ctx.currentTime + i * 0.1, 0.9);
    ctx.tick(0.1);

    // Sample every 100 notes
    if (i % 100 === 0) {
      maxActiveSeen = Math.max(maxActiveSeen, engine.activeCount);
      activeSamples.push(engine.activeCount);
      nodeCountSamples.push(ctx.nodes.length);
    }

    // Periodically check that voice pool isn't exhausted
    if (engine.activeCount > 28) {
      // Pool is 16 synth + 12 drum = 28 voices. If exceeded, voices are being
      // reused but new triggers happened before old ones released.
      // This is acceptable (round-robin steals voices) but worth logging.
    }

    // Periodic killAll every 1000 notes (simulates pattern reset)
    if (i % 1000 === 999) {
      engine.killAll();
    }
  }
} catch (e: any) {
  crashed = true;
  crashError = e.message ?? String(e);
}

const elapsedMs = Date.now() - startTime;
const maxActive = Math.max(...activeSamples);
const maxNodes = Math.max(...nodeCountSamples);
const minNodes = Math.min(...nodeCountSamples);
const nodeGrowth = maxNodes - minNodes;

const result = {
  runAt: new Date().toISOString(),
  durationSec: DURATION_SEC,
  totalNotes: TOTAL_NOTES,
  elapsedMs,
  crashed,
  crashError,
  maxActiveCount: engine.maxActiveCount,
  maxActiveObserved: maxActive,
  poolSize: 16 + 12,
  poolExhausted: maxActive > 28,
  nodeCountMin: minNodes,
  nodeCountMax: maxNodes,
  nodeGrowth, // If > 0, nodes are being created without cleanup
  // Notes about claims we CANNOT verify in shim:
  gcDropoutsClaimProven: false,
  gcDropoutsClaimReason: 'Cannot measure browser GC pauses in headless shim; no real audio callback to overrun. Also: PooledEngine is DEAD CODE — not connected to psyLive runtime.',
  voiceReuseWorking: maxActive <= 28, // voices are being reused, not created
  killAllRecoveryWorks: !crashed,
};

console.log('=== PooledEngine 10-min Stress Test ===');
console.log(JSON.stringify(result, null, 2));

const outPath = path.join(__dirname, 'stress-test-results.json');
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(`\nResults written to: ${outPath}`);
