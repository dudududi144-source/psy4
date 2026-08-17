/**
 * PSY4 Engine Worklet v2 — Sample-based engine wrapper
 *
 * Replaces the old Psy4EngineNode. Uses psy4-engine-v2.js AudioWorklet.
 * Loads real WAV samples from /samples/ and schedules them via events.
 *
 * Voice IDs (must match composition-worker-v2.js + psy4-engine-v2.js):
 *   0=kick 1=bass 2=lead 3=acid 4=pad 5=hat 6=hatOpen 7=clap 8=perc
 *   9=shaker 10=texture 11=riser 12=impact 13=sweep 14=snare
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

/**
 * List of sample files to load (38 real WAV samples).
 * Each sample is fetched as ArrayBuffer, decoded to Float32Array, transferred to worklet.
 */
const SAMPLE_FILES: string[] = [
  'kick.wav', 'kick_deep.wav', 'kick_punchy.wav', 'kick_acid.wav', 'kick_forest.wav', 'kick_hitech.wav',
  'bass_A.wav', 'bass_deep.wav', 'bass_acid.wav', 'bass_dark.wav', 'bass_rolling.wav',
  'lead.wav', 'lead_acid.wav', 'lead_bright.wav', 'lead_dark.wav',
  'pad_bright.wav', 'pad_dark.wav', 'atmosphere.wav', 'texture_pad.wav',
  'hat_closed.wav', 'open_hat_gen.wav', 'hat_open.wav',
  'clap.wav', 'clap_variant.wav', 'snap.wav',
  'perc_1.wav', 'perc_2.wav', 'perc_3.wav', 'perc_4.wav', 'rim.wav', 'tom.wav',
  'shaker.wav',
  'snare.wav',
  'riser.wav', 'downlifter.wav',
  'impact.wav',
  'fx_sweep.wav',
  'ride.wav',
];

export class Psy4EngineNode {
  readonly id = 'psy4-engine-v2';
  private ctx: AudioContext;
  private node: AudioWorkletNode | null = null;
  private statsCallback: ((stats: EngineStats) => void) | null = null;
  private samplesLoaded = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  get outputNode(): AudioNode | null {
    return this.node;
  }

  get workletNode(): AudioWorkletNode | null {
    return this.node;
  }

  postToWorklet(msg: any): void {
    this.node?.port.postMessage(msg);
  }

  onStats(cb: (stats: EngineStats) => void): void {
    this.statsCallback = cb;
  }

  /**
   * Initialize: load worklet module + create AudioWorkletNode + load samples.
   * Returns true on success.
   */
  async init(): Promise<boolean> {
    try {
      await this.ctx.audioWorklet.addModule('/worklets/psy4-engine-v2.js');
      this.node = new AudioWorkletNode(this.ctx, 'psy4-engine-v2', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });

      // Wire stats callback
      this.node.port.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'stats' && this.statsCallback) {
          this.statsCallback(msg);
        }
        if (msg.type === 'samplesLoaded') {
          this.samplesLoaded = true;
          console.log(`[PSY4] v2: ${msg.count} samples loaded in worklet`);
        }
      };

      // Load samples (fetch + decode + transfer to worklet)
      await this.loadSamples();

      return true;
    } catch (err) {
      console.error('[PSY4] v2 init failed:', err);
      return false;
    }
  }

  /**
   * Load all WAV samples, decode to Float32Array, transfer to worklet.
   */
  private async loadSamples(): Promise<void> {
    const samples: Record<string, { data: Float32Array; sampleRate: number }> = {};
    const tempCtx = new OfflineAudioContext(1, 44100, 44100); // for decodeAudioData

    for (const file of SAMPLE_FILES) {
      try {
        const resp = await fetch(`/samples/${file}`);
        if (!resp.ok) {
          console.warn(`[PSY4] v2: could not fetch ${file}: ${resp.status}`);
          continue;
        }
        const arrayBuffer = await resp.arrayBuffer();
        const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
        // Use channel 0 (mono) — psy4 samples are mono
        const channelData = audioBuffer.getChannelData(0);
        // Copy to a fresh Float32Array (the decoded buffer may be shared)
        const data = new Float32Array(channelData);
        samples[file] = { data, sampleRate: audioBuffer.sampleRate };
      } catch (err) {
        console.warn(`[PSY4] v2: failed to decode ${file}:`, err);
      }
    }

    // Transfer samples to worklet
    const transferables: ArrayBuffer[] = [];
    const samplesForWorklet: Record<string, { data: Float32Array; sampleRate: number }> = {};
    for (const [name, sample] of Object.entries(samples)) {
      samplesForWorklet[name] = { data: sample.data, sampleRate: sample.sampleRate };
      transferables.push(sample.data.buffer as ArrayBuffer);
    }

    this.node?.port.postMessage({ type: 'loadSamples', samples: samplesForWorklet }, transferables);
    console.log(`[PSY4] v2: transferred ${Object.keys(samples).length} samples to worklet`);
  }

  /**
   * Schedule an event: { at, voiceId, note, vel, dur, param }
   */
  scheduleEvent(at: number, voiceId: VoiceId, note: number, vel: number, dur: number, param: number = 0): void {
    this.node?.port.postMessage({
      type: 'scheduleEvent',
      at, voiceId, note, vel, dur, param,
    });
  }

  setLearnedParams(params: Record<number, any>): void {
    this.node?.port.postMessage({ type: 'setLearnedParams', params });
  }

  play(): void {
    this.node?.port.postMessage({ type: 'play' });
  }

  stop(): void {
    this.node?.port.postMessage({ type: 'stop' });
  }

  setBPM(bpm: number): void {
    // BPM is handled by composition worker, not engine
  }

  setMacros(macros: any): void {
    // Macros handled by composition worker
  }

  setWorld(params: any): void {
    // World params not used in v2 (sample-based)
  }

  setVolume(v: number): void {
    // Volume handled by workletVolumeGain in psyLive
  }

  flushEvents(): void {
    // No-op — events are sent immediately via scheduleEvent
  }
}
