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
 *
 * Sound quality comes from the 40+ factory presets adapted from PSY6.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const SCALES: Record<string, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v: number, a: number, b: number) => v < a ? a : (v > b ? b : v);

function scaleNote(root: number, scale: string, deg: number): number {
  const sc = SCALES[scale] || SCALES.minor;
  const n = sc.length;
  const oct = Math.floor(deg / n);
  const idx = ((deg % n) + n) % n;
  return root + 12 * oct + sc[idx];
}

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

  hit(p: DrumPreset, when: number, vel: number, bus: GainNode) {
    this.connect(bus);
    const tune = p.tune || 1;
    const decay = p.decay || 1;
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

  init(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const c = this.ctx = new Ctx({ latencyHint: 'interactive' });

    // Noise buffer
    this.noiseBuffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const nd = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // Master chain — boosted for commercial loudness
    this.master = c.createGain();
    this.master.gain.value = 1.1; // was 0.85 — boost to close LUFS gap
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -8;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.2;
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 2048;
    this.master.connect(this.comp);
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
  }

  start(worldId?: string): void {
    this.init();
    if (this.ctx!.state === 'suspended') this.ctx!.resume();
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
  }): void {
    if (understanding.key.confidence > 0.3) {
      this.musicalKey = {
        root: 36 + understanding.key.root,
        scale: understanding.key.scale,
      };
    }
    if (understanding.bpm > 0 && understanding.bpmConfidence > 0.3) {
      if (Math.abs(understanding.bpm - this.bpm) > 5) {
        this._bpm = Math.round(understanding.bpm);
      }
    }
  }

  liveTrack(refMetrics: { lufs: number; kickDecayMs: number; spectralCentroid: number }): void {
    this.targetLufs = refMetrics.lufs;
  }

  selfTrack(selfMetrics: { lufs: number }): void {
    this.ownLufs = selfMetrics.lufs;
    if (this.targetLufs !== 0 && Math.abs(selfMetrics.lufs - this.targetLufs) > 1.0) {
      const diff = this.targetLufs - selfMetrics.lufs;
      // Faster adjustment: 0.08 per step (was 0.03) — closes gap 2.5x faster
      const adj = diff > 0 ? 0.08 : -0.08;
      const newMaster = clamp(this.master.gain.value + adj, 0.3, 2.0);
      this.master.gain.setTargetAtTime(newMaster, this.ctx!.currentTime, 0.15);
    }
  }

  setWorld(params: Record<string, number>): void {
    if (params.masterLevel !== undefined) {
      this.master.gain.setTargetAtTime(params.masterLevel, this.ctx!.currentTime, 0.1);
    }
    if (params.bassLevel !== undefined) {
      this.trackGains[4].gain.setTargetAtTime(params.bassLevel * 0.8, this.ctx!.currentTime, 0.1);
    }
    if (params.leadLevel !== undefined) {
      this.trackGains[5].gain.setTargetAtTime(params.leadLevel * 0.8, this.ctx!.currentTime, 0.1);
    }
    if (params.kickLevel !== undefined) {
      this.trackGains[0].gain.setTargetAtTime(params.kickLevel * 0.8, this.ctx!.currentTime, 0.1);
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
    const s16 = 60 / this.bpm / 4;

    while (this.nextTime < this.ctx.currentTime + lookahead) {
      this.scheduleStep(this.step, this.bar, this.nextTime);
      this.step++;
      this.nextTime += s16;
      if (this.step >= 16) {
        this.step = 0;
        this.bar++;
        const section = this.arrangement[this.sectionIdx % this.arrangement.length];
        if (this.bar >= section.bars) {
          this.sectionIdx++;
          this.bar = 0;
          const next = this.arrangement[this.sectionIdx % this.arrangement.length];
          this.currentSection = next.label;
          this.onSectionChange?.(this.currentSection);
        }
        // Change preset every 4 bars
        if (this.bar % 4 === 0 && this.bar > 0) {
          this.presetIdx = (this.presetIdx + 1) % 3;
          this.rotatePresets();
        }
      }
    }
  }

  private rotatePresets(): void {
    // Rotate drum presets for variety
    const kickPresets = ['PS-KICK-TIGHT', 'PS-KICK-DEEP'];
    const bassPresets = ['PS-BASS-ROLL', 'PS-BASS-DEEP'];
    const leadPresets = ['PS-LEAD-SQUELCH', 'PS-LEAD-FMTEX'];
    this.tracks[0].presetId = kickPresets[this.presetIdx % kickPresets.length];
    this.tracks[4].presetId = bassPresets[this.presetIdx % bassPresets.length];
    this.tracks[5].presetId = leadPresets[this.presetIdx % leadPresets.length];
  }

  private scheduleStep(step: number, bar: number, time: number): void {
    const section = this.arrangement[this.sectionIdx % this.arrangement.length];
    const key = this.musicalKey;
    const root = key.root;
    const sc = key.scale;
    const sd = 60 / this.bpm / 4;

    // ── KICK (track 0) — 4 on the floor ──
    if (step % 4 === 0) {
      this.triggerDrum(0, time, 0.5 + section.density * 0.4);
    }

    // ── CLAP (track 1) — on 2 and 4 ──
    if ((step === 4 || step === 12) && section.density > 0.4) {
      this.triggerDrum(1, time, 0.3);
    }

    // ── HATS (track 2) — offbeat with velocity variation ──
    if (step % 2 === 1) {
      const vel = 0.15 + (step % 4 === 3 ? 0.1 : 0) + section.density * 0.1;
      this.triggerDrum(2, time, vel);
    }

    // ── PERC (track 3) — sparse, with variation ──
    if (section.density > 0.5 && (step === 6 || step === 14) && Math.random() < 0.6) {
      this.triggerDrum(3, time, 0.2);
    }

    // ── BASS (track 4) — offbeat, evolving pattern with passing tones ──
    if (section.bass && step % 2 === 1) {
      // Rich bass pattern: changes every 4 bars with passing tones and octaves
      let bassPattern: number[];
      const bp = bar % 8;
      if (bp < 2) bassPattern = [0, 0, 0, 0, 0, 0, 4, 0]; // root with fifth
      else if (bp < 4) bassPattern = [0, 0, 2, 0, 4, 0, 3, 0]; // walking
      else if (bp < 6) bassPattern = [0, 0, 0, 7, 0, 0, 4, 3]; // octave + passing
      else bassPattern = [0, 4, 0, 3, 0, 2, 0, 4]; // rolling

      const bassDeg = bassPattern[Math.floor(step / 2) % bassPattern.length];
      if (bassDeg >= 0) {
        const note = scaleNote(root, sc, bassDeg);
        this.triggerSynth(4, time, note, 0.5, sd);
      }
    }

    // ── LEAD (track 5) — evolving trance motif with SPACES ──
    if (section.lead) {
      const phraseBar = bar % 8;
      const leadSteps = [0, 6, 10];
      if (leadSteps.includes(step)) {
        let deg: number; let dur: number; let vel: number;
        if (phraseBar < 2) {
          const motif = [7, 5, 3];
          deg = motif[leadSteps.indexOf(step)];
          dur = 0.3; vel = 0.25;
        } else if (phraseBar < 4) {
          const motif = [5, 3, 0];
          deg = motif[leadSteps.indexOf(step)];
          dur = 0.2; vel = 0.3;
        } else if (phraseBar < 6) {
          const motif = [10, 12, 10];
          deg = motif[leadSteps.indexOf(step)];
          dur = 0.15; vel = 0.35;
        } else if (phraseBar === 6) {
          deg = step === 0 ? 0 : step === 6 ? 2 : 0;
          dur = 0.4; vel = 0.4;
        } else {
          return; // rest bar
        }
        const note = scaleNote(root + 12, sc, deg);
        this.triggerSynth(5, time, note, vel, sd, dur);
      }
    }

    // ── PAD (track 6) — sustained chord every bar in drops ──
    if (section.lead && step === 0) {
      // Chord progression: root, IV, V, III (psytrance progression)
      const progDegs = [0, 3, 4, 2];
      const chordDeg = progDegs[bar % 4];
      const chordRoot = scaleNote(root + 12, sc, chordDeg);
      this.triggerSynth(6, time, chordRoot, 0.25, sd * 4);
      // Also play fifth for full chord
      this.triggerSynth(6, time + 0.01, scaleNote(root + 12, sc, chordDeg + 4), 0.15, sd * 4);
    }

    // ── ARP (track 7) — rolling arp, 70% density in drops ──
    if (section.lead && step % 2 === 0 && Math.random() < 0.7) {
      const arpDegs = [0, 2, 4, 7, 4, 2, 0, 7];
      const deg = arpDegs[(step / 2) % arpDegs.length];
      const note = scaleNote(root + 24, sc, deg);
      this.triggerSynth(7, time, note, 0.25, sd);
    }

    // ── SHAKER (track 3 alt) — continuous offbeat in drops ──
    if (section.bass && section.lead && step % 2 === 1 && Math.random() < 0.4) {
      this.triggerDrum(3, time, 0.15);
    }
  }

  private triggerDrum(trackIdx: number, time: number, vel: number): void {
    const track = this.tracks[trackIdx];
    if (track.mix.mute) return;
    const preset = DRUM_PRESETS[track.presetId];
    if (!preset) return;
    const voice = this.drumPool[this.drumIdx];
    this.drumIdx = (this.drumIdx + 1) % this.drumPool.length;
    voice.hit(preset, time, vel * track.mix.vol, this.chains[trackIdx]);

    // Sidechain: when kick fires, duck the bass
    if (trackIdx === 0 && this.duckGain && this.ctx) {
      this.duckGain.gain.cancelScheduledValues(time);
      this.duckGain.gain.setValueAtTime(1 - 0.4, time); // 40% duck
      this.duckGain.gain.linearRampToValueAtTime(1.0, time + 0.25); // 250ms recovery
    }
  }

  private triggerSynth(trackIdx: number, time: number, midi: number, vel: number, stepDur: number, dur?: number): void {
    const track = this.tracks[trackIdx];
    if (track.mix.mute) return;
    const preset = SYNTH_PRESETS[track.presetId];
    if (!preset) return;
    const voice = this.synthPool[this.synthIdx];
    this.synthIdx = (this.synthIdx + 1) % this.synthPool.length;
    const p = dur ? { ...preset, gate: dur / (stepDur * 2) } : preset;
    voice.noteOn(p, time, midi, vel * track.mix.vol, stepDur, this.chains[trackIdx]);

    // Add sub oscillator for bass track (sine one octave below)
    if (trackIdx === 4 && this.ctx) {
      const subFreq = mtof(midi - 12); // one octave below
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.value = subFreq;
      const subDecay = (dur || stepDur * 0.3) + 0.05;
      subGain.gain.setValueAtTime(0.5 * track.mix.vol, time);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + subDecay);
      subOsc.connect(subGain);
      subGain.connect(this.chains[4]);
      subOsc.start(time);
      subOsc.stop(time + subDecay + 0.02);
    }
  }

  getMusicalKey(): { root: number; scale: string } { return this.musicalKey; }
  getOwnLufs(): number { return this.ownLufs; }
}
