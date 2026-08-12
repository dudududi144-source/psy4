/**
 * RadioObservationTypes — Type definitions for the Radio Observation Layer.
 *
 * F2 DESIGN PRINCIPLES:
 *
 * 1. Radio is an OBSERVATION SOURCE, never a musical clock.
 *    Transport owns musical time. Radio only suggests.
 *
 * 2. Every observation is timestamped with AudioContext.currentTime.
 *    Date.now() is forbidden for musical timing.
 *
 * 3. Confidence represents confidence in the OBSERVATION ITSELF,
 *    not loudness or band energy.
 *
 * 4. Signal state and observation state are SEPARATE.
 *    Signal state = "is there audio?"
 *    Observation state = "did we detect a beat/pitch?"
 *
 * 5. The Transport boundary is strict:
 *    Only { time, confidence, source } crosses into Transport.
 *    No raw audio, no FFT, no spectral features, no occupancy.
 */

// ── Signal State (F2.4) ──────────────────────────────────────────────────

/**
 * Radio signal state — describes the quality of the radio audio stream.
 * This is NOT the same as observation state (beat/pitch detection).
 */
export type RadioSignalState =
  | 'NO_SIGNAL'        // silence (RMS < 1e-5)
  | 'WEAK_SIGNAL'      // below threshold but non-zero
  | 'SIGNAL_PRESENT'   // audible signal detected
  | 'STABLE_SIGNAL'    // signal present for > 5 seconds
  | 'LOST'             // signal was present, now gone for > 2 seconds
  | 'DEGRADED'         // signal present but observations are unreliable
  | 'DISCONNECTED'     // no radio connection
  | 'CONNECTING'       // attempting to connect
  | 'ERROR';           // error state

/**
 * The full observation pipeline state.
 * This is what the Transport checks to decide FOLLOWING.
 */
export type RadioObservationState =
  | 'NO_SIGNAL'      // no audio to observe
  | 'SIGNAL_PRESENT' // audio present but not enough observations
  | 'LOCKING'        // receiving observations, estimator not yet locked
  | 'FOLLOWING'      // estimator locked + signal stable
  | 'DEGRADED'       // observations unreliable (high jitter, ambiguity)
  | 'LOST';          // signal lost, in holdover

// ── Timestamp Model (F2.5) ──────────────────────────────────────────────

/**
 * Every observation carries three timestamps:
 * - observedAt: when the analyser frame was read (AudioContext domain)
 * - estimatedAt: when the feature ACTUALLY occurred (latency-corrected)
 * - predictedAt: when the NEXT occurrence will happen (for scheduling)
 *
 * Latency model:
 *   analysisLatency = fftSize / sampleRate / 2 (half FFT window)
 *   estimatedAt = observedAt - analysisLatency
 *   predictedAt = estimatedAt + estimatedPeriod
 */
export interface RadioTimestamp {
  /** AudioContext.currentTime when analyser frame was read */
  readonly observedAt: number;
  /** Estimated time the feature actually occurred (latency-corrected) */
  readonly estimatedAt: number;
  /** Predicted time of the next occurrence (for scheduling) */
  readonly predictedAt: number;
}

// ── Beat Observation (F2.2) ─────────────────────────────────────────────

/**
 * A beat observation from the radio.
 * Produced by BeatObservationEngine after BeatPLL processing.
 */
export interface RadioBeatObservation {
  readonly timestamp: RadioTimestamp;
  readonly estimatedBpm: number;
  readonly estimatedPeriod: number;   // seconds per beat
  readonly phaseErrorMs: number;      // |observed - predicted| in ms
  readonly confidence: number;        // 0..1 (NOT loudness — real confidence)
  readonly locked: boolean;           // estimator lock state
  readonly source: RadioObservationSource;
  readonly observationCount: number;  // total observations received
}

// ── Pitch Observation (F2.3) ────────────────────────────────────────────

/**
 * A pitch observation from the radio.
 * Produced by PitchObserver (wrapping MelodyObserver).
 */
export interface RadioPitchObservation {
  readonly timestamp: RadioTimestamp;
  readonly frequency: number;         // Hz
  readonly midi: number;              // MIDI note number
  readonly pitchClass: number;        // 0-11
  readonly cents: number;             // cents offset from nearest note
  readonly octaveError: number;       // 0 if no octave error
  readonly confidence: number;        // 0..1
  readonly noteDuration: number;      // seconds (how long this pitch lasted)
  readonly spectralEnergy: number;    // 0..1 (melodic band)
  readonly salience: number;          // peak prominence
}

// ── Signal Snapshot (F2.4) ──────────────────────────────────────────────

/**
 * Snapshot of the radio signal state.
 * This is what the UI reads to display signal quality.
 */
export interface RadioSignalSnapshot {
  readonly state: RadioSignalState;
  readonly observationState: RadioObservationState;
  readonly sampleRate: number;
  readonly rms: number;
  readonly peak: number;
  readonly spectralEnergy: number;
  readonly nonZeroRatio: number;
  readonly signalAgeSec: number;      // seconds since last significant sample
  readonly timestamp: number;         // AudioContext.currentTime of this snapshot
  readonly reason: string;
}

// ── Source ───────────────────────────────────────────────────────────────

export type RadioObservationSource = 'radio' | 'manual' | 'external';

// ── Observation Snapshot (aggregate) ────────────────────────────────────

/**
 * Complete snapshot of the radio observation layer.
 * Produced once per analysis tick.
 */
export interface RadioObservationSnapshot {
  readonly signal: RadioSignalSnapshot;
  readonly beat: RadioBeatObservation | null;
  readonly pitch: RadioPitchObservation | null;
  readonly occupancy: {
    readonly kick: number;
    readonly bass: number;
    readonly lead: number;
    readonly hats: number;
  };
  readonly timestamp: number;  // AudioContext.currentTime
}

// ── Configuration ────────────────────────────────────────────────────────

export interface RadioObservationConfig {
  readonly sampleRate: number;
  readonly fftSize: number;
  readonly minBpm: number;
  readonly maxBpm: number;
  readonly lockThreshold: number;         // confidence to lock
  readonly minObservationsForLock: number;
  readonly stableSignalDurationSec: number; // how long signal must be present
  readonly lostSignalTimeoutSec: number;    // how long without signal → LOST
  readonly degradedPhaseErrorMs: number;    // phase error threshold for DEGRADED
  readonly maxObservations: number;         // ring buffer size
}

export const DEFAULT_RADIO_CONFIG: RadioObservationConfig = {
  sampleRate: 44100,
  fftSize: 512,
  minBpm: 60,
  maxBpm: 200,
  lockThreshold: 0.5,
  minObservationsForLock: 8,
  stableSignalDurationSec: 5,
  lostSignalTimeoutSec: 2,
  degradedPhaseErrorMs: 50,
  maxObservations: 200,
};
