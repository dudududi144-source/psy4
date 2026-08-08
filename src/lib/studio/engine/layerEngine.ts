/**
 * Layer Engine — constructs sounds from multiple compatible layers.
 *
 * Professional psytrance sounds are rarely a single sample:
 *   KICK = sub layer + body layer + click layer
 *   BASS = sub layer + body layer + character layer
 *   LEAD = fundamental + harmonic layer + stereo layer + FX tail
 *
 * The LayerEngine selects and combines layers based on musical context,
 * ensuring the layers are spectrally compatible and don't mask each other.
 */

import type { MixTracker, SampleSpectralProfile } from './mixAwareSelector';

export type LayerRole = 'sub' | 'body' | 'punch' | 'click' | 'character' | 'harmonic' | 'stereo' | 'tail' | 'texture';

export interface SoundLayer {
  role: LayerRole;
  sampleName: string;       // which sample to play
  gain: number;             // 0..1 layer level
  pitch: number;            // playback rate multiplier
  pan: number;              // -1..1
  decay: number;            // seconds
  spectralProfile: SampleSpectralProfile;
}

export interface LayeredSound {
  layers: SoundLayer[];
  totalGain: number;
  category: string;
  character: string[];
}

export interface LayerContext {
  world: string;
  section: string;
  energy: number;
  aggression: number;
  brightness: number;
  mixTracker: MixTracker;
  fundamental: number; // target pitch Hz
}

/**
 * LayerEngine — builds multi-layer sounds based on context.
 *
 * For KICK:
 *   - Sub layer: PSY3 kick.wav or deep generated kick (provides sub foundation)
 *   - Body layer: generated kick with mid punch (provides audible body)
 *   - Click layer: short noise burst (provides transient definition)
 *
 * For BASS:
 *   - Sub layer: clean sine at f/2 (provides clean low end)
 *   - Body layer: BL saw through Moog filter (provides harmonic character)
 *   - Character layer: saturated version (provides grit/aggression)
 *
 * The engine checks the mix tracker to avoid layering sounds that mask each other.
 */
export class LayerEngine {
  /**
   * Build a layered kick sound.
   * Adapts layers based on section and mix state.
   */
  buildKick(ctx: LayerContext): LayeredSound {
    const layers: SoundLayer[] = [];
    const mix = ctx.mixTracker.getSnapshot();

    // ── SUB LAYER (always present — the foundation) ──
    // Use PSY3 kick.wav or deepest generated kick
    const subCongested = mix.bands.sub > 0.7;
    const subGain = subCongested ? 0.6 : 0.9; // reduce if sub is already full
    layers.push({
      role: 'sub',
      sampleName: 'kick.wav',
      gain: subGain,
      pitch: 1.0,
      pan: 0, // sub always mono center
      decay: 0.22,
      spectralProfile: {
        subEnergy: 0.95, lowEnergy: 0.05, lowMidEnergy: 0, midEnergy: 0,
        highEnergy: 0, airEnergy: 0,
      },
    });

    // ── BODY LAYER (mid punch — adds audible definition) ──
    // Only if mid-low region isn't congested
    if (mix.bands.low < 0.6 && ctx.energy > 0.3) {
      const bodyGain = 0.35 + ctx.aggression * 0.15;
      layers.push({
        role: 'body',
        sampleName: 'kick_punchy_punchy_50hz', // generated punchy kick
        gain: bodyGain,
        pitch: 1.0,
        pan: 0,
        decay: 0.08,
        spectralProfile: {
          subEnergy: 0.3, lowEnergy: 0.5, lowMidEnergy: 0.15, midEnergy: 0.05,
          highEnergy: 0, airEnergy: 0,
        },
      });
    }

    // ── CLICK LAYER (transient — only if high region isn't harsh) ──
    if (mix.bands.high < 0.5 && ctx.section !== 'break') {
      const clickGain = 0.06 + ctx.brightness * 0.04;
      layers.push({
        role: 'click',
        sampleName: 'hat_closed_bright', // use hat sample as click source
        gain: clickGain,
        pitch: 1.0,
        pan: 0,
        decay: 0.003,
        spectralProfile: {
          subEnergy: 0, lowEnergy: 0, lowMidEnergy: 0, midEnergy: 0,
          highEnergy: 0.7, airEnergy: 0.3,
        },
      });
    }

    return {
      layers,
      totalGain: 0.9,
      category: 'kick',
      character: ['layered', ctx.section],
    };
  }

  /**
   * Build a layered bass sound.
   */
  buildBass(ctx: LayerContext): LayeredSound {
    const layers: SoundLayer[] = [];
    const mix = ctx.mixTracker.getSnapshot();

    // ── SUB LAYER (clean sine — always present) ──
    const subCongested = mix.bands.sub > 0.6;
    const subGain = subCongested ? 0.4 : 0.6;
    layers.push({
      role: 'sub',
      sampleName: 'bass_sub_layer', // synth sub (not a sample)
      gain: subGain,
      pitch: 0.5, // octave below fundamental
      pan: 0, // sub always mono
      decay: 0.18,
      spectralProfile: {
        subEnergy: 0.9, lowEnergy: 0.1, lowMidEnergy: 0, midEnergy: 0,
        highEnergy: 0, airEnergy: 0,
      },
    });

    // ── BODY LAYER (filtered saw — harmonic character) ──
    const bodyCongested = mix.bands.lowMid > 0.7;
    if (!bodyCongested) {
      const bodyGain = 0.5 + ctx.aggression * 0.2;
      layers.push({
        role: 'body',
        sampleName: 'bass_rolling_deep_82hz',
        gain: bodyGain,
        pitch: 1.0,
        pan: 0, // bass body stays center
        decay: 0.16,
        spectralProfile: {
          subEnergy: 0.4, lowEnergy: 0.4, lowMidEnergy: 0.15, midEnergy: 0.05,
          highEnergy: 0, airEnergy: 0,
        },
      });
    }

    // ── CHARACTER LAYER (saturation — adds grit, only in drops) ──
    if (ctx.section === 'drop' || ctx.section === 'climax') {
      if (mix.bands.mid < 0.5) {
        const charGain = 0.2 + ctx.aggression * 0.15;
        layers.push({
          role: 'character',
          sampleName: 'bass_acidic_dark_80hz',
          gain: charGain,
          pitch: 1.0,
          pan: 0,
          decay: 0.14,
          spectralProfile: {
            subEnergy: 0.1, lowEnergy: 0.3, lowMidEnergy: 0.4, midEnergy: 0.15,
            highEnergy: 0.05, airEnergy: 0,
          },
        });
      }
    }

    return {
      layers,
      totalGain: 0.7,
      category: 'bass',
      character: ['layered', ctx.world],
    };
  }

  /**
   * Build a layered lead sound.
   */
  buildLead(ctx: LayerContext, role: 'primary' | 'counter'): LayeredSound {
    const layers: SoundLayer[] = [];
    const mix = ctx.mixTracker.getSnapshot();
    const panOffset = role === 'counter' ? 0.2 : 0;

    // ── FUNDAMENTAL LAYER ──
    const fundamentalCongested = mix.bands.mid > 0.7;
    const fundGain = fundamentalCongested ? 0.5 : 0.7;
    layers.push({
      role: 'body',
      sampleName: role === 'primary' ? 'lead_supersaw_psy_440hz' : 'lead_resonant_goa_392hz',
      gain: fundGain,
      pitch: 1.0,
      pan: panOffset,
      decay: 0.3,
      spectralProfile: {
        subEnergy: 0, lowEnergy: 0, lowMidEnergy: 0.1, midEnergy: 0.6,
        highEnergy: 0.25, airEnergy: 0.05,
      },
    });

    // ── STEREO LAYER (only if stereo field isn't saturated) ──
    if (mix.stereoWidth < 0.7) {
      layers.push({
        role: 'stereo',
        sampleName: 'lead_wide_atmospheric_415hz',
        gain: 0.3,
        pitch: 1.0,
        pan: -panOffset, // opposite side for width
        decay: 0.28,
        spectralProfile: {
          subEnergy: 0, lowEnergy: 0, lowMidEnergy: 0.05, midEnergy: 0.5,
          highEnergy: 0.35, airEnergy: 0.1,
        },
      });
    }

    // ── AIR LAYER (brightness — only if highs aren't harsh) ──
    if (mix.bands.high < 0.5 && ctx.brightness > 0.5) {
      layers.push({
        role: 'harmonic',
        sampleName: 'lead_bright_trance_523hz',
        gain: 0.15,
        pitch: 2.0, // octave up for air
        pan: panOffset * 0.5,
        decay: 0.2,
        spectralProfile: {
          subEnergy: 0, lowEnergy: 0, lowMidEnergy: 0, midEnergy: 0.2,
          highEnergy: 0.5, airEnergy: 0.3,
        },
      });
    }

    return {
      layers,
      totalGain: role === 'primary' ? 0.2 : 0.15,
      category: 'lead',
      character: ['layered', role],
    };
  }
}
