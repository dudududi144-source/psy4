# F10 SYSTEM FORENSIC AUDIT

## COMPLETE CALL GRAPH + AUDIO GRAPH + ROOT CAUSE ANALYSIS

### 1. FULL CALL GRAPH (actual runtime path)

```
UI: Play button click
  ↓
psyLive.play()
  ↓
ensureAudio()
  ├── new AudioContext()
  ├── master = createGain(0.9)
  ├── analyser = createAnalyser(512)
  ├── safetyLimiter = createDynamicsCompressor(-1dB, 20:1)
  ├── master → safetyLimiter → analyser → destination
  ├── delaySend → delay(0.3s, fb=0.34) → wet(0.22) → master
  ├── kickBus(0.9), bassBus(0.85), leadBus(0.7), hatBus(0.6)
  ├── engineBus(0.8) → comp(-18dB, 2:1) → master
  ├── kickBus, bassBus, leadBus, hatBus → engineBus
  ├── transport = new MusicalTransport(nowFn, {initialBpm: 145})
  ├── radioLayer = new RadioObservationLayer(config)
  └── session = new MusicalSession(42)
  ↓
transport.start()
  ↓
setInterval(scheduler, 25ms)
  ↓
scheduler()
  ├── now = ctx.currentTime
  ├── snap = transport.snapshot()
  ├── stepDur = snap.beatDuration / 4
  ├── compute next 16th-note step from beat grid
  └── while (stepTime < now + 0.15s)
        └── scheduleStep(stepIdx, stepTime)
              ↓
              session.planBar(bar, bpm)  [cached per bar]
                ↓
                MusicalContext.updateFromTransport()
                ├── RadioMusicalWindow.snapshot()
                ├── detectStyle()
                ├── handleNewPhrase() [if barInPhrase == 0]
                │   └── generateMotif() or transformMotif()
                ├── generateKick()     → notes[]
                ├── generateBass()     → notes[]
                ├── generateHats()     → notes[]
                └── generateLead()     → notes[] [optional, density-gated]
              ↓
              for each note in plan.notes where step == s16:
                ├── kick → this.kick(time)
                │     └── osc(sine, 150→44Hz) → gain(1.0→0.001) → kickBus
                ├── bass → this.bass(time, freq, variant)
                │     └── osc(sawtooth) → filter(LP 700→245Hz) → gain(0.85→0.001) → bassBus
                ├── lead → this.lead(time, freq, variant, accent)
                │     └── 2×osc(sawtooth, detuned) → filter(LP 180→240Hz) → gain(0.45→0.001) → leadBus
                └── hat → this.hat(time, vel)
                      └── bufferSource(noise) → filter(HP 7000Hz) → gain → hatBus
```

### 2. FULL AUDIO GRAPH

```
KICK OSC → gain → kickBus(0.9) ─┐
BASS OSC → filter → gain → bassBus(0.85) ─┤
LEAD 2×OSC → filter → gain → leadBus(0.7) ─┤→ engineBus(0.8) → comp(-18dB, 2:1) → master(0.9) → safetyLimiter(-1dB, 20:1) → analyser → destination
HAT SRC → filter → gain → hatBus(0.6) ─┘

RADIO: HTMLAudioElement → MediaElementSource → radioGain(0.5) → radioAnalyser → master

DELAY: delaySend → delay(0.3s, fb=0.34) → wet(0.22) → master
  bass sends 0.12 to delay
  lead sends 0.3 to delay
```

### 3. STARTUP LEAD ROOT CAUSE

**The lead is NOT a bug in register or octave.** F9 already fixed the register to MIDI 53-67 (octave 3-4). The trace confirms:

- Bar 0: Lead notes at MIDI 65, 64, 61, 58 (F4, E4, C#4, A#3) — these are in the correct lower register
- Bar 1-2: Lead at MIDI 62, 61 (D4, C#4) — correct register
- Bars 3-4: No lead (REST) — correct

**The actual problem the user hears is NOT register — it's TIMBRE.**

The lead synth uses:
- **Sawtooth wave** (harsh, buzzy)
- **Filter cutoff: 180Hz → 240Hz** (very dark, but still buzzy because sawtooth has strong harmonics)
- **Q=9** (high resonance, creates a whistling peak)
- **Dual detuned oscillators** (creates a beating, chorused sound)
- **Lead gain: 0.45** → leadBus(0.7) = effective 0.315
- **30% delay send** (creates echoes that reinforce the lead)

The combination of sawtooth + high Q + delay creates a piercing, persistent sound that dominates the mix even at moderate gain. The kick (sine, no harmonics) and bass (sawtooth but filtered to 245Hz) are both darker and less present.

**ROOT CAUSE: The lead TIMBRE (sawtooth + high Q + delay) makes it psychoacoustically dominant regardless of its MIDI pitch.** The user perceives it as "high-pitched" because the sawtooth harmonics extend into the upper frequency range, even though the fundamental is at 233-349 Hz.

### 4. KICK ROOT CAUSE

**Kick is NOT missing.** F9 fixed this — kick is present on 100% of bars (4 kicks per bar, steps 0/4/8/12).

**The problem is kick LEVEL and TIMBRE:**
- Kick: sine 150→44Hz, gain 1.0→0.001, decay 0.3s, → kickBus(0.9) → engineBus(0.8)
- Effective kick level at master: 1.0 × 0.9 × 0.8 × 0.9 = 0.648
- Bass: gain 0.85, → bassBus(0.85) → engineBus(0.8)
- Effective bass level: 0.85 × 0.85 × 0.8 × 0.9 = 0.520
- Lead: gain 0.45, → leadBus(0.7) → engineBus(0.8)
- Effective lead level: 0.45 × 0.7 × 0.8 × 0.9 = 0.227

**Kick is actually the LOUDEST element** (0.648 vs 0.520 vs 0.227). But the compressor at -18dB with 2:1 ratio may be reducing the kick's transient impact. The kick's sine wave has no harmonics, making it psychoacoustically less "present" than the sawtooth bass and lead.

**ROOT CAUSE: Kick timbre is too soft (pure sine, no click, no punch). It lacks the high-frequency transient that makes kicks audible in a mix.**

### 5. BASS ROOT CAUSE

**Bass IS present and interlocks with kick (F9 fix confirmed: B/K=4 per bar).**

But the bass timbre has issues:
- Sawtooth wave at MIDI 45 (A2, 110Hz) — correct register
- Filter: 700Hz → 245Hz (sweeping down, killing harmonics quickly)
- Q=6 (moderate resonance)
- Decay: 0.2s (very short, staccato)
- The short decay (0.2s) means the bass is barely audible between kick hits

**ROOT CAUSE: Bass decay is too short (0.2s) and filter sweeps too aggressively (700→245Hz in 0.16s), making the bass sound like clicky plucks rather than a sustained groove.**

### 6. RADIO ROOT CAUSE

**Radio does NOT break the engine anymore.** F9 fixed the ABSTAIN bug.

But radio has a different problem:
- Radio connects to `master` (not engineBus), so it bypasses the compressor
- Radio gain is 0.5 — quite loud relative to engine
- When radio plays, it sums with the engine output at master
- The safety limiter (-1dB, 20:1) catches peaks but doesn't prevent masking
- Radio's full-frequency content masks the engine's kick and bass

**ROOT CAUSE: Radio connects directly to master, bypassing the compressor and creating masking. The engine should duck when radio is present, but the ducking (role bus gains) is too subtle.**

### 7. UI ROOT CAUSE

**Working controls:** Play/Stop, Volume, Radio Connect/Disconnect, Radio Volume, Preset Selection, Variant A/B, Composition toggle

**Dead/misleading controls:**
- Preset buttons change `setPreset()` which sets transport BPM and delay time — but the MusicalSession generates its own patterns, so the preset's kick/bass/lead/hat patterns are IGNORED. Only the synth parameters (wave type, filter cutoff, Q, level) from the variant are used.
- Variant A/B changes synth params but the difference is barely audible (leadCut 1800 vs 2600, leadQ 9 vs 14)
- The "KICKS" counter shows radio-detected kicks, not engine-played kicks
- "ENGINE BPM" and "RADIO BPM" show the same value (both from Transport)
- The occupancy display (LOW/MID/HIGH) shows radio bands, not engine output
- No style selector
- No per-channel volume/mute
- No groove/density/tension controls
- The learned panel shows statistical data that doesn't affect musical output

**ROOT CAUSE: UI shows radio analysis data and preset metadata, not the actual musical state of MusicalSession. Controls are connected to legacy preset system, not to the active composer.**

### 8. FX/ROUTING FAILURES

- No reverb (only delay)
- Delay is shared (bass and lead both send to same delay)
- No per-channel sends
- No stereo width
- No sidechain
- Compressor is on engine bus only (radio bypasses it)
- No EQ on individual channels

### 9. DUPLICATE SYSTEMS

| System | Active? | Notes |
|--------|---------|-------|
| MusicalSession | YES | The single composer (F8) |
| Preset patterns (kick/bass/lead/hat arrays) | NO | Ignored by MusicalSession |
| Preset variant params (wave/cut/Q/lvl) | YES | Used by synth voice functions |
| PatternMutator | NO | Not called (MusicalSession does its own mutation) |
| Learning system (learning.ts) | PARTIAL | `recordKick` is called but results don't affect composition |
| RadioStateGate (old) | NO | Replaced by RadioObservationLayer |
| BeatPLL | YES | Feeds Transport via RadioObservationLayer |

### 10. DEAD CODE

- `patternMutator.ts` — not called by runtime
- `learning.ts` — `recordKick/recordBassNote` called but results not consumed
- `PRESETS` patterns (kick/bass/lead/hat arrays) — ignored, only variant params used
- `radioStateGate.ts` — kept for backward compat but not used

### 11. COMPONENTS TO KEEP

- MusicalTransport (proven)
- RadioObservationLayer (proven)
- BeatPLL (proven)
- MelodyObserver (proven)
- MusicalSession (structure is correct, needs timbre fixes)
- MusicalContext (proven)
- MusicalMemory (proven)
- RadioMusicalWindow (proven)
- All primitives (scales, motif, rhythm, bass, rng)

### 12. COMPONENTS TO DELETE

- `patternMutator.ts` (not used)
- `radioStateGate.ts` (replaced, not used)
- `learning.ts` (bookkeeping only, not consumed)

### 13. COMPONENTS TO REBUILD

- **Voice functions (kick/bass/lead/hat)** — need timbre improvements
- **UI** — needs to show MusicalSession state, add style/groove/density controls
- **Preset system** — needs to be simplified to just synth params, not patterns

### 14. RECOMMENDED FIXES (in order)

**P0: Fix lead timbre** (the actual "high lead" complaint)
- Change lead wave from sawtooth to triangle (softer, fewer harmonics)
- Reduce Q from 9 to 4 (less whistling)
- Reduce delay send from 0.3 to 0.15 (less echo reinforcement)
- Lower lead gain from 0.45 to 0.30

**P1: Fix kick punch**
- Add a noise click at attack (3ms burst through highpass)
- Increase decay from 0.3s to 0.5s
- Add slight pitch emphasis at attack (180Hz instead of 150Hz)

**P2: Fix bass sustain**
- Increase decay from 0.2s to 0.35s
- Reduce filter sweep range (500→300Hz instead of 700→245Hz)
- Increase sustain level

**P3: Fix radio routing**
- Route radio through engineBus (so compressor applies)
- Or: add sidechain ducking on engine when radio is active

**P4: Fix UI**
- Show MusicalSession state (style, role, section, tension)
- Add style selector
- Add per-channel volume
- Remove dead preset pattern display
