# F8 FORENSIC AUDIT — Architectural Reset

## RULE 1-3: Actual Call Graph + Duplicate Composers + Audio Data-Flow

### ACTUAL AUDIO PATH (traced from code):

```
psyLive.ts:scheduleStep()
  ↓
  if (composerMode === 'new' && this.newRuntime)
    → this.newRuntime.planBar(bar, bpm)  ← COMPOSER A
  else if (this.composer)
    → this.composer.planBar(bar, bpm)    ← COMPOSER B (dead code, never runs)
  ↓
  notes.filter(n => n.step === s16)
  ↓
  switch(note.voice)
    → this.kick(time)      ← AUDIO
    → this.hat(time, vel)  ← AUDIO
    → this.bass(time, freq, v)  ← AUDIO
    → this.lead(time, freq, v, accent)  ← AUDIO
  ↓
  if (notes.length === 0 && bar === 0)
    → preset fallback      ← COMPOSER C (only bar 0)
```

### DUPLICATE COMPOSERS FOUND:

| # | Component | Can generate music? | Can modify music? | Can suppress music? | Owner? | Active? |
|---|-----------|:---:|:---:|:---:|---|:---:|
| A | NewMusicalRuntime | YES | YES | YES (ABSTAIN) | self | YES (mode='new') |
| B | LiveComposer (F6) | YES | YES | YES | self | NO (mode='new' skips it) |
| C | Preset fallback | YES | NO | NO | psyLive | YES (bar 0 only) |
| D | CompositionPlanner | YES (inside A) | YES | NO | NewMusicalRuntime | YES (called by A) |
| E | MusicalDirector | YES (inside A) | YES | YES | NewMusicalRuntime | YES (called by A) |
| F | GrooveEngine | YES (kick/hat/bass steps) | YES | NO | NewMusicalRuntime | YES (called by A) |
| G | OpportunityEngine | NO (analysis only) | NO | YES (influences role) | NewMusicalRuntime | YES |
| H | StyleGrammar | NO (config only) | YES (influences decisions) | NO | NewMusicalRuntime | YES |

**ROOT CAUSE #1: Three systems can generate music (A, B, C).**
- A (NewMusicalRuntime) is the active composer
- B (LiveComposer) is dead code — initialized but never called because mode='new'
- C (Preset fallback) runs only on bar 0 when no notes are planned

**ROOT CAUSE #2: Composition happens DURING scheduling.**
- `scheduleStep()` calls `planBar()` on every scheduler tick (25ms)
- `planBar()` does full motif generation, transformation, bass/lead generation
- This means the composer is invoked ~40 times/second, even though it only needs to run once per bar
- The caching (`if (!this.currentNotePlan || bar changed)`) helps, but the check still runs every tick

**ROOT CAUSE #3: No separation of planning from rendering.**
- The composer generates notes AND the scheduler plays them in the same function
- There is no pre-computed CompositionPlan that the scheduler consumes
- The scheduler IS the composer

**ROOT CAUSE #4: Too many modules with overlapping responsibilities.**
- `LiveComposer.ts` (434 lines) — full composer (dead code)
- `NewMusicalRuntime.ts` (399 lines) — full composer (active)
- `MusicalDirector.ts` (204 lines) — decision maker (called by NewMusicalRuntime)
- `CompositionPlanner.ts` (176 lines) — phrase planner (called by NewMusicalRuntime)
- `GrooveEngine.ts` (127 lines) — groove planner (called by NewMusicalRuntime)
- `OpportunityEngine.ts` (63 lines) — opportunity analyzer (called by NewMusicalRuntime)
- `StyleGrammar.ts` (202 lines) — style config (called by NewMusicalRuntime)
- `MusicalIntent.ts` (216 lines) — decision maker (dead code, replaced by MusicalDirector)
- `MotifMemory.ts` (235 lines) — motif storage (dead code, replaced by MusicalMemory)
- `MusicalMemory.ts` (303 lines) — motif storage with learning (active)
- `RadioMusicalWindow.ts` (209 lines) — radio context (active)
- `MusicalContext.ts` (224 lines) — musical state (active)

Total: **2,888 lines of composition code** for what should be a single composer.

**ROOT CAUSE #5: Dead code bloat.**
- `LiveComposer.ts` — dead (never called in mode='new')
- `MusicalIntent.ts` — dead (replaced by MusicalDirector)
- `MotifMemory.ts` (old) — dead (replaced by MusicalMemory)
- `CompositionPlanner.ts` — partially dead (phrase planning is done in NewMusicalRuntime)
- 8 `primitives/` files from psy-foundation (1,949 lines) — mostly unused, only `scales.ts`, `motif.ts`, `bass.ts`, `rhythm.ts`, `rng.ts` are actually called

### ACTUAL MODULES THAT GENERATE AUDIO:

Only 4 functions in psyLive.ts actually create AudioNodes:
1. `this.kick(time)` — creates oscillator + gain → kickBus
2. `this.hat(time, vel)` — creates bufferSource + filter + gain → hatBus
3. `this.bass(time, freq, v)` — creates oscillator + filter + gain → bassBus
4. `this.lead(time, freq, v, accent)` — creates 2 oscillators + filter + gain → leadBus

Everything else is planning/analysis that feeds into these 4 functions.

### REBUILD PLAN:

1. **DELETE dead code:** LiveComposer, MusicalIntent, old MotifMemory, unused primitives
2. **MERGE into ONE composer:** NewMusicalRuntime + MusicalDirector + GrooveEngine + OpportunityEngine + StyleGrammar → single `MusicalSession` class
3. **SEPARATE planning from scheduling:** Pre-compute bar plans, scheduler only reads
4. **REMOVE feature flag:** One composer, one path
5. **SIMPLIFY:** Target < 500 lines for the entire composition layer
