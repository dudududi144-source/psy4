/**
 * foundation/transport — Musical Transport
 *
 * Single source of truth for musical time across all PSY devices.
 *
 * F1 GATE STATUS: IMPLEMENTED + TESTED
 *
 * Public API:
 *   - MusicalTransport — the time model (anchor-based, no float drift)
 *   - TransportAdapter — bridges to existing psyLive scheduler
 *   - TransportSnapshot — immutable state view
 *   - TransportTypes — all type definitions
 *
 * Design principles (see audit-reports/TRANSPORT_DESIGN_REVIEW.md):
 *   1. AudioContext.currentTime is the ONLY musical clock
 *   2. Transport ≠ PLL (Transport is a time model, PLL is an observer)
 *   3. Anchor-based: beatTime = anchorTime + beatIndex * beatDuration
 *   4. Immutable snapshots (consumers can't modify state)
 *   5. Epoch increments on every disruption
 *   6. Holdover mode (radio loss → continue with decaying confidence)
 *   7. Half/double tempo hypotheses (no false certainty)
 *   8. Tab suspension → DROP STALE EVENTS policy
 */

export { MusicalTransport } from './MusicalTransport';
export { TransportAdapter } from './TransportAdapter';
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
