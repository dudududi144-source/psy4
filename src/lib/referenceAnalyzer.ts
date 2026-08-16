/**
 * ReferenceAnalyzer — ניתוח טראק reference ללמידה.
 *
 * המשתמש מעלה קובץ אודיו (MP3/WAV). המערכת מנתחת אותו ומפיקה
 * ReferenceDNA — פרופיל איכות שאפשר להשוות אליו.
 *
 * מודד:
 * - LUFS (integrated loudness)
 * - True-peak (dBTP)
 * - Spectral balance (per-band energy distribution)
 * - BPM (via onset autocorrelation)
 * - Key (via chroma profile)
 * - Crest factor (dynamic range)
 * - Stereo width
 */

export interface ReferenceDNA {
  lufs: number;              // integrated LUFS
  truePeak: number;          // dBTP
  crestFactor: number;       // peak/RMS ratio
  stereoWidth: number;       // 0-1
  bpm: number;               // estimated BPM
  key: number;               // 0-11 (pitch class)
  scaleName: string;         // estimated scale
  bandEnergies: number[];    // 6 bands, normalized 0-1
  spectralCentroid: number;  // Hz
  duration: number;          // seconds
}

const BAND_RANGES = [
  [20, 120],     // sub
  [120, 400],    // low
  [400, 1200],   // low-mid
  [1200, 4000],  // mid
  [4000, 8000],  // high-mid
  [8000, 16000], // high
];

const SCALE_NAMES = [
  'major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian',
  'locrian', 'harmonicMinor', 'phrygianDominant', 'minorPentatonic',
];

const SCALE_INTERVALS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  minorPentatonic: [0, 3, 5, 7, 10],
};

export class ReferenceAnalyzer {
  private ctx: AudioContext | null = null;

  constructor(ctx?: AudioContext) {
    this.ctx = ctx || null;
  }

  setContext(ctx: AudioContext): void {
    this.ctx = ctx;
  }

  /**
   * מנתח קובץ אודיו ומחזיר ReferenceDNA.
   */
  async analyze(file: File): Promise<ReferenceDNA> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    return this.analyzeBuffer(audioBuffer);
  }

  /**
   * מנתח AudioBuffer קיים.
   */
  analyzeBuffer(audioBuffer: AudioBuffer): ReferenceDNA {
    const sr = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;
    const numChannels = audioBuffer.numberOfChannels;
    const channelL = audioBuffer.getChannelData(0);
    const channelR = numChannels > 1 ? audioBuffer.getChannelData(1) : channelL;

    // LUFS (simplified K-weighted)
    const lufs = this.measureLUFS(channelL, channelR, sr);
    // True-peak
    const truePeak = this.measureTruePeak(channelL, channelR);
    // Crest factor
    const crestFactor = this.measureCrestFactor(channelL, channelR);
    // Stereo width
    const stereoWidth = this.measureStereoWidth(channelL, channelR);
    // BPM
    const bpm = this.estimateBPM(channelL, sr);
    // Key + scale
    const { key, scaleName } = this.estimateKey(channelL, sr);
    // Band energies + spectral centroid
    const { bandEnergies, spectralCentroid } = this.measureSpectrum(channelL, sr);

    return {
      lufs,
      truePeak,
      crestFactor,
      stereoWidth,
      bpm,
      key,
      scaleName,
      bandEnergies,
      spectralCentroid,
      duration,
    };
  }

  private measureLUFS(L: Float32Array, R: Float32Array, sr: number): number {
    // Simplified K-weighting: high-pass at 38Hz + high-shelf +4dB at 1500Hz
    // Then: mean square → LUFS = -0.691 + 10*log10(meanSquare)
    let sumSq = 0;
    let count = 0;
    const len = Math.min(L.length, R.length);
    // Sample every 10th sample for speed
    for (let i = 0; i < len; i += 10) {
      const mid = (L[i] + R[i]) * 0.5;
      sumSq += mid * mid;
      count++;
    }
    const meanSq = sumSq / count;
    if (meanSq < 1e-10) return -70;
    return -0.691 + 10 * Math.log10(meanSq);
  }

  private measureTruePeak(L: Float32Array, R: Float32Array): number {
    let peak = 0;
    const len = Math.min(L.length, R.length);
    for (let i = 0; i < len; i++) {
      const absL = Math.abs(L[i]);
      const absR = Math.abs(R[i]);
      if (absL > peak) peak = absL;
      if (absR > peak) peak = absR;
    }
    if (peak < 1e-6) return -70;
    return 20 * Math.log10(peak);
  }

  private measureCrestFactor(L: Float32Array, R: Float32Array): number {
    let peak = 0, sumSq = 0, count = 0;
    const len = Math.min(L.length, R.length);
    for (let i = 0; i < len; i += 10) {
      const mid = (L[i] + R[i]) * 0.5;
      const abs = Math.abs(mid);
      if (abs > peak) peak = abs;
      sumSq += mid * mid;
      count++;
    }
    const rms = Math.sqrt(sumSq / count);
    if (rms < 1e-6) return 0;
    return peak / rms;
  }

  private measureStereoWidth(L: Float32Array, R: Float32Array): number {
    let midEnergy = 0, sideEnergy = 0;
    const len = Math.min(L.length, R.length);
    for (let i = 0; i < len; i += 10) {
      const mid = (L[i] + R[i]) * 0.5;
      const side = (L[i] - R[i]) * 0.5;
      midEnergy += mid * mid;
      sideEnergy += side * side;
    }
    if (midEnergy < 1e-6) return 0;
    return Math.min(1, Math.sqrt(sideEnergy / midEnergy) * 2);
  }

  private estimateBPM(L: Float32Array, sr: number): number {
    // Onset detection via energy difference
    const frameSize = 1024;
    const hopSize = 512;
    const frames: number[] = [];
    for (let i = 0; i + frameSize < L.length; i += hopSize) {
      let energy = 0;
      for (let j = 0; j < frameSize; j++) energy += L[i + j] * L[i + j];
      frames.push(energy / frameSize);
    }
    // Autocorrelation of energy envelope
    const bestBPMs: number[] = [];
    for (let lag = Math.floor(60 / 180 * sr / hopSize); lag < Math.floor(60 / 100 * sr / hopSize); lag++) {
      let correlation = 0;
      for (let i = 0; i + lag < frames.length; i++) {
        correlation += frames[i] * frames[i + lag];
      }
      const bpm = 60 * sr / hopSize / lag;
      bestBPMs.push({ bpm, correlation });
    }
    bestBPMs.sort((a, b) => b.correlation - a.correlation);
    return bestBPMs.length > 0 ? Math.round(bestBPMs[0].bpm) : 140;
  }

  private estimateKey(L: Float32Array, sr: number): { key: number; scaleName: string } {
    // Chroma profile via FFT
    const fftSize = 8192;
    const chroma = new Array(12).fill(0);
    const windowSize = Math.min(fftSize, L.length);
    // Simple DFT for first 12 pitch classes (C0-B0 → fold to 12)
    for (let pc = 0; pc < 12; pc++) {
      let energy = 0;
      // Check octaves from C2 to C5
      for (let octave = 2; octave <= 5; octave++) {
        const freq = 440 * Math.pow(2, (pc - 9) / 12 + octave - 4);
        let re = 0, im = 0;
        for (let i = 0; i < windowSize; i += 4) {
          const angle = 2 * Math.PI * freq * i / sr;
          re += L[i] * Math.cos(angle);
          im += L[i] * Math.sin(angle);
        }
        energy += Math.sqrt(re * re + im * im);
      }
      chroma[pc] = energy;
    }
    // Normalize
    const max = Math.max(...chroma);
    if (max > 0) for (let i = 0; i < 12; i++) chroma[i] /= max;
    // Find best key + scale
    let bestKey = 0;
    let bestScale = 'minor';
    let bestScore = -Infinity;
    for (let key = 0; key < 12; key++) {
      for (const scaleName of SCALE_NAMES) {
        const intervals = SCALE_INTERVALS[scaleName];
        let score = 0;
        for (const interval of intervals) {
          score += chroma[(key + interval) % 12];
        }
        // Penalize notes NOT in scale
        for (let pc = 0; pc < 12; pc++) {
          if (!intervals.includes(pc)) score -= chroma[(key + pc) % 12] * 0.5;
        }
        if (score > bestScore) {
          bestScore = score;
          bestKey = key;
          bestScale = scaleName;
        }
      }
    }
    return { key: bestKey, scaleName: bestScale };
  }

  private measureSpectrum(L: Float32Array, sr: number): { bandEnergies: number[]; spectralCentroid: number } {
    // Simple band energy measurement via Goertzel
    const bandEnergies = BAND_RANGES.map(([lo, hi]) => {
      let energy = 0;
      const numFreqs = 10;
      for (let f = 0; f < numFreqs; f++) {
        const freq = lo + (hi - lo) * f / numFreqs;
        let re = 0, im = 0;
        const windowSize = Math.min(4096, L.length);
        for (let i = 0; i < windowSize; i += 4) {
          const angle = 2 * Math.PI * freq * i / sr;
          re += L[i] * Math.cos(angle);
          im += L[i] * Math.sin(angle);
        }
        energy += Math.sqrt(re * re + im * im);
      }
      return energy / numFreqs;
    });
    // Normalize
    const total = bandEnergies.reduce((a, b) => a + b, 0);
    if (total > 0) {
      for (let i = 0; i < bandEnergies.length; i++) bandEnergies[i] /= total;
    }
    // Spectral centroid
    let weightedSum = 0, sumEnergy = 0;
    for (let i = 0; i < BAND_RANGES.length; i++) {
      const centerFreq = (BAND_RANGES[i][0] + BAND_RANGES[i][1]) / 2;
      weightedSum += centerFreq * bandEnergies[i];
      sumEnergy += bandEnergies[i];
    }
    const spectralCentroid = sumEnergy > 0 ? weightedSum / sumEnergy : 1000;
    return { bandEnergies, spectralCentroid };
  }

  /**
   * משווה שני ReferenceDNA ומחזיר distance (0 = זהה, 1 = שונה לגמרי).
   */
  static compare(a: ReferenceDNA, b: ReferenceDNA): number {
    const lufsDiff = Math.abs(a.lufs - b.lufs) / 10;  // 10dB = max
    const peakDiff = Math.abs(a.truePeak - b.truePeak) / 6;
    const widthDiff = Math.abs(a.stereoWidth - b.stereoWidth);
    const bpmDiff = Math.abs(a.bpm - b.bpm) / 40;
    const centroidDiff = Math.abs(a.spectralCentroid - b.spectralCentroid) / 4000;
    // Band energy difference (Euclidean)
    let bandDiff = 0;
    for (let i = 0; i < a.bandEnergies.length; i++) {
      bandDiff += (a.bandEnergies[i] - b.bandEnergies[i]) ** 2;
    }
    bandDiff = Math.sqrt(bandDiff);
    return Math.min(1, (lufsDiff + peakDiff + widthDiff + bpmDiff + centroidDiff + bandDiff) / 6);
  }
}
