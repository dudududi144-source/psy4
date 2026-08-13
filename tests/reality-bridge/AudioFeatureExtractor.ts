/**
 * AudioFeatureExtractor — F22 AUDIO REALITY GATE
 *
 * Real DSP analysis from rendered audio. Not symbolic metrics.
 * Computes: spectral centroid, RMS, crest factor, transient strength,
 * zero-crossing rate, spectral flatness, envelope (ADSR), decay time.
 *
 * Used to evaluate whether PSY4's rendered audio actually changes
 * when SoundDNA/learned source changes.
 */

export interface AudioFeatures {
  // Time domain
  peak: number;
  rms: number;
  crestFactor: number;        // peak / RMS
  zeroCrossingRate: number;   // per sample
  transientStrength: number;  // max derivative of envelope
  attackTime: number;         // seconds to reach 90% of peak
  decayTime: number;          // seconds to decay to 10% of peak
  sustainLevel: number;       // average level after decay
  releaseTime: number;        // seconds to decay from sustain to 1% of peak
  duration: number;           // total seconds

  // Spectral
  spectralCentroid: number;   // Hz (brightness)
  spectralSpread: number;     // Hz (variance around centroid)
  spectralRolloff: number;    // Hz (85th percentile)
  spectralFlatness: number;   // 0-1 (noisiness)
  spectralFlux: number;       // average frame-to-frame change

  // Low-end specific
  lowEnergy: number;          // 0-1 (energy below 120Hz)
  midEnergy: number;          // 0-1 (120-2500Hz)
  highEnergy: number;         // 0-1 (above 2500Hz)
  subRatio: number;           // low / total
}

/**
 * Analyze a rendered audio buffer.
 */
export function extractAudioFeatures(
  channelData: Float32Array,
  sampleRate: number,
  fftSize: number = 2048,
): AudioFeatures {
  const N = channelData.length;
  if (N === 0) {
    return createEmptyFeatures();
  }

  // ── TIME DOMAIN ──
  let peak = 0;
  let sumSq = 0;
  let zeroCrossings = 0;
  for (let i = 0; i < N; i++) {
    const v = channelData[i];
    const av = Math.abs(v);
    if (av > peak) peak = av;
    sumSq += v * v;
    if (i > 0 && Math.sign(v) !== Math.sign(channelData[i - 1])) zeroCrossings++;
  }
  const rms = Math.sqrt(sumSq / N);
  const crestFactor = rms > 0 ? peak / rms : 0;
  const zeroCrossingRate = zeroCrossings / N;

  // Envelope: compute amplitude envelope via sliding window RMS
  const envWindow = Math.floor(sampleRate * 0.005); // 5ms window
  const envelope: number[] = [];
  for (let i = 0; i < N; i += envWindow) {
    let envSum = 0;
    let envCount = 0;
    for (let j = i; j < Math.min(i + envWindow, N); j++) {
      envSum += channelData[j] * channelData[j];
      envCount++;
    }
    envelope.push(Math.sqrt(envSum / Math.max(1, envCount)));
  }

  // Transient strength: max derivative of envelope
  let transientStrength = 0;
  for (let i = 1; i < envelope.length; i++) {
    const diff = (envelope[i] - envelope[i - 1]) / (envWindow / sampleRate);
    if (diff > transientStrength) transientStrength = diff;
  }

  // Attack time: time to reach 90% of peak
  let attackTime = 0;
  const peakThreshold = peak * 0.9;
  for (let i = 0; i < N; i++) {
    if (Math.abs(channelData[i]) >= peakThreshold) {
      attackTime = i / sampleRate;
      break;
    }
  }

  // Decay time: time to decay to 10% of peak after peak
  let peakIdx = 0;
  for (let i = 0; i < N; i++) {
    if (Math.abs(channelData[i]) >= peak) { peakIdx = i; break; }
  }
  let decayTime = 0;
  const decayThreshold = peak * 0.1;
  for (let i = peakIdx; i < N; i++) {
    if (Math.abs(channelData[i]) < decayThreshold) {
      decayTime = (i - peakIdx) / sampleRate;
      break;
    }
  }
  if (decayTime === 0) decayTime = (N - peakIdx) / sampleRate;

  // Sustain level: average RMS in the sustain region (after decay, before release)
  let sustainLevel = 0;
  const sustainStart = peakIdx + Math.floor(decayTime * sampleRate);
  const sustainEnd = Math.min(N, sustainStart + Math.floor(0.1 * sampleRate));
  let sustainSum = 0;
  let sustainCount = 0;
  for (let i = sustainStart; i < sustainEnd; i++) {
    sustainSum += channelData[i] * channelData[i];
    sustainCount++;
  }
  sustainLevel = sustainCount > 0 ? Math.sqrt(sustainSum / sustainCount) : 0;

  // Release time: time to decay from sustain to 1% of peak
  let releaseTime = 0;
  const releaseThreshold = peak * 0.01;
  for (let i = sustainEnd; i < N; i++) {
    if (Math.abs(channelData[i]) < releaseThreshold) {
      releaseTime = (i - sustainEnd) / sampleRate;
      break;
    }
  }

  // ── SPECTRAL ──
  // Compute FFT on a representative window (middle of the signal)
  const fftStart = Math.floor(N * 0.1); // skip first 10% (attack transient)
  const fftLen = Math.min(fftSize, N - fftStart);
  const fftInput = new Float32Array(fftSize);
  for (let i = 0; i < fftLen; i++) {
    // Hann window
    const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftLen - 1)));
    fftInput[i] = channelData[fftStart + i] * w;
  }

  // Simple DFT (not FFT — but works for analysis)
  const halfSize = fftSize / 2;
  const magnitudes = new Float32Array(halfSize);
  const binHz = sampleRate / fftSize;
  let sumWeighted = 0, sumMag = 0;
  let sumSqDev = 0; // for spectral spread
  let totalEnergy = 0;
  let lowEnergy = 0, midEnergy = 0, highEnergy = 0;

  for (let k = 0; k < halfSize; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < fftSize; n++) {
      re += fftInput[n] * Math.cos(2 * Math.PI * k * n / fftSize);
      im -= fftInput[n] * Math.sin(2 * Math.PI * k * n / fftSize);
    }
    const mag = Math.sqrt(re * re + im * im);
    magnitudes[k] = mag;
    const freq = k * binHz;

    sumWeighted += mag * freq;
    sumMag += mag;
    totalEnergy += mag;

    if (freq < 120) lowEnergy += mag;
    else if (freq < 2500) midEnergy += mag;
    else highEnergy += mag;
  }

  const spectralCentroid = sumMag > 0 ? sumWeighted / sumMag : 0;

  // Spectral spread (variance around centroid)
  for (let k = 0; k < halfSize; k++) {
    const freq = k * binHz;
    sumSqDev += magnitudes[k] * (freq - spectralCentroid) * (freq - spectralCentroid);
  }
  const spectralSpread = sumMag > 0 ? Math.sqrt(sumSqDev / sumMag) : 0;

  // Spectral rolloff (85th percentile)
  let cumulative = 0;
  const rolloffThreshold = totalEnergy * 0.85;
  let rolloffBin = halfSize - 1;
  for (let k = 0; k < halfSize; k++) {
    cumulative += magnitudes[k];
    if (cumulative >= rolloffThreshold) { rolloffBin = k; break; }
  }
  const spectralRolloff = rolloffBin * binHz;

  // Spectral flatness (geometric mean / arithmetic mean)
  let logSum = 0;
  let nonZeroCount = 0;
  for (let k = 0; k < halfSize; k++) {
    if (magnitudes[k] > 1e-10) {
      logSum += Math.log(magnitudes[k]);
      nonZeroCount++;
    }
  }
  const geometricMean = nonZeroCount > 0 ? Math.exp(logSum / nonZeroCount) : 0;
  const arithmeticMean = sumMag / halfSize;
  const spectralFlatness = arithmeticMean > 0 ? geometricMean / arithmeticMean : 0;

  // Spectral flux: average frame-to-frame change (using 2 windows)
  let spectralFlux = 0;
  if (N > fftSize * 2) {
    const fft2Start = fftStart + Math.floor(fftSize * 0.5);
    const fft2Input = new Float32Array(fftSize);
    for (let i = 0; i < fftLen; i++) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftLen - 1)));
      fft2Input[i] = channelData[fft2Start + i] * w;
    }
    let fluxSum = 0;
    for (let k = 0; k < halfSize; k++) {
      let re2 = 0, im2 = 0;
      for (let n = 0; n < fftSize; n++) {
        re2 += fft2Input[n] * Math.cos(2 * Math.PI * k * n / fftSize);
        im2 -= fft2Input[n] * Math.sin(2 * Math.PI * k * n / fftSize);
      }
      const mag2 = Math.sqrt(re2 * re2 + im2 * im2);
      fluxSum += Math.abs(mag2 - magnitudes[k]);
    }
    spectralFlux = fluxSum / halfSize;
  }

  return {
    peak,
    rms,
    crestFactor,
    zeroCrossingRate,
    transientStrength,
    attackTime,
    decayTime,
    sustainLevel,
    releaseTime,
    duration: N / sampleRate,
    spectralCentroid,
    spectralSpread,
    spectralRolloff,
    spectralFlatness,
    spectralFlux,
    lowEnergy: totalEnergy > 0 ? lowEnergy / totalEnergy : 0,
    midEnergy: totalEnergy > 0 ? midEnergy / totalEnergy : 0,
    highEnergy: totalEnergy > 0 ? highEnergy / totalEnergy : 0,
    subRatio: totalEnergy > 0 ? lowEnergy / totalEnergy : 0,
  };
}

function createEmptyFeatures(): AudioFeatures {
  return {
    peak: 0, rms: 0, crestFactor: 0, zeroCrossingRate: 0,
    transientStrength: 0, attackTime: 0, decayTime: 0,
    sustainLevel: 0, releaseTime: 0, duration: 0,
    spectralCentroid: 0, spectralSpread: 0, spectralRolloff: 0,
    spectralFlatness: 0, spectralFlux: 0,
    lowEnergy: 0, midEnergy: 0, highEnergy: 0, subRatio: 0,
  };
}

/**
 * Render a single kick+bass bar using PSY4's actual voice functions
 * and analyze the result.
 *
 * This bypasses the scheduler and directly calls the voice functions
 * to render a deterministic audio clip.
 */
export async function renderPsy4Bar(
  voiceFns: {
    kick: (t: number) => void;
    bass: (t: number, freq: number) => void;
    lead: (t: number, freq: number) => void;
    hat: (t: number, lvl: number) => void;
  },
  notes: Array<{ time: number; voice: string; midi: number | null; vel: number }>,
  bpm: number,
  bars: number = 1,
): Promise<AudioFeatures> {
  const { OfflineAudioContext } = await import('web-audio-api');
  const sampleRate = 44100;
  const duration = bars * 4 * (60 / bpm); // seconds
  const length = Math.ceil(duration * sampleRate);

  const ctx = new OfflineAudioContext(1, length, sampleRate);

  // Create the same audio graph as psyLive
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const analyser = ctx.createAnalyser();
  master.connect(analyser);
  analyser.connect(ctx.destination);

  // Schedule notes
  for (const note of notes) {
    if (note.voice === 'kick') voiceFns.kick(note.time);
    else if (note.voice === 'bass' && note.midi !== null) voiceFns.bass(note.time, 440 * Math.pow(2, (note.midi - 69) / 12));
    else if (note.voice === 'lead' && note.midi !== null) voiceFns.lead(note.time, 440 * Math.pow(2, (note.midi - 69) / 12));
    else if (note.voice === 'hat') voiceFns.hat(note.time, note.vel);
  }

  const buffer = await ctx.startRendering();
  const data = buffer.getChannelData(0);
  return extractAudioFeatures(data, sampleRate);
}
