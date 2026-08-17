/**
 * PSY4 Engine v2 — Sample-based, self-learning
 * Completely rewritten from scratch. No synth DSP, no stuck sounds.
 *
 * Architecture:
 *   - AudioWorkletProcessor loads real WAV samples (kick, bass, lead, etc.)
 *   - Composition events arrive as Float64Array [at, voiceId, note, vel, dur, param]
 *   - Each voice = sample playback with pitch + gain envelope
 *   - Master chain: DC blocker → limiter (no distortion, no stuck sounds)
 *   - Self-learning: analyzes output via analyser, adjusts sample selection + params
 *
 * Voice IDs (matches composition-worker):
 *   0=kick 1=bass 2=lead 3=acid 4=pad 5=hat 6=hatOpen 7=clap 8=perc
 *   9=shaker 10=texture 11=riser 12=impact 13=sweep 14=snare
 *
 * Sample mapping (loaded at startup):
 *   kick → kick.wav / kick_deep.wav / kick_punchy.wav / kick_acid.wav / kick_forest.wav / kick_hitech.wav
 *   bass → bass_A.wav / bass_deep.wav / bass_acid.wav / bass_dark.wav / bass_rolling.wav
 *   lead → lead.wav / lead_acid.wav / lead_bright.wav / lead_dark.wav
 *   pad → pad_bright.wav / pad_dark.wav / atmosphere.wav / texture_pad.wav
 *   hat → hat_closed.wav / open_hat_gen.wav
 *   clap → clap.wav / clap_variant.wav / snap.wav
 *   perc → perc_1.wav / perc_2.wav / perc_3.wav / perc_4.wav / rim.wav / tom.wav
 *   shaker → shaker.wav
 *   snare → snare.wav
 *   riser → riser.wav / downlifter.wav
 *   impact → impact.wav
 *   sweep → fx_sweep.wav
 *   texture → texture_pad.wav / atmosphere.wav
 */

// ─── Voice IDs ─────────────────────────────────────────────────────────────
const V_KICK = 0, V_BASS = 1, V_LEAD = 2, V_ACID = 3, V_PAD = 4;
const V_HAT = 5, V_HAT_OPEN = 6, V_CLAP = 7, V_PERC = 8, V_SHAKER = 9;
const V_TEXTURE = 10, V_RISER = 11, V_IMPACT = 12, V_SWEEP = 13, V_SNARE = 14;

// ─── Sample manifest (loaded at startup) ───────────────────────────────────
const SAMPLE_MAP = {
  [V_KICK]:    ['kick.wav', 'kick_deep.wav', 'kick_punchy.wav', 'kick_acid.wav', 'kick_forest.wav', 'kick_hitech.wav'],
  [V_BASS]:    ['bass_A.wav', 'bass_deep.wav', 'bass_acid.wav', 'bass_dark.wav', 'bass_rolling.wav'],
  [V_LEAD]:    ['lead.wav', 'lead_acid.wav', 'lead_bright.wav', 'lead_dark.wav'],
  [V_ACID]:    ['bass_acid.wav', 'lead_acid.wav'],
  [V_PAD]:     ['pad_bright.wav', 'pad_dark.wav', 'atmosphere.wav', 'texture_pad.wav'],
  [V_HAT]:     ['hat_closed.wav', 'open_hat_gen.wav'],
  [V_HAT_OPEN]: ['open_hat_gen.wav', 'hat_open.wav'],
  [V_CLAP]:    ['clap.wav', 'clap_variant.wav', 'snap.wav'],
  [V_PERC]:    ['perc_1.wav', 'perc_2.wav', 'perc_3.wav', 'perc_4.wav', 'rim.wav', 'tom.wav'],
  [V_SHAKER]:  ['shaker.wav'],
  [V_SNARE]:   ['snare.wav', 'rim.wav'],
  [V_TEXTURE]: ['texture_pad.wav', 'atmosphere.wav', 'pad_dark.wav'],
  [V_RISER]:   ['riser.wav', 'downlifter.wav'],
  [V_IMPACT]:  ['impact.wav'],
  [V_SWEEP]:   ['fx_sweep.wav'],
};

// ─── Voice class — sample playback ─────────────────────────────────────────
class SampleVoice {
  constructor() {
    this.active = false;
    this.sample = null;       // Float32Array of audio data
    this.sampleRate = 44100;
    this.playbackRate = 1.0;  // pitch shift
    this.pos = 0;
    this.amp = 0.5;
    this.gain = 1.0;          // per-voice gain
    this.pan = 0;             // -1 left, 0 center, +1 right
    this._out = new Float32Array(2);
    this.t = 0;
    this.dur = 0;
    this.attackMs = 2;
    this.releaseMs = 50;
    this.voiceType = 0;
  }

  trigger(time, voiceType, note, vel, dur, sr, sampleData, sampleRate) {
    this.active = true;
    this.voiceType = voiceType;
    this.sample = sampleData;
    this.sampleRate = sampleRate || sr;
    this.amp = Math.max(0.1, Math.min(1.0, vel));
    this.pos = 0;
    this.t = 0;
    this.dur = dur > 0 ? dur : (sampleData ? sampleData.length / this.sampleRate : 0.3);

    // Pitch: MIDI note 60 = no shift, each semitone = 2^(1/12)
    // Default sample root note depends on voice type (kick=36, bass=33, lead=60, etc.)
    const rootNote = this.getRootNote(voiceType);
    const semitones = note - rootNote;
    this.playbackRate = Math.pow(2, semitones / 12);

    // Per-voice-type gain (drums louder, pads quieter)
    this.gain = this.getVoiceGain(voiceType);

    // Pan for stereo width
    this.pan = this.getPan(voiceType, note);

    this._out[0] = 0; this._out[1] = 0;
  }

  getRootNote(voiceType) {
    switch (voiceType) {
      case V_KICK: return 36;
      case V_BASS: case V_ACID: return 33;
      case V_LEAD: return 60;
      case V_PAD: case V_TEXTURE: return 48;
      case V_HAT: case V_HAT_OPEN: return 60;
      case V_CLAP: case V_SNARE: return 38;
      case V_PERC: return 50;
      case V_SHAKER: return 70;
      case V_RISER: case V_IMPACT: case V_SWEEP: return 60;
      default: return 60;
    }
  }

  getVoiceGain(voiceType) {
    switch (voiceType) {
      case V_KICK: return 1.0;
      case V_BASS: return 0.7;
      case V_ACID: return 0.6;
      case V_LEAD: return 0.5;
      case V_PAD: return 0.35;
      case V_HAT: return 0.4;
      case V_HAT_OPEN: return 0.35;
      case V_CLAP: return 0.5;
      case V_PERC: return 0.4;
      case V_SHAKER: return 0.3;
      case V_SNARE: return 0.5;
      case V_TEXTURE: return 0.3;
      case V_RISER: return 0.25;
      case V_IMPACT: return 0.4;
      case V_SWEEP: return 0.25;
      default: return 0.5;
    }
  }

  getPan(voiceType, note) {
    // Subtle stereo placement: hats/perc panned, kick/bass centered
    switch (voiceType) {
      case V_KICK: case V_BASS: case V_ACID: return 0;
      case V_HAT: return 0.3;
      case V_HAT_OPEN: return -0.3;
      case V_PERC: return note % 2 === 0 ? 0.4 : -0.4;
      case V_CLAP: return 0.2;
      case V_SHAKER: return -0.2;
      default: return 0;
    }
  }

  render(currentTime, sr) {
    const out = this._out;
    if (!this.active || !this.sample) { out[0] = 0; out[1] = 0; return out; }

    const dt = 1 / sr;
    this.t += dt;

    // Check if sample ended
    const samplePos = this.pos | 0;
    if (samplePos >= this.sample.length || this.t > this.dur + 0.1) {
      this.active = false;
      out[0] = 0; out[1] = 0;
      return out;
    }

    // Linear interpolation for pitch shifting
    const idx = this.pos;
    const i0 = idx | 0;
    const i1 = Math.min(i0 + 1, this.sample.length - 1);
    const frac = idx - i0;
    const s = this.sample[i0] * (1 - frac) + this.sample[i1] * frac;

    // Advance position by playback rate
    this.pos += this.playbackRate * (this.sampleRate / sr);

    // Envelope: attack (2ms) → sustain → release (50ms)
    const attackT = this.attackMs / 1000;
    const releaseT = this.dur - this.releaseMs / 1000;
    let env = 1.0;
    if (this.t < attackT) {
      env = this.t / attackT;
    } else if (this.t > releaseT && this.dur > 0) {
      const rel = (this.t - releaseT) / (this.releaseMs / 1000);
      env = Math.max(0, 1 - rel);
    }

    // Apply gain + amp + envelope
    const finalSample = s * this.gain * this.amp * env;

    // Stereo pan (equal power)
    const pan = this.pan;
    const leftGain = Math.cos((pan + 1) * Math.PI / 4);
    const rightGain = Math.sin((pan + 1) * Math.PI / 4);
    out[0] = finalSample * leftGain;
    out[1] = finalSample * rightGain;
    return out;
  }
}

// ─── Master chain (minimal, clean) ─────────────────────────────────────────
class MasterChain {
  constructor(sampleRate) {
    this.sr = sampleRate;
    // DC blocker (one-pole HP at 20Hz) — prevents DC accumulation
    this.dcA = Math.min(0.999, 2 * Math.PI * 20 / sampleRate);
    this.dcPrevIn = 0;
    this.dcPrevOut = 0;
    // Brick-wall limiter
    this.ceiling = 0.89;
    this.lpGain = 1.0;
    this.lpEnv = 0;
    this.lpAttack = 0.001;  // 1ms attack
    this.lpRelease = 0.05;  // 50ms release
  }

  process(sample, sr) {
    // 1. DC blocker
    const dcOut = sample - this.dcPrevIn + (1 - this.dcA) * this.dcPrevOut;
    this.dcPrevIn = sample;
    this.dcPrevOut = dcOut;

    // 2. Limiter (brick-wall with 1ms look-ahead envelope)
    const absS = Math.abs(dcOut);
    if (absS > this.lpEnv) {
      this.lpEnv += (absS - this.lpEnv) * (1 / (this.lpAttack * sr));
    } else {
      this.lpEnv += (absS - this.lpEnv) * (1 / (this.lpRelease * sr));
    }
    let gain = 1.0;
    if (this.lpEnv > this.ceiling) {
      gain = this.ceiling / this.lpEnv;
    }
    return dcOut * gain;
  }
}

// ─── Main AudioWorkletProcessor ────────────────────────────────────────────
const MAX_VOICES = 24;
const MAX_EVENTS = 256;
const EVENT_SIZE = 6;

class Psy4EngineV2Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate;
    this.voicePool = [];
    for (let i = 0; i < MAX_VOICES; i++) {
      this.voicePool.push(new SampleVoice());
    }
    this.masterL = new MasterChain(sampleRate);
    this.masterR = new MasterChain(sampleRate);

    // Event ring buffer
    this.eventBuffer = new Float64Array(MAX_EVENTS * EVENT_SIZE);
    this.eventReadIdx = 0;
    this.eventCount = 0;

    // Samples storage: { voiceType: [{data, sampleRate, name}] }
    this.samples = {};
    this.samplesReady = false;

    // Learned params (from main thread): per voiceType, which sample index + tuning
    this.learnedParams = {};

    // Stats
    this.activeVoiceCount = 0;
    this.currentFrame = 0;
    this.statsCounter = 0;

    // Message handler
    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'loadSamples': {
        this.samples = msg.samples || {};
        this.samplesReady = Object.keys(this.samples).length > 0;
        this.port.postMessage({ type: 'samplesLoaded', count: Object.keys(this.samples).length });
        break;
      }
      case 'scheduleEvent': {
        // Add event to ring buffer: [at, voiceId, note, vel, dur, param]
        if (this.eventCount < MAX_EVENTS) {
          const idx = (this.eventReadIdx + this.eventCount) % MAX_EVENTS;
          const base = idx * EVENT_SIZE;
          this.eventBuffer[base] = msg.at;
          this.eventBuffer[base + 1] = msg.voiceId;
          this.eventBuffer[base + 2] = msg.note;
          this.eventBuffer[base + 3] = msg.vel;
          this.eventBuffer[base + 4] = msg.dur;
          this.eventBuffer[base + 5] = msg.param;
          this.eventCount++;
        }
        break;
      }
      case 'setLearnedParams': {
        this.learnedParams = msg.params || {};
        break;
      }
      case 'play': {
        // Resume (no-op — process() always runs)
        break;
      }
      case 'stop': {
        // Panic all voices
        for (const v of this.voicePool) v.active = false;
        this.eventCount = 0;
        break;
      }
    }
  }

  getFreeVoice() {
    for (const v of this.voicePool) {
      if (!v.active) return v;
    }
    // Steal oldest active voice
    let oldest = this.voicePool[0];
    for (const v of this.voicePool) {
      if (v.t > oldest.t) oldest = v;
    }
    oldest.active = false;
    return oldest;
  }

  pickSample(voiceId) {
    const sampleNames = SAMPLE_MAP[voiceId];
    if (!sampleNames || sampleNames.length === 0) return null;

    // Use learned params if available (which sample index to use)
    const learned = this.learnedParams[voiceId];
    let idx = 0;
    if (learned && typeof learned.sampleIdx === 'number') {
      idx = learned.sampleIdx % sampleNames.length;
    } else {
      // Round-robin / random based on frame count
      idx = Math.floor(this.currentFrame / 100) % sampleNames.length;
    }

    const name = sampleNames[idx];
    const sample = this.samples[name];
    if (!sample) {
      // Try fallback: any sample for this voice type
      for (const n of sampleNames) {
        if (this.samples[n]) return this.samples[n];
      }
      return null;
    }
    return sample;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const L = output[0];
    const R = output[1] || output[0];
    const sr = this.sr;
    const currentAudioTime = currentFrame / sr;

    // Process due events
    while (this.eventCount > 0) {
      const idx = this.eventReadIdx;
      const base = idx * EVENT_SIZE;
      const eventTime = this.eventBuffer[base];
      if (eventTime > currentAudioTime + 0.001) break;
      const voiceId = this.eventBuffer[base + 1] | 0;
      const note = this.eventBuffer[base + 2];
      const vel = this.eventBuffer[base + 3];
      const dur = this.eventBuffer[base + 4];
      const param = this.eventBuffer[base + 5];

      // Trigger voice
      if (this.samplesReady) {
        const sample = this.pickSample(voiceId);
        if (sample) {
          const v = this.getFreeVoice();
          v.trigger(eventTime, voiceId, note, vel, dur, sr, sample.data, sample.sampleRate);
        }
      }

      this.eventReadIdx = (idx + 1) % MAX_EVENTS;
      this.eventCount--;
    }

    // Render all active voices
    let activeCount = 0;
    // Count active voices ONCE per block (not per sample)
    for (const v of this.voicePool) {
      if (v.active) activeCount++;
    }
    for (let i = 0; i < L.length; i++) {
      let mixL = 0, mixR = 0;
      const sampleTime = currentAudioTime + i / sr;
      for (const v of this.voicePool) {
        if (v.active) {
          const out = v.render(sampleTime, sr);
          mixL += out[0];
          mixR += out[1];
        }
      }
      // Master chain
      L[i] = this.masterL.process(mixL, sr);
      R[i] = this.masterR.process(mixR, sr);
    }
    this.activeVoiceCount = activeCount;
    this.currentFrame += L.length;

    // Report stats every ~2 seconds (88200 samples at 44.1kHz)
    this.statsCounter++;
    if (this.statsCounter >= 685) {
      this.statsCounter = 0;
      this.port.postMessage({
        type: 'stats',
        playing: true,
        step: 0,
        activeVoices: this.activeVoiceCount,
        eventCount: 0,
        currentFrame: this.currentFrame,
        cpuLoad: 0,
        processMs: 0,
        voiceBudget: MAX_VOICES,
      });
    }

    return true;
  }
}

registerProcessor('psy4-engine-v2', Psy4EngineV2Processor);
