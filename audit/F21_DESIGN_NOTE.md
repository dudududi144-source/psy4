# F21 DESIGN NOTE — FORENSIC DESIGN BEFORE IMPLEMENTATION

**HEAD:** `9200f2e` · **Status:** Approved, Phase 1-3 only.

---

## 1. What exactly is currently generating each kick/bass/lead/chord?

**Kick** (`MusicalSession.generateKick`, line 462):
Selects from `KICK_GRAMMARS` — 4 hardcoded arrays of step numbers. The selection is `(section, cycle, barInPhrase)` → index into array. Velocity = `baseVel ± offsets ± jitter`. No groove model, no shared timing.

**Bass** (`MusicalSession.generateBass`, line 532):
If `currentStrategies` exists → `generateStrategicBass()` (hardcoded step arrays per strategy name). Else if learned grammar exists → `generateLearnedBass()` (samples from interval transition matrix). Else → hardcoded `beatDegrees` per section. The bass NEVER reads the kick's note list.

**Lead** (`MusicalSession.generateLead`, line 994):
If learned melodic grammar exists → `generateLearnedLead()` → `CandidateGenerator.generateCandidates()` → 5 candidates, each samples intervals from `grammar.intervalHistogram`, applies contour preference, clamps to register 48-72. Best candidate selected by score. The lead NEVER reads the kick or bass note lists.

**Chords/Harmony**:
Do not exist. There is a static `rootPc` (0-11) and `scaleName` ('phrygian-dominant'). No chord model, no progression, no harmonic function.

## 2. Where is the current lead disconnected from rhythm?

In `planBar()` (line 392-410):
```
this.generateKick(notes, snap, barInPhrase, bar);  // kick notes added to `notes`
this.generateBass(notes, snap, barInPhrase);        // bass notes added to `notes`
this.generateLead(notes, snap, motif, barInPhrase, action, leadDensity);  // lead notes added to `notes`
```

The lead generator receives `notes` (the shared array) but **only pushes to it — it never reads from it**. The `CandidateGenerator.generateCandidate()` (line 72) receives `grammar, ctx, state, barInPhrase, density` — none of which contain the kick or bass note positions.

The only connection is `state.bassLastMidi` (a single scalar from the previous bar) used for register collision avoidance (CandidateGenerator.ts:127). This is not a rhythmic relationship — it's a pitch-register check.

## 3. What exact state will survive phrase boundaries?

Currently surviving:
- `state.leadLastMidi` (one scalar)
- `state.bassLastMidi` (one scalar)
- `state.bassContourMomentum` (one sign: -1/0/+1)
- `state.leadContourMomentum` (one sign)
- `GrammarBuilder` accumulated statistics (histograms, not phrases)
- `StrategySelector` weights (adjusted by reward)

Currently NOT surviving (wiped at phrase boundary):
- `phraseMotifs` Map (cleared)
- `phraseNotes` array (cleared)
- The actual notes/rhythm/contour of the previous phrase

**After F21 Phase 1-3, what WILL survive:**
- `GrooveState`: accentMap[16], swing, velocityProfile[16] — the groove identity
- `HarmonicState`: currentChord, harmonicFunction, nextChord, tension — the harmonic context
- `PhraseDevelopmentState`: parentPhraseId, motifId, developmentOperator, previousPhraseNotes, previousPhraseRhythm, previousPhraseContour — the motif lineage
- `TensionState`: harmonicTension, melodicTension, rhythmicTension, registerTension, densityTension — multi-dimensional tension
- The actual note content of the previous phrase (for CONTINUE/DEVELOP/ANSWER)

## 4. How will PhraseDevelopmentState transform P(n) → P(n+1)?

```
P(n) = { motifId, notes: [{step, midi, vel}], rhythm: [16 booleans], contour: [directions], harmonicTarget, tensionLevel }

PhraseDevelopmentState at phrase boundary:
  1. Select development operator based on phrase position + tension:
     - bar 0-7 (phrase 0): CONTINUE (establish)
     - bar 8-15 (phrase 1): DEVELOP (transform motif)
     - bar 16-23 (phrase 2): ANSWER (create response)
     - bar 24-31 (phrase 3): CONTRAST (opposing)
     - bar 32-39 (phrase 4): DEVELOP (further transform)
     - bar 40-47 (phrase 5): BUILD (increase tension)
     - bar 48-55 (phrase 6): CADENCE (resolve)
     - bar 56-63 (phrase 7): RESOLVE (final resolution)

  2. Apply operator to P(n) → P(n+1):
     CONTINUE: same motif, extend by 1-2 notes, same rhythm
     DEVELOP: fragment motif (keep first 60%), transpose intervals by ±1 scale degree
     ANSWER: invert contour, same rhythm, complementary register
     CONTRAST: different rhythm (syncopated vs straight), different contour direction
     BUILD: increase density, raise register, add intervals
     CADENCE: target chord tones, reduce density, descend to root
     RESOLVE: root on strong beats, minimal notes, low register

  3. P(n+1) inherits:
     - motifId (same family, with transform suffix)
     - parentPhraseId = P(n).phraseId
     - harmonicTarget from progression
     - tensionTarget from arc
```

## 5. How will the lead receive the actual bass/kick plan?

The generation order changes from:
```
generateKick(notes) → generateBass(notes) → generateLead(notes)
```
to:
```
planGroove() → GroovePlan (accentMap, kickPositions, swing)
planHarmony() → HarmonicPlan (chordPerBeat, chordTones, tension)
generateKick(GroovePlan) → kickNotes
generateBass(GroovePlan, HarmonicPlan, kickNotes) → bassNotes
generateLead(GroovePlan, HarmonicPlan, kickNotes, bassNotes, PhraseState) → leadNotes
```

The lead generator receives `bassNotes` (the actual bass events for THIS bar) and `kickNotes` (the actual kick events). It can then:
- Check which steps have bass notes → leave holes or accent complementary steps
- Check which steps have kick accents → avoid or reinforce
- Check the chord at each step → target chord tones on strong beats
- Check the previous phrase's motif → CONTINUE/DEVELOP/ANSWER

## 6. How will learned interaction grammar alter generation?

Currently, learned grammar provides:
- `intervalHistogram` (what intervals the radio uses)
- `kickOnsetPattern` (when kicks happen in the radio)
- `rhythmPattern` (bass rhythm probability)

After F21, learned interaction grammar will provide:
- **kick→bass response**: when kick plays at step X, how likely is bass at step X+1?
- **bass→lead response**: when bass plays at step X, does lead avoid or accent X?
- **chord→melody targeting**: which scale degrees does the melody use over each chord?
- **phraseRole→rhythm**: which rhythm patterns appear in call vs response phrases?

These are consumed DURING generation, not after. The bass generator reads the kick→bass response model. The lead generator reads the bass→lead response model.

## 7. What exact generated audio path will consume SoundDNA?

(Phase 4 — not implemented yet, but the path is defined:)

```
SoundDNA → SynthRecipe → psyLive.applyRecipe(voice, recipe)

In psyLive:
  bass(t, freq, recipe):
    sub = createOscillator(recipe.oscType)  // recipe selects architecture
    sub.frequency = freq
    filter = createBiquadFilter(recipe.filterType)  // recipe selects filter
    filter.frequency = recipe.filterCutoff
    filter.Q = recipe.filterResonance
    sat = createWaveShaper(recipe.saturationAmount)  // recipe selects saturation
    // recipe.oscLayers determines how many oscillators
    // recipe.stereoWidth determines panning
    // recipe.detune determines unison spread
```

The voice functions currently hardcode all of these. After Phase 4, they will read from the recipe.

## 8. What is the minimum proof that the new system is genuinely compositional?

**Test 1 — Groove Lock:**
Generate 32 bars. For each bar, extract kick onsets and bass onsets. The bass must align to kick on >60% of kick steps (bass knows kick). The lead must avoid bass-busy steps on >50% of bars (lead knows bass).

**Test 2 — Phrase Development:**
Generate 32 bars (4 phrases). Extract the motif from phrase 1. Measure:
- Phrase 2 has >40% interval contour similarity to phrase 1 (DEVELOP)
- Phrase 3 has inverted contour from phrase 1 (ANSWER)
- Phrase 4 has <30% rhythm similarity to phrase 1 (CONTRAST)
- All phrases share motifId lineage

**Test 3 — Lead Reads Bass:**
Generate 32 bars. For each bar, check:
- Lead does NOT play on >50% of steps where bass plays (leaves holes)
- Lead DOES play on >40% of steps where bass is silent (fills space)
- This is NOT random — the pattern is consistent across bars

**Test 4 — Harmonic Targeting:**
Generate 32 bars. For strong beats (steps 0,4,8,12):
- >70% of lead notes are chord tones (root, third, fifth)
- On weak beats, non-chord tones are allowed
- This proves the lead is harmonically aware

**Test 5 — Tension Drives Generation:**
Generate 32 bars. Measure:
- Harmonic tension (non-chord tone ratio) rises from INTRO to CLIMAX
- Melodic tension (avg interval size) rises from INTRO to CLIMAX
- Both fall at RESOLUTION
- The tension values CAUSE the generation changes (not just telemetry)

---

## IMPLEMENTATION PLAN (Phase 1-3 only)

### Phase 1: State Types
- `GrooveState`: accentMap[16], swing, velocityProfile[16], ghostMap[16], spaceMap[16]
- `HarmonicState`: root, scale, currentChord, harmonicFunction, nextChord, chordTones[], tension
- `PhraseDevelopmentState`: phraseId, parentPhraseId, motifId, operator, previousNotes, previousRhythm, previousContour
- `TensionState`: harmonic, melodic, rhythmic, register, density, expectation → overall

### Phase 2: Engines
- `GrooveEngine`: generates GrooveState from context, persists across bars
- `HarmonicEngine`: generates chord progression from section + learned harmony
- `PhraseEngine`: selects development operator, transforms previous phrase → next phrase

### Phase 3: Relational Generation
- `generateKick` reads GrooveState (accentMap → velocity, ghostMap → ghost notes)
- `generateBass` reads GrooveState + HarmonicState + kickNotes (aligns to kick, targets chord root)
- `generateLead` reads GrooveState + HarmonicState + kickNotes + bassNotes + PhraseState (fills holes, targets chord tones, develops motif)

The key change: `planBar()` passes the generated kick and bass notes to the lead generator. The lead is no longer independent — it is a response to the groove and bass.
