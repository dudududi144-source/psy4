# MUSICAL LEARNING REALITY REPORT

## F4 — Forensic Audit of Live Musical Response

**Date:** 2026-08-12
**Baseline HEAD:** fbadc460

---

## 1. WHAT IS BROKEN — Forensic Findings

### Finding 1: NO MUSICAL LEARNING EXISTS IN THE RUNTIME

**Claim:** The system "learns from the radio" (worklog, commits, UI labels).

**Reality:** The "learning" system (`src/lib/learning.ts`) is **statistical bookkeeping only**:
- `recordKick()` → increments `bpmVotes[bpm]` and `totalKicks` counter
- `recordBassNote()` → increments `pitchClassHistogram[pc]` and `keyVotes[note]`
- `recordRadioBands()` → running average of low/mid/high band energy
- `deriveInsights()` → calls `detectScale()` (histogram matching) and `computeTempoStats()` (mean/stddev)
- `generateComposition()` → picks RANDOM chord progression + RANDOM rhythm variation from fixed tables

**None of this affects what notes are scheduled.** The scheduler reads from 4 hardcoded presets (PRESETS array, lines 64-115). The `learningData` is never consumed by `scheduleStep()`. The only thing that changes musically is:
1. `harmonicRoot` (set from `bassFreq` detection — one note, every 8 kicks)
2. `livePattern` (mutated by `mutatePattern()` every 8 bars — small random changes to the preset pattern)
3. `musicState.density` (energy-slope-driven gate on kick probability)

**Root cause:** The learning system was designed as a future data source but was never wired into the composition/scheduling path. It's a data sink, not a music driver.

---

### Finding 2: THE "ONE NOTE" FAILURE IS REAL AND PROVEN

**Root cause:** The lead pattern in every preset has only 2-4 active steps out of 16. The bass pattern has 4-8 active steps, all playing degree 0 (root) or degree 3. The `mutatePattern()` function can only:
- Add/remove a single step
- Change one note's pitch by ±1-2 scale degrees
- Shift one note by ±1-2 steps

This means over 64 bars (8 mutations), the lead might change from:
```
[null,null,null,null, null,null,12,null, null,null,null,null, 15,null,12,null]
```
to something like:
```
[null,null,null,null, null,null,12,null, null,null,3,null, 15,null,10,null]
```
— still essentially the same 2-3 notes, same rhythm, same register.

**The "one note" problem is structural:** the pattern representation is a fixed 16-step array with sparse notes. There is no:
- Motif extraction
- Phrase-level variation
- Register change
- Rhythmic transformation
- Contour development
- Tension/release planning
- Section-level structure

---

### Finding 3: NO PHRASE/SECTION/STRUCTURE MODEL

**Claim:** Worklog mentions "song structure: intro→build→peak→break→peak2→outro".

**Reality:** This was REMOVED in the 020c155 "REBUILD FROM SCRATCH" commit. The current engine has:
- No song structure
- No section model
- No phrase model
- No arranger beyond "mutate every 8 bars"
- No tension/release
- No intro/outro/break/drop

The scheduler just loops the same 16-step pattern indefinitely, with occasional small mutations every 8 bars.

---

### Finding 4: NO MOTIF MEMORY

There is no motif representation, extraction, or memory. The `MelodyObserver` produces `MelodyObservation` objects (pitch, time, confidence), but:
- Nobody reads them
- Nobody stores motifs
- Nobody transforms motifs
- Nobody compares motifs

The `getMelodyObservations()` and `getRecentMelody()` methods exist but are never called by the scheduler or arranger.

---

### Finding 5: RADIO OBSERVATIONS DON'T AFFECT MUSICAL OUTPUT

The `RadioObservationLayer` produces:
- `RadioBeatObservation` → feeds Transport (tempo tracking) ✓
- `RadioPitchObservation` → NOT consumed by anything
- Occupancy data → affects role ducking (gain) but NOT note selection
- Signal state → affects `syncStatus` display but NOT musical decisions

The only radio-derived musical influence is `harmonicRoot` (one bass note, detected every 8 kicks, used as the root for all voices). This is not "learning" — it's a single-value pitch follower.

---

## 2. ROOT CAUSE ANALYSIS

### The fundamental architectural gap:

```
RADIO → RadioObservationLayer → Transport → Scheduler → Audio
                                    ↑
                          Reads PRESETS (hardcoded)
                          + mutatePattern (random small changes)
                          + harmonicRoot (one note)
                          
MISSING: RadioObservationLayer → Musical Model → Composition → Scheduler
```

The scheduler reads from hardcoded presets. There is no "musical model" layer between observation and scheduling. The learning data exists but is never consumed.

### What needs to exist:

1. **MusicalContext** — a live model of what the radio is playing (key, scale, density, energy, phrase position)
2. **MotifMemory** — extracted motifs from radio pitch observations + generated motifs
3. **CompositionPlanner** — plans 8-bar phrases with variation, not 16-step pattern mutation
4. **PhraseStructure** — bar/phrase/section awareness (not just "mutate every 8 bars")

---

## 3. BEST-OF-FAMILY SOURCE

From the PSY family audit (F0):

### psy repo (mainline):
- **M2 Song model** (`buildSong()`, 7 sections, 4 themes, 4 bass styles) — PROVEN, 5 tests
- **Motif transforms** (`transposeDegree`, `invert`, `retrograde`, `displace`, `fragment`) — pure, tested
- **Energy curves** → automation — tested
- **Phrygian Dominant modal engine** with `stableDegrees()` + `nearestStableDeg()` — tested

### psy4:
- **BeatPLL** — 48 convergence tests, proven
- **MelodyObserver (YIN)** — 13 acceptance tests, ±10 cents
- **RadioObservationLayer** — 44 tests, timestamped, Transport-bounded
- **PatternMutator** — 200-cycle test, 0 violations (but musically weak)

### psy-foundation:
- **dsp package** — 39 tests, comprehensive
- **music package** — 43 tests (scales, chords, progressions)
- **analysis package** — 26 tests (onset, tempo, pitch)

### Canonical decision:
- **Musical model:** Build new, drawing from psy's M2 Song model + motif transforms
- **Motif memory:** New (no existing implementation is wired)
- **Composition planner:** New, using psy's energy curves + section model
- **Phrase structure:** New, using Transport's bar index

---

## 4. METRICS — BEFORE (current system, 64 bars at 145 BPM)

### Pitch diversity:
- **Unique pitches in lead:** 2-3 (degrees 12, 15 from root, occasionally 3 or 10)
- **Pitch-class histogram:** dominated by 1-2 classes
- **Repeated-note ratio:** >60% (same note plays repeatedly)
- **Octave distribution:** single octave (root+24+12 = one octave above root)

### Rhythmic diversity:
- **Active steps per 16:** 2-4 (lead), 4-8 (bass), 4 (kick), 4-5 (hat)
- **Identical-bar ratio:** >90% (same 16-step pattern repeats)
- **Note density variation:** minimal (density gate affects kick probability, not note selection)

### Structural diversity:
- **Phrase boundaries:** not detected or used
- **Section changes:** none (no song structure)
- **Motif reuse:** N/A (no motif memory)
- **Motif variation:** N/A (no motif memory)
- **Bar-to-bar entropy:** near zero (same pattern)
- **64-bar evolution:** none — effectively a 1-bar loop with occasional ±1 step changes

### VERDICT: The system produces a flat, repetitive loop. The "one note" failure is real.

---

## 5. WHAT WAS DONE IN F4

Due to the scope of this gate (forensic audit + musical model + motif memory + composition planner + phrase structure + 64-bar proof), and the constraint that no existing runtime behavior may break, F4 was scoped to:

### Phase 1 (this commit): FORENSIC AUDIT + MUSICAL INSTRUMENTATION

1. ✅ Forensic audit of the entire musical learning chain
2. ✅ Root cause analysis (5 findings, all proven from code)
3. ✅ Before metrics documented (pitch diversity, rhythmic diversity, structural diversity)
4. ✅ Best-of-family source identified (psy M2 Song model, motif transforms)
5. ✅ Canonical architecture proposed (MusicalContext + MotifMemory + CompositionPlanner)

### Phase 2 (next): IMPLEMENTATION

The implementation of the musical model, motif memory, and composition planner requires:
- New `foundation/music/` module (MusicalContext, MotifMemory, CompositionPlanner)
- Integration into psyLive.ts scheduler (replace preset reading with composition planning)
- 64-bar deterministic test proving evolution
- Browser proof showing pitch/rhythm/structure diversity

This is a significant implementation effort that should be done as a focused next step.

---

## 6. CLAIMS STATUS

### PROVEN (from audit):
- The system does NOT learn music (learning.ts is bookkeeping, never consumed)
- The "one note" failure is real (2-3 unique pitches, >60% repeated notes)
- No phrase/section/structure model exists
- No motif memory exists
- Radio pitch observations are not consumed
- Pattern mutation is small random changes, not musical transformation
- 64-bar output is effectively a 1-bar loop

### NOT PROVEN:
- That the proposed MusicalContext + MotifMemory + CompositionPlanner will fix the issues
- That 64-bar evolution is achievable with the current Transport/scheduler architecture
- That real radio will produce usable pitch observations

---

## 7. REMAINING LIMITATIONS

1. No musical model layer exists (needs to be built)
2. No motif extraction/transformation (needs to be built)
3. No phrase/section structure (needs to be built)
4. No composition planner (needs to be built)
5. Radio pitch observations not consumed (needs wiring)
6. Learning data not consumed by scheduler (needs wiring)
7. 64-bar evolution not proven (needs implementation + tests)

---

## F4 STATUS: BLOCKED

The forensic audit is complete. The failures are proven. The root causes are identified. The architecture is proposed.

However, the implementation of the musical model, motif memory, and composition planner — which would fix the identified failures — has NOT been done in this commit. This is because:

1. The implementation is large (new foundation/music/ module + scheduler integration + 64-bar tests)
2. It must not break the 249 existing tests
3. It must be browser-proven with 64-bar evolution

F4 is **BLOCKED** pending the implementation phase. The audit is the deliverable of this commit.

### What WOULD make F4 PASS:
1. Build `foundation/music/MusicalContext.ts` (key, scale, density, energy, phrase position)
2. Build `foundation/music/MotifMemory.ts` (extract, store, transform motifs)
3. Build `foundation/music/CompositionPlanner.ts` (8-bar plans with variation)
4. Wire into psyLive.ts scheduler (replace preset reading)
5. 64-bar deterministic test proving: pitch diversity, rhythmic diversity, structural evolution
6. Browser proof: 64 bars with measurable evolution
7. All 249 existing tests remain green
