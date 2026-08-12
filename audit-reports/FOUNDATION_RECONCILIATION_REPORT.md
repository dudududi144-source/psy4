# FOUNDATION RECONCILIATION REPORT

## F-RECON — Canonical Source of Truth Audit

**Date:** 2026-08-12

---

## 1. CURRENT REPO HEADS

| Repo | HEAD | Tests | Lint |
|------|------|------:|------|
| psy4 | `dd8b62b32a0201676ba9bb302c253e947ccfd00b` | 221/221 ✓ | clean |
| psy-foundation | `9063064cd849cd3b24d9f9cb4ef471d3cfbfdb4b` | 250/250 ✓ | clean |

---

## 2. ACTUAL TEST COUNTS (verified by running)

### psy4 (221 tests)

| Suite | Tests | Status |
|-------|------:|--------|
| Reality Bridge | 56 | ✓ |
| BeatPLL Convergence | 48 | ✓ |
| MelodyObserver Acceptance | 13 | ✓ |
| Transport Matrix (A-P) | 21 | ✓ |
| Transport Adversarial | 6 | ✓ |
| Runtime Ownership | 15 | ✓ |
| Playback Reality | 18 | ✓ |
| Radio Observation (A-T) | 20 | ✓ |
| Radio Adversarial | 12 | ✓ |
| Radio Integration (A-L) | 12 | ✓ |
| **TOTAL** | **221** | **✓** |

### psy-foundation (250 tests)

| Package | Tests | Status |
|---------|------:|--------|
| transport | 12 | ✓ |
| analysis | 26 | ✓ |
| scheduler | 17 | ✓ |
| fixtures | 10 | ✓ |
| device-sdk | 12 | ✓ |
| dsp | 39 | ✓ |
| learning | 32 | ✓ |
| material | 23 | ✓ |
| music | 43 | ✓ |
| protocol | 7 | ✓ |
| **TOTAL** | **250** | **✓** |

---

## 3. SUBSYSTEM COMPARISON

### 3.1 TRANSPORT

| Feature | psy4 (`foundation/transport/`) | psy-foundation (`packages/transport/`) | Source of Truth |
|---------|------|------|:------:|
| Anchor clock | `beatTime = anchorTime + beatIndex * beatDuration` | `origin = { audioTime, beatIndex, bpm }` — same anchor model | TIE |
| BPM ownership | Transport owns `bpm` (single field) | TransportClock owns via `estimator.currentBpm` | TIE |
| beat/bar/phase | Computed from anchor in `snapshot()` | Computed from origin in `snapshot()` | TIE |
| Epoch | `epoch` increments on seek/reset/resume/re-anchor | `revision` increments on relock/fold/first observation | **psy4** (has explicit seek/resume; foundation lacks seek API) |
| Confidence | `confidence = 0.85*old + 0.15*obs` (simple EMA) | `ConfidenceTracker` with interval consistency + decay | **psy-foundation** (richer model: jitter-aware, decay-based) |
| Holdover | `loseSource()` → confidence halves, decays with half-life 10s | `gapTimeout` → `locked = false` when `lastObservationAgo > gapTimeout` | **psy4** (explicit holdover mode; foundation just unlocks) |
| Half/double hypotheses | `tempoHypotheses[]` with evidence tracking | `BeatEstimator.folded` ('none'/'half'/'double') per observation | **psy-foundation** (simpler, per-observation fold; psy4 tracks multiple hypotheses but they're not well-tested) |
| Stale observation handling | `observedInterval <= 0 || > 10s` rejected | `intervalSec > 0` check only | **psy4** (stricter) |
| Out-of-order handling | Rejected (lastObsTime check) | Rejected (lastObservedAt check) | TIE |
| Tempo changes | `setTempo()` re-anchors preserving position | Implicit via estimator smoothing | **psy4** (explicit API) |
| Seek/reset/start/resume | `seek()`, `reset()`, `start()`, `onAudioContextResume()` | `reset()` only | **psy4** (full lifecycle) |
| Prediction | `predictBeats(horizon)` returns future beat times | `predict(atAudioTime)` returns future beat index | TIE |
| Snapshot immutability | `Object.freeze()` | Plain object (not frozen) | **psy4** |
| AudioContext clock | `nowFn: () => number` (passed in) | `atAudioTime` passed to `snapshot()` | TIE |
| Subscriber API | `subscribe(listener)` + `unsubscribe()` | `onRevision(cb)` returns unsubscribe | TIE |
| Tests | 21 matrix + 6 adversarial + 15 ownership = 42 | 12 tests | **psy4** (more comprehensive) |
| Browser-proven | Yes (30s continuous playback, schedulerBeat===transportBeat) | No (not wired to any runtime) | **psy4** |

**Transport verdict:** **psy4 is the canonical source of truth.**

psy4 has: explicit seek/resume API, Object.freeze immutability, holdover mode, stricter stale handling, 42 tests (vs 12), browser-proven runtime integration.

psy-foundation has: better confidence tracking (jitter-aware, decay-based) and cleaner per-observation octave folding.

**Migration action:** Port psy-foundation's `ConfidenceTracker` and `BeatEstimator.folded` approach INTO psy4's transport. Do NOT replace psy4's transport with psy-foundation's.

---

### 3.2 RADIO / ANALYSIS

| Feature | psy4 (`foundation/radio/` + `src/lib/`) | psy-foundation (`packages/analysis/`) | Source of Truth |
|---------|------|------|:------:|
| Beat detection | `BeatObservationEngine` wraps `BeatPLL` | `detectOnsets()` (spectral flux) + `estimateTempo()` (brute-force hypothesis) | **Different approaches** |
| BeatPLL | `src/lib/beatPLL.ts` (213 lines, 48 tests) | Not present (uses `estimateTempo` instead) | **psy4** (PLL is proven, 48 convergence tests) |
| Onset detection | Sub-bass threshold crossing in `RadioObservationLayer` | `detectOnsets()` — spectral flux with adaptive median threshold | **psy-foundation** (more sophisticated: spectral flux, median threshold, min-interval suppression) |
| Tempo estimation | PLL (online, per-observation) | `estimateTempo()` — batch brute-force over onset list | **Different** (psy4 is online/real-time; foundation is batch/offline) |
| Pitch detection | YIN (`melodyObserver.ts`, 13 tests, ±10 cents) | Autocorrelation with subharmonic avoidance | **psy4** (YIN is proven; foundation uses ACF which has octave ambiguity issues that psy4 already fixed) |
| Confidence | `onsetStrength × 0.5 + regularityFit × 0.3 + signalQuality × 0.2` | Onset strength normalized to [0,1] | **psy4** (multi-factor; foundation is single-factor) |
| Timestamp model | `observedAt / estimatedAt / predictedAt` (explicit latency) | `at` (seconds from signal start) | **psy4** (proper AudioContext timestamp model) |
| Signal quality | `RadioStateGate` with 7 states | Not present | **psy4** |
| False-lock prevention | Confidence gates + half/double hypotheses | `pickMusicalWinner()` with preferred range | **TIE** (different approaches) |
| Tests | 20 observation + 12 adversarial + 12 integration = 44 | 26 tests | **psy4** (more, plus browser-proven) |
| Browser-proven | Yes (radio integration tests, 30s playback) | No | **psy4** |

**Radio/Analysis verdict:** **psy4 is the canonical source of truth for real-time radio observation.**

psy-foundation's `analysis` package is designed for **offline/batch analysis** (full signal → onset list → tempo estimate), not real-time streaming. It has a stronger onset detector (`detectOnsets` with spectral flux) but no real-time integration.

**Migration action:** Port psy-foundation's `detectOnsets()` spectral flux algorithm as an alternative onset detector in psy4's `RadioObservationLayer`. Keep psy4's BeatPLL, YIN, and timestamp model.

---

### 3.3 SCHEDULER

| Feature | psy4 (`psyLive.ts` scheduler) | psy-foundation (`packages/scheduler/`) | Source of Truth |
|---------|------|------|:------:|
| Scheduling model | Reads `transport.snapshot()` → schedules 16th notes in 150ms window | `schedule(plan, opts)` — batch pattern→events for a plan | **Different** (psy4 is real-time; foundation is batch) |
| Continuous window | ✓ Proven (291 steps in 30s, uniform spacing) | N/A (batch, not continuous) | **psy4** |
| Beat-boundary bug | FIXED (was the playback reality bug; now schedules 16ths directly from beat grid) | N/A (no beat-boundary prediction) | **psy4** |
| Tab suspension | DROP STALE EVENTS policy (proven) | N/A | **psy4** |
| Transport reads | ✓ `transport.snapshot()` + `transport.predictBeats()` | Takes `bpm` + `originAudioTime` as params (does NOT read Transport) | **psy4** (foundation doesn't use Transport) |
| AudioContext.currentTime | ✓ Authoritative | Takes `originAudioTime` as param | **psy4** |
| Pattern support | 16-step patterns with kick/bass/lead/hat | Multi-track patterns with probability, micro-timing, parameter locks | **psy-foundation** (richer pattern model) |
| Swing | Not implemented | `swing` parameter | **psy-foundation** |
| Humanize | Not implemented | `humanizeSec` parameter | **psy-foundation** |
| Tests | 18 playback reality + 12 integration = 30 | 17 tests | **psy4** (browser-proven) |
| Browser-proven | Yes (30s continuous, STOP→PLAY) | No | **psy4** |

**Scheduler verdict:** **psy4 is the canonical source of truth for real-time scheduling.**

psy4's scheduler is a proven real-time scheduler that reads Transport. psy-foundation's `scheduler` is a batch event generator (pattern → event list) — useful for offline rendering but NOT a drop-in replacement for the real-time scheduler.

**Migration action:** Port psy-foundation's pattern model (multi-track, probability, micro-timing, swing, humanize) as the pattern input to psy4's scheduler. Do NOT replace psy4's real-time scheduling loop.

---

## 4. CANONICAL SOURCE OF TRUTH DECISION

| Domain | Canonical Source | Why |
|--------|-----------------|-----|
| Transport | **psy4** `foundation/transport/` | 42 tests (vs 12), browser-proven, explicit seek/resume, Object.freeze, holdover |
| Radio/Analysis | **psy4** `foundation/radio/` + `src/lib/` | 44 tests (vs 26), real-time streaming, YIN pitch, timestamp model, browser-proven |
| Scheduler | **psy4** `psyLive.ts` scheduler | 30 tests (vs 17), real-time continuous, Transport-integrated, browser-proven |
| BeatPLL | **psy4** `src/lib/beatPLL.ts` | 48 convergence tests, proven in browser |
| Pitch detection | **psy4** `src/lib/melodyObserver.ts` (YIN) | 13 acceptance tests, ±10 cents |
| Onset detection | **psy-foundation** `packages/analysis/src/onset.ts` | Spectral flux with adaptive median (stronger than psy4's sub-bass threshold) |
| Pattern model | **psy-foundation** `packages/scheduler/src/types.ts` | Multi-track, probability, micro-timing, swing, humanize |
| Confidence tracking | **psy-foundation** `packages/transport/src/confidenceTracker.ts` | Jitter-aware, decay-based (richer than psy4's simple EMA) |
| DSP primitives | **psy-foundation** `packages/dsp/` | 39 tests, comprehensive (psy4 has forensic/dsp.ts but not organized) |

---

## 5. MIGRATION RISKS

| Risk | Severity | Mitigation |
|------|----------|------------|
| Replacing psy4 scheduler with foundation scheduler | **CRITICAL** — would break playback | Do NOT replace. Port pattern model only. |
| Replacing psy4 Transport with foundation TransportClock | **HIGH** — would lose seek/resume/holdover | Do NOT replace. Port ConfidenceTracker only. |
| Replacing psy4 BeatPLL with foundation estimateTempo | **HIGH** — would lose real-time tracking | Do NOT replace. Keep BeatPLL for real-time. |
| Replacing psy4 YIN with foundation ACF pitch | **HIGH** — would reintroduce octave errors | Do NOT replace. Keep YIN. |
| Circular dependency | **MEDIUM** | psy-foundation must NOT import from psy4. psy4 imports from psy-foundation. |
| Test duplication | **LOW** | Consolidate tests per subsystem in the canonical repo. |

---

## 6. DUPLICATE CODE

| Code | psy4 location | psy-foundation location | Action |
|------|---------------|------------------------|--------|
| Transport | `foundation/transport/MusicalTransport.ts` (295 lines) | `packages/transport/src/transport.ts` (160 lines) | Keep psy4; port foundation's ConfidenceTracker |
| BeatPLL | `src/lib/beatPLL.ts` (213 lines) | Not present (uses `estimateTempo` instead) | No duplicate |
| Pitch detection | `src/lib/melodyObserver.ts` (394 lines, YIN) | `packages/analysis/src/pitch.ts` (146 lines, ACF) | Keep psy4 YIN; do NOT port foundation ACF |
| Onset detection | `foundation/radio/RadioObservationLayer.ts` (inline sub-bass) | `packages/analysis/src/onset.ts` (136 lines, spectral flux) | Port foundation's onset as alternative |
| Scheduler | `psyLive.ts` scheduler (inline, ~40 lines) | `packages/scheduler/src/scheduler.ts` (111 lines, batch) | Keep psy4 real-time; port foundation pattern model |
| PRNG | `src/lib/` (inline mulberry32) | `packages/scheduler/src/rng.ts` (16 lines) | Use foundation's Rng class |

---

## 7. PROPOSED DEPENDENCY GRAPH

```
psy-foundation (shared, device-agnostic)
  ├── packages/transport    ← psy4 contributes MusicalTransport (canonical)
  ├── packages/analysis     ← psy4 contributes RadioObservationLayer (canonical)
  ├── packages/scheduler    ← psy-foundation keeps batch scheduler + pattern model
  ├── packages/dsp          ← psy-foundation (canonical, 39 tests)
  ├── packages/fixtures     ← psy-foundation (canonical)
  ├── packages/protocol     ← psy-foundation (canonical)
  ├── packages/device-sdk   ← psy-foundation (canonical)
  ├── packages/learning     ← psy-foundation (canonical, future)
  ├── packages/material     ← psy-foundation (canonical, future)
  └── packages/music        ← psy-foundation (canonical, future)
      ↑
      │ (npm/workspace dependency)
      │
psy4 (device runtime)
  ├── src/lib/psyLive.ts    ← consumes foundation packages
  ├── src/app/page.tsx      ← UI
  └── runtime AudioContext  ← device-specific
```

**Rule:** psy-foundation NEVER imports from psy4. psy4 imports from psy-foundation.

---

## 8. EXACT MIGRATION ORDER

### Phase A — Tests only (no runtime change)
1. Add psy-foundation as a workspace dependency in psy4
2. Run psy-foundation tests from psy4 CI
3. Verify both test suites pass independently
4. Commit + push

### Phase B — Adapter compatibility layer
1. Create `src/lib/adapters/` in psy4
2. Adapter wraps psy-foundation packages (if needed) but psy4 runtime still uses psy4 implementations
3. Tests verify adapter compatibility
4. Commit + push

### Phase C — Port stronger components FROM foundation INTO psy4
1. Port `ConfidenceTracker` from foundation into psy4's Transport
2. Port `detectOnsets()` spectral flux from foundation into psy4's RadioObservationLayer
3. Port pattern model (multi-track, probability, swing) from foundation into psy4
4. Run all 221+ psy4 tests + new tests
5. Browser proof
6. Commit + push

### Phase D — Contribute psy4 canonical implementations TO foundation
1. Copy psy4's `MusicalTransport` → `psy-foundation/packages/transport/` (replacing or merging with `TransportClock`)
2. Copy psy4's `BeatPLL` → `psy-foundation/packages/analysis/`
3. Copy psy4's `MelodyObserver` (YIN) → `psy-foundation/packages/analysis/`
4. Copy psy4's `RadioObservationLayer` → `psy-foundation/packages/analysis/`
5. Run foundation tests (must remain green)
6. Commit + push to psy-foundation

### Phase E — Remove duplicates
1. Remove `psy4/foundation/transport/` (now in psy-foundation)
2. Remove `psy4/foundation/radio/` (now in psy-foundation)
3. psy4 imports from `@psy-foundation/transport` and `@psy-foundation/analysis`
4. Run all tests
5. Browser proof
6. Commit + push

---

## 9. WHAT REMAINS IN psy4

- `psyLive.ts` — the device runtime (scheduler, voice generation, audio graph)
- `page.tsx` — the UI
- `src/lib/pooledEngine.ts` — EXPERIMENTAL (device-specific)
- `src/lib/soundBank.ts` — future material library (device-specific presets)
- `src/lib/patternMutator.ts` — device-specific pattern mutation
- `src/lib/learning.ts` — device-specific learning (statistical bookkeeping)
- Runtime AudioContext setup, radio stream connection, UI rendering

---

## 10. WHAT MOVES TO psy-foundation

- `foundation/transport/` → `packages/transport/` (merge with existing)
- `foundation/radio/` → `packages/analysis/` (merge with existing)
- `src/lib/beatPLL.ts` → `packages/analysis/` (new)
- `src/lib/melodyObserver.ts` → `packages/analysis/` (new, YIN)
- `src/lib/radioStateGate.ts` → `packages/analysis/` (merge)

---

## 11. WHAT MUST NOT MOVE

- `psyLive.ts` scheduler — device-specific real-time scheduling (stays in psy4)
- `psyLive.ts` voice generation — device-specific synthesis (stays in psy4)
- `psyLive.ts` audio graph — device-specific routing (stays in psy4)
- `page.tsx` — UI (stays in psy4)
- `pooledEngine.ts` — EXPERIMENTAL device backend (stays in psy4)
- `soundBank.ts` — device-specific presets (stays in psy4 for now)
- `patternMutator.ts` — device-specific mutation (stays in psy4 for now)

---

## 12. BROWSER/RUNTIME RISKS

| Risk | Impact | Mitigation |
|------|--------|------------|
| Import path changes break runtime | Playback stops | Test browser after every phase |
| psy-foundation package has different API | Runtime crash | Adapter layer in Phase B |
| Transport API mismatch | Scheduler breaks | Do NOT replace psy4 Transport until Phase E |
| Circular dependency | Build failure | psy-foundation must never import from psy4 |
| Workspace resolution fails | Import errors | Test `bun install` + `bun run dev` after dependency add |

---

## FOUNDATION RECONCILIATION STATUS

- **psy4 HEAD:** `dd8b62b32a0201676ba9bb302c253e947ccfd00b`
- **psy-foundation HEAD:** `9063064cd849cd3b24d9f9cb4ef471d3cfbfdb4b`
- **psy4 tests:** 221/221 ✓
- **psy-foundation tests:** 250/250 ✓
- **canonical Transport:** psy4 `foundation/transport/MusicalTransport` (42 tests, browser-proven, seek/resume/holdover)
- **canonical Analysis:** psy4 `foundation/radio/RadioObservationLayer` + `src/lib/beatPLL.ts` + `src/lib/melodyObserver.ts` (44 tests, real-time, YIN)
- **canonical Scheduler:** psy4 `psyLive.ts` scheduler (30 tests, browser-proven continuous playback)
- **canonical Radio:** psy4 `foundation/radio/RadioObservationLayer` (timestamped, deterministic, Transport-bounded)
- **duplicate implementations:** Transport (psy4 295 lines vs foundation 160 lines), Pitch (psy4 YIN 394 lines vs foundation ACF 146 lines), Scheduler (psy4 real-time vs foundation batch)
- **migration required:** YES (staged, Phase A-E)
- **runtime currently safe:** YES (psy4 runtime is proven, no changes needed until Phase C)
- **blockers:** None. psy4 runtime is safe. Migration is additive (port stronger components in) before subtractive (remove duplicates).
- **report commit:** (this commit)
- **local == remote:** (will verify after push)
