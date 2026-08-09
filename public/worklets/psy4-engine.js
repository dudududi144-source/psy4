/**
 * PSY4 Engine — Single AudioWorklet processor.
 *
 * This is the REAL-TIME PRODUCTION ENGINE. It replaces the setInterval(25ms)
 * main-thread scheduler and the per-hit Web Audio node creation that caused
 * latency, jitter, and GC pressure under dense events.
 *
 * Architecture:
 *   Main thread (controller)
 *     ↓ port.postMessage (commands + event batches)
 *   AudioWorklet (this file)
 *     ├── Transport (BPM, step, section — sample-accurate clock)
 *     ├── Ring-buffer event queue (zero allocation)
 *     ├── Preallocated voice pool (kick, bass, lead, acid, pad, hats, ...)
 *     ├── Voice DSP (Moog ladder, BL saw, envelopes — all inline)
 *     ├── Bus mixing (drum/bass/music/atmos/fx → master)
 *     └── Master chain (saturation + limiter)
 *     ↓ stereo output
 *   Speakers
 *
 * The main thread NEVER determines when a kick fires. It sends high-level
 * musical events ("kick at time T, velocity 0.9") and the worklet executes
 * them sample-accurately. The main thread can be blocked by React/GC without
 * affecting audio timing.
 *
 * Ported DSP from PSY3:
 *   - pro_dsp.py moog()       → MoogLadder class (4-stage tanh)
 *   - pro_dsp.py bl_saw()     → polyBLEP sawtooth
 *   - engine.py kick()        → KickVoice (sub + mid + click)
 *   - engine.py bass()        → BassVoice (saw + Moog + sub)
 *   - engine.py hat()         → HatVoice (differentiated pink noise)
 *   - engine.py clap()        → ClapVoice (multi-burst noise)
 *   - style_master.py _sat()  → master saturation
 *   - style_master.py limiter → master limiter
 */

// ─── Constants ─────────────────────────────────────────────────────────────

const MAX_VOICES = 64;        // max simultaneous voice instances
const EVENT_SIZE = 6;         // floats per event: [time, voice, note, vel, dur, param]
const MAX_EVENTS = 2048;      // ring buffer capacity (events)
const TANH_TABLE_SIZE = 2048;

// Voice IDs
const V_KICK = 0, V_BASS = 1, V_LEAD = 2, V_ACID = 3, V_PAD = 4;
const V_HAT = 5, V_HAT_OPEN = 6, V_CLAP = 7, V_PERC = 8, V_SHAKER = 9;
const V_TEXTURE = 10, V_RISER = 11, V_IMPACT = 12, V_SWEEP = 13;
const V_ZAP = 14, V_BLIP = 15, V_DOWNLIFTER = 16;

// ─── Fast tanh via lookup table ────────────────────────────────────────────

const tanhTable = new Float32Array(TANH_TABLE_SIZE + 1);
for (let i = 0; i <= TANH_TABLE_SIZE; i++) {
  const x = (i / TANH_TABLE_SIZE) * 2 - 1; // -1..1
  tanhTable[i] = Math.tanh(x);
}

function fastTanh(x) {
  if (x >= 1) return 1;
  if (x <= -1) return -1;
  const idx = (x + 1) * 0.5 * TANH_TABLE_SIZE;
  const i0 = idx | 0;
  const f = idx - i0;
  return tanhTable[i0] * (1 - f) + tanhTable[i0 + 1] * f;
}

// ─── polyBLEP ──────────────────────────────────────────────────────────────

function polyBlep(phase, inc) {
  if (phase < inc) {
    const t = phase / inc;
    return 2 * t - t * t - 1;
  } else if (phase > 1 - inc) {
    const t = (phase - 1) / inc;
    return t * t + 2 * t + 1;
  }
  return 0;
}

// ─── Moog Ladder Filter (4-stage tanh, stateful) ───────────────────────────
// Port of PSY3 pro_dsp.py moog(). Reusable per-voice instance.

class MoogLadder {
  constructor() {
    this.s0 = 0; this.s1 = 0; this.s2 = 0; this.s3 = 0;
    this.g = 0;
    this.lastCutoff = -1;
  }

  reset() { this.s0 = this.s1 = this.s2 = this.s3 = 0; }

  process(x, cutoff, res, drive, sr) {
    // Recompute g when cutoff changes
    if (Math.abs(cutoff - this.lastCutoff) > 0.5) {
      const fc = Math.min(0.45, cutoff / sr);
      this.g = 1 - Math.exp(-2 * Math.PI * fc);
      this.lastCutoff = cutoff;
    }
    const g = this.g;
    const fb = res * 4 * fastTanh(this.s3);
    const u = fastTanh((x - fb) * drive);
    let prev = u;
    this.s0 += g * (fastTanh(prev) - this.s0); prev = this.s0;
    this.s1 += g * (fastTanh(prev) - this.s1); prev = this.s1;
    this.s2 += g * (fastTanh(prev) - this.s2); prev = this.s2;
    this.s3 += g * (fastTanh(prev) - this.s3);
    return this.s3 / (1 + res * 0.5);
  }
}

// ─── One-pole lowpass (for envelopes, simple filters) ──────────────────────

class OnePoleLP {
  constructor() { this.v = 0; }
  reset() { this.v = 0; }
  process(x, cutoff, sr) {
    const a = (1 / sr) * 2 * Math.PI * cutoff;
    this.v += a * (x - this.v) / (1 + a);
    return this.v;
  }
}

// ─── Pink noise generator (stateful, Voss-McCartney) ───────────────────────

class PinkNoise {
  constructor() {
    this.b = new Float32Array(7);
    this.rngState = 12345;
  }
  reset() { this.b.fill(0); }
  // Simple LFSR random (deterministic, no Math.random for reproducibility)
  next() {
    this.rngState = (this.rngState * 1103515245 + 12345) & 0x7fffffff;
    return (this.rngState / 0x3fffffff) - 1;
  }
  // Pink noise sample
  process() {
    const w = this.next();
    this.b[0] = 0.99886 * this.b[0] + w * 0.0555179;
    this.b[1] = 0.99332 * this.b[1] + w * 0.0750759;
    this.b[2] = 0.96900 * this.b[2] + w * 0.1538520;
    this.b[3] = 0.86650 * this.b[3] + w * 0.3104856;
    this.b[4] = 0.55000 * this.b[4] + w * 0.5329522;
    this.b[5] = -0.7616 * this.b[5] - w * 0.0168980;
    const p = this.b[0] + this.b[1] + this.b[2] + this.b[3] + this.b[4] + this.b[5] + this.b[6] + w * 0.5362;
    this.b[6] = w * 0.115926;
    return p * 0.11;
  }
}

// ─── ADSR Envelope ─────────────────────────────────────────────────────────

class ADSR {
  constructor() { this.stage = 4; this.t = 0; this.value = 0; }
  trigger(a, d, s, r) { this.stage = 0; this.t = 0; this.a = a; this.d = d; this.s = s; this.r = r; this.value = 0; }
  release() { if (this.stage < 3) { this.stage = 3; this.t = 0; } }
  process(dt) {
    if (this.stage >= 4) return 0;
    this.t += dt;
    if (this.stage === 0) { // attack
      this.value = this.t / Math.max(0.0001, this.a);
      if (this.t >= this.a) { this.stage = 1; this.t = 0; this.value = 1; }
    } else if (this.stage === 1) { // decay
      this.value = 1 - (1 - this.s) * (this.t / Math.max(0.0001, this.d));
      if (this.t >= this.d) { this.stage = 2; this.value = this.s; }
    } else if (this.stage === 2) { // sustain
      this.value = this.s;
    } else if (this.stage === 3) { // release
      this.value = this.s * (1 - this.t / Math.max(0.0001, this.r));
      if (this.t >= this.r) { this.stage = 4; this.value = 0; }
    }
    return Math.max(0, Math.min(1, this.value));
  }
  get done() { return this.stage >= 4; }
}

// ─── Exponential decay envelope (for percussive voices) ────────────────────

class DecayEnv {
  constructor() { this.t = 0; this.decay = 0.1; this.active = false; }
  trigger(decay) { this.t = 0; this.decay = Math.max(0.001, decay); this.active = true; }
  process(dt) {
    if (!this.active) return 0;
    this.t += dt;
    const v = Math.exp(-this.t / this.decay);
    if (v < 0.0001) { this.active = false; return 0; }
    return v;
  }
  get done() { return !this.active; }
}

// ─── Band-limited sawtooth oscillator (polyBLEP) ───────────────────────────

class BLSaw {
  constructor() { this.phase = 0; this.freq = 220; }
  setFreq(f) { this.freq = f; }
  process(inc) {
    const val = 2 * this.phase - 1;
    const corrected = val - polyBlep(this.phase, inc);
    this.phase += inc;
    if (this.phase >= 1) this.phase -= 1;
    return corrected;
  }
  reset() { this.phase = 0; }
}

// ─── Band-limited square oscillator (polyBLEP) ─────────────────────────────

class BLSquare {
  constructor() { this.phase = 0; this.freq = 220; }
  setFreq(f) { this.freq = f; }
  process(inc) {
    let val = this.phase < 0.5 ? 1 : -1;
    val += polyBlep(this.phase, inc);
    let p2 = this.phase + 0.5;
    if (p2 >= 1) p2 -= 1;
    val -= polyBlep(p2, inc);
    this.phase += inc;
    if (this.phase >= 1) this.phase -= 1;
    return val;
  }
  reset() { this.phase = 0; }
}

// ─── Voice: Kick (PSY3 engine.py kick) ─────────────────────────────────────
// sub (pitched sine) + mid (saturated triangle) + click (differentiated noise)

class KickVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.amp = 1;
    this.fund = 50;
    this.decay = 0.2;
    this.phase = 0;
    this.prevNoise = 0;
    this.noise = new PinkNoise();
  }

  trigger(time, amp, fund, decay, sr) {
    this.active = true;
    this.t = 0;
    this.amp = amp;
    this.fund = fund;
    this.decay = decay;
    this.startTime = time;
    this.phase = 0;
    this.prevNoise = 0;
    this.noise.reset();
  }

  // Returns [sample, done]
  render(currentTime, sr) {
    if (!this.active) return [0, true];
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.decay + 0.05) { this.active = false; return [0, true]; }

    const t = this.t;
    const f0 = this.fund;

    // Pitch envelope: f0*2.4 → f0 over 0.04s
    const f = (f0 * 2.4 - f0) * Math.exp(-t / 0.04) + f0;

    // Sub: sine with integrated phase (pitch sweep)
    this.phase += 2 * Math.PI * f / sr;
    const subEnv = Math.exp(-t / (this.decay * 0.9));
    const sub = Math.sin(this.phase) * subEnv * 0.8;

    // Mid: saturated triangle at fundamental, short decay
    const triPhase = (t * f0) % 1;
    const tri = 2 * Math.abs(2 * triPhase - 1) - 1;
    const midEnv = Math.exp(-t / 0.05) * 0.5;
    const mid = fastTanh(tri * 1.5) * midEnv;

    // Click: differentiated white noise, very short
    const n = this.noise.next();
    const click = (n - this.prevNoise) * Math.exp(-t / 0.002) * 0.35;
    this.prevNoise = n;

    const sample = (sub + mid + click) * 0.8 * this.amp;
    return [sample, false];
  }
}

// ─── Voice: Bass (PSY3 engine.py bass) ─────────────────────────────────────
// BL saw → Moog filter (cutoff envelope) + sub sine

class BassVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.freq = 80;
    this.amp = 0.5;
    this.dur = 0.2;
    this.acid = false;
    this.square = new BLSquare();
    this.saw = new BLSaw();
    this.filter = new MoogLadder();
    this.phase = 0;
    this.cutoffStart = 800;
    this.cutoffEnd = 200;
    this.res = 0.1;
    this.bassDecay = 0.12;
    // Post-filter state (one-pole HP for cleaning mud)
    this.hpState = 0;
  }

  trigger(time, freq, dur, amp, acid, sr, params) {
    this.active = true;
    this.t = 0;
    this.freq = freq;
    this.dur = dur;
    this.amp = amp;
    this.acid = acid;
    this.phase = 0;
    this.hpState = 0;
    this.square.reset();
    this.square.setFreq(freq);
    this.saw.reset();
    this.saw.setFreq(freq);
    this.filter.reset();
    if (acid) {
      this.cutoffStart = 2500;
      this.cutoffEnd = 100;
      this.res = 0.85;
      this.bassDecay = 0.15;
    } else {
      this.cutoffStart = params?.cutoffStart ?? 800;
      this.cutoffEnd = params?.cutoffEnd ?? 200;
      this.res = Math.min(0.3, (params?.resonance ?? 3) / 20);
      this.bassDecay = 0.12;
    }
  }

  render(currentTime, sr) {
    if (!this.active) return [0, true];
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.bassDecay) { this.active = false; return [0, true]; }

    const inc = this.freq / sr;
    const osc = this.acid ? this.saw.process(inc) : this.square.process(inc);

    // 1. FILTER: Moog ladder with envelope (this is the tone-shaping stage)
    const cutoffEnv = (this.cutoffStart - this.cutoffEnd) * Math.exp(-this.t / 0.04) + this.cutoffEnd;
    const drive = this.acid ? 2.5 : 1.3;
    const filtered = this.filter.process(osc, cutoffEnv, this.res, drive, sr);

    // 2. SUB: Clean sine at fundamental (separate from body — provides weight)
    this.phase += 2 * Math.PI * this.freq / sr;
    const sub = Math.sin(this.phase) * 0.45;

    // 3. MIX: Body (filtered) + Sub (clean) — body provides character, sub provides weight
    let mixed = filtered * 0.55 + sub * 0.45;

    // 4. SATURATION: Post-mix tanh saturation (adds harmonics + warmth — this is what makes
    //    a bass sound "produced" rather than "raw oscillator")
    //    Commercial bass always has saturation. Without it, the bass sounds thin and digital.
    mixed = fastTanh(mixed * 1.8);  // drive=1.8 — moderate, adds warmth without distortion

    // 5. HP FILTER: Remove subsonic mud below 30Hz (one-pole HP)
    //    Prevents the bass from interfering with the kick's sub region
    const hpCutoff = 30;  // Hz
    const hpA = (1 / sr) * 2 * Math.PI * hpCutoff;
    this.hpState += hpA * (mixed - this.hpState) / (1 + hpA);
    mixed = mixed - this.hpState * 0.7;  // partial HP — keep some sub but remove mud

    // 6. AMP ENVELOPE: Fast attack (1ms) + exponential decay
    const attackEnv = Math.min(1, this.t / 0.001);
    const decayEnv = Math.exp(-this.t / (this.bassDecay * 0.5));
    const ampEnv = attackEnv * decayEnv;

    return [mixed * ampEnv * this.amp, false];
  }
}

// ─── Voice: Lead (supersaw → Moog → amp env) ───────────────────────────────

class LeadVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.dur = 0.3;
    this.amp = 0.15;
    this.saws = [new BLSaw(), new BLSaw(), new BLSaw(), new BLSaw(), new BLSaw()];
    this.filter = new MoogLadder();
    this.cutoff = 1800;
    this.res = 0.15;
    this.lfoPhase = 0;
    this.lfoRate = 0.8;
    this.lfoDepth = 0.3;
    this.detune = 10;
  }

  trigger(time, freq, dur, amp, sr, params) {
    this.active = true;
    this.t = 0;
    this.dur = dur;
    this.amp = amp;
    this.freq = freq;
    this.detune = params?.detune ?? 10;
    this.cutoff = params?.cutoff ?? 1800;
    this.res = Math.min(1, (params?.resonance ?? 2) / 20);
    this.lfoRate = params?.lfoRate ?? 0.8;
    this.lfoDepth = params?.lfoDepth ?? 0.3;
    this.lfoPhase = 0;
    for (const s of this.saws) { s.reset(); }
    // Set detuned frequencies
    const n = this.saws.length;
    for (let i = 0; i < n; i++) {
      const cents = (i - (n - 1) / 2) * this.detune;
      const mult = Math.pow(2, cents / 1200);
      this.saws[i].setFreq(freq * mult);
    }
    this.filter.reset();
  }

  render(currentTime, sr) {
    if (!this.active) return [0, true];
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.dur + 0.05) { this.active = false; return [0, true]; }

    const inc = this.freq / sr;

    // Mix 5 detuned saws
    let mix = 0;
    for (const s of this.saws) mix += s.process(inc);
    mix /= this.saws.length;

    // LFO modulates filter cutoff (psychedelic movement)
    this.lfoPhase += this.lfoRate * dt;
    const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * this.lfoPhase);
    const modCutoff = this.cutoff * (1 + this.lfoDepth * (lfo * 2 - 1) * 0.5);

    // Filter envelope: open → settle
    const fEnv = this.cutoff * 2 * Math.exp(-this.t / (this.dur * 0.5)) + this.cutoff;
    const cutoff = Math.min(18000, Math.max(100, fEnv * 0.5 + modCutoff * 0.5));

    const filtered = this.filter.process(mix, cutoff, this.res, 1.5, sr);

    // SATURATION: Post-filter tanh — adds character and warmth that makes
    // the lead sound "produced" rather than "raw synth"
    const saturated = fastTanh(filtered * 1.6);

    // Amp envelope
    const ampEnv = Math.min(1, this.t / 0.006) * Math.exp(-this.t / this.dur);
    const sample = saturated * ampEnv * this.amp;
    return [sample, false];
  }
}

// ─── Voice: Acid (square → high-res Moog → distortion) ─────────────────────

class AcidVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.square = new BLSquare();
    this.filter = new MoogLadder();
  }

  trigger(time, freq, dur, amp, sr) {
    this.active = true;
    this.t = 0;
    this.freq = freq;
    this.dur = dur;
    this.amp = amp;
    this.square.reset();
    this.square.setFreq(freq);
    this.filter.reset();
    this.cutoffStart = 200 + 3000;
    this.cutoffEnd = 100;
    this.res = 0.9;
  }

  render(currentTime, sr) {
    if (!this.active) return [0, true];
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.dur + 0.05) { this.active = false; return [0, true]; }

    const inc = this.freq / sr;
    const sq = this.square.process(inc);

    // Filter sweep — FASTER decay for more squelch character
    // The cutoff drops quickly, which creates the "squelch" as resonance
    // sweeps through the harmonic content
    const cutoff = (this.cutoffStart - this.cutoffEnd) * Math.exp(-this.t / (this.dur * 0.4)) + this.cutoffEnd;
    // HIGHER resonance (0.95) for true acid squelch + HIGHER drive (3.0) for grit
    const filtered = this.filter.process(sq, cutoff, 0.95, 3.0, sr);

    // Distortion — HEAVIER for acid character (drive=4)
    const distorted = fastTanh(filtered * 4);

    const ampEnv = Math.min(1, this.t / 0.003) * Math.exp(-this.t / this.dur);
    const sample = distorted * ampEnv * this.amp;
    return [sample, false];
  }
}

// ─── Voice: Pad (detuned saws → Moog → slow env) ───────────────────────────

class PadVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.saws = [new BLSaw(), new BLSaw()];
    this.filter = new MoogLadder();
    this.lfoPhase = 0;
  }

  trigger(time, freq, dur, amp, sr, params) {
    this.active = true;
    this.t = 0;
    this.dur = dur;
    this.amp = amp;
    this.freq = freq;
    this.cutoff = params?.cutoff ?? 1200;
    this.res = 0.05;
    this.attack = params?.attack ?? 0.5;
    this.detune = params?.detune ?? 7;
    this.evolveRate = params?.evolveRate ?? 0.1;
    this.lfoPhase = 0;
    for (const s of this.saws) { s.reset(); }
    this.saws[0].setFreq(freq * Math.pow(2, -this.detune / 1200));
    this.saws[1].setFreq(freq * Math.pow(2, this.detune / 1200));
    this.filter.reset();
  }

  render(currentTime, sr) {
    if (!this.active) return [0, true];
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.dur + 0.1) { this.active = false; return [0, true]; }

    const inc = this.freq / sr;

    // Evolve LFO modulates detune (via frequency)
    this.lfoPhase += this.evolveRate * dt;
    const lfo = Math.sin(2 * Math.PI * this.lfoPhase);
    const detuneMod = 1 + 0.003 * lfo;
    this.saws[0].setFreq(this.freq * Math.pow(2, -this.detune / 1200) * detuneMod);
    this.saws[1].setFreq(this.freq * Math.pow(2, this.detune / 1200) * detuneMod);

    let mix = 0;
    for (const s of this.saws) mix += s.process(inc);
    mix *= 0.5;

    const filtered = this.filter.process(mix, this.cutoff, this.res, 1.1, sr);

    // Slow attack/release envelope
    const attackEnv = Math.min(1, this.t / this.attack);
    const releaseEnv = Math.min(1, (this.dur - this.t) / 0.4);
    const ampEnv = Math.max(0, Math.min(1, Math.min(attackEnv, releaseEnv)));
    const sample = filtered * ampEnv * this.amp;
    return [sample, false];
  }
}

// ─── Voice: Hat (differentiated pink noise, PSY3 engine.py hat) ────────────

class HatVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.noise = new PinkNoise();
    this.prevNoise = 0;
  }

  trigger(time, open, amp, sr) {
    this.active = true;
    this.t = 0;
    this.open = open;
    this.amp = amp;
    this.decay = open ? 0.22 : 0.03;
    this.prevNoise = 0;
    this.noise.reset();
  }

  render(currentTime, sr) {
    if (!this.active) return [0, true];
    this.t += 1 / sr;
    if (this.t > this.decay * 1.5) { this.active = false; return [0, true]; }

    const n = this.noise.process();
    // Highpass via differentiation
    const hp = n - this.prevNoise;
    this.prevNoise = n;
    const env = Math.exp(-this.t / this.decay);
    const sample = hp * env * 0.5 * this.amp / 0.12;
    return [sample, false];
  }
}

// ─── Voice: Clap (multi-burst noise, PSY3 engine.py clap) ──────────────────

class ClapVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.noise = new PinkNoise();
  }

  trigger(time, amp, sr) {
    this.active = true;
    this.t = 0;
    this.amp = amp;
    this.noise.reset();
    this.bursts = [0, 0.012, 0.024, 0.036];
    this.decays = [0.02, 0.02, 0.02, 0.09];
  }

  render(currentTime, sr) {
    if (!this.active) return [0, true];
    this.t += 1 / sr;
    if (this.t > 0.3) { this.active = false; return [0, true]; }

    const n = this.noise.next();
    let g = 0;
    for (let k = 0; k < 4; k++) {
      if (this.t >= this.bursts[k]) {
        g += Math.exp(-(this.t - this.bursts[k]) / this.decays[k]);
      }
    }
    const sample = n * g * 0.6 * this.amp / 0.4;
    return [sample, false];
  }
}

// ─── Voice: Perc (pitched sine with decay) ─────────────────────────────────

class PercVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.phase = 0;
  }

  trigger(time, freq, amp, sr) {
    this.active = true;
    this.t = 0;
    this.freq = freq;
    this.amp = amp;
    this.phase = 0;
  }

  render(currentTime, sr) {
    if (!this.active) return [0, true];
    this.t += 1 / sr;
    if (this.t > 0.1) { this.active = false; return [0, true]; }

    this.phase += 2 * Math.PI * this.freq / sr;
    const env = Math.exp(-this.t / 0.05);
    const sample = Math.sin(this.phase) * env * this.amp;
    return [sample, false];
  }
}

// ─── Voice: Shaker (filtered noise, short) ─────────────────────────────────

class ShakerVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.noise = new PinkNoise();
    this.prevNoise = 0;
  }

  trigger(time, amp, sr) {
    this.active = true;
    this.t = 0;
    this.amp = amp;
    this.noise.reset();
    this.prevNoise = 0;
  }

  render(currentTime, sr) {
    if (!this.active) return [0, true];
    this.t += 1 / sr;
    if (this.t > 0.08) { this.active = false; return [0, true]; }

    const n = this.noise.process();
    const hp = n - this.prevNoise;
    this.prevNoise = n;
    const env = Math.exp(-this.t / 0.03);
    const sample = hp * env * 2 * this.amp;
    return [sample, false];
  }
}

// ─── Voice: Texture (FM or noise bed) ──────────────────────────────────────

class TextureVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.carrierPhase = 0;
    this.modPhase = 0;
    this.noise = new PinkNoise();
  }

  trigger(time, dur, amp, type, sr) {
    this.active = true;
    this.t = 0;
    this.dur = dur;
    this.amp = amp;
    this.type = type || 'fm';
    this.carrierPhase = 0;
    this.modPhase = 0;
    this.noise.reset();
    if (type === 'fm') {
      this.carrierFreq = 200;
      this.modFreq = 80;
      this.modIndex = 200;
    } else {
      this.noiseFreq = 1000;
    }
  }

  render(currentTime, sr) {
    if (!this.active) return [0, true];
    this.t += 1 / sr;
    if (this.t > this.dur + 0.1) { this.active = false; return [0, true]; }

    const dt = 1 / sr;
    const env = Math.min(1, this.t / 0.5) * Math.min(1, (this.dur - this.t) / 0.5);
    let sample = 0;
    if (this.type === 'fm') {
      this.modPhase += 2 * Math.PI * this.modFreq * dt;
      const mod = Math.sin(this.modPhase) * this.modIndex;
      this.carrierPhase += 2 * Math.PI * (this.carrierFreq + mod) * dt;
      sample = Math.sin(this.carrierPhase);
    } else {
      const n = this.noise.process();
      sample = n;
    }
    return [sample * env * this.amp, false];
  }
}

// ─── Voice: FX (riser, impact, sweep, zap, blip, downlifter) ──────────────

class FXVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.noise = new PinkNoise();
    this.phase = 0;
  }

  trigger(type, time, dur, amp, sr) {
    this.active = true;
    this.type = type;
    this.t = 0;
    this.dur = dur || 0.3;
    this.amp = amp || 0.2;
    this.phase = 0;
    this.noise.reset();
  }

  render(currentTime, sr) {
    if (!this.active) return [0, true];
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.dur + 0.2) { this.active = false; return [0, true]; }

    let sample = 0;
    const t = this.t;
    switch (this.type) {
      case V_RISER: {
        const n = this.noise.process();
        const env = Math.min(1, t / this.dur) * 0.3;
        sample = n * env;
        break;
      }
      case V_IMPACT: {
        const f = 120 * Math.exp(-t / 0.15) + 35;
        this.phase += 2 * Math.PI * f * dt;
        const env = Math.exp(-t / 0.2);
        sample = Math.sin(this.phase) * env * 0.8;
        break;
      }
      case V_SWEEP: {
        const n = this.noise.process();
        const env = Math.sin(Math.PI * t / this.dur) * 0.15;
        sample = n * env;
        break;
      }
      case V_ZAP: {
        const car = 880, mod = 1760;
        const idx = 3 * Math.exp(-t / 0.03);
        this.phase += 2 * Math.PI * (car + idx * Math.sin(2 * Math.PI * mod * t)) * dt;
        const env = Math.exp(-t / 0.04);
        sample = Math.sin(this.phase) * env;
        break;
      }
      case V_BLIP: {
        this.phase += 2 * Math.PI * 1200 * dt;
        const env = Math.exp(-t / 0.02);
        sample = Math.sin(this.phase) * env;
        break;
      }
      case V_DOWNLIFTER: {
        const f = 800 * Math.exp(-t / 0.15) + 100;
        this.phase += 2 * Math.PI * f * dt;
        const env = Math.exp(-t / 0.2);
        sample = Math.sin(this.phase) * env;
        break;
      }
    }
    return [sample * this.amp, false];
  }
}

// ─── Sample Voice (plays preloaded AudioBuffer data) ──────────────────────
// Plays a sample with linear interpolation, pitch shift, and gain.
// Used for kick/hat/clap — the REAL PSY3 samples give professional sound quality
// that pure synth DSP cannot match.

class SampleVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.sampleData = null;     // Float32Array
    this.sampleRate = 44100;
    this.playbackRate = 1.0;    // pitch shift
    this.amp = 1.0;
    this.gainEnv = 1.0;
    this.decay = 0.3;
    this.position = 0;          // fractional sample position
    this.pan = 0;               // -1..1
  }

  trigger(sampleData, sampleRate, playbackRate, amp, decay, pan) {
    this.active = true;
    this.t = 0;
    this.sampleData = sampleData;
    this.sampleRate = sampleRate;
    this.playbackRate = playbackRate || 1.0;
    this.amp = amp;
    this.decay = decay || 0.3;
    this.position = 0;
    this.pan = pan || 0;
  }

  // Returns [leftSample, rightSample, done]
  renderStereo(currentTime, sr) {
    if (!this.active || !this.sampleData) return [0, 0, true];
    this.t += 1 / sr;
    const env = Math.exp(-this.t / this.decay);
    if (env < 0.001 || this.position >= this.sampleData.length) {
      this.active = false;
      return [0, 0, true];
    }

    // Linear interpolation playback
    const idx = Math.floor(this.position);
    const frac = this.position - idx;
    const s1 = this.sampleData[idx] || 0;
    const s2 = this.sampleData[idx + 1] || 0;
    let sample = (s1 + (s2 - s1) * frac) * env * this.amp;

    // SATURATION: Add warmth and punch to samples (especially kick)
    // Commercial kicks/snares always have saturation. Without it, samples
    // sound flat and lifeless. This tanh adds harmonics that make the
    // kick "punch through" the mix.
    sample = fastTanh(sample * 1.4);  // moderate drive — warm, not distorted

    // Advance position based on playback rate and sample rate ratio
    this.position += this.playbackRate * (this.sampleRate / sr);

    // Stereo: apply pan (equal power)
    const pan = Math.max(-1, Math.min(1, this.pan));
    const leftGain = pan <= 0 ? 1 : 1 - pan;
    const rightGain = pan >= 0 ? 1 : 1 + pan;

    return [sample * leftGain, sample * rightGain, false];
  }
}

// ─── Algorithmic Reverb (Schroeder-style: 4 comb + 2 allpass) ──────────────
// Creates space and depth. A dry psytrance mix sounds flat/amateur.
// Reverb is a SEND — voices send a portion of their signal here, and the
// reverb output feeds back to the master. This is how professional mixes work.

class SchroederReverb {
  constructor() {
    // 4 parallel comb filters (different delays for density)
    this.combDelays = [1687, 1601, 2053, 2251]; // samples at 44100 (prime)
    this.combBuffers = [];
    this.combIdx = [];
    this.combFeedback = 0.84;
    this.combDamping = 0.2;
    this.combLP = []; // one-pole LP per comb for high-freq damping
    for (let i = 0; i < 4; i++) {
      this.combBuffers.push(new Float32Array(this.combDelays[i]));
      this.combIdx.push(0);
      this.combLP.push(0);
    }
    // 2 series allpass filters (diffusion)
    this.allpassDelays = [347, 113]; // samples
    this.allpassBuffers = [];
    this.allpassIdx = [];
    this.allpassFeedback = 0.7;
    for (let i = 0; i < 2; i++) {
      this.allpassBuffers.push(new Float32Array(this.allpassDelays[i]));
      this.allpassIdx.push(0);
    }
    this.wet = 0.45;  // INCREASED from 0.3 — more audible reverb
    this.inputGain = 0.15; // send level
  }

  setWet(wet) { this.wet = wet; }
  setInputGain(g) { this.inputGain = g; }

  // Process a mono input, return stereo [left, right] reverb output
  process(input, sr) {
    // Scale input by send level
    const inSample = input * this.inputGain;

    // ── Comb filters (parallel) ──
    let combSum = 0;
    for (let i = 0; i < 4; i++) {
      const buf = this.combBuffers[i];
      const idx = this.combIdx[i];
      const delayed = buf[idx];
      // One-pole lowpass for damping (high frequencies decay faster)
      this.combLP[i] = delayed + this.combDamping * (this.combLP[i] - delayed);
      const out = inSample + this.combLP[i] * this.combFeedback;
      buf[idx] = out;
      this.combIdx[i] = (idx + 1) % this.combDelays[i];
      combSum += out;
    }
    combSum *= 0.25; // normalize

    // ── Allpass filters (series) for diffusion ──
    let ap = combSum;
    for (let i = 0; i < 2; i++) {
      const buf = this.allpassBuffers[i];
      const idx = this.allpassIdx[i];
      const delayed = buf[idx];
      const out = -ap * this.allpassFeedback + delayed;
      buf[idx] = ap + delayed * this.allpassFeedback;
      this.allpassIdx[i] = (idx + 1) % this.allpassDelays[i];
      ap = out;
    }

    // Stereo: slight delay between L and R for width
    // (re-use allpass output, offset by a few samples for stereo effect)
    const left = ap * this.wet;
    const right = combSum * this.wet * 0.9; // slightly different for width
    return [left, right];
  }

  reset() {
    for (const buf of this.combBuffers) buf.fill(0);
    for (const buf of this.allpassBuffers) buf.fill(0);
    this.combLP.fill(0);
  }
}

// ─── Tempo-Synced Stereo Delay (ping-pong) ────────────────────────────────
// Creates psychedelic movement. Left and right channels have different
// delay times (e.g., 3/16 and 3/8) for a wide, evolving echo.

class StereoDelay {
  constructor() {
    this.bufferSize = 44100 * 2; // 2 seconds max
    this.leftBuf = new Float32Array(this.bufferSize);
    this.rightBuf = new Float32Array(this.bufferSize);
    this.leftIdx = 0;
    this.rightIdx = 0;
    this.leftDelay = 0.375;  // seconds (3/8 at 120bpm)
    this.rightDelay = 0.281; // seconds (slightly different for ping-pong)
    this.feedback = 0.35;
    this.wet = 0.35;  // INCREASED from 0.25 — more audible delay
    this.inputGain = 0.2;
    this.sr = 44100;
    // LP filter on feedback for darker echoes
    this.fbLP = [0, 0];
  }

  setDelayTimes(leftMs, rightMs) {
    this.leftDelay = leftMs / 1000;
    this.rightDelay = rightMs / 1000;
  }

  setFeedback(fb) { this.feedback = fb; }
  setWet(wet) { this.wet = wet; }
  setInputGain(g) { this.inputGain = g; }

  // Process stereo input [left, right], return stereo [left, right] delay output
  process(leftIn, rightIn, sr) {
    this.sr = sr;
    const leftDelaySamples = Math.floor(this.leftDelay * sr);
    const rightDelaySamples = Math.floor(this.rightDelay * sr);

    // Read delayed samples
    const leftReadIdx = (this.leftIdx - leftDelaySamples + this.bufferSize) % this.bufferSize;
    const rightReadIdx = (this.rightIdx - rightDelaySamples + this.bufferSize) % this.bufferSize;
    const leftDelayed = this.leftBuf[leftReadIdx];
    const rightDelayed = this.rightBuf[rightReadIdx];

    // Feedback with LP filtering (darker echoes)
    const fbCutoff = 0.3;
    this.fbLP[0] = this.fbLP[0] + fbCutoff * (leftDelayed - this.fbLP[0]);
    this.fbLP[1] = this.fbLP[1] + fbCutoff * (rightDelayed - this.fbLP[1]);

    // Ping-pong: left feedback goes to right, right to left
    const leftWrite = leftIn * this.inputGain + this.fbLP[1] * this.feedback;
    const rightWrite = rightIn * this.inputGain + this.fbLP[0] * this.feedback;

    this.leftBuf[this.leftIdx] = leftWrite;
    this.rightBuf[this.rightIdx] = rightWrite;
    this.leftIdx = (this.leftIdx + 1) % this.bufferSize;
    this.rightIdx = (this.rightIdx + 1) % this.bufferSize;

    return [leftDelayed * this.wet, rightDelayed * this.wet];
  }

  reset() {
    this.leftBuf.fill(0);
    this.rightBuf.fill(0);
    this.fbLP.fill(0);
  }
}

// ─── Bus Processor (compression + saturation + EQ per bus) ────────────────
// Each bus (drum/bass/music/atmos/fx) gets its own processing.
// This is what makes the mix sound "produced" — without bus processing,
// it sounds like isolated sounds, not a cohesive track.

class BusProcessor {
  constructor(config) {
    this.config = config;
    // Compressor state
    this.compEnv = 0;
    // HP filter state (clean low end)
    this.hpState = 0;
    // Saturation drive
    this.drive = config.drive || 1.0;
    // Output gain
    this.gain = config.gain || 1.0;
  }

  process(sample, sr) {
    const dt = 1 / sr;

    // 1. HP FILTER: Remove subsonic mud (configurable per bus)
    if (this.config.hpFreq && this.config.hpFreq > 0) {
      const hpA = (1 / sr) * 2 * Math.PI * this.config.hpFreq;
      this.hpState += hpA * (sample - this.hpState) / (1 + hpA);
      sample = sample - this.hpState;
    }

    // 2. COMPRESSION: Simple envelope-follower compressor
    //    Drum bus: fast attack/release, moderate ratio (punchy)
    //    Bass bus: medium attack/release, low ratio (controlled)
    //    Music bus: slow attack/release, low ratio (glue)
    if (this.config.compThr) {
      const abs = Math.abs(sample);
      const att = this.config.compAtt || 0.003;
      const rel = this.config.compRel || 0.1;
      if (abs > this.compEnv) {
        this.compEnv += (abs - this.compEnv) * (dt / att);
      } else {
        this.compEnv += (abs - this.compEnv) * (dt / rel);
      }
      if (this.compEnv > this.config.compThr) {
        const over = this.compEnv - this.config.compThr;
        const ratio = this.config.compRatio || 2;
        const reduction = over * (1 - 1 / ratio);
        const compGain = (this.compEnv - reduction) / this.compEnv;
        sample *= compGain;
      }
      // Makeup gain
      sample *= this.config.compMakeup || 1.2;
    }

    // 3. SATURATION: Add warmth and harmonics
    if (this.drive > 1.0) {
      sample = fastTanh(sample * this.drive);
    }

    return sample * this.gain;
  }
}

// ─── Master chain (glue compression + saturation + limiter) ───────────────────────────────────

class MasterChain {
  constructor() {
    this.gain = 0.92;
    this.ceiling = 0.95;
    // Envelope follower for limiter
    this.env = 0;
    this.attack = 0.0005;  // 0.5ms — fast catch
    this.release = 0.08;   // 80ms — musical release
    // Glue compression state (simple RMS-based)
    this.glueEnv = 0;
    this.glueThr = 0.6;
    this.glueRatio = 2.5;
    this.glueAttack = 0.005;   // 5ms
    this.glueRelease = 0.15;   // 150ms
    // Makeup gain after glue
    this.makeup = 1.25;
  }

  process(sample, sr) {
    const dt = 1 / sr;

    // 1. GLUE COMPRESSION: Simple RMS-based compressor that "glues" the mix together.
    //    Without glue, the mix sounds like isolated sounds sitting next to each other.
    //    With glue, it sounds like a cohesive track. This is the #1 missing element.
    const abs = Math.abs(sample);
    if (abs > this.glueEnv) {
      this.glueEnv += (abs - this.glueEnv) * (dt / this.glueAttack);
    } else {
      this.glueEnv += (abs - this.glueEnv) * (dt / this.glueRelease);
    }
    let glueGain = 1;
    if (this.glueEnv > this.glueThr) {
      const over = this.glueEnv - this.glueThr;
      const reduction = over * (1 - 1 / this.glueRatio);
      glueGain = (this.glueEnv - reduction) / this.glueEnv;
    }
    let s = sample * glueGain * this.makeup;

    // 2. SATURATION: Mix of dry + tanh-saturated (adds harmonic richness)
    //    This is what makes the master sound "loud" and "warm" rather than "clean"
    s = fastTanh(s * 1.2) * 0.7 + s * 0.3;

    // 3. LIMITER: Fast envelope-follower limiter (prevents clipping)
    const absS = Math.abs(s);
    if (absS > this.env) {
      this.env += (absS - this.env) * (dt / this.attack);
    } else {
      this.env += (absS - this.env) * (dt / this.release);
    }
    let limGain = 1;
    if (this.env > this.ceiling) {
      limGain = this.ceiling / this.env;
    }
    s *= limGain * this.gain;

    return Math.max(-1, Math.min(1, s));
  }
}

// ─── Main Engine Processor ─────────────────────────────────────────────────

class Psy4EngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate;

    // Transport
    this.playing = false;
    this.bpm = 142;
    this.step = 0;
    this.nextStepSample = 0;  // in samples from start
    this.currentSample = 0;  // total samples processed

    // Event ring buffer (Float64Array for precise timing)
    // Each event: [time, voice, note, velocity, duration, param]
    this.eventBuffer = new Float64Array(MAX_EVENTS * EVENT_SIZE);
    this.eventTimes = new Float64Array(MAX_EVENTS);
    this.eventWriteIdx = 0;
    this.eventReadIdx = 0;
    this.eventCount = 0;

    // Voice pools (preallocated — no per-hit allocation)
    this.kickPool = [];
    this.bassPool = [];
    this.leadPool = [];
    this.acidPool = [];
    this.padPool = [];
    this.hatPool = [];
    this.clapPool = [];
    this.percPool = [];
    this.shakerPool = [];
    this.texturePool = [];
    this.fxPool = [];
    for (let i = 0; i < 8; i++) this.kickPool.push(new KickVoice());
    for (let i = 0; i < 4; i++) this.bassPool.push(new BassVoice());
    for (let i = 0; i < 8; i++) this.leadPool.push(new LeadVoice());
    for (let i = 0; i < 4; i++) this.acidPool.push(new AcidVoice());
    for (let i = 0; i < 4; i++) this.padPool.push(new PadVoice());
    for (let i = 0; i < 8; i++) this.hatPool.push(new HatVoice());
    for (let i = 0; i < 4; i++) this.clapPool.push(new ClapVoice());
    for (let i = 0; i < 8; i++) this.percPool.push(new PercVoice());
    for (let i = 0; i < 4; i++) this.shakerPool.push(new ShakerVoice());
    for (let i = 0; i < 4; i++) this.texturePool.push(new TextureVoice());
    for (let i = 0; i < 8; i++) this.fxPool.push(new FXVoice());

    // ── SAMPLE VOICE POOLS (for real PSY3 sample playback) ──
    // Separate pools for sample-based voices (kick sample, hat sample, clap sample)
    // These play the actual PSY3 WAV data for professional sound quality.
    this.kickSamplePool = [];
    this.hatSamplePool = [];
    this.clapSamplePool = [];
    // Increased pool size — bass, lead, and perc also use kickSamplePool now
    for (let i = 0; i < 16; i++) this.kickSamplePool.push(new SampleVoice());
    for (let i = 0; i < 8; i++) this.hatSamplePool.push(new SampleVoice());
    for (let i = 0; i < 4; i++) this.clapSamplePool.push(new SampleVoice());

    // Sample bank (loaded from main thread via ArrayBuffer transfer)
    this.samples = {};  // { name: { data, sampleRate, category } }
    this.samplesReady = false;

    // Round robin counters (for variation — avoid machine-gun effect)
    this.rrCounters = { kick: 0, hat: 0, clap: 0 };
    this.logCounter = 0; // for sample usage logging
    this.sampleUsage = {}; // tracks which samples actually played (name → hit count)

    // ── FX SENDS: Reverb + Delay (the key to "produced" sound) ──
    // A dry mix sounds flat/amateur. These are SEND effects — voices
    // send a portion of their signal here, and the FX output feeds master.
    this.reverb = new SchroederReverb();
    this.delay = new StereoDelay();
    // Per-bus send amounts: [drum, bass, music, atmos, fx]
    // Bass/kick send very little (keep them dry/punchy). Music/atmos send more.
    // [drum, bass, music, atmos, fx] — INCREASED for more space/depth
    // The mix was too dry. Commercial psytrance has significant reverb/delay.
    this.reverbSends = [0.12, 0.03, 0.35, 0.50, 0.35];
    this.delaySends = [0.08, 0.0, 0.25, 0.15, 0.20];

    // Master chain
    this.master = new MasterChain();

    // Bus gains (drum, bass, music, atmos, fx)
    // Bus gains (drum, bass, music, atmos, fx)
    this.busGains = [1.0, 1.0, 1.0, 0.8, 0.7];

    // ── BUS PROCESSORS — per-bus compression + saturation + EQ ──
    // This is what makes the mix sound "produced" instead of "isolated sounds"
    this.drumBusProc = new BusProcessor({
      hpFreq: 0,           // don't HP the drum bus (kick needs sub)
      compThr: 0.5,        // compress drums for punch
      compRatio: 3,        // aggressive ratio for drums
      compAtt: 0.002,      // 2ms — fast catch
      compRel: 0.08,       // 80ms — musical release
      compMakeup: 1.3,     // makeup after compression
      drive: 1.3,          // warm saturation on drums
      gain: 1.0,
    });
    this.bassBusProc = new BusProcessor({
      hpFreq: 25,          // HP at 25Hz — remove subsonic mud
      compThr: 0.4,        // compress bass for consistency
      compRatio: 2,        // gentle ratio for bass
      compAtt: 0.005,      // 5ms — let transient through
      compRel: 0.12,       // 120ms — smooth release
      compMakeup: 1.15,    // modest makeup
      drive: 1.2,          // subtle warmth
      gain: 1.0,
    });
    this.musicBusProc = new BusProcessor({
      hpFreq: 80,          // HP at 80Hz — keep music out of bass territory
      compThr: 0.45,       // glue compression for lead/acid
      compRatio: 2,        // gentle glue
      compAtt: 0.01,       // 10ms — slow, transparent
      compRel: 0.15,       // 150ms — smooth
      compMakeup: 1.1,     // subtle makeup
      drive: 1.15,         // very subtle warmth
      gain: 1.0,
    });
    this.atmosBusProc = new BusProcessor({
      hpFreq: 60,          // HP at 60Hz — atmos doesn't need sub
      compThr: 0,          // no compression — atmos should be open
      drive: 1.0,          // no saturation — keep it clean
      gain: 1.0,
    });
    this.fxProc = new BusProcessor({
      hpFreq: 40,          // HP at 40Hz
      compThr: 0.35,       // compress FX for consistency
      compRatio: 2.5,
      compAtt: 0.003,
      compRel: 0.1,
      compMakeup: 1.2,
      drive: 1.2,
      gain: 1.0,
    });

    // Sidechain state
    this.duckEnv = 1.0;
    this.duckDepth = 0.5;
    this.duckRelease = 0.12;

    // World params (updated from main thread)
    this.worldParams = {
      kickFundamental: 50, kickDecay: 0.2,
      bassCutoff: 150, bassResonance: 3,
      leadCutoff: 1800, leadDetune: 10,
      padCutoff: 1200, padAttack: 0.5, padDetune: 7, padEvolveRate: 0.1,
      duck: 0.4,
    };

    // Macros
    this.macros = {
      energy: 0.6, psychedelia: 0.55, darkness: 0.4, density: 0.55,
      groove: 0.5, evolution: 0.5, space: 0.4, surprise: 0.3,
      aggression: 0.4, brightness: 0.55,
    };

    // Stats for reporting back to main thread
    this.statsTimer = 0;
    this.activeVoiceCount = 0;

    // Command handler
    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'play':
        this.playing = true;
        this.step = 0;
        this.currentSample = 0;
        this.nextStepSample = 0;
        break;
      case 'stop':
        this.playing = false;
        // Deactivate all voices
        for (const pool of [this.kickPool, this.bassPool, this.leadPool, this.acidPool, this.padPool, this.hatPool, this.clapPool, this.percPool, this.shakerPool, this.texturePool, this.fxPool]) {
          for (const v of pool) v.active = false;
        }
        break;
      case 'bpm':
        this.bpm = msg.bpm;
        break;
      case 'macros':
        this.macros = { ...this.macros, ...msg.macros };
        break;
      case 'world':
        this.worldParams = { ...this.worldParams, ...msg.params };
        break;
      case 'setFX':
        // Adjust reverb/delay sends based on section (automation)
        // msg.reverbSends and msg.delaySends are arrays of 5 values
        if (msg.reverbSends) this.reverbSends = msg.reverbSends;
        if (msg.delaySends) this.delaySends = msg.delaySends;
        if (msg.reverbWet !== undefined) this.reverb.setWet(msg.reverbWet);
        if (msg.delayWet !== undefined) this.delay.setWet(msg.delayWet);
        if (msg.delayFeedback !== undefined) this.delay.setFeedback(msg.delayFeedback);
        break;
      case 'events':
        // Batch of events from main thread
        this.enqueueEvents(msg.events);
        break;
      case 'trigger':
        // Single immediate event
        this.enqueueEvent(msg.time, msg.voice, msg.note, msg.velocity, msg.duration, msg.param);
        break;
      case 'duck':
        // Trigger sidechain duck
        this.duckEnv = 1 - this.duckDepth * (0.5 + this.macros.aggression * 0.5);
        break;
      case 'panic':
        // Kill all voices
        for (const pool of [this.kickPool, this.bassPool, this.leadPool, this.acidPool, this.padPool, this.hatPool, this.clapPool, this.percPool, this.shakerPool, this.texturePool, this.fxPool, this.kickSamplePool, this.hatSamplePool, this.clapSamplePool]) {
          for (const v of pool) v.active = false;
        }
        break;
      case 'newPhrase':
        // Rotate phrase-locked samples at phrase boundaries
        // This gives sonic consistency (same kick for 8 bars) then variation
        this.phraseKickIdx = (this.phraseKickIdx || 0) + 1;
        this.phraseHatIdx = (this.phraseHatIdx || 0) + 1;
        this.phraseClapIdx = (this.phraseClapIdx || 0) + 1;
        this.phrasePercIdx = (this.phrasePercIdx || 0) + 1;
        this.phraseLeadIdx = (this.phraseLeadIdx || 0) + 1;
        break;
      case 'loadSamples':
        // Receive sample data from main thread (ArrayBuffer transfer)
        // msg.samples = [{ name, category, subcategory, sampleRate, data: Float32Array }]
        if (msg.samples) {
          for (const s of msg.samples) {
            this.samples[s.name] = {
              data: s.data,
              sampleRate: s.sampleRate,
              category: s.category,
              subcategory: s.subcategory,
            };
          }
          this.samplesReady = Object.keys(this.samples).length > 0;
          console.log('[PSY4 Engine] Samples loaded:', Object.keys(this.samples).length);
        }
        break;
    }
  }

  // ─── Event queue (lock-free ring buffer) ──────────────────────
  enqueueEvent(time, voice, note, velocity, duration, param) {
    if (this.eventCount >= MAX_EVENTS) return; // drop if full
    const idx = this.eventWriteIdx;
    const base = idx * EVENT_SIZE;
    this.eventBuffer[base] = time;
    this.eventBuffer[base + 1] = voice;
    this.eventBuffer[base + 2] = note;
    this.eventBuffer[base + 3] = velocity;
    this.eventBuffer[base + 4] = duration;
    this.eventBuffer[base + 5] = param;
    this.eventWriteIdx = (idx + 1) % MAX_EVENTS;
    this.eventCount++;
  }

  enqueueEvents(events) {
    // events is a Float64Array of [time, voice, note, vel, dur, param, time, voice, ...]
    const n = events.length / EVENT_SIZE;
    for (let i = 0; i < n; i++) {
      if (this.eventCount >= MAX_EVENTS) break;
      const base = i * EVENT_SIZE;
      this.enqueueEvent(
        events[base], events[base + 1], events[base + 2],
        events[base + 3], events[base + 4], events[base + 5]
      );
    }
  }

  // ─── Trigger a voice from the event queue ─────────────────────
  triggerVoice(voiceId, note, velocity, duration, param) {
    const sr = this.sr;
    const wp = this.worldParams;
    const mc = this.macros;
    const t = 0; // relative time — voice uses its own internal clock

    switch (voiceId) {
      case V_KICK: {
        // PHRASE-LOCKED KICK: Keep the same kick for 8 bars (sonic consistency)
        // Commercial tracks don't change kick every hit — they keep it for phrases.
        // The main thread sends 'newPhrase' messages at phrase boundaries to rotate.
        if (this.samplesReady) {
          const kickNames = Object.keys(this.samples).filter(n => this.samples[n].category === 'kick');
          const realKickNames = kickNames.filter(n => n.startsWith('nord') || n.startsWith('909') || n.startsWith('real'));
          const selectedNames = realKickNames.length > 0 ? realKickNames : kickNames;

          if (selectedNames.length > 0) {
            // PHRASE LOCK: Use the same kick sample for the entire phrase
            // Only rotate when this.phraseKickIdx changes (set by 'newPhrase' message)
            if (this.phraseKickIdx === undefined || this.phraseKickIdx >= selectedNames.length) {
              this.phraseKickIdx = 0;
            }
            const kickName = selectedNames[this.phraseKickIdx];
            const v = this.getFreeVoice(this.kickSamplePool);
            if (v) {
              const samp = this.samples[kickName];
              // Micro variation: ±0.3% pitch, ±3% gain (imperceptible but organic)
              const microVar = (this.rrCounters.kick % 4 - 1.5);
              const pitchVar = 1.0 + microVar * 0.002;
              const gainVar = 1.0 + microVar * 0.03;
              this.rrCounters.kick = (this.rrCounters.kick + 1) % 4;
              v.trigger(samp.data, samp.sampleRate, pitchVar, velocity * gainVar, wp.kickDecay, 0);
              // TRACK: which sample actually played
              this.sampleUsage[kickName] = (this.sampleUsage[kickName] || 0) + 1;
            }
          } else {
            const v = this.getFreeVoice(this.kickPool);
            if (v) v.trigger(t, velocity, wp.kickFundamental, wp.kickDecay, sr);
          }
        } else {
          const v = this.getFreeVoice(this.kickPool);
          if (v) v.trigger(t, velocity, wp.kickFundamental, wp.kickDecay, sr);
        }
        // Trigger sidechain
        this.duckEnv = 1 - wp.duck * (0.5 + mc.aggression * 0.5);
        break;
      }
      case V_BASS: {
        // PURE SYNTH BASS — square wave (Astrix style) with short 120ms decay
        // Removed bass_A.wav (PSY3 sample — not a sound quality reference)
        // The square wave + Moog filter + short envelope IS the commercial bass sound
        const v = this.getFreeVoice(this.bassPool);
        if (v) v.trigger(t, note, duration, velocity, false, sr, {
          cutoffStart: 800, cutoffEnd: 200, resonance: 2,
        });
        break;
      }
      case V_LEAD: {
        // PURE SYNTH LEAD — supersaw through Moog filter with LFO modulation
        // Removed MachineDrum stabs (drum stabs are NOT leads — they're percussion)
        // The supersaw + filter + modulation IS the lead sound
        const v = this.getFreeVoice(this.leadPool);
        if (v) v.trigger(t, note, duration, velocity, sr, {
          cutoff: wp.leadCutoff * (0.7 + mc.brightness * 0.6),
          detune: wp.leadDetune * (0.5 + mc.psychedelia),
          resonance: 2 + mc.psychedelia * 3,
          lfoRate: 0.5 + mc.psychedelia * 3,
          lfoDepth: mc.psychedelia * 0.3,
        });
        break;
      }
      case V_ACID: {
        const v = this.getFreeVoice(this.acidPool);
        if (v) v.trigger(t, note, duration, velocity, sr);
        break;
      }
      case V_PAD: {
        const v = this.getFreeVoice(this.padPool);
        if (v) v.trigger(t, note, duration, velocity, sr, {
          cutoff: wp.padCutoff, attack: wp.padAttack, detune: wp.padDetune, evolveRate: wp.padEvolveRate,
        });
        break;
      }
      case V_HAT: {
        // PHRASE-LOCKED HAT: Same hat sample for entire phrase (sonic consistency)
        if (this.samplesReady) {
          const hatNames = Object.keys(this.samples).filter(n => this.samples[n].category === 'hat');
          const realHatNames = hatNames.filter(n => n.startsWith('md_') || n.startsWith('nord') || n.startsWith('909') || n.startsWith('real/'));
          const names = realHatNames.length > 0 ? realHatNames : hatNames;
          if (names.length > 0) {
            if (this.phraseHatIdx === undefined || this.phraseHatIdx >= names.length) this.phraseHatIdx = 0;
            const hatName = names[this.phraseHatIdx];
            const v = this.getFreeVoice(this.hatSamplePool);
            if (v) {
              const samp = this.samples[hatName];
              // Micro variation (not sample rotation)
              const microVar = (this.rrCounters.hat % 4 - 1.5);
              const pitchVar = 1.0 + microVar * 0.003;
              const panVar = microVar * 0.03;
              this.rrCounters.hat = (this.rrCounters.hat + 1) % 4;
              v.trigger(samp.data, samp.sampleRate, pitchVar, velocity, 0.04, panVar);
              this.sampleUsage[hatName] = (this.sampleUsage[hatName] || 0) + 1;
            }
          } else {
            const v = this.getFreeVoice(this.hatPool);
            if (v) v.trigger(t, false, velocity, sr);
          }
        } else {
          const v = this.getFreeVoice(this.hatPool);
          if (v) v.trigger(t, false, velocity, sr);
        }
        break;
      }
      case V_HAT_OPEN: {
        // Use REAL open hat sample — cycle through variants
        if (this.samplesReady) {
          const openNames = Object.keys(this.samples).filter(n => n.startsWith('hat_open'));
          const names = openNames.length > 0 ? openNames : ['hat_open.wav'];
          if (this.samples[names[0]]) {
            const hatName = names[this.rrCounters.hat % names.length];
            const v = this.getFreeVoice(this.hatSamplePool);
            if (v) {
              const samp = this.samples[hatName];
              this.rrCounters.hat = (this.rrCounters.hat + 1) % Math.max(8, names.length);
              const pitchVar = 1.0 + (this.rrCounters.hat % 8 - 3.5) * 0.005;
              const panVar = (this.rrCounters.hat % 8 - 3.5) * 0.04;
              v.trigger(samp.data, samp.sampleRate, pitchVar, velocity, 0.2, panVar);
            }
          } else {
            const v = this.getFreeVoice(this.hatPool);
            if (v) v.trigger(t, true, velocity, sr);
          }
        } else {
          const v = this.getFreeVoice(this.hatPool);
          if (v) v.trigger(t, true, velocity, sr);
        }
        break;
      }
      case V_CLAP: {
        // PHRASE-LOCKED CLAP: Same clap/snare for entire phrase
        if (this.samplesReady) {
          const clapNames = Object.keys(this.samples).filter(n => this.samples[n].category === 'clap');
          const realClapNames = clapNames.filter(n => n.startsWith('nord') || n.startsWith('909') || n.startsWith('real') || n.startsWith('md_'));
          const names = realClapNames.length > 0 ? realClapNames : clapNames;
          if (names.length > 0) {
            if (this.phraseClapIdx === undefined || this.phraseClapIdx >= names.length) this.phraseClapIdx = 0;
            const clapName = names[this.phraseClapIdx];
            const v = this.getFreeVoice(this.clapSamplePool);
            if (v) {
              const samp = this.samples[clapName];
              const microVar = (this.rrCounters.clap % 4 - 1.5);
              const pitchVar = 1.0 + microVar * 0.002;
              const gainVar = 1.0 + microVar * 0.02;
              this.rrCounters.clap = (this.rrCounters.clap + 1) % 4;
              v.trigger(samp.data, samp.sampleRate, pitchVar, velocity * gainVar, 0.15, 0);
              this.sampleUsage[clapName] = (this.sampleUsage[clapName] || 0) + 1;
            }
          } else {
            const v = this.getFreeVoice(this.clapPool);
            if (v) v.trigger(t, velocity, sr);
          }
        } else {
          const v = this.getFreeVoice(this.clapPool);
          if (v) v.trigger(t, velocity, sr);
        }
        break;
      }
      case V_PERC: {
        // Use REAL percussion samples when available (Nord Drum)
        if (this.samplesReady) {
          const percNames = Object.keys(this.samples).filter(n => this.samples[n].category === 'perc');
          const realPercNames = percNames.filter(n => n.startsWith('nord') || n.startsWith('909') || n.startsWith('real'));
          const names = realPercNames.length > 0 ? realPercNames : percNames;
          if (names.length > 0) {
            const percName = names[this.rrCounters.clap % names.length]; // reuse clap counter for perc RR
            const v = this.getFreeVoice(this.kickSamplePool); // reuse sample voice pool for perc
            if (v) {
              const samp = this.samples[percName];
              this.rrCounters.clap = (this.rrCounters.clap + 1) % Math.max(4, names.length);
              v.trigger(samp.data, samp.sampleRate, 1.0, velocity, 0.1, 0.3);
              // TRACK: which sample actually played
              this.sampleUsage[percName] = (this.sampleUsage[percName] || 0) + 1;
            }
          } else {
            const v = this.getFreeVoice(this.percPool);
            if (v) v.trigger(t, note || 400, velocity, sr);
          }
        } else {
          const v = this.getFreeVoice(this.percPool);
          if (v) v.trigger(t, note || 400, velocity, sr);
        }
        break;
      }
      case V_SHAKER: {
        const v = this.getFreeVoice(this.shakerPool);
        if (v) v.trigger(t, velocity, sr);
        break;
      }
      case V_TEXTURE: {
        const v = this.getFreeVoice(this.texturePool);
        if (v) v.trigger(t, duration, velocity, param >= 0.5 ? 'noise' : 'fm', sr);
        break;
      }
      case V_RISER: case V_IMPACT: case V_SWEEP: case V_ZAP: case V_BLIP: case V_DOWNLIFTER: {
        const v = this.getFreeVoice(this.fxPool);
        if (v) v.trigger(voiceId, t, duration, velocity, sr);
        break;
      }
    }
  }

  getFreeVoice(pool) {
    for (const v of pool) {
      if (!v.active) return v;
    }
    // Voice stealing: return the oldest (first in pool)
    return pool[0];
  }

  // ─── Process callback (called by audio thread every 128 samples) ───
  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const L = output[0];
    const R = output[1] || output[0];
    const sr = this.sr;
    const dt = 1 / sr;

    // Process events that are due (time <= current audio time)
    const currentAudioTime = currentFrame / sr;
    while (this.eventCount > 0) {
      const idx = this.eventReadIdx;
      const base = idx * EVENT_SIZE;
      const eventTime = this.eventBuffer[base];
      if (eventTime > currentAudioTime + 0.001) break; // not yet
      this.triggerVoice(
        this.eventBuffer[base + 1], // voice
        this.eventBuffer[base + 2], // note
        this.eventBuffer[base + 3], // velocity
        this.eventBuffer[base + 4], // duration
        this.eventBuffer[base + 5]  // param
      );
      this.eventReadIdx = (idx + 1) % MAX_EVENTS;
      this.eventCount--;
    }

    // Render audio sample by sample
    // Count active voices once per block (not per sample)
    let activeCount = 0;
    for (const pool of [this.kickPool, this.bassPool, this.leadPool, this.acidPool, this.padPool, this.hatPool, this.clapPool, this.percPool, this.shakerPool, this.texturePool, this.fxPool, this.kickSamplePool, this.hatSamplePool, this.clapSamplePool]) {
      for (const v of pool) { if (v.active) activeCount++; }
    }
    this.activeVoiceCount = activeCount;

    // Stereo buses: L and R per group
    // Kick/bass/sub stay mono (center), hats/clap/perc/lead/pad/texture/FX have stereo width
    for (let i = 0; i < L.length; i++) {
      this.currentSample++;

      // Sidechain envelope — REAL envelope with fast attack + musical release
      // When kick fires, duckEnv drops immediately, then recovers smoothly.
      // This creates the "pumping" groove that is THE defining characteristic of psytrance.
      if (this.duckEnv < 1) {
        // Exponential recovery — fast at first, then gradual
        // This matches how real sidechain compression behaves
        this.duckEnv += (1 - this.duckEnv) * (dt / 0.08);  // 80ms time constant
      }

      // Mix all active voices into stereo buses
      let drumBusL = 0, drumBusR = 0;
      let bassBusL = 0, bassBusR = 0;
      let musicBusL = 0, musicBusR = 0;
      let atmosBusL = 0, atmosBusR = 0;
      let fxBusL = 0, fxBusR = 0;

      // ── SAMPLE-BASED VOICES (stereo via pan) ──
      // Kick sample → drum bus (mono — kick stays center for phase coherence)
      for (const v of this.kickSamplePool) {
        if (v.active) {
          const [sl, sr2, done] = v.renderStereo(currentAudioTime + i * dt, sr);
          drumBusL += sl; drumBusR += sr2;
        }
      }
      // Hat samples → drum bus (stereo with pan variation)
      for (const v of this.hatSamplePool) {
        if (v.active) {
          const [sl, sr2, done] = v.renderStereo(currentAudioTime + i * dt, sr);
          drumBusL += sl; drumBusR += sr2;
        }
      }
      // Clap samples → drum bus (stereo)
      for (const v of this.clapSamplePool) {
        if (v.active) {
          const [sl, sr2, done] = v.renderStereo(currentAudioTime + i * dt, sr);
          drumBusL += sl; drumBusR += sr2;
        }
      }

      // ── SYNTH VOICES (mono → route to both L and R) ──
      // Kick synth → drum bus (mono)
      for (const v of this.kickPool) {
        if (v.active) {
          const [s] = v.render(currentAudioTime + i * dt, sr);
          drumBusL += s; drumBusR += s;
        }
      }
      // Hat synth → drum bus (mono for now)
      for (const v of this.hatPool) {
        if (v.active) {
          const [s] = v.render(currentAudioTime + i * dt, sr);
          drumBusL += s; drumBusR += s;
        }
      }
      // Clap synth → drum bus (mono)
      for (const v of this.clapPool) {
        if (v.active) {
          const [s] = v.render(currentAudioTime + i * dt, sr);
          drumBusL += s; drumBusR += s;
        }
      }
      // Perc → drum bus (mono — pan applied later if needed)
      for (const v of this.percPool) {
        if (v.active) {
          const [s] = v.render(currentAudioTime + i * dt, sr);
          drumBusL += s; drumBusR += s;
        }
      }
      // Shaker → drum bus (mono)
      for (const v of this.shakerPool) {
        if (v.active) {
          const [s] = v.render(currentAudioTime + i * dt, sr);
          drumBusL += s; drumBusR += s;
        }
      }

      // Bass → bass bus (mono — sidechain ducked by kick)
      for (const v of this.bassPool) {
        if (v.active) {
          const [s] = v.render(currentAudioTime + i * dt, sr);
          const ducked = s * this.duckEnv;  // ONLY bass gets sidechain
          bassBusL += ducked; bassBusR += ducked;
        }
      }

      // Lead → music bus (NO sidechain — lead doesn't duck from kick)
      for (const v of this.leadPool) {
        if (v.active) {
          const [s] = v.render(currentAudioTime + i * dt, sr);
          musicBusL += s; musicBusR += s;  // no duckEnv
        }
      }
      // Acid → music bus (NO sidechain)
      for (const v of this.acidPool) {
        if (v.active) {
          const [s] = v.render(currentAudioTime + i * dt, sr);
          musicBusL += s; musicBusR += s;  // no duckEnv
        }
      }

      // Pad → atmos bus (stereo width — detuned saws already create natural width)
      for (const v of this.padPool) {
        if (v.active) {
          const [s] = v.render(currentAudioTime + i * dt, sr);
          // Slight stereo offset for pad width
          atmosBusL += s; atmosBusR += s;
        }
      }
      // Texture → atmos bus (stereo)
      for (const v of this.texturePool) {
        if (v.active) {
          const [s] = v.render(currentAudioTime + i * dt, sr);
          atmosBusL += s; atmosBusR += s;
        }
      }

      // FX → fx bus (mono)
      for (const v of this.fxPool) {
        if (v.active) {
          const [s] = v.render(currentAudioTime + i * dt, sr);
          fxBusL += s; fxBusR += s;
        }
      }

      // ── BUS PROCESSING — each bus gets compression + saturation + EQ ──
      // This is what makes the mix sound "produced" — without it, it's isolated sounds.
      // Process L and R separately for stereo.
      drumBusL = this.drumBusProc.process(drumBusL, sr);
      drumBusR = this.drumBusProc.process(drumBusR, sr);
      bassBusL = this.bassBusProc.process(bassBusL, sr);
      bassBusR = this.bassBusProc.process(bassBusR, sr);
      musicBusL = this.musicBusProc.process(musicBusL, sr);
      musicBusR = this.musicBusProc.process(musicBusR, sr);
      atmosBusL = this.atmosBusProc.process(atmosBusL, sr);
      atmosBusR = this.atmosBusProc.process(atmosBusR, sr);
      fxBusL = this.fxProc.process(fxBusL, sr);
      fxBusR = this.fxProc.process(fxBusR, sr);

      // Sum buses with gains (stereo)
      let mixL = drumBusL * this.busGains[0]
               + bassBusL * this.busGains[1]
               + musicBusL * this.busGains[2]
               + atmosBusL * this.busGains[3]
               + fxBusL * this.busGains[4];
      let mixR = drumBusR * this.busGains[0]
               + bassBusR * this.busGains[1]
               + musicBusR * this.busGains[2]
               + atmosBusR * this.busGains[3]
               + fxBusR * this.busGains[4];

      // ── FX SENDS: Reverb + Delay ──
      // Send portions of each bus to reverb and delay (parallel sends)
      // The FX outputs are added to the master mix, creating space and depth.
      const reverbInput = (drumBusL + drumBusR) * 0.5 * this.reverbSends[0]
                        + (bassBusL + bassBusR) * 0.5 * this.reverbSends[1]
                        + (musicBusL + musicBusR) * 0.5 * this.reverbSends[2]
                        + (atmosBusL + atmosBusR) * 0.5 * this.reverbSends[3]
                        + (fxBusL + fxBusR) * 0.5 * this.reverbSends[4];
      const [revL, revR] = this.reverb.process(reverbInput, sr);

      const delayInputL = drumBusL * this.delaySends[0]
                        + bassBusL * this.delaySends[1]
                        + musicBusL * this.delaySends[2]
                        + atmosBusL * this.delaySends[3]
                        + fxBusL * this.delaySends[4];
      const delayInputR = drumBusR * this.delaySends[0]
                        + bassBusR * this.delaySends[1]
                        + musicBusR * this.delaySends[2]
                        + atmosBusR * this.delaySends[3]
                        + fxBusR * this.delaySends[4];
      const [delL, delR] = this.delay.process(delayInputL, delayInputR, sr);

      // Add FX returns to master mix
      mixL += revL + delL;
      mixR += revR + delR;

      // Master processing (per channel)
      mixL = this.master.process(mixL, sr);
      mixR = this.master.process(mixR, sr);

      L[i] = mixL;
      R[i] = mixR;
    }

    // Report transport state to main thread (throttled ~10Hz)
    this.statsTimer += L.length / sr;
    if (this.statsTimer >= 0.1) {
      this.statsTimer = 0;
      this.port.postMessage({
        type: 'stats',
        playing: this.playing,
        step: this.step,
        activeVoices: this.activeVoiceCount,
        eventCount: this.eventCount,
        currentFrame: currentFrame,
        cpuLoad: this.activeVoiceCount / 64, // rough estimate
        // SAMPLE USAGE REPORT: which samples actually played
        sampleUsage: this.sampleUsage || {},
      });
    }

    return true;
  }
}

registerProcessor('psy4-engine', Psy4EngineProcessor);
