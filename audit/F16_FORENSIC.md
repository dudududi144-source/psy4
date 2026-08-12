# F16 — FORENSIC AUDIT: THE PRODUCT IS NOT YET AN INSTRUMENT

**HEAD:** `fd88446` (F15) · **Method:** Full repo re-read + 256-bar composition measurement + runtime trace.

---

## 1. PRODUCT REALITY

PSY4 at F15 is a **technically functioning demo with a dashboard UI**. It is not yet a coherent musical instrument.

The user experience is: open page → see 5 stacked cards → press PLAY → hear evolving-but-repetitive groove → adjust sliders that mostly change lead density → optionally connect radio → hear ducking.

The user cannot answer these questions from the UI without reading internal state:
- "Where am I in the form?" (partially — timeline exists but is tiny)
- "What is about to happen?" (impossible)
- "How is radio affecting the music?" (impossible — only band meters)
- "What is automatic vs locked?" (partially — AUTO/LOCK badges exist)
- "What is the system doing musically?" (impossible — role is a single word)

**Classification: PRODUCT PROBLEM**

---

## 2. CURRENT USER FLOW

```
Open page (all controls disabled)
→ Press PLAY (controls enable)
→ See timeline activate (tiny, 9px text)
→ See visualizer (decorative, no information)
→ Adjust Energy/Tension (affects lead density only)
→ Switch Style (changes hat/bass count)
→ Optionally: Connect Radio (see LISTENING badge)
→ Optionally: press BREAK/BUILD/DROP (changes density for 4 bars)
→ Scroll down to Mix (4 vertical strips)
→ Scroll down to FX (3 sliders)
```

**Problems:**
- User must scroll to reach Mix and FX
- Timeline is in the header (cramped, 9px text, no playhead)
- No single "center of gravity" — 5 equally-weighted cards
- Radio relationship is invisible (only band meters)
- Arrangement triggers are crammed next to transport

**Classification: UX PROBLEM**

---

## 3. CURRENT INFORMATION ARCHITECTURE

```
HEADER (cramped)
├── PSY4 logo + BPM + KEY + kicks + sync badge
└── Timeline (8 buttons, 9px text, 1 row)

MAIN (vertical scroll, 5 cards)
├── Card 1: Transport + Master VOL + Visualizer + Arrangement triggers
├── Card 2: Music Director (Style + Energy + Tension + live state readout)
├── Card 3+4: Radio + Mix (side by side on desktop)
└── Card 5: FX (3 sliders)

FOOTER
└── Status line
```

**Problems:**
- 5 cards of equal visual weight — no hierarchy
- Timeline is a secondary element (header) when it should be PRIMARY
- Arrangement triggers are crammed into the transport card
- Mix and FX are at the bottom (user must scroll)
- Visualizer takes space but communicates nothing musical
- Live state readout (Section/Phrase/Bar/Role) is a 4-cell grid at the bottom of Music Director — buried

**Classification: ARCHITECTURAL PROBLEM**

---

## 4. DESKTOP LAYOUT PROBLEMS

- **Max width 5xl (1024px)** — wastes screen on 1440px+ displays
- **Vertical scroll required** to reach Mix and FX
- **Timeline in header** — 8 buttons in a single row, each ~60px wide, 9px text. No playhead, no phrase boundaries, no energy curve.
- **No workspace layout** — everything is a single column
- **Arrangement triggers** (BREAK/BUILD/DROP/AUTO) are 4 tiny buttons crammed next to the transport — they should be prominent performance controls
- **Channel strips** are 4 vertical sliders in a row — no group buses, no meters, no pan
- **Visualizer** is a 64px-tall canvas — decorative, not informative

**Classification: UX PROBLEM**

---

## 5. MOBILE LAYOUT PROBLEMS

- **Desktop stacking** — on mobile, all 5 cards stack vertically (same as desktop, just narrower)
- **Timeline** — 8 buttons in a row on a 375px screen = ~40px each, 9px text = illegible
- **Channel strips** — 4 vertical sliders in a row on 375px = ~80px each, barely usable
- **Arrangement triggers** — 4 buttons + transport + master in one row = overflow risk
- **No sticky transport** — user must scroll to top to find PLAY/STOP
- **No bottom action bar** — no touch-friendly mobile interaction pattern
- **No drawers/sheets** — everything is on the main scroll

**Classification: UX PROBLEM + ACCESSIBILITY PROBLEM**

---

## 6. MUSICAL WORKFLOW PROBLEMS

From the 256-bar audit:
- **Kick: 4 unique patterns across 256 bars** (85% are `[0,4,8,12]`). Static loop.
- **Bass: deterministic per section** — same pitches in same positions every cycle. No groove evolution.
- **Hats: deterministic per (style, section)** — no variation within a section.
- **Lead velocity band: 0.30-0.55** — too narrow, accents inaudible. Formula `mn.velocity * (0.5 + ctx.tension * 0.3)` clamps it.
- **Section arc: identical peak/release curve across all 4 cycles** — bars 0-63 == bars 64-127 structurally.
- **Lead: only 1.13 notes/bar average** — sparse even at CLIMAX (1.75/bar).
- **Learning: 129 selections influenced, but motifs are from the same generator** — material is statistically similar.

The music **evolves in surface decoration** (lead notes, velocity jitter) but **not in groove skeleton**. A listener perceives "same groove with varying lead on top" rather than "evolving composition."

**Classification: MUSICAL PROBLEM**

---

## 7. VISUAL HIERARCHY PROBLEMS

- **5 cards of equal weight** — no visual center of gravity
- **Timeline is 9px text** — the most important navigational element is the smallest
- **Arrangement triggers are 9px text** — performance-critical controls are tiny
- **Visualizer is decorative** — 64px of canvas that communicates nothing about musical state
- **Too many accent colors** — cyan, magenta, pink, amber, green, purple, red all compete
- **No consistent spacing system** — gaps vary between 1.5, 2, 3, 4
- **No type scale** — text sizes are 8px, 9px, 10px, 11px, 12px, 14px, 20px (7 sizes, no system)

**Classification: UX PROBLEM**

---

## 8. CONTROL REDUNDANCY

- **Energy slider** → sets ctx.energy → only affects lead density (when not locked). Moving it during INTRO changes nothing audible (lead is 0/resting).
- **Tension slider** → sets ctx.tension → affects lead density + hat velocity. Works, but the effect is subtle.
- **Density slider** → REMOVED from UI in F15 (was dead — ctx.density only affects phrase reward bookkeeping). Good.
- **Style buttons** → change hat/bass count. 4 styles produce different note counts but same groove skeleton.
- **Role readout** (GROOVE/LEAD/BREAK) → single word, doesn't communicate what the engine is doing musically.
- **Kick count metric** → shows total kicks since play. Not useful for performance.

**Classification: DEAD (kick count), DECORATIVE (role readout), MUSICAL PROBLEM (energy/tension too subtle)**

---

## 9. DEAD / DECORATIVE / MISLEADING UI

| Element | Status | Evidence |
|---------|--------|----------|
| Visualizer (canvas) | DECORATIVE | Shows spectrum, no musical information. Runs 60fps RAF even when stopped. |
| Kick count metric | DEAD | `s.kickCount` increments forever. Not useful. |
| Role readout (GROOVE/LEAD/BREAK) | MISLEADING | Single word. Doesn't say what's playing or what's next. |
| Radio band meters (LOW/MID/HIGH) | PARTIALLY DEAD | Shows occupancy 0-100, but no musical interpretation ("bass adapting", "lead creating space"). |
| `getTransportDebug()` polling | DEAD IN UI | Polled every 200ms but only used for sessionSection/phrase/bar/role. 20+ fields fetched, 4 used. |
| `window.__psy4TransportDebug` | REMOVED from UI (good) | Still exists in psyLive.ts for tests. |
| Radio confidence field | DEAD IN UI | In LiveState but not displayed. |
| Learned insights (bpm/key/confidence/scale) | DEAD IN UI | In LiveState but not displayed. |
| Mix mode (solo/glue/reinforce) | DEAD IN UI | In LiveState but not displayed. |
| Harmonic locked | DEAD IN UI | In LiveState but not displayed. |
| Composition mode | DEAD IN UI | In LiveState but not displayed. |

**Classification: 8 dead/decorative elements consuming UI real estate and state bandwidth.**

---

## 10. AUDIO/MUSICAL FEATURES STILL MISSING

- **No groove evolution** — kick/bass/hats are deterministic per section
- **No harmonic re-voicing** — bass always uses root/fifth/third/octave in same order
- **No motif development beyond transforms** — no extension, no fragmentation across phrases
- **No filter automation** — filters are per-note, no macro filter sweeps
- **No stereo width on buses** — only lead has stereo panning
- **No sidechain** — ducking is gain-based, not sidechain compression
- **No master saturation** — waveshaper on individual voices, not on master
- **No multiband** — single comp + EQ + limiter
- **No swing/groove quantization** — steps are rigid 16th grid
- **No pitch bend / glide** — notes are discrete

**Classification: MISSING FEATURES (P2 for most, P1 for groove evolution and swing)**

---

## 11. RADIO EXPERIENCE GAPS

- **Only ducking** — radio affects bus gains, not musical decisions
- **No complement** — engine doesn't play "with" radio, just "under" it
- **No call-and-response** — engine doesn't respond to radio phrases
- **No key harmonization** — engine copies radio key but doesn't harmonize
- **No tempo sync display** — user can't see if BPM is following radio
- **No "radio influence" macro** — no single control for how much radio affects the engine
- **No radio loss/recovery visualization** — user sees HOLDOVER badge but no explanation

**Classification: MUSICAL PROBLEM + MISSING FEATURE**

---

## 12. COMPOSITION EXPERIENCE GAPS

- **No motif visualization** — user can't see the current motif or its development
- **No "what's next" preview** — user can't see upcoming section or transition
- **No phrase-level control** — can't extend/freeze/evolve a phrase
- **No harmonic display** — user can't see what key/scale is active
- **No tension/energy curve** — user can't see the arc over time
- **Arrangement triggers are fire-and-forget** — no visual feedback that BREAK is active or how many bars remain

**Classification: MISSING FEATURES**

---

## 13. MIXING EXPERIENCE GAPS

- **No meters** — channel strips have no VU/peak meters
- **No pan** — no stereo positioning per channel
- **No sends** — no per-channel delay/reverb send amounts (only hardcoded lead sends)
- **No group buses** — no DRUMS/LOW/MUSIC/RADIO grouping
- **No master meter** — no output level visualization
- **Mute/solo are tiny 20px buttons** — hard to hit on mobile

**Classification: MISSING FEATURES + UX PROBLEM**

---

## 14. PERFORMANCE / RESPONSIVENESS GAPS

- **200ms polling** of `getTransportDebug()` — fetches 20+ fields, uses 4. Wasteful.
- **60fps visualizer RAF** — runs even when stopped. Should be paused.
- **No memoization** — sessionSnap causes full re-render every 200ms
- **No throttling** — slider changes fire engine calls on every pixel of drag
- **Canvas redraws every frame** — even if nothing changed

**Classification: PERFORMANCE PROBLEM**

---

## 15. ACCESSIBILITY / TOUCH GAPS

- **9px text** — below WCAG minimum (12px)
- **20px mute/solo buttons** — below 44px touch target
- **No keyboard navigation** — no tab order, no shortcuts
- **No ARIA labels** — screen readers can't interpret controls
- **Color-only state** — active channels indicated by color only, no text/icon
- **No focus indicators** — focused controls not visible

**Classification: ACCESSIBILITY PROBLEM**

---

## 16. WHAT MUST NOT BE CHANGED

- **MusicalTransport** — zero-drift clock, 27 tests, clean. Do not touch.
- **RadioObservationLayer** — markConnected wiring (F14 fix), beat detection. Clean.
- **BeatObservationEngine + BeatPLL** — 48 convergence tests. Clean.
- **MelodyObserver (YIN)** — 13 acceptance tests. Clean.
- **Master safety limiter** — protects against clipping. Keep.
- **Duck gain separation** (F14 R3) — user mixer survives radio. Keep.
- **User locks** (F14 R2B) — AUTO/LOCK for energy/tension/style. Keep.
- **Arrangement API** (F15 P4) — forceSection/triggerBreak/Build/Drop. Keep.
- **3-band master EQ** (F15 P1) — frequency balancing. Keep.
- **Waveshaper saturation** (F15 P1) — harmonic content. Keep.
- **Style grammar** (F15 P3) — 4 styles with distinct patterns. Keep (but extend).
- **Harmonic movement** (F15 P2) — bass root→fifth→third→octave. Keep (but add evolution).

---

## 17. F16 IMPLEMENTATION PLAN

### Phase A — GROOVE EVOLUTION (fixes the #1 musical problem)
The 256-bar audit proved kick/bass/hats are deterministic. Fix:
- **Kick grammar**: expand from 4 patterns to 8-12, selected by (section, phrase, cycle). Add ghost-note patterns, offbeat accents, fill variations.
- **Bass grammar**: add walking patterns, octave shifts, syncopation variations. Per-cycle drift (cycle 2 walks earlier, cycle 3 adds syncopation).
- **Hat grammar**: add swing (delay odd steps), open/closed patterns, velocity accent patterns.
- **Lead velocity**: widen from 0.30-0.55 to 0.20-0.85. Replace formula with full-range velocity.

### Phase B — UI REBUILD AS WORKSPACE (fixes the #1 UX problem)
Replace the 5-card stack with a workspace layout:
- **TOP BAR**: Transport (Play/Stop, BPM, Master vol) + Status (sync badge, section, bar)
- **TIMELINE** (primary, full-width): 8 section blocks with playhead, phrase boundaries, energy/tension curve overlay, upcoming transition indicator. Click to jump.
- **PERFORMANCE STRIP** (below timeline): Energy / Tension / Radio Influence macros with AUTO/LOCK. Large, touch-friendly.
- **ARRANGEMENT TRIGGERS**: BREAK / BUILD / DROP / RETURN — prominent, with active-state feedback and bar countdown.
- **MIX** (right panel on desktop, drawer on mobile): 6 channel strips (Kick/Bass/Hats/Lead/FX/Radio) with meters.
- **FX** (bottom panel on desktop, drawer on mobile): Echo / Space / Drive macros.

### Phase C — MOBILE LAYOUT (fixes the #1 mobile problem)
- **Sticky bottom transport bar**: Play/Stop + BPM + section always accessible
- **Horizontal timeline**: swipeable section blocks
- **Bottom sheets**: Mix and FX in collapsible drawers
- **Touch targets**: minimum 44px
- **No horizontal overflow**

### Phase D — RADIO AS MUSICAL FEATURE
- **Radio influence macro**: single slider controlling how much radio affects the engine
- **Adaptation display**: "BASS adapting", "LEAD creating space", "GROOVE following" — derived from occupancy
- **Radio vs engine separation**: clear visual distinction between radio input and engine response

### Phase E — PERFORMANCE + CLEANUP
- **Throttle slider input** (16ms)
- **Pause visualizer when stopped**
- **Replace 200ms debug polling** with targeted state query (only fetch what UI needs)
- **Remove dead LiveState fields** (kickCount, learned, mixMode, harmonicLocked, compositionMode)
- **Remove decorative visualizer** or make it informational (show kick/bass/lead/hat activity)

### Phase F — AUDIO PROOF
- **OfflineAudioContext render** of 64 bars
- Measure: peak, RMS, crest factor, clipping, channel balance, low-end dominance
- Verify mixer changes are audible
- Verify FX changes are audible
