# Task S1 — Advanced Synthesis Voices (FM + Supersaw + Wavetable)

**Agent**: Z.ai Code (Synthesis track)
**Task**: Build advanced synthesis voices (FM, supersaw, wavetable) and integrate
them into `Psy4EngineV2`, replacing the thin `PooledSynthVoice` (2 osc + 1 filter)
that made timbres sound "thin and digital".

## CRITICAL CONTEXT (read first)
- ROAST-3 in `worklog.md` identified that synthesis was stuck on 2-osc basic
  waveforms (saw/square/sine/triangle). Commercial psytrance uses:
  - **FM** for metallic goa leads (squelchy, alien timbres)
  - **Supersaw** for rich pads (thick, anthemic)
  - **Wavetable** for evolving textures (morphing beds)
- The DSP file `src/lib/studio/dsp/wavetable.ts` existed but was NOT used by
  the playing engine.
- The playing engine is `Psy4EngineV2` in `psy4EngineV2.ts` (NOT the worklet
  path — `psy4LiveEngine.ts` was deleted as dead code in Task F7).

## STEP 1: Audit PooledSynthVoice

Read `psy4EngineV2.ts` lines 278-373 (PooledSynthVoice class).
- API: `noteOn(preset, when, midi, vel, stepDur, bus)`, `panic(ctx)`.
- Synthesis: 2 OscillatorNodes (wave1 + wave2) → 1 BiquadFilterNode → VCA.
- Pool: 20 voices. Per-voice: 2 osc + 2 gain + 1 filter + 1 VCA + 1 LFO + 1 lfoGain.
- Limitation: only basic waveforms, no FM, no supersaw, no wavetable.

## STEP 2: Build AdvancedSynthVoice

**File created**: `src/lib/studio/engine/advancedVoice.ts` (425 lines)

### Architecture (all nodes preallocated + persistent — zero per-note allocation)
```
osc[0..6]  → oscGain[0..6]  → pan[0..6]  → sum → filter → vca → bus
osc[1]     → modGain → osc[0].frequency            (FM modulation path)
lfo        → lfoCutoffGain → filter.frequency       (cutoff LFO, classic)
lfo        → lfoGainA → oscGain[0].gain             (wavetable crossfade +)
lfo        → lfoGainB → oscGain[1].gain             (wavetable crossfade -)
```

Inactive branches are silenced by setting their gain to 0, so a single voice
graph serves all 4 modes (classic / fm / supersaw / wavetable).

### Per-voice node budget
- 7 OscillatorNodes (max — used by supersaw mode)
- 7 GainNodes (per-osc gain)
- 7 StereoPannerNodes (per-osc pan — for supersaw stereo spread)
- 1 sum GainNode
- 1 BiquadFilterNode (filter — common to all modes)
- 1 VCA GainNode (amplitude envelope — common)
- 1 modGain GainNode (FM modulation depth)
- 1 LFO OscillatorNode
- 3 LFO-controlled GainNodes (lfoCutoffGain, lfoGainA, lfoGainB)

Total per voice: ~28 nodes. With 20 voices: ~560 nodes preallocated ONCE at
`init()` — zero per-note allocation. Voice stealing reuses nodes; only AudioParam
values change per noteOn.

### SynthMode types
```ts
export type SynthMode = 'classic' | 'fm' | 'supersaw' | 'wavetable';

export interface AdvancedSynthPreset extends SynthPreset {
  mode: SynthMode;
  // FM params
  fmRatio?: number;      // carrier:modulator ratio
  fmDepth?: number;      // modulation index (0-8)
  fmEnvAmount?: number;  // envelope affects FM depth (0-1)
  // Supersaw params
  sawCount?: number;     // 2-7 oscillators
  sawDetune?: number;    // cents spread
  sawSpread?: number;    // stereo spread (0-1)
  // Wavetable params
  wtPosition?: number;   // 0-1 wavetable scan position
  wtMorphRate?: number;  // Hz, LFO rate that modulates the position
  wtPair?: number;       // index into WAVETABLE_PAIRS
}
```

### FM synthesis (`triggerFM`)
- Carrier: `osc[0]` sine at note frequency (audible)
- Modulator: `osc[1]` sine at carrier × fmRatio (NOT audible — gain=0)
- FM path: `osc[1] → modGain → osc[0].frequency`
- Modulation depth envelope: 0 → peak (depth × vel × 1000 Hz) → sustain (peak × sus × envAmt) → release
- fmRatio presets: 0.333 (warm), 0.5 (squelch), 2 (bell), 3 (metal)
- This is what gives goa/acid leads the metallic, squelchy, alien character.

### Supersaw synthesis (`triggerSupersaw`)
- N sawtooth oscillators (2-7, default 5)
- Detune pattern: symmetric around 0 (-detune, ..., 0, ..., +detune)
- Pan pattern: -spread ... +spread (stereo width)
- Per-osc gain: 1/√N (normalization to prevent clipping)
- Inspired by Roland JP-8000 — thick, rich, anthemic timbres.

### Wavetable synthesis (`triggerWavetable`)
- 2 OscillatorNodes with PeriodicWaves from a 8-recipe bank (sine, saw, square, bright, warm, formant, clang, shimmer)
- 6 crossfade pairs (e.g., sine↔saw, formant↔clang, sine↔shimmer)
- Static crossfade based on `wtPosition` (osc0 gain = 1-pos, osc1 gain = pos)
- LFO modulates the crossfade inversely: lfoGainA (positive) → osc0, lfoGainB (negative) → osc1
- LFO rate = wtMorphRate (0.01-8 Hz)
- morphDepth bounded to 0-0.4 to avoid negative gain artifacts
- PeriodicWaves cached per-AudioContext via WeakMap (zero duplication across voices).

### PeriodicWave bank
8 harmonic recipes (mirror of `dsp/wavetable.ts` WAVETABLE_BANK, but as PeriodicWave objects):
- sine, saw, square, bright, warm, formant, clang, shimmer
- 6 crossfade pairs for wavetable mode variety.

## STEP 6: ADVANCED_PRESETS

13 world-appropriate presets covering all 4 modes:

### FM presets (metallic goa/acid leads)
- `PS-FM-GOA`: fmRatio=0.333, fmDepth=4, fmEnvAmount=0.8 — warm goa lead
- `PS-FM-BELL`: fmRatio=2, fmDepth=2, fmEnvAmount=0.5 — bell-like
- `PS-FM-SQUELCH`: fmRatio=0.5, fmDepth=6, fmEnvAmount=1.0 — full squelch
- `PS-FM-METAL`: fmRatio=3, fmDepth=5, fmEnvAmount=0.7 — metallic

### Supersaw presets (thick pads / anthemic leads)
- `PS-SUPERSAW-PAD`: 7 osc, sawDetune=18, sawSpread=0.8, slow attack — thick pad
- `PS-SUPERSAW-LEAD`: 5 osc, sawDetune=12, sawSpread=0.5, fast attack — anthem lead
- `PS-SUPERSAW-WIDE`: 6 osc, sawDetune=22, sawSpread=1.0, LFO cutoff — wide evolving

### Wavetable presets (evolving textures)
- `PS-WT-EVOLVE`: wtPosition=0.3, wtMorphRate=0.2, slow attack — evolving bed
- `PS-WT-MORPH`: wtPosition=0.5, wtMorphRate=0.5, mid attack — morphing texture
- `PS-WT-PSYCH`: wtPosition=0.5, wtMorphRate=1.0, faster — psychedelic movement

### Classic presets (backwards compatible)
- `PS-CLASSIC-LEAD`: classic 2-osc sawtooth+square
- `PS-CLASSIC-BASS`: classic 2-osc bass

### Lookup helper
`getAdvancedSynthPreset(id, classicPresets)`:
- Returns ADVANCED_PRESETS[id] directly if found (already has `mode`).
- Else wraps classicPresets[id] with `mode='classic'` for backwards compat.
- Else returns null.

## STEP 7: Integration into psy4EngineV2.ts

### Removed
- `PooledSynthVoice` class (lines 278-373, ~95 lines) — replaced by imported `AdvancedSynthVoice`.

### Changed
- `synthPool: PooledSynthVoice[]` → `synthPool: AdvancedSynthVoice[]`
- `new PooledSynthVoice(c)` → `new AdvancedSynthVoice(c, i)` (passes voiceIdx for wavetable pair rotation)
- `triggerSynth()`:
  - Preset lookup changed from `SYNTH_PRESETS[id]` to `getAdvancedSynthPreset(id, SYNTH_PRESETS)`.
  - `preset` and `p` types changed from `SynthPreset` to `AdvancedSynthPreset`.
  - **synthModeOverrides applied**: if `synthModeOverrides[trackIdx]` is set and differs from preset's mode, replace mode and fill in default mode-specific params (fmRatio, sawCount, wtPosition, etc.) only when undefined.
  - **fmDepthOverride applied**: if `>0` and `p.mode === 'fm'`, override `p.fmDepth`.
  - **wtPositionOverride applied**: if `>=0` and `p.mode === 'wavetable'`, override `p.wtPosition`.
  - All existing logic (world timbre, reference pursuit centroid, bass decay, learned params) preserved — runs on top of the new advanced preset.

### `applyWorldPresets()` updated for advanced synthesis
| Track | Old preset | New preset | Why |
|-------|-----------|------------|-----|
| 0 KICK | PS-KICK-TIGHT/DEEP | (unchanged) | drums not in scope |
| 4 BASS | PS-BASS-ROLL/DEEP | (unchanged) | bass stays classic — doesn't need FM |
| 5 LEAD | PS-LEAD-SQUELCH/FMTEX | **PS-FM-GOA** (acid), **PS-FM-SQUELCH** (dark), **PS-FM-BELL** (bright) | metallic goa leads |
| 6 PAD | PS-PAD-PSYCH | **PS-SUPERSAW-PAD** | thick rich 7-osc supersaw pad |
| 7 ARP | PS-ARP-ACID | **PS-WT-MORPH** | evolving wavetable texture |

## STEP 8: Real-time control surface (public methods)

Added 4 new public methods to `Psy4EngineV2`:

```ts
setSynthMode(trackIdx: number, mode: SynthMode | null): void
setFMDepth(depth: number): void                    // 0-8, 0 = no override
setWavetablePosition(pos: number): void             // 0-1, -1 = no override
getSynthModeOverrides(): Record<number, SynthMode>  // for UI display
```

Use cases (called by reference pursuit):
- Radio has metallic FM content → `setSynthMode(5, 'fm')` flips leads to FM.
- Radio has rich saw content → `setSynthMode(5, 'supersaw')` for anthemic leads.
- Radio has evolving textures → `setSynthMode(6, 'wavetable')` for morphing pads.
- Radio is brighter/more metallic → `setFMDepth(6)` deepens FM modulation.
- Radio is darker → `setWavetablePosition(0.2)` skews toward sine/warm.

## CONSTRAINTS — all satisfied

- ✅ Did NOT break existing patterns, reference pursuit, or style detection.
  - `triggerSynth` signature unchanged (same 7 params: trackIdx, time, midi, vel, stepDur, dur, timbre).
  - `triggerDrum` unchanged.
  - All public APIs preserved (liveTrack, selfTrack, applyMusicalUnderstanding, setWorld, getPursuitStatus, etc.).
  - Reference pursuit blending (centroid → cutoff, bass decay → gate) runs ON TOP of advanced presets.
  - Learned params from ContinuousTrainer still apply.
- ✅ AdvancedSynthVoice is a drop-in replacement: same `noteOn(preset, when, midi, vel, stepDur, bus)` and `panic(ctx)` API.
- ✅ Voice pool: 20 voices. Max 7 osc per voice = 140 osc total. Well within modern browser limits.
- ✅ All Web Audio nodes (no ScriptProcessor, no AudioWorklet).
- ✅ TypeScript strict mode — zero errors.

## Verification

- `cd /home/z/my-project && npx tsc --noEmit --skipLibCheck 2>&1 | grep -E "advancedVoice|psy4EngineV2"` → **EMPTY** (zero errors in both files).
- `cd /home/z/my-project && npx eslint src/lib/studio/engine/advancedVoice.ts src/lib/studio/engine/psy4EngineV2.ts --max-warnings=999` → **EXIT 0** (zero errors, zero warnings).
- Pre-existing errors in unrelated files (artifacts/, audit/, dsp/, forensic/, scripts/, skills/) are not affected by this task.

## Files Touched

| File | Change | Lines |
|------|--------|-------|
| `src/lib/studio/engine/advancedVoice.ts` | **NEW** — AdvancedSynthVoice class, ADVANCED_PRESETS, getAdvancedSynthPreset | 425 |
| `src/lib/studio/engine/psy4EngineV2.ts` | Removed PooledSynthVoice (~95 lines); added AdvancedSynthVoice import; synthPool typed as AdvancedSynthVoice[]; triggerSynth uses AdvancedSynthPreset + overrides; applyWorldPresets uses FM/supersaw/wavetable presets; added setSynthMode/setFMDepth/setWavetablePosition/getSynthModeOverrides | +120 / -95 |

## Expected Audible Results

- **Goa leads**: metallic, squelchy, alien timbres from FM synthesis (fmRatio 0.333, depth 4-6).
- **Dark-psy leads**: full squelch from PS-FM-SQUELCH (fmRatio 0.5, depth 6, envAmt 1.0).
- **Bright leads**: bell-like character from PS-FM-BELL (fmRatio 2, depth 2).
- **Pads**: thick, rich, wide supersaw (7 detuned saws with stereo spread 0.8).
- **Arp/textures**: evolving wavetable morph (LFO at 0.5 Hz crossfading between formant and clang waves).
- **Bass**: unchanged (classic 2-osc — bass doesn't need FM/supersaw/wavetable).
- **Reference pursuit can dynamically switch modes**: e.g., if the radio plays
  an FM-metallic lead, `setSynthMode(5, 'fm')` flips leads to FM synthesis in
  real time without restarting the engine or changing world presets.

## REMAINING GAP (honest)

- **PHYSICAL LISTENING UNVERIFIED** — verification is via TypeScript + ESLint
  pass and code audit. Cannot run the dev server in this environment to
  actually hear the output. The AdvancedSynthVoice graph is well-formed and
  the integration is non-breaking, but the audible character of each mode
  (FM metallic, supersaw thickness, wavetable evolution) is asserted by
  construction, not by listening.
- The reference pursuit does NOT yet auto-detect FM/supersaw/wavetable
  content from the radio. The `setSynthMode` / `setFMDepth` /
  `setWavetablePosition` methods are exposed for the pursuit agent to call,
  but no agent currently calls them. Wiring this requires extending
  `styleClassifier.ts` or `referenceListener` to detect FM content (e.g.,
  via inharmonicity analysis) — that's a separate task.
- The wavetable bank uses 8 PeriodicWave objects created via
  `createPeriodicWave(real, imag)`. These are additive-synthesis approximations
  of the waveforms in `dsp/wavetable.ts`, not actual interplated wavetable
  scanning. For more authentic wavetable morphing, a future task could
  implement per-sample wavetable interpolation in an AudioWorklet.
