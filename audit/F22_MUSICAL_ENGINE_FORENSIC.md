# F22 — MUSICAL ENGINE FORENSIC

**HEAD:** `7b66735` · **Method:** Trace every field from state → generation → scheduler → audio. Mark DEAD if it doesn't reach the audio output.

---

## 1. CURRENT COMPOSITION GRAPH

```
planBar(bar, bpm)
  ↓
1. GrooveState generated (per section)      ← accentMap, ghostMap, spaceMap, swing, microTiming
2. HarmonicState generated (per phrase)     ← progression, chordTones, harmonicFunction
3. TensionState updated (per bar)           ← 7 dimensions
4. PhraseDevelopmentState operator selected ← CONTINUE/DEVELOP/ANSWER/CONTRAST/...
  ↓
5. generateKick(notes, snap, barInPhrase)   ← DOES NOT READ GrooveState
6. generateBass(notes, snap, barInPhrase)   ← DOES NOT READ kickNotes or GrooveState
7. generateRelationalLead(notes, snap, barInPhrase, density, kickNotes, bassNotes)
   ← READS kickNotes + bassNotes + harmonicState + groove.spaceMap + tensionState + phraseState
  ↓
8. ScheduledNote[] returned to scheduler
9. scheduleStep plays notes at stepTime = beatTime + k * stepDur  ← NO microTiming, NO swing
```

**Problem:** Steps 5 and 6 don't read the groove. Step 7 (lead) reads some of it but not all. Step 9 ignores microTiming and swing entirely.

---

## 2. CURRENT MUSICAL STATE GRAPH

| State | Created | Consumed by generation | Reaches audio |
|-------|---------|----------------------|---------------|
| GrooveState.accentMap | ✅ generated | ❌ NOT read by kick/bass. Lead reads `spaceMap` only. | ❌ DEAD |
| GrooveState.ghostMap | ✅ generated | ❌ NOT read by any generator | ❌ DEAD |
| GrooveState.spaceMap | ✅ generated | ✅ Lead reads it (line 1200) | ✅ ALIVE (lead only) |
| GrooveState.swing | ✅ generated | ❌ NOT applied by scheduler | ❌ DEAD |
| GrooveState.microTiming | ✅ generated | ❌ NOT applied by scheduler | ❌ DEAD |
| GrooveState.velocityProfile | ✅ generated | ❌ NOT read by any generator | ❌ DEAD |
| GrooveState.density | ✅ generated | ❌ NOT read (density comes from section arc) | ❌ DEAD |
| GrooveState.syncopation | ✅ generated | ❌ NOT read | ❌ DEAD |
| HarmonicState.progression | ✅ generated | ✅ Lead uses `nearestChordTone` (which reads progression) | ✅ ALIVE |
| HarmonicState.currentFunction | ✅ generated | ❌ NOT read by any generator | ❌ DEAD |
| HarmonicState.harmonicTension | ✅ generated | ❌ NOT read (tension comes from TensionState) | ❌ DEAD |
| HarmonicState.cadenceIntent | ✅ generated | ❌ NOT read | ❌ DEAD |
| TensionState.harmonic | ✅ updated | ❌ NOT directly read by generators | ❌ DEAD |
| TensionState.melodic | ✅ updated | ✅ Lead reads it (line 1235: maxInterval) | ✅ ALIVE |
| TensionState.rhythmic | ✅ updated | ✅ Lead reads it (line 1201: playProb) | ✅ ALIVE |
| TensionState.register | ✅ updated | ✅ Lead reads it (line 1255) | ✅ ALIVE |
| TensionState.density | ✅ updated | ❌ NOT read (density comes from calculateLeadDensity) | ❌ DEAD |
| TensionState.spectral | ✅ updated | ❌ NOT read | ❌ DEAD |
| TensionState.expectation | ✅ updated | ❌ NOT read | ❌ DEAD |
| TensionState.resolving | ✅ updated | ✅ Lead reads it (lines 1203, 1259) | ✅ ALIVE |
| TensionState.overall | ✅ updated | ❌ NOT read (display only) | ❌ DEAD |
| PhraseDevelopmentState.operator | ✅ selected | ✅ Lead uses `transformPhrase` with operator | ✅ ALIVE |
| PhraseDevelopmentState.previous | ✅ stored | ✅ Lead uses `transformPhrase(prevPhrase, ...)` | ✅ ALIVE |
| PhraseDevelopmentState.motifFamilyId | ✅ stored | ❌ NOT consumed (just metadata) | ❌ DEAD |
| StrategySet.bass | ✅ selected | ✅ `generateStrategicBass` uses it | ✅ ALIVE |
| StrategySet.lead | ✅ selected | ❌ NOT consumed by `generateRelationalLead` | ❌ DEAD |
| StrategySet.groove | ✅ selected | ❌ NOT consumed | ❌ DEAD |
| StrategySet.texture | ✅ selected | ❌ NOT consumed | ❌ DEAD |
| StrategySet.transition | ✅ selected | ❌ NOT consumed (no audio events generated) | ❌ DEAD |

**Summary:** Of 25 state fields, only 8 reach the audio output. 17 are DEAD (computed but never consumed).

---

## 3. CURRENT AUDIO/SYNTHESIS GRAPH

```
kick(t):
  sub = sine 55Hz → gain env → kickBus
  body = sine 150→45Hz → waveshaper(k=8) → kickBus
  click = noise → HPF 4kHz → kickBus

bass(t, freq, v):
  sub = sine → gain env → bassBus
  mid = sawtooth → LPF(cut=v.bassCut, Q=v.bassQ) → waveshaper(k=4) → bassBus

lead(t, freq, v):
  3× osc(v.leadWave, detuned ±7¢) → stereo pan → LPF(Q=v.leadQ) → waveshaper(k=2) → leadBus

hat(t, lvl):
  noise → HPF 7kHz → BPF 10kHz → hatBus

BUSES:
  kickBus → kickMute → kickDuck → engineBus
  bassBus → bassMute → bassDuck → engineBus
  leadBus → leadMute → leadDuck → engineBus
  hatBus → hatMute → hatDuck → engineBus
  engineBus → comp(-18dB) → EQ(low/mid/high) → master → safetyLimiter → analyser → destination

  delaySend → delay(0.3s) → wet(0.22) → EQ input
  reverbSend → convolver(1.8s) → reverbWet(0.5) → EQ input
```

**SoundDNA/SynthRecipe:** NEVER reaches this graph. `applyLearnedTimbre()` only overrides 4 variant parameters (`bassWave, bassCut, leadWave, leadCut`). The synthesis ARCHITECTURE (oscillator type, layer count, filter topology, envelope shape, saturation curve, stereo width, modulation) is completely static.

---

## 4. DEAD ABSTRACTIONS

| Abstraction | Lines of code | Status | Evidence |
|-------------|--------------|--------|----------|
| GrooveState.accentMap | 16 values | DEAD | Kick/bass don't read it. Lead doesn't read it. |
| GrooveState.ghostMap | 16 values | DEAD | No generator reads it. |
| GrooveState.swing | 1 value | DEAD | Scheduler doesn't apply it. |
| GrooveState.microTiming | 16 values | DEAD | Scheduler doesn't apply it. |
| GrooveState.velocityProfile | 16 values | DEAD | No generator reads it. |
| HarmonicState.currentFunction | enum | DEAD | No generator reads it. |
| HarmonicState.cadenceIntent | boolean | DEAD | No generator reads it. |
| TensionState.harmonic | number | DEAD | No generator reads it directly. |
| TensionState.density | number | DEAD | No generator reads it. |
| TensionState.spectral | number | DEAD | No generator reads it. |
| TensionState.expectation | number | DEAD | No generator reads it. |
| TensionState.overall | number | DEAD | Display only. |
| StrategySet.lead | enum | DEAD | `generateRelationalLead` doesn't read it. |
| StrategySet.groove | enum | DEAD | No generator reads it. |
| StrategySet.texture | enum | DEAD | No generator reads it. |
| StrategySet.transition | enum | DEAD | No audio events generated. |
| SoundDNA | 25+ fields | DEAD | `SynthRecipe` computed but voice functions never read it. |
| SynthRecipe | 15 fields | DEAD | Never passed to `kick()`/`bass()`/`lead()`/`hat()`. |
| PhraseDevelopmentState.motifFamilyId | string | DEAD | Metadata only. |
| 4 of 8 TimbreProfile.synthParams | — | DEAD | `bassSaturation, leadSaturation, hatDecay, hatBrightness` computed but never applied. |

**Total dead code: 17 state fields + SoundDNA (25 fields) + SynthRecipe (15 fields) + 4 synth params = 61 computed-but-unconsumed values.**

---

## 5. PARTIALLY CONSUMED ABSTRACTIONS

| Abstraction | What works | What doesn't |
|-------------|-----------|-------------|
| GrooveState.spaceMap | Lead reads it for play probability | Kick/bass don't read any groove field |
| HarmonicState.progression | Lead uses `nearestChordTone` which reads chord at step | Bass doesn't target chord roots. No harmonic function awareness. |
| TensionState | 3 of 7 dimensions read by lead (melodic, rhythmic, register) | 4 dimensions dead. No voice other than lead reads tension. |
| PhraseDevelopmentState | `transformPhrase` creates inherited notes | Only lead uses it. Bass/kick don't develop. Operators exist but are simplistic. |
| TimbreProfile | 4 of 8 synthParams applied | 4 dead. Architecture never changes. |
| StrategySet | Bass strategy consumed | Lead/groove/texture/transition strategies dead. |

---

## 6. ACTUAL MUSICAL DEPENDENCIES

```
WHAT ACTUALLY DRIVES GENERATION:

Kick:
  ← section name (→ selects KICK_GRAMMARS array)
  ← cycle count (→ offset into array)
  ← barInPhrase (→ phrase variant)
  ← style (→ adds ghost kicks)
  ← rng (→ velocity humanization)
  NOT: groove, harmony, tension, bass, learned rhythm

Bass:
  ← currentStrategies.bass (→ selects hardcoded pattern)
  ← section (→ beatDegrees, overridden by strategy)
  ← cycle count (→ drift)
  ← rootPc, scale (→ pitch)
  ← rng (→ velocity humanization)
  NOT: kick, groove, harmony, tension, learned bass grammar (unless no strategy)

Lead (generateRelationalLead):
  ← kickNotes (→ kickSteps set, for awareness)
  ← bassNotes (→ bassSteps set + bassMidiByStep, for hole-filling + register)
  ← harmonicState (→ nearestChordTone on strong beats)
  ← groove.spaceMap (→ play probability on free steps)
  ← tensionState.melodic (→ max interval size)
  ← tensionState.rhythmic (→ play probability multiplier)
  ← tensionState.register (→ upward push)
  ← tensionState.resolving (→ fewer notes, descend)
  ← phraseState.previous (→ transformPhrase for inherited notes)
  ← phraseState.operator (→ which transform)
  ← state.leadLastMidi (→ continuity)
  ← rng (→ interval sampling)
  NOT: StrategySet.lead, learned melodic grammar, learned interaction grammar

Hats:
  ← style (→ pattern)
  ← section (→ ghost notes)
  ← ctx.tension (→ velocity)
  ← rng (→ humanization)
  NOT: groove, kick, bass, harmony, tension state
```

**The lead is the ONLY voice that is genuinely relational. Kick and bass are still independent.**

---

## 7. GROOVE ANALYSIS

**Is there a shared pulse/accent hierarchy?** NO. Each voice has its own velocity logic. There is no shared accent map that says "beat 1 is strongest across all voices."

**Downbeat hierarchy?** Kick accents step 0 (+0.05). Bass uses 0.9 on downbeats. Lead uses 0.75 on strong beats. These are independent decisions, not a shared hierarchy.

**Groove anchors?** NO. There is no concept of a "groove anchor" — a rhythmic event that all voices agree on.

**Anticipation?** NO. No voice plays before the beat.

**Syncopation relationships?** NO. Kick and bass don't know each other's syncopation.

**Ghost-note relationships?** NO. `ghostMap` exists but is dead.

**Swing?** DEAD. Computed in GrooveState but scheduler uses rigid 16th grid.

**Microtiming?** DEAD. Computed in GrooveState but scheduler uses exact step times.

**Velocity/accent relationships?** NO. Independent per voice.

**Intentional silence?** Lead leaves holes for bass (partially). Kick/bass don't intentionally create space.

**Phrase-level rhythmic motifs?** NO. Rhythm is generated per bar, not per phrase.

**VERDICT: GrooveState is 75% decorative. Only `spaceMap` is consumed, and only by the lead.**

---

## 8. BASS ANALYSIS

**Does bass read kick?** NO. `kickNotes` is extracted (line 442) but only passed to `generateRelationalLead`, not to `generateBass`. The bass generator receives `(notes, snap, barInPhrase)` — no kick data.

**Can bass lock/reinforce/answer/anticipate/leave space/syncopate against kick?** NO. The bass uses hardcoded step arrays that are independent of the kick pattern.

**Can bass phrase across multiple bars?** NO. Each bar is generated independently. `bassLastMidi` is carried forward (one scalar) but the rhythmic/harmonic phrase is not.

**Does bass target chord roots?** NO. The bass uses `beatDegrees` (hardcoded per section) or strategy patterns. It doesn't read `HarmonicState.progression` or `getChordAtStep`.

**Does bass remember its previous phrase?** Only `bassLastMidi` (one number). Not the rhythmic pattern or harmonic movement.

**VERDICT: Bass is an independent pattern generator. It does not participate in the groove relationship.**

---

## 9. LEAD ANALYSIS

**Is the lead a phrase or a step generator?** It is a STEP GENERATOR. `generateRelationalLead` iterates steps 0-15 and makes per-step decisions. Even when `inheritedNotes` exist from `transformPhrase`, the decision to play each inherited note is per-step probability, not phrase-level structure.

**Can the lead create a coherent melodic arc?** NO. Each step's interval is sampled independently. There is no phrase-level contour target, no phrase shape, no arc from tension to release within a phrase.

**Does the lead create call/response?** The `ANSWER` operator inverts the contour, but this is a crude transform — it doesn't create a musical "response" that complements the "call."

**Does the lead create anticipation?** NO. No pickup notes, no anticipation of chord changes.

**Does the lead create cadence?** Only a hardcoded root on step 15 of bar 7. Not an intelligent cadence.

**Does the lead preserve rhythmic identity while changing pitch?** Only if `transformPhrase` is called with `CONTINUE` (which preserves step positions). But the per-step probability gate can drop notes randomly, breaking the identity.

**VERDICT: The lead has relational awareness but is still a step generator, not a phrase composer.**

---

## 10. HARMONY ANALYSIS

**Is there a chord progression?** YES. `HarmonicState.progression` contains `ChordVoicing[]` with function (tonic/predominant/dominant).

**Does the bass follow the progression?** NO. Bass uses hardcoded `beatDegrees` or strategy patterns. It doesn't read `HarmonicState`.

**Does the lead follow the progression?** PARTIALLY. `nearestChordTone` snaps lead notes to chord tones on strong beats (70% chance). But this is post-hoc snapping, not intentional harmonic targeting.

**Can the lead create tension through non-chord tones?** NO. There is no mechanism to intentionally place a non-chord tone for tension and then resolve it.

**Can harmony develop across phrases?** The progression changes per section (INTRO = static tonic, CLIMAX = dominant), but this is section-level, not phrase-level development.

**VERDICT: Harmony exists as a data structure but is only partially consumed. Bass ignores it. Lead snaps to it but doesn't use it musically.**

---

## 11. PHRASE ANALYSIS

**Is phrase N+1 derived from phrase N?** YES, partially. `transformPhrase` transforms the previous phrase's notes using the selected operator. But:
- The transform is applied per-note, not per-phrase
- The per-step probability gate can drop transformed notes randomly
- The bass and kick don't participate in phrase development

**Can the system create A-A'-B-A''?** The `PHRASE_STRUCTURE = [0,0,1,0,0,1,2,0]` creates A-A-B-A-A-B-C-A, but this is a hardcoded group index, not a development decision.

**Does the system know when to create a B section?** NO. The phrase structure is hardcoded.

**Does the system know when to return to A?** NO. Same reason.

**Does section transition change musical vocabulary?** Only density and beat degrees change. The musical approach (generation algorithm) stays the same.

**VERDICT: Phrase development exists for the lead only, and is weakened by per-step probability gates. Bass/kick don't develop.**

---

## 12. TENSION ANALYSIS

**Is tension multi-dimensional?** YES. 7 dimensions are computed.

**Does each dimension drive generation?** Only 3 of 7 (melodic, rhythmic, register) are read by the lead. The other 4 (harmonic, density, spectral, expectation) are DEAD.

**Does tension create audible changes?** PARTIALLY:
- High melodic tension → larger intervals (audible)
- High rhythmic tension → more notes (audible)
- High register tension → higher pitch (audible)
- Resolving → fewer notes, descending (audible)
- But: harmonic tension doesn't change chord choices. Density tension doesn't change note count. Spectral tension doesn't change synthesis. Expectation tension doesn't create anticipation.

**Can tension rise over multiple bars and resolve at a boundary?** The tension scalar smooths toward section targets, but this is parameter smoothing, not musical tension. There is no delayed resolution, no suspension, no anticipation.

**VERDICT: Tension is multi-dimensional but only 43% consumed. 4 of 7 dimensions are decorative.**

---

## 13. ARRANGEMENT ANALYSIS

**Is there an arrangement state machine?** NO. The `COMPOSITION_ARC` (8 sections × 8 bars) is a fixed cycle. It's not a state machine — it's a loop.

**Does arrangement control instrumentation?** Only density (lead on/off, hat count). It doesn't add/remove voices, change sound identity, or create breaks.

**Does arrangement create transitions?** NO. `triggerBreak/Build/Drop` exist as user actions, but they only change density for N bars. No risers, impacts, filter sweeps, or transition events are generated.

**Does arrangement change musical vocabulary?** NO. The same generation algorithms run in every section. Only parameters change.

**VERDICT: Arrangement is a density curve, not a musical form.**

---

## 14. SOUND IDENTITY ANALYSIS

**How many fundamentally different bass synthesis architectures exist?** 1. All bass = sub sine + mid saw → LPF → waveshaper. Only `bassWave` (sawtooth/square), `bassCut`, `bassQ` vary.

**How many lead architectures?** 1. All lead = 3× osc → stereo pan → LPF → waveshaper. Only `leadWave`, `leadCut`, `leadQ` vary.

**Does SoundDNA reach the audio graph?** NO. `SoundDNA` → `SynthRecipe` is computed but never consumed by voice functions.

**Does SoundDNA change oscillator architecture?** NO. `SynthRecipe.oscType` is computed but `bass()` always uses `v.bassWave` from the preset variant.

**Does SoundDNA change filter architecture?** NO. `SynthRecipe.filterType` is computed but `bass()` always uses lowpass.

**Does SoundDNA change envelope?** NO. `SynthRecipe.attackTime/decayTime/sustainLevel/releaseTime` are computed but voices use hardcoded envelopes.

**Does SoundDNA change saturation?** NO. `SynthRecipe.saturationAmount` is computed but `makeShaper()` always uses fixed k values (8 for kick, 4 for bass, 2 for lead).

**Does SoundDNA change stereo?** NO. `SynthRecipe.stereoWidth` is computed but only lead has stereo (fixed at ±0.6).

**VERDICT: SoundDNA is 100% decorative. Zero fields reach the audio graph. The synthesis architecture is completely static.**

---

## 15. LEARNING CONSUMPTION MATRIX

| Learned Field | Observed | Stored | Consumed By | Musical Decision | Test Proving Difference |
|---------------|----------|--------|-------------|-----------------|----------------------|
| BassGrammar.intervalTransitions | ✅ | ✅ | `generateLearnedBass` | Samples target PC from transitions | ✅ F17 A/B test (362 vs 260 notes) |
| BassGrammar.rhythmPattern | ✅ | ✅ | `generateLearnedBass` | Play probability per step | ✅ Same test |
| RhythmGrammar.kickPattern | ✅ | ✅ | `generateLearnedKick` | Kick onset probability | ✅ F18 test (27 vs 3 patterns) |
| RhythmGrammar.ghostNoteProb | ✅ | ✅ | `generateLearnedKick` | Ghost note probability | ✅ Same test |
| RhythmGrammar.swing | ✅ stored as 0 | ✅ | ❌ NOT consumed | N/A | ❌ DEAD |
| MelodicGrammar.intervalHistogram | ✅ | ✅ | `generateLearnedLead` (old path) | Interval sampling | ✅ F18 test (66 vs 24 notes) |
| MelodicGrammar.contour prefs | ✅ | ✅ | `generateLearnedLead` (old path) | Contour direction | ✅ Same test |
| MelodicGrammar.registerPref | ✅ | ✅ | `generateLearnedLead` (old path) | Octave selection | ✅ Same test |
| MelodicGrammar.degreePref | ✅ | ✅ | `generateLearnedLead` (old path) | Initial degree | ✅ Same test |
| TimbreProfile.brightness | ✅ | ✅ | `applyLearnedTimbre` → bassWave/leadWave | Oscillator type | ✅ F18 test (1.00 vs 0.73) |
| TimbreProfile.bassSaturation | ✅ | ✅ | ❌ NOT consumed | N/A | ❌ DEAD |
| TimbreProfile.leadSaturation | ✅ | ✅ | ❌ NOT consumed | N/A | ❌ DEAD |
| TimbreProfile.hatDecay | ✅ | ✅ | ❌ NOT consumed | N/A | ❌ DEAD |
| TimbreProfile.hatBrightness | ✅ | ✅ | ❌ NOT consumed | N/A | ❌ DEAD |
| StrategyWeights | ✅ | ✅ | `StrategySelector.selectStrategies` | Strategy selection | ✅ F20 test (0.002 shift) |
| PhraseMusicalFeatures (all) | ✅ | ✅ | `GrammarBuilder` → grammars | Feeds grammar building | ✅ Indirectly via grammar tests |
| ContinuousMusicalState | ✅ | ✅ | `generateRelationalLead` reads leadLastMidi, bassLastMidi | Continuity | ✅ F19 test (3/3 continuity) |

**Note:** `generateLearnedLead` (the old CandidateGenerator path) is still called when `learnedMelodic.confidence > 0.25` (line 1050). But `generateRelationalLead` is called in `planBar` (line 455). **These two paths CONFLICT** — `generateLead` checks for learned grammar first and returns early, preventing `generateRelationalLead` from ever being called when learning is active.

This means: **when radio learning is active, the relational lead is BYPASSED.** The old non-relational CandidateGenerator runs instead.

**THIS IS A CRITICAL BUG.** The relational lead (F21) and the learned lead (F18) are mutually exclusive. When learning is active, the lead loses its relational awareness.

---

## 16. INTRO/STATIC/DEVELOPMENT ANALYSIS

**Is INTRO a musical state or just a density preset?** It's a density preset. `calculateLeadDensity` returns 0.2 for INTRO. `generateBass` uses `[0,0,0,0]` (static root). `generateKick` uses base grammar. No musical establishment of identity.

**Is STATIC actually establishing a groove identity?** NO. The "STATEMENT" section just increases lead density to 0.45. The groove doesn't change. No new motif is established as a theme.

**Is DEVELOPMENT actually transforming material?** PARTIALLY. The `PhraseDevelopmentState.operator` selects DEVELOP, and `transformPhrase` fragments + shifts the motif. But this only applies to the lead, and the per-step probability gate can drop notes.

**Does DEVELOPMENT remember motifs?** YES. `phraseState.previous` stores the previous phrase's notes. But only the lead uses it.

**Does the system know when to create a B section?** NO. `PHRASE_STRUCTURE` is hardcoded.

**Does section transition change musical vocabulary?** NO. Only density and beat degrees change. The generation algorithm stays the same.

**VERDICT: INTRO/STATIC/DEVELOPMENT is mostly parameters. The section names are labels, not musical states.**

---

## 17. WHY THE CURRENT OUTPUT STILL SOUNDS SIMILAR

1. **One synthesis architecture.** All tracks use the same kick/bass/lead/hat voice architecture. SoundDNA doesn't reach the audio graph. Changing the learned source changes 4 parameters, not the sound identity.

2. **Bass doesn't participate in groove.** Bass is an independent pattern generator. It doesn't read kick, groove, or harmony. The kick-bass relationship (the foundation of psytrance) doesn't exist.

3. **Lead is a step generator, not a phrase composer.** Per-step probability decisions cannot produce coherent melodic phrases. The `transformPhrase` operators exist but are weakened by per-step gates and conflict with the learned lead path.

4. **Groove is 75% decorative.** Swing, microtiming, accent map, ghost map, velocity profile — all computed, none applied.

5. **Tension is 57% decorative.** 4 of 7 dimensions are never consumed.

6. **Arrangement is a density curve.** No transitions, no breaks, no FX events, no form.

7. **Critical bug: relational lead is bypassed when learning is active.** `generateLead` checks for learned grammar first and returns early, preventing `generateRelationalLead` from running.

8. **Strategies are pattern selectors, not generative algorithms.** "Rolling" = all 16 steps. "Sparse" = steps 0,8. These are hardcoded arrays, not different generation logic.

---

## 18. ROOT CAUSES RANKED

### P0 (blocks musical quality)
1. **Bass doesn't read kick.** The kick-bass relationship is the foundation of psytrance. Without it, the groove doesn't exist.
2. **Lead is a step generator, not a phrase.** Per-step probability cannot produce commercial melodies.
3. **SoundDNA is 100% decorative.** No sound identity reaches the audio graph.
4. **Relational lead is bypassed when learning is active.** Critical bug — the best lead path is disabled by the old learned path.
5. **Groove swing/microtiming/accentMap are dead.** The groove pocket doesn't exist in audio.

### P1 (limits musical quality)
6. **Tension is 57% decorative.** 4 of 7 dimensions don't drive generation.
7. **Bass doesn't read harmony.** Bass doesn't target chord roots.
8. **Arrangement is density-only.** No transitions, FX, or form.
9. **Strategies are pattern selectors, not algorithms.** Different arrays, same generation.
10. **Phrase development is lead-only.** Bass/kick don't develop.

### P2 (polish)
11. **Learning doesn't learn relationships.** Only histograms, not kick→bass or bass→lead interactions.
12. **No persistence.** Everything is in-memory.
13. **No global/session/context hierarchy.**

---

## 19. PROPOSED ARCHITECTURE

### Fix P0-1: Bass reads kick
```
generateBass(notes, snap, barInPhrase, kickNotes, groove, harmonic)
  ← reads kickNotes to know kick onset positions
  ← reads groove.accentMap for velocity
  ← reads harmonic.getChordAtStep for chord root targeting
  ← bass RELATIONSHIP to kick: lock (hit with kick), answer (hit between kicks),
     anticipate (hit before kick), leave space (rest where kick is)
```

### Fix P0-2: Lead is a phrase, not steps
```
generateLeadPhrase(context) → PhraseNote[]
  1. Select phrase shape (arc: rising, falling, arch, static)
  2. Select motif from phrase state (CONTINUE/DEVELOP/ANSWER/CONTRAST)
  3. Generate motif at PHRASE level:
     - Choose phrase length (8, 12, 16 steps)
     - Choose contour target (ascending, descending, arch)
     - Choose rhythm pattern (from groove space map)
     - Generate interval sequence that follows contour
     - Place chord tones on strong beats
     - Place passing tones on weak beats
     - Place cadence at phrase end
  4. Convert phrase to ScheduledNote[]
```

### Fix P0-3: SoundDNA reaches audio
```
psyLive voice functions read SynthRecipe:
  bass(t, freq, recipe):
    oscType = recipe.oscType      // recipe selects architecture
    layers = recipe.oscLayers     // recipe selects layering
    filter = recipe.filterType    // recipe selects filter
    cutoff = recipe.filterCutoff  // recipe selects cutoff
    sat = recipe.saturationAmount // recipe selects saturation
    stereo = recipe.stereoWidth   // recipe selects stereo
```

### Fix P0-4: Remove learned lead bypass
```
// REMOVE the early return in generateLead that calls generateLearnedLead
// ALWAYS call generateRelationalLead, which already handles learned grammar
// as one of its inputs (via phrase state + interval sampling)
```

### Fix P0-5: Apply groove to scheduler
```
scheduler():
  stepTime = beatTime + k * stepDur + groove.microTiming[k]
  if (k % 2 === 1) stepTime += groove.swing * stepDur * 0.3
```

---

## 20. BEHAVIORAL ACCEPTANCE TESTS

### Test 1: Bass reads kick
Generate 32 bars. For each bar:
- Bass onsets align with kick on >60% of kick steps (lock)
- Bass plays between kicks on >30% of non-kick steps (answer/fill)
- Changing kick grammar changes bass onset pattern measurably

### Test 2: Lead is a phrase
Generate 32 bars. For each phrase (8 bars):
- Lead notes form a coherent contour (not random intervals)
- Phrase has identifiable start (pickup or downbeat entry)
- Phrase has identifiable end (cadence or resolution)
- Phrase N+1 has >30% contour similarity to phrase N (development)

### Test 3: SoundDNA reaches audio
Generate with 2 different SoundDNA profiles:
- Voice functions create different oscillator types
- Voice functions create different filter configurations
- Voice functions create different saturation curves
- Measured by inspecting created AudioNode types and parameters

### Test 4: Groove is applied
Generate 32 bars with swing=0.3:
- Odd 16th steps are delayed by measurable amount
- Microtiming offsets are present in scheduled times
- Not just "swing field exists"

### Test 5: Relational lead works with learning
Feed radio observations for 32 bars. Generate 32 bars:
- Lead STILL avoids bass-busy steps (not bypassed by learning)
- Lead STILL targets chord tones
- Lead ALSO uses learned interval distributions

### Test 6: Tension drives all voices
Generate 64 bars:
- High tension → kick gets denser, bass gets more active, lead uses larger intervals
- Low tension → kick simplifies, bass sustains, lead reduces
- All 7 tension dimensions affect at least one voice

### Test 7: Changing learned source changes musical identity
Feed two different radio profiles (bright vs dark). Generate 64 bars each:
- Different SoundDNA → different synth parameters → different actual audio
- Different learned grammar → different bass/lead patterns
- Different harmonic profile → different chord progression
- A listener could identify "these are different tracks"

---

## STOP

This audit is complete. The diagnosis is:

**The system has 61 computed-but-unconsumed values, 1 critical bug (relational lead bypassed by learning), 0 sound identity reaching audio, and a bass that doesn't participate in the groove.**

The root causes are P0-1 through P0-5. The proposed architecture addresses each with concrete code changes (not new abstractions).

**Awaiting approval before implementing.**