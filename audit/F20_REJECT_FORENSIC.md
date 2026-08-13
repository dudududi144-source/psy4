# F20-REJECT — FORENSIC AUDIT OF MUSICAL QUALITY

**HEAD:** `9200f2e` · **Method:** Read every line of the actual generation code. Trace what happens when a note is produced.

---

## A. GROOVE / TIME RELATIONSHIP

**Q1: How is the kick generated?**
`generateKick()` (MusicalSession.ts:462) selects from `KICK_GRAMMARS` — 4 hardcoded arrays of step numbers (`[0,4,8,12]`, `[0,4,8,12,10]`, etc.). The selection is based on `section + cycle + barInPhrase`. There is no groove model — just step arrays. Velocity is humanized with `±3%` jitter on 3 fixed levels (0.95, 0.90, 0.65).

**Q2: How is bass onset timing generated?**
Bass onsets are hardcoded per strategy. E.g., `rolling` = all 16 steps, `driving` = steps 0,4,8,12, `sparse` = steps 0,8. The timing is NOT derived from the kick — it's an independent hardcoded pattern.

**Q3: How is bass timing conditioned on kick timing?**
**It is NOT.** The bass generator never reads the kick's note list. It does not know which steps the kick occupies. Both kick and bass are generated independently in `planBar()`, each with their own hardcoded patterns. The only "relationship" is that both use 4-on-floor patterns that happen to align at beats 0,4,8,12 — but this is coincidence of the hardcoded patterns, not a derived relationship.

**Q4: How is lead onset timing conditioned on kick + bass?**
**It is NOT.** The `CandidateGenerator.generateCandidate()` (CandidateGenerator.ts:92) iterates steps 0-15 and decides whether to play based on `density * (1 - restProb)` — a scalar probability. It does NOT read the kick or bass note lists. It does not know which steps have kick or bass notes. It cannot "leave holes" or "accent complementary offbeats" because it doesn't know where the holes are.

**Q5: Can the lead deliberately land BEFORE, ON, or AFTER bass/kick events?**
**NO.** The lead has no awareness of bass/kick event positions. It cannot target specific rhythmic relationships.

**Q6: Is there a shared microtiming model?**
**NO.** All notes are quantized to 16th-step positions. There is no swing, no microtiming, no human timing variation. Swing is listed as a `GrooveStrategyType` but is never applied — `RhythmGrammar.swing` is always 0.

**Q7: Is swing propagated across voices?**
**NO.** Swing doesn't exist in the runtime. The scheduler (`psyLive.ts:765`) schedules notes at exact step times from `transport.snapshot().beatTime + k * stepDur`. No swing offset is applied.

**Q8: Is there velocity/accent hierarchy shared across kick/bass/lead?**
**NO.** Each voice has its own independent velocity logic. Kick uses `baseVel ± offsets`. Bass uses `0.9 / 0.6`. Lead uses `0.75 / 0.5`. These are not coordinated — there is no shared accent map that says "beat 1 is accented across all voices."

**Q9: Can the system create a stable groove signature?**
**NO.** There is no groove identity that persists. Each bar selects kick/bass/hat patterns independently (or from strategy). There is no "groove fingerprint" that makes bar 32 recognizably the same groove as bar 1.

**Q10: Can it preserve groove while changing notes?**
**NO.** Since groove = hardcoded patterns, changing the pattern changes the groove. There is no abstraction layer that separates "groove identity" from "note content."

---

## B. HARMONY

**Q11: What determines the current harmonic center?**
`MusicalContext.rootPc` (default 9 = A) is updated by `updateFromRadio()` when `bassFreq > 50`. The update uses hysteresis (6/8 votes). But the bass frequency is a single scalar — it doesn't build a pitch-class distribution from the radio. It just maps one frequency to one root.

**Q12: What determines chord progression?**
**There is no chord progression.** There are no chords. The system uses a static scale (`phrygian-dominant`) and the bass walks through `beatDegrees` (root, fifth, third, octave) per section. This is not a chord progression — it's a bass pattern.

**Q13: What determines which scale degrees the bass uses?**
Hardcoded `beatDegrees` arrays per section (MusicalSession.ts:384-396). INTRO = `[0,0,0,0]`. CLIMAX = `[0,4,2,7]`. These are fixed — they don't adapt to learned harmony.

**Q14: What determines which scale degrees the lead uses?**
The `CandidateGenerator` samples intervals from `grammar.intervalHistogram` and applies them to `currentMidi`. It does NOT check whether the resulting note is a chord tone, passing tone, or tension tone. It just clamps to MIDI 48-72.

**Q15: Is the lead aware of chord tone vs passing tone vs tension tone?**
**NO.** There is no chord model. There is no concept of "current chord." The lead doesn't know what the bass is playing harmonically.

**Q16-18: Can the lead target chord tones, delay resolution, create tension→release?**
**NO** to all three. There is no harmonic target system. The lead resolves to root at phrase end (barInPhrase===7, step 15) — a hardcoded cadence, not an intelligent resolution.

**Q19-20: Can harmony remain stable while melody develops? Can harmony develop?**
Harmony is always stable (static root + scale). It cannot develop because there is no chord progression system. The bass degrees change per section, but this is a pattern change, not harmonic development.

---

## C. MELODIC VOCABULARY

**Q21: What is the actual representation of a motif?**
`StoredMotif` = `{ id, notes: MotifNote[], rootPc, scaleName, transform, reward, ... }`. A `MotifNote` = `{ step, midi, velocity, durationSteps, glide }`. This is a note list — not a melodic abstraction.

**Q22: Can motifs be transformed?**
Yes — `transpose`, `invert`, `retrograde`, `fragment` (primitives/motif.ts). These are classic serialist transforms. They change the note list but don't develop the musical idea.

**Q23-27: Can the system CONTINUE, DEVELOP, ANSWER, CONTRAST, RESOLVE a motif?**
**NO.** The `CandidateGenerator` generates each bar independently by sampling intervals. It does not:
- Continue a motif from the previous bar
- Develop a motif (extend, fragment, vary)
- Answer a previous phrase (call/response)
- Contrast with a previous phrase
- Resolve a previous phrase's tension

The `handleNewPhrase()` method creates a new motif or transforms an existing one, but the `CandidateGenerator` doesn't use the motif — it samples from the learned interval histogram.

**Q28-34: Preserve identity while changing rhythm? Preserve rhythm while changing contour? Transpose to new harmony? Anticipation? Pickup? Cadence? Repetition with variation?**
**NO** to all. The candidate generator produces a fresh sequence of notes each bar by sampling intervals. There is no motif preservation, no rhythmic transformation, no harmonic adaptation, no anticipation, no pickup, no cadence (except the hardcoded root on step 15 of bar 7).

**The CandidateGenerator is effectively "sample random intervals from a histogram and clamp to register."** That is not a melodic vocabulary engine.

---

## D. BASS VOCABULARY

**Q35: How many genuinely different bass behaviors exist?**
8 `BassStrategyType` values exist. But `generateStrategicBass()` (MusicalSession.ts:714) implements each as a different hardcoded note pattern. They are different patterns, not different behaviors — the synthesis is identical (sub sine + mid saw → LPF → saturation).

**Q36: Is a "strategy" a real generative algorithm or just different probabilities?**
It is **different hardcoded patterns**. `rolling` = all 16 steps. `driving` = steps 0,4,8,12. `sparse` = steps 0,8. These are static arrays, not algorithms. The "strategy" is just pattern selection.

**Q37: Can bass behave as rolling/driving/syncopated/sustained/octave/melodic/call-response/tension/resolution/pedal/chromatic?**
Some of these exist as patterns (rolling, driving, sparse, acid, melodic, tension, octave_jump). But:
- `sustained` — does not exist (bass always has decay envelope)
- `call_response` — does not exist (bass doesn't respond to anything)
- `pedal` — does not exist (bass always changes per beat)
- `resolution` — only the phrase-end walk (steps 12,14,15)

**Q38: Can bass phrase across multiple bars?**
**NO.** Each bar is generated independently. The bass doesn't know what it played in the previous bar (except `bassLastMidi` for register continuity, which is a single scalar, not a phrase).

**Q39: Does bass remember its previous phrase?**
Only `bassLastMidi` (one number) and `bassContourMomentum` (one sign). Not a phrase.

**Q40: Can bass deliberately create expectation for the next chord?**
**NO.** There is no chord system. The bass walks to fifth/octave at phrase ends, but this is a hardcoded walk, not an intentional harmonic expectation.

---

## E. LEAD/BASS RELATIONSHIP

**Q41: Does lead generation know the ACTUAL bass events before deciding its notes?**
**NO.** In `planBar()`, bass is generated first (line 357), then lead (line 364). But the lead generator (`generateLearnedLead` → `CandidateGenerator.generateCandidate`) does NOT receive the bass notes. It only reads `state.bassLastMidi` — a single scalar from the previous bar.

**Q42: Does it know bass onset positions?**
**NO.** The CandidateGenerator iterates steps 0-15 and decides play/no-play independently. It does not know which steps have bass notes.

**Q43: Does it know bass accent positions?**
**NO.**

**Q44: Does it know bass contour?**
**NO.** `bassContourMomentum` is tracked but not consumed by the lead generator.

**Q45: Does it know bass register?**
**YES** — `state.bassLastMidi` is used to avoid register collision (CandidateGenerator.ts:127). But this is a single scalar, not the full bass register.

**Q46: Does it know bass phrase role?**
**NO.**

**Q47: Can lead intentionally reinforce, complement, answer, avoid, anticipate, mirror, contrast bass?**
**NO** to all except a crude "avoid" (register collision check). The lead cannot:
- Reinforce bass rhythm (doesn't know it)
- Complement bass rhythm (doesn't know it)
- Answer bass (doesn't know the bass phrase)
- Anticipate bass (doesn't know when bass will play)
- Mirror bass rhythm (doesn't know it)
- Contrast bass rhythm (doesn't know it)

**Q48: Is this relationship learned, generated, and consumed?**
**NO.** The relationship does not exist in the generation path. `leadBassComplement` and `leadBassRegisterSeparation` are computed AFTER the notes are generated (in `StateManager.updateFromBar`) — they are observational metrics, not generative constraints.

---

## F. PHRASE DEVELOPMENT

**Q49: What is the unit of musical thought?**
There is no explicit musical thought unit. The system operates at:
- Bar level (planBar generates 16 steps)
- Phrase level (8 bars, with `BAR_ACTIONS` per bar position)
- Section level (8 phrases, with density targets)

But none of these carry musical identity or development intent. They are density/pattern containers.

**Q50-53: Where is phrase memory, identity, transformation, long-term development stored?**
- `phraseMotifs` Map — cleared at each phrase boundary
- `phraseNotes` — cleared at each phrase boundary
- `strategyHistory` — last 32 strategy sets (metadata only, no musical content)
- `GrammarBuilder` — accumulated statistics (not phrases)

There is no phrase memory that stores the actual musical content of previous phrases for development.

**Q54: Does phrase N+1 explicitly depend on phrase N?**
**NO.** The `CandidateGenerator` starts from `state.leadLastMidi` (one scalar) but does not reference the previous phrase's notes, rhythm, or contour. Each phrase is generated fresh from the interval histogram.

**Q55: Does phrase N+2 depend on N+1?**
**NO.** Same reason.

**Q56: Can the system create INTRO→ESTABLISH→DEVELOP→BUILD→CLIMAX→RELEASE→OUTRO without changing density?**
**NO.** The section arc only changes:
- Lead density (0.2 → 0.7)
- Bass beat degrees
- Hat count

This is density/parameter change, not musical development. There is no motif development, no harmonic progression, no tension curve, no thematic transformation.

---

## G. MUSICAL TENSION / RELEASE

**Q57: Is tension represented explicitly?**
Partially — `ctx.tension` is a scalar (0-1) that affects lead density and hat velocity. But it is not a musical tension model. It's just a parameter.

**Q58-61: What creates melodic, harmonic, rhythmic, arrangement tension?**
Nothing creates tension intentionally. The scalar `tension` is set from the composition arc (INTRO=0.2, CLIMAX=0.95) and smoothed. It does not arise from musical events.

**Q62: What creates release?**
The section changes to RESOLUTION (tension 0.3). This is a parameter change, not a musical release.

**Q63-64: Can the system intentionally increase tension over multiple bars? Resolve at phrase boundary?**
The tension scalar smooths toward the section target, but this is not musical tension. There is no harmonic tension (no dissonance), no melodic tension (no delayed resolution), no rhythmic tension (no polyrhythm).

---

## H. SOUND IDENTITY

**Q65: How many fundamentally different bass synthesis architectures exist?**
**1.** All bass uses: sub sine + mid saw → LPF → waveshaper. The only variation is `bassWave` (sawtooth/square), `bassCut` (300-1300Hz), `bassQ` (4-12). These are parameter variations of the same architecture.

**Q66: How many lead synthesis architectures exist?**
**1.** All lead uses: 3× oscillator (detuned) → stereo pan → LPF → waveshaper. Only `leadWave` (triangle/sawtooth/square), `leadCut`, `leadQ` vary.

**Q67-74: Does SoundDNA select oscillator architecture, layering, filter, envelope, distortion, modulation, stereo, FX chain?**
**NO.** `SoundDNA` exists as a type with 25+ fields. `mapSoundDNAToRecipe()` computes a `SynthRecipe`. But `SynthRecipe` is **never applied** to the actual voice functions. The voices (`kick()`, `bass()`, `lead()`, `hat()` in psyLive.ts) use the hardcoded `PRESETS` variant parameters. `applyLearnedTimbre()` only overrides 4 fields (`bassWave`, `bassCut`, `leadWave`, `leadCut`).

**Q75: Is the selected SoundDNA actually applied to the audio signal?**
**NO.** SoundDNA → SynthRecipe is computed but never reaches the audio graph. The voice functions don't read `SynthRecipe`.

**Q76: Or does it merely change 3-4 preset parameters?**
**YES.** Only 4 parameters are overridden. The synthesis architecture is static.

---

## I. FX / AUTOMATION

**Q77-79: Are risers, impacts, filter sweeps actual generated audio events?**
**NO.** `TransitionStrategyType` includes `riser`, `impact`, `filter_open`, `filter_close`, etc. But these are never generated as audio events. They exist only as metadata in `StrategySet.transition`. No audio is produced for transitions.

**Q80: Are delay/reverb sends musically controlled?**
**NO.** Delay and reverb are static bus effects controlled by UI sliders. They are not triggered by phrase boundaries or arrangement events.

**Q81-82: Can FX reinforce phrase boundaries? Participate in tension/release?**
**NO.** FX are always-on. They do not respond to musical events.

---

## J. COMMERCIAL-GRADE OUTPUT

**Q83: Can two generated tracks have genuinely different groove/bass/lead/harmonic/sound/arrangement identity?**
**NO.** All tracks use:
- Same synthesis architecture (1 bass, 1 lead, 1 kick, 1 hat)
- Same harmonic system (static root + phrygian-dominant)
- Same phrase structure (8 bars, hardcoded actions)
- Same arrangement arc (64-bar cycle)
- Same groove model (16th-step grid, no swing)

The only differences are: which hardcoded patterns are selected, which random intervals are sampled, and 4 synth parameters. Two tracks would sound like variations of the same preset, not different musical worlds.

**Q84-87: Can a listener identify the musical world after 8-16 bars? Maintain it for 2-5 minutes? Develop without sounding like a loop? Surprise without sounding random?**
**NO** to all four. The output sounds like a groove box with random lead noodles. There is no identifiable musical world, no maintained identity, no development, no surprising-but-coherent moments.

---

## PHASE 2 — CRITICAL ARCHITECTURAL DIAGNOSIS

### 1. REAL MUSICAL CAPABILITY
- **MusicalTransport** — zero-drift clock, continuous phase. REAL.
- **Harmonic hysteresis** — key changes require 6/8 votes. REAL but limited (single bass freq → root, no chord model).
- **Phrase continuity (leadLastMidi)** — carries one scalar across phrases. REAL but minimal.
- **Velocity humanization** — ±5% jitter. REAL but shallow.

### 2. STATISTICAL LEARNING
- **GrammarBuilder** — accumulates pitch-class histograms, interval histograms, onset patterns. These are real statistics but they are NOT musical abstractions. They are averages that lose temporal structure.
- **StrategySelector** — weighted sampling with context adjustment. Real statistics, but the "strategies" are pattern selectors, not generative algorithms.

### 3. PARAMETER VARIATION
- **Bass strategies** — 8 hardcoded patterns. Different patterns, same synthesis.
- **Lead candidate generation** — 5 candidates that differ only in density, register shift, and syncopation bias. Same generation approach.
- **Timbre profile** — maps to 4 synth parameters. Same architecture.
- **Section arc** — changes density and beat degrees. Same groove.

### 4. DEAD / DECORATIVE ABSTRACTIONS
- **SoundDNA** — 25+ fields, `mapSoundDNAToRecipe()`, `createSoundDNAFromTimbre()`. **NEVER APPLIED** to actual synthesis. Dead code.
- **SynthRecipe** — computed but never consumed by voice functions. Dead code.
- **TransitionStrategyType** — riser, impact, filter_open, etc. **NEVER GENERATED** as audio. Dead code.
- **TextureStrategyType** — dry, atmospheric, noisy, etc. **NEVER APPLIED**. Dead code.
- **GrooveStrategyType** — swing is always 0. Dead field.
- **Relational features** (bassKickAlignment, leadBassComplement) — computed after generation, never used as generative constraints. Observational only.
- **CandidateGenerator scoring** — 6 dimensions scored, but the candidates are all variations of the same interval-sampling approach. The scoring doesn't change the musical character, only the parameter mix.
- **Reward loop** — updates strategy weights by 0.002 per phrase. Statistically real but musically imperceptible.

### 5. MISSING CORE SYSTEMS
1. **GrooveEngine** — no shared timing/accent/microtiming model. Kick, bass, and lead don't know each other's rhythm.
2. **HarmonicEngine** — no chord model, no progression, no chord-tone targeting.
3. **PhraseEngine** — no motif development (CONTINUE/DEVELOP/ANSWER/CONTRAST/RESOLVE). Each bar is generated independently.
4. **RelationalCompositionEngine** — bass and lead are generated independently. Lead doesn't know bass rhythm.
5. **TensionEngine** — tension is a scalar parameter, not a musical construct.
6. **SoundIdentityEngine** — SoundDNA exists but is never applied to synthesis.
7. **ArrangementEngine** — transitions/fills/risers/impacts don't exist as audio events.
8. **MusicalVocabulary** — no reusable motifs, rhythmic cells, or melodic gestures. Only interval histograms.

---

### IS THE STRATEGY ENGINE:
**A) Multiple musical generative algorithms?**
**NO.** It is **B) One composer with different hardcoded patterns.** Each "strategy" is a different array of step numbers. The generation algorithm is identical — only the pattern data changes.

### IS THE CANDIDATE GENERATOR:
**A) True musical candidate composition?**
**NO.** It is **B) Five variations of the same underlying generator.** All 5 candidates use the same approach: sample intervals from histogram → apply contour preference → clamp to register. They differ only in `density ± 0.1`, `registerShift ± 1`, and `syncopationBias ± 0.3`. These are parameter variations, not different musical approaches.

---

## PHASE 3 — MISSING CORE MUSICAL ENGINE DESIGN

The current architecture cannot produce commercial-grade music because it lacks the fundamental musical systems. Here is what must be built:

### 1. GrooveEngine
**Purpose:** Create a shared rhythmic identity that all voices follow.

```
GrooveEngine
├── GrooveSignature: { accentMap: number[16], swing: number, microtiming: number[16] }
├── generateGroove(context) → GrooveSignature
├── Kick generates FROM groove (accentMap determines velocity + ghost notes)
├── Bass generates FROM groove (aligns onsets to kick, fills holes)
├── Lead generates FROM groove (places notes in gaps, accents complementary)
└── Groove persists across bars (identity preserved while notes change)
```

### 2. RelationalCompositionEngine
**Purpose:** Generate bass and lead as parts of the same musical phrase, not independently.

```
RelationalCompositionEngine
├── Input: kick notes, harmonic context, phrase state
├── BassGenerator
│   ├── Reads kick onset positions
│   ├── Aligns bass to kick (hits WITH kick on downbeats)
│   ├── Fills offbeats (response to kick)
│   └── Creates bass contour that supports harmonic target
├── LeadGenerator
│   ├── Reads bass onset positions (from bass just generated)
│   ├── Leaves holes where bass is busy
│   ├── Accents complementary offbeats
│   ├── Targets chord tones on strong beats
│   └── Creates tension/release relative to bass
└── Output: coordinated kick + bass + lead phrase
```

### 3. PhraseEngine
**Purpose:** Create musical development across phrases.

```
PhraseEngine
├── PhraseState: { motif, rhythm, contour, harmonicTarget, tension, role }
├── CONTINUE: extend previous phrase's motif (same identity, new notes)
├── DEVELOP: transform motif (fragment, extend, vary rhythm)
├── ANSWER: create response to previous phrase (call/response)
├── CONTRAST: create opposing phrase (different rhythm/contour)
├── RESOLVE: resolve previous phrase's tension (target chord tones)
├── EXTEND: lengthen phrase beyond expected boundary
└── ANTICIPATE: create pickup before next phrase
```

### 4. HarmonicEngine
**Purpose:** Create chord progressions and harmonic targets.

```
HarmonicEngine
├── HarmonicContext: { root, scale, currentChord, nextChord, tension }
├── ChordProgression: sequence of chords per section
├── Bass targets chord root on strong beats
├── Lead targets chord tones on strong beats, passing tones on weak
├── Tension created by non-chord tones, resolved by targeting chord tones
└── Harmonic rhythm: chord change rate per section
```

### 5. SoundIdentityEngine
**Purpose:** SoundDNA must drive actual synthesis architecture.

```
SoundIdentityEngine
├── SoundDNA → SynthRecipe → actual voice graph construction
├── Different bass families use different oscillator/filter/saturation architectures
├── Different lead families use different unison/FM/ring-mod approaches
├── SoundDNA applied at voice creation time, not just parameter override
└── Sound families persist and evolve
```

### 6. TensionEngine
**Purpose:** Musical tension as a multi-dimensional construct.

```
TensionEngine
├── Harmonic tension: dissonance level (non-chord tones, chromaticism)
├── Melodic tension: unresolved intervals, delayed resolution
├── Rhythmic tension: syncopation, polyrhythm, displacement
├── Arrangement tension: density buildup, layer addition
├── Release: resolution to chord tones, rhythmic simplification, layer removal
└── Tension curve: intentional rise/fall across phrases
```

### 7. ArrangementEngine
**Purpose:** Transitions, fills, risers, impacts as actual audio events.

```
ArrangementEngine
├── Fill: drum fill at phrase end (actual kick/snare/hat pattern)
├── Riser: noise sweep + pitch rise (actual audio generated)
├── Impact: bass + kick + reverb hit on downbeat (actual audio)
├── Filter sweep: automate filter cutoff across bars
├── Density build: add layers over 4-8 bars
├── Density release: remove layers over 4-8 bars
└── Triggered by section changes and phrase boundaries
```

---

## PHASE 4 — REAL ACCEPTANCE TESTS

### Test 1: Groove Lock
**Proof:** Lead onset positions adapt to kick + bass. Generate 32 bars. For each bar, measure the overlap between lead onsets and bass onsets. The lead should intentionally AVOID bass-busy steps and ACCENT bass-sparse steps. The overlap should be < 30% (lead plays in gaps, not on top of bass).

### Test 2: Phrase Development
**Proof:** Phrase 2 develops phrase 1. Generate 2 consecutive phrases (16 bars). Measure:
- Motif similarity (interval contour correlation > 0.4 = same identity)
- Note diversity (not identical = developed)
- Rhythmic relationship (not random = intentional)

### Test 3: Lead Targets Chord Tones
**Proof:** On strong beats (steps 0, 4, 8, 12), lead notes should be chord tones (root, third, fifth) > 70% of the time. On weak beats, passing tones are allowed.

### Test 4: Tension Curve
**Proof:** Over 32 bars (4 phrases), measure:
- Harmonic tension (non-chord tone ratio) should rise then fall
- Melodic tension (interval size) should rise then fall
- The curve should be intentional, not random

### Test 5: Sound Identity
**Proof:** Generate 2 tracks with different SoundDNA. The actual audio graph should differ:
- Different oscillator types
- Different filter architectures
- Different saturation curves
- Measured by inspecting the created AudioNodes

### Test 6: FX as Musical Events
**Proof:** At phrase boundaries, actual audio events are generated (risers, impacts). Measure:
- Additional AudioNodes created at phrase boundaries
- Filter automation (cutoff changes over time)
- Not just "density changed"

### Test 7: No Loop Collapse
**Proof:** 512 bars. Measure:
- Unique bar patterns > 200 (not repeating same 4 bars)
- Motif recurrence with controlled variation (same identity, different notes)
- Section differentiation (CLIMAX measurably different from INTRO in rhythm + harmony + density)

### Test 8: Musical World Identity
**Proof:** Generate 2 tracks with different seeds + styles. After 16 bars:
- Bass behavior is identifiable (different patterns, not just different notes)
- Lead behavior is identifiable (different contour, not just different pitches)
- Groove is identifiable (different accent pattern)
- A listener could say "these are different tracks"

---

## STOP

This audit is complete. The diagnosis is:

**The current architecture is fundamentally a parameter-variation system, not a musical intelligence.** It has:
- 1 bass synthesis architecture (not sound families)
- 1 lead synthesis architecture (not sound families)
- 1 groove model (hardcoded step arrays, no shared timing)
- 1 harmonic model (static root, no chords)
- 1 phrase model (independent bars, no development)
- 1 relational model (register avoidance only, no rhythmic/harmonic complement)
- Dead abstractions (SoundDNA, TransitionStrategy, TextureStrategy, SynthRecipe)
- A CandidateGenerator that produces 5 parameter variations, not 5 musical worlds

**Waiting for approval before implementing the core musical engine.**