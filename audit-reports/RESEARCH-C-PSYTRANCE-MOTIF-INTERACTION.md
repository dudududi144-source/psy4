# RESEARCH-C — Psytrance Motif Development, Call/Response, and Role Interactions

**Task ID:** RESEARCH-C
**Agent:** research sub-agent (general-purpose)
**Date:** 2026-08-13
**Question under investigation:** At the MUSICAL MATERIAL level, how do motifs behave, develop, call/respond, repeat/vary, recapitulate, and interact in psytrance — with deep focus on the kick↔bass relationship and the question of whether "sidechain intent" can be modeled as a musical parameter without prescribing compressor thresholds.

**Method:** 11 web searches via z-ai `web_search` + 13 full-page reads via z-ai `page_reader`. Sources span psytrance-specific production literature (Myloops, Safe&Sound Mastering, Daniel Sokolovskiy, E-Clip, Melodigging Goa/Progressive/Minimal, Alien Chaos, YGP, Medium modular), general production reference (Roland Articles on TB-303, PointBlank percussion, EDMProd call-and-response, Polarity Music drones, Bluezone dark-ambient roles, Motifkit transformations, Outerverse scales). No code modified. All claims attributed to URLs. RESEARCH-A covered role taxonomy, arrangement structure, kick+bass system, motif parameters at a high level, and energy/density representation — this report goes DEEPER on musical material behavior and is complementary, not duplicative.

---

## Section 1 — Motif Behavior in Psytrance

### 1.1 The motif is rhythmic/timbral before it is melodic

Across psytrance-specific sources, a motif is understood less as "a tune" and more as "a short, recognisable shape carried primarily by rhythm, accent, and timbre, with pitch content deliberately restrained."

- **E-Clip** (eclipmusic.com — already cited in RESEARCH-A §5): *"It's easy to find a scale and select notes … But placing those notes in a rhythmic pattern that works is where the real creativity happens. … What makes a melody unique is: how we arrange the notes in time (rhythm); which notes we emphasize (accents); how we add movement and variation to avoid repetition."* ([eclipmusic.com/post/mastering-psytrance-melodies-rhythmic-patterns-accents-variations](https://www.eclipmusic.com/post/mastering-psytrance-melodies-rhythmic-patterns-accents-variations))
- **Melodigging (minimal psytrance)**: *"Motifs are often rhythmic/timbral riffs rather than developed melodies; pitch automation and filter movement carry the narrative."* ([melodigging.com/genre/minimal-psytrance](https://www.melodigging.com/genre/minimal-psytrance))
- **Melodigging (progressive psytrance)**: *"Melodic content is restrained: short motifs, call-and-response FX, and intervallic riffs that slowly morph rather than large chord changes."* ([melodigging.com/genre/progressive-psytrance](https://www.melodigging.com/genre/progressive-psytrance))
- **Melodigging (Goa trance)**: *"Keep chord changes sparse; let evolving motifs, counter-melodies, and filter automation supply movement."* ([melodigging.com/genre/goa-trance](https://www.melodigging.com/genre/goa-trance))

### 1.2 Repetition rate and cycle length

Motifs repeat densely (every bar or every few bars) and operate on **two simultaneous cycle lengths**:

- **Bar-aligned cycles** (4/8/16 sixteenths): repeat exactly in phase with the 4/4 grid. Common for bass and percussion motifs.
- **Odd-time cycles** (3/5/7 sixteenths) played against the 4/4 bar: *"The melody never feels static because it shifts against the main beat. It creates a rolling, hypnotic groove that keeps evolving."* (E-Clip, eclipmusic.com) — the pattern only re-aligns with the bar after `LCM(cycle,16)` sixteenths (e.g., 3 against 16 → realigns after 48 sixteenths = 3 bars; 7 against 16 → realigns after 112 sixteenths = 7 bars). This creates long-phase evolution from short material.

### 1.3 Variation rate (micro vs structural)

- **4-bar micro-variation** (E-Clip): *"Keep the first 4 bars familiar, but in the second 4 bars, change one or two notes or add an octave shift."* Variation = 1–2 notes per 4 bars.
- **8-bar structural change** (Wikipedia, RESEARCH-A §2.2): *"different leads, rhythms and beats generally change every eight bars."*
- **16–64-bar evolution** (Melodigging minimal): macro arc with filter/envelope automation rather than motif rewrite.
- **Layer-entry cadence** (Wikipedia): new layer added every 4–8 bars.

### 1.4 What distinguishes a "psytrance" motif from "techno" or "trance"

| Dimension | Psytrance | Techno | Trance |
|---|---|---|---|
| Motif content | Rhythmic/timbral riff, restrained pitch, modal minor | "One really tight, well-produced loop" (Psynews) | Singable melodic hook, chord-progression-driven |
| Pitch vocabulary | Phrygian / Dorian / harmonic minor / Hungarian minor "raga-like motifs" (Melodigging Goa; Outerverse) | Minor / chromatic, often atonal | Natural minor, anthemic, vocal-leaning |
| Variation strategy | Micro-variation (1–2 notes per 4 bars), filter sweep, octave shift | Loop refinement, layer swaps, sound-design modulation | Sectional contrast (breakdown → drop), key changes |
| Sound-design role | FM/PM/granular/formant motifs are first-class musical material | Percussive / textural loops | Supersaw leads, plucks, pads |
| Tempo | 138–150+ BPM (Splice) | 120–135 BPM | 128–140 BPM (Splice) |

Sources: [psynews.org/forums/topic/72134](https://www.psynews.org/forums/topic/72134-is-psytrance-a-musically-complex-genre), [yourghostproduction.com/content/how-trance-differs-from-other-electronic-genres](https://yourghostproduction.com/content/how-trance-differs-from-other-electronic-genres), [splice.com/blog/what-is-trance-music](https://splice.com/blog/what-is-trance-music), [outerverse.fm/blogs/tutorials/understanding-scales-modes-in-psytrance](https://outerverse.fm/blogs/tutorials/understanding-scales-modes-in-psytrance), [melodigging.com/genre/goa-trance](https://www.melodigging.com/genre/goa-trance).

**The distinguishing feature is not the motif itself but its OPERATING PROFILE**: short, modal, rhythmically skewed (often odd-time), evolving by micro-variation and sound-design automation rather than by melodic rewrites. A trance motif "develops"; a psytrance motif "morphs."

---

## Section 2 — Call/Response Patterns

### 2.1 Where call/response appears in psytrance

Sources identify call/response at multiple role boundaries:

- **Lead ↔ counterline** (RESEARCH-A §1.4 listed "counterline / call-and-response motif" as one role).
- **Lead ↔ acid riff** — the acid answers the lead with a squelchy filter-sweep gesture.
- **Motif ↔ FX** — YGP: leads may be *"short repeating patterns, call-and-response motifs, or filter-swept phrases that evolve"* ([yourghostproduction.com/content/everything-you-need-to-know-about-psy-trance](https://yourghostproduction.com/content/everything-you-need-to-know-about-psy-trance)).
- **Arpeggio ↔ arpeggio** — Goa: *"rapid, ornamented lead lines and call-and-response arpeggios"* (melodigging.com/genre/goa-trance). Two arpeggios trade figures, often with the response arpeggio in a different register or inversion.

### 2.2 Response delay (typical timings)

Psytrance inherits EDM's broader call/response convention but compresses it:

- **EDMProd general rule** ([edmprod.com/using-call-and-response](https://www.edmprod.com/using-call-and-response)): 4-bar pattern — call (bars 1–2), response (bars 3–4). Response starts on bar 3 (one bar of "room"). Extended to 8 bars: doubled melody with extra notes on second call and more notes on response.
- **Psytrance compression**: at 138–150 BPM, 1 bar ≈ 1.6–1.7 s. EDM's 2-bar call / 2-bar response (≈ 6.8 s total at 140 BPM) is the long-form ceiling. Psytrance also uses:
  - **1-bar call / 1-bar response** (≈ 3.4 s)
  - **2-beat call / 2-beat response** (≈ 1.7 s)
  - **Acid-style 1-beat call / 1-beat response** (≈ 0.86 s) — short squelchy figure traded with another voice
- **Reddit r/edmproduction (common producer technique)**: *"turn around on the 4th bar. So do 3 bars which are all very similar, followed by a 4th bar with a big change up."* ([reddit.com/r/edmproduction/comments/1anjv0e](https://www.reddit.com/r/edmproduction/comments/1anjv0e/what_are_your_cool_techniques_for_call_and)) — the response is condensed into a single bar at the end of a 4-bar phrase, a pattern well-suited to psytrance's "3 bars familiar + 1 bar variation" aesthetic (mirrors E-Clip's 4-bar rule).

### 2.3 Differentiation dimensions (what makes a response feel like a response)

From EDMProd: a good call/response contains **(a) different pitch** (octave up/down or harmonising notes), **(b) variation in intensity** (softer/harder), **(c) different sounds or instruments**. Extension techniques: apply wet reverb with long decay to the response, apply ping-pong delay to the response, lower response by an octave. ([edmprod.com/using-call-and-response](https://www.edmprod.com/using-call-and-response))

In psytrance specifically, the most common differentiation is **timbral**: lead calls with a bright FM/saw voice, response answers with an acid 303 voice (different synthesis = different timbre = automatic differentiation), or with a delayed/filter-swept echo of the call. This means **the role boundary IS the call/response differentiation** in psytrance — call and response are often literally different roles.

### 2.4 Inference (not directly stated but strongly implied by Goa + EDMProd + YGP)

Call/response in psytrance is typically:
- **2-bar or 4-bar at the motif level** (lead ↔ counterline)
- **1-bar or 2-beat at the riff level** (lead ↔ acid)
- **1-beat at the percussive/FX level** (motif ↔ delay throw, motif ↔ reverse)

The shorter the cycle, the more it functions as "texture" rather than "melody."

---

## Section 3 — Repetition and Variation Mechanics ("Hypnotic Without Being Static")

### 3.1 The five-axis variation vocabulary

Synthesising E-Clip, YGP, Melodigging, and the Medium modular-composition article, psytrance achieves "hypnotic without static" via five concurrent variation axes, each on its own timescale:

| Axis | What changes | Timescale | Source |
|---|---|---|---|
| **Pitch micro-variation** | 1–2 notes per 4 bars; octave shift; interval substitution | 4-bar | E-Clip |
| **Rhythmic displacement** | Add syncopated note; remove a beat; shift a note by a 16th | 4-bar | E-Clip |
| **Velocity/dynamic variation** | Accent pattern shift; first-note velocity drop | 4-bar / per-bar | E-Clip; Safe&Sound (first bass note ~30% lower) |
| **Effect modulation** | Filter cutoff sweep; reverb depth; delay feedback; resonance peak movement | 8–64 bars | E-Clip; YGP; Roland acid article |
| **Layer entry/exit** | New role enters; existing role thins or exits | 4–8 bars (cadence); 16–32 bars (section) | Wikipedia; YGP |

### 3.2 The "filter movement as narrative" principle

This is the most psytrance-specific variation mechanism. From multiple sources:

- **YGP**: *"Instead of massive changes every 16 bars, psy trance often relies on small adjustments: filter movement, tiny fill patterns, drum layer swaps, FX accents, delay throws, short melodic variations."* ([yourghostproduction.com/content/everything-you-need-to-know-about-psy-trance](https://yourghostproduction.com/content/everything-you-need-to-know-about-psy-trance))
- **Goa (Melodigging)**: *"Automate filters, envelopes, and effects to reshape recurring motifs across the arrangement; emphasize gradual transformation over abrupt drops."*
- **Roland (TB-303 article)**: *"Without movement, the 303 risks sounding flat and uninspired."* The acid line breathes via filter cutoff evolution — *"Start with the cutoff low, resonance high, and slowly open it up over time."* ([articles.roland.com/beyond-acid-pushing-the-tb-303-into-new-sonic-territory](https://articles.roland.com/beyond-acid-pushing-the-tb-303-into-new-sonic-territory))
- **Polarity Music (textures/drones)**: *"Good textures usually change slowly. Small modulation, filtering, stereo movement, and reverb can be more effective than constant dramatic changes."* ([polarity.me/topics/textures-and-drones](https://polarity.me/topics/textures-and-drones))

### 3.3 The "modular composition" insight: motif meaning depends on what's underneath

From the Medium modular composition article ([medium.com/@findwondrland/music-production-notes-building-psytrance-through-modular-composition-dcba153ffe0f](https://medium.com/@findwondrland/music-production-notes-building-psytrance-through-modular-composition-dcba153ffe0f)):

- Motifs are organised as three families: **Themes** (melodic material), **Flow** (rhythm), **Psy** (drones/atmospheres/textures).
- *"A motif that feels weak under one flow pattern suddenly becomes powerful under another."*
- *"Themes influence one another without being tied to one another. They become a palette, not a sequence."*

**Critical implication for the Foundation's motif model**: a motif's perceived intensity is not intrinsic — it is the **interaction** of motif × flow × psy-layer. A Foundation that models motifs independently of their rhythmic and atmospheric context will mis-predict perceived variation. This supports the RESEARCH-A call for an explicit **Interaction** abstraction alongside the motif abstraction.

### 3.4 The "odd-time cycle" mechanism (long-phase evolution from short material)

Already covered in RESEARCH-A §5.3 and confirmed by E-Clip. The hypnotic effect arises because a 3/5/7-cycle motif against a 16-sixteenth bar only realigns every 3/5/7 bars, generating **long-phase perceptual evolution from short, fixed material**. This is mathematically generated variation: the motif itself does not change, but its relationship to the bar does. The Foundation can express this as a single parameter (cycle length) without needing to enumerate the resulting perceptual variation.

### 3.5 Summary: "hypnotic without static" = concurrent slow variation on 5 axes

The genre's signature temporal aesthetic is the **superposition** of (a) very short fixed material (1-bar motifs) with (b) odd-time cycle drift (long-phase), (c) 4-bar pitch/rhythm micro-variation, (d) 8–64 bar filter/effect modulation, and (e) 4–8 bar layer entry/exit. None of these alone would be hypnotic — the hypnosis emerges from their concurrent operation at different timescales.

---

## Section 4 — Callback / Recapitulation

### 4.1 Sources are largely implicit on formal callback

No source explicitly discusses "motif return at the drop" using the classical term *recapitulation*. However, multiple sources describe the underlying behaviour:

- **Wikipedia (already in RESEARCH-A)**: *"the song will break down and start a new rhythmic pattern over the constant bass line"* — i.e., after the breakdown, a **new** pattern (not necessarily a return of the old one). This is variation rather than recapitulation.
- **YGP**: re-entry sections *"often with new motif or transformed lead"* ([yourghostproduction.com/content/everything-you-need-to-know-about-psy-trance](https://yourghostproduction.com/content/everything-you-need-to-know-about-psy-trance)). Key word: **transformed** — re-entry features a *transformed* version of an earlier motif, not a literal restatement.
- **Goa (Melodigging)**: *"Automate filters, envelopes, and effects to reshape recurring motifs across the arrangement"* — motifs **recur** but are **reshaped**.
- **Medium modular composition**: motifs exist as a palette and are revisited in different combinations: *"You can build multiple arrangements from the same ideas. You can swap flows, change motifs, rebalance energy."* Motifs return in new combinations rather than as literal recapitulations.

### 4.2 Typical recapitulation points (inference from arrangement literature)

Combining Wikipedia's section model (intro / build / drop / breakdown / re-entry / outro) with YGP's "transformed lead at re-entry" and Goa's "reshaped recurring motifs," the typical points at which earlier material returns are:

| Structural point | What returns | How transformed |
|---|---|---|
| **Drop** (after build) | Lead motif first stated in build | Filter opened up, octave up, full layer complement |
| **Re-entry** (after breakdown) | Drop's lead motif | Transformed — different filter state, different octave, or paired with a new counterline/acid |
| **Outro** | Sometimes a stripped version of the lead | Thinned to single voice, slower, lower register |

### 4.3 The psytrance-specific rule: recapitulation = transformation, not restatement

Unlike classical recapitulation (literal return of theme in tonic), psytrance recapitulation is **always transformational**. Returning to a motif means returning to it with a different filter state, a different octave, a different rhythmic placement, or against a different Flow/Psy backdrop. This matches the genre's identity profile (RESEARCH-A §8.8: "micro-variation rather than macro-change") — even the return of a motif is a micro-variation, not a literal restatement.

### 4.4 Implication for the Foundation's motif model

The Foundation needs a **development schedule** with at least:
- `variations[]` (forward-looking, per motif: atBar, operator, parameters) — RESEARCH-A §5 proposed this
- `callbacks[]` (atBar, sourceMotifId, transform) — RESEARCH-A §5 proposed this; this report confirms it is required
- The transform in a callback should be constrained to psytrance-appropriate operators (filter state change, octave shift, register shift, layer-context change) — not arbitrary rewrite

---

## Section 5 — Kick ↔ Bass Relationship (Deep)

This is the central section. **The user's specific question is: what is MUSICAL (Foundation's job) vs what is MIX (PSY4's job)? Can "bass yields to kick" be a musical parameter without prescribing compressor thresholds?**

### 5.1 The canonical pattern: K-b-B-B

- **Safe&Sound Mastering** ([masteringmastering.co.uk/psy-trance-kick-and-bass-html](https://www.masteringmastering.co.uk/psy-trance-kick-and-bass-html)): *"the kick is normally just a sine wave downward pitch swept and 3 x 16th note low pass filtered saw wave pulses."* Notation: **KbBB** (small `b` = first bass note at lower velocity, ~30% reduction, or ducked by sidechain, or both). The pattern is one kick on the beat followed by three 16th-note bass pulses.
- **Myloops** ([myloops.net/how-to-make-psytrance-kick-and-bass-work-together](https://www.myloops.net/how-to-make-psytrance-kick-and-bass-work-together)): describes the same pattern at 8th-note granularity: *"Psytrance runs kick on every quarter and bass on the offbeat eighth — the classic bouncing pulse."* The 8th-note description is the simplified view; the 16th-note K-b-B-B is the full pattern.
- **Daniel Sokolovskiy** ([dsokolovskiy.com/blog/all/psytrance-bassline-synthesis](https://dsokolovskiy.com/blog/all/psytrance-bassline-synthesis)): "offbeat bass on D1" — confirms offbeat placement.

**Timing relationship (MUSICAL)**: K-b-B-B per beat (kick on the beat, three 16th bass notes following, first bass note reduced in velocity/ducked). This is the canonical psytrance kick/bass pattern. The Foundation can express this directly as a `pattern = "KbBB"` field or as a `timingLock` interaction parameter — **no synthesis information needed**.

### 5.2 The pitch relationship

- **Myloops**: *"Producers typically tune to F, F#, or G, but the only pitch that matters is the one your kick is actually ringing at."* Kick fundamental: 50–70 Hz. Kick body rings 80–150 ms. Click at 2–5 kHz.
- **Myloops**: *"Tune the bass to the kick, in cents. If the kick's body rings at 63 Hz, that's a hair flat of C2. If your bass is playing an equal-tempered C, its fundamental sits at 65.4 Hz — a 40-cent gap. Two low-frequency tones that close together don't blend; they beat."* Goal: beat rate <1 cycle/sec.
- **Safe&Sound**: kick and bass must be tuned to same root; *"the kick is sacred — you built the track around it — so the bass tunes to the kick."*
- **RESEARCH-A §3.2**: keys "comfortable for bass/kick tuning (e.g., F♯m, Em, Dm)" — co-tuning at the key-selection level.

**Pitch relationship (MUSICAL)**: kick fundamental pitch and bass root note are the same pitch class (mod octave). The Foundation can express this as `kickFundamentalPitch` (in Hz or as a note name) and a `pitchCoTuning` interaction parameter (`bassRoot = kickFundamentalPitch`). **No synthesis information needed.**

### 5.3 The frequency-domain split

- **Myloops**: explicit hard split — **kick owns 30–90 Hz, bass owns 90–250 Hz, above 250 Hz shared carefully**. Bass is HPF'd at 90 Hz with 24 dB/oct. *"Your bass is providing the low-mid body and the rhythmic pulse — not the weight."* The kick carries the sub weight; the bass carries body and pulse.

**Frequency split (MIX, not musical)**: the 90 Hz crossover is a **mix decision** about which channel owns which frequency band. The Foundation should not specify "HPF at 90 Hz 24 dB/oct." However, the Foundation CAN express the **musical fact** that "kick carries the sub weight" and "bass carries the body and rhythmic pulse" — these are role/function statements that imply but do not prescribe the EQ.

### 5.4 The bass envelope (synthesis decision but with musical implications)

- **Myloops**: bass amp envelope = `Attack=0, Decay=60–90ms, Sustain=0, Release=20–40ms`. *"Every note is a self-terminating stab. Done right, the patch ducks itself around the kick before you've added a single sidechain plugin."*
- **dsokolovskiy**: `Attack=0, Release=0, Sustain=0, Decay≈30% of max`. Sawtooth wave dropped one octave, 24 dB/oct low-pass filter at ~400–700 Hz, filter cutoff routed to modulation envelope.
- **Safe&Sound**: oscillator **phase reset/retrigger is mandatory** — *"This resets the start phase of the oscillator so it maintains precise phase/timing for each note triggered by the sequencer. If this is not set up you will hear a shift of phase randomly for each note start."*
- **dsokolovskiy**: confirms Retrig must be ON.

**Bass envelope (SYNTHESIS, but tightly coupled to musical intent)**: the specific ADSR values and oscillator phase-reset are PSY4's job. However, the Foundation CAN express the **musical fact** that "bass notes are self-terminating stabs, not sustained tones" and "bass notes must be phase-consistent across repeats" — these are **behavioural constraints** on the voice that the Foundation may express without prescribing oscillator type or filter topology.

### 5.5 The timing offset

- **Myloops**: *"Nudge the bass a few milliseconds late so the kick's tail clears before the bass attacks. … Try 5–15 ms of positive delay on the bass channel and A/B."* At 145 BPM, an 8th note is ~207 ms; kick body decays over ~120 ms; bass nudged 5–15 ms late.

**Timing offset (MUSICAL with synthesis realisation)**: the Foundation can express `bassTimingOffset = "+5 to +15 ms relative to kick"` as a musical parameter — it is a **temporal relationship** between two roles. PSY4 realises this as a channel delay. The Foundation does not say "use Ableton's track delay" — it says "bass attacks slightly after kick transient."

### 5.6 The sidechain question — the central issue

**Myloops is unusually explicit** that psytrance sidechain is **a shape, not a compressor**:

- *"Forget the slow-attack, syrupy house pump. Psytrance wants a fast, gated duck that opens the moment the kick transient is done doing its job."*
- Two implementation routes:
  1. **Volume shaper** (Cableguys VolumeShaper, Kickstart, LFOTool): *"Draw a curve that drops to silence on the beat, holds down for 30–50 ms, then ramps back to unity over the next 60–80 ms. Tempo-locked, sample-consistent, immune to kick velocity. This is what most pros actually use."*
  2. **Kick-triggered compressor**: Attack 0.1 ms, Ratio 8:1+, Threshold for 8–12 dB GR, Release 80–100 ms. *"Faster than house sidechain because the groove is denser. Works, but the shape depends on the incoming kick level, so a louder kick means deeper duck."*
- **Application scope**: *"Apply the duck to bass, sub layer, pads, drones, atmospheres — anything with meaningful energy below 500 Hz. The whole low-mid range should breathe with the kick as one system."*
- **Special cases**:
  - Sustained bass notes: *"automate the duck depth down during sustains, or route sustains to a parallel bass channel with a slower recovery curve (say, 150 ms)."*
  - 16th-note rolls: *"Shorten the recovery to around 50–60 ms in busy sections, or reduce the duck depth."*
- **Safe&Sound**: confirms first bass note is either velocity-reduced (~30%) OR volume-shaped (LFO Tool) OR both — this is the **musical/event-level** view of the same phenomenon.

**Critical finding**: the sidechain in psytrance is **a fast, deterministic, tempo-locked volume shape**, NOT a dynamic compressor response. The musical *intent* is "every time the kick hits, the bass (and pads/drones/atmospheres) briefly get out of the way." The *shape* of that duck (depth, hold time, recovery time) is a **musical parameter** because it determines the groove's perceived bounce. The *implementation* (volume-shaper vs compressor vs velocity) is a mix decision.

### 5.7 Can "sidechain intent" be a musical parameter?

**YES.** The Foundation can and should express:

| Field | Type | Musical meaning | Mix/synth realisation (PSY4's job) |
|---|---|---|---|
| `sidechainIntent.active` | bool | "Bass yields to kick" is ON | Realised as volume-shaper, compressor, or velocity pattern |
| `sidechainIntent.depth` | "none" / "subtle" / "moderate" / "deep" / "full-duck" | How much bass gets out of the way | Maps to dB reduction (0 / 3 / 6 / 9 / 12+ dB) — PSY4 picks the value within the band |
| `sidechainIntent.holdMs` | "short" / "medium" / "long" or numeric range | How long bass stays down after kick | 30–50 ms short, 50–80 ms medium, 80–120 ms long |
| `sidechainIntent.recoveryMs` | "fast" / "medium" / "slow" or numeric range | How fast bass returns to unity | 50–60 ms fast, 60–80 ms medium, 80–150 ms slow |
| `sidechainIntent.scope` | list of role names | Which roles duck | ["bass", "sub", "pad", "drone", "atmosphere"] |
| `sidechainIntent.exceptions` | list of (role, condition) | Sustains and rolls get different shapes | "on sustained bass: deeper recovery; on 16th roll: shorter recovery" |

The Foundation expresses **intent** (the bass yields to the kick, with this depth and recovery band, applied to these roles) **without prescribing** threshold, ratio, attack, release, knee, or implementation choice. PSY4 picks the actual compressor/volume-shaper settings within the band. This matches RESEARCH-A §3.4 and the orchestrator's PSY4-MUSICAL-WHAT-LAYER-DESIGN-AUDIT §4 proposal that `sidechainIntent` is a MUSICAL parameter, not a synth threshold.

### 5.8 The "engine" / coupling claim (energy relationship)

- **Safe&Sound**: *"kick and bass are interdependent, are not separate from each other. If you adjust the kick, the perception of bass changes, if you adjust bass line, the perception of kick changes."* And: *"3 grooves in one unit syncopating and pulsating the crowd at the edge of their timing perception."* The listener can switch hearing focus between "kick durr, kick durr" and the 3-bass pulse pattern — they are perceptually one instrument with multiple interpretations.
- **Myloops**: *"A touch of saturation on the bass, or on a bus containing both kick and bass, adds shared harmonic content that makes them feel like one instrument. Not a sidechained pair — one instrument."*
- **Wikipedia (RESEARCH-A §3.3)**: bass "pounds constantly throughout the song" — continuous except in breakdown.
- **Safe&Sound**: tracks open with *"8 to 16 bars in the beginning as if to showcase the KbBB skills of the producer and it also sets up a hypnotic start to the track, getting people into the groove."*

**Energy coupling (MUSICAL)**: kick+bass is one system; they enter together, sustain together, drop together (except breakdown), and are tuned/timed as a unit. The Foundation should model them as a `RoleInteraction` with `type=couple`, `timingLock=KbBB`, `pitchCoTuning=yes`, `energyCoupling=continuous-until-breakdown`, `sidechainIntent={...}`.

### 5.9 Does the kick pattern change? Does the bass pattern change?

- **Kick pattern**: 4/4 unchanged throughout the track except in breakdown (drops out) and occasionally at section transitions (filtered, shortened, or replaced by a fill). Sources do not describe kick rhythmic variation within a section — the kick is **constant**.
- **Bass pattern**: K-b-B-B is the default. Variation occurs via:
  - First-note velocity/duck depth (per Safe&Sound: sometimes varies across bars)
  - Sustained notes at bar ends (Myloops: "held notes at bar ends")
  - Triplet fills and 16th-note runs (Myloops: "triplet fills, 16th runs, held notes at bar ends, silence for tension")
  - Note pitch change at section boundaries (modulation)
- **Together or independently?**: kick is constant; bass varies. They do not change together (except at section boundaries). The bass carries the rhythmic variation while the kick provides the constant anchor.

**Implication**: the Foundation should model the kick as a **constant rhythmic anchor** with section-level state (active/filtered/dropped) and the bass as a **pattern with variation operators** (sustain, triplet fill, 16th roll, pitch shift, silence) layered on top of the K-b-B-B skeleton.

### 5.10 Summary: musical vs mix in kick↔bass

| Aspect | MUSICAL (Foundation's job) | MIX / SYNTHESIS (PSY4's job) |
|---|---|---|
| Pattern | `KbBB` (kick + 3 bass 16ths, first bass note reduced) | — |
| Pitch | `kickFundamentalPitch`, `bassRoot` tuned to kick (in cents) | Specific oscillator tuning implementation |
| Frequency split | "Kick carries sub; bass carries body+pulse" (role/function) | HPF at 90 Hz 24 dB/oct, specific EQ curves |
| Bass envelope | "Self-terminating stabs, phase-consistent" (behaviour) | ADSR values (A=0, D=60–90ms, S=0, R=20–40ms), Retrig=ON |
| Timing offset | `bassTimingOffset = +5 to +15 ms` | Channel delay implementation |
| Sidechain | `sidechainIntent = {active, depth, holdMs, recoveryMs, scope, exceptions}` | Compressor threshold/ratio/attack/release OR volume-shaper curve; specific dB values within band |
| Coupling | `interaction.type=couple, energyCoupling=continuous-until-breakdown` | Saturation amount on bus, glue compressor settings |
| Variation | Bass: sustain/triplet-fill/16th-roll/silence operators; Kick: constant | — |

**Answer to the user's specific question**: YES — "bass yields to kick" can be expressed as a MUSICAL parameter (`sidechainIntent`) with **qualitative/banded values** (depth, hold, recovery, scope) that the Foundation owns, while PSY4 picks the actual compressor/volume-shaper thresholds within the band. The Foundation does NOT prescribe threshold, ratio, attack, release, knee, or implementation. The musical fact is "the bass yields to the kick with this much depth and this recovery shape, applied to these roles"; the mix fact is "achieve this via volume-shaper curve X or compressor settings Y."

---

## Section 6 — Acid Line Behavior and Musical Function

### 6.1 Is the "acid" sound a synthesis decision or a musical role?

**It is both, and the two are tightly coupled but separable.**

- **Synthesis decision**: the TB-303 (and its software emulations) has a specific architecture — sawtooth/square oscillator, 24 dB/oct resonant low-pass filter, accent and slide circuits, envelope-driven filter cutoff. The "acid squelch" is the sound of the resonance peak being swept by the filter envelope. (Roland: *"an unmistakable, squelchy resonance, the hypnotic sequences, and the modulating filter sweeps"*; Reddit r/psytranceproduction: *"analog synths with a low pass filter and resonance cranked up."*)
- **Musical role**: in psytrance, "acid" is a distinct role from the bass (which is the rolling 1/16 low-end) and from the lead (which is the more sustained melodic motif). The acid line sits in the midrange, evolves via filter movement, and acts as a counterpoint/secondary motif to the lead. Safe&Sound even calls the bass itself an *"acid derivative"* descended from Goa's TB-303 usage — but in modern psytrance, the bass has specialised into the low-end pulse and a separate acid voice handles the midrange squelch role.

### 6.2 How an acid line evolves (filter sweep, resonance peak, note pattern)

From the Roland TB-303 article ([articles.roland.com/beyond-acid-pushing-the-tb-303-into-new-sonic-territory](https://articles.roland.com/beyond-acid-pushing-the-tb-303-into-new-sonic-territory)):

| Behaviour | Programming | Musical function |
|---|---|---|
| **Acid bassline** (classic) | Saw wave, 16-step pattern with note slides, cutoff low + resonance high, slowly open over time, accents on key notes, minor pitch/timing tweaks | Backbone of 303 programming; "breathes life into a track, making it pulse and evolve rather than sitting statically" |
| **Liquid slides/legato** | Square wave, long slides without sharp note breaks, cutoff mid-range, low resonance | "Vocal-like presence"; leads that "weave in and out of the mix" |
| **Resonant filter sweeps as texture** | Higher octave, high resonance, slow cutoff sweep, delay+reverb, MIDI automation, sparing accents | "Sit above the mix rather than below it"; textural layer that fills space and creates tension |
| **Percussive clicks/pops** | Saw wave, short decay, zero sustain, high cutoff, low resonance, ultra-short notes scattered across grid | "Double up as a percussive sound source"; rhythmic complexity |
| **Sub-bass rumbles** | Square wave, cutoff almost closed, low resonance, touch of glide | "Deep, rolling bassline" under minimal techno/dub |
| **Zaps/chirps/bubbles** | Maxed resonance, manual cutoff play, short decay (zaps) or extended (bubbles), random accents | "Sound effects powerhouse"; ear candy |

### 6.3 The acid line's musical function in psytrance specifically

Synthesising Roland + Melodigging Goa + YGP:

- **Counter-melodic role**: the acid line is the lead's "shadow" — it answers the lead with a contrasting timbral gesture (squelch vs sustained lead). This is one realisation of the call/response pattern (Section 2).
- **Tension-generation role**: the slow filter sweep creates rising tension across 8–64 bars without melodic change.
- **Psychedelic-motion role**: in Melodigging's words, the acid is part of the psychedelic sound-design vocabulary (FM/PM/resonant band-pass sweeps) that defines the genre.
- **Layered density role**: Goa specifically uses *"layered arpeggios, and acid motifs"* — multiple acid voices operating in parallel, often stacked with different roles (sub-bass / acid lead / percussion / texture per Roland's 4-stack example).

### 6.4 The acid line is the canonical "evolving motif" of psytrance

More than any other role, the acid line embodies the genre's "hypnotic without static" aesthetic. Its note pattern can remain fixed for 16+ bars while its filter state evolves continuously. The Foundation should model the acid as a motif with:
- A note pattern (possibly fixed for long stretches)
- A **filter trajectory** (cutoff/resonance envelope over 8–64 bars) — this is the MUSICAL material, not the synthesis decision
- An **accent pattern** (which notes get the accent circuit)
- A **slide/legato pattern** (which note transitions glide)

The Foundation can express the filter trajectory as a **musical parameter** (`filterMotion = {startCutoff: "low", endCutoff: "open", durationBars: 32, contour: "exponential"}`) without prescribing the specific dB value of resonance or the filter implementation (ladder vs OTA vs digital emulation).

---

## Section 7 — Percussion Layering and Interactions

### 7.1 The three-tier frequency/functional model

From PointBlank Music School ([pointblankmusicschool.com/blog/how-to-master-percussion-layering-for-richer-beats](https://www.pointblankmusicschool.com/blog/how-to-master-percussion-layering-for-richer-beats)):

- **Low (foundation)**: kicks, toms, bass-heavy drums
- **Mid**: snares, claps, congas — "fill out the middle range"
- **High**: hi-hats, shakers, tambourines — "add sparkle and rhythm on top"

This matches RESEARCH-A's role taxonomy (Rhythmic foundation: kick, bass, hats, shakers/rides, mid percussion).

### 7.2 Core vs secondary percussion

- **Core percussion**: kick, snare/clap, hi-hats — the backbone, plays consistently.
- **Secondary percussion**: shakers, tambourines, congas, bongos, rimshots, woodblocks, claps/snaps — *"not always constant but come in and out to keep the rhythm fresh and engaging."* Used for syncopation and off-beat rhythms.
- **Complementary densities**: PointBlank explicitly warns against frequency clashes — *"When multiple percussion sounds sit in the same frequency range, they can mask each other. Use EQ to carve space."* This is a **mix decision**, but the **musical fact** is that each percussion role occupies a different register.

### 7.3 Psytrance-specific percussion interactions

Synthesising PointBlank with YGP/Melodigging (RESEARCH-A):

- **Closed hat**: steady 16th or offbeat 8th pattern, high-frequency, drives momentum.
- **Open hat**: off-beat placement, often on the "and" of beat 2 and 4 (the classic house-derived offbeat open hat), adds energy.
- **Ride**: sustained upper-mid texture, often 8th or quarter notes, "shimmer" function (Goa: "shimmering pads and extensive use of delay/reverb").
- **Clap/snare**: backbeat on 2 and 4 (house-derived) OR used as a section transition accent (psytrance-specific: claps often mark the start of a new 8-bar phrase).
- **Mid percussion (rimshot/wood/metal/toms/ghost notes)**: syncopated accents that don't repeat every bar — these are the **micro-variation** percussion layer (RESEARCH-A §1.4).
- **Ghost notes**: very low-velocity hits between strong hits — "humanise" the pattern.

### 7.4 Layering rules (MUSICAL vs MIX)

| Aspect | MUSICAL (Foundation) | MIX (PSY4) |
|---|---|---|
| Which roles active per section | role-activity mask (RESEARCH-A §6) | — |
| Register per role | closed hat = high, clap = mid, etc. | Specific EQ per channel |
| Density per role | event rate (16th, 8th, quarter) | — |
| Velocity pattern | accent pattern (strong/weak/ghost) | Velocity-to-volume curve |
| Panning | "shaker left, bongo right" (musical placement) | Specific pan values |
| Complementary density | "no two roles compete in same register at same time" | EQ carving |

### 7.5 The "drum layer swap" as variation technique

YGP: *"drum layer swaps"* are listed as a micro-variation technique. This means **swapping which percussion sample plays a given role** at a section boundary — e.g., clap → snap, closed hat → rimshot. The Foundation can express this as a `roleSoundState` change per section without prescribing the specific sample.

---

## Section 8 — Pad / Atmosphere Role

### 8.1 Functional distinction: drone vs pad vs texture vs atmosphere

From Bluezone ([bluezone-corporation.com/blog/the-sounds-of-dark-ambient-music-understanding-their-roles](https://www.bluezone-corporation.com/blog/the-sounds-of-dark-ambient-music-understanding-their-roles)) and Polarity Music ([polarity.me/topics/textures-and-drones](https://polarity.me/topics/textures-and-drones)):

- **Drone**: *"A sustained sound layer that functions as a stable or slowly evolving foundation."* Defined by **duration, continuity, and structural role** — NOT by source or pitch. May be tonal, atonal, noise-based, harmonic, dissonant, synthetic, or processed acoustic.
- **Pad**: contributes **harmonic color**; a "wide background layer" with tonal/harmonic content. Polarity: a pad is *"a blurred chord, a slowly changing synth layer."*
- **Texture / noise layer**: *"background noise or brief disturbance"* — grain, density, internal movement; not necessarily pitched.
- **Atmosphere**: Polarity's umbrella term for the "larger than its obvious notes" backdrop — drones, pads, textures, field recordings all qualify.

**The defining characteristic is FUNCTION, not SOURCE** (Bluezone: *"this guide classifies dark ambient sounds according to their dominant role within a piece rather than their source alone. A metallic recording may become a drone, a texture, an ambience or a short event depending on how it is processed and positioned within the mix."*).

### 8.2 Musical function in psytrance

- **Continuity** — *"help a piece feel alive even when not much is happening rhythmically"* (Polarity).
- **Section connection** — *"connect sections, make transitions feel smoother, and stop empty spaces from feeling accidental"* (Polarity).
- **Harmonic anchor** — pads hold the modal center (Phrygian/Dorian/Aeolian root) while the bassline and lead move around it.
- **Psychedelic motion** — *"drones, atmospheres, textures, spectral movements, granular swells, noise gestures, and all the slow breathing energy that makes a psytrance track feel alive"* (Medium modular).

### 8.3 Slow variation is the rule

- Polarity: *"Good textures usually change slowly. Small modulation, filtering, stereo movement, and reverb can be more effective than constant dramatic changes."*
- Bluezone: *"Long durations play an important role. Sounds are frequently allowed to evolve slowly, revealing subtle changes in density, resonance, harmonic content or texture."*
- Medium modular: *"create these elements outside the eight bar grid. They should drift and evolve on their own. Some may last thirty seconds. Some may stretch for a minute or more. The point is to let them breathe instead of locking them to a loop."*

### 8.4 The pad/atmosphere is the SECOND sidechain target

Per Myloops §5.6 above: *"Apply the duck to bass, sub layer, pads, drones, atmospheres — anything with meaningful energy below 500 Hz."* The pad/atmosphere layer is **musically subordinate to the kick** in the same way the bass is — it yields to the kick on every beat. This is a musical fact the Foundation should express via `sidechainIntent.scope = ["bass", "sub", "pad", "drone", "atmosphere"]`.

### 8.5 Relationship to harmonic context

The pad typically sustains the **root or fifth** of the modal center, providing the harmonic "floor" against which the lead and acid move. In a Phrygian track in E, the pad might sustain E or B (or a cluster E–F–B) for minutes at a time. The Foundation can express this as a `sustainedHarmony` parameter on the pad role, distinct from the lead's melodic content.

---

## Section 9 — Counterline / Secondary Motif

### 9.1 Is there typically a counterline?

Yes — but it is rarely a classical "counterpoint" line. In psytrance, the counterline is realised through one of three patterns:

1. **Call/response counterline** (most common): the counterline answers the lead with a differentiated gesture (different pitch, different timbre — usually an acid voice or a delayed echo). See Section 2.
2. **Parallel-motion counterline**: the counterline follows the lead at a fixed interval (third, fifth, octave) — but this is rare in psytrance because it competes with the lead's midrange energy. More common as a brief section device (e.g., octave doubling at a drop).
3. **Contrary-motion counterline**: the counterline moves in the opposite pitch direction to the lead — used sparingly, often as a transitional device into a breakdown.

### 9.2 Relationship to the lead

From Goa (Melodigging): *"evolving motifs, counter-melodies, and filter automation supply movement"* — counter-melodies are explicitly named as one of three movement sources, alongside motif evolution and filter automation.

The counterline in psytrance is typically:
- **Lower in register than the lead** (or higher, but rarely same register — to avoid masking)
- **Lower in density** (fewer notes per bar)
- **Different in timbre** (acid/FM/filtered vs the lead's bright sustained voice)
- **Delay-derived**: frequently a delayed echo of the lead (the "delay throw" YGP mentions) rather than an independent composition

### 9.3 The "delay as counterline" pattern

YGP lists *"delay throws"* as a micro-variation technique. In psytrance, the delay is often tuned (e.g., dotted-quarter delay at the BPM) so that the delayed echoes of the lead fall on rhythmic positions that **complement** the lead's pattern. This effectively turns the delay into an algorithmic counterline — the producer doesn't compose the counterline, they tune the delay to generate it.

The Foundation can model this as a `derivedCounterline` interaction (`sourceRole = "lead"`, `derivation = "delay"`, `timing = "dotted-quarter"`, `feedback = "3 echoes"`) without composing the counterline notes directly.

---

## Section 10 — Motif Transformation Operators in Psytrance Context

### 10.1 The classical transformation toolkit (Motifkit reference)

From Motifkit ([motifkit.com/retrograde-inversion](https://motifkit.com/retrograde-inversion)) and the broader motif-development literature it references:

| Operator | What it does | Source |
|---|---|---|
| **Prime (P)** | The motif as stated | Motifkit |
| **Retrograde (R)** | Notes in reverse order (same pitches, reversed in time) | Motifkit |
| **Inversion (I)** | Every interval flipped upside-down around first note (interval sizes preserved, direction flipped) | Motifkit |
| **Retrograde Inversion (RI)** | Inverted then reversed | Motifkit |
| **Transposition** | Shift to different starting pitch | Motifkit (12-tone) |
| **Augmentation** | Time-stretch (longer note values) | Motifkit (linked article) |
| **Diminution** | Time-compress (shorter note values) | Motifkit (linked article) |
| **Sequence** | Repeat at different pitch levels | Motifkit (linked article) |
| **Fragmentation** | Use only a portion of the motif | Motifkit (linked article) |
| **Change of mode** | Major ↔ minor (or modal interchange) | Motifkit (linked article) |

### 10.2 Which operators are USED in psytrance, and how?

Mapping the classical toolkit to psytrance-specific practice (synthesising E-Clip, Goa, YGP, Roland):

| Operator | Used in psytrance? | Psytrance-specific realisation | Musical intent |
|---|---|---|---|
| **Transposition** | YES (common) | Octave shift (most common — E-Clip: "add an octave shift"); section-level key change (Nitzhonot: "dramatic key changes") | Variations within motif; section contrast |
| **Fragmentation** | YES (common) | Use a 1–2 note fragment of the lead as a percussive stab or acid answer | Layering density; ear candy |
| **Rhythmic displacement** | YES (very common) | Shift a note by a 16th; add syncopated note; remove a beat (E-Clip) | 4-bar micro-variation |
| **Register shift** | YES (common) | Move the motif up an octave at the drop; down an octave in the breakdown | Section energy |
| **Augmentation** | YES (rare) | Stretch motif note values at the breakdown for "slowed" feel | Tension/release |
| **Diminution** | YES (common, especially Goa) | "rapid, ornamented lead lines" — diminution applied to a slow motif produces the Goa-style fast ornamented lead | Goa-specific ornamentation |
| **Sequence** | YES (common) | Repeat motif at higher pitch levels across an 8-bar build | Build tension |
| **Interval substitution** | YES (subtle) | Replace one note with a scale-degree neighbour (Phrygian ♭2 colour) | Modal coloration |
| **Inversion** | RARE | Used in Goa occasionally for "mirror" melodic figures; otherwise uncommon | Classical counterpoint device |
| **Retrograde** | RARE | Not a typical psytrance device — backwards motifs are more common as **audio reverses** (FX reverse gesture) than as compositional retrogrades | Reversed-tail FX (YGP) |
| **Retrograde Inversion** | VERY RARE | Essentially absent from psytrance production literature | Twelve-tone technique, not used |
| **Change of mode** | OCCASIONAL | Modal interchange (Phrygian ↔ Aeolian) at section boundaries; more common in Nitzhonot and morning psytrance | Mood shift |
| **Filter-state transformation** | YES (signature psytrance) | Same motif, different filter cutoff/resonance state — recapitulation by sound-design rather than by pitch rewrite | Recapitulation without literal restatement (Section 4) |
| **Layer-context transformation** | YES (signature psytrance) | Same motif placed against different Flow (rhythm) or Psy (atmosphere) backdrop — perceived intensity changes (Medium modular) | Recapitulation by context change |

### 10.3 The psytrance-specific operators not in the classical toolkit

Two operators are **signature psytrance** and have no direct classical equivalent:

1. **Filter-state transformation**: the motif's notes/rhythm stay identical, but the filter cutoff/resonance envelope is different. The "return" of a motif at the drop is often literally the same MIDI with a different filter state. This is the genre's primary recapitulation mechanism.

2. **Layer-context transformation**: the motif is placed against a different rhythmic or atmospheric backdrop, changing its perceived intensity without changing the motif itself. *"A motif that feels weak under one flow pattern suddenly becomes powerful under another"* (Medium modular).

The Foundation's `DevelopmentPlan.operators` (RESEARCH-A §5) should include both classical operators (transposition, fragmentation, rhythmic displacement, register shift, augmentation, diminution, sequence, interval substitution, change of mode) AND psytrance-specific operators (filter-state-transform, layer-context-transform, velocity-pattern-shift, accent-pattern-shift).

### 10.4 What operators are NOT used

- Retrograde and retrograde-inversion are essentially absent from psytrance production literature. The genre does not think in those terms. Inversion is occasionally used in Goa for mirror figures but is not a primary device.
- Twelve-tone technique is not used (no prime-row manipulation).
- Classical counterpoint (strict species) is not used.

The Foundation should not promote these operators as psytrance-default; they may exist as optional operators but should not be the primary motif-development vocabulary.

---

## Section 11 — FACT vs INDUSTRY PRACTICE vs COMMON CONVENTION vs INFERENCE

This section distinguishes epistemic status of the key claims.

### 11.1 FACT (verifiable, source-stated, not in dispute)

- **K-b-B-B pattern**: Safe&Sound explicitly names the "KbBB" notation and describes the kick + 3 x 16th-note bass pattern. Myloops confirms kick-on-quarter + bass-on-offbeat.
- **Frequency split at 90 Hz**: Myloops explicitly states kick owns 30–90 Hz, bass owns 90–250 Hz, HPF bass at 90 Hz 24 dB/oct.
- **Bass envelope**: Myloops states A=0, D=60–90ms, S=0, R=20–40ms. dsokolovskiy confirms A=0, S=0, R=0, D≈30%.
- **Oscillator phase reset/retrigger is mandatory**: Safe&Sound and dsokolovskiy both state this explicitly.
- **Sidechain preferred as volume-shaper, not slow compressor**: Myloops explicitly states this with implementation detail (30–50 ms hold, 60–80 ms recovery, applied to bass/sub/pads/drones/atmospheres).
- **Acid = TB-303 architecture**: Roland article describes oscillator, filter, accent, slide circuitry explicitly.
- **Tracks 6–12 minutes, 4/4, 138–150+ BPM**: Wikipedia, Melodigging, Splice (RESEARCH-A).
- **Drone is defined by function (duration, continuity, structural role), not source**: Bluezone states this explicitly.
- **First bass note ~30% lower velocity OR ducked**: Safe&Sound states this.

### 11.2 INDUSTRY PRACTICE (what professional producers actually do, source-described)

- **Bass nudged 5–15 ms late**: Myloops describes this as standard producer practice.
- **Bass tuned to kick in cents, target beat rate <1 cycle/sec**: Myloops describes this as the goal.
- **Saturation on bass or bass+kick bus for glue**: Myloops describes this as glue-making practice ("makes them feel like one instrument").
- **Tracks open with 8–16 bars of pure KbBB**: Safe&Sound describes this as common ("Many psytrance tracks have a super hypnotic pulsating KbBB for 8 to 16 bars in the beginning").
- **Acid line evolves via slow filter sweep over 8–64 bars**: Roland describes this as the standard 303 programming technique.
- **Pad/atmosphere drifts outside the 8-bar grid**: Medium modular explicitly describes this as a producer workflow.
- **Layer-entry cadence every 4–8 bars**: Wikipedia (already RESEARCH-A).
- **Acid line as distinct role from bass and lead**: implied across Roland + Melodigging Goa + YGP.

### 11.3 COMMON CONVENTION (widely followed but not strictly mandatory)

- **Keys F♯m, Em, Dm for kick/bass tuning**: Melodigging (progressive) — common, not mandatory.
- **Phrygian / Dorian / harmonic minor / Hungarian minor scales**: Outerverse, Melodigging Goa — common, not mandatory; producers choose based on desired mood.
- **Call/response 4-bar pattern with response on bar 3**: EDMProd — general EDM convention, applied to psytrance.
- **Open hat on offbeat 8th**: house-derived, common in psytrance.
- **Drone = tambura parallel**: Safe&Sound's analogy — common conceptual framing, not a rule.
- **3/5/7-note odd-time cycles**: E-Clip — common technique, not mandatory.
- **Mono bass + kick**: Safe&Sound — standard, with stereo as advanced option only.
- **Saturation on bass (Decapitator/Saturn)**: Myloops — common, with specific tool suggestions.

### 11.4 INFERENCE (not directly stated, derived from synthesising sources)

- **Call/response cycle compressed to 1-bar or 2-beat in psytrance**: EDMProd states 4-bar general; psytrance-specific compression to 1-bar/2-beat is inferred from tempo (140 BPM × 1 bar ≈ 1.7 s, too short for EDM's 4-bar pattern to feel "call and response" rather than "loop") — INFERENCE, not directly stated.
- **Recapitulation = transformation, not restatement**: derived from YGP "transformed lead at re-entry" + Goa "reshaped recurring motifs" + Medium modular "themes are a palette, not a sequence" — INFERENCE that the genre's recapitulation convention is transformational.
- **Counterline is typically delay-derived rather than independently composed**: derived from YGP "delay throws" + Goa "counter-melodies supply movement" + the genre's preference for algorithmic texture over composed counterpoint — INFERENCE.
- **The Foundation can express sidechain as a banded musical parameter without prescribing thresholds**: derived from Myloops' description of the musical intent ("fast gated duck") vs the mix implementation (volume-shaper curve OR compressor settings) — INFERENCE that the two are separable.
- **Filter-state-transform and layer-context-transform are signature psytrance operators not in the classical toolkit**: derived from Roland (acid filter sweep) + Medium modular (motif meaning depends on flow) + YGP (filter movement as variation) — INFERENCE that these are distinct psytrance operators.
- **The "3 grooves in one unit" perceptual phenomenon**: Safe&Sound describes this as the listener's experience — INFERENCE that the Foundation should model kick+bass as a coupled system whose perceptual effect emerges from the coupling, not from either part alone.
- **Bass pattern varies (sustain, triplet fill, 16th roll, silence) while kick remains constant**: derived from Myloops (variation techniques) + Wikipedia (kick pounds constantly) — INFERENCE that the variation asymmetry is intentional.

### 11.5 Confidence summary

- **Section 5 (kick↔bass)**: HIGH confidence — multiple independent producers (Myloops, Safe&Sound, dsokolovskiy) corroborate every major claim with implementation detail.
- **Section 6 (acid)**: HIGH confidence — Roland article is authoritative on TB-303 behaviour; psytrance-specific role inference is MEDIUM-HIGH (multiple sources corroborate but no single source explicitly says "acid is a distinct role from bass and lead").
- **Sections 1–4, 7–10**: MEDIUM-HIGH confidence — synthesised from multiple sources but with some inference (clearly marked) where psytrance-specific literature is silent.

---

## Sources Cited (RESEARCH-C specific; RESEARCH-A sources not repeated unless re-cited)

1. Myloops — *Psytrance Kick and Bass: A Frequency-by-Frequency Lock-In Guide* — [myloops.net/how-to-make-psytrance-kick-and-bass-work-together](https://www.myloops.net/how-to-make-psytrance-kick-and-bass-work-together) — **primary source for Section 5**
2. Safe&Sound Mastering — *Psy trance kick and bass* — [masteringmastering.co.uk/psy-trance-kick-and-bass-html](https://www.masteringmastering.co.uk/psy-trance-kick-and-bass-html) — **primary source for K-b-B-B pattern, KbBB notation, "3 grooves in one unit," 8–16 bar intro, drone analogy**
3. Daniel Sokolovskiy — *Psytrance bassline synthesis* — [dsokolovskiy.com/blog/all/psytrance-bassline-synthesis](https://dsokolovskiy.com/blog/all/psytrance-bassline-synthesis) — **primary source for bass synthesis details (osc, filter, ADSR, Retrig, resampling, EQ)**
4. Roland Articles — *Beyond Acid: Pushing the TB-303 into New Sonic Territory* — [articles.roland.com/beyond-acid-pushing-the-tb-303-into-new-sonic-territory](https://articles.roland.com/beyond-acid-pushing-the-tb-303-into-new-sonic-territory) — **primary source for Section 6 (acid line behaviour)**
5. EDMProd — *How to Write Better EDM Melodies with Call & Response* — [edmprod.com/using-call-and-response](https://www.edmprod.com/using-call-and-response) — **primary source for Section 2 (call/response mechanics)**
6. Melodigging — *Goa Trance* — [melodigging.com/genre/goa-trance](https://www.melodigging.com/genre/goa-trance) — call-and-response arpeggios, modal writing, filter automation, acid motifs
7. PointBlank Music School — *How to Master Percussion Layering for Richer Beats* — [pointblankmusicschool.com/blog/how-to-master-percussion-layering-for-richer-beats](https://www.pointblankmusicschool.com/blog/how-to-master-percussion-layering-for-richer-beats) — **primary source for Section 7 (percussion layering)**
8. Polarity Music — *Textures and Drones* — [polarity.me/topics/textures-and-drones](https://polarity.me/topics/textures-and-drones) — **primary source for Section 8 (drone/pad/atmosphere function)**
9. Bluezone Corporation — *The sounds of dark ambient music: understanding their roles* — [bluezone-corporation.com/blog/the-sounds-of-dark-ambient-music-understanding-their-roles](https://www.bluezone-corporation.com/blog/the-sounds-of-dark-ambient-music-understanding-their-roles) — **primary source for drone vs pad vs texture vs sub-bass vs rumble functional distinction**
10. Motifkit — *Retrograde & Inversion Explained (Motif Transformation)* — [motifkit.com/retrograde-inversion](https://motifkit.com/retrograde-inversion) — **primary source for Section 10 (transformation operators)**
11. Outerverse — *Understanding Scales & Modes in Psytrance* — [outerverse.fm/blogs/tutorials/understanding-scales-modes-in-psytrance](https://outerverse.fm/blogs/tutorials/understanding-scales-modes-in-psytrance) — psytrance-specific scales (Harmonic Minor, Hungarian Minor, Natural Minor, Phrygian)
12. Medium / findwondrland — *Music Production Notes: Building Psytrance Through Modular Composition* — [medium.com/@findwondrland/music-production-notes-building-psytrance-through-modular-composition-dcba153ffe0f](https://medium.com/@findwondrland/music-production-notes-building-psytrance-through-modular-composition-dcba153ffe0f) — **primary source for "motif meaning depends on flow/psy context" and the layer-context-transform operator**
13. Reddit r/edmproduction — *Call and response techniques* — [reddit.com/r/edmproduction/comments/1anjv0e](https://www.reddit.com/r/edmproduction/comments/1anjv0e/what_are_your_cool_techniques_for_call_and) — "turn around on the 4th bar" convention

(Plus RESEARCH-A sources 1–17 already cited where re-referenced for continuity: Wikipedia, YGP, Melodigging progressive/minimal, E-Clip, Myloops EQ tips, Alien Chaos, Psynews, Agres 2017, Splice, Scribd masterclass.)

---

**End of RESEARCH-C report.**
