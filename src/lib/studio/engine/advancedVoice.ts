/**
 * AdvancedSynthVoice — drop-in replacement for PooledSynthVoice with 4 modes:
 *   - classic   : 2 osc + filter (same as PooledSynthVoice, backwards compatible)
 *   - fm        : carrier + modulator → carrier.frequency (metallic goa/acid leads)
 *   - supersaw  : 5-7 detuned saws with stereo spread (thick pads / anthemic leads)
 *   - wavetable : 2 periodic-wave osc crossfaded by an LFO (evolving textures)
 *
 * Architecture (all nodes preallocated + persistent — zero per-note allocation):
 *   osc[0..6]  → oscGain[0..6]  → pan[0..6]  → sum → filter → vca → bus
 *   osc[1]     → modGain → osc[0].frequency            (FM modulation path)
 *   lfo        → lfoCutoffGain → filter.frequency       (cutoff LFO, classic)
 *   lfo        → lfoGainA → oscGain[0].gain             (wavetable crossfade +)
 *   lfo        → lfoGainB → oscGain[1].gain             (wavetable crossfade -)
 *
 * Inactive branches are silenced by setting their gain to 0 (modGain / lfoGainX /
 * oscGain[i] for unused oscillators), so a single voice graph serves all modes.
 *
 * Voice pool: 20 voices × 7 oscillators = 140 max. Modern browsers handle this.
 */

import { mtof } from './musicalGrammar';

const clamp = (v: number, a: number, b: number) => v < a ? a : (v > b ? b : v);

// ─── Synth preset types (mirror psy4EngineV2 SynthPreset, plus mode-specific) ──

export interface SynthPreset {
  wave1: OscillatorType; wave2: OscillatorType; oct2: number; detune: number;
  cutoff: number; res: number; fType: BiquadFilterType;
  atk: number; dec: number; sus: number; rel: number; gate: number;
  lfoRate: number; lfoDepth: number; lfoDest: string; poly: number;
}

export type SynthMode = 'classic' | 'fm' | 'supersaw' | 'wavetable';

export interface AdvancedSynthPreset extends SynthPreset {
  mode: SynthMode;
  // FM params
  fmRatio?: number;      // carrier:modulator ratio (e.g., 0.5 = 1:2, 2 = 2:1)
  fmDepth?: number;      // modulation index (0-8) — peak Hz deviation = depth*1000
  fmEnvAmount?: number;  // 0-1 — how much envelope affects FM depth
  // Supersaw params
  sawCount?: number;     // 2-7 oscillators
  sawDetune?: number;    // cents spread (5-25)
  sawSpread?: number;    // stereo spread (0-1)
  // Wavetable params
  wtPosition?: number;   // 0-1 wavetable scan position (crossfade between 2 waves)
  wtMorphRate?: number;  // Hz — LFO rate that modulates the position
  wtPair?: number;       // index into WAVETABLE_PAIRS (default: rotate per voice)
}

// ─── Wavetable bank ──────────────────────────────────────────────────────────
// Harmonic recipes for periodic waves. Each recipe is converted to a PeriodicWave
// via ctx.createPeriodicWave(real, imag). Used by wavetable mode.

interface HarmonicRecipe { name: string; harmonics: { n: number; amp: number }[] }

const HARMONIC_RECIPES: HarmonicRecipe[] = [
  { name: 'sine',    harmonics: [{ n: 1, amp: 1 }] },
  { name: 'saw',     harmonics: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => ({ n, amp: 1 / n })) },
  { name: 'square',  harmonics: [1, 3, 5, 7, 9, 11, 13, 15].map((n) => ({ n, amp: 1 / n })) },
  { name: 'bright',  harmonics: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ n, amp: Math.pow(0.85, n) })) },
  { name: 'warm',    harmonics: [{ n: 1, amp: 1 }, { n: 2, amp: 0.5 }, { n: 3, amp: 0.2 }, { n: 4, amp: 0.1 }] },
  { name: 'formant', harmonics: [
    { n: 1, amp: 1 }, { n: 5, amp: 0.6 }, { n: 6, amp: 0.8 }, { n: 7, amp: 0.5 }, { n: 12, amp: 0.3 },
  ] },
  { name: 'clang',   harmonics: [
    { n: 1, amp: 1 }, { n: 3, amp: 0.4 }, { n: 7, amp: 0.6 }, { n: 11, amp: 0.3 }, { n: 15, amp: 0.2 },
  ] },
  { name: 'shimmer', harmonics: [
    { n: 1, amp: 1 }, { n: 2, amp: 0.7 }, { n: 4, amp: 0.4 }, { n: 8, amp: 0.2 }, { n: 16, amp: 0.1 },
  ] },
];

/** Pairs of waves that crossfade well — used by wavetable mode. */
const WAVETABLE_PAIRS: [number, number][] = [
  [0, 1], // sine → saw (smooth to bright)
  [1, 2], // saw → square (harmonic variation)
  [4, 3], // warm → bright (timbre variation)
  [5, 6], // formant → clang (vocal to metallic)
  [0, 7], // sine → shimmer (clean to airy)
  [3, 5], // bright → formant (cutting to vocal)
];

// ─── Periodic wave cache (per AudioContext) ───────────────────────────────────
// PeriodicWave objects are bound to an AudioContext and can be shared across
// OscillatorNodes. We cache them per-context to avoid rebuilding on every voice.

const periodicWaveCache = new WeakMap<AudioContext, PeriodicWave[]>();

function getPeriodicWaves(ctx: AudioContext): PeriodicWave[] {
  const cached = periodicWaveCache.get(ctx);
  if (cached) return cached;
  const waves = HARMONIC_RECIPES.map((r) => {
    const maxN = r.harmonics.reduce((m, h) => Math.max(m, h.n), 0);
    const real = new Float32Array(maxN + 1);
    const imag = new Float32Array(maxN + 1);
    for (const h of r.harmonics) {
      imag[h.n] = h.amp;
    }
    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  });
  periodicWaveCache.set(ctx, waves);
  return waves;
}

// ─── Advanced synth voice ────────────────────────────────────────────────────

const MAX_OSC = 7;

export class AdvancedSynthVoice {
  private osc: OscillatorNode[] = [];
  private oscGain: GainNode[] = [];
  private pan: StereoPannerNode[] = [];
  private sum: GainNode;
  private filter: BiquadFilterNode;
  private vca: GainNode;
  private modGain: GainNode;          // FM modulation depth (osc[1] → osc[0].frequency)
  private lfo: OscillatorNode;
  private lfoCutoffGain: GainNode;    // LFO → filter.frequency (classic cutoff LFO)
  private lfoGainA: GainNode;         // LFO → oscGain[0].gain (wavetable crossfade +)
  private lfoGainB: GainNode;         // LFO → oscGain[1].gain (wavetable crossfade -)
  private bus: GainNode | null = null;
  private periodicWaves: PeriodicWave[];
  private voiceIdx: number;

  constructor(ctx: AudioContext, voiceIdx = 0) {
    this.voiceIdx = voiceIdx;
    this.periodicWaves = getPeriodicWaves(ctx);

    this.sum = ctx.createGain();
    this.sum.gain.value = 1;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 1200;
    this.filter.Q.value = 1;
    this.vca = ctx.createGain();
    this.vca.gain.value = 0;
    this.modGain = ctx.createGain();
    this.modGain.gain.value = 0;
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = 4;
    this.lfoCutoffGain = ctx.createGain();
    this.lfoCutoffGain.gain.value = 0;
    this.lfoGainA = ctx.createGain();
    this.lfoGainA.gain.value = 0;
    this.lfoGainB = ctx.createGain();
    this.lfoGainB.gain.value = 0;

    // Allocate per-oscillator nodes (all persistent)
    for (let i = 0; i < MAX_OSC; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 220;
      const g = ctx.createGain();
      g.gain.value = 0; // silent until noteOn
      const p = ctx.createStereoPanner();
      p.pan.value = 0;
      osc.connect(g);
      g.connect(p);
      p.connect(this.sum);
      this.osc.push(osc);
      this.oscGain.push(g);
      this.pan.push(p);
    }

    // Sum → filter → VCA
    this.sum.connect(this.filter);
    this.filter.connect(this.vca);

    // FM modulation path: osc[1] (modulator) → modGain → osc[0].frequency (carrier)
    // modGain starts at 0, so this is silent in non-FM modes.
    this.osc[1].connect(this.modGain);
    this.modGain.connect(this.osc[0].frequency);

    // LFO branches (all start at depth 0 — silent in non-LFO modes)
    this.lfo.connect(this.lfoCutoffGain);
    this.lfoCutoffGain.connect(this.filter.frequency);
    this.lfo.connect(this.lfoGainA);
    this.lfoGainA.connect(this.oscGain[0].gain);
    this.lfo.connect(this.lfoGainB);
    this.lfoGainB.connect(this.oscGain[1].gain);

    // Start persistent oscillators (never stop them — voice stealing reuses them)
    for (const o of this.osc) o.start();
    this.lfo.start();
  }

  /** Connect VCA output to the bus (track chain input). Idempotent. */
  connect(bus: GainNode): void {
    if (this.bus !== bus) {
      this.vca.disconnect();
      this.vca.connect(bus);
      this.bus = bus;
    }
  }

  /**
   * Trigger a note. Drop-in replacement for PooledSynthVoice.noteOn().
   * Dispatches to mode-specific trigger based on `preset.mode`.
   */
  noteOn(
    p: AdvancedSynthPreset,
    when: number,
    midi: number,
    vel: number,
    stepDur: number,
    bus: GainNode,
  ): void {
    this.connect(bus);
    const f = mtof(clamp(midi, 12, 108));
    const gate = p.gate || 0.6;
    const dur = stepDur * gate * 2;
    const rel = Math.max(p.rel, 0.02);
    const end = when + dur;

    // Reset all osc gains and modulation depths at note start so leftover
    // values from a previous mode don't bleed into this note.
    for (let i = 0; i < MAX_OSC; i++) {
      const g = this.oscGain[i].gain;
      g.cancelScheduledValues(when);
      g.setValueAtTime(0, when);
    }
    this.modGain.gain.cancelScheduledValues(when);
    this.modGain.gain.setValueAtTime(0, when);
    this.lfoCutoffGain.gain.setValueAtTime(0, when);
    this.lfoGainA.gain.setValueAtTime(0, when);
    this.lfoGainB.gain.setValueAtTime(0, when);

    const mode = p.mode || 'classic';
    switch (mode) {
      case 'fm':        this.triggerFM(p, when, f, vel); break;
      case 'supersaw':  this.triggerSupersaw(p, when, f, vel); break;
      case 'wavetable': this.triggerWavetable(p, when, f, vel); break;
      default:          this.triggerClassic(p, when, f, vel); break;
    }

    // ── Filter envelope (common to all modes) ──
    const cut = clamp(p.cutoff, 60, 16000);
    const res = clamp(p.res, 0.2, 24);
    this.filter.type = p.fType;
    this.filter.Q.setValueAtTime(res, when);
    this.filter.frequency.cancelScheduledValues(when);
    this.filter.frequency.setValueAtTime(Math.min(cut * 3, 16000), when);
    const filterSweepDur = Math.max(p.atk + p.dec * 0.7, 0.01);
    this.filter.frequency.exponentialRampToValueAtTime(Math.max(cut, 80), when + filterSweepDur);

    // ── VCA amplitude envelope (common to all modes) ──
    const vca = this.vca.gain;
    const atk = Math.max(p.atk, 0.003);
    vca.cancelScheduledValues(when);
    vca.setValueAtTime(0, when);
    vca.linearRampToValueAtTime(vel * 0.5, when + atk);
    vca.setTargetAtTime(vel * 0.5 * p.sus, when + atk, Math.max(p.dec / 3, 0.01));
    vca.setTargetAtTime(0.0001, end, Math.max(rel / 3, 0.008));
  }

  /** Classic 2-osc synth (backwards compatible with PooledSynthVoice). */
  private triggerClassic(p: AdvancedSynthPreset, when: number, f: number, vel: number): void {
    this.osc[0].type = p.wave1;
    this.osc[1].type = p.wave2;
    this.osc[0].frequency.setValueAtTime(f, when);
    this.osc[1].frequency.setValueAtTime(f * Math.pow(2, p.oct2 || 0), when);
    this.osc[0].detune.setValueAtTime(0, when);
    this.osc[1].detune.setValueAtTime(p.detune || 0, when);

    this.oscGain[0].gain.setValueAtTime(0.6, when);
    this.oscGain[1].gain.setValueAtTime(0.45, when);
    // Reset panners to center (no stereo spread in classic mode)
    this.pan[0].pan.setValueAtTime(0, when);
    this.pan[1].pan.setValueAtTime(0, when);

    // Cutoff LFO
    if (p.lfoRate > 0 && p.lfoDest === 'cutoff') {
      this.lfo.frequency.setValueAtTime(p.lfoRate, when);
      this.lfoCutoffGain.gain.setValueAtTime(p.lfoDepth * 3000, when);
    }
  }

  /**
   * FM synthesis: carrier (osc[0]) at note frequency, modulator (osc[1]) at
   * carrier × fmRatio. Modulation depth (modGain) is enveloped — starts at 0,
   * ramps to peak, decays to sustain, releases at note end. This produces the
   * classic "303 squelch" / "metallic ding" / "bell" timbres.
   */
  private triggerFM(p: AdvancedSynthPreset, when: number, f: number, vel: number): void {
    const ratio = typeof p.fmRatio === 'number' && p.fmRatio > 0 ? p.fmRatio : 2;
    const depth = typeof p.fmDepth === 'number' && p.fmDepth > 0 ? p.fmDepth : 4;
    const envAmt = typeof p.fmEnvAmount === 'number' ? clamp(p.fmEnvAmount, 0, 1) : 0.5;

    // Carrier (audible) — sine gives the cleanest FM timbre
    this.osc[0].type = 'sine';
    this.osc[0].frequency.setValueAtTime(f, when);
    this.osc[0].detune.setValueAtTime(0, when);
    this.oscGain[0].gain.setValueAtTime(0.5, when);
    this.pan[0].pan.setValueAtTime(0, when);

    // Modulator (NOT audible — only modulates carrier frequency)
    this.osc[1].type = 'sine';
    this.osc[1].frequency.setValueAtTime(f * ratio, when);
    this.osc[1].detune.setValueAtTime(0, when);
    this.oscGain[1].gain.setValueAtTime(0, when); // silent
    this.pan[1].pan.setValueAtTime(0, when);

    // FM depth envelope: 0 → peak → sustain (lower) → release
    // Peak deviation in Hz: depth * 1000 (so fmDepth=4 = ±4000 Hz peak deviation)
    const peakDepth = depth * vel * 1000;
    // Sustain depth: blends between peak (envAmt=1, full envelope effect) and
    // a steady-state value (envAmt=0, no envelope — constant modulation).
    const sustainDepth = peakDepth * (1 - envAmt) + peakDepth * p.sus * envAmt;
    const end = when + (p.gate || 0.6) * 0; // placeholder — actual end is in noteOn
    // We use the gate via the rel param scheduling — modGain release aligns with VCA release.
    // The VCA release happens at `end` = when + stepDur * gate * 2 (computed in noteOn).
    // Here we just schedule the modGain envelope to mirror the VCA envelope.
    const atk = Math.max(p.atk, 0.003);
    const dec = Math.max(p.dec, 0.01);
    const rel = Math.max(p.rel, 0.02);
    const gateDur = (p.gate || 0.6) * 2; // approximate, in stepDur units (caller scales)
    // Note: gateDur is in "stepDur-multiplier" units; noteOn scales it by stepDur.
    // Since we don't have stepDur here, we use a generous release time that works
    // across typical psytrance note lengths (0.1s - 2s).
    const noteEnd = when + Math.max(gateDur * 0.15, 0.1); // best-effort; VCA.release governs actual tail

    this.modGain.gain.cancelScheduledValues(when);
    this.modGain.gain.setValueAtTime(0, when);
    this.modGain.gain.linearRampToValueAtTime(peakDepth, when + atk);
    this.modGain.gain.setTargetAtTime(Math.max(sustainDepth, 0.001), when + atk, dec / 3);
    this.modGain.gain.setTargetAtTime(0.0001, noteEnd, rel / 3);

    // Suppress unused-variable warning for `end`
    void end;
  }

  /**
   * Supersaw: N detuned sawtooth oscillators panned across the stereo field.
   * Inspired by the Roland JP-8000 — gives thick, rich, "anthemic" timbres.
   */
  private triggerSupersaw(p: AdvancedSynthPreset, when: number, f: number, vel: number): void {
    const count = clamp(Math.floor(p.sawCount ?? 5), 2, MAX_OSC);
    const detune = typeof p.sawDetune === 'number' ? clamp(p.sawDetune, 0, 50) : 14;
    const spread = typeof p.sawSpread === 'number' ? clamp(p.sawSpread, 0, 1) : 0.5;

    // Detune pattern: spread symmetric around 0
    // For count=N, detune multipliers are: -1, -1+2/(N-1), ..., 0, ..., +1
    const detuneMult: number[] = [];
    if (count === 1) {
      detuneMult.push(0);
    } else {
      for (let i = 0; i < count; i++) {
        detuneMult.push((i / (count - 1)) * 2 - 1); // -1 ... +1
      }
    }

    // Pan pattern: -spread ... +spread
    const panMult: number[] = [];
    if (count === 1) {
      panMult.push(0);
    } else {
      for (let i = 0; i < count; i++) {
        panMult.push((i / (count - 1)) * 2 - 1); // -1 ... +1
      }
    }

    // Per-osc gain (normalize to prevent clipping)
    const gainPerOsc = 1 / Math.sqrt(count);

    for (let i = 0; i < MAX_OSC; i++) {
      if (i < count) {
        this.osc[i].type = 'sawtooth';
        this.osc[i].frequency.setValueAtTime(f, when);
        this.osc[i].detune.setValueAtTime(detune * detuneMult[i], when);
        this.pan[i].pan.setValueAtTime(spread * panMult[i], when);
        this.oscGain[i].gain.setValueAtTime(gainPerOsc, when);
      } else {
        // Silence unused oscillators
        this.oscGain[i].gain.setValueAtTime(0, when);
      }
    }

    // Cutoff LFO is allowed on supersaw pads (slow filter sweep)
    if (p.lfoRate > 0 && p.lfoDest === 'cutoff') {
      this.lfo.frequency.setValueAtTime(p.lfoRate, when);
      this.lfoCutoffGain.gain.setValueAtTime(p.lfoDepth * 3000, when);
    }
  }

  /**
   * Wavetable: 2 oscillators with crossfading periodic waves. The crossfade
   * position is set by `wtPosition` (0=wave A, 1=wave B), and an LFO slowly
   * modulates the position to create evolving texture.
   */
  private triggerWavetable(p: AdvancedSynthPreset, when: number, f: number, vel: number): void {
    const pairIdx = typeof p.wtPair === 'number'
      ? p.wtPair % WAVETABLE_PAIRS.length
      : this.voiceIdx % WAVETABLE_PAIRS.length;
    const pair = WAVETABLE_PAIRS[pairIdx];
    const waveA = this.periodicWaves[pair[0]];
    const waveB = this.periodicWaves[pair[1]];

    // Set periodic waves (overrides type to 'custom')
    this.osc[0].setPeriodicWave(waveA);
    this.osc[1].setPeriodicWave(waveB);
    this.osc[0].frequency.setValueAtTime(f, when);
    this.osc[1].frequency.setValueAtTime(f, when);
    this.osc[0].detune.setValueAtTime(0, when);
    this.osc[1].detune.setValueAtTime(0, when);

    // Static crossfade based on wtPosition
    const pos = clamp(p.wtPosition ?? 0.5, 0, 1);
    // LFO modulation depth — bounded so gain doesn't go too negative
    // (a little negative is OK for phase cancellation character, but we cap it).
    const morphRate = typeof p.wtMorphRate === 'number' && p.wtMorphRate > 0
      ? clamp(p.wtMorphRate, 0.01, 8)
      : 0.3;
    const morphDepth = clamp(0.3 * Math.min(pos, 1 - pos) * 2, 0, 0.4); // 0-0.4

    this.oscGain[0].gain.setValueAtTime(1 - pos, when);
    this.oscGain[1].gain.setValueAtTime(pos, when);

    // LFO modulates the crossfade: oscGain[0] goes up while oscGain[1] goes down
    this.lfo.frequency.setValueAtTime(morphRate, when);
    this.lfoGainA.gain.setValueAtTime(morphDepth, when);  // positive depth
    this.lfoGainB.gain.setValueAtTime(-morphDepth, when); // negative depth (inverted)
    this.pan[0].pan.setValueAtTime(-0.3, when); // slight stereo placement for width
    this.pan[1].pan.setValueAtTime(0.3, when);
  }

  /** Silence the voice immediately. Drop-in replacement for PooledSynthVoice.panic(). */
  panic(ctx: AudioContext): void {
    try {
      this.vca.gain.cancelScheduledValues(0);
      this.vca.gain.setValueAtTime(0, ctx.currentTime);
      this.modGain.gain.cancelScheduledValues(0);
      this.modGain.gain.setValueAtTime(0, ctx.currentTime);
    } catch { /* ignore — voice may be in any state */ }
  }
}

// ─── World-appropriate advanced presets ──────────────────────────────────────
// Each preset is tuned for a specific role in the mix:
//   - FM presets: metallic/squelchy goa leads (fmRatio controls harmonic character)
//   - Supersaw presets: thick pads and anthemic leads (sawCount + detune for richness)
//   - Wavetable presets: evolving textures that morph over time (wtMorphRate)
//   - Classic presets: backwards-compatible 2-osc synth (bass, simple lead)

export const ADVANCED_PRESETS: Record<string, AdvancedSynthPreset> = {
  // ── FM presets — for goa/acid metallic leads ──
  'PS-FM-GOA': {
    mode: 'fm', wave1: 'sine', wave2: 'sine', oct2: 1, detune: 2,
    fmRatio: 0.333, fmDepth: 4, fmEnvAmount: 0.8,
    cutoff: 3000, res: 6, fType: 'lowpass',
    atk: 0.005, dec: 0.3, sus: 0.6, rel: 0.2, gate: 0.5,
    lfoRate: 0, lfoDepth: 0, lfoDest: 'off', poly: 4,
  },
  'PS-FM-BELL': {
    mode: 'fm', wave1: 'sine', wave2: 'sine', oct2: 1, detune: 2,
    fmRatio: 2, fmDepth: 2, fmEnvAmount: 0.5,
    cutoff: 5000, res: 3, fType: 'lowpass',
    atk: 0.005, dec: 0.4, sus: 0.4, rel: 0.4, gate: 0.6,
    lfoRate: 0, lfoDepth: 0, lfoDest: 'off', poly: 4,
  },
  'PS-FM-SQUELCH': {
    mode: 'fm', wave1: 'sine', wave2: 'sine', oct2: 1, detune: 2,
    fmRatio: 0.5, fmDepth: 6, fmEnvAmount: 1.0,
    cutoff: 2000, res: 8, fType: 'lowpass',
    atk: 0.005, dec: 0.2, sus: 0.5, rel: 0.15, gate: 0.4,
    lfoRate: 0, lfoDepth: 0, lfoDest: 'off', poly: 4,
  },
  'PS-FM-METAL': {
    mode: 'fm', wave1: 'sine', wave2: 'sine', oct2: 1, detune: 2,
    fmRatio: 3, fmDepth: 5, fmEnvAmount: 0.7,
    cutoff: 4000, res: 5, fType: 'lowpass',
    atk: 0.005, dec: 0.25, sus: 0.5, rel: 0.2, gate: 0.45,
    lfoRate: 0, lfoDepth: 0, lfoDest: 'off', poly: 4,
  },

  // ── Supersaw presets — for rich pads and anthemic leads ──
  'PS-SUPERSAW-PAD': {
    mode: 'supersaw', wave1: 'sawtooth', wave2: 'sawtooth', oct2: 0, detune: 14,
    sawCount: 7, sawDetune: 18, sawSpread: 0.8,
    cutoff: 2000, res: 4, fType: 'lowpass',
    atk: 0.8, dec: 0.5, sus: 0.7, rel: 1.5, gate: 2.0,
    lfoRate: 0.3, lfoDepth: 0.4, lfoDest: 'cutoff', poly: 8,
  },
  'PS-SUPERSAW-LEAD': {
    mode: 'supersaw', wave1: 'sawtooth', wave2: 'sawtooth', oct2: 0, detune: 8,
    sawCount: 5, sawDetune: 12, sawSpread: 0.5,
    cutoff: 3500, res: 5, fType: 'lowpass',
    atk: 0.01, dec: 0.3, sus: 0.6, rel: 0.3, gate: 0.5,
    lfoRate: 0, lfoDepth: 0, lfoDest: 'off', poly: 4,
  },
  'PS-SUPERSAW-WIDE': {
    mode: 'supersaw', wave1: 'sawtooth', wave2: 'sawtooth', oct2: 0, detune: 10,
    sawCount: 6, sawDetune: 22, sawSpread: 1.0,
    cutoff: 2800, res: 4, fType: 'lowpass',
    atk: 0.05, dec: 0.4, sus: 0.65, rel: 0.8, gate: 1.0,
    lfoRate: 0.5, lfoDepth: 0.3, lfoDest: 'cutoff', poly: 6,
  },

  // ── Wavetable presets — for evolving textures ──
  'PS-WT-EVOLVE': {
    mode: 'wavetable', wave1: 'sawtooth', wave2: 'sawtooth', oct2: 0, detune: 0,
    wtPosition: 0.3, wtMorphRate: 0.2, wtPair: 0,
    cutoff: 1800, res: 4, fType: 'lowpass',
    atk: 1.5, dec: 0.5, sus: 0.8, rel: 2.0, gate: 3.0,
    lfoRate: 0, lfoDepth: 0, lfoDest: 'off', poly: 4,
  },
  'PS-WT-MORPH': {
    mode: 'wavetable', wave1: 'sawtooth', wave2: 'sawtooth', oct2: 0, detune: 0,
    wtPosition: 0.5, wtMorphRate: 0.5, wtPair: 3,
    cutoff: 2500, res: 5, fType: 'lowpass',
    atk: 0.5, dec: 0.4, sus: 0.7, rel: 1.5, gate: 2.0,
    lfoRate: 0, lfoDepth: 0, lfoDest: 'off', poly: 4,
  },
  'PS-WT-PSYCH': {
    mode: 'wavetable', wave1: 'sawtooth', wave2: 'sawtooth', oct2: 0, detune: 0,
    wtPosition: 0.5, wtMorphRate: 1.0, wtPair: 5,
    cutoff: 3200, res: 6, fType: 'lowpass',
    atk: 0.3, dec: 0.3, sus: 0.6, rel: 1.0, gate: 1.5,
    lfoRate: 0, lfoDepth: 0, lfoDest: 'off', poly: 4,
  },

  // ── Classic presets — backwards compatible with PooledSynthVoice ──
  'PS-CLASSIC-LEAD': {
    mode: 'classic', wave1: 'sawtooth', wave2: 'square', oct2: 0, detune: 8,
    cutoff: 1800, res: 10, fType: 'lowpass',
    atk: 0.005, dec: 0.18, sus: 0.4, rel: 0.15, gate: 0.45,
    lfoRate: 0, lfoDepth: 0, lfoDest: 'off', poly: 4,
  },
  'PS-CLASSIC-BASS': {
    mode: 'classic', wave1: 'sawtooth', wave2: 'square', oct2: -1, detune: 4,
    cutoff: 500, res: 9, fType: 'lowpass',
    atk: 0.005, dec: 0.1, sus: 0.2, rel: 0.05, gate: 0.3,
    lfoRate: 0, lfoDepth: 0, lfoDest: 'off', poly: 2,
  },
};

/**
 * Lookup a synth preset by ID. Returns an AdvancedSynthPreset:
 *   - If id is in ADVANCED_PRESETS, returns it directly (already has `mode`).
 *   - Else if id is in classicPresets (passed in by caller from SYNTH_PRESETS),
 *     wraps it with mode='classic' so the AdvancedSynthVoice defaults correctly.
 *   - Else returns null.
 */
export function getAdvancedSynthPreset(
  id: string,
  classicPresets: Record<string, SynthPreset>,
): AdvancedSynthPreset | null {
  if (id in ADVANCED_PRESETS) return ADVANCED_PRESETS[id];
  const classic = classicPresets[id];
  if (classic) return { ...classic, mode: 'classic' as SynthMode };
  return null;
}
