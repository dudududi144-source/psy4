# AUDIT-UI-FULL-CODEBASE — PSY4 Complete Capability & UI Inventory

**Task ID:** AUDIT-UI
**Agent:** AUDIT-UI (general-purpose)
**Scope:** Deep audit of PSY4 full codebase to inform a complete UI redesign.
**Method:** Read every line of `page.tsx` (539 LoC), `psyLive.ts` (1396 LoC), `sampler-bridge.ts` (213 LoC), `CausalComposer.ts` (376 LoC), `CausalState.ts` (279 LoC), `InferenceEngine.ts` (336 LoC), `MusicalMemoryStore.ts` (254 LoC), `MaterialRegistry.ts` (76 LoC), `learning.ts` (483 LoC), `beatPLL.ts` (213 LoC), and key surfaces of `MusicalSession.ts` (1404 LoC). Cross-referenced with `nexus-psy7/src/app/page.tsx` + `psy7/types.ts`, `psy-repos/psy3-clean/index.html`, and `psy-sampler/src/app/page.tsx`.

---

## Section 1 — Complete Capability Inventory

### 1.1 `PsyLive` (src/lib/psyLive.ts, 1396 LoC) — THE runtime engine

**Lifecycle / Transport**
- `constructor()` — loads `LearningData`, generates `deviceId`, schedules first `emit()`
- `play()` — ensures audio, starts `MusicalTransport`, starts scheduler interval (25ms), starts UI timer
- `stop()` — clears scheduler + UI timer, sets `playing=false`
- `getTransport()` — exposes MusicalTransport instance (for tests)
- `getTransportDebug()` — returns 30+ debug fields (transportBeat, transportBar, transportPhase, transportEpoch, transportConfidence, transportLocked, transportSource, radioState, radioObservationState, observationCount, lastObservationTime, radioRms, radioConfidence, sessionStyle, sessionRole, sessionAction, sessionSection, sessionPhrase, sessionTension, sessionDensity, sessionMotifCount, sessionReason, sessionHasLearned, sessionLastReward, learnedFromRadio, learnedPhraseCount, hasBassGrammar, hasRhythmGrammar, hasMelodicGrammar, hasTimbreProfile)
- `getMusicState()` — returns MusicState (bpm, key, scale, energy, energySlope, style, density, radioRoles)

**Audio Getters (read-only)**
- `get analyserNode` — master analyser
- `get radioAnalyserNode` — radio analyser
- `getPresets()`, `getStreams()`, `getPreset()`, `getVariant()`

**Mixer / FX**
- `setVolume(v)` — master gain
- `setChannelVolume(channel, v)` — kick/bass/lead/hat bus gains
- `setChannelMute(channel, muted)`, `setChannelSolo(channel|null)` — writes to dedicated muteGain nodes
- `setDelayAmount(v)`, `setDelayFeedback(v)` (clamped 0.85), `setReverbSend(v)`

**Composition Controls (delegate to MusicalSession — LEGACY)**
- `setPreset(id)` — switches preset, sets transport tempo
- `setVariant('A'|'B')`
- `setStyle(style)` / `unlockStyle()`
- `setEnergy(v)` / `unlockEnergy()`
- `setDensity(v)` / `unlockDensity()`
- `setTension(v)` / `unlockTension()`
- `setKey(rootPc, scaleName)` (via session) / `unlockKey()`

**Arrangement Triggers (F15 Phase 4)**
- `forceSection(section)`, `releaseSection()`
- `triggerBreak(bars=4)`, `triggerBuild(bars=4)`, `triggerDrop(bars=4)`
- `getArrangementState()` — returns `{forced, break, build, drop}` countdowns

**Composition Mode (Learning-driven)**
- `toggleComposition()` — generates a `Composition` from learned data, switches tempo
- `hasSavedComposition()` — checks localStorage

**Radio**
- `connectRadio(stream)` — opens `MediaElementAudioSource`, wires to `radioGain → radioAnalyser → engineBus`, drives `RadioObservationLayer.markConnecting/markConnected`
- `disconnectRadio()` — pauses element, transport enters holdover, resets `RadioObservationLayer`
- `setRadioVolume(v)` — smoothed (0.03s)

**Sampler Bridge (optional, parallel)**
- `attachSamplerBridge(bridge)` — stores bridge; bridge receives every `CausalNoteEvent` via `publishNote()` IN PARALLEL with synth voices
- `attachSamplerDevice(device)` — registers a `PsyDevice` on the bridge

**Learning Accessors**
- `hasLearnedFromRadio()` — delegates to `MusicalSession.hasLearnedFromRadio()`
- `getLearnedPhraseCount()` — number of phrases learned

**Internal voice functions (private but worth listing — the actual synthesis)**
- `kick(t, velocity)` — 3-layer: transient (HP noise 3ms), pitch-drop body (120→48Hz, 80ms), sub body (48Hz, 100ms tail)
- `bass(t, freq, variant, velocity)` — 3-layer: sub (sine, 65ms linear decay), mid (oscType+LPF pluck, 25ms filter close), character (noise BP transient 10ms). Reads `SynthRecipe` from learned `TimbreProfile` if available.
- `lead(t, freq, variant, accent)` — 3-osc unison (±7 cents), stereo panners (-stereoW/0/+stereoW), LPF envelope (300→peakCut→0.5peakCut over 0.3s), waveshaper saturation, delay + reverb sends
- `hat(t, lvl, open=false)` — noise through HP(7kHz) + BP(10kHz Q=0.7), 40ms closed / 120ms open decay
- `makeShaper(amount)` — `(1+k)x / (1+k|x|)` curve, 2x oversample
- `timbreToRecipe(timbre)` — converts learned TimbreProfile → SynthRecipe (oscType, layers, cutoff, resonance, saturation, stereoWidth)
- `applyLearnedTimbre()` — overrides current variant's synth params with learned values

**Audio graph (private)** — `voices → roleBus (USER vol) → muteGain (USER mute/solo) → duckGain (RADIO ducking) → engineBus → comp → masterEqLow → masterEqMid → masterEqHigh → master → safetyLimiter → analyser → destination`. Plus delay bus + reverb bus in parallel.

### 1.2 `CausalComposer` (foundation/music/CausalComposer.ts, 376 LoC)

- `constructor({bpm, rootPc, scaleName, seed})`
- `composeBar(bar)` → `CausalBarResult {bar, decision, events, stateAfter, memoryAfter}` — the causal loop: `onBarAdvance → infer → executeDecision → generateGroove → snapshot`
- `getActiveVoices()` — array of active voice IDs (e.g. `['kick','bass','hat','lead']`)
- `getStateSnapshot()` — full state for logging
- Public fields: `state: CausalState`, `memory: MusicalMemoryStore`

**Internal `executeDecision()` switch (13 actions, 10 implemented, 3 NO-OP stubs)**:
| Action | Implemented? | Effect |
|---|---|---|
| `INTRODUCE_HATS` | ✓ | Adds hat voice, off-beat 16ths (steps 2,6,10,14) |
| `INTRODUCE_LEAD` | ✓ | Adds lead voice, motif root+3rd+5th+3rd (steps 0,4,8,12) |
| `INTRODUCE_PERCUSSION` | ✓ | Adds percussion voice, off-beats (steps 6,10,14) |
| `INTRODUCE_COUNTERLINE` | ✓ | Adds counterline voice, lower register (steps 2,6,10,14) |
| `VARY_MOTIF` | ✓ | Transposes motif +2 |
| `TRANSFORM_MOTIF` | ✓ | Fragments motif (6 steps, [0,4,0,7,4,0]) |
| `CALLBACK_MOTIF` | ✓ | Returns motif up an octave |
| `BREAKDOWN` | ✓ | Withholds lead, plays pad only |
| `THIN_REGISTER` | ✓ | Removes counterline |
| `NO_CHANGE` | ✓ | Continue existing state |
| `INTRODUCE_ACID` | ✗ STUB | Listed in `CausalAction` type but no case in switch |
| `INTRODUCE_PAD` | ✗ STUB | Same — no case |
| `RESPONSE` | ✗ STUB | Same — no case |

`generateGroove()` — always plays kick on beats 0/1/2/3 + bass on 16th pattern (skip beat 0) unless `BREAKDOWN`.

### 1.3 `CausalState` (foundation/music/CausalState.ts, 279 LoC)

**9 stored state variables** (per architecture reset doc):
1. `bar` (informational — does NOT drive decisions)
2. `tensionLevel` (0-1)
3. `unresolvedMaterial[]` (array of materialIds)
4. `contrastDebt` (0-1, increases `barsSinceChange/32`)
5. `anticipationLevel` (0-1)
6. `grooveStability` (0-1)
7. `withheldMaterialId` (string | null)
8. `lastGrammaticalChangeBar` (number)
9. `materials` — `Map<materialId, MaterialCausalState>`

**Per-material state (`MaterialCausalState`, 5 fields)**:
- `repetitionCount`, `listenerFamiliarity` (0-1), `expectationLevel` (0-1), `materialExhaustion` (0-1), `lastPlayedBar`

**2 derived state functions**:
- `deriveRegisterSpace(activeVoices)` → 7 registers: `sub | bass | low-mid | mid | high-mid | high | air` (boolean = available)
- `deriveConversationalBalance(activeVoices)` → `'empty' | 'unbalanced' | 'balanced'`

**8 state-transition functions** (caused by events, not bar number):
- `onMaterialPlayed(state, id, bar)` — bumps repetition/familiarity/expectation/exhaustion/grooveStability
- `onMaterialVaried(state, id)` — bumps tension, resets expectation ×0.4, relieves exhaustion -0.2, marks unresolved
- `onResponseGiven(state, id)` — reduces tension -0.3, removes from unresolvedMaterial
- `onMaterialWithheld(state, id)` — sets withheldMaterialId, +0.4 anticipation
- `onMaterialReturned(state, id)` — clears withheld, resets anticipation, reduces tension -0.2
- `onGrammaticalChange(state, bar)` — resets contrastDebt, updates lastGrammaticalChangeBar
- `onNewGridEntered(state)` — reduces grooveStability -0.1
- `onBarAdvance(state, bar)` — the ONLY bar-driven update (advances time, decays familiarity for withheld material)

### 1.4 `InferenceEngine` (foundation/music/InferenceEngine.ts, 336 LoC)

- `infer(state, memory, activeVoices)` → `Decision {action, selected, candidates, stateBefore, memoryBefore}`
- `generateCandidates(state, memory, activeVoices)` → `Candidate[]`
- `resolveConflict(candidates)` → `Candidate | null`

**9 inference rules (with thresholds)**:
1. Groove saturation (>0.6) + no hat + high register empty → `INTRODUCE_HATS`
2. Groove complete + no lead + high-mid empty → `INTRODUCE_LEAD`
3. Groove >0.7 + no percussion + low-mid empty → `INTRODUCE_PERCUSSION`
4. expectationLevel >0.6 + exhaustion <0.7 → `VARY_MOTIF`
5. tension >0.5 + unresolvedMaterial + no counterline + mid empty → `INTRODUCE_COUNTERLINE`
6. exhaustion >0.7 → `TRANSFORM_MOTIF` (required)
7. contrastDebt >0.7 + motif established → `BREAKDOWN`
8. anticipationLevel >0.6 + withheld material familiar → `CALLBACK_MOTIF`
9. 6+/7 registers occupied → `THIN_REGISTER`

Each candidate carries: `action, whyNow, whyNotYet, urgency, necessity (required|optional), enables[], materialId?`

Conflict resolution: `required → urgency → consequence (enables count)`.

### 1.5 `MusicalMemoryStore` (foundation/music/MusicalMemoryStore.ts, 254 LoC)

**8 lifecycle states**: `introduced | established | repeated | transformed | withheld | unresolved | exhausted | recalled`

**MaterialMemoryEntry (9 fields)**: `materialId, lifecycleState, playCount, introducedAtBar, lastPlayedBar, derivedFrom, transformHistory[], answersMaterialId, contrastsWithMaterialId, withheldAtBar`

**Thresholds**: `ESTABLISHED_REPETITIONS=3`, `EXHAUSTED_REPETITIONS=8`

**Public API**:
- `onMaterialPlayed(id, bar)`, `onMaterialTransformed(id, bar, transform, derivedFromId?)`, `onMaterialWithheld(id, bar)`, `onMaterialRecalled(id, bar)`
- `setResponse(answerId, questionId)`, `setContrast(a, b)`
- Queries: `isEstablished(id)`, `isExhausted(id)`, `isWithheld(id)`, `isUnresolved(id)`, `getByLifecycle(state)`, `get(id)`, `getMaterialIds()`
- `snapshot()`, `clear()`

### 1.6 `MaterialRegistry` (foundation/music/MaterialRegistry.ts, 76 LoC)

**5 kinds, 29 canonical materials**:
| Kind | Count | Materials |
|---|---|---|
| `drums` | 11 | kick, snare, clap, hat-closed, hat-open, ride, crash, shaker, percussion, tom, rim |
| `low` | 2 | bass, sub |
| `musical` | 6 | lead, counterline, motif, stab, chord, arp |
| `texture` | 4 | pad, drone, atmosphere, texture |
| `transition` | 6 | riser, impact, downlifter, sweep, reverse, fill |

Each `MaterialDefinition` has: `id, kind, role, name, character?, register (7 registers), pitchable, defaultMidi?, velocityRange?`.

**Public API**: `register(def)`, `get(id)`, `has(id)`, `getByKind(kind)`, `getAllIds()`, `getRegister(id)`, `isPitchable(id)`, `getDefaultMidi(id)`, `size`.

⚠️ **`MaterialRegistry` is NOT imported by `CausalComposer` or `PsyLive`** — it exists as a standalone registry but the composer hardcodes its own 7-channel vocabulary (kick/bass/hat/lead/counterline/percussion/pad). 22 of 29 canonical materials are unreachable from runtime.

### 1.7 `SamplerBridge` (src/lib/sampler-bridge.ts, 213 LoC)

**Minimal foundation contracts (inline, verbatim from psy-foundation)**:
- `MusicalTransport` (14 fields: bpm, beat, bar, beatsPerBar, beatTime, barTime, phase, barPhase, confidence, locked, revision, origin, lastObservationAgo, observationCount)
- `MusicalContext` (7 fields: key, rootPc, scale, energy, style, section, beatsPerBar)
- `DeviceCapabilities` (7 fields: audio, midi, inputs, outputs, voices, latencyMs, roles[])
- `NoteEvent` (6 fields: type:'note', note, velocity, duration, channel, at)
- `PsyDevice` interface (id, capabilities(), onTransport, onContext, onEvent, onStart?, onStop?, reportLatencyMs?)

**Classes**:
- `InMemoryChannel` — pub/sub with subscribe/publish/close
- `DeviceHost` — registers devices, fans out transport/context/events, dedups transport by revision
- `SamplerBridge` — `register(device)`, `unregister(id)`, `publishNote(time, note, isOpenHat, stepDur)`, `publishTransport(snap)`, `publishContext(ctx)`, `deviceCount`, `dispose()`

**`voiceToChannel` mapping**: kick→`kick`, bass→`bass`, lead→`lead`, hat→`hat-open`|`hat-closed`

### 1.8 `MusicalSession` (foundation/music/MusicalSession.ts, 1404 LoC) — LEGACY but still wired

**Public API (38 methods, many NOT surfaced in UI)**:

*Composition controls (delegated to by PsyLive)*:
- `setEnergy/Density/Tension/Key/Style`, `unlockStyle/Energy/Density/Tension/Key`, `isStyleLocked/EnergyLocked/DensityLocked/TensionLocked/KeyLocked`

*Arrangement*:
- `forceSection/releaseSection`, `triggerBreak/Build/Drop(bars)`, `getArrangementState()`

*Observation / learning*:
- `observeRadio(data)`, `observeRadioTick(tick)` (F17.2 — full spectral extraction: spectralCentroid, spectralFlatness, spectralRolloff, low/mid/high energy)
- `extractPhraseLearning(phraseIndex, startBar, bars)`
- `getLearnedBassGrammar()`, `getLearnedRhythmGrammar()`, `getLearnedMelodicGrammar()`, `getLearnedTimbreProfile()`
- `hasLearnedFromRadio()`, `getLearnedPhraseCount()`, `hasLearned()`, `getLearningInfluencedCount()`

*State accessors (F19/F20/F21 — almost none in UI)*:
- `getContinuousMusicalState()`, `getLastCandidateScores()`, `getLastSelectedCandidateScore()`, `getRelationalContext()`
- `getCurrentStrategies()`, `getStrategyHistory()`, `getStrategyWeights()`
- `getGrooveState()`, `getHarmonicState()`, `getTensionState()`, `getPhraseState()`

*Plan*:
- `planBar(bar, transportBpm)` → `NotePlan {bar, notes, role, action, style, section, tension, barInPhrase, reason}`
- `getCurrentPlan()`
- `snapshot()` → `SessionSnapshot {style, role, action, section, phrase, bar, tension, density, motifCount, reason, hasLearned, lastReward}`
- `reset()`

⚠️ **`planBar()` is NOT called by `PsyLive`** — PsyLive calls `causalComposer.composeBar()` instead (see scheduler). MusicalSession is constructed in `ensureAudio()` for its `setStyle/setEnergy/...` API and its learning pipeline (`observeRadioTick`, `getLearnedTimbreProfile`), but its actual composition output (`NotePlan`) is dead.

### 1.9 `learning.ts` (src/lib/learning.ts, 483 LoC)

**9 scales in library**: Phrygian, Minor, Harmonic Minor, Phrygian Dominant, Dorian, Aeolian, Minor Pentatonic, Hungarian Minor, Double Harmonic.

**LearningData (11 fields)**: `bpmVotes, keyVotes, pitchClassHistogram[12], tempoHistory[], radioProfile{lowAvg, midAvg, highAvg, samples}, patternScores[], energyHistory[], detectedScale?, tempoStats?, sessions, totalKicks, lastUpdated, version`

**Public functions**:
- `loadLearning()`, `saveLearning(data)`, `migrateV1(old)`
- `noteToPitchClass(note)`, `pitchClassToName(pc)`
- `detectScale(histogram)` → `ScaleInfo {name, root, intervals, matchScore}` (tries 12 roots × 9 scales)
- `computeTempoStats(history)` → `TempoStats {current, stable, stddev, confidence, history}`
- `recordKick(data, bpm)`, `recordBassNote(data, freq)`, `recordRadioBands(data, low, mid, high)`, `recordEnergy(data, radio, engine)`, `recordPatternScore(data, presetId, variant, streamId, scoreDelta)`
- `deriveInsights(data)`, `getInsights(data)` → `{scale, tempo, radioProfile, topBpm, topKey, topBpmCount, topKeyCount, totalKicks, bestPattern, sessions, lastUpdated}`
- `generateComposition(data)` → `Composition {scaleName, rootPc, rootMidi, bpm, pattern{kick, bass, lead, hat}, reasoning[]}` — uses 4 rhythm variations per voice + chord progressions per scale (Minor/Phrygian/Harmonic Minor)
- `getNextRhythmVariation(idx)`, `getRhythmPattern(type, idx)`

**Chord progressions library** (per scale):
- Minor: 3 progressions (i-iv-VII-III, i-iv-v-VI, i-VI-i-iv)
- Phrygian: 2 progressions (i-bII-i-bII, i-VI-bII-i)
- Harmonic Minor: 1 progression (i-V-VI-iv)
- default: 1 progression

### 1.10 `beatPLL.ts` (src/lib/beatPLL.ts, 213 LoC) — OBSERVER only

- `BeatPLL` class with `update(obs)`, `predictNextBeat()`, `getBpm()`, `getConfidence()`, `isLocked()`, `getPhase(now)`, `getClock(now)`, `predictBeats(now, horizon)`, `reset()`
- Internal to `RadioObservationLayer` — NOT directly invoked by UI or PsyLive
- Locks after 8 consistent observations with confidence >0.5

### 1.11 `RadioObservationLayer` (foundation/radio/, accessed via PsyLive)

- Wraps `BeatObservationEngine` + `BeatPLL` + `MelodyObserver` (pitch)
- `process(tdBuf, fdBuf, audioTime)` → snapshot with `{signal, beat, pitch, occupancy}`
- `markConnecting()`, `markConnected()`, `reset()`, `getSnapshot()`
- Signal states: `DISCONNECTED | CONNECTING | NO_SIGNAL | WEAK_SIGNAL | SIGNAL_PRESENT | STABLE_SIGNAL | LOST | DEGRADED | ERROR`
- Observation states: `NO_SIGNAL | SIGNAL_PRESENT | LOCKING | FOLLOWING | DEGRADED | LOST`

---

## Section 2 — Current UI Inventory (page.tsx, 539 LoC)

### 2.1 Header (sticky top, lines 199-229)
- **PSY4 logo** (gradient text)
- **Play/Stop button** (40×40 circle, color flips pink/cyan)
- **BPM display** (`engineBpm`, cyan, large)
- **Bass note display** (`bassNote`, purple, small)
- **Sync status badge** (color-coded: IDLE/CONNECTING/NO_SIGNAL/LISTENING/FOLLOWING/HOLDOVER/ERROR)
- **Master volume slider** (inline, with % readout)

### 2.2 Timeline (lines 234-265)
- **8-section strip** (INTRO/STATEMENT/DEVELOPMENT/RESPONSE/CONTRAST/DEVELOPMENT2/CLIMAX/RESOLUTION) — clickable to `forceSection()`, current section highlighted, phrase progress bar at bottom of current cell
- **Bar/Phrase/Role text** (`Bar X · Phrase Y · ROLE`)
- **Cycle counter** (`Cycle N`)

### 2.3 Performance Macros (lines 268-322, 3-column grid)
- **Energy slider** + LOCK/AUTO toggle (cyan)
- **Tension slider** + LOCK/AUTO toggle (pink)
- **Style buttons** (4: FULL_ON/DARK/PROGRESSIVE/ACID, abbreviated F.ON/DARK/PROG/ACID) + LOCK/AUTO toggle (purple)

### 2.4 Arrangement Triggers (lines 325-346, 4 buttons)
- **BREAK** (red, ArrowDown icon, calls `triggerBreak(4)`)
- **BUILD** (amber, ArrowUp icon, calls `triggerBuild(4)`)
- **DROP** (pink, Flame icon, calls `triggerDrop(4)`)
- **AUTO** (gray, RotateCcw icon, calls `releaseSection()`)

### 2.5 Visualizer (lines 349-353)
- **32-bar canvas spectrum** (HSL gradient cyan→purple, only when playing)

### 2.6 Radio Section (lines 356-400)
- **Radio icon + label + sync badge**
- **Stream select** (dropdown: Psyndora, Babaganousha, Space Unicorn)
- **Connect/Disconnect button**
- **3 adaptation chips** (BASS/LEAD/GROOVE — derived from occupancy thresholds, shows "adapting"/"steady"/"creating space"/"playing"/"following"/"leading")
- **Radio volume slider** (orange)

### 2.7 Mix Section (lines 402-418, COLLAPSIBLE)
- 4 channel strips via `MixChannel` component:
  - **KICK** (cyan), **BASS** (green), **LEAD** (pink), **HATS** (amber)
  - Each: volume slider + percentage + M (mute) + S (solo) buttons
  - Active state highlighted via `isActive()` (BREAK → only kick/bass; LEAD role → only lead)

### 2.8 FX Section (lines 420-442, COLLAPSIBLE)
- **Echo** (delay amount, amber)
- **Feedback** (delay feedback, purple, max 0.85)
- **Space** (reverb send, cyan)

### 2.9 Causal Engine Panel (lines 444-512, ONLY when playing)
- **Action label** (mono font, pink when not NO_CHANGE, gray when NO_CHANGE)
- **WhyNow text** (mono, small)
- **5 state bars** (Tension, Contrast, Anticip., Groove, Expect. — each with colored bar + 0-1 readout)
- **Active Materials** (chips: cyan mono badges)
- **History** (last 12 bars: `B{n} ACTION` mono text)

### 2.10 Mobile Footer (lines 515-528, sm:hidden)
- **Play/Stop button** (40×40)
- **BPM + Section + Sync status** (compact text)

### 2.11 Global `<style>` (lines 530-535)
- Custom slider track/range/thumb CSS using `--slider-color` CSS variable (passed inline per-slider)

### 2.12 NOT IN UI (missing elements)
See Section 8 (Gap Analysis).

---

## Section 3 — Causal Engine UI Exposure

### 3.1 State variables shown vs hidden

| CausalState field | UI exposure | Notes |
|---|---|---|
| `bar` | ✗ (shown via `transportBar` in sessionSnap, not in Causal panel) | Shown in Timeline footer |
| `tensionLevel` | ✓ partial | Shown as "Tension" bar |
| `unresolvedMaterial[]` | ✗ HIDDEN | Length implied by INTRODUCE_COUNTERLINE rule, but array contents never shown |
| `contrastDebt` | ✓ | Shown as "Contrast" bar |
| `anticipationLevel` | ✓ | Shown as "Anticip." bar |
| `grooveStability` | ✓ | Shown as "Groove" bar |
| `withheldMaterialId` | ✗ HIDDEN | Critical for understanding why CALLBACK fires — never displayed |
| `lastGrammaticalChangeBar` | ✗ HIDDEN | Bars since last breakdown — never shown |
| `materials` Map (per-material) | ✗ HIDDEN | repetitionCount, listenerFamiliarity, expectationLevel (except motif-A's), materialExhaustion, lastPlayedBar — all hidden |

### 3.2 Per-material state (5 fields × N materials)
- Only `motif-A.expectationLevel` is shown (as "Expect." bar).
- All other materials (groove, counterline-1, pad) have their `repetitionCount`, `listenerFamiliarity`, `expectationLevel`, `materialExhaustion`, `lastPlayedBar` HIDDEN.

### 3.3 Derived state (2 functions, 0 shown)
- `deriveRegisterSpace(activeVoices)` → 7-register availability map — **HIDDEN** (would make a great visual)
- `deriveConversationalBalance(activeVoices)` → `'empty'|'unbalanced'|'balanced'` — **HIDDEN**

### 3.4 Decision detail (Candidate fields)
- `action` — ✓ shown
- `whyNow` — ✓ shown (small mono text)
- `whyNotYet` — ✗ HIDDEN (would explain why earlier bars didn't fire)
- `urgency` — ✗ HIDDEN
- `necessity` (required/optional) — ✗ HIDDEN
- `enables[]` — ✗ HIDDEN (would show what this decision unlocks)
- `materialId` — ✗ HIDDEN (which material is affected)
- `candidates[]` (all considered) — ✗ HIDDEN (only the winner is shown, not the runners-up)

### 3.5 Inference thresholds (7 constants)
- All 7 thresholds (GROOVE_STABILITY=0.6, EXPECTATION=0.6, TENSION=0.5, EXHAUSTION=0.7, CONTRAST_DEBT=0.7, ANTICIPATION=0.6, FAMILIARITY=0.5) — HIDDEN. UI shows bars but not the threshold lines they cross.

### 3.6 Memory store (MusicalMemoryStore)
- 8 lifecycle states — **NONE SHOWN**. The materials chips show IDs but not lifecycle (introduced/established/repeated/transformed/withheld/unresolved/exhausted/recalled).
- Relationships (derivesFrom, answers, contrastsWith, recalls) — **NONE SHOWN**.

### 3.7 CausalAction type (13 actions)
- 10 implemented, 3 stubs (INTRODUCE_ACID, INTRODUCE_PAD, RESPONSE). UI shows the action string but doesn't distinguish "implemented" vs "stub" — could be misleading.

---

## Section 4 — Material System UI Exposure

### 4.1 What `MaterialRegistry` defines (29 materials)

| Kind | Materials (id) | Used by runtime? | Used by UI? |
|---|---|---|---|
| drums | kick, snare, clap, hat-closed, hat-open, ride, crash, shaker, percussion, tom, rim | kick, hat (mapped), percussion ✓ | Kick/Hats mixer channels ✓ |
| low | bass, sub | bass ✓ | Bass mixer channel ✓ |
| musical | lead, counterline, motif, stab, chord, arp | lead, counterline, motif-A ✓ | Lead mixer channel ✓ |
| texture | pad, drone, atmosphere, texture | pad ✓ (in BREAKDOWN) | ✗ HIDDEN |
| transition | riser, impact, downlifter, sweep, reverse, fill | ✗ NONE | ✗ NONE |

**Score: 7 of 29 materials reachable from runtime. 22 of 29 (76%) unreachable.**

### 4.2 Material definitions (rich metadata, all hidden)
- `kind`, `role` (e.g. "rhythmic-anchor", "rolling-bass", "primary-melody", "harmonic-bed", "build-tension") — HIDDEN
- `register` (7-register placement) — HIDDEN (would map perfectly to `deriveRegisterSpace`)
- `pitchable` — HIDDEN
- `defaultMidi`, `velocityRange` — HIDDEN

### 4.3 What the UI shows
- 4 mixer channels: KICK, BASS, LEAD, HATS (the legacy PsyLive vocabulary).
- The causal "Active Materials" chips show voice IDs from `causalComposer.getActiveVoices()` — but these are voice names (`kick`, `bass`, `hat`, `lead`, `counterline`, `percussion`, `pad`), NOT material identities (`motif-A`, `groove`, `counterline-1`). The MaterialRegistry's `motif`, `stab`, `chord`, `arp`, `drone`, `atmosphere`, `texture`, all 6 transitions — never appear.

---

## Section 5 — SamplerBridge UI Exposure

### 5.1 What the bridge provides
- Foundation device contract: `PsyDevice` interface, `DeviceHost`, `InMemoryChannel`
- `SamplerBridge.register(device)`, `publishNote()`, `publishTransport()`, `publishContext()`, `deviceCount`, `dispose()`
- Voice→channel mapping (kick/bass/lead/hat-open/hat-closed)
- Multi-device fan-out (any registered device receives every NoteEvent)

### 5.2 UI exposure: **ZERO**
- `PsyLive.attachSamplerBridge()` is a public method but **`page.tsx` never calls it**.
- No UI element shows: device count, registered devices, events published, events received per device, device capabilities, device latency.
- The `getTransportDebug()` surface returns `deviceCount`-like info for the sampler bridge — but `page.tsx`'s polling only reads 9 of the 30+ fields (`sessionSection`, `sessionPhrase`, `transportBar`, `sessionRole`, `transportBpm`, `sessionTension`, `sessionDensity`, `radioState`, `radioObservationState`, `occupancy`). The sampler-related debug fields exist but are not pulled.
- This means the entire sampler integration is **dead code from the user's perspective** — the bridge can be attached, devices can register, notes can publish, but the user has no way to know it's happening.

---

## Section 6 — Radio / Learning UI Exposure

### 6.1 Radio layer (RadioObservationLayer) — what's available vs shown

| Field | Available? | Shown in UI? |
|---|---|---|
| `signal.state` (9 states) | ✓ (in LiveState as `radioSignalState`) | ✗ — only `syncStatus` shown (which is a derivative) |
| `signal.observationState` (6 states) | ✓ (in LiveState as `radioObservationState`) | ✗ |
| `signal.spectralEnergy` | ✓ (as `radioLevel`) | ✗ |
| `signal.rms` | ✓ (as `radioRms`) | ✗ |
| `beat.confidence` | ✓ (as `radioConfidence`) | ✗ |
| `beat.estimatedBpm` | ✓ (internal) | ✗ |
| `beat.observationCount` | ✓ (in getTransportDebug) | ✗ |
| `beat.timestamp.observedAt` | ✓ (in getTransportDebug) | ✗ |
| `pitch.frequency` | ✓ (used internally as `bassFreq`) | ✗ (only `bassNote` shown, not raw freq) |
| `pitch.pitchClass` | ✓ (passed to session) | ✗ |
| `pitch.confidence` | ✓ (passed to session) | ✗ |
| `occupancy.{kick,bass,lead,hats}` | ✓ (in LiveState) | ✗ — used only to derive 3 adaptation chips, raw numbers hidden |

### 6.2 Learning system — what's available vs shown

| Field | Available? | Shown in UI? |
|---|---|---|
| `detectedScale` (name, root, intervals, matchScore) | ✓ (in `learned` LiveState field) | ✗ — `learned` is in LiveState but UI never renders it |
| `tempoStats` (current, stable, stddev, confidence, history) | ✓ | ✗ |
| `topBpm`, `topKey`, counts | ✓ | ✗ |
| `radioProfile` (lowAvg, midAvg, highAvg) | ✓ | ✗ |
| `patternScores[]` (preset×variant×stream fit scores) | ✓ | ✗ |
| `energyHistory[]` (last 200 radio vs engine samples) | ✓ | ✗ |
| `totalKicks`, `sessions` | ✓ | ✗ |
| `generateComposition()` output (full Composition with reasoning) | ✓ (via `toggleComposition()`) | ✗ — `compositionMode` in LiveState but no UI button calls `toggleComposition()` |
| `hasSavedComposition()` | ✓ | ✗ |
| `hasLearnedFromRadio()`, `getLearnedPhraseCount()` | ✓ (PsyLive exposes) | ✗ |

### 6.3 MusicalSession learning grammars (4 learned artifacts)
- `getLearnedBassGrammar()` — bass note pattern grammar learned from radio
- `getLearnedRhythmGrammar()` — rhythmic subdivision grammar
- `getLearnedMelodicGrammar()` — melodic contour grammar
- `getLearnedTimbreProfile()` — synth param profile (used internally by `applyLearnedTimbre()`)

**All 4 grammars exist as public methods on MusicalSession and are surfaced via `getTransportDebug()` as booleans (`hasBassGrammar`, `hasRhythmGrammar`, `hasMelodicGrammar`, `hasTimbreProfile`). UI polls `getTransportDebug()` but ignores these fields.**

### 6.4 MusicalSession deep state (F19/F20/F21 — almost entirely hidden)
- `getContinuousMusicalState()` — relational context, candidate scores
- `getCurrentStrategies()` / `getStrategyHistory()` / `getStrategyWeights()` — strategy engine
- `getGrooveState()`, `getHarmonicState()`, `getTensionState()`, `getPhraseState()` — core musical state

**None exposed in UI.** These represent ~2000 LoC of musical intelligence that the user cannot see or influence.

---

## Section 7 — Cross-Project UI Patterns

### 7.1 nexus-psy7 (React + Next.js, ~350 LoC page.tsx + 18 instrument components)

**Distinctive UI patterns**:
- **Circular SVG sequencer** — concentric rings per track (7 tracks), rotating playhead line, click-to-toggle steps. Visually striking, space-efficient.
- **7 track kinds** (kick/bass/lead/hat/clap/cymbal/sub) vs PSY4's 4.
- **Per-step rich data**: `on`, `note`, `velocity`, `probability`, `offset` (PSY4 has none of this — steps don't exist in PSY4's UI).
- **A/B Variant system** — full synth param set per variant (13 fields: bassWave/Cut/Q, leadWave/Cut/Q/detune/Fm, hatLvl/Open, kickDecay/Pitch, bassLvl, leadLvl, delaySend). PSY4 has variants A/B in code but UI never shows them.
- **4 Macros** (energy/filter/chaos/mix) as vertical sliders — PSY4 has energy/tension but no filter/chaos/mix macros.
- **Master FX rack** (delay/reverb/drive with on/off + mix/size/amount) — PSY4 has delay/reverb but no drive.
- **Song Mode dialog** — segment sequencer (preset+variant+bars+label "Intro/Build/Drop/Outro"). PSY4 has sections but no song editor.
- **Scene Launcher** — save/recall snapshots. PSY4 has none.
- **Undo/Redo/Save/Load/Export/Import** in header. PSY4 has none.
- **Keyboard shortcuts** (Space, Z, Y, Q/E, 1-8). PSY4 has none.
- **Status bar** with voice count, dirty flag, undo/redo counts, play count. PSY4 has none.
- **Audio unlock overlay** ("POWER ON" button). PSY4 auto-unlocks on first play click.
- **18 instrument components** (StepGrid, PadGrid, TransportBar, Mixer, SamplerPanel, MidiPanel, MacroPanel, PresetBrowser, SceneLauncher, SpectrumAnalyzer, WaveformDisplay, AutomationPanel, PerformanceAssist, TestRunnerPanel, RecordingPanel, ParamPanel, StatusBar, SliderThin). PSY4 has 1 component (`MixChannel`).

### 7.2 psy3-clean / PSY6 MAX (single-file HTML, vanilla JS, ~350 LoC)

**Distinctive UI patterns**:
- **XY pad** for cutoff/reso (PSY4 has no XY pad).
- **16-step visual grid** with playhead dot (PSY4 has no step grid — composition is invisible).
- **16 playable pads** mapped to keyboard (a-w-s-e-d-f-t-g-y-h-u-j-k-o-l-p). PSY4 has no pads, no keyboard input.
- **3 FX sliders** (Drive/Echo/Pump) + **4 FX toggle buttons** (CRUSH/GATE/WAH/TAPE). PSY4 has 3 FX sliders but no FX toggles. "TAPE" = tape-stop effect.
- **5-state machine** (CALM/GROOVE/TENSION/PEAK/RELEASE) with transition probability matrix + state-colored dot. PSY4 has causal state but no named high-level "musical state" display.
- **Riser/Impact/Downlifter** auto-triggered on state transitions. PSY4 has these in MaterialRegistry but never plays them.
- **livePatterns mutation** every 8 bars based on energy. PSY4's CausalComposer does this but invisibly.
- **Voice cap** (24 max) + visible `_activeVoices` counter. PSY4 has no voice cap display.
- **Duck bus** (sidechain pump) with depth slider. PSY4 has ducking internally but no UI.
- **Stereo cross-feedback delay** (L→R→L ping-pong). PSY4 has mono delay.
- **Track mute buttons** (4: kick/bass/lead/hat). PSY4 has these.
- **Visibility-change handler** (suspend audio on tab hide). PSY4 doesn't.
- **Toast notifications**. PSY4 has none.

### 7.3 psy-sampler demo (React + Next.js, ~1174 LoC page.tsx)

**Distinctive UI patterns**:
- **Header stat badges** (6): devices count, events received, active voices (X/32), pending events, ref-device events, bpm. PSY4 has BPM only.
- **Transport bar** with Play/Stop (large, glowing), BPM slider (100-180), Section select (INTRO/BUILD/DROP/BREAK/RISER — 5 options vs PSY4's 8), Energy slider.
- **Init overlay** with "POWER ON" button + loading state + error display. PSY4 auto-inits.
- **Multi-device architecture visible** — sampler device + reference counter stub both registered, both stats shown. PSY4 has sampler bridge but doesn't show it.
- **16-step pattern grid per role** (6 roles: kick/bass/lead/hat-closed/clap/perc) — clickable to toggle. PSY4 has no step grid.
- **Device stats polling** (200ms): eventsReceived, notesTriggered, notesSkipped, activeVoices, pendingEvents, deviceCount. PSY4 polls session but not devices.
- **License/provenance display** (`shortLicense` helper, "commercial use" badge). PSY4 has none.
- **Card-based sections** with CardHeader/CardTitle/CardDescription (shadcn Card). PSY4 uses raw divs.
- **ScrollArea** for sample lists. PSY4 has no scroll areas.
- **Toast notifications** for load events (via `useToast`). PSY4 has none.
- **Neon palette per role** (emerald/fuchsia/violet/mint/yellow/lime — explicitly NO indigo/blue). PSY4 uses cyan/green/pink/purple/amber.
- **DPR-aware canvas resize** for visualizer. PSY4 uses raw offsetWidth.
- **Dual visualizer**: frequency bars (bottom 55%) + waveform line (centered, glowing). PSY4 has bars only.

---

## Section 8 — Gap Analysis

### 8.1 Capabilities with NO UI (the "hidden engine" problem)

**Engine capabilities the user cannot see or control**:

1. **SamplerBridge** — entire subsystem. `attachSamplerBridge()`, `attachSamplerDevice()`, device count, events published/received, device capabilities. 100% hidden.
2. **Learning system** — `learned` field in LiveState exists but never rendered. Scale detection, tempo stats, key votes, pattern scores, energy history, generated compositions — all hidden. `toggleComposition()` never called from UI.
3. **MusicalSession deep state** — `getContinuousMusicalState`, `getCurrentStrategies`, `getStrategyHistory`, `getStrategyWeights`, `getGrooveState`, `getHarmonicState`, `getTensionState`, `getPhraseState`, `getRelationalContext`, `getLastCandidateScores` — 10 accessors, 0 in UI.
4. **Learned grammars** — bass/rhythm/melodic/timbre grammars learned from radio. Surfaced as booleans in `getTransportDebug()` but UI doesn't poll those fields.
5. **Causal decision detail** — `whyNotYet`, `urgency`, `necessity`, `enables[]`, `materialId`, `candidates[]` (all considered, not just winner). 6 fields hidden.
6. **Causal per-material state** — 5 fields × N materials. Only `motif-A.expectationLevel` shown.
7. **Causal derived state** — `deriveRegisterSpace` (7-register map), `deriveConversationalBalance`. 2 functions, 0 visualizations.
8. **Causal withheld material** — `withheldMaterialId` is critical context for CALLBACK actions but never shown.
9. **Radio raw state** — 9 signal states, 6 observation states, raw occupancy numbers, pitch frequency/class/confidence, beat estimatedBpm/observationCount/timestamp. All hidden behind derivative `syncStatus`.
10. **MaterialRegistry** — 29 canonical materials, 22 unreachable. Rich metadata (kind, role, register, pitchable, defaultMidi, velocityRange) all hidden.
11. **Transition materials** — riser, impact, downlifter, sweep, reverse, fill. 6 materials in registry, 0 used by runtime, 0 in UI.
12. **Variant system** — `setVariant('A'|'B')` exists, presets have full A/B synth params, but UI has no variant toggle.
13. **Preset system** — `getPresets()` returns 4 presets (Rolling Bass, Acid Lead, Dark Prog, Full On) but UI never shows a preset picker.
14. **Composition reasoning** — `generateComposition()` returns `reasoning[]` (3+ human-readable strings explaining scale/tempo/harmony choices). Never shown.
15. **Inference thresholds** — 7 constants that determine when actions fire. Bars are shown but threshold lines are not.
16. **Voice count** — no visible active-voice counter.
17. **Cycle counter** — exists in `getTransportDebug` as `transportEpoch`, shown as "Cycle N" in timeline footer but not in causal panel.
18. **MixMode** — `'solo'|'glue'|'reinforce'` in LiveState, never displayed.
19. **Sidechain** — `sidechainActive` field exists (always false in current code — dead field).
20. **Harmonic lock** — `harmonicLocked` field exists, never displayed.

### 8.2 UI with no backing capability (the "dead UI" problem)

1. **Density control** — `setDensity()` exists on MusicalSession but UI has no density slider (only Energy/Tension/Style).
2. **Key control** — `setKey(rootPc, scaleName)` + `unlockKey()` exist but UI has no key picker.
3. **Section "DEVELOPMENT2"** — appears in the 8-section strip but `forceSection('DEVELOPMENT2')` may not be a valid MusicalContext section (the COMPOSITION_ARC in MusicalContext defines sections — need to verify DEVELOPMENT2 is real).
4. **`sidechainActive` LiveState field** — emitted as `false` always (line 350: `sidechainActive: false,`). Dead field in state.
5. **Style "ACID"** — UI shows ACID button but `classifyStyle()` can return `'acid'` only if `o.lead > 0.6 && energy > 0.5`. The button sets the style but the causal composer is hardcoded to `phrygian-dominant` root=4 — style doesn't reach the causal engine.

### 8.3 Capabilities partially exposed (the "shallow UI" problem)

1. **Causal state** — 5 of 9 variables shown as bars, but no thresholds, no per-material breakdown, no derived state, no candidate detail.
2. **Radio** — sync status shown but 15+ underlying fields hidden. Adaptation chips are derivative labels, not raw data.
3. **Arrangement** — 8 sections clickable but no visualization of the COMPOSITION_ARC schedule, no break/build/drop countdown, no phrase structure.
4. **Mix** — 4 channels but no per-channel metering, no EQ, no send levels, no ducking visualization.
5. **FX** — 3 sliders (echo/feedback/space) but no drive, no ping-pong, no FX on/off toggles, no per-voice sends.
6. **Materials** — chips show voice IDs, not material identities or lifecycle states.

---

## Section 9 — Architectural Observations for UI Redesign

### 9.1 The "two composers" problem
PSY4 has **TWO composition engines wired in parallel**:
- `CausalComposer` (the new authority) — called from `scheduler()`, produces `CausalNoteEvent[]`, drives all voice scheduling.
- `MusicalSession` (legacy) — constructed in `ensureAudio()`, receives `setStyle/setEnergy/setTension/observeRadioTick`, runs learning pipeline (`grammarBuilder`, `observationExtractor`), exposes 38 public methods. But `planBar()` is **never called**.

**Implication for UI**: The UI currently shows CausalComposer state (action, whyNow, 5 state bars) but the user's "Energy/Tension/Style/Section" controls flow through MusicalSession — which doesn't drive playback. The causal composer ignores these inputs entirely (it's hardcoded to `phrygian-dominant`, root=4, bpm=145). **The user's performance macros are disconnected from the actual composition.** Any redesign must either (a) wire controls to CausalComposer, or (b) remove the dead MusicalSession control surface.

### 9.2 The "hidden sampler" problem
The SamplerBridge is fully built (213 LoC, foundation contracts, DeviceHost, NoteEvent publishing) but `page.tsx` never calls `attachSamplerBridge()`. The entire sampler integration story — multi-device coexistence, sample realization, provenance — is invisible. A redesign should make the sampler a first-class UI citizen (device registry, sample browser, voice meters, provenance badges — all patterns from psy-sampler demo).

### 9.3 The "rich registry, poor runtime" problem
`MaterialRegistry` defines 29 materials with rich metadata (kind, role, register, pitchable, defaultMidi, velocityRange). `CausalComposer` hardcodes 7 channels. 22 materials (including all 6 transitions, all 4 textures except pad, 5 of 6 musical, 9 of 11 drums) are unreachable. A redesign should either (a) surface the registry as a "material browser" the composer can pull from, or (b) prune the registry to match runtime. The 7-register space (`deriveRegisterSpace`) is a perfect visualization that maps 1:1 to the registry's `register` field.

### 9.4 The "learning is invisible" problem
The learning system (483 LoC) does scale detection (9 scales × 12 roots), tempo stats, key votes, pattern scoring, energy history, composition generation with chord progressions and rhythm variations. **Zero of this is in the UI.** The `learned` LiveState field is populated but never rendered. `toggleComposition()` is never called. A redesign should expose: detected scale (with matchScore), tempo confidence, top key, learned grammars (bass/rhythm/melodic/timbre), generated composition reasoning, pattern effectiveness scores.

### 9.5 The "decision opacity" problem
The CausalComposer produces rich `Decision` objects with `candidates[]`, `whyNow`, `whyNotYet`, `urgency`, `necessity`, `enables[]`, `materialId`. The UI shows only `action` + `whyNow`. A redesign should show the full decision tree: all candidates considered, their scores, the threshold lines, the winner, and what it enables next. This is the "explainability" surface that distinguishes PSY4 from a step sequencer.

### 9.6 The "no song editor" problem
PSY4 has 8 sections in the timeline strip but no song editor (unlike nexus-psy7's SongPanel). The sections are clickable (forceSection) but there's no way to compose a song (segment sequence with preset+variant+bars+label). A redesign should add a song mode.

### 9.7 The "no preset/variant picker" problem
PSY4 has 4 presets (Rolling Bass, Acid Lead, Dark Prog, Full On) each with A/B variants — a total of 8 distinct sonic configurations. **The UI shows none of them.** The user cannot switch presets or variants. A redesign must surface these (nexus-psy7 pattern: preset carousel + A/B toggle).

### 9.8 The "no input" problem
PSY4 has zero keyboard shortcuts, zero pads, zero XY pads, zero MIDI input. nexus-psy7 has Space/Z/Y/Q/E/1-8. psy3-clean has 16 keyboard-mapped pads + XY pad. psy-sampler has clickable step grid. A redesign should add at minimum: Space=play/stop, keyboard shortcuts for sections/macros, and an XY pad for energy×tension (or cutoff×reso).

### 9.9 The "no persistence" problem
PSY4 has zero project persistence. nexus-psy7 has Save/Load/Export/Import + undo/redo + scene snapshots. psy-sampler has toast feedback. A redesign should add: project save/load (localStorage), undo/redo for parameter changes, scene snapshots, export (JSON + WAV render).

### 9.10 The "monolithic page" problem
PSY4's `page.tsx` is 539 LoC in a single file with one inline component (`MixChannel`). nexus-psy7 has 18 instrument components. A redesign should decompose into: TransportBar, TimelineStrip, PerformanceMacros, ArrangementTriggers, RadioPanel, MixerChannel, FXRack, CausalPanel (with sub-components: DecisionTree, StateBars, MaterialChips, CandidateList, History), SamplerPanel, LearningPanel, SongEditor, PresetCarousel, StatusBar. shadcn/ui has 48 components available (Card, Tabs, Dialog, Sheet, ScrollArea, Tooltip, Badge, Progress, etc.) — currently only Button, Slider, Select are used.

### 9.11 shadcn/ui inventory (48 components, 3 used)
**Used**: `button`, `slider`, `select`.
**Available but unused**: accordion, alert, alert-dialog, aspect-ratio, avatar, badge, breadcrumb, calendar, card, carousel, chart, checkbox, collapsible, command, context-menu, dialog, drawer, dropdown-menu, form, hover-card, input, input-otp, label, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, separator, sheet, sidebar, skeleton, sonner, switch, table, tabs, textarea, toast, toaster, toggle, toggle-group, tooltip.

A redesign has 45 unused shadcn components to draw from. High-value candidates: `card` (panels), `tabs` (Engine/Listen/Learn/Song views), `dialog`/`sheet` (song editor, settings), `tooltip` (decision explanations), `badge` (material lifecycle states), `progress` (causal state bars), `scroll-area` (history, candidate list), `accordion` (collapsible sections), `popover` (per-channel EQ), `switch` (FX on/off), `command` (preset/scene search), `resizable` (panel layout).

---

## Top 10 UI Gaps (priority for redesign)

1. **SamplerBridge is invisible** — entire subsystem (213 LoC, foundation contracts, multi-device host) never attached from UI. No device count, no event flow, no sample browser, no provenance.
2. **Learning system is invisible** — 483 LoC of scale detection, tempo stats, key votes, pattern scores, composition generation, 4 learned grammars. `learned` field in LiveState never rendered. `toggleComposition()` never called.
3. **Preset/Variant picker missing** — 4 presets × 2 variants = 8 sonic configurations. UI shows none. User cannot switch.
4. **Causal decision tree truncated** — only `action` + `whyNow` shown. `whyNotYet`, `urgency`, `necessity`, `enables[]`, `materialId`, full `candidates[]` (runners-up) all hidden. No threshold lines on state bars.
5. **Per-material state hidden** — 5 fields × N materials (repetition, familiarity, expectation, exhaustion, lastPlayedBar). Only `motif-A.expectationLevel` shown. Material lifecycle (8 states) never displayed. Material relationships (derivesFrom, answers, contrastsWith, recalls) never displayed.
6. **Register space not visualized** — `deriveRegisterSpace` returns 7-register availability map. Perfect for a vertical register meter showing which registers are occupied. Currently zero visualization.
7. **22 of 29 Materials unreachable** — `MaterialRegistry` defines 29 materials with rich metadata (kind, role, register, pitchable, defaultMidi, velocityRange). Runtime uses 7. All 6 transitions (riser/impact/downlifter/sweep/reverse/fill), 3 of 4 textures (drone/atmosphere/texture), 5 of 6 musical (motif/stab/chord/arp — `motif` is used as ID but not as registry material), 9 of 11 drums (snare/clap/hat-open/ride/crash/shaker/tom/rim) — never appear.
8. **No song editor / no persistence** — 8-section timeline is clickable but not editable. No segment sequence, no save/load, no undo/redo, no export, no scene snapshots. nexus-psy7 has all of these.
9. **No input surface** — zero keyboard shortcuts, zero pads, zero XY pads, zero MIDI. psy3-clean has 16 pads + XY pad + 5-state machine. nexus-psy7 has 7 keyboard shortcuts. psy-sampler has clickable step grid.
10. **Radio raw state hidden behind derivative** — 9 signal states + 6 observation states + raw occupancy + pitch frequency/class/confidence + beat estimatedBpm/observationCount all collapsed into a single `syncStatus` badge. Adaptation chips are labels, not data. User cannot see WHAT the radio is doing, only THAT it's "listening".

---

*End of audit. Total files read in full: 11 source files (~5,000 LoC) + 3 cross-project UIs (~1,900 LoC). No code modified. No files created outside `audit-reports/`.*
