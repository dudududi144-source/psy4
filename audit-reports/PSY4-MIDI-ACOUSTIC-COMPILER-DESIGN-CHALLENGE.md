# PSY4 — MIDI Acoustic Compiler: Design Challenge Report

**Status:** Critical redesign challenge. No code written.
**Predecessors:** `PSY4-AUDIO-QUALITY-CRISIS-VERDICT.md`, `PSY4-MIDI-COMPILER-DESIGN.md`
**Date:** 2024-08-12

This report challenges the previous 7-layer architecture, answers the 14 design questions critically, and proposes a revised architecture. Where the user's ideas are wrong, I say so. Where parts can't be solved automatically, I say so.

---

## Executive Summary — What changed from the previous design

| Previous (7-layer) | Revised (9-layer) | Why |
|---|---|---|
| Musical Intelligence | Musical Intelligence | unchanged |
| — | **Musical Physics / Acoustic Intelligence** (NEW) | The bridge between musical reasoning and synthesis reasoning. Produces AcousticNotes. Was smeared across Sound Intelligence and Render. Must be explicit. |
| Performance Intelligence | Performance Intelligence | unchanged |
| Sound Intelligence | Sound Intelligence | unchanged (but input is now AcousticNote, not MusicalNote) |
| Render | Synthesis (per-voice) + **Mixing** (NEW, split from Render) | Mixing (EQ, compression, reverb, stereo, balance) is a distinct concern from voice synthesis. Was conflated. |
| Critic | Critic (24-dim, multi-objective) | expanded from ~10 dims to 24, split into 3 reliability tiers |
| Mutator | Mutator (targeted, per-layer) | unchanged |
| Decision | Decision (Pareto + human checkpoint) | unchanged, but Pareto is now mandatory not optional |

**Three things I challenge in the user's proposal:**
1. **Sound Genome should NOT include synthesis mechanisms** (FMIndex, FMRatio, wavetablePosition). Those belong in SynthesisGraph. Sound Genome is purely descriptive. Including mechanisms couples the descriptor to the implementation.
2. **Producer mode candidates should be per-PHRASE, not per-note.** Per-note candidates overwhelm the user. Propose 2-3 phrase-level alternatives, not 200 note-level alternatives.
3. **SuperCollider is OPTIONAL and DEFERRED.** Don't commit to it upfront. The Web Audio loop proves the architecture first. SC is a medium-term escalation only if the Web Audio quality ceiling is hit.

**Three things the user is right about that I embrace:**
1. **Musical Physics as a separate layer.** Yes. It produces the AcousticNote, which is the contract between musical reasoning and synthesis.
2. **No single quality score.** Yes. Pareto front exploration, multi-objective, hard constraints, human checkpoints. The single biggest protection against Goodhart.
3. **Genre = constraints + priors, not hardcoded rules.** Yes. The architecture must be genre-agnostic. Psytrance is one config.

---

## 1. Is the current architecture correct?

**Partially.** The 7-layer model was directionally right but had three structural defects:

### Defect 1 — Musical Physics was missing as an explicit layer

The previous model jumped from Musical Intelligence (notes, harmony, phrase) directly to Sound Intelligence (synth family, params). The acoustic reasoning — "what does this note MEAN physically given its role and context?" — was smeared across Sound Intelligence and Render.

**Symptom:** the previous design had no explicit representation of "this bass note at C2 in C minor at 145 BPM with a kick on the same beat needs: fundamental 65.41Hz, harmonic budget X, envelope 1/16 note = 103ms, masking budget Y against the kick at 50Hz, stereo policy mono." That reasoning was implicit, buried in the synth voice function's hardcoded params.

**Fix:** add Musical Physics as Layer 2. Its output is the AcousticNote.

### Defect 2 — Mixing was conflated with Render

The previous model had one "Render" layer that did both voice synthesis AND mixing (EQ, compression, reverb, stereo, balance). These are distinct concerns:
- Voice synthesis: turn SynthesisGraph + PerformedNote → raw voice audio.
- Mixing: combine voices + apply EQ/compression/reverb/stereo/balance → mixed audio.

The critic needs to measure BOTH per-voice quality AND mix quality. If they're conflated, the mutator can't tell whether a problem is in the voice or in the mix.

**Fix:** split into Layer 5 (Synthesis) and Layer 6 (Mixing).

### Defect 3 — The critic was too thin

The previous critic had ~10 dimensions, mostly DSP. It lacked musical dimensions (phrase coherence, tension/release, groove) and had no explicit reliability tiering. This is why F22 failed: the critic measured DSP dimensions that passed while musical dimensions (unmeasured) failed.

**Fix:** expand to 24 dimensions, split into 3 reliability tiers (reliable DSP, proxy musical, subjective human-only). See §6.

---

## 2. What's missing in the current architecture?

| Missing | Why it's needed | Layer |
|---|---|---|
| **Musical Physics / Acoustic Intelligence** | The bridge between musical reasoning and synthesis. Produces AcousticNotes with frequency/register/harmonic budget/masking budget/envelope targets/phase targets/stereo policy. | Layer 2 (NEW) |
| **Mixing Intelligence** | EQ, compression, reverb, stereo, balance — distinct from voice synthesis. The mutator needs to target mix problems separately from voice problems. | Layer 6 (split from Render) |
| **VoiceGroup concept** | Kick+bass must be co-designed as one acoustic unit, not two independent voices. The Musical Physics layer produces VoiceGroups (sets of AcousticNotes with cross-note relationships). | Layer 2 |
| **Sound Genome (repurposed SoundDNA)** | SoundDNA as a synth recipe is broken (F22). Repurpose as a DESCRIPTOR/TARGET. Pure features, no synthesis mechanisms. | Layer 4 input |
| **AcousticNote schema** | The data structure that crosses the music→synthesis boundary. Currently doesn't exist. | Layer 2 output |
| **Multi-objective critic with Pareto** | 24-dim critic, 3 reliability tiers, Pareto front exploration, hard constraints, regression detection. | Layer 7 |
| **Genre config system** | Genre = constraints + priors + targets. Pluggable, not hardcoded. ~10-15 params per genre. | Layer 0 input |
| **Preserve vs Producer modes** | Two trust models. Preserve: MIDI immutable. Producer: propose candidates with explanations. | Layer 0 input |
| **Reference profile extractor** | Reference WAV → target profiles (Kick, Bass, Lead, Spectral, Transient, Stereo, Dynamics, Energy). Reference is a TARGET, not a SOURCE. | Layer 0 input |
| **BPM-aware timing calculator** | All envelopes/LFOs/delays/sidechains computed from musical grid (1/4, 1/8, 1/16, 1/32, triplet, bar, phrase) × BPM. No hardcoded ms. | Layer 2 utility |
| **Mutation operator registry** | Per-layer mutation strategies. CMA-ES for continuous, greedy for discrete, beam for structured, genetic for diversity. | Layer 8 |
| **Pareto front tracker** | Tracks non-dominated candidates across 24 dimensions. Doesn't collapse to scalar. | Layer 9 |
| **Human checkpoint interface** | Every N iterations, present Pareto front to user for ear-based selection. | Layer 9 |

---

## 3. Should Musical Physics be a separate layer?

**Yes.** Here's the reasoning.

### The case for a separate layer

Musical Physics is conceptually distinct from both Musical Intelligence and Sound Intelligence:

- **Musical Intelligence** answers: "what notes, in what key, in what phrase, with what role?" — purely musical reasoning, no physics.
- **Musical Physics** answers: "given this note in this role in this context at this BPM, what are its acoustic targets?" — the bridge from musical to physical. Produces frequency, register, harmonic budget, masking budget, envelope target range, phase target, stereo policy.
- **Sound Intelligence** answers: "given these acoustic targets + this Sound Genome + this context, what synthesis architecture realizes them?" — purely synthesis reasoning, takes acoustic targets as input.

If Musical Physics is smeared into Sound Intelligence, the synth voice functions end up hardcoding acoustic reasoning (e.g., "bass decay = 65ms" instead of "bass decay = 1/16 note at 145 BPM = 103ms, adjusted for role"). This is exactly what's wrong with the current `psyLive.ts`.

If Musical Physics is smeared into Musical Intelligence, the musical reasoning gets polluted with physical details (frequency in Hz, masking budgets) that don't belong in a musical representation.

### The case against (and why it's wrong)

One could argue Musical Physics is "just a transform" — a function from MusicalNote to AcousticNote — and doesn't need its own pipeline stage. This is true mechanically but false architecturally. The AcousticNote is a CONTRACT between two worlds. Making it explicit means:

1. The contract is inspectable (you can see what acoustic targets were computed and why).
2. The contract is testable (you can unit-test the Musical Physics layer independently).
3. The mutator can target it (if masking is weak, mutate the masking budget in the AcousticNote, not the synth params).
4. The genre config plugs in here (genre determines the harmonic budget, envelope target ranges, stereo policy).

### Verdict

**Musical Physics is Layer 2. It's a thin layer — its job is to produce AcousticNotes + VoiceGroups, not to make decisions.** It takes MusicalNotes + genre config + BPM + (optional) reference profiles as input, and outputs AcousticNotes with all acoustic targets specified as RANGES (not exact values — the SynthesisGraph has freedom within the range).

---

## 4. Acoustic Note — definition

### The three-stage note model

```
MIDI Note (raw input)
  pitch=48 (C3), velocity=96, duration=82ms, channel=1, start=1.5s
        ↓ Musical Intelligence (Layer 1)
Musical Note (musical context)
  pitch=48, scaleDegree=1 (root), key=C minor, role=bass,
  phraseIndex=2, barInPhrase=3, beatInBar=2.75, beatStrength=weak,
  tensionContext=building, voiceGroup=kickbass
        ↓ Musical Physics (Layer 2)
Acoustic Note (acoustic targets)
  frequency=130.81Hz (C3 equal temperament, A4=440)
  register=bass
  fundamentalTarget=130.81Hz ± 0.5Hz (pitch stability)
  harmonicBudget={ sub: 0.4, fundamental: 0.6, 2nd: 0.3, 3rd: 0.15, 4th+: 0.05 }
  transientTarget={ attack: 1-3ms, clickEnergy: 0.1 }
  envelopeTarget={ attack: 1-2ms, decay: 1/16 note (103ms @145bpm), sustain: 0, release: 5ms }
  phaseTarget={ alignWithKick: true, phaseOffset: 0° }
  maskingBudget={ vsKick: { overlapHz: 50-65, allowedOverlap: 0.2 } }
  stereoPolicy=mono
  synthesisFamilyHint=subtractive-bass (from genre + role + Sound Genome)
  dynamicTarget={ velocity=0.85, accent=false }
        ↓ Sound Intelligence (Layer 4) + Performance (Layer 3)
SynthesisGraph (actual synth params)
  family=subtractive-bass, oscType=sawtooth, layers=3,
  filterCutoff=600Hz, filterEnvClose=150Hz, filterEnvTime=25ms,
  subGain=0.4, midGain=0.25, charGain=0.15, decay=103ms, ...
```

### What the AcousticNote IS

- A **contract** between musical reasoning and synthesis reasoning.
- A set of **target ranges** (not exact values) that the SynthesisGraph must satisfy.
- **Context-dependent**: the same MIDI note produces different AcousticNotes depending on role, genre, BPM, phrase position, tension context, and voice group.
- **Inspectable and mutable**: the mutator can target acoustic targets (e.g., "reduce masking budget overlap with kick from 0.2 to 0.1") independently of synth params.

### What the AcousticNote is NOT

- It is NOT a synth param set. It doesn't say "oscType=sawtooth, cutoff=600Hz". That's the SynthesisGraph.
- It is NOT a fixed value. It's a RANGE. The SynthesisGraph has freedom within the range.
- It is NOT independent. AcousticNotes in a VoiceGroup (e.g., kick+bass) have cross-note relationships (masking budgets, phase targets).

### VoiceGroup — the kick+bass unit

The user's point #6 (kick/bass physics) is critical. Kick+bass must be treated as ONE acoustic unit, not two independent voices. The Musical Physics layer produces a VoiceGroup:

```
VoiceGroup {
  type: 'kickbass',
  members: [kickAcousticNote, bassAcousticNote],
  jointTargets: {
    frequencySeparation: { kickFundamental: 50Hz, bassFundamental: 65Hz, ratio: 1.3 }
    phaseAlignment: { kickSubPhase: 0°, bassSubPhase: 90° (offset to avoid cancellation) }
    envelopeInterleave: { kickDecay: 80ms, bassOnset: 20ms (starts when kick body ends) }
    maskingBudget: { overlapBand: 50-65Hz, allowedOverlap: 0.15 }
    sidechainRecovery: { duckAmount: 0.3, recoveryTime: 1/16 note }
  }
}
```

The SynthesisGraph for kick and bass must satisfy BOTH their individual AcousticNotes AND the VoiceGroup's joint targets. The critic measures the VoiceGroup as a unit (kick clarity, bass separation, K/B ratio, gap RMS, masking).

---

## 5. Sound Genome — definition (with a challenge to the user)

### The user's proposed Sound Genome

```
brightness, warmth, harmonicity, inharmonicity, transientSharpness,
spectralCentroid, spectralSpread, FMIndex, FMRatio, wavetablePosition,
noiseAmount, resonance, filterMotion, pitchMotion, amplitudeMotion,
stereoWidth, stereoMotion, density, roughness
```

### My challenge: Sound Genome must be PURELY DESCRIPTIVE

The user's list includes synthesis mechanisms (FMIndex, FMRatio, wavetablePosition, resonance). **These do NOT belong in Sound Genome.** They belong in SynthesisGraph.

**Why:** Sound Genome is a DESCRIPTOR/TARGET — it describes what the sound IS, not HOW it's made. If you include mechanisms, you couple the descriptor to a specific implementation. A "metallic aggressive lead" might be realized by FM (FMIndex=4, FMRatio=2:1) OR by wavetable scanning (wavetablePosition=0.7) OR by ring modulation. The Sound Genome should say "metallic=0.8, aggressive=0.7, bright=0.6" — the codebook + search figures out WHICH mechanism achieves that.

### Revised Sound Genome (descriptors only)

```
Sound Genome {
  // Spectral character
  brightness: 0-1          // spectral centroid normalized
  warmth: 0-1              // low-mid energy (200-500Hz)
  harmonicity: 0-1         // tonal vs noisy
  inharmonicity: 0-1       // partials deviation from integer ratios
  noisiness: 0-1           // spectral flatness
  spectralSlope: -1 to 0   // high-freq rolloff rate
  roughness: 0-1           // dissonance/amplitude modulation

  // Energy distribution
  subEnergy: 0-1           // <80Hz
  bodyEnergy: 0-1          // 80-500Hz
  midEnergy: 0-1           // 500-2500Hz
  highEnergy: 0-1          // >2500Hz

  // Transient/dynamics
  transientSharpness: 0-1  // attack speed
  attackTime: seconds
  decayTime: seconds
  sustainLevel: 0-1
  releaseTime: seconds

  // Modulation (descriptive, not mechanism)
  filterMotion: 0-1        // how much filter moves over time
  pitchMotion: 0-1         // vibrato/pitch env amount
  amplitudeMotion: 0-1     // tremolo/AM amount
  timbralMotion: 0-1       // spectral flux over time (overall timbral evolution)

  // Saturation/distortion (descriptive)
  saturation: 0-1          // harmonic distortion amount
  distortionCharacter: 0-1 // soft clip to hard clip

  // Spatial
  stereoWidth: 0-1         // mono to wide
  stereoMotion: 0-1        // static to moving

  // Density
  density: 0-1             // spectral density (number of significant partials)

  // Confidence (for learned/inferred genomes)
  confidence: 0-1
}
```

### Sound Genome → SynthFamily → SynthesisGraph

The mapping is:
1. Sound Genome (descriptors) + role + genre → **SynthFamily** (categorical: fm / wavetable / subtractive / sample / hybrid) via the codebook.
2. SynthFamily + AcousticNote + Performance → **SynthesisGraph** (actual params: oscType, fmRatio, fmIndex, wavetablePosition, cutoff, resonance, envelope times, LFO rates, etc.) via search.

The Sound Genome is the TARGET. The SynthesisGraph is the REALIZATION. The codebook picks the family; the search picks the params.

### Where Sound Genome is used

- **As target** (from reference WAV): extract Sound Genome from reference → target. Search SynthesisGraph params to minimize distance between rendered Sound Genome and target Sound Genome.
- **As descriptor** (per voice): each voice has a Sound Genome that describes its identity. The identity is fixed; the realization (SynthesisGraph) can vary.
- **As identity** (across phrases): the Sound Genome persists across phrases. The SynthesisGraph may change (e.g., filter envelope shape per phrase) but the Sound Genome (brightness, warmth, etc.) stays consistent.

---

## 6. Audio/Music Genome — the 24-dimension critic

### Three reliability tiers

The critic must be honest about what it can and can't measure. Split into 3 tiers:

#### Tier 1 — DSP-reliable (15 dims, can optimize on these)

| Dimension | Measurement method | Reliability |
|---|---|---|
| pitch_accuracy | YIN/pYIN fundamental detection vs target | High |
| scale_accuracy | notes on scale % | High |
| harmonic_consistency | chord tones on strong beats % | High |
| rhythmic_accuracy | onset detection vs grid | High |
| transient_quality | onset strength + attack time | High |
| kick_body | spectral energy 60-200Hz | High |
| kick_click | spectral energy >5kHz | High |
| bass_definition | spectral centroid + harmonic content | High |
| kick_bass_separation | gap RMS between kick and bass | High |
| spectral_balance | 7-band energy distribution vs target | High |
| midrange_density | 200-2500Hz energy % | High |
| masking | frequency overlap between voices | High |
| phase_coherence | cross-correlation between voices | High |
| dynamic_range | DR meter | High |
| loudness | LUFS (ITU-R BS.1770) | High |

#### Tier 2 — Proxy musical (7 dims, use as CONSTRAINTS, not optimization targets)

| Dimension | Measurement method | Reliability | Why proxy |
|---|---|---|---|
| timbral_richness | spectral entropy + harmonic count | Medium | correlates with "rich" but doesn't capture "pleasant" |
| timbral_movement | spectral flux over time | Medium | correlates with "movement" but doesn't capture "musical" |
| stereo_image | mid-side analysis | Medium | reliable measurement, but "good" stereo is subjective |
| depth | reverb/delay presence + early reflection analysis | Medium | correlates with "depth" but doesn't capture "tasteful" |
| phrase_coherence | motif recurrence + contour shape consistency | Medium | correlates with "coherent" but doesn't capture "musical" |
| musical_tension | density/register/dissonance curve shape | Medium | correlates with "tension/release" but doesn't capture "effective" |
| arrangement_energy | energy contour over time | Medium | reliable measurement, but "good" contour is subjective |

#### Tier 3 — Subjective (2 dims, human-only, NOT in the automatic critic)

| Dimension | Why not measurable |
|---|---|
| groove | subjective — proxy (microtiming consistency) correlates imperfectly |
| musicality | subjective — no reliable proxy. "Sounds like music" requires human ear. |

### CriticReport data structure

```typescript
interface CriticReport {
  // Tier 1: DSP-reliable (optimization targets)
  tier1: {
    pitch_accuracy: number;
    scale_accuracy: number;
    // ... 15 dims
  };
  
  // Tier 2: Proxy musical (constraints, not targets)
  tier2: {
    timbral_richness: number;
    // ... 7 dims
  };
  
  // Tier 3: Subjective (human-only, always null in auto critic)
  tier3: {
    groove: null;      // filled by human checkpoint
    musicality: null;
  };
  
  // Hard constraints (must be satisfied)
  constraints: {
    no_clipping: boolean;
    no_dc_offset: boolean;
    on_scale: boolean;
    in_phrase: boolean;
    mono_compatible: boolean;   // stereo width < threshold below 200Hz
  };
  
  // Weakest dimensions (optimization targets for next iteration)
  weakest: Array<{ dimension: string; tier: 1|2; score: number; gap_to_target: number }>;
  
  // Violations (constraint failures)
  violations: Array<{ constraint: string; severity: number; explanation: string }>;
  
  // Per-dimension explanations (for human review)
  explanations: Array<{ dimension: string; explanation: string }>;
  
  // Recommended mutation (which layer + which param to mutate)
  recommended_mutation: Array<{
    layer: 'musical_physics' | 'performance' | 'sound' | 'mixing';
    target: string;     // e.g., "kick_sub_frequency", "bass_filter_envelope"
    direction: string;  // e.g., "increase", "decrease", "change_family"
    reason: string;
  }>;
  
  // Pareto front membership (is this candidate non-dominated?)
  pareto_optimal: boolean;
  
  // Distance to reference profiles (if reference provided)
  reference_distance: {
    kick: number;
    bass: number;
    lead: number;
    spectral: number;
    transient: number;
    stereo: number;
    dynamics: number;
  } | null;
}
```

### The honest claim

The critic can reliably measure 15 DSP dimensions. It can measure 7 musical dimensions as proxies (correlate with quality but imperfect). It CANNOT measure 2 subjective dimensions (groove, musicality) — these need human judgment.

**The loop optimizes on Tier 1 only.** Tier 2 dimensions are CONSTRAINTS (must be above threshold, e.g., `timbral_movement > 0.4`). Tier 3 dimensions are deferred to human checkpoints.

This is honest. The previous F22 failure was pretending Tier 2/3 dimensions were Tier 1.

---

## 7. Preserve vs Producer modes

### PRESERVE mode

- MIDI is **immutable**.
- PSY4 can change: synthesis, performance (velocity, microtiming, articulation), envelopes, automation, mixing.
- PSY4 CANNOT change: notes (pitch, start, duration as notated), phrase structure, arrangement.
- The loop mutates Layers 2-6 only. Layer 1 (Musical Intelligence) is read-only.

### PRODUCER mode

- PSY4 may propose **candidates** for: note length, velocity, octave, microtiming, harmony, counter-melody, fills, transitions, rhythmic variation, arrangement.
- PSY4 NEVER changes MIDI silently.
- PSY4 returns: ORIGINAL + CANDIDATE A/B/C with reason + metrics.

### My challenge: candidates should be per-PHRASE, not per-note

The user's proposal implies per-note candidates. This is wrong operationally:

- A 16-bar phrase has ~200 notes. 3 candidates per note = 600 candidates. The user can't review 600 candidates.
- Musical decisions are phrase-level, not note-level. "Try this phrase with a counter-melody" is meaningful. "Try note 47 with velocity 64 instead of 63" is noise.

**Revised Producer mode:**
- Candidates are **per-phrase** (or per-section).
- Each candidate is a complete alternative realization of that phrase.
- PSY4 proposes 2-3 phrase-level candidates, each with: reason ("improves tension/release by adding a counter-melody in bar 6"), metrics (which dimensions improve), and the diff (what changed).
- The user picks one, or rejects all and asks for more.

### Candidate data structure

```typescript
interface ProducerCandidate {
  phraseIndex: number;
  candidateId: 'A' | 'B' | 'C';
  mutationType: 'harmony' | 'counter_melody' | 'rhythmic_variation' | 'octave_shift' | 'fill' | 'transition' | 'arrangement';
  diff: Array<{ bar: number; beat: number; original: Note; candidate: Note }>;
  reason: string;
  predicted_improvement: Array<{ dimension: string; delta: number }>;
  metrics_after_render: CriticReport | null;   // filled after the candidate is rendered
}
```

---

## 8. Reference Listening architecture

### Reference is a TARGET, not a SOURCE

The user's model is correct: the reference WAV is not copied. It's analyzed into TARGET PROFILES that PSY4 tries to approach.

### Reference → Target Profiles

```
Reference WAV
    ↓
AudioFeatureExtractor (existing, extends)
    ↓
Target Profiles:
  KickProfile    { fundamental, subEnergy, bodyEnergy, clickEnergy, decay, crest }
  BassProfile    { fundamental, harmonicContent, filterMovement, decay, articulation }
  LeadProfile    { spectralCentroid, timbralMovement, FMness, brightness, stereoWidth }
  SpectralProfile { 7-band energy distribution }
  TransientProfile { attackTime, transientSharpness, onsetStrength }
  StereoProfile   { widthByBand, midSideBalance, motionAmount }
  DynamicsProfile { DR, crestFactor, loudnessRange }
  EnergyProfile   { energy contour over time }
  SoundGenome     { per-voice Sound Genome extracted from reference }
```

### How profiles are used

1. **As optimization targets** (Layer 7 critic): the critic measures distance between the rendered audio's features and the target profiles. The loop minimizes this distance.
2. **As priors** (Layer 2 Musical Physics): the reference's KickProfile informs the AcousticNote's harmonic budget and decay target for the kick voice.
3. **As Sound Genome target** (Layer 4 Sound Intelligence): the reference's Sound Genome (per voice) becomes the target descriptor. The codebook picks a SynthFamily; the search finds params that realize that Sound Genome.

### The one-to-many problem

The user mentioned this earlier: multiple SynthesisGraphs can produce audio matching the same Sound Genome. This is the synth inversion problem.

**Mitigation:**
- The codebook picks ONE SynthFamily based on (Sound Genome + role + genre). This narrows the search to one family.
- Within the family, CMA-ES searches the continuous params. The search finds ONE good realization, not all realizations.
- The Pareto front tracks diverse realizations (different param sets that all score well). The user picks from the Pareto front at human checkpoints.

This doesn't "solve" the one-to-many problem (it's inherent), but it manages it: the codebook narrows, the search finds one, the Pareto front preserves diversity, the human picks.

---

## 9. Critic architecture — Goodhart protection

### The 7 protections

1. **No single scalar objective.** The critic returns 24 dimensions. The decision layer uses Pareto dominance, not a scalar score. NEVER collapse to a single number for optimization.

2. **Tiered reliability.** Tier 1 (DSP) is optimized. Tier 2 (proxy) is constrained. Tier 3 (subjective) is human-only. The loop doesn't pretend Tier 2/3 are Tier 1.

3. **Hard constraints as filters.** `no_clipping`, `no_dc_offset`, `on_scale`, `in_phrase`, `mono_compatible` are FILTERS. A candidate that violates a constraint is rejected immediately, regardless of score.

4. **Regression detection.** If any Tier 1 dimension drops below 80% of its previous best, the candidate is flagged. The mutator must explain the regression. If the regression is in a non-targeted dimension, the candidate is rejected.

5. **Diversity preservation.** The Pareto front tracks non-dominated candidates. The mutator injects diversity (random restarts, genetic crossover) to avoid converging to one local optimum. The population size is ~10-20 candidates.

6. **Reference comparison.** If a reference is provided, the critic measures distance to reference profiles. This is an ADDITIONAL signal, not the only signal. The loop doesn't optimize ONLY for reference match — it also optimizes for commercial quality targets.

7. **Periodic human checkpoints.** Every N iterations (default N=10), the Pareto front is presented to the user for ear-based selection. The user picks the candidate that "sounds best" — this injects Tier 3 judgment that the critic can't measure. The user's pick becomes the new baseline.

### How this prevents Critic-Goodhart

The previous F22 failure: the critic measured crest factor + gap RMS + K/B ratio. The loop optimized those. The metrics passed. The sound didn't improve.

With the 7 protections:
- The critic now measures 15 Tier 1 dimensions, not 3. Optimizing 3 is easy to game; optimizing 15 is harder.
- Tier 2 dimensions (timbral_movement, phrase_coherence) are CONSTRAINTS. If the loop optimizes Tier 1 at the expense of Tier 2, the constraint triggers and the candidate is rejected.
- Regression detection catches "improved targeted dim, regressed non-targeted dim".
- Human checkpoints catch "all metrics up, but sounds dead".
- Pareto front preserves diverse candidates, so the user has real choices at checkpoints.

**The single biggest protection is #1: no single scalar objective.** As long as the decision layer uses Pareto dominance (not a scalar), the loop can't game one number.

---

## 10. Optimization architecture — per-parameter-type optimizer

### The mapping

| Parameter type | Search space | Optimizer | Why |
|---|---|---|---|
| Sample choice (kick, hat, perc) | Discrete, ~130 options | Greedy + random restart | Small space, reliable critic. Greedy finds the best in ~10-20 evaluations. |
| Synthesis family (fm/wavetable/subtractive/sample) | Categorical, ~5 options | Exhaustive or greedy | Tiny space. Try all, pick best. |
| Continuous synth params (cutoff, resonance, FM ratio, envelope times) | Continuous, 5-50 dims | CMA-ES | Good for non-convex, no-gradient, 5-50 dims. Works without gradients. Population-based. |
| Final polish (fine-tuning best candidate) | Continuous, 2-20 dims | Bayesian optimization | Sample-efficient for expensive evaluations. Good for final 5-10% improvement. |
| Arrangement / phrase structure | Structured, sequential | Beam search | Good for sequential decisions (phrase 1 → phrase 2 → ...). Keeps top-K partial solutions. |
| MIDI candidates (Producer mode) | Constrained (within MusicalIntent) | Constrained genetic | Respects musical constraints. Crossover + mutation within allowed operations. |
| Diversity preservation | Population-based | Genetic (NSGA-II) | Multi-objective genetic algorithm. Maintains Pareto front diversity. |

### The loop

```
1. Deterministic baseline (Layers 1-6, no search)
   → baseline audio + baseline CriticReport
2. Identify weakest Tier 1 dimension
3. Identify which layer + param affects that dimension
4. Choose optimizer for that param type
5. Generate K candidates (population)
6. Render all K (parallel OfflineAudioContext)
7. Critic all K
8. Update Pareto front
9. If targeted dim improved ≥5% AND no regression >10%: accept
10. If human checkpoint reached: present Pareto front, user picks
11. Loop back to 2
```

### Why not gradient descent / DDSP?

- Requires reimplementing the synth in PyTorch (loses AdvancedSynthVoice, samples, real drums).
- Limited to what the differentiable synth supports.
- Spectral loss has known issues (phase ambiguity, transient misalignment).
- Black-box (can't explain why a param changed).

CMA-ES + Web Audio is slower per-iteration but doesn't require reimplementing, supports any technique, and is debuggable.

---

## 11. Backend architecture

### Forensic Engine — what is it?

**Verdict: Forensic Engine is the CRITIC BACKEND, not the synth engine.**

The Forensic Engine (`src/lib/studio/engine/forensic/`) is currently a test/audit infrastructure. It contains:
- `audioAnalyzer.ts` — DSP analysis (spectral, transient, dynamics, low-end)
- `qualityScore.ts` — scoring against targets
- `offlineRenderer.ts` — offline render
- `voices.ts` — voice functions
- `worlds.ts` — world configs
- `closedLoop.ts` — a closed-loop test harness

The Forensic Engine should be REPURPOSED as the Critic backend (Layer 7). Its `audioAnalyzer.ts` + `qualityScore.ts` are exactly what the critic needs. Its `closedLoop.ts` is a prototype of the loop controller.

It should NOT be the synth engine. The synth engine is AdvancedSynthVoice + multisampleGenerator + sample bank + the refactored psyLive bass/kick/hat voices.

### SuperCollider — what is it?

**Verdict: OPTIONAL and DEFERRED. Not needed for MVP. Not needed unless Web Audio quality ceiling is hit.**

The user asked: should SC be (a) final renderer only, (b) lead renderer, (c) optional backend, (d) not needed?

My answer: **(c) optional backend, deferred.** Here's the decision tree:

1. Build the MVP with Web Audio (Layers 1-9). Render via OfflineAudioContext.
2. Run the loop for 50 iterations on the lead voice.
3. If the lead's `timbral_movement` and `similarity_to_target` (Tier 1) reach commercial targets → Web Audio is sufficient. SC not needed.
4. If they plateau below targets by >20% → escalate the lead voice to SC. Port the SynthesisGraph to SC (using same params as starting point). Continue the loop in SC.
5. SC is NEVER used for live browser playback (that stays Web Audio). SC is ONLY for offline premium renders.

This defers the SC decision until we have evidence that Web Audio is insufficient. Don't commit to SC upfront.

### The backend stack

| Layer | Engine | Why |
|---|---|---|
| Live browser playback | Web Audio (AdvancedSynthVoice + samples + refactored psyLive) | Low latency, browser-native, no install |
| Loop render (inner loop) | Web Audio OfflineAudioContext (via `web-audio-api`) | Fast (~1s for 4 bars), deterministic, integrated |
| Critic DSP analysis | Python (librosa + scipy + numpy) OR TypeScript port of Forensic `audioAnalyzer.ts` | librosa is more complete; TS port is more integrated. Start with Python, port hot paths to TS if speed needed. |
| Final premium render (optional) | SuperCollider NRT | Only if Web Audio quality ceiling hit |
| Sample playback | Web Audio AudioBufferSourceNode | All paths |

---

## 12. Existing assets — what can be recycled

| Component | Existing asset | Status | Recycle plan |
|---|---|---|---|
| Musical Intelligence (Layer 1) | MusicalObservation, HarmonicState, PhraseEngine, GrooveState, TensionState, ContinuousMusicalState | Built (F17-F21) | Wire as Layer 1. Add: voice role assignment, phrase structure inference from raw MIDI. |
| Musical Physics (Layer 2) | (none) | MISSING | Build new. AcousticNote schema + VoiceGroup + BPM-aware timing calculator. ~600 LoC. |
| Performance Intelligence (Layer 3) | GrooveState (swing, microtiming, accent), PhraseDevelopmentState | Partial | Add: articulation model (legato/staccato/accent), glide/portamento, phrase-level automation. ~400 LoC. |
| Sound Intelligence (Layer 4) | AdvancedSynthVoice (4 modes), multisampleGenerator, layerEngine, wavetable.ts, sampleBank | Built, DEAD | Wire AdvancedSynthVoice as lead voice. Wire multisampleGenerator for kick/bass/hat procedural variants. Wire sampleBank for real samples. |
| Sound Genome (Layer 4 input) | SoundDNA.ts (25+ features) | Built, misused as recipe | REPURPOSE: remove synthesis mechanisms (none currently in SoundDNA, but the `timbreToRecipe` coupling must go). Use as descriptor/target. |
| Synthesis (Layer 5) | psyLive voice functions (kick/bass/lead/hat), AdvancedSynthVoice | Built | Refactor psyLive voices to accept SynthesisGraph params. AdvancedSynthVoice already does. |
| Mixing (Layer 6) | psyLive master chain (EQ, comp, limiter, reverb, delay) | Built, has bugs | Fix the 10 bugs from AUDIT-A. Add: per-voice EQ, sidechain, stereo width control. |
| Critic (Layer 7) | AudioFeatureExtractor, forensic/audioAnalyzer, commercialReference | Built, partial | Extend AudioFeatureExtractor with: masking, stereo width, timbral movement (spectral flux), phase coherence. Wire commercialReference as target DB. |
| Mutator (Layer 8) | (none) | MISSING | Build new. Per-layer mutation operators. CMA-ES (continuous), greedy (discrete), beam (structured), genetic (diversity). ~600 LoC. |
| Decision (Layer 9) | (none) | MISSING | Build new. Pareto front tracker (NSGA-II), regression detection, human checkpoint interface. ~400 LoC. |
| Reference profile extractor | ReferenceAnalyzer (in tests/reality-bridge/) | Partial | Extend to extract per-voice profiles (Kick, Bass, Lead, etc.) + Sound Genome. ~300 LoC. |
| Genre config | commercialReference.ts (has 6 genres) | Built | Extend to include genre-specific constraints + priors (not just targets). ~200 LoC. |
| Real drum samples | 130+ files in public/samples/real/ | Present, UNUSED | Wire as sample bank for kick/hats/perc/stabs. |
| Render pipeline | f22-audio-reality.ts, OfflineAudioContext | Works | Use as Layer 5 render. |
| Forensic closed loop | forensic/closedLoop.ts | Prototype | Reference for loop controller design. Don't use directly. |

### Recycle summary

- **~60% of components exist** (Musical Intelligence, Sound Intelligence voices, Mixing chain, Critic DSP, commercial targets, samples, render pipeline).
- **~40% must be built** (Musical Physics, Performance extensions, Mutator, Decision/Pareto, Reference profile extractor, Genre config extensions, Producer mode).
- **~3000-3500 LoC total to build.** Not 10,000.

---

## 13. What must be built from scratch

| Component | LoC | Why from scratch |
|---|---|---|
| AcousticNote schema + VoiceGroup | 200 | New concept. No existing representation. |
| Musical Physics layer (Layer 2) | 400 | New layer. Computes acoustic targets from MusicalNotes + genre + BPM + reference. |
| BPM-aware timing calculator | 150 | New utility. Converts musical durations (1/4, 1/8, 1/16, triplet, bar, phrase) to ms given BPM. |
| Sound Genome (repurposed SoundDNA) | 100 | Remove `timbreToRecipe` coupling. Add new fields (timbralMotion, density). |
| Sound Genome → SynthFamily codebook | 300 | New. ~30 rules mapping (Sound Genome + role + genre) → SynthFamily. |
| SynthesisGraph schema + serializer | 200 | New. The data structure that Layer 4 outputs and Layer 5 consumes. |
| Articulation model | 200 | New. Legato/staccato/accent decisions per note. |
| Phrase-level automation | 200 | New. Filter sweeps, volume swells, stereo movement over a phrase. |
| Critic extensions (masking, stereo, timbral movement, phase coherence) | 400 | Extend existing AudioFeatureExtractor. |
| CriticReport schema + Pareto logic | 300 | New. 24-dim report + Pareto front tracking. |
| Mutation operator registry | 400 | New. Per-layer mutation strategies. |
| Loop controller | 300 | New. Orchestrates Layers 4-9. |
| Producer mode candidate generator | 300 | New. Phrase-level candidate generation + diff + reason. |
| Reference profile extractor | 300 | Extend existing ReferenceAnalyzer. |
| Genre config system | 200 | Extend commercialReference with constraints + priors. |
| Human checkpoint interface | 200 | New. UI for presenting Pareto front to user. |

**Total: ~3500 LoC.** Spread across ~15 modules. Each module is 150-400 LoC. Buildable in ~4-6 weeks by one developer.

---

## 14. MVP that proves the core idea

### The user said: "don't write MVP for kick/bass/sample selector."

I respect that. The MVP should prove the CORE IDEA (MIDI → commercial audio via the full pipeline), not just one voice.

### MVP-CORE: Full pipeline, 4-bar phrase, 3 voices, 10 iterations

**Scope:**
- Input: MIDI (kick + bass + lead, 4 bars, BPM 145) + reference WAV (commercial psytrance snippet)
- Mode: PRESERVE (MIDI immutable)
- Layers 1-6: full pipeline (Musical Intelligence → Musical Physics → Performance → Sound Intelligence → Synthesis → Mixing)
- Layer 7: critic (15 Tier 1 dims + 7 Tier 2 constraints)
- Layer 8-9: mutator + decision (CMA-ES + Pareto)
- 10 iterations, no human checkpoint (auto)
- Output: baseline.wav (iteration 0) + iter10.wav + CriticReport comparison

**What it proves:**
1. The full pipeline works end-to-end (MIDI → AcousticNotes → SynthesisGraphs → mixed audio).
2. The critic measures all 15 Tier 1 dimensions reliably.
3. The loop improves Tier 1 dimensions monotonically over 10 iterations.
4. The Pareto front is non-empty (diverse candidates exist).
5. The user can hear the difference between baseline and iter10.

**What it does NOT prove:**
- Subjective musicality (Tier 3) — needs human checkpoint, not in MVP.
- Producer mode — not in MVP.
- Genre-agnosticism — MVP is psytrance only.
- SC escalation — not in MVP.

**Size:** ~1500 LoC (subset of the 3500). Reuses existing assets heavily. Buildable in ~1.5-2 weeks.

**Success criterion:**
- 12 of 15 Tier 1 dimensions improve by ≥10% from baseline to iter10.
- No Tier 1 dimension regresses.
- No Tier 2 constraint violated.
- The user listens to baseline.wav + iter10.wav and confirms iter10 sounds "more like music".

**Failure criterion (kill the architecture):**
- <6 of 15 Tier 1 dimensions improve → the loop isn't working.
- Any Tier 1 dimension regresses >20% → regression detection failed.
- User says iter10 sounds "the same" or "worse" than baseline → Critic-Goodhart. The critic is measuring the wrong things.

---

## 15. A/B/C experiment — proves the system improves MIDI → audio

### Experiment design

Same MIDI, same BPM (145), same reference WAV, same 4-bar phrase. Three renders:

| Render | What it uses | What it proves |
|---|---|---|
| **A (current)** | Current `psyLive.ts` (no Musical Physics, no critic, no loop) | Baseline. The current state. |
| **B (bugfix + wire)** | `psyLive.ts` + 10 bug fixes from AUDIT-A + AdvancedSynthVoice wired (no loop) | The "Alt 2 Phase 2" deliverable. Proves that wiring existing dead code + fixing bugs gives immediate improvement. |
| **C (full compiler)** | Full 9-layer pipeline + 10-iteration loop (MVP-CORE) | Proves the loop adds improvement BEYOND what bugfix+wiring gives. |

### Metrics (all 15 Tier 1 dimensions + reference distance)

For each render, measure:
- All 15 Tier 1 dimensions (pitch_accuracy, scale_accuracy, ..., loudness)
- Reference distance (kick, bass, lead, spectral, transient, stereo, dynamics)
- Aggregate Pareto rank (which render dominates on how many dimensions)

### Predicted outcome

| Dimension | A (current) | B (bugfix+wire) | C (full compiler) |
|---|---|---|---|
| spectral_balance | ~0.3 | ~0.6 | ~0.8 |
| transient_quality | ~0.2 | ~0.5 | ~0.7 |
| kick_bass_separation | ~0.4 | ~0.6 | ~0.8 |
| masking | ~0.3 | ~0.5 | ~0.75 |
| dynamic_range | ~0.4 | ~0.6 | ~0.7 |
| loudness | ~0.3 | ~0.6 | ~0.8 |
| reference_distance (lower=better) | ~0.8 | ~0.5 | ~0.3 |

### Decision rule

- If C > B > A on ≥12 of 15 Tier 1 dimensions AND the user's ear confirms C sounds best → **architecture validated**. Proceed to full implementation.
- If B ≈ C (bugfix+wire alone gives most of the improvement) → **the loop isn't adding value**. Reconsider whether the full compiler is worth it, or ship B and move to Producer mode / reference pipeline.
- If C > B but user says C sounds "worse" than B → **Critic-Goodhart**. The critic is gaming. Redesign critic before proceeding.

### Cost

~2 weeks (build MVP-CORE + run experiment + analyze). No new dependencies. No engine swap. Uses only existing assets + ~1500 LoC new code.

---

## 16. Failure modes

### 16.1 — Critic-Goodhart (the F22 repeat)

**What:** the loop optimizes Tier 1 dimensions while Tier 2/3 degrade. Metrics up, sound down.

**Detection:** human checkpoint says "sounds worse". Regression detection catches Tier 2 constraint violations.

**Mitigation:** Tier 2 as constraints (not targets). Human checkpoints. If it happens 3 times in a row, stop and redesign critic.

### 16.2 — Search space explosion

**What:** the loop mutates multiple layers simultaneously. Space is ~10^65. No convergence.

**Detection:** after 20 iterations, no dimension improves by >2%.

**Mitigation:** hierarchical mutation (one layer at a time). If it still doesn't converge, the codebook is too weak — add more rules or switch to learned mapping.

### 16.3 — AcousticNote over-specification

**What:** the AcousticNote carries exact values, not ranges. The SynthesisGraph has no freedom. Every candidate sounds the same.

**Detection:** Pareto front has 1 candidate (no diversity).

**Mitigation:** AcousticNote carries RANGES. The SynthesisGraph searches within the range.

### 16.4 — VoiceGroup coupling explosion

**What:** kick+bass jointly optimized. Space is 50 kick params × 50 bass params = 2500. Too slow.

**Detection:** each iteration takes >30 seconds.

**Mitigation:** alternate optimization (fix kick, search bass; fix bass, search kick). Halves the space per iteration.

### 16.5 — Codebook brittleness

**What:** the Sound Genome → SynthFamily codebook has 100+ rules. Unmaintainable. Brittle. Doesn't cover edge cases.

**Detection:** codebook fails to pick a family for >10% of (Sound Genome, role, genre) combinations.

**Mitigation:** keep codebook small (~30 rules). Let search refine within family. If codebook needs >50 rules, switch to learned mapping (train a classifier on labeled examples).

### 16.6 — Producer mode candidate explosion

**What:** PSY4 proposes 3 candidates per note. 200 notes × 3 = 600 candidates. User overwhelmed.

**Detection:** user doesn't review candidates; ships with original.

**Mitigation:** candidates are per-PHRASE, not per-note. 4 phrases × 3 candidates = 12 candidates. Manageable.

### 16.7 — Genre config complexity

**What:** each genre has 50+ config params. 8 genres = 400 params. Unmaintainable.

**Detection:** adding a new genre takes >1 day.

**Mitigation:** genre = ~15 params (constraints + priors + targets). Shared base config. Genre-specific overrides only.

### 16.8 — Render non-determinism

**What:** noise buffers regenerated per render. Critic sees different audio for same params.

**Detection:** same SynthesisGraph rendered twice gives different CriticReports.

**Mitigation:** seed all randomness. Pre-generate noise buffers. Deterministic FFT.

### 16.9 — Stale commercial targets

**What:** commercialReference targets are from 2010 psytrance. 2024 psytrance sounds different.

**Detection:** user says "this matches the target but doesn't sound modern".

**Mitigation:** targets are updateable. User can provide their own reference WAV (overrides genre targets).

### 16.10 — Loop too slow for interactive use

**What:** each iteration takes 30 seconds. 10 iterations = 5 minutes. User waits.

**Detection:** iteration time >10 seconds for a 4-bar phrase.

**Mitigation:** render at 22kHz during search, 44.1kHz for final. Parallelize renders (4 OfflineAudioContexts in parallel). Cache critic results for unchanged params.

---

## 17. Kill criteria — when to stop and not build more

These are the conditions under which I would stop and reconsider, not build more:

1. **MVP-CORE failure:** if <6 of 15 Tier 1 dimensions improve after 10 iterations → the loop fundamentally doesn't work. Stop. Don't add more layers or dimensions. Figure out why the loop isn't converging (critic? mutator? search space?).

2. **Critic-Goodhart (3 consecutive checkpoints):** if the user says "sounds worse" at 3 consecutive human checkpoints while Tier 1 metrics improve → the critic is measuring the wrong things. Stop. Redesign critic before building more.

3. **Codebook explosion:** if the Sound Genome → SynthFamily codebook needs >50 rules to cover psytrance alone → the codebook approach is wrong. Stop. Switch to learned mapping (train a classifier).

4. **Iteration time >30s for 4 bars:** if the loop can't render + criticize a 4-bar phrase in <30 seconds → too slow for interactive use. Stop. Either optimize (parallelism, lower sample rate) or accept batch mode (run overnight).

5. **Web Audio quality ceiling:** if after 50 iterations on the lead voice, `timbral_movement` and `similarity_to_target` plateau below targets by >20% → Web Audio can't reach the quality. Stop. Escalate to SuperCollider for the lead voice.

6. **Producer mode rejection rate >80%:** if the user rejects >80% of Producer mode candidates → the candidate generator is producing bad candidates. Stop. Reconsider what "improvement" means (the critic's predicted_improvement doesn't match the user's judgment).

7. **Genre porting failure:** if porting to a second genre (e.g., techno) requires rewriting >50% of the codebook → the architecture isn't genre-agnostic. Stop. The genre abstraction is wrong.

8. **Reference matching impossible:** if the loop can't get within 30% of the reference's KickProfile after 50 iterations → synth inversion isn't working for the kick. Stop. Either the kick sample bank is too small, or the critic's kick metrics are wrong, or the reference is unmatchable with available samples.

**These kill criteria are the contract. If any triggers, stop building and rethink. Don't add more code to a broken foundation.**

---

## 18. Roadmap — from MVP to full system

### Phase 0 — Prove the architecture (2 weeks)

- Build MVP-CORE (4-bar, 3 voices, 10 iterations, no human checkpoint).
- Run A/B/C experiment.
- **Gate:** if MVP-CORE passes success criteria → proceed to Phase 1. If it fails → stop, redesign.

### Phase 1 — Musical Physics + full critic (2 weeks)

- Build Musical Physics layer (Layer 2): AcousticNote schema, VoiceGroup, BPM-aware timing.
- Extend critic to all 15 Tier 1 dims + 7 Tier 2 constraints.
- Add human checkpoint interface (every 10 iterations).
- **Gate:** if critic measures all 22 dims reliably → proceed. If any dim is unreliable → demote to Tier 3 (human-only).

### Phase 2 — Sound Intelligence + codebook (2 weeks)

- Build Sound Genome (repurposed SoundDNA).
- Build Sound Genome → SynthFamily codebook (~30 rules).
- Build SynthesisGraph schema.
- Wire AdvancedSynthVoice + multisampleGenerator + sample bank.
- **Gate:** if codebook covers >90% of (Sound Genome, role, genre) combinations for psytrance → proceed. If <90% → add rules or switch to learned mapping.

### Phase 3 — Producer mode + reference pipeline (2 weeks)

- Build Producer mode candidate generator (per-phrase).
- Build reference profile extractor (WAV → target profiles).
- Wire reference profiles as optimization targets + priors.
- **Gate:** if Producer mode candidates have <80% rejection rate → proceed. If >80% → reconsider candidate generation.

### Phase 4 — Genre porting (1 week)

- Port to a second genre (techno or house).
- **Gate:** if porting requires <50% codebook rewrite → architecture is genre-agnostic. If >50% → genre abstraction is wrong, rethink.

### Phase 5 — SC escalation (conditional, 2 weeks)

- ONLY if Phase 2-3 hit Web Audio quality ceiling on lead voice.
- Port lead voice to SuperCollider NRT.
- Continue loop in SC for lead voice only.
- **Gate:** if SC lead improves `timbral_movement` by >15% over Web Audio → keep SC. If <15% → revert to Web Audio (SC not worth the complexity).

### Phase 6 — Polish + productionize (2 weeks)

- Optimize loop speed (parallelism, caching, lower sample rate during search).
- UI for human checkpoints (Pareto front visualization, A/B listening).
- Persistence (save/load SynthesisGraphs, Sound Genomes, reference profiles).
- Documentation.

**Total: ~11-13 weeks** (Phases 0-4 + 6, with Phase 5 conditional). Buildable by one developer. Each phase has a gate — if the gate fails, stop and rethink before proceeding.

---

## 19. Critical answers to the user's specific questions

### "האם הארכיטקטורה הנוכחית נכונה" (Is the current architecture correct?)

**Partially.** The 7-layer model was directionally right but had 3 structural defects: (1) Musical Physics was missing as an explicit layer, (2) Mixing was conflated with Render, (3) the critic was too thin (10 dims, no reliability tiering). The revised 9-layer model fixes these.

### "מה חסר בה" (What's missing?)

Musical Physics layer, Mixing layer (split from Render), VoiceGroup concept, AcousticNote schema, Sound Genome (repurposed), 24-dim tiered critic, genre config system, Preserve/Producer modes, reference profile extractor, BPM-aware timing, mutation operator registry, Pareto front tracker, human checkpoint interface. ~3500 LoC total to build.

### "האם Musical Physics צריך להיות layer עצמאי" (Should Musical Physics be a separate layer?)

**Yes.** It produces the AcousticNote, which is the contract between musical reasoning and synthesis reasoning. Without it, acoustic targets get hardcoded into synth voice functions (which is exactly what's wrong with current `psyLive.ts`).

### Acoustic Note definition — see §4.

### Sound Genome definition — see §5. **Challenge:** don't include synthesis mechanisms (FMIndex, FMRatio, wavetablePosition) in Sound Genome. Those belong in SynthesisGraph. Sound Genome is purely descriptive.

### Audio/Music Genome — see §6. 24 dimensions, 3 reliability tiers. The honest claim: 15 DSP dims reliable, 7 musical dims proxy, 2 subjective dims human-only.

### Preserve vs Producer modes — see §7. **Challenge:** Producer mode candidates should be per-PHRASE, not per-note.

### Reference Listening architecture — see §8. Reference is a TARGET (profiles), not a SOURCE (audio to copy).

### Critic architecture — see §9. 7 Goodhart protections. The biggest: no single scalar objective.

### Optimization architecture — see §10. Per-parameter-type optimizer. CMA-ES for continuous, greedy for discrete, beam for structured, genetic for diversity.

### Backend architecture — see §11. Forensic = critic backend. SuperCollider = optional, deferred. Web Audio for loop.

### Existing assets — see §12. ~60% exists, ~40% must be built (~3500 LoC).

### What must be built from scratch — see §13.

### MVP — see §14. MVP-CORE: full pipeline, 4-bar, 3 voices, 10 iterations. ~1500 LoC, 2 weeks.

### A/B/C experiment — see §15. A (current) vs B (bugfix+wire) vs C (full compiler). Decision rule: C > B > A on ≥12 dims + user ear confirms.

### Failure modes — see §16. 10 failure modes with detection + mitigation.

### Kill criteria — see §17. 8 kill criteria. If any triggers, stop and rethink.

### Roadmap — see §18. 6 phases, ~11-13 weeks, each with a gate.

---

## 20. The honest bottom line

### What I can prove is measurable

- 15 DSP dimensions (spectral, transient, masking, separation, dynamics, loudness, phase, stereo, pitch, distortion). These are FFT-based, deterministic, reliable.
- 7 musical dimensions as proxies (scale adherence, harmonic consistency, rhythmic accuracy, phrase coherence, tension curve, timbral movement, arrangement energy). These correlate with quality but imperfectly.

### What I cannot prove is measurable

- "Groove" — subjective. Proxy (microtiming consistency) correlates imperfectly.
- "Musicality" — subjective. No reliable proxy. "Sounds like music" requires human ear.
- Whether a lead "sounds good" vs "sounds interesting" — subjective.
- Whether a phrase "makes sense" melodically — subjective beyond simple motif recurrence.

### What this means for the architecture

The loop can reliably optimize 15 DSP dimensions. It can constrain 7 musical dimensions. It CANNOT reliably optimize musicality. **The human checkpoint is not a nice-to-have; it's structurally necessary.** Without it, the loop will optimize DSP dimensions and produce spectrally-correct but musically-dead audio. This is exactly what happened in F22.

### The honest claim

**PSY4 can take MIDI and produce audio that is:**
- Spectrally balanced (measured).
- Transiently clean (measured).
- Dynamically appropriate (measured).
- Loudness-appropriate (measured).
- K/B separated (measured).
- On-scale and in-phrase (measured).
- Approaching commercial targets (measured).
- Approaching reference profiles (measured).

**PSY4 cannot automatically guarantee:**
- "Sounds like music" (subjective — needs human).
- "Has groove" (subjective — needs human).
- "Lead is musical" (subjective — needs human).

**The system is a COMPILER (MIDI → audio with measurable quality improvement) plus a CO-PRODUCER (human checkpoint for musicality). It is NOT a fully automatic commercial-quality generator.** Anyone who claims fully automatic commercial quality is either lying or hasn't tested with real ears.

### The single sentence

**The MIDI → Commercial Audio Compiler is feasible as a 9-layer pipeline with Musical Physics as the missing bridge, a 24-dimension tiered critic with mandatory Pareto front exploration and human checkpoints, per-parameter-type optimizers (CMA-ES + greedy + beam + genetic), Web Audio for the inner loop, and SuperCollider deferred until evidence proves it's needed — but only if you accept that musicality is human-judged, not machine-measured, and the human checkpoint is structurally necessary, not optional.**

---

## HARD STOP — END OF DESIGN CHALLENGE

No code was written. No engine was installed. This document is the deliverable.

**Awaiting user decision:**
1. Approve the revised 9-layer architecture (with Musical Physics as Layer 2, Mixing split from Render)?
2. Approve the 3 challenges (Sound Genome purely descriptive, Producer candidates per-phrase, SC deferred)?
3. Approve MVP-CORE (full pipeline, 4-bar, 3 voices, 10 iterations) as the proving step?
4. Approve the A/B/C experiment (current vs bugfix+wire vs full compiler)?
5. Accept the 8 kill criteria as the contract?
6. Or redirect to a different path?

Until the user decides, no further work will be done.
