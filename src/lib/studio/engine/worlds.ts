/**
 * WORLDS — parameterized musical identities.
 *
 * A World is a complete musical system: key/scale range, tempo, drum grammar,
 * bass grammar, melodic grammar, harmonic palette, timbral palette, FX palette,
 * arrangement grammar, evolution behavior.
 *
 * Worlds are NOT unrelated presets. They are parameterized musical systems that
 * share the same engine but produce fundamentally different musical identities.
 *
 * REAL IMPLEMENTATION.
 */

export type WorldId =
  | 'progressive-psy' | 'dark-psy' | 'morning-psy' | 'goa' | 'forest'
  | 'deep-psy' | 'hypnotic' | 'cosmic' | 'organic-psy' | 'acid-psy';

export interface World {
  id: WorldId;
  name: string;
  description: string;
  // tempo
  bpmRange: [number, number];
  defaultBpm: number;
  // harmonic
  scales: string[];            // allowed scale names (see dsp/wavetable SCALES)
  defaultScale: string;
  rootRange: [number, number]; // MIDI root range
  // groove
  kickPattern: string;         // 16-char gate string
  bassPattern: string;         // 16-char gate string (off-beat = psytrance)
  clapPattern: string;         // 16-char gate string ('x' = hit, '.' = rest)
  percPattern: string;         // 16-char gate string
  arpPattern: number[];        // 8 scale degrees per step (e.g. [0,2,4,7,4,2,0,7])
  hatDensity: number;          // 0..1 probability per eligible step
  percDensity: number;
  swing: number;               // 0..0.5
  // timbral palette
  leadTimbre: TimbrePreset;
  bassTimbre: TimbrePreset;
  padTimbre: TimbrePreset;
  textureTimbre: TimbrePreset;
  // FX palette
  fxAlgorithm1: string;
  fxAlgorithm2: string;
  fxMix: number;
  // evolution behavior
  evolutionRate: number;       // 0..1 how fast motifs mutate
  spectralMotion: number;      // 0..1 how much timbre evolves
  // arrangement
  energyCurve: number[];       // normalized energy per section phase
  // character
  darkness: number;            // 0..1
  brightness: number;          // 0..1
  psychedelia: number;         // 0..1 baseline
  aggression: number;          // 0..1
}

export interface TimbrePreset {
  oscShape: 'saw' | 'square' | 'triangle';
  cutoff: number;
  resonance: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  drive: number;
  level: number;
}

const t = (overrides: Partial<TimbrePreset> = {}): TimbrePreset => ({
  oscShape: 'saw', cutoff: 1500, resonance: 0.4, attack: 0.005, decay: 0.2,
  sustain: 0.7, release: 0.3, drive: 1, level: 0.5, ...overrides,
});

export const WORLDS: Record<WorldId, World> = {
  'progressive-psy': {
    id: 'progressive-psy', name: 'Progressive Psy',
    description: 'Slow-building, melodic, hypnotic. Dorian/minor, 125-132 BPM.',
    bpmRange: [124, 134], defaultBpm: 128,
    scales: ['minor', 'dorian', 'minorPentatonic'], defaultScale: 'dorian',
    rootRange: [40, 48],
    kickPattern: 'x...x...x...x...',
    bassPattern: '.x.x.x.x.x.x.x.x',
    clapPattern: '....x.......x...',
    percPattern: '......x.......x.',
    arpPattern: [0,2,4,7,4,2,0,7],
    hatDensity: 0.35, percDensity: 0.25, swing: 0.08,
    leadTimbre: t({ cutoff: 2200, resonance: 0.35, attack: 0.01, level: 0.5 }),
    bassTimbre: t({ oscShape: 'saw', cutoff: 550, resonance: 0.6, drive: 1.5, level: 0.8, sustain: 0.85, decay: 0.12, release: 0.08 }),
    padTimbre: t({ cutoff: 1200, resonance: 0.25, attack: 0.6, decay: 1.0, sustain: 0.85, release: 1.5, level: 0.35 }),
    textureTimbre: t({ cutoff: 2800, resonance: 0.4, attack: 2.0, level: 0.2 }),
    fxAlgorithm1: 'shimmer', fxAlgorithm2: 'modfilter', fxMix: 0.3,
    evolutionRate: 0.35, spectralMotion: 0.4,
    energyCurve: [0.3, 0.45, 0.6, 0.75, 0.9, 0.75, 0.6, 0.4],
    darkness: 0.35, brightness: 0.55, psychedelia: 0.55, aggression: 0.35,
  },
  'dark-psy': {
    id: 'dark-psy', name: 'Dark Psy',
    description: 'Fast, intense, foreboding. Phrygian/harmonic minor, 148-155 BPM.',
    bpmRange: [145, 156], defaultBpm: 150,
    scales: ['phrygian', 'harmonicMinor', 'phrygianDominant'], defaultScale: 'phrygian',
    rootRange: [38, 44],
    kickPattern: 'x.x.x.x.x.x.x.x.',
    bassPattern: 'xxxxxxxxxxxxxxxx',
    clapPattern: '....x.......x...',
    percPattern: '.x.x.x.x.x.x.x.x',
    arpPattern: [0,1,0,1,3,1,0,1],
    hatDensity: 0.55, percDensity: 0.45, swing: 0.03,
    leadTimbre: t({ cutoff: 1800, resonance: 0.6, attack: 0.003, drive: 1.8, level: 0.55 }),
    bassTimbre: t({ oscShape: 'saw', cutoff: 420, resonance: 0.7, drive: 2.2, level: 0.85, sustain: 0.8, decay: 0.1, release: 0.06 }),
    padTimbre: t({ cutoff: 900, resonance: 0.35, attack: 1.0, release: 2.0, level: 0.3 }),
    textureTimbre: t({ cutoff: 2000, resonance: 0.5, attack: 1.5, level: 0.25 }),
    fxAlgorithm1: 'blackhole', fxAlgorithm2: 'psyphase', fxMix: 0.35,
    evolutionRate: 0.5, spectralMotion: 0.55,
    energyCurve: [0.5, 0.7, 0.85, 0.95, 0.85, 0.95, 0.7, 0.5],
    darkness: 0.8, brightness: 0.35, psychedelia: 0.7, aggression: 0.75,
  },
  'morning-psy': {
    id: 'morning-psy', name: 'Morning Psy',
    description: 'Uplifting, bright, euphoric. Major/dorian, 140-145 BPM.',
    bpmRange: [138, 146], defaultBpm: 142,
    scales: ['dorian', 'minorPentatonic', 'harmonicMinor'], defaultScale: 'dorian',
    rootRange: [43, 50],
    kickPattern: 'x...x...x...x...',
    bassPattern: '.x.x.x.x.x.x.x.x',
    clapPattern: '....x.......x...',
    percPattern: '...x...x...x...x',
    arpPattern: [0,4,7,9,7,4,0,9],
    hatDensity: 0.4, percDensity: 0.35, swing: 0.05,
    leadTimbre: t({ cutoff: 2600, resonance: 0.3, attack: 0.005, level: 0.55 }),
    bassTimbre: t({ oscShape: 'saw', cutoff: 600, resonance: 0.55, drive: 1.3, level: 0.8, sustain: 0.85 }),
    padTimbre: t({ cutoff: 1800, resonance: 0.2, attack: 0.4, release: 1.8, level: 0.4 }),
    textureTimbre: t({ cutoff: 3200, resonance: 0.35, attack: 1.5, level: 0.22 }),
    fxAlgorithm1: 'shimmer', fxAlgorithm2: 'doubledelay', fxMix: 0.35,
    evolutionRate: 0.4, spectralMotion: 0.45,
    energyCurve: [0.4, 0.55, 0.7, 0.85, 0.95, 0.8, 0.65, 0.45],
    darkness: 0.2, brightness: 0.75, psychedelia: 0.6, aggression: 0.4,
  },
  'goa': {
    id: 'goa', name: 'Goa',
    description: 'Acidic, melodic, mystical. Phrygian dominant/harmonic minor, 135-145 BPM.',
    bpmRange: [134, 146], defaultBpm: 140,
    scales: ['phrygianDominant', 'harmonicMinor', 'doubleHarmonic'], defaultScale: 'phrygianDominant',
    rootRange: [42, 48],
    kickPattern: 'x...x...x...x...',
    bassPattern: 'x.x.x.x.x.x.x.x.',
    clapPattern: '....x.......x...',
    percPattern: '..x...x...x...x.',
    arpPattern: [0,1,4,7,4,1,0,4],
    hatDensity: 0.45, percDensity: 0.4, swing: 0.06,
    leadTimbre: t({ cutoff: 2400, resonance: 0.75, attack: 0.002, drive: 2.0, level: 0.6 }),
    bassTimbre: t({ oscShape: 'square', cutoff: 500, resonance: 0.65, drive: 1.6, level: 0.82 }),
    padTimbre: t({ cutoff: 1500, resonance: 0.3, attack: 0.8, release: 2.2, level: 0.35 }),
    textureTimbre: t({ cutoff: 2800, resonance: 0.5, attack: 1.2, level: 0.25 }),
    fxAlgorithm1: 'shimmer', fxAlgorithm2: 'psyphase', fxMix: 0.4,
    evolutionRate: 0.55, spectralMotion: 0.6,
    energyCurve: [0.35, 0.5, 0.7, 0.85, 0.95, 0.85, 0.7, 0.5],
    darkness: 0.45, brightness: 0.6, psychedelia: 0.8, aggression: 0.5,
  },
  'forest': {
    id: 'forest', name: 'Forest',
    description: 'Organic, deep, mysterious. Minor/phrygian, 145-155 BPM.',
    bpmRange: [144, 156], defaultBpm: 148,
    scales: ['minor', 'phrygian', 'dorian'], defaultScale: 'minor',
    rootRange: [40, 46],
    kickPattern: 'x..xx..xx..xx..x',
    bassPattern: 'x.x.x.x.x.x.x.x.',
    clapPattern: '....x.......x...',
    percPattern: 'x.x.x.x.x.x.x.x.',
    arpPattern: [0,3,5,7,5,3,0,5],
    hatDensity: 0.5, percDensity: 0.5, swing: 0.04,
    leadTimbre: t({ cutoff: 1900, resonance: 0.5, attack: 0.004, drive: 1.5, level: 0.5 }),
    bassTimbre: t({ oscShape: 'saw', cutoff: 450, resonance: 0.7, drive: 2.0, level: 0.85 }),
    padTimbre: t({ cutoff: 1000, resonance: 0.4, attack: 1.2, release: 2.5, level: 0.3 }),
    textureTimbre: t({ cutoff: 2200, resonance: 0.55, attack: 2.0, level: 0.28 }),
    fxAlgorithm1: 'warmverb', fxAlgorithm2: 'modfilter', fxMix: 0.32,
    evolutionRate: 0.45, spectralMotion: 0.5,
    energyCurve: [0.4, 0.6, 0.75, 0.9, 0.85, 0.9, 0.65, 0.45],
    darkness: 0.65, brightness: 0.4, psychedelia: 0.65, aggression: 0.6,
  },
  'deep-psy': {
    id: 'deep-psy', name: 'Deep Psy',
    description: 'Minimal, hypnotic, spacious. Minor/dorian, 130-138 BPM.',
    bpmRange: [128, 140], defaultBpm: 134,
    scales: ['minor', 'dorian'], defaultScale: 'minor',
    rootRange: [41, 47],
    kickPattern: 'x...x...x...x...',
    bassPattern: '.x.x.x.x.x.x.x.x',
    clapPattern: '........x.......',
    percPattern: '......x.........',
    arpPattern: [0,0,7,0,5,0,7,0],
    hatDensity: 0.25, percDensity: 0.2, swing: 0.07,
    leadTimbre: t({ cutoff: 2000, resonance: 0.4, attack: 0.008, level: 0.45 }),
    bassTimbre: t({ oscShape: 'saw', cutoff: 480, resonance: 0.6, drive: 1.4, level: 0.82 }),
    padTimbre: t({ cutoff: 1100, resonance: 0.3, attack: 1.0, release: 2.0, level: 0.32 }),
    textureTimbre: t({ cutoff: 2400, resonance: 0.45, attack: 2.5, level: 0.18 }),
    fxAlgorithm1: 'shimmer', fxAlgorithm2: 'doubledelay', fxMix: 0.28,
    evolutionRate: 0.3, spectralMotion: 0.35,
    energyCurve: [0.25, 0.4, 0.55, 0.7, 0.8, 0.7, 0.55, 0.35],
    darkness: 0.5, brightness: 0.45, psychedelia: 0.5, aggression: 0.3,
  },
  'hypnotic': {
    id: 'hypnotic', name: 'Hypnotic',
    description: 'Repetitive, trance-inducing, minimal. Dorian, 128-135 BPM.',
    bpmRange: [126, 136], defaultBpm: 130,
    scales: ['dorian', 'minor'], defaultScale: 'dorian',
    rootRange: [42, 48],
    kickPattern: 'x...x...x...x...',
    bassPattern: '.x.x.x.x.x.x.x.x',
    clapPattern: '..............x.',
    percPattern: '................',
    arpPattern: [0,4,0,4,0,7,0,7],
    hatDensity: 0.2, percDensity: 0.15, swing: 0.1,
    leadTimbre: t({ cutoff: 1800, resonance: 0.45, attack: 0.01, level: 0.4 }),
    bassTimbre: t({ oscShape: 'saw', cutoff: 460, resonance: 0.65, drive: 1.5, level: 0.85 }),
    padTimbre: t({ cutoff: 1200, resonance: 0.35, attack: 1.5, release: 2.5, level: 0.3 }),
    textureTimbre: t({ cutoff: 2200, resonance: 0.5, attack: 3.0, level: 0.2 }),
    fxAlgorithm1: 'modfilter', fxAlgorithm2: 'doubledelay', fxMix: 0.3,
    evolutionRate: 0.25, spectralMotion: 0.3,
    energyCurve: [0.3, 0.4, 0.5, 0.65, 0.75, 0.7, 0.55, 0.4],
    darkness: 0.4, brightness: 0.5, psychedelia: 0.45, aggression: 0.25,
  },
  'cosmic': {
    id: 'cosmic', name: 'Cosmic',
    description: 'Spacious, ethereal, drifting. Lydian/dorian, 132-142 BPM.',
    bpmRange: [130, 144], defaultBpm: 136,
    scales: ['dorian', 'minor', 'minorPentatonic'], defaultScale: 'dorian',
    rootRange: [43, 49],
    kickPattern: 'x...x...x...x...',
    bassPattern: '.x...x...x...x..',
    clapPattern: '....x.......x...',
    percPattern: '...x...x...x...x',
    arpPattern: [0,7,4,9,7,4,0,9],
    hatDensity: 0.3, percDensity: 0.25, swing: 0.06,
    leadTimbre: t({ cutoff: 2800, resonance: 0.3, attack: 0.02, level: 0.5 }),
    bassTimbre: t({ oscShape: 'saw', cutoff: 520, resonance: 0.5, drive: 1.2, level: 0.8 }),
    padTimbre: t({ cutoff: 2000, resonance: 0.2, attack: 0.8, release: 2.5, level: 0.42 }),
    textureTimbre: t({ cutoff: 3500, resonance: 0.4, attack: 2.0, level: 0.28 }),
    fxAlgorithm1: 'blackhole', fxAlgorithm2: 'shimmer', fxMix: 0.4,
    evolutionRate: 0.4, spectralMotion: 0.55,
    energyCurve: [0.3, 0.45, 0.6, 0.75, 0.85, 0.75, 0.6, 0.4],
    darkness: 0.3, brightness: 0.7, psychedelia: 0.75, aggression: 0.3,
  },
  'organic-psy': {
    id: 'organic-psy', name: 'Organic Psy',
    description: 'Warm, natural, flowing. Dorian/minor, 134-142 BPM.',
    bpmRange: [132, 144], defaultBpm: 138,
    scales: ['dorian', 'minor', 'minorPentatonic'], defaultScale: 'dorian',
    rootRange: [42, 48],
    kickPattern: 'x...x...x..xx...',
    bassPattern: '.x.x.x.x.x.x.x.x',
    clapPattern: '....x.......x...',
    percPattern: '.x..x..x..x..x..',
    arpPattern: [0,4,7,4,9,7,4,0],
    hatDensity: 0.35, percDensity: 0.4, swing: 0.09,
    leadTimbre: t({ cutoff: 2200, resonance: 0.35, attack: 0.008, level: 0.48 }),
    bassTimbre: t({ oscShape: 'saw', cutoff: 560, resonance: 0.55, drive: 1.4, level: 0.8 }),
    padTimbre: t({ cutoff: 1600, resonance: 0.25, attack: 0.6, release: 2.0, level: 0.38 }),
    textureTimbre: t({ cutoff: 2600, resonance: 0.4, attack: 1.8, level: 0.24 }),
    fxAlgorithm1: 'warmverb', fxAlgorithm2: 'shimmer', fxMix: 0.33,
    evolutionRate: 0.38, spectralMotion: 0.42,
    energyCurve: [0.35, 0.5, 0.65, 0.8, 0.9, 0.78, 0.6, 0.4],
    darkness: 0.3, brightness: 0.6, psychedelia: 0.55, aggression: 0.35,
  },
  'acid-psy': {
    id: 'acid-psy', name: 'Acid Psy',
    description: '303-style acid lines, squelchy, driving. Minor/phrygian, 138-146 BPM.',
    bpmRange: [136, 148], defaultBpm: 142,
    scales: ['minor', 'phrygian', 'dorian'], defaultScale: 'minor',
    rootRange: [42, 48],
    kickPattern: 'x...x...x...x...',
    bassPattern: 'xxxxxxxxxxxxxxxx',
    clapPattern: '....x.......x...',
    percPattern: '..x.....x.....x.',
    arpPattern: [0,0,3,0,5,0,7,0],
    hatDensity: 0.5, percDensity: 0.35, swing: 0.05,
    leadTimbre: t({ oscShape: 'saw', cutoff: 1200, resonance: 0.9, attack: 0.002, drive: 2.5, level: 0.6 }),
    bassTimbre: t({ oscShape: 'square', cutoff: 400, resonance: 0.85, drive: 2.0, level: 0.82 }),
    padTimbre: t({ cutoff: 1400, resonance: 0.3, attack: 0.5, release: 1.8, level: 0.32 }),
    textureTimbre: t({ cutoff: 3000, resonance: 0.6, attack: 1.0, level: 0.26 }),
    fxAlgorithm1: 'psyphase', fxAlgorithm2: 'crush', fxMix: 0.35,
    evolutionRate: 0.6, spectralMotion: 0.65,
    energyCurve: [0.45, 0.6, 0.75, 0.9, 0.95, 0.85, 0.7, 0.5],
    darkness: 0.5, brightness: 0.55, psychedelia: 0.7, aggression: 0.65,
  },
};

export const WORLD_IDS = Object.keys(WORLDS) as WorldId[];
export const WORLD_LIST = WORLD_IDS.map((id) => ({ id, name: WORLDS[id].name, description: WORLDS[id].description }));
