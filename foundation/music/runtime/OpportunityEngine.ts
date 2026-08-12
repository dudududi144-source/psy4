/**
 * OpportunityEngine — finds what is musically missing.
 *
 * F7 RULE 4: Instead of "what can I play?", ask "what is musically missing?"
 *
 * Analyzes radio occupancy and determines which musical roles are:
 * - FULL (radio already fills this space)
 * - MEDIUM (partial fill)
 * - OPEN (missing — engine should fill)
 */

export type SlotStatus = 'FULL' | 'MEDIUM' | 'OPEN';

export interface OpportunityMap {
  readonly kick: SlotStatus;
  readonly bass: SlotStatus;
  readonly percussion: SlotStatus;
  readonly lead: SlotStatus;
  readonly harmony: SlotStatus;
  readonly counterline: SlotStatus;
  readonly texture: SlotStatus;
  readonly transition: SlotStatus;
  readonly overallDensity: number; // 0-1
  readonly openCount: number;
  readonly reason: string;
}

export class OpportunityEngine {
  /**
   * Analyze radio occupancy and find musical opportunities.
   */
  analyze(occupancy: { kick: number; bass: number; lead: number; hats: number }, energy: number): OpportunityMap {
    const threshold = (val: number) => val > 0.7 ? 'FULL' : val > 0.3 ? 'MEDIUM' : 'OPEN';

    const kick = threshold(occupancy.kick);
    const bass = threshold(occupancy.bass);
    const percussion = threshold(occupancy.hats);
    const lead = threshold(occupancy.lead);

    // Harmony: if there's mid-range activity but no clear lead
    const harmony = occupancy.lead > 0.3 && occupancy.lead < 0.7 ? 'MEDIUM' : occupancy.lead > 0.7 ? 'FULL' : 'OPEN';

    // Counterline: open if lead is full (we can provide counterpoint)
    const counterline = lead === 'FULL' ? 'OPEN' : lead === 'MEDIUM' ? 'MEDIUM' : 'OPEN';

    // Texture: open if overall density is low
    const overallDensity = (occupancy.kick + occupancy.bass + occupancy.lead + occupancy.hats) / 4;
    const texture = overallDensity < 0.3 ? 'OPEN' : overallDensity < 0.6 ? 'MEDIUM' : 'FULL';

    // Transition: open at phrase boundaries or energy changes
    const transition = energy < 0.2 || energy > 0.8 ? 'OPEN' : 'MEDIUM';

    const slots = [kick, bass, percussion, lead, harmony, counterline, texture, transition];
    const openCount = slots.filter(s => s === 'OPEN').length;

    const reason = `kick=${kick} bass=${bass} perc=${percussion} lead=${lead} density=${overallDensity.toFixed(2)} open=${openCount}`;

    return {
      kick, bass, percussion, lead, harmony, counterline, texture, transition,
      overallDensity, openCount, reason,
    };
  }
}
