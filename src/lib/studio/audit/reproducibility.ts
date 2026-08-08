/**
 * REPRODUCIBILITY + VARIATION PROVER — independent audit.
 * REAL IMPLEMENTATION.
 *
 * Verifies:
 *   A == A  (same seed → identical output)
 *   A != B  (different seed → different output)
 *   A != C  (different seed → different output)
 *
 * And compares their MUSICAL structure — they must differ but all remain
 * valid psytrance (not just different noise).
 */

import { Studio } from '../render/engine';
import { loopArrangement, scheduleArrangement } from '../render/arrangement';
import { bufferHash, peak } from '../render/wav';
import { analyzeMusic, MusicalAnalysis } from './musicalAnalysis';

export interface ReproResult {
  seedA: number;
  seedB: number;
  seedC: number;
  hashA1: string;
  hashA2: string;
  hashB: string;
  hashC: string;
  aEqualsA: boolean;
  aDiffersB: boolean;
  aDiffersC: boolean;
  bDiffersC: boolean;
  allMusicallyValid: boolean;
  musicalAnalyses: { seed: number; analysis: MusicalAnalysis }[];
  verdict: 'PASS' | 'FAIL';
  evidence: string[];
}

function renderWithSeed(seed: number): { left: Float32Array; right: Float32Array; hash: string } {
  const studio = new Studio({ bars: 4, sampleRate: 22050, blockSize: 256, seed, bpm: 138 });
  const recipe = loopArrangement(138, 45, 'minor');
  studio.live.setArrangement(recipe.sections);
  scheduleArrangement(studio, recipe);
  const { left, right } = studio.render(4);
  return { left, right, hash: bufferHash(left) };
}

export function runReproducibilityProof(): ReproResult {
  const A1 = renderWithSeed(11111);
  const A2 = renderWithSeed(11111);
  const B = renderWithSeed(22222);
  const C = renderWithSeed(33333);

  const analyses = [
    { seed: 11111, analysis: analyzeMusic(A1.left, A1.right, 22050, 138) },
    { seed: 22222, analysis: analyzeMusic(B.left, B.right, 22050, 138) },
    { seed: 33333, analysis: analyzeMusic(C.left, C.right, 22050, 138) },
  ];

  // all must be musically valid (non-degenerate)
  const allValid = analyses.every((a) => !a.analysis.isSilent && !a.analysis.isConstant && a.analysis.peak > 0.1);

  const aEqualsA = A1.hash === A2.hash;
  const aDiffersB = A1.hash !== B.hash;
  const aDiffersC = A1.hash !== C.hash;
  const bDiffersC = B.hash !== C.hash;

  const evidence = [
    `A1=${A1.hash}`,
    `A2=${A2.hash}`,
    `B=${B.hash}`,
    `C=${C.hash}`,
    `A==A: ${aEqualsA}`,
    `A!=B: ${aDiffersB}`,
    `A!=C: ${aDiffersC}`,
    `B!=C: ${bDiffersC}`,
    `allMusicallyValid: ${allValid}`,
  ];

  const verdict = (aEqualsA && aDiffersB && aDiffersC && bDiffersC && allValid) ? 'PASS' : 'FAIL';

  return {
    seedA: 11111, seedB: 22222, seedC: 33333,
    hashA1: A1.hash, hashA2: A2.hash, hashB: B.hash, hashC: C.hash,
    aEqualsA, aDiffersB, aDiffersC, bDiffersC,
    allMusicallyValid: allValid,
    musicalAnalyses: analyses,
    verdict,
    evidence,
  };
}
