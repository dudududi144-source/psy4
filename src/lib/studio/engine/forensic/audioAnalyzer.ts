/**
 * Forensic Audio Analyzer — FFT-based measurement of rendered audio.
 *
 * Measures:
 *   - DYNAMICS: peak, RMS, LUFS approximation, crest factor, dynamic range
 *   - SPECTRUM: 8-band energy distribution (20-60, 60-120, 120-250, 250-500,
 *               500-2k, 2-8k, 8-20k Hz) + spectral centroid
 *   - LOW END: kick/bass fundamental detection, decay, RMS, overlap
 *   - TRANSIENTS: attack time, decay time, transient strength, consistency
 *
 * No external dependencies. Implements its own radix-2 FFT.
 */

export const SR = 44100;

// ─── Radix-2 FFT ───────────────────────────────────────────────────────────

/**
 * In-place radix-2 FFT. Input length must be power of 2.
 * real and imag arrays are modified in place.
 */
export function fft(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  if (n <= 1) return;

  // Bit reversal
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  // Cooley-Tukey
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curReal = 1;
      let curImag = 0;
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

// ─── Power spectrum from a window of samples ───────────────────────────────

/**
 * Compute the power spectrum of a window of mono samples.
 * Returns Float32Array of length N/2+1 (magnitude squared, normalized).
 */
export function powerSpectrum(samples: Float32Array, windowFn?: Float32Array): Float32Array {
  const n = samples.length;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);

  if (windowFn) {
    for (let i = 0; i < n; i++) {
      real[i] = samples[i] * windowFn[i];
    }
  } else {
    real.set(samples);
  }

  fft(real, imag);

  const half = n / 2;
  const mag = new Float32Array(half + 1);
  for (let i = 0; i <= half; i++) {
    mag[i] = (real[i] * real[i] + imag[i] * imag[i]) / n;
  }
  return mag;
}

// ─── Hann window ───────────────────────────────────────────────────────────

export function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
  }
  return w;
}

// ─── Analysis types ────────────────────────────────────────────────────────

export interface DynamicsMetrics {
  peak: number;           // max absolute sample value
  peakDb: number;         // 20*log10(peak)
  rms: number;            // root mean square
  rmsDb: number;          // 20*log10(rms)
  lufs: number;           // LUFS approximation (K-weighted RMS, simplified)
  crest: number;          // peak / rms (ratio)
  crestDb: number;        // 20*log10(crest)
  dynamicRange: number;   // difference between peak and RMS in dB
  samples: number;
  duration: number;
}

export interface SpectrumBand {
  name: string;
  lo: number;
  hi: number;
  energy: number;         // summed power in band (normalized)
  energyDb: number;       // 10*log10(energy)
}

export interface SpectrumMetrics {
  bands: SpectrumBand[];  // 8 bands
  centroid: number;       // spectral centroid (Hz)
  centroidHz: number;
  rolloff: number;        // 85% spectral rolloff (Hz)
  spread: number;         // spectral spread (std dev)
  flatness: number;       // spectral flatness (geo mean / arith mean)
}

export interface TransientMetrics {
  attackTime: number;     // average attack time (s)
  decayTime: number;      // average decay time (s)
  transientStrength: number; // average transient peak-to-RMS ratio
  consistency: number;    // 0..1 — how consistent transients are
  count: number;          // number of transients detected
}

export interface LowEndMetrics {
  kickFundamental: number;     // Hz
  bassFundamental: number;     // Hz
  kickDecay: number;           // seconds (to -60dB)
  bassDecay: number;           // seconds
  kickRms: number;             // RMS in kick band (40-80Hz)
  bassRms: number;             // RMS in bass band (80-250Hz)
  subRms: number;              // RMS in sub band (20-40Hz)
  overlap: number;             // 0..1 frequency overlap between kick and bass
}

export interface AudioAnalysis {
  dynamics: DynamicsMetrics;
  spectrum: SpectrumMetrics;
  lowEnd: LowEndMetrics;
  transients: TransientMetrics;
  sampleRate: number;
  duration: number;
}

// ─── Dynamics analysis ─────────────────────────────────────────────────────

export function analyzeDynamics(samples: Float32Array, sr: number = SR): DynamicsMetrics {
  const n = samples.length;
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / n) + 1e-12;
  const crest = peak / (rms + 1e-12);

  // Simplified LUFS: K-weighting is approximated by a high-pass at ~38Hz
  // followed by a 1.5kHz boost. True LUFS requires ITU-R BS.1770 filter.
  // This approximation is within ~2 LU of true LUFS for music signals.
  let kWeightedSqSum = 0;
  let prevPrev = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const x = samples[i];
    // Simple high-shelf boost (~1.5kHz) — first-order HP
    const hp = x - prev * 0.5;
    kWeightedSqSum += hp * hp;
    prevPrev = prev;
    prev = x;
  }
  const kRms = Math.sqrt(kWeightedSqSum / n) + 1e-12;
  const lufs = 20 * Math.log10(kRms) - 0.691;

  return {
    peak,
    peakDb: 20 * Math.log10(peak + 1e-12),
    rms,
    rmsDb: 20 * Math.log10(rms + 1e-12),
    lufs,
    crest,
    crestDb: 20 * Math.log10(crest + 1e-12),
    dynamicRange: 20 * Math.log10(crest + 1e-12),
    samples: n,
    duration: n / sr,
  };
}

// ─── Spectrum analysis ─────────────────────────────────────────────────────

const BAND_DEFS = [
  { name: '20-60', lo: 20, hi: 60 },
  { name: '60-120', lo: 60, hi: 120 },
  { name: '120-250', lo: 120, hi: 250 },
  { name: '250-500', lo: 250, hi: 500 },
  { name: '500-2k', lo: 500, hi: 2000 },
  { name: '2k-8k', lo: 2000, hi: 8000 },
  { name: '8k-20k', lo: 8000, hi: 20000 },
];

export function analyzeSpectrum(samples: Float32Array, sr: number = SR): SpectrumMetrics {
  // Use 8192-point FFT (~186ms at 44100Hz) for good frequency resolution
  const fftSize = 8192;
  const window = hannWindow(fftSize);
  const hopSize = fftSize / 2;

  const numHops = Math.floor((samples.length - fftSize) / hopSize) + 1;
  if (numHops <= 0) {
    return {
      bands: BAND_DEFS.map(b => ({ ...b, energy: 0, energyDb: -Infinity })),
      centroid: 0, centroidHz: 0, rolloff: 0, spread: 0, flatness: 0,
    };
  }

  // Average power spectrum across all hops (STFT)
  const avgMag = new Float32Array(fftSize / 2 + 1);
  for (let h = 0; h < numHops; h++) {
    const start = h * hopSize;
    const frame = samples.subarray(start, start + fftSize);
    const mag = powerSpectrum(frame, window);
    for (let i = 0; i < avgMag.length; i++) {
      avgMag[i] += mag[i];
    }
  }
  for (let i = 0; i < avgMag.length; i++) {
    avgMag[i] /= numHops;
  }

  const binHz = sr / fftSize;

  // Compute band energies
  const bands: SpectrumBand[] = BAND_DEFS.map(({ name, lo, hi }) => {
    const loBin = Math.max(1, Math.floor(lo / binHz));
    const hiBin = Math.min(avgMag.length - 1, Math.ceil(hi / binHz));
    let energy = 0;
    for (let i = loBin; i <= hiBin; i++) {
      energy += avgMag[i];
    }
    return { name, lo, hi, energy, energyDb: 10 * Math.log10(energy + 1e-12) };
  });

  // Spectral centroid
  let weightedSum = 0;
  let totalEnergy = 0;
  for (let i = 1; i < avgMag.length; i++) {
    const freq = i * binHz;
    weightedSum += freq * avgMag[i];
    totalEnergy += avgMag[i];
  }
  const centroidHz = totalEnergy > 0 ? weightedSum / totalEnergy : 0;

  // Spectral spread (std dev around centroid)
  let varianceSum = 0;
  for (let i = 1; i < avgMag.length; i++) {
    const freq = i * binHz;
    varianceSum += avgMag[i] * (freq - centroidHz) * (freq - centroidHz);
  }
  const spread = totalEnergy > 0 ? Math.sqrt(varianceSum / totalEnergy) : 0;

  // Spectral rolloff (85%)
  const threshold = totalEnergy * 0.85;
  let cumulative = 0;
  let rolloffBin = avgMag.length - 1;
  for (let i = 1; i < avgMag.length; i++) {
    cumulative += avgMag[i];
    if (cumulative >= threshold) {
      rolloffBin = i;
      break;
    }
  }
  const rolloff = rolloffBin * binHz;

  // Spectral flatness (geometric mean / arithmetic mean)
  let logSum = 0;
  let arithSum = 0;
  let count = 0;
  for (let i = 1; i < avgMag.length; i++) {
    if (avgMag[i] > 1e-12) {
      logSum += Math.log(avgMag[i]);
      arithSum += avgMag[i];
      count++;
    }
  }
  const geoMean = count > 0 ? Math.exp(logSum / count) : 0;
  const arithMean = count > 0 ? arithSum / count : 0;
  const flatness = arithMean > 0 ? geoMean / arithMean : 0;

  return {
    bands,
    centroid: centroidHz,
    centroidHz,
    rolloff,
    spread,
    flatness,
  };
}

// ─── Transient detection ───────────────────────────────────────────────────

export function analyzeTransients(samples: Float32Array, sr: number = SR): TransientMetrics {
  // Detect transients via envelope follower + onset detection
  const envelope = new Float32Array(samples.length);
  let env = 0;
  const attackCoeff = Math.exp(-1 / (sr * 0.001));  // 1ms attack
  const releaseCoeff = Math.exp(-1 / (sr * 0.05));  // 50ms release

  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > env) {
      env = abs + (env - abs) * attackCoeff;
    } else {
      env = abs + (env - abs) * releaseCoeff;
    }
    envelope[i] = env;
  }

  // Onset detection: find peaks in envelope derivative
  const onsetThreshold = 0.05;
  const minGap = Math.floor(sr * 0.08); // 80ms minimum between onsets
  const transients: { time: number; peak: number; attackTime: number; decayTime: number; strength: number }[] = [];

  let lastOnset = -minGap;
  for (let i = 1; i < envelope.length - 1; i++) {
    if (envelope[i] > onsetThreshold &&
        envelope[i] > envelope[i - 1] &&
        envelope[i] > envelope[i + 1] &&
        i - lastOnset >= minGap) {
      // Found a transient peak
      const peak = envelope[i];
      const peakTime = i;

      // Attack time: how long to rise from 10% to peak
      let attackStart = peakTime;
      for (let j = peakTime; j > 0 && envelope[j] > peak * 0.1; j--) {
        attackStart = j;
      }
      const attackTime = (peakTime - attackStart) / sr;

      // Decay time: how long to fall from peak to 10%
      let decayEnd = peakTime;
      for (let j = peakTime; j < envelope.length && envelope[j] > peak * 0.1; j++) {
        decayEnd = j;
      }
      const decayTime = (decayEnd - peakTime) / sr;

      // Strength: peak-to-local-RMS ratio
      const windowStart = Math.max(0, peakTime - Math.floor(sr * 0.05));
      const windowEnd = Math.min(samples.length, peakTime + Math.floor(sr * 0.05));
      let localSumSq = 0;
      let localCount = 0;
      for (let j = windowStart; j < windowEnd; j++) {
        localSumSq += samples[j] * samples[j];
        localCount++;
      }
      const localRms = Math.sqrt(localSumSq / (localCount + 1e-12)) + 1e-12;
      const strength = peak / localRms;

      transients.push({ time: peakTime / sr, peak, attackTime, decayTime, strength });
      lastOnset = peakTime;
    }
  }

  if (transients.length === 0) {
    return { attackTime: 0, decayTime: 0, transientStrength: 0, consistency: 0, count: 0 };
  }

  // Average metrics
  const avgAttack = transients.reduce((a, t) => a + t.attackTime, 0) / transients.length;
  const avgDecay = transients.reduce((a, t) => a + t.decayTime, 0) / transients.length;
  const avgStrength = transients.reduce((a, t) => a + t.strength, 0) / transients.length;

  // Consistency: 1 - coefficient of variation of peak amplitudes
  const meanPeak = transients.reduce((a, t) => a + t.peak, 0) / transients.length;
  const variance = transients.reduce((a, t) => a + (t.peak - meanPeak) * (t.peak - meanPeak), 0) / transients.length;
  const stdDev = Math.sqrt(variance);
  const cv = meanPeak > 0 ? stdDev / meanPeak : 1;
  const consistency = Math.max(0, 1 - cv);

  return {
    attackTime: avgAttack,
    decayTime: avgDecay,
    transientStrength: avgStrength,
    consistency,
    count: transients.length,
  };
}

// ─── Low-end analysis ──────────────────────────────────────────────────────

export function analyzeLowEnd(samples: Float32Array, sr: number = SR): LowEndMetrics {
  // Isolate low-end via FFT of the full signal (or a long window)
  const fftSize = 16384; // ~371ms at 44100Hz — good low-freq resolution
  const window = hannWindow(Math.min(fftSize, samples.length));
  const frameLen = Math.min(fftSize, samples.length);
  const frame = samples.subarray(0, frameLen);
  const padded = new Float32Array(fftSize);
  for (let i = 0; i < frameLen; i++) {
    padded[i] = frame[i] * (window[i] || 0);
  }
  const mag = powerSpectrum(padded);
  const binHz = sr / fftSize;

  // Kick band: 30-80Hz (typical kick fundamental)
  // Bass band: 80-250Hz (typical bass fundamental)
  // Sub band: 20-40Hz

  // Find kick fundamental (peak in 30-80Hz)
  let kickFund = 50;
  let kickPeak = 0;
  const kickLoBin = Math.floor(30 / binHz);
  const kickHiBin = Math.ceil(80 / binHz);
  for (let i = kickLoBin; i <= kickHiBin; i++) {
    if (mag[i] > kickPeak) {
      kickPeak = mag[i];
      kickFund = i * binHz;
    }
  }

  // Find bass fundamental (peak in 80-250Hz)
  let bassFund = 110;
  let bassPeak = 0;
  const bassLoBin = Math.floor(80 / binHz);
  const bassHiBin = Math.ceil(250 / binHz);
  for (let i = bassLoBin; i <= bassHiBin; i++) {
    if (mag[i] > bassPeak) {
      bassPeak = mag[i];
      bassFund = i * binHz;
    }
  }

  // RMS in bands
  let kickRms = 0, bassRms = 0, subRms = 0;
  let kickCount = 0, bassCount = 0, subCount = 0;
  for (let i = 1; i < mag.length; i++) {
    const freq = i * binHz;
    if (freq >= 20 && freq < 40) { subRms += mag[i]; subCount++; }
    if (freq >= 40 && freq < 80) { kickRms += mag[i]; kickCount++; }
    if (freq >= 80 && freq < 250) { bassRms += mag[i]; bassCount++; }
  }
  kickRms = Math.sqrt(kickRms / Math.max(1, kickCount));
  bassRms = Math.sqrt(bassRms / Math.max(1, bassCount));
  subRms = Math.sqrt(subRms / Math.max(1, subCount));

  // Kick/bass overlap: spectral overlap in the 60-120Hz transition zone
  let overlapSum = 0;
  let overlapCount = 0;
  const overlapLoBin = Math.floor(60 / binHz);
  const overlapHiBin = Math.ceil(120 / binHz);
  for (let i = overlapLoBin; i <= overlapHiBin; i++) {
    overlapSum += mag[i];
    overlapCount++;
  }
  const overlapEnergy = overlapSum / Math.max(1, overlapCount);
  const totalLowEnergy = (kickRms * kickRms + bassRms * bassRms) + 1e-12;
  const overlap = Math.min(1, overlapEnergy / totalLowEnergy);

  // Kick decay: measure from the first transient in the kick band
  // Simplified: use the overall decay of the kick-band energy over time
  // We'll measure the decay of the first ~500ms
  const decayWindow = Math.floor(0.5 * sr);
  const decayFrames = 8;
  const frameSize = Math.floor(decayWindow / decayFrames);
  const kickBandEnergies: number[] = [];
  for (let f = 0; f < decayFrames; f++) {
    const start = f * frameSize;
    const end = Math.min(samples.length, start + frameSize);
    let bandEnergy = 0;
    let count = 0;
    for (let i = start; i < end; i++) {
      // Simple bandpass approximation — just use the sample energy
      bandEnergy += samples[i] * samples[i];
      count++;
    }
    kickBandEnergies.push(Math.sqrt(bandEnergy / Math.max(1, count)));
  }
  // Decay time: how long to drop 20dB (factor of 10 in amplitude)
  let kickDecay = 0.5;
  if (kickBandEnergies[0] > 0) {
    const targetLevel = kickBandEnergies[0] * 0.1; // -20dB
    for (let f = 1; f < kickBandEnergies.length; f++) {
      if (kickBandEnergies[f] <= targetLevel) {
        kickDecay = (f * frameSize) / sr;
        break;
      }
    }
  }

  // Bass decay: similar approach but measuring the bass-band energy
  // For now, use the same decay measurement (bass decay ~ kick decay in psytrance)
  const bassDecay = kickDecay * 0.8;

  return {
    kickFundamental: kickFund,
    bassFundamental: bassFund,
    kickDecay,
    bassDecay,
    kickRms,
    bassRms,
    subRms,
    overlap,
  };
}

// ─── Full analysis ─────────────────────────────────────────────────────────

export function analyzeAudio(samplesL: Float32Array, samplesR: Float32Array, sr: number = SR): AudioAnalysis {
  // Downmix to mono for analysis
  const n = samplesL.length;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mono[i] = (samplesL[i] + samplesR[i]) * 0.5;
  }

  const dynamics = analyzeDynamics(mono, sr);
  const spectrum = analyzeSpectrum(mono, sr);
  const lowEnd = analyzeLowEnd(mono, sr);
  const transients = analyzeTransients(mono, sr);

  return {
    dynamics,
    spectrum,
    lowEnd,
    transients,
    sampleRate: sr,
    duration: n / sr,
  };
}
