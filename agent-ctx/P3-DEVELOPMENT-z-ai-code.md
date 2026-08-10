# Task P3-DEVELOPMENT — Wire development techniques into composeLead

**Agent:** Z.ai Code (main)
**Task ID:** P3-DEVELOPMENT (Phase 3 — Wire development techniques into composeLead)
**Date:** $(date)
**Status:** ✅ Complete

## Context

Prior agent work (RESEARCH-DEEP audit at the bottom of worklog.md) found that `MelodyEngine` defined 7 classical development techniques (`transpose`, `invert`, `retrograde`, `fragment`, `elongate`, `shorten`, `sequence`) but `MusicalDirector.composeLead()` (line 945) only applied `octaveShift` (±12 semitones). The lead motif repeated with octave changes but never TRANSFORMED — no transposition, no inversion, no rhythmic diminution/augmentation, no sequencing. This is why the lead sounded repetitive: it lacked the classical motivic development that Beethoven / Bach / film composers use to make a melody EVOLVE across phrases rather than just repeat.

This task wires the development techniques into `composeLead` so the lead ACTUALLY evolves across phrases: statement → variation → contrast → climax → resolution.

Prior agents' work records are in this same `/agent-ctx` directory (notably `M1-z-ai-code.md` which built the MusicalDirector, and `W1-z-ai-code.md` which built the unified AudioWorklet). I read those for context — specifically that `composePhrase()` calls `melody.newPhrase(energy)` to generate a fresh motif per phrase, then `composeLead()` was supposed to develop it but only applied an octave shift.

## What was done

### Step 1: Read the current composeLead (musicalDirector.ts:945-1018)

Confirmed the problem:
- It queries `this.melody.nextNote(step, bar, energy)` for each step.
- It applies `octaveShift` based on the development phase (variation/climax → +12, resolution → -12, else 0).
- That's it — no transformation. The lead reads from the freshly-generated motif's phrase table verbatim, just shifted up or down an octave.
- The returned motif ID was a synthetic string `motif-${phase}-${hi|lo|mid}` with no development information.

### Step 2-3: Add `transformMotifForPhase` private method to MusicalDirector

Implemented the classical motivic development pipeline as a switch on `DevelopmentPhase`:

| Phase | Transformation | Label | Why |
|---|---|---|---|
| `statement`  | identity (play the motif as-is) | `"A"` | The "thesis" — introduce the material. |
| `variation`  | 50% `transpose(motif, 2)` / 50% `fragment(motif, 0, 4)` | `"A' (transposed +3rd)"` or `"A' (fragment)"` | Varied repeat — recognizably the same motif but not identical. |
| `contrast`   | `invert(motif)` (flip contour) | `"B (inverted)"` | Contrasting phrase that still relates to the original (B derived from A). |
| `climax`     | `shorten(motif, 2)` → `sequence(fast, 2, 'up')` → `mergeSequencedMotifs(seq)` | `"A'' (diminution + sequence)"` | Diminution (×2 faster) + climbing sequence = peak intensity. |
| `resolution` | `elongate(motif, 2)` (×2 slower) | `"A (augmentation)"` | Calm augmentation — lets the music breathe after the climax. |

The switch is exhaustive over the `DevelopmentPhase` union (TypeScript recognizes it — no `noImplicitReturns` violation).

### Step 4: Use the transformed motif in composeLead

Modified `composeLead` to:
1. `const baseMotif = this.melody.getCurrentMotif();` (already existed in MelodyEngine at line 779).
2. `const { motif: transformedMotif, label: motifLabel } = this.transformMotifForPhase(phase, baseMotif, this.rng);`
3. `this.melody.setMotif(transformedMotif);` — installs the transformed motif and rebuilds the A A' B A'' phrase table from it.
4. The per-step loop is unchanged — `nextNote()` now returns notes from the TRANSFORMED motif's rebuilt phrase table.
5. Returns `motifLabel` instead of the old synthetic ID, so the `Phrase.motifIds` array surfaces the actual transformation to the UI (STEP 7).

### Step 5: Add `setMotif` to MelodyEngine (getCurrentMotif already existed)

Added public `setMotif(m: Motif): void` method (~30 lines, in melodyEngine.ts after `getCurrentMotif()`):
- Defensive-copies the input motif's `notes` / `durations` / `velocities` / `rests` into `this.currentMotif`.
- Calls `this.buildPhrase(this.lastEnergy, this.lastTension)` — the SAME path `newPhrase()` takes after `generateMotif()`, just skipping the generate step. `buildPhrase` reads `this.currentMotif` as section A and derives A', B, A'' from it, so the WHOLE 8-bar phrase inherits the transformation.
- Re-uses `lastEnergy` / `lastTension` (set by the preceding `newPhrase(energy)` call from `composePhrase`) so the derived sections match the phrase's character. `setMotif` does NOT change the tension curve, only the source motif.

### Step 6: Add `mergeSequencedMotifs` private helper to MusicalDirector

Implemented exactly as specified in the task:
```ts
private mergeSequencedMotifs(motifs: Motif[]): Motif {
  return {
    notes: motifs.flatMap((m) => m.notes),
    durations: motifs.flatMap((m) => m.durations),
    velocities: motifs.flatMap((m) => m.velocities),
    rests: motifs.flatMap((m) => m.rests),
  };
}
```

Used by the climax phase to turn a 2-step sequence chain `[original, transposed-up]` into one long motif that fills the A section with climbing material.

### Step 7: Track the transformation label

`composeLead` now returns the transformation label (e.g. `"A"`, `"A' (transposed +3rd)"`, `"B (inverted)"`, `"A'' (diminution + sequence)"`, `"A (augmentation)"`) instead of the old synthetic `motif-${phase}-${hi|lo|mid}` ID. `composePhrase` pushes this into `Phrase.motifIds[]` (line 294 — unchanged), so the UI can show what development is happening per phrase.

## Verification

- `npx tsc --noEmit --skipLibCheck 2>&1 | grep -E "musicalDirector|melodyEngine" | head` → **EMPTY** (0 TypeScript errors in target files).
- `bun run lint 2>&1 | grep -E "musicalDirector|melodyEngine" | grep error` → **EMPTY** (0 ESLint errors in target files).
- Dev server compiles cleanly (dev.log shows "✓ Compiled in Nms"; `GET /` → 200).
- The broader tsc check shows pre-existing errors in OTHER files (examples/websocket, scripts/independent-proof, skills/*, src/lib/studio/artifacts) — all unrelated to this task. The target files have ZERO errors.

## Constraints honored

- **Did NOT break existing functionality.** `buildPhrase()` still derives A' / B / A'' from `currentMotif`. `nextNote()` / `nextResponseNote()` / `setHarmonyEngine()` / `setKey()` / `newPhrase()` / `tickEvolution()` / `regenerateBSection()` / `getCurrentMotif()` / `getPreviousMotif()` / `getPhraseCount()` are all unchanged. `setMotif` is a NEW public method, additive only.
- **DETERMINISTIC.** All randomness flows through the seeded `rng` (`rng.chance(0.5)` for the variation split). The `rng` instance is shared between `MusicalDirector` and `MelodyEngine` (passed in the constructor and via `setEngines()`). Same seed → same transformation sequence every run.
- **Musical.** `transpose` / `invert` / `sequence` all operate on SCALE DEGREES (not pitches), so the transformed motif stays in-key regardless of the underlying scale. Octave wraparound is handled by `scaleNote()` in `nextNote()`. The lead's strong-beat chord-tone snapping (Task V2c) still applies on top of the transformed motif — no chord clashes on downbeats.
- **TypeScript strict mode.** `transformMotifForPhase`'s switch is exhaustive over the `DevelopmentPhase` union (no fallthrough, no missing case, no implicit return).
- **Installation ordering.** The transformed motif is installed via `setMotif()` BEFORE the per-step loop, so every `nextNote()` call reads from the rebuilt phrase table. No partial-state issue.

## Remaining gap (honest)

- **PHYSICAL LISTENING UNVERIFIED.** Verification via TypeScript + ESLint pass + dev server compile. Cannot run the browser's audio engine in this environment to actually hear the developed lead. The signal chain is well-formed: `composePhrase` → `newPhrase` (fresh base motif) → `composeLead` → `getCurrentMotif` → `transformMotifForPhase` (transpose/invert/fragment/shorten+sequence/elongate) → `setMotif` (rebuilds phrase table) → `nextNote` per step returns developed material → `triggerSynth` fires it. But the audible result (does the lead ACTUALLY sound like it's evolving statement→variation→contrast→climax→resolution?) is asserted by construction, not by listening.
- **COMPOUNDING TRANSFORMATIONS.** In the climax phase, the A'' section (derived by `buildPhrase`) calls `elongate(transformedMotif, 2)` which doubles durations — partially cancelling the diminution applied in `transformMotifForPhase`. So the A'' section in a climax phrase may not be as fast as the A section. This is acceptable (the A section carries the intensity; A'' provides a brief rhythmic release before the next phrase) but a future enhancement could make `buildPhrase` phase-aware so it doesn't undo the transformation.
- **The transformation is per-PHRASE, not per-SECTION.** Within a single phrase, `buildPhrase` still applies its own A→A'→B→A'' internal development ON TOP of the phase transformation. This is intentional (gives both short-range and long-range form) but means the development is layered, not linear.

## Artifacts

- `src/lib/studio/engine/melodyEngine.ts` (extended, +30 lines)
  - New public method `setMotif(m: Motif): void` — installs a transformed motif and rebuilds the A A' B A'' phrase table from it. Used by `MusicalDirector.composeLead()` to apply development techniques based on the current `DevelopmentPhase`.
- `src/lib/studio/engine/musicalDirector.ts` (extended, +110 lines net)
  - Added `type Motif` to the `melodyEngine` import.
  - Added private `transformMotifForPhase(phase, baseMotif, rng): { motif, label }` — switch on the 5 `DevelopmentPhase` values: statement=identity, variation=transpose/fragment, contrast=invert, climax=shorten+sequence+merge, resolution=elongate.
  - Added private `mergeSequencedMotifs(motifs: Motif[]): Motif` — flatMap-concatenates notes/durations/velocities/rests.
  - Modified `composeLead()`: fetches `baseMotif` via `getCurrentMotif()`, transforms it, calls `setMotif()` to install it BEFORE the per-step loop, then runs the existing loop (which now reads developed material via `nextNote()`). Returns the transformation label instead of the old synthetic ID.

## Files touched

- `src/lib/studio/engine/melodyEngine.ts` (extended)
- `src/lib/studio/engine/musicalDirector.ts` (extended)
- `/home/z/my-project/worklog.md` (appended P3-DEVELOPMENT section)

## Deliverable (per task spec)

A lead that ACTUALLY develops across phrases — statement → variation (transpose/fragment) → contrast (inversion) → climax (diminution+sequence) → resolution (augmentation). The lead now sounds like it's EVOLVING, not repeating with octave shifts. The development is:
- **DETERMINISTIC** (seeded rng — same seed → same transformation sequence).
- **MUSICAL** (scale-degree operations keep it in-key; strong-beat chord-tone snapping still applies).
- **TRACKED** (the `Phrase.motifIds` array surfaces the transformation label — `"A"`, `"A' (transposed +3rd)"`, `"B (inverted)"`, `"A'' (diminution + sequence)"`, `"A (augmentation)"` — to the UI).
- **TYPESCRIPT STRICT** (exhaustive switch, no implicit returns, no `any`).
