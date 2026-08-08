/**
 * PSY4 LIVE ENGINE v2 — browser-native Web Audio with real psytrance grammar.
 *
 * v1 problems (brutal roast):
 *   - step() was 36 lines of hardcoded note placement
 *   - bass played root+(bar%3) = metronome with pitch
 *   - lead was random blips, no motif
 *   - no texture/acid/arp/shaker/percussion layers
 *   - no fills, no ghost notes, no velocity variation
 *   - no chord progressions (static [0,3,7])
 *   - no section automation (risers, filter sweeps, transitions)
 *   - all sounds used same saw wave
 *   - "psychedelic" = just delay + reverb
 *
 * v2 fixes:
 *   - Proper psytrance rhythm grammar with fills, ghost notes, velocity curves
 *   - 10+ simultaneous layers: kick, bass, sub, hats, shaker, clap, percussion,
 *     lead, acid, arp, pad, texture, riser, impact
 *   - Chord progressions per world
 *   - Section-aware automation (risers before drops, filter sweeps in breakdowns)
 *   - Motif system: lead has identity (AABA pattern), not random notes
 *   - Multiple oscillator types (saw, square, triangle, sine, FM)
 *   - Velocity groove: downbeat accent, ghost notes, phrase variation
 *   - Stereo movement: hats move, textures drift, leads spread
 *
 * REAL IMPLEMENTATION — browser-native Web Audio.
 */

import { getVoiceSpecs, VoiceSpecSet, ChannelStripSpec } from './voiceSpecs';
import { getSoundBank } from './soundBank';
import { MoogFilterChain, MultibandCompressor, TruePeakLimiter, GlueCompressor, MasterSaturation } from './proAudioNodes';
import {
  ensureWorkletsLoaded, createMoogFilter, createBLSaw, createBLSquare,
  type MoogFilterNode, type BLSawNode,
} from './workletDsp';
import { Psy4EngineNode, VOICE, type VoiceId, type EngineStats } from './engineWorklet';
import { SampleBank } from './sampleBank';
import {
  SCALES as GRAMMAR_SCALES, PROGRESSIONS as GRAMMAR_PROGRESSIONS, SeededRng,
  EvolvingSequence, LeadMotif, AcidPattern, BASS_PATTERNS,
  scaleNote as grammarScaleNote, tensionAt, densityAt,
  type TensionShape,
} from './musicalGrammar';
import { CallResponseEngine, DensityController } from './callResponseEngine';

// ─── Music Theory ───────────────────────────────────────────────

const SCALES: Record<string, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  doubleHarmonic: [0, 1, 4, 5, 7, 8, 11],
  minorPentatonic: [0, 3, 5, 7, 10],
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
function scaleNote(root: number, scale: string, deg: number): number {
  const sc = SCALES[scale] || SCALES.minor;
  const n = sc.length, o = Math.floor(deg / n);
  return root + 12 * o + sc[((deg % n) + n) % n];
}

// Chord progressions (scale degrees, 4 chords per progression)
const PROGRESSIONS: Record<string, number[][]> = {
  minor: [[0, 3, 7], [5, 8, 12], [3, 7, 10], [4, 7, 11]],
  dorian: [[0, 3, 7], [3, 7, 10], [4, 7, 11], [6, 9, 12]],
  phrygian: [[0, 3, 7], [1, 4, 8], [3, 7, 10], [6, 9, 12]],
  harmonicMinor: [[0, 3, 7], [4, 7, 11], [5, 8, 12], [3, 7, 10]],
  phrygianDominant: [[0, 4, 7], [1, 4, 8], [3, 7, 10], [6, 9, 12]],
};

// ─── RNG ────────────────────────────────────────────────────────

class Rng {
  s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number { this.s = (this.s * 1664525 + 1013904223) >>> 0; return this.s / 4294967296; }
  int(min: number, max: number): number { return Math.floor(this.next() * (max - min + 1)) + min; }
  pick<T>(a: T[]): T { return a[Math.floor(this.next() * a.length)]; }
  chance(p: number): boolean { return this.next() < p; }
  gauss(m: number, sd: number): number { return m + sd * (this.next() + this.next() + this.next() - 1.5); }
}

// ─── Motif (melodic identity with AABA structure) ───────────────

class Motif {
  private notes: number[] = [];
  private rhythm: number[] = [];
  private pos = 0;
  private variationCount = 0;

  constructor(root: number, scale: string, rng: Rng) {
    // Generate a 4-note motif with contour (AAB A' structure)
    // A: 2 notes, A: repeat with variation, B: contrasting, A': return
    const contour = rng.pick([[1, 1, -2, 1], [2, -1, 1, -1], [-1, 2, -1, 1], [1, -1, 2, 0]]);
    let prev = 0;
    for (let i = 0; i < 4; i++) {
      prev = Math.max(-3, Math.min(5, prev + contour[i]));
      this.notes.push(prev);
    }
    // Rhythm: downbeat + offbeat + syncopated
    this.rhythm = [0, 4, 8, 10];
  }

  next(): { degree: number; step: number } {
    const n = this.notes[this.pos];
    const r = this.rhythm[this.pos];
    this.pos = (this.pos + 1) % 4;
    return { degree: n, step: r };
  }

  /** Mutate one note slightly (preserve identity). */
  mutate(rng: Rng) {
    if (++this.variationCount % 4 === 0) {
      const idx = rng.int(0, 3);
      this.notes[idx] = Math.max(-3, Math.min(5, this.notes[idx] + rng.pick([-1, 1])));
    }
  }
}

// ─── World ──────────────────────────────────────────────────────

export interface Psy4World {
  id: string; name: string;
  bpm: number; scale: string; root: number;
  bass: 'roll' | 'off' | 'acid';
  density: number; drive: number; swing: number; space: number; duck: number;
  acid: boolean;
  kickDecay: number; kickFundamental: number;
  bassCutoff: number; bassResonance: number;
  leadCutoff: number; leadDetune: number;
  padCutoff: number; textureLevel: number;
  energyCurve: number[];
  // v2 additions
  leadType: 'saw' | 'square' | 'triangle';
  textureType: 'noise' | 'fm' | 'wavetable';
  hatPattern: string; // 16-char gate string
  percPattern: string;
  darkness: number;
}

const WORLDS: Record<string, Psy4World> = {
  'progressive-psy': {
    id: 'progressive-psy', name: 'Progressive Psy',
    bpm: 128, scale: 'dorian', root: 48,
    bass: 'off', density: 0.5, drive: 0.3, swing: 0.1, space: 0.6, duck: 0.4,
    acid: false,
    kickDecay: 0.22, kickFundamental: 50,
    bassCutoff: 400, bassResonance: 3,
    leadCutoff: 3000, leadDetune: 10,
    padCutoff: 1200, textureLevel: 0.12,
    energyCurve: [0.3, 0.45, 0.6, 0.75, 0.9, 0.75, 0.6, 0.4],
    leadType: 'saw', textureType: 'noise',
    hatPattern: 'x.x.x.x.x.x.x.x.', percPattern: '....x.......x...',
    darkness: 0.35,
  },
  'dark-psy': {
    id: 'dark-psy', name: 'Dark Psy',
    bpm: 150, scale: 'phrygian', root: 43,
    bass: 'roll', density: 0.75, drive: 0.7, swing: 0.04, space: 0.25, duck: 0.55,
    acid: true,
    kickDecay: 0.16, kickFundamental: 48,
    bassCutoff: 300, bassResonance: 8,
    leadCutoff: 2000, leadDetune: 15,
    padCutoff: 800, textureLevel: 0.18,
    energyCurve: [0.5, 0.7, 0.85, 0.95, 0.85, 0.95, 0.7, 0.5],
    leadType: 'square', textureType: 'fm',
    hatPattern: 'x.x.x.x.x.x.x.x.', percPattern: '..x.....x.....x.',
    darkness: 0.8,
  },
  'goa': {
    id: 'goa', name: 'Goa',
    bpm: 140, scale: 'phrygianDominant', root: 45,
    bass: 'roll', density: 0.7, drive: 0.5, swing: 0.05, space: 0.5, duck: 0.5,
    acid: true,
    kickDecay: 0.2, kickFundamental: 52,
    bassCutoff: 500, bassResonance: 10,
    leadCutoff: 4000, leadDetune: 20,
    padCutoff: 1500, textureLevel: 0.15,
    energyCurve: [0.35, 0.5, 0.7, 0.85, 0.95, 0.85, 0.7, 0.5],
    leadType: 'saw', textureType: 'wavetable',
    hatPattern: 'x.x.x.x.x.x.x.x.', percPattern: '....x...x...x...',
    darkness: 0.45,
  },
  'morning-psy': {
    id: 'morning-psy', name: 'Morning Psy',
    bpm: 142, scale: 'dorian', root: 50,
    bass: 'off', density: 0.65, drive: 0.35, swing: 0.06, space: 0.55, duck: 0.42,
    acid: false,
    kickDecay: 0.2, kickFundamental: 54,
    bassCutoff: 550, bassResonance: 4,
    leadCutoff: 3500, leadDetune: 12,
    padCutoff: 1800, textureLevel: 0.14,
    energyCurve: [0.4, 0.55, 0.7, 0.85, 0.95, 0.8, 0.65, 0.45],
    leadType: 'triangle', textureType: 'noise',
    hatPattern: 'x.x.x.x.x.x.x.x.', percPattern: '......x.......x.',
    darkness: 0.2,
  },
  'forest': {
    id: 'forest', name: 'Forest',
    bpm: 148, scale: 'minor', root: 44,
    bass: 'roll', density: 0.7, drive: 0.6, swing: 0.04, space: 0.3, duck: 0.5,
    acid: false,
    kickDecay: 0.18, kickFundamental: 46,
    bassCutoff: 350, bassResonance: 6,
    leadCutoff: 2200, leadDetune: 14,
    padCutoff: 1000, textureLevel: 0.2,
    energyCurve: [0.4, 0.6, 0.75, 0.9, 0.85, 0.9, 0.65, 0.45],
    leadType: 'square', textureType: 'fm',
    hatPattern: 'x.x.x.x.x.x.x.x.', percPattern: '.x...x...x...x...',
    darkness: 0.65,
  },
  'hypnotic': {
    id: 'hypnotic', name: 'Hypnotic',
    bpm: 130, scale: 'dorian', root: 47,
    bass: 'off', density: 0.4, drive: 0.35, swing: 0.1, space: 0.5, duck: 0.4,
    acid: false,
    kickDecay: 0.24, kickFundamental: 48,
    bassCutoff: 380, bassResonance: 5,
    leadCutoff: 1800, leadDetune: 8,
    padCutoff: 1000, textureLevel: 0.1,
    energyCurve: [0.3, 0.4, 0.5, 0.65, 0.75, 0.7, 0.55, 0.4],
    leadType: 'saw', textureType: 'noise',
    hatPattern: 'x...x...x...x...', percPattern: '..........x.....',
    darkness: 0.4,
  },
  'cosmic': {
    id: 'cosmic', name: 'Cosmic',
    bpm: 136, scale: 'dorian', root: 49,
    bass: 'off', density: 0.5, drive: 0.3, swing: 0.07, space: 0.7, duck: 0.38,
    acid: false,
    kickDecay: 0.22, kickFundamental: 50,
    bassCutoff: 450, bassResonance: 4,
    leadCutoff: 3200, leadDetune: 16,
    padCutoff: 2000, textureLevel: 0.18,
    energyCurve: [0.3, 0.45, 0.6, 0.75, 0.85, 0.75, 0.6, 0.4],
    leadType: 'triangle', textureType: 'wavetable',
    hatPattern: 'x...x...x...x...', percPattern: '....x.......x...',
    darkness: 0.3,
  },
  'acid-psy': {
    id: 'acid-psy', name: 'Acid Psy',
    bpm: 142, scale: 'minor', root: 45,
    bass: 'acid', density: 0.7, drive: 0.65, swing: 0.05, space: 0.35, duck: 0.5,
    acid: true,
    kickDecay: 0.19, kickFundamental: 50,
    bassCutoff: 600, bassResonance: 14,
    leadCutoff: 2500, leadDetune: 18,
    padCutoff: 1200, textureLevel: 0.13,
    energyCurve: [0.45, 0.6, 0.75, 0.9, 0.95, 0.85, 0.7, 0.5],
    leadType: 'saw', textureType: 'fm',
    hatPattern: 'x.x.x.x.x.x.x.x.', percPattern: '..x.....x.....x.',
    darkness: 0.5,
  },
};

// ─── Macros ─────────────────────────────────────────────────────

export interface Macros {
  energy: number; psychedelia: number; darkness: number; density: number;
  groove: number; evolution: number; space: number; surprise: number;
  aggression: number; brightness: number;
}

const DEFAULT_MACROS: Macros = {
  energy: 0.6, psychedelia: 0.55, darkness: 0.4, density: 0.55,
  groove: 0.5, evolution: 0.5, space: 0.4, surprise: 0.3,
  aggression: 0.4, brightness: 0.55,
};

// ─── Section ────────────────────────────────────────────────────

const SECTION_CYCLE = ['intro', 'build', 'drop', 'break', 'drop', 'climax'] as const;
type SectionType = typeof SECTION_CYCLE[number];

interface Section {
  type: SectionType; bars: number; density: number;
  rng: Rng; motif: Motif; energy: number;
  chordIndex: number;
  // Musical grammar (PSY3-style controlled mutation)
  leadMotif: LeadMotif | null;
  acidPattern: AcidPattern | null;
  bassPatternIdx: number;
  tensionShape: TensionShape;
}

// ─── Live Engine v2 ─────────────────────────────────────────────

export class Psy4LiveEngine {
  ctx: AudioContext | null = null;
  playing = false;
  world: Psy4World = WORLDS['progressive-psy'];
  macros: Macros = { ...DEFAULT_MACROS };
  seed = 1;

  // audio graph
  private sum: GainNode | null = null;
  private duck: GainNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private lim: DynamicsCompressorNode | null = null;
  private eqL: BiquadFilterNode | null = null;
  private eqH: BiquadFilterNode | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private dSend: GainNode | null = null;
  private dOut: GainNode | null = null;
  private rSend: GainNode | null = null;
  private conv: ConvolverNode | null = null;
  private pink: AudioBuffer | null = null;
  private sawWave: PeriodicWave | null = null;
  private sqWave: PeriodicWave | null = null;
  private triWave: PeriodicWave | null = null;

  // scheduler
  private sec: Section | null = null;
  private si = 0;
  private next = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sectionIdx = 0;

  // UI state
  currentSection = 'idle';
  currentBar = 0;
  currentPhrase = 0;
  phrasesPlayed = 0;

  // channel strips — per-voice gain/HP/pan/send
  private channelStrips: Map<string, { input: GainNode; hp: BiquadFilterNode; gain: GainNode; reverbSend: GainNode; delaySend: GainNode; panner: StereoPannerNode }> = new Map();
  private voiceSpecs: VoiceSpecSet | null = null;
  private soundBank = getSoundBank();

  // Professional master chain
  private multiband: MultibandCompressor | null = null;
  private glue: GlueCompressor | null = null;
  private saturation: MasterSaturation | null = null;
  private truePeak: TruePeakLimiter | null = null;

  // ─── BUS ARCHITECTURE ──────────────────────────────────────────
  // Production-grade routing: channels → bus (EQ+comp+sat) → sum → master
  //   drum bus  : kick, hat, clap, perc, shaker
  //   bass bus  : bass, acid
  //   music bus : lead
  //   atmos bus : pad, texture
  //   fx bus    : riser, impact, sweep, zap, blip, downlifter
  private buses: Map<string, { input: GainNode; comp: DynamicsCompressorNode; out: GainNode }> = new Map();

  // ─── Worklet DSP state ─────────────────────────────────────────
  // When true, voices use real Moog ladder + BL saw (sample-accurate).
  // When false (worklet not yet loaded), voices fall back to BiquadFilter.
  workletsReady = false;
  private workletLoadPromise: Promise<boolean> | null = null;

  // ─── ENGINE WORKLET (full synth engine) ────────────────────────
  // When active, ALL voice synthesis happens in the AudioWorklet.
  // The main thread only generates musical events (no per-hit node creation).
  // This eliminates the setInterval(25ms) jitter and GC pressure.
  private engineNode: Psy4EngineNode | null = null;
  useWorkletEngine = false;
  private engineStats: EngineStats | null = null;
  private sampleBank: SampleBank | null = null;
  samplesLoaded = false;
  private sampleSelector: import('./sampleSelector').SampleSelector | null = null;
  private callResponse: import('./callResponseEngine').CallResponseEngine | null = null;

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const c = this.ctx = new Ctx({ latencyHint: 'interactive' });

    // Load voice specs for current world
    this.voiceSpecs = getVoiceSpecs(this.world.id);

    // Load sound bank samples
    this.soundBank.init(c).then(() => {
      console.log('SoundBank loaded:', this.soundBank.listLoaded());
    }).catch(e => console.warn('SoundBank load failed:', e));

    // ── MASTER CHAIN (professional, from PSY3 style_master.py) ──
    // sum → duck → HP → multiband → glue → saturation → truePeak → EQ → master → destination
    this.sum = c.createGain();
    this.duck = c.createGain();
    
    // HP on master (remove subsonic)
    const masterHP = c.createBiquadFilter();
    masterHP.type = 'highpass';
    masterHP.frequency.value = 25;
    masterHP.Q.value = 0.707;
    
    // DC blocker
    const dcBlock = c.createWaveShaper();
    const dcCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 512) - 1; dcCurve[i] = x; } // linear = no shaping, just pass-through (DC handled by HP)
    
    // EQ shelves (tonal shaping)
    this.eqL = c.createBiquadFilter(); this.eqL.type = 'lowshelf';
    this.eqL.frequency.value = 80; this.eqL.gain.value = 2;
    this.eqH = c.createBiquadFilter(); this.eqH.type = 'highshelf';
    this.eqH.frequency.value = 10000; this.eqH.gain.value = 1.5;
    
    // Professional processing nodes
    this.multiband = new MultibandCompressor(c);
    this.glue = new GlueCompressor(c);
    this.saturation = new MasterSaturation(c, 1.15, 0.15);
    this.truePeak = new TruePeakLimiter(c, 0.94);
    
    this.master = c.createGain(); this.master.gain.value = 0.88;

    // Chain: sum → duck → HP → multiband → glue → saturation → truePeak → EQ → master → destination
    this.sum.connect(this.duck);
    this.duck.connect(masterHP);
    masterHP.connect(this.multiband.inputNode);
    this.multiband.connect(this.glue.inputNode);
    this.glue.connect(this.saturation.inputNode);
    this.saturation.connect(this.truePeak.inputNode);
    this.truePeak.connect(this.eqL);
    this.eqL.connect(this.eqH);
    this.eqH.connect(this.master);
    this.master.connect(c.destination);

    this.analyser = c.createAnalyser(); this.analyser.fftSize = 2048;
    this.master.connect(this.analyser);

    // ── LOAD AUDIOWORKLET DSP (async) ──────────────────────────
    // Real Moog ladder filter + band-limited saw oscillator.
    // Voices check this.workletsReady and fall back to BiquadFilter until loaded.
    this.workletLoadPromise = ensureWorkletsLoaded(c);
    this.workletLoadPromise.then((ok) => { this.workletsReady = ok; });

    // ── LOAD ENGINE WORKLET (full synth engine) ──────────────
    // When ready, ALL synthesis happens in the audio thread.
    // Zero per-hit node creation, sample-accurate timing.
    this.engineNode = new Psy4EngineNode(c);
    this.engineNode.init().then(async (ok) => {
      this.useWorkletEngine = ok;
      if (ok) {
        this.engineNode!.onStats((stats) => { this.engineStats = stats; });
        // Connect engine output to analyser (for visualizer) in addition to destination
        const engOut = this.engineNode!.outputNode;
        if (engOut && this.analyser) {
          engOut.connect(this.analyser);
        }
        // Send initial world params
        this.sendWorldParamsToEngine();
        this.sendMacrosToEngine();

        // ── LOAD PSY3 SAMPLES into the worklet ──
        // This is the key sound quality upgrade: the worklet plays the REAL
        // kick.wav, hat_closed.wav, hat_open.wav, clap.wav samples instead of
        // pure synth DSP. Samples are transferred as Float32Array (zero-copy).
        this.sampleBank = new SampleBank(c);
        const loaded = await this.sampleBank.loadAll();
        if (loaded) {
          const payload = this.sampleBank.toWorkletPayload();
          this.engineNode!.loadSamples(payload);
          this.samplesLoaded = true;
          console.log('[PSY4] PSY3 samples loaded into worklet');
        }

        // ── GENERATE MULTISAMPLE BANK (procedural variety) ──
        // Generate 40+ kick/bass/lead/hat/clap variants with different characters
        // (deep, punchy, dark, bright, aggressive, warm). All procedurally
        // generated — no copyright issues. Gives SampleSelector real choices.
        const { generateMultisampleBank } = await import('./multisampleGenerator');
        const { SampleSelector } = await import('./sampleSelector');
        const multisamples = generateMultisampleBank();
        this.sampleSelector = new SampleSelector(multisamples);
        // Transfer multisamples to worklet too
        const multiPayload = multisamples.map(s => ({
          name: s.name, category: s.category, subcategory: s.subcategory,
          sampleRate: s.sampleRate, data: s.data,
        }));
        this.engineNode!.loadSamples(multiPayload);
        console.log(`[PSY4] Multisample bank generated: ${multisamples.length} samples (${this.sampleSelector.getStats().byCategory.kick || 0} kicks, ${this.sampleSelector.getStats().byCategory.bass || 0} bass, ${this.sampleSelector.getStats().byCategory.lead || 0} leads, ${this.sampleSelector.getStats().byCategory.hat || 0} hats, ${this.sampleSelector.getStats().byCategory.clap || 0} claps)`);

        console.log('[PSY4] Engine worklet active — synthesis in audio thread');
      }
    });

    // ── BUILD BUS ARCHITECTURE ────────────────────────────────
    // Each bus: input → lowShelf EQ → highShelf EQ → comp → saturation → out → sum
    // This gives per-group tonal shaping + glue compression + harmonic cohesion.
    const busConfig: Record<string, {
      lowShelf: number; lowFreq: number;
      highShelf: number; highFreq: number;
      thr: number; ratio: number; satDrive: number; makeupDb: number;
    }> = {
      drum:  { lowShelf: 2,   lowFreq: 100, highShelf: 1.5, highFreq: 6000, thr: -10, ratio: 3,   satDrive: 1.4, makeupDb: 1 },
      bass:  { lowShelf: 1.5, lowFreq: 60,  highShelf: -4,  highFreq: 800,  thr: -12, ratio: 2.5, satDrive: 1.3, makeupDb: 1 },
      music: { lowShelf: -3,  lowFreq: 200, highShelf: 1.5, highFreq: 5000, thr: -14, ratio: 2,   satDrive: 1.2, makeupDb: 1 },
      atmos: { lowShelf: -4,  lowFreq: 200, highShelf: 1,   highFreq: 4000, thr: -20, ratio: 1.5, satDrive: 1.1, makeupDb: 0 },
      fx:    { lowShelf: -6,  lowFreq: 300, highShelf: 2,   highFreq: 5000, thr: -16, ratio: 2,   satDrive: 1.2, makeupDb: 1 },
    };
    for (const [name, cfg] of Object.entries(busConfig)) {
      const input = c.createGain();
      const lowShelf = c.createBiquadFilter();
      lowShelf.type = 'lowshelf'; lowShelf.frequency.value = cfg.lowFreq; lowShelf.gain.value = cfg.lowShelf;
      const highShelf = c.createBiquadFilter();
      highShelf.type = 'highshelf'; highShelf.frequency.value = cfg.highFreq; highShelf.gain.value = cfg.highShelf;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = cfg.thr; comp.ratio.value = cfg.ratio;
      comp.attack.value = 0.005; comp.release.value = 0.1; comp.knee.value = 4;
      const sat = c.createWaveShaper();
      const satCurve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = (i / 512) - 1; satCurve[i] = Math.tanh(x * cfg.satDrive); }
      sat.curve = satCurve;
      const out = c.createGain();
      out.gain.value = Math.pow(10, cfg.makeupDb / 20);
      input.connect(lowShelf); lowShelf.connect(highShelf);
      highShelf.connect(comp); comp.connect(sat); sat.connect(out);
      out.connect(this.sum);
      this.buses.set(name, { input, comp, out });
    }

    // ── BUILD CHANNEL STRIPS ─────────────────────────────────
    // Each voice gets: input → HP filter → gain → pan → bus → sum
    //                                → reverbSend → reverb
    //                                → delaySend → delay
    if (this.voiceSpecs) {
      for (const [name, strip] of Object.entries(this.voiceSpecs.channels)) {
        const input = c.createGain();
        const hp = c.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = strip.hpFreq;
        const gain = c.createGain();
        gain.gain.value = Math.pow(10, strip.gainDb / 20);
        const panner = c.createStereoPanner();
        panner.pan.value = strip.pan;
        const reverbSend = c.createGain();
        reverbSend.gain.value = strip.reverbSend;
        const delaySend = c.createGain();
        delaySend.gain.value = strip.delaySend;

        // Chain: input → hp → gain → panner → bus (group-based routing)
        input.connect(hp); hp.connect(gain); gain.connect(panner);
        panner.connect(this.busForChannel(name));
        // Sends (post-fader)
        gain.connect(reverbSend); gain.connect(delaySend);

        this.channelStrips.set(name, { input, hp, gain, reverbSend, delaySend, panner });
      }
    }

    // stereo delay (ping-pong)
    this.dSend = c.createGain();
    const dL = c.createDelay(2), dR = c.createDelay(2);
    dL.delayTime.value = 0.23; dR.delayTime.value = 0.31;
    const dF = c.createBiquadFilter(); dF.type = 'lowpass'; dF.frequency.value = 3500;
    const dFb = c.createGain(); dFb.gain.value = 0.35;
    this.dOut = c.createGain(); this.dOut.gain.value = 0.3;
    this.dSend.connect(dL); dL.connect(dF); dF.connect(dR); dR.connect(dFb); dFb.connect(dL);
    const pl = c.createStereoPanner(); pl.pan.value = -0.5;
    const pr = c.createStereoPanner(); pr.pan.value = 0.5;
    dL.connect(pl); dR.connect(pr); pl.connect(this.dOut); pr.connect(this.dOut);
    this.dOut.connect(this.sum);

    // reverb
    this.rSend = c.createGain(); this.rSend.gain.value = 0.25;
    this.conv = c.createConvolver(); this.conv.buffer = this.makeImpulse(2.2, 2.5);
    this.rSend.connect(this.conv); this.conv.connect(this.sum);

    // Connect channel strip sends to FX returns
    for (const [, strip] of this.channelStrips) {
      strip.reverbSend.connect(this.rSend);
      strip.delaySend.connect(this.dSend!);
    }

    // pre-generate buffers + waves
    this.pink = this.makePink();
    this.sawWave = this.makeWave('saw', 48);
    this.sqWave = this.makeWave('square', 48);
    this.triWave = this.makeWave('triangle', 48);
  }

  /** Get the channel input node for a voice — voices connect here instead of directly to sum. */
  private getChannelInput(name: string): GainNode {
    const strip = this.channelStrips.get(name);
    if (strip) return strip.input;
    // Fallback: connect directly to sum if no channel strip defined
    return this.sum!;
  }

  /** Route a channel strip to its production bus (drum/bass/music/atmos/fx). */
  private busForChannel(name: string): GainNode {
    const drum = ['kick', 'hat', 'clap', 'perc', 'shaker'];
    const bass = ['bass', 'acid'];
    const music = ['lead'];
    const atmos = ['pad', 'texture'];
    let busName = 'fx';
    if (drum.includes(name)) busName = 'drum';
    else if (bass.includes(name)) busName = 'bass';
    else if (music.includes(name)) busName = 'music';
    else if (atmos.includes(name)) busName = 'atmos';
    const bus = this.buses.get(busName);
    return bus ? bus.input : this.sum!;
  }

  /**
   * Create a Moog filter (real 4-stage tanh ladder via AudioWorklet if loaded,
   * else fall back to BiquadFilter approximation). Returns a node with
   * .inputNode / .outputNode / .cutoff / .resonance / .drive / .level.
   */
  private createVoiceFilter(opts: {
    cutoff?: number; resonance?: number; drive?: number; level?: number;
  }): { inputNode: AudioNode; outputNode: AudioNode; cutoff: AudioParam; resonance: AudioParam; drive: AudioParam; level: AudioParam; scheduleCutoff?: (t: number, start: number, end: number, dur: number) => void; dispose?: () => void } {
    const c = this.ctx!;
    if (this.workletsReady) {
      const node = createMoogFilter(c, opts);
      if (node) {
        const n = node as MoogFilterNode;
        return {
          inputNode: n, outputNode: n,
          cutoff: n.cutoff, resonance: n.resonance, drive: n.drive, level: n.level,
          scheduleCutoff: (t, start, end, dur) => {
            n.cutoff.cancelScheduledValues(t);
            n.cutoff.setValueAtTime(start, t);
            n.cutoff.exponentialRampToValueAtTime(Math.max(20, end), t + dur);
          },
          dispose: () => { try { n.disconnect(); } catch { /* noop */ } },
        };
      }
    }
    // Fallback: BiquadFilter + WaveShaper approximation
    return this.createFallbackFilter(opts);
  }

  /** BiquadFilter + WaveShaper fallback (used until worklets load). */
  private createFallbackFilter(opts: {
    cutoff?: number; resonance?: number; drive?: number; level?: number;
  }): { inputNode: AudioNode; outputNode: AudioNode; cutoff: AudioParam; resonance: AudioParam; drive: AudioParam; level: AudioParam; scheduleCutoff?: (t: number, start: number, end: number, dur: number) => void; dispose?: () => void } {
    const c = this.ctx!;
    const chain = new MoogFilterChain(c);
    chain.setParams({
      cutoff: opts.cutoff ?? 1000,
      resonance: opts.resonance ?? 0.3,
      drive: opts.drive ?? 1,
      level: opts.level ?? 1,
    });
    return {
      inputNode: chain.inputNode,
      outputNode: chain.outputNode,
      cutoff: (chain as unknown as { filter: BiquadFilterNode }).filter.frequency,
      resonance: (chain as unknown as { filter: BiquadFilterNode }).filter.Q,
      // drive/level on fallback aren't AudioParams (WaveShaper can't automate) — return dummy
      drive: { value: opts.drive ?? 1, setValueAtTime: () => {}, setTargetAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, cancelScheduledValues: () => {}, cancelAndHoldAtTime: () => {} } as unknown as AudioParam,
      level: { value: opts.level ?? 1, setValueAtTime: () => {}, setTargetAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, cancelScheduledValues: () => {}, cancelAndHoldAtTime: () => {} } as unknown as AudioParam,
      scheduleCutoff: (t, start, end, dur) => chain.scheduleCutoff(t, start, end, dur),
      dispose: () => { try { chain.disconnect(); } catch { /* noop */ } },
    };
  }

  private makeWave(type: string, nH: number): PeriodicWave {
    const c = this.ctx!;
    const real = new Float32Array(nH + 1), imag = new Float32Array(nH + 1);
    for (let k = 1; k <= nH; k++) {
      if (type === 'saw') imag[k] = 2 / (Math.PI * k);
      else if (type === 'square') imag[k] = (k % 2) ? 4 / (Math.PI * k) : 0;
      else if (type === 'triangle') { const s = k % 2 ? 1 : -1; real[k] = s * 8 / (Math.PI * Math.PI * k * k); }
    }
    return c.createPeriodicWave(real, imag);
  }

  private makePink(): AudioBuffer {
    const c = this.ctx!, n = c.sampleRate * 2, b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        b0=0.99886*b0+w*0.0555179; b1=0.99332*b1+w*0.0750759; b2=0.969*b2+w*0.153852;
        b3=0.8665*b3+w*0.3104856; b4=0.55*b4+w*0.5329522; b5=-0.7616*b5-w*0.0168980;
        d[i] = (b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.11; b6=w*0.115926;
      }
    }
    return b;
  }

  private makeImpulse(sec: number, dec: number): AudioBuffer {
    const c = this.ctx!, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, dec);
    }
    return b;
  }

  private getWave(type: string): PeriodicWave | null {
    if (type === 'square') return this.sqWave;
    if (type === 'triangle') return this.triWave;
    return this.sawWave;
  }

  // ─── Voices ───────────────────────────────────────────────────

  /**
   * Create a band-limited oscillator (worklet polyBLEP if loaded, else
   * OscillatorNode+PeriodicWave fallback). Returns a uniform interface with
   * start()/stop()/disconnect() so voices don't care which engine is active.
   *
   * For worklet nodes: start() is a no-op (worklet runs continuously), stop(t)
   * schedules disconnect at time t. The envelope GainNode gates the audio.
   */
  private createVoiceOsc(freq: number, type: 'saw' | 'square' = 'saw'): {
    node: AudioNode; frequency: AudioParam; detune: AudioParam;
    start: (t: number) => void; stop: (t: number) => void;
  } {
    const c = this.ctx!;
    if (this.workletsReady) {
      if (type === 'saw') {
        const n = createBLSaw(c, { frequency: freq });
        if (n) {
          const bl = n as BLSawNode;
          // Worklet runs continuously; envelope gates it. Schedule disconnect after stop.
          return {
            node: bl, frequency: bl.frequency,
            // BL saw has no detune param; emulate via frequency scaling at call site
            detune: { value: 0, setValueAtTime: () => {}, setTargetAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, cancelScheduledValues: () => {}, cancelAndHoldAtTime: () => {} } as unknown as AudioParam,
            start: () => {},
            stop: (tt) => {
              const delay = Math.max(0, (tt - c.currentTime) * 1000) + 50;
              setTimeout(() => { try { bl.disconnect(); } catch { /* noop */ } }, delay);
            },
          };
        }
      } else {
        const n = createBLSquare(c, { frequency: freq });
        if (n) {
          const bl = n;
          return {
            node: bl, frequency: bl.frequency,
            detune: { value: 0, setValueAtTime: () => {}, setTargetAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, cancelScheduledValues: () => {}, cancelAndHoldAtTime: () => {} } as unknown as AudioParam,
            start: () => {},
            stop: (tt) => {
              const delay = Math.max(0, (tt - c.currentTime) * 1000) + 50;
              setTimeout(() => { try { bl.disconnect(); } catch { /* noop */ } }, delay);
            },
          };
        }
      }
    }
    // Fallback: native OscillatorNode + PeriodicWave (aliases at high freq but works)
    const o = c.createOscillator();
    const wave = type === 'square' ? this.sqWave : this.sawWave;
    if (wave) o.setPeriodicWave(wave);
    o.frequency.value = freq;
    return { node: o, frequency: o.frequency, detune: o.detune, start: (tt) => o.start(tt), stop: (tt) => o.stop(tt) };
  }

  /** Disconnect a list of nodes after a delay (cleanup for worklet nodes). */
  private scheduleCleanup(nodes: AudioNode[], t: number, delaySec = 0.1) {
    const c = this.ctx!;
    if (!c) return;
    const delayMs = Math.max(0, (t - c.currentTime + delaySec) * 1000);
    setTimeout(() => { for (const n of nodes) { try { n.disconnect(); } catch { /* noop */ } } }, delayMs);
  }

  kick(t: number, amp = 1) {
    // ── WORKLET ENGINE: push event, no node creation ──
    if (this.useWorkletEngine) {
      this.scheduleEngineEvent(t, VOICE.KICK, 0, amp, this.world.kickDecay, 0);
      return;
    }
    const c = this.ctx!;
    const kickInput = this.getChannelInput('kick');
    const fund = this.world.kickFundamental;
    const spec = this.voiceSpecs?.kick;

    // ── HYBRID KICK: PSY3 sample + synthetic mid + click ──
    // Sample provides 93.6% sub body. Synth adds definition.

    // 1. SAMPLE LAYER
    if (spec?.useSample && this.soundBank.has(spec.sampleName || '')) {
      const sampleBuf = this.soundBank.get(spec.sampleName!);
      if (sampleBuf) {
        const src = c.createBufferSource();
        src.buffer = sampleBuf;
        src.playbackRate.value = fund / 50; // pitch-shift to match world fundamental
        const sG = c.createGain();
        sG.gain.setValueAtTime(spec.subLevel * amp, t);
        sG.gain.exponentialRampToValueAtTime(0.001, t + spec.decay);
        // Saturation on sample for character
        const sat = c.createWaveShaper();
        const satCurve = new Float32Array(256);
        const drive = 1 + spec.saturation * 1.5;
        for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; satCurve[i] = Math.tanh(x * drive); }
        sat.curve = satCurve;
        src.connect(sat); sat.connect(sG); sG.connect(kickInput);
        src.start(t); src.stop(t + spec.decay + 0.05);
      }
    } else {
      // Fallback: synthetic sub
      const sub = c.createOscillator(); sub.type = 'sine';
      sub.frequency.setValueAtTime(fund * 2.4, t);
      sub.frequency.exponentialRampToValueAtTime(fund, t + 0.008);
      sub.frequency.exponentialRampToValueAtTime(fund * 0.85, t + 0.09);
      const subG = c.createGain();
      subG.gain.setValueAtTime(0, t);
      subG.gain.linearRampToValueAtTime(0.9 * amp, t + 0.001);
      subG.gain.exponentialRampToValueAtTime(0.001, t + this.world.kickDecay);
      sub.connect(subG); subG.connect(kickInput);
      sub.start(t); sub.stop(t + this.world.kickDecay + 0.02);
    }

    // 2. SYNTHETIC MID PUNCH (always — adds definition on top of sample)
    const mid = c.createOscillator(); mid.type = 'triangle';
    mid.frequency.setValueAtTime(fund * 2, t);
    mid.frequency.exponentialRampToValueAtTime(fund * 1.5, t + 0.02);
    const midSat = c.createWaveShaper();
    const midCurve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; midCurve[i] = Math.tanh(x * 1.5); }
    midSat.curve = midCurve;
    const midG = c.createGain();
    midG.gain.setValueAtTime((spec?.midLevel || 0.4) * amp, t);
    midG.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    mid.connect(midSat); midSat.connect(midG); midG.connect(kickInput);
    mid.start(t); mid.stop(t + 0.06);

    // 3. CLICK: noise, very short
    const clickSrc = c.createBufferSource(); clickSrc.buffer = this.pink;
    const clickHP = c.createBiquadFilter(); clickHP.type = 'highpass'; clickHP.frequency.value = 3000;
    const clickG = c.createGain();
    clickG.gain.setValueAtTime((spec?.clickLevel || 0.08) * amp, t);
    clickG.gain.exponentialRampToValueAtTime(0.001, t + 0.003);
    clickSrc.connect(clickHP); clickHP.connect(clickG); clickG.connect(kickInput);
    clickSrc.start(t); clickSrc.stop(t + 0.01);

    // sidechain
    if (this.duck) {
      const d = this.duck.gain;
      d.cancelScheduledValues(t);
      d.setValueAtTime(1 - this.world.duck * (0.5 + this.macros.aggression * 0.5), t);
      d.setTargetAtTime(1, t + 0.02, 0.08 + this.macros.groove * 0.04);
    }
  }

  bass(t: number, midi: number, dur: number, amp = 0.5, acid = false) {
    // ── WORKLET ENGINE: push event, no node creation ──
    if (this.useWorkletEngine) {
      this.scheduleEngineEvent(t, VOICE.BASS, mtof(midi), amp, dur, acid ? 1 : 0);
      return;
    }
    const c = this.ctx!, f = mtof(midi);
    const spec = this.voiceSpecs?.bass;
    const bassInput = this.getChannelInput('bass');

    // ── BASS REBUILD: multi-layer architecture ──
    //   SUB   : clean sine at f/2, mono, bypasses filter for clean low end
    //   BODY  : BL saw → real Moog ladder filter (cutoff envelope) → drive
    //   The Moog filter's tanh saturation adds harmonic character that
    //   BiquadFilter cannot — this is the PSY3 sound.

    // 1. SUB LAYER (clean fundamental, no filter)
    const sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.value = f / 2;
    const subG = c.createGain();
    subG.gain.setValueAtTime(0, t);
    subG.gain.linearRampToValueAtTime((spec?.subLevel ?? 0.6) * amp, t + 0.003);
    subG.gain.linearRampToValueAtTime(0, t + dur);
    sub.connect(subG); subG.connect(bassInput);
    sub.start(t); sub.stop(t + dur + 0.03);

    // 2. BODY LAYER: BL saw → real Moog filter → amp envelope
    const oscWrap = this.createVoiceOsc(f, acid ? 'square' : 'saw');

    // Real Moog ladder filter (4-stage tanh, sample-accurate via AudioWorklet)
    const cutoffStart = acid ? 2500 : (spec?.cutoffStart ?? 1200);
    const cutoffEnd = acid ? this.world.bassCutoff : (spec?.cutoffEnd ?? 150);
    const resQ = acid ? this.world.bassResonance : (spec?.resonance ?? 3);
    const filter = this.createVoiceFilter({
      cutoff: cutoffStart,
      resonance: Math.min(1, resQ / 20),   // map Q→0..1 for Moog self-osc
      drive: 1 + (spec?.saturation ?? 0.3) * 2 + this.macros.aggression * 0.5,
      level: 1,
    });
    // Filter envelope: cutoff sweeps high→low (psytrance bass pluck character)
    if (filter.scheduleCutoff) {
      filter.scheduleCutoff(t, cutoffStart, cutoffEnd, Math.min(dur, 0.08));
    }

    // Amp envelope: snappy attack, sustain, quick release (PSY3 uses 0.42 level)
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime((spec?.ampLevel ?? 0.42) * amp, t + 0.003);
    g.gain.linearRampToValueAtTime(0, t + dur);

    // Route: osc → filter → gain → bassInput
    oscWrap.node.connect(filter.inputNode);
    filter.outputNode.connect(g);
    g.connect(bassInput);

    oscWrap.start(t);
    oscWrap.stop(t + dur + 0.05);
    // Clean up worklet nodes after note ends
    this.scheduleCleanup([filter.inputNode as AudioNode, g], t + dur + 0.1, 0.05);

    // Sidechain ducking (kick has priority over bass)
    if (this.duck) {
      const d = this.duck.gain;
      d.cancelScheduledValues(t);
      d.setValueAtTime(1 - this.world.duck * (0.5 + this.macros.aggression * 0.5), t);
      d.setTargetAtTime(1, t + 0.02, 0.08 + this.macros.groove * 0.04);
    }
  }

  lead(t: number, midi: number, dur: number, amp = 0.2, pan = 0) {
    // ── WORKLET ENGINE: push event, no node creation ──
    if (this.useWorkletEngine) {
      this.scheduleEngineEvent(t, VOICE.LEAD, mtof(midi), amp, dur, pan);
      return;
    }
    const c = this.ctx!, f = mtof(midi);
    const spec = this.voiceSpecs?.lead;
    const leadInput = this.getChannelInput('lead');

    // ── LEAD REBUILD: BL supersaw → real Moog filter → amp envelope ──
    // The Moog filter's resonance + tanh saturation gives the warm, vocal
    // character that makes psytrance leads sing instead of buzz.
    const baseCut = (spec?.cutoff ?? 1800) * (0.7 + this.macros.brightness * 0.6);

    // Real Moog ladder filter with filter envelope (open → settle)
    const filter = this.createVoiceFilter({
      cutoff: baseCut * 2,
      resonance: Math.min(1, ((spec?.resonance ?? 2) + this.macros.psychedelia * 3) / 20),
      drive: 1 + (spec?.saturation ?? 0.2) * 1.5,
      level: 1,
    });
    if (filter.scheduleCutoff) {
      filter.scheduleCutoff(t, baseCut * 2, baseCut, dur);
    }

    // LFO modulation on filter cutoff (psychedelic movement)
    if (this.macros.psychedelia > 0.3) {
      const lfo = c.createOscillator(); lfo.type = 'sine';
      lfo.frequency.value = 0.5 + this.macros.psychedelia * 3;
      const lfoGain = c.createGain();
      lfoGain.gain.value = baseCut * 0.3 * this.macros.psychedelia;
      lfo.connect(lfoGain); lfoGain.connect(filter.cutoff);
      lfo.start(t); lfo.stop(t + dur + 0.1);
    }

    // Amp envelope
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime((spec?.level ?? 0.16) * amp / 0.2, t + 0.006);
    g.gain.linearRampToValueAtTime(0, t + dur);

    // Supersaw: N detuned BL saws, stereo-spread
    const numOscs = spec?.numOscs ?? 5;
    const detune = (spec?.detune ?? 10) * (0.5 + this.macros.psychedelia);
    const spread = spec?.stereoSpread ?? 0.4;
    const oscType = (spec?.oscType === 'square') ? 'square' : 'saw';
    const cleanupNodes: AudioNode[] = [];
    for (let i = 0; i < numOscs; i++) {
      const oscWrap = this.createVoiceOsc(f, oscType);
      // Detune (BL saw has no detune param — adjust frequency directly)
      const detuneCents = (i - (numOscs - 1) / 2) * detune;
      const detuneMult = Math.pow(2, detuneCents / 1200);
      oscWrap.frequency.setValueAtTime(f * detuneMult, t);
      const pp = c.createStereoPanner();
      pp.pan.value = (i - (numOscs - 1) / 2) * (spread * 2 / Math.max(1, numOscs - 1));
      oscWrap.node.connect(pp); pp.connect(filter.inputNode);
      oscWrap.start(t);
      oscWrap.stop(t + dur + 0.05);
      cleanupNodes.push(pp);
    }
    filter.outputNode.connect(g); g.connect(leadInput);
    if (this.dSend) g.connect(this.dSend);
    if (this.rSend) g.connect(this.rSend);
    this.scheduleCleanup([filter.inputNode as AudioNode, ...cleanupNodes], t + dur + 0.1, 0.05);
  }

  acid(t: number, midi: number, dur: number, amp = 0.25) {
    // ── WORKLET ENGINE: push event, no node creation ──
    if (this.useWorkletEngine) {
      this.scheduleEngineEvent(t, VOICE.ACID, mtof(midi), amp, dur, 0);
      return;
    }
    const c = this.ctx!, f = mtof(midi);
    const acidInput = this.getChannelInput('lead'); // acid shares lead channel/music bus

    // ── ACID REBUILD: BL square → high-resonance Moog filter → distortion ──
    // The acid sound is ALL about the resonant filter sweep. The real Moog
    // ladder's self-oscillation at high resonance gives the squelchy, vocal
    // "acid" character that BiquadFilter's linear resonance cannot.

    const oscWrap = this.createVoiceOsc(f, 'square');

    // High-resonance Moog filter (near self-oscillation) with envelope sweep
    const cutoffStart = 200 + this.macros.brightness * 3000;
    const cutoffEnd = 100;
    const filter = this.createVoiceFilter({
      cutoff: cutoffStart,
      resonance: Math.min(1, (12 + this.macros.psychedelia * 8) / 20), // high res for squelch
      drive: 2 + this.macros.aggression * 2,  // drive adds harmonic grit
      level: 1,
    });
    if (filter.scheduleCutoff) {
      filter.scheduleCutoff(t, cutoffStart, cutoffEnd, dur * 0.7);
    }

    // Distortion after filter (classic acid chain: osc → filter → overdrive)
    const dist = c.createWaveShaper();
    const curve = new Float32Array(1024);
    const driveAmt = 2 + this.macros.aggression * 2;
    for (let i = 0; i < 1024; i++) { const x = (i / 512) - 1; curve[i] = Math.tanh(x * driveAmt); }
    dist.curve = curve;

    // Amp envelope
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.003);
    g.gain.linearRampToValueAtTime(0, t + dur);

    oscWrap.node.connect(filter.inputNode);
    filter.outputNode.connect(dist); dist.connect(g);
    g.connect(acidInput);
    if (this.dSend) g.connect(this.dSend);
    if (this.rSend) g.connect(this.rSend);

    oscWrap.start(t);
    oscWrap.stop(t + dur + 0.05);
    this.scheduleCleanup([filter.inputNode as AudioNode, dist, g], t + dur + 0.1, 0.05);
  }

  hat(t: number, open = false, amp = 0.1, pan = 0.3) {
    // ── WORKLET ENGINE: push event, no node creation ──
    if (this.useWorkletEngine) {
      this.scheduleEngineEvent(t, open ? VOICE.HAT_OPEN : VOICE.HAT, 0, amp, 0, pan);
      return;
    }
    const c = this.ctx!;
    const hatInput = this.getChannelInput('hat');
    const spec = this.voiceSpecs?.hat;
    const sampleName = open ? 'hat_open.wav' : spec?.sampleName;

    // HYBRID: PSY3 sample + metallic synth layer
    if (spec?.useSample && sampleName && this.soundBank.has(sampleName)) {
      const sampleBuf = this.soundBank.get(sampleName);
      if (sampleBuf) {
        const src = c.createBufferSource();
        src.buffer = sampleBuf;
        const g = c.createGain();
        g.gain.setValueAtTime(amp * 0.7, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.3 : 0.06));
        const p = c.createStereoPanner(); p.pan.value = pan;
        src.connect(g); g.connect(p); p.connect(hatInput);
        src.start(t); src.stop(t + (open ? 0.35 : 0.08));
      }
    } else {
      // Fallback: metallic oscillator bank + noise
      const ratios = [1, 1.577, 2.135, 3.422];
      const baseFreq = open ? 265 : 340;
      const g = c.createGain();
      g.gain.setValueAtTime(amp, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.25 : 0.04));
      const p = c.createStereoPanner(); p.pan.value = pan;
      const metalMix = c.createGain(); metalMix.gain.value = 0.6;
      for (const r of ratios) {
        const o = c.createOscillator(); o.type = 'square';
        o.frequency.value = baseFreq * r;
        o.connect(metalMix);
        o.start(t); o.stop(t + 0.1);
      }
      const s = c.createBufferSource(); s.buffer = this.pink;
      const hp = c.createBiquadFilter(); hp.type = 'highpass';
      hp.frequency.value = open ? 7000 : 8500;
      const noiseG = c.createGain(); noiseG.gain.value = 0.4;
      s.connect(hp); hp.connect(noiseG);
      const outFilter = c.createBiquadFilter(); outFilter.type = 'highpass';
      outFilter.frequency.value = open ? 6000 : 7500;
      metalMix.connect(outFilter); noiseG.connect(outFilter);
      outFilter.connect(g); g.connect(p); p.connect(hatInput);
      s.start(t); s.stop(t + 0.3);
    }
  }

  shaker(t: number, amp = 0.06, pan = -0.2) {
    // ── WORKLET ENGINE: push event, no node creation ──
    if (this.useWorkletEngine) {
      this.scheduleEngineEvent(t, VOICE.SHAKER, 0, amp, 0, pan);
      return;
    }
    const c = this.ctx!, s = c.createBufferSource(); s.buffer = this.pink;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    const p = c.createStereoPanner(); p.pan.value = pan;
    s.connect(hp); hp.connect(g); g.connect(p); p.connect(this.getChannelInput('shaker'));
    s.start(t); s.stop(t + 0.08);
  }

  clap(t: number, amp = 0.3) {
    // ── WORKLET ENGINE: push event, no node creation ──
    if (this.useWorkletEngine) {
      this.scheduleEngineEvent(t, VOICE.CLAP, 0, amp, 0, 0);
      return;
    }
    const c = this.ctx!;
    const clapInput = this.getChannelInput('clap');
    const spec = this.voiceSpecs?.clap;

    // HYBRID: PSY3 sample + multi-burst synth layer
    if (spec?.useSample && spec.sampleName && this.soundBank.has(spec.sampleName)) {
      const sampleBuf = this.soundBank.get(spec.sampleName);
      if (sampleBuf) {
        const src = c.createBufferSource();
        src.buffer = sampleBuf;
        const g = c.createGain();
        g.gain.setValueAtTime(amp, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        src.connect(g); g.connect(clapInput);
        if (this.rSend) g.connect(this.rSend);
        src.start(t); src.stop(t + 0.3);
      }
    } else {
      // Fallback: multi-burst noise
      const burstTimes = [0, 0.01, 0.02, 0.035];
      const burstAmps = [0.4, 0.4, 0.4, 0.6];
      const burstDecays = [0.015, 0.015, 0.015, 0.12];
      for (let i = 0; i < 4; i++) {
        const s = c.createBufferSource(); s.buffer = this.pink;
        const bp = c.createBiquadFilter(); bp.type = 'bandpass';
        bp.frequency.value = 1800; bp.Q.value = 1.2;
        const g = c.createGain();
        g.gain.setValueAtTime(amp * burstAmps[i], t + burstTimes[i]);
        g.gain.exponentialRampToValueAtTime(0.001, t + burstTimes[i] + burstDecays[i]);
        const p = c.createStereoPanner(); p.pan.value = (i % 2 === 0) ? -0.15 : 0.15;
        s.connect(bp); bp.connect(g); g.connect(p); p.connect(clapInput);
        if (i === 3 && this.rSend) g.connect(this.rSend);
        s.start(t + burstTimes[i]); s.stop(t + burstTimes[i] + burstDecays[i] + 0.05);
      }
    }
  }

  perc(t: number, amp = 0.15, pan = 0.4) {
    // ── WORKLET ENGINE: push event, no node creation ──
    if (this.useWorkletEngine) {
      this.scheduleEngineEvent(t, VOICE.PERC, 400, amp, 0.08, pan);
      return;
    }
    const c = this.ctx!, o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(400, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.05);
    const g = c.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    const p = c.createStereoPanner(); p.pan.value = pan;
    o.connect(g); g.connect(p); p.connect(this.getChannelInput('perc'));
    o.start(t); o.stop(t + 0.1);
  }

  pad(t: number, root: number, chord: number[], dur: number, amp = 0.08) {
    // ── WORKLET ENGINE: push one event per chord note ──
    if (this.useWorkletEngine) {
      for (const iv of chord) {
        const f = mtof(root + 12 + iv);
        this.scheduleEngineEvent(t, VOICE.PAD, f, amp / chord.length, dur, 0);
      }
      return;
    }
    // ── PAD REBUILD: detuned BL saws → Moog filter → evolving detune LFO ──
    // Pads need width, movement, and warmth. The Moog filter's smooth cutoff
    // + tanh saturation gives the lush, analog pad character. Each chord
    // voice uses 2 detuned BL saws with a slow evolve LFO for breathing.
    const c = this.ctx!;
    const spec = this.voiceSpecs?.pad;
    const padInput = this.getChannelInput('pad');
    const cleanupNodes: AudioNode[] = [];

    chord.forEach((iv, k) => {
      const f = mtof(root + 12 + iv);

      // Real Moog filter (smooth, warm — not sterile BiquadFilter)
      const filter = this.createVoiceFilter({
        cutoff: (spec?.cutoff ?? this.world.padCutoff) * (0.7 + this.macros.brightness * 0.6),
        resonance: Math.min(1, (spec?.resonance ?? 0.5) / 20),
        drive: 1.1,
        level: 1,
      });

      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + (spec?.attack ?? 0.5));
      g.gain.linearRampToValueAtTime(0, t + dur);

      const oscType = (spec?.oscType === 'square') ? 'square' : 'saw';
      for (let i = 0; i < (spec?.numOscs ?? 2); i++) {
        const oscWrap = this.createVoiceOsc(f, oscType);
        // Static detune (BL saw has no detune param — adjust frequency)
        const detuneCents = i ? (spec?.detune ?? 7) : -(spec?.detune ?? 7);
        oscWrap.frequency.setValueAtTime(f * Math.pow(2, detuneCents / 1200), t);

        // EVOLVE: slow detune modulation via LFO modulating frequency
        // (BL saw frequency is an AudioParam, so LFO → frequency works)
        const lfo = c.createOscillator(); lfo.type = 'sine';
        lfo.frequency.value = (spec?.evolveRate ?? 0.1) + k * 0.03;
        const lfoGain = c.createGain();
        lfoGain.gain.value = f * (spec?.evolveDepth ?? 5) / 1200 * (1 + this.macros.evolution);
        lfo.connect(lfoGain); lfoGain.connect(oscWrap.frequency);
        lfo.start(t); lfo.stop(t + dur + 0.1);

        const pp = c.createStereoPanner(); pp.pan.value = i ? 0.4 : -0.4;
        oscWrap.node.connect(pp); pp.connect(filter.inputNode);
        oscWrap.start(t);
        oscWrap.stop(t + dur + 0.1);
        cleanupNodes.push(pp, lfoGain);
      }
      filter.outputNode.connect(g); g.connect(padInput);
      if (this.rSend) g.connect(this.rSend);
      cleanupNodes.push(filter.inputNode as AudioNode, g);
    });
    this.scheduleCleanup(cleanupNodes, t + dur + 0.15, 0.05);
  }

  texture(t: number, dur: number, amp = 0.08) {
    // ── WORKLET ENGINE: push event, no node creation ──
    if (this.useWorkletEngine) {
      const typeParam = this.world.textureType === 'noise' ? 1 : 0;
      this.scheduleEngineEvent(t, VOICE.TEXTURE, 0, amp, dur, typeParam);
      return;
    }
    const c = this.ctx!;
    if (this.world.textureType === 'noise') {
      // filtered noise texture
      const s = c.createBufferSource(); s.buffer = this.pink;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.setValueAtTime(800 + this.macros.psychedelia * 2000, t);
      bp.frequency.linearRampToValueAtTime(2000 + this.macros.psychedelia * 3000, t + dur);
      bp.Q.value = 2;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.5);
      g.gain.linearRampToValueAtTime(0, t + dur);
      const pl = c.createStereoPanner(); pl.pan.value = -0.3;
      const pr = c.createStereoPanner(); pr.pan.value = 0.3;
      s.connect(bp); bp.connect(g);
      g.connect(pl); pl.connect(this.getChannelInput('texture'));
      g.connect(pr); pr.connect(this.getChannelInput('texture'));
      if (this.rSend) g.connect(this.rSend);
      s.start(t); s.stop(t + dur + 0.1);
    } else if (this.world.textureType === 'fm') {
      // FM texture: carrier + modulator
      const carrier = c.createOscillator(); carrier.type = 'sine';
      carrier.frequency.value = 200 + this.macros.psychedelia * 300;
      const mod = c.createOscillator(); mod.type = 'sine';
      mod.frequency.value = 80 + this.macros.psychedelia * 120;
      const modGain = c.createGain(); modGain.gain.value = 100 + this.macros.psychedelia * 400;
      mod.connect(modGain); modGain.connect(carrier.frequency);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp * 0.6, t + 0.5);
      g.gain.linearRampToValueAtTime(0, t + dur);
      const pp = c.createStereoPanner(); pp.pan.value = 0.2;
      carrier.connect(g); g.connect(pp); pp.connect(this.getChannelInput('texture'));
      if (this.rSend) g.connect(this.rSend);
      carrier.start(t); mod.start(t);
      carrier.stop(t + dur + 0.1); mod.stop(t + dur + 0.1);
    } else {
      // wavetable-ish: two detuned oscillators with evolving filter
      const o1 = c.createOscillator(); if (this.sawWave) o1.setPeriodicWave(this.sawWave);
      o1.frequency.value = 150 + this.macros.psychedelia * 100;
      const o2 = c.createOscillator(); if (this.triWave) o2.setPeriodicWave(this.triWave);
      o2.frequency.value = o1.frequency.value * 1.01;
      const fl = c.createBiquadFilter(); fl.type = 'lowpass';
      fl.frequency.setValueAtTime(500, t);
      fl.frequency.linearRampToValueAtTime(3000, t + dur);
      fl.Q.value = 5;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp * 0.5, t + 0.5);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o1.connect(fl); o2.connect(fl); fl.connect(g);
      const pl = c.createStereoPanner(); pl.pan.value = -0.25;
      const pr = c.createStereoPanner(); pr.pan.value = 0.25;
      g.connect(pl); pl.connect(this.getChannelInput('texture')); g.connect(pr); pr.connect(this.getChannelInput('texture'));
      if (this.rSend) g.connect(this.rSend);
      o1.start(t); o2.start(t); o1.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
    }
  }

  riser(t: number, dur: number) {
    // ── WORKLET ENGINE: push event, no node creation ──
    if (this.useWorkletEngine) {
      this.scheduleEngineEvent(t, VOICE.RISER, 0, 0.25, dur, 0);
      return;
    }
    const c = this.ctx!, s = c.createBufferSource(); s.buffer = this.pink;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(8000, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + dur);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.05);
    s.connect(bp); bp.connect(g); g.connect(this.getChannelInput('fx'));
    if (this.rSend) g.connect(this.rSend);
    s.start(t); s.stop(t + dur + 0.1);
  }

  impact(t: number) {
    // ── WORKLET ENGINE: push event, no node creation ──
    if (this.useWorkletEngine) {
      this.scheduleEngineEvent(t, VOICE.IMPACT, 0, 0.7, 0.5, 0);
      return;
    }
    const c = this.ctx!, o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.4);
    const g = c.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g); g.connect(this.getChannelInput('fx'));
    o.start(t); o.stop(t + 0.55);
  }

  sweep(t: number, dur: number) {
    // ── WORKLET ENGINE: push event, no node creation ──
    if (this.useWorkletEngine) {
      this.scheduleEngineEvent(t, VOICE.SWEEP, 0, 0.15, dur, 0);
      return;
    }
    // filter sweep for transitions
    const c = this.ctx!, s = c.createBufferSource(); s.buffer = this.pink;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5;
    lp.frequency.setValueAtTime(200, t);
    lp.frequency.exponentialRampToValueAtTime(8000, t + dur);
    lp.frequency.exponentialRampToValueAtTime(200, t + dur + 0.1);
    const g = c.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.15, t + dur * 0.5);
    g.gain.linearRampToValueAtTime(0.001, t + dur);
    s.connect(lp); lp.connect(g); g.connect(this.getChannelInput('fx'));
    if (this.rSend) g.connect(this.rSend);
    s.start(t); s.stop(t + dur + 0.2);
  }

  // ─── Ear Candy Voices (from PSY3) ────────────────────────────

  /** FM zap — carrier + modulator with exponential index decay. Ear candy. */
  zap(t: number, amp = 0.15) {
    // ── WORKLET ENGINE: push event, no node creation ──
    if (this.useWorkletEngine) {
      this.scheduleEngineEvent(t, VOICE.ZAP, 0, amp, 0.04, 0);
      return;
    }
    const c = this.ctx!;
    const car = c.createOscillator(); car.type = 'sine';
    car.frequency.value = 880;
    const mod = c.createOscillator(); mod.type = 'sine';
    mod.frequency.value = 1760; // 2:1 ratio
    const modGain = c.createGain();
    modGain.gain.setValueAtTime(3000, t);
    modGain.gain.exponentialRampToValueAtTime(1, t + 0.03);
    mod.connect(modGain); modGain.connect(car.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    car.connect(g); g.connect(this.getChannelInput('fx'));
    if (this.dSend) g.connect(this.dSend);
    car.start(t); mod.start(t);
    car.stop(t + 0.06); mod.stop(t + 0.06);
  }

  /** Pure sine blip — ear candy / accent. */
  blip(t: number, freq = 1200, amp = 0.1) {
    // ── WORKLET ENGINE: push event, no node creation ──
    if (this.useWorkletEngine) {
      this.scheduleEngineEvent(t, VOICE.BLIP, freq, amp, 0.02, 0);
      return;
    }
    const c = this.ctx!, o = c.createOscillator(); o.type = 'sine';
    o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    o.connect(g); g.connect(this.getChannelInput('fx'));
    if (this.dSend) g.connect(this.dSend);
    o.start(t); o.stop(t + 0.03);
  }

  /** Downlifter — descending pitch sweep for transitions. */
  downlifter(t: number, amp = 0.2) {
    // ── WORKLET ENGINE: push event, no node creation ──
    if (this.useWorkletEngine) {
      this.scheduleEngineEvent(t, VOICE.DOWNLIFTER, 0, amp, 0.4, 0);
      return;
    }
    const c = this.ctx!, o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(800, t);
    o.frequency.exponentialRampToValueAtTime(100, t + 0.4);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2000;
    const g = c.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(lp); lp.connect(g); g.connect(this.getChannelInput('fx'));
    if (this.rSend) g.connect(this.rSend);
    o.start(t); o.stop(t + 0.45);
  }

  // ─── Scheduler ────────────────────────────────────────────────

  start(worldId?: string, seed?: number, macros?: Partial<Macros>) {
    this.init();
    this.ctx!.resume();
    if (worldId && WORLDS[worldId]) {
      this.world = WORLDS[worldId];
      this.voiceSpecs = getVoiceSpecs(worldId);
    }
    if (seed) this.seed = seed;
    if (macros) this.macros = { ...this.macros, ...macros };

    // Send current world params + macros to engine worklet
    this.sendWorldParamsToEngine();
    this.sendMacrosToEngine();

    if (this.useWorkletEngine && this.engineNode) {
      // ── WORKLET ENGINE MODE ──
      // All synthesis happens in the audio thread.
      // The main thread only generates musical events (no node creation).
      this.engineNode.play();
      this.playing = true;
      this.sectionIdx = 0;
      this.nextSection();
      this.si = 0;
      // REDUCED LATENCY: 50ms initial lookahead (was 150ms)
      // The worklet handles sample-accurate timing, so we only need enough
      // lookahead to batch a few events. 50ms = ~2 beats at 140bpm.
      this.next = this.ctx!.currentTime + 0.05;
      // 25ms timer for tighter response (was 50ms)
      // The worklet process() runs at audio rate, so the timer only
      // needs to keep the event queue fed.
      this.timer = setInterval(() => this.tick(), 25);
    } else {
      // ── LEGACY MODE (fallback) ──
      // Web Audio node creation per hit (original behavior)
      if (this.playing) return;
      this.playing = true;
      this.sectionIdx = 0;
      this.nextSection();
      this.si = 0;
      this.next = this.ctx!.currentTime + 0.1;
      this.timer = setInterval(() => this.tick(), 25);
    }
  }

  stop() {
    this.playing = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.useWorkletEngine && this.engineNode) {
      this.engineNode.stop();
    }
  }

  /** Send world parameters to the engine worklet. */
  private sendWorldParamsToEngine() {
    if (!this.engineNode || !this.useWorkletEngine) return;
    const w = this.world;
    this.engineNode.setWorld({
      kickFundamental: w.kickFundamental,
      kickDecay: w.kickDecay,
      bassCutoff: w.bassCutoff,
      bassResonance: w.bassResonance,
      leadCutoff: w.leadCutoff,
      leadDetune: w.leadDetune,
      padCutoff: w.padCutoff,
      padAttack: 0.5,
      padDetune: 7,
      padEvolveRate: 0.1,
      duck: w.duck,
    });
  }

  /** Send current macros to the engine worklet. */
  private sendMacrosToEngine() {
    if (!this.engineNode || !this.useWorkletEngine) return;
    this.engineNode.setMacros(this.macros);
  }

  /** Schedule an event in the engine worklet (worklet mode only). */
  private scheduleEngineEvent(time: number, voice: VoiceId, note: number, velocity: number, duration: number, param: number = 0) {
    if (this.engineNode) {
      this.engineNode.scheduleEvent(time, voice, note, velocity, duration, param);
    }
  }

  setWorld(worldId: string) {
    if (WORLDS[worldId]) {
      this.world = WORLDS[worldId];
      this.voiceSpecs = getVoiceSpecs(worldId);
      // Update channel strip gains for new world (legacy mode)
      if (this.voiceSpecs && this.ctx) {
        for (const [name, strip] of Object.entries(this.voiceSpecs.channels)) {
          const cs = this.channelStrips.get(name);
          if (cs) {
            cs.gain.gain.setTargetAtTime(Math.pow(10, strip.gainDb / 20), this.ctx.currentTime, 0.1);
            cs.hp.frequency.setTargetAtTime(strip.hpFreq, this.ctx.currentTime, 0.1);
            cs.panner.pan.setTargetAtTime(strip.pan, this.ctx.currentTime, 0.1);
            cs.reverbSend.gain.setTargetAtTime(strip.reverbSend, this.ctx.currentTime, 0.1);
            cs.delaySend.gain.setTargetAtTime(strip.delaySend, this.ctx.currentTime, 0.1);
          }
        }
      }
      if (this.dOut) this.dOut.gain.value = 0.15 + this.world.space * 0.3;
      if (this.rSend) this.rSend.gain.value = 0.15 + this.world.space * 0.3;
      // Update engine worklet with new world params
      this.sendWorldParamsToEngine();
    }
  }

  setMacros(macros: Partial<Macros>) {
    this.macros = { ...this.macros, ...macros };
    this.sendMacrosToEngine();
  }

  triggerAction(action: string) {
    const now = this.ctx?.currentTime ?? 0;
    switch (action) {
      case 'drop':
        this.macros.energy = 1;
        this.sectionIdx = 2; this.nextSection(); this.si = 0;
        // IMMEDIATE: reset event timing to NOW + small buffer for instant response
        if (this.useWorkletEngine && this.ctx) {
          this.next = this.ctx.currentTime + 0.03; // 30ms = fast response
          // Trigger immediate impact for audible feedback
          this.impact(this.ctx.currentTime + 0.02);
          // FLUSH IMMEDIATELY — don't wait for next tick (25ms)
          this.engineNode?.flushEvents();
        }
        break;
      case 'breakdown':
        this.macros.energy = 0.2; this.macros.space = Math.min(1, this.macros.space + 0.3);
        this.sectionIdx = 3; this.nextSection(); this.si = 0;
        if (this.useWorkletEngine && this.ctx) {
          this.next = this.ctx.currentTime + 0.03;
        }
        break;
      case 'build': this.macros.energy = Math.min(1, this.macros.energy + 0.3); break;
      case 'stranger': this.macros.psychedelia = Math.min(1, this.macros.psychedelia + 0.2); break;
      case 'darker': this.macros.darkness = Math.min(1, this.macros.darkness + 0.2); break;
      case 'brighter': this.macros.brightness = Math.min(1, this.macros.brightness + 0.2); break;
      case 'more-bass': this.macros.energy = Math.min(1, this.macros.energy + 0.15); break;
      case 'more-groove': this.macros.groove = Math.min(1, this.macros.groove + 0.2); break;
      case 'more-space': this.macros.space = Math.min(1, this.macros.space + 0.25); break;
      case 'reset': this.macros = { ...DEFAULT_MACROS }; break;
    }
    this.sendMacrosToEngine();
  }

  private nextSection() {
    const typ = SECTION_CYCLE[this.sectionIdx % SECTION_CYCLE.length];
    const bars = { intro: 8, build: 8, drop: 16, break: 8, climax: 16 }[typ] || 8;
    const baseDensity = { intro: 0.3, build: 0.6, drop: 0.9, break: 0.25, climax: 1 }[typ] || 0.5;
    const density = Math.max(0.15, Math.min(1, baseDensity * (0.5 + 0.7 * this.macros.energy)));
    const rng = new Rng(this.seed * 1000 + this.sectionIdx);
    const motif = new Motif(this.world.root, this.world.scale, rng);
    const energy = { intro: 0.3, build: 0.6, drop: 0.95, break: 0.2, climax: 1 }[typ] || 0.5;

    // ── PSY3-STYLE MUSICAL GRAMMAR ──
    // Create grammar objects with seeded RNG for deterministic variation
    const grammarRng = new SeededRng(this.seed * 1000 + this.sectionIdx + 999);
    const leadMotif = (typ !== 'intro' && typ !== 'break')
      ? new LeadMotif(this.world.root, this.world.scale, grammarRng)
      : null;
    const acidPattern = this.world.acid
      ? new AcidPattern(this.world.root, this.world.scale, grammarRng)
      : null;
    // Choose bass pattern based on world type
    const bassPatterns = BASS_PATTERNS[this.world.bass] || BASS_PATTERNS.off;
    const bassPatternIdx = grammarRng.int(0, bassPatterns.length - 1);
    // Tension shape per section type
    const tensionShape: TensionShape = typ === 'build' ? 'rise' : typ === 'break' ? 'fall' : 'arc';

    // ── CALL/RESPONSE ENGINE (prevents MIDI soup) ──
    // Primary lead and counter-lead alternate, never play simultaneously.
    // Creates musical conversation instead of everything-at-once.
    this.callResponse = new CallResponseEngine(this.world.root, this.world.scale, grammarRng);

    this.sec = { type: typ, bars, density, rng, motif, energy, chordIndex: 0,
                 leadMotif, acidPattern, bassPatternIdx, tensionShape };
    this.currentSection = typ;
    this.sectionIdx++;
  }

  private s16(): number { return 60 / this.world.bpm / 4; }

  private tick() {
    if (!this.playing || !this.ctx || !this.sec) return;
    // REDUCED LOOKAHEAD for lower latency:
    // Worklet mode: 0.1s (was 0.3s) — enough to batch ~4 events at 140bpm
    // Legacy mode: 0.15s (unchanged)
    // The worklet handles sample-accurate timing, so lookahead only affects
    // how far ahead we generate events, not when they play.
    const lookahead = this.useWorkletEngine ? 0.1 : 0.15;
    while (this.next < this.ctx.currentTime + lookahead) {
      this.step(this.si, this.next);
      this.si++;
      this.next += this.s16();
      if (this.si >= this.sec.bars * 16) {
        this.nextSection();
        this.si = 0;
        this.currentPhrase++;
        this.phrasesPlayed++;
        // Send 'newPhrase' to worklet — rotates phrase-locked samples
        // This gives sonic consistency (same kick for 8 bars) then variation
        if (this.useWorkletEngine && this.engineNode) {
          this.engineNode.notifyNewPhrase();
        }
      }
    }
    // Flush batched events to the engine worklet
    if (this.useWorkletEngine && this.engineNode) {
      this.engineNode.flushEvents();
    }
  }

  // ─── The Musical Brain (v2) ───────────────────────────────────

  private step(s: number, t: number) {
    if (!this.sec || !this.ctx) return;
    const S = this.sec;
    const sb = s % 16;           // step within bar (0-15)
    const bar = Math.floor(s / 16); // bar within section
    const phrase = Math.floor(s / 32); // 2-bar phrase
    const sw = this.world.swing * this.macros.groove;
    this.currentBar = bar;
    const e = this.macros.energy;
    const psy = this.macros.psychedelia;
    const dens = this.macros.density;
    const w = this.world;

    // ─── SECTION AUTOMATION ──────────────────────────────────
    // DROP CONTRAST: last 2 bars of build — remove bass, narrow filter, create tension
    const isPreDrop = S.type === 'build' && bar >= S.bars - 2;
    const isDropStart = S.type === 'drop' && bar === 0;

    // Riser before drop (last 2 bars of build)
    if (isPreDrop && sb === 0) {
      this.riser(t, this.s16() * 32);
    }
    // Impact at drop start
    if (isDropStart && sb === 0) {
      this.impact(t);
    }
    // Filter sweep in breakdown
    if (S.type === 'break' && bar === 0 && sb === 0) {
      this.sweep(t, this.s16() * 32);
    }
    // Sweep at section transitions (last bar)
    if (bar === S.bars - 1 && sb === 12 && S.type !== 'break') {
      this.sweep(t, this.s16() * 4);
    }
    // Downlifter at drop start (descending sweep after impact = contrast)
    if (isDropStart && sb === 4) {
      this.downlifter(t, 0.1 + this.macros.energy * 0.05);
    }

    // ─── SECTION-AWARE REVERB/DELAY AUTOMATION ─────────────
    if (sb === 0 && bar === 0) {
      // Legacy path: adjust Web Audio reverb/delay sends
      if (this.rSend && this.ctx) {
        const reverbTarget = S.type === 'break' ? 0.4 + this.macros.space * 0.3
                           : S.type === 'drop' ? 0.15 + this.macros.space * 0.2
                           : 0.2 + this.macros.space * 0.25;
        this.rSend.gain.setTargetAtTime(reverbTarget, t, 0.5);
      }
      if (this.dSend && this.ctx) {
        const delayTarget = S.type === 'break' ? 0.3 + this.macros.space * 0.2
                          : S.type === 'build' ? 0.25 + this.macros.psychedelia * 0.15
                          : 0.15 + this.macros.psychedelia * 0.1;
        this.dSend.gain.setTargetAtTime(delayTarget, t, 0.5);
      }

      // ── WORKLET ENGINE: section-aware FX automation ──
      // Build: more reverb+delay (tension/space)
      // Drop: less reverb (punch/dry), moderate delay
      // Break: max reverb (atmospheric), high delay (psychedelic)
      // Intro/Outro: medium reverb
      if (this.useWorkletEngine && this.engineNode) {
        const space = this.macros.space;
        const psy = this.macros.psychedelia;
        let revSends: number[], delSends: number[], revWet: number, delWet: number, delFb: number;
        if (S.type === 'break') {
          // Break: max space, atmospheric
          revSends = [0.12, 0.03, 0.40, 0.60, 0.45];
          delSends = [0.08, 0.0, 0.30, 0.20, 0.25];
          revWet = 0.45; delWet = 0.35; delFb = 0.45;
        } else if (S.type === 'build') {
          // Build: rising tension, more delay
          revSends = [0.10, 0.02, 0.30, 0.45, 0.35];
          delSends = [0.06, 0.0, 0.25, 0.15, 0.20];
          revWet = 0.35; delWet = 0.30; delFb = 0.40;
        } else if (S.type === 'drop' || S.type === 'climax') {
          // Drop: dry punch, less reverb on drums/bass, moderate on music
          revSends = [0.05, 0.01, 0.20, 0.35, 0.25];
          delSends = [0.04, 0.0, 0.15, 0.08, 0.12];
          revWet = 0.25; delWet = 0.20; delFb = 0.35;
        } else {
          // Intro/outro: medium space
          revSends = [0.08, 0.02, 0.25, 0.40, 0.30];
          delSends = [0.05, 0.0, 0.20, 0.10, 0.15];
          revWet = 0.30; delWet = 0.25; delFb = 0.38;
        }
        // Apply macro space/psychedelia modulation
        revWet *= (0.7 + space * 0.6);
        delWet *= (0.7 + psy * 0.6);
        this.engineNode.setFX({
          reverbSends: revSends, delaySends: delSends,
          reverbWet: revWet, delayWet: delWet, delayFeedback: delFb,
        });
      }
    }

    // ─── PAD (chord progression, every 2 bars) ──────────────
    if (sb === 0 && bar % 2 === 0) {
      const progs = PROGRESSIONS[w.scale] || PROGRESSIONS.minor;
      const chord = progs[(bar / 2) % progs.length];
      const padAmp = 0.03 * (0.5 + e * 0.5) * (S.type === 'break' ? 1.5 : 0.8);
      this.pad(t, w.root - 12, chord, this.s16() * 32, padAmp);
    }

    // ─── TEXTURE (every 4 bars + continuous bed in drops) ───
    if (sb === 0 && bar % 4 === 0 && S.type !== 'intro') {
      this.texture(t, this.s16() * 64, w.textureLevel * (0.5 + psy * 0.5));
    }
    // Continuous texture bed in drops (every bar, lower volume)
    if (sb === 0 && bar % 2 === 1 && (S.type === 'drop' || S.type === 'climax')) {
      this.texture(t, this.s16() * 32, w.textureLevel * 0.4 * psy);
    }

    // ─── KICK (4 on floor, with velocity groove) ────────────
    if (sb % 4 === 0) {
      const isDownbeat = sb === 0;
      const kickVel = isDownbeat ? 0.9 + e * 0.1 : 0.8 + e * 0.15;
      this.kick(t, kickVel);
    }
    // Ghost kick on syncopated step in drop
    if (S.type === 'drop' && sb === 14 && S.rng.chance(0.3 * dens)) {
      this.kick(t, 0.3);
    }

    // ─── BASS (psytrance grammar — explicit patterns, not random) ──
    const isOff = sb % 2 === 1;
    const bt = isOff ? t + sw * this.s16() : t;
    // Use explicit bass patterns from BASS_PATTERNS (controlled, not random)
    const bassPatterns = BASS_PATTERNS[w.bass] || BASS_PATTERNS.off;
    const bassPattern = bassPatterns[S.bassPatternIdx % bassPatterns.length];
    const patternStep = Math.floor(sb / 2) % bassPattern.steps.length;
    const bassDegree = bassPattern.steps[patternStep];
    const bassAccent = bassPattern.accents[patternStep];

    // Determine if bass plays based on world type and pattern
    let bassOn = bassDegree >= 0 && bassAccent > 0;
    if (w.bass === 'roll') bassOn = bassOn && (isOff || sb % 4 === 0);
    else if (w.bass === 'off') bassOn = bassOn && sb % 4 === 2;
    else if (w.bass === 'acid') bassOn = bassOn && (isOff || sb === 0);

    // Rest before drop (last 2 bars of build — creates tension/contrast)
    if (isPreDrop) bassOn = false;
    // No bass in breakdown
    if (S.type === 'break') bassOn = false;

    if (bassOn) {
      const bassNote = grammarScaleNote(w.root, w.scale, bassDegree);
      // Velocity from pattern accent + energy
      let bassVel = bassAccent * (0.4 + e * 0.2);
      let bassDur = this.s16() * 0.9;
      // Ghost bass: very quiet on step 0 of odd bars (lift)
      const isGhost = (bar % 2 === 1 && sb === 0 && S.rng.chance(0.3));
      if (isGhost) { bassVel = 0.2; bassDur = this.s16() * 0.4; }
      this.bass(bt, bassNote, bassDur, bassVel, w.acid);
    }

    // ─── ACID LINE (stored pattern with controlled mutation) ──
    if (w.acid && S.type === 'drop' && sb % 2 === 0 && S.rng.chance(0.5 * psy)) {
      // Use AcidPattern (stored pattern, not random pick)
      if (S.acidPattern) {
        const acidNote = S.acidPattern.next();
        if (acidNote !== null) {
          this.acid(t, acidNote, this.s16() * 1.5, 0.15 + psy * 0.1);
        }
      }
    }

    // ─── HATS (with groove + velocity variation) ────────────
    if (w.hatPattern[sb] === 'x') {
      const hatVel = (sb % 4 === 0 ? 0.12 : 0.08) * (0.5 + dens * 0.5);
      const hatPan = 0.2 + Math.sin(s * 0.1) * 0.15; // slight movement
      this.hat(t + (sb % 4 === 2 ? sw * this.s16() : 0), false, hatVel, hatPan);
    }
    // Open hat on step 4
    if (sb === 4 && S.type !== 'break') {
      this.hat(t, true, 0.06 + dens * 0.04, -0.25);
    }
    // Shaker on offbeats in groove/drop
    if ((S.type === 'drop' || S.type === 'climax') && sb % 2 === 1 && S.rng.chance(0.6 * dens)) {
      this.shaker(t, 0.04 + dens * 0.03, -0.15 + Math.sin(s * 0.07) * 0.1);
    }

    // ─── CLAP / SNARE (on 2 & 4) ────────────────────────────
    if (sb === 4 && S.type !== 'intro' && S.type !== 'break') {
      this.clap(t, 0.25 * (0.5 + e * 0.5));
    }
    if (sb === 12 && S.type === 'drop') {
      this.clap(t, 0.2 * (0.5 + e * 0.5));
    }

    // ─── PERCUSSION (world-specific pattern) ────────────────
    if (w.percPattern[sb] === 'x' && S.type !== 'break' && S.rng.chance(0.7 * dens)) {
      const percPan = 0.3 + Math.sin(s * 0.05) * 0.2;
      this.perc(t, 0.1 + dens * 0.05, percPan);
    }

    // ─── DRUM FILL (last bar of phrase, steps 12-15) ────────
    if (bar % 4 === 3 && sb >= 12 && S.type !== 'break') {
      if (sb === 12) this.perc(t, 0.12, 0.4);
      if (sb === 13) this.hat(t, false, 0.1, -0.3);
      if (sb === 14) this.perc(t, 0.1, -0.3);
      if (sb === 15) this.hat(t, true, 0.08, 0.3);
    }

    // ─── LEAD with CALL/RESPONSE (prevents MIDI soup) ────────
    // Primary lead and counter-lead alternate bars — never play simultaneously.
    // Creates musical conversation instead of everything-at-once.
    if (S.density > 0.3 && S.type !== 'break' && this.callResponse) {
      // Determine which voice plays this bar (call/response)
      const phraseBar = bar % 8;
      const isPrimaryTurn = phraseBar < 2 || (phraseBar >= 4 && phraseBar < 6);
      const isCounterTurn = (phraseBar >= 2 && phraseBar < 4) || phraseBar >= 6;

      if (isPrimaryTurn && S.leadMotif) {
        // Primary lead
        const leadResult = S.leadMotif.nextNote(sb, bar, e * (0.5 + psy * 0.5), S.rng);
        if (leadResult) {
          const leadDur = this.s16() * (1.5 + psy * 0.5);
          const leadPan = Math.sin(s * 0.03) * 0.2;
          this.lead(t, leadResult.note, leadDur, leadResult.velocity * 0.2, leadPan);
        }
        if (sb === 0 && bar % 4 === 0 && bar > 0) S.leadMotif.evolve();
      } else if (isCounterTurn) {
        // Counter lead (response) — different register, slightly different character
        const counterNote = this.callResponse.nextNote('counter-lead');
        if (counterNote > 0 && S.rng.chance(0.5 * e)) {
          const counterDur = this.s16() * (1.2 + psy * 0.4);
          const counterPan = Math.sin(s * 0.04 + 1.5) * 0.25; // different pan position
          // Counter lead plays at different octave (already +12 from CallResponseEngine)
          this.lead(t, counterNote, counterDur, 0.12 * e, counterPan);
        }
      }
    }

    // ─── EAR CANDY (from PSY3: zap, blip, downlifter) ──────
    // Random FM zap — adds psychedelic sparkle
    if (S.rng.chance(0.03 * this.macros.surprise) && S.type === 'drop') {
      this.zap(t, 0.08 + this.macros.psychedelia * 0.07);
    }
    // Random blip — ear candy accent
    if (S.rng.chance(0.04 * this.macros.surprise) && S.type !== 'break') {
      const blipFreq = 800 + S.rng.int(0, 6) * 200;
      this.blip(t, blipFreq, 0.06 + this.macros.brightness * 0.04);
    }
    // Downlifter at 8-bar boundaries in builds/drops
    if (bar % 8 === 7 && sb === 0 && (S.type === 'drop' || S.type === 'climax')) {
      this.downlifter(t, 0.12 + this.macros.energy * 0.08);
    }
    // Random percussion hit with varying pan (spatial interest)
    if (S.rng.chance(0.02 * this.macros.surprise) && S.type !== 'break') {
      this.perc(t, 0.06, S.rng.gauss(0, 0.5));
    }
  }

  getAnalyser(): AnalyserNode | null { return this.analyser; }

  /** Get engine worklet stats (active voices, event count, CPU load). */
  getEngineStats(): EngineStats | null { return this.engineStats; }

  /** Get sample usage report — which samples actually played (name → hit count). */
  getSampleUsage(): Record<string, number> {
    return this.engineStats?.sampleUsage || {};
  }

  /** Check if the engine worklet is active (vs legacy Web Audio mode). */
  isWorkletEngineActive(): boolean { return this.useWorkletEngine; }

  getWorlds(): { id: string; name: string }[] {
    return Object.values(WORLDS).map(w => ({ id: w.id, name: w.name }));
  }
}
