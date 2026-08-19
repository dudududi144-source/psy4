# PSY4 — Claims vs Reality Roast (Honest)

> This document is a self-roast. It compares what the worklog *claims* the engine does
> against what the code *actually* does, in commercial-production terms.
> Every gap listed here is then fixed in code (see "Fix Applied" notes + commits).

## Methodology

I read the actual source:
- `src/lib/psyLive4/psyLive4.ts` (1018 lines)
- `src/lib/psyLive4/radio-listener.ts` (292 lines)
- `src/lib/psyLive4/audio-quality.ts` (221 lines)
- `src/lib/psyLive4/learning.ts` (110 lines)
- `src/lib/devices/{lead,melodic,drum,sampler}-device.ts`
- `public/worklets/psy4-lead-worklet.js` (292 lines)

I then asked: "If a paying customer runs this, does it do what the logs say it does?"

The answer: **partially**. The architecture is real. The signal flow is real.
But the *learning convergence*, *BPM detection*, *target logic*, and *persistence*
are broken in ways the logs hide. Details below.

---

## GAP 1 — CLAIM: "Learning loop converges (engine learns to sound like radio)"

**Worklog says:**
> radio → analyze → smoothed targets → delta = engine - radio → adjust CC → converge

**Code reality (`psyLive4.ts:648-724`):**
The delta-based CC adjustments live **inside `getState()`** — a method the UI
calls 4-10× per second for display. Every call:
- re-analyzes engine quality
- computes 5 deltas
- adjusts CC74, CC71, CC12, CC15, `_highGain`, `_lowGain`, `_midGain`
- writes 1-3 `console.log` lines

There is no settle time. There is no "trial". The 8-second trial in
`CCLearner.tick()` is *technically* still running, but its output is
overwritten by the delta adjustments 32-80 times during one "trial".

**Commercial impact:** The CC values oscillate forever. The engine never
converges — it thrashes. "Learns to sound like radio" is false; it actually
sounds like a knob being wiggled 8 times a second.

**Fix applied:** Move all delta adjustments into a dedicated
`learningInterval` (4000ms). `getState()` becomes a pure getter again
(no side effects). The CCLearner trial timer now actually controls the
cadence.

---

## GAP 2 — CLAIM: "BPM detection via energy-based onset detection"

**Worklog says:**
> BPM: energy-based onset detection in low band (20-200Hz)

**Code reality (`radio-listener.ts:138, 215-268`):**
`startAnalysis()` sets `setInterval(() => this.analyze(), 2000)`.
`analyze()` calls `detectBPM()` once per 2-second tick.

At 145 BPM, beats are **414ms apart**. Between two `analyze()` calls,
**4-5 beats occur** and are completely invisible to the detector.

Worse: `detectBPM()` reads `freqBuf` exactly once and checks
`avgLowEnergy > avgEnergy * 1.3`. With 50 samples of history at 2s
granularity, the "average" is over 100 seconds — totally stale.

The "interval = now - lastBeatTime" is always ≥ 2.0s → 30 BPM → folded
to 60 BPM. **Every detected "BPM" is mathematically forced to ~60.**

The "BPM=145" shown in the worklog is `effectiveBpm || 145` — i.e.
the fallback default, NOT a detected value.

**Commercial impact:** "Engine syncs BPM to radio" is false. The engine
always plays at the hardcoded 145 BPM fallback. The radio could be at 138
or 152 and the engine wouldn't know.

**Fix applied:** Split analysis into two loops:
- `bpmInterval` at 50ms (20Hz) — only runs `detectBPM()` (cheap, energy only)
- `qualityInterval` at 2000ms — runs full `analyzeQuality()` + smoothing

This catches beats at 20Hz granularity (5 samples per beat at 145BPM).

---

## GAP 3 — CLAIM: "COMMERCIAL_TARGETS updated with real measurements"

**Worklog says:**
> COMMERCIAL_TARGETS updated with real radio values

**Code reality (`psyLive4.ts:454-462`):**
```ts
COMMERCIAL_TARGETS.brightnessMin = Math.max(0.2, target.brightness - 0.15);
COMMERCIAL_TARGETS.brightnessMax = Math.min(0.9, target.brightness + 0.15);
```

If `target.brightness = 0.09` (dark stream, measured in worklog):
- `brightnessMin = max(0.2, -0.06) = 0.20`
- `brightnessMax = min(0.9, 0.24) = 0.24`

So `Min=0.20` and `Max=0.24` — a 0.04-wide window. Any engine brightness
outside [0.20, 0.24] triggers an adjustment. The engine is *forced* into a
4% brightness band. This is not "learning a target", it's "clamping to a
noise spike".

Also: `COMMERCIAL_TARGETS` is a **shared mutable global**. When radio
disconnects, the targets stay stuck at the last stream's values. Next
session starts with leftover targets from a previous stream.

**Commercial impact:** The "commercial targets" are noise-shaped, not
commercial-shaped. They drift with whatever the radio's last measurement
was, including silence gaps and breakdowns.

**Fix applied:**
- `clampTargets(target)` ensures `Min ≤ Max` with a minimum 0.20 spread.
- `restoreDefaultTargets()` called on radio disconnect.
- Store original defaults immutably; never mutate the export.

---

## GAP 4 — CLAIM: "Learning adjusts CC params to close the gap"

**Worklog says:**
> if delta.brightness > 0.1: reduce CC74 (engine too bright)
> if delta.smoothness < -0.15: reduce CC71+CC12 (engine too harsh)

**Code reality (`psyLive4.ts:392-398`):**
```ts
setCC(cc, value): boolean {
  this.ccParams[cc] = v;
  this.melodicDevice.setParameterByCC(cc, v);
  this.leadDevice.setCC(cc, v);
  return true;
}
```

`setCC` routes to **melodic + lead only**. The `DrumDevice` and
`SamplerDevice` are NOT called. Half the mix (drums are usually 50%+ of
psytrance loudness) is invisible to learning.

When "engine too harsh" fires, it reduces lead/melodic cutoff — but the
harsh hi-hats and snare tops (which live in `DrumDevice`) are untouched.
The delta re-measures, still harsh, reduces CC74 again, lead goes muddy
and dark while hats keep squealing.

**Commercial impact:** "Learning closes the gap" is half-true. It closes
the gap on melodic content while drums run wild. The mix gets worse, not
better, as learning runs.

**Fix applied:** Add `setCC(cc, value)` to `DrumDevice` (routes to hat
cutoff / snare top filter). `SamplerDevice` is sample-based, so we route
CC12 (energy macro) to its output gain instead. Now learning can touch
all 4 devices.

---

## GAP 5 — CLAIM: "Tracks best params per CC across sessions"

**Worklog says:**
> Tracks best params per CC across sessions

**Code reality (`learning.ts:25, 98-108`):**
```ts
private bestParams: Record<number, number> = {};
// ...
reset(): void {
  // wipes everything including bestParams
  this.bestParams = {};
}
```

And in `psyLive4.ts:472-474`:
```ts
setLearning(on: boolean): void {
  this.learningOn = on;
  if (on) {
    this.learner.reset();   // <-- WIPES best params when enabling!
```

So enabling learning **destroys** the memory it claims to preserve.
And `bestParams` is in-memory only — page refresh loses everything.

**Commercial impact:** Every time the user toggles learning, all progress
is erased. Every page refresh, all progress is erased. "Across sessions"
is false. There is no memory.

**Fix applied:**
- `bestParams` + `bestReward` persisted to `localStorage` on every update.
- Loaded from `localStorage` on construction.
- `reset()` no longer wipes `bestParams` (only wipes current trial state).
- New method `forgetAll()` for explicit wipe.

---

## GAP 6 — CLAIM: "learningTrialRemaining: seconds left in current trial"

**UI field says:** shows countdown of remaining trial time.

**Code reality (`learning.ts:88-93`):**
```ts
getCurrentTrial(): { cc: number; remainingSec: number } {
  return {
    cc: EXPLORABLE_CCS[this.currentIdx],
    remainingSec: Math.max(0, this.trialDuration - (Date.now() / 1000 - this.trialStartTime)),
  };
}
```

`this.trialStartTime` is set from `this.ctx.currentTime` (line 720 of
psyLive4.ts). `ctx.currentTime` is seconds since the AudioContext was
created — typically a small number like `5.2` or `142.7`.

`Date.now() / 1000` is Unix epoch seconds — ~`1.7 × 10^9`.

`Date.now()/1000 - ctx.currentTime` ≈ `1.7 × 10^9`.

`remainingSec = 8 - 1.7×10^9` = huge negative → `Math.max(0, ...)` = **0**.

The UI always shows "0 seconds remaining". Always.

**Commercial impact:** The trial countdown is dead. The user sees "0"
forever. This is cosmetic but it's a lie — the dashboard claims to show
learning progress and shows nothing of the sort.

**Fix applied:** Pass `ctx.currentTime` into `tick()` (already done) and
use it consistently in `getCurrentTrial(now)`. Remove `Date.now()`
entirely from the learner.

---

## GAP 7 — CLAIM: "5s warmup prevents analyzing silence"

**Worklog says:**
> 5s warmup (skip during buffering) — no more analyzing silence

**Code reality:**
The warmup only applies to the **radio** analyser (`radio-listener.ts:145`).
The **engine** analyser in `psyLive4.ts:648-724` has NO warmup.

When the user clicks Play:
- t=0: scheduler hasn't composed yet
- t=0.1: `getState()` called by UI → `analyzeQuality(this.analyser)` reads silence
- t=0.1: delta = silence - radio = large negative deltas
- t=0.1: "engine too quiet" → CC12 boosted to 0.9, lowGain to 2.0
- t=0.5: first notes start playing — but CC12 + lowGain are already maxed
- t=0.5: engine is now WAY too loud + muddy because of premature boost

Also: when the tab is backgrounded, `ctx.suspend()` freezes the audio
clock, but React keeps calling `getState()` (UI polling). The analyser
returns stale zeros → delta goes negative → CC12 maxed. When the user
returns, the engine is slammed.

**Commercial impact:** Every play start begins with a wrong-sounding
boost. Every tab-switch corrupts the learning state.

**Fix applied:**
- Engine warmup: skip learning adjustments for first 5s of `play()`.
- Suspended guard: skip learning adjustments when `this.suspended` or
  `ctx.state !== 'running'`.
- Both checks in the new dedicated learning timer (not getState).

---

## GAP 8 — CLAIM: "If engine too loud → reduce CC12 + lowGain"

**Worklog says:**
> if delta.loudness > 0.15: reduce CC12 (engine too loud)

**Code reality (`psyLive4.ts:665-715`):**
All five delta branches fire **independently** every tick. So in one tick:
1. `delta.brightness > 0.1` → reduce CC74 + `_highGain` (less bright)
2. `delta.smoothness < -0.15` → reduce CC71 + CC12 + `_highGain` (less harsh)
3. `delta.loudness > 0.15` → reduce CC12 + `_lowGain` (less loud)
4. `delta.warmth < -0.15` → increase CC15 + `_lowGain` (more warmth)
5. `delta.punch < -0.15` → reduce CC12 + `_midGain` (restore punch)

Notice CC12 is reduced in (2), reduced in (3), reduced in (5) — but
increased in (1)? No, (1) reduces CC74. But (2)+(3)+(5) all hit CC12
down. Then `delta.loudness < -0.1` (next tick) bumps CC12 back up.

Also `_lowGain` is reduced in (3) but increased in (4). Direct conflict
within the same tick: `_lowGain = _lowGain - 0.02` then `_lowGain =
_lowGain + 0.03`. Net: +0.01. But the "reduce loudness" intent is lost.

**Commercial impact:** The adjustments fight each other. Net effect is
random walk, not convergence.

**Fix applied:** Apply **one** delta adjustment per learning tick
(4 seconds), chosen by largest-mitude delta. This gives each adjustment
time to take effect before the next is tried.

---

## GAP 9 — CLAIM: "analyzeQuality — 7 real audio quality metrics"

**Code reality (`audio-quality.ts:48-171`):**
Every call:
```ts
const freqData = new Uint8Array(analyser.frequencyBinCount);  // 512 bytes
const tdData = new Float32Array(analyser.fftSize);            // 4096 bytes
```

Called from: `getState()` (4-10×/sec) + radio `analyze()` (0.5×/sec).
= 5-11 allocations/sec × 4.5KB = ~25-50KB/sec of GC pressure.

The host class `psyLive4.ts` already has `this.freqBuf` and `this.tdBuf`
reused — but `analyzeQuality` ignores them and allocates fresh.

**Commercial impact:** On low-end mobile devices, this causes GC stutter
(audio glitches). On a long session (8h), the GC pressure is constant
and unnecessary.

**Fix applied:** `analyzeQuality` accepts optional reusable buffers.
Host passes its own `freqBuf`/`tdBuf`. Zero allocation per call.

---

## GAP 10 — CLAIM: "smartRadioNextStyleChange: seconds until next auto style change"

**`psyLive4.ts:753`:**
```ts
smartRadioNextStyleChange: 0,
```

Hardcoded. Always 0. The UI shows a countdown that's always zero.

**Origin:** This field was for the OLD fake Smart Radio (random style
cycling every 2 min). When the real RadioListener replaced it, this
field was left as a dead stub.

**Commercial impact:** Minor — but it's a lie on the dashboard.

**Fix applied:** Remove `smartRadioNextStyleChange` from `LiveState4`.
The UI should not show what doesn't exist. If a countdown is desired,
add a real one later.

---

## GAP 11 — Dead code: `bpmHistory` in radio-listener.ts

**`radio-listener.ts:45, 265-267`:**
```ts
private bpmHistory: number[] = [];
// ...
return this.bpmHistory.length > 0
  ? this.bpmHistory[this.bpmHistory.length - 1]
  : 0;
```

`bpmHistory` is **never written to** (no `.push()`). It's a dead field.
The fallback return is always `0`.

Also: `energyHistory` is NOT cleared on `disconnect()` (line 104-118
clears `beatTimes` and `bpmHistory` but not `energyHistory`). When
switching streams, the energy baseline from stream A bleeds into stream
B's BPM detection.

**Fix applied:** Remove `bpmHistory`. Clear `energyHistory` on disconnect.

---

## Summary table

| # | Claim | Reality | Severity |
|---|-------|---------|----------|
| 1 | Learning converges | Thrashes 4-10×/sec, never settles | **Critical** |
| 2 | BPM detected from radio | 2s sample rate misses 4-5 beats; always returns 60 or fallback | **Critical** |
| 3 | Real commercial targets | Min>Max logic; stuck on disconnect; shared mutable | **High** |
| 4 | Learning adjusts CC | Only melodic+lead; drums uncontrollable | **High** |
| 5 | Memory across sessions | Wiped on enable; not persisted | **High** |
| 6 | Trial countdown | Always 0 (time-scale bug) | **Medium** |
| 7 | Warmup prevents silence | Only radio; engine has none; breaks on tab switch | **High** |
| 8 | Coordinated adjustments | 5 branches fight each other per tick | **High** |
| 9 | Efficient analysis | Allocates 4.5KB per call, 10×/sec | **Medium** |
| 10 | Style change countdown | Hardcoded 0; dead field | **Low** |
| 11 | Clean code | bpmHistory dead; energyHistory leaks across streams | **Low** |

**Verdict:** The *plumbing* is real (radio connects, analysis runs,
deltas are computed). The *control theory* is broken (no settle time,
no coordination, no persistence, no warmup, wrong sample rates).

A commercial customer who turns on "Learning" today hears a knob
wiggling, not convergence. After the fixes below, the engine actually
converges.
