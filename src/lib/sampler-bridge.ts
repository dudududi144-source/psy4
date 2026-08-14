/**
 * PSY4 → Sampler Bridge.
 *
 * This is the SMALLEST adapter that connects PSY4's composition output to a
 * canonical PsyDevice (e.g. the PSY Sampler Device) via the foundation's
 * DeviceHost + NoteEvent + MusicalTransport contracts.
 *
 * WHY THIS EXISTS:
 *   PSY4's PsyLive.scheduleStep() produces NotePlan.ScheduledNote objects
 *   {step, voice, midi, velocity} and dispatches them via switch(note.voice)
 *   to internal synth methods (this.kick/hat/bass/lead). This is a closed loop.
 *
 *   The foundation's PsyDevice contract consumes NoteEvent
 *   {type:'note', note, velocity, duration, channel, at} via DeviceHost.publish().
 *
 *   This bridge converts ScheduledNote → NoteEvent and publishes it to any
 *   registered PsyDevice. PSY4's existing synth path continues unchanged —
 *   the sampler plays IN PARALLEL (additive, not replacing).
 *
 * MINIMAL FOUNDATION CONTRACTS:
 *   The foundation (psy-foundation) is a workspace monorepo that cannot be
 *   consumed as an npm package today (workspace:* deps). This file defines
 *   the MINIMAL contracts needed for device integration, inline.
 *
 *   When @psy-foundation/* packages are published to npm, this file should
 *   import from them and the inline definitions should be removed.
 *
 *   The contracts are VERBATIM from psy-foundation/packages/{device-sdk,protocol,transport}/src/.
 *   SHIM_VERSION: pinned to psy-foundation commit 4ae95d3 (2026-08-13).
 */

// ─── Minimal foundation contracts (verbatim from psy-foundation) ─────────────

export interface MusicalTransport {
  bpm: number
  beat: number
  bar: number
  beatsPerBar: number
  beatTime: number
  barTime: number
  phase: number
  barPhase: number
  confidence: number
  locked: boolean
  revision: number
  origin: { audioTime: number; beatIndex: number; bpm: number }
  lastObservationAgo: number
  observationCount: number
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

export interface NoteEvent {
  type: 'note'
  note: number
  velocity: number
  duration: number
  channel: string
  at: number
}

export type MusicalEvent = NoteEvent

export interface PsyDevice {
  id: string
  capabilities(): DeviceCapabilities
  onTransport(transport: MusicalTransport): void
  onContext(context: MusicalContext): void
  onEvent(event: MusicalEvent): void
  onStart?(): void
  onStop?(): void
  reportLatencyMs?(): number
}

// ─── Minimal DeviceHost (verbatim logic from psy-foundation) ─────────────────

type ChannelListener = (event: MusicalEvent) => void

export class InMemoryChannel {
  readonly name: string
  private readonly listeners = new Set<ChannelListener>()
  private closed = false
  constructor(name = 'psy4-bridge') { this.name = name }
  subscribe(listener: ChannelListener): () => void {
    if (this.closed) throw new Error(`Channel "${this.name}" is closed`)
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  publish(event: MusicalEvent): void {
    if (this.closed) return
    for (const l of Array.from(this.listeners)) l(event)
  }
  close(): void { this.closed = true; this.listeners.clear() }
}

export class DeviceHost {
  private readonly devices = new Map<string, PsyDevice>()
  private lastTransportRevision: number | null = null
  constructor(private readonly channel: InMemoryChannel) {
    this.channel.subscribe((event) => {
      for (const device of this.devices.values()) device.onEvent(event)
    })
  }
  register(device: PsyDevice): void {
    if (this.devices.has(device.id)) throw new Error(`Device already registered: ${device.id}`)
    this.devices.set(device.id, device)
    device.onStart?.()
  }
  unregister(id: string): void {
    const device = this.devices.get(id)
    if (!device) return
    device.onStop?.()
    this.devices.delete(id)
  }
  pushTransport(transport: MusicalTransport): void {
    if (this.lastTransportRevision === transport.revision) return
    this.lastTransportRevision = transport.revision
    for (const device of this.devices.values()) device.onTransport(transport)
  }
  pushContext(context: MusicalContext): void {
    for (const device of this.devices.values()) device.onContext(context)
  }
  publish(event: MusicalEvent): void { this.channel.publish(event) }
  dispose(): void {
    for (const device of Array.from(this.devices.values())) device.onStop?.()
    this.devices.clear()
    this.channel.close()
  }
  get deviceCount(): number { return this.devices.size }
}

// ─── PSY4 → NoteEvent adapter ────────────────────────────────────────────────

function voiceToChannel(voice: 'kick' | 'bass' | 'lead' | 'hat', isOpenHat: boolean): string {
  switch (voice) {
    case 'kick': return 'kick'
    case 'bass': return 'bass'
    case 'lead': return 'lead'
    case 'hat': return isOpenHat ? 'hat-open' : 'hat-closed'
  }
}

export class SamplerBridge {
  private readonly host: DeviceHost
  private readonly channel: InMemoryChannel

  constructor() {
    this.channel = new InMemoryChannel('psy4-sampler-bridge')
    this.host = new DeviceHost(this.channel)
  }

  register<T extends PsyDevice>(device: T): T {
    this.host.register(device)
    return device
  }

  unregister(id: string): void {
    this.host.unregister(id)
  }

  publishNote(
    time: number,
    note: { voice: 'kick' | 'bass' | 'lead' | 'hat'; midi: number | null; velocity: number },
    isOpenHat: boolean,
    stepDur: number
  ): void {
    const channel = voiceToChannel(note.voice, isOpenHat)
    const event: NoteEvent = {
      type: 'note',
      note: note.midi ?? 60,
      velocity: note.velocity,
      duration: stepDur * 0.9,
      channel,
      at: time,
    }
    this.host.publish(event)
  }

  publishTransport(snap: MusicalTransport): void {
    this.host.pushTransport(snap)
  }

  publishContext(ctx: MusicalContext): void {
    this.host.pushContext(ctx)
  }

  get deviceCount(): number {
    return this.host.deviceCount
  }

  dispose(): void {
    this.host.dispose()
  }
}
