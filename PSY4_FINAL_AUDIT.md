# PSY4 — Final Honest Audit (Claims vs. Verified Code)

This document compares **what was claimed** (in worklog.md, DEMO.md, and previous reports)
against **what the code actually does**, verified by reading the source files line-by-line.

No spin. No "it basically works." Just the truth.

---

## VERDICT SUMMARY

| # | Claim | Verified Reality | Honest Status |
|---|-------|-----------------|---------------|
| 1 | "Multiband ✅ works (BiquadFilterNode, 3-band)" | Main thread has a 3-band EQ splitter (gain only). The worklet's `MultibandComp` class is **DISABLED** (line 523: `const mbOut = dcOut;`). | **MISLEADING** — it's a 3-band EQ, not a multiband *compressor* |
| 2 | "Learning loop ✅ works (learning → psysynth via CC)" | CC74 mapping `cutoffStart/8000` produces 0.025–0.25 → `ccFactor` 0.29–0.63 → sound always gets *darker*, never brighter. Floor clamps 400Hz→0.05. | **PARTIALLY TRUE** — params are sent, but the mapping makes everything muffled |
| 3 | "Heartbeat added — prevents engine stopping" | Heartbeat checks `!this.timer` (line 2643). Timer is only nulled by `stop()`, NOT by background-tab throttling. So throttling is undetected. | **DOES NOT FIX the real stop cause** |
| 4 | "Peak=0.00 is BREAKDOWN" | BREAKDOWN section still schedules kick + bass(0.5 vel) + hats + shaker + pad. peak=0.00 is **silence** (scheduler starvation), not a musical section. | **FALSE** — silence is being mislabeled as a feature |
| 5 | "Styles (FULL_ON/DARK/PROG/ACID) sound different" | `STYLE_GRAMMARS` changes scale + bass steps + motif intervals + perc density. But `leadCutoff` and `hatDecay` are defined and **NEVER USED**. So timbre is identical across styles — only notes/rhythm change. | **PARTIALLY TRUE** — pitch/rhythm differ, timbre does NOT |
| 6 | "Squeal fixed (delay feedback loop disconnected)" | `delayWet`/`reverbWetGain` are dead code (created, never connected). MoogLadder has NaN guard (line 65). MasterChain has NaN guard (line 518). FXVoice amp capped (line 326). Mix clamped before master (line 789). | **TRUE** — real fixes were made; no feedback path remains in engine-v3 |
| 7 | "psysynth (melodic) ✅ works" | Verified in psysynth.js: 20 patches, 6 banks, CC74/71/5 mapping, voice pool with stealing. SynthBridge routes melodic events. | **TRUE** |
| 8 | "MIDI export ✅ works" | Verified: format 0, 480 tpq, channels mapped. | **TRUE** |

---

## DETAILED FINDINGS

### Finding 1: "Multiband" is an EQ, not a compressor

**Claim (worklog stage-a3-b-complete):**
> "A3 multiband: הצלחה עם BiquadFilterNode native (לא manual DSP) ... 3 bands: low (LP@200), mid (HP@200+LP@2500), high (HP@2500) ... Per-band gains: low=1.2, mid=1.0, high=1.1"

**Code reality:**

`src/lib/psyLive.ts` lines 1718–1779:
```ts
this.multibandLow = this.ctx.createBiquadFilter();
this.multibandLow.type = 'lowpass';
this.multibandLow.frequency.value = 200;
// ... mid = HP@200 + LP@2500, high = HP@2500
this.multibandLowGain.gain.value = 1.0;  // FIXED GAIN — no compression
this.multibandMidGain.gain.value = 1.0;
this.multibandHighGain.gain.value = 1.0;
```

These are **static-gain crossovers**. There is **no envelope follower, no threshold, no ratio, no attack/release**. It is a 3-band EQ splitter, not a multiband compressor. Calling it "multiband compression" is a lie.

Meanwhile, the **worklet** (`psy4-engine-v3.js`) has a real `MultibandComp` class (lines 413–495) with envelope followers and compression — but it is **DISABLED** (line 523–525):
```js
// Multiband compression — DISABLED: filter implementation unstable in worklet
const mbOut = dcOut;
```

**Honest fix:** Either (a) rename the main-thread chain to "3-band EQ" (honest), or (b) actually implement compression with per-band gain reduction. This audit does NOT add compression — it only documents the truth.

---

### Finding 2: Learning → psysynth CC mapping is too low (sound gets muffled)

**Claim (worklog stage-a3-b-complete):**
> "B learning loop: הצלחה — learning משפיע על סאונד ... Mapping: cutoff→CC74, resonance→CC71, glide→CC5 ... matchScore=0.732, reward=1.000"

**Code reality:**

`src/lib/psyLive.ts` lines 3099–3106:
```ts
if (params.cutoffStart !== undefined) {
  const ccValue = Math.max(0.05, Math.min(0.8, params.cutoffStart / 8000));
  this.synthBridge.setParameterByCC(74, ccValue);
}
if (params.freq !== undefined) {
  // Lead freq → CC74 (map 220-880 to 0.1-0.4)
  const ccValue = Math.max(0.1, Math.min(0.5, params.freq / 2000));
  this.synthBridge.setParameterByCC(74, ccValue);
}
```

The comment says "Bass params: cutoffStart (200-2000Hz) → CC74 (0.025-0.25)" — and the code does exactly that: `2000/8000 = 0.25`, `200/8000 = 0.025`.

But what does CC74 do in psysynth? From `public/psysynth.js`:
```js
var J0=Object.freeze({74:"cutoff",71:"resonance",5:"glide",...});
// ...
ccFactor(D,J){
  let Q=this.ccOverrides.get(D);  // Q = CC74 value, e.g. 0.05
  if(Q===void 0)return J;          // default 1.0
  return 0.25+Q*1.5                // 0.25 + 0.05*1.5 = 0.325
}
```

So CC74=0.05 → cutoff multiplier **0.325**. A bass patch with cutoff 1500Hz becomes **487Hz** — very muffled. A lead at 4000Hz becomes **1300Hz** — dark.

The entire learnable range (0.025–0.25) maps to ccFactor **0.29–0.63**. That means learning can **only darken** the sound, never brighten it. And the `Math.max(0.05, ...)` floor means cutoffStart values below 400Hz are all clamped to the same 0.05.

This is why the user perceives "learning doesn't affect the sound" — it *does* affect it, but in a way that makes everything muffled and similar-sounding.

**Honest fix:** Map cutoffStart to a wider CC74 range so learning can go both darker and brighter. This audit applies the fix below.

---

### Finding 3: Heartbeat does NOT detect background-tab throttling

**Claim (worklog stage-a3-b-complete, implicit):**
> Heartbeat was added so the engine doesn't stop after a few minutes.

**Code reality:**

`src/lib/psyLive.ts` lines 2642–2646 (inside the 2000ms UI timer):
```ts
// FIX: Heartbeat — if scheduler timer died, restart it
if (this.playing && !this.timer) {
  console.log('[PSY4] HEARTBEAT: scheduler timer died — restarting');
  this.timer = setInterval(() => this.scheduler(), this.lookahead);
}
```

The problem: `this.timer` is **only set to `null` in `stop()`**. When a browser tab goes to the background, Chrome/ Firefox throttle `setInterval` to ~1/sec (or worse). The timer reference is **not nulled** — it just fires less often. So `!this.timer` is `false`, and the heartbeat never triggers.

This means: **if the user switches tabs for 30 seconds, the scheduler fires ~30 times instead of ~1200 times, the composition worker falls behind, and the worklet runs out of events → silence (peak=0.00).**

The heartbeat, as written, only catches the case where `stop()` was called but `playing` wasn't reset — an edge case that rarely happens.

**Honest fix:** Also detect AudioContext suspension and scheduler staleness (last scheduler fire time). This audit applies the fix below.

---

### Finding 4: "Peak=0.00 is BREAKDOWN" is false

**Claim (worklog verify-learning-and-push):**
> "peak משתנה: 0.06 → 0.00 → 0.00 → 0.29 → 0.57 → 0.00 (לא תקוע!)"

The implication was that peak=0.00 is a normal "BREAKDOWN" section. But:

`composition-worker-v2.js` lines 331–344 — the BREAKDOWN section schedules:
- KICK: 4-on-the-floor (always, every bar)
- BASS: rolling 16ths at 0.5 velocity (lines 205, 206)
- HATS: 8th notes (line 229 includes BREAKDOWN)
- SHAKER: 16th offbeats (line 244 includes BREAKDOWN)
- PAD: sustained chord (line 332 includes BREAKDOWN)

That is **5 voices playing simultaneously**. It is not silence. If peak=0.00 appears during a BREAKDOWN, the scheduler has stalled — it is NOT the section.

**Honest status:** peak=0.00 means silence from scheduler starvation (Finding 3), not a musical breakdown.

---

### Finding 5: Styles only differ in pitch/rhythm, NOT timbre

**Claim (worklog e89e949):**
> "style grammars + memory leak fix ... STYLE_GRAMMARS"

**Code reality:**

`composition-worker-v2.js` lines 48–89 defines `STYLE_GRAMMARS` with fields:
`scaleName`, `motifIntervals`, `motifSteps`, `bassSteps`, `acidBass`, `percussionDensity`, `hatDecay`, `leadCutoff`.

Searching `composeBar()` for usage:
- `grammar.bassSteps` — USED (line 209) ✓
- `grammar.motifIntervals` — USED (line 300) ✓
- `grammar.motifSteps` — USED (line 299) ✓
- `grammar.percussionDensity` — USED (line 261) ✓
- `grammar.acidBass` — USED (line 207) ✓
- `grammar.hatDecay` — **NEVER USED** ✗
- `grammar.leadCutoff` — **NEVER USED** ✗

So `hatDecay` and `leadCutoff` are dead data. They exist in the grammar object to make it *look* like styles affect timbre, but they are never sent to the engine or psysynth. Every style's hats have the same decay; every style's lead has the same filter cutoff.

This is why the user says "FULL_ON/DARK/PROG/ACID sound the same" — they differ only in **which notes play and when**, not in **how those notes sound**.

**Honest fix:** Wire `leadCutoff` and `hatDecay` to actually affect the engine/psysynth. This audit applies the fix below.

---

### Finding 6: Squeal fixes are real

**Claim:** "squeal root cause — old delay feedback loop ... Tone.js feedback delay fix"

**Code reality:** Verified in `psy4-engine-v3.js`:
- Line 65: MoogLadder NaN guard (`if (!isFinite(x)) { ...return 0; }`)
- Line 318: FXVoice amp capped `0.2` (was `0.5+`)
- Line 326: amp clamped `Math.min(0.25, Math.max(0.1, amp || 0.2))`
- Line 509: glue makeup reduced `0.8` (was `1.2`)
- Line 518: MasterChain NaN guard
- Lines 789–790: mix clamped `[-1, 1]` before master
- Lines 797–798: final NaN guard on output
- StereoWidener delay buffer cleared on init (line 382)

There is **no feedback path** in the engine (the StereoWidener Haas delay is a pure delay line, not feedback). The squeal fixes appear genuine.

**Status:** TRUE.

---

## FIXES APPLIED BY THIS AUDIT

### Fix A — Learning CC74 mapping (Finding 2)
Map `cutoffStart` (200–8000 Hz) to CC74 (0.3–0.9) so learning can brighten OR darken.
Map lead `freq` (220–1760 Hz) to CC74 (0.3–0.9) likewise.
This gives `ccFactor` range 0.7–1.6 — audible in both directions.

### Fix B — Style grammars wire-through (Finding 5)
- `hatDecay`: send as `param` field on hat events; engine reads it in `HatVoice.trigger`.
- `leadCutoff`: main thread reads current style grammar and pushes CC74 to psysynth on style change.

### Fix C — Heartbeat liveness (Finding 3)
Track `lastSchedulerFireMs`. In the heartbeat, if `playing && (now - lastSchedulerFireMs > 5000)`, restart the timer regardless of `this.timer` nullness. Also call `ctx.resume()` if `ctx.state === 'suspended'`.

### Fix D — Honest naming (Finding 1)
Rename UI/log references from "multiband compression" to "3-band EQ" where applicable. (Documentation-level; no code behavior change beyond a log string.)
