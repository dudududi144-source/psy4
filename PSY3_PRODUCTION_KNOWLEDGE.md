# PSY3 Production Knowledge Transfer

## Overview

This document maps PSY3's production techniques to PSY4's implementation. It extracts not just algorithms but DESIGN PRINCIPLES — why PSY3 sounds the way it does, and how PSY4 implements each principle.

## Production Technique Map

| PSY3 Technique | What It Accomplishes | Where in PSY3 | PSY4 Implementation | Status |
|----------------|---------------------|---------------|---------------------|--------|
| `bl_saw()` adaptive harmonics | Band-limited sawtooth (no aliasing) | pro_dsp.py | Worklet BLSaw (polyBLEP) | EXACT |
| `moog()` 4-stage tanh ladder | Warm resonant filter with character | pro_dsp.py | Worklet MoogLadder class | EXACT |
| `pink_noise()` Voss-McCartney | Natural-sounding noise for hats/perc | pro_dsp.py | Worklet PinkNoise class | EXACT |
| Kick: sub+mid+click layers | Full-bodied kick with transient | engine.py | Worklet KickVoice (3-layer) + LayerEngine | EXACT |
| Bass: saw→filter→sub | Controlled harmonic content + clean low | engine.py | Worklet BassVoice + LayerEngine | EXACT |
| Lead: detuned BL saws | Rich supersaw without harshness | engine.py | Worklet LeadVoice (5-osc) + LayerEngine | EXACT |
| Hat: differentiated pink noise | Metallic transient without samples | engine.py | Worklet HatVoice + PSY3 samples | EXACT |
| Clap: multi-burst noise | Realistic clap with body | engine.py | Worklet ClapVoice + PSY3 sample | EXACT |
| `EvolvingSequence` | Controlled mutation (not random) | psy_gen.py | musicalGrammar.ts EvolvingSequence | EXACT |
| `tension_at()` shapes | Section-aware energy curves | psy_gen.py | musicalGrammar.ts tensionAt() | EXACT |
| `density_at()` gating | Downbeat/offbeat accents | psy_gen.py | musicalGrammar.ts densityAt() | EXACT |
| `EvolvingParam` | Bounded random walk | psy_gen.py | musicalGrammar.ts EvolvingParam | EXACT |
| `multiband_comp()` 3-band | Frequency-specific compression | style_master.py | Legacy path only (worklet has saturation+limiter) | APPROXIMATE |
| `_glue()` feed-forward comp | Mix glue | style_master.py | Legacy path only | APPROXIMATE |
| `_sat()` tanh mix | Subtle harmonic saturation (15% mix) | style_master.py | Worklet MasterChain (tanh) | EXACT |
| `truepeak()` 2x oversampled | Inter-sample peak protection | style_master.py | Legacy path only | APPROXIMATE |
| `to_stereo()` delay-based width | Frequency-dependent stereo | style_master.py | Worklet stereo (pan-based, not M/S) | APPROXIMATE |
| `phaser()` 4-stage allpass | Psychedelic movement | pro_fx.py | Worklet PhaserProcessor (in psy4-dsp.js) | EXACT |
| `shimmer()` pitch-shifted reverb | Ethereal tail | pro_fx.py | NOT YET IMPLEMENTED | MISSING |
| `chorus()` detuned delay | Width and movement | pro_fx.py | NOT YET IMPLEMENTED | MISSING |
| `style_clone.py` reference analysis | BPM/key/spectral extraction | style_clone.py | NOT YET IMPLEMENTED | MISSING |
| `learner.py` self-improvement | Render→measure→adjust loop | learner.py | NOT YET IMPLEMENTED | MISSING |

## Key Production Principles (Extracted from PSY3)

### 1. Sub Over Click
PSY3 kicks prioritize sub body (0.18s decay) over click (0.002s). The sub is 90x longer than the click.
**PSY4**: LayerEngine builds kick with sub layer (gain 0.9) + body layer (gain 0.35) + click layer (gain 0.06). Sub dominates.

### 2. Bass Leaves Room for Kick
PSY3 bass filter drops to 150Hz, leaving sub (50Hz) clear for kick.
**PSY4**: BassVoice cutoff envelope: 1200Hz → 150Hz. Sub sine at f/2 doesn't compete with kick fundamental.

### 3. Controlled Mutation, Not Random
PSY3 EvolvingSequence changes ONE note every 4 bars. Motif is recognizable.
**PSY4**: LeadMotif uses EvolvingSequence with mutateEvery=4. AcidPattern mutates one step at section boundaries.

### 4. Section-Aware FX
PSY3 doesn't put reverb on everything. Kick is dry. Lead gets delay.
**PSY4**: ProductionDirector sets per-voice FX sends: kick reverb=0.05, bass reverb=0.02, lead reverb=0.2-0.4 (section-dependent), pad reverb=0.4.

### 5. Tension Shapes
PSY3 uses arc/rise/fall/wave shapes for section energy.
**PSY4**: Each section gets a tension shape: build='rise', break='fall', drop='arc'.

### 6. Downbeat Accent
PSY3 bar_schedule gives downbeats 1.4x probability, offbeats 1.15x.
**PSY4**: GrooveEngine accentPattern: downbeats get 1.0, offbeats get 0.6-0.7.

### 7. Dry Master
PSY3 master is not washed with reverb. Saturation is 15% mix (subtle).
**PSY4**: Worklet MasterChain uses tanh with 85% dry / 15% wet. Reverb is a send, not insert.

## What PSY4 Adds Beyond PSY3

| Feature | PSY3 | PSY4 |
|---------|------|------|
| Real-time AudioWorklet | Python (offline) | AudioWorklet (real-time) |
| Sample variety | 6 samples | 52 samples (6 PSY3 + 46 generated) |
| Round robin | None | 4-8 variants per drum |
| Stereo output | Post-process | Real-time in worklet |
| Mix-aware selection | None | MixTracker + MixAwareSelector |
| Layer engine | Single-layer | Multi-layer (sub+body+click) |
| Call/response | None | CallResponseEngine |
| Production Director | None | ProductionDirector (producer brain) |
| Groove engine | Static patterns | GrooveEngine (microtiming, ghost hits) |

## Gaps Still Remaining

1. **Shimmer reverb**: PSY3 has pitch-shifted reverb tail. PSY4 has Schroeder reverb but no shimmer.
2. **Chorus**: PSY3 has detuned delay chorus. Not in PSY4 worklet.
3. **Reference analyzer**: PSY3 style_clone.py analyzes BPM/key/spectrum. Not in PSY4.
4. **Learning loop**: PSY3 learner.py self-improves. Not in PSY4.
5. **Full multiband in worklet**: PSY3 has 3-band compression. PSY4 worklet has saturation+limiter only.
6. **M/S stereo**: PSY3 has frequency-dependent stereo. PSY4 uses pan-based only.
