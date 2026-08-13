# PSY4 — Adversarial Review Before Schema Design

**Status:** ADVERSARIAL DESIGN REVIEW. No code. No Foundation changes. No PSY4 changes. No V2 schema. No audio. No V1 rerun. No architecture approval. No assumption that the previous ontology is correct.
**Predecessor under review:** `audit-reports/PSY4-MUSIC-COMPOSITION-MODEL-DEEP-REVIEW.md`
**Date:** 2024-08-13

This review determines whether the proposed ontology is a **genuine composition model** or a **sophisticated role/intent metadata system**. The previous review is substantially better than its predecessors, but "intent" and "reason strings" may still be labels rather than musical intelligence.

---

## The Core Challenge

If I removed every field named `role`, `density`, `energy`, `lifecycle`, `intent`, or `section`, what actual **musical knowledge** would remain?

If the answer is "not much," the model is metadata describing structure, not structure itself.

This review distinguishes explicitly between:
- **musical material** — what is played
- **musical grammar** — the rules/conventions that govern how material behaves
- **musical relationships** — how elements relate to each other
- **musical causality** — WHY one event follows another (not just a reason string)
- **arrangement** — the temporal placement of events
- **development** — how material transforms over time
- **performance intent** — how it should be played (realization-adjacent)
- **implementation** — synthesis/mix (explicitly out of scope)

---

## 1. Challenge the Ontology

### The "remove the labels" test

Strip the previous model of: `role`, `density`, `energy`, `lifecycle`, `intent`, `section`.

What remains?
- Motifs with identity features (contour, intervals, accent) — **musical material** ✅
- Rhythm cells (hits, velocities, micros, accent pattern) — **musical material** ✅
- Bass patterns, harmonic material — **musical material** ✅
- Track identity (tonic, scale, tempo) — **musical identity** ✅
- Inter-role relationships (couple, complement, contrast) — **musical relationships** ✅

What's lost?
- The "WHY" — why a counterline enters at bar 120
- The causal chain — how one event causes the next
- The grammar — what makes this psytrance vs techno
- The contrast — how the breakdown differs musically (not just parametrically) from the drop
- The expectation — what the listener expects next

**Verdict: the previous model has material and relationships, but lacks grammar, causality, expectation, and contrast as first-class concepts.** It describes THAT things happen and gives them reason strings, but doesn't model WHY they happen as a consequence of musical logic.

### What "intent" actually means

"Intent" in the previous model is a label: `purpose: "tension + psychedelic motion"`. This is a description, not intelligence. A genuine composition model would derive the need for tension from the musical context (e.g., "the section is approaching a drop, so tension must increase, so material that creates tension is required").

**The model must represent musical causality, not just annotate events with purposes.**

---

## 2. Model Musical Causality

### The causal chain test

The previous review claims: "counterline enters because the lead established the primary motif and the section is moving into development."

This sounds good, but is it a causal chain or a reason string?

A genuine causal chain:

```
PRIMARY MOTIF introduced (bar 80)
  → establishes identity (listener encodes the motif)
  → repetition (bars 80-119) establishes expectation (listener expects continuation)
  → variation begins (bar 120, transpose +2) creates tension (expectation partially violated)
  → tension requires resolution or escalation
  → ESCALATION PATH: secondary material (counterline) enters to complement the varied motif
  → density increases (bar 128, rhythmic displacement) intensifies tension
  → WITHHOLDING PATH: motif is removed (bar 144, breakdown) — anticipation maximized
  → anticipation requires payoff
  → PAYOFF: motif returns (bar 192, drop) — expectation fulfilled, transformed
```

### What the previous model can vs can't express

| Causal step | Previous model | Genuine causality |
|---|---|---|
| Primary motif introduced | ✅ (lifecycle=introduced) | ❌ (no causal consequence) |
| Establishes identity | ✅ (intent=identity+hook) | ❌ (no "identity established" state) |
| Repetition establishes expectation | ❌ (no expectation concept) | ❌ |
| Variation creates tension | ✅ (operator=transpose) | ❌ (no "tension created" state) |
| Tension requires resolution/escalation | ❌ (no requirement concept) | ❌ |
| Secondary material responds | ✅ (lifecycle=introduced) | ❌ (no "responds to" causal link) |
| Density increases | ✅ (lifecycle=dense) | ❌ (no causal consequence) |
| Motif withheld | ✅ (lifecycle=muted) | ❌ (no "withheld for anticipation") |
| Anticipation increases | ❌ (no anticipation concept) | ❌ |
| Return produces payoff | ✅ (lifecycle=returning) | ❌ (no "payoff" state) |

**Verdict: the previous model can describe the EVENTS but not the CAUSAL CHAIN between them.** Each event has a reason string, but no event CAUSES the next in a modelable way.

### What's missing: a causal/grammar layer

The model needs concepts for:
- **Expectation** — what the listener expects next, based on what's been established
- **Tension** — when expectation is violated or delayed
- **Anticipation** — when a known return is pending
- **Payoff** — when anticipation is resolved
- **Causal consequence** — "event X happened, THEREFORE event Y must happen"

These are not parameters. They are **states of the musical discourse** that drive compositional decisions.

---

## 3. Composition Is Not an Inventory

### The coherence test

Track A: 10 unrelated layers (kick, bass, hat, lead, acid, counterline, pluck, pad, texture, perc) — all playing simultaneously with no relationships.

Track B: 10 layers forming one coherent musical system — the acid responds to the lead, the counterline fills the lead's gaps, the perc creates a secondary grid against kick/bass, the pad sustains the harmonic context, the texture provides the psychedelic environment.

**Both have the same role inventory. The previous model cannot distinguish A from B structurally.**

### What distinguishes coherence

A coherent composition has:
- **Causal relationships** — the acid exists BECAUSE the lead created a gap
- **Functional roles** — the pad serves a harmonic function the lead implies
- **Grammatical relationships** — the perc creates a secondary grid AGAINST the kick/bass grid
- **Expectation relationships** — the counterline answers what the lead asked
- **Contrast relationships** — the texture contrasts with the lead's clarity

The previous model has `inter-role relationships` (couple, complement, contrast, call/response) — but these are **declared**, not **derived from musical logic**. A composer declares "lead and counterline are call-response" but the model doesn't know WHY they're call-response (because the lead asked a question the counterline answers).

### The missing abstraction: musical discourse

A composition is a **discourse** — a structured argument where each element contributes to a musical narrative. The previous model has elements and relationships but no discourse layer that ties them into a coherent argument.

**The missing concept: a composition is not a set of layers, it's a structured musical argument where each element's existence is causally motivated by the musical state.**

---

## 4. Groove Must Be First-Class

### Beyond kick+bass

The previous model reduces groove to "kick+bass coupling + percussion density." A real psytrance groove involves relationships between:

- kick (the pulse anchor)
- bass (the rolling low-end)
- closed hats (subdivision)
- open hats (accent)
- rides (shimmer/energy)
- percussion (secondary rhythmic grid)
- ghost percussion (groove depth)
- syncopation (against the 4/4 grid)
- accents (strong/weak/ghost)
- silence (negative space within the groove)
- phrase boundaries (where the groove varies)
- microtiming (the "pocket")
- repeated rhythmic cells (the groove's identity)
- rhythmic displacement (variation)

### The groove as a grammar

A groove is not a collection of hits. It's a **grammatical system** where:
- The kick defines the primary grid (4-on-floor)
- The bass defines the low-end rhythm (KbBB)
- The hats define the subdivision (off-beat 16ths)
- The percussion defines a SECONDARY grid against the primary
- Ghost percussion fills the spaces
- Accents mark strong points
- Silence creates groove pockets
- Microtiming creates the "feel"
- Phrase boundaries trigger variation

### What the model must express

"This percussion figure exists because it creates a secondary rhythmic grid against the established kick/bass grid."

NOT: `percussion density = 0.5`.

### Is a dedicated groove grammar required?

**Yes.** The previous model's "groove systems" (swing, feel, accent, ghost, space maps) is a parameter container. A genuine groove grammar would model:
- The primary grid (kick/bass)
- Secondary grids (percussion, hats)
- The relationship between grids (reinforcement, counterpoint, syncopation)
- Grid variation over time (phrase-end fills, section transitions)
- The groove's identity (what makes THIS groove recognizable)

**The missing concept: groove as a multi-grid grammatical system, not a set of rhythm cells.**

---

## 5. Motif Identity Must Be Testable

### The claim under challenge

The previous model claims: "identity-carrying motifs survive transformation."

### What makes a motif recognizably itself?

| Feature | Survives transposition? | Survives register shift? | Survives rhythmic displacement? | Survives fragmentation? | Survives inversion? | Survives reharmonization? |
|---|---|---|---|---|---|---|
| Contour (direction sequence) | ✅ | ✅ | ✅ | ⚠️ (partial) | ❌ (inverted) | ✅ |
| Interval signature (semitone sequence) | ✅ | ✅ | ✅ | ⚠️ (partial) | ❌ (inverted) | ✅ |
| Rhythm signature (duration pattern) | ✅ | ✅ | ❌ (displaced) | ⚠️ (partial) | ✅ | ✅ |
| Accent signature (strong/weak pattern) | ✅ | ✅ | ⚠️ (shifted) | ⚠️ (partial) | ✅ | ✅ |
| Phrase shape (overall contour arc) | ✅ | ✅ | ✅ | ⚠️ (partial) | ❌ | ✅ |
| Register | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Harmonic function | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ❌ (reharmonized) |
| Distinctive intervals (signature leaps) | ✅ | ✅ | ✅ | ⚠️ | ❌ | ✅ |
| Distinctive rhythmic cells | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | ✅ |

### The identity test

For each transformation, what MUST survive for the motif to remain "itself"?

| Transformation | What must survive | What may change | When does it become a new motif? |
|---|---|---|---|
| **transpose** | contour, intervals, rhythm, accent | pitch register | never — transposition preserves identity |
| **register shift** | contour, intervals, rhythm, accent | register | never — register shift preserves identity |
| **rhythmic displacement** | contour, intervals, accent | rhythm signature (shifted) | when the rhythm signature is unrecognizable |
| **fragmentation** | distinctive intervals, distinctive rhythmic cells | contour (partial), phrase shape | when fewer than 50% of distinctive features survive |
| **inversion** | rhythm, accent, interval magnitudes | contour (inverted), interval directions | when the contour inversion makes it unrecognizable |
| **densification** | contour, intervals | rhythm (added notes) | when the added notes obscure the original |
| **reharmonization** | contour, intervals, rhythm | harmonic function | never — reharmonization preserves melodic identity |
| **orchestration change** | all melodic features | timbre | never — orchestration is realization |
| **call/response transformation** | distinctive features | contour (may be varied) | when the response is a new motif that answers rather than recalls |

### The identity threshold

A motif remains "itself" when a **supermajority of its identity features** (contour + interval signature + accent signature + distinctive intervals + distinctive rhythmic cells) survive transformation. Below this threshold, it becomes a new motif (possibly a derivative, tracked via lineage).

### What the previous model lacks

The previous model says "identity features survive" but doesn't define:
- **Which features are load-bearing** for this specific motif (some motifs are rhythm-defined; others are interval-defined)
- **The threshold** at which identity is lost
- **The recognition logic** — how to test if a transformed instance is still "the same motif"

**The missing concept: motif identity is not a fixed feature set — it's a weighted recognition function that depends on which features are most distinctive for THIS motif.**

---

## 6. Development Must Be More Than a Schedule

### The schedule critique

The previous model's development plan:
```
atBar=128, operator=transpose, axis=pitch, reason="section moves to development"
```

This is a schedule with a reason string. It is NOT development.

### What development actually is

Development is a **causal sequence** where each step is motivated by the musical state:

```
INTRODUCTION (bar 80)
  → motif enters, listener encodes identity
ESTABLISHMENT (bars 80-119)
  → repetition strengthens identity, creates expectation
  → expectation: "this motif will continue"
REPETITION (bars 80-119)
  → groove locks in, listener anticipates variation
VARIATION (bar 120)
  → transpose +2 partially violates expectation → creates tension
  → tension state: "the motif changed; what's next?"
MUTATION (bar 128)
  → rhythmic displacement intensifies tension
  → tension state: "the motif is evolving; where is it going?"
FRAGMENTATION (bar 144)
  → motif broken, removed → withholding
  → anticipation state: "the motif is gone; it will return"
INTERRUPTION (bars 144-191)
  → breakdown, low-end removed → expectation of return
  → anticipation maximized
WITHHOLDING (bars 144-191)
  → motif absent, hook previewed → listener expects payoff
ANTICIPATION (bars 176-191)
  → build escalates → "the return is imminent"
CALLBACK (bar 192)
  → motif returns, register-shifted → payoff
  → payoff state: "expectation fulfilled, transformed"
TRANSFORMATION (bar 224)
  → layer-context-transform → "the motif is the same but the context changed"
RECOMBINATION (bar 304)
  → motif fragmented + layered with counterline → "new combination of known material"
PAYOFF (bar 304)
  → final peak, identity confirmed at maximum energy
```

### WHY does a transformation occur NOW rather than 16 bars earlier?

The reason must arise from musical context:
- Variation at bar 120 (not bar 104) because 40 bars (5 phrases) of repetition established enough expectation to violate.
- Fragmentation at bar 144 (not bar 128) because the variation has run its course and the section is transitioning to breakdown.
- Callback at bar 192 (not bar 176) because the build has escalated anticipation to the threshold where payoff is required.

**These timings are not arbitrary — they arise from the musical state (expectation, tension, anticipation).**

### What the previous model lacks

- **Expectation state** — what the listener expects
- **Tension state** — how much expectation has been violated
- **Anticipation state** — how much the listener wants a return
- **Payoff state** — whether expectation has been fulfilled
- **Causal timing** — why this transformation happens now

**The missing concept: development is a causal sequence driven by musical state (expectation/tension/anticipation/payoff), not a schedule of operations.**

---

## 7. Contrast Is Mandatory

### The monotony test

A model that only knows ADD, REMOVE, DENSIFY, THIN, TRANSFORM can generate a monotous track — everything changes in the same direction (more, less, denser, sparser, transformed) without genuine contrast.

### What contrast means musically

| Contrast type | Example | What it does musically |
|---|---|---|
| **rhythmic contrast** | breakbeat section vs 4-on-floor | changes the rhythmic grammar |
| **register contrast** | lead in octave 5 vs octave 3 | changes the spectral space |
| **timbral-role contrast** | melodic lead vs textural acid | changes the perceptual mode |
| **harmonic contrast** | minor section vs major section | changes the emotional color |
| **motif contrast** | motif A vs motif B (different identity) | changes the melodic subject |
| **density contrast** | sparse breakdown vs dense drop | changes the energy |
| **silence** | complete stop before drop | maximizes contrast |
| **expectation violation** | surprise chord, unexpected silence | creates dramatic contrast |
| **phrase asymmetry** | 7-bar phrase vs 8-bar norm | creates structural contrast |
| **texture change** | dry vs reverberant, clean vs distorted | changes the spatial/timbral environment |
| **perspective change** | foreground to background, solo to ensemble | changes the listener's focus |

### A breakdown is not merely "kick = absent"

A breakdown is a **change in musical grammar and expectation**:
- The 4-on-floor grid is suspended (rhythmic grammar changes)
- The low-end coupling is suspended (groove grammar changes)
- The harmonic bed becomes foreground (perspective changes)
- The expectation shifts from "groove continues" to "something will return" (expectation changes)
- The texture becomes prominent (timbral contrast)

**The model must represent contrast as a change in grammatical state, not just a change in parameters.**

### What the previous model lacks

- **Contrast as a first-class concept** — not just "different density" but "different grammar"
- **Grammatical state** — what grammar is active (groove grammar, harmonic grammar, textural grammar)
- **Contrast events** — moments where the grammar changes

**The missing concept: contrast is a change in active musical grammar, not a parametric difference.**

---

## 8. Negative Space Must Be More Than Lifecycle

### The lifecycle critique

The previous model has 10 lifecycle states (absent, muted, thinning, etc.). But the WHY of absence is compositional, not just temporal:

| Absence type | Why it's absent | Compositional meaning |
|---|---|---|
| **never introduced** | doesn't exist in this track | not part of the composition |
| **intentionally absent** | exists but not in this section | reserved for later |
| **withheld for anticipation** | removed to create anticipation | will return for payoff |
| **removed after exhaustion** | served its purpose, no longer needed | completed its function |
| **muted because another layer is foregrounded** | yielding to another element | priority/foregrounding |
| **absent because the musical idea completed its function** | the idea is done | closure |
| **absent so its return has meaning** | strategic absence for dramatic return | dramatic device |

### Is this a lifecycle problem or an expectation problem?

**It's an expectation problem.** The absence type depends on:
- What the listener expects (does the element's absence violate expectation?)
- What the composition is setting up (is there a pending return?)
- What function the element served (has it completed its function?)

### The redesign

Negative space is not a lifecycle state — it's a **compositional expectation state**:
- **Expected presence** — the listener expects this element (its absence creates tension)
- **Expected absence** — the listener expects this element to be absent (its presence would be surprising)
- **Neutral** — the listener has no expectation
- **Pending return** — the element was removed and the listener anticipates its return
- **Function completed** — the element served its purpose and won't return
- **Yielding** — the element is absent because another is foregrounded

**The missing concept: negative space is an expectation state, not a lifecycle state. The model must represent what the listener expects, not just what's playing.**

---

## 9. Long-Term Novelty

### The minute 6 vs minute 2 test

Why does minute 6 feel meaningfully related to minute 2 but not identical to it?

**Do NOT answer: "because variationRate = 0.4."**

### The actual musical lineage

Minute 2 (bars ~80-160): Motif A introduced, established, varied, fragmented, removed. Listener has encoded Motif A's identity.

Minute 6 (bars ~240-320): Motif A returns, but:
- It has been transformed (register-shifted, fragmented, layer-context-changed)
- The context around it has changed (new percussion backdrop, different harmonic bed)
- The listener's expectation has changed (they've been through a breakdown and build)
- The motif's dramatic function has changed (first appearance = introduction; later appearance = callback/payoff)

### The lineage the model must support

```
IDENTITY (bar 80) — motif A introduced, identity encoded
  → REPETITION (bars 80-119) — identity strengthened, expectation created
    → EXPECTATION (bar 120) — listener expects continuation
      → VARIATION (bar 120) — expectation partially violated, tension created
        → CONTRAST (bar 144) — breakdown, grammar changes
          → RETURN (bar 192) — motif returns, expectation fulfilled (payoff)
            → TRANSFORMATION (bar 224) — motif same, context changed
              → CONTRAST (bar 256) — second breakdown
                → RETURN (bar 304) — final callback, transformed
                  → PAYOFF (bar 304) — identity confirmed at peak
```

### What makes minute 6 related to minute 2 but not identical

- **Identity preservation**: Motif A is recognizable (identity features survive)
- **Transformation accumulation**: the motif has been through multiple transformations
- **Context evolution**: the surrounding material has changed
- **Expectation evolution**: the listener's state has changed (they expect the callback)
- **Dramatic function evolution**: the motif's role has changed (introduction → callback → payoff)

### What the previous model lacks

- **Expectation state tracking** — what the listener expects at each point
- **Dramatic function** — what role the motif plays at this moment (introduction, callback, payoff)
- **Transformation accumulation** — the motif's history shapes its current meaning
- **Context evolution** — the surrounding material's history shapes the motif's perception

**The missing concept: long-term coherence requires tracking the listener's expectation state and the motif's dramatic function, not just its transformation history.**

---

## 10. Section Grammar vs Section Labels

### The "two drops" problem

Two drops can have completely different musical functions:
- DROP 1: establishes the peak, introduces the callback, confirms identity
- DROP 2: varies the peak, fragments the callback, provides final payoff

### What sections need

| Property | Meaning |
|---|---|
| **function** | what this section does musically (establish, develop, contrast, peak, resolve) |
| **predecessor** | what section came before (inherits context) |
| **successor** | what section comes next (sets up expectation) |
| **inherited material** | what material carries over from the previous section |
| **introduced material** | what new material enters |
| **withheld material** | what material is removed for anticipation |
| **transformed material** | what material returns transformed |
| **expectation** | what the listener expects entering this section |
| **payoff** | what expectation this section fulfills |
| **transition logic** | how this section connects to the next |
| **energy role** | this section's position in the energy arc |
| **narrative role** | this section's position in the dramatic narrative |

### Why DROP 2 is not DROP 1 repeated louder

DROP 2 differs from DROP 1 because:
- **Inherited material**: DROP 2 inherits the transformed motif from DROP 1
- **Expectation**: entering DROP 2, the listener expects variation (not just repetition)
- **Payoff**: DROP 2 must provide a DIFFERENT payoff (fragmented callback, not register-shifted)
- **Narrative role**: DROP 2 is the final peak (resolution), DROP 1 was the first peak (establishment)
- **Contrast**: DROP 2 must contrast with DROP 1 (different texture, different motif treatment)

### What the previous model lacks

- **Section function** — what the section does musically (not just its type label)
- **Inherited/introduced/withheld/transformed material** — how material flows between sections
- **Expectation/payoff** — what the section sets up and fulfills
- **Narrative role** — the section's position in the dramatic arc

**The missing concept: sections are not just labeled ranges — they are dramatic units with functions, expectations, payoffs, and material flow.**

---

## 11. Midrange Must Be Compositional

### The inventory critique

Adding ACID, PLUCK, COUNTERLINE, ARP, PAD, PERC to a role list does NOT create midrange composition. It creates a midrange inventory.

### The midrange as a musical conversation

```
LEAD establishes motif (bar 80)
  → creates melodic identity
  → leaves gaps (between phrases, between statements)
    → ACID answers rhythmically (bar 120)
      → fills the lead's rhythmic gaps with evolving filter motion
      → creates psychedelic tension against the lead's clarity
    → COUNTERLINE fills harmonic gap (bar 128)
      → provides harmonic context the lead implies but doesn't state
      → answers the lead's melodic questions
    → PERC creates rhythmic punctuation (bar 88)
      → marks phrase boundaries the lead plays across
      → creates a secondary grid against kick/bass
    → PLUCK appears at phrase boundaries (bar 96, 112)
      → accents the phrase structure
      → provides melodic/harmonic punctuation
    → PAD sustains harmonic context (bar 0)
      → provides the harmonic bed all midrange material operates over
      → changes chords at phrase boundaries, framing the midrange conversation
```

### What the model must represent

- **Conversational relationships** — who answers whom, who fills whose gaps
- **Functional complementarity** — each element serves a function the others don't
- **Rhythmic counterpoint** — the perc creates a grid against kick/bass
- **Harmonic framework** — the pad frames the midrange conversation
- **Phrase-level roles** — the pluck appears only at boundaries (not continuous)

### What the previous model lacks

The previous model declares relationships (lead↔counterline = call-response) but doesn't model the **conversational structure** of the midrange — how elements collectively form a musical argument.

**The missing concept: the midrange is a conversational system where each element's existence is motivated by gaps or functions the others create.**

---

## 12. Kick/Bass Must Remain a Musical Grammar

### The multiple grammars critique

The previous model fixates on KbBB as "the psytrance pattern." But psytrance has multiple legitimate bass grammars:

| Bass grammar | Pattern | Subgenre | When used |
|---|---|---|---|
| **classic rolling** | KbBB (kick + 3 bass 16ths) | Full-on, Goa | standard groove |
| **melodic rolling** | KbBB with bass following chord changes | Progressive, Goa | harmonic development |
| **syncopated** | bass on off-beats, not every 16th | Forest, Darkpsy | hypnotic, less driving |
| **broken/variant** | bass pattern varies per phrase | Full-on, Progressive | development |
| **progressive** | sparser bass, more space | Progressive | long-form groove |
| **darkpsy high-density** | bass on every 16th, sometimes 32nds | Darkpsy | relentless, dense |
| **section-specific** | bass grammar changes per section | All | breakdown = suspended; drop = densified |

### The model must represent grammar + variation

- **Base grammar**: which bass pattern (KbBB, syncopated, broken, etc.)
- **Variation**: how the pattern varies (phrase-end fills, section transitions)
- **Section overrides**: how the grammar changes per section (breakdown suspension, drop intensification)
- **Groove identity**: the specific grammar+variation that defines THIS track's groove

**The previous model captures some of this but treats KbBB as canonical. The model must treat bass grammar as a selectable, variable system, not a fixed pattern.**

---

## 13. Genre Must Not Become a Checklist

### The recipe generator risk

```
psytrance + full-on + rollingLowEnd + hypnoticRepetition + evolvingMotifs + layeredPercussion + tensionReleaseStructure + psychedelicTexture
```

This is a recipe, not a genre model. It will generate tracks that all sound the same.

### What belongs where

| Layer | What it contains | Examples |
|---|---|---|
| **genre convention** | universal traits of the genre | 4/4 kick, rolling bass, 8-bar phrase, 6-9 min length |
| **stylistic tendency** | common but not universal | full-on tends to have euphoric drops; darkpsy tends to be sustained-tension |
| **compositional grammar** | the rules that govern musical behavior | "tension must resolve", "callbacks transform", "contrast requires grammatical change" |
| **artist identity** | what makes THIS artist's tracks recognizable | signature motif behavior, preferred interval language, characteristic phrase asymmetry |
| **track-specific choice** | decisions unique to this track | this track uses a pluck at phrase boundaries; that track uses an arpeggio |

### Two tracks, both unmistakably psytrance, very different decisions

**Track A (Astrix-style full-on):**
- Genre: 4/4, rolling bass, 8-bar phrase
- Stylistic: euphoric drops, clear melodic hooks
- Artist: signature uplifting lead style, characteristic chord choices
- Track-specific: uses a pluck at phrase boundaries, acid enters at development

**Track B (Infected Mushroom-style experimental):**
- Genre: 4/4, rolling bass, 8-bar phrase
- Stylistic: more textural, less euphoric, more contrast
- Artist: signature glitchy percussion, characteristic motif fragmentation
- Track-specific: uses a counterline instead of acid, atmosphere is foreground

**Both are psytrance. Both make very different compositional decisions.** The model must allow this — genre is a constraint set, not a recipe.

### What the previous model lacks

- **Separation of genre convention from stylistic tendency from artist identity from track-specific choice**
- **Artist identity** as a concept (currently underdeveloped)

---

## 14. Artist Identity

### The problem

A commercial track cannot be only "valid psytrance." It must have a recognizable artistic identity.

### Should identity emerge or be declared?

**It should emerge from material + grammar + development**, but the model must track it:

| Identity element | How it emerges |
|---|---|
| **signature motif behavior** | this artist's motifs tend to use specific interval language (e.g., minor seconds, augmented seconds) |
| **preferred rhythmic grammar** | this artist tends to use syncopated percussion against 4/4 kick |
| **recurring interval language** | this artist favors specific intervals (e.g., b2, #4) |
| **preferred density profile** | this artist tends to be dense in drops, sparse in breakdowns |
| **characteristic contrast** | this artist tends to contrast via texture change, not register change |
| **characteristic phrase asymmetry** | this artist tends to use 7-bar phrases against 8-bar norm |
| **recurring call/response behavior** | this artist's motifs tend to call with a rising fourth, respond with a falling step |

### Is a separate concept required?

**Partially.** Identity emerges from material+grammar+development, but:
- The model must track which material/grammar/development choices are **signature** (defining this artist) vs **conventional** (genre-standard)
- The model must allow **recurrence** of signature elements across tracks (artist identity is cross-track)

**The missing concept: artist identity as a tracked emergence from signature material+grammar+development choices, with cross-track recurrence.**

---

## 15. Material Must Have Relationships

### The isolated motif critique

A motif existing by itself is not enough. Material must have semantic relationships:

| Relationship | Meaning | Example |
|---|---|---|
| **derives-from** | this motif was derived from that motif | motif B derives from motif A via fragmentation |
| **answers** | this motif responds to that motif | counterline answers lead |
| **contrasts-with** | this motif contrasts with that motif | motif B contrasts with motif A (different identity) |
| **reinforces** | this motif reinforces that motif | arpeggio reinforces the lead's harmonic implication |
| **anticipates** | this motif anticipates that motif | riser anticipates the drop |
| **interrupts** | this motif interrupts that motif | stab interrupts the lead's phrase |
| **ornaments** | this motif ornaments that motif | pluck ornaments the lead's phrase endings |
| **replaces** | this motif replaces that motif | motif B replaces motif A in the second drop |
| **recalls** | this motif recalls that motif | callback recalls the intro motif |
| **completes** | this motif completes that motif | response completes the call |

### These are semantic musical relationships

NOT implementation metadata. "Answers" means the counterline's melodic content responds to the lead's melodic content — a musical fact, not a mix decision.

**The previous model has inter-role relationships but not inter-material relationships.** The distinction: roles are functional categories; materials are specific motifs/patterns. Two different motifs can both be "LEAD" role but have a contrasts-with relationship.

**The missing concept: material-level relationships (derives-from, answers, contrasts-with, reinforces, anticipates, interrupts, ornaments, replaces, recalls, completes).**

---

## 16. Three Completely Different Compositions

### Composition A — Full-On "Nightfall Drive" (from previous review)

145 BPM, E phrygian-dominant, 7 min. 12 sections. Dense, energetic, hook-driven. KbBB bass grammar. Lead + acid + counterline + pad + atmosphere. Two drops with callbacks (register-shift, fragment).

### Composition B — Progressive "Deep Current"

132 BPM, A minor, 8 min. Slower development, sparse melodic foreground, long groove evolution.

| Aspect | How the ontology represents it |
|---|---|
| **Groove grammar** | Progressive bass grammar (sparser, more space), KbBB base with broken/variant variations |
| **Midrange conversation** | LEAD (short motifs, call-response) + COUNTERLINE (sparse) + ARP (subtle, harmonic bridge) + PAD (prominent, sustained). No acid. |
| **Causal chain** | Introduction (slow) → Establishment (long) → Subtle variation → Gradual development (no dramatic breakdown) → Groovy drop (not maximalist) → Long development → Subtle resolution |
| **Contrast** | Subtle: density contrast (sparse vs slightly denser), textural contrast (dry vs atmospheric) |
| **Negative space** | Elements are sparse (not absent); the space is within the groove, not between sections |
| **Long-term novelty** | Motif slowly evolves over 8 minutes via filter-state and interval substitution; callback is subtle (reshaped, not register-shifted) |
| **Section grammar** | Long sections (32-64 bars), subtle transitions, no dramatic breakdown/build |
| **Artist identity** | Signature: slow harmonic evolution, characteristic interval language (minor thirds, sixths) |

### Composition C — Darkpsy "Abyssal Forms"

148 BPM, D phrygian (darker), 7 min. Darker, denser, more textural, less conventional breakdown/drop.

| Aspect | How the ontology represents it |
|---|---|
| **Groove grammar** | Darkpsy high-density bass grammar (every 16th, sometimes 32nds), KbBB base with densification |
| **Midrange conversation** | LEAD (abstract, dissonant) + ACID (foreground, distorted) + TEXTURE (foreground, evolving) + PERC (dense, dark). No counterline, no pluck. |
| **Causal chain** | Introduction (dark atmosphere) → Groove establishment (dense) → Sustained tension (no release) → Textural episode (brief breather, not full breakdown) → Continued development → Relentless peak (not euphoric drop) → Abrupt outro |
| **Contrast** | Textural: distorted vs clean, dense vs sparser (within the density), foreground vs background texture |
| **Negative space** | Minimal — the track is dense throughout; absence is brief (textural episodes) |
| **Long-term novelty** | Motif evolves very slowly via filter-state over 32-64 bars; odd-time cycles (3/5/7) create long-phase evolution; no dramatic callbacks, only gradual transformation |
| **Section grammar** | Linear/hypnotic, brief breathers instead of breakdowns, relentless peak instead of euphoric drop |
| **Artist identity** | Signature: dark interval language (tritones, minor seconds), characteristic textural density, odd-time cycles |

### Can the same ontology represent all three WITHOUT genre-specific fields?

**Yes, IF the ontology has:**
- **Selectable grammars** (bass grammar, groove grammar, contrast grammar) — not hardcoded KbBB
- **Causal chains** (expectation → tension → anticipation → payoff) — not just schedules
- **Material relationships** (derives-from, answers, contrasts-with) — not just role relationships
- **Section functions** (establish, develop, contrast, peak, resolve) — not just section labels
- **Expectation states** (what the listener expects) — not just lifecycle states
- **Contrast as grammatical change** — not just parametric difference
- **Artist identity** as tracked emergence — not just style parameters

**The previous ontology CAN represent all three, but only by overloading its existing fields. It lacks the causal, grammatical, and expectation concepts needed to distinguish them structurally.**

---

## 17. "Remove the Renderer" Test

### Imagine PSY4 does not exist

Foundation must still describe a compelling piece of music. If the model becomes meaningless when synthesis parameters are removed, it is not a composition model.

### Applying the test

Strip the previous model of all synthesis-adjacent fields:
- Remove `registerIntent` (synthesis-adjacent — it maps to EQ/synthesis register)
- Remove `sidechainIntent` (synthesis-adjacent — it maps to compressor)
- Remove `filter-state-transform` as a development axis (synthesis-adjacent)
- Remove `layer-context-transform` (partially synthesis-adjacent)

What remains?
- Musical material (motifs, rhythm cells, bass patterns, harmonic material) ✅
- Track identity (tonic, scale, tempo) ✅
- Sections and phrases ✅
- Material relationships (partially) ⚠️
- Development schedule (without the synthesis-adjacent axes) ⚠️

**What's lost:**
- The causal chain (why events happen)
- The grammatical state (what grammar is active)
- The expectation state (what the listener expects)
- The contrast structure (how sections differ grammatically)
- The groove grammar (how rhythmic grids relate)
- The midrange conversation (how elements fill each other's gaps)

**Verdict: the previous model partially survives the "remove the renderer" test — its material and identity survive, but its causal, grammatical, and expectation layers (which were never there) are still missing.**

### The converse: PSY4 choosing different sounds for the same composition

The model should allow PSY4 to realize the same composition with different sounds:
- Same motif, different synth (FM vs wavetable vs sample)
- Same groove grammar, different kick sample
- Same harmonic context, different pad timbre

**The previous model supports this** — it doesn't prescribe synthesis. ✅

But the model should also allow PSY4 to realize the same composition with different **performance interpretations**:
- Same motif, different articulation
- Same groove, different microtiming feel
- Same section, different density realization

**The previous model partially supports this** — performance intent is mentioned but not formalized.

---

## 18. "Four Instruments" Test

### Can the model demand more than kick/bass/lead/hat when the musical idea requires it?

**Not through `numberOfRoles = 12`.** Through **musical necessity**:

| Musical necessity | What the composition generates |
|---|---|
| The lead creates melodic gaps | → COUNTERLINE enters to fill them (causal) |
| The groove needs a secondary grid | → PERCUSSION enters against kick/bass (grammatical) |
| The harmonic context needs sustenance | → PAD enters to sustain it (functional) |
| The breakdown needs environment | → ATMOSPHERE enters to provide it (contrast) |
| The transition needs escalation | → RISER enters to build tension (causal) |
| The primary motif needs a response | → secondary motif enters as RESPONSE (material relationship) |
| The phrase needs punctuation | → PLUCK enters at boundaries (grammatical) |

### The model should produce musical necessity, not merely permit more tracks

The composition itself, through its causal and grammatical structure, should **require** additional material. Not "you can add a counterline" but "the lead's gaps and the section's development require a counterline."

**The previous model permits additional tracks but doesn't generate necessity.** The missing causal/grammatical layer is what would generate it.

---

## 19. "No Parameter Padding" Audit

### Reject fields whose only purpose is helping PSY4 implement something

| Field | Purpose | Verdict |
|---|---|---|
| `midrangeDensity` | forcing more midrange | ❌ REJECT (musical absence as mixing parameter) |
| `oscillatorType` | synthesis | ❌ REJECT (HOW) |
| `cutoff`, `resonance` | synthesis | ❌ REJECT (HOW) |
| `samplePath` | synthesis | ❌ REJECT (HOW) |
| `envelopeMs` | synthesis | ❌ REJECT (HOW) |
| `eqLow/Mid/High` | mix | ❌ REJECT (MIX) |
| `compressorThreshold` | mix | ❌ REJECT (MIX) |
| `lufs` | master | ❌ REJECT (MASTER) |
| `stereoWidth` | mix | ❌ REJECT (MIX) |
| `numberOfRoles` | forcing density | ❌ REJECT (parameter padding) |

### Every field must answer: "What musical fact does this represent?"

| Field | Musical fact | Verdict |
|---|---|---|
| Motif identity features (contour, intervals, accent) | the motif's recognizable identity | ✅ KEEP |
| Material relationships (derives-from, answers) | how materials relate musically | ✅ KEEP |
| Causal chain (expectation → tension → payoff) | why events happen | ✅ ADD (missing) |
| Grammatical state (active groove grammar, harmonic grammar) | what rules govern the music now | ✅ ADD (missing) |
| Section function (establish, develop, contrast, peak) | what the section does musically | ✅ ADD (missing) |
| Expectation state | what the listener expects | ✅ ADD (missing) |
| Contrast structure | how sections differ grammatically | ✅ ADD (missing) |
| Groove grammar (multi-grid system) | how rhythmic grids relate | ✅ ADD (missing) |
| Artist identity (signature choices) | what makes this track recognizable | ✅ ADD (missing) |
| `registerIntent` | musical register | ⚠️ KEEP but clarify (musical register, NOT EQ) |
| `sidechainIntent` | "bass yields to kick" | ⚠️ KEEP but clarify (musical priority, NOT compressor) |
| `filter-state-transform` | development axis (same notes, different filter state) | ⚠️ KEEP but reframe (musical transformation, NOT synthesis param) |

---

## 20. The Minimum Genuine Composition Model

After adversarial analysis, the smallest set of concepts required:

### A. Identity
- **Track identity**: tonal, temporal, narrative
- **Artist identity**: signature material+grammar+development choices (emergent, tracked)
- **Genre grammar**: conventions + tendencies (constraints, not recipes)

### B. Material
- **Motifs**: with testable identity (weighted recognition function over contour, intervals, rhythm, accent, distinctive features)
- **Rhythm cells**: with cycle structure (bar-aligned + odd-time)
- **Bass patterns**: with grammar (classic rolling, melodic, syncopated, broken, etc.)
- **Harmonic material**: chords, voicings, drones, harmonic rhythm
- **Material relationships**: derives-from, answers, contrasts-with, reinforces, anticipates, interrupts, ornaments, replaces, recalls, completes

### C. Grammar
- **Groove grammar**: multi-grid system (primary kick/bass grid + secondary percussion grid + tertiary hat grid), with relationships (reinforcement, counterpoint, syncopation) and variation
- **Bass grammar**: selectable pattern + variations + section overrides
- **Harmonic grammar**: chord change rules, harmonic rhythm conventions
- **Contrast grammar**: how sections differ grammatically (rhythmic, register, timbral, harmonic, motif, density, silence, expectation violation, phrase asymmetry, texture, perspective)

### D. Causality
- **Expectation state**: what the listener expects (based on established material and repetition)
- **Tension state**: how much expectation has been violated
- **Anticipation state**: how much a return is pending
- **Payoff state**: whether expectation has been fulfilled
- **Causal consequences**: event X happened, THEREFORE event Y must happen (e.g., motif established → expectation created → variation required → tension → escalation or withholding)

### E. Development
- **Causal sequence**: introduction → establishment → repetition → variation → mutation → fragmentation → interruption → withholding → anticipation → callback → transformation → recombination → payoff
- **Timing logic**: why this transformation happens now (derived from expectation/tension/anticipation state)
- **Motif dramatic function**: what role the motif plays at this moment (introduction, callback, payoff — not just its notes)

### F. Negative Space (as expectation)
- **Expected presence**: listener expects this element (absence creates tension)
- **Expected absence**: listener expects absence (presence would surprise)
- **Pending return**: element removed, return anticipated
- **Function completed**: element served its purpose, won't return
- **Yielding**: element absent because another is foregrounded

### G. Arrangement
- **Section function**: establish, develop, contrast, peak, resolve (not just type label)
- **Material flow**: inherited, introduced, withheld, transformed material per section
- **Section expectation/payoff**: what each section sets up and fulfills
- **Narrative arc**: multi-arc structure with peaks and resolution
- **Transition logic**: how sections connect causally

### H. Contrast
- **Grammatical change**: contrast as a change in active grammar (not parametric difference)
- **Contrast types**: rhythmic, register, timbral, harmonic, motif, density, silence, expectation violation, phrase asymmetry, texture, perspective

### I. Long-Term Coherence
- **Identity preservation**: motif identity survives transformation (testable)
- **Transformation accumulation**: motif's history shapes its current meaning
- **Context evolution**: surrounding material's history shapes perception
- **Expectation evolution**: listener's state changes over the track
- **Dramatic function evolution**: motif's role changes (introduction → callback → payoff)

---

## 21. Final Gate

### Verdict: **CONDITIONAL GO**

The model is fundamentally sound — it has material, identity, relationships, and boundary discipline. But specific conceptual gaps must be resolved before schema design:

### Gaps to resolve (in a revised ontology, not yet a schema)

1. **Causal/grammar layer** — add expectation, tension, anticipation, payoff as states that drive compositional decisions (not reason strings)
2. **Groove grammar as multi-grid system** — not just kick+bass coupling + percussion density
3. **Motif identity as testable recognition function** — weighted features, threshold, recognition logic
4. **Development as causal sequence** — not a schedule; timing derived from musical state
5. **Contrast as grammatical change** — not parametric difference
6. **Negative space as expectation state** — not lifecycle state
7. **Section function + material flow + expectation/payoff** — not just section labels
8. **Material relationships** (derives-from, answers, contrasts-with, etc.) — not just role relationships
9. **Midrange as conversational system** — not instrument inventory
10. **Bass grammar as selectable+variable system** — not canonical KbBB
11. **Genre as constraint set (not recipe)** — separate convention/tendency/grammar/artist/track-specific
12. **Artist identity as tracked emergence** — signature choices, cross-track recurrence

### What the previous model got right (keep)

- Musical material (motifs, rhythm cells, bass patterns, harmonic material)
- Track identity (tonal, temporal, stylistic)
- Inter-role relationships (couple, complement, contrast, call/response)
- Boundary discipline (WHAT/HOW/MIX separation)
- Role lifecycle (as a starting point — but negative space needs expectation semantics)
- Sidechain intent as banded musical parameter
- Forward-looking development (as a starting point — but needs causal timing)
- Multi-level arrangement (track/section/phrase/bar/event)
- Style profile (as a starting point — but needs convention/tendency/grammar/artist separation)

### What GO does NOT mean

- ❌ Does NOT mean schema design can begin immediately
- ❌ Does NOT mean Foundation should be changed
- ❌ Does NOT mean V2 schema exists
- ❌ Does NOT approve any architecture

### Next step

A **revised ontology document** that addresses the 12 gaps above — still no schema, still no code, still no Foundation changes. The revised ontology must demonstrate:
- Causal chains (not reason strings)
- Grammatical states (not just parameters)
- Expectation/payoff (not just lifecycle)
- Testable motif identity
- Midrange as conversation
- Groove as multi-grid grammar
- Section function (not just labels)
- Contrast as grammatical change
- Artist identity as emergence
- Three compositions distinguishable structurally (not just parametrically)

Only after the revised ontology passes this gate does schema design begin.

---

## HARD STOP

- ❌ No code, no Foundation changes, no PSY4 changes, no V2 schema, no architecture approved
- ✅ Adversarial review complete; 12 conceptual gaps identified; previous model deemed fundamentally sound but incomplete

**Verdict: CONDITIONAL GO.** The model is not yet a genuine composition model — it is a sophisticated role/intent metadata system missing the causal, grammatical, and expectation layers that would make it genuinely compositional.

**The goal is not to make PSY4 "handle more instruments." The goal is to give PSY4 a real musical composition to realize — and that requires a model that represents musical causality, grammar, identity, expectation, development, contrast, and long-term coherence, not just a rich set of role/intent labels.**
