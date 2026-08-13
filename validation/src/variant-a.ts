/**
 * PSY4 Vertical Validation — VARIANT A (current psyLive, baseline)
 *
 * Uses the EXACT voice functions from src/lib/psyLive.ts (lines 481-674).
 * No changes. No contract. Hardcoded params. This is the baseline.
 *
 * The voice functions are replicated here (not imported) because psyLive.ts
 * depends on browser APIs (window, AudioContext) that don't exist in the
 * offline render environment. The DSP logic is identical.
 */

import type { CompositionEvent, ExperimentalUnit } from './types.ts';
import { createRenderCtx, mtof, writeWAV, unitDurationSec, type MasterChain } from './audio-utils.ts';

// ─── Voice functions (EXACT copy of psyLive.ts, adapted for OfflineAudioContext) ──

function playKick(ctx: OfflineAudioContext, bus: GainNode, noiseBuf: AudioBuffer, t: number, velocity: number = 0.9): void {
  const v = Math.max(0.1, Math.min(1, velocity));

  // 1. TRANSIENT — sharp click (3ms)
  const click = ctx.createBufferSource(); click.buffer = noiseBuf;
  const clickHp = ctx.createBiquadFilter(); clickHp.type = 'highpass'; clickHp.frequency.value = 5000;
  const clickGain = ctx.createGain();
  clickGain.gain.setValueAtTime(0.4 * v, t);
  clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.003);
  click.connect(clickHp); clickHp.connect(clickGain); clickGain.connect(bus);
  click.start(t); click.stop(t + 0.005);

  // 2. PITCH-DROP BODY — 120→48Hz in 15ms, 80ms decay
  const body = ctx.createOscillator(); body.type = 'sine';
  body.frequency.setValueAtTime(120, t);
  body.frequency.exponentialRampToValueAtTime(48, t + 0.015);
  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(0, t);
  bodyGain.gain.linearRampToValueAtTime(0.8 * v, t + 0.0005);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  body.connect(bodyGain); bodyGain.connect(bus);
  body.start(t); body.stop(t + 0.09);

  // 3. SUB BODY — 48Hz weight (100ms tail)
  const sub = ctx.createOscillator(); sub.type = 'sine';
  sub.frequency.setValueAtTime(48, t);
  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0, t);
  subGain.gain.linearRampToValueAtTime(0.5 * v, t + 0.003);
  subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  sub.connect(subGain); subGain.connect(bus);
  sub.start(t); sub.stop(t + 0.11);
}

function playHat(ctx: OfflineAudioContext, bus: GainNode, noiseBuf: AudioBuffer, t: number, lvl: number, open: boolean = false): void {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 10000; bp.Q.value = 0.7;
  const gain = ctx.createGain();
  const decay = open ? 0.12 : 0.04;
  gain.gain.setValueAtTime(Math.max(0.001, lvl), t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
  src.connect(hp); hp.connect(bp); bp.connect(gain); gain.connect(bus);
  src.start(t); src.stop(t + decay + 0.01);
}

// psyLive Variant A (hardcoded)
const VARIANT_A = {
  bassWave: 'sawtooth' as OscillatorType,
  bassCut: 700,
  bassQ: 6,
  leadWave: 'sawtooth' as OscillatorType,
  leadCut: 1800,
  leadQ: 9,
  hatLvl: 0.12,
  leadLvl: 0.45,
};

function playBass(ctx: OfflineAudioContext, bus: GainNode, t: number, freq: number, velocity: number = 0.85): void {
  const v = VARIANT_A;
  const vel = Math.max(0.1, Math.min(1, velocity));

  // 1. SUB
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = freq;
  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0.0001, t);
  subGain.gain.linearRampToValueAtTime(0.4 * vel, t + 0.001);
  subGain.gain.linearRampToValueAtTime(0.0, t + 0.065);
  sub.connect(subGain); subGain.connect(bus);
  sub.start(t); sub.stop(t + 0.07);

  // 2. MID — harmonic oscillator through rapidly closing LPF
  const mid = ctx.createOscillator(); mid.type = v.bassWave; mid.frequency.value = freq;
  const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = v.bassQ;
  const fStart = Math.max(1000, v.bassCut);
  const fEnd = Math.max(150, v.bassCut * 0.25);
  filter.frequency.setValueAtTime(fStart, t);
  filter.frequency.exponentialRampToValueAtTime(fEnd, t + 0.025);
  const midGain = ctx.createGain();
  midGain.gain.setValueAtTime(0.0001, t);
  midGain.gain.linearRampToValueAtTime(0.25 * vel, t + 0.001);
  midGain.gain.linearRampToValueAtTime(0.0, t + 0.065);
  mid.connect(filter); filter.connect(midGain); midGain.connect(bus);
  mid.start(t); mid.stop(t + 0.07);

  // 3. CHARACTER — short noise transient
  // (uses deterministic noise — passed in via ctx, but for simplicity we use a fresh buffer here)
  const charBuf = ctx.createBuffer(1, Math.floor(0.012 * 44100), 44100);
  const charData = charBuf.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < charData.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; charData[i] = (s / 0x100000000) * 2 - 1; }
  const char = ctx.createBufferSource(); char.buffer = charBuf;
  const charBp = ctx.createBiquadFilter(); charBp.type = 'bandpass';
  charBp.frequency.value = freq * 4; charBp.Q.value = 2;
  const charGain = ctx.createGain();
  charGain.gain.setValueAtTime(0.15 * vel, t);
  charGain.gain.exponentialRampToValueAtTime(0.001, t + 0.01);
  char.connect(charBp); charBp.connect(charGain); charGain.connect(bus);
  char.start(t); char.stop(t + 0.012);
}

function playLead(ctx: OfflineAudioContext, bus: GainNode, t: number, freq: number, accent: boolean): void {
  const v = VARIANT_A;
  const peakCut = Math.max(200, v.leadCut * (accent ? 1.2 : 1));
  const oscs: OscillatorNode[] = [];
  const detunes = [-7, 0, 7];
  for (const det of detunes) {
    const o = ctx.createOscillator();
    o.type = v.leadWave;
    o.frequency.value = freq;
    o.detune.value = det;
    oscs.push(o);
  }
  const merger = ctx.createGain();
  const panL = ctx.createStereoPanner(); panL.pan.value = -0.6;
  const panC = ctx.createStereoPanner(); panC.pan.value = 0;
  const panR = ctx.createStereoPanner(); panR.pan.value = 0.6;
  oscs[0].connect(panL); panL.connect(merger);
  oscs[1].connect(panC); panC.connect(merger);
  oscs[2].connect(panR); panR.connect(merger);

  const filter = ctx.createBiquadFilter(); filter.type = 'lowpass';
  filter.Q.value = Math.min(7, v.leadQ);
  filter.frequency.setValueAtTime(300, t);
  filter.frequency.exponentialRampToValueAtTime(peakCut, t + 0.03);
  filter.frequency.exponentialRampToValueAtTime(Math.max(400, peakCut * 0.5), t + 0.3);

  const gain = ctx.createGain();
  const peak = Math.max(0.05, v.leadLvl * 0.7 * (accent ? 1 : 0.75));
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(peak * 0.4, t + 0.15);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

  // Waveshaper (light saturation)
  const shaper = ctx.createWaveShaper();
  const samples = 1024;
  const curve = new Float32Array(samples);
  const k = 2;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  shaper.curve = curve;

  merger.connect(filter); filter.connect(gain); gain.connect(shaper); shaper.connect(bus);
  for (const o of oscs) { o.start(t); o.stop(t + 0.42); }
}

// ─── Variant A renderer ─────────────────────────────────────────────────────

export async function renderVariantA(unit: ExperimentalUnit, outPath: string): Promise<void> {
  const dur = unitDurationSec(unit.bars, unit.bpm);
  const { ctx, master, noiseBuf } = createRenderCtx(dur);

  // Buses (same gains as psyLive)
  const kickBus = ctx.createGain(); kickBus.gain.value = 0.7;
  const bassBus = ctx.createGain(); bassBus.gain.value = 0.5;
  const leadBus = ctx.createGain(); leadBus.gain.value = 0.5;
  const hatBus = ctx.createGain(); hatBus.gain.value = 0.5;

  kickBus.connect(master.input);
  bassBus.connect(master.input);
  leadBus.connect(master.input);
  hatBus.connect(master.input);

  const stepDur = (60 / unit.bpm) / 4;

  for (const ev of unit.events) {
    // Variant A: raw step time, no microtiming (Foundation output used directly)
    const time = ev.step * stepDur;

    if (ev.trackName === 'kick' || (ev.sourceMaterial === 'drum-pattern' && ev.midi === 36)) {
      playKick(ctx, kickBus, noiseBuf, time, ev.velocity);
    } else if (ev.trackName === 'hat') {
      playHat(ctx, hatBus, noiseBuf, time, VARIANT_A.hatLvl * ev.velocity * 2.5, false);
    } else if (ev.sourceMaterial === 'bass-pattern') {
      playBass(ctx, bassBus, time, mtof(ev.midi), ev.velocity);
    } else if (ev.sourceMaterial === 'motif') {
      playLead(ctx, leadBus, time, mtof(ev.midi), ev.velocity > 0.8);
    }
  }

  const rendered = await ctx.startRendering();
  writeWAV(outPath, rendered.getChannelData(0));
}
