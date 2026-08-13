# PSY4 — Final Validation Lock-In Protocol

**Status:** CONDITIONAL APPROVAL — implement vertical proof only.
**NOT APPROVED:** final architecture (CompositionEvent, VoiceSpec, Performance Compiler, Acoustic Compiler are all validation-only until proven).
**Predecessor:** `PSY4-VALIDATION-FIRST-LOCK-IN.md` (amended by this document)
**Date:** 2024-08-12

This document locks the 4 final conditions, defines the complete experiment protocol (thresholds fixed before any render), confirms the 5 Foundation GAPs remain unfilled, and states the final approved boundary.

---

## The 4 Final Conditions — Locked

### Condition 1 — B → C must be representation-only

**Locked:** B and C receive exactly the same musical input. The ONLY difference is the path:

```
B: Foundation output → renderer (raw)
C: same Foundation output → CompositionEvent → VoiceSpecification → same renderer
```

**C must NOT receive musical information that B did not.** If C receives more information (e.g., tension, barContext) that B ignored, then B→C doesn't isolate the contract's value — it tests "more info helps", which is trivially true and useless.

**Implementation rule:** B receives the FULL Foundation output (notes with step/midi/velocity/durationSteps + MusicalContext). B's renderer reads what it needs (step, midi, velocity, durationSteps) and ignores the rest. C's path reads the same Foundation output, builds CompositionEvent + VoiceSpec from it, and feeds the SAME renderer. The renderer in B and C is identical. The ONLY difference is whether the renderer is fed directly or via the CompositionEvent → VoiceSpec path.

**Verification:** the CompositionEvent must contain ONLY fields derivable from Foundation's actual output. No external information, no inferred musical labels (role/scaleDegree/harmonicRole are PSY4 derivations from Foundation's actual fields, not new information). If a CompositionEvent field cannot be derived from Foundation's actual output, it doesn't exist in the validation.

### Condition 2 — CompositionEvent is a temporary validation representation

**Locked:** The 6 fields (step, midi, durationSteps, velocity, barContext, sourceMaterial+trackName) are an EXPERIMENTAL SCHEMA, not architecture. If the experiment shows some are unnecessary, they are deleted. No field is ratified until A/B/C/D/E proves it earns its place.

**Post-experiment decision tree:**
- If H2 passes (C > B): the contract path adds value. SOME fields in CompositionEvent are useful. Inspect which fields the C path actually consumed — keep those, drop the rest.
- If H2 fails (C ≈ B): the contract path adds no value. CompositionEvent is dropped entirely. PSY4 consumes Foundation output directly.

**No commitment now to any specific field being permanent.**

### Condition 3 — Experiment protocol locked before any render

**Locked:** The complete protocol below is frozen BEFORE any A/B/C/D/E render runs. Thresholds are NOT changed after seeing results.

### Condition 4 — The 5 Foundation GAPs remain unfilled

**Locked:** The 5 fields identified in the Foundation report (velocity as performance intent / articulation / microtiming offset / dynamics curve / timbral character) remain GAPs for this validation.

- CompositionEngine is NOT changed to provide them.
- If D or E requires information Foundation doesn't actually provide, mark GAP and continue WITHOUT inventing that information.
- D/E use what Foundation actually provides. If a realization step can't be done because the information is missing, that step is skipped or uses a flat default — and the GAP is logged in the results.

---

## Experiment Protocol (Frozen Pre-Render)

### Inputs

| Parameter | Value | Reason |
|---|---|---|
| **Number of compositions** | 3 | Enough to avoid single-composition fluke, small enough to keep rendering + listening feasible. |
| **Composition sources** | (1) Foundation-generated 4-bar phrase (kick+bass+lead, psytrance, 145 BPM). (2) Foundation-generated 8-bar phrase (same). (3) Hand-encoded 4-bar MIDI matching the "rolling_bass" preset pattern (for direct comparison to existing AUDIT artifacts). | Mix of Foundation-generated and hand-encoded ensures we test both "Foundation's music" and "known MIDI". |
| **Number of seeds** | 3 per composition (seeds 1, 2, 3) | Tests robustness across randomness in Foundation generators + voice functions. |
| **Total renders** | 3 compositions × 3 seeds × 5 variants (A/B/C/D/E) = 45 renders | Manageable in ~1-2 hours of rendering. |
| **BPM** | 145 (all compositions) | Locked. Psytrance standard. |
| **Arrangement** | Composition 1: 4 bars. Composition 2: 8 bars. Composition 3: 4 bars. | Locked per composition. |
| **Notes** | Whatever Foundation generates (compositions 1, 2) or the hand-encoded pattern (composition 3). | Identical across A/B/C/D/E within each (composition, seed). |
| **Sample rate** | 44100 Hz, mono | All renders identical. |
| **Reference WAV** | One commercial psytrance snippet (~10s), used ONLY for the `reference_similarity` metric. Not used as a target for any synthesis decision (no reference-informed params). | Isolates the architecture from reference-matching. |

### Same input guarantee (Condition 1)

For each (composition, seed):
- Foundation generates the musical material ONCE.
- A/B/C/D/E all consume the SAME Foundation output.
- A: current psyLive consumes raw MIDI (converted from Foundation's step/midi).
- B: refactored renderer consumes the SAME Foundation output (step/midi/velocity/durationSteps + MusicalContext) directly.
- C: CompositionEvent built from the SAME Foundation output → VoiceSpec → same renderer as B.
- D: same as C + performance realization (computed FROM Foundation's actual velocity/tension/density, NOT from invented fields).
- E: same as D + acoustic compilation (computed FROM Foundation's actual BPM + barContext + step alignment).

**No variant receives information another variant didn't.** The only difference is the processing path.

### Metrics — 15 objective + blind listening

#### Objective metrics (measured by librosa on each render)

| # | Metric | Direction "better" | Normalization | Target range (psytrance) |
|---|---|---|---|---|
| 1 | pitch_correctness | higher | 0-1 (fraction of frames where detected f0 matches notated midi within ±50 cents) | >0.95 |
| 2 | scale_correctness | higher | 0-1 (fraction of note onsets on scale tones) | >0.98 |
| 3 | kick_clarity | higher | crest factor of kick-only render, normalized 0-1 (3-6 → 1.0, <3 or >6 → 0) | 0.7-1.0 |
| 4 | bass_definition | higher | 0-1 (spectral centroid 180-400Hz → 1.0, outside → linear falloff) | >0.6 |
| 5 | kick_bass_separation | higher | 0-1 (gap RMS <0.01 → 1.0, >0.1 → 0) | >0.7 |
| 6 | masking | lower | 0-1 (frequency overlap 40-200Hz between kick and bass; 0% overlap → 0, >50% → 1) | <0.3 |
| 7 | transient_quality | higher | 0-1 (onset strength >0.5 AND attack 0.5-3ms → 1.0, falloff) | >0.6 |
| 8 | spectral_balance | higher | 0-1 (Euclidean distance to commercialReference 7-band target, normalized) | >0.7 |
| 9 | midrange_density | higher | 0-1 (200-2500Hz energy %; 8-18% → 1.0, outside → falloff) | >0.5 |
| 10 | dynamic_range | higher | 0-1 (DR 6-9dB → 1.0, <6 or >9 → falloff) | >0.5 |
| 11 | loudness | higher | 0-1 (LUFS -10 to -14 → 1.0, outside → falloff) | >0.6 |
| 12 | stereo_width | higher | 0-1 (mid-side ratio above 200Hz; >0.3 → 1.0, 0 → 0) | >0.5 |
| 13 | phase_coherence | higher | 0-1 (cross-correlation kick/bass; <0.3 → 1.0, >0.7 → 0) | >0.6 |
| 14 | timbral_movement | higher | 0-1 (spectral flux std over time, normalized) | >0.4 |
| 15 | reference_similarity | higher | 0-1 (1 - normalized spectral distance to reference) | >0.5 |

#### Aggregate computation

```
aggregate_score = mean(metric_1, metric_2, ..., metric_15)
```

All 15 metrics normalized to 0-1 with "higher = better" direction. Aggregate is the simple mean. **No weighting.** Weighting would introduce subjective priors. Simple mean is the most defensible aggregate.

**Note:** aggregate_score is used for H6 (overall) only. H1-H4 use per-metric thresholds (≥N metrics improve by ≥X%), not the aggregate. This prevents one metric's huge improvement from masking others' regressions.

### Blind listening protocol (formal acceptance criterion)

#### Setup
- Listener: the user (or a designated listener with psytrance familiarity).
- Stimuli: all 45 renders (3 compositions × 3 seeds × 5 variants), unlabeled, filename = random SHA hash.
- Order: randomized per listener, with mandatory breaks every 9 renders (to prevent ear fatigue).
- Playback: same level-matched volume (LUFS-matched to -16 LUFS playback gain), same headphones/speakers, same room.

#### Task per trial
1. Listen to the render.
2. Rate 4 dimensions on 1-5 Likert scale:
   - Kick quality (1=terrible, 5=commercial)
   - Bass quality (1-5)
   - Lead quality (1-5)
   - Mix quality (1-5)
3. Rate overall: "Does this sound like commercial psytrance?" (1=no, 5=yes)
4. Free-text note (optional): what's wrong / what's good.

#### After all 45 trials
- Reveal the labels.
- For each (composition, seed): rank A/B/C/D/E by overall rating.
- Compute: does the human ranking match the DSP aggregate ranking?

#### Acceptance
- **H5 (critic-ear alignment):** for ≥70% of (composition, seed) pairs, the human top-2 and DSP top-2 overlap by ≥1. If <70% → H5 rejected.
- **H6 (overall):** E rated ≥4 on "commercial" by the listener for ≥2 of 3 compositions. If not → H6 rejected.

### Pass/fail per hypothesis (FROZEN — do not change after results)

| Hypothesis | Test | Pass | Fail |
|---|---|---|---|
| **H1 (backend)** | B vs A across 9 (composition, seed) pairs | ≥6 of 9 pairs: B improves ≥3 of 15 metrics by ≥10% AND B regresses no metric by >10% | <6 of 9 pairs meet threshold |
| **H2 (contract)** | C vs B across 9 pairs | ≥6 of 9 pairs: C improves ≥2 of 15 metrics by ≥5% AND C regresses no metric by >10% | <6 of 9 pairs meet threshold |
| **H3 (performance)** | D vs C across 9 pairs | ≥6 of 9 pairs: D improves ≥2 of 15 metrics by ≥5% AND D regresses no metric by >10% | <6 of 9 pairs meet threshold |
| **H4 (acoustic)** | E vs D across 9 pairs | ≥6 of 9 pairs: E improves ≥2 of 15 metrics by ≥5% AND E regresses no metric by >10% | <6 of 9 pairs meet threshold |
| **H5 (critic-ear)** | human ranking vs DSP ranking across 9 pairs | ≥7 of 9 pairs: human top-2 ∩ DSP top-2 ≥ 1 | <7 of 9 pairs |
| **H6 (overall)** | E vs A across 9 pairs + human "commercial" rating | ≥6 of 9 pairs: E aggregate > A aggregate by ≥10% AND listener rates E ≥4 "commercial" for ≥2 of 3 compositions | either fails |

### Thresholds are FROZEN

- 10% improvement threshold for H1, H6.
- 5% improvement threshold for H2, H3, H4.
- 3-metric / 2-metric counts.
- 6-of-9 / 7-of-9 pair counts.
- 70% alignment for H5.
- 4-of-5 Likert for "commercial".

**These do not change after seeing results.** If the results are borderline, they're borderline — we report honestly, not adjust thresholds to pass.

---

## The 5 Foundation GAPs — Remain Unfilled

| GAP field | Status in validation | If D/E needs it |
|---|---|---|
| velocity as performance intent (vs raw 0-1) | GAP. Foundation has `velocity: number` (0-1). PSY4 uses it as-is. | D uses Foundation's raw velocity. No "performance realization" beyond scaling the raw value. |
| articulation | GAP. Foundation has no articulation field. | D derives articulation from role + velocity threshold (PSY4 computation). NOT a Foundation field. |
| microtiming offset | Foundation has `RhythmPattern.micros?: number[]` (fractional steps). This IS Foundation-provided. | D uses `micros` if present. If absent (e.g., MotifNote has no micros), D uses flat 0 offset. GAP logged. |
| dynamics curve | GAP. Foundation has `MusicalContext.tension` and `density` (0-1 per bar) but no per-note dynamics curve. | D uses bar-level tension/density. No per-note curve. GAP logged. |
| timbral character | GAP. Foundation has no timbral field. | E has no timbral target from Foundation. Uses genre defaults from codebook. GAP logged. |

**CompositionEngine is NOT changed.** If D/E can't do something because the information is missing, that step is skipped or uses a flat default. The GAP is logged in the results report. We do NOT invent information to fill the gap.

---

## Final Approved Boundary

```
Foundation actual output
    ↓
validation representation (CompositionEvent — temporary, 6 fields, not ratified)
    ↓
PSY4 (VoiceSpec builder — temporary DTO, not ratified)
    ↓
renderer (Web Audio OfflineAudioContext + AdvancedSynthVoice + samples + refactored voices)
    ↓
objective metrics (15 DSP, librosa) + blind listening (formal acceptance)
```

**Only after the results do we decide whether CompositionEvent, VoiceSpec, Performance Compiler, or Acoustic Compiler deserve to stay.**

---

## What This Is

- **APPROVED:** implement the vertical proof (A/B/C/D/E, 45 renders, 6 hypothesis tests, blind listening).
- **APPROVED:** temporary validation representations (CompositionEvent 6 fields, VoiceSpec DTO).
- **APPROVED:** Web Audio + AdvancedSynthVoice + samples as the single backend for the proof.
- **APPROVED:** refactor voice functions to accept VoiceSpec (minimal, for the proof only).

## What This Is NOT

- **NOT APPROVED:** final architecture ratification.
- **NOT APPROVED:** CompositionEvent as the long-term contract.
- **NOT APPROVED:** VoiceSpecification as the long-term API.
- **NOT APPROVED:** Performance Compiler or Acoustic Compiler as permanent modules.
- **NOT APPROVED:** any optimizer, Mutator, Decision, SuperCollider, UI, or Foundation changes.
- **NOT APPROVED:** filling the 5 Foundation GAPs by changing CompositionEngine.

---

## Implementation Scope (Final)

| Component | LoC | Status |
|---|---|---|
| A (current psyLive) | 0 | exists |
| B (refactored renderer, raw Foundation input) | ~300 | new (refactor voice functions to accept raw params from Foundation output) |
| C (CompositionEvent + VoiceSpec path, codebook defaults) | +150 | new (temporary validation representation) |
| D (+ performance realization from Foundation actual fields) | +200 | new (uses Foundation's velocity/tension/density/micros — no invented fields) |
| E (+ acoustic compilation from Foundation BPM + barContext + step alignment) | +200 | new (BPM-aware envelopes, masking budgets, voiceGroup from beat alignment) |
| Render script (45 renders, deterministic) | ~100 | new |
| Critic script (15 metrics + aggregate) | ~150 | new (Python/librosa) |
| Blind listening protocol (WAV hashing, randomization, rating sheet) | ~50 | new |
| **Total** | **~1150 LoC** | |

**~1150 LoC. 1-2 weeks. No optimizer. No architecture ratification.**

---

## Post-Experiment Decision

Only AFTER all 45 renders are measured and blind listening is complete:

1. **Report all 6 hypothesis results honestly.** No threshold adjustment.
2. **If H1 passes:** backend (AdvancedSynthVoice + samples + refactored voices) is worth keeping. Inspect which voices improved most.
3. **If H2 passes:** inspect WHICH CompositionEvent fields the C path actually consumed. Keep only those. Drop the rest.
4. **If H2 fails:** drop CompositionEvent entirely. PSY4 consumes Foundation output directly.
5. **If H3 passes:** inspect which performance realizations helped. Keep only those.
6. **If H3 fails:** drop Performance Compiler. Use flat defaults.
7. **If H4 passes:** inspect which acoustic targets helped. Keep only those.
8. **If H4 fails:** drop Acoustic Compiler. Use hardcoded envelopes.
9. **If H5 fails:** STOP. The critic is misaligned with human perception. Redesign critic before any optimizer. This is the most important result — if the critic can't be trusted, no automatic optimization is possible.
10. **If H6 fails:** STOP. The whole approach doesn't work. Reconsider from scratch.

**No abstraction is ratified until it earns its place in the experiment.**

---

## HARD STOP — END OF FINAL LOCK-IN

**Verdict:**
- ✅ **APPROVE — implement the vertical proof only** (A/B/C/D/E, 45 renders, 6 hypotheses, blind listening, frozen thresholds).
- ❌ **DO NOT APPROVE — final architecture.** CompositionEvent, VoiceSpec, Performance Compiler, Acoustic Compiler are validation-only. They survive only if the experiment proves them.
- ❌ **DO NOT APPROVE — Foundation changes.** The 5 GAPs remain unfilled. CompositionEngine is untouched.
- ❌ **DO NOT APPROVE — optimizer / Mutator / Decision / SC / UI.** Out of scope.

**Final boundary:**
```
Foundation actual output → validation representation → PSY4 → renderer →
objective metrics + blind listening → decide which abstractions survive
```

No code written yet. No Foundation changes. No architecture ratified. Protocol frozen. Awaiting confirmation to begin implementation.
