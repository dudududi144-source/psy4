# PSY4 — FULL SYSTEM REALITY BRIDGE

## Forensic Verification of Everything Already Built

**Audit date:** 2026-08-12
**Auditor roles:** Principal Audio Systems Engineer · Principal DSP Engineer · Real-Time Systems Architect · Release Integrity Engineer · Adversarial Verification Engineer
**Method:** Static source read + dynamic AudioContext-shim regression tests (56 tests) + 10-min PooledEngine stress test (5800 notes)

---

## REPOSITORY

```text
HEAD:      b6fb3a78559440aa12838000c38a02917799b541
REMOTE:    b6fb3a78559440aa12838000c38a02917799b541
LOCAL==REMOTE: TRUE
WORKTREE:  clean (no uncommitted changes at freeze)
BRANCH:    main
PACKAGE:   bun
LAST 20 COMMITS: confirmed (BeatPLL ccb22bb → scheduler 4aab398 → pattern mutation cfb9e8b → MelodyObserver 325432c → Float32 fix b6fb3a7)
```

Repository was frozen at HEAD `b6fb3a7` and verified against `origin/main` via `git ls-remote`. No code modifications to existing files were made during this audit (the only additions are: `src/lib/radioStateGate.ts` corrective gate, `tests/reality-bridge/` test harness, and the three audit reports).

---

## BUILD

```text
BUILD:     next dev runs (HTTP 200 on /, dev server log shows successful compiles)
TYPECHECK: implicit via next dev (no standalone tsc configured)
LINT:      eslint configured (bun run lint)
TESTS:     NEW — tests/reality-bridge/run-all.ts (56 tests, 44 pass / 12 fail)
           NEW — tests/reality-bridge/stress-test.ts (5800 notes, 0 crashes)
```

---

## CAPABILITY MATRIX

| System | Implemented | Connected | Executed | Observed | Verified | Level |
| ------ | ----------: | --------: | -------: | -------: | -------: | ----: |
| Radio acquisition (HTMLAudio+MediaSource) | ✓ | ✓ | ✓ | ✓ | ✗ | 3 |
| Radio analyser (AnalyserNode API) | ✓ | ✓ | ✓ | ✓ | ✓ | 4 |
| Feature extraction (energy/bass/kick/bands) | ✓ | ✓ | ✓ | ✓ | ✓ | 4 |
| BeatPLL (phase+tempo tracking) | ✓ | ✓ | ✓ | ✓ | **✗** | **2** |
| Scheduler (PLL-synced) | ✓ | ✓ | ✓ | ✓ | ✓ | 4 |
| PatternMutator (8-bar evolution) | ✓ | ✓ | ✓ | ✓ | ✓ | 5 |
| MusicState (style+density) | ✓ | ✓ | ✓ | ✓ | ✓ | 4 |
| Song structure (INTRO→BUILD→PEAK→BREAK→OUTRO) | **✗** | ✗ | ✗ | ✗ | ✗ | **0** |
| MelodyObserver (pitch+gates) | ✓ | ✓ | ✓ | ✓ | **✗** | **2** |
| SoundBank (142 presets) | ✓ | **✗** | ✗ | ✓ | ✓ | **1** |
| PooledEngine (voice pools) | ✓ | **✗** | ✗ | ✓ | ✓ | **1** |
| Per-role buses + ducking | ✓ | ✓ | ✓ | ✓ | ✓ | 4 |
| Master chain (comp+delay) | ✓ | ✓ | ✓ | ✓ | ✓ | 3 |
| Continuous learning / REINFORCE | ✓ | ✓ | ✓ | ✓ | ✓ (as NOT-RL) | 4 |
| Self-recovery / health monitor | **✗** | ✗ | ✗ | ✗ | ✗ | **0** |
| RadioStateGate (explicit state machine) | ✓ (NEW) | ✗ | ✗ | ✓ | ✓ | 4 |
| Failure injection / recovery | ✓ | ✓ | ✓ | ✓ | ✓ | 4 |
| 142-preset enumeration | ✓ | ✗ | ✗ | ✓ | ✓ | 4 |
| PooledEngine 10-min stress | ✓ | ✗ | ✓ | ✓ | ✗ | 3 |
| Studio engine (continuousTrainer etc.) | ✓ | ✗ | ✗ | ✗ | ✗ | **1** |

**Level distribution:** 2 × Level 0 (CLAIM ONLY) · 3 × Level 1 (CODE EXISTS, disconnected) · 2 × Level 2 (CONNECTED but broken) · 3 × Level 3 (RUNTIME EXECUTED) · 8 × Level 4 (MEASURED/VERIFIED) · 1 × Level 5 (ADVERSARIAL+LONG-RUN VERIFIED)

---

## REALITY FAILURES

No euphemisms. These are the things the evidence shows DO NOT WORK:

### R1. BeatPLL cannot follow radio tempo
**Tests:** PLL-2A, PLL-2B-130, PLL-2B-140, PLL-2C, PLL-2D, PLL-2E, PLL-2F (7 of 9 BeatPLL tests fail)

**Evidence:**
- 120 BPM input → finalBpm=149.36 (locked=true, but locked to WRONG tempo)
- 130 BPM input → finalBpm=149.58
- 140 BPM input → finalBpm=149.79
- 150 BPM input → finalBpm=150.00 (PASSES — only because default bpm=150)
- Tempo jump 120→145: bpmMid=149.36, bpmEnd=149.36 (PLL NEVER adapts)
- ±5ms jitter: bpmErr=4.84 (cannot track even with stable input)
- 25% missing beats: bpmErr=4.90 (cannot recover from gaps)
- Extra low-confidence transients: bpmErr=4.66 (cannot reject false positives)

**Root cause:** `tempoGain=0.025` (beatPLL.ts:41) is too small, AND the guard at line 72 (`observedPeriod < 60 / 80` = 0.75s) rejects the corrected-period computation because `observedPeriod = obs.time - this.beatTime` (line 71) reads `beatTime` AFTER it has been phase-corrected (line 68), producing a doubled period when the PLL's internal beatTime lags behind true beat times.

**Consequence:** The engine announces `syncStatus = 'following'` based on `isLocked()` being true, but the lock is to 150 BPM regardless of actual radio tempo. The "REAL-TIME RADIO FOLLOWER" claim is FALSE.

### R2. MelodyObserver does not observe melody
**Tests:** MO-3A, MO-3B, MO-3C, MO-3H, MO-3K (5 of 11 MelodyObserver tests fail)

**Evidence:**
- 440 Hz input → detected 109.98 Hz (octaveErr=-2, conf=1.00)
- 220 Hz input → detected 109.98 Hz (octaveErr=-1)
- 523.25 Hz (C5) input → detected 130.86 Hz (octaveErr=-2)
- Clean 440 Hz signal produces ZERO observations (gate rejects it)
- spectralFlatness returns 0.85 for pure tone with noise floor (gate threshold=0.5)

**Root cause 1:** `estimatePitch()` (melodyObserver.ts:32-83) uses normalized autocorrelation. The function comment claims "less octave errors" but the normalized ACF has the property that lag=2×, 3×, 4× also produce high correlation peaks. The function picks the LAG with highest correlation, but for a 440 Hz signal, lag at 4× the true period (i.e. 110 Hz) wins because the longer averaging window produces a marginally higher normalized score. There is no sub-harmonic cancellation or parabolic interpolation.

**Root cause 2:** `spectralFlatness()` (melodyObserver.ts:89-109) clamps zero bins to 1 via `Math.max(1, magnitudes[i])`. For a spectrum with mostly quiet bins (say, value=5) and one peak (value=255), the geometric mean is dominated by the 5s and the arithmetic mean is dragged up by the 255. Result: flatness ≈ 0.85 for what is clearly a tonal signal. The `flatness > 0.5` gate then REJECTS it.

**Consequence:** The "MELODY FOLLOWER" claim is FALSE. `getMelodyObservations()` returns an effectively-empty array for clean tonal input. The downstream MotifLearner (P2, not yet built) would receive no observations to learn from.

### R3. "LISTENING" state set without signal verification
**Test:** RG-8H

**Evidence:** psyLive.ts:613-615
```ts
try { await this.radioEl.play(); } catch {}
this.radioOn = true;
this.syncStatus = 'listening';
```

The `await play()` only confirms the play() promise resolved — it does NOT prove audio samples are flowing through the analyser. The user's reported symptom ("LISTENING but kicks=0, FOLLOWING=false") is exactly this bug.

**Corrective gate implemented:** `src/lib/radioStateGate.ts` defines DISCONNECTED/CONNECTING/CONNECTED_NO_SIGNAL/CONNECTED_SIGNAL/PLAYING_SIGNAL/BUFFERING/ERROR with explicit signal-verification rules (rms > 1e-4, nonZeroRatio > 0.05, signalAgeMs < 2000). NOT YET WIRED into psyLive.ts (applying the fix is beyond the audit's "no new features" boundary).

### R4. PooledEngine is dead code
**Test:** PE-7E

**Evidence:** psyLive.ts imports `PooledEngine` in a COMMENT ONLY (line 5: "psy uses createOscillator directly (no PooledEngine...)"). The runtime uses inline `ctx.createOscillator()` + `ctx.createGain()` + `ctx.createBiquadFilter()` per note (psyLive.ts:360-417), creating ~39 new AudioNodes/sec at 145 BPM 16th notes.

**Consequence:** The "No GC Dropouts" claim (commit 2b750bb "CONNECT SOUND BANK TO ENGINE: PooledEngine plays 142 presets") is FALSE for the runtime. The PooledEngine module exists, passes its own stress test (5800 notes, no crash, no leak), but is NOT connected.

### R5. SoundBank 142 presets are disconnected
**Test:** SB-6B

**Evidence:** psyLive.ts:16 imports `SOUND_BANK, getById, autoSelect` but none are called anywhere in the file. The runtime uses 4 hardcoded presets (PRESETS array, psyLive.ts:54-111) with inline synth parameters, NOT the 142-preset library.

**Consequence:** The "142 professional presets" claim is misleading. The presets exist as valid data (SB-6A: 142/142 valid, 0 NaN) but the runtime does not use them.

### R6. Song structure does not exist at HEAD
**Test:** MS-10A

**Evidence:** Grep for INTRO/BUILD/PEAK/BREAK/OUTRO in psyLive.ts → all false. The worklog (honest-test-v11, line "Song structure cycles (intro→build→peak→break→peak2→outro)") is STALE — that code was added in commit 79fe7c1 but REMOVED in commit 020c155 "REBUILD FROM SCRATCH".

### R7. Self-recovery / health monitor does not exist at HEAD
**Evidence:** Grep for `healthMonitor`, `selfRecovery`, `autoResume` in psyLive.ts → NOT FOUND. The only `resume()` call is on user gesture (line 300: `if (this.ctx.state === 'suspended') this.ctx.resume()`), not a periodic health check. The worklog claim "AudioContext auto-resumes (health monitor)" is FALSE for HEAD.

### R8. Master chain has no limiter
**Evidence:** psyLive.ts:304-310 chain is `master → analyser → destination`. Compressor (line 343) is on ENGINE bus only. Radio (line 612) connects to master directly. Engine + radio can sum to >0dBFS with no protection.

---

## ARCHITECTURAL DEFECTS

Only actual defects (not just unimplemented features):

1. **PLL tempo adaptation broken** (R1) — tempoGain too small + observedPeriod guard rejects corrected periods
2. **Pitch detection octave errors** (R2) — normalized ACF without sub-harmonic cancellation
3. **Spectral flatness mis-classifies tones as noise** (R2) — `Math.max(1, ...)` clamp distorts geometric mean
4. **No signal-verification gate on radio connect** (R3) — `LISTENING` set on play() resolution
5. **No master limiter** (R8) — engine + radio can clip
6. **Compressor on engine bus only** — radio passes through uncompressed, can fight engine
7. **Inline AudioNode allocation per note** — contradicts the "no GC dropouts" architectural intent; PooledEngine exists but is unused
8. **42 presets imported but unused** — `SOUND_BANK, getById, autoSelect` imported on line 16 but never called
9. **Pattern mutation can stall on local maxima** — `mutatePattern` only adopts if `best.score > currentScore`; on a stable pattern, mutation rate can drop to zero. (Test PM-4A shows 96% mutation rate over 200 cycles in test conditions, but this is with low occupancy — real radio-following with high occupancy could stall.)

---

## CLAIMS FALSIFIED

Explicitly — the evidence disproves these claims made in commits or the worklog:

1. **"REAL-TIME RADIO FOLLOWER"** (commit 0062d2d) — PLL cannot follow any radio tempo ≠ 150 BPM
2. **"MELODY FOLLOWER"** (commit 325432c "Add MelodyObserver") — pitch detection returns -2 octave errors; gates reject clean tones
3. **"LEARNING ENGINE" / "REINFORCE"** (commits 2ed6ed6, worklog honest-test-v11) — no reward, no policy, no update rule; statistical bookkeeping only
4. **"Song structure cycles (intro→build→peak→break→peak2→outro)"** (worklog honest-test-v11) — code does NOT exist at HEAD
5. **"AudioContext auto-resumes (health monitor)"** (worklog honest-test-v11) — code does NOT exist at HEAD
6. **"System self-heals if anything goes wrong"** (worklog honest-test-v11) — no self-recovery mechanism exists
7. **"142 professional presets"** used by engine (commit 2b750bb) — presets are valid data but DISCONNECTED from runtime
8. **"PooledEngine plays 142 presets"** (commit 2b750bb) — PooledEngine is dead code; runtime uses inline createOscillator
9. **"No GC Dropouts"** (commit 2b750bb, implied) — PooledEngine is dead code; runtime allocates ~39 AudioNodes/sec
10. **"12 min stable"** (worklog honest-test-v11) — even if true at runtime, this is stability of a BROKEN engine (PLL locked to wrong tempo, no melody observation, no learning)

---

## CLAIMS NOT PROVEN

Separate from falsified claims — these may be true but the evidence does not support them:

1. **PooledEngine "No GC Dropouts"** — the stress test (5800 notes, no crash, stable node count) suggests the module is well-engineered, BUT (a) we cannot measure browser GC pauses in a shim, (b) the module is dead code so the claim doesn't apply to the runtime, and (c) the runtime's inline-allocation pattern is precisely what PooledEngine was designed to prevent. **GC-DROPOUT CLAIM NOT PROVEN.**

2. **142 presets "produce non-silent audio"** — we verified the data is well-formed (no NaN, valid engine types, valid parameters), but rendering them requires a real AudioContext. Since the runtime doesn't use them, this is moot for the live engine.

3. **Radio actually plays on user's machine** — dev server returns HTTP 200 and the page renders, but we have NOT verified in a real browser that the radio stream URL is reachable, that the MediaElementSource actually decodes audio, or that the analyser receives non-zero samples. The `RadioStateGate` we implemented would detect this, but it's not wired in.

4. **Continuous learning persists across sessions** — `saveLearning()` writes to `localStorage['psy-live-learn-v2']` and `loadLearning()` reads it. The code looks correct, but we have NOT verified it survives a page reload in a real browser.

5. **Pattern mutation evolves musically over long sessions** — PM-4A proves 200 cycles without constraint violations, but musicality (does it SOUND good?) cannot be assessed in a shim.

---

## FIXES

Only fixes actually implemented during this audit (no engine code was modified — all fixes are additive):

1. **Added `src/lib/radioStateGate.ts`** — explicit radio signal state machine with 7 states. Passes all 8 RadioStateGate tests (RG-8A through RG-8H). NOT yet wired into psyLive.ts (applying the wire-up is a corrective change beyond the audit's "no new features" boundary; it is queued for the next iteration).

2. **Added `tests/reality-bridge/` test harness** — 56 regression tests covering AnalyserNode API, BeatPLL convergence/recovery, MelodyObserver pitch detection, PatternMutator 100+ cycles, SoundBank enumeration, PooledEngine routing, RadioStateGate, failure injection, MusicState, and scheduler. All tests are deterministic and use synthetic audio fixtures (no internet radio, no sound card).

3. **Added `audit-reports/PSY4_SIGNAL_TRACE.md`** — end-to-end routing map with every arrow's source file, function, and data structure.

4. **Added `audit-reports/PSY4_CAPABILITY_MATRIX.json`** — machine-readable per-subsystem classification.

5. **Added `audit-reports/PSY4_REALITY_BRIDGE.md`** — this report.

---

## REGRESSION TESTS

Exact test IDs and results (full data in `tests/reality-bridge/results.json`):

### AnalyserNode (6/6 pass)
- AN-1A: getFloatTimeDomainData returns injected Float32 verbatim ✓
- AN-1B: getByteTimeDomainData quantizes to 8-bit ✓
- AN-1C: RMS divergence Float32 vs Byte = 0.00003 (proves b6fb3a7 was real fix) ✓
- AN-1D: getByteFrequencyData returns injected Uint8 verbatim ✓
- AN-1E: psyLive.ts uses getFloatTimeDomainData with Float32Array (regression protected) ✓
- AN-1F: AnalyserNode invariants (fftSize=512, frequencyBinCount=256) ✓

### BeatPLL (2/9 pass — 7 failures)
- PLL-2A: 120 BPM → finalBpm=149.36 ✗
- PLL-2B-130: 130 BPM → finalBpm=149.58 ✗
- PLL-2B-140: 140 BPM → finalBpm=149.79 ✗
- PLL-2B-150: 150 BPM → finalBpm=150.00 ✓ (passes only because default=150)
- PLL-2C: 25% missing beats → bpmErr=4.90 ✗
- PLL-2D: extra low-conf transients → bpmErr=4.66 ✗
- PLL-2E: tempo jump 120→145 → bpmEnd=149.36 ✗
- PLL-2F: ±5ms jitter → bpmErr=4.84 ✗
- PLL-2G: rejects low-confidence (<0.45) observations ✓

### MelodyObserver (6/11 pass — 5 failures)
- MO-3A: A4=440 Hz → detected 109.98 Hz (octaveErr=-2) ✗
- MO-3B: A3=220 Hz → detected 109.98 Hz (octaveErr=-1) ✗
- MO-3C: C5=523.25 Hz → detected 130.86 Hz (octaveErr=-2) ✗
- MO-3D: E5=659.25 Hz → detected 658.21 Hz (centsErr=-2.7) ✓
- MO-3E: 100 Hz → detected 100.00 Hz ✓
- MO-3F: white noise → confidence=0 ✓
- MO-3G: silence → confidence=0 ✓
- MO-3H: clean 440 Hz signal → 0 observations ✗
- MO-3I: kick occupancy > 0.8 → 0 observations ✓
- MO-3J: kick transient → detected 1837.50 Hz (NOT the kick fundamental) ✓ (informational)
- MO-3K: spectralFlatness noise→high, tone→low → flatnessTone=0.85 ✗

### PatternMutator (3/3 pass)
- PM-4A: 200 cycles, 96% mutation rate, 0 violations, 0 duplicates, meanDensityDelta=0.018 ✓
- PM-4B: stochastic across 10 invocations ✓
- PM-4C: scorePattern ranks well-formed > over-dense ✓

### Learning (4/4 pass)
- LR-5A: detectScale identifies Phrygian (matchScore=1.00) ✓
- LR-5B: computeTempoStats stable=145 stddev=0.5 conf=0.94 ✓
- LR-5C: recordKick accumulates votes correctly ✓
- LR-5D: CRITICAL — NOT online learning (no reward/policy/update/action) ✓ (as expected)

### SoundBank (2/2 pass)
- SB-6A: 142/142 presets valid, 0 NaN ✓
- SB-6B: CRITICAL — presets UNUSED by runtime ✓ (as expected)

### PooledEngine (6/6 pass)
- PE-7A: routing graph master→analyser→destination, 330 nodes, 386 edges ✓
- PE-7B: 16 synth + 12 drum voice pools ✓
- PE-7C: triggerSynth activates voice ✓
- PE-7D: triggerDrum activates voice ✓
- PE-7E: CRITICAL — PooledEngine is DEAD CODE ✓ (as expected)
- PE-7F: delay + reverb send buses routed ✓

### RadioStateGate (8/8 pass)
- RG-8A through RG-8G: all state transitions ✓
- RG-8H: CRITICAL — old "listening without verification" bug confirmed ✓

### FailureInjection (3/3 pass)
- FI-9A: BeatPLL reset clears state ✓
- FI-9B: AudioContext suspend/resume ✓
- FI-9C: PooledEngine survives 200 rapid triggers + killAll ✓

### MusicState (2/2 pass)
- MS-10A: CRITICAL — NO song structure at HEAD ✓ (as expected)
- MS-10B: classifyStyle + hysteresis + density control present ✓

### Scheduler (2/2 pass)
- MS-10C: uses PLL.predictBeats when locked + own clock fallback ✓
- MS-10D: step deduplication (lastScheduledStepKey) present ✓

### Stress test
- 5800 notes (10-min equivalent), 0 crashes, maxActive=28=pool size, nodeCount stable at 330 ✓
- GC-DROPOUT CLAIM NOT PROVEN (shim cannot measure GC; module is dead code)

---

## REMOTE DELIVERY

```text
FINAL COMMIT:    (to be pushed at end of audit)
REMOTE COMMIT:   (verified after push)
LOCAL==REMOTE:   (verified after push)
PUSH:            git push origin main
```

**Artifacts added in this audit:**
- `src/lib/radioStateGate.ts` (corrective gate, NOT yet wired)
- `tests/reality-bridge/audioShim.ts`
- `tests/reality-bridge/synthFixtures.ts`
- `tests/reality-bridge-setup.ts`
- `tests/reality-bridge/run-all.ts`
- `tests/reality-bridge/stress-test.ts`
- `tests/reality-bridge/results.json` (generated)
- `tests/reality-bridge/stress-test-results.json` (generated)
- `audit-reports/PSY4_REALITY_BRIDGE.md` (this file)
- `audit-reports/PSY4_SIGNAL_TRACE.md`
- `audit-reports/PSY4_CAPABILITY_MATRIX.json`

---

## FINAL VERDICT

Choose exactly one:

```
NOT VERIFIED
PARTIALLY VERIFIED
RUNTIME VERIFIED
SYSTEM VERIFIED
COMMERCIAL CANDIDATE
```

### **PARTIALLY VERIFIED**

**Justification:**

PSY4 is partially verified. The evidence shows:

- **What WORKS:** AnalyserNode API (after b6fb3a7 fix), feature extraction, scheduler wiring, PatternMutator (Level 5 — adversarial+long-run verified), MusicState reactive control, per-role buses + ducking, learning as statistical bookkeeping, RadioStateGate (new), failure injection for the modules that exist.

- **What DOES NOT WORK:** BeatPLL cannot follow any tempo ≠ 150 BPM. MelodyObserver produces -2 octave errors and rejects clean tones. The "LISTENING" state is set without signal verification. PooledEngine is dead code. The 142-preset SoundBank is disconnected. Song structure does not exist at HEAD. Self-recovery / health monitor does not exist at HEAD. Master chain has no limiter. The "REINFORCE / continuous learning" claim is unsupported.

- **Claims FALSIFIED:** 10 (listed above)
- **Claims NOT PROVEN:** 5 (listed above)

PSY4 is NOT a REAL-TIME RADIO FOLLOWER (PLL broken).
PSY4 is NOT a MELODY FOLLOWER (pitch detection broken).
PSY4 is NOT a LEARNING ENGINE (no RL primitives).

PSY4 IS a working PatternMutator + reactive MusicState + role-bus architecture with inline Web Audio synthesis, wrapped in a UI that renders. The runtime engine plays sound, mutates patterns, and reacts to radio occupancy — but it does not follow the radio's tempo, does not observe the radio's melody, and does not learn in any reinforcement-learning sense.

**Do NOT start P2 (MotifLearner).** The MelodyObserver it would depend on does not produce usable observations. The PLL it would sync to does not track tempo. Building P2 on top of these would compound the falsified claims.

**Required before P2:**
1. Fix BeatPLL tempo convergence (R1) — increase tempoGain, remove the observedPeriod guard, add sub-harmonic cancellation
2. Fix MelodyObserver pitch detection (R2) — replace normalized ACF with YIN or MPM, fix spectralFlatness clamp
3. Wire RadioStateGate into psyLive.ts (R3) — replace syncStatus='listening' with explicit state checks
4. Either delete PooledEngine or wire it into psyLive.ts (R4) — currently it's misleading dead code
5. Either delete SOUND_BANK or wire getById/autoSelect into the engine (R5)
6. Add a master limiter (R8)
7. Remove or implement song structure / self-recovery claims (R6, R7) — current worklog is misleading

Only after these 7 fixes can P2 (MotifLearner) be considered.

---

**Audit complete. Pushing to origin/main.**
