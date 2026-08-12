/**
 * MusicalIntent — decides what musical role to play.
 *
 * F7 RULE 3: The system must be able to ABSTAIN.
 * F7 RULE 6: Every major musical decision must have a reason.
 *
 * Inputs: RadioMusicalWindow, MusicalMemory, MusicalContext
 * Output: MusicalDecision (role, motif, transform, density, register, tension, rest)
 */

import type { RadioWindowSnapshot } from './RadioMusicalWindow';
import type { MusicalMemorySnapshot } from './MusicalMemory';
import type { MusicalContextSnapshot } from './MusicalContext';

export type MusicalRole =
  | 'LEAD'        | 'COUNTERMELODY' | 'BASS'
  | 'RHYTHMIC'    | 'TEXTURE'       | 'RESPONSE'
  | 'SUPPORT'     | 'ABSTAIN';

export type PhraseAction =
  | 'introduce'   | 'repeat'    | 'develop'
  | 'transform'   | 'variation' | 'cadence'
  | 'response'    | 'rest';

export interface MusicalDecision {
  readonly role: MusicalRole;
  readonly action: PhraseAction;
  readonly motifId: string | null;
  readonly transformType: string;
  readonly density: number;
  readonly register: number;     // 0=low, 1=high
  readonly tensionTarget: number;
  readonly shouldRest: boolean;
  readonly reason: string;
  readonly radioInfluence: number; // 0-1
  readonly memoryInfluence: number; // 0-1
}

export interface MusicalIntentSnapshot {
  readonly decision: MusicalDecision;
  readonly radioConfidence: number;
  readonly memoryConfidence: number;
}

export class MusicalIntent {
  private lastDecision: MusicalDecision | null = null;

  /**
   * Decide what to do for this bar.
   */
  decide(
    bar: number,
    barInPhrase: number,
    ctx: MusicalContextSnapshot,
    radio: RadioWindowSnapshot,
    memory: MusicalMemorySnapshot,
  ): MusicalDecision {
    // ── Role selection based on radio occupancy ──
    const occ = radio.currentOccupancy;
    let role: MusicalRole = 'LEAD';
    let reason = '';

    // F7 RULE 3: ABSTAIN when radio is very dense or when energy is very low
    const totalOcc = (occ.kick + occ.bass + occ.lead + occ.hats) / 4;
    const shouldRest = this.shouldAbstain(barInPhrase, ctx, radio, totalOcc);

    if (shouldRest) {
      role = 'ABSTAIN';
      reason = `rest at phrase position ${barInPhrase}, radio density=${totalOcc.toFixed(2)}`;
    } else if (occ.bass > 0.7 && occ.lead > 0.6) {
      // Radio is full — take a textural role
      role = 'TEXTURE';
      reason = 'radio full (bass+lead high), providing texture';
    } else if (occ.bass > 0.7) {
      // Radio bass is strong — provide countermelody
      role = 'COUNTERMELODY';
      reason = 'radio bass high, providing countermelody';
    } else if (occ.lead > 0.6) {
      // Radio lead is strong — provide bass support
      role = 'BASS';
      reason = 'radio lead high, providing bass support';
    } else if (occ.kick > 0.7 && occ.hats > 0.5) {
      // Radio rhythm is full — respond melodically
      role = 'RESPONSE';
      reason = 'radio rhythm full, responding melodically';
    } else if (radio.silenceLikelihood > 0.5) {
      // Radio is quiet — take the lead
      role = 'LEAD';
      reason = 'radio sparse, taking lead';
    } else {
      role = 'LEAD';
      reason = 'default lead role';
    }

    // ── Action within phrase ──
    const action = this.chooseAction(barInPhrase, ctx, radio, memory);

    // ── Density based on section + tension + radio ──
    let density = ctx.density;
    if (ctx.sectionName === 'CLIMAX') density = Math.max(0.7, density);
    if (ctx.sectionName === 'INTRO') density = Math.min(0.5, density);
    if (radio.energyFalling) density *= 0.8; // pull back when radio energy falls
    if (radio.energyRising) density = Math.min(1, density * 1.1); // push when radio rises

    // ── Register based on tension + role ──
    let register = ctx.tension;
    if (role === 'COUNTERMELODY') register = Math.max(register, 0.6); // higher
    if (role === 'BASS') register = Math.min(register, 0.2); // lower
    if (role === 'TEXTURE') register = 0.3 + ctx.tension * 0.4; // mid

    // ── Tension target ──
    const tensionTarget = ctx.targetTension;

    // ── Transform type ──
    const transformType = this.chooseTransform(action, barInPhrase, memory);

    // ── Influences ──
    const radioInfluence = Math.min(1, radio.overallConfidence * (totalOcc + 0.3));
    const memoryInfluence = Math.min(1, memory.avgReward * 0.5 + (memory.phraseHistoryCount > 3 ? 0.3 : 0));

    const decision: MusicalDecision = {
      role,
      action,
      motifId: memory.shortTermMotifId,
      transformType,
      density: Math.max(0.1, Math.min(1, density)),
      register: Math.max(0, Math.min(1, register)),
      tensionTarget,
      shouldRest,
      reason,
      radioInfluence,
      memoryInfluence,
    };

    this.lastDecision = decision;
    return decision;
  }

  getLastDecision(): MusicalDecision | null {
    return this.lastDecision;
  }

  /**
   * F7 RULE 3: Decide whether to ABSTAIN (rest).
   */
  private shouldAbstain(
    barInPhrase: number,
    ctx: MusicalContextSnapshot,
    radio: RadioWindowSnapshot,
    totalOcc: number,
  ): boolean {
    // Rest at cadence position if tension is low
    if (barInPhrase === 6 && ctx.tension < 0.3) return true;

    // Rest if radio is extremely dense
    if (totalOcc > 0.8) return this.probabilistic(0.3);

    // Rest during low-energy radio sections
    if (radio.silenceLikelihood > 0.7) return this.probabilistic(0.4);

    // Rest at phrase boundaries in INTRO/RESOLUTION
    if ((ctx.sectionName === 'INTRO' || ctx.sectionName === 'RESOLUTION') && barInPhrase === 7) {
      return this.probabilistic(0.3);
    }

    return false;
  }

  /**
   * Choose the musical action for this bar in the phrase.
   * F7 RULE 4: Not every bar needs to be different.
   */
  private chooseAction(
    barInPhrase: number,
    ctx: MusicalContextSnapshot,
    radio: RadioWindowSnapshot,
    memory: MusicalMemorySnapshot,
  ): PhraseAction {
    // Phrase development: introduce → repeat → repeat → develop → develop → variation → cadence → response
    switch (barInPhrase) {
      case 0: return 'introduce';
      case 1: return 'repeat';
      case 2: return 'repeat';
      case 3: return 'develop';
      case 4: return 'develop';
      case 5: return 'variation';
      case 6: return 'cadence';
      case 7: return 'response';
      default: return 'repeat';
    }
  }

  /**
   * Choose which transformation to apply.
   */
  private chooseTransform(action: PhraseAction, barInPhrase: number, memory: MusicalMemorySnapshot): string {
    if (action === 'develop' || action === 'variation') {
      const r = Math.random();
      if (r < 0.3) return 'transpose';
      if (r < 0.55) return 'invert';
      if (r < 0.75) return 'fragment';
      if (r < 0.9) return 'retrograde';
      return 'transpose';
    }
    if (action === 'cadence') return 'fragment';
    return 'none';
  }

  private probabilistic(prob: number): boolean {
    return Math.random() < prob;
  }

  reset(): void {
    this.lastDecision = null;
  }
}
