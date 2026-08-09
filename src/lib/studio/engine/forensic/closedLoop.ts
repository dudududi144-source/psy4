/**
 * Closed-Loop Optimizer — iterative parameter optimization.
 *
 * Flow:
 *   GENERATE (seed, world, params)
 *   → RENDER (offline, deterministic)
 *   → ANALYZE (metrics)
 *   → DIAGNOSE (find weakest score area)
 *   → MODIFY (adjust the parameter that affects the weak area)
 *   → RENDER AGAIN
 *   → COMPARE (score vs previous)
 *   → ACCEPT (if better) / REJECT (if worse)
 *
 * Every change is ATTRIBUTABLE. No random tweaking.
 */

import { render, downmixToMono, SR } from './offlineRenderer';
import { analyzeAudio } from './audioAnalyzer';
import { detectRepetition } from './repetitionDetector';
import { computeQualityScore } from './qualityScore';
import { FORENSIC_WORLDS, type Psy4World } from './worlds';
import type { QualityScore, SubScore } from './qualityScore';
import type { AudioAnalysis } from './audioAnalyzer';
import type { RepetitionReport } from './repetitionDetector';

export interface OptimizationIteration {
  iteration: number;
  paramName: string;
  oldValue: number;
  newValue: number;
  oldScore: number;
  newScore: number;
  accepted: boolean;
  reason: string;
  weakestArea: string;
  weakestScore: number;
}

export interface ClosedLoopResult {
  worldId: string;
  seed: number;
  iterations: OptimizationIteration[];
  initialScore: number;
  finalScore: number;
  bestParams: Partial<Psy4World>;
  scoreHistory: number[];
  summary: string;
}

/**
 * Parameter adjustment rules.
 * Each rule maps a weak score area to a parameter adjustment.
 */
interface AdjustmentRule {
  scoreArea: string;
  paramName: keyof Psy4World;
  direction: 'increase' | 'decrease';
  amount: number;
  reason: string;
}

const ADJUSTMENT_RULES: AdjustmentRule[] = [
  // BASS rules
  { scoreArea: 'BASS', paramName: 'bassCutoff', direction: 'decrease', amount: 50, reason: 'bass too bright — lower cutoff for more low-end weight' },
  { scoreArea: 'BASS', paramName: 'kickDecay', direction: 'increase', amount: 0.02, reason: 'bass decay too short — lengthen kick decay for more low-end body' },
  // KICK rules
  { scoreArea: 'KICK', paramName: 'kickFundamental', direction: 'decrease', amount: 3, reason: 'kick too high — lower fundamental for more punch' },
  { scoreArea: 'KICK', paramName: 'kickDecay', direction: 'decrease', amount: 0.02, reason: 'kick decay too long — shorten for punchier transient' },
  // LOW END rules
  { scoreArea: 'LOW END', paramName: 'kickFundamental', direction: 'decrease', amount: 2, reason: 'low-end overlap — lower kick fundamental to separate from bass' },
  { scoreArea: 'LOW END', paramName: 'bassCutoff', direction: 'decrease', amount: 30, reason: 'low-end overlap — lower bass cutoff to reduce kick/bass conflict' },
  // TRANSIENTS rules
  { scoreArea: 'TRANSIENTS', paramName: 'kickDecay', direction: 'decrease', amount: 0.01, reason: 'transients weak — shorten kick decay for sharper attack' },
  // SPECTRUM rules
  { scoreArea: 'SPECTRUM', paramName: 'leadCutoff', direction: 'increase', amount: 200, reason: 'spectrum too dark — raise lead cutoff for more high-end' },
  { scoreArea: 'SPECTRUM', paramName: 'padCutoff', direction: 'increase', amount: 100, reason: 'spectrum too narrow — raise pad cutoff for more air' },
  // DYNAMICS rules
  { scoreArea: 'DYNAMICS', paramName: 'duck', direction: 'increase', amount: 0.05, reason: 'dynamics too flat — increase sidechain duck for more groove' },
];

/**
 * Find the weakest score area (excluding WORLD IDENTITY which is computed separately).
 */
function findWeakestArea(score: QualityScore): { area: string; value: number; sub: SubScore } {
  const candidates: { area: string; value: number; sub: SubScore }[] = [
    { area: 'LOW END', value: score.lowEnd.score, sub: score.lowEnd },
    { area: 'KICK', value: score.kick.score, sub: score.kick },
    { area: 'BASS', value: score.bass.score, sub: score.bass },
    { area: 'TRANSIENTS', value: score.transients.score, sub: score.transients },
    { area: 'SPECTRUM', value: score.spectrum.score, sub: score.spectrum },
    { area: 'DYNAMICS', value: score.dynamics.score, sub: score.dynamics },
    { area: 'REPETITION', value: score.repetition.score, sub: score.repetition },
  ];
  candidates.sort((a, b) => a.value - b.value);
  return candidates[0];
}

/**
 * Apply an adjustment to a parameter.
 */
function applyAdjustment(
  params: Partial<Psy4World>,
  rule: AdjustmentRule,
): { params: Partial<Psy4World>; oldValue: number; newValue: number } {
  const baseWorld = FORENSIC_WORLDS['dark-psy']; // use dark-psy as reference for ranges
  const oldValue = (params[rule.paramName] as number) ?? (baseWorld[rule.paramName] as number);
  let newValue: number;
  if (rule.direction === 'increase') {
    newValue = oldValue + rule.amount;
  } else {
    newValue = oldValue - rule.amount;
  }
  // Clamp to reasonable ranges
  const ranges: Record<string, [number, number]> = {
    kickFundamental: [38, 65],
    kickDecay: [0.08, 0.35],
    bassCutoff: [150, 900],
    bassResonance: [1, 18],
    leadCutoff: [800, 6000],
    leadDetune: [3, 30],
    padCutoff: [400, 3000],
    duck: [0.15, 0.75],
  };
  const range = ranges[rule.paramName];
  if (range) {
    newValue = Math.max(range[0], Math.min(range[1], newValue));
  }
  return {
    params: { ...params, [rule.paramName]: newValue },
    oldValue,
    newValue,
  };
}

/**
 * Run the closed-loop optimization.
 */
export function runClosedLoop(
  worldId: string,
  seed: number = 1234,
  duration: number = 15,
  maxIterations: number = 8,
): ClosedLoopResult {
  const baseWorld = FORENSIC_WORLDS[worldId];
  let currentParams: Partial<Psy4World> = {};
  const iterations: OptimizationIteration[] = [];
  const scoreHistory: number[] = [];

  // Initial render + score
  const initialRender = render(seed, worldId, duration, { paramOverrides: currentParams });
  const initialMono = downmixToMono(initialRender.samplesL, initialRender.samplesR);
  const initialAnalysis = analyzeAudio(initialRender.samplesL, initialRender.samplesR, SR);
  const initialRep = detectRepetition(initialMono, baseWorld.bpm, SR);
  const initialScore = computeQualityScore(initialAnalysis, initialRep);
  const initialTotal = initialScore.total;
  scoreHistory.push(initialTotal);

  let bestScore = initialTotal;
  let bestParams = { ...currentParams };

  // Track tried rules to avoid repeating rejected adjustments
  const triedRules = new Set<string>();

  // Pick rules in rotation, focusing on the weakest area each iteration
  for (let iter = 1; iter <= maxIterations; iter++) {
    // Re-render with current best params to find weakest area
    const currentRender = render(seed, worldId, duration, { paramOverrides: currentParams });
    const currentMono = downmixToMono(currentRender.samplesL, currentRender.samplesR);
    const currentAnalysis = analyzeAudio(currentRender.samplesL, currentRender.samplesR, SR);
    const currentRep = detectRepetition(currentMono, baseWorld.bpm, SR);
    const currentScore = computeQualityScore(currentAnalysis, currentRep);
    const oldScore = currentScore.total;

    // Find weakest area
    const weakest = findWeakestArea(currentScore);

    // Find a rule for this area that hasn't been tried yet
    // Try both directions if needed
    let rule: AdjustmentRule | undefined;
    const candidates = ADJUSTMENT_RULES.filter(r => r.scoreArea === weakest.area);
    for (const r of candidates) {
      const key = `${r.paramName}-${r.direction}`;
      if (!triedRules.has(key)) {
        rule = r;
        break;
      }
    }
    // If all rules for the weakest area are tried, find any untried rule
    if (!rule) {
      for (const r of ADJUSTMENT_RULES) {
        const key = `${r.paramName}-${r.direction}`;
        if (!triedRules.has(key)) {
          rule = r;
          break;
        }
      }
    }
    // If everything tried, try the opposite direction of existing rules
    if (!rule && candidates.length > 0) {
      for (const r of candidates) {
        const oppositeDir = r.direction === 'increase' ? 'decrease' : 'increase';
        const key = `${r.paramName}-${oppositeDir}`;
        if (!triedRules.has(key)) {
          rule = { ...r, direction: oppositeDir };
          break;
        }
      }
    }

    if (!rule) {
      iterations.push({
        iteration: iter,
        paramName: 'none',
        oldValue: 0,
        newValue: 0,
        oldScore,
        newScore: oldScore,
        accepted: false,
        reason: `all adjustment rules exhausted`,
        weakestArea: weakest.area,
        weakestScore: weakest.value,
      });
      break;
    }

    // Mark this rule as tried
    triedRules.add(`${rule.paramName}-${rule.direction}`);

    // Apply adjustment
    const adjustment = applyAdjustment(currentParams, rule);
    const newParams = adjustment.params;

    // Render with new params
    const newRender = render(seed, worldId, duration, { paramOverrides: newParams });
    const newMono = downmixToMono(newRender.samplesL, newRender.samplesR);
    const newAnalysis = analyzeAudio(newRender.samplesL, newRender.samplesR, SR);
    const newRep = detectRepetition(newMono, baseWorld.bpm, SR);
    const newScore = computeQualityScore(newAnalysis, newRep);
    const newTotal = newScore.total;

    // Accept or reject
    const accepted = newTotal > oldScore;
    if (accepted) {
      currentParams = newParams;
      if (newTotal > bestScore) {
        bestScore = newTotal;
        bestParams = { ...newParams };
      }
      // Reset tried rules on success — maybe the same rule helps again
      triedRules.clear();
    }
    scoreHistory.push(newTotal);

    iterations.push({
      iteration: iter,
      paramName: rule.paramName as string,
      oldValue: adjustment.oldValue,
      newValue: adjustment.newValue,
      oldScore,
      newScore: newTotal,
      accepted,
      reason: rule.reason,
      weakestArea: weakest.area,
      weakestScore: weakest.value,
    });
  }

  let summary: string;
  if (bestScore > initialTotal) {
    summary = `IMPROVED: ${initialTotal} → ${bestScore} (+${bestScore - initialTotal} points)`;
  } else {
    summary = `NO IMPROVEMENT: stayed at ${initialTotal} (best was ${bestScore})`;
  }

  return {
    worldId,
    seed,
    iterations,
    initialScore: initialTotal,
    finalScore: bestScore,
    bestParams,
    scoreHistory,
    summary,
  };
}
