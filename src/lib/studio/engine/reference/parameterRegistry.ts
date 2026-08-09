/**
 * Optimizable Parameter Registry
 *
 * PRIORITY 7: "Build optimizer with accept/reject"
 *
 * Each parameter has: min, max, step, current, importance.
 * The optimizer changes 1-3 parameters per iteration, measures, and
 * accepts or rejects based on whether the reference score improved.
 */

export interface OptimizableParameter {
  name: string;
  min: number;
  max: number;
  step: number;
  current: number;
  importance: number;     // 0..1 — how much this param affects the score
  description: string;
}

/**
 * The registry of parameters the optimizer can adjust.
 * These map directly to Psy4World fields + mix levels.
 */
export function createParameterRegistry(worldDefaults: {
  kickDecay: number;
  kickFundamental: number;
  bassCutoff: number;
  bassResonance: number;
  leadCutoff: number;
  leadDetune: number;
  padCutoff: number;
  duck: number;
}): OptimizableParameter[] {
  return [
    {
      name: 'kickDecay',
      min: 0.08, max: 0.35, step: 0.01,
      current: worldDefaults.kickDecay,
      importance: 0.9,
      description: 'Kick decay time (seconds) — controls kick punch vs tail',
    },
    {
      name: 'kickFundamental',
      min: 38, max: 65, step: 1,
      current: worldDefaults.kickFundamental,
      importance: 0.7,
      description: 'Kick fundamental frequency (Hz) — controls kick pitch/weight',
    },
    {
      name: 'bassCutoff',
      min: 150, max: 900, step: 25,
      current: worldDefaults.bassCutoff,
      importance: 0.85,
      description: 'Bass filter cutoff end (Hz) — controls bass brightness/decay',
    },
    {
      name: 'bassResonance',
      min: 1, max: 18, step: 1,
      current: worldDefaults.bassResonance,
      importance: 0.6,
      description: 'Bass filter resonance — controls bass character/squelch',
    },
    {
      name: 'leadCutoff',
      min: 800, max: 6000, step: 100,
      current: worldDefaults.leadCutoff,
      importance: 0.7,
      description: 'Lead filter cutoff (Hz) — controls lead brightness',
    },
    {
      name: 'leadDetune',
      min: 3, max: 30, step: 1,
      current: worldDefaults.leadDetune,
      importance: 0.5,
      description: 'Lead detune (cents) — controls lead width/richness',
    },
    {
      name: 'padCutoff',
      min: 400, max: 3000, step: 50,
      current: worldDefaults.padCutoff,
      importance: 0.4,
      description: 'Pad filter cutoff (Hz) — controls pad brightness',
    },
    {
      name: 'duck',
      min: 0.15, max: 0.75, step: 0.05,
      current: worldDefaults.duck,
      importance: 0.65,
      description: 'Sidechain duck depth — controls groove pumping',
    },
  ];
}

/**
 * Adjust a parameter by a delta, clamping to [min, max] and snapping to step.
 */
export function adjustParameter(param: OptimizableParameter, delta: number): number {
  let newVal = param.current + delta;
  // Snap to step
  newVal = Math.round(newVal / param.step) * param.step;
  // Clamp
  newVal = Math.max(param.min, Math.min(param.max, newVal));
  return newVal;
}

export interface ParameterChange {
  name: string;
  oldValue: number;
  newValue: number;
  delta: number;
}

/**
 * Apply changes to the parameter registry.
 * Returns a new registry with updated values.
 */
export function applyChanges(
  registry: OptimizableParameter[],
  changes: ParameterChange[],
): OptimizableParameter[] {
  return registry.map(p => {
    const change = changes.find(c => c.name === p.name);
    if (change) {
      return { ...p, current: change.newValue };
    }
    return p;
  });
}

/**
 * Convert a parameter registry to a Psy4World paramOverrides object.
 */
export function registryToOverrides(registry: OptimizableParameter[]): Record<string, number> {
  const overrides: Record<string, number> = {};
  for (const p of registry) {
    overrides[p.name] = p.current;
  }
  return overrides;
}
