/**
 * foundation/radio — Radio Observation Layer
 *
 * F2 GATE STATUS: IMPLEMENTED + TESTED
 *
 * The radio is an OBSERVATION SOURCE, never a musical clock.
 * MusicalTransport remains the sole owner of musical time.
 *
 * Public API:
 *   - RadioObservationLayer — single entry point for radio analysis
 *   - BeatObservationEngine — wraps BeatPLL with real confidence
 *   - RadioObservationTypes — all type definitions
 *
 * Transport boundary:
 *   Only { time, confidence, source } crosses into Transport via
 *   transport.observeBeat(). No raw audio, FFT, or spectral features cross.
 */

export { RadioObservationLayer } from './RadioObservationLayer';
export { BeatObservationEngine } from './BeatObservationEngine';
export type { BeatCandidate } from './BeatObservationEngine';
export type {
  RadioSignalState,
  RadioObservationState,
  RadioTimestamp,
  RadioBeatObservation,
  RadioPitchObservation,
  RadioSignalSnapshot,
  RadioObservationSnapshot,
  RadioObservationSource,
  RadioObservationConfig,
} from './RadioObservationTypes';
export { DEFAULT_RADIO_CONFIG } from './RadioObservationTypes';
