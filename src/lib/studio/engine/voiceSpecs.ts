/**
 * SHARED VOICE SPECIFICATION — Single Source of Truth.
 *
 * Both the offline Studio engine and the live Psy4LiveEngine read from these
 * specs. No more two disconnected engines with different parameters.
 *
 * REAL IMPLEMENTATION.
 */

// ─── Channel Strip Spec ─────────────────────────────────────────

export interface ChannelStripSpec {
  name: string;
  gainDb: number;       // channel gain in dB
  hpFreq: number;       // high-pass filter frequency (0 = none)
  pan: number;          // -1..1
  width: number;        // 0..1 (0 = mono, 1 = full stereo)
  reverbSend: number;   // 0..1
  delaySend: number;    // 0..1
}

// ─── Kick Spec ──────────────────────────────────────────────────

export interface KickSpec {
  fundamental: number;       // Hz
  startMult: number;         // pitch sweep start multiplier
  pitchDecay: number;        // seconds
  decay: number;             // total decay seconds
  subLevel: number;          // 0..1
  midLevel: number;          // 0..1
  clickLevel: number;        // 0..1
  saturation: number;        // 0..1 drive amount
  level: number;             // overall output level
  useSample: boolean;        // use PSY3 sample as base layer
  sampleName: string | null; // sample file name if useSample
}

// ─── Bass Spec ──────────────────────────────────────────────────

export interface BassSpec {
  subLevel: number;          // sub oscillator level
  harmonicLevel: number;     // saw/square harmonic layer level
  cutoffStart: number;       // filter cutoff start Hz
  cutoffEnd: number;         // filter cutoff end Hz
  resonance: number;         // filter Q
  attack: number;            // seconds
  ampLevel: number;          // amplitude
  saturation: number;        // 0..1 drive
  sidechainDepth: number;    // 0..1
  sidechainRelease: number;  // seconds
}

// ─── Lead Spec ──────────────────────────────────────────────────

export interface LeadSpec {
  oscType: 'saw' | 'square' | 'triangle';
  numOscs: number;           // 1..7
  detune: number;            // cents between oscillators
  cutoff: number;            // filter cutoff Hz
  resonance: number;         // filter Q
  filterEnvAmount: number;   // 0..1
  lfoRate: number;           // Hz (0 = no LFO)
  lfoDepth: number;          // 0..1
  saturation: number;        // 0..1
  level: number;             // output level
  stereoSpread: number;      // 0..1 pan spread between oscs
}

// ─── Pad Spec ───────────────────────────────────────────────────

export interface PadSpec {
  oscType: 'saw' | 'square' | 'triangle';
  numOscs: number;           // 2..4
  detune: number;            // cents
  cutoff: number;            // Hz
  resonance: number;         // Q
  attack: number;            // seconds
  release: number;           // seconds
  evolveRate: number;        // Hz LFO for detune modulation
  evolveDepth: number;       // cents of detune modulation
  level: number;             // output level
  reverbSend: number;        // 0..1
}

// ─── Hat Spec ───────────────────────────────────────────────────

export interface HatSpec {
  useSample: boolean;
  sampleName: string | null;
  metallicRatios: number[];  // inharmonic ratios for metallic oscs
  noiseLevel: number;        // 0..1 noise blend
  hpFreq: number;            // HP filter frequency
  closedDecay: number;       // seconds
  openDecay: number;         // seconds
  level: number;
}

// ─── Clap Spec ──────────────────────────────────────────────────

export interface ClapSpec {
  useSample: boolean;
  sampleName: string | null;
  numBursts: number;         // 3..5
  burstSpacing: number;      // seconds between bursts
  bpFreq: number;            // bandpass center frequency
  tailDecay: number;         // seconds
  level: number;
}

// ─── Drum Spec (perc/snare/shaker) ──────────────────────────────

export interface DrumSpec {
  type: 'perc' | 'snare' | 'shaker';
  pitch: number;             // Hz
  decay: number;             // seconds
  hpFreq: number;            // HP filter
  level: number;
}

// ─── Complete Voice Spec Set ────────────────────────────────────

export interface VoiceSpecSet {
  kick: KickSpec;
  bass: BassSpec;
  lead: LeadSpec;
  pad: PadSpec;
  hat: HatSpec;
  clap: ClapSpec;
  perc: DrumSpec;
  shaker: DrumSpec;
  channels: Record<string, ChannelStripSpec>;
}

// ─── World-specific Voice Spec Sets ─────────────────────────────

export const VOICE_SPECS: Record<string, VoiceSpecSet> = {
  'progressive-psy': {
    kick: {
      fundamental: 50, startMult: 2.4, pitchDecay: 0.04, decay: 0.22,
      subLevel: 0.9, midLevel: 0.4, clickLevel: 0.08, saturation: 0.4,
      level: 0.95, useSample: true, sampleName: 'kick.wav',
    },
    bass: {
      subLevel: 0.6, harmonicLevel: 0.5,
      cutoffStart: 1200, cutoffEnd: 150, resonance: 3,
      attack: 0.003, ampLevel: 0.42, saturation: 0.3,
      sidechainDepth: 0.4, sidechainRelease: 0.12,
    },
    lead: {
      oscType: 'saw', numOscs: 5, detune: 10,
      cutoff: 1800, resonance: 2, filterEnvAmount: 0.5,
      lfoRate: 0.8, lfoDepth: 0.3, saturation: 0.2,
      level: 0.16, stereoSpread: 0.4,
    },
    pad: {
      oscType: 'saw', numOscs: 2, detune: 7,
      cutoff: 1200, resonance: 0.5,
      attack: 0.5, release: 1.5,
      evolveRate: 0.1, evolveDepth: 5,
      level: 0.08, reverbSend: 0.4,
    },
    hat: {
      useSample: true, sampleName: 'hat_closed.wav',
      metallicRatios: [1, 1.577, 2.135, 3.422],
      noiseLevel: 0.4, hpFreq: 7500,
      closedDecay: 0.04, openDecay: 0.25,
      level: 0.12,
    },
    clap: {
      useSample: true, sampleName: 'clap.wav',
      numBursts: 4, burstSpacing: 0.01,
      bpFreq: 1800, tailDecay: 0.12,
      level: 0.3,
    },
    perc: { type: 'perc', pitch: 400, decay: 0.08, hpFreq: 0, level: 0.12 },
    shaker: { type: 'shaker', pitch: 0, decay: 0.06, hpFreq: 6000, level: 0.06 },
    channels: {
      kick:   { name: 'kick',   gainDb: -2,  hpFreq: 30,  pan: 0,    width: 0,   reverbSend: 0.05, delaySend: 0 },
      bass:   { name: 'bass',   gainDb: -3,  hpFreq: 20,  pan: 0,    width: 0,   reverbSend: 0.02, delaySend: 0 },
      lead:   { name: 'lead',   gainDb: -7,  hpFreq: 80,  pan: 0,    width: 0.4, reverbSend: 0.2,  delaySend: 0.2 },
      pad:    { name: 'pad',    gainDb: -8,  hpFreq: 80,  pan: 0,    width: 0.7, reverbSend: 0.35, delaySend: 0.1 },
      hat:    { name: 'hat',    gainDb: -10, hpFreq: 100, pan: 0.2,  width: 0.3, reverbSend: 0.1,  delaySend: 0.05 },
      clap:   { name: 'clap',   gainDb: -8,  hpFreq: 100, pan: 0,    width: 0.2, reverbSend: 0.2,  delaySend: 0.1 },
      perc:   { name: 'perc',   gainDb: -12, hpFreq: 100, pan: 0.3,  width: 0.3, reverbSend: 0.1,  delaySend: 0.05 },
      shaker: { name: 'shaker', gainDb: -14, hpFreq: 100, pan: -0.2, width: 0.4, reverbSend: 0.05, delaySend: 0 },
      texture:{ name: 'texture',gainDb: -16, hpFreq: 120, pan: 0,    width: 0.8, reverbSend: 0.4,  delaySend: 0.2 },
      fx:     { name: 'fx',     gainDb: -6,  hpFreq: 40,  pan: 0,    width: 0.85,reverbSend: 0.3,  delaySend: 0.15 },
    },
  },

  'dark-psy': {
    kick: {
      fundamental: 48, startMult: 2.4, pitchDecay: 0.03, decay: 0.16,
      subLevel: 0.95, midLevel: 0.5, clickLevel: 0.1, saturation: 0.6,
      level: 0.95, useSample: true, sampleName: 'kick.wav',
    },
    bass: {
      subLevel: 0.7, harmonicLevel: 0.6,
      cutoffStart: 1000, cutoffEnd: 120, resonance: 6,
      attack: 0.002, ampLevel: 0.45, saturation: 0.5,
      sidechainDepth: 0.55, sidechainRelease: 0.1,
    },
    lead: {
      oscType: 'square', numOscs: 5, detune: 15,
      cutoff: 1500, resonance: 4, filterEnvAmount: 0.6,
      lfoRate: 1.5, lfoDepth: 0.4, saturation: 0.4,
      level: 0.14, stereoSpread: 0.35,
    },
    pad: {
      oscType: 'saw', numOscs: 2, detune: 7,
      cutoff: 800, resonance: 0.8,
      attack: 0.8, release: 2.0,
      evolveRate: 0.08, evolveDepth: 4,
      level: 0.07, reverbSend: 0.3,
    },
    hat: {
      useSample: true, sampleName: 'hat_closed.wav',
      metallicRatios: [1, 1.577, 2.135, 3.422],
      noiseLevel: 0.5, hpFreq: 8000,
      closedDecay: 0.035, openDecay: 0.2,
      level: 0.1,
    },
    clap: {
      useSample: true, sampleName: 'clap.wav',
      numBursts: 4, burstSpacing: 0.012,
      bpFreq: 1600, tailDecay: 0.1,
      level: 0.25,
    },
    perc: { type: 'perc', pitch: 300, decay: 0.06, hpFreq: 0, level: 0.1 },
    shaker: { type: 'shaker', pitch: 0, decay: 0.05, hpFreq: 7000, level: 0.05 },
    channels: {
      kick:   { name: 'kick',   gainDb: -1,  hpFreq: 30,  pan: 0,    width: 0,   reverbSend: 0.03, delaySend: 0 },
      bass:   { name: 'bass',   gainDb: -2,  hpFreq: 20,  pan: 0,    width: 0,   reverbSend: 0.01, delaySend: 0 },
      lead:   { name: 'lead',   gainDb: -8,  hpFreq: 80,  pan: 0,    width: 0.35,reverbSend: 0.15, delaySend: 0.15 },
      pad:    { name: 'pad',    gainDb: -10, hpFreq: 80,  pan: 0,    width: 0.6, reverbSend: 0.25, delaySend: 0.08 },
      hat:    { name: 'hat',    gainDb: -10, hpFreq: 100, pan: 0.15, width: 0.25,reverbSend: 0.05, delaySend: 0.03 },
      clap:   { name: 'clap',   gainDb: -8,  hpFreq: 100, pan: 0,    width: 0.15,reverbSend: 0.1,  delaySend: 0.05 },
      perc:   { name: 'perc',   gainDb: -12, hpFreq: 100, pan: 0.3,  width: 0.3, reverbSend: 0.08, delaySend: 0.03 },
      shaker: { name: 'shaker', gainDb: -14, hpFreq: 100, pan: -0.2, width: 0.35,reverbSend: 0.03, delaySend: 0 },
      texture:{ name: 'texture',gainDb: -14, hpFreq: 120, pan: 0,    width: 0.75,reverbSend: 0.35, delaySend: 0.15 },
      fx:     { name: 'fx',     gainDb: -5,  hpFreq: 40,  pan: 0,    width: 0.8, reverbSend: 0.25, delaySend: 0.12 },
    },
  },

  'goa': {
    kick: {
      fundamental: 52, startMult: 2.4, pitchDecay: 0.035, decay: 0.2,
      subLevel: 0.9, midLevel: 0.45, clickLevel: 0.09, saturation: 0.5,
      level: 0.95, useSample: true, sampleName: 'kick.wav',
    },
    bass: {
      subLevel: 0.65, harmonicLevel: 0.55,
      cutoffStart: 1500, cutoffEnd: 180, resonance: 8,
      attack: 0.002, ampLevel: 0.44, saturation: 0.4,
      sidechainDepth: 0.5, sidechainRelease: 0.11,
    },
    lead: {
      oscType: 'saw', numOscs: 5, detune: 20,
      cutoff: 2500, resonance: 5, filterEnvAmount: 0.7,
      lfoRate: 1.2, lfoDepth: 0.4, saturation: 0.3,
      level: 0.15, stereoSpread: 0.4,
    },
    pad: {
      oscType: 'saw', numOscs: 2, detune: 7,
      cutoff: 1500, resonance: 0.6,
      attack: 0.6, release: 1.8,
      evolveRate: 0.12, evolveDepth: 6,
      level: 0.07, reverbSend: 0.4,
    },
    hat: {
      useSample: true, sampleName: 'hat_closed.wav',
      metallicRatios: [1, 1.577, 2.135, 3.422],
      noiseLevel: 0.4, hpFreq: 7500,
      closedDecay: 0.04, openDecay: 0.25,
      level: 0.11,
    },
    clap: {
      useSample: true, sampleName: 'clap.wav',
      numBursts: 4, burstSpacing: 0.01,
      bpFreq: 1800, tailDecay: 0.12,
      level: 0.28,
    },
    perc: { type: 'perc', pitch: 350, decay: 0.07, hpFreq: 0, level: 0.11 },
    shaker: { type: 'shaker', pitch: 0, decay: 0.06, hpFreq: 6000, level: 0.05 },
    channels: {
      kick:   { name: 'kick',   gainDb: -2,  hpFreq: 30,  pan: 0,    width: 0,   reverbSend: 0.05, delaySend: 0 },
      bass:   { name: 'bass',   gainDb: -2,  hpFreq: 20,  pan: 0,    width: 0,   reverbSend: 0.02, delaySend: 0 },
      lead:   { name: 'lead',   gainDb: -6,  hpFreq: 80,  pan: 0,    width: 0.4, reverbSend: 0.2,  delaySend: 0.25 },
      pad:    { name: 'pad',    gainDb: -9,  hpFreq: 80,  pan: 0,    width: 0.7, reverbSend: 0.4,  delaySend: 0.12 },
      hat:    { name: 'hat',    gainDb: -10, hpFreq: 100, pan: 0.2,  width: 0.3, reverbSend: 0.1,  delaySend: 0.05 },
      clap:   { name: 'clap',   gainDb: -8,  hpFreq: 100, pan: 0,    width: 0.2, reverbSend: 0.2,  delaySend: 0.1 },
      perc:   { name: 'perc',   gainDb: -12, hpFreq: 100, pan: 0.3,  width: 0.3, reverbSend: 0.1,  delaySend: 0.05 },
      shaker: { name: 'shaker', gainDb: -14, hpFreq: 100, pan: -0.2, width: 0.4, reverbSend: 0.05, delaySend: 0 },
      texture:{ name: 'texture',gainDb: -15, hpFreq: 120, pan: 0,    width: 0.8, reverbSend: 0.4,  delaySend: 0.2 },
      fx:     { name: 'fx',     gainDb: -6,  hpFreq: 40,  pan: 0,    width: 0.85,reverbSend: 0.3,  delaySend: 0.15 },
    },
  },
};

// Default fallback (used for worlds without explicit specs)
export const DEFAULT_VOICE_SPECS = VOICE_SPECS['progressive-psy'];

/** Get voice specs for a world, falling back to default. */
export function getVoiceSpecs(worldId: string): VoiceSpecSet {
  return VOICE_SPECS[worldId] || DEFAULT_VOICE_SPECS;
}
