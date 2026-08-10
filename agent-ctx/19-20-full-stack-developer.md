# Task 19-20 — Track D: UI for Style Detection + A/B Spectral + Pursuit Convergence

**Agent**: full-stack-developer
**Task**: Surface the new engine capabilities (Track C's `getStyleClassification()`,
Track B's `getPursuitStatus()`, Track A's 10 worlds) so the user can SEE and FEEL
style detection, A/B spectral convergence, and pursuit progress in real-time.

## Files Modified
- `src/app/page.tsx` — full UI rewrite (518 → 700 lines). Added STYLE DETECTION card,
  A/B SPECTRAL VISUALIZATION card, enhanced REFERENCE PURSUIT card with convergence
  arrows, expanded world `<select>` to 10 worlds, "AUTO" badge, sticky footer,
  monospace numeric values, custom scrollbars.
- `src/lib/studio/engine/psy4EngineV2.ts` — added `getCurrentWorldId()` public
  accessor and `onWorldChange` callback field so the UI can read the active world
  and react when Track C auto-switches it.

## CHANGE 1 — Style Detection Panel (Task 19)
- New state: `styleMatches: StyleMatch[]`, `activeWorld: string`, `autoSwitchActive: boolean`.
- In the self-metrics tick handler, calls `engineRef.current.getStyleClassification?.()`
  with optional chaining (degrades gracefully if Track C isn't merged) and stores
  the result in `styleMatches`.
- Calls `engineRef.current.getCurrentWorldId?.()` on every tick and updates
  `activeWorld` if it changed.
- New "STYLE DETECTION" card visible in **listen + analyze** modes:
  - **Active World** tile — shows `WORLD_NAME[activeWorld]` + the raw id.
  - **Detected Style** tile — top match's `style` + confidence %, with a colored
    confidence bar (emerald >0.7, amber 0.4-0.7, rose <0.4).
  - **Top 3 Matches** list — ranked, each with confidence bar + percentage.
  - **Why this style?** — bullet list of `topMatch.reasons` with CheckCircle2 icons.
  - **AUTO-SWITCH indicator** — when `autoSwitchActive` is true, shows a hint.
  - Header badge shows `(topConfidence * 100)% STYLE` with color tier.

## CHANGE 2 — A/B Spectral Visualization (Task 20)
- New "A/B SPECTRAL VISUALIZATION" card in **analyze** mode only.
- 5 frequency bands: SUB / LOW / MID / HIGH / AIR (with Hz ranges).
- For each band: TWO side-by-side bars (REFERENCE = fuchsia gradient, ENGINE =
  cyan gradient) with heights proportional to the 0..1-normalized energy value.
- Per-band delta number with color (emerald <0.1, amber <0.2, rose >0.2).
- Legend at top. Placeholder message if `!refMetrics || !selfMetrics`.
- Pure CSS bars (div + Tailwind height classes) — no chart library.

## CHANGE 3 — Pursuit Status Enhancement
- Added `prevDeltaRef` to track the previous |delta| per dimension.
- New `pursuitRows` useMemo computes for each dimension:
  - target, actual, delta, absDelta, unit, tol.
  - arrow: `'up'` (converging — absDelta shrunk), `'down'` (diverging),
    `'ok'` (within tolerance), `'idle'`.
  - color tier (emerald / amber / rose).
- Added a new CONVERGENCE column to the pursuit table showing TrendingUp /
  TrendingDown / Check icons + a text label ("converging"/"diverging"/"locked"/"idle").
- Updated the explanatory footnote with the arrow legend.

## CHANGE 4 — World Selector Enhancement
- Replaced the hardcoded 6-world `<select>` with a 10-world list mirroring
  `worlds.ts` (progressive-psy, dark-psy, morning-psy, goa, forest, deep-psy,
  hypnotic, cosmic, organic-psy, acid-psy). Each option label is
  `"{name} — {description}"`.
- Added `onUserSelectWorld()` — when the user manually picks a world: turns OFF
  auto mode, sets `activeWorld`, and restarts the engine with the new world.
- Added an "AUTO" badge (fuchsia, pulsing) next to the selector whenever
  `autoSwitchActive` is true.
- When the engine fires `onWorldChange` (Track C auto-switch), the dropdown's
  value, `activeWorld`, and `engineState.style` are all updated to reflect the
  new world, and a `toast.success("Auto-switched to {label}")` is shown
  (deduplicated via `lastSwitchToastRef`).

## CHANGE 5 — Professional polish
- All cards use consistent `border-slate-800 bg-slate-900/60` + `p-4`.
- Numeric values use `font-mono text-[10px]` / `text-[11px]` consistently.
- Long lists use `max-h-96 overflow-y-auto` with `[scrollbar-width:thin]` and
  `[scrollbar-color:rgb(71_85_105)_transparent]` custom styling.
- Sticky footer with `mt-auto`, root wrapper is `min-h-screen flex flex-col`.
- Responsive: cards stack on mobile (`grid-cols-1`), expand to grids on `md:`.
- Color palette: slate / fuchsia / cyan / emerald / amber / rose — NO indigo/blue.
- Header now includes a `STYLE DETECTION` tagline + an `AUTO` badge slot.
- Added `aria-label` on the world/stream `<select>`s and `title` tooltips on
  the spectral bars for accessibility.

## Engine-side additions
```ts
// psy4EngineV2.ts (new public members)
getCurrentWorldId(): string;  // returns currentWorld.id
onWorldChange: ((worldId: string, reason?: string) => void) | null;
```
These are purely additive — no existing API is changed.

## Verification
- `bun run lint 2>&1 | grep -E "page.tsx" | grep error` → **EMPTY** (no errors
  in page.tsx; all 74 lint errors are in `.vercel/output/...` build artifacts,
  which pre-date this task).
- `npx tsc --noEmit --skipLibCheck`:
  - `psy4EngineV2.ts` → ZERO errors.
  - `page.tsx` → 2 errors, both pre-existing (RadioStream + RefProfile type
    mismatches confirmed via `git stash` to pre-date this task — see worklog
    from Track B). My changes actually REDUCED the error count from 3 → 2
    (I fixed the `setEngineState` shape mismatch by including `style`).
- Dev server: `GET / 200 in 53ms` after edits. Page renders STYLE DETECTION,
  Active World, Detected Style, Top 3 Matches, Why this style sections
  immediately on initial load in `listen` mode.
- No regression in radio connect, engine start/stop, or training loop — all
  callbacks (`onMetrics`, `liveTrack`, `selfTrack`, `getPursuitStatus`,
  `applyMusicalUnderstanding`) preserved.

## Hand-off
- Future agents wanting to add more style dimensions: extend the `StyleMatch`
  interface in page.tsx — the UI already handles missing `reasons` gracefully.
- Track C's `applyStyleClassification()` should fire `this.onWorldChange?.(id, reason)`
  after switching worlds so the UI updates without polling. If it doesn't,
  the polling loop in `a.onMetrics` will still pick up the change via
  `getCurrentWorldId()` on every tick (≤1s lag).
- The `pursuitRows` useMemo recomputes on every `pursuit` state change (every
  self-metrics tick). If self-metrics become high-frequency, consider
  throttling the convergence-arrow computation.
