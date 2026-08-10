/**
 * LearningMemory — active learning system.
 *
 * Stores successful engine parameter configurations indexed by reference
 * features, recalls them when similar radio content appears, and tracks
 * improvement over time. Persists to localStorage for cross-session learning.
 *
 * Task ID: T1 (Active learning).
 *
 * API contract (consumed by psy4EngineV2):
 *   - findClosestPattern(ref) → { pattern: LearnedPattern, score: number } | null
 *   - storePattern(pattern: LearnedPattern)
 *   - recordMatchScore(score)
 *   - getStatus() → LearningStatus
 *   - clear()
 *   - save() / load()
 */

export interface LearnedPatternRefFeatures {
  bpm: number;
  key: { root: number; scale: string };
  spectralCentroid: number;
  energy: number;
  style: string;
}

export interface LearnedPatternEngineParams {
  kickDecay: number;
  bassCutoff: number;
  leadCutoff: number;
  leadDetune: number;
  padCutoff: number;
  duck: number;
  synthMode: { lead: string; pad: string; arp: string };
  sendLevels: { reverb: number; delay: number; chorus: number; phaser: number };
}

export interface LearnedPattern {
  id: string;
  refFeatures: LearnedPatternRefFeatures;
  engineParams: LearnedPatternEngineParams;
  matchScore: number;          // 0..1
  timestamp: number;
  reinforcementCount: number;
}

export interface PatternMatch {
  pattern: LearnedPattern;
  score: number;  // similarity 0..1
}

export interface LearningStatus {
  totalPatterns: number;
  avgMatchScore: number;
  recentAvgScore: number;
  improvementRate: number;  // -1..1
  status: 'learning' | 'stable' | 'drifting' | 'empty';
  topPatterns: LearnedPattern[];
  scoreHistory: number[];
}

const STORAGE_KEY = 'psy4_learning_memory_v1';
const MAX_PATTERNS = 60;
const SCORE_HISTORY_MAX = 24;

const CAMELOT_COMPATIBLE: Record<string, string[]> = {
  minor: ['minor', 'dorian', 'phrygian', 'harmonicMinor'],
  major: ['major', 'dorian', 'mixolydian'],
  dorian: ['minor', 'dorian', 'major', 'mixolydian'],
  phrygian: ['minor', 'phrygian', 'harmonicMinor', 'phrygianDominant'],
  harmonicMinor: ['minor', 'harmonicMinor', 'phrygian', 'phrygianDominant'],
  phrygianDominant: ['phrygian', 'harmonicMinor', 'phrygianDominant', 'doubleHarmonic'],
  doubleHarmonic: ['phrygianDominant', 'harmonicMinor', 'doubleHarmonic'],
  minorPentatonic: ['minor', 'dorian', 'minorPentatonic'],
};

export class LearningMemory {
  private patterns: LearnedPattern[] = [];
  private scoreHistory: number[] = [];
  private storageAvailable = false;

  constructor() {
    this.storageAvailable = this.checkStorage();
    this.load();
  }

  private checkStorage(): boolean {
    try {
      const k = '__psy4_test__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }

  storePattern(pattern: LearnedPattern): void {
    const existing = this.findSimilar(pattern.refFeatures);
    if (existing && existing.matchScore < pattern.matchScore) {
      existing.engineParams = pattern.engineParams;
      existing.matchScore = pattern.matchScore;
      existing.timestamp = pattern.timestamp;
      existing.reinforcementCount += 1;
    } else if (existing) {
      existing.reinforcementCount += 1;
      existing.matchScore = (existing.matchScore + pattern.matchScore) / 2;
    } else {
      this.patterns.push({ ...pattern, reinforcementCount: 1 });
      if (this.patterns.length > MAX_PATTERNS) {
        this.patterns.sort((a, b) =>
          (b.matchScore * b.reinforcementCount) - (a.matchScore * a.reinforcementCount)
        );
        this.patterns = this.patterns.slice(0, MAX_PATTERNS);
      }
    }
    this.save();
  }

  findClosestPattern(ref: Partial<LearnedPatternRefFeatures>): PatternMatch | null {
    if (this.patterns.length === 0) return null;
    let best: LearnedPattern | null = null;
    let bestScore = 0;
    for (const p of this.patterns) {
      const sim = this.featureSimilarity(ref, p.refFeatures);
      if (sim > 0.55 && sim > bestScore) {
        bestScore = sim;
        best = p;
      }
    }
    return best ? { pattern: best, score: bestScore } : null;
  }

  private findSimilar(ref: LearnedPatternRefFeatures): LearnedPattern | null {
    let best: LearnedPattern | null = null;
    let bestScore = 0.6;
    for (const p of this.patterns) {
      const sim = this.featureSimilarity(ref, p.refFeatures);
      if (sim > bestScore) {
        bestScore = sim;
        best = p;
      }
    }
    return best;
  }

  private featureSimilarity(a: Partial<LearnedPatternRefFeatures>, b: LearnedPatternRefFeatures): number {
    let score = 0;
    let weight = 0;
    if (a.bpm !== undefined && a.bpm > 0) {
      const diff = Math.abs(a.bpm - b.bpm);
      score += 0.25 * Math.max(0, 1 - diff / 8);
      weight += 0.25;
    }
    if (a.style) {
      score += 0.25 * (a.style === b.style ? 1 : 0.3);
      weight += 0.25;
    }
    if (a.key && b.key) {
      const aScale = a.key.scale;
      const aRoot = a.key.root;
      const compat = CAMELOT_COMPATIBLE[b.key.scale]?.includes(aScale) ? 1 : 0.2;
      const rootDiff = Math.abs(aRoot - b.key.root) % 12;
      const rootMatch = rootDiff === 0 ? 1 : (rootDiff === 7 || rootDiff === 5 ? 0.7 : 0.3);
      score += 0.20 * compat * rootMatch;
      weight += 0.20;
    }
    if (a.spectralCentroid !== undefined && a.spectralCentroid > 0) {
      const diff = Math.abs(a.spectralCentroid - b.spectralCentroid);
      score += 0.15 * Math.max(0, 1 - diff / 2000);
      weight += 0.15;
    }
    if (a.energy !== undefined && a.energy > 0) {
      const diff = Math.abs(a.energy - b.energy);
      score += 0.15 * Math.max(0, 1 - diff / 0.4);
      weight += 0.15;
    }
    return weight === 0 ? 0 : score / weight;
  }

  recordMatchScore(score: number): void {
    this.scoreHistory.push(score);
    if (this.scoreHistory.length > SCORE_HISTORY_MAX) this.scoreHistory.shift();
  }

  private getTopPatterns(limit = 5): LearnedPattern[] {
    return [...this.patterns]
      .sort((a, b) => (b.matchScore * b.reinforcementCount) - (a.matchScore * a.reinforcementCount))
      .slice(0, limit);
  }

  getStatus(): LearningStatus {
    if (this.patterns.length === 0) {
      return {
        totalPatterns: 0,
        avgMatchScore: 0,
        recentAvgScore: 0,
        improvementRate: 0,
        status: 'empty',
        topPatterns: [],
        scoreHistory: [],
      };
    }
    const avgMatch = this.patterns.reduce((s, p) => s + p.matchScore, 0) / this.patterns.length;
    const recent = this.scoreHistory.slice(-6);
    const older = this.scoreHistory.slice(0, -6);
    const recentAvg = recent.length > 0 ? recent.reduce((s, x) => s + x, 0) / recent.length : avgMatch;
    const olderAvg = older.length > 0 ? older.reduce((s, x) => s + x, 0) / older.length : recentAvg;
    const improvementRate = recentAvg - olderAvg;
    let status: 'learning' | 'stable' | 'drifting' | 'empty' = 'stable';
    if (improvementRate > 0.03) status = 'learning';
    else if (improvementRate < -0.03) status = 'drifting';
    return {
      totalPatterns: this.patterns.length,
      avgMatchScore: avgMatch,
      recentAvgScore: recentAvg,
      improvementRate,
      status,
      topPatterns: this.getTopPatterns(5),
      scoreHistory: [...this.scoreHistory],
    };
  }

  clear(): void {
    this.patterns = [];
    this.scoreHistory = [];
    this.save();
  }

  save(): void {
    if (!this.storageAvailable) return;
    try {
      const data = JSON.stringify({
        patterns: this.patterns,
        scoreHistory: this.scoreHistory,
      });
      localStorage.setItem(STORAGE_KEY, data);
    } catch {
      // storage full or unavailable
    }
  }

  load(): void {
    if (!this.storageAvailable) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.patterns)) this.patterns = data.patterns.slice(0, MAX_PATTERNS);
      if (Array.isArray(data.scoreHistory)) this.scoreHistory = data.scoreHistory.slice(0, SCORE_HISTORY_MAX);
    } catch {
      this.patterns = [];
      this.scoreHistory = [];
    }
  }
}

export function makePatternId(): string {
  return `p_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}
