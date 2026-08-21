// src/lib/devices/lead-device.ts
// Layer 2 — DEVICE (HOW). Dedicated lead voice engine with REAL Moog ladder.
// Uses psy4-lead-worklet.js — PolyBLEP saw + 4-stage tanh Moog + multi-layer.

import type { PsyDevice } from '@/lib/psy-foundation-shim/device';
import type { MusicalEvent, DeviceCapabilities, MusicalContext } from '@/lib/psy-foundation-shim/protocol';
import type { MusicalTransport } from '@/lib/psy-foundation-shim/transport';

export interface LeadDeviceOptions {
  ctx: AudioContext;
  outputNode: AudioNode;
  delaySendNode?: AudioNode | null;
  reverbSendNode?: AudioNode | null;
}

export class LeadDevice implements PsyDevice {
  readonly id = 'psy4-lead';
  private ctx: AudioContext;
  private outputNode: AudioNode;
  private delaySendNode: AudioNode | null;
  private reverbSendNode: AudioNode | null;
  private node: AudioWorkletNode | null = null;
  private started = false;

  constructor(opts: LeadDeviceOptions) {
    this.ctx = opts.ctx;
    this.outputNode = opts.outputNode;
    this.delaySendNode = opts.delaySendNode ?? null;
    this.reverbSendNode = opts.reverbSendNode ?? null;
  }

  async init(): Promise<boolean> {
    try {
      await this.ctx.audioWorklet.addModule('/worklets/psy4-lead-worklet.js');
      this.node = new AudioWorkletNode(this.ctx, 'psy4-lead-engine', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      // Connect dry output to sidechainDuck (master chain)
      this.node.connect(this.outputNode);
      // Connect to FX sends (delay + reverb) so lead can send to those chains.
      // We use a fixed send level (0.3 = 30% of lead signal goes to FX).
      // This matches the melodic device's per-voice send behavior.
      if (this.delaySendNode) {
        const delaySend = this.ctx.createGain();
        delaySend.gain.value = 0.3;
        this.node.connect(delaySend);
        delaySend.connect(this.delaySendNode);
      }
      if (this.reverbSendNode) {
        const reverbSend = this.ctx.createGain();
        reverbSend.gain.value = 0.3;
        this.node.connect(reverbSend);
        reverbSend.connect(this.reverbSendNode);
      }
      console.log('[LeadDevice] initialized — real Moog ladder + PolyBLEP + FX sends');
      return true;
    } catch (err) {
      console.error('[LeadDevice] init failed:', err);
      return false;
    }
  }

  capabilities(): DeviceCapabilities {
    return { audio: true, midi: false, inputs: 0, outputs: 1, voices: 8, latencyMs: 0, roles: ['lead', 'acid'] };
  }

  onTransport(_t: MusicalTransport): void {}
  onContext(_c: MusicalContext): void {}

  onStart(): void {
    this.started = true;
    this.node?.port.postMessage({ type: 'start' });
  }

  onStop(): void {
    this.started = false;
    this.node?.port.postMessage({ type: 'stop' });
  }

  reportLatencyMs(): number { return 0; }

  onEvent(event: MusicalEvent): void {
    if (!this.node) return;
    if (event.type !== 'note') return;
    const role = event.channel as string;
    if (role !== 'lead' && role !== 'acid') return;
    
    if (event.velocity === 0) {
      // Note off
      this.node.port.postMessage({
        type: 'scheduleEvent',
        at: event.at,
        note: event.note,
        vel: 0,
        dur: 0,
        release: true,
      });
    } else {
      // Note on
      this.node.port.postMessage({
        type: 'scheduleEvent',
        at: event.at,
        note: event.note,
        vel: event.velocity,
        dur: event.duration > 0 ? event.duration : 0.5,
        release: false,
      });
    }
  }

  setCC(cc: number, value: number): void {
    this.node?.port.postMessage({ type: 'setCC', cc, value });
  }

  get workletNode(): AudioWorkletNode | null { return this.node; }
  get isStarted(): boolean { return this.started; }
}
