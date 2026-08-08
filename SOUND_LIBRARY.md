# PSY4 Sound Library — Asset Inventory & Analysis

## Forensic Audit Results

A complete search of the PSY3 repository (`/tmp/psy3/`) found exactly **6 audio assets** — all WAV format, all mono, all 44100 Hz sample rate. There are no hidden sample packs, no AIFF/FLAC/MP3 files, no impulse responses, no loops. PSY3's sound quality comes entirely from DSP processing of these 6 samples + synthesis.

## Asset Inventory

### A. Commercial-Ready Assets (primary drum/bass sounds)

| File | Category | Duration | Peak | RMS | Centroid | Low% | Mid% | High% | Role |
|------|----------|----------|------|-----|----------|------|------|-------|------|
| kick.wav | kick | 0.280s | 1.000 | 0.319 | 221Hz | 99.8% | 0.2% | 0.0% | Sub body anchor |
| hat_closed.wav | hat | 0.060s | 1.000 | 0.331 | 13963Hz | 0.0% | 0.1% | 99.9% | Metallic high |
| hat_open.wav | hat | 0.300s | 1.000 | 0.390 | 13847Hz | 0.0% | 0.2% | 99.7% | Open metallic |
| clap.wav | clap | 0.250s | 1.000 | 0.374 | 11004Hz | 1.4% | 8.1% | 90.5% | Bright clap |

### B. Useful Layers (bass/lead character)

| File | Category | Duration | Peak | RMS | Centroid | Low% | Mid% | High% | Role |
|------|----------|----------|------|-----|----------|------|------|-------|------|
| bass_A.wav | bass | 0.180s | 0.675 | 0.200 | 858Hz | 92.7% | 7.2% | 0.1% | Bass with character |
| lead.wav | lead | 0.300s | 0.274 | 0.052 | 7583Hz | 0.0% | 89.2% | 10.8% | Bright mid lead |

### C-E. Texture/FX/Experimental/Do-not-use

No additional texture, FX, or experimental assets exist in PSY3. All FX (risers, impacts, sweeps, zaps, blips, downlifters) are generated via DSP in `engine.py`.

## Acoustic Analysis Details

### kick.wav — Primary Kick Drum
- **Fundamental**: ~50Hz (pitched sine with exponential decay)
- **Transient**: Very low zero-crossing rate (125/s) — pure sub, no click
- **Crest factor**: 3.1 (moderate dynamics — not over-compressed)
- **Spectral profile**: 99.8% low-frequency energy, centroid at 221Hz
- **Recommended role**: Kick drum sub body layer (the anchor of the mix)
- **Recommended BPM**: 120-160 (all psytrance tempos)
- **Recommended worlds**: ALL (fundamental pitch-shifted per world: 46-54Hz)
- **Processing chain**: HP 25Hz → saturation (drive 1.3) → mono → drum bus
- **Round robin**: 4 micro-pitch variants (±0.45%) — never pitch the sub

### hat_closed.wav — Closed Hi-Hat
- **Fundamental**: N/A (inharmonic metallic)
- **Transient**: Extremely high zero-crossing rate (29350/s) — pure noise-like
- **Crest factor**: 3.0 (sharp transient)
- **Spectral profile**: 99.9% high-frequency energy, centroid at 13963Hz
- **Recommended role**: Closed hat on 16th notes
- **Recommended BPM**: ALL
- **Recommended worlds**: ALL
- **Processing chain**: HP 6000Hz → transient preserve → small stereo width → drum bus
- **Round robin**: 8 micro-pitch/pan variants (±1.75% pitch, ±0.14 pan)

### hat_open.wav — Open Hi-Hat
- **Fundamental**: N/A (inharmonic metallic)
- **Transient**: High zero-crossing rate (29320/s)
- **Crest factor**: 2.6 (sustained metallic resonance)
- **Spectral profile**: 99.7% high-frequency energy, centroid at 13847Hz
- **Recommended role**: Open hat on offbeats / transitions
- **Processing chain**: HP 6000Hz → longer decay → stereo width → drum bus
- **Round robin**: 8 variants (shared with closed hat counter)

### clap.wav — Clap
- **Fundamental**: N/A (multi-burst noise)
- **Transient**: High zero-crossing rate (22204/s) — noise-based
- **Crest factor**: 2.7 (multi-burst envelope)
- **Spectral profile**: 90.5% high, 8.1% mid — bright clap
- **Recommended role**: Clap on beats 2 & 4
- **Processing chain**: HP 120Hz → body preserve → short room → stereo layer
- **Round robin**: 4 micro-pitch/gain variants (±0.6% pitch, ±4.5% gain)

### bass_A.wav — Bass Sample
- **Fundamental**: ~110Hz (bass with harmonic content)
- **Transient**: Low zero-crossing rate (128/s) — tonal, not noise
- **Crest factor**: 3.4 (moderate dynamics)
- **Spectral profile**: 92.7% low, 7.2% mid — deep bass with character
- **Recommended role**: Bass layer (currently used as reference, not in worklet)
- **Note**: The worklet uses synth bass (BL saw + Moog) which provides more control. bass_A.wav is available for future sample-bass hybrid.

### lead.wav — Lead Sample
- **Fundamental**: N/A (harmonic stack)
- **Transient**: High zero-crossing rate (3297/s) — bright tonal
- **Crest factor**: 5.3 (sharp pluck envelope)
- **Spectral profile**: 89.2% mid, 10.8% high — bright lead
- **Recommended role**: Lead layer (currently used as reference, not in worklet)
- **Note**: The worklet uses synth lead (supersaw + Moog) which provides more control.

## Sample Selection Rules

### Kick Selection
```
selectKick({ world, section, energy, fundamental })
→ Always use kick.wav (only one kick sample)
→ Pitch-shift to world.kickFundamental (46-54Hz)
→ Round robin: 4 micro-pitch variants for organic feel
→ Never pitch below ±0.5% (preserve phase coherence)
```

### Hat Selection
```
selectHat({ section, velocity, subdivision, open })
→ Closed: hat_closed.wav
→ Open: hat_open.wav
→ Round robin: 8 variants with micro pitch + pan
→ Pan variation: ±0.14 (subtle stereo movement)
```

### Clap Selection
```
selectClap({ section, velocity })
→ Always use clap.wav
→ Round robin: 4 micro-pitch/gain variants
→ Velocity affects gain, not pitch
```

## Provenance & Licensing

All 6 samples originate from the PSY3 repository (`/tmp/psy3/web/samples/`). PSY3 is a reference/knowledge-base project. The samples are used as DSP source material, not as final audio. No copyright issues — these are procedural samples generated for testing.

## Quality Assessment

**Overall quality**: A (Commercial-ready for kick/hat/clap). These samples have:
- Clean transients (no clipping, no DC offset)
- Proper spectral distribution (kick is pure sub, hats are pure high)
- Good crest factors (not over-compressed)
- Consistent levels (peak normalized to 1.0 for kick/hat/clap)

**Weakness**: Only one sample per category (no true multisamples). This is mitigated by round-robin micro-variation (pitch/gain/pan) which creates the illusion of multiple samples.
