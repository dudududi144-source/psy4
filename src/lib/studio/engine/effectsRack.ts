/**
 * TrackEffectsRack — per-track insert chain for the PSY4 engine.
 *
 * Each of the 8 tracks (KICK, SNARE, HATS, PERC, BASS, LEAD, PAD, ARP) gets one
 * of these racks. The rack wraps Web Audio nodes into a fixed insert chain:
 *
 *     input → EQ (3-band) → [Compressor] → [Saturation] → [Haas widener]
 *          → [Panner] → output → (sends tap)
 *
 * The rack also exposes 6 send taps (reverb, delay, chorus, phaser, distortion,
 * bitcrush) taken POST-fader so muting a track via output gain also mutes its
 * sends — standard console behavior.
 *
 * ── P1 ADAPTIVE NODE BUDGET (Task P1) ────────────────────────────────────────
 * The original rack unconditionally created 25 nodes (3 EQ + 1 comp + 4 sat +
 * 8 Haas + 1 panner + 6 sends + 2 input/output) per track × 8 tracks = 200
 * nodes — a major contributor to the 1054-node freeze (ROAST-4).
 *
 * The fix introduces three opt-out flags on `TrackRackConfig`:
 *   - `skipComp` : skip the compressor entirely (1 node saved). For tracks
 *     that don't need glue (e.g., hats in some worlds).
 *   - `skipSat`  : skip the saturation stage (4 nodes saved). For tracks that
 *     are already clean and don't need warmth.
 *   - `skipHaas` : skip the ENTIRE Haas widener (8 nodes) AND the stereo
 *     panner (1 node). For mono/centered tracks (kick, bass) — they're
 *     centered in the mix and the panner is a no-op anyway. 9 nodes saved.
 *
 * Default config keeps all stages enabled (backwards compatible). The engine
 * sets skipHaas=true for tracks 0 (KICK) and 4 (BASS) — they're mono/centered.
 *
 * With the new flags applied to kick + bass:
 *   - 2 racks × 9 nodes saved = 18 nodes (was 200 → now ~182 for the rack
 *     set, plus the lazy-voice savings).
 *
 * `setParameter()` is defensive: calls targeting a skipped stage are no-ops
 * (the node doesn't exist), so existing automation code keeps working
 * without per-track conditionals at the call sites.
 *
 * All Web Audio nodes (no ScriptProcessor, no AudioWorklet). TypeScript strict.
 * Every numeric input is clamped + NaN-guarded.
 */

// ─── Config ─────────────────────────────────────────────────────────────────

export interface TrackRackConfig {
  // 3-band EQ (dB / Hz / Q)
  eqLowGain: number;     // low shelf gain, dB (-12..+12)
  eqMidFreq: number;     // mid bell frequency, Hz (200..6000)
  eqMidGain: number;     // mid bell gain, dB (-12..+12)
  eqMidQ: number;        // mid bell Q (0.3..4)
  eqHighGain: number;    // high shelf gain, dB (-12..+12)
  // Compressor
  compThreshold: number; // dB (-60..0)
  compRatio: number;     // 1..20
  compAttack: number;    // s (0.001..0.3)
  compRelease: number;   // s (0.02..1.0)
  compKnee: number;      // dB (0..40)
  // Saturation (WaveShaper)
  satDrive: number;      // 1..6 (input gain into the shaper)
  satMix: number;        // 0..1 (wet/dry)
  // Stereo
  pan: number;           // -1..1
  useHaas: boolean;      // only melodic tracks (LEAD/PAD/ARP)
  haasDelayMs: number;   // 5..25 ms (only used if useHaas)
  haasMix: number;       // 0..1 (0 = mono, 1 = full Haas width)
  // Track output (fader)
  outputGain: number;    // 0..2
  // Send levels (post-fader, 0..1)
  sendReverb: number;
  sendDelay: number;
  sendChorus: number;    // melodic only — others leave at 0
  sendPhaser: number;    // melodic only
  sendDistortion: number; // acid/lead only
  sendBitcrush: number;   // lo-fi texture, optional
  // ── P1: optional stage skips (node-budget optimizations) ──
  skipComp?: boolean;    // if true, don't create the compressor (1 node saved)
  skipSat?: boolean;     // if true, don't create the saturation stage (4 nodes saved)
  skipHaas?: boolean;    // if true, don't create the Haas widener OR the panner
                         // (9 nodes saved — for mono/centered tracks like kick/bass)
}

/** Sensible defaults; per-track factories override only what they need. */
export const DEFAULT_RACK_CONFIG: TrackRackConfig = {
  eqLowGain: 0, eqMidFreq: 1000, eqMidGain: 0, eqMidQ: 1, eqHighGain: 0,
  compThreshold: -18, compRatio: 3, compAttack: 0.005, compRelease: 0.15, compKnee: 8,
  satDrive: 1.2, satMix: 0.2,
  pan: 0, useHaas: false, haasDelayMs: 12, haasMix: 0.6,
  outputGain: 0.8,
  sendReverb: 0.1, sendDelay: 0.05,
  sendChorus: 0, sendPhaser: 0, sendDistortion: 0, sendBitcrush: 0,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const clamp = (v: number, a: number, b: number) =>
  (Number.isFinite(v) ? (v < a ? a : (v > b ? b : v)) : a);

const safeNum = (v: number | undefined, fallback: number) =>
  (typeof v === 'number' && Number.isFinite(v)) ? v : fallback;

/**
 * Build a soft-clip saturation curve. Drive > 1 pushes more energy into the
 * non-linear region. Curve is monotonically increasing and odd-symmetric so
 * there is no DC offset. Output is scaled so drive=1 leaves level roughly
 * unchanged; drive=4 gives audible warmth without harsh clipping.
 *
 * The curve is allocated via an explicit ArrayBuffer so it satisfies the
 * TS 5.7+-tightened `WaveShaperNode.curve` setter type
 * (`Float32Array<ArrayBuffer>`, not `Float32Array<ArrayBufferLike>`).
 */
function makeSatCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const ab = new ArrayBuffer(n * 4);
  const curve = new Float32Array(ab);
  const d = clamp(drive, 0.5, 8);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1; // -1..1
    // tanh soft-clip with drive, slight even harmonic via the +x*0.15 term
    // (kept asymmetric-enough to add character but not DC).
    curve[i] = Math.tanh(x * d) * 0.85 + x * 0.15 * Math.exp(-Math.abs(x) * d * 0.5);
  }
  return curve;
}

// ─── Rack ───────────────────────────────────────────────────────────────────

export class TrackEffectsRack {
  readonly input: GainNode;
  readonly output: GainNode;

  // EQ (always present — every track needs at least basic tone shaping)
  readonly eq: {
    low: BiquadFilterNode;   // low shelf (~120 Hz)
    mid: BiquadFilterNode;   // peaking (~1 kHz)
    high: BiquadFilterNode;  // high shelf (~8 kHz)
  };

  // Compressor (optional — skipped when config.skipComp is true)
  readonly comp?: DynamicsCompressorNode;

  // Saturation (optional — skipped when config.skipSat is true)
  // Parallel wet/dry structure: prevStage → satPreGain → sat (waveshaper) → satWet ─┐
  //                            prevStage → satDry ──────────────────────────────────┴→ nextStage
  readonly sat?: WaveShaperNode;
  private readonly satWet?: GainNode;
  private readonly satDry?: GainNode;
  private readonly satPreGain?: GainNode;
  // When sat is skipped, this gain node serves as the summing point that the
  // next stage reads from. (When sat is enabled, the next stage reads from
  // the sat wet/dry sum — implemented by connecting both satWet and satDry
  // to the same downstream node.)
  private readonly satSum: GainNode;

  // Haas widener + panner (optional — skipped entirely when config.skipHaas)
  //   satSum → haasSplitter ─→ haasLeftTap ────────────────→ merger.input 0  (L)
  //                        └→ haasRightTap → haasDelay ────→ merger.input 1  (R, delayed)
  //   satSum → haasSplitter ─→ haasBypass (mono)
  //   merger → haasWetMix ──┐
  //   haasBypass → haasDryMix ─┴→ haasPanInput → panner → output
  private readonly haasSplitter?: GainNode;
  private readonly haasLeftTap?: GainNode;
  private readonly haasRightTap?: GainNode;
  readonly haasDelay?: DelayNode;
  private readonly haasMerger?: ChannelMergerNode;
  private readonly haasBypass?: GainNode;
  private readonly haasWetMix?: GainNode;
  private readonly haasDryMix?: GainNode;
  private readonly haasPanInput?: GainNode;

  // Stereo panner (skipped when config.skipHaas is true — Haas and panner
  // go together; mono/centered tracks don't need either)
  readonly panner?: StereoPannerNode;

  // Send taps (post-fader): each is a GainNode connected from `output`
  readonly sendReverb: GainNode;
  readonly sendDelay: GainNode;
  readonly sendChorus: GainNode;
  readonly sendPhaser: GainNode;
  readonly sendDistortion: GainNode;
  readonly sendBitcrush: GainNode;

  private readonly ctx: AudioContext;
  private readonly config: TrackRackConfig;

  constructor(ctx: AudioContext, config: TrackRackConfig) {
    this.ctx = ctx;
    // Defensive clone + NaN-guard so a bad config never breaks the graph.
    this.config = {
      ...DEFAULT_RACK_CONFIG,
      ...config,
      // explicit guards for the values most likely to come from UI/input
      eqLowGain: safeNum(config.eqLowGain, 0),
      eqMidFreq: safeNum(config.eqMidFreq, 1000),
      eqMidGain: safeNum(config.eqMidGain, 0),
      eqMidQ: safeNum(config.eqMidQ, 1),
      eqHighGain: safeNum(config.eqHighGain, 0),
      compThreshold: safeNum(config.compThreshold, -18),
      compRatio: safeNum(config.compRatio, 3),
      compAttack: safeNum(config.compAttack, 0.005),
      compRelease: safeNum(config.compRelease, 0.15),
      compKnee: safeNum(config.compKnee, 8),
      satDrive: safeNum(config.satDrive, 1.2),
      satMix: safeNum(config.satMix, 0.2),
      pan: safeNum(config.pan, 0),
      haasDelayMs: safeNum(config.haasDelayMs, 12),
      haasMix: safeNum(config.haasMix, 0.6),
      outputGain: safeNum(config.outputGain, 0.8),
      sendReverb: safeNum(config.sendReverb, 0),
      sendDelay: safeNum(config.sendDelay, 0),
      sendChorus: safeNum(config.sendChorus, 0),
      sendPhaser: safeNum(config.sendPhaser, 0),
      sendDistortion: safeNum(config.sendDistortion, 0),
      sendBitcrush: safeNum(config.sendBitcrush, 0),
      useHaas: !!config.useHaas,
      skipComp: !!config.skipComp,
      skipSat: !!config.skipSat,
      skipHaas: !!config.skipHaas,
    };
    const c = this.config;

    // ── Input ──
    this.input = ctx.createGain();
    this.input.gain.value = 1.0;

    // ── EQ (3-band, always present) ──
    this.eq = {
      low: ctx.createBiquadFilter(),
      mid: ctx.createBiquadFilter(),
      high: ctx.createBiquadFilter(),
    };
    this.eq.low.type = 'lowshelf';
    this.eq.low.frequency.value = 120;
    this.eq.low.gain.value = clamp(c.eqLowGain, -15, 15);
    this.eq.mid.type = 'peaking';
    this.eq.mid.frequency.value = clamp(c.eqMidFreq, 100, 8000);
    this.eq.mid.Q.value = clamp(c.eqMidQ, 0.2, 6);
    this.eq.mid.gain.value = clamp(c.eqMidGain, -15, 15);
    this.eq.high.type = 'highshelf';
    this.eq.high.frequency.value = 8000;
    this.eq.high.gain.value = clamp(c.eqHighGain, -15, 15);

    // ── Compressor (optional) ──
    if (!c.skipComp) {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = clamp(c.compThreshold, -60, 0);
      comp.knee.value = clamp(c.compKnee, 0, 40);
      comp.ratio.value = clamp(c.compRatio, 1, 20);
      comp.attack.value = clamp(c.compAttack, 0.0005, 0.5);
      comp.release.value = clamp(c.compRelease, 0.01, 2.0);
      this.comp = comp;
    }

    // ── Saturation (optional, parallel wet/dry) ──
    // satSum is always present — it's the summing node that the next stage
    // (haas or output) reads from. When sat is enabled, satWet and satDry
    // both feed satSum. When sat is disabled, the previous stage feeds
    // satSum directly.
    this.satSum = ctx.createGain();
    this.satSum.gain.value = 1.0;
    if (!c.skipSat) {
      this.satPreGain = ctx.createGain();
      this.satPreGain.gain.value = clamp(c.satDrive, 0.5, 8);
      const sat = ctx.createWaveShaper();
      sat.oversample = '2x';
      sat.curve = makeSatCurve(c.satDrive);
      this.sat = sat;
      this.satWet = ctx.createGain();
      this.satWet.gain.value = clamp(c.satMix, 0, 1);
      this.satDry = ctx.createGain();
      this.satDry.gain.value = clamp(1 - c.satMix, 0, 1);
    }

    // ── Haas widener + panner (optional, all-or-nothing) ──
    if (!c.skipHaas) {
      this.haasSplitter = ctx.createGain();
      this.haasLeftTap = ctx.createGain();
      this.haasRightTap = ctx.createGain();
      if (c.useHaas) {
        this.haasDelay = ctx.createDelay(0.05);
        this.haasDelay.delayTime.value = clamp(c.haasDelayMs / 1000, 0.001, 0.05);
      }
      this.haasMerger = ctx.createChannelMerger(2);
      this.haasBypass = ctx.createGain();
      this.haasWetMix = ctx.createGain();
      this.haasDryMix = ctx.createGain();
      this.haasPanInput = ctx.createGain();

      this.panner = ctx.createStereoPanner();
      this.panner.pan.value = clamp(c.pan, -1, 1);
    }

    // ── Output (fader) ──
    this.output = ctx.createGain();
    this.output.gain.value = clamp(c.outputGain, 0, 3);

    // ── Send taps (always present — even mono tracks send to reverb/delay) ──
    this.sendReverb = ctx.createGain();
    this.sendDelay = ctx.createGain();
    this.sendChorus = ctx.createGain();
    this.sendPhaser = ctx.createGain();
    this.sendDistortion = ctx.createGain();
    this.sendBitcrush = ctx.createGain();
    this.sendReverb.gain.value = clamp(c.sendReverb, 0, 1);
    this.sendDelay.gain.value = clamp(c.sendDelay, 0, 1);
    this.sendChorus.gain.value = clamp(c.sendChorus, 0, 1);
    this.sendPhaser.gain.value = clamp(c.sendPhaser, 0, 1);
    this.sendDistortion.gain.value = clamp(c.sendDistortion, 0, 1);
    this.sendBitcrush.gain.value = clamp(c.sendBitcrush, 0, 1);

    // ── Wire the chain ──
    this._wire();
  }

  /**
   * Build the audio graph from input → output + sends. Conditionally routes
   * through comp / sat / haas / panner depending on which stages were created.
   *
   * Chain layout (where [X] = "if not skipped"):
   *   input → eq.low → eq.mid → eq.high → [comp] → [sat] → satSum
   *         → [haas splitter/merger/wet-dry → panInput] → [panner] → output
   *         → (6 sends tap from output)
   *
   * When `skipHaas` is true, satSum connects directly to output (no panner).
   */
  private _wire(): void {
    const c = this.config;

    // input → EQ low → mid → high
    this.input.connect(this.eq.low);
    this.eq.low.connect(this.eq.mid);
    this.eq.mid.connect(this.eq.high);

    // After EQ: optional comp, then optional sat (parallel wet/dry summed at satSum).
    let prev: AudioNode = this.eq.high;

    if (this.comp) {
      prev.connect(this.comp);
      prev = this.comp;
    }

    if (this.sat && this.satPreGain && this.satWet && this.satDry) {
      // Parallel wet/dry:
      //   prev → satPreGain → sat (waveshaper) → satWet → satSum
      //   prev → satDry → satSum
      prev.connect(this.satPreGain);
      this.satPreGain.connect(this.sat);
      this.sat.connect(this.satWet);
      this.satWet.connect(this.satSum);
      prev.connect(this.satDry);
      this.satDry.connect(this.satSum);
    } else {
      // Sat skipped — prev feeds satSum directly.
      prev.connect(this.satSum);
    }

    // After satSum: optional Haas widener → panner → output (or direct to output).
    if (this.haasSplitter && this.haasLeftTap && this.haasRightTap
        && this.haasMerger && this.haasBypass && this.haasWetMix
        && this.haasDryMix && this.haasPanInput) {
      // Haas widener
      //   satSum → haasSplitter ─→ haasLeftTap ────────────────→ merger.input 0  (L)
      //                        └→ haasRightTap → haasDelay ────→ merger.input 1  (R, delayed)
      //   satSum → haasSplitter ─→ haasBypass (mono)
      //   merger → haasWetMix ──┐
      //   haasBypass → haasDryMix ─┴→ haasPanInput → panner → output
      this.satSum.connect(this.haasSplitter);
      this.haasSplitter.connect(this.haasLeftTap);
      this.haasLeftTap.connect(this.haasMerger, 0, 0);
      this.haasSplitter.connect(this.haasRightTap);
      if (c.useHaas && this.haasDelay) {
        this.haasRightTap.connect(this.haasDelay);
        this.haasDelay.connect(this.haasMerger, 0, 1);
      } else {
        // No Haas delay — route right tap directly (no delay) so the merger
        // still receives both channels.
        this.haasRightTap.connect(this.haasMerger, 0, 1);
      }
      this.haasMerger.connect(this.haasWetMix);
      this.haasSplitter.connect(this.haasBypass);
      this.haasBypass.connect(this.haasDryMix);

      const wetLevel = c.useHaas ? clamp(c.haasMix, 0, 1) : 0;
      this.haasWetMix.gain.value = wetLevel;
      this.haasDryMix.gain.value = clamp(1 - wetLevel, 0, 1);

      this.haasWetMix.connect(this.haasPanInput);
      this.haasDryMix.connect(this.haasPanInput);

      // PanInput → panner → output
      if (this.panner) {
        this.haasPanInput.connect(this.panner);
        this.panner.connect(this.output);
      } else {
        // Defensive — panner should always exist when Haas exists.
        this.haasPanInput.connect(this.output);
      }
    } else {
      // Haas skipped — satSum feeds output directly (no panner).
      this.satSum.connect(this.output);
    }

    // Sends (post-fader) — tap from `output`. Connect to send buses externally.
    this.output.connect(this.sendReverb);
    this.output.connect(this.sendDelay);
    this.output.connect(this.sendChorus);
    this.output.connect(this.sendPhaser);
    this.output.connect(this.sendDistortion);
    this.output.connect(this.sendBitcrush);
  }

  // ── Real-time parameter automation ──────────────────────────────────────

  /**
   * Adjust a single named parameter in real-time. Used by the engine's
   * `setTrackEffect()` and (transitively) by the reference pursuit to nudge
   * timbre as the radio's character changes. Unknown names are a no-op.
   * Calls targeting a skipped stage (e.g., 'pan' when skipHaas=true) are
   * silent no-ops — this keeps call sites clean (no per-track conditionals).
   *
   * Time constant 0.05 s for smooth transitions (no zipper noise).
   */
  setParameter(name: string, value: number): void {
    if (!Number.isFinite(value)) return;
    const now = this.ctx.currentTime;
    const tc = 0.05;
    switch (name) {
      case 'eqLowGain':
        this.eq.low.gain.setTargetAtTime(clamp(value, -15, 15), now, tc);
        break;
      case 'eqMidFreq':
        this.eq.mid.frequency.setTargetAtTime(clamp(value, 100, 8000), now, tc);
        break;
      case 'eqMidGain':
        this.eq.mid.gain.setTargetAtTime(clamp(value, -15, 15), now, tc);
        break;
      case 'eqMidQ':
        this.eq.mid.Q.setTargetAtTime(clamp(value, 0.2, 6), now, tc);
        break;
      case 'eqHighGain':
        this.eq.high.gain.setTargetAtTime(clamp(value, -15, 15), now, tc);
        break;
      case 'compThreshold':
        if (this.comp) this.comp.threshold.setTargetAtTime(clamp(value, -60, 0), now, tc);
        break;
      case 'compRatio':
        if (this.comp) this.comp.ratio.setTargetAtTime(clamp(value, 1, 20), now, tc);
        break;
      case 'compAttack':
        if (this.comp) this.comp.attack.setTargetAtTime(clamp(value, 0.0005, 0.5), now, tc);
        break;
      case 'compRelease':
        if (this.comp) this.comp.release.setTargetAtTime(clamp(value, 0.01, 2), now, tc);
        break;
      case 'compKnee':
        if (this.comp) this.comp.knee.setTargetAtTime(clamp(value, 0, 40), now, tc);
        break;
      case 'satDrive': {
        if (!this.sat || !this.satPreGain) break;
        const d = clamp(value, 0.5, 8);
        this.satPreGain.gain.setTargetAtTime(d, now, tc);
        // Reshaping the curve live is allowed but slightly costly; only do it
        // if the drive actually changed by > 0.2 to avoid per-frame rebuilds.
        if (Math.abs(d - this.config.satDrive) > 0.2) {
          this.sat.curve = makeSatCurve(d);
          this.config.satDrive = d;
        }
        break;
      }
      case 'satMix': {
        if (!this.satWet || !this.satDry) break;
        const m = clamp(value, 0, 1);
        this.satWet.gain.setTargetAtTime(m, now, tc);
        this.satDry.gain.setTargetAtTime(1 - m, now, tc);
        this.config.satMix = m;
        break;
      }
      case 'pan':
        if (this.panner) this.panner.pan.setTargetAtTime(clamp(value, -1, 1), now, tc);
        break;
      case 'haasDelayMs':
        if (this.haasDelay) {
          this.haasDelay.delayTime.setTargetAtTime(
            clamp(value / 1000, 0.001, 0.05), now, tc
          );
        }
        break;
      case 'haasMix': {
        if (!this.haasWetMix || !this.haasDryMix) break;
        const m = clamp(value, 0, 1);
        this.haasWetMix.gain.setTargetAtTime(m, now, tc);
        this.haasDryMix.gain.setTargetAtTime(1 - m, now, tc);
        this.config.haasMix = m;
        break;
      }
      case 'outputGain':
        this.output.gain.setTargetAtTime(clamp(value, 0, 3), now, tc);
        break;
      case 'sendReverb':
        this.sendReverb.gain.setTargetAtTime(clamp(value, 0, 1), now, tc);
        break;
      case 'sendDelay':
        this.sendDelay.gain.setTargetAtTime(clamp(value, 0, 1), now, tc);
        break;
      case 'sendChorus':
        this.sendChorus.gain.setTargetAtTime(clamp(value, 0, 1), now, tc);
        break;
      case 'sendPhaser':
        this.sendPhaser.gain.setTargetAtTime(clamp(value, 0, 1), now, tc);
        break;
      case 'sendDistortion':
        this.sendDistortion.gain.setTargetAtTime(clamp(value, 0, 1), now, tc);
        break;
      case 'sendBitcrush':
        this.sendBitcrush.gain.setTargetAtTime(clamp(value, 0, 1), now, tc);
        break;
      default:
        // Unknown parameter — silently ignore (defensive).
        break;
    }
  }

  /** Snapshot the live config (for debugging / UI display). */
  getConfig(): TrackRackConfig {
    return { ...this.config };
  }

  /**
   * Connect a send tap to an external send-bus input node.
   * Used by the engine to wire racks → global chorus/phaser/distortion/bitcrush
   * (and reverb/delay) buses.
   */
  connectSend(sendName: 'reverb' | 'delay' | 'chorus' | 'phaser' | 'distortion' | 'bitcrush',
              busInput: AudioNode): void {
    switch (sendName) {
      case 'reverb':     this.sendReverb.connect(busInput);     break;
      case 'delay':      this.sendDelay.connect(busInput);      break;
      case 'chorus':     this.sendChorus.connect(busInput);     break;
      case 'phaser':     this.sendPhaser.connect(busInput);     break;
      case 'distortion': this.sendDistortion.connect(busInput); break;
      case 'bitcrush':   this.sendBitcrush.connect(busInput);   break;
    }
  }

  /** Quick mute — sets output gain to 0 with a short ramp. */
  mute(): void {
    this.output.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
  }

  /**
   * P1: report how many Web Audio nodes this rack is currently holding.
   * Used by the engine's performance dashboard to track total node pressure.
   */
  nodeCount(): number {
    let n = 0;
    // Always present: input + 3 EQ + satSum + output + 6 sends = 12
    n += 12;
    if (this.comp) n += 1;
    if (this.sat && this.satPreGain && this.satWet && this.satDry) n += 4;
    if (this.haasSplitter && this.haasLeftTap && this.haasRightTap
        && this.haasMerger && this.haasBypass && this.haasWetMix
        && this.haasDryMix && this.haasPanInput) {
      n += 8; // splitter + leftTap + rightTap + merger + bypass + wetMix + dryMix + panInput
      if (this.haasDelay) n += 1;
    }
    if (this.panner) n += 1;
    return n;
  }
}
