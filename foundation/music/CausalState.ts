/**
 * CausalState — the minimal causal musical state.
 *
 * This is NOT a descriptive shadow (like ContinuousMusicalState was).
 * These variables DRIVE inference — the InferenceEngine reads them to decide
 * what should happen next.
 *
 * State changes are caused by musical events (material played, withheld, etc.),
 * NOT by bar number or countdown timers.
 *
 * 9 tracked variables + 2 derivable.
 */

/**
 * A material identity (motif, groove, rhythm cell) tracked across time.
 * One CausalState per material, keyed by materialId.
 */
export interface MaterialCausalState {
  /** How many times this material has played (bars or note-events). */
  repetitionCount: number;
  /** How well the listener knows this material (0-1). Increases with repetition, decays with absence. */
  listenerFamiliarity: number;
  /** What the listener expects from this material (0-1). Increases with repetition, resets on violation. */
  expectationLevel: number;
  /** How saturated/exhausted this material is (0-1). Increases with repetition, decreases with transformation. */
  materialExhaustion: number;
  /** Last bar this material was played. */
  lastPlayedBar: number;
}

/**
 * The global causal state — NOT per-material.
 */
export interface CausalState {
  /** Current bar (informational — does NOT drive decisions directly). */
  bar: number;

  /** Current tension level (0-1). Increased by variation, dissonance, density. Decreased by resolution. */
  tensionLevel: number;

  /** Musical "questions" pending a response. Array of materialIds that have asked something unanswered. */
  unresolvedMaterial: string[];

  /** How much contrast is owed (0-1). Increases with time since last grammatical change. Resets on contrast. */
  contrastDebt: number;

  /** How much a return is pending (0-1). Increases when material is withheld. Resets on return/payoff. */
  anticipationLevel: number;

  /** How established the groove is (0-1). Increases with repetition, decreases with variation. */
  grooveStability: number;

  /** Per-material causal states. */
  materials: Map<string, MaterialCausalState>;

  /** The materialId currently withheld (for anticipation tracking). Null if none withheld. */
  withheldMaterialId: string | null;

  /** Bar of last grammatical change (for contrast debt calculation). */
  lastGrammaticalChangeBar: number;
}

/**
 * Create an empty causal state.
 */
export function createCausalState(): CausalState {
  return {
    bar: 0,
    tensionLevel: 0,
    unresolvedMaterial: [],
    contrastDebt: 0,
    anticipationLevel: 0,
    grooveStability: 0,
    materials: new Map(),
    withheldMaterialId: null,
    lastGrammaticalChangeBar: 0,
  };
}

/**
 * Get or create the causal state for a material.
 */
export function getMaterialState(state: CausalState, materialId: string): MaterialCausalState {
  let ms = state.materials.get(materialId);
  if (!ms) {
    ms = {
      repetitionCount: 0,
      listenerFamiliarity: 0,
      expectationLevel: 0,
      materialExhaustion: 0,
      lastPlayedBar: -1,
    };
    state.materials.set(materialId, ms);
  }
  return ms;
}

// ─── State transitions (caused by events, NOT by bar number) ─────────────

/**
 * Called when material is played (introduced or repeated).
 * Updates repetition, familiarity, expectation, exhaustion, groove stability.
 */
export function onMaterialPlayed(state: CausalState, materialId: string, bar: number): void {
  const ms = getMaterialState(state, materialId);
  ms.repetitionCount += 1;
  ms.lastPlayedBar = bar;

  // Familiarity increases with repetition, saturating at 1.0
  ms.listenerFamiliarity = Math.min(1, ms.listenerFamiliarity + 0.15);

  // Expectation increases with repetition (listener expects continuation)
  if (ms.repetitionCount > 1) {
    ms.expectationLevel = Math.min(1, ms.expectationLevel + 0.2);
  }

  // Exhaustion increases slowly with repetition
  ms.materialExhaustion = Math.min(1, ms.materialExhaustion + 0.08);

  // Groove stability increases when groove material repeats
  if (materialId === 'groove' || materialId === 'kick+bass') {
    state.grooveStability = Math.min(1, state.grooveStability + 0.12);
  }
}

/**
 * Called when material is varied/transformed (partial violation of expectation).
 * Updates tension, expectation reset, exhaustion relief.
 */
export function onMaterialVaried(state: CausalState, materialId: string): void {
  const ms = getMaterialState(state, materialId);
  // Variation creates tension (expectation partially violated)
  state.tensionLevel = Math.min(1, state.tensionLevel + 0.3);
  // Expectation resets (listener re-evaluates)
  ms.expectationLevel *= 0.4;
  // Exhaustion partially relieved (novelty injected)
  ms.materialExhaustion = Math.max(0, ms.materialExhaustion - 0.2);
  // This material is now "unresolved" — it asked a question
  if (!state.unresolvedMaterial.includes(materialId)) {
    state.unresolvedMaterial.push(materialId);
  }
}

/**
 * Called when a response voice enters (answers unresolved material).
 * Reduces tension, resolves the question.
 */
export function onResponseGiven(state: CausalState, answeredMaterialId: string): void {
  state.tensionLevel = Math.max(0, state.tensionLevel - 0.3);
  state.unresolvedMaterial = state.unresolvedMaterial.filter((id) => id !== answeredMaterialId);
}

/**
 * Called when material is withheld (removed for anticipation).
 */
export function onMaterialWithheld(state: CausalState, materialId: string): void {
  state.withheldMaterialId = materialId;
  // Anticipation increases
  state.anticipationLevel = Math.min(1, state.anticipationLevel + 0.4);
}

/**
 * Called when material returns (callback/payoff).
 */
export function onMaterialReturned(state: CausalState, materialId: string): void {
  state.withheldMaterialId = null;
  state.anticipationLevel = 0;
  const ms = getMaterialState(state, materialId);
  ms.expectationLevel = 0; // fulfilled
  state.tensionLevel = Math.max(0, state.tensionLevel - 0.2); // release
}

/**
 * Called when a grammatical change occurs (breakdown, contrast section).
 * Resets contrast debt.
 */
export function onGrammaticalChange(state: CausalState, bar: number): void {
  state.contrastDebt = 0;
  state.lastGrammaticalChangeBar = bar;
}

/**
 * Called when a new rhythmic grid enters (percussion, hats).
 */
export function onNewGridEntered(state: CausalState): void {
  // Groove stability adjusts — the grid is now richer
  state.grooveStability = Math.max(0, state.grooveStability - 0.1);
}

/**
 * Called at the start of each bar to advance time-based state.
 * This is the ONLY bar-number-driven update — it models the passage of time,
 * not a schedule.
 */
export function onBarAdvance(state: CausalState, bar: number): void {
  state.bar = bar;

  // Contrast debt increases with time since last grammatical change
  const barsSinceChange = bar - state.lastGrammaticalChangeBar;
  state.contrastDebt = Math.min(1, barsSinceChange / 32);

  // Familiarity decays slightly for withheld material (absence makes heart grow fonder... but also forgets)
  if (state.withheldMaterialId) {
    const ms = state.materials.get(state.withheldMaterialId);
    if (ms) {
      // Anticipation continues building while withheld
      state.anticipationLevel = Math.min(1, state.anticipationLevel + 0.03);
    }
  }
}

// ─── Derived state (computed, not stored) ────────────────────────────────

/**
 * Available register space — derived from active voices.
 * Returns a map of register → boolean (true = EMPTY/available, false = occupied).
 */
export function deriveRegisterSpace(activeVoices: string[]): Record<string, boolean> {
  // Start all as empty (true = available)
  const registers: Record<string, boolean> = {
    sub: true,
    bass: true,
    'low-mid': true,
    mid: true,
    'high-mid': true,
    high: true,
    air: true,
  };

  for (const voice of activeVoices) {
    switch (voice) {
      case 'kick': registers.sub = false; break;
      case 'bass': registers.bass = false; break;
      case 'percussion': registers['low-mid'] = false; break;
      case 'counterline': registers.mid = false; break;
      case 'acid': registers.mid = false; break;
      case 'lead': registers['high-mid'] = false; break;
      case 'hat': registers.high = false; break;
      case 'atmosphere': registers.air = false; break;
    }
  }

  return registers;
}

/**
 * Conversational balance — derived from active midrange voices.
 * Returns 'balanced' | 'unbalanced' | 'empty'.
 */
export function deriveConversationalBalance(activeVoices: string[]): 'empty' | 'unbalanced' | 'balanced' {
  const midrangeVoices = activeVoices.filter((v) =>
    v === 'lead' || v === 'counterline' || v === 'acid' || v === 'pluck'
  );
  if (midrangeVoices.length === 0) return 'empty';
  if (midrangeVoices.length === 1) return 'unbalanced';
  return 'balanced';
}

/**
 * Snapshot the causal state for logging/testing.
 */
export function snapshotCausalState(state: CausalState): Record<string, unknown> {
  const materials: Record<string, unknown> = {};
  for (const [id, ms] of state.materials) {
    materials[id] = { ...ms };
  }
  return {
    bar: state.bar,
    tensionLevel: state.tensionLevel,
    unresolvedMaterial: [...state.unresolvedMaterial],
    contrastDebt: state.contrastDebt,
    anticipationLevel: state.anticipationLevel,
    grooveStability: state.grooveStability,
    withheldMaterialId: state.withheldMaterialId,
    lastGrammaticalChangeBar: state.lastGrammaticalChangeBar,
    materials,
  };
}
