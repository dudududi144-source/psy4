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
import type { NoteEvent, SynthRole, MusicalStyle, ComposerContinuity } from './types';
import { DrumDevice } from '@/lib/devices/drum-device';
import { MelodicDevice } from '@/lib/devices/melodic-device';
import { LeadDevice } from '@/lib/devices/lead-device';
import { SamplerDevice } from '@/lib/devices/sampler-device';
import { freqHzToCC74 } from './cc-mapping';
import { CCLearner, type CCExplorationState } from './learning';
import { GrammarLearner, type GrammarStats } from './grammar-learner';
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
// Turso cloud sync (cross-session persistence)
import {
  loadCloudLearningState,
  syncCloudLearningState,
  syncCloudPatterns,
  logRadioTelemetry,
} from '../turso-sync';

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
  // Turso cloud sync status
  cloudSync: boolean;             // true if cloud sync is active
  cloudParamsLoaded: number;      // count of params loaded from cloud on init
  // Radio reconnect status — shown in the UI so the user knows we're
  // retrying infinitely rather than silently giving up.
  radioReconnectAttempts: number;
  radioLastConnectTime: number;   // epoch ms of last successful connect
  // GRAMMAR LEARNING STATS — real musical learning visibility.
  // Replaces the abstract "convergence %" (which was just a scalar) with
  // actual learned statistics: how many bass transitions, melodic intervals,
  // and kick onsets the engine has observed + a confidence metric.
  grammarStats: GrammarStats | null;
  grammarSamplesApplied: number;  // how many notes the composer sampled from grammars
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
  // GLUE COMPRESSOR — gentle FIXED (not adaptive). Inspires by psy3-clean.
  // Restored after self-roast: removing ALL compression left the mix unglued.
  private glueComp: DynamicsCompressorNode;
  // SATURATION — waveshaper with tanh curve for warmth/harmonics (pre-glue).
  private saturationShaper: WaveShaperNode;
  // AIR / SPARKLE — high-shelf EQ boost (post-widener, pre-limiter).
  // Adds the 8kHz+ "air" that commercial psytrance has. Without this, the
  // spectrum was: sub=215, bass=219, high=40, air=1 — way too dark.
  private airShelf: BiquadFilterNode;
  // STEREO WIDENER — M/S matrix (mid + side) for true stereo widening.
  private widenerSplitter: ChannelSplitterNode;
  private gainMidL: GainNode;
  private gainMidR: GainNode;
  private gainSideL: GainNode;
  private gainSideR: GainNode;
  private widenerMerger: ChannelMergerNode;
  private analyser: AnalyserNode;

  // ── State ──
  private playing = false;
  private bpm = 145;
  private style: MusicalStyle = 'FULL_ON';
  private energy = 0.5;
  private seed = 42;
  private kickCount = 0;
  private bar = 0;
  private composerPrev: ComposerContinuity | null = null;
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
  // GRAMMAR LEARNER — real musical learning (bass 12x12 transitions, melodic
  // intervals, kick onsets). Observes every note played, learns the
  // statistics, and lets the composer sample from the learned distributions
  // when confidence is high. Replaces the "no learning at all" complaint —
  // this learns actual musical structure, not just knob values.
  private grammarLearner = new GrammarLearner();
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
  // PHASE F: EMA-smoothed reward + convergence
  private rewardEMA = 0;
  private convergenceEMA = 0;
  private static readonly REWARD_EMA_ALPHA = 0.15;
  // PHASE F: track what was played (for musical similarity reward)
  private lastBarBassSteps: Set<number> = new Set();
  private lastBarLeadNotes: number[] = [];
  // DEEP GAP F: A/B mix mode — 'both' (default), 'radio' (solo radio), 'engine' (solo engine)
  private radioMixMode: 'both' | 'radio' | 'engine' = 'both';
  // Turso cloud sync state
  private cloudSyncOn = false;          // true after cloud state loaded
  private lastCloudSyncTime = 0;        // ctx.currentTime of last cloud sync
  private static readonly CLOUD_SYNC_INTERVAL_SEC = 20;  // sync every ~5 learning ticks
  private lastPatternSyncTime = 0;
  private static readonly PATTERN_SYNC_INTERVAL_SEC = 30;
  private lastTelemetryTime = 0;
  private static readonly TELEMETRY_INTERVAL_SEC = 10;
  private pendingPatternSync: Map<string, number> = new Map();  // fingerprint → reward (batched)
  // Reusable engine-analysis buffers (FIX GAP 9: was allocating 4.5KB per call).
  // These are `freqBuf`/`tdBuf` defined below — single set, shared with getState().
  // ── Real Radio Listener ──
  private radioListener: RadioListener;
  private radioTarget: RadioTarget | null = null;
  // BACKUP: cached stream list for auto-failover
  private currentRadioStreams: RadioStream[] = [];
  // INFINITE: when every stream has failed, we wait RESET_COOLDOWN_MS then
  // clear failed-streams memory and try again. This makes the radio run
  // forever — it never gives up. User can also trigger this manually
  // via resetRadio() (the "RESET" button in the Smart Radio UI).
  private radioReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly RESET_COOLDOWN_MS = 30000;  // 30s between full reset cycles
  private radioReconnectAttempts = 0;
  private radioLastConnectTime = 0;
  private grammarSamplesApplied = 0;  // count of notes sampled from grammars

  // ── Analyser buffers (reused, no per-tick allocation) ──
  private freqBuf: Uint8Array;
  private tdBuf: Float32Array;

  // DEEP GAP J: Adaptive mastering chain
  // Track input level and adjust compressor thresholds so the chain adapts
  // to the material (quiet sections → lower thresholds, loud sections → higher).
  private masteringInterval: ReturnType<typeof setInterval> | null = null;
  private static readonly MASTERING_INTERVAL_MS = 1000;  // 1s adaptation rate
  // Target: -9 LUFS integrated (commercial psytrance standard)
  private static readonly TARGET_LUFS = -9;
  // Base thresholds (from constructor); we adapt around these
  private static readonly BASE_LOW_THRESHOLD = -18;
  private static readonly BASE_MID_THRESHOLD = -20;
  private static readonly BASE_HIGH_THRESHOLD = -28;
  // Reusable buffers for mastering analysis
  private masteringTdBuf: Float32Array;

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
    this.multibandLowGain.gain.value = 0.85;  // REDUCE low by −1.4dB (was 1.0, originally 1.4)
    this.multibandMidGain = this.ctx.createGain();
    this.multibandMidGain.gain.value = 1.0;   // UNITY — mids
    this.multibandHighGain = this.ctx.createGain();
    this.multibandHighGain.gain.value = 1.15;  // BOOST high by +1.2dB (was 1.0, originally 0.85)
    // WHY: the non-unity gains (1.4/1.2/0.85) were designed for a system WITH
    // multiband compressors that would catch the boosted peaks. When I removed
    // the compressors (to fix the 'shaking'), the gains just boosted the signal
    // into clipping. The low end (1.4× boost) was the worst — every kick/bass
    // hit slammed the brickwall limiter, causing pumping = 'the synth is shaking'.
    // With unity gains, the tonal filters still separate bands but don't boost
    // them. The saturation stage adds warmth; the glue comp + brickwall limiter
    // catch peaks cleanly.
    this.multibandSum = this.ctx.createGain();
    this.multibandSum.gain.value = 1.0;
    this.workletVolumeGain = this.ctx.createGain();
    // PRE-MASTER HEADROOM: 0.25 (−12dB) accounts for voice summing.
    // Without this, N simultaneous voices (each at amplitude ~0.5) sum to
    // N*0.5 — e.g. 10 melodic voices + 6 drum voices = 8.0 → massive clipping.
    // The saturation stage's tanh would clamp it, but with heavy distortion.
    // 0.25 gives ~12dB of headroom: 16 voices × 0.5 × 0.25 = 2.0 → saturation
    // clamps cleanly to ~0.96 → glue + limiter polish the result.
    // This is the ROOT FIX for 'the synth is shaking' — was clipping the
    // brickwall limiter every kick/bass hit → pumping.
    this.workletVolumeGain.gain.value = 0.25;
    this.masterLimiter = this.ctx.createDynamicsCompressor();
    this.masterLimiter.threshold.value = -0.3;
    this.masterLimiter.knee.value = 0;
    this.masterLimiter.ratio.value = 20;
    this.masterLimiter.attack.value = 0.001;
    this.masterLimiter.release.value = 0.05;

    // GLUE COMPRESSOR — gentle FIXED settings (not adaptive).
    // Restored after self-roast: I had removed ALL compression, which left
    // the mix unglued + quiet. The 'shaking' was caused by the ADAPTIVE
    // 1s LUFS targeting loop, NOT by compression itself. A gentle FIXED
    // glue compressor (2:1 ratio, slow attack/release, soft knee) glues
    // the mix without pumping. Settings inspired by psy3-clean's master chain.
    this.glueComp = this.ctx.createDynamicsCompressor();
    this.glueComp.threshold.value = -12;     // start compressing at -12dB
    this.glueComp.knee.value = 12;           // soft knee (musical)
    this.glueComp.ratio.value = 2;          // 2:1 gentle glue
    this.glueComp.attack.value = 0.030;     // 30ms — slow, lets transients through
    this.glueComp.release.value = 0.250;    // 250ms — slow release, no pumping

    // ── SATURATION STAGE (waveshaper) ──────────────────────────────────────
    // Adds harmonic warmth + glue BEFORE the compressor. A tanh curve gives
    // soft-clipping that sounds analog (mimics a transformer/tape saturation).
    // Drive amount is FIXED (not automated) — no pumping. The curve is
    // sampled once at construction; drive is fixed at 1.4 (subtle warmth,
    // not obvious distortion).
    this.saturationShaper = this.ctx.createWaveShaper();
    this.saturationShaper.oversample = '4x';   // 4x oversampling → kills aliasing
    this.saturationShaper.curve = this.makeSaturationCurve(1.4);

    // ── STEREO WIDENER (Mid/Side matrix) ──────────────────────────────────
    // True M/S processing: extract mid (L+R)/2 + side (L-R)/2, scale the side
    // by a width factor (1.4 = subtle widening), then reconstruct.
    // If the input is mono (L==R), side=0, so widening is a no-op — safe.
    // This adds space + air without phase issues when collapsed to mono
    // (because the mid component is preserved at unity).
    const width = 1.4;  // 1.0 = no widen, 2.0 = max (mono→stereo trick)
    const mid = 0.5;             // gain for the mid component (preserved)
    const side = (width - 1) * 0.5;  // gain for the side component (added)
    // L → mid gain (0.5) → merger[0]; R → mid gain (0.5) → merger[1]
    // L → side gain (+side) → merger[0]; R → side gain (-side) → merger[1]
    // So merger[0] = 0.5*L + 0.5*R + side*L - side*R = mid*L + side*(L-R)
    //              = (0.5+side)*L + (0.5-side)*R  ✓ matches NewL formula
    this.widenerSplitter = this.ctx.createChannelSplitter(2);
    this.gainMidL = this.ctx.createGain(); this.gainMidL.gain.value = mid;
    this.gainMidR = this.ctx.createGain(); this.gainMidR.gain.value = mid;
    this.gainSideL = this.ctx.createGain(); this.gainSideL.gain.value = side;
    this.gainSideR = this.ctx.createGain(); this.gainSideR.gain.value = -side;
    this.widenerMerger = this.ctx.createChannelMerger(2);
    // Wire: splitter → 4 gains → merger
    // L channel (splitter output 0)
    this.widenerSplitter.connect(this.gainMidL, 0);
    this.widenerSplitter.connect(this.gainSideL, 0);
    // R channel (splitter output 1)
    this.widenerSplitter.connect(this.gainMidR, 1);
    this.widenerSplitter.connect(this.gainSideR, 1);
    // Sum into merger: merger[0] = midL + sideL, merger[1] = midR + sideR
    this.gainMidL.connect(this.widenerMerger, 0, 0);
    this.gainSideL.connect(this.widenerMerger, 0, 0);
    this.gainMidR.connect(this.widenerMerger, 0, 1);
    this.gainSideR.connect(this.widenerMerger, 0, 1);

    // ── AIR / SPARKLE (high-shelf EQ) ──────────────────────────────────────
    // Boosts 8kHz+ by +4dB. Commercial psytrance has sparkle/air in this range
    // (hats, rides, lead harmonics, reverb tails). Without it the mix sounds
    // dark/muffled. Placed POST-widener so the widened stereo image gets the
    // air boost too. PRE-limiter so peaks are caught.
    this.airShelf = this.ctx.createBiquadFilter();
    this.airShelf.type = 'highshelf';
    this.airShelf.frequency.value = 8000;   // boost everything above 8kHz
    this.airShelf.gain.value = 8;           // +8dB — strong air boost (was +4, not enough)

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.7;
    this.freqBuf = new Uint8Array(this.analyser.frequencyBinCount);
    this.tdBuf = new Float32Array(this.analyser.fftSize);
    this.masteringTdBuf = new Float32Array(this.analyser.fftSize);  // DEEP GAP J

    // ── Wire master chain ──
    // SIMPLIFIED chain (was: 3 parallel multiband compressors → sum → volume → limiter).
    // The 3 per-band compressors + adaptive mastering (1s LUFS targeting) were
    // pumping the gain envelope independently per band, creating an audible
    // "shaking" / "pumping" effect — the user reported "the synth is shaking".
    //
    // New chain (per psy3-clean's verified approach):
    //   sidechainDuck → tonal filters + gains (still boost low/mid, cut high)
    //                 → sum → volume → brickwall limiter → analyser → destination
    // No per-band compression. The brickwall limiter catches peaks. The sidechain
    // duck (kick-ducked bass/pad bus) is preserved — that's a musical feature,
    // not a bug.
    this.sidechainDuck.connect(this.multibandLow);
    this.sidechainDuck.connect(this.multibandMid1);
    this.sidechainDuck.connect(this.multibandHigh);
    // LOW path: filter → gain (NO compressor)
    this.multibandLow.connect(this.multibandLowGain);
    this.multibandLowGain.connect(this.multibandSum);
    // MID path: filters → gain (NO compressor)
    this.multibandMid1.connect(this.multibandMid2);
    this.multibandMid2.connect(this.multibandMidGain);
    this.multibandMidGain.connect(this.multibandSum);
    // HIGH path: filter → gain (NO compressor)
    this.multibandHigh.connect(this.multibandHighGain);
    this.multibandHighGain.connect(this.multibandSum);
    this.multibandSum.connect(this.workletVolumeGain);
    // NEW MASTER CHAIN (v4 — saturation + glue + stereo widen + limiter):
    //   sum → volume → saturation (waveshaper) → glue (FIXED 2:1)
    //       → stereo widener (M/S matrix, width 1.4) → brickwall limiter
    //       → analyser → destination
    // Saturation adds warmth/harmonics BEFORE glue (so the compressor also
    // reacts to the added harmonics — classic analog glue). Widener is post-
    // glue so it widens the FINAL glued mix, not the raw sidechain output.
    this.workletVolumeGain.connect(this.saturationShaper);
    this.saturationShaper.connect(this.glueComp);
    this.glueComp.connect(this.widenerSplitter);   // widener input = glue output
    this.widenerMerger.connect(this.airShelf);      // air shelf = widener output
    this.airShelf.connect(this.masterLimiter);     // limiter catches air-boosted peaks
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
    // BACKUP (crash recovery): flush learning state to Turso before page unload.
    // Uses sendBeacon via fetch keepalive so the request survives page close.
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.onBeforeUnload);
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
    // DISABLED: adaptive mastering (LUFS targeting every 1s). The 3-band
    // multiband compressors it adjusted are now bypassed (see master chain
    // wiring above), and the 1s threshold modulation was the primary cause
    // of the "shaking" / "pumping" effect on the master output. The brickwall
    // limiter alone is enough to catch peaks — no adaptive gain needed.
    // this.startAdaptiveMastering();
    console.log('[PsyLive4] play — scheduler started');
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    this.scheduler.stop();
    this.stopLearningLoop();  // FIX GAP 1: clear learning interval
    this.stopAdaptiveMastering();  // DEEP GAP J: clear mastering interval
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
    // DEEP GAP A step 2: extract preferred notes from pattern memory
    // The learner stores bar fingerprints like "bass:52:0.5|hat:46:0.3|kick:36:0.7"
    // We parse the top patterns to extract which bass/lead notes were in high-reward bars.
    const topPatterns = this.learner.getTopPatterns(8);
    const bassNotes = new Set<number>();
    const leadNotes = new Set<number>();
    let totalEnergy = 0;
    let energyCount = 0;
    for (const p of topPatterns) {
      // Parse fingerprint: "role:note:vel|role:note:vel|..."
      const parts = p.fingerprint.split('|');
      for (const part of parts) {
        const tokens = part.split(':');
        if (tokens.length >= 3) {
          const role = tokens[0];
          const note = parseInt(tokens[1], 10);
          if (!isNaN(note)) {
            if (role === 'bass' || role === 'acid') bassNotes.add(note);
            else if (role === 'lead') leadNotes.add(note);
          }
        }
      }
      // Use reward as a proxy for energy (higher reward = higher energy bar)
      totalEnergy += p.reward;
      energyCount++;
    }
    const preferredNotes = (bassNotes.size > 0 || leadNotes.size > 0)
      ? { bassNotes, leadNotes, avgEnergy: energyCount > 0 ? totalEnergy / energyCount : 0 }
      : undefined;

    const result = this.composer.compose({
      startTime: windowStart,
      duration: windowEnd - windowStart,
      bpm: this.bpm,
      style: this.style,
      energy: this.energy,
      seed: this.seed,
      prev: this.composerPrev,
      preferredNotes,
    });
    this.composerPrev = result.next;
    this.bar = result.next.barInArrangement;

    // ── GRAMMAR-DRIVEN COMPOSITION ──
    // When learning is on + grammar confidence is high enough, REPLACE some
    // composer-generated notes with grammar-sampled ones. This is the real
    // "the music changes because of learning" effect — bass notes start
    // following learned transitions, melodies shift toward learned intervals.
    //
    // Probability scales with confidence: 0% at conf=0, ~50% at conf=1.
    // We only replace SOME notes — the composer's structure (which step
    // fires, the rhythm) is preserved; only the pitch is nudged.
    if (this.learningOn) {
      const stats = this.grammarLearner.getStats();
      const bassReplaceProb = stats.bass.total > 20 ? Math.min(0.5, stats.confidence * 0.6) : 0;
      const melodicNudgeProb = stats.melodic.total > 20 ? Math.min(0.4, stats.confidence * 0.5) : 0;
      let lastBassPc: number | null = null;
      let lastLeadMidi: number | null = null;
      for (const e of result.events) {
        if (e.role === 'bass') {
          const pc = ((Math.round(e.note) % 12) + 12) % 12;
          // Try to sample next bass PC from grammar
          if (Math.random() < bassReplaceProb) {
            const sampled = this.grammarLearner.sampleBassPc(lastBassPc ?? pc);
            if (sampled !== null) {
              // Replace note: keep the same octave, swap pitch class
              const octave = Math.floor(Math.round(e.note) / 12);
              e.note = octave * 12 + sampled;
              this.grammarSamplesApplied++;
            }
          }
          lastBassPc = pc;
        } else if (e.role === 'lead' || e.role === 'acid') {
          // Try to nudge the note by a sampled melodic interval
          if (Math.random() < melodicNudgeProb && lastLeadMidi !== null) {
            const interval = this.grammarLearner.sampleMelodicInterval();
            if (interval !== null && interval !== 0) {
              const newNote = Math.max(36, Math.min(96, Math.round(e.note) + interval));
              if (newNote !== Math.round(e.note)) {
                e.note = newNote;
                this.grammarSamplesApplied++;
              }
            }
          }
          lastLeadMidi = Math.round(e.note);
        }
      }
    }

    // ── RHYTHM MODULATION — the REAL AUDIBLE learning ─────────────────────
    // The pitch replacement above is often inaudible in psytrance (bass is
    // mostly root notes, so PC changes are subtle). The AUDIBLE change comes
    // from modulating bass VELOCITY based on the radio's bassline pattern.
    //
    // When the radio has energy at step X, boost the bass velocity at step X.
    // When the radio has silence at step X, reduce the bass velocity.
    // This makes the bass GROOVE follow the radio — the most immediately
    // noticeable effect of "learning from the radio".
    //
    // This is the gap that was missing: the rhythm grammar was LEARNED
    // (observeRadioPatterns feeds radio bass energy to the rhythm grammar)
    // but NEVER APPLIED. Now it's applied directly to the composed events.
    if (this.learningOn) {
      const radioBass = this.radioListener?.getBasslinePattern() ?? null;
      if (radioBass && radioBass.length >= 16) {
        const barLen = 4 * 60 / this.bpm;
        const sixteenth = (60 / this.bpm) / 4;
        for (const e of result.events) {
          if (e.role !== 'bass' && e.role !== 'acid') continue;
          // Compute 16th-step position in the bar (0..15)
          const barZero = e.at - (((e.at % barLen) + barLen) % barLen);
          const step = Math.floor((e.at - barZero) / sixteenth) % 16;
          const radioEnergy = radioBass[step] ?? 0.5;
          // Scale velocity: floor 0.15 (never fully silent), ceiling 1.0
          // At radioEnergy=1.0: velocity stays the same (×1.0)
          // At radioEnergy=0.5: velocity × 0.65 (noticeably quieter)
          // At radioEnergy=0.0: velocity × 0.3 (much quieter — the groove breathes)
          const scale = 0.3 + 0.7 * radioEnergy;
          e.velocity = Math.max(0.15, Math.min(1.0, e.velocity * scale));
        }
      }
    }

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
      // ── GRAMMAR LEARNING ──
      // Observe every note played. The grammar learner builds statistical
      // models of bass transitions, melodic intervals, and kick onsets.
      // When confidence is high, the composer can sample from these models
      // instead of using the built-in style banks (real musical learning,
      // not just CC knob tweaking).
      if (this.learningOn) {
        // Compute step-in-bar (0..15) from `at` + bpm (NoteEvent has no step field)
        const barLen = 4 * 60 / this.bpm;
        const sixteenth = (60 / this.bpm) / 4;
        const barZero = e.at - (((e.at % barLen) + barLen) % barLen);
        const stepInBar = Math.floor((e.at - barZero) / sixteenth) % 16;
        this.grammarLearner.observeNote(e.role, e.note, stepInBar);
      }
      // PHASE F: track what was played (for musical similarity reward)
      if (e.role === 'bass' || e.role === 'acid') {
        const sixteenth = (60 / this.bpm) / 4;
        const step16 = Math.floor((e.at - windowStart) / sixteenth) % 16;
        this.lastBarBassSteps.add(step16);
      } else if (e.role === 'lead') {
        this.lastBarLeadNotes.push(e.note);
      }
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

  /**
   * Build a tanh-style saturation curve for the WaveShaperNode.
   * Drive 1.0 = clean (no saturation); 1.4 = subtle warmth; 2.0 = obvious
   * distortion. The curve is symmetric (positive + negative halves) so DC
   * offset is not introduced. 4x oversampling on the shaper kills aliasing
   * above Nyquist.
   *
   * The curve is a Float32Array of 2048 samples covering -1..+1 input range.
   * tanh(drive * x) gives smooth soft-clipping (analog-style).
   */
  private makeSaturationCurve(drive: number): Float32Array {
    const n = 2048;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;   // -1..+1
      curve[i] = Math.tanh(drive * x);
    }
    return curve;
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
      // User gesture — resume AudioContext so the analyser actually sees
      // radio data. Without this, the audio element plays through its own
      // output but the MediaElementSource → analyser path is suspended.
      if (this.ctx.state === 'suspended') {
        try { await this.ctx.resume(); } catch (e) { console.warn('[PsyLive4] ctx.resume() failed:', e); }
      }
      // Cancel any pending infinite-reconnect timer — we're connecting now
      if (this.radioReconnectTimer) {
        clearTimeout(this.radioReconnectTimer);
        this.radioReconnectTimer = null;
      }
      // Load streams list and connect to first available
      const streams = await this.loadRadioStreams();
      if (streams.length === 0) {
        console.warn('[PsyLive4] No radio streams available');
        return;
      }
      // BACKUP: register health listener for auto-failover BEFORE connecting
      this.radioListener.onHealthEvent((event) => this.onStreamHealthEvent(event));
      this.radioListener.clearFailedStreams();  // fresh start
      this.radioReconnectAttempts = 0;
      // Try streams in priority order until one connects
      const ok = await this.tryConnectStreams(streams);
      if (!ok) {
        console.warn('[PsyLive4] All radio streams failed on first try — scheduling infinite retry in 30s');
        this.scheduleInfiniteReconnect();
      }
    } else {
      // Radio turned off — cancel any pending reconnect
      if (this.radioReconnectTimer) {
        clearTimeout(this.radioReconnectTimer);
        this.radioReconnectTimer = null;
      }
      this.radioListener.disconnect();
      this.radioTarget = null;
      // FIX GAP 3: restore default commercial targets (was: stuck at last stream's values)
      restoreDefaultTargets();
      console.log('[PsyLive4] Radio OFF — targets restored to defaults');
    }
  }

  /**
   * Manual reset — user clicked the RESET button in the Smart Radio UI.
   * Clears failed-stream memory, disconnects, and reconnects from scratch.
   * Also used internally by the infinite-reconnect loop.
   */
  async resetRadio(): Promise<boolean> {
    if (!this.smartRadioOn) return false;
    // User gesture — make sure ctx is running (in case it was suspended
    // by the browser while tab was backgrounded).
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch (e) { console.warn('[PsyLive4] ctx.resume() failed:', e); }
    }
    console.log('[PsyLive4] RESET: clearing failed streams + reconnecting');
    if (this.radioReconnectTimer) {
      clearTimeout(this.radioReconnectTimer);
      this.radioReconnectTimer = null;
    }
    this.radioListener.clearFailedStreams();
    this.radioListener.disconnect();
    this.radioTarget = null;
    // Reload streams (in case streams.json was edited) and reconnect
    const streams = await this.loadRadioStreams();
    if (streams.length === 0) {
      console.warn('[PsyLive4] RESET: no streams available');
      this.scheduleInfiniteReconnect();
      return false;
    }
    const ok = await this.tryConnectStreams(streams);
    if (!ok) {
      console.warn('[PsyLive4] RESET: all streams failed — will retry in 30s');
      this.scheduleInfiniteReconnect();
    }
    return ok;
  }

  /**
   * INFINITE: when all streams are exhausted, wait RESET_COOLDOWN_MS then
   * clear failed-stream memory and try again. This loop continues forever
   * until the user turns radio off or a connection succeeds.
   */
  private scheduleInfiniteReconnect(): void {
    if (!this.smartRadioOn) return;  // user turned radio off — stop looping
    if (this.radioReconnectTimer) return;  // already scheduled
    this.radioReconnectAttempts++;
    console.log(`[PsyLive4] INFINITE: scheduling reconnect #${this.radioReconnectAttempts} in ${PsyLive4.RESET_COOLDOWN_MS / 1000}s`);
    this.radioReconnectTimer = setTimeout(() => {
      this.radioReconnectTimer = null;
      if (!this.smartRadioOn) return;
      // Auto-reset and try again
      this.resetRadio();
    }, PsyLive4.RESET_COOLDOWN_MS);
  }

  /**
   * Connect to streams using the CORS proxy by default.
   *
   * WHY: all known psytrance radio streams send audio without CORS headers,
   * so a direct <audio crossOrigin="anonymous"> connection gives us a
   * silent analyser (the audio element plays, but MediaElementSource
   * produces zeros). Routing through /api/radio/proxy adds
   * `Access-Control-Allow-Origin: *` server-side so the analyser sees
   * the real audio data.
   *
   * The proxy is on our own origin so there's no preflight penalty.
   */
  private async tryConnectStreams(streams: RadioStream[]): Promise<boolean> {
    // Sort by priority (1 = primary, 2 = backup). Default to 1.
    const sorted = [...streams].sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1));
    for (const stream of sorted) {
      if (this.radioListener.isStreamFailed(stream.id)) {
        console.log(`[PsyLive4] skipping failed stream ${stream.name}`);
        continue;
      }
      // Wrap URL with our CORS proxy — direct connect always fails because
      // radio servers don't send Access-Control-Allow-Origin.
      const ok = await this.radioListener.connectViaProxy(stream);
      if (ok) {
        this.currentRadioStreams = sorted;  // store for failover
        this.radioLastConnectTime = Date.now();
        // Successful connect resets the reconnect counter (we're healthy again)
        this.radioReconnectAttempts = 0;
        return true;
      }
      // Mark as failed so we don't retry it immediately
      this.radioListener.markStreamFailed(stream.id);
    }
    return false;
  }

  /**
   * BACKUP: Handle stream health events — auto-failover when a stream dies.
   * Triggered by RadioListener when:
   * - 'stalled': no audio data for >15s
   * - 'cors-blocked': stream plays but analyser is silent (CORS headers missing)
   * - 'error': connection failed
   *
   * For CORS-blocked streams: retry through our /api/radio/proxy first.
   * For stalled/errored streams: skip to the next stream in the list.
   */
  private async onStreamHealthEvent(event: {
    type: 'connected' | 'stalled' | 'error' | 'cors-blocked' | 'switching';
    streamId: string;
    streamName: string;
    reason?: string;
  }): Promise<void> {
    if (event.type === 'connected') return;  // healthy — nothing to do

    console.warn(`[PsyLive4] stream health: ${event.type} on ${event.streamName}${event.reason ? ` (${event.reason})` : ''}`);

    // Don't failover if radio is being turned off
    if (!this.smartRadioOn) return;

    // BACKUP: for CORS-blocked streams, retry through our proxy FIRST
    // (before failing over to a different stream)
    if (event.type === 'cors-blocked') {
      const originalStream = this.currentRadioStreams.find(s => s.id === event.streamId);
      if (originalStream && !this.radioListener.isStreamFailed(`${event.streamId}-proxy`)) {
        this.radioListener.markStreamFailed(`${event.streamId}-proxy`);  // try proxy only once
        console.log(`[PsyLive4] BACKUP: retrying ${event.streamName} via CORS proxy`);
        this.radioListener.disconnect();
        setTimeout(async () => {
          if (!this.smartRadioOn) return;
          const ok = await this.radioListener.connectViaProxy(originalStream);
          if (ok) {
            console.log(`[PsyLive4] BACKUP: proxy connection succeeded for ${event.streamName}`);
          } else {
            console.warn(`[PsyLive4] BACKUP: proxy also failed for ${event.streamName} — failing over to next stream`);
            await this.failoverToNextStream(event.streamId, event.streamName);
          }
        }, 1000);
        return;
      }
    }

    // For stalled/error (or proxy-failed CORS), failover to next stream
    await this.failoverToNextStream(event.streamId, event.streamName);
  }

  /**
   * BACKUP: Failover to the next non-failed stream.
   * When all streams are exhausted, schedule an infinite reconnect loop
   * (waits 30s, clears failed-stream memory, retries forever).
   */
  private async failoverToNextStream(failedStreamId: string, failedStreamName: string): Promise<void> {
    this.radioListener.markStreamFailed(failedStreamId);
    if (this.currentRadioStreams.length === 0) return;

    const nextStream = this.currentRadioStreams.find(s => !this.radioListener.isStreamFailed(s.id));
    if (nextStream && nextStream.id !== failedStreamId) {
      console.log(`[PsyLive4] BACKUP: auto-failover from ${failedStreamName} → ${nextStream.name}`);
      this.radioListener.disconnect();
      setTimeout(async () => {
        if (!this.smartRadioOn) return;
        // Use proxy for failover too (same reason: streams don't send CORS headers)
        const ok = await this.radioListener.connectViaProxy(nextStream);
        if (ok) {
          this.radioLastConnectTime = Date.now();
          this.radioReconnectAttempts = 0;
        } else {
          this.radioListener.markStreamFailed(nextStream.id);
          // Try remaining streams recursively
          await this.failoverToNextStream(nextStream.id, nextStream.name);
        }
      }, 1000);
    } else {
      console.warn(`[PsyLive4] BACKUP: all streams failed — keeping last known targets + scheduling infinite reconnect`);
      this.scheduleInfiniteReconnect();
    }
  }

  private async loadRadioStreams(): Promise<RadioStream[]> {
    try {
      const resp = await fetch('/api/streams.json');
      if (!resp.ok) return [];
      const data = await resp.json();
      const streams = data.streams || data;
      return streams.map((s: any) => ({
        id: s.id,
        name: s.name,
        url: s.url,
        priority: s.priority ?? 1,  // BACKUP: preserve priority for failover ordering
      }));
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

  // ───────────────────────────────────────────────────────────────────────
  // DEEP GAP J: Adaptive mastering chain
  //
  // Commercial mastering limiters (Pro-L 2, Oxford Limiter) adapt their
  // thresholds to the input level. Our static thresholds (-18/-20/-28 dB)
  // are fine for one loudness level, but when the engine plays quietly
  // (intro/breakdown) or loudly (drop), the compressors either over-compress
  // or under-compress.
  //
  // Every 1s, we measure the current LUFS and nudge the compressor thresholds
  // toward the target (-9 LUFS). This keeps the compression ratio consistent
  // regardless of input level.
  // ───────────────────────────────────────────────────────────────────────

  private startAdaptiveMastering(): void {
    if (this.masteringInterval) clearInterval(this.masteringInterval);
    this.masteringInterval = setInterval(
      () => this.adaptMastering(),
      PsyLive4.MASTERING_INTERVAL_MS,
    );
    console.log(`[PsyLive4] adaptive mastering started — ${PsyLive4.MASTERING_INTERVAL_MS}ms interval, target ${PsyLive4.TARGET_LUFS} LUFS`);
  }

  private stopAdaptiveMastering(): void {
    if (this.masteringInterval) {
      clearInterval(this.masteringInterval);
      this.masteringInterval = null;
    }
  }

  private adaptMastering(): void {
    if (!this.playing || this.suspended || this.ctx.state !== 'running') return;
    try {
      // Read the analyser (post-master, pre-destination) to get the current output level
      this.analyser.getFloatTimeDomainData(this.masteringTdBuf as Float32Array<ArrayBuffer>);
      let peak = 0, sumSq = 0;
      for (let i = 0; i < this.masteringTdBuf.length; i++) {
        const v = this.masteringTdBuf[i];
        const abs = Math.abs(v);
        if (abs > peak) peak = abs;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / this.masteringTdBuf.length);
      if (rms < 1e-6) return;  // silence — don't adapt

      // Current LUFS (approximation using K-weighting from audio-quality.ts)
      const currentLufs = -0.691 + 10 * Math.log10(sumSq / this.masteringTdBuf.length);
      if (!isFinite(currentLufs)) return;

      // How far are we from the target?
      const lufsError = PsyLive4.TARGET_LUFS - currentLufs;
      // Positive error = too quiet (need less compression / more gain)
      // Negative error = too loud (need more compression)

      // Adapt thresholds: nudge by a fraction of the error (slow adaptation)
      // If too quiet: raise thresholds (less compression) + raise gains
      // If too loud: lower thresholds (more compression)
      const adaptRate = 0.1;  // 10% of error per second
      const thresholdShift = lufsError * adaptRate * 0.5;

      // Clamp thresholds to reasonable ranges
      const newLowThresh = Math.max(-30, Math.min(-6, PsyLive4.BASE_LOW_THRESHOLD + thresholdShift));
      const newMidThresh = Math.max(-32, Math.min(-8, PsyLive4.BASE_MID_THRESHOLD + thresholdShift));
      const newHighThresh = Math.max(-40, Math.min(-12, PsyLive4.BASE_HIGH_THRESHOLD + thresholdShift));

      // Apply with smooth ramp (avoid clicks)
      const t = this.ctx.currentTime;
      const rampTime = 0.3;  // 300ms smooth transition
      this.multibandLowComp.threshold.setTargetAtTime(newLowThresh, t, rampTime);
      this.multibandMidComp.threshold.setTargetAtTime(newMidThresh, t, rampTime);
      this.multibandHighComp.threshold.setTargetAtTime(newHighThresh, t, rampTime);

      // Log only when the change is significant (avoid console spam)
      if (Math.abs(lufsError) > 1.5) {
        console.log(`[Mastering] LUFS=${currentLufs.toFixed(1)} target=${PsyLive4.TARGET_LUFS} err=${lufsError.toFixed(1)} → thresholds L=${newLowThresh.toFixed(1)} M=${newMidThresh.toFixed(1)} H=${newHighThresh.toFixed(1)}`);
      }
    } catch (err) {
      // non-fatal — mastering adaptation is a nice-to-have
    }
  }

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

  /**
   * Turso cloud sync — load best params + convergence from the cloud.
   * Called on engine init. Merges cloud state with local state (cloud wins
   * if reward is higher). This gives cross-session + cross-device memory.
   */
  async loadCloudState(): Promise<number> {
    try {
      const cloud = await loadCloudLearningState();
      if (!cloud || !cloud.ok || !cloud.bestParams) {
        console.log('[PsyLive4] cloud sync: no cloud state available (using localStorage)');
        return 0;
      }
      let loaded = 0;
      const localBest = this.learner.getBestParams();
      const localReward = this.learner.getBestReward();
      // Merge: if cloud reward > local reward, use cloud params
      if ((cloud.bestReward ?? 0) > localReward) {
        for (const [ccStr, data] of Object.entries(cloud.bestParams)) {
          const cc = Number(ccStr);
          const value = (data as { value: number; reward: number }).value;
          if (typeof cc === 'number' && typeof value === 'number') {
            // Apply to engine + learner
            this.setCC(cc, value);
            localBest[cc] = value;
            loaded++;
          }
        }
        console.log(`[PsyLive4] cloud sync: loaded ${loaded} params from cloud (cloud reward ${cloud.bestReward?.toFixed(3)} > local ${localReward.toFixed(3)})`);
      } else {
        console.log(`[PsyLive4] cloud sync: local state is better (local ${localReward.toFixed(3)} >= cloud ${cloud.bestReward?.toFixed(3)})`);
      }
      // Load convergence history for the sparkline
      if (cloud.convergenceHistory && cloud.convergenceHistory.length > 0) {
        this.convergenceHistory = cloud.convergenceHistory.map(c => c.value);
        if (this.convergenceHistory.length > PsyLive4.CONVERGENCE_HISTORY_MAX) {
          this.convergenceHistory = this.convergenceHistory.slice(-PsyLive4.CONVERGENCE_HISTORY_MAX);
        }
      }
      this.cloudSyncOn = true;
      return loaded;
    } catch (err) {
      console.warn('[PsyLive4] cloud sync load failed:', err);
      return 0;
    }
  }

  /**
   * Push current learning state to Turso (debounced, called from learning tick).
   * Pushes: bestParams + bestReward + latest convergence.
   */
  private async syncToCloud(now: number): Promise<void> {
    if (!this.cloudSyncOn) return;
    if (now - this.lastCloudSyncTime < PsyLive4.CLOUD_SYNC_INTERVAL_SEC) return;
    this.lastCloudSyncTime = now;
    const bestParams = this.learner.getBestParams();
    const bestReward = this.learner.getBestReward();
    const ok = await syncCloudLearningState(bestParams, bestReward, this.convergence);
    if (!ok) {
      // Cloud might be down — back off
      this.lastCloudSyncTime = now + 40;  // wait 60s before retry
    }
  }

  /**
   * Push pending pattern observations to Turso (debounced, batched).
   */
  private async syncPatternsToCloud(now: number): Promise<void> {
    if (!this.cloudSyncOn) return;
    if (now - this.lastPatternSyncTime < PsyLive4.PATTERN_SYNC_INTERVAL_SEC) return;
    if (this.pendingPatternSync.size === 0) return;
    this.lastPatternSyncTime = now;
    const patterns = Array.from(this.pendingPatternSync.entries()).map(([fingerprint, reward]) => ({ fingerprint, reward }));
    this.pendingPatternSync.clear();
    const ok = await syncCloudPatterns(patterns);
    if (!ok) {
      // Put them back if sync failed
      for (const p of patterns) this.pendingPatternSync.set(p.fingerprint, p.reward);
      this.lastPatternSyncTime = now + 30;  // back off
    }
  }

  /**
   * Log radio telemetry to Turso (for offline analysis of what "commercial" sounds like).
   */
  private async logTelemetryToCloud(now: number): Promise<void> {
    if (!this.cloudSyncOn || !this.radioTarget || !this.radioTarget.connected) return;
    if (now - this.lastTelemetryTime < PsyLive4.TELEMETRY_INTERVAL_SEC) return;
    this.lastTelemetryTime = now;
    await logRadioTelemetry({
      streamName: this.radioTarget.streamName,
      bpm: this.radioTarget.bpm,
      warmth: this.radioTarget.warmth,
      brightness: this.radioTarget.brightness,
      loudness: this.radioTarget.loudness,
      smoothness: this.radioTarget.smoothness,
      style: this.radioTarget.style,
      inBreakdown: this.radioTarget.inBreakdown,
    });
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

  /**
   * BACKUP (crash recovery): Flush learning state to Turso before page unload.
   * Uses fetch with keepalive so the request survives page close/navigation.
   * This ensures the latest best params + convergence are persisted even if
   * the browser crashes or the user closes the tab.
   */
  private onBeforeUnload = (): void => {
    if (!this.cloudSyncOn) return;
    try {
      const bestParams = this.learner.getBestParams();
      const bestReward = this.learner.getBestReward();
      // fetch with keepalive — fire-and-forget, survives page close
      fetch('/api/learning/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bestParams, bestReward, convergence: this.convergence }),
        keepalive: true,  // survives page unload
      }).catch(() => {});
      console.log(`[PsyLive4] beforeunload — flushed state to cloud (reward=${bestReward.toFixed(3)})`);
    } catch {}
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
      // Turso cloud sync status
      cloudSync: this.cloudSyncOn,
      cloudParamsLoaded: 0,  // set during loadCloudState (not tracked per-tick)
      // Radio reconnect status
      radioReconnectAttempts: this.radioReconnectAttempts,
      radioLastConnectTime: this.radioLastConnectTime,
      // GRAMMAR LEARNING STATS — what the engine has actually learned
      grammarStats: this.learningOn ? this.grammarLearner.getStats() : null,
      grammarSamplesApplied: this.grammarSamplesApplied,
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

    // ── EXTERNAL TEACHER: feed radio's extracted patterns to the grammar learner ──
    // CRITICAL FIX: the grammar learner was only observing the COMPOSER'S OWN
    // output (a closed self-feedback loop that can only regress to the mean).
    // Now it also observes the radio's REAL extracted bass + lead patterns —
    // an external teacher. The grammars learn what actual psytrance tracks
    // sound like, not just what the composer already does.
    const radioBass = this.radioListener?.getBasslinePattern() ?? null;
    const radioLead = this.radioListener?.getLeadPattern() ?? null;
    if (this.learningOn && (radioBass || radioLead)) {
      this.grammarLearner.observeRadioPatterns(radioBass, radioLead);
    }

    // PHASE F: compute MUSICAL reward — how similar is the engine's music to the radio?
    // Was: reward = engineQuality.overall (spectral only). Now: includes rhythmic + melodic match.
    let spectralConvergence = 0;
    if (this.radioTarget && this.radioTarget.connected) {
      spectralConvergence = computeConvergence(engineQuality, this.radioTarget);
    }

    // Rhythmic similarity: Jaccard index between engine bass steps + radio bass pattern
    let rhythmicSimilarity = 0;
    if (radioBass && radioBass.length >= 16) {
      const radioBassSteps = new Set<number>();
      for (let i = 0; i < 16; i++) { if (radioBass[i] > 0.3) radioBassSteps.add(i); }
      const intersection = [...this.lastBarBassSteps].filter(s => radioBassSteps.has(s));
      const union = new Set([...this.lastBarBassSteps, ...radioBassSteps]);
      rhythmicSimilarity = union.size > 0 ? intersection.length / union.size : 0;
    }

    // Melodic similarity: average note distance → similarity (1 = identical, 0 = 12+ semitones off)
    let melodicSimilarity = 0;
    if (radioLead && this.lastBarLeadNotes.length > 0) {
      let totalDist = 0, count = 0;
      for (const note of this.lastBarLeadNotes) {
        // Find closest radio note
        let minDist = 12;
        for (let i = 0; i < radioLead.length; i++) {
          if (radioLead[i] >= 0) {
            const dist = Math.abs(note % 12 - radioLead[i] % 12); // pitch class distance
            if (dist < minDist) minDist = dist;
          }
        }
        totalDist += minDist;
        count++;
      }
      melodicSimilarity = count > 0 ? Math.max(0, 1 - totalDist / (count * 6)) : 0;
    }

    // MUSICAL REWARD: 40% rhythm + 30% melody + 30% spectral
    const musicalReward = 0.4 * rhythmicSimilarity + 0.3 * melodicSimilarity + 0.3 * spectralConvergence;

    // Override the spectral reward with the musical reward
    engineQuality.overall = this.rewardEMA * (1 - 0.5) + musicalReward * 0.5; // blend EMA with new reward

    // DEEP GAP C: convergence = the musical reward (not just spectral)
    if (this.radioTarget && this.radioTarget.connected) {
      this.convergence = this.convergenceEMA * 0.85 + musicalReward * 0.15;
      this.convergenceHistory.push(this.convergence);
      if (this.convergenceHistory.length > PsyLive4.CONVERGENCE_HISTORY_MAX) this.convergenceHistory.shift();
    }

    // Reset per-bar tracking (for next bar's similarity measurement)
    this.lastBarBassSteps = new Set();
    this.lastBarLeadNotes = [];

    // DEEP GAP A: record pattern memory with the MUSICAL reward
    if (this.barFingerprints.length > 0) {
      const latestFingerprint = this.barFingerprints[this.barFingerprints.length - 1];
      this.learner.recordPattern(latestFingerprint, engineQuality.overall, this.ctx.currentTime);
      this.pendingPatternSync.set(latestFingerprint, engineQuality.overall);
    }

    // Turso cloud sync (debounced — every 20s for params, 30s for patterns, 10s for telemetry)
    const nowT = this.ctx.currentTime;
    this.syncToCloud(nowT).catch(() => {});
    this.syncPatternsToCloud(nowT).catch(() => {});
    this.logTelemetryToCloud(nowT).catch(() => {});

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
    const prevBestReward = this.learner.getBestReward();
    const trial = this.learner.tick(this.ctx.currentTime, engineQuality, suggestions);
    if (trial) {
      this.setCC(trial.cc, trial.value);
      console.log(`[Learning] trial: CC${trial.cc}=${trial.value.toFixed(2)} (epsilon-greedy)`);
    }

    // BACKUP (crash recovery): if this tick found a NEW best reward, immediately
    // checkpoint to Turso cloud (don't wait for the 20s debounce). This way a
    // server crash never loses more than 4s of learning progress.
    const newBestReward = this.learner.getBestReward();
    if (this.cloudSyncOn && newBestReward > prevBestReward) {
      console.log(`[Learning] new best reward ${newBestReward.toFixed(3)} > ${prevBestReward.toFixed(3)} — immediate cloud checkpoint`);
      this.syncToCloud(this.ctx.currentTime).catch(() => {});
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
    this.stopAdaptiveMastering();  // DEEP GAP J: clear mastering interval on dispose
    if (this.radioReconnectTimer) {
      clearTimeout(this.radioReconnectTimer);
      this.radioReconnectTimer = null;
    }
    this.radioListener.dispose();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.onBeforeUnload);
    }
    this.host.dispose();
    this.melodicDevice.dispose();
    this.ctx.close().catch(() => {});
  }
}
