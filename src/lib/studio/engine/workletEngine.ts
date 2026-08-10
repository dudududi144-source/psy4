/**
 * WorkletEngine — Task W1 unified AudioWorklet bridge.
 *
 * Replaces the 1054-node Web Audio NODE GRAPH inside Psy4EngineV2 with a
 * SINGLE AudioWorkletNode that contains ALL DSP (Moog ladder, polyBLEP,
 * Schroeder reverb, stereo delay, bus processors, master chain, 18 voice
 * types including the new FM voice).
 *
 * Architecture (PSY5 model — single worklet, RT-safe):
 *   Main thread (Psy4EngineV2 — musical logic only)
 *     ├─ Harmony, melody, style detection, learning, DJ sync, flow, director
 *     ├─ tick() → ask director for window notes → build Float64Array batch
 *     └─ port.postMessage({type:'events', events: Float64Array})  ← BATCHED
 *   AudioWorklet (psy4-engine.js — DSP only)
 *     ├─ 256-slot ring buffer (PSY5 proven size)
 *     ├─ Preallocated voice pools (zero per-block allocation)
 *     ├─ Polynomial ftanh (Pade approx — 10x cheaper than Math.tanh)
 *     ├─ CPU-load monitoring + dynamic voice budget
 *     └─ Bus processors + master chain + Schroeder reverb + ping-pong delay
 *     ↓ stereo output
 *   AnalyserNode → AudioContext.destination
 *
 * The main thread decides WHAT notes to play (musical logic); the worklet
 * decides HOW they sound (DSP). This is the PSY5 separation of concerns.
 *
 * Why this is 5-10x more efficient than the node graph:
 *   - 1 AudioWorkletNode vs 1054 createOscillator/Gain/Filter nodes
 *   - No per-hit node creation (voices are preallocated pools inside worklet)
 *   - No GC pressure (zero allocation in process())
 *   - No AudioParam connection overhead (params are direct function args)
 *   - No main-thread scheduling jitter (worklet runs on audio thread)
 *
 * Voice ID constants mirror public/worklets/psy4-engine.js. Keep in sync.
 */

import type {
  AudioBackend,
  AudioBackendStatus,
  AudioBackendParams,
  AudioBackendFXConfig,
  SynthTimbre,
  TriggerSynthOpts,
} from './audioBackend';

// ─── Voice IDs (mirror worklet) ────────────────────────────────────────────
export const VOICE = {
  KICK: 0, BASS: 1, LEAD: 2, ACID: 3, PAD: 4,
  HAT: 5, HAT_OPEN: 6, CLAP: 7, PERC: 8, SHAKER: 9,
  TEXTURE: 10, RISER: 11, IMPACT: 12, SWEEP: 13,
  ZAP: 14, BLIP: 15, DOWNLIFTER: 16, FM: 17,
} as const;
export type VoiceId = typeof VOICE[keyof typeof VOICE];

// ─── Track → Voice mapping (used by Psy4EngineV2 facade) ───────────────────
// Track indices match Psy4EngineV2's 8-track model:
//   0=KICK  1=SNARE/CLAP  2=HATS  3=PERC  4=BASS  5=LEAD  6=PAD  7=ARP
// The worklet voice IDs are different (see VOICE above), so we map.
export function trackToVoiceId(track: number, opts?: { fmLead?: boolean; fmArp?: boolean }): VoiceId {
  switch (track) {
    case 0: return VOICE.KICK;
    case 1: return VOICE.CLAP;
    case 2: return VOICE.HAT;
    case 3: return VOICE.PERC;
    case 4: return VOICE.BASS;
    case 5: return opts?.fmLead ? VOICE.FM : VOICE.LEAD;
    case 6: return VOICE.PAD;
    case 7: return opts?.fmArp ? VOICE.FM : VOICE.ACID;
    default: return VOICE.KICK;
  }
}

// ─── Stats reported by the worklet ─────────────────────────────────────────
export interface WorkletStats {
  playing: boolean;
  step: number;
  activeVoices: number;
  eventCount: number;
  currentFrame: number;
  /** 0..1 smoothed CPU load (1.0 = process() took 3ms). */
  cpuLoad: number;
  /** Dynamic voice ceiling — drops under overload, restores when light. */
  voiceBudget: number;
  /** Last process() duration in ms (for diagnostics). */
  processMs: number;
}

// ─── FX config (sent to worklet for section automation) ────────────────────
export interface WorkletFXConfig extends AudioBackendFXConfig {
  /** [drum, bass, music, atmos, fx] reverb send amounts 0..1. */
  reverbSends?: number[];
  /** [drum, bass, music, atmos, fx] delay send amounts 0..1. */
  delaySends?: number[];
  /** Reverb wet 0..1. */
  reverbWet?: number;
  /** Delay wet 0..1. */
  delayWet?: number;
  /** Delay feedback 0..0.9. */
  delayFeedback?: number;
}

// ─── Status snapshot returned by getStatus() ───────────────────────────────
export interface WorkletStatus extends AudioBackendStatus {
  /** Dynamic voice ceiling (drops under overload). */
  voiceBudget: number;
}

// ─── WorkletEngine ─────────────────────────────────────────────────────────

/**
 * Unified AudioWorklet bridge. Owns the AudioContext, the AudioWorkletNode,
 * and an AnalyserNode tap. Exposes a minimal, typed API that Psy4EngineV2
 * (the facade) calls into.
 *
 * Lifecycle:
 *   const engine = new WorkletEngine();
 *   await engine.init();              // loads worklet module, creates node
 *   engine.start('dark-psy');         // sends 'play' to worklet
 *   engine.setBpm(145);
 *   engine.setWorld({ kickFundamental: 50, ... });
 *   engine.sendEventBatch(float64Array); // notes to play
 *   engine.stop();
 *
 * The AudioContext is created lazily inside init() (after a user gesture —
 * required by browsers for audio playback).
 */
export class WorkletEngine implements AudioBackend {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private stats: WorkletStats = {
    playing: false, step: 0, activeVoices: 0, eventCount: 0,
    currentFrame: 0, cpuLoad: 0, voiceBudget: 32, processMs: 0,
  };
  private statsListeners: Array<(stats: WorkletStats) => void> = [];
  private moduleLoaded = false;
  private loadPromise: Promise<boolean> | null = null;
  /**
   * Task F1-F3: per-tick event batch builder. The engine calls
   * triggerDrum/triggerSynth during scheduleStep(); events accumulate here.
   * flushEvents() sends them in ONE postMessage (PSY5 batched) at the end
   * of tick(). This is the bridge between main-thread musical logic and
   * audio-thread DSP.
   */
  private eventBatch: EventBatchBuilder = new EventBatchBuilder();
  /**
   * Task F1-F3: effective params cache. Mirrors what we've pushed via
   * setWorld / setFX so getParams() can return them without a round-trip
   * to the worklet (the worklet is on the audio thread — we can't query it
   * synchronously). Updated on every setWorld / setFX call.
   */
  private effectiveWorld: Record<string, number> = {};
  private effectiveFX: AudioBackendFXConfig = {};
  private effectiveMacros: Record<string, number> = {};

  /** The AudioContext (created in init()). Exposed for the facade. */
  get context(): AudioContext | null { return this.ctx; }

  /** The AudioWorkletNode (null until init() completes). */
  get workletNode(): AudioWorkletNode | null { return this.node; }

  /** True if the worklet module + node are ready for events. */
  get ready(): boolean { return this.node !== null && this.moduleLoaded; }

  /**
   * Initialize the AudioContext, load the worklet module, and create the
   * AudioWorkletNode + AnalyserNode. Safe to call multiple times — subsequent
   * calls are no-ops if already initialized.
   *
   * MUST be called from a user-gesture handler (click/keypress) so the
   * AudioContext starts in 'running' state.
   *
   * @param latencyHintOrCtx Either an AudioContextLatencyCategory for a new
   *   context, OR an existing AudioContext to reuse (e.g., shared with a
   *   legacy engine facade). Reusing avoids creating two AudioContexts (which
   *   would double the audio thread overhead).
   * @returns true if the worklet is ready; false if loading failed.
   */
  async init(
    latencyHintOrCtx: AudioContextLatencyCategory | AudioContext = 'interactive',
  ): Promise<boolean> {
    if (this.ctx && this.node && this.moduleLoaded) return true;

    // Create or reuse AudioContext
    if (!this.ctx) {
      if (latencyHintOrCtx instanceof AudioContext) {
        // Reuse an existing context (facade pattern — Psy4EngineV2 shares
        // its context so we don't double the audio-thread overhead).
        this.ctx = latencyHintOrCtx;
      } else {
        // Create a new context (lazy — must be from a user gesture)
        const w = typeof window !== 'undefined' ? window : undefined;
        const Ctx: (typeof AudioContext) | undefined =
          (w && (w.AudioContext || (w as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)) ||
          undefined;
        if (!Ctx) {
          console.warn('[WorkletEngine] No AudioContext available');
          return false;
        }
        this.ctx = new Ctx({ latencyHint: latencyHintOrCtx });
      }
    }

    // Resume if suspended (autoplay policy)
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* user gesture required */ }
    }

    // Load the worklet module (cached per-context)
    if (!this.moduleLoaded && !this.loadPromise) {
      this.loadPromise = this.ctx.audioWorklet.addModule('/worklets/psy4-engine.js')
        .then(() => { this.moduleLoaded = true; return true; })
        .catch((e) => {
          console.warn('[WorkletEngine] Failed to load worklet module:', e);
          this.loadPromise = null;
          return false;
        });
    }
    if (this.loadPromise) {
      const ok = await this.loadPromise;
      if (!ok) return false;
    }

    // Create the AudioWorkletNode
    if (!this.node) {
      try {
        this.node = new AudioWorkletNode(this.ctx!, 'psy4-engine', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          channelCount: 2,
          channelCountMode: 'explicit',
          channelInterpretation: 'speakers',
        });
      } catch (e) {
        console.warn('[WorkletEngine] Failed to create AudioWorkletNode:', e);
        return false;
      }

      // Wire stats messages from the worklet
      this.node.port.onmessage = (e: MessageEvent) => {
        const msg = e.data as Partial<WorkletStats> & { type: string };
        if (msg.type === 'stats') {
          // Merge incoming stats (worklet sends a subset; preserve local defaults)
          this.stats = {
            playing: msg.playing ?? false,
            step: msg.step ?? 0,
            activeVoices: msg.activeVoices ?? 0,
            eventCount: msg.eventCount ?? 0,
            currentFrame: msg.currentFrame ?? 0,
            cpuLoad: msg.cpuLoad ?? 0,
            voiceBudget: msg.voiceBudget ?? 32,
            processMs: msg.processMs ?? 0,
          };
          // Notify listeners (UI pulls this on its own cadence; the worklet
          // posts at ~10 Hz so this is cheap).
          for (const fn of this.statsListeners) {
            try { fn(this.stats); } catch { /* listener error — ignore */ }
          }
        }
      };
    }

    // Create analyser + connect: worklet → analyser → destination
    if (!this.analyser) {
      this.analyser = this.ctx!.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.78;
      this.node!.connect(this.analyser);
      // Only connect to destination if this is OUR context (not a shared one
      // — the facade's context already has its own destination wiring, and
      // double-connecting would cause the worklet output to play twice).
      // We ALWAYS connect the analyser to destination because the worklet's
      // output must reach the speakers. The facade (Psy4EngineV2) does NOT
      // connect anything else to destination when useWorklet=true — the
      // worklet is the sole audio source.
      this.analyser.connect(this.ctx!.destination);
    }

    return true;
  }

  /**
   * Start playback. Sends 'play' to the worklet. The worklet resets its
   * transport (step=0, currentSample=0).
   *
   * @param worldId Optional world id (sent for the worklet's reference; the
   *   worklet doesn't use it directly but main thread uses it for tracking).
   */
  start(_worldId?: string): void {
    if (!this.node) return;
    this.stats.playing = true;
    this.node.port.postMessage({ type: 'play' });
  }

  /** Stop playback. Sends 'stop' to the worklet — all voices deactivated. */
  stop(): void {
    if (!this.node) return;
    this.stats.playing = false;
    this.node.port.postMessage({ type: 'stop' });
  }

  /**
   * Send a batch of events to the worklet. PSY5 pattern: ALL step events go
   * in ONE message (not one message per event) to minimize postMessage
   * overhead.
   *
   * Event layout (Float64Array, 6 floats per event):
   *   [time, voice, note, velocity, duration, param,  // event 0
   *    time, voice, note, velocity, duration, param,  // event 1
   *    ...]
   *
   * `time` is an absolute AudioContext.currentTime-relative seconds value
   * (must be in the future, within the worklet's 256-event ring buffer
   * capacity — typically < 100ms ahead).
   *
   * The Float64Array buffer is transferred (zero-copy) — the caller MUST NOT
   * reuse it after calling this.
   */
  sendEventBatch(events: Float64Array): void {
    if (!this.node || events.length === 0) return;
    // Transfer the underlying ArrayBuffer (zero-copy) — PSY5 optimization.
    // The worklet receives ownership; we detach our reference.
    const buffer = events.buffer;
    // Only transfer if the buffer is not already detached (defensive —
    // a detached buffer has byteLength 0).
    const transferList = buffer.byteLength > 0 ? [buffer] : [];
    this.node.port.postMessage({ type: 'events', events }, transferList);
  }

  /**
   * Trigger a single immediate event (for UI actions like "Drop now").
   * Uses 'trigger' message — the worklet enqueues it directly.
   */
  triggerImmediate(
    voice: VoiceId,
    note: number = 0,
    velocity: number = 1,
    duration: number = 0.2,
    param: number = 0,
  ): void {
    if (!this.node || !this.ctx) return;
    const time = this.ctx.currentTime + 0.02; // 20ms ahead for immediate response
    this.node.port.postMessage({
      type: 'trigger', time, voice, note, velocity, duration, param,
    });
  }

  // ─── Parameter control ────────────────────────────────────────────────

  /** Set world params (kick fundamental, bass cutoff, lead detune, etc.). */
  setWorld(params: Record<string, number>): void {
    // Task F1-F3: cache effective params so getParams() can return them
    // without a round-trip to the audio thread.
    for (const k of Object.keys(params)) {
      const v = params[k];
      if (typeof v === 'number' && isFinite(v)) this.effectiveWorld[k] = v;
    }
    if (!this.node) return;
    this.node.port.postMessage({ type: 'world', params });
  }

  /** Set macro values (energy, psychedelia, darkness, density, etc.). */
  setMacros(macros: Record<string, number>): void {
    for (const k of Object.keys(macros)) {
      const v = macros[k];
      if (typeof v === 'number' && isFinite(v)) this.effectiveMacros[k] = v;
    }
    if (!this.node) return;
    this.node.port.postMessage({ type: 'macros', macros });
  }

  /** Set BPM. */
  setBpm(bpm: number): void {
    if (!this.node) return;
    this.node.port.postMessage({ type: 'bpm', bpm });
  }

  // ─── Section / phrase control ─────────────────────────────────────────

  /** Notify the worklet of a new phrase boundary (rotates phrase-locked samples). */
  newPhrase(): void {
    if (!this.node) return;
    this.node.port.postMessage({ type: 'newPhrase' });
  }

  /** Set FX send levels + wet amounts for section automation. */
  setFX(config: WorkletFXConfig): void {
    // Cache for getParams().
    this.effectiveFX = { ...this.effectiveFX, ...config };
    if (!this.node) return;
    this.node.port.postMessage({ type: 'setFX', ...config });
  }

  /** Trigger a sidechain duck (when kick fires). */
  triggerDuck(): void {
    if (!this.node) return;
    this.node.port.postMessage({ type: 'duck' });
  }

  /** Panic — kill all voices immediately (audio emergency stop). */
  panic(): void {
    if (!this.node) return;
    this.node.port.postMessage({ type: 'panic' });
  }

  // ─── Task F1-F3: AudioBackend note triggering ─────────────────────────
  //
  // The engine calls these during scheduleStep(). Events accumulate in
  // eventBatch (PSY5 batched postMessage — minimizes main→audio thread
  // communication). flushEvents() sends the batch at the end of tick().
  //
  // Track → voice ID mapping (mirror of trackToVoiceId):
  //   0=KICK 1=CLAP 2=HAT 3=PERC 4=BASS 5=LEAD/FM 6=PAD 7=ACID/FM

  /** AudioBackend: trigger a drum voice. Enqueues into eventBatch. */
  triggerDrum(track: number, time: number, vel: number, decay?: number): void {
    if (!this.node) return;
    const voiceId = trackToVoiceId(track);
    const v = Number.isFinite(vel) ? Math.max(0, Math.min(1, vel)) : 0;
    // The worklet's kick voice takes (time, amp, fund, decay, sr) — we encode
    // decay as the `duration` field (in seconds). Other drums use duration as
    // a generic decay envelope length.
    const dur = (decay !== undefined && Number.isFinite(decay) && decay > 0)
      ? decay
      : (track === 0 ? 0.2 : 0.15);
    this.eventBatch.add(time, voiceId, 0, v, dur, 0);
    // Kick triggers sidechain duck — tell the worklet.
    if (track === 0) this.triggerDuck();
  }

  /** AudioBackend: trigger a synth voice. Enqueues into eventBatch. */
  triggerSynth(
    track: number,
    time: number,
    midi: number,
    vel: number,
    dur: number,
    _timbre?: SynthTimbre,
    opts?: TriggerSynthOpts,
  ): void {
    if (!this.node) return;
    // The worklet's event format carries (time, voice, note, vel, dur, param).
    // Per-note timbre (cutoff/res/drive) isn't in the event — the worklet's
    // voices use their internal worldParams for cutoff. The engine pushes
    // timbre changes via setWorld ({ leadCutoff, bassCutoff, ... }) which
    // the worklet applies to its voice pool.
    const fm = opts?.fm === true;
    const voiceId: VoiceId = trackToVoiceId(track, { fmLead: fm, fmArp: fm });
    const v = Number.isFinite(vel) ? Math.max(0, Math.min(1, vel)) : 0;
    const note = Number.isFinite(midi) ? midi : 60;
    const duration = (Number.isFinite(dur) && dur > 0) ? dur : 0.1;
    // `param` encodes the FM ratio (×10) for V_FM voice; 0 otherwise.
    const param = voiceId === VOICE.FM ? 20 : 0; // ratio 2.0
    this.eventBatch.add(time, voiceId, note, v, duration, param);
  }

  /** AudioBackend: trigger a riser FX voice. */
  triggerRiser(time: number, dur: number): void {
    if (!this.node) return;
    this.eventBatch.add(time, VOICE.RISER, 0, 0.35, dur, 0);
  }

  /** AudioBackend: trigger an impact FX voice. */
  triggerImpact(time: number): void {
    if (!this.node) return;
    this.eventBatch.add(time, VOICE.IMPACT, 0, 0.7, 0.5, 0);
  }

  /** AudioBackend: trigger a reversed impact (reverseHit surprise). */
  triggerReverseImpact(time: number, intensity: number): void {
    if (!this.node) return;
    const i = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 0.5;
    this.eventBatch.add(time, VOICE.IMPACT, 0, 0.5 * i, 0.6, 0);
  }

  /**
   * AudioBackend: flush the accumulated event batch to the worklet.
   * PSY5 batched postMessage — ALL step events go in ONE message (not one
   * per event) to minimize main→audio thread communication overhead.
   *
   * Called by the engine at the end of tick(). The Float64Array buffer is
   * TRANSFERRED (zero-copy) — the worklet takes ownership.
   */
  flushEvents(): void {
    if (!this.node || this.eventBatch.empty) return;
    const events = this.eventBatch.build();
    this.eventBatch.reset();
    if (events.length === 0) return;
    // Transfer the underlying ArrayBuffer (zero-copy) — PSY5 optimization.
    const buffer = events.buffer;
    const transferList = buffer.byteLength > 0 ? [buffer] : [];
    this.node.port.postMessage({ type: 'events', events }, transferList);
  }

  // ─── Task F1-F3: legacy-only effect methods (worklet no-ops) ──────────
  // The worklet has its own internal DSP (Moog ladder, Schroeder reverb,
  // bus processors). The rich effects system (E1/T1/A1 — per-track racks,
  // multiband, send effects) is a LEGACY-ONLY construct. These methods are
  // no-ops in worklet mode; the engine calls them unconditionally and the
  // worklet silently ignores them. The worklet's setWorld / setFX / setMacros
  // cover the equivalent functionality.

  /** AudioBackend (worklet no-op): per-track send level. */
  setSendLevel(_trackIdx: number, _sendName: string, _level: number): void {
    // No-op — worklet uses setFX for reverb/delay sends per bus.
  }

  /** AudioBackend (worklet no-op): per-track effect parameter. */
  setTrackEffect(_trackIdx: number, _effectName: string, _value: number): void {
    // No-op — worklet uses setWorld for per-voice timbre.
  }

  /** AudioBackend (worklet no-op): global send-effect parameter. */
  setSendEffectParam(_effectName: string, _param: string, _value: number): void {
    // No-op — worklet has its own chorus/phaser built into the voices.
  }

  /** AudioBackend (worklet no-op): master multiband parameter. */
  setMasterParam(_name: string, _value: number): void {
    // No-op — worklet has its own master chain (multiband + glue + limiter).
  }

  /** AudioBackend (worklet no-op): track gain scale (surprise dropOut). */
  setTrackGainScale(_trackIdx: number, _scale: number, _time: number): void {
    // No-op — worklet handles dropOut via note gating in scheduleStep.
  }

  /** AudioBackend (worklet no-op): master gain scale (surprise silence). */
  setMasterGainScale(_scale: number, _time: number): void {
    // No-op — worklet handles silence via note gating in scheduleStep.
  }

  /** AudioBackend (worklet no-op): restore default gains (endActiveSurprise). */
  restoreDefaults(_time: number): void {
    // No-op — worklet's FX state is driven by setFX from applyFlowAutomation.
  }

  // ─── Analysis tap ─────────────────────────────────────────────────────

  /** Get the AnalyserNode (for the UI's spectrum/waveform display). */
  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  // ─── Status ───────────────────────────────────────────────────────────

  /** Get the current status snapshot (last reported by the worklet). */
  getStatus(): WorkletStatus {
    return {
      playing: this.stats.playing,
      cpuLoad: this.stats.cpuLoad,
      activeVoices: this.stats.activeVoices,
      voiceBudget: this.stats.voiceBudget,
    };
  }

  /**
   * Task F1-F3: AudioBackend.getParams() — return the effective params
   * currently pushed to the worklet. Used by the learning memory to
   * snapshot "what the engine is actually doing right now".
   *
   * The worklet is on the audio thread — we can't query it synchronously.
   * Instead we return the cached values from setWorld / setFX calls.
   * This is an approximation (the worklet may have applied smoothing), but
   * it's accurate enough for the learning memory's purpose (storing
   * "good" param configurations for later recall).
   */
  getParams(): AudioBackendParams {
    // Average per-bus reverb/delay sends into a single "sendReverb/sendDelay"
    // value (the learning memory stores averaged melodic sends).
    const reverbSends = this.effectiveFX.reverbSends;
    const delaySends = this.effectiveFX.delaySends;
    let sendReverb = 0;
    let sendDelay = 0;
    if (reverbSends && reverbSends.length >= 5) {
      // music bus (index 2) is the main melodic treatment.
      sendReverb = reverbSends[2] ?? 0;
    }
    if (delaySends && delaySends.length >= 5) {
      sendDelay = delaySends[2] ?? 0;
    }
    return {
      kickFundamental: this.effectiveWorld.kickFundamental,
      kickDecay: this.effectiveWorld.kickDecay,
      bassCutoff: this.effectiveWorld.bassCutoff,
      bassResonance: this.effectiveWorld.bassResonance,
      leadCutoff: this.effectiveWorld.leadCutoff,
      leadDetune: this.effectiveWorld.leadDetune,
      padCutoff: this.effectiveWorld.padCutoff,
      padAttack: this.effectiveWorld.padAttack,
      padDetune: this.effectiveWorld.padDetune,
      padEvolveRate: this.effectiveWorld.padEvolveRate,
      duck: this.effectiveWorld.duck,
      sendReverb,
      sendDelay,
      reverbWet: this.effectiveFX.reverbWet,
      delayWet: this.effectiveFX.delayWet,
      delayFeedback: this.effectiveFX.delayFeedback,
    };
  }

  /** Get the full stats (includes step, eventCount, currentFrame, processMs). */
  getFullStats(): WorkletStats {
    return { ...this.stats };
  }

  /** Subscribe to worklet stats updates (~10 Hz). Returns an unsubscribe fn. */
  onStats(fn: (stats: WorkletStats) => void): () => void {
    this.statsListeners.push(fn);
    return () => {
      const i = this.statsListeners.indexOf(fn);
      if (i >= 0) this.statsListeners.splice(i, 1);
    };
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Dispose the engine — disconnect the worklet, close the AudioContext.
   * After dispose(), the engine cannot be reused (create a new instance).
   */
  async dispose(): Promise<void> {
    if (this.node) {
      try { this.node.disconnect(); } catch { /* already disconnected */ }
      try { this.node.port.close(); } catch { /* port already closed */ }
      this.node = null;
    }
    if (this.analyser) {
      try { this.analyser.disconnect(); } catch { /* already disconnected */ }
      this.analyser = null;
    }
    if (this.ctx) {
      try { await this.ctx.close(); } catch { /* already closed */ }
      this.ctx = null;
    }
    this.moduleLoaded = false;
    this.loadPromise = null;
    this.statsListeners.length = 0;
    this.stats = {
      playing: false, step: 0, activeVoices: 0, eventCount: 0,
      currentFrame: 0, cpuLoad: 0, voiceBudget: 32, processMs: 0,
    };
  }
}

// ─── Event batch builder ───────────────────────────────────────────────────
/**
 * Helper for the main thread to build a Float64Array batch incrementally.
 * Psy4EngineV2's tick() loop creates one of these per tick, appends events
 * as the director yields notes, then calls sendEventBatch() to flush.
 *
 * Preallocates a fixed-capacity backing array (no per-event allocation).
 * If the batch overflows, the oldest events are dropped (defensive — should
 * never happen with 256 slots at 145 BPM).
 */
export class EventBatchBuilder {
  static readonly EVENT_SIZE = 6;
  static readonly MAX_EVENTS = 256;

  private buf: Float64Array;
  private count = 0;

  constructor() {
    this.buf = new Float64Array(EventBatchBuilder.MAX_EVENTS * EventBatchBuilder.EVENT_SIZE);
  }

  /** Number of events currently in the batch. */
  get size(): number { return this.count; }

  /** True if the batch is empty. */
  get empty(): boolean { return this.count === 0; }

  /**
   * Append an event. If the batch is full, the event is dropped (returns false).
   * PSY7 safety: clamps velocity to [0,1], duration to [0.001, 10].
   */
  add(time: number, voice: VoiceId, note: number, velocity: number, duration: number, param: number = 0): boolean {
    if (this.count >= EventBatchBuilder.MAX_EVENTS) return false;
    // PSY7: clamp + finite-check to prevent NaN crashes in the worklet
    if (!Number.isFinite(time) || !Number.isFinite(voice) || !Number.isFinite(note) ||
        !Number.isFinite(velocity) || !Number.isFinite(duration)) {
      return false;
    }
    const base = this.count * EventBatchBuilder.EVENT_SIZE;
    this.buf[base] = time;
    this.buf[base + 1] = voice;
    this.buf[base + 2] = note;
    this.buf[base + 3] = Math.max(0, Math.min(1, velocity));
    this.buf[base + 4] = Math.max(0.001, Math.min(10, duration));
    this.buf[base + 5] = Number.isFinite(param) ? param : 0;
    this.count++;
    return true;
  }

  /**
   * Build the Float64Array to send to the worklet. Returns a VIEW of the
   * internal buffer (so the caller must sendEventBatch() immediately and
   * not hold the reference). After sendEventBatch(), the buffer is
   * transferred to the worklet — the caller MUST call reset() to reuse.
   */
  build(): Float64Array {
    if (this.count === 0) return new Float64Array(0);
    // Return a subarray view (no copy). sendEventBatch() will transfer the
    // underlying buffer's slice — but Transferable only works on the FULL
    // ArrayBuffer, so we copy the filled portion into a fresh buffer.
    // This is a per-tick allocation, but tick() runs at ~40 Hz, not per-sample.
    const out = new Float64Array(this.count * EventBatchBuilder.EVENT_SIZE);
    out.set(this.buf.subarray(0, this.count * EventBatchBuilder.EVENT_SIZE));
    return out;
  }

  /** Reset the batch for reuse (after build() + sendEventBatch()). */
  reset(): void {
    this.count = 0;
  }
}
