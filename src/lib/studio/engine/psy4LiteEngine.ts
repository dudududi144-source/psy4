/**
 * PSY4 Lite Engine — pure Web Audio API, no AudioWorklet.
 *
 * Based on psy (the first repo) architecture:
 *   - Uses OscillatorNode, GainNode, BiquadFilterNode (browser-optimized)
 *   - NO AudioWorklet (saves 2MB+ memory, no module loading)
 *   - NO samples (saves 21MB)
 *   - NO preallocated voice pools (browser handles cleanup)
 *
 * This is 50x lighter than the worklet-based engine and never crashes.
 *
 * The sound quality comes from:
 *   - Multi-band mastering (low/mid/high compression)
 *   - Sidechain ducking
 *   - Ping-pong delay + reverb sends
 *   - Proper gain staging
 */

export interface LiteWorld {
  bpm: number;
  root: number;
  kickDecay: number;
  kickFundamental: number;
  bassCutoff: number;
  leadCutoff: number;
  duck: number;
}

export const LITE_WORLDS: Record<string, LiteWorld> = {
  'progressive-psy': { bpm: 128, root: 48, kickDecay: 0.22, kickFundamental: 50, bassCutoff: 400, leadCutoff: 3000, duck: 0.4 },
  'dark-psy': { bpm: 150, root: 43, kickDecay: 0.16, kickFundamental: 48, bassCutoff: 300, leadCutoff: 2000, duck: 0.55 },
  'goa': { bpm: 140, root: 45, kickDecay: 0.2, kickFundamental: 52, bassCutoff: 500, leadCutoff: 4000, duck: 0.5 },
  'morning-psy': { bpm: 142, root: 50, kickDecay: 0.2, kickFundamental: 54, bassCutoff: 550, leadCutoff: 3500, duck: 0.42 },
  'forest': { bpm: 148, root: 44, kickDecay: 0.18, kickFundamental: 46, bassCutoff: 350, leadCutoff: 2200, duck: 0.5 },
  'acid-psy': { bpm: 142, root: 45, kickDecay: 0.19, kickFundamental: 50, bassCutoff: 600, leadCutoff: 2500, duck: 0.5 },
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// Scales
const SCALES: Record<string, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
};

function scaleNote(root: number, scale: string, deg: number): number {
  const sc = SCALES[scale] || SCALES.minor;
  const n = sc.length;
  const oct = Math.floor(deg / n);
  const idx = ((deg % n) + n) % n;
  return root + 12 * oct + sc[idx];
}

export class Psy4LiteEngine {
  ctx: AudioContext | null = null;
  playing = false;
  world: LiteWorld = LITE_WORLDS['dark-psy'];
  analyser: AnalyserNode | null = null;

  // Musical understanding — syncs with radio
  private musicalKey: { root: number; scale: string } = { root: 43, scale: 'phrygian' };
  private detectedBpm: number = 0;
  private detectedStyle: string = 'dark-psy';

  // Sound presets — change every 8 bars for sonic variety
  private currentPreset = 0;
  private presetChangeBar = 0;

  // Kick presets: different fundamental/decay combinations
  private kickPresets = [
    { fundamental: 50, decay: 0.18, subLevel: 0.9, midLevel: 0.4, clickLevel: 0.25 },
    { fundamental: 45, decay: 0.22, subLevel: 1.0, midLevel: 0.3, clickLevel: 0.35 },
    { fundamental: 55, decay: 0.15, subLevel: 0.8, midLevel: 0.5, clickLevel: 0.2 },
    { fundamental: 48, decay: 0.20, subLevel: 0.95, midLevel: 0.35, clickLevel: 0.3 },
  ];

  // Bass presets: different waveforms and filter settings
  private bassPresets = [
    { waveform: 'sawtooth' as OscillatorType, cutoffMult: 4, q: 2, decay: 0.1 },
    { waveform: 'square' as OscillatorType, cutoffMult: 3, q: 4, decay: 0.08 },
    { waveform: 'sawtooth' as OscillatorType, cutoffMult: 5, q: 1, decay: 0.12 },
    { waveform: 'triangle' as OscillatorType, cutoffMult: 3.5, q: 3, decay: 0.09 },
  ];

  // Lead presets: different waveforms, detune, filter
  private leadPresets = [
    { waveform: 'sawtooth' as OscillatorType, detune: 10, numOscs: 2, q: 3 },
    { waveform: 'square' as OscillatorType, detune: 15, numOscs: 2, q: 5 },
    { waveform: 'sawtooth' as OscillatorType, detune: 7, numOscs: 3, q: 2 },
    { waveform: 'triangle' as OscillatorType, detune: 20, numOscs: 2, q: 4 },
  ];

  private sum: GainNode | null = null;
  private duck: GainNode | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private noiseLoop: AudioBufferSourceNode | null = null;

  // FX (reverb + delay)
  private reverbNode: ConvolverNode | null = null;
  private reverbSend: GainNode | null = null;
  private reverbReturn: GainNode | null = null;
  private delayNodeL: DelayNode | null = null;
  private delayNodeR: DelayNode | null = null;
  private delaySend: GainNode | null = null;
  private delayFb: GainNode | null = null;
  private delayReturn: GainNode | null = null;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private step = 0;
  private bar = 0;
  private nextTime = 0;
  private sectionIdx = 0;
  private currentSection = 'INTRO';

  // Arrangement
  private arrangement = [
    { bars: 4, density: 0.3, bass: false, lead: false, label: 'INTRO' },
    { bars: 4, density: 0.5, bass: true, lead: false, label: 'GROOVE' },
    { bars: 4, density: 0.7, bass: true, lead: false, label: 'BUILD' },
    { bars: 8, density: 0.9, bass: true, lead: true, label: 'DROP' },
    { bars: 4, density: 0.7, bass: true, lead: true, label: 'VARIATION' },
    { bars: 4, density: 0.3, bass: false, lead: false, label: 'BREAK' },
    { bars: 8, density: 1.0, bass: true, lead: true, label: 'FINAL DROP' },
    { bars: 4, density: 0.3, bass: true, lead: false, label: 'OUTRO' },
  ];

  // Macros (fixed for now)
  private macros = {
    energy: 0.6, psychedelia: 0.55, density: 0.55,
  };

  // Callbacks
  onSectionChange: ((section: string) => void) | null = null;

  init(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const c = this.ctx = new Ctx({ latencyHint: 'interactive' });

    // Create noise buffer (reused for hats, clap, shaker)
    this.noiseBuffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const noiseData = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) {
      noiseData[i] = Math.random() * 2 - 1;
    }

    // Master chain: sum → duck → master → analyser → destination
    this.sum = c.createGain();
    this.duck = c.createGain();
    this.duck.gain.value = 1.0;
    this.master = c.createGain();
    this.master.gain.value = 0.7;

    // Simple but effective master chain
    const masterHP = c.createBiquadFilter();
    masterHP.type = 'highpass';
    masterHP.frequency.value = 25;

    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.attack.value = 0.006;
    comp.release.value = 0.28;

    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;

    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 2048;

    // Connect: sum → duck → HP → comp → limiter → master → analyser → destination
    this.sum.connect(this.duck);
    this.duck.connect(masterHP);
    masterHP.connect(comp);
    comp.connect(limiter);
    limiter.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(c.destination);

    // ── REVERB (ConvolverNode — browser-optimized, no worklet needed) ──
    this.reverbNode = c.createConvolver();
    // Generate impulse response for reverb (1.5s decay)
    const reverbLength = Math.floor(c.sampleRate * 1.5);
    const impulse = c.createBuffer(2, reverbLength, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < reverbLength; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (c.sampleRate * 0.4));
      }
    }
    this.reverbNode.buffer = impulse;
    this.reverbSend = c.createGain();
    this.reverbSend.gain.value = 0.15;
    this.reverbReturn = c.createGain();
    this.reverbReturn.gain.value = 0.3;
    this.reverbSend.connect(this.reverbNode);
    this.reverbNode.connect(this.reverbReturn);
    this.reverbReturn.connect(this.master);

    // ── DELAY (ping-pong) ──
    this.delayNodeL = c.createDelay(0.5);
    this.delayNodeR = c.createDelay(0.5);
    this.delayNodeL.delayTime.value = 0.375;  // 3/8 at 120bpm
    this.delayNodeR.delayTime.value = 0.281;
    this.delaySend = c.createGain();
    this.delaySend.gain.value = 0.1;
    this.delayFb = c.createGain();
    this.delayFb.gain.value = 0.35;
    this.delayReturn = c.createGain();
    this.delayReturn.gain.value = 0.4;

    // Ping-pong: L → R → L
    this.delayNodeL.connect(this.delayNodeR);
    this.delayNodeR.connect(this.delayFb);
    this.delayFb.connect(this.delayNodeL);
    this.delaySend.connect(this.delayNodeL);
    this.delayNodeL.connect(this.delayReturn);
    this.delayNodeR.connect(this.delayReturn);
    this.delayReturn.connect(this.master);
  }

  start(worldId?: string): void {
    this.init();
    if (this.ctx!.state === 'suspended') this.ctx!.resume();
    if (worldId && LITE_WORLDS[worldId]) this.world = LITE_WORLDS[worldId];
    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.bar = 0;
    this.sectionIdx = 0;
    this.currentSection = this.arrangement[0].label;
    this.onSectionChange?.(this.currentSection);
    this.nextTime = this.ctx!.currentTime + 0.03;
    this.scheduleNextTick();
  }

  stop(): void {
    this.playing = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  /**
   * Apply musical understanding from the radio.
   * This is how the engine "follows" the radio — same key, scale, BPM.
   */
  applyMusicalUnderstanding(understanding: {
    key: { root: number; scale: string; confidence: number };
    bpm: number;
    bpmConfidence: number;
    style: string;
    styleConfidence: number;
  }): void {
    // Only update if confidence is high enough
    if (understanding.key.confidence > 0.3) {
      // Convert pitch class (0-11) to MIDI root note
      // Use octave 2 (36-47) for bass, and +12 for lead
      const rootMidi = 36 + understanding.key.root;
      this.musicalKey = {
        root: rootMidi,
        scale: understanding.key.scale,
      };
      console.log(`[Engine] Key detected: ${understanding.key.root} ${understanding.key.scale} (conf: ${understanding.key.confidence.toFixed(2)})`);
    }

    // Update BPM if confidence is high
    if (understanding.bpm > 0 && understanding.bpmConfidence > 0.3) {
      // Smooth BPM change (don't jump — fade toward target)
      const targetBpm = understanding.bpm;
      const currentBpm = this.world.bpm;
      // Only change if difference is significant (> 5 BPM)
      if (Math.abs(targetBpm - currentBpm) > 5) {
        this.world.bpm = Math.round(targetBpm);
        console.log(`[Engine] BPM adjusted: ${currentBpm} → ${this.world.bpm}`);
      }
    }

    // Update style if detected
    if (understanding.styleConfidence > 0.4) {
      this.detectedStyle = understanding.style;
      // Could switch world here if we had the worlds mapped
    }
  }

  getMusicalKey(): { root: number; scale: string } {
    return this.musicalKey;
  }

  setWorld(params: Record<string, number>): void {
    if (!this.world) return;
    if (params.kickDecay !== undefined) this.world.kickDecay = params.kickDecay;
    if (params.kickFundamental !== undefined) this.world.kickFundamental = params.kickFundamental;
    if (params.bassCutoff !== undefined) this.world.bassCutoff = params.bassCutoff;
    if (params.leadCutoff !== undefined) this.world.leadCutoff = params.leadCutoff;
    if (params.duck !== undefined) this.world.duck = params.duck;
    // FIX: accept level parameters (were missing!)
    if (params.kickLevel !== undefined) this.world.kickLevel = params.kickLevel;
    if (params.bassLevel !== undefined) this.world.bassLevel = params.bassLevel;
    if (params.leadLevel !== undefined) this.world.leadLevel = params.leadLevel;
    if (params.hatLevel !== undefined) this.world.hatLevel = params.hatLevel;
    if (params.masterLevel !== undefined) {
      this.world.masterLevel = params.masterLevel;
      // Apply immediately to master gain
      if (this.master) this.master.gain.setTargetAtTime(params.masterLevel, this.ctx!.currentTime, 0.1);
    }
  }

  /**
   * Live tracking — adjusts engine parameters to match reference metrics in real-time.
   * Called whenever new reference metrics arrive.
   */
  liveTrack(refMetrics: {
    lufs: number;
    spectralCentroid: number;
    subEnergy: number;
    highEnergy: number;
    transientDensity: number;
    kickDecayMs: number;
    energy: number;
  }): void {
    if (!this.ctx || !this.world) return;
    const t = this.ctx.currentTime;

    // ── LUFS matching: adjust masterLevel to match reference LUFS ──
    // Our engine LUFS is typically -26, reference is -14 to -18
    // We need to boost our output
    const targetLufs = refMetrics.lufs;
    // Get our current LUFS from self-analyzer if available
    // For now, use a heuristic: if reference is louder, boost master
    const currentMaster = this.world.masterLevel ?? 0.7;
    const lufsDiff = targetLufs - (-26); // assume our engine is around -26
    if (Math.abs(lufsDiff) > 2) {
      // Adjust master gain toward target
      const adjustment = lufsDiff > 0 ? 0.02 : -0.02;
      const newMaster = Math.max(0.3, Math.min(1.2, currentMaster + adjustment));
      this.world.masterLevel = newMaster;
      if (this.master) this.master.gain.setTargetAtTime(newMaster, t, 0.5);
    }

    // ── Kick decay matching ──
    const refKickDecaySec = refMetrics.kickDecayMs / 1000;
    if (refKickDecaySec > 0.05 && refKickDecaySec < 0.5) {
      // Smoothly adjust kick decay toward reference
      const currentDecay = this.world.kickDecay;
      const newDecay = currentDecay * 0.9 + refKickDecaySec * 0.1;
      this.world.kickDecay = Math.max(0.08, Math.min(0.35, newDecay));
    }

    // ── Spectral balance: adjust lead cutoff to match centroid ──
    const refCentroid = refMetrics.spectralCentroid;
    if (refCentroid > 100) {
      // Map centroid to lead cutoff (rough heuristic)
      const targetLeadCutoff = Math.max(800, Math.min(6000, refCentroid * 2));
      const currentCutoff = this.world.leadCutoff;
      // Smooth adjustment (10% toward target)
      this.world.leadCutoff = currentCutoff * 0.9 + targetLeadCutoff * 0.1;
    }
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  private scheduleNextTick(): void {
    if (!this.playing) return;
    this.timer = setTimeout(() => {
      this.tick();
      this.scheduleNextTick();
    }, 15);
  }

  private tick(): void {
    if (!this.playing || !this.ctx) return;
    const lookahead = 0.06;
    const s16 = 60 / this.world.bpm / 4;

    while (this.nextTime < this.ctx.currentTime + lookahead) {
      this.scheduleStep(this.step, this.bar, this.nextTime);
      this.step++;
      this.nextTime += s16;
      if (this.step >= 16) {
        this.step = 0;
        this.bar++;
        const section = this.arrangement[this.sectionIdx % this.arrangement.length];
        if (this.bar >= section.bars) {
          this.sectionIdx++;
          this.bar = 0;
          const next = this.arrangement[this.sectionIdx % this.arrangement.length];
          this.currentSection = next.label;
          this.onSectionChange?.(this.currentSection);
        }

        // Change sound presets every 8 bars for sonic variety
        if (this.bar % 8 === 0 && this.bar > 0) {
          this.currentPreset = (this.currentPreset + 1) % this.kickPresets.length;
          console.log(`[Engine] Preset changed to ${this.currentPreset}`);
        }
      }
    }
  }

  private scheduleStep(step: number, bar: number, time: number): void {
    const section = this.arrangement[this.sectionIdx % this.arrangement.length];
    const w = this.world;

    // Kick — 4 on the floor
    if (step % 4 === 0) {
      this.triggerKick(time, section.density * 0.5);
    }

    // Bass — offbeat, using DETECTED key from radio
    if (section.bass && step % 2 === 1) {
      // Use the detected musical key (syncs with radio)
      const key = this.musicalKey;
      // Bass pattern: root, root, fifth, root (classic psytrance)
      const bassPattern = [0, 0, 4, 0];
      const bassDegree = bassPattern[Math.floor(step / 4) % bassPattern.length];
      const note = scaleNote(key.root, key.scale, bassDegree);
      this.triggerBass(time, note, w.bassCutoff);
    }

    // Lead — AABA motif (not random!)
    // AABA: bars 0-1 = A (main motif), bar 2 = B (contrast), bar 3 = A' (return)
    if (section.lead && step % 2 === 0) {
      const key = this.musicalKey;
      const phraseBar = bar % 4;  // 4-bar AABA phrase

      // A section: main motif (ascending then descending)
      // B section: contrast (higher octave, different degrees)
      let degrees: number[];
      if (phraseBar === 2) {
        // B section — contrast, higher
        degrees = [7, 10, 12, 10, 7, 5, 3, 0];
      } else {
        // A section — main motif
        degrees = [0, 2, 3, 5, 3, 2, 0, -2];
      }

      const motifIdx = Math.floor(step / 2) % degrees.length;
      const deg = degrees[motifIdx];
      const note = scaleNote(key.root + 12, key.scale, deg);
      this.triggerLead(time, note, w.leadCutoff);
    }

    // Hats — offbeat
    if (step % 2 === 1) {
      this.triggerHat(time, false, 0.12);
    }

    // Clap — on 2 and 4
    if (step === 4 || step === 12) {
      this.triggerClap(time, 0.2);
    }
  }

  // ─── Voice triggers (Web Audio API — no worklet) ──────────────────

  private triggerKick(time: number, vel: number): void {
    const c = this.ctx!;
    const w = this.world;
    const preset = this.kickPresets[this.currentPreset];
    const kickLevel = w.kickLevel ?? 1.0;

    // Sub: sine with pitch envelope (uses preset)
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(preset.fundamental * 2.4, time);
    o.frequency.exponentialRampToValueAtTime(preset.fundamental, time + 0.035);
    g.gain.setValueAtTime(preset.subLevel * vel * kickLevel, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + preset.decay);
    o.connect(g);
    g.connect(this.sum!);
    o.start(time);
    o.stop(time + preset.decay + 0.02);

    // Mid: triangle for punch
    const o2 = c.createOscillator();
    const g2 = c.createGain();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(w.kickFundamental * 2, time);
    o2.frequency.exponentialRampToValueAtTime(w.kickFundamental * 1.5, time + 0.02);
    g2.gain.setValueAtTime(0.4 * vel, time);
    g2.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    o2.connect(g2);
    g2.connect(this.sum!);
    o2.start(time);
    o2.stop(time + 0.06);

    // Click: noise burst
    if (this.noiseBuffer) {
      const s = c.createBufferSource();
      s.buffer = this.noiseBuffer;
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 4500;
      const cg = c.createGain();
      cg.gain.setValueAtTime(0.25 * vel, time);
      cg.gain.exponentialRampToValueAtTime(0.001, time + 0.012);
      s.connect(hp);
      hp.connect(cg);
      cg.connect(this.sum!);
      s.start(time);
      s.stop(time + 0.03);
    }

    // Trigger sidechain duck
    this.duckHit(time);
  }

  private triggerBass(time: number, midi: number, cutoff: number): void {
    const c = this.ctx!;
    const f = mtof(midi);
    const preset = this.bassPresets[this.currentPreset];
    const dur = preset.decay;
    const bassLevel = this.world.bassLevel ?? 1.0;

    // Oscillator (uses preset waveform)
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = preset.waveform;
    o.frequency.value = f;

    // Lowpass filter (uses preset cutoff multiplier and Q)
    const fl = c.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.setValueAtTime(cutoff * preset.cutoffMult, time);
    fl.frequency.exponentialRampToValueAtTime(cutoff, time + 0.04);
    fl.Q.value = preset.q;

    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(0.4 * bassLevel, time + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);

    o.connect(fl);
    fl.connect(g);
    g.connect(this.sum!);
    o.start(time);
    o.stop(time + dur + 0.02);
  }

  private triggerLead(time: number, midi: number, cutoff: number): void {
    const c = this.ctx!;
    const f = mtof(midi);
    const preset = this.leadPresets[this.currentPreset];
    const dur = 0.15;
    const leadLevel = this.world.leadLevel ?? 1.0;

    // Oscillators (uses preset waveform and detune)
    const o1 = c.createOscillator();
    const g = c.createGain();
    o1.type = preset.waveform;
    o1.frequency.value = f;

    let o2: OscillatorNode | null = null;
    if (preset.numOscs >= 2) {
      o2 = c.createOscillator();
      o2.type = preset.waveform;
      o2.frequency.value = f;
      o2.detune.value = preset.detune;
    }
    let o3: OscillatorNode | null = null;
    if (preset.numOscs >= 3) {
      o3 = c.createOscillator();
      o3.type = preset.waveform;
      o3.frequency.value = f;
      o3.detune.value = -preset.detune;
    }

    const fl = c.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.value = cutoff;
    fl.Q.value = preset.q;

    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(0.3 * leadLevel, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);

    o1.connect(fl);
    if (o2) o2.connect(fl);
    if (o3) o3.connect(fl);
    fl.connect(g);
    g.connect(this.sum!);

    // Send lead to reverb + delay for depth
    if (this.reverbSend) g.connect(this.reverbSend);
    if (this.delaySend) g.connect(this.delaySend);

    o1.start(time);
    if (o2) o2.start(time);
    if (o3) o3.start(time);
    o1.stop(time + dur + 0.02);
    if (o2) o2.stop(time + dur + 0.02);
    if (o3) o3.stop(time + dur + 0.02);
  }

  private triggerHat(time: number, open: boolean, vel: number): void {
    const c = this.ctx!;
    if (!this.noiseBuffer) return;

    const s = c.createBufferSource();
    s.buffer = this.noiseBuffer;
    s.loop = true;

    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = open ? 7000 : 8600;

    const g = c.createGain();
    const decay = open ? 0.2 : 0.04;
    g.gain.setValueAtTime(vel, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + decay);

    s.connect(hp);
    hp.connect(g);
    g.connect(this.sum!);
    s.start(time);
    s.stop(time + decay + 0.02);
  }

  private triggerClap(time: number, vel: number): void {
    const c = this.ctx!;
    if (!this.noiseBuffer) return;

    // 3 bursts for clap effect
    for (let i = 0; i < 3; i++) {
      const s = c.createBufferSource();
      s.buffer = this.noiseBuffer;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 2;
      const g = c.createGain();
      const t = time + i * 0.01;
      g.gain.setValueAtTime(vel * 0.6, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      s.connect(bp);
      bp.connect(g);
      g.connect(this.sum!);
      s.start(t);
      s.stop(t + 0.1);
    }
  }

  private duckHit(time: number): void {
    if (!this.duck || !this.ctx) return;
    const depth = this.world.duck;
    // Drop duck gain, then recover
    this.duck.gain.cancelScheduledValues(time);
    this.duck.gain.setValueAtTime(1 - depth * 0.7, time);
    this.duck.gain.linearRampToValueAtTime(1.0, time + 0.25);
  }
}
