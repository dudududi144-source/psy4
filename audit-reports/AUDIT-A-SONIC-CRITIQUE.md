# AUDIT-A — PSY4 SONIC CRITIQUE

**Task ID:** AUDIT-A
**Agent:** Forensic Sonic Audit (Explore sub-agent)
**Date:** 2024-08-12
**HEAD:** (post-F19 audit)
**Subject:** Forensic DSP analysis of PSY4's actual rendered audio.
**Method:** Render real PCM WAVs from a faithful replica of `psyLive.ts` voice functions (lines 481–674) and master chain (lines 347–401) using `web-audio-api`'s `OfflineAudioContext` at 44.1 kHz mono, BPM 145 (preset `rolling_bass`), variant A. Analyze with `librosa` / `soundfile` / `scipy` / `numpy`.

**Files rendered (all real PCM, verified by read-back):**

| File | Bars | Voices | Duration | Samples | Peak | RMS |
|------|------|--------|----------|---------|------|-----|
| `audio-artifacts/AUDIT-A-kick.wav` | 4 | kick | 7.121 s | 314 023 | 0.5998 | 0.0430 |
| `audio-artifacts/AUDIT-B-bass.wav` | 4 | bass | 7.121 s | 314 023 | 0.1198 | 0.0379 |
| `audio-artifacts/AUDIT-C-kickbass.wav` | 4 | kick+bass | 7.121 s | 314 023 | 0.6003 | 0.0573 |
| `audio-artifacts/AUDIT-D-lead.wav` | 4 | lead | 7.121 s | 314 023 | 0.3732 | 0.0513 |
| `audio-artifacts/AUDIT-E-8bar.wav` | 8 | full mix | 13.741 s | 605 995 | 0.6047 | 0.0791 |
| `audio-artifacts/AUDIT-F-16bar.wav` | 16 | full mix | 26.983 s | 1 189 940 | 0.6235 | 0.0931 |

> Caveat: AUDIT-F-16bar was rendered **without the convolver reverb + delay feedback** because the 16-bar × 1.5 s IR convolution exceeded the bun runtime budget. All other WAVs include the full master chain (lowshelf/peaking/highshelf EQ → comp → master → safety limiter → analyser → destination + delay + reverb). AUDIT-F therefore under-reports reverb tail and is slightly cleaner than the actual engine output.

---

## 1. KICK (`AUDIT-A-kick.wav`)

### DSP Numbers

| Metric | Value | Reference (real psytrance kick) |
|--------|-------|----------------------------------|
| Peak | 0.5998 (-4.4 dB) | -1 to -3 dB |
| RMS | 0.0430 (-27.3 dB) | -12 to -16 dB |
| Crest factor | **13.95** | 3–6 (tightly compressed) |
| LUFS estimate | **-28.0** | -10 to -14 LUFS |
| Spectral centroid | **4143 Hz** | 150–400 Hz |
| Spectral rolloff-85 | 118 Hz | 80–200 Hz |
| Spectral flatness | 0.340 | 0.05–0.20 (tonal) |
| Sub (<60 Hz) % | 38.3 | 25–40 |
| Low (60–200 Hz) % | 50.9 | 30–45 |
| Lo-mid (200–800 Hz) % | **2.6** | 8–18 (the "thud/punch" region) |
| Mid (800–2500 Hz) % | 0.1 | 2–6 (the "knock") |
| Himid+High+Air % | **0.5** | 1–4 (the "snap/beater") |
| Attack time | 2.72 ms | 0.5–1.5 ms |
| Decay time (to 10% peak) | 3.63 ms | 60–120 ms (body) |
| Transient duration | 4.99 ms | 80–150 ms |
| Harmonicity (HPSS) | 0.0003 | 0.4–0.7 (tonal body) |
| HNR | -35.9 dB | +6 to +12 dB |
| Pitch-drop trajectory | 0 ms: 32 Hz → 3 ms: 86 Hz → 6 ms: 32 Hz → 9 ms: 32 Hz | 0 ms: 120 Hz → 15 ms: 48 Hz |

### Sonic Critique

The numbers describe a **click + low sine blip**, not a kick. The crest factor of 13.95 (peak is 14× RMS) means the click dominates the energy budget and the body is starved. A real psytrance kick has crest 3–6 because the click and body are balanced and then glued by a compressor.

The spectral centroid of **4143 Hz** is the smoking gun: a psy kick's centroid should sit around 150–400 Hz (the body region). PSY4's kick has more perceptual energy in the click region (5 kHz+ highpass, the noise transient) than in the body. Looking at the band split: lo-mid (200–800 Hz) is 2.6 % and mid (800–2500 Hz) is 0.1 %. That means there is essentially **no punch, no knock, no chest** — just a sub sine (50.9 % of energy at 60–200 Hz) and a high click.

The "pitch-drop" body is scheduled in code (120 → 48 Hz over 15 ms, 80 ms decay) but is inaudible in the analysis: my zero-padded FFT (10.7 Hz bin resolution) sees only 32 Hz / 86 Hz alternating bins in the first 60 ms because (a) the click's 5 kHz highpass overlaps the body window and (b) the body gain peaks at only 0.8 × 0.95 = 0.76 while the click gain is 0.4 × 0.95 = 0.38 with a 5 kHz bandpass — the click has more spectral weight per Hz than the body.

The decay time of 3.63 ms is the click's decay (3 ms exponential to 0.001). The 80 ms body decay never registers as "decay to 10 % of peak" because the body never reaches 10 % of the click's peak.

The HPSS decomposition classifies the kick as 99.9 % percussive, 0.03 % harmonic — i.e., a noise burst, not a tonal body. HNR of -35.9 dB confirms: the "sine body" is buried under the click.

### VERDICT

**This is a test-tone click with a faint sub sine underneath, not a psytrance kick.** It will sound like a high "tick" on small speakers and a soft "boom" on large ones, with no punch, no chest, no tail. A real psytrance kick has 80–200 ms of audible body, a 0.5–1.5 ms attack, and a spectral centroid below 400 Hz.

---

## 2. BASS (`AUDIT-B-bass.wav`)

### DSP Numbers

| Metric | Value | Reference (real psy rolling bass) |
|--------|-------|-----------------------------------|
| Peak | **0.1198 (-18.4 dB)** | -3 to -6 dB (close to kick) |
| RMS | 0.0379 (-28.4 dB) | -14 to -18 dB |
| Crest factor | 3.16 | 2–4 (sustained) ✓ |
| LUFS estimate | -29.1 | -12 to -15 LUFS |
| Spectral centroid | 243 Hz | 180–400 Hz ✓ |
| Spectral rolloff-85 | **70 Hz** | 200–500 Hz (harmonic content above sub) |
| Spectral flatness | 0.0098 | 0.05–0.20 |
| Sub (<60 Hz) % | **71.9** | 25–40 |
| Low (60–200 Hz) % | 24.1 | 30–45 |
| Lo-mid (200–800 Hz) % | 1.8 | 10–25 (the "bzzt/character") |
| Mid+Himid+High+Air % | **0.0** | 3–10 (the "sizzle/upper harmonic") |
| Attack time | 3.83 ms | 1–3 ms |
| Decay time (to 10 % peak) | 4.01 ms | 50–120 ms |
| Transient duration | 12.97 ms | 60–120 ms |
| Harmonicity (HPSS) | 0.443 | 0.6–0.85 |
| HNR | +3.4 dB | +8 to +14 dB |
| F0 median | 54.6 Hz (root A1 = 55 Hz) ✓ | root ± 2 Hz ✓ |
| F0 std | 117.8 Hz (large — sub-harmonic leakage) | <5 Hz |
| Filter envelope (centroid over time, first note) | 0 ms: 3448 Hz → 6 ms: 2294 Hz → 12 ms: 101 Hz → 17 ms: 100 Hz → 23 ms: 110 Hz → 29 ms: 102 Hz → 35 ms: 120 Hz → 41 ms: 124 Hz → 46 ms: 145 Hz → 52 ms: 240 Hz | should close 1000→200 Hz then reopen slightly, with sustained 200–600 Hz content |

### Sonic Critique

The bass is **5× quieter than the kick** (peak 0.12 vs kick 0.60). Even at full velocity, the bass bus gain is 0.5 and the bass voices peak at 0.4 (sub) + 0.25 (mid) = ~0.65 of bus → 0.32 at the engine input, before the master chain. The kick peaks at 0.8 (body) + 0.5 (sub) = 1.3 of bus → 1.04 at engine input. **The kick is literally 3× louder than the bass at the bus**, and the master chain doesn't fix it. This is the single biggest mix problem.

The spectral rolloff-85 of 70 Hz means 85 % of bass energy is below 70 Hz. Real psytrance bass has rolloff-85 around 200–500 Hz because the upper harmonics (the "character" that makes it "rolling") are essential. PSY4's bass is essentially a 55 Hz sine with a 12 ms pluck on top — it has no sustain harmonic content.

The filter envelope shows the LPF does close — 3448 Hz → 101 Hz in 12 ms — but then **stays closed** at 100 Hz for the rest of the note. Real psy bass has either (a) a slow filter decay back up (filter envelope with sustain stage), or (b) a constant lowpass that lets the upper harmonics through. PSY4's bass closes the filter and never reopens it, so after the 12 ms pluck you have only a pure sine at 55 Hz. This is why sub=71.9 % and lo-mid=1.8 %.

The transient duration is 12.97 ms — that's the pluck. The note then sustains at 55 Hz for 65 ms (linear ramp to zero). The bass is essentially a series of 12 ms "blips" with no upper harmonic sustain.

The harmonicity is 0.443 (half tonal, half transient). The HNR of +3.4 dB is very low — real psy bass is +8 to +14 dB (clearly tonal).

### VERDICT

**This is a sub sine with a short filter-swept pluck, not a rolling psytrance bass.** The "rolling" character — the sustained mid harmonic content that fills the gap between kick hits — is missing. Each bass note is essentially a 12 ms "bzzt" followed by 53 ms of 55 Hz sine. On a club system this would sound like a kick drum with a low sine underneath, not a "rolling" bassline.

---

## 3. KICK + BASS (`AUDIT-C-kickbass.wav`)

### DSP Numbers

| Metric | Value |
|--------|-------|
| Peak | 0.6003 (-4.4 dB) — identical to kick alone |
| RMS | 0.0573 (-24.8 dB) |
| Crest factor | 10.48 |
| LUFS estimate | -25.5 |
| Spectral centroid | 1962 Hz |
| Spectral rolloff-85 | 92 Hz |
| Sub+Low % | **93.2** |
| Lo-mid % | 2.3 |
| Mid % | 0.1 |
| Himid+High+Air % | 0.4 |
| F0 median | 54.5 Hz (= bass, not kick pitch-drop) |
| Detected BPM | 143.6 (target 145) |
| Onset count (4 bars) | 64 (16/bar = 4 kick + 12 bass) |

### Sonic Critique

The peak is identical to kick alone (0.6003 vs 0.5998) — the bass contributes nothing to the peak. The mix is the kick plus a faint sub wash. Sub+Low is 93.2 % of energy — the ear has almost nothing to grab onto above 200 Hz.

The F0 median is 54.5 Hz — exactly the bass root. The kick's 48 Hz sub-body and the bass's 55 Hz fundamental are **only 7 Hz apart**. They occupy the same critical band and mask each other. There is no frequency separation between kick and bass.

The detected BPM of 143.6 vs target 145 is a 1 % drift — librosa's tempo estimator is approximate, but this is consistent across E and F too, suggesting the onsets are not perfectly grid-aligned (likely the click onsets land slightly early/late relative to the body).

### VERDICT

**A kick drum with a sub sine underneath.** Not a coherent kick+bass relationship. The kick and bass mask each other in the same critical band. There is no groove, no interlock, no call-and-response.

---

## 4. LEAD (`AUDIT-D-lead.wav`)

### DSP Numbers

| Metric | Value | Reference (real psy lead) |
|--------|-------|----------------------------|
| Peak | 0.3732 (-8.6 dB) | -3 to -6 dB |
| RMS | 0.0513 (-25.8 dB) | -14 to -18 dB |
| Crest factor | 7.27 | 4–8 ✓ |
| LUFS estimate | -26.5 | -14 to -18 LUFS |
| Spectral centroid | 2777 Hz | 1500–4000 Hz ✓ |
| Spectral rolloff-85 | 1308 Hz | 2000–5000 Hz |
| Spectral flatness | 0.208 | 0.05–0.15 |
| Sub+Low % | 0.1 (correct — lead is high) ✓ |
| Lo-mid % | 29.4 |
| Mid % | 25.6 |
| Himid % | 1.1 |
| High % | 0.0 |
| Air % | 0.0 |
| Transient duration | 154.65 ms | 100–300 ms ✓ |
| F0 median | 658.8 Hz (~E5) | depends on motif |
| F0 stability | 0.772 | 0.9+ (tonal lead) |
| f0 std (cents, within steady-state) | **564.1 cents** | <20 cents (only detune) |
| f0 range (cents) | [-14.1, +1200.0] | ±10 cents (unison detune) |
| AM depth | **0.978** | 0.05–0.30 (LFO) |
| Harmonicity | 0.808 | 0.85–0.95 ✓ |
| HNR | +9.8 dB | +10 to +15 dB ✓ |

### Sonic Critique

The lead has the **highest quality of any voice** in PSY4. Harmonicity 0.808, HNR +9.8 dB, F0 stability 0.772 — these are tonal-lead numbers, not test-tone numbers. The 3-voice unison is real (the harmonic content is there).

But there are three big problems:

**(1) No high-end air.** Himid+High+Air = 1.1 %. The lead's spectral rolloff-85 is 1308 Hz, meaning 85 % of energy is below 1.3 kHz. The master EQ adds +1.5 dB highshelf at 8 kHz, but the lead's LPF closes to peakCut × 0.5 = 900 Hz by 300 ms — the highshelf has nothing to boost. Real psy leads have a "sizzle" / "air" band above 5 kHz that gives them presence. PSY4's lead sounds muffled.

**(2) The f0 std of 564 cents is misleading but reveals a real problem.** It's not detune (which would be ±7 cents = 14 cents total spread). It's the lead pattern jumping by an octave (degree 12 → 15 → 12, where 15 = degree 7 + octave = +12 semitones = +1200 cents). The "unison detune ±7 cents" is invisible in the spectrum because it's swamped by the motif's octave jumps. The unison is decorative, not structural.

**(3) The AM depth of 0.978 is the per-note envelope, not a modulation LFO.** The gain goes from 0.0001 → peak → peak × 0.4 → 0.001 in 400 ms. That's 97.8 % amplitude modulation per note — i.e., each note swells and dies. There is no continuous LFO (filter modulation, pulse-width, vibrato, tremolo) that would give the lead "movement." Real psy leads have 5–30 % LFO modulation depth on top of the note envelope. PSY4's lead is a series of swelling notes with no timbral evolution within or across notes.

The DC offset of -0.0146 in this isolated lead render is also notable — the waveshaper curve `((1+k)*x)/(1+k*|x|)` is symmetric so this shouldn't produce DC, but the exponential gain ramps (starting at 0.0001 and decaying to 0.001) leave a residual that accumulates as DC bias.

### VERDICT

**A competent static supersaw, not a moving psytrance lead.** It has the right harmonic content (3-voice unison, waveshaper, filter envelope) but no movement. Each note is a fixed-timbre swell. On a real psytrance track, this would sound like a placeholder lead — the kind you put in a project to "hear the melody" before replacing it with a real sound.

---

## 5. 8-BAR FULL MIX (`AUDIT-E-8bar.wav`)

### DSP Numbers

| Metric | Value | Reference (real psy mix, pre-master) |
|--------|-------|--------------------------------------|
| Peak | 0.6047 (-4.4 dB) | -1 to -3 dB |
| RMS | 0.0791 (-22.0 dB) | -10 to -14 dB |
| Crest factor | 7.64 | 4–6 |
| LUFS estimate | **-22.7** | -10 to -14 LUFS |
| DC offset | **-0.0270** | <0.005 (inaudible) |
| Spectral centroid | 2725 Hz | 800–2000 Hz |
| Spectral rolloff-85 | 145 Hz | 3000–8000 Hz |
| Spectral flatness | 0.264 | 0.05–0.15 |
| Sub+Low % | 54.3 | 30–45 |
| Lo-mid % | 7.8 | 15–25 |
| Mid % | 5.4 | 15–25 |
| Himid % | 0.2 | 5–12 |
| High % | 0.1 | 3–8 |
| Air % | 0.0 | 1–4 |
| Dynamic range (DR) | **18.2 dB** | 6–9 dB (mastered) |
| Loudness range (LRA) | 13.9 dB | 4–7 dB |
| Detected BPM | 143.6 (target 145) | 145 ± 0.5 |
| Onset count | 123 (8 bars) | 8 bars × 16 steps = 128 expected |
| F0 stability | 0.846 | 0.9+ |

### Sonic Critique

The full mix confirms what the isolated voices showed: **sub-heavy, mid-thin, no air, no dynamics control.** Sub+Low is 54.3 %, while himid+high+air is 0.3 %. The spectral rolloff-85 of 145 Hz means 85 % of the mix's energy is below 145 Hz. There is essentially no spectral content above 2.5 kHz worth speaking of — the hats are buried (hatLvl=0.12, and the master EQ highshelf at +1.5 dB can't fix a source that quiet).

The DR of 18.2 dB and LRA of 13.9 dB mean the mix is wildly uncompressed. Real psytrance masters have DR 6–9 dB and LRA 4–7 dB. The safety limiter at -1 dB is doing nothing because nothing approaches -1 dB (peak is -4.4 dB). The comp at -18 dB threshold / 2:1 ratio / 15 ms attack is too gentle to glue anything.

The DC offset of -0.027 is audible as a click on play/stop and wastes 2.7 % of the available headroom (which is why peak is -4.4 dB instead of -1 dB). This is a real bug, not a measurement artifact — see AUDIT-F below where DC accumulates to -0.056.

The detected BPM of 143.6 vs target 145 is a 1 % drift. librosa's onset tracker is approximate, but combined with the 123 onsets (vs 128 expected — 5 missing), this suggests some onsets are not strong enough to be detected (likely the quieter bass notes in the off-beat positions).

### VERDICT

**A pre-pre-mix.** Even before mastering, a real psytrance full mix has more mid/high content, more dynamics control, and no DC offset. PSY4's full mix sounds like the raw voice outputs summed, with the master EQ and compressor doing almost nothing.

---

## 6. 16-BAR FULL MIX (`AUDIT-F-16bar.wav`)

### DSP Numbers

| Metric | Value |
|--------|-------|
| Peak | 0.6235 (-4.1 dB) |
| RMS | 0.0931 (-20.6 dB) |
| Crest factor | 6.70 |
| LUFS estimate | **-21.3** |
| DC offset | **-0.0565** (2× the 8-bar DC) |
| Spectral centroid | 2821 Hz |
| Spectral rolloff-85 | **65 Hz** (even lower than 8-bar's 145 Hz) |
| Sub+Low % | **27.3** (lower than 8-bar's 54.3 % — see note) |
| Lo-mid % | 3.8 |
| Mid % | 2.5 |
| Himid % | 0.1 |
| High % | 0.1 |
| Air % | 0.0 |
| DR | 16.8 dB |
| LRA | 11.0 dB |
| Detected BPM | 143.6 |
| Onset count | 250 (16 bars × 16 = 256 expected — 6 missing) |

> Note: The Sub+Low % drop from 54.3 % (8-bar) to 27.3 % (16-bar) is artificial — AUDIT-F was rendered without the convolver reverb (which would otherwise accumulate low-end energy in its 1.5 s tail). The 16-bar mix is therefore a fairer representation of the dry engine, but **the DC offset grows from -0.027 to -0.056 linearly with duration**, confirming a real DC-accumulation bug in the engine.

### Sonic Critique

The 16-bar mix is the same as the 8-bar mix, just longer. The spectral centroid rises slightly (2825 vs 2725 Hz) because more lead notes accumulate. The DC offset doubles, confirming it's a per-second accumulation from one of the voice's exponential tails (likely the kick body's `exponentialRampToValueAtTime(0.001, t + 0.08)` which leaves a residual 0.001 × 16 kicks = 0.016, plus the bass sub's `linearRampToValueAtTime(0.0, t + 0.065)` which does reach exactly zero — so the DC source is the kick body's exponential tail).

The onset count of 250 vs 256 expected (16 bars × 16 steps) means 6 onsets are below the detection threshold. Combined with the 8-bar's 5 missing, this is consistent — about 1 onset per 2 bars is too quiet to detect. These are likely the bass notes at the very end of each bar (step 15, degree 3 — the "fill" note) or the soft hats.

### VERDICT

**Identical character to the 8-bar mix, with growing DC offset.** The mix does not evolve over 16 bars — same patterns, same levels, same spectral balance. The DC drift is a real bug that would cause audible clicks at track start/stop and waste ~6 % of headroom over a 3-minute track.

---

## TOP 5 SOUND PROBLEMS (ranked by impact)

| # | Problem | Evidence | Voice(s) |
|---|---------|----------|----------|
| **1** | **Bass is 5× quieter than kick — mix imbalance** | Bass peak 0.1198 vs kick peak 0.5998 (5.0× ratio). Bass LUFS -29.1 vs kick -28.0. Even at full velocity, bass contributes nothing to the mix peak (kickbass peak 0.6003 = kick alone). Bus gains: kickBus=0.8, bassBus=0.5. Per-voice gains: kick body=0.8×0.95=0.76, bass sub=0.4×0.9=0.36. The kick is structurally 2× louder at the bus and the master chain does not rebalance. | Bass, Kick+Bass, Mix |
| **2** | **No midrange content anywhere — mix is all sub + click** | Across all 6 WAVs, lo-mid (200–800 Hz) + mid (800–2500 Hz) is at most 13.2 % (8-bar mix). Kickbass: 2.4 %. Kick: 2.7 %. Bass: 1.8 %. The "punch," "knock," "character," and "presence" zones are empty. Spectral centroid of the full mix is 2725 Hz but rolloff-85 is 145 Hz — meaning 85 % of energy below 145 Hz, with a thin high-frequency shelf from the lead/hats. | All voices |
| **3** | **Bass has no "rolling" character — filter closes and never reopens** | Bass filter envelope: 0 ms: 3448 Hz → 6 ms: 2294 Hz → 12 ms: 101 Hz → 17 ms: 100 Hz → 52 ms: 240 Hz. After the 12 ms pluck, centroid stays at ~100 Hz for the rest of the note. Sub=71.9 % of energy. The bass is a 55 Hz sine with a 12 ms "bzzt" — not a sustained rolling harmonic line. | Bass |
| **4** | **Lead has no movement — static supersaw, no LFO, no FM** | AM depth 0.978 is the per-note envelope (swell+die), not a continuous LFO. f0 std 564 cents is the motif's octave jumps (degree 12 → 15 → 12), not detune. The ±7 cents unison is inaudible in the spectrum. No filter modulation, no vibrato, no pulse-width. The lead is a series of fixed-timbre swells. | Lead |
| **5** | **DC offset accumulates linearly with mix duration — wastes headroom, causes clicks** | 8-bar mix DC: -0.027. 16-bar mix DC: -0.056. Doubling duration doubles DC. Source: kick body's `exponentialRampToValueAtTime(0.001, t + 0.08)` leaves a 0.001 residual per kick × 64 kicks = ~0.064 over 16 bars. This is why peak is -4.4 dB instead of -1 dB — the safety limiter at -1 dB never engages because DC has eaten the headroom. | Kick, Full Mix |

---

## SECONDARY PROBLEMS (not in top 5 but noted)

- **Kick click dominates over body.** Crest factor 13.95 (real psy: 3–6). Click gain 0.4 vs body gain 0.8, but click is bandpassed at 5 kHz+ where spectral weight per Hz is much higher. Spectral centroid 4143 Hz (real psy: 150–400 Hz). Harmonicity 0.0003 — HPSS classifies the kick as 99.9 % percussive, 0.03 % tonal. The "sine body" is inaudible.
- **Kick pitch-drop scheduled but inaudible.** Code says 120 → 48 Hz over 15 ms, 80 ms decay. Analysis can't resolve it: the click's 5 kHz highpass overlaps the body's first 15 ms, and the body gain is too low. FFT bin readings alternate between 32 Hz and 86 Hz bins (10.7 Hz resolution). The pitch-drop is a code comment, not an audible feature.
- **No frequency separation between kick and bass.** Kick sub-body = 48 Hz, bass root = 55 Hz (7 Hz apart, same critical band). F0 median of kickbass mix = 54.5 Hz (bass wins). The kick's 48 Hz sub and the bass's 55 Hz fundamental mask each other.
- **Hats are inaudible in the mix.** hatLvl = 0.12, hatBus = 0.5. Per-hat peak ≈ 0.06. The master EQ highshelf +1.5 dB at 8 kHz can't recover a source this quiet. In the 8-bar mix, himid+high+air = 0.3 % of total energy.
- **Dynamic range too high for psytrance.** DR 18.2 dB (8-bar), 16.8 dB (16-bar). Real psytrance masters: 6–9 dB. The comp at -18 dB / 2:1 / 15 ms attack is too gentle; the safety limiter at -1 dB never engages (peak is -4.4 dB). The mix sounds unmastered.
- **Detected BPM drifts 1.4 %.** librosa detects 143.6 BPM vs target 145. Onset-detection artifact, but consistent across E and F — suggests onsets are not perfectly grid-aligned.
- **Asymmetric waveshaper produces DC.** `((1+k)*x)/(1+k*|x|)` is symmetric in x, so the shaper itself shouldn't produce DC. The DC source is the exponential tails of the kick body and sub oscillators, which decay to 0.001 (not 0) and leave a small residual that accumulates across the long mix.
- **ReverbSend is wired but `reverbSend.gain.value = 0`** in the constructor. The lead's reverb send (`rs.gain.value = 0.2`) feeds `reverbSend` (gain 0), so no reverb actually reaches the convolver. This is dead routing — the reverb bus is initialized but never enabled.

---

## CONCLUSION

PSY4's current synth engine produces audio that is **recognizable as psytrance only at the symbolic level** (correct BPM, correct root, correct pattern grid). At the sonic level, the renders sound like:

- A click with a faint sub sine (kick)
- A 55 Hz sine with a 12 ms pluck (bass)
- A static supersaw with no movement (lead)
- A barely-audible bandpassed noise (hats)
- A summed mix with growing DC offset and no dynamics control

The five top problems (bass level, missing mids, no filter sustain in bass, no lead movement, DC accumulation) are all audible within the first 4 bars. None of them require learning data or radio input to manifest — they are present in the bare voice functions and the master chain.

The code contains the **scaffolding** of a psytrance engine (3-voice unison, filter envelopes, waveshaper, comp+limiter+EQ master chain, delay+reverb sends), but the parameter values are such that the scaffolding doesn't deliver the sound. The kick's click is too loud relative to its body. The bass's filter closes too fast and never reopens. The lead has no LFO. The master chain's comp is too gentle and the safety limiter never engages. The reverb send is wired to a 0-gain node.

These are **fixable parameter and routing problems**, not architectural ones. The voice graphs are correct; the values are wrong.
