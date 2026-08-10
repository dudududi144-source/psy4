# Task V2 — Final polish (scheduler → Worker, section automation, melody-harmony sync)

**Agent:** Z.ai Code
**Date:** (this run)
**Task ID:** V2
**Spec source:** user prompt — "Final polish — scheduler to Worker, section automation, melody-harmony sync"

## TL;DR

Three confirmed gaps from the post-ROAST-3 audit are now closed:

1. **V2a — Scheduler moved to a Web Worker.** New `SchedulerWorker` class wraps an inline Blob-URL Worker that posts `{type:'tick'}` messages from a separate thread. `psy4EngineV2.scheduleNextTick()` now registers `onTick = () => this.tick()` and calls `scheduler.start(15)`. SSR/old-browser fallback is automatic. Reduces main-thread jitter (React renders, GC, layout, HTML5 4ms setTimeout clamp no longer affect the musical clock).
2. **V2b — Section-based effects automation.** New `applySectionAutomation(section, bar, step)` method (called every step from `scheduleStep`) pushes per-section send levels (reverb/delay/chorus/phaser) on section changes via `setSendLevel` (smooth `setTargetAtTime(0.05s)` ramps). BUILD section gets a per-step lead filter sweep 800 Hz → 4000 Hz across the last 2 bars via `setTrackEffect(5, 'cutoff', value)`. BREAK section gets a closing sweep 1800 Hz → 600 Hz. Section profiles match the spec: INTRO washes, DROP stays punchy, BREAK washes hard, VARIATION gets echo throws.
3. **V2c — Melody-harmony synchronization.** `MelodyEngine.setHarmonyEngine(harmony)` links the melody to the live harmony engine. In `nextNote()`, on strong beats (`step % 4 === 0`), the lead's note is snapped to the nearest chord tone of the LIVE chord (via `harmony.getCurrentChord()`). Eliminates dissonance — the lead always harmonizes with the pad on strong beats. Link is established at engine init and re-established on every key change.

## Files touched

| File | Status | Lines |
|------|--------|-------|
| `src/lib/studio/engine/schedulerWorker.ts` | NEW | ~200 |
| `src/lib/studio/engine/psy4EngineV2.ts` | extended | +~210 |
| `src/lib/studio/engine/melodyEngine.ts` | extended | +~110 |

## Implementation details

### V2a — `schedulerWorker.ts`

- **Inline Worker via Blob URL** — no separate `public/workers/` file. The worker source is a tiny string with three message types: `start`, `stop`, `setInterval`. Uses worker-internal `setInterval(15ms)` (not chained `setTimeout`) because the worker thread has no other work, so the HTML5 4ms clamp doesn't apply.
- **Lazy Blob URL creation** — `cachedBlobUrl` is created on first `start()` and reused across start/stop cycles. Guarded with `typeof Blob/URL` checks for SSR safety.
- **`SchedulerWorker` class** — `onTick` callback, `start(intervalMs)`, `stop()`, `setInterval(ms)`, `dispose()`. Worker is created lazily inside `start()` (NOT at construction — SSR-safe module import). If `Worker` is unavailable or `new Worker()` throws (CSP, old browser), falls back to a main-thread `setInterval` and `usesWorker` returns false.
- **Worker `onerror` handler** — if the worker errors (CSP block, blob URL blocked), it tears down and falls back to `setInterval` automatically. The engine keeps running in every environment.
- **Worker kept alive across stop/start** — cheap restart (just post 'start' again). No re-construction cost.

### V2a — `psy4EngineV2.ts` integration

- Imported `SchedulerWorker` from `./schedulerWorker`.
- Added `private scheduler: SchedulerWorker = new SchedulerWorker();`. Kept the legacy `private timer` field for the (currently unused) setTimeout fallback path.
- `scheduleNextTick()` body: `this.scheduler.onTick = () => { this.tick(); }; this.scheduler.start(15);` (was `this.timer = setTimeout(() => { this.tick(); this.scheduleNextTick(); }, 15);`).
- `stop()` calls `this.scheduler.stop()` in addition to the legacy `clearTimeout(this.timer)`.

### V2b — Lead cutoff override plumbing

- New field `private leadCutoffOverride = -1;` — when > 0, overrides the lead's filter cutoff in `triggerSynth` (overrides BOTH world timbre AND reference pursuit blend). -1 = no override.
- Extended `setTrackEffect(trackIdx, effectName, value)`: special-cases `effectName === 'cutoff'` and `trackIdx === 5` (LEAD only — the rack has no filter, so cutoff can't go through `racks[5].setParameter`). Stores in `leadCutoffOverride` (clamped to [200, 16000], or -1 to clear).
- In `triggerSynth`, after the existing timbre + reference pursuit cutoff computation: `if (trackIdx === 5 && this.leadCutoffOverride > 0) { p = { ...p, cutoff: clamp(this.leadCutoffOverride, 200, 16000) }; }`. The `AdvancedSynthVoice.noteOn()` already does an exponential filter sweep (cut*3 → cut over atk+dec*0.7), so the override becomes the baseline cutoff for each note — successive notes with rising override values produce the signature "filter opening" sweep.

### V2b — `ArrangementSection` interface + `applySectionAutomation`

- Exported `interface ArrangementSection { bars: number; density: number; bass: boolean; lead: boolean; label: string; }`.
- Changed `private arrangement = [...]` to `private arrangement: ArrangementSection[] = [...]`.
- Added `private lastAutomationSection = '';` to track the last-applied section label (avoids spamming the audio thread with `setSendLevel` calls every step when the value has already settled).
- `applySectionAutomation(section, bar, step)` — called every step from `scheduleStep()` as the FIRST action (before the rest of the step scheduling). Two parts:
  1. **Static levels** — only re-pushed when `section.label !== this.lastAutomationSection`. Calls `applyStaticSectionLevels(section)` which looks up a per-section profile and pushes reverb/delay/chorus/phaser send levels for melodic (5/6/7) and atmos (1/2/3) tracks. Kick (0) and bass (4) are untouched.
  2. **Per-step filter sweep**:
     - BUILD section, last 2 bars: computes a linear progress (0..1) across 32 steps (2 bars × 16 steps), interpolates exponentially from 800 Hz → 4000 Hz, calls `setTrackEffect(5, 'cutoff', sweepHz)`.
     - Outside a BUILD sweep: clears the override (`leadCutoffOverride = -1`) so the lead reverts to world timbre + reference pursuit cutoff.
     - BREAK section: over the section's bars, exponentially closes the lead cutoff from 1800 Hz → 600 Hz for a "filter closing" release effect.

### V2b — Section profiles

| Section | melReverb | melDelay | melChorus | melPhaser | atmoReverb | atmoDelay | Special |
|---------|-----------|----------|-----------|-----------|------------|-----------|---------|
| INTRO | 0.60 | 0.10 | 0.00 | 0.00 | 0.30 | 0.05 | — |
| GROOVE | 0.40 | 0.20 | 0.15 | 0.10 | 0.22 | 0.10 | leadChorus 0.20 |
| BUILD | 0.35 | 0.30 | 0.20 | 0.15 | 0.25 | 0.18 | **filter sweep 800→4000 Hz (last 2 bars)** |
| DROP | 0.25 | 0.30 | 0.30 | 0.20 | 0.18 | 0.12 | leadChorus 0.35, arpPhaser 0.30 |
| VARIATION | 0.35 | 0.40 | 0.25 | 0.25 | 0.22 | 0.18 | leadChorus 0.25, arpPhaser 0.20 |
| BREAK | 0.70 | 0.50 | 0.10 | 0.10 | 0.50 | 0.30 | **filter close 1800→600 Hz** |
| FINAL DROP | 0.20 | 0.30 | 0.32 | 0.22 | 0.16 | 0.12 | leadChorus 0.38, arpPhaser 0.30 |
| OUTRO | 0.60 | 0.10 | 0.00 | 0.00 | 0.30 | 0.05 | — |

All ramps are smooth — `setSendLevel`/`setTrackEffect` route to `racks[ti].setParameter(...)` which uses `setTargetAtTime(0.05s)` internally. No audio glitches on section changes.

Reset on `start()`: `lastAutomationSection = ''` and `leadCutoffOverride = -1` so the first section's static levels get pushed on the first tick and no leftover sweep from a previous session bleeds in.

### V2c — `melodyEngine.ts`

- Added `import type { HarmonyEngine } from './harmonyEngine';` (type-only — no runtime cycle).
- Added `private harmony: HarmonyEngine | null = null;` field.
- Added `setHarmonyEngine(harmony: HarmonyEngine | null): void` — sets the link. Pass `null` to disable live snapping.
- In `nextNote(step, bar, energy)`: on strong beats (`step % 4 === 0`), if `this.harmony` is set, call `snapToLiveChordTone(midi)`. On weak beats, the original note is preserved (passing tones / neighbor tones are musically valid).
- New private method `snapToLiveChordTone(midi)`:
  - Queries `this.harmony.getCurrentChord()` — if null (no chord has played yet, or outside a lead section), returns the note unchanged (the static PROGRESSIONS[scale] snapping from `placeMotifInPhrase` still applies).
  - Computes pitch classes of the live chord (`chord.notes mod 12`).
  - If the note's PC is already a chord tone, returns it unchanged — preserves melodic identity.
  - Otherwise finds the nearest chord-tone PC (chromatic distance with wraparound).
  - Places the snapped PC at the octave closest to the original note (within a half-octave) — preserves melodic contour.
  - Clamps to a sane lead range (MIDI 36-96) — never snaps above C7 or below C2.

### V2c — `psy4EngineV2.ts` wiring

- In `refreshMusicalGenerators()`, after `this.melody = new MelodyEngine(...)` and `this.harmony = new HarmonyEngine(...)`, added `this.melody.setHarmonyEngine(this.harmony);`.
- This is called whenever the key changes (which rebuilds both engines) — so the link is automatically re-established on every key change. The link is also established at engine `init()` time.

## Verification

| Check | Command | Result |
|-------|---------|--------|
| tsc on touched files | `npx tsc --noEmit --skipLibCheck 2>&1 \| grep -E "schedulerWorker\|psy4EngineV2\|melodyEngine\|harmonyEngine"` | EMPTY |
| eslint strict | `npx eslint <4 files> --max-warnings=0` | EXIT 0 |
| bun lint errors in touched files | `bun run lint 2>&1 \| grep -E "schedulerWorker\|psy4EngineV2\|melodyEngine\|harmonyEngine" \| grep error` | EMPTY |
| dev server compile | dev.log after edits | "✓ Compiled in Nms", GET / 200 in 91ms |

Pre-existing tsc errors in OTHER files (proAudioNodes, continuousTrainer, perVoiceAnalyzer, renderWorker, selfAnalyzer, tests, examples, scripts, artifacts, audit, dsp, forensic, skills) are unchanged — none of these files were touched by V2.

## Constraints honored

- ✅ Did NOT break existing functionality — all existing public APIs preserved (start, stop, liveTrack, selfTrack, applyMusicalUnderstanding, setWorld, getPursuitStatus, triggerDrum, triggerSynth signature, setTrackEffect for non-'cutoff' names, setSendLevel, setMasterParam, getSynthesisCharacter, getPursuitDashboard, getHarmony, getCurrentChord).
- ✅ The Worker is created lazily (not at module load) — SSR safe.
- ✅ All automation uses setTargetAtTime or gradual ramps — no audio glitches. The rack's setParameter uses setTargetAtTime(0.05s); the lead cutoff override is applied per-note via the AdvancedSynthVoice's existing exponentialRampToValueAtTime on filter.frequency; the filter sweep itself ramps exponentially (ears hear log-Hz).
- ✅ TypeScript strict mode passes — zero tsc errors in schedulerWorker/psy4EngineV2/melodyEngine/harmonyEngine.

## Remaining gaps (honest)

- **PHYSICAL LISTENING UNVERIFIED** — verification via TypeScript + ESLint pass and code audit. Cannot run dev server to actually hear the output in this environment. The signal chain is well-formed: SchedulerWorker posts ticks → tick() runs scheduleStep() → applySectionAutomation pushes send levels + computes filter sweep → triggerSynth applies leadCutoffOverride to AdvancedSynthVoice.noteOn → noteOn's exponentialRampToValueAtTime on filter.frequency produces the sweep. But the audible result of the section transitions and the sweep curve is asserted by construction, not by listening.
- **Worker reduces jitter but doesn't eliminate it** — the worker's setInterval is still subject to the underlying OS timer resolution (typically 1-5ms on modern OSes, but can be worse on Windows). A truly sample-accurate scheduler would require an AudioWorkletProcessor with a sample-count clock (the dead `psy4-engine.js` worklet attempted this). The Worker approach is the right trade-off for V2: massive jitter reduction with zero risk of breaking the existing audio graph.
- **Strong-beat definition** — V2c uses `step % 4 === 0` (every quarter note) as the "strong beat" definition. The existing `placeMotifInPhrase` uses `stepWithinBar === 0` (downbeat) and `stepWithinBar === 8` (beat 3). The V2c snapping is layered on top, so the result is: downbeat + beat 3 get snapped twice (static first, live second — live wins), beats 2 and 4 get snapped once (live only). More aggressive than the spec required but matches the "step % 4 === 0" definition in the task description.
