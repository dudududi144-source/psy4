/**
 * Reference Analyzer — measures audio output against commercial targets.
 *
 * This is the "measurement" side of the generate→analyze→compare→fix loop.
 * It takes audio data (Float32Array) and computes objective metrics, then
 * scores them against the commercial target ranges.
 *
 * PSY3 is NOT the reference. Commercial psytrance production standards are.
 */

import { scoreAgainstTarget, getGenreTargets, type GenreTargets, type TargetRange, type AnalysisResult } from './commercialReference';

export interface AudioAnalysis {
  // Level metrics
  peak: number;
  rms: number;
  lufs: number;           // approximate LUFS
  truePeak: number;       // approximate
  crestFactor: number;

  // Spectral balance (% of total energy)
  spectral: {
    sub: number;          // 20-60Hz
    low: number;          // 60-200Hz
    lowMid: number;       // 200-800Hz
    mid: number;          // 800-3000Hz
    highMid: number;      // 3000-6000Hz
    high: number;         // 6000-12000Hz
    air: number;          // 12000-20000Hz
  };

  // Spectral features
  centroid: number;       // spectral centroid Hz
  rolloff: number;        // spectral rolloff Hz (85%)
  flatness: number;       // spectral flatness (0-1)

  // Transient
  transientRatio: number; // attack energy / body energy

  // Stereo (if stereo data)
  stereoWidth?: number;
  correlation?: number;

  // Duration
  duration: number;
}

export interface BenchmarkReport {
  genre: string;
  analysis: AudioAnalysis;
  results: AnalysisResult[];
  overallScore: number;   // 0..100
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
}

const SR = 44100;

/**
 * Analyze a mono Float32Array of audio data.
 */
export function analyzeAudio(data: Float32Array, sr: number = SR): AudioAnalysis {
  const n = data.length;
  const duration = n / sr;

  // Level metrics
  let peak = 0, sumSq = 0;
  for (let i = 0; i < n; i++) {
    const abs = Math.abs(data[i]);
    if (abs > peak) peak = abs;
    sumSq += data[i] * data[i];
  }
  const rms = Math.sqrt(sumSq / n) + 1e-9;
  const crestFactor = peak / rms;

  // LUFS approximation (simple RMS-based, not true K-weighted)
  // True LUFS requires K-weighting filter + gating. This is an approximation.
  const lufs = 20 * Math.log10(rms) - 0.691;

  // True peak approximation (just sample peak, not oversampled)
  const truePeak = 20 * Math.log10(peak);

  // FFT analysis
  const fftSize = Math.min(8192, n);
  const windowed = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / fftSize); // Hann
    windowed[i] = data[i] * w;
  }

  // Compute magnitude spectrum (DFT)
  const halfSize = fftSize / 2;
  const spectrum = new Float32Array(halfSize);
  const freqs = new Float32Array(halfSize);
  for (let k = 0; k < halfSize; k++) {
    freqs[k] = k * sr / fftSize;
    let re = 0, im = 0;
    for (let i = 0; i < fftSize; i++) {
      const angle = -2 * Math.PI * k * i / fftSize;
      re += windowed[i] * Math.cos(angle);
      im += windowed[i] * Math.sin(angle);
    }
    spectrum[k] = Math.sqrt(re * re + im * im);
  }

  // Band energy
  const bandEnergy = (lo: number, hi: number): number => {
    let sum = 0;
    for (let k = 0; k < halfSize; k++) {
      if (freqs[k] >= lo && freqs[k] < hi) sum += spectrum[k] * spectrum[k];
    }
    return sum;
  };

  const sub = bandEnergy(20, 60);
  const low = bandEnergy(60, 200);
  const lowMid = bandEnergy(200, 800);
  const mid = bandEnergy(800, 3000);
  const highMid = bandEnergy(3000, 6000);
  const high = bandEnergy(6000, 12000);
  const air = bandEnergy(12000, 20000);
  const total = sub + low + lowMid + mid + highMid + high + air + 1e-9;

  // Spectral centroid
  let weightedSum = 0, magSum = 0;
  for (let k = 0; k < halfSize; k++) {
    weightedSum += freqs[k] * spectrum[k];
    magSum += spectrum[k];
  }
  const centroid = magSum > 0 ? weightedSum / magSum : 0;

  // Spectral rolloff (85%)
  const totalMag = magSum;
  let rolloffSum = 0, rolloff = 0;
  for (let k = 0; k < halfSize; k++) {
    rolloffSum += spectrum[k];
    if (rolloffSum >= 0.85 * totalMag) { rolloff = freqs[k]; break; }
  }

  // Spectral flatness (geometric mean / arithmetic mean)
  let logSum = 0, arithSum = 0, count = 0;
  for (let k = 1; k < halfSize; k++) {
    if (spectrum[k] > 1e-10) {
      logSum += Math.log(spectrum[k]);
      arithSum += spectrum[k];
      count++;
    }
  }
  const flatness = count > 0 ? Math.exp(logSum / count) / (arithSum / count) : 0;

  // Transient ratio (first 5ms vs next 20ms)
  const attackSamples = Math.floor(0.005 * sr);
  const bodySamples = Math.floor(0.020 * sr);
  if (n > attackSamples + bodySamples) {
    let attackE = 0, bodyE = 0;
    for (let i = 0; i < attackSamples; i++) attackE += Math.abs(data[i]);
    for (let i = attackSamples; i < attackSamples + bodySamples; i++) bodyE += Math.abs(data[i]);
    const transientRatio = (attackE / attackSamples) / (bodyE / bodySamples + 1e-9);
    return {
      peak, rms, lufs, truePeak, crestFactor,
      spectral: {
        sub: sub / total * 100, low: low / total * 100,
        lowMid: lowMid / total * 100, mid: mid / total * 100,
        highMid: highMid / total * 100, high: high / total * 100,
        air: air / total * 100,
      },
      centroid, rolloff, flatness, transientRatio, duration,
    };
  }

  return {
    peak, rms, lufs, truePeak, crestFactor,
    spectral: {
      sub: sub / total * 100, low: low / total * 100,
      lowMid: lowMid / total * 100, mid: mid / total * 100,
      highMid: highMid / total * 100, high: high / total * 100,
      air: air / total * 100,
    },
    centroid, rolloff, flatness, transientRatio: 0, duration,
  };
}

/**
 * Benchmark an audio analysis against commercial targets for a genre.
 */
export function benchmarkAgainstCommercial(analysis: AudioAnalysis, genreId: string): BenchmarkReport {
  const targets = getGenreTargets(genreId);
  const results: AnalysisResult[] = [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const recommendations: string[] = [];

  // Helper to add a scored result
  const addResult = (metric: string, value: number, unit: string, target: TargetRange) => {
    const { score, status } = scoreAgainstTarget(value, target);
    results.push({ metric, value, unit, target, score, status });
    if (status === 'great' || status === 'good') {
      strengths.push(`${metric}: ${value.toFixed(1)}${unit} (target: ${target.ideal}${unit})`);
    } else {
      weaknesses.push(`${metric}: ${value.toFixed(1)}${unit} (target: ${target.ideal}${unit}, range: ${target.min}-${target.max}${unit})`);
      if (value < target.min) {
        recommendations.push(`Increase ${metric} (currently ${value.toFixed(1)}${unit}, need ${target.min}-${target.max}${unit})`);
      } else {
        recommendations.push(`Decrease ${metric} (currently ${value.toFixed(1)}${unit}, need ${target.min}-${target.max}${unit})`);
      }
    }
  };

  // Loudness
  addResult('LUFS', analysis.lufs, 'LUFS', targets.lufs);
  addResult('True Peak', analysis.truePeak, 'dBTP', targets.truePeak);
  addResult('Crest Factor', analysis.crestFactor, 'dB', targets.crestFactor);

  // Spectral balance
  addResult('Sub Energy', analysis.spectral.sub, '%', targets.spectral.sub);
  addResult('Low Energy', analysis.spectral.low, '%', targets.spectral.low);
  addResult('Low-Mid Energy', analysis.spectral.lowMid, '%', targets.spectral.lowMid);
  addResult('Mid Energy', analysis.spectral.mid, '%', targets.spectral.mid);
  addResult('High-Mid Energy', analysis.spectral.highMid, '%', targets.spectral.highMid);
  addResult('High Energy', analysis.spectral.high, '%', targets.spectral.high);
  addResult('Air Energy', analysis.spectral.air, '%', targets.spectral.air);

  // Overall score
  const overallScore = Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length * 100);

  return {
    genre: genreId,
    analysis,
    results,
    overallScore,
    strengths,
    weaknesses,
    recommendations,
  };
}

/**
 * Analyze a single voice sample (kick, bass, etc.) against voice-specific targets.
 */
export function benchmarkVoice(
  data: Float32Array,
  voiceType: 'kick' | 'bass' | 'lead',
  genreId: string,
  sr: number = SR
): { analysis: AudioAnalysis; score: number; issues: string[] } {
  const analysis = analyzeAudio(data, sr);
  const targets = getGenreTargets(genreId);
  const issues: string[] = [];
  let totalScore = 0;
  let count = 0;

  if (voiceType === 'kick') {
    // Kick-specific checks
    const { score, status } = scoreAgainstTarget(analysis.spectral.sub, targets.kick.subEnergy);
    totalScore += score; count++;
    if (status === 'warning' || status === 'bad') {
      issues.push(`Kick sub energy ${analysis.spectral.sub.toFixed(1)}% (target: ${targets.kick.subEnergy.ideal}%) — ${analysis.spectral.sub < targets.kick.subEnergy.min ? 'TOO LOW' : 'too high'}`);
    }

    // Fundamental check
    const fundScore = scoreAgainstTarget(analysis.centroid < 500 ? analysis.centroid : 100, targets.kick.fundamental);
    totalScore += fundScore.score; count++;
  } else if (voiceType === 'bass') {
    const { score, status } = scoreAgainstTarget(analysis.spectral.sub, targets.bass.subEnergy);
    totalScore += score; count++;
    if (status === 'warning' || status === 'bad') {
      issues.push(`Bass sub energy ${analysis.spectral.sub.toFixed(1)}% (target: ${targets.bass.subEnergy.ideal}%)`);
    }
  } else if (voiceType === 'lead') {
    const { score, status } = scoreAgainstTarget(analysis.spectral.highMid, targets.lead.harshnessLimit);
    totalScore += score; count++;
    if (status === 'warning' || status === 'bad') {
      issues.push(`Lead high-mid energy ${analysis.spectral.highMid.toFixed(1)}% — ${analysis.spectral.highMid > targets.lead.harshnessLimit.max ? 'HARSH' : 'too low'}`);
    }
  }

  return {
    analysis,
    score: count > 0 ? Math.round(totalScore / count * 100) : 0,
    issues,
  };
}
