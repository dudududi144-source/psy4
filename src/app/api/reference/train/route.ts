/**
 * POST /api/reference/train
 *
 * Runs a REAL training loop that actually learns.
 *
 * The loop:
 *   1. Render with current params → analyze → compute score
 *   2. Identify the WEAKEST metric (biggest error)
 *   3. Propose a change to fix that weakness
 *   4. Render with new params → analyze → compute new score
 *   5. If score improved → ACCEPT (keep new params)
 *      If score worse → REJECT (revert), try OPPOSITE direction next time
 *   6. Repeat — each iteration builds on the last
 *
 * Key fixes vs old version:
 *   - Recomputes score EVERY iteration (was using initial score)
 *   - Tracks tried directions to avoid repeating rejected changes
 *   - Tries opposite direction if a change is rejected
 *   - Correct score delta calculation
 *   - More iterations (default 12)
 */

import { NextRequest, NextResponse } from 'next/server';
import { render, downmixToMono, SR } from '@/lib/studio/engine/forensic/offlineRenderer';
import { analyzeAudio } from '@/lib/studio/engine/forensic/audioAnalyzer';
import { computeReferenceScore } from '@/lib/studio/engine/reference/referenceScore';
import {
  createParameterRegistry, adjustParameter, applyChanges, registryToOverrides,
  type OptimizableParameter, type ParameterChange,
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
  const duration = analysis.duration || 1;

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
    transientDensity: tr.count / duration,
    kickDensity: tr.count / duration * 0.3,
    hatDensity: tr.count / duration * 0.4,
    percussionDensity: tr.count / duration,
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
      maxIterations = 12,
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

    interface TrainIteration {
      iteration: number;
      timestamp: number;
      targetProblem: string;
      targetError: number;
      changes: ParameterChange[];
      oldScore: number;
      newScore: number;
      scoreDelta: number;
      accepted: boolean;
      reason: string;
      oldMetrics: ReferenceMetrics;
      newMetrics: ReferenceMetrics;
    }
    const iterations: TrainIteration[] = [];

    // ── Initial render + score ──
    const initialRender = render(seed, worldId, duration, {
      paramOverrides: registryToOverrides(registry),
    });
    const initialAnalysis = analyzeAudio(initialRender.samplesL, initialRender.samplesR, SR);
    const initialMetrics = analysisToReferenceMetrics(initialAnalysis, worldId);
    const initialScoreResult = computeReferenceScore(initialMetrics, referenceProfile, dna.bpmTarget);
    let currentScore = initialScoreResult.total;
    let bestScore = currentScore;
    let bestParams = registryToOverrides(registry);
    let lastMetrics = initialMetrics;

    // Track tried changes to avoid repeating rejected ones
    const triedChanges = new Set<string>();

    for (let iter = 1; iter <= maxIterations; iter++) {
      // ── CRITICAL FIX: Recompute score with CURRENT params every iteration ──
      const currentRender = render(seed, worldId, duration, {
        paramOverrides: registryToOverrides(registry),
      });
      const currentAnalysis = analyzeAudio(currentRender.samplesL, currentRender.samplesR, SR);
      const currentMetrics = analysisToReferenceMetrics(currentAnalysis, worldId);
      const currentScoreResult = computeReferenceScore(currentMetrics, referenceProfile, dna.bpmTarget);
      const oldScore = currentScoreResult.total;

      // ── Identify top problems (from CURRENT score, not initial) ──
      const topProblems = currentScoreResult.topProblems;

      // ── Propose changes based on the weakest metrics ──
      const changes: ParameterChange[] = [];
      const usedParams = new Set<string>();

      for (const problem of topProblems.slice(0, maxChangesPerIteration)) {
        let paramName: string | null = null;
        let delta = 0;

        // Helper: check if a direction was already tried and rejected
        const isTried = (name: string, dir: number) => {
          const key = `${name}:${dir > 0 ? '+' : '-'}`;
          return triedChanges.has(key);
        };
        // Mark a direction as tried
        const markTried = (name: string, dir: number) => {
          triedChanges.add(`${name}:${dir > 0 ? '+' : '-'}`);
        };

        switch (problem.name) {
          case 'Kick Decay': {
            const param = registry.find(p => p.name === 'kickDecay');
            if (param && !usedParams.has('kickDecay')) {
              paramName = 'kickDecay';
              const refDecaySec = referenceProfile.kickDecayMs.mean / 1000;
              const direction = refDecaySec > param.current ? 1 : -1;
              // If primary direction tried, try opposite with smaller step
              if (isTried('kickDecay', direction)) {
                if (isTried('kickDecay', -direction)) {
                  paramName = null; // both directions tried, skip
                } else {
                  delta = -direction * param.step * 2; // opposite, 2 steps
                }
              } else {
                delta = (refDecaySec - param.current) * 0.5; // move 50% toward target
              }
              if (paramName) usedParams.add('kickDecay');
            }
            break;
          }
          case 'Bass Decay': {
            const param = registry.find(p => p.name === 'bassCutoff');
            if (param && !usedParams.has('bassCutoff')) {
              paramName = 'bassCutoff';
              const direction = problem.error > 0 ? -1 : 1; // too long → lower cutoff
              if (isTried('bassCutoff', direction)) {
                if (isTried('bassCutoff', -direction)) {
                  paramName = null;
                } else {
                  delta = -direction * param.step * 2;
                }
              } else {
                delta = direction * 60; // 60Hz steps (bigger for measurable effect)
              }
              if (paramName) usedParams.add('bassCutoff');
            }
            break;
          }
          case 'Spectral Balance': {
            const param = registry.find(p => p.name === 'leadCutoff');
            if (param && !usedParams.has('leadCutoff')) {
              paramName = 'leadCutoff';
              const direction = problem.error < 0 ? 1 : -1; // too dark → raise cutoff
              if (isTried('leadCutoff', direction)) {
                if (isTried('leadCutoff', -direction)) {
                  paramName = null;
                } else {
                  delta = -direction * param.step * 2;
                }
              } else {
                delta = direction * 400; // 400Hz steps (bigger for measurable effect)
              }
              if (paramName) usedParams.add('leadCutoff');
            }
            break;
          }
          case 'Transient Density':
          case 'Loudness':
          case 'Energy': {
            const param = registry.find(p => p.name === 'duck');
            if (param && !usedParams.has('duck')) {
              paramName = 'duck';
              const direction = problem.error < 0 ? 1 : -1; // too few transients → more duck
              if (isTried('duck', direction)) {
                if (isTried('duck', -direction)) {
                  paramName = null;
                } else {
                  delta = -direction * param.step;
                }
              } else {
                delta = direction * 0.1; // bigger steps
              }
              if (paramName) usedParams.add('duck');
            }
            break;
          }
          case 'BPM':
          case 'Stereo Width':
          case 'Repetition':
            // Can't fix with available parameters
            break;
        }

        if (paramName) {
          const param = registry.find(p => p.name === paramName);
          if (param) {
            const newValue = adjustParameter(param, delta);
            if (newValue !== param.current) {
              changes.push({
                name: paramName,
                oldValue: param.current,
                newValue,
                delta: newValue - param.current,
              });
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
          oldScore,
          newScore: oldScore,
          scoreDelta: 0,
          accepted: false,
          reason: 'no actionable changes proposed (all problems are non-parameter)',
          oldMetrics: currentMetrics,
          newMetrics: currentMetrics,
        });
        continue;
      }

      // ── Render with new params ──
      const newRegistry = applyChanges(registry, changes);
      const newRender = render(seed, worldId, duration, {
        paramOverrides: registryToOverrides(newRegistry),
      });
      const newAnalysis = analyzeAudio(newRender.samplesL, newRender.samplesR, SR);
      const newMetrics = analysisToReferenceMetrics(newAnalysis, worldId);
      const newScoreResult = computeReferenceScore(newMetrics, referenceProfile, dna.bpmTarget);
      const newScore = newScoreResult.total;

      // ── Accept or reject ──
      const accepted = newScore > oldScore;
      const scoreDelta = newScore - oldScore;

      if (accepted) {
        registry = newRegistry;
        currentScore = newScore;
        lastMetrics = newMetrics;
        if (newScore > bestScore) {
          bestScore = newScore;
          bestParams = registryToOverrides(newRegistry);
        }
      } else {
        // Mark this direction as tried so we don't repeat it
        for (const c of changes) {
          triedChanges.add(`${c.name}:${c.delta > 0 ? '+' : '-'}`);
        }
      }

      iterations.push({
        iteration: iter,
        timestamp: Date.now(),
        targetProblem: changes[0]?.name || 'none',
        targetError: 0,
        changes,
        oldScore,
        newScore,
        scoreDelta,
        accepted,
        reason: accepted
          ? `score improved by ${scoreDelta.toFixed(1)} points`
          : `score dropped by ${Math.abs(scoreDelta).toFixed(1)} — reverting`,
        oldMetrics: currentMetrics,
        newMetrics,
      });
    }

    return NextResponse.json({
      ok: true,
      iterations,
      initialScore: initialScoreResult.total,
      finalScore: currentScore,
      bestScore,
      bestParams,
      referenceScoreBreakdown: initialScoreResult.breakdown,
      improvement: bestScore - initialScoreResult.total,
      learned: bestScore > initialScoreResult.total,
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
