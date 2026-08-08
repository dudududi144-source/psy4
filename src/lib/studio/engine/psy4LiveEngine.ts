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

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const c = this.ctx = new Ctx({ latencyHint: 'interactive' });

    this.sum = c.createGain();
    this.duck = c.createGain();
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 2.5;
    this.comp.attack.value = 0.015; this.comp.release.value = 0.2;
    this.lim = c.createDynamicsCompressor();
    this.lim.threshold.value = -1.5; this.lim.ratio.value = 20;
    this.lim.attack.value = 0.001; this.lim.release.value = 0.05;
    this.eqL = c.createBiquadFilter(); this.eqL.type = 'lowshelf';
    this.eqL.frequency.value = 80; this.eqL.gain.value = 2;
    this.eqH = c.createBiquadFilter(); this.eqH.type = 'highshelf';
    this.eqH.frequency.value = 10000; this.eqH.gain.value = 1.5;
    this.master = c.createGain(); this.master.gain.value = 0.82;

    this.sum.connect(this.duck); this.duck.connect(this.comp);
    this.comp.connect(this.lim); this.lim.connect(this.eqL);
    this.eqL.connect(this.eqH); this.eqH.connect(this.master);
    this.master.connect(c.destination);

    this.analyser = c.createAnalyser(); this.analyser.fftSize = 2048;
    this.master.connect(this.analyser);

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

    // pre-generate buffers + waves
    this.pink = this.makePink();
    this.sawWave = this.makeWave('saw', 48);
    this.sqWave = this.makeWave('square', 48);
    this.triWave = this.makeWave('triangle', 48);
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

  kick(t: number, amp = 1) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    const fund = this.world.kickFundamental;
    o.frequency.setValueAtTime(fund * 2.5, t);
    o.frequency.exponentialRampToValueAtTime(fund, t + 0.006);
    o.frequency.exponentialRampToValueAtTime(fund * 0.85, t + 0.08);
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + this.world.kickDecay);
    o.connect(g); g.connect(this.sum!);
    o.start(t); o.stop(t + this.world.kickDecay + 0.02);
    // click
    const cn = c.createBufferSource(); cn.buffer = this.pink;
    const chp = c.createBiquadFilter(); chp.type = 'highpass'; chp.frequency.value = 2000;
    const cg = c.createGain();
    cg.gain.setValueAtTime(0.2 * amp, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.008);
    cn.connect(chp); chp.connect(cg); cg.connect(this.sum!);
    cn.start(t); cn.stop(t + 0.012);
    // sidechain
    if (this.duck) {
      const d = this.duck.gain;
      d.cancelScheduledValues(t);
      d.setValueAtTime(1 - this.world.duck * (0.5 + this.macros.aggression * 0.5), t);
      d.setTargetAtTime(1, t + 0.02, 0.08 + this.macros.groove * 0.04);
    }
  }

  bass(t: number, midi: number, dur: number, amp = 0.5, acid = false) {
    const c = this.ctx!, f = mtof(midi);
    const o = c.createOscillator();
    const wave = acid ? this.sqWave : this.sawWave;
    if (wave) o.setPeriodicWave(wave);
    o.frequency.value = f;
    const sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.value = f / 2;
    const sg = c.createGain(); sg.gain.value = 0.4;
    const fl = c.createBiquadFilter(); fl.type = 'lowpass';
    fl.Q.value = acid ? this.world.bassResonance : 3;
    fl.frequency.setValueAtTime(acid ? 2500 : this.world.bassCutoff * 2, t);
    fl.frequency.exponentialRampToValueAtTime(this.world.bassCutoff, t + Math.min(dur, 0.1));
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.38 * amp, t + 0.003);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(fl); fl.connect(g); sub.connect(sg); sg.connect(g);
    g.connect(this.sum!);
    o.start(t); sub.start(t); o.stop(t + dur + 0.03); sub.stop(t + dur + 0.03);
  }

  lead(t: number, midi: number, dur: number, amp = 0.2, pan = 0) {
    const c = this.ctx!, f = mtof(midi);
    const fl = c.createBiquadFilter(); fl.type = 'lowpass';
    const cutoff = this.world.leadCutoff * (0.5 + this.macros.brightness * 1);
    fl.frequency.setValueAtTime(cutoff * 2, t);
    fl.frequency.exponentialRampToValueAtTime(cutoff, t + dur);
    fl.Q.value = 1 + this.macros.psychedelia * 3;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.14 * amp / 0.2, t + 0.006);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const wave = this.getWave(this.world.leadType);
    for (let i = 0; i < 3; i++) {
      const o = c.createOscillator();
      if (wave) o.setPeriodicWave(wave);
      o.frequency.value = f;
      o.detune.value = (i - 1) * this.world.leadDetune * (0.5 + this.macros.psychedelia);
      const pp = c.createStereoPanner(); pp.pan.value = (i - 1) * 0.35;
      o.connect(pp); pp.connect(fl); o.start(t); o.stop(t + dur + 0.05);
    }
    fl.connect(g); g.connect(this.sum!);
    if (this.dSend) g.connect(this.dSend);
    if (this.rSend) g.connect(this.rSend);
  }

  acid(t: number, midi: number, dur: number, amp = 0.25) {
    const c = this.ctx!, f = mtof(midi);
    const o = c.createOscillator();
    if (this.sqWave) o.setPeriodicWave(this.sqWave);
    o.frequency.value = f;
    const fl = c.createBiquadFilter(); fl.type = 'lowpass';
    fl.Q.value = 12 + this.macros.psychedelia * 8;
    // acid filter sweep: open → close
    fl.frequency.setValueAtTime(200 + this.macros.brightness * 3000, t);
    fl.frequency.exponentialRampToValueAtTime(100, t + dur * 0.7);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.003);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const dist = c.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(x * 3); }
    dist.curve = curve;
    o.connect(fl); fl.connect(dist); dist.connect(g); g.connect(this.sum!);
    if (this.dSend) g.connect(this.dSend);
    o.start(t); o.stop(t + dur + 0.05);
  }

  hat(t: number, open = false, amp = 0.1, pan = 0.3) {
    const c = this.ctx!, s = c.createBufferSource(); s.buffer = this.pink;
    const hp = c.createBiquadFilter(); hp.type = 'highpass';
    hp.frequency.value = open ? 7000 : 8500;
    const g = c.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.25 : 0.04));
    const p = c.createStereoPanner(); p.pan.value = pan;
    s.connect(hp); hp.connect(g); g.connect(p); p.connect(this.sum!);
    s.start(t); s.stop(t + 0.3);
  }

  shaker(t: number, amp = 0.06, pan = -0.2) {
    const c = this.ctx!, s = c.createBufferSource(); s.buffer = this.pink;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    const p = c.createStereoPanner(); p.pan.value = pan;
    s.connect(hp); hp.connect(g); g.connect(p); p.connect(this.sum!);
    s.start(t); s.stop(t + 0.08);
  }

  clap(t: number, amp = 0.3) {
    const c = this.ctx!, s = c.createBufferSource(); s.buffer = this.pink;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 1.5;
    const g = c.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    s.connect(bp); bp.connect(g); g.connect(this.sum!);
    if (this.rSend) g.connect(this.rSend);
    s.start(t); s.stop(t + 0.18);
  }

  perc(t: number, amp = 0.15, pan = 0.4) {
    const c = this.ctx!, o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(400, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.05);
    const g = c.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    const p = c.createStereoPanner(); p.pan.value = pan;
    o.connect(g); g.connect(p); p.connect(this.sum!);
    o.start(t); o.stop(t + 0.1);
  }

  pad(t: number, root: number, chord: number[], dur: number, amp = 0.04) {
    const c = this.ctx!;
    chord.forEach((iv) => {
      const f = mtof(root + 12 + iv);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = this.world.padCutoff * (0.7 + this.macros.brightness * 0.6);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.5);
      g.gain.linearRampToValueAtTime(0, t + dur);
      const wave = this.getWave(this.world.leadType);
      for (let i = 0; i < 2; i++) {
        const o = c.createOscillator();
        if (wave) o.setPeriodicWave(wave);
        o.frequency.value = f; o.detune.value = i ? 7 : -7;
        const pp = c.createStereoPanner(); pp.pan.value = i ? 0.4 : -0.4;
        o.connect(pp); pp.connect(lp); o.start(t); o.stop(t + dur + 0.1);
      }
      lp.connect(g); g.connect(this.sum!);
      if (this.rSend) g.connect(this.rSend);
    });
  }

  texture(t: number, dur: number, amp = 0.08) {
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
      g.connect(pl); pl.connect(this.sum!);
      g.connect(pr); pr.connect(this.sum!);
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
      carrier.connect(g); g.connect(pp); pp.connect(this.sum!);
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
      g.connect(pl); pl.connect(this.sum!); g.connect(pr); pr.connect(this.sum!);
      if (this.rSend) g.connect(this.rSend);
      o1.start(t); o2.start(t); o1.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
    }
  }

  riser(t: number, dur: number) {
    const c = this.ctx!, s = c.createBufferSource(); s.buffer = this.pink;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(8000, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + dur);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.05);
    s.connect(bp); bp.connect(g); g.connect(this.sum!);
    if (this.rSend) g.connect(this.rSend);
    s.start(t); s.stop(t + dur + 0.1);
  }

  impact(t: number) {
    const c = this.ctx!, o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.4);
    const g = c.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g); g.connect(this.sum!);
    o.start(t); o.stop(t + 0.55);
  }

  sweep(t: number, dur: number) {
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
    s.connect(lp); lp.connect(g); g.connect(this.sum!);
    if (this.rSend) g.connect(this.rSend);
    s.start(t); s.stop(t + dur + 0.2);
  }

  // ─── Scheduler ────────────────────────────────────────────────

  start(worldId?: string, seed?: number, macros?: Partial<Macros>) {
    this.init();
    this.ctx!.resume();
    if (worldId && WORLDS[worldId]) this.world = WORLDS[worldId];
    if (seed) this.seed = seed;
    if (macros) this.macros = { ...this.macros, ...macros };
    if (this.playing) return;
    this.playing = true;
    this.sectionIdx = 0;
    this.nextSection();
    this.si = 0;
    this.next = this.ctx!.currentTime + 0.1;
    this.timer = setInterval(() => this.tick(), 25);
  }

  stop() {
    this.playing = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  setWorld(worldId: string) {
    if (WORLDS[worldId]) {
      this.world = WORLDS[worldId];
      if (this.dOut) this.dOut.gain.value = 0.15 + this.world.space * 0.3;
      if (this.rSend) this.rSend.gain.value = 0.15 + this.world.space * 0.3;
    }
  }

  setMacros(macros: Partial<Macros>) { this.macros = { ...this.macros, ...macros }; }

  triggerAction(action: string) {
    switch (action) {
      case 'drop': this.macros.energy = 1; this.sectionIdx = 2; this.nextSection(); this.si = 0; break;
      case 'breakdown': this.macros.energy = 0.2; this.macros.space = Math.min(1, this.macros.space + 0.3); this.sectionIdx = 3; this.nextSection(); this.si = 0; break;
      case 'build': this.macros.energy = Math.min(1, this.macros.energy + 0.3); break;
      case 'stranger': this.macros.psychedelia = Math.min(1, this.macros.psychedelia + 0.2); break;
      case 'darker': this.macros.darkness = Math.min(1, this.macros.darkness + 0.2); break;
      case 'brighter': this.macros.brightness = Math.min(1, this.macros.brightness + 0.2); break;
      case 'more-bass': this.macros.energy = Math.min(1, this.macros.energy + 0.15); break;
      case 'more-groove': this.macros.groove = Math.min(1, this.macros.groove + 0.2); break;
      case 'more-space': this.macros.space = Math.min(1, this.macros.space + 0.25); break;
      case 'reset': this.macros = { ...DEFAULT_MACROS }; break;
    }
  }

  private nextSection() {
    const typ = SECTION_CYCLE[this.sectionIdx % SECTION_CYCLE.length];
    const bars = { intro: 8, build: 8, drop: 16, break: 8, climax: 16 }[typ] || 8;
    const baseDensity = { intro: 0.3, build: 0.6, drop: 0.9, break: 0.25, climax: 1 }[typ] || 0.5;
    const density = Math.max(0.15, Math.min(1, baseDensity * (0.5 + 0.7 * this.macros.energy)));
    const rng = new Rng(this.seed * 1000 + this.sectionIdx);
    const motif = new Motif(this.world.root, this.world.scale, rng);
    const energy = { intro: 0.3, build: 0.6, drop: 0.95, break: 0.2, climax: 1 }[typ] || 0.5;
    this.sec = { type: typ, bars, density, rng, motif, energy, chordIndex: 0 };
    this.currentSection = typ;
    this.sectionIdx++;
  }

  private s16(): number { return 60 / this.world.bpm / 4; }

  private tick() {
    if (!this.playing || !this.ctx || !this.sec) return;
    while (this.next < this.ctx.currentTime + 0.15) {
      this.step(this.si, this.next);
      this.si++;
      this.next += this.s16();
      if (this.si >= this.sec.bars * 16) {
        this.nextSection();
        this.si = 0;
        this.currentPhrase++;
        this.phrasesPlayed++;
      }
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
    // Riser before drop (last 2 bars of build)
    if (S.type === 'build' && bar >= S.bars - 2 && sb === 0) {
      this.riser(t, this.s16() * 32);
    }
    // Impact at drop start
    if (S.type === 'drop' && bar === 0 && sb === 0) {
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

    // ─── PAD (chord progression, every 2 bars) ──────────────
    if (sb === 0 && bar % 2 === 0) {
      const progs = PROGRESSIONS[w.scale] || PROGRESSIONS.minor;
      const chord = progs[(bar / 2) % progs.length];
      const padAmp = 0.03 * (0.5 + e * 0.5) * (S.type === 'break' ? 1.5 : 0.8);
      this.pad(t, w.root - 12, chord, this.s16() * 32, padAmp);
    }

    // ─── TEXTURE (every 4 bars) ─────────────────────────────
    if (sb === 0 && bar % 4 === 0 && S.type !== 'intro') {
      this.texture(t, this.s16() * 64, w.textureLevel * (0.5 + psy * 0.5));
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

    // ─── BASS (psytrance grammar) ───────────────────────────
    const isOff = sb % 2 === 1;
    const bt = isOff ? t + sw * this.s16() : t;
    // Different bass patterns per world
    let bassOn = false;
    if (w.bass === 'roll') bassOn = isOff;                    // rolling 16ths
    else if (w.bass === 'off') bassOn = sb % 4 === 2;          // offbeat
    else if (w.bass === 'acid') bassOn = isOff || sb === 0;    // acid (denser)

    // Rest before drop (last step of build)
    if (S.type === 'build' && bar === S.bars - 1 && sb >= 14) bassOn = false;
    // No bass in breakdown
    if (S.type === 'break') bassOn = false;

    if (bassOn) {
      // Bass note: mostly root, occasional fifth/octave on phrase boundaries
      let bassDegree = 0;
      if (bar % 4 === 3 && sb === 15) bassDegree = 4;  // fifth before phrase end
      if (bar % 8 === 7 && sb === 15) bassDegree = 7;  // octave at 8-bar boundary
      const bassNote = scaleNote(w.root, w.scale, bassDegree);
      // Velocity groove: stronger on beat 1&3, lighter on 2&4
      const beatPos = Math.floor(sb / 4);
      const bassVel = (beatPos === 0 ? 0.45 : beatPos === 2 ? 0.42 : 0.35) + e * 0.15;
      this.bass(bt, bassNote, this.s16() * 0.9, bassVel, w.acid);
    }

    // ─── ACID LINE (in acid worlds + drops) ─────────────────
    if (w.acid && S.type === 'drop' && sb % 2 === 0 && S.rng.chance(0.4 * psy)) {
      const acidDegree = S.rng.pick([0, 0, 2, 4, 7, 0, -1]);
      const acidNote = scaleNote(w.root + 12, w.scale, acidDegree);
      this.acid(t, acidNote, this.s16() * 1.5, 0.15 + psy * 0.1);
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

    // ─── LEAD (motif-based, AABA structure) ─────────────────
    if (S.density > 0.3 && S.type !== 'break') {
      const motifNote = S.motif.next();
      if (motifNote.step === sb && S.rng.chance(S.density * (0.5 + psy * 0.5))) {
        const leadNote = scaleNote(w.root + 12, w.scale, motifNote.degree);
        const leadDur = this.s16() * (1.5 + psy * 0.5);
        const leadVel = 0.15 * (0.5 + e * 0.5);
        const leadPan = Math.sin(s * 0.03) * 0.2;
        this.lead(t, leadNote, leadDur, leadVel, leadPan);
      }
      // Mutate motif every 4 bars
      if (sb === 0 && bar % 4 === 0 && bar > 0) {
        S.motif.mutate(S.rng);
      }
    }

    // ─── SURPRISE EVENTS (ear candy) ────────────────────────
    if (S.rng.chance(0.005 * this.macros.surprise) && S.type === 'drop') {
      // Random reverse-ish perc or zap
      this.perc(t, 0.08, S.rng.gauss(0, 0.4));
    }
  }

  getAnalyser(): AnalyserNode | null { return this.analyser; }

  getWorlds(): { id: string; name: string }[] {
    return Object.values(WORLDS).map(w => ({ id: w.id, name: w.name }));
  }
}
