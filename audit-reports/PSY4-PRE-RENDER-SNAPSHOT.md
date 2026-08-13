# PSY4 — Vertical Validation Pre-Render Snapshot

**Status:** FROZEN SNAPSHOT. Saved BEFORE render #1. Immutable for the duration of the experiment.
**Date:** 2024-08-12
**Source protocol:** `PSY4-VERTICAL-VALIDATION-PROTOCOL-FINAL.md`

This document is the immutable snapshot. After this point: no threshold changes, no metric definition changes, no seed changes, no normalization changes, no guardrail changes, no decision rule changes.

---

## 1. Experimental Design (Frozen)

- **n = 9** experimental units (3 compositions × 3 seeds).
- 45 renders total, but renders are NOT independent observations.
- All A/B/C/D/E inferences are paired within the same (composition, seed).

### Compositions (3)

| ID | Source | Bars | BPM | Notes |
|---|---|---|---|---|
| **comp-1** | Foundation-generated | 4 | 145 | kick + bass + lead, psytrance. Generated via Foundation's `generateBassPattern`, `generateMotif`, `fourOnFloor` + `offbeatHats`. |
| **comp-2** | Foundation-generated | 8 | 145 | Same generators, longer phrase. |
| **comp-3** | Hand-encoded MIDI | 4 | 145 | Matches the "rolling_bass" preset pattern from `psyLive.ts` PRESETS[0]. For direct comparison to existing AUDIT artifacts. |

### Seeds (3)

- **seed-1** = 1
- **seed-2** = 2
- **seed-3** = 3

Used for: Foundation generator randomness, voice function noise buffers, any other randomness in the pipeline.

### Variants (5)

| Variant | Input | Backend | Contract | Performance | Acoustic |
|---|---|---|---|---|---|
| **A** | raw MIDI from same Foundation output | current psyLive (unchanged) | none (hardcoded) | hardcoded | hardcoded |
| **B** | raw Foundation output (step/midi/velocity/durationSteps + MusicalContext) | refactored voices + AdvancedSynthVoice + samples | none (direct) | defaults | defaults |
| **C** | same Foundation output → CompositionEvent → VoiceSpec | same as B | VoiceSpec (codebook defaults) | defaults | defaults |
| **D** | same as C | same as B | VoiceSpec | realized (from Foundation velocity/tension/density/micros) | defaults |
| **E** | same as D | same as B | VoiceSpec | realized | compiled (BPM-aware envelopes + masking + voiceGroup) |

### Total renders: 9 × 5 = 45

---

## 2. Metric Definitions (Frozen)

### QUALITY METRICS (11 — contribute to aggregate, normalized 0-1, higher=better)

| # | Metric | Raw measurement | Direction | Normalization (0-1) | Target range |
|---|---|---|---|---|---|
| 1 | pitch_correctness | YIN/pYIN f0 vs notated midi, per frame | higher | fraction of frames within ±50 cents | >0.95 |
| 2 | scale_correctness | note onsets on scale tones | higher | fraction on scale | >0.98 |
| 3 | kick_clarity | crest factor of kick-only render | target range | 3-6 → 1.0; <3 or >6 → linear falloff to 0 | 0.7-1.0 |
| 4 | bass_definition | spectral centroid of bass-only render | target range | 180-400Hz → 1.0; outside → linear falloff | >0.6 |
| 5 | kick_bass_separation | gap RMS between kick and bass hits | lower raw → higher norm | <0.01 → 1.0; >0.1 → 0 | >0.7 |
| 6 | transient_quality | onset strength + attack time | higher | onset >0.5 AND attack 0.5-3ms → 1.0; falloff | >0.6 |
| 7 | spectral_balance | Euclidean distance to commercialReference 7-band target | lower raw → higher norm | dist 0 → 1.0; dist ≥ max → 0 | >0.7 |
| 8 | dynamic_range | DR meter | target range | 6-9dB → 1.0; <6 or >9 → falloff | >0.5 |
| 9 | loudness | LUFS integrated | target range | -10 to -14 → 1.0; outside → falloff | >0.6 |
| 10 | phase_coherence | cross-correlation kick/bass | lower raw → higher norm | <0.3 → 1.0; >0.7 → 0 | >0.6 |
| 11 | reference_similarity | spectral distance to reference WAV | lower raw → higher norm | 1 - normalized distance | >0.5 |

### GUARDRAIL METRICS (4 — constraint, NOT in aggregate)

| # | Metric | Raw measurement | Direction | Constraint | Hard-fail threshold |
|---|---|---|---|---|---|
| 12 | masking | frequency overlap 40-200Hz between kick and bass | lower is better | <0.3 | >0.5 |
| 13 | midrange_density | 200-2500Hz energy % | target range | 8-18% | <5% or >25% |
| 14 | stereo_width | mid-side ratio above 200Hz | target range | 0.3-0.7 | <0.2 or >0.9 |
| 15 | timbral_movement | spectral flux std over time | target range | 0.3-0.7 | <0.2 or >0.9 |

### Aggregate

```
unweighted_arithmetic_aggregate = mean(quality_metric_1, ..., quality_metric_11)
```

- Secondary/summary only.
- Does NOT override per-metric analysis.
- A regression in a single metric cannot be hidden by the aggregate.

### Guardrail violations

- Hard constraint. No "compensating" violation in another metric.
- A variant that violates any guardrail cannot pass its hypothesis, regardless of quality metric improvements.

---

## 3. Hypothesis Decision Rules (Frozen)

All comparisons paired within (composition, seed). n=9 units.

| Hypothesis | Comparison | Frozen decision rule |
|---|---|---|
| **H1 (backend effect)** | B vs A | ≥6/9 units: B improves ≥3/11 quality metrics by ≥10% AND B regresses no quality metric by >10% AND B violates no guardrail |
| **H2 (representation-path effect)** | C vs B | ≥6/9 units: C improves ≥2/11 quality metrics by ≥5% AND C regresses no quality metric by >10% AND C violates no guardrail |
| **H3 (performance realization effect)** | D vs C | ≥6/9 units: D improves ≥2/11 quality metrics by ≥5% AND D regresses no quality metric by >10% AND D violates no guardrail |
| **H4 (acoustic realization effect)** | E vs D | ≥6/9 units: E improves ≥2/11 quality metrics by ≥5% AND E regresses no quality metric by >10% AND E violates no guardrail |
| **H5 (evaluator/perception agreement)** | human ranking vs DSP ranking, 90 pairs across 9 units | mean per-unit pairwise agreement ≥70% AND ≥7/9 units have per-unit agreement ≥60% |
| **H6 (end-to-end outcome)** | E vs A + human "commercial" rating | ≥6/9 units: E aggregate > A aggregate by ≥10% AND listener rates E ≥4 ("commercial") for ≥2/3 compositions AND E violates no guardrail |

### Frozen thresholds

- 10% improvement (H1, H6)
- 5% improvement (H2, H3, H4)
- 3-metric count (H1), 2-metric count (H2/H3/H4)
- 6/9 units (H1-H4, H6)
- 70% mean + 7/9 ≥60% (H5)
- 4/5 Likert "commercial" (H6)
- Guardrail hard-fails: masking >0.5, midrange <5% or >25%, stereo <0.2 or >0.9, timbral_movement <0.2 or >0.9

**These do not change after results.** Borderline results are reported as borderline.

---

## 4. Foundation GAPs (Remain Unfilled)

| GAP field | Foundation status | If D/E needs it |
|---|---|---|
| velocity as performance intent | Foundation has `velocity: number` (0-1). PSY4 uses as-is. | D uses raw velocity. No realization beyond scaling. |
| articulation | Foundation has no field. | D derives from role + velocity threshold (PSY4 computation). GAP logged. |
| microtiming offset | Foundation has `RhythmPattern.micros` (fractional steps). `MotifNote` has no micros. | D uses micros if present; flat 0 if absent. GAP logged. |
| dynamics curve | Foundation has bar-level tension/density, no per-note curve. | D uses bar-level. GAP logged. |
| timbral character | Foundation has none. | E uses genre codebook defaults. GAP logged. |

**CompositionEngine NOT changed.** GAPs logged, not invented.

---

## 5. Same-Input Guarantee

For each (composition, seed):
- Foundation generates material ONCE.
- A/B/C/D/E all consume the SAME Foundation output.
- B receives full Foundation output; renderer reads what it needs.
- C builds CompositionEvent + VoiceSpec from SAME Foundation output → same renderer as B.
- D = C + performance realization (computed FROM Foundation's actual velocity/tension/density/micros).
- E = D + acoustic compilation (computed FROM Foundation's actual BPM + barContext + step alignment).
- **No variant receives information another variant didn't.**

---

## 6. Reference WAV

- 1 commercial psytrance snippet (~10s).
- Used ONLY for `reference_similarity` metric (metric #11).
- NOT used as a synthesis target. No reference-informed params.
- File: `audio-artifacts/VALIDATION-REFERENCE.wav` (to be sourced/recorded before render #1).

---

## 7. Renderer Configuration (Frozen)

- **Sample rate:** 44100 Hz
- **Channels:** mono
- **Backend:** Web Audio OfflineAudioContext (via `web-audio-api` npm package)
- **Voice sources:**
  - Kick: real samples from `public/samples/real/md_kick_*.wav` + `909_BD_*.wav`
  - Hats: real samples from `public/samples/real/md_hat_*.wav`
  - Perc: real samples from `public/samples/real/md_perc_*.wav`
  - Lead: AdvancedSynthVoice (4 modes: classic/fm/supersaw/wavetable)
  - Bass: refactored psyLive bass voice (3-layer: sub + mid osc + character)
- **Master chain:** EQ (lowshelf/peaking/highshelf) → compressor → master gain → safety limiter → analyser → destination
- **Determinism:** all randomness seeded; noise buffers pre-generated and reused; deterministic FFT

---

## 8. Blind Listening Protocol (Frozen)

- 45 renders, unlabeled, filename = random SHA hash.
- Randomized order per listener.
- Mandatory breaks every 9 renders.
- Level-matched playback (-16 LUFS playback gain).
- Same headphones/speakers/room.
- Per trial: 1-5 Likert on kick/bass/lead/mix + overall "commercial" + free text.
- After all 45: reveal labels, rank A/B/C/D/E per (composition, seed), compute pairwise preferences.
- H5: mean per-unit pairwise agreement ≥70% AND ≥7/9 units ≥60%.
- H6 human component: listener rates E ≥4 "commercial" for ≥2/3 compositions.

---

## 9. Reporting Structure (3 Steps, Separate)

### STEP 1 — EFFECT REPORT
- Raw measurements (all 15 metrics for all 45 renders).
- Per-unit paired comparisons.
- H1-H6 decision rule results.
- Guardrail violations.
- NO architectural language.

### STEP 2 — ARCHITECTURAL INTERPRETATION (human judgment, after all effects reported)
- H1 pass → backend change had effect. Worth complexity?
- H2 pass → CompositionEvent path had effect. Which fields consumed? Worth keeping?
- H3 pass → performance realization had effect. Worth permanent module?
- H4 pass → acoustic compilation had effect. Worth permanent module?
- H5 pass → critic aligns with ear. Trust optimizer?
- H5 fail → STOP. Redesign critic.
- H6 pass → overall approach works. Which abstractions to ratify?
- H6 fail → STOP. Reconsider.

### STEP 3 — APPROVAL DECISION (explicit, per abstraction)
For each: **APPROVE / MODIFY / ABANDON**
- CompositionEvent
- VoiceSpecification
- Performance Compiler
- Acoustic Compiler
- Backend (AdvancedSynthVoice + samples)

**No abstraction auto-ratified by hypothesis passing.**

---

## 10. Hard Boundaries (Immutable)

- ❌ No Foundation changes (CompositionEngine untouched)
- ❌ No GAP filling (5 fields remain unfilled)
- ❌ No Foundation ownership changes
- ❌ No Foundation type changes for the experiment
- ❌ No optimizer
- ❌ No Mutator
- ❌ No Decision loop
- ❌ No SuperCollider
- ❌ No UI
- ❌ No architecture refactor
- ❌ No final architecture approval (CompositionEvent + VoiceSpec are temporary validation representations)
- ❌ No threshold changes after render #1
- ❌ No metric definition changes after render #1
- ❌ No seed changes after render #1
- ❌ No normalization changes after render #1
- ❌ No guardrail changes after render #1
- ❌ No decision rule changes after render #1

---

## Snapshot Confirmation

This snapshot is saved at: `audit-reports/PSY4-PRE-RENDER-SNAPSHOT.md`

A copy will also be written to: `validation/snapshot.json` (machine-readable, for the critic script to verify against).

**After this snapshot is saved, implementation begins. No protocol changes are permitted.**

---

## Verdict

**APPROVE — START IMPLEMENTATION within this locked protocol.**

No further architecture approval needed. The goal is to produce empirical evidence under a frozen protocol and let the results determine what survives.
