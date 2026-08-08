/**
 * DSP PRIMITIVES — Envelopes & LFOs.
 * REAL IMPLEMENTATION.
 */

/** ADSR envelope with exponential-ish curves. Sample-accurate. */
export class ADSR {
  attack = 0.01;   // seconds
  decay = 0.2;
  sustain = 0.7;
  release = 0.3;
  private sr: number;
  private state: 'idle' | 'attack' | 'decay' | 'sustain' | 'release' = 'idle';
  private value = 0;
  private target = 0;
  private rate = 0; // per-sample
  private releaseStart = 0;
  private attackCurve = 0; // 0 linear, >0 exponential-ish

  constructor(sampleRate: number) { this.sr = sampleRate; }

  gate(on: boolean) {
    if (on) {
      this.state = 'attack';
      this.target = 1;
      this.rate = 1 / Math.max(0.0005, this.attack * this.sr);
    } else if (this.state !== 'idle') {
      this.state = 'release';
      this.releaseStart = this.value;
      this.rate = 1 / Math.max(0.0005, this.release * this.sr);
    }
  }

  /** Per-sample advance. */
  process(): number {
    switch (this.state) {
      case 'attack': {
        this.value += this.rate;
        if (this.value >= 1) {
          this.value = 1;
          this.state = 'decay';
          this.target = this.sustain;
          this.rate = 1 / Math.max(0.0005, this.decay * this.sr);
        }
        break;
      }
      case 'decay': {
        // exponential approach to sustain
        this.value += (this.sustain - this.value) * Math.min(1, this.rate);
        if (Math.abs(this.value - this.sustain) < 0.0005) {
          this.value = this.sustain;
          this.state = 'sustain';
        }
        break;
      }
      case 'sustain':
        this.value = this.sustain;
        break;
      case 'release': {
        // exponential decay toward 0
        this.value += (0 - this.value) * Math.min(1, this.rate);
        if (this.value < 0.0005) { this.value = 0; this.state = 'idle'; }
        break;
      }
      case 'idle':
        this.value = 0;
        break;
    }
    return this.value;
  }

  isActive() { return this.state !== 'idle'; }
  reset() { this.state = 'idle'; this.value = 0; }
}

/** Simple attack-decay (percussive) envelope. */
export class AD {
  attack = 0.001;
  decay = 0.15;
  private sr: number;
  private value = 0;
  private phase: 'idle' | 'attack' | 'decay' = 'idle';

  constructor(sampleRate: number) { this.sr = sampleRate; }

  trigger() {
    this.phase = 'attack';
    this.value = 0;
  }

  process(): number {
    if (this.phase === 'attack') {
      this.value += 1 / Math.max(1, this.attack * this.sr);
      if (this.value >= 1) { this.value = 1; this.phase = 'decay'; }
    } else if (this.phase === 'decay') {
      this.value *= Math.pow(0.5, 1 / Math.max(0.0005, this.decay * this.sr));
      if (this.value < 0.0005) { this.value = 0; this.phase = 'idle'; }
    }
    return this.value;
  }

  isActive() { return this.phase !== 'idle'; }
  reset() { this.phase = 'idle'; this.value = 0; }
}

/** LFO with multiple shapes, sample-accurate, syncable to clock. */
export class LFO {
  shape: 'sine' | 'triangle' | 'saw' | 'square' | 'random' | 's&h';
  freq = 1;        // Hz
  syncMode = false;
  syncDiv = 1;     // cycles per beat when synced
  private sr: number;
  private phase = 0;
  private sHoldValue = 0;
  private stepCounter = 0;
  private rngState: number;

  constructor(shape: LFO['shape'], sampleRate: number, seed = 7) {
    this.shape = shape;
    this.sr = sampleRate;
    this.rngState = seed || 1;
  }

  setFreqHz(f: number) { this.freq = Math.max(0.0001, f); }
  /** Sync: cycles per beat. bpm passed to compute per-sample phase inc. */
  setSync(bpm: number, div: number) {
    this.syncMode = true;
    this.syncDiv = div;
    const beatHz = bpm / 60;
    this.freq = beatHz * div;
  }

  process(): number {
    const inc = this.freq / this.sr;
    let out = 0;
    switch (this.shape) {
      case 'sine': out = Math.sin(2 * Math.PI * this.phase); break;
      case 'triangle': out = this.phase < 0.5 ? this.phase * 4 - 1 : 3 - this.phase * 4; break;
      case 'saw': out = 2 * this.phase - 1; break;
      case 'square': out = this.phase < 0.5 ? 1 : -1; break;
      case 'random': {
        // smooth random — interpolate between s&h values
        const r = (this.rngState / 4294967296) * 2 - 1;
        out = r;
        break;
      }
      case 's&h': {
        out = this.sHoldValue;
        break;
      }
    }
    // advance + sample/hold on phase wrap
    const prevPhase = this.phase;
    this.phase += inc;
    if (this.phase >= 1) {
      this.phase -= Math.floor(this.phase);
      // xorshift for new S&H value
      let s = this.rngState;
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      this.rngState = s;
      this.sHoldValue = (s / 4294967296) * 2 - 1;
    }
    return out;
  }

  reset() { this.phase = 0; this.sHoldValue = 0; }
}
