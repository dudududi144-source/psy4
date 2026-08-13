# AUDIT-SAMPLER — Deep Audit of PSY4 Sample Infrastructure

**Task ID:** AUDIT-SAMPLER
**Agent:** AUDIT-SAMPLER
**Scope:** sample loading, caching, voice allocation, playback, real-time safety, determinism, manifest provenance, offline/realtime parity.
**Code read in full:** `sampleBank.ts` (267 LOC), `multisampleGenerator.ts` (525 LOC), `audioBackend.ts` (238 LOC, interface only — implementations are in `workletEngine.ts` / `legacyAudioGraph.ts`), `engineWorklet.ts` (252 LOC), `psy4-engine.js` (2576 LOC), `psy4-dsp.js` (486 LOC), `offlineRenderer.ts` (115 LOC), `public/samples/manifest.json` (6 entries), `public/samples/real/manifest.json` (~108 entries), `SAMPLE_MANIFEST.json` (6 entries).
**Code NOT modified.** No schema, no Foundation, no PSY4 source changes.

---

## Section 1 — `sampleBank.ts` audit

**Purpose.** Main-thread loader for WAV samples. Decodes via `AudioContext.decodeAudioData`, downmixes to mono, computes acoustic features (peak/RMS/spectral centroid/three-band energy/fundamental), and exports a transferable payload of `{name, category, subcategory, sampleRate, data: Float32Array}` for the worklet.

**Ownership.** Sample loading + acoustic feature extraction + transferable payload construction. Does **not** own playback, voice allocation, or caching policy — hands off ownership of `Float32Array` buffers to the worklet via `Transferable` postMessage.

**Lifecycle.** Constructed with an `AudioContext`. `loadAll()` fetches `public/samples/real/manifest.json`, builds a combined catalog, fetches WAVs in batches of 20 in parallel, decodes, extracts features, stores in `Map<string, SampleInfo>`. No explicit `dispose()` — relies on GC. Sample buffers are **transferred** (zero-copy) to the worklet via `toWorkletPayload()`, so the main-thread copy becomes neutered; the worklet owns the only live copy after transfer.

**Determinism.** Fully deterministic at load time. No `Math.random`, no `Date.now`. The pink-noise DFT and feature extraction are pure functions of sample data. Fetch order is async but results land in a stable `Map` keyed by name. Order of feature computation does not affect output.

**Real-time safety.** **Not on the audio path.** Runs on main thread at startup. However, it uses an **O(N²) DFT** (lines 202–228) with N=4096 → ~16M operations per sample, and the catalog has ~114 samples → ~1.8B ops at load. This is acceptable at load time but **bloats startup latency** (likely 2–5 s). Should be replaced with a real FFT (radix-2 or `AnalyserNode.getFloatFrequencyData`).

**Dependencies.** Browser-only: `fetch`, `AudioContext.decodeAudioData`, `Float32Array`. **No React, no DOM, no Foundation, no psy4-specific coupling.** Pure TS module.

**Reusability.** **High.** Can be lifted as-is into a standalone device. The only change needed: replace `fetch('/samples/...')` with a configurable base-URL / `URL` constructor param, and add an explicit `dispose()` that releases `Float32Array` buffers and clears the `Map`.

**Verdict: REUSE.** Clean, deterministic, decoupled. Two issues to fix when porting: (1) replace O(N²) DFT with real FFT; (2) add explicit `dispose()`.

---

## Section 2 — `multisampleGenerator.ts` audit

**Purpose.** Procedurally synthesizes 46 sample variants (12 kicks, 10 basses, 10 leads, 8 hats, 6 claps) at SR=44100, computes the same acoustic features as `sampleBank.ts`, and tags each with `character[]`, `genreFit[]`, `bpmRange`. Intended to give the SampleSelector variety beyond the 6 PSY3 samples + 108 real CC0 samples.

**Ownership.** Sample **generation** (one-shot, at startup or on demand). Owns the parameter tables that define each variant. Does **not** own playback, caching, or selection — returns an array of `GeneratedSample` for the caller to feed into the bank.

**Lifecycle.** Pure function `generateMultisampleBank()` returns a fresh array each call. No state held between calls. Internal `PinkNoiseGen` instances are created per-sample and discarded. Each call allocates ~46 `Float32Array`s of varying size.

**Determinism.** **Fully deterministic.** `PinkNoiseGen` is an LCG with hardcoded seed `state = 12345` (line 50). No `Math.random`, no `Date.now`, no `performance.now`. Identical calls produce byte-identical output. Excellent property for reproducible renders.

**Real-time safety.** **Not on the audio path** — called at startup. Uses `Math.max(...Array.from(data).map(Math.abs))` for normalization (lines 201, 376, 426), which allocates an intermediate `Array` from the `Float32Array` — fine here, would be a violation in a worklet.

**Dependencies.** Pure TS, no imports. No React, no DOM, no Foundation, no psy4 coupling.

**Reusability.** **Very high.** Self-contained DSP. The only psy4-specific aspect is the variant parameter tables — these would be replaced by a generic `GeneratorConfig` interface when porting. The `analyzeSample` function duplicates the one in `sampleBank.ts` (DRY violation); consolidate when porting.

**Verdict: REUSE.** Clean, deterministic, decoupled. Note: never wired into the actual worklet pipeline (see Section 12) — currently dead code.

---

## Section 3 — `audioBackend.ts` + `engineWorklet.ts` audit

### `audioBackend.ts`

**Purpose.** Pure TypeScript **interface** (no implementation). Defines the contract between `Psy4EngineV2` (musical logic) and the audio thread (DSP). 26 methods covering lifecycle, note triggering, parameter control, per-track effects, surprise manipulation, and analysis.

**Ownership.** Owns the **API boundary**. Does not own state.

**Lifecycle.** N/A (interface).

**Determinism.** N/A (interface).

**Real-time safety.** N/A (interface). But: the interface design **forces allocation** in `triggerDrum`/`triggerSynth` callers — they must construct `SynthTimbre` object literals per call. The worklet wrapper batches these via `Float64Array`, but the interface encourages per-call object creation.

**Dependencies.** None. Pure type definitions.

**Reusability.** **High.** The interface itself is clean. The issue: it has 26 methods, many of which are worklet-noops or legacy-only. A standalone device would split into 3 interfaces: `SamplerTransport`, `SamplerVoiceTrigger`, `SamplerParams`.

**Verdict: ADAPT.** Split into focused interfaces; drop legacy-only methods (`setTrackGainScale`, `setMasterGainScale`, `restoreDefaults`).

### `engineWorklet.ts`

**Purpose.** TypeScript wrapper around the `psy4-engine` AudioWorkletNode. Manages event batching in a `Float64Array` (256 events × 6 fields = 1536 floats), exposes `scheduleEvent/flushEvents/loadSamples/setWorld/setFX/panic`.

**Ownership.** Main-thread side of the worklet bridge. Owns the event batch buffer (preallocated once). Owns the `AudioWorkletNode` lifecycle. Does **not** own sample decoding (delegates to `SampleBank`) or voice allocation (delegates to worklet).

**Lifecycle.** Constructor preallocates `eventBatch: Float64Array(256*6)`. `init()` loads the worklet module (cached per-context via `engineLoadPromise` singleton), creates the node, connects to `ctx.destination`. `dispose()` disconnects the node and nulls the reference — but **does not close the AudioContext** (correct — context is shared).

**Determinism.** Mostly deterministic. `triggerImmediate` uses `this.ctx.currentTime + 0.02` — wall-clock dependent but used only for UI hits, not musical scheduling. Musical scheduling uses `currentTime`-relative times computed by the engine, which is correct.

**Real-time safety.** **Main-thread code — not RT-critical.** But: `flushEvents()` allocates a fresh `Float64Array` per flush (line 228) — necessary for `Transferable` (transferred buffers are neutered), but creates GC pressure if called every frame. Acceptable because flush happens ~10 Hz, not per-sample.

**Dependencies.** Browser only: `AudioContext`, `AudioWorkletNode`. No React, no DOM, no Foundation, no psy4 coupling (only psy4 constant: the worklet URL).

**Reusability.** **High.** The wrapper is generic. To extract as a standalone device: rename `'psy4-engine'` to a configurable processor name, expose `voiceId` enum as a parameter, and remove the psy4-specific `notifyNewPhrase` / `triggerDuck` (these are musical concepts that should be in a layer above).

**Verdict: ADAPT.** Rename, parameterize processor name, move musical helpers out.

---

## Section 4 — Worklet code audit: `psy4-engine.js` + `psy4-dsp.js`

### `psy4-engine.js` (2576 LOC) — the real-time engine

**Purpose.** Single AudioWorklet processor running the full synth + sampler engine. Contains: transport (BPM/step), ring-buffer event queue (256-slot `Float64Array`), 34 preallocated synth voices across 12 pools (kick/bass/lead/acid/pad/hat/clap/perc/shaker/texture/fx/fm), 3 sample voice pools (kickSamplePool/hatSamplePool/clapSamplePool — **currently disabled**, line 1756–1759: `// DISABLED (no samples loaded, saves 28 voices)`), `SampleVoice` class (linear interp + pan + decay env + post-tanh saturation), `SchroederReverb` (4 comb + 2 allpass), `StereoDelay` (ping-pong), `BusProcessor` (HP + comp + sat per bus, separate L/R instances), `MultibandComp` (LR2 crossovers at 180/4000 Hz), `StereoWidener` (Haas + decorrelated side), `MasterChain` (multiband → glue → sat → LUFS → true-peak limiter → final tanh).

**Ownership.** Owns **everything on the audio thread**: transport, voice allocation, voice stealing, sample playback, bus mixing, FX sends, master chain, CPU-load monitoring, dynamic voice budget.

**Lifecycle.** Constructor preallocates all voice pools, all FX instances, all bus processors, the active-voice flat arrays (`activeVoiceRef: Array(64)`, `activeVoiceBus: Uint8Array(64)`, `activeVoiceStereo: Uint8Array(64)`), and the `voicePoolTable` (built once, line 1895). `handleMessage` mutates state. `process()` is called every 128 samples. No `dispose()` — worklet lifecycle managed by the node.

**Determinism — CRITICAL FINDINGS.**

1. **`Math.random()` in `AcidVoice.trigger()` (line 608):** `this.aDriftTarget = (Math.random() - 0.5) * 0.02;` — non-deterministic thermal drift target per note. **Called from `triggerVoice()` inside `process()`** (event dequeue path). Same seed → same notes → different drift each run.
2. **`Math.random()` in `TextureVoice.trigger()` (line 1015):** `const baseFreq = 110 + Math.random() * 220;` — random base frequency per texture voice trigger. Also on the audio thread.
3. **`performance.now()` in `process()` (line 2298):** `const __procStart = performance.now();` — used **only for CPU-load monitoring**, NOT as a musical clock. Acceptable. Does not affect audio output.
4. **`currentFrame` (global, line 2309):** sample-counter from the worklet host — monotonic, deterministic relative to start.
5. **No `Date.now()` in worklet.** Good.
6. **Round-robin counters (`rrCounters`)** are deterministic per session (incremented on each trigger, modulo N). Good.
7. **Phrase-locked sample indices (`phraseKickIdx` etc.)** are deterministic — incremented on `'newPhrase'` messages from the main thread.

**Verdict on determinism:** NOT fully deterministic. Acid voice drift and texture baseFreq break reproducibility. For a commercial-grade sampler that must produce identical renders from a seed, both must be replaced with an LCG seeded from the event's `param` or a deterministic per-voice state.

**Real-time safety — CRITICAL FINDINGS.**

1. **`triggerVoice()` for `V_KICK` / `V_HAT` / `V_CLAP` / `V_PERC` (lines 2057–2241):** every single drum trigger does:
   ```js
   const kickNames = Object.keys(this.samples).filter(n => this.samples[n].category === 'kick');
   const realKickNames = kickNames.filter(n => n.startsWith('nord') || n.startsWith('909') || n.startsWith('real'));
   ```
   This is **two array allocations + two filter closures per drum hit**, on the audio thread, inside `process()`. At 145 BPM with kick on every quarter = 2.4 Hz, that's tolerable. At 16th-note hats at 160 BPM = 10.6 Hz, still OK but unacceptable for RT contract. **Major violation of the PSY5 RT contract** documented in the file header.
   Fix: precompute `kickNames`/`hatNames`/`clapNames`/`percNames` arrays once when `loadSamples` runs, store as fields.
2. **`Math.random()` in `trigger()`** — V8's `Math.random` is not RT-safe (uses a shared PRNG state with a lock in older V8; modern V8 uses xorshift128+ per-isolate but still calls into runtime).
3. **`new Float32Array(18)` for `leadDelayL` (line 2371)** — lazy-init on first block. Acceptable (one-time allocation) but should be moved to constructor.
4. **`process()` inner loop (lines 2391–2527):** no allocations. Uses local-cached references (`drumBusL_`, `masterL`, etc.) to avoid `this.` lookups. **Good.** Single loop over `activeCount` voices with switch on bus — flat, bounded.
5. **`this.port.postMessage(...)` every 30 blocks (line 2558)** — fine, infrequent.
6. **Voice pool iteration in `getFreeVoice` (line 2278):** linear scan, no allocation. Good. Voice stealing: returns `pool[0]` (oldest) — crude but RT-safe.

**`SampleVoice` class (lines 1167–1226):**
- Linear interpolation playback with fractional position. Correct.
- Pitch shift via `playbackRate * (sampleRate / sr)`. Correct.
- Envelope: simple exponential decay `Math.exp(-t / decay)`. No ADSR — kick/clap/hat samples are one-shot, fine.
- Post-playback saturation: `fastTanh(sample * 1.4)`. Adds harmonics — colors the sample. **Debatable design choice** — should be optional per-voice, not hardcoded.
- Pan: equal-power (line 1221–1222) — but implementation is wrong: `leftGain = pan <= 0 ? 1 : 1 - pan; rightGain = pan >= 0 ? 1 : 1 + pan;` is **linear pan, not equal-power**. Equal-power would use `cos/sin`. Minor sonic issue, not RT.
- **No loop mode.** One-shot only. Cannot sustain a sample for pads/leads.
- **No anti-aliased pitch-down.** When `playbackRate < 1`, no LP filter before decimation → aliasing.
- **No multi-sample / keyzone support.** Single sample per voice, no keymap.

**Dependencies.** None (worklet scope, no imports). Psy4-specific only via the processor name `'psy4-engine'`.

**Reusability.** **Moderate.** The DSP classes (`MoogLadder`, `BLSaw`, `BLSquare`, `PinkNoise`, `ADSR`, `DecayEnv`, `SampleVoice`, `SchroederReverb`, `StereoDelay`, `BusProcessor`, `MultibandComp`, `StereoWidener`, `MasterChain`) are reusable. The `Psy4EngineProcessor` class is **tightly coupled** to PSY4's voice taxonomy (17 voice IDs), bus layout (5 buses), and macro param names. To extract: split into (a) a DSP primitives library, (b) a generic `SamplerVoice` + `VoicePool`, (c) a PSY4-specific engine that composes them.

**Verdict: ADAPT.** The DSP is sound; the engine composition needs refactoring. Critical fixes before porting: (1) precompute sample-name arrays; (2) replace `Math.random` with LCG; (3) fix `SampleVoice` pan; (4) add anti-aliasing filter for pitch-down; (5) add loop mode + keyzones.

### `psy4-dsp.js` (486 LOC) — standalone DSP worklets

**Purpose.** Six standalone AudioWorklet processors (`moog-filter`, `bl-saw`, `bl-square`, `saturation`, `phaser`, `bus-eq`) for use as modular nodes in a Web Audio graph. Ported from PSY3 `pro_dsp.py`.

**Ownership.** Each processor owns its own per-channel state. No shared state.

**Lifecycle.** Constructor initializes state. `process()` is sample-accurate. No `dispose()`.

**Determinism.** Fully deterministic. No `Math.random`, no `Date.now`, no `performance.now`. Pure DSP.

**Real-time safety.** **Excellent.** No allocations in `process()`. All state preallocated in constructors. `SaturationProcessor` precomputes a 2049-entry tanh LUT at construction (one-time cost). The `MoogFilterProcessor` calls `Math.tanh` (not the polynomial `fastTanh`) — V8 may not inline this; could be a perf issue at high channel counts but is RT-safe (no allocation).

**Dependencies.** None. Pure worklet code.

**Reusability.** **Excellent.** Already modular. Each processor is independent and can be registered in any AudioWorklet context.

**Verdict: REUSE.** These are the gold standard of the codebase.

---

## Section 5 — `offlineRenderer.ts` audit

**Purpose.** Render PSY4 engine output to WAV files for A/B analysis. Uses `OfflineAudioContext` (intended — see below).

**Ownership.** Render orchestration + WAV encoding.

**Lifecycle.** Pure functions. `renderKickTest` schedules 4 kicks via `engineNode.scheduleEvent` and returns a `Float32Array`. `writeWavFile` produces a `Blob`.

**Determinism.** WAV encoding is deterministic. But `renderKickTest` (line 76) uses `await new Promise(resolve => setTimeout(resolve, 500))` — wall-clock wait. **This is broken for offline render** — `OfflineAudioContext` does not honor `setTimeout`; you must call `offlineCtx.startRendering()` and await its promise.

**Real-time safety.** Main-thread code, not RT-critical.

**Dependencies.** Imports `Psy4EngineNode`, `SampleBank`, `generateMultisampleBank` from psy4 engine. **Coupled** to the psy4 voice IDs (`VOICE.KICK`).

**Critical finding.** `renderKickTest` is **a stub**. The function:
```ts
// Get the rendered audio from a ScriptProcessor or analyser
// For offline, we need to capture the output
// This is a simplified version — real implementation would use OfflineAudioContext
return new Float32Array(length);
```
It returns a **zero-filled array**. The "offline renderer" does not actually render. There is no working offline path. (There is a separate `src/lib/studio/engine/forensic/offlineRenderer.ts` and `forensic/liteRenderer.ts` that may do the real work — out of scope for this audit.)

**Reusability.** **None as-is.** The WAV writer (`writeWavFile`) is reusable; the render orchestration must be rewritten.

**Verdict: DO NOT PORT.** Stub. Port only `writeWavFile`. Use the forensic renderer for real offline work.

---

## Section 6 — Sample manifest audit

**Three manifest files exist:**

1. **`public/samples/manifest.json`** — bare JSON array of 6 filenames: `["kick.wav", "hat_closed.wav", "hat_open.wav", "clap.wav", "bass_A.wav", "lead.wav"]`. **No metadata.** Used by… nothing visible in `sampleBank.ts` (which hardcodes `PSY3_CATALOG` instead). **Dead file.**

2. **`public/samples/real/manifest.json`** — JSON array of ~108 entries, each with `file`, `category`, `subcategory`. **No source, no author, no license, no attribution, no dateAcquired, no usageRestrictions.** This is what `sampleBank.ts` actually consumes. **Provenance: unknown.** Filenames suggest MachineDrum (`md_*`), Nord Drum (`nord_*`), and 909 — but without license metadata, **commercial use is legally risky.**

3. **`SAMPLE_MANIFEST.json`** (root) — proper manifest with full provenance for the 6 PSY3 samples only: `source`, `author`, `license`, `attribution`, `dateAcquired`, `usageRestrictions`, plus acoustic features (`peak`, `rms`, `centroid`, `lowEnergy`, `midEnergy`, `highEnergy`, `fundamental`), `quality` grade, `role`, `worlds`, `processing` notes, and an `ingestionPipeline` spec. **Excellent format.** But: covers only 6 samples; the 108 real samples have **no equivalent manifest**.

**Format assessment.**
- `SAMPLE_MANIFEST.json` is the gold standard: full provenance, acoustic metadata, role, processing notes, ingestion policy.
- `public/samples/real/manifest.json` is the actual working manifest: **provenance-bare**.
- **The two are not reconciled.** The 108 real samples are untraceable.

**License policy.** The `SAMPLE_MANIFEST.json` `ingestionPipeline.licensePolicy` explicitly states: *"NEVER assume a random downloaded sample is commercially usable. All imported samples MUST have explicit license metadata."* The 108 real samples violate this policy.

**Recommendation.** (1) Extend `SAMPLE_MANIFEST.json` format to cover all 114 samples. (2) Re-license or remove any sample without explicit CC0/public-domain/commercial-clear provenance. (3) Add a `license` field to `public/samples/real/manifest.json` as a migration step. (4) Add `provenance` field with `source URL`, `pack name`, `date acquired`, `verifier`.

---

## Section 7 — SampleVoice / VoicePool audit

### `SampleVoice` (in `psy4-engine.js`, lines 1167–1226)

**Fields:** `active`, `t`, `sampleData: Float32Array`, `sampleRate`, `playbackRate`, `amp`, `gainEnv`, `decay`, `position` (fractional), `pan`.

**Methods:**
- `trigger(sampleData, sampleRate, playbackRate, amp, decay, pan)` — sets state, `position=0`.
- `renderStereo(currentTime, sr)` — linear interp read, exponential decay env, post-saturation tanh, equal-power-ish pan, advances position by `playbackRate * (sampleRate / sr)`.

**Pitch shifting:** via `playbackRate` multiplier (resampling). No anti-aliasing filter for downward pitch. No formant correction. No granular or time-stretch option. Single-sample, single-zone.

**Interpolation:** linear. Adequate for percussion; insufficient for tonal material at extreme pitch shifts (audible aliasing and ringing). Should be at least 4-point cubic (Hermite) for commercial quality.

**Envelopes:** exponential decay only. No attack, no sustain, no release, no loop. One-shot playback. Cannot sustain a sample for pads/leads — that's why bass/lead samples in `SAMPLE_MANIFEST.json` are explicitly marked "Loaded but not yet used in worklet."

**Voice stealing:** handled by `getFreeVoice(pool)` — linear scan for `!active`, falls back to `pool[0]` (oldest). **Crude.** No priority, no envelope-aware stealing (steals a voice at peak amplitude). Will cause audible clicks on sustained material.

### VoicePool

There is **no `VoicePool` class.** Voice pools are plain JS arrays (`this.kickPool = []` etc.), preallocated in the constructor with fixed counts (kick=4, bass=2, lead=4, acid=2, pad=2, hat=4, clap=2, perc=4, shaker=2, texture=2, fx=4, fm=2 = 34 total synth voices). Sample voice pools (`kickSamplePool`, `hatSamplePool`, `clapSamplePool`) are preallocated as empty arrays and **disabled** (line 1756–1759).

**Allocation:** all voices constructed once in constructor. No per-hit allocation. **Good.**

**Stealing:** `getFreeVoice` returns first inactive, else `pool[0]`. **No priority, no envelope-aware cut.** Acceptable for one-shot drums (fast decay); would be unacceptable for sustained voices.

**Dynamic budget:** the PSY5 dynamic voice budget (lines 2360–2368) drops **highest-indexed active voices** when CPU overloaded. This protects kick/bass/lead (lowest indices) and sacrifices FX/texture/sample (highest). **Good design.**

---

## Section 8 — Round-robin / determinism audit

**Round-robin implementation:** `this.rrCounters = { kick: 0, hat: 0, clap: 0 }` (line 1766). Incremented modulo 4 on each trigger. Used for **micro-variation** (±0.3% pitch, ±3% gain) — NOT for sample rotation. The comment at line 2073: "Micro variation: ±0.3% pitch, ±3% gain (imperceptible but organic)".

**Sample rotation:** NOT round-robin. Uses **phrase-locked indices** (`phraseKickIdx`, `phraseHatIdx`, `phraseClapIdx`, `phrasePercIdx`, `phraseLeadIdx`) incremented on `'newPhrase'` messages. Same sample plays for entire phrase (8 bars), then rotates. **Good for sonic consistency.**

**Exception:** `V_HAT_OPEN` (lines 2163–2186) uses `rrCounters.hat % names.length` for per-hit rotation — inconsistent with phrase-locking for closed hats.

**Determinism of RR:** deterministic per session (counters start at 0, increment monotonically). **Reproducible across runs** as long as the event stream is identical.

**Exception:** `V_PERC` (line 2224) reuses `rrCounters.clap` for perc RR — **shares state with clap**, so perc selection depends on clap hit count. **Bug.** Should have its own counter.

**Exception:** AcidVoice and TextureVoice use `Math.random()` (Section 4) — non-deterministic.

**Verdict:** RR is deterministic but has two bugs (perc/clap counter sharing, hat_open inconsistency). Randomness in Acid/Texture breaks reproducibility.

---

## Section 9 — MIDI path audit

**There is no MIDI path in the audited files.** The engine uses ** MusicalEvent** (imported from Foundation, line 103 of `psy4EngineV2.ts` — out of scope) and a **numeric voice ID** system (`VOICE.KICK = 0` … `V_FM = 17`).

**MIDI translation happens upstream** in `melodyEngine.ts` (line 650): `let midi = scaleNote(this.root + 12, this.scale, event.scaleDeg);` — converts a scale degree to a MIDI note number, then passed to `triggerSynth(track, time, midi, vel, dur, timbre)`.

**MIDI → frequency:** happens inside the worklet voices. `BassVoice.trigger(time, freq, ...)` takes `freq` directly — but `triggerVoice` for `V_BASS` (line 2099) passes `note` (MIDI note number) as `freq`. **BUG or implicit convention?** The `BassVoice.render` uses `this.freq / sr` as phase increment — if `note=57` (A3), that's `57/44100 = 0.00129` Hz, inaudible. **This means the worklet expects MIDI note numbers as frequency values, which is wrong unless `triggerSynth` converts MIDI → Hz before posting.** Looking at `audioBackend.triggerSynth(track, time, midi, vel, dur, ...)` — the interface says `midi: number`. So either the conversion happens in `WorkletEngine.triggerSynth` (not audited) or there's a latent bug. **Requires verification.**

**MIDI input (keyboard):** not present in audited files. No `navigator.requestMIDIAccess`, no `onmidimessage` handler. The engine is **composition-driven, not performance-driven.**

**Verdict:** MIDI is a numeric value passed through the API; conversion to frequency is not visible in the audited code. Likely handled in `WorkletEngine` or `psy4EngineV2.triggerSynth`. A standalone sampler device would need an explicit `midiToFreq(midi)` utility (standard formula: `440 * 2^((midi-69)/12)`).

---

## Section 10 — Offline / realtime consistency audit

**Realtime path:** `Psy4EngineNode` → `AudioWorkletNode('psy4-engine')` → `process()` → speakers.

**Offline path:** `offlineRenderer.ts` is **a stub** (Section 5). Returns zero-filled arrays. Does not actually call `OfflineAudioContext.startRendering()`.

**However:** the worklet itself is offline-capable because:
1. It does not depend on wall-clock time (no `Date.now()` in worklet).
2. It uses `currentFrame` (monotonic sample counter) for event scheduling — works identically in `OfflineAudioContext`.
3. The only wall-clock dependency is `performance.now()` for CPU-load monitoring — does not affect audio output.

**Consistency verdict:** IF the offline renderer were implemented correctly (create `OfflineAudioContext`, instantiate `Psy4EngineNode`, load samples, schedule events, call `startRendering()`), the output would be **bit-identical to realtime EXCEPT** for:
1. `Math.random()` in `AcidVoice.trigger` and `TextureVoice.trigger` — non-deterministic.
2. Dynamic voice budget dropping — depends on `performance.now()` measurements, which differ between realtime (under load) and offline (faster-than-realtime). Could cause different voice counts → different output.
3. CPU-load-based voice dropping is a **realtime-only concern** — offline render should disable it.

**To achieve true offline/realtime parity:**
1. Replace `Math.random` with seeded LCG.
2. Add an `offline: true` mode flag that disables voice-budget dropping.
3. Implement a real offline renderer using `OfflineAudioContext.startRendering()`.

---

## Section 11 — Master REUSE / ADAPT / REWRITE / DO NOT PORT table

| Component | File | LOC | Verdict | Reason |
|---|---|---|---|---|
| Sample loader | `sampleBank.ts` | 267 | **REUSE** | Clean, deterministic, decoupled. Replace O(N²) DFT with real FFT; add `dispose()`. |
| Procedural generator | `multisampleGenerator.ts` | 525 | **REUSE** | Deterministic (LCG seeded). Self-contained. Note: currently dead code (not wired to worklet). |
| Audio backend interface | `audioBackend.ts` | 238 | **ADAPT** | Split 26-method interface into 3 focused interfaces. Drop legacy-only methods. |
| Worklet wrapper | `engineWorklet.ts` | 252 | **ADAPT** | Parameterize processor name. Move musical helpers (`notifyNewPhrase`, `triggerDuck`) out. |
| Engine worklet | `psy4-engine.js` | 2576 | **ADAPT** | DSP classes reusable; engine composition needs refactor. Fix: precompute sample-name arrays, replace `Math.random` with LCG, fix `SampleVoice` pan, add anti-aliasing, add loop mode + keyzones. |
| DSP worklets | `psy4-dsp.js` | 486 | **REUSE** | Gold standard. Modular, deterministic, RT-safe. |
| Offline renderer | `offlineRenderer.ts` | 115 | **DO NOT PORT** | Stub. Returns zero-filled arrays. Port only `writeWavFile`. Use forensic renderer instead. |
| Sample manifest (root) | `SAMPLE_MANIFEST.json` | 165 | **REUSE** | Excellent format. Extend to cover all 114 samples. |
| Real samples manifest | `public/samples/real/manifest.json` | 707 | **ADAPT** | Add license/source/author/attribution fields. Currently provenance-bare → legal risk. |
| PSY3 manifest | `public/samples/manifest.json` | 1 | **DO NOT PORT** | Dead file. Bare array, no metadata, not consumed by `sampleBank.ts`. |
| `SampleVoice` class | (in `psy4-engine.js`) | 60 | **ADAPT** | Add cubic interpolation, anti-aliasing filter, loop mode, keyzones, ADSR. Fix pan. |
| Voice pools | (in `psy4-engine.js`) | — | **ADAPT** | Promote to a `VoicePool` class with priority-based stealing. Fix perc/clap counter sharing. |
| Round-robin counters | (in `psy4-engine.js`) | — | **ADAPT** | Deterministic. Fix bugs (perc reuses clap counter, hat_open inconsistent). |
| `SchroederReverb` | (in `psy4-engine.js`) | 75 | **REUSE** | Clean, RT-safe, preallocated buffers. |
| `StereoDelay` | (in `psy4-engine.js`) | 63 | **REUSE** | Clean, RT-safe, ping-pong. |
| `BusProcessor` | (in `psy4-engine.js`) | 55 | **REUSE** | Clean, RT-safe, separate L/R. |
| `MultibandComp` | (in `psy4-engine.js`) | 62 | **REUSE** | LR2 crossovers, per-band comp. Clean. |
| `MasterChain` | (in `psy4-engine.js`) | 100 | **REUSE** | Multiband + glue + sat + LUFS + true-peak. Clean. |
| MIDI path | (scattered) | — | **REWRITE** | No explicit MIDI path exists. Need `midiToFreq`, MIDI input handler, MIDI → MusicalEvent translator. |

---

## Section 12 — Critical findings

### What's reusable (high quality, low coupling)

1. **`psy4-dsp.js`** — six standalone AudioWorklet processors. Deterministic, RT-safe, modular. The gold standard of the codebase. Port as-is.
2. **`sampleBank.ts`** — clean loader with acoustic feature extraction. Decoupled from psy4. Port with minor FFT upgrade.
3. **`multisampleGenerator.ts`** — deterministic procedural sample bank. Self-contained. Port as-is (currently dead code — wire it in).
4. **DSP classes in `psy4-engine.js`** — `MoogLadder`, `BLSaw`, `BLSquare`, `PinkNoise`, `SchroederReverb`, `StereoDelay`, `BusProcessor`, `MultibandComp`, `StereoWidener`, `MasterChain`. All preallocated, RT-safe, deterministic. Port as a DSP primitives library.
5. **`SAMPLE_MANIFEST.json` format** — excellent provenance schema. Extend to all samples.

### What's broken (must fix before porting)

1. **RT violation: per-hit array allocation in `triggerVoice()`.** Every kick/hat/clap/perc trigger does `Object.keys(this.samples).filter(...).filter(...)` — two array allocations + two closures per drum hit, on the audio thread, inside `process()`. Violates the PSY5 RT contract documented in the file header. **Fix:** precompute `kickNames`/`hatNames`/`clapNames`/`percNames` arrays in the `loadSamples` handler; rebuild only when samples change.
2. **Non-determinism: `Math.random()` in `AcidVoice.trigger()` and `TextureVoice.trigger()`.** Breaks reproducible renders. **Fix:** replace with a per-voice LCG seeded from `param` or a session seed.
3. **`offlineRenderer.ts` is a stub.** Returns zero-filled arrays. The "render and measure" tool does not render. **Fix:** implement using `OfflineAudioContext.startRendering()`, or delegate to `forensic/offlineRenderer.ts`.
4. **`SampleVoice` pan is linear, not equal-power** (line 1221). Sonic issue, not RT. **Fix:** use `cos/sin` equal-power pan law.
5. **`SampleVoice` has no anti-aliasing filter for pitch-down.** Aliasing on low notes. **Fix:** add a one-pole LP before decimation, scaled by `playbackRate`.
6. **`SampleVoice` has no loop mode, no ADSR, no keyzones.** Cannot sustain samples for pads/leads — that's why bass/lead samples are explicitly marked "not yet used in worklet" in `SAMPLE_MANIFEST.json`. **Fix:** add loop points, ADSR, and a keyzone map for multi-sample instruments.
7. **Voice stealing is naive** (`pool[0]` = oldest). Will click on sustained material. **Fix:** priority-based stealing with envelope-aware cut (steal voice in release phase, or fastest-decaying).
8. **Round-robin bug:** `V_PERC` reuses `rrCounters.clap` (line 2224). Perc selection depends on clap hit count. **Fix:** add `rrCounters.perc`.
9. **Round-robin inconsistency:** `V_HAT_OPEN` uses per-hit RR; `V_HAT` (closed) uses phrase-lock. **Fix:** unify on phrase-lock with optional per-hit RR override.
10. **Likely MIDI/frequency bug:** `triggerVoice` for `V_BASS` passes `note` (MIDI) as `freq` to `BassVoice.trigger`, which uses it as Hz. Either the conversion happens upstream (not visible) or low notes are inaudible. **Requires verification.**

### What's missing (must build)

1. **No `VoicePool` class.** Pools are plain arrays with inline `getFreeVoice`. No priority, no stealing policy, no stats. **Build:** a generic `VoicePool<TVoice>` with configurable stealing policy.
2. **No multi-sample / keyzone support.** Single sample per voice. Cannot build a real multi-sampled instrument (e.g., 4 velocity layers × 12 pitch zones for a piano). **Build:** a `KeyzoneMap` that selects a sample based on `(midi, velocity)`.
3. **No loop mode.** One-shot playback only. **Build:** loop points (`loopStart`, `loopEnd`) with forward/alternate loop modes.
4. **No sample streaming.** All samples loaded into memory at startup (~108 samples × ~0.3s × 44100 × 4 bytes ≈ 5.7 MB — acceptable). For larger libraries, need incremental loading. **Build:** an LRU cache with on-demand decode.
5. **No MIDI input path.** Engine is composition-driven only. **Build:** `navigator.requestMIDIAccess` handler → `MusicalEvent` translator.
6. **No provenance for 108 real samples.** `public/samples/real/manifest.json` has only `file`/`category`/`subcategory`. **Build:** extend with `source`, `author`, `license`, `attribution`, `dateAcquired`, `usageRestrictions`. Re-license or remove unverified samples.
7. **No offline/realtime parity test.** No test that renders the same event stream offline and realtime and compares outputs. **Build:** a bit-exact parity test (after fixing `Math.random` and disabling voice-budget dropping).

---

**End of audit.** No code modified. No files changed. Report only.
