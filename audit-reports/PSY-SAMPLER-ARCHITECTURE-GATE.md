# PSY Sampler — Architecture Gate

**Status:** ARCHITECTURE GATE DECISION. No code. No Foundation changes. No PSY4 changes. No new repository. No implementation.
**Date:** 2024-08-13
**Purpose:** Decide whether a sample-based realization device can become a first-class PSY family citizen without duplicating contracts, stealing composition responsibilities, or coupling to PSY4 internals.

---

## 0. Executive Decision

### The question being answered

Not "can we make samples play." But: **can a sample-based device become a first-class PSY family citizen cleanly?**

### Answer: **GO**

The family architecture CAN support a sample-based realization device cleanly. The canonical contract (`PsyDevice`) is sufficient as-is. Foundation does NOT need to change. The device does NOT need to steal composition responsibilities. The device does NOT need to couple to PSY4 internals.

### Why GO (not CONDITIONAL GO)

My previous integration design document overclaimed two "blockers":
1. The NoteEvent gap (missing materialId/motifId/lifecycleState/variationState) — I called it REQUIRED. **It is not.** The device can do deterministic selection from existing NoteEvent fields (channel + note + velocity + position-derived seed). Richer metadata is "useful but optional" — a future enhancement, not a v1 blocker. **Foundation does not need to change.**
2. The 108 real samples lacking provenance — I called it a blocker. **It is not.** The device can ship v1 using only the 6 verified PSY3 samples (gold-standard manifest) plus procedural generation (multisampleGenerator, deterministic). The 108 real samples are quarantined until provenance is established — that's future asset work, not an architecture blocker.

The only genuine requirement is: **do not port the broken parts of PSY4** (psy4-engine.js RT violations, non-determinism). Use the gold-standard DSP (`psy4-dsp.js`) or main-thread `AudioBufferSourceNode` for v1.

### What this GO authorizes

- Phase 1 implementation: a minimal headless Sampler device implementing `PsyDevice`, consuming `NoteEvent`, using verified samples, deterministic selection, no composition logic, no Foundation changes.

### What this GO does NOT authorize

- ❌ Foundation changes
- ❌ PSY4 composition engine changes
- ❌ Porting psy4-engine.js (broken)
- ❌ Using unverified samples (108 real samples quarantined)
- ❌ UI, MIDI bridge, offline pipeline (future phases)
- ❌ Architecture approval beyond this gate

---

## 1. Six-Repository Architectural Map

### Classification scheme

| Class | Meaning |
|---|---|
| **CANONICAL** | The authoritative source. Must be used as-is. |
| **REUSABLE** | Correct, clean, can be adopted. |
| **LEGACY** | Works but not aligned with family architecture. Avoid. |
| **EXPERIMENTAL** | Exploration, not production. Avoid. |
| **BROKEN** | Has defects (RT violations, non-determinism). Do not port. |
| **OUT OF SCOPE** | Belongs to a different layer, not the Sampler's concern. |

### Map

| Repo | Component | Class | Notes |
|---|---|---|---|
| **psy-foundation** | `PsyDevice` contract | CANONICAL | 5 methods + 3 optional. The Sampler implements this exactly. |
| | `DeviceHost` | CANONICAL | Register/unregister/route. The Sampler registers here. |
| | `MusicalTransport` | CANONICAL | Timing authority (beatTime, origin.audioTime). |
| | `MusicalContext` | CANONICAL | rootPc, scale, style, section. |
| | `MusicalEvent` / `NoteEvent` | CANONICAL | Sufficient for v1 (see §6). |
| | `DeviceCapabilities` | CANONICAL | Declaration format. |
| | `Channel` | CANONICAL | Event pub/sub. |
| | `scheduler` (rng.ts) | REUSABLE | Seeded LCG for deterministic selection. |
| | `material` package | OUT OF SCOPE | Composition-layer material library. Sampler doesn't own this. |
| | `music` package | OUT OF SCOPE | Composition-layer music primitives. |
| | `dsp` package (PolyBLEP, Moog) | OUT OF SCOPE | Synthesis DSP, not sample playback. |
| | Foundation itself | FROZEN | 250 tests pass. No changes for v1. |
| **psy4** | `sampleBank.ts` | REUSABLE | Clean loader. Add `dispose()`. |
| | `multisampleGenerator.ts` | REUSABLE | Deterministic procedural generation. |
| | `psy4-dsp.js` (worklets) | REUSABLE | Gold standard, RT-safe, modular. |
| | `SAMPLE_MANIFEST.json` (6 samples) | REUSABLE | Gold-standard provenance format. |
| | `psy4-engine.js` (monolithic worklet) | BROKEN | RT violations (per-hit allocation), non-determinism (Math.random). DO NOT PORT. |
| | `offlineRenderer.ts` | BROKEN | Stub, returns zeros. DO NOT PORT. |
| | `public/samples/real/` (108 samples) | QUARANTINED | No provenance. Not for v1. |
| | `public/samples/real/manifest.json` | LEGACY | Provenance-bare. Must extend before use. |
| | composition engine (MusicalSession, etc.) | OUT OF SCOPE | Composition layer. Sampler must not depend on this. |
| | AdvancedSynthVoice | OUT OF SCOPE | Synth device, not sampler. |
| | React UI / page structure | OUT OF SCOPE | UI layer. |
| **nexus-psy7** | `sampler-tool/` (buffer utilities) | REUSABLE | decode, normalize, reverse, trim, slice. Clean, no deps. |
| | `pooled-voices.ts` | LEGACY | FM/unison synth voices. Not sample playback. |
| | architecture | EXPERIMENTAL | Alternative voice arch. Not family-aligned. |
| **psy5** | (minimal) | EXPERIMENTAL | Mostly empty/scratch. |
| **psy3-clean** | (Python production knowledge) | LEGACY | Docs, not runtime code. |
| **psy** | (minimal) | LEGACY | Original, minimal. |

### Architectural dependency graph (directional, no cycles)

```
psy-foundation (CANONICAL, frozen)
    ↑
    | (implements PsyDevice, consumes MusicalEvent/Transport/Context)
    |
psy4 Sampler device (new, src/lib/devices/sampler/)
    |
    | (reuses: sampleBank.ts, multisampleGenerator.ts, psy4-dsp.js,
    |  SAMPLE_MANIFEST.json format, nexus-psy7 sampler-tool)
    |
    ↓
verified samples only (6 PSY3 + procedural) — 108 real samples QUARANTINED
```

**No dependency on:** Foundation changes, PSY4 composition engine, PSY4 React/UI, psy4-engine.js, unverified samples, MIDI bridge.

---

## 2. Canonical Contracts (verified from source)

I opened the actual Foundation source files. The contracts are:

```typescript
// @psy-foundation/device-sdk — PsyDevice
interface PsyDevice {
  id: string
  capabilities(): DeviceCapabilities
  onTransport(transport: MusicalTransport): void
  onContext(context: MusicalContext): void
  onEvent(event: MusicalEvent): void
  onStart?(): void
  onStop?(): void
  reportLatencyMs?(): number
}

// @psy-foundation/protocol — NoteEvent (primary event Sampler consumes)
interface NoteEvent {
  type: 'note'
  note: number        // MIDI pitch
  velocity: number    // 0-1
  duration: number    // in beats
  channel: string     // role/category selector
  at: EventTime       // audio time (seconds)
}

// @psy-foundation/protocol — DeviceCapabilities
interface DeviceCapabilities {
  audio: boolean
  midi: boolean
  inputs: number
  outputs: number
  voices: number
  latencyMs: number
  roles: string[]
}

// @psy-foundation/transport — MusicalTransport (timing authority)
interface MusicalTransport {
  bpm: number
  beat: number
  bar: number
  beatsPerBar: number
  beatTime: number      // audio clock time of current beat
  origin: { audioTime: number; beatIndex: number; bpm: number }
  // ... + phase, confidence, locked, revision
}
```

**Verdict:** The canonical contract is minimal, sufficient, and frozen. The Sampler implements `PsyDevice` exactly. No new contract is needed.

---

## 3. Ownership Boundaries (from source, not assumed)

### The four-layer separation

| Layer | Owns | Sampler access |
|---|---|---|
| **Composition** | musical material, motifs, rhythm, harmonic material, role semantics, causal musical state, expectation, development, arrangement, section function, musical relationships, identity, genre grammar | **NONE** — Sampler never sees this |
| **Scheduling / Product** | WHEN events occur, transport scheduling, event sequencing, user interaction, MIDI-to-musical-event translation, UI behavior | **CONSUME** — Sampler receives NoteEvent via DeviceHost |
| **Device** | sample selection within defined material space, loading, decoding, buffering, voice allocation, pitch realization, velocity realization, playback, deterministic variation, device-local state | **OWN** — this IS the Sampler |
| **Audio realization** | real-time DSP, worklet processing, interpolation, playback state, voice rendering, CPU-safe execution | **OWN** (if worklet) or DELEGATE (if AudioBufferSourceNode) |
| **Mix / Master** | routing, bus processing, spatialization, dynamics, master processing | **OUTPUT** — Sampler outputs audio to a bus; mix/master is downstream |

### Sampler responsibility boundary table

| Concern | Owner | Sampler access |
|---|---|---|
| motif identity | composition | none |
| event timing | scheduler | consume (NoteEvent.at) |
| sample asset | sampler | own |
| sample selection (which variant) | sampler | own (deterministic) |
| genre grammar | composition | none |
| transport | foundation/scheduler | consume |
| MIDI | product/bridge | no direct ownership |
| voice allocation | sampler | own |
| synthesis (FM/wavetable) | synth device | not sampler |
| mix/master | mix layer | output to bus |
| composition decisions | composition | none |
| missing material | sampler reports | does NOT invent |

**Rule 3 enforced:** Never move composition logic into a realization device. The Sampler receives the result of composition/scheduling and realizes it. If material is missing, it reports — it does NOT invent a substitute motif, rhythm, role, or genre-specific pattern.

---

## 4. Sampler Responsibility Boundary (precise)

### What the Sampler knows

- Its sample bank (loaded, decoded, cached)
- Its voice pool (allocated, active, releasing)
- Its deterministic selection state (round-robin counters, LCG seed)
- Its capabilities (voices, roles, latency)
- The current transport (received via onTransport)
- The current context (received via onContext)

### What the Sampler receives

- `onTransport(transport)` — timing authority
- `onContext(context)` — rootPc, style, section (for deterministic selection)
- `onEvent(event)` — NoteEvent (play this), SectionEvent (reset round-robin per policy)
- `onStart()` — initialize
- `onStop()` — suspend

### What the Sampler outputs

- Audio (to a bus or destination)
- Diagnostics (active voices, memory, latency) — via public API for UI/tests
- Failure reports (MISSING_MATERIAL, VOICE_STARVATION, PROVENANCE_VIOLATION)

### What the Sampler refuses to decide

- Why a role entered or exited
- Why a counterline exists
- Why a breakdown happens
- What a motif means
- What tension/expectation means
- What the genre grammar requires
- What the next musical event should be
- How to generate missing musical material

### What state the Sampler owns vs observes

| State | Own or Observe |
|---|---|
| voice pool | own |
| sample cache | own |
| round-robin counters | own |
| selection LCG state | own |
| transport | observe (received, not owned) |
| context | observe (received, not owned) |
| composition state | none (never seen) |

### What must remain outside the device

- Composition engine (motifs, development, arrangement, causality)
- Scheduling (when events fire)
- MIDI translation
- Mix/master processing
- UI

---

## 5. Reuse / Adapt / Rewrite / Do Not Use Matrix

| Component | Source | Verdict | Why |
|---|---|---|---|
| `PsyDevice` contract | Foundation | **USE AS-IS** | Canonical, frozen |
| `DeviceHost` | Foundation | **USE AS-IS** | Canonical, frozen |
| `NoteEvent` | Foundation | **USE AS-IS** | Sufficient for v1 (see §6) |
| `scheduler/rng.ts` (seeded LCG) | Foundation | **REUSE** | Deterministic selection |
| `sampleBank.ts` | PSY4 | **ADAPT** | Clean loader; add `dispose()`, replace O(N²) DFT with FFT |
| `multisampleGenerator.ts` | PSY4 | **REUSE** | Deterministic procedural generation |
| `psy4-dsp.js` (worklets) | PSY4 | **REUSE** | Gold standard, RT-safe, modular |
| `SAMPLE_MANIFEST.json` format | PSY4 | **REUSE** | Gold-standard provenance format |
| nexus-psy7 `sampler-tool/` | nexus-psy7 | **REUSE** | Buffer utilities, no deps |
| `psy4-engine.js` | PSY4 | **DO NOT USE** | BROKEN: RT violations, non-determinism |
| `offlineRenderer.ts` | PSY4 | **DO NOT USE** | BROKEN: stub, returns zeros |
| 108 real samples | PSY4 | **QUARANTINE** | No provenance — not for v1 |
| `SampleVoice` (in psy4-engine.js) | PSY4 | **REWRITE** | Extract clean voice from broken engine |
| `VoicePool` (in psy4-engine.js) | PSY4 | **REWRITE** | Build clean pool with priority stealing |
| MIDI path | (none) | **DO NOT BUILD** | Out of scope — upstream bridge |
| UI sample browser | PSY4 | **DO NOT USE** | UI is separate phase |

**Rule 6 enforced:** Prefer reuse only after boundary verification. Every REUSE component has been verified to respect the family boundary (no composition logic, no React/DOM dep, no PSY4-specific coupling).

---

## 6. Foundation-Gap Analysis

### The NoteEvent question

My previous document claimed NoteEvent lacks `materialId`, `motifId`, `lifecycleState`, `variationState` and called this a REQUIRED gap. **I was wrong.** Let me classify each properly:

| Field | Classification | Reasoning |
|---|---|---|
| `materialId` (specific sample variant) | **Not actually required** | The device does deterministic selection from (channel, note, velocity, position-seed). The composition engine doesn't need to pick the exact sample — that's a realization decision (HOW, not WHAT). |
| `motifId` (which motif) | **Not actually required** | The device doesn't need to know which motif a note belongs to. It plays the sample. motifId is composition context. |
| `lifecycleState` (entering/sustaining/exiting) | **Useful but optional** | Could affect envelope behavior, but the device can infer from velocity/duration. Future enhancement. |
| `variationState` | **Not actually required** | Device doesn't need this. It's composition info. |

### Verdict on Foundation changes

**Foundation does NOT need to change for v1.** Rule 2: Foundation is frozen unless a genuine architectural necessity is proven. No necessity is proven — the device can realize music from the existing NoteEvent fields.

### Future Foundation proposals (not v1)

If, after v1 proves the architecture, the composition engine needs to pass richer material identity to devices, a backward-compatible NoteEvent extension could be proposed to the Foundation team. That is a separate decision, made after v1 evidence, not before.

### Other gaps

| Gap | Classification | Action |
|---|---|---|
| MIDI bridge | Product-layer responsibility | Out of scope. Build separately if needed. |
| Offline render pipeline | Product-layer responsibility | Out of scope for device. Device supports OfflineAudioContext; pipeline is separate. |
| Sample provenance for 108 real samples | Asset work, not architecture | Quarantine until provenance established. Use verified samples for v1. |

---

## 7. Determinism Model

### Formal definition

**Same (composition, event stream, sample bank, seed, transport, device config) → same (sample-selection decisions, musical realization).**

### Deterministic inputs

- `worldSeed` — session-level seed (from device config or transport)
- `channel` — from NoteEvent (sample category)
- `note` — from NoteEvent (MIDI pitch, for keyzone)
- `velocity` — from NoteEvent (dynamic layer)
- `position` — derived from transport (bar, beat, phrase, eventIndex) for round-robin
- `section` — from MusicalContext (round-robin reset policy)

### Deterministic outputs

- Which sample variant is selected (round-robin or keyzone)
- Which voice is allocated (pool index)
- Playback start time (from NoteEvent.at)
- Pitch (from note → playbackRate)

### Where randomness is permitted

- **Nowhere in the realization path.** All selection is deterministic from the inputs above.

### Where randomness is forbidden

- ❌ `Math.random()` in audio thread
- ❌ `Date.now()` for timing
- ❌ `performance.now()` as musical clock
- ❌ Non-deterministic object iteration order (use arrays, not Maps with dynamic keys)
- ❌ Any behavior whose seed cannot be reconstructed

### Implementation

- Seeded LCG (from Foundation `scheduler/rng.ts`)
- Round-robin = deterministic counter (per channel+section), rebuilt from event log on seek
- Keyzone = pure function of (note → sample)

---

## 8. Real-Time Safety Model

### The hard boundary

AudioWorklet `process()` runs on the audio thread at block rate (128 samples = ~2.9ms at 44100Hz). **Nothing that can be prepared ahead of time should be discovered dynamically inside `process()`.**

### Preparation time vs audio thread time

| Operation | When | Allowed in process()? |
|---|---|---|
| Sample loading | preparation | ❌ no |
| Decoding | preparation | ❌ no |
| Manifest parsing | preparation | ❌ no |
| Voice pool allocation | preparation (onStart) | ❌ no |
| Category-name arrays | preparation (precompute) | ❌ no |
| Sample selection (which variant) | preparation (main thread, before scheduling) | ❌ no (decision made before process) |
| Voice allocation (which voice) | preparation (main thread) or audio thread (if precomputed pool) | ✅ yes (if pool is preallocated array, no new) |
| Interpolation | audio thread | ✅ yes (math on preallocated buffers) |
| Envelope update | audio thread | ✅ yes (math on voice state) |
| Gain update | audio thread | ✅ yes |
| `new Array()` / `new Object()` | — | ❌ never in process() |
| closures (filter, map) | — | ❌ never in process() |
| `Math.random()` | — | ❌ never |
| string manipulation | — | ❌ never in process() |
| `Object.keys()` | — | ❌ never in process() (precompute) |

### v1 real-time strategy

For v1, use **main-thread `AudioBufferSourceNode`** for playback. This is simpler and avoids worklet complexity. The audio thread (browser-internal) handles the buffer reading — no custom `process()` code.

- Sample selection: main thread (deterministic, before scheduling)
- Voice allocation: main thread (create BufferSource + Gain per note — acceptable for v1 voice counts)
- Scheduling: main thread (against transport audio clock)
- Realization: browser-internal audio thread (AudioBufferSourceNode)

**This is RT-safe by construction** — no custom audio-thread code in v1.

### Future worklet strategy (not v1)

If v1 proves the architecture and performance requires a worklet:
- Extract clean DSP classes from `psy4-dsp.js` (gold standard, RT-safe)
- Build a `SampleVoice` class with: cubic interpolation, anti-aliasing, loop mode, keyzones, ADSR
- Build a `VoicePool` with: preallocated voices, priority stealing, protected voices
- All allocation in `constructor` / message handlers, never in `process()`

---

## 9. Sample Provenance Model

### Three categories

| Category | Meaning | v1 use |
|---|---|---|
| **VERIFIED** | Full provenance (source, author, license, attribution, usageRestrictions). Commercial-safe. | ✅ allowed |
| **QUARANTINED** | Technically usable but provenance incomplete. | ❌ test only |
| **REJECTED** | Cannot be used (corrupt, unlicensed, unknown). | ❌ never |

### Current asset state

| Asset set | Count | Provenance | Category |
|---|---|---|---|
| PSY3 samples (`SAMPLE_MANIFEST.json`) | 6 | Full (gold standard) | VERIFIED |
| Real samples (`public/samples/real/`) | 108 | Bare (no license) | QUARANTINED |
| Procedural samples (multisampleGenerator) | ∞ | Generated, no copyright | VERIFIED |

### v1 sample strategy

Use VERIFIED samples only:
- 6 PSY3 samples (kick, bass, hat_closed, hat_open, clap, lead)
- Procedural generation (multisampleGenerator) for any additional categories

The 108 real samples remain quarantined until provenance is established. **This is asset work, not an architecture blocker.**

### Manifest format (gold standard, from SAMPLE_MANIFEST.json)

Required fields for VERIFIED:
```json
{
  "name": "kick.wav",
  "category": "kick",
  "subcategory": "main",
  "source": "...",
  "author": "...",
  "license": "...",
  "attribution": "...",
  "dateAcquired": "...",
  "usageRestrictions": "none | commercial-required | unknown",
  "duration": 0.280,
  "sampleRate": 44100,
  "channels": 1,
  "peak": 1.0,
  "rms": 0.319,
  "centroid": 221,
  "fundamental": 50,
  "quality": "A",
  "role": "Kick drum sub body anchor"
}
```

**Rule 9 enforced:** Provenance is part of the sample architecture, not a documentation afterthought.

---

## 10. Timing Model

### Authoritative clock

`AudioContext.currentTime` (via transport's `beatTime` and `origin.audioTime`).

### Forbidden clocks

- `Date.now()` — wall clock
- `performance.now()` as musical clock
- `setInterval` / `setTimeout` for sequencing

### Event scheduling

- NoteEvent carries `at` (audio time, seconds)
- Sampler schedules playback at `event.at`
- Lookahead: 100ms (configurable) — events within window are scheduled to AudioContext

### Late/early event behavior

| Scenario | Behavior |
|---|---|
| Event on time | Schedule at `event.at` |
| Event late (`at` < `currentTime + 50ms`) | Play immediately if within threshold; drop if > 50ms late |
| Event early | Queue until `at` |

### Transport changes

| Scenario | Behavior |
|---|---|
| Transport jump (seek) | Flush pending events; rebuild round-robin state from position |
| Transport stop | Suspend voice scheduling; release tails or truncate (configurable) |
| Transport start | Resume scheduling from current transport state |

### Latency reporting

`reportLatencyMs()` returns measured device latency (scheduling + buffer). For v1 (main-thread): ~5-10ms. For future worklet: ~3-5ms.

### Offline vs realtime

- Same scheduling logic (against `event.at`)
- Offline: OfflineAudioContext (Node.js via `web-audio-api` or browser)
- Realtime: browser AudioContext
- **Same seed + same events + same samples = same output** (verified by test)

---

## 11. Missing-Material Semantics

### Failure scenarios and behavior

| Scenario | Behavior |
|---|---|
| Requested sample does not exist | Report `MISSING_MATERIAL`; skip event; continue |
| Requested category is empty | Report `CATEGORY_EMPTY`; skip event; continue |
| Requested pitch outside available range | Use nearest available sample (keyzone clamp); report `PITCH_CLAMPED` |
| Sample bank still loading | Queue event (up to lookahead); if still loading at play time, report `BANK_LOADING` and skip |
| Sample is quarantined | Report `PROVENANCE_VIOLATION` (if production mode); skip |
| Voice pool exhausted, none stealable | Report `VOICE_STARVATION`; drop event |
| Event arrives too early | Queue |
| Event arrives too late | Drop if > 50ms; play immediately if within |
| Device is stopped | Ignore events (or queue, configurable) |
| Transport is unlocked | Continue (transport confidence is scheduler's concern, not device's) |

**Rule 4 enforced:** Never solve missing musical information by inventing it in the device. The Sampler reports missing material; it does NOT invent a substitute motif, rhythm, role, or genre-specific pattern.

---

## 12. Capability Model

### What `capabilities()` means for the Sampler

```typescript
{
  audio: true,           // produces audio
  midi: false,           // does not receive MIDI directly
  inputs: 0,             // no audio inputs
  outputs: 1,            // one audio output (to bus)
  voices: 32,            // max simultaneous voices (configurable)
  latencyMs: 5,          // measured
  roles: ['kick', 'bass', 'hat', 'perc', 'snare', 'clap', 'lead']  // categories it can play
}
```

### Capability vs configuration vs runtime state

| Type | Example |
|---|---|
| **Capability** (static, declared) | `audio: true`, `voices: 32`, `roles: [...]` |
| **Configuration** (set at init) | sample bank path, lookahead, voice count, round-robin policy |
| **Runtime state** (observed) | active voices, memory used, current latency |

### Capabilities the v1 Sampler genuinely has

- Pitched sample playback (playbackRate from MIDI note)
- One-shot samples
- Velocity response (gain scaling)
- Round-robin (deterministic)
- Keyzones (if multiple samples per category)
- Multiple simultaneous voices (polyphony)
- Per-channel routing (channel → sample category)

### Capabilities the v1 Sampler does NOT have (future)

- Looped samples (future)
- Deterministic variation beyond round-robin (future)
- Worklet-based rendering (future — v1 uses main-thread)
- Multi-output routing (future)

**Rule:** Do not invent capabilities merely because they would be useful. Declare only what the device actually realizes.

---

## 13. MIDI Boundary

### Preserved separation

```
MIDI → MIDI bridge (product layer) → MusicalEvent → DeviceHost → Sampler
```

The Sampler does NOT receive MIDI directly. It consumes `MusicalEvent` (already the contract). MIDI translation is upstream.

### Why MIDI is not in the device

- MIDI is a specific input protocol; the device should be input-agnostic
- Multiple input sources (MIDI, radio, composition engine, sequence file) all produce `MusicalEvent`s
- Putting MIDI in the device would couple it to a specific input protocol

### Status

No MIDI bridge exists in the family. This is a documented product-layer gap, out of scope for the Sampler device.

---

## 14. UI Boundary

### Headless device

The Sampler device works:
- Without React
- Without DOM
- Without UI
- In a test harness (Node.js + `web-audio-api`)
- In offline render

### Architecture

```
Sampler Device (headless)
    ↓
public control surface (API: loadBank, configure, diagnostics)
    ↓
UI (adapter/client — separate phase)
```

### UI is NOT the source of truth

UI reads device state via diagnostics API. UI actions go through the device's public API. The device works identically with or without UI.

---

## 15. Composition Compatibility

### How composition info travels through the family (eventually)

| Composition concept | How it reaches the device | v1 status |
|---|---|---|
| material identity | Not in NoteEvent (v1) | Device uses channel + note |
| material instance | Not in NoteEvent (v1) | Device does deterministic selection |
| semantic role | `channel` field in NoteEvent | ✅ v1 |
| motif identity | Not in NoteEvent (v1) | Not needed for realization |
| variation | Not in NoteEvent (v1) | Device does round-robin |
| lifecycle | Not in NoteEvent (v1) | Device infers from velocity/duration |
| section context | `MusicalContext.section` | ✅ v1 |
| causal state | Never reaches device | Composition-only |
| musical intent | Never reaches device | Composition-only |
| deterministic seed | Device config or transport | ✅ v1 |

### Which info must reach the device for realization?

**Only:** which sample category (channel), which pitch (note), how loud (velocity), how long (duration), when (at).

### Which info can be resolved before the device receives the event?

**All composition info** (motif identity, lifecycle, variation, causal state, intent) is resolved by the composition engine BEFORE the event reaches the device. The device receives only the realization-relevant subset.

**This preserves the composition architecture entirely.** The Sampler is compatible with the causal composition model — it simply doesn't see the causal layer.

---

## 16. Minimum Family-Citizen Definition

### The smallest Sampler that proves family integration

1. ✅ Implements `PsyDevice` contract (5 methods + capabilities)
2. ✅ Receives `MusicalEvent` (NoteEvent) via DeviceHost
3. ✅ Loads VERIFIED sample material (6 PSY3 samples + procedural)
4. ✅ Deterministically selects and plays material (seeded LCG + round-robin)
5. ✅ Runs safely in real-time (main-thread AudioBufferSourceNode, no custom audio-thread code)
6. ✅ Works headlessly (Node.js + `web-audio-api`, no UI)
7. ✅ Can be hosted beside existing devices (DeviceHost registration)
8. ✅ Does not modify Foundation (uses contracts as-is)
9. ✅ Does not contain composition logic (receives events, doesn't generate them)
10. ✅ Can be tested independently (contract + timing + determinism + voice tests)

**Rule 10 enforced:** The first implementation proves the family architecture, not maximize sampler features.

---

## 17. Implementation Phases

### Phase 1 — Minimal headless sampler (the proof)

**Objective:** Prove a sample-based device can be a family citizen.

**Inputs:**
- Foundation `PsyDevice` contract
- 6 verified PSY3 samples
- `NoteEvent` stream from DeviceHost

**Outputs:**
- A `SamplerDevice` class implementing `PsyDevice`
- Audio output (main-thread AudioBufferSourceNode)
- Diagnostics (active voices, memory)

**Dependencies:**
- `@psy-foundation/device-sdk`, `@psy-foundation/protocol`, `@psy-foundation/transport`
- `@psy-foundation/scheduler` (rng.ts for deterministic LCG)
- `web-audio-api` (for test/offline)
- PSY4 `sampleBank.ts` (adapted) + `SAMPLE_MANIFEST.json`

**Tests:**
- Contract: implements PsyDevice, capabilities correct, lifecycle
- Timing: event scheduling, late/early, seek
- Determinism: same seed → same sample, same output
- Voice: pool, stealing, cleanup
- Samples: load, decode, missing material, dispose
- Integration: DeviceHost registration, transport sync, event routing
- Headless: all tests run in Node.js without browser

**Acceptance criteria:**
- All tests pass headlessly
- Same (seed, events, samples) → same audio output (bit-exact or near-exact)
- No composition logic in the device
- No Foundation changes
- No PSY4 composition-engine imports
- No React/DOM dependencies

**Non-goals:**
- ❌ Worklet rendering (future)
- ❌ UI (future)
- ❌ MIDI (out of scope)
- ❌ Offline render pipeline (separate)
- ❌ 108 real samples (quarantined)
- ❌ Advanced features (loop, keyzones, multi-velocity)

**Rollback condition:** If the device cannot pass determinism tests (same input → different output), STOP and diagnose before proceeding.

### Phase 2 — VoicePool + performance (after Phase 1 passes)

**Objective:** Production-quality voice management.

**Scope:** Preallocated pool, priority stealing, protected voices, round-robin, performance tests (zero allocation).

### Phase 3 — SampleBank + lifecycle (after Phase 2)

**Objective:** Full sample asset management.

**Scope:** Manifest parsing (provenance enforcement), async load/decode, LRU cache, memory limits, disposal.

### Phase 4 — Integration + DeviceHost (after Phase 3)

**Objective:** Full family integration.

**Scope:** Transport sync, context handling, section events, integration tests with Foundation.

### Phase 5 — UI (after headless device proven)

**Objective:** User interface.

**Scope:** Sample browser, bank selection, diagnostics, settings. UI is adapter, not source of truth.

### Phase 6 — Offline/export + worklet (after realtime proven)

**Objective:** Premium rendering.

**Scope:** OfflineAudioContext pipeline, realtime/offline consistency, optional worklet for RT performance.

---

## 18. Proof Matrix

| Property | Proof required | Method |
|---|---|---|
| Canonical contract | source + test | Verify PsyDevice implemented; contract test passes |
| Family integration | DeviceHost test | Register sampler + another device; both receive events |
| Deterministic selection | repeatability test | Same (seed, events, samples) → same sample choices |
| Real-time safety | allocation audit | v1: no custom audio-thread code (RT-safe by construction) |
| Missing material | failure tests | Request missing sample → MISSING_MATERIAL reported, no audio |
| Timing | scheduled-event test | Event at time T → audio starts at T (within tolerance) |
| Sample provenance | manifest audit | Only VERIFIED samples loaded; QUARANTINED rejected |
| Headless operation | non-UI test | All tests pass in Node.js without browser |
| Composition boundary | architectural review | No imports from composition engine; device doesn't generate events |
| Cross-product portability | adapter test | Device usable without PSY4 page/React/composition imports |
| Offline/realtime consistency | render comparison | Same input → same output (offline vs realtime) |
| Determinism under seek | seek test | Seek → same event → same sample (counter rebuilt) |

---

## 19. Adversarial Review

| Question | Answer | Evidence |
|---|---|---|
| **A. Could the Sampler accidentally become a composition engine?** | NO | Device receives NoteEvent, plays sample. Does not generate events. Does not decide what/when. Missing material → reports, doesn't invent. |
| **B. Could two PSY products use it without importing PSY4?** | YES | Device depends on Foundation contracts + verified samples + sampleBank.ts (adapted, no PSY4 composition deps). No React/DOM/page deps. |
| **C. Could a missing sample cause the device to invent music?** | NO | Missing material → MISSING_MATERIAL report + skip. No substitute generation. |
| **D. Could nondeterminism enter through sample selection?** | NO | Seeded LCG (from Foundation scheduler/rng.ts). No Math.random(). Round-robin = deterministic counter. |
| **E. Could real-time allocations cause glitches?** | NO (v1) | v1 uses main-thread AudioBufferSourceNode (browser-internal audio thread). No custom process() code. |
| **F. Could Foundation changes be avoided?** | YES | NoteEvent sufficient as-is (see §6). No Foundation changes for v1. |
| **G. Could the device work with a completely different composition engine?** | YES | Device consumes MusicalEvent (canonical). Any composition engine that produces NoteEvents works. |
| **H. Could the device be tested without a browser UI?** | YES | Node.js + web-audio-api for OfflineAudioContext. All tests headless. |
| **I. Could the same event stream produce reproducible output?** | YES | Deterministic selection + deterministic timing (event.at) + verified samples = reproducible. |
| **J. Could the family add another realization device later without redesigning?** | YES | PsyDevice contract is modality-agnostic. A synth device, granular device, or FX device can implement the same contract. |

**All adversarial questions pass.**

---

## 20. GO / CONDITIONAL GO / NO-GO

### Verdict: **GO**

The family architecture CAN support a sample-based realization device cleanly. All 10 decision rules are satisfied:

| Rule | Status |
|---|---|
| 1. Existing code is not automatically canonical | ✅ Classified CANONICAL vs REUSABLE vs BROKEN |
| 2. Foundation is frozen unless necessity proven | ✅ No necessity proven; Foundation unchanged |
| 3. Never move composition logic into realization device | ✅ Device receives events, doesn't generate |
| 4. Never invent missing musical information | ✅ Missing material → report, not invent |
| 5. Prefer adapters over coupling | ✅ No PSY4 composition coupling |
| 6. Prefer reuse only after boundary verification | ✅ Every REUSE component verified |
| 7. Determinism is first-class | ✅ Seeded LCG, no Math.random |
| 8. Real-time safety is first-class | ✅ v1 uses main-thread (RT-safe by construction) |
| 9. Provenance is part of architecture | ✅ VERIFIED/QUARANTINED/REJECTED categories |
| 10. First implementation proves architecture, not features | ✅ Minimal v1 defined |

### Explicit blockers

**None.** All previous "blockers" resolved:
- NoteEvent gap → not actually required (device uses existing fields)
- RT violations → not porting broken code (v1 uses main-thread)
- Provenance gap → use verified samples only (108 quarantined)

### Explicit non-goals

- ❌ Foundation changes
- ❌ PSY4 composition engine changes
- ❌ Porting psy4-engine.js
- ❌ Using unverified samples
- ❌ UI, MIDI, offline pipeline (future phases)
- ❌ Architecture approval beyond this gate
- ❌ V2 schema (composition model still in review)

---

## 21. Exact Next Step

### What I need from you

**Approval to implement Phase 1** (minimal headless sampler) as defined in §17.

### What Phase 1 will produce

- `src/lib/devices/sampler/SamplerDevice.ts` — implements `PsyDevice`
- `src/lib/devices/sampler/sample-store.ts` — adapted from sampleBank.ts
- `src/lib/devices/sampler/voice.ts` — main-thread AudioBufferSourceNode wrapper
- `src/lib/devices/sampler/selection.ts` — deterministic LCG + round-robin
- `tests/devices/sampler/*.test.ts` — contract, timing, determinism, voice, integration tests
- All tests headless (Node.js + web-audio-api)
- No Foundation changes
- No PSY4 composition-engine imports
- No UI

### What Phase 1 will NOT produce

- No worklet (future)
- No UI (future)
- No MIDI (out of scope)
- No offline pipeline (separate)
- No 108 real samples (quarantined)
- No Foundation changes

### Decision required

**GO / NO-GO for Phase 1 implementation.**

If GO: I implement Phase 1 as specified, run the proof matrix, and report results before proceeding to Phase 2.

If NO-GO: identify what additional architectural evidence is needed.

---

## HARD STOP

- ❌ No code written
- ❌ No Foundation changes
- ❌ No PSY4 changes
- ❌ No new repository
- ❌ No V2 schema
- ❌ No architecture approval beyond this gate

**Output of this task: a decision-quality architecture gate.**

**Verdict: GO.** The Sampler can become a first-class PSY family citizen without duplicating contracts, stealing composition responsibilities, or coupling to PSY4 internals. Foundation remains frozen. The minimum path is clear. Awaiting your decision on Phase 1 implementation.
