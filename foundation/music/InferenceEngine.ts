/**
 * InferenceEngine — the causal composition brain.
 *
 * Maps CausalState + MusicalMemoryStore → a Decision (action).
 *
 * The engine returns an ACTION, not a score or explanation.
 * Every decision is causally traceable: STATE → MEMORY → CANDIDATES →
 * SELECTED → WHY NOW → WHY NOT YET → CONSEQUENCE.
 *
 * If no rule's preconditions are met, NO_CHANGE is returned.
 *
 * The engine NEVER uses bar number or countdowns as causes.
 * The engine NEVER falls back to BAR_ACTIONS or templates.
 */

import type { CausalState } from './CausalState';
import { getMaterialState, deriveRegisterSpace, deriveConversationalBalance } from './CausalState';
import type { MusicalMemoryStore } from './MusicalMemoryStore';

// ─── Decision types ──────────────────────────────────────────────────────

export type CausalAction =
  | 'NO_CHANGE'
  | 'INTRODUCE_HATS'
  | 'INTRODUCE_LEAD'
  | 'INTRODUCE_PERCUSSION'
  | 'INTRODUCE_COUNTERLINE'
  | 'INTRODUCE_ACID'
  | 'INTRODUCE_PAD'
  | 'VARY_MOTIF'
  | 'TRANSFORM_MOTIF'
  | 'CALLBACK_MOTIF'
  | 'BREAKDOWN'
  | 'THIN_REGISTER'
  | 'RESPONSE'
;

export interface Candidate {
  action: CausalAction;
  /** Why this action is justified now (preconditions met). */
  whyNow: string;
  /** Why this action was NOT justified earlier. */
  whyNotYet: string;
  /** How urgent (0-1). Higher = more urgent. */
  urgency: number;
  /** Is this action musically necessary (vs optional)? */
  necessity: 'required' | 'optional';
  /** What this action enables in the future. */
  enables: string[];
  /** The material affected (if any). */
  materialId?: string;
}

export interface Decision {
  /** The selected action. */
  action: CausalAction;
  /** Full candidate (for traceability). */
  selected: Candidate;
  /** All candidates that were considered. */
  candidates: Candidate[];
  /** State before the decision. */
  stateBefore: Record<string, unknown>;
  /** Memory before the decision. */
  memoryBefore: Record<string, unknown>;
}

// ─── Inference thresholds ────────────────────────────────────────────────

const GROOVE_STABILITY_THRESHOLD = 0.6;     // groove established enough for new layers
const EXPECTATION_THRESHOLD = 0.6;          // enough expectation for variation
const TENSION_THRESHOLD = 0.5;              // enough tension for response
const EXHAUSTION_THRESHOLD = 0.7;           // material needs transformation
const CONTRAST_DEBT_THRESHOLD = 0.7;        // contrast needed
const ANTICIPATION_THRESHOLD = 0.6;         // callback justified
const FAMILIARITY_THRESHOLD = 0.5;          // material known enough for callback

// ─── Inference rules ────────────────────────────────────────────────────

/**
 * Evaluate the causal state and memory, return all candidate actions.
 */
export function generateCandidates(
  state: CausalState,
  memory: MusicalMemoryStore,
  activeVoices: string[]
): Candidate[] {
  const candidates: Candidate[] = [];
  const registerSpace = deriveRegisterSpace(activeVoices);
  const conversationalBalance = deriveConversationalBalance(activeVoices);

  // Rule: groove saturation → new rhythmic grid (hats)
  const hasHats = activeVoices.includes('hat') || activeVoices.includes('hat-closed');
  if (
    state.grooveStability > GROOVE_STABILITY_THRESHOLD &&
    !hasHats &&
    registerSpace.high
  ) {
    candidates.push({
      action: 'INTRODUCE_HATS',
      whyNow: `grooveStability=${state.grooveStability.toFixed(2)} > ${GROOVE_STABILITY_THRESHOLD} AND register[high] empty`,
      whyNotYet: `earlier grooveStability was below threshold — hats would have been premature`,
      urgency: state.grooveStability > 0.8 ? 0.8 : 0.5,
      necessity: 'optional',
      enables: ['groove completion', 'subdivision for future layers'],
    });
  }

  // Rule: groove complete + no motif + register mid empty → introduce lead
  if (
    state.grooveStability > GROOVE_STABILITY_THRESHOLD &&
    hasHats &&
    !activeVoices.includes('lead') &&
    registerSpace['high-mid']
  ) {
    candidates.push({
      action: 'INTRODUCE_LEAD',
      whyNow: `groove complete (hats present) AND no motif identity AND register[high-mid] empty`,
      whyNotYet: `earlier: groove not complete or motif not needed — lead without groove is premature`,
      urgency: 0.6,
      necessity: 'optional',
      enables: ['melodic identity', 'future variation', 'future callback'],
      materialId: 'motif-A',
    });
  }

  // Rule: groove saturation → percussion (secondary grid)
  if (
    state.grooveStability > 0.7 &&
    !activeVoices.includes('percussion') &&
    registerSpace['low-mid']
  ) {
    candidates.push({
      action: 'INTRODUCE_PERCUSSION',
      whyNow: `grooveStability > 0.7 AND register[low-mid] empty — secondary rhythmic grid justified`,
      whyNotYet: `earlier: groove not stable enough for a secondary grid`,
      urgency: 0.4,
      necessity: 'optional',
      enables: ['rhythmic counterpoint', 'groove evolution'],
    });
  }

  // Rule: expectation → variation
  const leadMaterial = findLeadMaterial(memory);
  if (leadMaterial) {
    const ms = getMaterialState(state, leadMaterial);
    if (
      ms.expectationLevel > EXPECTATION_THRESHOLD &&
      ms.materialExhaustion < EXHAUSTION_THRESHOLD
    ) {
      candidates.push({
        action: 'VARY_MOTIF',
        whyNow: `expectationLevel=${ms.expectationLevel.toFixed(2)} > ${EXPECTATION_THRESHOLD} AND exhaustion=${ms.materialExhaustion.toFixed(2)} < ${EXHAUSTION_THRESHOLD}`,
        whyNotYet: `earlier: expectation was below threshold — variation would be meaningless without established expectation`,
        urgency: ms.expectationLevel > 0.8 ? 0.8 : 0.5,
        necessity: 'optional',
        enables: ['tension', 'unresolved material', 'future response'],
        materialId: leadMaterial,
      });
    }
  }

  // Rule: tension → response (counterline)
  if (
    state.tensionLevel > TENSION_THRESHOLD &&
    state.unresolvedMaterial.length > 0 &&
    !activeVoices.includes('counterline') &&
    registerSpace.mid &&
    conversationalBalance !== 'balanced'
  ) {
    candidates.push({
      action: 'INTRODUCE_COUNTERLINE',
      whyNow: `tensionLevel=${state.tensionLevel.toFixed(2)} > ${TENSION_THRESHOLD} AND unresolvedMaterial=[${state.unresolvedMaterial.join(',')}] AND register[mid] empty`,
      whyNotYet: `earlier: tension was below threshold — counterline without tension is unmotivated`,
      urgency: state.tensionLevel > 0.7 ? 0.7 : 0.5,
      necessity: 'optional',
      enables: ['conversational balance', 'tension resolution'],
    });
  }

  // Rule: exhaustion → transformation
  if (leadMaterial) {
    const ms = getMaterialState(state, leadMaterial);
    if (ms.materialExhaustion > EXHAUSTION_THRESHOLD) {
      candidates.push({
        action: 'TRANSFORM_MOTIF',
        whyNow: `materialExhaustion=${ms.materialExhaustion.toFixed(2)} > ${EXHAUSTION_THRESHOLD} — material needs transformation`,
        whyNotYet: `earlier: exhaustion was below threshold — transformation would be premature`,
        urgency: 0.9,
        necessity: 'required',
        enables: ['novelty', 'continued interest'],
        materialId: leadMaterial,
      });
    }
  }

  // Rule: contrast debt → grammatical change (breakdown)
  if (
    state.contrastDebt > CONTRAST_DEBT_THRESHOLD &&
    leadMaterial &&
    memory.isEstablished(leadMaterial)
  ) {
    candidates.push({
      action: 'BREAKDOWN',
      whyNow: `contrastDebt=${state.contrastDebt.toFixed(2)} > ${CONTRAST_DEBT_THRESHOLD} AND motif established — withholding has meaning`,
      whyNotYet: `earlier: contrastDebt was below threshold — breakdown without accumulated debt feels arbitrary`,
      urgency: state.contrastDebt > 0.85 ? 0.9 : 0.6,
      necessity: state.contrastDebt > 0.9 ? 'required' : 'optional',
      enables: ['anticipation', 'future payoff'],
      materialId: leadMaterial,
    });
  }

  // Rule: anticipation → payoff (callback)
  if (
    state.anticipationLevel > ANTICIPATION_THRESHOLD &&
    state.withheldMaterialId &&
    memory.isEstablished(state.withheldMaterialId)
  ) {
    candidates.push({
      action: 'CALLBACK_MOTIF',
      whyNow: `anticipationLevel=${state.anticipationLevel.toFixed(2)} > ${ANTICIPATION_THRESHOLD} AND withheld material is familiar`,
      whyNotYet: `earlier: anticipation was below threshold — callback would feel premature, not earned`,
      urgency: state.anticipationLevel > 0.8 ? 0.9 : 0.6,
      necessity: state.anticipationLevel > 0.85 ? 'required' : 'optional',
      enables: ['payoff', 'identity confirmation'],
      materialId: state.withheldMaterialId,
    });
  }

  // Rule: register saturation → thinning
  const occupiedRegisters = Object.entries(registerSpace).filter(([, empty]) => !empty).length;
  if (occupiedRegisters >= 6) {
    candidates.push({
      action: 'THIN_REGISTER',
      whyNow: `${occupiedRegisters}/7 registers occupied — saturation high`,
      whyNotYet: `earlier: not enough registers occupied to justify thinning`,
      urgency: 0.5,
      necessity: 'optional',
      enables: ['register space', 'clarity'],
    });
  }

  // ── STAGE 3: New rules for the 3 missing actions ──

  // Rule: tension high + no acid line + high-mid register empty → introduce acid (TB-303)
  // Acid is a distinctive psytrance voice — a squelchy 303 line that adds psychedelic tension.
  // It's motivated when tension is already high and the high-mid register has space.
  if (
    state.tensionLevel > 0.6 &&
    !activeVoices.includes('acid') &&
    registerSpace['high-mid'] &&
    state.grooveStability > 0.6
  ) {
    candidates.push({
      action: 'INTRODUCE_ACID',
      whyNow: `tensionLevel=${state.tensionLevel.toFixed(2)} > 0.6 AND groove stable AND register[high-mid] empty — acid 303 line adds psychedelic tension`,
      whyNotYet: `earlier: tension was below 0.6 or groove not stable — acid without tension is unmotivated`,
      urgency: state.tensionLevel > 0.8 ? 0.8 : 0.6,
      necessity: 'optional',
      enables: ['psychedelic character', 'tension escalation', 'future transformation'],
      materialId: 'acid-A',
    });
  }

  // Rule: low contrast debt + no pad + low register sparse → introduce pad
  // Pad adds harmonic foundation and atmosphere. It's motivated when the arrangement
  // is thin (low contrast debt = not much has changed recently) and the low-mid register is empty.
  if (
    state.contrastDebt < 0.3 &&
    !activeVoices.includes('pad') &&
    registerSpace['low-mid'] &&
    state.grooveStability > 0.4 &&
    state.bar > 4
  ) {
    candidates.push({
      action: 'INTRODUCE_PAD',
      whyNow: `contrastDebt=${state.contrastDebt.toFixed(2)} < 0.3 (arrangement thin) AND register[low-mid] empty — pad adds harmonic foundation`,
      whyNotYet: `earlier: arrangement was busy or groove not established — pad would clutter`,
      urgency: 0.3,
      necessity: 'optional',
      enables: ['harmonic depth', 'atmosphere', 'sustained tonal anchor'],
      materialId: 'pad-A',
    });
  }

  // Rule: unresolved material + no response given → RESPONSE
  // When the lead has asked a "question" (unresolved material) and no counterline
  // has answered it, a response is musically necessary.
  if (
    state.unresolvedMaterial.length > 0 &&
    state.tensionLevel > 0.4 &&
    !activeVoices.includes('counterline')
  ) {
    const answeredId = state.unresolvedMaterial[0];
    candidates.push({
      action: 'RESPONSE',
      whyNow: `unresolvedMaterial=[${state.unresolvedMaterial.join(',')}] AND tensionLevel=${state.tensionLevel.toFixed(2)} > 0.4 — musical question needs an answer`,
      whyNotYet: `earlier: no unresolved material or tension too low — response without a question is unmotivated`,
      urgency: state.tensionLevel > 0.7 ? 0.8 : 0.5,
      necessity: state.tensionLevel > 0.8 ? 'required' : 'optional',
      enables: ['conversational balance', 'tension resolution', 'musical dialogue'],
      materialId: answeredId,
    });
  }

  return candidates;
}

/**
 * Resolve competing candidates using: necessity → urgency → consequence.
 * Returns the winning candidate.
 */
export function resolveConflict(candidates: Candidate[]): Candidate | null {
  if (candidates.length === 0) return null;

  // 1. Necessity: required actions take priority
  const required = candidates.filter((c) => c.necessity === 'required');
  if (required.length > 0) {
    // Among required, pick the most urgent
    required.sort((a, b) => b.urgency - a.urgency);
    return required[0];
  }

  // 2. Urgency: pick the most urgent
  const sorted = [...candidates].sort((a, b) => b.urgency - a.urgency);

  // 3. Consequence: if urgencies are close, pick the one that enables more
  if (sorted.length > 1 && Math.abs(sorted[0].urgency - sorted[1].urgency) < 0.1) {
    if (sorted[1].enables.length > sorted[0].enables.length) {
      return sorted[1];
    }
  }

  return sorted[0];
}

/**
 * The main inference function.
 * Takes state + memory + active voices, returns a Decision.
 */
export function infer(
  state: CausalState,
  memory: MusicalMemoryStore,
  activeVoices: string[]
): Decision {
  const stateBefore = {
    bar: state.bar,
    tensionLevel: state.tensionLevel,
    unresolvedMaterial: [...state.unresolvedMaterial],
    contrastDebt: state.contrastDebt,
    anticipationLevel: state.anticipationLevel,
    grooveStability: state.grooveStability,
    withheldMaterialId: state.withheldMaterialId,
  };
  const memoryBefore = memory.snapshot();

  const candidates = generateCandidates(state, memory, activeVoices);
  const selected = resolveConflict(candidates);

  if (!selected) {
    return {
      action: 'NO_CHANGE',
      selected: {
        action: 'NO_CHANGE',
        whyNow: 'no causal preconditions met',
        whyNotYet: 'state has not reached any threshold',
        urgency: 0,
        necessity: 'optional',
        enables: [],
      },
      candidates: [],
      stateBefore,
      memoryBefore,
    };
  }

  return {
    action: selected.action,
    selected,
    candidates,
    stateBefore,
    memoryBefore,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Find the lead material in memory (the primary melodic motif).
 */
function findLeadMaterial(memory: MusicalMemoryStore): string | null {
  // Look for a material with "motif" in its ID
  for (const id of memory.getMaterialIds()) {
    if (id.startsWith('motif') || id.startsWith('lead')) {
      return id;
    }
  }
  return null;
}
