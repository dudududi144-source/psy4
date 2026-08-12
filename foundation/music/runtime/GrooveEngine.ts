/**
 * GrooveEngine — owns the rhythmic backbone.
 *
 * F7 RULE 6: Kick/bass interlock is NON-NEGOTIABLE.
 * The system must NEVER accidentally remove the rhythmic backbone.
 *
 * The GrooveEngine establishes:
 * 1. Beat grid
 * 2. Kick pattern
 * 3. Bass rhythmic relationship
 * 4. Subdivision
 * 5. Then upper layers can be added
 */

import type { StyleGrammarDef } from './StyleGrammar';
import type { RhythmPattern } from '../primitives/rhythm';
import { psyKick, fourOnFloor, offbeatHats, drivingHats, backbeat, swing, combine } from '../primitives/rhythm';

export interface GroovePlan {
  readonly kickPattern: RhythmPattern;
  readonly hatPattern: RhythmPattern;
  readonly bassSteps: number[]; // which 16th steps the bass plays on
  readonly subdivision: number; // 4 = 16th notes, 3 = triplets
  readonly swingAmount: number;
  readonly ghostNotes: number[]; // steps with ghost notes
  readonly fillSteps: number[]; // fill at phrase endings
  readonly reason: string;
}

export class GrooveEngine {
  private lastPlan: GroovePlan | null = null;

  /**
   * Generate a groove plan based on style + radio context.
   */
  planGroove(
    grammar: StyleGrammarDef,
    radioOccupancy: { kick: number; bass: number; lead: number; hats: number },
    barInPhrase: number,
  ): GroovePlan {
    // ── Kick pattern ──
    let kickPattern: RhythmPattern;
    if (radioOccupancy.kick > 0.7) {
      // Radio kick is strong — complement with sparse counter-kicks
      kickPattern = psyKick();
      // Remove some kicks to avoid doubling
      const hits = [...kickPattern.hits];
      for (let i = 0; i < 16; i++) {
        if (hits[i] && i % 4 !== 0 && Math.random() > 0.3) hits[i] = false;
      }
      kickPattern = { ...kickPattern, hits };
    } else {
      kickPattern = fourOnFloor(16);
    }

    // ── Hat pattern ──
    let hatPattern: RhythmPattern;
    if (radioOccupancy.hats > 0.7) {
      // Radio hats are dense — sparse response
      hatPattern = offbeatHats(16);
    } else if (grammar.hatDensity > 0.7) {
      hatPattern = combine(offbeatHats(16), drivingHats(16));
    } else {
      hatPattern = offbeatHats(16);
    }

    // Apply swing if style demands
    if (grammar.swing > 0) {
      hatPattern = swing(hatPattern, grammar.swing);
    }

    // ── Bass steps ──
    // Bass should interlock with kick — play on offbeats relative to kick
    let bassSteps: number[];
    switch (grammar.bassStyle) {
      case 'kb3':
        bassSteps = [0, 2, 6, 10, 14]; // kick on 1, bass on offbeats
        break;
      case 'four-on-floor':
        bassSteps = [0, 4, 8, 12]; // same as kick
        break;
      case 'offbeat':
        bassSteps = [2, 6, 10, 14]; // between kicks
        break;
      case 'syncopated':
        bassSteps = [0, 3, 6, 10, 14]; // syncopated
        break;
      default:
        bassSteps = [0, 4, 8, 12];
    }

    // At phrase endings, add fill
    const fillSteps = barInPhrase === 7 ? [14, 15] : [];

    // Ghost notes on weak 16ths
    const ghostNotes: number[] = [];
    if (grammar.syncopation > 0.4) {
      for (let i = 1; i < 16; i += 2) {
        if (Math.random() < grammar.syncopation * 0.3) ghostNotes.push(i);
      }
    }

    const reason = `kick=${radioOccupancy.kick > 0.7 ? 'complement' : 'drive'} hats=${radioOccupancy.hats > 0.7 ? 'sparse' : 'normal'} bass=${grammar.bassStyle} fill=${fillSteps.length > 0}`;

    const plan: GroovePlan = {
      kickPattern,
      hatPattern,
      bassSteps,
      subdivision: 4, // 16th notes
      swingAmount: grammar.swing,
      ghostNotes,
      fillSteps,
      reason,
    };

    this.lastPlan = plan;
    return plan;
  }

  getLastPlan(): GroovePlan | null {
    return this.lastPlan;
  }

  reset(): void {
    this.lastPlan = null;
  }
}
