# ARCHITECTURE SIGNAL FLOW — PSY4

## תאריך: 2026-08-08
## מטרה: מיפוי מלא של שני מנועי האודיו וזיהוי נקודות הכשל

---

## 1. DUAL ENGINE PROBLEM — הבעיה הארכיטקטונית המרכזית

PSY4 מכיל **שני מנועי אודיו נפרדים ומנותקים**:

### ENGINE A: Offline DSP (Studio class)
- **מה:** TypeScript DSP, מחשב samples בFloat32Array
- **איפה:** `src/lib/studio/render/engine.ts` + `src/lib/studio/devices/*.ts` + `src/lib/studio/dsp/*.ts`
- **מתי:** נפעל ע"י `/api/studio/generate` (offline render) + benchmarks
- **קול ראשי:** 9 device twins (Muse, Sub37, Prophet6, Iridium, Rytm, Digitakt, H90, Apollo, Live)
- **Master chain:** MasterChain class (HP → glue comp → saturation → true-peak limiter)
- **Channel gains:** Apollo mixer עם per-channel gain (-2 עד -14 dB), HP filter, stereo width, space send

### ENGINE B: Live Web Audio (Psy4LiveEngine class)
- **מה:** Browser-native Web Audio API (createOscillator, GainNode, BiquadFilter, etc.)
- **איפה:** `src/lib/studio/engine/psy4LiveEngine.ts` (1121 שורות, קובץ יחיד)
- **מתי:** נפעל כשהמשתמש לוחץ Play בUI
- **קול ראשי:** 17 voice functions inline בקובץ אחד
- **Master chain:** sum → duck → DynamicsCompressor → DynamicsCompressor → EQ shelves → master gain
- **Channel gains:** אין! כל voice מתחבר ישירות לsum bus

### הבעיה:
**המשתמש שומע רק את ENGINE B.**
**הbenchmarks מודדים את ENGINE A.**
**לשני הengines יש פרמטרים שונים לכל voice.**

---

## 2. SIGNAL FLOW — ENGINE B (LIVE — מה שהמשתמש שומע)

```
User clicks Play
    ↓
Psy4LiveEngine.start()
    ↓
setInterval(25ms) → tick() → step()
    ↓
For each 16th note:
    ↓
┌─────────────────────────────────────────────────────┐
│ VOICE FUNCTIONS (all connect directly to this.sum)  │
│                                                      │
│ kick()   → sub sine + mid triangle + noise click     │
│           → WaveShaper sat → GainNode → sum          │
│           → also triggers duck.gain sidechain        │
│                                                      │
│ bass()   → saw PeriodicWave + sub sine               │
│           → BiquadFilter LP → WaveShaper → Gain → sum│
│                                                      │
│ lead()   → 5× PeriodicWave oscs → BiquadFilter LP    │
│           → LFO → filter cutoff → Gain → sum         │
│           → also → dSend (delay) + rSend (reverb)    │
│                                                      │
│ acid()   → square PeriodicWave → BiquadFilter LP     │
│           → WaveShaper → Gain → sum                  │
│           → also → dSend                             │
│                                                      │
│ hat()    → 4× square oscs (metallic) + noise buffer  │
│           → BiquadFilter HP → Gain → StereoPanner    │
│           → sum                                      │
│                                                      │
│ shaker() → noise buffer → BiquadFilter HP            │
│           → Gain → StereoPanner → sum                │
│                                                      │
│ clap()   → 4× noise buffer → BiquadFilter BP         │
│           → Gain → StereoPanner → sum                │
│           → (only tail → rSend)                      │
│                                                      │
│ perc()   → triangle osc → Gain → StereoPanner → sum │
│                                                      │
│ pad()    → 2× PeriodicWave oscs (detuned)            │
│           → LFO → detune → BiquadFilter LP            │
│           → Gain → sum (+ rSend)                     │
│                                                      │
│ texture()→ FM / wavetable / noise variant            │
│           → BiquadFilter → Gain → StereoPanners → sum│
│           → (+ rSend)                                │
│                                                      │
│ riser()  → noise → BiquadFilter BP (freq sweep)      │
│           → Gain → sum (+ rSend)                     │
│                                                      │
│ impact() → sine osc (pitch drop) → Gain → sum        │
│                                                      │
│ sweep()  → noise → BiquadFilter LP (freq sweep)      │
│           → Gain → sum (+ rSend)                     │
│                                                      │
│ zap()    → FM: carrier sine + modulator sine          │
│           → Gain → sum (+ dSend)                     │
│                                                      │
│ blip()   → sine osc → Gain → sum (+ dSend)           │
│                                                      │
│ downlifter() → sawtooth (pitch drop) → LP → Gain → sum│
└─────────────────────────────────────────────────────┘
                    ↓
              this.sum (GainNode)
                    ↓
              this.duck (GainNode — sidechain)
                    ↓
              this.comp (DynamicsCompressor — threshold=-14dB, ratio=2.5)
                    ↓
              this.lim (DynamicsCompressor — threshold=-1.5dB, ratio=20)
                    ↓
              this.eqL (BiquadFilter lowshelf — 80Hz, +2dB)
                    ↓
              this.eqH (BiquadFilter highshelf — 10kHz, +1.5dB)
                    ↓
              this.master (GainNode — 0.82)
                    ↓
              ctx.destination (speakers)

FX RETURNS:
  dSend → ping-pong delay (dL 0.23s, dR 0.31s, LP 3.5kHz, feedback 0.35)
        → StereoPanners (±0.5) → dOut (gain 0.3) → sum
  rSend → ConvolverNode (impulse 2.2s, decay 2.5) → sum
```

### בעיות בLIVE ENGINE:
1. **אין channel gains** — כל voice מתחבר ישירות לsum. אין gain staging.
2. **אין HP filter per channel** — אין הפרדת תדרים בין כלים.
3. **אין stereo width per channel** — רק StereoPanner קבוע לכל voice.
4. **אין multiband compression** — רק DynamicsCompressor יחיד.
5. **אין true-peak limiting** — DynamicsCompressor אינו true-peak limiter.
6. **אין LUFS targeting** — gain קבוע 0.82.
7. **Master chain פרימיטיבי** — לא משתמש בMasterChain class שקיים בoffline engine.

---

## 3. SIGNAL FLOW — ENGINE A (OFFLINE — מה שהbenchmarks מודדים)

```
API /generate or benchmark script
    ↓
new Studio(config) → creates 9 device twins
    ↓
studio.render(bars)
    ↓
For each block (256 samples):
    ↓
┌─────────────────────────────────────────────────────────┐
│ DEVICE TWIN VOICES (each renders into its own bus)      │
│                                                          │
│ Muse (moog-muse.ts)                                      │
│   → 2× Oscillator (PolyBLEP) → MoogLadder filter         │
│   → ADSR envelope → DCBlocker → panStereo → bus[0]      │
│                                                          │
│ Sub37 (subsequent37.ts)                                  │
│   → BassEngine: sub sine + saw → MoogLadder              │
│   → WaveShaper sat → ADSR → DCBlocker → panStereo → bus[1]│
│   → receives kickFired() from Rytm for sidechain         │
│                                                          │
│ Prophet6 (prophet6.ts)                                   │
│   → 6-voice poly: 2× Oscillator per voice → MoogLadder   │
│   → ADSR → Chorus → bus[2]                               │
│                                                          │
│ Iridium (waldorf-iridium.ts)                             │
│   → Wavetable Oscillator + FM Oscillator                 │
│   → StateVariable filter → ShimmerReverb + FeedbackDelay │
│   → ADSR → bus[3]                                        │
│                                                          │
│ Rytm (analog-rytm.ts)                                    │
│   → KickEngine: sub sine + mid triangle + click          │
│   → SnareEngine: tone + noise + HP filter                │
│   → HatEngine: 4× inharmonic squares + HP                │
│   → ClapEngine: multi-burst noise + HP+LP                │
│   → ShakerEngine, PercEngine                             │
│   → Distortion → bus[4]                                  │
│   → kickCallback → Sub37.kickFired() (sidechain)         │
│                                                          │
│ Digitakt (digitakt.ts)                                   │
│   → Sample playback + resample buffer                    │
│   → bus[5]                                               │
│                                                          │
│ H90 (eventide-h90.ts)                                    │
│   → Receives insert send from Apollo                     │
│   → ShimmerReverb / FeedbackDelay / Phaser / Chorus      │
│   → insert return → Apollo                               │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ APOLLO MIXER (apollo-x8p.ts)                            │
│                                                          │
│ For each channel:                                        │
│   input → HP filter (per-channel freq)                   │
│         → StereoEngine.processWidth (per-channel width)  │
│         → gain (per-channel dB: -2 to -14)               │
│         → pan (constant-power)                           │
│         → FX send (to H90 insert)                        │
│         → Space send (to SpaceEngine: room/plate/hall/psy)│
│         → resample bus (to Digitakt)                     │
│                                                          │
│ Sum all channels → masterL/masterR                       │
│ + FX return (from H90)                                   │
│ + Space return (from SpaceEngine)                        │
│                                                          │
│ → masterHp (HP 25Hz)                                     │
│ → DCBlocker                                              │
│ → masterLimiter (Limiter, ceiling 0.95)                  │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ LIVE DEVICE (ableton-live.ts) — Master Chain             │
│                                                          │
│ → MasterChain:                                           │
│   → HP (OnePole, 25Hz)                                   │
│   → DCBlocker                                            │
│   → GlueCompressor (feed-forward, thr=0.6, ratio=2.0)    │
│   → MasterSaturation (tanh, drive=1.15, mix=0.15)        │
│   → TruePeakLimiter (4x oversampled, ceiling=0.94)       │
│                                                          │
│ → record to Float32Array                                 │
└─────────────────────────────────────────────────────────┘
                    ↓
              encodeWav() → .wav file
```

### בעיות בOFFLINE ENGINE:
1. **פרמטרים ישנים** — kick/bass/lead params לא עודכנו בrebuild האחרון
2. **PeriodicWave לא קיים** — משתמש בcustom Oscillator class עם PolyBLEP
3. **MoogLadder filter** — קיים אבל לא משמש את הlive engine
4. **MasterChain class** — קיים אבל לא משמש את הlive engine

---

## 4. נקודות כשל קריטיות

### כשל #1: אין Single Source of Truth לפרמטרים

| Voice | Offline Engine | Live Engine | הפרש |
|-------|---------------|-------------|------|
| **Kick fundamental** | KICK_DEFAULTS.fundamental = 50 | world.kickFundamental (46-54) | שונה לכל world |
| **Kick decay** | KICK_DEFAULTS.decay = 0.2 | world.kickDecay (0.16-0.24) | שונה |
| **Kick subLevel** | KICK_DEFAULTS.subLevel = 1.0 | hardcoded 0.9 בlive | שונה |
| **Kick clickLevel** | KICK_DEFAULTS.clickLevel = 0.35 | hardcoded 0.08 בlive | **פי 4 הבדל!** |
| **Bass cutoff** | BASS_DEFAULTS.cutoff = 350 | world.bassCutoff (300-600) → hardcoded 150 בlive | **שונה לגמרי!** |
| **Bass subLevel** | BASS_DEFAULTS.subLevel = 0.8 | hardcoded 0.6 בlive | שונה |
| **Bass saturation** | BASS_DEFAULTS.saturation = 0.3 | drive = 1+world.drive*2+aggression | שונה |
| **Lead cutoff** | MUSE_DEFAULTS.cutoff = 1200 | hardcoded 1500+brightness*1500 בlive | שונה |
| **Channel gain** | Apollo: -2 עד -14 dB | אין! ישירות לsum | **קריטי!** |
| **Master chain** | MasterChain (glue+sat+true-peak) | DynamicsCompressor+EQ | **שונה לגמרי** |

### כשל #2: הbenchmarks מודדים את הengine הלא נכון

הbenchmark script משתמש ב:
```typescript
const sk = new Studio({bars:1, sampleRate:sr, blockSize:256, seed:1, bpm, h90:{mix:0}});
sk.scheduleKick(0, 0, 0.9);
const rk = sk.render(1);
```

זה קורא ל**Offline Engine** (Studio class) שמשתמש ב**KickEngine** עם **KICK_DEFAULTS**.
המשתמש שומע את ה**Live Engine** שמשתמש בvoice function אחר לגמרי עם פרמטרים אחרים.

**כל המסקנות מהbenchmarks הקודמים חלו על הengine הלא נכון.**

### כשל #3: הLive Engine לא משתמש בDSP primitives שנבנו

הoffline engine משתמש ב:
- `KickEngine` (3-layer: sub + mid + click, עם saturation)
- `BassEngine` (sub + harmonic + sidechain)
- `SnareEngine`, `HatEngine`, `ClapEngine`, `ShakerEngine`, `PercEngine`
- `MoogLadder` filter (4-stage, tanh saturation)
- `MasterChain` (glue + saturation + true-peak)
- `StereoEngine` (frequency-aware width)
- `SpaceEngine` (4 shared reverb spaces)

הlive engine **לא משתמש באף אחד מאלה**. הוא מייצר הכל inline עם Web Audio nodes.

---

## 5. מפת VOICE PARAMETERS — השוואה ישירה

### KICK

| Parameter | Offline (KickEngine) | Live (psy4LiveEngine) | Match? |
|-----------|---------------------|----------------------|--------|
| fundamental | 50 Hz | world.kickFundamental (46-54) | ❌ |
| startMult | 2.4 | 2.4 (hardcoded) | ✅ |
| pitchDecay | 0.04s | 0.008s (hardcoded) | ❌ |
| decay | 0.2s | world.kickDecay (0.16-0.24) | ❌ |
| subLevel | 1.0 | 0.9 (hardcoded) | ❌ |
| midLevel | 0.5 | 0.4 (hardcoded) | ❌ |
| clickLevel | 0.35 (noise) | 0.08 (noise) | ❌ |
| saturation | 0.4 | drive = 1+world.drive*1.5 | ❌ |
| level | 0.95 | 0.8 (satG gain) | ❌ |

### BASS

| Parameter | Offline (BassEngine) | Live (psy4LiveEngine) | Match? |
|-----------|---------------------|----------------------|--------|
| subLevel | 0.8 | 0.6 (hardcoded) | ❌ |
| harmonicLevel | 0.5 | implicit (amp 0.42) | ❌ |
| cutoff | 350 Hz | 1200→150Hz (hardcoded sweep) | ❌ |
| resonance | 0.3 | 2+psy*2 (Q value, different scale) | ❌ |
| attack | 0.003s | 0.003s | ✅ |
| decay | 0.08s | implicit (dur param) | ❌ |
| saturation | 0.3 | drive = 1+world.drive*2+aggression | ❌ |
| sidechainDepth | 0.35 | world.duck*(0.5+aggression*0.5) | ❌ |
| level | 0.8 | 0.42 (amp gain) | ❌ |

### LEAD

| Parameter | Offline (MuseDevice) | Live (psy4LiveEngine) | Match? |
|-----------|---------------------|----------------------|--------|
| oscShape | saw (from world.leadTimbre) | PeriodicWave (from world.leadType) | ❌ |
| cutoff | 1200 Hz (MUSE_DEFAULTS) | 1500+brightness*1500 | ❌ |
| resonance | 0.35 | 1+psy*3 (Q value) | ❌ |
| detune | 0 (oscBDetune) | world.leadDetune*(0.5+psy) | ❌ |
| numOscs | 2 (oscA+oscB) | 5 | ❌ |
| level | 0.5 | 0.16*amp/0.2 | ❌ |

---

## 6. מסקנות

### הבעיה הארכיטקטונית המרכזית:

**PSY4 מכיל שני מנועים שפיתחו בנפרד, עם פרמטרים שונים, DSP שונה, master chain שונה, וgain staging שונה.**

**המשתמש שומע רק את הLive Engine.**
**הbenchmarks מודדים רק את הOffline Engine.**
**השניים לא תואמים.**

### מה צריך לקרות:

1. **הגדרת Voice Specs משותפים** — קובץ אחד שמכיל את כל פרמטרי הvoices, משותף לשני הengines
2. **הLive Engine צריך להשתמש באותם פרמטרים** כמו הOffline Engine
3. **הbenchmarks צריכים למדוד את מה שהמשתמש שומע** — או לבדוק את שני הengines
4. **Master chain אחיד** — הLive Engine צריך להשתמש במשהו דומה לMasterChain class

### Top 10 דברים שמונעים מPSY4 להישמע commercial:

1. **שני engines מנותקים** — שינויים באחד לא משפיעים על השני
2. **אין channel gains בlive engine** — כל voice מתחבר ישירות לsum
3. **אין HP filter per channel בlive engine** — אין הפרדת תדרים
4. **Master chain פרימיטיבי בlive engine** — DynamicsCompressor במקום MasterChain
5. **אין true-peak limiting בlive engine**
6. **אין multiband compression בlive engine**
7. **Click level פי 4 שונה בין engines** (0.35 vs 0.08)
8. **Bass cutoff שונה לגמרי** (350Hz vs 1200→150Hz sweep)
9. **Lead cutoff שונה** (1200Hz vs 1500-3000Hz)
10. **אין stereo width management בlive engine** (רק StereoPanner קבוע)
