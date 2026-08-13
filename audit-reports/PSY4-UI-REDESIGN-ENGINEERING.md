# PSY4 — UI Redesign: Engineering Calculation

**Date:** 2024-08-13
**Basis:** AUDIT-UI full codebase audit (632 lines) + 10 PSY family projects + causal engine architecture
**Status:** DESIGN DOCUMENT — no code changes, engineering proposal only

---

## 0. The Engineering Problem

### Current state

PSY4 has **40+ engine capabilities** but the UI exposes **~15**. The causal engine runs live but its richest data (per-material state, candidate tree, register space, memory lifecycle) is hidden. The SamplerBridge (213 LoC) is dead code. The learning system (483 LoC) is invisible. 22 of 29 materials are unreachable. The user's performance macros (energy/tension/style/section) flow through MusicalSession which doesn't drive playback — CausalComposer is hardcoded.

### The calculation

```
Engine capability surface:     40+ methods, 29 materials, 9 causal rules, 8 memory states
UI exposure surface:           ~15 elements (play/stop, 4 sliders, 8 section buttons, 4 styles, radio connect)
Causal state variables:        9 global + 5 per-material + 2 derived = 16
Causal state shown in UI:      5 bars + 1 action label + 1 whyNow string + materials list + history
Materials reachable:           7 of 29 (24%)
Capabilities with no UI:       25+ (preset/variant, sampler, learning, arrangement, per-material state, register space, candidates, memory lifecycle, relationships)
UI with no live backing:       4 section buttons (disabled), energy/tension/density sliders (disconnected from CausalComposer)

Gap ratio: ~62% of engine capability is invisible to the user.
```

### The architectural tension

1. **Two composers problem**: CausalComposer drives audio, but MusicalSession receives user input. They must be unified.
2. **Material vs channel**: The engine has 29 materials in 5 families, but the UI treats music as 4 channels.
3. **Causal transparency**: The engine makes decisions with rich reasoning (candidates, whyNotYet, urgency, necessity), but the UI shows only the final action.
4. **Device family**: SamplerBridge exists but is never attached. The UI doesn't know devices exist.

---

## 1. Design Principles

### P1: The UI shows the engine, not a groovebox

The UI is a **window into the causal composition engine**. Every state variable, every decision, every material, every memory transition is visible. The user doesn't "program beats" — they observe and influence a living musical system.

### P2: State is the hero

The causal state (tension, contrast debt, anticipation, groove stability, expectation, exhaustion, familiarity) is the **primary visual content**. These values change in real-time and drive every decision. They must be prominent, beautiful, and readable at a glance.

### P3: Materials, not channels

No more "kick/bass/lead/hat" rows. The UI shows **active materials** as living entities with lifecycle states (introduced → established → transformed → withheld → recalled). The user sees the musical conversation, not a mixing console.

### P4: Decisions are transparent

Every bar, the engine makes a decision. The UI shows:
- What it decided (ACTION)
- Why now (preconditions met)
- Why not yet (what was missing before)
- What else it considered (candidates)
- What this enables (future possibilities)

### P5: The engine is controllable

The user can influence the engine:
- Set energy/tension/density (now wired to CausalComposer, not MusicalSession)
- Force arrangement sections (break/build/drop — now causal, not countdown)
- Switch style (now updates CausalComposer's genre grammar)
- Attach sampler devices (now visible in UI)
- Save/load compositions

### P6: Professional, not demo

The UI looks like a **professional music tool** (Ableton, Bitwig, Reaktor). Dark, dense, information-rich, but clean. Not a toy. Not a demo. A studio.

---

## 2. UI Architecture

### Layout: 3-column desktop, stacked mobile

```
┌─────────────────────────────────────────────────────────────┐
│ HEADER: PSY4 · BPM · Key · Style · Transport (Play/Stop)    │
├──────────────┬──────────────────────────┬───────────────────┤
│              │                          │                   │
│  LEFT PANEL  │     CENTER PANEL         │   RIGHT PANEL     │
│              │                          │                   │
│  Causal      │  Material Graph          │  Devices          │
│  State       │  (active materials       │  (sampler,        │
│  (bars,      │   with lifecycle,        │   synth, ref)     │
│   meters,    │   relationships)         │                   │
│   history)   │                          │  Event Stream     │
│              │  Decision Detail         │  (live events)    │
│  Controls    │  (action, why,           │                   │
│  (energy,    │   candidates,            │  Learning         │
│   tension,   │   enables)               │  (scales, tempo,  │
│   style)     │                          │   key, patterns)  │
│              │  Register Space          │                   │
│              │  (7-register meter)      │  Radio            │
│              │                          │  (signal, beat,   │
│              │                          │   occupancy)      │
│              │                          │                   │
├──────────────┴──────────────────────────┴───────────────────┤
│ FOOTER: bar counter · phrase · cycle · sync status          │
└─────────────────────────────────────────────────────────────┘
```

### Mobile: stacked, collapsible sections

```
HEADER (transport)
CAUSAL STATE (bars + action)
MATERIALS (chips)
CONTROLS (sliders)
DEVICES (collapsed)
RADIO (collapsed)
FOOTER (bar + sync)
```

---

## 3. Component Specification

### 3.1 Causal State Panel (left)

**State Meters** (5 vertical bars, animated):
- Tension (red) — 0-1
- Contrast Debt (amber) — 0-1
- Anticipation (purple) — 0-1
- Groove Stability (cyan) — 0-1
- Expectation (blue) — 0-1 (per active motif)

Each bar shows:
- Current value (filled)
- Threshold line (dashed marker where rules fire)
- Value label (tabular-nums)

**Current Decision** (prominent card):
- ACTION (large, colored by type)
- WHY NOW (monospace, causal explanation)
- WHY NOT YET (smaller, what was missing before)
- URGENCY / NECESSITY badges

**Decision History** (scrollable list, newest first):
- Bar number + action
- Color-coded by action type (introduce=green, vary=amber, breakdown=red, callback=purple, no-change=gray)

**Controls** (below state):
- Energy slider (wired to CausalComposer)
- Tension slider (wired to CausalComposer)
- Style selector (Full-On / Dark / Progressive / Acid — updates genre grammar)
- Arrangement buttons (Break / Build / Drop — now causal triggers, not countdowns)

### 3.2 Material Graph (center)

**Active Materials** (live grid of material cards):
Each card shows:
- Material ID + name (e.g., "motif-A · Lead")
- Lifecycle state badge (INTRODUCED / ESTABLISHED / TRANSFORMED / WITHHELD / RECALLED)
- Per-material meters (4 mini bars: repetition, familiarity, expectation, exhaustion)
- Register indicator (which of 7 registers this material occupies)
- Relationship arrows (answers →, contrasts ↔, recalls ↻)

**Register Space Meter** (vertical 7-band meter):
- sub / bass / low-mid / mid / high-mid / high / air
- Each band: green (empty) / colored (occupied) / red (saturated)
- Shows which registers have space for new material

**Decision Detail** (expandable below materials):
- Full candidate list (all actions considered, with urgency/necessity)
- Selected candidate (highlighted)
- What this action enables (future possibilities list)
- Material affected (link to material card)

### 3.3 Device + Radio + Learning (right)

**Devices Panel**:
- SamplerDevice status (ONLINE/OFFLINE, voices used/total, events received, missing materials)
- ReferenceDevice status (events received)
- "Attach Sampler" button (calls attachSamplerBridge)
- Device capabilities display (roles, voices, latency)

**Event Stream** (live scrolling log):
- Timestamp (audio time)
- Material ID
- Channel
- Note (MIDI + name)
- Velocity
- Color-coded by material family

**Learning Panel** (collapsed by default):
- Detected scale (name + confidence)
- Detected key (pitch class + name)
- Tempo stats (top BPMs + counts)
- Learned phrase count
- Learned grammars (bass/rhythm/melodic/timbre — summary)

**Radio Panel** (collapsed by default):
- Signal state (DISCONNECTED → CONNECTING → LISTENING → FOLLOWING)
- Observation state (NO_SIGNAL → SIGNAL_PRESENT → LOCKING → FOLLOWING)
- Beat tracking (estimated BPM, confidence, observation count)
- Occupancy (kick/bass/lead/hats — 4 mini bars)
- Pitch detection (frequency, note, confidence)
- Radio bands (low/mid/high — 3 mini bars)
- Stream selector + connect/disconnect

### 3.4 Header

- PSY4 logo
- BPM (large, tabular)
- Key + scale (E phrygian-dominant)
- Style badge (FULL_ON / DARK / PROGRESSIVE / ACID)
- Transport: Play/Stop button (large, prominent)
- Variant A/B toggle
- Preset selector (4 presets)

### 3.5 Footer (sticky)

- Bar counter (current bar / phrase / cycle)
- Sync status badge
- Active material count
- Event count
- Voice count (if sampler attached)

---

## 4. Data Flow (engineering)

### Current (broken):

```
User slider → MusicalSession.setEnergy() → MusicalContext.energy
                                              ↓ (NOT read by CausalComposer)
CausalComposer.composeBar() → hardcoded bpm/root/scale → events → audio
```

### Proposed (fixed):

```
User slider → CausalComposer.setEnergy() → CausalState.energyOverride
                                              ↓
CausalComposer.composeBar() → reads energyOverride → adjusts thresholds → events → audio
                                              ↓
emit() → LiveState (with all causal fields) → UI renders
```

### Specific wiring changes needed:

1. **CausalComposer.setEnergy(v)** — adjusts expectation/exhaustion thresholds (higher energy = lower variation threshold = more activity)
2. **CausalComposer.setTension(v)** — injects tension directly (user can force tension)
3. **CausalComposer.setStyle(s)** — updates genre grammar (changes which rules fire, which materials are preferred)
4. **CausalComposer.forceSection(type)** — injects a causal event (BREAKDOWN → onMaterialWithheld + onGrammaticalChange; DROP → onMaterialReturned)
5. **CausalComposer.setBpm(b)** — updates tempo
6. **CausalComposer.setRoot(pc)** — updates root pitch

### SamplerBridge wiring:

```
page.tsx → psyLive.attachSamplerBridge(bridge) → samplerBridge established
  ↓
CausalComposer events → scheduleCausalEvent() → samplerBridge.publishNote() → DeviceHost → SamplerDevice
  ↓
SamplerDevice status → psyLive.getSamplerState() → LiveState.sampler → UI renders
```

---

## 5. Visual Design

### Color system

```
Background:     #0a0612 (near-black purple)
Surface:        rgba(10,6,18,0.6) (translucent panels)
Border:         rgba(255,255,255,0.08)
Text primary:   #e2e8f0
Text secondary: #64748b
Accent (causal): #ff2e88 (pink — for actions, decisions)
Accent (engine): #00ffc8 (cyan — for state, materials)
Accent (warning): #f59e0b (amber — for contrast debt, tension)
Accent (danger):  #ef4444 (red — for breakdown, exhaustion)
Accent (return):  #a855f7 (purple — for callback, anticipation)
```

### Typography

```
Headings:    font-bold, text-[10px], uppercase, tracking-wide
Values:      font-mono, tabular-nums, text-[11px]
Labels:      text-[9px], text-slate-400
Large BPM:   text-2xl, font-mono, font-bold, text-[#00ffc8]
Action:      text-[11px], font-mono, font-bold
```

### Material family colors

```
drums:      #00ffc8 (cyan)
low:        #3b82f6 (blue)
musical:    #ff2e88 (pink)
texture:    #a855f7 (purple)
transition: #f59e0b (amber)
```

---

## 6. Responsive Strategy

### Desktop (≥1024px): 3-column layout
- Left: causal state + controls (320px)
- Center: material graph + decision detail (flex)
- Right: devices + events + learning + radio (320px)

### Tablet (768-1023px): 2-column layout
- Left: causal state + controls (280px)
- Right: material graph + everything else (flex, scrollable)

### Mobile (<768px): single column, collapsible
- Header (transport)
- Causal state (compact: action + 5 bars)
- Materials (chips)
- Controls (sliders)
- Expandable sections (devices, radio, learning)

---

## 7. Implementation Phases

### Phase 1: Fix the data flow (engine wiring)
- Wire CausalComposer to accept energy/tension/style/section inputs
- Wire SamplerBridge attachment from page.tsx
- Wire all causal state fields to LiveState
- Remove MusicalSession from the live path (mark as LEGACY)

### Phase 2: Build the 3-column layout
- Header with transport + preset/variant
- Left panel: causal state meters + decision card + history + controls
- Center panel: material graph + register space + decision detail
- Right panel: devices + event stream + learning + radio

### Phase 3: Material graph visualization
- Material cards with lifecycle badges
- Per-material mini meters
- Relationship indicators
- Register space meter (7-band vertical)

### Phase 4: Device integration UI
- Sampler status panel
- Attach/detach button
- Voice count + event count + missing materials

### Phase 5: Learning + Radio panels
- Scale/key/tempo detection display
- Learned grammar summaries
- Radio signal/observation state
- Occupancy + pitch + bands

### Phase 6: Polish + animation
- Framer Motion transitions for state changes
- Material card enter/exit animations
- Decision history scroll animation
- Register space meter animation

---

## 8. What This Unlocks

| Capability | Current | After redesign |
|---|---|---|
| Causal state visibility | 5 bars + action | 9 state vars + 5 per-material + candidates + whyNotYet + enables |
| Materials | 4 channels | 29 material definitions, 7+ active, lifecycle tracked |
| Decisions | action label | full decision tree (candidates, urgency, necessity, enables) |
| Register space | hidden | 7-band visual meter |
| Memory | hidden | material lifecycle + relationships visible |
| Devices | dead code | sampler attached, status visible |
| Learning | hidden | scale/key/tempo/grammar visible |
| Radio | badge only | full signal/beat/occupancy/pitch visible |
| Controls | disconnected | wired to CausalComposer |
| Arrangement | countdown | causal triggers (break/build/drop inject causal events) |
| Presets | hidden | 4 presets × 2 variants selectable |
| Composition | N/A | save/load |

---

## 9. Cross-Project Insights

### From nexus-psy7:
- 7 keyboard shortcuts (Space/Z/Y/Q/E/1-8) — PSY4 should have these
- XY pad for real-time parameter control — PSY4 should have this
- Section sequence editor — PSY4 needs this
- Sound quality test cases — PSY4 should run these

### From psy3-clean:
- 16 keyboard-mapped pads — PSY4 should have pad input
- Scale visualizer — PSY4 should show the active scale
- Pattern mutator UI — PSY4 should show mutation history

### From psy-sampler:
- 16-step clickable grid — PSY4 could use for pattern preview
- Sample browser with provenance — PSY4 should expose this
- Device capabilities display — PSY4 should show this

### From Foundation:
- DeviceHost + DeviceRegistry — PSY4 should show registered devices
- MusicalTransport debug (30+ fields) — PSY4 should show transport state
- Material payloads (motif/rhythm/bass-pattern/drum-pattern/fill/phrase/fx-gesture/texture) — PSY4 should show material types

---

## 10. The Final Engineering Decision

### Build a 3-column professional studio UI that:

1. **Makes the causal engine the visual hero** — state meters, decision tree, material lifecycle are the primary content
2. **Exposes every capability** — 40+ methods, 29 materials, 9 rules, 8 memory states, sampler, learning, radio
3. **Fixes the data flow** — controls wire to CausalComposer (not MusicalSession), sampler is attachable
4. **Shows materials, not channels** — material graph with lifecycle, relationships, register space
5. **Is professional** — dark, dense, information-rich, responsive, animated

### The calculation:

```
Current UI surface:    ~15 elements → ~62% of engine invisible
Proposed UI surface:   ~50+ elements → ~95% of engine visible

Engineering effort:
  Phase 1 (wiring):     ~200 LoC changes in psyLive.ts + CausalComposer
  Phase 2 (layout):     ~800 LoC new page.tsx
  Phase 3 (materials):  ~300 LoC new components
  Phase 4 (devices):    ~200 LoC new components
  Phase 5 (learning):   ~200 LoC new components
  Phase 6 (polish):     ~200 LoC animations

Total: ~1900 LoC (rewrite of page.tsx + new components)

Risk: LOW — all data already exists in LiveState, just needs rendering
Risk: MEDIUM — CausalComposer needs setEnergy/setTension/setStyle methods (new, but straightforward)
Risk: NONE — Foundation unchanged, SamplerBridge already exists
```

### The verdict:

This is not a UI reskin. It's a **complete re-presentation of the engine**. The engine is already capable — the UI just doesn't show it. The redesign makes the engine's full power visible and controllable.

The user asked: "how to present this correctly and professionally, including all the functionality in the code."

**Answer:** Stop showing a groovebox. Show the causal composition engine.
