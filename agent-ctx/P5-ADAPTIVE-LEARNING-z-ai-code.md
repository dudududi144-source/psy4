# P5-ADAPTIVE-LEARNING — Work Record

**Task ID**: P5-ADAPTIVE-LEARNING (Phase 5 — real-time adaptation: learn melodies and rhythms from the radio)
**Agent**: Z.ai Code (main)
**Date**: 2026-08-10

## Context

The engine (Psy4EngineV2) matches PARAMETERS (T1 — LearningMemory stores refFeatures/engineParams/matchScore triples) but doesn't learn MUSICAL CONTENT. It doesn't:
- Learn the radio's melodic motifs and incorporate them into our lead
- Learn the radio's drum patterns and use them
- Adapt its musical vocabulary based on what it hears

This task builds the adaptive learning layer that fixes all three gaps.

## Files touched

| File | Change | Lines |
|------|--------|-------|
| `src/lib/studio/engine/vocabularyLearner.ts` | NEW | ~640 |
| `src/lib/studio/engine/musicAnalyzer.ts` | extended (+extractRecentMelodicMotif, +midiToScaleDegree, +SCALES import, +MOTIF_EXTRACT_COOLDOWN_SEC, +lastMotifExtractTime) | +130 |
| `src/lib/studio/engine/musicalDirector.ts` | extended (+vocabulary field, +setVocabularyLearner, +composeDrumsWithLearnedRhythm, +worldId param to composeLead, +30%/40% quoting paths) | +170 |
| `src/lib/studio/engine/psy4EngineV2.ts` | extended (+vocabularyLearner field, +updateVocabularyLearner, +getVocabularyStats, +save in stop) | +120 |
| `src/app/page.tsx` | extended (+vocabularyStats state, +polling, +VOCABULARY card) | +200 |

## Architecture

```
                ┌─────────────────────────────────────┐
                │            Radio stream              │
                └──────────────┬──────────────────────┘
                               │ ~10s reference windows
                               ▼
   ┌────────────────────────────────────────────────────┐
   │  ReferenceListenerV2  →  liveTrack(refMetrics)     │
   └──────────────┬─────────────────────────────────────┘
                  │
                  ▼
   ┌────────────────────────────────────────────────────┐
   │  Psy4EngineV2.liveTrack()                          │
   │  ├─ applySynthesisPursuit (T1)                     │
   │  ├─ applyEffectsPursuit (T1)                       │
   │  ├─ applyDeepPursuit (A1)                          │
   │  ├─ phaseSync / djController (D1)                  │
   │  ├─ applyLearnedPatternProactively (T1)            │
   │  ├─ runLearningTick (T1)                           │
   │  ├─ updateMusicAnalyzer (P2)                       │
   │  │     ↓                                           │
   │  │   MusicAnalyzer.update()                        │
   │  │     • spectralHistory (centroid per window)     │
   │  │     • energyHistory (energy per window)         │
   │  │     • rhythm: kickPattern + hatPattern          │
   │  │     • contour: shape + range + direction        │
   │  │     • events: dropHit / riserStart / breakStart │
   │  │                                                 │
   │  └─ updateVocabularyLearner()  ← NEW (P5)          │
   │        ↓                                           │
   │      ┌────────────────────────────────────────┐    │
   │      │ VocabularyLearner                       │    │
   │      │  • learnMotif(extractRecentMelodicMotif)│    │
   │      │  • learnRhythm(rhythm.kickPattern, …)   │    │
   │      │  • tickEvaluation(matchScore)           │    │
   │      │  • localStorage persistence             │    │
   │      └────────────────────────────────────────┘    │
   └──────────────┬─────────────────────────────────────┘
                  │
                  ▼
   ┌────────────────────────────────────────────────────┐
   │  MusicalDirector.composePhrase()                   │
   │  ├─ composeDrums (40% → composeDrumsWithLearnedRhythm)│
   │  │   quote learned kick/hat gates, character-gated │
   │  ├─ composeLead (30% → use learned motif as base)  │
   │  │   apply transformMotifForPhase (transpose/invert│
   │  │   /fragment/shorten+sequence/elongate) → quote  │
   │  │   EVOLVES across phrases                        │
   │  └─ markUsed(learnedId) → 30s effectiveness window │
   └────────────────────────────────────────────────────┘
```

## Key design decisions

1. **Motif notes stored as SCALE DEGREES, not MIDI pitches.** This lets a learned motif transpose cleanly across any key — when the engine's musicalKey changes, the same learned motif is still musical. The MelodyEngine.setMotif() consumes scale-degree motifs directly.

2. **Motif extraction = spectral-centroid proxy.** We don't have raw audio. The analyzer's spectralHistory tracks centroid per ~10s window. Over 60s we get ~6 samples → enough for a 4-8 note macro-contour motif. Each centroid → MIDI (12·log2(f/440)+69) → nearest scale degree (root-relative). The MusicalDirector's transformation pipeline (transpose/invert/sequence) compensates for the coarseness by developing the contour into richer material.

3. **30s cooldown on motif extraction.** The analyzer updates every ~10s but the centroid only changes meaningfully over longer windows. Extracting every 30s avoids learning the same motif repeatedly (plus the VocabularyLearner's dedup catches any near-duplicates that slip through).

4. **Dedup in the learner.** Both motifs (≥85% scale-degree match) and rhythms (identical 16-char gates) dedupe against existing entries — bumping useCount instead of duplicating. A radio station with a stable groove accumulates ONE rhythm pattern, not 30 copies.

5. **Effectiveness tracking via the same match score T1 uses.** Psy4EngineV2 passes `learningMemory.getStatus().recentAvgScore` to `vocabularyLearner.tickEvaluation()`. This means the vocabulary effectiveness tracks the SAME match score the parameter-learning uses — they're aligned. The tanh-squash on delta (±0.18 max per evaluation) limits damage from a single noisy 30s window.

6. **Character gating wins over the quote.** In composeDrumsWithLearnedRhythm, a 'break' phrase stays sparse (kick on steps 0+8 only) even if the radio's pattern is dense. Character (the phrase's musical role) wins over the quote (the radio's content) for structural decisions. The quote colors the GROOVE; the character sets the STRUCTURE.

7. **The quote EVOLVES, doesn't repeat.** When the lead quotes a learned motif, the same transformMotifForPhase pipeline (transpose/invert/fragment/shorten+sequence/elongate) applies. So the quote develops across phrases — statement (motif as-is), variation (transpose +3rd or fragment), contrast (invert), climax (diminution + sequence), resolution (augmentation). The radio's melody becomes a SEED that grows, not a sample that loops.

8. **Vocabulary persists across sessions.** Unlike musicalAnalysis (cleared on stop), the VocabularyLearner is NOT reset on stop() — it accumulates. The whole point of adaptive learning is "yesterday's radio influenced today's music." localStorage key: `psy4_vocabulary_v1` (separate from T1's `psy4_learning_memory_v1`).

## Verification

- `npx tsc --noEmit --skipLibCheck 2>&1 | grep -E "vocabularyLearner|musicalDirector|psy4EngineV2|page.tsx|musicAnalyzer" | head` → **EMPTY** (0 errors in any touched file).
- `bun run lint 2>&1 | grep -E "vocabularyLearner|musicalDirector|psy4EngineV2|page.tsx|musicAnalyzer" | grep error` → **EMPTY** (0 lint errors).
- `curl http://localhost:3000/` → HTTP 200, ✓ Compiled.

## Honest gap

PHYSICAL LISTENING UNVERIFIED. The signal chain is well-formed:
- liveTrack → updateVocabularyLearner
- → musicAnalyzer.extractRecentMelodicMotif (centroid → MIDI → scale degree)
- → vocabularyLearner.learnMotif
- → director.composeLead (30% chance) fetches learned motif
- → transformMotifForPhase applies development
- → melody.setMotif installs
- → nextNote per step fires the quote
- → vocabularyLearner.markUsed + tickEvaluation tracks effectiveness

But the audible result (does the lead ACTUALLY quote the radio's melodies?) is asserted by construction, not by listening.

The motif extraction is a coarse approximation (spectral centroid as proxy for melodic register). A real pitch detector would need raw audio access (chromagram or HPS). The 30s cooldown + 60s window + ≥4-note minimum + static-contour rejection all guard against learning noise, but the resulting motifs are macro-contours, not exact transcriptions.

## Next steps (P6+, not done here)

- Real pitch detector (chromagram or HPS on raw audio) to replace the spectral-centroid proxy
- Adaptive quoting probabilities (raise 30%/40% when effectiveness is high; lower when low)
- Style-aware vocabulary filtering (currently `style` param is informational only)
- Counterpoint rules (check quoted motifs against the current chord progression)
- Time-based vocabulary forgetting (slowly decay effectiveness toward 0.5 over hours/days)
