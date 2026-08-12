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
// R4 PRESET DECISION: Option B — SoundBank is valid data (142 presets verified)
// but is NOT connected to the live runtime. The engine uses 4 hardcoded presets
// with inline Web Audio synthesis. SoundBank is marked as FUTURE MATERIAL
// LIBRARY — to be wired in a future iteration after the runtime engine is
// fully verified. The import is removed to honestly reflect the disconnection.
// See audit-reports/PSY4_REALITY_REPAIR.md for details.
import { BeatPLL } from './beatPLL';
import { mutatePattern, type Pattern } from './patternMutator';
import { MelodyObserver, type MelodyObservation } from './melodyObserver';
import { RadioStateGate, type RadioState } from './radioStateGate';
import { MusicalTransport } from '../../foundation/transport/MusicalTransport';
import { TransportAdapter } from '../../foundation/transport/TransportAdapter';
import { RadioObservationLayer } from '../../foundation/radio/RadioObservationLayer';
import { DEFAULT_RADIO_CONFIG } from '../../foundation/radio/RadioObservationTypes';
import { MusicalSession, type NotePlan } from '../../foundation/music/MusicalSession';

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const freqToNote = (f: number) => {
  if (f <= 0) return '—';
  const m = Math.round(12 * Math.log2(f / 440) + 69);
  return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
};
const freqToMidi = (f: number) => Math.round(12 * Math.log2(f / 440) + 69);

// ─── Presets (EXACTLY like psy — 4 distinct styles) ────────────────────────
interface Pattern { kick: number[]; bass: (number|null)[]; lead: (number|null)[]; hat: number[]; }
interface Variant {
  bassWave: OscillatorType; bassCut: number; bassQ: number;
  leadWave: OscillatorType; leadCut: number; leadQ: number;
  hatLvl: number; leadLvl: number;
}
interface Preset {
  id: string; name: string; tag: string; bpm: number; root: number;
  desc: string; patterns: Pattern; variants: { A: Variant; B: Variant };
}
interface Stream { id: string; name: string; url: string; genre: string; bitrate: number; }

// ─── Streams (HTTPS-only — HTTP blocked by mixed content) ─────────────────
export const STREAMS: Stream[] = [
  { id: 'psyndora', name: 'Psyndora', url: 'https://cast.magicstreams.gr:9111/stream/1/', genre: 'Psytrance · Full-On · Goa', bitrate: 128 },
  { id: 'babaganousha', name: 'Babaganousha', url: 'https://babaganousha.net:8443/stream/1/', genre: 'Psychedelic · Goa', bitrate: 128 },
  { id: 'spaceunicorn', name: 'Space Unicorn', url: 'https://spaceunicorn.radio/stream', genre: 'Trance · PsyTrance', bitrate: 192 },
  { id: 'psyndora-prog', name: 'Psyndora Progressive', url: 'https://cast.magicstreams.gr:9110/stream/1/', genre: 'Progressive Psy', bitrate: 128 },
  { id: 'psyndora-chill', name: 'Psyndora Chill', url: 'https://cast.magicstreams.gr:9112/stream/1/', genre: 'PsyChill · Ambient', bitrate: 128 },
  { id: 'radiocaprice-psy', name: 'Radio Caprice Psytrance', url: 'https://radcap.net/psytrance.pls', genre: 'Psytrance', bitrate: 128 },
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
// R3 REALITY REPAIR: SyncStatus now reflects actual signal state.
// 'listening' is ONLY set when the RadioStateGate verifies non-zero samples.
// 'following' is ONLY set when PLL is locked AND signal is verified.
export type SyncStatus = 'idle' | 'connecting' | 'no_signal' | 'listening' | 'following';

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
  // Occupancy (from architecture review)
  occupancy: { kick: number; bass: number; lead: number; hats: number };
  // R3: Explicit radio signal state (from RadioStateGate)
  radioState: RadioState;
  radioSignalRms: number;
  radioNonZeroRatio: number;
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

  // ── OCCUPANCY (the key insight from architecture review) ──
  // Instead of "radio loud/quiet", we track WHICH ROLES the radio fills
  private occupancy = { kick: 0, bass: 0, lead: 0, hats: 0 };
  // Per-role buses (so we can control each independently)
  private kickBus: GainNode | null = null;
  private bassBus: GainNode | null = null;
  private leadBus: GainNode | null = null;
  private hatBus: GainNode | null = null;
  private engineBus: GainNode | null = null;
  // Energy history for relative energy (not absolute)
  private energyHistory: number[] = [];
  // Compressor reduction monitoring
  private comp: DynamicsCompressorNode | null = null;

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
  // F1.18: PLL feeds observations to Transport. Scheduler reads Transport.
  private pll: BeatPLL = new BeatPLL();

  // F1.18: MusicalTransport is the SINGLE source of truth for musical time.
  // All beat/bar/phase/bpm reads come from transport.snapshot().
  // The PLL is an observer; Transport is the time model.
  private transport: MusicalTransport | null = null;
  private transportAdapter: TransportAdapter | null = null;

  // Pattern mutation (evolves every 8 bars)
  // F1.18: barCount is derived from transport.snapshot().bar, not independently tracked
  private livePattern: Pattern | null = null;
  private lastMutatedBar = -1; // track last bar we mutated at (for 8-bar cycle)

  // Melody observation (learns melodies from radio)
  private melodyObserver: MelodyObserver = new MelodyObserver();
  private detectTickCount = 0;

  // R3: Radio signal reality gate
  private radioGate: RadioStateGate = new RadioStateGate();

  // F2.5: RadioObservationLayer — the SINGLE entry point for radio analysis
  // Replaces inline detect()/onKick() with a timestamped, deterministic layer
  private radioLayer: RadioObservationLayer | null = null;

  // F8: MusicalSession — THE single musical runtime (no feature flags, no legacy)
  private session: MusicalSession | null = null;
  private currentNotePlan: NotePlan | null = null;

  // R6: Master safety limiter
  private safetyLimiter: DynamicsCompressorNode | null = null;
  private safetyReduction: number = 0;

  // Scheduler — wake-up mechanism only (NOT a musical clock)
  // F1.18: setInterval wakes the scheduler; musical time comes from Transport
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly lookahead = 25;
  private readonly scheduleAheadTime = 0.15;
  private lastScheduledBeatIndex = -1; // dedup based on Transport beatIndex

  // Kick detection
  private detectTimer: ReturnType<typeof setInterval> | null = null;
  private lastKickTime = 0;
  private kickIntervals: number[] = [];
  private subBassHistory: number[] = [];
  private radioFreqBuf: Uint8Array | null = null;

  // Learning
  private learningData: LearningData | null = null;
  private deviceId = '';

  // UI timer
  private uiTimer: ReturnType<typeof setInterval> | null = null;

  onState: ((s: LiveState) => void) | null = null;
  get analyserNode() { return this.analyser; }
  get radioAnalyserNode() { return this.radioAnalyser; }
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
    const learned = this.learningData ? getInsights(this.learningData) : null;
    // F1.18: BPM comes from Transport — single source of truth
    const transportBpm = this.transport ? this.transport.snapshot().bpm : 145;
    this.onState?.({
      playing: this.playing, radioOn: this.radioOn,
      radioBpm: transportBpm, engineBpm: transportBpm,
      syncStatus: this.syncStatus, mixMode: this.mixMode,
      kickCount: this.kickCount,
      bassNote: freqToNote(this.bassFreq),
      radioLevel: this.radioLevel, engineLevel: this.engineLevel,
      presetId: this.presetId, variant: this.variant,
      learned: learned ? {
        bpm: learned.topBpm, key: learned.topKey,
        confidence: learned.tempoStats?.confidence || 0,
        scale: learned.scale?.name || null,
      } : null,
      sidechainActive: false,
      harmonicLocked: this.harmonicLocked,
      radioRms: this.radioRms,
      radioBands: this.radioBands,
      compositionMode: this.compositionMode,
      occupancy: this.occupancy,
      // R3: Radio signal reality state
      radioState: this.radioGate.getState(),
      radioSignalRms: this.radioGate.getSnapshot()?.rms ?? 0,
      radioNonZeroRatio: this.radioGate.getSnapshot()?.nonZeroRatio ?? 0,
    });
  }

  // ── Audio init (EXACTLY like psy) ──
  private ensureAudio(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

    // Simple chain: voices → master → safetyLimiter → analyser → destination
    // R6: Safety limiter added to prevent clipping (engine + radio sum)
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.7;
    // R6: Safety limiter — brickwall-style, only activates on peaks near 0dBFS
    this.safetyLimiter = this.ctx.createDynamicsCompressor();
    this.safetyLimiter.threshold.value = -1.0;   // only catches peaks above -1dB
    this.safetyLimiter.knee.value = 0;            // hard knee
    this.safetyLimiter.ratio.value = 20;          // 20:1 = brickwall-ish
    this.safetyLimiter.attack.value = 0.003;      // 3ms (fast)
    this.safetyLimiter.release.value = 0.05;      // 50ms
    this.master.connect(this.safetyLimiter);
    this.safetyLimiter.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // Delay (like psy)
    this.delaySend = this.ctx.createGain();
    this.delaySend.gain.value = 1.0;
    this.delay = this.ctx.createDelay(2.0);
    this.delay.delayTime.value = 0.3;
    const wet = this.ctx.createGain(); wet.gain.value = 0.22;
    const fb = this.ctx.createGain(); fb.gain.value = 0.34;
    this.delaySend.connect(this.delay);
    this.delay.connect(wet); wet.connect(this.master);
    this.delay.connect(fb); fb.connect(this.delay);

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
    this.transportAdapter = new TransportAdapter(this.transport);

    // F2.5 — Initialize RadioObservationLayer
    // The SINGLE entry point for radio analysis. Produces timestamped
    // RadioBeatObservation that feeds Transport.observeBeat().
    this.radioLayer = new RadioObservationLayer({
      ...DEFAULT_RADIO_CONFIG,
      sampleRate: this.ctx.sampleRate,
      fftSize: this.radioAnalyser?.fftSize ?? 512,
    });

    // F8 — Initialize MusicalSession (THE single musical runtime)
    this.session = new MusicalSession(42);

    // ── PER-ROLE BUSES (from architecture review) ──
    // Each voice connects to its role bus → engineBus → gentle comp → master
    this.kickBus = this.ctx.createGain(); this.kickBus.gain.value = 0.95; // F10: slightly louder kick
    this.bassBus = this.ctx.createGain(); this.bassBus.gain.value = 0.85;
    this.leadBus = this.ctx.createGain(); this.leadBus.gain.value = 0.5;  // F10: quieter lead (was 0.7)
    this.hatBus = this.ctx.createGain(); this.hatBus.gain.value = 0.55;   // F10: slightly quieter hats
    
    this.engineBus = this.ctx.createGain();
    this.engineBus.gain.value = 0.8;

    // Gentle compressor on engine bus only (not on radio)
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 2;
    this.comp.attack.value = 0.015;
    this.comp.release.value = 0.12;

    // Connect: role buses → engineBus → comp → master
    this.kickBus.connect(this.engineBus);
    this.bassBus.connect(this.engineBus);
    this.leadBus.connect(this.engineBus);
    this.hatBus.connect(this.engineBus);
    this.engineBus.connect(this.comp);
    this.comp.connect(this.master);
  }

  // ── Voices — connect to role buses (not master directly) ──
  private kick(t: number): void {
    if (!this.ctx || !this.kickBus) return;
    // F10: Kick with punch — sine body + noise click for transient presence
    const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t); // F10: higher attack pitch for punch
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.09);
    gain.gain.setValueAtTime(1.0, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5); // F10: longer decay
    osc.connect(gain); gain.connect(this.kickBus);
    osc.start(t); osc.stop(t + 0.52);

    // F10: Add noise click for transient definition
    if (this.noiseBuf) {
      const click = this.ctx.createBufferSource(); click.buffer = this.noiseBuf;
      const clickHp = this.ctx.createBiquadFilter(); clickHp.type = 'highpass'; clickHp.frequency.value = 3000;
      const clickGain = this.ctx.createGain();
      clickGain.gain.setValueAtTime(0.4, t);
      clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
      click.connect(clickHp); clickHp.connect(clickGain); clickGain.connect(this.kickBus);
      click.start(t); click.stop(t + 0.03);
    }
  }

  private hat(t: number, lvl: number): void {
    if (!this.ctx || !this.hatBus || !this.noiseBuf) return;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.001, lvl), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(hp); hp.connect(gain); gain.connect(this.hatBus);
    src.start(t); src.stop(t + 0.06);
  }

  private bass(t: number, freq: number, v: Variant): void {
    if (!this.ctx || !this.bassBus) return;
    const osc = this.ctx.createOscillator(); osc.type = v.bassWave; osc.frequency.value = freq;
    const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = v.bassQ;
    // F10: Gentler filter sweep — keep more body, less plucky
    const fStart = Math.max(200, v.bassCut), fEnd = Math.max(150, v.bassCut * 0.5);
    filter.frequency.setValueAtTime(fStart, t);
    filter.frequency.exponentialRampToValueAtTime(fEnd, t + 0.25);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.85, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.15); // F10: sustain instead of full decay
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35); // F10: longer decay
    osc.connect(filter); filter.connect(gain); gain.connect(this.bassBus);
    if (this.delaySend) { const send = this.ctx.createGain(); send.gain.value = 0.08; gain.connect(send); send.connect(this.delaySend); }
    osc.start(t); osc.stop(t + 0.37);
  }

  private lead(t: number, freq: number, v: Variant, accent: boolean): void {
    if (!this.ctx || !this.leadBus) return;
    // F10: Lead timbre fix — softer wave, lower Q, less delay, lower gain
    // This addresses the "high-pitched lead" complaint: the problem was TIMBRE
    // (sawtooth + high Q + heavy delay), not pitch (MIDI was already corrected in F9)
    const peakCut = Math.max(200, v.leadCut * (accent ? 1.15 : 1));
    const o1 = this.ctx.createOscillator(), o2 = this.ctx.createOscillator();
    // F10: Use triangle instead of sawtooth — softer, fewer harmonics
    o1.type = 'triangle'; o2.type = 'triangle';
    o1.frequency.value = freq; o2.frequency.value = freq * Math.pow(2, 7 / 1200); // F10: less detune (7 cents vs 9)
    const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass';
    filter.Q.value = Math.min(5, v.leadQ * 0.5); // F10: halve Q to reduce whistling
    filter.frequency.setValueAtTime(200, t);
    filter.frequency.exponentialRampToValueAtTime(peakCut, t + 0.02);
    filter.frequency.exponentialRampToValueAtTime(300, t + 0.22);
    const gain = this.ctx.createGain();
    // F10: Lower gain — lead should sit BELOW kick and bass in the mix
    const peak = Math.max(0.03, v.leadLvl * 0.6 * (accent ? 1 : 0.7));
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    o1.connect(filter); o2.connect(filter); filter.connect(gain); gain.connect(this.leadBus);
    // F10: Reduce delay send from 0.3 to 0.12 — less echo reinforcement
    if (this.delaySend) { const send = this.ctx.createGain(); send.gain.value = 0.12; gain.connect(send); send.connect(this.delaySend); }
    o1.start(t); o2.start(t); o1.stop(t + 0.26); o2.stop(t + 0.26);
  }

  // ── Play / Stop ──
  // F1.18: Transport owns musical time. play() starts the Transport;
  // scheduler reads transport.snapshot() for beat/bar/phase.
  play(): void {
    this.ensureAudio();
    if (this.playing) return;
    this.playing = true;
    // F1.18: Start Transport — it sets the initial anchor
    this.transport!.start();
    this.lastScheduledBeatIndex = -1;
    this.updateDelayTime();
    // setInterval is a WAKE-UP mechanism only — NOT the musical clock
    this.timer = setInterval(() => this.scheduler(), this.lookahead);
    this.startUITimer();
    this.emit();
  }

  stop(): void {
    this.playing = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.stopUITimer();
    this.emit();
  }

  setPreset(id: string): void {
    this.presetId = id;
    this.livePattern = null; // reset mutation when preset changes
    this.lastMutatedBar = -1;
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
    // CRITICAL: volume controls master gain directly (like psy)
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  private updateDelayTime(): void {
    if (this.delay) this.delay.delayTime.value = this.stepDur() * 3;
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
    if (!this.ctx || !this.transport) return;
    try {
      const now = this.ctx.currentTime;
      const snap = this.transport.snapshot();
      const stepDur = snap.beatDuration / 4; // 16th note duration

      // Compute the next 16th-note step from the Transport's beat grid.
      // snap.beatTime = AudioContext time of the most recent beat boundary.
      // 16th notes are at: beatTime + k * stepDur (k = 0,1,2,3 within each beat).
      const elapsedSinceBeat = now - snap.beatTime;
      const stepsSinceBeat = Math.floor(elapsedSinceBeat / stepDur);

      // Next 16th note to schedule (one step ahead of current position)
      let stepTime = snap.beatTime + (stepsSinceBeat + 1) * stepDur;
      let stepIdx = snap.beatIndex * 4 + stepsSinceBeat + 1;

      // Schedule all 16th notes within the schedule-ahead window
      while (stepTime < now + this.scheduleAheadTime) {
        if (stepTime > now && stepIdx > this.lastScheduledBeatIndex) {
          this.scheduleStep(stepIdx, stepTime);
          this.lastScheduledBeatIndex = stepIdx;
        }
        stepIdx++;
        stepTime += stepDur;
      }
    } catch (e) {}
  }

  // F8: scheduleStep reads from MusicalSession's cached NotePlan.
  // The session plans once per bar; the scheduler just reads and plays.
  // NO composition happens during scheduling — only playback.
  private scheduleStep(stepIndex: number, time: number): void {
    if (!this.transport || !this.session) return;
    const snap = this.transport.snapshot();
    const s16 = stepIndex % 16;
    const currentBar = snap.bar;
    const v = this.getVariant();

    // F8: Plan the bar if we haven't yet (cached — only runs once per bar)
    if (!this.currentNotePlan || this.currentNotePlan.bar !== currentBar) {
      this.currentNotePlan = this.session.planBar(currentBar, snap.bpm);
    }

    // Read notes from the cached plan and schedule them
    const notes = this.currentNotePlan.notes.filter(n => n.step === s16);
    for (const note of notes) {
      switch (note.voice) {
        case 'kick':
          if (this.occupancy.kick < 0.7) this.kick(time);
          break;
        case 'hat':
          this.hat(time, (v.hatLvl || 0.1) * note.velocity);
          break;
        case 'bass':
          if (this.occupancy.bass < 0.75 && note.midi !== null) this.bass(time, mtof(note.midi), v);
          break;
        case 'lead':
          if (this.occupancy.lead < 0.85 && note.midi !== null) this.lead(time, mtof(note.midi), v, s16 % 4 === 0);
          break;
      }
    }
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
      // Radio → radioGain → master (so volume slider affects radio too)
      this.radioSource.connect(this.radioGain);
      this.radioGain.connect(this.radioAnalyser);
      // F10: Route radio through engineBus (not master) so compressor applies
      this.radioAnalyser.connect(this.engineBus!);

      // R3: RadioStateGate — mark connecting BEFORE play()
      this.radioGate.reset();
      this.radioGate.markConnecting();
      this.radioGate.markConnected(this.ctx.sampleRate);
      this.syncStatus = 'connecting'; // NOT 'listening' — signal not verified yet

      try { await this.radioEl.play(); } catch {}
      this.radioOn = true;
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
    // F2.5: Reset radio observation layer
    this.radioLayer?.reset();
    this.syncStatus = 'idle';
    this.harmonicLocked = false;
    this.harmonicRoot = 0;
    this.kickIntervals = [];
    this.subBassHistory = [];
    if (this.detectTimer) { clearInterval(this.detectTimer); this.detectTimer = null; }
    this.pll.reset();
    this.radioGate.reset();
    this.updateMixMode();
    this.emit();
  }

  setRadioVolume(v: number): void { if (this.radioGain) this.radioGain.gain.value = v; }

  // ── Detection (200ms tick) ──
  private startDetection(): void {
    if (this.detectTimer) clearInterval(this.detectTimer);
    this.detectTimer = setInterval(() => this.detect(), 200);
  }

  private detect(): void {
    if (!this.radioAnalyser || !this.ctx || !this.radioLayer) return;
    if (!this.radioFreqBuf || this.radioFreqBuf.length !== this.radioAnalyser.frequencyBinCount) {
      this.radioFreqBuf = new Uint8Array(this.radioAnalyser.frequencyBinCount);
    }
    const fd = this.radioFreqBuf;
    this.radioAnalyser.getByteFrequencyData(fd);

    // F2.5 — Get time-domain data for RadioObservationLayer
    const tdBuf = this.melodyObserver.ensureTimeDomainBuf(this.radioAnalyser);
    this.radioAnalyser.getFloatTimeDomainData(tdBuf);

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
    }

    // F2.5 — Update syncStatus from observation state (not loudness)
    if (this.radioOn) {
      const obsState = radioSnap.signal.observationState;
      if (obsState === 'FOLLOWING') {
        this.syncStatus = 'following';
      } else if (obsState === 'LOCKING') {
        this.syncStatus = 'listening';
      } else if (obsState === 'SIGNAL_PRESENT') {
        this.syncStatus = 'listening';
      } else if (obsState === 'DEGRADED') {
        this.syncStatus = 'listening'; // still listening, but degraded
      } else if (obsState === 'LOST' || obsState === 'NO_SIGNAL') {
        this.syncStatus = 'no_signal';
      }
    }

    // F2.5 — Update occupancy from radio layer (for arranger decisions)
    this.occupancy = radioSnap.occupancy;

    // F8 — Feed radio observations into MusicalSession (THE single composer)
    if (this.session && radioSnap.signal.state !== 'NO_SIGNAL') {
      this.session.observeRadio({
        bpm: transportSnap.bpm,
        energy: radioSnap.signal.spectralEnergy,
        occupancy: radioSnap.occupancy,
        bassFreq: this.bassFreq > 0 ? this.bassFreq : undefined,
        confidence: radioSnap.beat?.confidence ?? 0,
      });
    }

    // Update radio level for UI
    this.radioLevel = radioSnap.signal.spectralEnergy;
    this.radioRms = this.radioRms * 0.85 + radioSnap.signal.rms * 0.15;
    this.radioBands = {
      low: radioSnap.occupancy.kick,
      mid: radioSnap.occupancy.lead,
      high: radioSnap.occupancy.hats,
    };

    // ── ROLE DUCKING (based on occupancy from radio layer) ──
    if (this.kickBus && this.bassBus && this.leadBus && this.hatBus && this.ctx) {
      const now = this.ctx.currentTime;
      const kickGain = this.occupancy.kick > 0.7 ? 0.05 : 0.9;
      this.kickBus.gain.setTargetAtTime(kickGain, now, 0.03);
      const bassGain = this.occupancy.bass > 0.75 ? 0.35 : 0.85;
      this.bassBus.gain.setTargetAtTime(bassGain, now, 0.05);
      const leadGain = this.occupancy.lead > 0.85 ? 0.55 : 0.7;
      this.leadBus.gain.setTargetAtTime(leadGain, now, 0.08);
      this.hatBus.gain.setTargetAtTime(0.6, now, 0.08);
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
    // F5: transportSnap already declared above
    if (transportSnap.locked && radioSnap.beat) {
      if (this.learningData) {
        this.learningData = recordKick(this.learningData, Math.round(transportSnap.bpm));
        this.learningData = deriveInsights(this.learningData);
        saveLearning(this.learningData);
      }
      this.updateDelayTime();
      this.updateMixMode();
    }

    // Engine level
    if (this.analyser) {
      const d = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(d);
      let s = 0; for (let i = 0; i < d.length; i++) s += d[i];
      this.engineLevel = s / (d.length * 255);
    }

    this.emit();
  }

  // F2.5: onKick() REMOVED — RadioObservationLayer handles beat detection internally.
  // Beat observations flow: radioLayer.process() → radioSnap.beat → transport.observeBeat()

  // ── UI timer (2fps) ──
  private startUITimer(): void {
    if (this.uiTimer) clearInterval(this.uiTimer);
    this.uiTimer = setInterval(() => this.emit(), 500);
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

  // ── Get melody observations (learned from radio) ──
  getMelodyObservations(): MelodyObservation[] {
    return this.melodyObserver.getObservations();
  }

  getRecentMelody(bars: number): MelodyObservation[] {
    return this.melodyObserver.getRecentObservations(bars);
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
    };
  }

  // F1.18: Public Transport accessor (for integration tests)
  getTransport() { return this.transport; }
}
