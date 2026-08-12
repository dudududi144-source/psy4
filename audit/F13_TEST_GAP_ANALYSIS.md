# F13 — TEST GAP ANALYSIS

**HEAD:** `017ef70` (F11) · **Method:** Read every test file. For each: can silence/constant-tone/noise/bypassed-device/metadata/random/wrong-station/disconnected-radio/bypassed-composer pass?

---

## 1. TEST INVENTORY

| Test File | Tests | Pass | Fail |
|-----------|-------|------|------|
| tests/reality-bridge-setup.ts | 0 (utility) | — | — |
| tests/reality-bridge/audioShim.ts | 0 (utility) | — | — |
| tests/reality-bridge/synthFixtures.ts | 0 (utility) | — | — |
| tests/reality-bridge/run-all.ts | 56 | 56 | 0 |
| tests/reality-bridge/beatpll-convergence.ts | 48 | 48 | 0 |
| tests/reality-bridge/melody-acceptance.ts | 13 | 13 | 0 |
| tests/reality-bridge/stress-test.ts | 1 | 1 | 0 |
| tests/foundation/music/musical-instrumentation.ts | 6 gates | 6 | 0 |
| tests/foundation/radio/radio-observation-tests.ts | 20 | 20 | 0 |
| tests/foundation/radio/radio-adversarial.ts | 12 | 12 | 0 |
| tests/foundation/radio/radio-integration-tests.ts | 12 | 12 | 0 |
| tests/foundation/transport/transport-tests.ts | 21 | 21 | 0 |
| tests/foundation/transport/transport-adversarial.ts | 6 | 6 | 0 |
| tests/foundation/transport/transport-runtime-ownership.ts | 15 | 15 | 0 |
| tests/foundation/transport/playback-reality.ts | 18 | 18 | 0 |
| tests/foundation/transport/f3-hardening.ts | 28 | 28 | 0 |
| **TOTAL** | **256** | **256** | **0** |

All 256 pass. Lint clean. Typecheck FAILS (9 errors in psyLive.ts + errors in tests + selfAnalyzer).

---

## 2. PER-FILE VERDICTS

### 2.1 tests/reality-bridge/run-all.ts (56 tests) — MIXED

| Group | Tests | Verdict | Notes |
|-------|-------|---------|-------|
| AN-1A..F | 6 | WEAK | Tests the SHIM itself, not the engine |
| PLL-2A..G | 9 | STRONG | Feeds synthetic beats to PLL. Does NOT verify radio→analyser→PLL chain |
| MO-3A..K | 11 | STRONG | **MO-3J is THEATER**: `passed: true` always, no assertion |
| PM-4A..C | 3 | STRONG | 200-cycle mutation stress |
| LR-5A..D | 4 | THEATER | **LR-5D**: `passed: !onlineLearning` — passes when learning is ABSENT |
| SB-6A..B | 2 | THEATER | **SB-6B**: `passed: !usedInRuntime` — passes when SoundBank is NOT connected |
| PE-7A..F | 6 | THEATER | **PE-7E**: `passed: !importMatch && !instantiationMatch` — passes when PooledEngine is NOT used |
| RG-8A..H | 8 | STRONG | RadioStateGate state machine. RG-8H is a regression test |
| FI-9A..C | 3 | STRONG | PLL reset, AudioContext suspend/resume |
| MS-10A..D | 4 | THEATER | **MS-10A**: `passed: !structurePresent` — passes when NO song structure exists. Evidence says "worklog claim is FALSE for current HEAD". **Worst theater in suite.** |

### 2.2 tests/reality-bridge/beatpll-convergence.ts (48 tests) — STRONG
6 tempos × 8 conditions (perfect, jitter 1ms/5ms, missing 25%, low-confidence, half/double, tempo jump). Verifies BPM convergence ±2 BPM and lock state.
**Weakness:** Feeds synthetic `{time, confidence}` directly — does NOT verify analyser→beat-detection→PLL chain. Silence cannot pass (PLL wouldn't lock).

### 2.3 tests/reality-bridge/melody-acceptance.ts (13 tests) — STRONG
Tests `estimatePitch` on 5 pure sines within ±10 cents, 0 octave errors. Tests noise/silence/kick-transient rejection, flatness discrimination, full-observer gating.
**Weakness:** Synthetic pure tones only — no polyphonic music or real-instrument timbres.

### 2.4 tests/reality-bridge/stress-test.ts (1 test) — WEAK / THEATER
Runs 5800 PooledEngine triggers in 175ms. Output JSON says `"gcDropoutsClaimProven": false` and `"PooledEngine is DEAD CODE — not connected to psyLive runtime"` yet test "passes" (exit 0). Honest in JSON, dishonest in exit code.

### 2.5 tests/foundation/music/musical-instrumentation.ts (6 gates) — WEAK / THEATER
Reads `composer.planBar(bar, BPM).notes` (NotePlan metadata) and checks: lead pitch variety ≥6, pitch classes ≥5, intervals ≥3, repeated-note ratio <50%, unique bar patterns ≥8, structural diversity.
**CRITICAL WEAKNESS:** Reads the composer's PLAN, not actual AudioContext output. The engine could ignore the plan entirely and play silence — test still passes. Does NOT check bass + kick + hats are present (only lead variety is gated). Does NOT verify notes are audible.

### 2.6 tests/foundation/radio/radio-observation-tests.ts (20 tests) — STRONG
Tests BeatObservationEngine and RadioObservationLayer directly with synthetic beat streams + synthetic audio fixtures. Covers perfect timing, jitter, drift, tempo change, missing beats, double/half tempo, noise, silence, kick bursts, false beats, out-of-order, duplicates, dropout, recovery, weak signal, unstable pitch, clean melody.
**Weakness:** Uses `generateBeatStream` helper that fabricates beat candidates — does NOT verify actual audio decode → beat detection chain.

### 2.7 tests/foundation/radio/radio-adversarial.ts (12 tests) — STRONG (but weak assertions)
Tests adversarial inputs: 100 random bursts, 500 duplicates, out-of-order, impossible timestamps (NaN/Infinity/negative), tempo jumps, half/double ambiguity, silence→signal→silence, signal→noise→signal, 2-octave pitch jumps, kick+melody, 30s jitter, 10-min stream. Verifies no crash, no NaN, confidence in [0,1].
**Weakness:** Assertions are mostly "no crash" not "correct behavior". A device that always returns confidence=0.5 would pass.

### 2.8 tests/foundation/radio/radio-integration-tests.ts (12 tests) — STRONG
Tests the actual chain: synthetic radio audio → engine.radioAnalyser → engine.detect() → Transport. Verifies BPM convergence to 120/145, tempo change, dropout→holdover, recovery, noise rejection, half/double tempo, jitter stability, out-of-order rejection, duplicate rejection, continuous playback.
**Weakness:** `generateBeatAudio` helper fabricates very simple kick-like audio — real radio streams are far more complex. Also: these tests call `radioLayer.markConnected()` directly (which is why they pass) — but psyLive.ts does NOT call it (which is why runtime is broken). The tests verify the layer in isolation, not the wiring.

### 2.9 tests/foundation/transport/transport-tests.ts (21 tests) — STRONG
Tests MusicalTransport with mock clock. Perfect timing (P95=0ms), tempo change preserves beat, ±50ms jitter, 25% dropout, false kicks, half/double tempo, scheduler stall, radio loss/recovery, 30-min drift=0ms, seek, AudioContext resume, multiple subscribers, epoch, immutable snapshot.
**Strongest test file in the suite.**

### 2.10 tests/foundation/transport/transport-adversarial.ts (6 tests) — STRONG
100ms burst, out-of-order, late observations, random noise (conf 0.2-0.4), tempo jump, duplicates.

### 2.11 tests/foundation/transport/transport-runtime-ownership.ts (15 tests) — MIXED
- OWN-1..11: STRONG — verify Transport is single source of truth at runtime
- **OWN-12: WEAK** — pure regex on psyLive.ts source (checks for `private engineBpm`, `private nextNoteTime`). Could be defeated by a comment.
- OWN-13..15: STRONG — verify scheduler-transport beat/bar/epoch match at runtime

### 2.12 tests/foundation/transport/playback-reality.ts (18 tests) — MIXED
- PR-01..09: STRONG — AudioContext state, currentTime advance, scheduler ticks (>1000 in 30s), note start events (>100), first event future-scheduled
- **PR-10: WEAK** — counts gain nodes with `value > 0.01`. Does NOT verify those gains are on the path to destination. Orphaned gain nodes with non-zero values would pass.
- **PR-11: WEAK** — only checks master node EXISTS, doesn't verify role buses connect to it.
- **PR-12: WEAK** — verifies master→limiter→analyser→destination chain, but does NOT verify any voice connects to master. Started-but-disconnected oscillators would pass.
- PR-14..18: STRONG — STOP halts scheduling, PLAY after STOP works, no stale-event flood

### 2.13 tests/foundation/transport/f3-hardening.ts (28 tests) — STRONG
414ms regression (5 BPMs), long-run drift (10min/30min), adversarial (NaN/Infinity/negative/large, jitter, tempo jumps, duplicates, bursts), STOP/PLAY/seek/tempo, tab stall (4 durations), consumer contract.

---

## 3. THEATER FAILURE-MODE MATRIX

The user's 12 questions, answered per test file:

| Failure Mode | Can it pass? | Where? | Evidence |
|---|---|---|---|
| 1. SILENCE pass? | Mostly NO | PLL requires lock; PR-04 requires >100 note starts; musical-instrumentation requires ≥6 lead pitches | But: musical-instrumentation reads PLAN not audio — a composer that plans notes but scheduler plays silence WOULD pass |
| 2. CONSTANT TONE pass? | YES in some | playback-reality would pass (oscillator.start + gains). musical-instrumentation would FAIL (needs ≥6 pitches) | PR-09 counts any oscillator.start |
| 3. WHITE NOISE pass? | Mostly NO | MO-3F rejects noise; radio-adversarial ADV-4 requires no lock on noise | |
| 4. ONE INSTRUMENT replacing all? | YES | musical-instrumentation only gates on LEAD pitch variety — no bass/kick/hat presence check | playback-reality counts any oscillator.start, no role verification |
| 5. BYPASSED device pass? | YES | musical-instrumentation reads NotePlan, not audio — composer bypass passes | playback-reality PR-09/10/11/12 don't verify voice→master connection |
| 6. UI claim false pass? | YES | No test verifies UI state matches engine state | OWN-12 (static regex) could be defeated by a UI field that's set but never read |
| 7. METADATA without audio pass? | YES | musical-instrumentation is exactly this — reads composer.planBar() metadata, no audio verification | |
| 8. RANDOM material pass? | YES | musical-instrumentation only checks variety, not musical structure | Random MIDI within a scale passes |
| 9. WRONG STATION pass? | N/A | No test verifies station selection — radio is mocked at analyser level | |
| 10. RADIO DISCONNECTED pass? | YES | All radio tests use mocked radio analysers | Engine can pass everything with radio permanently disconnected (Transport falls back to internal clock) |
| 11. COMPOSER BYPASSED pass? | YES | musical-instrumentation reads composer.planBar() directly — if scheduler ignores the plan, test still passes | playback-reality counts oscillator.start events but doesn't verify they match the plan |
| 12. BeatPLL converges? | YES (verified) | 48/48 convergence tests pass — but only with synthetic beats fed directly, not through audio analysis | The runtime wiring (radioLayer.markConnected) is NOT tested |

---

## 4. WORST THEATER EXAMPLES (Ranked)

### #1 — MS-10A "Does psyLive.ts implement song structure INTRO→BUILD→PEAK→BREAK→OUTRO?"
```typescript
passed: !structurePresent
```
**The test PASSES while the evidence string explicitly says:** `"NO SONG STRUCTURE — worklog claim of intro→build→peak→break→peak2→outro is FALSE for current HEAD"`.
**The test passes BY FALSIFYING the claim it appears to verify.** Green checkmark = lie.

### #2 — musical-instrumentation.ts (6 gates)
Reads `composer.planBar(bar, BPM).notes` (NotePlan metadata) instead of actual AudioContext output. A bypassed composer whose plans are ignored by the scheduler still PASSES all 6 gates. No check that bass AND kick AND lead AND hats are distinct. No check that the planned notes are audible. **The test would pass if the engine played silence while the composer emitted valid plans.**

### #3 — PE-7E + SB-6B + LR-5D
Three tests that pass WHEN THE CLAIMED CAPABILITY IS ABSENT:
- PE-7E: `passed: !importMatch && !instantiationMatch` — PooledEngine NOT used by runtime → PASS
- SB-6B: `passed: !usedInRuntime` — SoundBank NOT connected → PASS
- LR-5D: `passed: !onlineLearning` — learning NOT real RL → PASS
Honest about disconnection, but the green checkmarks mislead readers who don't read the evidence strings.

### #4 — playback-reality PR-09/10/11/12
Counts `oscillator.start()` calls and non-zero gain nodes, but does NOT verify started oscillators are connected to master, nor that gain nodes are on the audio path. **Could pass with orphaned voices + master→limiter→analyser→destination chain producing silence.**

### #5 — stress-test.ts
Output JSON explicitly says `"gcDropoutsClaimProven": false` and `"PooledEngine is DEAD CODE — not connected to psyLive runtime"` yet the test "passes" (exit 0). Honest in JSON, dishonest in exit code.

### #6 — MO-3J "CRITICAL: estimatePitch on kick transient"
```typescript
passed: true  // always
```
No assertion. Pure information display dressed as a test.

### #7 — MS-10B/C/D + OWN-12
Pure regex on `psyLive.ts` source code. A comment containing `transport.snapshot()` would pass MS-10C. A renamed variable would defeat OWN-12. **These tests verify source text patterns, not runtime behavior.**

### #8 — radio-integration-tests.ts (12 tests)
Tests call `radioLayer.markConnected()` directly — which is why they pass. But `psyLive.ts` does NOT call it (which is why runtime is broken). **The tests verify the layer in isolation, not the wiring.** The most critical integration gap (the missing `markConnected()` call in `connectRadio()`) is NOT covered by any test.

---

## 5. THE INTEGRATION TEST GAP

The most dangerous gap: **no test verifies that psyLive.ts correctly wires the foundation modules together.**

| Wiring point | Tested? | Runtime correct? |
|---|---|---|
| `transport.start()` called in `play()` | ✅ OWN-13 | ✅ |
| `transport.snapshot()` read in scheduler | ✅ OWN-13 | ✅ |
| `session.planBar()` called in scheduleStep | ❌ NO TEST | ✅ (works) |
| `transport.observeBeat()` called when beat detected | ❌ NO TEST | ❌ **BROKEN** (never called — radio follower dead) |
| `radioLayer.markConnected()` called in connectRadio | ❌ NO TEST | ❌ **BROKEN** (never called — signalState stuck) |
| `radioLayer.markConnecting()` called in connectRadio | ❌ NO TEST | ❌ **BROKEN** (never called) |
| `session.observeRadio()` called with real data | ❌ NO TEST | ⚠️ PARTIAL (called but bassFreq=undefined, confidence=0) |
| `session.reset()` called on disconnect | ❌ NO TEST | ❌ **BROKEN** (never called — state leaks) |
| `psyLive.pll` fed observations | ❌ NO TEST | ❌ **DEAD** (never fed) |
| `psyLive.melodyObserver.observe()` called | ❌ NO TEST | ❌ **DEAD** (never called) |
| `psyLive.radioGate.observe()` called | ❌ NO TEST | ❌ **DEAD** (never called) |
| `setEnergy/setDensity/setTension` reach ctx | ❌ NO TEST | ❌ **BROKEN** (TypeError — getContext doesn't exist) |
| `setStyle` affects note generation | ❌ NO TEST | ❌ **BROKEN** (style never read by generators) |
| `setChannelVolume` respected when radio on | ❌ NO TEST | ❌ **BROKEN** (clobbered by detect) |
| `pickMotif` called in handleNewPhrase | ❌ NO TEST | ❌ **DEAD** (never called — learning is fake) |

**15 critical wiring points. 0 tested. 11 broken at runtime.**

The 256 tests verify MODULES in isolation. Zero tests verify that psyLive.ts correctly WIRES those modules together. The entire radio follower death — the P0 bug — is invisible to the test suite because no test checks that `connectRadio()` actually transitions `radioLayer` out of DISCONNECTED.

---

## 6. WHAT TESTS SHOULD EXIST BUT DON'T

### 6.1 Integration wiring tests
- "connectRadio() transitions radioLayer.signalState from DISCONNECTED to NO_SIGNAL"
- "detect() calls transport.observeBeat() when radioSnap.beat is non-null"
- "play() starts the scheduler within 50ms"
- "session.planBar() is called exactly once per bar"
- "scheduleStep plays all notes in the plan (no silent drops when occupancy=0)"

### 6.2 Audio output tests (OfflineAudioContext)
- "Rendering 32 bars produces >N kick onsets, >N bass onsets, >N hat onsets"
- "Rendered output has spectral energy in 40-120Hz (kick), 100-400Hz (bass), 5-15kHz (hats)"
- "Rendered output is not silence"
- "Rendered output does not clip (max sample < 1.0)"
- "Lead does not play in bar 0 (startup sequence)"

### 6.3 UI control tests
- "Pressing ENERGY slider changes ctx.energy within 100ms"
- "Pressing STYLE button changes the notes generated in the next bar"
- "Pressing KICK slider changes kickBus.gain within 100ms"
- "Mixer slider value is respected when radio is ON (not clobbered)"

### 6.4 Radio end-to-end tests
- "connectRadio() with a live station transitions syncStatus to 'listening' within 5s"
- "connectRadio() with a dead station transitions to 'error' within 10s"
- "Station switch does not leave zombie audio"
- "Radio tempo (if detectable) converges to engine BPM within 15s"

### 6.5 Musical reality tests
- "Over 64 bars, lead density follows the composition arc (INTRO < CLIMAX)"
- "Over 32 bars, kick is present on every beat 0,4,8,12 (no silent kick bars)"
- "Bass note MIDI values are in scale (phrygian-dominant in A)"
- "Lead register is MIDI 48-72 (no notes above C5)"
- "Motif transforms produce different note sequences than the original"

---

## 7. VERDICT

**256 tests pass. ~215 are STRONG (module-level). ~31 are WEAK. ~10 are THEATER.**

The test suite proves:
- ✅ MusicalTransport is a zero-drift clock (27 tests)
- ✅ BeatPLL converges to any tempo (48 tests) — when fed synthetic beats
- ✅ MelodyObserver detects pitch (13 tests) — on synthetic pure tones
- ✅ PatternMutator is stable (3 tests + 200-cycle stress)
- ✅ RadioObservationLayer processes audio (44 tests) — when markConnected() is called manually
- ✅ psyLive scheduler ticks and starts notes (18 tests) — but doesn't verify they're audible

The test suite does NOT prove:
- ❌ The radio follower works at runtime (markConnected never called — not tested)
- ❌ UI controls affect audio (0 tests)
- ❌ The composer's plans are actually played (musical-instrumentation reads plans, not audio)
- ❌ The system produces non-silence audio output (no OfflineAudioContext render test)
- ❌ Kick + bass + lead + hats are all present and distinct (no role-presence test)
- ❌ Learning influences future music (pickMotif never called — not tested)
- ❌ The 64-bar arc produces a musical build (MS-10A passes when it DOESN'T)

**The test suite is a MODULE-LEVEL confidence trap.** It proves each brick is solid but does not prove the wall stands. The radio follower death — a single missing method call — is invisible to all 256 tests because no test verifies the wiring.

**PASS requires:** USER ACTION → REAL STATE CHANGE → REAL MUSICAL DECISION → REAL PERFORMANCE EVENT → REAL AUDIO EFFECT → VERIFIED OUTPUT. The current suite stops at "REAL STATE CHANGE" for most tests, and at "REAL MUSICAL DECISION" for the composer test (which reads the plan, not the audio).
