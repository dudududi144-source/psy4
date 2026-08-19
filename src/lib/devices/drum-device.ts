// src/lib/devices/drum-device.ts
// Layer 2 — DEVICE (HOW). Wraps public/worklets/psy4-engine-v3.js as a PsyDevice.
//
// This device is PURE HOW:
//   - No scheduler, no setInterval, no setTimeout.
//   - Never reads AudioContext.currentTime for scheduling.
//   - Receives NoteEvents with absolute `at` times, forwards to worklet.
//   - Owns the AudioWorkletNode + voice allocation (all pre-allocated in worklet).

import type { PsyDevice } from '@/lib/psy-foundation-shim/device';
import type { MusicalEvent, DeviceCapabilities, MusicalContext } from '@/lib/psy-foundation-shim/protocol';
import type { MusicalTransport } from '@/lib/psy-foundation-shim/transport';
import type { SynthRole } from '@/lib/psy-foundation-shim/roles';
import { DRUM_ROLES } from '@/lib/psy-foundation-shim/roles';

// Voice IDs in the worklet (must match psy4-engine-v3.js)
const V_KICK = 0, V_HAT = 5, V_HAT_OPEN = 6, V_CLAP = 7, V_PERC = 8,
      V_SNARE = 14;

// Map SynthRole → worklet voiceId
const ROLE_TO_VOICE: Record<SynthRole, number> = {
  kick: V_KICK,
  hat: V_HAT,
  clap: V_CLAP,
  perc: V_PERC,
  snare: V_SNARE,
  // Melodic roles don't reach this device (host routes them to melodic-device)
  bass: -1, lead: -1, acid: -1, pad: -1, keys: -1,
};

export interface DrumDeviceOptions {
  ctx: AudioContext;
  outputNode: AudioNode;     // host bus (e.g. sidechainDuck → multiband → limiter)
}

export class DrumDevice implements PsyDevice {
  readonly id = 'psy4-drums';
  private ctx: AudioContext;
  private outputNode: AudioNode;
  private node: AudioWorkletNode | null = null;
  private started = false;

  constructor(opts: DrumDeviceOptions) {
    this.ctx = opts.ctx;
    this.outputNode = opts.outputNode;
  }
  async init(): Promise<boolean> {
    try {
      await this.ctx.audioWorklet.addModule('/worklets/psy4-engine-v3.js');
      this.node = new AudioWorkletNode(this.ctx, 'psy4-engine-v3', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      // Wire stats handler — worklet sends {type:'stats', activeVoices, processMs, ...}
      this.node.port.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'stats') {
          this.lastStats = msg;
        }
      };
      this.node.connect(this.outputNode);
      return true;
    } catch (err) {
      console.error('[DrumDevice] init failed:', err);
      return false;
    }
  }

  // ── Telemetry (for diagnostics) ──
  private lastStats: { activeVoices: number; processMs: number; voiceBudget?: number } | null = null;
  getStats() { return this.lastStats; }
  get activeVoices(): number { return this.lastStats?.activeVoices ?? 0; }
  get processMs(): number { return this.lastStats?.processMs ?? 0; }

  capabilities(): DeviceCapabilities {
    return { audio: true, midi: false, inputs: 0, outputs: 1, voices: 16, latencyMs: 0, roles: [...DRUM_ROLES] };
  }

  onTransport(_t: MusicalTransport): void { /* drums don't need transport */ }
  onContext(_c: MusicalContext): void { /* drums don't need musical context */ }

  onStart(): void {
    this.started = true;
    this.node?.port.postMessage({ type: 'start' });
  }

  onStop(): void {
    this.started = false;
    this.node?.port.postMessage({ type: 'stop' });
  }

  reportLatencyMs(): number { return 0; }

  /** Routes a MusicalEvent to the worklet. Only drum roles are handled. */
  onEvent(event: MusicalEvent): void {
    if (!this.node) return;
    if (event.type !== 'note') return;
    const role = event.channel as SynthRole;
    const voiceId = ROLE_TO_VOICE[role];
    if (voiceId < 0) return; // not a drum role — ignore

    this.node.port.postMessage({
      type: 'scheduleEvent',
      at: event.at,
      voiceId,
      note: event.note,
      vel: event.velocity,
      dur: event.duration,
      param: 0,
    });
  }

  /**
   * CC parameter control for learning loop.
   * FIX GAP 4: drums were previously invisible to learning — half the mix
   * (drums are 50%+ of psytrance loudness) was uncontrollable.
   *
   * Maps:
   * - CC74 (cutoff)  → hat decay (lower cutoff = shorter, darker hats)
   * - CC71 (resonance) → hat decay extra reduction (less squeal)
   * - CC12 (energy macro) → output gain (drum loudness)
   */
  setCC(cc: number, value: number): void {
    if (!this.node) return;
    const v = Math.max(0, Math.min(1, value));
    switch (cc) {
      case 74: {
        // Lower cutoff → shorter, darker hats. Map 0..1 → 0.03..0.20s decay.
        const hatDecay = 0.03 + (1 - v) * 0.17;
        this.node.port.postMessage({
          type: 'setVoiceRecipe',
          voiceClass: 'HatVoice',
          recipe: { hatDecay },
        });
        break;
      }
      case 71: {
        // Lower resonance → slightly shorter hats (less ring). Subtle.
        const hatDecay = 0.05 + (1 - v) * 0.10;
        this.node.port.postMessage({
          type: 'setVoiceRecipe',
          voiceClass: 'HatVoice',
          recipe: { hatDecay },
        });
        break;
      }
      case 12: {
        // Energy macro → output gain. Wire through gainNode if available.
        // We don't have a per-CC gain here, so adjust via recipe saturation.
        // (SamplerDevice handles CC12 via real GainNode; drum worklet uses recipe.)
        const saturation = 0.5 + v * 0.5;  // 0.5..1.0
        this.node.port.postMessage({
          type: 'setVoiceRecipe',
          voiceClass: 'KickVoice',
          recipe: { saturation },
        });
        break;
      }
      // CC5 (glide), CC14 (delay send), CC15 (reverb send) — not applicable to drums.
    }
  }

  get workletNode(): AudioWorkletNode | null { return this.node; }
  get isStarted(): boolean { return this.started; }
}
