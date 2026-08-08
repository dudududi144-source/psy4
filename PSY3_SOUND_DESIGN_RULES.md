# PSY3 Sound Design Rules — Knowledge Transfer

## Overview

This document extracts DESIGN RULES from PSY3's DSP, arrangement, and sound design code. These are not literal parameter copies — they are the principles that make PSY3 sound musical rather than algorithmic.

## Rule 1: Kicks prioritize sub/body over click

**PSY3 implementation** (`engine.py` kick):
```python
sub = sin(2π·cumsum(f)/SR) * exp(-t/0.18)   # sub body, 0.18s decay
mid = tanh(tri*1.5) * exp(-t/0.05) * 0.5    # mid punch, 0.05s decay
click = diff(noise) * exp(-t/0.002) * 0.35  # click, 0.002s decay
return (sub + mid + click) * 0.8             # sub dominates
```

**Why it works**: The sub (0.18s decay) is 3.6x longer than the mid (0.05s) and 90x longer than the click (0.002s). The kick has BODY, not just transient.

**PSY4 implementation**: Worklet kick uses PSY3 kick.wav sample (99.8% sub energy) + synth sub layer. Round robin preserves phase coherence.

**Rule**: Never let the click dominate. Sub/body must be the foundation.

---

## Rule 2: Bass occupies controlled low-mid region, leaves room for kick

**PSY3 implementation** (`engine.py` bass):
```python
cut = 1500*exp(-t/0.08) + 150   # cutoff drops from 1500Hz to 150Hz
y = one_pole_lp(saw, cut)        # filter envelope: bright → dark
return (y*0.7 + sub*0.5) * exp(-t/dur)  # sub at f/2
```

**Why it works**: The filter envelope starts at 1500Hz (for transient character) and drops to 150Hz (for body). This creates a "pluck" that settles into the low-mid region, leaving the sub (50Hz) clear for the kick.

**PSY4 implementation**: Worklet bass uses BL saw → Moog ladder with cutoff envelope (1200Hz → 150Hz) + sub sine at f/2. Sidechain ducking on bass bus.

**Rule**: Bass filter must drop to ~150Hz. Never let bass harmonics compete with kick sub.

---

## Rule 3: Leads are not dominated by extreme high-frequency energy

**PSY3 implementation** (`engine.py` lead):
```python
for v in range(voices):
    d = 1 + (v-(voices-1)/2)*0.006  # ±0.6% detune
    o += bl_saw(f*d, n)             # band-limited saw (no aliasing)
return o/voices * amp * min(1, t/0.005) * exp(-t/dur)
```

**Why it works**: PSY3 uses `bl_saw` (band-limited, adaptive N harmonics) — no aliasing. The detune is small (±0.6%), creating a supersaw without harshness. No high-frequency boost.

**PSY4 implementation**: Worklet lead uses BL saw (polyBLEP, no aliasing) → Moog filter with envelope + LFO. 5 detuned oscillators with ±10 cents (controlled by macros).

**Rule**: Use band-limited oscillators. Never boost extreme highs. Let the filter do the work.

---

## Rule 4: Variation happens through controlled mutation, not random events

**PSY3 implementation** (`psy_gen.py` EvolvingSequence):
```python
# 16-step pattern, mutate ONE note every 4 bars
if cnt >= mutate_every * 16:
    i = rng.randint(0, 15)
    st = rng.choice([-2, -1, 1, 2])
    pattern[i] = max(-range, min(range, pattern[i] + st))
```

**Why it works**: The motif is RECOGNIZABLE. Only one note changes at a time, and only every 4 bars. This creates evolution, not chaos. The listener can follow the musical identity.

**PSY4 implementation**: `EvolvingSequence` class ported to TypeScript. `LeadMotif` uses AABA structure (bars 0-1 = A, bar 2 = B contrast, bar 3 = A' return). `AcidPattern` uses stored patterns with controlled mutation.

**Rule**: Never use `pick([0,0,2,4,7])` for musical generation. Use stored patterns that mutate one step at a time.

---

## Rule 5: FX are used to connect sections, not as random ear candy

**PSY3 implementation** (`music.js`):
```javascript
if(s===0){ if(sec.i)eng.impact(t); if(sec.r)eng.riser(t, s16*16); }
```

**Why it works**: FX only fire at section boundaries (step 0 of first bar). Impact at drop start. Riser during build. They are STRUCTURAL, not decorative.

**PSY4 implementation**: step() fires riser/impact/sweep/downlifter at section boundaries. Ear candy (zap/blip) uses low probability (0.03-0.04 * surprise macro) — sparse, not constant.

**Rule**: FX mark transitions. Ear candy should be rare and surprising, not constant.

---

## Rule 6: Tension shapes control density and energy

**PSY3 implementation** (`psy_gen.py` tension_at):
```python
def tension_at(p, shape="arc"):
    if shape=="arc": return 4*p*(1-p)      # rises then falls
    if shape=="rise": return p              # builds up
    if shape=="fall": return 1-p            # releases
```

**Why it works**: Different section types need different energy curves. Build = rise. Break = fall. Drop = arc (peak in middle). This creates musical narrative.

**PSY4 implementation**: `tensionAt()` ported. Each section type gets a shape: build='rise', break='fall', drop/climax='arc'.

**Rule**: Energy must follow a shape, not be constant. Different sections need different curves.

---

## Rule 7: Downbeat and offbeat accents create rhythmic identity

**PSY3 implementation** (`psy_gen.py` bar_schedule):
```python
if s%4==0: pr=min(1,pr*1.4)    # downbeat: 1.4x probability
if s%2==1: pr=min(1,pr*1.15)   # offbeat: 1.15x probability
```

**Why it works**: The downbeat (steps 0,4,8,12) gets 40% more events. The offbeat (steps 1,3,5,7...) gets 15% more. This creates the "groove" that makes psytrance feel driven, not random.

**PSY4 implementation**: BASS_PATTERNS include accent arrays. Kick plays on every beat (sb%4===0) with downbeat accent (0.9+energy*0.1). Hats play on 16ths with downbeat accent.

**Rule**: Accent the downbeat. Offbeats get lighter velocity. Never make every hit identical.

---

## Rule 8: Master chain is musical, not just loud

**PSY3 implementation** (`style_master.py` master_pro):
```python
x = band_gains(x, (0.55, 0.30, 0.15))  # spectral balance
x = multiband_comp(x)                    # 3-band compression
x = _glue(x)                             # glue compression
x = _sat(x, drive=1.15, mix=0.15)        # subtle saturation (15% mix)
x = x/truepeak(x) * 0.89                 # true-peak limiting
```

**Why it works**: The chain is: balance → compress → glue → saturate → limit. Saturation is only 15% mix (subtle harmonic addition, not distortion). True-peak targeting at -1dB (0.89 amplitude).

**PSY4 implementation**: Worklet MasterChain uses tanh saturation (drive 1.15, 85/15 dry/wet) + envelope-follower limiter (ceiling 0.94). Legacy path has full multiband + glue + true-peak.

**Rule**: Saturation should be subtle (10-20% mix). True-peak limiting, not just peak. Balance before compression.

---

## Rule 9: Stereo width is frequency-dependent

**PSY3 implementation** (`style_master.py` to_stereo):
```python
d = int(0.012*SR)  # 12ms delay
side = roll(x, d)
side = side - roll(side, 1)  # decorrelated highpass side
return x + side*width, x - side*width
```

**Why it works**: The side signal is a delayed, high-passed version of the mono signal. Low frequencies stay mono (no delay on them). Only highs get width. This preserves low-end phase coherence.

**PSY4 implementation**: Worklet outputs stereo. Kick/bass stay mono (center). Hats get pan variation via round robin. Pads/leads get natural width from detuned oscillators.

**Rule**: Never widen the sub. Only widen mid/high frequencies. Keep kick/bass phase-coherent.

---

## Rule 10: Controlled reverb and delay, not wash

**PSY3 implementation** (`music.js`):
```javascript
// No global reverb — PSY3 uses sample-based sounds + dry mix
```

**Why it works**: PSY3's sound is DRY and PUNCHY. The kick/hat/clap samples already have their natural decay. Reverb would muddy the low end. Delay is used sparingly for leads.

**PSY4 implementation**: Legacy path has reverb + delay sends per channel strip. Worklet currently is dry (reverb/delay are P1 enhancements to add to worklet).

**Rule**: Reverb should be subtle and sent (not inserted). Delay should be tempo-synced. Never wash the kick.

---

## Summary: The 10 PSY3 Sound Design Rules

1. Kicks prioritize sub/body over click
2. Bass occupies controlled low-mid, leaves room for kick
3. Leads are not dominated by extreme highs
4. Variation = controlled mutation, not random
5. FX connect sections, not decorate
6. Tension shapes control density/energy
7. Downbeat/offbeat accents create groove
8. Master chain is musical (balance → compress → glue → saturate → limit)
9. Stereo width is frequency-dependent (never widen sub)
10. Reverb/delay are subtle sends, not wash

These rules are now embedded in PSY4's architecture: the worklet DSP, the musical grammar engine, the bus architecture, and the sample selection logic.
