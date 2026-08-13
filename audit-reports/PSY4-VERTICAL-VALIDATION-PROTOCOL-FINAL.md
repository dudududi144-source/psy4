# PSY4 — Vertical Validation Protocol (Final, Frozen)

**Status:** APPROVED — implement the vertical validation only.
**NOT APPROVED:** final architecture, Foundation changes, optimizer, Mutator, Decision, SC, UI.
**Predecessor:** `PSY4-FINAL-VALIDATION-LOCK-IN.md` (amended by these 6 corrections)
**Date:** 2024-08-12

This document is the FINAL frozen protocol. It incorporates the 6 corrections. Once confirmed, the protocol is frozen BEFORE render #1. No threshold changes after results.

---

## The 6 Corrections — Locked

### Correction 1 — H1–H4: separate EXPERIMENTAL RESULT from ARCHITECTURAL CONCLUSION

Each hypothesis reports an **effect** (experimental result under the test conditions). Architectural conclusion (whether the abstraction deserves to stay) is a SEPARATE interpretation step that happens AFTER all results are reported.

- If B > A → the backend change improved the result **in the experimental conditions**. NOT a ruling that "the backend is the correct architecture."
- If C > B → the CompositionEvent/VoiceSpec path contributed **in the experimental conditions**. NOT a ruling that "CompositionEvent should become the permanent API."

**Two-step process per hypothesis:**
1. **Report effect:** did the change improve the predefined metrics? (yes/no, with numbers)
2. **Architectural interpretation:** does this effect justify keeping the abstraction? (human judgment, considering effect size, confounds, and whether the abstraction earned its complexity)

**"Architecture validated" cannot be inferred from H1–H4 individually.** Only H6 (end-to-end) can support "the overall approach works" — and even H6 doesn't ratify specific abstractions.

### Correction 2 — H5: real rank agreement, not weak top-2 overlap

The previous rule (human top-2 ∩ DSP top-2 ≥ 1) is too weak — two nearly opposite rankings can still pass.

**New H5 rule — pairwise preference agreement:**

For each (composition, seed) unit:
- 5 variants (A/B/C/D/E) → C(5,2) = 10 pairs.
- For each pair (X, Y):
  - DSP preference: which variant has higher unweighted arithmetic aggregate?
  - Human preference: which variant was rated higher by the listener (overall "commercial" Likert)?
  - Agreement: DSP preference == human preference? (binary)
- Per-unit agreement rate = (agreeing pairs) / 10.

**H5 acceptance (FROZEN):**
- Mean per-unit agreement across 9 units ≥ 70%, AND
- ≥ 7 of 9 units have per-unit agreement ≥ 60%.

**Purpose:** detect Goodhart divergence (DSP says X > Y, ear says Y > X). If DSP and ear disagree on >30% of pairs, the critic is misaligned with perception.

### Correction 3 — Experimental unit: n = 9, not 45

- **n = 9** experimental units (3 compositions × 3 seeds).
- 45 renders exist but are NOT 45 independent observations.
- All A/B/C/D/E inferences are **paired within the same (composition, seed)**.
- Between-unit variation (different compositions, different seeds) is reported but not pooled as if independent.

**Implication:** with n=9, we cannot do formal statistical significance testing with reasonable power. We use a **predefined effect-size decision rule** (see Correction 6), not p-values.

### Correction 4 — Metrics split into QUALITY vs GUARDRAIL

Not all 15 metrics are "higher = better." Each metric is classified as either:
- **QUALITY metric** (primary, optimized, contributes to aggregate), or
- **GUARDRAIL metric** (constraint, must be in range, does NOT contribute to aggregate).

#### QUALITY METRICS (11 — contribute to aggregate)

| # | Metric | Raw measurement | Direction | Normalization (0-1, higher=better) | Target range |
|---|---|---|---|---|---|
| 1 | pitch_correctness | YIN/pYIN f0 vs notated midi | higher | fraction of frames within ±50 cents | >0.95 |
| 2 | scale_correctness | note onsets on scale tones | higher | fraction on scale | >0.98 |
| 3 | kick_clarity | crest factor of kick-only render | target range | 3-6 → 1.0; <3 or >6 → linear falloff to 0 | 0.7-1.0 |
| 4 | bass_definition | spectral centroid of bass-only render | target range | 180-400Hz → 1.0; outside → linear falloff | >0.6 |
| 5 | kick_bass_separation | gap RMS between kick and bass hits | lower raw = higher normalized | <0.01 → 1.0; >0.1 → 0 | >0.7 |
| 6 | transient_quality | onset strength + attack time | higher | onset >0.5 AND attack 0.5-3ms → 1.0; falloff | >0.6 |
| 7 | spectral_balance | Euclidean distance to commercialReference 7-band target | lower raw = higher normalized | distance 0 → 1.0; distance ≥ max → 0 | >0.7 |
| 8 | dynamic_range | DR meter | target range | 6-9dB → 1.0; <6 or >9 → falloff | >0.5 |
| 9 | loudness | LUFS integrated | target range | -10 to -14 → 1.0; outside → falloff | >0.6 |
| 10 | phase_coherence | cross-correlation kick/bass | lower raw = higher normalized | <0.3 → 1.0; >0.7 → 0 | >0.6 |
| 11 | reference_similarity | spectral distance to reference WAV | lower raw = higher normalized | 1 - normalized distance | >0.5 |

#### GUARDRAIL METRICS (4 — constraint, NOT in aggregate)

| # | Metric | Raw measurement | Direction | Constraint (must satisfy) | Guardrail (hard fail if violated) |
|---|---|---|---|---|---|
| 12 | masking | frequency overlap 40-200Hz between kick and bass | lower is better | <0.3 | >0.5 → hard fail |
| 13 | midrange_density | 200-2500Hz energy % | target range | 8-18% | <5% or >25% → hard fail |
| 14 | stereo_width | mid-side ratio above 200Hz | target range | 0.3-0.7 | <0.2 (near-mono) or >0.9 (excessive) → hard fail |
| 15 | timbral_movement | spectral flux std over time | target range | 0.3-0.7 | <0.2 (static) or >0.9 (chaotic) → hard fail |

**Guardrail metrics are pass/fail constraints.** A render that violates a guardrail is flagged regardless of its quality aggregate. The H1-H4 hypotheses check guardrails as prerequisites (a variant that violates a guardrail cannot "pass" its hypothesis even if quality metrics improve).

**No metric was added just to reach 15.** The 11+4 split reflects the actual measurement structure: 11 things we want to optimize, 4 things we want to constrain.

### Correction 5 — aggregate_score: explicit naming, secondary role

**Name:** "unweighted arithmetic aggregate" (NOT "no weighting").

**Formula:** `aggregate = mean(quality_metric_1, ..., quality_metric_11)` = mean of 11 quality metrics.

**Acknowledgment:** equal-weight mean is still a weighting of 1/11 per quality metric. Calling it "no weighting" was misleading.

**Role:** the aggregate is a **secondary / end-to-end summary**, not the sole reason to declare an abstraction successful.

- H1-H4 use **per-metric thresholds** (≥N quality metrics improve by ≥X%) as the primary decision rule.
- H6 uses the aggregate as ONE of two criteria (aggregate improvement AND human rating).
- The aggregate is reported for transparency but does not override per-metric analysis.

### Correction 6 — H6 = end-to-end outcome only; multiple comparisons acknowledged

**H6 answers ONE question:** "Is E better than A objectively AND does it sound better to the human?"

- H6 does NOT prove CompositionEvent is correct.
- H6 does NOT prove VoiceSpec is correct.
- H6 only supports the claim: "the overall approach (Foundation → validation representation → PSY4 → renderer) produces better audio than current psyLive."

**Hypothesis roles (locked):**
- H1 = backend effect
- H2 = representation-path effect
- H3 = performance realization effect
- H4 = acoustic realization effect
- H5 = evaluator/perception agreement
- H6 = end-to-end outcome (only H6 supports "overall approach works")

**Multiple comparisons acknowledgment:**
- With 11 quality metrics and n=9 paired units, we cannot do formal statistical significance testing with reasonable power.
- We use a **predefined effect-size decision rule**, NOT p-values.
- Metric-level threshold crossing is reported as "effect size meets predefined threshold," NOT "statistically significant."
- No Bonferroni/BH correction is applied (because we're not doing hypothesis testing in the statistical sense). Instead, the per-hypothesis decision rule requires MULTIPLE metrics to improve simultaneously (≥3 for H1/H6, ≥2 for H2/H3/H4), which provides implicit protection against single-metric flukes.
- This is acknowledged as a limitation: the experiment is underpowered for formal inference. Results are effect-size-based decisions, not statistical proof.

---

## Experiment Protocol (Final, Frozen)

### Experimental design

- **n = 9** experimental units (3 compositions × 3 seeds).
- **Compositions:**
  1. Foundation-generated 4-bar phrase (kick+bass+lead, psytrance, 145 BPM).
  2. Foundation-generated 8-bar phrase (same).
  3. Hand-encoded 4-bar MIDI matching "rolling_bass" preset pattern.
- **Seeds:** 1, 2, 3 per composition.
- **Variants per unit:** A, B, C, D, E (5).
- **Total renders:** 9 × 5 = 45.
- **BPM:** 145 (all).
- **Sample rate:** 44100 Hz, mono.
- **Reference WAV:** 1 commercial psytrance snippet (~10s), used ONLY for `reference_similarity` metric. NOT used as a synthesis target.

### Same-input guarantee (Condition 1, locked)

For each (composition, seed):
- Foundation generates material ONCE.
- A/B/C/D/E all consume the SAME Foundation output.
- B receives the full Foundation output; its renderer reads what it needs.
- C builds CompositionEvent + VoiceSpec from the SAME Foundation output → same renderer as B.
- D = C + performance realization (computed FROM Foundation's actual velocity/tension/density/micros).
- E = D + acoustic compilation (computed FROM Foundation's actual BPM + barContext + step alignment).
- **No variant receives information another variant didn't.**

### Same-input guarantee (Condition 1, locked)

For each (composition, seed):
- Foundation generates material ONCE.
- A/B/C/D/E all consume the SAME Foundation output.
- B receives the full Foundation output; its renderer reads what it needs.
- C builds CompositionEvent + VoiceSpec from the SAME Foundation output → same renderer as B.
- D = C + performance realization (computed FROM Foundation's actual velocity/tension/density/micros).
- E = D + acoustic compilation (computed FROM Foundation's actual BPM + barContext + step alignment).
- **No variant receives information another variant didn't.**

### 5 Foundation GAPs — remain unfilled

| GAP field | Status | If D/E needs it |
|---|---|---|
| velocity as performance intent | Foundation has `velocity: number` (0-1). PSY4 uses as-is. | D uses raw velocity. No "realization" beyond scaling. |
| articulation | Foundation has none. | D derives from role + velocity threshold (PSY4 computation). GAP logged. |
| microtiming offset | Foundation has `RhythmPattern.micros` (fractional steps). MotifNote has no micros. | D uses micros if present; flat 0 if absent. GAP logged. |
| dynamics curve | Foundation has bar-level tension/density, no per-note curve. | D uses bar-level. GAP logged. |
| timbral character | Foundation has none. | E uses genre codebook defaults. GAP logged. |

**CompositionEngine NOT changed.** GAPs are logged, not invented.

---

## Hypothesis Tests (Frozen — Pre-Render)

### Decision rules (effect-size based, not statistical significance)

All comparisons are **paired within (composition, seed)**. n=9 units.

| Hypothesis | Comparison | Decision rule (FROZEN) | Interpretation if pass |
|---|---|---|---|
| **H1 (backend effect)** | B vs A, 9 paired units | ≥6 of 9 units: B improves ≥3 of 11 quality metrics by ≥10% AND B regresses no quality metric by >10% AND B violates no guardrail | Backend change improved audio under experimental conditions. Does NOT ratify backend as "correct architecture." |
| **H2 (representation-path effect)** | C vs B, 9 paired units | ≥6 of 9 units: C improves ≥2 of 11 quality metrics by ≥5% AND C regresses no quality metric by >10% AND C violates no guardrail | CompositionEvent/VoiceSpec path contributed under experimental conditions. Does NOT ratify CompositionEvent as permanent API. |
| **H3 (performance realization effect)** | D vs C, 9 paired units | ≥6 of 9 units: D improves ≥2 of 11 quality metrics by ≥5% AND D regresses no quality metric by >10% AND D violates no guardrail | Performance realization contributed. Does NOT ratify Performance Compiler as permanent module. |
| **H4 (acoustic realization effect)** | E vs D, 9 paired units | ≥6 of 9 units: E improves ≥2 of 11 quality metrics by ≥5% AND E regresses no quality metric by >10% AND E violates no guardrail | Acoustic compilation contributed. Does NOT ratify Acoustic Compiler as permanent module. |
| **H5 (evaluator/perception agreement)** | human ranking vs DSP ranking, 90 pairs across 9 units | Mean per-unit pairwise agreement ≥70% AND ≥7 of 9 units have per-unit agreement ≥60% | DSP metrics align with human perception. If fails: critic is misaligned (Goodhart risk). STOP optimizer work. |
| **H6 (end-to-end outcome)** | E vs A, 9 paired units + human "commercial" rating | ≥6 of 9 units: E unweighted arithmetic aggregate > A aggregate by ≥10% AND listener rates E ≥4 ("commercial") for ≥2 of 3 compositions AND E violates no guardrail | The overall approach works: Foundation → validation rep → PSY4 → renderer produces better audio than current psyLive. Does NOT ratify any specific abstraction. |

### Frozen thresholds (do NOT change after results)

- 10% improvement for H1, H6.
- 5% improvement for H2, H3, H4.
- 3-metric count for H1; 2-metric count for H2/H3/H4.
- 6-of-9 units for H1-H4, H6.
- 70% mean agreement + 7-of-9 units ≥60% for H5.
- 4-of-5 Likert for "commercial" in H6.
- Guardrail hard-fail thresholds: masking >0.5, midrange <5% or >25%, stereo <0.2 or >0.9, timbral_movement <0.2 or >0.9.

**If results are borderline, they are reported as borderline.** No threshold adjustment.

---

## Blind Listening Protocol (Formal Acceptance Criterion)

### Setup
- Listener: the user (or designated listener with psytrance familiarity).
- Stimuli: 45 renders, unlabeled, filename = random SHA hash.
- Order: randomized per listener, mandatory breaks every 9 renders.
- Playback: level-matched (-16 LUFS playback gain), same headphones/speakers/room.

### Task per trial
1. Listen to the render.
2. Rate 4 dimensions on 1-5 Likert: kick quality, bass quality, lead quality, mix quality.
3. Rate overall: "Does this sound like commercial psytrance?" (1=no, 5=yes).
4. Free-text note (optional).

### After all 45 trials
- Reveal labels.
- For each (composition, seed): rank A/B/C/D/E by overall "commercial" rating.
- Compute pairwise preferences: for each of 10 pairs per unit, which variant did the human prefer?
- Compare to DSP pairwise preferences (which variant has higher aggregate?).
- Compute per-unit agreement rate, then mean across 9 units.

### H5 acceptance
- Mean per-unit pairwise agreement ≥70% AND ≥7 of 9 units have agreement ≥60%.

### H6 acceptance (human component)
- Listener rates E ≥4 ("commercial") for ≥2 of 3 compositions.

---

## Reporting Structure (Post-Experiment)

Results are reported in this order, with architectural interpretation SEPARATE from effect reporting:

### Step 1 — Effect reporting (per hypothesis)

For each of H1-H6:
- Raw measurements (all 15 metrics for all 45 renders).
- Per-unit paired comparisons.
- Effect-size decision rule result (pass/fail per hypothesis).
- Guardrail violations (if any).
- No architectural language. Just: "B improved over A on X of Y metrics by Z% in N of 9 units."

### Step 2 — Architectural interpretation (separate, human judgment)

Only AFTER all effects are reported:
- H1 pass → backend change had an effect. **Question:** is the effect size worth the complexity of AdvancedSynthVoice + samples + refactored voices? (human judgment)
- H2 pass → CompositionEvent path had an effect. **Question:** which fields did C actually consume? Are those fields worth keeping as a contract? (inspect + human judgment)
- H3 pass → performance realization had an effect. **Question:** which realizations helped? Worth a permanent Performance Compiler? (human judgment)
- H4 pass → acoustic compilation had an effect. **Question:** which acoustic targets helped? Worth a permanent Acoustic Compiler? (human judgment)
- H5 pass → critic aligns with ear. **Question:** is the alignment strong enough to trust an optimizer on top of it? (human judgment)
- H5 fail → critic misaligned. **Action:** STOP. Redesign critic before any optimizer. (mandatory)
- H6 pass → overall approach works. **Question:** which abstractions to ratify for the next phase? (human judgment, informed by H1-H4 effect sizes)
- H6 fail → overall approach doesn't work. **Action:** STOP. Reconsider from scratch. (mandatory)

### Step 3 — Ratification decision (separate, explicit)

Based on Step 2 interpretation, explicitly decide for each abstraction:
- CompositionEvent: RATIFY / DROP / MODIFY
- VoiceSpecification: RATIFY / DROP / MODIFY
- Performance Compiler: RATIFY / DROP / MODIFY
- Acoustic Compiler: RATIFY / DROP / MODIFY
- Backend (AdvancedSynthVoice + samples): RATIFY / DROP / MODIFY

**No abstraction is ratified automatically by a hypothesis passing.** Ratification is a separate human decision based on effect size, complexity cost, and whether the abstraction earned its place.

---

## Final Approved Protocol

```
Foundation actual output (unchanged, no GAPs filled)
    ↓
temporary validation representation (CompositionEvent — 6 fields, experimental schema)
    ↓
PSY4 (VoiceSpec builder — temporary DTO)
    ↓
renderer (Web Audio OfflineAudioContext + AdvancedSynthVoice + samples + refactored voices)
    ↓
objective metrics (11 quality + 4 guardrail, librosa) + blind listening (formal acceptance)
    ↓
frozen analysis (effect-size decision rules, no threshold changes)
    ↓
architectural decision (human judgment, only after results)
```

---

## Hard Boundaries (Unchanged)

- ❌ No Foundation changes
- ❌ No GAP filling (5 fields remain unfilled)
- ❌ No CompositionEngine refactor
- ❌ No optimizer
- ❌ No Mutator
- ❌ No Decision loop
- ❌ No SuperCollider
- ❌ No UI
- ❌ No final architecture approval (until results + human ratification)

---

## Implementation Scope (Unchanged)

| Component | LoC | Status |
|---|---|---|
| A (current psyLive) | 0 | exists |
| B (refactored renderer, raw Foundation input) | ~300 | new |
| C (CompositionEvent + VoiceSpec path, codebook defaults) | +150 | new (temporary) |
| D (+ performance realization from Foundation actual fields) | +200 | new (temporary) |
| E (+ acoustic compilation from Foundation BPM + barContext + step alignment) | +200 | new (temporary) |
| Render script (45 renders, deterministic) | ~100 | new |
| Critic script (11 quality + 4 guardrail + aggregate + pairwise) | ~150 | new (Python/librosa) |
| Blind listening protocol (WAV hashing, randomization, rating sheet) | ~50 | new |
| **Total** | **~1150 LoC** | |

**~1150 LoC. 1-2 weeks. No optimizer. No architecture ratification.**

---

## Confirmation

- ✅ Correction 1 locked: H1-H4 report effects, not architectural conclusions. Ratification is separate.
- ✅ Correction 2 locked: H5 uses pairwise preference agreement (90 pairs, ≥70% mean + ≥7/9 units ≥60%).
- ✅ Correction 3 locked: n=9 experimental units, all inferences paired within (composition, seed).
- ✅ Correction 4 locked: 11 quality metrics + 4 guardrail metrics. Each has raw/direction/normalization/target/classification.
- ✅ Correction 5 locked: "unweighted arithmetic aggregate" (mean of 11 quality), secondary role.
- ✅ Correction 6 locked: H6 = end-to-end outcome only. Multiple comparisons acknowledged as predefined effect-size decision rule (not statistical significance).

- ✅ Protocol frozen BEFORE render #1.
- ✅ Thresholds do not change after results.
- ✅ 5 Foundation GAPs remain unfilled.
- ✅ No Foundation changes, no CompositionEngine refactor, no optimizer, no Mutator, no Decision, no SC, no UI, no final architecture approval.

---

## Verdict

**APPROVE — IMPLEMENT THE VERTICAL VALIDATION ONLY.**

Do not build beyond this. The protocol is frozen. Architectural decisions happen only after results are reported and interpreted.

**No code written yet. Protocol frozen. Awaiting final go to begin implementation.**
