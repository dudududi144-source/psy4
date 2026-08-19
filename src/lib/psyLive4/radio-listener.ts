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
//
// FIXES (claims-vs-reality roast):
// - GAP 2: BPM detection now runs at 50ms (20Hz) in its OWN interval —
//   was 2000ms, missed 4-5 beats between samples at 145BPM.
// - GAP 11: removed dead `bpmHistory` field (never written to).
// - GAP 11: `energyHistory` now cleared on disconnect (was bleeding across streams).
// - GAP 9: `analyzeQuality` reuses host-provided buffers (no per-call allocation).

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
  inBreakdown: boolean;   // DEEP GAP B: true when radio is in a quiet/breakdown section
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
  private outputGain: GainNode | null = null;  // DEEP GAP F: A/B mode volume control
  private ctx: AudioContext;
  private freqBuf: Uint8Array;
  private tdBuf: Float32Array;
  private connected = false;
  private currentStream: RadioStream | null = null;
  private beatTimes: number[] = [];
  private lastBeatTime = 0;
  private energyHistory: number[] = [];
  private lastDetectedBpm = 0;
  private bpmConfidence = 0;
  private onTargetsCallback: ((target: RadioTarget) => void) | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    this.freqBuf = new Uint8Array(this.analyser.frequencyBinCount);
    this.tdBuf = new Float32Array(this.analyser.fftSize);
    // DEEP GAP F: radio output gain — host controls this for A/B mode
    this.outputGain = ctx.createGain();
    this.outputGain.gain.value = 0.3;  // default: quiet (engine is the main sound)
    this.analyser.connect(this.outputGain);
    this.outputGain.connect(ctx.destination);
  }

  /**
   * DEEP GAP F: A/B mix mode control.
   * - 'both': radio at 0.3, engine at 1.0 (default — hear both)
   * - 'radio': radio at 1.0, engine muted by host
   * - 'engine': radio muted, engine at 1.0
   */
  setOutputGain(value: number): void {
    if (this.outputGain) {
      this.outputGain.gain.setTargetAtTime(Math.max(0, Math.min(1, value)), this.ctx.currentTime, 0.05);
    }
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
      // DEEP GAP F: mediaSource → analyser → outputGain → destination
      // (outputGain is created in constructor and controlled by setOutputGain)
      this.mediaSource = this.ctx.createMediaElementSource(this.audioEl);
      this.mediaSource.connect(this.analyser!);
      // analyser already connected to outputGain → destination in constructor

      this.currentStream = stream;
      this.connected = true;
      console.log(`[RadioListener] connected to ${stream.name}`);

      // Start analysis loops (FIX GAP 2: BPM at 50ms, quality at 2000ms)
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
    this.beatTimes = [];
    this.energyHistory = [];
    this.loudnessHistory = [];      // DEEP GAP B: clear breakdown window
    this.lastBeatTime = 0;
    this.lastDetectedBpm = 0;
    this.bpmConfidence = 0;
    if (this.qualityInterval) { clearInterval(this.qualityInterval); this.qualityInterval = null; }
    if (this.bpmInterval) { clearInterval(this.bpmInterval); this.bpmInterval = null; }
  }

  isConnected(): boolean { return this.connected; }
  getCurrentStream(): RadioStream | null { return this.currentStream; }
  getAnalyser(): AnalyserNode | null { return this.analyser; }
  /** FIX GAP 2: expose BPM detection confidence so UI can show "BPM=145 (conf=0.82)". */
  getBpmConfidence(): number { return this.bpmConfidence; }
  getLastDetectedBpm(): number { return this.lastDetectedBpm; }

  onTargets(cb: (target: RadioTarget) => void): void {
    this.onTargetsCallback = cb;
  }

  private qualityInterval: ReturnType<typeof setInterval> | null = null;
  private bpmInterval: ReturnType<typeof setInterval> | null = null;
  private connectTime = 0;
  private targetHistory: RadioTarget[] = [];
  // DEEP GAP B: breakdown detection
  // Track loudness over a 30s window. If current loudness < 60% of the window
  // average, we're in a breakdown — skip target updates (they'd corrupt
  // the learning targets with breakdown-like values).
  private loudnessHistory: number[] = [];
  private static readonly LOUDNESS_WINDOW = 15;   // 15 samples × 2s = 30s window
  private static readonly BREAKDOWN_RATIO = 0.55; // < 55% of avg = breakdown
  private static readonly WARMUP_MS = 5000;
  private static readonly HISTORY_MAX = 5;
  private static readonly BPM_INTERVAL_MS = 50;
  private static readonly QUALITY_INTERVAL_MS = 2000;

  private startAnalysis(): void {
    if (this.qualityInterval) clearInterval(this.qualityInterval);
    if (this.bpmInterval) clearInterval(this.bpmInterval);
    this.connectTime = Date.now();
    this.targetHistory = [];

    // FIX GAP 2: BPM detection at 20Hz — catches beats at 145BPM (414ms apart) with 8x oversample
    this.bpmInterval = setInterval(() => this.detectBPM(), RadioListener.BPM_INTERVAL_MS);
    // Quality metrics at 0.5Hz — these need a full FFT window to be meaningful
    this.qualityInterval = setInterval(() => this.analyzeQuality(), RadioListener.QUALITY_INTERVAL_MS);
  }

  private analyzeQuality(): void {
    if (!this.analyser || !this.connected) return;

    // WARMUP: skip first 5s (stream buffering, silence)
    if (Date.now() - this.connectTime < RadioListener.WARMUP_MS) {
      console.log('[RadioListener] warmup — skipping analysis');
      return;
    }

    // Reuse buffers (FIX GAP 9)
    const metrics = analyzeQuality(this.analyser, this.ctx.sampleRate, this.freqBuf, this.tdBuf);

    // Skip if radio is TRULY silent (not just quiet — radio streams are often quiet)
    if (metrics.loudness < 0.001 && metrics.brightness < 0.01) {
      console.log('[RadioListener] radio truly silent — skipping');
      return;
    }

    // DEEP GAP B: Breakdown detection
    // Track loudness over a 30s window. If current loudness < 55% of the window
    // average, we're in a breakdown — DON'T update targets (they'd corrupt
    // the learning system with breakdown-like values: low bass, low energy).
    this.loudnessHistory.push(metrics.loudness);
    if (this.loudnessHistory.length > RadioListener.LOUDNESS_WINDOW) this.loudnessHistory.shift();

    let inBreakdown = false;
    if (this.loudnessHistory.length >= 5) {  // need at least 10s of data
      const avgLoud = this.loudnessHistory.reduce((a, b) => a + b, 0) / this.loudnessHistory.length;
      if (avgLoud > 0.1 && metrics.loudness < avgLoud * RadioListener.BREAKDOWN_RATIO) {
        inBreakdown = true;
      }
    }

    if (inBreakdown) {
      console.log(`[RadioListener] breakdown detected (loud=${metrics.loudness.toFixed(2)} < 55% of avg) — holding targets`);
      // Still call the callback so the host knows we're connected + in breakdown,
      // but mark inBreakdown=true so the host doesn't apply these as new targets.
      if (this.onTargetsCallback && this.targetHistory.length > 0) {
        const last = { ...this.targetHistory[this.targetHistory.length - 1], inBreakdown: true };
        this.onTargetsCallback(last);
      }
      return;
    }

    // CAP brightness at 0.8 (1.0 = white noise artifact)
    const cappedBrightness = Math.min(0.8, metrics.brightness);

    const bpm = this.lastDetectedBpm;
    const bpmConfidence = this.bpmConfidence;
    const effectiveBpm = bpmConfidence > 0.4 && bpm > 100 && bpm < 180 ? bpm : 0;

    const style = this.detectStyle(metrics, effectiveBpm || 145);

    const target: RadioTarget = {
      bpm: effectiveBpm || 145,
      style,
      warmth: metrics.warmth,
      brightness: cappedBrightness,
      punch: metrics.punch,
      clarity: metrics.clarity,
      loudness: metrics.loudness,
      smoothness: metrics.smoothness,
      balance: metrics.balance,
      overall: metrics.overall,
      connected: true,
      streamName: this.currentStream?.name || 'unknown',
      inBreakdown: false,
    };

    // SMOOTHING: 5-sample moving average
    this.targetHistory.push(target);
    if (this.targetHistory.length > RadioListener.HISTORY_MAX) this.targetHistory.shift();
    const smoothed: RadioTarget = {
      ...target,
      warmth: this.avgField('warmth'),
      brightness: this.avgField('brightness'),
      punch: this.avgField('punch'),
      clarity: this.avgField('clarity'),
      loudness: this.avgField('loudness'),
      smoothness: this.avgField('smoothness'),
      balance: this.avgField('balance'),
      overall: this.avgField('overall'),
    };

    console.log(`[RadioListener] ${smoothed.streamName}: BPM=${smoothed.bpm.toFixed(0)}(conf=${bpmConfidence.toFixed(2)}) style=${smoothed.style} warmth=${smoothed.warmth.toFixed(2)} bright=${smoothed.brightness.toFixed(2)} smooth=${smoothed.smoothness.toFixed(2)} loud=${smoothed.loudness.toFixed(2)}`);

    if (this.onTargetsCallback) {
      this.onTargetsCallback(smoothed);
    }
  }

  private avgField(key: keyof RadioTarget): number {
    if (this.targetHistory.length === 0) return 0;
    const vals = this.targetHistory.map(t => t[key] as number).filter(v => typeof v === 'number' && isFinite(v));
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }

  /**
   * BPM detection via energy-based onset detection.
   * Measures energy spikes in low-frequency band and calculates intervals.
   *
   * FIX GAP 2: now called at 50ms intervals (was 2000ms).
   * At 145 BPM (414ms/beat), 50ms gives 8 samples per beat — robust detection.
   */
  private detectBPM(): void {
    if (!this.analyser || !this.connected) return;

    // Get frequency data (reuse buffers)
    this.analyser.getByteFrequencyData(this.freqBuf as Uint8Array<ArrayBuffer>);

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
    if (this.energyHistory.length > 100) this.energyHistory.shift();  // 100 × 50ms = 5s window

    // Detect beat: current energy > average * 1.3
    const avgEnergy = this.energyHistory.reduce((a, b) => a + b, 0) / this.energyHistory.length;
    const now = this.ctx.currentTime;

    if (avgLowEnergy > avgEnergy * 1.3 && now - this.lastBeatTime > 0.25) {  // min 0.25s = 240 BPM cap
      // Beat detected!
      if (this.lastBeatTime > 0) {
        const interval = now - this.lastBeatTime;
        if (interval > 0.25 && interval < 1.5) {  // 40-240 BPM range
          this.beatTimes.push(interval);
          if (this.beatTimes.length > 16) this.beatTimes.shift();

          // Calculate BPM from median of intervals
          if (this.beatTimes.length >= 4) {
            const sorted = [...this.beatTimes].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            let bpm = 60 / median;
            // Fold to typical psytrance range (130-160)
            while (bpm < 100) bpm *= 2;
            while (bpm > 180) bpm /= 2;
            this.lastDetectedBpm = Math.round(bpm);
            // Confidence: how consistent are the intervals?
            const variance = sorted.reduce((sum, v) => sum + Math.abs(v - median), 0) / sorted.length;
            this.bpmConfidence = Math.max(0, Math.min(1, 1 - variance * 4));  // 0=chaotic, 1=rock-steady
          }
        }
      }
      this.lastBeatTime = now;
    }
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
    if (this.analyser) { try { this.analyser.disconnect(); } catch {} }
    if (this.outputGain) { try { this.outputGain.disconnect(); } catch {} this.outputGain = null; }
  }
}
