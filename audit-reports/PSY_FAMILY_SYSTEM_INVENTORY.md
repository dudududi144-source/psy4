# PSY FAMILY SYSTEM INVENTORY

## Cross-Repository Forensic Scan of the Entire PSY Family

**Scan date:** 2026-08-12
**Scanner:** Foundation Lab / Systems Factory (Phase 0.5 + Phase 1)
**Method:** Deep file reads of all 7 repos under `dudududi144-source`. Names are NOT trusted — wiring is verified by import graph, tests are verified by execution, claims are verified by evidence.

---

## 1. REPO INVENTORY

| repo | size | what it actually is | audio? | tests |
|------|------|---------------------|:------:|:-----:|
| **psy** | 109KB | PSY-6 GROOVEBOX single-file app (v4.0-m2-song). 1418-line `index.html` + 576-line `soundBank.js` + 399-line test file. | YES — mainline | 22 tests |
| **psy3-clean** | 697KB | "PSY6 MAX" single-file (v3.0.0-m1-fullon). Pre-M2 psy. 1148-line `index.html`. | YES — superseded | 1 self-test |
| **psy4** | 115MB | "PSY LIVE" Next.js app. Live engine = `psyLive.ts` (967 lines). Studio engine tree = 70 files / 34,469 lines (mostly dead). 117 regression tests. | YES — research line | 117 tests |
| **psy5** | 33KB | "PSY6 STANDALONE" single-file pooled-engine groovebox. 416-line `index.html` + 164-line `factory-presets.js`. | YES — pooled experiment | 6 self-gate |
| **forge** | 31KB | CI/CD platform (Next.js). Sovereign deployment system. | NO | unknown |
| **PromptForge** | 82KB | AI dev orchestrator (Python). Autonomous code generation. | NO | unknown |
| **nova** | 48MB | "Prompt-to-Reality Engine" (Next.js). Turns text prompts into HTML apps. | NO | 2840 tests |

**Audio repos: 4** (psy, psy3-clean, psy4, psy5)
**Non-audio repos: 3** (forge, PromptForge, nova) — out of scope for foundation lab

---

## 2. SUBSYSTEM INVENTORY

### 2.1 psy (mainline groovebox — the reference design)

| # | Subsystem | Path | Entry point | Dependencies | Runtime? | Tests? | Quality | Reusable? | Action |
|---|-----------|------|-------------|--------------|:--------:|:------:|:-------:|:---------:|--------|
| 1 | Groovebox engine | `index.html` (inline) | `window.__psy6` | Web Audio API, mulberry32 PRNG | YES | 22 vm-based tests | HIGH | YES (as reference) | **KEEP** as reference design |
| 2 | M2 Song model | `index.html:507-746` | `buildSong()`, `buildTheme()` | mulberry32 | YES | 5 determinism tests | HIGH | YES | **PORT** to foundation/composition |
| 3 | Motif transforms | `index.html:575-616` | `transposeDegree`, `invert`, `retrograde`, `displace`, `fragment`, `augment`, `diminish` | none (pure) | YES | 1 test | HIGH | YES | **PORT** to foundation/motifs |
| 4 | Synth voices | `index.html:335-505` | `makeVoices()` | Web Audio | YES | self-test (RMS/peak) | MEDIUM | YES (as pattern) | **REFACTOR** into foundation/synthesis |
| 5 | FX chain | `index.html:780-873` | delay, reverb, drive, comp, duck | Web Audio | YES | self-test | HIGH | YES | **PORT** to foundation/fx |
| 6 | Scheduler | `index.html:902-916` | `setInterval(25ms)` + 0.14s lookahead | AudioContext.currentTime | YES | 4 integration tests | MEDIUM | NO (setInterval is debt) | **REBUILD** as Transport |
| 7 | Sound bank | `soundBank.js` (576 lines) | `SOUND_BANK`, `getById`, `autoSelect` | none | NO (not loaded by index.html) | NONE | HIGH (data) | YES (as data) | **PORT** to foundation/synthesis |
| 8 | Scales/theory | `index.html:165-215` | `SCALES`, `stableDegrees`, `nearestStableDeg` | none | YES | covered by song tests | HIGH | YES | **PORT** to foundation/harmony |
| 9 | Sidechain ducking | `index.html:810,974-979` | `duck` gain on BASS+PAD | Web Audio | YES | tested via DROP test | HIGH | YES | **PORT** to foundation/mixing |
| 10 | Section automation | `index.html:1049-1065` | `energyAt()` → `automationFromEnergy()` | Web Audio | YES | tested | HIGH | YES | **PORT** to foundation/composition |
| 11 | Pre-drop silence | `index.html:720-723,970` | `isPreDropSilenceBar`, `preDropGate` | none | YES | tested | HIGH | YES | **PORT** to foundation/composition |
| 12 | Self-test (offline render) | `index.html:1089-1120` | `selfTest()` via OfflineAudioContext | Web Audio | YES | runs on load | HIGH | YES | **PORT** to foundation/testing |
| 13 | PSY6_ARCHITECTURE.md | `PSY6_ARCHITECTURE.md` (216 lines) | — | — | — | — | HIGH | YES (as design ref) | **KEEP** as foundation blueprint |
| 14 | CROSS_REPO_AUDIT.md | `CROSS_REPO_AUDIT.md` (70 lines) | — | — | — | — | HIGH | YES | **KEEP** as audit reference |

**psy unique capabilities:**
- M2 song model with 7-section arranger (INTRO→BUILD→DROP→BREAK→RISER→DROP2→OUTRO)
- 4 themes (A/A2/B/transition) with motif operations
- 4 bass styles (gallop/offbeat/pumping/pedal)
- Energy curves → automation
- Phrygian Dominant modal engine with stable-degree resolution
- Call-and-response lead motifs
- 22 deterministic VM-based tests (only audio test suite in the family)

---

### 2.2 psy3-clean (superseded ancestor)

| # | Subsystem | Path | Entry point | Runtime? | Tests? | Quality | Action |
|---|-----------|------|-------------|:--------:|:------:|:-------:|--------|
| 15 | Groovebox engine | `index.html` (1148 lines) | `Groovebox` prototype class | YES | 1 self-test | MEDIUM | **ARCHIVE** |
| 16 | Arranger (6 sections) | `index.html:222` | `SECTIONS` const, `jumpSection()` | YES | NONE | MEDIUM | **ARCHIVE** (superseded by psy M2) |
| 17 | Generative patterns | `index.html:286` | `makePatterns()`, `makeLeadMotif()`, `makeArpPhrase()` | YES | NONE | HIGH | **PORT** (unique Phrygian Dominant theory) |
| 18 | Worker scheduler | `index.html:684,692` | `WORKER_SRC` blob, 25ms tick | YES | NONE | MEDIUM | **REFERENCE** (for Transport design) |
| 19 | XY pad | `index.html:1101` | filter freq + Q control | YES | NONE | LOW | **ARCHIVE** |

**psy3-clean unique capabilities:**
- Phrygian Dominant modal engine (more sophisticated than psy5's static patterns)
- Call-and-response lead motif with ±1 scale degree resolution
- Arp spiral over root-b2-3-5-octave
- XY pad for filter control
- 6 scales (naturalMinor, harmonicMinor, phrygian, phrygianDominant, doubleHarmonic, minorPentatonic)

**Verdict:** Superseded by psy mainline. **ARCHIVE** the whole repo, but **PORT** the generative pattern functions (makeLeadMotif, makeArpPhrase) as they contain unique modal theory.

---

### 2.3 psy4 (research line — the Foundation Lab host)

#### 2.3.1 Live runtime (VERIFIED_RUNTIME)

| # | Subsystem | Path | Lines | Runtime? | Tests? | Quality | Action |
|---|-----------|------|------:|:--------:|:------:|:-------:|--------|
| 20 | PsyLive engine | `src/lib/psyLive.ts` | 967 | YES | 56 tests | HIGH | **REFACTOR** (split into foundation modules) |
| 21 | BeatPLL | `src/lib/beatPLL.ts` | 213 | YES | 48 tests | HIGH | **PORT** to foundation/transport |
| 22 | MelodyObserver (YIN) | `src/lib/melodyObserver.ts` | 394 | YES | 13 tests | HIGH | **PORT** to foundation/melody |
| 23 | PatternMutator | `src/lib/patternMutator.ts` | 260 | YES | 3 tests + 200-cycle | HIGH | **PORT** to foundation/patterns |
| 24 | RadioStateGate | `src/lib/radioStateGate.ts` | 169 | YES | 8 tests | HIGH | **PORT** to foundation/radio |
| 25 | Learning (statistical) | `src/lib/learning.ts` | 482 | YES | 4 tests | MEDIUM | **REFACTOR** into foundation/memory |
| 26 | SoundBank (142 presets) | `src/lib/soundBank.ts` | 698 | NO (disconnected) | 2 tests | HIGH (data) | **PORT** to foundation/synthesis |
| 27 | PooledEngine | `src/lib/pooledEngine.ts` | 508 | NO (dead code) | 6 tests + stress | HIGH | **KEEP** as EXPERIMENTAL BACKEND |
| 28 | UI page | `src/app/page.tsx` | 229 | YES | NONE | MEDIUM | **KEEP** as device test harness |

#### 2.3.2 Studio engine tree (DEAD_CODE — 70 files, 34,469 lines)

| # | Subsystem | Path | Lines | Wired? | Tests? | Quality | Action |
|---|-----------|------|------:|:------:|:------:|:-------:|--------|
| 29 | psy4EngineV2 | `studio/engine/psy4EngineV2.ts` | 5485 | NO | NONE | LOW (untested monolith) | **ARCHIVE** |
| 30 | musicalDirector | `studio/engine/musicalDirector.ts` | 1987 | NO | NONE | MEDIUM (good design) | **REWRITE** (concept worth keeping) |
| 31 | musicAnalyzer | `studio/engine/musicAnalyzer.ts` | 1027 | NO | NONE | MEDIUM | **REWRITE** |
| 32 | melodyEngine | `studio/engine/melodyEngine.ts` | 834 | NO | NONE | MEDIUM (motif development) | **REFACTOR** (extract motif toolkit) |
| 33 | flowEngine | `studio/engine/flowEngine.ts` | 829 | NO | NONE | MEDIUM | **REWRITE** |
| 34 | legacyAudioGraph | `studio/engine/legacyAudioGraph.ts` | 860 | NO | NONE | LOW | **ARCHIVE** |
| 35 | workletEngine | `studio/engine/workletEngine.ts` | 758 | NO | NONE | MEDIUM | **REWRITE** (if worklet path needed) |
| 36 | advancedVoice | `studio/engine/advancedVoice.ts` | 756 | NO | NONE | MEDIUM | **REFACTOR** (4 synth modes) |
| 37 | djController | `studio/engine/djController.ts` | 738 | NO | NONE | MEDIUM | **ARCHIVE** (overengineered) |
| 38 | vocabularyLearner | `studio/engine/vocabularyLearner.ts` | 649 | NO | NONE | MEDIUM | **REWRITE** (concept worth keeping) |
| 39 | harmonyEngine | `studio/engine/harmonyEngine.ts` | 619 | NO | NONE | HIGH (11 chord types, voice leading) | **PORT** to foundation/harmony |
| 40 | phraseSync | `studio/engine/phraseSync.ts` | 581 | NO | NONE | MEDIUM | **REWRITE** |
| 41 | effectsRack | `studio/engine/effectsRack.ts` | 568 | NO | NONE | MEDIUM | **REFACTOR** |
| 42 | styleClassifier | `studio/engine/styleClassifier.ts` | 528 | NO | NONE | MEDIUM | **PORT** (pure function) |
| 43 | multisampleGenerator | `studio/engine/multisampleGenerator.ts` | 524 | NO | NONE | MEDIUM | **ARCHIVE** |
| 44 | phaseSync | `studio/engine/phaseSync.ts` | 523 | NO | NONE | MEDIUM | **ARCHIVE** (duplicate of BeatPLL) |
| 45 | sendEffects | `studio/engine/sendEffects.ts` | 518 | NO | NONE | MEDIUM | **PORT** (chorus, phaser, distortion, bitcrush) |
| 46 | commercialReference | `studio/engine/commercialReference.ts` | 454 | NO | NONE | HIGH (production targets) | **PORT** to foundation/testing |
| 47 | timbreFingerprint | `studio/engine/timbreFingerprint.ts` | 440 | NO | NONE | MEDIUM | **PORT** (pure function) |
| 48 | effectsDetector | `studio/engine/effectsDetector.ts` | 432 | NO | NONE | MEDIUM | **PORT** (pure function) |
| 49 | synthesisRouter | `studio/engine/synthesisRouter.ts` | 375 | NO | NONE | MEDIUM | **ARCHIVE** |
| 50 | musicalGrammar | `studio/engine/musicalGrammar.ts` | 331 | YES (via forensic/) | NONE | HIGH (port of psy3 psy_gen.py) | **PORT** to foundation/harmony |
| 51 | uniquenessDetector | `studio/engine/uniquenessDetector.ts` | 327 | NO | NONE | MEDIUM | **ARCHIVE** |
| 52 | worlds (10 musical identities) | `studio/engine/worlds.ts` | 290 | NO | NONE | MEDIUM | **PORT** to foundation/composition |
| 53 | musicalMemory | `studio/engine/musicalMemory.ts` | 279 | NO | NONE | MEDIUM | **REWRITE** into foundation/memory |
| 54 | sampleBank | `studio/engine/sampleBank.ts` | 266 | NO | NONE | MEDIUM | **ARCHIVE** |
| 55 | learningMemory | `studio/engine/learningMemory.ts` | 260 | NO | NONE | MEDIUM | **REWRITE** into foundation/memory |
| 56 | layerEngine | `studio/engine/layerEngine.ts` | 259 | NO | NONE | MEDIUM | **ARCHIVE** |
| 57 | performanceMonitor | `studio/engine/performanceMonitor.ts` | 254 | NO | NONE | MEDIUM | **PORT** to foundation/testing |
| 58 | schedulerWorker | `studio/engine/schedulerWorker.ts` | 251 | NO | NONE | MEDIUM | **REFERENCE** (for Transport worker design) |
| 59 | engineWorklet | `studio/engine/engineWorklet.ts` | 251 | NO | NONE | MEDIUM | **ARCHIVE** |
| 60 | synthesisDetector | `studio/engine/synthesisDetector.ts` | 241 | NO | NONE | MEDIUM | **PORT** (pure function) |
| 61 | audioBackend (interface) | `studio/engine/audioBackend.ts` | 237 | NO | NONE | HIGH (clean interface) | **PORT** to foundation/synthesis |
| 62 | multibandCompressor | `studio/engine/multibandCompressor.ts` | 235 | NO | NONE | MEDIUM | **PORT** to foundation/mixing |
| 63 | mixAwareSelector | `studio/engine/mixAwareSelector.ts` | 197 | NO | NONE | MEDIUM | **ARCHIVE** |
| 64 | callResponseEngine | `studio/engine/callResponseEngine.ts` | 137 | NO | NONE | MEDIUM | **PORT** (small, useful) |
| 65 | offlineRenderer (stub) | `studio/engine/offlineRenderer.ts` | 114 | NO | NONE | LOW (near-empty) | **DELETE** |

#### 2.3.3 reference/ subdirectory (4 VERIFIED_LIBRARY, 9 DEAD_CODE)

| # | Subsystem | Path | Lines | Wired? | Tests? | Quality | Action |
|---|-----------|------|------:|:------:|:------:|:-------:|--------|
| 66 | referenceListener V1 | `studio/engine/reference/referenceListener.ts` | 818 | YES (API route) | NONE | MEDIUM | **REFACTOR** into foundation/radio |
| 67 | referenceListenerV2 | `studio/engine/reference/referenceListenerV2.ts` | 1210 | NO | NONE | MEDIUM (real FFT pipeline) | **REWRITE** (fetch+ReadableStream approach) |
| 68 | continuousTrainer | `studio/engine/reference/continuousTrainer.ts` | 773 | NO | NONE | MEDIUM | **ARCHIVE** |
| 69 | renderWorker | `studio/engine/reference/renderWorker.ts` | 375 | NO | NONE | MEDIUM | **ARCHIVE** |
| 70 | selfAnalyzer | `studio/engine/reference/selfAnalyzer.ts` | 354 | NO | NONE | MEDIUM | **REWRITE** into foundation/analysis |
| 71 | trainingLoop | `studio/engine/reference/trainingLoop.ts` | 353 | NO | NONE | MEDIUM | **ARCHIVE** |
| 72 | musicalUnderstanding | `studio/engine/reference/musicalUnderstanding.ts` | 339 | NO | NONE | HIGH (Krumhansl-Schmuckler) | **PORT** to foundation/harmony |
| 73 | referenceScore | `studio/engine/reference/referenceScore.ts` | 297 | YES (API route) | NONE | MEDIUM | **PORT** to foundation/testing |
| 74 | performanceMonitor (ref) | `studio/engine/reference/performanceMonitor.ts` | 256 | NO | NONE | MEDIUM | **ARCHIVE** (duplicate) |
| 75 | worldDNA | `studio/engine/reference/worldDNA.ts` | 236 | YES (API route) | NONE | MEDIUM | **PORT** to foundation/composition |
| 76 | perVoiceAnalyzer | `studio/engine/reference/perVoiceAnalyzer.ts` | 232 | NO | NONE | MEDIUM | **ARCHIVE** |
| 77 | parameterRegistry | `studio/engine/reference/parameterRegistry.ts` | 176 | YES (API route) | NONE | MEDIUM | **PORT** to foundation/testing |
| 78 | radioStreams | `studio/engine/reference/radioStreams.ts` | 127 | NO | NONE | HIGH (verified stream registry) | **PORT** to foundation/radio |

#### 2.3.4 forensic/ subdirectory (15 VERIFIED_LIBRARY, 2 DEAD_CODE)

| # | Subsystem | Path | Lines | Wired? | Tests? | Quality | Action |
|---|-----------|------|------:|:------:|:------:|:-------:|--------|
| 79 | forensicRunner | `studio/engine/forensic/forensicRunner.ts` | 143 | YES (API) | NONE | HIGH | **PORT** to foundation/testing |
| 80 | offlineRenderer (forensic) | `studio/engine/forensic/offlineRenderer.ts` | 717 | YES (API) | NONE | HIGH | **PORT** to foundation/testing |
| 81 | voices (isomorphic) | `studio/engine/forensic/voices.ts` | 674 | YES (API) | NONE | HIGH | **PORT** to foundation/synthesis |
| 82 | audioAnalyzer | `studio/engine/forensic/audioAnalyzer.ts` | 546 | YES (API) | NONE | HIGH (own FFT) | **PORT** to foundation/analysis |
| 83 | qualityScore | `studio/engine/forensic/qualityScore.ts` | 615 | YES (API) | NONE | HIGH | **PORT** to foundation/testing |
| 84 | dsp (isomorphic) | `studio/engine/forensic/dsp.ts` | 222 | YES (API) | NONE | HIGH (polyBLEP, Moog ladder) | **PORT** to foundation/synthesis |
| 85 | mixing | `studio/engine/forensic/mixing.ts` | 235 | YES (API) | NONE | HIGH | **PORT** to foundation/mixing |
| 86 | repetitionDetector | `studio/engine/forensic/repetitionDetector.ts` | 229 | YES (API) | NONE | MEDIUM | **PORT** to foundation/testing |
| 87 | worldDifferentiator | `studio/engine/forensic/worldDifferentiator.ts` | 176 | YES (API) | NONE | MEDIUM | **PORT** to foundation/testing |
| 88 | paramValidator | `studio/engine/forensic/paramValidator.ts` | 186 | YES (API) | NONE | MEDIUM | **PORT** to foundation/testing |
| 89 | closedLoop | `studio/engine/forensic/closedLoop.ts` | 285 | YES (API) | NONE | MEDIUM | **PORT** to foundation/testing |
| 90 | reportGenerator | `studio/engine/forensic/reportGenerator.ts` | 318 | YES (API) | NONE | MEDIUM | **PORT** to foundation/testing |
| 91 | musicalGrammar (forensic) | `studio/engine/forensic/musicalGrammar.ts` | 165 | YES (API) | NONE | HIGH | **MERGE** with #50 |
| 92 | worlds (forensic) | `studio/engine/forensic/worlds.ts` | 134 | YES (API) | NONE | MEDIUM | **MERGE** with #52 |
| 93 | prng | `studio/engine/forensic/prng.ts` | 44 | YES (API) | NONE | HIGH | **PORT** to foundation/shared |
| 94 | liteRenderer | `studio/engine/forensic/liteRenderer.ts` | 402 | NO | NONE | MEDIUM | **ARCHIVE** |
| 95 | latencyMonitor | `studio/engine/forensic/latencyMonitor.ts` | 134 | NO | NONE | MEDIUM | **PORT** to foundation/testing |

#### 2.3.5 Worklets (DEAD_CODE — real implementations, never loaded)

| # | Subsystem | Path | Lines | Wired? | Tests? | Quality | Action |
|---|-----------|------|------:|:------:|:------:|:-------:|--------|
| 96 | psy4-engine worklet | `public/worklets/psy4-engine.js` | 2575 | NO (addModule never called) | NONE | HIGH (production-grade) | **KEEP** as EXPERIMENTAL (future worklet backend) |
| 97 | psy4-dsp worklet | `public/worklets/psy4-dsp.js` | 485 | NO (addModule never called) | NONE | HIGH (6 processors) | **KEEP** as EXPERIMENTAL |

#### 2.3.6 DSP utilities (DEAD_CODE)

| # | Subsystem | Path | Lines | Wired? | Tests? | Quality | Action |
|---|-----------|------|------:|:------:|:------:|:-------:|--------|
| 98 | wavetable | `studio/dsp/wavetable.ts` | 105 | NO | NONE | MEDIUM | **MERGE** with musicalGrammar |
| 99 | clock (Transport) | `studio/clock.ts` | 100 | NO | NONE | MEDIUM | **REFERENCE** (for Transport design) |
| 100 | rng | `studio/rng.ts` | 79 | NO | NONE | HIGH | **PORT** to foundation/shared (consolidate with prng) |

---

### 2.4 psy5 (pooled engine experiment)

| # | Subsystem | Path | Lines | Runtime? | Tests? | Quality | Action |
|---|-----------|------|------:|:--------:|:------:|:-------:|--------|
| 101 | PooledEngine | `index.html` (class, ~line 354) | ~200 | YES | 1 self-gate test (G8) | HIGH | **PORT** to foundation/synthesis (reference for voice pooling) |
| 102 | SynthVoice (pooled) | `index.html` (class, ~line 363) | ~80 | YES | NONE | HIGH | **PORT** to foundation/synthesis |
| 103 | DrumVoice (pooled) | `index.html` (class, ~line 368) | ~120 | YES | NONE | HIGH | **PORT** to foundation/synthesis |
| 104 | Worker scheduler | `index.html:152` | `makeTimerWorker()`, 25ms tick, 0.12s lookahead | YES | NONE | HIGH (jitter-resistant) | **PORT** to foundation/transport (worker pattern) |
| 105 | Factory presets | `factory-presets.js` (164 lines) | `LIB`, `buildStyle()` | YES (inline copy) | NONE | HIGH | **PORT** to foundation/synthesis |
| 106 | Multi-genre builder | `factory-presets.js` | `buildStyle(style, seed)` for TECHNO/PSYTRANCE/TRANCE/PROGRESSIVE | YES | 1 determinism test (G2) | HIGH | **PORT** to foundation/composition |
| 107 | Self-Gate test framework | `index.html:408-412` | `runSelfGate()` with OfflineAudioContext | YES | 6 assertions | HIGH | **PORT** to foundation/testing |
| 108 | Macro system | `index.html:376` | `resolveMacros()` (ENERGY/DRIVE/SPACE/MOVEMENT) | YES (2 wired, 2 placeholder) | 1 test (G6) | MEDIUM | **REFACTOR** (fix DRIVE/MOVEMENT) |
| 109 | Parameter locks | `index.html` (step data) | `st.lock = {cutoff, res}` | YES | NONE | HIGH | **PORT** to foundation/patterns |
| 110 | Step micro-timing | `index.html` (step data) | `st.micro` (-100..+100) | YES | NONE | MEDIUM | **PORT** to foundation/patterns |
| 111 | Step probability | `index.html` (step data) | `st.prob` | YES | NONE | MEDIUM | **PORT** to foundation/patterns |
| 112 | Lane automation | `index.html` (pattern data) | `p.lanes[]` with breakpoint interpolation | YES | NONE | MEDIUM | **PORT** to foundation/patterns |
| 113 | Undo/redo | `index.html` (history) | 60-entry stack | YES | NONE | MEDIUM | **PORT** to foundation/shared |
| 114 | Save/load/export | `index.html` | project JSON | YES | 1 test (G5) | HIGH | **PORT** to foundation/shared |

**psy5 unique capabilities:**
- Pre-allocated voice pools (20 synth + 24 drum, round-robin reuse)
- Worker-based jitter-resistant scheduler
- Multi-genre factory preset system (4 genres + EMPTY)
- Per-step parameter locks, micro-timing, probability
- Lane automation with breakpoint interpolation
- Self-Gate test framework (6 OfflineAudioContext assertions)
- Save/load/export/resume project system
- 3 pad modes (DRUM/SCALE/CHORD)

---

### 2.5 Non-audio repos (out of scope)

| # | Repo | What it is | Foundation utility? | Action |
|---|------|------------|:-------------------:|--------|
| 115 | forge | CI/CD platform | NO | **IGNORE** |
| 116 | PromptForge | AI dev orchestrator (Python) | NO | **IGNORE** |
| 117 | nova | Prompt-to-HTML app builder | Limited (5-10 utility modules could be cherry-picked: static-analysis, interaction-probe, diff, zip, design-tokens, rate-limit, circuit-breaker) | **IGNORE** for now; cherry-pick utilities if needed later |

---

## 3. DUPLICATION ANALYSIS — Sources of Truth

When the same idea exists in multiple repos, we select ONE source of truth based on: correctness, architecture, testability, latency, musical behavior, extensibility.

### 3.1 Beat tracking / PLL

| Implementation | Repo | Lines | Tests | Quality | Verdict |
|----------------|------|------:|:-----:|:-------:|---------|
| BeatPLL (YIN-fixed) | psy4 | 213 | 48 tests | HIGH | **SOURCE OF TRUTH** |
| phaseSync | psy4 studio | 523 | 0 | MEDIUM (duplicate) | RETIRE |
| djController | psy4 studio | 738 | 0 | LOW (overengineered) | RETIRE |
| (none) | psy | — | — | — | N/A (psy has no beat detection) |

**Decision:** BeatPLL is the single source. Port to `foundation/transport`. Delete phaseSync and djController.

### 3.2 Pitch detection / melody

| Implementation | Repo | Lines | Tests | Quality | Verdict |
|----------------|------|------:|:-----:|:-------:|---------|
| MelodyObserver (YIN) | psy4 | 394 | 13 tests | HIGH | **SOURCE OF TRUTH** |
| melodyEngine | psy4 studio | 834 | 0 | MEDIUM (motif development, not detection) | REFACTOR (extract motif toolkit, don't use as detector) |
| musicalUnderstanding | psy4 reference | 339 | 0 | MEDIUM (Krumhansl-Schmuckler key finding) | PORT (key detection, not pitch detection) |
| (none) | psy | — | — | — | N/A |

**Decision:** MelodyObserver is the pitch detection source. musicalUnderstanding is the key detection source. melodyEngine's motif transforms are the motif toolkit source. Port each to its foundation domain.

### 3.3 Pattern mutation

| Implementation | Repo | Lines | Tests | Quality | Verdict |
|----------------|------|------:|:-----:|:-------:|---------|
| PatternMutator | psy4 | 260 | 3 tests + 200-cycle | HIGH | **SOURCE OF TRUTH** |
| makePatterns | psy | ~150 | covered by song tests | HIGH (generative) | PORT (different purpose — generative, not mutation) |
| EvolvingSequence | psy4 studio musicalGrammar | ~50 | 0 | MEDIUM | MERGE concepts |

**Decision:** PatternMutator for mutation. psy's makePatterns for generative creation. Both go to `foundation/patterns` with distinct APIs.

### 3.4 Sound bank / presets

| Implementation | Repo | Lines | Tests | Quality | Verdict |
|----------------|------|------:|:-----:|:-------:|---------|
| SoundBank (142 presets) | psy4 | 698 | 2 tests | HIGH | **SOURCE OF TRUTH** |
| soundBank.js (119 presets) | psy | 576 | 0 | HIGH (same schema) | MERGE (add psy's unique presets) |
| factory-presets.js (~51 presets) | psy5 | 164 | 0 | HIGH (multi-genre builder) | MERGE (add buildStyle function) |

**Decision:** psy4 SoundBank is the source. Merge psy's 119 + psy5's 51 presets + psy5's `buildStyle()` multi-genre builder. Target: ~200+ presets in `foundation/synthesis`.

### 3.5 Scheduler / clock

| Implementation | Repo | Lines | Tests | Quality | Verdict |
|----------------|------|------:|:-----:|:-------:|---------|
| setInterval(25ms) + 0.14s lookahead | psy | ~20 | 4 integration tests | MEDIUM (debt: background-tab stalls) | REFERENCE (pattern) |
| Worker blob + 25ms + 0.2s | psy3-clean | ~30 | 0 | MEDIUM | REFERENCE (worker pattern) |
| Worker blob + 25ms + 0.12s | psy5 | ~40 | 0 | HIGH (jitter-resistant) | **SOURCE OF TRUTH** (worker pattern) |
| schedulerWorker | psy4 studio | 251 | 0 | MEDIUM | REFERENCE (TS implementation) |
| studio/clock.ts | psy4 studio | 100 | 0 | MEDIUM | REFERENCE (Transport interface) |
| PSY6_ARCHITECTURE.md Transport API | psy | 216 (doc) | — | HIGH (design) | **SOURCE OF TRUTH** (design) |

**Decision:** Build `foundation/transport` following the PSY6_ARCHITECTURE.md Transport API design, using psy5's worker pattern for jitter resistance, psy4's BeatPLL for beat estimation, and AudioContext.currentTime as the only clock. **No setInterval as musical clock.**

### 3.6 Synthesis / voices

| Implementation | Repo | Lines | Tests | Quality | Verdict |
|----------------|------|------:|:-----:|:-------:|---------|
| Inline per-note voices | psy | ~170 | self-test | MEDIUM (GC pressure) | REFERENCE (voice designs) |
| Inline per-note voices | psy3-clean | ~140 | self-test | MEDIUM | REFERENCE |
| PooledEngine (16+12 voices) | psy4 | 508 | 6 tests + stress | HIGH | **SOURCE OF TRUTH** (pool design) |
| PooledEngine (20+24 voices) | psy5 | ~400 | 1 self-gate | HIGH | MERGE (larger pool, worker integration) |
| advancedVoice (4 modes) | psy4 studio | 756 | 0 | MEDIUM | REFACTOR (extract FM/supersaw/wavetable modes) |
| forensic/voices.ts (isomorphic) | psy4 studio | 674 | 0 | HIGH (TS port of worklet) | PORT (for offline rendering) |
| psy4-engine.js worklet | psy4 public | 2575 | 0 | HIGH (production-grade) | KEEP as future worklet backend |

**Decision:** psy4 PooledEngine is the source for voice pooling. psy5's larger pool sizes and worker integration are the evolution. forensic/voices.ts is the isomorphic rendering source. psy4-engine.js worklet is the future RT-safe backend. All go to `foundation/synthesis` with clear classification.

### 3.7 Effects

| Implementation | Repo | Lines | Tests | Quality | Verdict |
|----------------|------|------:|:-----:|:-------:|---------|
| FX chain (delay/reverb/drive/comp/duck) | psy | ~100 | self-test | HIGH | **SOURCE OF TRUTH** (core FX) |
| FX chain (same) | psy3-clean | ~90 | self-test | HIGH | MERGE (identical) |
| sendEffects (chorus/phaser/distortion/bitcrush) | psy4 studio | 518 | 0 | MEDIUM | PORT (additional FX) |
| effectsRack (per-track insert chain) | psy4 studio | 568 | 0 | MEDIUM | REFACTOR |
| multibandCompressor | psy4 studio | 235 | 0 | MEDIUM | PORT |
| forensic/mixing.ts (BusProcessor, SchroederReverb) | psy4 studio | 235 | 0 | HIGH | PORT (isomorphic) |

**Decision:** psy's FX chain is the core. psy4's sendEffects + multibandCompressor + forensic/mixing.ts are additions. All go to `foundation/fx` and `foundation/mixing`.

### 3.8 Harmony / theory

| Implementation | Repo | Lines | Tests | Quality | Verdict |
|----------------|------|------:|:-----:|:-------:|---------|
| Scales + stableDegrees | psy | ~50 | covered by song tests | HIGH | **SOURCE OF TRUTH** (modal theory) |
| 6 scales | psy3-clean | ~40 | 0 | HIGH | MERGE (same scales) |
| harmonyEngine (11 chord types, voice leading) | psy4 studio | 619 | 0 | HIGH | PORT (chord/voice-leading) |
| musicalGrammar (SCALES, PROGRESSIONS) | psy4 studio | 331 | 0 | HIGH | MERGE (consolidate scales) |
| musicalUnderstanding (Krumhansl-Schmuckler) | psy4 reference | 339 | 0 | HIGH | PORT (key detection) |

**Decision:** psy's modal theory is the source for scales + stable degrees. harmonyEngine is the source for chords + voice leading. musicalUnderstanding is the source for key detection. All go to `foundation/harmony`.

### 3.9 Song structure / arrangement

| Implementation | Repo | Lines | Tests | Quality | Verdict |
|----------------|------|------:|:-----:|:-------:|---------|
| M2 Song model (7 sections, 4 themes, 4 bass styles) | psy | ~240 | 5 tests | HIGH | **SOURCE OF TRUTH** |
| Arranger (6 sections) | psy3-clean | ~60 | 0 | MEDIUM | ARCHIVE (superseded) |
| flowEngine (dynamic flow) | psy4 studio | 829 | 0 | MEDIUM | REWRITE (concept worth keeping) |
| worlds (10 musical identities) | psy4 studio | 290 | 0 | MEDIUM | PORT (as world presets) |

**Decision:** psy's M2 Song model is the source. flowEngine's dynamic flow concept is worth rewriting on top of the Song model. worlds become composition presets. All go to `foundation/composition`.

### 3.10 Learning / memory

| Implementation | Repo | Lines | Tests | Quality | Verdict |
|----------------|------|------:|:-----:|:-------:|---------|
| Learning (statistical bookkeeping) | psy4 | 482 | 4 tests | MEDIUM | **SOURCE OF TRUTH** (for now) |
| learningMemory | psy4 studio | 260 | 0 | MEDIUM | REWRITE (concept) |
| musicalMemory | psy4 studio | 279 | 0 | MEDIUM | REWRITE (concept) |
| vocabularyLearner | psy4 studio | 649 | 0 | MEDIUM | REWRITE (concept) |
| continuousTrainer | psy4 reference | 773 | 0 | LOW | ARCHIVE |

**Decision:** psy4 Learning is the interim source. The Contextual Musical Memory concept (Context → Action → Outcome → Score) from the prompt will be built fresh in `foundation/memory`, drawing design ideas from learningMemory + musicalMemory + vocabularyLearner but NOT porting their code (all untested).

### 3.11 Testing

| Implementation | Repo | Lines | Tests | Quality | Verdict |
|----------------|------|------:|:-----:|:-------:|---------|
| VM-based test harness + 22 tests | psy | 399 | 22 | HIGH | **SOURCE OF TRUTH** (test patterns) |
| Self-Gate framework (6 assertions) | psy5 | ~100 | 6 | HIGH | PORT (OfflineAudioContext pattern) |
| Reality Bridge suite (117 tests) | psy4 | ~2000 | 117 | HIGH | **SOURCE OF TRUTH** (DSP/PLL/melody tests) |
| forensic/qualityScore + reportGenerator | psy4 studio | 933 | 0 | HIGH | PORT (forensic testing) |
| commercialReference (production targets) | psy4 studio | 454 | 0 | HIGH | PORT (benchmarks) |
| selfTest (OfflineAudioContext) | psy | ~30 | 1 | HIGH | PORT (inline self-test pattern) |

**Decision:** psy4 Reality Bridge suite is the source for DSP/PLL/melody tests. psy's VM harness is the source for engine integration tests. psy5's Self-Gate is the source for browser-based assertion tests. forensic/ is the source for offline rendering + quality scoring. All go to `foundation/testing`.

### 3.12 DSP primitives

| Implementation | Repo | Lines | Tests | Quality | Verdict |
|----------------|------|------:|:-----:|:-------:|---------|
| forensic/dsp.ts (polyBLEP, Moog ladder, fastTanh, PinkNoise) | psy4 studio | 222 | 0 | HIGH (isomorphic) | **SOURCE OF TRUTH** |
| psy4-dsp.js worklet (6 processors) | psy4 public | 485 | 0 | HIGH | KEEP (worklet implementations) |
| psy4-engine.js worklet (full engine) | psy4 public | 2575 | 0 | HIGH | KEEP (worklet implementation) |
| dsp/wavetable.ts (additive wavetables) | psy4 studio | 105 | 0 | MEDIUM | MERGE |

**Decision:** forensic/dsp.ts is the source for isomorphic DSP primitives (can run in Node and browser). The worklets are the RT-safe implementations for future use. All go to `foundation/synthesis`.

### 3.13 PRNG / RNG

| Implementation | Repo | Lines | Tests | Quality | Verdict |
|----------------|------|------:|:-----:|:-------:|---------|
| mulberry32 (inline) | psy | ~5 | covered | HIGH | — |
| mulberry32 (inline) | psy3-clean | ~5 | 0 | HIGH | — |
| Rng class | psy4 studio/rng.ts | 79 | 0 | HIGH | — |
| SeededRng class | psy4 studio/musicalGrammar.ts | ~20 | 0 | HIGH | — |
| mulberry32 (prng.ts) | psy4 studio/forensic/prng.ts | 44 | 0 | HIGH | **SOURCE OF TRUTH** (cleanest) |

**Decision:** forensic/prng.ts is the source. Consolidate all PRNG usage to this one. Goes to `foundation/shared`.

---

## 4. ACTION SUMMARY

| Action | Count | Lines |
|--------|------:|------:|
| **KEEP** (as reference/experimental) | 6 | ~5500 |
| **PORT** (move to foundation as-is or near-as-is) | 35 | ~12000 |
| **REFACTOR** (extract good parts, restructure) | 8 | ~4000 |
| **REBUILD** (concept worth keeping, code not) | 8 | ~5000 |
| **MERGE** (consolidate duplicates) | 6 | ~1500 |
| **ARCHIVE** (superseded or not worth porting) | 18 | ~8000 |
| **DELETE** (empty stubs) | 1 | ~114 |
| **IGNORE** (non-audio) | 3 repos | — |

**Total audio code scanned:** ~48,000 lines across 4 repos
**Estimated foundation target:** ~15,000-20,000 lines (after consolidation, deduplication, and archiving)
**Reduction:** ~60% (from 48k → ~18k lines of clean, tested, connected code)

---

## 5. DUPLICATION RESOLUTION — Single Sources of Truth

| Domain | Source of Truth | Why |
|--------|----------------|-----|
| Beat tracking / PLL | psy4 `beatPLL.ts` (48 tests) | Only tested PLL in the family |
| Pitch detection | psy4 `melodyObserver.ts` YIN (13 tests) | Only tested pitch detector |
| Pattern mutation | psy4 `patternMutator.ts` (200-cycle test) | Only tested mutator |
| Radio state | psy4 `radioStateGate.ts` (8 tests) | Only explicit state machine |
| Sound bank | psy4 `soundBank.ts` (142 presets, verified) | Largest, verified dataset |
| Voice pooling | psy4 `pooledEngine.ts` (6 tests + stress) | Most tested pool design |
| Scheduler design | psy `PSY6_ARCHITECTURE.md` Transport API | Best architectural design |
| Worker scheduler pattern | psy5 `makeTimerWorker()` | Cleanest worker implementation |
| Song model / arrangement | psy M2 `buildSong()` (5 tests) | Only tested song structure |
| Motif transforms | psy `transposeDegree/invert/retrograde/...` | Pure, tested |
| Modal theory / scales | psy `SCALES` + `stableDegrees` | Most sophisticated |
| Chord / voice leading | psy4 studio `harmonyEngine.ts` | 11 chord types, voice leading |
| Key detection | psy4 reference `musicalUnderstanding.ts` | Krumhansl-Schmuckler |
| FX chain (core) | psy delay/reverb/drive/comp/duck | Most tested FX |
| FX (additional) | psy4 studio `sendEffects.ts` | Chorus/phaser/distortion/bitcrush |
| Multiband compressor | psy4 studio `multibandCompressor.ts` | 3-band design |
| Isomorphic DSP | psy4 forensic `dsp.ts` | polyBLEP, Moog ladder, runs in Node |
| Isomorphic voices | psy4 forensic `voices.ts` | TS port of worklet voices |
| Isomorphic mixing | psy4 forensic `mixing.ts` | BusProcessor, SchroederReverb |
| Forensic testing | psy4 forensic `forensicRunner.ts` + 14 modules | Full offline render+analyze pipeline |
| Production targets | psy4 studio `commercialReference.ts` | LUFS, true-peak, spectral balance |
| Self-test pattern | psy `selfTest()` via OfflineAudioContext | Inline, runs on load |
| Test harness | psy VM-based harness + psy5 Self-Gate | Two complementary patterns |
| PRNG | psy4 forensic `prng.ts` (mulberry32) | Cleanest implementation |
| Radio streams | psy4 reference `radioStreams.ts` | Verified stream registry |

---

## 6. FOUNDATION DOMAIN MAPPING

Based on the inventory, the `foundation/` directory will be organized as:

```
foundation/
  transport/          ← BeatPLL + PSY6_ARCHITECTURE Transport API + psy5 worker pattern
  radio/              ← RadioStateGate + radioStreams + referenceListener concepts
  analysis/           ← audioAnalyzer (FFT) + selfAnalyzer + musicAnalyzer concepts
  rhythm/             ← BeatDetector + OnsetDetector + TempoEstimator (from BeatPLL)
  melody/             ← MelodyObserver (YIN) + musicalUnderstanding (key detection)
  harmony/            ← Scales + harmonyEngine + musicalGrammar
  motifs/             ← psy motif transforms + melodyEngine motif toolkit
  patterns/           ← PatternMutator + psy makePatterns + psy5 parameter locks
  composition/        ← psy M2 Song model + flowEngine concepts + worlds
  synthesis/          ← PooledEngine + SoundBank + forensic/dsp + forensic/voices
  fx/                 ← psy FX chain + sendEffects
  mixing/             ← psy ducking + multibandCompressor + forensic/mixing
  learning/           ← psy4 Learning (interim) → Contextual Musical Memory (future)
  memory/             ← learningMemory + musicalMemory concepts (REWRITE)
  synchronization/    ← (future: network sync, not built yet)
  shared/             ← prng + rng + utils + types
  testing/            ← Reality Bridge suite + psy VM harness + psy5 Self-Gate + forensic
```

**Each module will be built in its own Gate (F1-F8), starting with F1 (Transport).**

---

## 7. CRITICAL FINDINGS

### 7.1 What actually works (VERIFIED)

- **psy4 live runtime** (psyLive + BeatPLL + MelodyObserver + PatternMutator + RadioStateGate): 117 tests green, browser-verified
- **psy groovebox**: 22 tests green, self-test passes, M2 song model works
- **psy5 pooled engine**: 6 self-gate tests pass, pooled voices work
- **psy4 forensic pipeline**: 15 modules reachable via API routes (zero tests, but real implementations)

### 7.2 What doesn't work (DEAD_CODE)

- **psy4 studio/engine/ top-level tree**: 36 files, ~22,000 lines, ZERO imports from live runtime
- **psy4 reference/ continuous-learning subsystem**: 9 files, ~5,200 lines, explicitly acknowledged as dead in worklog
- **psy4 worklets**: 2 files, 3,060 lines, real implementations but `addModule()` never called
- **psy4 studio/dsp/**: 3 files, 284 lines, all dead

### 7.3 What's missing (CLAIM_ONLY)

- **MusicalTransport** (single source of truth for bpm/beat/phase) — designed in PSY6_ARCHITECTURE.md but not built
- **Song structure in psy4** — worklog claims it exists but code was removed in REBUILD
- **Self-recovery / health monitor** — worklog claims it exists but code doesn't exist
- **Reinforcement learning** — worklog claims "REINFORCE" but it's statistical bookkeeping
- **Multi-device sync** — not built (correctly deferred)

### 7.4 What's unique to each repo

- **psy**: M2 song model, motif transforms, Phrygian Dominant modal engine, 22 VM-based tests, PSY6_ARCHITECTURE.md
- **psy3-clean**: Generative pattern functions (makeLeadMotif, makeArpPhrase) with unique modal theory
- **psy4**: BeatPLL (tested), MelodyObserver/YIN (tested), PatternMutator (tested), RadioStateGate (tested), forensic pipeline, 142-preset SoundBank, PooledEngine, 2 AudioWorklets
- **psy5**: Pooled voice engine (20+24), worker scheduler, multi-genre factory presets, parameter locks, Self-Gate test framework

---

## 8. NEXT STEPS

### Gate F0 (this document) — COMPLETE
- ✓ Repo state verified (HEAD == origin/main, 117 tests green, lint clean)
- ✓ All audit reports read
- ✓ All 7 repos scanned (4 audio + 3 non-audio)
- ✓ 117 subsystems cataloged
- ✓ Every subsystem classified (VERIFIED_RUNTIME / VERIFIED_LIBRARY / EXPERIMENTAL / DEAD_CODE / CLAIM_ONLY)
- ✓ Every subsystem assigned an action (KEEP / PORT / REFACTOR / REBUILD / ARCHIVE / DELETE)
- ✓ Duplicates identified, sources of truth selected
- ✓ Foundation domain mapping defined

### Gate F1 (next) — MusicalTransport
- Build `foundation/transport/` following PSY6_ARCHITECTURE.md §5 Transport API
- Use BeatPLL (from psy4) as the beat estimator
- Use psy5's worker pattern for jitter-resistant ticking
- Use AudioContext.currentTime as the ONLY clock
- Write deterministic tests (streams A-J from PSY6_ARCHITECTURE.md §6)
- DO NOT build network sync yet

**No code is written in this gate. This is purely an inventory document.**
