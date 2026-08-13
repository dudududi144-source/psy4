# PSY4 — Musical WHAT-Layer Design Audit

**Status:** DESIGN AUDIT ONLY. No code. No Foundation changes. No renderer changes. No rerender. No architecture approval.
**Predecessors:**
- V1 frozen experiment: `validation/results/effect-report.md`
- Psytrance production research: `audit-reports/RESEARCH-A-PSYTRANCE-MUSICAL-MODEL.md`
**Date:** 2024-08-13

This document answers ONE question:

> **What is the minimum but musically complete WHAT-layer required for PSY4 to produce a convincing, full psytrance track without Foundation making synthesis/mixing decisions?**

---

## Section 1 — Executive Diagnosis

### Is the current Foundation a complete musical model or a skeleton?

**It is a skeleton.** Based on independent reading of Foundation's actual types (`MusicalContext`, `Motif`, `MotifNote`, `PhrasePlan`, `SectionPlan`, `Material`, `MaterialMetadata`, protocol `MusicalEvent`), cross-referenced against the RESEARCH-A psytrance production analysis:

**What Foundation currently describes (the skeleton):**
- Musical identity: tonic, scaleName, bpm, beatsPerBar, octave
- Time: beatPosition, barPosition, phrasePosition
- Harmonic context: harmonicContext (chord pitch classes), density, energy, tension, sectionRole, repetitionPressure, noveltyPressure
- Motif: notes (step, midi, velocity, durationSteps, accent), contour, intervals, pitchClasses, register, rhythmicDensity, accentPattern, transformHistory
- Phrase: PhraseSlot (barIndex, PhraseRole, motifId, transformId, density, energy) — 8 roles (INTRO/STATEMENT/DEVELOPMENT/RESPONSE/BUILD/RELEASE/TRANSITION/RESOLUTION)
- Section: SectionSlot (barIndex, SectionRole, density, energy, novelty, registerTarget, phrasePlan) — 8 roles (ESTABLISH/REPEAT_VARIATION/DEVELOPMENT/CONTRAST/RETURN/ESCALATION/PEAK/RELEASE)
- Material: typed payloads (motif, rhythm, bass-pattern, drum-pattern, fill, fx-gesture, texture, preset) with metadata (role, style, tempoRange, keyCompatibility, energy, novelty)
- Protocol events: BeatEvent, SectionEvent, EnergyEvent, DropEvent, NoteEvent, PatternEvent

**What is missing (the gaps):**

| Gap | Evidence |
|---|---|
| **Role set is implicit, not explicit** | `MotifNote` has no `role` field. `Material.metadata.role` is a free string. There is no canonical, extensible role taxonomy. Foundation's drum-pattern tracks use string names ("kick", "hat") with no semantic role hierarchy. |
| **Only 4 roles are named in practice** | The V1 experiment used kick, bass, lead, hat. The RESEARCH-A analysis identifies ~12-14 roles across 4 functional groups (rhythmic foundation, midrange melodic, sustained harmonic/texture, transitions/glue). |
| **No role lifecycle** | There is no representation of "role X enters at bar 32, develops through 32-48, disappears during breakdown, returns transformed at the drop." SectionPlan has density/energy/novelty curves but no per-role activity mask. |
| **No role interactions** | Kick and bass are two separate material payloads. There is no representation of their timing lock, pitch co-tuning, energy coupling, or sidechain relationship. The "kickbass" as a coupled system is not modeled. |
| **No negative space model** | SectionPlan density=0 means "low density" but doesn't say WHICH roles are inactive. A breakdown (kick OFF, bass OFF, atmosphere HIGH) cannot be distinguished from a sparse groove (kick ON, bass ON, lead SPARSE) at the density level alone. |
| **No midrange melodic material** | The V1 midrange_density = 3-4% hard-fail across ALL variants (including A, the unmodified control). RESEARCH-A confirms this is a MUSICAL MODEL GAP: the WHAT-layer doesn't name the roles that produce midrange content (acid, plucks/stabs, counterlines, mid percussion, pads/drones, textures, FX). No mixing change can close a 3% → 8-18% gap; the missing mass is missing role categories. |
| **No motif development operators** | Motif has `transformHistory: string[]` (a record of what was applied) but no forward-looking development plan ("motif X will be varied by pitch mutation every 4 bars, transposed up an octave at the drop, fragmented during the breakdown"). |
| **No arrangement section model** | SectionRole (ESTABLISH/REPEAT_VARIATION/...) describes bar-level roles, not track-level sections (intro/build/drop/breakdown/re-entry/outro). There is no "drop" section type, no "breakdown" section type. |
| **No psytrance style profile** | "psytrance" is captured only as BPM + scale + kick/bass. RESEARCH-A shows psytrance is a musical constraint profile: rolling low-end grammar, hypnotic repetition, evolving motifs, layered percussion, tension/release, psychedelic texture, arrangement conventions. None of this is in the current model. |

### What's missing at the WHAT layer?

1. **Role ontology** — extensible, semantic, not instrument-enum
2. **Role lifecycle** — enter/sustain/vary/transform/thin/mute/re-enter/exit
3. **Role interactions** — especially kick↔bass as coupled engine
4. **Negative space** — per-role activity mask per section
5. **Midrange melodic material** — acid, plucks, counterlines, mid percussion
6. **Texture/atmosphere layer** — sustained harmonic content
7. **FX/transition layer** — risers, sweeps, impacts
8. **Motif development plan** — forward-looking, not just transformHistory
9. **Arrangement section model** — intro/build/drop/breakdown/re-entry/outro
10. **Psytrance style profile** — musical constraints beyond BPM/scale

### What's missing at the HOW layer?

This audit is about the WHAT-layer. The HOW-layer (PSY4) gaps are separate. But for completeness:
- Synthesis architecture selection (FM/wavetable/subtractive/sample per role)
- Sample selection
- Envelope/filter/modulation realization
- Mixing (EQ, compression, sidechain, stereo)
- Mastering

These are PSY4's job. Foundation should NOT acquire them.

### Which V1 findings look like composition/model gaps?

| V1 finding | Composition/model gap? | Why |
|---|---|---|
| midrange_density 3-4% (all variants, including A) | **YES — musical model gap** | The WHAT-layer doesn't emit midrange events because it doesn't name midrange roles. |
| masking 0.58-0.62 (B-E) vs 0.40-0.45 (A) | **Partially model gap** | The WHAT-layer doesn't describe kick↔bass interaction, so PSY4 can't co-design them. But the hybrid kick (sample+synth sub) also added low-end overlap — that's a HOW issue. |
| timbral_movement 0.88-0.97 (all variants) | **Partially model gap** | No texture/atmosphere/FX layer in the WHAT means no sustained spectral content to stabilize the spectral flux. But excessive flux also reflects synthesis choices (FM modulation depth). |
| pitch_correctness 0.50 (B-E) vs 0.71 (A) | **HOW gap** | AdvancedSynthVoice FM lead deviates from clean semitones. This is a synthesis realization issue, not a model gap. |
| dynamic_range 0.00 (all variants) | **HOW gap** | Crest factor outside 6-9 dB for all renders — compression/mastering issue. |
| loudness 0.45 (D/E) vs 0.50 (A) | **HOW gap** | Velocity scaling reduced level. Performance realization issue. |

### Which V1 findings look like renderer/acoustic gaps?

- pitch_correctness (FM lead pitch deviation) — HOW
- dynamic_range (no compression glue) — HOW
- loudness (velocity scaling) — HOW
- B-E masking increase vs A (hybrid kick low-end overlap) — HOW

### What must NOT be inferred from the experiment?

Per the frozen protocol and user instruction:
- **No architectural inference from H2 (C ≡ B).** "Under the frozen implementation, C and B produced identical output" is the only permitted claim. It does NOT prove CompositionEvent is invalid.
- **No inference that the renderer "needs fixing."** The V1 results are accepted as-is.
- **No inference that V1's failure means the approach is wrong.** V1 may have failed because the WHAT-layer is a skeleton, OR because the HOW-layer is primitive, OR both. The experiment cannot distinguish these.
- **No overfitting to V1.** This audit must NOT be "add fields until V1 passes." It must be "what is the correct musical model, independent of V1."

---

## Section 2 — Complete Musical Ontology

A minimal but complete ontology for expressing a full psytrance track. Each entity is a WHAT-layer concept. None imply synthesis decisions.

### 2.1 Identity

**What Foundation must know about the track's musical identity:**

| Field | Type | Purpose |
|---|---|---|
| tempo | number (BPM) | Tempo |
| meter | { beatsPerBar, subdivision } | Time signature (4/4 default, but extensible) |
| tonic | pitch class 0-11 | Key center |
| scaleName | string | Scale/mode (phrygian-dominant, minor, etc.) |
| stylisticFamily | string | "psytrance", "techno", "trance", etc. |
| subtypeProfile | string | "full-on", "progressive", "dark", "goa", "forest" (for psytrance) |
| harmonicLanguage | string | "functional", "modal", "drone-based" |
| motifIdentity | Map<role, MotifId[]> | Which motifs are the "identity motifs" per role (for callback/recap) |

**Separation:** Identity is purely musical. Sound design (wavetable choice, FM depth, saturation) is NOT here.

### 2.2 Material

**What counts as material:**

| Material kind | What it carries | Example |
|---|---|---|
| motif | notes + contour + intervals + pitchClasses + register + rhythmicDensity + accentPattern + transformHistory | A lead motif, a counterline, an acid riff |
| rhythm cell | hits[] + velocities[] + micros[] + accentPattern | A percussion pattern, a hat pattern |
| bass pattern | notes + style + tensionCurve | A rolling bass, a four-on-floor bass |
| harmonic material | chordPcs + voicing + rhythm | A pad chord sequence, a drone |
| call/response material | motifId + responseMotifId + relationship | A call that expects a specific response |
| variation material | sourceMotifId + operator + parameters | "motif X transposed +2 with rhythmic displacement" |
| transformation lineage | sourceMotifId[] + operator[] + reason[] | Full history of how a motif developed |

**Key question:** "What information tells PSY4 why these notes exist and how they should behave musically?"

The answer: **role + lifecycle state + interaction context + development lineage.** Not just notes. A motif that is a "call" behaves differently from a motif that is a "response." A motif that is "entering" behaves differently from one that is "thinning." The notes alone don't carry this.

### 2.3 Role

See Section 3 (Role Model) for the full abstraction.

### 2.4 Interaction

See Section 4 (Interaction Model).

### 2.5 Lifecycle

See Section 4 (Role Lifecycle).

### 2.6 Arrangement

See Section 6 (Arrangement/Energy Model).

### 2.7 Energy

See Section 6.

### 2.8 Development

See Section 5 (Motif/Development Model).

### 2.9 Transition

Transitions are musical events (not FX decisions). A transition is: "at bar 48, the track moves from BUILD to DROP. The kick re-enters, the bass doubles in density, the lead shifts up an octave, the atmosphere thins."

The WHAT-layer describes: **what changes musically** (which roles enter/exit/transform, how energy/density shift). The HOW-layer decides: riser sweep, impact hit, filter sweep (those are FX realizations).

---

## Section 3 — Role Model

### The principle: Role ≠ Instrument

A role is a **semantic musical function**. An instrument/synthesis is a **PSY4 decision**.

- "KICK" is a role (low-end rhythmic anchor). A 909 sample, a synth kick, or a hybrid is a PSY4 decision.
- "ACID" is a role (midrange resonant FM riff). A TB-303 emulation, a wavetable scan, or a sample is a PSY4 decision.
- "PAD" is a role (sustained harmonic fill). A supersaw, a wavetable, or a granular texture is a PSY4 decision.

### Proposed Role abstraction

```typescript
interface Role {
  // ── Semantic identity ──
  id: string;                          // unique within the track
  semanticRole: SemanticRole;         // see taxonomy below
  subtype?: string;                   // e.g., "rolling" for bass, "resonant" for acid
  behavior: RoleBehavior;             // how this role behaves musically

  // ── Register intent (NOT synthesis — musical register) ──
  registerIntent: RegisterIntent;     // sub/bass/low-mid/mid/high-mid/high/air

  // ── Functional group ──
  functionalGroup: FunctionalGroup;   // rhythmic-foundation | midrange-melodic | sustained-harmonic | transitions-glue
}
```

### Semantic role taxonomy (extensible, not a final enum)

| Functional group | Semantic roles |
|---|---|
| **rhythmic-foundation** | KICK, BASS, KICKBASS (coupled engine — see §4), HAT, CYMBAL, RIDE, PERCUSSION, SNARE, CLAP, GHOST-PERC |
| **midrange-melodic** | LEAD, ACID, PLUCK, STAB, COUNTERLINE, ARPEGGIO |
| **sustained-harmonic** | PAD, DRONE, ATMOSPHERE, TEXTURE |
| **transitions-glue** | RISER, SWEEP, IMPACT, DOWNLIFTER, REVERSE, GLITCH |

**This is NOT a final enum.** It's a candidate taxonomy. The model should allow new roles without schema changes (open set).

### Role behavior

```typescript
type RoleBehavior = {
  // How the role participates in rhythm
  rhythmicRole: 'anchor' | 'groove' | 'counterpoint' | 'fill' | 'texture' | 'event';
  
  // How the role participates in harmony
  harmonicRole: 'root' | 'chord-tone' | 'passing' | 'pedal' | 'drone' | 'none';
  
  // Density behavior
  densityProfile: 'continuous' | 'sparse' | 'pointillistic' | 'sustained' | 'one-shot';
  
  // Development behavior
  developmentType: 'static' | 'evolving' | 'call-response' | 'callback' | 'transform';
};
```

### Why this is better than an instrument enum

- **Extensible**: new roles (e.g., "FM-TEXTURE", "VOCAL-CHOP") can be added without changing the schema.
- **Semantic**: "ACID" tells PSY4 "this is a resonant midrange riff that should evolve" — PSY4 can choose FM or wavetable.
- **Behavior-driven**: the behavior fields tell PSY4 how to realize the role without prescribing the synth.
- **Register-aware**: registerIntent tells PSY4 where in the spectrum this role should sit (musical, not EQ).

---

## Section 4 — Interaction Model

### Kick + Bass is ONE system, not two arrays

This is the most important interaction. RESEARCH-A confirms: kick and bass in psytrance are a coupled engine with:
- **Timing lock**: bass onsets align with kick gaps (K-B-B-B pattern)
- **Pitch co-tuning**: kick fundamental and bass root are chosen to avoid masking (e.g., kick 50Hz, bass 65Hz)
- **Energy coupling**: when kick drops out, bass behavior changes (drops to root, sustains, or stops)
- **Sidechain relationship**: bass ducks when kick hits (this is a musical parameter — "how much does the bass yield to the kick" — not a synthesis decision)

### Proposed interaction representation

```typescript
interface RoleInteraction {
  type: 'couple' | 'complement' | 'contrast' | 'call-response' | 'mask-avoidance';
  participants: [RoleId, RoleId];      // which roles interact
  relationship: InteractionRelationship;
}

interface InteractionRelationship {
  // For 'couple' (kick+bass):
  timingLock?: 'onset-gap' | 'unison' | 'offset';
  pitchRelationship?: 'co-tuned' | 'harmonic' | 'dissonant';
  energyCoupling?: number;             // 0-1, how much one yields to the other
  sidechainIntent?: number;            // 0-1, musical parameter (NOT a synth threshold)
  
  // For 'complement' (lead + counterline):
  harmonicComplement?: 'chord-tone' | 'passing' | 'parallel' | 'contrary';
  
  // For 'call-response':
  callMotifId?: string;
  responseMotifId?: string;
  responseDelay?: number;              // in beats
  
  // For 'mask-avoidance':
  frequencySeparation?: number;        // Hz target gap
  phaseAlignment?: number;             // degrees
}
```

### Other interactions

| Interaction | Example |
|---|---|
| bass ↔ percussion | percussion fills bass gaps; density coupling |
| lead ↔ response | call/response between lead and counterline |
| motif ↔ counter-motif | contrapuntal relationship |
| percussion ↔ energy | percussion density tracks energy curve |
| FX ↔ transition | FX gestures mark transition points |
| harmony ↔ melody | melody targets chord tones on strong beats |
| rhythm ↔ motif | motif rhythm aligns with or displaces from groove |

### How the WHAT describes relationships

Foundation describes: **which roles interact, what type of interaction, and the musical parameters of the interaction** (timing lock, pitch relationship, energy coupling, harmonic complement).

PSY4 decides: **how to realize the interaction in audio** (sidechain compression amount, frequency allocation, phase alignment).

---

## Section 5 — Motif / Development Model

### The problem with current Motif

Current `Motif` has `transformHistory: string[]` — a record of what was applied. But there is no **forward-looking development plan**: "motif X will be varied by pitch mutation every 4 bars, transposed up an octave at the drop, fragmented during the breakdown, and recapitulated in the outro."

### Proposed development model

```typescript
interface DevelopmentPlan {
  motifId: string;
  
  // ── Variation schedule ──
  variations: Array<{
    atBar: number;
    operator: DevelopmentOperator;
    parameters: Record<string, number>;
    reason: string;                    // "build tension", "release", "recapitulate"
  }>;
  
  // ── Callback/recapitulation ──
  callbacks: Array<{
    atBar: number;
    sourceMotifId: string;             // earlier motif to recall
    transform?: string;                // "transpose+octave", "fragment"
  }>;
  
  // ── Lineage (backward-looking, for identity tracking) ──
  lineage: Array<{
    fromMotifId: string;
    viaOperator: string;
    atBar: number;
  }>;
}

type DevelopmentOperator =
  | 'transpose'
  | 'invert'
  | 'retrograde'
  | 'fragment'
  | 'augment'
  | 'diminish'
  | 'shift-register'
  | 'rhythmic-displacement'
  | 'interval-substitution'
  | 'contour-mutation'
  | 'call-response'
  | 'callback'
  | 'thin'
  | 'densify'
;
```

### Psytrance-specific development patterns

RESEARCH-A identifies psytrance as "hypnotic without being static." This is achieved through:
- **Micro-variation**: one note changes every 4 bars (motif stays recognizable)
- **Slow evolution**: filter movement, timbral mutation over 16-32 bars
- **Call/response**: melodic phrases answered by transformed versions
- **Callback/recapitulation**: earlier motifs return at structurally significant points (drop, outro)

The development model must express these as **forward-looking schedules**, not just backward-looking history.

### Foundation already has transformation primitives

`packages/music/src/transformation.ts` has: transpose, invert, retrograde, fragment, shiftRegister, rhythmicDisplacement, intervalSubstitution, contourMutation, callResponse. These are the operators. What's missing is the **schedule** (when to apply which operator for which reason).

---

## Section 6 — Arrangement / Energy Model

### The problem with current SectionPlan

Current `SectionPlan` has `SectionRole` (ESTABLISH/REPEAT_VARIATION/DEVELOPMENT/CONTRAST/RETURN/ESCALATION/PEAK/RELEASE) — these are bar-level roles describing what happens at each bar. But there is no **track-level section model** (intro/build/drop/breakdown/re-entry/outro).

A "drop" is not a bar-level role — it's a multi-bar section with specific active roles, energy, and density.

### Proposed arrangement model

```typescript
interface ArrangementSection {
  id: string;
  type: SectionType;                   // intro | build | drop | breakdown | re-entry | outro | groove | transition
  barRange: { start: number; end: number };  // in bars
  
  // ── Section-level energy/density ──
  energy: number;                      // 0-1 (section average)
  tension: number;                     // 0-1
  density: number;                     // 0-1
  
  // ── Per-role activity mask (NEGATIVE SPACE — see §7) ──
  roleActivity: Map<RoleId, RoleActivity>;
  
  // ── Motif state at section start ──
  motifState: Map<RoleId, MotifState>;
  
  // ── Development stage ──
  developmentStage: 'introduce' | 'establish' | 'develop' | 'peak' | 'release' | 'recapitulate';
  
  // ── Transition intent (in/out) ──
  transitionIn?: TransitionIntent;
  transitionOut?: TransitionIntent;
}

type SectionType = 'intro' | 'build' | 'drop' | 'breakdown' | 're-entry' | 'outro' | 'groove' | 'transition';

interface TransitionIntent {
  type: 'rise' | 'fall' | 'cut' | 'fade' | 'sweep';
  durationBars: number;
  energyDelta: number;                 // how much energy changes
}
```

### Energy/density at multiple levels

| Level | What it describes | Example |
|---|---|---|
| **section-level** | macro arc across the track | drop = 0.9, breakdown = 0.2 |
| **role-level** | per-role density | lead sparse in breakdown, dense in drop |
| **phrase-level** | tension/release within a phrase | phrase builds tension then releases |
| **bar-level** | micro-dynamics | bar 4 of phrase is the peak |

These should be **explicit primitives** (Foundation provides them) that PSY4 **derives realization from** (PSY4 decides velocity/density/spectral intensity).

---

## Section 7 — Negative Space Model

### The problem

Current `SectionPlan` density=0 means "low density" but doesn't say WHICH roles are inactive. A breakdown (kick OFF, bass OFF, atmosphere HIGH) cannot be distinguished from a sparse groove (kick ON, bass ON, lead SPARSE) at the density level alone.

### Proposed negative space model

```typescript
interface RoleActivity {
  state: RoleLifecycleState;
  intensity: number;                   // 0-1 (how present)
}

type RoleLifecycleState =
  | 'absent'        // not playing at all
  | 'entering'      // fading in / starting
  | 'sustaining'    // playing normally
  | 'varying'       // playing with variation
  | 'transforming'  // undergoing a transformation
  | 'thinning'      // reducing density
  | 'muted'         // temporarily off (will return)
  | 'exiting'       // fading out
;
```

### Example: DROP vs BREAK

```typescript
// DROP section
roleActivity = {
  kick:        { state: 'sustaining', intensity: 1.0 },
  bass:        { state: 'sustaining', intensity: 1.0 },
  percussion:  { state: 'sustaining', intensity: 0.8 },
  lead:        { state: 'varying',    intensity: 0.7 },
  acid:        { state: 'sustaining', intensity: 0.6 },
  pad:         { state: 'sustaining', intensity: 0.3 },
  atmosphere:  { state: 'absent',     intensity: 0.0 },
};

// BREAK section
roleActivity = {
  kick:        { state: 'muted',      intensity: 0.0 },
  bass:        { state: 'muted',      intensity: 0.0 },
  percussion:  { state: 'thinning',   intensity: 0.3 },
  lead:        { state: 'thinning',   intensity: 0.2 },
  acid:        { state: 'absent',     intensity: 0.0 },
  pad:         { state: 'sustaining', intensity: 0.8 },
  atmosphere:  { state: 'sustaining', intensity: 0.9 },
};
```

**This is arrangement/composition semantics.** It describes what is NOT playing. It does NOT prescribe synthesis (no "fade with a lowpass filter" — that's PSY4's job).

---

## Section 8 — Foundation → RawScore Boundary

### Proposed flow

```
FOUNDATION (owns WHAT)
│
├── Identity (tempo, meter, tonic, scale, style profile)
├── Material (motifs, rhythm cells, bass patterns, harmonic material, call/response, lineage)
├── Roles (semantic roles + behaviors + register intent)
├── Interactions (couple, complement, call-response, mask-avoidance)
├── Arrangement (sections with role-activity masks, energy, transitions)
├── Development (forward-looking variation schedules, callbacks)
└── Energy (section/role/phrase/bar-level energy/density/tension)
    │
    ▼
MUSICAL SCORE (compiled WHAT — pure musical intent, no synthesis)
│
├── Per-role note sequences (step, midi, velocity, durationSteps, accent)
├── Per-role lifecycle events (enter/sustain/vary/transform/thin/mute/exit)
├── Interaction parameters (timing lock, pitch relationship, energy coupling)
├── Section boundaries with role-activity masks
└── Development schedule (when which operator applies to which motif)
    │
    ▼
RAWSCORE (the contract PSY4 consumes — temporary validation representation)
│
├── CompositionEvent[] (per-note: step, midi, durationSteps, velocity, barContext, sourceMaterial)
├── RoleAssignment[] (per-note: semanticRole, behavior, registerIntent)
├── InteractionMap (roleId[] → interaction parameters)
├── SectionSchedule (bar ranges with role-activity masks)
├── DevelopmentPlan[] (per motif: variation schedule, callbacks)
└── EnergyProfile (section/role/phrase/bar-level curves)
    │
    ▼
PSY4 (owns HOW)
│
├── VoiceSpecification builder (consumes RawScore, builds synth params)
├── Renderer (Web Audio OfflineAudioContext)
└── Critic (measures audio)
```

### What compiles at each stage

| Stage | Input | Output | What's compiled |
|---|---|---|---|
| Foundation → Musical Score | Identity + Material + Roles + Interactions + Arrangement + Development + Energy | Per-role note sequences + lifecycle events + interaction params + section schedule + development schedule | Motif instantiation, transformation application, role-activity resolution, interaction parameter computation |
| Musical Score → RawScore | Per-role musical intent | Flat event list + metadata maps | Flattening (per-role → flat list), role assignment, interaction lookup, energy curve attachment |
| RawScore → PSY4 | Flat contract | VoiceSpecification[] → audio | Synthesis architecture selection, sample selection, envelope/filter/modulation realization, mixing, rendering |

### Key boundary: Foundation does NOT compile synthesis

- Foundation compiles: notes, roles, interactions, arrangement, development, energy.
- Foundation does NOT compile: oscillator type, cutoff, FM depth, sample path, pan, reverb send.

---

## Section 9 — Current Contract Gap Matrix

Independent audit of existing Foundation concepts. This is NOT based on previous audits.

| Existing concept | Status | Problem | Proposed semantic role | Owner |
|---|---|---|---|---|
| `MusicalContext.tonic` | KEEP | — | Identity | Foundation |
| `MusicalContext.scaleName` | KEEP | — | Identity | Foundation |
| `MusicalContext.bpm` | KEEP | — | Identity | Foundation |
| `MusicalContext.harmonicContext` | KEEP | — | Harmonic material | Foundation |
| `MusicalContext.tension` | KEEP | — | Energy (bar-level) | Foundation |
| `MusicalContext.density` | KEEP | — | Energy (bar-level) | Foundation |
| `MusicalContext.energy` | KEEP | — | Energy (bar-level) | Foundation |
| `MusicalContext.sectionRole` | REWORK | Bar-level role, not section-level | Should be ArrangementSection.type | Foundation |
| `MusicalContext.repetitionPressure` / `noveltyPressure` | KEEP | — | Development intent | Foundation |
| `MotifNote.step/midi/velocity/durationSteps` | KEEP | — | Material | Foundation |
| `MotifNote.accent` | KEEP | — | Material | Foundation |
| `Motif.role` (string) | REWORK | Free string, no taxonomy | Should be `semanticRole` from Role abstraction | Foundation |
| `Motif.transformHistory` | KEEP | — | Development lineage (backward) | Foundation |
| `Motif` (contour, intervals, pitchClasses, register, rhythmicDensity, accentPattern) | KEEP | — | Structural features | Foundation |
| `PhrasePlan` (PhraseSlot with role/motifId/transformId/density/energy) | KEEP | — | Phrase-level plan | Foundation |
| `PhraseRole` (INTRO/STATEMENT/...) | KEEP | — | Phrase-level musical role | Foundation |
| `SectionPlan` (SectionSlot with density/energy/novelty/registerTarget) | KEEP | — | Section-level curve | Foundation |
| `SectionRole` (ESTABLISH/REPEAT_VARIATION/...) | KEEP | — | Bar-level musical role | Foundation |
| `SectionSlot.phrasePlan` | KEEP | — | Embedded phrase plan | Foundation |
| `Material.metadata.role` (string) | REWORK | Free string | Should be `semanticRole` from Role abstraction | Foundation |
| `Material.metadata.style` | KEEP | — | Stylistic tag | Foundation |
| `Material.metadata.tempoRange` | KEEP | — | Tempo compatibility | Foundation |
| `Material.metadata.keyCompatibility` | KEEP | — | Key compatibility | Foundation |
| `Material.metadata.energy` / `novelty` | KEEP | — | Material energy/novelty | Foundation |
| `MotifPayload` (motif) | KEEP | — | Motif material | Foundation |
| `BassPatternPayload` (bass-pattern) | KEEP | — | Bass material | Foundation |
| `DrumPatternPayload` (drum-pattern, tracks: Record<string, RhythmPattern>) | REWORK | Track names are free strings ("kick", "hat") | Should use `semanticRole` as track key | Foundation |
| `RhythmPayload` (hits, velocities, micros, probabilities) | KEEP | — | Rhythm cell material | Foundation |
| `FillPayload` | KEEP | — | Fill material | Foundation |
| `PhrasePayload` (bars with motifId/bassPatternId/drumPatternId) | KEEP | — | Phrase material reference | Foundation |
| `FXGesturePayload` (param, points, durationSec) | REWORK | `param` is free string, `durationSec` is seconds (not musical) | Should be musical (param → semanticRole, durationSec → durationBars) | Foundation |
| `PresetPayload` (engine, params) | WRONG OWNER | Preset is a synthesis concept | Should NOT be in Foundation | PSY4 |
| `TexturePayload` (rootHz, partials, lfo) | WRONG OWNER | Texture payload contains synthesis params (partials, lfo) | The MUSICAL texture intent should be in Foundation; the synth params should be in PSY4 | Foundation (intent) / PSY4 (params) |
| Protocol `NoteEvent` (note, velocity, duration, channel) | KEEP | — | Note event | Foundation |
| Protocol `PatternEvent` (patternId, trackId) | REWORK | trackId is free string | Should use `semanticRole` | Foundation |
| Protocol `DropEvent` (intensity) | KEEP | — | Section transition event | Foundation |
| Protocol `EnergyEvent` (energy) | KEEP | — | Energy event | Foundation |
| **MISSING:** Role abstraction (semanticRole, behavior, registerIntent) | MISSING | No role taxonomy | New Role interface | Foundation |
| **MISSING:** Role lifecycle (enter/sustain/vary/transform/thin/mute/exit) | MISSING | No lifecycle | New RoleActivity | Foundation |
| **MISSING:** Role interactions (couple, complement, call-response, mask-avoidance) | MISSING | No interaction model | New RoleInteraction | Foundation |
| **MISSING:** Arrangement section model (intro/build/drop/breakdown/re-entry/outro) | MISSING | Only bar-level SectionRole | New ArrangementSection | Foundation |
| **MISSING:** Negative space (per-role activity mask per section) | MISSING | Density=0 doesn't say which roles | New RoleActivity mask in ArrangementSection | Foundation |
| **MISSING:** Midrange melodic roles (acid, pluck, stab, counterline, arpeggio) | MISSING | Only kick/bass/lead/hat named | New semanticRoles | Foundation |
| **MISSING:** Sustained harmonic roles (pad, drone, atmosphere, texture) | MISSING | No sustained layer | New semanticRoles | Foundation |
| **MISSING:** Transition/glue roles (riser, sweep, impact, downlifter) | MISSING | No transition layer | New semanticRoles | Foundation |
| **MISSING:** Forward-looking development schedule | MISSING | Only backward transformHistory | New DevelopmentPlan | Foundation |
| **MISSING:** Psytrance style profile (beyond BPM/scale) | MISSING | No style constraints | New StyleProfile | Foundation |
| **MISSING:** Energy at section/role/phrase levels | PARTIAL | Only bar-level in MusicalContext | New multi-level EnergyProfile | Foundation |
| **MISSING:** Callback/recapitulation model | MISSING | No callback scheduling | New Callback in DevelopmentPlan | Foundation |

### Summary of gaps

- **2 WRONG OWNER**: PresetPayload (synthesis), TexturePayload (partially synthesis)
- **4 REWORK**: Motif.role, Material.metadata.role, DrumPatternPayload tracks, FXGesturePayload param, PatternEvent trackId (all use free strings instead of semanticRole)
- **9 MISSING**: Role abstraction, role lifecycle, role interactions, arrangement sections, negative space, midrange roles, sustained roles, transition roles, development schedule, style profile, multi-level energy, callback model

---

## Section 10 — Minimal V2 Contract

### The principle

**Minimum contract capable of expressing a complete psytrance composition.** Not maximal schema.

### Minimal V2 contract

```typescript
// ─── IDENTITY ──
interface TrackIdentity {
  tempo: number;
  meter: { beatsPerBar: number; subdivision: number };
  tonic: number;
  scaleName: string;
  stylisticFamily: string;            // "psytrance"
  subtypeProfile?: string;            // "full-on" | "progressive" | "dark" | "goa"
  harmonicLanguage?: string;          // "modal" (default for psytrance)
}

// ─── ROLE ──
interface RoleAssignment {
  roleId: string;
  semanticRole: string;               // KICK | BASS | LEAD | ACID | PLUCK | PAD | ... (extensible)
  functionalGroup: 'rhythmic-foundation' | 'midrange-melodic' | 'sustained-harmonic' | 'transitions-glue';
  registerIntent: 'sub' | 'bass' | 'low-mid' | 'mid' | 'high-mid' | 'high' | 'air';
  behavior: {
    rhythmicRole: string;
    harmonicRole: string;
    densityProfile: string;
    developmentType: string;
  };
}

// ─── MUSICAL EVENT (per-note, with role + lifecycle) ──
interface MusicalEvent {
  // ── Note ──
  step: number;
  midi: number;
  durationSteps: number;
  velocity: number;
  accent: boolean;
  
  // ── Role ──
  roleId: string;
  semanticRole: string;
  
  // ── Context ──
  bar: number;
  sectionId: string;
  barContext: BarContext;              // tonic, scaleName, bpm, harmonicContext, tension
  
  // ── Lifecycle (what's happening to this role at this moment) ──
  lifecycleState: RoleLifecycleState;
  
  // ── Development (if this note is part of a development) ──
  developmentOperator?: string;
  sourceMotifId?: string;
}

// ─── INTERACTION ──
interface RoleInteraction {
  type: 'couple' | 'complement' | 'contrast' | 'call-response' | 'mask-avoidance';
  participants: [string, string];     // roleId[]
  parameters: {
    timingLock?: string;
    pitchRelationship?: string;
    energyCoupling?: number;
    sidechainIntent?: number;
    harmonicComplement?: string;
    callMotifId?: string;
    responseMotifId?: string;
    responseDelay?: number;
    frequencySeparation?: number;
    phaseAlignment?: number;
  };
}

// ─── ARRANGEMENT ──
interface ArrangementSection {
  id: string;
  type: 'intro' | 'build' | 'drop' | 'breakdown' | 're-entry' | 'outro' | 'groove' | 'transition';
  barRange: { start: number; end: number };
  energy: number;
  tension: number;
  density: number;
  roleActivity: Map<string, { state: RoleLifecycleState; intensity: number }>;
  transitionIn?: { type: string; durationBars: number; energyDelta: number };
  transitionOut?: { type: string; durationBars: number; energyDelta: number };
}

// ─── DEVELOPMENT ──
interface DevelopmentPlan {
  motifId: string;
  variations: Array<{ atBar: number; operator: string; parameters: Record<string, number>; reason: string }>;
  callbacks: Array<{ atBar: number; sourceMotifId: string; transform?: string }>;
}

// ─── STYLE PROFILE ──
interface StyleProfile {
  family: string;                     // "psytrance"
  constraints: {
    rollingLowEnd: boolean;
    hypnoticRepetition: boolean;
    evolvingMotifs: boolean;
    layeredPercussion: boolean;
    tensionReleaseStructure: boolean;
    psychedelicTexture: boolean;
  };
  arrangementConventions: {
    typicalLength: [number, number];  // minutes
    sectionOrder: string[];
    layerEntryCadence: number;        // bars between layer entries
  };
}

// ─── THE CONTRACT PSY4 CONSUMES ──
interface MusicalScore {
  identity: TrackIdentity;
  roles: RoleAssignment[];
  events: MusicalEvent[];
  interactions: RoleInteraction[];
  sections: ArrangementSection[];
  development: DevelopmentPlan[];
  styleProfile: StyleProfile;
}
```

### What's minimal about this

- **7 top-level entities** (identity, roles, events, interactions, sections, development, styleProfile)
- **~20 fields per event** (musical + role + context + lifecycle)
- **No synthesis fields** (no oscillator, no cutoff, no FM depth, no sample path)
- **Extensible roles** (semanticRole is a string, not a closed enum)
- **Interactions are explicit** (not implicit in note alignment)
- **Negative space is explicit** (roleActivity map per section)
- **Development is forward-looking** (variation schedule + callbacks)

### What this can express that V1 couldn't

- A drop (kick+bass+acid+lead all sustaining, atmosphere muted)
- A breakdown (kick+bass muted, pad+atmosphere sustaining, lead thinning)
- Kick+bass as a coupled engine (timing lock, pitch co-tuning, sidechain intent)
- An acid line entering at bar 32, developing through 32-48, exiting at breakdown
- A motif callback at the drop (recapitulating the intro motif transposed)
- A full midrange (acid + pluck + counterline + mid percussion)
- A psytrance style profile (rolling low-end, hypnotic repetition, evolving motifs)

---

## Section 11 — What Must NOT Be Added to Foundation

| Must NOT add | Why |
|---|---|
| Oscillator type / waveform | Synthesis decision — PSY4's job |
| Filter cutoff / resonance / envelope | Synthesis decision — PSY4's job |
| FM ratio / FM depth | Synthesis decision — PSY4's job |
| Wavetable position / morph rate | Synthesis decision — PSY4's job |
| Sample path / sample selection | Synthesis decision — PSY4's job |
| Saturation amount / distortion character | Synthesis decision — PSY4's job |
| Stereo width / pan / reverb send | Mix decision — PSY4's job |
| EQ / compression / sidechain threshold | Mix decision — PSY4's job |
| LUFS / true-peak / mastering targets | Mastering decision — PSY4's job (or commercialReference) |
| Envelope times in milliseconds | Synthesis realization — PSY4's job (Foundation provides musical durations in steps/bars) |
| `PresetPayload` (engine + params) | WRONG OWNER — synthesis preset, not musical material |
| `TexturePayload.partials` / `lfo` | Synthesis params — the MUSICAL texture intent (sustained, evolving, spectral) belongs in Foundation; the partials/lfo belong in PSY4 |
| Specific synth engine names ("surge", "vital", "sc") | Backend decision — PSY4's job |

### The rule

> **Foundation must not silently acquire synthesis ownership just because PSY4 currently lacks information.**

If PSY4 can't realize something, the answer is to fix PSY4, not to move the decision into Foundation.

---

## Section 12 — Validation Plan for V2

Before writing production code, V2 must be validated at the DESIGN level (not the audio level).

### Validation criteria

1. **Can V2 describe a complete track?**
   - Encode a full 7-minute psytrance track (intro → build → drop → breakdown → re-entry → outro) in the V2 schema.
   - Verify all sections, roles, interactions, development, and energy curves are expressible.

2. **Can V2 describe intro → build → drop → breakdown → re-entry → outro?**
   - Encode the 6 canonical sections.
   - Verify each section has the correct role-activity mask (e.g., breakdown = kick/bass muted, atmosphere sustaining).
   - Verify transitions between sections are expressible (transitionIn/Out).

3. **Can V2 represent multiple simultaneous musical roles?**
   - Encode a drop with: kick, bass, percussion, lead, acid, pad, atmosphere (7 simultaneous roles).
   - Verify each role has its own note stream, lifecycle state, and interaction parameters.

4. **Can V2 represent motif development?**
   - Encode a motif that: introduced at bar 0, varied at bar 16 (transpose), developed at bar 32 (fragment), recapped at bar 64 (callback).
   - Verify the DevelopmentPlan expresses this forward-looking schedule.

5. **Can V2 represent role interactions?**
   - Encode kick+bass as a coupled engine (timing lock, pitch co-tuning, sidechain intent).
   - Encode lead+counterline as call-response (call motif, response motif, delay).
   - Verify the InteractionMap carries these parameters.

6. **Can V2 represent negative space?**
   - Encode a breakdown where kick/bass are muted but atmosphere is sustaining.
   - Verify the roleActivity mask distinguishes "muted" from "absent" from "sustaining".

7. **Can PSY4 consume V2 without synthesis decisions in Foundation?**
   - Inspect every field in V2. Confirm none prescribe oscillator type, cutoff, FM depth, sample path, pan, reverb send, EQ, compression.
   - Confirm Foundation provides musical intent (role, lifecycle, interaction, development) and PSY4 provides realization (synth, sample, mix).

### Validation method

- **Paper encoding** (no code): manually write a V2 MusicalScore JSON for a representative psytrance track.
- **Completeness check**: verify all 7 validation criteria are satisfiable.
- **Ownership check**: verify no field violates the ownership boundary (Section 11).
- **Minimal check**: verify no field is redundant or derivable from another.

### What V2 validation does NOT include

- No audio rendering (that's a future V2 experiment, separate from this design audit)
- No critic (no DSP metrics)
- No blind listening
- No A/B/C/D/E comparison

V2 validation is purely a DESIGN validation: can the schema express a complete psytrance track?

### Decision after V2 validation

Only after V2 design validation passes:
1. Decide whether to implement V2 in Foundation (separate decision, requires Foundation team approval)
2. If implemented, run a V2 vertical proof (A/B/C/D/E with the richer WHAT-layer)
3. Compare V2 results to V1 results
4. Decide which abstractions to ratify

**No implementation until V2 design is validated and approved.**

---

## FINAL RULE — Confirmed

- ❌ No code written
- ❌ No code changed
- ❌ No commit proposed
- ❌ No new serializer built
- ❌ No new renderer built
- ❌ No V2 implementation started
- ❌ No architecture approved

✅ DESIGN AUDIT ONLY.

---

## The Question Answered

> **What must the musical WHAT-layer be capable of expressing before we ask PSY4 to prove that it can turn it into commercial psytrance audio?**

**Answer:**

The WHAT-layer must express:
1. **A complete role ontology** (~12-14 semantic roles across 4 functional groups: rhythmic-foundation, midrange-melodic, sustained-harmonic, transitions-glue) — not a hardcoded instrument enum.
2. **Role lifecycle** (enter/sustain/vary/transform/thin/mute/re-enter/exit) — so Foundation can describe a role entering at bar 32 and exiting at the breakdown.
3. **Role interactions** (especially kick↔bass as a coupled engine with timing lock, pitch co-tuning, energy coupling, sidechain intent) — not two independent arrays.
4. **Arrangement sections** (intro/build/drop/breakdown/re-entry/outro) with per-role activity masks — so negative space is explicit.
5. **Forward-looking development** (variation schedules, callbacks) — not just backward transformHistory.
6. **Multi-level energy** (section/role/phrase/bar) — explicit primitives, not just bar-level.
7. **Psytrance style profile** (rolling low-end, hypnotic repetition, evolving motifs, layered percussion, tension/release, psychedelic texture, arrangement conventions) — beyond BPM+scale.
8. **Musical material beyond notes** (motifs with structural features, rhythm cells, bass patterns, harmonic material, call/response material, transformation lineage) — notes alone don't tell PSY4 why the notes exist.

The current Foundation describes ~4 of these 8 (identity, bar-level energy, motif notes, phrase/section bar-level roles). It is a skeleton. The V1 midrange sparseness is a MUSICAL MODEL GAP, not a mixing gap — the WHAT-layer doesn't name the roles that produce midrange content.

**Only after the WHAT-layer can express all 8 should we ask PSY4 to prove it can turn it into commercial psytrance audio.**

---

## HARD STOP — END OF DESIGN AUDIT

No code. No Foundation changes. No renderer changes. No rerender. No architecture approval.

**Awaiting user review of this design audit. The next step (if approved) is V2 design validation (paper encoding, not code) — a separate decision.**
