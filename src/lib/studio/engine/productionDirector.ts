/**
 * Production Director — the "producer brain" of PSY4.
 *
 * This is the central intelligence that makes ALL production decisions:
 *   - Which sounds to use (via SampleSelector + MixAwareSelector)
 *   - Which layers to combine (via LayerEngine)
 *   - Which groove to apply (via GrooveEngine)
 *   - Which arrangement section to play
 *   - Which FX automation to apply
 *   - Which transitions to trigger
 *   - Which density budget to use
 *
 * The ProductionDirector takes musical context and produces a
 * ProductionPlan that the engine executes.
 */

import { MixTracker, MixAwareSelector } from './mixAwareSelector';
import { LayerEngine, type LayerContext, type LayeredSound } from './layerEngine';
import { GrooveEngine, GROOVE_PRESETS, type GrooveParams } from './grooveEngineV2';
import { DensityController } from './callResponseEngine';

export interface ProductionContext {
  world: string;
  section: 'intro' | 'build' | 'drop' | 'break' | 'climax';
  bpm: number;
  energy: number;
  aggression: number;
  brightness: number;
  psychedelia: number;
  darkness: number;
  density: number;
  bar: number;
  phrase: number;
}

export interface VoiceDecision {
  voice: string;
  shouldPlay: boolean;
  density: number;
  layerSound?: LayeredSound;
  grooveParams?: Partial<GrooveParams>;
  fxSends: {
    reverb: number;
    delay: number;
  };
  stereo: {
    width: number;
    pan: number;
  };
}

export interface ProductionPlan {
  voices: Record<string, VoiceDecision>;
  sectionEnergy: number;
  transitionFx: string[]; // list of FX to trigger
  mixAdjustments: {
    congestedBand: string | null;
    emptyBand: string | null;
    recommendedAction: string;
  };
}

export class ProductionDirector {
  private mixTracker: MixTracker;
  private mixAware: MixAwareSelector;
  private layerEngine: LayerEngine;
  private grooveEngine: GrooveEngine;
  private densityController: DensityController;

  constructor(bpm: number) {
    this.mixTracker = new MixTracker();
    this.mixAware = new MixAwareSelector(this.mixTracker);
    this.layerEngine = new LayerEngine();
    this.grooveEngine = new GrooveEngine(bpm);
    this.densityController = new DensityController();
  }

  /**
   * Make all production decisions for a given context.
   * This is called at section boundaries and phrase boundaries.
   */
  planProduction(ctx: ProductionContext): ProductionPlan {
    // ── Update groove for world ──
    const groovePreset = GROOVE_PRESETS[ctx.world] || GROOVE_PRESETS['progressive-psy'];
    this.grooveEngine.setBPM(ctx.bpm);
    this.grooveEngine.setParams(groovePreset);

    // ── Decay mix tracker (old voices fade) ──
    this.mixTracker.decay();

    // ── Mix analysis ──
    const congestion = this.mixAware.getCongestionWarning();
    const fillRec = this.mixAware.getFillRecommendation();

    // ── Voice decisions ──
    const voices: Record<string, VoiceDecision> = {};

    // KICK
    voices.kick = this.decideKick(ctx);
    // BASS
    voices.bass = this.decideBass(ctx);
    // LEAD
    voices.lead = this.decideLead(ctx);
    // HAT
    voices.hat = this.decideHat(ctx);
    // CLAP
    voices.clap = this.decideClap(ctx);
    // PAD
    voices.pad = this.decidePad(ctx);
    // TEXTURE
    voices.texture = this.decideTexture(ctx);
    // FX
    voices.fx = this.decideFX(ctx);

    // ── Transition FX ──
    const transitionFx = this.decideTransitions(ctx);

    // ── Mix adjustments recommendation ──
    let recommendedAction = 'balanced';
    if (congestion) {
      if (congestion.band === 'sub') recommendedAction = 'reduce sub layers — kick/bass masking';
      else if (congestion.band === 'mid') recommendedAction = 'reduce lead density — mid congestion';
      else if (congestion.band === 'high') recommendedAction = 'reduce hat brightness — high congestion';
    } else if (fillRec === 'sub' && ctx.section === 'drop') {
      recommendedAction = 'add sub layer — drop needs more low end';
    }

    return {
      voices,
      sectionEnergy: ctx.energy,
      transitionFx,
      mixAdjustments: {
        congestedBand: congestion?.band || null,
        emptyBand: fillRec,
        recommendedAction,
      },
    };
  }

  private decideKick(ctx: ProductionContext): VoiceDecision {
    const shouldPlay = this.densityController.shouldPlay('kick', ctx.section);
    const density = this.densityController.getDensity('kick', ctx.section, ctx.energy);
    const layerCtx: LayerContext = {
      world: ctx.world, section: ctx.section, energy: ctx.energy,
      aggression: ctx.aggression, brightness: ctx.brightness,
      mixTracker: this.mixTracker, fundamental: 50,
    };
    return {
      voice: 'kick',
      shouldPlay,
      density,
      layerSound: shouldPlay ? this.layerEngine.buildKick(layerCtx) : undefined,
      grooveParams: this.grooveEngine.getParams(),
      fxSends: { reverb: 0.05, delay: 0 }, // kick stays dry
      stereo: { width: 0, pan: 0 }, // kick always center
    };
  }

  private decideBass(ctx: ProductionContext): VoiceDecision {
    const shouldPlay = this.densityController.shouldPlay('bass', ctx.section);
    const density = this.densityController.getDensity('bass', ctx.section, ctx.energy);
    const layerCtx: LayerContext = {
      world: ctx.world, section: ctx.section, energy: ctx.energy,
      aggression: ctx.aggression, brightness: ctx.brightness,
      mixTracker: this.mixTracker, fundamental: 82,
    };
    return {
      voice: 'bass',
      shouldPlay,
      density,
      layerSound: shouldPlay ? this.layerEngine.buildBass(layerCtx) : undefined,
      grooveParams: this.grooveEngine.getParams(),
      fxSends: { reverb: 0.02, delay: 0 }, // bass stays dry
      stereo: { width: 0, pan: 0 }, // bass always center
    };
  }

  private decideLead(ctx: ProductionContext): VoiceDecision {
    const shouldPlay = this.densityController.shouldPlay('lead', ctx.section);
    const density = this.densityController.getDensity('lead', ctx.section, ctx.energy);
    const layerCtx: LayerContext = {
      world: ctx.world, section: ctx.section, energy: ctx.energy,
      aggression: ctx.aggression, brightness: ctx.brightness,
      mixTracker: this.mixTracker, fundamental: 440,
    };
    // Lead gets more reverb in break, less in drop
    const reverbSend = ctx.section === 'break' ? 0.4 : ctx.section === 'drop' ? 0.2 : 0.3;
    const delaySend = ctx.section === 'build' ? 0.3 : ctx.section === 'drop' ? 0.15 : 0.2;
    return {
      voice: 'lead',
      shouldPlay,
      density,
      layerSound: shouldPlay ? this.layerEngine.buildLead(layerCtx, 'primary') : undefined,
      grooveParams: this.grooveEngine.getParams(),
      fxSends: { reverb: reverbSend, delay: delaySend },
      stereo: { width: 0.4, pan: 0 },
    };
  }

  private decideHat(ctx: ProductionContext): VoiceDecision {
    const shouldPlay = this.densityController.shouldPlay('hats', ctx.section);
    const density = this.densityController.getDensity('hats', ctx.section, ctx.energy);
    return {
      voice: 'hat',
      shouldPlay,
      density,
      fxSends: { reverb: 0.1, delay: 0.05 },
      stereo: { width: 0.3, pan: 0.2 }, // hats get slight stereo movement
    };
  }

  private decideClap(ctx: ProductionContext): VoiceDecision {
    const shouldPlay = ctx.section !== 'intro' && ctx.section !== 'break';
    const density = shouldPlay ? 0.5 : 0;
    return {
      voice: 'clap',
      shouldPlay,
      density,
      fxSends: { reverb: 0.2, delay: 0.1 },
      stereo: { width: 0.2, pan: 0 },
    };
  }

  private decidePad(ctx: ProductionContext): VoiceDecision {
    const shouldPlay = ctx.section === 'intro' || ctx.section === 'break' || ctx.section === 'build';
    const density = shouldPlay ? 0.4 : 0.1;
    return {
      voice: 'pad',
      shouldPlay,
      density,
      fxSends: { reverb: 0.4, delay: 0.1 }, // pads get lots of reverb
      stereo: { width: 0.7, pan: 0 }, // pads are wide
    };
  }

  private decideTexture(ctx: ProductionContext): VoiceDecision {
    const shouldPlay = ctx.section !== 'intro';
    const density = shouldPlay ? 0.35 : 0;
    return {
      voice: 'texture',
      shouldPlay,
      density,
      fxSends: { reverb: 0.4, delay: 0.2 },
      stereo: { width: 0.8, pan: 0 }, // textures are wide
    };
  }

  private decideFX(ctx: ProductionContext): VoiceDecision {
    const shouldPlay = ctx.section === 'build' || ctx.section === 'drop';
    const density = shouldPlay ? 0.2 : 0.3; // more FX in break for transitions
    return {
      voice: 'fx',
      shouldPlay,
      density,
      fxSends: { reverb: 0.3, delay: 0.15 },
      stereo: { width: 0.85, pan: 0 },
    };
  }

  private decideTransitions(ctx: ProductionContext): string[] {
    const fx: string[] = [];
    // Riser before drop (last 2 bars of build)
    if (ctx.section === 'build' && ctx.bar % 8 >= 6) fx.push('riser');
    // Impact at drop start
    if (ctx.section === 'drop' && ctx.bar === 0) fx.push('impact');
    // Sweep at break start
    if (ctx.section === 'break' && ctx.bar === 0) fx.push('sweep');
    // Downlifter after drop impact
    if (ctx.section === 'drop' && ctx.bar === 0) fx.push('downlifter');
    return fx;
  }

  /** Register a voice triggering (for mix tracking). */
  registerVoice(profile: { subEnergy: number; lowEnergy: number; lowMidEnergy: number; midEnergy: number; highEnergy: number; airEnergy: number }, velocity: number) {
    this.mixTracker.registerVoice(profile, velocity);
  }

  /** Get current mix snapshot. */
  getMixSnapshot() {
    return this.mixTracker.getSnapshot();
  }

  /** Get the groove engine for step processing. */
  getGrooveEngine(): GrooveEngine {
    return this.grooveEngine;
  }
}
