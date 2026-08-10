/**
 * PSY4 Engine V2 — based on PSY6 architecture (pooled voices, factory presets, step sequencer).
 *
 * This is a MAJOR upgrade from LiteEngine V1:
 *   - Pooled voices (persistent oscillators, no GC pressure)
 *   - 8 tracks (4 drums + 4 synth) with factory presets
 *   - Step sequencer with patterns, scenes, variation
 *   - Macros that affect real parameters
 *   - Worker-timed scheduler (jitter-resistant)
 *   - Syncs BPM and key with radio
 *   - REFERENCE PURSUIT: actively chases the radio's kick decay, spectral
 *     centroid, transient density, sub/high energy, bass decay, BPM and key.
 *
 * Sound quality comes from the 40+ factory presets adapted from PSY6.
 */

import { SeededRng, LeadMotif, AcidPattern, BASS_PATTERNS, PROGRESSIONS, scaleNote, mtof } from './musicalGrammar';
import { WORLDS, WorldId, World } from './worlds';
import { classifyStyle, styleToWorld, StyleMatch, RefFeatures } from './styleClassifier';

// ─── Constants ──────────────────────────────────────────────────────────────

const clamp = (v: number, a: number, b: number) => v < a ? a : (v > b ? b : v);

/**
 * Map a reference spectral centroid (Hz) to a target synth cutoff (Hz)
 * using log-linear interpolation. Anchor points:
 *   500Hz  ->  800 Hz cutoff (dark / warm)
 *   2000Hz -> 3000 Hz cutoff (balanced)
 *   5000Hz -> 6000 Hz cutoff (bright / cutting)
 * Falls back to clamp(centroid, 200, 12000) if out of typical range.
 */
function centroidToCutoff(centroid: number): number {
  if (!isFinite(centroid) || centroid <= 0) return 1500;
  const lc = Math.log(clamp(centroid, 80, 16000));
  // Fit using endpoints (500,800) and (5000,6000):
  //   ln(cut) = 0.8753 * ln(centroid) + 1.245
  const lcut = 0.8753 * lc + 1.245;
  return clamp(Math.exp(lcut), 200, 12000);
}

// scaleNote is imported from musicalGrammar (supports all world scales including
// phrygianDominant, harmonicMinor, doubleHarmonic, minorPentatonic).

// ─── Factory Presets (adapted from PSY6) ───────────────────────────────────

interface DrumPreset {
  type: string; tune: number; decay: number; tone: number; punch: number;
}
interface SynthPreset {
  wave1: OscillatorType; wave2: OscillatorType; oct2: number; detune: number;
  cutoff: number; res: number; fType: BiquadFilterType;
  atk: number; dec: number; sus: number; rel: number; gate: number;
  lfoRate: number; lfoDepth: number; lfoDest: string; poly: number;
}

const DRUM_PRESETS: Record<string, DrumPreset> = {
  'PS-KICK-TIGHT': { type: 'kick', tune: 0.9, decay: 0.8, tone: 1, punch: 0.85 },
  'PS-KICK-DEEP': { type: 'kick', tune: 0.7, decay: 1.4, tone: 1, punch: 0.4 },
  'PS-HAT': { type: 'hatC', tune: 1, decay: 0.32, tone: 1.2, punch: 0 },
  'PS-PERC': { type: 'tom', tune: 1.2, decay: 0.5, tone: 1, punch: 0 },
  'PS-GLITCH': { type: 'glitch', tune: 1, decay: 1.2, tone: 0.8, punch: 0 },
  'TR-CLAP': { type: 'clap', tune: 1, decay: 1.6, tone: 0.9, punch: 0 },
  'PR-SHAKER': { type: 'shaker', tune: 1, decay: 0.5, tone: 1, punch: 0 },
};

const SYNTH_PRESETS: Record<string, SynthPreset> = {
  'PS-BASS-ROLL': {
    wave1: 'sawtooth', wave2: 'square', oct2: -1, detune: 4,
    cutoff: 500, res: 9, fType: 'lowpass',
    atk: 0.005, dec: 0.1, sus: 0.2, rel: 0.05, gate: 0.3,
    lfoRate: 0, lfoDepth: 0, lfoDest: 'off', poly: 2,
  },
  'PS-BASS-DEEP': {
    wave1: 'sawtooth', wave2: 'sawtooth', oct2: -1, detune: 12,
    cutoff: 350, res: 7, fType: 'lowpass',
    atk: 0.005, dec: 0.15, sus: 0.3, rel: 0.08, gate: 0.5,
    lfoRate: 0, lfoDepth: 0, lfoDest: 'off', poly: 2,
  },
  'PS-LEAD-SQUELCH': {
    wave1: 'square', wave2: 'sawtooth', oct2: 0, detune: 8,
    cutoff: 1800, res: 10, fType: 'lowpass',
    atk: 0.005, dec: 0.18, sus: 0.4, rel: 0.15, gate: 0.45,
    lfoRate: 0, lfoDepth: 0, lfoDest: 'off', poly: 4,
  },
  'PS-LEAD-FMTEX': {
    wave1: 'sine', wave2: 'sine', oct2: 1, detune: 2,
    cutoff: 2000, res: 3, fType: 'lowpass',
    atk: 0.005, dec: 0.3, sus: 0.6, rel: 0.2, gate: 0.6,
    lfoRate: 8, lfoDepth: 0.3, lfoDest: 'cutoff', poly: 4,
  },
  'PS-PAD-PSYCH': {
    wave1: 'sawtooth', wave2: 'sine', oct2: 1, detune: 14,
    cutoff: 1000, res: 6, fType: 'lowpass',
    atk: 0.7, dec: 0.5, sus: 0.7, rel: 1.3, gate: 2.6,
    lfoRate: 0.3, lfoDepth: 0.4, lfoDest: 'cutoff', poly: 8,
  },
  'PS-ARP-ACID': {
    wave1: 'square', wave2: 'sawtooth', oct2: 0, detune: 6,
    cutoff: 1200, res: 9, fType: 'lowpass',
    atk: 0.003, dec: 0.1, sus: 0.2, rel: 0.08, gate: 0.24,
    lfoRate: 0, lfoDepth: 0, lfoDest: 'off', poly: 4,
  },
};

// ─── Track types ────────────────────────────────────────────────────────────

interface Track {
  idx: number;
  kind: 'drum' | 'synth';
  name: string;
  presetId: string;
  mix: { vol: number; pan: number; mute: boolean; sendA: number; sendB: number };
  base?: any;
}

interface StepData {
  on: number; vel: number; prob: number; note: number;
}

interface Pattern {
  name: string;
  data: Record<number, { len: number; steps: StepData[] }>;
}

// ─── Pooled Synth Voice (from PSY6 — persistent oscillators) ────────────────

class PooledSynthVoice {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  g1: GainNode;
  g2: GainNode;
  filter: BiquadFilterNode;
  vca: GainNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
  bus: GainNode | null = null;

  constructor(ctx: AudioContext) {
    this.osc1 = ctx.createOscillator();
    this.osc2 = ctx.createOscillator();
    this.g1 = ctx.createGain();
    this.g2 = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.vca = ctx.createGain();
    this.vca.gain.value = 0;
    this.lfo = ctx.createOscillator();
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 0;

    this.osc1.connect(this.g1);
    this.osc2.connect(this.g2);
    this.g1.connect(this.filter);
    this.g2.connect(this.filter);
    this.filter.connect(this.vca);
    this.lfo.connect(this.lfoGain);

    // Start persistent oscillators (never stop them)
    this.osc1.start();
    this.osc2.start();
    this.lfo.start();
  }

  connect(bus: GainNode) {
    if (this.bus !== bus) {
      this.vca.disconnect();
      this.vca.connect(bus);
      this.lfoGain.disconnect();
      this.lfoGain.connect(this.filter.frequency);
      this.bus = bus;
    }
  }

  noteOn(p: SynthPreset, when: number, midi: number, vel: number, stepDur: number, bus: GainNode) {
    this.connect(bus);
    const f = mtof(clamp(midi, 12, 108));
    const gate = p.gate || 0.6;
    const dur = stepDur * gate * 2;
    const rel = Math.max(p.rel, 0.02);
    const end = when + dur;

    this.osc1.type = p.wave1;
    this.osc2.type = p.wave2;
    this.osc1.frequency.setValueAtTime(f, when);
    this.osc2.frequency.setValueAtTime(f * Math.pow(2, p.oct2 || 0), when);
    this.osc2.detune.setValueAtTime(p.detune || 0, when);
    this.g1.gain.setValueAtTime(0.6, when);
    this.g2.gain.setValueAtTime(0.45, when);

    const cut = clamp(p.cutoff, 60, 16000);
    const res = clamp(p.res, 0.2, 24);
    this.filter.type = p.fType;
    this.filter.Q.setValueAtTime(res, when);
    this.filter.frequency.cancelScheduledValues(when);
    this.filter.frequency.setValueAtTime(Math.min(cut * 3, 16000), when);
    this.filter.frequency.exponentialRampToValueAtTime(cut, when + Math.max((p.atk + p.dec * 0.7), 0.01));

    if (p.lfoRate > 0 && p.lfoDest === 'cutoff') {
      this.lfo.frequency.setValueAtTime(p.lfoRate, when);
      this.lfoGain.gain.setValueAtTime(p.lfoDepth * 3000, when);
    } else {
      this.lfoGain.gain.setValueAtTime(0, when);
    }

    const vca = this.vca.gain;
    const atk = Math.max(p.atk, 0.003);
    vca.cancelScheduledValues(when);
    vca.setValueAtTime(0, when);
    vca.linearRampToValueAtTime(vel * 0.5, when + atk);
    vca.setTargetAtTime(vel * 0.5 * p.sus, when + atk, Math.max(p.dec / 3, 0.01));
    vca.setTargetAtTime(0.0001, end, Math.max(rel / 3, 0.008));
  }

  panic(ctx: AudioContext) {
    try {
      this.vca.gain.cancelScheduledValues(0);
      this.vca.gain.setValueAtTime(0, ctx.currentTime);
    } catch {}
  }
}

// ─── Pooled Drum Voice (from PSY6 — multi-type) ────────────────────────────

class PooledDrumVoice {
  noise: AudioBufferSourceNode;
  noiseGain: GainNode;
  nFilter: BiquadFilterNode;
  osc: OscillatorNode;
  oscGain: GainNode;
  out: GainNode;
  bus: GainNode | null = null;

  constructor(ctx: AudioContext, noiseBuffer: AudioBuffer) {
    this.noise = ctx.createBufferSource();
    this.noise.buffer = noiseBuffer;
    this.noise.loop = true;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.nFilter = ctx.createBiquadFilter();
    this.nFilter.type = 'bandpass';
    this.noise.connect(this.nFilter);
    this.nFilter.connect(this.noiseGain);
    this.osc = ctx.createOscillator();
    this.osc.type = 'sine';
    this.oscGain = ctx.createGain();
    this.oscGain.gain.value = 0;
    this.osc.connect(this.oscGain);
    this.out = ctx.createGain();
    this.noiseGain.connect(this.out);
    this.oscGain.connect(this.out);
    this.noise.start();
    this.osc.start();
  }

  connect(bus: GainNode) {
    if (this.bus !== bus) {
      this.out.disconnect();
      this.out.connect(bus);
      this.bus = bus;
    }
  }

  /**
   * Trigger this voice. The optional `decayOverride` lets callers (e.g. reference
   * pursuit) replace the preset decay with a blended value to chase the radio's
   * kick decay. It is guarded against NaN/zero/out-of-range values.
   */
  hit(p: DrumPreset, when: number, vel: number, bus: GainNode, decayOverride?: number) {
    this.connect(bus);
    const tune = p.tune || 1;
    const candidateDecay = (typeof decayOverride === 'number'
      && isFinite(decayOverride) && decayOverride > 0.001 && decayOverride < 50)
      ? decayOverride
      : null;
    const decay = candidateDecay ?? p.decay ?? 1;
    const tone = p.tone || 1;
    const punch = p.punch || 0;
    const type = p.type;
    const ng = this.noiseGain.gain;
    const og = this.oscGain.gain;
    ng.cancelScheduledValues(when);
    og.cancelScheduledValues(when);
    ng.setValueAtTime(0, when);
    og.setValueAtTime(0, when);

    if (type === 'kick') {
      const dur = 0.12 + 0.5 * decay;
      this.osc.frequency.setValueAtTime(180 * tune, when);
      this.osc.frequency.exponentialRampToValueAtTime(Math.max(36 * tune, 24), when + 0.09);
      og.setValueAtTime(vel * 1.1, when);
      og.exponentialRampToValueAtTime(0.0001, when + dur);
      if (punch > 0) {
        ng.setValueAtTime(vel * punch * 0.8, when);
        ng.exponentialRampToValueAtTime(0.0001, when + 0.02);
        this.nFilter.frequency.setValueAtTime(2500, when);
      }
    } else if (type === 'clap') {
      const dur = 0.25 + 0.15 * decay;
      this.nFilter.type = 'bandpass';
      this.nFilter.frequency.setValueAtTime(1150 * tone, when);
      this.nFilter.Q.value = 1.3;
      ng.setValueAtTime(0, when);
      [0, 0.014, 0.03].forEach(t2 => {
        ng.setValueAtTime(0, when + t2);
        ng.linearRampToValueAtTime(vel * 0.9, when + t2 + 0.002);
        ng.exponentialRampToValueAtTime(0.02, when + t2 + 0.012);
      });
      ng.exponentialRampToValueAtTime(0.0001, when + dur);
    } else if (type === 'hatC' || type === 'hatO') {
      const open = type === 'hatO';
      const dur = open ? 0.26 + 0.5 * decay : 0.03 + 0.05 * decay;
      this.nFilter.type = 'highpass';
      this.nFilter.frequency.setValueAtTime(7200 * Math.sqrt(tone), when);
      ng.setValueAtTime(vel * (open ? 0.4 : 0.5), when);
      ng.exponentialRampToValueAtTime(0.0001, when + dur);
    } else if (type === 'tom') {
      const dur = 0.22 + 0.35 * decay;
      this.osc.type = 'sine';
      this.osc.frequency.setValueAtTime(180 * tune, when);
      this.osc.frequency.exponentialRampToValueAtTime(92 * tune, when + dur * 0.7);
      og.setValueAtTime(vel * 0.9, when);
      og.exponentialRampToValueAtTime(0.0001, when + dur);
    } else if (type === 'shaker') {
      const dur = 0.04 + 0.07 * decay;
      this.nFilter.type = 'highpass';
      this.nFilter.frequency.setValueAtTime(6000 * tone, when);
      ng.setValueAtTime(vel * 0.45, when);
      ng.exponentialRampToValueAtTime(0.0001, when + dur);
    } else if (type === 'glitch') {
      const dur = 0.08 + 0.14 * decay;
      this.nFilter.type = 'bandpass';
      this.nFilter.frequency.setValueAtTime(1500 * tone + 800, when);
      this.nFilter.Q.value = 4;
      ng.setValueAtTime(vel * 0.7, when);
      ng.exponentialRampToValueAtTime(0.0001, when + dur);
    }
  }

  panic(ctx: AudioContext) {
    try {
      this.noiseGain.gain.cancelScheduledValues(0);
      this.noiseGain.gain.setValueAtTime(0, ctx.currentTime);
      this.oscGain.gain.cancelScheduledValues(0);
      this.oscGain.gain.setValueAtTime(0, ctx.currentTime);
    } catch {}
  }
}

// ─── Engine V2 ──────────────────────────────────────────────────────────────

export class Psy4EngineV2 {
  ctx: AudioContext | null = null;
  playing = false;
  analyser: AnalyserNode | null = null;

  // Musical understanding
  private musicalKey: { root: number; scale: string } = { root: 43, scale: 'phrygian' };
  private targetLufs = 0;
  private ownLufs = -30;

  // ── Reference pursuit targets (set by liveTrack, consumed by triggerDrum / ──
  //    triggerSynth / scheduleStep). All zero = no pursuit active.
  private refKickDecay = 0;          // seconds (target kick decay from radio)
  private refSpectralCentroid = 0;   // Hz (target spectral centroid from radio)
  private refTransientDensity = 0;   // transients/sec
  private refSubEnergy = 0;          // 0..1
  private refHighEnergy = 0;         // 0..1
  private refBassDecay = 0;          // seconds

  // ── Learned params from ContinuousTrainer (offline optimization). These are  ──
  //    blended ON TOP of reference pursuit + world timbre. Zero/null = not set.
  private learned: {
    kickDecay?: number;      // seconds (override for kick tail length)
    bassCutoff?: number;     // Hz (override for bass filter cutoff)
    leadCutoff?: number;     // Hz (override for lead filter cutoff)
    leadDetune?: number;     // cents (override for lead detune)
    padCutoff?: number;      // Hz (override for pad filter cutoff)
    duck?: number;           // 0..1 (sidechain depth override)
  } = {};

  // ── Full reference feature snapshot for the style classifier (Task 14) ──
  //    These are updated by liveTrack() and consumed by classifyStyle() when
  //    applyMusicalUnderstanding() needs to infer a style from features.
  private refLowEnergy = 0;
  private refMidEnergy = 0;
  private refAirEnergy = 0;
  private refStereoWidth = 0;
  private refBpm = 0;
  private refEnergy = 0;
  private refKeyScale: string | undefined = undefined;

  // ── Style classification (Task 14) — populated by applyMusicalUnderstanding() ──
  //    and read by getStyleClassification() for UI display.
  private styleMatches: StyleMatch[] = [];

  // ── Auto-switch anti-thrash guard (Task 14) ──
  //    Don't auto-switch worlds more often than every 30 seconds. Also
  //    remember the last world we switched to so we can detect no-op switches.
  private lastAutoSwitchTime = 0;
  private lastAutoSwitchWorldId: string | null = null;
  private static readonly AUTO_SWITCH_COOLDOWN_MS = 30_000;
  private static readonly AUTO_SWITCH_CONFIDENCE_THRESHOLD = 0.55;

  // ── Phrase-locked preset rotation (Task 15) ──
  //    Every 8 bars, rotate kick/bass preset between 2 variants, world-aware.
  //    (dark worlds → DEEP kick / ROLL bass; bright worlds → TIGHT kick / DEEP bass)
  private phraseCounter = 0;
  private phrasePresetVariant = 0; // 0 or 1 — alternates every 8 bars

  // ── Own measured values (set by selfTrack) — for getPursuitStatus() and ──
  //    sub/high energy balancing. Zero = no measurement yet.
  private ownSpectralCentroid = 0;
  private ownTransientDensity = 0;
  private ownSubEnergy = 0;
  private ownHighEnergy = 0;

  // ── Continuous BPM tracking — smooth ramp over 4 bars when diff > 2 BPM ──
  //    (avoids audio glitches from sudden tempo jumps)
  private targetBpm = 0;             // 0 = no active ramp
  private bpmRampPerBar = 0;         // bpm delta applied per bar
  private bpmRampBarsLeft = 0;       // bars remaining in current ramp

  // ── Musical generators — re-created on key change for true key pursuit ──
  private leadMotif: LeadMotif | null = null;
  private acidPattern: AcidPattern | null = null;
  private musicRng: SeededRng | null = null;

  // Audio graph
  private master!: GainNode;
  private comp!: DynamicsCompressorNode;
  private noiseBuffer!: AudioBuffer;
  private delaySend!: GainNode;
  private delay!: DelayNode;
  private delayFb!: GainNode;
  private delayReturn!: GainNode;
  private reverbSend!: GainNode;
  private reverb!: ConvolverNode;
  private reverbReturn!: GainNode;
  private chains: GainNode[] = [];
  private trackGains: GainNode[] = [];
  private duckGain!: GainNode;  // sidechain duck for bass track
  private saturator!: WaveShaperNode;
  private toneLow!: BiquadFilterNode;
  private toneHigh!: BiquadFilterNode;

  // Voice pools
  private synthPool: PooledSynthVoice[] = [];
  private drumPool: PooledDrumVoice[] = [];
  private synthIdx = 0;
  private drumIdx = 0;

  // Scheduler
  private timer: ReturnType<typeof setTimeout> | null = null;
  private step = 0;
  private bar = 0;
  private nextTime = 0;
  private sectionIdx = 0;
  private currentSection = 'INTRO';

  // Tracks and patterns
  private tracks: Track[] = [];
  private pattern: Pattern | null = null;
  private presetIdx = 0;

  // ── World-driven pattern engine (Track A) ──
  private currentWorld: World = WORLDS['dark-psy'];
  private arpIdx = 0;
  private bassPatternIdx = 0;

  // Arrangement
  private arrangement = [
    { bars: 4, density: 0.3, bass: false, lead: false, label: 'INTRO' },
    { bars: 4, density: 0.5, bass: true, lead: false, label: 'GROOVE' },
    { bars: 4, density: 0.7, bass: true, lead: false, label: 'BUILD' },
    { bars: 8, density: 0.9, bass: true, lead: true, label: 'DROP' },
    { bars: 4, density: 0.7, bass: true, lead: true, label: 'VARIATION' },
    { bars: 4, density: 0.3, bass: false, lead: false, label: 'BREAK' },
    { bars: 8, density: 1.0, bass: true, lead: true, label: 'FINAL DROP' },
    { bars: 4, density: 0.3, bass: true, lead: false, label: 'OUTRO' },
  ];

  onSectionChange: ((section: string) => void) | null = null;

  /**
   * Callback fired when the engine auto-switches worlds (Task 14). Lets the UI
   * update its world dropdown / "AUTO" badge without polling. The optional
   * `reason` is a human-readable explanation (e.g. the matched style name).
   */
  onWorldChange: ((worldId: string, reason?: string) => void) | null = null;

  init(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const c = this.ctx = new Ctx({ latencyHint: 'interactive' });

    // Noise buffer
    this.noiseBuffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const nd = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // Master chain — boosted + saturation + tone shelves (from PSY6/psy)
    this.master = c.createGain();
    this.master.gain.value = 1.1;

    // Saturation (WaveShaper — adds warmth and loudness)
    this.saturator = c.createWaveShaper();
    this.saturator.oversample = '4x';
    const satCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 512) - 1;
      satCurve[i] = Math.tanh(x * 1.3) * 0.7 + x * 0.3;
    }
    this.saturator.curve = satCurve;

    // Tone shelves (final EQ)
    this.toneLow = c.createBiquadFilter();
    this.toneLow.type = 'lowshelf';
    this.toneLow.frequency.value = 110;
    this.toneLow.gain.value = 1.5;
    this.toneHigh = c.createBiquadFilter();
    this.toneHigh.type = 'highshelf';
    this.toneHigh.frequency.value = 8500;
    this.toneHigh.gain.value = -2;

    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -8;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.2;
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 2048;

    // Connect: master → saturator → toneLow → toneHigh → comp → analyser → destination
    this.master.connect(this.saturator);
    this.saturator.connect(this.toneLow);
    this.toneLow.connect(this.toneHigh);
    this.toneHigh.connect(this.comp);
    this.comp.connect(this.analyser);
    this.analyser.connect(c.destination);

    // Delay (ping-pong with band-limited feedback)
    this.delaySend = c.createGain();
    this.delaySend.gain.value = 0.15;
    this.delay = c.createDelay(0.5);
    this.delay.delayTime.value = 0.375;
    this.delayFb = c.createGain();
    this.delayFb.gain.value = 0.35;
    this.delayReturn = c.createGain();
    this.delayReturn.gain.value = 0.5;
    const dLP = c.createBiquadFilter();
    dLP.type = 'lowpass';
    dLP.frequency.value = 3300;
    this.delaySend.connect(this.delay);
    this.delay.connect(dLP);
    dLP.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    this.delay.connect(this.delayReturn);
    this.delayReturn.connect(this.master);

    // Reverb
    this.reverbSend = c.createGain();
    this.reverbSend.gain.value = 0.12;
    this.reverb = c.createConvolver();
    const irLen = Math.floor(c.sampleRate * 1.5);
    const ir = c.createBuffer(2, irLen, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (c.sampleRate * 0.4));
      }
    }
    this.reverb.buffer = ir;
    this.reverbReturn = c.createGain();
    this.reverbReturn.gain.value = 0.6;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.master);

    // Track buses (8 tracks) with HPF, pan, and duck
    this.duckGain = c.createGain();
    this.duckGain.gain.value = 1.0;
    // duckGain connects to master ONCE (not twice — was causing feedback)
    this.duckGain.connect(this.master);

    for (let i = 0; i < 8; i++) {
      const bus = c.createGain();
      // HPF on each track to clean mud (except kick/bass)
      const hpf = c.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.value = i < 2 ? 20 : (i < 4 ? 80 : 120);
      // Stereo panner
      const panner = c.createStereoPanner();
      const panValues = [0, -0.15, 0.2, -0.2, 0, 0.1, -0.1, 0.15];
      panner.pan.value = panValues[i];
      // Track gain
      const gain = c.createGain();
      gain.gain.value = 0.8;

      bus.connect(hpf);
      hpf.connect(panner);
      // Bass track (4) goes through duck gain for sidechain
      if (i === 4) {
        panner.connect(this.duckGain);
      } else {
        panner.connect(gain);
        gain.connect(this.master);
      }

      // Send to delay/reverb
      const dSend = c.createGain();
      dSend.gain.value = i >= 4 ? 0.15 : 0.02;
      bus.connect(dSend);
      dSend.connect(this.delaySend);
      const rSend = c.createGain();
      rSend.gain.value = i >= 5 ? 0.2 : 0.03;
      bus.connect(rSend);
      rSend.connect(this.reverbSend);

      this.chains.push(bus);
      this.trackGains.push(gain);
    }
    // duckGain already connected to master above (line 458)

    // Allocate voice pools (20 synth + 24 drum — from PSY6)
    for (let i = 0; i < 20; i++) this.synthPool.push(new PooledSynthVoice(c));
    for (let i = 0; i < 24; i++) this.drumPool.push(new PooledDrumVoice(c, this.noiseBuffer));

    // Initialize tracks
    this.initTracks();
  }

  private initTracks(): void {
    const names = ['KICK', 'SNARE', 'HATS', 'PERC', 'BASS', 'LEAD', 'PAD', 'ARP'];
    const presets = ['PS-KICK-TIGHT', 'TR-CLAP', 'PS-HAT', 'PS-PERC', 'PS-BASS-ROLL', 'PS-LEAD-SQUELCH', 'PS-PAD-PSYCH', 'PS-ARP-ACID'];
    // Boosted track volumes for commercial loudness
    const vols = [1.0, 0.6, 0.5, 0.4, 1.2, 0.7, 0.5, 0.5];
    this.tracks = [];
    for (let i = 0; i < 8; i++) {
      this.tracks.push({
        idx: i,
        kind: i < 4 ? 'drum' : 'synth',
        name: names[i],
        presetId: presets[i],
        mix: { vol: vols[i], pan: 0, mute: false, sendA: 0, sendB: 0 },
      });
    }
    // Initialize musical generators with the default key so they exist before
    // the first key-change event arrives from the reference listener.
    this.refreshMusicalGenerators();
  }

  start(worldId?: string): void {
    this.init();
    if (this.ctx!.state === 'suspended') this.ctx!.resume();

    // ── World-driven configuration (Track A) ──
    this.currentWorld = WORLDS[worldId as WorldId] || WORLDS['dark-psy'];
    this._bpm = this.currentWorld.defaultBpm;
    this.musicalKey = {
      root: Math.floor((this.currentWorld.rootRange[0] + this.currentWorld.rootRange[1]) / 2),
      scale: this.currentWorld.defaultScale,
    };
    // Re-create musical generators with the world's key (LeadMotif, AcidPattern)
    this.refreshMusicalGenerators();
    this.arpIdx = 0;
    this.bassPatternIdx = 0;
    // Reset phrase-locked rotation counters for a clean start
    this.phraseCounter = 0;
    this.phrasePresetVariant = 0;
    // Reset auto-switch anti-thrash guard
    this.lastAutoSwitchTime = 0;
    this.lastAutoSwitchWorldId = null;
    this.styleMatches = [];

    // Apply the world's preferred kick/bass/lead presets immediately so the
    // engine starts with the right timbres (Task 15).
    this.applyWorldPresets();

    // Apply world FX mix to reverb and delay sends
    const fxMix = this.currentWorld.fxMix;
    this.reverbSend.gain.setTargetAtTime(0.04 + fxMix * 0.22, this.ctx!.currentTime, 0.05);
    this.delaySend.gain.setTargetAtTime(0.05 + fxMix * 0.30, this.ctx!.currentTime, 0.05);

    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.bar = 0;
    this.sectionIdx = 0;
    this.currentSection = this.arrangement[0].label;
    this.onSectionChange?.(this.currentSection);
    this.nextTime = this.ctx!.currentTime + 0.03;
    this.scheduleNextTick();
  }

  stop(): void {
    this.playing = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.ctx) {
      for (const v of this.synthPool) v.panic(this.ctx);
      for (const v of this.drumPool) v.panic(this.ctx);
    }
  }

  private get bpm(): number {
    return this._bpm || 145;
  }
  private _bpm = 145;

  setBpm(bpm: number): void {
    this._bpm = bpm;
  }

  applyMusicalUnderstanding(understanding: {
    key: { root: number; scale: string; confidence: number };
    bpm: number;
    bpmConfidence: number;
    style?: string;
    styleConfidence?: number;
  }): void {
    // ── KEY PURSUIT — refresh lead/acid generators when key changes ──
    // The radio's key detector returns a CHROMATIC root (0-11, C=0..B=11).
    // Our internal musicalKey.root is a MIDI note (typically 36-60). So we
    // lift the chromatic root into the bass octave (36 + root) when it's in
    // the chromatic range. If the listener ever returns a MIDI note directly
    // (> 11), we trust it as-is. NaN/undefined confidence → no-op.
    const k = understanding.key;
    const conf = typeof k?.confidence === 'number' && isFinite(k.confidence) ? k.confidence : 0;
    const rawRoot = typeof k?.root === 'number' && isFinite(k.root) ? k.root : -1;
    if (conf > 0.2 && rawRoot >= 0) {
      // Snap the root into the world's preferred rootRange so the engine
      // stays in a useful octave for the current world. We pick the octave
      // of 36 + (root mod 12) that falls inside rootRange.
      const chroma = ((rawRoot % 12) + 12) % 12;
      const worldRange = this.currentWorld.rootRange;
      let newRoot: number;
      if (rawRoot >= 12 && rawRoot >= worldRange[0] && rawRoot <= worldRange[1]) {
        // Listener returned a MIDI note already in range — trust it.
        newRoot = rawRoot;
      } else {
        // Lift chroma into an octave inside the world's rootRange.
        const lo = worldRange[0];
        const candidate = lo + (((chroma - (lo % 12)) + 12) % 12);
        newRoot = candidate;
      }
      const newScale = (typeof k.scale === 'string' && k.scale.length > 0) ? k.scale : this.musicalKey.scale;
      const changed = newRoot !== this.musicalKey.root || newScale !== this.musicalKey.scale;
      // ALWAYS update musicalKey first, then refresh generators — order matters
      // so the generators pick up the new key.
      this.musicalKey = { root: newRoot, scale: newScale };
      // Also store the scale on the ref feature snapshot so the classifier
      // can use it next time it runs.
      this.refKeyScale = newScale;
      if (changed) {
        this.refreshMusicalGenerators();
        if (typeof console !== 'undefined') {
          console.log('[PSY4] Key updated:', this.musicalKey);
        }
      }
    }

    // ── CONTINUOUS BPM TRACKING (smooth ramp for large diffs) ──
    // Always honor the new BPM when confidence is high. Small diffs (<=2 BPM)
    // are applied immediately; larger diffs ramp across 4 bars to avoid tempo
    // glitches and keep the scheduler's lookahead stable.
    if (understanding.bpm > 0 && understanding.bpmConfidence > 0.5) {
      const target = Math.round(understanding.bpm);
      this.refBpm = clamp(target, 30, 220);
      const diff = target - this._bpm;
      if (Math.abs(diff) > 2) {
        this.targetBpm = clamp(target, 60, 200);
        this.bpmRampBarsLeft = 4;
        this.bpmRampPerBar = diff / 4;
      } else {
        this._bpm = clamp(target, 60, 200);
        this.targetBpm = 0;
        this.bpmRampBarsLeft = 0;
        this.bpmRampPerBar = 0;
      }
    }

    // ── STYLE CLASSIFICATION (Task 14) ──
    // Two paths to determine the style:
    //   (a) Reference listener provided an explicit style tag with high
    //       confidence → use it directly (legacy path, kept for compat).
    //   (b) No style tag (or low confidence) → LEARN the style from the
    //       acoustic features we've accumulated in liveTrack(). This is the
    //       new spectral classifier path that addresses the user's complaint
    //       that "style must be learned, not defined by fat bass".
    // In both cases we run the classifier on the stored features so the UI
    // can render the full ranking. Auto-switch only happens when the top
    // match's confidence exceeds the threshold AND the anti-thrash cooldown
    // has elapsed.
    const features = this.buildRefFeatures();
    if (features) {
      const matches = classifyStyle(features);
      this.styleMatches = matches;

      const explicitStyle = understanding.style;
      const explicitConf = understanding.styleConfidence ?? 0;
      const topMatch = matches[0];

      if (explicitStyle && explicitConf > 0.4) {
        // Path (a): use the explicit tag — but still record matches for UI.
        // Only auto-switch if explicit tag strongly disagrees with current world.
        const explicitWorldId = styleToWorld(explicitStyle);
        if (explicitWorldId !== this.currentWorld.id && explicitConf > 0.6) {
          this.tryAutoSwitch(explicitWorldId, `explicit style tag '${explicitStyle}' (${(explicitConf * 100).toFixed(0)}%)`);
        }
      } else if (topMatch &&
                 topMatch.confidence >= Psy4EngineV2.AUTO_SWITCH_CONFIDENCE_THRESHOLD) {
        // Path (b): learn from features and auto-switch if confident.
        const targetWorldId = styleToWorld(topMatch.style);
        if (targetWorldId !== this.currentWorld.id) {
          const reason = topMatch.reasons[0] || `style '${topMatch.style}' (${(topMatch.confidence * 100).toFixed(0)}%)`;
          this.tryAutoSwitch(targetWorldId, reason);
        }
      }
    }
  }

  /**
   * Build a RefFeatures snapshot from the stored reference metrics.
   * Returns null if we don't have enough features to classify meaningfully
   * (need at least BPM or centroid + one energy band).
   */
  private buildRefFeatures(): RefFeatures | null {
    const hasBpm = this.refBpm > 0;
    const hasCentroid = this.refSpectralCentroid > 0;
    const hasEnergy = this.refSubEnergy > 0 || this.refHighEnergy > 0 ||
                      this.refLowEnergy > 0 || this.refMidEnergy > 0;
    if (!hasBpm && !hasCentroid && !hasEnergy) return null;

    return {
      bpm: this.refBpm,
      spectralCentroid: this.refSpectralCentroid,
      subEnergy: this.refSubEnergy,
      lowEnergy: this.refLowEnergy,
      midEnergy: this.refMidEnergy,
      highEnergy: this.refHighEnergy,
      airEnergy: this.refAirEnergy,
      transientDensity: this.refTransientDensity,
      kickDecayMs: this.refKickDecay * 1000,
      bassDecayMs: this.refBassDecay * 1000,
      stereoWidth: this.refStereoWidth,
      energy: this.refEnergy,
      detectedKey: this.refKeyScale
        ? { root: this.musicalKey.root, scale: this.refKeyScale, confidence: 1 }
        : undefined,
    };
  }

  /**
   * Apply a style classification result directly (Task 14).
   * If the top match's confidence exceeds the auto-switch threshold AND it
   * differs from the current world, switch worlds smoothly.
   * Public so the UI/tests can drive it explicitly if desired.
   */
  applyStyleClassification(matches: StyleMatch[]): void {
    this.styleMatches = matches;
    const top = matches[0];
    if (!top) return;
    if (top.confidence >= Psy4EngineV2.AUTO_SWITCH_CONFIDENCE_THRESHOLD) {
      const targetWorldId = styleToWorld(top.style);
      if (targetWorldId !== this.currentWorld.id) {
        const reason = top.reasons[0] || `style '${top.style}' (${(top.confidence * 100).toFixed(0)}%)`;
        this.tryAutoSwitch(targetWorldId, reason);
      }
    }
  }

  /**
   * Snapshot of the latest style classification for UI display.
   * Empty array if no reference features have arrived yet.
   */
  getStyleClassification(): StyleMatch[] {
    return this.styleMatches;
  }

  /**
   * Return the id of the currently active world. Used by the UI to keep its
   * dropdown in sync with the engine after an auto-switch (Task 14).
   */
  getCurrentWorldId(): string {
    return this.currentWorld.id;
  }

  /**
   * Attempt an automatic world switch. Respects the 30-second anti-thrash
   * cooldown and skips if the target world is the same as the last switch.
   * This is the only place auto-switches should happen.
   */
  private tryAutoSwitch(worldId: string, reason?: string): void {
    if (!this.ctx) return;
    // Defensive: validate that worldId is one of the known WorldIds before
    // attempting to switch. The classifier's styleToWorld() should always
    // return a valid id, but we don't want a bad id to slip through and
    // silently no-op in switchWorld().
    if (!(worldId in WORLDS)) {
      if (typeof console !== 'undefined') {
        console.warn('[PSY4] tryAutoSwitch: unknown worldId', worldId);
      }
      return;
    }
    const now = this.ctx.currentTime * 1000; // ms since ctx start
    if (this.lastAutoSwitchTime > 0 &&
        (now - this.lastAutoSwitchTime) < Psy4EngineV2.AUTO_SWITCH_COOLDOWN_MS) {
      return; // too soon — thrash guard
    }
    if (this.lastAutoSwitchWorldId === worldId) {
      return; // we already switched to this world recently — no-op
    }
    this.switchWorld(worldId as WorldId);
    this.lastAutoSwitchTime = now;
    this.lastAutoSwitchWorldId = worldId;
    // Notify the UI that an auto-switch happened.
    try { this.onWorldChange?.(worldId, reason); } catch {}
  }

  /**
   * Switch to a different world smoothly (Task 14). Does NOT restart playback.
   *   - Updates currentWorld, musicalKey (root + scale), refreshes generators
   *   - Ramps BPM over 4 bars if the new world's BPM differs by more than 2
   *   - Applies the new world's FX mix to reverb/delay sends
   *   - Resets phrase-locked rotation counters (start the new world's first
   *     phrase cleanly)
   *   - All audio parameter changes use setTargetAtTime / 4-bar ramp — no jumps
   */
  switchWorld(worldId: WorldId): void {
    const newWorld = WORLDS[worldId];
    if (!newWorld) return;
    this.currentWorld = newWorld;

    // Key — keep the root if it's within the world's range; otherwise snap to
    // the midpoint of the world's rootRange.
    const newRoot = (this.musicalKey.root >= newWorld.rootRange[0] &&
                     this.musicalKey.root <= newWorld.rootRange[1])
      ? this.musicalKey.root
      : Math.floor((newWorld.rootRange[0] + newWorld.rootRange[1]) / 2);
    // PRESERVE the listener-detected scale if the reference listener has set
    // one (refKeyScale) AND the new world allows that scale. This prevents
    // switchWorld from clobbering the key pursuit when the world auto-switches
    // (the original bug: radio detected "F major" but the engine reverted to
    // the world's defaultScale "phrygianDominant" immediately after switching).
    const listenerScale = this.refKeyScale;
    const scaleAllowed = (s?: string): s is string =>
      !!s && newWorld.scales.includes(s);
    const newScale = scaleAllowed(listenerScale)
      ? listenerScale
      : newWorld.defaultScale;
    const keyChanged = newRoot !== this.musicalKey.root || newScale !== this.musicalKey.scale;
    this.musicalKey = { root: newRoot, scale: newScale };
    if (keyChanged) this.refreshMusicalGenerators();

    // BPM — ramp over 4 bars if diff > 2
    const newBpm = newWorld.defaultBpm;
    if (Math.abs(newBpm - this._bpm) > 2) {
      this.targetBpm = clamp(newBpm, 60, 200);
      this.bpmRampBarsLeft = 4;
      this.bpmRampPerBar = (newBpm - this._bpm) / 4;
    } else {
      this._bpm = clamp(newBpm, 60, 200);
      this.targetBpm = 0;
      this.bpmRampBarsLeft = 0;
      this.bpmRampPerBar = 0;
    }

    // FX mix — smooth ramp
    if (this.ctx) {
      const now = this.ctx.currentTime;
      const fxMix = newWorld.fxMix;
      this.reverbSend.gain.setTargetAtTime(0.04 + fxMix * 0.22, now, 0.5);
      this.delaySend.gain.setTargetAtTime(0.05 + fxMix * 0.30, now, 0.5);
    }

    // Reset phrase-locked counters — start the new world's first phrase cleanly
    this.phraseCounter = 0;
    this.phrasePresetVariant = 0;
    this.arpIdx = 0;
    this.bassPatternIdx = 0;

    // Apply the new world's preferred kick/bass/lead presets immediately so
    // the next phrase starts with the right timbres. The phrase-locked
    // rotation will then alternate between the two variants from here on.
    this.applyWorldPresets();
  }

  /**
   * Apply the current world's preferred kick/bass/lead/pad/arp presets.
   * Called by switchWorld() and at start(). Phrase-locked rotation in tick()
   * will alternate between the two variants every 8 bars from here on.
   */
  private applyWorldPresets(): void {
    const id = this.currentWorld.id;
    // Dark worlds → DEEP kick + ROLL bass; bright worlds → TIGHT kick + DEEP bass.
    // Mid worlds → mix. Lead swaps for goa/acid (squelch) vs others (fmtex).
    const dark = id === 'dark-psy' || id === 'forest' || id === 'deep-psy' || id === 'hypnotic';
    const acid = id === 'goa' || id === 'acid-psy';
    const bright = id === 'morning-psy' || id === 'cosmic' || id === 'organic-psy';

    this.tracks[0].presetId = dark ? 'PS-KICK-DEEP' : 'PS-KICK-TIGHT';
    this.tracks[4].presetId = dark ? 'PS-BASS-ROLL' : (bright ? 'PS-BASS-DEEP' : 'PS-BASS-ROLL');
    this.tracks[5].presetId = acid ? 'PS-LEAD-SQUELCH' : (bright ? 'PS-LEAD-FMTEX' : 'PS-LEAD-SQUELCH');
    this.tracks[6].presetId = 'PS-PAD-PSYCH';
    this.tracks[7].presetId = 'PS-ARP-ACID';
  }

  /**
   * Re-create the LeadMotif and AcidPattern with the current musicalKey.
   * Called whenever the reference listener reports a new key — this is what
   * makes the engine actually pursue the radio's tonal center, not just store it.
   */
  private refreshMusicalGenerators(): void {
    const seed = (this.musicalKey.root * 31 + this.musicalKey.scale.length * 7 + 11) >>> 0;
    this.musicRng = new SeededRng(seed);
    this.leadMotif = new LeadMotif(this.musicalKey.root, this.musicalKey.scale, this.musicRng);
    this.acidPattern = new AcidPattern(this.musicalKey.root, this.musicalKey.scale, this.musicRng);
  }

  private applyStyle(style: string): void {
    // Map detected style to preset combinations
    const stylePresets: Record<string, { kick: string; bass: string; lead: string; pad: string; arp: string }> = {
      'progressive-psy': { kick: 'PS-KICK-TIGHT', bass: 'PS-BASS-DEEP', lead: 'PS-LEAD-FMTEX', pad: 'PS-PAD-PSYCH', arp: 'PS-ARP-ACID' },
      'dark-psy':        { kick: 'PS-KICK-DEEP', bass: 'PS-BASS-ROLL', lead: 'PS-LEAD-SQUELCH', pad: 'PS-PAD-PSYCH', arp: 'PS-ARP-ACID' },
      'goa':             { kick: 'PS-KICK-TIGHT', bass: 'PS-BASS-ROLL', lead: 'PS-LEAD-SQUELCH', pad: 'PS-PAD-PSYCH', arp: 'PS-ARP-ACID' },
      'morning-psy':     { kick: 'PS-KICK-TIGHT', bass: 'PS-BASS-DEEP', lead: 'PS-LEAD-FMTEX', pad: 'PS-PAD-PSYCH', arp: 'PS-ARP-ACID' },
      'forest':          { kick: 'PS-KICK-DEEP', bass: 'PS-BASS-ROLL', lead: 'PS-LEAD-SQUELCH', pad: 'PS-PAD-PSYCH', arp: 'PS-ARP-ACID' },
      'acid-psy':        { kick: 'PS-KICK-TIGHT', bass: 'PS-BASS-ROLL', lead: 'PS-LEAD-SQUELCH', pad: 'PS-PAD-PSYCH', arp: 'PS-ARP-ACID' },
      'full-on':         { kick: 'PS-KICK-TIGHT', bass: 'PS-BASS-ROLL', lead: 'PS-LEAD-SQUELCH', pad: 'PS-PAD-PSYCH', arp: 'PS-ARP-ACID' },
    };
    const p = stylePresets[style];
    if (p) {
      this.tracks[0].presetId = p.kick;
      this.tracks[4].presetId = p.bass;
      this.tracks[5].presetId = p.lead;
      this.tracks[6].presetId = p.pad;
      this.tracks[7].presetId = p.arp;
    }
  }

  private targetEnergy = 0.5;

  /**
   * Receive fresh metrics from the reference radio and store them as pursuit
   * targets. Also applies the smooth sub/high energy gain ramps immediately
   * (these are the only adjustments that can ramp across long time constants
   * without per-note cooperation — kick decay / centroid / transient density
   * are applied per-note in triggerDrum / triggerSynth / scheduleStep).
   */
  liveTrack(refMetrics: {
    lufs: number;
    kickDecayMs: number;
    spectralCentroid: number;
    energy?: number;
    subEnergy?: number;
    lowEnergy?: number;
    midEnergy?: number;
    highEnergy?: number;
    airEnergy?: number;
    transientDensity?: number;
    bassDecayMs?: number;
    stereoWidth?: number;
    bpm?: number;
    detectedKey?: { root: number; scale: string; confidence: number };
  }): void {
    if (isFinite(refMetrics.lufs)) this.targetLufs = refMetrics.lufs;
    if (refMetrics.energy !== undefined && isFinite(refMetrics.energy)) {
      this.targetEnergy = clamp(refMetrics.energy, 0, 1);
      this.refEnergy = this.targetEnergy;
    }

    // ── KICK DECAY target (seconds) ──
    if (refMetrics.kickDecayMs > 50 && refMetrics.kickDecayMs < 800) {
      this.refKickDecay = clamp(refMetrics.kickDecayMs / 1000, 0.05, 0.8);
    }

    // ── SPECTRAL CENTROID target (Hz) ──
    if (isFinite(refMetrics.spectralCentroid) && refMetrics.spectralCentroid > 0) {
      this.refSpectralCentroid = clamp(refMetrics.spectralCentroid, 100, 12000);
    }

    // ── TRANSIENT DENSITY target (transients/sec) ──
    const td = refMetrics.transientDensity ?? 0;
    if (isFinite(td) && td > 0) {
      this.refTransientDensity = clamp(td, 0, 40);
    }

    // ── SUB / HIGH ENERGY targets (0..1) ──
    if (refMetrics.subEnergy !== undefined && isFinite(refMetrics.subEnergy)) {
      this.refSubEnergy = clamp(refMetrics.subEnergy, 0, 1);
    }
    if (refMetrics.highEnergy !== undefined && isFinite(refMetrics.highEnergy)) {
      this.refHighEnergy = clamp(refMetrics.highEnergy, 0, 1);
    }

    // ── BASS DECAY target (seconds) ──
    if (refMetrics.bassDecayMs !== undefined && refMetrics.bassDecayMs > 20 && refMetrics.bassDecayMs < 1500) {
      this.refBassDecay = clamp(refMetrics.bassDecayMs / 1000, 0.05, 1.5);
    }

    // ── Additional features for the style classifier (Task 14) ──
    if (refMetrics.lowEnergy !== undefined && isFinite(refMetrics.lowEnergy)) {
      this.refLowEnergy = clamp(refMetrics.lowEnergy, 0, 1);
    }
    if (refMetrics.midEnergy !== undefined && isFinite(refMetrics.midEnergy)) {
      this.refMidEnergy = clamp(refMetrics.midEnergy, 0, 1);
    }
    if (refMetrics.airEnergy !== undefined && isFinite(refMetrics.airEnergy)) {
      this.refAirEnergy = clamp(refMetrics.airEnergy, 0, 1);
    }
    if (refMetrics.stereoWidth !== undefined && isFinite(refMetrics.stereoWidth)) {
      this.refStereoWidth = clamp(refMetrics.stereoWidth, 0, 1);
    }
    if (refMetrics.bpm !== undefined && isFinite(refMetrics.bpm) && refMetrics.bpm > 0) {
      this.refBpm = clamp(refMetrics.bpm, 30, 220);
    }
    if (refMetrics.detectedKey?.scale) {
      this.refKeyScale = refMetrics.detectedKey.scale;
    }

    // ── SUB / HIGH energy balancing — smooth ramp on track gains ──
    // Boost bass track (4) when ref has more sub than we do; boost lead/pad/arp
    // (5,6,7) when ref has more high energy. Time constants 0.8-1.0s (timbre).
    if (this.ctx) {
      const now = this.ctx.currentTime;
      if (this.refSubEnergy > 0 && this.ownSubEnergy > 0) {
        const subDiff = this.refSubEnergy - this.ownSubEnergy;
        if (Math.abs(subDiff) > 0.05) {
          const bassAdj = clamp(subDiff * 0.4, -0.3, 0.3);
          const bassTarget = clamp(0.8 + bassAdj, 0.3, 2.0);
          this.trackGains[4]?.gain.setTargetAtTime(bassTarget, now, 0.8);
          if (subDiff > 0.05) {
            const kickTarget = clamp(1.0 + subDiff * 0.2, 0.6, 1.8);
            this.trackGains[0]?.gain.setTargetAtTime(kickTarget, now, 0.8);
          }
        }
      }
      if (this.refHighEnergy > 0 && this.ownHighEnergy > 0) {
        const highDiff = this.refHighEnergy - this.ownHighEnergy;
        if (Math.abs(highDiff) > 0.05) {
          const adj = clamp(highDiff * 0.5, -0.3, 0.3);
          for (const ti of [5, 6, 7]) {
            const target = clamp(0.8 + adj, 0.3, 1.6);
            this.trackGains[ti]?.gain.setTargetAtTime(target, now, 1.0);
          }
        }
      }
    }
  }

  /**
   * Receive fresh metrics from our own engine output (via SelfAnalyzer).
   * Stores own sub/high/centroid/transient for getPursuitStatus() and the
   * sub/high balancing done in liveTrack().
   */
  selfTrack(selfMetrics: {
    lufs: number;
    energy?: number;
    spectralCentroid?: number;
    transientDensity?: number;
    subEnergy?: number;
    highEnergy?: number;
  }): void {
    this.ownLufs = selfMetrics.lufs;
    if (selfMetrics.spectralCentroid !== undefined && isFinite(selfMetrics.spectralCentroid) && selfMetrics.spectralCentroid > 0) {
      this.ownSpectralCentroid = selfMetrics.spectralCentroid;
    }
    if (selfMetrics.transientDensity !== undefined && isFinite(selfMetrics.transientDensity)) {
      this.ownTransientDensity = selfMetrics.transientDensity;
    }
    if (selfMetrics.subEnergy !== undefined && isFinite(selfMetrics.subEnergy)) {
      this.ownSubEnergy = selfMetrics.subEnergy;
    }
    if (selfMetrics.highEnergy !== undefined && isFinite(selfMetrics.highEnergy)) {
      this.ownHighEnergy = selfMetrics.highEnergy;
    }
    // LUFS matching
    if (this.targetLufs !== 0 && Math.abs(selfMetrics.lufs - this.targetLufs) > 1.0) {
      const diff = this.targetLufs - selfMetrics.lufs;
      const adj = diff > 0 ? 0.08 : -0.08;
      const newMaster = clamp(this.master.gain.value + adj, 0.3, 2.0);
      this.master.gain.setTargetAtTime(newMaster, this.ctx!.currentTime, 0.15);
    }
    // Energy matching — adjust track volumes
    if (this.targetEnergy > 0 && selfMetrics.energy !== undefined) {
      const energyDiff = this.targetEnergy - selfMetrics.energy;
      if (Math.abs(energyDiff) > 0.05) {
        // Boost/reduce all track gains slightly
        const volAdj = energyDiff > 0 ? 0.02 : -0.02;
        for (let i = 0; i < 8; i++) {
          const g = this.trackGains[i];
          if (g) {
            const newVol = clamp(g.gain.value + volAdj, 0.1, 2.0);
            g.gain.setTargetAtTime(newVol, this.ctx!.currentTime, 0.5);
          }
        }
      }
    }
  }

  setWorld(params: Record<string, number>): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (params.masterLevel !== undefined) {
      this.master.gain.setTargetAtTime(params.masterLevel, t, 0.1);
    }
    if (params.bassLevel !== undefined) {
      this.trackGains[4].gain.setTargetAtTime(params.bassLevel * 0.8, t, 0.1);
    }
    if (params.leadLevel !== undefined) {
      this.trackGains[5].gain.setTargetAtTime(params.leadLevel * 0.8, t, 0.1);
    }
    if (params.kickLevel !== undefined) {
      this.trackGains[0].gain.setTargetAtTime(params.kickLevel * 0.8, t, 0.1);
    }
    // ── Learned params from ContinuousTrainer (Task 22): store for blending ──
    //    These are applied incrementally in triggerDrum / triggerSynth, not here,
    //    because they affect per-voice synthesis. Guard against NaN/out-of-range.
    if (isFinite(params.kickDecay) && params.kickDecay > 0.02 && params.kickDecay < 2) {
      this.learned.kickDecay = params.kickDecay;
    }
    if (isFinite(params.bassCutoff) && params.bassCutoff > 40 && params.bassCutoff < 4000) {
      this.learned.bassCutoff = params.bassCutoff;
    }
    if (isFinite(params.leadCutoff) && params.leadCutoff > 100 && params.leadCutoff < 16000) {
      this.learned.leadCutoff = params.leadCutoff;
    }
    if (isFinite(params.leadDetune) && params.leadDetune >= 0 && params.leadDetune < 100) {
      this.learned.leadDetune = params.leadDetune;
    }
    if (isFinite(params.padCutoff) && params.padCutoff > 80 && params.padCutoff < 12000) {
      this.learned.padCutoff = params.padCutoff;
    }
    if (isFinite(params.duck) && params.duck >= 0 && params.duck <= 1) {
      this.learned.duck = params.duck;
    }
  }

  getAnalyser(): AnalyserNode | null { return this.analyser; }

  private scheduleNextTick(): void {
    if (!this.playing) return;
    this.timer = setTimeout(() => {
      this.tick();
      this.scheduleNextTick();
    }, 15);
  }

  private tick(): void {
    if (!this.playing || !this.ctx) return;
    const lookahead = 0.06;

    while (this.nextTime < this.ctx.currentTime + lookahead) {
      // Recompute s16 each step so the BPM ramp changes tempo smoothly
      // without invalidating the scheduler's lookahead window.
      const s16 = 60 / this.bpm / 4;
      this.scheduleStep(this.step, this.bar, this.nextTime);
      this.step++;
      this.nextTime += s16;
      if (this.step >= 16) {
        this.step = 0;
        this.bar++;
        // ── Per-bar musical evolution (Task 15) ──
        // tickEvolution() decides internally whether to mutate based on bar
        // count and world.evolutionRate. Mutates the LeadMotif's
        // EvolvingSequence in addition to the section-boundary evolve() call.
        this.leadMotif?.tickEvolution(this.bar, this.currentWorld.evolutionRate, 8);
        // ── BPM ramp smoothing (one step per bar, over 4 bars total) ──
        if (this.bpmRampBarsLeft > 0 && this.bpmRampPerBar !== 0) {
          const stepped = this._bpm + this.bpmRampPerBar;
          this._bpm = clamp(Math.round(stepped * 10) / 10, 60, 200);
          this.bpmRampBarsLeft--;
          if (this.bpmRampBarsLeft <= 0) {
            // Snap to final target at end of ramp
            this._bpm = this.targetBpm || this._bpm;
            this.targetBpm = 0;
            this.bpmRampPerBar = 0;
          }
        }
        const section = this.arrangement[this.sectionIdx % this.arrangement.length];
        if (this.bar >= section.bars) {
          this.sectionIdx++;
          this.bar = 0;
          const next = this.arrangement[this.sectionIdx % this.arrangement.length];
          this.currentSection = next.label;
          this.onSectionChange?.(this.currentSection);
          // Evolve lead motif at section boundaries for musical development
          this.leadMotif?.evolve();
          // (arpIdx rotation removed — base arp shape now comes from world.arpPattern;
          //  arpIdx is retained as a field for backward compatibility but no longer
          //  drives arp shape selection.)
        }
        // ── Phrase-locked preset rotation (Task 15) ──
        // Every 8 bars, rotate kick/bass preset between 2 variants based on
        // world character. Gives sonic consistency within a phrase, then
        // variation across phrases. Also rotates bass pattern every 4 bars
        // for melodic variation (kept from Track A).
        this.phraseCounter++;
        if (this.bar % 8 === 0 && this.bar > 0) {
          this.phrasePresetVariant = (this.phrasePresetVariant + 1) % 2;
          this.applyPhrasePresetRotation();
        }
        // Bass pattern rotates every 4 bars (kept from Track A — denser variation)
        if (this.bar % 4 === 0 && this.bar > 0) {
          const bassStyle = this.deriveBassStyle();
          const bps = BASS_PATTERNS[bassStyle] || BASS_PATTERNS.off;
          this.bassPatternIdx = (this.bassPatternIdx + 1) % bps.length;
        }
      }
    }
  }

  /**
   * Phrase-locked preset rotation (Task 15). Every 8 bars, swap kick + bass
   * presets between two variants based on the current world's character:
   *   - Dark worlds (dark-psy, forest, deep-psy, hypnotic) → rotate between
   *     DEEP/ROLL (default) and TIGHT/ROLL (variation).
   *   - Bright worlds (morning-psy, cosmic, organic-psy) → rotate between
   *     TIGHT/DEEP (default) and TIGHT/ROLL (variation).
   *   - Acid worlds (goa, acid-psy) → rotate between TIGHT/ROLL and TIGHT/DEEP.
   *   - Others → rotate between TIGHT/ROLL and DEEP/ROLL.
   * Lead/Pad/Arp presets stay fixed per world — only kick/bass rotate to keep
   * the harmonic identity stable.
   */
  private applyPhrasePresetRotation(): void {
    const id = this.currentWorld.id;
    const variant = this.phrasePresetVariant;
    const dark = id === 'dark-psy' || id === 'forest' || id === 'deep-psy' || id === 'hypnotic';
    const bright = id === 'morning-psy' || id === 'cosmic' || id === 'organic-psy';
    const acid = id === 'goa' || id === 'acid-psy';

    let kick: string;
    let bass: string;
    if (dark) {
      kick = variant === 0 ? 'PS-KICK-DEEP' : 'PS-KICK-TIGHT';
      bass = 'PS-BASS-ROLL';
    } else if (bright) {
      kick = 'PS-KICK-TIGHT';
      bass = variant === 0 ? 'PS-BASS-DEEP' : 'PS-BASS-ROLL';
    } else if (acid) {
      kick = 'PS-KICK-TIGHT';
      bass = variant === 0 ? 'PS-BASS-ROLL' : 'PS-BASS-DEEP';
    } else {
      // progressive-psy and any other mid character
      kick = variant === 0 ? 'PS-KICK-TIGHT' : 'PS-KICK-DEEP';
      bass = variant === 0 ? 'PS-BASS-ROLL' : 'PS-BASS-DEEP';
    }
    this.tracks[0].presetId = kick;
    this.tracks[4].presetId = bass;
  }

  /** Derive bass style from world id (worlds.ts doesn't have a 'bass' field). */
  private deriveBassStyle(): 'roll' | 'acid' | 'off' {
    const id = this.currentWorld.id;
    if (id.includes('dark') || id.includes('forest')) return 'roll';
    if (id.includes('goa') || id.includes('acid')) return 'acid';
    return 'off';
  }

  private scheduleStep(step: number, bar: number, time: number): void {
    const w = this.currentWorld;
    const section = this.arrangement[this.sectionIdx % this.arrangement.length];
    const key = this.musicalKey;
    const root = key.root;
    const sc = key.scale;
    const sd = 60 / this.bpm / 4;

    // ── Energy from world's energyCurve, modulated by section density ──
    const eIdx = clamp(
      Math.floor((bar / Math.max(1, section.bars)) * w.energyCurve.length),
      0,
      w.energyCurve.length - 1
    );
    const baseEnergy = w.energyCurve[eIdx];
    const energy = clamp(baseEnergy * (0.4 + 0.6 * section.density), 0, 1);

    // ── Swing: delay offbeat steps by swing * halfStep ──
    let stepTime = time;
    if (step % 2 === 1 && w.swing > 0) {
      stepTime += w.swing * sd * 0.5;
    }

    const isPreDrop = (section.label === 'BUILD' || section.label === 'BUILD 2') && bar >= section.bars - 2;
    const isDropStart = section.label.includes('DROP') && bar === 0 && step === 0;

    // ── RISER FX (last 2 bars of build) — uses raw time, not swung ──
    if (isPreDrop && step === 0 && bar === section.bars - 2) {
      this.triggerRiser(time, sd * 32);
    }

    // ── IMPACT FX (drop start) ──
    if (isDropStart) {
      this.triggerImpact(time);
    }

    // Reference pursuit — scale hat/perc probability by refTransientDensity.
    const tScale = this.refTransientDensity > 0
      ? clamp(0.5 + this.refTransientDensity / 24, 0.3, 1.8)
      : 1.0;
    const tVelBoost = tScale > 1 ? (tScale - 1) * 0.5 : 0;

    // ── Pre-compute world timbre overrides (cutoff/resonance modulated by character) ──
    const leadTimbre = {
      cutoff: w.leadTimbre.cutoff * (0.7 + 0.6 * w.brightness),
      res: 2 + w.leadTimbre.resonance * 12,
      drive: w.leadTimbre.drive,
    };
    const bassTimbre = {
      cutoff: w.bassTimbre.cutoff * (0.7 + 0.6 * (1 - w.darkness)),
      res: 2 + w.bassTimbre.resonance * 12,
      drive: w.bassTimbre.drive,
    };
    const padTimbre = {
      cutoff: w.padTimbre.cutoff * (0.6 + 0.8 * w.brightness),
      res: 2 + w.padTimbre.resonance * 12,
      drive: w.padTimbre.drive,
    };
    const arpTimbre = {
      cutoff: w.textureTimbre.cutoff * (0.7 + 0.6 * w.psychedelia),
      res: 2 + w.textureTimbre.resonance * 12,
      drive: w.textureTimbre.drive,
    };

    // ── KICK (track 0) — world-driven kickPattern (16-char gate string) ──
    if (w.kickPattern.length === 16 && w.kickPattern.charAt(step) === 'x') {
      const isDownbeat = step % 4 === 0;
      const aggressionBoost = 0.7 + 0.6 * w.aggression;
      // Velocity scales with both section.density and energyCurve so drops hit
      // harder than builds even at the same density (Task 15: verify energy
      // actually affects velocity/density).
      const vel = isDownbeat
        ? 0.4 + section.density * 0.3 * aggressionBoost + energy * 0.15
        : 0.3 * aggressionBoost + energy * 0.1;
      this.triggerDrum(0, stepTime, vel);
    }

    // ── CLAP (track 1) — world-driven clapPattern gate ('x' = hit) ──
    if (w.clapPattern && w.clapPattern.length === 16 && w.clapPattern.charAt(step) === 'x' && section.density > 0.4) {
      this.triggerDrum(1, stepTime, 0.3 + energy * 0.1);
    }

    // ── HATS (track 2) — probability from world.hatDensity per eligible offbeat ──
    const hatProb = clamp(w.hatDensity * (0.5 + 0.5 * energy) * tScale, 0, 1);
    if (step % 2 === 1 && this.musicRng?.chance(hatProb)) {
      const vel = 0.15 + (step % 4 === 3 ? 0.1 : 0) + energy * 0.1 + tVelBoost;
      this.triggerDrum(2, stepTime, vel);
    }

    // ── PERC (track 3) — world-driven percPattern gate + density-based probability ──
    const percProb = clamp(w.percDensity * energy * tScale, 0, 1);
    if (w.percPattern && w.percPattern.length === 16 && w.percPattern.charAt(step) === 'x' && section.density > 0.5 && this.musicRng?.chance(percProb)) {
      this.triggerDrum(3, stepTime, 0.2 + tVelBoost);
    }

    // ── BASS (track 4) — world-driven bassPattern + BASS_PATTERNS by derived style ──
    if (section.bass && w.bassPattern.length === 16 && w.bassPattern.charAt(step) === 'x') {
      const bassStyle = this.deriveBassStyle();
      const bps = BASS_PATTERNS[bassStyle] || BASS_PATTERNS.off;
      const bp = bps[this.bassPatternIdx % bps.length];
      const bassStep = Math.floor((step - 1) / 2) % bp.steps.length;
      const bassDeg = bp.steps[bassStep];
      if (bassDeg >= 0) {
        const note = scaleNote(root, sc, bassDeg);
        const accent = bp.accents[bassStep] ?? 1;
        // Bass velocity scales with energy so drops push the bass harder
        this.triggerSynth(4, stepTime, note, (0.4 + energy * 0.2) * accent, sd, undefined, bassTimbre);
      }
    }

    // ── LEAD (track 5) — LeadMotif with AABA structure, gated by section + energy ──
    if (section.lead && this.leadMotif && energy > 0.35) {
      const noteInfo = this.leadMotif.nextNote(step, bar, energy, this.musicRng!);
      if (noteInfo) {
        this.triggerSynth(5, stepTime, noteInfo.note, noteInfo.velocity, sd, sd * 0.5, leadTimbre);
      }
    }

    // ── PAD (track 6) — chord progression from PROGRESSIONS[scale], on bar downbeat in drops ──
    if (section.lead && step === 0) {
      const prog = PROGRESSIONS[sc] || PROGRESSIONS.minor;
      const chordDeg = prog[bar % prog.length];
      const chordRoot = scaleNote(root + 12, sc, chordDeg);
      // Pad velocity scales with energy (Task 15)
      this.triggerSynth(6, stepTime, chordRoot, 0.2 + energy * 0.15, sd * 4, undefined, padTimbre);
      // Also play fifth for full chord
      this.triggerSynth(6, stepTime + 0.01, scaleNote(root + 12, sc, chordDeg + 4), 0.12 + energy * 0.1, sd * 4, undefined, padTimbre);
    }

    // ── ARP (track 7) — world-driven arpPattern (8 scale degrees per step) ──
    const arpProb = clamp(0.7 * energy, 0, 1);
    if (section.lead && step % 2 === 0 && this.musicRng?.chance(arpProb)) {
      const arp = w.arpPattern || [0,2,4,7,4,2,0,7];
      const arpStep = Math.floor(step / 2) % arp.length;
      const deg = arp[arpStep];
      const note = scaleNote(root + 24, sc, deg);
      this.triggerSynth(7, stepTime, note, 0.25 * energy, sd, undefined, arpTimbre);
    }

    // ── SHAKER (track 3 alt) — continuous offbeat in drops ──
    const shakerProb = clamp(0.4 * energy * tScale, 0, 1);
    if (section.bass && section.lead && step % 2 === 1 && this.musicRng?.chance(shakerProb)) {
      this.triggerDrum(3, stepTime, 0.15 + tVelBoost);
    }
  }

  private triggerDrum(trackIdx: number, time: number, vel: number, decayOverride?: number): void {
    const track = this.tracks[trackIdx];
    if (track.mix.mute) return;
    const preset = DRUM_PRESETS[track.presetId];
    if (!preset) return;
    const voice = this.drumPool[this.drumIdx];
    this.drumIdx = (this.drumIdx + 1) % this.drumPool.length;

    // Reference pursuit — KICK DECAY: blend preset decay with refKickDecay.
    // The kick dur formula is `dur = 0.12 + 0.5 * decay`, so to hit a target
    // seconds T the equivalent decay param is `(T - 0.12) / 0.5`. We blend
    // 50/50 with the preset decay so the kick keeps its tonal character but
    // adopts the reference's tail length.
    let effectiveDecayOverride = decayOverride;
    if (trackIdx === 0 && this.refKickDecay > 0) {
      const targetDur = clamp(this.refKickDecay, 0.05, 0.8);
      const refDecayParam = clamp((targetDur - 0.12) / 0.5, 0.05, 4.0);
      const blended = preset.decay * 0.5 + refDecayParam * 0.5;
      effectiveDecayOverride = (isFinite(blended) && blended > 0) ? blended : undefined;
    }
    // Learned kick decay (from ContinuousTrainer offline optimization) — blend 25%
    // on top of the reference-pursued decay. This lets the trainer nudge the kick
    // tail toward an optimized value without fighting the live reference pursuit.
    if (trackIdx === 0 && this.learned.kickDecay && effectiveDecayOverride !== undefined) {
      const learnedDur = clamp(this.learned.kickDecay, 0.05, 0.8);
      const learnedParam = clamp((learnedDur - 0.12) / 0.5, 0.05, 4.0);
      const blended = effectiveDecayOverride * 0.75 + learnedParam * 0.25;
      effectiveDecayOverride = (isFinite(blended) && blended > 0) ? blended : effectiveDecayOverride;
    }

    voice.hit(preset, time, vel * track.mix.vol, this.chains[trackIdx], effectiveDecayOverride);

    // Sidechain: when kick fires, duck the bass
    if (trackIdx === 0 && this.duckGain && this.ctx) {
      this.duckGain.gain.cancelScheduledValues(time);
      // Blend learned duck depth (from trainer) with the default 0.4 — trainer
      // can push the sidechain deeper (up to 0.7) or shallower for groove control.
      const duckDepth = this.learned.duck !== undefined
        ? clamp(0.4 * 0.6 + this.learned.duck * 0.7 * 0.4, 0.15, 0.7)
        : 0.4;
      this.duckGain.gain.setValueAtTime(1 - duckDepth, time);
      this.duckGain.gain.linearRampToValueAtTime(1.0, time + 0.25); // 250ms recovery
    }
  }

  private triggerRiser(time: number, dur: number): void {
    if (!this.ctx) return;
    const c = this.ctx;
    // Noise through filter that opens up
    const noise = c.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(200, time);
    filter.frequency.exponentialRampToValueAtTime(8000, time + dur);
    filter.Q.value = 2;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(0.3, time + dur);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur + 0.1);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    noise.start(time);
    noise.stop(time + dur + 0.2);
  }

  private triggerImpact(time: number): void {
    if (!this.ctx) return;
    const c = this.ctx;
    // Sub boom + noise crack
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(35, time + 0.5);
    const og = c.createGain();
    og.gain.setValueAtTime(0.8, time);
    og.gain.exponentialRampToValueAtTime(0.001, time + 0.6);
    osc.connect(og);
    og.connect(this.master);
    osc.start(time);
    osc.stop(time + 0.7);

    const noise = c.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.4, time);
    ng.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    noise.connect(hp);
    hp.connect(ng);
    ng.connect(this.master);
    noise.start(time);
    noise.stop(time + 0.1);
  }

  private triggerSynth(
    trackIdx: number,
    time: number,
    midi: number,
    vel: number,
    stepDur: number,
    dur?: number,
    timbre?: { cutoff?: number; res?: number; drive?: number }
  ): void {
    const track = this.tracks[trackIdx];
    if (track.mix.mute) return;
    const basePreset = SYNTH_PRESETS[track.presetId];
    if (!basePreset) return;
    const voice = this.synthPool[this.synthIdx];
    this.synthIdx = (this.synthIdx + 1) % this.synthPool.length;

    // ── Apply world timbre overrides on top of the factory preset ──
    let preset: SynthPreset = basePreset;
    if (timbre) {
      preset = {
        ...basePreset,
        cutoff: timbre.cutoff !== undefined ? clamp(timbre.cutoff, 60, 16000) : basePreset.cutoff,
        res: timbre.res !== undefined ? clamp(timbre.res, 0.2, 24) : basePreset.res,
      };
    }

    let p: SynthPreset = dur ? { ...preset, gate: dur / (stepDur * 2) } : preset;

    // Reference pursuit — SPECTRAL CENTROID matching for lead (5) and pad (6).
    // Applied on top of the world timbre so radio brightness nudges the world cutoff.
    if ((trackIdx === 5 || trackIdx === 6) && this.refSpectralCentroid > 0) {
      const targetCut = centroidToCutoff(this.refSpectralCentroid);
      const blended = preset.cutoff * 0.6 + targetCut * 0.4;
      if (isFinite(blended) && blended > 60) {
        p = { ...p, cutoff: clamp(blended, 200, 12000) };
      }
    }

    // Reference pursuit — BASS DECAY matching for bass (4).
    if (trackIdx === 4 && this.refBassDecay > 0) {
      const desiredGate = clamp(this.refBassDecay / Math.max(stepDur * 2, 0.01), 0.05, 2.5);
      const blended = preset.gate * 0.7 + desiredGate * 0.3;
      if (isFinite(blended) && blended > 0) {
        p = { ...p, gate: clamp(blended, 0.05, 2.5) };
      }
    }

    // ── Learned params from ContinuousTrainer (Task 22) ──
    //    Blend 30% learned cutoff on top of world + reference pursuit.
    //    This lets the offline optimizer steer timbre toward an accepted
    //    configuration without overriding the live reference pursuit.
    if (trackIdx === 4 && this.learned.bassCutoff) {
      const blended = p.cutoff * 0.7 + this.learned.bassCutoff * 0.3;
      if (isFinite(blended) && blended > 40) p = { ...p, cutoff: clamp(blended, 60, 4000) };
    }
    if (trackIdx === 5 && this.learned.leadCutoff) {
      const blended = p.cutoff * 0.7 + this.learned.leadCutoff * 0.3;
      if (isFinite(blended) && blended > 100) p = { ...p, cutoff: clamp(blended, 200, 16000) };
    }
    if (trackIdx === 6 && this.learned.padCutoff) {
      const blended = p.cutoff * 0.7 + this.learned.padCutoff * 0.3;
      if (isFinite(blended) && blended > 80) p = { ...p, cutoff: clamp(blended, 150, 12000) };
    }
    // Learned lead detune — nudge the osc2 detune toward the optimized value.
    if (trackIdx === 5 && this.learned.leadDetune !== undefined) {
      const blended = (p.detune || 0) * 0.7 + this.learned.leadDetune * 0.3;
      if (isFinite(blended) && blended >= 0) p = { ...p, detune: clamp(blended, 0, 50) };
    }

    // Drive scales the voice velocity (per-voice drive isn't a SynthPreset field)
    const driveBoost = timbre?.drive ? clamp(timbre.drive / 1.5, 0.5, 1.8) : 1;
    voice.noteOn(p, time, midi, vel * track.mix.vol * driveBoost, stepDur, this.chains[trackIdx]);

    // Add sub oscillator for bass track (sine one octave below)
    if (trackIdx === 4 && this.ctx) {
      const subFreq = mtof(midi - 12); // one octave below
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.value = subFreq;
      // When chasing ref bass decay, lengthen the sub-osc tail to match.
      const baseDur = dur || stepDur * 0.3;
      const subDecay = (this.refBassDecay > 0)
        ? clamp(baseDur * 0.5 + this.refBassDecay * 0.5, 0.05, 1.5)
        : baseDur + 0.05;
      subGain.gain.setValueAtTime(0.5 * track.mix.vol * driveBoost, time);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + subDecay);
      subOsc.connect(subGain);
      subGain.connect(this.chains[4]);
      subOsc.start(time);
      subOsc.stop(time + subDecay + 0.02);
    }
  }

  /**
   * Snapshot of reference pursuit state for UI display. Each entry pairs the
   * radio target with our current actual so the UI can render a delta.
   * Values are zero when no reference data has arrived yet.
   */
  getPursuitStatus(): {
    kickDecay: { target: number; actual: number };
    centroid: { target: number; actual: number };
    transientDensity: { target: number; actual: number };
    bpm: { target: number; actual: number };
    key: { root: number; scale: string };
  } {
    // Actual kick decay = current kick preset's dur, blended with ref if pursuing.
    let actualKickDur = 0;
    const kickPreset = DRUM_PRESETS[this.tracks[0]?.presetId ?? ''];
    if (kickPreset) {
      const presetDur = 0.12 + 0.5 * (kickPreset.decay || 1);
      if (this.refKickDecay > 0) {
        const refDecayParam = clamp((this.refKickDecay - 0.12) / 0.5, 0.05, 4.0);
        const blendedDecay = kickPreset.decay * 0.5 + refDecayParam * 0.5;
        actualKickDur = 0.12 + 0.5 * blendedDecay;
      } else {
        actualKickDur = presetDur;
      }
    }
    return {
      kickDecay: { target: this.refKickDecay, actual: actualKickDur },
      centroid: { target: this.refSpectralCentroid, actual: this.ownSpectralCentroid },
      transientDensity: { target: this.refTransientDensity, actual: this.ownTransientDensity },
      bpm: { target: this.targetBpm || this._bpm, actual: this._bpm },
      key: { root: this.musicalKey.root, scale: this.musicalKey.scale },
    };
  }

  getMusicalKey(): { root: number; scale: string } { return this.musicalKey; }
  getOwnLufs(): number { return this.ownLufs; }
}
