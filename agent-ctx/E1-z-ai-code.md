# Task E1 — Effects track (Chorus/Phaser/Distortion/Bitcrush + multiband + per-track EQ)

**Agent**: Z.ai Code (Effects track)
**Task ID**: E1
**Date**: 2024 (parallel with M1 Melody + S1 Synthesis agents)

## Context

Per ROAST-3 (worklog tail), the PSY4 engine had rich DSP code in `dsp/effects.ts` (Chorus, Phaser, Distortion, Bitcrush, ShimmerReverb, FeedbackDelay, Limiter) that was 100% DISCONNECTED — zero imports from the engine. The engine used only basic Web Audio nodes (1 ConvolverNode, 1 DelayNode, 1 WaveShaperNode, 1 DynamicsCompressorNode, BiquadFilter HPFs only). Output sounded flat and lifeless.

This task wires the existing effects + adds the missing mixing tools (per-track EQ/comp/saturation/stereo-widener, send buses, multiband master compression).

## What I did

### 1. Read existing assets
- `dsp/effects.ts`: all classes are sample-by-sample processors (`process(input)` / `processStereo(inL, inR)` methods), NOT AudioNodes. Cannot be wired into a live Web Audio graph — must build Web Audio equivalents.
- `psy4EngineV2.ts`: per-track chain was just `GainNode → HPF → StereoPanner → master`. No per-track glue, no sends beyond basic reverb/delay.

### 2. Created `src/lib/studio/engine/effectsRack.ts`
- `TrackEffectsRack` class — per-track insert chain:
  ```
  input → EQ (low shelf / mid bell / high shelf) → Compressor → Saturation (parallel wet/dry) → Haas widener (ChannelMerger + DelayNode) → StereoPanner → output
  ```
- 6 post-fader send taps: reverb, delay, chorus, phaser, distortion, bitcrush.
- `TrackRackConfig` interface: 22 fields (EQ, comp, sat, pan, Haas, output, 6 sends).
- `setParameter(name, value)` for real-time automation of every parameter.
- `connectSend(name, bus)` wires a send tap to an external send-bus input.
- NaN/undefined guards via `safeNum()`. All clamps bounded.
- Haas widener: mono → split L (dry) + R (delayed 5-25ms) → ChannelMerger → stereo. `useHaas` flag + `haasMix` crossfade. Only melodic tracks (LEAD/PAD/ARP) enable Haas.

### 3. Created `src/lib/studio/engine/sendEffects.ts`
Web Audio equivalents of the sample-based effects.ts classes:
- **ChorusSend**: 2 parallel modulated delay lines (5-15ms) with phase-offset LFOs, hard-panned L/R.
- **PhaserSend**: 6-stage BiquadFilter('allpass') cascade + LFO + ConstantSource offset + feedback loop.
- **DistortionSend**: WaveShaper with asymmetric hard-clip curve (tanh positive, harder cubic negative) + tone lowpass.
- **BitcrushSend**: stair-step WaveShaper curve (2^N levels) + sample-and-hold via DelayNode modulated by square-wave LFO. (Not a mathematically exact bitcrusher — no AudioWorklet — but gives the lo-fi texture.)
- Each exposes `input` (mono, sums many rack sends) and `output` (stereo, → return gain → master).
- `setParameter(name, value)` for real-time automation.
- `dispose()` stops internal LFOs.

### 4. Created `src/lib/studio/engine/multibandCompressor.ts`
- `MultibandCompressor` class — 3-band crossover:
  - LOW: 2× lowpass @ 200Hz (24 dB/oct) → lowComp (4:1, -18 dB) → lowMakeup
  - MID: 2× highpass @ 200Hz + 2× lowpass @ 2000Hz → midComp (3:1, -20 dB) → midMakeup
  - HIGH: 2× highpass @ 2000Hz → highComp (2:1, -22 dB) → highMakeup
- Sum back to mono/stereo output.
- `setParameter(name, value)` for all 17 params (crossovers + 5 params × 3 bands).

### 5. Integrated into `psy4EngineV2.ts`

**Added imports**: TrackEffectsRack, TrackRackConfig, ChorusSend, PhaserSend, DistortionSend, BitcrushSend, MultibandCompressor.

**Added `buildTrackRackConfigs(world)` factory** — returns 8 TrackRackConfigs:
- KICK: mono, 6:1 comp, no sends, +2.5 dB low shelf, -3 dB mid cut @ 350Hz.
- SNARE/CLAP: stereo, 4:1 comp, reverb 0.28, +3 dB high shelf.
- HATS: stereo, 3:1 comp, reverb 0.16, -8 dB low cut, +2.5 dB high shelf.
- PERC: stereo, 3:1 comp, reverb 0.22, pan -0.25.
- BASS: mono, 3:1 comp, reverb 0.06 only, +2.5 dB low shelf, -1.5 dB high cut.
- LEAD: stereo + Haas (11ms), chorus 0.3, phaser 0.25, distortion 0.1, reverb 0.25, delay 0.22.
- PAD: stereo + wide Haas (17ms, mix 0.7), chorus 0.38, reverb 0.38.
- ARP: stereo + Haas (9ms), chorus 0.26, phaser 0.22, delay 0.26.

Per-world modulations layered on top:
- dark-psy/forest: +0.25 distortion + 0.12 bitcrush on lead, +0.15 phaser on arp, 0.08 bitcrush on pad.
- goa/acid-psy: +0.3 phaser on lead, +0.25 phaser on arp, +0.15 chorus on pad.
- morning/cosmic/organic: +0.2 chorus on melodic, +0.1 reverb on pad.
- deep/hypnotic: half chorus/phaser, third distortion (minimal).
- Aggression → distortion boost. Psychedelia → phaser+chorus boost.

**Modified `init()`**:
- Built MultibandCompressor (200Hz / 2000Hz crossovers, 4:1/3:1/2:1 ratios).
- Built 4 send effect instances + bus input GainNodes + return GainNodes → master.
- Rewired master chain: `master → saturator → toneLow → toneHigh → multiband → comp (safety limiter, -3 dB / 3:1 / 2ms attack) → analyser → destination`.
- Replaced per-track chain loop with TrackEffectsRack creation:
  - `chains[i] = rack.input` (backwards compat — voices connect here)
  - `trackGains[i] = rack.output` (backwards compat — liveTrack/setWorld adjust this)
  - `rack.output → (duckGain for bass | master for others)` (preserves bass sidechain)
  - All 6 send taps wired to global send buses via `rack.connectSend(name, bus)`.

**Modified `start()` and `switchWorld()`**:
- Both now call `applyWorldEffectSettings(this.currentWorld)` after `applyWorldPresets()`.
- `applyWorldEffectSettings()` rebuilds per-track rack configs for the new world, pushes the 6 send levels via smooth ramps (0.05s), AND nudges global send-effect parameters (chorus rate, phaser rate+feedback, distortion drive, bitcrush bits+hold) based on world character.

### 6. Added public automation API
- `setTrackEffect(trackIdx, effectName, value)` — routes to rack.setParameter. Recognizes 20+ parameter names.
- `setSendLevel(trackIdx, sendName, level)` — convenience for sends.
- `setSendEffectParam(effectName, param, value)` — global send-effect params.
- `setMasterParam(name, value)` — multiband params.

## Constraints honored

- Did NOT touch World API, reference pursuit (liveTrack/selfTrack), style classifier / auto-switch, ContinuousTrainer, applyWorldPresets(), MelodyEngine, AdvancedSynthVoice, or per-world pattern engine. All public methods + field names preserved.
- `chains[]` and `trackGains[]` remain `GainNode[]` for backwards compat.
- Bass duckGain sidechain preserved (`rack.output → duckGain → master` for track 4).
- All Web Audio nodes (no ScriptProcessor, no AudioWorklet).
- TypeScript strict mode passes.
- NaN/undefined guarded throughout. All numeric config fields clamped.
- Efficient: ~235 nodes total (8 racks × ~20 + 4 sends × ~10 + multiband ~15).

## Beneficial side-effect (latent bug fix)

Previously `trackGains[4]` (bass) was a GainNode that was created but NEVER wired into the graph (bass went `panner → duckGain → master` directly, bypassing the gain). So `liveTrack()`'s `trackGains[4].gain.setTargetAtTime()` was a silent no-op. Now `trackGains[4] = racks[4].output` which IS in the graph, so the bass level adjustments actually take effect — the reference pursuit's sub-energy balancing now works on bass.

## Verification

- `npx tsc --noEmit --skipLibCheck 2>&1 | grep -E "effectsRack|psy4EngineV2|sendEffects|multibandCompressor"` → ZERO matches (all four files clean).
- `npx eslint src/lib/studio/engine/effectsRack.ts src/lib/studio/engine/sendEffects.ts src/lib/studio/engine/multibandCompressor.ts src/lib/studio/engine/psy4EngineV2.ts --max-warnings=999` → EXIT 0.
- Dev server compiles cleanly.
- Pre-existing TS errors in OTHER files (proAudioNodes, continuousTrainer, perVoiceAnalyzer, referenceListener, renderWorker, selfAnalyzer, tests) unchanged.

## Files touched

- NEW: `src/lib/studio/engine/effectsRack.ts` (468 lines)
- NEW: `src/lib/studio/engine/sendEffects.ts` (519 lines)
- NEW: `src/lib/studio/engine/multibandCompressor.ts` (224 lines)
- MODIFIED: `src/lib/studio/engine/psy4EngineV2.ts` (added imports, buildTrackRackConfigs factory, new fields, init() rewrite, applyWorldEffectSettings, setTrackEffect, setSendLevel, setSendEffectParam, setMasterParam; calls from start() and switchWorld())

## Coordination with parallel agents

- M1 (Melody) agent was concurrently replacing LeadMotif with MelodyEngine and editing the same file. My edits didn't touch the melodic generation code — only the audio-graph init() and per-track chain. No conflicts observed.
- S1 (Synthesis) agent was concurrently replacing PooledSynthVoice with AdvancedSynthVoice. My `chains[i] = rack.input` approach is voice-agnostic — works with any voice class that accepts a bus GainNode. No conflicts observed.
- Both agents' imports are preserved at the top of psy4EngineV2.ts alongside mine.
