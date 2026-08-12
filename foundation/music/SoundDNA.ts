/**
 * SoundDNA — F20.4: Abstract sound characteristics for synthesis.
 *
 * Describes the SONIC TERRITORY of a sound, not the exact waveform.
 * Maps to synthesis parameters for voice generation.
 */

export interface SoundDNA {
  role: 'kick' | 'bass' | 'lead' | 'hat' | 'percussion' | 'fx' | 'texture';

  // Spectral characteristics
  brightness: number;        // 0-1 (spectral centroid normalized)
  harmonicity: number;       // 0-1 (tonal vs noisy)
  noisiness: number;         // 0-1 (spectral flatness)
  spectralSlope: number;     // -1 to 0 (high-freq rolloff rate)
  roughness: number;         // 0-1 (dissonance/amplitude modulation)

  // Energy distribution
  subEnergy: number;         // 0-1 (below 80Hz)
  bodyEnergy: number;        // 0-1 (80-500Hz)
  midEnergy: number;         // 0-1 (500-2500Hz)
  highEnergy: number;        // 0-1 (above 2500Hz)

  // Transient/dynamics
  transientSharpness: number; // 0-1 (attack speed)
  attackTime: number;         // seconds
  decayTime: number;          // seconds
  sustainLevel: number;       // 0-1
  releaseTime: number;        // seconds

  // Saturation/distortion
  saturation: number;         // 0-1 (waveshaper amount)
  distortionCharacter: number; // 0-1 (soft clip to hard clip)

  // Filter
  filterCutoff: number;       // Hz
  filterResonance: number;    // Q
  filterType: 'lowpass' | 'bandpass' | 'highpass' | 'notch';
  filterEnvelopeAmount: number; // 0-1 (how much filter moves per note)

  // Pitch/modulation
  pitchModulation: number;    // 0-1 (vibrato/pitch env amount)
  fmAmount: number;           // 0-1 (FM modulation)
  detune: number;             // cents

  // Stereo
  stereoWidth: number;        // 0-1 (mono to wide)
  stereoMotion: number;       // 0-1 (static to moving)

  // Context
  confidence: number;
  usageCount: number;
  reward: number;
  sourceStyle: string;
  sourceContext: string;
}

// ── Sound Family System ─────────────────────────────────────────────────

export type BassSoundFamily =
  | 'clean_rolling' | 'saturated_rolling' | 'dark' | 'acidic'
  | 'metallic' | 'dirty' | 'deep_sub' | 'harmonic' | 'aggressive';

export type LeadSoundFamily =
  | 'pluck' | 'acid' | 'resonant' | 'fm' | 'metallic'
  | 'vocal_like' | 'noisy' | 'psychedelic' | 'wide' | 'distorted';

export type PercussionSoundFamily =
  | 'tight' | 'noisy' | 'metallic' | 'organic' | 'dark' | 'bright';

// ── SoundDNA → Synthesis Parameter Mapping ──────────────────────────────

export interface SynthRecipe {
  // Oscillators
  oscType: OscillatorType;
  oscLayers: number;
  detune: number; // cents
  fmAmount: number;

  // Filter
  filterType: BiquadFilterType;
  filterCutoff: number;
  filterResonance: number;
  filterEnvAmount: number;

  // Envelope
  attackTime: number;
  decayTime: number;
  sustainLevel: number;
  releaseTime: number;

  // Saturation
  saturationAmount: number;

  // Stereo
  stereoWidth: number;

  // Levels
  subLevel: number;
  bodyLevel: number;
  harmonicLevel: number;
}

/**
 * Map a SoundDNA to a synthesis recipe.
 * This is where abstract sound characteristics become concrete synth params.
 */
export function mapSoundDNAToRecipe(dna: SoundDNA): SynthRecipe {
  // Oscillator type based on harmonicity
  let oscType: OscillatorType = 'sawtooth';
  if (dna.harmonicity < 0.3) oscType = 'sine';
  else if (dna.harmonicity < 0.5) oscType = 'triangle';
  else if (dna.harmonicity < 0.75) oscType = 'sawtooth';
  else oscType = 'square';

  // Layers based on richness
  const oscLayers = dna.harmonicity > 0.6 ? 3 : dna.harmonicity > 0.3 ? 2 : 1;

  // FM amount
  const fmAmount = dna.fmAmount;

  // Filter
  const filterCutoff = dna.filterCutoff > 0 ? dna.filterCutoff : 300 + dna.brightness * 3000;
  const filterResonance = dna.filterResonance > 0 ? dna.filterResonance : 1 + dna.roughness * 8;

  // Envelope from transient characteristics
  const attackTime = dna.attackTime > 0 ? dna.attackTime : 0.001 + (1 - dna.transientSharpness) * 0.02;
  const decayTime = dna.decayTime > 0 ? dna.decayTime : 0.1 + (1 - dna.transientSharpness) * 0.3;
  const sustainLevel = dna.sustainLevel > 0 ? dna.sustainLevel : 0.3;
  const releaseTime = dna.releaseTime > 0 ? dna.releaseTime : 0.05 + (1 - dna.transientSharpness) * 0.2;

  return {
    oscType,
    oscLayers,
    detune: dna.detune,
    fmAmount,
    filterType: dna.filterType as BiquadFilterType,
    filterCutoff,
    filterResonance,
    filterEnvAmount: dna.filterEnvelopeAmount,
    attackTime,
    decayTime,
    sustainLevel,
    releaseTime,
    saturationAmount: dna.saturation,
    stereoWidth: dna.stereoWidth,
    subLevel: dna.subEnergy,
    bodyLevel: dna.bodyEnergy,
    harmonicLevel: dna.midEnergy,
  };
}

/**
 * Create a SoundDNA from learned timbre features.
 * This is where radio observation → sound understanding happens.
 */
export function createSoundDNAFromTimbre(
  role: SoundDNA['role'],
  timbre: {
    brightness: number;
    noisiness: number;
    lowRatio: number;
    midRatio: number;
    highRatio: number;
  },
  context: { style: string; section: string },
): SoundDNA {
  return {
    role,
    brightness: timbre.brightness,
    harmonicity: 1 - timbre.noisiness,
    noisiness: timbre.noisiness,
    spectralSlope: -0.5 - timbre.brightness * 0.3,
    roughness: timbre.noisiness * 0.5,
    subEnergy: timbre.lowRatio,
    bodyEnergy: timbre.lowRatio * 0.7,
    midEnergy: timbre.midRatio,
    highEnergy: timbre.highRatio,
    transientSharpness: role === 'kick' ? 0.8 : role === 'hat' ? 0.9 : 0.5,
    attackTime: role === 'kick' ? 0.001 : role === 'bass' ? 0.005 : 0.01,
    decayTime: role === 'kick' ? 0.2 : role === 'bass' ? 0.3 : 0.25,
    sustainLevel: role === 'bass' ? 0.3 : 0.1,
    releaseTime: 0.1,
    saturation: role === 'bass' ? 0.4 + timbre.noisiness * 0.3 : role === 'lead' ? 0.2 + timbre.noisiness * 0.3 : 0.1,
    distortionCharacter: timbre.noisiness,
    filterCutoff: 0, // computed in mapSoundDNAToRecipe
    filterResonance: 0,
    filterType: 'lowpass',
    filterEnvelopeAmount: role === 'bass' ? 0.6 : 0.3,
    pitchModulation: role === 'lead' ? 0.1 : 0,
    fmAmount: 0,
    detune: role === 'lead' ? 7 : 0,
    stereoWidth: role === 'lead' ? 0.6 : 0,
    stereoMotion: 0,
    confidence: 0.5,
    usageCount: 0,
    reward: 0.5,
    sourceStyle: context.style,
    sourceContext: context.section,
  };
}
