/**
 * PSY SOUND BANK — Preset Library (FUTURE MATERIAL — R4/R7 classification)
 *
 * STATUS: VERIFIED DATA — NOT CONNECTED TO RUNTIME
 *
 * Contains 142 valid presets (0 NaN, 0 missing fields, verified by SB-6A test).
 * However, these presets are NOT used by the live runtime engine (psyLive.ts).
 * The runtime uses 4 hardcoded presets with inline Web Audio synthesis.
 *
 * CLASSIFICATION: FUTURE MATERIAL LIBRARY
 *   - Data is valid and well-formed
 *   - Not connected to runtime (getById/autoSelect not called)
 *   - To be wired in a future iteration after runtime verification
 *
 * ARCHITECTURE:
 *   - 8 categories: drum, bass, lead, pad, pluck, arp, fx, texture
 *   - 6 genres: PSYTRANCE, TECHNO, TRANCE, PROGRESSIVE, DARK-PSY, GOA
 *   - 142 presets total (each with full parameter spec)
 *   - Unified parameter schema (works with PooledEngine)
 *
 * Each preset defines:
 *   - engine: DRUM | SYNTH | FM | NOISE
 *   - Full ADSR envelope
 *   - Filter (type, cutoff, resonance, envelope)
 *   - LFO (rate, depth, destination)
 *   - Effects sends (delay, reverb)
 *   - Genre tags (for auto-selection by learning system)
 */

// ─── Types ─────────────────────────────────────────────────────────────────
export type EngineType = 'DRUM' | 'SYNTH' | 'FM' | 'NOISE' | 'WAVETABLE';
export type DrumType = 'kick' | 'snare' | 'clap' | 'hatC' | 'hatO' | 'tom' | 'rim' | 'glitch' | 'shaker' | 'riser' | 'impact' | 'downlifter';
export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'allpass';
export type LFODest = 'off' | 'cutoff' | 'pitch' | 'amp' | 'pan';
export type Genre = 'PSYTRANCE' | 'TECHNO' | 'TRANCE' | 'PROGRESSIVE' | 'DARK-PSY' | 'GOA' | 'ANY';
export type Category = 'drum' | 'bass' | 'lead' | 'pad' | 'pluck' | 'arp' | 'fx' | 'texture';

export interface SoundPreset {
  id: string;
  name: string;
  genre: Genre;
  cat: Category;
  engine: EngineType;

  // Drum-specific
  drumType?: DrumType;
  tune?: number;
  decay?: number;
  tone?: number;
  punch?: number;

  // Synth oscillators
  wave1?: OscillatorType;
  wave2?: OscillatorType;
  oct2?: number;       // octave offset for osc2
  detune?: number;     // cents
  fmAmount?: number;   // for FM engine
  fmRatio?: number;    // carrier:modulator ratio

  // Filter
  fType?: FilterType;
  cutoff?: number;
  res?: number;
  fEnvAmt?: number;    // filter envelope amount
  fDecay?: number;     // filter envelope decay

  // Amp envelope (ADSR)
  atk?: number;
  dec?: number;
  sus?: number;
  rel?: number;
  gate?: number;       // note gate (multiplier of step duration)

  // LFO
  lfoRate?: number;
  lfoDepth?: number;
  lfoDest?: LFODest;
  lfoShape?: OscillatorType;

  // Effects sends
  sendDelay?: number;  // 0-1
  sendReverb?: number; // 0-1

  // Polyphony
  poly?: number;

  // Velocity sensitivity
  velSens?: number;    // 0-1

  // Musical context (for learning system auto-selection)
  scaleDegrees?: number[]; // which scale degrees this fits (e.g., [0, 4, 7] = root, 3rd, 5th)
  energyLevel?: number;    // 0-1, how energetic
  moodTags?: string[];     // ['dark', 'hypnotic', 'uplifting', 'aggressive', 'ethereal']
}

// ─── DRUM PRESETS (40 drums) ──────────────────────────────────────────────
export const DRUMS: SoundPreset[] = [
  // PSYTRANCE drums (12)
  { id: 'PSY-KICK-DEEP', name: 'Psy Deep Kick', genre: 'PSYTRANCE', cat: 'drum', engine: 'DRUM', drumType: 'kick', tune: 0.7, decay: 1.15, punch: 0.4, sendReverb: 0.05 },
  { id: 'PSY-KICK-TIGHT', name: 'Psy Tight Kick', genre: 'PSYTRANCE', cat: 'drum', engine: 'DRUM', drumType: 'kick', tune: 0.9, decay: 0.5, punch: 0.85 },
  { id: 'PSY-KICK-PUNCHY', name: 'Psy Punchy Kick', genre: 'PSYTRANCE', cat: 'drum', engine: 'DRUM', drumType: 'kick', tune: 0.8, decay: 0.7, punch: 0.95 },
  { id: 'PSY-KICK-SUB', name: 'Psy Sub Kick', genre: 'PSYTRANCE', cat: 'drum', engine: 'DRUM', drumType: 'kick', tune: 0.6, decay: 1.4, punch: 0.2, sendReverb: 0.08 },
  { id: 'PSY-SNARE-TIGHT', name: 'Psy Tight Snare', genre: 'PSYTRANCE', cat: 'drum', engine: 'DRUM', drumType: 'snare', tune: 1.1, decay: 0.6, tone: 1.3, sendReverb: 0.15 },
  { id: 'PSY-SNARE-OPEN', name: 'Psy Open Snare', genre: 'PSYTRANCE', cat: 'drum', engine: 'DRUM', drumType: 'snare', tune: 0.95, decay: 1.0, tone: 1.1, sendReverb: 0.25 },
  { id: 'PSY-CLAP-LAYER', name: 'Psy Layered Clap', genre: 'PSYTRANCE', cat: 'drum', engine: 'DRUM', drumType: 'clap', decay: 1.8, tone: 0.9, sendReverb: 0.2 },
  { id: 'PSY-HAT-BRIGHT', name: 'Psy Bright Hat', genre: 'PSYTRANCE', cat: 'drum', engine: 'DRUM', drumType: 'hatC', decay: 0.32, tone: 1.5 },
  { id: 'PSY-HAT-OPEN', name: 'Psy Open Hat', genre: 'PSYTRANCE', cat: 'drum', engine: 'DRUM', drumType: 'hatO', decay: 0.6, tone: 1.3 },
  { id: 'PSY-PERC-ROLL', name: 'Psy Rolling Perc', genre: 'PSYTRANCE', cat: 'drum', engine: 'DRUM', drumType: 'tom', tune: 1.2, decay: 0.5 },
  { id: 'PSY-PERC-TOM', name: 'Psy Deep Tom', genre: 'PSYTRANCE', cat: 'drum', engine: 'DRUM', drumType: 'tom', tune: 0.8, decay: 0.8 },
  { id: 'PSY-GLITCH', name: 'Psy Glitch', genre: 'PSYTRANCE', cat: 'drum', engine: 'DRUM', drumType: 'glitch', tone: 0.8, decay: 1.2 },

  // TECHNO drums (8)
  { id: 'TEC-KICK-SUB', name: 'Techno Sub Kick', genre: 'TECHNO', cat: 'drum', engine: 'DRUM', drumType: 'kick', tune: 0.85, decay: 1.6, punch: 0.1 },
  { id: 'TEC-KICK-PUNCH', name: 'Techno Punch Kick', genre: 'TECHNO', cat: 'drum', engine: 'DRUM', drumType: 'kick', tune: 1.15, decay: 0.7, punch: 0.9 },
  { id: 'TEC-KICK-HARD', name: 'Techno Hard Kick', genre: 'TECHNO', cat: 'drum', engine: 'DRUM', drumType: 'kick', tune: 1.0, decay: 1.1, punch: 0.7 },
  { id: 'TEC-KICK-RUMBLE', name: 'Techno Rumble Kick', genre: 'TECHNO', cat: 'drum', engine: 'DRUM', drumType: 'kick', tune: 0.75, decay: 2.4, punch: 0.2 },
  { id: 'TEC-SNARE-TIGHT', name: 'Techno Tight Snare', genre: 'TECHNO', cat: 'drum', engine: 'DRUM', drumType: 'snare', tune: 1.1, decay: 0.6, tone: 1.3 },
  { id: 'TEC-HAT-CRISP', name: 'Techno Crisp Hat', genre: 'TECHNO', cat: 'drum', engine: 'DRUM', drumType: 'hatC', decay: 0.5 },
  { id: 'TEC-HAT-OPEN', name: 'Techno Open Hat', genre: 'TECHNO', cat: 'drum', engine: 'DRUM', drumType: 'hatO', decay: 0.9 },
  { id: 'TEC-PERC-METAL', name: 'Techno Metal Perc', genre: 'TECHNO', cat: 'drum', engine: 'DRUM', drumType: 'rim', tune: 1.0, tone: 1.6 },

  // TRANCE drums (8)
  { id: 'TRA-KICK-PUNCH', name: 'Trance Punch Kick', genre: 'TRANCE', cat: 'drum', engine: 'DRUM', drumType: 'kick', tune: 1.05, decay: 0.85, punch: 0.85 },
  { id: 'TRA-KICK-SOFT', name: 'Trance Soft Kick', genre: 'TRANCE', cat: 'drum', engine: 'DRUM', drumType: 'kick', tune: 0.95, decay: 0.7, punch: 0.4 },
  { id: 'TRA-CLAP-LAYER', name: 'Trance Layered Clap', genre: 'TRANCE', cat: 'drum', engine: 'DRUM', drumType: 'clap', decay: 1.6, tone: 0.9, sendReverb: 0.3 },
  { id: 'TRA-SNARE-OPEN', name: 'Trance Open Snare', genre: 'TRANCE', cat: 'drum', engine: 'DRUM', drumType: 'snare', tune: 1.0, decay: 1.2, tone: 1.0, sendReverb: 0.35 },
  { id: 'TRA-HAT-OPEN', name: 'Trance Open Hat', genre: 'TRANCE', cat: 'drum', engine: 'DRUM', drumType: 'hatO', decay: 0.6 },
  { id: 'TRA-HAT-CRISP', name: 'Trance Crisp Hat', genre: 'TRANCE', cat: 'drum', engine: 'DRUM', drumType: 'hatC', decay: 0.4, tone: 1.2 },
  { id: 'TRA-PERC-TOM', name: 'Trance Tom', genre: 'TRANCE', cat: 'drum', engine: 'DRUM', drumType: 'tom', tune: 0.85, decay: 0.9 },
  { id: 'TRA-SHAKER', name: 'Trance Shaker', genre: 'TRANCE', cat: 'drum', engine: 'DRUM', drumType: 'shaker', decay: 0.5, tone: 0.9 },

  // PROGRESSIVE drums (6)
  { id: 'PRO-KICK-SOFT', name: 'Prog Soft Kick', genre: 'PROGRESSIVE', cat: 'drum', engine: 'DRUM', drumType: 'kick', tune: 0.9, decay: 1.0, punch: 0.25 },
  { id: 'PRO-PERC-ORG', name: 'Prog Organic Perc', genre: 'PROGRESSIVE', cat: 'drum', engine: 'DRUM', drumType: 'tom', tune: 0.85, decay: 0.9, tone: 0.9 },
  { id: 'PRO-HAT-SOFT', name: 'Prog Soft Hat', genre: 'PROGRESSIVE', cat: 'drum', engine: 'DRUM', drumType: 'hatC', decay: 0.6, tone: 0.7 },
  { id: 'PRO-SHAKER', name: 'Prog Shaker', genre: 'PROGRESSIVE', cat: 'drum', engine: 'DRUM', drumType: 'shaker', decay: 0.5 },
  { id: 'PRO-CLAP-WARM', name: 'Prog Warm Clap', genre: 'PROGRESSIVE', cat: 'drum', engine: 'DRUM', drumType: 'clap', decay: 1.2, tone: 0.8, sendReverb: 0.2 },
  { id: 'PRO-RIM', name: 'Prog Rim', genre: 'PROGRESSIVE', cat: 'drum', engine: 'DRUM', drumType: 'rim', tune: 0.9, tone: 1.1 },

  // DARK-PSY drums (4)
  { id: 'DRK-KICK-HEAVY', name: 'Dark Heavy Kick', genre: 'DARK-PSY', cat: 'drum', engine: 'DRUM', drumType: 'kick', tune: 0.55, decay: 1.6, punch: 0.3 },
  { id: 'DRK-SNARE-HARSH', name: 'Dark Harsh Snare', genre: 'DARK-PSY', cat: 'drum', engine: 'DRUM', drumType: 'snare', tune: 0.85, decay: 0.8, tone: 1.5 },
  { id: 'DRK-HAT-METAL', name: 'Dark Metal Hat', genre: 'DARK-PSY', cat: 'drum', engine: 'DRUM', drumType: 'hatC', decay: 0.45, tone: 1.8 },
  { id: 'DRK-GLITCH-NOISY', name: 'Dark Noisy Glitch', genre: 'DARK-PSY', cat: 'drum', engine: 'DRUM', drumType: 'glitch', tone: 1.2, decay: 0.9 },

  // GOA drums (2)
  { id: 'GOA-KICK-WARM', name: 'Goa Warm Kick', genre: 'GOA', cat: 'drum', engine: 'DRUM', drumType: 'kick', tune: 0.8, decay: 0.9, punch: 0.6 },
  { id: 'GOA-PERC-ETHNIC', name: 'Goa Ethnic Perc', genre: 'GOA', cat: 'drum', engine: 'DRUM', drumType: 'tom', tune: 1.1, decay: 0.7, tone: 1.4 },
];

// ─── BASS PRESETS (25 basses) ─────────────────────────────────────────────
export const BASSES: SoundPreset[] = [
  // PSYTRANCE bass (8)
  { id: 'PSY-BASS-ROLL', name: 'Psy Rolling Bass', genre: 'PSYTRANCE', cat: 'bass', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', oct2: -1, detune: 4, fType: 'lowpass', cutoff: 700, res: 9,
    atk: 0.005, dec: 0.1, sus: 0.2, rel: 0.05, gate: 0.3, poly: 2, sendDelay: 0.05, velSens: 0.8,
    scaleDegrees: [0, 3, 5, 7], energyLevel: 0.8, moodTags: ['driving', 'hypnotic'] },
  { id: 'PSY-BASS-DEEP', name: 'Psy Deep Bass', genre: 'PSYTRANCE', cat: 'bass', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', oct2: -1, detune: 12, fType: 'lowpass', cutoff: 450, res: 7,
    atk: 0.005, dec: 0.15, sus: 0.3, rel: 0.08, gate: 0.5, poly: 2, velSens: 0.7,
    scaleDegrees: [0, 5], energyLevel: 0.6, moodTags: ['deep', 'meditative'] },
  { id: 'PSY-BASS-AGGRO', name: 'Psy Aggro Bass', genre: 'PSYTRANCE', cat: 'bass', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', oct2: -1, detune: 18, fType: 'lowpass', cutoff: 1100, res: 6,
    atk: 0.003, dec: 0.08, sus: 0.2, rel: 0.04, gate: 0.4, poly: 2, velSens: 0.9,
    scaleDegrees: [0, 3, 7], energyLevel: 0.95, moodTags: ['aggressive', 'intense'] },
  { id: 'PSY-BASS-FM', name: 'Psy FM Bass', genre: 'PSYTRANCE', cat: 'bass', engine: 'FM',
    wave1: 'sine', wave2: 'sine', oct2: 1, fmAmount: 0.6, fmRatio: 2, fType: 'lowpass', cutoff: 2200,
    atk: 0.005, dec: 0.12, sus: 0.2, rel: 0.06, gate: 0.4, poly: 2, velSens: 0.8,
    scaleDegrees: [0, 5, 7], energyLevel: 0.7, moodTags: ['metallic', 'modern'] },
  { id: 'PSY-BASS-ACID', name: 'Psy Acid Bass', genre: 'PSYTRANCE', cat: 'bass', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', fType: 'lowpass', cutoff: 500, res: 16, fEnvAmt: 0.7, fDecay: 0.15,
    atk: 0.005, dec: 0.12, sus: 0.2, rel: 0.05, gate: 0.35, poly: 2, velSens: 0.85,
    scaleDegrees: [0, 3, 5, 7], energyLevel: 0.85, moodTags: ['squelchy', 'acid'] },
  { id: 'PSY-BASS-SUB', name: 'Psy Sub Bass', genre: 'PSYTRANCE', cat: 'bass', engine: 'SYNTH',
    wave1: 'sine', wave2: 'sine', oct2: -1, fType: 'lowpass', cutoff: 200,
    atk: 0.01, dec: 0.2, sus: 0.6, rel: 0.1, gate: 0.7, poly: 1, velSens: 0.6,
    scaleDegrees: [0], energyLevel: 0.5, moodTags: ['sub', 'weight'] },
  { id: 'PSY-BASS-WOBBLE', name: 'Psy Wobble Bass', genre: 'PSYTRANCE', cat: 'bass', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', oct2: -1, detune: 8, fType: 'lowpass', cutoff: 800, res: 10,
    lfoRate: 4, lfoDepth: 0.6, lfoDest: 'cutoff',
    atk: 0.005, dec: 0.15, sus: 0.4, rel: 0.08, gate: 0.5, poly: 2, velSens: 0.8,
    scaleDegrees: [0, 5], energyLevel: 0.75, moodTags: ['wobble', 'dynamic'] },
  { id: 'PSY-BASS-REZZY', name: 'Psy Reese Bass', genre: 'PSYTRANCE', cat: 'bass', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', oct2: -1, detune: 25, fType: 'lowpass', cutoff: 600, res: 4,
    atk: 0.01, dec: 0.3, sus: 0.7, rel: 0.2, gate: 0.8, poly: 1, velSens: 0.5,
    scaleDegrees: [0], energyLevel: 0.7, moodTags: ['reese', 'dark'] },

  // TECHNO bass (5)
  { id: 'TEC-BASS-RUMBLE', name: 'Techno Rumble Bass', genre: 'TECHNO', cat: 'bass', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', oct2: -1, detune: 14, fType: 'lowpass', cutoff: 220, res: 6,
    atk: 0.005, dec: 0.5, sus: 0.3, rel: 0.1, gate: 1.6, poly: 2, velSens: 0.7,
    scaleDegrees: [0], energyLevel: 0.8, moodTags: ['rumble', 'driving'] },
  { id: 'TEC-BASS-ACID', name: 'Techno Acid Bass', genre: 'TECHNO', cat: 'bass', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', fType: 'lowpass', cutoff: 500, res: 16, fEnvAmt: 0.8, fDecay: 0.12,
    atk: 0.005, dec: 0.12, sus: 0.2, rel: 0.05, gate: 0.35, poly: 2, velSens: 0.9,
    scaleDegrees: [0, 3, 5, 7], energyLevel: 0.9, moodTags: ['acid', 'squelchy'] },
  { id: 'TEC-BASS-DIST', name: 'Techno Dist Bass', genre: 'TECHNO', cat: 'bass', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', detune: 6, fType: 'lowpass', cutoff: 1400,
    atk: 0.005, dec: 0.2, sus: 0.3, rel: 0.08, gate: 0.5, poly: 2, velSens: 0.85,
    scaleDegrees: [0, 5], energyLevel: 0.85, moodTags: ['distorted', 'aggressive'] },
  { id: 'TEC-BASS-DEEP', name: 'Techno Deep Bass', genre: 'TECHNO', cat: 'bass', engine: 'SYNTH',
    wave1: 'sine', wave2: 'triangle', oct2: -1, fType: 'lowpass', cutoff: 300,
    atk: 0.01, dec: 0.4, sus: 0.5, rel: 0.15, gate: 0.8, poly: 1, velSens: 0.6,
    scaleDegrees: [0], energyLevel: 0.6, moodTags: ['deep', 'minimal'] },
  { id: 'TEC-BASS-STAB', name: 'Techno Stab Bass', genre: 'TECHNO', cat: 'bass', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', fType: 'lowpass', cutoff: 1800, res: 8,
    atk: 0.001, dec: 0.08, sus: 0.1, rel: 0.04, gate: 0.2, poly: 2, velSens: 0.95,
    scaleDegrees: [0, 3, 5, 7], energyLevel: 0.9, moodTags: ['stab', 'punchy'] },

  // TRANCE bass (4)
  { id: 'TRA-BASS-OFFBEAT', name: 'Trance Offbeat Bass', genre: 'TRANCE', cat: 'bass', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', oct2: -1, detune: 5, fType: 'lowpass', cutoff: 600, res: 8,
    atk: 0.005, dec: 0.3, sus: 0.4, rel: 0.1, gate: 0.55, poly: 2, velSens: 0.7,
    scaleDegrees: [0], energyLevel: 0.75, moodTags: ['offbeat', 'classic'] },
  { id: 'TRA-BASS-SUPERSAW', name: 'Trance Supersaw Bass', genre: 'TRANCE', cat: 'bass', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', detune: 24, fType: 'lowpass', cutoff: 1200,
    atk: 0.005, dec: 0.2, sus: 0.4, rel: 0.1, gate: 0.6, poly: 3, velSens: 0.7,
    scaleDegrees: [0, 5], energyLevel: 0.8, moodTags: ['supersaw', 'lush'] },
  { id: 'TRA-BASS-PLUCK', name: 'Trance Pluck Bass', genre: 'TRANCE', cat: 'bass', engine: 'SYNTH',
    wave1: 'triangle', wave2: 'sawtooth', fType: 'lowpass', cutoff: 1500, res: 6,
    atk: 0.001, dec: 0.15, sus: 0.1, rel: 0.1, gate: 0.3, poly: 2, velSens: 0.85,
    scaleDegrees: [0, 3, 5], energyLevel: 0.7, moodTags: ['pluck', 'melodic'] },
  { id: 'TRA-BASS-WARM', name: 'Trance Warm Bass', genre: 'TRANCE', cat: 'bass', engine: 'SYNTH',
    wave1: 'triangle', wave2: 'sine', oct2: -1, detune: 3, fType: 'lowpass', cutoff: 500,
    atk: 0.01, dec: 0.3, sus: 0.5, rel: 0.15, gate: 0.7, poly: 2, velSens: 0.6,
    scaleDegrees: [0], energyLevel: 0.6, moodTags: ['warm', 'soft'] },

  // PROGRESSIVE bass (4)
  { id: 'PRO-BASS-WARM', name: 'Prog Warm Bass', genre: 'PROGRESSIVE', cat: 'bass', engine: 'SYNTH',
    wave1: 'triangle', wave2: 'sine', oct2: -1, detune: 3, fType: 'lowpass', cutoff: 500,
    atk: 0.01, dec: 0.4, sus: 0.5, rel: 0.2, gate: 0.7, poly: 2, velSens: 0.6,
    scaleDegrees: [0, 5], energyLevel: 0.55, moodTags: ['warm', 'organic'] },
  { id: 'PRO-BASS-PLUCK', name: 'Prog Pluck Bass', genre: 'PROGRESSIVE', cat: 'bass', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'triangle', fType: 'lowpass', cutoff: 1000, res: 6,
    atk: 0.001, dec: 0.14, sus: 0.1, rel: 0.1, gate: 0.3, poly: 3, velSens: 0.85,
    scaleDegrees: [0, 3, 5, 7], energyLevel: 0.65, moodTags: ['pluck', 'organic'] },
  { id: 'PRO-BASS-DEEP', name: 'Prog Deep Bass', genre: 'PROGRESSIVE', cat: 'bass', engine: 'SYNTH',
    wave1: 'sine', wave2: 'triangle', oct2: -1, fType: 'lowpass', cutoff: 250,
    atk: 0.01, dec: 0.5, sus: 0.6, rel: 0.2, gate: 0.9, poly: 1, velSens: 0.5,
    scaleDegrees: [0], energyLevel: 0.5, moodTags: ['deep', 'meditative'] },
  { id: 'PRO-BASS-MELODIC', name: 'Prog Melodic Bass', genre: 'PROGRESSIVE', cat: 'bass', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'triangle', detune: 5, fType: 'lowpass', cutoff: 900,
    atk: 0.005, dec: 0.25, sus: 0.4, rel: 0.15, gate: 0.6, poly: 2, velSens: 0.75,
    scaleDegrees: [0, 5, 7], energyLevel: 0.7, moodTags: ['melodic', 'flowing'] },

  // DARK-PSY bass (2)
  { id: 'DRK-BASS-HEAVY', name: 'Dark Heavy Bass', genre: 'DARK-PSY', cat: 'bass', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', oct2: -1, detune: 20, fType: 'lowpass', cutoff: 350, res: 8,
    atk: 0.003, dec: 0.1, sus: 0.2, rel: 0.05, gate: 0.35, poly: 2, velSens: 0.9,
    scaleDegrees: [0, 1, 3], energyLevel: 0.95, moodTags: ['dark', 'heavy', 'aggressive'] },
  { id: 'DRK-BASS-DRONE', name: 'Dark Drone Bass', genre: 'DARK-PSY', cat: 'bass', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', oct2: -1, detune: 30, fType: 'lowpass', cutoff: 280, res: 3,
    atk: 0.05, dec: 0.8, sus: 0.7, rel: 0.4, gate: 1.5, poly: 1, velSens: 0.4,
    scaleDegrees: [0, 1], energyLevel: 0.7, moodTags: ['drone', 'dark', 'hypnotic'] },

  // GOA bass (2)
  { id: 'GOA-BASS-MELODIC', name: 'Goa Melodic Bass', genre: 'GOA', cat: 'bass', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', detune: 7, fType: 'lowpass', cutoff: 900, res: 7,
    atk: 0.005, dec: 0.2, sus: 0.3, rel: 0.1, gate: 0.5, poly: 2, velSens: 0.8,
    scaleDegrees: [0, 3, 5, 7, 10], energyLevel: 0.8, moodTags: ['melodic', 'goa', 'ethereal'] },
  { id: 'GOA-BASS-ACID', name: 'Goa Acid Bass', genre: 'GOA', cat: 'bass', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', fType: 'lowpass', cutoff: 600, res: 14, fEnvAmt: 0.9, fDecay: 0.2,
    atk: 0.005, dec: 0.15, sus: 0.2, rel: 0.06, gate: 0.4, poly: 2, velSens: 0.9,
    scaleDegrees: [0, 3, 5, 7, 10], energyLevel: 0.9, moodTags: ['acid', 'goa', 'squelchy'] },
];

// ─── LEAD PRESETS (20 leads) ──────────────────────────────────────────────
export const LEADS: SoundPreset[] = [
  // PSYTRANCE leads (5)
  { id: 'PSY-LEAD-SQUELCH', name: 'Psy Squelch Lead', genre: 'PSYTRANCE', cat: 'lead', engine: 'SYNTH',
    wave1: 'square', wave2: 'sawtooth', detune: 8, fType: 'lowpass', cutoff: 2400, res: 12, fEnvAmt: 0.5, fDecay: 0.2,
    atk: 0.005, dec: 0.18, sus: 0.4, rel: 0.15, gate: 0.45, poly: 4, sendDelay: 0.3, sendReverb: 0.2, velSens: 0.8,
    scaleDegrees: [0, 3, 5, 7, 10], energyLevel: 0.85, moodTags: ['squelchy', 'psychedelic'] },
  { id: 'PSY-LEAD-FMTEX', name: 'Psy FM Texture', genre: 'PSYTRANCE', cat: 'lead', engine: 'FM',
    wave1: 'sine', wave2: 'sine', oct2: 1, detune: 2, fmAmount: 0.4, fmRatio: 3, fType: 'lowpass', cutoff: 2600,
    lfoRate: 8, lfoDepth: 0.3, lfoDest: 'cutoff',
    atk: 0.005, dec: 0.2, sus: 0.5, rel: 0.2, gate: 0.6, poly: 4, sendDelay: 0.25, sendReverb: 0.25, velSens: 0.75,
    scaleDegrees: [0, 5, 7, 10], energyLevel: 0.75, moodTags: ['fm', 'texture', 'ethereal'] },
  { id: 'PSY-LEAD-ACID', name: 'Psy Acid Lead', genre: 'PSYTRANCE', cat: 'lead', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', fType: 'lowpass', cutoff: 1800, res: 16, fEnvAmt: 0.8, fDecay: 0.15,
    atk: 0.005, dec: 0.12, sus: 0.3, rel: 0.08, gate: 0.35, poly: 2, sendDelay: 0.2, velSens: 0.9,
    scaleDegrees: [0, 3, 5, 7, 10], energyLevel: 0.9, moodTags: ['acid', 'squelchy'] },
  { id: 'PSY-LEAD-SUPERSAW', name: 'Psy Supersaw Lead', genre: 'PSYTRANCE', cat: 'lead', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', detune: 18, fType: 'lowpass', cutoff: 3200, res: 4,
    atk: 0.01, dec: 0.3, sus: 0.6, rel: 0.3, gate: 0.8, poly: 6, sendDelay: 0.35, sendReverb: 0.3, velSens: 0.7,
    scaleDegrees: [0, 3, 5, 7, 10, 12], energyLevel: 0.85, moodTags: ['supersaw', 'lush', 'uplifting'] },
  { id: 'PSY-LEAD-PLUCK', name: 'Psy Pluck Lead', genre: 'PSYTRANCE', cat: 'lead', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'triangle', detune: 5, fType: 'lowpass', cutoff: 2800, res: 6,
    atk: 0.001, dec: 0.15, sus: 0.1, rel: 0.12, gate: 0.3, poly: 4, sendDelay: 0.3, sendReverb: 0.2, velSens: 0.85,
    scaleDegrees: [0, 3, 5, 7, 10], energyLevel: 0.7, moodTags: ['pluck', 'melodic'] },

  // TECHNO leads (3)
  { id: 'TEC-LEAD-ACID', name: 'Techno Acid Lead', genre: 'TECHNO', cat: 'lead', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', fType: 'lowpass', cutoff: 700, res: 18, fEnvAmt: 0.9, fDecay: 0.1,
    atk: 0.005, dec: 0.1, sus: 0.2, rel: 0.05, gate: 0.3, poly: 2, sendDelay: 0.15, velSens: 0.95,
    scaleDegrees: [0, 3, 5, 7], energyLevel: 0.95, moodTags: ['acid', 'aggressive'] },
  { id: 'TEC-LEAD-STAB', name: 'Techno Stab Lead', genre: 'TECHNO', cat: 'lead', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', detune: 4, fType: 'lowpass', cutoff: 2500, res: 8,
    atk: 0.001, dec: 0.1, sus: 0.1, rel: 0.05, gate: 0.2, poly: 3, velSens: 0.95,
    scaleDegrees: [0, 3, 5, 7], energyLevel: 0.9, moodTags: ['stab', 'punchy'] },
  { id: 'TEC-LEAD-HYPNO', name: 'Techno Hypnotic Lead', genre: 'TECHNO', cat: 'lead', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'triangle', detune: 10, fType: 'lowpass', cutoff: 1200, res: 6,
    lfoRate: 0.5, lfoDepth: 0.4, lfoDest: 'cutoff',
    atk: 0.02, dec: 0.4, sus: 0.6, rel: 0.3, gate: 0.9, poly: 3, sendDelay: 0.3, sendReverb: 0.2, velSens: 0.6,
    scaleDegrees: [0, 5], energyLevel: 0.7, moodTags: ['hypnotic', 'minimal'] },

  // TRANCE leads (4)
  { id: 'TRA-LEAD-SUPERSAW', name: 'Trance Supersaw Lead', genre: 'TRANCE', cat: 'lead', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', detune: 22, fType: 'lowpass', cutoff: 3200, res: 2,
    atk: 0.01, dec: 0.4, sus: 0.7, rel: 0.4, gate: 0.9, poly: 6, sendDelay: 0.4, sendReverb: 0.35, velSens: 0.7,
    scaleDegrees: [0, 3, 5, 7, 10, 12], energyLevel: 0.85, moodTags: ['supersaw', 'uplifting', 'lush'] },
  { id: 'TRA-LEAD-PLUCK', name: 'Trance Pluck Lead', genre: 'TRANCE', cat: 'lead', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'triangle', detune: 8, fType: 'lowpass', cutoff: 2800, res: 4,
    atk: 0.001, dec: 0.18, sus: 0.1, rel: 0.15, gate: 0.3, poly: 4, sendDelay: 0.35, sendReverb: 0.25, velSens: 0.85,
    scaleDegrees: [0, 3, 5, 7], energyLevel: 0.75, moodTags: ['pluck', 'melodic'] },
  { id: 'TRA-LEAD-SAW', name: 'Trance Saw Lead', genre: 'TRANCE', cat: 'lead', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', detune: 12, fType: 'lowpass', cutoff: 2400,
    atk: 0.005, dec: 0.3, sus: 0.6, rel: 0.25, gate: 0.7, poly: 4, sendDelay: 0.3, sendReverb: 0.3, velSens: 0.75,
    scaleDegrees: [0, 5, 7, 12], energyLevel: 0.8, moodTags: ['saw', 'classic'] },
  { id: 'TRA-LEAD-FM', name: 'Trance FM Lead', genre: 'TRANCE', cat: 'lead', engine: 'FM',
    wave1: 'sine', wave2: 'sine', oct2: 1, fmAmount: 0.5, fmRatio: 4, fType: 'lowpass', cutoff: 3000,
    atk: 0.005, dec: 0.3, sus: 0.5, rel: 0.3, gate: 0.7, poly: 4, sendDelay: 0.3, sendReverb: 0.25, velSens: 0.75,
    scaleDegrees: [0, 5, 7, 12], energyLevel: 0.75, moodTags: ['fm', 'bell', 'ethereal'] },

  // PROGRESSIVE leads (3)
  { id: 'PRO-LEAD-MELODIC', name: 'Prog Melodic Lead', genre: 'PROGRESSIVE', cat: 'lead', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'triangle', detune: 8, fType: 'lowpass', cutoff: 2600, res: 4,
    atk: 0.01, dec: 0.4, sus: 0.6, rel: 0.3, gate: 0.8, poly: 6, sendDelay: 0.35, sendReverb: 0.3, velSens: 0.7,
    scaleDegrees: [0, 3, 5, 7, 10], energyLevel: 0.7, moodTags: ['melodic', 'uplifting'] },
  { id: 'PRO-LEAD-PLUCK', name: 'Prog Pluck Lead', genre: 'PROGRESSIVE', cat: 'lead', engine: 'SYNTH',
    wave1: 'triangle', wave2: 'sawtooth', detune: 5, fType: 'lowpass', cutoff: 2200, res: 5,
    atk: 0.001, dec: 0.2, sus: 0.1, rel: 0.15, gate: 0.35, poly: 4, sendDelay: 0.3, sendReverb: 0.25, velSens: 0.85,
    scaleDegrees: [0, 3, 5, 7], energyLevel: 0.65, moodTags: ['pluck', 'organic'] },
  { id: 'PRO-LEAD-PAD', name: 'Prog Pad Lead', genre: 'PROGRESSIVE', cat: 'lead', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', detune: 15, fType: 'lowpass', cutoff: 1800,
    atk: 0.3, dec: 0.5, sus: 0.7, rel: 0.6, gate: 1.5, poly: 6, sendDelay: 0.2, sendReverb: 0.4, velSens: 0.5,
    scaleDegrees: [0, 5, 7], energyLevel: 0.6, moodTags: ['pad', 'ethereal'] },

  // DARK-PSY leads (3)
  { id: 'DRK-LEAD-HARSH', name: 'Dark Harsh Lead', genre: 'DARK-PSY', cat: 'lead', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', detune: 25, fType: 'lowpass', cutoff: 2000, res: 14, fEnvAmt: 0.7, fDecay: 0.12,
    atk: 0.003, dec: 0.15, sus: 0.3, rel: 0.08, gate: 0.35, poly: 3, sendDelay: 0.25, velSens: 0.9,
    scaleDegrees: [0, 1, 3, 6], energyLevel: 0.95, moodTags: ['harsh', 'dark', 'aggressive'] },
  { id: 'DRK-LEAD-DRONE', name: 'Dark Drone Lead', genre: 'DARK-PSY', cat: 'lead', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', detune: 30, fType: 'lowpass', cutoff: 1200, res: 3,
    lfoRate: 0.3, lfoDepth: 0.5, lfoDest: 'cutoff',
    atk: 0.5, dec: 1.0, sus: 0.8, rel: 1.0, gate: 2.5, poly: 4, sendReverb: 0.5, velSens: 0.4,
    scaleDegrees: [0, 1], energyLevel: 0.7, moodTags: ['drone', 'dark', 'hypnotic'] },
  { id: 'DRK-LEAD-FM', name: 'Dark FM Lead', genre: 'DARK-PSY', cat: 'lead', engine: 'FM',
    wave1: 'sine', wave2: 'sine', fmAmount: 0.7, fmRatio: 2, fType: 'lowpass', cutoff: 1800,
    atk: 0.005, dec: 0.3, sus: 0.4, rel: 0.2, gate: 0.6, poly: 3, sendDelay: 0.3, sendReverb: 0.3, velSens: 0.8,
    scaleDegrees: [0, 1, 3], energyLevel: 0.85, moodTags: ['fm', 'metallic', 'dark'] },

  // GOA leads (2)
  { id: 'GOA-LEAD-MELODIC', name: 'Goa Melodic Lead', genre: 'GOA', cat: 'lead', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', detune: 10, fType: 'lowpass', cutoff: 3000, res: 8,
    atk: 0.005, dec: 0.25, sus: 0.5, rel: 0.2, gate: 0.6, poly: 4, sendDelay: 0.35, sendReverb: 0.3, velSens: 0.8,
    scaleDegrees: [0, 3, 5, 7, 10, 12], energyLevel: 0.85, moodTags: ['melodic', 'goa', 'ethereal'] },
  { id: 'GOA-LEAD-ACID', name: 'Goa Acid Lead', genre: 'GOA', cat: 'lead', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', fType: 'lowpass', cutoff: 2200, res: 18, fEnvAmt: 0.9, fDecay: 0.2,
    atk: 0.005, dec: 0.18, sus: 0.3, rel: 0.1, gate: 0.4, poly: 3, sendDelay: 0.3, sendReverb: 0.25, velSens: 0.9,
    scaleDegrees: [0, 3, 5, 7, 10, 12], energyLevel: 0.9, moodTags: ['acid', 'goa', 'squelchy'] },
];

// ─── PAD PRESETS (15 pads) ────────────────────────────────────────────────
export const PADS: SoundPreset[] = [
  { id: 'PSY-PAD-PSYCH', name: 'Psy Psychedelic Pad', genre: 'PSYTRANCE', cat: 'pad', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sine', oct2: 1, detune: 14, fType: 'lowpass', cutoff: 1400, res: 6,
    lfoRate: 0.3, lfoDepth: 0.4, lfoDest: 'cutoff',
    atk: 0.7, dec: 0.5, sus: 0.8, rel: 1.3, gate: 2.6, poly: 8, sendReverb: 0.5, velSens: 0.4,
    scaleDegrees: [0, 5, 7, 10], energyLevel: 0.5, moodTags: ['psychedelic', 'ethereal'] },
  { id: 'PSY-PAD-DEEP', name: 'Psy Deep Pad', genre: 'PSYTRANCE', cat: 'pad', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', oct2: -1, detune: 18, fType: 'lowpass', cutoff: 800,
    atk: 1.0, dec: 0.8, sus: 0.7, rel: 1.5, gate: 3.0, poly: 8, sendReverb: 0.6, velSens: 0.3,
    scaleDegrees: [0, 5], energyLevel: 0.4, moodTags: ['deep', 'meditative'] },
  { id: 'TEC-PAD-DARK', name: 'Techno Dark Pad', genre: 'TECHNO', cat: 'pad', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', oct2: -1, detune: 16, fType: 'lowpass', cutoff: 700,
    atk: 0.8, dec: 0.6, sus: 0.7, rel: 1.4, gate: 2.6, poly: 8, sendReverb: 0.5, velSens: 0.4,
    scaleDegrees: [0, 3], energyLevel: 0.5, moodTags: ['dark', 'minimal'] },
  { id: 'TEC-PAD-HYPNO', name: 'Techno Hypnotic Pad', genre: 'TECHNO', cat: 'pad', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'triangle', detune: 10, fType: 'lowpass', cutoff: 1000,
    lfoRate: 0.2, lfoDepth: 0.3, lfoDest: 'cutoff',
    atk: 0.9, dec: 0.7, sus: 0.8, rel: 1.3, gate: 2.8, poly: 6, sendReverb: 0.45, velSens: 0.4,
    scaleDegrees: [0, 5], energyLevel: 0.5, moodTags: ['hypnotic', 'minimal'] },
  { id: 'TRA-PAD-ATMO', name: 'Trance Atmosphere', genre: 'TRANCE', cat: 'pad', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', detune: 18, fType: 'lowpass', cutoff: 1800,
    lfoRate: 0.2, lfoDepth: 0.3, lfoDest: 'cutoff',
    atk: 1.0, dec: 0.8, sus: 0.8, rel: 1.8, gate: 3.0, poly: 8, sendReverb: 0.55, velSens: 0.4,
    scaleDegrees: [0, 5, 7, 12], energyLevel: 0.55, moodTags: ['atmosphere', 'uplifting'] },
  { id: 'TRA-PAD-LUSH', name: 'Trance Lush Pad', genre: 'TRANCE', cat: 'pad', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', detune: 22, fType: 'lowpass', cutoff: 2200,
    atk: 0.8, dec: 0.6, sus: 0.8, rel: 1.5, gate: 2.5, poly: 8, sendReverb: 0.5, velSens: 0.45,
    scaleDegrees: [0, 3, 5, 7, 10], energyLevel: 0.6, moodTags: ['lush', 'uplifting'] },
  { id: 'PRO-PAD-EVOLVE', name: 'Prog Evolving Pad', genre: 'PROGRESSIVE', cat: 'pad', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'triangle', detune: 10, fType: 'lowpass', cutoff: 900,
    lfoRate: 0.12, lfoDepth: 0.5, lfoDest: 'cutoff',
    atk: 1.2, dec: 1.0, sus: 0.8, rel: 1.6, gate: 3.0, poly: 8, sendReverb: 0.5, velSens: 0.35,
    scaleDegrees: [0, 5, 7, 10], energyLevel: 0.5, moodTags: ['evolving', 'organic'] },
  { id: 'PRO-PAD-WARM', name: 'Prog Warm Pad', genre: 'PROGRESSIVE', cat: 'pad', engine: 'SYNTH',
    wave1: 'triangle', wave2: 'sine', detune: 6, fType: 'lowpass', cutoff: 1200,
    atk: 0.9, dec: 0.7, sus: 0.8, rel: 1.4, gate: 2.8, poly: 6, sendReverb: 0.45, velSens: 0.4,
    scaleDegrees: [0, 5, 7], energyLevel: 0.45, moodTags: ['warm', 'soft'] },
  { id: 'DRK-PAD-VOID', name: 'Dark Void Pad', genre: 'DARK-PSY', cat: 'pad', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', oct2: -1, detune: 25, fType: 'lowpass', cutoff: 500,
    lfoRate: 0.15, lfoDepth: 0.6, lfoDest: 'cutoff',
    atk: 1.5, dec: 1.2, sus: 0.8, rel: 2.0, gate: 3.5, poly: 8, sendReverb: 0.6, velSens: 0.3,
    scaleDegrees: [0, 1], energyLevel: 0.4, moodTags: ['dark', 'void', 'hypnotic'] },
  { id: 'DRK-PAD-DRONE', name: 'Dark Drone Pad', genre: 'DARK-PSY', cat: 'pad', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', oct2: -1, detune: 20, fType: 'lowpass', cutoff: 600,
    atk: 2.0, dec: 1.5, sus: 0.9, rel: 2.5, gate: 4.0, poly: 6, sendReverb: 0.55, velSens: 0.25,
    scaleDegrees: [0, 1, 3], energyLevel: 0.35, moodTags: ['drone', 'dark'] },
  { id: 'GOA-PAD-ETHNIC', name: 'Goa Ethnic Pad', genre: 'GOA', cat: 'pad', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'triangle', detune: 12, fType: 'lowpass', cutoff: 1600, res: 4,
    lfoRate: 0.25, lfoDepth: 0.4, lfoDest: 'cutoff',
    atk: 0.8, dec: 0.6, sus: 0.8, rel: 1.4, gate: 2.8, poly: 6, sendReverb: 0.55, velSens: 0.4,
    scaleDegrees: [0, 5, 7, 10], energyLevel: 0.55, moodTags: ['ethnic', 'ethereal', 'goa'] },
  { id: 'GOA-PAD-COSMIC', name: 'Goa Cosmic Pad', genre: 'GOA', cat: 'pad', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', oct2: 1, detune: 16, fType: 'lowpass', cutoff: 2000,
    lfoRate: 0.3, lfoDepth: 0.5, lfoDest: 'cutoff',
    atk: 1.0, dec: 0.8, sus: 0.8, rel: 1.6, gate: 3.0, poly: 8, sendReverb: 0.6, velSens: 0.35,
    scaleDegrees: [0, 3, 5, 7, 10], energyLevel: 0.5, moodTags: ['cosmic', 'ethereal'] },
  { id: 'ANY-PAD-STRING', name: 'Universal String Pad', genre: 'ANY', cat: 'pad', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', detune: 14, fType: 'lowpass', cutoff: 2400,
    atk: 0.6, dec: 0.5, sus: 0.8, rel: 1.2, gate: 2.5, poly: 8, sendReverb: 0.45, velSens: 0.45,
    scaleDegrees: [0, 5, 7, 12], energyLevel: 0.55, moodTags: ['strings', 'classic'] },
  { id: 'ANY-PAD-CHOIR', name: 'Universal Choir Pad', genre: 'ANY', cat: 'pad', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sine', detune: 10, fType: 'bandpass', cutoff: 1500, res: 3,
    lfoRate: 0.4, lfoDepth: 0.3, lfoDest: 'cutoff',
    atk: 0.8, dec: 0.6, sus: 0.8, rel: 1.5, gate: 2.8, poly: 8, sendReverb: 0.55, velSens: 0.4,
    scaleDegrees: [0, 5, 7], energyLevel: 0.5, moodTags: ['choir', 'ethereal'] },
  { id: 'ANY-PAD-GLASS', name: 'Universal Glass Pad', genre: 'ANY', cat: 'pad', engine: 'FM',
    wave1: 'sine', wave2: 'sine', oct2: 1, fmAmount: 0.2, fmRatio: 3, fType: 'lowpass', cutoff: 4000,
    atk: 0.5, dec: 0.4, sus: 0.7, rel: 1.0, gate: 2.0, poly: 6, sendReverb: 0.5, velSens: 0.5,
    scaleDegrees: [0, 5, 7, 12], energyLevel: 0.45, moodTags: ['glass', 'clean'] },
];

// ─── PLUCK PRESETS (12 plucks) ───────────────────────────────────────────
export const PLUCKS: SoundPreset[] = [
  { id: 'PSY-PLUCK-STAB', name: 'Psy Stab Pluck', genre: 'PSYTRANCE', cat: 'pluck', engine: 'SYNTH',
    wave1: 'square', wave2: 'triangle', fType: 'lowpass', cutoff: 1800, res: 8,
    atk: 0.001, dec: 0.08, sus: 0.05, rel: 0.04, gate: 0.15, poly: 4, sendDelay: 0.15, velSens: 0.9,
    scaleDegrees: [0, 3, 5, 7], energyLevel: 0.85, moodTags: ['stab', 'punchy'] },
  { id: 'PSY-PLUCK-MELODIC', name: 'Psy Melodic Pluck', genre: 'PSYTRANCE', cat: 'pluck', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'triangle', detune: 6, fType: 'lowpass', cutoff: 2400, res: 5,
    atk: 0.001, dec: 0.15, sus: 0.1, rel: 0.1, gate: 0.25, poly: 4, sendDelay: 0.25, sendReverb: 0.15, velSens: 0.85,
    scaleDegrees: [0, 3, 5, 7, 10], energyLevel: 0.7, moodTags: ['melodic', 'pluck'] },
  { id: 'TEC-PLUCK-STAB', name: 'Techno Stab Pluck', genre: 'TECHNO', cat: 'pluck', engine: 'SYNTH',
    wave1: 'square', wave2: 'triangle', fType: 'lowpass', cutoff: 1500, res: 8,
    atk: 0.001, dec: 0.08, sus: 0.05, rel: 0.04, gate: 0.15, poly: 4, velSens: 0.95,
    scaleDegrees: [0, 3, 5, 7], energyLevel: 0.9, moodTags: ['stab', 'punchy'] },
  { id: 'TEC-PLUCK-ACID', name: 'Techno Acid Pluck', genre: 'TECHNO', cat: 'pluck', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', fType: 'lowpass', cutoff: 1000, res: 14, fEnvAmt: 0.8, fDecay: 0.1,
    atk: 0.001, dec: 0.1, sus: 0.1, rel: 0.06, gate: 0.2, poly: 2, sendDelay: 0.2, velSens: 0.9,
    scaleDegrees: [0, 3, 5, 7], energyLevel: 0.9, moodTags: ['acid', 'squelchy'] },
  { id: 'TRA-PLUCK-GATE', name: 'Trance Gate Pluck', genre: 'TRANCE', cat: 'pluck', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', detune: 10, fType: 'lowpass', cutoff: 2200, res: 6,
    atk: 0.001, dec: 0.14, sus: 0.1, rel: 0.1, gate: 0.28, poly: 6, sendDelay: 0.3, sendReverb: 0.2, velSens: 0.85,
    scaleDegrees: [0, 5, 7, 12], energyLevel: 0.75, moodTags: ['gate', 'trance'] },
  { id: 'TRA-PLUCK-MELODIC', name: 'Trance Melodic Pluck', genre: 'TRANCE', cat: 'pluck', engine: 'SYNTH',
    wave1: 'triangle', wave2: 'sawtooth', detune: 8, fType: 'lowpass', cutoff: 2600, res: 4,
    atk: 0.001, dec: 0.18, sus: 0.1, rel: 0.12, gate: 0.3, poly: 4, sendDelay: 0.3, sendReverb: 0.2, velSens: 0.85,
    scaleDegrees: [0, 3, 5, 7], energyLevel: 0.7, moodTags: ['melodic', 'pluck'] },
  { id: 'PRO-PLUCK-ORG', name: 'Prog Organic Pluck', genre: 'PROGRESSIVE', cat: 'pluck', engine: 'SYNTH',
    wave1: 'triangle', wave2: 'sawtooth', detune: 5, fType: 'lowpass', cutoff: 1800, res: 6,
    atk: 0.001, dec: 0.18, sus: 0.15, rel: 0.12, gate: 0.35, poly: 6, sendDelay: 0.25, sendReverb: 0.2, velSens: 0.85,
    scaleDegrees: [0, 3, 5, 7], energyLevel: 0.65, moodTags: ['organic', 'pluck'] },
  { id: 'PRO-PLUCK-WARM', name: 'Prog Warm Pluck', genre: 'PROGRESSIVE', cat: 'pluck', engine: 'SYNTH',
    wave1: 'triangle', wave2: 'sine', detune: 4, fType: 'lowpass', cutoff: 1500,
    atk: 0.001, dec: 0.2, sus: 0.2, rel: 0.15, gate: 0.4, poly: 4, sendDelay: 0.2, sendReverb: 0.25, velSens: 0.8,
    scaleDegrees: [0, 5, 7], energyLevel: 0.6, moodTags: ['warm', 'soft'] },
  { id: 'DRK-PLUCK-HARSH', name: 'Dark Harsh Pluck', genre: 'DARK-PSY', cat: 'pluck', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', detune: 18, fType: 'lowpass', cutoff: 1600, res: 12, fEnvAmt: 0.6, fDecay: 0.08,
    atk: 0.001, dec: 0.1, sus: 0.05, rel: 0.06, gate: 0.2, poly: 3, sendDelay: 0.2, velSens: 0.9,
    scaleDegrees: [0, 1, 3, 6], energyLevel: 0.9, moodTags: ['harsh', 'dark'] },
  { id: 'DRK-PLUCK-DRONE', name: 'Dark Drone Pluck', genre: 'DARK-PSY', cat: 'pluck', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', detune: 22, fType: 'lowpass', cutoff: 800,
    atk: 0.005, dec: 0.4, sus: 0.3, rel: 0.3, gate: 0.6, poly: 3, sendReverb: 0.4, velSens: 0.7,
    scaleDegrees: [0, 1], energyLevel: 0.7, moodTags: ['drone', 'dark'] },
  { id: 'GOA-PLUCK-ETHNIC', name: 'Goa Ethnic Pluck', genre: 'GOA', cat: 'pluck', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'triangle', detune: 7, fType: 'lowpass', cutoff: 2400, res: 7,
    atk: 0.001, dec: 0.16, sus: 0.1, rel: 0.1, gate: 0.3, poly: 4, sendDelay: 0.3, sendReverb: 0.25, velSens: 0.85,
    scaleDegrees: [0, 3, 5, 7, 10], energyLevel: 0.75, moodTags: ['ethnic', 'goa'] },
  { id: 'ANY-PLUCK-CLEAN', name: 'Universal Clean Pluck', genre: 'ANY', cat: 'pluck', engine: 'SYNTH',
    wave1: 'triangle', wave2: 'sine', detune: 3, fType: 'lowpass', cutoff: 2000,
    atk: 0.001, dec: 0.2, sus: 0.1, rel: 0.15, gate: 0.35, poly: 4, sendDelay: 0.25, sendReverb: 0.2, velSens: 0.85,
    scaleDegrees: [0, 5, 7, 12], energyLevel: 0.6, moodTags: ['clean', 'universal'] },
];

// ─── ARP PRESETS (12 arps) ───────────────────────────────────────────────
export const ARPS: SoundPreset[] = [
  { id: 'PSY-ARP-ACID', name: 'Psy Acid Arp', genre: 'PSYTRANCE', cat: 'arp', engine: 'SYNTH',
    wave1: 'square', wave2: 'sawtooth', detune: 6, fType: 'lowpass', cutoff: 1800, res: 11, fEnvAmt: 0.5, fDecay: 0.12,
    atk: 0.001, dec: 0.1, sus: 0.2, rel: 0.06, gate: 0.24, poly: 4, sendDelay: 0.3, velSens: 0.85,
    scaleDegrees: [0, 3, 5, 7, 10], energyLevel: 0.85, moodTags: ['acid', 'fast'] },
  { id: 'PSY-ARP-FAST', name: 'Psy Fast Arp', genre: 'PSYTRANCE', cat: 'arp', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', detune: 8, fType: 'lowpass', cutoff: 2400, res: 6,
    atk: 0.001, dec: 0.08, sus: 0.15, rel: 0.05, gate: 0.2, poly: 4, sendDelay: 0.35, velSens: 0.9,
    scaleDegrees: [0, 5, 7, 10, 12], energyLevel: 0.9, moodTags: ['fast', 'driving'] },
  { id: 'TEC-ARP-HYPNO', name: 'Techno Hypnotic Arp', genre: 'TECHNO', cat: 'arp', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'triangle', oct2: -1, detune: 8, fType: 'lowpass', cutoff: 1000, res: 6,
    atk: 0.001, dec: 0.15, sus: 0.3, rel: 0.1, gate: 0.3, poly: 4, sendDelay: 0.3, velSens: 0.8,
    scaleDegrees: [0, 5], energyLevel: 0.75, moodTags: ['hypnotic', 'minimal'] },
  { id: 'TEC-ARP-ACID', name: 'Techno Acid Arp', genre: 'TECHNO', cat: 'arp', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', fType: 'lowpass', cutoff: 1200, res: 16, fEnvAmt: 0.7, fDecay: 0.1,
    atk: 0.001, dec: 0.08, sus: 0.15, rel: 0.05, gate: 0.2, poly: 2, sendDelay: 0.25, velSens: 0.9,
    scaleDegrees: [0, 3, 5, 7], energyLevel: 0.9, moodTags: ['acid', 'fast'] },
  { id: 'TRA-ARP-ROLL', name: 'Trance Rolling Arp', genre: 'TRANCE', cat: 'arp', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', detune: 12, fType: 'lowpass', cutoff: 2600, res: 4,
    atk: 0.001, dec: 0.12, sus: 0.2, rel: 0.08, gate: 0.28, poly: 6, sendDelay: 0.35, sendReverb: 0.2, velSens: 0.85,
    scaleDegrees: [0, 5, 7, 10, 12], energyLevel: 0.85, moodTags: ['rolling', 'trance'] },
  { id: 'TRA-ARP-UP', name: 'Trance Up Arp', genre: 'TRANCE', cat: 'arp', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'triangle', detune: 10, fType: 'lowpass', cutoff: 2800, res: 3,
    atk: 0.001, dec: 0.15, sus: 0.25, rel: 0.1, gate: 0.3, poly: 4, sendDelay: 0.4, sendReverb: 0.25, velSens: 0.85,
    scaleDegrees: [0, 5, 7, 12, 15], energyLevel: 0.8, moodTags: ['uplifting', 'up'] },
  { id: 'PRO-ARP-MELODIC', name: 'Prog Melodic Arp', genre: 'PROGRESSIVE', cat: 'arp', engine: 'SYNTH',
    wave1: 'triangle', wave2: 'sawtooth', detune: 7, fType: 'lowpass', cutoff: 2200, res: 4,
    atk: 0.001, dec: 0.2, sus: 0.4, rel: 0.15, gate: 0.4, poly: 6, sendDelay: 0.35, sendReverb: 0.25, velSens: 0.8,
    scaleDegrees: [0, 3, 5, 7, 10], energyLevel: 0.7, moodTags: ['melodic', 'flowing'] },
  { id: 'PRO-ARP-SLOW', name: 'Prog Slow Arp', genre: 'PROGRESSIVE', cat: 'arp', engine: 'SYNTH',
    wave1: 'triangle', wave2: 'sine', detune: 5, fType: 'lowpass', cutoff: 1800,
    atk: 0.005, dec: 0.3, sus: 0.5, rel: 0.2, gate: 0.6, poly: 4, sendDelay: 0.3, sendReverb: 0.3, velSens: 0.75,
    scaleDegrees: [0, 5, 7, 10], energyLevel: 0.6, moodTags: ['slow', 'melodic'] },
  { id: 'DRK-ARP-HARSH', name: 'Dark Harsh Arp', genre: 'DARK-PSY', cat: 'arp', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', detune: 20, fType: 'lowpass', cutoff: 1400, res: 14, fEnvAmt: 0.6, fDecay: 0.08,
    atk: 0.001, dec: 0.08, sus: 0.15, rel: 0.05, gate: 0.2, poly: 3, sendDelay: 0.3, velSens: 0.9,
    scaleDegrees: [0, 1, 3, 6], energyLevel: 0.9, moodTags: ['harsh', 'dark', 'fast'] },
  { id: 'DRK-ARP-DRONE', name: 'Dark Drone Arp', genre: 'DARK-PSY', cat: 'arp', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', detune: 25, fType: 'lowpass', cutoff: 800,
    atk: 0.01, dec: 0.4, sus: 0.4, rel: 0.3, gate: 0.7, poly: 3, sendReverb: 0.4, velSens: 0.7,
    scaleDegrees: [0, 1, 3], energyLevel: 0.7, moodTags: ['drone', 'dark'] },
  { id: 'GOA-ARP-MELODIC', name: 'Goa Melodic Arp', genre: 'GOA', cat: 'arp', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'square', detune: 8, fType: 'lowpass', cutoff: 2600, res: 8,
    atk: 0.001, dec: 0.12, sus: 0.2, rel: 0.08, gate: 0.25, poly: 4, sendDelay: 0.35, sendReverb: 0.25, velSens: 0.85,
    scaleDegrees: [0, 3, 5, 7, 10, 12], energyLevel: 0.85, moodTags: ['melodic', 'goa'] },
  { id: 'ANY-ARP-CLASSIC', name: 'Universal Classic Arp', genre: 'ANY', cat: 'arp', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', detune: 10, fType: 'lowpass', cutoff: 2400, res: 4,
    atk: 0.001, dec: 0.12, sus: 0.2, rel: 0.08, gate: 0.25, poly: 4, sendDelay: 0.3, sendReverb: 0.2, velSens: 0.85,
    scaleDegrees: [0, 5, 7, 12], energyLevel: 0.75, moodTags: ['classic', 'universal'] },
];

// ─── FX PRESETS (10 effects) ─────────────────────────────────────────────
export const FXS: SoundPreset[] = [
  { id: 'FX-SWEEP-UP', name: 'Noise Sweep Up', genre: 'ANY', cat: 'fx', engine: 'NOISE',
    fType: 'highpass', cutoff: 500, res: 10,
    atk: 2.0, dec: 0.5, sus: 0.0, rel: 0.3, gate: 2.5, poly: 1, velSens: 0.5,
    energyLevel: 0.8, moodTags: ['sweep', 'riser'] },
  { id: 'FX-SWEEP-DOWN', name: 'Noise Sweep Down', genre: 'ANY', cat: 'fx', engine: 'NOISE',
    fType: 'lowpass', cutoff: 8000, res: 10,
    atk: 0.3, dec: 0.5, sus: 0.0, rel: 2.0, gate: 2.5, poly: 1, velSens: 0.5,
    energyLevel: 0.7, moodTags: ['sweep', 'downlifter'] },
  { id: 'FX-RISE-PSY', name: 'Psy Riser', genre: 'PSYTRANCE', cat: 'fx', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', oct2: 1, detune: 20, fType: 'bandpass', cutoff: 2000, res: 8,
    lfoRate: 0.5, lfoDepth: 0.7, lfoDest: 'cutoff',
    atk: 3.0, dec: 0.3, sus: 0.0, rel: 0.2, gate: 3.5, poly: 2, sendReverb: 0.3, velSens: 0.4,
    energyLevel: 0.9, moodTags: ['riser', 'tension'] },
  { id: 'FX-IMPACT-PSY', name: 'Psy Impact', genre: 'PSYTRANCE', cat: 'fx', engine: 'SYNTH',
    wave1: 'sine', wave2: 'sine', oct2: -1, fType: 'lowpass', cutoff: 200,
    atk: 0.001, dec: 1.5, sus: 0.0, rel: 0.5, gate: 2.0, poly: 1, sendReverb: 0.6, velSens: 0.8,
    energyLevel: 0.95, moodTags: ['impact', 'boom'] },
  { id: 'FX-DOWNLIFTER', name: 'Downlifter', genre: 'ANY', cat: 'fx', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', oct2: 1, fType: 'lowpass', cutoff: 6000, res: 6,
    atk: 0.1, dec: 0.3, sus: 0.0, rel: 2.0, gate: 2.5, poly: 1, sendReverb: 0.4, velSens: 0.5,
    energyLevel: 0.7, moodTags: ['downlifter', 'release'] },
  { id: 'FX-IMPACT-SUB', name: 'Sub Impact', genre: 'ANY', cat: 'fx', engine: 'SYNTH',
    wave1: 'sine', wave2: 'sine', oct2: -2, fType: 'lowpass', cutoff: 150,
    atk: 0.001, dec: 2.0, sus: 0.0, rel: 0.5, gate: 2.5, poly: 1, sendReverb: 0.5, velSens: 0.7,
    energyLevel: 0.9, moodTags: ['impact', 'sub', 'boom'] },
  { id: 'FX-RISE-TRA', name: 'Trance Riser', genre: 'TRANCE', cat: 'fx', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', detune: 15, fType: 'highpass', cutoff: 1000, res: 4,
    lfoRate: 0.3, lfoDepth: 0.5, lfoDest: 'cutoff',
    atk: 2.5, dec: 0.3, sus: 0.0, rel: 0.3, gate: 3.0, poly: 2, sendReverb: 0.4, velSens: 0.4,
    energyLevel: 0.85, moodTags: ['riser', 'trance'] },
  { id: 'FX-IMPACT-TRA', name: 'Trance Impact', genre: 'TRANCE', cat: 'fx', engine: 'SYNTH',
    wave1: 'sine', wave2: 'triangle', oct2: -1, fType: 'lowpass', cutoff: 400,
    atk: 0.001, dec: 1.2, sus: 0.0, rel: 0.4, gate: 1.8, poly: 1, sendReverb: 0.55, velSens: 0.8,
    energyLevel: 0.9, moodTags: ['impact', 'trance'] },
  { id: 'FX-GLITCH-PSY', name: 'Psy Glitch FX', genre: 'PSYTRANCE', cat: 'fx', engine: 'NOISE',
    fType: 'bandpass', cutoff: 2000, res: 8,
    atk: 0.001, dec: 0.3, sus: 0.0, rel: 0.1, gate: 0.4, poly: 2, velSens: 0.9,
    energyLevel: 0.7, moodTags: ['glitch', 'psychedelic'] },
  { id: 'FX-ATMOSPHERE', name: 'Atmosphere FX', genre: 'ANY', cat: 'fx', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sine', oct2: 1, detune: 12, fType: 'lowpass', cutoff: 1500,
    lfoRate: 0.2, lfoDepth: 0.4, lfoDest: 'cutoff',
    atk: 1.5, dec: 1.0, sus: 0.8, rel: 2.0, gate: 3.5, poly: 4, sendReverb: 0.6, velSens: 0.3,
    energyLevel: 0.4, moodTags: ['atmosphere', 'ethereal'] },
];

// ─── TEXTURE PRESETS (8 textures) ────────────────────────────────────────
export const TEXTURES: SoundPreset[] = [
  { id: 'TEX-PSY-AMBIENT', name: 'Psy Ambient Texture', genre: 'PSYTRANCE', cat: 'texture', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sine', oct2: 1, detune: 15, fType: 'lowpass', cutoff: 1200,
    lfoRate: 0.15, lfoDepth: 0.5, lfoDest: 'cutoff',
    atk: 2.0, dec: 1.5, sus: 0.8, rel: 2.5, gate: 4.0, poly: 8, sendReverb: 0.6, velSens: 0.25,
    scaleDegrees: [0, 5, 7, 10], energyLevel: 0.35, moodTags: ['ambient', 'ethereal'] },
  { id: 'TEX-DRK-VOID', name: 'Dark Void Texture', genre: 'DARK-PSY', cat: 'texture', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', oct2: -1, detune: 28, fType: 'lowpass', cutoff: 400,
    lfoRate: 0.1, lfoDepth: 0.7, lfoDest: 'cutoff',
    atk: 3.0, dec: 2.0, sus: 0.9, rel: 3.0, gate: 5.0, poly: 8, sendReverb: 0.65, velSens: 0.2,
    scaleDegrees: [0, 1], energyLevel: 0.3, moodTags: ['void', 'dark', 'ambient'] },
  { id: 'TEX-GOA-COSMIC', name: 'Goa Cosmic Texture', genre: 'GOA', cat: 'texture', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', oct2: 1, detune: 18, fType: 'lowpass', cutoff: 2200,
    lfoRate: 0.25, lfoDepth: 0.5, lfoDest: 'cutoff',
    atk: 1.5, dec: 1.0, sus: 0.8, rel: 2.0, gate: 3.5, poly: 8, sendReverb: 0.6, velSens: 0.3,
    scaleDegrees: [0, 3, 5, 7, 10], energyLevel: 0.4, moodTags: ['cosmic', 'ethereal', 'goa'] },
  { id: 'TEX-TRA-DREAM', name: 'Trance Dream Texture', genre: 'TRANCE', cat: 'texture', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', detune: 20, fType: 'lowpass', cutoff: 2500,
    lfoRate: 0.2, lfoDepth: 0.4, lfoDest: 'cutoff',
    atk: 1.8, dec: 1.2, sus: 0.8, rel: 2.2, gate: 3.8, poly: 8, sendReverb: 0.55, velSens: 0.3,
    scaleDegrees: [0, 5, 7, 12], energyLevel: 0.4, moodTags: ['dream', 'ethereal'] },
  { id: 'TEX-PRO-NATURE', name: 'Prog Nature Texture', genre: 'PROGRESSIVE', cat: 'texture', engine: 'SYNTH',
    wave1: 'triangle', wave2: 'sine', detune: 8, fType: 'bandpass', cutoff: 1800, res: 3,
    lfoRate: 0.18, lfoDepth: 0.6, lfoDest: 'cutoff',
    atk: 2.0, dec: 1.5, sus: 0.8, rel: 2.5, gate: 4.0, poly: 6, sendReverb: 0.55, velSens: 0.25,
    scaleDegrees: [0, 5, 7, 10], energyLevel: 0.35, moodTags: ['nature', 'organic'] },
  { id: 'TEX-TEC-METAL', name: 'Techno Metal Texture', genre: 'TECHNO', cat: 'texture', engine: 'FM',
    wave1: 'sine', wave2: 'sine', fmAmount: 0.6, fmRatio: 5, fType: 'bandpass', cutoff: 3000, res: 8,
    atk: 0.5, dec: 0.8, sus: 0.7, rel: 1.0, gate: 2.0, poly: 4, sendReverb: 0.45, velSens: 0.4,
    scaleDegrees: [0, 5], energyLevel: 0.5, moodTags: ['metal', 'industrial'] },
  { id: 'TEX-ANY-PAD', name: 'Universal Pad Texture', genre: 'ANY', cat: 'texture', engine: 'SYNTH',
    wave1: 'sawtooth', wave2: 'sawtooth', detune: 16, fType: 'lowpass', cutoff: 1800,
    lfoRate: 0.22, lfoDepth: 0.4, lfoDest: 'cutoff',
    atk: 1.5, dec: 1.0, sus: 0.8, rel: 2.0, gate: 3.5, poly: 8, sendReverb: 0.5, velSens: 0.3,
    scaleDegrees: [0, 5, 7, 12], energyLevel: 0.4, moodTags: ['pad', 'universal'] },
  { id: 'TEX-ANY-WIND', name: 'Universal Wind Texture', genre: 'ANY', cat: 'texture', engine: 'NOISE',
    fType: 'bandpass', cutoff: 2500, res: 4,
    lfoRate: 0.3, lfoDepth: 0.5, lfoDest: 'cutoff',
    atk: 2.0, dec: 1.5, sus: 0.8, rel: 2.5, gate: 4.0, poly: 1, sendReverb: 0.6, velSens: 0.2,
    energyLevel: 0.3, moodTags: ['wind', 'ambient'] },
];

// ─── MASTER BANK (all presets) ───────────────────────────────────────────
export const SOUND_BANK: SoundPreset[] = [
  ...DRUMS,
  ...BASSES,
  ...LEADS,
  ...PADS,
  ...PLUCKS,
  ...ARPS,
  ...FXS,
  ...TEXTURES,
];

// ─── Query helpers ────────────────────────────────────────────────────────
export function getByCategory(cat: Category): SoundPreset[] {
  return SOUND_BANK.filter(p => p.cat === cat);
}

export function getByGenre(genre: Genre): SoundPreset[] {
  return SOUND_BANK.filter(p => p.genre === genre || p.genre === 'ANY');
}

export function getById(id: string): SoundPreset | null {
  return SOUND_BANK.find(p => p.id === id) || null;
}

export function getByMood(mood: string): SoundPreset[] {
  return SOUND_BANK.filter(p => p.moodTags?.includes(mood));
}

export function getByEnergyLevel(min: number, max: number): SoundPreset[] {
  return SOUND_BANK.filter(p => (p.energyLevel || 0) >= min && (p.energyLevel || 0) <= max);
}

/**
 * Auto-select presets by detected scale + genre + energy.
 * Used by the learning system to pick the best sounds for the current context.
 */
export function autoSelect(
  scaleDegrees: number[],
  genre: Genre = 'PSYTRANCE',
  energy: number = 0.7,
  cat?: Category,
): SoundPreset[] {
  let candidates = SOUND_BANK;
  if (cat) candidates = candidates.filter(p => p.cat === cat);
  // Prefer matching genre, fall back to ANY
  const genreMatch = candidates.filter(p => p.genre === genre || p.genre === 'ANY');
  candidates = genreMatch.length > 0 ? genreMatch : candidates;
  // Filter by energy (±0.2 tolerance)
  candidates = candidates.filter(p => Math.abs((p.energyLevel || 0.5) - energy) < 0.25);
  // Sort by how many scale degrees match
  candidates.sort((a, b) => {
    const aMatch = (a.scaleDegrees || []).filter(d => scaleDegrees.includes(d)).length;
    const bMatch = (b.scaleDegrees || []).filter(d => scaleDegrees.includes(d)).length;
    return bMatch - aMatch;
  });
  return candidates.slice(0, 5);
}

export function bankStats() {
  const cats: Record<string, number> = {};
  const genres: Record<string, number> = {};
  SOUND_BANK.forEach(p => {
    cats[p.cat] = (cats[p.cat] || 0) + 1;
    genres[p.genre] = (genres[p.genre] || 0) + 1;
  });
  return { total: SOUND_BANK.length, cats, genres };
}
