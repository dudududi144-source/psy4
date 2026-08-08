# COMMERCIAL ROADMAP — PSY4

## תאריך: 2026-08-08
## מבוסס על: ARCHITECTURE_SIGNAL_FLOW.md + COMMERCIAL_AUDIO_AUDIT.md + BENCHMARK_REPORT.md

---

## CURRENT STATE

**Commercial Readiness: 25/100**

| Category | Score | Blocker |
|----------|-------|---------|
| Engine Health | 80 | setInterval(25ms) — P0 architecture risk |
| DSP Primitives | 30 | Two disconnected engines, no modulation matrix |
| Instruments | 25 | All voices are osc→filter→gain, no identity |
| Music | 35 | 4-note motif, random acid, no phrase planning |
| Production | 20 | No channel gains, no multiband, no true-peak in live |
| Reference | 0 | Not implemented |

---

## P0 — ARCHITECTURE BLOCKERS (must fix first)

### P0.1: Unify voice parameters (Single Source of Truth)
- **What:** Create `src/lib/studio/engine/voiceSpecs.ts` — shared voice parameters
- **Why:** Live and offline engines have completely different params for same voices
- **How:** Define VoiceSpec interface, use in both engines
- **Complexity:** Medium — refactor both engines to read from shared specs
- **Dependency:** None

### P0.2: Add channel gains to live engine
- **What:** Add GainNode per voice with dB values
- **Why:** All voices connect directly to sum — no gain staging, no hierarchy
- **How:** Create channel gain nodes in init(), route each voice through its channel
- **Complexity:** Low — add nodes + routing
- **Dependency:** P0.1 (use shared gain values)

### P0.3: Add HP filter per channel in live engine
- **What:** BiquadFilter HP per voice (80-120Hz for non-bass)
- **Why:** No frequency separation — bass and lead overlap in low-mid
- **How:** Add HP filter in each voice's channel chain
- **Complexity:** Low
- **Dependency:** P0.2

### P0.4: Replace live master chain
- **What:** Replace DynamicsCompressor+EQ with proper master chain
- **Why:** No glue, no true-peak, no LUFS targeting
- **How:** Use native Web Audio: multiband split → comp per band → glue → saturation → limiter
- **Complexity:** Medium
- **Dependency:** P0.2

### P0.5: Migrate to AudioWorklet
- **What:** Move scheduling + timing to AudioWorklet
- **Why:** setInterval(25ms) is main-thread, vulnerable to GC/UI interference
- **How:** Port PSY3's worklet.js pattern — AudioWorkletProcessor with message port
- **Complexity:** High — significant architecture change
- **Dependency:** P0.1-P0.4 (stabilize params first)

---

## P1 — SOUND ENGINE BLOCKERS

### P1.1: Add modulation matrix
- **What:** Routable source→amount→destination system
- **Why:** All modulation is hardcoded. Can't route LFO→FM, env→pitch, vel→resonance
- **How:** ModulationMatrix class with sources (LFO, env, vel, macro, random) and destinations
- **Complexity:** Medium-High
- **Dependency:** P0.1

### P1.2: Add Moog-style filter to live engine
- **What:** Filter with tanh saturation in feedback loop
- **Why:** BiquadFilter is sterile. Moog ladder has character.
- **How:** WaveShaper inside filter feedback, or use native BiquadFilter + WaveShaper post
- **Complexity:** Medium
- **Dependency:** P0.2

### P1.3: Port phaser from PSY3
- **What:** 4-stage allpass phaser (pro_fx.py)
- **Why:** Essential for psychedelic movement, completely missing
- **How:** Implement using BiquadFilter allpass chain + LFO
- **Complexity:** Low-Medium
- **Dependency:** P0.4

### P1.4: Port shimmer from PSY3
- **What:** Pitch-shifted reverb tail (pro_fx.py)
- **Why:** Key psychedelic effect, completely missing
- **How:** ConvolverNode + playback rate modulation for pitch shift
- **Complexity:** Medium
- **Dependency:** P0.4

### P1.5: Add per-hit variation
- **What:** Pitch/decay/tone micro-variation per drum hit
- **Why:** Every kick/clap/hat sounds identical — machine-like
- **How:** Deterministic per-hit parameter variation from rng
- **Complexity:** Low
- **Dependency:** P0.1

### P1.6: Add multiband compression
- **What:** 3-band (low/mid/high) independent compression
- **Why:** Single-band comp can't control low-end independently
- **How:** Port from PSY3 style_master.py — 3 BiquadFilter splits + 3 DynamicsCompressors
- **Complexity:** Medium
- **Dependency:** P0.4

---

## P2 — MUSICAL INTELLIGENCE

### P2.1: Expand motif system
- **What:** 8-16 note motifs with AABA + development + return
- **Why:** 4-note motif is primitive, no musical identity
- **Complexity:** Medium
- **Dependency:** None

### P2.2: Add acid pattern identity
- **What:** Stored acid pattern with mutation, not random pitches
- **Why:** Random acid = random blips, not a musical line
- **Complexity:** Low-Medium
- **Dependency:** P2.1

### P2.3: Add counter-melody
- **What:** Second motif that responds to lead
- **Why:** Single melodic voice = thin arrangement
- **Complexity:** Medium
- **Dependency:** P2.1

### P2.4: Add phrase-level planning
- **What:** 4/8/16-bar musical plans with tension/release
- **Why:** Step-by-step decisions = no musical narrative
- **Complexity:** High
- **Dependency:** P2.1-P2.3

---

## P3 — REFERENCE ANALYSIS

### P3.1: Port reference analysis from PSY3
- **What:** BPM estimation, key estimation, spectral analysis, structure detection
- **Why:** Core differentiator — can't learn from references without it
- **How:** Port style_clone.py to TypeScript
- **Complexity:** Medium-High
- **Dependency:** None

### P3.2: Build learning loop
- **What:** render→analyze→compare→mutate→re-render
- **Why:** Autonomous quality improvement toward reference target
- **How:** Port learner.py self_train to TypeScript
- **Complexity:** High
- **Dependency:** P3.1

### P3.3: YouTube reference input
- **What:** URL → audio → analysis → ReferenceProfile → generation
- **Why:** User-facing feature — "make something inspired by this"
- **How:** Backend audio extraction + analysis pipeline
- **Complexity:** High (external dependencies)
- **Dependency:** P3.1, P3.2

---

## WHAT CAN BE BORROWED DIRECTLY FROM PSY3

| PSY3 File | What | How | Priority |
|-----------|------|-----|----------|
| `worklet.js` | AudioWorklet pattern | Port to TS, adapt scheduling | P0.5 |
| `pro_fx.py: phaser()` | 4-stage allpass phaser | Rewrite with BiquadFilter allpass | P1.3 |
| `pro_fx.py: shimmer()` | Pitch-shifted reverb | ConvolverNode + rate modulation | P1.4 |
| `style_master.py: multiband_comp()` | 3-band compression | 3 BiquadFilter splits + 3 comp | P1.6 |
| `style_master.py: truepeak()` | True-peak measurement | 2x interpolation | P0.4 |
| `style_master.py: to_stereo()` | Stereo widening | Delayed decorrelated side | P1.2 |
| `style_clone.py: bpm_est()` | BPM estimation | Onset autocorrelation | P3.1 |
| `style_clone.py: key_est()` | Key estimation | Chroma profile matching | P3.1 |
| `learner.py: self_train()` | Learning loop | render→measure→converge | P3.2 |
| `engine.py: pad(evolve)` | Pad evolution | LFO detune modulation | Already adopted |
| `engine.py: zap()` | FM ear candy | Carrier+modulator | Already adopted |

## WHAT PSY4 SHOULD BUILD BEYOND PSY3

1. **Reference-guided generation** — analyze → TargetStyleProfile → generate → compare → optimize
2. **YouTube input** — URL → audio → analysis → original generation
3. **Learning loop** — iterative quality convergence toward reference
4. **Modulation matrix** — routable LFO/env/macro → destinations
5. **Voice identity system** — parameterized sound families from (world, role, seed)
6. **Phrase-level musical director** — 4/8/16-bar planning with tension/release
7. **Live performance** — PSY3 is offline-only, PSY4 has real-time Web Audio
8. **Macro control** — PSY3 has no live macros, PSY4 has 10 instant macros
9. **World system** — PSY3 has 5 basic styles, PSY4 has 8 detailed worlds
10. **Quality gate** — PSY3 has basic tests, PSY4 has multi-category gate
