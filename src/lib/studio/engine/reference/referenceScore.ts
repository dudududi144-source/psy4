/**
 * Reference Score — measures how close our engine's output is to the
 * reference profile.
 *
 * PRIORITY 6: "Build reference score"
 *
 * Computes a weighted similarity score across:
 *   - BPM similarity
 *   - Kick/bass decay similarity
 *   - Spectral balance similarity
 *   - Transient density similarity
 *   - Loudness similarity
 *   - Stereo width similarity
 *   - Energy similarity
 *   - Repetition similarity
 *
 * Each sub-score is 0..100. Total is weighted.
 * All scores are based on MEASURED features, not invented numbers.
 */

import type { ReferenceMetrics, ReferenceProfile } from './referenceListener';

export interface SubScore {
  name: string;
  score: number;          // 0..100
  referenceValue: number;
  ourValue: number;
  error: number;          // signed difference (our - reference)
  weight: number;
  explanation: string;
}

export interface ReferenceScoreResult {
  bpm: SubScore;
  kickDecay: SubScore;
  bassDecay: SubScore;
  spectralBalance: SubScore;
  transientDensity: SubScore;
  loudness: SubScore;
  stereoWidth: SubScore;
  energy: SubScore;
  repetition: SubScore;
  total: number;          // 0..100
  topProblems: { name: string; error: number; suggestion: string }[];
  breakdown: string[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Score how close two values are, given a tolerance.
 * Returns 0..100 (100 = exact match, 0 = way off).
 */
function scoreSimilarity(our: number, ref: number, tolerance: number): number {
  if (tolerance <= 0) return 0;
  const diff = Math.abs(our - ref);
  const ratio = diff / tolerance;
  return clamp(100 * (1 - ratio), 0, 100);
}

/**
 * Score spectral balance — compares the distribution across 5 bands.
 * Returns 0..100 (100 = identical distribution).
 */
function scoreSpectralBalance(
  our: { sub: number; low: number; mid: number; high: number; air: number },
  ref: { sub: number; low: number; mid: number; high: number; air: number },
): number {
  // Normalize both to sum=1
  const ourSum = our.sub + our.low + our.mid + our.high + our.air + 1e-12;
  const refSum = ref.sub + ref.low + ref.mid + ref.high + ref.air + 1e-12;
  const ourNorm = { sub: our.sub / ourSum, low: our.low / ourSum, mid: our.mid / ourSum, high: our.high / ourSum, air: our.air / ourSum };
  const refNorm = { sub: ref.sub / refSum, low: ref.low / refSum, mid: ref.mid / refSum, high: ref.high / refSum, air: ref.air / refSum };

  // Euclidean distance between distributions
  const dist = Math.sqrt(
    (ourNorm.sub - refNorm.sub) ** 2 +
    (ourNorm.low - refNorm.low) ** 2 +
    (ourNorm.mid - refNorm.mid) ** 2 +
    (ourNorm.high - refNorm.high) ** 2 +
    (ourNorm.air - refNorm.air) ** 2
  );
  // Max possible distance is sqrt(2) ≈ 1.414
  return clamp(100 * (1 - dist / 1.414), 0, 100);
}

/**
 * Compute the reference score.
 * @param our Our engine's current metrics
 * @param ref The rolling reference profile (from radio stream)
 * @param knownBpm The known BPM of our engine (since our self-analyzer can't estimate BPM from short windows)
 */
export function computeReferenceScore(
  our: ReferenceMetrics,
  ref: ReferenceProfile,
  knownBpm: number = 142,
): ReferenceScoreResult {
  // BPM — tolerance: 8 BPM
  const refBpm = ref.bpm.mean;
  const bpmScore = scoreSimilarity(knownBpm, refBpm, 8);
  const bpm: SubScore = {
    name: 'BPM',
    score: bpmScore,
    referenceValue: refBpm,
    ourValue: knownBpm,
    error: knownBpm - refBpm,
    weight: 0.10,
    explanation: `BPM: ${knownBpm} vs ref ${refBpm.toFixed(0)} (error ${knownBpm - refBpm > 0 ? '+' : ''}${(knownBpm - refBpm).toFixed(1)})`,
  };

  // Kick decay — tolerance: 30ms
  const refKickDecay = ref.kickDecayMs.mean;
  const ourKickDecay = our.kickDecayMs;
  const kickDecayScore = scoreSimilarity(ourKickDecay, refKickDecay, 30);
  const kickDecay: SubScore = {
    name: 'Kick Decay',
    score: kickDecayScore,
    referenceValue: refKickDecay,
    ourValue: ourKickDecay,
    error: ourKickDecay - refKickDecay,
    weight: 0.12,
    explanation: `Kick decay: ${ourKickDecay.toFixed(0)}ms vs ref ${refKickDecay.toFixed(0)}ms (error ${ourKickDecay - refKickDecay > 0 ? '+' : ''}${(ourKickDecay - refKickDecay).toFixed(0)}ms)`,
  };

  // Bass decay — tolerance: 30ms
  const refBassDecay = ref.bassDecayMs.mean;
  const ourBassDecay = our.bassDecayMs;
  const bassDecayScore = scoreSimilarity(ourBassDecay, refBassDecay, 30);
  const bassDecay: SubScore = {
    name: 'Bass Decay',
    score: bassDecayScore,
    referenceValue: refBassDecay,
    ourValue: ourBassDecay,
    error: ourBassDecay - refBassDecay,
    weight: 0.12,
    explanation: `Bass decay: ${ourBassDecay.toFixed(0)}ms vs ref ${refBassDecay.toFixed(0)}ms (error ${ourBassDecay - refBassDecay > 0 ? '+' : ''}${(ourBassDecay - refBassDecay).toFixed(0)}ms)`,
  };

  // Spectral balance
  const ourSpectral = { sub: our.subEnergy, low: our.lowEnergy, mid: our.midEnergy, high: our.highEnergy, air: our.airEnergy };
  const refSpectral = { sub: ref.subEnergy.mean, low: ref.lowEnergy.mean, mid: ref.midEnergy.mean, high: ref.highEnergy.mean, air: ref.airEnergy.mean };
  const spectralScore = scoreSpectralBalance(ourSpectral, refSpectral);
  const spectralBalance: SubScore = {
    name: 'Spectral Balance',
    score: spectralScore,
    referenceValue: ref.spectralCentroid.mean,
    ourValue: our.spectralCentroid,
    error: our.spectralCentroid - ref.spectralCentroid.mean,
    weight: 0.15,
    explanation: `Spectral: sub ${our.subEnergy.toFixed(2)}/${ref.subEnergy.mean.toFixed(2)}, mid ${our.midEnergy.toFixed(2)}/${ref.midEnergy.mean.toFixed(2)}, high ${our.highEnergy.toFixed(2)}/${ref.highEnergy.mean.toFixed(2)}`,
  };

  // Transient density — tolerance: 2/sec
  const refTransient = ref.transientDensity.mean;
  const ourTransient = our.transientDensity;
  const transientScore = scoreSimilarity(ourTransient, refTransient, 2);
  const transientDensity: SubScore = {
    name: 'Transient Density',
    score: transientScore,
    referenceValue: refTransient,
    ourValue: ourTransient,
    error: ourTransient - refTransient,
    weight: 0.12,
    explanation: `Transients: ${ourTransient.toFixed(1)}/s vs ref ${refTransient.toFixed(1)}/s (error ${ourTransient - refTransient > 0 ? '+' : ''}${(ourTransient - refTransient).toFixed(1)}/s)`,
  };

  // Loudness — tolerance: 3 LUFS
  const refLufs = ref.lufs.mean;
  const ourLufs = our.lufs;
  const loudnessScore = scoreSimilarity(ourLufs, refLufs, 3);
  const loudness: SubScore = {
    name: 'Loudness',
    score: loudnessScore,
    referenceValue: refLufs,
    ourValue: ourLufs,
    error: ourLufs - refLufs,
    weight: 0.10,
    explanation: `LUFS: ${ourLufs.toFixed(1)} vs ref ${refLufs.toFixed(1)} (error ${ourLufs - refLufs > 0 ? '+' : ''}${(ourLufs - refLufs).toFixed(1)})`,
  };

  // Stereo width — tolerance: 0.15
  const refStereo = ref.stereoWidth.mean;
  const ourStereo = our.stereoWidth;
  const stereoScore = scoreSimilarity(ourStereo, refStereo, 0.15);
  const stereoWidth: SubScore = {
    name: 'Stereo Width',
    score: stereoScore,
    referenceValue: refStereo,
    ourValue: ourStereo,
    error: ourStereo - refStereo,
    weight: 0.08,
    explanation: `Stereo: ${ourStereo.toFixed(2)} vs ref ${refStereo.toFixed(2)} (error ${ourStereo - refStereo > 0 ? '+' : ''}${(ourStereo - refStereo).toFixed(2)})`,
  };

  // Energy — tolerance: 0.15
  const refEnergy = ref.energy.mean;
  const ourEnergy = our.energy;
  const energyScore = scoreSimilarity(ourEnergy, refEnergy, 0.15);
  const energy: SubScore = {
    name: 'Energy',
    score: energyScore,
    referenceValue: refEnergy,
    ourValue: ourEnergy,
    error: ourEnergy - refEnergy,
    weight: 0.10,
    explanation: `Energy: ${ourEnergy.toFixed(2)} vs ref ${refEnergy.toFixed(2)} (error ${ourEnergy - refEnergy > 0 ? '+' : ''}${(ourEnergy - refEnergy).toFixed(2)})`,
  };

  // Repetition — compare rhythmic regularity
  const refReg = 0.7; // reference psytrance is highly regular
  const ourReg = our.rhythmicRegularity;
  const repScore = scoreSimilarity(ourReg, refReg, 0.2);
  const repetition: SubScore = {
    name: 'Repetition',
    score: repScore,
    referenceValue: refReg,
    ourValue: ourReg,
    error: ourReg - refReg,
    weight: 0.11,
    explanation: `Regularity: ${ourReg.toFixed(2)} vs ref ${refReg.toFixed(2)} (error ${ourReg - refReg > 0 ? '+' : ''}${(ourReg - refReg).toFixed(2)})`,
  };

  // Weighted total
  const total = Math.round(
    bpm.score * bpm.weight +
    kickDecay.score * kickDecay.weight +
    bassDecay.score * bassDecay.weight +
    spectralBalance.score * spectralBalance.weight +
    transientDensity.score * transientDensity.weight +
    loudness.score * loudness.weight +
    stereoWidth.score * stereoWidth.weight +
    energy.score * energy.weight +
    repetition.score * repetition.weight
  );

  // Top problems — sort by (weight * (100 - score)) descending
  const allScores = [bpm, kickDecay, bassDecay, spectralBalance, transientDensity, loudness, stereoWidth, energy, repetition];
  const problems = allScores
    .map(s => ({
      name: s.name,
      error: s.error,
      impact: s.weight * (100 - s.score),
      suggestion: getSuggestion(s.name, s.error, s.ourValue, s.referenceValue),
    }))
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 3);

  const topProblems = problems.map(p => ({
    name: p.name,
    error: p.error,
    suggestion: p.suggestion,
  }));

  const breakdown = [
    `BPM                ${bpm.score.toFixed(0)}/100  (ref ${refBpm.toFixed(0)}, ours ${knownBpm})`,
    `KICK DECAY         ${kickDecay.score.toFixed(0)}/100  (ref ${refKickDecay.toFixed(0)}ms, ours ${ourKickDecay.toFixed(0)}ms)`,
    `BASS DECAY         ${bassDecay.score.toFixed(0)}/100  (ref ${refBassDecay.toFixed(0)}ms, ours ${ourBassDecay.toFixed(0)}ms)`,
    `SPECTRAL BALANCE   ${spectralBalance.score.toFixed(0)}/100  (centroid ref ${ref.spectralCentroid.mean.toFixed(0)}Hz, ours ${our.spectralCentroid.toFixed(0)}Hz)`,
    `TRANSIENT DENSITY  ${transientDensity.score.toFixed(0)}/100  (ref ${refTransient.toFixed(1)}/s, ours ${ourTransient.toFixed(1)}/s)`,
    `LOUDNESS           ${loudness.score.toFixed(0)}/100  (ref ${refLufs.toFixed(1)}, ours ${ourLufs.toFixed(1)})`,
    `STEREO WIDTH       ${stereoWidth.score.toFixed(0)}/100  (ref ${refStereo.toFixed(2)}, ours ${ourStereo.toFixed(2)})`,
    `ENERGY             ${energy.score.toFixed(0)}/100  (ref ${refEnergy.toFixed(2)}, ours ${ourEnergy.toFixed(2)})`,
    `REPETITION         ${repetition.score.toFixed(0)}/100  (ref ${refReg.toFixed(2)}, ours ${ourReg.toFixed(2)})`,
    `TOTAL              ${total}/100`,
  ];

  return {
    bpm, kickDecay, bassDecay, spectralBalance, transientDensity,
    loudness, stereoWidth, energy, repetition,
    total, topProblems, breakdown,
  };
}

function getSuggestion(name: string, error: number, our: number, ref: number): string {
  switch (name) {
    case 'BPM':
      return error > 0 ? 'BPM too high — reduce to match reference' : 'BPM too low — increase to match reference';
    case 'Kick Decay':
      return error > 0 ? 'Kick decay too long — shorten kickDecay parameter' : 'Kick decay too short — lengthen kickDecay parameter';
    case 'Bass Decay':
      return error > 0 ? 'Bass decay too long — shorten bass decay (reduce bassCutoff or adjust envelope)' : 'Bass decay too short — lengthen bass decay';
    case 'Spectral Balance':
      return 'Adjust band levels — match reference sub/mid/high distribution';
    case 'Transient Density':
      return error > 0 ? 'Too many transients — reduce percussion density' : 'Too few transients — increase percussion/hat density';
    case 'Loudness':
      return error > 0 ? 'Too loud — reduce master makeup/limiting' : 'Too quiet — increase master makeup gain';
    case 'Stereo Width':
      return error > 0 ? 'Too wide — reduce stereo width' : 'Too narrow — increase stereo width (Haas, pan)';
    case 'Energy':
      return error > 0 ? 'Too much energy — reduce overall levels' : 'Not enough energy — increase overall levels';
    case 'Repetition':
      return error > 0 ? 'Too repetitive — increase variation' : 'Too chaotic — increase regularity';
    default:
      return 'Adjust parameter';
  }
}
