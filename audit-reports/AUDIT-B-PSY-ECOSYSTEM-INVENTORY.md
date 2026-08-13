# AUDIT-B — PSY ECOSYSTEM SOUND INVENTORY

**Task ID:** AUDIT-B
**Date:** 2026-08-12
**Scope:** Synths · Samplers · Samples · VSTs · Presets · Wavetables · Kick/Bass generators · Audio renderers · DSP experiments · Reference recordings — across ALL PSY projects on this machine.
**Method:** Read-only investigation. No code modified.

---

## EXECUTIVE SUMMARY

The PSY family on this machine is **6 unique projects** (plus 3 duplicate clones). Across all of them:

- **185 audio files exist** — ALL of them inside `/home/z/my-project` (PSY4). Other PSY projects ship ZERO samples (all synth-only by design).
- **Zero VST/CLAP/LV2/AU plugin files** anywhere. No `.fxp/.fxb/.scl/.kbm/.wt` preset files. All "presets" are TypeScript/JS data structures.
- **5 distinct synth engines** total: PSY4 psyLive (subtractive only) · PSY4 AdvancedSynthVoice (subtractive + FM + supersaw + wavetable — UNUSED by live) · nexus-psy7 voices.ts (subtractive + FM + unison + multi-target LFO — UNUSED on this machine, lives in /tmp) · PSY5/PSY mainline pooled subtractive · PSY3-clean subtractive + riser/impact FX.
- **PSY4 has the most advanced UNUSED DSP** in the family: 5,485-line `psy4EngineV2.ts` + 756-line `advancedVoice.ts` with FM/supersaw/wavetable modes — sitting in `src/lib/studio/` while the live `psyLive.ts` (1,341 lines) uses naive `createOscillator` + 4 hardcoded presets.
- **Reference recordings:** 4 small WAVs (6–7s, mono 44.1kHz) in `/home/z/my-project/audio-artifacts/` — `REF-A-145kb.wav`, `REF-B-138kb.wav` are radio-stream captures; `GEN-A/B-from-ref*.wav` are PSY4's attempts to match them.
- **PSY4 sample bank** is solid and well-curated: 141 real drum-machine one-shots (909, Nord, MD packs) + 6 PSY3 procedural samples (kick/bass/lead/clap/hat-c/hat-o). Categorized. Documented in `SAMPLE_MANIFEST.json` + `SOUND_LIBRARY.md`.
- **Critical bug found:** PSY4's `phase5/baseline/` has 7 "world" renders (goa-111/222/333, progressive-psy-111/222/333, dark-psy-111) with IDENTICAL spectral analyses (peak=0.94, rms=0.16, centroid=578Hz, low=0.62, stereoW=0.0003). The "worlds" parameter has ZERO audible effect — PSY4 generates the same audio regardless of genre tag. Also near-mono (stereo width 0.0003).

---

## MASTER TABLE

| # | Project | Path | Sound Engine (live) | Synthesis Techniques | Sample Count | Quality Verdict | Portability to PSY4 |
|---|---------|------|---------------------|----------------------|--------------|-----------------|---------------------|
| 1 | **PSY4 (current)** | `/home/z/my-project` | `src/lib/psyLive.ts` (1,341 LoC) | subtractive only (saw/square/tri/sine + biquad LP + delay/reverb) | 185 (141 real drum + 6 PSY3 + 38 PSY4 renders/refs) | WEAK — basic subtractive, 4 hardcoded presets, no FM/wavetable/unison in live path | (self) |
| 2 | **PSY4 STUDIO (unused)** | `/home/z/my-project/src/lib/studio` | `psy4EngineV2.ts` (5,485) + `advancedVoice.ts` (756) | subtractive + **FM** + **supersaw (3-7 osc unison)** + **wavetable (PeriodicWave crossfade)** + multisample + layer engine + multiband comp + commercial ref analysis | (uses PSY4 samples) | STRONG code, UNUSED by live | SMALL — already in repo, needs wiring |
| 3 | **nexus-psy7** | `/tmp/nexus-psy7` | `src/lib/audio/voices.ts` (817) + `pooled-voices.ts` (563) + `engine.ts` (784) | subtractive + **FM (carrier+mod)** + **unison (N detuned)** + multi-target LFO (cutoff/pitch/fm) + per-voice drive + multi-EQ master + master comp + delay+reverb | 0 (synth-only by design) | STRONG — modern, tested, 51 adversarial tests | MEDIUM — 2.2k LoC of clean TS, would replace psyLive.ts voices |
| 4 | **psy-foundation** | `/tmp/psy-foundation` | `packages/dsp/{oscillators,filters,effects,envelopes}.ts` (~730) | PolyBLEP anti-aliased osc + one-pole/biquad/**Moog ladder** filter + Schroeder reverb + delay w/ LP feedback | 0 (library) | HIGH-QUALITY primitives, sample-by-sample | MEDIUM — designed as library, drop-in for offline render |
| 5 | **PSY (mainline PSY-6)** | `/tmp/psy-family-scan/psy` | `index.html` (1,418) + `soundBank.js` (576) | subtractive (2-osc detune) + noise+bandpass for hats/perc + crash buffer + DJ filter + waveShaper + delay+reverb send | 0 (synth-only) | REFERENCE — minimal, proven, 4 distinct genres | LOW value (PSY4 already surpasses) |
| 6 | **PSY5 standalone** | `/tmp/psy-repos/psy5` | `index.html` (416, PooledEngine) + `factory-presets.js` (164) | subtractive 2-osc + LFO + multi-mode filter + 11 drum types (kick/snare/clap/hat/tom/rim/glitch/shaker/riser/impact) + 4-bus send (delay/reverb) + comp + IR reverb | 0 | COMPACT, clean, all-synth | LOW — PSY4 already has pool concept |
| 7 | **PSY3-clean (PSY6 MAX)** | `/tmp/psy-repos/psy3-clean` | `index.html` (350) | subtractive + sub-bass sine layer + riser/impact/downlifter FX DSP + saturation waveshaper + 3-band EQ + comp + limiter + convolver reverb + duck bus | 0 | MATURE single-file, full master chain | LOW value (already merged into later PSYs) |
| 8 | **nexus-psy7 src/lib/psy7** | `/tmp/nexus-psy7/src/lib/psy7` | `engine.ts` (593) + `renderer.ts` (390) + `presets.ts` (254) + `soundLibrary.ts` | (parallel implementation to audio/, alternative API) | 0 | DUPLICATE of #3 | — duplicate, ignore |
| 9 | **psy-foundation duplicate** | `/tmp/foundation-recon/psy-foundation` | (same as #4) | (same) | 0 | (same) | — duplicate, ignore |
| 10 | **psy-repos / psy-family-scan duplicates** | `/tmp/psy-repos/{psy,psy3-clean,psy5}` and `/tmp/psy-family-scan/{psy,psy3-clean,psy5}` | (same as #5,6,7) | (same) | 0 | (same) | — duplicates |

---

## TOP FINDINGS — 5 MOST VALUABLE ASSETS IN OTHER PSY PROJECTS THAT COULD IMPROVE PSY4'S SOUND

### 1. **nexus-psy7 full subtractive+FM+unison synth voice** ★★★★★
**Path:** `/tmp/nexus-psy7/src/lib/audio/voices.ts` (817 LoC) + `/tmp/nexus-psy7/src/lib/audio/pooled-voices.ts` (563 LoC)
**Why it matters:** PSY4's live `psyLive.ts` uses naive `createOscillator` with a single oscillator per voice (saw/square/tri/sine). nexus-psy7's `triggerSynth()` builds:
- N-oscillator **unison** stack with symmetric detune (`p.unison`, `p.unisonSpread`) — the supersaw sound PSY4 lacks
- **FM**: dedicated `modOsc` → `fmGain` → `carriers[0].frequency`, with `fmRatio`, `fmDepth` (scales with carrier freq for constant modulation index)
- **Multi-target LFO**: `lfoTarget: "cutoff" | "pitch" | "fm"` — PSY4's LFO only does cutoff
- **Per-voice drive**: `WaveShaperNode` with `oversample: "2x"` per voice
- **osc2 layer**: separate octave/detune/wave/level
**Synthesis techniques PSY4 lacks:** real unison, FM synthesis, multi-target LFO, per-voice saturation.
**Portability:** MEDIUM. The voice functions are framework-light (just take `BaseAudioContext`, dest, params, time). They could be lifted almost verbatim into PSY4 and called from `psyLive.ts`'s `scheduleStep`. The main porting cost is the parameter schema (SynthParams has ~25 fields vs PSY4's ~8 per voice).
**Sound quality:** Pooled version tested by 51 adversarial harness tests in nexus-psy7, including RT-AUD (audio renders non-silent), RT-AD-01..07 (param changes → audible spectral changes). Production-grade.

### 2. **PSY4's own AdvancedSynthVoice (4-mode) — already in repo, just not wired** ★★★★★
**Path:** `/home/z/my-project/src/lib/studio/engine/advancedVoice.ts` (756 LoC)
**Why it matters:** PSY4 ALREADY HAS a 4-mode voice (`classic | fm | supersaw | wavetable`) with:
- FM: `fmRatio`, `fmDepth`, `fmEnvAmount` (modulation index 0-8, peak deviation = depth × 1000 Hz)
- Supersaw: 3–7 detuned saws with `sawDetune` + `sawSpread` stereo spread
- Wavetable: 2 `PeriodicWave` oscillators crossfaded by LFO, with 6 preset wave pairs (`sine→saw`, `warm→bright`, `formant→clang`, `sine→shimmer`, etc.) and `wtPosition` + `wtMorphRate`
- Lazy node allocation (only 8 common nodes idle; per-mode nodes allocated in noteOn, torn down by deferred deactivation)
- Cached `PeriodicWave` bank per AudioContext (8 harmonic recipes: sine, saw, square, bright, warm, formant, clang, shimmer)
**Problem:** It's in `studio/engine/` but the live `psyLive.ts` (1,341 lines) NEVER imports it. The studio tree is "dead code" per the prior `F19-AUDIT` worklog entry.
**Portability:** SMALL. It's already in PSY4's repo. The wiring cost is ~100 LoC in `psyLive.ts` to use `AdvancedSynthVoice` instead of inline `createOscillator`. The lazy allocation design means node budget stays bounded (8 idle × 8 voices = 64 nodes; worst case 8 × 29 = 232 nodes; was 580).
**Sound quality:** Untested in live (no rendered audio artifacts from it), but the design is correct and the wavetable bank matches PSY3's documented "evolving texture" goal.

### 3. **PSY4's procedural multisample generator** ★★★★
**Path:** `/home/z/my-project/src/lib/studio/engine/multisampleGenerator.ts` (524 LoC) + `/home/z/my-project/src/lib/studio/engine/sampleBank.ts` (266 LoC) + `/home/z/my-project/src/lib/studio/engine/layerEngine.ts` (259 LoC)
**Why it matters:** PSY4 has a procedural generator that creates "40+ kick variants, 30+ bass, 30+ lead, 20+ hat, 20+ clap — all with different characters (deep, punchy, dark, bright, aggressive, warm)" — each with computed acoustic features (peak, rms, centroid, low/mid/high energy, fundamental, character tags, genreFit, bpmRange). Plus a layer engine that builds pro sounds from sub+body+click layers (KICK = sub + body + click; BASS = sub + body + character; LEAD = fundamental + harmonic + stereo + tail).
**Synthesis techniques PSY4 lacks in live:** multi-layer voice construction, sample-based variant selection by musical context.
**Portability:** MEDIUM. The generator runs in main thread (TS), produces Float32Array PCM. Could be pre-rendered at boot, fed to `psyLive.ts`'s sampler path. Cost: wire `SampleSelector` to context (world, section, energy, aggression, brightness).
**Sound quality:** Multisample generator ports PSY3's `engine.py` synthesis algorithms (per file header). PSY3's kicks had 90.7% sub energy vs PSY4-live's 4.9% (per `COMMERCIAL_REFERENCE_FORENSIC_V2.md`).

### 4. **PSY4 commercial-reference target database** ★★★★
**Path:** `/home/z/my-project/src/lib/studio/engine/commercialReference.ts` (454 LoC)
**Why it matters:** Defines per-genre commercial target ranges (LUFS, truePeak, crestFactor, 7-band spectral balance, kick fundamental/subEnergy/bodyEnergy/clickEnergy/decay/subBodyRatio, bass, lead, hat targets) for TECHNO / PSYTRANCE / TRANCE / PROGRESSIVE / DARK-PSY / GOA. This is a measurable quality target PSY4's live engine could render against.
**Sound quality:** Backed by commercial releases (Astrix, Infected Mushroom, Vini Vici, Ajja per file header).
**Portability:** SMALL. Pure data + types. Could be imported by `psyLive.ts` to drive a per-genre EQ/limiter/saturation post-processing pass on the master bus.

### 5. **psy-foundation's PolyBLEP oscillators + Moog ladder filter** ★★★
**Path:** `/tmp/psy-foundation/packages/dsp/src/oscillators.ts` (207 LoC) + `/tmp/psy-foundation/packages/dsp/src/filters.ts` (209 LoC)
**Why it matters:** PSY4 uses native `createOscillator` (which has aliasing on saw/square at high frequencies — confirmed in `PSY3_VS_PSY4.md`: "PSY3 adapts N per frequency, PSY4 is fixed"). The foundation's `PolyBlepOsc` (Välimäki & Huovilainen 2007) is the standard anti-aliased oscillator. The Moog ladder filter (4-stage with resonance feedback) is musically superior to native `BiquadFilter` for psy bass/lead — PSY3 used it; PSY4 doesn't.
**Synthesis techniques PSY4 lacks:** anti-aliased oscillators, Moog-style saturating filter.
**Portability:** MEDIUM. These are sample-by-sample processors (designed for AudioWorklet). To use in `psyLive.ts` (main thread, native Web Audio nodes) requires either (a) moving to AudioWorklet, or (b) using them only in offline renderer (`studio/engine/offlineRenderer.ts`) for rendered WAVs.
**Sound quality:** PolyBLEP removes aliasing that's audible as "harshness" on high lead notes — directly fixes `PSY3_VS_PSY4.md`'s finding that "PSY4 lead is harsh" (92% high energy vs PSY3's 1.7%).

---

## REDUNDANT ASSETS (duplicated capabilities)

| Capability | Where it exists | Notes |
|------------|-----------------|-------|
| **Subtractive 2-osc synth voice** | PSY4 psyLive · nexus-psy7 voices · PSY mainline · PSY5 · PSY3-clean | 5 implementations of the same idea. nexus-psy7's is the cleanest. |
| **Pooled voice allocation** | PSY4 `pooledEngine.ts` (508) · nexus-psy7 `pooled-voices.ts` (563) · PSY5 PooledEngine · PSY mainline | 4 implementations. |
| **Preset sound bank** | PSY4 `soundBank.ts` (698, 142 presets — UNUSED) · PSY mainline `soundBank.js` (576, 150+ presets — UNUSED) · PSY5 `factory-presets.js` (164, ~40 presets — USED) · nexus-psy7 `content/presets/{synths,bass,drums}.ts` (~1.3k — USED) | PSY4's 142 presets are valid but disconnected from runtime per file header. |
| **Offline WAV renderer** | PSY4 `studio/engine/forensic/offlineRenderer.ts` · nexus-psy7 `src/lib/audio/renderer.ts` (196) + `src/lib/psy7/renderer.ts` (390) · PSY5 `renderGenre()` in index.html | 4 implementations. |
| **FM synth voice** | PSY4 `advancedVoice.ts` (studio, UNUSED) · nexus-psy7 voices.ts (USED) · PSY4 `psy4EngineV2.ts` (5,485 LoC studio, UNUSED) | PSY4 has 2 unused FM implementations; nexus-psy7 has 1 used. |
| **Master chain (EQ → comp → limiter)** | PSY4 studio · nexus-psy7 `engine.ts` · PSY3-clean index.html · PSY mainline index.html | 4 implementations. PSY3-clean's is the most documented. |
| **IR-based reverb** | PSY4 psyLive · nexus-psy7 engine · PSY5 PooledEngine.mkIR · PSY3-clean conv | 4 implementations. |
| **Drum hit synthesis (kick/snare/hat/clap)** | PSY4 psyLive · nexus-psy7 voices.ts (9 drum types) · PSY5 DrumVoice (11 types) · PSY mainline (8 types) · PSY3-clean | 5 implementations. nexus-psy7 + PSY5 have the most types. |

---

## ABANDONED ENGINES / DSP EXPERIMENTS

| Engine / file | Status | Reason (if discoverable) |
|---------------|--------|--------------------------|
| `/home/z/my-project/src/lib/pooledEngine.ts` (508 LoC) | ABANDONED — psyLive.ts comment (line 1-9) says "WHY psy works and we didn't" and rebuilds without PooledEngine. | PooledEngine preallocated too many nodes; psyLive uses direct `createOscillator` per note. |
| `/home/z/my-project/src/lib/beatPLL.ts` (213 LoC) | ABANDONED — F13/R1 worklog: "Removed dead imports — BeatPLL, PatternMutator, MelodyObserver, RadioStateGate, TransportAdapter. The LIVE instances live inside RadioObservationLayer." | Replaced by foundation/radio/BeatObservationEngine. |
| `/home/z/my-project/src/lib/patternMutator.ts` (260) | ABANDONED — see above. | Replaced by foundation/music/primitives/motif.ts. |
| `/home/z/my-project/src/lib/melodyObserver.ts` (394) | ABANDONED — see above. | Replaced by foundation/music/MusicalObservation.ts. |
| `/home/z/my-project/src/lib/radioStateGate.ts` (169) | ABANDONED — see above. | Replaced by foundation/radio/RadioObservationLayer. |
| `/home/z/my-project/src/lib/studio/engine/psy4EngineV2.ts` (5,485 LoC) | ABANDONED — never imported by `psyLive.ts`. F19-AUDIT confirmed "Studio class does NOT consume learned grammars" and "17 inline voice functions". | Too large, studio-only, dead per prior audits. |
| `/home/z/my-project/src/lib/studio/engine/forensic/*` (~17 files) | ABANDONED — forensic lab, offline only. | Research artifacts; `closedLoop.ts`, `worldDifferentiator.ts`, `repetitionDetector.ts` — experimental quality measurers never wired to live. |
| `/home/z/my-project/src/lib/studio/engine/commercialReference.ts` (454) | UNUSED — defines commercial targets but no live renderer consults them. | Defined, never consumed. |
| `/home/z/my-project/src/lib/studio/engine/multisampleGenerator.ts` (524) | UNUSED — generates samples procedurally but `psyLive.ts` uses inline synth. | Pre-rendered samples never loaded into live path. |
| `/home/z/my-project/src/lib/studio/engine/layerEngine.ts` (259) | UNUSED — layer composition never triggered from live. | Defined, never consumed. |
| `/home/z/my-project/src/lib/studio/engine/advancedVoice.ts` (756) | UNUSED — 4-mode voice (FM/supersaw/wavetable) never imported by `psyLive.ts`. | Designed, never wired. The single biggest unused asset. |
| `/home/z/my-project/src/lib/studio/dsp/wavetable.ts` (105) | UNUSED — `WAVETABLE_BANK` (8 wavetables) never loaded by live. | Defined, never consumed. |
| `/home/z/my-project/src/lib/soundBank.ts` (698, 142 presets) | UNUSED — file header says "NOT CONNECTED TO RUNTIME. The runtime uses 4 hardcoded presets." | Verified data, awaiting future wiring. |
| `/tmp/psy-family-scan/psy/backup/groovebox-mk2-stable.html` | ABANDONED — old PSY mainline version. | Superseded by `index.html`. |
| `/tmp/psy-family-scan/psy/backup/groovebox-v3.0-m1-fullon.html` | ABANDONED — pre-M2. | Superseded. |
| `/tmp/psy-family-scan/psy/backup/groovebox-v4.0-m2-song.html` | ABANDONED — same. | Superseded. |
| `/tmp/nexus-psy7/src/lib/psy7/*` (alternative API: ecosystem.ts, engine.ts, mtof.ts, presets.ts, renderer.ts, scheduler.ts, soundLibrary.ts, store.ts, types.ts) | DUPLICATE / PARTIALLY-ABANDONED — parallel implementation to `src/lib/audio/*` + `src/lib/sequencer/*` + `src/lib/state/*`. | Looks like an earlier architecture that was kept around while `audio/` superseded it. `psy7/` totals ~2.4k LoC. |

---

## SAMPLE BANK — DETAILED INVENTORY (PSY4 only — others have zero samples)

### Location: `/home/z/my-project/public/samples/real/` — 141 real drum-machine one-shots

| Category | Source | Count | Format | Notes |
|----------|--------|-------|--------|-------|
| kick | `md_kick_Kicks_*.wav` | 20 | mixed (16/24-bit, 44.1/48kHz, mono/stereo) | MD pack |
| kick | `909_BD_*.wav` | 5 | 16-bit 44.1kHz mono | Roland TR-909 BD |
| kick | `nord_kick_*.wav` | 4 | — | Nord Drum |
| perc | `md_perc_Percs_*.wav` | 33 | — | MD percussive hits |
| perc | `nord_perc_*.wav` | 3 | — | Nord perc |
| hat | `md_hat_Hats_*.wav` | 20 | — | closed/open hats |
| stab | `md_stab_Stabs_*.wav` | 15 | — | MD stabs (one-shot tonal hits) |
| tom | `md_tom_Toms_*.wav` | 10 | — | MD toms |
| snare | `md_snare_Snares_*.wav` | 10 | — | MD snares |
| snare | `nord_snare_*.wav` | 3 | — | Nord snares |
| ride | `md_ride_Cymbals_*.wav` | 10 | — | MD rides/cymbals |
| clap | `md_clap_Claps_*.wav` | 8 | — | MD claps |
| **manifest.json** | — | 1 | JSON | Maps every file to {category, subcategory} |
| **TOTAL real samples** | — | **141** | — | Categorized, manifest-verified |

### Location: `/home/z/my-project/public/samples/` — 6 PSY3 procedural samples (top-level)

| File | Category | Duration | Peak | RMS | Centroid | Sub% | Role |
|------|----------|----------|------|-----|----------|------|------|
| `kick.wav` | kick | 0.280s | 1.000 | 0.319 | 221Hz | 90.6% | Sub body anchor (PSY3 reference) |
| `bass_A.wav` | bass | 0.180s | 0.675 | 0.200 | 858Hz | 72.5% | Bass with character |
| `lead.wav` | lead | 0.300s | 0.274 | 0.052 | 7583Hz | 0% | Bright mid lead |
| `hat_closed.wav` | hat | 0.060s | 1.000 | 0.331 | 13963Hz | 0% | Metallic closed hat |
| `hat_open.wav` | hat | 0.300s | 1.000 | 0.390 | 13847Hz | 0% | Open metallic hat |
| `clap.wav` | clap | 0.250s | 1.000 | 0.374 | 11004Hz | 0.2% | Bright clap |
| `manifest.json` | — | — | — | — | — | — | Lists 6 files |

### Location: `/home/z/my-project/audio-artifacts/` — 13 PSY4 render test artifacts

| File | Type | Duration | Format | Notes |
|------|------|----------|--------|-------|
| `REF-A-145kb.wav` | **REFERENCE** (radio capture) | 6.62s | mono 44.1kHz 16-bit | 145 kbps radio stream snippet |
| `REF-B-138kb.wav` | **REFERENCE** (radio capture) | 6.96s | mono 44.1kHz 16-bit | 138 kbps radio stream snippet |
| `GEN-A-from-refA.wav` | PSY4 render | 6.40s | mono 44.1kHz 16-bit | PSY4 attempt to match REF-A |
| `GEN-B-from-refB.wav` | PSY4 render | 7.22s | mono 44.1kHz 16-bit | PSY4 attempt to match REF-B |
| `REFERENCE-kick-bass-4bar.wav` | PSY4 baseline | 4 bar | — | Pre-fix kick+bass |
| `CURRENT-kick-bass-4bar.wav` | PSY4 baseline | 4 bar | — | Current state |
| `BEFORE/AFTER-kick-bass-8bar.wav` | PSY4 A/B | 8 bar | — | Before/after a fix |
| `FIXED/FIXED2/FIXED3-kick-bass-4bar.wav` | PSY4 iterations | 4 bar | — | 3 fix iterations |
| `FINAL-kick-bass-4bar.wav` | PSY4 final | 4 bar | — | Final kick+bass |
| `CLEAN-nocomp-noshaper-1bar.wav` | PSY4 clean | 1 bar | — | No comp, no shaper |

### Location: `/home/z/my-project/public/phase5/baseline/` — 7 "world" renders + 7 JSON analyses ⚠ BUG

| File | World | BPM | Bars | Duration | Peak | RMS | Centroid | StereoW |
|------|-------|-----|------|----------|------|-----|----------|---------|
| `goa-111.wav` | goa | 138 | 32 | 55.7s | 0.94 | 0.16 | 578Hz | 0.0003 |
| `goa-222.wav` | goa | 138 | 32 | 55.7s | 0.94 | 0.16 | 577Hz | 0.0003 |
| `goa-333.wav` | goa | 138 | 32 | 55.7s | 0.94 | 0.16 | 579Hz | 0.0003 |
| `progressive-psy-111.wav` | progressive-psy | 138 | 32 | 55.7s | 0.94 | 0.16 | 578Hz | 0.0003 |
| `progressive-psy-222.wav` | progressive-psy | 138 | 32 | 55.7s | 0.94 | 0.16 | 577Hz | 0.0003 |
| `progressive-psy-333.wav` | progressive-psy | 138 | 32 | 55.7s | 0.94 | 0.16 | 579Hz | 0.0003 |
| `dark-psy-111.wav` | dark-psy | 138 | 32 | 55.7s | 0.94 | 0.16 | 578Hz | 0.0003 |

**⚠ BUG:** All 7 "different world" renders have IDENTICAL spectral analyses (within 1Hz centroid). The `world` parameter has NO audible effect on PSY4's output. Also near-mono (stereo width 0.0003 — `after-stereo-fix.wav` exists alongside, suggesting a known issue).

### Location: `/home/z/my-project/public/phase5/` (other) — 9 dry-stem + post-process renders

`dry-PAD.wav`, `dry-BASS.wav`, `dry-LEAD.wav`, `dry-KICK.wav`, `dry-TEXTURE.wav`, `dry-KICK_BASS.wav`, `dry-FULL MIX.wav`, `after-stereo-fix.wav`, `after-space-engine.wav` — all 22050 Hz stereo 16-bit, ~7s each.

### Location: `/home/z/my-project/public/audio-quality/{baseline,improved}/` — 6 A/B renders

`baseline/{bass,drums,full_mix,kick}.wav` + `improved/{drums,full_mix}.wav` — PSY4 baseline vs improved A/B test.

### Location: `/home/z/my-project/public/phase3/` — 3 phase-3 renders

(Not deeply inspected — older render set.)

---

## VST / CLAP / LV2 / AU PLUGINS

**Zero plugin files exist anywhere on this machine's PSY projects.** Searched `.so`, `.dll`, `.vst3`, `.clap`, `.lv2`, `.component` across all 10 paths (excluding `node_modules` and `.git`). No hits.

The PSY ecosystem is 100% in-browser Web Audio synthesis. There is no VST hosting, no plugin scanning, no CLAP/LV2/AU integration.

---

## PRESETS / PATCHES

**No binary preset files** (`.fxp`, `.fxb`, `.scl`, `.kbm`, `.wt`) anywhere.

**All "presets" are TypeScript/JS data structures:**

| Project | File | Preset Count | Format |
|---------|------|--------------|--------|
| PSY4 | `src/lib/soundBank.ts` (698 LoC) | 142 | TS objects — UNUSED by live runtime |
| PSY4 | `src/lib/psyLive.ts` (lines 49-90) | 4 hardcoded | Inline `PRESETS` const — USED |
| PSY mainline | `soundBank.js` (576 LoC) | 150+ | JS objects — UNUSED by index.html |
| PSY5 | `factory-presets.js` (164 LoC) | ~40 (10 kick, 11 bass, 5 lead, 4 pad, 4 pluck, 4 arp, 5 fx) | JS objects — USED |
| nexus-psy7 | `src/lib/content/presets/synths.ts` (592) | ~20 synth | TS — USED |
| nexus-psy7 | `src/lib/content/presets/bass.ts` (301) | ~12 bass | TS — USED |
| nexus-psy7 | `src/lib/content/presets/drums.ts` (417) | ~25 drum | TS — USED |
| psy-foundation | `data/presets.json` + `data/{rhythms,motifs,styles,scales}.json` | n/a | JSON data files |

---

## WAVETABLES

**No `.wt` files.** Wavetables exist as in-code data:

| Project | File | Wavetables | Technique |
|---------|------|-----------|-----------|
| PSY4 studio (UNUSED) | `src/lib/studio/dsp/wavetable.ts` (105 LoC) | 8 (sine, saw, square, bright, warm, formant, clang, shimmer) | `additiveWavetable()` — additive synthesis, 1024-sample tables |
| PSY4 studio (UNUSED) | `src/lib/studio/engine/advancedVoice.ts` (lines 67-117) | 8 harmonic recipes + 6 crossfade pairs | `ctx.createPeriodicWave(real, imag)` — native PeriodicWave |
| PSY4 studio (UNUSED) | `src/lib/studio/engine/psy4EngineV2.ts` | (5,485 LoC — likely contains wavetable refs) | Not inspected in full |

**No wavetable is wired to PSY4's live engine.**

---

## AUDIO RENDERERS (offline WAV producers)

| Project | File | LoC | What it does |
|---------|------|-----|--------------|
| PSY4 | `src/lib/studio/engine/forensic/offlineRenderer.ts` | (in 17-file forensic tree) | Offline forensic lab renderer |
| PSY4 | `src/lib/studio/engine/reference/renderWorker.ts` | (in reference tree) | Reference analysis render worker |
| PSY4 | `src/lib/studio/engine/reference/trainingLoop.ts` | — | Continuous training loop |
| nexus-psy7 | `src/lib/audio/renderer.ts` | 196 | `renderProjectPlayback()` — OfflineAudioContext, deterministic mulberry32 RNG |
| nexus-psy7 | `src/lib/psy7/renderer.ts` | 390 | `renderSegment()` + `renderSong()` — pattern + song mode export, 44.1kHz stereo |
| PSY5 | `index.html` `renderGenre()` function | inline | 4-genre offline render via `OfflineAudioContext` for self-gate test |
| PSY mainline | `index.html` `selfTest()` (line 1089) | inline | `OfflineAudioContext` self-test |
| psy-foundation | `apps/{benchmark,differential,reference,sync,transport-runtime}-lab/` | 5 lab apps | Lab harnesses for A/B/Benchmark/differential rendering |

---

## DSP EXPERIMENTS / ALTERNATIVE ENGINES

| Experiment | Path | Status |
|------------|------|--------|
| PSY4 forensic lab (17 files) | `src/lib/studio/engine/forensic/*` | Research — `worlds.ts`, `worldDifferentiator.ts`, `repetitionDetector.ts`, `closedLoop.ts`, `audioAnalyzer.ts`, `qualityScore.ts`, `mixing.ts`, `paramValidator.ts`, `forensicRunner.ts`, `latencyMonitor.ts`, `liteRenderer.ts`, `musicalGrammar.ts`, `prng.ts`, `dsp.ts`, `voices.ts`, `reportGenerator.ts`, `offlineRenderer.ts` |
| PSY4 reference analysis tree | `src/lib/studio/engine/reference/*` | `referenceScore.ts`, `trainingLoop.ts`, `radioStreams.ts`, `selfAnalyzer.ts`, `renderWorker.ts`, `perVoiceAnalyzer.ts`, `continuousTrainer.ts` — self-improvement loop prototype |
| PSY4 timbre fingerprinting | `src/lib/studio/engine/timbreFingerprint.ts` (440) | Per-voice timbre analyzer — UNUSED |
| PSY4 commercial ref detector | `src/lib/studio/engine/commercialReference.ts` (454) | Defined targets, never consumed live |
| PSY4 synthesis detector | `src/lib/studio/engine/synthesisDetector.ts` (432) | Reverse-engineers ref audio |
| PSY4 effects detector | `src/lib/studio/engine/effectsDetector.ts` (432) | Detects FX in ref audio |
| PSY4 style classifier | `src/lib/studio/engine/styleClassifier.ts` (528) | Genre classification |
| PSY4 vocabulary learner | `src/lib/studio/engine/vocabularyLearner.ts` (649) | Pattern vocabulary learning |
| PSY4 call/response engine | `src/lib/studio/engine/callResponseEngine.ts` | Lead/response — UNUSED |
| PSY4 harmony engine | `src/lib/studio/engine/harmonyEngine.ts` (619) | Harmonic progression — UNUSED |
| PSY4 layer engine | `src/lib/studio/engine/layerEngine.ts` (259) | Multi-layer voice — UNUSED |
| PSY4 multisample generator | `src/lib/studio/engine/multisampleGenerator.ts` (524) | Procedural samples — UNUSED |
| PSY4 advanced voice | `src/lib/studio/engine/advancedVoice.ts` (756) | FM/supersaw/wavetable — UNUSED |
| PSY4 worklet engine | `src/lib/studio/engine/workletEngine.ts` (758) | AudioWorklet prototype — UNUSED |
| PSY4 dj controller | `src/lib/studio/engine/djController.ts` (738) | DJ-mode mixer — UNUSED |
| PSY4 legacy audio graph | `src/lib/studio/engine/legacyAudioGraph.ts` (860) | Legacy — UNUSED |
| PSY mainline backup variants | `/tmp/psy-family-scan/psy/backup/groovebox-{mk2-stable,v3.0-m1-fullon,v4.0-m2-song}.html` | Historical versions |
| nexus-psy7 psy7/ sub-API | `/tmp/nexus-psy7/src/lib/psy7/*` | Alternative architecture, ~2.4k LoC — partially superseded by `audio/` |

---

## README / DOCS PER PROJECT

| Project | Doc | What it says |
|---------|-----|--------------|
| PSY4 | 22 `.md` files at root | `ARCHITECTURE_SIGNAL_FLOW.md`, `COMMERCIAL_AUDIO_AUDIT.md`, `COMMERCIAL_REFERENCE_FORENSIC_V2.md`, `COMMERCIAL_SOUND_BANK_AUDIT.md`, `LATENCY_FORENSIC.md`, `MUSICAL_GRAMMAR.md`, `PSY3_PRODUCTION_KNOWLEDGE.md`, `PSY3_SOUND_DESIGN_RULES.md`, `PSY3_VS_PSY4.md`, `PSY4_DEEP_ROAST.md`, `PSY4_ROAST.md`, `REFERENCE_ANALYSIS_REPORT.md`, `SAMPLE_SELECTION_RULES.md`, `SOUND_LIBRARY.md`, etc. |
| nexus-psy7 | `docs/{CAPABILITIES,ECOSYSTEM,FROZEN_VERIFICATION_REPORT,PRODUCT_BACKLOG,PRODUCT_COMPLETION_REPORT,PSY_ULTIMATE_PLAN,PSY_UNIFIED_ANALYSIS,ROAST_MY_PLAN,ROOT_CAUSE_ISOLATION}.md` | Full product + capability matrix; "PSY_UNIFIED_ANALYSIS" is a Hebrew-language comparative analysis of all 7 PSY versions |
| psy-foundation | `docs/{architecture,protocol,research}/*` + `README.md` + `FOUNDATION_STATUS.md` + `FOUNDATION_FREEZE.md` | Shared library docs |
| PSY mainline | `PSY6_ARCHITECTURE.md` (216) + `CROSS_REPO_AUDIT.md` (70) | Phase-2 architectural decisions + cross-repo audit |
| PSY3-clean | `README.md` (2 lines) | "PSY3 - Clean base with critical fixes" |
| PSY5 | (no README) | Single-file, no docs |

---

## PSY4 COMPARISON — IS EACH ASSET BETTER / PORTABLE?

| Asset | Better than PSY4 live? | PSY4 lacks? | Port size | Sound quality evidence |
|-------|------------------------|-------------|-----------|-------------------------|
| nexus-psy7 voices.ts (FM+unison+LFO+drive) | YES | FM, unison, multi-target LFO, per-voice drive | MEDIUM (~1.4k LoC, framework-light) | 51 adversarial tests, RT-AD-01..07 |
| PSY4 advancedVoice.ts (already in repo) | YES | FM, supersaw, wavetable | SMALL (~100 LoC wiring in psyLive) | Untested in live |
| PSY4 multisampleGenerator + layerEngine | YES | Multi-layer voice construction, sample-by-context selection | MEDIUM (~1k LoC + sample loader) | Ports PSY3 algorithms (90.7% sub energy) |
| PSY4 commercialReference targets | YES (measurable target) | Per-genre master EQ/comp/limiter targets | SMALL (data + master-bus post-process) | Backed by Astrix/IM/Vini Vici/Ajja standards |
| psy-foundation PolyBLEP + Moog ladder | YES | Anti-aliased osc, Moog saturating filter | MEDIUM (requires Worklet or offline only) | Fixes PSY4's "harsh lead" (92% high vs PSY3's 1.7%) |
| PSY5 PooledEngine | NO (PSY4 has pooledEngine.ts) | — | — | — |
| PSY mainline synth voices | NO (PSY4 surpasses) | — | — | — |
| PSY3-clean master chain | MARGINAL (PSY4 has equivalent in studio) | Stereo width (PSY3-clean is wider) | LOW | — |
| PSY4 soundBank.ts (142 presets, UNUSED) | YES (if wired) | 142 valid presets vs 4 hardcoded | SMALL (wire getById/autoSelect) | Data verified by SB-6A test |

---

## CONCLUSION

**The PSY ecosystem's most valuable unused assets are already inside PSY4 itself.** `advancedVoice.ts` (756 LoC, 4-mode synth with FM/supersaw/wavetable), `multisampleGenerator.ts` (524 LoC, 140+ procedural samples), `layerEngine.ts` (259 LoC, multi-layer voice construction), `commercialReference.ts` (454 LoC, per-genre targets), and `soundBank.ts` (698 LoC, 142 verified presets) are ALL in `/home/z/my-project/src/lib/studio/` but NONE are wired to the live `psyLive.ts` engine. The single highest-impact change is wiring `AdvancedSynthVoice` into `psyLive.ts` — small effort, large quality gain.

The next-most-valuable external asset is **nexus-psy7's `voices.ts`** at `/tmp/nexus-psy7/src/lib/audio/voices.ts` (817 LoC), which has a production-grade FM+unison+multi-target-LFO synth voice validated by 51 adversarial tests. It is the cleanest reference implementation in the family for what PSY4's live engine should become.

**Reference recordings** are scarce — only 2 short radio captures (`REF-A-145kb.wav` 6.62s, `REF-B-138kb.wav` 6.96s) plus 6 PSY3 procedural samples. PSY4 has no commercial-track reference library to A/B against.

**Sample bank** is the strongest part of PSY4: 141 real drum-machine one-shots (909 + Nord + MD packs), fully categorized with manifest. This is production-usable material that PSY4's live engine currently ignores in favor of inline synth.

**No VST/CLAP/LV2/AU integration exists** anywhere in the family. The ecosystem is 100% Web Audio native.
