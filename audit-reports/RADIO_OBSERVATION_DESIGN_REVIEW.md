# RADIO OBSERVATION DESIGN REVIEW

## F2.0 — Design Review Before Code

**Date:** 2026-08-12
**Baseline:** HEAD=18f1931, 177/177 tests green, playback proven

---

## 18 QUESTIONS

### 1. What is an observation?

An observation is a **timestamped measurement** of a radio signal feature (beat, pitch, energy) at a specific AudioContext.currentTime. It is NOT a musical decision. It is raw data that the Transport may or may not accept.

### 2. What is an observation timestamp?

The AudioContext.currentTime at which the feature was detected. This is the `observedAt` field. It represents when the analyser frame was read, NOT when the sound physically arrived at the speaker (which is earlier due to latency).

### 3. Who owns the timestamp?

The **RadioObservationLayer** owns `observedAt`. The Transport owns `estimatedAt` and `predictedAt`. The Transport may reject, accept, or delay observations — it does not let the radio layer set musical time directly.

### 4. How is AudioContext.currentTime used?

It is the **only** clock. Every observation timestamp comes from `ctx.currentTime` at the moment the analyser frame is read. `Date.now()` is forbidden for musical timing. The existing `RadioStateGate` uses `Date.now()` for `signalAgeMs` — this is a **bug** that must be fixed (replace with `ctx.currentTime`).

### 5. How is radio latency represented?

Three distinct times:
- **observedAt**: when the analyser frame was read (AudioContext domain)
- **estimatedAt**: when the beat ACTUALLY occurred in the radio (observedAt minus analysis latency minus network/decoder latency)
- **predictedAt**: when the NEXT beat will occur (estimatedAt + estimatedPeriod)

The latency model is:
```
radio latency = network buffer + decoder + MediaElementSource + analysis window
```
This is currently uncalibrated (no self-correlation). The observation layer exposes `observedAt` and `estimatedAt`; the Transport uses `estimatedAt` for tempo tracking and `predictedAt` for scheduling.

### 6. What distinguishes observedBeatTime from estimatedBeatTime?

- **observedBeatTime**: the AudioContext.currentTime when the kick transient was detected. Contaminated by all latency sources.
- **estimatedBeatTime**: `observedBeatTime - analysisLatency`, where `analysisLatency ≈ fftSize / sampleRate / 2` (half the FFT window). This is the best estimate of when the beat actually occurred.

### 7. What distinguishes estimatedBeatTime from predictedBeatTime?

- **estimatedBeatTime**: when a beat DID occur (past tense, derived from observation)
- **predictedBeatTime**: when the NEXT beat WILL occur (future tense, `estimatedBeatTime + estimatedPeriod`)

The Transport uses `predictedBeatTime` to schedule audio events ahead of time.

### 8. How is confidence calculated?

**Confidence is NOT low-band energy.** The current code uses `Math.min(1, radioBands.low * 2)` which is a loudness proxy, not a detection confidence.

True confidence must represent:
- **Onset strength**: how much the sub-bass energy EXCEEDED the local average (transient sharpness)
- **Regularity**: how well this observation fits the established period (low phase error = high confidence)
- **Signal quality**: non-noise, tonal, above threshold

Formula:
```
confidence = onsetStrength * 0.5 + regularityFit * 0.3 + signalQuality * 0.2
```
Where:
- `onsetStrength = clamp((sub - threshold) / (max - threshold), 0, 1)`
- `regularityFit = clamp(1 - |phaseError| / (period * 0.25), 0, 1)` (1 if on-beat, 0 if 25% off)
- `signalQuality = clamp(spectralEnergy * 2, 0, 1)` (basic energy check)

### 9. What does "locked" actually mean?

**Locked = the estimator has received enough consistent observations to trust its tempo estimate.**

Requirements:
- ≥ 8 observations with confidence > 0.5
- Phase error P95 < 30ms over recent observations
- No half/double tempo ambiguity (hypotheses are resolved)
- Signal state is SIGNAL_PRESENT or STABLE_SIGNAL

FOLLOWING (the Transport state) requires:
- Radio signal gate is STABLE_SIGNAL
- Beat estimator is locked
- Transport has accepted ≥ 8 observations

### 10. How does the system detect radio loss?

The RadioStateGate detects loss when:
- RMS < 1e-4 for > 2 seconds (signalAgeMs > 2000)
- OR nonZeroRatio < 0.05 for > 2 seconds
- OR HTMLAudioElement reports stalled/error

Transition: STABLE_SIGNAL → DEGRADED → LOST

### 11. How does it distinguish silence from weak signal?

- **Silence**: RMS < 1e-5, nonZeroRatio < 0.02 → NO_SIGNAL
- **Weak signal**: RMS in [1e-5, 1e-4], nonZeroRatio in [0.02, 0.05] → WEAK_SIGNAL
- **Present signal**: RMS > 1e-4, nonZeroRatio > 0.05 → SIGNAL_PRESENT
- **Stable signal**: SIGNAL_PRESENT sustained for > 5 seconds → STABLE_SIGNAL

### 12. How does it reject kick-like transients as melody?

The MelodyObserver already has confidence gates:
- `occupancy.kick > 0.8` → skip (kick-dominant frame)
- `spectralFlatness > 0.5` → skip (noise-like)
- `melodic.peakValue < 0.3` → skip (no salient peak)
- `pitch.confidence < 0.3` → skip (YIN not confident)

These are preserved. The RadioObservationLayer adds: only emit a `RadioPitchObservation` if ALL gates pass.

### 13. How does it reject half/double tempo?

The BeatObservationEngine tracks `tempoHypotheses`. When an observation's interval is close to 2× or 0.5× the current period, it's recorded as an alternative hypothesis. If the alternative accumulates ≥ 3 supporting observations with confidence > 0.5, the engine reduces confidence (ambiguity penalty). The Transport sees the reduced confidence and may not lock.

### 14. How does it handle bursts and missing observations?

- **Bursts** (10 observations in 100ms): rejected — `observedInterval <= 0` or `> 10s` is ignored. Each observation is checked against `lastObsTime`; if interval is absurd, it's dropped.
- **Missing observations**: the `periodsElapsed` computation handles this. If 2 periods elapsed since last observation, the estimator accounts for it without panicking.

### 15. How does it prevent false locks?

- Minimum 8 observations before locking
- Confidence must be > 0.5 (not just > 0)
- Phase error P95 must be < 30ms
- Half/double ambiguity must be resolved
- Signal must be SIGNAL_PRESENT or STABLE_SIGNAL

### 16. How does it recover after a radio gap?

1. Radio loss → Transport enters HOLDOVER (continues at last BPM, confidence decays)
2. Radio returns → RadioStateGate transitions to SIGNAL_PRESENT
3. New observations arrive → BeatObservationEngine processes them
4. If new BPM is within ±5% of holdover BPM → Transport re-locks smoothly (no epoch jump)
5. If new BPM differs by > 5% → Transport re-anchors at next bar boundary (epoch increments)

### 17. What information is allowed to cross into Transport?

- `observedBeatTime` (AudioContext domain)
- `confidence` (0..1, true detection confidence)
- `source` ('radio' | 'manual' | 'external')

That's it. The Transport calls `transport.observeBeat({ time, confidence, source })`.

### 18. What information is forbidden from crossing into Transport?

- Raw audio samples
- Frequency data / FFT bins
- Spectral features (centroid, flatness, etc.)
- Occupancy data
- Pitch observations (those go to the MelodyObserver / future motif layer)
- Style classification
- Signal state (the Transport doesn't care if it's STABLE_SIGNAL or WEAK_SIGNAL — it only cares about validated beat observations)

The Transport is a **time model**, not an audio analysis sink. It receives beat observations and nothing else.

---

## EXISTING CODE AUDIT

### RadioStateGate (169 lines)
- **Bug**: uses `Date.now()` for `signalAgeMs` and `lastUpdateMs` (lines 72, 86, 118, 122, 149)
- **Missing**: STABLE_SIGNAL state (only has PLAYING_SIGNAL)
- **Missing**: DEGRADED and LOST states
- **Fix**: Replace Date.now with ctx.currentTime; add missing states

### BeatPLL (213 lines)
- Already repaired (R1 fix, 48/48 tests pass)
- Provides: bpm, beatTime, confidence, locked, predictBeats
- **Role**: estimator only. Will be wrapped by BeatObservationEngine.

### MelodyObserver (394 lines)
- Already repaired (R2 fix, YIN, 13/13 tests pass)
- Provides: pitch observations with confidence gates
- **Role**: pitch observation. Will be wrapped by the radio layer.

### psyLive.ts detect() (line 719)
- Calls radioGate.observe() with time-domain + frequency data
- Calls melodyObserver.observe() when signal is present
- Calls onKick() which calls transport.observeBeat()
- **Issue**: onKick() confidence is `Math.min(1, radioBands.low * 2)` — this is loudness, not confidence
- **Fix**: BeatObservationEngine computes real confidence

---

## ARCHITECTURE DECISION

```
Radio audio → AnalyserNode → RadioObservationLayer
                                ├── RadioSignalGate (signal state)
                                ├── BeatObservationEngine (wraps BeatPLL)
                                │     → RadioBeatObservation
                                │     → transport.observeBeat()
                                └── PitchObserver (wraps MelodyObserver)
                                      → RadioPitchObservation
                                      → (future: motif layer)
```

The RadioObservationLayer is the SINGLE entry point for all radio analysis. psyLive.ts calls `radioLayer.process(timeDomain, frequencyData, sampleRate, ctx)` once per detect tick. The layer handles everything else.

**Transport boundary**: only `transport.observeBeat({ time, confidence, source })` crosses. Nothing else.
