# Commercial Reference Framework — PSY4 Production Standard

## The Philosophical Shift

**PSY3 is NOT the benchmark. PSY3 is a knowledge source.**

Previous phases compared PSY4 to PSY3 and concluded "PSY4 is better than PSY3, therefore it's good." This is wrong. PSY3 is a weak reference — if PSY3 sounds bad, being "better than PSY3" doesn't make PSY4 commercially viable.

### PSY3's Role: KNOWLEDGE_SOURCE
PSY3 provides:
- DSP algorithms (bl_saw, moog filter, pink noise)
- Envelope techniques (pitch sweep, amp envelope)
- Worklet architecture (AudioWorklet, ring buffer, voice pool)
- Timing techniques (scheduler, lookahead)
- Implementation ideas (how to structure a synth engine)

PSY3 does NOT provide:
- Sound quality targets (its samples are basic)
- Spectral balance references (its mix is thin)
- Loudness standards (it's not mastered)
- Commercial production benchmarks

### The Real Benchmark: COMMERCIAL PSYTRANCE

PSY4's target is professionally produced, released psytrance — the kind of tracks you hear at festivals, on streaming platforms, in DJ sets. These tracks have:
- LUFS: -8 to -12 (streaming-optimized loudness)
- True peak: -1.0 to -1.5 dBTP
- Kick sub energy: 70-95% (dominant low-end)
- Bass/kick frequency separation (kick owns sub, bass owns low-mid)
- Mono low-end (below 120Hz, everything is center)
- Wide stereo above 2kHz
- Controlled dynamics (crest factor 6-10dB)

## Commercial Target Ranges

### Loudness (Streaming Standard)
| Metric | Target Range | Notes |
|--------|-------------|-------|
| LUFS (integrated) | -12 to -8 | Spotify: -14, Apple Music: -16, but psytrance masters hotter |
| True Peak | -2.0 to -0.5 dBTP | -1.0 dBTP is safe for all platforms |
| Crest Factor | 5-12 dB | Lower = louder/denser, higher = more dynamic |

### Spectral Balance (% of total energy)
| Band | Range | Role |
|------|-------|------|
| Sub (20-60Hz) | 14-35% | Kick fundamental, bass sub |
| Low (60-200Hz) | 8-20% | Bass body, kick body |
| Low-Mid (200-800Hz) | 10-25% | Bass harmonics, low-mid warmth |
| Mid (800-3000Hz) | 12-30% | Lead fundamental, vocal range |
| High-Mid (3-6kHz) | 8-18% | Lead presence, hat body |
| High (6-12kHz) | 5-15% | Hat sparkle, air |
| Air (12-20kHz) | 2-10% | Cymbals, atmospheric sheen |

### Kick Targets
| Metric | Target | Why |
|--------|--------|-----|
| Fundamental | 45-58Hz | The sub region where kick lives |
| Sub energy | 70-95% | Kick MUST be sub-dominant |
| Body energy | 4-25% | Adds definition, not mud |
| Click energy | 0.5-5% | Transient, not harshness |
| Decay | 0.12-0.30s | Short enough for groove, long enough for weight |
| Sub/body ratio | 3:1 to 18:1 | Sub clearly dominates |

### Bass Targets
| Metric | Target | Why |
|--------|--------|-----|
| Fundamental | 55-110Hz | Above kick sub, below lead |
| Sub energy | 38-75% | Strong low-end but not competing with kick |
| Body energy | 15-40% | Harmonic character |
| Stereo width | 0-0.15 | BASS MUST BE MONO below 120Hz |

### Lead Targets
| Metric | Target | Why |
|--------|--------|-----|
| Brightness (centroid) | 1200-5000Hz | Bright enough to cut through, not harsh |
| High-mid energy | 5-18% | Above 18% = harsh |
| Stereo width | 0.2-0.8 | Can be wide |

### Stereo Targets
| Metric | Target | Why |
|--------|--------|-----|
| Low-end mono freq | 120Hz | Everything below this is mono (phase coherence) |
| Width below 200Hz | 0-0.15 | Low-end stays centered |
| Width above 2kHz | 0.3-0.9 | Highs can be wide |
| Low correlation | 0.8-1.0 | Low-end must be phase-coherent |

## Genre-Specific Targets

### Progressive Psy (125-138 BPM)
- LUFS: -10 (moderate loudness)
- Kick fundamental: 52Hz
- Kick sub: 85%
- Lead brightness: 2500Hz
- Arrangement: 7 minutes, clear sections

### Dark Psy (145-160 BPM)
- LUFS: -9 (hotter)
- Kick fundamental: 48Hz (deeper)
- Kick sub: 88%
- Lead brightness: 2000Hz (darker)
- Arrangement: 8 minutes, long drops

### Goa (136-148 BPM)
- LUFS: -9
- Kick fundamental: 52Hz
- Lead brightness: 2800Hz (brighter)
- Stereo width: wide (0.7 above 2kHz)
- Arrangement: 9 minutes, melodic

### Forest (145-155 BPM)
- LUFS: -9
- Kick fundamental: 48Hz
- Lead brightness: 2200Hz
- Arrangement: 8 minutes, atmospheric

### Morning Psy (138-145 BPM)
- LUFS: -10
- Kick fundamental: 54Hz (higher)
- Lead brightness: 3000Hz (brightest)
- Arrangement: 7 minutes, uplifting

## The Generate→Analyze→Compare→Fix Loop

```
GENERATE sound
    ↓
ANALYZE (analyzeAudio)
    ↓
COMPARE (benchmarkAgainstCommercial)
    ↓
IDENTIFY DEFICIENCIES (weaknesses + recommendations)
    ↓
MODIFY SOUND (adjust parameters)
    ↓
ANALYZE AGAIN
    ↓
ACCEPT (score > 80) or REJECT (score < 60)
```

### Example: Kick Analysis

**Generated Kick:**
- Sub energy: 60%
- Fundamental: 54Hz
- Body energy: 35%

**Commercial Target (progressive-psy):**
- Sub energy: 85% (ideal)
- Fundamental: 52Hz (ideal)
- Body energy: 12% (ideal)

**Score:**
- Sub: 60% vs 85% target → score 0.5 (warning)
- Fundamental: 54Hz vs 52Hz → score 0.9 (great)
- Body: 35% vs 12% → score 0.3 (bad)

**Recommendation:** "Reduce body energy (35% → 12%), increase sub dominance"

This is an OBJECTIVE, MEASURABLE way to improve sound quality — not based on "how it sounds" but on commercial production standards.

## Implementation

- `commercialReference.ts`: Defines target ranges for all genres
- `referenceAnalyzer.ts`: Analyzes audio and benchmarks against targets
- `scoreAgainstTarget()`: Scores any value against a target range (0..1)
- `benchmarkAgainstCommercial()`: Full benchmark report with strengths/weaknesses/recommendations

## What This Changes

Previous approach: "Does PSY4 sound better than PSY3?"
New approach: "Does PSY4 meet commercial production standards?"

This is a fundamental shift from relative comparison (better than a weak reference) to absolute comparison (meets professional standards).
