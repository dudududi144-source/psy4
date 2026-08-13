# PSY4 × Foundation — Reconciliation + Vertical Proof Design

**Status:** RECONCILIATION REPORT. No code written.
**Predecessors:**
- `PSY4-AUDIO-QUALITY-CRISIS-VERDICT.md`
- `PSY4-MIDI-COMPILER-DESIGN.md`
- `PSY4-MIDI-ACOUSTIC-COMPILER-DESIGN-CHALLENGE.md`
- Foundation RESONANCE design (external)
**Date:** 2024-08-12

This report reconciles the Foundation RESONANCE architecture (8 layers) with the PSY4 MIDI Acoustic Compiler architecture (9 layers), finds the minimum viable architecture, defines the contract, and designs the vertical A/B/C/D proof. It ends with a single verdict: BUILD / REDESIGN / STOP.

---

## 1. Minimal Agreed Architecture

### The two proposals side by side

```
Foundation RESONANCE (8 layers):
  Composition → Performance → Sound → Frequency Architecture → Renderer → Critic → Mutator → Decision

PSY4 MIDI Acoustic Compiler (9 layers):
  Musical Intelligence → Musical Physics → Performance → Sound Intelligence → Synthesis → Mixing → Critic → Mutator → Decision
```

### Reconciliation — layer by layer

| Foundation | PSY4 | Verdict | Reason |
|---|---|---|---|
| Composition | Musical Intelligence | **Foundation owns this.** PSY4 consumes. | Foundation already has `MusicalContext`, `PhrasePayload`, `MotifPayload`, `BassPatternPayload`, `DrumPatternPayload`. PSY4 must not duplicate. |
| Performance | Performance | **PSY4 owns the realization. Foundation owns the intent.** | Foundation provides tension curve, accent map, density. PSY4 realizes to velocity/microtiming/articulation. Split, not separate layer. |
| Sound | Sound Intelligence | **Collapse to one stage: VoiceSpecification builder.** | The 3-stage SoundIntent → SynthFamily → SynthesisGraph is over-engineered. A codebook lookup inside the VoiceSpecification builder is enough. |
| Frequency Architecture | Musical Physics | **NOT a layer. It's a CONTRACT field + a pure function.** | See §4. The AcousticIntent is computed by a pure function inside the VoiceSpecification builder. No separate engine. |
| Renderer | Synthesis + Mixing | **One stage: Render.** Mixing is a renderer concern for the proof. | The VoiceSpecification includes mix placement (gain, pan, sends, sidechain, EQ). The renderer applies them. No separate Mixing Intelligence layer needed for the proof. |
| Critic | Critic | **PSY4 owns.** | DSP measurement is PSY4's job. |
| Mutator | Mutator | **DEFERRED.** Not in vertical proof. | The proof has no optimizer. A/B/C/D are hand-built configurations, not search results. |
| Decision | Decision | **DEFERRED.** Not in vertical proof. | Same as Mutator. |

### The minimal architecture (3 stages, not 9)

```
FOUNDATION (owns WHAT):
  Composition (notes, harmony, phrase, motif, tension, groove intent)
    → emits CompositionEvent[] (the contract — see §2)

PSY4 (owns HOW):
  Stage 1: VoiceSpecification builder
    (CompositionEvent + context) → VoiceSpecification[]
    - computes frequency (midi → Hz)
    - realizes performance (velocity, microtiming, articulation)
    - computes acoustic targets (envelope, masking, phase — as a pure function)
    - selects synth family + params (codebook lookup)
    - selects sample (if sample-based)
    - sets mix placement (gain, pan, sends, sidechain, EQ)
  
  Stage 2: Render (deterministic)
    VoiceSpecification[] → AudioBuffer (PCM)
    - Web Audio OfflineAudioContext
    - AdvancedSynthVoice for synth voices
    - AudioBufferSourceNode for samples
    - master chain (EQ, comp, limiter, reverb, delay)
  
  Stage 3: Critic (measurement)
    AudioBuffer → CriticReport
    - 15 DSP dimensions (reliable)
    - 7 musical proxy dimensions (constraints)
    - reference distance (if reference provided)

DEFERRED (not in vertical proof):
  - Mutator (CMA-ES, greedy, beam, genetic)
  - Decision (Pareto, human checkpoint UI)
  - Producer mode (candidate generation)
  - SuperCollider integration
  - Sound Genome persistence
```

**3 stages. Not 9. Not 8.** Musical Physics is a function inside Stage 1. Mixing is a field in VoiceSpecification applied by Stage 2. Sound Intelligence is a codebook lookup inside Stage 1.

### Why this is enough

The vertical proof needs to answer ONE question: **does Foundation's music, realized through PSY4's VoiceSpecification + Render, sound better than the current psyLive.ts?**

It does NOT need:
- An optimizer (we hand-build A/B/C/D configurations)
- A mutator (no search)
- A decision layer (no Pareto)
- A Musical Physics engine (it's a function)
- A Mixing engine (it's a field in the spec)
- A Sound Intelligence engine (it's a codebook)

It needs: a contract, a VoiceSpecification builder, a renderer, a critic. That's it.

---

## 2. Foundation ↔ PSY4 Contract

### The principle

Every field in the contract must answer: **"why can't PSY4 compute this itself?"**

If PSY4 can compute it → don't pass it.
If Foundation already knows it → don't recompute it in PSY4.

### The minimal contract: `CompositionEvent`

```typescript
// ── FOUNDATION → PSY4 contract ──────────────────────────────────
// Foundation emits an array of these. PSY4 consumes them.
// Every field here is something PSY4 CANNOT infer or compute.

interface CompositionEvent {
  // ── WHAT note (compositional — Foundation owns) ──
  time: number;           // beat position (NOT seconds — Foundation owns musical time)
  midi: number;           // pitch as MIDI note number
  duration: number;       // in beats (NOT seconds — Foundation owns musical duration)
  role: VoiceRole;        // 'kick' | 'bass' | 'lead' | 'hat' | 'perc' | 'fx' | 'texture'

  // ── WHY this note (compositional context — Foundation owns) ──
  scaleDegree: number;        // 0-6 (position in current scale)
  harmonicRole: HarmonicRole; // 'root' | 'third' | 'fifth' | 'seventh' | 'passing' | 'anticipation' | 'extension'
  voiceGroup: string;         // ID for notes that belong together (e.g., "kickbass-bar3")
  phrasePosition: {           // where in the phrase this note sits
    phrase: number;           // phrase index
    bar: number;              // bar within phrase
    beat: number;             // beat within bar (0-3)
    beatStrength: 'strong' | 'medium' | 'weak' | 'ghost';
  };

  // ── HOW INTENSE (compositional intent — Foundation owns) ──
  tension: number;        // 0-1 (composition-level tension at this moment)
  accent: 'strong' | 'weak' | 'ghost';  // compositional accent intent
}
```

**10 fields. That's the entire contract.**

### Why each field MUST come from Foundation

| Field | Why PSY4 can't compute it |
|---|---|
| `time` | Compositional decision — when the note starts. PSY4 doesn't know the musical intent. |
| `midi` | Compositional decision — what pitch. PSY4 doesn't choose notes. |
| `duration` | Compositional decision — how long (in beats). PSY4 realizes to seconds, but the notated duration is compositional. |
| `role` | Compositional decision — which voice. PSY4 doesn't decide "this is the bass". |
| `scaleDegree` | Requires knowing the key + scale + current harmony. Foundation owns harmony. PSY4 would have to re-analyze. |
| `harmonicRole` | Requires knowing the current chord. Foundation owns harmony. |
| `voiceGroup` | Requires knowing which notes belong together musically. Foundation owns composition. |
| `phrasePosition` | Requires knowing the phrase structure. Foundation owns phrase. |
| `tension` | Compositional intent — Foundation's TensionState tracks this. PSY4 can't infer it from MIDI alone. |
| `accent` | Compositional intent — Foundation's GrooveState tracks this. PSY4 can't infer it reliably. |

### What PSY4 computes (NOT in the contract)

| Computed by PSY4 | How |
|---|---|
| `frequency` (Hz) | `440 * 2^((midi - 69) / 12)` — trivial |
| `velocity` (0-1) | From `accent` + `tension` + `role` + `genre` — realization |
| `microTiming` (ms) | From `groove` + `accent` + `beatStrength` — realization |
| `articulation` | From `role` + `accent` + `genre` — realization |
| `noteLength` (seconds) | From `duration` (beats) × `BPM` × `articulation` — realization |
| `envelope` (attack/decay/sustain/release) | From `role` + `BPM` + `articulation` + `genre` — acoustic compilation |
| `acousticTargets` (masking, phase, stereo) | From `role` + `voiceGroup` + `genre` — pure function |
| `synthFamily` | From `role` + `genre` + Sound Genome — codebook lookup |
| `synthParams` | From `synthFamily` + `acousticTargets` — codebook defaults |
| `sampleSelection` | From `role` + Sound Genome — greedy match |
| `mixPlacement` | From `role` + `genre` — codebook defaults |

### What Foundation already has (verified)

Foundation's `packages/material/src/types.ts` already defines:
- `MotifPayload` (notes, rootPc, scaleName)
- `BassPatternPayload` (notes, rootPc, scaleName, style)
- `DrumPatternPayload` (tracks: Record<string, RhythmPattern>)
- `RhythmPayload` (steps, hits, velocities, micros)
- `PhrasePayload` (bars with motifId, bassPatternId, drumPatternId)

The contract maps cleanly: Foundation's `PhrasePayload` → PSY4's `CompositionEvent[]`. The `RhythmPayload.velocities` and `micros` are Foundation's performance INTENT (accent map, microtiming feel). PSY4 realizes them to exact velocity/microtiming values.

---

## 3. Ownership Map

| Concern | Owner | Why |
|---|---|---|
| **Composition (notes, harmony, phrase, motif, development)** | Foundation | Compositional decision. Foundation has MusicalContext, PhrasePayload, MotifPayload. |
| **Scale / key** | Foundation | Foundation has `scales.ts`, `musical-context.ts`. |
| **Rhythm intent (accent map, density, tension curve)** | Foundation | Foundation has GrooveState, TensionState. |
| **Voice relationships (voiceGroup)** | Foundation | Compositional — which notes belong together. |
| **Musical identity (key, scale, groove behavior)** | Foundation | Compositional. |
| **Performance realization (velocity, microtiming, articulation, note length)** | PSY4 | Realization of Foundation's intent. |
| **Exact frequency realization** | PSY4 | `midi → Hz` is a PSY4 computation. |
| **Synthesis architecture (osc, filter, envelope, modulation)** | PSY4 | Sound design. |
| **Sample selection** | PSY4 | PSY4 owns the sample bank. |
| **Envelopes (attack/decay/sustain/release)** | PSY4 | Acoustic realization from BPM + role + articulation. |
| **Modulation (LFO, FM, filter movement)** | PSY4 | Synthesis concern. |
| **FX (reverb, delay, distortion)** | PSY4 | Mix concern. |
| **Stereo** | PSY4 | Mix concern. |
| **Mix (EQ, compression, balance, sidechain)** | PSY4 | Mix concern. |
| **Rendering (OfflineAudioContext)** | PSY4 | PSY4 owns the audio backend. |
| **Critic (DSP measurement)** | PSY4 | PSY4 owns the measurement. |
| **Mutator + Decision** | PSY4 (deferred) | PSY4 owns the loop. |

### No duplicate authority

- Foundation does NOT compute frequency, velocity, microtiming, articulation, envelope, synth params, or mix. It provides INTENT (accent, tension, density, groove feel).
- PSY4 does NOT compute notes, harmony, phrase structure, scale, or voice relationships. It consumes Foundation's compositional decisions.

### The split rule

> **Foundation says WHAT (notes, intent, relationships). PSY4 says HOW IT IS PERFORMED AND SOUNDS (realization, synthesis, mix, render).**

If a piece of information is compositional → Foundation.
If a piece of information is a realization of compositional intent → PSY4.

---

## 4. Musical Physics — Challenged

### The challenge

PSY4 proposed Musical Physics as Layer 2, producing AcousticNotes with: exact frequency, harmonic budget, masking budget, envelope target, phase target, stereo policy, voice group.

**Is this a real engine or a contract?**

### Verdict: it's a CONTRACT FIELD + a PURE FUNCTION. Not an engine.

**Why not an engine:**
- It has no state.
- It has no decisions (the targets are deterministic given the inputs).
- It has no iterations.
- It's a pure function: `(CompositionEvent + context + BPM + genre) → AcousticTargets`.

**What it actually is:**
- A field `acousticTargets` inside the VoiceSpecification.
- A pure function `computeAcousticTargets()` that fills it.
- ~100-150 LoC, living inside the VoiceSpecification builder.

### Minimal AcousticTargets (the contract field)

```typescript
interface AcousticTargets {
  // Frequency
  fundamentalHz: number;          // realized from midi
  register: 'sub' | 'bass' | 'low-mid' | 'mid' | 'high-mid' | 'high' | 'air';

  // Envelope (BPM-aware — computed from musical durations)
  envelope: {
    attack: number;    // seconds (from role + articulation)
    decay: number;     // seconds (from role + BPM: e.g., bass decay = 1/16 note)
    sustain: number;   // 0-1
    release: number;   // seconds
  };

  // Voice group constraints (for kick+bass co-design)
  groupConstraints?: {
    vsPartner: string;            // voiceGroup ID of the other voice
    frequencySeparation: number;  // Hz gap between fundamentals
    phaseOffset: number;          // degrees (avoid cancellation)
    maskingBudget: number;        // allowed spectral overlap 0-1
    sidechainRecovery: number;    // seconds
  };

  // Stereo policy
  stereoPolicy: 'mono' | 'narrow' | 'wide' | 'moving';
}
```

**~10 fields. Computed by a pure function. Not an engine.**

### What replaces the MusicalPhysicsEngine

A single function:

```typescript
function computeAcousticTargets(
  event: CompositionEvent,
  bpm: number,
  genre: GenreConfig,
  voiceGroupContext: Map<string, CompositionEvent[]>
): AcousticTargets
```

Called inside the VoiceSpecification builder. ~100-150 LoC. No separate module, no separate pipeline stage, no separate layer.

### The BPM-aware timing calculator

Also a pure function, not an engine:

```typescript
function musicalDurationToSeconds(duration: MusicalDuration, bpm: number): number
// MusicalDuration = '1/32' | '1/16' | '1/8' | '1/4' | '1/2' | '1/1' | '1/4T' | '1/8T' | ...
```

~50 LoC. Lives in a utility file. Called by `computeAcousticTargets` and the VoiceSpecification builder.

---

## 5. Performance Compiler — Decision

### Foundation proposes: RawScore → PerformanceScore (with microtiming, velocity, articulation, note length, glide, phrase dynamics)

### The question: Foundation or PSY4?

**Verdict: PSY4 owns the realization. Foundation owns the intent.**

### Split

| Foundation owns (INTENT) | PSY4 owns (REALIZATION) |
|---|---|
| Tension curve (0-1 per bar) | Velocity (0-127) — realized from accent + tension + role |
| Accent map (strong/weak/ghost per beat) | Microtiming (ms offsets) — realized from groove + accent |
| Density (notes per phrase) | Articulation (legato/staccato/accent) — realized from role + accent |
| Groove feel (swing amount, microtiming feel) | Note length (seconds) — realized from duration (beats) × BPM × articulation |
| Phrase dynamics (crescendo/decrescendo intent) | Glide/portamento (on/off, time) — realized from role + genre |
| | Phrase automation (filter sweeps, volume swells) — realized from tension curve |

### The rule

> If it's a 0-1 intent or a categorical feel → Foundation.
> If it's an exact value in ms/Hz/0-127 → PSY4.

Foundation's `RhythmPayload.velocities` and `micros` are borderline — they're already arrays of numbers. But they represent INTENT (the groove's velocity contour and microtiming feel), not exact realizations. PSY4 scales/realizes them based on the current voice's dynamic range and the genre's articulation conventions.

### The Performance Compiler is a pure function

```typescript
function realizePerformance(
  event: CompositionEvent,
  groove: GrooveConfig,
  genre: GenreConfig,
  bpm: number
): PerformedEvent
```

~200-300 LoC. Lives inside the VoiceSpecification builder. Not a separate engine.

---

## 6. Sound Compiler — Simplified

### The challenge

PSY4 proposed: SoundIntent → SynthFamily → SynthesisGraph (3-stage abstraction).

The user prefers: PerformanceEvent → VoiceSpecification (simpler).

### Verdict: VoiceSpecification only. No 3-stage abstraction.

**Why the 3-stage abstraction is over-engineered for the proof:**
- SoundIntent → SynthFamily is a codebook lookup (a few if/else rules). It doesn't need a pipeline stage.
- SynthFamily → SynthesisGraph is a param fill (default params per family). It doesn't need a pipeline stage.
- The Sound Genome is a DESCRIPTOR used by the codebook, not a pipeline stage.

### Minimal VoiceSpecification

```typescript
interface VoiceSpecification {
  // ── SOURCE: what produces the sound ──
  source:
    | { type: 'sample'; path: string; playbackRate: number }
    | { type: 'synth'; graph: SynthGraph }
    | { type: 'hybrid'; samplePath: string; synthLayer: SynthGraph; blend: number };

  // ── SYNTH GRAPH (if synth/hybrid) ──
  synthGraph?: SynthGraph;

  // ── PERFORMANCE (realized by PSY4) ──
  performance: {
    frequency: number;       // Hz
    velocity: number;        // 0-1
    duration: number;        // seconds
    microTiming: number;     // seconds offset
    articulation: 'legato' | 'staccato' | 'accent' | 'normal';
  };

  // ── ACOUSTIC TARGETS (computed by pure function) ──
  acousticTargets: AcousticTargets;

  // ── MIX PLACEMENT ──
  mix: {
    channel: string;         // 'kick' | 'bass' | 'lead' | 'hat' | 'perc' | 'fx'
    gain: number;            // 0-1
    pan: number;             // -1 to 1
    sends: { reverb: number; delay: number };
    sidechain?: { source: string; amount: number; recovery: number };
    eq?: { low: number; mid: number; high: number };  // dB
  };
}

interface SynthGraph {
  oscillators: Array<{
    type: OscillatorType;
    frequency: number;       // Hz (or ratio for FM modulator)
    detune: number;          // cents
    role: 'carrier' | 'modulator' | 'unison';
  }>;
  filter: {
    type: BiquadFilterType;
    cutoff: number;          // Hz
    Q: number;
    envelope: { amount: number; attack: number; decay: number; sustainLevel: number };
  };
  amplifier: {
    envelope: { attack: number; decay: number; sustain: number; release: number };
  };
  modulation: Array<{
    source: 'lfo' | 'envelope' | 'audio-rate';
    target: 'pitch' | 'filterCutoff' | 'amplitude' | 'fmDepth';
    depth: number;
    rate: number;            // Hz (for LFO)
  }>;
  saturation: { amount: number; character: number };  // 0-1, 0=soft 1=hard
  stereo: { width: number; motion: number };  // 0-1
}
```

**One structure. ~30-40 fields.** Built by a pure function from CompositionEvent + context. No multi-stage pipeline.

### The codebook (lives inside the builder, not as a separate layer)

```typescript
function selectSynthFamily(role: VoiceRole, genre: GenreConfig, soundGenome?: SoundGenome): SynthFamily {
  // ~20-30 if/else rules. Examples:
  if (role === 'kick') return 'sample';           // always sample-based
  if (role === 'hat') return 'sample';            // always sample-based
  if (role === 'bass') return 'subtractive';      // 3-layer subtractive
  if (role === 'lead' && genre === 'psytrance') {
    if (soundGenome?.metallic > 0.6) return 'fm';
    if (soundGenome?.brightness > 0.7) return 'wavetable';
    return 'supersaw';
  }
  // ... ~20 more rules
}
```

~100-150 LoC. A function, not a layer.

---

## 7. Reference — Target, Constraint, or Both?

### Verdict: BOTH. Split across 3 identity layers.

The user's 3-way split is correct:

### Musical Identity (Foundation's domain)

- key, scale, harmony, groove, phrase behavior
- **Comes from the MIDI itself** (or Foundation's analysis if no MIDI).
- Reference teaches CHARACTERISTICS (e.g., "this reference is in C minor, phrygian flavor, 145 BPM, 4-on-floor with rolling bass").
- Used as: **composition prior** (if PSY4 is generating) or **validation** (if MIDI is given).

### Sonic Identity (PSY4's domain — Sound Genome target)

- brightness, harmonicity, transient character, spectral distribution, timbral motion
- Extracted from reference WAV via `AudioFeatureExtractor`.
- Becomes the **Sound Genome target** for each voice.
- Used as: **optimization target** (search synth params to match) and **codebook input** (select synth family based on descriptors).

### Mix Identity (PSY4's domain — mix targets)

- low-end balance, dynamics, stereo, loudness, masking
- Extracted from reference WAV.
- Becomes the **mix targets** for the critic.
- Used as: **constraint** (mix must be within these ranges) and **optimization target** (match the reference's spectral balance, DR, loudness).

### Reference provides characteristics, not source audio

The reference is NEVER copied. It's analyzed into:
- `MusicalIdentityProfile` (key, scale, BPM, groove feel) — used by Foundation or as validation.
- `SonicIdentityProfile` (per-voice Sound Genome) — used by PSY4's codebook + search.
- `MixIdentityProfile` (spectral balance, DR, loudness, stereo, masking) — used by PSY4's critic.

For the vertical proof: reference is OPTIONAL. If provided, it sets Sonic + Mix targets. If not, PSY4 uses `commercialReference.ts` genre targets.

---

## 8. Critic — Permission Matrix (Critic is NOT a Composer)

### The hierarchy of fixes

For a problem like `KICK_BASS_OVERLAP`:

1. **mix/sidechain** (auto) — duck bass when kick hits
2. **synth envelope** (auto) — shorten bass decay
3. **frequency allocation** (auto) — move kick sub or bass root within constraints
4. **duration** (conditional) — shorten bass note within notated duration
5. **timing** (conditional) — microtiming offset (not note position)
6. **musical rewrite** (human only) — change the notes

**The critic never jumps to step 6.** It escalates one level at a time.

### Permission matrix

| Parameter | Auto | Conditional | Human | Notes |
|---|---|---|---|---|
| **pitch** | ❌ | ❌ | ✅ | Compositional. Never auto-changed. |
| **scale** | ❌ | ❌ | ✅ | Compositional. Never auto-changed. |
| **timing (note position)** | ❌ | ❌ | ✅ | Compositional. Note start time is sacred. |
| **timing (microtiming)** | ✅ | — | — | Realization. PSY4 can adjust ms offsets. |
| **velocity** | ✅ | — | — | Realization. PSY4 can adjust 0-127. |
| **duration (within notated)** | ✅ | — | — | Articulation. PSY4 can shorten note within notated duration. |
| **duration (change notation)** | ❌ | ❌ | ✅ | Compositional. |
| **articulation** | ✅ | — | — | Realization. PSY4 chooses legato/staccato/accent. |
| **synthesis (family)** | ✅ | — | — | PSY4's job. Codebook selects. |
| **synthesis (params)** | ✅ | — | — | PSY4's job. Search optimizes. |
| **sample selection** | ✅ | — | — | PSY4's job. |
| **FX** | ✅ | — | — | Mix concern. |
| **EQ** | ✅ | — | — | Mix concern. |
| **sidechain** | ✅ | — | — | Mix concern. |
| **stereo** | ✅ | — | — | Mix concern. |
| **harmony** | ❌ | ❌ | ✅ | Compositional. |
| **arrangement** | ❌ | ❌ | ✅ | Compositional. |

### The rule

> **The critic can auto-mutate: realization (velocity, microtiming, articulation, duration-within-notation), synthesis (family, params, samples), and mix (FX, EQ, sidechain, stereo).**
>
> **The critic CANNOT auto-mutate: composition (pitch, scale, note position, harmony, arrangement, notated duration).**
>
> **Conditional changes (duration within notation, microtiming) are allowed but must not change the musical identity.**

This prevents the critic from becoming a composer. The critic improves HOW the music sounds, not WHAT the music is.

---

## 9. Backend Decision

### Candidates

| Backend | Quality | Controllability | Deterministic | Iteration speed | Browser viable | Live viable | Accepts VoiceSpec? |
|---|---|---|---|---|---|---|---|
| Current psyLive | Low | Medium | ✅ | Fast (1s) | ✅ | ✅ | ❌ (hardcoded) |
| Forensic engine | Medium | Low | ✅ | Medium | ❌ | ❌ | ❌ (test infra) |
| psy4-engine.js (worklet) | Medium | Medium | ✅ | Medium | ✅ | ✅ | ❌ (dead) |
| **AdvancedSynthVoice + samples + refactored psyLive** | **Medium-High** | **High** | **✅** | **Fast (1s)** | **✅** | **✅** | **✅ (after refactor)** |
| Foundation DSP (PolyBLEP/Moog) | High | High | ✅ | Slow (AudioWorklet) | ⚠️ | ⚠️ | ❌ (needs wrapper) |
| SuperCollider | Highest | High | ✅ | Fast (0.3s NRT) | ❌ | ❌ | ✅ (via OSC) |

### Verdict: **ONE backend for the vertical proof — Web Audio (AdvancedSynthVoice + samples + refactored psyLive).**

**Why:**
- **Quality**: Medium-High. AdvancedSynthVoice has FM/wavetable/supersaw for lead. Real samples for kick/hats/perc. Refactored bass voice. Enough to prove the architecture.
- **Controllability**: High. All params are TypeScript-accessible. VoiceSpecification maps directly to Web Audio nodes.
- **Deterministic**: Yes. OfflineAudioContext from `web-audio-api` is deterministic (proven in F22).
- **Iteration speed**: Fast. ~1s for 4 bars. Enough for A/B/C/D comparison.
- **Browser viable**: Yes. Same code runs in the browser for live playback.
- **Live viable**: Yes. No server round-trip.
- **Accepts VoiceSpecification**: Yes, after refactoring voice functions to accept specs (the refactor IS part of the proof).

**Why NOT SuperCollider**: deferred until evidence proves Web Audio is insufficient. The proof doesn't need SC's higher quality ceiling — it needs to prove the CONTRACT + PERFORMANCE + ACOUSTIC COMPILATION improves the sound. If Web Audio's quality is the bottleneck, that's a separate finding (escalate to SC after the proof).

**Why NOT Forensic engine**: it's the CRITIC backend (audioAnalyzer.ts, qualityScore.ts), not the synth backend. Don't conflate.

**Why NOT Foundation DSP (PolyBLEP/Moog)**: requires AudioWorklet, which is fragile and complex. Not needed for the proof. The proof uses standard Web Audio nodes (OscillatorNode, BiquadFilterNode, AudioBufferSourceNode, WaveShaperNode).

### What "refactored psyLive" means for the proof

The current `psyLive.ts` voice functions (`kick()`, `bass()`, `lead()`, `hat()`) are refactored to:
1. Accept a `VoiceSpecification` instead of hardcoded params.
2. Read synth params, sample path, mix placement, performance, acoustic targets from the spec.
3. Build the Web Audio graph from the spec.
4. Connect to the master chain.

~200-300 LoC of refactoring. The voice functions' DSP logic stays the same; only the param source changes.

---

## 10. Vertical A/B/C/D Experiment

### Setup

- **Same MIDI** (4 bars, kick + bass + lead, BPM 145, preset "rolling_bass" pattern)
- **Same seed** (all randomness seeded)
- **Same BPM** (145)
- **Same arrangement** (4 bars, no variations)
- **Same duration** (~7.9 seconds)
- **Same reference WAV** (commercial psytrance snippet, for metrics only)

### The 4 renders

| Render | What it uses | What it proves |
|---|---|---|
| **A (current)** | Current `psyLive.ts` as-is. No contract, no VoiceSpecification, no performance compiler, no acoustic compilation. | Baseline. The current state. |
| **B (contract + backend)** | Foundation → `CompositionEvent[]` contract → PSY4 VoiceSpecification builder (using AdvancedSynthVoice for lead, real samples for kick, refactored bass) → Render. **NO performance compiler** (velocities/microtiming from defaults). **NO acoustic targets** (envelope params from codebook defaults). | Does the contract + better synthesis backend help? |
| **C (B + performance)** | B + Performance Compiler (velocity realization from accent+tension, microtiming from groove, articulation from role). | Does performance realization help? |
| **D (C + acoustic)** | C + Acoustic Compilation (envelope targets from BPM + role, frequency allocation, masking budgets, kick/bass co-design via VoiceGroup). | Does acoustic compilation help? |

### What each render isolates

```
B - A = contract + backend improvement (VoiceSpecification + AdvancedSynthVoice + samples)
C - B = performance realization improvement (velocity + microtiming + articulation)
D - C = acoustic compilation improvement (BPM-aware envelopes + masking + kick/bass co-design)
```

### No optimizer

A/B/C/D are **hand-built configurations**, not search results. The VoiceSpecifications for B/C/D are built once (deterministically) from the contract + codebook defaults. No CMA-ES, no Pareto, no mutation. This isolates the architecture from the optimizer.

### Implementation scope

| Render | LoC to build | Reuses |
|---|---|---|
| A | 0 (current psyLive) | — |
| B | ~400 LoC | Contract types + VoiceSpecification builder (codebook defaults) + AdvancedSynthVoice + sample bank + refactored voice functions |
| C | +200 LoC | Performance Compiler (pure function) |
| D | +200 LoC | Acoustic Compilation (pure function for envelope/masking/phase targets) |
| **Total** | **~800 LoC** | Existing assets heavily reused |

**~800 LoC. Not 3500. Not 1500.** The proof is minimal.

---

## 11. Metrics

### For each A/B/C/D, measure:

#### DSP-reliable (15 dims)

| Metric | Method | Target (psytrance) |
|---|---|---|
| pitch_correctness | YIN/pYIN vs notated | >95% |
| scale_correctness | notes on scale % | >98% |
| kick_clarity | transient-to-body ratio (crest) | 3-6 |
| bass_definition | spectral centroid + harmonic count | 180-400 Hz centroid |
| kick_bass_separation | gap RMS between kick and bass | <0.01 |
| masking | frequency overlap 40-200Hz | <20% overlap |
| transient_quality | onset strength + attack time | onset >0.5, attack 0.5-3ms |
| spectral_balance | 7-band energy vs commercialReference target | within 20% |
| midrange_density | 200-2500Hz energy % | 8-18% |
| dynamic_range | DR meter | 6-9 dB |
| loudness | LUFS | -10 to -14 |
| stereo_width | mid-side above 200Hz | >0.3 |
| phase_coherence | cross-correlation kick/bass | <0.3 (no cancellation) |
| timbral_movement | spectral flux over time | >0.4 |
| reference_similarity | spectral distance to reference | <0.3 |

#### Proxy musical (5 dims, constraints)

| Metric | Method |
|---|---|
| groove | microtiming consistency (std of swing offsets) |
| phrase_coherence | motif recurrence + contour shape |
| harmonic_consistency | chord tones on strong beats % |
| rhythmic_accuracy | onset detection vs grid |
| arrangement_energy | energy contour over time |

#### Human listening checkpoint

- A/B/C/D presented as unlabeled WAVs.
- User listens and ranks: "which sounds most like commercial psytrance?"
- User identifies: "which has the best kick? bass? lead? mix?"
- User verdict: "is D significantly better than A?"

**The system CANNOT declare "commercial" just because DSP improved.** The human ear is the final critic.

---

## 12. Pass / Fail Criteria

### Contract fails if: B ≈ A

- B does not improve ≥3 DSP metrics by ≥10% over A.
- The contract + better backend doesn't help.
- **Action**: redesign the contract. The VoiceSpecification or the backend is wrong.

### Performance fails if: C ≈ B

- C does not improve ≥2 DSP metrics by ≥5% over B.
- Performance realization doesn't help.
- **Action**: skip performance realization. The codebook defaults are good enough. Move directly to acoustic compilation.

### Acoustic compilation fails if: D ≈ C

- D does not improve ≥2 DSP metrics by ≥5% over C.
- Acoustic compilation doesn't help.
- **Action**: skip acoustic compilation. The BPM-aware envelopes and masking budgets don't matter. The architecture is over-engineered.

### Critic fails if: metrics improve but ear says worse

- DSP metrics improve A→B→C→D but the user says "D sounds worse than A".
- **Action**: Critic-Goodhart. The critic is measuring the wrong things. Redesign critic before proceeding. STOP.

### Backend fails if: no renderer can produce D deterministically and fast

- OfflineAudioContext can't render D in <5 seconds, OR
- Same VoiceSpecification rendered twice gives different audio.
- **Action**: fix the renderer or switch backend. If Web Audio can't do it, escalate to SuperCollider.

### Overall pass

- B > A on ≥3 DSP metrics by ≥10%
- C > B on ≥2 DSP metrics by ≥5%
- D > C on ≥2 DSP metrics by ≥5%
- User ear confirms D sounds significantly better than A
- D meets ≥10 of 15 DSP target ranges
- No critic-ear divergence

**If all pass → architecture validated. Proceed to full implementation (mutator, decision, producer mode, optimizer).**

**If any fail → stop. Redesign or kill.**

---

## 13. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **B ≈ A** (contract doesn't help) | Medium | High | The contract + VoiceSpecification must produce different audio than current psyLive. If the codebook defaults are too similar to psyLive's hardcoded params, B will sound like A. Mitigation: make B's codebook defaults deliberately different (use AdvancedSynthVoice FM mode for lead, real samples for kick). |
| **C ≈ B** (performance doesn't help) | Medium | Medium | Performance realization (velocity/microtiming/articulation) may have small effect if the synth voices are already short. Mitigation: ensure the performance changes are audible (e.g., velocity affects filter brightness, not just amplitude). |
| **D ≈ C** (acoustic compilation doesn't help) | Low | Medium | Acoustic compilation (BPM-aware envelopes, masking budgets) should have measurable effect on kick/bass separation. If it doesn't, the masking budgets aren't being enforced in the synth params. Mitigation: ensure acoustic targets actually constrain the synth params (e.g., bass decay = 1/16 note, not hardcoded 65ms). |
| **Critic-ear divergence** | Medium | High | DSP metrics improve but user says worse. Mitigation: include human checkpoint. If divergence occurs, STOP and redesign critic. |
| **AdvancedSynthVoice is rotten** | Medium | High | AdvancedSynthVoice was last touched in F15. May have bugs. Mitigation: test it in isolation before the proof. If broken, use a simpler lead voice (3-osc unison with FM via AudioParam). |
| **Sample bank quality** | Low | Medium | The 130+ real samples may not all be commercial quality. Mitigation: curate the best 20-30 for the proof. |
| **Render non-determinism** | Low | High | If OfflineAudioContext has nondeterminism, A/B/C/D comparison is invalid. Mitigation: seed all randomness, pre-generate noise buffers, verify determinism by rendering B twice and comparing. |
| **Contract too thin** | Medium | High | If the 10-field contract doesn't carry enough context, PSY4 can't make good decisions. Mitigation: if B fails, check whether the contract is missing a field (e.g., `harmonicRole` might be needed for filter tuning). |
| **Scope creep** | High | Medium | Temptation to add optimizer, producer mode, SC integration during the proof. Mitigation: hard scope freeze. The proof is A/B/C/D only. Nothing else. |

---

## 14. What's Out of Scope

- ❌ CMA-ES / Bayesian optimizer
- ❌ Pareto optimizer
- ❌ SuperCollider integration
- ❌ Sound Genome persistence
- ❌ CompositionEngine changes (Foundation stays as-is)
- ❌ UI changes
- ❌ Producer mode (candidate generation)
- ❌ Big refactor of psyLive (only refactor voice functions to accept VoiceSpec)
- ❌ 9 engines / 9 layers
- ❌ MusicalPhysicsEngine (it's a function, not an engine)
- ❌ Sound Intelligence engine (it's a codebook lookup)
- ❌ Mixing Intelligence engine (it's a field in VoiceSpec)
- ❌ Reference listening pipeline (deferred)
- ❌ Genre porting (proof is psytrance only)
- ❌ Live browser playback integration (proof is offline render only)
- ❌ Human checkpoint UI (proof uses manual WAV listening)

---

## 15. Kill Criteria

1. **B ≈ A**: contract + backend doesn't help → redesign contract or change backend.
2. **C ≈ B AND D ≈ C**: neither performance nor acoustic compilation helps → the architecture is over-engineered. Ship B (contract + backend) and stop.
3. **Critic-ear divergence**: metrics up, ear down → critic is broken. STOP. Redesign critic.
4. **AdvancedSynthVoice broken AND can't be fixed in 1 day**: fall back to simpler lead voice. If simpler voice also fails → backend is the bottleneck. Escalate to SC.
5. **Render non-determinism can't be fixed**: A/B/C/D comparison invalid. STOP. Fix renderer.
6. **Proof takes >2 weeks**: scope creep. STOP. Re-scope to minimal A/B/C/D.

**If any kill criterion triggers, stop and reconsider before building more.**

---

## 16. Roadmap (post-proof, if validated)

| Phase | Scope | Duration | Gate |
|---|---|---|---|
| **Phase 0** | Vertical proof (A/B/C/D) | 1-2 weeks | D > A on metrics + ear |
| **Phase 1** | Add Critic (full 24-dim) + Mutator (CMA-ES) + Decision (Pareto) | 3 weeks | Loop improves D further |
| **Phase 2** | Add Producer mode (per-phrase candidates) | 2 weeks | User accepts >50% of candidates |
| **Phase 3** | Add Reference pipeline (WAV → profiles → targets) | 2 weeks | Reference match <0.3 distance |
| **Phase 4** | Genre porting (techno/house) | 1 week | <50% codebook rewrite |
| **Phase 5** | SC escalation (conditional, lead voice only) | 2 weeks | SC improves lead by >15% |
| **Phase 6** | Polish + live integration + UI | 2 weeks | — |

**Total post-proof: ~12-14 weeks.** But only if Phase 0 passes. If Phase 0 fails, stop.

---

## 17. Verdict

### BUILD

**Build the vertical proof only.** Not the full system. Not 9 layers. Not 3500 LoC.

**What to build (~800 LoC):**
1. `CompositionEvent` contract types (~50 LoC)
2. `VoiceSpecification` types (~100 LoC)
3. VoiceSpecification builder (codebook + performance realization + acoustic targets as pure functions) (~300 LoC)
4. Refactored voice functions (accept VoiceSpec instead of hardcoded params) (~200 LoC)
5. Render script (OfflineAudioContext, produces A/B/C/D WAVs) (~100 LoC)
6. Critic script (librosa analysis, produces metrics table) (~50 LoC, Python)

**What NOT to build:**
- Everything in §14 (out of scope).

**Why BUILD, not REDESIGN:**
- The architecture is sound but was over-engineered in previous proposals. The reconciliation collapses 9 layers to 3 stages (VoiceSpecification → Render → Critic) with Musical Physics as a function, not a layer.
- The contract is minimal (10 fields, each justified).
- The backend is Web Audio + AdvancedSynthVoice + samples (all existing).
- The proof is ~800 LoC (not 3500).
- The proof has clear pass/fail criteria and kill criteria.
- The proof isolates contract / performance / acoustic compilation as separate A/B/C/D steps, so we learn exactly what each contributes.

**Why BUILD, not STOP:**
- The current psyLive.ts produces test-tone-quality audio (proven by AUDIT-A). Something must change.
- The contract + VoiceSpecification + better backend (B) is almost certain to improve over A (we're using real samples + AdvancedSynthVoice FM/wavetable instead of hardcoded 3-osc unison).
- The question is not "should we change" but "how much does each layer contribute" — and the proof answers that.

**The single sentence:**

> Build the vertical A/B/C/D proof (~800 LoC, 1-2 weeks) using the minimal 3-stage architecture (VoiceSpecification builder → Render → Critic), the 10-field CompositionEvent contract, Web Audio + AdvancedSynthVoice + samples as the single backend, and 15 DSP metrics + human listening as the critic — with clear pass/fail and kill criteria that determine whether the contract, performance realization, and acoustic compilation each contribute measurable improvement, and only if the proof passes, proceed to the full system.

---

## HARD STOP — END OF RECONCILIATION

No code was written. No engine was installed. This document is the deliverable.

**Awaiting user decision:**
1. Approve the minimal 3-stage architecture (VoiceSpecification → Render → Critic)?
2. Approve the 10-field CompositionEvent contract?
3. Approve the ownership map (Foundation = WHAT, PSY4 = HOW)?
4. Approve Musical Physics as a function (not an engine)?
5. Approve VoiceSpecification (not SoundIntent → SynthFamily → SynthesisGraph)?
6. Approve the critic permission matrix (auto-mutate realization/synthesis/mix; never auto-mutate composition)?
7. Approve Web Audio + AdvancedSynthVoice + samples as the single backend for the proof?
8. Approve the A/B/C/D vertical experiment?
9. Accept the pass/fail and kill criteria?
10. Approve BUILD (the vertical proof only)?

Until the user decides, no further work will be done.
