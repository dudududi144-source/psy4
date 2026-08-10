/**
 * SendEffects — global send-bus effects for the PSY4 engine.
 *
 * The existing `dsp/effects.ts` module has Chorus / Phaser / Distortion /
 * Bitcrush classes, but they're sample-by-sample processors (not AudioNodes)
 * designed for offline rendering. They cannot be wired into a live Web Audio
 * graph.
 *
 * This module builds the SAME algorithm families using native Web Audio nodes
 * so they can run in real time as SEND effects:
 *
 *   - ChorusSend       → modulated short delays, stereo spread, LFO pitch wobble
 *   - PhaserSend       → allpass cascade (BiquadFilter 'allpass') + LFO sweep
 *   - DistortionSend   → WaveShaper with hard-clip curve + tone LP
 *   - BitcrushSend     → WaveShaper stair-step curve + sample-hold feel
 *
 * Each effect exposes `input` (mono — sums many rack sends) and `output`
 * (stereo — connects to a return gain that feeds the master sum).
 *
 * All Web Audio nodes. TypeScript strict. NaN-guarded.
 */

const clamp = (v: number, a: number, b: number) =>
  (Number.isFinite(v) ? (v < a ? a : (v > b ? b : v)) : a);

const safeNum = (v: number | undefined, fallback: number) =>
  (typeof v === 'number' && Number.isFinite(v)) ? v : fallback;

// ─── Chorus ──────────────────────────────────────────────────────────────────

/**
 * Chorus — two parallel modulated delay lines (5–15 ms) with phase-offset
 * LFOs, hard-panned L/R for width. Adds movement and stereo spread to
 * melodic tracks (lead / pad / arp).
 */
export class ChorusSend {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly lfo: OscillatorNode;
  readonly lfo2: OscillatorNode;
  private readonly lfoGain: GainNode;
  private readonly lfoGain2: GainNode;
  private readonly delayL: DelayNode;
  private readonly delayR: DelayNode;
  private readonly panL: StereoPannerNode;
  private readonly panR: StereoPannerNode;
  private readonly dryGain: GainNode;
  private readonly wetGain: GainNode;

  constructor(ctx: AudioContext, opts?: {
    rate?: number;       // Hz, 0.1..2 (default 0.5)
    depth?: number;      // seconds, 0.001..0.01 (default 0.004)
    baseDelay?: number;  // seconds, 0.005..0.02 (default 0.012)
    wet?: number;        // 0..1 (default 0.6)
    dry?: number;        // 0..1 (default 0.7)
  }) {
    const rate = clamp(safeNum(opts?.rate, 0.5), 0.05, 4);
    const depth = clamp(safeNum(opts?.depth, 0.004), 0.0005, 0.015);
    const baseDelay = clamp(safeNum(opts?.baseDelay, 0.012), 0.003, 0.03);
    const wet = clamp(safeNum(opts?.wet, 0.6), 0, 1);
    const dry = clamp(safeNum(opts?.dry, 0.7), 0, 1);

    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // LFO (sine) — base rate, depth in seconds applied to delayTime.
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = rate;
    this.lfo2 = ctx.createOscillator();
    this.lfo2.type = 'sine';
    this.lfo2.frequency.value = rate * 1.05; // slight detune for stereo motion
    // Phase offset: start lfo2 at 90° by detuning initial phase — Web Audio
    // doesn't expose phase directly, so we approximate by giving the second
    // delay a slightly different base delay.
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = depth;
    this.lfoGain2 = ctx.createGain();
    this.lfoGain2.gain.value = depth;
    this.lfo.connect(this.lfoGain);
    this.lfo2.connect(this.lfoGain2);

    // Two delay lines (L + R), each modulated by its own LFO.
    this.delayL = ctx.createDelay(0.05);
    this.delayR = ctx.createDelay(0.05);
    this.delayL.delayTime.value = baseDelay;
    this.delayR.delayTime.value = baseDelay * 1.15;
    // Modulate delayTime around the base.
    this.lfoGain.connect(this.delayL.delayTime);
    this.lfoGain2.connect(this.delayR.delayTime);

    // Hard-pan L and R for max width.
    this.panL = ctx.createStereoPanner();
    this.panL.pan.value = -0.7;
    this.panR = ctx.createStereoPanner();
    this.panR.pan.value = 0.7;

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = dry;
    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = wet;

    // Wiring
    //   input → dryGain ─────────────────────────────────┐
    //   input → delayL → panL ─→ wetGain ─────────────────┴→ output
    //        └→ delayR → panR ──────────────────────────────┘
    this.input.connect(this.dryGain);
    this.input.connect(this.delayL);
    this.input.connect(this.delayR);
    this.delayL.connect(this.panL);
    this.delayR.connect(this.panR);
    this.panL.connect(this.wetGain);
    this.panR.connect(this.wetGain);
    this.dryGain.connect(this.output);
    this.wetGain.connect(this.output);

    // Start LFOs.
    this.lfo.start();
    this.lfo2.start();
  }

  /** Real-time parameter automation. */
  setParameter(name: string, value: number): void {
    if (!Number.isFinite(value)) return;
    const now = this.lfo.context.currentTime;
    switch (name) {
      case 'rate':
        this.lfo.frequency.setTargetAtTime(clamp(value, 0.05, 4), now, 0.05);
        this.lfo2.frequency.setTargetAtTime(clamp(value, 0.05, 4) * 1.05, now, 0.05);
        break;
      case 'depth':
        this.lfoGain.gain.setTargetAtTime(clamp(value, 0, 0.015), now, 0.05);
        this.lfoGain2.gain.setTargetAtTime(clamp(value, 0, 0.015), now, 0.05);
        break;
      case 'wet':
        this.wetGain.gain.setTargetAtTime(clamp(value, 0, 1), now, 0.05);
        break;
      case 'dry':
        this.dryGain.gain.setTargetAtTime(clamp(value, 0, 1), now, 0.05);
        break;
    }
  }

  /** Stop internal oscillator (call before discarding the effect). */
  dispose(): void {
    try { this.lfo.stop(); } catch {}
    try { this.lfo2.stop(); } catch {}
  }
}

// ─── Phaser ──────────────────────────────────────────────────────────────────

/**
 * Phaser — 6-stage allpass cascade modulated by an LFO, with feedback.
 * Adds the classic psychedelic sweep to lead / arp.
 */
export class PhaserSend {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly lfo: OscillatorNode;
  private readonly lfoGain: GainNode;
  private readonly lfoOffset: ConstantSourceNode;
  private readonly allpass: BiquadFilterNode[] = [];
  private readonly feedback: GainNode;
  private readonly dryGain: GainNode;
  private readonly wetGain: GainNode;

  constructor(ctx: AudioContext, opts?: {
    rate?: number;       // Hz, 0.05..4 (default 0.3)
    depth?: number;      // 0..1 (default 0.6) — LFO depth in octaves
    baseFreq?: number;   // Hz, 200..3000 (default 800)
    feedback?: number;   // 0..0.95 (default 0.4)
    stages?: number;     // 2..8 (default 6)
    wet?: number;        // 0..1 (default 0.55)
    dry?: number;        // 0..1 (default 0.6)
  }) {
    const rate = clamp(safeNum(opts?.rate, 0.3), 0.02, 8);
    const depth = clamp(safeNum(opts?.depth, 0.6), 0, 1);
    const baseFreq = clamp(safeNum(opts?.baseFreq, 800), 100, 5000);
    const fb = clamp(safeNum(opts?.feedback, 0.4), 0, 0.95);
    const stages = Math.round(clamp(safeNum(opts?.stages, 6), 2, 8));
    const wet = clamp(safeNum(opts?.wet, 0.55), 0, 1);
    const dry = clamp(safeNum(opts?.dry, 0.6), 0, 1);

    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // LFO 0..1 (sine), then scaled/offset to control allpass frequency.
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = rate;
    this.lfoGain = ctx.createGain();
    // Map depth (0..1) to a frequency multiplier swing in Hz around baseFreq.
    // The allpass's frequency AudioParam accepts Hz directly.
    this.lfoGain.gain.value = baseFreq * depth * 1.5;
    this.lfoOffset = ctx.createConstantSource();
    this.lfoOffset.offset.value = baseFreq;
    this.lfo.connect(this.lfoGain);

    // Allpass cascade — each stage modulated by the same LFO bus.
    for (let i = 0; i < stages; i++) {
      const ap = ctx.createBiquadFilter();
      ap.type = 'allpass';
      ap.frequency.value = baseFreq;
      ap.Q.value = 0.7;
      this.lfoGain.connect(ap.frequency);
      this.lfoOffset.connect(ap.frequency);
      this.allpass.push(ap);
    }
    // Chain them: input → ap[0] → ap[1] → ... → ap[n-1] → wetGain
    this.input.connect(this.allpass[0]);
    for (let i = 0; i < this.allpass.length - 1; i++) {
      this.allpass[i].connect(this.allpass[i + 1]);
    }
    const last = this.allpass[this.allpass.length - 1];

    // Feedback: last → feedback → input (creates resonant sweep)
    this.feedback = ctx.createGain();
    this.feedback.gain.value = fb;
    last.connect(this.feedback);
    this.feedback.connect(this.input);

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = dry;
    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = wet;

    // Mix
    this.input.connect(this.dryGain);
    last.connect(this.wetGain);
    this.dryGain.connect(this.output);
    this.wetGain.connect(this.output);

    // Start oscillators.
    this.lfo.start();
    this.lfoOffset.start();
  }

  setParameter(name: string, value: number): void {
    if (!Number.isFinite(value)) return;
    const now = this.lfo.context.currentTime;
    switch (name) {
      case 'rate':
        this.lfo.frequency.setTargetAtTime(clamp(value, 0.02, 8), now, 0.05);
        break;
      case 'depth': {
        const baseFreq = this.lfoOffset.offset.value;
        this.lfoGain.gain.setTargetAtTime(baseFreq * clamp(value, 0, 1) * 1.5, now, 0.05);
        break;
      }
      case 'baseFreq':
        this.lfoOffset.offset.setTargetAtTime(clamp(value, 100, 5000), now, 0.05);
        break;
      case 'feedback':
        this.feedback.gain.setTargetAtTime(clamp(value, 0, 0.95), now, 0.05);
        break;
      case 'wet':
        this.wetGain.gain.setTargetAtTime(clamp(value, 0, 1), now, 0.05);
        break;
      case 'dry':
        this.dryGain.gain.setTargetAtTime(clamp(value, 0, 1), now, 0.05);
        break;
    }
  }

  dispose(): void {
    try { this.lfo.stop(); } catch {}
    try { this.lfoOffset.stop(); } catch {}
  }
}

// ─── Distortion ──────────────────────────────────────────────────────────────

/**
 * Hard-clip distortion send. WaveShaper with a harder curve than the
 * per-track saturation, plus a tone lowpass so the result isn't harsh.
 */
export class DistortionSend {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly preGain: GainNode;
  readonly shaper: WaveShaperNode;
  private readonly tone: BiquadFilterNode;
  private readonly dryGain: GainNode;
  private readonly wetGain: GainNode;

  constructor(ctx: AudioContext, opts?: {
    drive?: number;       // 1..12 (default 4)
    tone?: number;        // Hz, 800..12000 (default 4000)
    wet?: number;         // 0..1 (default 0.5)
    dry?: number;         // 0..1 (default 0.5)
  }) {
    const drive = clamp(safeNum(opts?.drive, 4), 0.5, 16);
    const tone = clamp(safeNum(opts?.tone, 4000), 500, 16000);
    const wet = clamp(safeNum(opts?.wet, 0.5), 0, 1);
    const dry = clamp(safeNum(opts?.dry, 0.5), 0, 1);

    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.preGain = ctx.createGain();
    this.preGain.gain.value = drive;
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '4x';
    this.shaper.curve = makeHardClipCurve(drive);
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = tone;
    this.tone.Q.value = 0.5;

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = dry;
    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = wet;

    // Wiring
    //   input → preGain → shaper → tone → wetGain ─┐
    //   input → dryGain ─────────────────────────────┴→ output
    this.input.connect(this.preGain);
    this.preGain.connect(this.shaper);
    this.shaper.connect(this.tone);
    this.tone.connect(this.wetGain);
    this.input.connect(this.dryGain);
    this.wetGain.connect(this.output);
    this.dryGain.connect(this.output);
  }

  setParameter(name: string, value: number): void {
    if (!Number.isFinite(value)) return;
    const now = this.shaper.context.currentTime;
    switch (name) {
      case 'drive': {
        const d = clamp(value, 0.5, 16);
        this.preGain.gain.setTargetAtTime(d, now, 0.05);
        if (Math.abs(d - this.preGain.gain.value) > 0.5) {
          this.shaper.curve = makeHardClipCurve(d);
        }
        break;
      }
      case 'tone':
        this.tone.frequency.setTargetAtTime(clamp(value, 500, 16000), now, 0.05);
        break;
      case 'wet':
        this.wetGain.gain.setTargetAtTime(clamp(value, 0, 1), now, 0.05);
        break;
      case 'dry':
        this.dryGain.gain.setTargetAtTime(clamp(value, 0, 1), now, 0.05);
        break;
    }
  }

  dispose(): void { /* no oscillators to stop */ }
}

/**
 * Hard-clip waveshaper curve. Stronger than the per-track saturation: drive=4
 * gives audible grit without going fully square. Uses asymmetric shaping to
 * add even harmonics for "analog" warmth.
 *
 * Curve is allocated via an explicit ArrayBuffer to satisfy the
 * TS 5.7+-tightened `WaveShaperNode.curve` setter type.
 */
function makeHardClipCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const ab = new ArrayBuffer(n * 4);
  const curve = new Float32Array(ab);
  const d = clamp(drive, 0.5, 16);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    // Asymmetric soft+hard clip:
    //   positive side: tanh (warm)
    //   negative side: harder clip (cubic) — adds even harmonics
    const pos = x >= 0;
    const shaped = pos
      ? Math.tanh(x * d)
      : Math.tanh(x * d * 1.2) * 0.9;
    curve[i] = shaped;
  }
  return curve;
}

// ─── Bitcrush ────────────────────────────────────────────────────────────────

/**
 * Bitcrusher send. Web Audio doesn't have a true sample-rate-reduction node
 * without an AudioWorklet, so we approximate the lo-fi texture with:
 *   1. A stair-step WaveShaper curve (bit-depth reduction).
 *   2. A subtle sample-and-hold via a short delay whose delayTime is modulated
 *      by a slow square-wave LFO — this produces the "stair-stepped time"
 *      quality characteristic of low sample rates.
 *
 * This is NOT a mathematically exact bitcrusher, but it gives the lo-fi,
 * "destroyed" texture needed for dark-psy / acid textures without requiring
 * a custom AudioWorklet.
 */
export class BitcrushSend {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly preGain: GainNode;
  readonly shaper: WaveShaperNode;
  private readonly holdDelay: DelayNode;
  private readonly holdLfo: OscillatorNode;
  private readonly holdLfoGain: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly dryGain: GainNode;
  private readonly wetGain: GainNode;

  constructor(ctx: AudioContext, opts?: {
    bits?: number;       // 3..12 (default 6)
    holdMs?: number;     // 1..20 (default 4) — sample-and-hold step
    tone?: number;       // Hz, 500..8000 (default 2500)
    wet?: number;        // 0..1 (default 0.5)
    dry?: number;        // 0..1 (default 0.6)
  }) {
    const bits = Math.round(clamp(safeNum(opts?.bits, 6), 2, 12));
    const holdMs = clamp(safeNum(opts?.holdMs, 4), 0.5, 25);
    const tone = clamp(safeNum(opts?.tone, 2500), 300, 12000);
    const wet = clamp(safeNum(opts?.wet, 0.5), 0, 1);
    const dry = clamp(safeNum(opts?.dry, 0.6), 0, 1);

    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.preGain = ctx.createGain();
    this.preGain.gain.value = 1.0;
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = 'none'; // no oversample — keep the staircase crisp
    this.shaper.curve = makeBitcrushCurve(bits);

    // Sample-and-hold: a short delay modulated by a slow square-wave LFO.
    // The LFO modulates delayTime between ~0 and holdMs, holding each sample
    // for that duration. This is a rough approximation of sample-rate reduction.
    this.holdDelay = ctx.createDelay(0.025);
    this.holdDelay.delayTime.value = holdMs / 1000;
    this.holdLfo = ctx.createOscillator();
    this.holdLfo.type = 'square';
    this.holdLfo.frequency.value = 1000 / (holdMs * 2); // ~500 Hz at holdMs=1
    this.holdLfoGain = ctx.createGain();
    this.holdLfoGain.gain.value = holdMs / 2000; // half the peak-to-peak swing
    this.holdLfo.connect(this.holdLfoGain);
    this.holdLfoGain.connect(this.holdDelay.delayTime);

    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = tone;
    this.tone.Q.value = 0.4;

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = dry;
    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = wet;

    // Wiring
    //   input → preGain → shaper → holdDelay → tone → wetGain ─┐
    //   input → dryGain ─────────────────────────────────────────┴→ output
    this.input.connect(this.preGain);
    this.preGain.connect(this.shaper);
    this.shaper.connect(this.holdDelay);
    this.holdDelay.connect(this.tone);
    this.tone.connect(this.wetGain);
    this.input.connect(this.dryGain);
    this.wetGain.connect(this.output);
    this.dryGain.connect(this.output);

    this.holdLfo.start();
  }

  setParameter(name: string, value: number): void {
    if (!Number.isFinite(value)) return;
    const now = this.holdLfo.context.currentTime;
    switch (name) {
      case 'bits': {
        const b = Math.round(clamp(value, 2, 12));
        this.shaper.curve = makeBitcrushCurve(b);
        break;
      }
      case 'holdMs': {
        const h = clamp(value, 0.5, 25);
        this.holdDelay.delayTime.setTargetAtTime(h / 1000, now, 0.05);
        this.holdLfoGain.gain.setTargetAtTime(h / 2000, now, 0.05);
        break;
      }
      case 'tone':
        this.tone.frequency.setTargetAtTime(clamp(value, 300, 12000), now, 0.05);
        break;
      case 'wet':
        this.wetGain.gain.setTargetAtTime(clamp(value, 0, 1), now, 0.05);
        break;
      case 'dry':
        this.dryGain.gain.setTargetAtTime(clamp(value, 0, 1), now, 0.05);
        break;
    }
  }

  dispose(): void {
    try { this.holdLfo.stop(); } catch {}
  }
}

/**
 * Build a stair-step quantization curve for bit-depth reduction.
 * N bits → 2^N levels. The curve maps input [-1, 1] to one of N levels.
 *
 * Curve is allocated via an explicit ArrayBuffer to satisfy the
 * TS 5.7+-tightened `WaveShaperNode.curve` setter type.
 */
function makeBitcrushCurve(bits: number): Float32Array<ArrayBuffer> {
  const n = 4096;
  const ab = new ArrayBuffer(n * 4);
  const curve = new Float32Array(ab);
  const levels = Math.pow(2, Math.max(2, Math.min(16, bits)));
  const step = 2 / levels;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    // Quantize: floor((x + 1) / step) * step - 1
    const q = Math.floor((x + 1) / step) * step - 1;
    curve[i] = q;
  }
  return curve;
}
