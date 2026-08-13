# F13 — REALITY vs VISION

**HEAD:** `017ef70` (F11) · **Method:** Every claim traced to code + runtime behavior + audio evidence.

**STATUS legend:**
- **PROVEN** — implementation exists, runtime executes, audio effect verifiable
- **PARTIAL** — implementation exists, runtime partially executes, audio effect incomplete
- **FALSE** — implementation claims to exist but runtime does NOT execute as claimed
- **DEAD** — code exists but is never reached at runtime
- **MISSING** — no implementation exists

---

## MASTER TABLE

| # | VISION CLAIM | IMPLEMENTATION | RUNTIME | EVIDENCE | STATUS |
|---|---|---|---|---|---|
| 1 | "Real-time radio follower" | BeatPLL + BeatObservationEngine + RadioObservationLayer | `radioLayer.markConnected()` NEVER called → signalState stuck at DISCONNECTED → beat detection block (RadioObservationLayer.ts:141) never entered → `transport.observeBeat()` never called → PLL never locks | psyLive.ts:755-757 calls `radioGate` not `radioLayer`; RadioObservationLayer.ts:266-269 early-returns on DISCONNECTED | **FALSE** |
| 2 | "PLL follows radio tempo" | BeatPLL class (213 lines, 48 tests) | PLL is inside BeatObservationEngine inside RadioObservationLayer. Never fed observations. `psyLive.pll` (field at line 238) is a SEPARATE dead instance. | transport.snapshot().locked is always false; engineBpm stays at preset 145 forever | **FALSE** |
| 3 | "Melody follower (YIN)" | MelodyObserver class (394 lines, 13 tests) | `melodyObserver.observe()` NEVER called from psyLive. Only `ensureTimeDomainBuf()` used. The LIVE melody observer inside RadioObservationLayer never runs (pitch block at RadioObservationLayer.ts:183 never entered). | psyLive.ts:806 only calls ensureTimeDomainBuf; RadioPitchObservation never produced | **FALSE** |
| 4 | "Key detection from radio bass" | MusicalContext.updateFromRadio bassFreq branch (line 130) | `psyLive.bassFreq` is declared (line 200) but NEVER ASSIGNED. Always 0. `observeRadio` passes `undefined`. Key branch never fires. Key stuck at A phrygian-dominant. | grep `bassFreq =` in psyLive.ts: only declaration, no assignment | **FALSE** |
| 5 | "Learning engine / reinforcement" | MusicalMemory.recordPhrase + evaluatePhrase + pickMotif | `evaluatePhrase` computes reward, `recordPhrase` EMA-stores it. But `pickMotif` (the reward-weighted selector) is NEVER CALLED. Motif selection uses `motifGroups[groupIdx][0]` or `transformMotif`, ignoring reward. | grep `pickMotif` in src/: 0 calls | **FALSE** |
| 6 | "Song structure INTRO→BUILD→PEAK→BREAK→OUTRO" | COMPOSITION_ARC (MusicalContext.ts:58-67): INTRO→STATEMENT→DEVELOPMENT→RESPONSE→CONTRAST→DEVELOPMENT2→CLIMAX→RESOLUTION | 64-bar arc cycles infinitely (modulo 64). No one-shot build. Section names flow into lead density calculation. | MusicalContext.ts:183 `Math.floor((bar % 64) / 8)` | **PARTIAL** (real arc, but cycles, doesn't build once) |
| 7 | "Style changes music" | 4 styles: FULL_ON/DARK/PROGRESSIVE/ACID. `setStyle()` writes to `session.style`. | `session.style` is NEVER READ by generateKick/Bass/Hats/Lead. Only appears in NotePlan metadata + snapshot. detectStyle() overwrites user's choice every 200ms when radio on. 4 styles produce identical music. | grep `this.style` in MusicalSession.ts: only write + snapshot, no read in generators | **FALSE** |
| 8 | "User can change energy" | `setEnergy(v)` → `(session.getContext() as any).energy = v` | `MusicalSession` has NO `getContext()` method. TypeError thrown. `ctx.energy` is overwritten by `updateFromRadio` every 200ms anyway. `ctx.energy` is NEVER READ by note generators. | tsc error TS2339 at psyLive.ts:604; grep `getContext` in MusicalSession.ts: 0 | **FALSE** |
| 9 | "User can change density" | `setDensity(v)` → same broken pattern | Same TypeError. `ctx.density` only read by `evaluatePhrase` (bookkeeping), never by generators. Overwritten by `updateFromRadio`. | tsc error at psyLive.ts:608 | **FALSE** |
| 10 | "User can change tension" | `setTension(v)` → same broken pattern | Same TypeError. `ctx.tension` IS read by `calculateLeadDensity` and `generateLead` (velocity). BUT `updateFromTransport` smooths tension toward `targetTension` (from COMPOSITION_ARC) every bar, reverting user's value within ~20 bars. | tsc error at psyLive.ts:612; MusicalContext.ts:159 | **FALSE** (TypeError) / would be PARTIAL if fixed |
| 11 | "Mixer controls per-channel volume" | `setChannelVolume(ch, v)` → bus.gain.setTargetAtTime | Works when radio OFF. When radio ON, `detect()` (psyLive.ts:867-877) overwrites all 4 bus gains every 200ms. User mixer values ignored. | psyLive.ts:870-876 clobbers kickBus/bassBus/leadBus/hatBus | **PARTIAL** (works only when radio off) |
| 12 | "FX are controllable" | setDelayAmount / setDelayFeedback / setReverbSend | All 3 write to AudioParam nodes via setTargetAtTime. Not clobbered. Real audio effect. | psyLive.ts:582-592 | **PROVEN** |
| 13 | "Radio complements music" | Role ducking + style detection + occupancy | Occupancy-based ducking WORKS (spectral). Style detection WORKS (overwrites user). But tempo/beat/pitch following is DEAD. Engine plays at 145 BPM while radio plays at different tempo → unsynchronized ducking creates awkward gaps. | detect() lines 867-877; radio follower dead (claim #1) | **PARTIAL** (spectral only, no temporal sync) |
| 14 | "142 professional presets" | SoundBank class (698 lines, 142 presets) | SoundBank is NOT imported by psyLive. 4 hardcoded PRESETS used instead. SoundBank is FUTURE MATERIAL LIBRARY. | grep `soundBank` in psyLive.ts: 0 (import removed in R4) | **DEAD** (data exists, disconnected) |
| 15 | "PooledEngine no GC dropouts" | PooledEngine class (508 lines, 6 tests) | PooledEngine is NOT imported by psyLive. Engine uses inline createOscillator per note. | grep `pooledEngine` in psyLive.ts: 0 | **DEAD** |
| 16 | "Worklet-based scheduler" | schedulerWorker.ts (251 lines), workletEngine.ts (758 lines), engineWorklet.ts (251 lines) | All 3 are DEAD CODE. Never imported by psyLive. Scheduler uses setInterval(25ms). | grep in psyLive.ts: 0 | **DEAD** |
| 17 | "Self-recovery / health monitor" | Claimed in worklog | NO code exists at HEAD. No health check, no recovery logic. | grep `health\|recover\|selfHeal` in src/: 0 | **MISSING** |
| 18 | "Continuous learning" | learning.ts (482 lines) | `recordKick`/`recordBassNote`/`deriveInsights` run. But only when `transportSnap.locked` (psyLive.ts:922) — which is NEVER true (PLL dead). So learning NEVER records at runtime. | psyLive.ts:922 guard; locked always false | **FALSE** |
| 19 | "ABSTAIN — intentional rest" | Mentioned in MusicalSession.ts comments (lines 5, 238) | NO `ABSTAIN` identifier, string, or action exists. Lead rest happens via `leadDensity === 0` (numeric gate). Comments are misleading remnants. | grep `ABSTAIN` in foundation/: only comments | **FALSE** (comment-only) |
| 20 | "Phrase structure A→A'→B→A-return" | PHRASE_STRUCTURE = [0,0,1,0,0,1,2,0] (MusicalContext.ts:56) | Actual pattern is A-A-B-A-A-B-C-A (7th phrase is group 2 = C). Not A-A'-B-A-return. | MusicalContext.ts:56 | **PARTIAL** (real but different from spec) |
| 21 | "Lead is optional, default REST" | calculateLeadDensity comment (MusicalSession.ts:235) | Returns 0.237 for INTRO bar 0. Lead plays from bar 0. No "groove stability" check. | MusicalSession.ts:240-264 | **FALSE** (lead enters immediately) |
| 22 | "Lead register controlled (octave 3-4)" | generateLead clamps to MIDI 48-72 (MusicalSession.ts:281) | Clamp allows up to C5 (MIDI 72 = 523 Hz). Motif generated at octave 4, shifted -12, clamped. Most notes land 48-60 (C3-C4). C5 possible via transpose. | MusicalSession.ts:281; motif.ts:59 | **PARTIAL** (mostly controlled, C5 leaks) |
| 23 | "Kick always present" | generateKick (MusicalSession.ts:158) always emits 4 kicks | Planner always emits. BUT scheduleStep (psyLive.ts:690) skips kick if `occupancy.kick > 0.7`. So radio can silence engine kick. | psyLive.ts:690 | **PARTIAL** (planned but not always played) |
| 24 | "Bass interlocked with kick" | generateBass (MusicalSession.ts:177) hits steps 0,4,8,12 (with kick) + 2,6,10,14 (offbeat) | Real interlock in plan. scheduleStep skips bass if `occupancy.bass > 0.75`. | MusicalSession.ts:183-193; psyLive.ts:696 | **PROVEN** (when played) |
| 25 | "Radio switching works cleanly" | connectRadio creates new Audio + MediaElementSource per call | Old element paused + src cleared. Old source disconnected. No zombie stream. New MediaElementSource per call (safe). BUT radioLayer not reset on switch (only on disconnect). | psyLive.ts:735-740 | **PARTIAL** (audio clean, observation stale) |
| 26 | "5 radio states (idle/connecting/no_signal/listening/following)" | SyncStatus type (psyLive.ts:129) | 'listening' and 'following' are UNREACHABLE at HEAD (observationState stuck at NO_SIGNAL). Only idle/connecting/no_signal ever appear. | psyLive.ts:829-842; observationState stuck | **FALSE** (3 of 5 states unreachable) |
| 27 | "256 tests prove the system works" | 256 tests, all pass | ~215 are STRONG (module-level). ~31 WEAK. ~10 THEATER. musical-instrumentation reads NotePlan metadata not audio. MS-10A passes by falsifying its own claim. | see F13_TEST_GAP_ANALYSIS.md | **PARTIAL** (modules tested, integration is theater) |
| 28 | "UI is a musical instrument" | page.tsx (290 lines) | Hybrid: instrument styling (gradient, ▶/■) + dashboard internals (5-state badge, LOW/MID/HIGH, KICKS counter, window.__psy4TransportDebug). 4 forbidden blue colors. Not mobile-first. 50-file shadcn library unused. | page.tsx audit | **FALSE** (dashboard costume) |
| 29 | "Reverb bus" | reverbSend → convolver → reverbWet → master (psyLive.ts:383-389) | Real ConvolverNode with 1.8s generated IR. Lead has fixed 0.15 send. Slider scales master reverbSend gain. | psyLive.ts:383-389, 526, 590 | **PROVEN** |
| 30 | "Safety limiter prevents clipping" | safetyLimiter = DynamicsCompressor (-1dB, 20:1, 3ms) between master and analyser | Real node, correctly placed. Protects against peaks. | psyLive.ts:361-368 | **PROVEN** |
| 31 | "Compressor glues engine bus" | comp = DynamicsCompressor (-18dB, 2:1, knee 18) on engineBus | Real node. Radio also goes through it (F10 fix). | psyLive.ts:431-444 | **PROVEN** |
| 32 | "Transport is zero-drift" | MusicalTransport anchor-based clock | 30-min drift = 0.00ms (tested). AudioContext.currentTime is only clock. | 27 transport tests | **PROVEN** |

---

## SUMMARY TALLY

| Status | Count | Claims |
|--------|-------|--------|
| **PROVEN** | 7 | FX controls, reverb bus, safety limiter, compressor, transport clock, bass interlock, 256 tests (partial) |
| **PARTIAL** | 8 | Song arc, mixer (radio off), radio complement, phrase structure, lead register, kick presence, station switching, tests |
| **FALSE** | 13 | Radio follower, PLL, melody follower, key detection, learning, style changes music, energy/density/tension controls, continuous learning, ABSTAIN, lead default REST, 5 radio states, UI is instrument |
| **DEAD** | 3 | 142 presets, PooledEngine, worklet scheduler |
| **MISSING** | 1 | Self-recovery |

**13 of 32 claims are FALSE.** The system's headline features — radio following, learning, key detection, musical controls — are runtime lies. The proven features are the infrastructure (clock, scheduler, audio graph, FX) and the foundation tests.

---

## THE CORE CONTRADICTION

The project presents itself as a **radio-following musical instrument that learns**.

At runtime it is a **fixed-tempo groove box with dead radio analysis and theatrical controls**.

The gap is not "missing features." The gap is that the features which exist on paper are **severed from the runtime** by a single missing method call (`radioLayer.markConnected()`), three broken setters (`getContext()` doesn't exist), and one never-called selector (`pickMotif`).

The infrastructure is sound. The wiring is broken.
