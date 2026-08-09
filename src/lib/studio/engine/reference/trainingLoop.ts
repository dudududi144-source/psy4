/**
 * Training Loop — the GENERATE → ANALYZE → COMPARE → MODIFY → ACCEPT/REJECT cycle.
 *
 * PRIORITY 7: "Build optimizer with accept/reject"
 *
 * Flow:
 *   1. GENERATE: render with current params
 *   2. ANALYZE: extract our metrics
 *   3. COMPARE: compute reference score
 *   4. IDENTIFY: find top 1-3 errors
 *   5. MODIFY: change 1-3 parameters (measured, not blind)
 *   6. REGENERATE: render with new params
 *   7. COMPARE: new score vs old score
 *   8. ACCEPT (if better) / REJECT (if worse, revert)
 *
 * Safety limits:
 *   - Never destroy gain staging
 *   - Never clip master
 *   - Never increase CPU indefinitely
 *   - Never change BPM randomly
 *   - Never change arrangement every iteration
 *   - Work within bounds (min/max per parameter)
 */

import type { ReferenceMetrics, ReferenceProfile } from './referenceListener';
import type { ReferenceScoreResult } from './referenceScore';
import { computeReferenceScore } from './referenceScore';
import {
  createParameterRegistry, adjustParameter, applyChanges, registryToOverrides,
  type OptimizableParameter, type ParameterChange,
} from './parameterRegistry';
import type { WorldDNA } from './worldDNA';

export interface TrainingIteration {
  iteration: number;
  timestamp: number;

  // What was identified as the weakest area
  targetProblem: string;
  targetError: number;

  // What parameters were changed
  changes: ParameterChange[];

  // Scores
  oldScore: number;
  newScore: number;
  scoreDelta: number;

  // Decision
  accepted: boolean;
  reason: string;

  // Metrics snapshot
  oldMetrics: ReferenceMetrics | null;
  newMetrics: ReferenceMetrics | null;
}

export interface TrainingState {
  worldId: string;
  iterations: TrainingIteration[];
  currentScore: number;
  bestScore: number;
  bestParams: Record<string, number>;
  currentParams: Record<string, number>;
  registry: OptimizableParameter[];
  running: boolean;
  totalIterations: number;
  acceptedCount: number;
  rejectedCount: number;
}

export type TrainingMode = 'listen' | 'analyze' | 'train';

export interface TrainingConfig {
  worldId: string;
  worldDNA: WorldDNA;
  maxIterations: number;
  maxChangesPerIteration: number;   // 1-3
  minScoreDelta: number;            // accept only if improvement > this
  renderDuration: number;           // seconds per render
}

/**
 * Get the default world params for a given world DNA.
 */
function getWorldDefaults(dna: WorldDNA) {
  return {
    kickDecay: dna.kickDecayTarget,
    kickFundamental: dna.kickFundamentalTarget,
    bassCutoff: dna.bassCutoffTarget,
    bassResonance: dna.bassResonanceTarget,
    leadCutoff: dna.leadCutoffTarget,
    leadDetune: dna.leadDetuneTarget,
    padCutoff: 1200,
    duck: 0.4,
  };
}

/**
 * Create initial training state for a world.
 */
export function createTrainingState(dna: WorldDNA): TrainingState {
  const defaults = getWorldDefaults(dna);
  const registry = createParameterRegistry(defaults);
  return {
    worldId: dna.worldId,
    iterations: [],
    currentScore: 0,
    bestScore: 0,
    bestParams: registryToOverrides(registry),
    currentParams: registryToOverrides(registry),
    registry,
    running: false,
    totalIterations: 0,
    acceptedCount: 0,
    rejectedCount: 0,
  };
}

/**
 * Determine which parameter(s) to change based on the top problems.
 *
 * This is the "brain" of the optimizer. It maps problems to parameter changes.
 * Each change is MEASURED — we pick the parameter that most affects the problem,
 * and compute a delta that moves toward the reference.
 */
function proposeChanges(
  score: ReferenceScoreResult,
  registry: OptimizableParameter[],
  referenceProfile: ReferenceProfile,
  maxChanges: number,
): ParameterChange[] {
  const changes: ParameterChange[] = [];
  const usedParams = new Set<string>();

  for (const problem of score.topProblems) {
    if (changes.length >= maxChanges) break;

    let paramName: string | null = null;
    let delta: number = 0;

    switch (problem.name) {
      case 'Kick Decay': {
        const param = registry.find(p => p.name === 'kickDecay');
        if (param && !usedParams.has('kickDecay')) {
          paramName = 'kickDecay';
          // If our decay is longer than ref, reduce; if shorter, increase
          const refDecaySec = referenceProfile.kickDecayMs.mean / 1000;
          delta = (refDecaySec - param.current) * 0.5; // move halfway toward target
          usedParams.add('kickDecay');
        }
        break;
      }
      case 'Bass Decay': {
        // Bass decay is controlled by bassCutoff (lower = faster decay due to less energy)
        const param = registry.find(p => p.name === 'bassCutoff');
        if (param && !usedParams.has('bassCutoff')) {
          paramName = 'bassCutoff';
          // If our bass decay is too long (error > 0), reduce cutoff to shorten decay
          delta = problem.error > 0 ? -50 : 50;
          usedParams.add('bassCutoff');
        }
        break;
      }
      case 'BPM': {
        // BPM is NOT in the registry (it's a world property, not optimizable in real-time)
        // Skip — we don't change BPM during optimization
        break;
      }
      case 'Spectral Balance': {
        // Adjust leadCutoff (affects high/mid balance) and padCutoff
        const leadParam = registry.find(p => p.name === 'leadCutoff');
        if (leadParam && !usedParams.has('leadCutoff')) {
          paramName = 'leadCutoff';
          // If our centroid is too low (dark), increase cutoff; if too high (bright), decrease
          delta = problem.error < 0 ? 200 : -200;
          usedParams.add('leadCutoff');
        }
        break;
      }
      case 'Transient Density': {
        // Transient density is controlled by percussion density (not in registry)
        // We can affect it via duck (more duck = more perceived transients)
        const param = registry.find(p => p.name === 'duck');
        if (param && !usedParams.has('duck')) {
          paramName = 'duck';
          delta = problem.error < 0 ? 0.05 : -0.05;
          usedParams.add('duck');
        }
        break;
      }
      case 'Loudness': {
        // Loudness is controlled by master makeup (not in registry)
        // We can affect it slightly via duck (more duck = louder perceived dynamics)
        const param = registry.find(p => p.name === 'duck');
        if (param && !usedParams.has('duck')) {
          paramName = 'duck';
          delta = problem.error < 0 ? 0.05 : -0.05;
          usedParams.add('duck');
        }
        break;
      }
      case 'Stereo Width': {
        // Stereo width not directly in registry — skip for now
        break;
      }
      case 'Energy': {
        // Energy controlled by overall levels — adjust duck for perceived energy
        const param = registry.find(p => p.name === 'duck');
        if (param && !usedParams.has('duck')) {
          paramName = 'duck';
          delta = problem.error < 0 ? 0.05 : -0.05;
          usedParams.add('duck');
        }
        break;
      }
      case 'Repetition': {
        // Repetition is arrangement-level, not parameter-level
        break;
      }
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

  return changes;
}

/**
 * Run a single training iteration.
 *
 * This function is called by the TrainingLoop. It:
 *   1. Takes current metrics + reference profile
 *   2. Computes the reference score
 *   3. Identifies the weakest area
 *   4. Proposes 1-3 parameter changes
 *   5. Returns the changes + score (the caller renders + measures to accept/reject)
 *
 * The caller is responsible for:
 *   - Rendering with old params → measuring old score
 *   - Applying changes
 *   - Rendering with new params → measuring new score
 *   - Accepting or rejecting
 */
export function proposeIteration(
  state: TrainingState,
  ourMetrics: ReferenceMetrics,
  referenceProfile: ReferenceProfile,
  config: TrainingConfig,
): {
  score: ReferenceScoreResult;
  changes: ParameterChange[];
} {
  const score = computeReferenceScore(ourMetrics, referenceProfile, config.worldDNA.bpmTarget);
  const changes = proposeChanges(score, state.registry, referenceProfile, config.maxChangesPerIteration);

  return { score, changes };
}

/**
 * Record the result of an iteration (after render + measure).
 */
export function recordIteration(
  state: TrainingState,
  iteration: TrainingIteration,
): TrainingState {
  const newState = { ...state };
  newState.iterations = [...state.iterations, iteration];
  newState.totalIterations++;
  newState.currentScore = iteration.newScore;

  if (iteration.accepted) {
    newState.acceptedCount++;
    // Update registry with accepted changes
    newState.registry = applyChanges(state.registry, iteration.changes);
    newState.currentParams = registryToOverrides(newState.registry);
    if (iteration.newScore > newState.bestScore) {
      newState.bestScore = iteration.newScore;
      newState.bestParams = { ...newState.currentParams };
    }
  } else {
    newState.rejectedCount++;
    // Revert — keep old params
  }

  return newState;
}

/**
 * Format an iteration for display.
 */
export function formatIteration(iter: TrainingIteration): string {
  const lines: string[] = [];
  lines.push(`ITERATION ${iter.iteration}`);
  lines.push('');
  lines.push('Changed:');
  for (const c of iter.changes) {
    lines.push(`  ${c.name}: ${c.oldValue.toFixed(3)} → ${c.newValue.toFixed(3)}`);
  }
  lines.push('');
  lines.push('Reference score:');
  lines.push(`  ${iter.oldScore.toFixed(1)} → ${iter.newScore.toFixed(1)}`);
  lines.push('');
  lines.push('Result:');
  lines.push(`  ${iter.accepted ? 'ACCEPTED' : 'REJECTED / REVERTED'}`);
  lines.push(`  ${iter.reason}`);
  return lines.join('\n');
}

/**
 * Check safety limits before applying changes.
 */
export function validateChanges(
  changes: ParameterChange[],
  registry: OptimizableParameter[],
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  for (const change of changes) {
    const param = registry.find(p => p.name === change.name);
    if (!param) {
      violations.push(`unknown parameter: ${change.name}`);
      continue;
    }
    if (change.newValue < param.min) {
      violations.push(`${change.name} ${change.newValue} < min ${param.min}`);
    }
    if (change.newValue > param.max) {
      violations.push(`${change.name} ${change.newValue} > max ${param.max}`);
    }
  }

  // Safety: never allow more than 3 changes per iteration
  if (changes.length > 3) {
    violations.push(`too many changes: ${changes.length} > 3`);
  }

  return { valid: violations.length === 0, violations };
}
