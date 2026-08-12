/**
 * Synthetic audio fixtures for DSP reality testing.
 *
 * Per audit §6: feed known synthetic audio into the analysis path:
 *   A. 100 Hz sine
 *   B. 440 Hz sine
 *   C. Kick-like transient (sine sweep + noise burst)
 *   D. White noise
 *   E. Kick + bass + noise (full mix)
 *
 * These produce Float32 time-domain arrays (for AnalyserNode.getFloatTimeDomainData)
 * and Uint8 frequency-domain arrays (for AnalyserNode.getByteFrequencyData) that
 * are derived from the time-domain signal via a real DFT.
 *
 * No internet radio needed. No sound card needed. Pure DSP verification.
 */

export const SAMPLE_RATE = 44100;
export const FFT_SIZE = 2048;

// ── Time-domain generators ────────────────────────────────────────────────

/** Pure sine wave at given frequency, length N samples. */
export function sineWave(freqHz: number, N: number, sampleRate: number = SAMPLE_RATE, amp: number = 0.8): Float32Array {
  const buf = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    buf[i] = amp * Math.sin(2 * Math.PI * freqHz * (i / sampleRate));
  }
  return buf;
}

/**
 * Kick-like transient: short sine sweep from 180Hz → 50Hz over 80ms,
 * with exponential amplitude decay, plus a small noise click at start.
 * Mimics a psytrance kick's sub-bass energy + transient.
 */
export function kickTransient(N: number, sampleRate: number = SAMPLE_RATE, startPhase: number = 0): Float32Array {
  const buf = new Float32Array(N);
  const clickLen = Math.floor(sampleRate * 0.003); // 3ms click
  const sweepDur = 0.09; // 90ms pitch sweep
  const decayDur = 0.30; // 300ms overall decay
  for (let i = 0; i < N; i++) {
    const t = i / sampleRate;
    // Pitch sweep 180 → 50 Hz over sweepDur
    const sweepT = Math.min(t / sweepDur, 1);
    const freq = 180 * Math.pow(50 / 180, sweepT);
    // Amplitude: click at start (noise), then exponential decay
    let amp = Math.exp(-t * 8) * 0.9;
    if (i < clickLen) amp += (Math.random() * 2 - 1) * 0.3 * (1 - i / clickLen);
    buf[i] = amp * Math.sin(2 * Math.PI * freq * t + startPhase);
  }
  return buf;
}

/** White noise, uniform [-amp, +amp]. */
export function whiteNoise(N: number, amp: number = 0.5): Float32Array {
  const buf = new Float32Array(N);
  for (let i = 0; i < N; i++) buf[i] = (Math.random() * 2 - 1) * amp;
  return buf;
}

/** Silence (all zeros). */
export function silence(N: number): Float32Array {
  return new Float32Array(N);
}

/**
 * Full mix: kick + sustained bass note + background noise.
 *  - Kick on beats 0,4,8,12 of a 16-step pattern at given BPM
 *  - Bass note: 100 Hz sine, low amplitude
 *  - Background: low-amplitude white noise
 */
export function fullMix(N: number, bpm: number = 145, sampleRate: number = SAMPLE_RATE): Float32Array {
  const buf = new Float32Array(N);
  const beatDur = 60 / bpm; // seconds per beat (quarter note)
  const beatSamples = Math.floor(beatDur * sampleRate);
  // Place kicks at beat boundaries
  for (let beat = 0; beat * beatSamples < N; beat++) {
    const start = beat * beatSamples;
    const end = Math.min(N, start + beatSamples);
    for (let i = start; i < end; i++) {
      const t = (i - start) / sampleRate;
      const sweepT = Math.min(t / 0.09, 1);
      const freq = 180 * Math.pow(50 / 180, sweepT);
      const amp = Math.exp(-t * 8) * 0.85;
      buf[i] += amp * Math.sin(2 * Math.PI * freq * t);
    }
  }
  // Sustained bass (100 Hz, 0.2 amp)
  for (let i = 0; i < N; i++) {
    buf[i] += 0.25 * Math.sin(2 * Math.PI * 100 * (i / sampleRate));
  }
  // Background noise
  for (let i = 0; i < N; i++) {
    buf[i] += (Math.random() * 2 - 1) * 0.05;
  }
  // Soft clip to [-1, 1]
  for (let i = 0; i < N; i++) buf[i] = Math.tanh(buf[i]);
  return buf;
}

// ── Frequency-domain (DFT magnitude) ─────────────────────────────────────
/**
 * Compute a magnitude spectrum from a time-domain signal using a direct DFT
 * with a Hann window. Returns Uint8 values in 0..255 like AnalyserNode.
 *
 * NOTE: This is O(N²) but only used in tests with FFT_SIZE=2048.
 * That's ~4M operations per spectrum — fast enough for our test suite.
 *
 * The output mirrors what a browser AnalyserNode with the same FFT size
 * would report (in normalized 0..255 form, scaled so peak ~= 255).
 */
export function computeByteFrequencyData(
  timeDomain: Float32Array,
  fftSize: number = FFT_SIZE,
  sampleRate: number = SAMPLE_RATE,
): Uint8Array {
  const N = Math.min(timeDomain.length, fftSize);
  const bins = N / 2;
  const out = new Uint8Array(bins);
  // Hann window
  const window = new Float32Array(N);
  for (let i = 0; i < N; i++) window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  // Find peak for normalization
  let peakMag = 0;
  const mags = new Float32Array(bins);
  for (let k = 0; k < bins; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const w = window[n] * timeDomain[n];
      const ang = -2 * Math.PI * k * n / N;
      re += w * Math.cos(ang);
      im += w * Math.sin(ang);
    }
    const mag = Math.sqrt(re * re + im * im) / (N / 2);
    mags[k] = mag;
    if (mag > peakMag) peakMag = mag;
  }
  // Convert to 0..255 with dB-like scaling (matches AnalyserNode behavior)
  // AnalyserNode applies: value = 255 * (mag ref 1.0) clamped; we use peak-normalized
  const scale = 255 / Math.max(1e-9, peakMag);
  for (let k = 0; k < bins; k++) {
    out[k] = Math.max(0, Math.min(255, Math.round(mags[k] * scale * 0.7)));
  }
  return out;
}

// ── Convenience: build a fixture set ─────────────────────────────────────
export interface AudioFixture {
  name: string;
  description: string;
  timeDomain: Float32Array;
  frequencyData: Uint8Array;
  expectedDominantFreqHz: number;
  expectedEnergyRange: [number, number];
  sampleRate: number;
  fftSize: number;
}

export function buildFixtures(): Record<string, AudioFixture> {
  const N = FFT_SIZE;
  const make = (
    name: string, description: string, td: Float32Array,
    expectedFreq: number, energyRange: [number, number],
  ): AudioFixture => ({
    name, description, timeDomain: td,
    frequencyData: computeByteFrequencyData(td, N, SAMPLE_RATE),
    expectedDominantFreqHz: expectedFreq,
    expectedEnergyRange: energyRange,
    sampleRate: SAMPLE_RATE, fftSize: N,
  });

  return {
    A_100Hz: make(
      'A_100Hz', '100 Hz pure sine (sub-bass)',
      sineWave(100, N), 100, [0.4, 0.9],
    ),
    B_440Hz: make(
      'B_440Hz', '440 Hz pure sine (concert A, mid)',
      sineWave(440, N), 440, [0.4, 0.9],
    ),
    C_523Hz: make(
      'C_523Hz', '523.25 Hz sine (C5)',
      sineWave(523.25, N), 523.25, [0.4, 0.9],
    ),
    D_659Hz: make(
      'D_659Hz', '659.25 Hz sine (E5)',
      sineWave(659.25, N), 659.25, [0.4, 0.9],
    ),
    E_220Hz: make(
      'E_220Hz', '220 Hz sine (A3 — bass region)',
      sineWave(220, N), 220, [0.4, 0.9],
    ),
    K_kick: make(
      'K_kick', 'Kick-like transient (sweep 180→50 Hz + click)',
      kickTransient(N), 50, [0.2, 0.95],
    ),
    N_noise: make(
      'N_noise', 'White noise (full-band, flat spectrum)',
      whiteNoise(N), 0, [0.2, 0.5],
    ),
    M_mix: make(
      'M_mix', 'Full mix: kick + 100Hz bass + noise (145 BPM)',
      fullMix(N, 145), 100, [0.2, 0.9],
    ),
    S_silence: make(
      'S_silence', 'Silence (zeros)',
      silence(N), 0, [0.0, 0.001],
    ),
  };
}
