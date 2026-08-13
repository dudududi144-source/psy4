/**
 * BeatObservationEngine — wraps BeatPLL with real confidence calculation.
 *
 * F2.2 — Does NOT move BeatPLL ownership into Transport.
 * BeatPLL remains an observer/estimator. This engine:
 *   1. Receives beat candidates from the radio analysis
 *   2. Computes REAL confidence (onset strength + regularity + signal quality)
 *   3. Feeds observations to BeatPLL
 *   4. Produces RadioBeatObservation with timestamp/latency model
 *
 * CONFIDENCE IS NOT LOUDNESS.
 * The old code used `Math.min(1, radioBands.low * 2)` — that's a loudness proxy.
 * Real confidence = onsetStrength * 0.5 + regularityFit * 0.3 + signalQuality * 0.2
 */

import { BeatPLL } from '../../src/lib/beatPLL';
import type {
  RadioBeatObservation,
  RadioTimestamp,
  RadioObservationSource,
  RadioObservationConfig,
} from './RadioObservationTypes';

export interface BeatCandidate {
  /** AudioContext.currentTime when the beat was detected */
  readonly time: number;
  /** Sub-bass energy at detection moment (0..1) */
  readonly subBassEnergy: number;
  /** Local average sub-bass energy (0..1) */
  readonly localAverage: number;
  /** Local max sub-bass energy (0..1) */
  readonly localMax: number;
  /** Total spectral energy (0..1) */
  readonly spectralEnergy: number;
}

export class BeatObservationEngine {
  private pll: BeatPLL;
  private config: RadioObservationConfig;
  private observationCount = 0;
  private lastObservation: RadioBeatObservation | null = null;
  private recentPhaseErrors: number[] = [];

  constructor(config: RadioObservationConfig) {
    this.config = config;
    this.pll = new BeatPLL();
  }

  /**
   * Process a beat candidate.
   * Returns a RadioBeatObservation if the candidate passes confidence gates.
   * Returns null if the candidate is rejected.
   */
  processBeat(
    candidate: BeatCandidate,
    source: RadioObservationSource = 'radio',
  ): RadioBeatObservation | null {
    // ── Compute REAL confidence (NOT loudness) ──

    // 1. Onset strength: how much did sub-bass exceed the local average?
    const onsetStrength = candidate.localMax > candidate.localAverage
      ? Math.min(1, (candidate.subBassEnergy - candidate.localAverage) /
                     Math.max(0.01, candidate.localMax - candidate.localAverage))
      : 0;

    // 2. Regularity fit: how well does this observation fit the established period?
    let regularityFit = 0.5; // neutral if no history
    if (this.lastObservation) {
      const expectedInterval = this.lastObservation.estimatedPeriod;
      const actualInterval = candidate.time - this.lastObservation.timestamp.observedAt;
      const phaseError = Math.abs(actualInterval - expectedInterval);
      const maxTolerance = expectedInterval * 0.25; // 25% of period
      regularityFit = Math.max(0, 1 - phaseError / maxTolerance);
    }

    // 3. Signal quality: basic energy check
    const signalQuality = Math.min(1, candidate.spectralEnergy * 2);

    // Combined confidence
    const confidence = Math.min(1,
      onsetStrength * 0.5 +
      regularityFit * 0.3 +
      signalQuality * 0.2
    );

    // Reject low-confidence observations
    if (confidence < 0.3) return null;

    // ── Feed to BeatPLL ──
    this.pll.update({ time: candidate.time, confidence });

    // ── Compute timestamp/latency model ──
    const analysisLatency = this.config.fftSize / this.config.sampleRate / 2;
    const observedAt = candidate.time;
    const estimatedAt = observedAt - analysisLatency;

    const bpm = this.pll.getBpm();
    const period = 60 / bpm;
    const predictedAt = estimatedAt + period;

    // Phase error: |observed - predicted|
    const phaseErrorMs = this.lastObservation
      ? Math.abs(candidate.time - (this.lastObservation.timestamp.estimatedAt + this.lastObservation.estimatedPeriod)) * 1000
      : 0;

    // Track recent phase errors for DEGRADED detection
    this.recentPhaseErrors.push(phaseErrorMs);
    if (this.recentPhaseErrors.length > 20) this.recentPhaseErrors.shift();

    const timestamp: RadioTimestamp = {
      observedAt,
      estimatedAt,
      predictedAt,
    };

    const observation: RadioBeatObservation = {
      timestamp,
      estimatedBpm: bpm,
      estimatedPeriod: period,
      phaseErrorMs,
      confidence,
      locked: this.pll.isLocked(),
      source,
      observationCount: ++this.observationCount,
    };

    this.lastObservation = observation;
    return observation;
  }

  /**
   * Get the current beat observation state (without processing a new beat).
   */
  getObservation(): RadioBeatObservation | null {
    return this.lastObservation;
  }

  /**
   * Get P95 phase error over recent observations.
   */
  getP95PhaseErrorMs(): number {
    if (this.recentPhaseErrors.length === 0) return 0;
    const sorted = [...this.recentPhaseErrors].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)];
  }

  /**
   * Check if observations are degraded (high phase error).
   */
  isDegraded(): boolean {
    return this.getP95PhaseErrorMs() > this.config.degradedPhaseErrorMs;
  }

  /**
   * Get the underlying PLL (for Transport integration).
   */
  getPLL(): BeatPLL {
    return this.pll;
  }

  /**
   * Reset the estimator.
   */
  reset(): void {
    this.pll.reset();
    this.observationCount = 0;
    this.lastObservation = null;
    this.recentPhaseErrors = [];
  }
}
