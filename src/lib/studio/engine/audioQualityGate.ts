/**
 * AUDIO QUALITY GATE — distinguishes technically valid from musically convincing.
 *
 * Evaluates: TECHNICAL, LOW_END, GROOVE, TIMBRE, MIX, STEREO, DYNAMICS,
 * ARRANGEMENT, MUSICALITY, EVOLUTION
 *
 * Returns: PASS / REVIEW / REJECT with explicit reasons.
 *
 * Critical failures (NaN, clipping, dropout) cause immediate REJECT regardless
 * of other scores. Weighted scoring ensures one catastrophic category rejects
 * even if average is high.
 *
 * REAL IMPLEMENTATION.
 */

import { MusicalAnalysis } from '../audit/musicalAnalysis';

export type QualityVerdict = 'PASS' | 'REVIEW' | 'REJECT';

export interface QualityCategoryScore {
  category: string;
  score: number;        // 0..1
  weight: number;       // 0..1
  reasons: string[];
}

export interface QualityGateResult {
  verdict: QualityVerdict;
  overall: number;      // 0..1 weighted
  categories: QualityCategoryScore[];
  failureReasons: string[];
  hardFailures: string[];
}

export interface GateInput {
  analysis: MusicalAnalysis;
  /** Per-section analysis (1s windows) for continuity checking. */
  windowAnalyses?: { rms: number; peak: number; sectionType?: string }[];
  /** Stereo correlation. */
  stereoCorrelation?: number;
  /** Whether this is a breakdown section (silence allowed). */
  isBreakdown?: boolean;
}

/** Run the quality gate on a generated track. */
export function evaluateQuality(input: GateInput): QualityGateResult {
  const { analysis: a } = input;
  const categories: QualityCategoryScore[] = [];
  const hardFailures: string[] = [];

  // === HARD FAILURES (immediate REJECT) ===
  if (!isFinite(a.peak) || !isFinite(a.rms)) hardFailures.push('NaN_DETECTED');
  if (a.peak > 1.0) hardFailures.push('CLIPPING');
  if (a.peak < 0.001) hardFailures.push('SILENCE');
  if (a.isClipped) hardFailures.push('EXCESSIVE_CLIPPING');

  // Check for arrangement dropouts (unintended near-silence)
  if (input.windowAnalyses) {
    for (let i = 0; i < input.windowAnalyses.length; i++) {
      const w = input.windowAnalyses[i];
      if (w.rms < 0.01 && w.sectionType !== 'breakdown' && !input.isBreakdown) {
        hardFailures.push(`ARRANGEMENT_DROPOUT_at_${i}s`);
      }
    }
  }

  // === TECHNICAL (weight 15%) ===
  let techScore = 1;
  const techReasons: string[] = [];
  if (hardFailures.length > 0) techScore = 0;
  if (a.peak < 0.1) { techScore *= 0.5; techReasons.push('LOW_LEVEL'); }
  if (a.peak > 0.999) { techScore *= 0.7; techReasons.push('NEAR_CLIP'); }
  categories.push({ category: 'TECHNICAL', score: techScore, weight: 0.15, reasons: techReasons });

  // === LOW_END (weight 20%) — critical ===
  let lowScore = 0;
  const lowReasons: string[] = [];
  if (a.hasLowFreqContent) lowScore += 0.5;
  else lowReasons.push('NO_LOW_FREQ_CONTENT');
  if (a.kickPeriodicity > 0.5) lowScore += 0.3;
  else lowReasons.push('WEAK_KICK_ANCHOR');
  // bassKickAlignment is lower with sidechain (bass ducks at kick = correct behavior)
  // Only flag if extremely low (< 0.15)
  if (a.bassKickAlignment > 0.15) lowScore += 0.2;
  else lowReasons.push('BASS_KICK_MISALIGNED');
  categories.push({ category: 'LOW_END', score: lowScore, weight: 0.20, reasons: lowReasons });

  // === GROOVE (weight 15%) ===
  let grooveScore = 0;
  const grooveReasons: string[] = [];
  grooveScore = a.kickPeriodicity * 0.5 + a.bassKickAlignment * 0.3 + Math.min(1, a.onsetDensity / 4) * 0.2;
  if (grooveScore < 0.3) grooveReasons.push('WEAK_GROOVE');
  categories.push({ category: 'GROOVE', score: grooveScore, weight: 0.15, reasons: grooveReasons });

  // === TIMBRE (weight 10%) — harshness detection ===
  let timbreScore = 0.7;
  const timbreReasons: string[] = [];
  // Use spectral centroid + high energy ratio (not just ZCR)
  if (a.highEnergy > 0.25) { timbreScore -= 0.3; timbreReasons.push('EXCESSIVE_HIGH_ENERGY'); }
  if (a.spectralCentroid > 5000) { timbreScore -= 0.2; timbreReasons.push('HIGH_SPECTRAL_CENTROID'); }
  if (a.isNoiseLike) { timbreScore = 0.2; timbreReasons.push('NOISE_LIKE'); }
  timbreScore = Math.max(0, Math.min(1, timbreScore));
  categories.push({ category: 'TIMBRE', score: timbreScore, weight: 0.10, reasons: timbreReasons });

  // === MIX (weight 10%) ===
  let mixScore = 0.7;
  const mixReasons: string[] = [];
  const idealLow = 0.33;
  const spectralImbalance = Math.abs(a.lowEnergy - idealLow) + Math.abs(a.midEnergy - idealLow) + Math.abs(a.highEnergy - idealLow);
  if (spectralImbalance > 0.6) { mixScore -= 0.3; mixReasons.push('SPECTRAL_IMBALANCE'); }
  if (a.crestFactor < 3) { mixScore -= 0.2; mixReasons.push('OVERCOMPRESSED'); }
  if (a.crestFactor > 15) { mixScore -= 0.1; mixReasons.push('EXCESSIVE_DYNAMICS'); }
  mixScore = Math.max(0, Math.min(1, mixScore));
  categories.push({ category: 'MIX', score: mixScore, weight: 0.10, reasons: mixReasons });

  // === STEREO (weight 5%) ===
  let stereoScore = 0.6;
  const stereoReasons: string[] = [];
  if (input.stereoCorrelation !== undefined) {
    if (input.stereoCorrelation < 0) { stereoScore -= 0.3; stereoReasons.push('PHASE_CANCELLATION'); }
    if (input.stereoCorrelation > 0.95) { stereoScore -= 0.2; stereoReasons.push('NEAR_MONO'); }
  }
  stereoScore = Math.max(0, Math.min(1, stereoScore));
  categories.push({ category: 'STEREO', score: stereoScore, weight: 0.05, reasons: stereoReasons });

  // === DYNAMICS (weight 10%) ===
  let dynScore = 0.7;
  const dynReasons: string[] = [];
  if (a.dynamicRange < 3) { dynScore -= 0.3; dynReasons.push('FLAT_DYNAMICS'); }
  if (a.dynamicRange > 15) { dynScore -= 0.2; dynReasons.push('EXCESSIVE_RANGE'); }
  dynScore = Math.max(0, Math.min(1, dynScore));
  categories.push({ category: 'DYNAMICS', score: dynScore, weight: 0.10, reasons: dynReasons });

  // === ARRANGEMENT (weight 5%) ===
  let arrScore = 0.5;
  const arrReasons: string[] = [];
  if (a.sectionCount >= 3) arrScore += 0.3;
  else arrReasons.push('TOO_FEW_SECTIONS');
  if (a.sectionTransitions.length >= 2) arrScore += 0.2;
  else arrReasons.push('TOO_FEW_TRANSITIONS');
  if (a.silenceRatio > 0.3) { arrScore -= 0.3; arrReasons.push('EXCESSIVE_SILENCE'); }
  arrScore = Math.max(0, Math.min(1, arrScore));
  categories.push({ category: 'ARRANGEMENT', score: arrScore, weight: 0.05, reasons: arrReasons });

  // === MUSICALITY (weight 5%) — motif/repetition ===
  let musScore = 0.6;
  const musReasons: string[] = [];
  if (a.repetitionRate > 0.3) musScore += 0.2;
  else musReasons.push('NO_REPETITION');
  if (a.repetitionRate > 0.9) { musScore -= 0.2; musReasons.push('EXCESSIVE_REPETITION'); }
  musScore = Math.max(0, Math.min(1, musScore));
  categories.push({ category: 'MUSICALITY', score: musScore, weight: 0.05, reasons: musReasons });

  // === EVOLUTION (weight 5%) ===
  let evoScore = 0.5;
  const evoReasons: string[] = [];
  // evolution is hard to measure without window analyses; use section count + repetition
  if (a.sectionCount >= 3) evoScore += 0.3;
  if (a.repetitionRate < 0.9) evoScore += 0.2;
  evoScore = Math.max(0, Math.min(1, evoScore));
  categories.push({ category: 'EVOLUTION', score: evoScore, weight: 0.05, reasons: evoReasons });

  // === OVERALL (weighted, with critical failure override) ===
  let overall = 0;
  for (const c of categories) overall += c.score * c.weight;

  // Critical failure: if any category scores < 0.2, reject regardless of average
  const catastrophic = categories.filter(c => c.score < 0.2 && c.weight >= 0.10);

  const allReasons = categories.flatMap(c => c.reasons);

  let verdict: QualityVerdict;
  if (hardFailures.length > 0 || catastrophic.length > 0) {
    verdict = 'REJECT';
  } else if (overall > 0.65) {
    verdict = 'PASS';
  } else {
    verdict = 'REVIEW';
  }

  return {
    verdict,
    overall: Math.round(overall * 100) / 100,
    categories,
    failureReasons: allReasons,
    hardFailures,
  };
}
