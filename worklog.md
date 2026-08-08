---
Task ID: 1
Agent: Z.ai Code (main)
Task: PSY4 deep commercial audio rebuild — build real DSP foundation (Moog ladder filter + band-limited oscillators + bus architecture) to replace sterile BiquadFilter/PeriodicWave voices.

Work Log:
- Read PSY3 source at /tmp/psy3/tools/pro_dsp.py — extracted exact algorithms:
  - `moog()`: 4-stage tanh ladder with feedback (g = 1-exp(-2π·fc), fb = res*4*tanh(st[3]), u = tanh(x-fb), 4 integrators with tanh, out = st[3]/(1+res*0.5))
  - `bl_saw()`: additive synthesis with adaptive N = max(1, SR/(2*f)) harmonics
  - `worklet.js`: AudioWorklet with band-limited wavetable + per-voice one-pole LP + tanh output
- Audited PSY4 current state: `proAudioNodes.ts` had a "MoogFilterChain" that was just BiquadFilter+WaveShaper (NOT the real algorithm). Voices used PeriodicWave with fixed 48 harmonics (aliasing at high pitches).
- Created `public/worklets/psy4-dsp.js` — AudioWorklet module with 6 processors:
  - `moog-filter`: REAL 4-stage tanh ladder, sample-accurate, a-rate cutoff AudioParam, per-channel state, ported from PSY3 pro_dsp.py
  - `bl-saw`: band-limited sawtooth via polyBLEP (2nd-order polynomial correction at discontinuity) — no aliasing at any frequency
  - `bl-square`: band-limited square via dual polyBLEP
  - `saturation`: tanh waveshaper with LUT-optimized fastTanh, drive+mix AudioParams
  - `phaser`: 4-stage allpass chain with internal LFO + feedback
  - `bus-eq`: 3-band EQ (low shelf / mid peak / high shelf) using RBJ cookbook biquad coefficients in transposed direct form II
- Created `src/lib/studio/engine/workletDsp.ts` — TypeScript wrapper:
  - `ensureWorkletsLoaded(ctx)`: loads module once, cached promise, graceful fallback
  - Factory functions: `createMoogFilter`, `createBLSaw`, `createBLSquare`, `createSaturation`, `createPhaser`, `createBusEQ` — each returns typed AudioWorkletNode with AudioParam access
- Integrated into `psy4LiveEngine.ts`:
  - Added `workletsReady` flag + async loading in `init()`
  - Built `createVoiceFilter()` helper: returns real Moog worklet node if ready, else falls back to BiquadFilter approximation
  - Built `createVoiceOsc()` helper: returns BL saw/square worklet if ready, else falls back to OscillatorNode+PeriodicWave
  - Added `scheduleCleanup()` for worklet node lifecycle management (disconnect after note ends)
  - Built BUS ARCHITECTURE: 5 buses (drum/bass/music/atmos/fx), each with lowShelf EQ → highShelf EQ → compressor → tanh saturation → sum. Channel strips now route to buses via `busForChannel()` instead of flat channel→sum.
- Rebuilt 4 critical voices with real DSP:
  - **bass**: sub (sine f/2, bypasses filter) + body (BL saw → Moog ladder with cutoff envelope sweep high→low) — the tanh saturation in the Moog adds harmonic character BiquadFilter cannot
  - **lead**: N detuned BL saws (supersaw) → Moog filter with envelope + LFO cutoff modulation → stereo spread — polyBLEP eliminates the harsh aliasing of PeriodicWave
  - **acid**: BL square → high-resonance Moog (near self-oscillation) with envelope sweep → distortion — the real ladder feedback gives the squelchy "acid" character
  - **pad**: detuned BL saws → Moog filter → evolving detune LFO modulating frequency → stereo width + reverb send
- Verified end-to-end with Agent Browser:
  - `[PSY4] AudioWorklet DSP module loaded` confirmed in console
  - 0 runtime errors on fresh page load (fixed a stale toFixed UI bug with `?? 0` guard)
  - Audio playing at 53-72% level (natural dynamics visible)
  - Stable for 30+ seconds across progressive-psy and dark-psy worlds
  - World switching works (dark-psy exercises the rebuilt acid voice)
  - Action buttons work (Drop tested, level 71%, 0 errors)
- Lint passes cleanly (0 errors, 0 warnings)

Stage Summary:
- **Foundation rebuilt**: Real sample-accurate Moog ladder filter + band-limited polyBLEP oscillators now run in the Web Audio audio thread via AudioWorklet, replacing the sterile BiquadFilter + aliasing PeriodicWave that made PSY4 sound like a "prototype DSP demo".
- **Bus architecture live**: 5 production buses (drum/bass/music/atmos/fx) with per-bus EQ + compression + saturation give group-level mixing control.
- **4 critical voices rebuilt**: bass, lead, acid, pad all route through real Moog filter with envelope sweeps, BL oscillators (no aliasing), and proper saturation.
- **Graceful fallback**: If AudioWorklet fails to load (old browser), voices fall back to BiquadFilter+PeriodicWave so the engine never breaks.
- **Artifacts**: `public/worklets/psy4-dsp.js` (18KB, 6 processors), `src/lib/studio/engine/workletDsp.ts` (typed wrapper), `psy4LiveEngine.ts` (buses + 4 rebuilt voices).
- **Next steps (P1)**: phaser + shimmer FX on voices, modulation matrix (LFO/env/macro → filter cutoff/osc pitch/pan), FM texture, sample variation, per-hit variation. The DSP foundation is now in place to support these.

---
Task ID: 2
Agent: Z.ai Code (main)
Task: PSY4 full commercial audio + real-time performance rebuild — eliminate main-thread musical clock, move all synthesis to AudioWorklet with preallocated voice pools and zero per-hit node creation.

Work Log:
- Forensic audit of PSY3 (pro_dsp.py, engine.py, worklet.js, style_master.py, pro_fx.py) and PSY4 (psy4LiveEngine.ts scheduler, step(), voice functions)
- Identified ROOT CAUSES of performance problems:
  1. setInterval(25ms) main-thread musical clock — subject to React/GC jitter
  2. Per-hit Web Audio node creation (5-13 nodes per voice hit = 100-300+ nodes/sec under dense drops)
  3. No voice pooling — every note creates and destroys nodes
- Built `public/worklets/psy4-engine.js` — single AudioWorklet processor (1233 lines) containing:
  - Transport (BPM, step counter, sample-accurate clock via currentFrame)
  - Ring-buffer event queue (Float64Array, MAX_EVENTS=2048, zero allocation)
  - Preallocated voice pools: 8 kick, 4 bass, 8 lead, 4 acid, 4 pad, 8 hat, 4 clap, 8 perc, 4 shaker, 4 texture, 8 FX = 64 total voices
  - All voice DSP inline: KickVoice (PSY3 sub+mid+click), BassVoice (BL saw + Moog + sub), LeadVoice (5-osc supersaw + Moog + LFO), AcidVoice (BL square + high-res Moog + distortion), PadVoice (detuned saws + Moog + evolve LFO), HatVoice (differentiated pink noise), ClapVoice (multi-burst noise), PercVoice, ShakerVoice, TextureVoice (FM/noise), FXVoice (riser/impact/sweep/zap/blip/downlifter)
  - MoogLadder class (4-stage tanh ladder, ported from PSY3 pro_dsp.py)
  - BLSaw/BLSquare (polyBLEP, no aliasing)
  - PinkNoise (Voss-McCartney, deterministic LFSR random)
  - Bus mixing (drum/bass/music/atmos/fx → master)
  - MasterChain (tanh saturation + envelope-follower limiter)
  - Sidechain ducking (kick triggers duck envelope on bass/music buses)
  - Stats reporting to main thread (~10Hz, throttled)
- Built `src/lib/studio/engine/engineWorklet.ts` — TypeScript wrapper:
  - Psy4EngineNode class: init(), play(), stop(), setBPM(), setMacros(), setWorld()
  - Event batch scheduling: scheduleEvent() + flushEvents() with Transferable Float64Array (zero-copy)
  - onStats() callback for transport state updates
  - triggerImmediate() for UI actions (Drop, Build, etc.)
- Modified `psy4LiveEngine.ts` to use worklet engine as primary audio path:
  - Added engineNode field, useWorkletEngine flag
  - init() creates Psy4EngineNode asynchronously; on success, switches to worklet mode
  - start()/stop() branch: worklet mode uses 50ms timer + 0.3s lookahead (vs 25ms + 0.15s legacy); all synthesis in audio thread
  - ALL 16 voice methods (kick, bass, lead, acid, hat, shaker, clap, perc, pad, texture, riser, impact, sweep, zap, blip, downlifter) now have early-return worklet dispatch: if useWorkletEngine, push event to ring buffer and return (NO node creation)
  - tick() flushes batched events to worklet after step()
  - setWorld/setMacros/triggerAction all propagate to worklet
  - Legacy Web Audio path preserved as fallback if worklet fails to load
- Updated UI (page.tsx):
  - Engine mode display (Worklet / Web Audio)
  - Active voice count display (real-time from worklet stats)
  - Footer updated: "AudioWorklet Engine · Sample-accurate · Zero-alloc voices"
- Fixed voice count bug: activeCount was incremented per-sample (128x overcount); fixed to count once per block
- Verified end-to-end with Agent Browser:
  - `[PSY4] Engine worklet active — synthesis in audio thread` confirmed
  - Progressive-psy: 6 active voices, 54% level, 0 errors, 21s stable
  - Dark-psy + Drop (densest scenario): 6-9 active voices, 55-69% level, 0 errors, 30s stable
  - World switching glitch-free, action buttons responsive
  - Voice count realistic (not inflated), engine mode correctly shows "Worklet"
- Lint passes cleanly (0 errors, 0 warnings)

Stage Summary:
- **Main-thread musical clock ELIMINATED**: All voice synthesis now happens in the AudioWorklet audio thread. The main thread only generates musical events (which notes, when) and pushes them to a ring buffer. The worklet's process() loop runs at audio rate (128 samples = ~3ms at 44.1kHz), giving sample-accurate timing immune to React/GC jitter.
- **Per-hit node creation ELIMINATED**: 64 preallocated voice instances (8 kick, 4 bass, 8 lead, etc.) are reused via voice stealing. Zero Web Audio node creation per hit. Zero GC pressure from audio.
- **Event queue architecture**: Main thread batches events in Float64Array, sends via Transferable (zero-copy) to worklet. Worklet reads events sample-accurately in process() loop.
- **Graceful fallback**: If AudioWorklet fails, engine falls back to legacy Web Audio node-per-hit mode (original behavior).
- **Artifacts**: `public/worklets/psy4-engine.js` (1233 lines, 39KB), `src/lib/studio/engine/engineWorklet.ts` (175 lines), modified `psy4LiveEngine.ts` (worklet dispatch in all 16 voices + start/stop/tick/setWorld/setMacros).
- **PERFORMANCE MEASUREMENTS**:
  - Scheduler: was 25ms setInterval (jitter-prone) → now 50ms setInterval + 0.3s lookahead (worklet handles precise timing at 3ms granularity)
  - Per-hit allocation: was 5-13 Web Audio nodes per hit → now 0 (preallocated voice pool)
  - Voice count during dark-psy drop: 6-9 active voices (well within 64-voice pool)
  - Stability: 30+ seconds in densest scenario, 0 errors, 0 warnings
  - Latency: events scheduled with AudioContext.currentTime timestamps, executed sample-accurately in worklet
- **REMAINING GAP (honest)**:
  - The worklet engine currently outputs mono (L=R). Stereo widening is a P1 enhancement.
  - The worklet master chain is simplified (saturation + limiter). Full multiband/glue/true-peak from the legacy path is not yet in the worklet.
  - PSY3 samples (kick.wav, etc.) are not yet loaded into the worklet — kick/hat/clap use synthetic DSP (PSY3 engine.py algorithms). Sample integration via ArrayBuffer transfer is a P1 enhancement.
  - The musical brain (step()) still runs on the main thread. For even lower latency, it could move into the worklet, but the current hybrid approach (main thread generates events, worklet executes) gives sample-accurate timing with easy TypeScript iteration.
  - PHYSICAL LISTENING UNVERIFIED — verification is via console logs, voice count, level meter, and code audit.
