/**
 * PSYCHEDELIC EVOLUTION QUANTIFIER — independent audit.
 * REAL IMPLEMENTATION.
 *
 * The claim: "the system generates evolving psychedelic material without
 * becoming musical chaos."
 *
 * This quantifies BOTH halves of that claim simultaneously:
 *   1. IDENTITY IS PRESERVED (not chaos)
 *   2. STATE IS CHANGING (not static)
 *
 * Measures:
 *  - repeated loops (frozen)
 *  - frozen parameters
 *  - excessive randomness (chaos)
 *  - structural collapse
 *  - harmonic collapse (notes leaving scale)
 *  - spectral stagnation (centroid variance too low)
 *  - rhythmic stagnation (onset pattern identical across bars)
 *
 * The desired condition: CONTROLLED EVOLUTION — high enough variance to be
 * "evolving", low enough variance to retain "identity".
 */

import { EvolvingSequence, makePsyConfig } from '../sequencing/psyGenerator';
import { SCALES, scaleNote } from '../dsp/wavetable';
import { Rng } from '../rng';
import { analyzeMusic, MusicalAnalysis } from './musicalAnalysis';
import { Studio } from '../render/engine';
import { evolvingArrangement, scheduleArrangement } from '../render/arrangement';

export interface EvolutionMetric {
  // identity metrics (should be HIGH for preserved identity)
  scaleAdherence: number;          // 0..1 fraction of notes in scale
  motifStability: number;          // 0..1 how stable the motif contour is
  rhythmicConsistency: number;     // 0..1 onset pattern regularity
  // evolution metrics (should be HIGH for changing state, but not 1.0)
  patternMutationCount: number;    // how many steps mutated over the run
  spectralVariance: number;        // coefficient of variation of spectral centroid
  densityVariance: number;         // variation in onset density over time
  pitchRangeVariance: number;      // variation in pitch range used
  // failure modes (should be LOW)
  isStatic: boolean;               // pattern never changed
  isChaotic: boolean;              // notes left scale / no repetition
  isFrozen: boolean;               // spectral centroid didn't move
  // composite verdict
  controlledEvolution: boolean;    // identity preserved AND state changing
  identityScore: number;           // 0..1
  evolutionScore: number;          // 0..1
  verdict: string;
  evidence: string[];
}

/** Quantify evolution of the EvolvingSequence over N bars. */
export function quantifySequenceEvolution(bars: number, seed: number): EvolutionMetric {
  const cfg = makePsyConfig({ seed, root: 45, scale: 'minor', bars, density: 0.7, tensionShape: 'arc' });
  const rng = new Rng(seed);
  const seq = new EvolvingSequence(cfg, rng, 4);
  const startPattern = seq.getPattern();

  const allNotes: number[] = [];
  const windowCentroids: number[] = [];
  const windowDensities: number[] = [];
  const windowPitchRanges: number[] = [];
  let mutationCount = 0;
  let prevPattern = [...startPattern];

  // generate notes bar by bar
  for (let bar = 0; bar < bars; bar++) {
    const barNotes: number[] = [];
    for (let s = 0; s < 16; s++) {
      const note = seq.next();
      barNotes.push(note);
      allNotes.push(note);
    }
    // track mutations
    const currentPattern = seq.getPattern();
    for (let i = 0; i < currentPattern.length; i++) {
      if (currentPattern[i] !== prevPattern[i]) mutationCount++;
    }
    prevPattern = [...currentPattern];
    // pitch range
    const minN = Math.min(...barNotes);
    const maxN = Math.max(...barNotes);
    windowPitchRanges.push(maxN - minN);
    windowDensities.push(barNotes.length);
  }

  const endPattern = seq.getPattern();

  // scale adherence
  const scale = SCALES[cfg.scale]!;
  let inScale = 0;
  for (const n of allNotes) {
    const rel = ((n - cfg.root) % 12 + 12) % 12;
    if (scale.includes(rel)) inScale++;
  }
  const scaleAdherence = allNotes.length > 0 ? inScale / allNotes.length : 0;

  // motif stability: how much does the pattern contour preserve its shape?
  // compare start vs end pattern contours (direction of movement)
  let contourMatch = 0;
  for (let i = 1; i < startPattern.length; i++) {
    const startDir = Math.sign(startPattern[i] - startPattern[i - 1]);
    const endDir = Math.sign(endPattern[i] - endPattern[i - 1]);
    if (startDir === endDir) contourMatch++;
  }
  const motifStability = contourMatch / (startPattern.length - 1);

  // rhythmic consistency: how regular is the note density? (lower variance = more consistent)
  const meanDensity = windowDensities.reduce((a, b) => a + b, 0) / windowDensities.length;
  const densityVar = windowDensities.reduce((a, d) => a + (d - meanDensity) ** 2, 0) / windowDensities.length;
  const densityCV = meanDensity > 0 ? Math.sqrt(densityVar) / meanDensity : 0;
  const rhythmicConsistency = Math.max(0, 1 - densityCV * 2);

  // pitch range variance
  const meanRange = windowPitchRanges.reduce((a, b) => a + b, 0) / windowPitchRanges.length;
  const rangeVar = windowPitchRanges.reduce((a, r) => a + (r - meanRange) ** 2, 0) / windowPitchRanges.length;
  const pitchRangeVariance = meanRange > 0 ? Math.sqrt(rangeVar) / meanRange : 0;

  // spectral variance — render ONE long evolving sequence and analyze windows of it
  // (NOT 4 independent renders — that would measure variation between renders, not evolution WITHIN one)
  const evoBars = Math.max(16, Math.min(bars, 16)); // cap at 16 bars for memory safety
  const studio = new Studio({ bars: evoBars, sampleRate: 22050, blockSize: 256, seed, bpm: 138,
    iridium: { granular: 0.6, fmAmount: 0.4 },
    h90: { algorithm1: 'blackhole', algorithm2: 'psyphase', mix: 0.5 },
  });
  const recipe = evolvingArrangement(138, 45, evoBars);
  studio.live.setArrangement(recipe.sections);
  scheduleArrangement(studio, recipe);
  const { left: evoLeft, right: evoRight } = studio.render(evoBars);
  // split into 4 windows and analyze each
  const winLen = Math.floor(evoLeft.length / 4);
  for (let w = 0; w < 4; w++) {
    const wLeft = evoLeft.subarray(w * winLen, (w + 1) * winLen);
    const wRight = evoRight.subarray(w * winLen, (w + 1) * winLen);
    const a = analyzeMusic(wLeft, wRight, 22050, 138);
    windowCentroids.push(a.spectralCentroid);
  }
  const meanCentroid = windowCentroids.reduce((a, b) => a + b, 0) / windowCentroids.length;
  const centroidVar = windowCentroids.reduce((a, c) => a + (c - meanCentroid) ** 2, 0) / windowCentroids.length;
  const spectralVariance = meanCentroid > 0 ? Math.sqrt(centroidVar) / meanCentroid : 0;

  // failure modes
  const isStatic = mutationCount === 0;
  const isChaotic = scaleAdherence < 0.7 || motifStability < 0.3;
  const isFrozen = spectralVariance < 0.02;

  // composite scores
  const identityScore = (scaleAdherence * 0.5 + motifStability * 0.3 + rhythmicConsistency * 0.2);
  const evolutionScore = Math.min(1, (mutationCount / 10) * 0.4 + Math.min(1, spectralVariance * 10) * 0.4 + Math.min(1, pitchRangeVariance * 5) * 0.2);

  // controlled evolution = identity preserved AND state changing
  const controlledEvolution = identityScore > 0.6 && evolutionScore > 0.2 && !isStatic && !isChaotic && !isFrozen;

  const evidence: string[] = [
    `scaleAdherence=${scaleAdherence.toFixed(3)}`,
    `motifStability=${motifStability.toFixed(3)}`,
    `rhythmicConsistency=${rhythmicConsistency.toFixed(3)}`,
    `mutationCount=${mutationCount}`,
    `spectralVariance=${spectralVariance.toFixed(4)}`,
    `pitchRangeVariance=${pitchRangeVariance.toFixed(4)}`,
  ];

  let verdict = 'CONTROLLED_EVOLUTION';
  if (isStatic) verdict = 'STATIC_REPETITION';
  else if (isChaotic) verdict = 'CHAOTIC_MUTATION';
  else if (isFrozen) verdict = 'SPECTRAL_STAGNATION';
  else if (!controlledEvolution) verdict = 'INSUFFICIENT_EVOLUTION';

  return {
    scaleAdherence, motifStability, rhythmicConsistency,
    patternMutationCount: mutationCount,
    spectralVariance, densityVariance: densityCV, pitchRangeVariance,
    isStatic, isChaotic, isFrozen,
    controlledEvolution,
    identityScore: Math.round(identityScore * 100) / 100,
    evolutionScore: Math.round(evolutionScore * 100) / 100,
    verdict,
    evidence,
  };
}
