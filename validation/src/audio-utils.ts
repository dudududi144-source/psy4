/**
 * PSY4 Vertical Validation — Shared Audio Utilities
 *
 * Common helpers used by all variant renderers:
 * - OfflineAudioContext setup (web-audio-api)
 * - Master chain (EQ → comp → master → safety limiter → destination)
 * - WAV encoding
 * - Deterministic noise buffer (seeded)
 * - mtof
 */

import { OfflineAudioContext } from 'web-audio-api';
import * as fs from 'fs';

export const SR = 44100;

export function mtof(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// ─── Deterministic noise buffer (seeded LCG) ────────────────────────────────
export function makeNoiseBuffer(ctx: OfflineAudioContext, seed: number, lengthSamples: number): AudioBuffer {
  const buf = ctx.createBuffer(1, lengthSamples, SR);
  const data = buf.getChannelData(0);
  let s = seed >>> 0;
  for (let i = 0; i < lengthSamples; i++) {
    // LCG: same sequence every time for same seed
    s = (s * 1664525 + 1013904223) >>> 0;
    data[i] = (s / 0x100000000) * 2 - 1; // -1 to 1
  }
  return buf;
}

// ─── Master chain (shared by all variants) ──────────────────────────────────
export interface MasterChain {
  ctx: OfflineAudioContext;
  input: GainNode;       // connect voice buses here
  destination: AudioNode;
}

export function createMasterChain(ctx: OfflineAudioContext): MasterChain {
  // EQ
  const eqLow = ctx.createBiquadFilter();
  eqLow.type = 'lowshelf';
  eqLow.frequency.value = 80;
  eqLow.gain.value = 2;

  const eqMid = ctx.createBiquadFilter();
  eqMid.type = 'peaking';
  eqMid.frequency.value = 350;
  eqMid.Q.value = 0.8;
  eqMid.gain.value = -1;

  const eqHigh = ctx.createBiquadFilter();
  eqHigh.type = 'highshelf';
  eqHigh.frequency.value = 8000;
  eqHigh.gain.value = 1.5;

  // Comp
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 6;
  comp.ratio.value = 3;
  comp.attack.value = 0.01;
  comp.release.value = 0.1;

  // Master
  const master = ctx.createGain();
  master.gain.value = 0.85;

  // Safety limiter
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.05;

  // Chain: input → eqLow → eqMid → eqHigh → comp → master → limiter → destination
  const input = ctx.createGain();
  input.gain.value = 1;
  input.connect(eqLow);
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);
  eqHigh.connect(comp);
  comp.connect(master);
  master.connect(limiter);
  limiter.connect(ctx.destination);

  return { ctx, input, destination: ctx.destination };
}

// ─── WAV encoder ────────────────────────────────────────────────────────────
export function encodeWAV(samples: Float32Array, sr: number = SR): ArrayBuffer {
  const b = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(b);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); ws(8, 'WAVE');
  ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); ws(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2;
  }
  return b;
}

export function writeWAV(path: string, samples: Float32Array, sr: number = SR): void {
  fs.writeFileSync(path, Buffer.from(encodeWAV(samples, sr)));
}

// ─── Create OfflineAudioContext for a unit ──────────────────────────────────
export function createRenderCtx(durationSec: number): { ctx: OfflineAudioContext; master: MasterChain; noiseBuf: AudioBuffer } {
  const length = Math.ceil(durationSec * SR);
  const ctx = new OfflineAudioContext(1, length, SR);
  const master = createMasterChain(ctx);
  const noiseBuf = makeNoiseBuffer(ctx, 42, SR * 0.1); // 100ms noise, seed=42
  return { ctx, master, noiseBuf };
}

// ─── Compute duration of a unit (seconds) ───────────────────────────────────
export function unitDurationSec(bars: number, bpm: number): number {
  const beatDur = 60 / bpm;
  const stepDur = beatDur / 4;
  return bars * 4 * stepDur + 0.5; // +0.5s tail for reverb/release
}
