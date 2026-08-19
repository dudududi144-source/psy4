# PSY4 — Deep Roast v2 (Beyond the 11 Surface Fixes)

> After fixing the 11 surface gaps in `PSY4_CLAIMS_VS_REALITY_ROAST.md`,
> this is the DEEPER examination: the structural, algorithmic, and
> perceptual gaps that prevent the engine from sounding COMMERCIAL.
>
> The surface fixes made the *plumbing* honest. This roast examines
> whether the engine can actually *achieve the goal*: "learn to sound
> like commercial psytrance radio."

## The Goal (restated)

> An engine that LISTENS to commercial psytrance radio, ANALYZES what
> makes it sound commercial, and LEARNS to produce output that is
> perceptually indistinguishable from the radio.

## Current state (after 11 surface fixes)

- Radio connects ✓
- 7 quality metrics extracted ✓
- BPM detected at 20Hz ✓
- Targets applied with safe spread ✓
- Learning loop runs at 4s intervals ✓
- CC routed to all 4 devices ✓
- bestParams persisted ✓
- Trial countdown works ✓
- Engine warmup + suspended guard ✓
- One delta per tick ✓

**So what's still wrong?** Everything below.

---

## DEEP GAP A — Composition is NOT learned (CRITICAL)

**The #1 commercial gap.** The learning system ONLY adjusts CC params
(timbre: cutoff, resonance, drive, reverb). It CANNOT learn:

- Which **notes** to play (melody, bassline)
- Which **rhythms** to play (pattern density, syncopation)
- Which **arrangements** work (when to drop, when to break)
- Which **harmonic progressions** match the radio

**Code evidence (`composer.ts`):**
```ts
const rng = mulberry32((req.seed ^ Math.floor(req.startTime * 1000)) >>> 0);
```
The composer is **fully deterministic** based on seed + time. It uses
style grammars (fixed `bassSteps`, `motifSteps`, `motifIntervals`).
There is NO feedback path from the learning system to the composer.

**Commercial impact:** Even with PERFECT CC matching, the engine will
NEVER sound like the radio because it's playing DIFFERENT NOTES in a
DIFFERENT ORDER. Matching brightness=0.5 while playing a completely
different bassline is like wearing the same color shirt as someone
while speaking a different language.

**The gap between us and the goal:** We measure the OUTPUT statistics
and match them. The goal requires matching the OUTPUT PERCEPTUALLY,
which requires matching the composition, not just the timbre.

**Fix:** Pattern memory — the composer records bar fingerprints +
their rewards, and biases future composition toward high-reward patterns.
This is the first step toward composition learning.

---

## DEEP GAP B — Analysis during breakdowns corrupts targets (HIGH)

**Radio streams have breakdowns** — quiet sections between drops where
the bass disappears, the energy drops, and the spectrum changes
completely. The current code analyzes these as if they were
representative of the "commercial sound."

**Code evidence (`radio-listener.ts:152`):**
```ts
if (metrics.loudness < 0.001 && metrics.brightness < 0.01) {
  console.log('[RadioListener] radio truly silent — skipping');
  return;
}
```
The silence threshold is `loudness < 0.001` — essentially digital
silence. A breakdown at -25 LUFS (loudness ≈ 0.18) passes this check
and updates the targets.

**Commercial impact:** When the radio hits a 16-bar breakdown, the
engine "learns" that commercial psytrance has low loudness, low warmth,
high smoothness. It then REDUCES its own bass and energy to match —
sounding like a breakdown, not a drop.

**Fix:** Breakdown detection — track loudness over a 30s window. If
current loudness < 60% of the 30s average, flag as breakdown and skip
target updates (but keep the previous good targets).

---

## DEEP GAP C — No convergence metric (HIGH)

**The user cannot see if the engine is converging.** The UI shows:
- CC values (current params)
- Trial countdown (seconds left)
- Learning states (per-CC reward)

But there is NO single number answering: "How close is the engine to
the radio RIGHT NOW?"

**Commercial impact:** The user toggles learning, waits, and has no
idea if it's working. They can't tell if the engine is at 30% or 80%
of the radio's quality. They can't tell if it's improving or stuck.

**Fix:** A `convergence` field in `LiveState4` — a 0..1 metric
computed as `1 - normalized_distance(engine_metrics, radio_metrics)`.
Display as a progress bar in the UI. Store the last 60 measurements
for a sparkline showing convergence over time.

---

## DEEP GAP D — LUFS is a crude approximation (MEDIUM)

**Commercial psytrance is mastered to -8 to -10 LUFS integrated.** The
engine's "loudness" metric is:

```ts
const db = 10 * Math.log10(meanSquare || 1e-10);
const lufs = db - 0.691;
const loudness = Math.max(0, Math.min(1, (lufs + 30) / 27));
```

This is **not LUFS**. Real LUFS requires:
1. K-weighting filter (high-shelf +4dB at 1500Hz, high-pass at 38Hz)
2. Gating (absolute -70 LUFS + relative -10 LUFS)
3. 400ms block integration

The current code uses raw mean square with a -0.691 offset (which is
the gating bias, but without the actual gating). This means "loudness"
tracks raw RMS, not perceived loudness.

**Commercial impact:** The engine can't target -9 LUFS because it can't
measure LUFS. "Engine too loud" adjustments are based on a metric that
doesn't match what mastering engineers measure.

**Fix:** Implement K-weighting (2-stage BiquadFilter) + block-based
gating. Or, for pragmatism, use Web Audio's `AnalyserNode` with a
pre-filter chain and compute gated mean square.

---

## DEEP GAP E — No error boundaries in setInterval (MEDIUM)

**If `runLearningTick()` throws** (e.g., `analyzeQuality` returns NaN,
`this.radioTarget` becomes null mid-tick, a BiquadFilter is disposed),
the `setInterval` callback throws and the loop SILENTLY DIES.

**Code evidence:**
```ts
this.learningInterval = setInterval(
  () => this.runLearningTick(),
  PsyLive4.LEARNING_INTERVAL_MS,
);
```
No try/catch. If `runLearningTick` throws once, the interval keeps
firing but every subsequent call also throws (if the state is broken),
and the user sees learning "stop working" with no error.

**Commercial impact:** A single NaN in the analyser (caused by a
glitch, a disposed node, or a race condition) kills learning forever
until page refresh. The user has no idea why.

**Fix:** Wrap the tick body in try/catch. Log the error, continue the
loop. Add a `learningErrors` counter to the state so the UI can show
"learning has encountered N errors."

---

## DEEP GAP F — No A/B comparison mode (MEDIUM)

**The user cannot do a blind A/B test.** To judge if the engine sounds
commercial, the user needs to:
1. Hear the radio alone (reference)
2. Hear the engine alone (test)
3. Switch between them instantly (A/B)

Currently, when radio is ON, both play simultaneously at 30%/100% mix.
There's no way to solo the radio or solo the engine.

**Commercial impact:** Perceptual validation is impossible. The user
can't tell if the learning is actually making the engine sound better,
because they can't isolate the two sources.

**Fix:** An A/B mode — `setRadioMix(mode: 'both' | 'radio' | 'engine')`.
- `both`: current behavior (radio 30%, engine 100%)
- `radio`: radio 100%, engine 0% (hear the reference)
- `engine`: radio 0%, engine 100% (hear the test)

Instant switching via UI button. This is the commercial A/B workflow.

---

## DEEP GAP G — Epsilon-greedy is too crude (MEDIUM)

**The learning algorithm is epsilon-greedy with per-CC epsilon decay.**
This means:
- 30% of the time: random exploration (or suggestion-guided)
- 70% of the time: exploit best historical value

Problems:
1. **No gradient signal.** When CC74=0.5 gives reward 0.4 and CC74=0.6
   gives reward 0.42, the learner doesn't know "higher is better." It
   just records both and picks the higher one. But with noisy metrics
   (they fluctuate ±0.05), the "best" is often noise.

2. **No directional memory.** If CC74=0.6 was better than 0.5, the
   learner should try 0.7 next. Instead, it randomly picks 0.2 or 0.8.

3. **Per-CC epsilon decays independently.** CC74 might be converged
   (epsilon=0.05) while CC15 is still exploring (epsilon=0.3). But
   the trial timer cycles through all CCs, so CC74 gets "explored" again
   every 48 seconds regardless.

**Commercial impact:** The learner converges slowly and unreliably.
It takes ~10 minutes to settle, and even then it's not clear if the
settled values are actually optimal or just local maxima.

**Fix (incremental):** Add directional exploration — if the last trial
moved CC in direction D and reward increased, move further in D. If
reward decreased, move opposite. This is a simple hill-climbing
enhancement to epsilon-greedy.

---

## DEEP GAP H — Analysis is not beat-synced (LOW-MEDIUM)

**The radio analysis runs on a fixed 2s timer.** At 145 BPM, 2 seconds
= ~4.8 beats. The analysis averages over partial bars, missing the
beat-level structure.

Commercial mastering analysis is beat-synced: you measure per-bar (1.65s
at 145 BPM), so each measurement captures exactly one bar's worth of
content. This gives cleaner, more comparable metrics.

**Commercial impact:** The metrics are noisier than they should be
because they average over arbitrary time windows that don't align with
the music's structure.

**Fix (incremental):** Detect bar boundaries (from BPM) and align the
quality analysis to bar edges. Measure exactly 1 bar per analysis.

---

## DEEP GAP I — No spectrogram comparison (LOW)

**The 7 aggregate metrics are too coarse.** Two completely different
spectra can have the same centroid, flatness, and band ratios.

A spectrogram overlap (or mel-spectrogram correlation) would give a
much stronger perceptual similarity signal.

**Commercial impact:** The engine could match all 7 metrics but still
sound nothing like the radio, because the metrics don't capture the
time-frequency structure.

**Fix (future):** Compute a downsampled mel-spectrogram (32 bands ×
8 time frames) for both engine and radio, compute cosine similarity.
This is the standard audio similarity metric.

---

## DEEP GAP J — Mastering chain is static (LOW)

**The multiband compressor + limiter settings are hardcoded.** They
don't adapt to the material. Commercial mastering chains adapt:
- Threshold tracks the input level
- Ratio increases during loud sections
- Attack/release adapt to the content

**Fix (future):** Make the compressor thresholds track the input
level (sidechain-style adaptive compression). This is how commercial
mastering limiters work (e.g., Pro-L 2's "true peak" mode).

---

## Summary — Priority for this round

| Gap | Severity | Fix complexity | This round? |
|-----|----------|-----------------|-------------|
| A — Composition learning | CRITICAL | High | **Yes** (pattern memory) |
| B — Breakdown detection | HIGH | Low | **Yes** |
| C — Convergence metric | HIGH | Low | **Yes** |
| D — Real LUFS | MEDIUM | Medium | Partial (K-weighting) |
| E — Error boundaries | MEDIUM | Low | **Yes** |
| F — A/B comparison | MEDIUM | Low | **Yes** |
| G — Directional exploration | MEDIUM | Medium | **Yes** (hill-climb) |
| H — Beat-synced analysis | LOW-MED | Medium | Skip (refinement) |
| I — Spectrogram overlap | LOW | High | Skip (future) |
| J — Adaptive mastering | LOW | High | Skip (future) |

**This round implements: A (pattern memory), B (breakdown), C
(convergence), E (error boundaries), F (A/B mode), G (hill-climb).**

These are the highest-impact, achievable fixes that move the engine
from "honest plumbing" toward "actually achieves the commercial goal."
