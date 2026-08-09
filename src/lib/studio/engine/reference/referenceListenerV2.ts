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
