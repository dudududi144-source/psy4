# F1 RUNTIME CLOCK AUDIT

## Forensic Identification of Every Competing Clock in psyLive.ts

**Date:** 2026-08-12
**Scope:** `src/lib/psyLive.ts` (968 lines) — the ONLY live runtime engine
**Method:** Line-by-line grep + import trace + actual runtime usage verification

---

## COMPETING CLOCKS FOUND

### 1. `this.engineBpm` (line 187) — REPLACE

**Declaration:** `private engineBpm = 145;`
**Writers:**
- Line 187: initial value `145`
- Line 477: `setPreset()` → `this.engineBpm = p.bpm`
- Line 607: `toggleComposition()` → `this.engineBpm = this.composition.bpm`
- Line 612: `toggleComposition()` → `this.engineBpm = this.getPreset().bpm`
- Line 905: `onKick()` → `this.engineBpm = this.engineBpm + (pllBpm - this.engineBpm) * 0.3`

**Readers:**
- Line 497: `stepDur()` → `60 / this.engineBpm / 4`
- Line 810: `musicState.bpm = this.radioBpm || this.engineBpm`
- Line 933: `classifyStyle()` → `const bpm = this.radioBpm || this.engineBpm`
- Lines 936, 940: style classification thresholds

**Classification:** **REPLACE** — This is a competing musical clock. `engineBpm` independently tracks tempo, separate from the PLL's `bpm` and `musicState.bpm`. Four different code paths write to it, creating 4 sources of tempo truth.

**Action:** Delete. All reads replaced by `transport.snapshot().bpm`.

---

### 2. `this.radioBpm` (line 186) — DELETE

**Declaration:** `private radioBpm = 0;`
**Writers:**
- Line 186: initial value `0`
- Line 903: `onKick()` → `this.radioBpm = Math.round(pllBpm)`
- Line 662: `disconnectRadio()` → `this.radioBpm = 0`

**Readers:**
- Line 810: `musicState.bpm = this.radioBpm || this.engineBpm`
- Line 933: `classifyStyle()` → `const bpm = this.radioBpm || this.engineBpm`

**Classification:** **DELETE** — This is a second BPM variable that duplicates the PLL's `bpm`. It's `Math.round(pllBpm)` — just a rounded copy. Having both `radioBpm` and `engineBpm` creates the question "which BPM are we actually at?"

**Action:** Delete. Transport's `snapshot.bpm` is the single source.

---

### 3. `this.step` (line 247) — REPLACE

**Declaration:** `private step = 0;`
**Writers:**
- Line 247: initial value `0`
- Line 457: `play()` → `this.step = 0`
- Line 531: `scheduler()` → `this.step = (this.step + 1) % this.totalSteps`
- Line 541: `scheduler()` → `this.step = (this.step + 1) % this.totalSteps`

**Readers:**
- Line 529: `scheduleStep(this.step % 16, stepTime)`
- Line 539: `scheduleStep(this.step, this.nextNoteTime)`

**Classification:** **REPLACE** — This is a competing beat/step counter. It independently advances musical position, separate from the PLL's `beatIndex`. When the PLL re-anchors, `step` doesn't reset — they diverge.

**Action:** Delete. Replaced by `transport.snapshot().beatIndex % 16` for the 16-step pattern position.

---

### 4. `this.nextNoteTime` (line 248) — REPLACE

**Declaration:** `private nextNoteTime = 0;`
**Writers:**
- Line 248: initial value `0`
- Line 458: `play()` → `this.nextNoteTime = this.ctx!.currentTime + 0.06`
- Line 540: `scheduler()` → `this.nextNoteTime += this.stepDur()`

**Readers:**
- Line 538: `while (this.nextNoteTime < now + this.scheduleAheadTime)`
- Line 539: `scheduleStep(this.step, this.nextNoteTime)`

**Classification:** **REPLACE** — This is the WORST competing clock. It uses float accumulation (`nextNoteTime += stepDur()`) which drifts over time. It's a second source of "when is the next beat" separate from the PLL's `predictBeats()`.

**Action:** Delete. Replaced by `transport.snapshot().nextBeatTime` and `transport.predictBeats()`.

---

### 5. `this.barCount` (line 232) — REPLACE

**Declaration:** `private barCount = 0;`
**Writers:**
- Line 232: initial value `0`
- Line 475: `setPreset()` → `this.barCount = 0`
- Line 556: `scheduleStep()` → `this.barCount++`

**Readers:**
- Line 557: `if (this.barCount % 8 === 0)` — mutation trigger
- Line 563: `console.log('[MUTATE] pattern evolved, bar', this.barCount)`

**Classification:** **REPLACE** — This is a competing bar counter, separate from the PLL's `barIndex` (via `Math.floor(beatIndex / 4)`). Two bar counters can diverge.

**Action:** Delete. Replaced by `transport.snapshot().bar`.

---

### 6. `this.lastScheduledStepKey` (line 547) — DELETE

**Declaration:** `private lastScheduledStepKey = 0;`
**Writers:**
- Line 530: `this.lastScheduledStepKey = stepKey`

**Readers:**
- Line 528: `if (stepKey > this.lastScheduledStepKey)`

**Classification:** **DELETE** — This is a deduplication mechanism for the scheduler. It's not a musical clock per se, but it tracks "what step have we scheduled" — a duplicate of what the Transport's epoch + beatIndex already provide.

**Action:** Delete. Replaced by epoch-based dedup (if epoch changed, re-evaluate; otherwise, use beatIndex for dedup).

---

### 7. `this.musicState.bpm` (line 219) — REPLACE

**Declaration:** `private musicState: MusicState = { bpm: 145, ... }`
**Writers:**
- Line 219: initial value `145`
- Line 810: `detect()` → `this.musicState.bpm = this.radioBpm || this.engineBpm`

**Readers:**
- Used by `getMusicState()` (line 894) which returns the full MusicState

**Classification:** **REPLACE** — This is a THIRD BPM variable (`engineBpm`, `radioBpm`, `musicState.bpm`). It's set to `radioBpm || engineBpm` — a derived value that creates yet another source of tempo truth.

**Action:** Delete the `bpm` field from MusicState. Callers read `transport.snapshot().bpm` instead.

---

### 8. `this.pll` (BeatPLL instance, line 228) — ADAPTER

**Declaration:** `private pll: BeatPLL = new BeatPLL();`
**Writers:** `pll.update()` in `onKick()` (line 898)
**Readers:**
- Line 515: `pll.isLocked()`
- Line 517: `pll.predictBeats()`
- Line 518: `pll.getBpm()`
- Line 722: `pll.getClock()`
- Line 901: `pll.isLocked()`
- Line 902: `pll.getBpm()`

**Classification:** **ADAPTER** — The PLL is an OBSERVER/ESTIMATOR (per F1 design). It should NOT be read directly by the scheduler. Instead, the scheduler reads Transport, and Transport reads from the PLL internally.

**Action:** Keep the PLL instance but route its output through Transport. The scheduler stops calling `pll.predictBeats()` / `pll.getBpm()` / `pll.isLocked()` directly. Instead, `onKick()` calls `transport.observeBeat()`, and the scheduler reads `transport.snapshot()`.

---

### 9. `Date.now()` in style hysteresis (lines 817, 820) — REPLACE

**Writers/Readers:**
- Line 817: `this.styleCandidateSince = Date.now()`
- Line 820: `if (this.styleCandidate && Date.now() - this.styleCandidateSince > 8000)`

**Classification:** **REPLACE** — `Date.now()` is forbidden for musical decisions (F1.1 ABSOLUTE CLOCK RULE). Style hysteresis is a musical decision (when to switch styles). If the tab is suspended, `Date.now()` keeps ticking but audio time doesn't — the style could switch during suspension.

**Action:** Replace with `this.ctx.currentTime` for the hysteresis timer.

---

### 10. `setInterval(() => this.scheduler(), 25)` (line 460) — KEEP (wake-up only)

**Classification:** **KEEP** — This is a wake-up mechanism for the scheduler, NOT a musical clock. The scheduler reads `AudioContext.currentTime` and Transport snapshots to decide what to schedule. The 25ms interval just determines how often the scheduler checks.

**Action:** Keep, but ensure the scheduler does NOT use `nextNoteTime += stepDur()` accumulation. It must read from Transport.

---

### 11. `setInterval(() => this.detect(), 200)` (line 684) — KEEP (wake-up only)

**Classification:** **KEEP** — Wake-up for radio analysis (200ms). Not a musical clock.

---

### 12. `setInterval(() => this.emit(), 500)` (line 924) — KEEP (UI refresh only)

**Classification:** **KEEP** — UI refresh timer. Not a musical clock. Reads Transport snapshots for display.

---

### 13. `requestAnimationFrame(draw)` in page.tsx (line 95) — KEEP (UI only)

**Classification:** **KEEP** — UI visualizer refresh. Not a musical clock.

---

## SUMMARY TABLE

| # | Variable/Call | Line | Classification | Action |
|---|---------------|------|----------------|--------|
| 1 | `this.engineBpm` | 187 | REPLACE | Delete → `transport.snapshot().bpm` |
| 2 | `this.radioBpm` | 186 | DELETE | Delete → `transport.snapshot().bpm` |
| 3 | `this.step` | 247 | REPLACE | Delete → `transport.snapshot().beatIndex % 16` |
| 4 | `this.nextNoteTime` | 248 | REPLACE | Delete → `transport.snapshot().nextBeatTime` |
| 5 | `this.barCount` | 232 | REPLACE | Delete → `transport.snapshot().bar` |
| 6 | `this.lastScheduledStepKey` | 547 | DELETE | Delete → epoch-based dedup |
| 7 | `this.musicState.bpm` | 219 | REPLACE | Delete field → `transport.snapshot().bpm` |
| 8 | `this.pll` (direct reads) | 228 | ADAPTER | Keep instance, route through Transport |
| 9 | `Date.now()` (style hysteresis) | 817, 820 | REPLACE | Replace with `ctx.currentTime` |
| 10 | `setInterval(scheduler, 25)` | 460 | KEEP | Wake-up only |
| 11 | `setInterval(detect, 200)` | 684 | KEEP | Wake-up only |
| 12 | `setInterval(emit, 500)` | 924 | KEEP | UI refresh only |
| 13 | `requestAnimationFrame` | page.tsx:95 | KEEP | UI only |

**REPLACE: 6** (competing musical clocks to delete)
**DELETE: 2** (duplicate state)
**ADAPTER: 1** (PLL routed through Transport)
**KEEP: 4** (wake-up/UI timers, not musical clocks)

---

## WHAT THE RUNTIME MUST LOOK LIKE AFTER INTEGRATION

```ts
// BEFORE: 4 BPM variables, 3 beat counters, float accumulation
private engineBpm = 145;       // REPLACE
private radioBpm = 0;          // DELETE
private step = 0;              // REPLACE
private nextNoteTime = 0;      // REPLACE
private barCount = 0;          // REPLACE
private musicState.bpm = 145;  // REPLACE

// AFTER: ONE Transport, zero competing clocks
private transport: MusicalTransport;
private transportAdapter: TransportAdapter;

// Scheduler reads:
const snap = this.transport.snapshot();
const beats = this.transport.predictBeats(0.15);
// snap.bpm, snap.beatIndex, snap.bar, snap.nextBeatTime, snap.epoch

// onKick feeds:
this.transport.observeBeat({ time: now, confidence, source: 'radio' });

// UI reads:
const snap = this.transport.snapshot();
```

**One clock. One owner. Real runtime.**
