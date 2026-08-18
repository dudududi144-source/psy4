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
import { freqHzToCC74 } from './cc-mapping';
import { CCLearner, type CCExplorationState } from './learning';

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
  smartRadioNextStyleChange: number;     // seconds until next auto style change
  drumStats: DrumDeviceStats | null;     // drum worklet telemetry
  learningOn: boolean;
  learningStates: CCExplorationState[];
  learningCurrentCc: number;
  learningTrialRemaining: number;
}

export class PsyLive4 implements SchedulerHost {
  readonly ctx: AudioContext;
  private scheduler: CompositionScheduler;
  private composer = new PsytranceComposer();
  private drumDevice: DrumDevice;
  private melodicDevice: MelodicDevice;

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
  private smartRadioNextChange = 0;                    // ctx time of next auto style change
  private smartRadioInterval = 120;                    // seconds between auto changes
  private eventCountWindow = 0;                        // events in current 1s window
  private eventWindowStart = 0;                        // ctx time of window start
  private eventsPerSec = 0;                             // smoothed events/sec
  private lastEventsPerSecUpdate = 0;
  // ── Learning loop ──
  private learner = new CCLearner();
  private learningOn = false;

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
    this.multibandHighComp.threshold.value = -22;
    this.multibandHighComp.knee.value = 8;
    this.multibandHighComp.ratio.value = 2.5;
    this.multibandHighComp.attack.value = 0.005;
    this.multibandHighComp.release.value = 0.080;

    this.multibandLowGain = this.ctx.createGain();
    this.multibandLowGain.gain.value = 1.4;
    this.multibandMidGain = this.ctx.createGain();
    this.multibandMidGain.gain.value = 1.2;
    this.multibandHighGain = this.ctx.createGain();
    this.multibandHighGain.gain.value = 1.15;
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

    // ── Scheduler ──
    this.scheduler = new CompositionScheduler(this);

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
    if (!drumOk) {
      console.error('[PsyLive4] drum device init failed');
      return false;
    }
    if (!melodicOk) {
      console.warn('[PsyLive4] melodic device init failed — running drums only');
    }
    // Apply initial style leadCutoff to psysynth
    this.applyStyleToDevices();
    return true;
  }

  async play(): Promise<void> {
    if (this.playing) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.playing = true;
    this.startTime = this.ctx.currentTime;
    this.kickCount = 0;
    this.bar = 0;
    this.composerPrev = null;
    this.drumDevice.onStart();
    this.melodicDevice.onStart();
    this.scheduler.start();
    console.log('[PsyLive4] play — scheduler started');
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    this.scheduler.stop();
    this.drumDevice.onStop();
    this.melodicDevice.onStop();
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
      // Route to device by role
      if (e.role === 'kick' || e.role === 'hat' || e.role === 'clap' || e.role === 'perc' || e.role === 'snare') {
        this.drumDevice.onEvent(me);
      } else {
        this.melodicDevice.onEvent(me);
      }
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
    // Smart radio: auto-change style if enabled
    if (this.smartRadioOn && this.ctx.currentTime >= this.smartRadioNextChange) {
      this.cycleSmartRadioStyle();
    }
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
  setCC(cc: number, value: number): boolean {
    const v = Math.max(0, Math.min(1, value));
    this.ccParams[cc] = v;  // track for diagnostics
    return this.melodicDevice.setParameterByCC(cc, v);
  }

  // ── Smart Radio: auto-evolution mode ──
  // When enabled, the engine automatically cycles through styles every ~2 minutes,
  // creating an endless "radio station" that evolves. Think of it as a DJ that
  // never stops and always keeps the energy fresh.
  private static readonly SMART_RADIO_STYLES: MusicalStyle[] = [
    'FULL_ON', 'DARK', 'PROGRESSIVE', 'ACID', 'GOA', 'HI_TECH', 'FOREST',
  ];
  setSmartRadio(on: boolean): void {
    this.smartRadioOn = on;
    if (on) {
      this.smartRadioNextChange = this.ctx.currentTime + this.smartRadioInterval;
      console.log(`[PsyLive4] Smart Radio ON — next style change in ${this.smartRadioInterval}s`);
    } else {
      console.log('[PsyLive4] Smart Radio OFF');
    }
  }
  isSmartRadioOn(): boolean { return this.smartRadioOn; }
  private cycleSmartRadioStyle(): void {
    const styles = PsyLive4.SMART_RADIO_STYLES;
    const currentIdx = styles.indexOf(this.style);
    const nextIdx = (currentIdx + 1) % styles.length;
    const nextStyle = styles[nextIdx];
    // Also vary energy for musical evolution
    const newEnergy = 0.4 + Math.random() * 0.4;
    this.setStyle(nextStyle);
    this.setEnergy(newEnergy);
    this.smartRadioNextChange = this.ctx.currentTime + this.smartRadioInterval;
    console.log(`[PsyLive4] Smart Radio: → ${nextStyle} (energy=${newEnergy.toFixed(2)}), next in ${this.smartRadioInterval}s`);
  }
  getSmartRadioNextChange(): number {
    return Math.max(0, this.smartRadioNextChange - this.ctx.currentTime);
  }

  // ── Learning loop: epsilon-greedy CC exploration ──
  setLearning(on: boolean): void {
    this.learningOn = on;
    if (on) {
      this.learner.reset();
      console.log('[PsyLive4] Learning ON — exploring CC params');
    } else {
      console.log('[PsyLive4] Learning OFF');
    }
  }
  isLearningOn(): boolean { return this.learningOn; }

  // ── Master volume (0..1.5) ──
  private _masterVolume = 1.0;
  setMasterVolume(v: number): void {
    this._masterVolume = Math.max(0, Math.min(1.5, v));
    // Apply to the workletVolumeGain (post-multiband, pre-limiter)
    this.workletVolumeGain.gain.setTargetAtTime(this._masterVolume, this.ctx.currentTime, 0.02);
  }
  getMasterVolume(): number { return this._masterVolume; }

  // ── Live keyboard note on/off (routes to melodic device) ──
  noteOn(midi: number, velocity: number = 0.8): void {
    const at = this.ctx.currentTime + 0.005;  // 5ms latency for live input
    this.melodicDevice.onEvent({
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
    this.melodicDevice.onEvent({
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
    // Push musical context for style bank selection
    this.melodicDevice.onContext({
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

    // Learning loop: explore CC params using peak dB as reward
    if (this.learningOn && this.playing) {
      const trial = this.learner.tick(this.ctx.currentTime, peakDb);
      if (trial) {
        this.setCC(trial.cc, trial.value);
      }
    }
    const learningStates = this.learner.getStates();
    const currentTrial = this.learner.getCurrentTrial();

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
      smartRadioNextStyleChange: this.getSmartRadioNextChange(),
      drumStats: this.drumDevice.getStats() as DrumDeviceStats | null,
      learningOn: this.learningOn,
      learningStates,
      learningCurrentCc: currentTrial.cc,
      learningTrialRemaining: currentTrial.remainingSec,
    };
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
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    this.melodicDevice.dispose();
    this.ctx.close().catch(() => {});
  }
}
