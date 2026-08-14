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
// שלב 4.5: Reward loop (self-improvement)
import { RewardTracker } from './rewardTracker';
// שלב 4.6: Musical style classification
import { StyleClassifier, type RadioStyle, type StyleFeatures, type ClassificationResult } from './styleClassifier';
// ADR-001: CausalComposer runs on a Web Worker now. This import is kept for type compatibility
// but the actual composition happens in public/worklets/composition-worker.js
// SamplerBridge import REMOVED — fully dead code
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
  // תחנות שנבדקו עם CORS (Access-Control-Allow-Origin: *) ו-audio/mpeg
  // חשוב: crossOrigin='anonymous' דורש CORS מהשרת, אחרת הדפדפן חוסם לחלוטין.
  // סדר: הכי פסייטראנס/טראנס קודם.
  { id: 'spaceunicorn', name: 'Space Unicorn', url: 'https://spaceunicorn.radio/stream', genre: 'Trance · PsyTrance', bitrate: 192 },
  { id: 'babaganousha', name: 'Babaganousha', url: 'https://babaganousha.net:8443/stream/1/', genre: 'Psychedelic · Goa', bitrate: 128 },
  { id: 'somafm-trip', name: 'SomaFM The Trip', url: 'https://ice1.somafm.com/thetrip-128-mp3', genre: 'Dance · Trance · House', bitrate: 128 },
  { id: 'somafm-spacestation', name: 'SomaFM Space Station', url: 'https://ice1.somafm.com/spacestation-128-mp3', genre: 'Space · Electronica', bitrate: 128 },
  { id: 'somafm-cliqhop', name: 'SomaFM Cliqhop', url: 'https://ice1.somafm.com/cliqhop-256-mp3', genre: 'IDM · Beats', bitrate: 256 },
  { id: 'somafm-defcon', name: 'SomaFM DEF CON', url: 'https://ice1.somafm.com/defcon-128-mp3', genre: 'Electronic · Hacking', bitrate: 128 },
  { id: 'somafm-groovesalad', name: 'SomaFM Groove Salad', url: 'https://ice1.somafm.com/groovesalad-256-mp3', genre: 'Ambient · Chill', bitrate: 256 },
  { id: 'somafm-dronezone', name: 'SomaFM Drone Zone', url: 'https://ice1.somafm.com/dronezone-256-mp3', genre: 'Ambient · Space', bitrate: 256 },
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

  // MusicalSession REMOVED — was 1403 lines of dead code. All composition goes through CausalComposer.
  // ADR-001: CausalComposer runs on a Web Worker. These fields manage the worker.
  private compositionWorker: Worker | null = null;
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
  // שלב 4.5: Reward tracker — מודד איך הרדיו מגיב לסאונדים של PSY4
  private rewardTracker: RewardTracker | null = null;
  // שלב 4.6: Style classifier — מזהה סגנון מוזיקלי מהרדיו
  private styleClassifier: StyleClassifier = new StyleClassifier();
  // שלב 4.6: תוצאת הסיווג האחרונה (ל-UI/debugging)
  private lastClassification: ClassificationResult | null = null;
  // שלב 4.5: טיימר eviction תקופתי (כל 60s)
  private evictionTimer: ReturnType<typeof setInterval> | null = null;
  // שלב 4.4: איטרציה אוטומטית — כל 30s, סרוק role פעיל
  private explorationTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly EXPLORATION_INTERVAL_MS = 30000;
  // שלב 4.4: איזה role לסרוק הבא (round-robin)
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
  private readonly lookahead = 100; // FIX: 100ms scheduler. 50ms was too frequent (20Hz object alloc).
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
    // MusicalSession instantiation REMOVED — dead code
    // ADR-001: CausalComposer runs on a Web Worker (composition thread)
    // The worker handles all composition — main thread only forwards events to AudioWorklet
    this.compositionWorker = new Worker('/worklets/composition-worker.js');
    this.compositionWorker.onmessage = (e) => this.handleWorkerMessage(e.data);
    this.compositionWorker.postMessage({
      type: 'init',
      opts: { bpm: 145, rootPc: 4, scaleName: 'phrygian-dominant', seed: Math.floor(Math.random() * 1000000) },
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
    const timbre = null; // MusicalSession REMOVED — no timbre profile
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
    const timbre = null; // MusicalSession REMOVED — no timbre profile
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
    // CRITICAL FIX: If worklet isn't ready yet (async init still running),
    // wait for it before starting playback. Otherwise events are dropped.
    if (this.useWorklet && this.engineNode) {
      this.engineNode.play();
      this.engineNode.setBPM(145);
    } else {
      // Worklet not ready — poll until it is, then start
      const checkReady = setInterval(() => {
        if (this.useWorklet && this.engineNode) {
          clearInterval(checkReady);
          this.engineNode.play();
          this.engineNode.setBPM(145);
          // Now send initial compose
          this.sendInitialCompose();
        }
      }, 50);
      // Timeout after 5s
      setTimeout(() => clearInterval(checkReady), 5000);
    }
    this.transport!.start();
    this.lastScheduledBeatIndex = -1;
    this.updateDelayTime();
    this.timer = setInterval(() => this.scheduler(), this.lookahead);
    this.startUITimer();
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
    const barOriginAudioTime = snap.beatTime - snap.beat * beatDur;
    this.lastWorkerComposeBar = -1;  // FIX: reset so scheduler will send
    this.compositionWorker?.postMessage({
      type: 'compose',
      targetBar: 3,
      barOriginAudioTime,
    });
    this.lastWorkerComposeBar = 3;  // track requested
  }

  stop(): void {
    this.playing = false;
    if (this.engineNode) this.engineNode.stop();
    if (this.engineNode) this.engineNode.panic(); // CRITICAL: clear all events + voices
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

    // 1.1.1 BPM — שלח אם confidence > 0.5 ושינוי > 2 BPM
    // תיקון: smoothing — רק עדכן אם ה-BPM הממוצע של 3 הקריאות האחרונות יציב
    const radioBpm = radioSnap.beat?.estimatedBpm ?? 0;
    const beatConfidence = radioSnap.beat?.confidence ?? 0;
    if (beatConfidence > 0.5 && radioBpm > 0) {
      // שמור היסטוריית BPM ל-smoothing
      this._bpmHistory.push(radioBpm);
      if (this._bpmHistory.length > 5) this._bpmHistory.shift();
      // חשב ממוצע רק אם יש לפחות 3 קריאות
      if (this._bpmHistory.length >= 3) {
        const avgBpm = this._bpmHistory.reduce((a, b) => a + b, 0) / this._bpmHistory.length;
        // רק עדכן אם הממוצע יציב (כל הקריאות בטווח ±3 BPM מהממוצע)
        const stable = this._bpmHistory.every(b => Math.abs(b - avgBpm) < 3);
        if (stable && Math.abs(avgBpm - this._lastSentRadioBpm) > 1.5) {
          this.compositionWorker.postMessage({ type: 'setBPM', bpm: avgBpm });
          if (this.transport) this.transport.setTempo(avgBpm, 'radio');
          // תיקון קריטי: עדכן גם את ה-engine node (AudioWorklet)
          if (this.engineNode) this.engineNode.setBPM(avgBpm);
          this._lastSentRadioBpm = avgBpm;
          console.log(`[PSY4] Radio→Worker: BPM=${avgBpm.toFixed(1)} (conf=${beatConfidence.toFixed(2)}, smoothed from ${this._bpmHistory.length} readings)`);
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
      // אנרגיה נמוכה מתמשכת (<0.30) — force BREAK ל-4 תיבות
      else if (sustainedRecent < 0.30 && sustainedOlder < 0.40) {
        if (this.cachedUserControls.forcedSection !== 'BREAK') {
          this.compositionWorker.postMessage({ type: 'controls', forcedSection: 'BREAK', bars: 4 });
          console.log(`[PSY4] שלב 3.5 Radio→Worker: force BREAK (sustained low energy=${sustainedRecent.toFixed(2)})`);
          forcedSectionSent = 'BREAK';
        }
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
  // Maps learned spectral characteristics → synth params (wave, cutoff, saturation).
  private applyLearnedTimbre(): void {
    const timbre = null; // MusicalSession REMOVED — no timbre profile
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
        this.useWorklet = true;
        // ADR-009: Initialize SharedArrayBuffer for lock-free event transfer (zero-allocation)
        const sharedOk = this.engineNode.initSharedBuffer();
        if (sharedOk) console.log('[PSY4] SharedArrayBuffer active — lock-free event transfer');
        else console.log('[PSY4] SharedArrayBuffer not available — using Transferable fallback');
        // PERF: wire stats callback to monitor audio-thread CPU load.
        this.engineNode.onStats((stats) => {
          this.lastWorkletStats = stats;
          if (stats.processMs > 3.0) {
            console.warn(`[PSY4] AUDIO THREAD OVER BUDGET: processMs=${stats.processMs.toFixed(2)}ms cpuLoad=${(stats.cpuLoad*100).toFixed(0)}% voices=${stats.activeVoices}/${stats.voiceBudget}`);
          }
        });
        // FIX: Connect worklet output directly to destination.
        // The worklet has its OWN master chain (multiband + glue + true-peak).
        // The legacy chain (engineBus → comp → EQ → master → safetyLimiter → analyser)
        // was SUMMING with the worklet output = double signal = clipping.
        // Now: worklet → analyser → destination (single path, worklet's master is the only master)
        const out = this.engineNode.outputNode;
        if (out && this.analyser) {
          out.disconnect();
          out.connect(this.analyser);
          // analyser already connected to destination
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
        this.analyser.disconnect();
        this.analyser.connect(this.ctx.destination);
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
        // שלב 4.2: אתחל את ה-SynthesisMatcher עם ה-engine node שנוצר
        this.synthesisMatcher.init(this.engineNode);
        // שלב 4.4: אתחל את ה-SoundExplorer (משתמש ב-matcher + bank)
        this.soundExplorer = new SoundExplorer(this.synthesisMatcher, this.soundBank);
        // שלב 4.5: אתחל את ה-RewardTracker
        this.rewardTracker = new RewardTracker(this.soundBank);
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
    if (!this.ctx || !this.transport || !this.workerReady) return;
    // CRITICAL FIX: Don't compose until worklet is also ready
    if (!this.useWorklet || !this.engineNode) return;
    try {
      const now = this.ctx.currentTime;
      const snap = this.transport.snapshot();

      // ADR-001: Send compose request to Web Worker (composition thread)
      // The worker composes 3 bars ahead and returns events as a Float64Array (Transferable, zero-copy)
      const currentBar = snap.bar;
      const beatDur = 60 / snap.bpm;
      const targetBar = currentBar + 3;
      // FIX: Send compose whenever we haven't requested up to targetBar yet
      if (this.lastWorkerComposeBar < targetBar) {
        const barOriginAudioTime = snap.beatTime - snap.beat * beatDur;
        this.compositionWorker?.postMessage({
          type: 'compose',
          targetBar,
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
          // FIX: Check if events are in the future — don't schedule past events
          const now = this.ctx.currentTime;
          let scheduled = 0;
          for (let i = 0; i < msg.count; i++) {
            const base = i * EVENT_SIZE;
            const at = flat[base];
            const note = flat[base + 1];
            const velocity = flat[base + 2];
            const duration = flat[base + 3];
            const voiceId = flat[base + 4] as VoiceId;
            const param = flat[base + 5];
            // Skip events that are too far in the past (> 0.5s behind)
            if (at < now - 0.5) continue;
            if (voiceId === VOICE.KICK) this.kickCount++;
            if (voiceId === VOICE.BASS && note > 0) this.bassFreq = mtof(note);
            this.engineNode.scheduleEvent(at, voiceId, note, velocity, duration, param);
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

  get engineBusInput(): AudioNode | null {
    return this.engineBus ?? null;
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
        this.radioGain.gain.value = 0.5;
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
    if (this.rewardTracker && this.radioOn) {
      this.rewardTracker.recordOccupancy(this.occupancy);
    }

    // MUSICAL FIX: session.observeRadioTick REMOVED entirely.
    // Was collecting learning data that nobody reads (only BPM/scale used, and
    // those come from learnTick). This was running extractSpectralFeatures every
    // 500ms for nothing. Saves CPU + removes dead code path.
    // The session field is kept for compatibility but observeRadioTick is never called.

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
      // emit every tick (2000ms)
      this.emit();
      // learnTick every tick (2000ms — was 1000ms, but nothing changes that fast)
      this.learnTick();
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
    // הרצה ראשונה אחרי 10 שניות (כדי שיהיו onsets)
    setTimeout(() => this.runExplorationCycle(), 10000);
    // ואז כל 30 שניות
    this.explorationTimer = setInterval(() => {
      this.runExplorationCycle();
    }, PsyLive.EXPLORATION_INTERVAL_MS);
    // שלב 4.5: טיימר eviction תקופתי — כל 60 שניות, נקה entries חלשים
    this.evictionTimer = setInterval(() => {
      this.runPeriodicEviction();
    }, 60000);
    console.log('[PSY4] שלב 4.4 Auto-exploration started (interval=30s, first run in 10s)');
    console.log('[PSY4] שלב 4.5 Periodic eviction started (interval=60s)');
  }

  private stopAutoExploration(): void {
    if (this.explorationTimer) {
      clearInterval(this.explorationTimer);
      this.explorationTimer = null;
      console.log('[PSY4] שלב 4.4 Auto-exploration stopped');
    }
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
      console.log('[PSY4] שלב 4.5 Periodic eviction stopped');
    }
  }

  /**
   * שלב 4.5: Eviction תקופתי — כל 60s, נקה entries חלשים.
   * - entries עם reward < 0.2 ו-usageCount > 3 → evict (לא יעיל)
   * - אם ל-role אין אף entry עם reward > 0.4 אחרי 3 מחזורים → נקה והתחל מחדש
   */
  private async runPeriodicEviction(): Promise<void> {
    const roles: OnsetRole[] = ['kick', 'bass', 'lead', 'perc'];
    let totalEvicted = 0;
    for (const role of roles) {
      const all = await this.soundBank.all(role);
      if (all.length === 0) continue;
      // זהה entries חלשים: reward < 0.2 ו-usageCount > 3
      const weak = all.filter(e => e.reward < 0.2 && e.usageCount > 3);
      for (const entry of weak) {
        await this.soundBank.delete(entry.id);
        totalEvicted++;
      }
      // אם כל ה-entries של role ירדו מתחת ל-0.3 → נקה את ה-role
      const allWeak = all.every(e => e.reward < 0.3);
      if (allWeak && all.length > 0) {
        console.log(`[PSY4] שלב 4.5 Eviction: all ${role} entries weak (reward < 0.3) — clearing role for re-exploration`);
        await this.soundBank.clearRole(role);
        totalEvicted += all.length;
      }
    }
    if (totalEvicted > 0) {
      console.log(`[PSY4] שלב 4.5 Periodic eviction: removed ${totalEvicted} weak entries`);
    }
  }

  /**
   * מחזור סריקה אחד: סרוק role אחד, שמור ל-bank, החל recipe על engine.
   * שלב 4.5: אם ל-role אין אף entry עם reward > 0.5 אחרי 3 מחזורים → הרץ exploration נוסף.
   */
  private async runExplorationCycle(): Promise<void> {
    if (!this.radioOn || !this.soundExplorer) return;
    // בחר role round-robin
    const roles: OnsetRole[] = ['kick', 'bass', 'lead', 'perc'];
    const role = roles[this.nextExploreRole === 'kick' ? 0 : this.nextExploreRole === 'bass' ? 1 : this.nextExploreRole === 'lead' ? 2 : 3];
    // קדם ל-role הבא
    const nextIdx = (roles.indexOf(role) + 1) % roles.length;
    this.nextExploreRole = roles[nextIdx];

    // קבל את ה-onset האחרון ל-role
    const onset = this.onsetAnalyzer.getLatestOnset(role);
    if (!onset) {
      console.log(`[PSY4] שלב 4.4 Exploration: no onsets for ${role} yet, skipping`);
      return;
    }

    try {
      // שלב 4.6: השתמש ב-sourceStyle מה-classifier (מזהה סגנון + unknown)
      const sourceStyle = this.styleClassifier.getSourceStyleForBank();
      const result = await this.soundExplorer.explore(role, onset.soundDNA, sourceStyle);
      // אחרי ה-exploration, החל את ה-recipe הטוב ביותר מה-bank על ה-engine
      await this.applyBestRecipeFromBank(role);
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
    // שלח את ה-voiceParams הגולמיים ל-engine node
    const voiceClass = role === 'kick' ? 'KickVoice'
      : role === 'bass' ? 'BassVoice'
      : role === 'lead' ? 'LeadVoice'
      : role === 'hat' ? 'HatVoice'
      : 'PercVoice';
    this.engineNode.node.port.postMessage({
      type: 'setVoiceRecipe',
      voiceClass,
      recipe: entry.voiceParams, // ה-params הגולמיים (fund, subDecay, saturation, וכו')
    });
    // עדכן usageCount
    await this.soundBank.updateReward(entry.id, 0, true);
    // שלב 4.5: התחל מעקב reward — מדוד איך הרדיו מגיב ב-3 השניות הבאות
    if (this.rewardTracker) {
      this.rewardTracker.startTracking(entry.id, role, this.occupancy);
    }
    const paramsStr = entry.voiceParams ? JSON.stringify(entry.voiceParams).slice(0, 80) : '{}';
    console.log(`[PSY4] שלב 4.4 applyRecipe(${role}): applied entry ${entry.id} (matchScore=${entry.matchScore.toFixed(3)}, reward=${entry.reward.toFixed(3)}, params=${paramsStr})`);
    return true;
  }

  /**
   * החל recipes מה-bank על כל ה-roles הפעילים (קריאה ידנית).
   */
  async applyAllRecipesFromBank(): Promise<void> {
    const roles: OnsetRole[] = ['kick', 'bass', 'lead', 'perc'];
    for (const role of roles) {
      await this.applyBestRecipeFromBank(role);
    }
  }
}
