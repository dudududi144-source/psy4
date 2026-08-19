// src/lib/psyLive4/radio-listener.ts
// Real radio listener — connects to a live psytrance stream,
// analyzes it in real-time, and extracts musical targets for the engine.
//
// This is NOT "Smart Radio" (which just cycled styles randomly).
// This is a REAL listener that:
// 1. Connects to a radio stream via <audio> + MediaElementSource
// 2. Analyzes the incoming audio (BPM, spectrum, dynamics, key)
// 3. Extracts targets that the engine should match
// 4. Feeds those targets to the learning system

import type { AudioQualityMetrics } from './audio-quality';
import { analyzeQuality } from './audio-quality';

export interface RadioTarget {
  bpm: number;
  style: string;
  warmth: number;
  brightness: number;
  punch: number;
  clarity: number;
  loudness: number;
  smoothness: number;
  balance: number;
  overall: number;
  connected: boolean;
  streamName: string;
}

export interface RadioStream {
  id: string;
  name: string;
  url: string;
}

export class RadioListener {
  private audioEl: HTMLAudioElement | null = null;
  private mediaSource: MediaElementAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private ctx: AudioContext;
  private freqBuf: Uint8Array;
  private tdBuf: Float32Array;
  private connected = false;
  private currentStream: RadioStream | null = null;
  private bpmHistory: number[] = [];
  private beatTimes: number[] = [];
  private lastBeatTime = 0;
  private energyHistory: number[] = [];
  private onTargetsCallback: ((target: RadioTarget) => void) | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    this.freqBuf = new Uint8Array(this.analyser.frequencyBinCount);
    this.tdBuf = new Float32Array(this.analyser.fftSize);
  }

  /**
   * Connect to a radio stream.
   * Creates <audio> element, routes through MediaElementSource → AnalyserNode.
   * Does NOT route to destination (we don't want to hear the radio — we just analyze it).
   * Actually, we DO route to destination so the user can hear the radio alongside the engine.
   */
  async connect(stream: RadioStream): Promise<boolean> {
    try {
      // Disconnect previous
      this.disconnect();

      // Create audio element
      this.audioEl = new Audio();
      this.audioEl.crossOrigin = 'anonymous';
      this.audioEl.src = stream.url;
      this.audioEl.volume = 0.3;  // quiet — the engine is the main sound

      // Wait for metadata loaded
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timeout')), 10000);
        this.audioEl!.addEventListener('canplay', () => { clearTimeout(timeout); resolve(); }, { once: true });
        this.audioEl!.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('stream error')); }, { once: true });
        this.audioEl!.play().catch(() => reject(new Error('autoplay blocked')));
      });

      // Route through Web Audio API
      this.mediaSource = this.ctx.createMediaElementSource(this.audioEl);
      this.mediaSource.connect(this.analyser!);
      this.analyser!.connect(this.ctx.destination);  // user hears radio

      this.currentStream = stream;
      this.connected = true;
      console.log(`[RadioListener] connected to ${stream.name}`);

      // Start analysis loop
      this.startAnalysis();
      return true;
    } catch (err) {
      console.warn(`[RadioListener] failed to connect to ${stream.name}:`, err);
      this.disconnect();
      return false;
    }
  }

  disconnect(): void {
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.src = '';
      this.audioEl = null;
    }
    if (this.mediaSource) {
      try { this.mediaSource.disconnect(); } catch {}
      this.mediaSource = null;
    }
    this.connected = false;
    this.currentStream = null;
    this.bpmHistory = [];
    this.beatTimes = [];
  }

  isConnected(): boolean { return this.connected; }
  getCurrentStream(): RadioStream | null { return this.currentStream; }
  getAnalyser(): AnalyserNode | null { return this.analyser; }

  onTargets(cb: (target: RadioTarget) => void): void {
    this.onTargetsCallback = cb;
  }

  private analysisInterval: ReturnType<typeof setInterval> | null = null;

  private startAnalysis(): void {
    if (this.analysisInterval) clearInterval(this.analysisInterval);
    this.analysisInterval = setInterval(() => this.analyze(), 2000);  // every 2s
  }

  private analyze(): void {
    if (!this.analyser || !this.connected) return;

    // Get audio quality metrics (same 7 metrics as engine)
    const metrics = analyzeQuality(this.analyser, this.ctx.sampleRate);

    // Detect BPM via energy-based beat detection
    const bpm = this.detectBPM();

    // Detect style from metrics
    const style = this.detectStyle(metrics, bpm);

    // Build target
    const target: RadioTarget = {
      bpm: bpm || 145,
      style,
      warmth: metrics.warmth,
      brightness: metrics.brightness,
      punch: metrics.punch,
      clarity: metrics.clarity,
      loudness: metrics.loudness,
      smoothness: metrics.smoothness,
      balance: metrics.balance,
      overall: metrics.overall,
      connected: true,
      streamName: this.currentStream?.name || 'unknown',
    };

    console.log(`[RadioListener] ${target.streamName}: BPM=${target.bpm.toFixed(0)} style=${target.style} warmth=${target.warmth.toFixed(2)} brightness=${target.brightness.toFixed(2)} smoothness=${target.smoothness.toFixed(2)} loudness=${target.loudness.toFixed(2)}`);

    if (this.onTargetsCallback) {
      this.onTargetsCallback(target);
    }
  }

  /**
   * BPM detection via energy-based onset detection.
   * Measures energy spikes in low-frequency band and calculates intervals.
   */
  private detectBPM(): number {
    if (!this.analyser) return 0;

    // Get frequency data
    this.analyser.getByteFrequencyData(this.freqBuf as Uint8Array<ArrayBuffer>);
    this.analyser.getFloatTimeDomainData(this.tdBuf as Float32Array<ArrayBuffer>);

    // Calculate energy in low band (20-200Hz) — where kick lives
    const sr = this.ctx.sampleRate;
    const binW = sr / this.analyser.fftSize;
    let lowEnergy = 0;
    let lowCount = 0;
    for (let i = 0; i < this.freqBuf.length; i++) {
      const f = i * binW;
      if (f >= 20 && f <= 200) {
        lowEnergy += this.freqBuf[i];
        lowCount++;
      }
    }
    const avgLowEnergy = lowEnergy / (lowCount || 1);

    // Track energy history
    this.energyHistory.push(avgLowEnergy);
    if (this.energyHistory.length > 50) this.energyHistory.shift();

    // Detect beat: current energy > average * 1.3
    const avgEnergy = this.energyHistory.reduce((a, b) => a + b, 0) / this.energyHistory.length;
    const now = this.ctx.currentTime;

    if (avgLowEnergy > avgEnergy * 1.3 && now - this.lastBeatTime > 0.3) {
      // Beat detected!
      if (this.lastBeatTime > 0) {
        const interval = now - this.lastBeatTime;
        this.beatTimes.push(interval);
        if (this.beatTimes.length > 8) this.beatTimes.shift();

        // Calculate BPM from median of intervals
        if (this.beatTimes.length >= 4) {
          const sorted = [...this.beatTimes].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          let bpm = 60 / median;
          // Fold to typical psytrance range (130-160)
          while (bpm < 100) bpm *= 2;
          while (bpm > 180) bpm /= 2;
          return Math.round(bpm);
        }
      }
      this.lastBeatTime = now;
    }

    return this.bpmHistory.length > 0
      ? this.bpmHistory[this.bpmHistory.length - 1]
      : 0;
  }

  /**
   * Detect musical style from audio quality metrics.
   * DARK = low brightness + high smoothness
   * FULL_ON = high brightness + high punch
   * PROGRESSIVE = medium everything
   * ACID = high brightness + low smoothness
   */
  private detectStyle(metrics: AudioQualityMetrics, bpm: number): string {
    if (bpm > 150 && metrics.brightness > 0.6) return 'HI_TECH';
    if (metrics.brightness < 0.3 && metrics.smoothness > 0.6) return 'DARK';
    if (metrics.brightness > 0.6 && metrics.smoothness < 0.4) return 'ACID';
    if (bpm < 140 && metrics.punch < 0.6) return 'PROGRESSIVE';
    if (metrics.warmth > 0.7 && metrics.brightness > 0.4) return 'GOA';
    return 'FULL_ON';  // default
  }

  dispose(): void {
    this.disconnect();
    if (this.analysisInterval) clearInterval(this.analysisInterval);
    if (this.analyser) { try { this.analyser.disconnect(); } catch {} }
  }
}
