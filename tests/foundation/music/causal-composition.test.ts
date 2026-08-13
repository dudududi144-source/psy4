/**
 * Causal Composition Engine — Proof Tests
 *
 * These tests prove the architecture is genuinely causal:
 * - State changes cause decisions
 * - Decisions update state
 * - Memory influences future decisions
 * - "Why now" and "why not yet" are demonstrable
 * - NO_CHANGE is valid
 * - Counterfactual: different state → different decision
 * - Determinism: same seed + state = same decision
 * - No BAR_ACTIONS, no templates, no countdowns
 */

import { describe, it, expect } from 'bun:test';
import { CausalComposer } from '../../../foundation/music/CausalComposer';
import { createCausalState, onMaterialPlayed, onMaterialVaried, onMaterialWithheld, onBarAdvance, onGrammaticalChange, getMaterialState } from '../../../foundation/music/CausalState';
import { MusicalMemoryStore } from '../../../foundation/music/MusicalMemoryStore';
import { infer, generateCandidates, resolveConflict } from '../../../foundation/music/InferenceEngine';

const BASE_OPTS = { bpm: 145, rootPc: 4, scaleName: 'phrygian-dominant', seed: 42 };

describe('CausalState', () => {
  it('repetition causes expectation', () => {
    const state = createCausalState();
    // Play a material 5 times
    for (let i = 0; i < 5; i++) {
      onMaterialPlayed(state, 'motif-A', i);
    }
    const ms = getMaterialState(state, 'motif-A');
    expect(ms.repetitionCount).toBe(5);
    expect(ms.expectationLevel).toBeGreaterThan(0.5);
    expect(ms.listenerFamiliarity).toBeGreaterThan(0.5);
  });

  it('variation resets expectation and creates tension', () => {
    const state = createCausalState();
    for (let i = 0; i < 5; i++) onMaterialPlayed(state, 'motif-A', i);
    const beforeExpectation = getMaterialState(state, 'motif-A').expectationLevel;
    onMaterialVaried(state, "motif-A");
    onMaterialVaried(state, "motif-A");
    const afterExpectation = getMaterialState(state, 'motif-A').expectationLevel;
    expect(afterExpectation).toBeLessThan(beforeExpectation);
    expect(state.tensionLevel).toBeGreaterThan(0);
    expect(state.unresolvedMaterial).toContain('motif-A');
  });

  it('contrast debt increases with time', () => {
    const state = createCausalState();
    onBarAdvance(state, 0);
    onGrammaticalChange(state, 0);
    expect(state.contrastDebt).toBe(0);
    onBarAdvance(state, 32);
    expect(state.contrastDebt).toBeGreaterThan(0.5);
  });

  it('withholding creates anticipation', () => {
    const state = createCausalState();
    onMaterialWithheld(state, 'motif-A');
    expect(state.anticipationLevel).toBeGreaterThan(0);
    expect(state.withheldMaterialId).toBe('motif-A');
  });
});

describe('MusicalMemoryStore', () => {
  it('material lifecycle: introduced → established → exhausted', () => {
    const memory = new MusicalMemoryStore();
    memory.onMaterialPlayed('motif-A', 0);
    expect(memory.get('motif-A')?.lifecycleState).toBe('introduced');

    for (let i = 1; i < 3; i++) memory.onMaterialPlayed('motif-A', i);
    expect(memory.isEstablished('motif-A')).toBe(true);

    for (let i = 3; i < 8; i++) memory.onMaterialPlayed('motif-A', i);
    expect(memory.isExhausted('motif-A')).toBe(true);
  });

  it('withheld → recalled lifecycle', () => {
    const memory = new MusicalMemoryStore();
    for (let i = 0; i < 3; i++) memory.onMaterialPlayed('motif-A', i);
    memory.onMaterialWithheld('motif-A', 5);
    expect(memory.isWithheld('motif-A')).toBe(true);

    memory.onMaterialRecalled('motif-A', 10);
    expect(memory.get('motif-A')?.lifecycleState).toBe('recalled');
  });

  it('memory persists across bars', () => {
    const memory = new MusicalMemoryStore();
    memory.onMaterialPlayed('motif-A', 0);
    memory.onMaterialPlayed('motif-A', 5);
    memory.onMaterialPlayed('motif-A', 10);
    const entry = memory.get('motif-A');
    expect(entry?.playCount).toBe(3);
    expect(entry?.lastPlayedBar).toBe(10);
  });
});

describe('InferenceEngine — causal rules', () => {
  it('groove stability can cause INTRODUCE_HATS', () => {
    const state = createCausalState();
    const memory = new MusicalMemoryStore();
    // Build groove stability
    for (let i = 0; i < 6; i++) onMaterialPlayed(state, 'groove', i);
    const candidates = generateCandidates(state, memory, ['kick', 'bass']);
    expect(candidates.some((c) => c.action === 'INTRODUCE_HATS')).toBe(true);
  });

  it('groove stability does NOT cause INTRODUCE_HATS before threshold', () => {
    const state = createCausalState();
    const memory = new MusicalMemoryStore();
    // Only 2 repetitions — below threshold
    onMaterialPlayed(state, 'groove', 0);
    onMaterialPlayed(state, 'groove', 1);
    const candidates = generateCandidates(state, memory, ['kick', 'bass']);
    expect(candidates.some((c) => c.action === 'INTRODUCE_HATS')).toBe(false);
  });

  it('expectation can cause VARY_MOTIF', () => {
    const state = createCausalState();
    const memory = new MusicalMemoryStore();
    // Build expectation via repetition
    for (let i = 0; i < 6; i++) {
      memory.onMaterialPlayed('motif-A', i);
      onMaterialPlayed(state, 'motif-A', i);
    }
    const candidates = generateCandidates(state, memory, ['kick', 'bass', 'hat', 'lead']);
    expect(candidates.some((c) => c.action === 'VARY_MOTIF')).toBe(true);
  });

  it('tension can cause INTRODUCE_COUNTERLINE', () => {
    const state = createCausalState();
    const memory = new MusicalMemoryStore();
    // Build tension via variation
    for (let i = 0; i < 6; i++) {
      memory.onMaterialPlayed('motif-A', i);
      onMaterialPlayed(state, 'motif-A', i);
    }
    onMaterialVaried(state, "motif-A");
    onMaterialVaried(state, "motif-A");
    memory.onMaterialTransformed('motif-A', 6, 'transpose+2');

    const candidates = generateCandidates(state, memory, ['kick', 'bass', 'hat', 'lead']);
    expect(candidates.some((c) => c.action === 'INTRODUCE_COUNTERLINE')).toBe(true);
  });

  it('contrast debt can cause BREAKDOWN', () => {
    const state = createCausalState();
    const memory = new MusicalMemoryStore();
    // Build groove + motif
    for (let i = 0; i < 6; i++) {
      onMaterialPlayed(state, 'groove', i);
      memory.onMaterialPlayed('motif-A', i);
      onMaterialPlayed(state, 'motif-A', i);
    }
    // Build contrast debt (32 bars without grammatical change)
    onGrammaticalChange(state, 0);
    onBarAdvance(state, 32);

    const candidates = generateCandidates(state, memory, ['kick', 'bass', 'hat', 'lead']);
    expect(candidates.some((c) => c.action === 'BREAKDOWN')).toBe(true);
  });

  it('anticipation can cause CALLBACK_MOTIF', () => {
    const state = createCausalState();
    const memory = new MusicalMemoryStore();
    // Build familiarity
    for (let i = 0; i < 6; i++) {
      memory.onMaterialPlayed('motif-A', i);
      onMaterialPlayed(state, 'motif-A', i);
    }
    // Withhold
    memory.onMaterialWithheld('motif-A', 10);
    onMaterialWithheld(state, 'motif-A');
    // Build anticipation
    for (let b = 11; b <= 20; b++) onBarAdvance(state, b);

    const candidates = generateCandidates(state, memory, ['kick', 'bass', 'hat']);
    expect(candidates.some((c) => c.action === 'CALLBACK_MOTIF')).toBe(true);
  });

  it('NO_CHANGE when no causal preconditions are met', () => {
    const state = createCausalState();
    const memory = new MusicalMemoryStore();
    // Empty state, no material played
    const decision = infer(state, memory, []);
    expect(decision.action).toBe('NO_CHANGE');
  });

  it('exhaustion causes TRANSFORM_MOTIF (required necessity)', () => {
    const state = createCausalState();
    const memory = new MusicalMemoryStore();
    // Play until exhausted
    for (let i = 0; i < 10; i++) {
      memory.onMaterialPlayed('motif-A', i);
      onMaterialPlayed(state, 'motif-A', i);
    }
    const candidates = generateCandidates(state, memory, ['kick', 'bass', 'hat', 'lead']);
    const transform = candidates.find((c) => c.action === 'TRANSFORM_MOTIF');
    expect(transform).toBeDefined();
    expect(transform?.necessity).toBe('required');
  });
});

describe('InferenceEngine — conflict resolution', () => {
  it('required actions take priority over optional', () => {
    const state = createCausalState();
    const memory = new MusicalMemoryStore();
    // Build a state with both required and optional candidates
    for (let i = 0; i < 10; i++) {
      memory.onMaterialPlayed('motif-A', i);
      onMaterialPlayed(state, 'motif-A', i);
    }
    // Exhausted → TRANSFORM (required)
    // Also has expectation → VARY (optional)
    const candidates = generateCandidates(state, memory, ['kick', 'bass', 'hat', 'lead']);
    const selected = resolveConflict(candidates);
    expect(selected?.necessity).toBe('required');
  });

  it('multiple candidates exist when preconditions overlap', () => {
    const state = createCausalState();
    const memory = new MusicalMemoryStore();
    for (let i = 0; i < 6; i++) {
      onMaterialPlayed(state, 'groove', i);
      memory.onMaterialPlayed('motif-A', i);
      onMaterialPlayed(state, 'motif-A', i);
    }
    onMaterialVaried(state, "motif-A");
    onMaterialVaried(state, "motif-A");
    memory.onMaterialTransformed('motif-A', 6, 'transpose+2');
    onGrammaticalChange(state, 0);
    onBarAdvance(state, 32);

    const candidates = generateCandidates(state, memory, ['kick', 'bass', 'hat', 'lead']);
    expect(candidates.length).toBeGreaterThan(1);
  });
});

describe('Counterfactual proof', () => {
  it('same bar + different causal state → different decision', () => {
    // BASELINE: empty state at bar 10
    const stateA = createCausalState();
    const memoryA = new MusicalMemoryStore();
    onBarAdvance(stateA, 10);
    const decisionA = infer(stateA, memoryA, []);

    // COUNTERFACTUAL: bar 10 but with established groove + motif + expectation
    const stateB = createCausalState();
    const memoryB = new MusicalMemoryStore();
    for (let i = 0; i < 6; i++) {
      onMaterialPlayed(stateB, 'groove', i);
      memoryB.onMaterialPlayed('motif-A', i);
      onMaterialPlayed(stateB, 'motif-A', i);
    }
    onBarAdvance(stateB, 10);
    const decisionB = infer(stateB, memoryB, ['kick', 'bass']);

    // Same bar, different state → different decision
    expect(decisionA.action).toBe('NO_CHANGE');
    expect(decisionB.action).not.toBe('NO_CHANGE');
    expect(decisionA.action).not.toBe(decisionB.action);
  });

  it('changing memory changes future decisions', () => {
    // BASELINE: motif established, not withheld
    const stateA = createCausalState();
    const memoryA = new MusicalMemoryStore();
    for (let i = 0; i < 6; i++) {
      memoryA.onMaterialPlayed('motif-A', i);
      onMaterialPlayed(stateA, 'motif-A', i);
    }
    onGrammaticalChange(stateA, 0);
    onBarAdvance(stateA, 32);

    // COUNTERFACTUAL: motif established AND withheld (different memory)
    const stateB = createCausalState();
    const memoryB = new MusicalMemoryStore();
    for (let i = 0; i < 6; i++) {
      memoryB.onMaterialPlayed('motif-A', i);
      onMaterialPlayed(stateB, 'motif-A', i);
    }
    memoryB.onMaterialWithheld('motif-A', 10);
    onMaterialWithheld(stateB, 'motif-A');
    onGrammaticalChange(stateB, 0);
    for (let b = 11; b <= 32; b++) onBarAdvance(stateB, b);

    const decisionA = infer(stateA, memoryA, ['kick', 'bass', 'hat']);
    const decisionB = infer(stateB, memoryB, ['kick', 'bass', 'hat']);

    // Different memory → different candidates
    expect(decisionA.candidates.length).not.toBe(decisionB.candidates.length);
    // B should have CALLBACK candidate, A should not
    expect(decisionB.candidates.some((c) => c.action === 'CALLBACK_MOTIF')).toBe(true);
    expect(decisionA.candidates.some((c) => c.action === 'CALLBACK_MOTIF')).toBe(false);
  });
});

describe('Determinism', () => {
  it('same seed + same state + same history = same decision sequence', () => {
    const runOnce = () => {
      const composer = new CausalComposer(BASE_OPTS);
      const decisions: string[] = [];
      for (let bar = 0; bar < 32; bar++) {
        const result = composer.composeBar(bar);
        decisions.push(result.decision.action);
      }
      return decisions;
    };

    const run1 = runOnce();
    const run2 = runOnce();

    expect(run1).toEqual(run2);
  });
});

describe('Long-form causal composition', () => {
  it('64-bar composition produces causally traceable decisions', () => {
    const composer = new CausalComposer(BASE_OPTS);
    const results = [];

    for (let bar = 0; bar < 64; bar++) {
      const result = composer.composeBar(bar);
      results.push(result);
    }

    // Verify: every result has a decision
    expect(results.length).toBe(64);
    expect(results.every((r) => r.decision.action.length > 0)).toBe(true);

    // Verify: state evolves (not all NO_CHANGE)
    const actions = results.map((r) => r.decision.action);
    const noChangeCount = actions.filter((a) => a === 'NO_CHANGE').length;
    const actionCount = actions.filter((a) => a !== 'NO_CHANGE').length;
    expect(actionCount).toBeGreaterThan(0);
    expect(noChangeCount).toBeGreaterThan(0); // NO_CHANGE is valid and should appear

    // Verify: structure emerges (hats should enter after groove, lead after hats, etc.)
    const firstHats = actions.indexOf('INTRODUCE_HATS');
    const firstLead = actions.indexOf('INTRODUCE_LEAD');
    expect(firstHats).toBeGreaterThan(-1);
    expect(firstLead).toBeGreaterThan(firstHats); // lead comes after hats

    // Verify: breakdown occurs (contrast debt builds)
    const breakdownIdx = actions.indexOf('BREAKDOWN');
    expect(breakdownIdx).toBeGreaterThan(-1);
    expect(breakdownIdx).toBeGreaterThan(firstLead); // breakdown after lead established

    // Verify: callback occurs (anticipation builds after breakdown)
    const callbackIdx = actions.indexOf('CALLBACK_MOTIF');
    expect(callbackIdx).toBeGreaterThan(breakdownIdx); // callback after breakdown
  });

  it('decisions are causally traceable (stateBefore → action → stateAfter)', () => {
    const composer = new CausalComposer(BASE_OPTS);
    const result = composer.composeBar(0);

    // State before should be captured
    expect(result.decision.stateBefore).toBeDefined();
    expect(result.decision.stateBefore).toHaveProperty('bar');

    // State after should be captured
    expect(result.stateAfter).toBeDefined();
    expect(result.stateAfter).toHaveProperty('bar');

    // Memory before/after should be captured
    expect(result.decision.memoryBefore).toBeDefined();
    expect(result.memoryAfter).toBeDefined();
  });
});

describe('No template authority', () => {
  it('no decision depends on BAR_ACTIONS', () => {
    // The CausalComposer has NO BAR_ACTIONS constant
    // Verify by checking that different states at the same bar produce different results
    const composer1 = new CausalComposer(BASE_OPTS);
    const composer2 = new CausalComposer(BASE_OPTS);

    // Run composer1 for 10 bars
    for (let i = 0; i < 10; i++) composer1.composeBar(i);

    // composer2 is fresh (empty state) at bar 10
    const result1 = composer1.composeBar(10);
    const result2 = composer2.composeBar(10);

    // Same bar, different state → different decision
    // This proves bar number is NOT the cause
    expect(result1.decision.action).not.toBe(result2.decision.action);
  });

  it('every selected action produces a state consequence', () => {
    const composer = new CausalComposer(BASE_OPTS);
    // Run until we get a non-NO_CHANGE action
    for (let bar = 0; bar < 20; bar++) {
      const result = composer.composeBar(bar);
      if (result.decision.action !== 'NO_CHANGE') {
        // State should have changed (events produced, state updated)
        expect(result.events.length).toBeGreaterThan(0);
        expect(result.stateAfter).toBeDefined();
        return;
      }
    }
    // If we get here, no action fired in 20 bars — that's a problem
    expect(false).toBe(true);
  });
});
