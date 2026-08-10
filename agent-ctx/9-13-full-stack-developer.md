# Task 9-13 — Track B: Reference Pursuit

**Agent**: full-stack-developer
**Task**: Make `Psy4EngineV2` actively chase the reference radio across 5 timbral
dimensions (kick decay, spectral centroid, transient density, sub/high energy,
bass decay) plus continuous BPM tracking and key pursuit.

## Files Modified
- `src/lib/studio/engine/psy4EngineV2.ts` — engine rewrite (reference pursuit fields, `liveTrack` rewrite, `triggerDrum`/`triggerSynth` decay & cutoff blending, BPM ramp in `tick()`, `refreshMusicalGenerators()`, `getPursuitStatus()`, `centroidToCutoff()` helper, `PooledDrumVoice.hit()` decayOverride param).
- `src/app/page.tsx` — pass full self-metrics to `selfTrack()`, pass `bassDecayMs` to `liveTrack()`, render a new "REFERENCE PURSUIT" card showing target/actual/delta per dimension.

## Coordination with Track A
Track A was concurrently rewriting `scheduleStep()` to be world-driven. Their
changes are compatible with mine:
- Track A extended my `musicalGrammar` import to also pull `BASS_PATTERNS`,
  `PROGRESSIONS`, `scaleNote`, `mtof`. They kept `SeededRng`/`LeadMotif`/`AcidPattern`.
- Track A added a 7th optional `timbre` param to `triggerSynth`. My `decayOverride`
  on `triggerDrum` is independent (4th param) so no conflict.
- Track A consumes my `leadMotif`, `musicRng`, `refSpectralCentroid`,
  `refTransientDensity`, `refBassDecay` fields directly in their `scheduleStep`.
- My reference-pursuit cutoff blending now runs on top of their world timbre
  override (`preset.cutoff * 0.6 + targetCut * 0.4`).
- Track A kept my BPM-ramp logic in `tick()` intact.

## Public API
All existing public methods preserved (new params are optional, appended at the
end of signatures). New public method:
```ts
getPursuitStatus(): {
  kickDecay:        { target: number; actual: number };
  centroid:         { target: number; actual: number };
  transientDensity: { target: number; actual: number };
  bpm:              { target: number; actual: number };
  key:              { root: number;   scale: string };
}
```

## Verification
- `npx eslint src/lib/studio/engine/psy4EngineV2.ts src/app/page.tsx` → EXIT 0
- `npx tsc --noEmit --skipLibCheck` → no errors in psy4EngineV2.ts (3 pre-existing
  page.tsx errors confirmed via `git stash` to pre-date this task).
- dev.log shows successful compiles and 200 responses after edits.

## Smoothing Strategy
| Dimension | Mechanism | Time constant |
|-----------|-----------|---------------|
| Kick decay | per-note decayOverride | per hit |
| Centroid | per-note cutoff blend | per hit |
| Transient density | per-step probability scale | per step |
| Sub/High energy | `setTargetAtTime` on track gains | 0.8-1.0s |
| Bass decay | per-note gate blend + sub-osc tail | per hit |
| BPM | 4-bar ramp in `tick()` | 4 bars |
| Key | re-create LeadMotif + AcidPattern | on change |

## Hand-off
- `leadMotif` field is consumed by Track A's `scheduleStep`. To add per-step
  mutation, call `this.leadMotif.evolve()` (already wired at section boundaries
  by Track A).
- `getPursuitStatus()` is exposed for any future UI agent that wants to render
  pursuit state.
- `refBassDecay` is currently driven by `liveTrack({bassDecayMs})`. The
  `ReferenceListenerV2` already produces this metric — page.tsx now passes it.
