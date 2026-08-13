/**
 * MaterialRealizer — the full realization engine.
 *
 * Replaces the old 4-voice synth (kick/bass/lead/hat) with a complete
 * material realization system that handles ALL material families:
 *
 * - Drums: REAL SAMPLES from public/samples/real/ (kick, snare, clap, hats, perc, tom, ride)
 * - Bass: 3-layer synth (sub + mid + character) with filter envelope
 * - Lead: FM/unison synth with filter modulation
 * - Counterline: complementary synth voice
 * - Pad: sustained chordal synth
 * - Atmosphere: noise-based texture
 * - Transition: riser/impact synth
 *
 * This is HOW. The CausalComposer decides WHAT/WHEN.
 */

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export interface RealizerOptions {
  audioContext: AudioContext;
  masterGain: GainNode;
}

interface SampleBank {
  [category: string]: AudioBuffer[];
}

export class MaterialRealizer {
  private ctx: AudioContext;
  private master: GainNode;
  private samples: SampleBank = {};
  private samplesLoaded = false;
  private noiseBuffer: AudioBuffer | null = null;

  // Per-voice buses
  private drumBus: GainNode;
  private bassBus: GainNode;
  private leadBus: GainNode;
  private textureBus: GainNode;
  private transitionBus: GainNode;

  constructor(opts: RealizerOptions) {
    this.ctx = opts.audioContext;
    this.master = opts.masterGain;

    // Create buses
    this.drumBus = this.ctx.createGain(); this.drumBus.gain.value = 0.8;
    this.bassBus = this.ctx.createGain(); this.bassBus.gain.value = 0.6;
    this.leadBus = this.ctx.createGain(); this.leadBus.gain.value = 0.45;
    this.textureBus = this.ctx.createGain(); this.textureBus.gain.value = 0.3;
    this.transitionBus = this.ctx.createGain(); this.transitionBus.gain.value = 0.5;

    this.drumBus.connect(this.master);
    this.bassBus.connect(this.master);
    this.leadBus.connect(this.master);
    this.textureBus.connect(this.master);
    this.transitionBus.connect(this.master);

    // Create noise buffer for texture/atmosphere
    const noiseLen = this.ctx.sampleRate * 2;
    this.noiseBuffer = this.ctx.createBuffer(1, noiseLen, this.ctx.sampleRate);
    const noiseData = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) noiseData[i] = Math.random() * 2 - 1;
  }

  /**
   * Load real drum samples from public/samples/real/
   */
  async loadSamples(): Promise<void> {
    if (this.samplesLoaded) return;

    const sampleMap: Record<string, string[]> = {
      kick: ['md_kick_Kicks_0051.wav', '909_BD_02.wav', '909_BD_04.wav', 'nord_kick_punchy_67.wav'],
      snare: ['md_snare_Snares_0000.wav', 'md_snare_Snares_0004.wav'],
      clap: ['md_clap_Claps_0006.wav', 'md_clap_Claps_0000.wav'],
      'hat-closed': ['md_hat_Hats_0008.wav', 'md_hat_Hats_0012.wav'],
      'hat-open': ['md_hat_Hats_0015.wav', 'md_hat_Hats_0019.wav'],
      percussion: ['md_perc_Percs_0001.wav', 'md_perc_Percs_0000.wav'],
      tom: ['md_tom_Toms_0000.wav', 'md_tom_Toms_0001.wav'],
      ride: ['md_ride_Cymbals_0000.wav', 'md_ride_Cymbals_0001.wav'],
      stab: ['md_stab_Stabs_0000.wav', 'md_stab_Stabs_0001.wav'],
    };

    for (const [category, files] of Object.entries(sampleMap)) {
      this.samples[category] = [];
      for (const file of files) {
        try {
          const response = await fetch(`/samples/real/${file}`);
          if (!response.ok) continue;
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
          this.samples[category].push(audioBuffer);
        } catch (e) {
          // Skip failed samples
        }
      }
    }

    this.samplesLoaded = true;
  }

  /**
   * Realize a causal event — route to the appropriate voice.
   */
  realize(event: { at: number; note: number; velocity: number; duration: number; channel: string; materialId?: string }): void {
    const { at, note, velocity, duration, channel } = event;

    switch (channel) {
      // ── DRUMS (sample-based) ──
      case 'kick': this.playSample('kick', at, velocity); break;
      case 'snare': this.playSample('snare', at, velocity * 0.7); break;
      case 'clap': this.playSample('clap', at, velocity * 0.6); break;
      case 'hat-closed': this.playSample('hat-closed', at, velocity * 0.5); break;
      case 'hat-open': this.playSample('hat-open', at, velocity * 0.5); break;
      case 'hat': this.playSample('hat-closed', at, velocity * 0.5); break;
      case 'percussion': this.playSample('percussion', at, velocity * 0.5); break;
      case 'tom': this.playSample('tom', at, velocity * 0.6); break;
      case 'ride': this.playSample('ride', at, velocity * 0.4); break;
      case 'rim': this.playSample('percussion', at, velocity * 0.4); break;
      case 'shaker': this.playSample('hat-closed', at, velocity * 0.25); break;
      case 'crash': this.playSample('ride', at, velocity * 0.7); break;
      case 'stab': this.playSample('stab', at, velocity * 0.7); break;

      // ── BASS (synth) ──
      case 'bass': this.playBass(at, mtof(note), velocity, duration); break;
      case 'sub': this.playBass(at, mtof(note), velocity * 0.8, duration, true); break;

      // ── MUSICAL (synth) ──
      case 'lead': this.playLead(at, mtof(note), velocity, duration, false); break;
      case 'motif': this.playLead(at, mtof(note), velocity, duration, false); break;
      case 'counterline': this.playLead(at, mtof(note), velocity * 0.8, duration, true); break;
      case 'arp': this.playLead(at, mtof(note), velocity * 0.6, duration * 0.5, false); break;
      case 'chord': this.playPad(at, mtof(note), velocity, duration); break;

      // ── TEXTURE (synth) ──
      case 'pad': this.playPad(at, mtof(note), velocity, duration); break;
      case 'drone': this.playPad(at, mtof(note), velocity * 0.7, duration); break;
      case 'atmosphere': this.playAtmosphere(at, velocity, duration); break;
      case 'texture': this.playTexture(at, mtof(note), velocity, duration); break;

      // ── TRANSITION (synth) ──
      case 'riser': this.playRiser(at, velocity, duration); break;
      case 'impact': this.playImpact(at, velocity); break;
      case 'downlifter': this.playRiser(at, velocity * 0.5, duration, true); break;
      case 'sweep': this.playSweep(at, velocity, duration); break;
      case 'reverse': this.playSweep(at, velocity * 0.6, duration); break;
      case 'fill': this.playSample('tom', at, velocity * 0.6); break;

      default:
        // Unknown channel — try as drum sample, skip if not found
        if (this.samples[channel]) this.playSample(channel, at, velocity);
        break;
    }
  }

  // ─── SAMPLE PLAYBACK ──────────────────────────────────────────────────

  private playSample(category: string, time: number, velocity: number): void {
    const bank = this.samples[category];
    if (!bank || bank.length === 0) return;

    // Deterministic round-robin
    const idx = Math.floor(time * 7.3) % bank.length;
    const buffer = bank[idx];

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = 1.0;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + buffer.duration);

    src.connect(gain);
    gain.connect(this.drumBus);
    src.start(time);
    src.stop(time + buffer.duration + 0.05);
  }

  // ─── BASS SYNTH ───────────────────────────────────────────────────────

  private playBass(time: number, freq: number, velocity: number, duration: number, subOnly = false): void {
    const decay = Math.min(duration * 0.9, 0.15);

    // SUB layer
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = freq;
    const subGain = this.ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, time);
    subGain.gain.linearRampToValueAtTime(0.5 * velocity, time + 0.001);
    subGain.gain.linearRampToValueAtTime(0, time + decay);
    sub.connect(subGain); subGain.connect(this.bassBus);
    sub.start(time); sub.stop(time + decay + 0.01);

    if (subOnly) return;

    // MID layer — sawtooth through closing filter
    const mid = this.ctx.createOscillator();
    mid.type = 'sawtooth';
    mid.frequency.value = freq;
    mid.detune.value = -5;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 8;
    filter.frequency.setValueAtTime(800, time);
    filter.frequency.exponentialRampToValueAtTime(150, time + 0.025);

    const midGain = this.ctx.createGain();
    midGain.gain.setValueAtTime(0.0001, time);
    midGain.gain.linearRampToValueAtTime(0.3 * velocity, time + 0.001);
    midGain.gain.linearRampToValueAtTime(0, time + decay);

    mid.connect(filter); filter.connect(midGain); midGain.connect(this.bassBus);
    mid.start(time); mid.stop(time + decay + 0.01);

    // CHARACTER — noise transient
    if (this.noiseBuffer) {
      const char = this.ctx.createBufferSource();
      char.buffer = this.noiseBuffer;
      const charBp = this.ctx.createBiquadFilter();
      charBp.type = 'bandpass';
      charBp.frequency.value = freq * 4;
      charBp.Q.value = 2;
      const charGain = this.ctx.createGain();
      charGain.gain.setValueAtTime(0.12 * velocity, time);
      charGain.gain.exponentialRampToValueAtTime(0.001, time + 0.01);
      char.connect(charBp); charBp.connect(charGain); charGain.connect(this.bassBus);
      char.start(time); char.stop(time + 0.012);
    }
  }

  // ─── LEAD SYNTH (FM + unison) ─────────────────────────────────────────

  private playLead(time: number, freq: number, velocity: number, duration: number, lowerRegister: boolean): void {
    const peak = velocity * (lowerRegister ? 0.35 : 0.45);
    const dur = Math.max(duration, 0.15);

    // FM carrier + modulator
    const carrier = this.ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = freq;

    const modulator = this.ctx.createOscillator();
    modulator.type = 'sine';
    modulator.frequency.value = freq * 2; // 2:1 ratio
    const modGain = this.ctx.createGain();
    modGain.gain.setValueAtTime(freq * 2, time);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.5, time + dur * 0.5);
    modulator.connect(modGain);
    modGain.connect(carrier.frequency);

    // Unison detune (2 extra voices)
    const uni1 = this.ctx.createOscillator();
    uni1.type = 'sawtooth';
    uni1.frequency.value = freq;
    uni1.detune.value = 7;
    const uni2 = this.ctx.createOscillator();
    uni2.type = 'sawtooth';
    uni2.frequency.value = freq;
    uni2.detune.value = -7;

    // Filter with envelope
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 6;
    const cutoffStart = lowerRegister ? 1200 : 2400;
    const cutoffEnd = lowerRegister ? 400 : 800;
    filter.frequency.setValueAtTime(cutoffStart, time);
    filter.frequency.exponentialRampToValueAtTime(cutoffEnd, time + dur * 0.4);

    // VCA
    const vca = this.ctx.createGain();
    vca.gain.setValueAtTime(0.0001, time);
    vca.gain.exponentialRampToValueAtTime(peak, time + 0.01);
    vca.gain.exponentialRampToValueAtTime(peak * 0.5, time + dur * 0.5);
    vca.gain.exponentialRampToValueAtTime(0.001, time + dur);

    // Stereo pan for unison
    const pan1 = this.ctx.createStereoPanner(); pan1.pan.value = -0.4;
    const pan2 = this.ctx.createStereoPanner(); pan2.pan.value = 0.4;

    carrier.connect(filter);
    uni1.connect(pan1); pan1.connect(filter);
    uni2.connect(pan2); pan2.connect(filter);
    filter.connect(vca);
    vca.connect(this.leadBus);

    carrier.start(time); carrier.stop(time + dur + 0.05);
    modulator.start(time); modulator.stop(time + dur + 0.05);
    uni1.start(time); uni1.stop(time + dur + 0.05);
    uni2.start(time); uni2.stop(time + dur + 0.05);
  }

  // ─── PAD SYNTH ────────────────────────────────────────────────────────

  private playPad(time: number, freq: number, velocity: number, duration: number): void {
    const dur = Math.max(duration, 1.0);
    const peak = velocity * 0.25;

    // 3 detuned saws
    const oscs: OscillatorNode[] = [];
    const detunes = [-7, 0, 7];
    for (const det of detunes) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      oscs.push(o);
    }

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(300, time);
    filter.frequency.linearRampToValueAtTime(800, time + dur * 0.3);
    filter.frequency.linearRampToValueAtTime(400, time + dur);

    const vca = this.ctx.createGain();
    vca.gain.setValueAtTime(0.0001, time);
    vca.gain.linearRampToValueAtTime(peak, time + 0.3);
    vca.gain.setValueAtTime(peak, time + dur - 0.3);
    vca.gain.linearRampToValueAtTime(0.0001, time + dur);

    // Stereo spread
    const panL = this.ctx.createStereoPanner(); panL.pan.value = -0.5;
    const panR = this.ctx.createStereoPanner(); panR.pan.value = 0.5;
    oscs[0].connect(panL); panL.connect(filter);
    oscs[2].connect(panR); panR.connect(filter);
    oscs[1].connect(filter);
    filter.connect(vca);
    vca.connect(this.textureBus);

    for (const o of oscs) { o.start(time); o.stop(time + dur + 0.1); }
  }

  // ─── ATMOSPHERE (noise texture) ───────────────────────────────────────

  private playAtmosphere(time: number, velocity: number, duration: number): void {
    if (!this.noiseBuffer) return;
    const dur = Math.max(duration, 2.0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, time);
    lp.frequency.linearRampToValueAtTime(2000, time + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(400, time + dur);

    const vca = this.ctx.createGain();
    vca.gain.setValueAtTime(0.0001, time);
    vca.gain.linearRampToValueAtTime(velocity * 0.2, time + 0.5);
    vca.gain.setValueAtTime(velocity * 0.2, time + dur - 0.5);
    vca.gain.linearRampToValueAtTime(0.0001, time + dur);

    src.connect(lp); lp.connect(vca); vca.connect(this.textureBus);
    src.start(time); src.stop(time + dur + 0.1);
  }

  // ─── TEXTURE (FM noise hybrid) ────────────────────────────────────────

  private playTexture(time: number, freq: number, velocity: number, duration: number): void {
    const dur = Math.max(duration, 1.0);

    // Oscillator with slow FM
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;

    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.5 + Math.random() * 2;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = freq * 0.3;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq * 2;
    filter.Q.value = 5;

    const vca = this.ctx.createGain();
    vca.gain.setValueAtTime(0.0001, time);
    vca.gain.linearRampToValueAtTime(velocity * 0.15, time + 0.2);
    vca.gain.linearRampToValueAtTime(0.0001, time + dur);

    osc.connect(filter); filter.connect(vca); vca.connect(this.textureBus);
    osc.start(time); osc.stop(time + dur + 0.1);
    lfo.start(time); lfo.stop(time + dur + 0.1);
  }

  // ─── RISER ────────────────────────────────────────────────────────────

  private playRiser(time: number, velocity: number, duration: number, downlifter = false): void {
    const dur = Math.max(duration, 1.0);
    if (!this.noiseBuffer) return;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    if (downlifter) {
      bp.frequency.setValueAtTime(5000, time);
      bp.frequency.exponentialRampToValueAtTime(200, time + dur);
    } else {
      bp.frequency.setValueAtTime(200, time);
      bp.frequency.exponentialRampToValueAtTime(8000, time + dur);
    }

    const vca = this.ctx.createGain();
    vca.gain.setValueAtTime(0.0001, time);
    vca.gain.linearRampToValueAtTime(velocity * 0.3, time + dur * 0.8);
    vca.gain.linearRampToValueAtTime(velocity * 0.5, time + dur);
    vca.gain.linearRampToValueAtTime(0.0001, time + dur + 0.1);

    src.connect(bp); bp.connect(vca); vca.connect(this.transitionBus);
    src.start(time); src.stop(time + dur + 0.2);
  }

  // ─── IMPACT ───────────────────────────────────────────────────────────

  private playImpact(time: number, velocity: number): void {
    if (!this.noiseBuffer) return;

    // Noise burst
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5000, time);
    lp.frequency.exponentialRampToValueAtTime(100, time + 0.3);
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(velocity * 0.5, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
    src.connect(lp); lp.connect(noiseGain); noiseGain.connect(this.transitionBus);
    src.start(time); src.stop(time + 0.35);

    // Sub sine drop
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(120, time);
    sub.frequency.exponentialRampToValueAtTime(40, time + 0.15);
    const subGain = this.ctx.createGain();
    subGain.gain.setValueAtTime(velocity * 0.6, time);
    subGain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
    sub.connect(subGain); subGain.connect(this.transitionBus);
    sub.start(time); sub.stop(time + 0.25);
  }

  // ─── SWEEP ────────────────────────────────────────────────────────────

  private playSweep(time: number, velocity: number, duration: number): void {
    if (!this.noiseBuffer) return;
    const dur = Math.max(duration, 0.5);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 5;
    bp.frequency.setValueAtTime(500, time);
    bp.frequency.linearRampToValueAtTime(3000, time + dur);
    bp.frequency.linearRampToValueAtTime(500, time + dur * 2);

    const vca = this.ctx.createGain();
    vca.gain.setValueAtTime(0.0001, time);
    vca.gain.linearRampToValueAtTime(velocity * 0.25, time + dur * 0.5);
    vca.gain.linearRampToValueAtTime(0.0001, time + dur * 2);

    src.connect(bp); bp.connect(vca); vca.connect(this.transitionBus);
    src.start(time); src.stop(time + dur * 2 + 0.1);
  }

  /**
   * Set bus volumes (for mixer control)
   */
  setBusVolume(bus: 'drum' | 'bass' | 'lead' | 'texture' | 'transition', vol: number): void {
    const buses: Record<string, GainNode> = {
      drum: this.drumBus, bass: this.bassBus, lead: this.leadBus,
      texture: this.textureBus, transition: this.transitionBus,
    };
    if (buses[bus]) buses[bus].gain.value = vol;
  }
}
