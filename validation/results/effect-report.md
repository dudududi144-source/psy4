# PSY4 Vertical Validation — STEP 1: Effect Report

**Date:** 2024-08-12
**Protocol:** `audit-reports/PSY4-PRE-RENDER-SNAPSHOT.md` (FROZEN)
**Renders:** 45 (9 units × 5 variants A/B/C/D/E)
**Critic output:** `validation/results/metrics.json`, `validation/results/hypotheses.json`

**This is STEP 1 — EFFECT REPORT only. No architectural language. No interpretation. No approval decisions. Just raw measurements and decision-rule results.**

---

## Summary

All hypotheses (H1-H4, H6) FAILED. H5 (evaluator/perception agreement) is PENDING (requires blind listening data).

| Hypothesis | Result | Passing units |
|---|---|---|
| H1 (backend effect, B vs A) | **FAIL** | 0/9 |
| H2 (representation-path effect, C vs B) | **FAIL** | 0/9 |
| H3 (performance realization effect, D vs C) | **FAIL** | 0/9 |
| H4 (acoustic realization effect, E vs D) | **FAIL** | 0/9 |
| H5 (evaluator/perception agreement) | **PENDING** | requires blind listening |
| H6 (end-to-end outcome, E vs A) | **FAIL** | 0/9 |

---

## H1 — Backend effect (B vs A)

**Decision rule:** ≥6/9 units: B improves ≥3/11 quality metrics by ≥10% AND no regression >10% AND no guardrail violation.
**Result:** 0/9 units pass.

### Per-unit results

| Unit | Improved (≥10%) | Regressed (>10%) | Guardrail violations (B) | Passes |
|---|---|---|---|---|
| comp-1-seed1 | 0 | 2 | masking=0.619>0.5, midrange=4.0%<5, timbral=0.97>0.9 | ❌ |
| comp-1-seed2 | 0 | 2 | masking=0.597>0.5, midrange=4.0%<5, timbral=0.97>0.9 | ❌ |
| comp-1-seed3 | 0 | 2 | masking=0.616>0.5, midrange=3.9%<5, timbral=0.97>0.9 | ❌ |
| comp-2-seed1 | 0 | 3 | masking=0.580>0.5, midrange=3.7%<5, timbral=0.93>0.9 | ❌ |
| comp-2-seed2 | 1 | 2 | masking=0.579>0.5, midrange=3.8%<5, timbral=0.92>0.9 | ❌ |
| comp-2-seed3 | 0 | 2 | masking=0.581>0.5, midrange=3.9%<5, timbral=0.92>0.9 | ❌ |
| comp-3-seed1 | 0 | 2 | masking=0.619>0.5, midrange=3.9%<5, timbral=0.97>0.9 | ❌ |
| comp-3-seed2 | 0 | 2 | masking=0.617>0.5, midrange=4.0%<5, timbral=0.97>0.9 | ❌ |
| comp-3-seed3 | 0 | 2 | masking=0.617>0.5, midrange=3.9%<5, timbral=0.97>0.9 | ❌ |

### Aggregate comparison (mean across 9 units)

| Variant | aggregate (mean of 11 quality) |
|---|---|
| A | 0.556 |
| B | 0.503 |

B's aggregate is 9.5% LOWER than A.

### Effect summary

The backend change (current psyLive → refactored voices + AdvancedSynthVoice + real samples) did NOT improve audio quality under the experimental conditions. B regressed on 2-3 quality metrics per unit, violated 3 guardrails consistently (masking, midrange_density, timbral_movement), and the aggregate dropped 9.5%.

---

## H2 — Representation-path effect (C vs B)

**Decision rule:** ≥6/9 units: C improves ≥2/11 quality metrics by ≥5% AND no regression >10% AND no guardrail violation.
**Result:** 0/9 units pass.

### Per-unit results

All 9 units: improved=0, regressed=0. C produced IDENTICAL metrics to B (by design — same builder, same codebook defaults).

### Effect summary

C ≡ B exactly (same VoiceSpec builder, same codebook defaults). This was expected per protocol — H2 tests whether the CompositionEvent → VoiceSpec path adds overhead. The path adds zero overhead AND zero value: the metrics are identical.

This means: under these experimental conditions, the CompositionEvent → VoiceSpec transformation does not change the audio. The "contract path" is a pure passthrough at this validation stage.

---

## H3 — Performance realization effect (D vs C)

**Decision rule:** ≥6/9 units: D improves ≥2/11 quality metrics by ≥5% AND no regression >10% AND no guardrail violation.
**Result:** 0/9 units pass.

### Per-unit results

All 9 units: improved=0, regressed=1. D regressed 1 quality metric per unit (loudness, due to velocity scaling reducing overall level).

### Effect summary

Performance realization (velocity scaling by tension, articulation-derived duration) did NOT improve any quality metric and regressed loudness. The velocity scaling reduced overall loudness without improving other dimensions.

---

## H4 — Acoustic realization effect (E vs D)

**Decision rule:** ≥6/9 units: E improves ≥2/11 quality metrics by ≥5% AND no regression >10% AND no guardrail violation.
**Result:** 0/9 units pass.

### Per-unit results

All 9 units: improved=1, regressed=0. E improved 1 quality metric per unit (not enough — rule requires ≥2). No regressions, but guardrail violations persist.

### Effect summary

Acoustic compilation (BPM-aware envelopes + voiceGroup masking budgets) improved 1 quality metric per unit but did not meet the ≥2 threshold. The BPM-aware envelope changes were too small to produce measurable improvement on multiple metrics.

---

## H5 — Evaluator/perception agreement

**Status:** PENDING. Requires blind listening data.

H5 cannot be computed until the blind listening session is conducted (45 unlabeled renders, ranked by listener). The H5 script (`validation/listening/analyze-listening.py`) will compute pairwise agreement between DSP ranking and human ranking once the listener ratings are collected.

---

## H6 — End-to-end outcome (E vs A)

**Decision rule:** ≥6/9 units: E aggregate > A aggregate by ≥10% AND listener rates E ≥4 "commercial" for ≥2/3 compositions AND no guardrail violation.
**Result:** 0/9 units pass (aggregate criterion). Human criterion PENDING.

### Per-unit results

| Unit | A aggregate | E aggregate | Improvement % | Passes |
|---|---|---|---|---|
| comp-1-seed1 | 0.539 | 0.508 | -5.79% | ❌ |
| comp-1-seed2 | 0.554 | 0.508 | -8.33% | ❌ |
| comp-1-seed3 | 0.539 | 0.508 | -5.75% | ❌ |
| comp-2-seed1 | 0.591 | 0.506 | -14.46% | ❌ |
| comp-2-seed2 | 0.564 | 0.504 | -10.61% | ❌ |
| comp-2-seed3 | 0.565 | 0.505 | -10.62% | ❌ |
| comp-3-seed1 | 0.540 | 0.506 | -6.29% | ❌ |
| comp-3-seed2 | 0.540 | 0.507 | -6.10% | ❌ |
| comp-3-seed3 | 0.540 | 0.506 | -6.29% | ❌ |

### Effect summary

E is WORSE than A by 5.8-14.5% across all 9 units. The full pipeline (contract + backend + performance + acoustic) produced measurably worse audio than the current psyLive baseline under these experimental conditions.

---

## Guardrail Violations (all variants B-E)

Every B/C/D/E render violated 2-3 guardrails consistently:

| Guardrail | Measured | Constraint | Hard-fail | Status |
|---|---|---|---|---|
| masking | 0.58-0.62 | <0.3 | >0.5 | **HARD FAIL** (all B-E units) |
| midrange_density | 3.7-4.1% | 8-18% | <5% or >25% | **HARD FAIL** (all B-E units) |
| stereo_width | 0.40 | 0.3-0.7 | <0.2 or >0.9 | PASS (degenerate — mono render) |
| timbral_movement | 0.92-0.97 (B/C), 0.88-0.91 (D/E) | 0.3-0.7 | <0.2 or >0.9 | **HARD FAIL** (B/C); borderline (D/E) |

Variant A (current psyLive) also violated timbral_movement (0.97) and midrange_density (~3%) but had lower masking (0.40-0.45).

---

## Raw Metrics (representative unit: comp-1-seed1)

| Metric | A | B | C | D | E |
|---|---|---|---|---|---|
| pitch_correctness | 0.71 | 0.50 | 0.50 | 0.50 | 0.50 |
| scale_correctness | 0.94 | 0.95 | 0.95 | 0.95 | 0.95 |
| kick_clarity | 0.40 | 0.33 | 0.33 | 0.33 | 0.33 |
| bass_definition | 0.22 | 0.50 | 0.50 | 0.50 | 0.50 |
| kick_bass_separation | 0.41 | 0.50 | 0.50 | 0.50 | 0.50 |
| transient_quality | 0.80 | 0.80 | 0.80 | 0.80 | 0.80 |
| spectral_balance | 0.60 | 0.60 | 0.60 | 0.60 | 0.60 |
| dynamic_range | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| loudness | 0.50 | 0.50 | 0.50 | 0.45 | 0.45 |
| phase_coherence | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| reference_similarity | 0.50 | 0.50 | 0.50 | 0.50 | 0.50 |
| **aggregate** | **0.539** | **0.503** | **0.503** | **0.498** | **0.498** |
| masking (guardrail) | 0.40 | 0.62 | 0.62 | 0.62 | 0.62 |
| midrange_density (guardrail) | 3.0% | 4.0% | 4.0% | 4.1% | 4.0% |
| timbral_movement (guardrail) | 0.97 | 0.97 | 0.97 | 0.88 | 0.88 |

---

## What the Numbers Show (factual, no interpretation)

1. **B-E have HIGHER masking than A** (0.58-0.62 vs 0.40-0.45). The hybrid kick (sample + synth sub) creates MORE low-frequency overlap with the bass than A's pure synth kick.
2. **B-E have HIGHER bass_definition** (0.50 vs 0.22). The 3-layer bass voice produces a better-defined bass centroid.
3. **B-E have HIGHER kick_bass_separation** (0.50 vs 0.41). The gap RMS between kick and bass is cleaner in B-E.
4. **B-E have LOWER pitch_correctness** (0.50 vs 0.71). The AdvancedSynthVoice lead's FM modulation produces pitches that deviate from clean semitones.
5. **B-E have LOWER loudness** (D/E: 0.45 vs A: 0.50). The velocity scaling in D/E reduces overall level.
6. **dynamic_range is 0.00 for ALL variants**. The crest factor is outside the 6-9 dB target range for all renders (too high — minimal compression).
7. **timbral_movement is 0.88-0.97 for all variants** (hard-fail >0.9). All renders have excessive spectral flux.
8. **midrange_density is 3-4% for all variants** (hard-fail <5%). All renders lack midrange energy.

---

## H5 and H6 Human Component — PENDING

Both H5 (evaluator/perception agreement) and H6 (human "commercial" rating) require blind listening data. The blind listening protocol is defined in `validation/listening/`. The listener session must be conducted before H5 and H6 can be fully evaluated.

**However**, given that H6's aggregate criterion failed in all 9 units (E is 5.8-14.5% WORSE than A), H6 cannot pass even if the human listener rates E favorably — the aggregate criterion is a prerequisite.

---

## STEP 1 Conclusion

Under the frozen experimental conditions:
- The backend change (B) did not improve over baseline (A).
- The contract path (C) produced identical audio to B (no overhead, no value).
- Performance realization (D) regressed loudness without improvement.
- Acoustic compilation (E) improved 1 metric but not enough.
- The full pipeline (E) is measurably worse than baseline (A).

All guardrail violations (masking, midrange_density, timbral_movement) are consistent across B-E, indicating systemic issues with the refactored backend's frequency balance.

**STEP 2 (architectural interpretation) and STEP 3 (approval decision) follow in separate documents, after the user reviews this effect report.**
