# Sample Selection Rules — Context-Aware Sample Intelligence

## Overview

PSY4 does NOT use random sample selection. Every sample choice is driven by musical context: world, section, energy, velocity, and phrase position. Selection is deterministic (seeded) so musical identity is preserved, with controlled mutation at phrase boundaries.

## Selection Architecture

```
Musical Context (world, section, energy, velocity, phrase position)
    ↓
SampleSelector
    ↓
RoundRobinBank (deterministic variant selection)
    ↓
SampleVoice (playback with pitch/gain/pan variation)
    ↓
Channel Processing (HP, saturation, bus routing)
```

## Kick Selection

```
selectKick({ world, section, energy, fundamental })
```

**Decision logic:**
- **Sample**: Always `kick.wav` (only one kick sample, but pitch-shifted per world)
- **Fundamental**: `world.kickFundamental` (46Hz dark-psy → 54Hz morning-psy)
- **Pitch shift**: `fundamental / 50` (ratio to sample's native 50Hz)
- **Round robin**: 4 variants with ±0.45% pitch, ±6% gain
- **Phase coherence**: Kick sub is NEVER randomly pitched beyond ±0.5%
- **Velocity**: Downbeat = 0.9+energy*0.1, offbeat = 0.8+energy*0.15
- **Section**: 
  - Drop: full velocity, short decay
  - Break: no kick (or very soft ghost)
  - Build: rising velocity

## Hat Selection

```
selectHat({ section, velocity, subdivision, brightness, variation })
```

**Decision logic:**
- **Sample**: `hat_closed.wav` (16th notes) or `hat_open.wav` (offbeats/transitions)
- **Round robin**: 8 variants with ±1.75% pitch, ±0.14 pan (stereo movement)
- **Velocity**: Downbeat (sb%4===0) = 0.12, offbeat = 0.08, scaled by density macro
- **Pan**: Slight movement via `sin(s * 0.1) * 0.15` + round robin offset
- **Open hat**: On step 4 of each bar (except break), velocity 0.06+density*0.04, pan -0.25
- **Section**:
  - Break: reduced hat density
  - Drop: full 16th pattern
  - Fill: additional hats on steps 12-15 of phrase-end bars

## Clap Selection

```
selectClap({ section, velocity })
```

**Decision logic:**
- **Sample**: Always `clap.wav`
- **Round robin**: 4 variants with ±0.6% pitch, ±4.5% gain
- **Placement**: Beats 2 & 4 (sb===4 and sb===12 in drop)
- **Velocity**: 0.25 * (0.5 + energy*0.5), extra clap in drop at sb===12
- **Section**: No clap in intro/break

## Bass Selection

```
selectBass({ world, key, register, phrasePosition, density, energy })
```

**Decision logic:**
- **Instrument**: Synth bass (BL saw → Moog ladder + sub sine) — more control than sample
- **Pattern**: `BASS_PATTERNS[world.bass]` (roll/off/acid) with explicit accent arrays
- **Pattern variant**: Deterministic selection via `bassPatternIdx` (seeded per section)
- **Register**: Root note at `world.root` (43-50Hz depending on world)
- **Cutoff envelope**: 1200Hz → 150Hz (psytrance pluck character)
- **Sidechain**: Bass bus ducked by kick (depth = world.duck)
- **Ghost notes**: Step 0 of odd bars, 30% probability, velocity 0.2

## Lead Selection

```
selectLead({ world, section, energy, phrasePosition })
```

**Decision logic:**
- **Instrument**: Synth lead (5-osc supersaw → Moog filter + LFO)
- **Motif**: `LeadMotif` with AABA structure (A bars 0-1, B bar 2, A' bar 3)
- **Evolution**: `EvolvingSequence` mutates one note every 4 bars
- **B section**: Plays octave higher for contrast
- **Cutoff**: `world.leadCutoff * (0.7 + brightness * 0.6)` with LFO modulation
- **Detune**: `world.leadDetune * (0.5 + psychedelia)` — controlled supersaw width
- **Stereo**: 5 oscillators panned across the field

## Acid Selection

```
selectAcid({ world, section, energy, phrasePosition })
```

**Decision logic:**
- **Instrument**: Synth acid (BL square → high-resonance Moog → distortion)
- **Pattern**: `AcidPattern` with 4 stored patterns (root-fifth-octave, walking, etc.)
- **Mutation**: One step mutates at section boundaries
- **Resonance**: 0.9 (near self-oscillation for squelch)
- **Cutoff sweep**: 3200Hz → 100Hz (classic acid filter envelope)
- **Distortion**: `tanh(signal * (2 + aggression*2))`

## FX Selection

```
selectFX({ transition, barsToDrop, energy, world })
```

**Decision logic:**
- **Riser**: Last 2 bars of build (tension before drop)
- **Impact**: Drop start (section contrast)
- **Sweep**: Breakdown start + section transitions
- **Downlifter**: Drop start step 4 (descending contrast after impact)
- **Zap/Blip**: Low probability (3-4% * surprise macro) — sparse ear candy
- **Section-aware**: FX only at boundaries, never random during phrases

## Round Robin Bank

Each drum category has a round robin bank that cycles through variants:

| Category | Variants | Pitch Variation | Gain Variation | Pan Variation |
|----------|----------|-----------------|----------------|---------------|
| Kick | 4 | ±0.45% | ±6% | 0 (mono) |
| Hat | 8 | ±1.75% | 0 | ±0.14 |
| Clap | 4 | ±0.6% | ±4.5% | 0 (mono) |

**Rules:**
- Kick: NEVER pitch beyond ±0.5% (preserve sub phase coherence)
- Hat: Wider pitch/pan variation acceptable (inharmonic, no phase issues)
- Clap: Subtle variation (multi-burst noise is already irregular)
- Counter resets to 0 at section boundaries (deterministic)

## Velocity Layers

Currently single velocity layer per sample (PSY3 has one sample per category). Velocity is applied as gain scaling:
- Velocity 1.0 = full sample amplitude
- Velocity 0.5 = -6dB
- Velocity 0.2 = -14dB (ghost notes)

Future: Multiple velocity layers (soft/medium/hard hits) would require multisamples.

## Deterministic Variation

All selection uses seeded RNG (`SeededRng`):
- `seed = this.seed * 1000 + sectionIdx`
- Same seed = same musical output (reproducible)
- Mutation happens at controlled intervals (every 4 bars for lead, every section for acid)
- Never random chaos — always intentional, recognizable variation
