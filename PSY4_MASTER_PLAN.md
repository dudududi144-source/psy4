# PSY4 — Product Master Plan

**Date:** 2026-08-19
**Based on:** Full audit of 13 psy-family repositories + current codebase
**Goal:** Define what we're building, why, and how to get there

---

## 1. THE PRODUCT

### What it IS
PSY4 is a **generative psytrance studio** — an instrument that creates
infinite, evolving electronic music at commercial quality. It's not a DAW,
not a plugin, not a toy. It's a **self-improving music engine** that:

1. **Generates** complete psytrance tracks (kick, bass, lead, acid, pad, hats, percussion)
2. **Learns** what sounds good by analyzing its own output
3. **Evolves** over time — the music changes, the sound improves, the compositions grow
4. **Imitates** reference tracks (from radio or user uploads)
5. **Exports** MIDI + WAV for use in external DAWs

### What value it delivers
- **For producers:** infinite inspiration — never get stuck in writer's block
- **For listeners:** a psytrance radio station that never repeats and always improves
- **For learners:** see how CC parameters affect sound in real-time

### What "commercial quality" means concretely
| Metric | Target | Current | Gap |
|--------|--------|---------|-----|
| LUFS | -8 to -12 (club/streaming) | -9 to -13 | OK |
| Frequency spectrum | Full-range, no harsh peaks | Has harsh noise floor | FIX |
| Lead sound | Warm, flowing, harmonic | Was static + harsh | FIXED (partially) |
| Bass sound | Rolling, sub-heavy, locked with kick | OK | OK |
| Drum sound | Layered, punchy, professional | Primitive single-layer | FIX |
| Composition | Evolving, not repeating | Deterministic per-seed | FIX |
| Learning | Actually improves sound quality | Only optimizes loudness | REBUILD |
| Imitation | Can copy reference tracks | Not implemented | BUILD |

---

## 2. THE FAMILY (what we have)

### Repositories available:
| Repo | Purpose | Reusable? |
|------|---------|-----------|
| psy-foundation | Shared contracts (13 packages, 250 tests) | YES — vendor it |
| psysynth | Melodic synth device (124 tests, 21 patches) | Already in PSY4 |
| psy-sampler | Sample-based drum device (653 tests) | YES — wire as 3rd device |
| psydrum | Dedicated drum synth (BUILDING phase 11) | YES — when ready |
| PsySynthPro | Real DSP: PolyBLEP + wavetable + ZDF SVF + FM | YES — lift engine |
| PSY3 | Production knowledge (pro_dsp.py Moog, BL-saw) | YES — reference |
| PSY6-ULTIMATE | Grammar system (BassGrammar, MelodicGrammar) | YES — adaptive brain |
| psystar | Full platform vision (59 phases) | LONG-TERM |
| psy5 | Pooled engine pattern | Reference |

### Key code patterns available:
- **Real Moog ladder** (PSY3 pro_dsp.py) — 4-stage tanh, sample-accurate
- **PolyBLEP oscillators** (PsySynthPro) — no aliasing
- **ZDF SVF filter** (PsySynthPro) — stable at all frequencies
- **CausalComposer** (psy-foundation) — musical memory + intent-driven actions
- **Grammar System** (PSY6) — 12×12 bass transition matrix, melodic histograms
- **ReferenceAnalyzer** (current codebase, dead) — spectral analysis
- **VoicePool** (foundation shim) — pre-allocated, zero-GC voice management

---

## 3. THE LEARNING SYSTEM (rebuild)

### Current state (BROKEN):
The CCLearner only measures peak dB + spectral centroid. It can't tell
if the music sounds good — only if it's loud enough. This is useless.

### What learning SHOULD do:
1. **Analyze** the audio output (spectrum, dynamics, stereo, transients)
2. **Compare** against a target (reference track or commercial standard)
3. **Identify** what's wrong (too harsh? too muddy? no bass? thin lead?)
4. **Adjust** parameters to fix the identified problems
5. **Remember** what worked (persist to localStorage across sessions)

### Concrete learning loop:
```
for each 8-second trial:
  1. Set CC params (cutoff, res, drive, glide, delay, reverb)
  2. Play for 8 seconds
  3. Measure:
     - spectral balance (low/mid/high ratio)
     - dynamic range (crest factor)
     - transient clarity (onset detection)
     - harmonic richness (THD + spectral entropy)
     - stereo width
     - loudness (LUFS)
  4. Compare to target:
     - if too harsh → reduce drive/cutoff/res
     - if too muddy → increase cutoff, reduce reverb
     - if too thin → increase sub gain, add harmonics
     - if too quiet → increase volume (but not past limiter)
     - if too compressed → reduce compressor ratio
  5. Pick next params (epsilon-greedy with decay)
  6. Save best params to localStorage
```

### What "sounding good" means (measurable):
| Quality | Metric | Target |
|---------|--------|--------|
| Warmth | low/mid ratio (0-200Hz : 200-2kHz) | 1.0-1.5 |
| Brightness | spectral centroid | 1500-3000Hz |
| Punch | crest factor (peak/rms) | 6-12dB |
| Clarity | spectral flatness | 0.1-0.3 (not noise, not pure tone) |
| Width | stereo correlation | 0.3-0.7 (not mono, not phasey) |
| Loudness | LUFS | -8 to -12 |
| Smoothness | THD | 2-8% (harmonic, not harsh) |

---

## 4. THE SOUND (what needs to change)

### Lead (currently: still not good enough)
- Use REAL Moog ladder (not BiquadFilter cascade)
- Add PolyBLEP oscillators (not PeriodicWave — aliases at high pitches)
- Multi-layer: fundamental + octave + sub + air/noise
- Filter LFO at 0.1-0.5Hz (slow, flowing — was 2.5Hz = jittery)
- Envelope: 8ms attack, 500ms decay, 0.7 sustain, 300ms release (legato)
- Glide: 60ms between notes (smooth transitions)

### Bass (currently: OK but could be better)
- Add sub-bass layer (sine one octave below, longer decay)
- Sidechain: 6dB duck on kick (already implemented)
- HP at 40Hz (prevent subsonic mud)

### Drums (currently: primitive)
- Kick: 3-layer (sub + fundamental + click) — already implemented
- Hat: needs bandpass (not just HP) + shorter decay
- Snare: needs noise + tone + body (currently just noise)
- Clap: needs multi-burst envelope (already implemented)
- CONSIDER: wire psy-sampler.js for sample-based drums as alternative

### Master chain (currently: works but could be better)
- 3-band compression: already implemented (real DynamicsCompressorNode per band)
- Add glue compressor: gentle 2:1 at -20dB
- Add saturation: tanh waveshaper at low drive
- Limiter: -0.3dB ceiling (already implemented)

---

## 5. THE COMPOSITION (what needs to change)

### Current state:
- Deterministic per-seed (same seed = same output)
- Lead now follows bass harmony (fixed in this session)
- 64-bar arrangement with 6 sections (INTRO/GROOVE/DROP/BREAKDOWN/REBUILD/OUTRO)
- No musical memory (doesn't remember what it played)
- No intent (doesn't decide "now I should add a counter-melody")

### What it should be:
- **CausalComposer** from psy-foundation — has musical memory + intent
- Material lifecycle: introduce → establish → vary → exhaust → recall
- Intent-driven actions: INTRODUCE_HATS, VARY_MOTIF, BREAKDOWN, CALLBACK
- Grammar system from PSY6: BassGrammar (12×12 transition matrix), MelodicGrammar
- Adaptive: the composer changes based on what the learning system discovers

### How to get there:
1. Vendor psy-foundation repo (65MB, 13 packages)
2. Port CausalComposer + MusicalMemoryStore + InferenceEngine
3. Port PSY6 Grammar System (BassGrammar, MelodicGrammar, RhythmGrammar)
4. Wire learning output → composer intent (if learning says "lead too harsh",
   composer reduces lead velocity or changes motif intervals)

---

## 6. THE IMITATION (new capability)

### What it should do:
1. User uploads a reference track (or selects radio stream)
2. Engine analyzes it:
   - BPM detection (already have beatPLL)
   - Key detection (already have scale detection)
   - Spectral profile (what frequencies are present)
   - Drum pattern extraction (onset analysis)
   - Bass pattern extraction (pitch tracking)
3. Engine generates music that matches:
   - Same BPM, key, scale
   - Similar spectral balance
   - Similar drum pattern
   - Similar bass movement

### How to get there:
- ReferenceAnalyzer (exists in codebase, dead code) — port to runtime
- AudioFeatureExtractor (exists in tests) — port to runtime
- OnsetAnalyzer (exists, dead) — port for drum pattern extraction
- StyleClassifier (exists, dead) — port for genre detection

---

## 7. PHASED PLAN

### Phase 0: Fix the sound (1-2 days)
- [ ] Replace psysynth BiquadFilter with real Moog ladder
- [ ] Add PolyBLEP oscillators to melodic voices
- [ ] Improve drum synthesis (bandpass hats, tonal snares)
- [ ] Fix learning reward to measure real audio quality (not just loudness)

### Phase 1: Wire the family (1 week)
- [ ] Vendor psy-foundation contracts (restore CausalComposer)
- [ ] Wire psy-sampler.js as 3rd device (sample-based drums)
- [ ] Port ReferenceAnalyzer + AudioFeatureExtractor to runtime
- [ ] Port PSY3 production knowledge (Moog, BL-saw, EvolvingSequence)

### Phase 2: Build the brain (2-4 weeks)
- [ ] Implement CausalComposer with musical memory + intent
- [ ] Port PSY6 Grammar System (BassGrammar, MelodicGrammar)
- [ ] Wire learning → composer (if harsh → reduce lead presence)
- [ ] Implement imitation mode (analyze reference → match)

### Phase 3: Commercial polish (1-2 months)
- [ ] Lift PsySynthPro DSP (PolyBLEP + wavetable + ZDF SVF + FM)
- [ ] Wire psydrum as drum worklet replacement
- [ ] Add real-time spectral visualizer with frequency labels
- [ ] Add song mode ( verse / chorus / bridge / drop structure)
- [ ] Add export to DAW (stems, not just MIDI)

### Phase 4: Platform (3-6 months)
- [ ] Lift psystar bidirectional MIDI (play PSY4 from external keyboard)
- [ ] P2P sync (collaborative sessions)
- [ ] Mobile app (responsive UI already started)
- [ ] Cloud presets (share sound designs)

---

## 8. SUCCESS CRITERIA

### The product is ready when:
1. User presses Play → hears **good-sounding psytrance** within 5 seconds
2. The music **evolves** — not the same 4 bars repeating
3. The lead sounds **warm and musical** — not harsh or disconnected
4. The bass is **locked with the kick** — pumping sidechain
5. The drums sound **professional** — punchy, layered, not noise
6. The learning **actually improves** the sound over 10 minutes
7. The user can **imitate** a reference track
8. The user can **export** MIDI + WAV that sound good in a DAW
9. The UI looks **professional** — like a real instrument, not a demo
10. The engine **doesn't stop** — plays continuously for hours

### Current state vs target:
| Criterion | Status | Gap |
|-----------|--------|-----|
| 1. Good sound within 5s | PARTIAL | Lead still needs work |
| 2. Music evolves | NO | Deterministic per-seed |
| 3. Warm lead | PARTIAL | Fixed harmony, needs Moog |
| 4. Bass locked with kick | YES | Working |
| 5. Professional drums | NO | Primitive synthesis |
| 6. Learning improves sound | NO | Only measures loudness |
| 7. Imitate reference | NO | Not implemented |
| 8. Export MIDI + WAV | YES | Both work |
| 9. Professional UI | YES | VLM 8.5/10 |
| 10. Engine doesn't stop | YES | 3-min verified |

---

## 9. WHAT I NEED FROM YOU

1. **Priority** — which phase first? Fix sound? Build brain? Imitation?
2. **Reference tracks** — can you provide 1-3 psytrance tracks you like?
   I'll analyze them and build the spectral target from them.
3. **Patience** — this is a real product, not a demo. It takes time.
4. **Honesty** — tell me when something sounds bad. I can't hear it myself.
