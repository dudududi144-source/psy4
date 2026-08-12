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
import { SOUND_BANK, getById, autoSelect, type SoundPreset } from './soundBank';
import { BeatPLL } from './beatPLL';
import { mutatePattern, type Pattern } from './patternMutator';

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
export type SyncStatus = 'idle' | 'listening' | 'following';

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
  private radioBpm = 0;
  private engineBpm = 145;
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

  // Beat PLL (phase-locked loop for beat sync)
  private pll: BeatPLL = new BeatPLL();

  // Pattern mutation (evolves every 8 bars)
  private livePattern: Pattern | null = null;
  private barCount = 0;

  // Scheduler (like psy — 25ms lookahead, 150ms schedule ahead)
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextNoteTime = 0;
  private readonly lookahead = 25;
  private readonly scheduleAheadTime = 0.15;
  private readonly totalSteps = 64;

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
    this.onState?.({
      playing: this.playing, radioOn: this.radioOn,
      radioBpm: this.radioBpm, engineBpm: this.engineBpm,
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
    });
  }

  // ── Audio init (EXACTLY like psy) ──
  private ensureAudio(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

    // Simple chain: voices → master → analyser → destination
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.7;
    this.master.connect(this.analyser);
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

    // ── PER-ROLE BUSES (from architecture review) ──
    // Each voice connects to its role bus → engineBus → gentle comp → master
    this.kickBus = this.ctx.createGain(); this.kickBus.gain.value = 0.9;
    this.bassBus = this.ctx.createGain(); this.bassBus.gain.value = 0.85;
    this.leadBus = this.ctx.createGain(); this.leadBus.gain.value = 0.7;
    this.hatBus = this.ctx.createGain(); this.hatBus.gain.value = 0.6;
    
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
    const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.09);
    gain.gain.setValueAtTime(1.0, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(gain); gain.connect(this.kickBus);
    osc.start(t); osc.stop(t + 0.32);
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
    const fStart = Math.max(60, v.bassCut), fEnd = Math.max(80, v.bassCut * 0.35);
    filter.frequency.setValueAtTime(fStart, t);
    filter.frequency.exponentialRampToValueAtTime(fEnd, t + 0.16);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.85, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(filter); filter.connect(gain); gain.connect(this.bassBus);
    if (this.delaySend) { const send = this.ctx.createGain(); send.gain.value = 0.12; gain.connect(send); send.connect(this.delaySend); }
    osc.start(t); osc.stop(t + 0.22);
  }

  private lead(t: number, freq: number, v: Variant, accent: boolean): void {
    if (!this.ctx || !this.leadBus) return;
    const peakCut = Math.max(200, v.leadCut * (accent ? 1.25 : 1));
    const o1 = this.ctx.createOscillator(), o2 = this.ctx.createOscillator();
    o1.type = v.leadWave; o2.type = v.leadWave;
    o1.frequency.value = freq; o2.frequency.value = freq * Math.pow(2, 9 / 1200);
    const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = v.leadQ;
    filter.frequency.setValueAtTime(180, t);
    filter.frequency.exponentialRampToValueAtTime(peakCut, t + 0.02);
    filter.frequency.exponentialRampToValueAtTime(240, t + 0.22);
    const gain = this.ctx.createGain();
    const peak = Math.max(0.05, v.leadLvl * (accent ? 1 : 0.7));
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    o1.connect(filter); o2.connect(filter); filter.connect(gain); gain.connect(this.leadBus);
    if (this.delaySend) { const send = this.ctx.createGain(); send.gain.value = 0.3; gain.connect(send); send.connect(this.delaySend); }
    o1.start(t); o2.start(t); o1.stop(t + 0.26); o2.stop(t + 0.26);
  }

  // ── Play / Stop (like psy) ──
  play(): void {
    this.ensureAudio();
    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextNoteTime = this.ctx!.currentTime + 0.06;
    this.updateDelayTime();
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
    this.barCount = 0;
    const p = this.getPreset();
    this.engineBpm = p.bpm;
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

  private stepDur(): number { return 60 / this.engineBpm / 4; }

  private updateMixMode(): void {
    if (this.compositionMode) { this.mixMode = 'solo'; return; }
    if (!this.radioOn || !this.playing) this.mixMode = 'solo';
    else if (this.syncStatus === 'following') this.mixMode = 'reinforce';
    else this.mixMode = 'glue';
  }

  // ── Scheduler — beat-synced via PLL ──
  // When PLL is locked: schedule steps on predicted radio beats
  // When PLL not locked (solo/no radio): use own clock like psy
  private scheduler(): void {
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;

      // If PLL is locked, sync to radio beats
      if (this.pll.isLocked() && this.radioOn) {
        // Get predicted beats for the next 200ms
        const beats = this.pll.predictBeats(now, 0.2);
        const period = 60 / this.pll.getBpm();
        const stepDur = period / 4; // 16th notes

        for (const beatTime of beats) {
          // Schedule 4 sixteenth notes per beat
          for (let s = 0; s < 4; s++) {
            const stepTime = beatTime + s * stepDur;
            if (stepTime > now && stepTime < now + this.scheduleAheadTime) {
              // Only schedule if we haven't already scheduled this step
              const stepKey = Math.round(stepTime * 1000);
              if (stepKey > this.lastScheduledStepKey) {
                this.scheduleStep(this.step % 16, stepTime);
                this.lastScheduledStepKey = stepKey;
                this.step = (this.step + 1) % this.totalSteps;
              }
            }
          }
        }
      } else {
        // No PLL lock — use own clock (like psy)
        while (this.nextNoteTime < now + this.scheduleAheadTime) {
          this.scheduleStep(this.step, this.nextNoteTime);
          this.nextNoteTime += this.stepDur();
          this.step = (this.step + 1) % this.totalSteps;
        }
      }
    } catch (e) {}
  }

  private lastScheduledStepKey = 0;

  private scheduleStep(step: number, time: number): void {
    const p = this.getPreset();
    const v = this.getVariant();
    const s16 = step % 16;

    // ── PATTERN MUTATION: evolve every 8 bars ──
    if (s16 === 0) {
      this.barCount++;
      if (this.barCount % 8 === 0) {
        // Time to mutate!
        const basePattern = this.livePattern || p.patterns;
        const mutated = mutatePattern(basePattern, this.occupancy, this.musicState.density);
        if (mutated) {
          this.livePattern = mutated;
          console.log('[MUTATE] pattern evolved, bar', this.barCount);
        }
      }
    }

    // Use live pattern if available, else preset pattern
    const pat = this.livePattern || p.patterns;

    // Use detected root if locked, else preset root
    const root = this.harmonicLocked && this.harmonicRoot ? this.harmonicRoot : p.root;

    // ── ARRANGER: decide what to play based on occupancy ──
    const kickAvailable = this.occupancy.kick < 0.7;
    const bassAvailable = this.occupancy.bass < 0.75;
    const leadAvailable = this.occupancy.lead < 0.85;
    const density = this.musicState.density;

    // Kick: only if role is available AND density allows
    if (kickAvailable && pat.kick && pat.kick[s16] && Math.random() < density) {
      this.kick(time);
    }
    // Hats: always available (fills high end)
    if (pat.hat && pat.hat[s16]) this.hat(time, v.hatLvl || 0.1);

    // Bass: only if role is available
    if (bassAvailable) {
      const bn = pat.bass ? pat.bass[s16] : null;
      if (bn !== null && bn !== undefined) this.bass(time, mtof(root + bn), v);
    }

    // Lead: only if role is available AND density is high enough
    if (leadAvailable && density > 0.4) {
      const ln = pat.lead ? pat.lead[s16] : null;
      if (ln !== null && ln !== undefined) this.lead(time, mtof(root + 24 + ln), v, s16 % 4 === 0);
    }
  }

  // ── Composition mode ──
  toggleComposition(): boolean {
    if (!this.learningData) return false;
    if (!this.compositionMode) {
      this.composition = generateComposition(this.learningData);
      if (!this.composition) return false;
      this.compositionMode = true;
      this.engineBpm = this.composition.bpm;
      this.updateDelayTime();
    } else {
      this.compositionMode = false;
      this.composition = null;
      this.engineBpm = this.getPreset().bpm;
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
      this.radioAnalyser.connect(this.master!);
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
    if (this.detectTimer) { clearInterval(this.detectTimer); this.detectTimer = null; }
    this.pll.reset();
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
    if (!this.radioAnalyser || !this.ctx) return;
    if (!this.radioFreqBuf || this.radioFreqBuf.length !== this.radioAnalyser.frequencyBinCount) {
      this.radioFreqBuf = new Uint8Array(this.radioAnalyser.frequencyBinCount);
    }
    const fd = this.radioFreqBuf;
    this.radioAnalyser.getByteFrequencyData(fd);

    let sub = 0;
    for (let i = 0; i < 10; i++) sub += fd[i];
    sub /= (10 * 255);

    let total = 0, cnt = 0;
    for (let i = 0; i < fd.length; i += 4) { total += fd[i]; cnt++; }
    total /= (cnt * 255);
    this.radioLevel = total;
    this.radioRms = this.radioRms * 0.85 + total * 0.15;

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

    // ── OCCUPANCY ANALYSIS (the key insight) ──
    // Instead of "radio loud/quiet", track WHICH ROLES the radio fills
    // Kick: sub-bass energy + transient strength
    // Bass: bass-band energy + stability
    // Lead: mid-band energy + spectral prominence
    // Hats: high-band energy
    const subEnergy = sub;
    const bassEnergy = lo / (Math.max(1, loN) * 255);
    const midEnergy = mi / (Math.max(1, miN) * 255);
    const highEnergy = hi / (Math.max(1, hiN) * 255);

    // Smooth occupancy (attack fast, release slow)
    const kickTarget = subEnergy > 0.5 ? subEnergy : subEnergy * 0.3;
    const bassTarget = bassEnergy > 0.5 ? bassEnergy : bassEnergy * 0.3;
    const leadTarget = midEnergy > 0.4 ? midEnergy * 0.8 : midEnergy * 0.2;
    const hatsTarget = highEnergy > 0.3 ? highEnergy * 0.7 : highEnergy * 0.2;

    // Fast attack, slow release
    this.occupancy.kick += (kickTarget - this.occupancy.kick) * (kickTarget > this.occupancy.kick ? 0.5 : 0.05);
    this.occupancy.bass += (bassTarget - this.occupancy.bass) * (bassTarget > this.occupancy.bass ? 0.3 : 0.05);
    this.occupancy.lead += (leadTarget - this.occupancy.lead) * (leadTarget > this.occupancy.lead ? 0.3 : 0.05);
    this.occupancy.hats += (hatsTarget - this.occupancy.hats) * (hatsTarget > this.occupancy.hats ? 0.3 : 0.05);

    // ── ROLE DUCKING (not sidechain — per-role gain) ──
    // If radio kick is strong → mute engine kick, reduce bass
    // If radio bass is strong → reduce engine bass
    // If radio lead is strong → reduce engine lead
    if (this.kickBus && this.bassBus && this.leadBus && this.hatBus && this.ctx) {
      const now = this.ctx.currentTime;
      // Kick: if radio kick > 0.7, mute engine kick
      const kickGain = this.occupancy.kick > 0.7 ? 0.05 : 0.9;
      this.kickBus.gain.setTargetAtTime(kickGain, now, 0.03);
      // Bass: if radio bass > 0.75, reduce engine bass
      const bassGain = this.occupancy.bass > 0.75 ? 0.35 : 0.85;
      this.bassBus.gain.setTargetAtTime(bassGain, now, 0.05);
      // Lead: if radio mid > 0.85, reduce engine lead
      const leadGain = this.occupancy.lead > 0.85 ? 0.55 : 0.7;
      this.leadBus.gain.setTargetAtTime(leadGain, now, 0.08);
      // Hats: if radio high > 0.9, reduce engine hats
      const hatGain = this.occupancy.hats > 0.9 ? 0.6 : 0.6;
      this.hatBus.gain.setTargetAtTime(hatGain, now, 0.08);
    }

    // ── ENERGY HISTORY (for relative energy, not absolute) ──
    this.energyHistory.push(total);
    if (this.energyHistory.length > 32) this.energyHistory.shift();

    // ── MUSIC STATE UPDATE ──
    // Energy slope (rising/falling/stable)
    if (this.energyHistory.length >= 8) {
      const recent = this.energyHistory.slice(-4).reduce((a, b) => a + b, 0) / 4;
      const older = this.energyHistory.slice(-8, -4).reduce((a, b) => a + b, 0) / 4;
      this.musicState.energy = recent;
      this.musicState.energySlope = recent - older;
    }

    // Update radio roles in music state
    this.musicState.radioRoles = { ...this.occupancy };
    this.musicState.bpm = this.radioBpm || this.engineBpm;

    // ── STYLE DETECTION (with hysteresis) ──
    const detectedStyle = this.classifyStyle();
    if (detectedStyle) {
      if (detectedStyle !== this.styleCandidate) {
        this.styleCandidate = detectedStyle;
        this.styleCandidateSince = Date.now();
      }
      // Only switch style after 8 seconds of consistent detection
      if (this.styleCandidate && Date.now() - this.styleCandidateSince > 8000) {
        if (this.styleCandidate !== this.currentStyle) {
          this.currentStyle = this.styleCandidate;
          console.log('[STYLE] switched to:', this.currentStyle);
        }
      }
    }
    this.musicState.style = this.currentStyle;

    // ── COMPETITIVE DENSITY CONTROL ──
    // If radio energy is rising, reduce engine density
    const delta = this.musicState.energySlope;
    if (delta > 0.18) {
      this.musicState.density = Math.max(0.3, this.musicState.density * 0.75);
    } else if (delta < -0.18) {
      // Radio energy falling — engine can fill more
      this.musicState.density = Math.min(0.9, this.musicState.density * 1.15);
    } else {
      // Stable — drift toward 0.7
      this.musicState.density += (0.7 - this.musicState.density) * 0.05;
    }

    // Kick detection
    this.subBassHistory.push(sub);
    if (this.subBassHistory.length > 50) this.subBassHistory.shift();
    if (this.subBassHistory.length >= 10) {
      const startIdx = Math.max(0, this.subBassHistory.length - 20);
      let sum = 0, max = 0, count = 0;
      for (let i = startIdx; i < this.subBassHistory.length; i++) {
        const v = this.subBassHistory[i];
        sum += v; if (v > max) max = v; count++;
      }
      const avg = sum / count;
      const threshold = avg + (max - avg) * 0.55;
      const prev = this.subBassHistory[this.subBassHistory.length - 2] || 0;
      if (sub > threshold && prev <= threshold) this.onKick();
    }

    // Bass freq detection
    if (this.kickCount > 0 && this.kickCount % 8 === 0) {
      const minBin = Math.floor(40 / binHz);
      const maxBin = Math.floor(2000 / binHz);
      let pk = 0, pv = 0;
      for (let i = minBin; i <= maxBin && i < fd.length; i++) {
        if (fd[i] > pv) { pv = fd[i]; pk = i; }
      }
      if (pv > 50) {
        this.bassFreq = pk * binHz;
        if (this.learningData) {
          this.learningData = recordBassNote(this.learningData, this.bassFreq);
          this.learningData = deriveInsights(this.learningData);
          saveLearning(this.learningData);
        }
        const midi = freqToMidi(this.bassFreq);
        this.harmonicRoot = midi - 12;
        this.harmonicLocked = true;
      }
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

  private onKick(): void {
    const now = this.ctx!.currentTime;
    if (this.lastKickTime > 0 && now - this.lastKickTime < 0.25) return;
    this.kickCount++;

    // ── FEED BEAT OBSERVATION TO PLL ──
    // PLL handles phase + tempo tracking (replaces old median-based BPM)
    const confidence = Math.min(1, this.radioBands.low * 2);
    this.pll.update({ time: now, confidence });

    // Sync engine BPM from PLL (smooth, not jumping)
    if (this.pll.isLocked()) {
      const pllBpm = this.pll.getBpm();
      this.radioBpm = Math.round(pllBpm);
      // Smooth engine BPM toward PLL (not jump)
      this.engineBpm = this.engineBpm + (pllBpm - this.engineBpm) * 0.3;
      this.updateDelayTime();
      this.syncStatus = 'following';
      this.updateMixMode();

      if (this.learningData) {
        this.learningData = recordKick(this.learningData, Math.round(pllBpm));
        this.learningData = deriveInsights(this.learningData);
        saveLearning(this.learningData);
      }
    }

    this.lastKickTime = now;
    this.emit();
  }

  // ── UI timer (2fps) ──
  private startUITimer(): void {
    if (this.uiTimer) clearInterval(this.uiTimer);
    this.uiTimer = setInterval(() => this.emit(), 500);
  }
  private stopUITimer(): void {
    if (this.uiTimer) { clearInterval(this.uiTimer); this.uiTimer = null; }
  }

  // ── Style classifier (from architecture review) ──
  private classifyStyle(): Style | null {
    const o = this.occupancy;
    const bpm = this.radioBpm || this.engineBpm;

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
}
