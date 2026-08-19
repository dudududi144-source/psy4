// VERBATIM SHIM — merged from:
//   psy-foundation/packages/protocol/src/state.ts   (TransportState, MusicalContext, DeviceCapabilities, DeviceState, SessionState, MaterialType, Material, MusicalAction, MusicalOutcome, Experience)
//   psy-foundation/packages/protocol/src/events.ts   (EventTime, BeatEvent, SectionEvent, EnergyEvent, DropEvent, NoteEvent, PatternEvent, MusicalEvent, EventOfType)
//   psy-foundation/packages/protocol/src/channel.ts  (ChannelListener, Unsubscribe, Channel, InMemoryChannel)
// Do not modify. Replace with `import { ... } from '@psy-foundation/protocol'` when integrated.

// ─── state.ts ───────────────────────────────────────────────────────────────

export interface TransportState {
  bpm: number
  beat: number
  bar: number
  phase: number
  locked: boolean
  confidence: number
  revision: number
}

export interface MusicalContext {
  key: string
  rootPc: number
  scale: string
  energy: number
  style: string
  section: string
  beatsPerBar: number
}

export interface DeviceCapabilities {
  audio: boolean
  midi: boolean
  inputs: number
  outputs: number
  voices: number
  latencyMs: number
  roles: string[]
}

export interface DeviceState {
  id: string
  online: boolean
  lastSeen: number
  capabilities: DeviceCapabilities
}

export interface SessionState {
  id: string
  startedAt: number
  devices: DeviceState[]
}

export type MaterialType =
  | 'motif'
  | 'rhythm'
  | 'bass-pattern'
  | 'drum-pattern'
  | 'fill'
  | 'phrase'
  | 'fx-gesture'
  | 'preset'
  | 'texture'

export interface Material {
  id: string
  type: MaterialType
  role: string
  style: string
  tempoRange: [number, number]
  keyCompatibility: number[]
  energy: number
  novelty: number
  source: string
  confidence: number
  usageCount: number
  reward: number
  lastUsed: number | null
  payload: unknown
}

export type MusicalAction =
  | { type: 'play'; materialId: string }
  | { type: 'variation'; materialId: string; transform: string }
  | { type: 'do-nothing' }

export type MusicalOutcome =
  | { type: 'sounded'; durationSec: number }
  | { type: 'skipped' }
  | { type: 'collided'; reason: string }

export interface Experience {
  context: MusicalContext
  action: MusicalAction
  outcome: MusicalOutcome
  reward: number
  at: number
}

// ─── events.ts ───────────────────────────────────────────────────────────────

import type { MusicalTransport } from './transport'

export type EventTime = number

export interface BeatEvent {
  type: 'beat'
  beat: number
  bar: number
  transport: MusicalTransport
  at: EventTime
}
export interface SectionEvent {
  type: 'section'
  section: string
  bar: number
  at: EventTime
}
export interface EnergyEvent {
  type: 'energy'
  energy: number
  at: EventTime
}
export interface DropEvent {
  type: 'drop'
  intensity: number
  at: EventTime
}
export interface NoteEvent {
  type: 'note'
  note: number
  velocity: number
  duration: number
  channel: string
  at: EventTime
}
export interface PatternEvent {
  type: 'pattern'
  patternId: string
  trackId: string
  at: EventTime
}

export type MusicalEvent =
  | BeatEvent
  | SectionEvent
  | EnergyEvent
  | DropEvent
  | NoteEvent
  | PatternEvent

export type EventOfType<T extends MusicalEvent['type']> = Extract<MusicalEvent, { type: T }>

// ─── channel.ts ──────────────────────────────────────────────────────────────

export type ChannelListener<E = MusicalEvent> = (event: E) => void
export type Unsubscribe = () => void

export interface Channel {
  subscribe(listener: ChannelListener): Unsubscribe
  publish(event: MusicalEvent): void
  close(): void
  readonly name: string
}

export class InMemoryChannel implements Channel {
  readonly name: string
  private readonly listeners = new Set<ChannelListener>()
  private closed = false

  constructor(name = 'in-memory') {
    this.name = name
  }

  subscribe(listener: ChannelListener): Unsubscribe {
    if (this.closed) throw new Error(`Channel "${this.name}" is closed`)
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  publish(event: MusicalEvent): void {
    if (this.closed) return
    const listeners = Array.from(this.listeners)
    for (const l of listeners) {
      // FIX: catch per-listener errors so one bad listener doesn't starve the rest.
      try {
        l(event)
      } catch (err) {
        console.error('[in-memory-channel] Listener error:', err)
      }
    }
  }

  close(): void {
    this.closed = true
    this.listeners.clear()
  }

  get subscriberCount(): number {
    return this.listeners.size
  }
}
