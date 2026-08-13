# RADIO OBSERVATION REALITY REPORT

## F2 — Radio Observation Layer

**Date:** 2026-08-12
**Status:** F2 — PASS

---

## ARCHITECTURE

```
Radio audio → AnalyserNode → RadioObservationLayer.process()
                                ├── Signal analysis (RMS, peak, spectral energy)
                                ├── Signal state machine (NO_SIGNAL → WEAK → PRESENT → STABLE)
                                ├── BeatObservationEngine (wraps BeatPLL)
                                │     ├── Onset detection (sub-bass threshold crossing)
                                │     ├── Real confidence (onset strength + regularity + signal quality)
                                │     ├── BeatPLL estimation (bpm, period, phase error)
                                │     └── RadioBeatObservation output
                                └── PitchObserver (wraps MelodyObserver)
                                      ├── Confidence gates (kick occupancy, flatness, salience)
                                      ├── YIN pitch detection
                                      └── RadioPitchObservation output
```

## OWNERSHIP

| What | Owner | Evidence |
|------|-------|---------|
| Musical time (bpm, beat, bar, phase) | MusicalTransport | Transport is the single runtime clock (F1 proven) |
| Radio signal state | RadioObservationLayer | Signal state machine in RadioObservationLayer |
| Beat observations | BeatObservationEngine | Wraps BeatPLL, produces RadioBeatObservation |
| Pitch observations | RadioObservationLayer | Wraps MelodyObserver, produces RadioPitchObservation |
| Audio scheduling | psyLive scheduler | Reads Transport, schedules Web Audio nodes |

**Transport boundary:** Only `{ time, confidence, source }` crosses into Transport via `transport.observeBeat()`. No raw audio, FFT, spectral features, or occupancy cross.

## SIGNAL STATES

```
DISCONNECTED → CONNECTING → NO_SIGNAL → WEAK_SIGNAL → SIGNAL_PRESENT → STABLE_SIGNAL
                                                                         ↓
                                                                      DEGRADED
                                                                         ↓
                                                                       LOST
```

FOLLOWING requires: STABLE_SIGNAL + estimator locked + ≥8 observations.

## OBSERVATION MODEL

Every observation carries:
- `observedAt`: AudioContext.currentTime when analyser frame was read
- `estimatedAt`: `observedAt - analysisLatency` (latency-corrected)
- `predictedAt`: `estimatedAt + estimatedPeriod` (for scheduling)
- `confidence`: 0..1 (onset strength × 0.5 + regularity fit × 0.3 + signal quality × 0.2)
- `phaseErrorMs`: |observed - predicted| in ms

## LATENCY MODEL

```
radio latency = network buffer + decoder + MediaElementSource + analysis window
analysisLatency = fftSize / sampleRate / 2 = 512 / 44100 / 2 = 5.8ms
```

Currently uncalibrated for network/decoder latency (future work).

## TEST RESULTS

| Suite | Tests | Status |
|-------|------:|--------|
| Reality Bridge | 56 | ✓ |
| BeatPLL Convergence | 48 | ✓ |
| MelodyObserver | 13 | ✓ |
| Transport Matrix | 21 | ✓ |
| Transport Adversarial | 6 | ✓ |
| Runtime Ownership | 15 | ✓ |
| Playback Reality | 18 | ✓ |
| **Radio Observation (A-T)** | **20** | **✓ NEW** |
| **Radio Adversarial** | **12** | **✓ NEW** |
| **TOTAL** | **209** | **✓ 209/209** |

Lint: **clean**

## ADVERSARIAL RESULTS

| Test | Scenario | Result |
|------|----------|--------|
| ADV-1 | 100 random beat bursts | ✓ no crash, valid state |
| ADV-2 | 500 duplicate observations | ✓ no crash, valid state |
| ADV-3 | Out-of-order timestamps | ✓ no crash |
| ADV-4 | Impossible timestamps (NaN, Infinity, negative) | ✓ no crash |
| ADV-5 | Tempo jumps 80→180→90 | ✓ no crash, BPM in [60,200] |
| ADV-6 | Half/double ambiguity | ✓ no crash |
| ADV-7 | Silence → signal → silence | ✓ recovers |
| ADV-8 | Signal → noise → signal | ✓ no crash |
| ADV-9 | Pitch jump 2 octaves (220→880Hz) | ✓ no crash |
| ADV-10 | Kick + melody simultaneously | ✓ pitch rejected by kick gate |
| ADV-11 | 30-second jitter stream | ✓ no crash |
| ADV-12 | 10-minute observation stream | ✓ no crash, 0 NaN |

## BROWSER EVIDENCE

Playback regression test (no radio layer integration yet — radio layer is standalone):

| Time | Beat | Step | BPM |
|------|-----:|-----:|----:|
| T=5s | 12 | 50 | 145 |
| T=10s | 24 | 99 | 145 |

+49 steps in 5s = correct 145 BPM rate. No errors. STOP→PLAY works.

## CLAIMS PROVEN

1. Radio observation layer produces timestamped observations ✓
2. Confidence is NOT loudness — it's onset strength + regularity + signal quality ✓
3. Signal state machine works (NO_SIGNAL → WEAK → PRESENT → STABLE) ✓
4. Beat observations carry observedAt/estimatedAt/predictedAt ✓
5. Pitch observations are rejected when kick-dominant ✓
6. No false FOLLOWING on noise ✓
7. No crashes on adversarial input (NaN, Infinity, out-of-order, bursts) ✓
8. 10-minute stream: 0 NaN, 0 crashes ✓
9. Transport boundary maintained (only time/confidence/source crosses) ✓
10. Existing playback not broken (209/209 tests, browser verified) ✓

## CLAIMS NOT PROVEN

1. **Radio layer not yet integrated into psyLive.ts** — the layer exists and passes tests standalone, but psyLive still uses its own inline detect()/onKick(). Integration is a separate step (would require refactoring detect() to use RadioObservationLayer).
2. **Network/decoder latency uncalibrated** — only analysis latency (5.8ms) is modeled. Full radio latency requires self-correlation.
3. **Pitch observation not sustained** — single-frame pitch detection works, but note duration tracking needs sustained signal (MelodyObserver.flush() not called in single-frame tests).
4. **Browser radio test not run** — the radio layer is tested via synthetic fixtures, not real radio streams (to avoid network dependency in tests).

## KNOWN LIMITATIONS

1. RadioObservationLayer is built and tested but NOT wired into psyLive.ts (standalone module)
2. Date.now() still used in RadioStateGate.ts (the old module) — the new RadioObservationLayer uses AudioContext.currentTime
3. No real-radio browser test (synthetic fixtures only)
4. Pitch observation requires sustained signal — single-frame detection may not produce observations

## PERFORMANCE

- BeatObservationEngine: O(1) per observation (BeatPLL is O(1))
- RadioObservationLayer.process(): O(N) where N = fftSize (512) — bounded
- Bounded ring buffers (maxObservations = 200)
- No per-frame object explosion (observations are only created on beat detection, not every frame)

## F2 — PASS

All F2 gate criteria met:
- ✓ Radio observation layer built (foundation/radio/)
- ✓ 20/20 deterministic test matrix (A-T) pass
- ✓ 12/12 adversarial tests pass
- ✓ No crashes, no NaN, no false FOLLOWING
- ✓ Transport boundary maintained
- ✓ 209/209 total tests pass (177 existing + 32 new)
- ✓ Lint clean
- ✓ Playback not broken (browser verified)
- ✓ STOP → PLAY works
