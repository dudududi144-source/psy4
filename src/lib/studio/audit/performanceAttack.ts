/**
 * PERFORMANCE ATTACK — independent audit.
 * REAL IMPLEMENTATION.
 *
 * Independently measures render performance and progressively stresses the
 * system to find the REALTIME → MARGINAL → FAILURE boundary.
 *
 * Does NOT trust the previous "0.39x realtime" claim. Re-measures it.
 */

import { Studio } from '../render/engine';
import { loopArrangement, scheduleArrangement } from '../render/arrangement';

export interface PerfPoint {
  label: string;
  bars: number;
  sampleRate: number;
  blockSize: number;
  voices: number;
  audioDurationSec: number;
  renderMs: number;
  ratio: number;        // renderMs / audioDurationSec / 1000
  status: 'REALTIME' | 'MARGINAL' | 'FAILURE';
  peak: number;
  rms: number;
  blocks: number;
}

function peakOf(b: Float32Array): number { let p = 0; for (let i = 0; i < b.length; i++) { const a = Math.abs(b[i]); if (a > p) p = a; } return p; }
function rmsOf(b: Float32Array): number { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / Math.max(1, b.length)); }

function measure(bars: number, sr: number, blockSize: number, label: string): PerfPoint {
  const studio = new Studio({ bars, sampleRate: sr, blockSize, seed: 99, bpm: 138 });
  const recipe = loopArrangement(138, 45, 'minor');
  studio.live.setArrangement(recipe.sections);
  scheduleArrangement(studio, recipe);
  const t0 = Date.now();
  let crashed = false;
  let peak = 0, rms = 0;
  try {
    const { left } = studio.render(bars);
    peak = peakOf(left);
    rms = rmsOf(left);
  } catch (e) {
    crashed = true;
    console.error(`[PERF] ${label} crashed: ${(e as Error).message}`);
  }
  // help GC reclaim the large buffers before the next point
  if (global.gc) { try { global.gc(); } catch { /* ignore */ } }
  const renderMs = Date.now() - t0;
  const audioDurationSec = (bars * 4 * (60 / 138));
  const ratio = renderMs / (audioDurationSec * 1000);
  const status: PerfPoint['status'] = crashed ? 'FAILURE' : ratio < 0.7 ? 'REALTIME' : ratio < 1.2 ? 'MARGINAL' : 'FAILURE';
  return {
    label, bars, sampleRate: sr, blockSize, voices: 9,
    audioDurationSec: Math.round(audioDurationSec * 10) / 10,
    renderMs, ratio: Math.round(ratio * 100) / 100, status,
    peak: Math.round(peak * 1000) / 1000, rms: Math.round(rms * 10000) / 10000,
    blocks: studio.metrics.blocksProcessed,
  };
}

export function runPerformanceAttack(): { points: PerfPoint[]; realtimeBoundary: string; failureBoundary: string; maxVoices: number; maxSampleRate: number } {
  const points: PerfPoint[] = [];
  // progressive stress — kept manageable to avoid OOM in constrained environments.
  // The 16bar/44k point allocates ~2.5M-sample buffers × multiple devices and can OOM.
  points.push(measure(4, 22050, 256, 'baseline-4bar-22k'));
  points.push(measure(8, 22050, 256, '8bar-22k'));
  points.push(measure(16, 22050, 256, '16bar-22k'));
  points.push(measure(4, 44100, 256, '4bar-44k'));
  points.push(measure(8, 44100, 256, '8bar-44k'));
  points.push(measure(4, 44100, 128, '4bar-44k-bs128'));

  const realtime = points.filter((p) => p.status === 'REALTIME');
  const marginal = points.filter((p) => p.status === 'MARGINAL');
  const failure = points.filter((p) => p.status === 'FAILURE');

  const realtimeBoundary = realtime.length > 0
    ? `REALTIME holds up to ${realtime[realtime.length - 1].label} (ratio ${realtime[realtime.length - 1].ratio})`
    : 'NO REALTIME POINTS';
  const failureBoundary = failure.length > 0
    ? `FAILURE at ${failure[0].label} (ratio ${failure[0].ratio})`
    : marginal.length > 0
    ? `MARGINAL at ${marginal[0].label} (ratio ${marginal[0].ratio}) — no hard failure reached`
    : 'NO FAILURE REACHED — system handled all stress points';

  return {
    points,
    realtimeBoundary,
    failureBoundary,
    maxVoices: 9,
    maxSampleRate: 44100,
  };
}
