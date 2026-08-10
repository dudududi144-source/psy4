# Task P4-PHRASE-SYNC — Phrase-level structural sync

**Agent:** Z.ai Code (main)
**Task ID:** P4-PHRASE-SYNC
**Phase:** 4 — Structural pursuit: phrase-level sync
**Parent context:** RESEARCH-DEEP (finding #6 — pursuit is shallow) → P2-MUSIC-INTELLIGENCE (built the MusicAnalyzer that detects sections) → P4-PHRASE-SYNC (this task — aligns phrase boundaries with the radio's).

## Goal

Add phrase-level synchronization. Beat sync (PhaseSync, D1) aligns individual beats. Section sync (MusicAnalyzer + flowEngine.transitionTo, P2) aligns section TYPES (we drop when the radio drops). But NEITHER aligns PHRASES — the 4-8 bar structural units of dance music. Professional DJ software (Traktor/Serato/CDJs) aligns phrase boundaries: when the radio starts a new 8-bar phrase, we start a new phrase too — not 3 bars into our current one. This prevents our "drop" from landing in the middle of the radio's "break".

## What I read first

- `worklog.md` (RESEARCH-DEEP + P2-MUSIC-INTELLIGENCE + D1 + D1-upgrade entries) — confirmed the MusicAnalyzer emits sectionBoundary / dropHit / breakStart / riserStart events from `updateMusicAnalyzer()` in psy4EngineV2.ts (lines 2430-2530); the flowEngine has `transitionTo(partial, bars)` that accepts a Partial<FlowState> & { label? } + a planned length in bars; the engine's `tick()` per-bar already calls `phaseSync.tickBar()` + `djController.tickBar()` (lines 3696-3838) before `flowEngine.tick()` (line 3853).
- `psy4EngineV2.ts` — found the existing flow: in `tick()` per bar, after the DJController returns `phraseRealign` (which only snaps the bar counter to 0), there was no PROACTIVE phrase realignment via `flowEngine.transitionTo()`. The DJController's phraseRealign is REACTIVE (fires on its 4-bar smoothed-energy transition detector). PhraseSync needed to be PROACTIVE (fires on the MusicAnalyzer's musical section detection).
- `flowEngine.ts` — confirmed `transitionTo(partial, bars)` sets `barInSection = 0` + `lastTransitionBar = barCount`. The engine's `this.bar` is only reset to 0 by the engine when the flow LABEL changes — so a same-label realignment (DROP → DROP) wouldn't reset `this.bar` automatically. I needed to manually reset it after a phrase realignment.
- `musicAnalyzer.ts` — confirmed event shape: `{ type, time, confidence, data?: any }` where `data.bar` is the MusicAnalyzer's bar count and `data.to` is the new section label for sectionBoundary events.
- `djController.ts` — confirmed the existing `phraseRealign` flag fires on energy transitions (4-bar smoothed delta > 0.15) and only snaps `this.bar = 0`. PhraseSync complements this by also calling `flowEngine.transitionTo()` with the right archetype + phrase length.
- `page.tsx` — found the DJ CONTROLLER card structure (lines 918-1495): the BEAT-GRID / PHRASE block (driven by `syncStatus.refBarInPhrase` / `ownBarInPhrase` from DJController) was the natural insertion point for the new PHRASE SYNC block (driven by `phraseSyncState` from PhraseSync).

## Step 1-3 — Created `src/lib/studio/engine/phraseSync.ts` (new, ~430 lines)

- **PhraseSyncState interface** — 11 fields: `refPhraseBar` (bar within radio's current phrase, 0-based), `refPhraseLength` (estimated 4-16 bars, typically 8), `ownPhraseBar`, `ownPhraseLength`, `alignment` (0..1), `lastRealignment` (wall-clock sec), `realignments` (counter), `lastRefBoundaryTime`, `nextPredictedRefBoundaryBar`, `lastRefSectionLabel` ('drop' / 'break' / 'build' / ...), `masterSync`.
- **RealignmentDecision interface** — returned by `checkRealignment()`: `{ realign, reason, offsetBars, suggestedLabel?, suggestedEnergy?, suggestedBars? }`. The suggested* fields are populated when `realign === true` so the engine can pass them directly to `flowEngine.transitionTo()`.
- **PhraseSync class** — 6 public methods (setMasterSync, onSectionBoundary, onOwnBar, checkRealignment, getState, reset) + 5 private fields (boundaryIntervals, lastBoundaryOwnBar, latestTotalBars, pendingRefBoundary, pendingSectionLabel, masterSync).
- **Step 2 — Phrase boundary detection** (in `onSectionBoundary`):
  - Records the wall-clock time + label of each ref section boundary.
  - Computes the interval (in our bars) between consecutive boundaries using `latestTotalBars` (passed in via `onOwnBar`'s `totalBars` parameter — a reasonable proxy for the radio's bar counter because PhaseSync keeps our BPM locked to the radio's).
  - Pushes valid intervals (4-16 bars) to a bounded history (INTERVAL_HISTORY_MAX = 6 samples).
  - Estimates the radio's phrase length via the MEDIAN of recent intervals (more robust than the mean to outliers like an early/late boundary).
  - Predicts the next boundary: `lastBoundaryOwnBar + refPhraseLength`.
  - Sets `pendingRefBoundary = true` for `checkRealignment()` to consume on the next bar.
- **Step 3 — Alignment logic** (in `checkRealignment`):
  - Master-sync guard: returns `{ realign: false, reason: 'master-sync-off' }` when master sync is off.
  - Pending-boundary guard: returns `{ realign: false, reason: 'no-boundary' }` when no ref boundary has fired since the last check.
  - Anti-thrash cooldown: 6s between realignments (prevents a dropHit + sectionBoundary firing within seconds of each other from causing 2 realignments in a row).
  - Decision tree (when a ref boundary is pending):
    - `|offsetBars| <= 1` → no realign (already aligned)
    - `ownBar >= ownLen - 1` → no realign (near our own boundary, will align naturally)
    - `ownBar > ownLen / 2` → no realign (past 50%, finish phrase first)
    - `ownBar < EARLY_CUT_BARS (2)` → realign with reason='early-cut' (cut short)
    - Else (2 to 50%) → realign with reason='mid-phrase-cut' (the spec's main case: "drop lands 3 bars off")
  - Suggests the archetype (sectionLabelToArchetype: drop→DROP, break→BREAK, build→BUILD, intro→INTRO, outro→OUTRO, variation→VARIATION, else→GROOVE) + energy (sectionLabelToEnergy: drop→0.95, break→0.30, build→0.70, intro→0.25, outro→0.25, variation→0.85, groove→0.50 — matches the ARCHETYPES table in flowEngine.ts) + phrase length (the radio's estimated phrase length, default 8).
- **Alignment computation** (in `onOwnBar`):
  - `alignment = 1 - |ownPhraseBar - refPhraseBar| / max(ownPhraseLength, refPhraseLength)`, clamped to [0, 1].
  - Returns 0 when no ref data yet (before the first boundary fires).
- **reset()** preserves the masterSync toggle (user's choice survives a restart) but clears all boundary tracking + realignment state. Used by engine.start() and engine.stop().

## Step 4 — Integration into `psy4EngineV2.ts` (+85 lines)

- Imported `PhraseSync, PhraseSyncState` from `./phraseSync` (after the DJController import).
- Added `private phraseSync: PhraseSync = new PhraseSync();` field (constructed eagerly so the master-sync toggle persists across stop/start cycles, mirroring the DJController pattern).
- **In `start()`**: call `this.phraseSync.reset();` right after the MusicAnalyzer reset (so stale boundary-interval history from a previous play session doesn't bias the new session's phrase length estimate). The master-sync toggle is preserved.
- **In `stop()`**: call `this.phraseSync.reset();` after `djController.reset()` (same pattern — clears boundary tracking but preserves the master-sync toggle).
- **In `setMasterSync(enabled)`**: call `this.phraseSync.setMasterSync(enabled);` after `djController.setMasterSync(enabled);` — forwards the master-sync toggle to the PhraseSync. When off, `checkRealignment()` returns `{ realign: false, reason: 'master-sync-off' }` — the engine runs free.
- **In `updateMusicAnalyzer()` (the for loop over new events)**: extended the switch statement to call `phraseSync.onSectionBoundary(nowSec, label)` for all 4 boundary-firing event types:
  - `dropHit` → `onSectionBoundary(nowSec, 'drop')` (in addition to the existing `flowEngine.transitionTo({ label: 'DROP', energy: 0.95 }, 2)`)
  - `breakStart` → `onSectionBoundary(nowSec, 'break')` (in addition to `transitionTo({ label: 'BREAK', energy: 0.3 }, 2)`)
  - `riserStart` → `onSectionBoundary(nowSec, 'build')` (in addition to `transitionTo({ label: 'BUILD', energy: 0.7 }, 4)`)
  - `sectionBoundary` → `onSectionBoundary(nowSec, ev.data?.to ?? 'groove')` (NEW case — previously fell through to the default no-op. Section transitions are ALSO phrase boundaries in dance music, even when we don't force a flow transition because the archetype already matches.)
  - Other event types (chordChange, keyChange, melodicPeak, rhythmicFill) still no-op — they're intra-phrase events, not structural.
- **In `tick()` per-bar** (between the DJController's `tickBar` call and the flow engine's `tick()`):
  - Compute the current phrase length: `p4PhraseLen = clamp(this.currentFlow?.sectionBars ?? 8, 4, 8)` (matches the spec's "4-8 bar phrase" range).
  - Call `this.phraseSync.onOwnBar(this.bar, p4PhraseLen, this.totalBars);` (passes bar-in-section, phrase length, and absolute bar counter).
  - Call `const p4Realign = this.phraseSync.checkRealignment();`.
  - If `p4Realign.realign && this.flowEngine`:
    - Call `this.flowEngine.transitionTo({ label: p4Realign.suggestedLabel, energy: p4Realign.suggestedEnergy }, p4Realign.suggestedBars ?? p4PhraseLen);` — starts a new phrase aligned with the radio.
    - Manually set `this.bar = 0;` (transitionTo resets the flow engine's barInSection but NOT our engine's bar; the engine only resets this.bar when the flow LABEL changes, so a same-label realignment like DROP → DROP wouldn't reset it automatically).
    - Log the realignment to console for debugging: `[PSY4] PhraseSync: realign (reason) — offset N bars, new phrase LABEL (B bars @ energy E)`.
- Added public method `getPhraseSyncState(): PhraseSyncState` — returns the live state for UI display. Safe to call before start() — returns a default-zero state.

## Step 5 — UI: PHRASE SYNC indicator in `page.tsx` (+160 lines)

- Added `phraseSyncState` (any) + `phraseSyncFlash` (boolean) + `prevRealignmentsRef` (number) state to the React component.
- Added a polling pull in the analyzer tick (alongside the existing `getSyncStatus()` pull): `if (engineRef.current?.getPhraseSyncState) { try { setPhraseSyncState(engineRef.current.getPhraseSyncState()); } catch {} }`.
- Added a `useEffect` that watches `phraseSyncState?.realignments` — when it increases (a realignment just happened), sets `phraseSyncFlash = true` and auto-clears after 600ms via `setTimeout`. The flash adds a brief ring + shadow pulse to the PHRASE SYNC card so the user can SEE that a realignment fired.
- Cleared `phraseSyncState` + `phraseSyncFlash` + `prevRealignmentsRef` in `stopEngine` so stale data doesn't persist across engine restarts.
- Added the **PHRASE SYNC** block inside the DJ CONTROLLER card, placed right after the existing BEAT-GRID / PHRASE block (so both are visible — the existing one is from the DJController, the new one is from PhraseSync, and they show different data):
  - **Header**: LayoutGrid icon + "Phrase Sync · structural" label + status badge (color-coded: emerald when alignment > 75%, amber > 40%, rose otherwise). Shows "○ NO REF" before the first ref boundary, "✦ REALIGN" during the flash, "● ALIGNED/DRIFT/OFF" otherwise.
  - **Border color**: pulses emerald with a `shadow-[0_0_12px_rgba(52,211,153,0.4)]` glow when `phraseSyncFlash` is true (the visual flash). Otherwise matches the status color.
  - **Two 8-bar grids** (REF row fuchsia + OURS row cyan), with phrase-start cells ringed. The grid uses `maxLen = max(refLen, ownLen)` cells so we can visualize phrases of different lengths (e.g., radio 8-bar + ours 4-bar — the 4 cells beyond ourLen are dimmed). The active cell (current bar) is filled; others are dark.
  - **Empty state**: "Waiting for the radio's first section boundary — connect a stream and the MusicAnalyzer will detect drop / break / build events within ~30s."
  - **Stats footer** (3-column grid):
    - Alignment % (large color-coded number + progress bar)
    - Ref phrase length (e.g., "8-bar") + last section label (e.g., "last: drop")
    - Realignment counter (large number, pulses emerald during the flash) + "last Ns ago" (computed from `lastRealignment` timestamp vs `performance.now()/1000`)
- Updated the toggleSync toast description to include "+ phrase" in the master-sync-enabled message (was "BPM + phase + key + groove + energy + beat-grid", now "BPM + phase + key + groove + energy + beat-grid + phrase").

## Constraints honored

- **Did NOT break existing functionality**: master sync is OPTIONAL (default off). When masterSync is false, `checkRealignment()` returns `{ realign: false, reason: 'master-sync-off' }` and the per-bar tick logic is a no-op (just two cheap method calls — `onOwnBar` updates internal state for UI display, `checkRealignment` early-returns). All existing liveTrack consumers (applySynthesisPursuit, applyEffectsPursuit, applyDeepPursuit, phaseSync, djController, applyLearnedPatternProactively, runLearningTick, updateMusicAnalyzer) are unchanged — the PhraseSync calls are purely additive.
- **Realignment is smooth** (not abrupt cuts mid-phrase unless necessary):
  - We only cut mid-phrase if we're <50% through AND the radio just hit a boundary AND we're more than 1 bar off AND we're not within 1 bar of our own boundary.
  - The 6s anti-thrash cooldown prevents back-to-back realignments.
  - The decision tree has 3 "no realign" paths (already-aligned, near-own-boundary, late-finish) and only 2 "realign" paths (early-cut, mid-phrase-cut) — the bias is toward letting phrases finish naturally.
- **Guarded against missing data**:
  - `onSectionBoundary` returns early if `time` is not finite.
  - `onOwnBar` guards `bar` and `phraseLength` for finiteness + non-negativity.
  - `checkRealignment` early-returns `{ realign: false }` if master sync is off, if no pending boundary, if no ref data, or if within the cooldown.
  - The UI uses optional chaining throughout (`phraseSyncState?.realignments ?? 0`, `phraseSyncState?.refPhraseLength ?? 8`, etc.) and shows an empty state when `lastRefBoundaryTime === 0`.
- **TypeScript strict mode**: zero tsc errors in phraseSync.ts / psy4EngineV2.ts / page.tsx (verified — see VERIFICATION below). All types explicit (no `any` in phraseSync.ts; page.tsx uses `any` for the snapshot state, consistent with the existing `syncStatus` / `musicalAnalysis` / `deepAnalysis` / `pursuitDashboard` state pattern).
- **The PhraseSync never throws** — all public methods catch malformed input and return safe defaults (no-op or `{ realign: false }`).

## Verification

- `cd /home/z/my-project && npx tsc --noEmit --skipLibCheck 2>&1 | grep -E "phraseSync|psy4EngineV2|page.tsx" | head` → EMPTY (0 errors in target files).
- `cd /home/z/my-project && bun run lint 2>&1 | grep -E "phraseSync|psy4EngineV2|page.tsx" | grep error` → EMPTY (0 lint errors in target files).
- Total tsc error count = 56 (unchanged from the P1-CLEANUP / P2-MUSIC-INTELLIGENCE baseline — all 56 are pre-existing in unrelated files: examples/websocket/*, scripts/independent-proof.ts, src/lib/studio/artifacts/index.ts, src/lib/studio/audit/bypassAttacks.ts, src/lib/studio/dsp/masterChain.ts, src/lib/studio/engine/engineWorklet.ts, src/lib/studio/engine/forensic/*, src/lib/studio/engine/multisampleGenerator.ts, src/lib/studio/engine/reference/*, src/lib/studio/tests/index.ts). The earlier transient "Property 'updateVocabularyLearner' does not exist" was a stale-check artifact that disappears on a clean re-run.
- Lint passes cleanly (exit 0) across the ENTIRE project — no warnings, no errors.
- Dev server smoke test: `curl http://localhost:3000/` → HTTP 200. dev.log shows "✓ Compiled in Nms" with no errors after the changes.

## Deliverable

A PhraseSync module that aligns our 4-8 bar phrase boundaries with the radio's. When the radio drops, our drop lands at the same time — not 3 bars off. The detection is driven by the MusicAnalyzer's sectionBoundary / dropHit / breakStart / riserStart events (the most reliable structural signal in the system — 30s cooldowns + slope checks + min-bar thresholds, far more robust than the DJController's 4-bar smoothed-energy transition detector). The realignment is decided per-bar via the spec's decision tree (early-cut / mid-phrase-cut / late-finish / near-boundary / already-aligned) and executed via `flowEngine.transitionTo()` with the right archetype + energy + phrase length. The UI shows the live alignment as two 8-bar grids + an alignment % + a realignment counter that flashes when a realignment fires.

## Honest gap (limitations)

- **PHYSICAL LISTENING UNVERIFIED** — verification via TypeScript + ESLint pass + dev server compile. The signal chain is well-formed: MusicAnalyzer emits sectionBoundary / dropHit / breakStart / riserStart → `updateMusicAnalyzer()` calls `phraseSync.onSectionBoundary()` → PhraseSync records the boundary + sets pendingRefBoundary → next tick() calls `phraseSync.checkRealignment()` → if realign, calls `flowEngine.transitionTo()` + resets `this.bar = 0` → flow engine smooths toward the new archetype. But the audible result (does our drop ACTUALLY land at the same time as the radio's drop?) is asserted by construction, not by listening.
- **The phrase-length estimate uses OUR bar counter as a proxy for the radio's** — this is a reasonable approximation because PhaseSync keeps our BPM locked to the radio's, but it breaks down if the BPM hasn't converged yet (e.g., the first 5-10s after a stream connects). The median-of-recent-intervals estimator is robust to a single bad sample, but a sustained BPM mismatch would pollute the estimate. A future enhancement would track the radio's bar counter directly (the MusicAnalyzer already has `barCount`, but it's not exposed).
- **The 6s cooldown is a heuristic** — it prevents thrashing when dropHit + sectionBoundary fire close together, but it also means we won't realign twice in quick succession even if it's the right thing to do (e.g., a quick drop → break → drop within 6s would only get one realignment). Tuning this against real radio streams is left for a future task.
- **The "sectionBoundary" event is treated as a phrase boundary** — this is the standard assumption in dance music (sections = phrases), but it breaks down for non-4/4 music or highly irregular arrangements (e.g., a 3-bar bridge). The MIN_PHRASE_LENGTH = 4 guard rejects intervals shorter than 4 bars, so a 3-bar bridge wouldn't pollute the estimate, but it also means we'd miss a genuine 3-bar phrase if one existed.
- **No proactive realignment on PREDICTED boundaries** — the PhraseSync computes `nextPredictedRefBoundaryBar` but doesn't use it for realignment decisions. Currently we only realign when a boundary EVENT fires (reactive). A future enhancement would anticipate the predicted boundary 1-2 bars ahead and pre-align (smoother than waiting for the event + cutting mid-phrase). The `nextPredictedRefBoundaryBar` field is exposed in the state for UI display + future use.

## Artifacts

- `src/lib/studio/engine/phraseSync.ts` (NEW, ~430 lines) — PhraseSync class + PhraseSyncState + RealignmentDecision interfaces. 6 public methods (setMasterSync, onSectionBoundary, onOwnBar, checkRealignment, getState, reset) + 5 private fields + 4 helper functions (clamp, clampInt, median, sectionLabelToArchetype, sectionLabelToEnergy, nowSec).
- `src/lib/studio/engine/psy4EngineV2.ts` (extended, +85 lines) — import + 1 private field + start()/stop() reset + setMasterSync forward + updateMusicAnalyzer sectionBoundary case + onSectionBoundary calls for dropHit/breakStart/riserStart + tick() per-bar phraseSync.onOwnBar + checkRealignment + transitionTo + bar=0 reset + getPhraseSyncState() public method.
- `src/app/page.tsx` (extended, +160 lines) — phraseSyncState + phraseSyncFlash + prevRealignmentsRef state + analyzer-tick pull + stopEngine clear + useEffect flash trigger + PHRASE SYNC block (status badge + two 8-bar grids + alignment % + realignment counter + flash on realignment) + updated toggleSync toast description.
- `agent-ctx/P4-PHRASE-SYNC-z-ai-code.md` (NEW, this file) — work record for this task.

## Next (future tasks, NOT done here — left for P5+)

- **Proactive realignment on predicted boundaries** — use `nextPredictedRefBoundaryBar` to anticipate the next ref boundary 1-2 bars ahead and pre-align (instead of waiting for the event + cutting mid-phrase). This would be smoother than the current reactive approach.
- **Track the radio's bar counter directly** — expose `MusicAnalyzer.barCount` so PhraseSync can use the radio's actual bar counter instead of our proxy. Eliminates the BPM-mismatch window.
- **Tune the realignment thresholds against real radio streams** — the current values (EARLY_CUT_BARS = 2, REALIGN_COOLDOWN_SEC = 6, MIN_PHRASE_LENGTH = 4) are heuristic. They'll need tuning based on observed behavior with real streams (especially the cooldown — too short = thrashing, too long = missed realignments).
- **Phrase-length-aware composition** — feed the estimated ref phrase length into the MusicalDirector so it composes phrases that match the radio's phrase length (currently the director uses the flow engine's sectionBars, which is independent of the radio's phrase structure).
- **Visual phrase ruler** — extend the UI to show a timeline of past + predicted phrase boundaries (not just the current phrase) so the user can see the phrase structure of both the radio and our engine over a 32-bar window.
