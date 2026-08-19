// Shim barrel — re-exports all canonical contracts.
// Replace individual file imports with `@psy-foundation/*` package imports
// when integrated into the canonical workspace.

export type {
  PsyDevice,
} from './device'

export {
  DeviceHost,
  type DeviceHostOptions,
} from './host'

export type {
  TransportState,
  MusicalContext,
  DeviceCapabilities,
  DeviceState,
  SessionState,
  MaterialType,
  Material,
  MusicalAction,
  MusicalOutcome,
  Experience,
  EventTime,
  BeatEvent,
  SectionEvent,
  EnergyEvent,
  DropEvent,
  NoteEvent,
  PatternEvent,
  MusicalEvent,
  EventOfType,
  ChannelListener,
  Unsubscribe,
  Channel,
} from './protocol'

export {
  InMemoryChannel,
} from './protocol'

export type {
  AudioTime,
  ObservedBeatTime,
  EstimatedBeatTime,
  PredictedBeatTime,
  BeatObservation,
  MusicalTransport,
  TransportClockOptions,
} from './transport'

export type {
  Voice,
} from './voice-pool'

export {
  VoicePool,
  Rng,
} from './voice-pool'
