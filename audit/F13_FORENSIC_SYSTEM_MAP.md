# F13 — FORENSIC SYSTEM MAP

**HEAD:** `017ef70` (F11 "Device rebuild") · **Date:** 2026-08-12 · **Auditor:** Principal Systems Engineer
**Method:** Read every line of `psyLive.ts` (1054), `MusicalSession.ts` (385), `RadioObservationLayer.ts` (367), `MusicalContext.ts` (225), `MusicalTransport.ts` (506), `motif.ts` (178), `page.tsx` (290), plus 4 parallel forensic subagent reports.

This document maps the **real** runtime call graph — not the documented one. Every edge is traced to a line number.

---

## 1. THE REAL CALL GRAPH (Engine Path)

```
USER (browser)
  │
  ▼ click ▶ Play
page.tsx:66  engineRef.current?.play()
  │
  ▼
psyLive.ts:533  play()
  ├─ ensureAudio()  [psyLive.ts:349]
  │    ├─ new AudioContext()                         [351]
  │    ├─ master = createGain()  (0.9)               [355]
  │    ├─ analyser = createAnalyser()  (fft=512)     [357]
  │    ├─ safetyLimiter = createDynamicsCompressor() [361] (-1dB, 20:1, 3ms)
  │    │    master → safetyLimiter → analyser → destination  [367-369]
  │    ├─ delaySend → delay(0.3s) → wet(0.22) → master  [372-379]
  │    ├─ delay → delayFb(0.34) → delay  (feedback loop)  [380]
  │    ├─ reverbSend(0) → convolver(1.8s IR) → reverbWet(0.5) → master  [383-389]
  │    ├─ noiseBuf = 0.25s white noise              [392-395]
  │    ├─ transport = new MusicalTransport(() => ctx.currentTime, {bpm:145})  [403]
  │    ├─ transportAdapter = new TransportAdapter(transport)  [406]  ← DEAD: 0 method calls
  │    ├─ radioLayer = new RadioObservationLayer(...)  [411]
  │    ├─ session = new MusicalSession(42)           [418]
  │    ├─ kickBus(0.95), bassBus(0.85), leadBus(0.5), hatBus(0.55)  [422-425]
  │    ├─ engineBus(0.8)                              [427]
  │    ├─ comp = createDynamicsCompressor() (-18dB, 2:1)  [431-436]
  │    └─ kickBus/bassBus/leadBus/hatBus → engineBus → comp → master  [439-444]
  │
  ├─ transport.start()  [538]  ← sets initial anchor
  ├─ setInterval(scheduler, 25ms)  [542]  ← WAKE-UP only, not the clock
  └─ startUITimer()  [543]  ← setInterval(emit, 500ms)

  ▼ every 25ms
psyLive.ts:641  scheduler()
  ├─ snap = transport.snapshot()  [645]  ← beatTime, beatIndex, bar, bpm
  ├─ stepDur = snap.beatDuration / 4  [646]  ← 16th note duration
  ├─ stepTime = snap.beatTime + (stepsSinceBeat+1) * stepDur  [655]
  └─ while (stepTime < now + scheduleAheadTime):
       └─ scheduleStep(stepIdx, stepTime)  [661]

  ▼
psyLive.ts:673  scheduleStep(stepIndex, time)
  ├─ snap = transport.snapshot()  [675]
  ├─ currentBar = snap.bar  [677]
  ├─ v = getVariant()  [678]  ← PRESETS[presetId].variants[variant]
  ├─ if (!currentNotePlan || currentNotePlan.bar !== currentBar):
  │    currentNotePlan = session.planBar(currentBar, snap.bpm)  [682]  ← COMPOSITION
  ├─ notes = currentNotePlan.notes.filter(n => n.step === s16)  [686]
  └─ for each note:
       ├─ 'kick': if (occupancy.kick < 0.7) kick(time)  [690]  ← GATING
       ├─ 'hat':  hat(time, v.hatLvl * note.velocity)   [693]
       ├─ 'bass': if (occupancy.bass < 0.75 && midi) bass(time, mtof(midi), v)  [696]
       └─ 'lead': if (occupancy.lead < 0.85 && midi) lead(time, mtof(midi), v, accent)  [699]

  ▼ COMPOSITION (once per bar)
foundation/music/MusicalSession.ts:94  planBar(bar, transportBpm)
  ├─ ctx.updateFromTransport(bar, bpm)  [95]  ← sets targetTension from COMPOSITION_ARC
  ├─ snap = ctx.snapshot(bar)  [96]  ← section, tension, rootPc, scale
  ├─ radio = window.snapshot(bar)  [97]
  ├─ barInPhrase = bar % 8  [98]
  ├─ action = BAR_ACTIONS[barInPhrase]  [99]  ← introduce/repeat/repeat/develop/...
  ├─ if barInPhrase===0: handleNewPhrase()  [102-107]  ← generates motif
  ├─ generateKick(notes, snap, barInPhrase)    [125]  ← 4-on-floor, ALWAYS
  ├─ generateBass(notes, snap, barInPhrase)    [128]  ← 8 notes, interlocked
  ├─ generateHats(notes, snap, barInPhrase)    [131]  ← 4 offbeat hats
  ├─ leadDensity = calculateLeadDensity(snap, radio, barInPhrase)  [134]
  ├─ if leadDensity > 0: generateLead(...)  [135-136]  ← ← STARTUP LEAD ENTERS HERE
  ├─ if barInPhrase===7: evaluatePhrase()  [142]  ← reward computed, stored, NEVER USED
  └─ return NotePlan  [144-152]

  ▼ VOICES (Web Audio)
psyLive.ts:448  kick(t)   → osc(sine, 180→44Hz) + noise click → kickBus
psyLive.ts:472  hat(t,lvl) → noiseSrc → HPF(7kHz) → hatBus
psyLive.ts:483  bass(t,f,v) → osc(sawtooth) → LPF(cut, Q) → bassBus  (+ delay send 0.08)
psyLive.ts:501  lead(t,f,v,a) → 2×osc(triangle, 7¢ detune) → LPF(Q*0.5, 200→peakCut→300) → leadBus
                                (+ delay send 0.12, reverb send 0.15)

  ▼ BUSSES → MASTER → OUTPUT
kickBus ─┐
bassBus ─┤
leadBus ─┼→ engineBus(0.8) → comp(-18dB,2:1) → master(0.9) → safetyLimiter(-1dB,20:1) → analyser → destination
hatBus  ─┘                                                                    ↑
delay → wet(0.22) ──────────────────────────────────────────────────────────┘
convolver → reverbWet(0.5) ─────────────────────────────────────────────────┘
```

---

## 2. THE REAL CALL GRAPH (Radio Path)

```
USER clicks CONNECT
page.tsx:74  engine.connectRadio(stream)
  │
  ▼
psyLive.ts:731  connectRadio(stream)
  ├─ new Audio()  [737]
  ├─ createMediaElementSource(radioEl)  [740]
  ├─ radioGain = createGain(0.5)  [742-743]  ← created ONCE, reused
  ├─ radioAnalyser = createAnalyser(fft=512)  [744-746]  ← created ONCE, reused
  ├─ radioSource → radioGain → radioAnalyser → engineBus  [749-752]  ← F10 fix
  │
  ├─ radioGate.reset() / markConnecting() / markConnected()  [755-757]
  │    ⚠️ These target RadioStateGate, NOT RadioObservationLayer!
  │    ⚠️ radioLayer.markConnected() is NEVER CALLED.
  │
  ├─ syncStatus = 'connecting'  [758]
  ├─ radioEl.play()  [760]
  └─ startDetection()  [763]  ← setInterval(detect, 200ms)

  ▼ every 200ms
psyLive.ts:797  detect()
  ├─ radioAnalyser.getByteFrequencyData(fd)  [803]
  ├─ radioAnalyser.getFloatTimeDomainData(tdBuf)  [807]
  ├─ radioSnap = radioLayer.process(tdBuf, fd, audioTime)  [812]
  │    │
  │    ▼
  │  RadioObservationLayer.ts:75  process()
  │    ├─ rms, peak, nonZeroRatio computed  [81-93]
  │    ├─ spectralEnergy computed  [95-97]
  │    ├─ updateSignalState(rms, nonZeroRatio, signalAgeSec, ...)  [111]
  │    │    │
  │    │    ▼
  │    │  RadioObservationLayer.ts:259  updateSignalState()
  │    │    └─ if signalState === 'DISCONNECTED' || 'CONNECTING': RETURN  [266-269]
  │    │       ⚠️ signalState is 'DISCONNECTED' (constructor default, line 48)
  │    │       ⚠️ markConnected() never called → state NEVER transitions out
  │    │       ⚠️ ENTIRE SIGNAL STATE MACHINE IS DEAD
  │    │
  │    ├─ occupancy computed (kick/bass/lead/hats from band energy)  [113-136]  ← ALIVE
  │    ├─ if signalState === 'SIGNAL_PRESENT' || 'STABLE_SIGNAL':  [141]
  │    │    └─ BEAT DETECTION BLOCK  ← NEVER ENTERED (state is DISCONNECTED)
  │    │       ⚠️ beatObservation stays null
  │    │
  │    ├─ if signalState === 'SIGNAL_PRESENT' || 'STABLE_SIGNAL':  [183]
  │    │    └─ PITCH OBSERVATION BLOCK  ← NEVER ENTERED
  │    │       ⚠️ RadioPitchObservation never produced
  │    │
  │    └─ return snapshot  ← beat=null, pitch=null, signal.state='DISCONNECTED'
  │
  ├─ if (radioSnap.beat)  [819]  ← ALWAYS FALSE
  │    └─ transport.observeBeat(...)  [820]  ← NEVER CALLED
  │       ⚠️ PLL NEVER GETS OBSERVATIONS → NEVER LOCKS
  │
  ├─ syncStatus updated from radioSnap.signal.observationState  [829-842]
  │    └─ observationState = 'NO_SIGNAL' (stuck) → syncStatus = 'no_signal'
  │
  ├─ occupancy = radioSnap.occupancy  [845]  ← ALIVE (spectral bands)
  │
  ├─ if (radioSnap.signal.state !== 'NO_SIGNAL')  [848]
  │    └─ 'DISCONNECTED' !== 'NO_SIGNAL' → TRUE → observeRadio() IS called
  │       └─ session.observeRadio({bpm: transportSnap.bpm, energy, occupancy, bassFreq:undefined, confidence:0})
  │          ⚠️ bassFreq is always undefined (psyLive.bassFreq never written)
  │          ⚠️ bpm is the ENGINE's own bpm (circular, not radio-detected)
  │          ⚠️ confidence is 0 (no beat)
  │
  ├─ ROLE DUCKING  [867-877]  ← ALIVE (overwrites user mixer settings)
  │    ├─ kickBus.gain = occupancy.kick > 0.7 ? 0.05 : 0.9
  │    ├─ bassBus.gain = occupancy.bass > 0.75 ? 0.35 : 0.85
  │    ├─ leadBus.gain = occupancy.lead > 0.85 ? 0.55 : 0.7
  │    └─ hatBus.gain = 0.6  (constant, ignores user)
  │
  ├─ style detection (classifyStyle)  [895]  ← ALIVE (overwrites user style)
  ├─ learning (recordKick only if transportSnap.locked)  [922]  ← NEVER (PLL never locks)
  └─ emit()  [940]
```

---

## 3. EDGE-BY-EDGE AUDIT

### 3.1 UI → State edges

| Edge | Producer | Consumer | Data | Timing | Ownership | Failure Mode |
|------|----------|----------|------|--------|-----------|--------------|
| Play click → play() | page.tsx:66 | psyLive:533 | none | onclick | psyLive | ✅ works |
| VOL slider → setVolume | page.tsx:159 | psyLive:570 | number 0-1 | onchange | psyLive.master | ✅ works |
| STYLE btn → setStyle | page.tsx:187 | psyLive:595 | string | onclick | MusicalSession.style | ⚠️ overwritten by detectStyle every 200ms |
| ENERGY slider → setEnergy | page.tsx:198 | psyLive:603 | number | onchange | **BROKEN** | ❌ TypeError: getContext() not a function |
| DENSITY slider → setDensity | page.tsx:200 | psyLive:607 | number | onchange | **BROKEN** | ❌ TypeError |
| TENSION slider → setTension | page.tsx:202 | psyLive:611 | number | onchange | **BROKEN** | ❌ TypeError |
| KICK slider → setChannelVolume | page.tsx:215 | psyLive:576 | 'kick', v | onchange | psyLive.kickBus | ⚠️ clobbered by detect() when radio on |
| BASS slider → setChannelVolume | page.tsx:216 | psyLive:576 | 'bass', v | onchange | psyLive.bassBus | ⚠️ clobbered |
| LEAD slider → setChannelVolume | page.tsx:217 | psyLive:576 | 'lead', v | onchange | psyLive.leadBus | ⚠️ clobbered |
| HATS slider → setChannelVolume | page.tsx:218 | psyLive:576 | 'hat', v | onchange | psyLive.hatBus | ⚠️ clobbered (forced to 0.6) |
| DELAY slider → setDelayAmount | page.tsx:226 | psyLive:582 | number | onchange | psyLive.delaySend | ✅ works |
| FEEDBACK slider → setDelayFeedback | page.tsx:227 | psyLive:586 | number | onchange | psyLive.delayFb | ✅ works |
| REVERB slider → setReverbSend | page.tsx:228 | psyLive:590 | number | onchange | psyLive.reverbSend | ✅ works |
| Stream select → setStreamId | page.tsx:236 | page.tsx local | string | onchange | React state | ✅ works (indirect) |
| CONNECT → connectRadio | page.tsx:240 | psyLive:731 | Stream | onclick | psyLive | ⚠️ audio works, follower dead |
| DISCONNECT → disconnectRadio | page.tsx:242 | psyLive:769 | none | onclick | psyLive | ✅ works |
| Radio VOL → setRadioVolume | page.tsx:249 | psyLive:789 | number | onchange | psyLive.radioGain | ✅ works (immediate, not smoothed) |

### 3.2 Composition → Scheduler edges

| Edge | Producer | Consumer | Data | Timing | Failure Mode |
|------|----------|----------|------|--------|--------------|
| planBar() → NotePlan | MusicalSession:94 | psyLive:682 | ScheduledNote[] | once per bar | ✅ cached correctly |
| NotePlan.notes → scheduleStep | psyLive:686 | psyLive:673 | filtered by step | every 16th | ✅ |
| transport.snapshot() → scheduler | MusicalTransport | psyLive:645 | beatTime, bar, bpm | every 25ms | ✅ zero drift |
| occupancy → scheduleStep gating | psyLive:214 | psyLive:690,696,699 | 0-1 per role | every 200ms | ⚠️ clobbers user intent |

### 3.3 Radio → Composition edges

| Edge | Producer | Consumer | Data | Status |
|------|----------|----------|------|--------|
| radioAnalyser → radioLayer.process | psyLive:803-807 | RadioObservationLayer:75 | tdBuf, fd, audioTime | ✅ |
| radioLayer → radioSnap.beat | RadioObservationLayer | psyLive:819 | RadioBeatObservation | ❌ DEAD (always null) |
| radioSnap.beat → transport.observeBeat | psyLive:820 | MusicalTransport | {time, confidence, source} | ❌ NEVER CALLED |
| radioSnap.occupancy → session.observeRadio | psyLive:849 | MusicalSession:83 | {kick,bass,lead,hats} | ✅ alive |
| radioSnap.signal.spectralEnergy → session | psyLive:851 | MusicalContext:112 | number | ✅ alive |
| bassFreq → session | psyLive:853 | MusicalContext:130 | number | ❌ DEAD (always undefined) |
| radioSnap.pitch → ??? | RadioObservationLayer:183 | NOBODY | RadioPitchObservation | ❌ DEAD (never produced, never consumed) |

---

## 4. WHAT RUNS VS WHAT DOESN'T

### 4.1 Runs at HEAD (verified by code trace)

1. **Transport clock** — MusicalTransport is the single source of musical time. Anchor-based, zero drift. ✅
2. **Scheduler** — reads transport.snapshot(), schedules 16th notes directly. ✅
3. **Kick voice** — 4-on-floor, always present, sine+click. ✅
4. **Bass voice** — 8 notes/bar, interlocked with kick, sawtooth+LPF. ✅
5. **Hat voice** — 4 offbeat hats, noise+HPF. ✅
6. **Lead voice** — triangle, LPF, delay+reverb send. Enters from bar 0. ✅ (but unwanted at startup)
7. **Delay FX** — 0.3s delay, feedback loop, wet 0.22. ✅
8. **Reverb FX** — 1.8s IR convolver, wet 0.5. ✅
9. **Compressor** — engineBus → comp(-18dB, 2:1). ✅
10. **Safety limiter** — master → safetyLimiter(-1dB, 20:1). ✅
11. **Radio audio routing** — radioSource → radioGain → radioAnalyser → engineBus → comp → master. ✅ (F10 fix real)
12. **Radio spectral occupancy** — band energy → kick/bass/lead/hats occupancy. ✅
13. **Role ducking** — bus gains adjusted by occupancy. ✅ (but clobbers user mixer)
14. **Style detection** — occupancy → FULL_ON/DARK/PROGRESSIVE/ACID. ✅ (but overwrites user choice)
15. **64-bar composition arc** — INTRO→STATEMENT→...→RESOLUTION, cycles infinitely. ✅
16. **Phrase structure** — A-A-B-A-A-B-C-A (8 phrases). ✅
17. **Motif generation** — call-and-response, 32 steps, octave 4. ✅
18. **Motif transforms** — transpose/invert/fragment/retrograde. ✅
19. **Phrase evaluation** — reward computed, EMA-stored. ✅ (but never used)
20. **Learning persistence** — kicks/bass saved to localStorage. ✅ (but never read back meaningfully)

### 4.2 Does NOT run at HEAD (verified by code trace)

1. **Radio beat detection** — signalState stuck at DISCONNECTED, beat block never entered. ❌ P0
2. **Radio tempo following** — transport.observeBeat never called, PLL never locks. ❌ P0
3. **Radio pitch observation** — pitch block never entered, RadioPitchObservation never produced. ❌ P0
4. **Radio key detection** — bassFreq never written, MusicalContext key branch never fires. ❌ P1
5. **setEnergy / setDensity / setTension** — getContext() doesn't exist, TypeError. ❌ P0
6. **MusicalMemory.pickMotif** — the reward-using selector is never called. ❌ P1 (learning is fake)
7. **TransportAdapter** — instantiated, 0 method calls. ❌ P2 (dead code)
8. **psyLive.pll** (BeatPLL field) — never fed observations, only reset on disconnect. ❌ P2 (dead code)
9. **psyLive.melodyObserver** — observe() never called, only ensureTimeDomainBuf(). ❌ P2 (dead code)
10. **psyLive.radioGate.observe()** — never called, gate frozen at CONNECTED_NO_SIGNAL. ❌ P2 (dead code)
11. **Variant.leadWave** — lead() hardcodes triangle, ignores preset's leadWave. ❌ P2 (dead field)
12. **PRESETS patterns** — MusicalSession generates its own patterns, PRESETS only used for bpm+variants. ❌ P2 (dead data)
13. **session.reset()** — never called from psyLive, state leaks across reconnects. ❌ P2
14. **34,185 lines of studio/engine/** — 83% dead (28,456 lines), 17% API-only (5,729 lines), 0% live. ❌ P2

---

## 5. THE GAP

The system has a **clean clock** (Transport) and a **working scheduler**, but every layer ABOVE and BELOW the clock is fractured:

- **Above (composition):** MusicalSession writes notes, but psyLive.scheduleStep decides whether to play them (occupancy gating), and psyLive.detect decides how loud (bus ducking). Three owners of musical output.
- **Below (audio):** Clean bus → comp → master → limiter chain, but radio is bolted on with a dead observation pipeline. The radio audio flows correctly but its analysis is severed at the signalState gate.
- **Sideways (UI):** 24 controls, 9 actually affect audio. 3 throw TypeErrors. 5 are clobbered by the detect loop. The UI is a dashboard wearing an instrument costume.

The system is not "almost there." It is a working clock inside a broken body.
