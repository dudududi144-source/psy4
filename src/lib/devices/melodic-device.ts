// src/lib/devices/melodic-device.ts
// Layer 2 — DEVICE (HOW). Wraps public/psysynth.js as a PsyDevice.
//
// This device is PURE HOW:
//   - No scheduler, no setInterval, no setTimeout.
//   - Receives NoteEvents with absolute `at` times, forwards to psysynth.
//   - psysynth handles voice allocation internally (16 pre-allocated voices).
//
// The bundle is loaded dynamically from /psysynth.js (same-origin, 21KB).

import type { PsyDevice } from '@/lib/psy-foundation-shim/device';
import type { MusicalEvent, DeviceCapabilities, MusicalContext } from '@/lib/psy-foundation-shim/protocol';
import type { MusicalTransport } from '@/lib/psy-foundation-shim/transport';
import type { SynthRole } from '@/lib/psyLive4/types';
import { MELODIC_ROLES } from '@/lib/psyLive4/types';

// Type-only view of the psysynth bundle (the actual JS is minified ESM).
interface PsynSynthBundle {
  device: {
    onEvent(e: any): void;
    onTransport(t: any): void;
    onContext(c: any): void;
    onStart(): void;
    onStop(): void;
    capabilities(): DeviceCapabilities;
    reportLatencyMs(): number;
    setParameterByCC(cc: number, value: number): boolean;
    patches: { count(): number; resolve(role: string): any; setStyle(s: string): void };
    pool: { activeCount(): number };
  };
  load(): Promise<boolean>;
  dispose(): void;
}

export interface MelodicDeviceOptions {
  ctx: AudioContext;
  outputNode: AudioNode;          // host bus
  delaySendNode?: AudioNode | null;   // optional FX send
  reverbSendNode?: AudioNode | null;  // optional FX send
  patchManifestUrl?: string;     // default: /patches/manifest.json
  styleBanksUrl?: string;        // default: /patches/style-banks.json
  maxVoices?: number;
  seed?: number;
}

export class MelodicDevice implements PsyDevice {
  readonly id = 'psy4-melodic';
  private ctx: AudioContext;
  private outputNode: AudioNode;
  private delaySendNode: AudioNode | null;
  private reverbSendNode: AudioNode | null;
  private patchManifestUrl: string;
  private styleBanksUrl: string;
  private maxVoices: number;
  private seed: number;
  private bundle: PsynSynthBundle | null = null;
  private device: PsynSynthBundle['device'] | null = null;
  private started = false;

  constructor(opts: MelodicDeviceOptions) {
    this.ctx = opts.ctx;
    this.outputNode = opts.outputNode;
    this.delaySendNode = opts.delaySendNode ?? null;
    this.reverbSendNode = opts.reverbSendNode ?? null;
    this.patchManifestUrl = opts.patchManifestUrl ?? '/patches/manifest.json';
    this.styleBanksUrl = opts.styleBanksUrl ?? '/patches/style-banks.json';
    this.maxVoices = opts.maxVoices ?? 16;
    this.seed = opts.seed ?? 1;
  }

  async init(): Promise<boolean> {
    try {
      // Load the psysynth ESM bundle from /public/psysynth.js.
      // Turbopack tries to statically resolve `import(url)` even with
      // ignore comments, so we use `new Function()` to hide the dynamic
      // import from the bundler. This is a well-known Next.js pattern for
      // loading runtime ESM assets.
      const resp = await fetch('/psysynth.js');
      if (!resp.ok) throw new Error(`psysynth fetch failed: ${resp.status}`);
      const src = await resp.text();
      const blob = new Blob([src], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      // Hide dynamic import from Turbopack static analysis:
      const dynImport = new Function('u', 'return import(u)');
      const mod = await dynImport(url);
      URL.revokeObjectURL(url);
      const createSynthDevice = mod.createSynthDevice ?? mod.default?.createSynthDevice;
      if (typeof createSynthDevice !== 'function') {
        throw new Error('psysynth bundle missing createSynthDevice export');
      }
      this.bundle = createSynthDevice({
        audioContext: this.ctx,
        outputNode: this.outputNode,
        delaySendNode: this.delaySendNode,
        reverbSendNode: this.reverbSendNode,
        patchManifestUrl: this.patchManifestUrl,
        maxVoices: this.maxVoices,
        seed: this.seed,
      }) as PsynSynthBundle;
      // Load the manifest + style banks
      await this.bundle.load();
      // Register style banks if present
      try {
        const resp = await fetch(this.styleBanksUrl);
        if (resp.ok) {
          const banks = await resp.json();
          // psysynth exposes registerBank via the patches library, but the
          // minified bundle's device.patches may not expose it directly.
          // We set the active style via onContext later.
          (this.bundle as any).styleBanks = banks;
        }
      } catch { /* non-fatal */ }
      this.device = this.bundle.device;
      return true;
    } catch (err) {
      console.error('[MelodicDevice] init failed:', err);
      return false;
    }
  }

  capabilities(): DeviceCapabilities {
    if (this.device) return this.device.capabilities();
    return { audio: true, midi: false, inputs: 0, outputs: 1, voices: this.maxVoices, latencyMs: 0, roles: [...MELODIC_ROLES] };
  }

  onTransport(t: MusicalTransport): void { this.device?.onTransport(t as any); }
  onContext(c: MusicalContext): void {
    this.device?.onContext(c as any);
    // Apply style banks if loaded
    const banks = (this.bundle as any)?.styleBanks;
    if (banks && Array.isArray(banks) && c.style) {
      const bank = banks.find((b: any) => b.style.toUpperCase() === String(c.style).toUpperCase().replace('-', '_'));
      if (bank) {
        (this.device as any)?.patches?.registerBank?.(bank);
      }
    }
  }

  onStart(): void {
    this.started = true;
    this.device?.onStart();
  }

  onStop(): void {
    this.started = false;
    this.device?.onStop();
  }

  reportLatencyMs(): number { return this.device?.reportLatencyMs?.() ?? 0; }

  /** Routes a MusicalEvent to psysynth. Only melodic roles are handled. */
  onEvent(event: MusicalEvent): void {
    if (!this.device) return;
    if (event.type !== 'note') return;
    const role = event.channel as SynthRole;
    if (!MELODIC_ROLES.has(role)) return; // not a melodic role — ignore
    this.device.onEvent(event);
  }

  /** CC parameter control (for learning loop + style leadCutoff). */
  setParameterByCC(cc: number, value: number): boolean {
    return this.device?.setParameterByCC(cc, value) ?? false;
  }

  get isStarted(): boolean { return this.started; }
  get patchesLoaded(): number { return this.device?.patches.count() ?? 0; }
  get voicesActive(): number { return this.device?.pool?.activeCount?.() ?? 0; }
  get activeStyle(): string | null { return (this.device as any)?.context?.style ?? null; }

  dispose(): void {
    this.bundle?.dispose();
    this.bundle = null;
    this.device = null;
  }
}
