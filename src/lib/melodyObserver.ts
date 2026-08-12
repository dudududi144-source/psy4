/**
 * MelodyObserver — extracts pitch candidates from radio with confidence gates.
 *
 * REALITY REPAIR R2 — Forensic root-cause fix.
 *
 * ROOT CAUSE (2 bugs in original):
 *
 * Bug 1 — Normalized ACF octave ambiguity (CRITICAL):
 *   Original estimatePitch() used normalized autocorrelation. For a pure
 *   sine, ACF has equal peaks at ALL integer multiples of the true lag
 *   (lag=100, 200, 300, 400 for 440 Hz). The function picked the global
 *   max, which due to numerical effects could be a sub-harmonic
 *   (lag=401 → 110 Hz, a -2 octave error).
 *
 *   FIX: Replaced with YIN algorithm. YIN uses the difference function
 *   and takes the FIRST dip below a threshold (smallest τ = highest
 *   frequency), explicitly avoiding octave-down errors.
 *
 * Bug 2 — spectralFlatness computed on full spectrum with bad clamp:
 *   Original computed flatness over 0-Nyquist with Math.max(1, ...).
 *   A tone with noise floor 5/255 gave flatness ≈ 0.85, tripping the
 *   >0.5 rejection gate. Pure tones were classified as noise.
 *
 *   FIX: Compute flatness only on the melodic band (250-2000 Hz) where
 *   tonal signals are expected. Change clamp to Math.max(1e-6, ...) for
 *   proper dynamic range (zero bins now contribute -13.8 to logSum,
 *   dragging geometric mean toward 0 for tonal signals).
 *
 * Pipeline:
 *   Radio FFT → melodic band isolation → YIN pitch detection
 *   → confidence gating → MelodyObservation → MotifLearner
 */

export interface MelodyObservation {
  time: number;          // AudioContext.currentTime
  midi: number;          // detected pitch as MIDI note
  pitchClass: number;    // 0-11
  confidence: number;    // 0-1
  beat: number;          // beat index (from PLL)
  bar: number;           // bar index
  durationBeats: number; // how long this note lasted (filled later)
  spectralEnergy: number;
  salience: number;      // how prominent this pitch is
}

/**
 * YIN pitch detection algorithm.
 *
 * Steps:
 *   1. Compute the difference function: d(τ) = Σ(x[i] - x[i+τ])²
 *   2. Compute the cumulative mean normalized difference: d'(τ)
 *   3. Find the first τ where d'(τ) < threshold (the fundamental period)
 *   4. Parabolic interpolation for sub-sample accuracy
 *
 * The key insight: YIN finds the FIRST dip (smallest τ = highest frequency),
 * which avoids octave-down errors that plague ACF.
 *
 * @param samples  Time-domain audio samples (Float32Array)
 * @param sampleRate  Sample rate in Hz
 * @param minHz  Minimum frequency to detect (default 80)
 * @param maxHz  Maximum frequency to detect (default 2000)
 * @returns { frequency: number, confidence: number }
 */
export function estimatePitch(
  samples: Float32Array,
  sampleRate: number,
  minHz: number = 80,
  maxHz: number = 2000,
): { frequency: number; confidence: number } {
  const N = samples.length;
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.min(Math.floor(sampleRate / minHz), N / 2);

  // Energy check — skip silence
  let energy = 0;
  for (let i = 0; i < N; i++) energy += samples[i] * samples[i];
  if (energy < 1e-5) {
    return { frequency: 0, confidence: 0 };
  }

  // Step 1: Compute the difference function d(τ) = Σ(x[i] - x[i+τ])²
  // Only compute for τ in [minLag, maxLag]
  const diff = new Float32Array(maxLag + 1);
  for (let tau = minLag; tau <= maxLag; tau++) {
    let sum = 0;
    for (let i = 0; i < N - tau; i++) {
      const delta = samples[i] - samples[i + tau];
      sum += delta * delta;
    }
    diff[tau] = sum;
  }

  // Step 2: Compute the cumulative mean normalized difference d'(τ)
  // d'(0) = 1
  // d'(τ) = d(τ) / ((1/τ) * Σ_{j=1}^{τ} d(j))
  const cmndf = new Float32Array(maxLag + 1);
  cmndf[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    runningSum += diff[tau];
    cmndf[tau] = runningSum === 0 ? 1 : (diff[tau] * tau) / runningSum;
  }

  // Step 3: Find the FIRST dip below the threshold
  // This is the key difference from ACF: we take the first dip, not the
  // global minimum. The first dip corresponds to the fundamental period
  // (smallest τ = highest frequency), avoiding octave-down errors.
  const threshold = 0.15;
  let bestTau = -1;

  for (let tau = minLag; tau <= maxLag; tau++) {
    if (cmndf[tau] < threshold) {
      // Found a dip — now find the LOCAL minimum (the dip bottom)
      // by continuing while cmndf is decreasing
      let localMinTau = tau;
      while (localMinTau + 1 <= maxLag && cmndf[localMinTau + 1] < cmndf[localMinTau]) {
        localMinTau++;
      }
      bestTau = localMinTau;
      break;
    }
  }

  // If no dip below threshold, find the global minimum in [minLag, maxLag]
  if (bestTau < 0) {
    let minVal = Infinity;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (cmndf[tau] < minVal) {
        minVal = cmndf[tau];
        bestTau = tau;
      }
    }
    // If even the global minimum is too high, the signal is not periodic enough
    if (minVal > 0.5) {
      return { frequency: 0, confidence: 0 };
    }
  }

  // Step 4: Parabolic interpolation for sub-sample accuracy
  // Fit a parabola to (bestTau-1, cmndf[bestTau-1]), (bestTau, cmndf[bestTau]),
  // (bestTau+1, cmndf[bestTau+1]) and find the minimum.
  let refinedTau = bestTau;
  if (bestTau > 0 && bestTau < maxLag) {
    const s0 = cmndf[bestTau - 1];
    const s1 = cmndf[bestTau];
    const s2 = cmndf[bestTau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) {
      const shift = (s2 - s0) / denom;
      if (Math.abs(shift) <= 1) {
        refinedTau = bestTau + shift;
      }
    }
  }

  const frequency = sampleRate / refinedTau;

  // Confidence: 1 - cmndf[bestTau] (lower CMNDF = higher confidence)
  const confidence = Math.max(0, Math.min(1, 1 - cmndf[bestTau]));

  return { frequency, confidence };
}

/**
 * Calculate spectral flatness — high = noise-like, low = tonal.
 * We want tonal signal for pitch detection.
 *
 * FIX: Compute only on the melodic band (250-2000 Hz) and use a smaller
 * clamp (1e-6 instead of 1) for proper dynamic range.
 */
export function spectralFlatness(
  magnitudes: Uint8Array,
  sampleRate?: number,
  fftSize?: number,
): number {
  if (magnitudes.length === 0) return 1;

  // Determine the melodic band [250, 2000] Hz
  let startBin = 0;
  let endBin = magnitudes.length;
  if (sampleRate && fftSize) {
    const binHz = sampleRate / fftSize;
    startBin = Math.floor(250 / binHz);
    endBin = Math.min(magnitudes.length, Math.floor(2000 / binHz));
  }

  if (endBin <= startBin) return 1;

  let sum = 0;
  let logSum = 0;
  let count = 0;

  for (let i = startBin; i < endBin; i++) {
    // FIX: use 1e-6 clamp (was 1) so zero bins contribute -13.8 to logSum
    const v = Math.max(1e-6, magnitudes[i]);
    sum += v;
    logSum += Math.log(v);
    count++;
  }

  if (count === 0 || sum === 0) return 1;

  const geometricMean = Math.exp(logSum / count);
  const arithmeticMean = sum / count;

  return geometricMean / arithmeticMean;
}

/**
 * Extract melodic band from frequency data.
 * Returns the energy and peak bin in the 250-2000Hz range.
 */
export function extractMelodicBand(
  freqData: Uint8Array,
  sampleRate: number,
  fftSize: number,
): { energy: number; peakBin: number; peakValue: number } {
  const binHz = sampleRate / fftSize;
  const minBin = Math.floor(250 / binHz);
  const maxBin = Math.floor(2000 / binHz);

  let energy = 0;
  let peakBin = 0;
  let peakValue = 0;

  for (let i = minBin; i <= maxBin && i < freqData.length; i++) {
    const v = freqData[i];
    energy += v;
    if (v > peakValue) {
      peakValue = v;
      peakBin = i;
    }
  }

  const count = Math.min(maxBin, freqData.length - 1) - minBin + 1;
  return {
    energy: energy / (Math.max(1, count) * 255),
    peakBin,
    peakValue: peakValue / 255,
  };
}

/**
 * MelodyObserver — collects pitch observations with confidence gates.
 */
export class MelodyObserver {
  private observations: MelodyObservation[] = [];
  private lastObservation: MelodyObservation | null = null;
  private timeDomainBuf: Float32Array | null = null;

  /**
   * Process a frame of radio audio.
   * Only creates an observation if confidence is high enough.
   */
  observe(
    freqData: Uint8Array,
    timeDomainData: Float32Array,
    sampleRate: number,
    fftSize: number,
    currentTime: number,
    beatIndex: number,
    barIndex: number,
    occupancy: { kick: number; bass: number; lead: number; hats: number },
  ): void {
    // ── CONFIDENCE GATES ──

    // 1. Don't detect melody when kick is dominant
    if (occupancy.kick > 0.8) {
      this.finishLastNote(currentTime, beatIndex, barIndex);
      return;
    }

    // 2. Check melodic band energy
    const melodic = extractMelodicBand(freqData, sampleRate, fftSize);
    if (melodic.energy < 0.15) {
      this.finishLastNote(currentTime, beatIndex, barIndex);
      return;
    }

    // 3. Check spectral flatness (want tonal, not noise)
    // FIX: compute on melodic band only
    const flatness = spectralFlatness(freqData, sampleRate, fftSize);
    if (flatness > 0.5) {
      this.finishLastNote(currentTime, beatIndex, barIndex);
      return;
    }

    // 4. Check salience (peak must be prominent)
    if (melodic.peakValue < 0.3) {
      this.finishLastNote(currentTime, beatIndex, barIndex);
      return;
    }

    // ── PITCH DETECTION (YIN) ──
    const pitch = estimatePitch(timeDomainData, sampleRate, 80, 2000);

    if (pitch.frequency === 0 || pitch.confidence < 0.3) {
      this.finishLastNote(currentTime, beatIndex, barIndex);
      return;
    }

    // Convert to MIDI
    const midi = Math.round(69 + 12 * Math.log2(pitch.frequency / 440));
    const pitchClass = ((midi % 12) + 12) % 12;

    // Salience: how much louder is the peak than the average?
    const salience = melodic.peakValue / Math.max(0.01, melodic.energy);

    // Combined confidence
    const confidence = Math.min(1,
      pitch.confidence * 0.5 +
      Math.min(1, salience / 3) * 0.3 +
      Math.min(1, melodic.energy * 2) * 0.2
    );

    // Only keep high-confidence observations
    if (confidence < 0.4) {
      this.finishLastNote(currentTime, beatIndex, barIndex);
      return;
    }

    // ── CREATE OR EXTEND OBSERVATION ──
    const obs: MelodyObservation = {
      time: currentTime,
      midi,
      pitchClass,
      confidence,
      beat: beatIndex,
      bar: barIndex,
      durationBeats: 0,
      spectralEnergy: melodic.energy,
      salience,
    };

    // If same pitch as last, extend duration
    if (this.lastObservation && Math.abs(this.lastObservation.midi - midi) <= 1) {
      // Same note — don't create new observation, just update duration
    } else {
      // New note — finish previous, start new
      this.finishLastNote(currentTime, beatIndex, barIndex);
      this.lastObservation = obs;
    }
  }

  /**
   * Finish the current note (calculate duration, store).
   */
  private finishLastNote(currentTime: number, beatIndex: number, barIndex: number): void {
    if (!this.lastObservation) return;

    const timeDiff = currentTime - this.lastObservation.time;
    const beatDuration = 0.4;
    this.lastObservation.durationBeats = Math.max(0.25, timeDiff / beatDuration);

    if (this.lastObservation.durationBeats >= 0.25) {
      this.observations.push(this.lastObservation);
      if (this.observations.length > 200) this.observations.shift();
    }

    this.lastObservation = null;
  }

  getObservations(): MelodyObservation[] {
    return [...this.observations];
  }

  getRecentObservations(bars: number): MelodyObservation[] {
    if (this.observations.length === 0) return [];
    const lastBar = this.observations[this.observations.length - 1].bar;
    return this.observations.filter(o => o.bar >= lastBar - bars);
  }

  prune(): void {
    if (this.observations.length > 100) {
      this.observations = this.observations.slice(-100);
    }
  }

  /**
   * Flush the current pending observation (commit it to the observations array).
   * Call this when the stream ends or when querying observations to ensure
   * the most recent note is included.
   */
  flush(currentTime: number, beatIndex: number, barIndex: number): void {
    this.finishLastNote(currentTime, beatIndex, barIndex);
  }

  ensureTimeDomainBuf(analyser: AnalyserNode): Float32Array {
    if (!this.timeDomainBuf || this.timeDomainBuf.length !== analyser.fftSize) {
      this.timeDomainBuf = new Float32Array(analyser.fftSize);
    }
    return this.timeDomainBuf;
  }
}
