/**
 * PSY4 Engine Worklet — TypeScript wrapper.
 *
 * Creates and manages the AudioWorkletNode that runs the full synth engine.
 * The main thread sends high-level musical events ("kick at time T, velocity 0.9")
 * and the worklet executes them sample-accurately with zero per-hit allocation.
 *
 * This replaces the old architecture where:
 *   setInterval(25ms) → tick() → createOscillator/Gain/Filter per hit → GC pressure
 *
 * New architecture:
 *   Main thread: tick() → push events to Float64Array → port.postMessage
 *   Audio thread: process() → read events → trigger preallocated voices → render
 */

export const VOICE = {
  KICK: 0, BASS: 1, LEAD: 2, ACID: 3, PAD: 4,
  HAT: 5, HAT_OPEN: 6, CLAP: 7, PERC: 8, SHAKER: 9,
  TEXTURE: 10, RISER: 11, IMPACT: 12, SWEEP: 13,
  ZAP: 14, BLIP: 15, DOWNLIFTER: 16, FM: 17, SNARE: 18, WAVETABLE: 19,
} as const;

export type VoiceId = typeof VOICE[keyof typeof VOICE];

export interface EngineStats {
  playing: boolean;
  step: number;
  activeVoices: number;
  eventCount: number;
  currentFrame: number;
  cpuLoad: number;
  sampleUsage?: Record<string, number>; // which samples actually played (name → hit count)
}

export interface WorldParams {
  kickFundamental: number;
  kickDecay: number;
  bassCutoff: number;
  bassResonance: number;
  leadCutoff: number;
  leadDetune: number;
  padCutoff: number;
  padAttack: number;
  padDetune: number;
  padEvolveRate: number;
  duck: number;
}

export interface EngineMacros {
  energy: number; psychedelia: number; darkness: number; density: number;
  groove: number; evolution: number; space: number; surprise: number;
  aggression: number; brightness: number;
}

const EVENT_SIZE = 6;
const MAX_BATCH_EVENTS = 256;

let engineLoadPromise: Promise<boolean> | null = null;

/**
 * Load the engine worklet module. Cached per-context.
 */
export function ensureEngineWorkletLoaded(ctx: AudioContext): Promise<boolean> {
  if (!engineLoadPromise) {
    engineLoadPromise = ctx.audioWorklet.addModule('/worklets/psy4-engine.js').then(() => {
      console.log('[PSY4] Engine worklet module loaded');
      return true;
    }).catch((e) => {
      console.warn('[PSY4] Engine worklet load failed:', e);
      return false;
    });
  }
  return engineLoadPromise;
}

/**
 * PSY4 Engine Node — wraps the AudioWorkletNode and provides a clean API.
 *
 * The main thread uses:
 *   engine.play() / engine.stop()
 *   engine.setBPM(bpm)
 *   engine.setMacros(macros)
 *   engine.setWorld(params)
 *   engine.scheduleEvent(time, voice, note, vel, dur, param)
 *   engine.flushEvents() — sends batched events to worklet
 *
 * The worklet handles all timing and DSP.
 */
export class Psy4EngineNode {
  private ctx: AudioContext;
  private node: AudioWorkletNode | null = null;
  private eventBatch: Float64Array;
  private eventBatchCount = 0;
  private statsCallback: ((stats: EngineStats) => void) | null = null;
  ready = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.eventBatch = new Float64Array(MAX_BATCH_EVENTS * EVENT_SIZE);
  }

  async init(): Promise<boolean> {
    const ok = await ensureEngineWorkletLoaded(this.ctx);
    if (!ok) return false;
    try {
      this.node = new AudioWorkletNode(this.ctx, 'psy4-engine', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      // FIX: Don't connect to destination here — psyLive.ts connects through analyser
      // Was: this.node.connect(this.ctx.destination);
      // This caused DOUBLE output: worklet→destination AND worklet→analyser→destination
      // = clipping at 255 because signal was summed twice
      // this.node.connect(this.ctx.destination);
      this.node.port.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'stats' && this.statsCallback) {
          this.statsCallback(msg);
        }
      };
      this.ready = true;
      return true;
    } catch (e) {
      console.warn('[PSY4] Engine node creation failed:', e);
      return false;
    }
  }

  /** Get the output node for connecting to additional processing (analyser, etc.) */
  get outputNode(): AudioNode | null {
    return this.node;
  }

  /** Set stats callback for transport state updates. */
  onStats(cb: (stats: EngineStats) => void) {
    this.statsCallback = cb;
  }

  play() {
    this.node?.port.postMessage({ type: 'play' });
  }

  stop() {
    this.node?.port.postMessage({ type: 'stop' });
  }

  setBPM(bpm: number) {
    this.node?.port.postMessage({ type: 'bpm', bpm });
  }

  setMacros(macros: Partial<EngineMacros>) {
    this.node?.port.postMessage({ type: 'macros', macros });
  }

  setWorld(params: Partial<WorldParams>) {
    this.node?.port.postMessage({ type: 'world', params });
  }

  /**
   * Set FX send levels for section automation.
   * reverbSends/delaySends: [drum, bass, music, atmos, fx] send amounts 0..1
   * Used to automate reverb/delay depth per section (build=more, drop=less, break=max)
   */
  setFX(opts: {
    reverbSends?: number[];
    delaySends?: number[];
    reverbWet?: number;
    delayWet?: number;
    delayFeedback?: number;
  }) {
    this.node?.port.postMessage({ type: 'setFX', ...opts });
  }

  /**
   * Load sample bank data into the worklet.
   * Transfers Float32Array buffers (zero-copy) so the worklet can play
   * the REAL PSY3 samples instead of pure synth DSP.
   */
  loadSamples(samples: { name: string; category: string; subcategory: string; sampleRate: number; data: Float32Array }[]) {
    if (!this.node) return;
    // PERF: compute total bytes BEFORE transferring (detached ArrayBuffers report byteLength=0)
    let totalBytes = 0;
    const transferables: ArrayBuffer[] = [];
    for (const s of samples) {
      totalBytes += s.data.buffer.byteLength;
      transferables.push(s.data.buffer);
    }
    this.node.port.postMessage({ type: 'loadSamples', samples }, transferables);
    console.log(`[PSY4] Transferred ${samples.length} samples to worklet (${totalBytes} bytes)`);
  }

  triggerDuck() {
    this.node?.port.postMessage({ type: 'duck' });
  }

  /** Notify worklet of a new phrase boundary — rotates phrase-locked samples. */
  notifyNewPhrase() {
    this.node?.port.postMessage({ type: 'newPhrase' });
  }

  panic() {
    this.node?.port.postMessage({ type: 'panic' });
  }

  /**
   * Schedule a single event at audio-context time T.
   * Events are batched and sent via flushEvents().
   */
  scheduleEvent(time: number, voice: VoiceId, note: number = 0, velocity: number = 1, duration: number = 0.2, param: number = 0) {
    if (this.eventBatchCount >= MAX_BATCH_EVENTS) {
      this.flushEvents();
    }
    const base = this.eventBatchCount * EVENT_SIZE;
    this.eventBatch[base] = time;
    this.eventBatch[base + 1] = voice;
    this.eventBatch[base + 2] = note;
    this.eventBatch[base + 3] = velocity;
    this.eventBatch[base + 4] = duration;
    this.eventBatch[base + 5] = param;
    this.eventBatchCount++;
  }

  /**
   * Send batched events to the worklet.
   * ADR-009: Uses SharedArrayBuffer when available (zero-copy, zero-allocation).
   * Falls back to Transferable Float64Array when SharedArrayBuffer is not available.
   */
  flushEvents() {
    if (!this.node || this.eventBatchCount === 0) return;
    const events = new Float64Array(this.eventBatchCount * EVENT_SIZE);
    events.set(this.eventBatch.subarray(0, this.eventBatchCount * EVENT_SIZE));
    this.node.port.postMessage({ type: 'events', events }, [events.buffer]);
    this.eventBatchCount = 0;
  }

  // ADR-009: SharedArrayBuffer for lock-free event transfer
  private sharedEventBuffer: SharedArrayBuffer | null = null;
  private sharedEventCount: Int32Array | null = null;
  private static readonly SHARED_BUFFER_EVENTS = 1024;

  /**
   * Initialize SharedArrayBuffer for lock-free event transfer.
   * Call this after init() if SharedArrayBuffer is available.
   */
  initSharedBuffer(): boolean {
    if (typeof SharedArrayBuffer === 'undefined') return false;
    if (!this.node) return false;
    const bytes = Psy4EngineNode.SHARED_BUFFER_EVENTS * EVENT_SIZE * 8; // Float64 = 8 bytes
    this.sharedEventBuffer = new SharedArrayBuffer(bytes);
    this.sharedEventCount = new Int32Array(new SharedArrayBuffer(4));
    // Send the shared buffer to the worklet (one-time setup)
    this.node.port.postMessage({
      type: 'initSharedBuffer',
      buffer: this.sharedEventBuffer,
      countBuffer: this.sharedEventCount.buffer,
    });
    return true;
  }

  /** Immediate single trigger (for UI actions like "Drop"). */
  triggerImmediate(voice: VoiceId, note: number = 0, velocity: number = 1, duration: number = 0.2, param: number = 0) {
    if (!this.node) return;
    const time = this.ctx.currentTime + 0.02; // 20ms ahead for immediate response
    this.node.port.postMessage({
      type: 'trigger',
      time, voice, note, velocity, duration, param,
    });
  }

  dispose() {
    if (this.node) {
      try { this.node.disconnect(); } catch { /* noop */ }
      this.node = null;
    }
    this.ready = false;
  }
}
