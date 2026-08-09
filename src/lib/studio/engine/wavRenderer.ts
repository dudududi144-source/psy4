/**
 * Offline WAV Renderer — renders PSY4 audio to WAV files for analysis.
 *
 * Uses OfflineAudioContext to render the AudioWorklet engine offline,
 * then exports the result as a WAV file that can be analyzed.
 *
 * This enables the GENERATE → RENDER → ANALYZE → COMPARE loop.
 */

const SR = 44100;

/**
 * Convert Float32Array samples to a WAV Blob.
 */
function floatToWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export interface RenderResult {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
  wavBlob: Blob;
  metrics: {
    peak: number;
    rms: number;
    crestFactor: number;
    lufs: number;
    spectralCentroid: number;
    subEnergy: number;  // 20-60Hz %
    lowEnergy: number;  // 60-200Hz %
    midEnergy: number;  // 200-3000Hz %
    highEnergy: number; // 3000+Hz %
  };
}

/**
 * Analyze rendered audio — objective DSP measurements.
 */
export function analyzeRenderedAudio(samples: Float32Array, sr: number = SR): RenderResult['metrics'] {
  const n = samples.length;
  let peak = 0, sumSq = 0;
  for (let i = 0; i < n; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / n) + 1e-9;
  const crestFactor = peak / rms;
  const lufs = 20 * Math.log10(rms) - 0.691;

  // FFT analysis
  const fftSize = Math.min(8192, n);
  const windowed = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / fftSize);
    windowed[i] = samples[i] * w;
  }

  // Compute magnitude spectrum
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

  // Spectral centroid
  let weightedSum = 0, magSum = 0;
  for (let k = 0; k < halfSize; k++) {
    weightedSum += freqs[k] * spectrum[k];
    magSum += spectrum[k];
  }
  const spectralCentroid = magSum > 0 ? weightedSum / magSum : 0;

  // Energy bands
  let subE = 0, lowE = 0, midE = 0, highE = 0;
  for (let k = 0; k < halfSize; k++) {
    const f = freqs[k];
    const e = spectrum[k] * spectrum[k];
    if (f < 60) subE += e;
    else if (f < 200) lowE += e;
    else if (f < 3000) midE += e;
    else highE += e;
  }
  const totalE = subE + lowE + midE + highE + 1e-9;

  return {
    peak,
    rms,
    crestFactor,
    lufs,
    spectralCentroid,
    subEnergy: subE / totalE * 100,
    lowEnergy: lowE / totalE * 100,
    midEnergy: midE / totalE * 100,
    highEnergy: highE / totalE * 100,
  };
}

/**
 * Measure repetition — compare 8-bar blocks for similarity.
 * Returns similarity percentage (0 = completely different, 100 = identical loop).
 */
export function measureRepetition(samples: Float32Array, sr: number, bpm: number): {
  barSimilarity: number;
  eightBarSimilarity: number;
  isLoopDetected: boolean;
} {
  const samplesPerBar = Math.floor(60 / bpm * 4 * sr); // 4 beats per bar
  const samplesPer8Bars = samplesPerBar * 8;

  if (samples.length < samplesPer8Bars * 2) {
    return { barSimilarity: 0, eightBarSimilarity: 0, isLoopDetected: false };
  }

  // Compare 8-bar blocks
  const block1 = samples.slice(0, samplesPer8Bars);
  const block2 = samples.slice(samplesPer8Bars, samplesPer8Bars * 2);

  // Normalized cross-correlation (simplified — compare RMS envelopes)
  const windowSize = Math.floor(sr * 0.1); // 100ms windows
  const numWindows = Math.floor(block1.length / windowSize);
  let correlation = 0;
  let count = 0;

  for (let w = 0; w < numWindows; w++) {
    let rms1 = 0, rms2 = 0;
    for (let i = 0; i < windowSize; i++) {
      const idx = w * windowSize + i;
      rms1 += block1[idx] * block1[idx];
      rms2 += block2[idx] * block2[idx];
    }
    rms1 = Math.sqrt(rms1 / windowSize);
    rms2 = Math.sqrt(rms2 / windowSize);
    // Similarity: how close are the RMS values?
    const maxRms = Math.max(rms1, rms2, 1e-9);
    correlation += 1 - Math.abs(rms1 - rms2) / maxRms;
    count++;
  }

  const eightBarSimilarity = count > 0 ? (correlation / count) * 100 : 0;

  // Compare individual bars
  let barCorr = 0;
  let barCount = 0;
  for (let b = 0; b < 8 && (b + 1) * samplesPerBar < samples.length; b++) {
    const bar1 = samples.slice(b * samplesPerBar, (b + 1) * samplesPerBar);
    const bar2start = samplesPer8Bars + b * samplesPerBar;
    if (bar2start + samplesPerBar > samples.length) break;
    const bar2 = samples.slice(bar2start, bar2start + samplesPerBar);

    let r1 = 0, r2 = 0;
    for (let i = 0; i < samplesPerBar; i++) {
      r1 += bar1[i] * bar1[i];
      r2 += bar2[i] * bar2[i];
    }
    r1 = Math.sqrt(r1 / samplesPerBar);
    r2 = Math.sqrt(r2 / samplesPerBar);
    const maxR = Math.max(r1, r2, 1e-9);
    barCorr += 1 - Math.abs(r1 - r2) / maxR;
    barCount++;
  }

  const barSimilarity = barCount > 0 ? (barCorr / barCount) * 100 : 0;

  return {
    barSimilarity: Math.round(barSimilarity * 10) / 10,
    eightBarSimilarity: Math.round(eightBarSimilarity * 10) / 10,
    isLoopDetected: eightBarSimilarity > 95,
  };
}

/**
 * Create a WAV file from Float32Array samples.
 */
export function createWavFile(samples: Float32Array, sr: number = SR): Blob {
  return floatToWav(samples, sr);
}

/**
 * Download a Blob as a file (for browser-based WAV export).
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
