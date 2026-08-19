// VERBATIM SHIM from psy-foundation/packages/device-sdk/src/host.ts
// Source: psy-audit/psy-foundation/packages/device-sdk/src/host.ts (lines 1-92)
// Do not modify. Replace with `import { DeviceHost } from '@psy-foundation/device-sdk'`
// when integrated into the canonical workspace.

import type {
  Channel,
  DeviceCapabilities,
  MusicalContext,
  MusicalEvent,
} from './protocol'
import type { MusicalTransport } from './transport'
import type { PsyDevice } from './device'

export interface DeviceHostOptions {
  transportMinIntervalMs?: number
  transportDedupByRevision?: boolean
}

export class DeviceHost {
  private readonly devices = new Map<string, PsyDevice>()
  private readonly channel: Channel
  private readonly opts: Required<DeviceHostOptions>
  private channelUnsub: (() => void) | null = null
  private lastTransportRevision: number | null = null
  private lastTransportPushAt = 0

  constructor(channel: Channel, opts: DeviceHostOptions = {}) {
    this.channel = channel
    this.opts = {
      transportMinIntervalMs: opts.transportMinIntervalMs ?? 0,
      transportDedupByRevision: opts.transportDedupByRevision ?? true,
    }
    this.startEventRouting()
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

  list(): Array<{ id: string; capabilities: DeviceCapabilities }> {
    return Array.from(this.devices.values()).map((d) => ({
      id: d.id,
      capabilities: d.capabilities(),
    }))
  }

  findByRole(role: string): PsyDevice[] {
    return Array.from(this.devices.values()).filter((d) => d.capabilities().roles.includes(role))
  }

  pushTransport(transport: MusicalTransport, nowMs: number): void {
    if (this.opts.transportDedupByRevision) {
      if (this.lastTransportRevision === transport.revision) return
      this.lastTransportRevision = transport.revision
    }
    if (this.opts.transportMinIntervalMs > 0) {
      if (nowMs - this.lastTransportPushAt < this.opts.transportMinIntervalMs) return
      this.lastTransportPushAt = nowMs
    }
    for (const device of this.devices.values()) device.onTransport(transport)
  }

  pushContext(context: MusicalContext): void {
    for (const device of this.devices.values()) device.onContext(context)
  }

  publish(event: MusicalEvent): void {
    this.channel.publish(event)
  }

  dispose(): void {
    for (const device of Array.from(this.devices.values())) device.onStop?.()
    this.devices.clear()
    this.channelUnsub?.()
    this.channelUnsub = null
  }

  get deviceCount(): number {
    return this.devices.size
  }

  private startEventRouting(): void {
    this.channelUnsub = this.channel.subscribe((event: MusicalEvent) => {
      // FIX: catch per-device errors so one bad device doesn't starve the rest.
      for (const device of this.devices.values()) {
        try {
          device.onEvent(event)
        } catch (err) {
          console.error(`[device-host] Device "${device.id}" onEvent error:`, err)
        }
      }
    })
  }
}
