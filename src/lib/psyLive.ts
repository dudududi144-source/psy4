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
    });
  }

  // ── Audio init ──
  private ensureAudio(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

    // Shared master limiter — SOFT glue, not brickwall (was too aggressive)
    this.masterLimiter = this.ctx.createDynamicsCompressor();
    this.masterLimiter.threshold.value = -0.5;  // was -3 (caught too much)
    this.masterLimiter.knee.value = 3;            // softer knee
    this.masterLimiter.ratio.value = 4;           // was 12 (brickwall), now gentle glue
    this.masterLimiter.attack.value = 0.005;
    this.masterLimiter.release.value = 0.18;

    // User-facing master volume — was 0.7 (chopped 30%), now 0.9
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.9;

    this.masterLimiter.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);

    // Engine analyser (post-sidechain, pre-limiter)
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.5; // less smoothing = more responsive level

    // Engine bus: voices → sidechain → EQ → engineMaster → analyser → limiter
    this.sidechain = this.ctx.createGain();
    this.sidechain.gain.value = 1.0;

    this.engineEQ = this.ctx.createBiquadFilter();
    this.engineEQ.type = 'lowshelf';
    this.engineEQ.frequency.value = 200;
    this.engineEQ.gain.value = 0; // adaptive

    this.engineMaster = this.ctx.createGain();
    this.engineMaster.gain.value = 0.92; // sits loud in mix

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

    // Load learning (real system with scale detection)
    this.learningData = loadLearning();
    this.learningData.sessions = (this.learningData.sessions || 0) + 1;
    this.getDeviceId();
    this.refreshLearned();
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
      // Generate from learned data
      this.composition = generateComposition(this.learningData);
      if (!this.composition) return false;
      this.compositionMode = true;
      this.engineBpm = this.composition.bpm;
      this.syncDelay();
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

  // ── Play / Stop ──
  play(): void {
    this.ensureAudio();
    if (this.playing) return;
    this.playing = true;
    this.updateMixMode();
    this.step = 0;
    this.nextNoteTime = this.ctx!.currentTime + 0.08;
    this.syncDelay();
    this.timer = setInterval(() => this.scheduler(), 25);
    this.emit();
  }

  stop(): void {
    this.playing = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.updateMixMode();
    this.emit();
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
    while (this.nextNoteTime < this.ctx.currentTime + 0.12) {
      this.scheduleStep(this.step, this.nextNoteTime);
      const spb = 60 / this.engineBpm;
      this.nextNoteTime += 0.25 * spb;
      this.step = (this.step + 1) % 16;
    }
    // Ensure auto-level runs even without radio (SOLO mode)
    if (!this.radioOn && this.step % 8 === 0) {
      this.autoLevel();
    }
    // Periodic state emit so UI shows live levels
    if (this.step % 2 === 0) {  // every 2 steps (faster updates)
      if (this.analyser) {
        const d = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(d);
        const activeBins = Math.floor(d.length / 4);
        let peak = 0; let sum = 0;
        for (let i = 0; i < activeBins; i++) {
          if (d[i] > peak) peak = d[i];
          sum += d[i];
        }
        const avg = sum / (activeBins * 255);
        const pk = peak / 255;
        const instant = pk * 0.85 + avg * 0.15;
        // Peak hold: keep max for 500ms, then decay slowly
        if (instant > this.engineLevel) {
          this.engineLevel = instant;
        } else {
          // Slow decay (0.95 per read = ~2s to halve)
          this.engineLevel = this.engineLevel * 0.95;
        }
      }
      this.emit();
    }
  }

  private scheduleStep(step: number, t: number): void {
    const p = this.getPreset();
    const v = this.getVariant();
    const reinforcing = this.mixMode === 'reinforce';
    const barPos = this.step % 16;
    const isFill = barPos === 14 || barPos === 15; // fill at end of bar

    // COMPOSITION MODE: use generated pattern + extra layers
    if (this.compositionMode && this.composition) {
      const cp = this.composition.pattern;
      const root = this.composition.rootMidi;
      if (cp.kick[step]) this.playKick(t);
      if (cp.hat[step]) this.playHat(t, v.hatLvl);
      const b = cp.bass[step];
      if (b !== null && b !== undefined) {
        this.playBass(t, mtof(root + b), v);
        this.playSubBass(t, mtof(root + b)); // sub-bass layer
      }
      const l = cp.lead[step];
      if (l !== null && l !== undefined) this.playLead(t, mtof(root + 24 + l), v, step % 4 === 0, true);
      // ARP: play on every step (fast melodic motion)
      if (this.composition.scale) {
        const arpDeg = this.composition.scale.intervals[step % this.composition.scale.intervals.length];
        this.playArp(t, mtof(root + 12 + arpDeg), step % 4 === 0, step);
      }
      // PAD: play at start of each bar (sustained chord)
      if (barPos === 0 && this.composition.scale) {
        const chordFreqs = this.composition.scale.intervals.slice(0, 3).map(iv => mtof(root + 12 + iv));
        this.playPad(t, chordFreqs, (60 / this.composition.bpm) * 4); // 1 bar duration
      }
      // Snare on offbeat (step 4, 12)
      if (barPos === 4 || barPos === 12) this.playSnare(t, 0.15);
    } else {
      // KICK: in reinforce mode, kicks come from radio detection (skip pattern)
      if (!reinforcing && p.patterns.kick[step]) {
        this.playKick(t);
      }

      // HAT — always play
      if (p.patterns.hat[step]) this.playHat(t, v.hatLvl);

      // BASS — tune to radio's detected key + add sub-bass layer
      const b = p.patterns.bass[step];
      if (b !== null && b !== undefined) {
        const root = this.harmonicLocked && this.harmonicRoot ? this.harmonicRoot : p.root;
        this.playBass(t, mtof(root + b), v);
        this.playSubBass(t, mtof(root + b)); // sub-bass layer for weight
      }

      // LEAD — in reinforce mode, sparse (only accented steps)
      const l = p.patterns.lead[step];
      if (l !== null && l !== undefined) {
        const skipInReinforce = reinforcing && (step % 4 !== 0);
        if (!skipInReinforce) {
          const root = this.harmonicLocked && this.harmonicRoot ? this.harmonicRoot : p.root;
          this.playLead(t, mtof(root + 24 + l), v, step % 4 === 0, true);
        }
      }

      // ARP: add arpeggiator when harmonic locked (follows scale)
      if (this.harmonicLocked && this.harmonicRoot) {
        // Simple scale-degree cycling
        const scaleDegrees = [0, 3, 5, 7, 5, 3]; // arpeggio pattern
        const deg = scaleDegrees[step % scaleDegrees.length];
        this.playArp(t, mtof(this.harmonicRoot + 12 + deg), step % 4 === 0, step);
      }

      // PAD: sustained chord at start of each bar (when harmonic locked)
      if (barPos === 0 && this.harmonicLocked && this.harmonicRoot) {
        const chordDegrees = [0, 3, 7]; // root, third, fifth
        const chordFreqs = chordDegrees.map(iv => mtof(this.harmonicRoot + 12 + iv));
        const barDur = (60 / this.engineBpm) * 4;
        this.playPad(t, chordFreqs, barDur);
      }

      // Snare on offbeats (4, 12) — adds groove
      if (barPos === 4 || barPos === 12) this.playSnare(t, 0.12);

      // Fill at end of bar (steps 14, 15) — extra hats
      if (isFill) this.playHat(t, v.hatLvl * 1.5);
    }

    // Update engine level
    if (this.analyser) {
      const d = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(d);
      let s = 0; for (let i = 0; i < d.length; i++) s += d[i];
      this.engineLevel = s / (d.length * 255);
    }
  }

  // ── Smart mixing: sidechain duck on radio kick (gentle pump, not choke) ──
  private duckSidechain(t: number): void {
    if (!this.sidechain || !this.ctx) return;
    const now = t;
    // Avoid re-triggering too fast (protect against detection noise)
    if (now - this.lastDuckTime < 0.06) return;
    this.lastDuckTime = now;

    const g = this.sidechain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    // Very gentle dip to ~85% (was 60% — was choking bass/lead in REINFORCE)
    // Just enough to create pocket for radio kick, not kill our bass
    g.linearRampToValueAtTime(0.85, now + 0.01);
    g.exponentialRampToValueAtTime(1.0, now + 0.12);
    this.duckAmount = 1.0;
  }

  // ── Smart mixing: harmonic following ──
  private followHarmony(freq: number): void {
    if (freq <= 0) return;
    const midi = freqToMidi(freq);
    // Snap to nearest scale degree if locked, else accept
    this.harmonicRoot = midi - 12; // use as bass root (one octave below detected)
    this.harmonicLocked = true;
  }

  // ── Smart mixing: auto-level (engine sits LOUD, constant — not following radio) ──
  private autoLevel(): void {
    if (!this.engineMaster || !this.ctx) return;
    // FIXED loud level — engine should be CONSTANT, not following radio RMS
    // (was pulling engine down when radio was quiet — bad for psytrance)
    if (this.radioOn) {
      // With radio: sit at fixed 0.85 (loud, cuts through)
      this.engineMaster.gain.setTargetAtTime(0.85, this.ctx.currentTime, 0.8);
    } else {
      // No radio: full loud
      this.engineMaster.gain.setTargetAtTime(0.92, this.ctx.currentTime, 0.4);
    }
  }

  // ── Smart mixing: spectral-aware EQ ──
  private adaptEQ(): void {
    if (!this.engineEQ || !this.ctx || !this.radioOn) return;
    // If radio is bass-heavy, cut our low shelf slightly to make room
    const lowDensity = this.radioBands.low;
    const cut = lowDensity > 0.5 ? -(lowDensity - 0.5) * 8 : 0; // up to -4dB
    this.engineEQ.gain.setTargetAtTime(cut, this.ctx.currentTime, 0.5);
  }

  // ── Synth voices ──
  private playKick(t: number): void {
    if (!this.ctx || !this.sidechain) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.09);
    g.gain.setValueAtTime(1.0, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g); g.connect(this.sidechain);
    o.start(t); o.stop(t + 0.3);
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
  }

  private playBass(t: number, freq: number, v: Variant): void {
    if (!this.ctx || !this.sidechain) return;
    const o = this.ctx.createOscillator(); o.type = v.bassWave; o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = v.bassQ;
    f.frequency.setValueAtTime(v.bassCut, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(120, v.bassCut * 0.35), t + 0.16);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.85, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
    o.connect(f); f.connect(g); g.connect(this.sidechain);
    o.start(t); o.stop(t + 0.2);
  }

  private playLead(t: number, freq: number, v: Variant, accent: boolean, echo: boolean): void {
    if (!this.ctx || !this.sidechain) return;
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = (Math.random() * 2 - 1) * 0.5;
    const o = this.ctx.createOscillator(); o.type = v.leadWave; o.frequency.value = freq;
    const o2 = this.ctx.createOscillator(); o2.type = v.leadWave; o2.frequency.value = freq; o2.detune.value = 9;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = v.leadQ;
    f.frequency.setValueAtTime(180, t);
    f.frequency.exponentialRampToValueAtTime(v.leadCut * (accent ? 1.25 : 1), t + 0.02);
    f.frequency.exponentialRampToValueAtTime(240, t + 0.22);
    const g = this.ctx.createGain();
    const peak = v.leadLvl * (accent ? 1.0 : 0.7);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    o.connect(f); o2.connect(f); f.connect(g);
    if (pan) { g.connect(pan); pan.connect(this.sidechain); } else { g.connect(this.sidechain); }
    if (echo && this.delaySend) g.connect(this.delaySend);
    o.start(t); o2.start(t); o.stop(t + 0.26); o2.stop(t + 0.26);
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
        this.radioAnalyser.fftSize = 4096;
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
    this.detectTimer = setInterval(() => this.detect(), 20);
  }

  private detect(): void {
    if (!this.radioAnalyser || !this.ctx) return;
    const fd = new Uint8Array(this.radioAnalyser.frequencyBinCount);
    this.radioAnalyser.getByteFrequencyData(fd);

    // Sub-bass (0-100Hz) for kick detection
    let sub = 0;
    for (let i = 0; i < 10; i++) sub += fd[i];
    sub /= (10 * 255);

    // Overall RMS
    let total = 0;
    for (let i = 0; i < fd.length; i++) total += fd[i];
    total /= (fd.length * 255);
    this.radioLevel = total;
    this.radioRms = this.radioRms * 0.85 + total * 0.15; // smoothed

    // Spectral bands
    const binHz = this.ctx.sampleRate / this.radioAnalyser.fftSize;
    const lowEnd = Math.floor(250 / binHz);
    const midEnd = Math.floor(2500 / binHz);
    let lo = 0, mi = 0, hi = 0;
    for (let i = 0; i < lowEnd; i++) lo += fd[i];
    for (let i = lowEnd; i < midEnd; i++) mi += fd[i];
    for (let i = midEnd; i < fd.length; i++) hi += fd[i];
    this.radioBands = {
      low: lo / (lowEnd * 255),
      mid: mi / ((midEnd - lowEnd) * 255),
      high: hi / ((fd.length - midEnd) * 255),
    };

    // Smart mixing: auto-level + EQ adaptation (every ~10 ticks)
    if (this.kickCount % 5 === 0) {
      this.autoLevel();
      this.adaptEQ();
    }

    // Decay duck amount visualization
    this.duckAmount *= 0.88;

    // Read engine level here (in detect, runs every 20ms — more reliable than scheduler)
    if (this.analyser) {
      const d = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(d);
      const activeBins = Math.floor(d.length / 4);
      let peak = 0; let sum = 0;
      for (let i = 0; i < activeBins; i++) {
        if (d[i] > peak) peak = d[i];
        sum += d[i];
      }
      const avg = sum / (activeBins * 255);
      const pk = peak / 255;
      const instant = pk * 0.85 + avg * 0.15;
      // Peak hold with slow decay
      if (instant > this.engineLevel) {
        this.engineLevel = instant;
      } else {
        this.engineLevel = this.engineLevel * 0.95;
      }
    }

    this.subBassHistory.push(sub);
    if (this.subBassHistory.length > 50) this.subBassHistory.shift();

    // Kick detection: threshold = avg + 40% of (max - avg)
    if (this.subBassHistory.length >= 10) {
      const recent = this.subBassHistory.slice(-20);
      const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const max = Math.max(...recent);
      const threshold = avg + (max - avg) * 0.4;
      const prev = this.subBassHistory[this.subBassHistory.length - 2] || 0;

      if (sub > threshold && prev <= threshold) {
        this.onKick();
      }
    }

    // Bass freq detection (every 12 kicks)
    if (this.kickCount > 0 && this.kickCount % 12 === 0) {
      const minBin = Math.floor(40 / binHz);
      const maxBin = Math.floor(200 / binHz);
      let pk = 0, pv = 0;
      for (let i = minBin; i <= maxBin && i < fd.length; i++) {
        if (fd[i] > pv) { pv = fd[i]; pk = i; }
      }
      if (pv > 50) {
        this.bassFreq = pk * binHz;
        if (this.learningData) {
          this.learningData = recordBassNote(this.learningData, this.bassFreq);
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
