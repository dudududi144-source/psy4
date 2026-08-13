/**
 * PSY LIVE v2 — Built from psy's proven approach.
 * 
 * WHY psy works and we didn't:
 * - psy uses createOscillator directly (no PooledEngine, no pre-rendered buffers)
 * - psy has simple chain: voices → master gain → analyser → destination
 * - psy has no limiter, no compressor, no sidechain, no EQ
 * - psy changes BPM and root when preset changes
 * - psy's variant A/B changes actual synth params (cutoff, Q, wave)
 * 
 * This file rebuilds the engine using psy's proven approach,
 * but with our sound bank (142 presets) and learning system.
 */

import { type LearningData, type Composition, loadLearning, saveLearning, recordKick, recordBassNote, recordRadioBands, recordEnergy, deriveInsights, getInsights, generateComposition } from './learning';
import { MusicalTransport } from '../../foundation/transport/MusicalTransport';
import { RadioObservationLayer } from '../../foundation/radio/RadioObservationLayer';
import { DEFAULT_RADIO_CONFIG } from '../../foundation/radio/RadioObservationTypes';
import { MusicalSession, type NotePlan } from '../../foundation/music/MusicalSession';
import { CausalComposer, type CausalNoteEvent, type CausalBarResult } from '../../foundation/music/CausalComposer';
import { SamplerBridge, type PsyDevice, type MusicalTransport as BridgeTransport, type MusicalContext as BridgeContext } from './sampler-bridge';
import { MaterialRealizer } from './material-realizer';
import { Psy4EngineNode, VOICE, type VoiceId, type EngineStats } from './studio/engine/engineWorklet';

// Voice ID mapping: CausalComposer channels → AudioWorklet voice IDs
const CHANNEL_TO_VOICE: Record<string, VoiceId> = {
  kick: VOICE.KICK, bass: VOICE.BASS, sub: VOICE.BASS,
  lead: VOICE.LEAD, counterline: VOICE.LEAD, motif: VOICE.LEAD,
  acid: VOICE.ACID, arp: VOICE.LEAD,
  pad: VOICE.PAD, drone: VOICE.PAD,
  'hat-closed': VOICE.HAT, 'hat-open': VOICE.HAT_OPEN, hat: VOICE.HAT,
  shaker: VOICE.SHAKER,
  clap: VOICE.CLAP, snare: VOICE.CLAP,
  percussion: VOICE.PERC, tom: VOICE.PERC, fill: VOICE.PERC, rim: VOICE.PERC,
  ride: VOICE.HAT, crash: VOICE.HAT_OPEN,
  texture: VOICE.TEXTURE, atmosphere: VOICE.TEXTURE,
  riser: VOICE.RISER, impact: VOICE.IMPACT,
  sweep: VOICE.SWEEP, reverse: VOICE.SWEEP,
  downlifter: VOICE.DOWNLIFTER,
  stab: VOICE.ZAP, chord: VOICE.FM,
};

// F13/R1: Removed dead imports — BeatPLL, PatternMutator, MelodyObserver,
// RadioStateGate, TransportAdapter. The LIVE instances live inside
// RadioObservationLayer. Single radio state machine now.

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const freqToNote = (f: number) => {
  if (f <= 0) return '—';
  const m = Math.round(12 * Math.log2(f / 440) + 69);
  return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
};
const freqToMidi = (f: number) => Math.round(12 * Math.log2(f / 440) + 69);

// ─── Presets (EXACTLY like psy — 4 distinct styles) ────────────────────────
interface PresetPattern { kick: number[]; bass: (number|null)[]; lead: (number|null)[]; hat: number[]; }
interface Variant {
  bassWave: OscillatorType; bassCut: number; bassQ: number;
  leadWave: OscillatorType; leadCut: number; leadQ: number;
  hatLvl: number; leadLvl: number;
}
interface Preset {
  id: string; name: string; tag: string; bpm: number; root: number;
  desc: string; patterns: PresetPattern; variants: { A: Variant; B: Variant };
}
interface Stream { id: string; name: string; url: string; genre: string; bitrate: number; }

// ─── Streams (HTTPS-only — F13/R1B: 3 dead URLs removed) ──────────────────
// Audit verified via curl -I: psyndora-prog (port 9110 refused),
// psyndora-chill (TLS EOF), radiocaprice-psy (DNS dead). Only live,
// CORS-enabled stations remain.
export const STREAMS: Stream[] = [
  { id: 'psyndora', name: 'Psyndora', url: 'https://cast.magicstreams.gr:9111/stream/1/', genre: 'Psytrance · Full-On · Goa', bitrate: 128 },
  { id: 'babaganousha', name: 'Babaganousha', url: 'https://babaganousha.net:8443/stream/1/', genre: 'Psychedelic · Goa', bitrate: 128 },
  { id: 'spaceunicorn', name: 'Space Unicorn', url: 'https://spaceunicorn.radio/stream', genre: 'Trance · PsyTrance', bitrate: 192 },
];

// 4 DISTINCT presets — each with unique BPM, root, patterns, and variants
export const PRESETS: Preset[] = [
  {
    id: 'rolling_bass', name: 'Rolling Bass', tag: 'full-on', bpm: 145, root: 33,
    desc: '16th-note rolling bass under four-on-the-floor kick.',
    patterns: {
      kick: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      bass: [null,0,0,0, null,0,0,0, null,0,0,0, null,0,0,3],
      lead: [null,null,null,null, null,null,12,null, null,null,null,null, 15,null,12,null],
      hat:  [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,1],
    },
    variants: {
      A: { bassWave:'sawtooth', bassCut:700, bassQ:6, leadWave:'sawtooth', leadCut:1800, leadQ:9, hatLvl:0.12, leadLvl:0.45 },
      B: { bassWave:'square', bassCut:1150, bassQ:11, leadWave:'sawtooth', leadCut:2600, leadQ:14, hatLvl:0.18, leadLvl:0.55 },
    },
  },
  {
    id: 'acid_lead', name: 'Acid Lead', tag: 'squelchy', bpm: 148, root: 33,
    desc: 'Resonant acid line over tight groove.',
    patterns: {
      kick: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      bass: [null,0,null,0, null,0,null,0, null,0,null,0, null,0,5,7],
      lead: [0,null,3,null, 0,null,7,null, 10,null,7,null, 3,null,2,null],
      hat:  [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,1,1,0],
    },
    variants: {
      A: { bassWave:'sawtooth', bassCut:600, bassQ:5, leadWave:'sawtooth', leadCut:2200, leadQ:12, hatLvl:0.12, leadLvl:0.55 },
      B: { bassWave:'sawtooth', bassCut:800, bassQ:8, leadWave:'square', leadCut:3400, leadQ:18, hatLvl:0.16, leadLvl:0.62 },
    },
  },
  {
    id: 'dark_prog', name: 'Dark Prog', tag: 'hypnotic', bpm: 138, root: 31,
    desc: 'Darker, slower, hypnotic. Sparse eerie highs.',
    patterns: {
      kick: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      bass: [null,0,0,0, null,0,0,0, null,0,0,0, null,0,3,0],
      lead: [null,null,null,12, null,null,null,null, null,null,null,14, null,null,null,null],
      hat:  [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0],
    },
    variants: {
      A: { bassWave:'sawtooth', bassCut:480, bassQ:4, leadWave:'triangle', leadCut:1400, leadQ:6, hatLvl:0.07, leadLvl:0.40 },
      B: { bassWave:'sawtooth', bassCut:650, bassQ:7, leadWave:'sawtooth', leadCut:1900, leadQ:10, hatLvl:0.11, leadLvl:0.48 },
    },
  },
  {
    id: 'full_on', name: 'Full On', tag: 'peak-time', bpm: 150, root: 35,
    desc: 'Busy peak-time: rolling bass, active lead, extra hats.',
    patterns: {
      kick: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      bass: [null,0,0,0, null,0,0,0, null,0,0,0, null,0,7,10],
      lead: [0,null,null,3, null,null,7,null, 10,null,null,7, 12,null,7,null],
      hat:  [0,0,1,0, 0,1,1,0, 0,0,1,0, 0,1,1,1],
    },
    variants: {
      A: { bassWave:'sawtooth', bassCut:900, bassQ:7, leadWave:'sawtooth', leadCut:2400, leadQ:10, hatLvl:0.16, leadLvl:0.50 },
      B: { bassWave:'square', bassCut:1300, bassQ:12, leadWave:'square', leadCut:3200, leadQ:16, hatLvl:0.22, leadLvl:0.60 },
    },
  },
];

// ─── State ─────────────────────────────────────────────────────────────────
export type MixMode = 'solo' | 'glue' | 'reinforce';
// R3/F13: SyncStatus reflects actual RadioObservationLayer state.
// 'listening' = signal present, PLL acquiring.
// 'following' = PLL locked, Transport following radio tempo.
export type SyncStatus = 'idle' | 'connecting' | 'no_signal' | 'listening' | 'following' | 'holdover' | 'error';

export interface LiveState {
  playing: boolean;
  radioOn: boolean;
  radioBpm: number;
  engineBpm: number;
  syncStatus: SyncStatus;
  mixMode: MixMode;
  kickCount: number;
  bassNote: string;
  radioLevel: number;
  engineLevel: number;
  presetId: string;
  variant: 'A' | 'B';
  learned: { bpm: number; key: string; confidence: number; scale: string | null } | null;
  sidechainActive: boolean;
  harmonicLocked: boolean;
  radioRms: number;
  radioBands: { low: number; mid: number; high: number };
  compositionMode: boolean;
  // Occupancy (from RadioObservationLayer)
  occupancy: { kick: number; bass: number; lead: number; hats: number };
  // F13/R1: Single radio state machine — from RadioObservationLayer
  radioSignalState: string;   // DISCONNECTED|CONNECTING|NO_SIGNAL|WEAK_SIGNAL|SIGNAL_PRESENT|STABLE_SIGNAL|LOST|DEGRADED|ERROR
  radioObservationState: string; // NO_SIGNAL|SIGNAL_PRESENT|LOCKING|FOLLOWING|DEGRADED|LOST
  radioConfidence: number;   // 0-1, from beat observation
  // CAUSAL: Causal composition engine state
  causalAction: string;
  causalWhyNow: string;
  causalTension: number;
  causalContrastDebt: number;
  causalAnticipation: number;
  causalGrooveStability: number;
  causalExpectation: number;
  // causalActiveMaterials + causalHistory REMOVED — they caused React re-render
  // storms every 500ms (Array.from + slice allocations). Not needed for the musical goal.
  // PERF: audio-thread diagnostics (from worklet stats)
  audioProcessMs: number;       // last process() duration in ms (budget = 3.0)
  audioCpuLoad: number;         // 0..1 smoothed
  audioActiveVoices: number;    // current polyphony
  audioVoiceBudget: number;     // dynamic ceiling (drops under overload)
  // STAGE 2: user control state (for UI display — shows what the user set)
  userEnergy: number;           // 0..1 — what the user set
  userTension: number;          // 0..1 — what the user set
  userStyle: string;            // FULL_ON | DARK | PROGRESSIVE | ACID
  forcedSection: string | null; // BREAK | BUILD | DROP | null (AUTO)
  forcedBarsRemaining: number;  // how many bars left in forced section
  // STAGE 5: current sample palette
  samplePalette: string;        // 'md' | '909' | 'nord' | 'real'
}

// ─── MusicState (from architecture review) ────────────────────────────────
export interface MusicState {
  bpm: number;
  key: number;           // 0-11 (pitch class)
  scale: string;
  energy: number;        // 0-1
  energySlope: number;   // -1 to 1 (rising/falling)
  style: Style;
  density: number;       // 0-1 (how much engine should play)
  radioRoles: { kick: number; bass: number; lead: number; hats: number };
}

export type Style = 'fullOn' | 'dark' | 'progressive' | 'acid';

// ─── Engine (EXACTLY like psy — simple, direct, working) ──────────────────
export class PsyLive {
  // Audio — simple chain like psy
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private delaySend: GainNode | null = null;
  private delay: DelayNode | null = null;
  private delayFb: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  // Radio
  private radioEl: HTMLAudioElement | null = null;
  private radioSource: MediaElementAudioSourceNode | null = null;
  private radioGain: GainNode | null = null;
  private radioAnalyser: AnalyserNode | null = null;

  // State
  private playing = false;
  private radioOn = false;
  // F1.18: radioBpm and engineBpm DELETED — Transport is the single source of truth for BPM
  // The LiveState interface still has radioBpm/engineBpm fields for UI compatibility,
  // but they are populated from transport.snapshot().bpm in emit()
  private syncStatus: SyncStatus = 'idle';
  private mixMode: MixMode = 'solo';
  private kickCount = 0;
  private bassFreq = 0;
  private radioLevel = 0;
  private engineLevel = 0;
  private radioRms = 0;
  private radioBands = { low: 0, mid: 0, high: 0 };
  private presetId = PRESETS[0].id;
  private variant: 'A' | 'B' = 'A';
  private harmonicRoot = 0;
  private harmonicLocked = false;
  private compositionMode = false;
  private composition: Composition | null = null;

  // ── OCCUPANCY (from RadioObservationLayer) ──
  private occupancy = { kick: 0, bass: 0, lead: 0, hats: 0 };
  // Per-role buses — USER owns these (mixer sliders). Final = bus × duck.
  private kickBus: GainNode | null = null;
  private bassBus: GainNode | null = null;
  private leadBus: GainNode | null = null;
  private hatBus: GainNode | null = null;
  // F13/R3: Duck gain nodes — RADIO ducking owns these. Separated from user mix.
  private kickDuck: GainNode | null = null;
  private bassDuck: GainNode | null = null;
  private leadDuck: GainNode | null = null;
  private hatDuck: GainNode | null = null;
  private engineBus: GainNode | null = null;
  // Energy history for relative energy (not absolute)
  private energyHistory: number[] = [];
  // Compressor reduction monitoring
  private comp: DynamicsCompressorNode | null = null;
  // F15: Master EQ for frequency balancing
  private masterEqLow: BiquadFilterNode | null = null;
  private masterEqMid: BiquadFilterNode | null = null;
  private masterEqHigh: BiquadFilterNode | null = null;
  // F13/R1: Time-domain buffer for radio analysis (inlined, was melodyObserver)
  private radioTdBuf: Float32Array | null = null;

  // MusicState (from architecture review)
  private musicState: MusicState = {
    bpm: 145, key: 0, scale: 'minor', energy: 0.5, energySlope: 0,
    style: 'fullOn', density: 0.7,
    radioRoles: { kick: 0, bass: 0, lead: 0, hats: 0 },
  };
  private styleCandidate: Style | null = null;
  private styleCandidateSince = 0;
  private currentStyle: Style = 'fullOn';

  // Beat PLL (phase-locked loop for beat sync) — OBSERVER only
  // F1.18: MusicalTransport is the SINGLE source of truth for musical time.
  // All beat/bar/phase/bpm reads come from transport.snapshot().
  // The PLL is an observer inside RadioObservationLayer; Transport is the time model.
  private transport: MusicalTransport | null = null;

  // F13/R1: Removed dead fields — pll, melodyObserver, radioGate, transportAdapter,
  // livePattern, lastMutatedBar, detectTickCount. Single radio state machine
  // lives inside RadioObservationLayer. Single composer is MusicalSession.

  // F2.5: RadioObservationLayer — the SINGLE entry point for radio analysis
  // Contains: BeatObservationEngine → BeatPLL (beat tracking), MelodyObserver (pitch)
  private radioLayer: RadioObservationLayer | null = null;

  // F8: MusicalSession — LEGACY (kept for migration, not live authority)
  private session: MusicalSession | null = null;
  // CAUSAL: The live composition authority
  private causalComposer: CausalComposer | null = null;
  private currentCausalBar: CausalBarResult | null = null;
  private causalEventQueue: CausalNoteEvent[] = [];
  // PERF: preallocated scratch buffer for the scheduler's remaining-queue (avoids [] alloc per tick)
  private _queueScratch: CausalNoteEvent[] = [];
  // causalHistory field REMOVED — was only used by the deleted UI panel
  // MATERIAL REALIZER: fallback if worklet fails
  private realizer: MaterialRealizer | null = null;
  // AUDIOWORKLET: the REAL production engine (Moog, PolyBLEP, 64 voices, real samples)
  private engineNode: Psy4EngineNode | null = null;
  private useWorklet = false;
  // Optional sampler bridge — if set, composition events are published to registered PsyDevices.
  private samplerBridge: SamplerBridge | null = null;
  private currentNotePlan: NotePlan | null = null;

  // R6: Master safety limiter
  private safetyLimiter: DynamicsCompressorNode | null = null;
  private safetyReduction: number = 0;

  // Scheduler — wake-up mechanism only (NOT a musical clock)
  // F1.18: setInterval wakes the scheduler; musical time comes from Transport
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly lookahead = 100; // FIX: was 50ms, now 100ms. Halves scheduler runs.
  private readonly scheduleAheadTime = 0.5; // FIX: was 0.3s, now 0.5s. Larger buffer absorbs main-thread jitter.
  private lastScheduledBeatIndex = -1; // dedup based on Transport beatIndex

  // Kick detection
  private detectTimer: ReturnType<typeof setInterval> | null = null;
  private lastKickTime = 0;
  private kickIntervals: number[] = [];
  private subBassHistory: number[] = [];
  private radioFreqBuf: Uint8Array | null = null;
  // PERF: reused engine analyser buffer (was allocated per-detect-tick)
  private engineFreqBuf: Uint8Array | null = null;
  // PERF: track last buffered bass freq to skip duplicate pushes
  private lastBufferedBassFreq = 0;
  // PERF: counter to throttle session.observeRadioTick (every 5th detect tick = 500ms)
  private sessionTickCounter = 0;
  // PERF: last worklet stats (CPU load, voice budget, processMs) for diagnostics
  private lastWorkletStats: EngineStats | null = null;
  // PERF: cached learned display object (recomputed only when insights change)
  private cachedLearnedDisplay: { bpm: number; key: string; confidence: number; scale: string | null } | null = null;

  // Learning
  private learningData: LearningData | null = null;
  private deviceId = '';

  // UI timer
  private uiTimer: ReturnType<typeof setInterval> | null = null;

  // ── PERF: throttled heavy-work timers ──
  // Learning derivation (scale detection, tempo stats) — 1 Hz (was: every beat ≈ 2.4 Hz)
  private learnTimer: ReturnType<typeof setInterval> | null = null;
  // localStorage persistence — 0.2 Hz (every 5s; was: every beat)
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  // Pending kicks/notes accumulated between learn ticks (avoids per-beat array spreads)
  private pendingKickBpms: number[] = [];
  private pendingBassFreqs: number[] = [];
  private learningDirty = false;          // set when learningData mutated, cleared on persist
  private cachedInsights: ReturnType<typeof getInsights> | null = null;
  private insightsDirty = true;           // recompute only when learning changed

  onState: ((s: LiveState) => void) | null = null;
  get analyserNode() { return this.analyser; }
  get radioAnalyserNode() { return this.radioAnalyser; }
  /** Expose AudioContext for shared use with external devices (e.g. SamplerDevice). */
  get audioContext(): AudioContext | null { return this.ctx; }
  /**
   * Expose the engineBus input node for external devices to connect to.
   * When a sampler device connects its output → engineBus, it goes through
   * PSY4's master chain (comp → master → safetyLimiter → destination).
   * This enables shared master/limiter/ducking.
   */
  get engineBusInput(): AudioNode | null { return this.engineBus ?? null; }
  getPresets() { return PRESETS; }
  getStreams() { return STREAMS; }
  getPreset() { return PRESETS.find(p => p.id === this.presetId)!; }
  getVariant() { return this.getPreset().variants[this.variant]; }

  constructor() {
    this.learningData = loadLearning();
    this.getDeviceId();
    setTimeout(() => this.emit(), 0);
  }

  private getDeviceId(): string {
    if (this.deviceId) return this.deviceId;
    try {
      let id = localStorage.getItem('psy-device-id');
      if (!id) {
        id = 'dev-' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('psy-device-id', id);
      }
      this.deviceId = id;
      return id;
    } catch { return 'anon'; }
  }

  private emit(): void {
    // PERF: use cached insights (recomputed only when learning changed — see learnTick)
    if (this.insightsDirty) {
      this.cachedInsights = this.learningData ? getInsights(this.learningData) : null;
      this.insightsDirty = false;
      // Also update the cached learned display object
      const learned = this.cachedInsights;
      this.cachedLearnedDisplay = learned ? {
        bpm: learned.topBpm, key: learned.topKey,
        confidence: learned.tempo?.confidence || 0,
        scale: learned.scale?.name || null,
      } : null;
    }
    const transportBpm = this.transport ? this.transport.snapshot().bpm : 145;
    // PERF: radioLayer.getSnapshot() just returns lastSnapshot (no alloc) — safe to call.
    const radioSnap = this.radioLayer?.getSnapshot();
    // CAUSAL: Extract causal state for UI — reads from lightweight snapshot (5 fields)
    const cs = this.currentCausalBar?.stateAfter as { tensionLevel?: number; contrastDebt?: number; anticipationLevel?: number; grooveStability?: number; expectationLevel?: number } | undefined;
    const cd = this.currentCausalBar?.decision;
    // PERF: getUserControls called ONCE, result spread inline (no IIFE allocation)
    const uc = this.causalComposer?.getUserControls();
    this.onState?.({
      playing: this.playing, radioOn: this.radioOn,
      radioBpm: transportBpm, engineBpm: transportBpm,
      syncStatus: this.syncStatus, mixMode: this.mixMode,
      kickCount: this.kickCount,
      bassNote: freqToNote(this.bassFreq),
      radioLevel: this.radioLevel, engineLevel: this.engineLevel,
      presetId: this.presetId, variant: this.variant,
      learned: this.cachedLearnedDisplay,
      sidechainActive: false,
      harmonicLocked: this.harmonicLocked,
      radioRms: this.radioRms,
      radioBands: this.radioBands,
      compositionMode: this.compositionMode,
      occupancy: this.occupancy,
      radioSignalState: radioSnap?.signal.state ?? 'DISCONNECTED',
      radioObservationState: radioSnap?.signal.observationState ?? 'NO_SIGNAL',
      radioConfidence: radioSnap?.beat?.confidence ?? 0,
      // CAUSAL state — reads from lightweight snapshot (no Map access, no allocation)
      causalAction: cd?.action ?? 'NO_CHANGE',
      causalWhyNow: cd?.selected.whyNow ?? '',
      causalTension: cs?.tensionLevel ?? 0,
      causalContrastDebt: cs?.contrastDebt ?? 0,
      causalAnticipation: cs?.anticipationLevel ?? 0,
      causalGrooveStability: cs?.grooveStability ?? 0,
      causalExpectation: cs?.expectationLevel ?? 0,
      // PERF: audio-thread diagnostics
      audioProcessMs: this.lastWorkletStats?.processMs ?? 0,
      audioCpuLoad: this.lastWorkletStats?.cpuLoad ?? 0,
      audioActiveVoices: this.lastWorkletStats?.activeVoices ?? 0,
      audioVoiceBudget: this.lastWorkletStats?.voiceBudget ?? 0,
      // STAGE 2: user control state (single getUserControls call)
      userEnergy: uc?.energy ?? 0.5,
      userTension: uc?.tension ?? 0.3,
      userStyle: uc?.style ?? 'FULL_ON',
      forcedSection: uc?.forcedSection ?? null,
      forcedBarsRemaining: uc?.forcedBarsRemaining ?? 0,
      // STAGE 5: current sample palette
      samplePalette: this.currentPalette,
    });
  }

  // ── Audio init (EXACTLY like psy) ──
  private ensureAudio(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

    // F15: Master chain — EQ → comp → master → safetyLimiter → analyser → destination
    // EQ for frequency balancing (was missing — mix was unbalanced)
    this.masterEqLow = this.ctx.createBiquadFilter();
    this.masterEqLow.type = 'lowshelf';
    this.masterEqLow.frequency.value = 80;
    this.masterEqLow.gain.value = 2;  // boost sub for weight

    this.masterEqMid = this.ctx.createBiquadFilter();
    this.masterEqMid.type = 'peaking';
    this.masterEqMid.frequency.value = 350;
    this.masterEqMid.Q.value = 0.8;
    this.masterEqMid.gain.value = -1; // gentle mid cut to reduce muddiness

    this.masterEqHigh = this.ctx.createBiquadFilter();
    this.masterEqHigh.type = 'highshelf';
    this.masterEqHigh.frequency.value = 8000;
    this.masterEqHigh.gain.value = 1.5; // airy top

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.7;
    this.safetyLimiter = this.ctx.createDynamicsCompressor();
    this.safetyLimiter.threshold.value = -1.0;
    this.safetyLimiter.knee.value = 0;
    this.safetyLimiter.ratio.value = 20;
    this.safetyLimiter.attack.value = 0.003;
    this.safetyLimiter.release.value = 0.05;
    // F15: Chain — comp → EQ → master → limiter → analyser → destination
    // (comp comes before EQ so EQ doesn't trigger more compression)
    this.masterEqLow.connect(this.masterEqMid);
    this.masterEqMid.connect(this.masterEqHigh);
    this.masterEqHigh.connect(this.master);
    this.master.connect(this.safetyLimiter);
    this.safetyLimiter.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // Delay (like psy)
    this.delaySend = this.ctx.createGain();
    this.delaySend.gain.value = 1.0;
    this.delay = this.ctx.createDelay(2.0);
    this.delay.delayTime.value = 0.3;
    const wet = this.ctx.createGain(); wet.gain.value = 0.22;
    this.delayFb = this.ctx.createGain(); this.delayFb.gain.value = 0.34;
    this.delaySend.connect(this.delay);
    this.delay.connect(wet); wet.connect(this.masterEqLow!);
    this.delay.connect(this.delayFb); this.delayFb.connect(this.delay);

    // F11: Reverb bus
    this.reverbSend = this.ctx.createGain(); this.reverbSend.gain.value = 0;
    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this.mkIR(this.ctx);
    const reverbWet = this.ctx.createGain(); reverbWet.gain.value = 0.5;
    this.reverbSend.connect(this.convolver);
    this.convolver.connect(reverbWet);
    reverbWet.connect(this.masterEqLow!);

    // Noise buffer for hats
    const len = Math.floor(this.ctx.sampleRate * 0.25);
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;

    // Load learning
    this.learningData = loadLearning();

    // F1.18 — Initialize MusicalTransport (the SINGLE source of truth for musical time)
    // All beat/bar/phase/bpm reads come from transport.snapshot().
    // The PLL is an observer that feeds observations to Transport.
    this.transport = new MusicalTransport(() => this.ctx!.currentTime, {
      initialBpm: PRESETS[0].bpm,
    });
    // F13/R1: TransportAdapter removed — was instantiated but 0 methods ever called.

    // F2.5 — Initialize RadioObservationLayer
    // The SINGLE entry point for radio analysis. Produces timestamped
    // RadioBeatObservation that feeds Transport.observeBeat().
    this.radioLayer = new RadioObservationLayer({
      ...DEFAULT_RADIO_CONFIG,
      sampleRate: this.ctx.sampleRate,
      fftSize: this.radioAnalyser?.fftSize ?? 512,
    });

    // F8 — Initialize MusicalSession (LEGACY — kept for migration, not live authority)
    this.session = new MusicalSession(42);
    // CAUSAL — Initialize CausalComposer (THE live composition authority)
    this.causalComposer = new CausalComposer({
      bpm: 145, rootPc: 4, scaleName: 'phrygian-dominant', seed: 42,
    });
    // MATERIAL REALIZER — fallback if worklet fails
    this.realizer = new MaterialRealizer({
      audioContext: this.ctx,
      masterGain: this.master ?? this.ctx.destination,
    });

    // AUDIOWORKLET — the REAL production engine
    // Try to initialize the worklet. If it succeeds, use it instead of MaterialRealizer.
    this.initWorkletEngine();
    // F13/R4-D: Apply pending style if set before play()
    // STAGE 2: Apply to CausalComposer (was: MusicalSession)
    if (this.pendingStyle) {
      const s = this.pendingStyle === 'DARK' || this.pendingStyle === 'PROGRESSIVE' || this.pendingStyle === 'ACID'
        ? this.pendingStyle : 'FULL_ON';
      this.causalComposer?.setStyle(s as 'FULL_ON' | 'DARK' | 'PROGRESSIVE' | 'ACID');
      this.pendingStyle = null;
    }

    // ── PER-ROLE BUSES (from architecture review) ──
    // Each voice connects to its role bus → engineBus → gentle comp → master
    this.kickBus = this.ctx.createGain(); this.kickBus.gain.value = 0.8; // F22: boosted for punch
    this.bassBus = this.ctx.createGain(); this.bassBus.gain.value = 0.5; // F22: reduced for clean kick/bass ratio
    this.leadBus = this.ctx.createGain(); this.leadBus.gain.value = 0.5;
    this.hatBus = this.ctx.createGain(); this.hatBus.gain.value = 0.5;
    
    this.engineBus = this.ctx.createGain();
    this.engineBus.gain.value = 0.8;

    // F13/R3: Duck gain nodes — inserted between mute and engineBus.
    // Chain: role bus (USER volume) → mute (USER mute/solo) → duck (RADIO ducking) → engineBus
    // USER owns bus.gain + mute.gain. RADIO ducking owns duck.gain. No clobbering.
    this.kickMute = this.ctx.createGain(); this.kickMute.gain.value = 1.0;
    this.bassMute = this.ctx.createGain(); this.bassMute.gain.value = 1.0;
    this.leadMute = this.ctx.createGain(); this.leadMute.gain.value = 1.0;
    this.hatMute  = this.ctx.createGain(); this.hatMute.gain.value  = 1.0;
    this.kickDuck = this.ctx.createGain(); this.kickDuck.gain.value = 1.0;
    this.bassDuck = this.ctx.createGain(); this.bassDuck.gain.value = 1.0;
    this.leadDuck = this.ctx.createGain(); this.leadDuck.gain.value = 1.0;
    this.hatDuck  = this.ctx.createGain(); this.hatDuck.gain.value  = 1.0;

    // Gentle compressor on engine bus (applies to engine + radio via F10 routing)
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 2;
    this.comp.attack.value = 0.015;
    this.comp.release.value = 0.12;

    // Connect: role bus → mute → duck → engineBus → comp → master
    this.kickBus.connect(this.kickMute); this.kickMute.connect(this.kickDuck); this.kickDuck.connect(this.engineBus);
    this.bassBus.connect(this.bassMute); this.bassMute.connect(this.bassDuck); this.bassDuck.connect(this.engineBus);
    this.leadBus.connect(this.leadMute); this.leadMute.connect(this.leadDuck); this.leadDuck.connect(this.engineBus);
    this.hatBus.connect(this.hatMute);   this.hatMute.connect(this.hatDuck);   this.hatDuck.connect(this.engineBus);
    this.engineBus.connect(this.comp);
    // F15: comp → master EQ chain → master
    this.comp.connect(this.masterEqLow!);
  }

  // ── F22 AUDIO REALITY: Real kick + bass synthesis ──
  // Kick: transient + pitch-drop body + sub body + controlled tail
  // Bass: sub + mid (harmonic pluck) + character (transient) — 80ms decay

  private kick(t: number, velocity = 0.9): void {
    if (!this.ctx || !this.kickBus) return;
    const v = Math.max(0.1, Math.min(1, velocity));

    // 1. TRANSIENT — sharp click (3ms)
    if (this.noiseBuf) {
      const click = this.ctx.createBufferSource(); click.buffer = this.noiseBuf;
      const clickHp = this.ctx.createBiquadFilter(); clickHp.type = 'highpass'; clickHp.frequency.value = 5000;
      const clickGain = this.ctx.createGain();
      clickGain.gain.setValueAtTime(0.4 * v, t);
      clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.003);
      click.connect(clickHp); clickHp.connect(clickGain); clickGain.connect(this.kickBus);
      click.start(t); click.stop(t + 0.005);
    }

    // 2. PITCH-DROP BODY — 120→48Hz in 15ms, 80ms decay (matches reference)
    const body = this.ctx.createOscillator(); body.type = 'sine';
    body.frequency.setValueAtTime(120, t);
    body.frequency.exponentialRampToValueAtTime(48, t + 0.015);
    const bodyGain = this.ctx.createGain();
    bodyGain.gain.setValueAtTime(0, t);
    bodyGain.gain.linearRampToValueAtTime(0.8 * v, t + 0.0005); // 0.5ms attack
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08); // 80ms decay
    // F22 AUDIO FIX: Removed waveshaper from bus path.
    // The waveshaper was on the shared kickBus, causing intermodulation
    // distortion between kick and bass that created sustained bleed.
    // Saturation is now applied PER-VOICE (each voice has its own shaper
    // before connecting to the bus, not after).
    body.connect(bodyGain); bodyGain.connect(this.kickBus);
    body.start(t); body.stop(t + 0.09);

    // 3. SUB BODY — 48Hz weight (100ms tail)
    const sub = this.ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(48, t);
    const subGain = this.ctx.createGain();
    subGain.gain.setValueAtTime(0, t);
    subGain.gain.linearRampToValueAtTime(0.5 * v, t + 0.003);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    sub.connect(subGain); subGain.connect(this.kickBus);
    sub.start(t); sub.stop(t + 0.11);
  }

  private hat(t: number, lvl: number, open = false): void {
    if (!this.ctx || !this.hatBus || !this.noiseBuf) return;
    // F15: Metallic hat — noise through bandpass + highpass for character
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 10000; bp.Q.value = 0.7;
    const gain = this.ctx.createGain();
    const decay = open ? 0.12 : 0.04;
    gain.gain.setValueAtTime(Math.max(0.001, lvl), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(hp); hp.connect(bp); bp.connect(gain); gain.connect(this.hatBus);
    src.start(t); src.stop(t + decay + 0.01);
  }

  // F22 P0-F: Convert learned TimbreProfile to SynthRecipe for voice functions
  private timbreToRecipe(timbre: any): { oscType: OscillatorType; oscLayers: number; filterCutoff: number; filterResonance: number; saturationAmount: number; stereoWidth: number } {
    const params = timbre.synthParams || {};
    return {
      oscType: (params.bassWave || params.leadWave || 'sawtooth') as OscillatorType,
      oscLayers: timbre.harmonicity > 0.6 ? 3 : 2,
      filterCutoff: params.bassCut || params.leadCut || 600,
      filterResonance: 1 + (timbre.roughness ?? 0.3) * 6,
      saturationAmount: params.bassSaturation ?? params.leadSaturation ?? 0.3,
      stereoWidth: timbre.stereoWidth ?? 0.3,
    };
  }

  private bass(t: number, freq: number, v: Variant, velocity = 0.85): void {
    if (!this.ctx || !this.bassBus) return;
    const vel = Math.max(0.1, Math.min(1, velocity));
    // F22 P0-F: SoundDNA reaches audio graph.
    // Voice function reads SynthRecipe from learned timbre, overriding
    // the hardcoded preset variant. If no recipe, falls back to variant.
    const timbre = this.session?.getLearnedTimbreProfile();
    const recipe = timbre ? this.timbreToRecipe(timbre) : null;
    const oscType = recipe?.oscType ?? v.bassWave;
    const layers = recipe?.oscLayers ?? 2;
    const cutoff = recipe?.filterCutoff ?? v.bassCut;
    const resonance = recipe?.filterResonance ?? v.bassQ;
    const satAmount = recipe?.saturationAmount ?? 0.4;

    // F22: Layered bass — sub + mid (harmonic pluck) + character (transient)
    // KEY FIX: 65ms decay using LINEAR ramp (exponential never reaches silence)
    // Reference: sub=0.4 peak, 65ms decay; mid=0.25 peak, 65ms decay
    // 1. SUB — mono fundamental
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = freq;
    const subGain = this.ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, t);
    subGain.gain.linearRampToValueAtTime(0.4 * vel, t + 0.001); // 1ms attack
    subGain.gain.linearRampToValueAtTime(0.0, t + 0.065); // 65ms LINEAR decay to ZERO
    sub.connect(subGain); subGain.connect(this.bassBus);
    sub.start(t); sub.stop(t + 0.07);

    // 2. MID — harmonic oscillator through rapidly closing LPF (the pluck)
    const mid = this.ctx.createOscillator(); mid.type = oscType; mid.frequency.value = freq;
    const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = resonance;
    // Filter starts open, closes fast — creates the psy bass pluck character
    const fStart = Math.max(1000, cutoff);
    const fEnd = Math.max(150, cutoff * 0.25);
    filter.frequency.setValueAtTime(fStart, t);
    filter.frequency.exponentialRampToValueAtTime(fEnd, t + 0.025); // 25ms filter close
    const midGain = this.ctx.createGain();
    midGain.gain.setValueAtTime(0.0001, t);
    midGain.gain.linearRampToValueAtTime(0.25 * vel, t + 0.001); // 1ms attack
    midGain.gain.linearRampToValueAtTime(0.0, t + 0.065); // 65ms LINEAR decay to ZERO
    // F22 AUDIO FIX: Removed shared waveshaper — was causing intermodulation bleed
    mid.connect(filter); filter.connect(midGain); midGain.connect(this.bassBus);

    // 3. CHARACTER — short noise transient for attack definition
    if (this.noiseBuf) {
      const char = this.ctx.createBufferSource(); char.buffer = this.noiseBuf;
      const charBp = this.ctx.createBiquadFilter(); charBp.type = 'bandpass';
      charBp.frequency.value = freq * 4; charBp.Q.value = 2;
      const charGain = this.ctx.createGain();
      charGain.gain.setValueAtTime(0.15 * vel, t);
      charGain.gain.exponentialRampToValueAtTime(0.001, t + 0.01); // 10ms transient
      char.connect(charBp); charBp.connect(charGain); charGain.connect(this.bassBus);
      char.start(t); char.stop(t + 0.012);
    }

    if (this.delaySend) { const send = this.ctx.createGain(); send.gain.value = 0.06; midGain.connect(send); send.connect(this.delaySend); }
    mid.start(t); mid.stop(t + 0.07);
  }

  private lead(t: number, freq: number, v: Variant, accent: boolean): void {
    if (!this.ctx || !this.leadBus) return;
    // F22 P0-F: SoundDNA reaches lead audio graph
    const timbre = this.session?.getLearnedTimbreProfile();
    const recipe = timbre ? this.timbreToRecipe(timbre) : null;
    const leadWave = recipe?.oscType ?? v.leadWave;
    const leadCut = recipe?.filterCutoff ?? v.leadCut;
    const leadSat = recipe?.saturationAmount ?? 0.2;
    const stereoW = recipe?.stereoWidth ?? 0.6;

    // F15: Unison lead — 3 detuned oscillators → LPF → stereo → saturation
    const peakCut = Math.max(200, leadCut * (accent ? 1.2 : 1));
    const oscs: OscillatorNode[] = [];
    const detunes = [-7, 0, 7]; // cents — 3-voice unison
    for (const det of detunes) {
      const o = this.ctx.createOscillator();
      o.type = leadWave;
      o.frequency.value = freq;
      o.detune.value = det;
      oscs.push(o);
    }
    // F22 P0-F: Stereo width from recipe (was hardcoded ±0.6)
    const merger = this.ctx.createGain();
    const panL = this.ctx.createStereoPanner(); panL.pan.value = -stereoW;
    const panC = this.ctx.createStereoPanner(); panC.pan.value = 0;
    const panR = this.ctx.createStereoPanner(); panR.pan.value = stereoW;
    oscs[0].connect(panL); panL.connect(merger);
    oscs[1].connect(panC); panC.connect(merger);
    oscs[2].connect(panR); panR.connect(merger);

    // F15: Per-note filter envelope with movement
    const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass';
    filter.Q.value = Math.min(7, v.leadQ);
    filter.frequency.setValueAtTime(300, t);
    filter.frequency.exponentialRampToValueAtTime(peakCut, t + 0.03);
    filter.frequency.exponentialRampToValueAtTime(Math.max(400, peakCut * 0.5), t + 0.3);
    // F15: Longer sustain — notes are melodic, not just stabs
    const gain = this.ctx.createGain();
    const peak = Math.max(0.05, v.leadLvl * 0.7 * (accent ? 1 : 0.75));
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(peak * 0.4, t + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    // F15: Light saturation for character
    // F22 P0-F: Saturation from recipe (was hardcoded k=2)
    const sat = this.makeShaper(Math.round(leadSat * 10));
    merger.connect(filter); filter.connect(gain); gain.connect(sat); sat.connect(this.leadBus);
    if (this.delaySend) { const send = this.ctx.createGain(); send.gain.value = 0.15; gain.connect(send); send.connect(this.delaySend); }
    if (this.reverbSend) { const rs = this.ctx.createGain(); rs.gain.value = 0.2; gain.connect(rs); rs.connect(this.reverbSend); }
    for (const o of oscs) { o.start(t); o.stop(t + 0.42); }
  }

  // F15: Waveshaper saturation — adds harmonic content for professional character
  private makeShaper(amount: number): WaveShaperNode {
    const shaper = this.ctx!.createWaveShaper();
    const samples = 1024;
    const curve = new Float32Array(samples);
    const k = amount;
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    shaper.curve = curve;
    shaper.oversample = '2x';
    return shaper;
  }

  // ── Play / Stop ──
  // F1.18: Transport owns musical time. play() starts the Transport;
  // scheduler reads transport.snapshot() for beat/bar/phase.
  play(): void {
    this.ensureAudio();
    if (this.playing) return;
    this.playing = true;
    // Start AudioWorklet engine if available
    if (this.useWorklet && this.engineNode) {
      this.engineNode.play();
      this.engineNode.setBPM(145);
    }
    this.transport!.start();
    this.lastScheduledBeatIndex = -1;
    this.updateDelayTime();
    this.timer = setInterval(() => this.scheduler(), this.lookahead);
    this.startUITimer();
    this.emit();
  }

  stop(): void {
    this.playing = false;
    if (this.engineNode) this.engineNode.stop();
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    // PERF: only stop UI timer if radio is also off. When radio is still connected,
    // the UI must keep updating syncStatus/occupancy — startDetection() started the
    // uiTimer and will own it until disconnectRadio().
    if (!this.radioOn) this.stopUITimer();
    this.emit();
  }

  setPreset(id: string): void {
    this.presetId = id;
    // F13/R1: livePattern/lastMutatedBar removed (dead pattern mutator fields)
    const p = this.getPreset();
    // F1.18: setTempo via Transport — single source of truth for BPM
    this.transport!.setTempo(p.bpm, 'internal');
    this.updateDelayTime();
    this.emit();
  }

  setVariant(v: 'A' | 'B'): void {
    this.variant = v;
    this.emit();
  }

  setVolume(v: number): void {
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // NEW: Bus volume control for MaterialRealizer's 5 buses
  setBusVolume(bus: 'drum' | 'bass' | 'lead' | 'texture' | 'transition', v: number): void {
    if (this.realizer) this.realizer.setBusVolume(bus, v);
  }

  // F11: Per-channel volume controls (legacy — routes to realizer buses)
  setChannelVolume(channel: 'kick' | 'bass' | 'lead' | 'hat', v: number): void {
    // Route to MaterialRealizer buses
    if (channel === 'kick') this.setBusVolume('drum', v);
    else if (channel === 'bass') this.setBusVolume('bass', v);
    else if (channel === 'lead') this.setBusVolume('lead', v);
    else if (channel === 'hat') this.setBusVolume('drum', v * 0.5);
    // Also set legacy bus for fallback path
    const bus = channel === 'kick' ? this.kickBus : channel === 'bass' ? this.bassBus : channel === 'lead' ? this.leadBus : this.hatBus;
    if (bus && this.ctx) bus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  // F11: FX controls
  setDelayAmount(v: number): void {
    if (this.delaySend && this.ctx) this.delaySend.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setDelayFeedback(v: number): void {
    // F13/R8: Clamp feedback to 0.85 max — prevents infinite howl at 100%.
    const clamped = Math.max(0, Math.min(0.85, v));
    if (this.delayFb && this.ctx) this.delayFb.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.05);
  }

  setReverbSend(v: number): void {
    if (this.reverbSend && this.ctx) this.reverbSend.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // F13/R4-D: Pending style — stored when setStyle is called before play()
  // STAGE 2: Applied to CausalComposer (was: MusicalSession)
  private pendingStyle: string | null = null;

  // STAGE 2: Style control — now routes to CausalComposer (the live authority)
  // WAS: this.session.setStyle() — session is dead code, doesn't drive playback
  setStyle(style: string): void {
    this.currentStyle = style as any;
    // STAGE 2: Route to CausalComposer — changes musical grammar (scale, motif, bass pattern)
    const s = (style === 'DARK' || style === 'PROGRESSIVE' || style === 'ACID') ? style : 'FULL_ON';
    this.causalComposer?.setStyle(s as 'FULL_ON' | 'DARK' | 'PROGRESSIVE' | 'ACID');
    if (!this.causalComposer) this.pendingStyle = style; // apply on play()
    // Also update AudioWorklet macros (synth timbre)
    if (this.engineNode) {
      const styleMap: Record<string, any> = {
        FULL_ON: { energy: 0.8, aggression: 0.7, brightness: 0.7, psychedelia: 0.5 },
        DARK: { energy: 0.6, aggression: 0.5, brightness: 0.3, psychedelia: 0.7, darkness: 0.7 },
        PROGRESSIVE: { energy: 0.5, aggression: 0.3, brightness: 0.5, psychedelia: 0.3, density: 0.5 },
        ACID: { energy: 0.7, aggression: 0.6, brightness: 0.8, psychedelia: 0.8 },
      };
      const m = styleMap[style] || {};
      this.engineNode.setMacros(m);
    }
  }

  // STAGE 2: Energy — now routes to CausalComposer (was: dead session.setEnergy)
  setEnergy(v: number): void {
    // STAGE 2: CausalComposer uses energy for velocity scaling + threshold bias
    this.causalComposer?.setEnergy(v);
    // Also update AudioWorklet macros (synth density/brightness)
    if (this.engineNode) this.engineNode.setMacros({ energy: v, density: v * 0.8 + 0.2 });
  }

  setDensity(v: number): void {
    // NOTE: density is now derived from energy inside CausalComposer (energy * 0.8 + 0.2).
    // This setter is kept for API compat but only updates the worklet macro.
    if (this.engineNode) this.engineNode.setMacros({ density: v });
  }

  // STAGE 2: Tension — now routes to CausalComposer (was: dead session.setTension)
  setTension(v: number): void {
    // STAGE 2: CausalComposer uses tension for contrast debt rate + variation intensity
    this.causalComposer?.setTension(v);
    // Also update AudioWorklet macros (synth psychedelia/aggression)
    if (this.engineNode) this.engineNode.setMacros({ psychedelia: v, aggression: v * 0.7 });
  }

  // F13/R2B: Unlock methods — return to AUTO mode
  // STAGE 2: These now release CausalComposer forced sections (was: dead session.unlock*)
  unlockStyle(): void { /* style is always live in CausalComposer, no lock */ }
  unlockEnergy(): void { /* energy is always live, no lock */ }
  unlockDensity(): void { /* density derived from energy */ }
  unlockTension(): void { /* tension is always live, no lock */ }
  unlockKey(): void { /* key handled by learning system */ }

  // F15 Phase 4: Arrangement controls — STAGE 2: now route to CausalComposer
  // WAS: this.session.forceSection() — session is dead code, countdown-based.
  // NOW: CausalComposer.forceSection() — causal override, integrates with inference.
  forceSection(section: string): void {
    const s = section === 'BREAK' || section === 'BUILD' || section === 'DROP' ? section : 'BREAK';
    this.causalComposer?.forceSection(s as 'BREAK' | 'BUILD' | 'DROP', 4);
  }
  releaseSection(): void { this.causalComposer?.releaseSection(); }
  triggerBreak(bars = 4): void { this.causalComposer?.forceSection('BREAK', bars); }
  triggerBuild(bars = 4): void { this.causalComposer?.forceSection('BUILD', bars); }
  triggerDrop(bars = 4): void { this.causalComposer?.forceSection('DROP', bars); }
  getArrangementState() {
    const uc = this.causalComposer?.getUserControls();
    return uc ? {
      section: uc.forcedSection ?? 'AUTO',
      barsRemaining: uc.forcedBarsRemaining,
    } : null;
  }

  // F18.5: Apply learned timbre to synthesis parameters.
  // Called from detect() when timbre profile is available.
  // Maps learned spectral characteristics → synth params (wave, cutoff, saturation).
  private applyLearnedTimbre(): void {
    const timbre = this.session?.getLearnedTimbreProfile();
    if (!timbre || !this.ctx) return;
    const params = timbre.synthParams;
    // Apply to active preset variant — modify the variant in-place
    const v = this.getVariant();
    // Only override if user hasn't manually set (we check by comparing to defaults)
    // F18: We override the variant's synth params with learned values
    (v as any).bassWave = params.bassWave;
    (v as any).bassCut = params.bassCut;
    (v as any).leadWave = params.leadWave;
    (v as any).leadCut = params.leadCut;
  }

  // F18: Check if learning is active (for UI display)
  hasLearnedFromRadio(): boolean { return this.session?.hasLearnedFromRadio() ?? false; }
  getLearnedPhraseCount(): number { return this.session?.getLearnedPhraseCount() ?? 0; }

  private updateDelayTime(): void {
    if (this.delay) this.delay.delayTime.value = this.stepDur() * 3;
  }

  // ── AudioWorklet Engine Initialization ──
  private async initWorkletEngine(): Promise<void> {
    if (!this.ctx) return;
    try {
      this.engineNode = new Psy4EngineNode(this.ctx);
      const ok = await this.engineNode.init();
      if (ok) {
        this.useWorklet = true;
        // PERF: wire stats callback to monitor audio-thread CPU load.
        // The worklet reports processMs, cpuLoad, activeVoices, voiceBudget every ~10Hz.
        // We log warnings when over budget so audio dropouts are diagnosable.
        this.engineNode.onStats((stats) => {
          this.lastWorkletStats = stats;
          // Warn if process() exceeds the 3ms budget (will cause audio dropouts)
          if (stats.processMs > 3.0) {
            console.warn(`[PSY4] AUDIO THREAD OVER BUDGET: processMs=${stats.processMs.toFixed(2)}ms cpuLoad=${(stats.cpuLoad*100).toFixed(0)}% voices=${stats.activeVoices}/${stats.voiceBudget}`);
          }
        });
        // Connect worklet output through analyser (for visualizer)
        const out = this.engineNode.outputNode;
        if (out && this.analyser) {
          out.disconnect();
          out.connect(this.analyser);
          // analyser already connected to destination
        }
        // Set default world params
        this.engineNode.setWorld({
          kickFundamental: 50, kickDecay: 0.15,
          bassCutoff: 400, bassResonance: 4,
          leadCutoff: 1800, leadDetune: 8,
          padCutoff: 800, padAttack: 0.3, padDetune: 6, padEvolveRate: 0.5,
          duck: 0.6,
        });
        this.engineNode.setMacros({
          energy: 0.5, psychedelia: 0.4, darkness: 0.3, density: 0.7,
          groove: 0.8, evolution: 0.3, space: 0.3, surprise: 0.2,
          aggression: 0.5, brightness: 0.6,
        });
        // Load real drum samples into worklet
        this.loadWorkletSamples();
        console.log('[PSY4] AudioWorklet engine active — Moog ladder + PolyBLEP + real samples');
      } else {
        console.warn('[PSY4] Worklet init failed — using MaterialRealizer fallback');
        this.realizer?.loadSamples().catch(() => {});
      }
    } catch (e) {
      console.warn('[PSY4] Worklet error:', e, '— using MaterialRealizer fallback');
      this.realizer?.loadSamples().catch(() => {});
    }
  }

  private async loadWorkletSamples(): Promise<void> {
    // STAGE 5: Load default palette ('md' = MachineDrum). User can switch via setSamplePalette().
    await this.loadPalette('md');
  }

  // STAGE 5: Current sample palette — 'md' (MachineDrum) | '909' (Roland) | 'nord' (Nord) | 'real' (mixed)
  private currentPalette: 'md' | '909' | 'nord' | 'real' = 'md';

  /**
   * STAGE 5: Switch the drum sample palette at runtime.
   * Each palette uses samples from a different drum machine:
   *   'md'   — MachineDrum (default, 126 samples, punchy electronic)
   *   '909'  — Roland TR-909 (5 samples, classic analog)
   *   'nord' — Nord Drum (10 samples, synthetic percussion)
   *   'real' — Mixed real samples (kick.wav, hat_closed.wav, etc.)
   * Loads new samples into the worklet without restarting playback.
   */
  async setSamplePalette(palette: 'md' | '909' | 'nord' | 'real'): Promise<void> {
    if (palette === this.currentPalette) return;
    this.currentPalette = palette;
    await this.loadPalette(palette);
    console.log(`[PSY4] Sample palette switched to: ${palette}`);
  }

  getSamplePalette(): string { return this.currentPalette; }

  // STAGE 5: Load a specific palette's samples into the worklet.
  // Selects kick/hat/clap/snare samples matching the palette prefix.
  private async loadPalette(palette: 'md' | '909' | 'nord' | 'real'): Promise<void> {
    if (!this.engineNode || !this.ctx) return;

    // Define which sample files to load per palette.
    // Each palette picks 2 kicks + 2 hats + 2 claps + 1 snare for variety.
    const paletteFiles: Record<string, Record<string, { category: string; sub: string }>> = {
      md: {
        'md_kick_Kicks_0051.wav': { category: 'kick', sub: 'main' },
        'md_kick_Kicks_0007.wav': { category: 'kick', sub: 'alt' },
        'md_snare_Snares_0000.wav': { category: 'snare', sub: 'main' },
        'md_clap_Claps_0006.wav': { category: 'clap', sub: 'main' },
        'md_clap_Claps_0000.wav': { category: 'clap', sub: 'alt' },
        'md_hat_Hats_0008.wav': { category: 'hat', sub: 'closed' },
        'md_hat_Hats_0012.wav': { category: 'hat', sub: 'closed' },
        'md_hat_Hats_0015.wav': { category: 'hat', sub: 'open' },
        'md_perc_Percs_0001.wav': { category: 'perc', sub: 'main' },
        'md_perc_Percs_0000.wav': { category: 'perc', sub: 'alt' },
        'md_tom_Toms_0000.wav': { category: 'perc', sub: 'tom' },
        'md_ride_Cymbals_0000.wav': { category: 'perc', sub: 'ride' },
      },
      '909': {
        '909_BD_02.wav': { category: 'kick', sub: 'main' },
        '909_BD_04.wav': { category: 'kick', sub: 'alt' },
        '909_BD_05.wav': { category: 'kick', sub: 'deep' },
        '909_BD_06.wav': { category: 'kick', sub: 'punch' },
        '909_BD_07.wav': { category: 'kick', sub: 'sub' },
        // 909 has no hat/clap files in the bank — fall back to md for those
        'md_hat_Hats_0008.wav': { category: 'hat', sub: 'closed' },
        'md_hat_Hats_0015.wav': { category: 'hat', sub: 'open' },
        'md_clap_Claps_0006.wav': { category: 'clap', sub: 'main' },
        'md_snare_Snares_0000.wav': { category: 'snare', sub: 'main' },
      },
      nord: {
        'nord_kick_punchy_67.wav': { category: 'kick', sub: 'main' },
        'nord_kick_deep_68.wav': { category: 'kick', sub: 'deep' },
        'nord_kick_sub_93.wav': { category: 'kick', sub: 'sub' },
        'nord_kick_warm_45.wav': { category: 'kick', sub: 'warm' },
        'nord_snare_Snare1.wav': { category: 'snare', sub: 'main' },
        'nord_perc_Perc1.wav': { category: 'perc', sub: 'main' },
        'nord_perc_Perc2.wav': { category: 'perc', sub: 'alt' },
        // Nord has no hats/claps — fall back to md
        'md_hat_Hats_0008.wav': { category: 'hat', sub: 'closed' },
        'md_hat_Hats_0015.wav': { category: 'hat', sub: 'open' },
        'md_clap_Claps_0006.wav': { category: 'clap', sub: 'main' },
      },
      real: {
        'kick.wav': { category: 'kick', sub: 'main' },
        'hat_closed.wav': { category: 'hat', sub: 'closed' },
        'hat_open.wav': { category: 'hat', sub: 'open' },
        'clap.wav': { category: 'clap', sub: 'main' },
        'bass_A.wav': { category: 'bass', sub: 'main' },
        'lead.wav': { category: 'lead', sub: 'main' },
      },
    };

    const sampleFiles = paletteFiles[palette] || paletteFiles.md;
    const samples: { name: string; category: string; subcategory: string; sampleRate: number; data: Float32Array }[] = [];
    for (const [file, info] of Object.entries(sampleFiles)) {
      try {
        const path = file.includes('/') || file.includes('.') && !file.includes('_')
          ? `/samples/${file}`  // real/ root samples (kick.wav, etc.)
          : `/samples/real/${file}`;
        const res = await fetch(path);
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        const decoded = await this.ctx.decodeAudioData(buf);
        const data = decoded.getChannelData(0);
        const copy = new Float32Array(data.length);
        copy.set(data);
        samples.push({ name: file, category: info.category, subcategory: info.sub, sampleRate: decoded.sampleRate, data: copy });
      } catch (e) { /* skip */ }
    }
    if (samples.length > 0) {
      this.engineNode.loadSamples(samples);
      console.log(`[PSY4] Loaded ${samples.length} samples for palette '${palette}' into worklet`);
    }
  }

  // F1.18: stepDur reads from Transport — no independent engineBpm
  private stepDur(): number { return 60 / this.transport!.snapshot().bpm / 4; }

  private updateMixMode(): void {
    if (this.compositionMode) { this.mixMode = 'solo'; return; }
    if (!this.radioOn || !this.playing) this.mixMode = 'solo';
    else if (this.syncStatus === 'following') this.mixMode = 'reinforce';
    else this.mixMode = 'glue';
  }

  // ── Scheduler — reads Transport for ALL musical time ──
  // F1.18: setInterval wakes the scheduler (25ms). The scheduler reads
  // transport.snapshot() to get the beat grid, then schedules 16th notes
  // directly. NO independent nextNoteTime, step, or barCount.
  //
  // PLAYBACK REALITY FIX: The previous version called predictBeats(0.15)
  // which only returned BEAT boundaries within 150ms. At 145 BPM, beats
  // are 414ms apart — so predictBeats returned an EMPTY ARRAY most ticks,
  // causing silence. The fix: compute 16th-note times directly from the
  // Transport's beat grid (beatTime + k * stepDur), not from beat boundaries.
  //
  // Policy for tab suspension: DROP STALE EVENTS.
  private scheduler(): void {
    if (!this.ctx || !this.transport || !this.causalComposer) return;
    try {
      const now = this.ctx.currentTime;
      const snap = this.transport.snapshot();
      // Push transport to sampler bridge (if attached).
      if (this.samplerBridge) {
        this.samplerBridge.publishTransport(snap as unknown as BridgeTransport);
      }

      // CAUSAL: On new bar, compose via CausalComposer (NOT session.planBar)
      const currentBar = snap.bar;
      if (!this.currentCausalBar || this.currentCausalBar.bar !== currentBar) {
        // FIX: measure composeBar time to diagnose stutter. If > 10ms, log it.
        const __composeStart = performance.now();
        this.currentCausalBar = this.causalComposer.composeBar(currentBar);
        const __composeMs = performance.now() - __composeStart;
        if (__composeMs > 10) console.warn(`[PSY4] composeBar took ${__composeMs.toFixed(1)}ms (bar ${currentBar})`);
        // Queue all events for scheduling
        const barOriginAudioTime = snap.beatTime - snap.beat * (60 / snap.bpm);
        const evs = this.currentCausalBar.events;
        for (let i = 0; i < evs.length; i++) {
          evs[i].at += barOriginAudioTime;
          this.causalEventQueue.push(evs[i]);
        }
      }

      // Process event queue: schedule events that are due within the lookahead window
      // PERF: reuse a preallocated remaining buffer instead of allocating [] every tick (20Hz)
      const scheduleWindow = now + this.scheduleAheadTime;
      const remaining = this._queueScratch;
      remaining.length = 0;
      for (const ev of this.causalEventQueue) {
        if (ev.at <= scheduleWindow) {
          if (ev.at >= now - 0.05) {
            this.scheduleCausalEvent(ev);
          }
          // else: event is too late, drop it (don't add to remaining)
        } else {
          remaining.push(ev);
        }
      }
      // Swap: the remaining array becomes the new queue, old queue becomes scratch
      this._queueScratch = this.causalEventQueue;
      this.causalEventQueue = remaining;
      // Safety: if queue grows too large, trim old events
      if (this.causalEventQueue.length > 200) {
        this.causalEventQueue.length = 100;
      }
      // Flush batched events to AudioWorklet
      if (this.useWorklet && this.engineNode) {
        this.engineNode.flushEvents();
      }
    } catch (e) {}
  }

  // CAUSAL: Schedule a single causal event for playback via MaterialRealizer
  private scheduleCausalEvent(ev: CausalNoteEvent): void {
    if (!this.ctx) return;

    // Track kick count for UI
    if (ev.channel === 'kick') this.kickCount++;
    if (ev.channel === 'bass' && ev.note > 0) this.bassFreq = mtof(ev.note);

    // Route to AudioWorklet if available (REAL DSP: Moog, PolyBLEP, samples)
    if (this.useWorklet && this.engineNode) {
      const voiceId = CHANNEL_TO_VOICE[ev.channel];
      if (voiceId !== undefined) {
        // For sub: play bass one octave lower
        const note = ev.channel === 'sub' ? ev.note - 12 : ev.note;
        // For counterline: play lead at lower register
        const finalNote = ev.channel === 'counterline' ? ev.note - 7 : note;
        this.engineNode.scheduleEvent(ev.at, voiceId, finalNote, ev.velocity, ev.duration, 0);
      }
    } else if (this.realizer) {
      // Fallback: MaterialRealizer (basic Web Audio)
      this.realizer.realize(ev);
    }

    // Publish to sampler bridge (if attached)
    if (this.samplerBridge) {
      const note = { voice: ev.channel, step: 0, midi: ev.note, velocity: ev.velocity };
      this.samplerBridge.publishNote(ev.at, note, false, 0.1);
    }
  }

  // ── Sampler bridge (optional) ──
  // Attach a SamplerBridge to route PSY4's composition to external PsyDevices.
  // The bridge plays IN PARALLEL with PSY4's synth — it does NOT replace it.
  attachSamplerBridge(bridge: SamplerBridge): void {
    this.samplerBridge = bridge;
  }

  // Register a PsyDevice on the sampler bridge (convenience method).
  attachSamplerDevice<T extends PsyDevice>(device: T): T | null {
    if (!this.samplerBridge) return null;
    this.samplerBridge.register(device);
    return device;
  }

  // ── Composition mode ──
  // F1.18: tempo changes go through Transport.setTempo()
  toggleComposition(): boolean {
    if (!this.learningData) return false;
    if (!this.compositionMode) {
      this.composition = generateComposition(this.learningData);
      if (!this.composition) return false;
      this.compositionMode = true;
      this.transport!.setTempo(this.composition.bpm, 'internal');
      this.updateDelayTime();
    } else {
      this.compositionMode = false;
      this.composition = null;
      this.transport!.setTempo(this.getPreset().bpm, 'internal');
      this.updateDelayTime();
    }
    this.updateMixMode();
    this.emit();
    return this.compositionMode;
  }

  hasSavedComposition(): boolean {
    try { return !!localStorage.getItem('psy-best-composition'); } catch { return false; }
  }

  // ── Radio ──
  async connectRadio(stream: Stream): Promise<boolean> {
    this.ensureAudio();
    if (!this.ctx) return false;
    try {
      if (this.radioSource) { try { this.radioSource.disconnect(); } catch {} }
      if (this.radioEl) { this.radioEl.pause(); this.radioEl.src = ''; }
      this.radioEl = new Audio();
      this.radioEl.crossOrigin = 'anonymous';
      this.radioEl.src = stream.url;
      this.radioSource = this.ctx.createMediaElementSource(this.radioEl);
      if (!this.radioGain) {
        this.radioGain = this.ctx.createGain();
        this.radioGain.gain.value = 0.5;
        this.radioAnalyser = this.ctx.createAnalyser();
        this.radioAnalyser.fftSize = 512;
        this.radioAnalyser.smoothingTimeConstant = 0.2;
      }
      // Radio → radioGain → radioAnalyser → engineBus (F10: comp applies)
      this.radioSource.connect(this.radioGain!);
      this.radioGain!.connect(this.radioAnalyser!);
      this.radioAnalyser!.connect(this.engineBus!);

      // F13/R1 — THE CRITICAL FIX: wire RadioObservationLayer state machine.
      // Before this fix, signalState was stuck at 'DISCONNECTED' (constructor
      // default) because markConnected() was never called. This killed the
      // entire beat-detection / pitch-observation / PLL pipeline.
      // Now: CONNECTING → (play succeeds) → markConnected → NO_SIGNAL →
      //   (signal arrives) → SIGNAL_PRESENT → STABLE_SIGNAL → FOLLOWING.
      this.radioLayer!.markConnecting();
      this.syncStatus = 'connecting';

      try { await this.radioEl.play(); } catch {}
      this.radioOn = true;
      // Transition to NO_SIGNAL so updateSignalState() can promote it to
      // SIGNAL_PRESENT when real audio arrives.
      this.radioLayer!.markConnected();
      this.updateMixMode();
      this.startDetection();
      this.emit();
      return true;
    } catch (e) { console.error(e); return false; }
  }

  disconnectRadio(): void {
    if (this.radioEl) { this.radioEl.pause(); this.radioEl.src = ''; }
    if (this.radioSource) { try { this.radioSource.disconnect(); } catch {} }
    this.radioOn = false;
    // F1.18: Transport enters holdover (no hard reset of BPM)
    this.transport!.loseSource();
    // F2.5: Reset radio observation layer (the SINGLE radio state machine)
    this.radioLayer?.reset();
    this.syncStatus = 'holdover';
    this.harmonicLocked = false;
    this.harmonicRoot = 0;
    this.kickIntervals = [];
    this.subBassHistory = [];
    // PERF: stop detection AND throttled learn/persist timers (was: only detectTimer)
    this.stopDetection();
    // F13/R1: Reset session on disconnect so learned motifs/style/phrase state
    // don't leak across reconnects.
    this.session?.reset();
    this.updateMixMode();
    this.emit();
  }

  setRadioVolume(v: number): void {
    // F13/R8: Smoothed to prevent clicks on rapid drag (was .value = immediate)
    if (this.radioGain && this.ctx) this.radioGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  // F13/R3: Mute/Solo — user mixer controls. Mute writes to a separate muteGain
  // node (not bus.gain), so it composes with ducking. Solo mutes all other buses.
  private channelMuted = { kick: false, bass: false, lead: false, hat: false };
  private channelSolo: 'kick' | 'bass' | 'lead' | 'hat' | null = null;
  // muteGain nodes (between bus and duck — bus × mute × duck → engineBus)
  private kickMute: GainNode | null = null;
  private bassMute: GainNode | null = null;
  private leadMute: GainNode | null = null;
  private hatMute: GainNode | null = null;

  setChannelMute(channel: 'kick' | 'bass' | 'lead' | 'hat', muted: boolean): void {
    this.channelMuted[channel] = muted;
    this.applyMuteSolo();
  }

  setChannelSolo(channel: 'kick' | 'bass' | 'lead' | 'hat' | null): void {
    this.channelSolo = channel;
    this.applyMuteSolo();
  }

  private applyMuteSolo(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const buses: Array<{name: 'kick'|'bass'|'lead'|'hat', mute: GainNode|null}> = [
      { name: 'kick', mute: this.kickMute },
      { name: 'bass', mute: this.bassMute },
      { name: 'lead', mute: this.leadMute },
      { name: 'hat',  mute: this.hatMute },
    ];
    for (const b of buses) {
      if (!b.mute) continue;
      // Solo logic: if any channel is soloed, mute all others
      const isMuted = this.channelSolo ? (b.name !== this.channelSolo) : this.channelMuted[b.name];
      b.mute.gain.setTargetAtTime(isMuted ? 0 : 1, now, 0.02);
    }
  }

  // ── Detection (100ms tick — was 200ms, too slow for beat tracking) ──
  // PERF: detect() is now LIGHT — FFT + radio layer process + state machine + occupancy.
  // Heavy work (deriveInsights, saveLearning, emit) moved to dedicated throttled timers.
  private startDetection(): void {
    if (this.detectTimer) clearInterval(this.detectTimer);
    this.detectTimer = setInterval(() => this.detect(), 100);
    // PERF: learning derivation at 1 Hz (scale detection over 12 roots × 9 scales = ~1300 iters)
    if (!this.learnTimer) this.learnTimer = setInterval(() => this.learnTick(), 1000);
    // PERF: localStorage persistence at 0.2 Hz (JSON.stringify + setItem is sync & blocking)
    if (!this.persistTimer) this.persistTimer = setInterval(() => this.persistTick(), 5000);
    // PERF: ensure UI updates even when engine isn't playing (radio-only mode).
    // Previously detect() called emit() every 100 ms — that was the stutter source.
    // Now the 250 ms uiTimer is the only emit path, started here for radio-only mode.
    if (!this.uiTimer) this.startUITimer();
  }

  private stopDetection(): void {
    if (this.detectTimer) { clearInterval(this.detectTimer); this.detectTimer = null; }
    if (this.learnTimer) { clearInterval(this.learnTimer); this.learnTimer = null; }
    if (this.persistTimer) { clearInterval(this.persistTimer); this.persistTimer = null; }
    // Final flush of any pending learning data
    if (this.learningDirty) this.persistTick();
    // PERF: only stop the UI timer if the engine isn't playing. When engine is playing,
    // play() owns the uiTimer and will stop it on stop().
    if (!this.playing) this.stopUITimer();
  }

  private detect(): void {
    if (!this.radioAnalyser || !this.ctx || !this.radioLayer) return;
    if (!this.radioFreqBuf || this.radioFreqBuf.length !== this.radioAnalyser.frequencyBinCount) {
      this.radioFreqBuf = new Uint8Array(this.radioAnalyser.frequencyBinCount);
    }
    const fd = this.radioFreqBuf;
    // F13: cast to avoid TS lib mismatch on ArrayBufferLike vs ArrayBuffer
    this.radioAnalyser.getByteFrequencyData(fd as Uint8Array<ArrayBuffer>);

    // F13/R1: Inline time-domain buffer (was melodyObserver.ensureTimeDomainBuf)
    if (!this.radioTdBuf || this.radioTdBuf.length !== this.radioAnalyser.fftSize) {
      this.radioTdBuf = new Float32Array(this.radioAnalyser.fftSize);
    }
    const tdBuf = this.radioTdBuf;
    // F13: cast to avoid TS lib mismatch on ArrayBufferLike vs ArrayBuffer
    this.radioAnalyser.getFloatTimeDomainData(tdBuf as Float32Array<ArrayBuffer>);

    // F2.5 — Process through RadioObservationLayer (the SINGLE entry point)
    // This replaces: RadioStateGate, inline beat detection, inline pitch observation
    const audioTime = this.ctx.currentTime;
    const radioSnap = this.radioLayer.process(tdBuf, fd, audioTime);
    // F5: Get Transport snapshot early (needed for LiveComposer feed)
    const transportSnap = this.transport!.snapshot();

    // F2.5 — Feed beat observations to Transport (the ONLY crossing point)
    // RadioObservationLayer produces timestamped RadioBeatObservation.
    // Only { time, confidence, source } crosses into Transport.
    if (radioSnap.beat) {
      this.transport!.observeBeat({
        time: radioSnap.beat.timestamp.observedAt,
        confidence: radioSnap.beat.confidence,
        source: 'radio',
      });
      this.kickCount++;
      // F13/R5: Wire bassFreq from pitch observation for key detection.
      // radioSnap.pitch is produced by RadioObservationLayer's internal
      // MelodyObserver (now that signalState actually transitions).
      if (radioSnap.pitch && radioSnap.pitch.confidence > 0.5) {
        this.bassFreq = radioSnap.pitch.frequency;
      }
    }

    // F13/R1 — Update syncStatus from RadioObservationLayer (single source)
    if (this.radioOn) {
      const sigState = radioSnap.signal.state;
      const obsState = radioSnap.signal.observationState;
      if (sigState === 'DISCONNECTED' || sigState === 'CONNECTING') {
        this.syncStatus = 'connecting';
      } else if (sigState === 'ERROR') {
        this.syncStatus = 'error';
      } else if (obsState === 'FOLLOWING') {
        this.syncStatus = 'following';
      } else if (obsState === 'LOCKING' || obsState === 'SIGNAL_PRESENT') {
        this.syncStatus = 'listening';
      } else if (obsState === 'DEGRADED') {
        this.syncStatus = 'listening';
      } else if (obsState === 'LOST' || obsState === 'NO_SIGNAL') {
        this.syncStatus = sigState === 'LOST' ? 'holdover' : 'no_signal';
      }
    }

    // F2.5 — Update occupancy from radio layer (for arranger decisions)
    this.occupancy = radioSnap.occupancy;

    // F8 — Feed radio observations into MusicalSession (LEGACY — not used by CausalComposer)
    // This is kept for learning data collection only. CausalComposer doesn't read from session.
    // Skip if no radio signal to save CPU.
    // PERF: throttle session.observeRadioTick to 2 Hz (every 5th detect tick).
    // extractSpectralFeatures inside is heavy (full FFT loop + centroid/flatness/rolloff).
    // 100ms × 5 = 500ms cadence is plenty for grammar learning.
    this.sessionTickCounter++;
    const runSessionTick = this.sessionTickCounter >= 5;
    if (runSessionTick) this.sessionTickCounter = 0;
    if (runSessionTick && this.session && radioSnap.signal.state !== 'NO_SIGNAL' && this.radioOn) {
      const radioBpm = radioSnap.beat?.estimatedBpm ?? transportSnap.bpm;
      const pitchClass = radioSnap.pitch?.pitchClass ?? null;
      const pitchConfidence = radioSnap.pitch?.confidence ?? 0;

      this.session.observeRadioTick({
        audioTime,
        radioBpm,
        energy: radioSnap.signal.spectralEnergy,
        occupancy: radioSnap.occupancy,
        bassFreq: this.bassFreq > 0 ? this.bassFreq : null,
        pitchClass,
        pitchConfidence,
        freqData: fd,
        sampleRate: this.ctx.sampleRate,
        fftSize: this.radioAnalyser.fftSize,
      });
    }

    // F18.5: Apply learned timbre to synthesis parameters
    // Only when worklet is NOT active (worklet uses its own params via macros)
    if (!this.useWorklet) {
      this.applyLearnedTimbre();
    }

    // Update radio level for UI
    this.radioLevel = radioSnap.signal.spectralEnergy;
    this.radioRms = this.radioRms * 0.85 + radioSnap.signal.rms * 0.15;
    this.radioBands = {
      low: radioSnap.occupancy.kick,
      mid: radioSnap.occupancy.lead,
      high: radioSnap.occupancy.hats,
    };

    // ── F13/R3: MIXER OWNERSHIP FIX ──
    // Role ducking NO LONGER clobbers bus.gain. Instead, we write to
    // separate duckGain nodes (set in ensureAudio). User mixer sliders
    // write to bus.gain directly. Final level = bus.gain × duckGain.
    // Radio detection changes ducking only — user mix stays stable.
    if (this.kickDuck && this.bassDuck && this.leadDuck && this.hatDuck && this.ctx) {
      const now = this.ctx.currentTime;
      const kickDuck = this.occupancy.kick > 0.7 ? 0.1 : 1.0;
      this.kickDuck.gain.setTargetAtTime(kickDuck, now, 0.05);
      const bassDuck = this.occupancy.bass > 0.75 ? 0.4 : 1.0;
      this.bassDuck.gain.setTargetAtTime(bassDuck, now, 0.08);
      const leadDuck = this.occupancy.lead > 0.85 ? 0.5 : 1.0;
      this.leadDuck.gain.setTargetAtTime(leadDuck, now, 0.1);
      const hatDuck = 1.0; // F13: no longer force hatBus to 0.6 — user owns it
      this.hatDuck.gain.setTargetAtTime(hatDuck, now, 0.1);
    }

    // ── ENERGY HISTORY (for relative energy, not absolute) ──
    this.energyHistory.push(radioSnap.signal.spectralEnergy);
    if (this.energyHistory.length > 32) this.energyHistory.shift();

    // ── MUSIC STATE UPDATE ──
    if (this.energyHistory.length >= 8) {
      const recent = this.energyHistory.slice(-4).reduce((a, b) => a + b, 0) / 4;
      const older = this.energyHistory.slice(-8, -4).reduce((a, b) => a + b, 0) / 4;
      this.musicState.energy = recent;
      this.musicState.energySlope = recent - older;
    }

    this.musicState.radioRoles = { ...this.occupancy };
    this.musicState.bpm = this.transport ? this.transport.snapshot().bpm : 145;

    // ── STYLE DETECTION (with hysteresis, using AudioContext time) ──
    const detectedStyle = this.classifyStyle();
    if (detectedStyle) {
      const audioNow = this.ctx.currentTime;
      if (detectedStyle !== this.styleCandidate) {
        this.styleCandidate = detectedStyle;
        this.styleCandidateSince = audioNow;
      }
      if (this.styleCandidate && audioNow - this.styleCandidateSince > 8) {
        if (this.styleCandidate !== this.currentStyle) {
          this.currentStyle = this.styleCandidate;
        }
      }
    }
    this.musicState.style = this.currentStyle;

    // ── COMPETITIVE DENSITY CONTROL ──
    const delta = this.musicState.energySlope;
    if (delta > 0.18) {
      this.musicState.density = Math.max(0.3, this.musicState.density * 0.75);
    } else if (delta < -0.18) {
      this.musicState.density = Math.min(0.9, this.musicState.density * 1.15);
    } else {
      this.musicState.density += (0.7 - this.musicState.density) * 0.05;
    }

    // ── LEARNING (record kicks when locked) ──
    // PERF: heavy work moved out of detect(). Only buffer the BPM for the 1 Hz learnTick.
    // This was the #1 source of audio stutter: every radio beat fired
    // recordKick + deriveInsights (1296-iter scale scan) + saveLearning (JSON.stringify
    // + localStorage.setItem — synchronous, blocks main thread 10-30ms).
    if (transportSnap.locked && radioSnap.beat) {
      if (this.learningData) {
        // Buffer — learnTick() will batch-record these into learningData
        this.pendingKickBpms.push(Math.round(transportSnap.bpm));
      }
      this.updateDelayTime();
      this.updateMixMode();
    }

    // PERF: buffer bass freq observations too (cheap to push, expensive to process)
    if (this.bassFreq > 0 && this.bassFreq !== this.lastBufferedBassFreq) {
      this.pendingBassFreqs.push(this.bassFreq);
      this.lastBufferedBassFreq = this.bassFreq;
      if (this.pendingBassFreqs.length > 64) this.pendingBassFreqs.shift();
    }

    // Engine level (light: 1 FFT pull + sum)
    if (this.analyser) {
      // Reuse buffer to avoid per-tick allocation
      if (!this.engineFreqBuf || this.engineFreqBuf.length !== this.analyser.frequencyBinCount) {
        this.engineFreqBuf = new Uint8Array(this.analyser.frequencyBinCount);
      }
      const d = this.engineFreqBuf;
      this.analyser.getByteFrequencyData(d);
      let s = 0; for (let i = 0; i < d.length; i++) s += d[i];
      this.engineLevel = s / (d.length * 255);
    }

    // PERF: emit() NO LONGER called from detect(). The 250 ms uiTimer handles UI updates.
    // Calling emit() here caused React to re-render the studio UI 10×/sec, which
    // competed with the audio thread for main-thread time and produced the
    // characteristic "jump every (round) second" stutter the user reported.
  }

  // PERF: 1 Hz learning derivation. Replaces per-beat deriveInsights() call.
  // Batch-processes pending kick BPMs and bass freqs, then runs scale detection once.
  // STAGE 4: Also feeds detected BPM/scale/key into CausalComposer.
  // FIX: learnTick now runs deriveInsights ONCE, and applyLearnedParamsToComposer
  // uses the already-computed result (was calling getInsights → deriveInsights AGAIN = 2× per second).
  private learnTick(): void {
    if (!this.learningData) return;
    if (this.pendingKickBpms.length === 0 && this.pendingBassFreqs.length === 0) {
      // Nothing new — skip entirely. No need to recompute insights if nothing changed.
      return;
    }
    // Batch-record pending kicks (single deriveInsights at the end, not per-kick)
    for (const bpm of this.pendingKickBpms) {
      this.learningData = recordKick(this.learningData, bpm);
    }
    this.pendingKickBpms.length = 0;
    // Batch-record pending bass freqs
    for (const f of this.pendingBassFreqs) {
      this.learningData = recordBassNote(this.learningData, f);
    }
    this.pendingBassFreqs.length = 0;
    // Single deriveInsights per second (was per beat ≈ 2.4×/sec at 145 BPM)
    this.learningData = deriveInsights(this.learningData);
    this.learningDirty = true;

    // FIX: compute insights ONCE here, cache it. applyLearnedParamsToComposer reads the cache.
    // (was: applyLearnedParamsToComposer called getInsights → deriveInsights AGAIN)
    this.cachedInsights = getInsights(this.learningData);
    this.insightsDirty = false;

    // STAGE 4: Feed detected musical parameters into CausalComposer.
    // Now uses cachedInsights (already computed above) — no double deriveInsights.
    this.applyLearnedParamsToComposer();
  }

  // STAGE 4: Feed learned BPM/scale/key into CausalComposer.
  // Only applies when radio is connected AND confidence is high enough.
  // Tracks last-applied values to avoid redundant updates.
  private lastAppliedBpm = 0;
  private lastAppliedRoot = -1;
  private lastAppliedScale = '';
  private applyLearnedParamsToComposer(): void {
    // FIX: cachedInsights is already computed in learnTick() before this is called.
    // Do NOT call getInsights here — that would run deriveInsights AGAIN (2× per second).
    if (!this.causalComposer || !this.cachedInsights) return;

    const insights = this.cachedInsights;
    // Only apply when radio is ON (don't let stale learning data override user's manual session)
    if (!this.radioOn) return;

    // BPM: apply if stable confidence > 0.5 and differs from current by > 2 BPM
    if (insights.tempo && insights.tempo.confidence > 0.5 && insights.tempo.stable > 0) {
      const detectedBpm = insights.tempo.stable;
      if (Math.abs(detectedBpm - this.lastAppliedBpm) > 2) {
        this.causalComposer.setBPM(detectedBpm);
        // Also update transport so the audio clock matches
        if (this.transport) this.transport.setTempo(detectedBpm, 'radio');
        this.lastAppliedBpm = detectedBpm;
      }
    }

    // Key (root pitch class): apply if top key has enough votes
    if (insights.scale && insights.scale.matchScore > 0.6) {
      const rootPc = insights.scale.root;
      if (rootPc !== this.lastAppliedRoot) {
        this.causalComposer.setRoot(rootPc);
        this.lastAppliedRoot = rootPc;
      }
      // Scale: apply if detected and differs from current
      const scaleName = insights.scale.name.toLowerCase().replace(' ', '-');
      if (scaleName !== this.lastAppliedScale) {
        this.causalComposer.setScale(scaleName);
        this.lastAppliedScale = scaleName;
      }
    }
  }

  // PERF: 0.2 Hz localStorage persistence. Replaces per-beat saveLearning() call.
  // JSON.stringify + localStorage.setItem is synchronous and blocks the main thread.
  private persistTick(): void {
    if (!this.learningDirty || !this.learningData) return;
    saveLearning(this.learningData);
    this.learningDirty = false;
  }

  // F2.5: onKick() REMOVED — RadioObservationLayer handles beat detection internally.
  // Beat observations flow: radioLayer.process() → radioSnap.beat → transport.observeBeat()

  // ── UI timer ──
  private startUITimer(): void {
    if (this.uiTimer) clearInterval(this.uiTimer);
    // FIX: UI updates at 2000ms (0.5Hz) — the audio engine is the priority.
    // The studio UI only shows BPM/decision/state which change at ~1.6s bar intervals.
    // 0.5Hz is enough for human perception of "live" updates and minimizes React render cost.
    this.uiTimer = setInterval(() => this.emit(), 2000);
  }
  private stopUITimer(): void {
    if (this.uiTimer) { clearInterval(this.uiTimer); this.uiTimer = null; }
  }

  // ── Style classifier ──
  // F1.18: BPM comes from Transport — single source of truth
  private classifyStyle(): Style | null {
    const o = this.occupancy;
    const bpm = this.transport ? this.transport.snapshot().bpm : 145;

    // Full On: high kick + high bass + high highs + fast
    if (o.kick > 0.7 && o.bass > 0.6 && o.hats > 0.4 && bpm > 143) {
      return 'fullOn';
    }
    // Dark: high bass + low highs + slow
    if (o.bass > 0.6 && o.hats < 0.3 && bpm < 142) {
      return 'dark';
    }
    // Progressive: moderate everything + stable energy
    if (o.kick < 0.6 && o.bass > 0.4 && this.musicState.energySlope < 0.1) {
      return 'progressive';
    }
    // Acid: mid-heavy + high energy
    if (o.lead > 0.6 && this.musicState.energy > 0.5) {
      return 'acid';
    }
    return null;
  }

  // ── Get current MusicState (for arranger) ──
  getMusicState(): MusicState {
    return { ...this.musicState };
  }

  // F13/R1: getMelodyObservations/getRecentMelody removed — the live
  // MelodyObserver is inside RadioObservationLayer, not a separate field.
  // These methods returned empty arrays anyway (observe() was never called).

  // F11: Generate reverb impulse response
  private mkIR(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 1.8);
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

  // ── F1.18 RULE 9: Browser proof debug surface ──
  // DEBUG ONLY: Exposes Transport + Radio state for browser verification.
  getTransportDebug() {
    if (!this.transport) return null;
    const snap = this.transport.snapshot();
    const radioSnap = this.radioLayer?.getSnapshot();
    return {
      // Transport state
      transportBpm: snap.bpm,
      transportBeat: snap.beatIndex,
      transportBar: snap.bar,
      transportPhase: snap.phase,
      transportEpoch: snap.epoch,
      transportConfidence: snap.confidence,
      transportLocked: snap.locked,
      transportSource: snap.source,
      // Scheduler reads Transport — these must always match
      schedulerBeat: snap.beatIndex,
      schedulerBar: snap.bar,
      schedulerEpoch: snap.epoch,
      schedulerLastScheduledStepIndex: this.lastScheduledBeatIndex,
      // F2.5: Radio observation state
      radioState: radioSnap?.signal.state ?? 'DISCONNECTED',
      radioObservationState: radioSnap?.signal.observationState ?? 'NO_SIGNAL',
      observationCount: radioSnap?.beat?.observationCount ?? 0,
      lastObservationTime: radioSnap?.beat?.timestamp.observedAt ?? 0,
      radioRms: radioSnap?.signal.rms ?? 0,
      radioConfidence: radioSnap?.beat?.confidence ?? 0,
      // F8: MusicalSession state (THE single composer)
      sessionStyle: this.session?.snapshot()?.style ?? 'FULL_ON',
      sessionRole: this.session?.snapshot()?.role ?? 'LEAD',
      sessionAction: this.session?.snapshot()?.action ?? 'introduce',
      sessionSection: this.session?.snapshot()?.section ?? 'UNKNOWN',
      sessionPhrase: this.session?.snapshot()?.phrase ?? 0,
      sessionTension: this.session?.snapshot()?.tension ?? 0,
      sessionDensity: this.session?.snapshot()?.density ?? 0,
      sessionMotifCount: this.session?.snapshot()?.motifCount ?? 0,
      sessionReason: this.session?.snapshot()?.reason ?? '',
      sessionHasLearned: this.session?.hasLearned() ?? false,
      sessionLastReward: this.session?.snapshot()?.lastReward ?? 0,
      // F17: Learning state
      learnedFromRadio: this.session?.hasLearnedFromRadio() ?? false,
      learnedPhraseCount: this.session?.getLearnedPhraseCount() ?? 0,
      hasBassGrammar: this.session?.getLearnedBassGrammar() != null,
      hasRhythmGrammar: this.session?.getLearnedRhythmGrammar() != null,
      hasMelodicGrammar: this.session?.getLearnedMelodicGrammar() != null,
      hasTimbreProfile: this.session?.getLearnedTimbreProfile() != null,
    };
  }

  // F1.18: Public Transport accessor (for integration tests)
  getTransport() { return this.transport; }
}
