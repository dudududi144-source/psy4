# PSY4 — Architecture (Verified State)

**Date:** 2024-08-13 (original ADRs) → rewritten 2025 (Phase 0 honest rewrite)
**Status:** Active — this document describes the system **as it actually is**.
Previous ADR-001..010 described an aspirational system that was never built. They are preserved in `docs/ADR_HISTORY.md` (to be created) marked `Status: FABRICATED`.

---

## What is actually here

```
┌─────────────────────────────────────────────────────────────────────┐
│ Browser (main thread)                                              │
│                                                                     │
│  React UI (src/app/page.tsx)                                        │
│   - Single route: /                                                 │
│   - Polls engine.getState() at 4 Hz (250ms setInterval)             │
│   - No React.memo, no error boundary (to be fixed in Phase 6)       │
│                                                                     │
│  PsyLive4 (src/lib/psyLive4/psyLive4.ts — 1629 lines)                │
│   - CompositionScheduler: setInterval(25ms) on MAIN THREAD          │
│     (NOT a Web Worker. composition-worker.js does not exist.)        │
│   - Looks ahead ~120ms (LOOKAHEAD_S = 0.120 in scheduler.ts)        │
│   - 6+ concurrent timers: scheduler(25ms), learning(4s),             │
│     mastering(1s), radio-bpm(50ms), radio-quality(~1.6s),           │
│     radio-stall(5s) — despite ADR-006's "4→2" claim                  │
│   - RadioListener: real onset-based BPM detection, CORS proxy,      │
│     failover. The most honest subsystem.                            │
│   - CCLearner: hill-climbing on 6 CC params; reward = 23ms          │
│     AnalyserNode snapshot mislabeled "LUFS" (to be fixed Phase 7)   │
│   - DeviceHost: fans events to ALL registered devices               │
│     (BUG: lead/acid hit both psysynth AND lead-worklet →           │
│      double-play, ~6dB boost + phase artifacts. Phase 2 fixes.)      │
│                                                                     │
│  Composer (src/lib/psyLive4/composer.ts — 273 lines)                 │
│   - Deterministic PRNG: mulberry32(seed ^ startTime)                │
│     (NOT reproducible — seed XORs startTime, changes 40×/sec.      │
│      ADR-003 "same seed→same output" is false. Phase 3 fixes.)      │
│   - 64-bar arrangement cycle: INTRO→GROOVE→DROP→BREAKDOWN→...        │
│     This is the strongest musical part — real section contrast.     │
│   - Lead: fixed motifIntervals array (NOT AABA, NOT mutating).      │
│     MUSICAL_GRAMMAR.md describes EvolvingSequence/LeadMotif that    │
│     do NOT exist in code. Phase 5 implements them for real.          │
│   - Kick: 4-on-floor, velocity 0.95/0.85 (house accent, wrong       │
│     for psytrance — should be uniform. Phase 5 fixes.)              │
│   - Bass: ~6-7 of 16 possible 16th positions/bar (sparse, not       │
│     "rolling 16ths". Phase 5 fixes.)                               │
│                                                                     │
│  Devices (src/lib/devices/*)                                        │
│   - drum-device.ts    → routes to drum worklet                      │
│   - lead-device.ts    → routes lead+acid to lead worklet             │
│   - melodic-device.ts → routes bass/pad/keys/lead/acid to psysynth  │
│     (THIS IS THE DOUBLE-PLAY BUG — lead+acid go to BOTH)            │
│   - sampler-device.ts → CC74 no-op (documented in code)              │
│                                                                     │
│  Events sent via port.postMessage({type:'scheduleEvent', ...})      │
│   - Plain JS objects, NOT Transferable Float64Array                 │
│   - ~25 postMessages/sec to worklets                                │
│   (ADR-002 "Transferable Float64Array, zero-copy" is false.)        │
└─────────────────────────────────────────────────────────────────────┘
                          │
                          ▼ (port.postMessage, plain objects)
┌─────────────────────────────────────────────────────────────────────┐
│ AudioWorklet thread (audio thread, hard RT)                        │
│                                                                     │
│  public/worklets/psy4-engine-v3.js (878 lines)                      │
│   - 7 voice classes: KickVoice, HatVoice, SnareVoice, ClapVoice,   │
│     PercVoice, ShakerVoice, FXVoice                                 │
│   - MELODIC_VOICES (bass/lead/acid/pad) explicitly NOT played here  │
│     → routed to psysynth (Web Audio native) + lead worklet          │
│   - Real DSP: MoogLadder (4-pole), OnePoleLP/HP, PinkNoise          │
│   - MasterChain (in this worklet): DC-block → multiband → glue →   │
│     limiter. MISSING: saturation, LUFS, true-peak                   │
│     (ADR overview claims all 5. Phase 4 builds a separate           │
│      MasterWorklet with all 5 stages.)                              │
│   - KNOWN ALLOCATIONS in hot path (Phase 3 fixes):                  │
│     • StereoWidener.process() returns [a,b] per sample              │
│       (~44k allocs/sec) — line 447                                  │
│     • MultibandComp.process() defines `const compress=()=>{}`       │
│       per sample (~88k closures/sec) — line 516                     │
│     • allPools = [...] per process() quantum — line 824             │
│   - 4× Math.random() in hot path (lines 87,140,308,689)             │
│     (ADR-003 "zero Math.random() in worker" is false.)              │
│                                                                     │
│  public/worklets/psy4-lead-worklet.js (292 lines)                    │
│   - LeadVoice: 3-osc supersaw with PolyBLEP (real)                  │
│   - NO FM modulation (ADR-010 claims fmPhase/fmRate/fmDepth/        │
│     fmRatio — none exist. Phase 5.4 adds them for real.)            │
│   - Slow filter LFO (0.3 Hz, depth 0.12) — not the psychedelic      │
│     character psytrance leads need                                  │
│                                                                     │
│  public/psysynth.js (minified)                                       │
│   - One voice class handling 7 roles: bass/lead/arp/pad/stab/       │
│     pluck/keys via Web Audio OscillatorNodes/BiquadFilters          │
│     (NOT custom DSP)                                                │
│                                                                     │
│  public/psy-sampler.js — sample playback helper                      │
└─────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Destination (speakers)                                              │
│                                                                     │
│  NOTE: WAV export is DRUMS-ONLY via deprecated ScriptProcessorNode  │
│  (psyLive4.ts:1457-1466 admits melodic voices can't render offline).│
│  Full-mix WAV export is broken. Phase 4 (MasterWorklet) will fix.   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## What is NOT here (despite previous ADR claims)

| ADR | Claimed | Reality | Fix phase |
|-----|---------|---------|-----------|
| ADR-001 | Web Worker (`composition-worker.js`), 3 bars ahead, Transferable, ZERO postMessage | No worker file. Main-thread setInterval(25ms). ~120ms lookahead. Plain-object postMessage ~25/sec | Not fixing (worker unnecessary if Phase 3 allocations fixed) |
| ADR-002 | Transferable Float64Array, zero-copy | Plain JS objects in postMessage | Acceptable — not worth fixing |
| ADR-003 | Deterministic (mulberry32, same seed→same output), zero Math.random() in worker | seed XORs startTime → not reproducible. 4× Math.random() in worklet | Phase 3 |
| ADR-006 | Timer consolidation 4→2 | 6+ concurrent timers | Phase 6 (part of UI rework) |
| ADR-008 | Zero-alloc AudioWorklet, preallocated _out | Voice leaves OK; StereoWidener/MultibandComp allocate per-sample | Phase 3 |
| ADR-009 | SharedArrayBuffer + Atomics, lock-free, `initSharedBuffer()`/`flushEvents()` | 0 SAB, 0 Atomics, functions don't exist. COOP/COEP headers set for a feature that doesn't exist (and break cross-origin radio) | Phase 0: remove COOP/COEP headers |
| ADR-010 | Lead FM modulation (fmPhase/fmRate/fmDepth/fmRatio) | 0 of these fields exist. Lead is supersaw, no FM | Phase 5.4 |

**`MUSICAL_GRAMMAR.md` describes `EvolvingSequence`, `LeadMotif.nextNote`, `AcidPatternEngine`, and pattern tables that do not exist in code.** Renamed to `MUSICAL_GRAMMAR_ASPIRATIONAL.md` in Phase 0. Phase 5 implements them for real, then rewrites the doc.

---

## What is actually good (salvageable)

1. **RadioListener** (`radio-listener.ts`): real streams, onset-based BPM detection, CORS proxy with allowlist, failover. The most honest subsystem.
2. **DSP primitives**: MoogLadder, PolyBLEP saw, PinkNoise, `computeKWeightedLUFS` (ITU-R BS.1770-4, appears correct — needs A/B verification in Phase 1).
3. **Arrangement engine** (`composer.ts:25-49 getSection()`): 64-bar cycle with real section contrast. The strongest musical part.
4. **Visual polish** (`psyforge.css`): coherent aesthetic, 3D knobs, gradients.
5. **The kick spectral fix precedent** (`COMMERCIAL_REFERENCE_FORENSIC_V2.md`): proved the measure→fix→measure loop works (sub energy 4.9%→60.1%).

---

## Infrastructure (Phase 8 target)

- **Deploy:** Cloudflare Pages (`wrangler.toml` present, `@cloudflare/next-on-pages` in devDeps). `next.config.ts` `output: "standalone"` removed in Phase 0 (conflicts).
- **DB:** Prisma (dependency + scripts present, NO schema). Phase 8 adds `prisma/schema.prisma` (User, Preset, LearningState).
- **Cloud sync:** Turso (SQLite cloud) — `turso.ts`/`turso-sync.ts` wired, needs schema + token.
- **Auth:** Supabase — not wired. Phase 8 adds `@supabase/ssr`.
- **CI:** GitHub Actions — not present. Phase 8 adds `.github/workflows/ci.yml`.

---

## Engineering score (honest, by the project's own rubric)

| Criterion | Weight | Score | Notes |
|-----------|--------|-------|-------|
| Separation of Concerns | 15 | 6 | Composition on main thread; 6+ timers; double-play bug |
| Real-Time Safety | 20 | 8 | per-sample allocs in StereoWidener (44k/s) + MultibandComp (88k/s) |
| Determinism | 10 | 3 | seed XOR startTime; 4× Math.random() in worklet |
| Memory Management | 15 | 6 | ADR-002/008/009 fabricated |
| Testing & Verification | 15 | 5 | tests exist but not wired to runner; no CI; "PHYSICAL LISTENING UNVERIFIED" |
| Sound Quality | 15 | 5 | kick fixed; lead = test-tone; bass = sparse; acid = missing |
| Musical Correctness | 10 | 4 | arrangement real; kick velocity/bass/acid/FM all wrong |
| Documentation | 15 | 4 (→ 10 after this rewrite) | ADRs were fabricated; this doc is honest now |
| **Total** | **100** | **41** | Was claimed 95. Reality 41. |

**The gap from 41 to commercial-grade is the work of Phases 1–8.**
