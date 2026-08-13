/**
 * ReferenceAnalyzer — F23: Analyze a reference WAV file and extract
 * musical + timbral representation that can drive generation.
 *
 * This is the "listening" part of the audio understanding loop.
 *
 * Pipeline:
 * WAV → Float32Array → BPM detection → onset detection → kick/bass isolation →
 * timbre extraction → ReferenceRepresentation
 */

import { extractAudioFeatures, type AudioFeatures } from './AudioFeatureExtractor';

export interface ReferenceRepresentation {
  // RHYTHM
  bpm: number;
  kickOnsets: number[];     // in seconds
  bassOnsets: number[];     // in seconds
  kbPattern: string;        // e.g. "K-B-B-B" per beat
  stepDuration: number;     // seconds per 16th note
  
  // KICK TIMBRE
  kick: {
    pitchStart: number;     // Hz (initial pitch)
    pitchEnd: number;       // Hz (settled pitch)
    attackTime: number;     // ms
    decayTime: number;      // ms (to 10%)
    spectralCentroid: number; // Hz
    transientStrength: number;
    lowEnergy: number;      // 0-1
    crestFactor: number;
  };
  
  // BASS TIMBRE
  bass: {
    fundamental: number;    // Hz
    attackTime: number;     // ms
    decayTime: number;      // ms (to 10%)
    filterStart: number;    // Hz (estimated from spectral centroid at onset)
    filterEnd: number;      // Hz (estimated from spectral centroid at decay)
    spectralCentroid: number; // Hz
    lowEnergy: number;      // 0-1
    midEnergy: number;      // 0-1
    crestFactor: number;
  };
  
  // OVERALL
  peak: number;
  rms: number;
  crestFactor: number;
  spectralCentroid: number; // overall mix centroid
}

export interface CriticResult {
  // Distances (0=identical, 1=completely different)
  bpmDist: number;
  kickDecayDist: number;
  kickCentroidDist: number;
  kickPitchDist: number;
  bassDecayDist: number;
  bassCentroidDist: number;
  bassFundamentalDist: number;
  kbPatternDist: number;
  overallDist: number;
  improvements: string[];
}

/**
 * Load a WAV file and return Float32Array samples.
 */
export function loadWAV(filepath: string): { data: Float32Array; sampleRate: number } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs');
  const wav = fs.readFileSync(filepath);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  
  // Parse WAV header
  const sampleRate = view.getUint32(24, true);
  const numChannels = view.getUint16(22, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataOffset = 44; // standard WAV header
  
  if (bitsPerSample !== 16) throw new Error(`Expected 16-bit WAV, got ${bitsPerSample}`);
  
  const numSamples = (wav.length - dataOffset) / (bitsPerSample / 8) / numChannels;
  const data = new Float32Array(numSamples);
  
  for (let i = 0; i < numSamples; i++) {
    const sample = view.getInt16(dataOffset + i * 2 * numChannels, true);
    data[i] = sample / 32768; // convert to float
  }
  
  return { data, sampleRate };
}

/**
 * Detect BPM using autocorrelation on the low-band energy envelope.
 */
export function detectBPM(data: Float32Array, sampleRate: number): { bpm: number; confidence: number } {
  // Extract low-band envelope (below 120Hz)
  const winSize = Math.floor(sampleRate * 0.05); // 50ms windows
  const envelope: number[] = [];
  for (let i = 0; i < data.length - winSize; i += winSize) {
    let sum = 0;
    for (let j = 0; j < winSize; j++) {
      sum += Math.abs(data[i + j]); // simple amplitude envelope
    }
    envelope.push(sum / winSize);
  }
  
  // Autocorrelation
  const envRate = sampleRate / winSize; // envelope sample rate
  const minLag = Math.floor(envRate * 60 / 200); // 200 BPM max
  const maxLag = Math.floor(envRate * 60 / 60);   // 60 BPM min
  
  let bestLag = minLag;
  let bestCorr = 0;
  const mean = envelope.reduce((a, b) => a + b, 0) / envelope.length;
  
  for (let lag = minLag; lag < maxLag && lag < envelope.length / 2; lag++) {
    let corr = 0;
    for (let i = 0; i < envelope.length - lag; i++) {
      corr += (envelope[i] - mean) * (envelope[i + lag] - mean);
    }
    corr /= (envelope.length - lag);
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  
  const bpm = (envRate / bestLag) * 60;
  const confidence = bestCorr / (mean * mean + 0.0001); // normalized
  
  // Check half/double tempo
  const doubleBpm = bpm * 2;
  const halfBpm = bpm / 2;
  let finalBpm = bpm;
  if (doubleBpm <= 200 && doubleBpm >= 120) finalBpm = doubleBpm; // prefer faster
  if (finalBpm < 100 && halfBpm >= 60) {
    // keep as is, might be half-time
  }
  
  return { bpm: Math.round(finalBpm), confidence };
}

/**
 * Detect onsets using spectral flux on the low band.
 * Returns onset times in seconds.
 */
export function detectOnsets(
  data: Float32Array,
  sampleRate: number,
  band: 'low' | 'mid' | 'high',
  threshold: number = 0.3,
): number[] {
  const fftSize = 1024;
  const hopSize = Math.floor(fftSize / 4); // 75% overlap
  const binHz = sampleRate / fftSize;
  
  // Band limits
  let lowBin = 0, highBin = fftSize / 2;
  if (band === 'low') { lowBin = 0; highBin = Math.floor(120 / binHz); }
  else if (band === 'mid') { lowBin = Math.floor(120 / binHz); highBin = Math.floor(1000 / binHz); }
  else { lowBin = Math.floor(1000 / binHz); highBin = fftSize / 2; }
  
  // Compute band energy per frame
  const energies: number[] = [];
  const times: number[] = [];
  for (let i = 0; i + fftSize < data.length; i += hopSize) {
    let energy = 0;
    for (let k = lowBin; k < highBin && k < fftSize / 2; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < fftSize; n++) {
        const w = 0.5 * (1 - Math.cos(2 * Math.PI * n / (fftSize - 1))); // Hann
        re += data[i + n] * w * Math.cos(2 * Math.PI * k * n / fftSize);
        im -= data[i + n] * w * Math.sin(2 * Math.PI * k * n / fftSize);
      }
      energy += Math.sqrt(re * re + im * im);
    }
    energies.push(energy);
    times.push(i / sampleRate);
  }
  
  // Spectral flux: positive differences
  const flux: number[] = [0];
  for (let i = 1; i < energies.length; i++) {
    flux.push(Math.max(0, energies[i] - energies[i - 1]));
  }
  
  // Normalize
  const maxFlux = Math.max(...flux, 0.0001);
  const normFlux = flux.map(f => f / maxFlux);
  
  // Peak picking with minimum gap
  const onsets: number[] = [];
  const minGapSec = 0.04; // 40ms minimum between onsets
  let lastOnset = -1;
  
  for (let i = 1; i < normFlux.length - 1; i++) {
    if (normFlux[i] > threshold && normFlux[i] >= normFlux[i - 1] && normFlux[i] >= normFlux[i + 1]) {
      const time = times[i];
      if (lastOnset < 0 || time - lastOnset > minGapSec) {
        onsets.push(time);
        lastOnset = time;
      }
    }
  }
  
  return onsets;
}

/**
 * Isolate a window around an onset and extract timbre features.
 */
export function extractWindowTimbre(
  data: Float32Array,
  sampleRate: number,
  onsetTime: number,
  windowMs: number = 100,
): AudioFeatures {
  const start = Math.floor(onsetTime * sampleRate);
  const length = Math.floor(windowMs / 1000 * sampleRate);
  const end = Math.min(start + length, data.length);
  const window = data.slice(start, end);
  return extractAudioFeatures(window, sampleRate, 512);
}

/**
 * Detect the pitch of a signal using autocorrelation.
 */
export function detectPitch(data: Float32Array, sampleRate: number, minHz: number = 30, maxHz: number = 200): number {
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.floor(sampleRate / minHz);
  
  let bestLag = 0;
  let bestCorr = 0;
  
  const N = Math.min(data.length, sampleRate * 0.05); // 50ms window
  const mean = data.slice(0, N).reduce((a, b) => a + b, 0) / N;
  
  for (let lag = minLag; lag < maxLag && lag < N / 2; lag++) {
    let corr = 0;
    for (let i = 0; i < N - lag; i++) {
      corr += (data[i] - mean) * (data[i + lag] - mean);
    }
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  
  return bestLag > 0 ? sampleRate / bestLag : 0;
}

/**
 * Analyze a reference WAV file and extract a complete representation.
 */
export function analyzeReference(filepath: string): ReferenceRepresentation {
  const { data, sampleRate } = loadWAV(filepath);
  
  // 1. BPM detection
  const { bpm } = detectBPM(data, sampleRate);
  const beatDuration = 60 / bpm;
  const stepDuration = beatDuration / 4;
  
  // 2. Onset detection
  const kickOnsets = detectOnsets(data, sampleRate, 'low', 0.3);
  const bassOnsets = detectOnsets(data, sampleRate, 'mid', 0.15);
  
  // 3. K-B pattern (per beat)
  let kbPattern = '';
  if (kickOnsets.length > 0 && bassOnsets.length > 0) {
    const firstBeat = kickOnsets[0];
    const bassInBeat = bassOnsets.filter(b => b >= firstBeat && b < firstBeat + beatDuration);
    const steps = bassInBeat.map(b => Math.round((b - firstBeat) / stepDuration));
    const pattern = ['K'];
    for (let s = 1; s < 4; s++) {
      pattern.push(steps.includes(s) ? 'B' : '-');
    }
    kbPattern = pattern.join('-');
  }
  
  // 4. Kick timbre (isolate first kick)
  let kickTimbre: ReferenceRepresentation['kick'] = {
    pitchStart: 0, pitchEnd: 0, attackTime: 0, decayTime: 0,
    spectralCentroid: 0, transientStrength: 0, lowEnergy: 0, crestFactor: 0,
  };
  if (kickOnsets.length > 0) {
    const kickWindow = data.slice(
      Math.floor(kickOnsets[0] * sampleRate),
      Math.min(Math.floor((kickOnsets[0] + 0.1) * sampleRate), data.length)
    );
    const kickFeatures = extractAudioFeatures(kickWindow, sampleRate, 512);
    const pitchStart = detectPitch(kickWindow.slice(0, Math.floor(sampleRate * 0.005)), sampleRate);
    const pitchEnd = detectPitch(kickWindow.slice(Math.floor(sampleRate * 0.02)), sampleRate);
    kickTimbre = {
      pitchStart: pitchStart || 120,
      pitchEnd: pitchEnd || 48,
      attackTime: kickFeatures.attackTime * 1000,
      decayTime: kickFeatures.decayTime * 1000,
      spectralCentroid: kickFeatures.spectralCentroid,
      transientStrength: kickFeatures.transientStrength,
      lowEnergy: kickFeatures.lowEnergy,
      crestFactor: kickFeatures.crestFactor,
    };
  }
  
  // 5. Bass timbre (isolate first bass between kicks)
  let bassTimbre: ReferenceRepresentation['bass'] = {
    fundamental: 0, attackTime: 0, decayTime: 0, filterStart: 0, filterEnd: 0,
    spectralCentroid: 0, lowEnergy: 0, midEnergy: 0, crestFactor: 0,
  };
  if (bassOnsets.length > 0) {
    const bassWindow = data.slice(
      Math.floor(bassOnsets[0] * sampleRate),
      Math.min(Math.floor((bassOnsets[0] + 0.08) * sampleRate), data.length)
    );
    const bassFeatures = extractAudioFeatures(bassWindow, sampleRate, 512);
    const fundamental = detectPitch(bassWindow, sampleRate);
    // Estimate filter sweep from centroid at start vs end
    const startCentroid = extractAudioFeatures(bassWindow.slice(0, Math.floor(sampleRate * 0.01)), sampleRate, 256).spectralCentroid;
    const endCentroid = extractAudioFeatures(bassWindow.slice(Math.floor(sampleRate * 0.03)), sampleRate, 256).spectralCentroid;
    bassTimbre = {
      fundamental: fundamental || 110,
      attackTime: bassFeatures.attackTime * 1000,
      decayTime: bassFeatures.decayTime * 1000,
      filterStart: startCentroid,
      filterEnd: endCentroid,
      spectralCentroid: bassFeatures.spectralCentroid,
      lowEnergy: bassFeatures.lowEnergy,
      midEnergy: bassFeatures.midEnergy,
      crestFactor: bassFeatures.crestFactor,
    };
  }
  
  // 6. Overall features
  const overall = extractAudioFeatures(data, sampleRate, 2048);
  
  return {
    bpm,
    kickOnsets,
    bassOnsets,
    kbPattern,
    stepDuration,
    kick: kickTimbre,
    bass: bassTimbre,
    peak: overall.peak,
    rms: overall.rms,
    crestFactor: overall.crestFactor,
    spectralCentroid: overall.spectralCentroid,
  };
}

/**
 * Compare two ReferenceRepresentations and return a critic result.
 */
export function compareRepresentations(
  ref: ReferenceRepresentation,
  gen: ReferenceRepresentation,
): CriticResult {
  const normalize = (a: number, b: number, max: number) => Math.min(1, Math.abs(a - b) / max);
  
  const bpmDist = normalize(ref.bpm, gen.bpm, 30);
  const kickDecayDist = normalize(ref.kick.decayTime, gen.kick.decayTime, 100);
  const kickCentroidDist = normalize(ref.kick.spectralCentroid, gen.kick.spectralCentroid, 500);
  const kickPitchDist = normalize(ref.kick.pitchEnd, gen.kick.pitchEnd, 50);
  const bassDecayDist = normalize(ref.bass.decayTime, gen.bass.decayTime, 100);
  const bassCentroidDist = normalize(ref.bass.spectralCentroid, gen.bass.spectralCentroid, 500);
  const bassFundamentalDist = normalize(ref.bass.fundamental, gen.bass.fundamental, 100);
  const kbPatternDist = ref.kbPattern === gen.kbPattern ? 0 : 0.5;
  
  const overallDist = (
    bpmDist * 0.15 +
    kickDecayDist * 0.1 +
    kickCentroidDist * 0.1 +
    kickPitchDist * 0.1 +
    bassDecayDist * 0.15 +
    bassCentroidDist * 0.1 +
    bassFundamentalDist * 0.15 +
    kbPatternDist * 0.15
  );
  
  const improvements: string[] = [];
  if (bpmDist > 0.1) improvements.push(`BPM: ref=${ref.bpm} gen=${gen.bpm}`);
  if (kickDecayDist > 0.2) improvements.push(`Kick decay: ref=${ref.kick.decayTime.toFixed(0)}ms gen=${gen.kick.decayTime.toFixed(0)}ms`);
  if (bassDecayDist > 0.2) improvements.push(`Bass decay: ref=${ref.bass.decayTime.toFixed(0)}ms gen=${gen.bass.decayTime.toFixed(0)}ms`);
  if (bassFundamentalDist > 0.2) improvements.push(`Bass fundamental: ref=${ref.bass.fundamental.toFixed(0)}Hz gen=${gen.bass.fundamental.toFixed(0)}Hz`);
  if (kbPatternDist > 0) improvements.push(`K-B pattern: ref=${ref.kbPattern} gen=${gen.kbPattern}`);
  
  return {
    bpmDist, kickDecayDist, kickCentroidDist, kickPitchDist,
    bassDecayDist, bassCentroidDist, bassFundamentalDist, kbPatternDist,
    overallDist, improvements,
  };
}
