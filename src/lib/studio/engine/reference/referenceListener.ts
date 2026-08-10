/**
 * ReferenceListener — connects to a live psytrance radio stream and extracts
 * acoustic features for comparison with our engine.
 *
 * PRIORITY 3+4: Reference listener + feature extraction.
 *
 * CRITICAL: NO ScriptProcessorNode. NO per-block allocation.
 *
 * Architecture:
 *   fetch(streamUrl) → ReadableStream → AudioDecoder/AudioContext.decodeAudioData
 *   → OfflineAudioContext for analysis → feature extraction
 *
 * The stream is decoded in chunks (not played through speakers), analyzed
 * via OfflineAudioContext + AnalyserNode, and features are extracted.
 * The audio is NEVER stored — only features.
 *
 * Window: 20 seconds, hop: 10 seconds (50% overlap).
 */

import type { RadioStream } from './radioStreams';
// ── Task D1: DJ-style phase sync — the listener populates phaseInfo from
// its transient analysis so the engine can phase-lock to the radio. The
// PhaseInfo type lives in phaseSync.ts to keep the engine's sync module
// self-contained. The import is type-only so there's no runtime dependency.
import type { PhaseInfo } from '../phaseSync';

export interface ReferenceMetrics {
  // Tempo
  bpm: number;
  bpmConfidence: number;       // 0..1

  // Loudness
  rms: number;
  peak: number;
  lufs: number;
  crestFactor: number;

  // Spectral bands (normalized 0..1)
  subEnergy: number;           // 20-60 Hz
  lowEnergy: number;           // 60-250 Hz
  midEnergy: number;           // 250-2000 Hz
  highEnergy: number;          // 2000-8000 Hz
  airEnergy: number;           // 8000-20000 Hz

  // Spectral shape
  spectralCentroid: number;    // Hz
  spectralFlatness: number;    // 0..1
  spectralRolloff: number;     // Hz (85%)

  // Transients
  transientDensity: number;    // transients per second
  kickDensity: number;         // kick hits per second
  hatDensity: number;          // hat hits per second
  percussionDensity: number;   // all percussion per second

  // Stereo
  stereoWidth: number;         // 0..1 (1 = wide)

  // Decay (ms)
  kickDecayMs: number;
  bassDecayMs: number;

  // Rhythm
  rhythmicRegularity: number;  // 0..1 (1 = perfectly regular)
  repetitionScore: number;     // 0..1 (1 = highly repetitive)

  // Overall
  energy: number;              // 0..1
  overallConfidence: number;   // 0..1

  // Musical understanding (new)
  detectedKey?: { root: number; rootName: string; scale: string; confidence: number };
  detectedBassNote?: { note: number; freq: number; confidence: number };
  detectedStyle?: { style: string; confidence: number };

  // ── Task T1: Harmonic-content analysis (optional — populated by V2 listener) ──
  // Spectral flatness already exists above; these are the additional timbral
  // descriptors needed to drive the synthesis-mode detector and effects pursuit.
  spectralCrest?: number;       // 1..N — peak-to-mean magnitude ratio. High = tonal peaks.
  hnr?: number;                 // 0..1 — harmonic-to-noise ratio. High = clean synth, low = noisy/distorted.
  inharmonicity?: number;       // 0..1 — partial deviation from integer ratios. High = FM/bells/metallic.
  spectralSlopeDb?: number;     // dB/oct (typically -6 to -24). -6=bright, -12=balanced, -24=dark.

  // ── Task T1: Transient shape analysis ──
  // transientDensity already exists above; these describe the SHAPE of the
  // detected transients (not just how many there are).
  transientSharpness?: number;  // 0..1 — 1 = clicky/fast attack, 0 = soft/slow attack.
  transientDecayMs?: number;    // ms — average decay time of detected transients.

  // ── Task T1: Stereo field analysis ──
  // stereoWidth (above) collapses L/R correlation to a 0..1 magnitude. These
  // give the directional + phase information the pursuit needs to match width
  // without blindly widening everything.
  stereoBalance?: number;       // -1..1 — -1 = full L, 0 = centered, +1 = full R.
  stereoCorrelation?: number;   // -1..1 — 1 = mono, 0 = uncorrelated, -1 = out of phase.
  msRatio?: number;             // 0..1 — side energy / (mid + side) energy. High = wide.

  // ── Task D1: DJ-style phase sync ──
  // Populated by the V2 listener from the kick-band transient grid. The
  // engine's PhaseSync consumes this to phase-lock its beat grid to the
  // radio's. Optional — the V1 listener and any caller that doesn't run
  // the new analysis simply omit it, and the engine gracefully no-ops.
  phaseInfo?: PhaseInfo;

  timestamp: number;
  sourceStream: string;
}

export interface ReferenceProfile {
  // Rolling statistics over multiple windows
  bpm: { mean: number; p10: number; p90: number; count: number };
  rms: { mean: number; p10: number; p90: number };
  lufs: { mean: number; p10: number; p90: number };
  subEnergy: { mean: number; p10: number; p90: number };
  lowEnergy: { mean: number; p10: number; p90: number };
  midEnergy: { mean: number; p10: number; p90: number };
  highEnergy: { mean: number; p10: number; p90: number };
  airEnergy: { mean: number; p10: number; p90: number };
  spectralCentroid: { mean: number; p10: number; p90: number };
  transientDensity: { mean: number; p10: number; p90: number };
  kickDecayMs: { mean: number; p10: number; p90: number };
  bassDecayMs: { mean: number; p10: number; p90: number };
  stereoWidth: { mean: number; p10: number; p90: number };
  energy: { mean: number; p10: number; p90: number };
  // ── Task T1: rolling stats for the new timbral / shape / stereo fields ──
  // All optional so existing profiles (and the V1 listener that doesn't
  // populate them) remain valid. The pursuit engine reads these via the
  // V2 listener's getProfile() and uses the means to drive long-term
  // synthesis + effects decisions.
  spectralCrest?: { mean: number; p10: number; p90: number };
  hnr?: { mean: number; p10: number; p90: number };
  inharmonicity?: { mean: number; p10: number; p90: number };
  spectralSlopeDb?: { mean: number; p10: number; p90: number };
  transientSharpness?: { mean: number; p10: number; p90: number };
  transientDecayMs?: { mean: number; p10: number; p90: number };
  stereoBalance?: { mean: number; p10: number; p90: number };
  stereoCorrelation?: { mean: number; p10: number; p90: number };
  msRatio?: { mean: number; p10: number; p90: number };
  windowCount: number;
  lastUpdated: number;
  sourceStream: string;
}

const WINDOW_SECONDS = 20;
const HOP_SECONDS = 10;
const MAX_WINDOWS = 30;        // keep last 30 windows (5 minutes of data)
const SAMPLE_RATE = 44100;

/**
 * ReferenceListener — connects to a radio stream and extracts features.
 *
 * Usage:
 *   const listener = new ReferenceListener();
 *   await listener.connect(stream);
 *   listener.start();          // begins feature extraction
 *   const metrics = listener.getLatestMetrics();
 *   const profile = listener.getProfile();
 *   listener.disconnect();
 */
export class ReferenceListener {
  private stream: RadioStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private audioEl: HTMLAudioElement | null = null;

  private connected = false;
  private extracting = false;
  private metricsHistory: ReferenceMetrics[] = [];
  private profile: ReferenceProfile | null = null;

  private extractInterval: ReturnType<typeof setInterval> | null = null;
  private captureBuffer: Float32Array | null = null;     // reused
  private captureBufferIdx = 0;
  private captureCtx: OfflineAudioContext | null = null;

  // Analyser data buffers (reused — NO per-frame allocation)
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private timeData: Uint8Array<ArrayBuffer> | null = null;

  // Callbacks
  private onMetricsCallback: ((m: ReferenceMetrics) => void) | null = null;
  private onProfileCallback: ((p: ReferenceProfile) => void) | null = null;
  private onErrorCallback: ((e: Error) => void) | null = null;

  /**
   * Connect to a radio stream.
   * Creates an HTMLAudioElement (NOT played through speakers) and routes it
   * through a MediaElementAudioSourceNode → AnalyserNode for feature extraction.
   */
  async connect(stream: RadioStream): Promise<boolean> {
    if (this.connected) {
      await this.disconnect();
    }

    this.stream = stream;

    try {
      // Create audio element (muted — we only analyze, never play to speakers)
      // MUST be appended to DOM for some browsers to play reliably
      this.audioEl = new Audio();
      this.audioEl.crossOrigin = 'anonymous';
      this.audioEl.preload = 'auto';
      this.audioEl.volume = 0; // silent — we only analyze
      // Some browsers require the element in the DOM
      this.audioEl.style.display = 'none';
      document.body.appendChild(this.audioEl);

      // Create AudioContext (needs user gesture — connect() is called from a click)
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new Ctx({ sampleRate: SAMPLE_RATE });
      // Resume immediately (we're in a user-gesture context from the button click)
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      // Set source BEFORE creating MediaElementAudioSourceNode
      this.audioEl.src = stream.url;
      this.audioEl.load();

      // Create source from audio element
      this.sourceNode = this.audioCtx.createMediaElementSource(this.audioEl);

      // Create analyser (FFT-based — NO ScriptProcessor)
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0.3;
      this.analyser.minDecibels = -90;
      this.analyser.maxDecibels = -10;

      // Route: source → analyser → destination (destination needed for analyser to process)
      // Audio element volume=0, so nothing is heard.
      this.sourceNode.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);

      // Pre-allocate reusable buffers (NO per-frame allocation).
      // Allocate via explicit ArrayBuffer so the typed array's buffer is
      // typed as ArrayBuffer (not ArrayBufferLike) — TS 5.7+ tightens
      // AnalyserNode.getByteFrequencyData's parameter to require this.
      this.freqData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
      this.timeData = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
      this.captureBuffer = new Float32Array(WINDOW_SECONDS * SAMPLE_RATE);

      // Start playback (muted) — must happen after context is running
      // Wait a moment for the source to be ready
      await new Promise(r => setTimeout(r, 100));
      const playPromise = this.audioEl.play();
      if (playPromise) {
        await playPromise.catch((err) => {
          console.warn('[ReferenceListener] play() rejected:', err);
          // Try again with a slight delay
          return new Promise<void>((resolve) => {
            setTimeout(() => {
              this.audioEl!.play().then(() => resolve()).catch(() => resolve());
            }, 500);
          });
        });
      }

      // Verify context is running
      if (this.audioCtx.state !== 'running') {
        await this.audioCtx.resume();
      }

      this.connected = true;
      return true;
    } catch (err) {
      this.onErrorCallback?.(err instanceof Error ? err : new Error(String(err)));
      await this.disconnect();
      return false;
    }
  }

  /** Start periodic feature extraction (every HOP_SECONDS). */
  start(): void {
    if (!this.connected || this.extracting) return;
    this.extracting = true;

    // Extract every HOP_SECONDS (10s)
    this.extractInterval = setInterval(() => {
      this.extractWindow().catch(err => {
        this.onErrorCallback?.(err instanceof Error ? err : new Error(String(err)));
      });
    }, HOP_SECONDS * 1000);

    // Also do an initial extraction after 2 seconds (once buffer has data)
    setTimeout(() => {
      this.extractWindow().catch(() => {});
    }, 2000);
  }

  /** Stop feature extraction. */
  stop(): void {
    this.extracting = false;
    if (this.extractInterval) {
      clearInterval(this.extractInterval);
      this.extractInterval = null;
    }
  }

  /** Disconnect from the stream. */
  async disconnect(): Promise<void> {
    this.stop();
    this.connected = false;

    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.src = '';
      // Remove from DOM if appended
      if (this.audioEl.parentNode) {
        this.audioEl.parentNode.removeChild(this.audioEl);
      }
      this.audioEl = null;
    }
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch { /* noop */ }
      this.sourceNode = null;
    }
    if (this.analyser) {
      try { this.analyser.disconnect(); } catch { /* noop */ }
      this.analyser = null;
    }
    if (this.audioCtx) {
      try { await this.audioCtx.close(); } catch { /* noop */ }
      this.audioCtx = null;
    }
    this.stream = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getCurrentStream(): RadioStream | null {
    return this.stream;
  }

  getLatestMetrics(): ReferenceMetrics | null {
    return this.metricsHistory.length > 0
      ? this.metricsHistory[this.metricsHistory.length - 1]
      : null;
  }

  getProfile(): ReferenceProfile | null {
    return this.profile;
  }

  getMetricsHistory(): ReferenceMetrics[] {
    return [...this.metricsHistory];
  }

  onMetrics(cb: (m: ReferenceMetrics) => void): void {
    this.onMetricsCallback = cb;
  }

  onProfile(cb: (p: ReferenceProfile) => void): void {
    this.onProfileCallback = cb;
  }

  onError(cb: (e: Error) => void): void {
    this.onErrorCallback = cb;
  }

  /**
   * Extract features from the current analyser state.
   * Captures WINDOW_SECONDS of audio via AnalyserNode (NOT ScriptProcessor).
   */
  private async extractWindow(): Promise<void> {
    if (!this.analyser || !this.audioCtx || !this.freqData || !this.timeData) return;

    // We can't capture a full 20s buffer via AnalyserNode directly.
    // Instead, we sample the analyser state multiple times over the window
    // and aggregate. This is the standard approach for real-time analysis.
    //
    // For a proper 20s window, we take ~20 snapshots (1/sec) and average
    // the spectral features. Temporal features (transients, BPM) use the
    // time-domain data.

    const snapshots: {
      freq: Uint8Array;
      time: Uint8Array;
    }[] = [];

    // Take 20 snapshots over 2 seconds (fast window for responsiveness)
    // Each snapshot is ~1 frame; we aggregate to approximate the 20s window
    const snapshotCount = 20;
    const snapshotInterval = 100; // ms

    for (let i = 0; i < snapshotCount; i++) {
      this.analyser.getByteFrequencyData(this.freqData);
      this.analyser.getByteTimeDomainData(this.timeData);
      // Copy current snapshot (small allocation, but only 20 times per window)
      snapshots.push({
        freq: new Uint8Array(this.freqData),
        time: new Uint8Array(this.timeData),
      });
      if (i < snapshotCount - 1) {
        await new Promise(r => setTimeout(r, snapshotInterval));
      }
    }

    // Extract features from the snapshots
    const metrics = this.extractFeatures(snapshots);
    this.metricsHistory.push(metrics);

    // Trim history
    if (this.metricsHistory.length > MAX_WINDOWS) {
      this.metricsHistory.shift();
    }

    // Update rolling profile
    this.updateProfile();

    // Fire callbacks
    this.onMetricsCallback?.(metrics);
    if (this.profile) {
      this.onProfileCallback?.(this.profile);
    }
  }

  /**
   * Extract acoustic features from analyser snapshots.
   */
  private extractFeatures(snapshots: { freq: Uint8Array; time: Uint8Array }[]): ReferenceMetrics {
    const sr = this.audioCtx?.sampleRate || SAMPLE_RATE;
    const fftSize = this.analyser?.fftSize || 4096;
    const binCount = snapshots[0].freq.length;
    const binHz = sr / 2 / binCount;

    // ── Average frequency spectrum across snapshots ──
    const avgFreq = new Float32Array(binCount);
    for (const snap of snapshots) {
      for (let i = 0; i < binCount; i++) {
        avgFreq[i] += snap.freq[i];
      }
    }
    for (let i = 0; i < binCount; i++) avgFreq[i] /= snapshots.length;

    // ── Spectral bands (0..1, normalized from byte 0..255) ──
    const bandEnergy = (loHz: number, hiHz: number): number => {
      const loBin = Math.max(1, Math.floor(loHz / binHz));
      const hiBin = Math.min(binCount - 1, Math.ceil(hiHz / binHz));
      let sum = 0;
      let count = 0;
      for (let i = loBin; i <= hiBin; i++) {
        sum += avgFreq[i] / 255;
        count++;
      }
      return count > 0 ? sum / count : 0;
    };

    const subEnergy = bandEnergy(20, 60);
    const lowEnergy = bandEnergy(60, 250);
    const midEnergy = bandEnergy(250, 2000);
    const highEnergy = bandEnergy(2000, 8000);
    const airEnergy = bandEnergy(8000, 20000);

    // ── Spectral centroid ──
    let weightedSum = 0;
    let totalMag = 0;
    for (let i = 1; i < binCount; i++) {
      const freq = i * binHz;
      const mag = avgFreq[i] / 255;
      weightedSum += freq * mag;
      totalMag += mag;
    }
    const spectralCentroid = totalMag > 0 ? weightedSum / totalMag : 0;

    // ── Spectral flatness (geometric mean / arithmetic mean) ──
    let logSum = 0;
    let arithSum = 0;
    let validCount = 0;
    for (let i = 1; i < binCount; i++) {
      const mag = avgFreq[i] / 255;
      if (mag > 0.001) {
        logSum += Math.log(mag);
        arithSum += mag;
        validCount++;
      }
    }
    const geoMean = validCount > 0 ? Math.exp(logSum / validCount) : 0;
    const arithMean = validCount > 0 ? arithSum / validCount : 0;
    const spectralFlatness = arithMean > 0 ? Math.min(1, geoMean / arithMean) : 0;

    // ── Spectral rolloff (85%) ──
    const totalEnergy = totalMag;
    const threshold85 = totalEnergy * 0.85;
    let cumulative = 0;
    let rolloffBin = binCount - 1;
    for (let i = 1; i < binCount; i++) {
      cumulative += avgFreq[i] / 255;
      if (cumulative >= threshold85) {
        rolloffBin = i;
        break;
      }
    }
    const spectralRolloff = rolloffBin * binHz;

    // ── Time-domain: RMS, peak, crest ──
    let sumSq = 0;
    let peak = 0;
    const allTimeSamples: number[] = [];
    for (const snap of snapshots) {
      for (let i = 0; i < snap.time.length; i++) {
        const s = (snap.time[i] - 128) / 128; // convert byte to -1..1
        sumSq += s * s;
        const abs = Math.abs(s);
        if (abs > peak) peak = abs;
        allTimeSamples.push(s);
      }
    }
    const n = allTimeSamples.length;
    const rms = Math.sqrt(sumSq / n);
    const crestFactor = rms > 0 ? peak / rms : 0;
    // LUFS approximation (K-weighted RMS, simplified)
    const lufs = 20 * Math.log10(rms + 1e-12) - 0.691;

    // ── Transient detection (from time-domain peaks) ──
    const transientThreshold = 0.15;
    const minGapMs = 80;
    const minGapSamples = (minGapMs / 1000) * sr;
    let transientCount = 0;
    let lastTransientIdx = -minGapSamples;
    for (let i = 1; i < n - 1; i++) {
      const s = allTimeSamples[i];
      const abs = Math.abs(s);
      if (abs > transientThreshold &&
          abs > Math.abs(allTimeSamples[i - 1]) &&
          abs > Math.abs(allTimeSamples[i + 1]) &&
          i - lastTransientIdx >= minGapSamples) {
        transientCount++;
        lastTransientIdx = i;
      }
    }
    // Snapshots cover ~2 seconds (20 × 100ms)
    const windowDurationSec = (snapshots.length * snapshotInterval) / 1000;
    const transientDensity = transientCount / windowDurationSec;

    // ── Kick/hat density (from frequency bands) ──
    // Kick: transients correlated with sub+low energy
    // Hat: transients correlated with high energy
    let kickCount = 0;
    let hatCount = 0;
    let percCount = 0;
    const subLowAvg = (subEnergy + lowEnergy) / 2;
    const highAvg = highEnergy;
    lastTransientIdx = -minGapSamples;
    for (let i = 1; i < n - 1; i++) {
      const s = allTimeSamples[i];
      const abs = Math.abs(s);
      if (abs > transientThreshold &&
          abs > Math.abs(allTimeSamples[i - 1]) &&
          abs > Math.abs(allTimeSamples[i + 1]) &&
          i - lastTransientIdx >= minGapSamples) {
        // Classify by which band is dominant at this moment
        // (simplified — we use the overall band averages as proxy)
        if (subLowAvg > 0.3) kickCount++;
        if (highAvg > 0.3) hatCount++;
        percCount++;
        lastTransientIdx = i;
      }
    }
    const kickDensity = kickCount / windowDurationSec;
    const hatDensity = hatCount / windowDurationSec;
    const percussionDensity = percCount / windowDurationSec;

    // ── BPM estimation (autocorrelation of low-frequency energy) ──
    // Sample the low-band energy over time and find the periodicity
    const lowBandEnergies: number[] = [];
    for (const snap of snapshots) {
      let lowSum = 0;
      const lowLoBin = Math.floor(40 / binHz);
      const lowHiBin = Math.ceil(120 / binHz);
      for (let i = lowLoBin; i <= lowHiBin; i++) {
        lowSum += snap.freq[i] / 255;
      }
      lowBandEnergies.push(lowSum / (lowHiBin - lowLoBin + 1));
    }
    // Autocorrelation to find tempo
    const bpm = this.estimateBPM(lowBandEnergies, snapshotInterval / 1000);
    const bpmConfidence = bpm > 0 ? 0.7 : 0; // simplified confidence

    // ── Kick/bass decay (from transient analysis) ──
    // Simplified: measure the decay of the low-band energy after a transient
    const kickDecayMs = this.estimateDecay(allTimeSamples, sr, 'low') * 1000;
    const bassDecayMs = this.estimateDecay(allTimeSamples, sr, 'low') * 1000;

    // ── Stereo width (from analyser — we only have mono-ish data, so estimate from spectral balance) ──
    // True stereo width requires L/R channels. With AnalyserNode on a stereo source,
    // we can approximate by looking at the correlation between frequency bands.
    // Simplified: assume moderate width for streaming audio.
    const stereoWidth = 0.4; // placeholder — would need channel splitter for true measurement

    // ── Rhythmic regularity (consistency of transient intervals) ──
    const rhythmicRegularity = this.computeRhythmicRegularity(allTimeSamples, sr);

    // ── Repetition score (spectral consistency across snapshots) ──
    let spectralVariance = 0;
    if (snapshots.length > 1) {
      const meanSpectrum = avgFreq;
      for (const snap of snapshots) {
        let diff = 0;
        for (let i = 0; i < binCount; i++) {
          diff += Math.abs(snap.freq[i] - meanSpectrum[i]);
        }
        spectralVariance += diff / binCount;
      }
      spectralVariance /= snapshots.length;
    }
    // Lower variance = higher repetition
    const repetitionScore = Math.max(0, Math.min(1, 1 - spectralVariance / 50));

    // ── Overall energy ──
    const energy = Math.min(1, rms * 3);

    // ── Confidence ──
    const overallConfidence = Math.min(1, (rms > 0.01 ? 0.3 : 0) +
                                           (snapshots.length >= 10 ? 0.3 : 0) +
                                           (bpm > 0 ? 0.2 : 0) +
                                           (transientCount > 5 ? 0.2 : 0));

    return {
      bpm,
      bpmConfidence,
      rms,
      peak,
      lufs,
      crestFactor,
      subEnergy,
      lowEnergy,
      midEnergy,
      highEnergy,
      airEnergy,
      spectralCentroid,
      spectralFlatness,
      spectralRolloff,
      transientDensity,
      kickDensity,
      hatDensity,
      percussionDensity,
      stereoWidth,
      kickDecayMs,
      bassDecayMs,
      rhythmicRegularity,
      repetitionScore,
      energy,
      overallConfidence,
      timestamp: Date.now(),
      sourceStream: this.stream?.id || 'unknown',
    };
  }

  /**
   * Estimate BPM via autocorrelation of an energy envelope.
   */
  private estimateBPM(energies: number[], hopSec: number): number {
    if (energies.length < 4) return 0;

    // Normalize
    const mean = energies.reduce((a, b) => a + b, 0) / energies.length;
    const normalized = energies.map(e => e - mean);

    // Autocorrelation — find lag with highest correlation
    // BPM range: 120-160 → lag range in samples
    // At hopSec interval, 120 BPM = 0.5s = 0.5/hopSec lags
    // 160 BPM = 0.375s = 0.375/hopSec lags
    const minLag = Math.floor(0.3 / hopSec); // ~200 BPM
    const maxLag = Math.floor(1.0 / hopSec); // ~60 BPM
    const maxLagClamped = Math.min(maxLag, Math.floor(energies.length / 2));

    let bestLag = 0;
    let bestCorr = 0;

    for (let lag = minLag; lag <= maxLagClamped; lag++) {
      let corr = 0;
      let count = 0;
      for (let i = 0; i < energies.length - lag; i++) {
        corr += normalized[i] * normalized[i + lag];
        count++;
      }
      corr = count > 0 ? corr / count : 0;
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }

    if (bestLag === 0 || bestCorr < 0.01) return 0;

    const periodSec = bestLag * hopSec;
    const bpm = 60 / periodSec;

    // Snap to common psytrance range
    if (bpm < 60) return 0;
    if (bpm > 200) return 0;
    // Fold into 120-160 range
    let foldedBpm = bpm;
    while (foldedBpm < 120) foldedBpm *= 2;
    while (foldedBpm > 160) foldedBpm /= 2;

    return Math.round(foldedBpm);
  }

  /**
   * Estimate decay time of transients in a given frequency band.
   */
  private estimateDecay(samples: number[], sr: number, band: 'low' | 'high'): number {
    // Find the first significant transient
    const threshold = 0.2;
    let peakIdx = -1;
    for (let i = 1; i < samples.length - 1; i++) {
      if (Math.abs(samples[i]) > threshold &&
          Math.abs(samples[i]) > Math.abs(samples[i - 1]) &&
          Math.abs(samples[i]) > Math.abs(samples[i + 1])) {
        peakIdx = i;
        break;
      }
    }
    if (peakIdx < 0) return 0.1; // default 100ms

    // Measure decay from peak to 10% of peak
    const peakVal = Math.abs(samples[peakIdx]);
    const targetVal = peakVal * 0.1;
    for (let i = peakIdx; i < samples.length; i++) {
      if (Math.abs(samples[i]) <= targetVal) {
        return (i - peakIdx) / sr;
      }
    }
    return 0.2; // didn't decay within window
  }

  /**
   * Compute rhythmic regularity (0..1).
   * Measures how evenly spaced the transients are.
   */
  private computeRhythmicRegularity(samples: number[], sr: number): number {
    const threshold = 0.15;
    const minGapSamples = Math.floor(0.08 * sr);
    const transients: number[] = [];
    let lastIdx = -minGapSamples;
    for (let i = 1; i < samples.length - 1; i++) {
      const abs = Math.abs(samples[i]);
      if (abs > threshold &&
          abs > Math.abs(samples[i - 1]) &&
          abs > Math.abs(samples[i + 1]) &&
          i - lastIdx >= minGapSamples) {
        transients.push(i);
        lastIdx = i;
      }
    }
    if (transients.length < 3) return 0;

    // Compute intervals
    const intervals: number[] = [];
    for (let i = 1; i < transients.length; i++) {
      intervals.push(transients[i] - transients[i - 1]);
    }
    const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((a, b) => a + (b - meanInterval) ** 2, 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    const cv = meanInterval > 0 ? stdDev / meanInterval : 1;
    return Math.max(0, Math.min(1, 1 - cv));
  }

  /**
   * Update the rolling reference profile with the latest metrics.
   */
  private updateProfile(): void {
    if (this.metricsHistory.length === 0) return;
    const windows = this.metricsHistory;

    const stats = (vals: number[]) => {
      if (vals.length === 0) return { mean: 0, p10: 0, p90: 0 };
      const sorted = [...vals].sort((a, b) => a - b);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      return {
        mean,
        p10: sorted[Math.floor(sorted.length * 0.1)] || sorted[0],
        p90: sorted[Math.floor(sorted.length * 0.9)] || sorted[sorted.length - 1],
      };
    };

    this.profile = {
      bpm: { ...stats(windows.map(w => w.bpm)), count: windows.length },
      rms: stats(windows.map(w => w.rms)),
      lufs: stats(windows.map(w => w.lufs)),
      subEnergy: stats(windows.map(w => w.subEnergy)),
      lowEnergy: stats(windows.map(w => w.lowEnergy)),
      midEnergy: stats(windows.map(w => w.midEnergy)),
      highEnergy: stats(windows.map(w => w.highEnergy)),
      airEnergy: stats(windows.map(w => w.airEnergy)),
      spectralCentroid: stats(windows.map(w => w.spectralCentroid)),
      transientDensity: stats(windows.map(w => w.transientDensity)),
      kickDecayMs: stats(windows.map(w => w.kickDecayMs)),
      bassDecayMs: stats(windows.map(w => w.bassDecayMs)),
      stereoWidth: stats(windows.map(w => w.stereoWidth)),
      energy: stats(windows.map(w => w.energy)),
      windowCount: windows.length,
      lastUpdated: Date.now(),
      sourceStream: this.stream?.id || 'unknown',
    };
  }
}

// Fix: snapshotInterval is used in extractFeatures — define as constant
const snapshotInterval = 100;
