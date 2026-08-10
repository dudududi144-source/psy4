# T1 — Spectral Pursuit Track

**Agent**: Z.ai Code (Spectral pursuit track)
**Task ID**: T1
**Date**: see commit
**Files touched**:
- `src/lib/studio/engine/synthesisDetector.ts` (new, ~210 lines)
- `src/lib/studio/engine/reference/referenceListenerV2.ts` (extended analysis)
- `src/lib/studio/engine/reference/referenceListener.ts` (extended interfaces + Uint8Array fix)
- `src/lib/studio/engine/styleClassifier.ts` (extended RefFeatures)
- `src/lib/studio/engine/psy4EngineV2.ts` (storage + pursuit methods + dashboard)
- `src/app/page.tsx` (extended liveTrack call)

## What T1 did

The pursuit engine previously matched 5 scalar values (kick decay, centroid, transient density, BPM, key). T1 expands it to detect and match the SOUND CHARACTER of the radio across three new axes:

1. **Harmonic content** — spectral flatness (existing), spectral crest (peak/mean), HNR (harmonic-to-noise ratio via f0+harmonic bin summation), inharmonicity (peak deviation from integer harmonics), spectral slope (dB/oct via linear regression on log-freq vs log-mag).
2. **Transient shape** — sharpness (attack rise time 10%→90%, normalized to 30ms) and decay (peak → 10% time, averaged over detected transients).
3. **Stereo field** — balance (-1..+1, L/R energy ratio), correlation (signed L·R correlation, previously only magnitude was used), M/S ratio (side / (mid+side) energy).

These drive:
- **Synthesis mode detection** (pure function `detectSynthesisCharacter`) → flips LEAD track between FM/supersaw/wavetable/classic via `setSynthMode(5, mode)` with a 20-second anti-thrash cooldown. FM depth and wavetable position continuously tuned via `setFMDepth` / `setWavetablePosition`.
- **Effects parameter pursuit** (`applyEffectsPursuit`) → reverb sends (tail + width), high/low shelf EQ (centroid brightness), Haas delay (correlation), master compressor ratio (LUFS swing), distortion send (transient sharpness). All via the Task E1 control surface (`setSendLevel` / `setTrackEffect` / `setMasterParam`).
- **Pursuit dashboard** (`getPursuitDashboard`) → complete UI object with target/actual pairs, the new harmonic / shape / stereo / synthesis / effects snapshots.

## Architecture

```
referenceListenerV2.extractFeaturesFromBuffer()
    ↓ 9 new metrics (clamped, NaN-guarded)
ReferenceMetrics + ReferenceProfile (rolling stats)
    ↓ passed via page.tsx
psy4EngineV2.liveTrack()
    ↓ stores ref* fields (10 new)
    ↓ calls applySynthesisPursuit() + applyEffectsPursuit()
buildRefFeatures() → RefFeatures (with nested harmonicContent/transientShape/stereoField)
    ↓
detectSynthesisCharacter() (pure function in synthesisDetector.ts)
    ↓ SynthesisCharacter
setSynthMode(5, mode) + setFMDepth/setWavetablePosition (Task S1)
setSendLevel/setTrackEffect/setMasterParam (Task E1)
```

## Key design decisions

1. **All new fields are optional** in ReferenceMetrics and RefFeatures — the V1 listener and existing callers continue to work unchanged. The pursuit gracefully no-ops when features are missing.
2. **The synthesis detector is a pure function** — same inputs always give the same output, no side effects, no I/O. Trivially testable. Never throws (all inputs guarded).
3. **20-second anti-thrash cooldown** on synth-mode switching — prevents the lead from flickering between FM and supersaw on borderline material. Mode-specific parameters (FM depth, wavetable position) are still tuned continuously even mid-cooldown.
4. **The detected character is ALWAYS stored** — even when we don't act on it (low confidence). This lets the UI show what the detector currently thinks.
5. **Compression pursuit uses a LUFS-swing proxy** — small swing over recent 8 windows = "glued" radio → push master ratio up. This is a heuristic, not a true short-term LUFS measurement (noted as a remaining gap).
6. **Per-track send snapshot reads `.gain.value` directly** from the rack's public readonly GainNodes — fine for UI display, may lag setTargetAtTime ramps by a few hundred ms.

## Verification

- `npx tsc --noEmit --skipLibCheck 2>&1 | grep -E "synthesisDetector|referenceListener|psy4EngineV2"` → EMPTY (zero errors). Also fixed 2 pre-existing TS 5.7+ Uint8Array<ArrayBuffer> tightening errors in referenceListener.ts (lines 375-376 → changed field types to `Uint8Array<ArrayBuffer> | null` and allocated via `new Uint8Array(new ArrayBuffer(n))`).
- `npx eslint <all touched files> --max-warnings=999` → EXIT 0 (zero errors, zero warnings).
- Dev server compiles cleanly (dev.log shows no errors).
- 175 pre-existing tsc errors remain in unrelated files (examples/, scripts/, artifacts/, audit/, dsp/, forensic/, skills/, tests/) — none in any T1-touched file.

## Remaining gaps (honest)

- PHYSICAL LISTENING UNVERIFIED — verification via TypeScript + ESLint + code audit. The signal chain is well-formed but the audible character of each detected mode is asserted by construction.
- The wavetable detector's "evolving spectral content" cue is a proxy (slope + width), not a true spectral-variance-over-time measurement. Future task: track variance of harmonicContent.crest across windows in the profile.
- Compression pursuit uses LUFS swing (heuristic). A true short-term LUFS measurement would be more accurate but heavier.
- The per-track effect-send snapshot may lag setTargetAtTime ramps by a few hundred ms — fine for UI, less precise for convergence tracking.

## How to verify in the browser

After connecting to a radio stream:
1. Open the browser console.
2. The engine logs `[PSY4] Synthesis pursuit: lead → fm (78% — inharmonicity 45% (metallic partials); ...)` whenever it switches the lead's synthesis mode.
3. Call `engine.getPursuitDashboard()` from the console to see the complete snapshot — `synthesis.mode`, `synthesis.confidence`, `harmonicContent.*`, `stereoField.*`, `effects.reverbSend[]`, etc.
4. Call `engine.getSynthesisCharacter()` to see just the latest detector output.
