/**
 * AudioContext shim for headless DSP testing.
 *
 * Goal: let us exercise the Web Audio API surface used by PSY4's DSP and
 * routing code WITHOUT a real audio device, WITHOUT a browser.
 *
 * What this shim does:
 *   - Creates AudioNode-like objects with connect()/disconnect()/start()/stop()
 *   - Records every connect() call as an edge in a routing graph (for audit)
 *   - Allows AnalyserNode to be "fed" synthetic Float32 time-domain data
 *     (and Uint8 frequency data) so DSP code under test sees real samples
 *   - Tracks node creation counts (for leak detection)
 *   - Supports setValueAtTime / exponentialRampToValueAtTime / setTargetAtTime
 *     by storing the latest value (we don't need full automation curves here)
 *
 * What this shim does NOT do:
 *   - Actually render audio to a destination
 *   - Maintain perfect sample-accurate timing
 *
 * That is acceptable: the audit's "headless browser has no sound card" rule
 * explicitly says output is the ONLY thing that may be skipped; DSP, analysis,
 * PLL, scheduler, MelodyObserver must be testable with injected fixtures.
 */

type NodeKind =
  | 'oscillator' | 'gain' | 'biquad' | 'analyser' | 'compressor'
  | 'waveshaper' | 'convolver' | 'delay' | 'bufferSource' | 'mediaElementSource';

interface GraphEdge {
  from: string;
  to: string;
  port?: string;
}

let NODE_SEQ = 0;

export class AudioNodeShim {
  id: string;
  kind: NodeKind;
  ctx: AudioContextShim;
  connections: AudioNodeShim[] = [];
  // Parameter-like field (latest value wins; ramps collapse to latest setValueAtTime)
  gain: ParamShim;
  frequency: ParamShim;
  Q: ParamShim;
  detune: ParamShim;
  delayTime: ParamShim;
  threshold: ParamShim;
  knee: ParamShim;
  ratio: ParamShim;
  attack: ParamShim;
  release: ParamShim;
  // Properties
  type: any = 'sine';
  fftSize = 1024;
  smoothingTimeConstant = 0.7;
  frequencyBinCount = 512;
  curve: Float32Array | null = null;
  oversample: 'none' | '2x' | '4x' = 'none';
  buffer: any = null;
  loop = false;
  // State
  started = false;
  stopped = false;
  // For analyser: injected data
  private injectedFreq: Uint8Array | null = null;
  private injectedTime: Float32Array | null = null;

  constructor(kind: NodeKind, ctx: AudioContextShim) {
    this.kind = kind;
    this.ctx = ctx;
    this.id = `${kind}_${NODE_SEQ++}`;
    const make = () => new ParamShim();
    this.gain = make();
    this.frequency = make();
    this.Q = make();
    this.detune = make();
    this.delayTime = make();
    this.threshold = make();
    this.knee = make();
    this.ratio = make();
    this.attack = make();
    this.release = make();
    ctx.registerNode(this);
  }

  connect(dest: AudioNodeShim, port?: any): AudioNodeShim {
    this.connections.push(dest);
    this.ctx.addEdge({ from: this.id, to: dest.id, port });
    return dest;
  }
  disconnect(): void {
    for (const c of this.connections) {
      this.ctx.removeEdgesFrom(this.id);
    }
    this.connections = [];
  }

  start(when?: number): void { this.started = true; this.ctx.noteStart(this, when ?? this.ctx.currentTime); }
  stop(when?: number): void { this.stopped = true; this.ctx.noteStop(this, when ?? this.ctx.currentTime); }

  // Analyser API
  getByteFrequencyData(arr: Uint8Array): void {
    if (this.injectedFreq && this.injectedFreq.length === arr.length) {
      arr.set(this.injectedFreq);
    } else {
      arr.fill(0);
    }
  }
  getFloatFrequencyData(arr: Float32Array): void {
    if (this.injectedFreq) {
      for (let i = 0; i < arr.length; i++) arr[i] = (this.injectedFreq[i] / 255) * 100 - 100;
    } else {
      arr.fill(-100);
    }
  }
  getByteTimeDomainData(arr: Uint8Array): void {
    if (this.injectedTime) {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.max(0, Math.min(255, Math.round(128 + this.injectedTime[i] * 127)));
      }
    } else {
      arr.fill(128);
    }
  }
  getFloatTimeDomainData(arr: Float32Array): void {
    if (this.injectedTime && this.injectedTime.length === arr.length) {
      arr.set(this.injectedTime);
    } else {
      arr.fill(0);
    }
  }

  // Test fixture injection
  injectFrequencyData(data: Uint8Array): void {
    this.injectedFreq = data;
    // Keep bin count consistent
    this.frequencyBinCount = data.length;
    this.fftSize = data.length * 2;
  }
  injectTimeDomainData(data: Float32Array): void {
    this.injectedTime = data;
    this.fftSize = data.length;
    this.frequencyBinCount = data.length / 2;
  }
}

export class ParamShim {
  value: number = 0;
  private automation: { time: number; type: string; value: number; extra?: number }[] = [];
  setValueAtTime(v: number, t: number): void { this.value = v; this.automation.push({ time: t, type: 'setValueAtTime', value: v }); }
  linearRampToValueAtTime(v: number, t: number): void { this.value = v; this.automation.push({ time: t, type: 'linearRamp', value: v }); }
  exponentialRampToValueAtTime(v: number, t: number): void { this.value = Math.max(1e-9, v); this.automation.push({ time: t, type: 'exponentialRamp', value: v }); }
  setTargetAtTime(v: number, t: number, tc: number): void { this.value = v; this.automation.push({ time: t, type: 'setTarget', value: v, extra: tc }); }
  cancelScheduledValues(t: number): void { this.automation = this.automation.filter(a => a.time < t); }
  cancelAndHoldAtTime(t: number): void { this.automation = this.automation.filter(a => a.time <= t); }
}

export class AudioContextShim {
  sampleRate = 44100;
  currentTime = 0;
  state: 'running' | 'suspended' | 'closed' = 'running';
  destination: AudioNodeShim;
  nodes: AudioNodeShim[] = [];
  edges: GraphEdge[] = [];
  // Track note start/stop for scheduler audit
  noteEvents: { nodeId: string; type: 'start' | 'stop'; when: number }[] = [];

  constructor() {
    this.destination = new AudioNodeShim('gain', this);
    this.destination.id = 'destination';
  }

  private nextKind(kind: NodeKind): AudioNodeShim { return new AudioNodeShim(kind, this); }

  createOscillator(): AudioNodeShim { return this.nextKind('oscillator'); }
  createGain(): AudioNodeShim { return this.nextKind('gain'); }
  createBiquadFilter(): AudioNodeShim { return this.nextKind('biquad'); }
  createAnalyser(): AudioNodeShim { return this.nextKind('analyser'); }
  createDynamicsCompressor(): AudioNodeShim { return this.nextKind('compressor'); }
  createWaveShaper(): AudioNodeShim { return this.nextKind('waveshaper'); }
  createConvolver(): AudioNodeShim { return this.nextKind('convolver'); }
  createDelay(maxDelay: number = 1): AudioNodeShim { return this.nextKind('delay'); }
  createBufferSource(): AudioNodeShim { return this.nextKind('bufferSource'); }
  createMediaElementSource(el: any): AudioNodeShim { return this.nextKind('mediaElementSource'); }

  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferShim {
    return new AudioBufferShim(channels, length, sampleRate);
  }

  registerNode(n: AudioNodeShim): void { this.nodes.push(n); }
  addEdge(e: GraphEdge): void { this.edges.push(e); }
  removeEdgesFrom(id: string): void { this.edges = this.edges.filter(e => e.from !== id); }
  noteStart(n: AudioNodeShim, when: number): void { this.noteEvents.push({ nodeId: n.id, type: 'start', when }); }
  noteStop(n: AudioNodeShim, when: number): void { this.noteEvents.push({ nodeId: n.id, type: 'stop', when }); }

  tick(dt: number): void { this.currentTime += dt; }
  resume(): Promise<void> { this.state = 'running'; return Promise.resolve(); }
  suspend(): Promise<void> { this.state = 'suspended'; return Promise.resolve(); }
  close(): Promise<void> { this.state = 'closed'; return Promise.resolve(); }

  // Snapshot of routing graph (for audit)
  graphSnapshot(): { nodes: { id: string; kind: NodeKind }[]; edges: GraphEdge[] } {
    return {
      nodes: this.nodes.map(n => ({ id: n.id, kind: n.kind })),
      edges: [...this.edges],
    };
  }
}

export class AudioBufferShim {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  private data: Float32Array[];
  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = [];
    for (let i = 0; i < channels; i++) this.data.push(new Float32Array(length));
  }
  getChannelData(ch: number): Float32Array { return this.data[ch]; }
}

// Minimal window/localStorage shims so learning.ts can be imported
export const localStorageShim: Storage = (() => {
  const store: Record<string, string> = {};
  return {
    get length() { return Object.keys(store).length; },
    key(i: number) { return Object.keys(store)[i] ?? null; },
    getItem(k: string) { return k in store ? store[k] : null; },
    setItem(k: string, v: string) { store[k] = String(v); },
    removeItem(k: string) { delete store[k]; },
    clear() { for (const k of Object.keys(store)) delete store[k]; },
  } as Storage;
})();
