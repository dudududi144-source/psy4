# PSY Sampler Device — Integration Design

**Status:** DESIGN DOCUMENT ONLY. No code. No Foundation changes. No PSY4 changes. No new repository. No implementation. No audio rendering.
**Date:** 2024-08-13
**Scope:** Plan the PSY Sampler Device as a genuine family citizen, respecting the Foundation contract, the WHAT/WHEN/HOW boundaries, and the composition architecture being built in PSY4.

---

## 1. Executive Summary

### Goal

Build a Sampler device that is a true citizen of the PSY family — implementing the canonical `PsyDevice` contract from `@psy-foundation/device-sdk`, consuming `MusicalTransport` / `MusicalContext` / `MusicalEvent`, and turning composition-decided material into deterministic sample playback — **without leaking composition logic into the device**.

### Key findings

1. **Foundation has a clean, frozen canonical contract.** `PsyDevice`, `DeviceHost`, `MusicalTransport`, `MusicalContext`, `MusicalEvent`, `DeviceCapabilities`, `Channel` are all defined in `@psy-foundation/{device-sdk,protocol,transport}`. 250 tests pass. The contract is minimal (5 methods + 2 optional) and does NOT prescribe synthesis. The Sampler must implement this contract, not invent a new one.

2. **PSY4 has reusable sample infrastructure — but with critical defects.** `sampleBank.ts` (loader), `multisampleGenerator.ts` (procedural), `psy4-dsp.js` (DSP worklets), `SAMPLE_MANIFEST.json` (gold-standard provenance format) are REUSE. But `psy4-engine.js` has **real-time contract violations** (per-drum-hit array allocation in `process()`) and **non-determinism** (`Math.random()` in audio-thread voices). These must be fixed before porting.

3. **108 real samples lack license metadata.** `public/samples/real/manifest.json` has 108 entries with no `source`/`author`/`license`/`attribution` fields — while `SAMPLE_MANIFEST.json` (the gold standard) explicitly requires these. **Commercial use is legally risky** until provenance is established.

4. **No MIDI path exists in Foundation.** MIDI → MusicalEvent translation is missing across the family. The Sampler should consume `MusicalEvent` (already the contract); MIDI translation belongs upstream (Foundation or a dedicated MIDI bridge), NOT in the device.

5. **Offline renderer is a stub.** `offlineRenderer.ts` returns zero-filled arrays. The `writeWavFile` helper is reusable, but the offline pipeline must be built properly.

6. **The Sampler must NOT be a composer.** Per the composition engine work, the device receives material the composition engine already decided. The Sampler's job is HOW (playback), not WHAT (which material) or WHEN (when it enters).

### Verdict

**CONDITIONAL GO.** The canonical contract is verified, ownership boundaries are explicit, and a minimal implementation path exists. Three conditions must be met before implementation:
1. Real-time violations in `psy4-engine.js` must be fixed (or the DSP classes extracted into a new clean worklet).
2. Sample provenance must be established for all samples (or unverified samples quarantined).
3. The `NoteEvent` contract gap (see §23) must be resolved — the Sampler needs sample-selection info that `NoteEvent` doesn't currently carry.

---

## 2. Repository Topology

### The PSY family (verified)

| Repo | Path | Role | Frozen? |
|---|---|---|---|
| **psy-foundation** | `/tmp/psy-foundation` | Canonical contracts (transport, protocol, device-sdk, music, material, scheduler, analysis, learning, dsp) | YES (250 tests pass, FOUNDATION_FREEZE.md) |
| **psy4** | `/home/z/my-project` | PSY4 device + composition engine work + sample infrastructure | NO (active development) |
| **nexus-psy7** | `/tmp/nexus-psy7` | Alternative voice architecture (FM/unison) + sampler-tool (buffer utilities) | standalone |
| **psy5** | `/tmp/psy-repos/psy5` | Experimental fork (mostly empty/scratch) | — |
| **psy3-clean** | `/tmp/psy-repos/psy3-clean` | Earlier prototype (Python-based production knowledge) | — |
| **psy** | `/tmp/psy-repos/psy` | Original psy (minimal) | — |

### Where the Sampler device lives

**Decision:** The Sampler device lives in PSY4 (`/home/z/my-project`), as a new module under `src/lib/devices/sampler/`. It is NOT a new repository. It imports from `@psy-foundation/device-sdk` (the canonical contract) and reuses PSY4's sample infrastructure where verified safe.

**Rationale:**
- Foundation is frozen — the Sampler cannot live there.
- PSY4 already has the sample infrastructure and the composition engine work.
- A new repository would create an architecture fork (explicitly forbidden).
- The Sampler is a device citizen of the PSY4 app, consuming Foundation contracts.

---

## 3. Canonical Contract Audit (verified from source)

I opened the actual files. The contracts are:

### `PsyDevice` (`packages/device-sdk/src/device.ts`)

```typescript
export interface PsyDevice {
  id: string
  capabilities(): DeviceCapabilities
  onTransport(transport: MusicalTransport): void
  onContext(context: MusicalContext): void
  onEvent(event: MusicalEvent): void
  onStart?(): void
  onStop?(): void
  reportLatencyMs?(): number
}
```

**5 required methods + 3 optional.** Minimal. Does NOT prescribe synthesis, voice count, or sample handling. The Sampler implements this exactly.

### `DeviceHost` (`packages/device-sdk/src/host.ts`)

- `register(device)`, `unregister(id)`, `list()`, `findByRole(role)`
- `pushTransport(transport, nowMs)` — with dedup by revision + min-interval throttling
- `pushContext(context)`
- `publish(event)` — publishes to all devices via Channel
- Routes events from Channel to all registered devices' `onEvent`

**The Sampler registers with DeviceHost. DeviceHost routes transport/context/events. The Sampler does NOT poll — it receives.**

### `MusicalTransport` (`packages/transport/src/types.ts`)

```typescript
export interface MusicalTransport {
  bpm: number
  beat: number
  bar: number
  beatsPerBar: number
  beatTime: EstimatedBeatTime  // audio clock time of current beat
  barTime: number
  phase: number
  barPhase: number
  confidence: number
  locked: boolean
  revision: number
  origin: { audioTime: AudioTime; beatIndex: number; bpm: number }
  lastObservationAgo: number
  observationCount: number
}
```

**The transport carries `beatTime` (audio clock) and `origin.audioTime` — these are the timing authority.** The Sampler schedules playback against `beatTime` + `origin.audioTime`, NOT against `Date.now()` or `performance.now()`.

### `MusicalContext` (`packages/protocol/src/state.ts`)

```typescript
export interface MusicalContext {
  key: string
  rootPc: number
  scale: string
  energy: number
  style: string
  section: string
  beatsPerBar: number
}
```

**Musical context for the Sampler.** The Sampler reads `rootPc` (for pitch), `style`/`section` (for deterministic sample selection), but does NOT make composition decisions from these.

### `MusicalEvent` (`packages/protocol/src/events.ts`)

```typescript
export type MusicalEvent =
  | BeatEvent      // { type: 'beat', beat, bar, transport, at }
  | SectionEvent   // { type: 'section', section, bar, at }
  | EnergyEvent    // { type: 'energy', energy, at }
  | DropEvent      // { type: 'drop', intensity, at }
  | NoteEvent      // { type: 'note', note, velocity, duration, channel, at }
  | PatternEvent   // { type: 'pattern', patternId, trackId, at }
```

**`NoteEvent` is the primary event the Sampler consumes.** It carries: `note` (MIDI), `velocity` (0-1), `duration` (beats), `channel` (string — used as role/track identifier), `at` (audio time).

### `DeviceCapabilities` (`packages/protocol/src/state.ts`)

```typescript
export interface DeviceCapabilities {
  audio: boolean
  midi: boolean
  inputs: number
  outputs: number
  voices: number
  latencyMs: number
  roles: string[]  // which roles this device handles
}
```

**The Sampler declares:** `audio: true`, `midi: false`, `inputs: 0`, `outputs: 1` (audio), `voices: N` (pool size), `latencyMs: X`, `roles: ['kick', 'hat', 'perc', 'snare', 'clap', ...]` (whatever sample categories it can play).

### `Channel` (`packages/protocol/src/channel.ts`)

```typescript
export interface Channel {
  subscribe(listener: ChannelListener): Unsubscribe
  publish(event: MusicalEvent): void
  close(): void
  readonly name: string
}
```

**In-memory pub/sub.** DeviceHost subscribes to Channel and routes events to devices. The Sampler does NOT subscribe directly — it receives via DeviceHost.

### Contract verdict

**The canonical contract is sufficient for a Sampler device.** It provides:
- Transport (timing authority)
- Context (musical situation)
- Events (note triggers)
- Capabilities (declaration)
- Host (registration + routing)

**No new contract is needed for the basic Sampler.** The only gap is `NoteEvent`'s lack of sample-selection info (see §23).

---

## 4. Existing Sampler Infrastructure Audit

From AUDIT-SAMPLER report (`audit-reports/AUDIT-SAMPLER-PSY4-INFRASTRUCTURE.md`):

### Reuse / Adapt / Rewrite / Do Not Port

| Component | File | Verdict | Reason |
|---|---|---|---|
| Sample loader | `sampleBank.ts` | **REUSE** | Clean, deterministic, decoupled. Replace O(N²) DFT with FFT; add `dispose()`. |
| Procedural generator | `multisampleGenerator.ts` | **REUSE** | Deterministic LCG-seeded. Self-contained. (Currently dead code.) |
| Audio backend interface | `audioBackend.ts` | **ADAPT** | Split 26-method interface into focused interfaces. |
| Worklet wrapper | `engineWorklet.ts` | **ADAPT** | Parameterize processor name. Move musical helpers out. |
| Engine worklet | `psy4-engine.js` | **ADAPT** | DSP classes reusable; **MUST FIX: per-drum-hit array allocation in `process()`, `Math.random()` in audio-thread voices.** |
| DSP worklets | `psy4-dsp.js` | **REUSE** | Gold standard. Modular, deterministic, RT-safe. |
| Offline renderer | `offlineRenderer.ts` | **DO NOT PORT** | Stub. Returns zero-filled arrays. Port only `writeWavFile`. |
| Sample manifest (root) | `SAMPLE_MANIFEST.json` | **REUSE** | Excellent format. Extend to all samples. |
| Real samples manifest | `public/samples/real/manifest.json` | **ADAPT** | **Add license/source/author/attribution. Currently provenance-bare → legal risk.** |
| `SampleVoice` class | (in `psy4-engine.js`) | **ADAPT** | Add cubic interpolation, anti-aliasing, loop mode, keyzones, ADSR. Fix linear pan. |
| Voice pools | (in `psy4-engine.js`) | **ADAPT** | Promote to `VoicePool` class with priority-based stealing. |
| DSP classes (reverb, delay, bus, comp, master) | (in `psy4-engine.js`) | **REUSE** | Preallocated, RT-safe, deterministic. |
| MIDI path | (none) | **REWRITE** | No MIDI path exists. But MIDI → MusicalEvent belongs upstream, not in device. |
| nexus-psy7 sampler-tool | `src/lib/audio/sampler-tool/` | **REUSE** | Buffer utilities (decode, normalize, reverse, trim, slice). Clean, no deps. |

### Critical defects to fix before porting

1. **Real-time violation:** `triggerVoice()` for drums executes `Object.keys(this.samples).filter(...).filter(...)` on every hit, inside `process()`. Two array allocations + two filter closures per hit. **Fix:** precompute category-name arrays once; rebuild only when samples change.

2. **Non-determinism:** `AcidVoice.trigger()` and `TextureVoice.trigger()` use `Math.random()` on the audio thread. Same seed → different renders. **Fix:** replace with per-voice LCG seeded from event param or session seed.

3. **Provenance gap:** 108 real samples have no license metadata. **Fix:** extend `SAMPLE_MANIFEST.json` format to all samples; audit each license or replace with CC0.

---

## 5. Device Boundary

### Sampler Device OWNS (HOW)

- Sample loading (from manifest paths)
- Decoded sample storage (AudioBuffer cache)
- Sample playback (AudioBufferSourceNode or worklet voice)
- Voice allocation (pool, stealing, priority)
- Pitch playback (playbackRate or resampling)
- Velocity response (gain scaling)
- Deterministic sample selection (round-robin, keyzones)
- Voice start/stop
- Timing (schedule against transport's audio clock)
- Basic device-local playback state (active voices, round-robin counters)

### Sampler Device does NOT OWN (WHAT / WHEN / MIX)

- Composition (which material exists)
- Arrangement (when roles enter/exit)
- Deciding what motif exists
- Deciding why material exists
- Genre logic
- Section generation
- Expectation / tension / musical causality
- Artist identity
- Synthesis policy (FM/wavetable choice — that's a synth device, not sampler)
- Master/mix decisions (EQ, compression, LUFS, stereo field)

### Boundary enforcement

The Sampler receives `MusicalEvent`s. It does NOT decide which events to generate. If the composition engine hasn't sent a `NoteEvent` for a counterline, the Sampler doesn't play one. If the composition engine sends a `NoteEvent` with `channel: 'kick'`, the Sampler plays a kick sample — it doesn't decide "actually, this should be a snare."

**Critical:** if the Sampler is asked to play material it doesn't have (e.g., a 'counterline' channel but no counterline samples), it reports a `MISSING_MATERIAL` diagnostic — it does NOT invent a substitute.

---

## 6. Timing Architecture

### Authority: AudioContext.currentTime (via transport)

The transport carries `beatTime` (audio clock time of the current beat) and `origin.audioTime`. The Sampler schedules playback against these.

### Forbidden timing sources

- ❌ `Date.now()` — wall clock, not sample-accurate
- ❌ `performance.now()` as musical clock — not synced to audio context
- ❌ `setInterval` / `setTimeout` for sequencing — jitter, not sample-accurate
- ❌ Browser randomness for timing

### Required timing behavior

| Scenario | Behavior |
|---|---|
| **Event arrives on time** | Schedule playback at `event.at` (audio time) |
| **Event arrives late** (`event.at` < `currentTime + lookahead`) | Play immediately if still musically valid; drop if too late (configurable threshold, default 50ms) |
| **Event arrives early** | Queue until `event.at` |
| **Transport jumps (seek)** | Flush pending events; reset round-robin state deterministically from new position |
| **Section changes** | No automatic behavior — Sampler follows events. Section change may reset round-robin (configurable) |
| **Device starts after transport** | Sampler reads current transport state on `onTransport`; does not backfill missed events |
| **Pause/resume** | `onStop()` suspends voice scheduling; `onStart()` resumes. Active voices' release tails continue or are truncated (configurable) |

### Lookahead scheduling

The Sampler maintains a lookahead window (default 100ms — configurable). Events within the window are scheduled to AudioContext. Events beyond the window are queued.

### Worklet timing

If the Sampler uses an AudioWorklet for voice rendering (preferred for RT safety), the worklet's `process()` runs at audio block rate (128 samples = ~2.9ms at 44100Hz). Event scheduling happens on the main thread; the worklet receives scheduled voice starts via `MessagePort` with audio-time timestamps.

---

## 7. Determinism Architecture

### Mandatory rule

**Same composition + same sample bank + same seed = same rendering decision.**

### Deterministic selection function

Sample selection (round-robin, keyzone) is a pure function of:
```
f(worldSeed, materialId/channel, midiNote, velocity, section, phrase, eventIndex) → sampleIndex
```

- `worldSeed`: session-level seed (from transport or device config)
- `materialId`/`channel`: which sample category
- `midiNote`: pitch (for keyzone selection)
- `velocity`: dynamic layer (if multi-velocity samples)
- `section`/`phrase`/`eventIndex`: position in the arrangement (for round-robin reset logic)

### Implementation

- Use a seeded LCG (linear congruential generator) — NOT `Math.random()`
- The seed is derived from the inputs above
- Same inputs → same LCG state → same selection

### Round-robin determinism

Round-robin is NOT random. It's a deterministic counter:
- Per (channel, section): maintain a counter
- Counter increments on each hit
- Counter wraps modulo (number of variants)
- On seek: counter resets based on position (not random)

### Seek behavior

After seek, the same event at the same position must select the same sample. This requires:
- The counter state is a function of position (not of runtime history)
- OR: the counter is rebuilt from the event log up to the seek point

**Decision:** counter is rebuilt from event log. The Sampler tracks events played per (channel, section) and can rebuild state on seek.

---

## 8. Sample Lifecycle

### Stages

```
DISCOVER (manifest scan)
  ↓
MANIFEST (parse metadata, verify license)
  ↓
FETCH (load file bytes — async, main thread)
  ↓
DECODE (decodeAudioData — async, main thread)
  ↓
ANALYZE (compute peak, rms, centroid — if not in manifest)
  ↓
REGISTER (add to sample store with metadata)
  ↓
TRANSFER (if worklet: post buffer to worklet — or share via SharedArrayBuffer)
  ↓
READY (available for playback)
  ↓
PLAY (voice allocated, buffer played)
  ↓
EVICT / DISPOSE (when memory pressure or device disposal)
```

### Per-stage ownership

| Stage | Owner | Thread | Memory | Failure mode |
|---|---|---|---|---|
| DISCOVER | Sampler device | main | minimal | manifest missing → empty bank |
| MANIFEST | Sampler device | main | metadata objects | license missing → quarantine sample |
| FETCH | Sampler device | main | ArrayBuffer (temp) | network error → retry / skip |
| DECODE | AudioContext | main | AudioBuffer (large) | decode error → skip + log |
| ANALYZE | Sampler device | main | small metadata | — |
| REGISTER | Sampler device | main | entry in store | — |
| TRANSFER | Sampler device → worklet | main → worklet | transferred buffer | worklet not ready → queue |
| READY | Sampler device | — | — | — |
| PLAY | Voice (worklet or main) | worklet/main | voice state | no free voices → steal |
| EVICT | Sampler device | main | freed buffer | — |

### Memory management

- Decoded AudioBuffers are large (e.g., 1MB per second of 44100Hz mono)
- The Sampler holds a cache (configurable max size, default 256MB)
- LRU eviction when cache full
- On `onStop()` / device disposal: all buffers released
- Worklet-held buffers: explicitly freed via message (worklet cannot GC transferred buffers automatically in all browsers)

---

## 9. Voice Lifecycle

### Voice states

```
IDLE → ACTIVE (playing) → RELEASING → IDLE
```

- **IDLE**: in pool, available
- **ACTIVE**: playing a sample (note on)
- **RELEASING**: release tail (note off, envelope decaying)

### Voice allocation

- **Max voices:** derived from performance budget (default 32, configurable)
- **Priority:** per-role (kick = highest, then bass, then lead, then perc, then hat, then texture)
- **Stealing:** when pool exhausted, steal lowest-priority RELEASING voice; if none, steal lowest-priority ACTIVE voice (with fade to avoid clicks)
- **Protected voices:** kick and bass voices are protected during their attack phase (first 50ms) — not stealable

### Voice pool

- Preallocated (no per-note allocation)
- Fixed-size array of voice objects
- Each voice has: buffer source, gain, envelope state, priority, channel, startTime

### Real-time safety

- Voice objects preallocated at init
- No `new` in `process()`
- No closures in `process()`
- No array creation in `process()` (use preallocated arrays)
- No `Math.random()` (use seeded LCG)

---

## 10. Manifest / Licensing

### Required manifest fields (extending SAMPLE_MANIFEST.json gold standard)

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

### License tiers

| Tier | Meaning | Playback allowed? |
|---|---|---|
| `commercial-safe` | explicit license permitting commercial use | ✅ |
| `license-required` | license exists but restricts use | ⚠️ conditional |
| `unknown` | no provenance | ❌ quarantine (test only, never commercial) |

### Provenance enforcement

- On MANIFEST stage: if `usageRestrictions === 'unknown'`, sample is quarantined
- Quarantined samples are available in test mode only, never in production renders
- The Sampler reports `PROVENANCE_VIOLATION` if asked to play a quarantined sample in production mode

### Current state (from audit)

- `SAMPLE_MANIFEST.json` (6 PSY3 samples): gold standard, all fields present ✅
- `public/samples/real/manifest.json` (108 samples): **provenance-bare** ❌ — must be extended before commercial use

---

## 11. DeviceHost Integration

### Registration flow

```typescript
const channel = new InMemoryChannel('psy-sampler');
const host = new DeviceHost(channel);
const sampler = new SamplerDevice({ id: 'sampler-1', sampleBankPath: '...' });
host.register(sampler);

// Transport pushes
host.pushTransport(transportSnapshot, performance.now());
host.pushContext(musicalContext);

// Events flow via channel
channel.publish(noteEvent);
```

### What the Sampler receives

- `onTransport(transport)`: timing authority — Sampler reads `beatTime`, `origin.audioTime`, `bpm`, `bar`, `phase`
- `onContext(context)`: musical situation — Sampler reads `rootPc`, `style`, `section` for deterministic selection
- `onEvent(event)`: if `NoteEvent` → schedule playback; if `SectionEvent` → reset round-robin per policy; other events ignored
- `onStart()`: initialize voice pool, load samples
- `onStop()`: release voices, optionally retain decoded buffers for quick resume

### What the Sampler does NOT receive

- Composition decisions (why a note exists)
- Material identity (which motif) — unless carried by NoteEvent (see §23)
- Mix/master instructions

---

## 12. MusicalEvent Integration

### NoteEvent (primary)

```typescript
{ type: 'note', note: 36, velocity: 0.9, duration: 0.25, channel: 'kick', at: 12.345 }
```

- `note`: MIDI note number (pitch)
- `velocity`: 0-1 (gain scaling)
- `duration`: in beats (Sampler converts to seconds via BPM)
- `channel`: string — used as sample category/role selector
- `at`: audio time (seconds) — when to start playback

### SectionEvent

```typescript
{ type: 'section', section: 'drop', bar: 48, at: 56.789 }
```

- Sampler may reset round-robin counters on section change (configurable policy)

### Other events

- `BeatEvent`: ignored (Sampler uses transport for timing)
- `EnergyEvent`: ignored (composition concern)
- `DropEvent`: ignored (composition concern)
- `PatternEvent`: may trigger pattern-based sample loading (future)

### The NoteEvent contract gap (see §23)

`NoteEvent` carries `channel` (string) but not:
- `materialId` (which specific sample variant)
- `motifId` (which motif this note belongs to)
- `lifecycleState` (entering/sustaining/exiting)
- `variationState` (how this note has been transformed)

**This is a REQUIRED CONTRACT GAP** — see §23 for analysis.

---

## 13. UI Boundary

### The device is headless

The Sampler device works:
- Without React
- Without DOM
- Without UI
- In a test harness
- In offline render

### UI responsibilities (separate, downstream)

- Sample browser (preview, mapping)
- Bank selection
- Round-robin visualization
- Waveform display
- MIDI learn
- Settings (voice count, lookahead, etc.)
- Diagnostics (active voices, memory, latency)

### UI is NOT the source of truth

The UI reads device state (via diagnostics API) but does not control device behavior directly. UI actions (e.g., "change bank") go through the device's public API, not by mutating internal state.

### Test harness

The Sampler must be testable in a headless Node.js environment (using `web-audio-api` for OfflineAudioContext). Tests:
- Contract tests (implements PsyDevice)
- Timing tests (event scheduling)
- Determinism tests (same seed → same sample)
- Voice tests (pool, stealing)
- Integration tests (DeviceHost, transport, context)

---

## 14. MIDI Boundary

### Current state

Foundation has NO MIDI path. `packages/analysis` has `midiToName`/`nameToMidi` utilities but no MIDI input handling.

### Where MIDI translation belongs

**NOT in the Sampler device.** The flow should be:

```
MIDI input
  ↓
MIDI bridge (Foundation or dedicated module — future work)
  ↓
MusicalEvent (NoteEvent)
  ↓
DeviceHost
  ↓
SamplerDevice
```

The Sampler consumes `NoteEvent` (already the contract). MIDI → NoteEvent translation is upstream.

### Why MIDI is not in the device

- MIDI is a specific input protocol; the device should be input-agnostic
- Multiple input sources (MIDI, radio, composition engine, sequence file) should all produce the same `MusicalEvent`s
- Putting MIDI in the device would couple it to a specific input protocol

### Documented gap

**MIDI bridge is a documented gap.** The Sampler does not implement it. A separate MIDI → MusicalEvent bridge is needed for MIDI input support. This is out of scope for the Sampler device.

---

## 15. Offline Rendering Boundary

### Goal

Same musical input + same seed + same sample bank + same sampler config → realtime render ≈ offline render.

### Current state

- `offlineRenderer.ts` is a stub (returns zero-filled arrays) — DO NOT PORT
- `writeWavFile` helper is reusable
- `web-audio-api` npm package provides `OfflineAudioContext` for Node.js (proven in V1 validation)

### Architecture

The Sampler device must work identically in:
1. **Real-time:** browser AudioContext, live playback
2. **Offline:** OfflineAudioContext (browser or Node.js via `web-audio-api`), render to buffer

### How to achieve realtime ≈ offline

- The device's `onEvent` schedules playback against `event.at` (audio time)
- In realtime, `event.at` is in the future (lookahead)
- In offline, `event.at` is in the render timeline
- The scheduling logic is identical — only the clock source differs
- **Critical:** no `Date.now()` / `performance.now()` in scheduling — use only `event.at` and transport's audio time

### Documented limitation

If the Sampler uses an AudioWorklet, worklet behavior may differ slightly between realtime and offline (worklet `process()` is called differently). This must be tested. If divergence is found, document it explicitly.

---

## 16. Memory / Performance Budget

### Memory

- Decoded sample cache: configurable max (default 256MB)
- Voice pool: ~32 voices × ~1KB state = ~32KB (negligible)
- Manifest metadata: ~100 samples × ~500 bytes = ~50KB (negligible)

### CPU (real-time)

- Voice processing: O(voices) per block
- At 44100Hz, 128-sample blocks = ~344 blocks/sec
- 32 voices × 344 blocks = ~11K voice-processings/sec
- Each voice: buffer read + gain + envelope = ~10 operations/sample
- Total: ~110K operations/sec — well within budget

### Latency

- Lookahead: 100ms (configurable)
- Worklet block: 128 samples = ~2.9ms
- Total device latency: ~3-5ms (worklet) + scheduling jitter
- `reportLatencyMs()` returns the measured value

---

## 17. Dependency Graph

### The Sampler depends on

| Dependency | Source | Purpose |
|---|---|---|
| `@psy-foundation/device-sdk` | Foundation | `PsyDevice`, `DeviceHost` contracts |
| `@psy-foundation/protocol` | Foundation | `MusicalEvent`, `MusicalContext`, `DeviceCapabilities`, `Channel` |
| `@psy-foundation/transport` | Foundation | `MusicalTransport` type |
| `@psy-foundation/scheduler` | Foundation (optional) | Seeded RNG (`rng.ts`) for deterministic selection |
| `web-audio-api` (Node) / browser AudioContext | npm | `OfflineAudioContext` for tests + offline render |
| `SAMPLE_MANIFEST.json` | PSY4 | Sample provenance + metadata |

### The Sampler does NOT depend on

- ❌ React, DOM, any UI framework
- ❌ PSY4's composition engine (MusicalSession, etc.)
- ❌ PSY4's synth voices (AdvancedSynthVoice, etc. — those are a synth device, not sampler)
- ❌ psy4-engine.js (the monolithic worklet — too many defects)
- ❌ Any specific MIDI library

### No dependency cycles

- Foundation → (nothing) — frozen, no deps on PSY4
- PSY4 → Foundation (one-way)
- Sampler → Foundation + PSY4 sample infra (one-way)
- No cycle.

---

## 18. Test Strategy

### Test matrix

| Category | Tests |
|---|---|
| **Contract** | implements PsyDevice; capabilities correct; lifecycle (onStart/onStop); register/unregister with DeviceHost |
| **Timing** | exact event scheduling; late event behavior; early event queuing; seek (flush + reset); start/stop; pause/resume |
| **Determinism** | same seed → same sample; same event sequence → same voice decisions; seek → same selection |
| **Voice** | pool exhaustion; stealing (priority); kick/bass protection; release behavior; cleanup |
| **Samples** | load; decode; invalid sample; missing manifest; license metadata; dispose |
| **Integration** | DeviceHost registration; MusicalContext handling; MusicalTransport sync; MusicalEvent routing |
| **Performance** | allocations in audio path (zero); CPU budget; voice count; memory limits |
| **Offline** | realtime/offline consistency; same seed → same render |

### Test environment

- Node.js + `web-audio-api` for OfflineAudioContext
- Headless — no browser, no DOM
- Deterministic seeds
- Tests run in CI

---

## 19. Failure Modes

| Failure | Behavior |
|---|---|
| Sample file missing | Log `SAMPLE_MISSING`; skip event; continue |
| Decode failure | Log `DECODE_FAILED`; skip event; continue |
| No free voices (pool exhausted, none stealable) | Log `VOICE_STARVATION`; drop event; continue |
| Worklet not available | Fall back to main-thread AudioBufferSourceNode (with RT warning) |
| Manifest missing | Device starts with empty bank; logs `BANK_EMPTY` |
| License unknown | Quarantine sample; log `PROVENANCE_VIOLATION` if played in production |
| Transport not received | Device idle; no playback until transport arrives |
| Event in the past | Drop if > 50ms late; play immediately if within threshold |

---

## 20. Security / Licensing Risks

| Risk | Mitigation |
|---|---|
| Unlicensed samples in commercial output | Provenance enforcement (§10); quarantine unknown samples |
| Sample path traversal | Manifest paths validated; no user-supplied paths in production |
| Worklet code injection | Worklet code is static (no eval); messages are typed |
| Memory exhaustion | Cache limit + LRU eviction |
| Denial of service (event flood) | Lookahead window limits queued events; drop excess |

---

## 21. Open Contract Gaps

### Gap 1: NoteEvent lacks sample-selection context

**What's missing:** `NoteEvent` carries `channel` (string) but not:
- `materialId` — which specific sample variant to use (if composition engine chose one)
- `motifId` — which motif this note belongs to (for identity-aware playback)
- `lifecycleState` — entering/sustaining/exiting (for envelope behavior)
- `variationState` — how this note has been transformed

**Who should own this?** Foundation (`@psy-foundation/protocol`). It's musical information (WHAT), not synthesis (HOW).

**Why can't the device solve it?** The device doesn't know which motif this note belongs to — that's composition context. The device can only infer from `channel` + `note` + `velocity`.

**Minimal contract extension:** Add optional fields to `NoteEvent`:
```typescript
interface NoteEvent {
  type: 'note'
  note: number
  velocity: number
  duration: number
  channel: string
  at: EventTime
  // Optional extension (backward-compatible):
  materialId?: string    // specific sample variant
  motifId?: string       // which motif this belongs to
  variationSeed?: number // for deterministic variation
}
```

**Status:** REQUIRED CONTRACT GAP. Foundation is frozen — this requires Foundation team approval. Until resolved, the Sampler uses `channel` + `note` + deterministic position-based selection.

### Gap 2: No MIDI bridge

**What's missing:** MIDI input → MusicalEvent translation.

**Who should own this?** A dedicated MIDI bridge module (not Foundation, not the device).

**Status:** Documented gap. Out of scope for the Sampler device.

### Gap 3: No offline render pipeline

**What's missing:** A proper offline render pipeline (current `offlineRenderer.ts` is a stub).

**Who should own this?** PSY4 (or a shared render utility).

**Status:** Documented gap. The Sampler supports offline (works with OfflineAudioContext) but the pipeline must be built separately.

---

## 22. Minimal Implementation Plan

### Phase 0 — Contract verification (no code)

- ✅ Verified `PsyDevice`, `DeviceHost`, `MusicalTransport`, `MusicalContext`, `MusicalEvent` from source
- ✅ Verified Foundation is frozen (250 tests pass)
- ✅ Verified PSY4 sample infrastructure (reuse/adapt/rewrite matrix)

### Phase 1 — Minimal headless sampler

- `SamplerDevice` implementing `PsyDevice`
- Single voice (no pool yet)
- `NoteEvent` → `AudioBufferSourceNode` playback
- Deterministic sample selection (seeded by channel + note + position)
- Transport sync (schedule against `event.at`)
- Headless test harness (Node.js + `web-audio-api`)

### Phase 2 — VoicePool

- Preallocated voice pool
- Priority-based stealing
- Kick/bass protection
- Round-robin (deterministic)
- Performance tests (zero allocation in audio path)

### Phase 3 — SampleBank

- Manifest parsing (with provenance enforcement)
- Async load + decode
- LRU cache
- Memory limits
- Disposal

### Phase 4 — Integration

- DeviceHost registration
- Transport/context/event routing
- SectionEvent round-robin reset
- Integration tests with Foundation contracts

### Phase 5 — UI (only after headless works)

- Sample browser
- Bank selection
- Diagnostics
- Settings

### Phase 6 — Offline/export

- OfflineAudioContext integration
- Realtime/offline consistency tests
- WAV export

---

## 23. Anti-Pattern Audit

| Anti-pattern | Risk | Mitigation |
|---|---|---|
| Sampler makes composition decisions | High | Device boundary enforced (§5); Sampler only plays what it receives |
| Sampler depends on React | Medium | Headless design (§13); UI is separate |
| Sampler depends on psy4 composition engine | High | No imports from `MusicalSession`, etc. (§17) |
| Sampler creates new contract instead of using Foundation | High | Implements `PsyDevice` exactly (§3) |
| Sampler duplicates VoicePool | Medium | Reuse/adapt PSY4's voice pool (after fixing defects) |
| Sampler duplicates timing | High | Uses transport's audio clock only (§6) |
| Sampler uses non-deterministic random | High | Seeded LCG only (§7) |
| Sampler introduces synthesis logic | Medium | Sampler is sample-playback only; synthesis is a separate device |
| Sampler introduces mixing/mastering | Medium | No EQ/compression/LUFS in the device |
| Sampler has sample-selection logic that should be WHAT/WHEN | Medium | Selection is deterministic HOW (which variant), not WHAT (which material) |
| UI connected directly to AudioWorklet | Medium | UI goes through device public API (§13) |
| Dependency cycle between repositories | High | One-way deps: Sampler → Foundation + PSY4 infra (§17) |

**All anti-patterns have mitigation. None are unresolved.**

---

## 24. GO / NO-GO

### GO conditions checklist

| # | Condition | Status |
|---|---|---|
| 1 | Canonical contract verified from source | ✅ (§3) |
| 2 | Ownership boundaries explicit | ✅ (§5) |
| 3 | No duplicate infrastructure unnecessarily | ✅ (§4 — reuse matrix) |
| 4 | Deterministic behavior defined | ✅ (§7) |
| 5 | Timing authority defined | ✅ (§6) |
| 6 | Realtime safety demonstrated | ⚠️ (PSY4 worklet has violations — must fix or use clean worklet) |
| 7 | Sample provenance handled | ⚠️ (108 samples lack license — must extend manifest) |
| 8 | Headless device boundary preserved | ✅ (§13) |
| 9 | DeviceHost integration understood | ✅ (§11) |
| 10 | Existing family architecture respected | ✅ (§2, §17) |
| 11 | No composition logic leaks into device | ✅ (§5) |
| 12 | Minimal implementation path clear | ✅ (§22) |

### Verdict: **CONDITIONAL GO**

Conditions 6 and 7 are not yet met:
- **Condition 6:** PSY4's `psy4-engine.js` has real-time violations (per-hit array allocation, `Math.random()` in audio thread). The Sampler must either (a) use a clean worklet (extract DSP classes from `psy4-dsp.js` which is gold-standard), or (b) fix `psy4-engine.js` before porting.
- **Condition 7:** 108 real samples lack license metadata. The manifest must be extended before commercial use. (Test-mode use is acceptable with quarantine.)

### What GO does NOT mean

- ❌ Does NOT mean implementation can start immediately
- ❌ Does NOT mean Foundation changes (NoteEvent extension is a separate proposal)
- ❌ Does NOT mean MIDI bridge is built
- ❌ Does NOT mean offline pipeline is built
- ❌ Does NOT approve any architecture

### Next step

Before implementation:
1. Decide worklet strategy: extract clean worklet from `psy4-dsp.js` OR fix `psy4-engine.js`
2. Extend `public/samples/real/manifest.json` with provenance fields (or quarantine unverified samples)
3. Propose NoteEvent extension to Foundation team (optional fields — backward compatible)
4. Then: Phase 1 implementation (minimal headless sampler)

---

## 25. Final Principle

The goal is NOT to "build a sampler that works."

The goal is to build a Sampler that is a **true device citizen** of the PSY family — respecting the Foundation contract, the WHAT/WHEN/HOW boundaries, the composition architecture being built in PSY4, and the runtime constraints of Web Audio — without creating an architecture fork.

The family has invested heavily in defining musical semantics. The Sampler must not bypass them.

When the composition engine says: **"this material should sound now"** — the Sampler must know HOW to execute that deterministically, precisely, efficiently, and testably.

**That is the goal.**

---

## HARD STOP

- ❌ No code written
- ❌ No Foundation changes
- ❌ No PSY4 changes
- ❌ No new repository
- ❌ No SampleVoice copied
- ❌ No UI built
- ❌ No schema added
- ❌ No audio rendered

**Awaiting user review of this design document. Only after explicit approval does implementation begin (Phase 1: minimal headless sampler).**
