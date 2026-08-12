# F13 — RADIO FORENSIC

**HEAD:** `017ef70` (F11) · **Verdict:** RADIO FOLLOWER IS DEAD AT HEAD. 3/6 STATIONS ALIVE.

This document traces the radio subsystem end-to-end, proves the follower is dead, and documents the two-stations problem.

---

## 1. STATION INVENTORY

**Runtime registry** — `psyLive.ts:52-62`, `STREAMS` array (exported, consumed by `page.tsx:237`):

| # | id | name | url | curl -I result | Status |
|---|----|------|-----|----------------|--------|
| 1 | `psyndora` | Psyndora | `https://cast.magicstreams.gr:9111/stream/1/` | **200 OK**, CORS `*` | ✅ ALIVE |
| 2 | `babaganousha` | Babaganousha | `https://babaganousha.net:8443/stream/1/` | **200 OK**, CORS `*` | ✅ ALIVE |
| 3 | `spaceunicorn` | Space Unicorn | `https://spaceunicorn.radio/stream` | **200 OK**, CORS `*` | ✅ ALIVE |
| 4 | `psyndora-prog` | Psyndora Progressive | `https://cast.magicstreams.gr:9110/stream/1/` | **Connection refused** (port 9110 closed) | ❌ DEAD |
| 5 | `psyndora-chill` | Psyndora Chill | `https://cast.magicstreams.gr:9112/stream/1/` | **SSL unexpected EOF** (TLS handshake fails) | ❌ DEAD |
| 6 | `radiocaprice-psy` | Radio Caprice Psytrance | `https://radcap.net/psytrance.pls` | **DNS unresolvable** (radcap.net dead) | ❌ DEAD |

**Total: 6 hardcoded stations. 3 alive, 3 dead.**

**Dead-code registry** — `src/lib/studio/engine/reference/radioStreams.ts:14-114` lists 10 stations with richer metadata (priority, tags, fallback). This file is only imported by `referenceListener.ts` / `referenceListenerV2.ts` (both dead code). **NOT reachable from runtime.**

---

## 2. THE "TWO STATIONS" PROBLEM — CONFIRMED

The user's perception of "only 2 stations work" is accurate:
- 3 of 6 runtime stations are dead (port closed, TLS broken, DNS dead)
- Of the 3 alive, Space Unicorn plays broader trance (not strictly psytrance), so a user seeking pure psytrance effectively has **2 reliable stations**: Psyndora + Babaganousha
- All 3 alive stations return `Access-Control-Allow-Origin: *` (CORS OK for Web Audio)

**Root cause:** Hardcoded station list with no health checking, no automatic removal, no fallback. Dead URLs persist in the UI forever.

---

## 3. STATION SWITCH TRACE

`connectRadio(stream)` — `psyLive.ts:731-767`:

| Step | What happens | Clean? |
|------|-------------|--------|
| 1 | `if (this.radioSource) { this.radioSource.disconnect() }` (735) | ✅ Old source disconnected |
| 2 | `if (this.radioEl) { this.radioEl.pause(); this.radioEl.src = '' }` (736) | ✅ Old element stopped + cleared |
| 3 | `this.radioEl = new Audio()` (737) | ✅ New element per call |
| 4 | `this.radioEl.crossOrigin = 'anonymous'` (738) | ✅ CORS for Web Audio |
| 5 | `this.radioEl.src = stream.url` (739) | ✅ |
| 6 | `this.radioSource = this.ctx.createMediaElementSource(this.radioEl)` (740) | ✅ New source per element (safe — no double-MES violation) |
| 7 | `if (!this.radioGain) { create gain + analyser }` (741-746) | ✅ Created once, reused |
| 8 | `radioSource → radioGain → radioAnalyser → engineBus` (749-752) | ✅ F10 routing |
| 9 | `radioGate.reset() + markConnecting() + markConnected()` (755-757) | ⚠️ Targets RadioStateGate, NOT radioLayer |
| 10 | `syncStatus = 'connecting'` (758) | ✅ |
| 11 | `await radioEl.play()` (760) | ✅ |
| 12 | `this.radioOn = true; startDetection()` (761-763) | ✅ |

**Switch verdict:** Audio handoff is CLEAN. No zombie stream, no double-MES, no orphan nodes. The UI forces disconnect-first (`page.tsx:236` `disabled={s.radioOn}` on `<select>`).

**BUT:** The observation pipeline is NOT reset on switch. `radioLayer` stays in DISCONNECTED state (markConnected never called). `session.reset()` is never called. Learned motifs/style/phrase state persists across station switches.

---

## 4. RADIO AUDIO PATH (verified)

```
radioEl (HTMLAudioElement, crossOrigin='anonymous')
  ↓
radioSource (MediaElementAudioSourceNode)           [psyLive.ts:740]
  ↓
radioGain (GainNode, gain=0.5, user-controlled)     [psyLive.ts:743]
  ↓
radioAnalyser (AnalyserNode, fftSize=512, smoothing=0.2)  [psyLive.ts:744-746]
  ↓
engineBus (GainNode, 0.8)                           [psyLive.ts:752, F10 fix]
  ↓
comp (DynamicsCompressor, -18dB, 2:1)               [psyLive.ts:431]
  ↓
master (GainNode, 0.9)                              [psyLive.ts:355]
  ↓
safetyLimiter (DynamicsCompressor, -1dB, 20:1)      [psyLive.ts:361]
  ↓
analyser (AnalyserNode, fftSize=512)                [psyLive.ts:357]
  ↓
ctx.destination                                      [psyLive.ts:369]
```

| Question | Answer | Evidence |
|----------|--------|----------|
| Through compressor? | ✅ YES (F10 real) | psyLive.ts:752 `radioAnalyser.connect(engineBus)` → engineBus → comp |
| Through master limiter? | ✅ YES | safetyLimiter between master and destination |
| Own analyser? | ✅ YES | `radioAnalyser` (line 744) taps radio-only signal |
| Feedback loop? | ✅ NO | radioAnalyser → engineBus is one-way. No path back. |
| Comment bug? | ⚠️ YES | psyLive.ts:748 says "Radio → radioGain → master" but F10 changed to engineBus. Stale comment. |

---

## 5. RADIO → COMPOSITION DATA PATH — DEAD

### 5.1 The intended path

```
radioAnalyser → radioLayer.process() → radioSnap.beat → transport.observeBeat() → Transport (locked)
                                                                        ↓
                                                              scheduler reads transport.snapshot()
                                                                        ↓
                                                              session.planBar(bar, bpm)

radioAnalyser → radioLayer.process() → radioSnap.occupancy → session.observeRadio() → MusicalContext
                                                                        ↓
                                                              generateKick/Bass/Lead use occupancy

radioAnalyser → radioLayer.process() → radioSnap.pitch → session.observeRadio() → MusicalContext (key)
```

### 5.2 The actual path (at HEAD)

```
radioAnalyser → radioLayer.process()
  ↓
  RadioObservationLayer.process():
    - rms, spectralEnergy, nonZeroRatio computed     ← ALIVE
    - updateSignalState(rms, nonZeroRatio, ...)
      ↓
      if signalState === 'DISCONNECTED' || 'CONNECTING': RETURN  ← EARLY EXIT (line 266-269)
      ⚠️ signalState IS 'DISCONNECTED' (constructor default, line 48)
      ⚠️ markConnected() NEVER CALLED from psyLive.ts
      ⚠️ signalState NEVER transitions out of DISCONNECTED
    - occupancy computed from band energy             ← ALIVE (lines 113-136)
    - if signalState === 'SIGNAL_PRESENT' || 'STABLE_SIGNAL':  ← NEVER TRUE (line 141)
        BEAT DETECTION BLOCK                          ← NEVER ENTERED
        ⚠️ beatObservation stays null
    - if signalState === 'SIGNAL_PRESENT' || 'STABLE_SIGNAL':  ← NEVER TRUE (line 183)
        PITCH OBSERVATION BLOCK                       ← NEVER ENTERED
        ⚠️ RadioPitchObservation never produced
    - return snapshot { beat: null, pitch: null, signal.state: 'DISCONNECTED', occupancy: real, signal.spectralEnergy: real }
  ↓
psyLive.detect():
  - if (radioSnap.beat)  ← ALWAYS FALSE (line 819)
      transport.observeBeat(...)                      ← NEVER CALLED
      ⚠️ PLL NEVER GETS OBSERVATIONS → NEVER LOCKS
  - syncStatus = map(observationState)                ← observationState = 'NO_SIGNAL' → syncStatus = 'no_signal'
  - occupancy = radioSnap.occupancy                    ← ALIVE
  - if (radioSnap.signal.state !== 'NO_SIGNAL')       ← 'DISCONNECTED' !== 'NO_SIGNAL' = TRUE (line 848)
      session.observeRadio({ bpm: transportSnap.bpm, energy: spectralEnergy, occupancy, bassFreq: undefined, confidence: 0 })
      ⚠️ bpm is ENGINE's own bpm (circular, not radio-detected)
      ⚠️ bassFreq is always undefined (never written)
      ⚠️ confidence is 0 (no beat)
  - role ducking (occupancy → bus gains)              ← ALIVE
  - style detection (occupancy → session.style)       ← ALIVE (overwrites user)
```

### 5.3 What survives

| Radio feature | Status | Evidence |
|---------------|--------|----------|
| Audio routing through comp + limiter | ✅ ALIVE | F10 fix, verified |
| Spectral occupancy (kick/bass/lead/hats) | ✅ ALIVE | RadioObservationLayer.ts:113-136 |
| Role ducking (bus gain from occupancy) | ✅ ALIVE | psyLive.ts:867-877 |
| Style detection (occupancy → style) | ✅ ALIVE | MusicalSession.ts:336-345 |
| Energy tracking (spectralEnergy → ctx.energy) | ✅ ALIVE | MusicalContext.ts:112 |
| **Beat detection** | ❌ DEAD | signalState stuck → beat block never entered |
| **Tempo following (PLL)** | ❌ DEAD | transport.observeBeat never called |
| **Pitch observation** | ❌ DEAD | pitch block never entered |
| **Key detection** | ❌ DEAD | bassFreq never written |
| **Learning (recordKick)** | ❌ DEAD | only fires when transportSnap.locked (never true) |

### 5.4 The single missing call

```
psyLive.ts:755-757 (connectRadio):
  this.radioGate.reset();          ← RadioStateGate
  this.radioGate.markConnecting(); ← RadioStateGate
  this.radioGate.markConnected();  ← RadioStateGate

MISSING:
  this.radioLayer.markConnecting(); ← RadioObservationLayer
  this.radioLayer.markConnected();  ← RadioObservationLayer
```

**One missing method call kills the entire radio follower.** `radioLayer.signalState` stays at 'DISCONNECTED', the signal state machine early-returns, beat detection never runs, the PLL never gets observations, transport never adjusts BPM, the engine plays at preset 145 BPM forever regardless of actual radio tempo.

The REALITY-REPAIR-GATE browser test ("163 BPM, 20 kicks, FOLLOWING") was pre-F2.5 (commit 44ce401). F2.5 (dd8b62b) wired in RadioObservationLayer but forgot to call `markConnected()`. The browser test is STALE.

---

## 6. STATE MACHINE ANALYSIS

### 6.1 Four desynced state machines

| Machine | Location | States | Stuck at | Why |
|---------|----------|--------|----------|-----|
| RadioStateGate | psyLive.ts:256 | 7 (DISCONNECTED, CONNECTING, CONNECTED_NO_SIGNAL, CONNECTED_SIGNAL, PLAYING_SIGNAL, BUFFERING, ERROR) | CONNECTED_NO_SIGNAL | `observe()` never called from psyLive |
| RadioObservationLayer.signalState | RadioObservationLayer.ts:48 | 9 (NO_SIGNAL, WEAK_SIGNAL, SIGNAL_PRESENT, STABLE_SIGNAL, LOST, DEGRADED, DISCONNECTED, CONNECTING, ERROR) | DISCONNECTED | `markConnected()` never called from psyLive |
| RadioObservationLayer.observationState | RadioObservationLayer.ts:49 | 6 (NO_SIGNAL, SIGNAL_PRESENT, LOCKING, FOLLOWING, DEGRADED, LOST) | NO_SIGNAL | `updateObservationState()` only called inside beat block (never entered) |
| psyLive.syncStatus | psyLive.ts:197 | 5 (idle, connecting, no_signal, listening, following) | no_signal | Derived from observationState (stuck) |

### 6.2 Unreachable states

- `syncStatus = 'listening'` — requires observationState = LOCKING or SIGNAL_PRESENT or DEGRADED → UNREACHABLE
- `syncStatus = 'following'` — requires observationState = FOLLOWING → UNREACHABLE
- `RadioStateGate` states CONNECTED_SIGNAL, PLAYING_SIGNAL, BUFFERING — require `observe()` → UNREACHABLE
- `RadioObservationLayer.signalState` SIGNAL_PRESENT, STABLE_SIGNAL — require `markConnected()` first → UNREACHABLE

**3 of 5 syncStatus states are unreachable.** The UI can only ever show: idle, connecting, no_signal.

### 6.3 No reconnect/backoff

- `radioEl.play()` wrapped in try/catch (psyLive.ts:760). If it fails, `radioOn` is still set to `true` (line 761).
- No retry logic. No exponential backoff. No stream-health monitoring.
- `disconnectRadio()` calls `transport.loseSource()` (holdover with 10s half-life confidence decay).
- `session.reset()` is NEVER called from psyLive → learned motifs/style/phrase state persists across disconnect/reconnect.

---

## 7. FAILURE MODE TEST MATRIX

| Scenario | Code behavior | Verdict |
|----------|--------------|---------|
| **RADIO OFF** | `play()` → `transport.start()` (bpm=145). Scheduler reads transport. No radio dependency. | ✅ WORKS. Engine plays at preset BPM. |
| **RADIO ON (signal)** | `connectRadio()` → `radioEl.play()` → audio flows. `detect()` calls `radioLayer.process()`. signalState stuck at DISCONNECTED → beat detection skipped → `transport.observeBeat()` never called → PLL never locks. | ❌ **FOLLOWER DEAD.** Radio audio plays through speakers but engine does NOT follow radio tempo. Engine stays at 145 BPM. syncStatus → 'no_signal' forever. |
| **RADIO ON (silence)** | Same as above — signalState stuck at DISCONNECTED regardless of audio content. | ❌ **INDISTINGUISHABLE** from signal case. |
| **RADIO LOSS (mid-playback)** | No auto-detection of stream drop. signalState would go to LOST if it were ever not DISCONNECTED — but it's stuck. | ❌ **NO HOLDOVER TRIGGERED** (holdover only fires on explicit `disconnectRadio()`). |
| **RADIO RECOVERY** | N/A — signal was never acquired. | ❌ **UNREACHABLE.** |
| **STATION SWITCH (A→B)** | UI forces DISCONNECT → `disconnectRadio()` (pause, clear, disconnect, transport.loseSource, radioLayer.reset, pll.reset, radioGate.reset) → select new station → CONNECT (new Audio, new MES, reuse gain+analyser). | ⚠️ **Audio clean, but new connection has same `markConnected()` bug.** |
| **3 dead stations** | `radioEl.play()` fails silently (try/catch). `radioOn = true`. `detect()` runs but radioAnalyser shows silence. signalState still DISCONNECTED. syncStatus = 'no_signal'. | ❌ User selects dead station → hears silence → sees "NO SIGNAL" → no error message, no fallback. |

---

## 8. DEAD CODE IN RADIO SUBSYSTEM

| Component | Location | Status | Evidence |
|-----------|----------|--------|----------|
| `psyLive.pll` (BeatPLL field) | psyLive.ts:238 | DEAD | Never fed observations. Only `pll.reset()` called on disconnect. The LIVE PLL is inside RadioObservationLayer → BeatObservationEngine → BeatPLL. |
| `psyLive.melodyObserver` | psyLive.ts:252 | DEAD | Only `ensureTimeDomainBuf()` used (line 806). `observe()` never called. Observations array always empty. The LIVE MelodyObserver is inside RadioObservationLayer. |
| `psyLive.radioGate` (RadioStateGate) | psyLive.ts:256 | DECORATIVE | `observe()` never called. `reset/markConnecting/markConnected` called but gate state never updates after connect. Frozen at CONNECTED_NO_SIGNAL. Exposed to UI via `radioState` field — stale. |
| `RadioObservationLayer` pitch block | RadioObservationLayer.ts:183-228 | DEAD | Runs YIN pitch detection, melodic band extraction, spectral flatness — but only when signalState is SIGNAL_PRESENT/STABLE (never). ~50 lines of dead-per-cycle CPU. Even if it ran, `radioSnap.pitch` is never consumed by MusicalSession or psyLive. |
| `RadioObservationLayer.getBeatEngine()` | :363 | DEAD | Never called |
| `RadioObservationLayer.getOccupancy()` | :365 | DEAD | psyLive reads `radioSnap.occupancy` directly |
| `reference/radioStreams.ts` | 127 lines | DEAD | Only imported by dead referenceListener modules |

---

## 9. ROOT CAUSE SUMMARY

| # | Root cause | Impact | Fix |
|---|-----------|--------|-----|
| RC-1 | `radioLayer.markConnected()` never called from connectRadio() | Entire beat/pitch observation pipeline dead. PLL never locks. Engine doesn't follow radio tempo. | Add `this.radioLayer.markConnecting(); this.radioLayer.markConnected();` to connectRadio() |
| RC-2 | `bassFreq` never assigned in psyLive | Key detection dead. Key stuck at A phrygian-dominant. | Wire MelodyObserver or radio bass-band analysis to bassFreq |
| RC-3 | 3 dead station URLs in STREAMS | 50% station failure rate. User perceives "only 2 work". | Remove dead URLs or add health-check + auto-disable |
| RC-4 | 4 desynced state machines | UI shows stale state. 'listening'/'following' unreachable. | Unify to single RadioObservationLayer state machine. Remove RadioStateGate or wire its observe(). |
| RC-5 | No reconnect/backoff | Stream drops silently. No recovery. | Add retry logic with exponential backoff |
| RC-6 | `session.reset()` never called | Learned state leaks across reconnects/switches | Call session.reset() in disconnectRadio() |
| RC-7 | `psyLive.pll` / `psyLive.melodyObserver` / `psyLive.radioGate` are dead instances | Confusion. 3 parallel dead state machines. | Remove dead instances. Use radioLayer's internal instances only. |

---

## 10. VERDICT

The radio subsystem has a **clean audio path** (F10 fix is real, routing is correct, switching is safe) and a **completely dead observation pipeline** (one missing method call kills beat detection, tempo following, pitch observation, and key detection).

The only radio features that work are **spectral** (occupancy-based ducking + style detection + energy tracking). The **temporal** features (beat sync, tempo following, pitch following) are all dead.

The user's "two stations" problem is confirmed: 3/6 stations are dead URLs, and the system has no health checking or fallback.

**The radio is a speaker, not a follower.** It plays through the engine bus correctly, but the engine cannot hear it.
