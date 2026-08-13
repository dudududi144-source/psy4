# PSY4 — Composition Engine Ontology Challenge

**Status:** ONTOLOGICAL CHALLENGE. No code. No schema. No Foundation/PSY4 changes. No audio. No V1 rerun. No implementation. No architecture approval.
**Question under test:** Is the model a genuine composition engine, or a sophisticated metadata system that describes already-decided music?
**Date:** 2024-08-13

---

## 0. Honest Starting Position

Across the full history of PSY4:

- V1 started with 4 roles (kick/bass/lead/hat) and failed on midrange density, masking, pitch, loudness.
- The Musical Model Redesign expanded the role set, added lifecycle, arrangement, development, interactions, midrange.
- The Deep Composition Model Review added intent, identity, material relationships, long-form structure.
- The Adversarial Review identified 12 gaps and gave CONDITIONAL GO, but admitted the model "may still be only a sophisticated role/intent metadata system."

**I take that warning seriously. It is now the central question.**

A descriptive model says: `bar 128 → add counterline → density 0.6`

A compositional model says: `lead motif has established identity → repetition created expectation → current phrase becoming predictable → harmonic space partially empty → therefore a secondary answering voice becomes musically justified → counterline enters → creates contrast → expectation changes → later withholding becomes meaningful`

The first describes events. The second generates musical causality.

**Honest self-assessment: every model I have proposed so far is the first kind.** The "reason strings" and "intent" fields are annotations on already-decided events. They are not inference. This document attempts to determine whether a genuine causal model is achievable, and if so, what it requires.

---

## 1. The Full PSY4 History — What It Tells Us

| Phase | What was added | Was it causal? |
|---|---|---|
| V1 | 4 roles, hardcoded patterns | No — pure description |
| Musical Model Redesign | Role ontology, lifecycle, arrangement, interactions | No — still description with more labels |
| Deep Composition Model Review | Intent, identity, material relationships, long-form | Partially — "intent" is a label, not inference |
| Adversarial Review | Identified 12 gaps including causality, grammar, expectation | Diagnosis only — did not build the causal layer |

**The trajectory has been: more labels, richer description, but no inference.** Each phase added vocabulary to describe music that was already decided. None built a mechanism that decides what comes next.

This is the pattern of a metadata system growing more sophisticated, not a composition engine emerging.

---

## 2. The Central Question

> Can the model take an existing musical state and infer what the next musical event should be — and why?

If the answer is "the schema says so" or "because section X has density Y" — the model fails.

The model must be able to build **musical necessity**: a state where not doing the next thing would be musically wrong, and doing it is causally motivated by what came before.

---

## 3. Composition From Nothing Test

I will actually attempt this. Starting state:

```
tempo = 145
meter = 4/4
tonic = E
scale = phrygian-dominant
subgenre = full-on
seed = 2-bar kick+bass pattern (KbBB)
```

### What must the model itself decide?

#### Step 0: Initial state

After the seed plays once:
- rhythmic_foundation = established (kick+bass present)
- motif_identity = none
- repetition_count (groove) = 1
- listener_familiarity (groove) = low
- expectation_level = low (nothing to expect yet)
- register_occupancy = { sub: occupied, bass: occupied, low-mid: empty, mid: empty, high-mid: empty, high: empty, air: empty }
- unresolved_material = none
- contrast_debt = 0
- material_exhaustion = none

#### Step 1: After 4-8 bars of kick+bass repetition

State changes:
- repetition_count (groove) = 4-8
- listener_familiarity (groove) = medium
- expectation_level (groove) = high (listener expects continuation)
- rhythmic_saturation (low register) = high
- register_occupancy unchanged (still sub+bass only)

**Inference the model must make:**
> The low-end rhythmic foundation is established and saturated. The high register is empty. The groove has enough stability to support subdivision without competing for attention. Therefore: a high-frequency rhythmic subdivision (hat) becomes musically justified.

**Why this is causal, not descriptive:**
- The hat's entry is motivated by: (a) groove saturation, (b) empty high register, (c) sufficient stability to support a new layer.
- If the groove had not repeated enough, the hat would be premature (groove not yet established).
- If the high register were already occupied, the hat would conflict.
- The inference is: `groove_stability > threshold AND register_occupancy[high] = empty → hat enters`

**Can the previous model do this?** No. The previous model would declare `hat.lifecycle = introduced at bar 8` with `reason = "groove driver"`. That's a schedule with a reason string. It does not check groove stability or register occupancy.

#### Step 2: After 4-8 more bars with hats

State changes:
- secondary_rhythmic_grid = established (hats in high register)
- expectation_level (groove) = stable (groove is now background)
- motif_identity = still none
- listener has: rhythmic foundation + subdivision, but no melodic identity to remember

**Inference:**
> The rhythmic foundation is complete. There is no melodic identity — the listener has nothing to remember. The mid/high-mid register is empty. Therefore: a lead motif should enter to establish melodic identity.

**Why causal:**
- The lead's entry is motivated by: (a) rhythmic foundation complete, (b) absent melodic identity, (c) empty mid register.
- If the rhythmic foundation were not complete, the lead would be premature.
- If a motif already existed, another lead would conflict.
- Inference: `rhythmic_foundation = complete AND motif_identity = none AND register_occupancy[mid] = empty → lead enters`

**Can the previous model do this?** No. It would declare `lead.lifecycle = introduced at bar 16` with `reason = "identity + hook"`. Schedule + reason string, not inference.

#### Step 3: After lead motif plays 4-8 bars

State changes:
- motif_identity = established
- repetition_count (motif) = 2-4
- listener_familiarity (motif) = medium
- expectation_level (motif) = high (listener expects continuation)
- predictability = increasing
- material_exhaustion (motif) = approaching (repetition threshold nearing)

**Inference:**
> The motif has established identity. Continued repetition will cause saturation and predictability. Variation becomes musically meaningful — it creates tension by partially violating expectation. Therefore: the motif should vary.

**Why causal:**
- Variation is motivated by: (a) established identity (variation is only meaningful if identity exists), (b) approaching exhaustion, (c) predictability creating need for novelty.
- If the motif had not been repeated enough, variation would be premature (identity not yet established).
- If the motif were already exhausted, variation alone might not be enough — fragmentation might be required.
- Inference: `motif_familiarity > threshold AND predictability > threshold AND material_exhaustion < critical → vary motif`

**Can the previous model do this?** No. It would declare `development.variations = [{ atBar: 120, operator: transpose, reason: "section moves to development" }]`. The bar number is pre-decided. The reason is a string. There is no check on familiarity, predictability, or exhaustion.

#### Step 4: After variation

State changes:
- expectation_violation = occurred (motif changed)
- tension_level = increased
- unresolved_material = motif is varied, listener wonders where it's going
- register_occupancy = lead in mid/high-mid, lower-mid still empty
- harmonic_context = established but not sustained (no pad)

**Inference:**
> The varied motif has created tension. The lower-mid register is empty (no harmonic sustain). An answering voice in the complementary register would provide contrast and partial resolution. Therefore: a counterline enters.

**Why causal:**
- Counterline entry is motivated by: (a) tension from variation, (b) empty complementary register, (c) need for response to the varied motif (unresolved question).
- If there were no tension, the counterline would be unmotivated.
- If the complementary register were occupied, the counterline would conflict.
- Inference: `tension_level > threshold AND register_occupancy[complementary] = empty AND unresolved_material = varied motif → counterline enters`

**Can the previous model do this?** No. It would declare `counterline.lifecycle = introduced` with `reason = "response + contrast"`. No check on tension, register, or unresolved material.

#### Step 5: After counterline plays

State changes:
- conversational_relationship = established (lead ↔ counterline)
- tension_level = partially resolved (counterline answered)
- register_occupancy = mid is now fuller
- material_exhaustion (groove) = high (groove has been playing for many bars)
- contrast_debt = increasing (no grammatical change has occurred in a while)

**Inference (approaching breakdown):**
> The groove has been saturated for many bars. The melodic material has been established and varied. The contrast debt is high — no grammatical change has occurred. The listener expects either escalation or contrast. A breakdown would provide grammatical contrast (suspend the groove grammar, foreground harmonic material, create anticipation for return). Therefore: a breakdown is musically justified.

**Why causal:**
- Breakdown is motivated by: (a) groove saturation/exhaustion, (b) contrast debt, (c) need to create anticipation for payoff.
- If the contrast debt were low, a breakdown would be premature.
- If the material were not yet established, the breakdown would lose its reference point.
- Inference: `groove_exhaustion > threshold AND contrast_debt > threshold AND motif_identity = established → breakdown`

**Can the previous model do this?** No. It would declare `section.type = BREAKDOWN at bar 144` with `roleActivity = { kick: muted, bass: muted, ... }`. Pre-decided bar number. No check on exhaustion, contrast debt, or establishment.

### Verdict on the Composition From Nothing test

**The previous model CANNOT pass this test.** Every decision is pre-scheduled with reason strings. There is no state tracking, no inference, no causal necessity.

**A genuine composition model CAN pass this test** — but only if it has:
- Observable state variables that change based on events
- Inference rules that map state to necessary actions
- The ability to say "not yet" (premature) and "no longer" (exhausted)

---

## 4. State vs Cause — The Critical Separation

### Observable musical state (changes based on events)

| State variable | What it tracks | How it changes |
|---|---|---|
| `repetition_count` (per material) | how many times material has played | increments on each play |
| `listener_familiarity` (per material) | how well the listener knows this material | increases with repetition, decays slowly with absence |
| `rhythmic_saturation` (per register) | how dense the rhythm is in each register | increases when rhythm cells play, decreases in gaps |
| `harmonic_stability` | how settled the harmony is | increases with chord repetition, decreases with changes |
| `expectation_level` (per material + overall) | what the listener expects | increases with repetition, resets on violation |
| `tension_level` | how much tension exists | increases with violation, dissonance, density; decreases with resolution |
| `unresolved_material` | what musical "questions" are pending | increases when material asks (variation, call), decreases when answered |
| `available_register_space` | which registers are empty | changes as roles enter/exit |
| `contrast_debt` | how much contrast is owed | increases with time since last grammatical change, resets on contrast |
| `material_exhaustion` (per material) | how saturated each material is | increases with repetition, decreases with transformation |
| `anticipation_level` | how much a return is pending | increases when material is withheld, resets on return |
| `groove_stability` | how established the groove is | increases with repetition, decreases with variation |
| `conversational_balance` | whether the midrange conversation is balanced | changes as elements enter/exit |

### Musical causes / rules (mapping state to action)

| Rule | When it fires | What it prescribes |
|---|---|---|
| repetition creates expectation | repetition_count > threshold | expectation_level increases |
| expectation enables meaningful violation | expectation_level > threshold AND material not exhausted | variation becomes justified |
| unresolved question creates pressure for response | unresolved_material is non-empty | secondary material (counterline/response) becomes justified |
| exhausted material creates need for transformation | material_exhaustion > threshold | transformation (fragment, register shift, etc.) becomes necessary |
| register saturation creates reason for thinning | rhythmic_saturation[register] > threshold | thin that register |
| absence creates return value | material withheld AND anticipation_level > threshold | callback becomes justified |
| established motif creates justification for callback | motif_familiarity > threshold AND motif currently absent | callback opportunity exists |
| unresolved harmonic motion creates reason for continuation | harmonic_stability < threshold | continue harmonic motion |
| groove saturation creates reason for new rhythmic grid | groove_stability > threshold AND no secondary grid | add secondary grid (percussion) |
| contrast debt creates reason for grammatical change | contrast_debt > threshold | breakdown/contrast section becomes justified |

### The state must change as a result of musical events

This is the critical requirement. The state is not declared — it is **computed** from the history of events. When a motif plays, `repetition_count` increments. When it's withheld, `anticipation_level` increases. When variation occurs, `tension_level` increases and `expectation_level` partially resets.

**The previous model has none of this.** It has lifecycle states (declared), development schedules (pre-decided), reason strings (annotations). The state is not computed; it is declared.

---

## 5. Causal Musical State Machine — Conceptual Model

Here is one full causal chain, with state transitions explained:

```
EVENT: material introduced (motif A plays for the first time at bar 80)
  STATE CHANGE:
    - motif_identity[A] = established (contour/intervals/accent encoded)
    - repetition_count[A] = 1
    - listener_familiarity[A] = low
    - expectation_level[A] = low (nothing to expect yet)
    - unresolved_material = none
  WHY THIS IS ALLOWED:
    - rhythmic_foundation = complete (groove established)
    - register_occupancy[mid] = empty (space for motif)
    - motif_identity = none (no conflicting identity)
  WHAT WOULD HAPPEN IF NOT DONE:
    - rhythmic saturation would increase without melodic identity
    - listener would have nothing to remember
    - track would remain a groove without identity

EVENT: repetition (motif A plays again, bars 88-119)
  STATE CHANGE:
    - repetition_count[A] = 2, 3, 4, 5...
    - listener_familiarity[A] = medium → high
    - expectation_level[A] = high (listener now expects continuation)
    - predictability = increasing
    - material_exhaustion[A] = approaching threshold
  WHY THIS IS ALLOWED:
    - expectation requires repetition to build
    - identity requires reinforcement
  WHAT WOULD HAPPEN IF NOT DONE:
    - motif would not establish identity
    - later variation would be meaningless (nothing to violate)

EVENT: variation (motif A transposed +2 at bar 120)
  STATE CHANGE:
    - expectation_violation = occurred
    - tension_level = increased
    - expectation_level[A] = partially reset (listener re-evaluates)
    - unresolved_material = [motif A varied — where is it going?]
    - material_exhaustion[A] = partially relieved (novelty injected)
  WHY THIS IS JUSTIFIED NOW (not 16 bars earlier):
    - repetition_count[A] was high enough (5 phrases) to establish expectation
    - material_exhaustion was approaching threshold
    - predictability was high enough that violation is meaningful
  IF DONE 16 BARS EARLIER:
    - expectation would not have been established
    - violation would be meaningless (nothing to violate)
    - motif identity would be unstable

EVENT: secondary material responds (counterline enters at bar 128)
  STATE CHANGE:
    - conversational_balance = established (lead ↔ counterline)
    - unresolved_material = partially resolved (counterline answers)
    - register_occupancy[complementary] = occupied
    - tension_level = partially resolved
  WHY JUSTIFIED:
    - tension_level was high (from variation)
    - register_occupancy[complementary] was empty
    - unresolved_material was non-empty (varied motif asked a question)
  IF NOT DONE:
    - tension would remain unresolved
    - midrange conversation would be one-sided
    - the varied motif's question would hang

EVENT: material withheld (motif A removed at bar 144, breakdown)
  STATE CHANGE:
    - anticipation_level = increasing
    - contrast_debt = reset (grammatical change occurred)
    - groove_stability = suspended (groove grammar changed)
    - register_occupancy = { sub: empty, bass: empty, mid: sparse, ... }
    - unresolved_material = [motif A absent — will it return?]
  WHY JUSTIFIED:
    - contrast_debt was high (no grammatical change for many bars)
    - groove_exhaustion was high
    - motif_familiarity was high enough that absence creates anticipation
  IF NOT DONE:
    - contrast_debt would keep increasing
    - groove would become monotonous
    - no anticipation would build for the drop

EVENT: return / payoff (motif A returns at bar 192, drop)
  STATE CHANGE:
    - anticipation_level = resolved (payoff delivered)
    - expectation_level[A] = fulfilled
    - tension_level = released
    - groove_stability = resumed (grammatical change reversed)
    - material_exhaustion[A] = partially relieved (transformation adds novelty)
  WHY JUSTIFIED:
    - anticipation_level was high (motif was withheld)
    - contrast_debt was reset (breakdown provided contrast)
    - motif_familiarity was high (return is recognizable)
  IF NOT DONE:
    - anticipation would remain unresolved
    - listener would feel cheated
    - the breakdown would have no payoff
```

### For each transition, the four required answers:

| Transition | What changed musically? | What state was created? | Why does this state enable the next action? | What if the action didn't happen? |
|---|---|---|---|---|
| introduce → establish | motif enters | identity encoded, familiarity low | repetition can build expectation | no identity to develop |
| establish → repeat | motif plays again | familiarity increases, expectation builds | expectation enables meaningful variation | identity would be weak |
| repeat → vary | motif changes | tension increases, expectation violated | tension creates need for response | predictability would cause monotony |
| vary → respond | counterline enters | tension partially resolved, conversation established | response balances the conversation | tension would hang unresolved |
| respond → withhold | motif removed | anticipation increases, contrast debt reset | anticipation enables meaningful return | contrast debt would grow, groove would saturate |
| withhold → return | motif returns | anticipation resolved, payoff delivered | payoff fulfills the anticipation | listener would feel cheated |
| return → transform | motif changes context | exhaustion relieved, novelty injected | transformation prevents immediate re-saturation | return would feel like mere repetition |

**This is a causal chain. Each event is motivated by the state, and each event changes the state to motivate the next.**

### Can the previous model represent this?

**No.** The previous model can describe each event (lifecycle, operator, reason string) but cannot:
- Track the state variables (repetition_count, familiarity, expectation, tension, anticipation, contrast_debt, exhaustion)
- Apply the inference rules (mapping state to necessary action)
- Explain why the timing is correct (not 16 bars earlier)
- Explain what would happen if the action didn't occur

---

## 6. "More Instruments" Is Not the Solution

### Three scenarios

**A — Four roles only:** Kick / Bass / Lead / Hat

**B — Twelve roles:** Kick / Bass / Hats / Perc / Lead / Acid / Counterline / Pluck / Pad / Atmosphere / Texture / FX

**C — Twelve potential roles but only 5 active**

### Can the model explain:

**Why A feels skeletal:**
- `register_occupancy`: mid is occupied only by lead (sparse); low-mid, sustained-harmonic, and transition registers are empty
- `conversational_balance`: no midrange conversation (lead is alone)
- `harmonic_stability`: no sustained harmonic material (no pad/drone)
- `contrast_debt`: no transition material (no riser/impact for contrast)
- `groove_grammar`: only primary grid (kick/bass) + tertiary grid (hats); no secondary grid (percussion)
- `unresolved_material`: lead's variations have no one to answer them

**Why B can be rich:**
- All registers occupied
- Conversational balance possible (lead ↔ acid ↔ counterline)
- Harmonic sustain present (pad)
- Transition material present (FX)
- Multi-grid groove (kick/bass + perc + hats)

**Why C (5 active of 12 potential) can be musically correct:**
- The 5 active roles satisfy all current musical necessities
- `register_occupancy`: all necessary registers filled
- `conversational_balance`: balanced (lead + counterline)
- `groove_grammar`: complete (primary + secondary + tertiary)
- `material_exhaustion`: no role is exhausted
- `contrast_debt`: low (recent contrast)
- The 7 inactive roles are **not needed** — adding them would create redundancy, not richness

### The critical test: can the model say "this role is NOT needed right now"?

**Yes, if the model has the state variables:**
- `register_occupancy[register] = occupied` → no new role in that register
- `conversational_balance = balanced` → no new answering voice needed
- `groove_grammar = complete` (all grids present) → no new rhythmic role needed
- `material_exhaustion = low` → no transformation needed
- `contrast_debt = low` → no contrast section needed

**The previous model cannot do this.** It can declare a role as `absent` but cannot explain WHY it's absent (because the musical necessity for it doesn't exist).

### The model must know when NOT to add

This is the difference between "permitting more tracks" and "generating musical necessity." A composition engine says: "the counterline is not needed because the lead is not yet varied, the register is not yet empty, and the conversation is not yet unbalanced."

---

## 7. Midrange as Conversation, Not Inventory

### The conversational chain

```
LEAD establishes statement (bar 80)
  → creates melodic identity
  → leaves rhythmic/harmonic gaps (between phrases, between statements)
    ↓
ACID answers rhythmically (bar 120)
  → fills the lead's rhythmic gaps with evolving filter motion
  → creates psychedelic tension against the lead's clarity
  → asks its own question (where is the filter going?)
    ↓
PERC punctuates (bar 88, ongoing)
  → marks phrase boundaries the lead plays across
  → creates a secondary rhythmic grid against kick/bass
  → provides rhythmic contrast to the lead's melodic flow
    ↓
COUNTERLINE fills complementary register (bar 128)
  → provides harmonic context the lead implies but doesn't state
  → answers the lead's melodic questions
  → creates contrast (register, melodic direction)
    ↓
LEAD returns (after variation)
  → the conversation resumes with new context
    ↓
ACID becomes sparse
  → because the lead is active again, the acid doesn't need to fill gaps
  → conversational balance shifts
    ↓
whole phrase resolves
  → the conversation has completed a cycle
```

### What makes this a conversation, not an inventory

- **Each element's entry is motivated by a gap or question created by another element**
- **Each element's exit is motivated by the conversation balance changing**
- **The elements are causally linked** (acid answers lead, counterline answers lead+acid, perc punctuates the whole)
- **The density of each element tracks the conversational state** (acid becomes sparse when lead returns)

### Can the model represent this?

**Only with the conversational state variables:**
- `conversational_balance` (is the midrange conversation balanced?)
- `unresolved_questions` (which elements have asked questions that aren't answered?)
- `gap_presence` (which registers/times have gaps that need filling?)

**The previous model declares relationships** (lead ↔ counterline = call-response) **but doesn't model the conversational dynamics** (when does the counterline become necessary? when does it become redundant?).

---

## 8. Groove as Multi-Grid Grammar

### Three grids

**Primary grid (kick/bass):**
- The foundational pulse
- Defines the bar structure (4-on-floor)
- Carries the low-end energy

**Secondary grid (percussion/clap/snare/ghost):**
- Against the primary grid
- Creates rhythmic counterpoint
- Marks phrase boundaries
- Provides groove depth

**Tertiary grid (hats/rides/micro-rhythm/accents):**
- Subdivision
- Energy sustainer
- Textural rhythm

### Grid relationships

| Relationship | Example |
|---|---|
| **reinforcement** | rides reinforce hat subdivision (same grid, denser) |
| **opposition** | percussion plays off-beat against kick on-beat |
| **syncopation** | ghost percussion plays between the grids |
| **anticipation** | percussion anticipates the next bar |
| **interruption** | fill interrupts the groove at phrase end |
| **density transfer** | when primary grid thins (breakdown), secondary/tertiary may compensate or also thin |
| **rhythmic silence** | a gap in all grids creates dramatic silence |

### The groove can evolve without the kick pattern changing

- The secondary grid can enter/exit/vary independently
- The tertiary grid can change density
- Syncopation patterns can shift
- The relationship between grids can change (reinforcement → opposition → syncopation)

**This is what makes a groove feel alive over 7 minutes — not the kick pattern changing, but the grid relationships evolving.**

### Can the previous model represent this?

**No.** The previous model has "groove systems" (swing, feel, accent, ghost, space) as parameter containers. It does not model:
- Multiple grids
- Grid relationships
- Grid evolution independent of the kick pattern

---

## 9. Bass Must Not Be a Single Recipe

### Bass grammar families

| Family | Pattern | When chosen |
|---|---|---|
| **rolling** | KbBB | standard groove, forward momentum |
| **syncopated rolling** | KbBB with syncopation | hypnotic, less driving |
| **melodic rolling** | KbBB following chord changes | harmonic development |
| **broken** | pattern varies per phrase | development, variation |
| **progressive** | sparser, more space | long-form groove, space |
| **dark/high-density** | every 16th, sometimes 32nds | relentless, dense |

### What causes the composition to choose a family?

**Not:** `subtype = full-on → KbBB`

**But:** the selected bass grammar follows from:
- `groove_identity` (what is the track's characteristic groove?)
- `energy_level` (higher energy → denser bass)
- `motif_relationship` (does the bass follow the motif's harmonic motion?)
- `section_function` (breakdown → suspended; drop → densified)
- `stylistic_tendency` (full-on tends to roll; darkpsy tends to densify)
- `material_exhaustion` (if current grammar is exhausted, vary or switch)

**The choice is causally motivated by the musical state, not by a genre lookup.**

---

## 10. Arrangement as Narrative System

### For each section, the model must specify:

| Property | BREAKDOWN example | DROP example |
|---|---|---|
| **inherited** | primary motif identity | transformed motif from breakdown |
| **introduced** | harmonic atmosphere, fragment of motif | full groove, transformed motif |
| **transformed** | motif fragmented | motif register-shifted |
| **withheld** | kick, bass, primary groove | (nothing — full energy) |
| **expectation created** | "the groove will return" | "the peak is here" |
| **expectation violated** | groove suspended | (fulfilled, not violated) |
| **paid off** | (setup for drop) | the anticipation from breakdown |
| **listener's knowledge changes** | "the motif exists in fragmented form" | "the motif returns transformed" |

### Why BREAKDOWN at bar 144 and not bar 128?

- At bar 128: `contrast_debt` was not yet high enough (only 16 bars since last contrast)
- At bar 128: `material_exhaustion` was not yet critical (motif had only varied once)
- At bar 144: `contrast_debt` is high (32+ bars without grammatical change)
- At bar 144: `groove_exhaustion` is high (groove has played for 96 bars)
- At bar 144: `motif_familiarity` is high enough that withholding creates anticipation

**The timing is causally motivated, not scheduled.**

---

## 11. Musical Memory

### What the model must know about what has happened

| Memory element | Example |
|---|---|
| **what the listener has heard** | motif A (bar 80, varied bar 120, fragmented bar 144, returned bar 192) |
| **how many times** | motif A: 5 repetitions + 2 variations + 1 callback |
| **in what context** | motif A was introduced over KbBB groove, returned over intensified groove |
| **in what form** | original, transposed, fragmented, register-shifted |
| **what has changed since** | the groove densified, the context evolved |
| **what is still unresolved** | motif A's second callback (DROP_2) is pending |
| **what has become familiar** | motif A is now highly familiar |
| **what has lost novelty** | the KbBB pattern is highly familiar (needs variation) |
| **what can still receive payoff** | motif A's final callback at DROP_2 |

### Without musical memory, there is no long-form composition

The model must track what has happened, in what form, and what is pending. This is not a log — it is a **state of the listener's knowledge** that drives future decisions.

---

## 12. Material Exhaustion

### When should a motif change?

**Not:** `atBar = 128`

**But:** the motif has completed its current dramatic function.

### Conceptual model

| Concept | Meaning |
|---|---|
| **repetition threshold** | how many repetitions before the listener wants change |
| **familiarity** | how well the listener knows the material |
| **saturation** | how much the material has been used |
| **novelty decay** | how much novelty remains |
| **transformation opportunity** | what transformations are available |
| **unresolved potential** | what the material could still do |
| **callback opportunity** | whether the material can be recalled later |

### How these affect timing

- `saturation > threshold` → transformation becomes necessary
- `novelty decay = high` → variation alone is insufficient; fragmentation or register shift needed
- `unresolved potential = high` → material can still be developed (don't remove yet)
- `callback opportunity = high` → material can be withheld for later payoff

**The timing of transformation is derived from the material's state, not from a schedule.**

---

## 13. Identity Must Be Dynamic

### Recognition principle

A motif remains "itself" when a **supermajority of its load-bearing identity features** survive transformation.

### What are load-bearing features?

They are **motif-specific**, not universal:
- A motif defined by its distinctive interval (e.g., a rising minor second) has that interval as load-bearing
- A motif defined by its rhythmic cell (e.g., a syncopated 3+3+2 pattern) has that rhythm as load-bearing
- A motif defined by its contour shape has contour as load-bearing

### Recognizable transformation vs identity break

| Transformation | What survives | What changes | Identity? |
|---|---|---|---|
| transpose | all melodic features | pitch register | same motif |
| register shift | all melodic features | register | same motif |
| rhythmic displacement | contour, intervals, accent | rhythm signature (shifted) | same motif (if rhythm not load-bearing) |
| fragmentation | distinctive features (partially) | contour (partial), phrase shape | same motif if >50% distinctive features survive; new motif otherwise |
| inversion | rhythm, accent, interval magnitudes | contour (inverted), interval directions | same motif if contour not load-bearing; new motif otherwise |
| contextual layering | all melodic features | context | same motif |

### The model must know the difference

- When a transformation preserves identity → callback (the listener recognizes it)
- When a transformation breaks identity → new motif (tracked via lineage, but not a callback)

**The recognition principle is: weighted similarity of load-bearing features above a threshold.**

---

## 14. Contrast as Grammar Change

### Contrast is not "remove kick"

| Section | Active grammar | Contrast type |
|---|---|---|
| **Groove** | continuous low-end, dense rhythmic grid, short motifs, forward momentum | — (baseline) |
| **Breakdown** | low-end suspended, harmonic material foregrounded, motif fragmented, longer temporal perception, space becomes meaningful | grammatical change (groove suspended, harmonic foregrounded) |
| **Build** | anticipation increases, rhythmic information narrows, transition material increases | grammatical change (narrowing, transition) |
| **Drop** | previous grammar returns, but with transformed material | grammatical return (with material transformation) |

### Contrast is a change in the active musical grammar

- The groove grammar changes (suspended in breakdown)
- The harmonic grammar changes (foregrounded in breakdown)
- The temporal grammar changes (longer perception in breakdown)
- The density grammar changes (sparse in breakdown, dense in drop)

**The model must track which grammar is active and represent contrast as a change in active grammar.**

---

## 15. Genre as Three Layers

### Convention (what's common in the genre)
- 4/4 kick, rolling bass, 8-bar phrase, 6-9 min length
- These are universal traits, not choices

### Grammar (what creates the musical syntax)
- "tension must resolve" (causal rule)
- "callbacks transform" (causal rule)
- "contrast requires grammatical change" (causal rule)
- These are the rules that govern musical behavior

### Track choice (what this specific track chooses)
- This track uses a pluck at phrase boundaries
- This track uses an acid line that enters at development
- These are decisions unique to this track, motivated by its musical state

### Artist identity (optional, what recurs across an artist's works)
- This artist favors specific interval language
- This artist tends to contrast via texture change
- This emerges from material + grammar + development choices, not from a preset

### This prevents "psytrance recipe generator"

Two tracks can both be psytrance (same convention), follow the same grammar (tension resolves, callbacks transform), but make very different track choices (one uses acid, the other uses counterline; one contrasts via texture, the other via register).

---

## 16. Artist Identity Must Emerge

### Identity emerges from recurring choices

- **recurring motifs** — this artist's motifs tend to use specific interval language
- **recurring rhythmic grammar** — this artist tends to use syncopated percussion
- **recurring contrast behavior** — this artist tends to contrast via texture change
- **recurring development strategies** — this artist tends to fragment before breakdowns
- **recurring material relationships** — this artist's motifs tend to call with a rising fourth, respond with a falling step
- **characteristic density transitions** — this artist tends to go from sparse to dense gradually
- **characteristic use of negative space** — this artist tends to use long breakdowns

### Artist identity is a history of choices, not a preset

The model tracks which choices are **signature** (defining this artist) vs **conventional** (genre-standard). Cross-track recurrence establishes identity.

---

## 17. Four-Instrument Failure Reconstruction

### Start with: KICK / BASS / LEAD / HAT

### How the model identifies what's missing (causally, not by role count)

| State observation | Inference |
|---|---|
| `rhythmic_foundation = complete` (kick+bass+hats) | No new rhythmic foundation needed |
| `motif_identity = established` (lead) | No new motif needed (yet) |
| `register_occupancy[mid] = lead only, sparse` | Mid register is under-occupied |
| `conversational_balance = unbalanced` (lead is alone) | Secondary voice needed for conversation |
| `unresolved_material = lead's variations have no answer` | Counterline becomes necessary |
| `harmonic_stability = low` (no sustained harmonic material) | Pad/drone becomes necessary |
| `groove_grammar = primary + tertiary only` (no secondary grid) | Percussion becomes necessary |
| `contrast_debt = high` (no grammatical change) | Breakdown/contrast becomes necessary |
| `anticipation_level = high` (after breakdown) | Riser/build becomes necessary |
| `atmospheric_identity = absent` (no atmosphere) | Atmosphere becomes necessary for environment |

### The solution arises from the musical state, not from "add roles until density is high"

- The counterline is added because the lead is alone and the mid register is under-occupied
- The pad is added because harmonic stability is low
- The percussion is added because the groove grammar is incomplete (no secondary grid)
- The atmosphere is added because there's no environmental context
- The breakdown is added because contrast debt is high
- The riser is added because anticipation needs to build

**Each addition is causally motivated. The model generates necessity, not permission.**

---

## 18. Same Parameters, Different Music Test

### Track A: coherent causal development

- Motif introduced at bar 80 (after groove established)
- Repeated 5 times (expectation built)
- Varied at bar 120 (tension created, because expectation was high)
- Counterline entered at bar 128 (because tension was high and register was empty)
- Withheld at bar 144 (because contrast debt was high and exhaustion was approaching)
- Returned at bar 192 (because anticipation was high)

### Track B: random/arbitrary event ordering

- Motif introduced at bar 80
- Withheld at bar 88 (before identity established — premature)
- Counterline entered at bar 96 (before lead varied — no question to answer)
- Motif returned at bar 104 (before anticipation built — no payoff)
- Varied at bar 200 (after it was already exhausted — meaningless)

### Can the model distinguish A from B?

**Yes, if the model has the state variables and inference rules:**

- Track A: each event is motivated by the state (expectation was high → vary; tension was high → respond; contrast debt was high → withhold; anticipation was high → return)
- Track B: events are NOT motivated by the state (withheld before identity established; counterline before question asked; return before anticipation built; variation after exhaustion)

**The model can say: "Track B is not musically coherent because event X occurred when state Y was not satisfied."**

**The previous model cannot do this.** It can describe both tracks with the same fields (lifecycle, operators, reason strings). It has no state to check against.

---

## 19. Unnecessary Complexity Test

### For each concept: does the model NEED it to infer composition?

| Concept | Needed for inference? | Verdict |
|---|---|---|
| **causal state variables** (repetition_count, familiarity, expectation, tension, anticipation, contrast_debt, exhaustion, register_occupancy, conversational_balance) | YES — these are what drive inference | KEEP |
| **inference rules** (mapping state to necessary action) | YES — these are the composition logic | KEEP |
| **musical memory** (what has happened, in what form) | YES — needed for long-form coherence | KEEP |
| **groove grammar (multi-grid)** | YES — needed for rhythmic inference | KEEP |
| **material relationships** (derives-from, answers, contrasts-with) | YES — needed for conversational inference | KEEP |
| **section function + material flow** | YES — needed for narrative inference | KEEP |
| **motif identity recognition** | YES — needed for callback inference | KEEP |
| **contrast as grammar change** | YES — needed for contrast inference | KEEP |
| **genre grammar (causal rules)** | YES — needed for genre-specific inference | KEEP |
| **artist identity (emergent)** | PARTIALLY — useful for cross-track coherence but not essential for single-track inference | KEEP but secondary |
| `role` (semantic role label) | NO — the model infers from state, not from role labels | **REMOVE as primary; keep as derived** |
| `density` (per role) | NO — derived from active material + state | **REMOVE as primary; keep as derived** |
| `energy` (per section) | NO — derived from active roles + state | **REMOVE as primary; keep as derived** |
| `lifecycle` (10 states) | NO — derived from state (expectation, exhaustion, etc.) | **REMOVE as primary; keep as derived** |
| `intent` (reason string) | NO — the inference rules ARE the intent | **REMOVE** |
| `registerIntent` | NO — derived from register_occupancy | **REMOVE as primary; keep as derived** |
| `sidechainIntent` | YES — "bass yields to kick" is a musical priority rule | KEEP but reframe as grammar rule |
| `style profile` (checklist) | NO — replaced by genre grammar (causal rules) | **REMOVE as checklist; keep as grammar** |
| `arrangement section labels` (INTRO/BUILD/DROP) | NO — derived from narrative function | **REMOVE as primary; keep as derived** |

### The model should be SMALLER, not larger

The previous models kept adding descriptive fields. A genuine composition model is **smaller** because most of the descriptive fields are **derived** from the causal state + inference rules.

**The minimal causal model needs:**
1. State variables (changes based on events)
2. Inference rules (maps state to necessary action)
3. Musical material (motifs, rhythm cells, bass patterns, harmonic material) with identity
4. Material relationships (derives-from, answers, contrasts-with)
5. Groove grammar (multi-grid)
6. Causal rules (repetition→expectation, expectation→violation, etc.)
7. Musical memory (what has happened)
8. Genre grammar (causal rules, not checklist)

**Everything else is derived.**

---

## 20. Final Gate — 20 Must-Pass Criteria

| # | Criterion | Pass? | Evidence |
|---|---|---|---|
| 1 | Can generate causal chains? | ✅ (Section 5) | Full causal chain with state transitions |
| 2 | Can distinguish state from cause? | ✅ (Section 4) | State variables vs inference rules separated |
| 3 | Can explain why a new role becomes necessary? | ✅ (Section 17) | Four-instrument failure reconstruction |
| 4 | Can explain why a role should NOT enter? | ✅ (Section 6) | "5 active of 12 potential" scenario |
| 5 | Can model midrange conversation? | ✅ (Section 7) | Conversational chain with causal links |
| 6 | Can model groove as multi-grid grammar? | ✅ (Section 8) | Primary/secondary/tertiary grids + relationships |
| 7 | Can choose among multiple bass grammars? | ✅ (Section 9) | 6 families, choice causally motivated |
| 8 | Can model musical memory? | ✅ (Section 11) | What/when/context/form/changed/unresolved/familiar/novel/payoff |
| 9 | Can model material exhaustion? | ✅ (Section 12) | Saturation/novelty decay/transformation opportunity |
| 10 | Can model expectation and payoff? | ✅ (Section 5) | Expectation builds → violation → anticipation → payoff |
| 11 | Can model contrast as grammar? | ✅ (Section 14) | Grammar change, not parametric difference |
| 12 | Can preserve motif identity dynamically? | ✅ (Section 13) | Weighted recognition function, load-bearing features |
| 13 | Can distinguish coherent vs arbitrary ordering? | ✅ (Section 18) | Track A vs Track B test |
| 14 | Can produce long-form development without fixed bar schedule? | ✅ (Section 5, 10) | Timing derived from state, not scheduled |
| 15 | Can distinguish genre convention from track-specific choice? | ✅ (Section 15) | Three layers: convention/grammar/track choice |
| 16 | Can allow artist identity to emerge? | ✅ (Section 16) | Emerges from recurring choices |
| 17 | Can explain the four-instrument failure without merely adding roles? | ✅ (Section 17) | Each addition causally motivated by state |
| 18 | Can remain valid without any synthesis/rendering concepts? | ✅ (Section 19) | All synthesis fields removed; causal model survives |
| 19 | Can remain valid across Full-On, Progressive, Darkpsy, Goa without becoming a recipe? | ✅ (Section 15) | Genre is grammar + convention, not recipe |
| 20 | Can remain minimal rather than becoming a giant metadata ontology? | ✅ (Section 19) | Most descriptive fields removed as derived |

**All 20 pass.** ✅

---

## 21. What the Composition Model Can and Cannot Infer

### CAN infer (from state + rules)

| Inference | How |
|---|---|
| When a new rhythmic layer becomes necessary | groove_stability > threshold AND register empty |
| When a melodic identity becomes necessary | rhythmic foundation complete AND no motif |
| When variation becomes meaningful | expectation high AND exhaustion approaching |
| When a secondary voice (counterline) becomes necessary | tension high AND complementary register empty |
| When a breakdown becomes justified | contrast_debt high AND groove exhausted |
| When a callback becomes justified | anticipation high AND motif familiar |
| When material should be withheld | exhaustion high AND contrast owed |
| When material should transform | exhaustion critical AND novelty decayed |
| When a role should NOT enter | register occupied OR conversation balanced OR grammar complete |
| When the groove should evolve (grid relationships) | groove saturation high AND no recent grid change |
| When contrast is needed | contrast_debt > threshold |
| When payoff is required | anticipation_level > threshold |

### CANNOT infer (requires composer intent or higher-level goals)

| Decision | Why |
|---|---|
| WHICH specific motif (contour, intervals) | requires artistic choice |
| WHICH specific transformation (transpose vs fragment) | requires artistic choice (though state narrows the options) |
| The overall track identity (signature motifs) | requires artistic choice |
| The exact section count and length | requires narrative intent (though state constrains timing) |
| Which subgenre | requires artistic choice (though grammar rules apply once chosen) |
| The specific bass grammar family | requires groove identity choice (though state constrains) |
| Artist identity | emerges from cross-track choices, not inferred within one track |

### The boundary

The model can infer **WHEN** and **WHY** (necessity), but not always **WHAT** (specific material). The composer (or a higher-level generator) provides the WHAT; the causal model provides the WHEN and WHY.

**This is the correct division of labor for a composition engine.**

---

## 22. Which Concepts Are Causal / State / Derived / Descriptive (to remove)

### Causal (inference rules — KEEP)
- repetition → expectation
- expectation → meaningful violation
- tension → need for response
- exhaustion → need for transformation
- contrast debt → need for grammatical change
- anticipation → need for payoff
- register saturation → need for thinning
- groove saturation → need for new grid
- unresolved question → need for answering voice

### State (observable, changes based on events — KEEP)
- repetition_count, listener_familiarity, rhythmic_saturation, harmonic_stability, expectation_level, tension_level, unresolved_material, available_register_space, contrast_debt, material_exhaustion, anticipation_level, groove_stability, conversational_balance

### Material (identity-carrying — KEEP)
- motifs (with identity features), rhythm cells, bass patterns (with grammar), harmonic material, material relationships

### Grammar (rules governing behavior — KEEP)
- groove grammar (multi-grid), bass grammar (families), contrast grammar, genre grammar (causal rules)

### Derived (computed from state + material — keep as derived, not primary)
- role labels (derived from material + function)
- density (derived from active material)
- energy (derived from active roles + state)
- lifecycle states (derived from expectation/exhaustion/anticipation)
- register intent (derived from register_occupancy)
- section labels (derived from narrative function)

### Descriptive (should be REMOVED)
- `intent` (reason string) — replaced by inference rules
- `style profile` as checklist — replaced by genre grammar
- pre-scheduled bar numbers — replaced by state-derived timing
- declared relationships without causal motivation — replaced by state-driven relationships

---

## 23. What Must Cross the Foundation → PSY4 Boundary

### Foundation provides (the WHAT and WHY)
- Musical material (motifs, rhythm cells, bass patterns, harmonic material) with identity
- Material relationships (derives-from, answers, contrasts-with)
- Causal state (the current state of the musical discourse)
- Inference results (what should happen next, and why)
- Groove grammar (multi-grid structure)
- Genre grammar (causal rules)
- Musical memory (what has happened)
- Section function + material flow (narrative structure)
- Artist identity (emergent signature choices)

### PSY4 provides (the HOW)
- Synthesis architecture (oscillator, FM, wavetable, sample)
- Envelope/filter/modulation realization
- Sample selection
- Mix (EQ, compression, sidechain implementation, stereo)
- Master (LUFS, limiting)
- Performance realization (velocity, microtiming, articulation)

### The boundary is clean

Foundation provides the causal composition (what should happen and why). PSY4 provides the realization (how it sounds). Neither crosses into the other's domain.

---

## 24. Verdict

### **CONDITIONAL GO**

The model CAN be a genuine composition engine — but ONLY if the causal state machine and inference rules are built. The previous models were metadata systems. This challenge demonstrates that a causal model IS achievable, with:

- 13 state variables that change based on events
- 10 inference rules that map state to necessary action
- Musical memory for long-form coherence
- Multi-grid groove grammar
- Conversational midrange model
- Dynamic motif identity
- Contrast as grammar change
- Genre as causal grammar (not recipe)

### Why CONDITIONAL (not full GO)

The causal model has been demonstrated **conceptually** in this document. It has NOT been:
- Validated against a full paper composition with state tracking
- Tested for completeness (are there inferences the model can't make that it should?)
- Tested for ambiguity (can two different states lead to conflicting inferences?)
- Formalized to the point where a schema could be derived

### What must happen before Schema Design

1. A **revised ontology document** that formalizes the causal state machine (state variables + inference rules)
2. A **full paper composition** that demonstrates the state machine running (state changes at each event, inferences driving each decision)
3. A **completeness check** (does the state machine cover all necessary inferences?)
4. An **ambiguity check** (can the rules conflict? how are conflicts resolved?)
5. Only then: Schema Design derived from the validated causal model

### What GO does NOT mean

- ❌ Does NOT mean schema design can begin immediately
- ❌ Does NOT mean Foundation should be changed
- ❌ Does NOT mean V2 schema exists
- ❌ Does NOT approve any architecture
- ❌ Does NOT mean the causal model is complete (it's demonstrated, not validated)

---

## 25. Final Report

### What the composition model can infer
- When a new role becomes necessary (from register_occupancy, conversational_balance, groove_grammar)
- When a role should NOT enter (from register saturation, conversation balance, grammar completeness)
- When variation becomes meaningful (from expectation_level, material_exhaustion)
- When a breakdown is justified (from contrast_debt, groove_exhaustion)
- When a callback is justified (from anticipation_level, motif_familiarity)
- When material should transform (from material_exhaustion, novelty_decay)
- When contrast is needed (from contrast_debt)
- When payoff is required (from anticipation_level)

### What it cannot infer
- WHICH specific motif (artistic choice)
- WHICH specific transformation (artistic choice, though state narrows options)
- The overall track identity (artistic choice)
- Artist identity (emerges cross-track, not inferred within one track)

### Which concepts are causal
- Inference rules (repetition→expectation, expectation→violation, tension→response, exhaustion→transformation, contrast_debt→grammatical_change, anticipation→payoff)

### Which concepts are state
- repetition_count, listener_familiarity, rhythmic_saturation, harmonic_stability, expectation_level, tension_level, unresolved_material, available_register_space, contrast_debt, material_exhaustion, anticipation_level, groove_stability, conversational_balance

### Which concepts are derived
- role labels, density, energy, lifecycle states, register intent, section labels

### Which concepts are merely descriptive and should be removed
- `intent` (reason string) — replaced by inference rules
- `style profile` as checklist — replaced by genre grammar
- pre-scheduled bar numbers — replaced by state-derived timing
- declared relationships without causal motivation

### What minimum information must cross the Foundation → PSY4 boundary
- Musical material with identity
- Material relationships
- Causal state (current discourse state)
- Inference results (what should happen next, and why)
- Groove grammar
- Genre grammar
- Musical memory
- Section function + material flow
- Artist identity (emergent)

---

## HARD STOP

- ❌ No code, no schema, no Foundation changes, no PSY4 changes, no audio, no V1 rerun, no architecture approved
- ✅ Ontological challenge complete; causal model demonstrated conceptually; 20 must-pass criteria analyzed

**Verdict: CONDITIONAL GO.** The model CAN be a genuine composition engine, but only if the causal state machine is formalized and validated before schema design.

**The guiding principle: we are not building a system that can represent a psytrance track. We are building a system that can reason about why the next musical event should exist. And only after that should PSY4 be asked to turn that composition into sound.**

The next step (if this verdict is accepted) is a **revised ontology document** that formalizes the causal state machine — still no schema, still no code, still no Foundation changes. Only after that document is reviewed and approved does Schema Design begin.
