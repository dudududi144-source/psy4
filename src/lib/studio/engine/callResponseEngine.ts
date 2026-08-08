/**
 * Call/Response + Counter-Melody Engine.
 *
 * Prevents "MIDI soup" — where every voice plays simultaneously.
 * Implements call/response between primary lead and counter-lead:
 *
 *   Bars 0-1: PRIMARY LEAD (statement)
 *   Bars 2-3: COUNTER LEAD (response)
 *   Bars 4-5: PRIMARY LEAD variation
 *   Bars 6-7: COUNTER + FX (answer)
 *
 * Never lets every musical voice play continuously.
 */

import { SeededRng, EvolvingSequence, scaleNote, type TensionShape } from './musicalGrammar';

export type VoiceRole = 'primary-lead' | 'counter-lead' | 'bass' | 'pad' | 'texture' | 'none';

export interface PhrasePlan {
  bars: number;
  // Per-bar role assignment: which voice plays in which bar
  roles: VoiceRole[];
  // Density per bar (0..1) — controls how many notes play
  densities: number[];
  // Energy per bar (0..1)
  energies: number[];
}

export class CallResponseEngine {
  private primarySeq: EvolvingSequence;
  private counterSeq: EvolvingSequence;
  private rng: SeededRng;
  private phraseCount = 0;

  constructor(root: number, scale: string, rng: SeededRng) {
    this.rng = rng;
    // Primary lead: standard motif
    this.primarySeq = new EvolvingSequence(root + 12, scale, rng, 4, 5);
    // Counter lead: different register (octave higher) and wider range
    this.counterSeq = new EvolvingSequence(root + 24, scale, rng, 4, 7);
  }

  /**
   * Plan an 8-bar phrase with call/response structure.
   * Returns which voice plays in each bar.
   */
  planPhrase(energy: number, section: string): PhrasePlan {
    const bars = 8;
    const roles: VoiceRole[] = [];
    const densities: number[] = [];
    const energies: number[] = [];

    for (let b = 0; b < bars; b++) {
      const e = energy * this.barEnergy(b, bars, section);
      energies.push(e);

      // Call/response pattern:
      // Bars 0-1: primary lead
      // Bars 2-3: counter lead (response)
      // Bars 4-5: primary lead variation
      // Bars 6-7: counter + texture (answer)
      if (section === 'break') {
        // Break: no lead, pad + texture only
        roles.push(b < 4 ? 'pad' : 'texture');
        densities.push(0.2);
      } else if (section === 'drop' || section === 'climax') {
        // Drop: full call/response
        if (b < 2) { roles.push('primary-lead'); densities.push(0.7 * e); }
        else if (b < 4) { roles.push('counter-lead'); densities.push(0.6 * e); }
        else if (b < 6) { roles.push('primary-lead'); densities.push(0.75 * e); }
        else { roles.push('counter-lead'); densities.push(0.65 * e); }
      } else if (section === 'build') {
        // Build: sparse, alternating
        if (b % 2 === 0) { roles.push('primary-lead'); densities.push(0.4 * e); }
        else { roles.push('counter-lead'); densities.push(0.3 * e); }
      } else {
        // Intro: very sparse, pad + occasional lead
        if (b === 2 || b === 5) { roles.push('primary-lead'); densities.push(0.3 * e); }
        else { roles.push('pad'); densities.push(0.2); }
      }
    }

    return { bars, roles, densities, energies };
  }

  /** Get the next note for the specified role. */
  nextNote(role: VoiceRole): number {
    if (role === 'primary-lead') return this.primarySeq.next();
    if (role === 'counter-lead') return this.counterSeq.next();
    return 0;
  }

  /** Evolve both sequences at phrase boundaries. */
  evolve() {
    this.primarySeq.forceMutate();
    this.counterSeq.forceMutate();
    this.phraseCount++;
  }

  /** Bar energy curve based on position and section. */
  private barEnergy(bar: number, totalBars: number, section: string): number {
    const p = bar / totalBars;
    if (section === 'build') return p; // rising
    if (section === 'break') return 1 - p; // falling
    if (section === 'drop') return 4 * p * (1 - p); // arc (peaks middle)
    return 0.7; // steady
  }

  get phraseNumber(): number { return this.phraseCount; }
}

/**
 * Density Controller — manages per-voice density budgets.
 * Different sections use different budgets to create contrast.
 */
export class DensityController {
  private budgets: Record<string, Record<string, number>> = {
    intro:    { kick: 0.5, bass: 0.3, hats: 0.4, percussion: 0.2, lead: 0.2, counterMelody: 0.1, texture: 0.3, fx: 0.1 },
    build:    { kick: 0.8, bass: 0.7, hats: 0.6, percussion: 0.4, lead: 0.4, counterMelody: 0.25, texture: 0.35, fx: 0.3 },
    drop:     { kick: 1.0, bass: 0.9, hats: 0.8, percussion: 0.5, lead: 0.5, counterMelody: 0.3, texture: 0.4, fx: 0.15 },
    break:    { kick: 0.0, bass: 0.0, hats: 0.2, percussion: 0.1, lead: 0.0, counterMelody: 0.0, texture: 0.5, fx: 0.3 },
    climax:   { kick: 1.0, bass: 1.0, hats: 0.9, percussion: 0.6, lead: 0.6, counterMelody: 0.4, texture: 0.5, fx: 0.2 },
  };

  /** Get density for a voice in a section, modulated by energy macro. */
  getDensity(voice: string, section: string, energy: number): number {
    const sectionBudgets = this.budgets[section] || this.budgets.intro;
    const base = sectionBudgets[voice] ?? 0.3;
    return Math.max(0, Math.min(1, base * (0.5 + 0.5 * energy)));
  }

  /** Check if a voice should play in this section. */
  shouldPlay(voice: string, section: string): boolean {
    const sectionBudgets = this.budgets[section] || this.budgets.intro;
    return (sectionBudgets[voice] ?? 0) > 0.05;
  }
}
