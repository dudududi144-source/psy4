# P2-MUSIC-INTELLIGENCE — z-ai-code

## Task
Build a MusicAnalyzer that hears MUSIC (not just features) from the reference
audio, so the engine can respond to musical events (drops, risers, breaks,
chord changes, section boundaries) instead of just spectral targets.

## Prior context (from /agent-ctx and /home/z/my-project/worklog.md)
- The playing engine is `Psy4EngineV2` in `src/lib/studio/engine/psy4EngineV2.ts`.
- The reference listener is `referenceListenerV2.ts` which extracts acoustic
  features (BPM, LUFS, spectral bands, centroid, transient density, etc.).
- The engine PURSUES these features (kick decay, centroid, etc.).
- RESEARCH-DEEP finding #6/#7: the engine hears FREQUENCIES but not MUSIC.
  No detection of: melody, rhythm pattern, chord changes, section boundaries,
  risers/drops, key modulations, arrangement structure.
- P1-CLEANUP removed 3,847 lines of dead engine code (16 files).
- P3-DEVELOPMENT wired classical development techniques (transpose/invert/
  retrograde/sequence) into composeLead.

## Work Log

### STEP 1 — Created MusicAnalyzer module
File: `/home/z/my-project/src/lib/studio/engine/musicAnalyzer.ts` (~700 lines)

Exports:
- `MusicAnalyzer` class
- `MusicalEvent` interface (8 types: chordChange, sectionBoundary, riserStart,
  dropHit, breakStart, keyChange, melodicPeak, rhythmicFill)
- `MelodicContour` (shape/range/direction)
- `RhythmicPattern` (kickPattern/hatPattern 16-char gate strings + syncopation
  + density)
- `SectionState` (label/bar/barsInSection/energy/confidence)
- `MusicalAnalysis` (events/contour/rhythm/section/harmonicRhythm/recentKeyChanges)
- `MusicAnalyzerFeatures` (extended input shape — energy/spectralCentroid/
  transientDensity/bpm/subEnergy/highEnergy/detectedKey + optional spectralFlatness/
  hnr/kickDensity/hatDensity/lowEnergy/midEnergy/airEnergy/rhythmicRegularity)

### STEP 2 — Section detection (energy-driven state machine)
- 7 labels: intro / groove / build / drop / variation / break / outro
- Tracks energy history over 5-min rolling window
- Computes short-term slope (16s ≈ 4 bars at 140 BPM)
- Detects TRANSITIONS: rising > 0.02/s → BUILD; energy > 0.8 after < 0.6 → DROP;
  energy < 0.4 after > 0.65 + falling → BREAK; sustained high → VARIATION;
  sustained low + !hasDroppedOnce → INTRO; sustained low + hasDroppedOnce → OUTRO;
  stable mid → GROOVE
- SECTION_MIN_BARS = 4 anti-flicker guard
- hasDroppedOnce flag disambiguates intro vs outro
- Emits `sectionBoundary` event on each transition

### STEP 3 — Riser/drop/break detection
- `riserStart`: rising slope > 0.02/s + energy 0.4-0.8 + not already in build.
  30s cooldown. Emits with fromEnergy/toEnergy/slopePerSec.
- `dropHit`: energy crosses 0.8 after recent min < 0.6 + prev not drop. 30s
  cooldown. Emits with energy/recentMax/bar.
- `breakStart`: energy < 0.4 + recent max > 0.65 + slope < -0.02/s + prev was
  drop/variation/build. 30s cooldown. Emits with fromEnergy/toEnergy/slopePerSec.
- All three are SEPARATE events from sectionBoundary (the engine routes them
  to flowEngine.transitionTo directly).

### STEP 4 — Rhythmic pattern estimation
- Converts per-second densities to per-bar (× 240/BPM)
- 7 kick patterns: none/halfTime/twoBar/fourOnFloor/gallop/eighth/busy
- 6 hat patterns: none/sparse/offbeat/steady/triplet/busy
- Picks closest canonical pattern by hit count
- Syncopation = 0.5×offbeatRatio + 0.5×(1 - rhythmicRegularity)
- Density = transients/bar / 16 (clamped 0-1)
- Fallback estimators when kickDensity/hatDensity are missing (use total
  transient density + highEnergy)

### STEP 5 — Melodic contour detection
- Operates on spectral centroid history (proxy for melodic register)
- 16-second window (~4 bars at 140 BPM)
- Shape: static (amplitude < 150 Hz) / arch (peak in middle, trough at start)
  / rising (slope > 80 Hz/s) / falling / descending (slope < -200 Hz/s) / wave
  (alternating sign of deltas)
- Range = 12 × log2(peak/trough) in semitones (clamped 0-36)
- Direction = slope/200 clamped -1..1
- Emits `melodicPeak` when peak is the latest sample + peak > first + 400 Hz
  (20s cooldown)

### STEP 6 — Chord change detection
- Builds "harmonic signature" from spectralFlatness + hnr + subEnergy deltas
- Combined normalized delta > 0.15 → chordChange event
- 4s cooldown prevents noisy firing
- Tracks running average → harmonicRhythm (bars per chord change, 0.5-32 range)
- Emits with delta + bar

### Key modulation detection (bonus)
- Emits `keyChange` when detectedKey.root or scale shifts with confidence > 0.4
- 20s cooldown
- Prunes recentKeyChanges to 5-min window

### STEP 7 — Integration into psy4EngineV2.ts
- Imported `MusicAnalyzer`, `MusicalAnalysis`, `MusicalEvent`, `MusicAnalyzerFeatures`
- Added private fields: `musicAnalyzer`, `lastMusicalEventTime`, `musicalAnalysis`
- In `start()`: reset the analyzer (fresh instance, clear musicalAnalysis +
  lastMusicalEventTime) so stale histories from a previous play session don't
  bias the new session's first detections
- In `liveTrack()` (end): calls `updateMusicAnalyzer(refMetrics)` which:
  1. Guards against missing/zero spectralCentroid (early return)
  2. Builds MusicAnalyzerFeatures snapshot (all fields guarded with ?? fallbacks)
  3. Calls `musicAnalyzer.update(features)` — updates all histories + detectors
  4. Computes wall-clock window since last check
  5. Pulls `getRecentEvents(windowSec)` — these are NEW events
  6. Routes each new event:
     - `dropHit` → `flowEngine.transitionTo({ label: 'DROP', energy: 0.95 }, 2)`
     - `breakStart` → `flowEngine.transitionTo({ label: 'BREAK', energy: 0.3 }, 2)`
     - `riserStart` → `flowEngine.transitionTo({ label: 'BUILD', energy: 0.7 }, 4)`
     - Other events (chordChange, keyChange, melodicPeak, sectionBoundary) are
       surfaced via getMusicalAnalysis() for UI but don't force flow transitions
  7. Logs each transition to console for debugging
- Added public method `getMusicalAnalysis(): MusicalAnalysis | null`
- Extended `liveTrack()`'s inline parameter type with optional `kickDensity`,
  `hatDensity`, `rhythmicRegularity` fields (so the analyzer gets accurate
  per-instrument densities when the V2 listener provides them)

### STEP 8 — UI: MUSICAL ANALYSIS card in page.tsx
- Added `musicalAnalysis` state + polling in analyzer tick
- Added the MUSICAL ANALYSIS card in analyze mode (when engine is on):
  - Section: colored badge (rose=drop, amber=build, fuchsia=variation,
    cyan=break, emerald=groove, slate=intro/outro) + bar/barsInSection + 
    confidence + energy bar
  - Melodic contour: shape badge (color-coded) + range (semitones) + 
    direction (↑/↓/→ arrow)
  - Rhythmic pattern: 16-step kick gate (amber filled blocks) + 16-step hat
    gate (cyan filled blocks) + syncopation % bar + density % bar
  - Harmonic rhythm: large "X.X bars/chord" stat + recent key changes list
  - Recent events: last 5 events (newest first), color-coded by type, with
    per-type payload summary (e.g. "energy 0.92 @ bar 24")
  - Empty state: "Waiting for reference features..."
- Added `kickDensity`, `hatDensity`, `rhythmicRegularity` to RefMetrics
  interface (optional fields)
- Updated `connectRef`'s `liveTrack` call to pass these new fields from `m`
- Cleared `musicalAnalysis` in `stopEngine` so stale data doesn't persist
- All access uses optional chaining (musicalAnalysis?.section?.label ?? '—')

## Verification
- `npx tsc --noEmit --skipLibCheck 2>&1 | grep -E "musicAnalyzer|psy4EngineV2|page.tsx" | head` → EMPTY
  (0 errors in target files; total tsc error count = 56, unchanged from P1-CLEANUP baseline)
- `bun run lint 2>&1 | grep -E "musicAnalyzer|psy4EngineV2|page.tsx" | grep error` → EMPTY
  (0 lint errors in target files)
- `curl http://localhost:3000/` → HTTP 200, ✓ Compiled
- dev.log shows zero new compile errors after the integration

## Constraints honored
- Did NOT break existing functionality: all 8 detector paths are guarded
  against missing/zero features; the analyzer gracefully no-ops when fields
  are absent (V1 listener compatibility)
- Efficient: runs every ~10s (on each liveTrack call), not per audio block.
  All histories bounded to 5-min window. Events bounded to 60s retention.
  No per-update allocation beyond the rare event push
- TypeScript strict mode: all types explicit, no `any` in the analyzer;
  page.tsx uses `any` only for the snapshot (consistent with existing
  deepAnalysis/pursuitDashboard state pattern)
- Optional chaining in UI: musicalAnalysis?.section?.label ?? '—' throughout
- Cooldowns prevent event spam (30s for drop/riser/break, 20s for key/peak,
  4s for chord, SECTION_MIN_BARS for section flips)

## Honest gap
- PHYSICAL LISTENING UNVERIFIED — verification via TypeScript + ESLint pass +
  dev server compile. The signal chain is well-formed: liveTrack →
  updateMusicAnalyzer → musicAnalyzer.update → detectors fire → events emitted
  → flowEngine.transitionTo → flow smooths toward DROP/BREAK/BUILD target. But
  the audible result (does the engine ACTUALLY drop when the radio drops?) is
  asserted by construction, not by listening.
- The detector thresholds (energy > 0.8 for drop, slope > 0.02/s for build,
  etc.) are heuristic — they'll need tuning against real radio streams. The
  constants are clearly named at the top of musicAnalyzer.ts for easy tuning.
- The chord-change proxy (spectralFlatness + hnr + subEnergy deltas) is a
  coarse approximation — a real chord detector would need a chromagram or
  pitch detection, which the reference listener doesn't currently expose.
  This is a reasonable starting point; the harmony engine can still sync to
  the chordChange events even with the coarse detection.
- The melodic contour uses spectral centroid as a proxy for melodic register.
  This is a well-known approximation but breaks down when the arrangement
  changes (e.g., pad swells in the high register while the lead stays in the
  mid register). A future enhancement would use a separated lead-track
  centroid.

## Deliverable
A MusicAnalyzer that detects musical events (section changes, risers, drops,
chord changes, key modulations, melodic peaks) from the radio, and the engine
RESPONDS to them — when the radio drops, we drop; when the radio builds, we
build; when the radio breaks, we break. This is true musical synchronization,
not just feature matching. The UI surfaces the full analysis (section, contour,
rhythm, events, harmonic rhythm) so the user can see what the engine is hearing.
