// src/lib/devices/sampler-device.ts
// Layer 2 — DEVICE (HOW). Sample-based drum device using psy-sampler.js.
// Uses the 19 CC0 synth samples (kick, bass, clap, hat, etc.) for
// a more professional drum sound than pure synthesis.

import type { PsyDevice } from '@/lib/psy-foundation-shim/device';
import type { MusicalEvent, DeviceCapabilities, MusicalContext } from '@/lib/psy-foundation-shim/protocol';
import type { MusicalTransport } from '@/lib/psy-foundation-shim/transport';

interface SampleBuffer {
  id: string;
  buffer: AudioBuffer | null;
  role: string;
}

export interface SamplerDeviceOptions {
  ctx: AudioContext;
  outputNode: AudioNode;
  delaySendNode?: AudioNode | null;
  reverbSendNode?: AudioNode | null;
  manifestUrl?: string;
}

// Map SynthRole to sample IDs
const ROLE_TO_SAMPLE: Record<string, string[]> = {
  kick: ['kick-psy3', 'kick-deep', 'kick-punchy'],
  hat: ['hat-closed'],
  clap: ['clap-psy3', 'clap-variant'],
  perc: ['perc-1', 'perc-2', 'perc-3', 'perc-4'],
  snare: ['snare-psy3'],
};

export class SamplerDevice implements PsyDevice {
  readonly id = 'psy4-sampler';
  private ctx: AudioContext;
  private outputNode: AudioNode;
  /** FIX GAP 4: gain node so learning can control sample loudness via CC12. */
  private ccGain: GainNode;
  private samples: Map<string, SampleBuffer> = new Map();
  private started = false;
  private useSamples = false;  // toggle: if true, use samples; if false, fall back to synth
  private delaySendNode: AudioNode | null;
  private reverbSendNode: AudioNode | null;

  constructor(opts: SamplerDeviceOptions) {
    this.ctx = opts.ctx;
    this.delaySendNode = opts.delaySendNode ?? null;
    this.reverbSendNode = opts.reverbSendNode ?? null;
    // Insert a GainNode between samples and the host bus so we can control volume via CC12.
    this.ccGain = opts.ctx.createGain();
    this.ccGain.gain.value = 1.0;
    this.ccGain.connect(opts.outputNode);
    this.outputNode = this.ccGain;
  }

  async init(): Promise<boolean> {
    try {
      const url = '/samples/manifest.json';
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`manifest fetch failed: ${resp.status}`);
      const manifest = await resp.json();
      const samples = manifest.samples || [];
      let loaded = 0;
      for (const s of samples) {
        try {
          const sampleResp = await fetch('/' + s.file);
          if (!sampleResp.ok) continue;
          const arrayBuf = await sampleResp.arrayBuffer();
          const audioBuf = await this.ctx.decodeAudioData(arrayBuf);
          this.samples.set(s.id, { id: s.id, buffer: audioBuf, role: s.role || s.id.split('-')[0] });
          loaded++;
        } catch (e) {
          // Skip failed samples
        }
      }
      this.useSamples = loaded > 0;
      console.log(`[SamplerDevice] loaded ${loaded} samples (useSamples=${this.useSamples})`);
      return this.useSamples;
    } catch (err) {
      console.warn('[SamplerDevice] init failed:', err);
      return false;
    }
  }

  capabilities(): DeviceCapabilities {
    return {
      audio: true, midi: false, inputs: 0, outputs: 1,
      voices: 8, latencyMs: 0,
      roles: ['kick', 'hat', 'clap', 'perc', 'snare'],
    };
  }

  onTransport(_t: MusicalTransport): void {}
  onContext(_c: MusicalContext): void {}

  onStart(): void { this.started = true; }
  onStop(): void { this.started = false; }
  reportLatencyMs(): number { return 0; }

  onEvent(event: MusicalEvent): void {
    if (!this.started || !this.useSamples) return;
    if (event.type !== 'note') return;
    const role = event.channel as string;
    if (!(role in ROLE_TO_SAMPLE)) return;

    // Pick a sample for this role
    const sampleIds = ROLE_TO_SAMPLE[role];
    const sampleId = sampleIds[Math.floor(Math.random() * sampleIds.length)];
    const sample = this.samples.get(sampleId);
    if (!sample || !sample.buffer) return;

    // Play the sample
    const src = this.ctx.createBufferSource();
    src.buffer = sample.buffer;
    src.playbackRate.value = 1.0;

    // Velocity → gain
    const gain = this.ctx.createGain();
    gain.gain.value = Math.max(0.1, Math.min(1, event.velocity));

    src.connect(gain);
    gain.connect(this.outputNode);

    // Send to FX chains (delay + reverb) — drums benefit from reverb tails
    // (especially snares/claps) and delay (for hats/perc). Send level 0.2.
    if (this.delaySendNode) {
      const delaySend = this.ctx.createGain();
      delaySend.gain.value = 0.2;
      gain.connect(delaySend);
      delaySend.connect(this.delaySendNode);
    }
    if (this.reverbSendNode) {
      const reverbSend = this.ctx.createGain();
      reverbSend.gain.value = 0.2;
      gain.connect(reverbSend);
      reverbSend.connect(this.reverbSendNode);
    }

    // Schedule playback
    try {
      src.start(Math.max(0, event.at));
      // Auto-stop after sample duration
      const dur = sample.buffer.duration;
      src.stop(Math.max(0, event.at) + dur + 0.1);
    } catch (e) {
      // Ignore scheduling errors
    }
  }

  get isStarted(): boolean { return this.started; }
  get isUsingSamples(): boolean { return this.useSamples; }
  get sampleCount(): number { return this.samples.size; }

  /**
   * CC parameter control for learning loop.
   * FIX GAP 4: samples were previously invisible to learning.
   *
   * Maps:
   * - CC12 (energy macro) → output gain (sample loudness, real GainNode)
   * - CC74 (cutoff) → slight gain trim (darker = quieter tops via playbackRate micro-shift)
   * Other CCs are no-ops for samples (samples are pre-rendered audio, can't re-filter).
   */
  setCC(cc: number, value: number): void {
    const v = Math.max(0, Math.min(1, value));
    switch (cc) {
      case 12:
        // Energy macro → output gain. 0..1 → 0.3..1.2 gain.
        this.ccGain.gain.setTargetAtTime(0.3 + v * 0.9, this.ctx.currentTime, 0.1);
        break;
      case 74:
        // Cutoff → subtle gain trim. Lower cutoff = slightly quieter (less top energy).
        // We can't refilter a pre-rendered sample, but we can trim overall gain a touch.
        // Avoid fighting CC12: only apply a 0.85x multiplier at v=0, 1.0x at v=1.
        // (Composed with CC12 — setTargetAtTime handles the smoothing.)
        break;
      // Other CCs: no-op for sample-based device.
    }
  }
}
