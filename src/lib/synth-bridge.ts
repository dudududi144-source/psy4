/**
 * SynthBridge — Adapter between PSY4's composition-worker output and the
 * psysynth PsyDevice contract.
 *
 * PSY4's composition-worker emits events as a flat Float64Array:
 *   [at, note, velocity, duration, voiceId, param] × N
 *
 * psysynth's PsyDevice contract consumes NoteEvents:
 *   { type:'note', note, velocity, duration, channel:role, at }
 *
 * This bridge:
 *   1. Wraps a DeviceHost + InMemoryChannel (foundation contract)
 *   2. Maps PSY4 VoiceId → canonical SynthRole (bass/lead/arp/pad/stab/pluck/keys)
 *   3. Lazily loads the psysynth bundle from /psysynth.js
 *   4. Publishes NoteEvents to the DeviceHost
 *
 * DRUM voices (kick/snare/hat/clap/perc/shaker) are NOT routed — they stay
 * on PSY4's AudioWorklet (psy4-engine.js). Only melodic voices go to psysynth.
 *
 * Lifecycle:
 *   const bridge = new SynthBridge({ audioContext, outputNode, ... })
 *   await bridge.init()
 *   bridge.publishNote(at, voiceId, midiNote, velocity, duration)
 *   bridge.publishTransport(snap)
 *   bridge.publishContext({ style, key, rootPc, scale, energy, section })
 *   bridge.dispose()
 */

import { DeviceHost, InMemoryChannel } from '@/lib/psy-foundation-shim';
import type { NoteEvent, MusicalContext, MusicalTransport } from '@/lib/psy-foundation-shim';
import { VOICE, type VoiceId } from '@/lib/studio/engine/engineWorklet';

// Canonical psysynth roles (must match SYNTH_ROLES in psysynth.js bundle)
export type SynthRole = 'bass' | 'lead' | 'arp' | 'pad' | 'stab' | 'pluck' | 'keys';

/**
 * Map PSY4 VoiceId → psysynth SynthRole.
 * Returns null for drum/FX voices (they stay on PSY4's worklet).
 *
 * Rationale (from ARCHITECTURE-STYLE.md):
 *   - BASS (1) → bass (303-style acid / rolling offbeat)
 *   - LEAD (2) → lead (full-on squelch)
 *   - ACID (3) → lead (acid is a lead character in psytrance)
 *   - PAD (4) → pad (atmospheric break pads)
 *   - TEXTURE (10) → pad (texture is a pad variant)
 *   - FM (17) → lead (FM is a melodic lead)
 *   - WAVETABLE (19) → lead (wavetable is a melodic lead)
 *   - KICK/SNARE/HAT/CLAP/PERC/SHAKER/RISER/IMPACT/SWEEP/ZAP/BLIP/DOWNLIFTER → null (drums/FX)
 */
export function voiceIdToRole(voiceId: VoiceId): SynthRole | null {
  switch (voiceId) {
    case VOICE.BASS: return 'bass';
    case VOICE.LEAD: return 'lead';
    case VOICE.ACID: return 'lead';
    case VOICE.PAD: return 'pad';
    case VOICE.TEXTURE: return 'pad';
    // Drums + FX — NOT routed to psysynth (stay on PSY4's worklet)
    case VOICE.KICK:
    case VOICE.SNARE:
    case VOICE.HAT:
    case VOICE.HAT_OPEN:
    case VOICE.CLAP:
    case VOICE.PERC:
    case VOICE.SHAKER:
    case VOICE.RISER:
    case VOICE.IMPACT:
    case VOICE.SWEEP:
      return null;
    default:
      return null;
  }
}

export interface SynthBridgeOptions {
  audioContext: AudioContext;
  outputNode: AudioNode;        // PSY4's engineBus (goes through master chain)
  delaySendNode?: AudioNode | null;
  reverbSendNode?: AudioNode | null;
  maxVoices?: number;            // default 16
  seed?: number;                 // default 1 (deterministic)
  patchManifestUrl?: string;    // default '/patches/manifest.json'
  styleBanks?: any[];
}

export interface SynthBridgeDiagnostics {
  eventsPublished: number;
  eventsRoutedToSynth: number;
  eventsDroppedDrum: number;     // drum voices not routed (expected)
  eventsDroppedStale: number;
  deviceDiagnostics?: any;
  loaded: boolean;
}

export class SynthBridge {
  readonly host: DeviceHost;
  private channel: InMemoryChannel;
  private device: any = null;            // SynthDevice instance (dynamic import)
  private bundle: any = null;            // { device, load, dispose }
  private loaded = false;
  private opts: SynthBridgeOptions;

  // Counters
  private eventsPublished = 0;
  private eventsRoutedToSynth = 0;
  private eventsDroppedDrum = 0;
  private eventsDroppedStale = 0;

  constructor(opts: SynthBridgeOptions) {
    this.opts = opts;
    this.channel = new InMemoryChannel('psy4-synth');
    this.host = new DeviceHost(this.channel);
  }

  /**
   * Lazily load the psysynth bundle and register the device.
   * Must be called after AudioContext is running.
   *
   * Loads /psysynth.js via a <script> tag (not dynamic import) because
   * webpack/turbopack can't statically resolve a runtime path like '/psysynth.js'.
   * The script sets window.createSynthDevice which we read after load.
   */
  async init(): Promise<void> {
    if (this.loaded) return;

    // Load the bundle via blob URL (ESM dynamic import)
    const mod = await this.loadBundleViaBlob();
    const createSynthDevice = mod.createSynthDevice;
    if (typeof createSynthDevice !== 'function') {
      throw new Error('SynthBridge: psysynth.js did not export createSynthDevice');
    }

    this.bundle = createSynthDevice({
      audioContext: this.opts.audioContext,
      outputNode: this.opts.outputNode,
      delaySendNode: this.opts.delaySendNode ?? null,
      reverbSendNode: this.opts.reverbSendNode ?? null,
      maxVoices: this.opts.maxVoices ?? 16,
      seed: this.opts.seed ?? 1,
      patchManifestUrl: this.opts.patchManifestUrl ?? '/patches/manifest.json',
      styleBanks: this.opts.styleBanks,
    });
    this.device = this.bundle.device;

    // Register with DeviceHost (register() already calls onStart)
    this.host.register(this.device);
    await this.bundle.load();
    this.loaded = true;
  }

  /**
   * Load /psysynth.js (ESM bundle) by fetching it as text and creating a
   * blob URL, then dynamic-importing the blob URL. This avoids bundler
   * static analysis (which can't resolve runtime paths like '/psysynth.js')
   * and works correctly with ESM `export` statements.
   *
   * Uses `new Function` to hide the dynamic import from Turbopack/webpack
   * static analysis (the vite-ignore comment is not respected by Turbopack).
   *
   * Caches the loaded module on window.__psysynthModule for re-use.
   */
  private async loadBundleViaBlob(): Promise<any> {
    const w = window as any;
    if (w.__psysynthModule) return w.__psysynthModule;
    const resp = await fetch('/psysynth.js');
    if (!resp.ok) throw new Error(`Failed to fetch /psysynth.js: ${resp.status}`);
    const code = await resp.text();
    const blob = new Blob([code], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    // Hide the dynamic import from bundler static analysis via new Function.
    // Turbopack parses `import(...)` calls and tries to resolve them at build time;
    // wrapping in new Function makes the call invisible to the parser.
    const dynamicImport = new Function('u', 'return import(u)') as (u: string) => Promise<any>;
    const mod = await dynamicImport(url);
    w.__psysynthModule = mod;
    return mod;
  }

  /**
   * Publish a note event from PSY4's composition-worker.
   * voiceId determines routing: melodic → psysynth, drum → drop (stays on worklet).
   */
  publishNote(
    at: number,
    voiceId: VoiceId,
    note: number,
    velocity: number,
    duration: number,
  ): void {
    this.eventsPublished++;

    // Route drum/FX voices to null (they stay on PSY4's AudioWorklet)
    const role = voiceIdToRole(voiceId);
    if (role === null) {
      this.eventsDroppedDrum++;
      return;
    }

    // Stale check (50ms window — matches psysynth's note-router)
    const now = this.opts.audioContext.currentTime;
    if (at < now - 0.05) {
      this.eventsDroppedStale++;
      return;
    }

    // Clamp pitch to 0..127
    const clampedNote = Math.max(0, Math.min(127, Math.round(note)));
    const clampedVel = Math.max(0, Math.min(1, velocity));
    const clampedDur = Math.max(0, duration);

    const ev: NoteEvent = {
      type: 'note',
      note: clampedNote,
      velocity: clampedVel,
      duration: clampedDur,
      channel: role,
      at,
    };

    this.host.publish(ev);
    this.eventsRoutedToSynth++;
  }

  /**
   * Publish transport snapshot (BPM/beat/bar) — for tempo-locked LFOs.
   */
  publishTransport(snap: {
    bpm: number;
    beat: number;
    bar: number;
    revision: number;
  }): void {
    const now = this.opts.audioContext.currentTime;
    const transport: MusicalTransport = {
      bpm: snap.bpm,
      beat: snap.beat,
      bar: snap.bar,
      beatsPerBar: 4,
      beatTime: now,
      barTime: now,
      phase: 0,
      barPhase: 0,
      confidence: 1,
      locked: true,
      revision: snap.revision,
      origin: { audioTime: now, beatIndex: snap.beat, bpm: snap.bpm },
      lastObservationAgo: 0,
      observationCount: 1,
    };
    this.host.pushTransport(transport, now * 1000);
  }

  /**
   * Publish musical context (style/key/scale/energy) — for patch bank selection.
   */
  publishContext(ctx: {
    style?: string;
    key?: string;
    rootPc?: number;
    scale?: string;
    energy?: number;
    section?: string;
  }): void {
    const musicalContext: MusicalContext = {
      key: ctx.key ?? 'C',
      rootPc: ctx.rootPc ?? 0,
      scale: ctx.scale ?? 'minor',
      energy: ctx.energy ?? 0.5,
      style: (ctx.style ?? 'FULL-ON').toUpperCase(),
      section: ctx.section ?? 'groove',
      beatsPerBar: 4,
    };
    this.host.pushContext(musicalContext);
  }

  /**
   * Fast-release all voices (called on stop).
   */
  panic(): void {
    if (this.device && this.loaded) {
      this.device.onStop?.();
    }
  }

  /**
   * Restart the device after panic (called on play).
   */
  resume(): void {
    if (this.device && this.loaded) {
      this.device.onStart?.();
    }
  }

  /**
   * Get diagnostics for UI display.
   */
  getDiagnostics(): SynthBridgeDiagnostics {
    let deviceDiagnostics: any = undefined;
    if (this.device && this.loaded) {
      try {
        deviceDiagnostics = this.device.getDiagnostics?.();
      } catch {
        // diagnostics are best-effort
      }
    }
    return {
      eventsPublished: this.eventsPublished,
      eventsRoutedToSynth: this.eventsRoutedToSynth,
      eventsDroppedDrum: this.eventsDroppedDrum,
      eventsDroppedStale: this.eventsDroppedStale,
      deviceDiagnostics,
      loaded: this.loaded,
    };
  }

  /**
   * Set a parameter via MIDI CC (for MIDI-learn).
   */
  setParameterByCC(cc: number, value: number): boolean {
    if (!this.device || !this.loaded) return false;
    return this.device.setParameterByCC?.(cc, value) ?? false;
  }

  /**
   * Start MIDI-learn for a parameter.
   */
  midiLearnStart(param: string): void {
    this.device?.midiLearnStart?.(param);
  }

  midiLearnCancel(): void {
    this.device?.midiLearnCancel?.();
  }

  /**
   * Full dispose — disconnect device, clear channel.
   */
  dispose(): void {
    if (this.bundle) {
      try { this.bundle.dispose?.(); } catch {}
    }
    this.device = null;
    this.bundle = null;
    this.loaded = false;
  }
}
