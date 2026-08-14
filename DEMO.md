# PSY4 — Psytrance Composition Engine

**Live Demo:** https://psy4.pages.dev
**Code:** https://github.com/dudududi144-source/psy4

---

## What It Does

PSY4 is a **real-time causal composition engine** that generates psytrance music in the browser. It doesn't play loops or samples — it composes music bar-by-bar using a causal inference engine, then synthesizes it with a full DSP pipeline.

**Press Play → hear a complete track:** intro → groove → drop → breakdown → rebuild.

---

## How It's Different From a DAW

| DAW (Ableton/FL) | PSY4 |
|---|---|
| User programs every note | Engine decides what to play |
| Fixed arrangement | Causal arrangement (state-driven) |
| Static patterns | Evolving patterns (bass moves, motifs vary) |
| Manual mixing | Automatic sidechain, multiband, true-peak |
| Requires samples/plugins | Self-contained (synth DSP + real samples) |
| Desktop only | Runs in any browser, any device |

---

## Architecture (3 Threads)

```
┌─────────────────────────────────────┐
│ Web Worker (composition thread)     │
│  - CausalComposerWorker             │
│  - Deterministic PRNG (mulberry32)  │
│  - Composes 3 bars ahead            │
│  - Sends events as Float64Array     │
└─────────────────────────────────────┘
               │
               ▼ (Transferable, zero-copy)
┌─────────────────────────────────────┐
│ Main thread (UI only)               │
│  - Forwards events to AudioWorklet  │
│  - React renders from worker state  │
│  - 2 timers only (detect + merged)  │
└─────────────────────────────────────┘
               │
               ▼ (postMessage, Transferable)
┌─────────────────────────────────────┐
│ AudioWorklet (audio thread, RT-safe)│
│  - 24 preallocated voices           │
│  - Zero allocations in process()    │
│  - Moog ladder + PolyBLEP + samples │
│  - Master: multiband + glue + TP    │
└─────────────────────────────────────┘
```

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| Voice instances | 24 (was 46) |
| Active voices (typical) | 2-7 |
| CPU process() time | 0.0ms (budget: 2.5ms) |
| Continuous playback | 120s+ verified |
| Play/Stop stress | 5x rapid — no crash |
| Style switch live | Works |
| Radio connect/disconnect | Works |
| Audio dropout | 0 |
| Console errors | 0 |

---

## Sound Channels (12+)

| Channel | Source | Role |
|---------|--------|------|
| Kick | Real samples (909/MD/Nord) | 4-on-floor |
| Snare | Real samples (MD snare) | Backbeat (beats 2&4) |
| Clap | Real samples (MD clap) | Layered with snare |
| Bass | Synth (saw → Moog → LFO) | Rolling 16ths |
| Sub-bass | Synth (sine) | Sustained root |
| Lead | Synth (supersaw + FM → Moog) | Melody |
| Hats | Real samples (MD hats) | Off-beat |
| Shaker | Synth (pink noise) | 16th grid |
| Percussion | Synth | Off-beat accents |
| Pad | Synth (detuned saws → Moog) | Sustained chord |
| Acid | Synth (TB-303 model) | Psychedelic |
| FX | Synth (noise → filter) | Impact, riser, sweep |

---

## Track Arrangement (32-bar cycle)

```
Bars 0-7:   INTRO    — kick + bass + snare
Bars 8-15:  GROOVE   — + hats + percussion
Bars 16-23: DROP     — + lead + acid + FX (impact)
Bars 24-27: BREAKDOWN — strip layers + pad + sweep
Bars 28-31: REBUILD  — riser + impact + lead returns
```

---

## DSP Pipeline

**Per-voice:** Moog ladder filter (24dB/oct) + PolyBLEP oscillators + saturation
**Per-bus:** Compression + EQ + saturation (5 buses: drum/bass/music/atmos/fx)
**Master:** Multiband compression → Glue compression → Saturation → LUFS targeting → True-peak limiting

**Sidechain:** Bass + lead ducked on each kick (60% depth, 150ms recovery)

---

## Engineering Highlights

- **Zero allocations** in audio thread (preallocated `_out` buffers)
- **Transferable Float64Array** for event transfer (zero-copy)
- **Deterministic PRNG** (mulberry32) — replayable from seed
- **Adaptive quality** — detects device capability (cores, memory, mobile)
- **1615 lines of dead code removed** (MusicalSession, SamplerBridge)
- **10 ADRs** (Architecture Decision Records) documented
- **25+ tests** (architecture verification + audio quality + performance)

---

## Tech Stack

- Next.js 16 + TypeScript + Tailwind CSS + shadcn/ui
- AudioWorklet (custom DSP, not Web Audio nodes)
- Web Worker (composition thread)
- SharedArrayBuffer (lock-free event transfer)
- Cloudflare Pages (deployment)

---

## Repositories

- **Main:** https://github.com/dudududi144-source/psy4
- **New:** https://github.com/dudududi144-source/psy4new
- **Live:** https://psy4.pages.dev
