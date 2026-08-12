/**
 * MusicalDirector — decides WHAT should happen next.
 *
 * F7 RULE 3: Not an audio engine, not a scheduler, not a clock.
 * It answers only: "WHAT SHOULD HAPPEN NEXT?"
 *
 * Inputs: OpportunityMap, StyleGrammar, GrooveEngine, RadioWindow, Memory
 * Output: MusicalDecision (explainable)
 *
 * The director uses the foundation's planPhrase + CandidateScorer
 * to make intelligent, explainable musical decisions.
 */

import type { OpportunityMap } from './OpportunityEngine';
import type { StyleGrammarDef, MusicalStyle } from './StyleGrammar';
import type { GroovePlan } from './GrooveEngine';
import type { RadioWindowSnapshot } from '../RadioMusicalWindow';

export type MusicalRole = 'LEAD' | 'COUNTERMELODY' | 'BASS' | 'RHYTHMIC' | 'TEXTURE' | 'RESPONSE' | 'SUPPORT' | 'ABSTAIN';
export type PhraseAction = 'introduce' | 'repeat' | 'develop' | 'transform' | 'variation' | 'cadence' | 'response' | 'rest';

export interface MusicalDecision {
  readonly role: MusicalRole;
  readonly action: PhraseAction;
  readonly motifId: string | null;
  readonly transformType: string;
  readonly density: number;
  readonly register: number; // 0=low, 1=high
  readonly tensionTarget: number;
  readonly shouldRest: boolean;
  readonly reason: string;
  readonly radioInfluence: number;
  readonly memoryInfluence: number;
  readonly grooveStrategy: string;
  readonly bassStrategy: string;
}

export interface DirectorSnapshot {
  readonly decision: MusicalDecision;
  readonly style: MusicalStyle;
  readonly styleConfidence: number;
  readonly styleState: string;
  readonly opportunitySummary: string;
}

export class MusicalDirector {
  private lastDecision: MusicalDecision | null = null;

  /**
   * Decide what to do for this bar.
   */
  decide(
    barInPhrase: number,
    opportunity: OpportunityMap,
    grammar: StyleGrammarDef,
    groove: GroovePlan,
    radio: RadioWindowSnapshot,
    memoryAvgReward: number,
    bar: number,
  ): MusicalDecision {
    // ── Role selection ──
    let role: MusicalRole = 'LEAD';
    let shouldRest = false;
    let reason = '';

    // ABSTAIN logic (F7 RULE 3)
    if (opportunity.overallDensity > 0.8 && barInPhrase === 6) {
      role = 'ABSTAIN';
      shouldRest = true;
      reason = `radio very dense (${opportunity.overallDensity.toFixed(2)}), resting at cadence`;
    } else if (radio.silenceLikelihood > 0.7 && Math.random() < 0.4) {
      role = 'ABSTAIN';
      shouldRest = true;
      reason = `radio silence likely, resting`;
    } else if (grammar.restPolicy > 0.2 && barInPhrase === 7 && Math.random() < grammar.restPolicy) {
      role = 'ABSTAIN';
      shouldRest = true;
      reason = `phrase ending rest (style ${grammar.name} restPolicy=${grammar.restPolicy})`;
    } else if (opportunity.lead === 'FULL' && opportunity.counterline === 'OPEN') {
      role = 'COUNTERMELODY';
      reason = 'radio lead full, providing countermelody';
    } else if (opportunity.bass === 'FULL' && opportunity.lead === 'OPEN') {
      role = 'LEAD';
      reason = 'radio bass full, providing lead';
    } else if (opportunity.bass === 'OPEN') {
      role = 'BASS';
      reason = 'radio bass open, providing bass support';
    } else if (opportunity.kick === 'FULL' && opportunity.hats > 0.5) {
      role = 'RESPONSE';
      reason = 'radio rhythm full, responding melodically';
    } else if (opportunity.texture === 'OPEN' && opportunity.overallDensity < 0.4) {
      role = 'TEXTURE';
      reason = 'sparse radio, providing texture';
    } else {
      role = 'LEAD';
      reason = 'default lead role';
    }

    // ── Action within phrase ──
    const action = this.chooseAction(barInPhrase, grammar);

    // ── Density ──
    let density = grammar.melodicDensity;
    if (radio.energyRising) density = Math.min(1, density * 1.1);
    if (radio.energyFalling) density *= 0.85;
    if (barInPhrase === 6) density *= 0.7; // cadence = less dense
    if (barInPhrase === 0) density = Math.min(1, density * 1.2); // introduce = slightly more

    // ── Register ──
    let register = 0.5;
    if (role === 'COUNTERMELODY') register = 0.7;
    if (role === 'BASS') register = 0.1;
    if (role === 'TEXTURE') register = 0.3;
    if (radio.energyRising) register = Math.min(1, register + 0.1);

    // ── Tension target ──
    const tensionTarget = grammar.tensionRange[0] +
      (grammar.tensionRange[1] - grammar.tensionRange[0]) * (barInPhrase / 7);

    // ── Transform type ──
    const transformType = this.chooseTransform(action, barInPhrase, grammar);

    // ── Influences ──
    const radioInfluence = Math.min(1, radio.overallConfidence * (opportunity.overallDensity + 0.3));
    const memoryInfluence = Math.min(1, memoryAvgReward * 0.5 + (bar > 16 ? 0.3 : 0));

    // ── Strategies ──
    const grooveStrategy = groove.reason;
    const bassStrategy = grammar.bassStyle;

    const decision: MusicalDecision = {
      role,
      action,
      motifId: null, // set by the runtime that calls the director
      transformType,
      density: Math.max(0.1, Math.min(1, density)),
      register: Math.max(0, Math.min(1, register)),
      tensionTarget,
      shouldRest,
      reason,
      radioInfluence,
      memoryInfluence,
      grooveStrategy,
      bassStrategy,
    };

    this.lastDecision = decision;
    return decision;
  }

  getLastDecision(): MusicalDecision | null {
    return this.lastDecision;
  }

  private chooseAction(barInPhrase: number, grammar: StyleGrammarDef): PhraseAction {
    // Phrase development varies by style
    if (grammar.sectionBehavior === 'hypnotic') {
      // Dark: longer repeats, slower development
      switch (barInPhrase) {
        case 0: return 'introduce';
        case 1: case 2: case 3: return 'repeat';
        case 4: case 5: return 'develop';
        case 6: return 'cadence';
        case 7: return 'response';
      }
    } else if (grammar.sectionBehavior === 'aggressive') {
      // Full On / Acid: faster development
      switch (barInPhrase) {
        case 0: return 'introduce';
        case 1: return 'repeat';
        case 2: case 3: return 'develop';
        case 4: case 5: return 'transform';
        case 6: return 'cadence';
        case 7: return 'response';
      }
    }
    // Progressive: gradual
    switch (barInPhrase) {
      case 0: return 'introduce';
      case 1: case 2: return 'repeat';
      case 3: case 4: return 'develop';
      case 5: return 'variation';
      case 6: return 'cadence';
      case 7: return 'response';
    }
    return 'repeat';
  }

  private chooseTransform(action: PhraseAction, barInPhrase: number, grammar: StyleGrammarDef): string {
    if (action !== 'develop' && action !== 'transform' && action !== 'variation') return 'none';
    if (Math.random() > grammar.transformationRate) return 'none';

    const r = Math.random();
    if (r < 0.3) return 'transpose';
    if (r < 0.55) return 'invert';
    if (r < 0.75) return 'fragment';
    if (r < 0.9) return 'retrograde';
    return 'transpose';
  }

  reset(): void {
    this.lastDecision = null;
  }
}
