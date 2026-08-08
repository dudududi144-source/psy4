/**
 * SampleSelector — Context-aware sample selection with scoring.
 *
 * Instead of `random(samples)`, this scores each candidate by:
 *   genreFit + spectralFit + energyFit + sectionFit + variation
 * and chooses from the top N with weighted randomness.
 *
 * Selection is deterministic (seeded) so musical identity is preserved,
 * with controlled variation at phrase boundaries.
 */

import type { GeneratedSample } from './multisampleGenerator';

export interface SelectionContext {
  voice: 'kick' | 'bass' | 'lead' | 'hat' | 'clap' | 'acid' | 'pad';
  world: string;
  section: 'intro' | 'build' | 'drop' | 'break' | 'climax';
  energy: number;       // 0..1
  bpm: number;
  density: number;      // 0..1
  brightness: number;   // 0..1 (macro)
  aggression: number;   // 0..1 (macro)
  phrasePosition: number; // bar within phrase
  previousSampleName?: string;
  variationSeed: number;
}

export interface ScoredSample {
  sample: GeneratedSample;
  score: number;
}

export class SampleSelector {
  private bank: Map<string, GeneratedSample[]> = new Map();
  private lastSelected: Map<string, string> = new Map(); // track previous for variation
  private selectionHistory: Map<string, string[]> = new Map();

  constructor(samples: GeneratedSample[]) {
    // Group by category
    for (const s of samples) {
      const cat = s.category;
      if (!this.bank.has(cat)) this.bank.set(cat, []);
      this.bank.get(cat)!.push(s);
    }
  }

  /** Get all samples in a category. */
  getByCategory(category: string): GeneratedSample[] {
    return this.bank.get(category) || [];
  }

  /** Total sample count. */
  get size(): number {
    let total = 0;
    for (const arr of this.bank.values()) total += arr.length;
    return total;
  }

  /**
   * Select a sample using context-aware scoring.
   * Returns the best candidate with controlled variation.
   */
  select(ctx: SelectionContext): GeneratedSample | null {
    // Map voice to sample category
    let category: string;
    switch (ctx.voice) {
      case 'kick': category = 'kick'; break;
      case 'bass': case 'acid': category = 'bass'; break;
      case 'lead': case 'pad': category = 'lead'; break;
      case 'hat': category = 'hat'; break;
      case 'clap': category = 'clap'; break;
      default: category = ctx.voice;
    }

    const candidates = this.bank.get(category);
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    // Score all candidates
    const scored: ScoredSample[] = candidates.map(s => ({
      sample: s,
      score: this.score(s, ctx),
    }));

    // Sort by score (highest first)
    scored.sort((a, b) => b.score - a.score);

    // Choose from top 3 with weighted randomness (favor #1)
    const topN = Math.min(3, scored.length);
    const top = scored.slice(0, topN);
    const weights = top.map((_, i) => Math.pow(0.5, i)); // 1.0, 0.5, 0.25
    const totalW = weights.reduce((a, b) => a + b, 0);

    // Seeded random selection
    const rng = this.seededRandom(ctx.variationSeed);
    let r = rng * totalW;
    let selected = top[0].sample;
    for (let i = 0; i < top.length; i++) {
      r -= weights[i];
      if (r <= 0) { selected = top[i].sample; break; }
    }

    // Track history for variation
    this.lastSelected.set(category, selected.name);
    const history = this.selectionHistory.get(category) || [];
    history.push(selected.name);
    if (history.length > 8) history.shift();
    this.selectionHistory.set(category, history);

    return selected;
  }

  /** Score a sample against the selection context (0..1, higher = better fit). */
  private score(s: GeneratedSample, ctx: SelectionContext): number {
    let score = 0;

    // 1. Genre fit (25% weight) — does this sample fit the world?
    const genreFit = s.genreFit.includes(ctx.world) || s.genreFit.includes('all');
    score += genreFit ? 25 : 5;

    // 2. BPM fit (15% weight) — is the sample's BPM range compatible?
    const bpmFit = ctx.bpm >= s.bpmRange[0] && ctx.bpm <= s.bpmRange[1];
    score += bpmFit ? 15 : 5;

    // 3. Section fit (15% weight) — different sections want different characters
    const sectionFit = this.sectionFit(s, ctx.section);
    score += sectionFit * 15;

    // 4. Energy fit (10% weight) — high energy = more aggressive samples
    const energyFit = this.energyFit(s, ctx.energy);
    score += energyFit * 10;

    // 5. Brightness fit (10% weight) — match brightness macro
    const brightnessFit = this.brightnessFit(s, ctx.brightness);
    score += brightnessFit * 10;

    // 6. Aggression fit (10% weight) — match aggression macro
    const aggressionFit = this.aggressionFit(s, ctx.aggression);
    score += aggressionFit * 10;

    // 7. Variation (15% weight) — avoid repeating the same sample
    const variationScore = this.variationScore(s, ctx);
    score += variationScore * 15;

    return score;
  }

  private sectionFit(s: GeneratedSample, section: string): number {
    // Drop/climax: prefer punchy/aggressive
    // Break: prefer warm/soft
    // Intro: prefer balanced
    if (section === 'drop' || section === 'climax') {
      return s.character.includes('punchy') || s.character.includes('aggressive') || s.character.includes('dark') ? 1.0 : 0.5;
    }
    if (section === 'break') {
      return s.character.includes('warm') || s.character.includes('soft') || s.character.includes('atmospheric') ? 1.0 : 0.4;
    }
    if (section === 'build') {
      return s.character.includes('bright') || s.character.includes('sharp') ? 0.9 : 0.6;
    }
    return 0.7; // intro
  }

  private energyFit(s: GeneratedSample, energy: number): number {
    // High energy → aggressive/dark samples; low energy → warm/bright
    if (energy > 0.7) {
      return s.character.includes('aggressive') || s.character.includes('dark') || s.character.includes('punchy') ? 1.0 : 0.5;
    }
    if (energy < 0.3) {
      return s.character.includes('warm') || s.character.includes('soft') ? 1.0 : 0.5;
    }
    return 0.7;
  }

  private brightnessFit(s: GeneratedSample, brightness: number): number {
    // Match sample centroid to brightness macro
    if (brightness > 0.6) {
      return s.character.includes('bright') || s.character.includes('sharp') ? 1.0 : 0.5;
    }
    if (brightness < 0.4) {
      return s.character.includes('dark') || s.character.includes('deep') ? 1.0 : 0.5;
    }
    return 0.7;
  }

  private aggressionFit(s: GeneratedSample, aggression: number): number {
    if (aggression > 0.6) {
      return s.character.includes('aggressive') || s.character.includes('distorted') || s.character.includes('hard') ? 1.0 : 0.4;
    }
    if (aggression < 0.3) {
      return s.character.includes('warm') || s.character.includes('soft') || s.character.includes('smooth') ? 1.0 : 0.5;
    }
    return 0.7;
  }

  private variationScore(s: GeneratedSample, ctx: SelectionContext): number {
    // Penalize samples that were recently selected
    const history = this.selectionHistory.get(s.category) || [];
    if (history.length === 0) return 1.0;
    const lastIdx = history.lastIndexOf(s.name);
    if (lastIdx === -1) return 1.0; // not used recently
    // More recent = lower score
    const recency = (history.length - lastIdx) / history.length;
    return 1.0 - recency * 0.7; // recently used → 0.3, old use → 1.0
  }

  private seededRandom(seed: number): number {
    const s = (seed * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  }

  /** Get bank statistics for reporting. */
  getStats(): { total: number; byCategory: Record<string, number> } {
    const byCategory: Record<string, number> = {};
    for (const [cat, arr] of this.bank.entries()) {
      byCategory[cat] = arr.length;
    }
    return { total: this.size, byCategory };
  }
}
