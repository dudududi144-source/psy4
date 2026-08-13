# F9 FORENSIC VERDICT

## 1. Current Actual Runtime

MusicalSession.planBar() → NotePlan → scheduleStep() → kick/bass/lead/hat audio functions.

One composer, one path. F8's architectural simplification is real — the problem is NOT multiple composers or dead code. The problem is the **musical content** itself.

## 2. Actual Startup Lead Source

**The lead comes from generateMotif() in primitives/motif.ts.**

`MusicalSession.planBar(0)` → `handleNewPhrase()` → `generateMotif(rootPc=9, scale=phrygian-dominant, {seed, steps:32, density:0.6})` → returns MotifNote[] with MIDI values in the 62-88 range (D4 to E6).

The motif generator uses `degreeToMidi(rootPc, scale, degree, octave=4)` where octave=4 means MIDI ~69-88 (A4 to E6). This is inherently a **high register** — the lead plays in octave 4-5 by default.

**ROOT CAUSE: The motif generator produces notes at octave 4+, which is the "high lead" the user hears.** There is no register control — the motif is generated at a fixed high octave.

## 3. Why Kick is Missing/Weak

**Kick is ABSENT on 24 out of 64 bars (37.5%).**

The trace shows:
- Bars 4,5: ABSTAIN → 0 kick, 0 bass, 0 lead (total silence)
- Bars 10,11,12: ABSTAIN → total silence
- Bars 16,19,23,24,25,29,30: ABSTAIN → total silence
- Bars 35,37,39: ABSTAIN → total silence
- Bars 41,44,45,46,47: ABSTAIN → total silence
- Bars 48,49,51,52,53,54,55: ABSTAIN → total silence (CLIMAX section is SILENT!)
- Bars 56,58,60,62,63: ABSTAIN → total silence

**ROOT CAUSE: The ABSTAIN role fires too aggressively.** The `chooseRole()` function returns ABSTAIN when:
1. `totalOcc > 0.8 && barInPhrase === 6` — but in internal mode (no radio), totalOcc is always 0, so this never fires
2. `radio.silenceLikelihood > 0.7 && rng < 0.4` — silenceLikelihood is ~0.95 in internal mode (no radio energy), so this fires 40% of the time
3. `barInPhrase === 7 && rng < 0.15` — 15% chance of rest at phrase end

**The silenceLikelihood check is the killer.** In internal mode with no radio, `silenceLikelihood` is near 1.0, causing ABSTAIN on ~40% of bars. This creates huge gaps of silence.

## 4. Why Bass Does Not Lock with Kick

**BASS/KICK OVERLAP = 0 on EVERY bar.**

The trace shows B/K=0 for all 64 bars. This means:
- Kick plays on steps: 0, 4, 8, 12 (four-on-floor)
- Bass plays on steps: 2, 6, 10, 14 (offbeats only)

The bass NEVER hits with the kick. In psytrance, the bass should interlock with the kick — typically bass plays on the same beat as kick OR on the offbeat between kicks. The current system only does offbeats, creating a disconnected feel.

**ROOT CAUSE: generateBass() hardcodes `bassSteps = [2, 6, 10, 14]` — always offbeats, never on the kick.**

## 5. Why Styles Sound Similar

**There is no style differentiation in the actual note generation.**

MusicalSession has a `style` field and `detectStyle()` method, but **style never affects note generation**. The `generateGroove()`, `generateBass()`, and `generateLead()` methods don't read the style at all. Style is just a label in the debug output.

**ROOT CAUSE: Style is metadata, not grammar.** The `detectStyle()` function sets `this.style` but no code path uses `this.style` to change musical behavior.

## 6. Why Radio Breaks the Engine

When radio is connected:
1. `observeRadio()` updates MusicalContext with radio energy/occupancy
2. `chooseRole()` reads `radio.currentOccupancy` — if radio is dense, it may return ABSTAIN or TEXTURE
3. `radio.silenceLikelihood` drops (radio has signal), reducing ABSTAIN frequency
4. BUT: the lead MIDI range is still octave 4+ (high), and bass/kick still don't interlock
5. The radio doesn't change the fundamental musical problems — it just modulates the broken system

**The radio doesn't "break" the engine — the engine is already broken. Radio just makes the brokenness more apparent because the user expects musical response and gets the same high lead + gaps.**

## 7. Which Previous Abstractions Are Fake/Dead/Irrelevant

| Abstraction | Status | Evidence |
|-------------|--------|----------|
| Style (FULL_ON/DARK/PROGRESSIVE/ACID) | **FAKE** — label only, no musical effect | No code path reads style to change notes |
| ABSTAIN role | **BROKEN** — causes 37.5% silence | silenceLikelihood=0.95 in internal mode |
| Bass/kick interlock | **FAKE** — B/K=0 on all bars | Bass hardcoded to offbeats only |
| Register control | **MISSING** — lead always octave 4+ | degreeToMidi uses octave=4 |
| Tension/release | **PARTIAL** — tension number changes but doesn't affect register/density enough | Tension only modulates velocity, not register |
| Learning | **REAL but weak** — EMA reward on motifs | Reward affects motif selection but motifs are all in same high register |
| Phrase structure (A→A'→B→A-return) | **REAL** — motifs do recur | Motif groups work correctly |
| 64-bar metrics (25 pitches, 12/12 PCs) | **REAL but misleading** — pitches are diverse but all in high register | Diversity ≠ musicality |

## 8. Which Components Should Be Deleted

- `RadioMusicalWindow.ts` — useful concept but `silenceLikelihood` is broken
- `MusicalContext.ts` — `COMPOSITION_ARC` is good but style/density don't affect output enough
- `MusicalMemory.ts` — learning is real but premature (fix the groove first)

## 9. Which Components Should Remain

- `MusicalTransport` — proven, do not touch
- `RadioObservationLayer` — proven, do not touch
- `Scheduler` — proven, do not touch
- `AudioContext` clock — proven, do not touch
- `primitives/scales.ts` — useful
- `primitives/motif.ts` — useful but needs register fix
- `primitives/rhythm.ts` — useful
- `primitives/bass.ts` — useful
- `primitives/rng.ts` — useful

## 10. Recommended New Architecture

```
GROOVE FIRST:
  1. Kick pattern (four-on-floor, always present)
  2. Bass pattern (interlocked with kick — hits ON kick + offbeat response)
  3. Hats (complementary)
  4. NO LEAD YET

HARMONY:
  5. Root + scale (from MusicalContext)
  6. Simple chord/root movement per phrase

LEAD (optional, controlled):
  7. Only if groove is stable
  8. Register: octave 3-4 max (MIDI 48-76, not 69-88)
  9. Motif-based, with REST as default
  10. Density: 30-50% (not 70%+)

RADIO INFLUENCE (modulation, not replacement):
  11. Radio changes density/tension, NOT musical identity
  12. Radio never causes ABSTAIN/silence
```

## 11. Why This Architecture Should Produce Different Audio

1. **Kick always present** — no more 37.5% silence
2. **Bass hits WITH kick** — creates interlock, not disconnection
3. **Lead in lower register** — no more "high lead" complaint
4. **Lead is optional** — groove can exist without lead
5. **Radio doesn't cause silence** — groove survives radio-on
6. **Style affects actual notes** — different kick/bass/lead patterns per style
