// src/lib/psyLive4/psyLive4.ts
// Layer 3 — HOST. The ONLY owner of:
//   - AudioContext
//   - Transport (BPM, bar tracking)
//   - CompositionScheduler (the one setInterval)
//   - Master chain (3-band compressor + limiter)
//   - Device wiring (drum + melodic)
//   - visibilitychange handler (ctx.suspend/resume)
//
// This replaces src/lib/psyLive.ts (4,501 lines). Target: ~400 lines.

import { CompositionScheduler, type SchedulerHost } from './scheduler';
import { PsytranceComposer, getSection } from './composer';
import { resolveGrammar } from './style-grammars';
import { toMusicalEvent } from './types';
import type { NoteEvent, SynthRole, MusicalStyle } from './types';
import { DrumDevice } from '@/lib/devices/drum-device';
import { MelodicDevice } from '@/lib/devices/melodic-device';
import { LeadDevice } from '@/lib/devices/lead-device';
import { SamplerDevice } from '@/lib/devices/sampler-device';
import { freqHzToCC74 } from './cc-mapping';
import { CCLearner, type CCExplorationState } from './learning';
import {
  analyzeQuality,
  suggestAdjustments,
  COMMERCIAL_TARGETS,
  applyRadioTargets,
  restoreDefaultTargets,
  computeConvergence,
  type AudioQualityMetrics,
} from './audio-quality';
import { RadioListener, type RadioTarget, type RadioStream } from './radio-listener';
import { DeviceHost, InMemoryChannel } from '@/lib/psy-foundation-shim';
import type { MusicalEvent } from '@/lib/psy-foundation-shim/protocol';

// ── Public diagnostics ───────────────────────────────────────────────────
export interface RoleVoiceCount {
  kick: number; bass: number; lead: number; acid: number; pad: number;
  hat: number; clap: number; perc: number; snare: number;
}
export interface MasterChainMetrics {
  lowCompReduction: number;     // dB
  midCompReduction: number;     // dB
  highCompReduction: number;    // dB
  sidechainGain: number;        // 0..1 (1.0 = no duck)
  limiterReduction: number;     // dB
}
export interface DrumDeviceStats {
  activeVoices: number;
  processMs: number;
  voiceBudget: number;
}
export interface ComposedEventLite {
  at: number;
  role: string;
  note: number;
  vel: number;
}
export interface LiveState4 {
  playing: boolean;
  bpm: number;
  style: MusicalStyle;
  energy: number;
  kickCount: number;
  bar: number;
  section: string;              // INTRO/GROOVE/DROP/BREAKDOWN/REBUILD/OUTRO
  barInCycle: number;           // 0..63
  cycle: number;                // which 64-bar cycle
  engineLevel: number;
  voicesActive: number;
  patchesLoaded: number;
  peakDb: number;
  rmsDb: number;
  schedulerStaleMs: number;
  ctxState: AudioContextState;
  suspended: boolean;
  repetition: { uniqueBars: number; repeatedBars: number; maxStreak: number; windowSize: number };
  // ── NEW: engine intelligence fields ──
  roleVoices: RoleVoiceCount;
  masterChain: MasterChainMetrics;
  recentEvents: ComposedEventLite[];   // last 16 events
  eventsPerSec: number;                 // composition throughput
  ccParams: Record<number, number>;     // current CC parameter values
  smartRadioOn: boolean;
  // Removed smartRadioNextStyleChange — was always 0, dead field (roast GAP 10)
  // New: real radio listener info (replaces the fake countdown)
  radioStreamName: string;              // name of stream currently connected
  radioDetectedBpm: number;             // BPM detected from radio (0 = unknown)
  radioBpmConfidence: number;           // 0..1 — how stable the BPM estimate is
  drumStats: DrumDeviceStats | null;     // drum worklet telemetry
  learningOn: boolean;
  learningStates: CCExplorationState[];
  learningCurrentCc: number;
  learningTrialRemaining: number;
  // DEEP GAP C: convergence metric (0..1) — how close engine is to radio
  convergence: number;
  convergenceHistory: number[];   // last 60 measurements (4 min at 4s/tick)
  // DEEP GAP E: error counter
  learningErrors: number;
  // DEEP GAP A: pattern memory stats
  patternCount: number;
  // DEEP GAP F: A/B mix mode
  radioMixMode: 'both' | 'radio' | 'engine';
  radioInBreakdown: boolean;
}

export class PsyLive4 implements SchedulerHost {
  readonly ctx: AudioContext;
  private scheduler: CompositionScheduler;
  private composer = new PsytranceComposer();
  private drumDevice: DrumDevice;
  private melodicDevice: MelodicDevice;
  private leadDevice: LeadDevice;
  private samplerDevice: SamplerDevice;
  // ── Foundation DeviceHost: proper event routing + error isolation ──
  private host: DeviceHost;
  private channel: InMemoryChannel;

  // ── Master chain nodes ──
  private sidechainDuck: GainNode;
  private multibandLow: BiquadFilterNode;
  private multibandMid1: BiquadFilterNode;
  private multibandMid2: BiquadFilterNode;
  private multibandHigh: BiquadFilterNode;
  private multibandLowComp: DynamicsCompressorNode;
  private multibandMidComp: DynamicsCompressorNode;
  private multibandHighComp: DynamicsCompressorNode;
  private multibandLowGain: GainNode;
  private multibandMidGain: GainNode;
  private multibandHighGain: GainNode;
  private multibandSum: GainNode;
  private workletVolumeGain: GainNode;
  private masterLimiter: DynamicsCompressorNode;
  private analyser: AnalyserNode;

  // ── State ──
  private playing = false;
  private bpm = 145;
  private style: MusicalStyle = 'FULL_ON';
  private energy = 0.5;
  private seed = 42;
  private kickCount = 0;
  private bar = 0;
  private composerPrev: { lastBassNote: number; barInArrangement: number; motifStep: number } | null = null;
  private suspended = false;
  private startTime = 0;  // ctx.currentTime when play() was called

  // ── Repetition detector ──
  private barFingerprints: string[] = [];
  private lastRepetitionWarning = 0;
  private repetitionStats = { uniqueBars: 0, repeatedBars: 0, maxStreak: 0 };

  // ── Engine intelligence tracking ──
  private recentEvents: ComposedEventLite[] = [];     // ring buffer, last 16
  private ccParams: Record<number, number> = {};      // current CC values
  private smartRadioOn = false;
  // Removed: smartRadioNextChange / smartRadioInterval — fake Smart Radio is gone,
  // real RadioListener replaces it. No countdown to display. (roast GAP 10)
  private eventCountWindow = 0;                        // events in current 1s window
  private eventWindowStart = 0;                        // ctx time of window start
  private eventsPerSec = 0;                             // smoothed events/sec
  private lastEventsPerSecUpdate = 0;
  // ── Learning loop ──
  private learner = new CCLearner();
  private learningOn = false;
  /**
   * FIX GAP 1: dedicated learning interval (4s) — was: delta adjustments inside
   * getState() (called 4-10x/sec by UI) → thrashing, no convergence.
   * FIX GAP 7: skip during warmup (first 5s of playback) and when ctx suspended.
   * FIX GAP 8: apply ONE delta adjustment per tick (largest magnitude wins)
   *            instead of all 5 branches fighting each other.
   */
  private learningInterval: ReturnType<typeof setInterval> | null = null;
  private static readonly LEARNING_INTERVAL_MS = 4000;
  private static readonly ENGINE_WARMUP_MS = 5000;
  private playStartTime = 0;  // ctx.currentTime when play() was called
  // DEEP GAP C: convergence metric + history (for sparkline UI)
  private convergence = 0;
  private convergenceHistory: number[] = [];
  private static readonly CONVERGENCE_HISTORY_MAX = 60;
  // DEEP GAP F: A/B mix mode — 'both' (default), 'radio' (solo radio), 'engine' (solo engine)
  private radioMixMode: 'both' | 'radio' | 'engine' = 'both';
  // Reusable engine-analysis buffers (FIX GAP 9: was allocating 4.5KB per call).
  // These are `freqBuf`/`tdBuf` defined below — single set, shared with getState().
  // ── Real Radio Listener ──
  private radioListener: RadioListener;
  private radioTarget: RadioTarget | null = null;

  // ── Analyser buffers (reused, no per-tick allocation) ──
  private freqBuf: Uint8Array;
  private tdBuf: Float32Array;

  constructor(ctx?: AudioContext) {
    // Layer 3 owns the AudioContext. Created here, passed to devices.
    this.ctx = ctx ?? new (window.AudioContext || (window as any).webkitAudioContext)();

    // ── Master chain ──
    this.sidechainDuck = this.ctx.createGain();
    this.sidechainDuck.gain.value = 1.0;

    this.multibandLow = this.ctx.createBiquadFilter();
    this.multibandLow.type = 'lowpass';
    this.multibandLow.frequency.value = 200;
    this.multibandLow.Q.value = 0.707;
    this.multibandMid1 = this.ctx.createBiquadFilter();
    this.multibandMid1.type = 'highpass';
    this.multibandMid1.frequency.value = 200;
    this.multibandMid1.Q.value = 0.707;
    this.multibandMid2 = this.ctx.createBiquadFilter();
    this.multibandMid2.type = 'lowpass';
    this.multibandMid2.frequency.value = 2500;
    this.multibandMid2.Q.value = 0.707;
    this.multibandHigh = this.ctx.createBiquadFilter();
    this.multibandHigh.type = 'highpass';
    this.multibandHigh.frequency.value = 2500;
    this.multibandHigh.Q.value = 0.707;

    this.multibandLowComp = this.ctx.createDynamicsCompressor();
    this.multibandLowComp.threshold.value = -18;
    this.multibandLowComp.knee.value = 6;
    this.multibandLowComp.ratio.value = 3;
    this.multibandLowComp.attack.value = 0.010;
    this.multibandLowComp.release.value = 0.150;
    this.multibandMidComp = this.ctx.createDynamicsCompressor();
    this.multibandMidComp.threshold.value = -20;
    this.multibandMidComp.knee.value = 10;
    this.multibandMidComp.ratio.value = 2;
    this.multibandMidComp.attack.value = 0.015;
    this.multibandMidComp.release.value = 0.200;
    this.multibandHighComp = this.ctx.createDynamicsCompressor();
    this.multibandHighComp.threshold.value = -28;  // FIX: lower threshold = compress highs more
    this.multibandHighComp.knee.value = 8;
    this.multibandHighComp.ratio.value = 4;      // FIX: 4:1 = stronger high compression
    this.multibandHighComp.attack.value = 0.005;
    this.multibandHighComp.release.value = 0.080;

    this.multibandLowGain = this.ctx.createGain();
    this.multibandLowGain.gain.value = 1.4;
    this.multibandMidGain = this.ctx.createGain();
    this.multibandMidGain.gain.value = 1.2;
    this.multibandHighGain = this.ctx.createGain();
    this.multibandHighGain.gain.value = 0.85;  // FIX: was 1.15 — REDUCE highs, don't boost them
    this.multibandSum = this.ctx.createGain();
    this.multibandSum.gain.value = 1.0;
    this.workletVolumeGain = this.ctx.createGain();
    this.workletVolumeGain.gain.value = 1.0;
    this.masterLimiter = this.ctx.createDynamicsCompressor();
    this.masterLimiter.threshold.value = -0.3;
    this.masterLimiter.knee.value = 0;
    this.masterLimiter.ratio.value = 20;
    this.masterLimiter.attack.value = 0.001;
    this.masterLimiter.release.value = 0.05;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.7;
    this.freqBuf = new Uint8Array(this.analyser.frequencyBinCount);
    this.tdBuf = new Float32Array(this.analyser.fftSize);

    // ── Wire master chain ──
    // sidechainDuck → 3 parallel paths → sum → volume → limiter → analyser → destination
    this.sidechainDuck.connect(this.multibandLow);
    this.sidechainDuck.connect(this.multibandMid1);
    this.sidechainDuck.connect(this.multibandHigh);
    this.multibandLow.connect(this.multibandLowComp);
    this.multibandLowComp.connect(this.multibandLowGain);
    this.multibandLowGain.connect(this.multibandSum);
    this.multibandMid1.connect(this.multibandMid2);
    this.multibandMid2.connect(this.multibandMidComp);
    this.multibandMidComp.connect(this.multibandMidGain);
    this.multibandMidGain.connect(this.multibandSum);
    this.multibandHigh.connect(this.multibandHighComp);
    this.multibandHighComp.connect(this.multibandHighGain);
    this.multibandHighGain.connect(this.multibandSum);
    this.multibandSum.connect(this.workletVolumeGain);
    this.workletVolumeGain.connect(this.masterLimiter);
    this.masterLimiter.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // ── Devices ──
    this.drumDevice = new DrumDevice({ ctx: this.ctx, outputNode: this.sidechainDuck });
    this.melodicDevice = new MelodicDevice({
      ctx: this.ctx,
      outputNode: this.sidechainDuck,
      maxVoices: 16,
      seed: this.seed,
    });
    this.leadDevice = new LeadDevice({ ctx: this.ctx, outputNode: this.sidechainDuck });
    this.samplerDevice = new SamplerDevice({ ctx: this.ctx, outputNode: this.sidechainDuck });

    // ── Scheduler ──
    this.scheduler = new CompositionScheduler(this);

    // ── Foundation DeviceHost: proper event routing + error isolation ──
    this.channel = new InMemoryChannel();
    this.host = new DeviceHost(this.channel);

    // ── Real Radio Listener ──
    this.radioListener = new RadioListener(this.ctx);
    this.radioListener.onTargets((target) => this.onRadioTargets(target));

    // ── visibilitychange handler (THE FIX for "engine stops") ──
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ───────────────────────────────────────────────────────────────────────

  async init(): Promise<boolean> {
    const drumOk = await this.drumDevice.init();
    const melodicOk = await this.melodicDevice.init();
    const leadOk = await this.leadDevice.init();
    const samplerOk = await this.samplerDevice.init();
    if (!drumOk) {
      console.error('[PsyLive4] drum device init failed');
      return false;
    }
    if (!melodicOk) console.warn('[PsyLive4] melodic device init failed');
    if (!leadOk) console.warn('[PsyLive4] lead device init failed');
    if (!samplerOk) console.warn('[PsyLive4] sampler device init failed (will use synth drums)');
    this.host.register(this.drumDevice);
    this.host.register(this.melodicDevice);
    if (leadOk) this.host.register(this.leadDevice);
    if (samplerOk) this.host.register(this.samplerDevice);
    console.log(`[PsyLive4] DeviceHost: ${this.host.deviceCount} devices registered`);
    this.applyStyleToDevices();
    return true;
  }

  async play(): Promise<void> {
    if (this.playing) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.playing = true;
    this.startTime = this.ctx.currentTime;
    this.playStartTime = this.ctx.currentTime;  // FIX GAP 7: engine warmup baseline
    this.kickCount = 0;
    this.bar = 0;
    this.composerPrev = null;
    this.drumDevice.onStart();
    this.melodicDevice.onStart();
    this.leadDevice.onStart();
    this.samplerDevice.onStart();
    this.scheduler.start();
    this.startLearningLoop();  // FIX GAP 1: dedicated 4s timer (was: in getState)
    console.log('[PsyLive4] play — scheduler started');
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    this.scheduler.stop();
    this.stopLearningLoop();  // FIX GAP 1: clear learning interval
    this.drumDevice.onStop();
    this.melodicDevice.onStop();
    this.leadDevice.onStop();
    this.samplerDevice.onStop();
    console.log('[PsyLive4] stop');
  }

  // ───────────────────────────────────────────────────────────────────────
  // SchedulerHost implementation
  // ───────────────────────────────────────────────────────────────────────

  isRunning(): boolean { return this.playing; }

  compose(windowStart: number, windowEnd: number): void {
    const result = this.composer.compose({
      startTime: windowStart,
      duration: windowEnd - windowStart,
      bpm: this.bpm,
      style: this.style,
      energy: this.energy,
      seed: this.seed,
      prev: this.composerPrev,
    });
    this.composerPrev = result.next;
    this.bar = result.next.barInArrangement;

    // Track kick count + sidechain + repetition fingerprint
    const barTokens: string[] = [];
    for (const e of result.events) {
      const me = toMusicalEvent(e);
      // Route through Foundation DeviceHost (error isolation + proper routing)
      this.host.publish(me);
      // Sidechain duck on kick
      if (e.role === 'kick') {
        this.triggerSidechain(e.at);
        this.kickCount++;
      }
      barTokens.push(`${e.role}:${Math.round(e.note)}:${Math.round(e.velocity * 10) / 10}`);
      // Track recent events (ring buffer, last 16)
      this.recentEvents.push({ at: e.at, role: e.role, note: e.note, vel: e.velocity });
      if (this.recentEvents.length > 16) this.recentEvents.shift();
      this.eventCountWindow++;
    }
    // Repetition fingerprint (per compose window, coarse)
    if (barTokens.length > 0) {
      this.barFingerprints.push(barTokens.sort().join('|'));
      if (this.barFingerprints.length > 32) this.barFingerprints.shift();
      this.checkRepetition();
    }
    // Smart radio cycling removed — now handled by RadioListener (real radio)
    // Events/sec calculation (updated every 1s)
    const now = this.ctx.currentTime;
    if (now - this.eventWindowStart >= 1.0) {
      this.eventsPerSec = this.eventCountWindow;
      this.eventCountWindow = 0;
      this.eventWindowStart = now;
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Controls
  // ───────────────────────────────────────────────────────────────────────

  setBPM(bpm: number): void {
    this.bpm = Math.max(60, Math.min(200, bpm));
  }

  setStyle(style: MusicalStyle): void {
    this.style = style;
    this.applyStyleToDevices();
  }

  setEnergy(e: number): void {
    this.energy = Math.max(0, Math.min(1, e));
  }

  // ── Voice parameter control (for the synth rack UI) ──
  // Maps CC numbers to psysynth params: 74=cutoff, 71=resonance, 5=glide,
  // 12=energyMacro, 14=delaySend, 15=reverbSend.
  // Value is 0..1 (the UI normalizes). Returns true if applied.
  //
  // FIX GAP 4: now routes to ALL 4 devices (was: melodic+lead only — drums and
  // sampler were invisible to learning, half the mix uncontrollable).
  setCC(cc: number, value: number): boolean {
    const v = Math.max(0, Math.min(1, value));
    this.ccParams[cc] = v;
    this.melodicDevice.setParameterByCC(cc, v);
    this.leadDevice.setCC(cc, v);
    this.drumDevice.setCC(cc, v);      // NEW: drums respond to CC74/CC71/CC12
    this.samplerDevice.setCC(cc, v);   // NEW: sampler responds to CC12
    return true;
  }

  // ── Real Radio: connect to live stream, analyze, learn ──
  async setSmartRadio(on: boolean): Promise<void> {
    this.smartRadioOn = on;
    if (on) {
      // Load streams list and connect to first available
      const streams = await this.loadRadioStreams();
      if (streams.length === 0) {
        console.warn('[PsyLive4] No radio streams available');
        return;
      }
      // Try each stream until one connects
      for (const stream of streams) {
        const ok = await this.radioListener.connect(stream);
        if (ok) break;
      }
      console.log(`[PsyLive4] Radio ON — listening to ${this.radioListener.getCurrentStream()?.name || 'none'}`);
    } else {
      this.radioListener.disconnect();
      this.radioTarget = null;
      // FIX GAP 3: restore default commercial targets (was: stuck at last stream's values)
      restoreDefaultTargets();
      console.log('[PsyLive4] Radio OFF — targets restored to defaults');
    }
  }

  private async loadRadioStreams(): Promise<RadioStream[]> {
    try {
      const resp = await fetch('/api/streams.json');
      if (!resp.ok) return [];
      const data = await resp.json();
      const streams = data.streams || data;
      return streams.map((s: any) => ({ id: s.id, name: s.name, url: s.url }));
    } catch {
      return [];
    }
  }

  /**
   * Called when RadioListener extracts new targets from the radio stream.
   * The engine adjusts its parameters to match the radio.
   *
   * FIX GAP 3: now uses `applyRadioTargets()` which guarantees Min ≤ Max
   * with a minimum 0.20 spread.
   * DEEP GAP B: if `target.inBreakdown` is true, we HOLD the previous targets
   * (don't apply breakdown-like values — they'd corrupt the learning system).
   */
  private onRadioTargets(target: RadioTarget): void {
    this.radioTarget = target;

    // DEEP GAP B: skip target updates during breakdowns
    if (target.inBreakdown) {
      console.log(`[PsyLive4] radio in breakdown — holding previous targets`);
      return;
    }

    // Sync BPM to radio (if detected and reasonable)
    if (target.bpm > 100 && target.bpm < 180) {
      this.setBPM(target.bpm);
    }

    // Sync style to radio
    if (target.style && target.style !== this.style) {
      this.setStyle(target.style as MusicalStyle);
    }

    // Apply radio-derived targets through the SAFE helper (clamps Min ≤ Max, ensures spread)
    applyRadioTargets(target);

    console.log(`[PsyLive4] Radio targets applied: BPM=${target.bpm.toFixed(0)} style=${target.style} warmth=${target.warmth.toFixed(2)} brightness=[${COMMERCIAL_TARGETS.brightnessMin.toFixed(2)},${COMMERCIAL_TARGETS.brightnessMax.toFixed(2)}] smoothness=${target.smoothness.toFixed(2)}`);
  }

  isSmartRadioOn(): boolean { return this.smartRadioOn; }

  /**
   * DEEP GAP F: A/B mix mode — let the user do a blind A/B test.
   * - 'both': radio at 0.3, engine at 1.0 (default — hear both)
   * - 'radio': radio at 1.0, engine muted (hear the reference)
   * - 'engine': radio muted, engine at 1.0 (hear the test)
   *
   * This is the commercial A/B workflow: switch instantly between
   * reference (radio) and test (engine) to judge perceptual quality.
   */
  setRadioMixMode(mode: 'both' | 'radio' | 'engine'): void {
    this.radioMixMode = mode;
    const radioGain = mode === 'radio' ? 1.0 : mode === 'both' ? 0.3 : 0.0;
    this.radioListener.setOutputGain(radioGain);
    // Mute/unmute the engine
    const engineGain = mode === 'engine' ? 1.0 : mode === 'both' ? 1.0 : 0.0;
    this.workletVolumeGain.gain.setTargetAtTime(engineGain, this.ctx.currentTime, 0.05);
    console.log(`[PsyLive4] A/B mode: ${mode} (radio=${radioGain}, engine=${engineGain})`);
  }
  getRadioMixMode(): 'both' | 'radio' | 'engine' { return this.radioMixMode; }

  // ── Learning loop: epsilon-greedy CC exploration ──
  setLearning(on: boolean): void {
    this.learningOn = on;
    if (on) {
      // learner.reset() restores best-known params (does NOT wipe memory — roast GAP 5)
      this.learner.reset();
      // If already playing, start the dedicated learning interval (roast GAP 1).
      // If not playing yet, play() will start it when called.
      if (this.playing) this.startLearningLoop();
      console.log('[PsyLive4] Learning ON — dedicated 4s interval (restored best params)');
    } else {
      this.stopLearningLoop();
      console.log('[PsyLive4] Learning OFF — interval cleared');
    }
  }
  isLearningOn(): boolean { return this.learningOn; }

  /** Explicit wipe — for the UI's "Reset Learning" button. */
  forgetLearning(): void {
    this.learner.forgetAll();
    console.log('[PsyLive4] Learning memory wiped (explicit)');
  }

  // ── Master volume (0..1.5) ──
  private _masterVolume = 1.0;
  setMasterVolume(v: number): void {
    this._masterVolume = Math.max(0, Math.min(1.5, v));
    this.workletVolumeGain.gain.setTargetAtTime(this._masterVolume, this.ctx.currentTime, 0.02);
  }
  getMasterVolume(): number { return this._masterVolume; }

  // ── Per-device mix balance (learning can adjust these) ──
  private _highGain = 0.85;
  private _midGain = 1.2;
  private _lowGain = 1.4;
  setSpectrumBalance(low: number, mid: number, high: number): void {
    this._lowGain = Math.max(0.5, Math.min(2.0, low));
    this._midGain = Math.max(0.5, Math.min(2.0, mid));
    this._highGain = Math.max(0.3, Math.min(1.5, high));
    this.multibandLowGain.gain.setTargetAtTime(this._lowGain, this.ctx.currentTime, 0.1);
    this.multibandMidGain.gain.setTargetAtTime(this._midGain, this.ctx.currentTime, 0.1);
    this.multibandHighGain.gain.setTargetAtTime(this._highGain, this.ctx.currentTime, 0.1);
    console.log(`[PsyLive4] spectrum balance: low=${this._lowGain.toFixed(2)} mid=${this._midGain.toFixed(2)} high=${this._highGain.toFixed(2)}`);
  }

  // ── Live keyboard note on/off (routes to melodic device) ──
  noteOn(midi: number, velocity: number = 0.8): void {
    const at = this.ctx.currentTime + 0.005;  // 5ms latency for live input
    this.host.publish({
      type: 'note',
      at,
      note: midi,
      velocity,
      duration: -1,  // hold until noteOff
      channel: 'lead',
    } as any);
  }

  noteOff(midi: number): void {
    const at = this.ctx.currentTime;
    this.host.publish({
      type: 'note',
      at,
      note: midi,
      velocity: 0,   // velocity 0 = note-off convention
      duration: 0,
      channel: 'lead',
    } as any);
  }

  private applyStyleToDevices(): void {
    const g = resolveGrammar(this.style);
    // Push leadCutoff → CC74 to psysynth (style affects timbre, not just pitch)
    const cc74 = freqHzToCC74(g.leadCutoff);
    this.melodicDevice.setParameterByCC(74, cc74);
    // Push musical context through Foundation DeviceHost
    this.host.pushContext({
      style: this.style,
      energy: this.energy,
      section: 'groove',
      bpm: this.bpm,
      root: 0,
      scale: g.scaleName,
      bar: this.bar,
      beat: 0,
    } as any);
    console.log(`[PsyLive4] setStyle(${this.style}): leadCutoff=${g.leadCutoff}Hz → CC74=${cc74.toFixed(3)}`);
  }

  private triggerSidechain(at: number): void {
    // 6dB duck, 150ms recovery
    const t = Math.max(at, this.ctx.currentTime);
    this.sidechainDuck.gain.cancelScheduledValues(t);
    this.sidechainDuck.gain.setValueAtTime(0.5, t);
    this.sidechainDuck.gain.exponentialRampToValueAtTime(1.0, t + 0.15);
  }

  // ───────────────────────────────────────────────────────────────────────
  // visibilitychange — THE structural fix for background-tab audio stopping
  // ───────────────────────────────────────────────────────────────────────

  private onVisibility = (): void => {
    if (document.hidden) {
      // Freeze the audio clock. ctx.currentTime stops advancing.
      // The scheduler keeps ticking but compose() becomes a no-op once
      // lastComposedUntil > ctx.currentTime + LOOKAHEAD.
      this.ctx.suspend().catch(() => {});
      this.suspended = true;
      console.log('[PsyLive4] visibilitychange → hidden — ctx.suspend()');
    } else if (this.suspended) {
      // Tab returned. Resume — currentTime continues from where it froze.
      this.ctx.resume().then(() => {
        this.suspended = false;
        this.scheduler.reanchorAfterBackground();
        console.log('[PsyLive4] visibilitychange → visible — ctx.resume() + reanchor');
      }).catch(() => {});
    }
  };

  // ───────────────────────────────────────────────────────────────────────
  // Repetition detector (ported from psyLive.ts)
  // ───────────────────────────────────────────────────────────────────────

  private checkRepetition(): void {
    const fps = this.barFingerprints;
    if (fps.length < 4) return;
    const last = fps[fps.length - 1];
    let streak = 1;
    for (let i = fps.length - 2; i >= 0; i--) {
      if (fps[i] === last) streak++;
      else break;
    }
    const unique = new Set(fps).size;
    this.repetitionStats.uniqueBars = unique;
    this.repetitionStats.repeatedBars = fps.length - unique;
    if (streak > this.repetitionStats.maxStreak) this.repetitionStats.maxStreak = streak;
    const now = Date.now();
    if (streak >= 8 && (now - this.lastRepetitionWarning) > 30000) {
      this.lastRepetitionWarning = now;
      console.warn(`[PsyLive4] REPETITION: same pattern ${streak}x (unique=${unique}/${fps.length})`);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Diagnostics
  // ───────────────────────────────────────────────────────────────────────

  getState(): LiveState4 {
    // Engine level (frequency-bin average)
    this.analyser.getByteFrequencyData(this.freqBuf as Uint8Array<ArrayBuffer>);
    let s = 0;
    for (let i = 0; i < this.freqBuf.length; i++) s += this.freqBuf[i];
    const engineLevel = s / (this.freqBuf.length * 255);

    // Peak + RMS (time-domain)
    this.analyser.getFloatTimeDomainData(this.tdBuf as Float32Array<ArrayBuffer>);
    let peak = 0, rms = 0;
    for (let i = 0; i < this.tdBuf.length; i++) {
      const v = Math.abs(this.tdBuf[i]);
      if (v > peak) peak = v;
      rms += this.tdBuf[i] * this.tdBuf[i];
    }
    rms = Math.sqrt(rms / this.tdBuf.length);
    const peakDb = 20 * Math.log10(peak || 0.0001);
    const rmsDb = 20 * Math.log10(rms || 0.0001);

    // Section + arrangement position
    const section = getSection(this.bar);
    const barInCycle = this.bar % 64;
    const cycle = Math.floor(this.bar / 64);

    // Per-role voice counts (from recent events in the last ~1s)
    const now = this.ctx.currentTime;
    const roleVoices: RoleVoiceCount = { kick: 0, bass: 0, lead: 0, acid: 0, pad: 0, hat: 0, clap: 0, perc: 0, snare: 0 };
    for (const e of this.recentEvents) {
      if (now - e.at < 1.0 && e.role in roleVoices) {
        (roleVoices as any)[e.role]++;
      }
    }

    // Master chain metrics (read from DynamicsCompressorNode.reduction)
    const masterChain: MasterChainMetrics = {
      lowCompReduction: this.multibandLowComp ? this.multibandLowComp.reduction : 0,
      midCompReduction: this.multibandMidComp ? this.multibandMidComp.reduction : 0,
      highCompReduction: this.multibandHighComp ? this.multibandHighComp.reduction : 0,
      sidechainGain: this.sidechainDuck ? this.sidechainDuck.gain.value : 1.0,
      limiterReduction: this.masterLimiter ? this.masterLimiter.reduction : 0,
    };

    // Learning loop is NO LONGER in getState() (roast GAP 1).
    // It runs in a dedicated 4s interval via runLearningTick().
    // getState() is now a PURE GETTER — no side effects, no console spam,
    // safe to call from React render loops at any rate.
    const learningStates = this.learner.getStates();
    const currentTrial = this.learner.getCurrentTrial(this.ctx.currentTime);

    return {
      playing: this.playing,
      bpm: this.bpm,
      style: this.style,
      energy: this.energy,
      kickCount: this.kickCount,
      bar: this.bar,
      section,
      barInCycle,
      cycle,
      engineLevel,
      voicesActive: this.melodicDevice.voicesActive,
      patchesLoaded: this.melodicDevice.patchesLoaded,
      peakDb,
      rmsDb,
      schedulerStaleMs: this.scheduler.staleMs,
      ctxState: this.ctx.state,
      suspended: this.suspended,
      repetition: { ...this.repetitionStats, windowSize: this.barFingerprints.length },
      roleVoices,
      masterChain,
      recentEvents: [...this.recentEvents],
      eventsPerSec: this.eventsPerSec,
      ccParams: { ...this.ccParams },
      smartRadioOn: this.smartRadioOn,
      radioStreamName: this.radioListener.getCurrentStream()?.name ?? '',
      radioDetectedBpm: this.radioListener.getLastDetectedBpm(),
      radioBpmConfidence: this.radioListener.getBpmConfidence(),
      drumStats: this.drumDevice.getStats() as DrumDeviceStats | null,
      learningOn: this.learningOn,
      learningStates,
      learningCurrentCc: currentTrial.cc,
      learningTrialRemaining: currentTrial.remainingSec,
      // DEEP GAP C: convergence metric + history
      convergence: this.convergence,
      convergenceHistory: [...this.convergenceHistory],
      // DEEP GAP E: error counter
      learningErrors: this.learner.getErrorCount(),
      // DEEP GAP A: pattern memory stats
      patternCount: this.learner.getPatternCount(),
      // DEEP GAP F: A/B mix mode
      radioMixMode: this.radioMixMode,
      radioInBreakdown: this.radioTarget?.inBreakdown ?? false,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Learning loop (FIX GAP 1, 7, 8)
  //
  // Runs in a dedicated 4s interval — NOT inside getState().
  // Skips during engine warmup (first 5s) and when ctx is suspended.
  // Applies ONE delta adjustment per tick (largest magnitude wins) so
  // adjustments don't fight each other.
  // ───────────────────────────────────────────────────────────────────────

  private startLearningLoop(): void {
    this.stopLearningLoop();
    this.learner.reset();  // restores best known params (does NOT wipe memory)
    this.learningInterval = setInterval(
      () => this.runLearningTick(),
      PsyLive4.LEARNING_INTERVAL_MS,
    );
    console.log(`[PsyLive4] learning loop started — ${PsyLive4.LEARNING_INTERVAL_MS}ms interval`);
  }

  private stopLearningLoop(): void {
    if (this.learningInterval) {
      clearInterval(this.learningInterval);
      this.learningInterval = null;
    }
  }

  private runLearningTick(): void {
    // DEEP GAP E: error boundary — a single throw must NOT kill the loop
    try {
      this.runLearningTickInner();
    } catch (err) {
      this.learner.incrementError();
      console.error(`[Learning] tick threw (error #${this.learner.getErrorCount()}):`, err);
    }
  }

  private runLearningTickInner(): void {
    if (!this.learningOn || !this.playing) return;

    // FIX GAP 7: skip during engine warmup (silence before scheduler composes)
    const elapsedMs = (this.ctx.currentTime - this.playStartTime) * 1000;
    if (elapsedMs < PsyLive4.ENGINE_WARMUP_MS) {
      console.log(`[Learning] warmup (${elapsedMs.toFixed(0)}ms < ${PsyLive4.ENGINE_WARMUP_MS}ms) — skipping`);
      return;
    }

    // FIX GAP 7: skip when ctx suspended (tab hidden) — analyser returns stale zeros
    if (this.suspended || this.ctx.state !== 'running') {
      console.log('[Learning] ctx suspended — skipping (no stale measurements)');
      return;
    }

    // Analyze engine quality (reuse buffers — FIX GAP 9)
    const engineQuality = analyzeQuality(this.analyser, this.ctx.sampleRate, this.freqBuf, this.tdBuf);

    // DEEP GAP C: compute convergence metric (0..1) — how close engine is to radio
    if (this.radioTarget && this.radioTarget.connected) {
      this.convergence = computeConvergence(engineQuality, this.radioTarget);
      this.convergenceHistory.push(this.convergence);
      if (this.convergenceHistory.length > PsyLive4.CONVERGENCE_HISTORY_MAX) this.convergenceHistory.shift();
    }

    // DEEP GAP A: record pattern memory — fingerprint the current bar + its reward
    // This gives the composer material to bias toward high-reward patterns.
    if (this.barFingerprints.length > 0) {
      const latestFingerprint = this.barFingerprints[this.barFingerprints.length - 1];
      this.learner.recordPattern(latestFingerprint, engineQuality.overall, this.ctx.currentTime);
    }

    // ── DIRECT DELTA vs RADIO (if connected) ──
    // FIX GAP 8: apply ONE adjustment per tick — the largest-magnitude delta wins.
    // Was: 5 branches firing independently → CC12 reduced in 3 branches, _lowGain
    // reduced in one and increased in another in the SAME tick → random walk.
    if (this.radioTarget && this.radioTarget.connected) {
      const rt = this.radioTarget;
      const deltas: Array<{ name: string; value: number; threshold: number; action: () => void }> = [
        {
          name: 'brightness',
          value: engineQuality.brightness - rt.brightness,
          threshold: 0.10,
          action: () => {
            const cur = this.ccParams[74] ?? 0.5;
            if (engineQuality.brightness > rt.brightness) {
              this.setCC(74, Math.max(0.1, cur - 0.05));
              this._highGain = Math.max(0.3, this._highGain - 0.03);
              this.multibandHighGain.gain.setTargetAtTime(this._highGain, this.ctx.currentTime, 0.1);
              console.log(`[Learning] engine too bright (+${(engineQuality.brightness - rt.brightness).toFixed(2)}) → CC74↓ + highGain=${this._highGain.toFixed(2)}`);
            } else {
              this.setCC(74, Math.min(0.9, cur + 0.05));
              this._highGain = Math.min(1.5, this._highGain + 0.03);
              this.multibandHighGain.gain.setTargetAtTime(this._highGain, this.ctx.currentTime, 0.1);
              console.log(`[Learning] engine too dark (${(engineQuality.brightness - rt.brightness).toFixed(2)}) → CC74↑ + highGain=${this._highGain.toFixed(2)}`);
            }
          },
        },
        {
          name: 'smoothness',
          value: engineQuality.smoothness - rt.smoothness,  // negative = engine harsher
          threshold: 0.15,
          action: () => {
            // engine smoother than radio → back off resonance + drive
            const cur71 = this.ccParams[71] ?? 0.35;
            const cur12 = this.ccParams[12] ?? 0.5;
            this.setCC(71, Math.max(0.1, cur71 - 0.04));
            this.setCC(12, Math.max(0.1, cur12 - 0.03));
            console.log(`[Learning] engine harshness delta=${(engineQuality.smoothness - rt.smoothness).toFixed(2)} → CC71↓ CC12↓`);
          },
        },
        {
          name: 'loudness',
          value: engineQuality.loudness - rt.loudness,
          threshold: 0.10,
          action: () => {
            const cur12 = this.ccParams[12] ?? 0.5;
            if (engineQuality.loudness > rt.loudness) {
              this.setCC(12, Math.max(0.1, cur12 - 0.04));
              this._lowGain = Math.max(0.5, this._lowGain - 0.03);
              this.multibandLowGain.gain.setTargetAtTime(this._lowGain, this.ctx.currentTime, 0.1);
              console.log(`[Learning] engine too loud (+${(engineQuality.loudness - rt.loudness).toFixed(2)}) → CC12↓ + lowGain=${this._lowGain.toFixed(2)}`);
            } else {
              this.setCC(12, Math.min(0.9, cur12 + 0.04));
              this._lowGain = Math.min(2.0, this._lowGain + 0.03);
              this.multibandLowGain.gain.setTargetAtTime(this._lowGain, this.ctx.currentTime, 0.1);
              console.log(`[Learning] engine too quiet (${(engineQuality.loudness - rt.loudness).toFixed(2)}) → CC12↑ + lowGain=${this._lowGain.toFixed(2)}`);
            }
          },
        },
        {
          name: 'warmth',
          value: engineQuality.warmth - rt.warmth,
          threshold: 0.15,
          action: () => {
            const cur15 = this.ccParams[15] ?? 0.3;
            this.setCC(15, Math.min(0.8, cur15 + 0.03));
            this._lowGain = Math.min(2.0, this._lowGain + 0.03);
            this.multibandLowGain.gain.setTargetAtTime(this._lowGain, this.ctx.currentTime, 0.1);
            console.log(`[Learning] engine lacks warmth (${(engineQuality.warmth - rt.warmth).toFixed(2)}) → CC15↑ + lowGain=${this._lowGain.toFixed(2)}`);
          },
        },
        {
          name: 'punch',
          value: engineQuality.punch - rt.punch,
          threshold: 0.15,
          action: () => {
            const cur12 = this.ccParams[12] ?? 0.5;
            this.setCC(12, Math.max(0.1, cur12 - 0.03));
            this._midGain = Math.min(2.0, this._midGain + 0.03);
            this.multibandMidGain.gain.setTargetAtTime(this._midGain, this.ctx.currentTime, 0.1);
            console.log(`[Learning] engine lacks punch (${(engineQuality.punch - rt.punch).toFixed(2)}) → CC12↓ + midGain=${this._midGain.toFixed(2)}`);
          },
        },
      ];

      // Pick the LARGEST-magnitude delta that exceeds its threshold.
      // Apply ONLY that one. This gives each adjustment 4s to take effect
      // before the next is tried (roast GAP 8).
      let chosen: typeof deltas[0] | null = null;
      for (const d of deltas) {
        if (Math.abs(d.value) >= d.threshold) {
          if (!chosen || Math.abs(d.value) > Math.abs(chosen.value)) {
            chosen = d;
          }
        }
      }
      if (chosen) {
        chosen.action();
      } else {
        console.log(`[Learning] all deltas within thresholds — engine matches radio ✓`);
      }
    }

    // ── Epsilon-greedy exploration (long-term learning, persists to localStorage) ──
    const suggestions = suggestAdjustments(engineQuality, COMMERCIAL_TARGETS);
    const trial = this.learner.tick(this.ctx.currentTime, engineQuality, suggestions);
    if (trial) {
      this.setCC(trial.cc, trial.value);
      console.log(`[Learning] trial: CC${trial.cc}=${trial.value.toFixed(2)} (epsilon-greedy)`);
    }
  }

  // ── MIDI export — renders N bars via composer, encodes as MIDI format 0 ──
  async exportMIDI(bars = 8): Promise<void> {
    const beatDur = 60 / this.bpm;
    const duration = bars * 4 * beatDur;
    const result = this.composer.compose({
      startTime: 0,
      duration,
      bpm: this.bpm,
      style: this.style,
      energy: this.energy,
      seed: this.seed,
      prev: null,
    });
    if (result.events.length === 0) {
      console.warn('[PsyLive4] MIDI export: no events');
      return;
    }
    const midi = this.encodeMIDI(result.events, this.bpm);
    const blob = new Blob([midi], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `psy4-${this.style}-${bars}bars-${this.bpm}bpm-${Date.now()}.mid`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log(`[PsyLive4] MIDI exported: ${result.events.length} events, ${bars} bars, ${this.bpm} BPM`);
  }

  /** Encode NoteEvents to MIDI format 0 (1 track, 480 tpq). */
  private encodeMIDI(events: NoteEvent[], bpm: number): ArrayBuffer {
    const ticksPerQuarter = 480;
    const tickDur = ticksPerQuarter / 4;  // 16th note ticks
    const beatDur = 60 / bpm;
    // MIDI channel per role
    const channelFor = (role: string): number => {
      if (['kick', 'hat', 'clap', 'perc', 'snare'].includes(role)) return 9;  // drums on ch 9
      if (role === 'bass') return 0;
      if (role === 'lead') return 1;
      if (role === 'acid') return 2;
      if (role === 'pad') return 3;
      return 0;
    };
    // MIDI note per role (drums use GM drum map)
    const noteFor = (e: NoteEvent): number => {
      switch (e.role) {
        case 'kick': return 36;   // Bass Drum
        case 'hat': return 42;    // Closed Hat
        case 'clap': return 39;   // Hand Clap
        case 'perc': return 50;   // High Tom
        case 'snare': return 38;  // Acoustic Snare
        default: return e.note;   // melodic: use composed note
      }
    };
    // Build event list: (tick, data)
    const midiEvents: Array<{ tick: number; data: number[] }> = [];
    // Tempo meta event at tick 0
    const tempo = Math.round(60000000 / bpm);
    midiEvents.push({ tick: 0, data: [0xFF, 0x51, 0x03, (tempo >> 16) & 0xFF, (tempo >> 8) & 0xFF, tempo & 0xFF] });
    for (const e of events) {
      const tick = Math.round((e.at / beatDur) * ticksPerQuarter);
      const ch = channelFor(e.role);
      const note = noteFor(e);
      const vel = Math.max(1, Math.min(127, Math.round(e.velocity * 127)));
      midiEvents.push({ tick, data: [0x90 | ch, note, vel] });  // note on
      const offTick = tick + Math.max(1, Math.round((e.duration > 0 ? e.duration : 0.1) / beatDur * ticksPerQuarter));
      midiEvents.push({ tick: offTick, data: [0x80 | ch, note, 0] });  // note off
    }
    midiEvents.sort((a, b) => a.tick - b.tick);
    // End of track
    const lastTick = midiEvents.length > 0 ? midiEvents[midiEvents.length - 1].tick : 0;
    midiEvents.push({ tick: lastTick + 1, data: [0xFF, 0x2F, 0x00] });
    // Build track data with delta times
    const trackData: number[] = [];
    let prevTick = 0;
    for (const ev of midiEvents) {
      const delta = ev.tick - prevTick;
      prevTick = ev.tick;
      if (delta > 0x0FFFFFF) trackData.push((delta >> 21) | 0x80);
      if (delta > 0x3FFF) trackData.push((delta >> 14) | 0x80);
      if (delta > 0x7F) trackData.push((delta >> 7) | 0x80);
      trackData.push(delta & 0x7F);
      trackData.push(...ev.data);
    }
    const trackLen = trackData.length;
    const header = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ticksPerQuarter >> 8) & 0xFF, ticksPerQuarter & 0xFF];
    const trackHeader = [0x4D, 0x54, 0x72, 0x6B, (trackLen >> 24) & 0xFF, (trackLen >> 16) & 0xFF, (trackLen >> 8) & 0xFF, trackLen & 0xFF];
    const midi = new Uint8Array(header.length + trackHeader.length + trackData.length);
    midi.set(header, 0);
    midi.set(trackHeader, header.length);
    midi.set(trackData, header.length + trackHeader.length);
    return midi.buffer;
  }

  // ── WAV export — renders N bars of DRUMS offline via ScriptProcessorNode ──
  // HONEST FIX: AudioWorkletNode port messages don't work in OfflineAudioContext
  // (the message queue isn't processed before startRendering). Using
  // ScriptProcessorNode (deprecated but reliable in offline) instead.
  // Melodic voices (psysynth) can't be cloned offline, so this is drums-only.
  async exportWAV(bars = 8): Promise<void> {
    const beatDur = 60 / this.bpm;
    const duration = bars * 4 * beatDur + 0.5;
    const sampleRate = 44100;
    const totalSamples = Math.ceil(duration * sampleRate);
    // Compose events
    const result = this.composer.compose({
      startTime: 0,
      duration,
      bpm: this.bpm,
      style: this.style,
      energy: this.energy,
      seed: this.seed,
      prev: null,
    });
    const drumEvents = result.events.filter(e =>
      e.role === 'kick' || e.role === 'hat' || e.role === 'clap' || e.role === 'perc' || e.role === 'snare'
    );
    if (drumEvents.length === 0) {
      console.warn('[PsyLive4] WAV export: no drum events');
      return;
    }
    // Use ScriptProcessorNode for offline render (worklet port doesn't work in OfflineAudioContext)
    const offline = new OfflineAudioContext(1, totalSamples, sampleRate);
    const bufferSize = 4096;
    const processor = offline.createScriptProcessor(bufferSize, 0, 1);

    // Simple drum synthesis for offline render (doesn't use the worklet)
    const synthesizeDrum = (voiceId: number, t: number, vel: number): number => {
      const dt = t;
      if (voiceId === 0) { // kick
        const fund = 50;
        const f = (fund * 4 - fund) * Math.exp(-dt / 0.025) + fund;
        const env = Math.exp(-dt / 0.15);
        const subEnv = Math.exp(-dt / 0.225);
        const sub = Math.sin(2 * Math.PI * (f * 0.5) * dt) * subEnv * 0.4;
        const click = dt < 0.008 ? (Math.sin(2 * Math.PI * 3000 * dt) * 0.3 + (Math.random()*2-1)*0.3) * Math.exp(-dt/0.008) * 0.3 : 0;
        return (Math.sin(2 * Math.PI * f * dt) * env + sub + click) * vel * 0.9;
      } else if (voiceId === 5) { // hat
        const env = Math.exp(-dt / 0.04);
        return (Math.random() * 2 - 1) * env * vel * 0.4;
      } else if (voiceId === 7) { // clap
        const env = dt < 0.01 ? 1 : dt < 0.02 ? 0.3 : dt < 0.03 ? 0.8 : Math.exp(-(dt-0.03)/0.04);
        return (Math.random() * 2 - 1) * env * vel * 0.4;
      } else if (voiceId === 8) { // perc
        const env = Math.exp(-dt / 0.08);
        return Math.sin(2 * Math.PI * 200 * dt) * env * vel * 0.4;
      } else if (voiceId === 14) { // snare
        const env = Math.exp(-dt / 0.12);
        const tone = Math.sin(2 * Math.PI * 180 * dt) * 0.4;
        return (tone + (Math.random()*2-1)*0.8) * env * vel * 0.5;
      }
      return 0;
    };

    const roleToVoice: Record<string, number> = { kick: 0, hat: 5, clap: 7, perc: 8, snare: 14 };
    const sampleData = new Float32Array(totalSamples);
    // Render each drum event into the sample buffer
    for (const e of drumEvents) {
      const voiceId = roleToVoice[e.role];
      const startSample = Math.floor(e.at * sampleRate);
      const eventDur = Math.min(0.3, e.duration * 2);
      const eventSamples = Math.floor(eventDur * sampleRate);
      for (let i = 0; i < eventSamples && startSample + i < totalSamples; i++) {
        const t = i / sampleRate;
        const sample = synthesizeDrum(voiceId, t, e.velocity);
        sampleData[startSample + i] += sample;
      }
    }
    // Clamp
    for (let i = 0; i < totalSamples; i++) {
      sampleData[i] = Math.max(-1, Math.min(1, sampleData[i]));
    }

    // Create a buffer and play it through the offline context
    const buffer = offline.createBuffer(1, totalSamples, sampleRate);
    buffer.copyToChannel(sampleData, 0);
    const src = offline.createBufferSource();
    src.buffer = buffer;
    const limiter = offline.createDynamicsCompressor();
    limiter.threshold.value = -0.3; limiter.ratio.value = 20;
    limiter.attack.value = 0.001; limiter.release.value = 0.05;
    src.connect(limiter);
    limiter.connect(offline.destination);
    src.start(0);

    console.log(`[PsyLive4] WAV: rendering ${bars} bars (${duration.toFixed(1)}s, ${drumEvents.length} drum events)...`);
    const rendered = await offline.startRendering();
    // Verify non-silent
    const ch = rendered.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < ch.length; i++) { const v = Math.abs(ch[i]); if (v > peak) peak = v; }
    if (peak < 0.001) {
      console.error('[PsyLive4] WAV export: rendered audio is SILENT (peak=0)');
      return;
    }
    console.log(`[PsyLive4] WAV: peak=${peak.toFixed(3)}, non-silent ✓`);

    const wav = this.encodeWAV(rendered, sampleRate);
    const blob = new Blob([wav], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `psy4-drums-${this.style}-${bars}bars-${this.bpm}bpm-${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log(`[PsyLive4] WAV exported: ${bars} bars, ${drumEvents.length} events, peak=${peak.toFixed(3)}`);
  }

  /** Encode AudioBuffer to 16-bit PCM WAV (RIFF). */
  private encodeWAV(buffer: AudioBuffer, sampleRate: number): ArrayBuffer {
    const numCh = buffer.numberOfChannels;
    const len = buffer.length;
    const blockAlign = numCh * 2;
    const dataSize = len * blockAlign;
    const buf = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buf);
    const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);
    const chans: Float32Array[] = [];
    for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
    let off = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) {
        let s = chans[c][i];
        s = Math.max(-1, Math.min(1, s));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        off += 2;
      }
    }
    return buf;
  }

  dispose(): void {
    this.stop();
    this.stopLearningLoop();  // FIX GAP 1: clear learning interval on dispose
    this.radioListener.dispose();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    this.host.dispose();
    this.melodicDevice.dispose();
    this.ctx.close().catch(() => {});
  }
}
