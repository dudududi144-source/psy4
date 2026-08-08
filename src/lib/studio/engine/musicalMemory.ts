/**
 * MUSICAL MEMORY ENGINE — persistent musical state.
 *
 * The engine remembers what it has done so variations feel like "the same
 * musical idea evolving" rather than "a completely new random song."
 *
 * REAL IMPLEMENTATION.
 */

import { Rng } from '../rng';
import { SCALES, scaleNote } from '../dsp/wavetable';
import { World, WorldId } from './worlds';

export interface Motif {
  id: string;
  notes: number[];          // scale degrees (relative)
  rhythm: number[];         // step indices (0..15) where notes fire
  velocities: number[];
  bornAt: number;           // bar when created
  mutationCount: number;
}

export interface MusicalMemory {
  // identity
  worldId: WorldId;
  seed: number;
  songId: string;
  // harmonic
  currentKey: number;       // MIDI root
  currentScale: string;
  currentTempo: number;
  currentMeter: number;     // beats per bar
  // motifs (the musical memory)
  bassMotif: Motif;
  leadMotif: Motif;
  rhythmMotif: Motif;
  percussionMotif: Motif;
  arpMotif: Motif;
  atmosphereMotif: Motif;
  // macro state (user intent, 0..1)
  energy: number;
  density: number;
  tension: number;
  psychedelia: number;
  darkness: number;
  brightness: number;
  groove: number;
  evolution: number;
  space: number;
  surprise: number;
  aggression: number;
  // journey
  currentSection: string;
  currentBar: number;
  currentPhrase: number;    // 4-bar phrase index
  journeyPosition: number; // 0..1 through the whole journey
  // history (for memory-aware generation)
  recentEvents: { bar: number; type: string; detail: string }[];
  recentMotifs: string[];
  recentTransitions: string[];
  // evolution tracking
  timbreState: number;      // 0..1 wavetable position
  spectralState: number;    // 0..1 spectral centroid normalized
  totalMutations: number;
}

export interface MacroControls {
  energy: number;       // 0..1
  psychedelia: number;  // 0..1
  darkness: number;     // 0..1
  density: number;      // 0..1
  groove: number;       // 0..1
  evolution: number;    // 0..1
  space: number;        // 0..1
  surprise: number;     // 0..1
  aggression: number;   // 0..1
  brightness: number;   // 0..1
}

export const DEFAULT_MACROS: MacroControls = {
  energy: 0.6, psychedelia: 0.55, darkness: 0.4, density: 0.55,
  groove: 0.5, evolution: 0.5, space: 0.4, surprise: 0.3,
  aggression: 0.4, brightness: 0.55,
};

/** Initialize musical memory from a world + macros. */
export function initMemory(world: World, macros: MacroControls, seed: number): MusicalMemory {
  const rng = new Rng(seed);
  const root = rng.int(world.rootRange[0], world.rootRange[1]);
  const scale = world.defaultScale;
  const bpm = world.defaultBpm;

  // generate initial motifs
  const bassMotif = generateBassMotif(rng, 0);
  const leadMotif = generateLeadMotif(rng, 0);
  const rhythmMotif = generateRhythmMotif(world, rng, 0);
  const percussionMotif = generatePercMotif(world, rng, 0);
  const arpMotif = generateArpMotif(rng, 0);
  const atmosphereMotif = generateAtmosphereMotif(rng, 0);

  return {
    worldId: world.id,
    seed,
    songId: `song-${seed.toString(36)}-${Date.now().toString(36)}`,
    currentKey: root,
    currentScale: scale,
    currentTempo: bpm,
    currentMeter: 4,
    bassMotif, leadMotif, rhythmMotif, percussionMotif, arpMotif, atmosphereMotif,
    energy: macros.energy,
    density: macros.density,
    tension: 0.3,
    psychedelia: macros.psychedelia,
    darkness: macros.darkness,
    brightness: macros.brightness,
    groove: macros.groove,
    evolution: macros.evolution,
    space: macros.space,
    surprise: macros.surprise,
    aggression: macros.aggression,
    currentSection: 'intro',
    currentBar: 0,
    currentPhrase: 0,
    journeyPosition: 0,
    recentEvents: [],
    recentMotifs: [bassMotif.id, leadMotif.id],
    recentTransitions: [],
    timbreState: 0.5,
    spectralState: 0.5,
    totalMutations: 0,
  };
}

// --- Motif generators ---

function generateBassMotif(rng: Rng, bornAt: number): Motif {
  // psytrance bass: off-beat 16ths, root + occasional fifth/octave
  const notes: number[] = [];
  const rhythm: number[] = [];
  const velocities: number[] = [];
  for (let s = 0; s < 16; s++) {
    if (s % 2 === 1) {
      rhythm.push(s);
      // mostly root (degree 0), sometimes fifth (degree 4) or octave (degree 7)
      const degree = rng.pick([0, 0, 0, 0, 4, 0, 7, 0]);
      notes.push(degree);
      velocities.push(0.8 + rng.next() * 0.15);
    }
  }
  return { id: `bass-${rng.nextUint32().toString(36)}`, notes, rhythm, velocities, bornAt, mutationCount: 0 };
}

function generateLeadMotif(rng: Rng, bornAt: number): Motif {
  // lead: sparse melodic motif, stepwise motion within a small range
  const notes: number[] = [];
  const rhythm: number[] = [];
  const velocities: number[] = [];
  let prev = 0;
  const numNotes = rng.int(3, 6);
  for (let i = 0; i < numNotes; i++) {
    const step = rng.pick([-2, -1, -1, 0, 1, 1, 2]);
    prev = Math.max(-3, Math.min(5, prev + step));
    notes.push(prev);
    rhythm.push(rng.int(0, 15));
    velocities.push(0.5 + rng.next() * 0.3);
  }
  // sort by rhythm position
  const order = rhythm.map((r, i) => ({ r, n: notes[i], v: velocities[i] })).sort((a, b) => a.r - b.r);
  return {
    id: `lead-${rng.nextUint32().toString(36)}`,
    notes: order.map((o) => o.n),
    rhythm: order.map((o) => o.r),
    velocities: order.map((o) => o.v),
    bornAt, mutationCount: 0,
  };
}

function generateRhythmMotif(world: World, rng: Rng, bornAt: number): Motif {
  // kick: 4-on-floor (fixed for psytrance identity)
  const rhythm: number[] = [0, 4, 8, 12];
  const notes: number[] = [0, 0, 0, 0];
  const velocities: number[] = [0.95, 0.92, 0.95, 0.92];
  return { id: `rhythm-${rng.nextUint32().toString(36)}`, notes, rhythm, velocities, bornAt, mutationCount: 0 };
}

function generatePercMotif(world: World, rng: Rng, bornAt: number): Motif {
  // hats + snares: probability-based
  const rhythm: number[] = [];
  const notes: number[] = [];
  const velocities: number[] = [];
  for (let s = 0; s < 16; s++) {
    if (s % 4 === 2 && rng.chance(0.7)) { // snare on 2 & 4
      rhythm.push(s); notes.push(1); velocities.push(0.5 + rng.next() * 0.2);
    }
    if (s % 2 === 1 && rng.chance(world.hatDensity)) { // hats on off-beats
      rhythm.push(s); notes.push(2); velocities.push(0.3 + rng.next() * 0.2);
    }
  }
  return { id: `perc-${rng.nextUint32().toString(36)}`, notes, rhythm, velocities, bornAt, mutationCount: 0 };
}

function generateArpMotif(rng: Rng, bornAt: number): Motif {
  // arp: ascending scale degrees
  const rhythm: number[] = [];
  const notes: number[] = [];
  const velocities: number[] = [];
  const pattern = [0, 2, 4, 7, 4, 2];
  for (let i = 0; i < pattern.length; i++) {
    rhythm.push(i * 2 + 1);
    notes.push(pattern[i]);
    velocities.push(0.4 + rng.next() * 0.2);
  }
  return { id: `arp-${rng.nextUint32().toString(36)}`, notes, rhythm, velocities, bornAt, mutationCount: 0 };
}

function generateAtmosphereMotif(rng: Rng, bornAt: number): Motif {
  // atmosphere: long sustained chord degrees
  const notes = [0, 3, 7]; // minor triad
  return {
    id: `atm-${rng.nextUint32().toString(36)}`,
    notes,
    rhythm: [0],
    velocities: [0.4],
    bornAt, mutationCount: 0,
  };
}

// --- Motif mutation (controlled evolution) ---

export function mutateMotif(motif: Motif, rng: Rng, intensity: number): Motif {
  const newNotes = [...motif.notes];
  const newRhythm = [...motif.rhythm];
  const newVelocities = [...motif.velocities];
  // mutate ONE element (controlled, not chaotic)
  if (newNotes.length > 0 && rng.chance(intensity)) {
    const idx = rng.int(0, newNotes.length - 1);
    const step = rng.pick([-2, -1, 1, 2]);
    newNotes[idx] = Math.max(-5, Math.min(7, newNotes[idx] + step));
  }
  if (newRhythm.length > 0 && rng.chance(intensity * 0.5)) {
    const idx = rng.int(0, newRhythm.length - 1);
    newRhythm[idx] = Math.max(0, Math.min(15, newRhythm[idx] + rng.pick([-1, 1])));
  }
  return {
    ...motif,
    notes: newNotes,
    rhythm: newRhythm,
    velocities: newVelocities,
    mutationCount: motif.mutationCount + 1,
    id: `${motif.id}-m${motif.mutationCount + 1}`,
  };
}

// --- Memory update ---

export function advanceMemory(memory: MusicalMemory, bar: number): MusicalMemory {
  return {
    ...memory,
    currentBar: bar,
    currentPhrase: Math.floor(bar / 4),
    journeyPosition: bar > 0 ? Math.min(1, bar / 64) : 0,
  };
}

export function recordEvent(memory: MusicalMemory, type: string, detail: string): MusicalMemory {
  const event = { bar: memory.currentBar, type, detail };
  const recent = [...memory.recentEvents, event].slice(-50);
  return { ...memory, recentEvents: recent };
}

/** Resolve a motif's scale-degree notes to absolute MIDI notes. */
export function resolveMotifNotes(motif: Motif, root: number, scaleName: string): { note: number; step: number; velocity: number }[] {
  const scale = SCALES[scaleName] || SCALES.minor;
  return motif.rhythm.map((step, i) => ({
    note: scaleNote(root, scale, motif.notes[i] || 0),
    step,
    velocity: motif.velocities[i] || 0.7,
  }));
}
