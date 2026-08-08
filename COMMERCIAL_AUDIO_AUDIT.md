# PSY4 COMMERCIAL AUDIO AUDIT — DEEP FORENSIC ROAST

## תאריך: 2026-08-08
## מבוסס על: קריאת קוד מעמיקה של PSY4 (1233 שורות psy4LiveEngine.ts) + PSY3 (כל הקבצים)

---

## A. BRUTAL ROAST — למה PSY4 עדיין נשמע amateur

### 30 GAPS אמיתיים

#### MUSICAL (10)

**M1. ה-bass הוא oscillator שמנגן root, לא bassline מוזיקלי**
- איפה: step() line ~1075, `bassCycle = [0, 0, 4, 0, 7, 0, 4, 0]`
- בעיה: זה pattern קבוע של 8 תווים שחוזר על עצמו. אין פיתוח, אין phrase variation, אין call/response.
- Commercial: bassline עם phrase-level development, rests, ghost notes, walking passages, drop anticipation

**M2. אין groove אמיתי — swing הוא רק `sw * this.s16()` על offbeats**
- איפה: step() line ~1047, `const bt = isOff ? t + sw * this.s16() : t`
- בעיה: swing משפיע רק על timing של bass. אין velocity groove עמוק, אין microtiming על hats/perc.
- Commercial: groove עם velocity curves, microtiming per-instrument, accent patterns

**M3. אין call/response**
- איפה: lead מנגן motif של 4 תווים, אין voice שעונה לו
- בעיה: מוזיקה חד-צדדית, אין דיאלוג מוזיקלי
- Commercial: lead → space → acid/texture response → lead return

**M4. אין motif development אמיתי**
- איפה: Motif class, `this.notes` = 4 תווים, mutation רק משנה תו אחד כל 4 בארים
- בעיה: 4 תווים עם mutation אחד זה לא development. זה loop עם שינוי קל.
- Commercial: AABA structure, octave displacement, rhythmic mutation, register shifts, return to original

**M5. אין tension/release אמיתי**
- איפה: sections משתנים אבל אין density curve בתוך section
- בעיה: build = אותו density כל 8 בארים. אין gradual build. drop = אותו דבר עם energy=1.
- Commercial: density curve עולה בbuild, נופל בbreak, מתפרץ בdrop

**M6. אין counter-melody**
- איפה: אין voice שמגיב לlead
- בעיה: רק lead אחד, אין layer מלודי שני
- Commercial: counter-melody שפועלת בדיאלוג עם lead

**M7. acid = random pitch picker**
- איפה: step() line ~1093, `S.rng.pick([0, 0, 2, 4, 7, 0, -1])`
- בעיה: כל תו acid הוא רנדומלי. אין pattern identity. נשמע כמו blips.
- Commercial: acid pattern עם identity (AAB A'), mutation controlled

**M8. arrangement לא מחזיק track של דקות**
- איפה: SECTION_CYCLE = ['intro','build','drop','break','drop','climax'], 6 sections × 8-16 bars = ~3 דקות
- בעיה: אחרי climax חוזר לintro. אין development על פני דקות.
- Commercial: arrangement עם זרימה, variation, surprise, return

**M9. אין micro-events מספיק**
- איפה: ear candy הוא zap/blip/downlifter עם probability נמוכה
- בעיה: רגעים שקטים מדי בין events. המוזיקה מרגישה דלילה.
- Commercial: micro-events צפופים יותר, filter throws, delay throws, percussion fills

**M10. אין repetition עם controlled mutation**
- איפה: motif חוזר עם mutation אחד כל 4 בארים
- בעיה: חזרה צריכה להיות מזוהה ע"י המאזין, עם שינוי שמרגיש כמו development
- Commercial: repeat → vary → develop → return

#### SOUND DESIGN (10)

**S1. כל voice = osc → filter → gain**
- איפה: כל voice function מבנה את אותו pattern
- בעיה: אין FM (חוץ מtexture/zap), אין ring mod, אין wavetable interpolation, אין comb filter
- Commercial: multiple synthesis architectures

**S2. BiquadFilter = sterile**
- איפה: כל filter בlive engine הוא BiquadFilter (native Web Audio)
- בעיה: אין saturation בfilter, אין character, אין warmth. PSY3 משתמש בMoog ladder עם tanh.
- Commercial: Moog-style filter with nonlinear feedback

**S3. lead צורם**
- איפה: lead() line ~581, cutoff 1500-3000Hz עם 5 oscillators
- בעיה: 5 PeriodicWave oscillators עם fixed 48 harmonics = aliasing בתדרים גבוהים
- Commercial: band-limited oscillators (PSY3's bl_saw adapts N to frequency)

**S4. pad עדיין חלש**
- איפה: pad() line ~751, amp = 0.08
- בעיה: PSY3 pad peak = 0.196, PSY4 pad peak = 0.024. גם אחרי doubling, עדיין חלש פי 3.
- Commercial: pad audible without masking other elements

**S5. אין per-hit variation**
- איפה: kick() תמיד מנגן אותו sample באותו pitch, hat() תמיד אותו sample
- בעיה: כל kick נשמע זהה. כל hat נשמע זהה. Machine-like.
- Commercial: pitch/decay/tone micro-variation per hit

**S6. אין voice identity**
- איפה: אין VoiceFactory, אין preset system
- בעיה: אי אפשר לייצר "dark aggressive kick" vs "tight club kick"
- Commercial: parameterized sound families

**S7. texture לא continuous**
- איפה: texture() נורה כל 4 בארים (או 2 בdrops)
- בעיה: יש רגעי שקט בין texture bursts
- Commercial: continuous evolving atmospheric bed

**S8. bass לא מספיק deep**
- איפה: bass() cutoff עכשיו 150Hz אבל sub gain רק 0.6
- בעיה: PSY3 bass = 91.5% sub+low, PSY4 bass = עדיין חלש בsub
- Commercial: bass with strong sub + controlled harmonics for translation

**S9. אין modulation matrix**
- איפה: כל modulation hardcoded (LFO→cutoff בlead only)
- בעיה: אי אפשר לroute LFO→FM, env→pitch, vel→resonance, macro→distortion
- Commercial: routable modulation system

**S10. אין stereo movement**
- איפה: StereoPanner קבוע לכל voice
- בעיה: אין autopan, אין stereo automation, אין width changes per section
- Commercial: moving stereo field, section-aware width

#### PRODUCTION (10)

**P1. אין multiband compression**
- איפה: master chain = single DynamicsCompressor
- בעיה: לא יכול לcontrol low/mid/high independently
- Commercial: 3-band split → independent comp (PSY3 style_master.py)

**P2. אין true-peak limiting**
- איפה: lim = DynamicsCompressor (ratio 20:1)
- בעיה: לא true-peak. inter-sample peaks יכולים לעבור 0dBFS
- Commercial: oversampled true-peak limiter

**P3. אין LUFS targeting**
- איפה: master gain = 0.82 (fixed)
- בעיה: loudness משתנה לפי world/seed. אין consistent level.
- Commercial: measure LUFS → adjust gain to target

**P4. אין bus architecture**
- איפה: כל voice → channel strip → sum (flat structure)
- בעיה: אין drum bus, bass bus, music bus. אין group processing.
- Commercial: DRUM BUS → BASS BUS → MUSIC BUS → FX BUS → MASTER

**P5. אין glue compression**
- איפה: comp = DynamicsCompressor על sum
- בעיה: לא purpose-built glue. threshold קבוע -14dB.
- Commercial: feed-forward glue comp (PSY3 style_master.py: thr=0.6, ratio=2.0, makeup=1.3)

**P6. אין saturation on master**
- איפה: רק EQ shelves (+2dB low, +1.5dB high)
- בעיה: אין harmonic cohesion, אין warmth
- Commercial: tanh saturation (drive=1.15, mix=0.15)

**P7. reverb = single fixed impulse**
- איפה: conv.buffer = makeImpulse(2.2, 2.5)
- בעיה: אין multiple spaces (room/plate/hall). אין pre-delay variation.
- Commercial: multiple ConvolverNodes with per-section send levels

**P8. אין delay throws**
- איפה: dSend = global send, לא per-note
- בעיה: אי אפשר לthrow delay על note ספציפי
- Commercial: per-note delay send with tempo-synced time

**P9. אין sidechain depth variation per section**
- איפה: duck depth = world.duck * (0.5 + aggression*0.5) — constant
- בעיה: sidechain לא משתנה בין sections
- Commercial: deeper in drops, shallower in breakdowns

**P10. אין frequency separation**
- איפה: HP per channel קיים אבל לא מספיק
- בעיה: bass וlead עדיין חופפים בlow-mid
- Commercial: controlled EQ per channel, frequency ownership

---

## B. PSY3 → PSY4 KNOWLEDGE TRANSFER

### מה בדיוק לקחת מ-PSY3 ולמה

| PSY3 Feature | What It Does | Why Better | Port Strategy |
|---|---|---|---|
| `bl_saw(f,dur)` | Additive band-limited saw, N adapts to frequency | PSY4 PeriodicWave = fixed 48 harmonics = aliasing | Port to Web Audio: createPeriodicWave with adaptive N |
| `moog(x,cutoff,res)` | 4-stage Moog ladder with tanh saturation + feedback | PSY4 BiquadFilter = sterile, no character | Port: WaveShaper in filter feedback loop |
| `phaser(x,stages,rate,depth)` | 4-stage allpass with LFO modulation | PSY4: completely missing | Port: BiquadFilter allpass chain + LFO |
| `shimmer(x,rev_mix,oct_mix)` | Pitch-shifted reverb tail (octave up) | PSY4: completely missing | Port: ConvolverNode + playbackRate modulation |
| `multiband_comp(x)` | 3-band (low/mid/high) independent compression | PSY4: single-band only | Port: 3 BiquadFilter splits + 3 DynamicsCompressors |
| `truepeak(x)` | 2x interpolation true-peak measurement | PSY4: no true-peak | Port: 2x oversampling + peak detection |
| `master_pro(x)` | band_gains → multiband_comp → glue → sat → truepeak → LUFS | PSY4: comp + EQ + fixed gain | Port: full chain in Web Audio |
| `to_stereo(x,width)` | Delayed decorrelated HP side signal | PSY4: per-voice StereoPanner only | Port: Haas delay + HP on side |
| `style_clone.profile(p)` | BPM est (onset autocorrelation) + key est (chroma) + spectral bands + structure | PSY4: not implemented | Port: Web Audio AnalyserNode + FFT |
| `learner.self_train()` | render → measure distance → converge band gains + LUFS | PSY4: not implemented | Port: render → analyze → compare → adjust |
| `pad(evolve)` | Slow detune modulation per voice | PSY4: adopted (LFO on detune) | Already done |
| `engine.kick()` | sub sine + triangle mid + noise click, 87% low | PSY4: 53% low | Already improved + sample hybrid |
| `engine.bass()` | bl_saw + sub sine, LP 150Hz, 76% low | PSY4: 46% low | Already improved cutoff |
| `engine.lead()` | 5 detuned bl_saw, LP 1200Hz, 1.7% high | PSY4: 92% high | Already improved cutoff |
| `worklet.js` | AudioWorklet with wavetable | PSY4: setInterval(25ms) | Port: AudioWorkletProcessor |
| `sample_engine.js` | CC0 sample playback | PSY4: SoundBank (adopted) | Already done |

---

## C. CURRENT SIGNAL FLOW (PSY4)

```
setInterval(25ms) → tick() → step()
                          ↓
┌── Voice Functions (17 voices) ──┐
│ kick: sample + synth mid + click │
│ bass: saw + sub → LP → sat       │
│ lead: 5 osc → LP + LFO           │
│ acid: square → LP → dist         │
│ hat: sample or metallic oscs     │
│ clap: sample or multi-burst      │
│ perc: triangle → gain            │
│ shaker: noise → HP               │
│ pad: 2 osc → LP + LFO detune     │
│ texture: FM/wavetable/noise      │
│ riser/impact/sweep/zap/blip/df   │
└──────────────────────────────────┘
            ↓ channelInput
    HP filter (per channel)
            ↓
    Gain (dB, per channel)
            ↓
    StereoPanner (per channel)
            ↓                 ↗ reverbSend → ConvolverNode → sum
    sum ← ───────────────────↘ delaySend → ping-pong delay → sum
            ↓
    duck (sidechain GainNode)
            ↓
    DynamicsCompressor (thr=-14dB, ratio=2.5)
            ↓
    DynamicsCompressor (thr=-1.5dB, ratio=20)
            ↓
    BiquadFilter lowshelf (80Hz, +2dB)
            ↓
    BiquadFilter highshelf (10kHz, +1.5dB)
            ↓
    GainNode (0.82)
            ↓
    destination
```

### Problems:
1. No bus grouping (drum/bass/music/fx)
2. No multiband
3. No true-peak
4. No LUFS targeting
5. No glue compression (purpose-built)
6. No saturation on master
7. Single reverb (no room/plate/hall)
8. No per-note delay throws

---

## D. TARGET SIGNAL FLOW

```
Voice → Channel Strip → Instrument Bus → Group Bus → Master
         (HP, gain,       (saturation,    (EQ, comp,    (multiband,
          pan, sends)     EQ, comp)       stereo)       glue, sat,
                                                          true-peak,
                                                          LUFS)

Groups:
  DRUM BUS: kick + hat + clap + perc + shaker
  BASS BUS: bass + sub
  MUSIC BUS: lead + acid + pad
  ATMOS BUS: texture
  FX BUS: riser + impact + sweep + zap + blip + downlifter

Master:
  sum → HP(25Hz) → DC block → multiband comp → glue comp → saturation
       → stereo management → true-peak limiter → LUFS target → output
```

---

## E. VOICE ARCHITECTURE TARGET

### Kick
```
Sample layer (PSY3 kick.wav, pitch-shifted)
  + Synthetic sub (sine, pitch env)
  + Mid punch (triangle, tanh sat)
  + Click (noise → HP, 3ms)
  → Saturation (tanh, world-dependent drive)
  → Channel strip (gain -2dB, HP 30Hz)
  → Sidechain trigger
```

### Bass
```
Sub layer (sine at f/2, strong, mono)
  + Body layer (bl_saw → LP 150Hz envelope)
  + Character layer (square → BP 400Hz, low level, stereo)
  → Saturation (tanh, drive = world.drive + aggression)
  → Sidechain (from kick, depth varies by section)
  → Channel strip (gain -3dB, HP 20Hz, mono)
```

### Lead
```
Oscillator stack (5 detuned, band-limited)
  + FM component (carrier + modulator, macro-controlled)
  → Moog-style filter (cutoff env + LFO + velocity)
  → Saturation (subtle)
  → Stereo (per-osc panner, width = macro)
  → Delay send (per-note throws)
  → Reverb send
  → Channel strip (gain -7dB, HP 80Hz)
```

### Pad
```
2 detuned oscillators (band-limited)
  + LFO detune evolution (per-voice rate)
  → LP filter (cutoff = macro-controlled)
  → Chorus
  → Reverb send (high)
  → Channel strip (gain -8dB, HP 80Hz, wide)
```

### Hat
```
PSY3 sample (primary)
  + Metallic osc bank (fallback/layer)
  → HP filter
  → Per-hit variation (pitch, decay, pan)
  → Channel strip (gain -10dB, HP 100Hz)
```

---

## F. PRODUCTION ARCHITECTURE TARGET

```
Channel Strips (per voice)
    ↓
Group Buses:
  DRUM BUS → saturation → comp → stereo
  BASS BUS → mono → sidechain → saturation
  MUSIC BUS → EQ → comp → stereo
  ATMOS BUS → reverb → stereo
  FX BUS → delay → stereo
    ↓
Master Bus:
  sum → HP(25Hz) → multiband comp (3-band)
  → glue comp (feed-forward, thr=0.6, ratio=2, makeup=1.3)
  → saturation (tanh, drive=1.15, mix=0.15)
  → stereo management (M/S, mono below 120Hz)
  → true-peak limiter (4x oversampled, ceiling=0.94)
  → LUFS targeting (-9 to -14 LUFS)
  → output
```

---

## G. REFERENCE ARCHITECTURE TARGET

```
YouTube URL / Audio file
    ↓
Audio extraction (backend API)
    ↓
ReferenceAnalyzer:
  → BPM (onset autocorrelation)
  → Key/scale (chroma profile)
  → Spectral profile (low/mid/high bands)
  → Transient profile (onset density)
  → Stereo profile (correlation, width)
  → Loudness (LUFS)
  → Dynamics (crest, range)
  → Structure (bar-level RMS → sections)
  → Energy curve
  → Density curve
  → FX profile (reverb depth, delay density)
    ↓
TargetStyleProfile (persistent)
    ↓
GenerationConstraints:
  → World selection/adaptation
  → Voice selection (from SoundBank)
  → Arrangement (section lengths, energy curve)
  → Mixing targets (band gains, LUFS)
  → Sound design targets (brightness, darkness, aggression)
    ↓
PSY4 synthesis + production
    ↓
Render → Analyze → Compare → Distance → Adjust → Re-render
```

---

## H. BENCHMARK (PSY3 vs PSY4)

### Dry Voice Comparison (absolute energy)

| Voice | PSY4 peak | PSY3 peak | PSY4 rms | PSY3 rms | Gap |
|-------|-----------|-----------|----------|----------|-----|
| KICK  | 0.825     | 1.361     | 0.149    | 0.279    | PSY3 1.9x |
| BASS  | 0.287     | 0.559     | 0.042    | 0.122    | PSY3 2.9x |
| LEAD  | 0.054     | 0.189     | 0.011    | 0.024    | PSY3 2.2x |
| PAD   | 0.024     | 0.196     | 0.007    | 0.040    | PSY3 5.7x |

### Spectral Distribution

| Voice | PSY4 low% | PSY3 low% | PSY4 high% | PSY3 high% |
|-------|-----------|-----------|------------|------------|
| KICK  | 53%       | 87%       | 99%        | 0.6%       |
| BASS  | 46%       | 76%       | 98%        | 0%         |
| LEAD  | 4%        | 0.1%      | 92%        | 1.7%       |
| FULL  | 53%       | 81%       | 99%        | 1.2%       |

---

## I. ROADMAP

### P0 — Architecture blockers (must fix first)
1. Unify voice specs (DONE — voiceSpecs.ts)
2. Channel strips (DONE — per-voice gain/HP/pan/send)
3. SoundBank integration (DONE — kick/hat/clap samples in signal path)
4. Bus architecture (NOT DONE — need drum/bass/music/fx buses)
5. Multiband compression (NOT DONE — port from PSY3)
6. True-peak limiting (NOT DONE — port from PSY3)
7. AudioWorklet (NOT DONE — port from PSY3)

### P1 — Sound engine blockers
8. Moog-style filter (NOT DONE — port from PSY3)
9. Phaser (NOT DONE — port from PSY3)
10. Shimmer (NOT DONE — port from PSY3)
11. Per-hit variation (NOT DONE)
12. Bass sample integration (NOT DONE — bass_A.wav available)
13. Lead sample integration (NOT DONE — lead.wav available)
14. Modulation matrix (NOT DONE)

### P2 — Musical intelligence
15. Motif expansion (8-16 notes)
16. Acid pattern identity
17. Counter-melody
18. Phrase-level planning
19. Bass grammar improvement
20. Groove engine improvement

### P3 — Reference analysis
21. Port style_clone.py
22. Port learner.py
23. YouTube input pipeline
24. Reference-guided generation
25. Learning loop

---

## J. COMMERCIAL READINESS SCORE

| Category | Score | Evidence |
|----------|-------|----------|
| ENGINE HEALTH | 75 | Works, stable. setInterval(25ms) = P0 risk. No AudioWorklet. |
| SOUND DESIGN | 30 | Kick sample integrated. Hat/clap samples integrated. But lead still harsh, bass still thin, pad still quiet. No Moog filter, no modulation matrix. |
| MUSICAL QUALITY | 30 | 4-note motif, random acid, no counter-melody, no phrase planning. Bass = fixed pattern. |
| PRODUCTION | 25 | Channel strips added. But no multiband, no true-peak, no LUFS, no bus architecture. |
| REFERENCE | 0 | Not implemented. |
| **OVERALL** | **25** | **Sound generator, not production system.** |

---

## K. TOP 10 THINGS PREVENTING COMMERCIAL QUALITY TODAY

1. **BiquadFilter is sterile** — no Moog-style warmth (P0)
2. **No multiband compression** — can't control low/mid/high independently (P0)
3. **No true-peak limiting** — inter-sample clipping risk (P0)
4. **No modulation matrix** — all modulation hardcoded (P0)
5. **Lead still harsh** — PeriodicWave aliasing + cutoff too high (P0)
6. **Bass still thin** — sub gain too low, no character layer (P1)
7. **No per-hit variation** — every kick/hat identical (P1)
8. **4-note motif** — primitive musical identity (P1)
9. **Random acid** — no pattern identity (P1)
10. **No reference analysis** — can't learn from commercial references (P1)
