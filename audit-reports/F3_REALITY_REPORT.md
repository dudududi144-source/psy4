# F3 REALITY REPORT

## Foundation Hardening — Verified Reality

**Date:** 2026-08-12
**HEAD:** 6d150325 (pre-F3), (post-F3 to be committed)

---

## PROVEN

### Transport
1. ✓ Anchor-based clock (beatTime = anchorTime + beatIndex * beatDuration)
2. ✓ AudioContext.currentTime is the only musical clock (no Date.now in psyLive.ts)
3. ✓ No cumulative float drift (30-min simulation: drift bounded by sampling gap)
4. ✓ Immutable snapshots (Object.freeze — F3-R15-Immutable: mutation attempt fails)
5. ✓ Epoch increments on seek/reset/resume/re-anchor
6. ✓ Source field (internal/radio/external/manual)
7. ✓ Internal holdover (loseSource → source=internal, confidence drops)
8. ✓ Recovery (observations resume after holdover)
9. ✓ Tempo change without phase reset (F3-R10-TempoChange: beat continues)
10. ✓ Seek semantics (F3-R10-Seek: epoch increments, position jumps)
11. ✓ Pause/resume (F3-R15-Resume: epoch increments)
12. ✓ Out-of-order observation rejection (BeatPLL + Transport guard)
13. ✓ Stale observation handling (interval > 10s rejected)
14. ✓ Half/double tempo ambiguity (hypotheses tracking, confidence reduced)
15. ✓ Subscribe/unsubscribe (F3-R15-Subscribe: notifications stop after unsubscribe)
16. ✓ Deterministic prediction (predictBeats from anchor)
17. ✓ Explicit confidence (0..1, NOT loudness)
18. ✓ Explicit phase error (phaseErrorMs in BeatObservationEngine)
19. ✓ No hidden second clock (OWN-12: 0 competing clocks in psyLive.ts)
20. ✓ 414ms bug regression (F3-R4: 5 BPMs all produce continuous 16ths with lookahead < beatDuration)

### Radio
1. ✓ RadioObservationLayer wired into psyLive.ts runtime
2. ✓ Radio → RadioObservationLayer → Transport → scheduler chain proven
3. ✓ Confidence is NOT loudness (onset strength + regularity + signal quality)
4. ✓ Radio loss → HOLDOVER (INT-D: source=internal)
5. ✓ Radio recovery → observations resume (INT-E)
6. ✓ Noise → no false FOLLOWING (INT-F: locked=false)
7. ✓ Half/double tempo → no false certainty (INT-G, INT-H)
8. ✓ Out-of-order observations rejected (INT-J)
9. ✓ Duplicate observations don't double-advance (INT-K: delta=0)
10. ✓ Timestamp model (observedAt / estimatedAt / predictedAt)

### Scheduler
1. ✓ Schedules 16th notes directly from Transport beat grid (not predictBeats)
2. ✓ Continuous playback (292 steps in 30s = 9.73/s = 145 BPM × 4 / 60)
3. ✓ Tab suspension: DROP STALE EVENTS (F3-R11: 4 stall durations recovered)
4. ✓ No catch-up burst (F3-R11: ≤1 beat error after 5s stall)
5. ✓ STOP halts scheduling (browser: step frozen after STOP)
6. ✓ PLAY after STOP works (browser: +70 steps in 5s)
7. ✓ schedulerBeat === transportBeat (browser proven)
8. ✓ No scheduler exceptions (F3-R17: 1200 ticks, 0 exceptions)
9. ✓ No runaway allocation (F3-R18: 1514 nodes in 30s, bounded)

### Playback
1. ✓ 30-second continuous playback (browser: 292 steps, uniform spacing)
2. ✓ STOP → PLAY works (browser proven)
3. ✓ No console errors
4. ✓ schedulerBeat === transportBeat === 72 at T=30s

### Adversarial
1. ✓ NaN timestamp — no crash (F3-R8-NaN)
2. ✓ Infinity timestamp — no crash (F3-R8-Infinity)
3. ✓ Negative timestamp — no crash (F3-R8-Negative)
4. ✓ Extremely large timestamp (1e15) — no crash (F3-R8-LargeTs)
5. ✓ ±1ms jitter — P95 phase error = 2.93ms (F3-R8-Jitter1ms)
6. ✓ Tempo jump 120→180→90 — no crash, BPM in valid range (F3-R8-TempoJump)
7. ✓ 500 duplicate observations — no crash, no over-advance (F3-R8-500Dupes)
8. ✓ 100 random bursts — no crash (F3-R8-100Bursts)

### Long-Run
1. ✓ 10-minute drift simulation: 0 NaN, 0 negative confidence, drift bounded by sampling gap
2. ✓ 30-minute drift simulation: 0 NaN, 0 negative confidence, drift bounded by sampling gap

### Consumer Contract
1. ✓ Can create Transport (F3-R15-Create)
2. ✓ Can read snapshot (F3-R15-Observe)
3. ✓ Can observe beats (F3-R15-Observe)
4. ✓ Can change tempo (F3-R15-SetTempo)
5. ✓ Can pause/resume (F3-R15-Resume)
6. ✓ Can seek (F3-R15-SeekEpoch)
7. ✓ Can subscribe/unsubscribe (F3-R15-Subscribe)
8. ✓ Snapshot is immutable (F3-R15-Immutable)

---

## PARTIALLY PROVEN

1. **Real radio browser test** — synthetic fixtures only. Real internet radio may behave differently.
2. **Network/decoder latency calibration** — only analysis latency (5.8ms) is modeled.
3. **60-minute simulation** — 10min and 30min proven, 60min not tested (would be non-default stress).
4. **CPU/allocation measurement** — scheduler tick frequency measured (1200 ticks in 30s), but CPU percentage and GC pressure not measured (UNPROVEN — requires browser profiling tools).

---

## UNPROVEN

1. **Real radio stream in browser** — no actual internet radio was tested
2. **GC pause measurement** — cannot measure in headless test environment
3. **AudioWorklet integration** — not built (future work)
4. **Multi-device sync** — not built (correctly deferred)

---

## KNOWN LIMITATIONS

1. RadioObservationLayer is integrated but uses synthetic fixtures in tests
2. `Date.now()` still exists in old `RadioStateGate.ts` (kept for backward compat; new RadioObservationLayer uses AudioContext.currentTime)
3. Pitch observations produced but not consumed by downstream (future motif layer)
4. 60-minute stress test not included in default suite
5. CPU/GC metrics not measurable in test environment

---

## NEXT RISKS

1. **psy-foundation migration** — psy4 has canonical implementations; migration to shared repo must not break runtime
2. **Real radio latency** — uncalibrated; may cause phase offset in real usage
3. **Background tab throttling** — tested via simulation, not real browser tab suspension
4. **AudioWorklet** — main-thread scheduler may face jitter under load; worklet would help but is not built

---

## TEST COUNT

| Suite | Tests | Status |
|-------|------:|--------|
| Reality Bridge | 56 | ✓ |
| BeatPLL Convergence | 48 | ✓ |
| MelodyObserver | 13 | ✓ |
| Transport Matrix | 21 | ✓ |
| Transport Adversarial | 6 | ✓ |
| Runtime Ownership | 15 | ✓ |
| Playback Reality | 18 | ✓ |
| Radio Observation | 20 | ✓ |
| Radio Adversarial | 12 | ✓ |
| Radio Integration | 12 | ✓ |
| **F3 Hardening** | **28** | **✓ NEW** |
| **TOTAL** | **249** | **✓** |

Lint: **clean**
