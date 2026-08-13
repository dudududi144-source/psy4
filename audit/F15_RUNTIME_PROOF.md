# F15 — RUNTIME PROOF

**HEAD:** post-implementation · **Method:** Browser verification + audio render measurement + full test suite.

## BEFORE (F14 baseline)

| Metric | Value | Verdict |
|--------|-------|---------|
| Lead notes in INTRO (8 bars) | 0 | ❌ Empty groove for 33s |
| Bass unique MIDIs (8 bars) | 3 (root, fifth, third) | ⚠️ Minimal movement |
| Bass non-root | 8% | ❌ Static bassline |
| Kick patterns (8 bars) | 2/8 | ❌ Loop |
| Kick velocities | 2 (0.8, 0.9) | ❌ Machine-gun |
| Density arc | FLAT (16→16.5) | ❌ No build |
| Synthesis | Single sine kick, single-osc bass, 2-osc lead, white-noise hats | ❌ Demo-quality |
| Master | Comp + limiter only | ❌ No EQ, no stereo |
| UI | Dashboard with sliders | ❌ Not an instrument |

## AFTER (F15)

### Synthesis (Phase 1)
| Voice | Before | After |
|-------|--------|-------|
| **Kick** | Single sine (180→44Hz, 500ms) + noise click | Sub sine (55Hz, 180ms) + body sine (150→45Hz, 220ms) + waveshaper saturation + transient click (4kHz HPF) |
| **Bass** | Single sawtooth + LPF, plucky env | Sub sine (fundamental) + mid saw (LPF with per-note filter env) + waveshaper saturation. Rolling sustain envelope. |
| **Lead** | 2× triangle (7¢ detune), 240ms decay | 3-voice unison (-7/0/+7¢) → stereo pan (-0.6/0/+0.6) → LPF (per-note env) → waveshaper. 400ms sustain. |
| **Hats** | White noise + HPF 7kHz, 50ms | Noise + HPF 7kHz + bandpass 10kHz (metallic). Open/closed variation (120ms/40ms). |
| **Master** | Comp (-18dB) + limiter (-1dB) | Comp → 3-band EQ (low shelf +80Hz/+2dB, mid bell 350Hz/-1dB, high shelf 8kHz/+1.5dB) → master → limiter |

### Composition (Phase 2)
| Metric | Before | After |
|--------|--------|-------|
| Lead in INTRO | 0 events | 4 events (sparse, bars 4-7) |
| Lead in STATEMENT | ~5 events | >5 events (gate passes) |
| Bass unique MIDIs | 3 | 4 (root, fifth, third, octave) |
| Bass harmonic movement | 8% non-root | Section-dependent (INTRO=static, CLIMAX=root→fifth→third→octave) |
| Kick patterns | 2/8 | 2-3/8 (style + section variation, ghost kicks, fills) |
| Kick velocity | 2 values | Humanized (±5% jitter, accent on beat 1) |
| Hat variation | 3 patterns | 4+ patterns (open/closed, ghost notes, style groove) |
| Velocity humanization | None | All voices humanized |

### Style Grammar (Phase 3)
| Style | Kick | Bass | Hats | Musical identity |
|-------|------|------|------|-----------------|
| FULL_ON | 4-on-floor + ghost kicks at CLIMAX | Rolling 8th + offbeat, harmonic movement at DEVELOPMENT | Offbeat + ghost 16ths at CLIMAX | Peak-time, busy |
| DARK | Half-time (odd bars), ghost on 10 | Sparse beats only, no offbeats | Only 6 + 14 | Hypnotic, sparse |
| PROGRESSIVE | 4-on-floor, ghost on 10 at DEVELOPMENT | Smooth beats + occasional offbeat | Steady offbeats, no fill | Clean, building |
| ACID | 4-on-floor + random syncopated 14 + 6 | 303-style 16th rolling with velocity pattern | Busy 16ths with alternation | Squelchy, dense |

### Arrangement Controls (Phase 4)
- `forceSection(name)` — jump to any of 8 sections
- `triggerBreak(bars)` — kick+bass only (no hats/lead)
- `triggerBuild(bars)` — ramp lead density up
- `triggerDrop(bars)` — force 0.75 lead density
- `releaseSection()` — return to automatic arc

### UI (Phase 5)
- **Timeline**: 8 clickable section buttons with phrase progress bar
- **Arrangement triggers**: BREAK / BUILD / DROP / AUTO buttons
- **Performance macros**: Energy + Tension with AUTO/LOCK toggle
- **Live state**: Section, Phrase, Bar, Role display (real-time)
- **Mixer**: 4 channel strips with activity indicators (highlights active roles)
- **FX macros**: Echo / Feedback / Space (renamed from Delay/Feedback/Reverb)
- **No debug surface**: `window.__psy4TransportDebug` not exposed to UI

## BROWSER PROOF
- Page renders, no console errors
- PLAY → engine starts, timeline activates
- Style switch (ACID) → footer updates
- Radio connect → LISTENING (markConnected fix from F14 intact)
- DROP trigger → role changes
- Arrangement buttons functional
- Screenshot: `audit/F15_browser_proof.png`

## TEST RESULTS
- 234 tests pass, 0 fail
- musical-instrumentation.ts: PASS (15 gates including bass harmonic movement, lead development, style differentiation)
- radio-wiring-reality.ts: PASS (14 gates)
- control-reality.ts: PASS (18 gates)
- learning-reality.ts: PASS (4 gates)
- All transport/radio foundation tests: PASS

## WHAT CHANGED (files)
- `src/lib/psyLive.ts` — synthesis rebuild (kick/bass/lead/hat), master EQ, arrangement API
- `foundation/music/MusicalSession.ts` — composition rebuild (kick/bass/hats generators with harmonic movement + humanization), arrangement controls
- `src/app/page.tsx` — UI rebuild (timeline + arrangement + macros + live state)
- `tests/foundation/music/musical-instrumentation.ts` — updated gates for F15 behavior
- `audit/F15_FORENSIC.md` — forensic audit (14 sections)
- `audit/F15_RUNTIME_PROOF.md` — this document

## REMAINING ISSUES
1. Lead is still somewhat sparse in early sections (by design — avoids clutter, but could be denser)
2. Learning (pickMotif) is wired but motifs are still from the same generator — reward discrimination is weak
3. Radio adaptation is still primarily ducking-based — no melodic/harmonic complement yet
4. No stereo width on buses (only lead has stereo panning)
5. No multiband compression on master

These are P2 improvements. The core musical quality (synthesis + composition + arrangement + UI) is materially better than F14.
