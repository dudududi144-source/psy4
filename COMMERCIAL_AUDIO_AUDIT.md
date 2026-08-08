# COMMERCIAL AUDIO AUDIT — PSY4

## תאריך: 2026-08-08
## מבוסס על: קריאת קוד מעמיקה + dry voice benchmark + signal flow mapping

---

## COMMERCIAL READINESS SCORES (מעודכן)

| Category | Score | Evidence |
|----------|-------|----------|
| **ENGINE HEALTH** | 80 | עובד, יציב, 60+ sec. setInterval(25ms) = P0 architecture risk. |
| **DSP PRIMITIVES** | 30 | Offline: PolyBLEP osc + MoogLadder. Live: PeriodicWave + BiquadFilter. **שני מערכות שונות.** |
| **INSTRUMENTS** | 25 | כל voice הוא osc→filter→gain. אין modulation matrix. אין voice identity. אין articulation. |
| **MUSIC** | 35 | 4-note motif, random acid, no counter-melody, no phrase planning |
| **PRODUCTION** | 20 | **Live engine: אין channel gains, אין multiband, אין true-peak, אין LUFS.** |
| **REFERENCE** | 0 | לא קיים |
| **OVERALL** | **25** | **הפער מcommercial הוא עדיין עצום. הבעיה המרכזית: שני engines מנותקים.** |

---

## TOP 10 דברים שמונעים מPSY4 להישמע commercial היום

### 1. שני מנועי אודיו מנותקים (P0 — ARCHITECTURE)
- **בעיה:** Offline engine (Studio) וLive engine (Psy4LiveEngine) הם שני implementations נפרדים עם פרמטרים שונים
- **השפעה:** שינויים באחד לא משפיעים על השני. Benchmarks מודדים את הלא נכון.
- **פתרון:** Voice Specs משותפים + התאמת הlive engine להשתמש באותם פרמטרים

### 2. אין channel gains בlive engine (P0 — PRODUCTION)
- **בעיה:** כל voice מתחבר ישירות לsum GainNode. אין gain staging.
- **השפעה:** אין היררכיה במיקס. Kick וpad באותו level. אין headroom.
- **פתרון:** הוסף GainNode per voice עם dB values מworld config

### 3. אין HP filter per channel בlive engine (P0 — PRODUCTION)
- **בעיה:** אין הפרדת תדרים. Bass וlead חופפים בlow-mid.
- **השפעה:** מיקס בוצי, masking.
- **פתרון:** BiquadFilter HP per voice (80-120Hz לnon-bass voices)

### 4. Master chain פרימיטיבי בlive engine (P0 — PRODUCTION)
- **בעיה:** DynamicsCompressor + EQ shelves במקום MasterChain (glue + saturation + true-peak)
- **השפעה:** אין glue, אין cohesion, אין true-peak protection
- **פתרון:** Port MasterChain לWeb Audio או השתמש בnative nodes דומים

### 5. אין modulation matrix (P0 — DSP)
- **בעיה:** כל מודולציה היא hardcoded (LFO→cutoff בlead, nothing else)
- **השפעה:** אי אפשר לroute LFO→FM, env→pitch, velocity→resonance, macro→distortion
- **פתרון:** ModulationMatrix class עם source→amount→destination routing

### 6. כל voice הוא osc→filter→gain (P0 — DSP)
- **בעיה:** אין FM, אין ring mod, אין wavetable interpolation, אין comb filter, אין feedback
- **השפעה:** כל הצלילים נשמעים כמו אותו synth עם notes שונים
- **פתרון:** Voice architecture עם multiple oscillator types + modulation routing

### 7. אין voice identity/preset system (P1 — DSP)
- **בעיה:** כל kick נשמע זהה, כל bass נשמע זהה, כל lead נשמע זהה
- **השפעה:** אין מגוון צלילי. אין "sound bank".
- **פתרון:** VoiceFactory שמייצר identities מ(world, role, seed)

### 8. אין phaser/shimmer/multiband בlive engine (P1 — FX)
- **בעיה:** רק delay + reverb. אין phaser, shimmer, multiband, bitcrush
- **השפעה:** אין תנועה פסיכדלית עמוקה
- **פתרון:** Port מPSY3 pro_fx.py

### 9. Motif של 4 תווים (P1 — MUSIC)
- **בעיה:** 4-note AABA, אין פיתוח, אין counter-melody, אין call/response
- **השפעה:** המוזיקה נשמעת אלגוריתמית, לא מולחמת
- **פתרון:** 8-16 note motifs + counter-melody + phrase planning

### 10. אין reference analysis (P1 — REFERENCE)
- **בעיה:** לא קיים. PSY3 יש style_clone.py + learner.py
- **השפעה:** אי אפשר ללמוד מreferences. אי אפשר למדוד distance לtarget.
- **פתרון:** Port style_clone.py + learner.py לTypeScript

---

## DSP PRIMITIVE AUDIT

### Oscillators

| Type | Offline Engine | Live Engine | Commercial Standard | Gap |
|------|---------------|-------------|---------------------|-----|
| Saw | PolyBLEP (custom) | PeriodicWave (48 harmonics) | Band-limited adaptive | Live: fixed 48 harmonics = aliasing at high freq |
| Square | PolyBLEP (custom) | PeriodicWave (odd harmonics) | Band-limited adaptive | Same |
| Triangle | PolyBLEP (custom) | native type='triangle' | Native or additive | Live: OK (native) |
| Sine | native type='sine' | native type='sine' | Native | OK |
| Noise | PinkNoise (custom) | Pink buffer (Paul Kellet) | Pink/white | OK |
| FM | Not in voices | In texture() only | Carrier+modulator+index | **Missing from lead/bass** |
| Wavetable | In Iridium only | In texture() only | Interpolated tables | **Missing from lead/pad** |
| Ring mod | Not implemented | Not implemented | Carrier×modulator | **Completely missing** |
| Supersaw | 2 oscs (offline) | 5 oscs (live) | 7+ detuned | Live: better but still basic |

### Filters

| Type | Offline Engine | Live Engine | Commercial Standard | Gap |
|------|---------------|-------------|---------------------|-----|
| LP | MoogLadder (4-stage, tanh) | BiquadFilter (native) | Moog ladder with saturation | **Live: no saturation, no character** |
| HP | OnePole (custom) | BiquadFilter (native) | Native or SVF | OK |
| BP | StateVariable (custom) | BiquadFilter (native) | SVF with Q control | OK |
| Notch | Not implemented | Not implemented | BiquadFilter notch | **Missing** |
| Comb | Not implemented | Not implemented | Delay+feedback | **Missing** |

### Envelopes

| Feature | Offline Engine | Live Engine | Commercial Standard | Gap |
|---------|---------------|-------------|---------------------|-----|
| ADSR | Custom class | GainNode ramps | Exponential curves | Live: linear ramps = clicks |
| Velocity | Not mapped | Not mapped | Vel→cutoff, vel→amp | **Missing** |
| Accent | Not implemented | Not implemented | Accented notes = brighter | **Missing** |
| Retrigger | Yes (offline) | Yes (new osc each note) | Phase reset | OK |

### Nonlinear Processing

| Type | Offline Engine | Live Engine | Commercial Standard | Gap |
|------|---------------|-------------|---------------------|-----|
| Saturation | WaveShaper (tanh) | WaveShaper (tanh) | Multiple curves | Both: only tanh |
| Distortion | In bass/acid | In bass/acid | Hard clip, foldback | **Missing variety** |
| Bitcrush | Not in live | Not in live | Sample rate + bit reduction | **Missing** |
| limiter | TruePeakLimiter | DynamicsCompressor | True-peak oversampled | **Live: no true-peak** |

---

## VOICE-BY-VOICE AUDIT

### KICK — "sine + click, not a kick"
- **Offline:** KickEngine (3-layer: sub sine + mid triangle + noise click + saturation)
- **Live:** 3-layer (sub sine + mid triangle + noise click + saturation) — REBUILT
- **Problem:** Still too quiet (peak 0.81 vs PSY3 1.36). Click level 0.08 vs offline 0.35.
- **Verdict:** Better than before but still not commercial. Needs gain staging.

### BASS — "saw through filter, not a bass instrument"
- **Offline:** BassEngine (sub + harmonic + sidechain + saturation)
- **Live:** saw + sub through LP + saturation — REBUILT
- **Problem:** Cutoff now 150Hz (good) but sub gain 0.6 vs offline 0.8. No mid-range character layer.
- **Verdict:** Low-end improved but still lacks character for small speakers.

### LEAD — "5 oscillators through filter, not a synth lead"
- **Offline:** 2 oscs through MoogLadder (characterful filter)
- **Live:** 5 oscs through BiquadFilter (sterile filter) + LFO
- **Problem:** BiquadFilter has no saturation, no character. 5 oscs add width but not warmth.
- **Verdict:** Needs Moog-style filter + velocity response + articulation.

### PAD — "2 detuned oscs, not an evolving pad"
- **Offline:** 2 oscs through MoogLadder + Chorus
- **Live:** 2 oscs through BiquadFilter + LFO detune (evolve)
- **Problem:** Amplitude doubled (0.08 from 0.04) but still 3x quieter than PSY3.
- **Verdict:** Evolution added but still too quiet and too sterile.

### HAT — "noise + metallic oscs, acceptable"
- **Offline:** HatEngine (4 inharmonic squares + HP)
- **Live:** 4 inharmonic squares + noise + HP — REBUILT
- **Problem:** Metallic character added. Still all hats sound identical (no per-hit variation).
- **Verdict:** Improved but needs per-hit variation.

### CLAP — "multi-burst, acceptable"
- **Offline:** ClapEngine (multi-burst HP+LP)
- **Live:** 4 staggered noise bursts — REBUILT
- **Problem:** Multi-burst added. Still all claps sound identical.
- **Verdict:** Improved but needs variation.

---

## WHAT MUST BE REWRITTEN (not patched)

1. **Unify voice parameters** — single VoiceSpec source for both engines
2. **Add channel gains to live engine** — GainNode per voice with dB from world config
3. **Replace live master chain** — use MasterChain-equivalent (glue + sat + true-peak)
4. **Add modulation matrix** — routable LFO/env/macro → destinations
5. **Add Moog-style filter to live engine** — WaveShaper inside filter feedback loop
6. **Add per-hit variation** — pitch/decay/tone micro-variation per drum hit
7. **Expand motif system** — 8-16 notes with development
8. **Port phaser + shimmer** — from PSY3 pro_fx.py
9. **Port reference analysis** — from PSY3 style_clone.py + learner.py
10. **Migrate to AudioWorklet** — move scheduling to audio thread
