/**
 * ReferenceListener V2 — robust cross-origin stream analysis.
 *
 * V1 used MediaElementAudioSourceNode which outputs SILENCE for cross-origin
 * streams even with crossOrigin='anonymous' + CORS headers, because the
 * analyser node receives zeroed data (CORS tainting protection).
 *
 * V2 uses fetch() + ReadableStream + decodeAudioData:
 *   1. fetch(streamUrl) — gets a ReadableStream of MP3 bytes
 *   2. Accumulate chunks into a buffer
 *   3. Every 10 seconds, take the accumulated bytes and decodeAudioData them
 *   4. Analyze the decoded AudioBuffer (which is NOT tainted)
 *   5. Extract features
 *
 * This is the standard approach for cross-origin audio analysis.
 * NO ScriptProcessorNode. NO MediaElementAudioSourceNode.
 * The audio is NEVER played through speakers — only decoded for analysis.
 *
 * CRITICAL: This does NOT copy or store the audio. The decoded AudioBuffer
 * is analyzed and immediately discarded. Only features are kept.
 */

import type { RadioStream } from './radioStreams';
import type { ReferenceMetrics, ReferenceProfile } from './referenceListener';

const WINDOW_SECONDS = 20;
const HOP_SECONDS = 10;
const MAX_WINDOWS = 30;
const SAMPLE_RATE = 44100;
const MIN_BYTES_FOR_ANALYSIS = 256 * 1024; // 256KB ≈ 16 seconds at 128kbps

// ── Task T1: local numeric clamp (the file has no shared util) ──
// Guards every new metric against NaN/Infinity so the pursuit can rely on
// finite values even when the FFT produces denormals or all-zero frames.
function clampT1(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : (v > hi ? hi : v);
}

export class ReferenceListenerV2 {
  private stream: RadioStream | null = null;
  private audioCtx: AudioContext | null = null;
  private connected = false;
  private extracting = false;

  private fetchController: AbortController | null = null;
  private chunkBuffer: Uint8Array[] = [];
  private chunkBufferTotalBytes = 0;

  private metricsHistory: ReferenceMetrics[] = [];
  private profile: ReferenceProfile | null = null;

  private extractInterval: ReturnType<typeof setInterval> | null = null;
  private fetchReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  private onMetricsCallback: ((m: ReferenceMetrics) => void) | null = null;
  private onProfileCallback: ((p: ReferenceProfile) => void) | null = null;
  private onErrorCallback: ((e: Error) => void) | null = null;

  /**
   * Connect to a radio stream.
   * Starts fetching the stream as a ReadableStream of bytes.
   */
  async connect(stream: RadioStream): Promise<boolean> {
    if (this.connected) {
      await this.disconnect();
    }

    this.stream = stream;
    this.chunkBuffer = [];
    this.chunkBufferTotalBytes = 0;
    this.metricsHistory = [];

    try {
      // Create AudioContext for decodeAudioData.
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new Ctx({ sampleRate: SAMPLE_RATE });
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      // Start fetching the stream.
      // Try proxy first, fall back to direct URL for HTTPS streams.
      this.fetchController = new AbortController();
      this.connected = true;

      const fetchUrl = stream.url.startsWith('https')
        ? stream.url  // HTTPS streams can be fetched directly (CORS-friendly)
        : `/api/reference/proxy?stream=${encodeURIComponent(stream.id)}`;  // HTTP needs proxy
      this.startStreamingFetch(fetchUrl);

      return true;
    } catch (err) {
      this.onErrorCallback?.(err instanceof Error ? err : new Error(String(err)));
      await this.disconnect();
      return false;
    }
  }

  /**
   * Start fetching the stream as a ReadableStream.
   * Accumulates bytes into chunkBuffer for periodic analysis.
   */
  private async startStreamingFetch(url: string): Promise<void> {
    try {
      const response = await fetch(url, {
        signal: this.fetchController?.signal,
        headers: { 'Accept': 'audio/mpeg, audio/aac, */*' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      this.fetchReader = response.body.getReader();

      // Read chunks continuously
      while (this.connected && this.fetchReader) {
        const { done, value } = await this.fetchReader.read();
        if (done) break;
        if (value) {
          // Accumulate chunk (we keep a rolling buffer — discard old bytes)
          this.chunkBuffer.push(value);
          this.chunkBufferTotalBytes += value.length;

          // Trim buffer to ~1 minute of audio (768KB at 128kbps)
          const maxBytes = 768 * 1024;
          while (this.chunkBufferTotalBytes > maxBytes && this.chunkBuffer.length > 1) {
            const removed = this.chunkBuffer.shift()!;
            this.chunkBufferTotalBytes -= removed.length;
          }
        }
      }
    } catch (err) {
      if (this.connected) {
        this.onErrorCallback?.(err instanceof Error ? err : new Error(String(err)));
      }
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

    // Initial extraction after 15 seconds (need enough bytes to decode)
    setTimeout(() => {
      this.extractWindow().catch(() => {});
    }, 15000);
  }

  stop(): void {
    this.extracting = false;
    if (this.extractInterval) {
      clearInterval(this.extractInterval);
      this.extractInterval = null;
    }
  }

  async disconnect(): Promise<void> {
    this.stop();
    this.connected = false;

    // Abort fetch
    if (this.fetchController) {
      this.fetchController.abort();
      this.fetchController = null;
    }

    // Release reader
    if (this.fetchReader) {
      try { await this.fetchReader.cancel(); } catch { /* noop */ }
      this.fetchReader = null;
    }

    // Close audio context
    if (this.audioCtx) {
      try { await this.audioCtx.close(); } catch { /* noop */ }
      this.audioCtx = null;
    }

    this.chunkBuffer = [];
    this.chunkBufferTotalBytes = 0;
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

  getBufferedBytes(): number {
    return this.chunkBufferTotalBytes;
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
   * Extract features from the current buffer.
   * Concatenates buffered bytes, decodes via decodeAudioData, analyzes.
   */
  private async extractWindow(): Promise<void> {
    if (!this.audioCtx || this.chunkBufferTotalBytes < MIN_BYTES_FOR_ANALYSIS) {
      return; // not enough data yet
    }

    try {
      // Concatenate buffered bytes into a single ArrayBuffer
      // Take the last ~20 seconds of data (256KB at 128kbps)
      const targetBytes = Math.min(this.chunkBufferTotalBytes, 320 * 1024);
      const combined = new Uint8Array(targetBytes);
      let offset = 0;
      const chunksToCopy = [...this.chunkBuffer];

      // Skip leading chunks if we have more than targetBytes
      let skipBytes = this.chunkBufferTotalBytes - targetBytes;
      for (const chunk of chunksToCopy) {
        if (skipBytes > 0) {
          if (chunk.length <= skipBytes) {
            skipBytes -= chunk.length;
            continue;
          } else {
            const slice = chunk.subarray(skipBytes);
            combined.set(slice, offset);
            offset += slice.length;
            skipBytes = 0;
          }
        } else {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
      }

      // Trim to actual size
      const audioData = combined.buffer.slice(0, offset);

      // Decode the MP3/AAC data to an AudioBuffer
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await this.audioCtx.decodeAudioData(audioData);
      } catch (decodeErr) {
        return;
      }

      // Extract features from the decoded buffer
      const metrics = await this.extractFeaturesFromBuffer(audioBuffer);
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
    } catch (err) {
      // Silent fail — we'll try again next window
    }
  }

  /**
   * Extract features from a decoded AudioBuffer.
   * This is the REAL analysis — using the actual PCM data.
   */
  private async extractFeaturesFromBuffer(buffer: AudioBuffer): Promise<ReferenceMetrics> {
    const sr = buffer.sampleRate;
    const numChannels = buffer.numberOfChannels;
    const length = buffer.length;
    const duration = buffer.duration;

    // Get channel data
    const leftData = buffer.getChannelData(0);
    const rightData = numChannels > 1 ? buffer.getChannelData(1) : leftData;

    // Mono mix for analysis
    const mono = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      mono[i] = (leftData[i] + rightData[i]) * 0.5;
    }

    // ── Dynamics ──
    let peak = 0;
    let sumSq = 0;
    for (let i = 0; i < length; i++) {
      const abs = Math.abs(mono[i]);
      if (abs > peak) peak = abs;
      sumSq += mono[i] * mono[i];
    }
    const rms = Math.sqrt(sumSq / length);
    const crestFactor = rms > 0 ? peak / rms : 0;
    const lufs = 20 * Math.log10(rms + 1e-12) - 0.691;

    // ── FFT for spectral analysis ──
    const fftSize = 8192;
    const numHops = Math.floor((length - fftSize) / (fftSize / 2)) + 1;
    const avgMag = new Float32Array(fftSize / 2 + 1);

    // Simple windowed FFT (reusing the forensic FFT)
    const window = this.hannWindow(fftSize);
    for (let h = 0; h < Math.max(1, numHops); h++) {
      const start = h * (fftSize / 2);
      const frame = new Float32Array(fftSize);
      const copyLen = Math.min(fftSize, length - start);
      for (let i = 0; i < copyLen; i++) {
        frame[i] = mono[start + i] * window[i];
      }
      const mag = this.powerSpectrum(frame);
      for (let i = 0; i < avgMag.length; i++) {
        avgMag[i] += mag[i];
      }
    }
    for (let i = 0; i < avgMag.length; i++) avgMag[i] /= Math.max(1, numHops);

    const binHz = sr / fftSize;

    // Band energies
    const bandEnergy = (loHz: number, hiHz: number): number => {
      const loBin = Math.max(1, Math.floor(loHz / binHz));
      const hiBin = Math.min(avgMag.length - 1, Math.ceil(hiHz / binHz));
      let sum = 0, count = 0;
      for (let i = loBin; i <= hiBin; i++) {
        sum += avgMag[i];
        count++;
      }
      return count > 0 ? sum / count : 0;
    };

    const subEnergy = Math.sqrt(bandEnergy(20, 60));
    const lowEnergy = Math.sqrt(bandEnergy(60, 250));
    const midEnergy = Math.sqrt(bandEnergy(250, 2000));
    const highEnergy = Math.sqrt(bandEnergy(2000, 8000));
    const airEnergy = Math.sqrt(bandEnergy(8000, 20000));

    // Spectral centroid
    let weightedSum = 0, totalMag = 0;
    for (let i = 1; i < avgMag.length; i++) {
      const freq = i * binHz;
      weightedSum += freq * avgMag[i];
      totalMag += avgMag[i];
    }
    const spectralCentroid = totalMag > 0 ? weightedSum / totalMag : 0;

    // Spectral flatness
    let logSum = 0, arithSum = 0, validCount = 0;
    for (let i = 1; i < avgMag.length; i++) {
      if (avgMag[i] > 1e-15) {
        logSum += Math.log(avgMag[i]);
        arithSum += avgMag[i];
        validCount++;
      }
    }
    const geoMean = validCount > 0 ? Math.exp(logSum / validCount) : 0;
    const arithMean = validCount > 0 ? arithSum / validCount : 0;
    const spectralFlatness = arithMean > 0 ? Math.min(1, geoMean / arithMean) : 0;

    // Spectral rolloff
    const threshold85 = totalMag * 0.85;
    let cumulative = 0, rolloffBin = avgMag.length - 1;
    for (let i = 1; i < avgMag.length; i++) {
      cumulative += avgMag[i];
      if (cumulative >= threshold85) { rolloffBin = i; break; }
    }
    const spectralRolloff = rolloffBin * binHz;

    // ── Transient detection ──
    const transientThreshold = 0.15;
    const minGapSamples = Math.floor(0.08 * sr);
    let transientCount = 0;
    let lastTransientIdx = -minGapSamples;
    const transientIndices: number[] = [];
    for (let i = 1; i < length - 1; i++) {
      const abs = Math.abs(mono[i]);
      if (abs > transientThreshold &&
          abs > Math.abs(mono[i - 1]) &&
          abs > Math.abs(mono[i + 1]) &&
          i - lastTransientIdx >= minGapSamples) {
        transientCount++;
        transientIndices.push(i);
        lastTransientIdx = i;
      }
    }
    const transientDensity = transientCount / duration;

    // Kick/hat density (simplified — based on low/high band energy at transient times)
    let kickCount = 0, hatCount = 0;
    for (const idx of transientIndices) {
      // Check low-band energy at this time
      const frameStart = Math.max(0, idx - 1024);
      const frameEnd = Math.min(length, idx + 1024);
      let lowSum = 0, highSum = 0, count = 0;
      for (let i = frameStart; i < frameEnd; i++) {
        // Simple bandpass via FFT would be better, but use sample magnitude as proxy
        lowSum += Math.abs(mono[i]);
        highSum += Math.abs(mono[i] - (mono[i - 1] || 0)); // high-freq = differentiation
        count++;
      }
      if (lowSum / count > 0.1) kickCount++;
      if (highSum / count > 0.05) hatCount++;
    }
    const kickDensity = kickCount / duration;
    const hatDensity = hatCount / duration;
    const percussionDensity = transientCount / duration;

    // ── BPM estimation (autocorrelation of low-band energy envelope) ──
    const bpm = this.estimateBPM(mono, sr);

    // ── Kick/bass decay ──
    const kickDecaySec = this.estimateDecay(mono, sr);
    const kickDecayMs = kickDecaySec * 1000;
    const bassDecayMs = kickDecayMs; // simplified

    // ── Stereo width (from L/R correlation) ──
    let lrCorr = 0;
    let lEnergy = 0, rEnergy = 0;
    for (let i = 0; i < length; i += 10) { // sample every 10th
      lrCorr += leftData[i] * rightData[i];
      lEnergy += leftData[i] * leftData[i];
      rEnergy += rightData[i] * rightData[i];
    }
    const denom = Math.sqrt(lEnergy * rEnergy) + 1e-12;
    const correlation = lrCorr / denom;
    // Stereo width = 1 - correlation (0 = mono, 1 = wide)
    const stereoWidth = Math.max(0, Math.min(1, 1 - Math.abs(correlation)));

    // ── Task T1: extended stereo-field analysis ──
    // balance: -1 (full L) .. +1 (full R). correlation: signed value (the
    // magnitude was used for stereoWidth above; the sign tells us phase).
    // msRatio: side energy / (mid + side) energy → 0 = mono, 1 = full side.
    const stereoBalance = (lEnergy + rEnergy) > 0
      ? clampT1((rEnergy - lEnergy) / (lEnergy + rEnergy + 1e-12), -1, 1)
      : 0;
    const stereoCorrelation = isFinite(correlation) ? clampT1(correlation, -1, 1) : 0;
    let midEnergySum = 0, sideEnergySum = 0;
    const stereoStride = Math.max(1, Math.floor(length / 50000));
    for (let i = 0; i < length; i += stereoStride) {
      const l = leftData[i];
      const r = rightData[i];
      const mid = (l + r) * 0.5;
      const side = (l - r) * 0.5;
      midEnergySum += mid * mid;
      sideEnergySum += side * side;
    }
    const msRatio = (midEnergySum + sideEnergySum) > 0
      ? clampT1(sideEnergySum / (midEnergySum + sideEnergySum + 1e-12), 0, 1)
      : 0;

    // ── Task T1: spectral crest (peak-to-mean magnitude ratio) ──
    let magMax = 0;
    let magSum = 0;
    for (let i = 1; i < avgMag.length; i++) {
      if (avgMag[i] > magMax) magMax = avgMag[i];
      magSum += avgMag[i];
    }
    const magMean = magSum / Math.max(1, avgMag.length - 1);
    const spectralCrest = magMean > 0 ? magMax / magMean : 0;

    // ── Task T1: spectral slope (dB/octave) via linear regression ──
    // Fit ln(magnitude) = a + b * ln(freq). Convert slope b to dB/octave:
    //   slope_dB_per_oct = b * ln(2) / ln(10^(1/10))  ... but since we want
    //   dB per octave of frequency, and dB = 20*log10(mag), the simpler form
    //   is: slope_dB_per_oct = b * ln(2) * 20 / ln(10) ≈ b * 6.0206.
    // Typical: -6 (bright), -12 (balanced), -18 (dark), -24 (very dark).
    let slopeN = 0, slopeSumX = 0, slopeSumY = 0, slopeSumXY = 0, slopeSumXX = 0;
    const minSlopeBin = Math.max(2, Math.floor(80 / binHz));
    for (let i = minSlopeBin; i < avgMag.length; i++) {
      if (avgMag[i] <= 1e-12) continue;
      const logF = Math.log(i * binHz);
      const logM = Math.log(avgMag[i]);
      slopeN++;
      slopeSumX += logF;
      slopeSumY += logM;
      slopeSumXY += logF * logM;
      slopeSumXX += logF * logF;
    }
    let spectralSlopeDb = 0;
    if (slopeN > 2) {
      const slopeDenom = slopeN * slopeSumXX - slopeSumX * slopeSumX;
      if (Math.abs(slopeDenom) > 1e-9) {
        const b = (slopeN * slopeSumXY - slopeSumX * slopeSumY) / slopeDenom;
        spectralSlopeDb = b * Math.log(2) * 20 / Math.log(10);
      }
    }
    // Clamp into a sane audio range so the pursuit doesn't react to noise.
    spectralSlopeDb = clampT1(spectralSlopeDb, -36, 6);

    // ── Task T1: fundamental-frequency estimate via HPS (harmonic product spectrum) ──
    // Used for HNR + inharmonicity. Multiply downsampled spectra — the bin
    // whose product is largest is most likely f0. Limited to 80-2000 Hz to
    // avoid sub-harmonic and ultrasonic false positives.
    const hpsDepth = 4;
    const hpsMinBin = Math.max(2, Math.floor(80 / binHz));
    const hpsMaxBin = Math.min(
      Math.floor(avgMag.length / hpsDepth) - 1,
      Math.floor(2000 / binHz),
    );
    let hpsBestBin = 0;
    let hpsBestVal = 0;
    for (let i = hpsMinBin; i <= hpsMaxBin; i++) {
      let prod = avgMag[i];
      for (let h = 2; h <= hpsDepth; h++) {
        prod *= (avgMag[i * h] || 1e-15);
      }
      if (prod > hpsBestVal) {
        hpsBestVal = prod;
        hpsBestBin = i;
      }
    }
    const f0Hz = hpsBestBin > 0 ? hpsBestBin * binHz : 0;

    // ── Task T1: harmonic-to-noise ratio (HNR) ──
    // Sum energy in ±2-bin windows around the first 10 harmonic bins; compare
    // to total spectral energy above a small threshold. HNR = E_harmonic / E_total.
    let harmonicEnergy = 0;
    let totalSpectralEnergy = 0;
    if (f0Hz > 60 && f0Hz < 2000) {
      for (let h = 1; h <= 10; h++) {
        const targetBin = Math.round((h * f0Hz) / binHz);
        if (targetBin >= avgMag.length) break;
        const lo = Math.max(1, targetBin - 2);
        const hi = Math.min(avgMag.length - 1, targetBin + 2);
        for (let b = lo; b <= hi; b++) harmonicEnergy += avgMag[b];
      }
    }
    for (let i = 1; i < avgMag.length; i++) {
      if (avgMag[i] > 1e-12) totalSpectralEnergy += avgMag[i];
    }
    const hnr = (totalSpectralEnergy > 0 && harmonicEnergy > 0)
      ? clampT1(harmonicEnergy / totalSpectralEnergy, 0, 1)
      : 0;

    // ── Task T1: inharmonicity (0..1) ──
    // Find spectral peaks (local maxima ≥ 3× mean). For each peak above f0,
    // compute the relative frequency deviation from the nearest integer
    // harmonic. Average deviation × 5 (so 20% mean deviation maps to 1.0).
    const peakThreshold = magMean * 3;
    const peaks: { freq: number }[] = [];
    for (let i = 2; i < avgMag.length - 2; i++) {
      if (avgMag[i] > peakThreshold &&
          avgMag[i] > avgMag[i - 1] &&
          avgMag[i] > avgMag[i + 1] &&
          avgMag[i] >= avgMag[i - 2] &&
          avgMag[i] >= avgMag[i + 2]) {
        peaks.push({ freq: i * binHz });
      }
    }
    let inharmonicity = 0;
    if (f0Hz > 60 && peaks.length > 2) {
      let totalDev = 0;
      let countedPeaks = 0;
      for (const p of peaks) {
        if (p.freq < f0Hz * 0.9) continue;
        const harmonicNum = Math.round(p.freq / f0Hz);
        if (harmonicNum < 1) continue;
        const expectedFreq = harmonicNum * f0Hz;
        const dev = Math.abs(p.freq - expectedFreq) / expectedFreq;
        totalDev += dev;
        countedPeaks++;
      }
      if (countedPeaks > 0) {
        inharmonicity = clampT1((totalDev / countedPeaks) * 5, 0, 1);
      }
    }

    // ── Task T1: transient sharpness + decay ──
    // For each detected transient, measure attack rise time (10% → 90% of
    // peak) and decay time (peak → 10% of peak). Sharpness = 1 - rise/30ms.
    // Decay is averaged in ms. Caps on the analysis window keep this O(N).
    let sumSharpness = 0;
    let sumDecayMs = 0;
    let validTransients = 0;
    const attackWindow = Math.floor(sr * 0.030);   // 30 ms look-back
    const decayWindow = Math.floor(sr * 0.300);    // 300 ms look-ahead
    const minPeak = 0.05;
    for (const idx of transientIndices) {
      const peakVal = Math.abs(mono[idx]);
      if (peakVal < minPeak) continue;
      // Attack phase
      const startIdx = Math.max(1, idx - attackWindow);
      let tenIdx = -1, ninetyIdx = -1;
      for (let i = startIdx; i <= idx; i++) {
        const a = Math.abs(mono[i]);
        if (tenIdx < 0 && a >= peakVal * 0.1) tenIdx = i;
        if (ninetyIdx < 0 && a >= peakVal * 0.9) ninetyIdx = i;
        if (tenIdx >= 0 && ninetyIdx >= 0) break;
      }
      if (tenIdx >= 0 && ninetyIdx > tenIdx) {
        const riseMs = ((ninetyIdx - tenIdx) / sr) * 1000;
        sumSharpness += clampT1(1 - riseMs / 30, 0, 1);
      } else {
        sumSharpness += 0.5; // unknown attack — assume neutral
      }
      // Decay phase
      const endIdx = Math.min(length - 1, idx + decayWindow);
      let decaySamples = decayWindow;
      for (let i = idx + 1; i <= endIdx; i++) {
        if (Math.abs(mono[i]) <= peakVal * 0.1) {
          decaySamples = i - idx;
          break;
        }
      }
      sumDecayMs += (decaySamples / sr) * 1000;
      validTransients++;
    }
    const transientSharpness = validTransients > 0
      ? clampT1(sumSharpness / validTransients, 0, 1)
      : 0;
    const transientDecayMs = validTransients > 0
      ? clampT1(sumDecayMs / validTransients, 0, 1000)
      : 0;

    // ── Rhythmic regularity ──
    const rhythmicRegularity = this.computeRegularity(transientIndices);

    // ── Repetition score (spectral consistency) ──
    // Simplified: use flatness as inverse of repetition
    const repetitionScore = Math.max(0, Math.min(1, 1 - spectralFlatness));

    // ── Energy ──
    const energy = Math.min(1, rms * 3);

    // ── Confidence ──
    const overallConfidence = Math.min(1,
      (rms > 0.01 ? 0.3 : 0) +
      (transientCount > 5 ? 0.3 : 0) +
      (bpm > 0 ? 0.2 : 0) +
      (duration > 5 ? 0.2 : 0)
    );

    // ── Musical understanding (key, bass note, style detection) ──
    let detectedKey: { root: number; rootName: string; scale: string; confidence: number } | undefined;
    let detectedBassNote: { note: number; freq: number; confidence: number } | undefined;
    let detectedStyle: { style: string; confidence: number } | undefined;

    try {
      // Dynamic import for musical understanding (optional, won't block)
      const mu = await import('./musicalUnderstanding');
      const chromagram = mu.computeChromagram(avgMag, sr, fftSize);
      const key = mu.detectKey(chromagram);
      detectedKey = {
        root: key.root,
        rootName: key.rootName,
        scale: key.scale,
        confidence: key.confidence,
      };

      const bass = mu.detectBassNote(avgMag, sr, fftSize);
      if (bass) {
        detectedBassNote = bass;
      }

      const style = mu.classifyStyle(bpm, spectralCentroid, subEnergy, highEnergy);
      detectedStyle = style;
    } catch (e) {
      // Musical understanding is optional
    }

    return {
      bpm,
      bpmConfidence: bpm > 0 ? 0.8 : 0,
      rms, peak, lufs, crestFactor,
      subEnergy, lowEnergy, midEnergy, highEnergy, airEnergy,
      spectralCentroid, spectralFlatness, spectralRolloff,
      transientDensity, kickDensity, hatDensity, percussionDensity,
      stereoWidth, kickDecayMs, bassDecayMs,
      rhythmicRegularity, repetitionScore,
      energy, overallConfidence,
      detectedKey,
      detectedBassNote,
      detectedStyle,
      // ── Task T1: extended harmonic / transient-shape / stereo fields ──
      spectralCrest,
      hnr,
      inharmonicity,
      spectralSlopeDb,
      transientSharpness,
      transientDecayMs,
      stereoBalance,
      stereoCorrelation,
      msRatio,
      timestamp: Date.now(),
      sourceStream: this.stream?.id || 'unknown',
    };
  }

  // ─── DSP helpers ──────────────────────────────────────────────────────────

  private hannWindow(n: number): Float32Array {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
    }
    return w;
  }

  private powerSpectrum(frame: Float32Array): Float32Array {
    const n = frame.length;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    real.set(frame);
    this.fft(real, imag);
    const half = n / 2;
    const mag = new Float32Array(half + 1);
    for (let i = 0; i <= half; i++) {
      mag[i] = (real[i] * real[i] + imag[i] * imag[i]) / n;
    }
    return mag;
  }

  private fft(real: Float32Array, imag: Float32Array): void {
    const n = real.length;
    if (n <= 1) return;
    let j = 0;
    for (let i = 1; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const angle = -2 * Math.PI / len;
      const wReal = Math.cos(angle);
      const wImag = Math.sin(angle);
      for (let i = 0; i < n; i += len) {
        let curReal = 1, curImag = 0;
        for (let k = 0; k < len / 2; k++) {
          const idx1 = i + k;
          const idx2 = i + k + len / 2;
          const tReal = curReal * real[idx2] - curImag * imag[idx2];
          const tImag = curReal * imag[idx2] + curImag * real[idx2];
          real[idx2] = real[idx1] - tReal;
          imag[idx2] = imag[idx1] - tImag;
          real[idx1] += tReal;
          imag[idx1] += tImag;
          const nextReal = curReal * wReal - curImag * wImag;
          curImag = curReal * wImag + curImag * wReal;
          curReal = nextReal;
        }
      }
    }
  }

  private estimateBPM(samples: Float32Array, sr: number): number {
    // FIXED: proper one-pole lowpass to isolate kick band, then energy envelope + autocorrelation.
    // Previous version had a NaN bug (runningSum could go negative → sqrt(negative) = NaN).
    const cutoff = 150; // Hz — isolate kick/bass band
    const a = 1 - Math.exp(-2 * Math.PI * cutoff / sr);
    const lowpassed = new Float32Array(samples.length);
    let lpState = 0;
    for (let i = 0; i < samples.length; i++) {
      lpState += a * (samples[i] - lpState);
      lowpassed[i] = lpState;
    }

    // Energy envelope: RMS in 50ms windows, 10ms hop
    const hopSize = Math.floor(sr * 0.01);
    const frameSize = Math.floor(sr * 0.05);
    const energies: number[] = [];
    for (let i = 0; i + frameSize < lowpassed.length; i += hopSize) {
      let sumSq = 0;
      for (let j = 0; j < frameSize; j++) {
        sumSq += lowpassed[i + j] * lowpassed[i + j];
      }
      energies.push(Math.sqrt(sumSq / frameSize));
    }

    if (energies.length < 20) return 0;

    // Normalize (remove DC)
    const mean = energies.reduce((x, y) => x + y, 0) / energies.length;
    if (mean < 0.0001 || !isFinite(mean)) return 0;
    const normalized = energies.map(e => e - mean);

    // Autocorrelation — search for tempo
    const hopSec = 0.01;
    const minLag = Math.floor(0.3 / hopSec);  // 200 BPM
    const maxLag = Math.floor(1.0 / hopSec);  // 60 BPM
    const maxLagClamped = Math.min(maxLag, Math.floor(energies.length / 2));

    let bestLag = 0, bestCorr = -Infinity;
    for (let lag = minLag; lag <= maxLagClamped; lag++) {
      let corr = 0, count = 0;
      for (let i = 0; i < energies.length - lag; i++) {
        corr += normalized[i] * normalized[i + lag];
        count++;
      }
      corr = count > 0 ? corr / count : 0;
      if (!isFinite(corr)) continue;
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }

    if (bestLag === 0 || bestCorr < 0.001 || !isFinite(bestCorr)) return 0;

    const periodSec = bestLag * hopSec;
    let bpm = 60 / periodSec;
    if (bpm < 60 || bpm > 200) return 0;
    // Fold into 120-160 range (psytrance)
    while (bpm < 120) bpm *= 2;
    while (bpm > 170) bpm /= 2;
    return Math.round(bpm);
  }

  private estimateDecay(samples: Float32Array, sr: number): number {
    // FIXED: use RMS window tracking instead of raw sample abs().
    // Previous version returned ~5ms because it triggered on the first zero-crossing
    // of the sine wave (abs crosses 0 every cycle).
    // Find the loudest peak, then track RMS in short windows until it drops to 10%.
    let peakIdx = -1;
    let peakVal = 0;
    const searchEnd = Math.min(samples.length, sr * 10);
    for (let i = Math.floor(sr * 0.1); i < searchEnd - 1; i++) {
      const abs = Math.abs(samples[i]);
      if (abs > peakVal) {
        peakVal = abs;
        peakIdx = i;
      }
    }
    if (peakIdx < 0 || peakVal < 0.05) return 0.1;

    // Track RMS in 5ms windows after the peak
    const windowSize = Math.floor(sr * 0.005);
    const targetRms = peakVal * 0.1;
    for (let w = 0; w + windowSize < samples.length - peakIdx; w += windowSize) {
      let sumSq = 0;
      for (let j = 0; j < windowSize; j++) {
        const s = samples[peakIdx + w + j];
        sumSq += s * s;
      }
      const rms = Math.sqrt(sumSq / windowSize);
      // Skip the first 3ms (attack phase)
      if (w > sr * 0.003 && rms <= targetRms) {
        return Math.max(0.01, (w + windowSize) / sr);
      }
    }
    return 0.2;
  }

  private computeRegularity(transientIndices: number[]): number {
    if (transientIndices.length < 3) return 0;
    const intervals: number[] = [];
    for (let i = 1; i < transientIndices.length; i++) {
      intervals.push(transientIndices[i] - transientIndices[i - 1]);
    }
    const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((a, b) => a + (b - meanInterval) ** 2, 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    const cv = meanInterval > 0 ? stdDev / meanInterval : 1;
    return Math.max(0, Math.min(1, 1 - cv));
  }

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

    // ── Task T1: only include a stat block when every window in the history
    //    actually produced the value. This keeps the profile object clean —
    //    older windows (or V1 listener frames) that don't have the new fields
    //    won't pollute the means with undefined → NaN.
    const optionalStats = (key: keyof ReferenceMetrics) => {
      const vals = windows
        .map(w => (w as unknown as Record<string, unknown>)[key as string])
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      return vals.length > 0 ? stats(vals) : undefined;
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
      // ── Task T1: extended rolling stats (undefined if no windows have them) ──
      spectralCrest: optionalStats('spectralCrest'),
      hnr: optionalStats('hnr'),
      inharmonicity: optionalStats('inharmonicity'),
      spectralSlopeDb: optionalStats('spectralSlopeDb'),
      transientSharpness: optionalStats('transientSharpness'),
      transientDecayMs: optionalStats('transientDecayMs'),
      stereoBalance: optionalStats('stereoBalance'),
      stereoCorrelation: optionalStats('stereoCorrelation'),
      msRatio: optionalStats('msRatio'),
      windowCount: windows.length,
      lastUpdated: Date.now(),
      sourceStream: this.stream?.id || 'unknown',
    };
  }
}
