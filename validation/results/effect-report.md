# PSY4 Vertical Validation — STEP 1: Effect Report

**Date:** 2024-08-12
**Protocol:** `audit-reports/PSY4-PRE-RENDER-SNAPSHOT.md` (FROZEN)
**Renders:** 45 (9 units × 5 variants A/B/C/D/E)
**Critic output:** `validation/results/metrics.json`, `validation/results/hypotheses.json`
**Status:** FROZEN experiment output. No thresholds, metrics, seeds, or decision rules changed. No remediation. No rerender.

**This is STEP 1 — EFFECT REPORT only. No architectural language. No interpretation. No approval decisions. Just raw measurements and decision-rule results.**

---

## Precise Status of Each Hypothesis

| Hypothesis | Status | Notes |
|---|---|---|
| H1 (backend effect, B vs A) | **FAIL** | 0/9 units pass. |
| H2 (representation-path effect, C vs B) | **FAIL / no demonstrated effect** | C and B produced identical output under the frozen implementation. No measurable incremental effect of the representation-path change was demonstrated. |
| H3 (performance realization effect, D vs C) | **FAIL** | 0/9 units pass. |
| H4 (acoustic realization effect, E vs D) | **FAIL** | 0/9 units pass. |
| H5 (evaluator/perception agreement) | **PENDING** | Requires blind listening data. Cannot be marked PASS or FAIL until the human listening session is completed. |
| H6 (end-to-end outcome, E vs A) — objective component | **FAIL** | 0/9 units pass the aggregate criterion. |
| H6 — final status | **PENDING-FINAL** | Final status requires the human listening component. Even though the objective component already failed, the final H6 status remains PENDING until the human component is completed. |

### Important clarifications

- **H2**: C ≡ B is a valid experimental result. The only permitted claim is: "Under the frozen implementation, C and B produced identical output, therefore no measurable incremental effect of the representation-path change was demonstrated." **No architectural inference** is drawn from this about whether CompositionEvent or the contract path is valid or invalid. That is a Step 2 decision.
- **H5**: H5 cannot be marked FALSE before the blind listening is performed. It remains PENDING.
- **H6**: Even though the objective component (aggregate criterion) already failed, the final H6 status is PENDING-FINAL because the protocol requires both the objective AND human components. The human component must still be completed for the record.

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

B's aggregate is 9.5% lower than A.

### Effect summary (factual)

The backend change (current psyLive → refactored voices + AdvancedSynthVoice + real samples) did not meet the decision rule under the experimental conditions. B regressed on 2-3 quality metrics per unit, violated 3 guardrails consistently (masking, midrange_density, timbral_movement), and the aggregate dropped 9.5%.

---

## H2 — Representation-path effect (C vs B)

**Decision rule:** ≥6/9 units: C improves ≥2/11 quality metrics by ≥5% AND no regression >10% AND no guardrail violation.
**Result:** 0/9 units pass.

### Per-unit results

All 9 units: improved=0, regressed=0. C produced identical metrics to B.

### Effect summary (factual, no architectural inference)

Under the frozen implementation, C and B produced identical output. Therefore, no measurable incremental effect of the representation-path change was demonstrated.

**This is a valid experimental result.** It does NOT imply that the CompositionEvent contract or the representation path is invalid. It means only that, under this specific frozen implementation (where C and B use the same codebook defaults and the same builder), the path transformation did not change the audio. Whether the contract path deserves to stay is a Step 2 architectural decision, not a Step 1 inference.

---

## H3 — Performance realization effect (D vs C)

**Decision rule:** ≥6/9 units: D improves ≥2/11 quality metrics by ≥5% AND no regression >10% AND no guardrail violation.
**Result:** 0/9 units pass.

### Per-unit results

All 9 units: improved=0, regressed=1. D regressed 1 quality metric per unit (loudness, due to velocity scaling reducing overall level).

### Effect summary (factual)

Performance realization (velocity scaling by tension, articulation-derived duration) did not improve any quality metric and regressed loudness under the experimental conditions.

---

## H4 — Acoustic realization effect (E vs D)

**Decision rule:** ≥6/9 units: E improves ≥2/11 quality metrics by ≥5% AND no regression >10% AND no guardrail violation.
**Result:** 0/9 units pass.

### Per-unit results

All 9 units: improved=1, regressed=0. E improved 1 quality metric per unit (not enough — rule requires ≥2). No regressions, but guardrail violations persist.

### Effect summary (factual)

Acoustic compilation (BPM-aware envelopes + voiceGroup masking budgets) improved 1 quality metric per unit but did not meet the ≥2 threshold under the experimental conditions.

---

## H5 — Evaluator/perception agreement

**Status:** **PENDING.** Requires blind listening data.

H5 cannot be computed until the blind listening session is conducted (45 unlabeled renders, ranked by listener). H5 cannot be marked PASS or FAIL before the human listening is performed.

The H5 analysis script (`validation/listening/analyze-listening.py`) will compute pairwise agreement between DSP ranking and human ranking once the listener ratings are collected.

**Frozen decision rule:** mean per-unit pairwise agreement ≥70% AND ≥7/9 units have per-unit agreement ≥60%.

---

## H6 — End-to-end outcome (E vs A)

### Objective component: FAIL

**Decision rule (objective):** ≥6/9 units: E aggregate > A aggregate by ≥10% AND no guardrail violation.
**Result:** 0/9 units pass the objective aggregate criterion.

| Unit | A aggregate | E aggregate | Improvement % | Passes objective |
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

E's aggregate is 5.8-14.5% lower than A across all 9 units.

### Human component: PENDING

**Decision rule (human):** listener rates E ≥4 ("commercial") for ≥2/3 compositions.

The human component requires the blind listening session. It has not yet been conducted.

### Final H6 status: **PENDING-FINAL**

Even though the objective component already failed, the final H6 status remains PENDING-FINAL because the protocol requires both the objective AND human components to be completed for the record. The human component must still be conducted.

Once the human component is completed:
- If the human component also fails → H6 final = FAIL.
- If the human component passes (even though objective failed) → H6 final = FAIL (both components must pass).

In either case, H6 cannot pass because the objective component already failed. But the human component is still required for completeness and for H5.

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

**No remediation is being performed.** These are the measured values under the frozen protocol.

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

1. B-E have higher masking than A (0.58-0.62 vs 0.40-0.45).
2. B-E have higher bass_definition than A (0.50 vs 0.22).
3. B-E have higher kick_bass_separation than A (0.50 vs 0.41).
4. B-E have lower pitch_correctness than A (0.50 vs 0.71).
5. B-E (D/E) have lower loudness than A (0.45 vs 0.50).
6. dynamic_range is 0.00 for all variants.
7. timbral_movement is 0.88-0.97 for all variants.
8. midrange_density is 3-4% for all variants.

---

## H5 and H6 Human Component — PENDING

Both H5 (evaluator/perception agreement) and H6 (human "commercial" rating) require blind listening data. The blind listening protocol is set up at `validation/listening/`. The listener session must be conducted before H5 and H6 can be fully evaluated.

**H6 cannot pass** because the objective component already failed (E is 5.8-14.5% lower than A on aggregate across all 9 units). However, the human component is still required:
- For H5 (which depends on the same listening data).
- For the completeness of the H6 record.

---

## STEP 1 Conclusion (factual)

Under the frozen experimental conditions:
- H1, H3, H4 did not pass.
- H2 produced identical output for C and B; no measurable incremental effect was demonstrated.
- H5 remains PENDING (requires blind listening).
- H6 objective component did not pass; H6 final status remains PENDING-FINAL until the human component is completed.

All guardrail violations (masking, midrange_density, timbral_movement) are consistent across B-E. **No remediation is being performed.** The protocol is frozen.

**STEP 2 (architectural interpretation) and STEP 3 (approval decision) are deferred** until:
1. The blind listening session is conducted.
2. H5 and the H6 human component are computed.
3. All H1-H6 statuses are final.

In Step 2, there is no automatic approval. Every decision about CompositionEvent, VoiceSpecification, performance compiler, acoustic compiler, and the backend will be a separate human decision based on the results, effect sizes, and complexity cost.

---

## Frozen Artifacts

The following artifacts are saved as FROZEN experiment output and will not be modified:

- `validation/renders/` — 45 WAV files
- `validation/results/frozen-units.json` — 9 frozen CompositionEvent[] arrays
- `validation/results/metrics.json` — all 15 metrics for all 45 renders
- `validation/results/hypotheses.json` — H1-H6 results (H5 and H6 final = PENDING)
- `validation/results/effect-report.md` — this document
- `validation/listening/blind-renders/` — 45 blind renders (hashed filenames)
- `validation/listening/rating-sheet.csv` — empty, awaiting listener ratings
- `validation/listening/playlist.m3u` — randomized playback order
- `validation/listening/key.json` — secret mapping (do not view until ratings complete)
- `validation/listening/INSTRUCTIONS.md` — blind listening protocol
- `audit-reports/PSY4-PRE-RENDER-SNAPSHOT.md` — frozen protocol

**No thresholds, metrics, seeds, normalization, guardrails, or decision rules have been changed. No rerender. No remediation. No architectural changes.**
