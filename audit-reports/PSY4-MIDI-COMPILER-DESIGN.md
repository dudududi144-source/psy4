# PSY4 — MIDI → Commercial Audio Compiler

**Design document — no code written.**
**Date:** 2024-08-12
**Predecessor:** `audit-reports/PSY4-AUDIO-QUALITY-CRISIS-VERDICT.md`
**Status:** Awaiting user decision.

This document answers the user's 10 questions about whether PSY4 can be evolved from "a synth that plays MIDI" into "a closed-loop compiler that turns raw MIDI into commercial-grade audio". It also challenges the idea where challenge is due.

---

## TL;DR — The 30-second verdict

| Question | Verdict |
|---|---|
| Is MIDI → Commercial Audio Compiler feasible? | **Yes for kick/bass. Partially for lead. No for full mix without human checkpoint.** |
| Best architecture? | **7-layer pipeline (MI → PI → SI → SG → Render → Critic → Mutator). Hierarchical search — mutate one layer at a time.** |
| Source of truth? | **MusicalIntent, not MIDI and not the critic. MIDI is one realization; the critic measures convergence.** |
| How does the system know B > A? | **Multi-dimensional critic with targeted weak-dimension reporting. B is accepted if it improves the targeted dimension ≥5% without regressing others >10%.** |
| Deterministic vs search? | **80% deterministic (analysis + codebook + render + DSP critic). 20% search (synth params + sample selection). Do NOT search MusicalIntent by default.** |
| Which synthesis engine? | **Web Audio for the inner loop (fast, deterministic, integrated). SuperCollider only for the final premium render.** |
| Existing asset reuse? | **~70% exists. AdvancedSynthVoice, commercialReference, multisampleGenerator, AudioFeatureExtractor, real samples — all reusable.** |
| What's missing? | **~2000-2500 LoC: loop controller, Sound Intent → SynthFamily codebook, multi-dim critic extensions, mutation operators, articulation model.** |
| Smallest MVP? | **MVP-1: kick sample selection loop. ~300 LoC, 1-2 days. Proves the architecture end-to-end.** |
| Can we reach commercial quality? | **Kick/bass: yes. Lead: sound yes, musicality partially. Full mix: 70-80% automatic, last 20-30% needs human judgment.** |

---

## 1. Is the idea feasible?

### Yes, with three caveats the previous gates ignored.

**Caveat 1 — The critic is the bottleneck, not the synth.**

The whole closed-loop approach lives or dies on the critic. If the critic measures "spectral balance matches target" but not "this sounds like music", the optimizer will produce spectrally-correct music that sounds dead. **This is exactly what happened in F22**: DSP metrics passed, sound didn't improve. The metrics were substitutes for listening.

The critic can reliably measure: spectral balance, transient quality, masking, dynamics, loudness, separation, stereo, timbral movement, spectral distance to reference. These are DSP quantities.

The critic CANNOT reliably measure (without a learned model): phrase coherence, rhythmic groove, tension/release, articulation quality, "musicality". These require proxy metrics that correlate imperfectly with human judgment.

**Feasibility verdict by voice:**
- **Kick**: HIGH confidence. Critic is reliable (spectral match, transient, masking). Search space is small (sample selection + sub synth params).
- **Bass**: HIGH confidence. Critic is reliable (filter movement, separation, masking). Search space is moderate (3-layer params + filter envelope).
- **Lead**: MEDIUM confidence. The techniques exist (FM/wavetable via AdvancedSynthVoice). The critic is weak on "lead musicality" — proxy metrics (timbral movement, contour coherence) correlate imperfectly. The loop will improve SOUND but may not reliably improve MUSICALITY.
- **Full mix**: LOW confidence for fully automatic. Interactions between voices (masking, phase, dynamics) are too complex. Human-in-loop every 10-20 iterations is the realistic model.

**Caveat 2 — The search space is enormous without strong priors.**

If we let the loop mutate MusicalIntent + Performance + SynthesisGraph jointly, the search space is ~10^65. No optimization will converge.

The solution: **strong priors do most of the work.** The Musical Intelligence layer (deterministic analysis), the Performance Intelligence layer (heuristic generation from GrooveState), and the Sound Intent → SynthFamily codebook (deterministic mapping) together produce a baseline that's already 80% of the way to commercial quality. The search polishes the last 20%.

**Caveat 3 — Goodhart's law will eat the loop if you let it.**

> "When a measure becomes a target, it ceases to be a good measure." — Goodhart's law

If the loop optimizes the critic's measurable dimensions, it WILL find ways to inflate the scores without improving the actual sound. Examples:
- Spectral balance target → boost/cut EQ to match the target curve, ignoring whether the result sounds natural.
- Transient sharpness target → make the click louder, ignoring whether the body is still audible.
- Loudness target → compress more, ignoring whether dynamics die.

**Mitigation:** use the critic's measurable dimensions as optimization targets ONLY within constraint thresholds (no clipping, no DC, on-scale, in-phrase). Use the critic's "musical" dimensions as CONSTRAINTS (must be above threshold) not as optimization targets. Don't collapse to a scalar prematurely — use Pareto front exploration.

---

## 2. The architecture I propose

### 7-layer pipeline with hierarchical search.

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer 0: INPUT                                                  │
│   raw MIDI + (optional) reference WAV + (optional) Sound Intent │
└──────────────────────────────┬──────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 1: MUSICAL INTELLIGENCE  (deterministic analysis)         │
│   key/scale detection · harmony analysis · phrase segmentation  │
│   voice role assignment · rhythm grid · tension curve           │
│   → MusicalIntent (canonical representation)                    │
└──────────────────────────────┬──────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 2: PERFORMANCE INTELLIGENCE  (heuristic + small search)   │
│   velocity humanization · microtiming (swing+humanize)          │
│   articulation (legato/staccato/accent) · note length           │
│   glide/portamento · phrase-level automation (filter sweeps)    │
│   → Performance (per-note performed MIDI + automation curves)   │
└──────────────────────────────┬──────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 3: SOUND INTELLIGENCE  (codebook + search refinement)     │
│   Sound Intent (descriptors OR inferred from MusicalIntent)     │
│     → SynthFamily (fm / wavetable / subtractive / sample / ...) │
│       → SynthesisGraph (oscillators, filters, modulation, env)  │
└──────────────────────────────┬──────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 4: RENDER  (deterministic)                                │
│   SynthesisGraph + Performance → AudioBuffer (PCM)              │
│   Web Audio OfflineAudioContext (inner loop)                    │
│   SuperCollider NRT (final premium render only)                 │
└──────────────────────────────┬──────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 5: CRITIC  (multi-dimensional measurement)                │
│   DSP dimensions: spectral · transient · masking · dynamics ·   │
│                   loudness · separation · stereo · timbral-mvmt │
│   Musical dimensions (proxy): harmony · phrase-coherence ·      │
│                   rhythm · tension/release · articulation       │
│   → CriticReport {per-dim scores, weak-dimension, explanation}  │
└──────────────────────────────┬──────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 6: MUTATOR  (targeted mutation, one layer at a time)      │
│   Read weak-dimension from CriticReport                         │
│   Mutate the layer that affects that dimension:                 │
│     masking weak    → mutate SynthesisGraph (kick/bass freq)    │
│     transient weak  → mutate SynthesisGraph (kick click/body)   │
│     movement weak   → mutate SynthesisGraph (lead LFO/FM)       │
│     coherence weak  → mutate Performance (articulation)         │
│     (never auto-mutate MusicalIntent without user approval)     │
└──────────────────────────────┬──────────────────────────────────┘
                               ▼
                       (loop back to Layer 4)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 7: DECISION  (Pareto-aware KEEP/REJECT)                   │
│   B accepted if: improves targeted dim ≥5%                      │
│                  AND no other dim regresses >10%                │
│                  AND all constraints satisfied                   │
│   Track Pareto front across all dimensions                      │
│   Human checkpoint every N iterations                           │
└─────────────────────────────────────────────────────────────────┘
```

### Why hierarchical (one layer at a time)?

If we mutate all layers simultaneously, the search space is ~10^65 and no optimizer converges. By mutating ONE layer at a time — chosen by which dimension the critic flagged as weakest — we:
1. Reduce the search space per iteration to ~10^5 - 10^10 (manageable for CMA-ES / Bayesian opt).
2. Get interpretable mutations ("we improved masking by changing the kick sub frequency").
3. Avoid compensatory mutations (where one layer's improvement is undone by another layer's change).

### Why MusicalIntent is invariant in the loop?

The user's MIDI defines what the music IS. The loop optimizes HOW it sounds, not WHAT it is. If the loop mutated the MusicalIntent, you'd lose the user's composition. The MusicalIntent is fixed unless the user explicitly invokes "auto-improve MIDI" mode (which requires approval per mutation).

---

## 3. Source of truth — MusicalIntent, not MIDI and not the critic

### The four candidates

| Candidate | Case for | Case against |
|---|---|---|
| MIDI | It's what the user gave us | Same MusicalIntent can be realized as different MIDIs (different timings, velocities, even different note choices within harmony). MIDI is one instance, not the canonical form. |
| MusicalIntent | Captures the musical content (key, harmony, phrase, rhythm) independent of realization | Requires an analysis step to extract from MIDI; if analysis is wrong, everything downstream is wrong. |
| SoundIntent | Captures the sonic goal | Sound serves the music, not the other way around. A "bright aggressive lead" is meaningless without knowing it's for a climax phrase in a phrygian-dominant piece. |
| SynthesisGraph | Most concrete — it's what gets rendered | Too low-level. Same SoundIntent can be realized by different SynthesisGraphs (FM vs wavetable for "metallic"). |
| Critic scores | Measures quality | Measures CONVERGENCE, not INTENT. The critic is a thermometer, not a thermostat setpoint. |

### My answer: MusicalIntent is the source of truth, with layered derivatives.

```
MusicalIntent  (source of truth — invariant in the loop)
    │
    ├─→ Performance   (derivative — mutable within MusicalIntent constraints)
    │
    ├─→ SoundIntent   (derivative — inferred from MusicalIntent OR user-specified)
    │
    └─→ SynthesisGraph (derivative — lowest layer, fully mutable)
```

**Why MusicalIntent and not MIDI:**
- The same MusicalIntent can be realized as different MIDIs (swing vs straight, legato vs staccato, velocity contour variations). The MIDI is one instance.
- If the critic says "this performance is bad", the system should be able to generate a different performance of the same MusicalIntent — not reject the user's composition.
- The MusicalIntent is what survives across renders. The MIDI is regenerated each iteration from MusicalIntent + Performance.

**Why MusicalIntent and not the critic:**
- The critic measures how well a render matches (MusicalIntent + commercial targets). The critic doesn't define what's good — it measures convergence.
- If the critic were the source of truth, the loop would optimize the critic, not the music. This is Goodhart's law.

**Why MusicalIntent and not SoundIntent:**
- Sound serves the music. "Aggressive lead" is meaningful only in context (a climax phrase, a dark scale, a specific BPM). The MusicalIntent provides the context that gives SoundIntent its meaning.

**Critical implication:** the system needs a robust MusicalIntent extractor (Layer 1). If the user's MIDI is ambiguous (key unclear, phrase structure not marked), the extractor must pick the most likely interpretation AND flag the ambiguity. The user can override.

---

## 4. How exactly does the system know B is better than A?

### Three approaches, ranked by usefulness.

**Approach 1 — Scalar score (NOT recommended alone)**
- Collapse all critic dimensions to one number. B > A if score(B) > score(A).
- Problem: collapses tradeoffs. B might be better on masking but worse on transients.
- Use case: final ranking when you need a single "best".

**Approach 2 — Pareto dominance (useful for exploration)**
- B dominates A if B is ≥ A on all dimensions AND > A on at least one.
- Problem: most pairs are incomparable (B better on some, worse on others).
- Use case: explore the Pareto front, then pick based on priority.

**Approach 3 — Targeted weak-dimension mutation (THE actual loop logic)**
- The critic identifies the WEAKEST dimension of A (e.g., "masking = 0.4, target < 0.2").
- The mutator targets that dimension (mutates the SynthesisGraph params that affect masking).
- B is accepted if:
  1. B improves the targeted dimension by ≥ 5%.
  2. B does not regress any other dimension by > 10%.
  3. B satisfies all hard constraints (no clipping, no DC, on-scale, in-phrase).
  4. B's aggregate score (weighted sum of optimization dimensions) is ≥ A's.

### The CriticReport data structure

```typescript
interface CriticReport {
  // Per-dimension scores (0-1, higher = better)
  dimensions: {
    spectral_balance: number;      // DSP — distance to commercial target curve
    transient_quality: number;     // DSP — onset strength + attack time
    kick_clarity: number;          // DSP — transient-to-body ratio
    bass_separation: number;       // DSP — gap RMS between kick and bass
    masking: number;               // DSP — frequency overlap between voices
    dynamics: number;              // DSP — DR within target range
    loudness: number;              // DSP — LUFS within target range
    stereo_width: number;          // DSP — width above 200Hz, mono below
    timbral_movement: number;      // DSP — spectral flux over time
    similarity_to_target: number;  // DSP — spectral distance to reference
    
    // Musical dimensions (proxy metrics — used as CONSTRAINTS, not optimization targets)
    harmony_adherence: number;     // notes on scale, chord tones on strong beats
    phrase_coherence: number;      // motif recurrence, contour shape consistency
    rhythmic_quality: number;      // syncopation, swing consistency
    tension_release: number;       // density/register/dissonance curve shape
    articulation: number;          // note length vs notated, legato detection
  };
  
  // The weakest dimension (optimization target for next iteration)
  weakest: { dimension: string; score: number; gap_to_target: number };
  
  // Constraints (must be satisfied)
  constraints: {
    no_clipping: boolean;
    no_dc_offset: boolean;
    on_scale: boolean;
    in_phrase: boolean;
  };
  
  // Explanation (for human review)
  explanation: string;  // e.g., "masking is weak (0.40 vs target 0.80). 
                         //  kick sub (48Hz) and bass root (55Hz) share critical band."
  
  // Aggregate score (weighted sum of optimization dimensions only)
  aggregate: number;
}
```

### Why this works

- The critic tells you WHAT to fix (weakest dimension).
- The mutator knows WHICH layer affects that dimension (masking → SynthesisGraph kick/bass frequency).
- B is accepted only if the fix worked AND nothing else broke.
- The user sees the explanation ("we changed the kick sub from 48Hz to 50Hz and the bass root from 55Hz to 73Hz to reduce masking").

### The honest limitation

The critic's musical dimensions (harmony_adherence, phrase_coherence, rhythmic_quality, tension_release, articulation) are PROXY METRICS. They correlate with human judgment but aren't perfect. The optimizer will optimize the proxy, not the actual quality, IF you let it.

**Mitigation:** use musical dimensions as CONSTRAINTS (must be above threshold), not as optimization targets. Only optimize on DSP dimensions where the metric is reliable. For musical dimensions, the heuristic generation in Layers 1-2 must ensure they start good; the loop doesn't try to improve them.

---

## 5. Deterministic vs search — the 80/20 split

### Deterministic (no search, ~80% of the quality)

| Component | Why deterministic |
|---|---|
| Layer 1: Musical Intelligence | Key/scale detection, harmony analysis, phrase segmentation have correct answers (or small answer sets). Use deterministic algorithms. |
| Layer 2: Performance Intelligence (heuristic part) | Swing, microtiming, accent — deterministic given GrooveState. The GrooveState itself is learned (from radio) but at any given moment it's a fixed input. |
| Layer 3: Sound Intent → SynthFamily codebook | "aggressive+metallic → FM family with 2:1 ratio". A codebook of ~50 rules. Deterministic. |
| Layer 4: Render | Same SynthesisGraph + Performance → same audio. Deterministic. |
| Layer 5: Critic DSP measurements | FFT is deterministic given the audio. |

### Search/optimization (~20% of the quality, the polish)

| Component | Search method | Search space |
|---|---|---|
| Layer 3: SynthesisGraph params (continuous) | CMA-ES or Bayesian optimization | ~20-50 params per voice |
| Layer 3: Sample selection (discrete) | Exhaustive or greedy | 130 kick samples, 50 hats, etc. |
| Layer 2: Performance params (continuous) | Grid or random search | velocity humanization amount, microtiming amount — small space |
| Layer 2: Articulation choices (discrete) | Exhaustive or greedy | legato/staccato per note — small space |
| Layer 1: MusicalIntent mutations (OPTIONAL) | Human-approved only | N/A in default mode |

### The rule

- **Get the deterministic layers right first.** If the baseline (before any search) isn't already 80% of the way to commercial quality, the search won't save you. The baseline is: MusicalIntent analysis + GrooveState performance + Sound Intent codebook + AdvancedSynthVoice default params.
- **Search only the continuous params within a SynthFamily.** Don't search across families (FM vs wavetable) — that's the codebook's job.
- **Never search MusicalIntent by default.** The user's composition is fixed. If they want auto-improve, they enable it explicitly, and each mutation requires approval.

### Why not gradient descent / differentiable DSP?

DDSP (Google Magenta) and torchsynth make the synth differentiable and gradient-descend through a spectral loss. Theoretically optimal. But:
1. Requires reimplementing the synth in PyTorch. We'd lose AdvancedSynthVoice, the sample bank, the real drum samples.
2. Limited to what the differentiable synth supports (DDSP is harmonic+noise, not FM/wavetable).
3. Spectral loss has known issues (phase ambiguity, transient misalignment).
4. Black-box — can't explain why a param changed.

**Verdict:** DDSP is the right approach for academic synth inversion, but overkill for PSY4. CMA-ES + Web Audio is slower per-iteration but doesn't require reimplementing the synth, supports any Web Audio technique, and is debuggable.

---

## 6. Which synthesis engine?

### The loop's hard constraints

1. **Programmatically controllable** — set params, render, get PCM.
2. **Deterministic** — same params → same audio (else the critic chases noise).
3. **Fast** — render 4 bars in <5 seconds, for 10-100 iterations.
4. **Technique coverage** — FM, wavetable, subtractive, samples, modulation.
5. **Analyzable** — deterministic output so critic measurements are stable.

### Candidate comparison for the LOOP (not the final render)

| Engine | Programmable | Deterministic | Speed (4 bars) | Technique coverage | Verdict for loop |
|---|---|---|---|---|---|
| **Web Audio (OfflineAudioContext)** | ✅ TypeScript native | ✅ | ~1s | FM (osc→AudioParam), wavetable (PeriodicWave), samples, modulation. No PolyBLEP/Moog without AudioWorklet. | **USE FOR INNER LOOP** |
| **SuperCollider (scsynth NRT)** | ✅ OSC + Python | ✅ | ~0.3s | Full DSP language. PolyBLEP, Moog, granular, spectral. | Use for FINAL PREMIUM render only |
| **pedalboard + VST3** | ✅ Python | ✅ | ~2s | Depends on VST3. Dexed=FM, Surge=wavetable. | Too slow per-iter; param format varies per plugin |
| **DDSP / torchsynth** | ✅ Python/PyTorch | ✅ | ~0.5s | Limited (harmonic+noise for DDSP) | Wrong techniques; loses existing assets |

### Recommendation

- **Inner loop: Web Audio.** Use `AdvancedSynthVoice` (already in repo, 4 modes: classic/fm/supersaw/wavetable) for the lead. Use a refactored `psyLive.ts` bass() that accepts SynthesisGraph params. Use sample playback for kick/hats/perc. Render via `OfflineAudioContext` from `web-audio-api` (already proven in F22).
- **Final premium render: SuperCollider.** Once the loop has found good SynthesisGraph params, render the final version with SC for higher quality (PolyBLEP osc, Moog ladder filter, better granular). This is a one-shot render, not part of the loop. SC is also the right choice if the loop hits Web Audio's quality ceiling on the lead voice.
- **Don't use external engines for the loop.** The loop needs 10-100 iterations. Web Audio does this in seconds. SC is faster but adds the sclang/OSC complexity to every iteration. VST3 hosts are too slow per-render.

### The decision rule for "when to escalate to SC"

If, after 50 iterations of Web Audio loop, the lead's `timbral_movement` and `similarity_to_target` scores plateau below the commercial target by >20%, escalate: port the lead voice to SC (using the same SynthesisGraph params as a starting point) and continue the loop in SC. This is a one-time escalation per voice, not a runtime switch.

---

## 7. Existing PSY assets — what can be reused?

| Component | Existing asset | Status | Reuse plan |
|---|---|---|---|
| **Musical Intelligence** | `MusicalObservation.ts`, `HarmonicState.ts`, `PhraseEngine.ts`, `GrooveState.ts`, `TensionState.ts`, `ContinuousMusicalState.ts` | Mostly built (F17-F21) | Wire as Layer 1. Add: voice role assignment, phrase structure inference from raw MIDI. |
| **Performance Intelligence (heuristic)** | `GrooveState` (swing, microtiming, accentMap, ghostMap), `PhraseDevelopmentState` | Partial | Add: articulation model (legato/staccato), glide/portamento, phrase-level automation (filter sweeps, volume swells). |
| **Sound Intent → SynthFamily codebook** | (none) | MISSING | Build new. ~50 rules mapping (role + descriptors) → (synth family + arch params). ~300 LoC. |
| **SynthesisGraph: FM/wavetable/supersaw lead** | `AdvancedSynthVoice.ts` (756 LoC) | Built, DEAD (not imported by live path) | Wire as Layer 3 lead voice. The 4 modes (classic/fm/supersaw/wavetable) cover most psytrance lead archetypes. |
| **SynthesisGraph: subtractive bass** | `psyLive.ts` bass() (lines 550-607) | Built, live | Refactor to accept SynthesisGraph params (currently reads from Variant + SynthRecipe). Add: filter envelope that REOPENS per note, upper harmonic LFO layer. |
| **SynthesisGraph: sample-based kick** | `multisampleGenerator.ts` + `sampleBank.ts` + 130 real samples in `public/samples/real/` | Built, DEAD | Wire as Layer 3 kick voice. The sample selector picks the sample whose features best match the SoundIntent + reference. |
| **SynthesisGraph: layered voice constructor** | `layerEngine.ts` (259 LoC) | Built, DEAD | Wire as Layer 3 multi-layer voice constructor (kick = sub + body + click; bass = sub + mid + character). |
| **Render** | `f22-audio-reality.ts`, `OfflineAudioContext` from `web-audio-api` | Works | Use as Layer 4. Already produces real PCM WAVs. |
| **Critic: DSP measurements** | `AudioFeatureExtractor.ts` (304 LoC) | Partial | Extend with: masking analysis (frequency overlap between voices), stereo width, timbral movement (spectral flux), similarity to reference. |
| **Critic: commercial targets** | `commercialReference.ts` (454 LoC) | Built, DEAD | Wire as Layer 5 target database. Per-genre targets for LUFS, crest, 7-band spectral balance, kick/bass/lead params. |
| **Mutation / Optimization** | (none) | MISSING | Build new. CMA-ES or Bayesian optimization for continuous params; greedy/exhaustive for sample selection. ~500-700 LoC. |
| **SoundDNA** | `SoundDNA.ts` (25+ features) | Built, used as recipe (broken — see F22) | REPURPOSE per user's instruction: use as TARGET/DESCRIPTOR/IDENTITY representation, NOT as synth recipe. The SynthesisGraph is stored separately. |
| **Closed-loop controller** | (none) | MISSING | Build new. The thing that decides what to mutate, runs the loop, tracks Pareto front, decides KEEP/REJECT. ~500 LoC. |
| **Forensic renderer** | `forensic/offlineRenderer.ts` | Built | Use for debug renders and human A/B listening. |
| **Foundation CompositionEngine** | `MusicalSession.ts` | Built | Use as Layer 1+2 in "generate" mode (when no MIDI input — PSY4 generates from MusicalIntent directly). |
| **Real drum samples** | 130+ files in `public/samples/real/` (909, MD, Nord kicks/hats/perc/snare/clap/stab/tom/ride) | Present, UNUSED | Wire as Layer 3 sample bank for kick/hats/perc/stabs. |
| **wavetable.ts** | `src/lib/studio/dsp/wavetable.ts` | Built | Use for wavetable-mode lead voice. |

### Reuse summary

- **~70% of the components exist.** The main missing pieces are the loop controller, the codebook, the multi-dim critic extensions, and the mutation operators.
- **~8.3k LoC of dead synth code** (advancedVoice, multisampleGenerator, layerEngine, commercialReference) can be wired in. This is the single biggest immediate win.
- **130+ real drum samples** are on disk and unused. Sample-based kick is the fastest path to commercial-quality kick.

---

## 8. What's completely missing?

| Missing component | LoC estimate | Why it's needed |
|---|---|---|
| **Closed-loop controller** | 500 | The thing that decides what to mutate, runs the loop, tracks Pareto front, decides KEEP/REJECT. The brain of the system. |
| **Sound Intent → SynthFamily codebook** | 300 | Maps semantic descriptors (aggressive, metallic, organic, dark, movement, bite) to synth family + arch params. ~50 rules. |
| **Multi-dimensional Critic extensions** | 400 | Extends AudioFeatureExtractor with: masking analysis, stereo width, timbral movement (spectral flux), phrase coherence proxy, tension/release proxy, similarity to reference (beyond spectral — rhythmic/melodic similarity). |
| **Mutation operators** | 300 | Per-layer mutation strategies. SynthesisGraph param mutation (CMA-ES). Sample selection mutation (greedy). Performance param mutation (grid). |
| **Articulation model** | 200 | Legato/staccato/accent decisions per note. Glide/portamento. |
| **Phrase-level automation** | 200 | Filter sweeps, volume swells, stereo movement over a phrase. |
| **Pareto front tracker + decision logic** | 200 | Multi-objective optimization support. Tracks non-dominated candidates. |
| **MusicalIntent extractor (from raw MIDI)** | 200 | Key/scale detection (if not provided), phrase segmentation (if not marked), voice role assignment (which track is kick/bass/lead). |
| **SynthesisGraph schema + serializer** | 150 | The data structure that Layer 3 outputs and Layer 4 consumes. Must be serializable (for caching, SC porting, debugging). |
| **CriticReport schema + explainer** | 150 | The data structure that Layer 5 outputs. Includes human-readable explanation. |

**Total missing: ~2400 LoC.** Not 10,000. The user's instruction "I don't want you to build another 10,000 lines of DSP before we know the architecture is right" is respected.

---

## 9. The smallest MVP that proves it works

### MVP ladder — 4 stages, each proves one more thing.

#### MVP-1: Kick sample selection loop (1-2 days, ~300 LoC)

**Proves:** the closed-loop architecture works end-to-end for the simplest case.

- Input: MIDI (4-on-floor kick pattern, 4 bars) + reference kick WAV
- Layer 1: identify as kick, 4-on-floor, BPM from MIDI
- Layer 3: pick from 130 real kick samples in `public/samples/real/`
- Layer 4: render kick alone (Web Audio, sample playback + synth sub layer)
- Layer 5: critic compares to reference (spectral distance, transient, centroid, decay)
- Layer 6: try next sample if distance > threshold (greedy search over 130 samples)
- Layer 7: KEEP best

**Success criterion:** the selected kick's spectral distance to reference is < 0.2 (on a normalized 7-band vector). The user listens to the result and says "yes, that sounds like a real kick".

**Why this is the smallest:** sample selection is a discrete search (130 options), the critic is reliable for kick alone, the render is fast, no continuous param optimization needed.

#### MVP-2: Bass synth param loop (3-4 days, ~500 LoC)

**Proves:** the loop can optimize continuous synth params, not just discrete sample selection.

- Input: MIDI (rolling bass pattern, 4 bars) + reference bass WAV
- Layer 3: synth family = subtractive (3-layer: sub + mid osc + character)
- Layer 4: render bass alone
- Layer 5: critic (spectral balance, filter movement, transient, separation from a virtual kick)
- Layer 6: mutate filter envelope shape (fStart, fEnd, close time), sub/mid balance, decay times (CMA-ES, ~10 params)
- Layer 7: KEEP improvements

**Success criterion:** after 20 iterations, the bass's spectral distance to reference decreases monotonically and converges. The user listens and says "yes, that has the rolling character".

#### MVP-3: Full kick+bass loop (1 week, ~800 LoC)

**Proves:** the loop handles multiple voices and their interactions (masking).

- Input: MIDI (kick + bass, 4 bars) + reference kick+bass WAV
- Layer 3: kick = sample-based (from MVP-1), bass = subtractive synth (from MVP-2)
- Layer 4: render kick+bass together
- Layer 5: critic (kick clarity, bass separation, masking, K/B ratio, gap RMS)
- Layer 6: mutate kick sample choice AND bass params jointly (hierarchical: fix kick, search bass; fix bass, search kick; iterate)
- Layer 7: KEEP

**Success criterion:** K/B separation improves, masking decreases, both voices are clearer. The user listens and says "yes, the kick and bass are distinct".

#### MVP-4: Add lead (2 weeks, ~1200 LoC)

**Proves:** the loop can handle the lead voice, which is the hardest case.

- Input: full MIDI (kick+bass+lead, 8 bars) + reference
- Layer 3: lead = AdvancedSynthVoice (fm or wavetable mode, selected by Sound Intent codebook)
- Layer 5: critic (add: timbral movement, phrase coherence proxy, contour shape)
- Layer 6: mutate lead synth params (FM ratio, wavetable position, modulation depth, LFO rate)
- Layer 7: KEEP + human checkpoint every 10 iterations

**Success criterion:** lead's timbral movement score increases; phrase coherence maintained; full mix approaches commercial target. The user listens and says "yes, the lead has movement and character".

**Failure mode for MVP-4:** if the critic's phrase_coherence proxy is too weak, the loop may optimize timbral movement at the expense of musicality. The human checkpoint catches this. If it fails repeatedly, escalate the lead voice to SuperCollider (per §6 decision rule).

### MVP-1 is the proving step

MVP-1 is the smallest possible proof that the architecture works. It uses only existing assets (130 real samples + AudioFeatureExtractor + OfflineAudioContext) plus ~300 LoC of new loop controller code. If MVP-1 works, MVP-2 and MVP-3 follow naturally. If MVP-1 fails, the architecture is wrong and we rethink before building more.

---

## 10. Can we reach "simple MIDI in → commercial-quality audio out"?

### Honest per-voice answer

| Voice | Can the loop reach commercial quality? | Confidence | Why |
|---|---|---|---|
| **Kick** | YES | High | Sample-based + synth sub layer + reliable critic (spectral, transient, masking). 130 real samples give commercial quality immediately. Loop polishes selection. |
| **Bass** | YES | High | 3-layer subtractive synth with filter envelope + reliable critic (filter movement, separation, masking). "Rolling" character is parametric (filter LFO + upper harmonic layer). |
| **Lead** | PARTIALLY | Medium | AdvancedSynthVoice (fm/wavetable) gives the techniques. Critic is weak on "musicality" — proxy metrics correlate imperfectly. Loop improves SOUND; may not reliably improve MUSICALITY. Human checkpoint likely needed. |
| **Full mix** | 70-80% automatic | Low for fully auto | Interactions (masking, phase, dynamics) are too complex for fully automatic critic. Loop improves measurable dimensions; human judgment needed for final 20-30%. |

### The fundamental limit

The critic measures CORRELATES of musical quality, not musical quality itself. For dimensions where the correlate is strong (spectral balance → "sounds balanced"), the loop works. For dimensions where the correlate is weak (phrase coherence → "sounds musical"), the loop may optimize the proxy without improving the reality.

### The honest claim

Don't claim "fully automatic commercial quality". Claim:
- **Automatic improvement on measurable dimensions** (spectral balance, transient, masking, separation, loudness, dynamics).
- **Heuristic generation for musical dimensions** (harmony, phrase structure, rhythm) — starts good, doesn't degrade.
- **Human checkpoint for musicality** — every N iterations, present the Pareto front to the user for ear-based selection.

This is honest, achievable, and still a massive improvement over the current state (where the system produces test-tone-quality audio with no optimization at all).

---

## 11. Architectural failure modes — challenging the idea

The user asked me to find the failure modes upfront. Here are 10.

### Failure 1 — Critic-Goodhart

The loop optimizes the critic's measurable dimensions while ignoring unmeasurable musicality. Result: spectrally-correct but musically-dead audio. **This is what happened in F22.**

**Mitigation:** constraint thresholds on musical dimensions; human checkpoint; honest scope (don't claim "fully automatic").

### Failure 2 — Search space explosion

If we let the loop mutate MusicalIntent + Performance + SynthesisGraph jointly, the search space is ~10^65. No optimizer converges.

**Mitigation:** hierarchical optimization (mutate ONE layer at a time, chosen by weakest dimension). ~10^5 - 10^10 per iteration, manageable.

### Failure 3 — Local optima

The loop converges to a local optimum that's better than the start but far from global.

**Mitigation:** random restarts; Pareto front exploration (don't collapse to scalar); human-guided jumps ("try a fifth up").

### Failure 4 — Critic non-determinism

If the critic's measurements are noisy (FFT bin variance), the loop chases noise.

**Mitigation:** average critic over multiple FFT windows; deterministic FFT (fixed window, fixed hop); seed all randomness in the render.

### Failure 5 — Render non-determinism

If the render has randomness (noise buffer regenerated per render), the critic sees different audio for the same params.

**Mitigation:** seed all randomness; deterministic noise buffers (pre-generate, reuse); fix sample rate.

### Failure 6 — Over-engineered codebook

If the Sound Intent → SynthFamily codebook has 100+ rules, it becomes unmaintainable and brittle.

**Mitigation:** keep it small (~50 rules). Let the search refine within a family. The codebook picks the family; the search picks the params.

### Failure 7 — MIDI is the wrong input

If the user's MIDI is bad (wrong key, inconsistent timing, no phrase structure), no amount of synthesis optimization will fix it.

**Mitigation:** Layer 1 validates the MIDI and flags issues. "Auto-improve MIDI" mode for explicit MusicalIntent mutation, with user approval per mutation. Don't silently "fix" the user's composition.

### Failure 8 — Reference dependency

If the loop always needs a reference WAV, it can only match existing commercial tracks, not create new identities.

**Mitigation:** support two modes — "match reference" (specific WAV) and "match commercial targets" (genre targets from `commercialReference.ts`, no specific reference). The second mode is for original creation.

### Failure 9 — Stale commercial targets

Commercial psytrance in 2024 sounds different from 2010. The `commercialReference.ts` targets may be outdated.

**Mitigation:** make targets updateable; allow user to provide their own reference WAV (which overrides the genre targets).

### Failure 10 — Loop is too slow for interactive use

If each iteration takes 30 seconds (render + analyze + mutate), 100 iterations = 50 minutes. Too slow for interactive use.

**Mitigation:** render at low sample rate (22 kHz) during search, final render at 44.1 kHz; parallelize renders (run 4 OfflineAudioContexts in parallel); cache critic results for unchanged params.

---

## 12. Alternative approaches considered

### Alternative A — "Intent → Performance → Synthesis" (no MIDI input)

Instead of taking MIDI, the system takes MusicalIntent directly and generates everything. This is what PSY4's MusicalSession already does.

**Pros:** no "bad MIDI" problem; system owns the whole pipeline.
**Cons:** loses the "I have MIDI, make it sound good" use case.

**Verdict:** This is actually a better architecture for PSY4's radio-follower use case, but a worse architecture for the "MIDI → commercial audio" use case the user is asking about. **Support both** — the system can take either MIDI (analyze → MusicalIntent) or MusicalIntent (direct). Downstream layers are the same.

### Alternative B — Differentiable DSP (DDSP, torchsynth)

Make the synth differentiable, define a spectral loss, gradient-descend.

**Pros:** theoretically optimal; gradient descent is much faster than black-box search.
**Cons:** requires reimplementing the synth in PyTorch (loses AdvancedSynthVoice, sample bank, real samples); limited to what the differentiable synth supports; spectral loss has known issues; black-box (can't explain why).

**Verdict:** Right approach for academic synth inversion. Overkill for PSY4. Black-box loop (CMA-ES + Web Audio) is slower per-iteration but doesn't require reimplementing the synth, supports any Web Audio technique, and is debuggable.

### Alternative C — Imitation learning (learn from commercial tracks)

Train a model that maps (MusicalIntent, commercial audio) → (Performance, SynthesisGraph). At inference, generate directly.

**Pros:** fast at inference (no search); learns implicit knowledge.
**Cons:** requires training data (MusicalIntent ↔ commercial audio pairs, which don't exist); model may not generalize; black-box.

**Verdict:** Interesting long-term. Not viable now (no training data). Heuristic codebook + search is more transparent and works without training data.

### Alternative D — "Pure sample-based" (no synth)

Use only real samples for everything. Kick = sample, bass = sample, lead = sample, hats = sample.

**Pros:** immediate commercial quality (real samples sound real).
**Cons:** loses controllability (can't change pitch without artifacts, can't change timbre, can't do FM/wavetable); limited variation (130 kicks is a lot but not infinite); doesn't match the user's "sound architecture" requirement.

**Verdict:** Use samples for what they're good at (kick, hats, perc, stabs). Use synthesis for what it's good at (bass with filter movement, lead with FM/wavetable). Hybrid, not pure.

### Alternative E — "VST3 plugin hosting" (Surge/Dexed via pedalboard)

Use pedalboard (already installed) to host commercial VST3 plugins.

**Pros:** commercial-quality voices immediately.
**Cons:** each plugin has its own param format (not programmable generically); plugin choice is a commitment; harder to debug; slower per-iteration than Web Audio.

**Verdict:** Use for the FINAL premium render if a specific voice (e.g., lead) needs a quality boost. Not for the inner loop.

### Why the proposed architecture (7-layer + hierarchical search + Web Audio loop + SC premium) is better than the alternatives

- **vs. Alternative A (Intent-first):** supports MIDI input (the user's use case) AND Intent input (PSY4's generate mode).
- **vs. Alternative B (DDSP):** doesn't require reimplementing the synth; reuses existing assets; debuggable.
- **vs. Alternative C (Imitation learning):** works without training data; transparent; debuggable.
- **vs. Alternative D (Pure sample):** hybrid — uses samples where they're best, synthesis where it's best.
- **vs. Alternative E (VST3 hosting):** Web Audio is faster for the inner loop; VST3 only for final premium render if needed.

---

## 13. My recommendation + challenge

### Recommendation

**Build the 7-layer MIDI → Commercial Audio Compiler, starting with MVP-1 (kick sample selection loop), using Web Audio for the inner loop and SuperCollider only as a medium-term escalation for the lead voice.**

- **Phase 1 (MVP-1, 1-2 days):** kick sample selection loop. Proves the architecture.
- **Phase 2 (MVP-2, 3-4 days):** bass synth param loop. Proves continuous search.
- **Phase 3 (MVP-3, 1 week):** full kick+bass loop. Proves multi-voice + masking.
- **Phase 4 (MVP-4, 2 weeks):** add lead. Proves the hard case. Human checkpoint every 10 iterations.
- **Phase 5 (medium-term):** if lead quality plateaus, escalate to SuperCollider for the lead voice.
- **Phase 6 (long-term):** reference-listening pipeline (reference WAV → SoundDNA as target → SynthesisGraph inference → render → compare → iterate). This is where SoundDNA gets repurposed as a target/descriptor (per the user's instruction), not as a synth recipe.

### Challenge to the user

**Three things to decide before building:**

1. **Are you OK with human checkpoints?** If you want FULLY automatic commercial quality, the answer is "no, that's not achievable with current critic technology". If you're OK with human-in-loop every 10-20 iterations, the answer is "yes, achievable for kick/bass, partially for lead, 70-80% for full mix". **This is the most important decision.** Don't proceed without answering it.

2. **Are you OK with the MusicalIntent being invariant?** If you want the loop to also mutate the MIDI (not just the performance/synthesis), you need to enable "auto-improve MIDI" mode with explicit approval per mutation. If you want the MIDI sacred, the loop only optimizes performance + synthesis. **This determines whether the system is a "compiler" (MIDI in, audio out, MIDI fixed) or a "co-producer" (MIDI in, improved MIDI + audio out).**

3. **Are you OK with Web Audio for the inner loop?** If you want SuperCollider as the primary engine (not just the premium escalation), the architecture changes: live browser playback is compromised (pre-render or local server), the loop is in sclang/Python, the codebase splits into two languages. **This is a 4-6 week bet vs a 1-2 week MVP.** I recommend Web Audio for the loop and SC only for escalation, but you may disagree.

### The single sentence

**The MIDI → Commercial Audio Compiler is feasible as a 7-layer pipeline with hierarchical search, using MusicalIntent as the source of truth, a multi-dimensional critic with targeted weak-dimension mutation, Web Audio for the inner loop, and SuperCollider as a medium-term escalation for the lead voice — but only if you accept human checkpoints for musicality, keep MusicalIntent invariant in the loop, and start with MVP-1 (kick sample selection) to prove the architecture before building the rest.**

---

## HARD STOP — END OF DESIGN

No code was written. No engine was installed. This document is the deliverable.

**Awaiting user decision:**
1. Approve the 7-layer architecture?
2. Approve the MVP ladder (MVP-1 first)?
3. Answer the 3 challenge questions (human checkpoints? MusicalIntent invariant? Web Audio for loop)?
4. Or redirect to a different path?

Until the user decides, no further work will be done.
