# F13 — REBUILD PLAN

**HEAD:** `017ef70` (F11) · **Verdict:** READY FOR REBUILD (with mandatory ordering)

This document defines the KEEP/MERGE/REWIRE/REBUILD/DELETE/ARCHIVE decisions, the target architecture, the implementation order, and the vertical slices.

---

## 1. DECISION TABLE (per major subsystem)

| Subsystem | Decision | Rationale | Effort |
|-----------|----------|-----------|--------|
| **MusicalTransport** | **KEEP** | Zero-drift clock, 27 tests, clean ownership. The single most verified component. | 0 |
| **TransportAdapter** | **DELETE** | Instantiated at psyLive:406, 0 method calls ever. Dead weight. | S |
| **RadioObservationLayer** | **REWIRE** | The layer is well-built (44 tests pass when markConnected is called). The WIRING to psyLive is broken. Fix: call `radioLayer.markConnecting()` + `markConnected()` in connectRadio(). | S |
| **BeatObservationEngine** | **KEEP** | Strong beat detection, 20 tests. Works when fed. | 0 |
| **MelodyObserver (in radioLayer)** | **REWIRE** | YIN pitch detection works (13 tests). But the pitch block at RadioObservationLayer.ts:183 never runs (signalState stuck). Fixed by the same markConnected() fix. Also: radioSnap.pitch is never consumed — wire it to MusicalContext for key detection. | M |
| **psyLive.pll (field)** | **DELETE** | Dead instance. The live PLL is inside radioLayer. Remove the field + the `pll.reset()` call in disconnectRadio (radioLayer.reset() already resets its internal PLL). | S |
| **psyLive.melodyObserver (field)** | **DELETE** | Dead instance. Only used for `ensureTimeDomainBuf()`. Replace with a local utility function. The live MelodyObserver is inside radioLayer. | S |
| **psyLive.radioGate (RadioStateGate)** | **DELETE** | 7-state machine, `observe()` never called, frozen at CONNECTED_NO_SIGNAL. Decorative. radioLayer's signalState is the real state machine. Remove the field + the radioGate calls in connectRadio/disconnectRadio + the radioState/radioSignalRms/radioNonZeroRatio fields in LiveState. | S |
| **MusicalSession** | **REWIRE + EXTEND** | The composer is structurally sound (generates valid plans, 64-bar arc, phrase structure). But: (1) ABSTAIN is comment-only — implement as real action. (2) pickMotif is never called — wire it in handleNewPhrase. (3) Lead enters on bar 0 — add startup sequence. (4) 64-bar arc cycles — make one-shot or add sustained state. (5) Style field is dead — either wire it to generators or remove it. | M |
| **MusicalContext** | **REWIRE** | (1) Add public `setEnergy/setDensity/setTension/setKey/setStyle` methods (fix the getContext() broken pattern). (2) Make user-set values STICK (don't let updateFromRadio/updateFromTransport overwrite them without a "user locked" flag). (3) Wire bassFreq from radioLayer's pitch observation. | M |
| **MusicalMemory** | **REWIRE** | pickMotif (reward-weighted selector) exists but is never called. Wire it in handleNewPhrase. If reward is too noisy, tune the EMA. If reward is fundamentally useless, DELETE the reward computation and be honest about non-learning. | S |
| **primitives/bass.ts** | **DELETE** | 112 lines, never imported. MusicalSession generates bass inline. | S |
| **primitives/chords.ts** | **DELETE** | 108 lines, never imported. No harmony generation exists. | S |
| **primitives/rhythm.ts** | **DELETE** | 134 lines, never imported. MusicalSession uses hardcoded step arrays. | S |
| **primitives/scales.ts** | **KEEP** | Used by motif.ts and MusicalSession. | 0 |
| **primitives/motif.ts** | **KEEP** | Used by MusicalSession. generateMotif + transforms are clean. | 0 |
| **primitives/rng.ts** | **KEEP** | Used everywhere. Clean mulberry32. | 0 |
| **RadioMusicalWindow** | **KEEP** | Clean history tracking. | 0 |
| **psyLive (audio graph)** | **REWIRE** | Audio graph is structurally sound. Fix: (1) Move role ducking from detect() to a sidechain compressor (respect user mixer). (2) Remove hatBus forced 0.6. (3) Fix stale comment at line 748. (4) Add delayFb safety clamp (max 0.85). (5) Make Variant.leadWave actually used (or remove the field). | M |
| **psyLive (scheduler)** | **KEEP** | Reads Transport directly, schedules 16th notes. Clean. | 0 |
| **psyLive (radio connect/disconnect)** | **REWIRE** | Add: `radioLayer.markConnecting()` + `radioLayer.markConnected()` in connectRadio. Add `session.reset()` in disconnectRadio. Add reconnect/backoff. | S |
| **psyLive (detect loop)** | **REWIRE** | Remove: bus gain clobbering (lines 867-877). Move to sidechain. Remove: dead `this.pll`, `this.melodyObserver`, `this.radioGate` references. Keep: occupancy update, style detection (but make it not overwrite user-set style), energy history. | M |
| **psyLive (setEnergy/setDensity/setTension)** | **REBUILD** | Fix: call `session.setEnergy(v)` etc. (add public methods to MusicalSession that delegate to MusicalContext). Remove the broken `(session.getContext() as any)` pattern. | S |
| **psyLive (setStyle)** | **REBUILD** | Fix: call `session.setStyle(style)`. Add a `userStyleLocked` flag so detectStyle doesn't overwrite. Or: remove auto-detection entirely and let the user own style. | S |
| **page.tsx (UI)** | **REBUILD** | 290-line dashboard. Rebuild from user workflow. Use shadcn/ui (50 files available, currently unused). Fix: 4 forbidden colors, mobile responsiveness, touch targets, remove window.__psy4TransportDebug, remove fake role bars, wire all controls to real runtime effects. | L |
| **PRESETS (4 hardcoded)** | **KEEP + CLARIFY** | bpm + variants are used. patterns are dead (session generates own). root is dead (session uses ctx.rootPc). Either: (a) remove dead fields, or (b) wire them. | S |
| **SoundBank (142 presets)** | **ARCHIVE** | Valid data, not connected. Either wire it in (future material library) or move to a separate data file. Don't leave it as a 698-line ghost. | S |
| **PooledEngine** | **ARCHIVE** | 508 lines, 6 tests, not imported. Experimental backend. Move to a separate module or delete. | S |
| **learning.ts** | **REWIRE** | recordKick/deriveInsights/generateComposition exist. But: (1) recordKick only fires when transportSnap.locked (never true — dead). (2) generateComposition is called by toggleComposition (not in UI). Fix: record kicks from session events, not from PLL lock. Wire toggleComposition to a UI control. | M |
| **studio/engine/ (70 files)** | **ARCHIVE** | 34,185 lines. 0% live, 17% API-only, 83% dead. Move to a separate `archive/` directory or delete. Do NOT attempt to integrate. | M |
| **patternMutator.ts** | **ARCHIVE** | 260 lines, 3 tests. Was used pre-F8. Not imported by psyLive at HEAD. Dead. | S |
| **beatPLL.ts (src/lib/)** | **ARCHIVE** | 213 lines. The live PLL is inside RadioObservationLayer → BeatObservationEngine → BeatPLL. This file is a duplicate. | S |
| **melodyObserver.ts (src/lib/)** | **ARCHIVE** | 394 lines. The live MelodyObserver is inside RadioObservationLayer. This file is only used for `ensureTimeDomainBuf()`. Replace with utility. | S |
| **radioStateGate.ts** | **ARCHIVE** | 169 lines. Superseded by RadioObservationLayer's signalState. | S |

---

## 2. TARGET ARCHITECTURE

```
USER
 ↓
MUSIC DIRECTOR UI (page.tsx — REBUILT)
  ├── Transport (Play/Stop, BPM, Tap)
  ├── Musical Direction (Style, Key, Energy, Density, Tension)
  ├── Scene / Arrangement (Section, Break, Climax)
  ├── Radio (Station, Connect, Status)
  ├── Mix (per-bus Vol/Mute/Solo)
  └── FX (Filter, Delay, Reverb, Drive, Width)
 ↓
PSY4 STATE ADAPTER (psyLive.ts — REWIRED)
  ├── Public API: play/stop/setStyle/setEnergy/.../connectRadio/...
  ├── Single state bridge between UI and foundation
  └── NO parallel state copies
 ↓
FOUNDATION (the authority)
  ├── MusicalTransport (clock — KEEP)
  ├── RadioObservationLayer (radio analysis — REWIRED)
  │    └── BeatObservationEngine → BeatPLL (beat tracking)
  │    └── MelodyObserver (pitch detection)
  ├── MusicalSession (composer — REWIRED + EXTENDED)
  │    ├── planBar() → NotePlan (WHAT)
  │    ├── calculateLeadDensity() (WHETHER lead plays)
  │    ├── handleNewPhrase() → pickMotif() (WHICH motif — wire reward)
  │    └── ABSTAIN action (real rest, not numeric gate)
  ├── MusicalContext (musical state — REWIRED)
  │    ├── Public setters (setEnergy/setDensity/setTension/setKey/setStyle)
  │    ├── User-locked flag (prevent radio overwrite of user choices)
  │    └── updateFromRadio (read-only when user-locked)
  └── MusicalMemory (learning — REWIRED)
       └── pickMotif (reward-weighted selection — WIRED IN)
 ↓
PSY4 PERFORMANCE ADAPTER (psyLive.ts)
  ├── Scheduler (reads Transport, plays NotePlan — KEEP)
  ├── Voices (kick/bass/lead/hat — KEEP)
  ├── Buses (kickBus/bassBus/leadBus/hatBus → engineBus — KEEP)
  ├── FX (delay/reverb — KEEP; filter/drive/width — ADD)
  ├── Sidechain ducking (REPLACE gain clobber)
  └── Master chain (comp → master → safetyLimiter → analyser → destination — KEEP)
 ↓
OUTPUT
```

**RADIO PATH:**
```
RADIO
 ↓
HTMLAudioElement → MediaElementSource → radioGain → radioAnalyser → engineBus
 ↓
RadioObservationLayer.process()
  ├── signalState (markConnected wired — FIXED)
  ├── Beat detection → transport.observeBeat() → PLL locks → BPM follows
  ├── Pitch observation → MusicalContext.updateFromRadio(bassFreq) → key detection
  └── Occupancy → MusicalSession.observeRadio() → density/velocity adaptation
 ↓
MusicalSession.planBar() adapts to radio context
 ↓
Scheduler plays adapted plan
 ↓
Audio output complements radio (ducked via sidechain, not clobbered)
```

---

## 3. IMPLEMENTATION ORDER (DEPENDENCY-DRIVEN)

### Phase R1 — Wire the Radio Follower (P0, fixes the biggest lie)
**Files:** psyLive.ts (connectRadio, disconnectRadio, detect)
1. In `connectRadio()`: add `this.radioLayer.markConnecting(); this.radioLayer.markConnected();`
2. In `disconnectRadio()`: add `this.session.reset();`
3. In `detect()`: verify `radioSnap.beat` is now non-null when signal is present
4. Remove dead `this.pll`, `this.melodyObserver` (field), `this.radioGate` fields + their calls
5. Replace `this.melodyObserver.ensureTimeDomainBuf()` with a local utility
6. **Verification:** OfflineAudioContext render with synthetic beat audio → transport.observeBeat called → PLL locks → BPM converges

### Phase R2 — Fix the Musical Controls (P0, fixes the second biggest lie)
**Files:** MusicalContext.ts, MusicalSession.ts, psyLive.ts
1. Add `MusicalContext.setEnergy(v)`, `setDensity(v)`, `setTension(v)`, `setKey(rootPc, scaleName)`, `setStyle(style)` — public methods
2. Add `userLocked: boolean` flag per property. When user sets a value, `userLocked = true`. `updateFromRadio` and `updateFromTransport` skip user-locked properties.
3. Add `MusicalSession.setEnergy(v)` etc. that delegate to `this.ctx.setEnergy(v)`
4. Fix `psyLive.setEnergy(v)` → `this.session.setEnergy(v)` (remove broken `getContext()` pattern)
5. Same for setDensity, setTension, setStyle, setKey
6. **Verification:** UI slider → ctx.energy changes → detect() doesn't overwrite → generator reads it

### Phase R3 — Fix the Mixer (P1, respects user intent)
**Files:** psyLive.ts (detect, scheduleStep), new sidechain module
1. Remove bus gain clobbering from `detect()` (lines 867-877)
2. Add a sidechain compressor: radioAnalyser envelope → compressor on kickBus/bassBus (ducking via sidechain, not gain write)
3. User's `setChannelVolume()` is now the SOLE writer of bus.gain
4. Add mute/solo: `setChannelMute(ch, bool)`, `setChannelSolo(ch, bool)`
5. Remove hatBus forced 0.6
6. **Verification:** User sets kickBus to 0.5 → radio connects → kickBus stays 0.5 (sidechain compresses, not overwrites)

### Phase R4 — Fix the Composer (P1, startup sequence + learning)
**Files:** MusicalSession.ts, MusicalMemory.ts
1. `calculateLeadDensity`: return 0 for INTRO (bars 0-7). Lead enters at STATEMENT (bar 8).
2. Implement ABSTAIN as a real action: `planBar()` can return `{ action: 'ABSTAIN', notes: [] }` — scheduler respects it (plays nothing)
3. Wire `pickMotif()` in `handleNewPhrase()`: when choosing a motif for a group, use reward-weighted selection instead of `motifGroups[groupIdx][0]`
4. Make 64-bar arc one-shot: after bar 63, transition to 'SUSTAINED' state (hold CLIMAX density) instead of cycling to INTRO
5. Wire `session.style` to generators: if style='DARK', use darker scale / lower bass octave / sparser hats. If style='ACID', use resonant filter on lead. Make style affect actual notes.
6. **Verification:** Bar 0-7 has no lead. pickMotif is called. Style changes produce different notes.

### Phase R5 — Fix the Radio Key Detection (P1)
**Files:** psyLive.ts (detect), MusicalContext.ts
1. Wire `radioSnap.pitch.frequency` → `psyLive.bassFreq` (when pitch confidence > 0.5)
2. `observeRadio()` now passes real bassFreq → `MusicalContext.updateFromRadio` key branch fires → key changes
3. UI KEY metric now shows detected key
4. **Verification:** Play a synthetic A2 tone → bassFreq = 110 → key = A

### Phase R6 — Rebuild the UI (P2, but highest user visibility)
**Files:** page.tsx (full rewrite), new components
1. Use shadcn/ui components (Button, Slider, Card, Tabs, Select, Switch, Tooltip)
2. Information architecture per §9 of F13_UI_FORENSIC.md
3. Transport section: Play/Stop, BPM display + Tap tempo, master Volume
4. Musical Direction: Style (Select), Key (display + Select), Energy/Density/Tension (Sliders with real effect)
5. Arrangement: Section display, Break trigger, manual Section jump
6. Radio: Station Select (with health indicator), Connect/Disconnect, Status badge, Radio Volume
7. Mix: per-bus Volume + Mute + Solo (4 buses)
8. FX: Delay (Time/Feedback/Mix), Reverb (Size/Mix), Filter (Cutoff/Resonance), Drive (Amount)
9. Remove: window.__psy4TransportDebug, fake role bars, debug metrics as primary UI
10. Fix: 4 forbidden colors, mobile responsiveness, 44px touch targets
11. **Verification:** Every control has a visible audio effect. Every runtime state is reflected in UI.

### Phase R7 — Fix the Stations (P2)
**Files:** psyLive.ts (STREAMS), page.tsx
1. Remove 3 dead station URLs (psyndora-prog, psyndora-chill, radiocaprice-psy)
2. Add health-check: on connectRadio, if `radioEl.play()` fails or no signal within 10s, transition to ERROR state
3. Add reconnect with exponential backoff (1s, 2s, 4s, 8s, max 30s)
4. UI: show station health indicator (green/yellow/red)
5. **Verification:** Dead station → ERROR within 10s. Live station → LISTENING within 5s.

### Phase R8 — Destroy the Test Theater (P2)
**Files:** tests/
1. Replace musical-instrumentation.ts: render 32 bars via OfflineAudioContext, verify actual audio output (kick onsets, bass presence, lead register)
2. Replace MS-10A: if song structure is claimed, test that lead density at bar 0 < lead density at bar 48. If it doesn't, FAIL.
3. Replace PE-7E/SB-6B/LR-5D: if capability is absent, test should FAIL (not pass). Or: move to a separate "known gaps" suite that doesn't green-check.
4. Add integration wiring tests (see F13_TEST_GAP_ANALYSIS.md §6.1)
5. Add audio output tests (OfflineAudioContext render)
6. Add UI control tests (React Testing Library)
7. **Verification:** A bypassed composer FAILS the new instrumentation test. Silence FAILS.

### Phase R9 — Archive the Dead Code (P2)
**Files:** studio/engine/, SoundBank, PooledEngine, patternMutator, beatPLL (src/lib), melodyObserver (src/lib), radioStateGate
1. Move studio/engine/ to archive/studio-engine/ (34,185 lines, not deleted but out of the way)
2. Move SoundBank to archive/sound-bank/ (future material library)
3. Move PooledEngine to archive/pooled-engine/
4. Delete patternMutator, beatPLL (src/lib), melodyObserver (src/lib), radioStateGate (superseded)
5. Delete primitives/bass.ts, chords.ts, rhythm.ts (never imported)
6. Delete TransportAdapter (never used)
7. **Verification:** `tsc --noEmit` passes. `bun run lint` passes. Dev server starts. Page renders.

---

## 4. VERTICAL SLICES

### Vertical Slice 1 — Engine Only (no radio, no UI)
```
PLAY → Transport → Scheduler → MusicalSession.planBar()
  → Kick + Bass + Hats + Lead (lead RESTS at bar 0)
  → Voices → Buses → Comp → Master → Limiter → Destination
```
**Proof:** OfflineAudioContext render of 32 bars. Verify: 128 kicks, 256 bass notes, 128 hats, 0 lead notes in bars 0-7, lead present in bars 8+.

### Vertical Slice 2 — Engine + Radio
```
Same as Slice 1
+ connectRadio(psyndora)
  → radioLayer.markConnected() (FIXED)
  → radioLayer.process() → beat detection → transport.observeBeat()
  → PLL locks → BPM follows radio
  → occupancy → session.observeRadio() → density/velocity adaptation
  → sidechain ducking (not gain clobber)
```
**Proof:** connectRadio → syncStatus transitions to 'listening' within 5s → 'following' within 15s → engineBpm converges to radio BPM (±5).

### Vertical Slice 3 — Engine + Radio + New UI
```
Same as Slice 2
+ Rebuilt page.tsx with shadcn/ui
  → Every control wired to real runtime effect
  → Every runtime state reflected in UI
  → No forbidden colors, mobile-responsive, 44px touch targets
  → No debug surface exposed
```
**Proof:** Agent Browser verification. Click each control → verify audio/state change. Verify mobile layout. Verify sticky footer.

---

## 5. WHAT NOT TO DO

1. **DO NOT** attempt to integrate studio/engine/ (34,185 lines of dead code). Archive it.
2. **DO NOT** wire SoundBank into the live runtime. It's a future material library. Archive it.
3. **DO NOT** preserve RadioStateGate. It's superseded by RadioObservationLayer.signalState.
4. **DO NOT** keep parallel state copies (musicState.bpm, ctx.bpm, etc.). One owner per property.
5. **DO NOT** add new features before fixing the existing ones. The system has 13 FALSE claims. Fix those first.
6. **DO NOT** patch symptoms. The radio follower death is ONE missing method call. The broken setters are ONE missing API (getContext). Fix the root causes.
7. **DO NOT** report PASS because tests are green. The test suite has a 15-point integration gap. Add wiring tests.
8. **DO NOT** rebuild the audio graph. It's structurally sound. Rewire (de-clobber) only.
9. **DO NOT** rebuild the Transport. It's the most verified component. Keep it.
10. **DO NOT** rebuild MusicalSession. It's structurally sound. Extend (ABSTAIN, pickMotif, startup sequence, one-shot arc).

---

## 6. EFFORT ESTIMATE

| Phase | Effort | Priority | Dependency |
|-------|--------|----------|------------|
| R1 — Wire radio follower | S (1 fix + cleanup) | P0 | None |
| R2 — Fix musical controls | S-M (add public API + userLocked) | P0 | None |
| R3 — Fix mixer (sidechain) | M (new sidechain module) | P1 | R2 |
| R4 — Fix composer | M (startup + ABSTAIN + pickMotif + arc) | P1 | R2 |
| R5 — Fix radio key detection | S (wire bassFreq) | P1 | R1 |
| R6 — Rebuild UI | L (full page.tsx rewrite) | P2 | R1-R5 |
| R7 — Fix stations | S (remove dead + health check) | P2 | R1 |
| R8 — Fix tests | M (rewrite theater + add integration) | P2 | R1-R5 |
| R9 — Archive dead code | M (move 34k lines) | P2 | R1-R8 |

**Critical path:** R1 → R2 → R3/R4 (parallel) → R5 → R6 → R8

**Minimum viable fix (P0 only):** R1 + R2. This makes the radio follower work and the musical controls work. Everything else is polish.

---

## 7. SUCCESS CRITERIA

The rebuild is COMPLETE when ALL of the following are true:

1. ✅ `radioLayer.markConnected()` is called in `connectRadio()` → signalState transitions → beat detection runs → PLL locks → `syncStatus` reaches 'following' with a live station
2. ✅ `setEnergy(v)` / `setDensity(v)` / `setTension(v)` call public methods on MusicalSession → ctx values change → values are NOT overwritten by updateFromRadio/updateFromTransport (user-locked) → generators read them
3. ✅ `setStyle(style)` changes the notes generated in the next bar (different scale/bass octave/hat density per style)
4. ✅ Mixer sliders are respected when radio is ON (sidechain ducking, not gain clobber)
5. ✅ Lead does NOT play in bars 0-7 (INTRO = groove only)
6. ✅ `pickMotif()` is called in `handleNewPhrase()` → reward influences motif selection
7. ✅ `bassFreq` is assigned from `radioSnap.pitch.frequency` → key detection works → KEY metric shows detected key
8. ✅ 3 dead station URLs removed, health check present, reconnect backoff present
9. ✅ UI rebuilt with shadcn/ui, every control wired to real effect, no forbidden colors, mobile-responsive
10. ✅ `window.__psy4TransportDebug` removed from production
11. ✅ musical-instrumentation test renders OfflineAudioContext audio (not NotePlan metadata)
12. ✅ Integration wiring tests exist for all 15 wiring points (see F13_TEST_GAP_ANALYSIS.md §5)
13. ✅ `tsc --noEmit` passes (0 errors)
14. ✅ `bun run lint` passes
15. ✅ Agent Browser verification: Play → kick+bass+hats (no lead) → radio connect → following → mixer respected → UI reflects state

**PARTIAL PASS is not PASS.** If any of the above is false, the gate is BLOCKED.
