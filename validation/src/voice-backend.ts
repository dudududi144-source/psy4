/**
 * PSY4 Vertical Validation — Refactored Voice Backend (B/C/D/E)
 *
 * Voice functions refactored to accept VoiceSpecification instead of hardcoded params.
 * Used by variants B (raw), C (codebook defaults), D (+performance), E (+acoustic).
 *
 * The DSP logic is improved over variant A:
 * - Kick: real sample + synth sub layer (hybrid)
 * - Bass: 3-layer with filter envelope that can be controlled
 * - Lead: AdvancedSynthVoice (FM/wavetable/supersaw)
 * - Hat: real sample
 *
 * BUT: same DSP for all of B/C/D/E. The only difference is how the
 * VoiceSpecification is BUILT (raw vs codebook vs +performance vs +acoustic).
 */

import type { VoiceSpecification } from './types.ts';
import { SampleBank } from './sample-bank.ts';
import { mtof } from './audio-utils.ts';
import { AdvancedSynthVoice, type AdvancedSynthPreset } from '../../src/lib/studio/engine/advancedVoice.ts';

// ─── Kick: hybrid (sample + synth sub) ──────────────────────────────────────
export function playKickVoice(
  ctx: OfflineAudioContext,
  bus: GainNode,
  noiseBuf: AudioBuffer,
  sampleBank: SampleBank,
  kickSample: AudioBuffer | null,
  spec: VoiceSpecification,
  t: number,
): void {
  const p = spec.performance;
  const time = t + p.microTimingSec;

  // 1. Sample layer (the real kick)
  if (kickSample) {
    const src = ctx.createBufferSource();
    src.buffer = kickSample;
    // Pitch-shift via playbackRate if needed (sample is at 44100, we're at 44100)
    src.playbackRate.value = 1.0;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(p.velocity * 0.9, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
    src.connect(gain);
    gain.connect(bus);
    src.start(time);
    src.stop(time + 0.35);
  }

  // 2. Synth sub layer (reinforces the low end at the notated pitch)
  const subFreq = p.frequency; // kick midi 36 → ~65Hz
  const sub = ctx.createOscillator(); sub.type = 'sine';
  sub.frequency.setValueAtTime(subFreq * 2, time);
  sub.frequency.exponentialRampToValueAtTime(subFreq, time + 0.02);
  const subGain = ctx.createGain();
  const subDecay = spec.acousticTargets.envelope.decay;
  subGain.gain.setValueAtTime(0, time);
  subGain.gain.linearRampToValueAtTime(0.4 * p.velocity, time + 0.003);
  subGain.gain.exponentialRampToValueAtTime(0.001, time + subDecay);
  sub.connect(subGain); subGain.connect(bus);
  sub.start(time); sub.stop(time + subDecay + 0.01);
}

// ─── Bass: 3-layer subtractive ──────────────────────────────────────────────
export function playBassVoice(
  ctx: OfflineAudioContext,
  bus: GainNode,
  spec: VoiceSpecification,
  t: number,
): void {
  const p = spec.performance;
  const sg = spec.source.synthGraph!;
  const at = spec.acousticTargets;
  const time = t + p.microTimingSec;
  const freq = p.frequency;

  // Use acousticTargets.envelope if it differs from synthGraph defaults (E variant).
  // For B/C/D, acousticTargets.envelope == synthGraph.amplifier (same values).
  // For E, acousticTargets.envelope is BPM-aware (different values).
  const env = at.envelope;
  const attack = env.attack;
  const decay = env.decay;

  // 1. SUB — sine fundamental
  const sub = ctx.createOscillator(); sub.type = 'sine';
  sub.frequency.value = freq;
  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0.0001, time);
  subGain.gain.linearRampToValueAtTime(0.4 * p.velocity, time + attack);
  subGain.gain.linearRampToValueAtTime(0.0, time + decay);
  sub.connect(subGain); subGain.connect(bus);
  sub.start(time); sub.stop(time + decay + 0.01);

  // 2. MID — harmonic osc through closing filter (the pluck)
  const mid = ctx.createOscillator();
  const midOsc = sg.oscillators.find(o => o.role === 'carrier')!;
  mid.type = (midOsc.type === 'periodic' ? 'sawtooth' : midOsc.type) as OscillatorType;
  mid.frequency.value = freq;
  mid.detune.value = midOsc.detune;

  const filter = ctx.createBiquadFilter();
  filter.type = sg.filter.type;
  filter.Q.value = sg.filter.Q;
  // Filter envelope uses the BPM-aware decay from acoustic targets if available
  const fStart = Math.max(1000, sg.filter.cutoff);
  const fEnd = Math.max(150, sg.filter.cutoff * (1 - sg.filter.envAmount));
  filter.frequency.setValueAtTime(fStart, time);
  // Filter close time tracks the acoustic envelope decay (E: BPM-aware; D: default)
  filter.frequency.exponentialRampToValueAtTime(fEnd, time + Math.min(sg.filter.envDecay, decay * 0.4));

  const midGain = ctx.createGain();
  midGain.gain.setValueAtTime(0.0001, time);
  midGain.gain.linearRampToValueAtTime(0.25 * p.velocity, time + attack);
  midGain.gain.linearRampToValueAtTime(0.0, time + decay);
  mid.connect(filter); filter.connect(midGain); midGain.connect(bus);
  mid.start(time); mid.stop(time + decay + 0.01);

  // 3. CHARACTER — noise transient
  const charBuf = ctx.createBuffer(1, Math.floor(0.012 * 44100), 44100);
  const charData = charBuf.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < charData.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; charData[i] = (s / 0x100000000) * 2 - 1; }
  const char = ctx.createBufferSource(); char.buffer = charBuf;
  const charBp = ctx.createBiquadFilter(); charBp.type = 'bandpass';
  charBp.frequency.value = freq * 4; charBp.Q.value = 2;
  const charGain = ctx.createGain();
  charGain.gain.setValueAtTime(0.15 * p.velocity, time);
  charGain.gain.exponentialRampToValueAtTime(0.001, time + 0.01);
  char.connect(charBp); charBp.connect(charGain); charGain.connect(bus);
  char.start(time); char.stop(time + 0.012);
}

// ─── Lead: AdvancedSynthVoice (FM/wavetable/supersaw) ───────────────────────
// We use AdvancedSynthVoice directly. It handles all 4 modes.
// We just need to convert VoiceSpecification → AdvancedSynthPreset.

const leadVoicePool: AdvancedSynthVoice[] = [];
let leadVoiceIdx = 0;

function getLeadVoice(ctx: OfflineAudioContext): AdvancedSynthVoice {
  // For offline rendering, we create a new voice per note (simpler than pooling).
  // AdvancedSynthVoice uses setTimeout for deferred deactivation — in offline
  // rendering, setTimeout callbacks don't fire (rendering is synchronous), so
  // the per-osc nodes aren't torn down during render. That's fine — we just
  // need the nodes to exist during rendering.
  return new AdvancedSynthVoice(ctx, leadVoiceIdx++);
}

export function playLeadVoice(
  ctx: OfflineAudioContext,
  bus: GainNode,
  spec: VoiceSpecification,
  t: number,
): void {
  const p = spec.performance;
  const sg = spec.source.synthGraph!;
  const time = t + p.microTimingSec;

  // Determine mode from synthGraph structure
  let mode: 'classic' | 'fm' | 'supersaw' | 'wavetable' = 'classic';
  if (sg.oscillators.some(o => o.role === 'modulator')) mode = 'fm';
  else if (sg.oscillators.length > 2) mode = 'supersaw';
  else if (sg.oscillators.some(o => o.type === 'periodic')) mode = 'wavetable';

  const preset: AdvancedSynthPreset = {
    mode,
    wave1: (sg.oscillators[0]?.type === 'periodic' ? 'sawtooth' : sg.oscillators[0]?.type ?? 'sawtooth') as OscillatorType,
    wave2: (sg.oscillators[1]?.type === 'periodic' ? 'sawtooth' : sg.oscillators[1]?.type ?? 'sawtooth') as OscillatorType,
    oct2: 0,
    detune: sg.oscillators[0]?.detune ?? 0,
    cutoff: sg.filter.cutoff,
    res: sg.filter.Q,
    fType: sg.filter.type,
    atk: sg.amplifier.attack,
    dec: sg.amplifier.decay,
    sus: sg.amplifier.sustain,
    rel: sg.amplifier.release,
    gate: 0.6,
    lfoRate: sg.lfo?.rate ?? 4,
    lfoDepth: sg.lfo?.depth ?? 0,
    lfoDest: sg.lfo?.target === 'pitch' ? 'pitch' : sg.lfo?.target === 'amplitude' ? 'amp' : 'cutoff',
    poly: 1,
    // FM
    fmRatio: sg.oscillators.find(o => o.role === 'modulator')?.ratio ?? 2,
    fmDepth: sg.fmDepth ?? 0,
    fmEnvAmount: 0.5,
    // Supersaw
    sawCount: mode === 'supersaw' ? sg.oscillators.length : 5,
    sawDetune: 12,
    sawSpread: sg.stereo.width,
    // Wavetable
    wtPosition: 0.5,
    wtMorphRate: sg.lfo?.rate ?? 0.5,
    wtPair: 0,
  };

  const voice = getLeadVoice(ctx);
  voice.connect(bus);
  const stepDur = 0.25; // 16th note at 145 BPM ≈ 103ms — but AdvancedSynthVoice multiplies by gate*2
  voice.noteOn(preset, time, p.frequency > 0 ? Math.round(69 + 12 * Math.log2(p.frequency / 440)) : 60, p.velocity, stepDur * (p.durationSec / stepDur), bus);
}

// ─── Hat: real sample ───────────────────────────────────────────────────────
export function playHatVoice(
  ctx: OfflineAudioContext,
  bus: GainNode,
  hatSample: AudioBuffer | null,
  spec: VoiceSpecification,
  t: number,
): void {
  if (!hatSample) return;
  const p = spec.performance;
  const time = t + p.microTimingSec;
  const src = ctx.createBufferSource();
  src.buffer = hatSample;
  src.playbackRate.value = 1.0;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(p.velocity * 0.4, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
  src.connect(gain);
  gain.connect(bus);
  src.start(time);
  src.stop(time + 0.1);
}
