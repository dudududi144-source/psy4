# PSY4 × Foundation — Validation-First Lock-In

**Status:** CONDITIONAL APPROVAL. Architecture NOT ratified. Validation contract only.
**Predecessor:** `PSY4-FOUNDATION-RECONCILIATION-VERTICAL-PROOF.md` (revised by this document)
**Date:** 2024-08-12

This document responds to the user's conditional approval. It locks the 10 boundaries, performs the honest field-by-field mapping (marking GAPs), fixes the A/B/C/D confound, converts pass/fail to hypothesis tests, and confirms scope. No code.

---

## Verdict Change

```
WAS:  BUILD
NOW:  APPROVE — vertical validation only.
      DO NOT APPROVE — final architecture ratification.
```

The architecture hypotheses enter experimental validation. No abstraction is ratified until A/B/C/D/E proves it earns its place.

---

## The 10 Locked Boundaries

| # | Boundary | Locked |
|---|---|---|
| 1 | Foundation ownership = actual existing types + semantics. "Foundation=WHAT / PSY4=HOW" is a working principle, NOT a ruling drawn from value-units (0–1 vs ms/Hz/127). | ✅ |
| 2 | `PhrasePayload → CompositionEvent[]` is NOT assumed proven. Each field mapped to a real Foundation field below. Missing fields marked GAP — no new Foundation concepts invented to fill them. | ✅ |
| 3 | `CompositionEvent` = validation contract. NOT the final public API. Ratified only if A/B/C/D/E proves it. | ✅ |
| 4 | `VoiceSpecification` = validation DTO. NOT the final Sound Architecture. Ratified only if A/B/C/D/E proves it. | ✅ |
| 5 | A/B/C/D confound acknowledged. B changed contract AND backend. Revised to A/B/C/D/E with one-variable-per-step (see §4). | ✅ |
| 6 | Musical Physics as pure function = validation implementation choice. NOT a final architecture ruling. If it later needs cross-voice-group coordination / state / iteration, the "pure function" choice is revisited. | ✅ |
| 7 | Critic/evaluator CANNOT modify Foundation composition. Pitch / harmony / note-position / arrangement changes go back to Foundation or human. | ✅ |
| 8 | Metrics = objective DSP + perceptual blind listening. Blind A/B is a formal acceptance criterion, not decoration. DSP alone cannot declare "commercial." | ✅ |
| 9 | Pass/fail → hypothesis tests. No pre-assumption that B/C/D/E will improve. B≈A, C≈B, D≈C, E≈D are all valid experimental outcomes. The "B almost certainly better than A" claim is DELETED. | ✅ |
| 10 | Scope: vertical proof only. No optimizer, no Mutator, no Decision, no SC, no UI, no large Foundation refactor, no CompositionEngine changes, no new Foundation ownership. | ✅ |

---

## Honest Field-by-Field Mapping — CompositionEvent → Foundation Real Types

I read Foundation's actual source. Here's what exists:

**Foundation note types (verified):**
```typescript
// packages/music/src/motif.ts
interface MotifNote {
  step: number           // 16th-note step index
  midi: number           // absolute MIDI pitch
  velocity: number       // 0-1
  durationSteps: number  // duration in 16th-note steps
  glide: boolean         // portamento to this note
}

// packages/music/src/bass.ts
interface BassNote {
  step: number
  midi: number
  velocity: number
  durationSteps: number
}

// packages/music/src/rhythm.ts
interface RhythmPattern {
  hits: boolean[]
  velocities?: number[]   // 0-1 per step
  probabilities?: number[]
  micros?: number[]       // micro-timing offsets in fractional steps
}

// packages/music/src/musical-context.ts
interface MusicalContext {
  tonic: number              // root pitch class 0-11
  scaleName: string
  octave: number
  bpm: number
  beatsPerBar: number
  beatPosition: number
  barPosition: number
  phrasePosition: number     // bar within phrase
  harmonicContext: number[]  // active chord pitch classes (empty = no chord)
  density: number            // 0-1
  energy: number             // 0-1
  tension: number            // 0-1
  sectionRole: string
  repetitionPressure: number
  noveltyPressure: number
}
```

**Foundation material types (verified):**
```typescript
interface BassPatternPayload { kind: 'bass-pattern'; rootPc; scaleName; style; notes: BassNote[] }
interface DrumPatternPayload { kind: 'drum-pattern'; tracks: Record<string, RhythmPattern> }
interface PhrasePayload { kind: 'phrase'; bars: Array<{ motifId?; bassPatternId?; drumPatternId? }> }
```

### The mapping

| CompositionEvent field | Foundation source | Status |
|---|---|---|
| `time` | `MotifNote.step` / `BassNote.step` (16th-note step index) + `MusicalContext.bpm` → seconds. Step is the time unit. | **MAPPED** (step is the Foundation time unit; PSY4 converts step→seconds) |
| `midi` | `MotifNote.midi` / `BassNote.midi` (absolute MIDI pitch, already realized from degree+tonic+octave by Foundation's generators) | **MAPPED** |
| `duration` | `MotifNote.durationSteps` / `BassNote.durationSteps` (in 16th-note steps) | **MAPPED** (steps; PSY4 converts to seconds via BPM) |
| `role` | Derivable from material kind: `BassPatternPayload` → bass, `DrumPatternPayload` tracks named "kick"/"hat"/"perc" → those roles, `MotifPayload` → lead. Foundation has NO explicit `VoiceRole` enum on notes. | **PARTIAL — GAP**: Foundation has no `role` field on notes. PSY4 infers from material kind + track name. This is a derivation, not a contract field. **Action: drop `role` from CompositionEvent; PSY4 infers it from which material the note came from.** |
| `scaleDegree` | Foundation generators compute degree internally (via `degreeToMidi`) but `MotifNote`/`BassNote` store `midi`, not `degree`. To recover degree: `degree = nearestDegree(midi, tonic, scale)` (Foundation's `scales.ts` has `nearestDegree`). | **PARTIAL — GAP**: Foundation stores midi, not degree. Degree is recoverable via `nearestDegree()` but it's a PSY4 computation, not a Foundation-provided field. **Action: drop `scaleDegree` from CompositionEvent; PSY4 computes it from midi + MusicalContext.tonic + MusicalContext.scaleName using Foundation's own `nearestDegree()`.** |
| `harmonicRole` | Foundation has `MusicalContext.harmonicContext: number[]` (chord pitch classes) and `chords.ts` (chordNotes, chordPcs, chordTension). But Foundation does NOT label individual notes with their harmonic function (root/third/fifth/passing/etc). | **GAP**: Foundation knows the chord but doesn't classify notes against it. **Action: drop `harmonicRole` from CompositionEvent. PSY4 computes it from the note's pc vs `MusicalContext.harmonicContext` (is the note in the chord? is it the root? third? etc). This is a PSY4 derivation from Foundation-provided chord context.** |
| `voiceGroup` | Foundation has `PhrasePayload` (bars with motif/bass/drum IDs). Notes in the same bar share bar context. But there's no explicit "voiceGroup" concept for acoustic co-design (kick+bass on the same beat). | **GAP**: Foundation has phrase/bar structure but no acoustic voiceGroup. **Action: drop `voiceGroup` from CompositionEvent. PSY4 constructs voiceGroups from beat alignment (kick + bass on the same step → voiceGroup "step-N"). This is a PSY4 derivation.** |
| `phrasePosition` | `MusicalContext.barPosition` (bar in section), `MusicalContext.phrasePosition` (bar in phrase), `MusicalContext.beatPosition` (beat in bar). `MotifNote.step` gives the 16th-note position within the bar. | **MAPPED** (phrase index, bar in phrase, beat in bar, step in bar — all available from MusicalContext + note.step) |
| `phrasePosition.beatStrength` | Foundation has `MotifOptions.strongBeats: number[]` (e.g., [0, 8, 16, 24] = downbeats). `RhythmPattern.velocities` encodes accent as a 0-1 value. But no explicit "strong/weak/ghost" category. | **PARTIAL — GAP**: Foundation has strongBeats list + velocity values, but no categorical beatStrength. **Action: drop `beatStrength` from CompositionEvent. PSY4 derives it from: is step in strongBeats? → strong. Else velocity > 0.6 → weak. Else → ghost.** |
| `tension` | `MusicalContext.tension` (0-1, per-bar) | **MAPPED** |
| `accent` | `MotifNote.velocity` / `BassNote.velocity` / `RhythmPattern.velocities[]` (0-1). No explicit "strong/weak/ghost" category. | **PARTIAL — GAP**: Foundation provides velocity (0-1), not accent category. **Action: drop `accent` from CompositionEvent. PSY4 derives strong/weak/ghost from velocity thresholds. The velocity itself IS the Foundation intent; the category is PSY4's discretization.** |

### Revised CompositionEvent (validation contract — thinner)

After honest mapping, the contract shrinks from 10 fields to 6. The other 4 are PSY4 derivations:

```typescript
// ── VALIDATION CONTRACT (not final API) ──────────────────────────
// Foundation provides these. PSY4 consumes. Every field maps to a real
// Foundation type. No new Foundation concepts invented.

interface CompositionEvent {
  // ── FROM FOUNDATION NOTE TYPES (MotifNote / BassNote / step) ──
  step: number;              // 16th-note step index (Foundation's time unit)
  midi: number;              // absolute MIDI pitch (Foundation already realized it)
  durationSteps: number;     // duration in 16th-note steps
  velocity: number;          // 0-1 (Foundation's performance intent)

  // ── FROM FOUNDATION MusicalContext (per-bar, shared across notes in bar) ──
  barContext: {
    tonic: number;           // MusicalContext.tonic
    scaleName: string;       // MusicalContext.scaleName
    bpm: number;             // MusicalContext.bpm
    barPosition: number;     // MusicalContext.barPosition
    phrasePosition: number;  // MusicalContext.phrasePosition
    harmonicContext: number[]; // MusicalContext.harmonicContext (chord pitch classes)
    tension: number;         // MusicalContext.tension
  };

  // ── FROM FOUNDATION MATERIAL KIND (implicit) ──
  sourceMaterial: 'motif' | 'bass-pattern' | 'drum-pattern' | 'fill' | 'fx-gesture' | 'texture';
  trackName?: string;        // for drum-pattern: which track (kick/hat/perc/...)
}
```

**6 fields.** Everything else PSY4 needs, it derives:
- `role` ← from `sourceMaterial` + `trackName`
- `frequency` ← from `midi` (trivial)
- `durationSeconds` ← from `durationSteps` × `bpm`
- `scaleDegree` ← from `midi` + `tonic` + `scaleName` via Foundation's `nearestDegree()`
- `harmonicRole` ← from `midi % 12` vs `harmonicContext`
- `voiceGroup` ← from `step` alignment across materials
- `beatStrength` ← from `step` vs strongBeats + velocity threshold
- `accent` ← from `velocity` threshold

### What this means

The contract is thinner than my previous proposal claimed. Foundation provides notes (step, midi, durationSteps, velocity) + bar context (tonic, scale, bpm, chord, tension, positions) + material kind. PSY4 derives all the musical labels (role, scaleDegree, harmonicRole, voiceGroup, beatStrength, accent) from those.

**No new Foundation concepts are needed.** The GAPs are filled by PSY4 derivations, not by adding fields to Foundation. This respects boundary #2: "如果某字段没有一一对应，就标记为 GAP，而不是补一个新的 Foundation 概念。"

---

## Revised A/B/C/D → A/B/C/D/E (Controlled Experiment)

### The confound (acknowledged)

Original B changed TWO variables: contract + backend. `B - A` could not isolate contract from backend.

### The fix: one variable per step

```
A  = current psyLive (baseline — old everything)
B  = new backend + RAW MIDI (no contract, no VoiceSpec, no performance, no acoustic)
      → isolates BACKEND (AdvancedSynthVoice + samples + refactored voices)
C  = B + contract (CompositionEvent → VoiceSpec, codebook defaults, NO performance realization, NO acoustic targets)
      → isolates CONTRACT
D  = C + performance realization (velocity/microtiming/articulation from Foundation intent)
      → isolates PERFORMANCE
E  = D + acoustic compilation (BPM-aware envelopes, masking budgets, kick/bass co-design via VoiceGroup)
      → isolates ACOUSTIC
```

| Step | Changes | Isolates |
|---|---|---|
| A → B | backend only (psyLive → AdvancedSynthVoice + samples + refactored voices, fed raw MIDI) | BACKEND |
| B → C | contract only (raw MIDI → CompositionEvent → VoiceSpec, same backend, same default params) | CONTRACT |
| C → D | performance realization only (default velocity → realized velocity from Foundation intent) | PERFORMANCE |
| D → E | acoustic compilation only (hardcoded envelopes → BPM-aware + masking + voiceGroup) | ACOUSTIC |

### What each render uses

| Render | Input | Backend | Contract | Performance | Acoustic |
|---|---|---|---|---|---|
| A | raw MIDI | current psyLive | none (hardcoded) | hardcoded | hardcoded |
| B | raw MIDI | AdvancedSynthVoice + samples + refactored voices | none (note-on/note-off directly) | defaults | defaults |
| C | CompositionEvent[] | same as B | VoiceSpec (codebook defaults) | defaults | defaults |
| D | CompositionEvent[] | same as B | VoiceSpec | realized | defaults |
| E | CompositionEvent[] | same as B | VoiceSpec | realized | compiled |

### Key controls

- **B vs C**: same backend, same default params. The ONLY difference is whether notes arrive as raw MIDI or as CompositionEvent → VoiceSpec. If C > B, the contract adds value. If C ≈ B, the contract is overhead.
- **C vs D**: same contract, same backend, same acoustic defaults. The ONLY difference is whether velocity/microtiming/articulation are realized from Foundation intent or use flat defaults. If D > C, performance realization adds value.
- **D vs E**: same performance, same backend. The ONLY difference is whether envelopes are hardcoded or BPM-aware + masking-aware. If E > D, acoustic compilation adds value.

### Implementation scope (revised)

| Render | LoC | Notes |
|---|---|---|
| A | 0 | current psyLive |
| B | ~300 | AdvancedSynthVoice + sample bank + refactored voice functions (accept raw MIDI, no VoiceSpec) |
| C | +150 | CompositionEvent types + VoiceSpec types + codebook (default params, no realization) |
| D | +200 | Performance realization (velocity/microtiming/articulation from Foundation intent) |
| E | +200 | Acoustic compilation (BPM-aware envelopes + masking budgets + voiceGroup) |
| **Total** | **~850 LoC** | |

---

## Hypothesis Tests (replaces pass/fail)

### H1 — Backend hypothesis

**H1₀ (null):** B ≈ A (new backend does not measurably improve over current psyLive)
**H1₁ (alt):** B > A on ≥3 DSP metrics by ≥10%

**Test:** render A and B, measure 15 DSP metrics + blind A/B listening.
**Outcome:**
- Reject H1₀ → backend helps. Proceed to H2.
- Fail to reject H1₀ → backend doesn't help. STOP. The new synth assets (AdvancedSynthVoice, samples) don't produce better audio than current psyLive. Investigate why before proceeding.

### H2 — Contract hypothesis

**H2₀ (null):** C ≈ B (contract adds no measurable value over raw MIDI on the same backend)
**H2₁ (alt):** C > B on ≥2 DSP metrics by ≥5%

**Test:** render B and C (same backend, same default params; only difference is CompositionEvent → VoiceSpec path).
**Outcome:**
- Reject H2₀ → contract helps. Proceed to H3.
- Fail to reject H2₀ → contract is overhead. The VoiceSpec doesn't carry useful information beyond raw MIDI. **Drop the contract. Use raw MIDI → voice functions directly.** Proceed to test acoustic compilation without the contract (if possible).

### H3 — Performance hypothesis

**H3₀ (null):** D ≈ C (performance realization adds no measurable value)
**H3₁ (alt):** D > C on ≥2 DSP metrics by ≥5%

**Test:** render C and D (same contract, same backend; only difference is realized velocity/microtiming/articulation).
**Outcome:**
- Reject H3₀ → performance realization helps. Proceed to H4.
- Fail to reject H3₀ → performance realization is overhead. The Foundation intent (velocity values, microtiming offsets) doesn't translate to audible improvement. **Drop performance realization. Use flat defaults.** Proceed to H4 without it.

### H4 — Acoustic compilation hypothesis

**H4₀ (null):** E ≈ D (acoustic compilation adds no measurable value)
**H4₁ (alt):** E > D on ≥2 DSP metrics by ≥5%

**Test:** render D and E (same performance, same backend; only difference is BPM-aware envelopes + masking + voiceGroup).
**Outcome:**
- Reject H4₀ → acoustic compilation helps. Architecture validated.
- Fail to reject H4₀ → acoustic compilation is overhead. BPM-aware envelopes and masking budgets don't produce audible improvement. **Drop acoustic compilation.** The architecture is simpler than proposed.

### H5 — Critic-ear alignment hypothesis

**H5₀ (null):** DSP metrics and human ear agree on ranking (A < B < C < D < E, or whatever the DSP says)
**H5₁ (alt):** DSP metrics and human ear disagree (DSP says X > Y, ear says Y > X)

**Test:** blind A/B listening. Present all 5 renders unlabeled, in random order. Listener ranks them. Compare to DSP metric ranking.
**Outcome:**
- Fail to reject H5₀ → critic is aligned with ear. DSP metrics are trustworthy for this domain.
- Reject H5₀ → critic is misaligned. DSP metrics don't reflect perceived quality. **The critic must be redesigned before any optimizer is built on top of it.** This is the most important hypothesis. If it fails, STOP all optimizer work.

### H6 — Overall improvement hypothesis

**H6₀ (null):** E ≈ A (the full pipeline does not measurably improve over current psyLive)
**H6₁ (alt):** E > A on ≥5 DSP metrics by ≥10% AND ear confirms E sounds better

**Test:** compare E to A.
**Outcome:**
- Reject H6₀ → the pipeline works. Architecture validated. Proceed to full implementation (Phases 1-6).
- Fail to reject H6₀ → the pipeline doesn't work. The whole approach is wrong. STOP. Reconsider from scratch.

### No pre-assumption

**DELETED:** "B is almost certainly better than A."
**DELETED:** "the contract + better backend is almost certain to improve over A."

The hypotheses allow B≈A, C≈B, D≈C, E≈D, and even E≈A. The experiment's purpose is to find out which abstractions earn their place, including the possibility that none do.

---

## Metrics — Objective + Perceptual

### Objective (15 DSP metrics, measured by librosa)

pitch_correctness, scale_correctness, kick_clarity, bass_definition, kick_bass_separation, masking, transient_quality, spectral_balance, midrange_density, dynamic_range, loudness, stereo_width, phase_coherence, timbral_movement, reference_similarity.

### Perceptual (blind A/B listening — FORMAL acceptance criterion)

- 5 renders (A/B/C/D/E), unlabeled, randomized order.
- Listener: the user (or a designated listener).
- Task: rank from best to worst. Identify: best kick, best bass, best lead, best mix. Verdict: "does the best one sound like commercial psytrance?"
- **The system CANNOT declare success based on DSP metrics alone.** If DSP says E > A but the ear says E ≈ A or E < A, the experiment FAILS (H5 rejected).
- This is per the user's boundary #8 and the cited research (objective metrics ≠ human perception in music evaluation).

### Why both

Research on musical audio evaluation (including the cited "Musical Source Separation Bake-Off" work) shows objective metrics and human perception diverge. DSP metrics are necessary (they tell you WHAT changed) but not sufficient (they don't tell you if it SOUNDS better). Blind listening is the perceptual ground truth.

---

## Scope (confirmed)

### In scope
- A/B/C/D/E renders (~850 LoC)
- CompositionEvent validation contract (6 fields)
- VoiceSpecification validation DTO
- VoiceSpec builder (codebook + performance realization + acoustic targets, all as pure functions for now)
- Refactored voice functions (accept VoiceSpec)
- Render script (OfflineAudioContext)
- Critic script (librosa + blind listening protocol)

### Out of scope (hard freeze)
- ❌ CMA-ES / Bayesian / Pareto optimizer
- ❌ Mutator / Decision loop
- ❌ SuperCollider
- ❌ Sound Genome persistence
- ❌ CompositionEngine changes (Foundation untouched)
- ❌ New Foundation ownership (no new Foundation concepts)
- ❌ UI changes
- ❌ Producer mode
- ❌ Large refactor of psyLive (only voice functions refactored to accept VoiceSpec)
- ❌ Final architecture ratification (everything is validation-only until proven)
- ❌ MusicalPhysicsEngine (pure function for validation; revisited if it needs state)
- ❌ Genre porting (psytrance only)
- ❌ Live browser integration (offline render only)

---

## Risks (revised)

| Risk | Mitigation |
|---|---|
| H1 fails (backend doesn't help) | AdvancedSynthVoice or samples are broken/low quality. Test them in isolation first. |
| H2 fails (contract doesn't help) | The VoiceSpec codebook defaults are too similar to raw MIDI note-on/note-off. Make the codebook produce meaningfully different params. Or accept that the contract is overhead and drop it. |
| H3 fails (performance doesn't help) | Foundation's velocity/microtiming intent doesn't translate to audible differences. Check if the realization is actually changing the params (not just computing them and discarding). |
| H4 fails (acoustic doesn't help) | BPM-aware envelopes and masking budgets aren't being enforced in the synth params. Check if the acoustic targets actually constrain the VoiceSpec. |
| H5 fails (critic-ear misalignment) | DSP metrics don't reflect perceived quality. Redesign critic before any optimizer. This is the most critical risk. |
| AdvancedSynthVoice is rotten (F15 code) | Test in isolation before the proof. If broken, fall back to simpler lead voice (3-osc unison + FM via AudioParam). |
| Render non-determinism | Seed all randomness. Pre-generate noise buffers. Verify by rendering B twice and diffing. |
| Scope creep | Hard freeze. The proof is A/B/C/D/E only. Anything else is a separate phase. |

---

## Kill Criteria (revised)

1. **H1 fails** (B ≈ A) → backend doesn't help. Stop. Investigate AdvancedSynthVoice + samples quality.
2. **H2 fails AND H4 fails** (contract and acoustic both don't help) → the architecture is over-engineered. Ship B (backend only) if it passed H1. Stop architecture work.
3. **H5 fails** (critic-ear misalignment) → critic is broken. STOP all optimizer work. Redesign critic.
4. **H6 fails** (E ≈ A) → the full pipeline doesn't work. STOP. Reconsider from scratch.
5. **AdvancedSynthVoice broken AND can't fix in 1 day** → fall back to simpler voice. If simpler voice also fails H1 → escalate to SC or reconsider backend.
6. **Render non-determinism can't be fixed** → A/B/C/D/E comparison invalid. STOP. Fix renderer.
7. **Proof takes >2 weeks** → scope creep. STOP. Re-scope.

---

## What Happens After the Proof

### If H6 passes (E > A, ear confirms)

→ Architecture validated. Proceed to Phase 1: add full 24-dim critic + Mutator (CMA-ES) + Decision (Pareto). Ratify CompositionEvent and VoiceSpecification as the contract (they earned it).

### If H1 passes but H2 fails (backend helps, contract doesn't)

→ Drop the contract. Use raw MIDI → voice functions directly. The architecture is simpler: Foundation → raw MIDI → refactored voice functions (with codebook params) → render → critic. Proceed to Phase 1 without CompositionEvent/VoiceSpec.

### If H1-H4 pass but H5 fails (DSP says better, ear says worse)

→ Critic-Goodhart. Redesign critic before building any optimizer. The DSP metrics are measuring the wrong things. This is the most important failure mode — it means we can't trust automatic optimization at all.

### If H6 fails (E ≈ A)

→ The whole approach is wrong. STOP. Reconsider whether Foundation's music + PSY4's synthesis can produce commercial-quality audio at all, or whether a fundamentally different approach is needed (e.g., pure sample-based, or SC from the start).

---

## Confirmation

- ✅ BUILD changed to **conditional approval / validation-first**
- ✅ 10 boundaries locked
- ✅ Field-by-field mapping done honestly (4 MAPPED, 5 PARTIAL/GAP → contract shrunk to 6 fields, derivations moved to PSY4)
- ✅ A/B/C/D confound fixed → A/B/C/D/E (one variable per step)
- ✅ Pass/fail → hypothesis tests (H1-H6, null hypotheses allowed)
- ✅ "B almost certainly better" DELETED
- ✅ Blind A/B listening = formal acceptance criterion (not decoration)
- ✅ Musical Physics = pure function for validation only (not final ruling)
- ✅ CompositionEvent + VoiceSpecification = validation contract/DTO only (not final API)
- ✅ Foundation CompositionEngine untouched, no new Foundation ownership
- ✅ Scope: vertical proof only (~850 LoC, 1-2 weeks)

**No code written. No Foundation changes. No architecture ratified.**

The next step is to implement the A/B/C/D/E proof under these locked boundaries, then run the hypothesis tests, then decide which abstractions to ratify based on evidence.

---

## HARD STOP — END OF LOCK-IN

Awaiting final confirmation to proceed with implementation under these locked boundaries.
