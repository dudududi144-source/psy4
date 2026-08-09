/**
 * Forensic Worlds — Psy4World definitions for the offline renderer.
 *
 * These are the SAME params used by the realtime worklet engine.
 * Each world has different: bpm, scale, root, bass mode, density, drive,
 * kick/bass/lead/pad params.
 *
 * The question this system must answer: do these param differences actually
 * produce DIFFERENT audio output? (World differentiation test)
 */

export interface Psy4World {
  id: string;
  name: string;
  bpm: number;
  scale: string;
  root: number;
  bass: 'roll' | 'off' | 'acid';
  density: number;
  drive: number;
  swing: number;
  space: number;
  duck: number;
  acid: boolean;
  kickDecay: number;
  kickFundamental: number;
  bassCutoff: number;
  bassResonance: number;
  leadCutoff: number;
  leadDetune: number;
  padCutoff: number;
  textureLevel: number;
  energyCurve: number[];
  leadType: 'saw' | 'square' | 'triangle';
  textureType: 'noise' | 'fm' | 'wavetable';
  hatPattern: string;
  percPattern: string;
  darkness: number;
  // Optimizable level parameters (new — allow per-voice balance control)
  kickLevel?: number;
  bassLevel?: number;
  leadLevel?: number;
  hatLevel?: number;
  masterLevel?: number;
}

export const FORENSIC_WORLDS: Record<string, Psy4World> = {
  'progressive-psy': {
    id: 'progressive-psy', name: 'Progressive Psy',
    bpm: 128, scale: 'dorian', root: 48,
    bass: 'off', density: 0.5, drive: 0.3, swing: 0.1, space: 0.6, duck: 0.4,
    acid: false,
    kickDecay: 0.22, kickFundamental: 50,
    bassCutoff: 400, bassResonance: 3,
    leadCutoff: 3000, leadDetune: 10,
    padCutoff: 1200, textureLevel: 0.12,
    energyCurve: [0.3, 0.45, 0.6, 0.75, 0.9, 0.75, 0.6, 0.4],
    leadType: 'saw', textureType: 'noise',
    hatPattern: 'x.x.x.x.x.x.x.x.', percPattern: '....x.......x...',
    darkness: 0.35,
  },
  'dark-psy': {
    id: 'dark-psy', name: 'Dark Psy',
    bpm: 150, scale: 'phrygian', root: 43,
    bass: 'roll', density: 0.75, drive: 0.7, swing: 0.04, space: 0.25, duck: 0.55,
    acid: true,
    kickDecay: 0.16, kickFundamental: 48,
    bassCutoff: 300, bassResonance: 8,
    leadCutoff: 2000, leadDetune: 15,
    padCutoff: 800, textureLevel: 0.18,
    energyCurve: [0.5, 0.7, 0.85, 0.95, 0.85, 0.95, 0.7, 0.5],
    leadType: 'square', textureType: 'fm',
    hatPattern: 'x.x.x.x.x.x.x.x.', percPattern: '..x.....x.....x.',
    darkness: 0.8,
  },
  'goa': {
    id: 'goa', name: 'Goa',
    bpm: 140, scale: 'phrygianDominant', root: 45,
    bass: 'roll', density: 0.7, drive: 0.5, swing: 0.05, space: 0.5, duck: 0.5,
    acid: true,
    kickDecay: 0.2, kickFundamental: 52,
    bassCutoff: 500, bassResonance: 10,
    leadCutoff: 4000, leadDetune: 20,
    padCutoff: 1500, textureLevel: 0.15,
    energyCurve: [0.35, 0.5, 0.7, 0.85, 0.95, 0.85, 0.7, 0.5],
    leadType: 'saw', textureType: 'wavetable',
    hatPattern: 'x.x.x.x.x.x.x.x.', percPattern: '....x...x...x...',
    darkness: 0.45,
  },
  'morning-psy': {
    id: 'morning-psy', name: 'Morning Psy',
    bpm: 142, scale: 'dorian', root: 50,
    bass: 'off', density: 0.65, drive: 0.35, swing: 0.06, space: 0.55, duck: 0.42,
    acid: false,
    kickDecay: 0.2, kickFundamental: 54,
    bassCutoff: 550, bassResonance: 4,
    leadCutoff: 3500, leadDetune: 12,
    padCutoff: 1800, textureLevel: 0.14,
    energyCurve: [0.4, 0.55, 0.7, 0.85, 0.95, 0.8, 0.65, 0.45],
    leadType: 'triangle', textureType: 'noise',
    hatPattern: 'x.x.x.x.x.x.x.x.', percPattern: '......x.......x.',
    darkness: 0.2,
  },
  'forest': {
    id: 'forest', name: 'Forest',
    bpm: 148, scale: 'minor', root: 44,
    bass: 'roll', density: 0.7, drive: 0.6, swing: 0.04, space: 0.3, duck: 0.5,
    acid: false,
    kickDecay: 0.18, kickFundamental: 46,
    bassCutoff: 350, bassResonance: 6,
    leadCutoff: 2200, leadDetune: 14,
    padCutoff: 1000, textureLevel: 0.2,
    energyCurve: [0.4, 0.6, 0.75, 0.9, 0.85, 0.9, 0.65, 0.45],
    leadType: 'square', textureType: 'fm',
    hatPattern: 'x.x.x.x.x.x.x.x.', percPattern: '.x...x...x...x...',
    darkness: 0.65,
  },
  'acid-psy': {
    id: 'acid-psy', name: 'Acid Psy',
    bpm: 142, scale: 'minor', root: 45,
    bass: 'acid', density: 0.7, drive: 0.65, swing: 0.05, space: 0.35, duck: 0.5,
    acid: true,
    kickDecay: 0.19, kickFundamental: 50,
    bassCutoff: 600, bassResonance: 14,
    leadCutoff: 2500, leadDetune: 18,
    padCutoff: 1200, textureLevel: 0.13,
    energyCurve: [0.45, 0.6, 0.75, 0.9, 0.95, 0.85, 0.7, 0.5],
    leadType: 'saw', textureType: 'fm',
    hatPattern: 'x.x.x.x.x.x.x.x.', percPattern: '..x.....x.....x.',
    darkness: 0.5,
  },
};

export const FORENSIC_WORLD_IDS = Object.keys(FORENSIC_WORLDS);
