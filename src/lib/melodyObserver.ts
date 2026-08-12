/**
 * MelodyObserver — extracts pitch candidates from radio with confidence gates.
 *
 * From architecture review:
 * - Don't try to transcribe full mix blindly
 * - Isolate melodic region (250-2000Hz)
 * - Gate by confidence (salience, spectral flatness, kick activity)
 * - Only record observations when signal is clean enough
 * - Quantize to musical time (beat/bar)
 *
 * Pipeline:
 *   Radio FFT → melodic band isolation → pitch detection (autocorrelation)
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
 * Estimate pitch using normalized autocorrelation.
 * Better than naive autocorrelation — less octave errors.
 */
export function estimatePitch(
  samples: Float32Array,
  sampleRate: number,
  minHz = 100,
  maxHz = 1800,
): { frequency: number; confidence: number } {
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.floor(sampleRate / minHz);

  // Energy check — skip silence
  let energy = 0;
  for (let i = 0; i < samples.length; i++) {
    energy += samples[i] * samples[i];
  }
  if (energy < 1e-5) {
    return { frequency: 0, confidence: 0 };
  }

  let bestLag = -1;
  let bestCorr = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let denA = 0;
    let denB = 0;

    for (let i = 0; i + lag < samples.length; i++) {
      const a = samples[i];
      const b = samples[i + lag];
      num += a * b;
      denA += a * a;
      denB += b * b;
    }

    const corr = num / Math.sqrt(Math.max(1e-9, denA * denB));

    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  // Confidence gate — don't report low-confidence pitches
  if (bestLag < 0 || bestCorr < 0.65) {
    return { frequency: 0, confidence: 0 };
  }

  return {
    frequency: sampleRate / bestLag,
    confidence: Math.min(1, (bestCorr - 0.65) / 0.3),
  };
}

/**
 * Calculate spectral flatness — high = noise-like, low = tonal.
 * We want tonal signal for pitch detection.
 */
export function spectralFlatness(magnitudes: Uint8Array): number {
  if (magnitudes.length === 0) return 1;

  let sum = 0;
  let logSum = 0;
  let count = 0;

  for (let i = 0; i < magnitudes.length; i++) {
    const v = Math.max(1, magnitudes[i]);
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
 *
 * Usage:
 *   const observer = new MelodyObserver();
 *   // In detect loop:
 *   observer.observe(freqData, timeDomainData, ctx, pll, occupancy);
 *   // Get observations:
 *   const obs = observer.getObservations();
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
    const flatness = spectralFlatness(freqData);
    if (flatness > 0.5) {
      this.finishLastNote(currentTime, beatIndex, barIndex);
      return;
    }

    // 4. Check salience (peak must be prominent)
    if (melodic.peakValue < 0.3) {
      this.finishLastNote(currentTime, beatIndex, barIndex);
      return;
    }

    // ── PITCH DETECTION ──
    // Use time-domain data for autocorrelation
    const pitch = estimatePitch(timeDomainData, sampleRate, 100, 1800);

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
      durationBeats: 0, // filled when note ends
      spectralEnergy: melodic.energy,
      salience,
    };

    // If same pitch as last, extend duration
    if (this.lastObservation && Math.abs(this.lastObservation.midi - midi) <= 1) {
      // Same note — don't create new observation, just update duration
      // Duration will be calculated when note ends
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

    // Calculate duration in beats
    const timeDiff = currentTime - this.lastObservation.time;
    const beatDuration = 0.4; // approx, will be refined with PLL
    this.lastObservation.durationBeats = Math.max(0.25, timeDiff / beatDuration);

    // Only store if note lasted at least 1/16th
    if (this.lastObservation.durationBeats >= 0.25) {
      this.observations.push(this.lastObservation);
      if (this.observations.length > 200) this.observations.shift();
    }

    this.lastObservation = null;
  }

  /**
   * Get all collected observations.
   */
  getObservations(): MelodyObservation[] {
    return [...this.observations];
  }

  /**
   * Get observations from the last N bars.
   */
  getRecentObservations(bars: number): MelodyObservation[] {
    if (this.observations.length === 0) return [];
    const lastBar = this.observations[this.observations.length - 1].bar;
    return this.observations.filter(o => o.bar >= lastBar - bars);
  }

  /**
   * Clear old observations (keep last 100).
   */
  prune(): void {
    if (this.observations.length > 100) {
      this.observations = this.observations.slice(-100);
    }
  }

  /**
   * Ensure time-domain buffer is allocated.
   */
  ensureTimeDomainBuf(analyser: AnalyserNode): Float32Array {
    if (!this.timeDomainBuf || this.timeDomainBuf.length !== analyser.fftSize) {
      this.timeDomainBuf = new Float32Array(analyser.fftSize);
    }
    return this.timeDomainBuf;
  }
}
