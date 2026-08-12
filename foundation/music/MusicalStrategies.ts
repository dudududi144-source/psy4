/**
 * MusicalStrategies — F20.1: Musical strategy vocabulary.
 *
 * Each strategy is a BEHAVIOR, not a preset. Different strategies produce
 * fundamentally different note patterns, rhythms, and relationships.
 *
 * The system selects between strategies based on context, energy, and
 * learned weights — not random variation within one approach.
 */

import { type Scale, degreeToMidi } from './primitives/scales';
import { type ContinuousMusicalState } from './ContinuousMusicalState';
import { Rng } from './primitives/rng';

// ── Strategy Types ───────────────────────────────────────────────────────

export type BassStrategyType =
  | 'rolling'      // 16th-note rolling psytrance bass
  | 'syncopated'   // offbeat-focused, spacey
  | 'driving'      // 8th-note relentless
  | 'sparse'       // minimal, hypnotic
  | 'acid'         // 303-style with filter sweeps
  | 'melodic'      // walking, harmonic movement
  | 'tension'      // chromatic approaches, dissonance
  | 'octave_jump'; // octave movement for energy

export type LeadStrategyType =
  | 'sparse_motif'    // few notes, memorable
  | 'rolling_motif'   // continuous 16th-note line
  | 'call_response'   // answers the bass
  | 'counter_melody'  // complements bass rhythm
  | 'arpeggio'        // arpeggiated chord tones
  | 'acid'            // resonant filter sweeps
  | 'staccato'        // short, rhythmic stabs
  | 'sustained'       // long, held notes
  | 'rising'          // ascending contour for builds
  | 'descending'      // descending for releases
  | 'atmospheric'     // sparse, wide, reverberant
  | 'hook';           // catchy repeated phrase

export type GrooveStrategyType =
  | 'straight'      // 4-on-floor
  | 'syncopated'    // offbeat accents
  | 'rolling'       // ghost notes between kicks
  | 'swung'         // swing timing
  | 'sparse'        // minimal kicks
  | 'dense';        // extra kicks for intensity

export type TextureStrategyType =
  | 'dry'           // minimal FX
  | 'atmospheric'   // reverb-heavy
  | 'noisy'         // noise layers
  | 'metallic'      // ring mod / FM
  | 'psychedelic'   // filter sweeps
  | 'dark'          // low-passed, muted
  | 'bright';       // high-passed, airy

export type TransitionStrategyType =
  | 'fill'           // drum fill
  | 'riser'          // ascending noise/pitch
  | 'downlifter'     // descending
  | 'impact'         // hit on downbeat
  | 'filter_open'    // filter sweep up
  | 'filter_close'   // filter sweep down
  | 'density_build'  // add layers
  | 'density_release'; // remove layers

export interface StrategySet {
  bass: BassStrategyType;
  lead: LeadStrategyType;
  groove: GrooveStrategyType;
  texture: TextureStrategyType;
  transition: TransitionStrategyType | null;
}

// ── Strategy Weights (learned, updated by reward) ───────────────────────

export interface StrategyWeights {
  bass: Map<BassStrategyType, number>;
  lead: Map<LeadStrategyType, number>;
  groove: Map<GrooveStrategyType, number>;
  texture: Map<TextureStrategyType, number>;
}

export function createDefaultWeights(): StrategyWeights {
  return {
    bass: new Map([
      ['rolling', 0.25], ['syncopated', 0.12], ['driving', 0.15],
      ['sparse', 0.10], ['acid', 0.10], ['melodic', 0.13],
      ['tension', 0.08], ['octave_jump', 0.07],
    ]),
    lead: new Map([
      ['sparse_motif', 0.15], ['rolling_motif', 0.12], ['call_response', 0.15],
      ['counter_melody', 0.10], ['arpeggio', 0.08], ['acid', 0.08],
      ['staccato', 0.08], ['sustained', 0.06], ['rising', 0.06],
      ['descending', 0.04], ['atmospheric', 0.05], ['hook', 0.03],
    ]),
    groove: new Map([
      ['straight', 0.30], ['syncopated', 0.15], ['rolling', 0.20],
      ['swung', 0.05], ['sparse', 0.10], ['dense', 0.20],
    ]),
    texture: new Map([
      ['dry', 0.20], ['atmospheric', 0.20], ['noisy', 0.10],
      ['metallic', 0.10], ['psychedelic', 0.15], ['dark', 0.15], ['bright', 0.10],
    ]),
  };
}

// ── Strategy Selector ────────────────────────────────────────────────────

export class StrategySelector {
  private weights: StrategyWeights;
  private rng: Rng;
  private lastStrategies: StrategySet | null = null;

  constructor(seed: number = 42) {
    this.weights = createDefaultWeights();
    this.rng = new Rng(seed);
  }

  /**
   * Select strategies for the current context.
   * Uses weighted sampling with exploration — not always the same strategy.
   */
  selectStrategies(context: {
    section: string;
    energy: number;
    tension: number;
    style: string;
    learnedPhraseCount: number;
    isBreak: boolean;
    isBuild: boolean;
    isDrop: boolean;
  }): StrategySet {
    // Context modifies weights
    const bassWeights = this.adjustBassWeights(context);
    const leadWeights = this.adjustLeadWeights(context);
    const grooveWeights = this.adjustGrooveWeights(context);
    const textureWeights = this.adjustTextureWeights(context);

    const bass = this.sample(bassWeights) as BassStrategyType;
    let lead = this.sample(leadWeights) as LeadStrategyType;

    // F20.3: Lead strategy should complement bass strategy
    lead = this.complementLead(bass, lead, context);

    const groove = this.sample(grooveWeights) as GrooveStrategyType;
    const texture = this.sample(textureWeights) as TextureStrategyType;
    const transition = this.selectTransition(context);

    const strategies: StrategySet = { bass, lead, groove, texture, transition };
    this.lastStrategies = strategies;
    return strategies;
  }

  private adjustBassWeights(ctx: { section: string; energy: number; tension: number; style: string; isBreak: boolean; isDrop: boolean }): Map<string, number> {
    const w = new Map(this.weights.bass);
    // Section influence
    if (ctx.section === 'INTRO') {
      w.set('sparse', (w.get('sparse') || 0) * 2);
      w.set('rolling', (w.get('rolling') || 0) * 0.5);
    } else if (ctx.section === 'CLIMAX' || ctx.isDrop) {
      w.set('rolling', (w.get('rolling') || 0) * 1.5);
      w.set('driving', (w.get('driving') || 0) * 1.5);
      w.set('octave_jump', (w.get('octave_jump') || 0) * 2);
    }
    if (ctx.isBreak) {
      w.set('sparse', (w.get('sparse') || 0) * 3);
      w.set('melodic', (w.get('melodic') || 0) * 2);
    }
    // Style influence
    if (ctx.style === 'ACID') {
      w.set('acid', (w.get('acid') || 0) * 3);
    } else if (ctx.style === 'DARK') {
      w.set('sparse', (w.get('sparse') || 0) * 1.5);
      w.set('tension', (w.get('tension') || 0) * 2);
    }
    return w;
  }

  private adjustLeadWeights(ctx: { section: string; energy: number; tension: number; isBreak: boolean; isBuild: boolean; isDrop: boolean }): Map<string, number> {
    const w = new Map(this.weights.lead);
    if (ctx.section === 'INTRO') {
      w.set('atmospheric', (w.get('atmospheric') || 0) * 2);
      w.set('sparse_motif', (w.get('sparse_motif') || 0) * 1.5);
    } else if (ctx.section === 'CLIMAX' || ctx.isDrop) {
      w.set('hook', (w.get('hook') || 0) * 3);
      w.set('rolling_motif', (w.get('rolling_motif') || 0) * 2);
      w.set('rising', (w.get('rising') || 0) * 2);
    }
    if (ctx.isBuild) {
      w.set('rising', (w.get('rising') || 0) * 3);
    }
    if (ctx.isBreak) {
      w.set('atmospheric', (w.get('atmospheric') || 0) * 3);
      w.set('sustained', (w.get('sustained') || 0) * 2);
    }
    return w;
  }

  private adjustGrooveWeights(ctx: { section: string; isDrop: boolean; isBreak: boolean }): Map<string, number> {
    const w = new Map(this.weights.groove);
    if (ctx.isDrop || ctx.section === 'CLIMAX') {
      w.set('dense', (w.get('dense') || 0) * 2);
      w.set('rolling', (w.get('rolling') || 0) * 1.5);
    }
    if (ctx.isBreak) {
      w.set('sparse', (w.get('sparse') || 0) * 3);
    }
    return w;
  }

  private adjustTextureWeights(ctx: { section: string; style: string; isBreak: boolean }): Map<string, number> {
    const w = new Map(this.weights.texture);
    if (ctx.style === 'DARK') {
      w.set('dark', (w.get('dark') || 0) * 2);
      w.set('atmospheric', (w.get('atmospheric') || 0) * 1.5);
    } else if (ctx.style === 'ACID') {
      w.set('psychedelic', (w.get('psychedelic') || 0) * 2);
      w.set('metallic', (w.get('metallic') || 0) * 1.5);
    }
    if (ctx.isBreak) {
      w.set('atmospheric', (w.get('atmospheric') || 0) * 3);
    }
    return w;
  }

  /**
   * F20.3: Lead strategy should complement bass strategy.
   * If bass is busy (rolling), lead should be sparse.
   * If bass is sparse, lead can be more active.
   */
  private complementLead(bass: BassStrategyType, lead: LeadStrategyType, ctx: { section: string }): LeadStrategyType {
    // Don't override during CLIMAX — let it be dense
    if (ctx.section === 'CLIMAX') return lead;

    if (bass === 'rolling' || bass === 'driving') {
      // Busy bass → lead should leave space
      if (lead === 'rolling_motif') return 'sparse_motif';
      if (lead === 'arpeggio') return 'call_response';
    } else if (bass === 'sparse') {
      // Sparse bass → lead can be more active
      if (lead === 'sparse_motif') return 'counter_melody';
      if (lead === 'atmospheric') return 'rolling_motif';
    } else if (bass === 'acid') {
      // Acid bass → lead should be staccato or sparse (not compete with filter)
      if (lead === 'rolling_motif') return 'staccato';
      if (lead === 'sustained') return 'sparse_motif';
    }
    return lead;
  }

  private selectTransition(ctx: { section: string; isBuild: boolean; isDrop: boolean; isBreak: boolean }): TransitionStrategyType | null {
    if (ctx.isBuild) return 'density_build';
    if (ctx.isDrop) return 'impact';
    if (ctx.isBreak) return 'filter_close';
    if (ctx.section === 'CLIMAX') return 'riser';
    if (ctx.section === 'RESOLUTION') return 'downlifter';
    return null;
  }

  private sample(weights: Map<string, number>): string {
    let total = 0;
    for (const [, v] of weights) total += v;
    if (total <= 0) return weights.keys().next().value ?? 'rolling';

    let r = this.rng.next() * total;
    for (const [k, v] of weights) {
      r -= v;
      if (r <= 0) return k;
    }
    return weights.keys().next().value ?? 'rolling';
  }

  /** F20.8: Update weights based on reward (EMA) */
  updateWeights(reward: number, strategies: StrategySet): void {
    const lr = 0.05; // learning rate
    const updateMap = (m: Map<string, number>, key: string) => {
      const current = m.get(key) ?? 0.1;
      // Positive reward → increase weight, negative → decrease
      const newWeight = Math.max(0.01, current * (1 + lr * (reward - 0.5)));
      m.set(key, newWeight);
    };
    updateMap(this.weights.bass, strategies.bass);
    updateMap(this.weights.lead, strategies.lead);
    updateMap(this.weights.groove, strategies.groove);
    updateMap(this.weights.texture, strategies.texture);

    // Normalize each map
    this.normalizeMap(this.weights.bass);
    this.normalizeMap(this.weights.lead);
    this.normalizeMap(this.weights.groove);
    this.normalizeMap(this.weights.texture);
  }

  private normalizeMap(m: Map<string, number>): void {
    let total = 0;
    for (const [, v] of m) total += v;
    if (total > 0) for (const [k] of m) m.set(k, (m.get(k) ?? 0) / total);
  }

  getWeights(): StrategyWeights { return this.weights; }
  getLastStrategies(): StrategySet | null { return this.lastStrategies; }

  reset(): void {
    this.weights = createDefaultWeights();
    this.lastStrategies = null;
  }
}
