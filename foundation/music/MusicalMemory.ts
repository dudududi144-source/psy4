/**
 * MusicalMemory — real phrase and motif memory with learning.
 *
 * F7 RULE 5: Replace shallow motif accumulation with a real memory model.
 *
 * Structure:
 *   shortTerm: lastBar, lastPhrase, currentMotif (what just happened)
 *   mediumTerm: motifs, phraseHistory, recentTransforms (recent context)
 *   longTerm: strongestMotifs, successfulPatterns, rejectedPatterns (learned)
 *
 * F7 RULE 12: Learning must affect future decisions.
 * After each phrase, evaluate the outcome and update motif preferences.
 */

import { type MotifNote, transpose, invert, fragment, retrograde } from './primitives/motif';
import { type Scale, degreeToMidi, stableDegrees } from './primitives/scales';
import { Rng } from './primitives/rng';

export interface StoredMotif {
  readonly id: string;
  readonly notes: MotifNote[];
  readonly rootPc: number;
  readonly scaleName: string;
  readonly createdAt: number;
  readonly transform: string;
  usageCount: number;
  lastUsedBar: number;
  reward: number;      // accumulated reward from learning
  phraseIds: number[]; // which phrases used this motif
}

export interface PhraseRecord {
  readonly phraseIndex: number;
  readonly bar: number;
  readonly motifId: string;
  readonly transform: string;
  readonly section: string;
  readonly tension: number;
  readonly density: number;
  readonly noteCount: number;
  readonly restRatio: number;
  readonly reward: number;
  readonly role: string;
}

export interface MusicalMemorySnapshot {
  readonly shortTermMotifId: string | null;
  readonly mediumTermMotifCount: number;
  readonly longTermMotifCount: number;
  readonly phraseHistoryCount: number;
  readonly lastReward: number;
  readonly avgReward: number;
  readonly topMotifIds: string[];
}

const MAX_MOTIFS = 24;
const MAX_PHRASES = 32;

export class MusicalMemory {
  // Short term
  private currentMotif: StoredMotif | null = null;
  private lastPhrase: PhraseRecord | null = null;

  // Medium term
  private motifs: StoredMotif[] = [];
  private phraseHistory: PhraseRecord[] = [];

  // Long term (learned preferences)
  private motifRewards: Map<string, number> = new Map();
  private rejectedMotifs: Set<string> = new Set();

  private nextId = 0;
  private rng: Rng;

  constructor(seed: number = 42) {
    this.rng = new Rng(seed);
  }

  /**
   * Create a new motif and add to memory.
   */
  createMotif(notes: MotifNote[], rootPc: number, scaleName: string, bar: number): StoredMotif {
    const motif: StoredMotif = {
      id: `m${this.nextId++}`,
      notes: [...notes],
      rootPc,
      scaleName,
      createdAt: bar,
      transform: 'none',
      usageCount: 0,
      lastUsedBar: -1,
      reward: 0.5, // start neutral
      phraseIds: [],
    };
    this.addMotif(motif);
    this.currentMotif = motif;
    return motif;
  }

  /**
   * Transform an existing motif. Returns a NEW motif.
   */
  transformMotif(
    motif: StoredMotif,
    transformType: string,
    rootPc: number,
    scale: Scale,
    bar: number,
  ): StoredMotif {
    let notes: MotifNote[];
    switch (transformType) {
      case 'transpose':
        const degrees = this.rng.int(1, 3) * (this.rng.next() > 0.5 ? 1 : -1);
        notes = transpose(motif.notes, rootPc, scale, degrees);
        break;
      case 'invert':
        notes = invert(motif.notes, rootPc, scale);
        break;
      case 'retrograde':
        notes = retrograde(motif.notes);
        break;
      case 'fragment':
        const count = Math.max(2, Math.floor(motif.notes.length * 0.7));
        notes = fragment(motif.notes, count);
        break;
      default:
        notes = [...motif.notes];
    }

    const transformed: StoredMotif = {
      id: `m${this.nextId++}`,
      notes,
      rootPc,
      scaleName: motif.scaleName,
      createdAt: bar,
      transform: transformType,
      usageCount: 0,
      lastUsedBar: -1,
      reward: motif.reward * 0.9,
      phraseIds: [],
    };
    this.addMotif(transformed);
    return transformed;
  }

  /**
   * Pick the best motif for the current context.
   * F7 RULE 5: Uses memory + reward to make intelligent choices.
   *
   * @param bar Current bar
   * @param allowRecurrence If true, can return a previously used motif (for A-return)
   * @param noveltyBudget 0-1, how much novelty to introduce
   */
  pickMotif(bar: number, allowRecurrence: boolean, noveltyBudget: number): StoredMotif | null {
    if (this.motifs.length === 0) return null;

    // Score each motif
    const scored = this.motifs.map(m => {
      const barsSinceUse = bar - m.lastUsedBar;
      let score = m.reward * 0.4; // reward from learning

      // Recency: prefer motifs not used recently (anti-repetition)
      if (barsSinceUse < 4) score -= 0.3;
      else if (barsSinceUse > 16) score += 0.1; // old motifs good for callbacks

      // Novelty: transformed motifs get bonus when novelty is high
      if (m.transform !== 'none') score += noveltyBudget * 0.2;

      // Usage: slightly prefer less-used motifs
      score -= m.usageCount * 0.02;

      // Rejected motifs get penalty
      if (this.rejectedMotifs.has(m.id)) score -= 0.5;

      // Random tiebreaker
      score += this.rng.next() * 0.05;

      return { motif: m, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // If recurrence not allowed, skip the current motif
    let picked = scored[0];
    if (!allowRecurrence && picked.motif === this.currentMotif && scored.length > 1) {
      picked = scored[1];
    }

    // Mark as used
    const idx = this.motifs.indexOf(picked.motif);
    this.motifs[idx] = {
      ...picked.motif,
      usageCount: picked.motif.usageCount + 1,
      lastUsedBar: bar,
    };
    this.currentMotif = this.motifs[idx];
    return this.currentMotif;
  }

  /**
   * Get the current motif (short-term memory).
   */
  getCurrentMotif(): StoredMotif | null {
    return this.currentMotif;
  }

  /**
   * Record a completed phrase and evaluate its outcome.
   * F7 RULE 12: Learning updates motif preferences.
   */
  recordPhrase(record: PhraseRecord): void {
    this.phraseHistory.push(record);
    if (this.phraseHistory.length > MAX_PHRASES) this.phraseHistory.shift();
    this.lastPhrase = record;

    // Update motif reward based on phrase outcome
    const motif = this.motifs.find(m => m.id === record.motifId);
    if (motif) {
      // EMA update: reward moves toward phrase reward
      const newReward = motif.reward * 0.8 + record.reward * 0.2;
      const idx = this.motifs.indexOf(motif);
      this.motifs[idx] = { ...motif, reward: newReward };

      // Track in long-term memory
      this.motifRewards.set(motif.id, newReward);

      // Reject motifs with consistently low reward
      if (newReward < 0.2 && motif.usageCount > 2) {
        this.rejectedMotifs.add(motif.id);
      }
    }
  }

  /**
   * Get the last phrase record (for call/response).
   */
  getLastPhrase(): PhraseRecord | null {
    return this.lastPhrase;
  }

  /**
   * Get phrase history (for context).
   */
  getPhraseHistory(): PhraseRecord[] {
    return [...this.phraseHistory];
  }

  /**
   * Get the strongest motifs (long-term memory).
   */
  getStrongestMotifs(count: number = 3): StoredMotif[] {
    return [...this.motifs]
      .sort((a, b) => b.reward - a.reward)
      .slice(0, count);
  }

  /**
   * Check if a motif was used recently (for anti-repetition).
   */
  wasUsedRecently(motifId: string, withinBars: number): boolean {
    const motif = this.motifs.find(m => m.id === motifId);
    if (!motif) return false;
    // Check if it was used in the last `withinBars` bars
    return this.phraseHistory.some(p =>
      p.motifId === motifId &&
      p.bar >= (this.lastPhrase?.bar ?? 0) - withinBars
    );
  }

  snapshot(): MusicalMemorySnapshot {
    return {
      shortTermMotifId: this.currentMotif?.id ?? null,
      mediumTermMotifCount: this.motifs.length,
      longTermMotifCount: this.motifRewards.size,
      phraseHistoryCount: this.phraseHistory.length,
      lastReward: this.lastPhrase?.reward ?? 0,
      avgReward: this.phraseHistory.length > 0
        ? this.phraseHistory.reduce((a, p) => a + p.reward, 0) / this.phraseHistory.length
        : 0,
      topMotifIds: this.getStrongestMotifs(3).map(m => m.id),
    };
  }

  reset(): void {
    this.currentMotif = null;
    this.lastPhrase = null;
    this.motifs = [];
    this.phraseHistory = [];
    this.motifRewards.clear();
    this.rejectedMotifs.clear();
    this.nextId = 0;
    this.rng = new Rng(42);
  }

  private addMotif(motif: StoredMotif): void {
    this.motifs.push(motif);
    if (this.motifs.length > MAX_MOTIFS) {
      // Remove lowest-reward motifs
      this.motifs.sort((a, b) => b.reward - a.reward);
      this.motifs = this.motifs.slice(0, MAX_MOTIFS);
    }
  }
}
