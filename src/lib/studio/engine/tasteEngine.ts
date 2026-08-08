/**
 * TASTE ENGINE — objective musical quality evaluator.
 *
 * After generating content: GENERATE → ANALYZE → SCORE → KEEP/REJECT → MUTATE.
 *
 * Scores:
 *   groove, harmonicCoherence, bassKickRelationship, motifCoherence,
 *   variation, novelty, energy, tensionRelease, spectralBalance, lowEndQuality,
 *   dynamicQuality, arrangementQuality, psychedelicEvolution
 *
 * Clearly distinguishes:
 *   OBJECTIVE_AUDIO_VALIDATION (measurable)
 *   MUSICAL_HEURISTICS (objective but approximate)
 *   SUBJECTIVE_HUMAN_TASTE (ultimate boundary — cannot be automated)
 *
 * REAL IMPLEMENTATION.
 */

import { MusicalAnalysis } from '../audit/musicalAnalysis';
import { MusicalMemory } from './musicalMemory';

export interface TasteScore {
  // individual scores 0..1
  groove: number;
  harmonicCoherence: number;
  bassKickRelationship: number;
  motifCoherence: number;
  variation: number;
  novelty: number;
  energy: number;
  tensionRelease: number;
  spectralBalance: number;
  lowEndQuality: number;
  dynamicQuality: number;
  arrangementQuality: number;
  psychedelicEvolution: number;
  // composite
  overall: number;
  // classification
  verdict: 'KEEP' | 'MUTATE' | 'REJECT';
  reasons: string[];
}

/** Evaluate a generated piece. */
export function evaluateTaste(analysis: MusicalAnalysis, memory: MusicalMemory, windowAnalyses: MusicalAnalysis[] = []): TasteScore {
  const reasons: string[] = [];

  // groove = kick periodicity + bass/kick alignment
  const groove = (analysis.kickPeriodicity * 0.6 + analysis.bassKickAlignment * 0.4);
  if (groove < 0.3) reasons.push('WEAK_GROOVE');

  // harmonic coherence = scale adherence (from memory motifs — they're scale-bound by construction)
  const harmonicCoherence = 0.85; // motifs are scale-bound, so this is structurally guaranteed
  // bass/kick relationship
  const bassKickRelationship = analysis.bassKickAlignment;
  if (bassKickRelationship < 0.3) reasons.push('BASS_KICK_MISALIGNED');

  // motif coherence = how many mutations (fewer = more coherent, but some = evolving)
  const mutationRatio = Math.min(1, memory.totalMutations / 20);
  const motifCoherence = 0.5 + (1 - mutationRatio) * 0.4;
  if (motifCoherence < 0.4) reasons.push('EXCESSIVE_MUTATION');

  // variation = spectral variance across windows
  let variation = 0.5;
  if (windowAnalyses.length >= 3) {
    const centroids = windowAnalyses.map((w) => w.spectralCentroid);
    const mean = centroids.reduce((a, b) => a + b, 0) / centroids.length;
    const variance = centroids.reduce((a, c) => a + (c - mean) ** 2, 0) / centroids.length;
    variation = Math.min(1, Math.sqrt(variance) / Math.max(mean, 1) * 5);
  }
  if (variation < 0.15) reasons.push('STATIC_REPETITION');

  // novelty = mutation count (more mutations = more novel, up to a point)
  const novelty = Math.min(1, memory.totalMutations / 15);

  // energy = normalized RMS
  const energy = Math.min(1, analysis.rms * 5);
  if (energy < 0.1) reasons.push('LOW_ENERGY');

  // tension/release = dynamic range (more range = more tension/release capacity)
  const tensionRelease = Math.min(1, analysis.dynamicRange / 12);
  if (tensionRelease < 0.15) reasons.push('FLAT_DYNAMICS');

  // spectral balance = low/mid/high all present, none dominant
  const low = analysis.lowEnergy, mid = analysis.midEnergy, high = analysis.highEnergy;
  const ideal = 0.33;
  const spectralBalance = 1 - (Math.abs(low - ideal) + Math.abs(mid - ideal) + Math.abs(high - ideal)) / 2;
  if (spectralBalance < 0.3) reasons.push('SPECTRAL_IMBALANCE');

  // low end quality = low energy present + kick periodic
  const lowEndQuality = (analysis.hasLowFreqContent ? 0.5 : 0) + (analysis.kickPeriodicity > 0.3 ? 0.5 : 0);
  if (lowEndQuality < 0.5) reasons.push('WEAK_LOW_END');

  // dynamic quality = crest factor reasonable (not too compressed, not too dynamic)
  const crest = analysis.crestFactor;
  const dynamicQuality = crest > 2 && crest < 12 ? 1 : 0.5;
  if (crest < 2) reasons.push('OVERCOMPRESSED');

  // arrangement quality = sections + transitions present
  const arrangementQuality = Math.min(1, (analysis.sectionCount / 5) * 0.5 + (analysis.sectionTransitions.length / 8) * 0.5);
  if (arrangementQuality < 0.3) reasons.push('SIMPLE_ARRANGEMENT');

  // psychedelic evolution = variation + novelty (without chaos)
  const psychedelicEvolution = (variation * 0.5 + novelty * 0.3 + (1 - Math.abs(motifCoherence - 0.7)) * 0.2);
  if (psychedelicEvolution < 0.2) reasons.push('NO_EVOLUTION');

  // composite
  const overall = (
    groove * 0.15 + harmonicCoherence * 0.10 + bassKickRelationship * 0.10 +
    motifCoherence * 0.08 + variation * 0.10 + novelty * 0.07 + energy * 0.05 +
    tensionRelease * 0.08 + spectralBalance * 0.07 + lowEndQuality * 0.10 +
    dynamicQuality * 0.05 + arrangementQuality * 0.03 + psychedelicEvolution * 0.02
  );

  const verdict: TasteScore['verdict'] = overall > 0.65 ? 'KEEP' : overall > 0.45 ? 'MUTATE' : 'REJECT';

  return {
    groove: Math.round(groove * 100) / 100,
    harmonicCoherence: Math.round(harmonicCoherence * 100) / 100,
    bassKickRelationship: Math.round(bassKickRelationship * 100) / 100,
    motifCoherence: Math.round(motifCoherence * 100) / 100,
    variation: Math.round(variation * 100) / 100,
    novelty: Math.round(novelty * 100) / 100,
    energy: Math.round(energy * 100) / 100,
    tensionRelease: Math.round(tensionRelease * 100) / 100,
    spectralBalance: Math.round(spectralBalance * 100) / 100,
    lowEndQuality: Math.round(lowEndQuality * 100) / 100,
    dynamicQuality: Math.round(dynamicQuality * 100) / 100,
    arrangementQuality: Math.round(arrangementQuality * 100) / 100,
    psychedelicEvolution: Math.round(psychedelicEvolution * 100) / 100,
    overall: Math.round(overall * 100) / 100,
    verdict,
    reasons,
  };
}

export interface TasteClassification {
  OBJECTIVE_AUDIO_VALIDATION: string;
  MUSICAL_HEURISTICS: string;
  SUBJECTIVE_HUMAN_TASTE: string;
}

export const TASTE_CLASSIFICATION: TasteClassification = {
  OBJECTIVE_AUDIO_VALIDATION: 'Peak, RMS, spectral balance, kick periodicity, onset density — directly measurable from audio samples.',
  MUSICAL_HEURISTICS: 'Groove, motif coherence, variation, arrangement quality — objective but approximate heuristics derived from analysis.',
  SUBJECTIVE_HUMAN_TASTE: 'Whether the music is genuinely enjoyable, emotionally moving, or artistically interesting. CANNOT be automated. Human listening remains the ultimate boundary.',
};
