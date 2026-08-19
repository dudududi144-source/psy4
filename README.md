# PsyForge 4 (PSY4)

A browser-native psytrance music workstation. Currently in **Phase 0+ engineering rebuild** — see `ARCHITECTURE.md` for the verified state of the system (no aspirational claims).

## Quick start

```bash
bun install
bun run dev          # http://localhost:3000
```

Open the app, press **POWER** (or Space) to start the engine. Press **R** for Smart Radio, **L** for Learning, **1**–**7** for style presets.

## What works (verified Phase 0)

- **7 style presets** (Full-On, Dark, Progressive, Acid, Goa, Hi-Tech, Forest) at genre-correct BPM ranges
- **Real radio listener** — connects to live psytrance streams, onset-based BPM detection, CORS proxy, failover
- **Real DSP primitives** — Moog ladder filter, PolyBLEP oscillators, pink noise, K-weighted LUFS (ITU-R BS.1770-4)
- **64-bar arrangement cycle** — intro → groove → drop → breakdown → rebuild → outro with real section contrast
- **Learning loop** — hill-climbing CC parameter exploration (reward signal is weak — to be fixed in Phase 7)
- **MIDI export** (basic), WAV export (drums-only — to be fixed in Phase 4)

## What is broken / being rebuilt

See `ARCHITECTURE.md` § "What is NOT here". The headline items:

- **Fabricated ADRs** — Worker, SharedArrayBuffer, Transferable Float64Array, zero-alloc, FM modulation: none of these exist in code despite the original ADRs claiming "Implemented". `ARCHITECTURE.md` now documents reality.
- **Double-play bug** — lead/acid notes hit two devices simultaneously (Phase 2 fix)
- **Per-sample allocations** in the worklet hot path (Phase 3 fix)
- **Missing master chain stages** — no saturation, no LUFS in worklet, no true-peak (Phase 4)
- **Musical grammar is fiction** — `MUSICAL_GRAMMAR_ASPIRATIONAL.md` describes classes that don't exist (Phase 5 implements them)
- **No error boundary** — engine init failure = stuck loading screen (Phase 6 fix)

## Engineering phases

| Phase | Goal | Status |
|-------|------|--------|
| 0 | Clean repo, honest architecture, remove license violations | **in progress** |
| 1 | Baseline audio renders + human-ear listening | pending |
| 2 | Fix double-play (one device per role) | pending |
| 3 | Zero-alloc worklet process() | pending |
| 4 | Real MasterWorklet (5 stages + integrated LUFS + true-peak) | pending |
| 5 | **Vertical slice: Full-On 138 BPM 60s, human-ear verified** | pending |
| 6 | UX: error boundary, memoization, a11y, dead UI fixes | pending |
| 7 | Real composition learning (bassline patterns from radio) | pending |
| 8 | Infra: Prisma schema, Supabase auth, Cloudflare Pages deploy, CI | pending |

## Tech stack

- **Framework:** Next.js 16 (App Router) + TypeScript 5
- **Audio:** Web Audio API + AudioWorklet (custom DSP), Tone.js
- **UI:** Tailwind CSS 4 + shadcn/ui (New York) + custom `psyforge.css`
- **State:** React (no Zustand yet) + TanStack Query (available)
- **DB (Phase 8):** Prisma + SQLite (local) + Turso (cloud sync)
- **Auth (Phase 8):** Supabase Auth
- **Deploy (Phase 8):** Cloudflare Pages

## Project structure

```
src/
  app/                    # Next.js App Router (single route: /)
    page.tsx              # PsyForge 4 workstation UI
    api/                  # radio proxy, telemetry, learning state, health
  components/
    psyforge/             # Synth UI (Knob, Keyboard, SynthRack, etc.)
    ui/                   # shadcn/ui primitives
  lib/
    psyLive4/             # Main engine facade + composer + scheduler + learning + radio
    devices/              # Device host adapters (drum, lead, melodic, sampler)
    psy-foundation-shim/  # Role/device protocol shim
public/
  worklets/               # AudioWorklet DSP (psy4-engine-v3.js, psy4-lead-worklet.js)
  samples/                # Procedural drum/instrument samples (CC-licensed / original)
  psysynth.js             # Melodic synth bundle (bass/lead/pad/keys via Web Audio)
scripts/
  dev.sh                  # Single dev server entrypoint
  psy4_audio_analyzer.py  # Spectral analysis tool (for Phase 1 baseline)
ARCHITECTURE.md           # Verified architecture (read this)
MUSICAL_GRAMMAR_ASPIRATIONAL.md  # Aspirational musical model (not yet implemented)
```

## License

Code: see `LICENSE` (to be added). Samples in `public/samples/` are procedural/original (the previous `public/samples/real/` directory of commercial hardware rips was removed in Phase 0 — it was a documented license violation).

## Contributing

This is a single-engineer rebuild. The previous history had 549 commits across ~12 days, 27% UUID-only messages, 27 "FINAL" commits each followed by more work. The new commit discipline:

- Format: `<type>(phase-N): <action> — verified by <evidence>`
- Types: `feat`, `fix`, `perf`, `chore`, `docs`
- No "FINAL", no "all gaps closed", no aspirational claims in commit messages
- Nothing ships without a measurement (and for audio, without a human ear listen)

See `ARCHITECTURE.md` for the full Definition of Done.
