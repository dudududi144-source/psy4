/**
 * PSY4 LIVE ENGINE — browser-native Web Audio realtime synthesis.
 *
 * Architecture: HYBRID
 *   - Intelligence layer (worlds, memory, director, hooks, groove) runs in JS
 *   - Synthesis layer uses native Web Audio nodes (createOscillator, createPeriodicWave,
 *     GainNode, BiquadFilter, ConvolverNode, StereoPanner)
 *   - 25ms lookahead scheduler maintains continuous playback
 *   - No server rendering for live mode — all DSP is browser-native
 *
 * Adapted from PSY3's rt_engine.js with PSY4's world system + groove + hooks.
 *
 * This replaces the previous server-render-stream architecture which had:
 *   - 10-40 second latency per phrase
 *   - Audio gaps between phrases
 *   - No real-time macro response
 *   - Browser freeze during generation
 *
 * REAL IMPLEMENTATION — runs entirely in the browser.
 */

// ─── Scales & Music Theory ──────────────────────────────────────

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
  const n = sc.length;
  const o = Math.floor(deg / n);
  return root + 12 * o + sc[((deg % n) + n) % n];
}

// ─── Deterministic RNG ──────────────────────────────────────────

class Rng {
  s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number { this.s = (this.s * 1664525 + 1013904223) >>> 0; return this.s / 4294967296; }
  int(min: number, max: number): number { return Math.floor(this.next() * (max - min + 1)) + min; }
  pick<T>(a: T[]): T { return a[Math.floor(this.next() * a.length)]; }
  chance(p: number): boolean { return this.next() < p; }
  gauss(m: number, sd: number): number { return m + sd * (this.next() + this.next() + this.next() - 1.5); }
}

// ─── Evolving Sequence (motif with controlled mutation) ─────────

class EvolvingSequence {
  root: number; scale: string; rng: Rng; mr: number;
  pattern: number[] = []; pos = 0; cnt = 0;
  constructor(root: number, scale: string, rng: Rng, mr = 5) {
    this.root = root; this.scale = scale; this.rng = rng; this.mr = mr;
    this.regen();
  }
  regen() {
    this.pattern = [0];
    for (let i = 1; i < 16; i++) {
      const st = this.rng.pick([-2, -1, -1, 0, 1, 1, 2]);
      this.pattern.push(Math.max(-this.mr, Math.min(this.mr, this.pattern[i - 1] + st)));
    }
    this.cnt = 0;
  }
  next(): number {
    const note = scaleNote(this.root, this.scale, this.pattern[this.pos]);
    this.pos = (this.pos + 1) % 16;
    if (++this.cnt >= 64) {
      const i = this.rng.int(0, 15);
      const st = this.rng.pick([-2, -1, 1, 2]);
      this.pattern[i] = Math.max(-this.mr, Math.min(this.mr, this.pattern[i] + st));
      this.cnt = 0;
    }
    return note;
  }
}

// ─── World definitions ──────────────────────────────────────────

export interface Psy4World {
  id: string; name: string;
  bpm: number; scale: string; root: number;
  bass: 'roll' | 'off' | 'acid';
  density: number; drive: number; swing: number; space: number; duck: number;
  acid: boolean;
  kickDecay: number; kickFundamental: number;
  bassCutoff: number; bassResonance: number;
  leadCutoff: number; leadDetune: number;
  padCutoff: number;
  textureLevel: number;
  energyCurve: number[];
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
    padCutoff: 1200, textureLevel: 0.15,
    energyCurve: [0.3, 0.45, 0.6, 0.75, 0.9, 0.75, 0.6, 0.4],
  },
  'dark-psy': {
    id: 'dark-psy', name: 'Dark Psy',
    bpm: 150, scale: 'phrygian', root: 43,
    bass: 'roll', density: 0.75, drive: 0.7, swing: 0.04, space: 0.25, duck: 0.55,
    acid: true,
    kickDecay: 0.16, kickFundamental: 48,
    bassCutoff: 300, bassResonance: 8,
    leadCutoff: 2000, leadDetune: 15,
    padCutoff: 800, textureLevel: 0.2,
    energyCurve: [0.5, 0.7, 0.85, 0.95, 0.85, 0.95, 0.7, 0.5],
  },
  'goa': {
    id: 'goa', name: 'Goa',
    bpm: 140, scale: 'phrygianDominant', root: 45,
    bass: 'roll', density: 0.7, drive: 0.5, swing: 0.05, space: 0.5, duck: 0.5,
    acid: true,
    kickDecay: 0.2, kickFundamental: 52,
    bassCutoff: 500, bassResonance: 10,
    leadCutoff: 4000, leadDetune: 20,
    padCutoff: 1500, textureLevel: 0.18,
    energyCurve: [0.35, 0.5, 0.7, 0.85, 0.95, 0.85, 0.7, 0.5],
  },
  'morning-psy': {
    id: 'morning-psy', name: 'Morning Psy',
    bpm: 142, scale: 'dorian', root: 50,
    bass: 'off', density: 0.65, drive: 0.35, swing: 0.06, space: 0.55, duck: 0.42,
    acid: false,
    kickDecay: 0.2, kickFundamental: 54,
    bassCutoff: 550, bassResonance: 4,
    leadCutoff: 3500, leadDetune: 12,
    padCutoff: 1800, textureLevel: 0.16,
    energyCurve: [0.4, 0.55, 0.7, 0.85, 0.95, 0.8, 0.65, 0.45],
  },
  'forest': {
    id: 'forest', name: 'Forest',
    bpm: 148, scale: 'minor', root: 44,
    bass: 'roll', density: 0.7, drive: 0.6, swing: 0.04, space: 0.3, duck: 0.5,
    acid: false,
    kickDecay: 0.18, kickFundamental: 46,
    bassCutoff: 350, bassResonance: 6,
    leadCutoff: 2200, leadDetune: 14,
    padCutoff: 1000, textureLevel: 0.22,
    energyCurve: [0.4, 0.6, 0.75, 0.9, 0.85, 0.9, 0.65, 0.45],
  },
  'hypnotic': {
    id: 'hypnotic', name: 'Hypnotic',
    bpm: 130, scale: 'dorian', root: 47,
    bass: 'off', density: 0.4, drive: 0.35, swing: 0.1, space: 0.5, duck: 0.4,
    acid: false,
    kickDecay: 0.24, kickFundamental: 48,
    bassCutoff: 380, bassResonance: 5,
    leadCutoff: 1800, leadDetune: 8,
    padCutoff: 1000, textureLevel: 0.14,
    energyCurve: [0.3, 0.4, 0.5, 0.65, 0.75, 0.7, 0.55, 0.4],
  },
  'cosmic': {
    id: 'cosmic', name: 'Cosmic',
    bpm: 136, scale: 'dorian', root: 49,
    bass: 'off', density: 0.5, drive: 0.3, swing: 0.07, space: 0.7, duck: 0.38,
    acid: false,
    kickDecay: 0.22, kickFundamental: 50,
    bassCutoff: 450, bassResonance: 4,
    leadCutoff: 3200, leadDetune: 16,
    padCutoff: 2000, textureLevel: 0.2,
    energyCurve: [0.3, 0.45, 0.6, 0.75, 0.85, 0.75, 0.6, 0.4],
  },
  'acid-psy': {
    id: 'acid-psy', name: 'Acid Psy',
    bpm: 142, scale: 'minor', root: 45,
    bass: 'acid', density: 0.7, drive: 0.65, swing: 0.05, space: 0.35, duck: 0.5,
    acid: true,
    kickDecay: 0.19, kickFundamental: 50,
    bassCutoff: 600, bassResonance: 14,
    leadCutoff: 2500, leadDetune: 18,
    padCutoff: 1200, textureLevel: 0.15,
    energyCurve: [0.45, 0.6, 0.75, 0.9, 0.95, 0.85, 0.7, 0.5],
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

// ─── Section cycle ──────────────────────────────────────────────

const SECTION_CYCLE = ['intro', 'build', 'drop', 'break', 'drop', 'climax'] as const;
type SectionType = typeof SECTION_CYCLE[number];

interface Section {
  i: number; type: SectionType; bars: number; density: number;
  seq: EvolvingSequence; rng: Rng;
  riser: boolean; impact: boolean;
}

// ─── Live Engine ────────────────────────────────────────────────

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
  // fx
  private dSend: GainNode | null = null;
  private dOut: GainNode | null = null;
  private rSend: GainNode | null = null;
  private conv: ConvolverNode | null = null;
  // buffers
  private pink: AudioBuffer | null = null;
  private sawWave: PeriodicWave | null = null;
  // scheduler
  private drv: { next: (mac: { mode: string; density: (b: number) => number }) => Section } | null = null;
  private sec: Section | null = null;
  private si = 0;
  private next = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  // analysis data for UI
  currentSection = 'idle';
  currentBar = 0;
  currentPhrase = 0;
  phrasesPlayed = 0;

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const c = this.ctx = new Ctx({ latencyHint: 'interactive' });

    // master chain: sum → duck → comp → limiter → EQ → master → destination
    this.sum = c.createGain();
    this.duck = c.createGain();
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 2.5;
    this.comp.attack.value = 0.015; this.comp.release.value = 0.2;
    this.lim = c.createDynamicsCompressor();
    this.lim.threshold.value = -1.5; this.lim.ratio.value = 20;
    this.lim.attack.value = 0.001; this.lim.release.value = 0.05;
    this.eqL = c.createBiquadFilter(); this.eqL.type = 'lowshelf';
    this.eqL.frequency.value = 100; this.eqL.gain.value = 2.5;
    this.eqH = c.createBiquadFilter(); this.eqH.type = 'highshelf';
    this.eqH.frequency.value = 9000; this.eqH.gain.value = 1.5;
    this.master = c.createGain(); this.master.gain.value = 0.85;

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
    this.dOut = c.createGain(); this.dOut.gain.value = 0.35;
    this.dSend.connect(dL); dL.connect(dF); dF.connect(dR); dR.connect(dFb); dFb.connect(dL);
    const pl = c.createStereoPanner(); pl.pan.value = -0.5;
    const pr = c.createStereoPanner(); pr.pan.value = 0.5;
    dL.connect(pl); dR.connect(pr); pl.connect(this.dOut); pr.connect(this.dOut);
    this.dOut.connect(this.sum);

    // reverb (convolver)
    this.rSend = c.createGain(); this.rSend.gain.value = 0.3;
    this.conv = c.createConvolver(); this.conv.buffer = this.makeImpulse(1.8, 3);
    this.rSend.connect(this.conv); this.conv.connect(this.sum);

    // pre-generate pink noise buffer + band-limited saw wave
    this.pink = this.makePink();
    this.sawWave = this.makeSawWave(48);
  }

  private makeSawWave(nH: number): PeriodicWave {
    const c = this.ctx!;
    const real = new Float32Array(nH + 1), imag = new Float32Array(nH + 1);
    for (let k = 1; k <= nH; k++) imag[k] = (2 / (Math.PI * k)) * ((k % 2) ? 1 : -1);
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

  // ─── Voices ───────────────────────────────────────────────────

  kick(t: number, amp = 1, pan = 0) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    const fund = this.world.kickFundamental;
    o.frequency.setValueAtTime(fund * 3, t);
    o.frequency.exponentialRampToValueAtTime(fund, t + 0.008);
    o.frequency.exponentialRampToValueAtTime(fund * 0.9, t + 0.09);
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + this.world.kickDecay);
    const p = c.createStereoPanner(); p.pan.value = pan;
    o.connect(g); g.connect(p); p.connect(this.sum!);
    o.start(t); o.stop(t + this.world.kickDecay + 0.02);
    // click transient
    const cn = c.createBufferSource(); cn.buffer = this.pink;
    const chp = c.createBiquadFilter(); chp.type = 'highpass'; chp.frequency.value = 2000;
    const cg = c.createGain();
    cg.gain.setValueAtTime(0.25 * amp, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.01);
    cn.connect(chp); chp.connect(cg); cg.connect(p);
    cn.start(t); cn.stop(t + 0.015);
    // sidechain duck
    if (this.duck) {
      const d = this.duck.gain;
      d.cancelScheduledValues(t);
      d.setValueAtTime(1 - this.world.duck, t);
      d.setTargetAtTime(1, t + 0.02, 0.09);
    }
  }

  bass(t: number, midi: number, dur: number, amp = 0.5, acid = false, pan = 0) {
    const c = this.ctx!, f = mtof(midi);
    const o = c.createOscillator();
    if (this.sawWave) o.setPeriodicWave(this.sawWave);
    o.frequency.value = f;
    const sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.value = f / 2;
    const sg = c.createGain(); sg.gain.value = 0.5;
    const fl = c.createBiquadFilter(); fl.type = 'lowpass';
    fl.Q.value = acid ? this.world.bassResonance : 3;
    fl.frequency.setValueAtTime(acid ? 2500 : this.world.bassCutoff * 2, t);
    fl.frequency.exponentialRampToValueAtTime(this.world.bassCutoff, t + Math.min(dur, 0.12));
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.42 * amp, t + 0.003);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const p = c.createStereoPanner(); p.pan.value = pan;
    o.connect(fl); fl.connect(g); sub.connect(sg); sg.connect(g);
    g.connect(p); p.connect(this.sum!);
    o.start(t); sub.start(t); o.stop(t + dur + 0.03); sub.stop(t + dur + 0.03);
  }

  lead(t: number, midi: number, dur: number, amp = 0.2, pan = 0) {
    const c = this.ctx!, f = mtof(midi);
    const fl = c.createBiquadFilter(); fl.type = 'lowpass';
    fl.frequency.setValueAtTime(this.world.leadCutoff * 2, t);
    fl.frequency.exponentialRampToValueAtTime(this.world.leadCutoff, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16 * amp / 0.2, t + 0.006);
    g.gain.linearRampToValueAtTime(0, t + dur);
    // 3 detuned oscillators panned L/C/R = true stereo
    for (let i = 0; i < 3; i++) {
      const o = c.createOscillator();
      if (this.sawWave) o.setPeriodicWave(this.sawWave);
      o.frequency.value = f;
      o.detune.value = (i - 1) * this.world.leadDetune;
      const pp = c.createStereoPanner(); pp.pan.value = (i - 1) * 0.4;
      o.connect(pp); pp.connect(fl); o.start(t); o.stop(t + dur + 0.05);
    }
    fl.connect(g); g.connect(this.sum!);
    if (this.dSend) g.connect(this.dSend);
    if (this.rSend) g.connect(this.rSend);
  }

  hat(t: number, open = false, amp = 0.12, pan = 0.3) {
    const c = this.ctx!, s = c.createBufferSource(); s.buffer = this.pink;
    const hp = c.createBiquadFilter(); hp.type = 'highpass';
    hp.frequency.value = open ? 7000 : 8500;
    const g = c.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.25 : 0.045));
    const p = c.createStereoPanner(); p.pan.value = pan;
    s.connect(hp); hp.connect(g); g.connect(p); p.connect(this.sum!);
    s.start(t); s.stop(t + 0.3);
  }

  clap(t: number, amp = 0.4) {
    const c = this.ctx!, s = c.createBufferSource(); s.buffer = this.pink;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800;
    const g = c.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    s.connect(bp); bp.connect(g); g.connect(this.sum!);
    if (this.rSend) g.connect(this.rSend);
    s.start(t); s.stop(t + 0.2);
  }

  pad(t: number, root: number, chord: number[], dur: number, amp = 0.05) {
    const c = this.ctx!;
    chord.forEach((iv) => {
      const f = mtof(root + 12 + iv);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = this.world.padCutoff;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.4);
      g.gain.linearRampToValueAtTime(0, t + dur);
      // 2 detuned oscillators panned L/R = true stereo
      for (let i = 0; i < 2; i++) {
        const o = c.createOscillator();
        if (this.sawWave) o.setPeriodicWave(this.sawWave);
        o.frequency.value = f; o.detune.value = i ? 6 : -6;
        const pp = c.createStereoPanner(); pp.pan.value = i ? 0.4 : -0.4;
        o.connect(pp); pp.connect(lp); o.start(t); o.stop(t + dur + 0.1);
      }
      lp.connect(g); g.connect(this.sum!);
      if (this.rSend) g.connect(this.rSend);
    });
  }

  riser(t: number, dur: number) {
    const c = this.ctx!, s = c.createBufferSource(); s.buffer = this.pink;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(8000, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + dur);
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
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g); g.connect(this.sum!);
    o.start(t); o.stop(t + 0.55);
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
    this.setupDriver();
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
      if (this.drv) this.setupDriver();
      if (this.dOut) this.dOut.gain.value = 0.2 + this.world.space * 0.3;
      if (this.rSend) this.rSend.gain.value = 0.2 + this.world.space * 0.3;
    }
  }

  setMacros(macros: Partial<Macros>) {
    this.macros = { ...this.macros, ...macros };
  }

  triggerAction(action: string) {
    switch (action) {
      case 'drop': this.macros.energy = 1; break;
      case 'breakdown': this.macros.energy = 0.2; this.macros.space = Math.min(1, this.macros.space + 0.3); break;
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

  private setupDriver() {
    const w = this.world;
    const root = w.root;
    const scale = w.scale;
    const baseSeed = this.seed;
    let i = 0;
    this.drv = {
      next: (mac) => {
        const idx = i++;
        const typ = mac.mode === 'drop' ? 'drop' : mac.mode === 'chill' ? 'break' : SECTION_CYCLE[idx % SECTION_CYCLE.length];
        const rng = new Rng(baseSeed * 1000 + idx);
        const bars = { intro: 8, build: 8, drop: 16, break: 8, climax: 16 }[typ] || 8;
        const den = mac.density({ intro: 0.3, build: 0.6, drop: 0.9, break: 0.25, climax: 1 }[typ] || 0.5);
        return {
          i: idx, type: typ, bars, density: den,
          seq: new EvolvingSequence(root, scale, rng),
          rng,
          riser: typ === 'drop' || typ === 'climax',
          impact: typ === 'drop' || typ === 'climax',
        };
      },
    };
  }

  private mac = {
    energy: 0.6, mode: 'auto' as string,
    density: (b: number) => {
      if (this.mac.mode === 'chill') return b * 0.3;
      return Math.max(0.15, Math.min(1, b * (0.5 + 0.7 * this.macros.energy)));
    },
  };

  private s16(): number { return 60 / this.world.bpm / 4; }

  private tick() {
    if (!this.playing || !this.ctx || !this.drv) return;
    while (this.next < this.ctx.currentTime + 0.12) {
      this.step(this.si, this.next);
      this.si++;
      this.next += this.s16();
      if (this.si >= (this.sec?.bars || 8) * 16) {
        this.sec = this.drv.next(this.mac);
        this.si = 0;
        this.currentSection = this.sec.type;
        this.currentPhrase++;
        this.phrasesPlayed++;
      }
    }
  }

  private step(s: number, t: number) {
    if (!this.sec || !this.ctx) return;
    const S = this.sec;
    const sb = s % 16;
    const bar = Math.floor(s / 16);
    const sw = this.world.swing * this.macros.groove;
    this.currentBar = bar;

    // bar start events
    if (sb === 0) {
      if (S.impact) this.impact(t);
      if (S.riser) this.riser(t, this.s16() * 16);
      this.pad(t, this.world.root - 12, [0, 3, 7], this.s16() * 64, 0.04 * (0.5 + this.macros.energy * 0.5));
    }

    // kick (4 on floor)
    if (sb % 4 === 0) this.kick(t, 0.8 + this.macros.energy * 0.2);

    // bass
    const isOff = sb % 2 === 1;
    const bt = isOff ? t + sw * this.s16() : t;
    const bassOn = this.world.bass === 'off' ? (sb % 4 === 2) : isOff;
    if (bassOn) {
      this.bass(bt, this.world.root + (bar % 3), this.s16(), 0.4 + this.macros.energy * 0.2, this.world.acid);
    }

    // hats
    if (sb % 2 === 0) this.hat(t + (sb % 4 === 2 ? sw * this.s16() : 0), false, 0.1 * (0.5 + this.macros.density * 0.5), 0.3);
    if (sb === 4) this.hat(t, true, 0.08, -0.3);
    if (sb === 8) this.clap(t, 0.3 * (0.5 + this.macros.energy * 0.5));

    // lead from evolving sequence
    if (S.density > 0.3 && sb % 4 === 0 && S.rng.chance(S.density * this.macros.psychedelia)) {
      const n = S.seq.next();
      this.lead(t, n + 12, this.s16() * 2, 0.2 * (0.5 + this.macros.energy * 0.5));
    }
  }

  getAnalyser(): AnalyserNode | null { return this.analyser; }

  getWorlds(): { id: string; name: string }[] {
    return Object.values(WORLDS).map(w => ({ id: w.id, name: w.name }));
  }
}
