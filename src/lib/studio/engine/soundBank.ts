/**
 * SOUND BANK — sample library with metadata + selection logic.
 *
 * Loads PSY3 samples (and any future samples) into AudioBuffer.
 * Each sample has metadata: spectral profile, level, duration, category.
 * The engine can select samples by (category, world, energy, section).
 *
 * REAL IMPLEMENTATION.
 */

export interface SampleMetadata {
  name: string;
  category: 'kick' | 'bass' | 'lead' | 'hat_closed' | 'hat_open' | 'clap' | 'perc' | 'fx';
  duration: number;       // seconds
  peak: number;           // 0..1
  rms: number;            // 0..1
  centroid: number;       // Hz (spectral centroid)
  lowEnergy: number;      // 0..1 (ratio below 120Hz)
  midEnergy: number;      // 0..1 (ratio 120-2000Hz)
  highEnergy: number;     // 0..1 (ratio above 2000Hz)
  compatibleWorlds: string[];  // which worlds this sample fits
  url: string;            // fetch URL
}

export const SAMPLE_CATALOG: SampleMetadata[] = [
  {
    name: 'kick.wav',
    category: 'kick',
    duration: 0.280,
    peak: 1.000,
    rms: 0.319,
    centroid: 111,
    lowEnergy: 0.949,   // 93.6% sub + 1.3% low
    midEnergy: 0.051,
    highEnergy: 0.000,
    compatibleWorlds: ['progressive-psy', 'dark-psy', 'goa', 'morning-psy', 'forest', 'hypnotic', 'cosmic', 'acid-psy'],
    url: '/samples/kick.wav',
  },
  {
    name: 'bass_A.wav',
    category: 'bass',
    duration: 0.180,
    peak: 0.675,
    rms: 0.200,
    centroid: 821,
    lowEnergy: 0.915,   // 72.6% sub + 18.9% low
    midEnergy: 0.085,
    highEnergy: 0.000,
    compatibleWorlds: ['progressive-psy', 'dark-psy', 'goa', 'forest', 'acid-psy'],
    url: '/samples/bass_A.wav',
  },
  {
    name: 'lead.wav',
    category: 'lead',
    duration: 0.300,
    peak: 0.274,
    rms: 0.052,
    centroid: 7789,
    lowEnergy: 0.131,
    midEnergy: 0.799,   // 63.1% lowmid + 16.8% mid
    highEnergy: 0.071,
    compatibleWorlds: ['goa', 'morning-psy', 'cosmic'],
    url: '/samples/lead.wav',
  },
  {
    name: 'hat_closed.wav',
    category: 'hat_closed',
    duration: 0.060,
    peak: 1.000,
    rms: 0.331,
    centroid: 13963,
    lowEnergy: 0.328,
    midEnergy: 0.109,
    highEnergy: 0.436,  // 21.3% high + 22.3% air
    compatibleWorlds: ['progressive-psy', 'dark-psy', 'goa', 'morning-psy', 'forest', 'hypnotic', 'cosmic', 'acid-psy'],
    url: '/samples/hat_closed.wav',
  },
  {
    name: 'hat_open.wav',
    category: 'hat_open',
    duration: 0.300,
    peak: 1.000,
    rms: 0.390,
    centroid: 13987,
    lowEnergy: 0.325,
    midEnergy: 0.142,
    highEnergy: 0.408,
    compatibleWorlds: ['progressive-psy', 'dark-psy', 'goa', 'morning-psy', 'forest', 'hypnotic', 'cosmic', 'acid-psy'],
    url: '/samples/hat_open.wav',
  },
  {
    name: 'clap.wav',
    category: 'clap',
    duration: 0.250,
    peak: 1.000,
    rms: 0.374,
    centroid: 11009,
    lowEnergy: 0.506,   // 20.7% sub + 28.5% low + 22.1% body — warm clap
    midEnergy: 0.193,
    highEnergy: 0.094,
    compatibleWorlds: ['progressive-psy', 'dark-psy', 'goa', 'morning-psy', 'forest', 'hypnotic', 'cosmic', 'acid-psy'],
    url: '/samples/clap.wav',
  },
];

export class SoundBank {
  private ctx: AudioContext | null = null;
  private buffers: Map<string, AudioBuffer> = new Map();
  private loaded = false;

  /** Initialize with an AudioContext and load all samples. */
  async init(ctx: AudioContext): Promise<void> {
    this.ctx = ctx;
    if (this.loaded) return;

    const promises = SAMPLE_CATALOG.map(async (meta) => {
      try {
        const response = await fetch(meta.url);
        if (!response.ok) {
          console.warn(`SoundBank: failed to fetch ${meta.url}: ${response.status}`);
          return;
        }
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        this.buffers.set(meta.name, audioBuffer);
      } catch (e) {
        console.warn(`SoundBank: failed to load ${meta.name}:`, e);
      }
    });

    await Promise.all(promises);
    this.loaded = true;
  }

  /** Get a sample buffer by name. Returns null if not loaded. */
  get(name: string): AudioBuffer | null {
    return this.buffers.get(name) || null;
  }

  /** Check if a sample is loaded. */
  has(name: string): boolean {
    return this.buffers.has(name);
  }

  /** Select the best sample for a given category + world. */
  select(category: SampleMetadata['category'], worldId: string): AudioBuffer | null {
    // Find samples matching category + compatible world
    const candidates = SAMPLE_CATALOG.filter(
      (m) => m.category === category && m.compatibleWorlds.includes(worldId)
    );

    if (candidates.length === 0) {
      // Fallback: any sample in this category
      const fallback = SAMPLE_CATALOG.find((m) => m.category === category);
      if (fallback) return this.get(fallback.name);
      return null;
    }

    // For now, use the first match (future: select by energy/spectral match)
    return this.get(candidates[0].name);
  }

  /** Get metadata for a sample. */
  getMetadata(name: string): SampleMetadata | null {
    return SAMPLE_CATALOG.find((m) => m.name === name) || null;
  }

  /** List all loaded samples. */
  listLoaded(): string[] {
    return Array.from(this.buffers.keys());
  }

  /** Check if the bank is initialized. */
  isLoaded(): boolean {
    return this.loaded;
  }
}

/** Singleton instance. */
let soundBankInstance: SoundBank | null = null;

export function getSoundBank(): SoundBank {
  if (!soundBankInstance) soundBankInstance = new SoundBank();
  return soundBankInstance;
}
