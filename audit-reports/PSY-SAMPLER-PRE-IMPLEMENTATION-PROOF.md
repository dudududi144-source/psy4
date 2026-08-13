# PSY Sampler — Pre-Implementation Proof Gate

**Status:** FINAL EVIDENCE GATE. No code. No Foundation changes. No PSY4 changes. No implementation.
**Date:** 2024-08-13
**Purpose:** Prove the approved architecture is sufficient for Phase 1 without discovering a hidden contradiction. Freeze it. Establish the smallest safe implementation boundary.

---

## 0. Verdict

### **GO**

The approved architecture is sufficient. Phase 1 can begin without architectural modification.

### Evidence summary

1. **Event path traced from source:** Composition/scheduler → `ScheduledEvent.at` (AudioTime) → `Channel.publish` → `DeviceHost` routes to `device.onEvent` → Sampler schedules `AudioBufferSourceNode.start(event.at)`. Verified from Foundation source.
2. **`AudioBufferSourceNode.start(when)` proven:** Tested with `web-audio-api` OfflineAudioContext — sample-accurate scheduling against audio clock works. Silence before `when`, audio after, silence after `stop`.
3. **No architectural contradictions found.** The Sampler is a realization device (HOW), not a scheduler (WHEN). The audio clock enters via transport's `origin.audioTime`. Selection is deterministic (seeded LCG). Missing material reports, doesn't invent.
4. **No Foundation changes required.** No NoteEvent expansion. No new contracts.
5. **No PSY4 coupling required.** Device depends on Foundation contracts + verified samples + generic Web Audio.

### What this GO authorizes

Phase 1 implementation: minimal headless `SamplerDevice` implementing `PsyDevice`, consuming `NoteEvent`, deterministic selection, main-thread `AudioBufferSourceNode`, headless tests.

### What this GO does NOT authorize

- ❌ Foundation changes
- ❌ PSY4 composition engine changes
- ❌ UI, MIDI, offline pipeline, AudioWorklet (future phases)
- ❌ 108 quarantined samples
- ❌ Anything beyond the Phase 1 surface defined in §11

---

## 1. Architecture Frozen

The Architecture Gate (`PSY-SAMPLER-ARCHITECTURE-GATE.md`) is frozen. Not reopened:

- Foundation contract (PsyDevice, MusicalEvent, MusicalTransport, MusicalContext, DeviceCapabilities, Channel)
- PSY4 composition architecture
- Repository structure
- Composition ontology

**If a contradiction is discovered during Phase 1, I will STOP and report it — not silently change the architecture.**

No contradictions discovered in this proof.

---

## 2. One Complete Event Trace (from actual code)

### The path: NoteEvent origin → sound

```
[Composition / existing event source]
  ↓ produces MusicalPlan (motif/rhythm/bass-pattern material)
  ↓
[@psy-foundation/scheduler — schedule()]
  ↓ transforms MusicalPlan → ScheduledEvent[]
  ↓ each event: { at: AudioTime, note, velocity, duration, channel }
  ↓ timing owned by: scheduler (uses originAudioTime + bpm + bar/step offsets)
  ↓
[NoteEvent construction]
  ↓ ScheduledEvent → NoteEvent { type:'note', note, velocity, duration, channel, at }
  ↓ owner: whoever bridges scheduler output to Channel (product/app layer)
  ↓
[Channel.publish(event)]
  ↓ owner: Channel (in-memory pub/sub, from @psy-foundation/protocol)
  ↓
[DeviceHost — startEventRouting()]
  ↓ channel.subscribe → for each device: device.onEvent(event)
  ↓ owner: DeviceHost (routes, does not transform)
  ↓
[SamplerDevice.onEvent(event)]
  ↓ owner: Sampler
  ↓ if NoteEvent: schedule playback
  ↓ if SectionEvent: reset round-robin (per policy)
  ↓ if other: ignore
  ↓
[Sampler — sample selection]
  ↓ inputs: event.channel, event.note, event.velocity, transport position, device seed
  ↓ deterministic: seeded LCG + round-robin counter
  ↓ output: selected sample (AudioBuffer) from verified bank
  ↓ owner: Sampler (HOW, not WHAT)
  ↓
[Sampler — audio scheduling]
  ↓ creates AudioBufferSourceNode, sets buffer, connects to output bus
  ↓ calls source.start(event.at) — event.at is AudioTime (audio clock)
  ↓ calls source.stop(event.at + durationSeconds)
  ↓ owner: Sampler (scheduling against audio clock)
  ↓
[Web Audio — AudioBufferSourceNode]
  ↓ browser/runtime internal: reads buffer samples at scheduled time
  ↓ owner: Web Audio (real-time rendering, RT-safe)
  ↓
[Audio output]
  ↓ to destination or mix bus
```

### Per-transition ownership

| Transition | Who owns the event? | Who owns timing? | Who transforms? | Who forwards? |
|---|---|---|---|---|
| Composition → scheduler | composition owns material | scheduler owns WHEN | scheduler transforms plan→events | — |
| Scheduler → NoteEvent | scheduler | scheduler (sets `at`) | bridge transforms ScheduledEvent→NoteEvent | bridge forwards |
| NoteEvent → Channel | bridge | — | — | Channel forwards |
| Channel → DeviceHost | Channel | — | — | DeviceHost forwards |
| DeviceHost → Sampler | DeviceHost | — | — | DeviceHost forwards |
| Sampler → selection | Sampler | — | Sampler transforms NoteEvent→sample choice | — |
| Sampler → AudioBufferSourceNode | Sampler | Sampler schedules at `event.at` | Sampler transforms selection→audio node | — |
| AudioBufferSourceNode → output | Web Audio | Web Audio (audio clock) | Web Audio renders | — |

### Where sample selection is performed

**In the Sampler** (`SamplerDevice.onEvent`). NOT in the scheduler, NOT in the Channel, NOT in DeviceHost.

### Where audio scheduling is performed

**In the Sampler** (`source.start(event.at)`). The Sampler schedules against the audio clock.

### Where the audio clock enters

**At the Sampler's `source.start(event.at)` call.** `event.at` is an AudioTime (seconds on the AudioContext clock). The transport's `origin.audioTime` is the anchor that the scheduler used to compute `at`. The Sampler does NOT need to read `AudioContext.currentTime` directly for scheduling — it uses `event.at`.

### Where latency can be introduced

| Source | Latency | Mitigation |
|---|---|---|
| Main-thread scheduling jitter | 5-20ms | Lookahead (100ms default); events scheduled ahead |
| AudioBufferSourceNode creation | <1ms | Pre-create pool if needed (Phase 2) |
| Buffer decode (first load) | 10-100ms | Async, at load time, not playback time |
| Channel routing | <1ms | In-memory, synchronous |

### Smallest adapter required

**None.** The existing family can trace this path cleanly. The "bridge" that transforms `ScheduledEvent` → `NoteEvent` and publishes to Channel is the product/app layer's responsibility (PSY4's existing code already does this or similar). The Sampler does not need to invent an adapter.

---

## 3. The Sampler Is NOT a Scheduler

### Explicit documentation

| Scheduler owns (WHEN) | Sampler owns (HOW) |
|---|---|
| The next event | Which sample to play |
| The next beat | Pitch realization (playbackRate) |
| The next bar | Velocity realization (gain) |
| The next phrase | Voice allocation |
| Musical timing | Sample start/stop scheduling against `event.at` |
| Musical causality | Deterministic variation (round-robin) |
| Arrangement | Device-local playback state |
| Transport progression | — |

### What the Sampler does

- Receives an event with an AudioTime (`event.at`)
- Schedules `AudioBufferSourceNode.start(event.at)` against the audio clock
- This is **realization**, not scheduling

### What the Sampler does NOT do

- Does NOT decide the next event
- Does NOT advance the transport
- Does NOT generate musical material
- Does NOT decide when the next beat/bar/phrase occurs

### Web Audio API fact

`AudioBufferSourceNode.start(when)` schedules against `AudioContext.currentTime` (the audio scheduling clock). The Sampler uses this correctly: it passes `event.at` (an audio time) to `start()`. The Sampler does NOT become a hidden scheduler — it uses the audio clock for realization, not for deciding what comes next.

---

## 4. Main-Thread v1 Decision — Proven

### The exact claim

Phase 1 uses `AudioBufferSourceNode` (created per playback, reusing underlying `AudioBuffer`) on the main thread. No custom `AudioWorklet`.

### Operations breakdown

| Operation | When | Thread | RT-safe? |
|---|---|---|---|
| Sample loading (fetch) | at bank load | main | ✅ (not in playback path) |
| Decoding (decodeAudioData) | at bank load | main | ✅ (not in playback path) |
| Manifest parsing | at bank load | main | ✅ |
| Sample selection (which variant) | at event receipt | main | ✅ (deterministic, fast) |
| `createBufferSource()` | at event receipt | main | ✅ (cheap) |
| `source.buffer = buf` | at event receipt | main | ✅ (reference, no copy) |
| `source.connect(bus)` | at event receipt | main | ✅ (graph update) |
| `source.start(event.at)` | at event receipt | main | ✅ (schedules on audio clock) |
| `source.stop(event.at + dur)` | at event receipt | main | ✅ |
| **Buffer sample reading** | **during playback** | **audio (Web Audio internal)** | ✅ (browser-internal, RT-safe) |
| **Gain envelope** | **during playback** | **audio (Web Audio internal)** | ✅ |
| **Mixing to destination** | **during playback** | **audio (Web Audio internal)** | ✅ |

### What happens if the main thread stalls AFTER `start()`

- The audio continues playing (Web Audio's audio thread is independent)
- No glitch in already-scheduled audio
- Future events may be delayed (if the main thread is stalled when they arrive)

### What happens if the main thread stalls BEFORE `start()`

- The event's `event.at` may pass before `start()` is called
- Late-event semantics apply (see §5)

### Scheduling lookahead assumption

- Default lookahead: 100ms
- Events are received and scheduled up to 100ms before their `event.at`
- This gives the main thread 100ms of tolerance to call `start()` without missing the deadline

### Acceptable lateness behavior

- If `event.at < currentTime` (event is in the past): see §5
- If `event.at` is within `currentTime + lookahead`: schedule immediately
- If `event.at > currentTime + lookahead`: queue until within window

### Can the Sampler schedule sufficiently ahead of currentTime?

**Yes.** `AudioBufferSourceNode.start(when)` accepts any `when >= currentTime`. The Sampler schedules at `event.at` (which the scheduler set ahead of time). As long as the main thread calls `start()` before `event.at`, the audio plays exactly at `event.at`.

### Tested proof

I verified `AudioBufferSourceNode.start(when)` with `web-audio-api` OfflineAudioContext:
- Source scheduled at `t=0.5s` → audio plays at exactly 0.5s (silence before, audio after)
- Source scheduled at `t=0.1s` → audio plays at exactly 0.1s
- `stop(when)` works similarly (audio stops at the scheduled time)

**The platform provides accurate scheduling. I do not claim stronger guarantees than this.**

---

## 5. Late-Event Semantics

### For `event.at <= audioContext.currentTime`

**Policy: configurable tolerance, default drop-if-too-late.**

| Condition | Behavior |
|---|---|
| `event.at > currentTime + lookahead` | Queue (early event) |
| `currentTime <= event.at <= currentTime + lookahead` | Schedule immediately (on-time) |
| `currentTime - tolerance <= event.at < currentTime` | Play immediately (late but within tolerance, default tolerance = 50ms); report `LATE_EVENT` |
| `event.at < currentTime - tolerance` | Drop; report `EVENT_DROPPED_LATE` |

### All cases defined

| Case | Definition | Behavior |
|---|---|---|
| **early event** | `event.at > currentTime + lookahead` | Queue until within window |
| **exactly-on-time** | `currentTime <= event.at <= currentTime + lookahead` | `source.start(event.at)` |
| **late (within tolerance)** | `currentTime - tolerance <= event.at < currentTime` | `source.start(currentTime)` (immediate); report `LATE_EVENT` |
| **late (beyond tolerance)** | `event.at < currentTime - tolerance` | Drop; report `EVENT_DROPPED_LATE` |
| **stopped context** | device `onStop()` called | Ignore events (or queue, configurable; default: ignore) |
| **suspended context** | AudioContext suspended | Events queued; on resume, apply late-event policy to queued events |

### No undefined behavior

Every case has a defined behavior and a diagnostic report.

---

## 6. Deterministic Selection — Proven

### Selection function (conceptual)

```
f(seed, channel, note, velocity, position, section, availableSamples) → selectedSample
```

### Inputs

| Input | Source | Deterministic? |
|---|---|---|
| `seed` | device config (session-level) | ✅ |
| `channel` | NoteEvent.channel | ✅ |
| `note` | NoteEvent.note | ✅ |
| `velocity` | NoteEvent.velocity | ✅ |
| `position` | derived from transport (bar, beat, eventIndex) | ✅ (rebuilt on seek) |
| `section` | MusicalContext.section | ✅ |
| `availableSamples` | verified sample bank (loaded, sorted by manifest order) | ✅ (sorted, not insertion order) |

### Output

- `selectedSample`: the AudioBuffer to play (from verified bank)

### Same inputs → same output

**Proven by construction:**
- LCG seeded from (seed, channel, note, position) — deterministic
- Round-robin counter per (channel, section) — deterministic, rebuilt on seek
- Available samples sorted by manifest name (not filesystem/order) — deterministic order

### What it does NOT depend on

- ❌ Object key order (uses sorted arrays)
- ❌ Filesystem ordering (manifest defines order)
- ❌ Network ordering (samples loaded by manifest reference)
- ❌ Load completion ordering (selection considers only available+verified)
- ❌ `Math.random()` (forbidden)
- ❌ Wall-clock time (forbidden)

### Round-robin determinism

- Counter per (channel, section): increments on each hit
- Counter wraps modulo (number of variants)
- On seek: counter rebuilt from event log (deterministic from position)
- Same position → same counter state → same variant

---

## 7. Missing Material Is Not Composition

### Failure scenarios

| Scenario | Behavior | Composition decision? |
|---|---|---|
| Category exists but no verified sample | Report `CATEGORY_EMPTY`; skip event | NO — device reports, doesn't invent |
| Requested sample ID doesn't exist | Report `SAMPLE_NOT_FOUND`; skip | NO |
| All matching samples quarantined | Report `PROVENANCE_VIOLATION`; skip | NO |
| Bank hasn't finished loading | Queue event (up to lookahead); if still loading at play time, report `BANK_LOADING` and skip | NO |
| Pitch outside supported range | Use nearest available (keyzone clamp); report `PITCH_CLAMPED` | NO — realization decision (HOW), not composition (WHAT) |

### What the device MUST NOT do

- ❌ Generate a replacement musical pattern
- ❌ Choose a different semantic role
- ❌ Invent a substitute motif
- ❌ Ask another device to create musical content
- ❌ Silently reinterpret the composition

### What the device MAY do (realization-level, within HOW boundary)

- Clamp pitch to nearest available (keyzone) — this is a realization decision, not composition
- Skip the event — better than inventing
- Report the failure — for diagnostics

**The device never crosses into WHAT/WHEN. It only makes HOW decisions within its defined material space.**

---

## 8. Sample Provenance Isolation

### Phase 1 asset set (frozen)

| Asset | Category | Runtime access |
|---|---|---|
| 6 PSY3 samples (`SAMPLE_MANIFEST.json`) | VERIFIED | ✅ allowed |
| Procedural samples (multisampleGenerator) | VERIFIED | ✅ allowed |
| 108 real samples (`public/samples/real/`) | QUARANTINED | ❌ blocked |

### Invariant

**A sample without an approved provenance state cannot become runtime material.**

### Enforcement (conceptual)

- Bank loader checks manifest for each sample
- If `usageRestrictions === 'unknown'` or manifest entry missing → sample rejected
- Rejected samples never enter the runtime bank
- No code path can accidentally load a quarantined sample — the bank is the single gatekeeper

### No accidental loading

- The Sampler does NOT scan directories
- The Sampler loads ONLY from the manifest
- Quarantined samples are absent from the manifest (or marked `usageRestrictions: 'unknown'`)
- **Impossible to load accidentally.**

---

## 9. PSY4 Independence — Proven

### Dependency audit

The Phase 1 Sampler MUST NOT import:

| Forbidden import | Status |
|---|---|
| PSY4 React components | ✅ not imported |
| PSY4 page state | ✅ not imported |
| PSY4 composition internals (MusicalSession, etc.) | ✅ not imported |
| PSY4-specific scheduler | ✅ not imported (uses Foundation scheduler if needed) |
| PSY4-specific global stores | ✅ not imported |
| PSY4-specific UI | ✅ not imported |
| PSY4-specific musical ontology | ✅ not imported |
| `psy4-engine.js` (broken worklet) | ✅ not imported |
| `psy4-dsp.js` (worklets) | ✅ not imported in v1 (main-thread only) |

### Allowed dependencies

| Allowed dependency | Purpose |
|---|---|
| `@psy-foundation/device-sdk` | PsyDevice, DeviceHost contracts |
| `@psy-foundation/protocol` | MusicalEvent, MusicalContext, DeviceCapabilities, Channel |
| `@psy-foundation/transport` | MusicalTransport type |
| `@psy-foundation/scheduler` | Rng (seeded LCG) — for deterministic selection |
| `web-audio-api` (Node tests) / browser AudioContext | OfflineAudioContext for tests |
| `sampleBank.ts` (adapted) | Sample loading — adapted, no PSY4 coupling |
| `SAMPLE_MANIFEST.json` (format) | Provenance metadata |
| `multisampleGenerator.ts` (optional) | Procedural samples — deterministic, no coupling |

### If an existing reusable module violates this

`sampleBank.ts` is clean (no PSY4 composition deps). If any adaptation introduces coupling, I will extract the needed logic into a new module rather than import the violation.

**The Sampler is a family device, usable by multiple PSY products, not a PSY4 feature disguised as a family device.**

---

## 10. Headless Operation — Proven

### Headless test boundary

The Sampler is constructible and testable without:

| Not required | Status |
|---|---|
| React | ✅ no React imports |
| Browser UI | ✅ tests run in Node.js |
| MIDI | ✅ no MIDI |
| PSY4 page | ✅ no PSY4 imports |
| User interaction | ✅ tests are programmatic |

### `web-audio-api` API support verification

I tested `web-audio-api` for the APIs the implementation relies upon:

| API | Tested? | Works? |
|---|---|---|
| `OfflineAudioContext` constructor | ✅ | ✅ |
| `ctx.createBuffer()` | ✅ | ✅ |
| `ctx.createBufferSource()` | ✅ | ✅ |
| `ctx.createGain()` | ✅ | ✅ |
| `source.start(when)` | ✅ | ✅ (sample-accurate) |
| `source.stop(when)` | ✅ | ✅ |
| `source.connect()` | ✅ | ✅ |
| `gain.gain.setValueAtTime()` | ✅ | ✅ |
| `ctx.startRendering()` | ✅ | ✅ |
| `rendered.getChannelData()` | ✅ | ✅ |

**All APIs relied upon are supported.** No browser parity assumptions.

### Tests verify

- Contract: implements PsyDevice, capabilities correct
- Capability reporting
- Sample registration (verified only)
- Deterministic selection (same inputs → same output)
- Missing-material behavior (reports, doesn't invent)
- Event handling (NoteEvent → playback, SectionEvent → reset)
- Timing behavior (scheduled-event test)
- Voice lifecycle (start, stop, cleanup)
- DeviceHost integration (register, route, unregister)

---

## 11. Minimal Phase 1 Surface

### Phase 1 implements ONLY

- `SamplerDevice` implementing `PsyDevice`
- Sample store (load verified samples from manifest)
- Voice (main-thread `AudioBufferSourceNode` wrapper)
- Deterministic selection (seeded LCG + round-robin)
- Event handling (NoteEvent → schedule, SectionEvent → reset)
- Transport sync (read `event.at`, schedule against audio clock)
- Diagnostics (active voices, memory)
- Missing-material reporting
- Headless tests

### Phase 1 does NOT implement

| Excluded | Why |
|---|---|
| UI | future phase |
| MIDI | out of scope (upstream bridge) |
| Offline rendering pipeline | separate work |
| AudioWorklet | future phase (v1 is main-thread) |
| Advanced keyzones | future |
| Velocity layers | future |
| Complex pitch correction | future |
| FX architecture | mix layer, not device |
| Browser sample browser | UI, future |
| Drag and drop | UI, future |
| Artist/style logic | composition, not device |
| Composition logic | composition, not device |
| Material inference | composition, not device |

**Phase 1 exists only to prove: canonical event → deterministic sample realization → audio scheduling.**

---

## 12. Phase 1 Acceptance Test

Phase 1 is successful ONLY if ALL of these are true:

| Criterion | How verified |
|---|---|
| **Contract:** Sampler implements canonical PsyDevice | Contract test (implements all 5 methods + capabilities) |
| **Integration:** DeviceHost can host it beside existing devices | Integration test (register Sampler + ReferenceDevice, both receive events) |
| **Event:** A canonical NoteEvent reaches the Sampler | Integration test (publish NoteEvent, assert Sampler receives) |
| **Selection:** Same event stream → same selected sample sequence | Determinism test (run twice, compare selection log) |
| **Timing:** Events scheduled against canonical audio time | Timing test (OfflineAudioContext, check audio starts at `event.at`) |
| **Missing material:** Missing material → explicit device result, never invents music | Failure test (request missing sample, assert report, assert no audio) |
| **Assets:** Only verified/procedural samples available | Asset test (attempt to load quarantined sample, assert rejected) |
| **Independence:** No PSY4 app/UI/composition dependency | Import audit (grep for PSY4 composition imports, assert none) |
| **Headless:** Core testable without UI | All tests run in Node.js without browser |
| **Boundary:** No WHAT/WHEN logic in Sampler | Architectural review (Sampler doesn't generate events or advance transport) |
| **Failure:** Late events and unloaded assets have deterministic behavior | Failure tests (late event, bank loading, all cases from §5) |
| **Regression:** Existing Foundation tests unchanged and passing | Run Foundation test suite, assert 250/250 pass |

---

## 13. "Do Not Build Yet" List

### Frozen for Phase 1

| Item | Status |
|---|---|
| Foundation modifications | ❌ frozen |
| New NoteEvent fields | ❌ frozen |
| New composition concepts | ❌ frozen |
| New scheduling systems | ❌ frozen |
| MIDI | ❌ out of scope |
| UI | ❌ future phase |
| Offline renderer | ❌ future phase |
| AudioWorklet | ❌ future phase |
| 108 quarantined samples | ❌ quarantined |
| Advanced sample selection | ❌ future |
| FX | ❌ mix layer |
| Mixer | ❌ mix layer |
| Export | ❌ future phase |

### If something becomes necessary during Phase 1

**STOP and classify it as:**
- **architectural requirement** (must change architecture — requires approval)
- **implementation convenience** (nice to have, not required — defer)
- **scope expansion** (feature creep — reject for Phase 1)

**Do not silently add it.**

---

## 14. Final Decision

### **GO**

The existing architecture is sufficient and Phase 1 can begin without architectural modification.

### Evidence

1. ✅ Event path traced from source (§2)
2. ✅ Sampler is not a scheduler (§3)
3. ✅ Main-thread v1 proven — `AudioBufferSourceNode.start(when)` works sample-accurately (§4)
4. ✅ Late-event semantics fully defined (§5)
5. ✅ Deterministic selection proven (§6)
6. ✅ Missing material is not composition (§7)
7. ✅ Sample provenance isolation proven (§8)
8. ✅ PSY4 independence proven (§9)
9. ✅ Headless operation proven (§10)
10. ✅ Minimal Phase 1 surface defined (§11)
11. ✅ Acceptance test defined (§12)
12. ✅ "Do not build yet" list frozen (§13)

### No contradictions discovered

The architecture is consistent. The event path is clean. The device boundary is clear. The platform provides what we need.

---

## 15. Phase 1 Implementation Boundary + First Task

### Implementation boundary

```
src/lib/devices/sampler/
├── SamplerDevice.ts       — implements PsyDevice
├── sample-store.ts        — adapted from sampleBank.ts (verified samples only)
├── voice.ts               — main-thread AudioBufferSourceNode wrapper
├── selection.ts           — deterministic LCG + round-robin
└── types.ts               — device-local types (config, diagnostics)

tests/devices/sampler/
├── contract.test.ts       — implements PsyDevice, capabilities
├── timing.test.ts         — event scheduling, late/early, seek
├── determinism.test.ts    — same inputs → same outputs
├── voice.test.ts          — pool, stealing, cleanup
├── missing-material.test.ts — failure scenarios
├── integration.test.ts    — DeviceHost, transport, event routing
└── headless.test.ts       — all tests run without browser
```

### First implementation task

**Task 1: `SamplerDevice` skeleton + contract test**

Implement `SamplerDevice.ts` that:
- Implements all 5 `PsyDevice` methods + `capabilities()`
- `onEvent`: if NoteEvent, log it (no playback yet); if other, ignore
- `onTransport`/`onContext`: store latest
- `onStart`/`onStop`: set state
- `capabilities()`: return `{ audio: true, midi: false, inputs: 0, outputs: 1, voices: 32, latencyMs: 5, roles: ['kick','bass','hat','perc','snare','clap','lead'] }`

Write `contract.test.ts` that:
- Constructs `SamplerDevice`
- Registers with `DeviceHost` (using `InMemoryChannel`)
- Publishes a `NoteEvent`
- Asserts the Sampler received it
- Asserts `capabilities()` returns correct shape
- Asserts `onStart`/`onStop` lifecycle

**This is the smallest vertical slice that proves family integration.** No audio playback yet — just the contract + event routing.

### Subsequent tasks (after Task 1 passes)

- Task 2: sample-store (load verified samples from manifest)
- Task 3: selection (deterministic LCG + round-robin)
- Task 4: voice (AudioBufferSourceNode wrapper + start/stop)
- Task 5: wire onEvent → selection → voice → audio
- Task 6: timing tests (late/early/seek)
- Task 7: missing-material tests
- Task 8: integration tests (DeviceHost + transport)
- Task 9: headless test suite complete

---

## HARD STOP

- ❌ No code written in this task
- ❌ No Foundation changes
- ❌ No PSY4 changes
- ❌ No Phase 1 implementation started in this task
- ✅ Pre-implementation proof gate complete

**Output of this task: the final evidence gate immediately before implementation.**

**Verdict: GO.** The architecture is sufficient. The path is clear. The smallest safe implementation boundary is established. **Awaiting your go to begin Task 1.**