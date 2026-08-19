// VERBATIM SHIM from psy-foundation/packages/transport/src/types.ts (lines 1-43)
// Contains the v0 (legacy, currently canonical for PsyDevice.onTransport) types.
// The v1 TransportSnapshot is NOT wired to DeviceHost yet (GAP-S5 in audit).
//
// SHIM_VERSION: pinned to psy-foundation commit 4ae95d3 (2026-08-13).
// A sync test (tests/psy-sampler/shim-sync.test.ts) verifies the shim stays
// byte-equivalent to the canonical source. If the canonical contract evolves,
// the test fails and the shim must be re-synced.
//
// Do not modify. Replace with `import { MusicalTransport } from '@psy-foundation/transport'`
// when integrated into the canonical workspace.

export type AudioTime = number
export type ObservedBeatTime = number
export type EstimatedBeatTime = number
export type PredictedBeatTime = number

export interface BeatObservation {
  observedAt: AudioTime
  strength: number
  source?: string
}

export interface MusicalTransport {
  bpm: number
  beat: number
  bar: number
  beatsPerBar: number
  beatTime: EstimatedBeatTime
  barTime: number
  phase: number
  barPhase: number
  confidence: number
  locked: boolean
  revision: number
  origin: { audioTime: AudioTime; beatIndex: number; bpm: number }
  lastObservationAgo: number
  observationCount: number
}

export interface TransportClockOptions {
  beatsPerBar?: number
  initialBpm?: number
  minBpm?: number
  maxBpm?: number
  tempoSmoothing?: number
  phaseCorrectionRate?: number
  relockWindow?: number
  gapTimeout?: number
  confidenceDecayPerSec?: number
  confidenceGainPerObs?: number
  lockMinObservations?: number
  octaveFoldTolerance?: number
}

// NOTE: DemoTransport has been MOVED to src/lib/demo-transport.ts.
// It is NOT part of the canonical foundation and does NOT belong in this shim.
// The shim is now PURELY verbatim canonical contracts.
