/**
 * AdvancedSynthVoice — drop-in replacement for PooledSynthVoice with 4 modes:
 *   - classic   : 2 osc + filter (same as PooledSynthVoice, backwards compatible)
 *   - fm        : carrier + modulator → carrier.frequency (metallic goa/acid leads)
 *   - supersaw  : 3-7 detuned saws with stereo spread (thick pads / anthemic leads)
 *   - wavetable : 2 periodic-wave osc crossfaded by an LFO (evolving textures)
 *
 * ── P1 LAZY VOICE ALLOCATION ────────────────────────────────────────────────
 * The original implementation preallocated 7 oscillators + 7 gains + 7 panners
 * per voice = 29 nodes × 20 voices = 580 nodes — the leading cause of the
 * 1054-node freeze documented in ROAST-4.
 *
 * The fix: only the COMMON nodes are preallocated (8 nodes). Per-oscillator
 * nodes are allocated lazily in noteOn() based on the active mode, and torn
 * down by panic() / deferred-deactivation once the note's release finishes.
 *
 * Per-mode node budget (when active):
 *   - classic   : 2 osc + 2 gain                  = 4 nodes  (mono)
 *   - fm        : 2 osc + 2 gain                  = 4 nodes  (mono)
 *   - wavetable : 2 osc + 2 gain                  = 4 nodes  (mono; rack Haas widener supplies stereo)
 *   - supersaw  : N osc + N gain + N panner       = 3·N nodes (3..7 → 9..21 nodes)
 *
 * Common (always present): sum, filter, vca, modGain, lfo, lfoCutoffGain,
 * lfoGainA, lfoGainB = 8 nodes.
 *
 * With pool of 8 voices: idle = 8·8 = 64 nodes. Worst case (all 8 active
 * supersaw @ 7 osc) = 8·(8+21) = 232 nodes. Typical case (mostly idle,
 * 2-3 active classic/FM/wavetable) = ~80-100 nodes. Down from 580. The
 * deferred-deactivation timeout releases per-osc nodes shortly after each
 * note's release finishes, so voices return to 8-node idle when not playing.
 *
 * All Web Audio nodes (no ScriptProcessor). TypeScript strict.
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

/**
 * Per-mode osc-chain specification, computed in noteOn() from the preset.
 *  - classic/fm/wavetable: 2 osc + 2 gain, no per-osc panners (rack panner
 *    handles stereo placement; rack Haas widener supplies width).
 *  - supersaw: N osc + N gain + N panner for stereo spread across the field.
 */
interface OscChainSpec {
  count: number;
  usePan: boolean;
  mode: SynthMode;
}

export class AdvancedSynthVoice {
  // ── Per-osc chain (lazily allocated, torn down on panic / deactivation) ──
  private osc: OscillatorNode[] = [];
  private oscGain: GainNode[] = [];
  private pan: StereoPannerNode[] = [];
  private oscMode: SynthMode | null = null;
  private oscUsePan = false;

  // ── Common nodes (always present, allocated in constructor) ──
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
  private ctx: AudioContext;

  // ── Activation tracking (for voice stealing + deferred deactivation) ──
  // noteSerial bumps on every noteOn. The deferred-deactivation timeout
  // captures the serial at scheduling time; if the serial has bumped by
  // the time the timeout fires, a newer noteOn has retriggered the voice
  // and we must NOT tear down the per-osc nodes.
  private noteSerial = 0;
  private lastTriggerTime = 0;        // performance.now() of last noteOn
  private busy = false;               // true between noteOn and release tail end
  private deactivateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: AudioContext, voiceIdx = 0) {
    this.ctx = ctx;
    this.voiceIdx = voiceIdx;
    this.periodicWaves = getPeriodicWaves(ctx);

    // ── Common nodes (8 total — down from 29) ──
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

    // Sum → filter → VCA (output)
    this.sum.connect(this.filter);
    this.filter.connect(this.vca);

    // LFO → lfoCutoffGain → filter.frequency (always wired — silent until depth set)
    this.lfo.connect(this.lfoCutoffGain);
    this.lfoCutoffGain.connect(this.filter.frequency);

    // LFO → lfoGainA / lfoGainB (always wired; their OUTPUTS connect to
    // oscGain[i].gain only when wavetable mode is active — see ensureOscChain)
    this.lfo.connect(this.lfoGainA);
    this.lfo.connect(this.lfoGainB);

    // Start the LFO (it's silent — lfoCutoffGain/lfoGainA/lfoGainB start at 0).
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
   * Allocate (or reallocate) the per-oscillator chain to match `spec`.
   *
   * If the existing chain already matches (same mode + same usePan + at least
   * `spec.count` nodes), this is a no-op — we reuse the persistent oscillators
   * and just reset their parameters in the caller. Otherwise we tear down the
   * existing chain and build a fresh one.
   *
   * Web Audio OscillatorNodes can be start()-ed exactly once; after stop()
   * they cannot be restarted. So whenever we tear down we MUST create new
   * nodes — there's no way to "park" a stopped oscillator.
   */
  private ensureOscChain(spec: OscChainSpec): void {
    const compatible = this.oscMode === spec.mode
      && this.oscUsePan === spec.usePan
      && this.osc.length >= spec.count;

    if (compatible) {
      // Reuse — silence any extra oscillators beyond spec.count (supersaw
      // count can vary between notes; we keep the high-water mark allocated
      // to avoid churn). The caller resets oscGain[i].gain for active oscs.
      for (let i = spec.count; i < this.osc.length; i++) {
        const g = this.oscGain[i].gain;
        g.cancelScheduledValues(this.ctx.currentTime);
        g.setValueAtTime(0, this.ctx.currentTime);
      }
      return;
    }

    // Incompatible — tear down + rebuild.
    this.teardownOscChain();

    for (let i = 0; i < spec.count; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 220;
      const g = this.ctx.createGain();
      g.gain.value = 0; // silent until trigger sets the level
      osc.connect(g);

      if (spec.usePan) {
        const p = this.ctx.createStereoPanner();
        p.pan.value = 0;
        g.connect(p);
        p.connect(this.sum);
        this.pan.push(p);
      } else {
        g.connect(this.sum);
      }

      osc.start();
      this.osc.push(osc);
      this.oscGain.push(g);
    }

    this.oscMode = spec.mode;
    this.oscUsePan = spec.usePan;

    // Mode-specific persistent wiring (must be redone after teardown because
    // the destination nodes are gone and the source modGain/lfoGainA/B outputs
    // were disconnected).
    if (spec.mode === 'fm' && this.osc.length >= 2) {
      // FM modulation path: osc[1] (modulator) → modGain → osc[0].frequency (carrier)
      this.osc[1].connect(this.modGain);
      this.modGain.connect(this.osc[0].frequency);
    }
    if (spec.mode === 'wavetable' && this.oscGain.length >= 2) {
      // LFO crossfade: lfoGainA → oscGain[0].gain (+), lfoGainB → oscGain[1].gain (-)
      this.lfoGainA.connect(this.oscGain[0].gain);
      this.lfoGainB.connect(this.oscGain[1].gain);
    }
  }

  /**
   * Tear down the per-osc chain: disconnect every node, stop every oscillator,
   * and let GC reclaim them. Common nodes (sum/filter/vca/modGain/lfo/...) are
   * preserved. Safe to call when the chain is already empty (no-op).
   */
  private teardownOscChain(): void {
    // Disconnect modGain's OUTPUT (it may have been routed to osc[0].frequency).
    // Its INPUT (from osc[1]) will be cleared when we disconnect osc[1] below.
    try { this.modGain.disconnect(); } catch { /* already disconnected */ }
    // Disconnect lfoGainA/B OUTPUTS (they may have been routed to oscGain[i].gain).
    try { this.lfoGainA.disconnect(); } catch { /* already disconnected */ }
    try { this.lfoGainB.disconnect(); } catch { /* already disconnected */ }

    for (const o of this.osc) {
      try { o.stop(); } catch { /* already stopped */ }
      try { o.disconnect(); } catch { /* already disconnected */ }
    }
    for (const g of this.oscGain) {
      try { g.disconnect(); } catch { /* already disconnected */ }
    }
    for (const p of this.pan) {
      try { p.disconnect(); } catch { /* already disconnected */ }
    }
    this.osc = [];
    this.oscGain = [];
    this.pan = [];
    this.oscMode = null;
    this.oscUsePan = false;
  }

  /**
   * Trigger a note. Drop-in replacement for PooledSynthVoice.noteOn().
   * Dispatches to mode-specific trigger based on `preset.mode`.
   *
   * Per-osc nodes are allocated lazily here (and torn down after release).
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

    const mode: SynthMode = p.mode || 'classic';

    // ── Compute the osc-chain spec for this mode ──
    const spec: OscChainSpec = this.specForMode(mode, p);

    // ── Allocate / reallocate per-osc nodes ──
    this.ensureOscChain(spec);

    // Reset all osc gains and modulation depths at note start so leftover
    // values from a previous mode don't bleed into this note.
    for (let i = 0; i < this.oscGain.length; i++) {
      const g = this.oscGain[i].gain;
      g.cancelScheduledValues(when);
      g.setValueAtTime(0, when);
    }
    this.modGain.gain.cancelScheduledValues(when);
    this.modGain.gain.setValueAtTime(0, when);
    this.lfoCutoffGain.gain.setValueAtTime(0, when);
    this.lfoGainA.gain.setValueAtTime(0, when);
    this.lfoGainB.gain.setValueAtTime(0, when);

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

    // ── Schedule deferred deactivation ──
    // After the release tail finishes, if no newer noteOn has retriggered
    // this voice, tear down the per-osc chain to release the nodes back to
    // GC. This is what keeps the idle voice count at 8 nodes (vs 29).
    this.noteSerial++;
    const mySerial = this.noteSerial;
    this.lastTriggerTime = performance.now();
    this.busy = true;
    if (this.deactivateTimer !== null) {
      clearTimeout(this.deactivateTimer);
    }
    // Time from "now" until the release tail is fully silent. Add a 0.5s
    // buffer so we don't tear down during the exponential decay tail.
    const nowToNoteStart = Math.max(when - this.ctx.currentTime, 0);
    const releaseTail = atk + p.dec + dur + rel + 0.5;
    const ms = Math.max((nowToNoteStart + releaseTail) * 1000, 50);
    this.deactivateTimer = setTimeout(() => {
      this.deactivateTimer = null;
      if (this.noteSerial === mySerial) {
        this.teardownOscChain();
        this.busy = false;
      }
      // Else: a newer noteOn has retriggered the voice — leave the chain
      // alone; the newer noteOn scheduled its own deactivation timeout.
    }, ms);
  }

  /** Compute the per-mode osc-chain spec. */
  private specForMode(mode: SynthMode, p: AdvancedSynthPreset): OscChainSpec {
    switch (mode) {
      case 'supersaw': {
        const count = clamp(Math.floor(p.sawCount ?? 5), 2, MAX_OSC);
        return { count, usePan: true, mode };
      }
      case 'fm':
      case 'wavetable':
      case 'classic':
      default:
        // 2 osc + 2 gain, no per-osc panners. The rack's panner + Haas
        // widener supply stereo placement and width downstream.
        return { count: 2, usePan: false, mode };
    }
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

    // Modulator (NOT audible — only modulates carrier frequency)
    this.osc[1].type = 'sine';
    this.osc[1].frequency.setValueAtTime(f * ratio, when);
    this.osc[1].detune.setValueAtTime(0, when);
    this.oscGain[1].gain.setValueAtTime(0, when); // silent

    // FM depth envelope: 0 → peak → sustain (lower) → release
    // Peak deviation in Hz: depth * 1000 (so fmDepth=4 = ±4000 Hz peak deviation)
    const peakDepth = depth * vel * 1000;
    // Sustain depth: blends between peak (envAmt=1, full envelope effect) and
    // a steady-state value (envAmt=0, no envelope — constant modulation).
    const sustainDepth = peakDepth * (1 - envAmt) + peakDepth * p.sus * envAmt;

    const atk = Math.max(p.atk, 0.003);
    const dec = Math.max(p.dec, 0.01);
    const rel = Math.max(p.rel, 0.02);
    // The VCA release happens at `end` = when + stepDur * gate * 2 (computed
    // in noteOn). Here we schedule the modGain envelope to mirror the VCA
    // envelope — using a best-effort gateDur that's a fraction of the VCA's
    // total note length (typical psytrance notes are 0.1s - 2s).
    const gateDur = (p.gate || 0.6) * 2;
    const noteEnd = when + Math.max(gateDur * 0.15, 0.1);

    this.modGain.gain.cancelScheduledValues(when);
    this.modGain.gain.setValueAtTime(0, when);
    this.modGain.gain.linearRampToValueAtTime(peakDepth, when + atk);
    this.modGain.gain.setTargetAtTime(Math.max(sustainDepth, 0.001), when + atk, dec / 3);
    this.modGain.gain.setTargetAtTime(0.0001, noteEnd, rel / 3);
  }

  /**
   * Supersaw: N detuned sawtooth oscillators panned across the stereo field.
   * Inspired by the Roland JP-8000 — gives thick, rich, "anthemic" timbres.
   */
  private triggerSupersaw(p: AdvancedSynthPreset, when: number, f: number, vel: number): void {
    const count = clamp(Math.floor(p.sawCount ?? 5), 2, this.osc.length);
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

    for (let i = 0; i < this.osc.length; i++) {
      if (i < count) {
        this.osc[i].type = 'sawtooth';
        this.osc[i].frequency.setValueAtTime(f, when);
        this.osc[i].detune.setValueAtTime(detune * detuneMult[i], when);
        if (i < this.pan.length) {
          this.pan[i].pan.setValueAtTime(spread * panMult[i], when);
        }
        this.oscGain[i].gain.setValueAtTime(gainPerOsc, when);
      } else {
        // Silence any extra oscillators beyond count (chain may have been
        // allocated larger by a previous supersaw note with a higher count).
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
    // LFO modulation depth — bounded so gain doesn't go too negatively
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
  }

  /** Silence the voice immediately. Drop-in replacement for PooledSynthVoice.panic(). */
  panic(ctx: AudioContext): void {
    try {
      this.vca.gain.cancelScheduledValues(0);
      this.vca.gain.setValueAtTime(0, ctx.currentTime);
      this.modGain.gain.cancelScheduledValues(0);
      this.modGain.gain.setValueAtTime(0, ctx.currentTime);
    } catch { /* ignore — voice may be in any state */ }

    // Cancel any pending deferred deactivation — we're tearing down now.
    if (this.deactivateTimer !== null) {
      clearTimeout(this.deactivateTimer);
      this.deactivateTimer = null;
    }
    // Bump noteSerial so any already-fired timeout becomes a no-op.
    this.noteSerial++;
    this.busy = false;
    this.teardownOscChain();
  }

  // ── Voice-pool / voice-stealing queries ──────────────────────────────────

  /** True between noteOn and the release-tail-end deactivation. */
  isBusy(): boolean { return this.busy; }

  /** performance.now() of the last noteOn — used for oldest-first stealing. */
  lastTriggeredAt(): number { return this.lastTriggerTime; }

  /**
   * Approximate node count currently held by this voice. Used by the engine's
   * performance dashboard to report total live node pressure.
   *  - Common nodes: 8 (always present)
   *  - Per-osc nodes: osc + oscGain + (pan if usePan)
   */
  nodeCount(): number {
    const common = 8;
    const perOsc = this.osc.length + this.oscGain.length + this.pan.length;
    return common + perOsc;
  }

  /** Current osc-chain mode (null when chain is torn down / idle). */
  currentMode(): SynthMode | null { return this.oscMode; }
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
