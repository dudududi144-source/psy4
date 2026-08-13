# F13 — STATE OWNERSHIP MAP

**HEAD:** `017ef70` (F11) · **Method:** Grep every property across `psyLive.ts`, `MusicalSession.ts`, `MusicalContext.ts`, `MusicalTransport.ts`, `RadioObservationLayer.ts`, `page.tsx`.

For each property: **OWNER** (single writer) · **READERS** · **WRITERS** · **DUPLICATES** · **CONFLICTS**.

---

## 1. STATE PROPERTY TABLE

### 1.1 BPM (musical tempo)

| Aspect | Value |
|--------|-------|
| **OWNER** | `MusicalTransport.bpm` (private, `MusicalTransport.ts:67`) |
| **Writer(s)** | `setTempo()` (:154), `observeBeat()` → internal recalculation (:179), `reset()` (:293) |
| **Readers** | `snapshot().bpm` (:371) → psyLive:321,645,678,682,892,959; page.tsx via `s.engineBpm` |
| **Duplicates** | `MusicalContext.bpm` (:73) — smoothed copy, written at `:102` from `data.bpm` (which is itself `transportSnap.bpm` — **circular**) |
| **psyLive.musicState.bpm** | (:227) — separate copy, written at `:892` from `transport.snapshot().bpm` |
| **CONFLICT** | ⚠️ 3 copies of BPM. Transport is authoritative. MusicalContext.bpm and musicState.bpm are stale mirrors. Neither is written independently — they just copy Transport. No actual conflict (all converge), but redundant state. |

**Verdict:** ✅ CLEAN (single source, redundant mirrors)

### 1.2 KEY (root pitch class + scale name)

| Aspect | Value |
|--------|-------|
| **OWNER** | `MusicalContext.rootPc` / `scaleName` (`MusicalContext.ts:70-71`) |
| **Writer(s)** | `updateFromRadio()` (:130-138) — ONLY if `data.bassFreq > 50`. `setInternal()` (:170) — never called. |
| **Readers** | `snapshot().rootPc/scaleName` → MusicalSession.planBar uses `snap.rootPc` + `snap.scale` for note generation |
| **psyLive.bassFreq** | (:200) — declared, **NEVER ASSIGNED**. Always 0. Passed to `observeRadio` as `undefined` (psyLive:853). |
| **CONFLICT** | ❌ **DEAD**. The key-detection branch (`bassFreq > 50`) never fires. Key is permanently stuck at default: rootPc=9 (A), scaleName='phrygian-dominant'. The user cannot change key (no UI control). Radio cannot change key (bassFreq never measured). |

**Verdict:** ❌ DEAD (key detection never runs, key is hardcoded)

### 1.3 STYLE

| Aspect | Value |
|--------|-------|
| **OWNER** | `MusicalSession.style` (private, `MusicalSession.ts:72`) |
| **Writer(s)** | `detectStyle()` (:336-345) — called from `observeRadio()` every 200ms. `psyLive.setStyle()` (:595) — writes via `(session as any).style = style` (bypasses API). |
| **Readers** | `NotePlan.style` (metadata only, :147). `snapshot().style` (:367). **NOT READ by generateKick/Bass/Hats/Lead.** |
| **Duplicates** | `psyLive.currentStyle` (:234) — parallel variable, set by `classifyStyle()` (:957-978) with 8s hysteresis. `psyLive.musicState.style` (:228) — mirrors `currentStyle`. |
| **CONFLICT** | ⚠️ **FRACTURED**. Three style variables: `session.style` (detectStyle writes, user setStyle writes), `psyLive.currentStyle` (classifyStyle writes), `psyLive.musicState.style` (mirrors currentStyle). They serve different purposes (session metadata vs UI display) but the user's `setStyle()` writes to `session.style` which is (a) overwritten by detectStyle and (b) never read by generators. The UI shows `sessionSnap.sessionStyle` which follows detectStyle, not the user's click. |

**Verdict:** ⚠️ CONFLICT (3 owners, user choice overwritten, style doesn't affect music)

### 1.4 ENERGY

| Aspect | Value |
|--------|-------|
| **OWNER** | `MusicalContext.energy` (private, `MusicalContext.ts:75`) |
| **Writer(s)** | `updateFromRadio()` (:112) — smoothed from `energyHistory`. `psyLive.setEnergy()` (:603) — **BROKEN** (`getContext()` doesn't exist → TypeError). |
| **Readers** | `snapshot().energy` (:195). **NOT READ by generateKick/Bass/Hats/Lead.** `MusicalContext.updateFromRadio` (:117) uses it to derive density. |
| **Duplicates** | `psyLive.musicState.energy` (:227) — separately smoothed from the same `energyHistory` (psyLive:884-889) using different math. `MusicalContext.energyHistory` (:87) vs `psyLive.energyHistory` (:222) — **two separate arrays** for the same concept. |
| **CONFLICT** | ⚠️ **DUAL + BROKEN**. Two independent energy values (`ctx.energy` and `musicState.energy`) computed from two separate histories. User's setEnergy throws TypeError. Neither value is read by note generators. |

**Verdict:** ❌ BROKEN (user control throws, energy not read by generators)

### 1.5 DENSITY

| Aspect | Value |
|--------|-------|
| **OWNER** | `MusicalContext.density` (private, `MusicalContext.ts:73`) |
| **Writer(s)** | `updateFromRadio()` (:117) — `0.3 + energy * 0.5`. `psyLive.setDensity()` (:607) — **BROKEN** (same getContext TypeError). |
| **Readers** | `snapshot().density` (:194). `MusicalSession.evaluatePhrase` (:350) — `densityFit = Math.abs(notes.length / 8 - ctx.density * 10) < 5 ? 0.8 : 0.4` → feeds reward. **NOT READ by generateKick/Bass/Hats/Lead.** |
| **Duplicates** | `psyLive.musicState.density` (:227) — derived from `energySlope` (psyLive:911-918) using different formula. |
| **CONFLICT** | ⚠️ **DUAL + BROKEN**. Two density values. User's setDensity throws. ctx.density only affects phrase reward (bookkeeping). musicState.density is never read by generators. |

**Verdict:** ❌ BROKEN (user control throws, density only affects bookkeeping)

### 1.6 TENSION

| Aspect | Value |
|--------|-------|
| **OWNER** | `MusicalContext.tension` (private, `MusicalContext.ts:77`) |
| **Writer(s)** | `updateFromTransport()` (:159) — `tension += (targetTension - tension) * 0.05` every bar. `targetTension` set from `COMPOSITION_ARC[sectionIdx].tension` (:154). `psyLive.setTension()` (:611) — **BROKEN** (same getContext TypeError). |
| **Readers** | `snapshot().tension` (:196). `calculateLeadDensity` (:261) — `density *= (0.7 + ctx.tension * 0.3)`. `generateLead` (:282) — `velocity = mn.velocity * (0.5 + ctx.tension * 0.3)`. `generateHats` (:222) — `vel = 0.25 + ctx.tension * 0.25`. |
| **CONFLICT** | ⚠️ **BROKEN + REVERTED**. User's setTension throws TypeError. Even if fixed, `updateFromTransport` smooths tension toward the arc's `targetTension` every bar (5% per bar → ~20 bars to converge). User's value would decay to the arc target. |

**Verdict:** ❌ BROKEN (TypeError) + would be PARTIAL (reverted by arc)

### 1.7 SECTION (intro/statement/.../resolution)

| Aspect | Value |
|--------|-------|
| **OWNER** | Derived — `MusicalContext.snapshot().sectionName` (:200) |
| **Computation** | `Math.floor((bar % 64) / 8)` indexes `COMPOSITION_ARC` (:183-184) |
| **Writer(s)** | None (pure derivation from `bar`) |
| **Readers** | `calculateLeadDensity` (:243-249) — sets lead density per section. `NotePlan.section` (:148). UI display via `sessionSnap.sessionSection`. |
| **CONFLICT** | ✅ CLEAN. No separate section state. Derived from Transport.bar. |

**Verdict:** ✅ CLEAN

### 1.8 PHRASE

| Aspect | Value |
|--------|-------|
| **OWNER** | Derived — `MusicalContext.snapshot().phraseIndex` (:182) |
| **Computation** | `Math.floor(bar / 8)` |
| **CONFLICT** | ✅ CLEAN. |

**Verdict:** ✅ CLEAN

### 1.9 RADIO STATUS (signal state, observation state, sync status)

| Aspect | Value |
|--------|-------|
| **OWNER** | `RadioObservationLayer.signalState` (private, `:48`) + `RadioObservationLayer.observationState` (private, `:49`) |
| **Writer(s)** | `updateSignalState()` (:259) — but early-returns on DISCONNECTED/CONNECTING. `updateObservationState()` (:301) — only called inside beat block (never entered). `markConnected()` (:339) — **NEVER CALLED from psyLive**. `reset()` (:351) — called on disconnect. |
| **Readers** | `snapshot().signal.state` / `snapshot().signal.observationState` → psyLive:830,848 |
| **Duplicates** | `psyLive.radioGate` (RadioStateGate) — **separate** 7-state machine, `observe()` never called, frozen at CONNECTED_NO_SIGNAL. `psyLive.syncStatus` (:197) — 5-state, derived from observationState (stuck at 'no_signal'). |
| **CONFLICT** | ❌ **THREE DESYNCED STATE MACHINES**. `RadioStateGate` (7 states, decorative), `RadioObservationLayer.signalState` (9 states, stuck at DISCONNECTED), `RadioObservationLayer.observationState` (6 states, stuck at NO_SIGNAL), `psyLive.syncStatus` (5 states, stuck at no_signal). They were supposed to be unified but `radioLayer.markConnected()` was never wired. |

**Verdict:** ❌ CONFLICT (4 state machines, all stuck, all desynced)

### 1.10 RADIO BPM (detected from radio)

| Aspect | Value |
|--------|-------|
| **OWNER** | `BeatObservationEngine` → `RadioBeatObservation.estimatedBpm` (`BeatObservationEngine.ts:97-99`) |
| **Readers** | `radioSnap.beat.estimatedBpm` — **NEVER READ by Transport or MusicalSession**. Only `{time, confidence, source}` crosses into Transport (psyLive:820-824). |
| **CONFLICT** | ❌ **DEAD**. Radio BPM is computed (when beat detection runs, which it doesn't) but never used. Transport.bpm is the only BPM that matters, and it's set from presets, not radio. |

**Verdict:** ❌ DEAD (radio BPM computed but never consumed)

### 1.11 RADIO KEY (detected from radio bass)

| Aspect | Value |
|--------|-------|
| **OWNER** | Does not exist at runtime |
| **CONFLICT** | ❌ **MISSING**. `psyLive.bassFreq` never written. `RadioPitchObservation.pitchClass` never produced (pitch block never entered). No radio key detection occurs. |

**Verdict:** ❌ MISSING

### 1.12 LEAD VOLUME / BASS VOLUME / MASTER VOLUME

| Aspect | Value |
|--------|-------|
| **MASTER OWNER** | `psyLive.master` (GainNode, :355). Writer: `setVolume()` (:570). Default 0.9. |
| **KICK BUS OWNER** | `psyLive.kickBus` (GainNode, :422). Writers: `setChannelVolume('kick', v)` (:576) + `detect()` (:870-871, clobbers). Default 0.95. |
| **BASS BUS OWNER** | `psyLive.bassBus` (:423). Writers: `setChannelVolume('bass')` + `detect()` (:872-873). Default 0.85. |
| **LEAD BUS OWNER** | `psyLive.leadBus` (:424). Writers: `setChannelVolume('lead')` + `detect()` (:874-875). Default 0.5. |
| **HAT BUS OWNER** | `psyLive.hatBus` (:425). Writers: `setChannelVolume('hat')` + `detect()` (:876, forced to 0.6). Default 0.55. |
| **CONFLICT** | ⚠️ **DUAL OWNER per bus**. User (via setChannelVolume) and detect() both write bus.gain. When radio is ON, detect() wins every 200ms. User's value is transient (lasts <200ms). Foundation has ZERO volume ownership. |

**Verdict:** ⚠️ CONFLICT (dual writers, detect() wins when radio on)

### 1.13 barIndex, beatIndex, beatTime

| Aspect | Value |
|--------|-------|
| **OWNER** | `MusicalTransport` (anchor-based: `beatTime = anchorTime + (beatIndex - anchorBeatIndex) * beatDuration`) |
| **Readers** | `snapshot().beatTime` (:349), `.beatIndex` (:344), `.bar` (:343) → psyLive:651,656,677,682 |
| **CONFLICT** | ✅ CLEAN. No `nextNoteTime`, no `step` counter, no `barCount` in psyLive (grep confirmed — only in comments). |

**Verdict:** ✅ CLEAN

### 1.14 occupancy (radio role fill)

| Aspect | Value |
|--------|-------|
| **OWNER** | `RadioObservationLayer.occupancy` (private, :55) |
| **Writer(s)** | `process()` (:133-136) — smoothed from band energy |
| **Readers** | `snapshot().occupancy` → psyLive:845 (`this.occupancy = radioSnap.occupancy`) → scheduleStep gating (:690,696,699) + detect() ducking (:870-876) + session.observeRadio (:849) |
| **Duplicates** | `psyLive.occupancy` (:214) — mirrors `radioSnap.occupancy`. `psyLive.musicState.radioRoles` (:891) — mirrors `this.occupancy`. `MusicalContext.radioRoles` (:84) — mirrors `data.occupancy` from observeRadio. |
| **CONFLICT** | ⚠️ 4 copies. RadioObservationLayer.occupancy is authoritative. The others are mirrors. No actual conflict (all converge), but the data is copied 4 times. |

**Verdict:** ⚠️ REDUNDANT (4 copies, 1 owner)

### 1.15 currentNotePlan (cached bar plan)

| Aspect | Value |
|--------|-------|
| **OWNER** | `psyLive.currentNotePlan` (:265, private) |
| **Writer(s)** | `scheduleStep()` (:682) — `session.planBar()` called once per bar |
| **Readers** | `scheduleStep()` (:686) — filters notes by step |
| **CONFLICT** | ✅ CLEAN. Single cache, single writer, single reader. |

**Verdict:** ✅ CLEAN

### 1.16 currentMotif (phrase motif)

| Aspect | Value |
|--------|-------|
| **OWNER** | `MusicalSession.currentMotif` (:66, private) |
| **Writer(s)** | `handleNewPhrase()` (:308-324) — creates or transforms motif at phrase start |
| **Readers** | `planBar()` (:109) — `let motif = this.currentMotif!` → passed to generateLead |
| **CONFLICT** | ✅ CLEAN within session. But: `MusicalMemory.pickMotif` (the reward-weighted selector) is NEVER CALLED, so motif selection ignores learning. |

**Verdict:** ✅ CLEAN (but learning is disconnected — see Musical Authority)

---

## 2. CONFLICT SUMMARY

| Property | Owners | Verdict |
|----------|--------|---------|
| BPM | 1 owner + 2 mirrors | ✅ CLEAN |
| KEY | 1 owner (dead) | ❌ DEAD |
| STYLE | 3 owners | ⚠️ CONFLICT |
| ENERGY | 2 owners + 1 broken | ❌ BROKEN |
| DENSITY | 2 owners + 1 broken | ❌ BROKEN |
| TENSION | 1 owner + 1 broken + arc reverter | ❌ BROKEN |
| SECTION | derived | ✅ CLEAN |
| PHRASE | derived | ✅ CLEAN |
| RADIO STATUS | 4 state machines | ❌ CONFLICT |
| RADIO BPM | 1 owner (dead) | ❌ DEAD |
| RADIO KEY | missing | ❌ MISSING |
| BUS VOLUMES | 2 writers each | ⚠️ CONFLICT |
| beat/bar/time | 1 owner | ✅ CLEAN |
| occupancy | 1 owner + 3 mirrors | ⚠️ REDUNDANT |
| currentNotePlan | 1 owner | ✅ CLEAN |
| currentMotif | 1 owner | ✅ CLEAN |

---

## 3. THE OWNERSHIP CRISIS

The system has **6 clean properties** (BPM, section, phrase, beat/bar/time, notePlan, motif) and **10 broken/conflicted/dead properties** (key, style, energy, density, tension, radio status, radio BPM, radio key, bus volumes, occupancy redundancy).

The clean properties are all in the **time domain** (Transport + derived section/phrase). The broken properties are all in the **musical domain** (key, style, energy, density, tension) and the **radio domain** (status, BPM, key, volumes).

**Root cause:** Foundation (MusicalContext/MusicalSession) owns musical state, but psyLive retains parallel copies and write access. The bridge between them was never properly built — `getContext()` doesn't exist, `markConnected()` is never called, `pickMotif` is never called. The two halves of the system are **wired for power but not for data**.

---

## 4. TARGET OWNERSHIP (proposed)

| Property | Should be owned by | Writers (only) |
|----------|-------------------|----------------|
| BPM | MusicalTransport | setTempo, observeBeat (from radio) |
| KEY | MusicalContext | updateFromRadio (from real bassFreq), user setKey |
| STYLE | MusicalSession | user setStyle ONLY (remove detectStyle override) |
| ENERGY | MusicalContext | user setEnergy (fix API), updateFromRadio (read-only if user locked) |
| DENSITY | MusicalContext | user setDensity (fix API) |
| TENSION | MusicalContext | user setTension (fix API), arc target as DEFAULT not override |
| RADIO STATUS | RadioObservationLayer (single) | markConnected/markDisconnected/markError |
| BUS VOLUMES | psyLive (per-bus) | user setChannelVolume ONLY. Ducking → sidechain compressor, not gain clobbering |
| occupancy | RadioObservationLayer | process() only. Remove 3 mirror copies |
