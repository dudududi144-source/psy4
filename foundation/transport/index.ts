/**
 * foundation/transport — Musical Transport
 *
 * Single source of truth for musical time across all PSY devices.
 *
 * F14/R9: TransportAdapter removed (was instantiated by psyLive but 0 methods
 * ever called — dead weight). psyLive talks directly to MusicalTransport.
 *
 * Public API:
 *   - MusicalTransport — the time model (anchor-based, no float drift)
 *   - TransportSnapshot — immutable state view
 *   - TransportTypes — all type definitions
 */

export { MusicalTransport } from './MusicalTransport';
export type {
  TransportSource,
  BeatObservation,
  TransportSnapshot,
  TransportListener,
  TransportSubscription,
  TempoHypothesis,
  TransportConfig,
} from './TransportTypes';
export { DEFAULT_TRANSPORT_CONFIG } from './TransportTypes';
