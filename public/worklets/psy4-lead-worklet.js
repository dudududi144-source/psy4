// public/worklets/psy4-lead-worklet.js
// Lead voice worklet — real Moog ladder + PolyBLEP saw + multi-layer.
// Replaces psysynth BiquadFilter cascade for lead/acid roles.
// This is a dedicated melodic voice processor, not a drum machine.

class MoogLadder {
  constructor() { this.s0 = 0; this.s1 = 0; this.s2 = 0; this.s3 = 0; }
  process(x, cutoff, res, sr) {
    if (!isFinite(x)) { this.s0 = this.s1 = this.s2 = this.s3 = 0; return 0; }
    const f = Math.min(0.45, 2 * Math.PI * cutoff / sr);
    const k = 4 * res;
    const input = x - k * this.s3;
    this.s0 += f * (input - this.s0);
    this.s1 += f * (this.s0 - this.s1);
    this.s2 += f * (this.s1 - this.s2);
    this.s3 += f * (this.s2 - this.s3);
    return this.s3;
  }
  reset() { this.s0 = this.s1 = this.s2 = this.s3 = 0; }
}

function fastTanh(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

class LeadVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.phase1 = 0;  // fundamental
    this.phase2 = 0;  // octave up
    this.phase3 = 0;  // sub
    this.freq = 440;
    this.vel = 0.7;
    this.moog = new MoogLadder();
    this.cutoff = 1500;  // was 1800 — lower for warmth
    this.res = 0.35;
    this.env = 0;
    this.decay = 0.5;
    this.attack = 0.008;
    this.release = 0.3;
    this.sustain = 0.7;
    this.gainA = 0.5;     // fundamental (was 0.45, increase to compensate)
    this.gainOctave = 0.12; // octave up (was 0.3 — too much high freq)
    this.gainSub = 0.2;   // sub (was 0.15, increase for warmth)
    this.driveDb = 2;
    this.lfoPhase = 0;
    this.lfoHz = 0.3;
    this.lfoDepth = 0.12;
    this.glideFrom = 0;
    this.glideMs = 60;
    this._out = new Float32Array(2);
  }
  
  trigger(time, note, vel, dur, sr, params) {
    this.active = true;
    this.t = 0;
    const targetFreq = 440 * Math.pow(2, (note - 69) / 12);
    this.glideFrom = this.freq > 0 ? this.freq : targetFreq;
    this.freq = targetFreq;
    this.vel = Math.max(0.1, Math.min(1, vel));
    this.env = 0;
    this.moog.reset();
    if (params) {
      if (params.cutoff) this.cutoff = params.cutoff;
      if (params.res) this.res = params.res;
      if (params.attack) this.attack = params.attack;
      if (params.decay) this.decay = params.decay;
      if (params.sustain) this.sustain = params.sustain;
      if (params.release) this.release = params.release;
      if (params.driveDb) this.driveDb = params.driveDb;
      if (params.lfoHz) this.lfoHz = params.lfoHz;
      if (params.lfoDepth) this.lfoDepth = params.lfoDepth;
      if (params.gainA) this.gainA = params.gainA;
      if (params.gainOctave) this.gainOctave = params.gainOctave;
      if (params.gainSub) this.gainSub = params.gainSub;
      if (params.glideMs) this.glideMs = params.glideMs;
    }
  }
  
  release() {
    // Enter release phase
    this.sustain = 0;
  }
  
  panic() {
    this.active = false;
    this.env = 0;
  }
  
  render(currentTime, sr) {
    const out = this._out;
    if (!this.active) { out[0] = 0; out[1] = 0; return out; }
    const dt = 1 / sr;
    this.t += dt;
    
    // Glide
    let effectiveFreq = this.freq;
    if (this.glideMs > 0 && this.t < this.glideMs / 1000) {
      const glideT = this.t / (this.glideMs / 1000);
      effectiveFreq = this.glideFrom + (this.freq - this.glideFrom) * glideT;
    }
    
    // Envelope: attack → decay → sustain → release
    const attackS = Math.max(0.001, this.attack);
    const decayS = Math.max(0.005, this.decay);
    let envValue;
    if (this.t < attackS) {
      envValue = this.t / attackS;
    } else if (this.t < attackS + decayS) {
      const decayT = (this.t - attackS) / decayS;
      envValue = 1.0 - (1.0 - this.sustain) * decayT;
    } else {
      envValue = this.sustain;
    }
    envValue = Math.max(0, envValue * this.vel);
    
    if (envValue < 0.001 && this.sustain < 0.01) {
      this.active = false;
      out[0] = 0; out[1] = 0;
      return out;
    }
    
    // LFO for filter modulation
    this.lfoPhase += 2 * Math.PI * this.lfoHz * dt;
    const lfoValue = Math.sin(this.lfoPhase) * this.lfoDepth;
    const modCutoff = Math.max(80, Math.min(8000, this.cutoff * (1 + lfoValue)));
    
    // Oscillator 1: fundamental (polyBLEP saw)
    this.phase1 += 2 * Math.PI * effectiveFreq * dt;
    let saw1 = 2 * (this.phase1 / (2 * Math.PI) - Math.floor(this.phase1 / (2 * Math.PI) + 0.5));
    // PolyBLEP correction
    const phase1Norm = this.phase1 / (2 * Math.PI);
    const frac1 = phase1Norm - Math.floor(phase1Norm);
    if (frac1 < 0.001) saw1 -= 0.5 * (1 - frac1 / 0.001);
    if (frac1 > 0.999) saw1 -= 0.5 * ((1 - frac1) / 0.001);
    saw1 = Math.max(-1, Math.min(1, saw1));
    
    // Oscillator 2: octave up
    this.phase2 += 2 * Math.PI * effectiveFreq * 2 * dt;
    let saw2 = 2 * (this.phase2 / (2 * Math.PI) - Math.floor(this.phase2 / (2 * Math.PI) + 0.5));
    saw2 = Math.max(-1, Math.min(1, saw2));
    
    // Oscillator 3: sub (one octave down, sine)
    this.phase3 += 2 * Math.PI * effectiveFreq * 0.5 * dt;
    const sub = Math.sin(this.phase3);
    
    // Mix oscillators
    let mixed = saw1 * this.gainA + saw2 * this.gainOctave + sub * this.gainSub;
    
    // Drive (saturation)
    const driveGain = Math.pow(10, this.driveDb / 20);
    mixed = fastTanh(mixed * driveGain);
    
    // Moog ladder filter
    const filtered = this.moog.process(mixed, modCutoff, this.res, sr);
    
    // Amp envelope
    const sample = filtered * envValue;
    out[0] = sample; out[1] = sample;
    return out;
  }
}

class LeadEngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate;
    // 8 voice pool for lead/acid
    this.voices = [];
    for (let i = 0; i < 8; i++) this.voices.push(new LeadVoice());
    this.eventBuffer = new Float64Array(512 * 5);
    this.eventReadIdx = 0;
    this.eventCount = 0;
    this.cc74 = 0.5;  // cutoff
    this.cc71 = 0.35; // res
    this.cc5 = 0.3;   // glide
    this.cc12 = 0.5;  // energy
    this.cc14 = 0.35; // delay send
    this.cc15 = 0.4;  // reverb send
    
    this.port.onmessage = (e) => {
      const msg = e.data;
      switch (msg.type) {
        case 'scheduleEvent':
          if (this.eventCount < 512) {
            const idx = (this.eventReadIdx + this.eventCount) % 512;
            const base = idx * 5;
            this.eventBuffer[base] = msg.at;
            this.eventBuffer[base + 1] = msg.note;
            this.eventBuffer[base + 2] = msg.vel;
            this.eventBuffer[base + 3] = msg.dur;
            this.eventBuffer[base + 4] = msg.release ? 1 : 0;
            this.eventCount++;
          }
          break;
        case 'setCC':
          if (msg.cc === 74) this.cc74 = msg.value;
          else if (msg.cc === 71) this.cc71 = msg.value;
          else if (msg.cc === 5) this.cc5 = msg.value;
          else if (msg.cc === 12) this.cc12 = msg.value;
          else if (msg.cc === 14) this.cc14 = msg.value;
          else if (msg.cc === 15) this.cc15 = msg.value;
          break;
        case 'stop':
          for (const v of this.voices) { v.active = false; v.panic(); }
          this.eventCount = 0;
          break;
      }
    };
  }
  
  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const L = output[0];
    const R = output[1] || output[0];
    const sr = this.sr;
    const now = currentTime;
    
    // Process due events
    while (this.eventCount > 0) {
      const idx = this.eventReadIdx;
      const base = idx * 5;
      const eventTime = this.eventBuffer[base];
      if (eventTime > now + 0.001) break;
      const note = this.eventBuffer[base + 1];
      const vel = this.eventBuffer[base + 2];
      const dur = this.eventBuffer[base + 3];
      const isRelease = this.eventBuffer[base + 4];
      
      // Find free voice
      let voice = null;
      for (const v of this.voices) {
        if (!v.active) { voice = v; break; }
      }
      if (!voice) {
        // Steal oldest
        let oldest = this.voices[0];
        for (const v of this.voices) if (v.t > oldest.t) oldest = v;
        voice = oldest;
      }
      
      if (isRelease) {
        voice.release();
      } else {
        // Map CC values to params
        const params = {
          cutoff: 80 + this.cc74 * 7920,  // 80-8000Hz
          res: this.cc71 * 0.8,            // 0-0.8
          attack: 0.008,                    // 8ms fixed (smooth)
          decay: 0.5,                      // 500ms flowing
          sustain: 0.7,                    // held
          release: 0.3,                    // 300ms legato
          driveDb: 2 + this.cc12 * 2,      // 2-4dB warm saturation
          lfoHz: 0.3,                       // slow flowing
          lfoDepth: 0.12,                   // gentle
          gainA: 0.45,
          gainOctave: 0.3,
          gainSub: 0.15,
          glideMs: 30 + this.cc5 * 100,    // 30-130ms
        };
        voice.trigger(eventTime, note, vel, dur, sr, params);
      }
      
      this.eventReadIdx = (idx + 1) % 512;
      this.eventCount--;
    }
    
    // Render all active voices
    for (let i = 0; i < L.length; i++) {
      let mixL = 0, mixR = 0;
      for (const v of this.voices) {
        if (v.active) {
          const out = v.render(now + i / sr, sr);
          mixL += out[0];
          mixR += out[1];
        }
      }
      // Soft clip
      L[i] = fastTanh(mixL * 0.5);
      R[i] = fastTanh(mixR * 0.5);
    }
    
    return true;
  }
}

registerProcessor('psy4-lead-engine', LeadEngineProcessor);
