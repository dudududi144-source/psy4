/**
 * TransportTypes — Type definitions for MusicalTransport.
 *
 * F1.1 — ABSOLUTE CLOCK RULE: AudioContext.currentTime is the ONLY musical clock.
 * Date.now(), performance.now(), setInterval(), requestAnimationFrame() are
 * forbidden as sources of musical time. They may serve as UI refresh or
 * worker wakeup, but never as musical truth.
 *
 * F1.2 — TRANSPORT ≠ PLL: BeatPLL is an observer/estimator. MusicalTransport
 * is a time model. Transport does not require radio — it works in internal,
 * radio, external, and manual modes.
 *
 * F1.3 — IMMUTABLE SNAPSHOT: All consumers receive TransportSnapshot, which
 * is a read-only view of transport state at a moment in time. Consumers
 * cannot modify transport state through a snapshot.
 *
 * F1.4 — NO FLOAT DRIFT: Transport uses anchor-based time:
 *   beatTime = anchorTime + beatIndex * beatDuration
 * This eliminates accumulation drift. The only drift source is BPM
 * estimation error, which the PLL handles.
 */

/**
 * The source of the transport's tempo.
 *
 * - 'internal': Transport runs at its own BPM (preset tempo). No radio.
 * - 'radio': Transport follows the PLL's estimate. Radio is connected and locked.
 * - 'external': Future — Transport follows an external sync signal (MIDI, network).
 * - 'manual': Transport is hand-cranked (seek, step). Used for testing/debugging.
 */
export type TransportSource = 'internal' | 'radio' | 'external' | 'manual';

/**
 * A beat observation from any source (radio analysis, manual tap, external sync).
 * Timestamps MUST be in AudioContext.currentTime domain.
 */
export interface BeatObservation {
  /** AudioContext.currentTime of the detected beat */
  readonly time: number;
  /** 0..1 — how confident the detector is (NOT band energy) */
  readonly confidence: number;
  /** Where this observation came from */
  readonly source: TransportSource;
}

/**
 * Immutable snapshot of transport state at a moment in time.
 *
 * This is the ONLY way consumers can read transport state.
 * All fields are readonly — consumers cannot modify transport through a snapshot.
 *
 * F1.3 — epoch is critical: it increments on every re-anchor/seek/reset.
 * Consumers should compare epoch to detect clock disruptions.
 */
export interface TransportSnapshot {
  /** AudioContext.currentTime when this snapshot was taken */
  readonly timestamp: number;

  // ── Tempo ──
  /** Current BPM (beats per minute) */
  readonly bpm: number;
  /** 0..1 — tempo confidence (how sure we are of the BPM) */
  readonly confidence: number;
  /** True if transport is locked to a stable tempo */
  readonly locked: boolean;

  // ── Position ──
  /** AudioContext time of the most recent beat boundary */
  readonly beatTime: number;
  /** AudioContext time of the most recent bar boundary */
  readonly barTime: number;
  /** Beat index within the current bar (0..beatsPerBar-1) */
  readonly beat: number;
  /** Global bar index (monotonically increasing, wraps only on explicit reset) */
  readonly bar: number;
  /** Global beat index (monotonically increasing) */
  readonly beatIndex: number;

  // ── Phase ──
  /** 0..1 — phase within the current beat (0 = on beat, 0.5 = between beats) */
  readonly phase: number;
  /** 0..1 — phase within the current bar */
  readonly barPhase: number;

  // ── Source and epoch ──
  /** What source is driving the transport */
  readonly source: TransportSource;
  /** Incremented on every re-anchor/seek/reset — consumers use this to detect disruptions */
  readonly epoch: number;

  // ── Configuration ──
  /** Number of beats per bar (usually 4) */
  readonly beatsPerBar: number;
  /** Duration of one beat in seconds (= 60 / bpm) */
  readonly beatDuration: number;
  /** Predicted AudioContext time of the next beat boundary */
  readonly nextBeatTime: number;
}

/**
 * Subscriber callback — receives a snapshot. Cannot modify transport state.
 */
export type TransportListener = (snapshot: TransportSnapshot) => void;

/**
 * Subscription handle — call unsubscribe() to stop receiving snapshots.
 */
export interface TransportSubscription {
  readonly unsubscribe: () => void;
}

/**
 * Tempo hypothesis — used when half/double tempo ambiguity is detected.
 * F1.7 — no false certainty: when ambiguity is high, locked=false or confidence is reduced.
 */
export interface TempoHypothesis {
  readonly bpm: number;
  readonly confidence: number;
  readonly evidence: number; // number of supporting observations
}

/**
 * Transport configuration.
 */
export interface TransportConfig {
  /** Initial BPM when source is 'internal' */
  readonly initialBpm: number;
  /** Number of beats per bar */
  readonly beatsPerBar: number;
  /** Minimum BPM (guard against absurd estimates) */
  readonly minBpm: number;
  /** Maximum BPM (guard against absurd estimates) */
  readonly maxBpm: number;
  /** Confidence threshold for locking */
  readonly lockThreshold: number;
  /** Minimum observations before locking */
  readonly minObservationsForLock: number;
  /** Holdover confidence half-life in seconds (how fast confidence decays without observations) */
  readonly holdoverHalfLifeSec: number;
  /** Re-anchor threshold in seconds (if phase error exceeds this, re-anchor at next bar) */
  readonly reanchorThresholdSec: number;
}

export const DEFAULT_TRANSPORT_CONFIG: TransportConfig = {
  initialBpm: 145,
  beatsPerBar: 4,
  minBpm: 60,
  maxBpm: 200,
  lockThreshold: 0.5,
  minObservationsForLock: 8,
  holdoverHalfLifeSec: 10,
  reanchorThresholdSec: 0.05, // 50ms — re-anchor at bar boundaries to correct drift
};
