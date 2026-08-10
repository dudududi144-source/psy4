/**
 * LegacyAudioGraph — Task F1-F3: the legacy Web Audio node graph as an
 * AudioBackend implementation.
 *
 * This is the FALLBACK backend, used when the AudioWorklet fails to load
 * (browser doesn't support AudioWorklet, worklet file 404, syntax error).
 * It's the original 1054-node graph: master chain + multiband + per-track
 * TrackEffectsRacks + send effects (chorus/phaser/distortion/bitcrush) +
 * reverb (ConvolverNode) + delay (ping-pong) + voice pools (AdvancedSynthVoice
 * + PooledDrumVoice).
 *
 * Architecture: same AudioBackend interface as WorkletEngine. Psy4EngineV2
 * calls `this.audio.triggerDrum(...)` / `this.audio.setWorld(...)` etc. —
 * no conditionals. The engine decides at init() time which backend to use;
 * once decided, it commits for the session.
 *
 * The engine owns ALL musical logic (pursuit, learning, timbre blending,
 * synth mode overrides). This class owns the audio nodes. The engine
 * passes the FINAL computed params (decay, timbre, mode) to the trigger
 * methods; this class fires the voices with those params.
 *
 * Why keep this? The worklet is the primary path (10-50x more efficient,
 * better DSP), but some edge cases (old browsers, CSP issues, worklet
 * bugs) need a fallback. This class ensures the engine still produces
 * audio if the worklet fails.
 */

import { World } from './worlds';
import {
  AdvancedSynthVoice,
  AdvancedSynthPreset,
  SynthMode,
  getAdvancedSynthPreset,
} from './advancedVoice';
import { TrackEffectsRack, TrackRackConfig } from './effectsRack';
import { ChorusSend, PhaserSend, DistortionSend, BitcrushSend } from './sendEffects';
import { MultibandCompressor } from './multibandCompressor';
import { mtof } from './musicalGrammar';
import type {
  AudioBackend,
  AudioBackendStatus,
  AudioBackendParams,
  AudioBackendFXConfig,
  SynthTimbre,
  TriggerSynthOpts,
} from './audioBackend';
// Circular import: psy4EngineV2 imports LegacyAudioGraph (to construct it as
// fallback), and we import buildTrackRackConfigs from psy4EngineV2. This is
// safe in ES modules because we only USE the import inside a method (at
// runtime), not at module-load time. TypeScript + bundlers handle this fine.
import { buildTrackRackConfigs } from './psy4EngineV2';

// ─── Drum + synth preset types (mirror psy4EngineV2's internal types) ──────
// These are duplicated to keep the LegacyEngineAccess interface self-contained.
// The engine passes its own DRUM_PRESETS / SYNTH_PRESETS at construction time.

interface DrumPreset {
  type: string; tune: number; decay: number; tone: number; punch: number;
}
interface SynthPreset {
  wave1: OscillatorType; wave2: OscillatorType; oct2: number; detune: number;
  cutoff: number; res: number; fType: BiquadFilterType;
  atk: number; dec: number; sus: number; rel: number; gate: number;
  lfoRate: number; lfoDepth: number; lfoDest: string; poly: number;
}

interface Track {
  idx: number;
  kind: 'drum' | 'synth';
  name: string;
  presetId: string;
  mix: { vol: number; pan: number; mute: boolean; sendA: number; sendB: number };
}

// ─── Pooled drum voice (mirror of psy4EngineV2's PooledDrumVoice) ──────────
class PooledDrumVoice {
  noise: AudioBufferSourceNode;
  noiseGain: GainNode;
  nFilter: BiquadFilterNode;
  osc: OscillatorNode;
  oscGain: GainNode;
  out: GainNode;
  bus: GainNode | null = null;

  constructor(ctx: AudioContext, noiseBuffer: AudioBuffer) {
    this.noise = ctx.createBufferSource();
    this.noise.buffer = noiseBuffer;
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
    this.noise.start();
    this.osc.start();
  }

  connect(bus: GainNode) {
    if (this.bus !== bus) {
      this.out.disconnect();
      this.out.connect(bus);
      this.bus = bus;
    }
  }

  hit(p: DrumPreset, when: number, vel: number, bus: GainNode, decayOverride?: number) {
    this.connect(bus);
    const tune = p.tune || 1;
    const candidateDecay = (typeof decayOverride === 'number'
      && isFinite(decayOverride) && decayOverride > 0.001 && decayOverride < 50)
      ? decayOverride
      : null;
    const decay = candidateDecay ?? p.decay ?? 1;
    const tone = p.tone || 1;
    const punch = p.punch || 0;
    const type = p.type;
    const ng = this.noiseGain.gain;
    const og = this.oscGain.gain;
    ng.cancelScheduledValues(when);
    og.cancelScheduledValues(when);
    ng.setValueAtTime(0, when);
    og.setValueAtTime(0, when);

    if (type === 'kick') {
      const dur = 0.12 + 0.5 * decay;
      this.osc.frequency.setValueAtTime(180 * tune, when);
      this.osc.frequency.exponentialRampToValueAtTime(Math.max(36 * tune, 24), when + 0.09);
      og.setValueAtTime(vel * 1.1, when);
      og.exponentialRampToValueAtTime(0.0001, when + dur);
      if (punch > 0) {
        ng.setValueAtTime(vel * punch * 0.8, when);
        ng.exponentialRampToValueAtTime(0.0001, when + 0.02);
        this.nFilter.frequency.setValueAtTime(2500, when);
      }
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
    } else if (type === 'shaker') {
      const dur = 0.04 + 0.07 * decay;
      this.nFilter.type = 'highpass';
      this.nFilter.frequency.setValueAtTime(6000 * tone, when);
      ng.setValueAtTime(vel * 0.45, when);
      ng.exponentialRampToValueAtTime(0.0001, when + dur);
    } else if (type === 'glitch') {
      const dur = 0.08 + 0.14 * decay;
      this.nFilter.type = 'bandpass';
      this.nFilter.frequency.setValueAtTime(1500 * tone + 800, when);
      this.nFilter.Q.value = 4;
      ng.setValueAtTime(vel * 0.7, when);
      ng.exponentialRampToValueAtTime(0.0001, when + dur);
    }
  }

  panic(ctx: AudioContext) {
    try {
      this.noiseGain.gain.cancelScheduledValues(0);
      this.noiseGain.gain.setValueAtTime(0, ctx.currentTime);
      this.oscGain.gain.cancelScheduledValues(0);
      this.oscGain.gain.setValueAtTime(0, ctx.currentTime);
    } catch {}
  }
}

// ─── Engine access: the musical state the legacy graph needs ───────────────
// The engine passes itself (or a subset) so the legacy graph can read the
// current tracks, synth mode overrides, etc. This avoids duplicating state.
export interface LegacyEngineAccess {
  /** The 8 tracks (engine owns + mutates presetId; legacy graph reads). */
  tracks: Track[];
  /** Drum preset lookup (engine's DRUM_PRESETS). */
  drumPresets: Record<string, DrumPreset>;
  /** Synth preset lookup (engine's SYNTH_PRESETS). */
  synthPresets: Record<string, SynthPreset>;
  /** Per-track synth-mode overrides (set by reference pursuit). */
  synthModeOverrides: Partial<Record<number, SynthMode>>;
  /** Real-time FM depth modulation (0-8, 0 = no override). */
  fmDepthOverride: number;
  /** Real-time wavetable position modulation (-1 = no override). */
  wtPositionOverride: number;
  /** Supersaw osc cap (quality: 3/4/7). */
  maxSupersawOsc: number;
  /** Lead filter cutoff override (flow filter sweep, -1 = no override). */
  leadCutoffOverride: number;
}

const clamp = (v: number, a: number, b: number) => v < a ? a : (v > b ? b : v);

// ─── LegacyAudioGraph ──────────────────────────────────────────────────────

export class LegacyAudioGraph implements AudioBackend {
  private ctx: AudioContext;
  private engine: LegacyEngineAccess;
  private world: World;

  // Master chain
  private master: GainNode;
  private comp: DynamicsCompressorNode;
  private saturator: WaveShaperNode;
  private toneLow: BiquadFilterNode;
  private toneHigh: BiquadFilterNode;
  private analyser: AnalyserNode;
  private multiband: MultibandCompressor;

  // Delay (ping-pong)
  private delaySend: GainNode;
  private delay: DelayNode;
  private delayFb: GainNode;
  private delayReturn: GainNode;

  // Reverb
  private reverbSend: GainNode;
  private reverb: ConvolverNode;
  private reverbReturn: GainNode;

  // Send effects (E1)
  private chorusSend: GainNode;
  private chorusEffect: ChorusSend;
  private chorusReturn: GainNode;
  private phaserSend: GainNode;
  private phaserEffect: PhaserSend;
  private phaserReturn: GainNode;
  private distortionSend: GainNode;
  private distortionEffect: DistortionSend;
  private distortionReturn: GainNode;
  private bitcrushSend: GainNode;
  private bitcrushEffect: BitcrushSend;
  private bitcrushReturn: GainNode;

  // Track buses
  private duckGain: GainNode;
  private chains: GainNode[] = [];      // rack.input per track
  private trackGains: GainNode[] = [];  // rack.output per track
  private racks: TrackEffectsRack[] = [];

  // Voice pools
  private noiseBuffer: AudioBuffer;
  private synthPool: AdvancedSynthVoice[] = [];
  private drumPool: PooledDrumVoice[] = [];
  private synthIdx = 0;
  private drumIdx = 0;

  // Effective params cache (for getParams())
  private effectiveWorld: Record<string, number> = {};
  private effectiveFX: AudioBackendFXConfig = {};
  private playing = false;

  constructor(ctx: AudioContext, world: World, engine: LegacyEngineAccess) {
    this.ctx = ctx;
    this.engine = engine;
    this.world = world;
    const c = ctx;

    // Noise buffer
    this.noiseBuffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const nd = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // Master chain
    this.master = c.createGain();
    this.master.gain.value = 1.1;

    this.saturator = c.createWaveShaper();
    this.saturator.oversample = '4x';
    const satCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 512) - 1;
      satCurve[i] = Math.tanh(x * 1.3) * 0.7 + x * 0.3;
    }
    this.saturator.curve = satCurve;

    this.toneLow = c.createBiquadFilter();
    this.toneLow.type = 'lowshelf';
    this.toneLow.frequency.value = 110;
    this.toneLow.gain.value = 1.5;
    this.toneHigh = c.createBiquadFilter();
    this.toneHigh.type = 'highshelf';
    this.toneHigh.frequency.value = 8500;
    this.toneHigh.gain.value = -2;

    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -3;
    this.comp.knee.value = 6;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.002;
    this.comp.release.value = 0.15;

    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 2048;

    this.multiband = new MultibandCompressor(c, {
      crossoverLow: 200, crossoverHigh: 2000,
      lowThreshold: -18, lowRatio: 4, lowAttack: 0.012, lowRelease: 0.2, lowKnee: 6, lowMakeup: 1.2,
      midThreshold: -20, midRatio: 3, midAttack: 0.008, midRelease: 0.15, midKnee: 10, midMakeup: 1.1,
      highThreshold: -22, highRatio: 2, highAttack: 0.003, highRelease: 0.08, highKnee: 12, highMakeup: 1.0,
    });

    this.master.connect(this.saturator);
    this.saturator.connect(this.toneLow);
    this.toneLow.connect(this.toneHigh);
    this.toneHigh.connect(this.multiband.input);
    this.multiband.output.connect(this.comp);
    this.comp.connect(this.analyser);
    this.analyser.connect(c.destination);

    // Delay
    this.delaySend = c.createGain();
    this.delaySend.gain.value = 0.15;
    this.delay = c.createDelay(0.5);
    this.delay.delayTime.value = 0.375;
    this.delayFb = c.createGain();
    this.delayFb.gain.value = 0.35;
    this.delayReturn = c.createGain();
    this.delayReturn.gain.value = 0.5;
    const dLP = c.createBiquadFilter();
    dLP.type = 'lowpass';
    dLP.frequency.value = 3300;
    this.delaySend.connect(this.delay);
    this.delay.connect(dLP);
    dLP.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    this.delay.connect(this.delayReturn);
    this.delayReturn.connect(this.master);

    // Reverb
    this.reverbSend = c.createGain();
    this.reverbSend.gain.value = 0.12;
    this.reverb = c.createConvolver();
    const irLen = Math.floor(c.sampleRate * 1.5);
    const ir = c.createBuffer(2, irLen, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (c.sampleRate * 0.4));
      }
    }
    this.reverb.buffer = ir;
    this.reverbReturn = c.createGain();
    this.reverbReturn.gain.value = 0.6;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.master);

    // Send effects
    this.chorusSend = c.createGain();
    this.chorusSend.gain.value = 1.0;
    this.chorusEffect = new ChorusSend(c, { rate: 0.5, depth: 0.004, baseDelay: 0.012, wet: 0.6, dry: 0.7 });
    this.chorusReturn = c.createGain();
    this.chorusReturn.gain.value = 0.5;
    this.chorusSend.connect(this.chorusEffect.input);
    this.chorusEffect.output.connect(this.chorusReturn);
    this.chorusReturn.connect(this.master);

    this.phaserSend = c.createGain();
    this.phaserSend.gain.value = 1.0;
    this.phaserEffect = new PhaserSend(c, { rate: 0.3, depth: 0.6, baseFreq: 800, feedback: 0.4, stages: 6, wet: 0.55, dry: 0.6 });
    this.phaserReturn = c.createGain();
    this.phaserReturn.gain.value = 0.5;
    this.phaserSend.connect(this.phaserEffect.input);
    this.phaserEffect.output.connect(this.phaserReturn);
    this.phaserReturn.connect(this.master);

    this.distortionSend = c.createGain();
    this.distortionSend.gain.value = 1.0;
    this.distortionEffect = new DistortionSend(c, { drive: 4, tone: 4000, wet: 0.5, dry: 0.5 });
    this.distortionReturn = c.createGain();
    this.distortionReturn.gain.value = 0.4;
    this.distortionSend.connect(this.distortionEffect.input);
    this.distortionEffect.output.connect(this.distortionReturn);
    this.distortionReturn.connect(this.master);

    this.bitcrushSend = c.createGain();
    this.bitcrushSend.gain.value = 1.0;
    this.bitcrushEffect = new BitcrushSend(c, { bits: 6, holdMs: 4, tone: 2500, wet: 0.5, dry: 0.6 });
    this.bitcrushReturn = c.createGain();
    this.bitcrushReturn.gain.value = 0.35;
    this.bitcrushSend.connect(this.bitcrushEffect.input);
    this.bitcrushEffect.output.connect(this.bitcrushReturn);
    this.bitcrushReturn.connect(this.master);

    // Track buses
    this.duckGain = c.createGain();
    this.duckGain.gain.value = 1.0;
    this.duckGain.connect(this.master);

    // Build racks from the world config
    const rackConfigs = this.buildRackConfigs(world);
    for (let i = 0; i < 8; i++) {
      const rack = new TrackEffectsRack(c, rackConfigs[i]);
      this.racks.push(rack);
      this.chains.push(rack.input);
      this.trackGains.push(rack.output);
      if (i === 4) {
        rack.output.connect(this.duckGain);
      } else {
        rack.output.connect(this.master);
      }
      rack.connectSend('reverb', this.reverbSend);
      rack.connectSend('delay', this.delaySend);
      rack.connectSend('chorus', this.chorusSend);
      rack.connectSend('phaser', this.phaserSend);
      rack.connectSend('distortion', this.distortionSend);
      rack.connectSend('bitcrush', this.bitcrushSend);
    }

    // Voice pools
    for (let i = 0; i < 8; i++) this.synthPool.push(new AdvancedSynthVoice(c, i));
    for (let i = 0; i < 10; i++) this.drumPool.push(new PooledDrumVoice(c, this.noiseBuffer));
  }

  /** Build per-track rack configs from the world (uses the engine's exported helper). */
  private buildRackConfigs(world: World): TrackRackConfig[] {
    return buildTrackRackConfigs(world);
  }

  // ─── AudioBackend: lifecycle ──────────────────────────────────────────

  async init(ctx: AudioContext): Promise<boolean> {
    // Already initialized in constructor. Just verify the context is running.
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* user gesture required */ }
    }
    return true;
  }

  start(): void { this.playing = true; }
  stop(): void {
    this.playing = false;
    for (const v of this.synthPool) v.panic(this.ctx);
    for (const v of this.drumPool) v.panic(this.ctx);
  }

  // ─── AudioBackend: note triggering ────────────────────────────────────

  triggerDrum(track: number, time: number, vel: number, decayOverride?: number): void {
    const t = this.engine.tracks[track];
    if (!t || t.mix.mute) return;
    const preset = this.engine.drumPresets[t.presetId];
    if (!preset) return;
    const voice = this.drumPool[this.drumIdx];
    this.drumIdx = (this.drumIdx + 1) % this.drumPool.length;
    voice.hit(preset, time, vel * t.mix.vol, this.chains[track], decayOverride);
    // Sidechain: when kick fires, duck the bass
    if (track === 0) {
      this.duckGain.gain.cancelScheduledValues(time);
      this.duckGain.gain.setValueAtTime(1 - 0.4, time);
      this.duckGain.gain.linearRampToValueAtTime(1.0, time + 0.25);
    }
  }

  triggerSynth(
    track: number,
    time: number,
    midi: number,
    vel: number,
    dur: number,
    timbre?: SynthTimbre,
    opts?: TriggerSynthOpts,
  ): void {
    const t = this.engine.tracks[track];
    if (!t || t.mix.mute) return;
    const basePreset = getAdvancedSynthPreset(t.presetId, this.engine.synthPresets as Record<string, AdvancedSynthPreset>);
    if (!basePreset) return;
    const voice = this.synthPool[this.synthIdx];
    this.synthIdx = (this.synthIdx + 1) % this.synthPool.length;

    // Apply timbre override (cutoff/res) — the engine has already computed
    // the final values (world + pursuit + learning + flow).
    let preset: AdvancedSynthPreset = basePreset;
    if (timbre) {
      preset = {
        ...basePreset,
        cutoff: timbre.cutoff !== undefined ? clamp(timbre.cutoff, 60, 16000) : basePreset.cutoff,
        res: timbre.res !== undefined ? clamp(timbre.res, 0.2, 24) : basePreset.res,
      };
    }

    // Apply gate from duration (if stepDur provided).
    const stepDur = opts?.stepDur;
    let p: AdvancedSynthPreset = (stepDur && dur)
      ? { ...preset, gate: clamp(dur / (stepDur * 2), 0.05, 2.5) }
      : preset;

    // Synth mode override (set by reference pursuit).
    const overrideMode = this.engine.synthModeOverrides[track];
    if (overrideMode && overrideMode !== p.mode) {
      p = { ...p, mode: overrideMode };
      if (overrideMode === 'fm') {
        if (p.fmRatio === undefined) p.fmRatio = 2;
        if (p.fmDepth === undefined) p.fmDepth = 4;
        if (p.fmEnvAmount === undefined) p.fmEnvAmount = 0.6;
      } else if (overrideMode === 'supersaw') {
        if (p.sawCount === undefined) p.sawCount = 5;
        if (p.sawDetune === undefined) p.sawDetune = 12;
        if (p.sawSpread === undefined) p.sawSpread = 0.5;
      } else if (overrideMode === 'wavetable') {
        if (p.wtPosition === undefined) p.wtPosition = 0.5;
        if (p.wtMorphRate === undefined) p.wtMorphRate = 0.3;
      }
    }

    // Real-time modulation overrides.
    if (this.engine.fmDepthOverride > 0 && p.mode === 'fm') {
      p = { ...p, fmDepth: this.engine.fmDepthOverride };
    }
    if (this.engine.wtPositionOverride >= 0 && p.mode === 'wavetable') {
      p = { ...p, wtPosition: this.engine.wtPositionOverride };
    }

    // Quality cap (supersaw osc count).
    if (p.mode === 'supersaw' && typeof p.sawCount === 'number'
        && p.sawCount > this.engine.maxSupersawOsc) {
      p = { ...p, sawCount: this.engine.maxSupersawOsc };
    }

    // Lead filter cutoff override (flow filter sweep).
    if (track === 5 && this.engine.leadCutoffOverride > 0) {
      p = { ...p, cutoff: clamp(this.engine.leadCutoffOverride, 200, 16000) };
    }

    // Drive scales the voice velocity.
    const driveBoost = timbre?.drive ? clamp(timbre.drive / 1.5, 0.5, 1.8) : 1;
    voice.noteOn(p, time, midi, vel * t.mix.vol * driveBoost, stepDur ?? 0.1, this.chains[track]);

    // Sub oscillator for bass track (sine one octave below).
    if (track === 4) {
      const subFreq = mtof(midi - 12);
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.value = subFreq;
      const subDecay = (dur || 0.1) + 0.05;
      subGain.gain.setValueAtTime(0.5 * t.mix.vol * driveBoost, time);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + subDecay);
      subOsc.connect(subGain);
      subGain.connect(this.chains[4]);
      subOsc.start(time);
      subOsc.stop(time + subDecay + 0.02);
    }
  }

  triggerRiser(time: number, dur: number): void {
    const c = this.ctx;
    const noise = c.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(200, time);
    filter.frequency.exponentialRampToValueAtTime(8000, time + dur);
    filter.Q.value = 2;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(0.3, time + dur);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur + 0.1);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    noise.start(time);
    noise.stop(time + dur + 0.2);
  }

  triggerImpact(time: number): void {
    const c = this.ctx;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(35, time + 0.5);
    const og = c.createGain();
    og.gain.setValueAtTime(0.8, time);
    og.gain.exponentialRampToValueAtTime(0.001, time + 0.6);
    osc.connect(og);
    og.connect(this.master);
    osc.start(time);
    osc.stop(time + 0.7);

    const noise = c.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.4, time);
    ng.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    noise.connect(hp);
    hp.connect(ng);
    ng.connect(this.master);
    noise.start(time);
    noise.stop(time + 0.1);
  }

  triggerReverseImpact(time: number, intensity: number): void {
    const c = this.ctx;
    const i = Number.isFinite(intensity) ? clamp(intensity, 0, 1) : 0.5;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(35, time);
    osc.frequency.exponentialRampToValueAtTime(120, time + 0.5);
    const og = c.createGain();
    og.gain.setValueAtTime(0.001, time);
    og.gain.exponentialRampToValueAtTime(0.6 * i, time + 0.5);
    og.gain.setValueAtTime(0.6 * i, time + 0.5);
    og.gain.exponentialRampToValueAtTime(0.001, time + 0.6);
    osc.connect(og);
    og.connect(this.master);
    osc.start(time);
    osc.stop(time + 0.7);

    const noise = c.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.001, time);
    ng.gain.exponentialRampToValueAtTime(0.3 * i, time + 0.4);
    ng.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
    noise.connect(hp);
    hp.connect(ng);
    ng.connect(this.master);
    noise.start(time);
    noise.stop(time + 0.6);
  }

  /** Legacy fires events immediately — no batching. */
  flushEvents(): void { /* no-op */ }

  // ─── AudioBackend: parameter control ──────────────────────────────────

  setWorld(params: Record<string, number>): void {
    for (const k of Object.keys(params)) {
      const v = params[k];
      if (typeof v === 'number' && isFinite(v)) this.effectiveWorld[k] = v;
    }
    const t = this.ctx.currentTime;
    if (params.masterLevel !== undefined) {
      this.master.gain.setTargetAtTime(params.masterLevel, t, 0.1);
    }
    if (params.bassLevel !== undefined) {
      this.trackGains[4]?.gain.setTargetAtTime(params.bassLevel * 0.8, t, 0.1);
    }
    if (params.leadLevel !== undefined) {
      this.trackGains[5]?.gain.setTargetAtTime(params.leadLevel * 0.8, t, 0.1);
    }
    if (params.kickLevel !== undefined) {
      this.trackGains[0]?.gain.setTargetAtTime(params.kickLevel * 0.8, t, 0.1);
    }
  }

  setMacros(_macros: Record<string, number>): void {
    // Legacy doesn't use macros — the worklet's macro-driven DSP has no
    // legacy equivalent. No-op.
  }

  setBpm(_bpm: number): void {
    // Legacy scheduling is driven by the engine's BPM (used in tick()).
    // The audio graph has no BPM-dependent nodes. No-op.
  }

  setFX(config: AudioBackendFXConfig): void {
    this.effectiveFX = { ...this.effectiveFX, ...config };
    const t = this.ctx.currentTime;
    if (config.reverbWet !== undefined) {
      this.reverbReturn.gain.setTargetAtTime(config.reverbWet, t, 0.1);
    }
    if (config.delayWet !== undefined) {
      this.delayReturn.gain.setTargetAtTime(config.delayWet, t, 0.1);
    }
    if (config.delayFeedback !== undefined) {
      this.delayFb.gain.setTargetAtTime(config.delayFeedback, t, 0.1);
    }
    // Per-bus reverb/delay sends — legacy has per-track sends, not per-bus.
    // We approximate by applying the music-bus send (index 2) to melodic
    // tracks (5/6/7) and the atmos-bus send (index 3) to atmos tracks (1/2/3).
    if (config.reverbSends) {
      const musicReverb = config.reverbSends[2] ?? 0;
      const atmosReverb = config.reverbSends[3] ?? 0;
      for (const ti of [5, 6, 7]) {
        this.racks[ti]?.setParameter('sendReverb', musicReverb);
      }
      for (const ti of [1, 2, 3]) {
        this.racks[ti]?.setParameter('sendReverb', atmosReverb);
      }
    }
    if (config.delaySends) {
      const musicDelay = config.delaySends[2] ?? 0;
      const atmosDelay = config.delaySends[3] ?? 0;
      for (const ti of [5, 6, 7]) {
        this.racks[ti]?.setParameter('sendDelay', musicDelay);
      }
      for (const ti of [1, 2, 3]) {
        this.racks[ti]?.setParameter('sendDelay', atmosDelay);
      }
    }
  }

  triggerDuck(): void {
    // Legacy handles the duck in triggerDrum (duckGain ramp). This method
    // is for the worklet's 'duck' message. For legacy, we no-op here —
    // the duck is applied at triggerDrum time.
  }

  newPhrase(): void {
    // Legacy doesn't rotate samples. No-op.
  }

  panic(): void {
    for (const v of this.synthPool) v.panic(this.ctx);
    for (const v of this.drumPool) v.panic(this.ctx);
  }

  // ─── AudioBackend: per-track effect control (legacy-only) ────────────

  setSendLevel(trackIdx: number, sendName: string, level: number): void {
    if (!Number.isFinite(level)) return;
    if (trackIdx < 0 || trackIdx >= this.racks.length) return;
    const param = `send${sendName.charAt(0).toUpperCase()}${sendName.slice(1)}`;
    this.racks[trackIdx].setParameter(param as any, level);
  }

  setTrackEffect(trackIdx: number, effectName: string, value: number): void {
    if (!Number.isFinite(value)) return;
    // 'cutoff' is special-cased for LEAD (stored on the engine, not the rack).
    // The engine handles this case before calling setTrackEffect — it stores
    // the override in leadCutoffOverride and applies it in triggerSynth.
    // For legacy, we just push to the rack (the rack ignores unknown params).
    if (effectName === 'cutoff') return; // handled by the engine
    if (trackIdx < 0 || trackIdx >= this.racks.length) return;
    this.racks[trackIdx].setParameter(effectName as any, value);
  }

  setSendEffectParam(effectName: string, param: string, value: number): void {
    if (!Number.isFinite(value)) return;
    switch (effectName) {
      case 'chorus':     this.chorusEffect.setParameter(param, value); break;
      case 'phaser':     this.phaserEffect.setParameter(param, value); break;
      case 'distortion': this.distortionEffect.setParameter(param, value); break;
      case 'bitcrush':   this.bitcrushEffect.setParameter(param, value); break;
    }
  }

  setMasterParam(name: string, value: number): void {
    this.multiband.setParameter(name, value);
  }

  // ─── AudioBackend: surprise event manipulation (legacy-only) ──────────

  setTrackGainScale(trackIdx: number, scale: number, time: number): void {
    const g = this.trackGains[trackIdx];
    if (g) {
      const target = g.gain.value * scale;
      g.gain.setTargetAtTime(target, time, 0.02);
    }
  }

  setMasterGainScale(scale: number, time: number): void {
    const target = this.master.gain.value * scale;
    this.master.gain.setTargetAtTime(target, time, 0.015);
  }

  restoreDefaults(time: number): void {
    this.master.gain.setTargetAtTime(1.1, time, 0.05);
    const defaultVols = [1.0, 0.6, 0.5, 0.4, 1.2, 0.7, 0.5, 0.5];
    for (let i = 1; i < 8; i++) {
      const g = this.trackGains[i];
      if (g) g.gain.setTargetAtTime(defaultVols[i], time, 0.1);
    }
    if (this.delayFb) {
      this.delayFb.gain.setTargetAtTime(0.35, time, 0.1);
    }
  }

  // ─── AudioBackend: analysis + status ──────────────────────────────────

  getAnalyser(): AnalyserNode | null { return this.analyser; }

  getStatus(): AudioBackendStatus {
    return {
      playing: this.playing,
      cpuLoad: 0, // legacy doesn't have a CPU monitor; the engine uses its own.
      activeVoices: 0,
    };
  }

  getParams(): AudioBackendParams {
    // Average send levels across melodic tracks (5/6/7).
    let reverb = 0, delay = 0, chorus = 0, phaser = 0;
    let count = 0;
    for (const ti of [5, 6, 7]) {
      const rack = this.racks[ti];
      if (rack) {
        reverb += rack.sendReverb?.gain?.value ?? 0;
        delay  += rack.sendDelay?.gain?.value  ?? 0;
        chorus += rack.sendChorus?.gain?.value ?? 0;
        phaser += rack.sendPhaser?.gain?.value ?? 0;
        count++;
      }
    }
    if (count > 0) {
      reverb /= count; delay /= count; chorus /= count; phaser /= count;
    }
    return {
      kickDecay: this.effectiveWorld.kickDecay,
      bassCutoff: this.effectiveWorld.bassCutoff,
      leadCutoff: this.effectiveWorld.leadCutoff,
      leadDetune: this.effectiveWorld.leadDetune,
      padCutoff: this.effectiveWorld.padCutoff,
      duck: this.effectiveWorld.duck,
      masterLevel: this.master?.gain?.value,
      bassLevel: this.trackGains[4]?.gain?.value,
      leadLevel: this.trackGains[5]?.gain?.value,
      kickLevel: this.trackGains[0]?.gain?.value,
      sendReverb: reverb,
      sendDelay: delay,
      sendChorus: chorus,
      sendPhaser: phaser,
      reverbWet: this.reverbReturn?.gain?.value,
      delayWet: this.delayReturn?.gain?.value,
      delayFeedback: this.delayFb?.gain?.value,
    };
  }

  dispose(): void {
    try { this.master.disconnect(); } catch {}
    try { this.analyser.disconnect(); } catch {}
    for (const v of this.synthPool) v.panic(this.ctx);
    for (const v of this.drumPool) v.panic(this.ctx);
  }
}
