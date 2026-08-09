/**
 * POST /api/reference/train
 *
 * Runs a training iteration using the OFFLINE renderer (deterministic).
 *
 * This is the server-side training loop that:
 *   1. Renders with current params (deterministic)
 *   2. Analyzes the render
 *   3. Compares to the provided reference profile
 *   4. Proposes 1-3 parameter changes
 *   5. Renders with new params
 *   6. Compares scores
 *   7. Accepts or rejects
 *
 * The reference profile is provided by the client (captured from the live
 * radio stream via ReferenceListener).
 *
 * Body: {
 *   worldId: string,
 *   seed: number,
 *   duration: number,
 *   currentParams: Record<string, number>,
 *   referenceProfile: ReferenceProfile,
 *   maxIterations: number,
 *   maxChangesPerIteration: number,
 * }
 *
 * Returns: {
 *   ok: boolean,
 *   iterations: TrainingIteration[],
 *   finalScore: number,
 *   bestParams: Record<string, number>,
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { render, downmixToMono, SR } from '@/lib/studio/engine/forensic/offlineRenderer';
import { analyzeAudio } from '@/lib/studio/engine/forensic/audioAnalyzer';
import { computeReferenceScore } from '@/lib/studio/engine/reference/referenceScore';
import {
  createParameterRegistry, adjustParameter, applyChanges, registryToOverrides,
  type ParameterChange,
} from '@/lib/studio/engine/reference/parameterRegistry';
import { getWorldDNA } from '@/lib/studio/engine/reference/worldDNA';
import type { ReferenceProfile } from '@/lib/studio/engine/reference/referenceListener';
import type { ReferenceMetrics } from '@/lib/studio/engine/reference/referenceListener';
import { FORENSIC_WORLDS } from '@/lib/studio/engine/forensic/worlds';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Convert forensic AudioAnalysis → ReferenceMetrics (for comparison)
function analysisToReferenceMetrics(analysis: ReturnType<typeof analyzeAudio>, worldId: string): ReferenceMetrics {
  const sp = analysis.spectrum;
  const d = analysis.dynamics;
  const le = analysis.lowEnd;
  const tr = analysis.transients;

  return {
    bpm: FORENSIC_WORLDS[worldId]?.bpm || 142,
    bpmConfidence: 0.9,
    rms: d.rms,
    peak: d.peak,
    lufs: d.lufs,
    crestFactor: d.crest,
    subEnergy: le.subRms,
    lowEnergy: le.kickRms + le.bassRms,
    midEnergy: sp.bands.find(b => b.name === '500-2k')?.energy || 0,
    highEnergy: sp.bands.find(b => b.name === '2k-8k')?.energy || 0,
    airEnergy: sp.bands.find(b => b.name === '8k-20k')?.energy || 0,
    spectralCentroid: sp.centroidHz,
    spectralFlatness: sp.flatness,
    spectralRolloff: sp.rolloff,
    transientDensity: tr.count / (analysis.duration || 1),
    kickDensity: tr.count / (analysis.duration || 1) * 0.3,
    hatDensity: tr.count / (analysis.duration || 1) * 0.4,
    percussionDensity: tr.count / (analysis.duration || 1),
    stereoWidth: 0.35,
    kickDecayMs: le.kickDecay * 1000,
    bassDecayMs: le.bassDecay * 1000,
    rhythmicRegularity: tr.consistency,
    repetitionScore: 0.5,
    energy: Math.min(1, d.rms * 3),
    overallConfidence: 0.8,
    timestamp: Date.now(),
    sourceStream: 'self',
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      worldId = 'dark-psy',
      seed = 1234,
      duration = 12,
      currentParams = {},
      referenceProfile,
      maxIterations = 6,
      maxChangesPerIteration = 2,
    } = body;

    const dna = getWorldDNA(worldId);
    if (!dna) {
      return NextResponse.json(
        { ok: false, error: `Unknown world: ${worldId}` },
        { status: 400 },
      );
    }

    if (!referenceProfile) {
      return NextResponse.json(
        { ok: false, error: 'referenceProfile is required' },
        { status: 400 },
      );
    }

    // Create parameter registry starting from current params
    const defaults = {
      kickDecay: dna.kickDecayTarget,
      kickFundamental: dna.kickFundamentalTarget,
      bassCutoff: dna.bassCutoffTarget,
      bassResonance: dna.bassResonanceTarget,
      leadCutoff: dna.leadCutoffTarget,
      leadDetune: dna.leadDetuneTarget,
      padCutoff: 1200,
      duck: 0.4,
      ...currentParams,
    };
    let registry = createParameterRegistry(defaults);

    const iterations = [];
    let bestScore = 0;
    let bestParams = registryToOverrides(registry);

    // Initial render + score
    const initialRender = render(seed, worldId, duration, {
      paramOverrides: registryToOverrides(registry),
    });
    const initialAnalysis = analyzeAudio(initialRender.samplesL, initialRender.samplesR, SR);
    const initialMetrics = analysisToReferenceMetrics(initialAnalysis, worldId);
    const initialScore = computeReferenceScore(initialMetrics, referenceProfile, dna.bpmTarget);
    let currentScore = initialScore.total;
    bestScore = currentScore;
    bestParams = registryToOverrides(registry);

    for (let iter = 1; iter <= maxIterations; iter++) {
      // Identify top problems
      const problems = initialScore.topProblems; // use the latest score's problems
      const scoreResult = currentScore === initialScore.total
        ? initialScore
        : computeReferenceScore(initialMetrics, referenceProfile, dna.bpmTarget);

      // Propose changes based on top problems
      const changes: ParameterChange[] = [];
      const usedParams = new Set<string>();
      for (const problem of scoreResult.topProblems.slice(0, maxChangesPerIteration)) {
        let paramName: string | null = null;
        let delta = 0;

        switch (problem.name) {
          case 'Kick Decay': {
            const param = registry.find(p => p.name === 'kickDecay');
            if (param && !usedParams.has('kickDecay')) {
              paramName = 'kickDecay';
              const refDecaySec = referenceProfile.kickDecayMs.mean / 1000;
              delta = (refDecaySec - param.current) * 0.5;
              usedParams.add('kickDecay');
            }
            break;
          }
          case 'Bass Decay': {
            const param = registry.find(p => p.name === 'bassCutoff');
            if (param && !usedParams.has('bassCutoff')) {
              paramName = 'bassCutoff';
              delta = problem.error > 0 ? -50 : 50;
              usedParams.add('bassCutoff');
            }
            break;
          }
          case 'Spectral Balance': {
            const param = registry.find(p => p.name === 'leadCutoff');
            if (param && !usedParams.has('leadCutoff')) {
              paramName = 'leadCutoff';
              delta = problem.error < 0 ? 200 : -200;
              usedParams.add('leadCutoff');
            }
            break;
          }
          case 'Transient Density': {
            const param = registry.find(p => p.name === 'duck');
            if (param && !usedParams.has('duck')) {
              paramName = 'duck';
              delta = problem.error < 0 ? 0.05 : -0.05;
              usedParams.add('duck');
            }
            break;
          }
          case 'Loudness': {
            const param = registry.find(p => p.name === 'duck');
            if (param && !usedParams.has('duck')) {
              paramName = 'duck';
              delta = problem.error < 0 ? 0.05 : -0.05;
              usedParams.add('duck');
            }
            break;
          }
          case 'Energy': {
            const param = registry.find(p => p.name === 'duck');
            if (param && !usedParams.has('duck')) {
              paramName = 'duck';
              delta = problem.error < 0 ? 0.05 : -0.05;
              usedParams.add('duck');
            }
            break;
          }
        }

        if (paramName) {
          const param = registry.find(p => p.name === paramName);
          if (param) {
            const newValue = adjustParameter(param, delta);
            if (newValue !== param.current) {
              changes.push({ name: paramName, oldValue: param.current, newValue, delta: newValue - param.current });
            }
          }
        }
      }

      if (changes.length === 0) {
        iterations.push({
          iteration: iter,
          timestamp: Date.now(),
          targetProblem: 'none',
          targetError: 0,
          changes: [],
          oldScore: currentScore,
          newScore: currentScore,
          scoreDelta: 0,
          accepted: false,
          reason: 'no actionable changes proposed',
          oldMetrics: initialMetrics,
          newMetrics: initialMetrics,
        });
        continue;
      }

      // Render with new params
      const newRegistry = applyChanges(registry, changes);
      const newRender = render(seed, worldId, duration, {
        paramOverrides: registryToOverrides(newRegistry),
      });
      const newAnalysis = analyzeAudio(newRender.samplesL, newRender.samplesR, SR);
      const newMetrics = analysisToReferenceMetrics(newAnalysis, worldId);
      const newScoreResult = computeReferenceScore(newMetrics, referenceProfile, dna.bpmTarget);
      const newScore = newScoreResult.total;

      // Accept or reject
      const accepted = newScore > currentScore;
      if (accepted) {
        registry = newRegistry;
        currentScore = newScore;
        if (newScore > bestScore) {
          bestScore = newScore;
          bestParams = registryToOverrides(newRegistry);
        }
      }

      iterations.push({
        iteration: iter,
        timestamp: Date.now(),
        targetProblem: changes[0]?.name || 'none',
        targetError: 0,
        changes,
        oldScore: accepted ? currentScore - (newScore - currentScore) : currentScore,
        newScore,
        scoreDelta: newScore - (accepted ? currentScore - (newScore - currentScore) : currentScore),
        accepted,
        reason: accepted
          ? `score improved (${(newScore - currentScore + (newScore - currentScore)).toFixed(1)})`
          : `score did not improve`,
        oldMetrics: initialMetrics,
        newMetrics,
      });

      // Update currentScore for next iteration
      if (accepted) currentScore = newScore;
    }

    return NextResponse.json({
      ok: true,
      iterations,
      initialScore: initialScore.total,
      finalScore: currentScore,
      bestScore,
      bestParams,
      referenceScoreBreakdown: initialScore.breakdown,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[reference/train] Error:', err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
