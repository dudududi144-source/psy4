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
    this.amp = 0.5;  // was 0.15 — lead was 22x quieter than kick
    this.saws = [new BLSaw(), new BLSaw(), new BLSaw(), new BLSaw(), new BLSaw()];
    this.octaveSaws = [new BLSaw(), new BLSaw(), new BLSaw()]; // octave-up layer
    this.filter = new MoogLadder();
    this.cutoff = 1800;
    this.res = 0.15;
    this.lfoPhase = 0;
    this.lfoRate = 0.8;
    this.lfoDepth = 0.3;
    this.detune = 10;
    this.noise = new PinkNoise(); // air/texture layer
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
    const n = this.saws.length;
    for (let i = 0; i < n; i++) {
      const cents = (i - (n - 1) / 2) * this.detune;
      const mult = Math.pow(2, cents / 1200);
      this.saws[i].setFreq(freq * mult);
    }
    // Octave-up layer — adds brightness and richness
    for (let i = 0; i < this.octaveSaws.length; i++) {
      this.octaveSaws[i].reset();
      const cents = (i - 1) * this.detune * 0.6;
      this.octaveSaws[i].setFreq(freq * 2 * Math.pow(2, cents / 1200));
    }
    this.filter.reset();
    this.noise.reset();
  }

  render(currentTime, sr) {
    if (!this.active) return [0, true];
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.dur + 0.05) { this.active = false; return [0, true]; }

    // BUG FIX: Use each saw's OWN frequency (set via setFreq in trigger) — NOT the base freq.
    // Previously used `const inc = this.freq / sr` for all saws, which ignored the detune
    // and made all saws play the same frequency. This made leadDetune a DEAD parameter.

    // Layer 1: Fundamental — 5 detuned saws
    let fundamental = 0;
    for (const s of this.saws) fundamental += s.process(s.freq / sr);
    fundamental /= this.saws.length;

    // Layer 2: Octave-up — 3 detuned saws at 2x freq (adds brightness/air)
    let octaveLayer = 0;
    for (const s of this.octaveSaws) octaveLayer += s.process(s.freq / sr);
    octaveLayer /= this.octaveSaws.length;

    // Layer 3: Air — pink noise through high-pass (adds "breath" and sheen)
    const noiseSample = this.noise.process();
    const air = (noiseSample - this.noise.prevOutput || 0) * 0.08; // differentiated = HP

    // Mix: fundamental dominant, octave at 30%, air at 8%
    let mix = fundamental * 0.7 + octaveLayer * 0.3 + air * 0.08;

    // LFO modulates filter cutoff (psychedelic movement)
    this.lfoPhase += this.lfoRate * dt;
    const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * this.lfoPhase);
    const modCutoff = this.cutoff * (1 + this.lfoDepth * (lfo * 2 - 1) * 0.5);

    // Filter envelope: open → settle
    const fEnv = this.cutoff * 2 * Math.exp(-this.t / (this.dur * 0.5)) + this.cutoff;
    const cutoff = Math.min(18000, Math.max(100, fEnv * 0.5 + modCutoff * 0.5));

    const filtered = this.filter.process(mix, cutoff, this.res, 1.5, sr);

    // SATURATION: Post-filter tanh — adds character and warmth
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
    this.lfoPhase = 0; // bidirectional filter movement
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
    this.res = 0.95; // near self-oscillation for squelch
    this.lfoPhase = 0;
  }

  render(currentTime, sr) {
    if (!this.active) return [0, true];
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.dur + 0.05) { this.active = false; return [0, true]; }

    const inc = this.freq / sr;
    const sq = this.square.process(inc);

    // BIDIRECTIONAL filter movement — envelope + LFO combined
    // Envelope: fast drop from high to low (classic acid)
    const envCutoff = (this.cutoffStart - this.cutoffEnd) * Math.exp(-this.t / (this.dur * 0.4)) + this.cutoffEnd;
    // LFO: slow sine that adds up-down movement on top of the envelope
    // This creates the "wobble" that real 303 acid has
    this.lfoPhase += 4.0 * dt; // 4Hz LFO
    const lfo = Math.sin(2 * Math.PI * this.lfoPhase);
    const cutoff = Math.max(80, envCutoff * (1 + lfo * 0.3)); // ±30% modulation

    const filtered = this.filter.process(sq, cutoff, 0.95, 3.0, sr);
    const distorted = fastTanh(filtered * 4); // heavy distortion

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
    this.saws = [new BLSaw(), new BLSaw(), new BLSaw()]; // 3 oscillators (was 2)
    this.filter = new MoogLadder();
    this.lfoPhase = 0;
    this.filterSweepPhase = 0; // slow filter sweep
  }

  trigger(time, freq, dur, amp, sr, params) {
    this.active = true;
    this.t = 0;
    this.dur = dur;
    this.amp = amp;
    this.freq = freq;
    this.cutoffBase = params?.cutoff ?? 1200;
    this.res = 0.08; // slightly higher resonance for filter movement
    this.attack = params?.attack ?? 0.5;
    this.detune = params?.detune ?? 7;
    this.evolveRate = params?.evolveRate ?? 0.1;
    this.lfoPhase = 0;
    this.filterSweepPhase = 0;
    for (const s of this.saws) { s.reset(); }
    // 3-osc detuned: -detune, center, +detune (wider than 2-osc)
    this.saws[0].setFreq(freq * Math.pow(2, -this.detune / 1200));
    this.saws[1].setFreq(freq);
    this.saws[2].setFreq(freq * Math.pow(2, this.detune / 1200));
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
    this.saws[1].setFreq(this.freq * detuneMod);
    this.saws[2].setFreq(this.freq * Math.pow(2, this.detune / 1200) * detuneMod);

    let mix = 0;
    // BUG FIX: use each saw's own frequency, not the shared base inc
    for (const s of this.saws) mix += s.process(s.freq / sr);
    mix /= this.saws.length;

    // SLOW FILTER SWEEP — cutoff moves up and down over the duration
    // This is what makes a pad "breathe" — without it, it's a static organ
    this.filterSweepPhase += 0.15 * dt; // 0.15Hz — very slow
    const sweep = 0.5 + 0.5 * Math.sin(2 * Math.PI * this.filterSweepPhase);
    const cutoff = this.cutoffBase * (0.6 + sweep * 0.8); // 60% to 140% of base

    const filtered = this.filter.process(mix, cutoff, this.res, 1.2, sr);

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

// ─── Voice: Perc (pitched sine with pitch envelope + saturation) ───────────
// BEFORE: bare sine with fixed frequency and decay = telephone bell.
// AFTER: sine with pitch envelope (descending) + saturation + Moog filter = tribal perc.

class PercVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.phase = 0;
    this.filter = new MoogLadder();
  }

  trigger(time, freq, amp, sr) {
    this.active = true;
    this.t = 0;
    this.freq = freq;
    this.amp = amp;
    this.phase = 0;
    this.filter.reset();
  }

  render(currentTime, sr) {
    if (!this.active) return [0, true];
    this.t += 1 / sr;
    if (this.t > 0.1) { this.active = false; return [0, true]; }

    // Pitch envelope: starts 1.5x higher, drops to fundamental
    const pitchEnv = 1.5 * Math.exp(-this.t / 0.01) + 0.5;
    this.phase += 2 * Math.PI * this.freq * pitchEnv / sr;
    const osc = Math.sin(this.phase);

    // Filter for body — LP at 800Hz with slight resonance
    const filtered = this.filter.process(osc, 800, 0.2, 1.5, sr);

    // Saturation for warmth
    const saturated = fastTanh(filtered * 1.8);

    const env = Math.exp(-this.t / 0.05);
    const sample = saturated * env * this.amp;
    return [sample, false];
  }
}

// ─── Voice: Shaker (filtered noise with proper HP + saturation) ────────────
// BEFORE: differentiated noise (primitive HP). Thin and digital.
// AFTER: noise through Moog HP + saturation = warm shaker with body.

class ShakerVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.noise = new PinkNoise();
    this.prevNoise = 0;
    this.filter = new MoogLadder(); // for HP shaping
  }

  trigger(time, amp, sr) {
    this.active = true;
    this.t = 0;
    this.amp = amp;
    this.noise.reset();
    this.prevNoise = 0;
    this.filter.reset();
  }

  render(currentTime, sr) {
    if (!this.active) return [0, true];
    this.t += 1 / sr;
    if (this.t > 0.08) { this.active = false; return [0, true]; }

    const n = this.noise.process();
    // HP via differentiation (fast)
    const hp = n - this.prevNoise;
    this.prevNoise = n;
    // Additional HP shaping through Moog (highpass approximation via lowpass inversion)
    const shaped = this.filter.process(hp, 6000, 0.1, 1.0, sr);
    // Saturation for warmth
    const saturated = fastTanh(shaped * 2.5);
    const env = Math.exp(-this.t / 0.03);
    const sample = saturated * env * 2 * this.amp;
    return [sample, false];
  }
}

// ─── Voice: Texture (multi-layer psychedelic evolving bed) ──────────────────
// BEFORE: FM sine or raw noise = siren or wind. Not psychedelic.
// AFTER: 3 layers — detuned osc bed + filtered noise + slow filter morph.
// Creates evolving atmospheric texture that sounds "psychedelic" not "generated".

class TextureVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.saw1 = new BLSaw();
    this.saw2 = new BLSaw();
    this.filter = new MoogLadder();
    this.noise = new PinkNoise();
    this.morphPhase = 0;
    this.noiseFilter = new MoogLadder(); // separate filter for noise layer
  }

  trigger(time, dur, amp, type, sr) {
    this.active = true;
    this.t = 0;
    this.dur = dur;
    this.amp = amp;
    this.type = type || 'fm';
    this.morphPhase = 0;
    this.saw1.reset();
    this.saw2.reset();
    this.filter.reset();
    this.noiseFilter.reset();
    this.noise.reset();
    // Detuned oscillators — slow evolving bed
    const baseFreq = 110 + Math.random() * 220;
    this.saw1.setFreq(baseFreq);
    this.saw2.setFreq(baseFreq * 1.01); // very slight detune
    this.baseFreq = baseFreq;
  }

  render(currentTime, sr) {
    if (!this.active) return [0, true];
    this.t += 1 / sr;
    if (this.t > this.dur + 0.1) { this.active = false; return [0, true]; }

    const dt = 1 / sr;
    const env = Math.min(1, this.t / 0.5) * Math.min(1, (this.dur - this.t) / 0.5);
    if (env <= 0) return [0, false];

    // Layer 1: Detuned saw bed — provides harmonic content
    const inc = this.baseFreq / sr;
    let oscBed = (this.saw1.process(inc) + this.saw2.process(inc)) * 0.3;

    // Layer 2: Filtered noise — provides "air" and texture
    const noiseSamp = this.noise.process();
    const noiseFiltered = this.noiseFilter.process(noiseSamp, 2000, 0.3, 1.0, sr) * 0.4;

    // Layer 3: Slow filter morph — cutoff moves up and down
    this.morphPhase += 0.3 * dt; // 0.3Hz morph
    const morph = 0.5 + 0.5 * Math.sin(2 * Math.PI * this.morphPhase);
    const morphCutoff = 300 + morph * 2000; // 300Hz to 2300Hz

    // Mix layers and apply morph filter
    let mix = oscBed + noiseFiltered;
    mix = this.filter.process(mix, morphCutoff, 0.15, 1.2, sr);

    // Saturation for warmth
    mix = fastTanh(mix * 1.3);

    return [mix * env * this.amp, false];
  }
}

// ─── Voice: FX (riser, impact, sweep, zap, blip, downlifter) ──────────────
// BEFORE: Riser = noise getting louder. Impact = sine going down. Primitive.
// AFTER: Riser = noise + filter sweep opening up. Impact = sub boom + noise burst.
//        Sweep = filtered noise with stereo movement. Each FX has more body.

class FXVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.noise = new PinkNoise();
    this.phase = 0;
    this.filter = new MoogLadder(); // filter for riser/sweep
  }

  trigger(type, time, dur, amp, sr) {
    this.active = true;
    this.type = type;
    this.t = 0;
    this.dur = dur || 0.3;
    this.amp = amp || 0.2;
    this.phase = 0;
    this.noise.reset();
    this.filter.reset();
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
        // Riser = noise through filter that opens up + amplitude rise
        // BEFORE: just noise * env. No filter, no character.
        const n = this.noise.process();
        // Filter opens from 200Hz to 8000Hz over the duration
        const cutoff = 200 + (t / this.dur) * 7800;
        const filtered = this.filter.process(n, cutoff, 0.2, 1.5, sr);
        // Amplitude rises exponentially (not linear)
        const env = Math.pow(t / this.dur, 2) * 0.35;
        sample = fastTanh(filtered * env * 3); // saturate for punch
        break;
      }
      case V_IMPACT: {
        // Impact = sub sine boom + noise burst (two layers)
        // BEFORE: just sine going down. No body, no texture.
        // Sub boom: sine from 120Hz to 35Hz with exp decay
        const f = 120 * Math.exp(-t / 0.15) + 35;
        this.phase += 2 * Math.PI * f * dt;
        const subEnv = Math.exp(-t / 0.2);
        const sub = Math.sin(this.phase) * subEnv * 0.7;
        // Noise burst: short percussive crack
        const n = this.noise.process();
        const noiseEnv = Math.exp(-t / 0.02); // 20ms crack
        const crack = n * noiseEnv * 0.3;
        sample = sub + crack;
        sample = fastTanh(sample * 1.5); // saturate
        break;
      }
      case V_SWEEP: {
        // Sweep = filtered noise with filter moving + amplitude curve
        // BEFORE: noise * sin envelope. No filter movement.
        const n = this.noise.process();
        // Filter sweeps from low to high and back
        const sweepPos = t / this.dur;
        const cutoff = 200 + Math.sin(Math.PI * sweepPos) * 4000 + 2000;
        const filtered = this.filter.process(n, cutoff, 0.3, 1.3, sr);
        const env = Math.sin(Math.PI * sweepPos) * 0.2;
        sample = filtered * env;
        break;
      }
      case V_ZAP: {
        // FM zap — carrier + modulator with exponential index decay
        const car = 880, mod = 1760;
        const idx = 3 * Math.exp(-t / 0.03);
        this.phase += 2 * Math.PI * (car + idx * Math.sin(2 * Math.PI * mod * t)) * dt;
        const env = Math.exp(-t / 0.04);
        sample = Math.sin(this.phase) * env;
        sample = fastTanh(sample * 2); // saturate for grit
        break;
      }
      case V_BLIP: {
        // Pure sine blip with pitch envelope (descending)
        const f = 1200 * Math.exp(-t / 0.01) + 400;
        this.phase += 2 * Math.PI * f * dt;
        const env = Math.exp(-t / 0.02);
        sample = Math.sin(this.phase) * env;
        break;
      }
      case V_DOWNLIFTER: {
        // Downlifter = saw wave with descending pitch + filter closing
        const f = 800 * Math.exp(-t / 0.15) + 100;
        this.phase += 2 * Math.PI * f * dt;
        const saw = 2 * (this.phase / (2 * Math.PI) % 1) - 1; // naive saw
        const cutoff = 3000 * Math.exp(-t / 0.2) + 200;
        const filtered = this.filter.process(saw, cutoff, 0.1, 1.0, sr);
        const env = Math.exp(-t / 0.2);
        sample = filtered * env * 0.4;
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
    this.gain = 1.0;
    this.ceiling = 0.90;     // was 0.98 — leave headroom, prevent clipping
    this.env = 0;
    this.attack = 0.0003;
    this.release = 0.06;
    this.glueEnv = 0;
    this.glueThr = 0.60;     // was 0.50 — less compression, more dynamics
    this.glueRatio = 2.5;    // was 3.5 — gentler ratio
    this.glueAttack = 0.004;
    this.glueRelease = 0.12;
    this.makeup = 1.0;       // was 1.5 — no makeup gain (was causing -0.7 LUFS)
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

    // Master chain — SEPARATE instances for L and R (shared state = stereo bug)
    this.masterL = new MasterChain();
    this.masterR = new MasterChain();

    // Bus gains (drum, bass, music, atmos, fx)
    // REBALANCED for proper mix: kick lower, music higher (lead+pad now audible)
    this.busGains = [0.85, 1.0, 1.0, 0.85, 0.65];

    // ── BUS PROCESSORS — SEPARATE L and R instances ──
    // CRITICAL FIX: Previously L and R shared the same instance, which meant
    // the compressor envelope was shared. This caused the stereo image to
    // collapse and created uneven pumping. Now each channel has its own.
    const drumConfig = {
      hpFreq: 0, compThr: 0.5, compRatio: 3, compAtt: 0.002, compRel: 0.08,
      compMakeup: 1.4,      // was 1.3 — hotter drums
      drive: 1.4,           // was 1.3 — more saturation
      gain: 1.0,
    };
    const bassConfig = {
      hpFreq: 40,          // HP at 40Hz (was 25) — prevent bass/kick sub collision
      compThr: 0.4, compRatio: 2, compAtt: 0.005, compRel: 0.12,
      compMakeup: 1.2,     // was 1.15 — slightly hotter
      drive: 1.2, gain: 1.0,
    };
    const musicConfig = {
      hpFreq: 80, compThr: 0.45, compRatio: 2, compAtt: 0.01, compRel: 0.15,
      compMakeup: 1.1, drive: 1.15, gain: 1.0,
    };
    const atmosConfig = {
      hpFreq: 60, compThr: 0, drive: 1.0, gain: 1.0,
    };
    const fxConfig = {
      hpFreq: 40, compThr: 0.35, compRatio: 2.5, compAtt: 0.003, compRel: 0.1,
      compMakeup: 1.2, drive: 1.2, gain: 1.0,
    };
    // Two instances per bus — one for L, one for R
    this.drumBusL = new BusProcessor(drumConfig);
    this.drumBusR = new BusProcessor(drumConfig);
    this.bassBusL = new BusProcessor(bassConfig);
    this.bassBusR = new BusProcessor(bassConfig);
    this.musicBusL = new BusProcessor(musicConfig);
    this.musicBusR = new BusProcessor(musicConfig);
    this.atmosBusL = new BusProcessor(atmosConfig);
    this.atmosBusR = new BusProcessor(atmosConfig);
    this.fxProcL = new BusProcessor(fxConfig);
    this.fxProcR = new BusProcessor(fxConfig);

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
        // Trigger sidechain — DEEPER duck for real psytrance groove
        // 6dB depth (was ~3-4dB) — commercial psytrance has obvious pumping
        this.duckEnv = 1 - wp.duck * 0.7 * (0.5 + mc.aggression * 0.5);
        break;
      }
      case V_BASS: {
        // PURE SYNTH BASS — uses WORLD-SPECIFIC parameters (not hardcoded!)
        // BEFORE: cutoffStart: 800, cutoffEnd: 200, resonance: 2 (same for all worlds)
        // AFTER: uses wp.bassCutoff, wp.bassResonance from world params
        const v = this.getFreeVoice(this.bassPool);
        if (v) v.trigger(t, note, duration, velocity, false, sr, {
          cutoffStart: Math.min(2000, wp.bassCutoff * 4),  // world-specific
          cutoffEnd: wp.bassCutoff,                         // world-specific
          resonance: wp.bassResonance,                      // world-specific
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
    // OPTIMIZATION: Build a single flat array of active voices ONCE per block
    // (was: 14 separate loops per sample = 14 * 128 = 1792 iterations/block)
    // Now: 1 pass to collect active voices, 1 pass per sample
    const activeVoices = [];
    let activeCount = 0;

    // Collect all active synth voices (mono render)
    for (const v of this.kickPool) { if (v.active) { activeVoices.push({v, bus: 0, stereo: false}); activeCount++; } }
    for (const v of this.hatPool) { if (v.active) { activeVoices.push({v, bus: 0, stereo: false}); activeCount++; } }
    for (const v of this.clapPool) { if (v.active) { activeVoices.push({v, bus: 0, stereo: false}); activeCount++; } }
    for (const v of this.percPool) { if (v.active) { activeVoices.push({v, bus: 0, stereo: false}); activeCount++; } }
    for (const v of this.shakerPool) { if (v.active) { activeVoices.push({v, bus: 0, stereo: false}); activeCount++; } }
    for (const v of this.bassPool) { if (v.active) { activeVoices.push({v, bus: 1, stereo: false}); activeCount++; } }
    for (const v of this.leadPool) { if (v.active) { activeVoices.push({v, bus: 2, stereo: 'haas'}); activeCount++; } }
    for (const v of this.acidPool) { if (v.active) { activeVoices.push({v, bus: 2, stereo: false}); activeCount++; } }
    for (const v of this.padPool) { if (v.active) { activeVoices.push({v, bus: 3, stereo: 'lfo'}); activeCount++; } }
    for (const v of this.texturePool) { if (v.active) { activeVoices.push({v, bus: 3, stereo: 'pan'}); activeCount++; } }
    for (const v of this.fxPool) { if (v.active) { activeVoices.push({v, bus: 4, stereo: false}); activeCount++; } }

    // Collect active sample voices (stereo render)
    for (const v of this.kickSamplePool) { if (v.active) { activeVoices.push({v, bus: 0, stereo: 'sample'}); activeCount++; } }
    for (const v of this.hatSamplePool) { if (v.active) { activeVoices.push({v, bus: 0, stereo: 'sample'}); activeCount++; } }
    for (const v of this.clapSamplePool) { if (v.active) { activeVoices.push({v, bus: 0, stereo: 'sample'}); activeCount++; } }

    this.activeVoiceCount = activeCount;

    // Lead Haas delay buffer
    if (!this.leadDelayL) this.leadDelayL = new Float32Array(18);
    if (!this.leadDelayIdx) this.leadDelayIdx = 0;

    // Stereo buses: L and R per group
    for (let i = 0; i < L.length; i++) {
      this.currentSample++;

      // Sidechain envelope recovery
      if (this.duckEnv < 1) {
        this.duckEnv += (1 - this.duckEnv) * (dt / 0.25);
      }

      // Mix all active voices into stereo buses (SINGLE LOOP, not 14)
      let drumBusL = 0, drumBusR = 0;
      let bassBusL = 0, bassBusR = 0;
      let musicBusL = 0, musicBusR = 0;
      let atmosBusL = 0, atmosBusR = 0;
      let fxBusL = 0, fxBusR = 0;

      const sampleTime = currentAudioTime + i * dt;

      for (let vi = 0; vi < activeVoices.length; vi++) {
        const entry = activeVoices[vi];
        const v = entry.v;
        const bus = entry.bus;

        if (entry.stereo === 'sample') {
          // Sample voice — stereo render
          const [sl, sr2] = v.renderStereo(sampleTime, sr);
          switch (bus) {
            case 0: drumBusL += sl; drumBusR += sr2; break;
            case 1: bassBusL += sl; bassBusR += sr2; break;
            case 2: musicBusL += sl; musicBusR += sr2; break;
            case 3: atmosBusL += sl; atmosBusR += sr2; break;
            case 4: fxBusL += sl; fxBusR += sr2; break;
          }
        } else {
          // Synth voice — mono render
          const [s] = v.render(sampleTime, sr);
          switch (bus) {
            case 0: drumBusL += s; drumBusR += s; break;
            case 1: {
              const ducked = s * this.duckEnv;
              bassBusL += ducked; bassBusR += ducked;
              break;
            }
            case 2: {
              if (entry.stereo === 'haas') {
                musicBusL += s;
                const delayed = this.leadDelayL[this.leadDelayIdx];
                this.leadDelayL[this.leadDelayIdx] = s;
                this.leadDelayIdx = (this.leadDelayIdx + 1) % 18;
                musicBusR += delayed;
              } else {
                musicBusL += s; musicBusR += s;
              }
              break;
            }
            case 3: {
              if (entry.stereo === 'lfo') {
                const lfo = Math.sin(this.currentSample * 0.0008);
                atmosBusL += s * (0.85 + lfo * 0.15);
                atmosBusR += s * (0.85 - lfo * 0.15);
              } else if (entry.stereo === 'pan') {
                const pan = Math.sin(this.currentSample * 0.0005);
                atmosBusL += s * (0.5 - pan * 0.3);
                atmosBusR += s * (0.5 + pan * 0.3);
              } else {
                atmosBusL += s; atmosBusR += s;
              }
              break;
            }
            case 4: fxBusL += s; fxBusR += s; break;
          }
        }
      }

      // ── BUS PROCESSING — SEPARATE L and R (stereo image preserved) ──
      drumBusL = this.drumBusL.process(drumBusL, sr);
      drumBusR = this.drumBusR.process(drumBusR, sr);
      bassBusL = this.bassBusL.process(bassBusL, sr);
      bassBusR = this.bassBusR.process(bassBusR, sr);
      musicBusL = this.musicBusL.process(musicBusL, sr);
      musicBusR = this.musicBusR.process(musicBusR, sr);
      atmosBusL = this.atmosBusL.process(atmosBusL, sr);
      atmosBusR = this.atmosBusR.process(atmosBusR, sr);
      fxBusL = this.fxProcL.process(fxBusL, sr);
      fxBusR = this.fxProcR.process(fxBusR, sr);

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

      // Master processing — SEPARATE L and R (stereo preserved)
      mixL = this.masterL.process(mixL, sr);
      mixR = this.masterR.process(mixR, sr);

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
        cpuLoad: this.activeVoiceCount / 64,
        // REMOVED sampleUsage — UI doesn't display it, saves message payload size
      });
    }

    return true;
  }
}

registerProcessor('psy4-engine', Psy4EngineProcessor);
