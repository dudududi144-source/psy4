# F13 — MUSICAL AUTHORITY MAP

**HEAD:** `017ef70` (F11) · **Question:** Who decides WHAT to play, WHEN, and HOW LOUD?

The user's requirement: **"Foundation owns WHAT. PSY4 owns WHEN / HOW."**

This document maps every component that can generate, modify, remove, or silence musical notes, and identifies where authority is fractured.

---

## 1. AUTHORITY TABLE

| COMPONENT | CAN GENERATE? | CAN MODIFY? | CAN REMOVE? | RUNTIME? | DEAD? | OWNER OF WHAT? |
|-----------|---------------|-------------|-------------|----------|-------|----------------|
| **MusicalSession.planBar()** | ✅ Kick, Bass, Hat, Lead notes (generateKick/Bass/Hats/Lead) | ✅ Motif transforms (transpose/invert/fragment/retrograde via memory.transformMotif) | ✅ Lead omitted when leadDensity === 0 | ✅ YES (psyLive:682) | NO | **WHAT (notes)** |
| **MusicalSession.generateKick** | ✅ 4-on-floor kicks at steps 0,4,8,12 + fill at barInPhrase=7 | ✅ velocity reduced 0.9→0.6 if radioKickOcc > 0.7 | ❌ Never removes kick (F9 Rule 3) | ✅ | NO | WHAT (kick pattern) |
| **MusicalSession.generateBass** | ✅ 8 bass notes (root on beats + offbeats), cadence/response variation | ✅ fifth/third substitution at phrase positions | ❌ Never removes bass | ✅ | NO | WHAT (bass pattern) |
| **MusicalSession.generateHats** | ✅ 4 offbeat hats + fill at barInPhrase=7 | ✅ velocity from tension | ❌ Never removes hats | ✅ | NO | WHAT (hat pattern) |
| **MusicalSession.generateLead** | ✅ Motif notes remapped to octave 3, clamped 48-72. Fill bars for cadence/response/repeat/develop | ✅ velocity from tension, density gating per-note | ✅ Entire lead section omitted if leadDensity === 0 | ✅ | NO | WHAT (lead pattern) |
| **MusicalSession.calculateLeadDensity** | — | ✅ Decides lead density per bar (section + phrase + radio + tension) | ✅ Returns 0 → no lead | ✅ | NO | **WHETHER lead plays** |
| **MusicalSession.handleNewPhrase** | ✅ Generates new motif via generateMotif() | ✅ Transforms existing motif (transpose) | — | ✅ | NO | WHAT (motif material) |
| **MusicalSession.detectStyle** | — | ✅ Overwrites session.style from radio occupancy | — | ✅ (every 200ms) | NO | Style metadata (but style doesn't affect notes) |
| **MusicalSession.evaluatePhrase** | — | ✅ Computes reward, stores in memory | — | ✅ (barInPhrase=7) | NO | Reward bookkeeping (reward never used) |
| **MusicalMemory.pickMotif** | ✅ Would select motif by reward | — | — | ❌ **NEVER CALLED** | ✅ DEAD | (would be: WHICH motif) |
| **MusicalMemory.recordPhrase** | — | ✅ EMA-updates motif.reward | — | ✅ | NO | Reward storage (read by nobody) |
| **MusicalMemory.transformMotif** | ✅ Creates transformed motif copy | — | — | ✅ | NO | Motif variation |
| **MusicalMemory.createMotif** | ✅ Stores new motif | — | — | ✅ | NO | Motif storage |
| **primitives/motif.generateMotif** | ✅ Call-and-response motif, 32 steps, octave 4 | — | — | ✅ (via handleNewPhrase) | NO | Motif generation |
| **primitives/bass.generateBassPattern** | ✅ kb3/four-on-floor/offbeat/syncopated | — | — | ❌ **NEVER IMPORTED** | ✅ DEAD | — |
| **primitives/chords (6 functions)** | ✅ chordNotes/voiceChord | — | — | ❌ **NEVER IMPORTED** | ✅ DEAD | — |
| **primitives/rhythm (10 functions)** | ✅ fourOnFloor/psyKick/offbeatHats/etc | — | — | ❌ **NEVER IMPORTED** | ✅ DEAD | — |
| **psyLive.scheduleStep** | — | — | ✅ Skips kick if occupancy.kick > 0.7; bass if > 0.75; lead if > 0.85 | ✅ | NO | **WHETHER notes play (negative control)** |
| **psyLive.detect (role ducking)** | — | ✅ Overwrites kickBus/bassBus/leadBus/hatBus gain every 200ms | — | ✅ | NO | **HOW LOUD (bus gains)** |
| **psyLive.classifyStyle** | — | ✅ Sets psyLive.currentStyle from occupancy | — | ✅ | NO | UI style display (parallel to session.style) |
| **MusicalContext.updateFromRadio** | — | ✅ Overwrites bpm, energy, density, syncopation, radioRoles | — | ✅ | NO | Context state (feeds session) |
| **MusicalContext.updateFromTransport** | — | ✅ Sets targetTension from arc, smooths tension | — | ✅ | NO | Tension smoothing |
| **RadioObservationLayer.process** | — | ✅ Produces occupancy, signal state, beat observation (dead) | — | ✅ | NO | Radio analysis |
| **RadioMusicalWindow.observe** | — | ✅ Maintains energy/density/occupancy/pitchClass history | — | ✅ | NO | Radio window (feeds session) |
| **PRESETS (4 hardcoded)** | ✅ Define bpm, root, patterns (kick/bass/lead/hat arrays), variants | — | — | ⚠️ PARTIAL — only bpm + variants used. Patterns DEAD (session generates own). root DEAD (session uses ctx.rootPc). | ⚠️ PARTIAL | Preset tempo + timbre params |
| **SoundBank (142 presets)** | ✅ 142 verified presets | — | — | ❌ **NOT IMPORTED** | ✅ DEAD | — |
| **PooledEngine** | ✅ Voice pooling | — | — | ❌ **NOT IMPORTED** | ✅ DEAD | — |
| **studio/engine/* (70 files)** | ✅ 34,185 lines of engines | — | — | ❌ 0% live, 17% API-only, 83% dead | ✅ DEAD | — |

---

## 2. THE AUTHORITY FRACTURE

### 2.1 WHAT (which notes) — MusicalSession ✅
MusicalSession.planBar() is the **single** generator of NotePlan. No other component creates notes. The primitive libraries (bass/chords/rhythm) are dead. The studio engines are dead. SoundBank is dead.

**Verdict:** ✅ CLEAN. Foundation owns WHAT.

### 2.2 WHETHER (do the notes actually play) — FRACTURED
- MusicalSession decides lead WHETHER via `calculateLeadDensity` (can return 0)
- psyLive.scheduleStep decides kick/bass/lead WHETHER via occupancy gating (lines 690, 696, 699)
- psyLive.detect decides WHETHER via bus ducking (gain → 0.05 is effectively silence)

**Three different components** can prevent a planned note from being heard:
1. MusicalSession: `leadDensity === 0` → lead not in plan
2. scheduleStep: `occupancy.kick > 0.7` → kick not scheduled
3. detect: `kickBus.gain = 0.05` → kick scheduled but inaudible

**Verdict:** ❌ FRACTURED. Foundation owns the plan, psyLive owns the gate. The user cannot tell which component silenced a note.

### 2.3 HOW LOUD (velocity / gain) — FRACTURED
- MusicalSession: `note.velocity` (0.3-0.9 per note, from generateKick/Bass/Hats/Lead)
- psyLive: `bus.gain` (kickBus 0.95, bassBus 0.85, leadBus 0.5, hatBus 0.55 — clobbered by detect)
- psyLive: `v.hatLvl * note.velocity` for hats (line 693 — hat velocity is multiplied by variant.hatLvl)
- psyLive: `master.gain` (0.9, user-controlled)

**Four gain stages** between the note plan and the destination:
1. note.velocity (per-note, foundation)
2. bus.gain (per-role, psyLive — clobbered by detect)
3. engineBus.gain (0.8, fixed)
4. master.gain (0.9, user)

**Verdict:** ❌ FRACTURED. Foundation sets velocity, psyLive sets bus gain (and clobbers it), user sets master. No single owner of loudness.

### 2.4 WHEN (timing) — MusicalTransport + psyLive.scheduler ✅
- MusicalTransport owns beat/bar/phase (anchor-based, zero drift)
- psyLive.scheduler reads transport.snapshot() and schedules 16th notes
- No duplicate clock, no independent `nextNoteTime`

**Verdict:** ✅ CLEAN. Transport owns time, scheduler reads it.

### 2.5 WHICH MOTIF — MusicalSession (but learning disconnected)
- MusicalSession.handleNewPhrase creates/transforms motifs
- MusicalMemory stores motifs and their rewards
- **MusicalMemory.pickMotif** (reward-weighted selector) is NEVER CALLED
- Motif selection uses `motifGroups[groupIdx][0]` (first motif) or `transformMotif` (deterministic transform)
- Reward is computed, EMA-stored, and **ignored**

**Verdict:** ⚠️ SINGLE OWNER but learning is disconnected. The "intelligence" is decorative.

---

## 3. THE COMPOSITION REALITY

### 3.1 What MusicalSession.planBar() actually produces

```typescript
NotePlan {
  bar: number,
  notes: ScheduledNote[],  // 16-21 notes per bar typically
  role: 'LEAD' | 'GROOVE',
  action: 'introduce'|'repeat'|'develop'|'variation'|'cadence'|'response',
  style: string,           // metadata only
  section: 'INTRO'|'STATEMENT'|...,
  tension: number,
  barInPhrase: 0-7,
  reason: string,
}
```

A typical bar (bar 0, INTRO, barInPhrase=0):
- 4 kicks (steps 0,4,8,12, velocity 0.9)
- 8 bass notes (steps 0,2,4,6,8,10,12,14, MIDI ~33-45, velocity 0.6-0.9)
- 4 hats (steps 2,6,10,14, velocity 0.32)
- 0-2 lead notes (random subset of motif, MIDI 48-60, velocity 0.3-0.5)
- **Total: ~16-18 notes per bar**

### 3.2 The 64-bar form

```
Bar  0-7:  INTRO        (tension 0.2, density 0.4, lead density 0.2+0.1=0.3)
Bar  8-15: STATEMENT    (tension 0.4, density 0.6, lead density 0.4)
Bar 16-23: DEVELOPMENT  (tension 0.6, density 0.7, lead density 0.5)
Bar 24-31: RESPONSE     (tension 0.5, density 0.6, lead density 0.4)
Bar 32-39: CONTRAST     (tension 0.7, density 0.8, lead density 0.4)
Bar 40-47: DEVELOPMENT2 (tension 0.8, density 0.8, lead density 0.5)
Bar 48-55: CLIMAX       (tension 0.95, density 0.9, lead density 0.6)
Bar 56-63: RESOLUTION   (tension 0.3, density 0.5, lead density 0.2)
Bar 64+:    CYCLES BACK TO INTRO  ← infinite loop, not one-shot
```

**Assessment:** The arc is REAL (affects lead density + hat velocity via tension). But it CYCLES — there is no "build to peak and resolve" narrative. The music loops every 64 bars forever. A real psytrance arrangement builds ONCE over 6-8 minutes, not every 2.5 minutes.

### 3.3 The phrase structure

```
Phrase 0 (bar 0-7):   group 0 (A) — new motif created
Phrase 1 (bar 8-15):  group 0 (A) — motif repeated (transformed at barInPhrase=1,4)
Phrase 2 (bar 16-23): group 1 (B) — new motif created
Phrase 3 (bar 24-31): group 0 (A) — motif reused
Phrase 4 (bar 32-39): group 0 (A) — motif reused
Phrase 5 (bar 40-47): group 1 (B) — motif reused
Phrase 6 (bar 48-55): group 2 (C) — new motif created
Phrase 7 (bar 56-63): group 0 (A) — motif reused
```

Pattern: **A-A-B-A-A-B-C-A** (not A-A'-B-A-return as the spec claims)

**Assessment:** Real phrase structure with motif reuse. But the transforms (transpose/invert/fragment/retrograde) are applied per-bar within phrases, not per-phrase. The musical result is: same motif, slightly varied each bar, with a new motif every 16 bars (A→B) or 48 bars (A→C).

### 3.4 ABSTAIN — COMMENT ONLY

Grep for `ABSTAIN` in foundation/:
- `MusicalSession.ts:5` — comment: "1. Kick ALWAYS present (no ABSTAIN removing the backbone)"
- `MusicalSession.ts:238` — comment: "Lead NEVER plays during ABSTAIN bars"

**No `ABSTAIN` identifier, string, action, or role exists in code.** The comments are remnants of a prior architecture. Lead rest happens via `leadDensity === 0` (numeric gate), not via an ABSTAIN action.

### 3.5 Learning — BOOKKEEPING ONLY

```
planBar() → evaluatePhrase() (at barInPhrase=7)
  → reward = coherence*0.3 + densityFit*0.25 + 0.25 + novelty*0.2
  → memory.recordPhrase({reward, ...})
    → motif.reward = motif.reward*0.8 + record.reward*0.2  (EMA)

handleNewPhrase() → picks motif
  → motifGroups[groupIdx][0]  (ALWAYS first motif, ignores reward)
  → OR memory.transformMotif(currentMotif, ...)  (deterministic, ignores reward)
  → NEVER calls memory.pickMotif()  (the reward-weighted selector)
```

**The reward is computed, stored, and ignored.** Motif selection is positional (first in group) or deterministic (transform of current). Learning does not influence future music.

---

## 4. THE STARTUP SEQUENCE (Phase 6 — Root Cause)

### 4.1 What happens on PLAY

```
1. play() → ensureAudio() → transport.start() (bpm=145)
2. scheduler() → scheduleStep(stepIdx, stepTime)
3. scheduleStep → session.planBar(0, 145)
4. planBar(0):
   - barInPhrase = 0, action = 'introduce'
   - handleNewPhrase(): generateMotif(rootPc=9, phrygianDom, {seed, steps:32, density:0.5})
     → motif notes at octave 4 (MIDI ~57-72)
   - generateKick: 4 kicks ✅
   - generateBass: 8 bass notes ✅
   - generateHats: 4 hats ✅
   - calculateLeadDensity:
     - section = INTRO → density = 0.2
     - barInPhrase = 0 → +0.1 = 0.3
     - radio empty → no modification
     - tension = 0.295 (smoothed from arc target 0.2)
     - density *= (0.7 + 0.295*0.3) = 0.3 * 0.7885 = 0.237
     - returns 0.237 > 0 → LEAD PLAYS
   - generateLead: ~2 lead notes (24% of motif notes)
5. scheduleStep plays: kick, bass, hat, LEAD — all on bar 0
```

### 4.2 Root cause of "startup lead"

The lead plays on **bar 0** because:
1. `calculateLeadDensity` returns **0.237** for INTRO bar 0 (not 0)
2. There is **no "groove stability" check** — lead enters immediately
3. The F9 comment says "Lead is optional (default REST, plays only when groove is stable)" but the code returns > 0 for every bar

The lead register is **MIDI 48-72** (C3-C5). The motif is generated at octave 4 (MIDI 57-72), shifted -12, clamped to 48-72. Most notes land at 48-60 (C3-C4, 130-262 Hz). The clamp allows up to 72 (C5, 523 Hz) if transpose pushes notes up.

The lead timbre (F10 fix): triangle wave, Q ≤ 5, filter peaks at v.leadCut (1800-3400 Hz depending on preset), delay send 0.12, reverb send 0.15, gain ≤ 0.27.

**The lead is not "high-pitched" in register (mostly C3-C4). It is "present from bar 0" when it should rest during groove establishment.**

### 4.3 The intended startup (from user's F13 spec)

```
START → GROOVE → DEVELOP → BUILD → PEAK → BREAK → RETURN
```

The code implements:
```
PLAY → EVERYTHING IMMEDIATELY (kick + bass + hats + lead) → CYCLE 64 BARS → REPEAT
```

There is no "groove-first" phase. There is no "develop" escalation. There is no "break". The 64-bar arc only affects lead density (0.2→0.6) and hat velocity (0.25→0.49) — subtle changes that don't constitute a narrative.

---

## 5. TARGET AUTHORITY MODEL

```
WHAT:     MusicalSession (single composer)          ← KEEP
WHETHER:  MusicalSession (leadDensity, ABSTAIN)     ← MOVE from psyLive
HOW:      MusicalSession (velocity) + psyLive (bus, master) ← CLARIFY
WHEN:     MusicalTransport (clock) + psyLive (scheduler) ← KEEP
WHICH:    MusicalMemory.pickMotif (reward-weighted)  ← WIRE IN (currently dead)
```

### 5.1 Required changes

1. **Move occupancy gating from psyLive to MusicalSession.** The composer should decide whether to emit a note based on radio occupancy, not the scheduler. The scheduler should play what the composer plans — no surprises.

2. **Move bus ducking from psyLive.detect to a sidechain compressor.** The user's mixer settings should be respected. Radio ducking should be a sidechain effect (compressor triggered by radio envelope), not a gain clobber.

3. **Wire pickMotif.** The reward-weighted selector must be called in handleNewPhrase. Learning must influence future motif selection. Otherwise remove the reward computation entirely (honest deletion over decorative bookkeeping).

4. **Implement ABSTAIN as a real action.** If the composer should rest, it should return an empty NotePlan or a plan with `action: 'ABSTAIN'` that the scheduler respects. Not a numeric density gate that sometimes returns 0.

5. **Implement a startup sequence.** Bar 0-7 (INTRO) should be kick + bass + hats ONLY (no lead). Lead enters at bar 8 (STATEMENT). This requires `calculateLeadDensity` to return 0 for INTRO, not 0.2.

6. **Make the 64-bar arc one-shot, not cyclic.** After bar 63 (RESOLUTION end), either stop or transition to a "sustained" state. Not loop back to INTRO.

---

## 6. VERDICT

**Musical authority is FRACTURED.** MusicalSession owns WHAT (clean), but WHETHER and HOW are split between MusicalSession and psyLive. The learning system is decorative. The startup sequence is missing. The 64-bar arc cycles instead of building.

The composer is **not wrong** — it generates valid musical plans. But it is **not authoritative** — its plans are filtered, ducked, and ignored by psyLive. And it is **not intelligent** — its learning is bookkeeping.

**The foundation owns WHAT on paper. At runtime, psyLive owns WHETHER and HOW, and the learning is theater.**
