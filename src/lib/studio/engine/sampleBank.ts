/**
 * SampleBank — loads PSY3 WAV samples and transfers them to the AudioWorklet.
 *
 * The worklet cannot use `fetch` or `decodeAudioData` directly, so the main
 * thread loads samples as AudioBuffers, extracts the Float32Array PCM data,
 * and transfers it to the worklet via port.postMessage with Transferable.
 *
 * The worklet stores these as raw Float32Arrays and plays them via SampleVoice
 * (linear interpolation playback with pitch/gain variation).
 *
 * This is why PSY4 currently sounds "toy-like" — the worklet was using pure
 * synth DSP for kick/hat/clap. Now it uses the REAL PSY3 samples.
 */

export interface SampleInfo {
  name: string;
  category: 'kick' | 'bass' | 'lead' | 'hat' | 'clap' | 'perc' | 'fx';
  subcategory: string;
  data: Float32Array;     // mono PCM data
  sampleRate: number;
  duration: number;
  peak: number;
  rms: number;
  centroid: number;       // spectral centroid Hz
  lowEnergy: number;      // 0..1 fraction
  midEnergy: number;
  highEnergy: number;
  fundamental?: number;   // estimated fundamental Hz
}

const SAMPLE_CATALOG: { file: string; category: SampleInfo['category']; subcategory: string }[] = [
  { file: 'kick.wav',       category: 'kick', subcategory: 'main' },
  { file: 'bass_A.wav',     category: 'bass', subcategory: 'main' },
  { file: 'lead.wav',       category: 'lead', subcategory: 'main' },
  { file: 'hat_closed.wav', category: 'hat',  subcategory: 'closed' },
  { file: 'hat_open.wav',   category: 'hat',  subcategory: 'open' },
  { file: 'clap.wav',       category: 'clap', subcategory: 'main' },
];

export class SampleBank {
  private ctx: AudioContext;
  private samples: Map<string, SampleInfo> = new Map();
  loaded = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  /**
   * Load all samples from /samples/ directory.
   * Decodes WAV → extracts mono Float32Array → computes acoustic features.
   */
  async loadAll(): Promise<boolean> {
    const results = await Promise.all(
      SAMPLE_CATALOG.map(async (entry) => {
        try {
          const response = await fetch(`/samples/${entry.file}`);
          if (!response.ok) return null;
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
          return this.processSample(entry.file, entry.category, entry.subcategory, audioBuffer);
        } catch (e) {
          console.warn(`[SampleBank] Failed to load ${entry.file}:`, e);
          return null;
        }
      })
    );

    for (const info of results) {
      if (info) this.samples.set(info.name, info);
    }

    this.loaded = this.samples.size > 0;
    console.log(`[SampleBank] Loaded ${this.samples.size}/${SAMPLE_CATALOG.length} samples`);
    return this.loaded;
  }

  /**
   * Process a decoded AudioBuffer into SampleInfo with acoustic features.
   */
  private processSample(
    name: string,
    category: SampleInfo['category'],
    subcategory: string,
    audioBuffer: AudioBuffer
  ): SampleInfo {
    // Convert to mono
    const numCh = audioBuffer.numberOfChannels;
    const len = audioBuffer.length;
    const mono = new Float32Array(len);
    for (let ch = 0; ch < numCh; ch++) {
      const data = audioBuffer.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        mono[i] += data[i] / numCh;
      }
    }

    // Compute acoustic features
    const sr = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;
    let peak = 0, sumSq = 0;
    for (let i = 0; i < len; i++) {
      const abs = Math.abs(mono[i]);
      if (abs > peak) peak = abs;
      sumSq += mono[i] * mono[i];
    }
    const rms = Math.sqrt(sumSq / len);

    // Spectral analysis via FFT (simple DFT for first 4096 samples)
    const fftSize = Math.min(4096, len);
    const windowed = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / fftSize); // Hann window
      windowed[i] = mono[i] * w;
    }
    // Simple magnitude spectrum (radix-2 DFT — O(N²) but fine for 4096 at load time)
    const spectrum = this.computeMagnitudeSpectrum(windowed);
    const freqs = new Float32Array(spectrum.length);
    for (let i = 0; i < spectrum.length; i++) {
      freqs[i] = i * sr / fftSize;
    }

    // Spectral centroid
    let weightedSum = 0, magSum = 0;
    for (let i = 0; i < spectrum.length; i++) {
      weightedSum += freqs[i] * spectrum[i];
      magSum += spectrum[i];
    }
    const centroid = magSum > 0 ? weightedSum / magSum : 0;

    // Energy bands
    let lowE = 0, midE = 0, highE = 0;
    for (let i = 0; i < spectrum.length; i++) {
      const f = freqs[i];
      const e = spectrum[i] * spectrum[i];
      if (f < 200) lowE += e;
      else if (f < 2000) midE += e;
      else highE += e;
    }
    const totalE = lowE + midE + highE + 1e-9;

    // Fundamental estimate (find the peak in low frequency range)
    let fundamental = 0;
    let maxMag = 0;
    for (let i = 2; i < spectrum.length / 4; i++) { // search up to ~5kHz
      if (freqs[i] > 30 && freqs[i] < 500 && spectrum[i] > maxMag) {
        maxMag = spectrum[i];
        fundamental = freqs[i];
      }
    }

    return {
      name,
      category,
      subcategory,
      data: mono,
      sampleRate: sr,
      duration,
      peak,
      rms,
      centroid,
      lowEnergy: lowE / totalE,
      midEnergy: midE / totalE,
      highEnergy: highE / totalE,
      fundamental: fundamental > 0 ? fundamental : undefined,
    };
  }

  /**
   * Simple magnitude spectrum via DFT (O(N²)).
   * Only used at load time for feature extraction.
   */
  private computeMagnitudeSpectrum(input: Float32Array): Float32Array {
    const n = input.length;
    const half = n / 2;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    // Copy input
    for (let i = 0; i < n; i++) real[i] = input[i];
    // DFT — split into cos/sin tables for speed
    const cosTable = new Float32Array(n);
    const sinTable = new Float32Array(n);
    for (let k = 0; k < half; k++) {
      const angle = -2 * Math.PI * k / n;
      cosTable[k] = Math.cos(angle);
      sinTable[k] = Math.sin(angle);
    }
    const mag = new Float32Array(half);
    for (let k = 0; k < half; k++) {
      let re = 0, im = 0;
      for (let i = 0; i < n; i++) {
        const idx = (i * k) % n;
        re += real[i] * cosTable[idx];
        im += real[i] * sinTable[idx];
      }
      mag[k] = Math.sqrt(re * re + im * im);
    }
    return mag;
  }

  /** Get a sample by name. */
  get(name: string): SampleInfo | null {
    return this.samples.get(name) || null;
  }

  /** Get all samples in a category. */
  getByCategory(category: SampleInfo['category']): SampleInfo[] {
    const result: SampleInfo[] = [];
    for (const info of this.samples.values()) {
      if (info.category === category) result.push(info);
    }
    return result;
  }

  /**
   * Export all samples as a transferable payload for the worklet.
   * Returns an array of { name, category, sampleRate, data } where data is Float32Array.
   */
  toWorkletPayload(): { name: string; category: string; subcategory: string; sampleRate: number; data: Float32Array }[] {
    const payload: { name: string; category: string; subcategory: string; sampleRate: number; data: Float32Array }[] = [];
    for (const info of this.samples.values()) {
      payload.push({
        name: info.name,
        category: info.category,
        subcategory: info.subcategory,
        sampleRate: info.sampleRate,
        data: info.data,
      });
    }
    return payload;
  }

  /** List all loaded sample names. */
  listLoaded(): string[] {
    return Array.from(this.samples.keys());
  }
}
