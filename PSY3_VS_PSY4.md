# PSY3 vs PSY4 — Technical Comparison

## תאריך: 2026-08-08

---

## Architecture

| Area | PSY3 | PSY4 | Winner | Why |
|------|------|------|--------|-----|
| **Language** | Python (offline) + JS (web) | TypeScript (Next.js) | PSY4 | Type-safe, integrated |
| **DSP Runtime** | numpy (offline) / Web Audio (live) | Web Audio (live) + TypeScript DSP (offline) | Tie | Different tradeoffs |
| **Sample Rate** | 44100Hz | 22050Hz | PSY3 | Higher SR = better quality |
| **Scheduler** | setInterval(25ms) | setInterval(25ms) | Tie | Both main-thread (P0 problem) |
| **AudioWorklet** | Yes (worklet.js) | No | PSY3 | Sample-accurate, no GC |
| **Realtime** | Yes (rt_engine.js) | Yes (psy4LiveEngine.ts) | PSY4 | More voices, macros, worlds |

## Synthesis

| Voice | PSY3 | PSY4 | Winner | Key Difference |
|-------|------|------|--------|----------------|
| **Kick** | sub sine + triangle mid + noise click | sub sine + triangle mid + square click | **PSY3** | PSY3: 87% low, PSY4: 53% low. PSY3 kick has real body. |
| **Bass** | bl_saw + sub sine, one-pole LP | PeriodicWave saw + sub sine, biquad LP, waveshaper | **PSY3** | PSY3: 76% low, PSY4: 46% low. PSY4 bass is too bright. |
| **Lead** | 5 detuned bl_saw, LP filter | 5 detuned PeriodicWave, LP + LFO | **PSY3** | PSY3: 1.7% high, PSY4: 92% high. PSY4 lead is harsh. |
| **Pad** | sine + harmonic, evolve param | PeriodicWave pair, LFO detune | **PSY4** | PSY4 has evolve LFO (adopted from PSY3 concept) |
| **Hat** | noise → HP | metallic osc bank + noise → HP | **PSY4** | PSY4 hat has metallic character |
| **Clap** | single noise burst | multi-burst (4 staggered) | **PSY4** | PSY4 clap is realistic |
| **Texture** | None | FM / wavetable / noise | **PSY4** | PSY4 has dedicated texture engine |
| **Acid** | bass with acid=True (moog filter) | square + resonant filter + distortion | **Tie** | Different approaches, both valid |
| **Ear candy** | zap, blip, downlifter | zap, blip, downlifter, sweep | **PSY4** | More variety |

## DSP Primitives

| Primitive | PSY3 | PSY4 | Winner | Why |
|-----------|------|------|--------|-----|
| **Saw** | bl_saw (additive, N harmonics up to Nyquist) | PeriodicWave (48 harmonics) | **PSY3** | PSY3 adapts N per frequency, PSY4 is fixed |
| **Square** | bl_square (odd harmonics to Nyquist) | PeriodicWave (48 harmonics, odd only) | **PSY3** | Same — adaptive N |
| **Moog filter** | 4-stage ladder with tanh saturation + feedback | BiquadFilter (native, no saturation) | **PSY3** | PSY3 Moog is musically superior |
| **One-pole LP** | Custom (in bass) | BiquadFilter | **PSY3** | PSY3's custom LP has exponential cutoff envelope |
| **Noise** | pink_noise (Paul Kellet) | pink buffer (Paul Kellet) | Tie | Same algorithm |
| **Waveshaper** | np.tanh | WaveShaperNode (tanh curve) | Tie | Same result |

## FX

| FX | PSY3 | PSY4 | Winner | Why |
|----|------|------|--------|-----|
| **Reverb** | ConvolverNode (1.8s impulse) | ConvolverNode (2.2s impulse) | Tie | Similar |
| **Delay** | Single delay + feedback + LP | Ping-pong stereo delay + LP | **PSY4** | Stereo ping-pong is better |
| **Phaser** | 4-stage allpass (pro_fx.py) | None | **PSY3** | PSY4 completely missing |
| **Shimmer** | Pitch-shifted reverb (pro_fx.py) | None | **PSY3** | PSY4 completely missing |
| **Chorus** | None | Chorus (in DSP layer, not live) | N/A | Neither has it in live |
| **Bitcrush** | Yes (pro_fx.py) | None | **PSY3** | PSY4 completely missing |

## Mastering

| Stage | PSY3 | PSY4 | Winner | Why |
|-------|------|------|--------|-----|
| **Compression** | Multiband (3-band: low/mid/high) | Single-band DynamicsCompressor | **PSY3** | Far more professional |
| **Glue** | Feed-forward glue comp (thr=0.6, ratio=2) | DynamicsCompressor (thr=-14dB) | **PSY3** | PSY3's is purpose-built |
| **Saturation** | tanh(x*1.1) on master | Highshelf EQ +1.5dB | **PSY3** | Saturation adds cohesion |
| **True-peak** | 2x interpolation true-peak | DynamicsCompressor as limiter | **PSY3** | PSY4 has no true-peak |
| **LUFS targeting** | Yes (target=-9 LUFS) | No (fixed gain 0.82) | **PSY3** | PSY4 has no loudness targeting |
| **Stereo** | to_stereo (delayed decorrelated HP side) | Per-voice StereoPanner | **PSY4** | PSY4 has source-level stereo |

## Musical Intelligence

| Feature | PSY3 | PSY4 | Winner | Why |
|---------|------|------|--------|-----|
| **Worlds** | 5 styles (basic params) | 8 worlds (detailed) | **PSY4** | More identity, more params |
| **Motif** | None | 4-note AABA with mutation | **PSY4** | PSY3 has no motif system |
| **Bass grammar** | root + (bar%3) | Walking cycle [0,0,4,0,7,0,4,0] | **PSY4** | More musical |
| **Chord progressions** | None | 4-chord per scale | **PSY4** | PSY3 has static chord |
| **Section automation** | riser/impact only | riser, impact, sweep, reverb/delay automation | **PSY4** | More section-aware |
| **Groove** | swing only | GrooveEngine (velocity, accent, microtiming) | **PSY4** | More sophisticated |
| **Drop contrast** | None | Bass removal pre-drop, downlifter | **PSY4** | PSY3 has no contrast |

## Reference Analysis

| Feature | PSY3 | PSY4 | Winner | Why |
|---------|------|------|--------|-----|
| **BPM estimation** | onset autocorrelation (style_clone.py) | None | **PSY3** | Complete implementation |
| **Key estimation** | chroma profile matching | None | **PSY3** | Complete implementation |
| **Spectral analysis** | 3-band (low/mid/high) | None | **PSY3** | Complete implementation |
| **Structure detection** | bar-level RMS | None | **PSY3** | Complete implementation |
| **Learning loop** | self_train (render→measure→converge) | None | **PSY3** | Complete implementation |
| **Rhythm learning** | 16-step onset profile | None | **PSY3** | Complete implementation |

## Samples

| Feature | PSY3 | PSY4 | Winner | Why |
|---------|------|------|--------|-----|
| **Sample loading** | fetch_free_samples.py (CC0 from archive.org) | None | **PSY3** | Real drum samples sound better |
| **Sample playback** | sample_engine.js | None | **PSY3** | Complete implementation |
| **Sample fallback** | If sample exists, use it; else synthesize | Always synthesize | **PSY3** | Better sound when samples available |

---

## Summary

### PSY3 עדיף ב:
1. **Sound quality of individual voices** — kick/bass/lead all have better spectral balance
2. **DSP primitives** — band-limited saw adapts to frequency, Moog ladder filter with saturation
3. **FX** — phaser, shimmer, bitcrush (PSY4 has none)
4. **Mastering** — multiband comp, true-peak, LUFS targeting
5. **Reference analysis** — complete pipeline (BPM, key, spectral, structure, learning)
6. **Samples** — CC0 sample library
7. **AudioWorklet** — sample-accurate scheduling

### PSY4 עדיף ב:
1. **Musical intelligence** — motifs, chord progressions, bass grammar, groove engine
2. **World system** — 8 detailed worlds vs 5 basic styles
3. **Live performance** — 10 macros, 10 action buttons, instant response
4. **Section automation** — risers, sweeps, reverb/delay automation per section
5. **Stereo at source** — per-voice panners, detuned pairs
6. **Voice variety** — more voices (texture, acid, sweep, zap, blip, downlifter)
7. **Architecture** — TypeScript, Next.js, type-safe, integrated

### מה חייב להילקח מPSY3:
1. **bl_saw / bl_square** — adaptive band-limiting (PSY4's fixed 48-harmonic PeriodicWave produces aliasing at high frequencies)
2. **Moog ladder filter** — 4-stage with tanh saturation + feedback (PSY4's BiquadFilter has no character)
3. **Phaser** — 4-stage allpass
4. **Shimmer** — pitch-shifted reverb
5. **Multiband compression** — 3-band
6. **True-peak limiting** — 2x oversampled
7. **LUFS targeting** — loudness management
8. **Reference analysis** — BPM, key, spectral, structure, learning
9. **AudioWorklet** — sample-accurate scheduling
10. **Kick/bass gain staging** — PSY3 kick is 87% low, PSY4 is 53% low

### מה PSY4 צריך לבנות מעבר לPSY3:
1. **Reference-guided generation** — analyze → TargetStyleProfile → generate → compare → optimize
2. **YouTube input** — URL → audio → analysis → original generation
3. **Learning loop** — iterative quality convergence toward reference
4. **Modulation matrix** — routable LFO/env/macro → destinations
5. **Voice identity system** — parameterized sound families
6. **Phrase-level musical director** — 4/8/16-bar planning
