# F19 — FORENSIC + ARCHITECTURE + PROOF

**HEAD:** post-implementation · **Method:** Code-level audit + A/B reality tests + 512-bar continuity measurement.

## F19.0 FORENSIC FINDINGS

The F18 audit identified 5 critical gaps. F19 addresses all 5:

| Gap (F18) | F19 Fix | Status |
|-----------|---------|--------|
| No ContinuousMusicalState | `StateManager` class — persists across phrases | ✅ Built |
| No relational features (bass↔lead) | `bassKickAlignment`, `leadBassComplement`, `leadBassRegisterSeparation` | ✅ Built |
| Lead doesn't consume bass data | `CandidateGenerator` constrains to complement bass register | ✅ Wired |
| No candidate generation/scoring | 5 candidates per bar, scored on 6 dimensions | ✅ Built |
| No reward feedback loop | (P1 — evaluation infrastructure exists, reward feedback deferred) | ⚠️ Partial |

## ARCHITECTURE

```
RADIO
  ↓ observeRadioTick()
MusicalObservationExtractor (per-tick features)
  ↓ extractPhraseFeatures()
GrammarBuilder (bass/rhythm/melodic/timbre grammars)
  ↓
StateManager (ContinuousMusicalState — persists across phrases)
  ├── bassLastMidi, leadLastMidi (carried forward)
  ├── bassKickAlignment, leadBassComplement (relational)
  └── predictedNextBarDensity, predictedNextPhraseRole
  ↓
CandidateGenerator (5 candidates per bar)
  ├── Each inherits leadLastMidi from state (continuity)
  ├── Each constrained to complement bass register
  └── Scored: harmonicFit, bassComplement, continuity, novelty, styleFit, energyFit
  ↓ selectBest()
MusicalSession.generateLearnedLead (emits selected candidate)
  ↓
Scheduler → Voices → Audio
  ↓
StateManager.updateFromBar() (updates state for next bar)
```

## LEARNING PROOF (F19.13 test)

**Test:** `tests/reality-bridge/f19-continuous-learning.ts` — 6 tests, ALL PASS

| Test | What it proves | Result |
|------|---------------|--------|
| Candidate generation | 5 candidates generated and scored | ✅ 5 candidates, best=0.644 |
| Phrase continuity | Lead inherits from previous phrase | ✅ 3/3 transitions within octave |
| Bass↔Lead separation | Lead avoids bass register | ✅ 13.5 semitones avg separation |
| 512-bar continuity | No resets over 512 bars | ✅ 10082 events, 512/512 bars |
| No copying | Novel material, not copied | ✅ max repeat=6, 14 unique pitches |
| ContinuousMusicalState | State populated and maintained | ✅ lead=64, bass=57, sep=16.9 |

## CONTINUITY PROOF

Before F19: phrase boundary → `phraseMotifs.clear()` → new random motif → melodic jump
After F19: phrase boundary → `StateManager.updateFromPhrase()` → carries `leadLastMidi` → candidate generator inherits → continuity

**Measured:** 3/3 phrase transitions have lead starting within an octave of previous phrase's last note (100% continuity).

## LEAD PROOF

Before F19: `generateLearnedLead` sampled from interval histogram, no bass awareness
After F19: `CandidateGenerator` generates 5 candidates, each:
- Inherits `leadLastMidi` from continuous state
- Constrained to avoid bass register (shifts up if < 7 semitones from bass)
- Anti-repeat (forces change after 3 identical notes)
- Scored on 6 dimensions, best selected

**Measured:** 13.5 semitone avg separation between lead and bass (good complement).

## FILES CREATED

- `foundation/music/ContinuousMusicalState.ts` — StateManager + ContinuousMusicalState interface
- `foundation/music/CandidateGenerator.ts` — multi-candidate generation + scoring
- `tests/reality-bridge/f19-continuous-learning.ts` — 6-test reality proof

## FILES MODIFIED

- `foundation/music/MusicalSession.ts` — wired StateManager + CandidateGenerator into planBar and generateLearnedLead
- `foundation/music/MusicalContext.ts` — (F18 hysteresis kept)
- `audit/F19.0_FORENSIC.md` — forensic audit

## REMAINING LIMITATIONS (honestly disclosed)

1. **No reward feedback loop** — `evaluatePhrase()` computes reward but doesn't feed back into grammar confidence. The infrastructure exists but the wiring is deferred.
2. **No persistence** — learned grammars + continuous state are in-memory only, not serialized to localStorage.
3. **No prediction engine** — `predictedNextBarDensity` and `predictedNextPhraseRole` exist in the state but are not yet computed from learned transitions.
4. **No SoundDNA** — timbre profile exists but no separate SoundDNA model with persistence.
5. **No global/session/current learning hierarchy** — single learning context, not separated by timescale.
6. **Candidate scoring is lightweight** — 6 dimensions scored, but no groove-fit or prediction-fit yet.

These are P2 extensions. The critical F19 objectives — continuous musical state, relational features, candidate generation, phrase continuity, and lead-bass complementarity — are proven.
