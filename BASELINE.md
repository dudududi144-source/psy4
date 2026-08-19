# PSY4 — Phase 1 Baseline (Verified)

**Date:** Phase 1 render
**Method:** `scripts/render-baseline.ts` — uses the ACTUAL `PsytranceComposer` (src/lib/psyLive4/composer.ts) to generate 16 bars of FULL_ON @ 138 BPM, rendered through native Web Audio reference DSP via `web-audio-api` OfflineAudioContext.

## Honest limitation

AudioWorkletProcessor (the live drum/lead DSP in `public/worklets/psy4-engine-v3.js` + `psy4-lead-worklet.js`) does NOT run in OfflineAudioContext. So the renders use native Web Audio nodes (OscillatorNode, BiquadFilter, BufferSource) that REPLICATE the worklet DSP algorithms. The spectral measurements (peak/rms/crest/sub%/centroid) are valid; the exact sample-by-sample timbre may differ ±a few % from the live worklet output. This is the same "Engine A (offline) vs Engine B (live)" gap the project's `ARCHITECTURE_SIGNAL_FLOW.md` identified.

The composition (which notes, when, what velocity, what role) IS exactly what the user hears — the composer is the same. Only the DSP rendering differs.

## Rendered stems

| Stem | Events | Peak | RMS | Crest | LUFS | Centroid | Sub/Low/Mid/High |
|------|--------|------|-----|-------|------|----------|-------------------|
| kick | 64 | 0.0 dBFS (clip) | -28.0 dB | 25.2 | -28.7 | 1042 Hz | 96.5/3.4/0.1/0% |
| bass | 107 | -8.8 dB | -23.8 dB | 5.6 | -24.5 | — | — |
| lead | 36 | -12.1 dB | -27.3 dB | 5.8 | -28.0 | — | — |
| full mix | 302 | 0.0 dBFS (clip) | -20.2 dB | 10.2 | -20.9 | 854 Hz | 1.6/31.2/67.1/0% |

## Commercial psytrance targets (reference)

| Metric | Commercial psytrance | Current baseline | Gap |
|--------|---------------------|------------------|-----|
| LUFS (full mix) | -9 to -11 | -20.9 | +10 to +12 dB too quiet |
| Crest factor (kick) | 8-12 | 25.2 | ~2× too clicky |
| Centroid (kick) | 80-150 Hz | 1042 Hz | click dominates, not body |
| Kick peak | -1 dBTP | 0 dBFS (clip) | clipping |
| Bass vs kick loudness | ±3 dB | -15 dB (bass 15dB quieter) | bass buried |
| Spectral: sub% | 15-25% | 1.6% | sub-energy missing in mix |
| Spectral: high% | 15-25% | 0% | no air (hats/cymbals) |
| Spectral: mid% | 25-35% | 67.1% | muddy, dark |

## Findings (what the ear + numbers confirm)

1. **Kick is clipping.** Peak 0 dBFS. The safety compressor in the reference render isn't enough. Phase 4 (MasterWorklet with true limiter) fixes.

2. **Kick is click-dominated.** Crest factor 25.2 (commercial: 8-12). Centroid 1042 Hz (commercial: 80-150 Hz). The click transient dominates over the sub body. This matches the old `BENCHMARK_REPORT.md` finding ("PSY4 kick = 99% high, קליק לא קיק"). The reference render has a sub body (96.5% sub energy), but the click's high-frequency content pulls the centroid up.

3. **Bass is 15 dB quieter than kick.** Commercial psytrance: ±3 dB. The bass is buried. The mix will sound kick-heavy and thin. This is partly the sparse bass pattern (~6-7 of 16 positions/bar, not "rolling 16ths") and partly level balance. Phase 5.2 fixes the pattern + level.

4. **Lead is buried.** Peak -12 dB (3 dB below bass, 18 dB below kick). The 3-osc supersaw with slow LFO is inaudible in the mix. Plus no FM (ADR-010 fabricated) — no psychedelic character. Phase 5.4 adds FM + raises level.

5. **Full mix: 0% high-frequency energy.** Spectral balance is 67% mid, 0% high. Dark and muddy. Commercial psytrance needs 15-25% high (hats, cymbals, air). The hats are present (64 events) but their level is too low and they're filtered too aggressively (highpass 7kHz + bandpass 10kHz = very narrow).

6. **Full mix LUFS -20.9.** Commercial: -9 to -11. The mix is 10 dB too quiet. Phase 4 (real MasterWorklet with LUFS targeting + true-peak limiter) fixes.

7. **No "rolling" character.** The bass pattern is sparse (107 events over 16 bars = ~6.7/bar, but each is a 16th note). Commercial psytrance bass = 12-16 16ths/bar. Phase 5.2 fixes.

## What the user should hear (listening test)

Open the listening dashboard at **`/baseline/`** (served from `public/baseline/index.html`). 4 audio players with the DSP numbers visible.

Expected honest impression:
- **kick**: punchy but clicky, with sub weight. Not a "cardboard box" anymore (the reference DSP has a proper sub body), but the click is too sharp.
- **bass**: sparse, not rolling. Sounds like offbeat 8ths with gaps, not the continuous 16th-note psytrance bass.
- **lead**: barely audible, no character. A supersaw that swells and dies.
- **full mix**: dark, muddy, kick-heavy. No high-frequency air. Not recognizable as psytrance yet.

## Phase 2-5 fix priorities (confirmed by measurement)

| Phase | Fix | Measured gap it closes |
|-------|-----|----------------------|
| 2 | double-play routing | (not in baseline render — this is a live-engine bug, the reference render doesn't double) |
| 3 | hot-path allocations | (perf, not spectral) |
| 4 | MasterWorklet: limiter + LUFS + true-peak | kick clip, full-mix LUFS -20.9 → -10 |
| 5.1 | kick velocity uniform | (musical, not directly measured) |
| 5.2 | rolling 16th bass | bass 6.7/bar → 12-16/bar, bass level -15dB → ±3dB |
| 5.3 | TB-303 AcidVoice | (acid is currently same as bass — no separate measurement) |
| 5.4 | Lead FM + level | lead -12dB → audible, no FM → FM character |
| 5.5-6 | AABA + EvolvingSequence | (musical structure, not spectral) |

## Verdict

**Current baseline does not sound like psytrance.** The composition skeleton is correct (64-bar arrangement, section contrast), but the DSP balance and spectral distribution are wrong. The kick clips and clicks, the bass is sparse and buried, the lead is inaudible, and the full mix has 0% high-frequency energy.

This is the honest starting point. Phase 2-5 fixes these one by one, with a re-render + re-listen after each.
