# PSY4 SIGNAL TRACE — End-to-End Routing Map

**Generated:** 2026-08-12
**HEAD:** `b6fb3a78559440aa12838000c38a02917799b541`
**Method:** Static source read of `src/lib/psyLive.ts` (906 lines), `src/lib/beatPLL.ts`, `src/lib/melodyObserver.ts`, `src/lib/patternMutator.ts`, `src/lib/pooledEngine.ts`, `src/lib/soundBank.ts`, `src/lib/learning.ts` + dynamic AudioContext shim audit.

This document traces every arrow in the claimed audio pipeline. For each arrow we identify:
- **Source file**
- **Function**
- **Data structure passed**

---

## 1. CLAIMED PIPELINE (per architecture docs)

```
RADIO STREAM → audio acquisition → AudioContext → MediaElementSource
  → radio analyser → FFT/time-domain → feature extraction
  → BeatPLL → musical clock → scheduler → MusicState → role generation
  → PooledEngine → role buses → ducking/saturation/EQ → master → speakers
```

---

## 2. ACTUAL PIPELINE (as wired in `psyLive.ts`)

### 2.1 Radio acquisition

| Step | File | Function | Data structure |
|------|------|----------|----------------|
| 1 | `psyLive.ts:598` | `new Audio()` | `HTMLAudioElement` |
| 2 | `psyLive.ts:599` | `radioEl.crossOrigin = 'anonymous'` | string |
| 3 | `psyLive.ts:600` | `radioEl.src = stream.url` | string URL |
| 4 | `psyLive.ts:601` | `this.ctx.createMediaElementSource(this.radioEl)` | `MediaElementAudioSourceNode` |
| 5 | `psyLive.ts:613` | `await this.radioEl.play()` | Promise (only confirms play initiated, NOT that audio is flowing) |
| 6 | `psyLive.ts:614-615` | `this.radioOn = true; this.syncStatus = 'listening'` | `LiveState.syncStatus` ← **NO signal verification** |

**REALITY GATE MISSING.** Step 6 sets `LISTENING` without ever checking that the analyser has received non-zero samples. The `RadioStateGate` we added in `src/lib/radioStateGate.ts` corrects this, but the live engine does not yet use it.

### 2.2 Radio analysis chain

| Step | File:Line | Function | Data structure |
|------|-----------|----------|----------------|
| 7 | `psyLive.ts:603-607` | `createGain()`, `createAnalyser()` | `radioGain: GainNode`, `radioAnalyser: AnalyserNode` (fftSize=512) |
| 8 | `psyLive.ts:610-612` | `radioSource → radioGain → radioAnalyser → master` | `AudioNode` connect edges |
| 9 | `psyLive.ts:642-644` | `setInterval(() => this.detect(), 200)` | 200ms tick |
| 10 | `psyLive.ts:653` | `radioAnalyser.getByteFrequencyData(fd)` | `Uint8Array(256)` |
| 11 | `psyLive.ts:658` | `radioAnalyser.getFloatTimeDomainData(tdBuf)` | `Float32Array(512)` (the b6fb3a7 fix) |

### 2.3 Feature extraction (inside `detect()`)

| Feature | File:Line | Computation | Output |
|---------|-----------|-------------|--------|
| Sub-bass energy | `psyLive.ts:668-670` | `sum(fd[0..9]) / (10*255)` | `sub: 0..1` |
| Total level | `psyLive.ts:672-675` | `sum(fd[i*4]) / (cnt*255)` | `radioLevel: 0..1` |
| RMS (smoothed) | `psyLive.ts:676` | `radioRms = radioRms*0.85 + total*0.15` | `radioRms: 0..1` |
| Bands (low/mid/high) | `psyLive.ts:678-689` | `sum(fd[0..250Hz])`, `sum(fd[250..2500Hz])`, `sum(fd[2500Hz..])` | `radioBands: {low, mid, high}` |
| Occupancy (kick/bass/lead/hats) | `psyLive.ts:697-712` | thresholded band energy + fast-attack/slow-release smoother | `occupancy: {kick, bass, lead, hats}` |
| Role ducking | `psyLive.ts:718-732` | `kickBus.gain.setTargetAtTime(0.05 if occ.kick>0.7 else 0.9, ...)` | per-bus gain |
| Kick onset | `psyLive.ts:782-795` | `sub > threshold (avg + (max-avg)*0.55) && prev <= threshold` | triggers `onKick()` |

### 2.4 BeatPLL path

| Step | File:Line | Function | Data structure |
|------|-----------|----------|----------------|
| 12 | `psyLive.ts:836-837` | `pll.update({ time: now, confidence: Math.min(1, radioBands.low*2) })` | `BeatObservation` |
| 13 | `beatPLL.ts:45-88` | `update()`: phase correction (gain 0.18) + tempo correction (gain 0.025) + lock after 8 obs | internal `bpm`, `beatTime`, `locked` |
| 14 | `psyLive.ts:840-854` | if `pll.isLocked()`: `radioBpm = round(pll.getBpm())`, `engineBpm += (pllBpm - engineBpm)*0.3`, `syncStatus = 'following'` | `LiveState.radioBpm`, `engineBpm`, `syncStatus` |

**REALITY FAILURE (PLL-2A/2B/2C/2D/2E/2F):** the PLL cannot converge to any tempo other than its hardcoded initial `bpm = 150`. See test results in `tests/reality-bridge/results.json`. Root cause: `tempoGain=0.025` is too small AND the guard `observedPeriod < 60/80` (=0.75s) rejects the corrected-period computation because `observedPeriod = obs.time - beatTime` produces a doubled period when the PLL's internal `beatTime` lags behind true beat times.

### 2.5 Scheduler path

| Step | File:Line | Function | Data structure |
|------|-----------|----------|----------------|
| 15 | `psyLive.ts:427` | `setInterval(() => this.scheduler(), 25)` | 25ms lookahead |
| 16 | `psyLive.ts:482-502` | if `pll.isLocked() && radioOn`: `beats = pll.predictBeats(now, 0.2)`, schedule 4×16th notes per beat | `stepKey = Math.round(stepTime*1000)` (dedup) |
| 17 | `psyLive.ts:503-510` | else: own clock `while nextNoteTime < now + 0.15: scheduleStep(step, nextNoteTime); nextNoteTime += stepDur()` | `step: 0..63` (4 bars × 16th) |
| 18 | `psyLive.ts:516-565` | `scheduleStep(step, time)`: pattern mutation check (s16===0 && barCount%8===0), then `kick/hat/bass/lead` voice triggers based on occupancy + density | `Pattern { kick, bass, lead, hat }` |

**CONNECTED & EXECUTED.** The scheduler does consume PLL predictions when `isLocked()` is true. But because the PLL never converges to anything except 150 BPM (and the engine starts at 145 BPM in preset `rolling_bass`), the scheduler effectively always uses the PLL branch when radio is on, with a BPM ≈ 150.

### 2.6 Voice generation (NOT PooledEngine)

| Step | File:Line | Function | Data structure |
|------|-----------|----------|----------------|
| 19 | `psyLive.ts:360-370` | `kick(t)`: `ctx.createOscillator() + ctx.createGain()` → `kickBus` | inline Web Audio nodes |
| 20 | `psyLive.ts:372-381` | `hat(t, lvl)`: `ctx.createBufferSource() + ctx.createBiquadFilter() + ctx.createGain()` → `hatBus` | inline Web Audio nodes |
| 21 | `psyLive.ts:383-397` | `bass(t, freq, v)`: `createOscillator + createBiquadFilter + createGain` → `bassBus` (+ delay send) | inline Web Audio nodes |
| 22 | `psyLive.ts:399-417` | `lead(t, freq, v, accent)`: 2× `createOscillator + createBiquadFilter + createGain` → `leadBus` (+ delay send) | inline Web Audio nodes |

**REALITY FAILURE (PE-7E):** The voices are created INLINE per note. `PooledEngine` (in `src/lib/pooledEngine.ts`) is **NOT IMPORTED** by `psyLive.ts` — it's dead code. The "no GC dropouts" claim is therefore inapplicable to the live engine (which creates ~9.67 new AudioNodes per second per active voice type = up to 4×9.67 ≈ 39 nodes/sec at 145 BPM 16th notes).

### 2.7 Per-role buses & master chain

| Step | File:Line | Function | Data structure |
|------|-----------|----------|----------------|
| 23 | `psyLive.ts:334-340` | `kickBus, bassBus, leadBus, hatBus` (GainNodes), `engineBus` (GainNode) | per-role bus gains: kick=0.9, bass=0.85, lead=0.7, hat=0.6; engineBus=0.8 |
| 24 | `psyLive.ts:343-348` | `comp = ctx.createDynamicsCompressor()`: threshold=-18, knee=18, ratio=2, attack=15ms, release=120ms | `DynamicsCompressorNode` |
| 25 | `psyLive.ts:351-356` | `kickBus, bassBus, leadBus, hatBus → engineBus → comp → master` | routing edges |
| 26 | `psyLive.ts:304-310` | `master → analyser → ctx.destination` | routing edges |
| 27 | `psyLive.ts:312-321` | `delaySend → delay (1.5s max) → wet (0.22) → master`, `delay → fb (0.34) → delay` | feedback delay |

**NO LIMITITER.** The master chain is `engineBus → comp (2:1) → master (gain) → analyser → destination`. There is no limiter, no final saturation, no true-peak limiter. The compressor is on the ENGINE bus only (not the master, so radio passes through uncompressed and can clip against engine output).

### 2.8 MusicState path

| Step | File:Line | Function | Data structure |
|------|-----------|----------|----------------|
| 28 | `psyLive.ts:738-745` | energy + energySlope from 32-sample history | `musicState.energy, energySlope` |
| 29 | `psyLive.ts:747-749` | `musicState.radioRoles = {...occupancy}; musicState.bpm = radioBpm || engineBpm` | MusicState fields |
| 30 | `psyLive.ts:752-765` | `classifyStyle()` + 8s hysteresis → `currentStyle` | `musicState.style` (fullOn/dark/progressive/acid) |
| 31 | `psyLive.ts:768-779` | competitive density control: rising slope → reduce density; falling → increase; stable → drift to 0.7 | `musicState.density` |

**REALITY FAILURE (MS-10A):** No song-structure state machine. The worklog claims "intro→build→peak→break→peak2→outro" but the source has zero mentions of INTRO/BUILD/PEAK/BREAK/OUTRO. MusicState is purely reactive (occupancy + energy slope) — there is no long-form arrangement.

### 2.9 Pattern mutation path

| Step | File:Line | Function | Data structure |
|------|-----------|----------|----------------|
| 32 | `psyLive.ts:521-533` | at s16===0: `barCount++`; if `barCount % 8 === 0`: `mutated = mutatePattern(basePattern, occupancy, density)` | `Pattern \| null` |
| 33 | `patternMutator.ts:227-260` | generate 4 candidates, score each, return best if `best.score > currentScore` | `Pattern` |
| 34 | `psyLive.ts:536` | `pat = this.livePattern || p.patterns` | fallback to preset pattern |

**CONNECTED & EXECUTED.** Pattern mutation runs every 8 bars. 200-cycle stress test (PM-4A) confirms: 100% constraint compliance, no duplicates, mean density delta ≈ 0.08 (small evolutionary steps). This subsystem WORKS as claimed.

### 2.10 MelodyObserver path

| Step | File:Line | Function | Data structure |
|------|-----------|----------|----------------|
| 35 | `psyLive.ts:656-665` | every 4th detect tick: `melodyObserver.observe(fd, tdBuf, sampleRate, fftSize, currentTime, beatIndex, barIndex, occupancy)` | `MelodyObservation[]` |
| 36 | `melodyObserver.ts:174-253` | confidence gates (kick>0.8, energy<0.15, flatness>0.5, peakValue<0.3, pitchConf<0.3, combinedConf<0.4) → `estimatePitch()` → MIDI conversion | `MelodyObservation` |

**REALITY FAILURES (MO-3A/3B/3C/3H/3K):**
1. `estimatePitch()` returns 110 Hz for 440 Hz input — exactly 1/4 of the true frequency. The normalized autocorrelation locks onto the 4th sub-harmonic. The function comment claims "less octave errors" but the test produces -2400 cent errors (2 octaves low).
2. `spectralFlatness()` returns 0.85 for a pure tone with noise floor, which triggers the `flatness > 0.5` rejection gate. Pure tones are therefore classified as noise.
3. A clean 440 Hz signal produces ZERO observations because the flatness gate rejects it.

**MelodyObserver does NOT observe the melody.** It either (a) locks to sub-harmonics or (b) gets blocked by its own confidence gates. The `getMelodyObservations()` API is wired into the engine, but the observations array is effectively always empty for clean tonal input.

### 2.11 Learning path

| Step | File:Line | Function | Data structure |
|------|-----------|----------|----------------|
| 37 | `psyLive.ts:849-853` | on PLL lock: `recordKick(learningData, round(pllBpm))` + `deriveInsights()` + `saveLearning()` | `LearningData.bpmVotes` |
| 38 | `psyLive.ts:807-811` | every 8 kicks: `recordBassNote(learningData, bassFreq)` + `deriveInsights()` + `saveLearning()` | `LearningData.pitchClassHistogram` |
| 39 | `learning.ts:326-331` | `deriveInsights()` calls `detectScale(histogram)` + `computeTempoStats(history)` | `ScaleInfo`, `TempoStats` |
| 40 | `learning.ts:144-150` | `saveLearning(data)` writes `localStorage['psy-live-learn-v2']` | JSON |

**NOT ONLINE LEARNING (LR-5D).** There is no reward function, no policy, no action selection, no update rule. The "learning" is purely statistical bookkeeping: histograms of BPM votes and pitch-class votes. The composition generator (`generateComposition`) reads these histograms and picks chord progressions + rhythm variations RANDOMLY from fixed tables. Calling this "REINFORCE" or "continuous learning" is misleading.

### 2.12 Dead code (NOT in pipeline)

The following modules exist in the repo but are NOT imported by `psyLive.ts` or `page.tsx`:

- `src/lib/pooledEngine.ts` — 490 lines, has `PooledEngine`, `SynthVoice`, `DrumVoice` classes (verified: only mentioned in a comment in psyLive.ts:5)
- `src/lib/studio/engine/reference/continuousTrainer.ts`
- `src/lib/studio/engine/reference/trainingLoop.ts`
- `src/lib/studio/engine/reference/selfAnalyzer.ts`
- `src/lib/studio/engine/reference/learningMemory.ts`
- `src/lib/studio/engine/reference/perVoiceAnalyzer.ts`
- `src/lib/studio/engine/reference/referenceScore.ts`
- `src/lib/studio/engine/reference/worldDNA.ts`
- `src/lib/studio/engine/reference/renderWorker.ts`
- `src/lib/studio/engine/musicalMemory.ts`
- `src/lib/studio/engine/musicAnalyzer.ts`
- `src/lib/studio/engine/vocabularyLearner.ts`
- `src/lib/studio/engine/musicalDirector.ts`
- `src/lib/studio/engine/psy4EngineV2.ts`
- `src/lib/studio/engine/flowEngine.ts`
- `src/lib/studio/engine/harmonyEngine.ts`
- `src/lib/studio/engine/layerEngine.ts`
- `src/lib/studio/engine/callResponseEngine.ts`
- `src/lib/studio/engine/phraseSync.ts`
- `src/lib/studio/engine/motifEngine.ts` (and ~30 more)

These are imported only by 3 admin/forensic API routes (`/api/reference/train`, `/api/forensic/render`, `/api/forensic/analyze`) which do NOT participate in the live audio path that the user hears.

**SOUND_BANK** (142 presets) is imported by `psyLive.ts:16` but **NEVER CALLED**. The engine uses inline `createOscillator` calls in `kick()/bass()/lead()/hat()` — it does not call `getById()` or `autoSelect()` or iterate `SOUND_BANK`. The 142 presets are therefore DISCONNECTED from the runtime.

---

## 3. SUMMARY TABLE

| Arrow # | From → To | Status | Evidence |
|---------|-----------|--------|----------|
| 1-6 | Radio URL → `LISTENING` state | **BROKEN** | Sets state without verifying signal |
| 7-11 | Radio → analyser → FFT | CONNECTED | getByteFrequencyData + getFloatTimeDomainData |
| 12-14 | analyser → BeatPLL → `engineBpm` | **DEFECTIVE** | PLL cannot converge to any tempo ≠ 150 BPM |
| 15-18 | PLL → scheduler → scheduleStep | CONNECTED | Scheduler uses `pll.predictBeats()` when locked |
| 19-22 | scheduleStep → inline voices | CONNECTED | But creates ~39 AudioNodes/sec (no pooling) |
| 23-27 | voices → role buses → comp → master → destination | CONNECTED | No limiter; compressor on engine only |
| 28-31 | analyser → MusicState → density | CONNECTED | But no song-structure state machine |
| 32-34 | scheduler → pattern mutation | CONNECTED + VERIFIED | 200-cycle test: 0 violations |
| 35-36 | analyser → MelodyObserver | **DEFECTIVE** | estimatePitch returns -2 octave errors; flatness gate rejects tones |
| 37-40 | analyser → learning → localStorage | CONNECTED | But NOT online learning (no reward/policy) |
| Dead | PooledEngine, studio/engine/*, SOUND_BANK presets | **DISCONNECTED** | Not imported by runtime |

---

## 4. KEY ASYMMETRIES

1. **The runtime engine (psyLive.ts) is simpler than the architecture docs claim.** It uses inline Web Audio calls, not PooledEngine. It does not use the 142-preset sound bank. It does not have song structure.

2. **The dead-code modules exist for forensic/offline APIs only.** They are not part of what the user hears.

3. **The PLL + MelodyObserver + PatternMutator chain has two broken links (PLL convergence, MelodyObserver pitch detection).** PatternMutator works. The other two do not.

4. **The "REINFORCE / continuous learning" claim is unsupported.** The code does statistical bookkeeping, not reinforcement learning.
