# F23 — AUDIO UNDERSTANDING LOOP: FORENSIC AUDIT + DESIGN

**HEAD:** `97aadae` · **Status:** Design only — no code yet.

---

## 1. EXACT CURRENT AUDIO PIPELINE

```
RADIO STREAM (live audio)
  ↓
HTMLAudioElement → MediaElementSource → radioAnalyser (AnalyserNode)
  ↓
psyLive.detect() (every 200ms)
  ├── Reads: getByteFrequencyData(fd), getFloatTimeDomainData(td)
  ├── Passes to: radioLayer.process(td, fd, audioTime)
  │   ├── RadioObservationLayer extracts:
  │   │   ├── signal: { state, rms, peak, spectralEnergy, nonZeroRatio, signalAgeSec }
  │   │   ├── beat: { timestamp, estimatedBpm, confidence, locked } | null
  │   │   ├── pitch: { frequency, midi, pitchClass, confidence } | null
  │   │   └── occupancy: { kick, bass, lead, hats } (band energy ratios)
  │   └── Returns: RadioObservationSnapshot
  ├── Feeds beat to: transport.observeBeat({time, confidence, source})
  ├── Feeds to: session.observeRadioTick({ radioBpm, energy, occupancy, bassFreq, pitchClass, pitchConfidence, freqData, sampleRate, fftSize })
  │   ├── MusicalObservationExtractor.observe(tick)
  │   │   ├── extractSpectralFeatures(freqData) → { centroid, flatness, rolloff, low, mid, high }
  │   │   └── Stores RadioTickFeatures (per 200ms tick)
  │   └── At phrase boundary: extractPhraseFeatures()
  │       ├── Aggregates ticks into PhraseMusicalFeatures
  │       └── Feeds to GrammarBuilder.observePhrase(features)
  │           ├── Builds BassGrammar (interval transitions, rhythm pattern)
  │           ├── Builds RhythmGrammar (kick onset pattern, hat density)
  │           ├── Builds MelodicGrammar (interval histogram, contour)
  │           └── Builds TimbreProfile (brightness, noisiness, synthParams)
  └── applyLearnedTimbre() → timbreToRecipe() → overrides 4 synth params in voice functions

GENERATION:
  MusicalSession.planBar()
  ├── Strategy selection (StrategySelector)
  ├── GrooveState generation
  ├── HarmonicState generation (chord progression)
  ├── TensionState update
  ├── PhraseDevelopmentState operator selection
  ├── generateKick() ← reads KICK_GRAMMARS (hardcoded), NOT groove
  ├── generateBass() ← reads kickNotes, harmonic, groove, tension
  │   └── LOCK/ANSWER/ANTICIPATE/SPACE relationship to kick
  ├── generateHats() ← reads style, section, tension
  └── generateRelationalLead() ← reads kickNotes, bassNotes, harmonic, groove, tension, phraseState
      └── PhraseEngine.generatePhrase() → buildPhrasePlan → generateMotifFromPlan → transformPhrase

SYNTHESIS:
  psyLive voice functions:
  ├── kick(t) → transient + pitch-drop body + sub body → kickBus
  ├── bass(t, freq) → sub sine + mid saw (LPF pluck) + character noise → bassBus
  ├── lead(t, freq) → 3× osc (unison) → stereo pan → LPF → waveshaper → leadBus
  └── hat(t, lvl) → noise → HPF + BPF → hatBus
  Buses → mute → duck → engineBus → comp → EQ → master → limiter → destination
```

---

## 2. WHAT CAN CURRENTLY BE EXTRACTED FROM WAV

**AudioFeatureExtractor** (tests/reality-bridge/AudioFeatureExtractor.ts) can extract from rendered PCM:

| Feature | Available? | How |
|---------|-----------|-----|
| Peak | ✅ | max(abs(sample)) |
| RMS | ✅ | sqrt(mean(sample²)) |
| Crest factor | ✅ | peak/RMS |
| Zero-crossing rate | ✅ | sign changes / N |
| Transient strength | ✅ | max(envelope derivative) |
| Attack time | ✅ | time to 90% of peak |
| Decay time | ✅ | time from peak to 10% |
| Sustain level | ✅ | RMS in sustain region |
| Release time | ✅ | time from sustain to 1% |
| Spectral centroid | ✅ | DFT weighted mean |
| Spectral spread | ✅ | DFT variance |
| Spectral rolloff | ✅ | 85th percentile |
| Spectral flatness | ✅ | geometric/arithmetic mean |
| Spectral flux | ✅ | frame-to-frame change |
| Low/mid/high energy | ✅ | band ratios |
| Sub ratio | ✅ | low/total |

**What CANNOT be extracted yet:**

| Feature | Missing? | Why |
|---------|---------|-----|
| Beat positions | ❌ | No onset detection on rendered audio |
| BPM | ❌ | No tempo detection on rendered audio |
| Kick/bass onset times | ❌ | No source separation |
| Kick fundamental trajectory | ❌ | No pitch tracking on rendered audio |
| Bass pitch | ❌ | No pitch detection on rendered audio |
| Lead phrase boundaries | ❌ | No phrase segmentation |
| Motif recurrence | ❌ | No motif extraction from audio |
| Harmonic rhythm | ❌ | No chord detection |
| Stereo width | ❌ | Mono rendering only |
| Modulation | ❌ | No AM/FM detection |
| Arrangement sections | ❌ | No structural segmentation |

---

## 3. WHICH LEARNED FIELDS REACH SYNTHESIS

| Learned Field | Stored In | Reaches Audio? | How |
|---------------|-----------|----------------|-----|
| BassGrammar.intervalTransitions | GrammarBuilder | ❌ NOT ANYMORE — bass now uses kick relationship, not learned grammar |
| BassGrammar.rhythmPattern | GrammarBuilder | ❌ NOT ANYMORE |
| RhythmGrammar.kickPattern | GrammarBuilder | ❌ NOT ANYMORE — kick uses hardcoded KICK_GRAMMARS |
| MelodicGrammar.intervalHistogram | GrammarBuilder | ✅ YES — PhraseEngine uses it 80% on passing tones |
| MelodicGrammar.contourPrefs | GrammarBuilder | ❌ NOT consumed by PhraseEngine |
| MelodicGrammar.registerPref | GrammarBuilder | ❌ NOT consumed by PhraseEngine |
| MelodicGrammar.degreePref | GrammarBuilder | ❌ NOT consumed by PhraseEngine |
| TimbreProfile.brightness | GrammarBuilder | ✅ YES — timbreToRecipe → oscType selection |
| TimbreProfile.bassWave | GrammarBuilder | ✅ YES — overrides v.bassWave |
| TimbreProfile.bassCut | GrammarBuilder | ✅ YES — overrides v.bassCut |
| TimbreProfile.leadWave | GrammarBuilder | ✅ YES — overrides v.leadWave |
| TimbreProfile.leadCut | GrammarBuilder | ✅ YES — overrides v.leadCut |
| TimbreProfile.bassSaturation | GrammarBuilder | ❌ NOT consumed (shaper removed from bass) |
| TimbreProfile.leadSaturation | GrammarBuilder | ✅ YES — lead shaper amount |
| TimbreProfile.hatDecay | GrammarBuilder | ❌ NOT consumed |
| TimbreProfile.hatBrightness | GrammarBuilder | ❌ NOT consumed |
| HarmonicState.progression | HarmonicState | ✅ YES — nearestChordTone in PhraseEngine |
| GrooveState.swing | GrooveState | ✅ YES — scheduler applies it |
| GrooveState.microTiming | GrooveState | ✅ YES — scheduler applies it |
| GrooveState.spaceMap | GrooveState | ✅ YES — PhraseEngine rhythm skeleton |
| TensionState.melodic | TensionState | ✅ YES — PhraseEngine maxInterval |
| TensionState.rhythmic | TensionState | ✅ YES — PhraseEngine playProb |
| TensionState.register | TensionState | ✅ YES — PhraseEngine register push |
| TensionState.resolving | TensionState | ✅ YES — PhraseEngine density/descend |
| TensionState.harmonic | TensionState | ❌ NOT consumed |
| TensionState.density | TensionState | ❌ NOT consumed |
| TensionState.spectral | TensionState | ❌ NOT consumed |
| TensionState.expectation | TensionState | ❌ NOT consumed |
| StrategyWeights | StrategySelector | ✅ YES — strategy selection |
| PhraseRecord.notes | PhraseState | ✅ YES — transformPhrase in PhraseEngine |

**Summary: 18 of 30 learned fields reach synthesis. 12 are dead.**

---

## 4. WHICH INFORMATION IS CURRENTLY LOST

### Lost between radio audio and observation:
- **Raw waveform** — only FFT bins and RMS survive
- **Stereo information** — radioAnalyser is mono
- **Phase relationships** — not captured
- **Exact onset times** — only band energy ratios (occupancy), not precise onset detection
- **Note durations** — not detected (only pitch at each tick)
- **Velocity/accent patterns** — not detected (only spectral energy)

### Lost between observation and grammar:
- **Temporal order of pitches** — pitchClassHistogram loses sequence
- **Exact rhythm pattern** — kickOnsetPattern is an average, not the actual pattern
- **Motif identity** — no motif extraction from radio
- **Phrase boundaries** — no phrase segmentation from radio
- **Harmonic rhythm** — no chord change detection

### Lost between grammar and generation:
- **BassGrammar** — not consumed anymore (bass uses kick relationship)
- **RhythmGrammar** — not consumed anymore (kick uses hardcoded patterns)
- **4 of 7 tension dimensions** — not consumed
- **3 of 5 melodic grammar fields** — not consumed

### Lost between generation and synthesis:
- **GrooveState.accentMap** — not applied to kick/bass velocity
- **GrooveState.ghostMap** — not applied
- **GrooveState.velocityProfile** — not applied
- **HarmonicState.currentFunction** — not consumed
- **StrategySet.lead** — not consumed by PhraseEngine
- **StrategySet.groove** — not consumed
- **StrategySet.texture** — not consumed
- **StrategySet.transition** — not consumed (no audio events generated)

---

## 5. PROPOSED REFERENCE REPRESENTATION SCHEMA

```typescript
interface ReferenceRepresentation {
  // RHYTHM
  rhythm: {
    bpm: number;
    beatPositions: number[];       // in seconds
    kickOnsets: number[];          // in seconds
    bassOnsets: number[];          // in seconds
    kbPattern: string;             // e.g. "K-B-B-B"
    swing: number;
    microtiming: number[];
    velocityPattern: number[];
  };
  
  // KICK TIMBRE
  kick: {
    fundamentalTrajectory: number[]; // Hz over time
    attackTime: number;              // ms
    decayTime: number;               // ms
    bodyDecay: number;               // ms
    subDecay: number;                // ms
    transientStrength: number;
    spectralCentroid: number;        // Hz
    pitchDrop: { from: number; to: number; duration: number };
  };
  
  // BASS TIMBRE
  bass: {
    fundamental: number;             // Hz
    attackTime: number;              // ms
    decayTime: number;               // ms
    filterStart: number;             // Hz
    filterEnd: number;               // Hz
    filterCloseTime: number;         // ms
    subLevel: number;                // 0-1
    midLevel: number;                // 0-1
    harmonicContent: number;         // 0-1
    spectralCentroid: number;        // Hz
  };
  
  // LEAD (if present)
  lead?: {
    phraseNotes: { time: number; midi: number; duration: number }[];
    contour: number[];
    intervalHistogram: number[];
    register: number;
    density: number;
    spectralCentroid: number;
    envelopeShape: { attack: number; decay: number; sustain: number; release: number };
  };
  
  // ARRANGEMENT
  arrangement: {
    energyCurve: number[];
    sectionBoundaries: number[];
    densityCurve: number[];
  };
}
```

---

## 6. PROPOSED CRITIC SCHEMA

```typescript
interface CriticResult {
  // TIMBRE DISTANCES (0=identical, 1=completely different)
  timbre: {
    kickCentroidDist: number;
    kickDecayDist: number;
    kickTransientDist: number;
    bassCentroidDist: number;
    bassDecayDist: number;
    bassHarmonicDist: number;
    leadCentroidDist: number;
    leadEnvelopeDist: number;
  };
  
  // RHYTHM DISTANCES
  rhythm: {
    bpmDist: number;
    onsetAlignmentDist: number;
    kbPatternDist: number;
    swingDist: number;
    velocityDist: number;
  };
  
  // PITCH DISTANCES
  pitch: {
    pitchClassDist: number;     // histogram L1
    intervalDist: number;       // histogram L1
    contourDist: number;        // correlation
    registerDist: number;
  };
  
  // PHRASE DISTANCES
  phrase: {
    motifRecurrenceDist: number;
    densityCurveDist: number;
    cadenceDist: number;
  };
  
  // ARRANGEMENT DISTANCES
  arrangement: {
    energyCurveDist: number;
    sectionDist: number;
  };
  
  // OVERALL
  overall: number;  // weighted average
  improvements: string[];  // what to fix next
}
```

---

## 7. PROPOSED RECONSTRUCTION LOOP

```
1. LOAD reference.wav (8 bars kick+bass)
2. ANALYZE:
   a. Detect BPM (autocorrelation on low-band envelope)
   b. Detect kick onsets (low-band energy peaks)
   c. Detect bass onsets (mid-low-band energy peaks between kicks)
   d. Extract kick timbre (isolate kick window, analyze spectrum/envelope)
   e. Extract bass timbre (isolate bass window, analyze spectrum/envelope)
   f. Extract K-B timing pattern
3. REPRESENT: Build ReferenceRepresentation
4. GENERATE:
   a. Set BPM from reference
   b. Set kick pattern from reference onsets
   c. Set bass pattern from reference onsets
   d. Set kick synthesis params from reference kick timbre
   e. Set bass synthesis params from reference bass timbre
5. RENDER: Generate WAV using PSY4 voices
6. ANALYZE output: Same analysis as step 2
7. COMPARE: Compute CriticResult
8. REPORT: Distance scores + improvements needed
```

---

## 8. CONCRETE 8-BAR REFERENCE EXPERIMENT

**Reference:** Use the existing `audio-artifacts/REFERENCE-kick-bass-4bar.wav` (synthetic, but has known properties) as the FIRST reference. Then create a SECOND reference with different properties (different kick pitch, different bass pattern, different decay) to prove the system can distinguish them.

**Experiment:**
1. Load REFERENCE-A (current: 120→48Hz kick, 110Hz bass, K-B-B-B pattern, 145 BPM)
2. Load REFERENCE-B (new: 90→40Hz kick, 82Hz bass, K-B-B-- pattern, 138 BPM)
3. Analyze both
4. Generate PSY4 output from each
5. Compare:
   - distance(genA, refA) should be < distance(genA, refB)
   - distance(genB, refB) should be < distance(genB, refA)
6. This proves the system actually heard the difference

**Smallest vertical slice:**
- Load WAV → detect BPM (autocorrelation) → detect kick onsets (peak picking on low-band) → detect bass onsets (peak picking on mid-low between kicks) → extract kick/bass timbre → set generation params → render → compare

---

## 9. WHAT IS NEEDED TO IMPLEMENT THIS

1. **WAV loader** — read WAV file → Float32Array (already possible)
2. **BPM detector** — autocorrelation on low-band envelope
3. **Onset detector** — peak picking on band-energy envelope
4. **Kick/bass isolator** — window extraction around onsets
5. **Timbre extractor** — apply existing AudioFeatureExtractor to isolated windows
6. **Reference → generation adapter** — set BPM, pattern, synth params from reference
7. **Critic** — compute distances between reference and generated features
8. **Render** — use existing OfflineAudioContext rendering

**All of these are implementable with the existing infrastructure (web-audio-api + AudioFeatureExtractor + psyLive voices).**

---

## STOP

This is the design. The smallest vertical slice is:

**REAL WAV → BPM + ONSETS + TIMBRE → GENERATE → RENDER → COMPARE**

Awaiting approval to implement this slice.
