# F2 RADIO INTEGRATION DESIGN REVIEW

## F2.5 RULE 1 — Design Review Before Runtime Integration

**Date:** 2026-08-12
**Baseline:** HEAD=16f6ef9, 209/209 tests green

---

## 15 QUESTIONS

### 1. What is the exact source of radio observations?

**Current:** `psyLive.ts:detect()` reads `radioAnalyser.getByteFrequencyData(fd)` + `getFloatTimeDomainData(tdBuf)` every 200ms. Sub-bass onset detection (lines 877-891) triggers `onKick()` which calls `transport.observeBeat()`.

**After integration:** `psyLive.ts:detect()` calls `radioLayer.process(tdBuf, fd, ctx.currentTime)` which internally handles signal analysis, beat detection, pitch observation, and calls `transport.observeBeat()` via the BeatObservationEngine output.

### 2. Where is the timestamp assigned?

In `BeatObservationEngine.processBeat()`: `observedAt = candidate.time`, where `candidate.time` is the AudioContext.currentTime passed from `psyLive.ts:detect()`.

### 3. Which clock produces that timestamp?

**AudioContext.currentTime** — passed as `audioTime` to `RadioObservationLayer.process()`. No `Date.now()`, no `performance.now()`, no `setInterval` timing.

### 4. How is analysis latency represented?

`analysisLatency = fftSize / sampleRate / 2 = 512 / 44100 / 2 = 5.8ms`

Every RadioBeatObservation carries:
- `observedAt`: when the analyser frame was read
- `estimatedAt`: `observedAt - analysisLatency`
- `predictedAt`: `estimatedAt + estimatedPeriod`

### 5. Can stale observations modify Transport?

**No.** `BeatObservationEngine.processBeat()` checks `observedInterval <= 0 || > 10s` and rejects. `BeatPLL.update()` also has a guard. Transport's `observeBeat()` uses `lastObsTime` to reject out-of-order timestamps.

### 6. Can out-of-order observations modify Transport?

**No.** Both BeatObservationEngine and Transport reject observations where `time <= lastObsTime`.

### 7. What constitutes NO_SIGNAL / WEAK / PRESENT / STABLE?

- **NO_SIGNAL**: RMS < 1e-5, nonZeroRatio < 0.02
- **WEAK_SIGNAL**: RMS < 1e-4 or nonZeroRatio < 0.05
- **SIGNAL_PRESENT**: RMS > 1e-4, nonZeroRatio > 0.05
- **STABLE_SIGNAL**: SIGNAL_PRESENT sustained for > 5 seconds

### 8. When does Transport enter FOLLOWING?

Transport's `locked` becomes true when:
- ≥ 8 observations with confidence > 0.5
- PLL has converged

psyLive sets `syncStatus = 'following'` when `transport.snapshot().locked && radioSnapshot.state is SIGNAL_PRESENT or STABLE`.

### 9. When does Transport enter HOLDOVER?

When `transport.loseSource()` is called (on radio disconnect). Transport:
- Sets `source = 'internal'`
- Drops confidence by 50% immediately
- Continues at last known BPM
- Confidence decays exponentially (half-life 10s)

### 10. What happens when radio disappears?

1. `disconnectRadio()` calls `transport.loseSource()` → HOLDOVER
2. `radioLayer.reset()` clears signal state
3. Scheduler continues reading Transport (which is in holdover)
4. Playback continues at last known BPM with decaying confidence

### 11. Can loudness alone cause FOLLOWING?

**No.** The old code used `confidence = Math.min(1, radioBands.low * 2)` — a loudness proxy. The new BeatObservationEngine uses:
```
confidence = onsetStrength × 0.5 + regularityFit × 0.3 + signalQuality × 0.2
```
Loudness alone (without onset transient + regularity) produces low confidence.

### 12. Can noise create a false beat lock?

**No.** Noise produces random observations with low regularity fit → low confidence → rejected by the `confidence < 0.3` gate. Even if some pass, the PLL won't lock without ≥ 8 consistent observations.

### 13. Can duplicate observations advance the clock twice?

**No.** Both BeatObservationEngine and Transport track `lastObsTime`. Duplicate timestamps are rejected (`observedInterval <= 0`).

### 14. Can half/double tempo create false certainty?

**Reduced.** Transport tracks `tempoHypotheses`. When ambiguity is detected (interval close to 2× or 0.5× current period), confidence is reduced by 20%. No false certainty.

### 15. Can radio observations ever become the scheduler clock?

**NEVER.** The scheduler reads `transport.snapshot()` and `transport.predictBeats()`. Radio observations flow only through `transport.observeBeat()`. The scheduler never reads from RadioObservationLayer directly.

---

## INTEGRATION PLAN

### What changes in psyLive.ts:

1. **Import RadioObservationLayer** (replace direct RadioStateGate + BeatPLL + MelodyObserver usage)
2. **Initialize radioLayer** in `ensureAudio()`
3. **Replace `detect()`** to call `radioLayer.process(tdBuf, fd, ctx.currentTime)`:
   - Get RadioObservationSnapshot
   - If `snap.beat` is non-null → `transport.observeBeat({ time: snap.beat.timestamp.observedAt, confidence: snap.beat.confidence, source: 'radio' })`
   - Update `syncStatus` from `snap.signal.observationState`
   - Update `occupancy` from `snap.occupancy`
4. **Replace `onKick()`** — no longer needed (RadioObservationLayer handles beat detection internally)
5. **Replace `disconnectRadio()`** — call `radioLayer.reset()` + `transport.loseSource()`
6. **Update debug surface** to expose radio state

### What does NOT change:

- Scheduler (reads Transport, unchanged)
- Transport (unchanged)
- Voice generation (unchanged)
- Audio graph (unchanged)
- Pattern mutation (reads `snap.bar` from Transport, unchanged)

### Risk mitigation:

- Keep `pll` and `radioGate` as private fields (RadioObservationLayer wraps them internally, but psyLive can still reference them if needed)
- Keep `melodyObserver` for the `ensureTimeDomainBuf` helper (or move to radioLayer)
- Test playback BEFORE and AFTER integration
