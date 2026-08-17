/**
 * PSY4 Engine Worklet v3 — Drum synth + psysynth for melodic
 *
 * Architecture:
 *   - This worklet handles DRUMS (kick/snare/hat/clap/perc/shaker) + FX (riser/impact/sweep)
 *   - Melodic voices (bass/lead/acid/pad) are routed to psysynth via SynthBridge
 *   - No WAV samples — all synthesis (tiny download, infinite variation)
 *
 * Voice IDs (must match composition-worker-v2.js + psy4-engine-v3.js):
 *   0=kick 1=bass 2=lead 3=acid 4=pad 5=hat 6=hatOpen 7=clap 8=perc
 *   9=shaker 10=texture 11=riser 12=impact 13=sweep 14=snare
 *
 * Melodic voices (1-4) are NOT scheduled here — main thread routes them to psysynth.
 */

export const VOICE = {
  KICK: 0, BASS: 1, LEAD: 2, ACID: 3, PAD: 4,
  HAT: 5, HAT_OPEN: 6, CLAP: 7, PERC: 8, SHAKER: 9,
  TEXTURE: 10, RISER: 11, IMPACT: 12, SWEEP: 13, SNARE: 14,
} as const;

export type VoiceId = typeof VOICE[keyof typeof VOICE];

export interface EngineStats {
  playing: boolean;
  step: number;
  activeVoices: number;
  eventCount: number;
  currentFrame: number;
  cpuLoad: number;
  sampleUsage?: Record<string, number>;
  processMs?: number;
  voiceBudget?: number;
}

export class Psy4EngineNode {
  readonly id = 'psy4-engine-v3';
  private ctx: AudioContext;
  private node: AudioWorkletNode | null = null;
  private statsCallback: ((stats: EngineStats) => void) | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  get outputNode(): AudioNode | null { return this.node; }
  get workletNode(): AudioWorkletNode | null { return this.node; }

  postToWorklet(msg: any): void {
    this.node?.port.postMessage(msg);
  }

  onStats(cb: (stats: EngineStats) => void): void {
    this.statsCallback = cb;
  }

  async init(): Promise<boolean> {
    try {
      await this.ctx.audioWorklet.addModule('/worklets/psy4-engine-v3.js');
      this.node = new AudioWorkletNode(this.ctx, 'psy4-engine-v3', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.node.port.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'stats' && this.statsCallback) {
          this.statsCallback(msg);
        }
      };
      return true;
    } catch (err) {
      console.error('[PSY4] v3 init failed:', err);
      return false;
    }
  }

  /**
   * Schedule a drum event. Melodic voices are ignored here (routed to psysynth by main thread).
   */
  scheduleEvent(at: number, voiceId: VoiceId, note: number, vel: number, dur: number, param: number = 0): void {
    this.node?.port.postMessage({
      type: 'scheduleEvent',
      at, voiceId, note, vel, dur, param,
    });
  }

  setLearnedParams(params: Record<number, any>): void {
    // No-op for v3 (drums are fixed synth; melodic learnedParams go to psysynth)
  }

  play(): void { /* no-op */ }
  stop(): void { this.node?.port.postMessage({ type: 'stop' }); }
  setBPM(bpm: number): void { /* handled by composition worker */ }
  setMacros(macros: any): void { /* handled by composition worker */ }
  setWorld(params: any): void { /* not used in v3 */ }
  setVolume(v: number): void { /* handled by workletVolumeGain in psyLive */ }
  flushEvents(): void { /* no-op — events sent immediately */ }
}
