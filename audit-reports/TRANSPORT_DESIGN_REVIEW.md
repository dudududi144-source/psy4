# TRANSPORT DESIGN REVIEW

## F1.0 — Design Review Before Code

**Date:** 2026-08-12
**Status:** DESIGN — no implementation yet
**Sources reviewed:**
- `psy/PSY6_ARCHITECTURE.md` (216 lines) — blueprint
- `psy4/src/lib/beatPLL.ts` (213 lines) — current PLL
- `psy4/src/lib/psyLive.ts:506-547` — current scheduler
- `psy/index.html:900-920` — psy mainline scheduler
- `psy5/index.html:152-170` — psy5 worker timer pattern
- `psy4/tests/reality-bridge/beatpll-convergence.ts` — 48 convergence tests
- `psy4/tests/reality-bridge/run-all.ts` — 56 regression tests

**Rule:** PSY6_ARCHITECTURE.md is a blueprint, NOT truth. Code and tests are truth. Contradictions are documented, not hidden.

---

## 1. OWNERSHIP QUESTIONS

### Q: Who owns time?

**Blueprint says:** "AudioContext.currentTime (the ONLY clock)" (PSY6_ARCHITECTURE.md §3).

**Reality:** THREE different time sources are used in practice:
1. `AudioContext.currentTime` — used for audio scheduling (psyLive.ts:512, psy:910)
2. `Date.now()` — used for style hysteresis (psyLive.ts:756-759: `styleCandidateSince = Date.now()`)
3. `setInterval()` ticks — used as musical wakeup (psyLive.ts:427, psy:902)

**Contradiction #1:** Style switching uses `Date.now()` for the 8-second hysteresis, but should use audio time. If the tab is suspended, `Date.now()` keeps ticking but audio time doesn't — the style could switch during suspension.

**Decision:** Transport owns time. `AudioContext.currentTime` is the ONLY musical clock. `Date.now()` and `performance.now()` are forbidden for musical decisions. `setInterval`/Worker/rAF are wakeup mechanisms only.

### Q: Who owns BPM?

**Blueprint says:** "Transport" (§2 ownership table).

**Reality:** BPM is owned by THREE separate variables in psyLive.ts:
1. `this.engineBpm` (line 174) — the engine's playback tempo
2. `this.radioBpm` (line 173) — the PLL's detected tempo
3. `this.pll.bpm` (beatPLL.ts:62) — the PLL's internal estimate

Plus `this.musicState.bpm` (line 149) which is set to `radioBpm || engineBpm` (line 749).

**Contradiction #2:** Four variables claim to own "what's the current BPM". The scheduler uses `this.pll.getBpm()` when PLL is locked (line 518) and `this.engineBpm` when not (line 497). These can differ by several BPM.

**Decision:** Transport owns BPM. There is ONE `bpm` in the Transport snapshot. The PLL feeds observations to Transport; Transport decides the effective BPM (which may be the PLL's estimate, the internal tempo, or a holdover value). `engineBpm`, `radioBpm`, and `musicState.bpm` are eliminated.

### Q: Who owns phase?

**Blueprint says:** "Transport" (§2).

**Reality:** Phase is computed in TWO places:
1. `BeatPLL.getPhase(now)` (beatPLL.ts:166) — computes from `beatTime`
2. `psyLive.ts` doesn't explicitly compute phase, but `scheduleStep` uses `step % 16` which is implicitly a phase within a bar

**Contradiction #3:** The PLL's `beatTime` is a smoothed variable that drifts over time (it's corrected by `phaseGain * error` but never re-anchored). After 30 minutes, `beatTime` may have accumulated significant error relative to the true beat grid.

**Decision:** Transport owns phase. Phase is computed from the anchor: `phase = ((now - anchorTime) / beatDuration) % 1`. The PLL feeds observations; Transport re-anchors at safe boundaries.

### Q: Who owns bar?

**Blueprint says:** "Transport" (§2: `barIndex`).

**Reality:** Bar is tracked by THREE counters:
1. `this.pll.beatIndex` (beatPLL.ts:64) → `barIndex = Math.floor(beatIndex / 4)` (line 123)
2. `this.step` (psyLive.ts:227) → `step % 16 === 0` triggers bar increment (line 522)
3. `this.barCount` (psyLive.ts:219) — separate counter for mutation timing (line 523)

**Contradiction #4:** `step` and `barCount` are independent of `pll.beatIndex`. When the PLL re-anchors, `step` and `barCount` don't reset. They can diverge.

**Decision:** Transport owns bar. `barIndex = Math.floor(beatIndex / beatsPerBar)`. The scheduler's `step` and `barCount` are derived from Transport's snapshot, not independently tracked.

### Q: Who can change tempo?

**Blueprint says:** "Transport only" (§2: writers = "Transport only").

**Reality:** Tempo is changed in 4 places:
1. `setPreset()` (psyLive.ts:477) — sets `engineBpm = p.bpm`
2. `onKick()` (psyLive.ts:844) — smooths `engineBpm` toward PLL BPM
3. `toggleComposition()` (psyLive.ts:574) — sets `engineBpm = composition.bpm`
4. `BeatPLL.update()` (beatPLL.ts:123) — changes `this.bpm` internally

**Contradiction #5:** `setPreset()` can override the PLL's tempo. If the user selects a 138 BPM preset while the radio is at 145 BPM, `engineBpm` jumps to 138, but the PLL is still tracking 145. The scheduler then uses the PLL's 145 (because `isLocked()` is true), ignoring the preset. The preset change is silently ineffective.

**Decision:** Transport owns tempo changes. `setTempo()` is the only API. When following radio, Transport adopts the PLL's tempo (smoothed). When internal, Transport uses the preset's tempo. The source field (`internal` vs `radio`) determines which.

---

## 2. BEHAVIORAL QUESTIONS

### Q: What happens when radio tempo changes?

**Current behavior:** The PLL's `bpm` updates via `this.bpm += (observedBpm - this.bpm) * tempoGain` (beatPLL.ts:123). Then `onKick()` smooths `engineBpm` toward `pllBpm` (psyLive.ts:844: `this.engineBpm += (pllBpm - this.engineBpm) * 0.3`). This is a double-smoothing: PLL smooths, then engine smooths again.

**Problem:** The double-smoothing means tempo changes are sluggish. At 145→155 BPM radio jump, the PLL converges in ~50 beats (per convergence tests), then the engine follows with another 0.3 gain — adding ~10 more beats. Total: ~60 beats (≈24 seconds at 150 BPM) to reach the new tempo.

**Decision:** Transport uses single smoothing. The PLL's `bpm` IS the transport's tempo when `source === 'radio'`. No additional smoothing layer. The PLL's `tempoGain=0.08` is the single smoothing parameter.

### Q: What happens when radio disappears?

**Current behavior:** `disconnectRadio()` (psyLive.ts:657) calls `pll.reset()`, which clears all PLL state. The scheduler then falls back to the `else` branch (line 536) using `nextNoteTime += stepDur()` with `engineBpm`. There's no holdover — the tempo immediately reverts to the preset's BPM.

**Problem:** If the radio drops for 2 seconds then comes back, the PLL resets and has to re-lock from scratch (8 observations = ~3 seconds at 150 BPM). During the gap, the engine jumps to the preset BPM, which may be different from the radio's BPM. When the radio returns, there's a jarring tempo discontinuity.

**Decision:** Transport has a HOLDOVER mode. When radio observations stop:
- Transport continues at the last known BPM
- Confidence decays exponentially (half-life ~10 seconds)
- `source` transitions from `'radio'` to `'internal'` (holdover)
- When radio returns, Transport re-evaluates: if the new BPM is within ±5% of holdover, re-locks smoothly; if not, re-anchors at the next bar boundary

### Q: What happens after tab suspension?

**Current behavior:** `setInterval` in background tabs is throttled to 1Hz (or worse). When the tab resumes:
- `psyLive.ts` scheduler: `nextNoteTime` is far behind `ctx.currentTime`. The `while (nextNoteTime < now + 0.15)` loop tries to schedule ALL missed steps — potentially hundreds. This causes a burst of audio events and possible main-thread stall.
- `psy` scheduler: same pattern (`while (nextNoteTime < ctx.currentTime + 0.14)`).

**Problem:** This is explicitly listed as risk #2 in PSY6_ARCHITECTURE.md §9: "setInterval scheduler + 0.14s lookahead → background-tab stalls".

**Decision:** Transport uses anchor-based time. When the scheduler wakes after a stall:
- It reads `ctx.currentTime`
- Computes the current beat/bar from the anchor: `beatIndex = floor((now - anchorTime) / beatDuration)`
- Schedules only events in the future (next 150ms)
- Drops all stale events (events that should have fired during the stall)
- Policy: **DROP STALE EVENTS** (not catch-up). Musical time continues; the scheduler doesn't try to "fill in" missed notes.

### Q: What happens after AudioContext interruption?

**Current behavior:** `ensureAudio()` (psyLive.ts:315) calls `ctx.resume()` if suspended. But there's no handling of the time gap — if the context was suspended for 5 seconds, `currentTime` jumps forward by 5 seconds. The scheduler's `nextNoteTime` is now far behind, causing the same stale-event problem as tab suspension.

**Decision:** Transport detects AudioContext state changes. On `resume`:
- Re-anchor: `anchorTime = ctx.currentTime`, `anchorBeatIndex = current beat index`
- Increment `epoch` (so consumers can detect the interruption)
- Drop stale events (same policy as tab suspension)

### Q: What happens after seek?

**Current behavior:** No seek API exists in psyLive.ts. `psy` has `seekToBar()` (line 922) which sets `absStep = bar * 16` but doesn't update `nextNoteTime` — the scheduler will still try to schedule from the old `nextNoteTime`.

**Decision:** Transport has `seek(beatIndex)`. This:
- Sets `anchorBeatIndex = beatIndex`
- Sets `anchorTime = ctx.currentTime`
- Increments `epoch`
- Future snapshots will reflect the new position

### Q: What happens with half/double tempo ambiguity?

**Current behavior:** BeatPLL handles this via the two-candidate `periodsElapsed` selection (beatPLL.ts:108-113). But it picks ONE candidate and commits — there's no hypothesis tracking. If the PLL locks to 75 BPM when the real tempo is 150 BPM, it stays locked wrong.

**Problem:** The 48 convergence tests show the PLL handles half/double tempo correctly in MOST cases, but the `half_tempo_input` test at 120 BPM initially failed (converged to 177 BPM instead of 120). The two-candidate fix resolved it, but the approach is fragile — it depends on the current BPM being close enough to the true BPM for the candidate selection to work.

**Decision:** Transport tracks `tempoHypotheses`. When the PLL detects ambiguity (observedInterval is close to 2× or 0.5× the current period), Transport:
- Keeps the current hypothesis as primary
- Records the alternative as a secondary hypothesis
- If the alternative gets more evidence over the next 8 beats, switches
- During ambiguity: `locked = false` or `confidence` is reduced
- **No false certainty.**

### Q: What happens with beat dropout?

**Current behavior:** BeatPLL handles missing beats via `periodsElapsed > 1` (beatPLL.ts:108-113). If 25% of beats are missing, the PLL still converges (per PLL-2C test). But if ALL beats stop, the PLL just stops updating — `beatTime` and `bpm` freeze at their last values.

**Decision:** Transport handles dropout via holdover (see "radio disappears" above). Confidence decays. If beats resume, Transport re-evaluates.

---

## 3. ARCHITECTURAL QUESTIONS

### Q: How does UI get snapshots without becoming a clock?

**Current behavior:** `psyLive.ts` uses `setInterval(500ms)` for UI updates (line 863: `this.uiTimer = setInterval(() => this.emit(), 500)`). The `emit()` function reads internal state and calls `onState()`. This is acceptable but the UI gets stale data (500ms latency).

**Decision:** Transport provides `snapshot()`. UI calls it via `requestAnimationFrame` (60fps) or `setInterval(100ms)`. The snapshot is immutable — UI cannot modify Transport state. The snapshot is cheap (just field reads, no computation heavier than a modulo).

### Q: How does arranger get time?

**Current behavior:** `scheduleStep()` (psyLive.ts:549) receives `step` and `time` as arguments. The arranger logic (pattern mutation, occupancy decisions) runs inside `scheduleStep` using `this.barCount` and `this.occupancy`. This is tightly coupled — the arranger doesn't have a clean time API.

**Decision:** Arranger receives a `TransportSnapshot`. It reads `beat`, `bar`, `phase`, `section` (derived from bar). It does NOT read `AudioContext.currentTime` or any physical time. The snapshot is the arranger's entire view of "when am I?"

### Q: How do future devices get time?

**Blueprint says:** "Devices never read raw observations. Anything that needs 'when is the next beat?' asks Transport." (§2)

**Decision:** Future devices (PSY-A, PSY-B, PSY-C) will call `transport.snapshot()` or `transport.subscribe(listener)`. They receive `TransportSnapshot` with `bpm`, `beat`, `bar`, `phase`, `confidence`, `locked`, `source`, `epoch`. They never touch `AudioContext.currentTime` directly. They never own their own clock.

---

## 4. CONTRADICTIONS WITH BLUEPRINT

| # | Blueprint says | Reality shows | Resolution |
|---|----------------|---------------|------------|
| 1 | "AudioContext.currentTime is the ONLY clock" | `Date.now()` used for style hysteresis | Transport provides audio-time-based hysteresis |
| 2 | "Transport owns BPM" | 4 BPM variables exist | Transport is the single BPM source |
| 3 | "Transport owns phase" | PLL computes phase from smoothed beatTime | Transport computes phase from anchor |
| 4 | "Transport owns bar" | 3 bar counters exist (pll.beatIndex, step, barCount) | Transport is the single bar source |
| 5 | "Transport only can change tempo" | 4 places change tempo | `transport.setTempo()` is the only API |
| 6 | "Radio is an observation source, never a scheduler" | Scheduler uses `pll.predictBeats()` directly | Scheduler reads `transport.snapshot()` instead |
| 7 | "setInterval may wake the scheduler. It is NEVER the musical clock." | `nextNoteTime += stepDur()` IS the musical clock | Anchor-based: `beatTime = anchorTime + beatIndex * beatDuration` |
| 8 | "No component other than the Scheduler touches AudioContext event timing" | `onKick()` directly modifies `engineBpm` on beat detection | `onKick()` calls `transport.observeBeat()` instead |

---

## 5. FLOAT DRIFT ANALYSIS

### The Problem

All existing schedulers use accumulation:
```ts
nextNoteTime += stepDuration  // psyLive.ts:540, psy:917
```

`stepDuration = 60 / bpm / 4` at 150 BPM = 0.1 seconds. In IEEE 754 double precision, 0.1 cannot be represented exactly (it's 0.1000000000000000055511151231257827021181583404541015625). Each addition accumulates rounding error.

### Measured Drift (calculated)

| BPM | stepDur (s) | error per step | 10 min drift | 30 min drift | 60 min drift |
|----:|------------:|---------------:|-------------:|-------------:|-------------:|
| 80 | 0.1875 | ~2.8e-17 | ~0.003ms | ~0.01ms | ~0.02ms |
| 120 | 0.125 | ~1.9e-17 | ~0.001ms | ~0.004ms | ~0.008ms |
| 150 | 0.1 | ~1.6e-17 | ~0.001ms | ~0.003ms | ~0.006ms |
| 180 | 0.0833 | ~1.3e-17 | ~0.001ms | ~0.002ms | ~0.005ms |

**Analysis:** Pure float accumulation drift is negligible (<0.02ms over 60 minutes). The REAL drift problem is not float precision — it's **logical drift**:

1. **PLL beatTime drift:** The PLL's `beatTime` is corrected by `phaseGain * error` but never re-anchored. Over time, if the PLL's `bpm` is slightly off (e.g., 149.9 instead of 150), `beatTime` drifts by 0.04 seconds per minute (2.4 BPM × 60s / 60min = 2.4 seconds per hour).

2. **Scheduler nextNoteTime drift:** If `engineBpm` and `pllBpm` differ slightly, the accumulated `nextNoteTime` diverges from the PLL's `beatTime`. The scheduler's `step` counter and the PLL's `beatIndex` can diverge.

3. **Tab suspension drift:** When the tab is suspended, `ctx.currentTime` stops advancing (in some browsers) or advances slowly. `nextNoteTime` continues to be incremented by the scheduler when it wakes, but the relationship to `ctx.currentTime` is broken.

### Decision: Anchor-Based Clock

Transport uses anchor-based time:
```ts
beatTime = anchorTime + beatIndex * beatDuration
```

Where:
- `anchorTime` is an `AudioContext.currentTime` value (set at init, seek, or re-anchor)
- `beatIndex` is an integer (incremented by observations, not by accumulation)
- `beatDuration = 60 / bpm` (recomputed from the current BPM, not accumulated)

This eliminates float accumulation drift entirely. The only source of drift is BPM estimation error, which the PLL already handles.

**Re-anchoring policy:**
- On `seek()` — re-anchor immediately
- On `observeBeat()` — re-anchor at bar boundaries (every 4 beats) if phase error > threshold
- On AudioContext resume — re-anchor immediately
- On source change (internal ↔ radio) — re-anchor at next bar boundary

---

## 6. TRANSPORT ≠ PLL

### Separation of Concerns

**BeatPLL** is an OBSERVER/ESTIMATOR:
- Input: `BeatObservation { time, confidence }`
- Output: `bpm`, `beatTime`, `confidence`, `locked`
- Purpose: estimate the tempo and phase of an external signal
- Does NOT own musical time — it only observes it

**MusicalTransport** is a TIME MODEL:
- Input: observations from PLL, internal tempo setting, seek commands
- Output: `TransportSnapshot` (immutable)
- Purpose: provide a single source of truth for musical time
- DOES own musical time — it decides the effective BPM, beat, bar, phase

### Data Flow

```
Radio audio → analysis → BeatPLL → Transport.observe()
                                         ↓
                                    Transport (time model)
                                         ↓
                                    snapshot()
                                         ↓
                              ┌──────────┼──────────┐
                              ↓          ↓          ↓
                           Scheduler   Arranger    UI
```

### Transport Modes

```ts
type TransportSource = 'internal' | 'radio' | 'external' | 'manual';
```

- **internal:** Transport runs at its own BPM (preset tempo). No radio.
- **radio:** Transport follows the PLL's estimate. Radio is connected and locked.
- **external:** Future — Transport follows an external sync signal (MIDI clock, network).
- **manual:** Transport is hand-cranked (seek, step). Used for testing/debugging.

Transport works in ALL modes. It does NOT require radio.

---

## 7. TRANSPORT STATE

### Immutable Snapshot

```ts
interface TransportSnapshot {
  // When this snapshot was taken (AudioContext.currentTime)
  timestamp: number;

  // Tempo
  bpm: number;
  confidence: number;  // 0..1
  locked: boolean;

  // Position
  beatTime: number;    // AudioContext time of the last beat boundary
  barTime: number;     // AudioContext time of the last bar boundary
  beat: number;        // Beat index within the bar (0..beatsPerBar-1)
  bar: number;         // Bar index (global, monotonically increasing)

  // Phase
  phase: number;       // 0..1 within the current beat
  barPhase: number;    // 0..1 within the current bar

  // Source and epoch
  source: TransportSource;
  epoch: number;       // Incremented on every re-anchor/seek/reset

  // Beats per bar (usually 4)
  beatsPerBar: number;
}
```

### Epoch

`epoch` is critical. It increments on:
- `seek()`
- `reset()`
- AudioContext resume after suspension
- Source change (internal ↔ radio)
- Re-anchor at bar boundary (if phase error exceeded threshold)

Consumers can compare `snapshot.epoch` to detect if the clock was disrupted. If `epoch` changed, the consumer should re-evaluate its state (e.g., the arranger should re-check which section it's in).

---

## 8. SCHEDULER INTEGRATION PLAN

### Phase 1: Adapter (this gate)

Build `TransportAdapter` that wraps the existing `PsyLive` scheduler:

```
Transport → TransportAdapter → PsyLive.scheduler()
```

The adapter:
1. Creates a `MusicalTransport` instance
2. Feeds it observations from `pll.update()` (via `onKick()`)
3. Provides `snapshot()` to the scheduler
4. The scheduler reads `snapshot.beat` and `snapshot.nextBeatTime` instead of `pll.predictBeats()` and `this.step`

### Phase 2: Ownership transfer (this gate, if tests pass)

Delete from `psyLive.ts`:
- `private step = 0` → use `snapshot.beat % 16`
- `private nextNoteTime = 0` → use `snapshot.beatTime + snapshot.beatDuration`
- `private barCount = 0` → use `snapshot.bar`
- `private lastScheduledStepKey = 0` → replaced by epoch-based dedup
- `private engineBpm = 145` → use `snapshot.bpm`
- `private radioBpm = 0` → eliminated (Transport tracks source)

### Phase 3: Future (NOT this gate)

- Move scheduler to Worker (psy5 pattern) for jitter resistance
- Add AudioWorklet integration
- Add network sync (external source)

---

## 9. TEST MATRIX (F1.14)

### Deterministic Tests (A-P)

| ID | Description | Key Metric |
|----|-------------|------------|
| A | Perfect 120 BPM, 60 beats | P95 phase error < 10ms |
| B | Perfect 150 BPM, 60 beats | P95 phase error < 10ms |
| C | Tempo change 120→150 at beat 20 | Beat continuity, no phase reset |
| D | Phase perturbation (±50ms jitter) | P95 phase error < 15ms |
| E | Beat dropout (25% missing) | Convergence, no false lock |
| F | False kicks (10% extra low-conf) | Rejection, no tempo corruption |
| G | Half tempo (75 BPM input, expect 150) | Hypothesis handling |
| H | Double tempo (300 BPM input, expect 150) | Hypothesis handling |
| I | Scheduler stall (100ms, 500ms, 1s, 2s, 5s) | Recovery via AudioContext time |
| J | Radio loss/recovery | Holdover + re-lock |
| K | 30-min drift simulation | P95 timing error < 10ms |
| L | Seek to bar 10 | Epoch increment, position jump |
| M | AudioContext pause/resume | Re-anchor, epoch increment |
| N | Multiple subscribers (3 listeners) | All receive same snapshots |
| O | Epoch correctness | Increment on every disruption |
| P | No duplicate clock ownership | grep for nextNoteTime, step, barCount in psyLive |

### Adversarial Tests

| ID | Description |
|----|-------------|
| ADV-1 | Bursts: 10 observations in 100ms |
| ADV-2 | Out-of-order: observation from the past |
| ADV-3 | Late observations: 500ms after the beat |
| ADV-4 | Noise: random observations with 0.3 confidence |
| ADV-5 | Tempo jump: 120→180→100 in 20 beats |
| ADV-6 | Duplicate kicks: same timestamp, different confidence |

---

## 10. DECISION SUMMARY

| Question | Decision |
|----------|----------|
| Who owns time? | Transport (AudioContext.currentTime only) |
| Who owns BPM? | Transport (single source) |
| Who owns phase? | Transport (anchor-based) |
| Who owns bar? | Transport (single counter) |
| Who can change tempo? | Transport.setTempo() only |
| Radio tempo change? | Single smoothing (PLL's tempoGain only) |
| Radio disappears? | HOLDOVER with confidence decay |
| Tab suspension? | DROP STALE EVENTS, re-anchor via AudioContext time |
| AudioContext interruption? | Re-anchor, increment epoch |
| Seek? | Re-anchor, increment epoch |
| Half/double tempo? | tempoHypotheses, no false certainty |
| Beat dropout? | Holdover, confidence decay |
| UI snapshots? | snapshot() via rAF, immutable |
| Arranger time? | TransportSnapshot only |
| Future devices? | subscribe(listener) or snapshot() |
| Float drift? | Anchor-based: beatTime = anchorTime + beatIndex * beatDuration |
| Scheduler integration? | Adapter → ownership transfer → delete duplicates |

---

## 11. BLOCKERS IDENTIFIED

### No blockers found

BeatPLL (after R1 repair) passes 48/48 convergence tests. It handles:
- Perfect timing ✓
- ±5ms jitter ✓
- 25% missing beats ✓
- Low confidence transients ✓
- Half tempo ✓
- Tempo jumps ✓

The PLL is sufficient as the Transport's beat estimator. No PLL changes needed for F1.

### Risks (non-blocking)

1. **PLL confidence is derived from `radioBands.low * 2`** — this is low-band energy, not detection confidence. The Transport will use this as-is for now, but it should be replaced with real onset-strength confidence in a future gate.

2. **No unlock mechanism in PLL** — once locked, the PLL stays locked even if observations stop. Transport handles this via holdover (confidence decay), which is sufficient.

3. **`Date.now()` in style hysteresis** — this is a pre-existing bug (contradiction #1). Transport will provide audio-time-based hysteresis, but fixing the style classifier is out of scope for F1.

---

## 12. IMPLEMENTATION ORDER

1. **Types** — `TransportTypes.ts` (interfaces, types)
2. **Transport** — `MusicalTransport.ts` (the time model)
3. **Adapter** — `TransportAdapter.ts` (wraps existing scheduler)
4. **Tests** — `tests/foundation/transport/` (A-P + adversarial)
5. **Integration** — wire into `psyLive.ts`, delete duplicate state
6. **Browser** — smoke test
7. **Reports** — `TRANSPORT_REALITY_REPORT.md`, `FOUNDATION_API.md`

**No code is written in this design review. Next: tests, then implementation.**
