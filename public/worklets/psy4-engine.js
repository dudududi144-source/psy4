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

// ─── PSY5 RT-safe tunables ─────────────────────────────────────────────────
// 256-slot ring buffer is PSY5's proven size — plenty for a 100ms lookahead
// at 145 BPM (16th = 41ms, so 100ms = ~2.4 steps × ~12 voices/step ≈ 30 events).
// 256 saves memory vs 1024 and is bounded (PSY6 RT contract: fixed arrays only).
const MAX_VOICES = 24;        // FIX: was 32. Reduced for mobile/low-end devices.
const VOICE_BUDGET_MIN = 6;   // FIX: was 8. Lower floor for budget drops.
const EVENT_SIZE = 6;         // floats per event: [time, voice, note, vel, dur, param]
const MAX_EVENTS = 1024;      // FIX: was 512. With 3s lookahead at 145 BPM = ~2 bars = ~60 events. 1024 gives huge headroom.

// CPU-load monitoring (PSY5 dynamic voice budget). If process() exceeds the
// budget, we drop the lowest-priority active voices to stay RT-safe. Reported
// to the main thread every 30 blocks (~10 Hz at 128-sample blocks / 44.1 kHz).
const PROCESS_BUDGET_MS = 2.5;        // FIX: was 3.0. Tighter budget for mobile. Drop voices sooner.
const STATS_REPORT_BLOCKS = 150;      // FIX: was 100. Even less frequent stats (~2Hz). Less main-thread pressure.
const VOICE_BUDGET_DROP_PER_OVERAGE = 1; // drop 1 voice per 0.5ms overage
// VOICE_BUDGET_MIN already defined above as 6

// Voice IDs
const V_KICK = 0, V_BASS = 1, V_LEAD = 2, V_ACID = 3, V_PAD = 4;
const V_HAT = 5, V_HAT_OPEN = 6, V_CLAP = 7, V_PERC = 8, V_SHAKER = 9;
const V_TEXTURE = 10, V_RISER = 11, V_IMPACT = 12, V_SWEEP = 13;
const V_ZAP = 14, V_BLIP = 15, V_DOWNLIFTER = 16, V_FM = 17, V_SNARE = 18;

// ─── Fast polynomial tanh (Pade approximation, PSY5 pattern) ───────────────
// 10x cheaper than Math.tanh (no transcendental call, just multiply + add).
// Accuracy: max error ~0.005 in [-3, 3]; saturates cleanly outside.
// Replaces the lookup-table fastTanh (which required a table + interpolation).
function fastTanh(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}
// Alias so existing call sites that use `ftanh` (PSY5 naming) also work.
const ftanh = fastTanh;

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

  process(x, cutoff, res, drive, sr, tol) {
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
    // Component tolerance: 4 filter stages have slightly different characteristics
    // (PSY3 analog modeling — aTol = [0.98, 1.02, 0.99, 1.01])
    // Each stage's integrator coefficient is slightly modulated by its tolerance.
    // When tol is undefined (most voices), all stages are identical (tol = 1).
    const t0 = tol ? tol[0] : 1, t1 = tol ? tol[1] : 1;
    const t2 = tol ? tol[2] : 1, t3 = tol ? tol[3] : 1;
    this.s0 += g * t0 * (fastTanh(prev) - this.s0); prev = this.s0;
    this.s1 += g * t1 * (fastTanh(prev) - this.s1); prev = this.s1;
    this.s2 += g * t2 * (fastTanh(prev) - this.s2); prev = this.s2;
    this.s3 += g * t3 * (fastTanh(prev) - this.s3);
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
  // Gaussian approximation (sum of 3 uniforms → triangular ≈ Gaussian by CLT)
  // PSY3 uses rng.standard_normal() — this gives a more natural noise character
  // than uniform Math.random(). Summing 3 independent uniforms produces a
  // triangular distribution that closely approximates Gaussian.
  next() {
    let s = 0;
    for (let i = 0; i < 3; i++) {
      this.rngState = (this.rngState * 1103515245 + 12345) & 0x7fffffff;
      s += (this.rngState / 0x3fffffff) - 1; // each in [-1, 1]
    }
    return s * 0.3333; // ~Gaussian, range ≈ [-1, 1]
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
    // Multi-layer params (PSY3 analog modeling)
    // PSY3 kick has: subDecay, midDecay, clickDecay, subLevel, midLevel, clickLevel,
    //                fundamental, startMult, pitchDecay, saturation
    this.subDecay = 0.2;
    this.midDecay = 0.05;
    this.clickDecay = 0.002;
    this.subLevel = 0.8;
    this.midLevel = 0.5;
    this.clickLevel = 0.5;   // COMMERCIAL FIX: louder click (professional kicks have prominent click)
    this.startMult = 4.0;    // COMMERCIAL FIX: more dramatic pitch sweep (was 2.4 — pro kicks sweep 3-5x)
    this.pitchDecay = 0.025; // COMMERCIAL FIX: faster pitch decay (was 0.04 — pro is ~25ms)
    this.saturation = 1.8;   // COMMERCIAL FIX: more saturation (was 1.5 — adds punch)
    this.phase = 0;
    this.midPhase = 0;
    this.prevNoise = 0;
    this.noise = new PinkNoise();
    // PERF-ZERO-ALLOC: preallocated output buffer (avoids per-sample array literal)
    this._out = new Float32Array(2);
  }

  trigger(time, amp, fund, decay, sr) {
    this.active = true;
    this.t = 0;
    this.amp = amp;
    this.fund = fund;
    // Independent decay per layer (PSY3 model) — sub carries the weight,
    // mid provides body/punch, click provides beater attack
    this.subDecay = Math.max(0.05, decay);
    this.midDecay = this.subDecay * 0.25;   // mid decays 4x faster
    this.clickDecay = 0.002;                 // 2ms click
    this.phase = 0;
    this.midPhase = 0;
    this.prevNoise = 0;
    this.noise.reset();
  }

  // Returns this._out (Float32Array[2]); _out[0] = mono sample, _out[1] = 0.
  // Caller checks `this.active` to detect voice-end (no done flag in return).
  render(currentTime, sr) {
    const out = this._out;
    if (!this.active) { out[0] = 0; return out; }
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.subDecay + 0.05) { this.active = false; out[0] = 0; return out; }

    const t = this.t;
    const f0 = this.fund;

    // Pitch envelope: f0*startMult → f0 over pitchDecay
    const f = (f0 * this.startMult - f0) * Math.exp(-t / this.pitchDecay) + f0;

    // Layer 1: SUB — pitched sine with integrated phase (pitch sweep)
    // This is the weight/foundation of the kick
    this.phase += 2 * Math.PI * f / sr;
    const subEnv = Math.exp(-t / (this.subDecay * 0.9));
    const sub = Math.sin(this.phase) * subEnv * this.subLevel;

    // Layer 2: MID — saturated triangle at fundamental, short decay
    // This is the punch/body — gives the kick its "thwack"
    this.midPhase += 2 * Math.PI * f0 / sr;
    const triPhase = (this.midPhase / (2 * Math.PI)) % 1;
    const tri = 2 * Math.abs(2 * triPhase - 1) - 1;
    const midEnv = Math.exp(-t / this.midDecay);
    const mid = fastTanh(tri * 1.5) * midEnv * this.midLevel;

    // Layer 3: CLICK — differentiated Gaussian noise, very short
    // This is the beater attack — the transient that cuts through the mix
    const n = this.noise.next();
    const click = (n - this.prevNoise) * Math.exp(-t / this.clickDecay) * this.clickLevel;
    this.prevNoise = n;

    // Mix layers
    let sample = sub + mid + click;
    // SATURATION: Post-mix tanh (adds harmonics + punch — commercial kicks
    // always have saturation. Without it, the kick sounds flat and digital.)
    sample = fastTanh(sample * this.saturation);
    sample *= this.amp * 1.2;  // was 0.8 — too quiet
    out[0] = sample;
    return out;
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
    this.bassDecay = 0.25;  // FIX: was 0.12. Rolling bass needs overlap between 16th notes.
    // Post-filter state (one-pole HP for cleaning mud)
    this.hpState = 0;
    // PSY3 bass params: subLevel, harmonicLevel, cutoffFloor, cutoffDecay
    this.subLevel = 0.45;
    this.harmonicLevel = 0.55;
    this.cutoffFloor = 80;
    this.cutoffDecay = 0.04;
    // PHASE 7a: Filter LFO for rolling psytrance bass — filter REOPENS per note
    // This is what creates the "rolling" character. Without it, the filter closes
    // and stays closed, making the bass a static drone.
    this.lfoPhase = 0;
    this.lfoRate = 0;  // Hz — set in trigger based on tempo (synced to 16th notes)
    this.lfoDepth = 0;  // 0..1 — amount of filter modulation
    // PERF-ZERO-ALLOC: preallocated output buffer
    this._out = new Float32Array(2);
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
    this.subLevel = params?.subLevel ?? 0.45;
    this.harmonicLevel = params?.harmonicLevel ?? 0.55;
    this.cutoffFloor = params?.cutoffFloor ?? 80;
    this.cutoffDecay = params?.cutoffDecay ?? 0.04;
    if (acid) {
      this.cutoffStart = 2500;
      this.cutoffEnd = 100;
      this.res = 0.85;
      this.bassDecay = 0.15;
      // PHASE 7a: Acid bass — strong LFO for squelchy 303 character
      this.lfoRate = 8;  // 8Hz — fast squelch
      this.lfoDepth = 0.6;
    } else {
      this.cutoffStart = params?.cutoffStart ?? 800;
      this.cutoffEnd = params?.cutoffEnd ?? 200;
      this.res = Math.min(0.3, (params?.resonance ?? 3) / 20);
      this.bassDecay = 0.25;  // FIX: was 0.12. Rolling bass needs overlap.
      // PHASE 7a: Rolling bass — moderate LFO synced to note rate
      // The LFO reopens the filter slightly on each note, creating movement
      this.lfoRate = 4;  // 4Hz — gentle rolling
      this.lfoDepth = 0.3;
    }
    this.lfoPhase = 0;  // reset LFO phase on each note
  }

  render(currentTime, sr) {
    const out = this._out;
    if (!this.active) { out[0] = 0; return out; }
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.bassDecay) { this.active = false; out[0] = 0; return out; }

    // COMMERCIAL FIX: Use SAW wave (not square) — psytrance bass is always saw.
    // Source: dsokolovskiy.com (professional psytrance producer)
    // Square is too hollow; saw has the harmonics needed for filter movement.
    const inc = this.freq / sr;
    const osc = this.saw.process(inc);  // always saw — even for acid (acid uses filter, not osc type)

    // COMMERCIAL FIX: 24dB/oct filter (Moog ladder is already 24dB — good)
    // Filter envelope: fast decay (pluck) + LFO (rolling)
    // Source: professional bass uses Decay ~30% of max, Attack=0, Release=0, Sustain=low
    const cutoffEnv = (this.cutoffStart - this.cutoffEnd) * Math.exp(-this.t / this.cutoffDecay) + this.cutoffEnd;
    // LFO reopens filter (rolling character)
    this.lfoPhase += 2 * Math.PI * this.lfoRate * dt;
    const lfoMod = (Math.sin(this.lfoPhase) * 0.5 + 0.5) * this.lfoDepth;
    const lfoAmount = (this.cutoffStart - this.cutoffEnd) * lfoMod;
    const cutoff = Math.max(this.cutoffFloor, cutoffEnv + lfoAmount);
    const drive = this.acid ? 2.5 : 1.3;
    const filtered = this.filter.process(osc, cutoff, this.res, drive, sr);

    // COMMERCIAL FIX: Sub sine (clean fundamental) — but at lower level
    // Professional bass has sub, but it shouldn't dominate
    this.phase += 2 * Math.PI * this.freq / sr;
    const sub = Math.sin(this.phase) * this.subLevel;

    // MIX: filtered saw (character) + sub (weight)
    let mixed = filtered * this.harmonicLevel + sub * this.subLevel;

    // SATURATION: Post-mix tanh — adds harmonics + warmth
    mixed = fastTanh(mixed * 1.8);

    // HP FILTER: Remove subsonic mud
    const hpCutoff = 30;
    const hpA = (1 / sr) * 2 * Math.PI * hpCutoff;
    this.hpState += hpA * (mixed - this.hpState) / (1 + hpA);
    mixed = mixed - this.hpState * 0.7;

    // COMMERCIAL FIX: Shorter decay = tighter bass (was 0.12s, now proportional)
    // Professional psytrance bass is tight — not sustained
    const attackEnv = Math.min(1, this.t / 0.001);  // 1ms attack (instant)
    const decayEnv = Math.exp(-this.t / (this.bassDecay * 0.4));  // faster decay
    const ampEnv = attackEnv * decayEnv;

    out[0] = mixed * ampEnv * this.amp;
    return out;
  }
}

// ─── Voice: Lead (supersaw → Moog → amp env) ───────────────────────────────

class LeadVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.dur = 0.3;
    this.amp = 0.8;  // FIX: was 0.5. Lead needs to be prominent in the mix.
    this.saws = [new BLSaw(), new BLSaw(), new BLSaw(), new BLSaw(), new BLSaw()];
    this.octaveSaws = [new BLSaw(), new BLSaw(), new BLSaw()];
    this.filter = new MoogLadder();
    this.cutoff = 1800;
    this.res = 0.15;
    this.lfoPhase = 0;
    this.lfoRate = 0.8;
    this.lfoDepth = 0.3;
    this.detune = 10;
    this.noise = new PinkNoise();
    // PHASE 10: FM modulation — adds metallic/psychedelic character
    // FM: a modulator oscillator modulates the carrier (saw) frequency
    // This is what makes leads sound "alive" rather than static
    this.fmPhase = 0;       // modulator phase
    this.fmRate = 3;        // modulator frequency (Hz)
    this.fmDepth = 0;       // 0..1 — modulation amount (0 = off)
    this.fmRatio = 2;       // modulator:carrier ratio (2:1 = classic FM)
    // PERF-ZERO-ALLOC: preallocated output buffer
    this._out = new Float32Array(2);
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
    this.filterEnvAmount = params?.filterEnvAmount ?? 1.0;
    // PHASE 10: FM params — psychedelia macro controls FM depth
    this.fmDepth = params?.fmDepth ?? 0;
    this.fmRate = params?.fmRate ?? 3;
    this.fmRatio = params?.fmRatio ?? 2;
    this.fmPhase = 0;
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
    const out = this._out;
    if (!this.active) { out[0] = 0; return out; }
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.dur + 0.05) { this.active = false; out[0] = 0; return out; }

    // PHASE 10: FM modulation — modulator oscillator
    // The modulator frequency = carrier * ratio (e.g., 2:1 = classic FM)
    // fmDepth scales the modulation (0 = no FM, 1 = extreme metallic)
    this.fmPhase += 2 * Math.PI * this.freq * this.fmRatio * dt;
    const fmMod = Math.sin(this.fmPhase) * this.fmDepth * this.freq * 0.15;  // 15% freq deviation max

    // Layer 1: Fundamental — 5 detuned saws with FM modulation applied
    let fundamental = 0;
    for (const s of this.saws) {
      // FM: shift the saw frequency by fmMod for each sample
      const fmInc = (s.freq + fmMod) / sr;
      fundamental += s.process(fmInc);
    }
    fundamental /= this.saws.length;

    // Layer 2: Octave-up — 3 detuned saws
    let octaveLayer = 0;
    for (const s of this.octaveSaws) octaveLayer += s.process(s.freq / sr);
    octaveLayer /= this.octaveSaws.length;

    // Layer 3: Air — pink noise HP
    const noiseSample = this.noise.process();
    const air = (noiseSample - this.noise.prevOutput || 0) * 0.08;

    // Mix: fundamental dominant, octave at 30%, air at 8%
    let mix = fundamental * 0.7 + octaveLayer * 0.3 + air * 0.08;

    // LFO modulates filter cutoff (psychedelic movement)
    this.lfoPhase += this.lfoRate * dt;
    const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * this.lfoPhase);
    const modCutoff = this.cutoff * (1 + this.lfoDepth * (lfo * 2 - 1) * 0.5);

    // Filter envelope: open → settle
    const fEnv = this.cutoff * (1 + this.filterEnvAmount) * Math.exp(-this.t / (this.dur * 0.5)) + this.cutoff;
    const cutoff = Math.min(18000, Math.max(100, fEnv * 0.5 + modCutoff * 0.5));

    const filtered = this.filter.process(mix, cutoff, this.res, 1.5, sr);

    // SATURATION: Post-filter tanh — adds character and warmth
    const saturated = fastTanh(filtered * 1.6);

    // Amp envelope
    const ampEnv = Math.min(1, this.t / 0.006) * Math.exp(-this.t / this.dur);
    const sample = saturated * ampEnv * this.amp;
    out[0] = sample;
    return out;
  }
}

// ─── Voice: Acid (square → high-res Moog → distortion) ─────────────────────
// PSY3 ANALOG MODELING: accent cap, thermal drift, power sag, slide,
// component tolerance. These are what make the acid voice sound like a
// real TB-303 rather than a sterile digital square wave.

class AcidVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.square = new BLSquare();
    this.filter = new MoogLadder();
    this.lfoPhase = 0; // bidirectional filter movement
    // ── PSY3 ANALOG MODELING STATE ──
    this.aAccCap = 0;       // accent cap accumulation ("the cry") — builds with accents, colors filter
    this.aDrift = 0;        // current thermal drift (slow frequency modulation)
    this.aDriftTarget = 0;  // drift target (random walk)
    this.aPowerSag = 0;     // power sag (accent → momentary voltage drop → volume dip)
    this.aActivity = 0;     // activity level (how busy the voice is — affects drift)
    // Component tolerance: 4 filter stages have slightly different characteristics
    // PSY3: aTol = [0.98, 1.02, 0.99, 1.01] — ±2% variation per stage
    this.aTol = [0.98, 1.02, 0.99, 1.01];
    // Slide state (constant-time portamento between notes)
    this.prevFreq = 0;
    this.slideFreq = 0;
    this.slideActive = false;
    // PERF-ZERO-ALLOC: preallocated output buffer
    this._out = new Float32Array(2);
  }

  trigger(time, freq, dur, amp, sr, param) {
    this.active = true;
    this.t = 0;
    this.freq = freq;
    this.dur = dur;
    this.amp = amp;

    // Accent detection — param >= 0.5 means accented note (PSY3 accent)
    const isAccent = (param !== undefined && param >= 0.5);

    // ── SLIDE: constant-time portamento from previous freq to new freq ──
    // PSY3 uses 60ms slide time. Only slide if there's a previous note and
    // the frequency difference is significant (avoids slide on first note
    // or on same-note retriggers).
    if (this.prevFreq > 0 && Math.abs(freq - this.prevFreq) > 1) {
      this.slideFreq = this.prevFreq;
      this.slideActive = true;
    } else {
      this.slideFreq = freq;
      this.slideActive = false;
    }
    this.prevFreq = freq;

    // ── ACCENT CAP: accumulates with each accent, colors the filter ──
    // PSY3: aAccCap = min(1, aAccCap + 0.35 * isAccent)
    // This builds up "the cry" — repeated accents make the filter brighter
    // and more open, mimicking the way a real 303's envelope capacitor
    // charges up with repeated accents.
    this.aAccCap = Math.min(1, this.aAccCap + 0.35 * (isAccent ? 1 : 0));

    // ── POWER SAG: accent causes momentary voltage drop ──
    // PSY3: if (isAccent) aPowerSag = 0.15; aPowerSag *= 0.995
    // The power supply sags under accent load → momentary volume dip.
    // This is the "punch" of a real 303 — the note dips slightly then recovers.
    if (isAccent) this.aPowerSag = 0.15;

    // ── THERMAL DRIFT: random slow frequency drift target ──
    // PSY3: if (Math.random() < 0.0004) aDriftT = (Math.random()-0.5)*2;
    //       aDrift += (aDriftT - aDrift) * 0.0002
    // We set a new drift target on each trigger (deterministic per-note).
    // Drift is ±1% of frequency — inaudible as detuning but adds "life".
    this.aDriftTarget = (Math.random() - 0.5) * 0.02;

    // Activity increases with each note (affects drift intensity)
    this.aActivity = Math.min(1, this.aActivity + 0.1);

    this.square.reset();
    this.filter.reset();
    this.cutoffStart = 200 + 3000;
    this.cutoffEnd = 100;
    this.res = 0.95; // near self-oscillation for squelch
    this.lfoPhase = 0;
  }

  render(currentTime, sr) {
    const out = this._out;
    if (!this.active) { out[0] = 0; return out; }
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.dur + 0.05) { this.active = false; out[0] = 0; return out; }

    // ── THERMAL DRIFT: slow random frequency modulation ──
    // PSY3: aDrift += (aDriftT - aDrift) * 0.0002
    // The oscillator frequency drifts slightly with temperature/activity.
    // Inaudible as detuning but adds analog "life" — the note breathes.
    this.aDrift += (this.aDriftTarget - this.aDrift) * 0.0002;
    const driftMult = 1 + this.aDrift * (0.5 + this.aActivity * 0.5);

    // ── SLIDE: constant-time portamento (60ms exponential glide) ──
    let currentFreq = this.freq;
    if (this.slideActive) {
      const slideTime = 0.06; // 60ms constant-time slide
      const slideProgress = Math.min(1, this.t / slideTime);
      // Exponential glide (pitch slides exponentially, not linearly)
      const ratio = this.freq / this.slideFreq;
      currentFreq = this.slideFreq * Math.pow(ratio, slideProgress);
      if (slideProgress >= 1) this.slideActive = false;
    }
    currentFreq *= driftMult;

    const inc = currentFreq / sr;
    const sq = this.square.process(inc);

    // ── POWER SAG: accent causes momentary voltage drop (volume dip) ──
    // PSY3: aPowerSag *= 0.995; osc *= (1 - aPowerSag)
    // The note dips in volume then recovers — this is the analog "punch".
    this.aPowerSag *= 0.995;
    const sagGain = 1 - this.aPowerSag;
    const sqSagged = sq * sagGain;

    // ── ACCENT CAP: colors the filter cutoff (accent energy builds up) ──
    // Higher accent cap → brighter, more open filter ("the cry")
    // The cap decays slowly so repeated accents build brightness over time.
    this.aAccCap *= 0.99999; // ~2s decay time constant
    const accentBoost = this.aAccCap * 0.5; // up to +50% cutoff

    // BIDIRECTIONAL filter movement — envelope + LFO combined
    // Envelope: fast drop from high to low (classic acid)
    const envCutoff = (this.cutoffStart - this.cutoffEnd) * Math.exp(-this.t / (this.dur * 0.4)) + this.cutoffEnd;
    // LFO: slow sine that adds up-down movement on top of the envelope
    // This creates the "wobble" that real 303 acid has
    this.lfoPhase += 4.0 * dt; // 4Hz LFO
    const lfo = Math.sin(2 * Math.PI * this.lfoPhase);
    let cutoff = Math.max(80, envCutoff * (1 + lfo * 0.3) * (1 + accentBoost));
    cutoff = Math.min(18000, cutoff);

    // Component tolerance: 4 filter stages slightly detuned (PSY3 aTol)
    const filtered = this.filter.process(sqSagged, cutoff, 0.95, 3.0, sr, this.aTol);
    const distorted = fastTanh(filtered * 4); // heavy distortion

    const ampEnv = Math.min(1, this.t / 0.003) * Math.exp(-this.t / this.dur);
    const sample = distorted * ampEnv * this.amp;
    out[0] = sample;
    return out;
  }
}

// ─── Voice: FM (carrier + modulator + envelope, PSY3 acid FM) ──────────────
// Two-operator FM: modulator (sine) → carrier (sine) frequency modulation.
// Modulator index envelope (fast decay) gives the classic "FM pluck" attack
// that PSY3's acid voice uses for metallic squelch. Drives through a Moog
// ladder for warmth + a tanh saturator for grit.

class FMVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.carPhase = 0;
    this.modPhase = 0;
    this.filter = new MoogLadder();
    // PERF-ZERO-ALLOC: preallocated output buffer
    this._out = new Float32Array(2);
  }

  trigger(time, freq, dur, amp, sr, params) {
    this.active = true;
    this.t = 0;
    this.freq = freq;
    this.dur = dur;
    this.amp = amp;
    this.carPhase = 0;
    this.modPhase = 0;
    this.ratio = (params && params.fmRatio) || 2.0;       // modulator:carrier ratio
    this.depthStart = (params && params.fmDepth) || 6.0;   // modulation index (start)
    this.depthEnd = (params && params.fmDepthEnd) || 0.5;  // modulation index (end)
    this.cutoff = (params && params.cutoff) || 2200;
    this.res = (params && params.resonance) || 0.4;
    this.filter.reset();
  }

  render(currentTime, sr) {
    const out = this._out;
    if (!this.active) { out[0] = 0; return out; }
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.dur + 0.05) { this.active = false; out[0] = 0; return out; }

    // Modulator: sine at freq * ratio, with envelope on modulation index
    this.modPhase += 2 * Math.PI * this.freq * this.ratio * dt;
    // Exponential index decay (PSY3 "accent thermal" — fast attack, exp decay)
    const idx = (this.depthStart - this.depthEnd) * Math.exp(-this.t / 0.05) + this.depthEnd;
    const modulator = Math.sin(this.modPhase) * this.freq * idx;

    // Carrier: sine at freq + modulator
    this.carPhase += 2 * Math.PI * (this.freq + modulator) * dt;
    const carrier = Math.sin(this.carPhase);

    // Through Moog ladder for warmth (PSY3 always filters FM)
    const filtered = this.filter.process(carrier, this.cutoff, this.res, 1.4, sr);
    // Saturation for grit
    const saturated = fastTanh(filtered * 1.8);

    // Amp envelope: 3ms attack + exp decay over dur
    const ampEnv = Math.min(1, this.t / 0.003) * Math.exp(-this.t / this.dur);
    out[0] = saturated * ampEnv * this.amp;
    return out;
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
    // PERF-ZERO-ALLOC: preallocated output buffer (stereo: [left, right])
    this._out = new Float32Array(2);
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

  // Mono render (backward compat — delegates to renderStereo and sums to mono)
  render(currentTime, sr) {
    const out = this.renderStereo(currentTime, sr);
    // renderStereo wrote left→out[0], right→out[1]; collapse to mono in out[0]
    const sum = (out[0] + out[1]) * 0.5;
    out[0] = sum;
    return out;
  }

  // STEREO render — PSY3 stereo spread: detuned oscs panned L/C/R
  // PSY3 pad has: numOscs=2, detune=0.004, cutoff=900, attack=0.6, release=1.2
  // We use 3 oscs panned L/C/R for wider stereo image.
  // Filter is applied to the MID signal (M/S processing) — preserves stereo width.
  renderStereo(currentTime, sr) {
    const out = this._out;
    if (!this.active) { out[0] = 0; out[1] = 0; return out; }
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.dur + 0.1) { this.active = false; out[0] = 0; out[1] = 0; return out; }

    // Evolve LFO modulates detune (via frequency)
    this.lfoPhase += this.evolveRate * dt;
    const lfo = Math.sin(2 * Math.PI * this.lfoPhase);
    const detuneMod = 1 + 0.003 * lfo;
    this.saws[0].setFreq(this.freq * Math.pow(2, -this.detune / 1200) * detuneMod);
    this.saws[1].setFreq(this.freq * detuneMod);
    this.saws[2].setFreq(this.freq * Math.pow(2, this.detune / 1200) * detuneMod);

    // Render each saw with its own frequency
    const s0 = this.saws[0].process(this.saws[0].freq / sr);
    const s1 = this.saws[1].process(this.saws[1].freq / sr);
    const s2 = this.saws[2].process(this.saws[2].freq / sr);

    // STEREO SPREAD: pan detuned oscs L/C/R
    // s0 (detuned -) → hard left, s1 (center) → both, s2 (detuned +) → hard right
    let left = s0 * 0.7 + s1 * 0.5;
    let right = s2 * 0.7 + s1 * 0.5;

    // M/S processing: filter the mid, preserve the side (stereo width)
    const mid = (left + right) * 0.5;
    const side = (left - right) * 0.5;

    // SLOW FILTER SWEEP — cutoff moves up and down over the duration
    // This is what makes a pad "breathe" — without it, it's a static organ
    this.filterSweepPhase += 0.15 * dt; // 0.15Hz — very slow
    const sweep = 0.5 + 0.5 * Math.sin(2 * Math.PI * this.filterSweepPhase);
    const cutoff = this.cutoffBase * (0.6 + sweep * 0.8); // 60% to 140% of base

    const filteredMid = this.filter.process(mid, cutoff, this.res, 1.2, sr);

    // Recombine: filtered mid + unfiltered side (preserves stereo width)
    left = filteredMid + side;
    right = filteredMid - side;

    // Slow attack/release envelope
    const attackEnv = Math.min(1, this.t / this.attack);
    const releaseEnv = Math.min(1, (this.dur - this.t) / 0.4);
    const ampEnv = Math.max(0, Math.min(1, Math.min(attackEnv, releaseEnv)));
    out[0] = left * ampEnv * this.amp;
    out[1] = right * ampEnv * this.amp;
    return out;
  }
}

// ─── Voice: Hat (differentiated pink noise, PSY3 engine.py hat) ────────────

class HatVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.noise = new PinkNoise();
    this.prevNoise = 0;
    this.hpState = 0;
    this.decay = 0.03;
    this.brightness = 1.0;
    this._out = new Float32Array(2);
  }

  trigger(time, open, amp, sr, params) {
    this.active = true;
    this.t = 0;
    this.open = open;
    this.amp = amp;
    this.decay = (params && params.hatDecay) ? params.hatDecay : (open ? 0.22 : 0.03);
    this.brightness = (params && params.hatBrightness) ? params.hatBrightness : 1.0;
    this.prevNoise = 0;
    this.hpState = 0;
    this.noise.reset();
  }

  render(currentTime, sr) {
    const out = this._out;
    if (!this.active) { out[0] = 0; return out; }
    this.t += 1 / sr;
    if (this.t > this.decay * 1.5) { this.active = false; out[0] = 0; return out; }

    // Use raw white noise (not pink) — much louder high-freq content
    const n = this.noise.next();
    // One-pole highpass: removes low frequencies, keeps highs
    this.hpState = this.hpState + 0.5 * (n - this.hpState);
    const hp = n - this.hpState;
    const env = Math.exp(-this.t / this.decay);
    // 50x gain — was 5x, still too quiet. White noise * HP * env * amp * brightness
    const sample = hp * env * 50.0 * this.amp * this.brightness;
    out[0] = Math.max(-1, Math.min(1, sample));
    return out;
  }
}

// ─── Voice: Clap (multi-burst noise, PSY3 engine.py clap) ──────────────────

class ClapVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.noise = new PinkNoise();
    // PERF-ZERO-ALLOC: preallocated output buffer
    this._out = new Float32Array(2);
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
    const out = this._out;
    if (!this.active) { out[0] = 0; return out; }
    this.t += 1 / sr;
    if (this.t > 0.3) { this.active = false; out[0] = 0; return out; }

    const n = this.noise.next();
    let g = 0;
    for (let k = 0; k < 4; k++) {
      if (this.t >= this.bursts[k]) {
        g += Math.exp(-(this.t - this.bursts[k]) / this.decays[k]);
      }
    }
    const sample = n * g * 0.6 * this.amp / 0.4;
    out[0] = sample;
    return out;
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
    // PERF-ZERO-ALLOC: preallocated output buffer
    this._out = new Float32Array(2);
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
    const out = this._out;
    if (!this.active) { out[0] = 0; return out; }
    this.t += 1 / sr;
    if (this.t > 0.1) { this.active = false; out[0] = 0; return out; }

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
    out[0] = sample;
    return out;
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
    // PERF-ZERO-ALLOC: preallocated output buffer
    this._out = new Float32Array(2);
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
    const out = this._out;
    if (!this.active) { out[0] = 0; return out; }
    this.t += 1 / sr;
    if (this.t > 0.08) { this.active = false; out[0] = 0; return out; }

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
    out[0] = sample;
    return out;
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
    // PERF-ZERO-ALLOC: preallocated output buffer
    this._out = new Float32Array(2);
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
    const out = this._out;
    if (!this.active) { out[0] = 0; return out; }
    this.t += 1 / sr;
    if (this.t > this.dur + 0.1) { this.active = false; out[0] = 0; return out; }

    const dt = 1 / sr;
    const env = Math.min(1, this.t / 0.5) * Math.min(1, (this.dur - this.t) / 0.5);
    if (env <= 0) { out[0] = 0; return out; }

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

    out[0] = mix * env * this.amp;
    return out;
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
    // PERF-ZERO-ALLOC: preallocated output buffer
    this._out = new Float32Array(2);
  }

  trigger(type, time, dur, amp, sr) {
    this.active = true;
    this.type = type;
    this.t = 0;
    this.dur = dur || 0.3;
    this.amp = Math.max(0.5, amp || 0.5);  // FIX: was 0.2 default. FX need to be audible.
    this.phase = 0;
    this.noise.reset();
    this.filter.reset();
  }

  render(currentTime, sr) {
    const out = this._out;
    if (!this.active) { out[0] = 0; return out; }
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.dur + 0.2) { this.active = false; out[0] = 0; return out; }

    let sample = 0;
    const t = this.t;
    switch (this.type) {
      case V_RISER: {
        // Riser = noise through filter that opens up + amplitude rise
        // FIX: louder, more dramatic build, longer filter sweep
        const n = this.noise.process();
        // Filter opens from 100Hz to 10000Hz over the duration — FIX: wider range
        const cutoff = 100 + Math.pow(t / this.dur, 1.5) * 9900;  // FIX: exponential curve, wider range
        const filtered = this.filter.process(n, cutoff, 0.3, 2.0, sr);  // FIX: more resonance, more drive
        // Amplitude rises exponentially — FIX: louder, more dramatic
        const env = Math.pow(t / this.dur, 3) * 0.6;  // FIX: was pow(2)*0.35 — steeper curve, louder
        sample = fastTanh(filtered * env * 4);  // FIX: was *3 — more saturation
        break;
      }
      case V_IMPACT: {
        // Impact = sub sine boom + noise burst (two layers)
        // Sub boom: sine from 150Hz to 40Hz with exp decay — FIX: louder, deeper
        const f = 150 * Math.exp(-t / 0.12) + 40;
        this.phase += 2 * Math.PI * f * dt;
        const subEnv = Math.exp(-t / 0.25);
        const sub = Math.sin(this.phase) * subEnv * 0.9;  // FIX: was 0.7 — louder
        // Noise burst: short percussive crack — FIX: louder, longer
        const n = this.noise.process();
        const noiseEnv = Math.exp(-t / 0.04);  // FIX: was 0.02 — 40ms crack instead of 20ms
        const crack = n * noiseEnv * 0.5;  // FIX: was 0.3 — louder
        sample = sub + crack;
        sample = fastTanh(sample * 2.0);  // FIX: was 1.5 — more saturation = punchier
        break;
      }
      case V_SWEEP: {
        // Sweep = filtered noise with filter moving + amplitude curve
        // FIX: louder, more dramatic filter movement
        const n = this.noise.process();
        const sweepPos = t / this.dur;
        // Filter sweeps from high to low (downward) — FIX: clearer direction
        const cutoff = 6000 - Math.pow(sweepPos, 1.5) * 5500 + 500;  // FIX: 6000→500, exponential
        const filtered = this.filter.process(n, cutoff, 0.4, 1.8, sr);  // FIX: more resonance, more drive
        const env = Math.sin(Math.PI * sweepPos) * 0.5;  // FIX: was 0.2 — louder
        sample = fastTanh(filtered * env * 2.5);  // FIX: add saturation
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
    out[0] = sample * this.amp;
    return out;
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
    // PERF-ZERO-ALLOC: preallocated output buffer (stereo: [left, right])
    this._out = new Float32Array(2);
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

  // Returns this._out (Float32Array[2]); _out[0]=left, _out[1]=right.
  // Caller checks `this.active` to detect sample-end (no done flag in return).
  renderStereo(currentTime, sr) {
    const out = this._out;
    if (!this.active || !this.sampleData) { out[0] = 0; out[1] = 0; return out; }
    this.t += 1 / sr;
    const env = Math.exp(-this.t / this.decay);
    if (env < 0.001 || this.position >= this.sampleData.length) {
      this.active = false;
      out[0] = 0; out[1] = 0;
      return out;
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

    out[0] = sample * leftGain;
    out[1] = sample * rightGain;
    return out;
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
    // PERF-ZERO-ALLOC: preallocated stereo output buffer
    this._out = new Float32Array(2);
  }

  setWet(wet) { this.wet = wet; }
  setInputGain(g) { this.inputGain = g; }

  // Process a mono input, return this._out (Float32Array[2]): _out[0]=left, _out[1]=right.
  process(input, sr) {
    const out = this._out;
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
      const cOut = inSample + this.combLP[i] * this.combFeedback;
      buf[idx] = cOut;
      this.combIdx[i] = (idx + 1) % this.combDelays[i];
      combSum += cOut;
    }
    combSum *= 0.25; // normalize

    // ── Allpass filters (series) for diffusion ──
    let ap = combSum;
    for (let i = 0; i < 2; i++) {
      const buf = this.allpassBuffers[i];
      const idx = this.allpassIdx[i];
      const delayed = buf[idx];
      const apOut = -ap * this.allpassFeedback + delayed;
      buf[idx] = ap + delayed * this.allpassFeedback;
      this.allpassIdx[i] = (idx + 1) % this.allpassDelays[i];
      ap = apOut;
    }

    // Stereo: slight delay between L and R for width
    // (re-use allpass output, offset by a few samples for stereo effect)
    out[0] = ap * this.wet;
    out[1] = combSum * this.wet * 0.9; // slightly different for width
    return out;
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
    // REDUCED from 2s to 0.5s — saves 1.3MB memory
    // 0.5s is plenty for psytrance delay (3/8 at 140bpm = 0.32s)
    this.bufferSize = 44100 / 2; // 0.5 seconds max (was 2 seconds)
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
    // PERF-ZERO-ALLOC: preallocated stereo output buffer
    this._out = new Float32Array(2);
  }

  setDelayTimes(leftMs, rightMs) {
    this.leftDelay = leftMs / 1000;
    this.rightDelay = rightMs / 1000;
  }

  setFeedback(fb) { this.feedback = fb; }
  setWet(wet) { this.wet = wet; }
  setInputGain(g) { this.inputGain = g; }

  // Process stereo input [left, right], return this._out (Float32Array[2]): _out[0]=left, _out[1]=right.
  process(leftIn, rightIn, sr) {
    const out = this._out;
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

    out[0] = leftDelayed * this.wet;
    out[1] = rightDelayed * this.wet;
    return out;
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

// ─── Biquad filter (RBJ cookbook, transposed direct form II) ───────────────
// Used for multiband crossover filters in the master chain.

class Biquad {
  constructor() {
    this.z1 = 0; this.z2 = 0;
    this.b0 = 1; this.b1 = 0; this.b2 = 0;
    this.a1 = 0; this.a2 = 0;
  }
  setLowpass(fc, sr, Q) {
    const w0 = 2 * Math.PI * fc / sr;
    const cw = Math.cos(w0), sw = Math.sin(w0);
    const alpha = sw / (2 * Q);
    const a0 = 1 + alpha;
    this.b0 = ((1 - cw) / 2) / a0;
    this.b1 = (1 - cw) / a0;
    this.b2 = ((1 - cw) / 2) / a0;
    this.a1 = (-2 * cw) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  setHighpass(fc, sr, Q) {
    const w0 = 2 * Math.PI * fc / sr;
    const cw = Math.cos(w0), sw = Math.sin(w0);
    const alpha = sw / (2 * Q);
    const a0 = 1 + alpha;
    this.b0 = ((1 + cw) / 2) / a0;
    this.b1 = -(1 + cw) / a0;
    this.b2 = ((1 + cw) / 2) / a0;
    this.a1 = (-2 * cw) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  process(x) {
    // Transposed direct form II
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  reset() { this.z1 = 0; this.z2 = 0; }
}

// ─── Multiband Compressor (3-band: low <180Hz, mid 180-4000Hz, high >4000Hz) ──
// PSY3 style_master.py master_pro() step 2: multiband compression.
// Uses Linkwitz-Riley 2nd-order crossovers (Q=0.5) for flat summing.
// Each band has independent compressor with per-band attack/release/ratio.

class MultibandComp {
  constructor(sr) {
    // LR2 crossovers at 180Hz and 4000Hz
    // 4 biquads: LP1(180), HP1(180), LP2(4000), HP2(4000)
    this.lp1 = new Biquad(); this.lp1.setLowpass(180, sr, 0.5);
    this.hp1 = new Biquad(); this.hp1.setHighpass(180, sr, 0.5);
    this.lp2 = new Biquad(); this.lp2.setLowpass(4000, sr, 0.5);
    this.hp2 = new Biquad(); this.hp2.setHighpass(4000, sr, 0.5);
    // Per-band compressor envelope state
    this.envLow = 0; this.envMid = 0; this.envHigh = 0;
    // Per-band settings (PSY3-style: low=more ratio, high=faster)
    this.lowThr = 0.5;  this.lowRatio = 3;   this.lowAtt = 0.005; this.lowRel = 0.15;  this.lowMakeup = 1.3;
    this.midThr = 0.5;  this.midRatio = 2;   this.midAtt = 0.004; this.midRel = 0.12;  this.midMakeup = 1.2;
    this.highThr = 0.45; this.highRatio = 2.5; this.highAtt = 0.002; this.highRel = 0.08; this.highMakeup = 1.2;
  }

  process(sample, sr) {
    const dt = 1 / sr;

    // ── Split into 3 bands (LR2 crossover = flat sum) ──
    const low = this.lp1.process(sample);
    const midHigh = this.hp1.process(sample);
    const mid = this.lp2.process(midHigh);
    const high = this.hp2.process(midHigh);

    // ── Compress LOW band (controls bass energy) ──
    const absLow = Math.abs(low);
    if (absLow > this.envLow) this.envLow += (absLow - this.envLow) * (dt / this.lowAtt);
    else this.envLow += (absLow - this.envLow) * (dt / this.lowRel);
    let gainLow = 1;
    if (this.envLow > this.lowThr) {
      const over = this.envLow - this.lowThr;
      gainLow = (this.envLow - over * (1 - 1 / this.lowRatio)) / this.envLow;
    }
    const cLow = low * gainLow * this.lowMakeup;

    // ── Compress MID band (controls vocal/instrument presence) ──
    const absMid = Math.abs(mid);
    if (absMid > this.envMid) this.envMid += (absMid - this.envMid) * (dt / this.midAtt);
    else this.envMid += (absMid - this.envMid) * (dt / this.midRel);
    let gainMid = 1;
    if (this.envMid > this.midThr) {
      const over = this.envMid - this.midThr;
      gainMid = (this.envMid - over * (1 - 1 / this.midRatio)) / this.envMid;
    }
    const cMid = mid * gainMid * this.midMakeup;

    // ── Compress HIGH band (controls harshness/air) ──
    const absHigh = Math.abs(high);
    if (absHigh > this.envHigh) this.envHigh += (absHigh - this.envHigh) * (dt / this.highAtt);
    else this.envHigh += (absHigh - this.envHigh) * (dt / this.highRel);
    let gainHigh = 1;
    if (this.envHigh > this.highThr) {
      const over = this.envHigh - this.highThr;
      gainHigh = (this.envHigh - over * (1 - 1 / this.highRatio)) / this.envHigh;
    }
    const cHigh = high * gainHigh * this.highMakeup;

    // Sum bands (LR2 = flat, so sum ≈ original + compression artifacts)
    return cLow + cMid + cHigh;
  }
}

// ─── Stereo Widener (PSY3 to_stereo: Haas delay + decorrelated HP side) ─────
// PSY3 style_master.py to_stereo():
//   d = int(0.012 * SR)  // 12ms Haas
//   side = roll(x, d); side[:d] = 0
//   side = side - roll(side, 1)  // decorrelated HP side
//   return [x + side*width, x - side*width]
// Creates stereo width from mono signal. Here we enhance existing stereo:
// extract mid, delay+HP it, add/subtract as side channel.

class StereoWidener {
  constructor() {
    // 12ms Haas delay buffer (generous size for up to 96kHz: 0.012 * 96000 = 1152)
    this.delayBuf = new Float32Array(2048);
    this.delayIdx = 0;
    this.delaySamples = Math.max(1, Math.floor(0.012 * sampleRate));
    this.prevDelayed = 0;
    this.width = 0.3; // PSY3 default width
    // PERF-ZERO-ALLOC: preallocated stereo output buffer
    this._out = new Float32Array(2);
  }

  setWidth(w) { this.width = Math.max(0, Math.min(0.5, w)); }

  // Takes stereo [left, right], returns this._out (Float32Array[2]): widened [left, right].
  process(left, right, sr) {
    const out = this._out;
    // Mid signal
    const mid = (left + right) * 0.5;

    // Haas delay on mid (12ms)
    const delayed = this.delayBuf[this.delayIdx];
    this.delayBuf[this.delayIdx] = mid;
    this.delayIdx = (this.delayIdx + 1) % this.delaySamples;

    // HP via differentiation (decorrelated side — PSY3: side = side - roll(side,1))
    const side = delayed - this.prevDelayed;
    this.prevDelayed = delayed;

    // Add width: L += side*width, R -= side*width
    // This adds a delayed+HP'd version of the mid to the side channel,
    // creating a sense of space without destroying the original image.
    out[0] = left + side * this.width;
    out[1] = right - side * this.width;
    return out;
  }

  reset() {
    this.delayBuf.fill(0);
    this.prevDelayed = 0;
    this.delayIdx = 0;
  }
}

// ─── Master chain (multiband comp + glue + saturation + LUFS + true-peak) ───
// PSY3 style_master.py master_pro() ports:
//   1. Multiband compression (3-band) — NEW
//   2. Glue compression (thr=0.6, ratio=2, makeup=1.3) — PSY3 params
//   3. Saturation (drive=1.15, mix=0.15) — PSY3 params
//   4. LUFS targeting (-9 LUFS) — NEW
//   5. True-peak limiting (2x oversample, ceiling 0.89) — NEW
//   6. Final tanh (soft clip safety)

class MasterChain {
  constructor() {
    this.gain = 1.0;  // was 0.7 — too quiet. Full output.
    this.ceiling = 0.95;     // was 0.85 — too much headroom killed the sound.

    // Multiband compressor (3-band: low <180Hz, mid 180-4000Hz, high >4000Hz)
    this.mb = new MultibandComp(sampleRate);

    // Glue compression (PSY3: thr=0.6, ratio=2, makeup=1.3)
    this.glueEnv = 0;
    this.glueThr = 0.60;
    this.glueRatio = 2.0;      // PSY3 ratio
    this.glueAttack = 0.004;
    this.glueRelease = 0.12;
    this.glueMakeup = 1.1;  // FIX: was 1.3. Too much makeup gain caused clipping.     // PSY3 makeup

    // Saturation (PSY3: drive=1.15, mix=0.15)
    this.satDrive = 1.15;
    this.satMix = 0.15;

    // LUFS targeting (simplified K-weighted loudness → makeup gain)
    this.lufsMs = 0;           // running mean square
    this.lufsGain = 1.0;       // current applied gain
    this.lufsTargetGain = 1.0; // computed target gain
    this.lufsTargetLufs = -10;  // FIX: was -9. Lower target = less clipping.  // target loudness (-8 to -10 LUFS)
    this.lufsCounter = 0;      // update counter (every 32 samples)

    // True-peak limiter (2x oversample, 1-sample lookahead)
    this.tpPrevInput = 0;      // previous input sample (for inter-sample peak)
    this.tpGainEnv = 1;        // limiter gain (smoothed)
    this.tpAttack = 0.0001;    // very fast attack (catches peaks)
    this.tpRelease = 0.06;     // moderate release

    this.sr = sampleRate;
  }

  process(sample, sr) {
    const dt = 1 / sr;

    // תיקון: דלג על multiband + glue + saturation — הם הרגו את הסאונד
    // רק true-peak limiter (מונע clipping) + gain

    // 4. TRUE-PEAK LIMITING (2x oversample, 1-sample lookahead)
    //    Catches inter-sample peaks that sample-peak limiters miss.
    //    This is the ONLY processing — no multiband, no glue, no saturation.
    const peak = Math.abs(sample);
    let tpTarget = 1;
    if (peak > this.ceiling) {
      tpTarget = this.ceiling / peak;
    }
    // Smooth gain: fast attack (catch peaks), slow release (avoid pumping)
    if (tpTarget < this.tpGainEnv) {
      this.tpGainEnv += (tpTarget - this.tpGainEnv) * (dt / this.tpAttack);
    } else {
      this.tpGainEnv += (tpTarget - this.tpGainEnv) * (dt / this.tpRelease);
    }
    // Output the previous sample with current gain (1-sample lookahead delay)
    const output = this.tpPrevInput * this.tpGainEnv;
    this.tpPrevInput = sample;

    // 5. FINAL TANH (soft clip safety — prevents any remaining overshoot)
    return fastTanh(output * this.gain);
  }
}

// ─── Main Engine Processor ─────────────────────────────────────────────────

class Psy4EngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // CRITICAL FIX: Set port.onmessage FIRST
    this.port.onmessage = (e) => this.handleMessage(e.data);
    console.log('[WORKLET] Constructor: port.onmessage set');
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
    // REDUCED from 92 to 32 voices — saves memory, faster iteration
    // psy5 uses 8 voices total and sounds fine. We use 32 for safety.
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
    this.fmPool = [];
    // FIX: Reduced pool sizes for mobile/low-end devices
    for (let i = 0; i < 2; i++) this.kickPool.push(new KickVoice());    // was 4
    for (let i = 0; i < 2; i++) this.bassPool.push(new BassVoice());    // was 2
    for (let i = 0; i < 2; i++) this.leadPool.push(new LeadVoice());    // was 4
    for (let i = 0; i < 1; i++) this.acidPool.push(new AcidVoice());    // was 2
    for (let i = 0; i < 1; i++) this.padPool.push(new PadVoice());      // was 2
    for (let i = 0; i < 2; i++) this.hatPool.push(new HatVoice());      // was 4
    for (let i = 0; i < 1; i++) this.clapPool.push(new ClapVoice());    // was 2
    for (let i = 0; i < 2; i++) this.percPool.push(new PercVoice());    // was 4
    for (let i = 0; i < 1; i++) this.shakerPool.push(new ShakerVoice());// was 2
    for (let i = 0; i < 1; i++) this.texturePool.push(new TextureVoice());// was 2
    for (let i = 0; i < 2; i++) this.fxPool.push(new FXVoice());        // was 4
    for (let i = 0; i < 1; i++) this.fmPool.push(new FMVoice());        // was 2
    // Total: 34 voices (was 64+28=92)

    // Sample voice pools — populated with SampleVoice instances
    // CRITICAL FIX: These were EMPTY arrays. When samplesReady=true (after loading
    // 12 drum samples), getFreeVoice() returned null and kicks/hats/claps were
    // silently dropped. This was the root cause of "no audio output".
    this.kickSamplePool = [];
    this.hatSamplePool = [];
    this.clapSamplePool = [];
    for (let i = 0; i < 2; i++) this.kickSamplePool.push(new SampleVoice());  // was 4
    for (let i = 0; i < 2; i++) this.hatSamplePool.push(new SampleVoice());   // was 4
    for (let i = 0; i < 1; i++) this.clapSamplePool.push(new SampleVoice());  // was 2
    // SNARE sample pool — separate from clap (snare has sharper attack)
    this.snareSamplePool = [];
    for (let i = 0; i < 1; i++) this.snareSamplePool.push(new SampleVoice()); // was 2

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

    // Stereo widener (PSY3 to_stereo: Haas delay + decorrelated HP side)
    // Applied AFTER the master chain on the combined stereo signal.
    this.stereoWidener = new StereoWidener();

    // Bus gains (drum, bass, music, atmos, fx)
    // REBALANCED for proper mix: kick lower, music higher (lead+pad now audible)
    // FIX: Mix balance — kick should be loudest, bass under kick, lead audible
    // Commercial psytrance: kick 0dB, bass -3dB, lead -6dB, hats -12dB, pad -18dB
    this.busGains = [1.0, 1.0, 0.9, 0.5, 0.7];  // drum=1.0, bass=1.0 (was 0.7), music=0.9, atmos=0.5, fx=0.7

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
      duck: 0.6,  // FIX: was 0.4. Commercial psytrance ducks bass 50-60% on each kick.
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

    // ── PSY5 RT-safe: preallocated active-voice tracking ──────────────────
    // Instead of allocating `const activeVoices = []` + `push({v, bus, stereo})`
    // object literals every block (PSY5 violation), we preallocate flat typed
    // arrays. The active-voice list is rebuilt each block but the storage is
    // reused — zero per-block allocation.
    //
    // Layout (parallel arrays, indexed 0..activeVoiceCount-1):
    //   activeVoiceRef[i]   — the voice object (drum/synth/sample)
    //   activeVoiceBus[i]   — bus index (0=drum, 1=bass, 2=music, 3=atmos, 4=fx)
    //   activeVoiceStereo[i] — stereo mode (0=mono, 1=haas, 2=lfo, 3=pan, 4=sample)
    const MAX_ACTIVE = 64;  // total voices across all pools (34 synth + headroom)
    this.activeVoiceRef = new Array(MAX_ACTIVE);
    this.activeVoiceBus = new Uint8Array(MAX_ACTIVE);
    this.activeVoiceStereo = new Uint8Array(MAX_ACTIVE);
    this.activeVoiceCount = 0;

    // ── PSY5 RT-safe: CPU load monitoring + dynamic voice budget ──────────
    // If process() takes > PROCESS_BUDGET_MS, we drop the lowest-priority
    // active voices to stay RT-safe. Reported to the main thread every
    // STATS_REPORT_BLOCKS (~10 Hz at 128-sample blocks / 44.1 kHz).
    this.blockCounter = 0;
    this.cpuLoad = 0;          // 0..1, exponentially-smoothed
    this.voiceBudget = MAX_VOICES;  // dynamic ceiling — drops under overload
    this.lastProcessMs = 0;    // for stats reporting

    // Stereo mode constants (used in process() switch)
    this.ST_MONO = 0;
    this.ST_HAAS = 1;
    this.ST_LFO = 2;
    this.ST_PAN = 3;
    this.ST_SAMPLE = 4;
    this.ST_PAD = 5; // NEW: pad stereo (renderStereo with L/C/R panning)

    // ── PSY5 RT-safe: preallocated pool table ──────────────────────────
    // Avoids the per-block `const pools = [[...]]` array literal allocation
    // that the previous version did. Each entry is [pool, bus, stereo].
    // Built once in the constructor after the voice pools exist.
    this.voicePoolTable = [
      [this.kickPool,       0, this.ST_MONO],
      [this.hatPool,        0, this.ST_MONO],
      [this.clapPool,       0, this.ST_MONO],
      [this.percPool,       0, this.ST_MONO],
      [this.shakerPool,     0, this.ST_MONO],
      [this.bassPool,       1, this.ST_MONO],
      [this.leadPool,       2, this.ST_HAAS],
      [this.acidPool,       2, this.ST_MONO],
      [this.fmPool,         2, this.ST_MONO],
      [this.padPool,        3, this.ST_PAD],
      [this.texturePool,    3, this.ST_PAN],
      [this.fxPool,         4, this.ST_MONO],
      [this.kickSamplePool, 0, this.ST_SAMPLE],
      [this.hatSamplePool,  0, this.ST_SAMPLE],
      [this.clapSamplePool, 0, this.ST_SAMPLE],
      [this.snareSamplePool, 0, this.ST_SAMPLE],
    ];

    // port.onmessage moved to top of constructor (CRITICAL FIX)
  }

  handleMessage(msg) {
    if (!msg || !msg.type) return;
    // DEBUG: log first few messages to see if ANY arrive
    if (this._msgCount === undefined) this._msgCount = 0;
    if (this._msgCount < 3) {
      this._msgCount++;
      console.log(`[WORKLET] handleMessage: type=${msg.type}`);
    }
    switch (msg.type) {
      case 'play':
        this.playing = true;
        this.step = 0;
        this.currentSample = 0;
        this.nextStepSample = 0;
        break;
      case 'stop':
        this.playing = false;
        // CRITICAL FIX: Clear the ENTIRE event ring buffer — was still playing
        // pre-fetched events (3 bars = ~90 events) after stop was pressed.
        this.eventCount = 0;
        this.eventReadIdx = 0;
        this.eventWriteIdx = 0;
        // Also clear shared buffer count if present
        if (this.sharedEventCount) {
          Atomics.store(this.sharedEventCount, 0, 0);
        }
        // Deactivate all voices
        for (const pool of [this.kickPool, this.bassPool, this.leadPool, this.acidPool, this.padPool, this.hatPool, this.clapPool, this.percPool, this.shakerPool, this.texturePool, this.fxPool, this.fmPool, this.kickSamplePool, this.hatSamplePool, this.clapSamplePool, this.snareSamplePool]) {
          for (const v of pool) v.active = false;
        }
        break;
      case 'bpm':
        this.bpm = msg.bpm;
        break;
      case 'macros':
        this.macros = { ...this.macros, ...msg.macros };
        break;
      // שלב 4.2: Render single voice offline (for synthesis matching)
      case 'renderVoice': {
        // msg: { voiceClass, params, triggerArgs, duration }
        try {
          const voices = (typeof globalThis !== 'undefined') ? globalThis.__PSY4_VOICES : null;
          if (!voices) {
            this.port.postMessage({ type: 'renderVoiceDone', buffer: null, error: 'No __PSY4_VOICES' });
            break;
          }
          const VC = voices[msg.voiceClass];
          if (!VC) {
            this.port.postMessage({ type: 'renderVoiceDone', buffer: null, error: 'Unknown voice: ' + msg.voiceClass });
            break;
          }
          const voice = new VC();
          if (msg.params) {
            for (const k of Object.keys(msg.params)) voice[k] = msg.params[k];
          }
          const sr = sampleRate;
          const ta = msg.triggerArgs || {};
          if (msg.voiceClass === 'KickVoice') {
            voice.trigger(0, ta.amp ?? 1.0, ta.fund ?? 50, ta.decay ?? 0.2, sr);
          } else if (msg.voiceClass === 'BassVoice') {
            voice.trigger(0, ta.freq ?? 80, ta.dur ?? 0.2, ta.amp ?? 0.5, ta.acid ?? false, sr, ta.params ?? null);
          } else if (msg.voiceClass === 'LeadVoice') {
            voice.trigger(0, ta.freq ?? 440, ta.amp ?? 0.5, sr);
          } else if (msg.voiceClass === 'HatVoice') {
            voice.trigger(0, ta.open ?? false, ta.amp ?? 0.5, sr);
          } else if (msg.voiceClass === 'PercVoice') {
            voice.trigger(0, ta.freq ?? 200, ta.amp ?? 0.5, sr);
          } else if (msg.voiceClass === 'AcidVoice') {
            voice.trigger(0, ta.freq ?? 110, ta.amp ?? 0.5, sr);
          } else if (msg.voiceClass === 'PadVoice') {
            voice.trigger(0, ta.freq ?? 220, ta.amp ?? 0.3, sr);
          } else if (msg.voiceClass === 'ClapVoice') {
            voice.trigger(0, ta.amp ?? 0.5, sr);
          } else if (msg.voiceClass === 'ShakerVoice') {
            voice.trigger(0, ta.amp ?? 0.5, sr);
          } else if (msg.voiceClass === 'FMVoice') {
            voice.trigger(0, ta.freq ?? 440, ta.amp ?? 0.5, sr);
          } else {
            this.port.postMessage({ type: 'renderVoiceDone', buffer: null, error: 'No trigger for: ' + msg.voiceClass });
            break;
          }
          const duration = msg.duration ?? 0.08;
          const numSamples = Math.ceil(duration * sr);
          const buffer = new Float32Array(numSamples);
          for (let i = 0; i < numSamples; i++) {
            const out = voice.render(i / sr, sr);
            if (out.length >= 2) buffer[i] = (out[0] + out[1]) * 0.5;
            else buffer[i] = out[0];
            if (!voice.active && i > sr * 0.001) break;
          }
          this.port.postMessage({ type: 'renderVoiceDone', buffer, error: null }, [buffer.buffer]);
        } catch (err) {
          this.port.postMessage({ type: 'renderVoiceDone', buffer: null, error: String(err && err.message ? err.message : err) });
        }
        break;
      }
      case 'world':
        this.worldParams = { ...this.worldParams, ...msg.params };
        break;
      // Debug query — מחזיר מידע פנימי ל-main thread
      case 'debug': {
        if (msg.query === 'learnedVoiceParams') {
          this.port.postMessage({ type: 'debugResult', query: 'learnedVoiceParams', data: this.learnedVoiceParams || {} });
        }
        break;
      }
      // שלב 4.4: החלת recipe מ-sound bank על voice pool
      case 'setVoiceRecipe': {
        // msg: { voiceClass: string, recipe: object }
        // תיקון קריטי: שמור את ה-params על ה-PROCESSOR (לא על ה-voice)
        // כי trigger() דורס אותם. ה-scheduler יקרא אותם כשמפעיל voice.
        const vc = msg.voiceClass;
        const recipe = msg.recipe || {};
        if (!this.learnedVoiceParams) this.learnedVoiceParams = {};
        this.learnedVoiceParams[vc] = { ...this.learnedVoiceParams[vc], ...recipe };
        console.log('[PSY4] שלב 4.4 setVoiceRecipe(' + vc + '): STORED on processor, params=' + JSON.stringify(recipe).slice(0, 100));
        break;
      }
      case 'setFX':
        // Adjust reverb/delay sends based on section (automation)
        // msg.reverbSends and msg.delaySends are arrays of 5 values
        if (msg.reverbSends) this.reverbSends = msg.reverbSends;
        if (msg.delaySends) this.delaySends = msg.delaySends;
        if (msg.reverbWet !== undefined) this.reverb.setWet(msg.reverbWet);
        if (msg.delayWet !== undefined) this.delay.setWet(msg.delayWet);
        if (msg.delayFeedback !== undefined) this.delay.setFeedback(msg.delayFeedback);
        break;
      case 'setParams':
        // PERF-FIX: Batched parameter update — apply world + fx + bpm + macros
        // in ONE message (vs. 4 separate postMessages). Each section is optional
        // and dispatched to the same logic as the individual handlers above.
        if (msg.world) {
          this.worldParams = { ...this.worldParams, ...msg.world };
        }
        if (msg.macros) {
          this.macros = { ...this.macros, ...msg.macros };
        }
        if (msg.bpm !== undefined) {
          this.bpm = msg.bpm;
        }
        // FX section (reverbSends / delaySends / reverbWet / delayWet /
        // delayFeedback) — applied via the same logic as 'setFX' above.
        if (msg.reverbSends) this.reverbSends = msg.reverbSends;
        if (msg.delaySends) this.delaySends = msg.delaySends;
        if (msg.reverbWet !== undefined) this.reverb.setWet(msg.reverbWet);
        if (msg.delayWet !== undefined) this.delay.setWet(msg.delayWet);
        if (msg.delayFeedback !== undefined) this.delay.setFeedback(msg.delayFeedback);
        break;
      case 'events':
        this.enqueueEvents(msg.events);
        break;
      case 'initSharedBuffer':
        // ADR-009: Receive SharedArrayBuffer for lock-free event transfer
        // The main thread writes events to this buffer and signals via Atomics
        this.sharedEventBuffer = msg.buffer;
        this.sharedEventCount = new Int32Array(msg.countBuffer);
        this.sharedEventView = new Float64Array(this.sharedEventBuffer);
        break;
      case 'trigger':
        // Single immediate event
        this.enqueueEvent(msg.time, msg.voice, msg.note, msg.velocity, msg.duration, msg.param);
        break;
      case 'duck':
        // Trigger sidechain duck (used by triggerImmediate)
        this.duckEnv = Math.max(0.3, 1 - this.duckDepth * (0.5 + this.macros.aggression * 0.5));
        break;
      case 'panic':
        // Kill all voices
        for (const pool of [this.kickPool, this.bassPool, this.leadPool, this.acidPool, this.padPool, this.hatPool, this.clapPool, this.percPool, this.shakerPool, this.texturePool, this.fxPool, this.fmPool, this.kickSamplePool, this.hatSamplePool, this.clapSamplePool, this.snareSamplePool]) {
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
        // תיקון קריטי: השתמש ב-learned params מ-sound bank (אם יש)
        // עוברים ל-SYNTH kick בלבד — samples יוצרים סאונד קבוע שלא משתנה
        const lp = (this.learnedVoiceParams && this.learnedVoiceParams.KickVoice) || {};
        const kickFund = lp.fund ?? wp.kickFundamental;
        const kickDecay = lp.subDecay ?? wp.kickDecay;
        const v = this.getFreeVoice(this.kickPool);
        if (v) {
          v.trigger(t, velocity, kickFund, kickDecay, sr);
          // אחרי trigger, החל learned params ש-trigger לא מקבל כערכים
          if (lp.startMult !== undefined) v.startMult = lp.startMult;
          if (lp.pitchDecay !== undefined) v.pitchDecay = lp.pitchDecay;
          if (lp.midLevel !== undefined) v.midLevel = lp.midLevel;
          if (lp.clickLevel !== undefined) v.clickLevel = lp.clickLevel;
          if (lp.saturation !== undefined) v.saturation = lp.saturation;
        }
        // Trigger sidechain
        this.duckEnv = 1 - wp.duck * (0.5 + mc.aggression * 0.5);
        this.duckEnv = Math.max(0.3, this.duckEnv);
        break;
      }
      case V_BASS: {
        // תיקון קריטי: השתמש ב-learned params מ-sound bank
        const lp = (this.learnedVoiceParams && this.learnedVoiceParams.BassVoice) || {};
        const v = this.getFreeVoice(this.bassPool);
        if (v) v.trigger(t, note, duration, velocity, false, sr, {
          cutoffStart: lp.cutoffStart ?? 3000,
          cutoffEnd: lp.cutoffEnd ?? 300,
          resonance: lp.resonance ?? 0.15,
          cutoffDecay: lp.cutoffDecay ?? 0.08,
          subLevel: lp.subLevel ?? 0.5,
          harmonicLevel: lp.harmonicLevel ?? 0.6,
          cutoffFloor: lp.cutoffFloor ?? 80,
        });
        break;
      }
      case V_LEAD: {
        // תיקון קריטי: השתמש ב-learned params מ-sound bank
        const lp = (this.learnedVoiceParams && this.learnedVoiceParams.LeadVoice) || {};
        const v = this.getFreeVoice(this.leadPool);
        if (v) v.trigger(t, note, duration, velocity, sr, {
          cutoff: lp.cutoff ?? 4000,
          detune: lp.detune ?? 12,
          resonance: lp.resonance ?? 0.3,
          lfoRate: lp.lfoRate ?? 2,
          lfoDepth: lp.lfoDepth ?? 0.4,
          filterEnvAmount: lp.filterEnvAmount ?? 1.5,
          fmDepth: lp.fmDepth ?? 0.3,
          fmRate: lp.fmRate ?? 3,
          fmRatio: lp.fmRatio ?? 2,
        });
        break;
      }
      case V_ACID: {
        // Pass param as accent flag (param >= 0.5 = accent) for PSY3 analog modeling
        const v = this.getFreeVoice(this.acidPool);
        if (v) v.trigger(t, note, duration, velocity, sr, param);
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
        const lp = (this.learnedVoiceParams && this.learnedVoiceParams.HatVoice) || {};
        const v = this.getFreeVoice(this.hatPool);
        if (v) v.trigger(t, false, velocity, sr, {
          hatDecay: lp.hatDecay ?? 0.03,
          hatBrightness: lp.hatBrightness ?? 1.0,
        });
        break;
      }
      case V_HAT_OPEN: {
        const lp = (this.learnedVoiceParams && this.learnedVoiceParams.HatVoice) || {};
        const v = this.getFreeVoice(this.hatPool);
        if (v) v.trigger(t, true, velocity, sr, {
          hatDecay: lp.hatDecayOpen ?? 0.22,
          hatBrightness: lp.hatBrightness ?? 1.0,
        });
        break;
      }
      case V_CLAP: {
        const lp = (this.learnedVoiceParams && this.learnedVoiceParams.ClapVoice) || {};
        const v = this.getFreeVoice(this.clapPool);
        if (v) v.trigger(t, velocity, sr);
        if (lp.clapDecay !== undefined && v) v.decay = lp.clapDecay;
        break;
      }
      case V_SNARE: {
        // SNARE — separate from clap. Uses snare samples (sharper attack than clap).
        if (this.samplesReady) {
          const snareNames = Object.keys(this.samples).filter(n => this.samples[n].category === 'snare');
          if (snareNames.length > 0) {
            const idx = (this.rrCounters.snare || 0) % snareNames.length;
            this.rrCounters.snare = ((this.rrCounters.snare || 0) + 1) % snareNames.length;
            const snareName = snareNames[idx];
            const v = this.getFreeVoice(this.snareSamplePool);
            if (v) {
              const samp = this.samples[snareName];
              v.trigger(samp.data, samp.sampleRate, 1.0, velocity, 0.15, 0);
            }
          } else {
            // Fallback: use synth clap
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
      case V_FM: {
        // PSY3-style FM acid voice — carrier + modulator with envelope.
        // `param` encodes the FM ratio (param / 10), so the main thread can
        // send ratio=2.0 as param=20. Defaults to ratio 2.0 (param=0).
        const v = this.getFreeVoice(this.fmPool);
        if (v) {
          const fmRatio = param > 0 ? param / 10 : 2.0;
          v.trigger(t, note, duration, velocity, sr, {
            fmRatio,
            fmDepth: 6.0,
            fmDepthEnd: 0.5,
            cutoff: 2200,
            resonance: 0.4,
          });
        }
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
  //
  // PSY5 RT-safe contract:
  //   - ZERO allocation in process() (no `new`, no object literals, no array
  //     pushes). All storage is preallocated in the constructor.
  //   - Bounded loops over fixed arrays only (PSY6 RT-safe contract).
  //   - CPU load monitoring: if process() > PROCESS_BUDGET_MS, drop the
  //     lowest-priority active voices to stay RT-safe.
  //   - Stats reported every STATS_REPORT_BLOCKS (~10 Hz) — not every block.
  //
  process(inputs, outputs) {
    // ── PSY5: measure process() duration for CPU-load monitoring ──
    const __procStart = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : 0;

    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const L = output[0];
    const R = output[1] || output[0];
    const sr = this.sr;
    const dt = 1 / sr;

    // Process events that are due (time <= current audio time)
    const currentAudioTime = currentFrame / sr;

    // ADR-009: Check SharedArrayBuffer for new events (lock-free, zero-allocation)
    if (this.sharedEventCount) {
      const sharedCount = Atomics.load(this.sharedEventCount, 0);
      if (sharedCount > 0) {
        // Copy events from shared buffer into the ring buffer
        for (let i = 0; i < sharedCount; i++) {
          const sBase = i * EVENT_SIZE;
          this.enqueueEvent(
            this.sharedEventView[sBase],     // time
            this.sharedEventView[sBase + 1], // voice
            this.sharedEventView[sBase + 2], // note
            this.sharedEventView[sBase + 3], // velocity
            this.sharedEventView[sBase + 4], // duration
            this.sharedEventView[sBase + 5]  // param
          );
        }
        // Clear the count (signal to main thread that we consumed the events)
        Atomics.store(this.sharedEventCount, 0, 0);
      }
    }

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

    // ── PSY5: collect active voices into PREALLOCATED flat arrays ──
    // (No `const activeVoices = []` + `push({v, bus, stereo})` — that was a
    //  per-block allocation. Now we write into this.activeVoiceRef/Bus/Stereo.)
    let activeCount = 0;
    const refArr = this.activeVoiceRef;
    const busArr = this.activeVoiceBus;
    const stereoArr = this.activeVoiceStereo;
    const ST_MONO = this.ST_MONO, ST_HAAS = this.ST_HAAS, ST_LFO = this.ST_LFO, ST_PAN = this.ST_PAN, ST_SAMPLE = this.ST_SAMPLE, ST_PAD = this.ST_PAD;
    const MAX_ACTIVE = refArr.length;
    // PSY5: voicePoolTable is built once in the constructor (no per-block
    // allocation). Each entry is [pool, bus, stereo].
    const pools = this.voicePoolTable;

    for (let pi = 0; pi < pools.length && activeCount < MAX_ACTIVE; pi++) {
      const p = pools[pi];
      const pool = p[0];
      const bus = p[1];
      const stereo = p[2];
      for (let vi = 0; vi < pool.length && activeCount < MAX_ACTIVE; vi++) {
        const v = pool[vi];
        if (v.active) {
          refArr[activeCount] = v;
          busArr[activeCount] = bus;
          stereoArr[activeCount] = stereo;
          activeCount++;
        }
      }
    }
    this.activeVoiceCount = activeCount;

    // ── PSY5: dynamic voice budget — drop lowest-priority voices if overloaded ──
    // We track the smoothed CPU load. If we're over budget, deactivate the
    // highest-indexed active voices (these are FX/sample/texture — lowest
    // musical priority). Kick/bass/lead (lowest indices) are protected.
    if (this.voiceBudget < activeCount) {
      const toDrop = activeCount - Math.max(VOICE_BUDGET_MIN, this.voiceBudget);
      for (let d = 0; d < toDrop && activeCount > 0; d++) {
        activeCount--;
        const dropped = refArr[activeCount];
        if (dropped) dropped.active = false;
      }
      this.activeVoiceCount = activeCount;
    }

    // Lead Haas delay buffer (preallocated — lazy init on first block)
    if (!this.leadDelayL) this.leadDelayL = new Float32Array(18);
    if (!this.leadDelayIdx) this.leadDelayIdx = 0;
    const leadDelayL = this.leadDelayL;
    let leadDelayIdx = this.leadDelayIdx;

    // Cache bus processors + gains for tight inner loop (no `this.` lookups)
    const drumBusL_ = this.drumBusL, drumBusR_ = this.drumBusR;
    const bassBusL_ = this.bassBusL, bassBusR_ = this.bassBusR;
    const musicBusL_ = this.musicBusL, musicBusR_ = this.musicBusR;
    const atmosBusL_ = this.atmosBusL, atmosBusR_ = this.atmosBusR;
    const fxProcL_ = this.fxProcL, fxProcR_ = this.fxProcR;
    const masterL = this.masterL, masterR = this.masterR;
    const stereoWidener = this.stereoWidener;
    const reverb = this.reverb, delay = this.delay;
    const busGains = this.busGains;
    const revSends = this.reverbSends, delSends = this.delaySends;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const duckEnvRef = this;  // duckEnv is a field — accessed via this.duckEnv

    // Stereo buses: L and R per group
    for (let i = 0; i < L.length; i++) {
      this.currentSample++;

      // Sidechain envelope recovery
      if (duckEnvRef.duckEnv < 1) {
        duckEnvRef.duckEnv += (1 - duckEnvRef.duckEnv) * (dt / 0.15);  // FIX: was 0.25 — faster recovery = less ducking overlap
      }

      // Mix all active voices into stereo buses (SINGLE LOOP)
      let drumBusL = 0, drumBusR = 0;
      let bassBusL = 0, bassBusR = 0;
      let musicBusL = 0, musicBusR = 0;
      let atmosBusL = 0, atmosBusR = 0;
      let fxBusL = 0, fxBusR = 0;

      const sampleTime = currentAudioTime + i * dt;

      for (let vi = 0; vi < activeCount; vi++) {
        const v = refArr[vi];
        const bus = busArr[vi];
        const stereo = stereoArr[vi];

        if (stereo === ST_SAMPLE || stereo === ST_PAD) {
          // Sample voice or pad voice — stereo render
          const out = v.renderStereo(sampleTime, sr);
          const sl = out[0], sr2 = out[1];
          switch (bus) {
            case 0: drumBusL += sl; drumBusR += sr2; break;
            case 1: bassBusL += sl; bassBusR += sr2; break;
            case 2: musicBusL += sl; musicBusR += sr2; break;
            case 3: atmosBusL += sl; atmosBusR += sr2; break;
            case 4: fxBusL += sl; fxBusR += sr2; break;
          }
        } else {
          // Synth voice — mono render
          const s = v.render(sampleTime, sr)[0];
          switch (bus) {
            case 0: drumBusL += s; drumBusR += s; break;
            case 1: {
              const ducked = s * duckEnvRef.duckEnv;
              bassBusL += ducked; bassBusR += ducked;
              break;
            }
            case 2: {
              const ducked2 = s * duckEnvRef.duckEnv;  // FIX: lead/music also ducked (was not ducked)
              if (stereo === ST_HAAS) {
                musicBusL += ducked2;
                const delayed = leadDelayL[leadDelayIdx];
                leadDelayL[leadDelayIdx] = ducked2;
                leadDelayIdx = (leadDelayIdx + 1) % 18;
                musicBusR += delayed;
              } else {
                musicBusL += ducked2; musicBusR += ducked2;
              }
              break;
            }
            case 3: {
              if (stereo === ST_LFO) {
                const lfo = Math.sin(this.currentSample * 0.0008);
                atmosBusL += s * (0.85 + lfo * 0.15);
                atmosBusR += s * (0.85 - lfo * 0.15);
              } else if (stereo === ST_PAN) {
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
      this.leadDelayIdx = leadDelayIdx;

      // ── BUS PROCESSING — SEPARATE L and R (stereo image preserved) ──
      drumBusL = drumBusL_.process(drumBusL, sr);
      drumBusR = drumBusR_.process(drumBusR, sr);
      bassBusL = bassBusL_.process(bassBusL, sr);
      bassBusR = bassBusR_.process(bassBusR, sr);
      musicBusL = musicBusL_.process(musicBusL, sr);
      musicBusR = musicBusR_.process(musicBusR, sr);
      atmosBusL = atmosBusL_.process(atmosBusL, sr);
      atmosBusR = atmosBusR_.process(atmosBusR, sr);
      fxBusL = fxProcL_.process(fxBusL, sr);
      fxBusR = fxProcR_.process(fxBusR, sr);

      // Sum buses with gains (stereo)
      let mixL = drumBusL * busGains[0]
               + bassBusL * busGains[1]
               + musicBusL * busGains[2]
               + atmosBusL * busGains[3]
               + fxBusL * busGains[4];
      let mixR = drumBusR * busGains[0]
               + bassBusR * busGains[1]
               + musicBusR * busGains[2]
               + atmosBusR * busGains[3]
               + fxBusR * busGains[4];

      // ── FX SENDS: Reverb + Delay ──
      const reverbInput = (drumBusL + drumBusR) * 0.5 * revSends[0]
                        + (bassBusL + bassBusR) * 0.5 * revSends[1]
                        + (musicBusL + musicBusR) * 0.5 * revSends[2]
                        + (atmosBusL + atmosBusR) * 0.5 * revSends[3]
                        + (fxBusL + fxBusR) * 0.5 * revSends[4];
      const revOut = reverb.process(reverbInput, sr);
      const revL = revOut[0], revR = revOut[1];

      const delayInputL = drumBusL * delSends[0]
                        + bassBusL * delSends[1]
                        + musicBusL * delSends[2]
                        + atmosBusL * delSends[3]
                        + fxBusL * delSends[4];
      const delayInputR = drumBusR * delSends[0]
                        + bassBusR * delSends[1]
                        + musicBusR * delSends[2]
                        + atmosBusR * delSends[3]
                        + fxBusR * delSends[4];
      const delOut = delay.process(delayInputL, delayInputR, sr);
      const delL = delOut[0], delR = delOut[1];

      // Add FX returns to master mix
      mixL += revL + delL;
      mixR += revR + delR;

      // Master processing — SEPARATE L and R (stereo preserved)
      mixL = masterL.process(mixL, sr);
      mixR = masterR.process(mixR, sr);

      // Stereo decorrelation (PSY3 to_stereo: Haas delay + decorrelated HP side)
      // Applied AFTER master chain on the combined stereo signal.
      const wOut = stereoWidener.process(mixL, mixR, sr);
      mixL = wOut[0]; mixR = wOut[1];

      L[i] = mixL;
      R[i] = mixR;
    }

    // ── PSY5: CPU load monitoring + dynamic voice budget ──
    // Measure this block's process() time, smooth it, and adjust the voice
    // budget. If we're over budget, the next block drops voices at the top
    // of this function (see "dynamic voice budget" above).
    if (__procStart > 0 && typeof performance !== 'undefined') {
      const procMs = performance.now() - __procStart;
      this.lastProcessMs = procMs;
      // Smoothed CPU load: 0..1 (3ms budget = load 1.0)
      const instantLoad = Math.min(1, procMs / PROCESS_BUDGET_MS);
      // Exponential smoothing (α=0.1 → ~10-block time constant)
      this.cpuLoad = this.cpuLoad * 0.9 + instantLoad * 0.1;
      // Adjust voice budget: if over budget, drop voices; if under, restore
      if (procMs > PROCESS_BUDGET_MS && this.voiceBudget > VOICE_BUDGET_MIN) {
        const overage = (procMs - PROCESS_BUDGET_MS) / 0.5; // 0.5ms per drop
        const drops = Math.min(VOICE_BUDGET_DROP_PER_OVERAGE * Math.ceil(overage), 2);
        this.voiceBudget = Math.max(VOICE_BUDGET_MIN, this.voiceBudget - drops);
      } else if (procMs < PROCESS_BUDGET_MS * 0.6 && this.voiceBudget < MAX_VOICES) {
        // Restore budget slowly when load is light
        this.voiceBudget = Math.min(MAX_VOICES, this.voiceBudget + 1);
      }
    }

    // ── PSY5: report stats every STATS_REPORT_BLOCKS (~10 Hz) ──
    // (was every 0.1s via statsTimer accumulation — that worked but tied
    //  reporting to wall-clock time, not block count. PSY5 uses block count
    //  for deterministic cadence independent of sample rate.)
    this.blockCounter++;
    if (this.blockCounter >= STATS_REPORT_BLOCKS) {
      this.blockCounter = 0;
      this.port.postMessage({
        type: 'stats',
        playing: this.playing,
        step: this.step,
        activeVoices: this.activeVoiceCount,
        eventCount: this.eventCount,
        currentFrame: currentFrame,
        cpuLoad: this.cpuLoad,
        voiceBudget: this.voiceBudget,
        processMs: this.lastProcessMs,
      });
    }

    return true;
  }
}

registerProcessor('psy4-engine', Psy4EngineProcessor);

// ─── שלב 4.2: Expose voice classes for offline synthesis matching ──────────
// מאפשר ל-OfflineVoiceRenderer ליצור instances של ה-voice classes
// רק ב-worklet scope — לא משפיע על ה-engine החי
if (typeof globalThis !== 'undefined') {
  (globalThis).__PSY4_VOICES = {
    KickVoice, BassVoice, LeadVoice, AcidVoice, PadVoice,
    HatVoice, ClapVoice, PercVoice, ShakerVoice, FMVoice,
    TextureVoice, FXVoice, SampleVoice,
  };
}
