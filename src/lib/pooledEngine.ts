/**
 * PooledEngine — EXPERIMENTAL BACKEND (R5 classification)
 *
 * STATUS: EXPERIMENTAL — NOT CONNECTED TO RUNTIME
 *
 * This module is a pre-allocated voice pool engine that passes its own
 * stress tests (5800 notes, 0 crashes, no node leak, voice reuse confirmed).
 * However, it is NOT imported or used by the live runtime engine (psyLive.ts).
 * The runtime uses inline createOscillator() calls per note instead.
 *
 * The "No GC Dropouts" claim that was previously associated with this module
 * is NOT PROVEN for the runtime, because:
 *   1. This module is dead code (not connected)
 *   2. GC pause measurement requires a real browser audio callback
 *   3. The runtime's inline allocation pattern is what PooledEngine was
 *      designed to prevent
 *
 * DECISION: RETAINED AS EXPERIMENTAL BACKEND
 *   - Not deleted (passes own tests, may be wired in future)
 *   - Not claimed as runtime (honestly classified)
 *   - Integration cost: would require refactoring psyLive.ts voice functions
 *     (kick/bass/lead/hat) to use triggerSynth/triggerDrum instead of
 *     inline createOscillator
 *
 * ARCHITECTURE:
 *   - Pre-allocated voice pools (SynthVoice + DrumVoice)
 *   - Round-robin allocation (no create/destroy per note)
 *   - Full ADSR + filter envelope + LFO per voice
 *   - Effects sends (delay + reverb)
 */
import { type SoundPreset } from './soundBank';

const MAX_SYNTH_VOICES = 16;
const MAX_DRUM_VOICES = 12;

// Tanh saturation curve — makes digital sound warm/analog (from nexus-psy7)
function makeTanhCurve(amount: number): Float32Array {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = amount;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

// Per-track EQ settings (from nexus-psy7)
const TRACK_EQ: Record<string, { low: number; mid: number; high: number }> = {
  kick:  { low: 3,  mid: 0,  high: 2 },
  bass:  { low: 4,  mid: -2, high: -3 },
  lead:  { low: -3, mid: 2,  high: 3 },
  hat:   { low: -12, mid: -3, high: 4 },
  pad:   { low: 0,  mid: 0,  high: 2 },
  pluck: { low: -2, mid: 2,  high: 3 },
  arp:   { low: -3, mid: 2,  high: 3 },
};

// ─── SynthVoice: plays SYNTH/FM presets with full parameter control ───────
export class SynthVoice {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  g1: GainNode;
  g2: GainNode;
  filter: BiquadFilterNode;
  saturation: WaveShaperNode;  // NEW: tanh waveshaper for warm analog sound
  eqLow: BiquadFilterNode;      // NEW: per-voice low shelf EQ
  eqMid: BiquadFilterNode;      // NEW: per-voice mid peak EQ
  eqHigh: BiquadFilterNode;     // NEW: per-voice high shelf EQ
  vca: GainNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
  delaySend: GainNode;
  reverbSend: GainNode;
  active = false;
  ctx: AudioContext;

  constructor(ctx: AudioContext, dest: AudioNode, delayBus: AudioNode, reverbBus: AudioNode) {
    this.ctx = ctx;
    this.osc1 = ctx.createOscillator();
    this.osc2 = ctx.createOscillator();
    this.g1 = ctx.createGain();
    this.g2 = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.saturation = ctx.createWaveShaper();
    this.saturation.curve = makeTanhCurve(2.5);
    this.saturation.oversample = '2x';
    this.eqLow = ctx.createBiquadFilter();
    this.eqMid = ctx.createBiquadFilter();
    this.eqHigh = ctx.createBiquadFilter();
    this.vca = ctx.createGain();
    this.lfo = ctx.createOscillator();
    this.lfoGain = ctx.createGain();
    this.delaySend = ctx.createGain();
    this.reverbSend = ctx.createGain();

    this.g1.gain.value = 0.5;
    this.g2.gain.value = 0.4;
    this.vca.gain.value = 0;
    this.lfoGain.gain.value = 0;
    this.delaySend.gain.value = 0;
    this.reverbSend.gain.value = 0;

    // EQ defaults (transparent)
    this.eqLow.type = 'lowshelf'; this.eqLow.frequency.value = 150; this.eqLow.gain.value = 0;
    this.eqMid.type = 'peaking'; this.eqMid.frequency.value = 800; this.eqMid.Q.value = 1; this.eqMid.gain.value = 0;
    this.eqHigh.type = 'highshelf'; this.eqHigh.frequency.value = 5000; this.eqHigh.gain.value = 0;

    this.osc1.connect(this.g1);
    this.osc2.connect(this.g2);
    this.g1.connect(this.filter);
    this.g2.connect(this.filter);
    // NEW CHAIN: filter → saturation → EQ → VCA (was: filter → VCA)
    this.filter.connect(this.saturation);
    this.saturation.connect(this.eqLow);
    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);
    this.eqHigh.connect(this.vca);
    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.filter.frequency);
    this.vca.connect(dest);
    this.vca.connect(this.delaySend);
    this.delaySend.connect(delayBus);
    this.vca.connect(this.reverbSend);
    this.reverbSend.connect(reverbBus);

    this.osc1.start();
    this.osc2.start();
    this.lfo.start();
  }

  noteOn(preset: SoundPreset, freq: number, when: number, vel: number, stepDur: number): void {
    const p = preset;
    const gate = p.gate ?? 0.6;
    const dur = stepDur * gate * 2;
    const rel = Math.max(p.rel ?? 0.15, 0.02);
    const end = when + dur;

    // Apply per-track EQ based on preset category (from nexus-psy7)
    const eqSettings = TRACK_EQ[p.cat];
    if (eqSettings) {
      this.eqLow.gain.setValueAtTime(eqSettings.low, when);
      this.eqMid.gain.setValueAtTime(eqSettings.mid, when);
      this.eqHigh.gain.setValueAtTime(eqSettings.high, when);
    }

    // Oscillators — detuned dual osc (psy approach: 9 cents default if not specified)
    this.osc1.type = p.wave1 ?? 'sawtooth';
    this.osc2.type = p.wave2 ?? 'sawtooth';
    this.osc1.frequency.setValueAtTime(freq, when);
    this.osc2.frequency.setValueAtTime(freq * Math.pow(2, p.oct2 ?? 0), when);
    // Default detune: 9 cents if not specified (creates rich supersaw like psy)
    const detune = p.detune ?? 9;
    this.osc2.detune.setValueAtTime(detune, when);

    // FM (if FM engine)
    if (p.engine === 'FM' && p.fmAmount && p.fmRatio) {
      this.osc2.frequency.setValueAtTime(freq * (p.fmRatio ?? 2), when);
      this.g2.gain.setValueAtTime(p.fmAmount * 200, when);
    } else {
      this.g2.gain.setValueAtTime(0.4, when);
    }

    // Filter — with envelope sweep (gentler, keeps more harmonics)
    const cut = Math.max(60, Math.min(16000, p.cutoff ?? 1500));
    const res = Math.max(0.2, Math.min(24, p.res ?? 1));
    this.filter.type = p.fType ?? 'lowpass';
    this.filter.Q.setValueAtTime(res, when);
    this.filter.frequency.cancelScheduledValues(when);
    // Filter envelope: start high, sweep to cutoff (creates movement)
    if (p.fEnvAmt && p.fEnvAmt > 0) {
      const peak = Math.min(cut * (1 + p.fEnvAmt * 2), 16000);
      const fDecay = Math.max(p.fDecay ?? 0.16, 0.01);
      this.filter.frequency.setValueAtTime(peak, when);
      this.filter.frequency.exponentialRampToValueAtTime(cut, when + fDecay);
    } else {
      // Gentler sweep: cutoff → 70% (was 35% — was killing harmonics)
      const fEnd = Math.max(120, cut * 0.7);
      this.filter.frequency.setValueAtTime(cut, when);
      this.filter.frequency.exponentialRampToValueAtTime(fEnd, when + 0.2);
    }

    // LFO
    if ((p.lfoRate ?? 0) > 0 && p.lfoDest === 'cutoff') {
      this.lfo.frequency.setValueAtTime(p.lfoRate!, when);
      this.lfoGain.gain.setValueAtTime((p.lfoDepth ?? 0) * 3000, when);
    } else {
      this.lfoGain.gain.setValueAtTime(0, when);
    }

    // Amp envelope (ADSR) — psy approach: fast attack, exponential decay
    const atk = Math.max(p.atk ?? 0.005, 0.003);
    const dec = Math.max(p.dec ?? 0.3, 0.01);
    const sus = Math.max(p.sus ?? 0.6, 0.0);
    const velSens = p.velSens ?? 0.8;
    const amp = vel * (0.5 + velSens * 0.5); // was 0.3 — too quiet

    const vca = this.vca.gain;
    vca.cancelScheduledValues(when);
    vca.setValueAtTime(0.0001, when);
    vca.exponentialRampToValueAtTime(amp, when + atk);
    vca.exponentialRampToValueAtTime(amp * sus, when + atk + dec);
    vca.exponentialRampToValueAtTime(0.0001, end + rel);

    // Effects sends
    this.delaySend.gain.setValueAtTime(p.sendDelay ?? 0, when);
    this.reverbSend.gain.setValueAtTime(p.sendReverb ?? 0, when);

    this.active = true;
    setTimeout(() => { this.active = false; }, (end - when + rel) * 1000 + 100);
  }
}

// ─── DrumVoice: plays DRUM presets ────────────────────────────────────────
export class DrumVoice {
  noise: AudioBufferSourceNode;
  noiseGain: GainNode;
  nFilter: BiquadFilterNode;
  osc: OscillatorNode;
  oscGain: GainNode;
  out: GainNode;
  delaySend: GainNode;
  reverbSend: GainNode;
  active = false;
  ctx: AudioContext;

  constructor(ctx: AudioContext, dest: AudioNode, noiseBuf: AudioBuffer, delayBus: AudioNode, reverbBus: AudioNode) {
    this.ctx = ctx;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = noiseBuf;
    this.noise.loop = true;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.nFilter = ctx.createBiquadFilter();
    this.nFilter.type = 'bandpass';
    this.noise.connect(this.nFilter);
    this.nFilter.connect(this.noiseGain);
    this.osc = ctx.createOscillator();
    this.osc.type = 'sine';
    this.oscGain = ctx.createGain();
    this.oscGain.gain.value = 0;
    this.osc.connect(this.oscGain);
    this.out = ctx.createGain();
    this.noiseGain.connect(this.out);
    this.oscGain.connect(this.out);
    this.out.connect(dest);
    this.delaySend = ctx.createGain();
    this.reverbSend = ctx.createGain();
    this.delaySend.gain.value = 0;
    this.reverbSend.gain.value = 0;
    this.out.connect(this.delaySend);
    this.delaySend.connect(delayBus);
    this.out.connect(this.reverbSend);
    this.reverbSend.connect(reverbBus);
    this.noise.start();
    this.osc.start();
  }

  hit(preset: SoundPreset, when: number, vel: number): void {
    const p = preset;
    const tune = p.tune ?? 1;
    const decay = p.decay ?? 1;
    const tone = p.tone ?? 1;
    const punch = p.punch ?? 0;
    const type = p.drumType ?? 'kick';

    const ng = this.noiseGain.gain;
    const og = this.oscGain.gain;
    ng.cancelScheduledValues(when);
    og.cancelScheduledValues(when);
    ng.setValueAtTime(0, when);
    og.setValueAtTime(0, when);

    if (type === 'kick') {
      const dur = 0.12 + 0.5 * decay;
      this.osc.type = 'sine';
      this.osc.frequency.setValueAtTime(180 * tune, when);
      this.osc.frequency.exponentialRampToValueAtTime(Math.max(36 * tune, 24), when + 0.09);
      og.setValueAtTime(vel * 1.1, when);
      og.exponentialRampToValueAtTime(0.0001, when + dur);
      if (punch > 0) {
        ng.setValueAtTime(vel * punch * 0.8, when);
        ng.exponentialRampToValueAtTime(0.0001, when + 0.02);
        this.nFilter.type = 'bandpass';
        this.nFilter.frequency.setValueAtTime(2500, when);
      }
    } else if (type === 'snare') {
      const dur = 0.1 + 0.16 * decay;
      this.osc.type = 'triangle';
      this.osc.frequency.setValueAtTime(195 * tune, when);
      og.setValueAtTime(vel * 0.5, when);
      og.exponentialRampToValueAtTime(0.0001, when + dur * 0.7);
      this.nFilter.type = 'bandpass';
      this.nFilter.frequency.setValueAtTime(1900 * tone, when);
      this.nFilter.Q.value = 0.8;
      ng.setValueAtTime(vel * 0.85, when);
      ng.exponentialRampToValueAtTime(0.0001, when + dur);
    } else if (type === 'clap') {
      const dur = 0.25 + 0.15 * decay;
      this.nFilter.type = 'bandpass';
      this.nFilter.frequency.setValueAtTime(1150 * tone, when);
      this.nFilter.Q.value = 1.3;
      ng.setValueAtTime(0, when);
      [0, 0.014, 0.03].forEach(t2 => {
        ng.setValueAtTime(0, when + t2);
        ng.linearRampToValueAtTime(vel * 0.9, when + t2 + 0.002);
        ng.exponentialRampToValueAtTime(0.02, when + t2 + 0.012);
      });
      ng.exponentialRampToValueAtTime(0.0001, when + dur);
    } else if (type === 'hatC' || type === 'hatO') {
      const open = type === 'hatO';
      const dur = open ? 0.26 + 0.5 * decay : 0.03 + 0.05 * decay;
      this.nFilter.type = 'highpass';
      this.nFilter.frequency.setValueAtTime(7200 * Math.sqrt(tone), when);
      ng.setValueAtTime(vel * (open ? 0.4 : 0.5), when);
      ng.exponentialRampToValueAtTime(0.0001, when + dur);
    } else if (type === 'tom') {
      const dur = 0.22 + 0.35 * decay;
      this.osc.type = 'sine';
      this.osc.frequency.setValueAtTime(180 * tune, when);
      this.osc.frequency.exponentialRampToValueAtTime(92 * tune, when + dur * 0.7);
      og.setValueAtTime(vel * 0.9, when);
      og.exponentialRampToValueAtTime(0.0001, when + dur);
    } else if (type === 'rim') {
      this.osc.type = 'square';
      this.osc.frequency.setValueAtTime(1750 * tune, when);
      og.setValueAtTime(vel * 0.6, when);
      og.exponentialRampToValueAtTime(0.0001, when + 0.045);
    } else if (type === 'glitch') {
      const dur = 0.08 + 0.14 * decay;
      this.nFilter.type = 'bandpass';
      this.nFilter.frequency.setValueAtTime(1500 * tone + 800, when);
      this.nFilter.Q.value = 4;
      ng.setValueAtTime(vel * 0.7, when);
      ng.exponentialRampToValueAtTime(0.0001, when + dur);
    } else if (type === 'shaker') {
      const dur = 0.04 + 0.07 * decay;
      this.nFilter.type = 'highpass';
      this.nFilter.frequency.setValueAtTime(6000 * tone, when);
      ng.setValueAtTime(vel * 0.45, when);
      ng.exponentialRampToValueAtTime(0.0001, when + dur);
    } else if (type === 'riser') {
      const dur = 1.6;
      this.nFilter.type = 'highpass';
      this.nFilter.frequency.setValueAtTime(300, when);
      this.nFilter.frequency.exponentialRampToValueAtTime(6000, when + dur);
      ng.setValueAtTime(0.0001, when);
      ng.exponentialRampToValueAtTime(vel * 0.6, when + dur);
      ng.exponentialRampToValueAtTime(0.0001, when + dur + 0.05);
    } else if (type === 'impact') {
      const dur = 1.1 * decay + 0.3;
      this.osc.type = 'sine';
      this.osc.frequency.setValueAtTime(60 * tune, when);
      this.osc.frequency.exponentialRampToValueAtTime(30, when + 0.5);
      og.setValueAtTime(vel * 1.1, when);
      og.exponentialRampToValueAtTime(0.0001, when + dur);
    }

    // Effects sends
    this.delaySend.gain.setValueAtTime(p.sendDelay ?? 0, when);
    this.reverbSend.gain.setValueAtTime(p.sendReverb ?? 0, when);

    this.active = true;
    setTimeout(() => { this.active = false; }, 2000);
  }

  panic(): void {
    try {
      this.noiseGain.gain.cancelScheduledValues(0);
      this.noiseGain.gain.setValueAtTime(0, this.ctx.currentTime);
      this.oscGain.gain.cancelScheduledValues(0);
      this.oscGain.gain.setValueAtTime(0, this.ctx.currentTime);
    } catch {}
  }
}

// ─── PooledEngine: manages voice pools ────────────────────────────────────
export class PooledEngine {
  ctx: AudioContext;
  master: GainNode;
  analyser: AnalyserNode;
  delayBus: GainNode;
  delayNode: DelayNode;
  delayFb: GainNode;
  reverbBus: GainNode;
  convolver: ConvolverNode;
  noiseBuf: AudioBuffer;
  synthPool: SynthVoice[] = [];
  drumPool: DrumVoice[] = [];
  synthIdx = 0;
  drumIdx = 0;
  activeCount = 0;
  maxActiveCount = 0;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;

    // Master chain
    this.master = ctx.createGain();
    this.master.gain.value = 1.0; // was 0.85 — too quiet
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.7;
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    // Delay bus
    this.delayBus = ctx.createGain();
    this.delayNode = ctx.createDelay(1.5);
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.35;
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.6;
    this.delayBus.connect(this.delayNode);
    this.delayNode.connect(this.delayFb);
    this.delayFb.connect(this.delayNode);
    this.delayNode.connect(delayOut);
    delayOut.connect(this.master);

    // Reverb bus (convolver with generated IR)
    this.reverbBus = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this.mkIR(ctx);
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.7;
    this.reverbBus.connect(this.convolver);
    this.convolver.connect(reverbOut);
    reverbOut.connect(this.master);

    // Noise buffer
    this.noiseBuf = this.mkNoise(ctx);

    // Pre-allocate voice pools
    for (let i = 0; i < MAX_SYNTH_VOICES; i++) {
      this.synthPool.push(new SynthVoice(ctx, this.master, this.delayBus, this.reverbBus));
    }
    for (let i = 0; i < MAX_DRUM_VOICES; i++) {
      this.drumPool.push(new DrumVoice(ctx, this.master, this.noiseBuf, this.delayBus, this.reverbBus));
    }
  }

  private mkNoise(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private mkIR(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 1.5);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.5);
      }
    }
    return buf;
  }

  // Trigger a synth preset (round-robin allocation)
  triggerSynth(preset: SoundPreset, freq: number, when: number, vel: number, stepDur: number): void {
    // Find inactive voice, or use round-robin
    let voice = this.synthPool[this.synthIdx];
    for (let i = 0; i < this.synthPool.length; i++) {
      const idx = (this.synthIdx + i) % this.synthPool.length;
      if (!this.synthPool[idx].active) {
        voice = this.synthPool[idx];
        this.synthIdx = (idx + 1) % this.synthPool.length;
        break;
      }
    }
    this.synthIdx = (this.synthIdx + 1) % this.synthPool.length;
    voice.noteOn(preset, freq, when, vel, stepDur);
    // Report active count for UI
    this.activeCount = this.synthPool.filter(v => v.active).length + this.drumPool.filter(v => v.active).length;
    if (this.activeCount > this.maxActiveCount) this.maxActiveCount = this.activeCount;
  }

  // Trigger a drum preset (round-robin allocation)
  triggerDrum(preset: SoundPreset, when: number, vel: number): void {
    let voice = this.drumPool[this.drumIdx];
    for (let i = 0; i < this.drumPool.length; i++) {
      const idx = (this.drumIdx + i) % this.drumPool.length;
      if (!this.drumPool[idx].active) {
        voice = this.drumPool[idx];
        this.drumIdx = (idx + 1) % this.drumPool.length;
        break;
      }
    }
    this.drumIdx = (this.drumIdx + 1) % this.drumPool.length;
    voice.hit(preset, when, vel);
    // Report active count for UI
    this.activeCount = this.synthPool.filter(v => v.active).length + this.drumPool.filter(v => v.active).length;
    if (this.activeCount > this.maxActiveCount) this.maxActiveCount = this.activeCount;
  }

  killAll(): void {
    this.synthPool.forEach(v => { try { v.vca.gain.cancelScheduledValues(0); v.vca.gain.setValueAtTime(0, this.ctx.currentTime); } catch {} });
    this.drumPool.forEach(v => v.panic());
  }

  setMasterVolume(v: number): void {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }
}
