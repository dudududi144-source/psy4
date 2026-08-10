# Task F1 — Creative Flow Engine

**Agent**: Z.ai Code
**Task**: Replace the fixed `arrangement` array in Psy4EngineV2 with a dynamic, radio-responsive flow engine.
**Date**: 2025

## Context

Read `/home/z/my-project/worklog.md` (especially the V2 entry, lines 3700-3800) and the full `psy4EngineV2.ts` (2993 lines).

The fixed arrangement was:
```
INTRO(4) → GROOVE(4) → BUILD(4) → DROP(8) → VARIATION(4) → BREAK(4) → FINAL DROP(8) → OUTRO(4)
```
Every play-through walked the same path with the same section lengths.

The user's complaint: "Section מהווה בעיה על זרימה חופשית — צריך למצוא פתרון שלא יתקע אותנו בנוסחה קבועה אלא יותר יצירתיות."

## What I Did

### 1. Created `flowEngine.ts` (~640 lines)

**FlowState type**: extends ArrangementSection fields (label, density, bass, lead) with:
- Continuous automation: `filterCutoff` (Hz), `reverbAmount` (0-1), `delayAmount` (0-1), `tension` (0-1), `surprise` (0-1)
- Section framing: `sectionBars`, `barInSection`
- Per-track density multipliers: `hatDensity`, `percDensity`, `fxDensity`

**SurpriseEvent interface**: 6 types (filterSweep, dropOut, echoThrow, reverseHit, stutter, silence)

**7 Archetypes** (INTRO, GROOVE, BUILD, DROP, VARIATION, BREAK, OUTRO) — each defines a target energy/density/tension/filterCutoff/reverbAmount/delayAmount/surprise. These are MUSICAL TARGETS, not sections.

**10 WorldFlowProfiles** — per-world flow characteristics:
| World | Baseline | Section Range | Drops | Surprises |
|-------|----------|--------------|-------|-----------|
| dark-psy | 0.65 | 6-24 bars | 1.4× weight | 1.2× rate |
| progressive-psy | 0.45 | 12-32 bars | 0.9× | 0.7× |
| goa | 0.65 | 8-28 bars | 1.2× | 1.1× |
| hypnotic | 0.50 | 24-64 bars | 0.7× | 0.5× |
| forest | 0.60 | 4-20 bars | 1.2× | 1.6× |

**FlowEngine class**:
- `tick(bar, refEnergy)`: tracks radio energy, considers transitions, smooths current toward target (1-4 bar time constants)
- `onReferenceEnergyChange(energy)`: high-priority transition trigger
- `transitionTo(partial, bars)`: forced transition
- `getCurrent()`: latest smoothed state
- `maybeSurprise(bar)`: pops queued surprise events (16-bar cooldown)

**Musical logic**: no DROP→DROP, no BREAK→BREAK, OUTRO is terminal. After DROP→VARIATION/BREAK, after BUILD→DROP, after BREAK→BUILD. Radio energy overrides soft preferences.

### 2. Integrated into `psy4EngineV2.ts`

- **Replaced** the `if (this.bar >= section.bars)` advancing block with `flowEngine.tick(totalBars, refEnergy)`
- **Replaced** `applySectionAutomation` with `applyFlowAutomation` — pushes continuous reverb/delay/cutoff every step
- **Added** per-step surprise gating: `suppressAll` (silence), `suppressNonKick` (dropOut)
- **Added** `startSurprise` / `endActiveSurprise` / `triggerReverseImpact` methods
- **Wired** `onReferenceEnergyChange` in `liveTrack()` (fires on >0.15 energy shift)
- **Wired** `setWorld` in `switchWorld()` (updates profile for next transition)

### 3. Continuous Automation

The flow engine smooths parameters toward archetype targets:
- `filterCutoff`: exponential interpolation (4-bar time constant) — naturally produces BUILD "filter opening" + BREAK "filter closing"
- `reverbAmount` / `delayAmount`: linear (2-bar) — BREAK gets 0.70 wash, DROP gets 0.25 punch
- `tension` / `surprise`: fast (1-bar) — moment-to-moment

All applied via `setSendLevel` / `setTrackEffect` → rack uses `setTargetAtTime(0.05s)` internally → no clicks.

### 4. DJ-Style Surprise Events

| Type | Duration | Effect |
|------|----------|--------|
| filterSweep | 2-4 bars | Triangle sweep: base→peak→base Hz |
| dropOut | 1-2 bars | Mute all except kick (DJ brake) |
| echoThrow | 2-4 bars | Boost delay send + feedback |
| reverseHit | 1 bar | Reversed sub-boom (swells IN) |
| stutter | 1 bar | 4-6 rapid lead retriggers |
| silence | 1 bar | Mute everything (dramatic pause) |

Probability = `flow.surprise × worldProfile.surpriseRateMult`. No surprises during INTRO/OUTRO.

### 5. P1 Stubs

The working directory had pre-existing P1 (PerformanceMonitor) code that referenced methods not yet defined. Added minimal stubs:
- `acquireSynthVoice()`: round-robin (pre-P1 behavior)
- `onAdaptiveQualityChange(level, reason)`: log + store level

## Verification

- `npx tsc --noEmit --skipLibCheck 2>&1 | grep -E "flowEngine|psy4EngineV2"` → **EMPTY**
- `npx eslint flowEngine.ts psy4EngineV2.ts --max-warnings=0` → **PASS** (zero errors, zero warnings)
- Dev server: `✓ Compiled` cleanly, GET / returns 200

## Files Touched

- `src/lib/studio/engine/flowEngine.ts` (NEW, ~640 lines)
- `src/lib/studio/engine/psy4EngineV2.ts` (EXTENDED — flow engine integration + P1 stubs)
