# F15 — FORENSIC AUDIT: WHY THE MUSIC IS MEDIOCRE

**HEAD:** `ec7cc5e` (F14) · **Method:** Read every line of production code + render actual audio + measure composition output.

This is not a test-pass report. This is a brutal technical roast of why PSY4 still sounds like a demo despite F14's "PASS".

---

## 1. VISION vs REALITY

| VISION | IMPLEMENTATION | RUNTIME AUDIO | USER EXPERIENCE | STATUS |
|--------|---------------|---------------|-----------------|--------|
| "Musical instrument" | Dashboard with sliders | Flat groove, no lead for 8 bars | Feels like a debug tool | **FALSE** |
| "Composition engine" | Hardcoded step arrays | Kick identical 7/8 bars, bass always root | Loop, not music | **FALSE** |
| "Radio follower" | markConnected wired | BPM follows (proven) | Ducking only, no musical adaptation | **PARTIAL** |
| "Learning" | pickMotif called | All motifs from same generator | Same music regardless | **FALSE** |
| "Styles" | Parameter presets | Different hat counts | Same groove, same bass, same harmonic identity | **FALSE** |
| "64-bar arrangement arc" | Lead density 0.2→0.6 | Only lead density changes | No audible arrangement | **FALSE** |
| "Professional synthesis" | Single sine kick, single-osc bass, thin lead | Demo-quality waveforms | Sounds like a tutorial | **FALSE** |

**7 of 7 core claims are FALSE or PARTIAL at the audio/experience level.**

---

## 2. RUNTIME ARCHITECTURE (what actually runs)

```
page.tsx (446 lines, dashboard UI)
  ↓ engine.setStyle / setEnergy / play / connectRadio
psyLive.ts (1134 lines, the engine)
  ├── ensureAudio() — creates audio graph
  ├── scheduler() — reads Transport, schedules 16th notes
  ├── scheduleStep() — reads NotePlan, calls kick/bass/lead/hat
  ├── detect() — radio analysis + ducking
  └── voices: kick(), bass(), lead(), hat()
       ↓
MusicalTransport (clock, clean)
  ↓ snapshot().beatTime / .bar / .bpm
MusicalSession.planBar() (composer)
  ├── generateKick() — hardcoded step arrays
  ├── generateBass() — hardcoded step arrays, root note
  ├── generateHats() — hardcoded step arrays
  ├── calculateLeadDensity() — section + style multipliers
  └── generateLead() — motif subset, clamped to MIDI 48-72
       ↓
NotePlan (metadata, cached per bar)
  ↓
scheduleStep plays it
```

**What runs:** Transport (clean), scheduler (clean), composer (hardcoded), voices (demo-quality).
**What doesn't run:** Nothing is dead — but everything is minimal.

---

## 3. MUSICAL AUTHORITY MAP

| Decision | Owner | Reality |
|----------|-------|---------|
| WHAT notes | MusicalSession | ✅ Single composer |
| Kick pattern | generateKick | ❌ Hardcoded `[0,4,8,12]` — no grammar, no variation |
| Bass notes | generateBass | ❌ Hardcoded root on 8 steps — no harmonic movement |
| Hat pattern | generateHats | ❌ Hardcoded `[2,6,10,14]` — no groove, no swing |
| Lead notes | generateLead + motif | ⚠️ Motif from generateMotif (random), but only ~1 note/bar at CLIMAX |
| Velocity | generateKick/Bass/etc | ❌ 2 values (0.8, 0.9) — no humanization |
| WHEN | Transport + scheduler | ✅ Clean |
| HOW LOUD | bus.gain × mute × duck | ✅ Clean (F14 fixed) |
| Arrangement | COMPOSITION_ARC | ❌ Only changes lead density, not kick/bass/hats |

**Authority is technically clean but musically empty.** The composer owns WHAT, but WHAT is always the same.

---

## 4. AUDIO AUTHORITY MAP (synthesis quality)

### KICK — `psyLive.ts:453-475`
```
sine osc: 180Hz → 44Hz (exp ramp, 90ms)
gain: 1.0 → 0.001 (exp, 500ms)
+ noise click: HPF 3kHz, 0.4 → 0.001 (20ms)
→ kickBus
```
**FAILURES:**
- Single sine oscillator. No sub-bass layer (real kicks have a 50-60Hz sine sustain).
- No saturation/distortion. Pure sine = weak, thin, "demo" sound.
- 500ms decay is too long for 145 BPM (should be ~150-250ms).
- No velocity-to-pitch relationship (real kicks pitch down slightly at lower velocity).
- Click is white noise, not a characterized transient.
- Every kick sounds identical (no variation beyond 2 velocity values).

### BASS — `psyLive.ts:488-504`
```
sawtooth osc → LPF (Q from preset)
filter: bassCut → bassCut*0.5 (exp, 250ms)
gain: 0.0001 → 0.85 (6ms) → 0.3 (150ms) → 0.001 (350ms)
→ bassBus
```
**FAILURES:**
- Single oscillator. Real psytrance bass = sub sine + mid saw + optional grit.
- Envelope is "plucky" (decays to 0.3 then 0.001). Not rolling/sustained — there's a gap between 16th notes.
- No distortion/saturation. Pure sawtooth through LPF = thin.
- Filter sweep is identical every note. No movement.
- All notes are root MIDI. No octave movement, no walking, no arpeggiation.
- No stereo (mono).

### LEAD — `psyLive.ts:506-528`
```
2× osc (triangle/square, 7¢ detune) → LPF (Q halved)
filter: 200 → peakCut (20ms) → 300 (220ms)
gain: 0.0001 → peak (10ms) → 0.001 (240ms)
→ leadBus (+ delay 0.12, reverb 0.15)
```
**FAILURES:**
- 2 oscillators only. Real psytrance leads use 3-7 voice unison.
- 240ms decay = stabs, not a melodic line. Notes don't sustain.
- No articulation variation. Every note same envelope. No legato, staccato, glide.
- Filter sweep identical every note. No movement.
- Peak gain 0.27 (accent) / 0.189 (non-accent) — very quiet, masked by kick+bass.
- No stereo widening.

### HATS — `psyLive.ts:477-486`
```
white noise → HPF 7kHz → gain (lvl → 0.001, 50ms)
→ hatBus
```
**FAILURES:**
- White noise = cheap. Real hats use metallic noise (ring mod, filtered square).
- 50ms decay, no variation. No open/closed hats.
- No swing/groove. All land exactly on step.
- No velocity humanization.

### MASTER — `psyLive.ts:355-369, 431-444`
```
voices → bus (user) → mute → duck → engineBus (0.8)
  → comp (-18dB, 2:1, knee 18) → master (0.9)
  → safetyLimiter (-1dB, 20:1, 3ms) → analyser → destination
```
**FAILURES:**
- No EQ. No frequency balancing.
- No stereo width. Everything mono (except reverb wet).
- Comp threshold -18dB with 2:1 is barely audible. No glue.
- No multiband. No low-end control.
- Safety limiter 3ms attack = transients leak through.

---

## 5. COMPOSITION REALITY (empirical measurement)

Rendered 8 bars at 145 BPM via the real scheduler:

| Metric | Value | Verdict |
|--------|-------|---------|
| Total notes | 97 | Sparse |
| Lead notes | **0** (INTRO = no lead) | ❌ EMPTY |
| Bass unique MIDIs | 3 (45, 49, 52) | ❌ No harmonic movement |
| Bass non-root | 5/64 (8%) | ❌ Static bassline |
| Kick patterns | 2/8 bars | ❌ Loop |
| Kick velocities | 2 (0.8, 0.9) | ❌ Machine-gun |
| Notes/bar | 16, 16, 16, 16, 16, 16, 16, 18 | ❌ FLAT (no build) |
| Density arc | first=16.0, second=16.5 | ❌ No build |

**The first 8 bars (33 seconds at 145 BPM) have NO LEAD.** The user hears kick + bass + hats only. That's not a composition — it's a drum loop.

---

## 6. THE 64-BAR ARC LIE

`COMPOSITION_ARC` defines 8 sections: INTRO→STATEMENT→DEVELOPMENT→RESPONSE→CONTRAST→DEVELOPMENT2→CLIMAX→RESOLUTION.

**What it actually changes:**
- `targetTension` → affects lead density (0.2→0.6) and hat velocity (0.25→0.49)
- Nothing else.

**What it does NOT change:**
- Kick pattern (always 4-on-floor within a style)
- Bass pattern (always root on 8 steps within a style)
- Hat pattern (always offbeat within a style)
- Synthesis parameters (no timbre evolution)
- FX state (no delay/reverb changes per section)
- Velocity curves

**The 64-bar "arc" is a lead-density knob, not an arrangement.** A real arrangement would: drop elements during breaks, add layers during builds, change the bassline during development, open the filter during climax. None of this happens.

---

## 7. STYLE LIE

F14 claimed "styles materially differ". Empirical measurement (8 bars each):

| Style | Hats/bar | Bass/bar | Kick pattern | Bass MIDIs | Lead |
|-------|----------|----------|---------------|------------|------|
| FULL_ON | 4.1 | 8 | 4-on-floor | root | sparse |
| DARK | 2.1 | 4 | 4-on-floor (half-time odd bars) | root | sparser |
| PROGRESSIVE | 4.0 | 6 | 4-on-floor (no fill) | root | sparse |
| ACID | 8.1 | 10 | 4-on-floor + random step 14 | root + 2 syncopated | sparse |

**All 4 styles play 4-on-floor kick. All 4 play root bass. All 4 have the same lead behavior.** The only difference is HAT COUNT and BASS COUNT — that's a density preset, not a musical identity.

A real style system would change:
- Groove grammar (syncopation, swing, ghost notes)
- Bass articulation (rolling vs plucky vs sustained)
- Harmonic behavior (modal interchange, pedal points)
- Lead phrasing (call/response length, register, articulation)
- Arrangement arc (where the peak is, how long the break is)

None of this exists.

---

## 8. LEARNING LIE

F14 wired `pickMotif`. But:

1. All motifs come from `generateMotif()` with random seeds — statistically identical material.
2. The reward formula is `coherence*0.3 + densityFit*0.25 + 0.25 + novelty*0.2` — always ~0.55-0.75 regardless of output.
3. `pickMotif` scores by reward × 0.4 + recency + novelty + usage. With rewards all ~0.6, the selection is effectively random.
4. Even if a "better" motif is picked, it's from the same generator — same scale, same register, same density.

**Learning cannot produce materially different music.** A/B testing learning ON vs OFF would yield statistically similar outputs. The reward signal is too weak and the motif pool too homogeneous.

---

## 9. RADIO ADAPTATION LIE

F14 revived the radio follower (markConnected). But what does the engine DO with radio data?

| Radio input | What the engine does | Musical effect |
|-------------|---------------------|----------------|
| Beat observation | transport.observeBeat() → PLL locks → BPM follows | Tempo sync ✅ |
| Occupancy (kick/bass/lead/hats) | Duck gain on bus (kickDuck etc.) | Volume ducking ✅ |
| Spectral energy | ctx.energy (if not user-locked) | Lead density multiplier ⚠️ |
| Pitch (bassFreq) | ctx.rootPc (if not user-locked) | Key change ⚠️ |
| Style detection | session.style (if not user-locked) | Hat/bass count change ⚠️ |

**What it does NOT do:**
- Does not change the kick pattern when radio has a different groove
- Does not change the bassline when radio has a bass melody
- Does not harmonize with radio key (just copies it)
- Does not complement radio energy (just ducks)
- Does not call-and-respond with radio phrases

**The engine hears the radio but doesn't play WITH it.** It just gets quieter when the radio is loud.

---

## 10. UI FAILURE — DASHBOARD, NOT INSTRUMENT

The current UI (`page.tsx`, 446 lines) is a vertical stack of cards:
1. Transport (Play/Stop + Master VOL + visualizer)
2. Music Director (Style buttons + Energy/Density/Tension sliders with locks)
3. Radio (Station select + Connect + Vol + band meters)
4. Mix (4 vertical channel strips with vol/mute/solo)
5. FX (Delay/Feedback/Reverb sliders)
6. Footer (status line)

**Why this is a dashboard, not an instrument:**
- No timeline. The user can't see where they are in the 64-bar arc.
- No arrangement view. The user can't see sections, phrases, or upcoming transitions.
- No intent display. The user can't see what the engine plans to do next.
- No performance macros. Just per-parameter sliders.
- No real-time musical feedback beyond a spectrum visualizer.
- No scene recall / arrangement triggers.
- The user is tuning parameters, not directing music.

**A musical instrument would show:**
- Current section + phrase + bar position (timeline)
- Energy/tension/density as live curves
- Active roles (which voices are playing)
- Current motif + its development state
- Next transition + ability to trigger it
- Arrangement controls (force section, trigger break/build/drop)
- Macro controls (ENERGY, DRIVE, TENSION, SPACE) that map to multiple parameters

---

## 11. DEAD CODE / FAKE CONTROLS / DUPLICATES

### Dead code (from F13 audit, still accurate)
- `src/lib/studio/engine/` — 34,185 lines, 83% dead, 17% API-only. Not in live runtime.
- `src/lib/soundBank.ts` — 142 presets, not imported by psyLive.
- `src/lib/pooledEngine.ts` — not imported by psyLive.
- `src/lib/patternMutator.ts` — not imported by psyLive.
- `src/lib/radioStateGate.ts` — superseded by RadioObservationLayer.

### Fake controls (exist but don't shape music meaningfully)
- **Energy slider** — sets ctx.energy, but ctx.energy only affects lead density (which is 0 during INTRO) and densityFit bookkeeping. Moving it during INTRO changes nothing audible.
- **Density slider** — sets ctx.density, but ctx.density only affects phrase reward bookkeeping (never read by generators). Moving it changes nothing audible.
- **Tension slider** — sets ctx.tension, affects lead density and hat velocity. This one works, but it's the only musical control that does.
- **Style buttons** — change hat/bass count, not musical identity (see §7).

### Duplicate decisions
- Style: `session.style` (detectStyle) vs `psyLive.currentStyle` (classifyStyle) vs `psyLive.musicState.style`. Three variables, F14 added userStyleLocked but classifyStyle still runs in parallel.
- Energy: `ctx.energy` vs `psyLive.musicState.energy` — two independent values from two separate histories.
- Occupancy: 4 copies (RadioObservationLayer, psyLive.occupancy, psyLive.musicState.radioRoles, MusicalContext.radioRoles).

---

## 12. MUSICAL QUALITY FAILURES (root causes)

| # | Failure | Root cause | Impact |
|---|---------|-----------|--------|
| 1 | **No lead for 8 bars** | calculateLeadDensity returns 0 for INTRO | Music is empty groove for 33 seconds |
| 2 | **Bass never moves** | generateBass hardcodes root on 8 steps | No harmonic development |
| 3 | **Kick identical 7/8 bars** | generateKick hardcodes [0,4,8,12] | Loop, not composition |
| 4 | **No velocity humanization** | 2 fixed velocity values | Machine-gun effect |
| 5 | **No density build** | Arc only changes lead density | Flat arrangement |
| 6 | **Demo-quality kick** | Single sine, no sub, no saturation | Weak, thin |
| 7 | **Demo-quality bass** | Single saw, plucky env, no distortion | Not rolling/sustained |
| 8 | **Demo-quality lead** | 2 osc, 240ms decay, no unison | Stabs, not melody |
| 9 | **Demo-quality hats** | White noise, 50ms, no swing | Cheap, mechanical |
| 10 | **No master EQ/stereo** | Comp + limiter only | Unbalanced, narrow |
| 11 | **Styles are density presets** | Only hat/bass count changes | No musical identity |
| 12 | **Learning is homogeneous** | All motifs from same generator | No material difference |
| 13 | **Radio doesn't change music** | Only ducking + style label | No musical complement |
| 14 | **UI is a dashboard** | Sliders, no timeline/arrangement | Not a performance tool |

---

## 13. UX FAILURES

1. **No musical context visible** — user can't see section, phrase, bar position, or what's coming next.
2. **No arrangement controls** — user can't trigger a break, force a build, or extend a section.
3. **No performance macros** — 15 individual sliders instead of 5-7 musical macros (ENERGY, DRIVE, TENSION, SPACE, etc.).
4. **No real-time intent** — user can't see what the engine plans to do.
5. **No mixer grouping** — flat 4 channels, no group buses (DRUMS, LOW END, MUSIC, FX, RADIO).
6. **No FX macros** — raw delay/reverb sliders instead of musical controls (SPACE, ECHO, WIDTH, DRIVE, MOVEMENT).
7. **No scene recall** — can't save/recall a musical state.
8. **Debug surface still exposed** — `getTransportDebug()` returns 20+ internal fields (used by tests, but the API exists).

---

## 14. EXACT REBUILD PLAN

### Phase 1: SYNTHESIS REBUILD (P0 — fixes the sound)
Rewrite all 4 voices in psyLive.ts to produce professional-quality audio:
- **Kick**: sub sine (50Hz sustain) + body sine (pitch env) + transient click + saturation (waveshaper)
- **Bass**: sub sine + mid saw → LPF → saturation. Rolling envelope (sustain between notes). Filter env per note.
- **Lead**: 3-5 voice unison (detuned) → LPF (per-note env) → stereo widen. Longer sustain. Glide between notes.
- **Hats**: metallic noise (ring mod) → HPF → bandpass. Open/closed variation. Swing.
- **Master**: add EQ (low shelf, mid bell, high shelf) + stereo imager + multiband-style glue.

### Phase 2: COMPOSITION REBUILD (P0 — fixes the music)
Rewrite MusicalSession generators to produce musical development:
- **Kick**: ghost notes, accents on beat 1, fills with velocity variation, style-specific grammar
- **Bass**: harmonic movement (root, fifth, octave, walking), style-specific articulation, per-note filter env
- **Lead**: longer motifs (4-8 bars), call-and-response, development (transpose/invert/extend), register movement
- **Hats**: swing, open/closed, velocity humanization, style-specific groove
- **Velocity**: humanize all voices (±5-10% jitter, accent patterns)
- **Arrangement arc**: each section changes MULTIPLE parameters (not just lead density) — drop elements during breaks, add layers during builds, open filters during climax

### Phase 3: STYLE GRAMMAR (P1 — makes styles real)
Each style gets a complete musical identity:
- **FULL_ON**: 4-on-floor, rolling 16th bass, busy hats, peak-time lead, bright
- **DARK**: half-time feel, sparse bass, minor/modal harmony, eerie lead, dark filters
- **PROGRESSIVE**: building groove, smooth bass, steady hats, gradual lead entrance, clean
- **ACID**: 303-style squelchy bass, syncopated hats, resonant filter lead, hypnotic

### Phase 4: ARRANGEMENT CONTROLS (P1 — makes it directable)
Add to MusicalSession:
- `forceSection(name)` — jump to a section
- `triggerBreak()` — drop to kick+bass only for N bars
- `triggerBuild()` — ramp density over N bars
- `triggerDrop()` — peak density for N bars
- `extendSection(bars)` — hold current section longer
- `freezeMotif()` — keep current motif for N bars
- `evolveMotif()` — force a transform

### Phase 5: UI REBUILD AS INSTRUMENT (P1 — makes it usable)
Replace page.tsx with a performance-oriented interface:
- **Timeline bar**: current section + phrase + bar position + upcoming transition
- **Performance macros**: ENERGY, DRIVE, TENSION, SPACE, DENSITY (each maps to multiple params)
- **Arrangement panel**: section display + trigger buttons (BREAK, BUILD, DROP, RETURN)
- **Mixer with groups**: DRUMS (kick+hats), LOW END (bass), MUSIC (lead), RADIO, MASTER
- **FX macros**: SPACE (reverb mix + width), ECHO (delay time + feedback + mix), DRIVE (saturation amount)
- **Live state display**: current motif, active roles, radio relationship

### Phase 6: TESTS (P2 — prove the change)
- Audio render test: measure low/mid/high energy, dynamics, stereo width
- Composition test: verify bass movement, lead development, kick variation, velocity humanization
- Style test: verify 4 styles produce measurably different audio (not just note counts)
- Long-form test: 5 minutes × 4 styles, verify no collapse/repetition
