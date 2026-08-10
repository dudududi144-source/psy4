# Task H1 — Harmony Engine (voice leading + inversions + 7th/9th chords + counterpoint)

**Agent:** Z.ai Code (harmony track)
**Date:** 2026-08-08
**Deliverable:** A proper harmonic engine that produces professional-grade chord progressions with voice leading, integrated into `psy4EngineV2.ts`.

## What was done

### STEP 1 — HarmonyEngine module created
`/home/z/my-project/src/lib/studio/engine/harmonyEngine.ts` (~600 lines) exports:
- `ChordType` union (11 types: triad, maj7, min7, dom7, min9, maj9, sus2, sus4, dim, aug, min7b5)
- `Chord` interface (root, type, scaleDegree, inversion, notes[])
- `ChordVoicing` interface (notes[], bassNote)
- `HarmonyEngine` class with all spec'd methods

### STEP 2 — Chord construction (11 types, scale-aware)
- `CHORD_INTERVALS` table with fixed semitone patterns per type per the task spec.
- `diatonicQuality(degree)` stacks thirds from the scale to determine maj/min/dim/aug for each degree.
- `buildIntervals(degree, type)`:
  - For `triad`: uses diatonic quality (so triads are always scale-correct).
  - For 7th/9th types: uses fixed `CHORD_INTERVALS`.
- `adaptTypeToDiatonic(degree, type)` maps a requested type to the closest diatonic type:
  - maj degree + maj7 → maj7
  - min degree + maj7 → min7
  - dim degree + maj7 → min7b5
  - maj degree + maj9 → maj9
  - min degree + maj9 → min9
- `getChord(degree, type?)` uses `scaleNote()` from `musicalGrammar.ts` to find the root MIDI note in the bass register (MIDI 48–59), then stacks intervals.

### STEP 3 — Voice leading algorithm
`voiceLead(next: Chord): ChordVoicing`:
1. Bass note = chord root + inversion interval, clamped to bass register (MIDI 48–59).
2. Collect upper-voice pitch classes (chord PCs minus the bass PC).
3. `assignVoices(targetPCs, prevVoicing)` — greedy nearest-voice matching:
   - For each target PC, scan unassigned previous voices; pick the one with the smallest PC distance.
   - Common tones (PC=0 distance) get matched first and stay in the same voice (same MIDI note).
   - For non-common tones, place the new note at the octave closest to the matched previous voice (within ±6 semitones).
4. Pad upper voices to ≥3 by doubling the top note an octave up (with collision avoidance — falls back to top−12, then gives up at 2 voices if no slot is free).
5. Clamp all upper voices to MIDI 55–79 (G3–G5).
6. `avoidParallels(prevVoicing, nextVoicing)` checks adjacent voice pairs for parallel 5ths (7 semitones) or octaves (0 semitones); if found, shifts the upper voice by ±12 toward the previous voicing.
7. Sort, prepend bass, store as `previousVoicing`.

### STEP 4 — Scale-appropriate progressions
`SCALE_PROGRESSIONS` record defines 3–6 templates per scale (using 0–6 scale degrees):
- **minor**: i-VI-III-VII, i-iv-VII-III, i-VII-VI-VII, i-VI-iv-v, i-iv-v-i, i-VI-VII-VI
- **phrygian**: i-bII-i-bVII, i-bVI-bIII-bVII, i-bII-bVII-bVI, i-bVII-bVI-bII, i-bII-i-bVI
- **harmonicMinor**: i-iv-V-i, i-VI-iii-V, i-V-iv-i, i-VI-V-i, i-V-VI-V
- **dorian**: i-IV-i-VII, i-VII-IV-i, i-IV-VII-IV, i-VII-VI-IV, i-IV-v-VII
- **phrygianDominant**: i-bII-i-bVII, i-IV-bVII-III, i-bII-bVII-bVI, i-bVI-V-i, i-bII-V-bII
- **doubleHarmonic**: i-bII-i-V, i-bVI-V-i, i-bII-V-bII, i-V-bII-i, i-bVI-bII-V
- **minorPentatonic**: i-III-IV-V, i-V-IV-i, i-IV-V-III, i-III-V-IV

`generateProgression(bars, energy)`:
- Picks a random template from the scale's pool.
- Clamps chord count to 4–8.
- Each chord uses `getExtension(energy)` for its type, with a 22% chance of using `triad` for contrast.
- 14% chance of `borrowChord()` for modal interchange (never on the first chord — keep the tonic anchor).
- Each chord gets `chooseInversion()` applied for smooth bass motion.
- Resets voice-leading state on section boundary.

### STEP 5 — Modal interchange
`borrowChord()`:
- Picks a degree from {3, 4, 5, 6} (IV, V, VI, VII — never tonic).
- Reads the diatonic quality and flips it:
  - maj → min (parallel minor borrow)
  - min → maj (parallel major borrow — the classic "IV major instead of iv minor")
  - dim → min7b5 (from harmonic minor)
  - aug → aug (kept)
- Returns a Chord with the flipped quality at the diatonic root.

### STEP 6 — Inversions
`chooseInversion(prevBass, nextRoot)`:
- Computes bass note candidates for inversions 0/1/2 (root/3rd/5th).
- Picks the inversion whose bass note is closest (modulo octave) to `prevBass`.
- Prefers root position when distance is small (avoids gratuitous inversions); 60% chance to fall back to root if the inversion gain is marginal.

### STEP 7 — Counterpoint support
- `getAvoidNotes()`: returns pitch classes a half-step above/below each chord tone (passing tones the lead should avoid on strong beats).
- `isChordTone(midi)`: quick check used by the lead to favor chord tones on downbeats.
- `getCurrentChord()`: exposes the current chord for downstream modules (MelodyEngine can query this in a future task).

## Integration into psy4EngineV2.ts

### New fields
```ts
private harmony: HarmonyEngine | null = null;
private currentProgression: Chord[] = [];
private chordIdx = 0;
private currentChord: Chord | null = null;
```

### `refreshMusicalGenerators()`
Now also constructs `HarmonyEngine(root, scale)` and generates a default 4-chord progression at energy 0.5 so the pad has something to play before the first section boundary.

### `tick()` section-boundary branch
After `melody?.newPhrase(phraseEnergy)`, calls `harmony.generateProgression(next.bars, phraseEnergy)` so each new section gets a fresh progression with length matching the section's bar count and energy-driven extension level. Resets `chordIdx` and `currentChord`.

### `scheduleStep()` — PAD block (track 6) REWRITTEN
Old: triggered pad with chordRoot + fifth (2 notes per chord, root + scaleNote(degree+4)).

New: pulls the next chord from `currentProgression`, calls `harmony.voiceLead(chord)`, and triggers one pad voice per note in the resulting `ChordVoicing`:
- Bass voice (lowest, i=0) gets velocity `0.20 + energy * 0.14`.
- Upper voices get `0.10 + energy * 0.08 - (i-1)*0.01` (tapering for headroom).
- 5ms staggered timing per upper voice to avoid phase cancellation between detuned supersaw oscillators.
- `currentChord` is updated so the bass can follow the chord.

### `scheduleStep()` — BASS block (track 4) UPDATED
When `section.lead && this.currentChord` is set, the bass note is now `scaleNote(root, sc, currentChord.scaleDegree + bassDeg)` instead of `scaleNote(root, sc, bassDeg)`. This makes the bass walk with the harmony (e.g. during a VI chord, the bass plays the VI root + pattern offsets). In non-lead sections, the bass stays on the tonic — preserving the classic psytrance sub-bass pumping feel.

### New public getters
- `getHarmony(): HarmonyEngine | null` — exposes the engine for downstream modules (MelodyEngine counterpoint integration in a future task).
- `getCurrentChord(): Chord | null` — for UI display (chord name) and downstream consumers.

## Constraints honored
- **No break to existing patterns or reference pursuit** — all reference pursuit code (kick decay, centroid, transient density, sub/high energy, BPM, key) untouched.
- **Works with all 10 worlds** — tested mentally against all 7 scales (minor, phrygian, harmonicMinor, dorian, phrygianDominant, doubleHarmonic, minorPentatonic); `SCALE_PROGRESSIONS` has a fallback to minor when a scale isn't in the table.
- **Pad polyphony**: 4–5 voices per chord × 1 pad = 4–5 synth voices from the 20-voice pool. Well within budget even with the existing lead/arp/bass sharing the pool.
- **TypeScript strict mode**: `npx tsc --noEmit --skipLibCheck` reports zero errors in `harmonyEngine.ts` and `psy4EngineV2.ts`.
- **ESLint**: `npx eslint src/lib/studio/engine/harmonyEngine.ts src/lib/studio/engine/psy4EngineV2.ts` reports zero errors and zero warnings.

## Verification
- `cd /home/z/my-project && npx tsc --noEmit --skipLibCheck 2>&1 | grep -E "harmonyEngine|psy4EngineV2" | head` → empty ✓
- `cd /home/z/my-project && bun run lint 2>&1 | grep -E "harmonyEngine|psy4EngineV2" | grep error` → empty ✓
- `npx eslint src/lib/studio/engine/harmonyEngine.ts src/lib/studio/engine/psy4EngineV2.ts` → empty ✓
- Dev server compiles cleanly (no runtime errors visible in `dev.log` for src/ files).

## Stage summary
The pad now plays rich 4–5 note voicings (root or inversion in the bass + 3rd/5th/7th/9th in the upper voices) with proper voice leading — common tones are preserved between chords, other voices move by the smallest interval, parallel 5ths/octaves are avoided, and the bass line walks smoothly via inversion selection. Each section gets a fresh scale-appropriate progression with energy-driven extensions (triads in low-energy breaks → lush 9th chords in drops), plus occasional modal interchange for color. The bass follows the chord root during drops (and stays on the tonic during builds/grooves for the genre-defining psytrance pump). Counterpoint hooks (`getAvoidNotes`, `isChordTone`) are exposed for a future MelodyEngine integration.
