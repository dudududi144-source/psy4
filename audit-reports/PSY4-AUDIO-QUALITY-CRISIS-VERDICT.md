# PSY4 — AUDIO QUALITY CRISIS VERDICT

**Date:** 2024-08-12
**HEAD:** post-F22 audio work
**Scope:** Forensic investigation of why PSY4 sounds bad, what exists in the PSY ecosystem, and what to do about it.
**HARD STOP:** This document is the deliverable. No implementation was performed.

**Investigation agents:**
- **AUDIT-A** — Sonic critique. Rendered 6 real PCM WAVs from current `psyLive.ts` voice functions using `web-audio-api` OfflineAudioContext at 44.1 kHz mono. Analyzed with `librosa`/`scipy`/`numpy`. Report: `audit-reports/AUDIT-A-SONIC-CRITIQUE.md`.
- **AUDIT-B** — PSY ecosystem inventory. Scanned 6 PSY projects on this filesystem (`/home/z/my-project`, `/tmp/psy-repos/{psy,psy3-clean,psy5}`, `/tmp/nexus-psy7`, `/tmp/psy-foundation`). Report: `audit-reports/AUDIT-B-PSY-ECOSYSTEM-INVENTORY.md`.
- **AUDIT-C** — Alternative synth engines. Researched 13 candidates (Surge XT, Vital, SuperCollider, Dexed, ZynAddSubFX, FluidSynth, wavetable, FM, granular, physical modeling, VST/CLAP/LV2 hosts, Python DSP, synthesizer inversion literature). Report: `audit-reports/AUDIT-C-ALT-SYNTH-ENGINES.md`.

**Audio artifacts for human A/B listening:**
- `audio-artifacts/AUDIT-A-kick.wav` (4 bars kick only)
- `audio-artifacts/AUDIT-B-bass.wav` (4 bars bass only)
- `audio-artifacts/AUDIT-C-kickbass.wav` (4 bars kick+bass)
- `audio-artifacts/AUDIT-D-lead.wav` (4 bars lead only)
- `audio-artifacts/AUDIT-E-8bar.wav` (8 bars full mix)
- `audio-artifacts/AUDIT-F-16bar.wav` (16 bars full mix)

---

## 1. למה PSY4 נשמע רע — WHY PSY4 SOUNDS BAD

PSY4 sounds bad for **two distinct reasons**, and conflating them has been the source of every previous failed fix attempt.

### Reason A — Parameter / routing bugs (the immediate crisis)

These are NOT architectural. They are wrong values and dead wires inside an otherwise-correct audio graph. AUDIT-A measured them with real DSP on rendered WAVs:

| # | Bug | Evidence (measured) | Effect on sound |
|---|-----|---------------------|-----------------|
| **A1** | **Bass bus is 5× quieter than kick bus** | Bass peak 0.1198 (-18.4 dB) vs kick peak 0.5998 (-4.4 dB). Bus gains: `kickBus=0.8`, `bassBus=0.5`. Per-voice: kick body peak 0.76, bass sub peak 0.36. | Bass is inaudible in the mix. The mix peak (0.6003) literally equals the kick-alone peak. |
| **A2** | **No midrange anywhere — entire mix is sub + click** | Lo-mid + mid (200–2500 Hz) energy: kick 2.7 %, bass 1.8 %, kickbass 2.4 %, 8-bar mix 13.2 %. Spectral rolloff-85 of the 8-bar mix = 145 Hz (85 % of energy below 145 Hz). | Mix sounds like a kick drum and nothing else on small speakers. No "bzzt", no "knock", no character. |
| **A3** | **Bass filter closes and never reopens** | Bass spectral centroid over time: 0 ms 3448 Hz → 6 ms 2294 Hz → 12 ms **101 Hz** → 52 ms 240 Hz. Sub-band carries 71.9 % of bass energy. | No "rolling" psytrance character. Each bass note is a 55 Hz sine with a 12 ms pluck. The filter envelope (`fStart → fEnd` exponential ramp) slams shut and stays shut because the next note's `setValueAtTime(fStart)` resets it but the ear perceives one continuous drone. |
| **A4** | **Lead has zero movement** | AM depth 0.978 = per-note envelope (swell + die), not a continuous LFO. f0 std 564 cents = motif octave jumps, not detune. ±7 cents unison is inaudible. No vibrato, no FM, no filter LFO. | Lead is a static supersaw that swells and dies on every note. Sounds like a test tone, not a synth line. |
| **A5** | **DC offset accumulates with mix duration** | 8-bar DC: -0.027. 16-bar DC: -0.056. **Doubles with duration.** Source: kick body uses `exponentialRampToValueAtTime(0.001, t+0.08)` which leaves a 0.001 residual × 64 kicks = -0.064 cumulative. | Peak sits at -4.4 dB instead of -1 dB. Safety limiter never engages. Headroom eaten by DC. Mix gets audibly quieter and "thinner" over time. |
| **A6** | **Reverb bus is dead** | `reverbSend.gain.value = 0` in `ensureAudio()`. Convolver + IR buffer allocated but no audio reaches them. | Mix is completely dry. No sense of space. |
| **A7** | **Kick and bass share the same critical band** | Kick sub = 48 Hz. Bass root = 55 Hz (A1). Both occupy the 40–60 Hz critical band. Mix F0 median = 54.5 Hz (bass wins, kick masked). | Kick and bass mask each other. Neither reads as distinct. Real psytrance tunes the kick sub to ~50 Hz and the bass root to ~65–82 Hz (a fifth or octave above) so they don't fight. |
| **A8** | **Kick click dominates the body** | Crest factor 13.95 (real psy: 3–6). Spectral centroid 4143 Hz (real psy: 150–400 Hz). HPSS classifies kick as 99.9 % percussive, 0.03 % harmonic. HNR -35.9 dB. | Kick sounds like a metronome tick on laptop speakers, a soft boom on big speakers. No chest, no punch. The click's 5 kHz highpass overlaps the body's 80 ms window in the FFT. |
| **A9** | **Compressor is set to "glue nothing"** | Threshold -18 dB, ratio 2:1, attack 15 ms, release 120 ms. Mix DR = 18.2 dB (real psy master: 6–9 dB). | Compressor never engages meaningfully. Mix has no loudness glue. |
| **A10** | **Hats are inaudible** | `hatLvl = 0.12`. Hat energy in 8-bar mix: 0.3 %. | Hats don't exist in the mix. No groove, no off-beat energy. |

**Verdict on Reason A:** These are all fixable in 1–2 days of parameter tuning and dead-wire removal. **None of them require an engine swap.** But they have NOT been fixed because the previous "audio reality gates" (F22) measured only aggregate metrics (crest, gap RMS, K/B ratio) that passed while the actual sound stayed broken. The metrics were substitutes for listening.

### Reason B — Architectural ceiling (the deeper crisis)

Even with all 10 bugs above fixed, PSY4's `psyLive.ts` voice functions **cannot** produce the sound of commercial psytrance, because they lack the synthesis techniques the genre requires:

| What psytrance needs | What `psyLive.ts` has | Gap |
|---|---|---|
| **Kick** with pitch envelope + transient layer + body + sub + harmonic excitation + saturation + controlled tail | 3 layers (click + sine-body + sub) | No harmonic excitation layer, no saturation per voice (was removed because of intermod bug), no click/body balance control |
| **Bass** with sub + mid harmonic layer + filter envelope that REOPENS per note + pitch stability + transient click + saturation + dynamic articulation + **upper harmonic movement** | 3 layers (sub + mid osc + noise) but filter envelope is a one-shot close, no upper harmonic movement | No filter LFO, no "rolling" modulation, no second harmonic layer |
| **Lead** with wavetable / FM / PM / sync / unison / filter modulation / envelope modulation / LFO / audio-rate modulation / distortion / resonators / granular | 3-voice unison saw/square/triangle through LPF + waveshaper | **No FM, no wavetable, no PM, no sync, no audio-rate modulation, no LFO, no resonators, no granular.** This is the largest gap. |
| **FX** with samples / granular / processing | None | No FX layer at all |
| **Stereo image, depth, movement** | Hardcoded pan widths, no Haas, no micro-modulation | Mix is flat, narrow, static |

**Verdict on Reason B:** This is architectural. The current `psyLive.ts` lead voice is fundamentally a "test-tone generator with envelope". No parameter tuning will give it FM modulation depth, wavetable scanning, or audio-rate AM. **The architecture must change.**

### The two-reason synthesis

Previous fixes failed because they conflated A and B. F22's "decay tweak" addressed A3 but not A4 (lead has no movement). The "waveshaper removal" addressed intermodulation (a routing bug) but exposed A8 (click dominates because there's no harmonic body to balance it). Every fix moved a number without addressing the architectural ceiling.

**The user's instinct is correct: the system needs to stop being told it's fine. It needs both (a) the parameter bugs fixed AND (b) the architecture upgraded. Doing only (a) leaves it as a "clean test-tone generator". Doing only (b) ports the bugs to a new engine.**

---

## 2. מה מצאת ב־PSY ECOSYSTEM — PSY ECOSYSTEM INVENTORY

**6 PSY projects exist on this filesystem.** 3 are clones. The unique 4:

| Project | Path | What it is | Sound engine |
|---|---|---|---|
| **PSY4** (current) | `/home/z/my-project` | Next.js + Web Audio, radio follower, learning system | `psyLive.ts` (1342 LoC) — 4 voices, simple Web Audio |
| **PSY3** | `/tmp/psy-repos/psy3-clean` | Earlier prototype, Python-based production knowledge | (synth code minimal — mostly docs) |
| **PSY5** | `/tmp/psy-repos/psy5` | Experimental fork | (mostly empty / scratch) |
| **nexus-psy7** | `/tmp/nexus-psy7` | Alternative voice architecture with FM + unison | `voices.ts` (817 LoC) + `pooled-voices.ts` (563 LoC) |
| **psy-foundation** | `/tmp/psy-foundation` | DSP primitives package (PolyBLEP osc, Moog ladder) | `packages/dsp/src/oscillators.ts` (207 LoC) + `filters.ts` (209 LoC) |

**Audio samples:** 185 WAV files — **all of them in PSY4** (`public/samples/`, `public/samples/real/`, `public/phase3/`, `public/phase5/`, `public/audio-quality/`, `audio-artifacts/`). Other 5 projects ship **zero samples** (all synth-only by design).

**Plugins:** Zero VST/CLAP/LV2/AU files anywhere on the filesystem. All 6 projects are 100% Web Audio native.

**Presets/patches:** Zero `.fxp`/`.fxb`/`.clap`/`.lv2` preset files. Synth params are hardcoded in TypeScript.

**Wavetables:** None as discrete files. (PSY4's `advancedVoice.ts` has 8 in-code harmonic recipes — see §4.)

**Reference recordings:** PSY4 has a `public/samples/real/` folder with **real drum-machine samples** (909 kicks, MD kicks/hats/perc/snare/clap/stab/tom/ride, Nord kicks/perc/snare) — 130+ files. These are NOT used by the live synth path. They could be a sample-based layer.

---

## 3. איזה synth/audio engines זמינים לנו — AVAILABLE SYNTH ENGINES

AUDIT-C surveyed 13 candidates. The ones that are **actually installable on this sandbox today** and meet the constraints (programmable + offline-renderable):

| Engine | Installable here? | Programmable interface | Offline WAV render? | Quality ceiling | Effort to wire |
|---|---|---|---|---|---|
| **SuperCollider / scsynth** | `apt install supercollider` (3.13.0 in trixie) | OSC + binary score files; Python via `python-osc` | NRT mode, 50–150× realtime, deterministic | **Highest** — full DSP language: additive/FM/PM/granular/physical/spectral | Medium |
| **Surge XT** | Flatpak (`org.surge_synth_team.surge-xt`) or .deb from surge-synthesizer.github.io | `surge-python` pybind / CLI / OSC | CLI headless render (1.3+) | Very high — wavetable + FM3 + mod matrix | Medium-Large |
| **pedalboard** (already installed v0.9.21) + any VST3 | Already installed | `load_plugin()` + `process()` in Python | Fully offline | As high as the VST3 you load | Small (host is ready; need a VST3) |
| **FluidSynth** | `apt install fluidsynth` | CLI + pyfluidsynth | `fluidsynth -F out.wav sf2 mid` | Medium — sample-based, depends on SoundFont | Small |
| **Pure Web Audio (enhanced)** | Already in use | Direct TypeScript | `OfflineAudioContext` (already proven) | Medium — capped by no FM/wavetable primitives | Small |
| Vital | Source build required (binary is account-gated) | CLI headless in 1.x | Yes | Very high (spectral wavetable) | Large |
| Dexed (standalone) | Build required | MIDI + sysex | Needs VST host | High (DX7 FM) | Medium |
| ZynAddSubFX | `apt install zynaddsubfx` | OSC | NRT mode exists | High (additive+FM) | Medium |
| Carla (LV2/VST host) | **Not in trixie apt** | OSC | Yes | High (universal host) | Blocked |
| `pyo` (Python DSP) | `pip install pyo` | Python | Offline render | Medium-High | Medium |
| `ddsp` / `torchsynth` (differentiable) | `pip install` | Python/PyTorch | Offline render | Research-grade (for synth inversion) | Large |

**Full details:** `audit-reports/AUDIT-C-ALT-SYNTH-ENGINES.md`.

---

## 4. מה מצאת במכשירים/פרויקטים האחרים — FINDINGS IN OTHER PROJECTS

This is the most important section. **PSY4 already contains ~8.3k lines of higher-quality synth code that is dead** — not imported by the live path. The single biggest immediate improvement is to wire it up.

### Top 5 valuable assets found in other PSY projects / dead code

| # | Asset | Path | LoC | What it does that `psyLive.ts` doesn't |
|---|---|---|---|---|
| **1** | **nexus-psy7 FM + unison synth voice** | `/tmp/nexus-psy7/src/lib/audio/voices.ts` + `pooled-voices.ts` | 817 + 563 | Real unison stack (N detuned carriers), FM (modOsc → carrier.frequency with fmRatio/fmDepth), multi-target LFO (cutoff/pitch/fm), per-voice WaveShaper drive. Validated by 51 adversarial tests. |
| **2** | **PSY4 AdvancedSynthVoice (already in repo, just not wired!)** | `/home/z/my-project/src/lib/studio/engine/advancedVoice.ts` | 756 | 4-mode voice: `classic` (back-compat), `fm` (carrier + modulator → metallic goa/acid leads), `supersaw` (3–7 detuned saws with stereo spread), `wavetable` (2 PeriodicWave osc crossfaded by LFO — evolving textures). 8 cached harmonic recipes + 6 crossfade pairs. Lazy node allocation. |
| **3** | **PSY4 multisample generator + layer engine (also unused in-repo)** | `/home/z/my-project/src/lib/studio/engine/multisampleGenerator.ts` + `sampleBank.ts` + `layerEngine.ts` | 524 + 266 + 259 | Procedurally generates 140+ kick/bass/lead/hat/clap variants with acoustic features (centroid, low/mid/high energy, fundamental). Multi-layer voice construction (kick = sub + body + click). Ports PSY3 algorithms (90.7 % sub energy vs PSY4-live's 4.9 %). |
| **4** | **PSY4 commercial reference target database (also unused in-repo)** | `/home/z/my-project/src/lib/studio/engine/commercialReference.ts` | 454 | Per-genre targets (TECHNO/PSYTRANCE/TRANCE/PROGRESSIVE/DARK-PSY/GOA) for LUFS, truePeak, crestFactor, 7-band spectral balance, kick fundamental/subEnergy/bodyEnergy/clickEnergy/decay, bass, lead, hat. Backed by Astrix/Infected Mushroom/Vini Vici/Ajja standards. |
| **5** | **psy-foundation PolyBLEP oscillators + Moog ladder filter** | `/tmp/psy-foundation/packages/dsp/src/oscillators.ts` + `filters.ts` | 207 + 209 | Anti-aliased PolyBLEP osc (Välimäki & Huovilainen 2007) + 4-stage Moog ladder with resonance feedback. Fixes PSY4's documented "harsh lead" problem (92 % high energy vs PSY3's 1.7 %). Requires AudioWorklet or offline-only use. |

### Bonus critical bug discovered

PSY4's `public/phase5/baseline/` directory has 7 "world" renders (goa-111/222/333, progressive-psy-111/222/333, dark-psy-111) with **identical spectral analyses** (peak=0.94, rms=0.16, centroid=578 Hz, stereoW=0.0003). The `world` parameter has **zero audible effect**. Also near-mono (stereo width 0.0003 — `after-stereo-fix.wav` exists alongside, confirming this is a known issue).

---

## 5. מה הבעיה ב־current sound source — PROBLEM WITH CURRENT SOUND SOURCE

The "current sound source" is the 4 voice functions in `psyLive.ts` (lines 481–674). The problems, in priority order:

### P0 — Blocking issues (the mix is broken regardless of voice quality)

1. **Bass bus gain = 0.5 vs kick bus gain = 0.8.** Bass is inaudible. This is a single number that has been wrong for multiple gates.
2. **DC offset accumulates** from `exponentialRampToValueAtTime(0.001, ...)` residuals. Eats headroom, makes the mix get quieter over time.
3. **Reverb send is wired but `gain.value = 0`** — dead routing. Mix is dry.
4. **Kick sub (48 Hz) and bass root (55 Hz) share a critical band.** They mask each other. Needs either kick sub up to ~50 Hz + bass root up to ~65–82 Hz, or a sidechain.

### P1 — Voice-quality issues (the voices are primitive even when audible)

5. **Kick has no harmonic body.** Just click + sine. No "thud" / "punch" / "chest" region (200–800 Hz is 2.6 % of energy). The pitch-drop is scheduled but inaudible because the click dominates the FFT window.
6. **Bass filter envelope is a one-shot close.** It slams from 3448 Hz to 101 Hz in 12 ms and never reopens mid-note. No "rolling" modulation. No upper harmonic layer.
7. **Lead is a static supersaw.** No FM, no wavetable, no LFO, no audio-rate modulation, no resonators. ±7 cents unison is inaudible. The "music" comes only from the motif's pitch sequence, not from the synth's timbre.
8. **No stereo movement.** Hardcoded pan widths. No Haas, no micro-modulation, no autopan.

### P2 — Architectural issues (the engine cannot reach commercial quality)

9. **No FM.** Anywhere. The lead cannot do FM, period.
10. **No wavetable scanning.** The synth has no concept of a wavetable.
11. **No sample layer.** 130+ real drum-machine samples in `public/samples/real/` are unused.
12. **No modulation matrix.** LFOs can't be routed to arbitrary destinations.
13. **No reference-listening loop.** There is no pipeline that takes a reference WAV, extracts its sonic identity, infers synth params, renders, compares, and iterates. The `commercialReference.ts` target database exists but is dead code.

---

## 6. האם current DSP מסוגל להגיע לאיכות הדרושה — CAN CURRENT DSP REACH REQUIRED QUALITY?

### Honest answer: **No — but not for the reason you might think.**

The current DSP (Web Audio voice functions in `psyLive.ts`) **cannot** reach commercial psytrance quality, but **NOT** because Web Audio is fundamentally limited. Web Audio CAN do FM (oscillator → AudioParam scaling), wavetable scanning (PeriodicWave crossfade — see `advancedVoice.ts`), granular (BufferSource grain scheduling), and physical modeling (Karplus-Strong with delay feedback).

The current DSP cannot reach required quality because:

1. **`psyLive.ts` uses only a tiny subset of Web Audio's primitives.** It uses `OscillatorNode`, `GainNode`, `BiquadFilterNode`, `WaveShaperNode`, `ConvolverNode`, `DelayNode`, `NoiseBuffer`. It does NOT use:
   - `PeriodicWave` (for wavetables) — available, unused
   - `OscillatorNode` → `AudioParam.value` modulation (for FM) — available, unused
   - `ConstantSourceNode` (for modulation routing) — available, unused
   - `AudioWorklet` (for custom DSP like PolyBLEP, Moog ladder) — available, unused

2. **The voice functions are 3-osc unison + LPF + waveshaper.** That's a 1990s subtractive synth. Commercial psytrance in 2024 uses FM, wavetable scanning, granular layers, multi-band processing, and often sample layers on top.

3. **There is no path from `SoundDNA` / `SynthRecipe` to the audio graph.** The `timbreToRecipe()` function in `psyLive.ts:538` reduces the 25+ feature `SoundDNA` to 4 numbers (oscType, layers, cutoff, resonance). The other 21+ features are extracted but never reach the audio graph. This was documented in F22 P0-F as "SoundDNA reaches audio graph" — but the wiring is so lossy that it's effectively decorative.

4. **There is no reference-listening pipeline.** The user's stated goal — "PSY4 understands musical intent, selects an appropriate sound architecture, generates a genuinely good sound, renders convincing music" — requires a closed loop: reference → analysis → representation → synthesis → render → compare → iterate. None of these stages are connected end-to-end. The pieces exist (ReferenceAnalyzer, AudioFeatureExtractor, commercialReference targets, SoundDNA, SynthRecipe) but they are not wired into a loop.

### The honest "replace the engine?" question

**The user asked:** "Is the current synthesizer capable of reaching the quality we want? If the answer is no, say so."

**The answer is:**

- **For live browser playback:** Web Audio CAN reach the quality, but only if `psyLive.ts` is rewritten to use FM / wavetable / multi-layer / sample-hybrid voices. The primitives exist. The current voice functions don't use them. **Replace the voice functions, not the engine.**

- **For premium offline renders (reference matching, A/B listening, commercial-quality output):** Web Audio is technically capable but ergonomically poor. A dedicated DSP language like **SuperCollider** would give a 5–10× faster development path for the reference-listening pipeline, with a higher quality ceiling, deterministic offline rendering, and a real DSP language (sclang) for expressing synth architectures. **Replace the engine for the Studio (offline) path; keep Web Audio for live playback.**

- **For the reference → sound inversion pipeline specifically:** Neither bare Web Audio nor SuperCollider alone is sufficient. The pipeline needs (a) a synth that can be parameterized, (b) a renderer, (c) a comparison metric, and (d) a search/optimization loop. SuperCollider + Python (scipy optimization + python-osc) is the most pragmatic stack. `ddsp` (differentiable DSP) is the research-grade option but requires PyTorch and is slower to iterate.

---

## 7. שלוש חלופות ארכיטוניות — THREE ARCHITECTURAL ALTERNATIVES

### Alternative 1 — "Fix and Wire" (minimal change, highest near-term ROI)

**What:** Fix the 10 parameter/routing bugs in `psyLive.ts` (1–2 days). Then wire up the existing-but-dead `AdvancedSynthVoice`, `multisampleGenerator`, `commercialReference`, and `layerEngine` into the live path (1 week). PSY4's music engine (`MusicalSession`) selects a voice mode (classic / fm / supersaw / wavetable) per phrase; the multi-layer kick/bass generator replaces the current 3-layer voices; the commercial reference targets become the critic.

**Stack:** Web Audio only. No new dependencies.

**Pros:**
- Lowest effort. All code already exists in the repo.
- No new install / no new language to learn.
- Live browser playback stays unchanged (Web Audio).
- `AdvancedSynthVoice` already has 4 modes that cover most psytrance lead archetypes.
- `commercialReference.ts` already has Astrix/Vini Vici/IM targets — the critic is pre-built.

**Cons:**
- Web Audio's quality ceiling. Even with FM and wavetable, you can't do anti-aliased PolyBLEP oscillators without AudioWorklet (which is fragile in browsers).
- No reference-listening pipeline. The `commercialReference` targets are static goalposts, not a closed loop.
- The `advancedVoice.ts` code was last touched in F15 and may have rotted.

### Alternative 2 — "Hybrid per-instrument" (the user's Option E)

**What:** Specialize each voice to the best engine for it:
- **Kick** → sample-based from `public/samples/real/md_kick_*.wav` + `909_BD_*.wav` (130+ real kicks exist), with a synth layer for the sub body and pitch envelope. Use a small sample selector that matches the `commercialReference` kick target.
- **Bass** → dedicated psy bass synth: 3-layer (sub + mid osc with filter envelope that REOPENS per note + upper harmonic layer with slow LFO). Either Web Audio or a small Python/SC renderer for offline.
- **Lead** → wavetable/FM engine. Use `AdvancedSynthVoice` in `fm` or `wavetable` mode for live. For offline premium renders, route through SuperCollider.
- **FX** → sample-based from `public/samples/real/md_stab_*.wav` + granular processing.

**Stack:** Web Audio (live) + SuperCollider (offline premium) + sample bank (all paths).

**Pros:**
- Each instrument uses the technique that suits it best (no "one synth fits all" compromise).
- Sample-based kick is **immediately** commercial-quality — real 909/MD kicks are already on disk.
- The hybrid matches how real psytrance is produced (samples + synthesis + processing).
- Decouples live (Web Audio, low-latency) from premium (SC, high-quality).

**Cons:**
- More moving parts. Two engines to maintain.
- Need a clear contract between PSY4's music engine and each voice renderer.
- Sample-based kick loses the "infinite variation" of synth kicks — but real psytrance uses sample packs anyway.

### Alternative 3 — "Replace with SuperCollider" (the user's Option C/D)

**What:** Adopt SuperCollider (`scsynth` NRT mode) as PSY4's sound engine. PSY4's `MusicalSession` generates musical intent (notes, velocities, voice architecture, sound DNA), serializes it to an OSC score file, and `scsynth` renders to WAV offline. Live playback either (a) renders short phrases ahead-of-time and plays them back, or (b) runs `scsynth` in realtime mode locally (requires local audio, not browser).

**Stack:** SuperCollider (sclang + scsynth) + Python (python-osc) + Web Audio (for browser playback of pre-rendered phrases).

**Pros:**
- Highest quality ceiling of any installable option. SuperCollider is a complete DSP language used in commercial psytrance production.
- Deterministic offline render at 50–150× realtime.
- Built-in FM (`PMOsc`), wavetable (`Osc` + buffer), granular (`GrainBuf`), physical modeling (`Pluck`), spectral (`FFT`/`PV`), and modulation matrix (`Patch`).
- The reference-listening pipeline becomes natural: reference WAV → Python analysis → SC patch inference → SC render → Python comparison → iterate. All offline, all scriptable.
- Synthesizer inversion literature uses SC and similar DSP languages as the target.

**Cons:**
- Live browser playback is compromised: either pre-render phrases (loses interactivity) or run scsynth locally (not in a browser).
- SuperCollider is a new language to learn (sclang). Steeper curve than Web Audio.
- Browser users can't hear the music without a server round-trip.
- Higher install footprint (apt install supercollider ~ 200 MB).

---

## 8. השוואה ביניהן — COMPARISON

| Criterion | Alt 1: Fix + Wire | Alt 2: Hybrid per-instrument | Alt 3: Replace with SC |
|---|---|---|---|
| **Effort** | Small (1–2 weeks) | Medium (3–4 weeks) | Large (4–6 weeks) |
| **Sound quality ceiling** | Medium — Web Audio cap | High — samples + best-of-breed per voice | Highest — full DSP language |
| **Live browser playback** | ✅ Unchanged | ✅ Web Audio for live | ⚠️ Compromised (pre-render or local server) |
| **Offline premium render** | ⚠️ Web Audio OfflineAudioContext (works, but limited) | ✅ SC for lead/FX; Web Audio for kick/bass | ✅ Best-in-class |
| **Reference-listening pipeline** | ❌ No closed loop | ⚠️ Partial (sample matching for kick; synth inversion for lead via SC) | ✅ Native fit |
| **New dependencies** | None | `apt install supercollider` + sample bank (already present) | `apt install supercollider` + python-osc |
| **New language to learn** | None | sclang (for SC parts) | sclang (mandatory) |
| **Code already in repo** | ✅ 8.3k LoC of dead synth code reused | ⚠️ Partially — dead code + new sample layer + new SC glue | ❌ Mostly new SC code |
| **Risk** | Low — all code exists | Medium — sample layer + SC glue new | High — new language, new render pipeline |
| **Time to first audible improvement** | 1–2 days (bug fixes) | 1 week (sample-based kick) | 3–4 weeks (SC pipeline) |
| **Matches user's "music engine controls sound engine" requirement** | ✅ Yes — MusicalSession selects voice mode | ✅ Yes — per-instrument contracts | ✅ Yes — OSC score is the contract |
| **Matches user's "reference → sound" inversion goal** | ❌ No | ⚠️ Partial | ✅ Yes |
| **Stuck with Web Audio's limitations** | ✅ Yes | ⚠️ Partially (lead/bass via SC) | ❌ No |

### The forced ranking

- **If the goal is "make PSY4 sound acceptable within 1 week":** Alt 1 wins.
- **If the goal is "make PSY4 sound commercial within 1 month":** Alt 2 wins.
- **If the goal is "build the reference-listening pipeline and reach commercial quality long-term":** Alt 3 wins, but Alt 2 is a stepping stone.

---

## 9. ההמלצה שלך — MY RECOMMENDATION

### Recommendation: **Alt 2 (Hybrid per-instrument), executed in 3 phases, with Alt 3 (SuperCollider) as the medium-term escalation if Alt 2's quality ceiling is still insufficient.**

### Why not Alt 1 alone

Alt 1 (fix bugs + wire dead code) is necessary but not sufficient. It will fix the immediate crisis (DC offset, dead reverb, bass inaudibility) and add FM/wavetable/supersaw leads — but the kick will still be a synth kick (no real sample layer), the bass will still lack the "rolling" character that requires filter-LFO modulation, and there will be no reference-listening pipeline. The user has already rejected this path implicitly by saying "I don't want another round where you change decay, gain, cutoff, waveshaper and tell me all tests pass."

### Why not Alt 3 directly

Alt 3 (replace with SuperCollider) is the highest-quality end state, but jumping there directly has three problems:
1. **It ports the bugs.** If we replace the engine without first fixing the parameter/routing bugs (Reason A), we'll be debugging DC offset and gain mismatch in a new language.
2. **It sacrifices live browser playback.** PSY4's value proposition is the live radio-follower experience in the browser. Pre-rendering phrases breaks that.
3. **It's a 4–6 week bet.** If SuperCollider integration turns out to be harder than expected (sclang learning curve, OSC score generation, sample-accurate timing), we'll have spent a month with no audible improvement.

### Why Alt 2 is the right path

Alt 2 sequences the work correctly:

**Phase 1 (Days 1–2): Bug fixes.** Fix the 10 parameter/routing bugs from AUDIT-A. This is non-negotiable regardless of which Alt we pick. Render A/B WAVs before/after and listen. **Predicted improvement:** mix peak rises from -4.4 dB to ~-1 dB; bass becomes audible; reverb tail appears; DC offset gone.

**Phase 2 (Week 1–2): Wire dead code + sample-based kick.** Wire `AdvancedSynthVoice` (4 modes: classic/fm/supersaw/wavetable) into the lead path. Wire `multisampleGenerator` for bass (3-layer with filter envelope that reopens). For kick, replace the synth-only voice with a hybrid: real sample from `public/samples/real/md_kick_Kicks_*.wav` or `909_BD_*.wav` selected by `commercialReference` target matching, plus a synth sub layer for the body. Wire `commercialReference.ts` as the critic (compare render to target, log the deltas). **Predicted improvement:** kick sounds like a real kick (sample); bass has the "rolling" character (filter LFO + upper harmonic layer); lead has FM/wavetable movement.

**Phase 3 (Week 3–4): Reference-listening pipeline.** Build the closed loop: reference WAV → `AudioFeatureExtractor` → `SoundDNA` → synth param inference (for sample selection + AdvancedSynthVoice mode + filter envelope shape) → render → compare to reference → iterate. Start with the sample-based kick (easiest — pick the sample whose features best match the reference). Then bass (filter envelope inference). Then lead (mode selection + param search). Use `commercialReference.ts` targets as the fallback critic when no reference WAV is provided.

**Phase 4 (Medium-term, only if Phase 3's quality ceiling is insufficient): SuperCollider for premium offline renders.** If the reference-listening pipeline in Phase 3 hits a wall (e.g., "we can match the kick and bass but the lead still sounds weak because Web Audio can't do audio-rate FM cleanly"), then add SuperCollider as the Studio backend for premium renders. Keep Web Audio for live browser playback. This is the user's Option D (hybrid: PSY4 musical engine → external synth → audio) applied selectively to the lead voice.

### The per-instrument specialization (the user's Option E)

Within Alt 2, each instrument gets the technique that suits it:

| Voice | Live (browser) | Offline (premium) | Why |
|---|---|---|---|
| **Kick** | Sample playback from `public/samples/real/` + synth sub layer | Same (sample is sample) | Real kicks are sample-based in 99% of psytrance. We have 130+ real samples. Use them. |
| **Bass** | Web Audio 3-layer (sub + mid osc with filter envelope + upper harmonic LFO) | Same, or SuperCollider for premium | Web Audio can do this if we fix the filter envelope. SC adds Moog ladder filter quality. |
| **Lead** | `AdvancedSynthVoice` in fm / supersaw / wavetable mode | SuperCollider for premium | Web Audio's FM (via AudioParam scaling) is OK for live; SC's `PMOsc` is cleaner for offline. |
| **Hats / perc** | Sample playback from `public/samples/real/md_hat_*.wav` + `md_perc_*.wav` | Same | Real hats are sample-based. We have 50+ real samples. |
| **FX / stabs** | Sample playback from `public/samples/real/md_stab_*.wav` | Same + granular processing in SC | Stabs are sample-based. Granular is a premium enhancement. |

### What this recommendation is NOT

- **Not** "keep tweaking `psyLive.ts` parameters." The voice functions must be replaced, not tuned.
- **Not** "install Surge XT and call it a day." Surge XT is excellent but adds a Flatpak/binary dependency and a Python pybind layer that's fragile. Sample-based + AdvancedSynthVoice covers 80% of the quality gain at 20% of the effort.
- **Not** "rewrite everything in SuperCollider." That's the medium-term escalation, not the starting point.
- **Not** "build a differentiable DSP system." `ddsp` / `torchsynth` are research-grade and too slow to iterate on for production.

### The single sentence

**Fix the 10 parameter bugs first (2 days), then wire up the 8.3k lines of dead synth code already in the repo plus the 130+ unused real drum-machine samples (2 weeks), then build the reference-listening pipeline on top of that (2 weeks). If the quality ceiling is still insufficient after that, add SuperCollider as the Studio backend for premium offline lead renders — but only then.**

---

## 10. ניסוי קטן שמוכיח את ההמלצה — THE PROVING EXPERIMENT

### Experiment: PSY4-AUDIT-EXP — Three-way A/B/C render comparison

**Goal:** Prove (or disprove) that Alt 2 (fix bugs + wire dead code + sample-based kick) produces measurably better sound than the current engine, and that the improvement justifies the effort before considering SuperCollider.

**Setup:**
- Same MIDI, same BPM (145), same rhythm, same arrangement: a 4-bar kick + bass + lead phrase using the `rolling_bass` preset's pattern.
- Same render path: `web-audio-api` OfflineAudioContext at 44.1 kHz mono.
- Same analysis: `librosa` + `scipy` + the `commercialReference.ts` PSYTRANCE targets.

**Three renders:**

| Render | Engine | Description |
|---|---|---|
| **X (baseline)** | Current `psyLive.ts` | As-is. (Already have `AUDIT-C-kickbass.wav` and `AUDIT-E-8bar.wav`.) |
| **Y (bugfix)** | `psyLive.ts` + 10 bug fixes | Fix A1–A10 from §1: bass bus 0.5→0.8, reverbSend 0→0.3, DC blocker on kick body, bass filter envelope reopens per note (add `setValueAtTime(fStart, t)` reset + slow LFO), lead unison ±7→±15 cents + add slow filter LFO (0.5 Hz, depth 200 Hz), comp -18→-10 threshold + 2:1→4:1 ratio, kick sub 48→50 Hz + bass root 55→73 Hz (decritical-band), hat level 0.12→0.25, click gain 0.4→0.2. |
| **Z (engine upgrade)** | Y + `AdvancedSynthVoice` lead (fm mode) + `multisampleGenerator` bass (3-layer with filter LFO) + sample-based kick (pick best-matching `md_kick_Kicks_*.wav` by `commercialReference` target) | The Alt 2 Phase 2 deliverable. |

**Metrics (computed on each render):**

1. **Spectral match to `commercialReference.ts` PSYTRANCE target** — Euclidean distance over the 7-band spectral balance vector. Lower = closer to commercial target.
2. **Crest factor** — target 3–6 (current: 13.95).
3. **Spectral centroid** — target 150–400 Hz for kick, 180–400 Hz for bass, 800–3000 Hz for lead (current: 4143 / 243 / 1450).
4. **Midrange energy %** — target 8–18 % lo-mid, 2–6 % mid (current: 2.6 % / 0.1 % for kick).
5. **DR (dynamic range)** — target 6–9 dB (current: 18.2 dB).
6. **LUFS** — target -10 to -14 (current: -28).
7. **CED classifier** — does the AI tag it as "Music" / "Techno" / "Drum" with > 0.5 confidence?
8. **Kick/bass separation** — gap RMS between kick hits and bass notes (current: needs measurement; target < 0.01 = clean separation).
9. **Human A/B listening** — provide X, Y, Z WAVs for the user to listen to. The user's ears are the final critic.

**Prediction:**

| Metric | X (baseline) | Y (bugfix) | Z (engine upgrade) |
|---|---|---|---|
| Spectral distance to target | ~3.5 | ~2.2 | ~1.2 |
| Crest (kick) | 13.95 | ~6 | ~4 |
| Centroid (kick) | 4143 Hz | ~800 Hz | ~300 Hz |
| Midrange % (mix) | 2.6 % | ~8 % | ~12 % |
| DR | 18.2 dB | ~10 dB | ~7 dB |
| LUFS | -28 | ~-18 | ~-12 |
| CED "Music" confidence | < 0.5 | ~0.6 | ~0.8 |
| Kick/bass gap RMS | (measure) | < 0.02 | < 0.01 |

**Decision rule:**
- If Z passes the `commercialReference.ts` PSYTRANCE targets within 20 % on every metric AND the user's ear confirms Z sounds "like music, not a test tone" → Alt 2 is validated. Proceed to Phase 3 (reference-listening pipeline).
- If Z improves over X but still misses targets by > 20 % on any metric → the Web Audio ceiling is the bottleneck. Escalate to Alt 3 (SuperCollider) for that voice.
- If Y ≈ Z (bug fix alone gives most of the improvement) → the architecture isn't the bottleneck; the parameter bugs are. Reconsider whether Alt 2's Phase 2 (engine upgrade) is worth the effort, or whether to ship Alt 1 (fix and wire) and move directly to Phase 3 (reference-listening pipeline).

**Cost:** ~4 hours of dev work (1 hour per render + 1 hour analysis + 1 hour writeup). No new dependencies. No engine swap. The experiment uses only code that already exists in the repo + parameter changes.

**This experiment is the smallest possible proof of the recommendation. It does not commit to any engine swap. It produces 3 WAVs the user can listen to. It measures against the `commercialReference.ts` targets that already exist. It has a clear decision rule for what to do next.**

---

## HARD STOP — END OF INVESTIGATION

No code was modified. No engine was installed. No tests were written. The 3 AUDIT reports + 6 WAV artifacts + this synthesis document are the deliverable.

**Files produced:**
- `audit-reports/AUDIT-A-SONIC-CRITIQUE.md` — sonic critique with DSP evidence
- `audit-reports/AUDIT-B-PSY-ECOSYSTEM-INVENTORY.md` — PSY ecosystem inventory
- `audit-reports/AUDIT-C-ALT-SYNTH-ENGINES.md` — alternative synth engine research
- `audit-reports/PSY4-AUDIO-QUALITY-CRISIS-VERDICT.md` — this synthesis document
- `audio-artifacts/AUDIT-{A,B,C,D,E,F}-*.wav` — 6 real PCM renders for human A/B listening

**Awaiting user decision:**
1. Approve the recommendation (Alt 2, phased, with Alt 3 as escalation)?
2. Approve the experiment (PSY4-AUDIT-EXP, ~4 hours, 3 WAVs)?
3. Or redirect to a different path?

Until the user decides, no further work will be done.
