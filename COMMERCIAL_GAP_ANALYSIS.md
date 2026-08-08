# PSY4 COMMERCIAL GAP ANALYSIS

## תאריך: 2026-08-08
## מבוסס על: קריאת קוד מעמיקה של PSY4 (psy4LiveEngine.ts) + PSY3 (engine.py, pro_dsp.py, pro_fx.py, style_master.py, style_clone.py, learner.py, worklet.js, rt_engine.js)

---

## 1. CURRENT ARCHITECTURE — PSY4

**Live Engine:** `psy4LiveEngine.ts` — browser-native Web Audio, 25ms setInterval scheduler, ~1027 שורות.
- 8 worlds עם פרמטרים (BPM, scale, root, bass style, kick/bass/lead/pad cutoff, texture type)
- Voices: kick, bass, lead, acid, hat, shaker, clap, perc, pad, texture, riser, impact, sweep, zap, blip, downlifter
- Master chain: sum → duck → comp → limiter → EQ → master → destination
- FX: ping-pong delay, convolver reverb (generated impulse)
- Section cycle: intro → build → drop → break → drop → climax
- Macros: energy, psychedelia, darkness, density, groove, evolution, space, surprise, aggression, brightness

## 2. PSY3 ARCHITECTURE

**Python offline engine:** `engine.py` — numpy DSP, 44100Hz, offline render.
- Voices: kick, bass, lead, pad, hat, clap, riser, impact, zap, blip, downlifter, perc
- DSP: `bl_saw` (additive band-limited), `moog` (4-stage ladder with tanh), `pink_noise`
- FX: `pro_fx.py` — phaser (4-stage allpass), shimmer (pitch-shifted reverb), bitcrush, limiter
- Master: `style_master.py` — multiband comp (3-band), glue comp, saturation, true-peak, stereo widening, LUFS targeting
- Reference: `style_clone.py` — BPM est (onset autocorrelation), key est (chroma profile), spectral bands, structure detection
- Learning: `learner.py` — render → measure distance → converge band gains + LUFS
- Web: `rt_engine.js` — browser Web Audio mirror, `worklet.js` — AudioWorklet sample-accurate synth
- Samples: `fetch_free_samples.py` — CC0 samples from archive.org, `sample_engine.js` — sample playback

## 3. PSY3 → PSY4 COMPARISON

| Area | PSY3 | PSY4 | Winner | Why | Action |
|------|------|------|--------|-----|--------|
| **Scheduler** | setInterval(25ms) | setInterval(25ms) | Tie | Both main-thread | P0: AudioWorklet |
| **AudioWorklet** | Yes (worklet.js) | No | PSY3 | Sample-accurate, no GC interference | ADOPT |
| **Kick** | sine+triangle mid+noise click | sine+triangle mid+square click | PSY4 | Square click punchier, mid layer added | Keep PSY4 |
| **Bass** | saw+sub, moog filter for acid | saw+sub, biquad LP, waveshaper sat | PSY4 | Saturation + resonance control better | Keep PSY4 |
| **Lead** | 5 detuned saws, 14¢ spacing | 5 detuned, LFO filter mod | PSY4 | LFO modulation adds movement | Keep PSY4 |
| **Pad** | sine+harmonic, evolve param | saw pair, static | PSY3 | Evolve param = breathing pads | ADOPT evolve |
| **Hat** | noise→HP | noise→HP | Tie | Both basic | P1: metallic osc bank |
| **Clap** | single noise burst | single noise burst | Tie | Both lack multi-hit | P1: multi-burst |
| **FX: Phaser** | 4-stage allpass | None | PSY3 | Essential for psychedelic movement | ADOPT |
| **FX: Shimmer** | Pitch-shifted reverb tail | None | PSY3 | Key psychedelic effect | ADOPT |
| **Master** | Multiband comp + glue + sat + true-peak + LUFS target | Single-band comp + limiter + EQ | PSY3 | Far more professional | ADOPT |
| **Stereo** | to_stereo (delayed decorrelated HP side) | Per-voice StereoPanner | PSY4 | More natural stereo sources | Keep PSY4 |
| **Reference analysis** | BPM, key, spectral, structure | None | PSY3 | Critical differentiator | ADOPT + improve |
| **Learning loop** | render→measure→converge | None | PSY3 | Autonomous quality improvement | ADOPT |
| **Samples** | CC0 samples from archive.org | None | PSY3 | Real drums sound better | ADOPT |
| **Musical grammar** | bar%3 bass, fixed lead positions | Walking bass cycle, motif AABA | PSY4 | More musical | Keep PSY4 |
| **Worlds** | 5 styles (basic params) | 8 worlds (detailed params) | PSY4 | More identity | Keep PSY4 |
| **Ear candy** | zap, blip, downlifter (random) | zap, blip, downlifter (macro-controlled) | PSY4 | Macro integration | Keep PSY4 |

## 4. TOP 30 PROBLEMS (Why PSY4 sounds amateur)

### Architectural Limitations (10)

**A1. Main-thread scheduler (P0)**
- Where: `setInterval(() => this.tick(), 25)` in psy4LiveEngine.ts
- Why amateur: GC pauses, UI updates, React re-renders can interrupt timing → jitter, dropped notes, glitches
- Commercial solution: AudioWorklet — audio thread, sample-accurate, immune to main-thread interference
- What to build: Port PSY3's worklet.js pattern, move scheduling + note triggering to AudioWorklet

**A2. No modulation matrix (P0)**
- Where: All voices use hardcoded parameter connections (e.g., `fl.Q.value = 1 + this.macros.psychedelia * 4`)
- Why amateur: Can't route LFO→FM, envelope→pitch, velocity→resonance, macro→distortion independently
- Commercial solution: Source→Amount→Destination routing matrix
- What to build: ModulationMatrix class with routable sources (LFO, env, macro, random) and destinations (cutoff, res, FM, pitch, pan, drive, delay, reverb)

**A3. No voice identity/preset system (P1)**
- Where: Each voice is a hardcoded function (kick(), bass(), lead(), etc.)
- Why amateur: Can't generate multiple kick/bass/lead identities. Every kick sounds the same.
- Commercial solution: SoundSource class with parameterized architecture (osc type, filter type, env shapes, modulation, FX, stereo)
- What to build: VoiceFactory that generates distinct sound identities from (world, role, seed)

**A4. No multiband processing (P1)**
- Where: Master chain is single-band comp → limiter → EQ
- Why amateur: Can't independently control low/mid/high dynamics. Low end gets muddy, highs get harsh.
- Commercial solution: 3-band split → independent comp per band → recombine
- What to build: Port PSY3's `multiband_comp` from style_master.py

**A5. No reference analysis (P1)**
- Where: No reference analysis code exists in PSY4
- Why amateur: Can't learn from commercial references. Can't measure distance to target.
- Commercial solution: Audio analysis pipeline (BPM, key, spectral, structure, rhythm)
- What to build: Port PSY3's style_clone.py + learner.py to TypeScript/Web Audio

**A6. No learning/optimization loop (P1)**
- Where: No iterative quality improvement exists
- Why amateur: System generates blindly, can't converge toward a target
- Commercial solution: render→analyze→compare→mutate→re-render
- What to build: Port PSY3's self_train from learner.py

**A7. No sample support (P2)**
- Where: All drums are synthesized (noise→HP for hats, sine→env for kick)
- Why amateur: Synthesized drums lack the detail, character, and "room sound" of real samples
- Commercial solution: Load CC0 sample library, use samples for kick/snare/clap/hat when available
- What to build: Port PSY3's sample_engine.js + fetch_free_samples.py

**A8. No AudioWorklet synthesis (P2)**
- Where: All synthesis uses createOscillator/createBufferSource on main thread
- Why amateur: Node creation overhead, potential GC spikes, limited voice count
- Commercial solution: AudioWorklet processor with wavetable lookup (like PSY3's worklet.js)
- What to build: Port worklet.js pattern — single processor, wavetable, one-pole filter per voice

**A9. No per-voice variation (P1)**
- Where: `kick()` always creates the same nodes with same params (except amp)
- Why amateur: Every kick hit sounds identical. Real drums have micro-variation.
- Commercial solution: Per-hit parameter variation (pitch, decay, tone, velocity→brightness)
- What to build: Add deterministic per-hit variation in each voice function

**A10. No phrase-level musical director (P1)**
- Where: step() makes per-step decisions. No phrase-level planning.
- Why amateur: Can't plan "build tension for 4 bars, then release". Just reacts step-by-step.
- Commercial solution: Phrase planner that generates 4/8/16-bar musical plans
- What to build: PhrasePlan class with tension/density/motif/intro/remove decisions

### Sound-Design Limitations (10)

**S1. Hats are noise→HP only (P1)**
- Where: `hat()` — `s.buffer = this.pink; hp.type = 'highpass'`
- Why amateur: No metallic character. Real hats have ring/modulation. All hats sound identical.
- Commercial solution: Metallic oscillator bank (inharmonic ratios) + noise blend
- What to build: Replace noise-only hats with PSY4's drumEngines HatEngine (already exists in DSP layer but not used in live engine)

**S2. Clap is single noise burst (P1)**
- Where: `clap()` — single bufferSource + bandpass + exponential decay
- Why amateur: Real claps have 3-4 staggered bursts. This sounds like a noise gate.
- Commercial solution: Multi-burst with 10-12ms offsets
- What to build: 3 noise bursts at t, t+10ms, t+20ms + 1 longer tail

**S3. Pad has no evolution (P1)**
- Where: `pad()` — static detune (±7 cents), static filter cutoff
- Why amateur: Pads sound like a held organ chord. No breathing, no movement.
- Commercial solution: Slow detune modulation (PSY3's `evolve` parameter: `1 + evolve * 0.002 * sin(2π * 0.1 * t + k)`)
- What to build: Add LFO to oscillator detune in pad voice

**S4. No FM synthesis in voices (P1)**
- Where: Only texture() uses FM. Lead, bass, acid, pad are all osc→filter→gain.
- Why amateur: FM creates complex timbral evolution that filters can't achieve. Essential for psychedelic sound.
- Commercial solution: FM oscillator option for lead/acid/texture voices
- What to build: FM voice variant (carrier + modulator + index envelope)

**S5. No ring modulation (P2)**
- Where: Not implemented anywhere
- Why amateur: Ring mod creates metallic/alien timbres essential for psychedelic character
- Commercial solution: Ring mod voice option
- What to build: Ring mod voice (carrier × modulator)

**S6. No comb filter / feedback textures (P2)**
- Where: Not implemented
- Why amateur: Comb filtering creates resonant drones and feedback textures
- Commercial solution: Comb filter with adjustable delay + feedback
- What to build: CombFilter voice for texture layer

**S7. Bass has no mid-range presence (P1)**
- Where: `bass()` — sub at f/2, saw through LP at world.bassCutoff (300-600Hz)
- Why amateur: On laptop/phone speakers, sub is inaudible. Bass disappears.
- Commercial solution: Add mid-range harmonic layer at 200-800Hz with controlled saturation
- What to build: Third oscillator layer in bass (square at fundamental, through BP at 400Hz, low level)

**S8. Lead has no articulation (P1)**
- Where: `lead()` — 5 oscs → filter → gain with linear attack/release
- Why amateur: No vibrato, no portamento, no velocity→brightness, no accent. Sounds like a held chord.
- Commercial solution: Vibrato LFO, velocity→cutoff mapping, accent envelope, portamento between notes
- What to build: Add these articulations to lead voice

**S9. No distortion variety (P2)**
- Where: Only tanh waveshaper (in bass and acid)
- Why amateur: Different distortion types create different characters. Tanh is soft. Hard clip, foldback, asymmetric create different tones.
- Commercial solution: Multiple waveshaper curves selectable per voice
- What to build: WaveshaperCurve library (tanh, hardclip, foldback, asymmetric)

**S10. No stereo delay throws (P1)**
- Where: Delay is a global send (ping-pong), no per-voice delay throws
- Why amateur: Real psytrance has tempo-synced delay throws on lead/acid notes — specific notes echo
- Commercial solution: Per-note delay send with tempo-synced delay time
- What to build: Optional delay throw parameter in lead/acid voices

### Musical-Writing Limitations (10)

**M1. Lead motif is only 4 notes (P1)**
- Where: `Motif` class — `this.notes` has 4 elements, `this.rhythm = [0, 4, 8, 10]`
- Why amateur: 4 notes cycling is not a melody. No development, no call/response, no variation.
- Commercial solution: 8-16 note motifs with AABA structure, call/response, rhythmic variation
- What to build: Expand Motif to 8-16 notes with phrase structure

**M2. Acid line is random pitch picker (P1)**
- Where: `step()` — `S.rng.pick([0, 0, 2, 4, 7, 0, -1])`
- Why amateur: No pattern memory. Each acid note is independent. Sounds like random blips.
- Commercial solution: Acid pattern with identity (repeatable, mutable, memorable)
- What to build: AcidPattern class with stored pattern + controlled mutation

**M3. No counter-melody (P1)**
- Where: Only one lead voice. No second melodic line.
- Why amateur: Real psytrance has lead + counter-lead or call/response
- Commercial solution: Second motif that responds to the first
- What to build: CounterMotif that plays after lead motif with delay

**M4. No dynamic density within sections (P1)**
- Where: `S.density` is set once per section and doesn't change within the section
- Why amateur: Sections feel flat. Real arrangements build/release within sections.
- Commercial solution: Density curve within each section (start sparse, build, peak, settle)
- What to build: Per-section density envelope

**M5. No bass note variation within phrases (P0)**
- Where: Bass cycle `[0, 0, 4, 0, 7, 0, 4, 0]` — fixed, no per-phrase variation
- Why amateur: Every phrase has the same bass pattern. No development.
- Commercial solution: Bass pattern that mutates per phrase (add/remove/change notes)
- What to build: BassPattern class with mutation

**M6. No silence/rests as musical tool (P1)**
- Where: Every step has events. No intentional rests or dropouts.
- Why amateur: Silence creates contrast. Everything-on-every-step = wall of sound.
- Commercial solution: Planned rests (remove kick for 2 steps, remove bass for 1 bar)
- What to build: Rest events in the musical director

**M7. No transition preparation (P1)**
- Where: Sections change abruptly when `si >= bars*16`. Only riser/sweep exist.
- Why amateur: No element removal before drops, no filter narrowing before breakdowns
- Commercial solution: 2-4 bar transition preparation (remove elements, narrow filter, reduce density)
- What to build: TransitionPreparer in the musical director

**M8. No drop contrast (P0)**
- Where: Drop = same elements + higher energy. No contrast.
- Why amateur: Drop should feel like a payoff. Same-but-louder isn't a drop.
- Commercial solution: Pre-drop silence/filter-down → drop impact with new elements
- What to build: DropDesigner that creates contrast

**M9. No harmonic movement audible (P1)**
- Where: Chord progression changes every 2 bars but pad amplitude is 0.03 (nearly inaudible)
- Why amateur: Harmony is theoretically present but practically inaudible
- Commercial solution: Pads should be audible (0.06-0.08 amp) or harmonic movement should be in bass/lead
- What to build: Increase pad level or move chord changes to bass/lead

**M10. No motif return after mutation (P1)**
- Where: Motif mutates every 4 bars but never returns to original
- Why amateur: In real music, motifs leave and return. Listener recognizes the return.
- Commercial solution: Motif memory — after N mutations, return to original for 1 phrase
- What to build: Motif memory with return cycle

### Production/Mixing Limitations (10)

**P1. No multiband compression (P1)** — See A4
**P2. No true-peak limiting (P1)**
- Where: `this.lim` is a DynamicsCompressor with ratio 20:1 — not true-peak
- Why amateur: Inter-sample peaks can exceed 0dBFS and cause clipping on DAC
- Commercial solution: Oversampled true-peak limiter
- What to build: Port PSY3's `truepeak` function (2x interpolation)

**P3. No LUFS targeting (P1)**
- Where: Master gain is fixed at 0.82. No loudness measurement or targeting.
- Why amateur: Output level varies per world/seed. No consistent loudness.
- Commercial solution: Measure LUFS and adjust gain to target (-9 to -14 LUFS)
- What to build: LUFS measurement + gain automation

**P4. Reverb is single fixed impulse (P2)**
- Where: `this.conv.buffer = this.makeImpulse(2.2, 2.5)` — one reverb for everything
- Why amateur: Different sections need different spaces. Breakdowns need longer reverb, drops need shorter.
- Commercial solution: Multiple impulse responses (room, plate, hall) with send automation
- What to build: Multiple ConvolverNodes with per-section send levels (already partially done in section automation, but only one reverb exists)

**P5. No stereo widening on master (P2)**
- Where: No M/S processing on master bus
- Why amateur: Stereo width is determined only by per-voice panning
- Commercial solution: M/S stereo widener with frequency-dependent width (mono below 120Hz)
- What to build: Port PSY3's `to_stereo` or use PSY4's StereoEngine on master bus

**P6. No glue compression on master (P1)**
- Where: `this.comp` is a DynamicsCompressor but settings are fixed (-14dB threshold)
- Why amateur: No dynamic response to section changes
- Commercial solution: Glue comp with section-aware threshold
- What to build: Section-aware compressor automation

**P7. No sidechain depth variation (P0)**
- Where: Duck depth = `world.duck * (0.5 + aggression * 0.5)` — constant per world
- Why amateur: Sidechain should pump harder in drops, softer in breakdowns
- Commercial solution: Section-aware duck depth (already identified but kick() can't access section)
- What to build: Pass section type to kick() or manage duck externally

**P8. No frequency-aware ducking (P2)**
- Where: Duck affects entire mix (GainNode on sum)
- Why amateur: Only bass should duck, not pads/textures/FX
- Commercial solution: Frequency-selective sidechain (duck only low frequencies)
- What to build: Split signal into low/mid/high, duck only low band

**P9. No harmonic excitation (P2)**
- Where: No exciter/enhancer on master
- Why amateur: High frequencies can sound dull after compression
- Commercial solution: Harmonic exciter (subtle high-frequency saturation)
- What to build: High-shelf saturation on master

**P10. No automated EQ per section (P2)**
- Where: EQ shelves are fixed (lowshelf 100Hz +2.5dB, highshelf 10kHz +1.5dB)
- Why amateur: Different sections need different tonal balance
- Commercial solution: Section-aware EQ (darker in breakdowns, brighter in drops)
- What to build: Automated EQ per section

## 5. SOUND-BANK GAP ANALYSIS

**Can PSY4 generate hundreds of convincing timbres?**

**No.** Current voice architecture:
- 3 oscillator types (saw, square, triangle via PeriodicWave)
- 1 noise source (pink noise buffer)
- 1 filter type (BiquadFilter LP/HP/BP)
- 1 distortion type (tanh waveshaper)
- 1 reverb (single impulse)
- 1 delay (ping-pong, fixed times)

Total unique timbres ≈ 8 world configs × 3 osc types × ~5 parameter variations = ~120, but perceptually many sound similar because the architecture is the same (osc→filter→gain→FX).

**What's needed:**
- FM voices (carrier+modulator+index envelope)
- Ring mod voices
- Wavetable voices (interpolated table lookup)
- Comb filter voices
- Multi-layer kick/bass (sub+mid+click, sub+character+harmonics)
- Metallic hat bank (inharmonic oscillator stacks)
- Multi-burst clap/snare
- Evolving texture voices (filter sweep + detune modulation + grain)
- Saturation variety (tanh, hardclip, foldback, asymmetric)

## 6. COMMERCIAL READINESS SCORE

| Category | Score (0-100) | Notes |
|----------|---------------|-------|
| TECHNICAL | 70 | Works, no NaN, stable. Main-thread scheduler is the weakness. |
| SONIC | 35 | Basic synthesis, no FM/ring/comb, hats are noise-only, no per-voice variation |
| MUSICAL | 30 | 4-note motif, random acid, no counter-melody, no phrase planning |
| MIX | 25 | Single-band comp, no multiband, no true-peak, no LUFS target |
| STEREO | 40 | Per-voice panners exist, but sources are mostly mono, no M/S on master |
| ARRANGEMENT | 35 | Sections exist but no transition prep, no drop contrast, no density curves |
| DYNAMICS | 30 | Fixed comp settings, no section-aware dynamics, no sidechain variation |
| REFERENCE | 0 | No reference analysis at all |
| **OVERALL** | **33** | **Not commercial-grade. Prototype with potential.** |

## 7. P0/P1/P2 ROADMAP

### P0 — Must fix before anything else
1. **Sidechain depth variation per section** — pass section type to kick scheduling
2. **Bass note variation within phrases** — bass pattern mutation, not fixed cycle
3. **Drop contrast** — pre-drop element removal + filter-down
4. **Pad evolution** — LFO detune modulation (PSY3's evolve parameter)
5. **Hat improvement** — metallic oscillator bank instead of noise-only
6. **Clap multi-burst** — 3-4 staggered noise bursts

### P1 — High impact
7. **Modulation matrix** — routable LFO/env/macro → destinations
8. **Phaser FX** — port PSY3's allpass phaser
9. **Shimmer FX** — pitch-shifted reverb tail
10. **Multiband compression** — port PSY3's 3-band comp
11. **True-peak limiting** — 2x oversampled limiter
12. **Per-voice variation** — pitch/decay/tone micro-variation per hit
13. **Motif expansion** — 8-16 note motifs with AABA + return
14. **Acid pattern identity** — stored pattern with mutation, not random
15. **Counter-melody** — second motif that responds to lead
16. **Transition preparation** — 2-4 bar element removal before sections
17. **FM voice** — carrier+modulator for lead/texture
18. **Reference analysis** — port PSY3's style_clone.py to TypeScript

### P2 — Important but not blocking
19. **AudioWorklet** — move scheduling to audio thread
20. **Learning loop** — port PSY3's learner.py
21. **Sample support** — CC0 drum samples
22. **Ring modulation** — metallic/alien timbres
23. **Comb filter** — resonant drones
24. **Stereo widening on master** — M/S processing
25. **LUFS targeting** — loudness measurement + gain automation
26. **Dynamic density within sections** — density envelopes
27. **YouTube reference input** — URL → audio → analysis

## 8. WHAT MUST BE REWRITTEN (not patched)

1. **Master chain** — must become multiband + true-peak + LUFS target (not single-band comp)
2. **Hat voice** — must use metallic oscillator bank (not noise→HP)
3. **Clap voice** — must use multi-burst (not single noise burst)
4. **Pad voice** — must have evolution (not static)
5. **Step function** — must have phrase-level planning, not just per-step decisions
6. **Section transition logic** — must have preparation, not abrupt changes

## 9. WHAT CAN BE BORROWED DIRECTLY FROM PSY3

1. **`worklet.js`** — AudioWorklet pattern (sample-accurate scheduling)
2. **`pro_fx.py: phaser()`** — 4-stage allpass phaser
3. **`pro_fx.py: shimmer()`** — pitch-shifted reverb
4. **`style_master.py: multiband_comp()`** — 3-band compression
5. **`style_master.py: truepeak()`** — true-peak measurement
6. **`style_master.py: to_stereo()`** — stereo widening
7. **`style_clone.py: bpm_est()`** — BPM estimation
8. **`style_clone.py: key_est()`** — key estimation
9. **`learner.py: self_train()`** — learning loop
10. **`engine.py: pad(evolve)`** — pad evolution parameter
11. **`engine.py: zap()`** — FM ear candy (already adopted)
12. **`engine.py: downlifter()`** — descending sweep (already adopted)
13. **`fetch_free_samples.py`** — CC0 sample fetching
14. **`sample_engine.js`** — sample playback

## 10. WHAT PSY4 SHOULD DO THAT PSY3 CANNOT

1. **Live performance** — PSY3 is offline-render only (Python). PSY4 has real-time Web Audio.
2. **Macro control** — PSY3 has no live macros. PSY4 has 10 instant macros.
3. **World system** — PSY3 has 5 basic styles. PSY4 has 8 detailed worlds.
4. **Hook engine** — PSY3 has no motif system. PSY4 has Motif class (needs expansion).
5. **Quality gate** — PSY3 has basic tests. PSY4 has multi-category quality gate.
6. **Groove engine** — PSY3 has no groove system. PSY4 has GrooveState.
7. **Motion engine** — PSY3 has no coordinated modulation. PSY4 has MotionEngine (needs integration).
8. **Space engine** — PSY3 has single reverb. PSY4 has 4-space send/return (needs better integration).
9. **Stereo engine** — PSY3 has post-render stereo. PSY4 has per-voice stereo at source.
10. **Reference-guided generation** — PSY3 has analysis but can't generate from it in real-time. PSY4 can (once analysis is ported).

## 11. PROPOSED FINAL ARCHITECTURE

```
USER (macros + actions + world + reference URL)
    ↓
MusicalDirector (phrase planner, section manager, transition prep)
    ↓
GrooveEngine (timing, velocity, swing, microtiming)
    ↓
HookEngine (motif generation, mutation, counter-melody, call/response)
    ↓
VoiceFactory (generates sound identities from world+role+seed)
    ↓
┌─────────────────────────────────┐
│ AudioWorklet (audio thread)     │
│  ├── Scheduler (sample-accurate)│
│  ├── Voice Bank:                │
│  │   kick (3-layer: sub+mid+click)│
│  │   bass (sub+harmonic+sat)    │
│  │   lead (5-osc supersaw+LFO)  │
│  │   acid (square+resonant+dist)│
│  │   hat (metallic osc bank)    │
│  │   clap (multi-burst)         │
│  │   perc (pitched membrane)    │
│  │   pad (detuned+evolve)       │
│  │   texture (FM/wavetable/noise)│
│  │   FX (riser/impact/sweep/zap)│
│  ├── ModulationMatrix           │
│  ├── FX Bus:                    │
│  │   phaser / shimmer / delay   │
│  │   reverb (room/plate/hall)   │
│  ├── Mix Bus:                   │
│  │   multiband comp             │
│  │   glue comp                  │
│  │   saturation                 │
│  │   true-peak limiter          │
│  │   LUFS targeting             │
│  └── Stereo (M/S, mono<120Hz)   │
└─────────────────────────────────┘
    ↓
Speakers
```

**Reference pipeline (when available):**
```
YouTube URL / Audio file
    ↓
ReferenceAnalyzer (BPM, key, spectral, structure, rhythm)
    ↓
TargetStyleProfile
    ↓
World adaptation + Macro adjustment + Voice selection
    ↓
Generate → Render → Measure distance → Optimize → Keep best
```
