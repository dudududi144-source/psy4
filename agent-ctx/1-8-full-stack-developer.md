# Task ID: 1-8 — Track A: World-driven pattern engine

**Agent:** full-stack-developer
**Date:** 2025-01-10
**File modified:** `src/lib/studio/engine/psy4EngineV2.ts`

## Context

Read `/home/z/my-project/worklog.md` (especially ROAST-2 section). The problem:
`Psy4EngineV2.scheduleStep()` had HARDCODED patterns (four-on-floor kick, fixed bass
patterns, fixed lead/pad/arp motifs) that IGNORED the `worldId` parameter. The rich
world definitions in `worlds.ts` (10 worlds with TimbrePreset, scales, patterns,
energyCurve, etc.) were disconnected.

## What I did

### 1. Imports
- Added `BASS_PATTERNS, PROGRESSIONS, scaleNote, mtof` to the existing
  `musicalGrammar` import.
- Added `WORLDS, WorldId, World` import from `./worlds`.
- Removed local `SCALES`, `mtof`, `scaleNote` duplicates (the imported versions
  support ALL world scales including phrygianDominant, harmonicMinor,
  doubleHarmonic, minorPentatonic — the local SCALES only had 4 scales).

### 2. New fields
- `private currentWorld: World = WORLDS['dark-psy']` — the active world config.
- `private arpIdx = 0` — rotates through 4 arp shapes.
- `private bassPatternIdx = 0` — rotates through BASS_PATTERNS entries.
- Reused existing `musicRng` (SeededRng) and `leadMotif` (LeadMotif) fields —
  no duplication.

### 3. start(worldId?) — world-driven configuration
- `this.currentWorld = WORLDS[worldId as WorldId] || WORLDS['dark-psy']`
- `this._bpm = this.currentWorld.defaultBpm` (e.g., dark-psy=150, progressive=128)
- `this.musicalKey = { root: midpoint of rootRange, scale: defaultScale }`
- Calls `this.refreshMusicalGenerators()` to re-create LeadMotif/AcidPattern
  with the world's key.
- Applies `this.currentWorld.fxMix` to `reverbSend` and `delaySend` gains.

### 4. tick() — section boundary evolution
- Calls `this.leadMotif?.evolve()` at section boundaries for musical evolution.
- Mutates arp shape (`arpIdx`) at section boundaries, rate controlled by
  `world.evolutionRate`.
- Rotates bass pattern (`bassPatternIdx`) every 4 bars for variation.

### 5. scheduleStep() — FULLY REWRITTEN to be world-driven
- **Energy:** computed from `world.energyCurve[bar/section.bars * length]`
  clamped, modulated by `section.density`.
- **Swing:** offbeat steps (step%2===1) delayed by `world.swing * halfStep`.
- **KICK:** parses `world.kickPattern` (16-char gate string). Plays when
  `charAt(step) === 'x'`. Velocity: downbeat = `0.5 + density*0.4*aggressionBoost`,
  others = `0.4 * aggressionBoost` (aggression from `world.aggression`).
- **CLAP:** backbeat on steps 4/12, gated by `section.density > 0.4`.
- **HATS:** probability = `world.hatDensity * (0.5 + 0.5*energy) * tScale`
  per eligible offbeat. Uses `musicRng.chance()` (deterministic, not Math.random).
- **PERC:** probability = `world.percDensity * energy * tScale`.
- **BASS:** parses `world.bassPattern` gate string. Derives bass style from
  world id: `dark`/`forest` → `roll`, `goa`/`acid` → `acid`, else → `off`.
  Uses `BASS_PATTERNS[style]` with 8-step patterns (root/fifth/octave scale
  degrees). Rotates patterns every 4 bars. Applies accent velocity.
- **LEAD:** uses `LeadMotif.nextNote(step, bar, energy, rng)` with AABA
  structure. Only plays when `section.lead && energy > 0.35`.
- **PAD:** chord progression from `PROGRESSIONS[scale]` (imported). Plays
  chord root + fifth on step 0 of each bar in drops.
- **ARP:** 4 arp shapes (scale degree arrays), rotates based on
  `world.evolutionRate`. Probability = `0.7 * energy`.
- **SHAKER:** offbeat in drops, probability = `0.4 * energy * tScale`.
- All drum/synth triggers use `stepTime` (swing-adjusted) instead of raw `time`.
- RISER and IMPACT FX use raw `time` (not swung).

### 6. triggerSynth() — timbre overrides
- Added optional `timbre?: { cutoff?: number; res?: number; drive?: number }`
  parameter.
- Applies world timbre overrides on top of factory preset: cutoff and res
  (resonance) are clamped and applied. Drive scales velocity
  (`driveBoost = drive/1.5`, clamped 0.5–1.8).
- Reference pursuit (spectral centroid matching, bass decay matching) still
  works — applied ON TOP of world timbre overrides.
- Sub-oscillator for bass also gets `driveBoost` applied to its gain.

### 7. World timbre modulation
Pre-computed per step in scheduleStep:
- **leadTimbre:** `cutoff * (0.7 + 0.6 * brightness)`, `res = 2 + resonance * 12`
- **bassTimbre:** `cutoff * (0.7 + 0.6 * (1 - darkness))` (darker worlds = darker bass)
- **padTimbre:** `cutoff * (0.6 + 0.8 * brightness)`
- **arpTimbre:** `cutoff * (0.7 + 0.6 * psychedelia)` (uses textureTimbre as base)

### 8. deriveBassStyle() helper
- `dark` or `forest` in id → `'roll'` (rolling psy bass)
- `goa` or `acid` in id → `'acid'` (acid bass with ghost notes)
- else → `'off'` (offbeat bass with rests)

## API preserved
All existing methods still work: `start(worldId?)`, `stop()`, `setBpm()`,
`applyMusicalUnderstanding()`, `liveTrack()`, `selfTrack()`, `setWorld()`,
`getAnalyser()`, `getMusicalKey()`, `getOwnLufs()`, `getPursuitStatus()`.

## Verification
- `npx tsc --noEmit`: ZERO errors in psy4EngineV2.ts (all TS errors are in
  other pre-existing files).
- `bun run lint`: ZERO errors/warnings in src/ (all lint issues are in
  .vercel/output build artifacts).
- Dev server: ✓ Compiled successfully.

## Audible differences: dark-psy vs progressive-psy
| Parameter        | dark-psy          | progressive-psy    |
|-----------------|-------------------|--------------------|
| BPM             | 150               | 128                |
| Scale           | phrygian          | dorian             |
| Bass style      | roll (8 hits/bar) | off (4 hits/bar)   |
| Hat density     | 0.55              | 0.35               |
| Perc density    | 0.45              | 0.25               |
| Swing           | 0.03              | 0.08               |
| Lead cutoff     | 1800*0.91=1638    | 2200*1.03=2266     |
| Bass cutoff     | 420*0.82=344      | 550*0.91=501       |
| Energy curve    | 0.5–0.95          | 0.3–0.9            |
| Aggression      | 0.75              | 0.35               |
| Darkness        | 0.8               | 0.35               |
| FX mix          | 0.35              | 0.30               |

These produce AUDIBLY different music: different tempo, different scale/notes,
different bass pattern (rolling vs syncopated), different timbres (darker vs
brighter), different swing feel, different energy arcs.
