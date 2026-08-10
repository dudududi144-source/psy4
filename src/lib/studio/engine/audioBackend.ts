/**
 * AudioBackend — Task F1-F3: clean architectural separation.
 *
 * ONE interface, TWO implementations (WorkletEngine + LegacyAudioGraph).
 * Psy4EngineV2 uses `this.audio: AudioBackend` everywhere — NO scattered
 * `if (useWorklet)` conditionals. The engine owns musical logic (what notes,
 * when, what params); the backend owns audio (how they sound).
 *
 * Architecture:
 *   MAIN THREAD (Psy4EngineV2)                 AUDIO THREAD (backend)
 *   ├── MusicalDirector (composes phrases)     ├── Voice pool (kick/bass/lead/acid/pad/hat...)
 *   ├── HarmonyEngine                          ├── MoogLadder filters (per voice)
 *   ├── MelodyEngine                           ├── SchroederReverb + StereoDelay
 *   ├── FlowEngine                             ├── Bus processors (comp/sat/HP per bus)
 *   ├── StyleClassifier                        └── Master chain (multiband + glue + limiter)
 *   ├── DJController
 *   ├── LearningMemory
 *   ├── Reference pursuit (computes TARGET params)
 *   └── BRIDGE: this.audio.triggerDrum/Synth/setWorld/setFX
 *
 * Rule: The engine NEVER touches Web Audio nodes. The backend NEVER makes
 * musical decisions. The AudioBackend interface is the ONLY connection.
 *
 * Implementations:
 *   - WorkletEngine     : single AudioWorkletNode, all DSP in worklet (default)
 *   - LegacyAudioGraph  : 1054-node Web Audio graph (fallback for browsers
 *                         without AudioWorklet support)
 *
 * The engine decides which backend to use at init() time. Once decided, it
 * commits — no mid-session switching. Both backends implement the SAME
 * interface, so the engine code is identical regardless of backend.
 */

// ─── Status snapshot returned by getStatus() ───────────────────────────────
export interface AudioBackendStatus {
  /** True when the backend is producing audio (playback transport active). */
  playing: boolean;
  /** 0..1 smoothed CPU load (1.0 = process() took 3ms in worklet, or
   *  frame-time heuristic in legacy). */
  cpuLoad: number;
  /** Current active voice count. */
  activeVoices: number;
}

// ─── Effective params snapshot returned by getParams() ─────────────────────
// Used by the learning memory to snapshot "what the engine is actually doing
// right now" so it can be recalled later. The backend tracks these values as
// they're pushed via setWorld / setFX / setSendLevel / setTrackEffect.
export interface AudioBackendParams {
  // ── Per-voice synthesis params (world params) ──
  kickFundamental?: number;
  kickDecay?: number;
  bassCutoff?: number;
  bassResonance?: number;
  leadCutoff?: number;
  leadDetune?: number;
  padCutoff?: number;
  padAttack?: number;
  padDetune?: number;
  padEvolveRate?: number;
  duck?: number;
  // ── Bus levels ──
  masterLevel?: number;
  bassLevel?: number;
  leadLevel?: number;
  kickLevel?: number;
  // ── Per-track send levels (0..1, averaged across melodic tracks 5/6/7) ──
  sendReverb?: number;
  sendDelay?: number;
  sendChorus?: number;
  sendPhaser?: number;
  // ── FX wet amounts ──
  reverbWet?: number;
  delayWet?: number;
  delayFeedback?: number;
}

// ─── FX config (sent for section automation + reference pursuit) ───────────
export interface AudioBackendFXConfig {
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

// ─── Timbre override for synth voices ──────────────────────────────────────
export interface SynthTimbre {
  cutoff?: number;
  res?: number;
  drive?: number;
}

// ─── Optional triggerSynth options ──────────────────────────────────────────
export interface TriggerSynthOpts {
  /** Step duration in seconds (legacy uses this for gate ratio computation). */
  stepDur?: number;
  /** True when the track is in FM mode (worklet selects V_FM voice). */
  fm?: boolean;
}

// ─── The interface ─────────────────────────────────────────────────────────
export interface AudioBackend {
  // ── Lifecycle ──
  /** Initialize the backend with an AudioContext. Returns true on success. */
  init(ctx: AudioContext): Promise<boolean>;
  /** Start playback transport (worklet: sends 'play'; legacy: no-op). */
  start(): void;
  /** Stop playback transport (worklet: sends 'stop'; legacy: kills voices). */
  stop(): void;
  /** Dispose all resources (disconnect nodes, close ports). */
  dispose?(): void | Promise<void>;

  // ── Note triggering (the bridge) ──
  /**
   * Trigger a drum voice. The engine has already computed the final velocity
   * and decay (pursuit + learning blending). The backend fires the voice.
   *
   * @param track 0=KICK 1=CLAP 2=HATS 3=PERC
   * @param time Absolute AudioContext.currentTime-relative seconds.
   * @param vel 0..1 velocity.
   * @param decay Decay parameter (worklet: seconds; legacy: preset decay param).
   */
  triggerDrum(track: number, time: number, vel: number, decay?: number): void;

  /**
   * Trigger a synth voice. The engine has already computed the final timbre
   * (cutoff/res/drive from world + pursuit + learning + flow override).
   *
   * @param track 4=BASS 5=LEAD 6=PAD 7=ARP
   * @param time Absolute AudioContext.currentTime-relative seconds.
   * @param midi MIDI note number.
   * @param vel 0..1 velocity.
   * @param dur Duration in seconds.
   * @param timbre Cutoff/res/drive override (legacy applies per-note; worklet
   *   uses worldParams).
   * @param opts stepDur (legacy gate ratio), fm (worklet V_FM selection).
   */
  triggerSynth(
    track: number,
    time: number,
    midi: number,
    vel: number,
    dur: number,
    timbre?: SynthTimbre,
    opts?: TriggerSynthOpts,
  ): void;

  /** Trigger a riser FX (last 2 bars of build). */
  triggerRiser(time: number, dur: number): void;
  /** Trigger an impact FX (drop start). */
  triggerImpact(time: number): void;
  /** Trigger a reversed impact (reverseHit surprise). */
  triggerReverseImpact(time: number, intensity: number): void;

  /**
   * Flush any batched events to the audio thread.
   * Worklet: sends the accumulated eventBatch via postMessage (PSY5 batched).
   * Legacy: no-op (events fire immediately in triggerDrum/triggerSynth).
   *
   * Called by the engine at the end of each tick().
   */
  flushEvents(): void;

  // ── Parameter control ──
  /** Set world params (kick fundamental, bass cutoff, lead detune, etc.). */
  setWorld(params: Record<string, number>): void;
  /** Set macro values (energy, psychedelia, darkness, density, etc.). */
  setMacros(macros: Record<string, number>): void;
  /** Set BPM. */
  setBpm(bpm: number): void;
  /** Set FX send levels + wet amounts for section automation. */
  setFX(config: AudioBackendFXConfig): void;
  /**
   * Task PERF-FIX: Batched parameter update. Sends world + fx + bpm + macros
   * in ONE postMessage (instead of 4 separate messages). The worklet handles
   * all four updates in a single message handler — minimizing main→audio
   * thread communication overhead.
   *
   * All fields are OPTIONAL — only the provided ones are applied. This lets
   * the engine batch a setFX + a leadCutoff setWorld (a common per-bar pair
   * from applyFlowAutomation) into one message.
   *
   * Optional — LegacyAudioGraph doesn't implement it (the engine falls back
   * to the individual setters when undefined).
   */
  setParameterBatch?(params: {
    world?: Record<string, number>;
    fx?: AudioBackendFXConfig;
    bpm?: number;
    macros?: Record<string, number>;
  }): void;
  /** Trigger a sidechain duck (when kick fires). */
  triggerDuck(): void;
  /** Notify the backend of a new phrase boundary. */
  newPhrase(): void;
  /** Panic — kill all voices immediately. */
  panic(): void;

  // ── Per-track effect control (legacy-only; worklet no-ops) ──
  // These are used by the effects pursuit + applyWorldEffectSettings +
  // applySectionChorusPhaser to nudge the rich effects system (E1/T1/A1).
  // The worklet has its own internal DSP that responds to setWorld/setFX;
  // these methods are no-ops in worklet mode.
  /** Adjust a per-track SEND level (reverb/delay/chorus/phaser/distortion/bitcrush). */
  setSendLevel?(trackIdx: number, sendName: string, level: number): void;
  /** Adjust a per-track effect parameter (eq/comp/sat/pan/haas/send). */
  setTrackEffect?(trackIdx: number, effectName: string, value: number): void;
  /** Adjust a global send-effect parameter (chorus rate, phaser feedback, etc.). */
  setSendEffectParam?(effectName: string, param: string, value: number): void;
  /** Adjust a master multiband compressor parameter. */
  setMasterParam?(name: string, value: number): void;

  // ── Surprise event audio manipulation (legacy-only; worklet no-ops) ──
  // The worklet handles surprises via note gating (scheduleStep) + setFX
  // (applyFlowAutomation). These methods are for the legacy graph's
  // gain-node manipulation.
  /** Scale a track's gain (for dropOut surprise). depth=0..1 (0=mute, 1=full). */
  setTrackGainScale?(trackIdx: number, scale: number, time: number): void;
  /** Scale the master gain (for silence surprise). */
  setMasterGainScale?(scale: number, time: number): void;
  /** Restore default gain levels (called when a surprise ends). */
  restoreDefaults?(time: number): void;

  // ── Analysis + status ──
  /** Get the AnalyserNode (for the UI's spectrum/waveform display). */
  getAnalyser(): AnalyserNode | null;
  /** Get the current status snapshot (playing, cpuLoad, activeVoices). */
  getStatus(): AudioBackendStatus;
  /** Get the current effective params (for learning memory snapshot). */
  getParams(): AudioBackendParams;
}
