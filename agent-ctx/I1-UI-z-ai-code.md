# Task I1-UI — Integration UI (synthesis / effects / harmony / pursuit / melody)

## Goal
Surface the new engine capabilities (FM/supersaw/wavetable synthesis, per-track effects racks, harmony engine, deep pursuit metrics, melody engine) to the user via dashboard cards in `/home/z/my-project/src/app/page.tsx`.

## Files touched
- `src/app/page.tsx` (only file modified)

## Engine APIs used (all optional-chained except guaranteed ones)
- `getSynthModeOverrides()` ✅ always works (S1) — per-track live overrides
- `getCurrentChord()` ✅ always works (H1) — Chord { root, type, scaleDegree, inversion, notes[] }
- `getHarmony()` ✅ always works (H1) — HarmonyEngine instance (not currently used directly; left for future expansion)
- `getPursuitStatus()` ✅ always works — basic kick/centroid/transient/bpm/key (existing card)
- `getSynthesisCharacter()` ❓ T1 — { mode, confidence, fmDepth, sawSpread, wtPosition, reasons[] }
- `getEffectsState()` ❓ T1 — { tracks: [{ eqLowGain, eqMidGain, eqHighGain, compThreshold, satDrive, sendChorus, sendPhaser, sendDistortion, sendReverb, sendDelay }] }
- `getCurrentProgression()` ❓ T1 — Chord[]
- `getChordIdx()` ❓ T1 — number
- `getPursuitDashboard()` ❓ T1 — { harmonic: [{label,target,actual,unit,tol}], transient: [...], stereo: [...] }
- `getMelodyState()` ❓ T1 — { phraseLabel, position, phraseCount, tension, energy, callResponseActive, motifLength }

## Cards added (in render order)
1. **SYNTHESIS** — listen + analyze modes. Per-track mode grid (8 cells) + character panel (mode/confidence/params) + reasons list.
2. **EFFECTS MATRIX** — analyze mode. 8×11 table with EQ/comp/sat/sends + mini-bars.
3. **HARMONY** — analyze mode. Current chord + chord notes + progression (with current highlighted) + voicing.
4. **DEEP PURSUIT** — analyze mode (only when pursuitDashboard populated). 3-column grid of harmonic/transient/stereo rows with target/actual/delta/arrow.
5. **MELODY** — analyze mode. Phrase position + tension + call-response state.

## Fallbacks (when T1 not yet shipped)
- SYNTHESIS: per-track grid shows TRACK_DEFAULT_MODE (LEAD=fm, PAD=supersaw, ARP=wavetable, others=classic) — always works.
- HARMONY: current chord always shows (via getCurrentChord); progression shows "unavailable" note if getCurrentProgression not wired.
- EFFECTS MATRIX / DEEP PURSUIT / MELODY: clear "unavailable" placeholders with hints about which engine method will populate them.

## Visual design
- Color palette: emerald (good), amber (close), rose (far), fuchsia (accent), cyan (engine), slate (neutral). NO indigo, NO blue.
- Monospace `font-mono` on every numeric value.
- Responsive: grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 for synthesis; grid-cols-1 md:grid-cols-3 for harmony/deep-pursuit/melody; sticky left column on effects matrix.
- Long lists: max-h-96 overflow-y-auto + thin scrollbar.
- Sticky footer preserved.

## Verification
- `npx tsc --noEmit --skipLibCheck 2>&1 | grep "page.tsx"` → EMPTY ✅
- `npx eslint src/app/page.tsx --max-warnings=999` → EMPTY ✅ (0 errors, 0 warnings)
- Dev server: `✓ Compiled in 2.2s` with no errors in dev.log ✅
- Existing radio/engine/training/style-detection/auto-switch flows untouched ✅
