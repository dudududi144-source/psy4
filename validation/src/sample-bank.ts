/**
 * PSY4 Vertical Validation — Sample Bank
 *
 * Loads real drum-machine samples from public/samples/real/.
 * Sample selection is deterministic (greedy by role, no search).
 *
 * Used by variants B/C/D/E (NOT A — A uses current psyLive synth only).
 */

import * as fs from 'fs';
import * as path from 'path';

const SAMPLES_DIR = '/home/z/my-project/public/samples/real';

// Curated sample selection per role (deterministic — first match by index)
const KICK_SAMPLES = ['909_BD_02.wav', '909_BD_04.wav', '909_BD_05.wav', '909_BD_06.wav', '909_BD_07.wav'];
const HAT_SAMPLES = ['md_hat_Hats_0008.wav', 'md_hat_Hats_0012.wav', 'md_hat_Hats_0013.wav', 'md_hat_Hats_0014.wav'];
const PERC_SAMPLES = ['md_perc_Percs_0001.wav', 'md_perc_Percs_0002.wav', 'md_perc_Percs_0003.wav'];

export interface LoadedSample {
  buffer: AudioBuffer;
  path: string;
  role: 'kick' | 'hat' | 'perc';
}

export class SampleBank {
  private cache: Map<string, AudioBuffer> = new Map();
  private ctx: OfflineAudioContext;

  constructor(ctx: OfflineAudioContext) {
    this.ctx = ctx;
  }

  async loadKick(index: number = 0): Promise<LoadedSample | null> {
    const file = KICK_SAMPLES[index % KICK_SAMPLES.length];
    return this.load(path.join(SAMPLES_DIR, file), 'kick');
  }

  async loadHat(index: number = 0): Promise<LoadedSample | null> {
    const file = HAT_SAMPLES[index % HAT_SAMPLES.length];
    return this.load(path.join(SAMPLES_DIR, file), 'hat');
  }

  async loadPerc(index: number = 0): Promise<LoadedSample | null> {
    const file = PERC_SAMPLES[index % PERC_SAMPLES.length];
    return this.load(path.join(SAMPLES_DIR, file), 'perc');
  }

  private async load(filepath: string, role: 'kick' | 'hat' | 'perc'): Promise<LoadedSample | null> {
    const cached = this.cache.get(filepath);
    if (cached) return { buffer: cached, path: filepath, role };

    try {
      const fileBuf = fs.readFileSync(filepath);
      const decoded = await this.ctx.decodeAudioData(new Uint8Array(fileBuf).buffer);
      this.cache.set(filepath, decoded);
      return { buffer: decoded, path: filepath, role };
    } catch (e) {
      console.warn(`Failed to load sample ${filepath}:`, (e as Error).message);
      return null;
    }
  }
}
