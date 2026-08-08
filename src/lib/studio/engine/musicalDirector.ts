/**
 * MUSICAL DIRECTOR — the conductor.
 *
 * Decides:
 *   - when to introduce/remove/mutate material
 *   - when to transition sections
 *   - when to create tension/release
 *   - when to introduce a new motif or revisit an old one
 *
 * Driven by: musical memory + macro controls + arrangement energy curve.
 * Deterministic under the same seed/configuration.
 *
 * REAL IMPLEMENTATION.
 */

import { MusicalMemory, MacroControls, Motif, mutateMotif, recordEvent, advanceMemory } from './musicalMemory';
import { World } from './worlds';
import { Rng } from '../rng';

export type SectionType = 'intro' | 'groove' | 'development' | 'tension' | 'build' | 'drop' | 'breakdown' | 'rebuild' | 'second-drop' | 'climax' | 'outro';

export interface ArrangementSection {
  type: SectionType;
  bars: number;
  energy: number;        // 0..1 target energy for this section
  density: number;       // 0..1 target density
  tension: number;       // 0..1 target tension
  activeLayers: LayerId[];
}

export type LayerId = 'kick' | 'bass' | 'lead' | 'pad' | 'texture' | 'arp' | 'hats' | 'perc' | 'fx';

export interface DirectorDecision {
  bar: number;
  section: SectionType;
  activeLayers: LayerId[];
  /** Should we mutate motifs this bar? */
  mutate: { layer: LayerId; intensity: number }[];
  /** Energy/density/tension targets (interpolated). */
  energy: number;
  density: number;
  tension: number;
  /** FX program changes. */
  fxAlgorithm1?: string;
  fxAlgorithm2?: string;
  /** Events to record. */
  events: string[];
}

/** Build a complete arrangement from a world + macros. */
export function buildArrangement(world: World, macros: MacroControls): ArrangementSection[] {
  const e = world.energyCurve;
  // map the 8-point energy curve to 11 sections
  // intro → groove → development → tension → build → drop → development → breakdown → rebuild → second-drop → outro
  const baseEnergy = macros.energy;
  const sections: ArrangementSection[] = [
    { type: 'intro', bars: 8, energy: e[0] * baseEnergy, density: 0.25, tension: 0.2, activeLayers: ['pad', 'texture'] },
    { type: 'groove', bars: 8, energy: e[1] * baseEnergy, density: 0.45, tension: 0.3, activeLayers: ['kick', 'bass', 'pad', 'hats'] },
    { type: 'development', bars: 8, energy: e[2] * baseEnergy, density: 0.55, tension: 0.4, activeLayers: ['kick', 'bass', 'lead', 'pad', 'hats', 'perc'] },
    { type: 'tension', bars: 8, energy: e[3] * baseEnergy, density: 0.6, tension: 0.7, activeLayers: ['kick', 'bass', 'lead', 'pad', 'hats', 'perc', 'arp'] },
    { type: 'build', bars: 4, energy: e[4] * baseEnergy, density: 0.7, tension: 0.85, activeLayers: ['kick', 'bass', 'lead', 'arp', 'hats', 'perc', 'fx'] },
    { type: 'drop', bars: 16, energy: e[4] * baseEnergy, density: 0.85, tension: 0.5, activeLayers: ['kick', 'bass', 'lead', 'pad', 'texture', 'hats', 'perc', 'fx'] },
    { type: 'development', bars: 8, energy: e[5] * baseEnergy, density: 0.65, tension: 0.45, activeLayers: ['kick', 'bass', 'lead', 'pad', 'hats', 'perc'] },
    { type: 'breakdown', bars: 8, energy: e[6] * baseEnergy * 0.5, density: 0.3, tension: 0.35, activeLayers: ['pad', 'texture', 'fx'] },
    { type: 'rebuild', bars: 8, energy: e[6] * baseEnergy, density: 0.55, tension: 0.7, activeLayers: ['kick', 'bass', 'lead', 'arp', 'hats', 'fx'] },
    { type: 'second-drop', bars: 16, energy: e[4] * baseEnergy, density: 0.9, tension: 0.55, activeLayers: ['kick', 'bass', 'lead', 'pad', 'texture', 'arp', 'hats', 'perc', 'fx'] },
    { type: 'outro', bars: 8, energy: e[7] * baseEnergy * 0.6, density: 0.3, tension: 0.2, activeLayers: ['pad', 'texture', 'hats'] },
  ];
  return sections;
}

/** The Musical Director decides what to do at each bar. */
export function decideForBar(
  memory: MusicalMemory,
  world: World,
  macros: MacroControls,
  arrangement: ArrangementSection[],
  rng: Rng
): { decision: DirectorDecision; memory: MusicalMemory } {
  const bar = memory.currentBar;
  // find current section
  let acc = 0;
  let section = arrangement[0];
  let sectionIndex = 0;
  for (let i = 0; i < arrangement.length; i++) {
    if (bar >= acc && bar < acc + arrangement[i].bars) {
      section = arrangement[i];
      sectionIndex = i;
      break;
    }
    acc += arrangement[i].bars;
  }

  // interpolate energy/density/tension within section
  const sectionProgress = (bar - acc) / Math.max(1, section.bars);
  const energy = section.energy;
  const density = section.density;
  const tension = section.tension + (section.type === 'build' ? sectionProgress * 0.3 : 0);

  // decide mutations
  const mutate: { layer: LayerId; intensity: number }[] = [];
  const events: string[] = [];

  // mutate motifs based on evolution macro + section type
  const evoRate = macros.evolution * world.evolutionRate;
  if (rng.chance(evoRate * 0.3)) {
    mutate.push({ layer: 'lead', intensity: evoRate });
    events.push(`lead mutated`);
  }
  if (rng.chance(evoRate * 0.2)) {
    mutate.push({ layer: 'bass', intensity: evoRate * 0.5 });
    events.push(`bass mutated`);
  }
  if (rng.chance(evoRate * 0.25)) {
    mutate.push({ layer: 'arp', intensity: evoRate * 0.7 });
    events.push(`arp mutated`);
  }
  if (rng.chance(evoRate * 0.15)) {
    mutate.push({ layer: 'perc', intensity: evoRate * 0.6 });
    events.push(`perc mutated`);
  }

  // FX program changes at section boundaries
  let fxAlgorithm1: string | undefined;
  let fxAlgorithm2: string | undefined;
  if (bar === acc && sectionIndex > 0) {
    // section transition
    events.push(`section transition: ${section.type}`);
    if (section.type === 'breakdown') {
      fxAlgorithm1 = 'blackhole'; fxAlgorithm2 = 'shimmer';
    } else if (section.type === 'drop' || section.type === 'second-drop') {
      fxAlgorithm1 = world.fxAlgorithm1; fxAlgorithm2 = world.fxAlgorithm2;
    } else if (section.type === 'build') {
      fxAlgorithm1 = 'psyphase'; fxAlgorithm2 = 'modfilter';
    }
  }

  // surprise: occasionally introduce a random fill or effect
  if (rng.chance(macros.surprise * 0.1)) {
    events.push('surprise fill');
    mutate.push({ layer: 'perc', intensity: 0.8 });
  }

  const decision: DirectorDecision = {
    bar,
    section: section.type,
    activeLayers: section.activeLayers,
    mutate,
    energy, density, tension,
    fxAlgorithm1, fxAlgorithm2,
    events,
  };

  let newMemory = recordEvent(memory, 'director', `bar ${bar}: ${section.type} e=${energy.toFixed(2)} d=${density.toFixed(2)} t=${tension.toFixed(2)}`);
  newMemory = advanceMemory(newMemory, bar + 1);
  newMemory = {
    ...newMemory,
    currentSection: section.type,
    energy, density, tension,
    totalMutations: newMemory.totalMutations + mutate.length,
  };

  return { decision, memory: newMemory };
}

/** Apply a macro control change (e.g. user moves "psychedelia" slider). */
export function applyMacroChange(memory: MusicalMemory, changes: Partial<MacroControls>): MusicalMemory {
  return { ...memory, ...changes };
}

/** Apply an action button (e.g. "STRANGER", "DARKER", "DROP"). */
export function applyAction(memory: MusicalMemory, action: string, world: World): MusicalMemory {
  switch (action.toLowerCase()) {
    case 'stranger':
      return { ...memory, psychedelia: Math.min(1, memory.psychedelia + 0.2), evolution: Math.min(1, memory.evolution + 0.2), surprise: Math.min(1, memory.surprise + 0.15) };
    case 'darker':
      return { ...memory, darkness: Math.min(1, memory.darkness + 0.2), brightness: Math.max(0, memory.brightness - 0.15) };
    case 'brighter':
      return { ...memory, brightness: Math.min(1, memory.brightness + 0.2), darkness: Math.max(0, memory.darkness - 0.15) };
    case 'more-bass':
      return { ...memory, energy: Math.min(1, memory.energy + 0.15), aggression: Math.min(1, memory.aggression + 0.1) };
    case 'more-groove':
      return { ...memory, groove: Math.min(1, memory.groove + 0.2), density: Math.min(1, memory.density + 0.1) };
    case 'breakdown':
      return { ...memory, energy: Math.max(0.1, memory.energy * 0.4), density: Math.max(0.1, memory.density * 0.4), space: Math.min(1, memory.space + 0.3) };
    case 'build':
      return { ...memory, energy: Math.min(1, memory.energy + 0.2), tension: Math.min(1, memory.tension + 0.3), density: Math.min(1, memory.density + 0.15) };
    case 'drop':
      return { ...memory, energy: 1, density: 0.9, tension: 0.5, aggression: Math.min(1, memory.aggression + 0.2) };
    case 'more-space':
      return { ...memory, space: Math.min(1, memory.space + 0.25) };
    case 'reset':
      return { ...memory, energy: 0.6, psychedelia: 0.55, darkness: 0.4, density: 0.55, groove: 0.5, evolution: 0.5, space: 0.4, surprise: 0.3, aggression: 0.4, brightness: 0.55, tension: 0.3 };
    default:
      return memory;
  }
}
