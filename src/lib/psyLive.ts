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
import { CausalComposer, type CausalNoteEvent, type CausalBarResult } from '../../foundation/music/CausalComposer';
// שלב 3.4: חישוב תכונות ספקטרליות (centroid/flatness/rolloff) מתדרי הרדיו
import { extractSpectralFeatures } from '../../foundation/music/MusicalObservation';
// שלב 4.1: Per-onset sound analysis
import { OnsetAnalyzer, type OnsetEvent, type OnsetRole } from './onsetAnalyzer';
// שלב 4.2: Synthesis matching (offline)
import { SynthesisMatcher, type MatchResult } from './synthesisMatcher';
// שלב 4.3: Sound bank (IndexedDB)
import { SoundBank, type SoundBankEntry } from './soundBank';
// שלב 4.4: Sound explorer (סריקה רחבה של מרחב הפרמטרים)
import { SoundExplorer, type ExplorationResult } from './soundExplorer';
import { SmartExplorer } from './smartExplorer';
// שלב 4.5: Reward loop (self-improvement)
import { RewardTracker } from './rewardTracker';
import { QualityAnalyzer } from './qualityAnalyzer';
import { ReferenceAnalyzer, type ReferenceDNA } from './referenceAnalyzer';
// שלב 4.6: Musical style classification
import { StyleClassifier, type RadioStyle, type StyleFeatures, type ClassificationResult } from './styleClassifier';
// שלב 5.1: Sound package (export/import)
import { PackageExporter, PackageImporter, type SoundPackage, type PackagePattern, type PackageInsights } from './soundPackage';
// שלב 5.2: Original synthesis generation
import { SynthesisGenerator, type GenerationResult } from './synthesisGenerator';
// שלב 5: Loop learner (למידה מקבצי אודיו)
import { LoopLearner } from './loopLearner';
// ADR-001: CausalComposer runs on a Web Worker now. This import is kept for type compatibility
// but the actual composition happens in public/worklets/composition-worker.js
// SamplerBridge import REMOVED — fully dead code
import { MaterialRealizer } from './material-realizer';
import { Psy4EngineNode, VOICE, type VoiceId, type EngineStats } from './studio/engine/engineWorklet';
import { SynthBridge, type SynthBridgeDiagnostics } from './synth-bridge';

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
  downlifter: VOICE.SWEEP,
  stab: VOICE.LEAD, chord: VOICE.LEAD,
  wavetable: VOICE.LEAD as VoiceId,
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
  // VERIFIED streams — all return HTTP 200 + CORS-enabled
  { id: 'spaceunicorn', name: 'Space Unicorn', url: 'https://spaceunicorn.radio/stream', genre: 'Trance · PsyTrance', bitrate: 192 },
  { id: 'babaganousha', name: 'Babaganousha', url: 'https://babaganousha.net:8443/stream/1/', genre: 'Psychedelic · Goa', bitrate: 128 },
  { id: 'somafm-trip', name: 'SomaFM The Trip', url: 'https://ice1.somafm.com/thetrip-128-mp3', genre: 'Dance · Trance · House', bitrate: 128 },
  { id: 'somafm-trip-256', name: 'SomaFM The Trip (256k)', url: 'https://ice1.somafm.com/thetrip-256-mp3', genre: 'Dance · Trance · House', bitrate: 256 },
  { id: 'somafm-spacestation', name: 'SomaFM Space Station', url: 'https://ice1.somafm.com/spacestation-128-mp3', genre: 'Space · Electronica', bitrate: 128 },
  { id: 'somafm-spacestation-256', name: 'SomaFM Space Station (256k)', url: 'https://ice1.somafm.com/spacestation-256-mp3', genre: 'Space · Electronica', bitrate: 256 },
  { id: 'somafm-cliqhop', name: 'SomaFM Cliqhop', url: 'https://ice1.somafm.com/cliqhop-128-mp3', genre: 'IDM · Beats', bitrate: 128 },
  { id: 'somafm-cliqhop-2', name: 'SomaFM Cliqhop (mirror)', url: 'https://ice2.somafm.com/cliqhop-128-mp3', genre: 'IDM · Beats', bitrate: 128 },
  { id: 'somafm-defcon', name: 'SomaFM DEF CON', url: 'https://ice1.somafm.com/defcon-256-mp3', genre: 'Electronic · Hacking', bitrate: 256 },
  { id: 'somafm-defcon-2', name: 'SomaFM DEF CON (mirror)', url: 'https://ice2.somafm.com/defcon-256-mp3', genre: 'Electronic · Hacking', bitrate: 256 },
  { id: 'somafm-groovesalad', name: 'SomaFM Groove Salad', url: 'https://ice1.somafm.com/groovesalad-256-mp3', genre: 'Ambient · Chill', bitrate: 256 },
  { id: 'somafm-dronezone', name: 'SomaFM Drone Zone', url: 'https://ice1.somafm.com/dronezone-256-mp3', genre: 'Ambient · Space', bitrate: 256 },
  { id: 'somafm-beatblender', name: 'SomaFM Beat Blender', url: 'https://ice1.somafm.com/beatblender-128-mp3', genre: 'Downtempo · Late Night', bitrate: 128 },
  { id: 'somafm-sonicuniverse', name: 'SomaFM Sonic Universe', url: 'https://ice1.somafm.com/sonicuniverse-128-mp3', genre: 'Jazz · Electronic', bitrate: 128 },
  { id: 'somafm-secretagent', name: 'SomaFM Secret Agent', url: 'https://ice1.somafm.com/secretagent-128-mp3', genre: 'Spy · Lounge', bitrate: 128 },
  { id: 'radioparadise', name: 'Radio Paradise', url: 'https://stream.radioparadise.com/mp3-320', genre: 'Eclectic · Mixed', bitrate: 320 },
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
  private workletVolumeGain: GainNode | null = null;  // Volume control for AudioWorklet output
  private sidechainDuck: GainNode | null = null;     // Sidechain duck gain (dips on kick)
  // Multiband (native BiquadFilterNode — stable, not manual DSP)
  private multibandLow: BiquadFilterNode | null = null;
  private multibandMid1: BiquadFilterNode | null = null;
  private multibandMid2: BiquadFilterNode | null = null;
  private multibandHigh: BiquadFilterNode | null = null;
  private multibandLowGain: GainNode | null = null;
  private multibandMidGain: GainNode | null = null;
  private multibandHighGain: GainNode | null = null;
  private multibandSum: GainNode | null = null;
  // Effects wet gains (for routing to master)
  private delayWet: GainNode | null = null;
  private reverbWetGain: GainNode | null = null;
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

  // MusicalSession REMOVED — was 1403 lines of dead code. All composition goes through CausalComposer.
  // ADR-001: CausalComposer runs on a Web Worker. These fields manage the worker.
  private compositionWorker: Worker | null = null;
  // SYNTH DEVICE: psysynth integration (A/B toggle, default OFF)
  private synthBridge: SynthBridge | null = null;
  private synthDeviceEnabled = false;
  // FIX B3: composition seed for determinism (same seed → same composition)
  private compositionSeed = 42;
  // Tone.js effects (professional reverb/delay/distortion)
  private toneFx = false;
  private toneDistortion: any = null;
  private toneDelay: any = null;
  private toneReverb: any = null;
  private toneOutput: GainNode | null = null;
  private masterLimiter: DynamicsCompressorNode | null = null;
  private workerReady = false;
  private workerState: { tensionLevel: number; contrastDebt: number; anticipationLevel: number; grooveStability: number; expectationLevel: number } = { tensionLevel: 0, contrastDebt: 0, anticipationLevel: 0, grooveStability: 0, expectationLevel: 0 };
  private workerAction = 'NO_CHANGE';
  private workerActiveVoices: string[] = [];
  private lastWorkerComposeBar = -1;
  // ADR-001: Cached user controls (worker doesn't send these back, we cache locally)
  private cachedUserControls = {
    energy: 0.5,
    tension: 0.3,
    style: 'FULL_ON' as 'FULL_ON' | 'DARK' | 'PROGRESSIVE' | 'ACID',
    forcedSection: null as 'BREAK' | 'BUILD' | 'DROP' | null,
    forcedBarsRemaining: 0,
  };
  // שלב 1.1: נתוני רדיו → worker
  private _radioToWorkerCounter = 0;
  private _lastSentRadioBpm = 0;
  private _bpmHistory: number[] = []; // תיקון: smoothing ל-BPM
  // תיקון: BPM LOCK — מונע בריחת BPM
  private _bpmLocked = false;
  private _lockedBpm = 0;
  private _bpmStableTime = 0;
  private _bpmDriftTime = 0;
  private _lastSentRoot = -1;
  private _lastSentScale = '';
  private _lastSentStyle = '';
  // שלב 2.3: השלמת תדרים
  private _freqBalanceCounter = 0;
  // שלב 3.1: למידת kick pattern — תיעוד timestamps של פעימות רדיו
  private radioKickTimes: number[] = [];
  private _lastSentKickPatternSig = '';
  // שלב 3.2: למידת bass intervals — היסטוגרמה של מרווחי סמיטונים
  private radioBassFreqs: number[] = [];
  private _lastSentBassIntervalsSig = '';
  // שלב 3.3: למידת melodic intervals — תיעוד lead pitch → היסטוגרמה
  private radioLeadPitches: number[] = [];
  private _lastSentMelodicIntervalsSig = '';
  // שלב 3.4: תכונות ספקטרליות — centroid/flatness/rolloff
  private _lastSentSpectralSig = '';
  // שלב 3.5: מעקב אנרגיה — לזיהוי עליה ולהעלות שכבות
  private _lastSentEnergyFollowSig = '';
  // שלב 3.4: cache אחרון של תכונות ספקטרליות (עדכון כל 100ms ב-detect)
  private radioSpectral: { centroid: number; flatness: number; rolloff: number; low: number; mid: number; high: number } = { centroid: 0, flatness: 0, rolloff: 0, low: 0, mid: 0, high: 0 };
  // EMA-smoothed spectral features (יציב יותר מערך נקודתי)
  private spectralCentroidEma = 0;
  private spectralFlatnessEma = 0;
  private spectralRolloffEma = 0;
  // שלב 4.1: Per-onset sound analysis
  private onsetAnalyzer: OnsetAnalyzer = new OnsetAnalyzer();
  // שלב 4.2: Synthesis matching (offline renderer)
  private synthesisMatcher: SynthesisMatcher = new SynthesisMatcher();
  // שלב 4.3: Sound bank (IndexedDB)
  private soundBank: SoundBank = new SoundBank();
  // שלב 4.3: auto-save threshold — matchScore מעל זה נשמר אוטומטית
  private static readonly MATCH_SAVE_THRESHOLD = 0.7;
  // שלב 4.4: Sound explorer — סריקה רחבה של מרחב הפרמטרים
  private soundExplorer: SoundExplorer | null = null;
  private smartExplorer: SmartExplorer | null = null;  // Phase 2.2
  // שלב 4.5: Reward tracker — מודד איך הרדיו מגיב לסאונדים של PSY4
  private rewardTracker: RewardTracker | null = null;
  // שלב 4.6: Style classifier — מזהה סגנון מוזיקלי מהרדיו
  private styleClassifier: StyleClassifier = new StyleClassifier();
  // שלב 4.6: תוצאת הסיווג האחרונה (ל-UI/debugging)
  private lastClassification: ClassificationResult | null = null;
  // שלב 5.1: Package exporter/importer
  private packageExporter: PackageExporter | null = null;
  private packageImporter: PackageImporter | null = null;
  // שלב 5.2: Synthesis generator (וריאציות מקוריות)
  private synthesisGenerator: SynthesisGenerator | null = null;
  // שלב 5: Loop learner (למידה מקבצי אודיו)
  private loopLearner: LoopLearner | null = null;
  // תיקון P0: מעקב אחר play() polling timers
  private _playPollInterval: ReturnType<typeof setInterval> | null = null;
  private _playPollTimeout: ReturnType<typeof setTimeout> | null = null;
  // תיקון P1: מעקב אחר exploration timeout ראשוני
  private _explorationTimeout: ReturnType<typeof setTimeout> | null = null;
  // שלב 4.5: טיימר eviction תקופתי (כל 60s)
  private evictionTimer: ReturnType<typeof setInterval> | null = null;
  // שלב 4.4: איטרציה אוטומטית — כל 30s, סרוק role פעיל
  private explorationTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly EXPLORATION_INTERVAL_MS = 30000;
  // שלב 4.4: איזה role לסרוק הבא (round-robin)
  private nextExploreRoleIdx = 0;
  private nextExploreRole: OnsetRole = 'kick';
  // CAUSAL: The live composition authority (now null — worker handles it)
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
  // SamplerBridge REMOVED — was 212 lines of dead code, never attached from UI
  // currentNotePlan REMOVED — was from MusicalSession (dead code)

  // R6: Master safety limiter
  private safetyLimiter: DynamicsCompressorNode | null = null;
  private safetyReduction: number = 0;

  // Scheduler — wake-up mechanism only (NOT a musical clock)
  // F1.18: setInterval wakes the scheduler; musical time comes from Transport
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly lookahead = 50; // FIX: 50ms scheduler — was 100ms, too slow for continuous audio
  private readonly scheduleAheadTime = 3.0; // FIX: 3 seconds ahead = ~2 bars at 145 BPM. Huge buffer.
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

  // learnTimer + persistTimer REMOVED — merged into uiTimer (ADR-006)
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
    // CAUSAL: Extract causal state from worker state (ADR-001: worker sends state back)
    const cs = this.workerState;
    const cd = { action: this.workerAction, selected: { whyNow: '' } };
    // PERF: getUserControls — now from worker (sent via state messages)
    // For now, use cached values from worker state
    const uc = this.cachedUserControls;
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
    this.delaySend.gain.value = 0;  // FIX: was 0.3 — old delay feedback loop causes squeal/crash. Tone.js handles FX now.
    this.delay = this.ctx.createDelay(2.0);
    this.delay.delayTime.value = 0.3;
    const wet = this.ctx.createGain(); wet.gain.value = 0.22;
    this.delayFb = this.ctx.createGain(); this.delayFb.gain.value = 0.34;
    this.delaySend.connect(this.delay);
    this.delay.connect(wet);
    // FIX: Disconnect delay feedback — it causes squeal/crash over time
    // this.delay.connect(this.delayFb); this.delayFb.connect(this.delay);  // REMOVED
    // Store wet gain reference for routing (connected later in initWorkletEngine)
    this.delayWet = wet;

    // F11: Reverb bus
    this.reverbSend = this.ctx.createGain(); this.reverbSend.gain.value = 0;  // FIX: was 0.3 — old reverb sends to nowhere. Tone.js handles FX now.
    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this.mkIR(this.ctx);
    const reverbWet = this.ctx.createGain(); reverbWet.gain.value = 0.5;
    this.reverbSend.connect(this.convolver);
    this.convolver.connect(reverbWet);
    // Store wet gain reference for routing (connected later in initWorkletEngine)
    this.reverbWetGain = reverbWet;

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
    // תיקון: טען savedBpm מ-localStorage (לא 145 hardcode)
    const transportInitBpm = this.loadMemoryBpm();
    this.transport = new MusicalTransport(() => this.ctx!.currentTime, {
      initialBpm: transportInitBpm,
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
    // MusicalSession instantiation REMOVED — dead code
    // ADR-001: CausalComposer runs on a Web Worker (composition thread)
    // The worker handles all composition — main thread only forwards events to AudioWorklet
    this.compositionWorker = new Worker('/worklets/composition-worker-v2.js');
    this.compositionWorker.onmessage = (e) => this.handleWorkerMessage(e.data);
    // תיקון קריטי: טען savedBpm מ-localStorage ב-init (לא 145 hardcode)
    const initBpm = this.loadMemoryBpm();
    // FIX B3 (determinism): seed must be FIXED for reproducible composition.
    // Was: Math.random() — made every session non-deterministic.
    // Now: read from URL ?seed=NNN, fallback to localStorage 'psy4.seed', fallback to 42.
    // rootPc also fixed (was Math.random() * 12) — start on C (0).
    const urlSeed = (() => {
      try {
        const m = new URLSearchParams(window.location.search).get('seed');
        return m ? parseInt(m, 10) : null;
      } catch { return null; }
    })();
    const storedSeed = (() => {
      try { const s = localStorage.getItem('psy4.seed'); return s ? parseInt(s, 10) : null; } catch { return null; }
    })();
    const seed = urlSeed ?? storedSeed ?? 42;
    this.compositionSeed = seed;
    this.compositionWorker.postMessage({
      type: 'init',
      opts: { bpm: initBpm, rootPc: 0, scaleName: 'phrygian-dominant', seed },
    });
    // Keep causalComposer reference for getUserControls (worker sends state back)
    this.causalComposer = null; // Will be replaced by worker state
    this.workerReady = false;
    // MATERIAL REALIZER — fallback if worklet fails
    this.realizer = new MaterialRealizer({
      audioContext: this.ctx,
      masterGain: this.master ?? this.ctx.destination,
    });

    // AUDIOWORKLET — the REAL production engine
    // Try to initialize the worklet. If it succeeds, use it instead of MaterialRealizer.
    this.initWorkletEngine();
    // ADR-001: Apply pending style via worker
    if (this.pendingStyle) {
      this.setStyle(this.pendingStyle);
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
    // תיקון קריטי: אם playing=true אבל ה-timer לא רץ (אחרי reload), אפס והתחל מחדש
    if (this.playing && this.timer) return; // כבר מנגן תקין
    if (this.playing && !this.timer) {
      // playing=true אבל timer מת — אפס והתחל מחדש
      this.playing = false;
    }
    this.playing = true;
    // תיקון P0: מנעון נגד play() כפול + ניקוי polling קודם
    if (this._playPollInterval) {
      clearInterval(this._playPollInterval);
      this._playPollInterval = null;
    }
    if (this._playPollTimeout) {
      clearTimeout(this._playPollTimeout);
      this._playPollTimeout = null;
    }
    if (this.useWorklet && this.engineNode) {
      this.engineNode.play();
      const savedBpm = this.loadMemoryBpm();
      this.engineNode.setBPM(savedBpm);
      // תיקון קריטי: עדכן גם את transport + worker עם ה-BPM השמור
      if (this.transport) this.transport.setTempo(savedBpm, 'internal');
      if (this.compositionWorker && this.workerReady) {
        this.compositionWorker.postMessage({ type: 'setBPM', bpm: savedBpm });
      }
      this.loadLearnedParamsFromMemory();
      // תיקון: אם אין params שמורים, צור defaults אקראיים כדי שלא יהיה אותו סאונד כל פעם
      this.ensureDefaultLearnedParams();
    } else {
      // Worklet not ready — poll until it is
      this._playPollInterval = setInterval(() => {
        if (this.useWorklet && this.engineNode && this.playing) {
          if (this._playPollInterval) clearInterval(this._playPollInterval);
          this._playPollInterval = null;
          this.engineNode.play();
          const savedBpm = this.loadMemoryBpm();
          this.engineNode.setBPM(savedBpm);
          if (this.transport) this.transport.setTempo(savedBpm, 'internal');
          if (this.compositionWorker && this.workerReady) {
            this.compositionWorker.postMessage({ type: 'setBPM', bpm: savedBpm });
          }
          this.loadLearnedParamsFromMemory();
          this.ensureDefaultLearnedParams();
          this.sendInitialCompose();
        }
      }, 50);
      // Timeout after 5s
      this._playPollTimeout = setTimeout(() => {
        if (this._playPollInterval) {
          clearInterval(this._playPollInterval);
          this._playPollInterval = null;
        }
      }, 5000);
    }
    this.transport!.start();
    this.lastScheduledBeatIndex = -1;
    this.updateDelayTime();
    this.timer = setInterval(() => this.scheduler(), this.lookahead);
    this.startUITimer();
    // תיקון: התחל exploration גם בלי רדיו — עם synthetic target DNA
    this.startAutoExploration();
    // Send initial compose if worklet is already ready
    if (this.workerReady && this.useWorklet && this.engineNode) {
      this.sendInitialCompose();
    }
    this.emit();
  }

  private sendInitialCompose(): void {
    if (!this.workerReady || !this.useWorklet || !this.engineNode) return;
    const snap = this.transport!.snapshot();
    const beatDur = 60 / snap.bpm;
    const barOriginAudioTime = this.ctx!.currentTime;
    this.lastWorkerComposeBar = -1;
    // FIX: compose 8 bars ahead for maximum buffer
    this.compositionWorker?.postMessage({
      type: 'compose',
      startBar: 0,
      endBar: 9,
      barOriginAudioTime,
    });
    this.lastWorkerComposeBar = 8;
  }

  stop(): void {
    this.playing = false;
    // תיקון P0: נקה play() polling timers
    if (this._playPollInterval) { clearInterval(this._playPollInterval); this._playPollInterval = null; }
    if (this._playPollTimeout) { clearTimeout(this._playPollTimeout); this._playPollTimeout = null; }
    // תיקון P0: עצור loop learner אם פעיל
    if (this.loopLearner && this.loopLearner.isRunning()) {
      this.loopLearner.stop();
    }
    if (this.engineNode) this.engineNode.stop();
    
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    // CRITICAL FIX: Reset worker compose state so it starts fresh on next play
    this.lastWorkerComposeBar = -1;
    if (this.compositionWorker) {
      this.compositionWorker.postMessage({ type: 'reset' });
    }
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
    // Use workletVolumeGain for AudioWorklet output (main path)
    if (this.workletVolumeGain && this.ctx)
      this.workletVolumeGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    // Also set legacy master (for non-worklet fallback)
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
    const s = (style === 'DARK' || style === 'PROGRESSIVE' || style === 'ACID') ? style : 'FULL_ON';
    this.cachedUserControls.style = s as 'FULL_ON' | 'DARK' | 'PROGRESSIVE' | 'ACID';
    this.sendWorkerControls();
    if (!this.workerReady) this.pendingStyle = style;
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
    // SYNTH DEVICE: push context to psysynth for patch bank selection
    if (this.synthBridge && this.synthDeviceEnabled) {
      this.synthBridge.publishContext({
        style: s,
        energy: this.cachedUserControls.energy,
        section: 'groove',
      });
    }
  }

  // ── SYNTH DEVICE (psysynth) integration ──
  // A/B toggle: when enabled, melodic voices (bass/lead/acid/pad/texture/fm/wavetable)
  // are ALSO forwarded to the psysynth device on the shared engine bus.
  // Drums (kick/snare/hat/clap/perc/shaker) always stay on PSY4's worklet.
  // Default: OFF (opt-in). User toggles via UI button "SYNTH DEVICE".

  /**
   * Enable the psysynth synth device. Lazily creates the SynthBridge on first call.
   * Returns true on success, false on failure (with console error).
   */
  async enableSynthDevice(): Promise<boolean> {
    if (this.synthDeviceEnabled) return true;
    if (!this.ctx || !this.engineBus) {
      console.error('[PSY4] enableSynthDevice: audio context or engineBus not ready');
      return false;
    }
    try {
      if (!this.synthBridge) {
        this.synthBridge = new SynthBridge({
          audioContext: this.ctx,
          outputNode: this.engineBus,
          delaySendNode: this.delaySend,
          reverbSendNode: this.reverbSend,
          maxVoices: 12,
          seed: 1,
          patchManifestUrl: '/patches/manifest.json',
        });
        await this.synthBridge.init();
      } else {
        this.synthBridge.resume();
      }
      this.synthDeviceEnabled = true;
      // Push current context so the device picks the right bank
      this.synthBridge.publishContext({
        style: this.cachedUserControls.style,
        energy: this.cachedUserControls.energy,
        section: 'groove',
      });
      console.log('[PSY4] Synth device ENABLED (psysynth) — melodic voices routed to both worklet + psysynth');

      // TONE.JS INTEGRATION — add professional effects to master chain
      await this.initToneFx();

      this.emit();
      return true;
    } catch (err) {
      console.error('[PSY4] enableSynthDevice failed:', err);
      this.synthDeviceEnabled = false;
      return false;
    }
  }

  /**
   * Initialize Tone.js effects chain — adds professional reverb, delay, distortion.
   * Uses the existing AudioContext (Tone.setContext).
   * This is the "fat fish" — Tone.js effects make everything sound richer.
   */
  private async initToneFx(): Promise<void> {
    if (this.toneFx) return;
    try {
      const Tone = await import('tone');
      Tone.setContext(this.ctx!);

      // Create professional effects chain — WET SEND ONLY (parallel, not series)
      // The dry signal goes through multiband → workletVolumeGain as before.
      // Tone.js is a parallel send: sidechainDuck → Tone.js → workletVolumeGain
      // with low wet levels so it adds ambiance, not doubles the signal.
      this.toneDistortion = new Tone.Distortion({ distortion: 0.1, wet: 0.15 });
      this.toneDelay = new Tone.FeedbackDelay({
        delayTime: '8n.',
        feedback: 0.1,  // FIX: was 0.3 — caused resonance build-up (squeal)
        wet: 0.1,
      });
      this.toneReverb = new Tone.Reverb({
        decay: 2.5,
        preDelay: 0.01,
        wet: 0.15,
      });
      await this.toneReverb.ready;

      // Chain: distortion → delay → reverb (Tone.js internal)
      this.toneDistortion.connect(this.toneDelay);
      this.toneDelay.connect(this.toneReverb);

      // Bridge input: sidechainDuck → Tone.js (parallel send)
      const toneInput = new Tone.Gain(0.3);  // FIX: 30% send level (was 1.0 = doubling)
      this.sidechainDuck!.connect(toneInput.input);
      toneInput.connect(this.toneDistortion);

      // Bridge output: reverb → workletVolumeGain (parallel return)
      const toneOutput = new Tone.Gain(0.5);  // 50% return level
      this.toneReverb.connect(toneOutput);
      const toneOutputNode = (toneOutput as any)._internalOutput || (toneOutput as any).output;
      if (toneOutputNode) {
        toneOutputNode.connect(this.workletVolumeGain!);
      }

      this.toneFx = true;
      console.log('[PSY4] Tone.js FX send active (parallel): Distortion(10%) → Delay(15%) → Reverb(15%)');
    } catch (err) {
      console.warn('[PSY4] Tone.js FX init failed (non-fatal):', err);
    }
  }

  /**
   * Disable the psysynth synth device. Fast-releases all synth voices.
   */
  disableSynthDevice(): void {
    if (!this.synthDeviceEnabled) return;
    this.synthBridge?.panic();
    this.synthDeviceEnabled = false;
    console.log('[PSY4] Synth device DISABLED — melodic voices back to worklet only');
    this.emit();
  }

  /**
   * Toggle the synth device on/off. Returns the new state.
   */
  async toggleSynthDevice(): Promise<boolean> {
    if (this.synthDeviceEnabled) {
      this.disableSynthDevice();
      return false;
    } else {
      const ok = await this.enableSynthDevice();
      return ok;
    }
  }

  isSynthDeviceEnabled(): boolean {
    return this.synthDeviceEnabled;
  }

  /** Returns the current composition seed (for UI display + reproducibility). */
  getCompositionSeed(): number {
    return this.compositionSeed;
  }

  getSynthBridgeDiagnostics(): SynthBridgeDiagnostics | null {
    if (!this.synthBridge) return null;
    return this.synthBridge.getDiagnostics();
  }

  // ── MIDI Input (live keyboard playing) ──
  private midiAccess: any = null;
  private midiActive = false;

  /**
   * Initialize WebMIDI for live keyboard input.
   * Returns true if MIDI is available and enabled.
   */
  async enableMidiInput(): Promise<boolean> {
    if (this.midiActive) return true;
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      console.warn('[PSY4] WebMIDI not supported in this browser');
      return false;
    }
    try {
      this.midiAccess = await navigator.requestMIDIAccess();
      this.midiActive = true;
      // Listen to all MIDI inputs
      for (const input of this.midiAccess.inputs.values()) {
        input.onmidimessage = (e: any) => this.handleMidiMessage(e);
      }
      console.log('[PSY4] MIDI input enabled — connect a keyboard and play!');
      return true;
    } catch (err) {
      console.warn('[PSY4] MIDI access denied:', err);
      return false;
    }
  }

  /**
   * Disable MIDI input.
   */
  disableMidiInput(): void {
    if (!this.midiActive) return;
    if (this.midiAccess) {
      for (const input of this.midiAccess.inputs.values()) {
        input.onmidimessage = null;
      }
    }
    this.midiActive = false;
    console.log('[PSY4] MIDI input disabled');
  }

  isMidiActive(): boolean {
    return this.midiActive;
  }

  /**
   * Handle incoming MIDI messages.
   * Routes note on/off to psysynth via SynthBridge.
   */
  private handleMidiMessage(e: any): void {
    const [status, data1, data2] = e.data;
    const cmd = status & 0xf0;
    const channel = status & 0x0f;
    // Map MIDI channel to psysynth role (ch 0 → 'lead', 1 → 'bass', etc.)
    const roleMap = ['lead', 'bass', 'pad', 'keys', 'arp', 'stab', 'pluck'];
    const role = roleMap[channel] || 'lead';

    if (cmd === 0x90 && data2 > 0) {
      // Note on
      const midiNote = data1;
      const velocity = data2 / 127;
      if (this.synthBridge && this.synthDeviceEnabled) {
        this.synthBridge.playMidiNote(midiNote, velocity, role);
      }
    } else if (cmd === 0x80 || (cmd === 0x90 && data2 === 0)) {
      // Note off
      const midiNote = data1;
      if (this.synthBridge && this.synthDeviceEnabled) {
        this.synthBridge.releaseMidiNote(midiNote, role);
      }
    } else if (cmd === 0xB0) {
      // CC (control change)
      const cc = data1;
      const value = data2 / 127;
      if (this.synthBridge && this.synthDeviceEnabled) {
        this.synthBridge.setParameterByCC(cc, value);
      }
    }
  }

  // STAGE 2: Energy — now routes to CausalComposer (was: dead session.setEnergy)
  setEnergy(v: number): void {
    // STAGE 2: CausalComposer uses energy for velocity scaling + threshold bias
    this.cachedUserControls.energy = v; this.sendWorkerControls();
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
    this.cachedUserControls.tension = v; this.sendWorkerControls();
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
    this.cachedUserControls.forcedSection = s as 'BREAK' | 'BUILD' | 'DROP';
    this.cachedUserControls.forcedBarsRemaining = 4;
    this.sendWorkerControls();
  }
  releaseSection(): void {
    this.cachedUserControls.forcedSection = null;
    this.cachedUserControls.forcedBarsRemaining = 0;
    this.sendWorkerControls();
  }
  triggerBreak(bars = 4): void {
    this.cachedUserControls.forcedSection = 'BREAK';
    this.cachedUserControls.forcedBarsRemaining = bars;
    this.sendWorkerControls();
  }
  triggerBuild(bars = 4): void {
    this.cachedUserControls.forcedSection = 'BUILD';
    this.cachedUserControls.forcedBarsRemaining = bars;
    this.sendWorkerControls();
  }
  triggerDrop(bars = 4): void {
    this.cachedUserControls.forcedSection = 'DROP';
    this.cachedUserControls.forcedBarsRemaining = bars;
    this.sendWorkerControls();
  }
  getArrangementState() {
    return {
      section: this.cachedUserControls.forcedSection ?? 'AUTO',
      barsRemaining: this.cachedUserControls.forcedBarsRemaining,
    };
  }

  // ADR-001: Send user controls to the composition Web Worker
  private sendWorkerControls(): void {
    if (!this.compositionWorker || !this.workerReady) return;
    this.compositionWorker.postMessage({
      type: 'controls',
      energy: this.cachedUserControls.energy,
      tension: this.cachedUserControls.tension,
      style: this.cachedUserControls.style,
      forcedSection: this.cachedUserControls.forcedSection,
      bars: this.cachedUserControls.forcedBarsRemaining,
    });
  }

  // שלב 1.1: שלח נתוני רדיו ל-CausalComposerWorker
  // (שדות _radioToWorkerCounter וכו' כבר מוגדרים למעלה)
  private sendRadioDataToWorker(radioSnap: any, transportSnap: any): void {
    if (!this.compositionWorker || !this.workerReady || !this.radioOn) return;

    // 1.1.1 BPM — LOCK מלא אחרי ייצוב
    // תיקון קריטי: ה-BPM היה בורח כל שניה. עכשיו:
    // 1. אסוף 5 קריאות
    // 2. אם כולן בטווח ±2 BPM → ה-BPM "יציב"
    // 3. אם יציב ברצף למשך 10 שניות → LOCK (לא מעדכן יותר!)
    // 4. רק אם יש drift > 5 BPM למשך 5 שניות → UNLOCK
    const radioBpm = radioSnap.beat?.estimatedBpm ?? 0;
    const beatConfidence = radioSnap.beat?.confidence ?? 0;
    if (beatConfidence > 0.5 && radioBpm > 0) {
      this._bpmHistory.push(radioBpm);
      if (this._bpmHistory.length > 5) this._bpmHistory.shift();

      if (this._bpmHistory.length >= 3) {
        const avgBpm = this._bpmHistory.reduce((a, b) => a + b, 0) / this._bpmHistory.length;
        // תיקון: הרחב את הטווח ל-±6 BPM (רדיו PLL קופץ הרבה)
        const stable = this._bpmHistory.every(b => Math.abs(b - avgBpm) < 6);

        if (this._bpmLocked) {
          // BPM נעול — ודא שה-transport תמיד על ה-lockedBpm
          const currentTransportBpm = this.transport ? this.transport.snapshot().bpm : 0;
          if (Math.abs(currentTransportBpm - this._lockedBpm) > 0.5) {
            if (this.transport) this.transport.setTempo(this._lockedBpm, 'internal');
            if (this.engineNode) this.engineNode.setBPM(this._lockedBpm);
            if (this.compositionWorker && this.workerReady) {
              this.compositionWorker.postMessage({ type: 'setBPM', bpm: this._lockedBpm });
            }
            console.log(`[PSY4] BPM re-locked to ${this._lockedBpm.toFixed(1)} (transport was ${currentTransportBpm.toFixed(1)})`);
          }
          // בדוק drift גדול
          if (Math.abs(avgBpm - this._lockedBpm) > 5) {
            this._bpmDriftTime = (this._bpmDriftTime || 0) + 2; // כל tick = ~2s
            if (this._bpmDriftTime >= 5) {
              console.log(`[PSY4] BPM UNLOCK: drift > 5 for 5s (locked=${this._lockedBpm.toFixed(1)}, radio=${avgBpm.toFixed(1)})`);
              this._bpmLocked = false;
              this._bpmStableTime = 0;
              this._bpmDriftTime = 0;
            }
          } else {
            this._bpmDriftTime = 0;
          }
        } else {
          // BPM לא נעול — בדוק יציבות
          if (stable) {
            this._bpmStableTime = (this._bpmStableTime || 0) + 2;
            if (this._bpmStableTime >= 10) {
              // LOCK!
              this._bpmLocked = true;
              this._lockedBpm = avgBpm;
              this._bpmStableTime = 0;
              this._bpmDriftTime = 0;
              this.compositionWorker.postMessage({ type: 'setBPM', bpm: avgBpm });
              if (this.transport) this.transport.setTempo(avgBpm, 'radio');
              if (this.engineNode) this.engineNode.setBPM(avgBpm);
              this._lastSentRadioBpm = avgBpm;
              this.saveMemoryBpm(avgBpm);
              console.log(`[PSY4] 🔒 BPM LOCKED at ${avgBpm.toFixed(1)} (stable for 10s)`);
            } else {
              // תיקון: שמור את ה-BPM גם לפני lock — כדי שיהיה זיכרון גם אם לא מתייצב
              if (Math.abs(avgBpm - this._lastSentRadioBpm) > 2) {
                this.compositionWorker.postMessage({ type: 'setBPM', bpm: avgBpm });
                if (this.transport) this.transport.setTempo(avgBpm, 'radio');
                if (this.engineNode) this.engineNode.setBPM(avgBpm);
                this._lastSentRadioBpm = avgBpm;
                this.saveMemoryBpm(avgBpm);
                console.log(`[PSY4] BPM updated (pre-lock): ${avgBpm.toFixed(1)} (stable ${this._bpmStableTime}s/10s)`);
              }
            }
          } else {
            this._bpmStableTime = 0;
          }
        }
      }
    }

    // 1.1.2 סולם/מפתח — שלח אם matchScore > 0.6
    if (this.cachedInsights?.scale && this.cachedInsights.scale.matchScore > 0.6) {
      const rootPc = this.cachedInsights.scale.root;
      const scaleName = this.cachedInsights.scale.name.toLowerCase().replace(' ', '-');
      if (rootPc !== this._lastSentRoot) {
        this.compositionWorker.postMessage({ type: 'setRoot', rootPc });
        this._lastSentRoot = rootPc;
        console.log(`[PSY4] Radio→Worker: root=${rootPc} scale=${scaleName} (match=${this.cachedInsights.scale.matchScore.toFixed(2)})`);
      }
      if (scaleName !== this._lastSentScale) {
        this.compositionWorker.postMessage({ type: 'setScale', scaleName });
        this._lastSentScale = scaleName;
      }
    }

    // 1.1.3 + שלב 3.5: Energy FOLLOW — שלח לפי שיפוע (slope), לא ערך אבסולוטי
    // אם הרדיו עולה באנרגיה, PSY4 עוקב (מעלה layers). אם יורד — מוריד.
    this.sendEnergyFollowToWorker(radioSnap);

    // 1.1.4 סגנון — שלח אם השתנה
    const detectedStyle = this.classifyStyle();
    if (detectedStyle && detectedStyle !== this._lastSentStyle) {
      const styleMap: Record<string, string> = {
        fullOn: 'FULL_ON', dark: 'DARK', progressive: 'PROGRESSIVE', acid: 'ACID',
      };
      const mappedStyle = styleMap[detectedStyle] || 'FULL_ON';
      this.compositionWorker.postMessage({ type: 'controls', style: mappedStyle });
      this._lastSentStyle = detectedStyle;
      console.log(`[PSY4] Radio→Worker: style=${mappedStyle}`);
    }

    // שלב 3.1: חלץ דפוס kick 16-step מהרדיו ושלח ל-worker
    this.sendKickPatternToWorker(transportSnap);
    // שלב 3.2: חלץ היסטוגרמת מרווחי bass ושלח ל-worker
    this.sendBassIntervalsToWorker();
    // שלב 3.3: חלץ היסטוגרמת מרווחי melodic ושלח ל-worker
    this.sendMelodicIntervalsToWorker();
  }

  // שלב 3.1: חילוץ דפוס kick 16-step מתוך radioKickTimes
  // ממפה כל timestamp ל-step בתוך התיבה (0..15) ובונה היסטוגרמה מנורמלת
  private sendKickPatternToWorker(transportSnap: any): void {
    if (!this.compositionWorker || !this.workerReady) return;
    if (!transportSnap || !transportSnap.locked) return;
    // צריך לפחות 16 kicks (4 תיבות) כדי לבנות דפוס אמין
    if (this.radioKickTimes.length < 16) return;

    const bpm = transportSnap.bpm;
    if (bpm < 60 || bpm > 200) return;
    const beatDur = 60 / bpm;
    const barDur = beatDur * 4;
    const stepDur = barDur / 16;

    // barTime = זמן תחילת התיבה הנוכחית (מ-Transport)
    const barTime = transportSnap.barTime || 0;

    // בנה היסטוגרמה של 16 תאים
    const pattern = new Array(16).fill(0);
    for (const t of this.radioKickTimes) {
      // phaseInBar: 0..1 בתוך התיבה
      let phaseInBar = (t - barTime) / barDur;
      // עטוף ל-0..1 (יכול להיות שלילי אם t < barTime, או >1 אם מתיבה קודמת)
      phaseInBar = phaseInBar - Math.floor(phaseInBar);
      const step = Math.round(phaseInBar * 16) % 16;
      pattern[step] += 1;
    }

    // נרמל ל-0..1 (max = 1)
    const maxCount = Math.max(...pattern);
    if (maxCount === 0) return;
    for (let i = 0; i < 16; i++) pattern[i] /= maxCount;

    // חתימה קצרה — שלח רק אם הדפוס השתנה משמעותית
    const sig = pattern.map(v => v > 0.5 ? '1' : v > 0.15 ? '·' : '0').join('');
    if (sig === this._lastSentKickPatternSig) return;
    this._lastSentKickPatternSig = sig;

    this.compositionWorker.postMessage({ type: 'setKickPattern', pattern });
    console.log(`[PSY4] שלב 3.1 Radio→Worker: kickPattern=${sig} (n=${this.radioKickTimes.length})`);

    // נקה את ה-buffer אחרי שליחה — נתונים ישנים כבר לא רלוונטיים
    this.radioKickTimes.length = 0;
  }

  // שלב 3.2: חילוץ היסטוגרמת מרווחי bass מתוך radioBassFreqs
  // ממיר freq → MIDI, מחשב מרווחים בין סמיטונים עוקבים, בונה היסטוגרמה 25 תאים (-12..+12)
  private sendBassIntervalsToWorker(): void {
    if (!this.compositionWorker || !this.workerReady) return;
    // צריך לפחות 8 freqs כדי לבנות היסטוגרמה אמינה
    if (this.radioBassFreqs.length < 8) return;

    // המר כל freq ל-MIDI (round לסמיטון הקרוב)
    const midis: number[] = [];
    for (const f of this.radioBassFreqs) {
      if (f < 30 || f > 500) continue; // סנן תדרים לא-ריאליסטיים
      const midi = Math.round(12 * Math.log2(f / 440) + 69);
      if (midi >= 24 && midi <= 72) midis.push(midi); // טווח bass תקין
    }
    if (midis.length < 8) return;

    // חשב מרווחים עוקבים (semitone differences)
    const histogram = new Array(25).fill(0); // index 0 = -12, index 12 = 0, index 24 = +12
    let totalIntervals = 0;
    for (let i = 1; i < midis.length; i++) {
      const interval = midis[i] - midis[i - 1];
      if (interval < -12 || interval > 12) continue; // דלג על קפיצות גדולות (octave errors)
      const bin = interval + 12;
      histogram[bin] += 1;
      totalIntervals++;
    }
    if (totalIntervals === 0) return;

    // נרמל ל-0..1 (max = 1)
    const maxCount = Math.max(...histogram);
    if (maxCount === 0) return;
    for (let i = 0; i < 25; i++) histogram[i] /= maxCount;

    // חתימה — שלח רק אם השתנה משמעותית
    // הצג את 5 המרווחים החזקים ביותר
    const top5 = histogram
      .map((v, i) => ({ v, interval: i - 12 }))
      .filter(x => x.v > 0.3)
      .sort((a, b) => b.v - a.v)
      .slice(0, 5)
      .map(x => `${x.interval >= 0 ? '+' : ''}${x.interval}:${x.v.toFixed(2)}`)
      .join(',');
    const sig = top5;
    if (sig === this._lastSentBassIntervalsSig) return;
    this._lastSentBassIntervalsSig = sig;

    this.compositionWorker.postMessage({ type: 'setBassIntervals', histogram, intervals: midis.length - 1 });
    console.log(`[PSY4] שלב 3.2 Radio→Worker: bassIntervals top=${sig} (n=${midis.length})`);

    // נקה את ה-buffer
    this.radioBassFreqs.length = 0;
  }

  // שלב 3.3: חילוץ היסטוגרמת מרווחי melodic מתוך radioLeadPitches
  // מחשב מרווחים בין סמיטונים עוקבים של lead pitches, בונה היסטוגרמה 25 תאים (-12..+12)
  private sendMelodicIntervalsToWorker(): void {
    if (!this.compositionWorker || !this.workerReady) return;
    // צריך לפחות 6 pitches כדי לבנות היסטוגרמה אמינה של melodic movement
    if (this.radioLeadPitches.length < 6) return;

    // חשב מרווחים עוקבים (semitone differences) בין lead pitches
    const histogram = new Array(25).fill(0); // index 0 = -12, index 12 = 0, index 24 = +12
    let totalIntervals = 0;
    for (let i = 1; i < this.radioLeadPitches.length; i++) {
      const interval = this.radioLeadPitches[i] - this.radioLeadPitches[i - 1];
      if (interval < -12 || interval > 12) continue; // דלג על קפיצות גדולות
      const bin = interval + 12;
      histogram[bin] += 1;
      totalIntervals++;
    }
    if (totalIntervals === 0) return;

    // נרמל ל-0..1 (max = 1)
    const maxCount = Math.max(...histogram);
    if (maxCount === 0) return;
    for (let i = 0; i < 25; i++) histogram[i] /= maxCount;

    // חתימה — 5 המרווחים החזקים ביותר
    const top5 = histogram
      .map((v, i) => ({ v, interval: i - 12 }))
      .filter(x => x.v > 0.3)
      .sort((a, b) => b.v - a.v)
      .slice(0, 5)
      .map(x => `${x.interval >= 0 ? '+' : ''}${x.interval}:${x.v.toFixed(2)}`)
      .join(',');
    const sig = top5;
    if (sig === this._lastSentMelodicIntervalsSig) return;
    this._lastSentMelodicIntervalsSig = sig;

    this.compositionWorker.postMessage({ type: 'setMelodicIntervals', histogram, intervals: totalIntervals });
    console.log(`[PSY4] שלב 3.3 Radio→Worker: melodicIntervals top=${sig} (n=${this.radioLeadPitches.length})`);

    // נקה את ה-buffer
    this.radioLeadPitches.length = 0;
  }

  // שלב 3.5: מעקב אנרגיה — אם הרדיו עולה באנרגיה, PSY4 עוקב (מעלה layers)
  // משתמש ב-energyHistory (32 דגימות אחרונות, 3.2s) כדי לחשב שיפוע
  // שיפוע חיובי → boost energy (מוסיף layers). שיפוע שלילי → reduce energy (מוריד layers)
  // בנוסף: אנרגיה גבוהה מתמשכת → force DROP. אנרגיה נמוכה מתמשכת → force BREAK.
  private sendEnergyFollowToWorker(radioSnap: any): void {
    if (!this.compositionWorker || !this.workerReady || !this.radioOn) return;
    // צריך לפחות 8 דגימות כדי לחשב שיפוע אמין
    if (this.energyHistory.length < 8) return;

    const recent = this.energyHistory.slice(-4).reduce((a, b) => a + b, 0) / 4;
    const older = this.energyHistory.slice(-8, -4).reduce((a, b) => a + b, 0) / 4;
    const slope = recent - older;
    const absSlope = Math.abs(slope);

    // ── בדיקה 1: אנרגיה מתמשכת גבוהה/נמוכה → force section (לפני בדיקת שיפוע) ──
    // זה צריך לקרות גם כשהשיפוע יציב — אם הרדיו ב-DROP מתמשך, PSY4 צריך לעקוב
    let forcedSectionSent: 'DROP' | 'BREAK' | null = null;
    if (this.energyHistory.length >= 16) {
      const sustainedRecent = this.energyHistory.slice(-8).reduce((a, b) => a + b, 0) / 8;
      const sustainedOlder = this.energyHistory.slice(-16, -8).reduce((a, b) => a + b, 0) / 8;
      // אנרגיה גבוהה מתמשכת (>0.65) — force DROP ל-4 תיבות
      if (sustainedRecent > 0.65 && sustainedOlder > 0.55) {
        if (this.cachedUserControls.forcedSection !== 'DROP') {
          this.compositionWorker.postMessage({ type: 'controls', forcedSection: 'DROP', bars: 4 });
          console.log(`[PSY4] שלב 3.5 Radio→Worker: force DROP (sustained high energy=${sustainedRecent.toFixed(2)})`);
          forcedSectionSent = 'DROP';
        }
      }
      // אנרגיה נמוכה מתמשכת (<0.30) — DON'T force BREAK (it kills the music)
      // FIX: was forcing BREAK when radio energy is low, which strips all instruments = silence
      // Now: just log it, don't force section change
      else if (sustainedRecent < 0.30 && sustainedOlder < 0.40) {
        // Only force BREAK if energy is EXTREMELY low (radio basically off)
        if (sustainedRecent < 0.05) {
          if (this.cachedUserControls.forcedSection !== 'BREAK') {
            this.compositionWorker.postMessage({ type: 'controls', forcedSection: 'BREAK', bars: 4 });
            console.log(`[PSY4] שלב 3.5 Radio→Worker: force BREAK (radio near-silent energy=${sustainedRecent.toFixed(2)})`);
            forcedSectionSent = 'BREAK';
          }
        }
        // Otherwise: just let the arrangement continue naturally
      }
    }

    // ── בדיקה 2: שיפוע אנרגיה → boost/reduce energy ──
    const SLOPE_THRESHOLD = 0.08;
    if (absSlope < SLOPE_THRESHOLD) return; // יציב — אל תשלח energy (אבל force section כבר נשלח אם צריך)

    // חתימה — שלח רק אם השיפוע השתנה משמעותית מהשליחה האחרונה
    const direction = slope > 0 ? 'rising' : 'falling';
    const sig = `${direction}:${slope.toFixed(2)}:e${recent.toFixed(2)}`;
    if (sig === this._lastSentEnergyFollowSig) return;
    this._lastSentEnergyFollowSig = sig;

    // חשב את ה-energy לשליחה:
    // אם עולה — boost: recent + 0.15 (מעלה layers נוספים)
    // אם יורד — reduce: recent - 0.15 (מוריד layers)
    let targetEnergy: number;
    if (slope > 0) {
      targetEnergy = Math.min(1, recent + 0.15);
    } else {
      targetEnergy = Math.max(0, recent - 0.15);
    }

    this.compositionWorker.postMessage({ type: 'controls', energy: targetEnergy });
    console.log(`[PSY4] שלב 3.5 Radio→Worker: energy FOLLOW ${direction} (slope=${slope.toFixed(2)}, recent=${recent.toFixed(2)}, target=${targetEnergy.toFixed(2)})`);
  }

  // F18.5: Apply learned timbre to synthesis parameters.
  // Called from detect() when timbre profile is available.

  // F18: Check if learning is active (for UI display)
  hasLearnedFromRadio(): boolean { return false; } // MusicalSession REMOVED
  getLearnedPhraseCount(): number { return 0; } // MusicalSession REMOVED

  private updateDelayTime(): void {
    if (this.delay) this.delay.delayTime.value = this.stepDur() * 3;
  }

  // ADAPTIVE QUALITY: Detect device capability
  private detectDeviceQuality(): { tier: 'high' | 'medium' | 'low'; cores: number; memory: number; isMobile: boolean } {
    const nav = navigator as any;
    const cores = nav.hardwareConcurrency || 4;
    const memory = nav.deviceMemory || 4; // GB
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || '');
    const isTouch = nav.maxTouchPoints > 0;

    let tier: 'high' | 'medium' | 'low' = 'high';
    if (isMobile || isTouch || cores <= 2 || memory <= 2) {
      tier = 'low';
    } else if (cores <= 4 || memory <= 4) {
      tier = 'medium';
    }

    return { tier, cores, memory, isMobile };
  }

  // ── AudioWorklet Engine Initialization ──
  private async initWorkletEngine(): Promise<void> {
    if (!this.ctx) return;
    try {
      // ADAPTIVE QUALITY: Detect device capability and adjust settings
      const deviceQuality = this.detectDeviceQuality();
      console.log(`[PSY4] Device quality: ${deviceQuality.tier} (cores: ${deviceQuality.cores}, memory: ${deviceQuality.memory}GB, mobile: ${deviceQuality.isMobile})`);

      this.engineNode = new Psy4EngineNode(this.ctx);
      const ok = await this.engineNode.init();
      if (ok) {
        this.useWorklet = true;  // FIX: enable worklet routing (was never set!)
        // PERF: wire stats callback to monitor audio-thread CPU load.
        this.engineNode.onStats((stats) => {
          this.lastWorkletStats = stats;
          if ((stats.processMs ?? stats.cpuLoad * 10) > 3.0) {
            console.warn(`[PSY4] AUDIO THREAD OVER BUDGET: processMs=${(stats.processMs ?? stats.cpuLoad * 10).toFixed(2)}ms cpuLoad=${(stats.cpuLoad*100).toFixed(0)}% voices=${stats.activeVoices}/${stats.voiceBudget ?? '?'}`);
          }
        });
        // FIX: Connect worklet output directly to destination.
        // The worklet has its OWN master chain (multiband + glue + true-peak).
        // The legacy chain (engineBus → comp → EQ → master → safetyLimiter → analyser)
        // was SUMMING with the worklet output = double signal = clipping.
        // Now: worklet → volumeGain → analyser → destination
        // (volumeGain controls master volume — the worklet's internal master
        // chain is separate and can't be controlled from main thread)
        // v3: Route worklet output through multiband + sidechain + volume to analyser.
        // Multiband uses native BiquadFilterNode (stable, not manual DSP).
        const out = this.engineNode.outputNode;
        if (out && this.analyser) {
          out.disconnect();
          // Create sidechain duck gain (dips when kick plays)
          if (!this.sidechainDuck) {
            this.sidechainDuck = this.ctx.createGain();
            this.sidechainDuck.gain.value = 1.0;
          }
          // Create multiband compressor (3-band: low/mid/high)
          // Uses native BiquadFilterNode for crossover — stable and correct.
          if (!this.multibandLow) {
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
            // Per-band gains (for multiband balance)
            this.multibandLowGain = this.ctx.createGain();
            this.multibandLowGain.gain.value = 1.0;
            this.multibandMidGain = this.ctx.createGain();
            this.multibandMidGain.gain.value = 1.0;
            this.multibandHighGain = this.ctx.createGain();
            this.multibandHighGain.gain.value = 1.0;
            // Sum all bands
            this.multibandSum = this.ctx.createGain();
            this.multibandSum.gain.value = 1.0;
            // Wire: input → 3 parallel paths → sum
            // Low: input → multibandLow → multibandLowGain → sum
            // Mid: input → multibandMid1 → multibandMid2 → multibandMidGain → sum
            // High: input → multibandHigh → multibandHighGain → sum
          }
          // Create a gain node for volume control if not exists
          if (!this.workletVolumeGain) {
            this.workletVolumeGain = this.ctx.createGain();
            this.workletVolumeGain.gain.value = 0.8;  // FIX: was 0.5 — too quiet, now 0.8 with limiter
          }
          // Worklet → sidechainDuck → multiband → workletVolumeGain → analyser
          out.connect(this.sidechainDuck);
          // psysynth (via engineBus) also → sidechainDuck (so it gets ducked too)
          if (this.engineBus) {
            this.engineBus.disconnect();
            this.engineBus.connect(this.sidechainDuck);
          }
          // Effects: delay + reverb returns will be added later (Tone.js integration)
          // For now, just route dry signal through multiband
          // Multiband: sidechainDuck → 3 bands → sum → workletVolumeGain
          this.sidechainDuck!.connect(this.multibandLow!);
          this.sidechainDuck!.connect(this.multibandMid1!);
          this.sidechainDuck!.connect(this.multibandHigh!);
          // Low band
          this.multibandLow!.connect(this.multibandLowGain!);
          this.multibandLowGain!.connect(this.multibandSum!);
          // Mid band (HP then LP)
          this.multibandMid1!.connect(this.multibandMid2!);
          this.multibandMid2!.connect(this.multibandMidGain!);
          this.multibandMidGain!.connect(this.multibandSum!);
          // High band
          this.multibandHigh!.connect(this.multibandHighGain!);
          this.multibandHighGain!.connect(this.multibandSum!);
          // Sum → volume → limiter → analyser
          this.multibandSum!.connect(this.workletVolumeGain!);
          // FIX: Add a DynamicsCompressor as brick-wall limiter (prevents clipping)
          if (!this.masterLimiter) {
            this.masterLimiter = this.ctx.createDynamicsCompressor();
            this.masterLimiter.threshold.value = -1;  // -1dB threshold
            this.masterLimiter.knee.value = 0;        // hard knee
            this.masterLimiter.ratio.value = 20;       // 20:1 ratio (brick-wall)
            this.masterLimiter.attack.value = 0.001;   // 1ms attack
            this.masterLimiter.release.value = 0.05;   // 50ms release
          }
          this.workletVolumeGain.connect(this.masterLimiter);
          this.masterLimiter.connect(this.analyser);
        }
        // FIX: Disconnect the legacy master chain completely.
        // The legacy buses (kickBus, bassBus, etc.) are NOT used by the worklet.
        // The worklet has its own internal buses + master chain.
        // But the legacy chain was still connected: engineBus → comp → EQ → master → safetyLimiter → analyser
        // Even though no audio flows through it, the analyser was connected to BOTH
        // the worklet AND the legacy chain. Disconnect everything legacy.
        if (this.engineBus) this.engineBus.disconnect();
        if (this.comp) this.comp.disconnect();
        if (this.masterEqLow) this.masterEqLow.disconnect();
        if (this.masterEqMid) this.masterEqMid.disconnect();
        if (this.masterEqHigh) this.masterEqHigh.disconnect();
        if (this.master) this.master.disconnect();
        if (this.safetyLimiter) this.safetyLimiter.disconnect();
        // Reconnect analyser to destination (clean path)
        // NOTE: Don't disconnect analyser — it would break the workletVolumeGain → analyser connection.
        // Just connect analyser → destination (duplicate connections are fine in Web Audio).
        this.analyser!.connect(this.ctx.destination);
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
        console.log('[PSY4] AudioWorklet engine active — Moog ladder + PolyBLEP + real samples');
        // שלב 4.2: אתחל את ה-SynthesisMatcher עם ה-engine node שנוצר
        this.synthesisMatcher.init(this.engineNode);
        // שלב 4.4: אתחל את ה-SoundExplorer (משתמש ב-matcher + bank)
        this.soundExplorer = new SoundExplorer(this.synthesisMatcher, this.soundBank);
        // Phase 2.2: SmartExplorer — gradient-based exploration (faster convergence)
        this.smartExplorer = new SmartExplorer(this.synthesisMatcher, this.soundBank);
        // שלב 4.5: אתחל את ה-RewardTracker + QualityAnalyzer
        this.rewardTracker = new RewardTracker(this.soundBank);
        // Phase 2.1: QualityAnalyzer — מודד איכות אודיו ל-reward
        if (this.analyser) {
          const qa = new QualityAnalyzer(this.analyser.fftSize);
          this.rewardTracker.setQualityAnalyzer(qa, this.analyser, null);
          console.log('[PSY4] Phase 2.1: QualityAnalyzer ready (spectral/dynamic/stereo/transient/clarity)');
        }
        // שלב 5.1: אתחל Package exporter/importer
        this.packageExporter = new PackageExporter(this.soundBank);
        this.packageImporter = new PackageImporter(this.soundBank);
        // שלב 5.2: אתחל Synthesis generator
        this.synthesisGenerator = new SynthesisGenerator(this.synthesisMatcher, this.soundBank);
        // שלב 5: אתחל Loop learner
        this.loopLearner = new LoopLearner(this);
      } else {
        console.warn('[PSY4] Worklet init failed — using MaterialRealizer fallback');
        this.realizer?.loadSamples().catch(() => {});
      }
    } catch (e) {
      console.warn('[PSY4] Worklet error:', e, '— using MaterialRealizer fallback');
      this.realizer?.loadSamples().catch(() => {});
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
    if (!this.ctx || !this.transport || !this.workerReady) return;
    // CRITICAL FIX: Don't compose until worklet is also ready
    if (!this.useWorklet || !this.engineNode) return;
    try {
      const now = this.ctx.currentTime;
      const snap = this.transport.snapshot();

      // ADR-001: Send compose request to Web Worker (composition thread)
      // The worker composes 3 bars ahead and returns events as a Float64Array (Transferable, zero-copy)
      // Also push transport to synth bridge if enabled (for tempo-locked LFOs)
      if (this.synthBridge && this.synthDeviceEnabled) {
        this.synthBridge.publishTransport({ bpm: snap.bpm, beat: snap.beat, bar: snap.bar, revision: Math.floor(snap.timestamp * 1000) });
      }
      const currentBar = snap.bar;
      const beatDur = 60 / snap.bpm;
      const targetBar = currentBar + 8;  // FIX: was +5, now +8 for maximum lookahead buffer
      // v2: compose range [lastWorkerComposeBar+1, targetBar+1)
      // barOriginAudioTime = audio time of bar 0 (when transport started)
      // = currentTime - currentBar * barDur
      if (this.lastWorkerComposeBar < targetBar) {
        const barOriginAudioTime = this.ctx.currentTime - currentBar * 4 * beatDur;
        const startBar = this.lastWorkerComposeBar + 1;
        const endBar = targetBar + 1;
        this.compositionWorker?.postMessage({
          type: 'compose',
          startBar,
          endBar,
          barOriginAudioTime,
        });
        this.lastWorkerComposeBar = targetBar;
      }
    } catch (e) {}
  }

  // ADR-001: Handle messages from the composition Web Worker
  private handleWorkerMessage(msg: any): void {
    switch (msg.type) {
      case 'ready':
        this.workerReady = true;
        break;
      case 'events': {
        if (this.useWorklet && this.engineNode && msg.count > 0) {
          const flat = msg.events;
          const EVENT_SIZE = 6;
          // v2 format: [at, voiceId, note, vel, dur, param]
          const now = this.ctx!.currentTime;
          let scheduled = 0;
          for (let i = 0; i < msg.count; i++) {
            const base = i * EVENT_SIZE;
            const at = flat[base];
            const voiceId = flat[base + 1] as VoiceId;
            const note = flat[base + 2];
            const velocity = flat[base + 3];
            const duration = flat[base + 4];
            const param = flat[base + 5];
            // FIX: Don't drop events here — the worklet handles stale events itself.
            // The old "if (at < now - 2.0) continue" was dropping events from bars
            // that were composed ahead but arrived "late" relative to AudioContext time.
            // The worklet's own check (eventTime > currentAudioTime + 0.001) handles this correctly.
            // if (at < now - 2.0) continue;  // REMOVED — was causing intermittent silence
            if (voiceId === VOICE.KICK) {
              this.kickCount++;
              // Sidechain ducking: dip the whole mix when kick plays.
              // Psytrance signature "pumping" effect — bass/lead breathe with kick.
              this.triggerSidechain(at);
            }
            if (voiceId === VOICE.BASS && note > 0) this.bassFreq = mtof(note);

            // v3: Route melodic voices (bass/lead/acid/pad) to psysynth (ALWAYS, not toggle)
            // Drum voices (kick/hat/snare/clap/perc/shaker) go to this worklet.
            const isMelodic = voiceId === VOICE.BASS || voiceId === VOICE.LEAD ||
                              voiceId === VOICE.ACID || voiceId === VOICE.PAD;
            if (isMelodic) {
              // Forward to psysynth (auto-enable if not enabled)
              if (!this.synthDeviceEnabled) {
                this.enableSynthDevice().catch(() => {});
              }
              if (this.synthBridge) {
                this.synthBridge.publishNote(at, voiceId, note, velocity, duration);
              }
            } else {
              // Drum/FX voice — schedule to worklet
              this.engineNode.scheduleEvent(at, voiceId, note, velocity, duration, param);
            }
            scheduled++;
          }
          if (scheduled > 0) {
            this.engineNode.flushEvents();
          }
        }
        break;
      }
      case 'state':
        this.workerState = msg.state;
        this.workerAction = msg.action;
        this.workerActiveVoices = msg.activeVoices;
        break;
    }
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
  }

  // SamplerBridge FULLY REMOVED — was dead code causing confusion and errors
  // (duplicate engineBusInput getter also removed — see line 496 for the canonical one)

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
      // תיקון AbortError: אם יש radioEl קודם, נקה אותו לגמרי לפני יצירת חדש
      if (this.radioSource) { try { this.radioSource.disconnect(); } catch {} this.radioSource = null; }
      if (this.radioEl) {
        // אל נסה pause() כש-play() עדיין רץ — זה גורם AbortError
        // במקום: src='' עוצר את הטעינה, ואז pause() בטוח
        try { this.radioEl.src = ''; } catch {}
        try { this.radioEl.removeAttribute('src'); } catch {}
        try { this.radioEl.load(); } catch {}
        this.radioEl = null;
      }
      this.radioEl = new Audio();
      // CORS חובה — בלי זה ה-analyser מקבל zeros ואי אפשר ללמוד מהרדיו
      this.radioEl.crossOrigin = 'anonymous';
      this.radioEl.src = stream.url;
      this.radioSource = this.ctx.createMediaElementSource(this.radioEl);
      if (!this.radioGain) {
        this.radioGain = this.ctx.createGain();
        this.radioGain.gain.value = 0.15;  // FIX: was 0.5 — too loud, caused clipping when summed with engine
        this.radioAnalyser = this.ctx.createAnalyser();
        this.radioAnalyser.fftSize = 512;
        this.radioAnalyser.smoothingTimeConstant = 0.2;
      }
      // שלב 2.1: רדיו → ערוץ נפרד ישירות ל-destination (לא דרך engineBus)
      this.radioSource.connect(this.radioGain!);
      this.radioGain!.connect(this.radioAnalyser!);
      this.radioAnalyser!.disconnect(); // disconnect from engineBus
      this.radioAnalyser!.connect(this.ctx.destination); // direct to destination

      this.radioLayer!.markConnecting();
      this.syncStatus = 'connecting';

      // תיקון שלב 4: timeout — אם ה-stream לא מתחיל תוך 12 שניות, דווח שגיאה
      const timeoutMs = 12000;
      const startTime = Date.now();
      let timedOut = false;
      let playSettled = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        if (!playSettled) {
          console.error(`[PSY4] Radio connect TIMEOUT after ${timeoutMs}ms — stream may be down or CORS-blocked: ${stream.url}`);
          this.syncStatus = 'error';
          this.emit();
        }
      }, timeoutMs);

      try {
        await this.radioEl.play();
        playSettled = true;
      } catch (playErr: any) {
        playSettled = true;
        // AbortError קורה כש-pause() נקרא באמצע play() — לא קריטי, זה אומר שהחיבור בוטל
        if (playErr && playErr.name === 'AbortError') {
          console.warn('[PSY4] Radio play() aborted (likely reconnect) — ignoring');
          clearTimeout(timeoutId);
          return false;
        }
        if (!timedOut) {
          clearTimeout(timeoutId);
          console.error('[PSY4] Radio play() failed:', playErr, '— stream may not support CORS:', stream.url);
          this.syncStatus = 'error';
          this.radioOn = false;
          this.emit();
          return false;
        }
      }
      if (!timedOut && playSettled) {
        clearTimeout(timeoutId);
        this.radioOn = true;
        this.radioLayer!.markConnected();
        this.updateMixMode();
        this.startDetection();
        // שלב 4.4: התחל exploration אוטומטי — סורק סאונדים מהרדיו ובונה את ה-bank
        this.startAutoExploration();
        this.emit();
        console.log(`[PSY4] Radio connected: ${stream.name} (${stream.url}) — connectTime=${Date.now() - startTime}ms`);
        return true;
      }
      return false;
    } catch (e) {
      console.error('[PSY4] connectRadio error:', e);
      this.syncStatus = 'error';
      this.emit();
      return false;
    }
  }

  disconnectRadio(): void {
    if (this.radioEl) {
      // תיקון AbortError: src='' קודם, ואז load() — לא pause() באמצע play()
      try { this.radioEl.src = ''; } catch {}
      try { this.radioEl.removeAttribute('src'); } catch {}
      try { this.radioEl.load(); } catch {}
      this.radioEl = null;
    }
    if (this.radioSource) { try { this.radioSource.disconnect(); } catch {} this.radioSource = null; }
    // שלב 2.1: נתק גם את ה-radioAnalyser מ-destination
    if (this.radioAnalyser) { try { this.radioAnalyser.disconnect(); } catch {} }
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
    // שלב 4.4: עצור exploration אוטומטי
    this.stopAutoExploration();
    // F13/R1: Reset session on disconnect so learned motifs/style/phrase state
    // don't leak across reconnects.
    // MusicalSession.reset() REMOVED — dead code
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
    // MUSICAL FIX: learnTick + persistTick merged into uiTimer (no separate timers)
    if (!this.uiTimer) this.startUITimer();
  }

  private stopDetection(): void {
    if (this.detectTimer) { clearInterval(this.detectTimer); this.detectTimer = null; }
    // MUSICAL FIX: learnTimer + persistTimer merged into uiTimer. Only clear uiTimer.
    if (this.learningDirty) this.persistTick();
    if (!this.playing) this.stopUITimer();
  }

  /**
   * שלב 4.5: Synthetic occupancy — derived from PSY4's own output when no radio.
   *
   * When radio is off, RewardTracker has no occupancy signal, so reward stays
   * at 0.5 forever. This method measures PSY4's own output via the main
   * analyser and derives occupancy values:
   *   - kick: low-band energy (0-120Hz) normalized
   *   - bass: low-mid energy (120-500Hz) normalized
   *   - lead: mid energy (500-2500Hz) normalized
   *   - hats: high energy (2500Hz+) normalized
   *
   * The values are smoothed so they reflect sustained activity, not transients.
   * This lets the RewardTracker evaluate whether a recipe "worked" — if PSY4
   * keeps playing steadily after applying a recipe, reward goes up.
   */
  private synthOccSmoothed: { kick: number; bass: number; lead: number; hats: number } = { kick: 0, bass: 0, lead: 0, hats: 0 };
  private computeSyntheticOccupancy(): { kick: number; bass: number; lead: number; hats: number } {
    if (!this.analyser || !this.ctx) return this.synthOccSmoothed;
    const fd = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(fd as Uint8Array<ArrayBuffer>);
    const sr = this.ctx.sampleRate;
    const binWidth = sr / this.analyser.fftSize;
    const bandAvg = (loHz: number, hiHz: number): number => {
      const lo = Math.max(0, Math.floor(loHz / binWidth));
      const hi = Math.min(fd.length - 1, Math.ceil(hiHz / binWidth));
      let sum = 0, n = 0;
      for (let i = lo; i <= hi; i++) { sum += fd[i]; n++; }
      return n > 0 ? (sum / n) / 255 : 0;  // normalize 0-1
    };
    // Raw band energies
    const kickRaw = bandAvg(20, 120);
    const bassRaw = bandAvg(120, 500);
    const leadRaw = bandAvg(500, 2500);
    const hatsRaw = bandAvg(2500, 12000);
    // Smooth (exponential moving average) — reflects sustained activity
    const a = 0.3;  // smoothing factor
    this.synthOccSmoothed.kick = this.synthOccSmoothed.kick * (1 - a) + kickRaw * a;
    this.synthOccSmoothed.bass = this.synthOccSmoothed.bass * (1 - a) + bassRaw * a;
    this.synthOccSmoothed.lead = this.synthOccSmoothed.lead * (1 - a) + leadRaw * a;
    this.synthOccSmoothed.hats = this.synthOccSmoothed.hats * (1 - a) + hatsRaw * a;
    return { ...this.synthOccSmoothed };
  }

  // B1 FIX: Extracted engine-level update from detect(). Runs from uiTimer (every 2s)
  // so LUFS meter moves even when radio is off. Previously inside detect() which
  // early-returns at line 1870 when !this.radioAnalyser, leaving engineLevel=0 forever.
  /**
   * Sidechain ducking: dip the master bus when kick plays.
   * Creates the classic psytrance "pumping" effect where bass/lead
   * breathe with the kick. 60% depth, 150ms recovery.
   */
  private triggerSidechain(at: number): void {
    if (!this.sidechainDuck || !this.ctx) return;
    const t = Math.max(at, this.ctx.currentTime);
    // Dip to 0.4 (60% depth) over 5ms, recover to 1.0 over 150ms
    this.sidechainDuck.gain.cancelScheduledValues(t);
    this.sidechainDuck.gain.setValueAtTime(0.6, t);  // FIX: was 0.4 — too aggressive (60% depth is standard)
    this.sidechainDuck.gain.exponentialRampToValueAtTime(1.0, t + 0.15);
  }

  private updateEngineLevel(): void {
    if (!this.analyser) return;
    // Reuse buffer to avoid per-tick allocation
    if (!this.engineFreqBuf || this.engineFreqBuf.length !== this.analyser.frequencyBinCount) {
      this.engineFreqBuf = new Uint8Array(this.analyser.frequencyBinCount);
    }
    const d = this.engineFreqBuf;
    this.analyser.getByteFrequencyData(d as Uint8Array<ArrayBuffer>);
    let s = 0; for (let i = 0; i < d.length; i++) s += d[i];
    this.engineLevel = s / (d.length * 255);
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

    // שלב 3.4: חשב תכונות ספקטרליות (centroid/flatness/rolloff) מתדרי הרדיו
    // משתמש ב-fd שכבר נמשך מה-radioAnalyser — אין עלות נוספת של FFT
    // EMA smoothing (α=0.15) — ממתן רעש נקודתי ושומר על תגובה מהירה
    const spec = extractSpectralFeatures(fd, this.ctx.sampleRate, this.radioAnalyser.fftSize);
    this.radioSpectral = spec;
    this.spectralCentroidEma = this.spectralCentroidEma * 0.85 + spec.centroid * 0.15;
    this.spectralFlatnessEma = this.spectralFlatnessEma * 0.85 + spec.flatness * 0.15;
    this.spectralRolloffEma = this.spectralRolloffEma * 0.85 + spec.rolloff * 0.15;

    // שלב 4.1: Per-onset analysis — זהה onsets וחלץ SoundDNA
    // רץ כל tick (100ms) על אותו tdBuf/fd — אין עלות נוספת של FFT
    const onset = this.onsetAnalyzer.process(
      tdBuf, fd, audioTime, this.ctx.sampleRate, this.radioAnalyser.fftSize,
    );
    if (onset) {
      const centroidHz = (onset.soundDNA.brightness * 8000).toFixed(0);
      const ts = onset.soundDNA.transientSharpness.toFixed(2);
      const sub = onset.soundDNA.subEnergy.toFixed(2);
      const mid = onset.soundDNA.midEnergy.toFixed(2);
      const hi = onset.soundDNA.highEnergy.toFixed(2);
      console.log(
        `[PSY4] שלב 4.1 ONSET t=${audioTime.toFixed(2)} role=${onset.role} ` +
        `strength=${onset.strength.toFixed(2)} centroid=${centroidHz}Hz ` +
        `transient=${ts} sub/mid/hi=${sub}/${mid}/${hi} ` +
        `total=${this.onsetAnalyzer.getTotalOnsets()}`,
      );
    }

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
      // שלב 3.1: תעד timestamp של kick מהרדיו (לחילוץ דפוס 16-step)
      // משתמשים ב-estimatedAt (latency-corrected) ולא ב-observedAt
      if (transportSnap.locked && radioSnap.beat.confidence > 0.4) {
        this.radioKickTimes.push(radioSnap.beat.timestamp.estimatedAt);
        // חותך ל-64 ערכים (~16 תיבות = 26s ב-145 BPM)
        if (this.radioKickTimes.length > 64) this.radioKickTimes.shift();
      }
      // F13/R5: Wire bassFreq from pitch observation for key detection.
      // radioSnap.pitch is produced by RadioObservationLayer's internal
      // MelodyObserver (now that signalState actually transitions).
      if (radioSnap.pitch && radioSnap.pitch.confidence > 0.5) {
        this.bassFreq = radioSnap.pitch.frequency;
        // שלב 3.2: תעד bass freq להיסטוגרמת מרווחים (נפרד מ-bassFreq היחיד)
        this.radioBassFreqs.push(radioSnap.pitch.frequency);
        if (this.radioBassFreqs.length > 48) this.radioBassFreqs.shift();
      }
    }
    // שלב 3.3: תעד lead pitch (melodic band) — נפרד מ-bass
    // רק אם ה-pitch במרחב ה-melodic (>250Hz, לא bass)
    if (radioSnap.pitch && radioSnap.pitch.confidence > 0.5 && radioSnap.pitch.frequency > 250) {
      this.radioLeadPitches.push(radioSnap.pitch.midi);
      if (this.radioLeadPitches.length > 48) this.radioLeadPitches.shift();
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
    // שלב 4.5: עדכן את RewardTracker עם occupancy הנוכחי
    if (this.rewardTracker) {
      if (this.radioOn) {
        // Radio active — use real radio occupancy
        this.rewardTracker.recordOccupancy(this.occupancy);
      } else if (this.playing) {
        // No radio — derive synthetic occupancy from PSY4's own output.
        // This lets the RewardTracker progress (reward entries) even when
        // the user never connects radio. Without this, reward stays at 0.5
        // forever and the "self-improvement" loop never advances.
        const synth = this.computeSyntheticOccupancy();
        this.rewardTracker.recordOccupancy(synth);
      }
    }

    // MUSICAL FIX: session.observeRadioTick REMOVED entirely.
    // Was collecting learning data that nobody reads (only BPM/scale used, and
    // those come from learnTick). This was running extractSpectralFeatures every
    // 500ms for nothing. Saves CPU + removes dead code path.

    // F18.5: applyLearnedTimbre REMOVED — worklet always active, uses learnedVoiceParams

    // Update radio level for UI
    this.radioLevel = radioSnap.signal.spectralEnergy;
    this.radioRms = this.radioRms * 0.85 + radioSnap.signal.rms * 0.15;
    this.radioBands = {
      low: radioSnap.occupancy.kick,
      mid: radioSnap.occupancy.lead,
      high: radioSnap.occupancy.hats,
    };

    // שלב 1.4: הימנעות מהתנגשויות — occupancy-based ducking
    // (הקוד החדש כבר נמצא למעלה ב-detect(), זה הקוד הישן שמוחק)
    // הקוד החדש משתמש בערכים עדינים יותר (0.3 במקום 0.1) ופועל רק כשרדיו מחובר

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
    if (transportSnap.locked && radioSnap.beat) {
      if (this.learningData) {
        this.pendingKickBpms.push(Math.round(transportSnap.bpm));
      }
      this.updateDelayTime();
      this.updateMixMode();
    }

    // ── שלב 1.1: שלח נתוני רדיו ל-CausalComposerWorker ──
    // כל 2 שניות (כל 20 ticks של detect ב-100ms), שלח BPM/סולם/מפתח/energy/סגנון
    this._radioToWorkerCounter = (this._radioToWorkerCounter || 0) + 1;
    if (this._radioToWorkerCounter >= 20) {
      this._radioToWorkerCounter = 0;
      this.sendRadioDataToWorker(radioSnap, transportSnap);
    }

    // ── שלב 1.4 + 2.3: הימנעות מהתנגשויות + השלמת תדרים ──
    if (this.radioOn && this.playing) {
      const now = this.ctx.currentTime;
      // דאקינג דינמי לפי occupancy של הרדיו
      if (this.kickDuck && this.bassDuck && this.leadDuck && this.hatDuck) {
        const kickDuckVal = this.occupancy.kick > 0.7 ? 0.3 : 1.0;
        this.kickDuck.gain.setTargetAtTime(kickDuckVal, now, 0.05);
        const bassDuckVal = this.occupancy.bass > 0.75 ? 0.5 : 1.0;
        this.bassDuck.gain.setTargetAtTime(bassDuckVal, now, 0.08);
        const leadDuckVal = this.occupancy.lead > 0.85 ? 0.5 : 1.0;
        this.leadDuck.gain.setTargetAtTime(leadDuckVal, now, 0.1);
        this.hatDuck.gain.setTargetAtTime(1.0, now, 0.1);
      }
      // שלב 2.3 + 3.4: השלמת תדרים — עדכן synth params לפי תכונות ספקטרליות אמיתיות
      // centroid = בהירות (Hz, 500-5000 אופייני), flatness = רעשיות (0=טונלי, 1=רעש), rolloff = ריכוז אנרגיה
      if (this.engineNode) {
        this._freqBalanceCounter = (this._freqBalanceCounter || 0) + 1;
        if (this._freqBalanceCounter >= 5) { // כל 500ms
          this._freqBalanceCounter = 0;
          // שלב 3.4: מפה EMA-smoothed spectral features → worklet macros
          // דרוש centroid Ema > 100Hz — אחרת אין סיגנל אמיתי ואל תשנה את הקבעי
          if (this.spectralCentroidEma > 100) {
            // brightness: centroid מנורמל ל-0..1 (centroid / 8000 Hz)
            // טווח אופייני: 1000 Hz (חשוך) עד 6000 Hz (בהיר)
            const brightness = Math.max(0, Math.min(1, this.spectralCentroidEma / 8000));
            // darkness: הופכי של brightness (centroid נמוך = חשוך)
            const darkness = 1 - brightness;
            // aggression: flatness גבוהה = רועש/אגרסיבי (white-noise-like), flatness נמוך = טונלי
            // ב-psytrance: lead אגרסיבי מאופיין ב-flatness בינוני-גבוה
            const aggression = Math.max(0, Math.min(1, this.spectralFlatnessEma));
            // energy: משלב spectral energy + occupancy (low+mid+high)
            const radioLow = (this.occupancy.kick + this.occupancy.bass) / 2;
            const radioMid = this.occupancy.lead;
            const spectralEnergy = (spec.low + spec.mid + spec.high) / 3;
            // energy = ממוצע משולב של occupancy ו-spectral energy
            const energy = Math.max(0, Math.min(1, (radioLow * 0.4 + radioMid * 0.3 + spectralEnergy * 0.3)));
            this.engineNode.setMacros({ brightness, darkness, aggression, energy });
          }
        }
      }
    }

    // PERF: buffer bass freq observations too (cheap to push, expensive to process)
    if (this.bassFreq > 0 && this.bassFreq !== this.lastBufferedBassFreq) {
      this.pendingBassFreqs.push(this.bassFreq);
      this.lastBufferedBassFreq = this.bassFreq;
      if (this.pendingBassFreqs.length > 64) this.pendingBassFreqs.shift();
    }

    // B1 FIX: engineLevel update moved to updateEngineLevel() which runs from
    // uiTimer (every 2s) regardless of radio state. Previously this was inside
    // detect() which exits early when radio is off, leaving LUFS stuck at -80.7.
    // PERF: emit() NO LONGER called from detect(). The 2000ms uiTimer handles UI updates.
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
        // תיקון קריטי: עדכן גם את ה-engine node — אחרת הוא מנגן ב-BPM ישן
        if (this.engineNode) this.engineNode.setBPM(detectedBpm);
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
    // MUSICAL FIX: merged learnTick + persistTick + emit into ONE timer at 2000ms.
    // Was 4 separate timers (detect 100ms, learn 1000ms, persist 5000ms, emit 2000ms).
    // Now: detect stays separate (needs 100ms for radio), but learn+persist+emit
    // run in a single 2000ms tick with internal counters.
    this._mergedTickCounter = 0;
    this.uiTimer = setInterval(() => {
      this._mergedTickCounter++;
      // B1 FIX: update engineLevel every tick so LUFS meter moves even when radio is off.
      // Was previously inside detect() which early-returns when radioAnalyser is null.
      this.updateEngineLevel();
      // emit every tick (2000ms)
      this.emit();
      // learnTick every tick (2000ms — was 1000ms, but nothing changes that fast)
      this.learnTick();
      // שלב 4.5: Synthetic occupancy for RewardTracker when no radio.
      // detect() only runs when radio is on, so without radio the RewardTracker
      // never gets occupancy updates and reward stays at 0.5 forever. This feeds
      // synthetic occupancy (derived from PSY4's own output) so reward can progress.
      if (this.rewardTracker && this.playing) {
        const wasSynthetic = !this.radioOn;
        this.rewardTracker.setSyntheticMode(wasSynthetic);
        if (wasSynthetic) {
          const synth = this.computeSyntheticOccupancy();
          this.rewardTracker.recordOccupancy(synth);
        }
      }
      // persistTick every 3rd tick (6000ms — was 5000ms)
      if (this._mergedTickCounter % 3 === 0) {
        this.persistTick();
      }
    }, 2000);
  }
  private _mergedTickCounter = 0;
  private stopUITimer(): void {
    if (this.uiTimer) { clearInterval(this.uiTimer); this.uiTimer = null; }
  }

  // ── Style classifier ──
  // שלב 4.6: משתמש ב-StyleClassifier החדש (מבוסס templates + distance)
  // במקום ה-if-else cascade הפרימיטיבי הישן.
  private classifyStyle(): Style | null {
    const bpm = this.transport ? this.transport.snapshot().bpm : 145;
    const features: StyleFeatures = {
      bpm,
      occupancy: this.occupancy,
      centroid: this.spectralCentroidEma,
      flatness: this.spectralFlatnessEma,
      energy: this.musicState.energy,
      energySlope: this.musicState.energySlope,
    };
    const result = this.styleClassifier.classify(features);
    this.lastClassification = result;
    // מפה RadioStyle → Style הישן (ל-compatibility עם UI)
    const styleMap: Record<RadioStyle, Style> = {
      fullOn: 'fullOn',
      dark: 'dark',
      progressive: 'progressive',
      acid: 'acid',
      forest: 'fullOn',   // forest → fullOn (אין 'forest' ב-Style הישן)
      hiTech: 'fullOn',   // hiTech → fullOn
      unknown: 'fullOn',  // unknown → fullOn (default)
    };
    // לוג רק כש-style משתנה
    if (result.style !== this._lastLoggedStyle) {
      console.log(
        `[PSY4] שלב 4.6 StyleClassifier: style=${result.style} ` +
        `confidence=${result.confidence.toFixed(2)} distance=${result.distance.toFixed(2)} ` +
        `sourceStyle=${this.styleClassifier.getSourceStyleForBank()}`,
      );
      this._lastLoggedStyle = result.style;
    }
    return styleMap[result.style];
  }
  private _lastLoggedStyle: string = 'unknown';

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
      // MusicalSession state REMOVED — all defaults (dead code was 1403 lines)
      sessionStyle: 'FULL_ON',
      sessionRole: 'LEAD',
      sessionAction: 'introduce',
      sessionSection: 'UNKNOWN',
      sessionPhrase: 0,
      sessionTension: 0,
      sessionDensity: 0,
      sessionMotifCount: 0,
      sessionReason: '',
      sessionHasLearned: false,
      sessionLastReward: 0,
      // Learning state (MusicalSession REMOVED — all false)
      learnedFromRadio: false,
      learnedPhraseCount: 0,
      hasBassGrammar: false,
      hasRhythmGrammar: false,
      hasMelodicGrammar: false,
      hasTimbreProfile: false,
    };
  }

  // F1.18: Public Transport accessor (for integration tests)
  getTransport() { return this.transport; }

  // ── שלב 4.2: Synthesis matching (public API) ──

  /**
   * מאתחל את ה-SynthesisMatcher (מחבר ל-engine node הקיים).
   * חייב להיקרא אחרי שה-engine נוצר (startEngine).
   */
  initSynthesisMatcher(): void {
    if (!this.engineNode) {
      console.warn('[PSY4] שלב 4.2 initSynthesisMatcher: engineNode not ready');
      return;
    }
    this.synthesisMatcher.init(this.engineNode);
  }

  /**
   * מוצא recipe אופטימלי שמייצר סאונד דומה ל-onset האחרון של role.
   * רץ מחוץ ל-audio thread — לא חוסם את ה-engine.
   * אם matchScore > 0.7, שומר אוטומטית ל-sound bank.
   * מחזיר null אם אין onsets מתועדים ל-role.
   */
  async matchSound(role: OnsetRole): Promise<MatchResult | null> {
    const onset = this.onsetAnalyzer.getLatestOnset(role);
    if (!onset) {
      console.warn(`[PSY4] שלב 4.2 matchSound(${role}): no onsets recorded for this role`);
      return null;
    }
    const result = await this.synthesisMatcher.match(onset.soundDNA, role);
    // שלב 4.3: auto-save ל-sound bank אם matchScore > threshold
    if (result.matchScore >= PsyLive.MATCH_SAVE_THRESHOLD) {
      try {
        // חלץ את ה-voiceParams מ-recipe (ה-buildRecipe שומר אותם בשדות ה-SynthRecipe)
        const voiceParams: Record<string, number> = {};
        const r = result.recipe as any;
        if (r.subLevel !== undefined) voiceParams.subLevel = r.subLevel;
        if (r.bodyLevel !== undefined) voiceParams.subLevel = r.bodyLevel;
        if (r.harmonicLevel !== undefined) voiceParams.harmonicLevel = r.harmonicLevel;
        if (r.saturationAmount !== undefined) voiceParams.saturation = r.saturationAmount;
        if (r.filterCutoff !== undefined) voiceParams.cutoffStart = r.filterCutoff;
        if (r.decayTime !== undefined) voiceParams.subDecay = r.decayTime;
        // שלב 4.6: השתמש ב-sourceStyle מה-classifier (מזהה סגנון + unknown)
        const sourceStyle = this.styleClassifier.getSourceStyleForBank();
        await this.soundBank.add(
          role,
          onset.soundDNA,
          result.recipe,
          result.matchScore,
          sourceStyle,
          voiceParams,
        );
      } catch (e) {
        console.warn('[PSY4] שלב 4.3 auto-save failed:', e);
      }
    }
    return result;
  }

  /**
   * גישה ישירה ל-sound bank (ל-UI / debugging / 4.4 integration).
   */
  getSoundBank(): SoundBank { return this.soundBank; }

  /**
   * גישה ל-onset analyzer (ל-UI).
   */
  getOnsetAnalyzer(): OnsetAnalyzer { return this.onsetAnalyzer; }

  /**
   * סטטיסטיקות sound bank — { kick: N, bass: N, ... }
   */
  async getSoundBankStats(): Promise<Record<OnsetRole, number>> {
    return await this.soundBank.getStats();
  }

  // ── שלב 4.4: Auto-exploration + recipe application ──

  /**
   * מתחיל exploration אוטומטי — כל EXPLORATION_INTERVAL_MS, סורק role פעיל.
   * עובר round-robin על kick/bass/lead/perc (hat לא אופטימיזבילי).
   * לוקח את ה-onset האחרון של אותו role כיעד, וסורק 81 קאנדידטים.
   * שומר את 5 הטובים ביותר ל-bank.
   * אחרי כל סריקה, מחיל את ה-recipe הטוב ביותר מה-bank על ה-engine.
   */
  private startAutoExploration(): void {
    if (this.explorationTimer) clearInterval(this.explorationTimer);
    // תיקון P1: נקה timeout קודם אם קיים
    if (this._explorationTimeout) clearTimeout(this._explorationTimeout);
    // שלב 5: התחל מהר (3s) וכל 8s — מהיר יותר כדי שכל role (10) יקבל cycle תוך 80s
    this._explorationTimeout = setTimeout(() => this.runExplorationCycle(), 3000);
    this.explorationTimer = setInterval(() => {
      this.runExplorationCycle();
    }, 8000);
    this.evictionTimer = setInterval(() => {
      this.runPeriodicEviction();
    }, 60000);
    console.log('[PSY4] שלב 4.4 Auto-exploration started (interval=8s, first run in 3s)');
  }

  private stopAutoExploration(): void {
    if (this.explorationTimer) {
      clearInterval(this.explorationTimer);
      this.explorationTimer = null;
    }
    // תיקון P1: נקה את ה-timeout הראשוני
    if (this._explorationTimeout) {
      clearTimeout(this._explorationTimeout);
      this._explorationTimeout = null;
    }
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
    console.log('[PSY4] שלב 4.4 Auto-exploration stopped');
  }

  /**
   * שלב 4.5: Eviction תקופתי — כל 60s, נקה entries חלשים.
   * - entries עם reward < 0.2 ו-usageCount > 3 → evict (לא יעיל)
   * - אם ל-role אין אף entry עם reward > 0.4 אחרי 3 מחזורים → נקה והתחל מחדש
   */
  private async runPeriodicEviction(): Promise<void> {
    const roles: OnsetRole[] = ['kick', 'bass', 'lead', 'hat', 'perc', 'pad', 'acid', 'clap', 'shaker', 'texture'];
    let totalEvicted = 0;
    for (const role of roles) {
      const all = await this.soundBank.all(role);
      if (all.length === 0) continue;
      // Phase 9.5: Improved eviction — 3 strategies:
      // 1. Weak entries: reward < 0.3 AND usageCount > 3 (tried but not good)
      const weak = all.filter(e => e.reward < 0.3 && e.usageCount > 3);
      for (const entry of weak) {
        await this.soundBank.delete(entry.id);
        totalEvicted++;
      }
      // 2. Near-duplicates: same fund (±2Hz) — keep only the highest reward
      const remaining = all.filter(e => !weak.includes(e));
      const seen = new Map<number, string>();  // fund → best entry id
      for (const entry of remaining) {
        const fund = Math.round((entry.voiceParams?.fund ?? entry.voiceParams?.cutoffStart ?? 0) / 5) * 5;
        const existing = seen.get(fund);
        if (existing) {
          const existingEntry = remaining.find(e => e.id === existing);
          if (existingEntry && entry.reward < existingEntry.reward) {
            await this.soundBank.delete(entry.id);
            totalEvicted++;
          }
        } else {
          seen.set(fund, entry.id);
        }
      }
      // 3. All weak → clear for re-exploration
      const stillRemaining = await this.soundBank.all(role);
      const allWeak = stillRemaining.every(e => e.reward < 0.3);
      if (allWeak && stillRemaining.length > 0) {
        console.log(`[PSY4] Phase 9.5 Eviction: all ${role} entries weak — clearing for re-exploration`);
        await this.soundBank.clearRole(role);
        totalEvicted += stillRemaining.length;
      }
    }
    if (totalEvicted > 0) {
      console.log(`[PSY4] Phase 9.5 Eviction: removed ${totalEvicted} weak/duplicate entries`);
    }
  }

  /**
   * מחזור סריקה אחד: סרוק role אחד, שמור ל-bank, החל recipe על engine.
   * שלב 4.5: אם ל-role אין אף entry עם reward > 0.5 אחרי 3 מחזורים → הרץ exploration נוסף.
   */
  private async runExplorationCycle(): Promise<void> {
    if (!this.soundExplorer) return;
    // בחר role round-robin
    const roles: OnsetRole[] = ['kick', 'bass', 'lead', 'hat', 'perc', 'pad', 'acid', 'clap', 'shaker', 'texture'];
    const role = roles[this.nextExploreRoleIdx % roles.length];
    // קדם ל-role הבא
    this.nextExploreRoleIdx = (this.nextExploreRoleIdx + 1) % roles.length;
    this.nextExploreRole = roles[this.nextExploreRoleIdx];

    // קבל את ה-onset האחרון ל-role — אם אין, צור synthetic target DNA
    let onset = this.onsetAnalyzer.getLatestOnset(role);
    let targetDNA;
    if (onset) {
      targetDNA = onset.soundDNA;
    } else if (this.currentReference) {
      // Phase 4.2: Reference-guided target DNA — use the reference's spectral
      // characteristics to build a per-role target. This makes the explorer
      // try to match the reference's sound instead of random targets.
      targetDNA = this.buildReferenceTargetDNA(role, this.currentReference);
      console.log(`[PSY4] Phase 4.2: Exploration using reference-guided target for ${role}`);
    } else {
      // אין onsets ואין reference — צור synthetic target DNA אקראית
      targetDNA = {
        role: 'fx' as const,
        brightness: Math.random(),
        harmonicity: Math.random(),
        noisiness: Math.random(),
        spectralSlope: -0.5,
        roughness: Math.random() * 0.3,
        subEnergy: 0.3 + Math.random() * 0.5,
        bodyEnergy: 0.3 + Math.random() * 0.4,
        midEnergy: 0.2 + Math.random() * 0.5,
        highEnergy: 0.1 + Math.random() * 0.4,
        transientSharpness: 0.5 + Math.random() * 0.4,
        attackTime: 0.005,
        decayTime: 0.15 + Math.random() * 0.15,
        sustainLevel: 0.2,
        releaseTime: 0.1,
        saturation: 0.3 + Math.random() * 0.4,
        distortionCharacter: 0.3,
        filterCutoff: 0, filterResonance: 0, filterType: 'lowpass' as const, filterEnvelopeAmount: 0.3,
        pitchModulation: 0, fmAmount: 0, detune: 0, stereoWidth: 0, stereoMotion: 0,
        confidence: 0.5, usageCount: 0, reward: 0.5, sourceStyle: '', sourceContext: '',
      };
      console.log(`[PSY4] שלב 4.4 Exploration: no onsets for ${role}, using synthetic target`);
    }

    try {
      // שלב 4.6: השתמש ב-sourceStyle מה-classifier (מזהה סגנון + unknown)
      const sourceStyle = this.styleClassifier.getSourceStyleForBank();
      // Phase 2.2: 50% chance to use SmartExplorer (gradient-based) instead of grid
      if (this.smartExplorer && Math.random() < 0.5) {
        const ROLE_TO_VOICE_SMART: Record<string, string> = {
          kick: 'KickVoice', bass: 'BassVoice', lead: 'LeadVoice', hat: 'HatVoice',
          perc: 'PercVoice', pad: 'PadVoice', acid: 'AcidVoice', clap: 'ClapVoice',
          shaker: 'ShakerVoice', texture: 'TextureVoice',
        };
        const SCAN_PARAMS_SMART: Record<string, { name: string; values: number[] }[]> = {
          kick: [
            { name: 'fund', values: [38, 48, 58, 68] },
            { name: 'saturation', values: [1.0, 1.5, 2.0] },
            { name: 'bodyLevel', values: [0.3, 0.6] },
            { name: 'tailLevel', values: [0.2, 0.5] },
          ],
          bass: [
            { name: 'subLevel', values: [0.3, 0.4, 0.5, 0.6] },
            { name: 'cutoffStart', values: [400, 700, 1000, 1500] },
            { name: 'cutoffEnd', values: [100, 200, 300, 400] },
          ],
          lead: [{ name: 'freq', values: [220, 330, 440, 660, 880] }],
          hat: [{ name: 'hatDecay', values: [0.02, 0.04, 0.06, 0.08] }],
          perc: [{ name: 'freq', values: [120, 200, 300, 400] }],
          pad: [{ name: 'padCutoff', values: [400, 600, 800, 1000] }],
          acid: [{ name: 'acidCutoff', values: [1000, 1500, 2000, 2500] }],
          clap: [{ name: 'clapDecay', values: [0.03, 0.05, 0.07, 0.09] }],
          shaker: [{ name: 'shakerDecay', values: [0.04, 0.06, 0.08, 0.10] }],
          texture: [{ name: 'textureType', values: [0, 1] }],
        };
        await this.smartExplorer.explore(
          role, targetDNA, sourceStyle,
          ROLE_TO_VOICE_SMART, SCAN_PARAMS_SMART[role] || [],
        );
      } else {
        const result = await this.soundExplorer.explore(role, targetDNA, sourceStyle);
      }
      // אחרי ה-exploration, החל את ה-recipe הטוב ביותר מה-bank על ה-engine
      await this.applyBestRecipeFromBank(role);
      // שלב 5: שמור זיכרון אחרי כל cycle — המנוע יתחיל מכאן בפעם הבאה
      await this.persistLearnedParamsToMemory();
      // שלב 4.5: בדוק אם ה-bank ל-role stale (כל ה-entries עם reward < 0.5)
      const all = await this.soundBank.all(role);
      const hasStrong = all.some(e => e.reward > 0.5);
      if (!hasStrong && all.length > 0) {
        console.log(`[PSY4] שלב 4.5 ${role} bank stale (no entry with reward > 0.5) — will re-explore next cycle`);
      }
    } catch (e) {
      console.warn('[PSY4] שלב 4.4 Exploration failed:', e);
    }
  }

  /**
   * מושך את ה-recipe הטוב ביותר מה-bank ל-role ומחיל על ה-engine.
   * נקרא אחרי כל מחזור exploration.
   *
   * תיקון: מחליף את ה-params רק אם ה-entry הגיע ל-reward > 0.7 (proven).
   * אחרת, שומר את ה-params שנטענו מ-localStorage (user-saved).
   * זה מונע מה-bank לדרוס הגדרות שהמשתמש/למידה שמרה.
   */
  async applyBestRecipeFromBank(role: OnsetRole): Promise<boolean> {
    if (!this.engineNode) return false;
    // שלב 4.6: השתמש ב-sourceStyle מה-classifier (מזהה סגנון + unknown)
    const sourceStyle = this.styleClassifier.getSourceStyleForBank();
    const entry = await this.soundBank.get(role, { style: sourceStyle });
    if (!entry) {
      console.log(`[PSY4] שלב 4.4 applyRecipe(${role}): no entry in bank`);
      return false;
    }
    // תמיד החל את ה-entry שנבחר על ה-engine.
    // ה-epsilon-greedy ב-soundBank.get() כבר דואג לגיוון (20% random).
    // בלי זה, ה-bank הוא dead code — entries נוצרים אבל אף פעם לא מוחלים.
    const voiceClass = role === 'kick' ? 'KickVoice'
      : role === 'bass' ? 'BassVoice'
      : role === 'lead' ? 'LeadVoice'
      : role === 'hat' ? 'HatVoice'
      : role === 'perc' ? 'PercVoice'
      : role === 'pad' ? 'PadVoice'
      : role === 'acid' ? 'AcidVoice'
      : role === 'clap' ? 'ClapVoice'
      : role === 'shaker' ? 'ShakerVoice'
      : 'TextureVoice';

    // v3: Apply learned params to the right engine.
    // - Melodic roles (bass/lead/acid/pad) → psysynth via CC params
    // - Drum roles (kick/hat/perc/clap/shaker) → worklet (no-op in v3, drums are fixed synth)
    const isMelodic = role === 'bass' || role === 'lead' || role === 'acid' || role === 'pad';
    if (isMelodic && this.synthBridge && this.synthDeviceEnabled && entry.voiceParams) {
      // FIX: Map learned params to psysynth CC correctly
      // CC74 = cutoff (0..1), CC71 = resonance (0..1), CC5 = glide (0..1)
      const params = entry.voiceParams;
      // Bass params: cutoffStart (200-2000Hz) → CC74 (0.025-0.25)
      // Lead params: freq (220-880Hz) → CC74 (0.027-0.11)
      // Pad params: cutoffStart → CC74
      if (params.cutoffStart !== undefined) {
        const ccValue = Math.max(0.05, Math.min(0.8, params.cutoffStart / 8000));
        this.synthBridge.setParameterByCC(74, ccValue);
      }
      if (params.freq !== undefined) {
        // Lead freq → CC74 (map 220-880 to 0.1-0.4)
        const ccValue = Math.max(0.1, Math.min(0.5, params.freq / 2000));
        this.synthBridge.setParameterByCC(74, ccValue);
      }
      if (params.resonance !== undefined) {
        this.synthBridge.setParameterByCC(71, Math.max(0, Math.min(1, params.resonance / 20)));
      }
      // Glide: only if explicitly set
      if (params.glide !== undefined) {
        this.synthBridge.setParameterByCC(5, Math.max(0, Math.min(1, params.glide)));
      }
      console.log(`[PSY4] learning → psysynth: ${role} params applied`);
    }
    // ALSO: Apply drum params to the worklet (was ignored before!)
    this.engineNode!.workletNode!.port.postMessage({
      type: 'setVoiceRecipe',
      voiceClass,
      recipe: entry.voiceParams,
    });
    // עדכן usageCount
    await this.soundBank.updateReward(entry.id, 0, true);
    // שלב 4.5: התחל מעקב reward
    if (this.rewardTracker) {
      const startOcc = this.radioOn ? this.occupancy : this.computeSyntheticOccupancy();
      this.rewardTracker.startTracking(entry.id, role, startOcc);
    }
    const paramsStr = entry.voiceParams ? JSON.stringify(entry.voiceParams).slice(0, 80) : '{}';
    console.log(`[PSY4] שלב 4.4 applyRecipe(${role}): applied entry ${entry.id} (matchScore=${entry.matchScore.toFixed(3)}, reward=${entry.reward.toFixed(3)}, params=${paramsStr})`);
    return true;
  }

  /**
   * החל recipes מה-bank על כל ה-roles הפעילים (קריאה ידנית).
   */
  async applyAllRecipesFromBank(): Promise<void> {
    const roles: OnsetRole[] = ['kick', 'bass', 'lead', 'hat', 'perc', 'pad', 'acid', 'clap', 'shaker', 'texture'];
    for (const role of roles) {
      await this.applyBestRecipeFromBank(role);
    }
  }

  // ── שלב 5: MEMORY — זיכרון בין סשנים ──
  // המנוע חייב לזכור מה למד בפעם הקודמת ולהתחיל משם, לא מאפס.

  private static readonly MEMORY_KEY_PARAMS = 'psy4-learned-params';
  private static readonly MEMORY_KEY_BPM = 'psy4-learned-bpm';

  /**
   * שומר את ה-learned params ל-localStorage (נקרא אחרי כל עדכון).
   */
  private saveLearnedParamsToMemory(params: Record<string, Record<string, number>>): void {
    try {
      localStorage.setItem(PsyLive.MEMORY_KEY_PARAMS, JSON.stringify(params));
      console.log('[PSY4] שלב 5 MEMORY: saved learned params to localStorage');
    } catch (e) {
      console.warn('[PSY4] MEMORY save failed:', e);
    }
  }

  /**
   * טוען את ה-learned params מ-localStorage ושולח ל-engine.
   * נקרא מיד ב-play() — המנוע מתחיל עם מה שלמד בפעם הקודמת.
   */
  private loadLearnedParamsFromMemory(): void {
    try {
      const json = localStorage.getItem(PsyLive.MEMORY_KEY_PARAMS);
      if (!json) {
        console.log('[PSY4] שלב 5 MEMORY: no saved params — starting fresh');
        return;
      }
      const params = JSON.parse(json) as Record<string, Record<string, number>>;
      if (!this.engineNode) return;
      // שלח כל voiceClass ל-engine
      for (const [voiceClass, recipe] of Object.entries(params)) {
        this.engineNode!.workletNode!.port.postMessage({
          type: 'setVoiceRecipe',
          voiceClass,
          recipe,
        });
      }
      console.log('[PSY4] שלב 5 MEMORY: loaded learned params from localStorage:', Object.keys(params).join(', '));
    } catch (e) {
      console.warn('[PSY4] MEMORY load failed:', e);
    }
  }

  /**
   * תיקון קריטי: אם אין params שמורים, צור defaults אקראיים.
   * זה מבטיח שהמנוע לעולם לא מנגן את אותו הסאונד פעמיים.
   * ה-params נשמרים ל-localStorage כדי שהפעם הבאה יהיה המשכיות.
   *
   * תיקון נוסף: אם יש params שמורים אבל חסרים voice classes חדשים
   * (למשל RiserVoice/ImpactVoice/SweepVoice שנוספו אחרי השמירה הראשונה),
   * נוסיף רק את החסרים — לא נדרוס את מה שכבר נשמר.
   */
  private ensureDefaultLearnedParams(): void {
    if (!this.engineNode) return;
    const defaults = PsyLive.generateDefaultLearnedParams();
    const json = localStorage.getItem(PsyLive.MEMORY_KEY_PARAMS);
    let existing: Record<string, Record<string, number>> = {};
    if (json) {
      try { existing = JSON.parse(json); } catch {}
    }

    // מצא voice classes חסרים
    const missing: string[] = [];
    const toAdd: Record<string, Record<string, number>> = {};
    for (const [voiceClass, recipe] of Object.entries(defaults)) {
      if (!existing[voiceClass]) {
        missing.push(voiceClass);
        toAdd[voiceClass] = recipe;
      }
    }

    if (missing.length === 0 && json) return; // הכל קיים — שום דבר לעשות

    // שלח ל-engine רק את החסרים (או את כולם אם אין כלום שמור)
    const toSend = json ? toAdd : defaults;
    for (const [voiceClass, recipe] of Object.entries(toSend)) {
      this.engineNode!.workletNode!.port.postMessage({
        type: 'setVoiceRecipe',
        voiceClass,
        recipe,
      });
    }

    // שמור ל-localStorage — merge עם קיים
    const merged = { ...existing, ...toSend };
    this.saveLearnedParamsToMemory(merged);
    if (json && missing.length > 0) {
      console.log(`[PSY4] הוספת voice classes חסרים ל-localStorage: ${missing.join(', ')}`);
    } else if (!json) {
      console.log('[PSY4] יצירת params אקראיים ראשוניים (no saved params):', JSON.stringify(defaults).slice(0, 100));
    }
  }

  /**
   * יוצר פרמטרים אקראיים דרמטיים לכל ה-voice classes.
   * טווחים רחבים לשינוי ברור בין סשנים.
   */
  private static generateDefaultLearnedParams(): Record<string, Record<string, number>> {
    return {
      KickVoice: {
        fund: 35 + Math.floor(Math.random() * 35),   // 35-70
        startMult: 1.5 + Math.random() * 4.0,        // 1.5-5.5
        subDecay: 0.05 + Math.random() * 0.30,       // 0.05-0.35
        saturation: 0.8 + Math.random() * 2.0,       // 0.8-2.8
        pitchDecay: 0.010 + Math.random() * 0.035,   // 0.010-0.045
        midLevel: 0.2 + Math.random() * 0.6,         // 0.2-0.8
        clickLevel: 0.2 + Math.random() * 0.6,       // 0.2-0.8
        waveType: Math.floor(Math.random() * 4),      // 0-3 (sine/tri/sq/saw)
      },
      BassVoice: {
        subLevel: 0.25 + Math.random() * 0.45,       // 0.25-0.70
        cutoffStart: 200 + Math.floor(Math.random() * 2000), // 200-2200
        cutoffEnd: 80 + Math.floor(Math.random() * 400),     // 80-480
        cutoffDecay: 0.015 + Math.random() * 0.08,   // 0.015-0.095
        harmonicLevel: 0.3 + Math.random() * 0.5,    // 0.3-0.8
      },
      LeadVoice: {
        cutoff: 1500 + Math.floor(Math.random() * 4000), // 1500-5500
        detune: 3 + Math.floor(Math.random() * 25),      // 3-28
      },
      HatVoice: {
        hatDecay: 0.015 + Math.random() * 0.08,      // 0.015-0.095
        hatDecayOpen: 0.08 + Math.random() * 0.25,   // 0.08-0.33
        hatBrightness: 0.3 + Math.random() * 2.5,    // 0.3-2.8
      },
      ClapVoice: {
        clapDecay: 0.015 + Math.random() * 0.08,     // 0.015-0.095
      },
      PercVoice: {
        freq: 120 + Math.floor(Math.random() * 300),  // 120-420
      },
      PadVoice: {
        padCutoff: 300 + Math.floor(Math.random() * 800),  // 300-1100
        padAttack: 0.1 + Math.random() * 0.5,               // 0.1-0.6
        padDetune: 3 + Math.floor(Math.random() * 10),       // 3-13
        padEvolveRate: 0.2 + Math.random() * 0.8,            // 0.2-1.0
      },
      AcidVoice: {
        acidCutoff: 800 + Math.floor(Math.random() * 2000),  // 800-2800
        acidResonance: 0.5 + Math.random() * 0.4,             // 0.5-0.9
      },
      ShakerVoice: {
        shakerDecay: 0.03 + Math.random() * 0.08,             // 0.03-0.11
      },
      TextureVoice: {
        textureType: Math.floor(Math.random() * 2),            // 0=noise, 1=fm
      },
      RiserVoice: {
        riserStartCutoff: 80 + Math.floor(Math.random() * 120),     // 80-200
        riserEndCutoff: 6000 + Math.floor(Math.random() * 8000),    // 6000-14000
        riserResonance: 0.2 + Math.random() * 0.6,                   // 0.2-0.8
        riserDrive: 1.0 + Math.random() * 3.0,                       // 1.0-4.0
      },
      ImpactVoice: {
        impactSubFreq: 100 + Math.floor(Math.random() * 150),        // 100-250
        impactSubDecay: 0.06 + Math.random() * 0.16,                 // 0.06-0.22
        impactNoiseDecay: 0.02 + Math.random() * 0.06,               // 0.02-0.08
      },
      SweepVoice: {
        sweepStartCutoff: 4000 + Math.floor(Math.random() * 6000),   // 4000-10000
        sweepEndCutoff: 200 + Math.floor(Math.random() * 800),        // 200-1000
        sweepResonance: 0.2 + Math.random() * 0.6,                    // 0.2-0.8
        sweepDrive: 1.0 + Math.random() * 2.5,                        // 1.0-3.5
      },
      WavetableVoice: {
        morphPos: Math.random(),           // 0-1 (sine to saw mix)
        morphRate: 0.2 + Math.random() * 1.0,  // 0.2-1.2 Hz morph speed
      },
    };
  }

  /**
   * שומר BPM ל-localStorage.
   */
  private saveMemoryBpm(bpm: number): void {
    try {
      localStorage.setItem(PsyLive.MEMORY_KEY_BPM, String(bpm));
    } catch {}
  }

  /**
   * טוען BPM מ-localStorage (או 145 אם אין).
   */
  private loadMemoryBpm(): number {
    try {
      const v = localStorage.getItem(PsyLive.MEMORY_KEY_BPM);
      if (v) {
        const bpm = parseFloat(v);
        if (bpm > 60 && bpm < 200) {
          console.log(`[PSY4] שלב 5 MEMORY: loaded BPM ${bpm} from localStorage`);
          return bpm;
        }
      }
    } catch {}
    return 145;
  }

  /**
   * שומר את ה-learned params הנוכחיים מה-engine ל-localStorage.
   * נקרא אחרי כל exploration cycle.
   */
  async persistLearnedParamsToMemory(): Promise<void> {
    if (!this.engineNode) return;
    try {
      const params = await new Promise<Record<string, Record<string, number>>>((resolve) => {
        const handler = (e: MessageEvent) => {
          if (e.data.type === 'debugResult' && e.data.query === 'learnedVoiceParams') {
            this.engineNode!.workletNode!.port.removeEventListener('message', handler);
            resolve(e.data.data || {});
          }
        };
        this.engineNode!.workletNode!.port.addEventListener('message', handler);
        this.engineNode!.workletNode!.port.postMessage({ type: 'debug', query: 'learnedVoiceParams' });
        // Timeout 2s
        setTimeout(() => {
          this.engineNode!.workletNode!.port.removeEventListener('message', handler);
          resolve({});
        }, 2000);
      });
      if (Object.keys(params).length > 0) {
        this.saveLearnedParamsToMemory(params);
      }
    } catch (e) {
      console.warn('[PSY4] persistLearnedParams failed:', e);
    }
  }

  // ── שלב 5.1: Package export/import ──

  /**
   * מייצא חבילת סאונד מלאה (JSON) ומוריד אותה.
   */
  async exportSoundPackage(): Promise<void> {
    if (!this.packageExporter) {
      console.warn('[PSY4] שלב 5.1 exportSoundPackage: exporter not ready');
      return;
    }
    const detectedStyles = this.lastClassification
      ? [this.lastClassification.style]
      : ['unknown'];
    const sourceStations = this.radioOn ? ['radio'] : [];
    const insights: PackageInsights = {
      bpm: this.transport ? this.transport.snapshot().bpm : 145,
      bpmConfidence: this.transport ? this.transport.snapshot().confidence : 0,
      rootPc: this.cachedInsights?.scale?.root ?? 0,
      scaleName: this.cachedInsights?.scale?.name ?? 'unknown',
      scaleMatchScore: this.cachedInsights?.scale?.matchScore ?? 0,
    };
    const patterns = this.collectPatternsForPackage();
    await this.packageExporter.download(detectedStyles, sourceStations, insights, patterns);
  }

  // ── Phase 10.1: MIDI Export ──
  /**
   * מייצא את ה-patterns הנוכחיים כקובץ MIDI.
   * יוצא MIDI format 0 עם kick + bass + lead patterns.
   * FIX B6: rootPc was `this.opts?.rootPc ?? 0` but `opts` was never declared on
   * the class (only ignoreBuildErrors: true masked this). Now reads from
   * cachedInsights (set by learnTick from radio/scale detection), fallback 0.
   */
  exportMIDI(): void {
    if (!this.transport) {
      console.warn('[PSY4] Transport not ready for MIDI export');
      return;
    }
    // v3: Export REAL composition (not hardcoded 4 bars).
    // Request the worker to compose 8 bars, then convert events to MIDI.
    if (!this.compositionWorker || !this.workerReady) {
      console.warn('[PSY4] Composition worker not ready for MIDI export');
      return;
    }
    const snap = this.transport.snapshot();
    const bpm = snap.bpm;
    const rootPc = this.cachedInsights?.scale?.root ?? 0;

    // Request 8 bars from worker (async — we'll build MIDI when response arrives)
    const barOriginAudioTime = 0;  // bar 0 = time 0
    const startBar = 0;
    const endBar = 8;
    // One-shot handler for this specific compose response
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type !== 'events' || msg.startBar !== startBar) return;
      this.compositionWorker?.removeEventListener('message', handler);
      this.buildMIDIFromEvents(msg.events, msg.count, bpm, rootPc);
    };
    this.compositionWorker.addEventListener('message', handler);
    this.compositionWorker.postMessage({
      type: 'compose',
      startBar,
      endBar,
      barOriginAudioTime,
    });
  }

  /**
   * Build a MIDI file (format 0) from composition events.
   * Events: Float64Array [at, voiceId, note, vel, dur, param] × count
   */
  private buildMIDIFromEvents(flat: Float64Array, count: number, bpm: number, rootPc: number): void {
    const ticksPerQuarter = 480;
    const tempo = Math.round(60000000 / bpm);
    const tickDur = ticksPerQuarter / 4;  // 16th note ticks

    // MIDI channels per voice type (drums on ch 9, melodic on 0-3)
    const channelFor = (voiceId: number): number => {
      switch (voiceId) {
        case 0: return 9;   // kick → drums
        case 5: case 6: return 9;  // hats → drums
        case 7: return 9;   // clap → drums
        case 8: return 9;   // perc → drums
        case 9: return 9;   // shaker → drums
        case 14: return 9;  // snare → drums
        case 11: case 12: case 13: return 9; // FX → drums
        case 1: return 0;   // bass → ch 0
        case 2: return 1;   // lead → ch 1
        case 3: return 2;   // acid → ch 2
        case 4: return 3;   // pad → ch 3
        default: return 0;
      }
    };

    const events: { tick: number; data: number[] }[] = [];
    // Tempo meta event
    events.push({ tick: 0, data: [0xFF, 0x51, 0x03, (tempo >> 16) & 0xFF, (tempo >> 8) & 0xFF, tempo & 0xFF] });

    // Convert each composition event to MIDI note on/off
    for (let i = 0; i < count; i++) {
      const base = i * 6;
      const at = flat[base];
      const voiceId = flat[base + 1] | 0;
      const note = flat[base + 2] | 0;
      const vel = Math.max(1, Math.min(127, Math.round(flat[base + 3] * 127)));
      const dur = flat[base + 4];
      const ch = channelFor(voiceId);
      const tick = Math.round(at * ticksPerQuarter * (bpm / 60));
      const endTick = tick + Math.max(1, Math.round(dur * ticksPerQuarter * (bpm / 60)));
      // Note on
      events.push({ tick, data: [0x90 | ch, note, vel] });
      // Note off
      events.push({ tick: endTick, data: [0x80 | ch, note, 0] });
    }

    // Sort by tick (note offs before note ons at same tick)
    events.sort((a, b) => a.tick - b.tick);

    // End of track
    const lastTick = events.length > 0 ? events[events.length - 1].tick : 0;
    events.push({ tick: lastTick + 1, data: [0xFF, 0x2F, 0x00] });

    // Build MIDI header
    const header = [
      0x4D, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06,
      0x00, 0x00,  // format 0
      0x00, 0x01,  // 1 track
      (ticksPerQuarter >> 8) & 0xFF, ticksPerQuarter & 0xFF,
    ];

    // Build track data with delta times
    const trackData: number[] = [];
    let prevTick = 0;
    for (const ev of events) {
      const delta = ev.tick - prevTick;
      prevTick = ev.tick;
      // Variable-length quantity
      if (delta > 0x0FFFFFF) trackData.push((delta >> 21) | 0x80);
      if (delta > 0x3FFF) trackData.push((delta >> 14) | 0x80);
      if (delta > 0x7F) trackData.push((delta >> 7) | 0x80);
      trackData.push(delta & 0x7F);
      trackData.push(...ev.data);
    }

    const trackLen = trackData.length;
    const trackHeader = [
      0x4D, 0x54, 0x72, 0x6B,
      (trackLen >> 24) & 0xFF, (trackLen >> 16) & 0xFF, (trackLen >> 8) & 0xFF, trackLen & 0xFF,
    ];

    const midi = new Uint8Array(header.length + trackHeader.length + trackData.length);
    midi.set(header, 0);
    midi.set(trackHeader, header.length);
    midi.set(trackData, header.length + trackHeader.length);

    // Download
    const blob = new Blob([midi], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `psy4-composition-${bpm}bpm-${Date.now()}.mid`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log(`[PSY4] MIDI exported: ${count} notes, ${bpm} BPM, format 0`);
  }

  // ── Phase 10.2: Preset Save/Load ──
  /**
   * שומר את ה-params הנוכחיים כ-preset בעל שם.
   */
  savePreset(name: string): void {
    const json = localStorage.getItem(PsyLive.MEMORY_KEY_PARAMS);
    if (!json) {
      console.warn('[PSY4] Phase 10.2: No params to save');
      return;
    }
    const presets = JSON.parse(localStorage.getItem('psy4-presets') || '{}');
    presets[name] = {
      params: JSON.parse(json),
      bpm: this.transport?.snapshot().bpm ?? 145,
      savedAt: Date.now(),
    };
    localStorage.setItem('psy4-presets', JSON.stringify(presets));
    console.log(`[PSY4] Phase 10.2: Preset '${name}' saved`);
  }

  /**
   * טוען preset בעל שם.
   */
  loadPreset(name: string): boolean {
    const presets = JSON.parse(localStorage.getItem('psy4-presets') || '{}');
    const preset = presets[name];
    if (!preset) {
      console.warn(`[PSY4] Phase 10.2: Preset '${name}' not found`);
      return false;
    }
    this.saveLearnedParamsToMemory(preset.params);
    this.loadLearnedParamsFromMemory();
    console.log(`[PSY4] Phase 10.2: Preset '${name}' loaded`);
    return true;
  }

  /**
   * מחזיר רשימת כל ה-presets השמורים.
   */
  listPresets(): { name: string; bpm: number; savedAt: number }[] {
    const presets = JSON.parse(localStorage.getItem('psy4-presets') || '{}');
    return Object.entries(presets).map(([name, p]: [string, any]) => ({
      name,
      bpm: p.bpm ?? 145,
      savedAt: p.savedAt ?? 0,
    }));
  }

  // ── Audio Capture (MediaRecorder) ──
  // Records the live output of PSY4 to a downloadable audio file.
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];

  /**
   * Start recording the live audio output.
   * Creates a MediaStreamDestination and connects the master output to it.
   */
  startRecording(): boolean {
    if (!this.ctx || !this.analyser) return false;
    if (this.mediaRecorder) {
      console.warn('[PSY4] Already recording');
      return false;
    }
    try {
      const dest = this.ctx.createMediaStreamDestination();
      this.analyser.connect(dest);
      this.mediaRecorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm' });
      this.recordedChunks = [];
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.recordedChunks.push(e.data);
      };
      this.mediaRecorder.start();
      console.log('[PSY4] Recording started');
      return true;
    } catch (e) {
      console.error('[PSY4] Recording failed:', e);
      return false;
    }
  }

  /**
   * Stop recording and download the audio file.
   */
  async stopRecording(): Promise<boolean> {
    if (!this.mediaRecorder) return false;
    const recorder = this.mediaRecorder;
    this.mediaRecorder = null;
    return new Promise<boolean>((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `psy4-recording-${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        console.log(`[PSY4] Recording saved (${blob.size} bytes)`);
        resolve(true);
      };
      recorder.stop();
    });
  }

  isRecording(): boolean {
    return this.mediaRecorder !== null && this.mediaRecorder.state === 'recording';
  }

  /**
   * איפוס מלא — מנקה את ה-bank (IndexedDB) + localStorage.
   * מאפשר התחלה נקייה ללא צלילים ישנים שחוזרים.
   */
  async resetAll(): Promise<void> {
    console.log('[PSY4] Reset: clearing bank + localStorage...');
    // Clear IndexedDB bank
    if (this.soundBank) {
      await this.soundBank.clearAll();
    }
    // Clear localStorage params + BPM
    localStorage.removeItem(PsyLive.MEMORY_KEY_PARAMS);
    localStorage.removeItem(PsyLive.MEMORY_KEY_BPM);
    // Reset engine params by creating new random defaults
    if (this.engineNode) {
      const defaults = PsyLive.generateDefaultLearnedParams();
      for (const [voiceClass, recipe] of Object.entries(defaults)) {
        this.engineNode!.workletNode!.port.postMessage({
          type: 'setVoiceRecipe',
          voiceClass,
          recipe,
        });
      }
      this.saveLearnedParamsToMemory(defaults);
    }
    console.log('[PSY4] Reset complete — fresh random params applied');
  }

  /**
   * FACTORY RESET — complete wipe of ALL stored state.
   * Clears: localStorage (all psy4 keys), IndexedDB SoundBank, composition seed.
   * Then reloads the page so the engine starts completely fresh.
   * Use this when "stuck sounds from previous sessions" are causing issues.
   */
  async factoryReset(): Promise<void> {
    console.log('[PSY4] FACTORY RESET: wiping ALL stored state...');
    // Stop playback first
    if (this.playing) this.stop();
    // Panic all voices
    if (this.engineNode) {
      this.engineNode.workletNode?.port.postMessage({ type: 'stop' });
    }
    // Disable synth device
    if (this.synthDeviceEnabled) this.disableSynthDevice();
    // Clear IndexedDB SoundBank
    if (this.soundBank) {
      try { await this.soundBank.clearAll(); } catch (e) { console.warn('factoryReset: SoundBank clear failed', e); }
    }
    // Clear ALL localStorage keys that start with 'psy'
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('psy') || k.startsWith('PSY'))) keysToRemove.push(k);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    console.log(`[PSY4] FACTORY RESET: cleared ${keysToRemove.length} localStorage keys:`, keysToRemove);
    // Clear IndexedDB databases (psy4 related)
    try {
      const dbs = await indexedDB.databases?.();
      if (dbs) {
        for (const db of dbs) {
          if (db.name && db.name.toLowerCase().includes('psy')) {
            indexedDB.deleteDatabase(db.name);
            console.log(`[PSY4] FACTORY RESET: deleted IndexedDB database: ${db.name}`);
          }
        }
      }
    } catch (e) { /* indexedDB.databases not available in all browsers */ }
    // Reload the page to start completely fresh
    console.log('[PSY4] FACTORY RESET: reloading page...');
    setTimeout(() => window.location.reload(), 200);
  }

  // ── Phase 4: Reference Analysis ──
  private referenceAnalyzer: ReferenceAnalyzer | null = null;
  private currentReference: ReferenceDNA | null = null;

  /**
   * מעלה קובץ reference ומנתח אותו.
   * מחזיר את ה-ReferenceDNA שניתן להשתמש בו להשוואה.
   */
  async analyzeReference(file: File): Promise<ReferenceDNA> {
    if (!this.ctx) {
      throw new Error('AudioContext not ready — press Play first');
    }
    if (!this.referenceAnalyzer) {
      this.referenceAnalyzer = new ReferenceAnalyzer(this.ctx);
    }
    console.log(`[PSY4] Phase 4: Analyzing reference: ${file.name} (${(file.size / 1024).toFixed(0)}KB)`);
    const dna = await this.referenceAnalyzer.analyze(file);
    this.currentReference = dna;
    console.log(`[PSY4] Phase 4: Reference analysis complete:`, {
      lufs: dna.lufs.toFixed(1),
      truePeak: dna.truePeak.toFixed(1),
      bpm: dna.bpm,
      key: dna.key,
      scale: dna.scaleName,
      stereoWidth: dna.stereoWidth.toFixed(2),
      spectralCentroid: dna.spectralCentroid.toFixed(0),
    });
    return dna;
  }

  /**
   * מחזיר את ה-reference הנוכחי (או null).
   */
  getReference(): ReferenceDNA | null {
    return this.currentReference;
  }

  /**
   * משווה את ה-output הנוכחי של PSY4 ל-reference.
   * מחזיר distance (0 = זהה, 1 = שונה) + פירוט.
   */
  compareWithReference(): { distance: number; currentLUFS: number; refLUFS: number } | null {
    if (!this.currentReference || !this.analyser || !this.ctx) return null;
    // Measure current output LUFS (simplified)
    const tdBuf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(tdBuf as Float32Array<ArrayBuffer>);
    let sumSq = 0;
    for (let i = 0; i < tdBuf.length; i++) sumSq += tdBuf[i] * tdBuf[i];
    const rms = Math.sqrt(sumSq / tdBuf.length);
    const currentLUFS = rms > 1e-6 ? -0.691 + 10 * Math.log10(sumSq / tdBuf.length) : -70;
    const ref = this.currentReference;
    // Simple distance based on LUFS
    const lufsDistance = Math.abs(currentLUFS - ref.lufs) / 10;
    return {
      distance: Math.min(1, lufsDistance),
      currentLUFS,
      refLUFS: ref.lufs,
    };
  }

  /**
   * טוען חבילת סאונד מ-JSON string.
   */
  async importSoundPackage(jsonString: string): Promise<SoundPackage> {
    if (!this.packageImporter) {
      throw new Error('PackageImporter not ready');
    }
    const pkg = await this.packageImporter.importJSON(jsonString);
    // החל את ה-recipes מה-bank החדש
    await this.applyAllRecipesFromBank();
    return pkg;
  }

  /**
   * אוסף דפוסים מה-learning data (kick pattern, bass intervals, etc.).
   * אם אין רדיו — מייצא דפוס סינתטי מה-composer (4-on-the-floor kick).
   */
  private collectPatternsForPackage(): PackagePattern[] {
    const patterns: PackagePattern[] = [];
    const bpm = this.transport ? this.transport.snapshot().bpm : 145;
    const sourceStyle = this.styleClassifier.getSourceStyleForBank();
    // Kick pattern — אם יש נתונים מהרדיו
    if (this.radioKickTimes.length > 0) {
      const pattern = this.extractKickPatternForExport();
      if (pattern) {
        patterns.push({
          role: 'kick',
          pattern,
          bpm,
          confidence: this.transport ? this.transport.snapshot().confidence : 0,
          sourceStyle,
        });
      }
    }
    // Fallback: synthetic kick pattern (4-on-the-floor) when no radio data
    if (patterns.length === 0) {
      const synthKick = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
      patterns.push({
        role: 'kick',
        pattern: synthKick,
        bpm,
        confidence: 0.5,
        sourceStyle: 'synthetic',
      });
      // Also add a bass pattern (offbeat)
      const synthBass = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0];
      patterns.push({
        role: 'bass',
        pattern: synthBass,
        bpm,
        confidence: 0.5,
        sourceStyle: 'synthetic',
      });
    }
    return patterns;
  }

  /**
   * חילוץ kick pattern 16-step ליצוא (בלי שליחה ל-worker).
   */
  private extractKickPatternForExport(): number[] | null {
    if (this.radioKickTimes.length < 16) return null;
    if (!this.transport) return null;
    const snap = this.transport.snapshot();
    if (!snap.locked) return null;
    const bpm = snap.bpm;
    if (bpm < 60 || bpm > 200) return null;
    const beatDur = 60 / bpm;
    const barDur = beatDur * 4;
    const barTime = snap.barTime || 0;
    const pattern = new Array(16).fill(0);
    for (const t of this.radioKickTimes) {
      let phaseInBar = (t - barTime) / barDur;
      phaseInBar = phaseInBar - Math.floor(phaseInBar);
      const step = Math.round(phaseInBar * 16) % 16;
      pattern[step] += 1;
    }
    const maxCount = Math.max(...pattern);
    if (maxCount === 0) return null;
    for (let i = 0; i < 16; i++) pattern[i] /= maxCount;
    return pattern;
  }

  // ── שלב 5.2: Original synthesis generation ──

  /**
   * Phase 4.2: בונה target DNA מתוך reference track.
   * משתמש ב-bandEnergies של ה-reference כדי לקבוע איזה צליל כל role צריך להפיק.
   * למשל: אם ה-reference חזק ב-sub (band 0), ה-kick target ידרוש subEnergy גבוה.
   */
  private buildReferenceTargetDNA(role: OnsetRole, ref: ReferenceDNA): import('../../foundation/music/SoundDNA').SoundDNA {
    // ref.bandEnergies: [sub, low, lowMid, mid, highMid, high]
    const bands = ref.bandEnergies;
    const base = {
      confidence: 0.7,  // higher than synthetic — we have real data
      usageCount: 0,
      reward: 0.5,
      sourceStyle: 'reference',
      sourceContext: `ref-${ref.bpm}bpm-${ref.scaleName}`,
      harmonicity: 0.6,
      noisiness: 0.2,
      spectralSlope: -0.5,
      roughness: 0.3,
      sustainLevel: 0.3,
      releaseTime: 0.1,
      pitchModulation: 0.1,
      fmAmount: 0.1,
      detune: 5,
      stereoWidth: ref.stereoWidth,
      stereoMotion: 0.2,
      distortionCharacter: 0.4,
    };

    // Map reference spectral balance to per-role targets
    switch (role) {
      case 'kick':
        // Kick should match the reference's sub-band energy
        return { ...base, role: 'kick', brightness: 0.2 + bands[0] * 0.3,
          subEnergy: Math.min(0.95, 0.6 + bands[0] * 0.4),
          bodyEnergy: 0.3 + bands[1] * 0.3,
          midEnergy: 0.1 + bands[2] * 0.2,
          highEnergy: 0.05 + bands[4] * 0.1,
          transientSharpness: 0.85, attackTime: 0.001,
          decayTime: 0.15 + bands[0] * 0.1,
          saturation: 0.5 + bands[0] * 0.3,
          filterCutoff: 200, filterResonance: 1,
          filterType: 'lowpass' as const, filterEnvelopeAmount: 0.8 };
      case 'bass':
        return { ...base, role: 'bass', brightness: 0.3 + bands[1] * 0.3,
          subEnergy: 0.5 + bands[0] * 0.3,
          bodyEnergy: 0.6 + bands[1] * 0.3,
          midEnergy: 0.3 + bands[2] * 0.3,
          highEnergy: 0.1,
          transientSharpness: 0.6, attackTime: 0.005,
          decayTime: 0.2 + bands[1] * 0.1,
          saturation: 0.4 + bands[1] * 0.2,
          filterCutoff: 400 + bands[2] * 800, filterResonance: 2,
          filterType: 'lowpass' as const, filterEnvelopeAmount: 0.6 };
      case 'lead':
        return { ...base, role: 'lead', brightness: 0.6 + bands[3] * 0.3,
          subEnergy: 0.1, bodyEnergy: 0.3 + bands[2] * 0.3,
          midEnergy: 0.7 + bands[3] * 0.2,
          highEnergy: 0.5 + bands[4] * 0.3,
          transientSharpness: 0.5, attackTime: 0.01,
          decayTime: 0.4,
          saturation: 0.3 + bands[3] * 0.2,
          filterCutoff: 1500 + bands[3] * 3000, filterResonance: 3,
          filterType: 'lowpass' as const, filterEnvelopeAmount: 0.4 };
      case 'hat':
        return { ...base, role: 'hat', brightness: 0.8 + bands[5] * 0.2,
          subEnergy: 0.0, bodyEnergy: 0.1,
          midEnergy: 0.3 + bands[3] * 0.2,
          highEnergy: 0.8 + bands[5] * 0.2,
          transientSharpness: 0.9, attackTime: 0.001,
          decayTime: 0.05 + bands[5] * 0.05,
          saturation: 0.3,
          filterCutoff: 5000 + bands[5] * 5000, filterResonance: 1,
          filterType: 'highpass' as const, filterEnvelopeAmount: 0.3,
          noisiness: 0.8, harmonicity: 0.2 };
      case 'perc':
        return { ...base, role: 'percussion', brightness: 0.5 + bands[3] * 0.3,
          subEnergy: 0.2 + bands[0] * 0.2,
          bodyEnergy: 0.5 + bands[2] * 0.3,
          midEnergy: 0.5 + bands[3] * 0.2,
          highEnergy: 0.3 + bands[4] * 0.2,
          transientSharpness: 0.8, attackTime: 0.002,
          decayTime: 0.1 + bands[2] * 0.1,
          saturation: 0.4,
          filterCutoff: 1000 + bands[3] * 2000, filterResonance: 2,
          filterType: 'bandpass' as const, filterEnvelopeAmount: 0.5 };
      case 'pad':
        return { ...base, role: 'texture', brightness: 0.5 + bands[3] * 0.2,
          subEnergy: 0.3 + bands[0] * 0.2,
          bodyEnergy: 0.4 + bands[1] * 0.2,
          midEnergy: 0.5 + bands[2] * 0.2,
          highEnergy: 0.3 + bands[4] * 0.2,
          transientSharpness: 0.2, attackTime: 0.3,
          decayTime: 2.0,
          saturation: 0.3,
          filterCutoff: 800 + bands[3] * 600, filterResonance: 1,
          filterType: 'lowpass' as const, filterEnvelopeAmount: 0.6 };
      case 'acid':
        return { ...base, role: 'lead', brightness: 0.6 + bands[3] * 0.2,
          subEnergy: 0.2, bodyEnergy: 0.4 + bands[1] * 0.2,
          midEnergy: 0.6 + bands[2] * 0.2,
          highEnergy: 0.4 + bands[3] * 0.2,
          transientSharpness: 0.7, attackTime: 0.005,
          decayTime: 0.3,
          saturation: 0.7 + bands[3] * 0.2,
          filterCutoff: 1000 + bands[3] * 2000, filterResonance: 8,
          filterType: 'lowpass' as const, filterEnvelopeAmount: 0.8 };
      case 'clap':
        return { ...base, role: 'percussion', brightness: 0.7 + bands[4] * 0.2,
          subEnergy: 0.0, bodyEnergy: 0.2,
          midEnergy: 0.6 + bands[3] * 0.2,
          highEnergy: 0.5 + bands[4] * 0.2,
          transientSharpness: 0.85, attackTime: 0.003,
          decayTime: 0.1,
          saturation: 0.4,
          filterCutoff: 2000 + bands[4] * 1500, filterResonance: 2,
          filterType: 'bandpass' as const, filterEnvelopeAmount: 0.5,
          noisiness: 0.7 };
      case 'shaker':
        return { ...base, role: 'percussion', brightness: 0.8 + bands[5] * 0.2,
          subEnergy: 0.0, bodyEnergy: 0.1,
          midEnergy: 0.3 + bands[3] * 0.2,
          highEnergy: 0.7 + bands[5] * 0.2,
          transientSharpness: 0.7, attackTime: 0.005,
          decayTime: 0.06,
          saturation: 0.3,
          filterCutoff: 4000 + bands[5] * 4000, filterResonance: 1,
          filterType: 'highpass' as const, filterEnvelopeAmount: 0.3,
          noisiness: 0.8 };
      case 'texture':
        return { ...base, role: 'texture', brightness: 0.6 + bands[4] * 0.2,
          subEnergy: 0.2 + bands[0] * 0.2,
          bodyEnergy: 0.3 + bands[1] * 0.2,
          midEnergy: 0.4 + bands[2] * 0.2,
          highEnergy: 0.4 + bands[4] * 0.2,
          transientSharpness: 0.3, attackTime: 0.1,
          decayTime: 1.5,
          saturation: 0.5,
          filterCutoff: 1000 + bands[3] * 1000, filterResonance: 2,
          filterType: 'lowpass' as const, filterEnvelopeAmount: 0.7,
          fmAmount: 0.4 };
    }
  }

  /**
   * בונה target DNA סינטטי כשאין onsets מהרדיו.
   * מאפשר יצירת וריאציות גם ללא רדיו — לכל role יש פרופיל דיפולט.
   */
  private buildSyntheticTargetDNA(role: OnsetRole): import('../../foundation/music/SoundDNA').SoundDNA {
    const base = {
      confidence: 0.5,
      usageCount: 0,
      reward: 0.5,
      sourceStyle: 'synthetic',
      sourceContext: 'no-radio',
      // Common defaults
      harmonicity: 0.6,
      noisiness: 0.2,
      spectralSlope: -0.5,
      roughness: 0.3,
      sustainLevel: 0.3,
      releaseTime: 0.1,
      pitchModulation: 0.1,
      fmAmount: 0.1,
      detune: 5,
      stereoWidth: 0.5,
      stereoMotion: 0.2,
      distortionCharacter: 0.4,
    };
    switch (role) {
      case 'kick':
        return { ...base, role: 'kick', brightness: 0.3, subEnergy: 0.9, bodyEnergy: 0.5,
          midEnergy: 0.2, highEnergy: 0.1, transientSharpness: 0.9, attackTime: 0.001,
          decayTime: 0.2, saturation: 0.7, filterCutoff: 200, filterResonance: 1,
          filterType: 'lowpass', filterEnvelopeAmount: 0.8 };
      case 'bass':
        return { ...base, role: 'bass', brightness: 0.4, subEnergy: 0.7, bodyEnergy: 0.8,
          midEnergy: 0.4, highEnergy: 0.1, transientSharpness: 0.6, attackTime: 0.005,
          decayTime: 0.3, saturation: 0.5, filterCutoff: 800, filterResonance: 2,
          filterType: 'lowpass', filterEnvelopeAmount: 0.6 };
      case 'lead':
        return { ...base, role: 'lead', brightness: 0.7, subEnergy: 0.2, bodyEnergy: 0.5,
          midEnergy: 0.8, highEnergy: 0.6, transientSharpness: 0.5, attackTime: 0.01,
          decayTime: 0.5, saturation: 0.4, filterCutoff: 3000, filterResonance: 3,
          filterType: 'lowpass', filterEnvelopeAmount: 0.4 };
      case 'hat':
        return { ...base, role: 'hat', brightness: 0.9, subEnergy: 0.0, bodyEnergy: 0.1,
          midEnergy: 0.4, highEnergy: 0.9, transientSharpness: 0.95, attackTime: 0.001,
          decayTime: 0.08, saturation: 0.3, filterCutoff: 7000, filterResonance: 1,
          filterType: 'highpass', filterEnvelopeAmount: 0.3, noisiness: 0.8, harmonicity: 0.2 };
      case 'perc':
        return { ...base, role: 'percussion', brightness: 0.6, subEnergy: 0.3, bodyEnergy: 0.6,
          midEnergy: 0.6, highEnergy: 0.4, transientSharpness: 0.8, attackTime: 0.002,
          decayTime: 0.15, saturation: 0.4, filterCutoff: 2000, filterResonance: 2,
          filterType: 'bandpass', filterEnvelopeAmount: 0.5 };
      case 'pad':
        return { ...base, role: 'texture', brightness: 0.5, subEnergy: 0.3, bodyEnergy: 0.5,
          midEnergy: 0.6, highEnergy: 0.4, transientSharpness: 0.2, attackTime: 0.3,
          decayTime: 2.0, saturation: 0.3, filterCutoff: 800, filterResonance: 1,
          filterType: 'lowpass', filterEnvelopeAmount: 0.6 };
      case 'acid':
        return { ...base, role: 'lead', brightness: 0.6, subEnergy: 0.2, bodyEnergy: 0.5,
          midEnergy: 0.7, highEnergy: 0.5, transientSharpness: 0.7, attackTime: 0.005,
          decayTime: 0.3, saturation: 0.8, filterCutoff: 1500, filterResonance: 8,
          filterType: 'lowpass', filterEnvelopeAmount: 0.8 };
      case 'clap':
        return { ...base, role: 'percussion', brightness: 0.7, subEnergy: 0.0, bodyEnergy: 0.3,
          midEnergy: 0.7, highEnergy: 0.6, transientSharpness: 0.85, attackTime: 0.003,
          decayTime: 0.12, saturation: 0.4, filterCutoff: 2500, filterResonance: 2,
          filterType: 'bandpass', filterEnvelopeAmount: 0.5, noisiness: 0.7 };
      case 'shaker':
        return { ...base, role: 'percussion', brightness: 0.8, subEnergy: 0.0, bodyEnergy: 0.1,
          midEnergy: 0.3, highEnergy: 0.8, transientSharpness: 0.7, attackTime: 0.005,
          decayTime: 0.08, saturation: 0.3, filterCutoff: 5000, filterResonance: 1,
          filterType: 'highpass', filterEnvelopeAmount: 0.3, noisiness: 0.8 };
      case 'texture':
        return { ...base, role: 'texture', brightness: 0.6, subEnergy: 0.2, bodyEnergy: 0.4,
          midEnergy: 0.5, highEnergy: 0.5, transientSharpness: 0.3, attackTime: 0.1,
          decayTime: 1.5, saturation: 0.5, filterCutoff: 1200, filterResonance: 2,
          filterType: 'lowpass', filterEnvelopeAmount: 0.7, fmAmount: 0.4 };
    }
  }

  /**
   * יוצר וריאציות מקוריות על entries קיימים.
   * מוסיף entries חדשים עם sourceStyle='generated'.
   * אם אין onsets מהרדיו — משתמש ב-target DNA סינטטי.
   */
  async generateOriginalSounds(role: OnsetRole): Promise<GenerationResult | null> {
    if (!this.synthesisGenerator) return null;
    const onset = this.onsetAnalyzer.getLatestOnset(role);
    // Priority: radio onsets > reference DNA > synthetic DNA
    let targetDNA;
    if (onset) {
      targetDNA = onset.soundDNA;
    } else if (this.currentReference) {
      targetDNA = this.buildReferenceTargetDNA(role, this.currentReference);
      console.log(`[PSY4] Phase 4.2 generateOriginalSounds(${role}): using reference-guided target`);
    } else {
      targetDNA = this.buildSyntheticTargetDNA(role);
      console.log(`[PSY4] שלב 5.2 generateOriginalSounds(${role}): using synthetic target DNA`);
    }
    return this.synthesisGenerator.generate(role, targetDNA);
  }

  /**
   * יוצר וריאציות לכל ה-roles הפעילים.
   */
  async generateAllOriginalSounds(): Promise<GenerationResult[]> {
    const roles: OnsetRole[] = ['kick', 'bass', 'lead', 'hat', 'perc', 'pad', 'acid', 'clap', 'shaker', 'texture'];
    const results: GenerationResult[] = [];
    for (const role of roles) {
      const result = await this.generateOriginalSounds(role);
      if (result) results.push(result);
    }
    return results;
  }

  // ── שלב 5: Loop learner (למידה מקבצי אודיו) ──

  /**
   * טוען קובץ אודיו ומתחיל ללמוד ממנו בלולאה.
   * הקובץ מתנגן ברקע וה-learning פועל עליו.
   */
  async loadLoopFile(file: File): Promise<boolean> {
    if (!this.loopLearner) {
      console.warn('[PSY4] LoopLearner not ready');
      return false;
    }
    return this.loopLearner.loadFile(file);
  }

  /**
   * עוצר את ה-loop.
   */
  stopLoop(): void {
    this.loopLearner?.stop();
  }

  /**
   * האם ה-loop פעיל.
   */
  isLoopRunning(): boolean {
    return this.loopLearner?.isRunning() ?? false;
  }

  /**
   * קובע עוצמת שמע ל-loop.
   */
  setLoopVolume(v: number): void {
    this.loopLearner?.setVolume(v);
  }

  /**
   * מחזיר את ה-LoopLearner (ל-UI).
   */
  getLoopLearner(): LoopLearner | null {
    return this.loopLearner;
  }
}
