/**
 * Ableton Live 12 Suite twin — "Live-V".
 * DAW / software layer: master clock, sequencer, arranger, recorder, master bus.
 * REAL IMPLEMENTATION (the actual orchestration + arrangement + master chain).
 *
 * This device IS the brain: it owns the Transport, schedules all MIDI to all
 * devices, drives the arrangement sections, records the master output, and
 * applies the final mastering chain.
 */

import { Transport } from '../clock';
import { Limiter } from '../dsp/effects';
import { OnePole, DCBlocker } from '../dsp/filter';
import { Rng } from '../rng';

export type SectionType = 'intro' | 'build' | 'breakdown' | 'drop' | 'outro' | 'loop';

export interface ArrangementSection {
  type: SectionType;
  bars: number;
  /** Density multiplier 0..1 for this section. */
  density: number;
  /** Active devices in this section. */
  activeDevices: string[];
  /** Tempo (BPM) — usually constant but can drift. */
  bpm: number;
}

export interface MasterChainParams {
  compThreshold: number; // 0..1
  compRatio: number;
  limiterCeiling: number;
  eqLow: number;  // dB
  eqHigh: number; // dB
}

export const MASTER_DEFAULTS: MasterChainParams = {
  compThreshold: 0.6,
  compRatio: 3,
  limiterCeiling: 0.95,
  eqLow: 1,
  eqHigh: 1.5,
};

/** Simple master bus compressor (feed-forward). */
class MasterComp {
  private sr: number;
  threshold: number; ratio: number;
  private env = 0; private attack = 0.005; private release = 0.1;
  constructor(sr: number) { this.sr = sr; this.threshold = 0.6; this.ratio = 3; }
  process(input: number): number {
    const peak = Math.abs(input);
    let gain = 1;
    if (peak > this.threshold) {
      const over = peak - this.threshold;
      gain = 1 - (over * (1 - 1 / this.ratio)) / Math.max(peak, 0.0001);
    }
    // envelope
    const target = gain;
    const rate = target < this.env ? 1 / (this.attack * this.sr) : 1 / (this.release * this.sr);
    this.env += (target - this.env) * Math.min(1, rate);
    return input * this.env;
  }
  reset() { this.env = 0; }
}

export class LiveDevice {
  id = 'live';
  name = 'Ableton Live 12 (Live-V)';
  transport: Transport;
  arrangement: ArrangementSection[] = [];
  master: MasterChainParams;
  private sr: number;
  private comp: MasterComp;
  private limiter: Limiter;
  private dc: DCBlocker;
  private lowShelf: OnePole;
  private highShelf: OnePole;
  private rng: Rng;
  /** Recorded master output (full render). */
  recorded: { l: Float32Array; r: Float32Array } | null = null;
  /** Execution log — machine-readable. */
  log: LogEntry[] = [];
  readonly externalHardware = 'Ableton Live 12 Suite — real DAW (the twin IS the implementation here).';

  constructor(transport: Transport, master: Partial<MasterChainParams> = {}) {
    this.transport = transport;
    this.sr = transport.sampleRate;
    this.master = { ...MASTER_DEFAULTS, ...master };
    this.comp = new MasterComp(this.sr);
    this.comp.threshold = this.master.compThreshold;
    this.comp.ratio = this.master.compRatio;
    this.limiter = new Limiter(this.sr);
    this.limiter.ceiling = this.master.limiterCeiling;
    this.dc = new DCBlocker();
    this.lowShelf = new OnePole(this.sr, 'lp');
    this.lowShelf.setCutoff(120);
    this.highShelf = new OnePole(this.sr, 'hp');
    this.highShelf.setCutoff(6000);
    this.rng = new Rng(2024);
  }

  setArrangement(sections: ArrangementSection[]) { this.arrangement = sections; }

  /** Section at a given bar. */
  sectionAt(bar: number): ArrangementSection | null {
    let acc = 0;
    for (const s of this.arrangement) {
      if (bar >= acc && bar < acc + s.bars) return s;
      acc += s.bars;
    }
    return null;
  }

  /** Total bars in arrangement. */
  totalBars(): number { return this.arrangement.reduce((a, s) => a + s.bars, 0); }

  /** Apply master chain to a stereo block. */
  processMaster(inL: Float32Array, inR: Float32Array): { l: Float32Array; r: Float32Array } {
    const n = inL.length;
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // EQ shelves
      const lowL = this.lowShelf.process(inL[i]) * this.master.eqLow;
      const highL = this.highShelf.process(inL[i]) * this.master.eqHigh;
      const lowR = this.lowShelf.process(inR[i]) * this.master.eqLow;
      const highR = this.highShelf.process(inR[i]) * this.master.eqHigh;
      let l = inL[i] + lowL * 0.5 + highL * 0.3;
      let r = inR[i] + lowR * 0.5 + highR * 0.3;
      // compressor (linked stereo)
      const mid = (l + r) * 0.5;
      const c = this.comp.process(mid);
      const compGain = mid > 0.0001 ? c / mid : 1;
      l *= compGain; r *= compGain;
      // DC + limiter
      l = this.dc.process(l);
      r = this.dc.process(r);
      const [lo, ro] = this.limiter.processStereo(l, r);
      outL[i] = lo; outR[i] = ro;
    }
    return { l: outL, r: outR };
  }

  /** Record master output. */
  record(master: { l: Float32Array; r: Float32Array }) {
    if (!this.recorded) {
      this.recorded = { l: new Float32Array(master.l.length), r: new Float32Array(master.r.length) };
    }
    const newLen = this.recorded.l.length + master.l.length;
    const nl = new Float32Array(newLen);
    const nr = new Float32Array(newLen);
    nl.set(this.recorded.l); nl.set(master.l, this.recorded.l.length);
    nr.set(this.recorded.r); nr.set(master.r, this.recorded.r.length);
    this.recorded = { l: nl, r: nr };
  }

  logEvent(level: 'INFO' | 'WARN' | 'ERROR' | 'PASS' | 'FAIL', stage: string, message: string, data?: unknown) {
    this.log.push({
      t: this.transport.seconds(),
      sample: this.transport.sample,
      level, stage, message, data,
    });
  }

  reset() {
    this.comp.reset(); this.limiter.reset(); this.dc.reset();
    this.lowShelf.reset(); this.highShelf.reset();
    this.recorded = null; this.log = [];
  }
}

export interface LogEntry {
  t: number; sample: number;
  level: 'INFO' | 'WARN' | 'ERROR' | 'PASS' | 'FAIL';
  stage: string; message: string; data?: unknown;
}
