// scripts/render-baseline.ts
// PHASE 1 — Baseline audio render.
//
// Renders 4 WAV stems from the ACTUAL PsytranceComposer (src/lib/psyLive4/composer.ts),
// so we measure what the engine's composition + reference DSP produces TODAY,
// before any Phase 2-5 fixes.
//
// HONEST LIMITATION: AudioWorkletProcessor (the live drum/lead DSP in
// public/worklets/psy4-engine-v3.js + psy4-lead-worklet.js) does NOT run in
// OfflineAudioContext. So the drums/lead here use native Web Audio nodes
// (OscillatorNode, BiquadFilter, BufferSource) that REPLICATE the worklet DSP
// algorithms. The spectral measurements (peak/rms/crest/sub%/frequency content)
// are valid; the exact sample-by-sample timbre may differ ±a few % from the
// live worklet output. This gap is documented in ARCHITECTURE.md and is the
// same gap the project's own ARCHITECTURE_SIGNAL_FLOW.md identified.
//
// Output: validation/baseline/{kick,bass,lead,full}-baseline.wav (16 bars @ 138 BPM FULL_ON)
//
// Usage: bun run scripts/render-baseline.ts

import { OfflineAudioContext } from 'web-audio-api';
import * as fs from 'fs';
import * as path from 'path';
import { PsytranceComposer } from '../src/lib/psyLive4/composer.ts';
import type { NoteEvent, SynthRole } from '../src/lib/psyLive4/types.ts';
import { writeWAV } from '../validation/src/audio-utils.ts';

const SR = 44100;
const BPM = 138;           // Full-On vertical slice target (Phase 5)
const STYLE = 'FULL_ON' as const;
const BARS = 16;            // ~27.8s at 138 BPM — enough to hear arrangement
const SEED = 42;            // deterministic

const OUT_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'validation', 'baseline');

// ─── mtof ────────────────────────────────────────────────────────────────────
function mtof(m: number): number { return 440 * Math.pow(2, (m - 69) / 12); }

// ─── deterministic noise buffer (seeded LCG — same as audio-utils) ──────────
function makeNoise(ctx: OfflineAudioContext, seed: number, len: number): AudioBuffer {
  const buf = ctx.createBuffer(1, len, SR);
  const d = buf.getChannelData(0);
  let s = seed >>> 0;
  for (let i = 0; i < len; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    d[i] = (s / 0x100000000) * 2 - 1;
  }
  return buf;
}

// ─── Reference DSP per role (native Web Audio, approximating the worklet) ────
// Each function schedules one note at time `t` onto `bus`.

function playKick(ctx: OfflineAudioContext, bus: GainNode, noise: AudioBuffer, t: number, vel: number): void {
  const v = Math.max(0.1, Math.min(1, vel));
  // 1. Click transient (3ms, highpassed noise)
  const click = ctx.createBufferSource(); click.buffer = noise;
  const clickHp = ctx.createBiquadFilter(); clickHp.type = 'highpass'; clickHp.frequency.value = 5000;
  const clickGain = ctx.createGain();
  clickGain.gain.setValueAtTime(0.4 * v, t);
  clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.003);
  click.connect(clickHp); clickHp.connect(clickGain); clickGain.connect(bus);
  click.start(t); click.stop(t + 0.005);
  // 2. Pitch-drop body (120→48Hz in 15ms, 80ms decay) — approximates KickVoice
  const body = ctx.createOscillator(); body.type = 'sine';
  body.frequency.setValueAtTime(120, t);
  body.frequency.exponentialRampToValueAtTime(48, t + 0.015);
  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(0, t);
  bodyGain.gain.linearRampToValueAtTime(0.8 * v, t + 0.0005);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  body.connect(bodyGain); bodyGain.connect(bus);
  body.start(t); body.stop(t + 0.09);
  // 3. Sub body (48Hz, 100ms tail)
  const sub = ctx.createOscillator(); sub.type = 'sine';
  sub.frequency.setValueAtTime(48, t);
  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0, t);
  subGain.gain.linearRampToValueAtTime(0.5 * v, t + 0.003);
  subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  sub.connect(subGain); subGain.connect(bus);
  sub.start(t); sub.stop(t + 0.11);
}

function playBass(ctx: OfflineAudioContext, bus: GainNode, e: NoteEvent): void {
  const t = e.at, vel = Math.max(0.05, e.velocity), freq = mtof(e.note), dur = e.duration;
  // Sawtooth + lowpass with filter envelope (800→200Hz) — approximates psysynth bass
  const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = freq;
  const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 4;
  filter.frequency.setValueAtTime(800, t);
  filter.frequency.exponentialRampToValueAtTime(200, t + dur * 0.5);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.6 * vel, t + 0.005);
  gain.gain.setValueAtTime(0.6 * vel, t + dur * 0.7);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(filter); filter.connect(gain); gain.connect(bus);
  osc.start(t); osc.stop(t + dur + 0.01);
}

function playLead(ctx: OfflineAudioContext, bus: GainNode, e: NoteEvent): void {
  const t = e.at, vel = Math.max(0.05, e.velocity), freq = mtof(e.note), dur = e.duration;
  // 3-osc detuned supersaw + lowpass + slow LFO — approximates LeadVoice (no FM yet, ADR-010 fabricated)
  const oscs = [0, 7, 12].map((detune) => {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.value = freq;
    o.detune.value = detune * 5; // light detune for supersaw thickness
    return o;
  });
  const filter = ctx.createBiquadFilter(); filter.type = 'lowpass';
  filter.frequency.value = 3000; filter.Q.value = 1.5;
  // Slow filter LFO (0.3 Hz, depth 0.12) — matches psy4-lead-worklet.js:128-130
  const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.3;
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 360; // ±360Hz
  lfo.connect(lfoGain); lfoGain.connect(filter.frequency);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.3 * vel, t + 0.01);
  gain.gain.setValueAtTime(0.3 * vel, t + dur * 0.7);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  oscs.forEach(o => { o.connect(filter); o.start(t); o.stop(t + dur + 0.01); });
  filter.connect(gain); gain.connect(bus);
  lfo.start(t); lfo.stop(t + dur + 0.01);
}

function playHat(ctx: OfflineAudioContext, bus: GainNode, noise: AudioBuffer, e: NoteEvent, open: boolean): void {
  const t = e.at, vel = Math.max(0.05, e.velocity);
  const src = ctx.createBufferSource(); src.buffer = noise;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 10000; bp.Q.value = 0.7;
  const gain = ctx.createGain();
  const decay = open ? 0.12 : 0.04;
  gain.gain.setValueAtTime(vel, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
  src.connect(hp); hp.connect(bp); bp.connect(gain); gain.connect(bus);
  src.start(t); src.stop(t + decay + 0.01);
}

function playClap(ctx: OfflineAudioContext, bus: GainNode, noise: AudioBuffer, e: NoteEvent): void {
  const t = e.at, vel = Math.max(0.05, e.velocity);
  const src = ctx.createBufferSource(); src.buffer = noise;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 1.0;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.6 * vel, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  src.connect(bp); bp.connect(gain); gain.connect(bus);
  src.start(t); src.stop(t + 0.16);
}

function playPerc(ctx: OfflineAudioContext, bus: GainNode, noise: AudioBuffer, e: NoteEvent): void {
  const t = e.at, vel = Math.max(0.05, e.velocity);
  const src = ctx.createBufferSource(); src.buffer = noise;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2500; bp.Q.value = 2;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.5 * vel, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  src.connect(bp); bp.connect(gain); gain.connect(bus);
  src.start(t); src.stop(t + 0.06);
}

function playPad(ctx: OfflineAudioContext, bus: GainNode, e: NoteEvent): void {
  const t = e.at, vel = Math.max(0.05, e.velocity), freq = mtof(e.note), dur = e.duration;
  // Detuned saws + lowpass + slow attack
  const oscs = [0, 7, 12].map((semi) => {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.value = freq * Math.pow(2, semi / 12);
    return o;
  });
  const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1200;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.2 * vel, t + 0.3);
  gain.gain.setValueAtTime(0.2 * vel, t + dur * 0.7);
  gain.gain.linearRampToValueAtTime(0, t + dur);
  oscs.forEach(o => { o.connect(filter); o.start(t); o.stop(t + dur + 0.01); });
  filter.connect(gain); gain.connect(bus);
}

// ─── Master chain (shared by all renders) ────────────────────────────────────
function createMaster(ctx: OfflineAudioContext): GainNode {
  const master = ctx.createGain(); master.gain.value = 0.8;
  // Simple safety limiter (no true-peak — Phase 4 adds real one)
  const comp = ctx.createDynamicsCompressor?.();
  if (comp) {
    comp.threshold.value = -6; comp.knee.value = 6; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.1;
    master.connect(comp); comp.connect(ctx.destination);
  } else {
    master.connect(ctx.destination);
  }
  return master;
}

// ─── Render one stem (subset of roles) ───────────────────────────────────────
async function renderStem(
  stemName: string,
  events: NoteEvent[],
  roles: Set<SynthRole>,
): Promise<void> {
  const durSec = (60 / BPM) * 4 * BARS + 0.5;
  const len = Math.ceil(durSec * SR);
  const ctx = new OfflineAudioContext(1, len, SR);
  const master = createMaster(ctx);
  const bus = ctx.createGain(); bus.gain.value = 1; bus.connect(master);
  const noise = makeNoise(ctx, 42, SR);

  const filtered = events.filter(e => roles.has(e.role));
  let scheduled = 0;
  for (const e of filtered) {
    switch (e.role) {
      case 'kick': playKick(ctx, bus, noise, e.at, e.velocity); break;
      case 'bass': case 'acid': playBass(ctx, bus, e); break;
      case 'lead': playLead(ctx, bus, e); break;
      case 'hat': playHat(ctx, bus, noise, e, e.note === 46); break;
      case 'clap': case 'snare': playClap(ctx, bus, noise, e); break;
      case 'perc': playPerc(ctx, bus, noise, e); break;
      case 'pad': playPad(ctx, bus, e); break;
    }
    scheduled++;
  }

  console.log(`  [${stemName}] ${scheduled} events → rendering...`);
  const rendered = await ctx.startRendering();
  const data = rendered.getChannelData(0);
  const outPath = path.join(OUT_DIR, `${stemName}-baseline.wav`);
  writeWAV(outPath, data as Float32Array, SR);
  // Stats
  let peak = 0, sumSq = 0, nonZero = 0;
  for (let i = 0; i < data.length; i++) { const a = Math.abs(data[i]); if (a > peak) peak = a; sumSq += data[i]*data[i]; if (a > 1e-6) nonZero++; }
  const rms = Math.sqrt(sumSq / data.length);
  const peakDb = 20 * Math.log10(peak || 1e-10);
  const rmsDb = 20 * Math.log10(rms || 1e-10);
  console.log(`    ✓ ${path.basename(outPath)}: peak=${peakDb.toFixed(1)}dB rms=${rmsDb.toFixed(1)}dB nonZero=${((nonZero/data.length)*100).toFixed(1)}%`);
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('══ Phase 1: Baseline Audio Render ══');
  console.log(`  style: ${STYLE}, bpm: ${BPM}, bars: ${BARS}, seed: ${SEED}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`  out: ${OUT_DIR}`);

  // 1. Generate events from the REAL composer
  const composer = new PsytranceComposer();
  const durSec = (60 / BPM) * 4 * BARS;
  const result = composer.compose({
    startTime: 0, duration: durSec, bpm: BPM, style: STYLE, energy: 0.5, seed: SEED, prev: null,
  });
  const events = result.events;
  console.log(`  composer generated ${events.length} events over ${BARS} bars`);

  // Count per role
  const byRole: Record<string, number> = {};
  for (const e of events) byRole[e.role] = (byRole[e.role] || 0) + 1;
  console.log('  events by role:', byRole);

  // 2. Render 4 stems
  await renderStem('kick', events, new Set(['kick']));
  await renderStem('bass', events, new Set(['bass', 'acid']));
  await renderStem('lead', events, new Set(['lead']));
  await renderStem('full', events, new Set(['kick','bass','acid','lead','hat','clap','perc','snare','pad']));

  console.log('\n✓ Phase 1 baseline renders complete.');
  console.log('  Next: run scripts/psy4_audio_analyzer.py on the WAVs, then human listening.');
}

main().catch(e => { console.error('Render failed:', e); process.exit(1); });
