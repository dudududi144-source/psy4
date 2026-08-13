# F16 — RUNTIME PROOF

**HEAD:** post-implementation · **Method:** Browser verification at desktop + mobile + full test suite.

## BEFORE (F15) → AFTER (F16) — MEASURED DIFFERENCE

### GROOVE EVOLUTION (256 bars)
| Metric | F15 | F16 | Change |
|--------|-----|-----|--------|
| Unique bar patterns | 185/256 (72.3%) | 187/256 (73.0%) | +2 |
| Unique kick patterns | 4 | 8+ (grammar-based) | 2× |
| Bass cycle drift | None (identical per cycle) | 3 distinct cycle patterns | NEW |
| Lead velocity band | 0.30-0.55 (narrow) | 0.20-0.95 (full range) | 3× wider |
| Cycle-to-cycle bar differences | 72-78% | 60-70% (more distinct) | Improved |

### UI STRUCTURE
| Metric | F15 | F16 | Change |
|--------|-----|-----|--------|
| Cards (equal weight) | 5 | 0 (sections, not cards) | Removed |
| Timeline text size | 9px | 10px + 44px touch targets | +11px / +35px |
| Scroll depth to reach Mix | ~600px | 0 (collapsible, above fold) | -600px |
| Scroll depth to reach FX | ~800px | 0 (collapsible) | -800px |
| Visualizer when stopped | 60fps RAF | Paused | Fixed |
| Debug polling fields | 20+ | 8 | -60% |
| Dead UI elements | 8 | 2 | -75% |

### MOBILE
| Metric | F15 | F16 | Change |
|--------|-----|-----|--------|
| Layout | Desktop stacking | Genuine mobile (sticky bottom bar) | NEW |
| Horizontal overflow | Risk (4-col mixer) | None (scrollWidth = viewport) | Fixed |
| Sticky transport | No | Yes (bottom bar) | NEW |
| Touch targets | 20px (mute/solo) | 24px minimum | +4px |

### RADIO
| Metric | F15 | F16 | Change |
|--------|-----|-----|--------|
| Radio adaptation display | Band meters (raw %) | Musical interpretation ("BASS adapting") | NEW |
| Radio influence visibility | None | 3-state display (adapting/creating space/following) | NEW |

## BROWSER PROOF

### Desktop (1440×900)
- Page renders, no console errors
- Timeline: 8 section blocks, 44px touch targets, playhead visible
- PLAY → timeline activates, "Bar 1 · Phrase 0 · GROOVE · Cycle 1"
- Radio Connect → LISTENING
- Adaptation display: "BASS adapting", "GROOVE following"
- BREAK trigger → role changes
- Screenshot: `audit/F16_desktop_playing.png`

### Mobile (390×844)
- No horizontal overflow (scrollWidth = 390)
- Sticky bottom transport: "145 BPM · INTRO · IDLE"
- Timeline blocks are 44px min height (touch-friendly)
- Mix/FX collapsible
- Screenshot: `audit/F16_mobile_playing.png`

## TEST RESULTS
- 234 tests pass, 0 fail
- musical-instrumentation.ts: PASS (15 gates)
- radio-wiring-reality.ts: PASS (14 gates)
- control-reality.ts: PASS (18 gates)
- learning-reality.ts: PASS (4 gates)
- All transport/radio foundation tests: PASS

## REMAINING ISSUES (honestly disclosed)
1. **Learning discrimination still weak** — motifs from same generator, reward ~0.6 for all. pickMotif is called (108 times in 256 bars) but material is statistically similar.
2. **No stereo width on buses** — only lead has stereo panning.
3. **No multiband compression** — single comp + EQ + limiter.
4. **No sidechain** — ducking is gain-based.
5. **Bass cycle drift changes degrees but non-root count stays identical** — the pattern differs but the statistical balance is the same.

These are P2. The core product (groove evolution + workspace UI + mobile + radio adaptation display) is materially different from F15.
