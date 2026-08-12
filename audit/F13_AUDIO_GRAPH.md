# F13 — REAL AUDIO GRAPH

**HEAD:** `017ef70` (F11) · **Source:** `psyLive.ts` lines 348-445 (ensureAudio), 448-528 (voices), 731-752 (radio connect).

Every node, every gain, every connection — traced from source code, not comments.

---

## 1. COMPLETE AUDIO GRAPH (as built at runtime)

```
                                    ┌─────────────────────────────────────────────────┐
                                    │                                                 │
                                    │              ENGINE BUSSES                      │
                                    │                                                 │
  kick(t) ──────────────────────────┼─→ kickBus (GainNode, 0.95) ─────────┐           │
    osc: sine 180→44Hz              │                                       │           │
    + noise click (HPF 3kHz)        │                                       │           │
                                    │   bass(t,f,v) ─→ bassBus (0.85) ──────┤           │
                                    │     osc: v.bassWave (sawtooth)        │           │
                                    │     → LPF(cut=v.bassCut, Q=v.bassQ)   │           │
                                    │     → gain env (0.0001→0.85→0.3→0.001)│           │
                                    │     → delay send (0.08) ──────┐       │           │
                                    │                               │       │           │
                                    │   lead(t,f,v,a) ─→ leadBus (0.5) ────┤           │
                                    │     2× osc: triangle (7¢ detune)      │           │
                                    │     → LPF(Q=v.leadQ*0.5, 200→cut→300) │           │
                                    │     → gain env (0.0001→peak→0.001)    │           │
                                    │     → delay send (0.12) ──────┐       │           │
                                    │     → reverb send (0.15) ─────┼───┐   │           │
                                    │                               │   │   │           │
                                    │   hat(t,lvl) ─→ hatBus (0.55) ┤   │   │           │
                                    │     noise buffer → HPF(7kHz)   │   │   │           │
                                    │     → gain env (lvl→0.001)     │   │   │           │
                                    │                                       │   │   │           │
                                    └───────────────────────────────────────┘   │   │           │
                                                                              ▼   ▼   │           │
                                                          engineBus (GainNode, 0.8)           │           │
                                                                │                             │           │
                                                                ▼                             │           │
                                                  comp (DynamicsCompressor)                     │           │
                                                  threshold: -18dB                              │           │
                                                  knee: 18dB                                    │           │
                                                  ratio: 2:1                                     │           │
                                                  attack: 15ms                                   │           │
                                                  release: 120ms                                 │           │
                                                        │                                         │           │
                                                        ▼                                         │           │
  RADIO PATH ──────────────────────────────────────────────────────────────────┐ │           │
  radioEl (HTMLAudioElement)                          │                        │ │           │
    ↓ crossOrigin='anonymous'                         ▼                        │ │           │
  radioSource (MediaElementAudioSourceNode) ──→ radioGain (GainNode, 0.5)       │ │           │
                                                     │                        │ │           │
                                                     ▼                        │ │           │
                                                  radioAnalyser (AnalyserNode)│ │           │
                                                  fftSize: 512                 │ │           │
                                                  smoothing: 0.2               │ │           │
                                                     │                        │ │           │
                                                     ▼                        │ │           │
                                                  engineBus ─────────────────┘ │  ← F10 fix │
                                                      (joins engine)            │           │
                                                                                 ▼           │
                                                          master (GainNode, 0.9) ◄───────────┘
                                                                │
                                                    ┌───────────┼───────────────────────────┐
                                                    │           │                               │
                                                    ▼           ▼                               ▼
  DELAY PATH                              delaySend (0.0)   reverbSend (0.0)            safetyLimiter
  (GainNode)                                  │                │                    (DynamicsCompressor)
                                              ▼                ▼                    threshold: -1dB
                                           delay               convolver             ratio: 20:1
                                           (DelayNode)         (ConvolverNode)       knee: 0dB
                                           delayTime: 0.3s     IR: 1.8s generated    attack: 3ms
                                              │                  │                   release: 50ms
                                    ┌─────────┤                  ▼                       │
                                    │         │              reverbWet (0.5)              │
                                    ▼         │                  │                        ▼
                                 wet (0.22)   │                  │                  analyser
                                    │         │                  │                  (AnalyserNode)
                                    │         ▼                  │                  fftSize: 512
                                    │      delayFb (0.34)         │                  smoothing: 0.7
                                    │         │                  │                        │
                                    └─────────┘                  │                        ▼
                                    (feedback loop)              │                  ctx.destination
                                                                └─→ master ◄────────────────────┘
```

---

## 2. NODE INVENTORY (verified by code)

### 2.1 Source nodes (voices)

| Node | Created at | Waveform | Frequency | Envelope | Bus | Send to delay | Send to reverb |
|------|-----------|----------|-----------|----------|-----|---------------|----------------|
| Kick osc | psyLive.ts:451 | sine | 180→44Hz exp ramp (0.09s) | 1.0→0.001 exp (0.5s) | kickBus | no | no |
| Kick click | psyLive.ts:462 | noise buffer | HPF 3kHz | 0.4→0.001 exp (0.02s) | kickBus | no | no |
| Bass osc | psyLive.ts:485 | v.bassWave (sawtooth) | note freq | 0.0001→0.85→0.3→0.001 (0.35s) | bassBus | 0.08 | no |
| Lead osc 1 | psyLive.ts:507 | **triangle** (hardcoded, ignores v.leadWave) | note freq | 0.0001→peak→0.001 (0.24s) | leadBus | 0.12 | 0.15 |
| Lead osc 2 | psyLive.ts:507 | **triangle** | note freq × 2^(7/1200) (7¢ detune) | same as osc1 | leadBus | (shared) | (shared) |
| Hat | psyLive.ts:474 | noise buffer | HPF 7kHz | lvl→0.001 exp (0.05s) | hatBus | no | no |

### 2.2 Bus nodes (per-role)

| Bus | Gain (default) | Created at | Connects to | Clobbered? |
|-----|---------------|------------|-------------|------------|
| kickBus | 0.95 | psyLive.ts:422 | engineBus | YES — detect() line 870-871 overwrites to 0.05 or 0.9 every 200ms when radio on |
| bassBus | 0.85 | psyLive.ts:423 | engineBus | YES — lines 872-873 → 0.35 or 0.85 |
| leadBus | 0.5 | psyLive.ts:424 | engineBus | YES — lines 874-875 → 0.55 or 0.7 |
| hatBus | 0.55 | psyLive.ts:425 | engineBus | YES — line 876 → 0.6 (constant, ignores user) |
| engineBus | 0.8 | psyLive.ts:427 | comp | no |
| radioGain | 0.5 | psyLive.ts:743 | radioAnalyser | no (but setRadioVolume uses .value= not setTargetAtTime) |

### 2.3 FX nodes

| Node | Type | Params | Created at | Wet | Connects to |
|------|------|--------|------------|-----|-------------|
| delaySend | GainNode | 0.0 (default, slider 0-1) | 372 | — | delay |
| delay | DelayNode | delayTime = stepDur × 3 (psyLive.ts:616) | 374 | — | wet + delayFb |
| delayFb | GainNode | 0.34 (default, slider 0-1) | 377 | — | delay (feedback) |
| wet | GainNode | 0.22 | 376 | 0.22 | master |
| reverbSend | GainNode | 0.0 (default, slider 0-1) | 383 | — | convolver |
| convolver | ConvolverNode | IR: 1.8s generated (mkIR, line 995) | 384 | — | reverbWet |
| reverbWet | GainNode | 0.5 | 386 | 0.5 | master |

### 2.4 Master chain

| Node | Type | Params | Created at | Connects to |
|------|------|--------|------------|-------------|
| comp | DynamicsCompressor | threshold=-18dB, knee=18, ratio=2, attack=15ms, release=120ms | 431 | master |
| master | GainNode | 0.9 (default, slider 0-1) | 355 | safetyLimiter |
| safetyLimiter | DynamicsCompressor | threshold=-1dB, knee=0, ratio=20, attack=3ms, release=50ms | 361 | analyser |
| analyser | AnalyserNode | fftSize=512, smoothing=0.7 | 357 | ctx.destination |

---

## 3. PATHOLOGIES FOUND

### 3.1 NO direct-to-destination bypass ✅
Every voice path terminates at ctx.destination through the master → safetyLimiter → analyser chain. No voice connects directly to destination.

### 3.2 NO duplicate master paths ✅
Single master GainNode. Single safetyLimiter. Single analyser→destination edge.

### 3.3 NO duplicate compressor ✅
The comp (engine bus compressor) and safetyLimiter (master brickwall) serve different roles and are in series, not parallel.

### 3.4 Radio bypass — FIXED (F10) ✅
psyLive.ts:752 `radioAnalyser.connect(this.engineBus!)` — radio now goes through comp + safetyLimiter. Previously went straight to master (bypassing comp). F10 fix is REAL.

### 3.5 Analyser placement — MINOR BUG
The main `analyser` (line 357) sits AFTER safetyLimiter (line 368). `engineLevel` (psyLive.ts:933-938) is computed from this analyser. Since radio also feeds engineBus → comp → master → safetyLimiter → analyser, `engineLevel` actually measures **engine + radio combined**, not engine alone. The UI label "engine level" is misleading.

### 3.6 NO orphan nodes ✅
All created nodes are connected. No `createGain()` without a `connect()`.

### 3.7 NO disconnected nodes ✅
All voices connect to their role bus. All role buses connect to engineBus. engineBus connects to comp → master → safetyLimiter → analyser → destination.

### 3.8 NO nodes recreated unexpectedly ✅
`ensureAudio()` guards with `if (this.ctx) return` (line 350). Radio gain/analyser created once (guard at line 741 `if (!this.radioGain)`).

### 3.9 NO multiple AudioContexts ✅
Single `this.ctx`. `ensureAudio()` guards creation.

### 3.10 Hidden gain stages — ⚠️ TWO FOUND
1. **`wet` gain (0.22)** — psyLive.ts:376. The delay wet return has a fixed 0.22 gain. This is IN ADDITION to `delaySend` (which the user controls). So the effective delay wet level = `delaySend × 0.22`. The user's "DELAY" slider (0-1) sets delaySend, but the actual wet level is capped at 0.22. This is intentional (prevents runaway delay) but undocumented.
2. **`reverbWet` gain (0.5)** — psyLive.ts:386. The reverb wet return has a fixed 0.5 gain. IN ADDITION to `reverbSend` (user-controlled). Effective reverb wet = `reverbSend × 0.5`. Also intentional, also undocumented.

### 3.11 Duplicated scheduler output — ✅ NONE
Each note is scheduled exactly once. `lastScheduledBeatIndex` guard (line 660) prevents double-scheduling.

### 3.12 ⚠️ DELAY FEEDBACK LOOP UNBOUNDED
psyLive.ts:380 `this.delay.connect(this.delayFb); this.delayFb.connect(this.delay)` — feedback loop. `delayFb.gain` defaults to 0.34 but the slider allows up to 1.0. At 1.0, the delay would feedback infinitely (until the node is destroyed). No safety clamp on feedback. A user dragging FEEDBACK to 100% could create runaway echo. The safetyLimiter would catch peaks, but the delay could still howl.

### 3.13 ⚠️ HAT BUS FORCED TO 0.6 WHEN RADIO ON
psyLive.ts:876 `this.hatBus.gain.setTargetAtTime(0.6, now, 0.08)` — when radio is on, hatBus is forced to 0.6 every 200ms, ignoring both the default (0.55) and the user's mixer setting. This is a hardcoded constant that doesn't depend on any radio measurement. It should probably be occupancy-based like kick/bass/lead.

### 3.14 ⚠️ Variant.leadWave IS DEAD
PRESETS define `leadWave: 'sawtooth'` or `'square'` for each variant (psyLive.ts:76, 77, 90, 91, etc.). But the `lead()` function (line 509) hardcodes `o1.type = 'triangle'; o2.type = 'triangle'`. The `v.leadWave` field is never read. All 4 presets × 2 variants produce the same triangle lead timbre. The only timbre variation comes from `leadCut` and `leadQ`.

---

## 4. SIGNAL LEVEL ANALYSIS

### 4.1 Kick path gain
kick osc (peak 1.0) → kickBus (0.95) → engineBus (0.8) → comp (up to 2:1 reduction) → master (0.9) → safetyLimiter (up to 20:1) → destination
**Max kick level at destination:** ~1.0 × 0.95 × 0.8 × 0.9 = 0.684 (before comp/limiter)
**After comp (-18dB threshold):** kick peaks above -18dB get 2:1 compressed. 0.684 ≈ -3.3dB. Compressed to ~-10.8dB. Then master × 0.9. Then safetyLimiter catches anything above -1dB.
**Result:** Kick is loud, punchy, protected. ✅

### 4.2 Bass path gain
bass osc (peak 0.85) → bassBus (0.85) → engineBus (0.8) → comp → master (0.9) → safetyLimiter
**Max bass level:** 0.85 × 0.85 × 0.8 × 0.9 = 0.520 ≈ -5.7dB
**Result:** Bass sits below kick. ✅

### 4.3 Lead path gain
lead osc (peak 0.27 accent / 0.189 non-accent) → leadBus (0.5) → engineBus (0.8) → comp → master (0.9) → safetyLimiter
**Max lead level (accent):** 0.27 × 0.5 × 0.8 × 0.9 = 0.097 ≈ -20.3dB
**Max lead level (non-accent):** 0.189 × 0.5 × 0.8 × 0.9 = 0.068 ≈ -23.3dB
**Result:** Lead is quiet (by design — F10 lowered it 40%). Sits well below kick and bass. ✅

### 4.4 Hat path gain
hat (peak = v.hatLvl × note.velocity, e.g., 0.12 × 0.5 = 0.06) → hatBus (0.55) → engineBus (0.8) → comp → master (0.9)
**Max hat level:** 0.06 × 0.55 × 0.8 × 0.9 = 0.024 ≈ -32.4dB
**Result:** Hats are very quiet, ambient texture. ✅

### 4.5 Radio path gain
radio stream → radioSource → radioGain (0.5, user-controlled) → radioAnalyser → engineBus (0.8) → comp → master (0.9) → safetyLimiter
**Radio level at destination:** stream_peak × 0.5 × 0.8 × 0.9 = stream_peak × 0.36
**Result:** Radio is mixed at 36% of stream level. Goes through comp + limiter (F10 fix). ✅

---

## 5. REVERB IR GENERATION (mkIR)

psyLive.ts:995-1010 `mkIR(ctx)`:
- Length: 1.8 seconds × sampleRate
- 2 channels (stereo)
- Each sample: `exp(-decay * t) * (random * 2 - 1)` where decay = 3.5
- This is a standard exponentially-decaying white-noise IR
- Quality: basic but functional. Not a real reverb IR (no early reflections, no room modeling)
- 1.8s is a medium-large hall length

**Assessment:** Functional but primitive. A real psytrance reverb would want pre-delay, early reflections, and high-frequency damping. The current IR is a flat exponential decay of white noise — sounds like a wash, not a space.

---

## 6. VERDICT

The audio graph is **structurally sound**. No bypass, no duplicates, no orphans, no multiple contexts. The F10 fixes (radio routing through comp, safety limiter) are real and correctly implemented.

The graph's problems are:
1. **Mixer clobbering** — detect() seizes bus gains every 200ms when radio is on (by design, but breaks user intent)
2. **Hat bus hardcoded** — forced to 0.6, ignores both user and occupancy
3. **Dead Variant field** — leadWave ignored, all presets sound the same
4. **Unbounded feedback** — delayFb slider allows 100% feedback (howl risk)
5. **Primitive reverb** — white-noise IR, no spatial modeling
6. **engineLevel mislabeled** — measures engine+radio combined

These are **fixable in place**. The graph does NOT need to be rebuilt. It needs to be **de-clobbered** (mixer values respected, or ducking moved to a sidechain) and **enriched** (better reverb IR, real lead timbre variation).
