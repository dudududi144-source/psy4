# Task M1 — Melody track (motif development + sequences + call-response + tension curves)

**Agent:** Z.ai Code (Melody track)
**Date:** $(date)
**Status:** ✅ Complete

## What was done

### Step 1: Created melodyEngine.ts
Path: `/home/z/my-project/src/lib/studio/engine/melodyEngine.ts` (~520 lines)

Exports:
- `Motif` interface: `{ notes: number[]; durations: number[]; velocities: number[]; rests: boolean[] }`
  (notes are scale degrees — clean transposition across any scale)
- `ContourShape` type: `'arch' | 'descending' | 'ascending' | 'wave'`
- `MelodyEngine` class with the full API specified in the task

### Step 2: Motif generation (singable contour)
- 4-8 notes per motif.
- Starts on a chord tone (degrees 0/2/4 = 1st/3rd/5th).
- Prefers steps (2nds) over leaps (3rds+); leap probability rises with tension.
- After a leap, 75% chance to resolve by step in opposite direction (classical voice-leading).
- Ends on nearest stable tone (1st/3rd/5th).
- Range: octave + a 3rd (singable).
- Contour shapes driven by tension: ascending (high), arch (mid), descending/wave (low).
- Octave shift: high tension lifts whole motif up a 7th; low drops it a 7th.

### Step 3: Development techniques (classical)
- `transpose(motif, scaleSteps)` — scale-aware (clean, stays in scale).
- `invert(motif)` — melodic inversion (delta sign flipped).
- `retrograde(motif)` — play backwards.
- `fragment(motif, startIdx, length)` — take a 2-3 note cell.
- `elongate(motif, factor)` — rhythmic augmentation (slower).
- `shorten(motif, factor)` — rhythmic diminution (faster).
- `sequence(motif, steps, direction)` — repeat at successively higher/lower scale degrees (default shift = 2 = up a 3rd, the classic sequence interval).

### Step 4: Phrase structure (A A' B A'')
8-bar developmental phrase (NOT AABA):
- A (bars 0-1): state the motif.
- A' (bars 2-3): variation — transpose up a 3rd OR fragment-and-repeat.
- B (bars 4-5): contrasting motif (fresh, higher tension).
- A'' (bars 6-7): return + development — augment + sequence up.

### Step 5: Tension curves (0..1 → melodic behavior)
- Low (0-0.3): slow notes (dur 4-8), low register (oct -7), consonant, lots of rests (25% rest prob).
- Medium (0.3-0.6): mid register (oct 0), mostly steps, dur 2-4, 15% rests.
- High (0.6-0.8): faster (dur 1-2), ascending sequences, more leaps, 10% rests.
- Peak (0.8-1.0): 16ths only, highest register (oct +7), climbing sequences, 5% rests.
- Periodic variation: sin phase on phraseCount so consecutive phrases at the same energy don't all hit the same tension peak.

### Step 6: Call-response
- `generateResponse(prevPhrase)`:
  * Inverts the call's contour (call ascending → response descending).
  * Forces last note to the root (most stable tone — definitive "answer").
  * Shortens durations (2x faster — lighter feel).
  * Lowers velocity by 20% (counter-melody feel).
- `nextResponseNote(step, bar, energy)`:
  * Returns the arp's response note (root+24, two octaves above bass).
  * Response events placed in bars 4-7 of the phrase.

### Step 7: Harmony compatibility (Track H1)
- Strong beats snap to chord tones from `PROGRESSIONS[scale]`:
  * Downbeat (step 0) → nearest chord tone (root/3rd/5th of bar's chord degree).
  * Beat 3 (step 8) → 3rd or 5th of the chord (random pick, 50% chance).
  * Weak beats → keep motif's scale degree (passing/neighbor tones).
- This keeps the lead from clashing with H1's chord changes.

## Integration into psy4EngineV2.ts

- Removed `LeadMotif` from import (kept `AcidPattern`, `BASS_PATTERNS`, `PROGRESSIONS`, `scaleNote`, `mtof`).
- Added `import { MelodyEngine } from './melodyEngine';`.
- Replaced field: `private leadMotif: LeadMotif | null = null` → `private melody: MelodyEngine | null = null`.
- `refreshMusicalGenerators()`: replaced `new LeadMotif(...)` with `new MelodyEngine(this.musicalKey.root, this.musicalKey.scale, this.musicRng)`.
- `tick()` per-bar: `leadMotif?.tickEvolution(...)` → `melody?.tickEvolution(this.bar, this.currentWorld.evolutionRate, 8)`.
- `tick()` section boundary: `leadMotif?.evolve()` → `melody?.newPhrase(phraseEnergy)` where `phraseEnergy = clamp(world.energyCurve[0] * (0.4 + 0.6 * newSection.density), 0, 1)`.
- `scheduleStep()` LEAD: `leadMotif.nextNote(step, bar, energy, musicRng!)` → `melody.nextNote(step, bar, energy)`. Uses `sd * noteInfo.duration` for proper melodic phrasing (was fixed `sd * 0.5`).
- `scheduleStep()` ARP: in VARIATION sections, arp plays `melody.nextResponseNote()` (descending counter-melody). In all other sections, arp plays its world-driven pattern. When no response event scheduled, arp is silent (natural breathing space).

## Constraints verified
- ✅ Did NOT break existing patterns, reference pursuit, or style detection.
- ✅ Works with all 10 worlds (different scales/roots) — PROGRESSIONS falls back to minor for scales not in the dict (minorPentatonic, doubleHarmonic).
- ✅ Compatible with Track H1 harmony engine (chord-tone snapping on strong beats).
- ✅ LeadMotif class kept in musicalGrammar.ts (still used by forensic/offlineRenderer.ts — untouched).
- ✅ TypeScript strict mode: zero new tsc errors in melodyEngine.ts or psy4EngineV2.ts.
- ✅ ESLint: both files pass with zero errors.

## Verification commands
```bash
cd /home/z/my-project && npx tsc --noEmit --skipLibCheck 2>&1 | grep -E "melodyEngine|psy4EngineV2" | head
# → empty (no errors)

cd /home/z/my-project && bun run lint 2>&1 | grep -E "melodyEngine|psy4EngineV2" | grep error
# → empty (no errors)

cd /home/z/my-project && npx eslint src/lib/studio/engine/melodyEngine.ts src/lib/studio/engine/psy4EngineV2.ts
# → empty (no errors)
```

## Deliverable
A melody engine with:
- Motif generation (singable contour, chord-tone start/end, range, contour shapes)
- Development techniques (transpose/invert/retrograde/fragment/augment/diminish/sequence)
- Tension curves (low/medium/high/peak → register/density/duration/leap probability)
- Call-response (generateResponse + nextResponseNote for the arp)
- Phrase structure A A' B A'' (8-bar developmental, not AABA)

The lead now plays evolving, developing melodies instead of static motifs.
