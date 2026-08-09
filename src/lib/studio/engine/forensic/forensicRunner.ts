/**
 * Forensic Runner — orchestrates the full analysis pipeline.
 *
 * Runs:
 *   1. Render + analyze each world
 *   2. World differentiation test
 *   3. Parameter validation (dead parameter detection)
 *   4. Bass isolation (kick-only, bass-only, kick+bass)
 *   5. Repetition detection
 *   6. Closed-loop optimization
 *   7. Quality score
 *   8. Full forensic report
 *
 * This is the "run everything" function called by the API route.
 */

import { render, downmixToMono, SR } from './offlineRenderer';
import { analyzeAudio } from './audioAnalyzer';
import { detectRepetition } from './repetitionDetector';
import { computeQualityScore } from './qualityScore';
import { differentiateWorlds } from './worldDifferentiator';
import { validateParams } from './paramValidator';
import { runClosedLoop } from './closedLoop';
import { generateReport, type ForensicReport, type LatencyMetrics } from './reportGenerator';
import { FORENSIC_WORLD_IDS, FORENSIC_WORLDS } from './worlds';
import {
  V_KICK, V_BASS, V_LEAD, V_ACID, V_PAD,
  V_HAT, V_CLAP, V_PERC, V_SHAKER, V_TEXTURE,
} from './voices';
import type { AudioAnalysis } from './audioAnalyzer';
import type { RepetitionReport } from './repetitionDetector';

export interface ForensicRunOptions {
  seed?: number;
  duration?: number;
  worlds?: string[];
  skipClosedLoop?: boolean;
  skipParamValidation?: boolean;
  skipBassIsolation?: boolean;
  latencyMetrics?: LatencyMetrics;
}

/**
 * Run the full forensic pipeline.
 */
export async function runForensicAnalysis(options: ForensicRunOptions = {}): Promise<ForensicReport> {
  const seed = options.seed ?? 1234;
  const duration = options.duration ?? 15;
  const worlds = options.worlds ?? ['progressive-psy', 'dark-psy', 'goa', 'acid-psy'];

  // 1. Render + analyze each world
  const worldAnalyses: Record<string, AudioAnalysis> = {};
  const worldRepetitions: Record<string, RepetitionReport> = {};

  for (const wid of worlds) {
    const result = render(seed, wid, duration);
    const analysis = analyzeAudio(result.samplesL, result.samplesR, SR);
    worldAnalyses[wid] = analysis;
    const mono = downmixToMono(result.samplesL, result.samplesR);
    worldRepetitions[wid] = detectRepetition(mono, FORENSIC_WORLDS[wid].bpm, SR);
  }

  // 2. World differentiation
  const worldDiff = differentiateWorlds(seed, duration, worlds);

  // 3. Parameter validation (use the first world, longer duration to reach drops)
  const paramValidation = options.skipParamValidation ? undefined : validateParams(worlds[0], seed, 15);

  // 4. Bass isolation: render kick-only, bass-only, kick+bass
  let bassIsolation: AudioAnalysis | undefined;
  let kickOnly: AudioAnalysis | undefined;
  let kickBassCombined: AudioAnalysis | undefined;
  let repetition: RepetitionReport | undefined;

  if (!options.skipBassIsolation) {
    const bassWorld = worlds[0];
    const bassOnlyRender = render(seed, bassWorld, duration, {
      onlyVoices: [V_BASS],
    });
    bassIsolation = analyzeAudio(bassOnlyRender.samplesL, bassOnlyRender.samplesR, SR);

    const kickOnlyRender = render(seed, bassWorld, duration, {
      onlyVoices: [V_KICK],
    });
    kickOnly = analyzeAudio(kickOnlyRender.samplesL, kickOnlyRender.samplesR, SR);

    const kickBassRender = render(seed, bassWorld, duration, {
      onlyVoices: [V_KICK, V_BASS],
    });
    kickBassCombined = analyzeAudio(kickBassRender.samplesL, kickBassRender.samplesR, SR);

    // Use the full render for repetition detection
    const fullRender = render(seed, bassWorld, duration);
    const fullMono = downmixToMono(fullRender.samplesL, fullRender.samplesR);
    repetition = detectRepetition(fullMono, FORENSIC_WORLDS[bassWorld].bpm, SR);
  } else {
    // Use the first world's repetition
    repetition = worldRepetitions[worlds[0]];
  }

  // 5. Compute quality score (using the first world's analysis + repetition)
  const mainAnalysis = worldAnalyses[worlds[0]];
  const mainRep = repetition ?? worldRepetitions[worlds[0]];

  // World identity score: based on world differentiation
  const avgSpecDist = worldDiff?.averageSpectralDistance ?? 0;
  const worldIdentityScore = worldDiff?.worldSystemFailed
    ? 20
    : Math.min(100, Math.max(0, Math.round(avgSpecDist * 500)));
  const worldIdentityMetrics: Record<string, number | string> = {
    averageSpectralDistance: avgSpecDist.toFixed(4),
    maxSpectralDistance: (worldDiff?.maxSpectralDistance ?? 0).toFixed(4),
    worldSystemFailed: worldDiff?.worldSystemFailed ?? true,
  };
  const worldIdentityExplanation = worldDiff?.summary ?? 'Not computed';

  const qualityScore = computeQualityScore(
    mainAnalysis, mainRep,
    worldIdentityScore, worldIdentityMetrics, worldIdentityExplanation,
  );

  // 6. Closed-loop optimization
  const closedLoop = options.skipClosedLoop ? undefined : runClosedLoop(worlds[0], seed, 12, 6);

  // 7. Generate report
  const report = generateReport({
    latency: options.latencyMetrics,
    worldDiff,
    worldAnalyses,
    paramValidation,
    bassIsolation,
    kickOnly,
    kickBassCombined,
    repetition,
    qualityScore,
    closedLoop,
  });

  return report;
}

export { render, downmixToMono, SR, FORENSIC_WORLDS, FORENSIC_WORLD_IDS };
export type { ForensicReport };
