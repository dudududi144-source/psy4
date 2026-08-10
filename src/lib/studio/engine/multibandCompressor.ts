/**
 * MultibandCompressor — 3-band master bus compressor.
 *
 * Splits the input into LOW (<200 Hz), MID (200..2000 Hz), HIGH (>2000 Hz)
 * using cascaded BiquadFilter crossovers, compresses each band separately
 * with band-appropriate ratios (low 4:1, mid 3:1, high 2:1), then sums back
 * to a mono/stereo output.
 *
 * This is the "loud, glued" commercial sound called out in ROAST-3. A
 * single-band master comp can't simultaneously tighten the sub and de-ess
 * the highs — multiband lets each region be controlled independently.
 *
 * All Web Audio nodes. TypeScript strict. NaN-guarded.
 */

const clamp = (v: number, a: number, b: number) =>
  (Number.isFinite(v) ? (v < a ? a : (v > b ? b : v)) : a);

const safeNum = (v: number, fallback: number) =>
  (typeof v === 'number' && Number.isFinite(v)) ? v : fallback;

export interface MultibandConfig {
  crossoverLow: number;     // Hz, LOW/MID split (default 200)
  crossoverHigh: number;    // Hz, MID/HIGH split (default 2000)
  // Per-band compressor settings
  lowThreshold: number;     // dB (default -18)
  lowRatio: number;         // 1..20 (default 4)
  lowAttack: number;        // s (default 0.012)
  lowRelease: number;       // s (default 0.2)
  lowKnee: number;          // dB (default 6)
  lowMakeup: number;        // linear gain (default 1.2)
  midThreshold: number;     // dB (default -20)
  midRatio: number;         // 1..20 (default 3)
  midAttack: number;        // s (default 0.008)
  midRelease: number;       // s (default 0.15)
  midKnee: number;          // dB (default 10)
  midMakeup: number;        // linear gain (default 1.1)
  highThreshold: number;    // dB (default -22)
  highRatio: number;        // 1..20 (default 2)
  highAttack: number;       // s (default 0.003)
  highRelease: number;      // s (default 0.08)
  highKnee: number;         // dB (default 12)
  highMakeup: number;       // linear gain (default 1.0)
}

export const DEFAULT_MULTIBAND_CONFIG: MultibandConfig = {
  crossoverLow: 200,
  crossoverHigh: 2000,
  lowThreshold: -18, lowRatio: 4,  lowAttack: 0.012, lowRelease: 0.2,  lowKnee: 6,  lowMakeup: 1.2,
  midThreshold: -20, midRatio: 3,  midAttack: 0.008, midRelease: 0.15, midKnee: 10, midMakeup: 1.1,
  highThreshold: -22, highRatio: 2, highAttack: 0.003, highRelease: 0.08, highKnee: 12, highMakeup: 1.0,
};

export class MultibandCompressor {
  readonly input: GainNode;
  readonly output: GainNode;

  // Crossover filters (cascaded for steeper slopes — 24 dB/oct via 2× 12 dB/oct)
  //   LOW path:  input → lowLP1 → lowLP2 → lowComp → lowMakeup ─┐
  //   MID path:  input → midHP1 → midHP2 → midLP1 → midLP2 → midComp → midMakeup ─┤
  //   HIGH path: input → highHP1 → highHP2 → highComp → highMakeup ─┴→ output
  private readonly lowLP1: BiquadFilterNode;
  private readonly lowLP2: BiquadFilterNode;
  private readonly midHP1: BiquadFilterNode;
  private readonly midHP2: BiquadFilterNode;
  private readonly midLP1: BiquadFilterNode;
  private readonly midLP2: BiquadFilterNode;
  private readonly highHP1: BiquadFilterNode;
  private readonly highHP2: BiquadFilterNode;

  readonly lowComp: DynamicsCompressorNode;
  readonly midComp: DynamicsCompressorNode;
  readonly highComp: DynamicsCompressorNode;

  private readonly lowMakeup: GainNode;
  private readonly midMakeup: GainNode;
  private readonly highMakeup: GainNode;

  private readonly ctx: AudioContext;
  private config: MultibandConfig;

  constructor(ctx: AudioContext, config?: Partial<MultibandConfig>) {
    this.ctx = ctx;
    this.config = { ...DEFAULT_MULTIBAND_CONFIG, ...config };
    const c = this.config;

    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // ── LOW band: 2× lowpass @ crossoverLow (24 dB/oct) ──
    this.lowLP1 = ctx.createBiquadFilter();
    this.lowLP2 = ctx.createBiquadFilter();
    this.lowLP1.type = 'lowpass';
    this.lowLP2.type = 'lowpass';
    this.lowLP1.frequency.value = clamp(c.crossoverLow, 50, 500);
    this.lowLP2.frequency.value = clamp(c.crossoverLow, 50, 500);
    this.lowLP1.Q.value = 0.5;
    this.lowLP2.Q.value = 0.5;

    // ── MID band: HP @ crossoverLow + LP @ crossoverHigh ──
    this.midHP1 = ctx.createBiquadFilter();
    this.midHP2 = ctx.createBiquadFilter();
    this.midHP1.type = 'highpass';
    this.midHP2.type = 'highpass';
    this.midHP1.frequency.value = clamp(c.crossoverLow, 50, 500);
    this.midHP2.frequency.value = clamp(c.crossoverLow, 50, 500);
    this.midHP1.Q.value = 0.5;
    this.midHP2.Q.value = 0.5;
    this.midLP1 = ctx.createBiquadFilter();
    this.midLP2 = ctx.createBiquadFilter();
    this.midLP1.type = 'lowpass';
    this.midLP2.type = 'lowpass';
    this.midLP1.frequency.value = clamp(c.crossoverHigh, 800, 8000);
    this.midLP2.frequency.value = clamp(c.crossoverHigh, 800, 8000);
    this.midLP1.Q.value = 0.5;
    this.midLP2.Q.value = 0.5;

    // ── HIGH band: 2× highpass @ crossoverHigh ──
    this.highHP1 = ctx.createBiquadFilter();
    this.highHP2 = ctx.createBiquadFilter();
    this.highHP1.type = 'highpass';
    this.highHP2.type = 'highpass';
    this.highHP1.frequency.value = clamp(c.crossoverHigh, 800, 8000);
    this.highHP2.frequency.value = clamp(c.crossoverHigh, 800, 8000);
    this.highHP1.Q.value = 0.5;
    this.highHP2.Q.value = 0.5;

    // ── Compressors ──
    this.lowComp = ctx.createDynamicsCompressor();
    this.lowComp.threshold.value = clamp(c.lowThreshold, -60, 0);
    this.lowComp.ratio.value = clamp(c.lowRatio, 1, 20);
    this.lowComp.attack.value = clamp(c.lowAttack, 0.0005, 0.5);
    this.lowComp.release.value = clamp(c.lowRelease, 0.01, 2);
    this.lowComp.knee.value = clamp(c.lowKnee, 0, 40);

    this.midComp = ctx.createDynamicsCompressor();
    this.midComp.threshold.value = clamp(c.midThreshold, -60, 0);
    this.midComp.ratio.value = clamp(c.midRatio, 1, 20);
    this.midComp.attack.value = clamp(c.midAttack, 0.0005, 0.5);
    this.midComp.release.value = clamp(c.midRelease, 0.01, 2);
    this.midComp.knee.value = clamp(c.midKnee, 0, 40);

    this.highComp = ctx.createDynamicsCompressor();
    this.highComp.threshold.value = clamp(c.highThreshold, -60, 0);
    this.highComp.ratio.value = clamp(c.highRatio, 1, 20);
    this.highComp.attack.value = clamp(c.highAttack, 0.0005, 0.5);
    this.highComp.release.value = clamp(c.highRelease, 0.01, 2);
    this.highComp.knee.value = clamp(c.highKnee, 0, 40);

    // ── Makeup gains ──
    this.lowMakeup = ctx.createGain();
    this.lowMakeup.gain.value = clamp(c.lowMakeup, 0, 4);
    this.midMakeup = ctx.createGain();
    this.midMakeup.gain.value = clamp(c.midMakeup, 0, 4);
    this.highMakeup = ctx.createGain();
    this.highMakeup.gain.value = clamp(c.highMakeup, 0, 4);

    // ── Wire the three paths in parallel ──
    // LOW
    this.input.connect(this.lowLP1);
    this.lowLP1.connect(this.lowLP2);
    this.lowLP2.connect(this.lowComp);
    this.lowComp.connect(this.lowMakeup);
    this.lowMakeup.connect(this.output);

    // MID
    this.input.connect(this.midHP1);
    this.midHP1.connect(this.midHP2);
    this.midHP2.connect(this.midLP1);
    this.midLP1.connect(this.midLP2);
    this.midLP2.connect(this.midComp);
    this.midComp.connect(this.midMakeup);
    this.midMakeup.connect(this.output);

    // HIGH
    this.input.connect(this.highHP1);
    this.highHP1.connect(this.highHP2);
    this.highHP2.connect(this.highComp);
    this.highComp.connect(this.highMakeup);
    this.highMakeup.connect(this.output);
  }

  /** Real-time parameter automation. */
  setParameter(name: string, value: number): void {
    if (!Number.isFinite(value)) return;
    const now = this.ctx.currentTime;
    const tc = 0.05;
    switch (name) {
      case 'crossoverLow': {
        const f = clamp(value, 50, 500);
        this.lowLP1.frequency.setTargetAtTime(f, now, tc);
        this.lowLP2.frequency.setTargetAtTime(f, now, tc);
        this.midHP1.frequency.setTargetAtTime(f, now, tc);
        this.midHP2.frequency.setTargetAtTime(f, now, tc);
        this.config.crossoverLow = f;
        break;
      }
      case 'crossoverHigh': {
        const f = clamp(value, 800, 8000);
        this.midLP1.frequency.setTargetAtTime(f, now, tc);
        this.midLP2.frequency.setTargetAtTime(f, now, tc);
        this.highHP1.frequency.setTargetAtTime(f, now, tc);
        this.highHP2.frequency.setTargetAtTime(f, now, tc);
        this.config.crossoverHigh = f;
        break;
      }
      // LOW band
      case 'lowThreshold': this.lowComp.threshold.setTargetAtTime(clamp(value, -60, 0), now, tc); break;
      case 'lowRatio':     this.lowComp.ratio.setTargetAtTime(clamp(value, 1, 20), now, tc); break;
      case 'lowAttack':    this.lowComp.attack.setTargetAtTime(clamp(value, 0.0005, 0.5), now, tc); break;
      case 'lowRelease':   this.lowComp.release.setTargetAtTime(clamp(value, 0.01, 2), now, tc); break;
      case 'lowKnee':      this.lowComp.knee.setTargetAtTime(clamp(value, 0, 40), now, tc); break;
      case 'lowMakeup':    this.lowMakeup.gain.setTargetAtTime(clamp(value, 0, 4), now, tc); break;
      // MID band
      case 'midThreshold': this.midComp.threshold.setTargetAtTime(clamp(value, -60, 0), now, tc); break;
      case 'midRatio':     this.midComp.ratio.setTargetAtTime(clamp(value, 1, 20), now, tc); break;
      case 'midAttack':    this.midComp.attack.setTargetAtTime(clamp(value, 0.0005, 0.5), now, tc); break;
      case 'midRelease':   this.midComp.release.setTargetAtTime(clamp(value, 0.01, 2), now, tc); break;
      case 'midKnee':      this.midComp.knee.setTargetAtTime(clamp(value, 0, 40), now, tc); break;
      case 'midMakeup':    this.midMakeup.gain.setTargetAtTime(clamp(value, 0, 4), now, tc); break;
      // HIGH band
      case 'highThreshold': this.highComp.threshold.setTargetAtTime(clamp(value, -60, 0), now, tc); break;
      case 'highRatio':     this.highComp.ratio.setTargetAtTime(clamp(value, 1, 20), now, tc); break;
      case 'highAttack':    this.highComp.attack.setTargetAtTime(clamp(value, 0.0005, 0.5), now, tc); break;
      case 'highRelease':   this.highComp.release.setTargetAtTime(clamp(value, 0.01, 2), now, tc); break;
      case 'highKnee':      this.highComp.knee.setTargetAtTime(clamp(value, 0, 40), now, tc); break;
      case 'highMakeup':    this.highMakeup.gain.setTargetAtTime(clamp(value, 0, 4), now, tc); break;
      default: break;
    }
  }

  getConfig(): MultibandConfig {
    return { ...this.config };
  }
}
