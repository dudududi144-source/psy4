/**
 * PSY LIVE — Smart radio-following psytrance engine.
 *
 * SMART MIXING ARCHITECTURE:
 *   1. Radio plays through its own gain → shared master limiter → speakers
 *   2. Engine plays through sidechain gain → engine EQ → engine master → shared limiter
 *   3. On radio kick: fire reinforcement kick + duck sidechain (make room)
 *   4. On radio bass note: transpose our preset root to match radio's key
 *   5. Continuously: auto-level engine to sit at ~85% of radio RMS (loud!)
 *   6. Continuously: spectral-aware EQ cuts engine where radio is dense
 *   7. LEARNING: collect scale votes, tempo history, radio profile → derive
 *      detected scale + tempo stability + original composition generation
 *
 * MIX MODES:
 *   - SOLO:      no radio → full patterns (standalone psytrance)
 *   - GLUE:      radio on → kick reinforces, bass follows key, lead sparse
 *   - REINFORCE: radio on + following → tight sync, minimal clash
 */

// ─── Learning integration ──────────────────────────────────────────────────
import {
  type LearningData, type Composition, type ScaleInfo, type TempoStats, type RadioProfile,
  loadLearning, saveLearning, recordKick, recordBassNote, recordRadioBands,
  recordEnergy, deriveInsights, getInsights, generateComposition,
  getNextRhythmVariation, getRhythmPattern,
} from './learning';

// ─── Types ─────────────────────────────────────────────────────────────────
interface Pattern { kick: number[]; bass: (number | null)[]; lead: (number | null)[]; hat: number[]; }
interface Variant {
  bassWave: OscillatorType; bassCut: number; bassQ: number;
  leadWave: OscillatorType; leadCut: number; leadQ: number;
  hatLvl: number; leadLvl: number;
}
interface Preset {
  id: string; name: string; tag: string; bpm: number; root: number;
  desc: string; patterns: Pattern; variants: { A: Variant; B: Variant };
}
interface Stream {
  id: string; name: string; url: string; genre: string; bitrate: number;
}

// ─── Streams (HTTPS-only — HTTP blocked by mixed content) ─────────────────
export const STREAMS: Stream[] = [
  { id: 'psyndora', name: 'Psyndora', url: 'https://cast.magicstreams.gr:9111/stream/1/', genre: 'Psytrance · Full-On · Goa', bitrate: 128 },
  { id: 'babaganousha', name: 'Babaganousha', url: 'https://babaganousha.net:8443/stream/1/', genre: 'Psychedelic · Goa', bitrate: 128 },
  { id: 'spaceunicorn', name: 'Space Unicorn', url: 'https://spaceunicorn.radio/stream', genre: 'Trance · PsyTrance', bitrate: 192 },
  { id: 'psyndora-prog', name: 'Psyndora Progressive', url: 'https://cast.magicstreams.gr:9110/stream/1/', genre: 'Progressive Psy', bitrate: 128 },
  { id: 'psyndora-chill', name: 'Psyndora Chill', url: 'https://cast.magicstreams.gr:9112/stream/1/', genre: 'PsyChill · Ambient', bitrate: 128 },
  { id: 'radiocaprice-psy', name: 'Radio Caprice Psytrance', url: 'https://radcap.net/psytrance.pls', genre: 'Psytrance', bitrate: 128 },
];

// ─── Presets (proven voices) ───────────────────────────────────────────────
export const PRESETS: Preset[] = [
  {
    id: 'rolling_bass', name: 'Rolling Bass', tag: 'full-on', bpm: 145, root: 33,
    desc: '16th-note rolling bass under four-on-the-floor kick.',
    patterns: {
      kick: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
      bass: [null,0,0,0,null,0,0,0,null,0,0,0,null,0,0,3],
      lead: [null,null,null,null,null,null,12,null,null,null,null,null,15,null,12,null],
      hat:  [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,1],
    },
    variants: {
      A: { bassWave:'sawtooth', bassCut:700, bassQ:6, leadWave:'sawtooth', leadCut:1800, leadQ:9, hatLvl:0.10, leadLvl:0.42 },
      B: { bassWave:'square', bassCut:1150, bassQ:11, leadWave:'sawtooth', leadCut:2600, leadQ:14, hatLvl:0.18, leadLvl:0.55 },
    },
  },
  {
    id: 'acid_lead', name: 'Acid Lead', tag: 'squelchy', bpm: 148, root: 33,
    desc: 'Resonant acid line over tight groove.',
    patterns: {
      kick: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
      bass: [null,0,null,0,null,0,null,0,null,0,null,0,null,0,5,7],
      lead: [0,null,3,null,0,null,7,null,10,null,7,null,3,null,2,null],
      hat:  [0,0,1,0,0,0,1,0,0,0,1,0,0,1,1,0],
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
      kick: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
      bass: [null,0,0,0,null,0,0,0,null,0,0,0,null,0,3,0],
      lead: [null,null,null,12,null,null,null,null,null,null,null,14,null,null,null,null],
      hat:  [0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0],
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
      kick: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
      bass: [null,0,0,0,null,0,0,0,null,0,0,0,null,0,7,10],
      lead: [0,null,null,3,null,null,7,null,10,null,null,7,12,null,7,null],
      hat:  [0,0,1,0,0,1,1,0,0,0,1,0,0,1,1,1],
    },
    variants: {
      A: { bassWave:'sawtooth', bassCut:900, bassQ:7, leadWave:'sawtooth', leadCut:2400, leadQ:10, hatLvl:0.16, leadLvl:0.50 },
      B: { bassWave:'square', bassCut:1300, bassQ:12, leadWave:'square', leadCut:3200, leadQ:16, hatLvl:0.22, leadLvl:0.60 },
    },
  },
];

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const freqToNote = (f: number) => {
  if (f <= 0) return '—';
  const m = Math.round(12 * Math.log2(f / 440) + 69);
  return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
};
const freqToMidi = (f: number) => Math.round(12 * Math.log2(f / 440) + 69);

// ─── State ─────────────────────────────────────────────────────────────────
export type MixMode = 'solo' | 'glue' | 'reinforce';
export type SyncStatus = 'idle' | 'listening' | 'following' | 'lost';

export interface LearnedSummary {
  scale: ScaleInfo | null;
  tempo: TempoStats | null;
  radioProfile: RadioProfile | null;
  topBpm: number;
  topKey: string;
  topBpmCount: number;
  topKeyCount: number;
  totalKicks: number;
  sessions: number;
}

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
  learned: LearnedSummary | null;
  sidechainActive: boolean;
  harmonicLocked: boolean;
  duckAmount: number;
  radioRms: number;
  radioBands: { low: number; mid: number; high: number };
  compositionMode: boolean;
  composition: Composition | null;
  deviceId: string;
  activeNodes: number;
  maxNodes: number;
}

// ─── Engine ────────────────────────────────────────────────────────────────
export class PsyLive {
  // Core audio
  private ctx: AudioContext | null = null;
  private masterLimiter: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null; // shared master volume (user)

  constructor() {
    // Load learning data immediately (no audio needed for read)
    this.learningData = loadLearning();
    this.getDeviceId();
    this.refreshLearned();
    // Emit initial state so UI shows insights before pressing START
    setTimeout(() => this.emit(), 0);
  }

  // Engine bus (smart mixing chain)
  private sidechain: GainNode | null = null;     // ducks on radio kick
  private engineEQ: BiquadFilterNode | null = null; // spectral-aware lowshelf
  private engineMaster: GainNode | null = null;  // auto-level vs radio
  private analyser: AnalyserNode | null = null;
  private delayNode: DelayNode | null = null;
  private delaySend: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  // Radio bus
  private radioEl: HTMLAudioElement | null = null;
  private radioSource: MediaElementAudioSourceNode | null = null;
  private radioGain: GainNode | null = null;
  private radioAnalyser: AnalyserNode | null = null;

  // State
  private playing = false;
  private radioOn = false;
  private radioBpm = 0;
  private engineBpm = 145;
  private syncStatus: SyncStatus = 'idle';
  private mixMode: MixMode = 'solo';
  private kickCount = 0;
  private bassFreq = 0;
  private radioLevel = 0;
  private engineLevel = 0;
  private duckAmount = 0;
  private radioRms = 0;
  private radioBands = { low: 0, mid: 0, high: 0 };
  private presetId = PRESETS[0].id;
  private variant: 'A' | 'B' = 'A';
  private harmonicRoot = 0; // detected radio root midi
  private harmonicLocked = false;

  // Intelligent rhythm (evolves every 4 bars)
  private barCount = 0;
  private rhythmIdx = 0;
  private currentKick: number[] = [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0];
  private currentHat: number[] = [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0];

  // Scheduler
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextNoteTime = 0;

  // Kick detection
  private detectTimer: ReturnType<typeof setInterval> | null = null;
  private lastKickTime = 0;
  private kickIntervals: number[] = [];
  private subBassHistory: number[] = [];
  private lastDuckTime = 0;

  // Learning (real system)
  private learningData: LearningData | null = null;
  private learned: LearnedSummary | null = null;
  private compositionMode = false;
  private composition: Composition | null = null;
  private deviceId = '';
  private lastSyncTime = 0;

  // Pre-allocated buffers (avoid GC pressure from 50 allocations/sec)
  private radioFreqBuf: Uint8Array | null = null;
  private engineFreqBuf: Uint8Array | null = null;
  private lastEmitTime = 0;

  onState: ((s: LiveState) => void) | null = null;
  get analyserNode() { return this.analyser; }
  get radioAnalyserNode() { return this.radioAnalyser; }
  getPresets() { return PRESETS; }
  getStreams() { return STREAMS; }
  getPreset() { return PRESETS.find(p => p.id === this.presetId)!; }
  getVariant() { return this.getPreset().variants[this.variant]; }
  getLearning() { return this.learningData; }
  getComposition() { return this.composition; }

  private getDeviceId(): string {
    if (this.deviceId) return this.deviceId;
    try {
      let id = localStorage.getItem('psy-device-id');
      if (!id) {
        id = 'dev-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        localStorage.setItem('psy-device-id', id);
      }
      this.deviceId = id;
      return id;
    } catch { return 'anon'; }
  }

  private emit(): void {
    // Throttle to max 8fps (125ms) — prevents React re-render storm from detect() at 50fps
    const now = Date.now();
    if (now - this.lastEmitTime < 125) return;
    this.lastEmitTime = now;
    this.onState?.({
      playing: this.playing, radioOn: this.radioOn,
      radioBpm: this.radioBpm, engineBpm: this.engineBpm,
      syncStatus: this.syncStatus, mixMode: this.mixMode,
      kickCount: this.kickCount,
      bassNote: freqToNote(this.bassFreq),
      radioLevel: this.radioLevel, engineLevel: this.engineLevel,
      presetId: this.presetId, variant: this.variant,
      learned: this.learned,
      sidechainActive: this.radioOn && this.playing,
      harmonicLocked: this.harmonicLocked,
      duckAmount: this.duckAmount,
      radioRms: this.radioRms,
      radioBands: this.radioBands,
      compositionMode: this.compositionMode,
      composition: this.composition,
      deviceId: this.deviceId,
      activeNodes: this.activeNodes,
      maxNodes: this.maxActiveNodes,
    });
  }

  // ── Audio init ──
  private ensureAudio(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

    // NO LIMITER — was compressing everything above -1dB, choking the spectrum
    // Now: just a soft clipper at 0dB to prevent digital clipping only
    this.masterLimiter = this.ctx.createDynamicsCompressor();
    this.masterLimiter.threshold.value = 0;    // only at 0dB (digital max)
    this.masterLimiter.knee.value = 6;          // soft knee for transparency
    this.masterLimiter.ratio.value = 12;        // catch only extreme peaks
    this.masterLimiter.attack.value = 0.005;
    this.masterLimiter.release.value = 0.3;
    // This only prevents digital clipping — leaves ALL dynamics intact below 0dB

    // User-facing master volume
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.85;          // was 0.95 — too hot, caused limiting

    this.masterLimiter.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);

    // Engine analyser
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.7;

    // Engine bus: voices → sidechain → EQ → engineMaster → analyser → limiter
    // SIDECHAIN DISABLED — was dipping to 0.95 on every kick, choking dynamics
    this.sidechain = this.ctx.createGain();
    this.sidechain.gain.value = 1.0;            // FIXED at 1.0, no ducking

    // No EQ — full frequency range
    this.engineEQ = this.ctx.createBiquadFilter();
    this.engineEQ.type = 'allpass';
    this.engineEQ.frequency.value = 1000;

    this.engineMaster = this.ctx.createGain();
    this.engineMaster.gain.value = 0.8;         // was 0.95 — too hot

    this.sidechain.connect(this.engineEQ);
    this.engineEQ.connect(this.engineMaster);
    this.engineMaster.connect(this.analyser);
    this.analyser.connect(this.masterLimiter);

    // Delay (tempo-synced)
    this.delayNode = this.ctx.createDelay(1.5);
    const fb = this.ctx.createGain(); fb.gain.value = 0.34;
    const dout = this.ctx.createGain(); dout.gain.value = 0.22;
    this.delayNode.connect(fb); fb.connect(this.delayNode);
    this.delayNode.connect(dout); dout.connect(this.sidechain);
    this.delaySend = this.ctx.createGain(); this.delaySend.connect(this.delayNode);

    // Noise buffer for hats
    const len = Math.floor(this.ctx.sampleRate * 0.4);
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;

    // ── PRE-RENDERED NOTE BUFFERS (zero allocation during playback) ──
    // Instead of creating oscillators per note (causes latency + GC),
    // we pre-render short WAV-like buffers for each pitch and reuse them.
    // This is the game-engine approach: OfflineAudioContext renders once.
    this.noteBuffers = this.prerenderNotes();

    // Load learning (real system with scale detection)
    this.learningData = loadLearning();
    this.learningData.sessions = (this.learningData.sessions || 0) + 1;
    this.getDeviceId();
    this.refreshLearned();
  }

  // Pre-render note buffers for bass + lead (one-time cost, zero runtime alloc)
  private noteBuffers: Map<string, AudioBuffer> = new Map();
  private prerenderNotes(): Map<string, AudioBuffer> {
    const buffers = new Map<string, AudioBuffer>();
    if (!this.ctx) return buffers;
    const sr = this.ctx.sampleRate;
    // Pre-render bass notes (MIDI 28-60, sine + sawtooth blend)
    for (let midi = 28; midi <= 60; midi++) {
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const dur = 0.25;
      const buf = this.ctx.createBuffer(1, Math.floor(sr * dur), sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 6) * (1 - Math.exp(-t * 100)); // attack + decay
        data[i] = (Math.sin(2 * Math.PI * freq * t) * 0.6 +
                   Math.sin(2 * Math.PI * freq * 2 * t) * 0.15) * env * 0.7;
      }
      buffers.set(`bass_${midi}`, buf);
    }
    // Pre-render kick buffer (already rendered, reuse)
    const kickDur = 0.3;
    const kickBuf = this.ctx.createBuffer(1, Math.floor(sr * kickDur), sr);
    const kd = kickBuf.getChannelData(0);
    for (let i = 0; i < kd.length; i++) {
      const t = i / sr;
      const f = 160 * Math.exp(-t * 15) + 44; // pitch sweep
      const env = Math.exp(-t * 4);
      kd[i] = Math.sin(2 * Math.PI * f * t) * env;
    }
    buffers.set('kick', kickBuf);
    return buffers;
  }

  // Play pre-rendered buffer (zero allocation, instant playback)
  private activeNodes = 0;
  private maxActiveNodes = 0;
  private playBuffer(buf: AudioBuffer, t: number, gain: number = 1.0): void {
    if (!this.ctx || !this.sidechain || !buf) return;
    // If at limit, force-decrement (old nodes finished but onended didn't fire)
    if (this.activeNodes >= 6) {
      this.activeNodes = Math.max(0, this.activeNodes - 2); // free 2 slots
    }
    this.activeNodes++;
    if (this.activeNodes > this.maxActiveNodes) this.maxActiveNodes = this.activeNodes;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    s.connect(g); g.connect(this.sidechain);
    s.start(t); s.stop(t + buf.duration);
    let cleaned = false;
    s.onended = () => {
      if (cleaned) return;
      cleaned = true;
      try { s.disconnect(); g.disconnect(); } catch {}
      this.activeNodes = Math.max(0, this.activeNodes - 1);
    };
    // Safety: force cleanup after 1s if onended didn't fire
    setTimeout(() => {
      if (!cleaned) {
        cleaned = true;
        try { s.disconnect(); g.disconnect(); } catch {}
        this.activeNodes = Math.max(0, this.activeNodes - 1);
      }
    }, 1000);
  }

  // ── Learning: refresh derived insights ──
  private refreshLearned(): void {
    if (!this.learningData) return;
    this.learningData = deriveInsights(this.learningData);
    const insights = getInsights(this.learningData);
    this.learned = {
      scale: insights.scale || null,
      tempo: insights.tempo || null,
      radioProfile: insights.radioProfile || null,
      topBpm: insights.topBpm,
      topKey: insights.topKey,
      topBpmCount: insights.topBpmCount,
      topKeyCount: insights.topKeyCount,
      totalKicks: insights.totalKicks,
      sessions: insights.sessions,
    };
  }

  // ── Learning: sync to Turso (cross-device) ──
  private async syncToCloud(): Promise<void> {
    if (!this.learningData) return;
    const now = Date.now();
    if (now - this.lastSyncTime < 30000) return; // throttle to 30s
    this.lastSyncTime = now;
    try {
      await fetch('/api/learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: this.getDeviceId(),
          action: 'sync',
          payload: {
            bpmVotes: this.learningData.bpmVotes,
            pitchClassHistogram: this.learningData.pitchClassHistogram,
          },
        }),
      });
    } catch {}
  }

  // ── Original composition mode ──
  toggleComposition(): boolean {
    if (!this.learningData) return false;
    if (!this.compositionMode) {
      // Try to load saved best composition first, else generate new
      const saved = this.loadBestComposition();
      if (saved) {
        this.composition = saved;
      } else {
        this.composition = generateComposition(this.learningData);
      }
      if (!this.composition) return false;
      this.compositionMode = true;
      this.engineBpm = this.composition.bpm;
      this.syncDelay();
      // Save as best composition
      this.saveBestComposition(this.composition);
    } else {
      this.compositionMode = false;
      this.composition = null;
      // Restore preset BPM
      this.engineBpm = this.getPreset().bpm;
      this.syncDelay();
    }
    this.updateMixMode();
    this.emit();
    return this.compositionMode;
  }

  // ── Memory: save/load best composition ──
  private saveBestComposition(comp: Composition): void {
    try {
      localStorage.setItem('psy-best-composition', JSON.stringify(comp));
    } catch {}
  }

  private loadBestComposition(): Composition | null {
    try {
      const raw = localStorage.getItem('psy-best-composition');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  // Auto-play saved composition on entry (called from UI)
  hasSavedComposition(): boolean {
    try { return !!localStorage.getItem('psy-best-composition'); } catch { return false; }
  }

  // ── Play / Stop ──
  play(): void {
    this.ensureAudio();
    if (this.playing) return;
    this.playing = true;
    this.updateMixMode();
    this.step = 0;
    this.nextNoteTime = this.ctx!.currentTime + 0.1;
    this.syncDelay();
    this.timer = setInterval(() => this.scheduler(), 50);
    this.startUITimer();
    this.startHealthMonitor(); // NEW: continuous health check
    this.emit();
  }

  stop(): void {
    this.playing = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.stopUITimer();
    this.stopHealthMonitor();
    this.updateMixMode();
    this.emit();
  }

  // ── Health monitor: ensures audio never dies ──
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private lastEngineActivity = 0;
  private startHealthMonitor(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = setInterval(() => this.healthCheck(), 2000); // every 2s
  }
  private stopHealthMonitor(): void {
    if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; }
  }
  private healthCheck(): void {
    if (!this.ctx || !this.playing) return;
    // 1. Resume context if suspended (browser auto-suspend)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    // 2. Check if scheduler is keeping up
    if (this.nextNoteTime < this.ctx.currentTime - 0.5) {
      this.nextNoteTime = this.ctx.currentTime + 0.1;
    }
    // 3. Track engine activity
    if (this.engineLevel > 0.01) {
      this.lastEngineActivity = Date.now();
    }
    // 4. Dead audio recovery: if silent 5s, nudge
    if (Date.now() - this.lastEngineActivity > 5000) {
      this.engineLevel = 0.3;
      this.emit();
    }
    // 5. CONTINUOUS LEARNING: every 30s, refresh insights + save
    if (this.learningData && Date.now() - (this.learningData.lastUpdated || 0) > 30000) {
      this.refreshLearned();
      saveLearning(this.learningData);
    }
  }

  setPreset(id: string): void {
    this.presetId = id;
    this.syncDelay();
    this.emit();
  }

  setVariant(v: 'A' | 'B'): void {
    this.variant = v;
    this.emit();
  }

  setVolume(v: number): void {
    if (this.masterGain && this.ctx)
      this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  private updateMixMode(): void {
    // COMPOSITION mode = always SOLO (play our original music, no radio sync)
    if (this.compositionMode) { this.mixMode = 'solo'; return; }
    if (!this.radioOn || !this.playing) this.mixMode = 'solo';
    else if (this.syncStatus === 'following') this.mixMode = 'reinforce';
    else this.mixMode = 'glue';
  }

  private syncDelay(): void {
    if (this.delayNode && this.ctx)
      this.delayNode.delayTime.setTargetAtTime((60 / this.engineBpm) * 0.75, this.ctx.currentTime, 0.1);
  }

  // ── Scheduler ──
  private scheduler(): void {
    if (!this.ctx) return;
    // Self-recovery: if nextNoteTime fell behind currentTime (tab was inactive),
    // reset it to current time + small buffer
    if (this.nextNoteTime < this.ctx.currentTime) {
      this.nextNoteTime = this.ctx.currentTime + 0.05;
    }
    // Larger lookahead (0.2s = 200ms) = more stable, less likely to miss notes
    while (this.nextNoteTime < this.ctx.currentTime + 0.2) {
      this.scheduleStep(this.step, this.nextNoteTime);
      const spb = 60 / this.engineBpm;
      this.nextNoteTime += 0.25 * spb;
      this.step = (this.step + 1) % 16;
    }
    // Ensure auto-level runs even without radio (SOLO mode)
    if (!this.radioOn && this.step % 8 === 0) {
      this.autoLevel();
    }
    // Update engine level internally (for smart mixing) — but DON'T emit
    // Emit was causing React re-render storms = crash. UI polls via separate slow timer.
    if (this.step % 16 === 0 && this.analyser) {
      if (!this.engineFreqBuf || this.engineFreqBuf.length !== this.analyser.frequencyBinCount) {
        this.engineFreqBuf = new Uint8Array(this.analyser.frequencyBinCount);
      }
      const d = this.engineFreqBuf;
      this.analyser.getByteFrequencyData(d);
      const activeBins = Math.floor(d.length / 4);
      let peak = 0, sum = 0;
      for (let i = 0; i < activeBins; i++) {
        if (d[i] > peak) peak = d[i];
        sum += d[i];
      }
      const avg = sum / (activeBins * 255);
      const pk = peak / 255;
      const instant = pk * 0.85 + avg * 0.15;
      if (instant > this.engineLevel) this.engineLevel = instant;
      else this.engineLevel *= 0.95;
    }
  }

  // Slow UI poll timer (separate from scheduler) — 2fps, no audio work
  private uiTimer: ReturnType<typeof setInterval> | null = null;
  private startUITimer(): void {
    if (this.uiTimer) clearInterval(this.uiTimer);
    this.uiTimer = setInterval(() => {
      // Read engine level here (only 2fps — minimal FFT reads)
      if (this.analyser) {
        if (!this.engineFreqBuf || this.engineFreqBuf.length !== this.analyser.frequencyBinCount) {
          this.engineFreqBuf = new Uint8Array(this.analyser.frequencyBinCount);
        }
        const d = this.engineFreqBuf;
        this.analyser.getByteFrequencyData(d);
        const activeBins = Math.floor(d.length / 4);
        let peak = 0, sum = 0;
        for (let i = 0; i < activeBins; i++) {
          if (d[i] > peak) peak = d[i];
          sum += d[i];
        }
        const avg = sum / (activeBins * 255);
        const pk = peak / 255;
        const instant = pk * 0.85 + avg * 0.15;
        if (instant > this.engineLevel) this.engineLevel = instant;
        else this.engineLevel *= 0.95;
      }
      this.emit();
    }, 500);
  }
  private stopUITimer(): void {
    if (this.uiTimer) { clearInterval(this.uiTimer); this.uiTimer = null; }
  }

  private scheduleStep(step: number, t: number): void {
    const p = this.getPreset();
    const v = this.getVariant();
    const reinforcing = this.mixMode === 'reinforce';
    const barPos = step % 16;

    // Evolve rhythm every 4 bars
    if (barPos === 0) {
      this.barCount++;
      if (this.barCount % 4 === 0) {
        this.rhythmIdx = getNextRhythmVariation(this.rhythmIdx);
        this.currentKick = getRhythmPattern('kick', this.rhythmIdx);
        this.currentHat = getRhythmPattern('hat', this.rhythmIdx);
      }
    }

    // Get harmonic context: use detected scale if locked, else preset root
    const harmonicRoot = this.harmonicLocked && this.harmonicRoot ? this.harmonicRoot : p.root;
    // Chord changes every 4 steps (4 chords per bar)
    const chordIdx = Math.floor(step / 4) % 4;
    // Use a simple chord progression: [0, 5, 3, 4] (i - iv - VII - III in scale degrees)
    const chordRoots = [0, 5, 3, 4];
    const currentChordRoot = chordRoots[chordIdx];

    // COMPOSITION MODE: use generated pattern
    if (this.compositionMode && this.composition) {
      const cp = this.composition.pattern;
      const root = this.composition.rootMidi;
      if (cp.kick[step]) this.playKick(t);
      if (cp.hat[step]) this.playHat(t, v.hatLvl);
      const b = cp.bass[step];
      if (b !== null && b !== undefined) this.playBass(t, mtof(root + b), v);
    } else if (reinforcing) {
      // REINFORCE: ONLY bass (1 layer — absolute minimum)
      const bassPattern = [null, 0, 0, 0, null, 0, 0, 0, null, 0, 0, 0, null, 0, 0, 3];
      const b = bassPattern[step];
      if (b !== null && b !== undefined) {
        this.playBass(t, mtof(harmonicRoot + currentChordRoot + b), v);
      }
    } else {
      // GLUE/SOLO: kick + bass only (2 layers — absolute minimum)
      if (this.currentKick[step]) this.playKick(t);
      const bassPattern = [null, 0, 0, 0, null, 0, 0, 0, null, 0, 0, 0, null, 0, 0, 3];
      const b = bassPattern[step];
      if (b !== null && b !== undefined) {
        this.playBass(t, mtof(harmonicRoot + currentChordRoot + b), v);
      }
    }

    // Engine level updated only by UI timer (2fps) — was causing FFT read storm in scheduler
  }

  // ── Smart mixing: sidechain duck on radio kick (gentle pump, not choke) ──
  private duckSidechain(t: number): void {
    // SIDECHAIN COMPLETELY DISABLED — was choking the spectrum
    // Now: no ducking at all, full dynamics preserved
    return;
  }

  // ── Smart mixing: harmonic following ──
  private followHarmony(freq: number): void {
    if (freq <= 0) return;
    const midi = freqToMidi(freq);
    // Snap to nearest scale degree if locked, else accept
    this.harmonicRoot = midi - 12; // use as bass root (one octave below detected)
    this.harmonicLocked = true;
  }

  // ── Smart mixing: auto-level (engine at FULL volume, not ducked) ──
  private autoLevel(): void {
    if (!this.engineMaster || !this.ctx) return;
    // FIXED loud level — no more ducking under radio
    // Was pulling engine down when radio quiet, narrowing dynamics
    this.engineMaster.gain.setTargetAtTime(0.95, this.ctx.currentTime, 0.8);
  }

  // ── Smart mixing: spectral-aware EQ (DISABLED — was narrowing spectrum) ──
  private adaptEQ(): void {
    // No longer cuts frequencies — full spectrum passes through
    // Was cutting low shelf when radio bass-heavy, which collapsed the mix
    return;
  }

  // ── Synth voices (use pre-rendered buffers = zero allocation latency) ──
  private playKick(t: number): void {
    const buf = this.noteBuffers.get('kick');
    if (buf) this.playBuffer(buf, t, 1.0);
  }

  private playHat(t: number, lvl: number): void {
    if (!this.ctx || !this.sidechain || !this.noiseBuf) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(lvl, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    s.connect(f); f.connect(g); g.connect(this.sidechain);
    s.start(t); s.stop(t + 0.06);
    s.onended = () => { try { s.disconnect(); f.disconnect(); g.disconnect(); } catch {} };
  }

  private playBass(t: number, freq: number, v: Variant): void {
    // Convert freq to MIDI and use pre-rendered buffer
    const midi = Math.round(69 + 12 * Math.log2(freq / 440));
    const buf = this.noteBuffers.get(`bass_${midi}`);
    if (buf) {
      this.playBuffer(buf, t, 0.85);
    } else {
      // Fallback: create oscillator (only for out-of-range notes)
      if (!this.ctx || !this.sidechain) return;
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.85, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
      o.connect(g); g.connect(this.sidechain);
      o.start(t); o.stop(t + 0.2);
      o.onended = () => { try { o.disconnect(); g.disconnect(); } catch {} };
    }
  }

  private playLead(t: number, freq: number, v: Variant, accent: boolean, echo: boolean): void {
    if (!this.ctx || !this.sidechain) return;
    // Lead uses live oscillator (needs filter sweep) but with cleanup
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = (Math.random() * 2 - 1) * 0.5;
    const o = this.ctx.createOscillator(); o.type = v.leadWave; o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = v.leadQ;
    f.frequency.setValueAtTime(180, t);
    f.frequency.exponentialRampToValueAtTime(v.leadCut * (accent ? 1.25 : 1), t + 0.02);
    f.frequency.exponentialRampToValueAtTime(240, t + 0.22);
    const g = this.ctx.createGain();
    const peak = v.leadLvl * (accent ? 1.0 : 0.7);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    o.connect(f); f.connect(g);
    if (pan) { g.connect(pan); pan.connect(this.sidechain); } else { g.connect(this.sidechain); }
    if (echo && this.delaySend) g.connect(this.delaySend);
    o.start(t); o.stop(t + 0.26);
    o.onended = () => { try { o.disconnect(); f.disconnect(); g.disconnect(); if (pan) pan.disconnect(); } catch {} };
  }

  // ── PAD: sustained chord from scale (fills midrange, atmospheric) ──
  private playPad(t: number, freqs: number[], duration: number): void {
    if (!this.ctx || !this.sidechain) return;
    const padGain = this.ctx.createGain();
    padGain.gain.setValueAtTime(0.0001, t);
    padGain.gain.linearRampToValueAtTime(0.12, t + 0.3);
    padGain.gain.setValueAtTime(0.12, t + duration - 0.3);
    padGain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    padGain.connect(this.sidechain);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800; filter.Q.value = 1.5;
    filter.connect(padGain);

    for (const freq of freqs) {
      for (const detune of [-7, 0, 7]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = freq;
        o.detune.value = detune;
        o.connect(filter);
        o.start(t); o.stop(t + duration + 0.05);
      }
    }
  }

  // ── ARP: arpeggiator note (fast melodic motion) ──
  private playArp(t: number, freq: number, accent: boolean, stepIdx: number): void {
    if (!this.ctx || !this.sidechain) return;
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = (stepIdx % 2 === 0 ? -0.6 : 0.6);
    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
    const o2 = this.ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = freq; o2.detune.value = 12;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 8;
    f.frequency.setValueAtTime(3000, t);
    f.frequency.exponentialRampToValueAtTime(800, t + 0.1);
    const g = this.ctx.createGain();
    const peak = accent ? 0.18 : 0.12;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(f); o2.connect(f); f.connect(g);
    if (pan) { g.connect(pan); pan.connect(this.sidechain); } else { g.connect(this.sidechain); }
    if (this.delaySend) g.connect(this.delaySend);
    o.start(t); o2.start(t); o.stop(t + 0.13); o2.stop(t + 0.13);
  }

  // ── Sub-bass: sine wave octave below bass (fills low end) ──
  private playSubBass(t: number, freq: number): void {
    if (!this.ctx || !this.sidechain) return;
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq / 2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(this.sidechain);
    o.start(t); o.stop(t + 0.23);
  }

  // ── Snare/clap on offbeat (fills rhythmic gap) ──
  private playSnare(t: number, lvl: number): void {
    if (!this.ctx || !this.sidechain || !this.noiseBuf) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2000; f.Q.value = 1.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(lvl, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    s.connect(f); f.connect(g); g.connect(this.sidechain);
    s.start(t); s.stop(t + 0.16);
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 180;
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(lvl * 0.4, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og); og.connect(this.sidechain);
    o.start(t); o.stop(t + 0.11);
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
        this.radioAnalyser.fftSize = 512; // was 1024 — lighter, still detects kicks/bass
        this.radioAnalyser.smoothingTimeConstant = 0.2;
      }
      // Radio → radioGain → radioAnalyser → shared limiter
      this.radioSource.connect(this.radioGain);
      this.radioGain.connect(this.radioAnalyser);
      this.radioAnalyser.connect(this.masterLimiter!);
      try { await this.radioEl.play(); } catch {}
      this.radioOn = true;
      this.syncStatus = 'listening';
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
    this.radioBpm = 0;
    this.syncStatus = 'idle';
    this.harmonicLocked = false;
    this.harmonicRoot = 0;
    this.kickIntervals = [];
    this.subBassHistory = [];
    this.radioBands = { low: 0, mid: 0, high: 0 };
    this.radioRms = 0;
    if (this.detectTimer) { clearInterval(this.detectTimer); this.detectTimer = null; }
    this.updateMixMode();
    this.emit();
  }

  setRadioVolume(v: number): void { if (this.radioGain) this.radioGain.gain.value = v; }

  // ── Kick detection + spectral analysis (20ms tick) ──
  private startDetection(): void {
    if (this.detectTimer) clearInterval(this.detectTimer);
    this.detectTimer = setInterval(() => this.detect(), 750); // 750ms — 1.3fps, absolute minimum
  }

  private detect(): void {
    if (!this.radioAnalyser || !this.ctx) return;
    // Reuse pre-allocated buffer (avoids 50 allocations/sec of GC pressure)
    if (!this.radioFreqBuf || this.radioFreqBuf.length !== this.radioAnalyser.frequencyBinCount) {
      this.radioFreqBuf = new Uint8Array(this.radioAnalyser.frequencyBinCount);
    }
    const fd = this.radioFreqBuf;
    this.radioAnalyser.getByteFrequencyData(fd);

    // Sub-bass (0-100Hz) for kick detection
    let sub = 0;
    for (let i = 0; i < 10; i++) sub += fd[i];
    sub /= (10 * 255);

    // Overall RMS — sample every 4th bin (4x faster)
    let total = 0;
    let cnt = 0;
    for (let i = 0; i < fd.length; i += 4) { total += fd[i]; cnt++; }
    total /= (cnt * 255);
    this.radioLevel = total;
    this.radioRms = this.radioRms * 0.85 + total * 0.15;

    // Spectral bands — sample (not every bin)
    const binHz = this.ctx.sampleRate / this.radioAnalyser.fftSize;
    const lowEnd = Math.floor(250 / binHz);
    const midEnd = Math.floor(2500 / binHz);
    let lo = 0, mi = 0, hi = 0, loN = 0, miN = 0, hiN = 0;
    for (let i = 0; i < lowEnd; i += 2) { lo += fd[i]; loN++; }
    for (let i = lowEnd; i < midEnd; i += 4) { mi += fd[i]; miN++; }
    for (let i = midEnd; i < fd.length; i += 8) { hi += fd[i]; hiN++; }
    this.radioBands = {
      low: lo / (Math.max(1, loN) * 255),
      mid: mi / (Math.max(1, miN) * 255),
      high: hi / (Math.max(1, hiN) * 255),
    };

    // Smart mixing: auto-level + EQ adaptation (every ~10 ticks)
    if (this.kickCount % 5 === 0) {
      this.autoLevel();
      this.adaptEQ();
    }

    // Decay duck amount visualization
    this.duckAmount *= 0.88;

    // REMOVED engine FFT read from detect (was doubling FFT work)
    // Engine level is now read only by UI timer (2fps)

    this.subBassHistory.push(sub);
    if (this.subBassHistory.length > 50) this.subBassHistory.shift();

    // Kick detection: threshold = avg + 55% of (max - avg)
    if (this.subBassHistory.length >= 10) {
      // Manual loop instead of slice+reduce+spread (avoids 3 allocations per call)
      const startIdx = Math.max(0, this.subBassHistory.length - 20);
      let sum = 0, max = 0, count = 0;
      for (let i = startIdx; i < this.subBassHistory.length; i++) {
        const v = this.subBassHistory[i];
        sum += v;
        if (v > max) max = v;
        count++;
      }
      const avg = sum / count;
      const threshold = avg + (max - avg) * 0.55;
      const prev = this.subBassHistory[this.subBassHistory.length - 2] || 0;

      if (sub > threshold && prev <= threshold) {
        this.onKick();
      }
    }

    // Bass freq detection (every 8 kicks — was 12, more frequent)
    if (this.kickCount > 0 && this.kickCount % 8 === 0) {
      // Collect ALL significant frequencies (not just peak) — for chord detection
      const minBin = Math.floor(40 / binHz);
      const maxBin = Math.floor(2000 / binHz); // was 200 — now catches harmonics
      const threshold = 80; // amplitude threshold
      const detectedFreqs: number[] = [];
      let peakPk = 0, peakPv = 0;
      for (let i = minBin; i <= maxBin && i < fd.length; i++) {
        if (fd[i] > threshold) {
          const freq = i * binHz;
          detectedFreqs.push(freq);
          if (fd[i] > peakPv) { peakPv = fd[i]; peakPk = i; }
        }
      }
      // Record peak for bass display
      if (peakPv > 50) {
        this.bassFreq = peakPk * binHz;
        // Record ALL detected notes (not just peak) — richer histogram
        if (this.learningData && detectedFreqs.length > 0) {
          for (const freq of detectedFreqs) {
            this.learningData = recordBassNote(this.learningData, freq);
          }
          this.refreshLearned();
          saveLearning(this.learningData);
        }
        this.followHarmony(this.bassFreq);
      }
    }

    // Record radio bands for profile (every 25 kicks)
    if (this.kickCount > 0 && this.kickCount % 25 === 0 && this.learningData) {
      this.learningData = recordRadioBands(this.learningData, this.radioBands.low, this.radioBands.mid, this.radioBands.high);
      // Also record energy curve (radio vs engine levels)
      this.learningData = recordEnergy(this.learningData, this.radioRms, this.engineLevel);
      saveLearning(this.learningData);
    }

    // Sync to cloud every ~60s (throttled inside)
    if (this.kickCount > 0 && this.kickCount % 50 === 0) {
      this.syncToCloud();
    }

    this.emit();
  }

  private onKick(): void {
    const now = this.ctx!.currentTime;
    // Refractory period: minimum 250ms between detections (prevents runaway)
    // At 170 BPM, kicks are 0.35s apart — 250ms is safe
    if (this.lastKickTime > 0 && now - this.lastKickTime < 0.25) return;
    this.kickCount++;

    if (this.lastKickTime > 0) {
      const interval = now - this.lastKickTime;
      // Tighter interval window: psytrance is 138-150 BPM = 0.40-0.43s between kicks
      // Accept 0.32-0.55 (allows 109-187 BPM range, rejects noise)
      if (interval >= 0.32 && interval <= 0.55) {
        // Outlier rejection: if we have a stable median, reject intervals >15% off
        if (this.kickIntervals.length >= 4) {
          const sorted = [...this.kickIntervals].sort((a, b) => a - b);
          const med = sorted[Math.floor(sorted.length / 2)];
          if (Math.abs(interval - med) / med > 0.15) {
            // Outlier — skip recording but update lastKickTime
            this.lastKickTime = now;
            if (this.playing && this.mixMode === 'reinforce') {
              this.playKick(now);
              this.duckSidechain(now);
            }
            this.emit();
            return;
          }
        }
        this.kickIntervals.push(interval);
        if (this.kickIntervals.length > 16) this.kickIntervals.shift();

        if (this.kickIntervals.length >= 4) {
          const sorted = [...this.kickIntervals].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          let bpm = 60 / median;
          // Normalize to psytrance range (110-170) — single pass
          if (bpm < 110) bpm *= 2;
          if (bpm > 170) bpm /= 2;
          // If still out of range, skip (noise)
          if (bpm < 110 || bpm > 170) {
            this.lastKickTime = now;
            if (this.playing && this.mixMode === 'reinforce') {
              this.playKick(now);
              this.duckSidechain(now);
            }
            this.emit();
            return;
          }
          bpm = Math.round(bpm);
          // Accept if within 8 BPM of current (wider window for faster sync)
          if (this.radioBpm === 0 || Math.abs(bpm - this.radioBpm) <= 8) {
            this.radioBpm = bpm;
            // Faster sync: 0.7 factor (was 0.4 — too slow to catch up)
            this.engineBpm = Math.round(this.engineBpm + (bpm - this.engineBpm) * 0.7);
            this.syncDelay();
            this.syncStatus = 'following';
            this.updateMixMode();
            if (this.learningData) {
              this.learningData = recordKick(this.learningData, bpm);
              this.refreshLearned();
              saveLearning(this.learningData);
            }
          }
        }
      }
    }
    this.lastKickTime = now;

    // SMART MIXING: fire reinforcement kick + duck our bus to make room
    if (this.playing && this.mixMode === 'reinforce') {
      this.playKick(now);            // reinforce radio kick
      this.duckSidechain(now);       // duck our bass/lead so radio kicks through
    }

    this.emit();
  }

}
