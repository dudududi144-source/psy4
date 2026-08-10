/**
 * FLOW ENGINE (Task F1)
 * =====================
 *
 * Replaces the fixed `arrangement` array in Psy4EngineV2 with a dynamic,
 * creative, radio-responsive flow engine.
 *
 * ## Why
 * The old arrangement was a fixed recipe:
 *   INTRO(4) → GROOVE(4) → BUILD(4) → DROP(8) → VARIATION(4) → BREAK(4) →
 *   FINAL DROP(8) → OUTRO(4)
 * Every play-through walked the same path with the same section lengths.
 * The user's complaint: "Section מהווה בעיה על זרימה חופשית — צריך למצוא
 * פתרון שלא יתקע אותנו בנוסחה קבועה אלא יותר יצירתיות."
 *
 * ## How
 * The FlowEngine computes the current musical state from four inputs:
 *   1. Radio energy (if connected) — follows the radio's energy curve.
 *   2. Time since last transition — don't stay in the same energy too long.
 *      Every 8-16 bars, consider a shift.
 *   3. Musical logic — after a DROP, VARIATION or BREAK (never DROP→DROP).
 *      After a BREAK, BUILD (never BREAK→BREAK).
 *   4. Surprise — 5-10% chance per transition of an unexpected event:
 *      filter sweep, drop-out, echo throw, reverse hit, stutter, silence.
 *
 * ## Continuous automation
 * The state is NOT a section switch — it's a continuous FlowState that
 * smoothly ramps:
 *   - filterCutoff (Hz, exponential — ears hear log-Hz)
 *   - reverbAmount (0-1)
 *   - delayAmount (0-1)
 *   - tension (0-1, rises in builds, peaks at drops, releases in breaks)
 *   - surprise (0-1, probability of unexpected events)
 *
 * These ramps are SMOOTH (per-bar interpolation toward target with a
 * 1-4 bar time constant). The engine applies them via setTrackEffect /
 * setSendLevel which both use setTargetAtTime internally — no clicks.
 *
 * ## World-aware
 * Different worlds have different flow characteristics:
 *   - dark-psy:        more drops, shorter breaks, high baseline energy (0.6+)
 *   - progressive-psy: long slow builds (16-32 bars), fewer drops, more groove
 *   - goa:             continuous energy, few breaks, lots of melodic variation
 *   - hypnotic:        very long sections (32-64 bars), minimal transitions
 *   - forest:          organic, unpredictable flow, more surprises
 *
 * The flow engine queries the current World for these characteristics via
 * setWorld() — called by the engine's start() and switchWorld().
 *
 * ## Fallback
 * Works WITHOUT a radio connection — uses an internal energy curve derived
 * from the world's energyCurve + bar count. Responds WHEN a radio is
 * connected — onReferenceEnergyChange() forces a transition consideration
 * when the radio's energy shifts significantly.
 */

import { SeededRng } from './musicalGrammar';
import type { World, WorldId } from './worlds';

const clamp = (v: number, a: number, b: number) => v < a ? a : (v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ─── Public types ───────────────────────────────────────────────────────────

/**
 * The full musical state at the current bar. This is what the engine reads
 * to decide which tracks fire, what energy/density to use, and how to
 * automate the FX chain.
 *
 * `label` is kept for backwards compatibility with onSectionChange — the
 * engine still fires section-change callbacks with a human-readable label.
 * But the label is now a CONSEQUENCE of the energy/tension state, not the
 * driver — the flow engine picks a label that describes the current state.
 */
export type FlowState = {
  // ── Discrete musical parameters (replace ArrangementSection fields) ──
  energy: number;          // 0-1 current energy target (smoothed)
  density: number;         // 0-1 event density (smoothed)
  bassOn: boolean;         // bass track active
  leadOn: boolean;         // lead+pad+arp tracks active
  acidOn: boolean;         // acid mode (303-style bass/lead)
  hatDensity: number;      // 0-1 multiplier on world.hatDensity
  percDensity: number;     // 0-1 multiplier on world.percDensity
  fxDensity: number;       // 0-1 multiplier on FX sends
  label: string;           // human-readable state name (INTRO/GROOVE/...)

  // ── Continuous automation (NEW — not in ArrangementSection) ──
  filterCutoff: number;    // Hz, automated (lead filter target)
  reverbAmount: number;    // 0-1, automated (per-track reverb send multiplier)
  delayAmount: number;     // 0-1, automated (per-track delay send multiplier)
  tension: number;         // 0-1, how tense the current moment is
  surprise: number;        // 0-1, probability of unexpected events

  // ── Section framing (for engine's existing scheduleStep logic) ──
  sectionBars: number;     // planned total bars for the current section
  barInSection: number;    // current bar within the section (0-based)
};

/**
 * A surprise event returned by maybeSurprise(). The engine handles each type:
 *   filterSweep: ramp the lead filter open then closed (or vice versa)
 *   dropOut:     briefly mute everything except the kick (DJ "brake" effect)
 *   echoThrow:   send the last note to a long delay (DJ echo throw)
 *   reverseHit:  play a reversed impact (build tension)
 *   stutter:     rapidly retrigger the last note (DJ stutter effect)
 *   silence:     a brief moment of silence before the next hit (dramatic pause)
 */
export interface SurpriseEvent {
  type: 'filterSweep' | 'dropOut' | 'echoThrow' | 'reverseHit' | 'stutter' | 'silence';
  startBar: number;        // bar (absolute) when the event starts
  durationBars: number;    // how many bars the event lasts
  intensity: number;       // 0-1, how dramatic the event should be
}

// ─── Internal state machine ────────────────────────────────────────────────

/**
 * A musical archetype — a "section type" in the flow. Each archetype defines
 * a target energy/density/tension/etc. that the FlowEngine smooths toward.
 *
 * Archetypes are NOT sections — they're TARGET STATES. The flow engine
 * picks an archetype based on musical logic + radio energy + world character,
 * then smoothly transitions the current FlowState toward it over 1-4 bars.
 */
interface Archetype {
  label: string;
  energy: number;          // target energy
  density: number;         // target density
  bass: boolean;
  lead: boolean;
  acid: boolean;
  hatDensity: number;
  percDensity: number;
  fxDensity: number;
  filterCutoff: number;    // target lead cutoff (Hz)
  reverbAmount: number;    // target reverb send multiplier
  delayAmount: number;     // target delay send multiplier
  tension: number;         // target tension
  surprise: number;        // target surprise probability
}

// ── Archetype table ──
// These are the MUSICAL TARGETS — the values the flow engine smooths toward.
// Section lengths and transitions are dynamic; the archetypes themselves are
// fixed musical characters.
const ARCHETYPES: Record<string, Archetype> = {
  INTRO: {
    label: 'INTRO',
    energy: 0.25, density: 0.30, bass: false, lead: false, acid: false,
    hatDensity: 0.4, percDensity: 0.3, fxDensity: 0.5,
    filterCutoff: 1200, reverbAmount: 0.60, delayAmount: 0.10,
    tension: 0.20, surprise: 0.05,
  },
  GROOVE: {
    label: 'GROOVE',
    energy: 0.50, density: 0.55, bass: true, lead: false, acid: false,
    hatDensity: 0.7, percDensity: 0.6, fxDensity: 0.6,
    filterCutoff: 1800, reverbAmount: 0.40, delayAmount: 0.20,
    tension: 0.35, surprise: 0.06,
  },
  BUILD: {
    label: 'BUILD',
    energy: 0.70, density: 0.75, bass: true, lead: false, acid: false,
    hatDensity: 0.9, percDensity: 0.8, fxDensity: 0.8,
    filterCutoff: 3500, reverbAmount: 0.35, delayAmount: 0.30,
    tension: 0.80, surprise: 0.08,
  },
  DROP: {
    label: 'DROP',
    energy: 0.95, density: 0.95, bass: true, lead: true, acid: false,
    hatDensity: 1.0, percDensity: 0.9, fxDensity: 0.9,
    filterCutoff: 4000, reverbAmount: 0.25, delayAmount: 0.30,
    tension: 1.00, surprise: 0.10,
  },
  VARIATION: {
    label: 'VARIATION',
    energy: 0.78, density: 0.70, bass: true, lead: true, acid: true,
    hatDensity: 0.9, percDensity: 0.7, fxDensity: 0.85,
    filterCutoff: 3200, reverbAmount: 0.35, delayAmount: 0.45,
    tension: 0.65, surprise: 0.15,
  },
  BREAK: {
    label: 'BREAK',
    energy: 0.25, density: 0.30, bass: false, lead: false, acid: false,
    hatDensity: 0.3, percDensity: 0.2, fxDensity: 0.7,
    filterCutoff: 700, reverbAmount: 0.70, delayAmount: 0.50,
    tension: 0.30, surprise: 0.07,
  },
  OUTRO: {
    label: 'OUTRO',
    energy: 0.25, density: 0.30, bass: true, lead: false, acid: false,
    hatDensity: 0.4, percDensity: 0.3, fxDensity: 0.5,
    filterCutoff: 1000, reverbAmount: 0.60, delayAmount: 0.15,
    tension: 0.15, surprise: 0.05,
  },
};

// ── World flow profiles ──
// Each world has its own flow characteristics that shape:
//   - baseline energy (where the energy curve starts and tends to return to)
//   - section length range (min/max bars per section before forced transition)
//   - transition preferences (which archetypes each world favors)
//   - surprise rate multiplier
//   - drop likelihood (some worlds drop more often)
interface WorldFlowProfile {
  baselineEnergy: number;       // 0-1, the world's resting energy
  minSectionBars: number;       // minimum bars before a transition is considered
  maxSectionBars: number;       // maximum bars before a forced transition
  dropLikelihood: number;       // 0-1, how often transitions lead to a DROP
  breakLikelihood: number;      // 0-1, how often transitions lead to a BREAK
  buildLikelihood: number;      // 0-1, how often transitions lead to a BUILD
  surpriseRateMult: number;     // multiplier on the archetype's surprise prob
  // archetype weighting — biases the next-archetype picker
  weights: Partial<Record<keyof typeof ARCHETYPES, number>>;
}

const WORLD_FLOW_PROFILES: Record<WorldId, WorldFlowProfile> = {
  'dark-psy': {
    baselineEnergy: 0.65,
    minSectionBars: 6, maxSectionBars: 24,
    dropLikelihood: 0.45, breakLikelihood: 0.15, buildLikelihood: 0.25,
    surpriseRateMult: 1.2,
    weights: { DROP: 1.4, VARIATION: 1.2, BUILD: 0.9, BREAK: 0.7, GROOVE: 0.8 },
  },
  'progressive-psy': {
    baselineEnergy: 0.45,
    minSectionBars: 12, maxSectionBars: 32,
    dropLikelihood: 0.25, breakLikelihood: 0.20, buildLikelihood: 0.40,
    surpriseRateMult: 0.7,
    weights: { GROOVE: 1.4, BUILD: 1.3, VARIATION: 1.1, DROP: 0.9, BREAK: 0.9 },
  },
  'morning-psy': {
    baselineEnergy: 0.55,
    minSectionBars: 8, maxSectionBars: 24,
    dropLikelihood: 0.35, breakLikelihood: 0.20, buildLikelihood: 0.30,
    surpriseRateMult: 0.9,
    weights: { DROP: 1.2, VARIATION: 1.2, BUILD: 1.1, GROOVE: 1.0, BREAK: 0.9 },
  },
  'goa': {
    baselineEnergy: 0.65,
    minSectionBars: 8, maxSectionBars: 28,
    dropLikelihood: 0.40, breakLikelihood: 0.10, buildLikelihood: 0.25,
    surpriseRateMult: 1.1,
    weights: { VARIATION: 1.5, DROP: 1.2, BUILD: 1.0, GROOVE: 0.9, BREAK: 0.5 },
  },
  'forest': {
    baselineEnergy: 0.60,
    minSectionBars: 4, maxSectionBars: 20,
    dropLikelihood: 0.40, breakLikelihood: 0.18, buildLikelihood: 0.22,
    surpriseRateMult: 1.6,
    weights: { DROP: 1.2, VARIATION: 1.3, BUILD: 0.9, BREAK: 0.8, GROOVE: 0.9 },
  },
  'deep-psy': {
    baselineEnergy: 0.45,
    minSectionBars: 12, maxSectionBars: 32,
    dropLikelihood: 0.25, breakLikelihood: 0.20, buildLikelihood: 0.30,
    surpriseRateMult: 0.8,
    weights: { GROOVE: 1.3, BUILD: 1.2, VARIATION: 1.0, DROP: 0.9, BREAK: 1.0 },
  },
  'hypnotic': {
    baselineEnergy: 0.50,
    minSectionBars: 24, maxSectionBars: 64,
    dropLikelihood: 0.20, breakLikelihood: 0.15, buildLikelihood: 0.25,
    surpriseRateMult: 0.5,
    weights: { GROOVE: 1.6, BUILD: 1.0, VARIATION: 0.8, DROP: 0.7, BREAK: 0.7 },
  },
  'cosmic': {
    baselineEnergy: 0.55,
    minSectionBars: 10, maxSectionBars: 28,
    dropLikelihood: 0.30, breakLikelihood: 0.22, buildLikelihood: 0.28,
    surpriseRateMult: 1.0,
    weights: { VARIATION: 1.2, BUILD: 1.1, DROP: 1.0, GROOVE: 1.0, BREAK: 1.0 },
  },
  'organic-psy': {
    baselineEnergy: 0.50,
    minSectionBars: 8, maxSectionBars: 24,
    dropLikelihood: 0.30, breakLikelihood: 0.22, buildLikelihood: 0.28,
    surpriseRateMult: 1.1,
    weights: { VARIATION: 1.2, GROOVE: 1.1, BUILD: 1.0, DROP: 1.0, BREAK: 1.0 },
  },
  'acid-psy': {
    baselineEnergy: 0.60,
    minSectionBars: 8, maxSectionBars: 24,
    dropLikelihood: 0.40, breakLikelihood: 0.15, buildLikelihood: 0.25,
    surpriseRateMult: 1.3,
    weights: { VARIATION: 1.4, DROP: 1.2, BUILD: 1.0, GROOVE: 0.9, BREAK: 0.7 },
  },
};

// ─── FlowEngine ─────────────────────────────────────────────────────────────

export class FlowEngine {
  private current: FlowState;
  private target: FlowState;
  private currentArchetype: Archetype;
  private world: World | null = null;
  private worldProfile: WorldFlowProfile = WORLD_FLOW_PROFILES['dark-psy'];

  // ── Radio energy tracking ──
  private refEnergyHistory: number[] = [];
  private static readonly REF_ENERGY_HISTORY_MAX = 16;
  private lastRefEnergyShiftBar = -9999;

  // ── Section timing ──
  private barCount = 0;             // total bars since start (never resets)
  private lastTransitionBar = 0;    // bar count at the last transition
  private currentSectionBars = 8;   // planned length of the current section
  private barInSection = 0;         // current bar within the section

  // ── Surprise state ──
  private lastSurpriseBar = -9999;
  private pendingSurprise: SurpriseEvent | null = null;
  private activeSurprise: SurpriseEvent | null = null;
  private static readonly SURPRISE_COOLDOWN_BARS = 16;

  // ── Constructor ──
  constructor(private rng: SeededRng) {
    this.currentArchetype = ARCHETYPES.INTRO;
    this.current = this.archetypeToFlowState(this.currentArchetype, 8, 0);
    this.target = { ...this.current };
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Set the current world. Called by the engine on start() and switchWorld().
   * The world shapes: baseline energy, section length range, transition
   * preferences, surprise rate, archetype weights.
   *
   * If the new world's profile differs significantly from the current state,
   * the next transition will adapt — we DON'T force an immediate transition
   * (the music keeps flowing organically).
   */
  setWorld(world: World): void {
    this.world = world;
    const profile = WORLD_FLOW_PROFILES[world.id];
    if (profile) {
      this.worldProfile = profile;
    }
  }

  /**
   * Called every bar by the engine. Returns the CURRENT flow state (smoothed
   * toward the target). The engine uses this to drive scheduleStep.
   *
   * `bar` is the absolute bar count (the engine's totalBars). `refEnergy` is
   * the current radio energy (0 if no radio connected).
   *
   * Side effects:
   *   - May transition to a new archetype (updating `target`)
   *   - Smooths `current` toward `target` (1-4 bar time constant)
   *   - Tracks radio energy history for shift detection
   *   - May queue a surprise event (retrievable via maybeSurprise)
   */
  tick(bar: number, refEnergy: number): FlowState {
    this.barCount = bar;

    // ── Track radio energy history ──
    if (refEnergy > 0 && isFinite(refEnergy)) {
      this.refEnergyHistory.push(clamp(refEnergy, 0, 1));
      if (this.refEnergyHistory.length > FlowEngine.REF_ENERGY_HISTORY_MAX) {
        this.refEnergyHistory.shift();
      }
    }

    // ── Consider a transition ──
    const barsSinceTransition = bar - this.lastTransitionBar;
    const minBars = this.worldProfile.minSectionBars;

    // Force transition when the planned section length is reached — this
    // guarantees the engine's bar-within-section never exceeds the planned
    // length (which would cause riser/energy-curve indexing issues in
    // scheduleStep). The flow engine picks a new planned length on each
    // transition, so this respects the organic section-length variation
    // (some sections are 4 bars, some are 32).
    const shouldForce = barsSinceTransition >= this.currentSectionBars;

    // Consider an early transition (radio energy shift, random chance)
    // once we're past minBars. Rising probability up to currentSectionBars.
    const shouldConsider = barsSinceTransition >= minBars;

    if (shouldForce || (shouldConsider && this.shouldTransition(bar, refEnergy, barsSinceTransition))) {
      this.transition(bar, refEnergy);
    }

    // ── Update bar-in-section ──
    this.barInSection = bar - this.lastTransitionBar;

    // ── Smooth current toward target ──
    // Different time constants for different parameters:
    //   - filterCutoff: slow (4-bar time constant, exponential in log-Hz)
    //   - reverbAmount/delayAmount: medium (2-bar time constant)
    //   - energy/density: medium (2-bar)
    //   - tension/surprise: fast (1-bar) — these are more "moment-to-moment"
    //   - hatDensity/percDensity/fxDensity: medium (2-bar)
    //
    // The smoothing rate is per-bar. With a 1-bar time constant, the value
    // moves ~63% of the way to target each bar. With 4 bars, ~22% per bar.
    //
    // We compute the rate from the section's planned length so short sections
    // transition faster (more urgency) and long sections transition slower
    // (more patience). This makes hypnotic's 64-bar sections evolve gradually
    // while forest's 4-bar surprises snap quickly.
    const sectionLen = Math.max(4, this.currentSectionBars);
    const fastRate = clamp(1.0 / Math.max(1, sectionLen * 0.25), 0.15, 0.7);   // ~1-bar
    const medRate  = clamp(1.0 / Math.max(2, sectionLen * 0.5),  0.10, 0.4);   // ~2-bar
    const slowRate = clamp(1.0 / Math.max(4, sectionLen),         0.05, 0.25); // ~4-bar

    // Continuous params (smooth toward target)
    this.current.energy       = lerp(this.current.energy,       this.target.energy,       medRate);
    this.current.density      = lerp(this.current.density,      this.target.density,      medRate);
    this.current.hatDensity   = lerp(this.current.hatDensity,   this.target.hatDensity,   medRate);
    this.current.percDensity  = lerp(this.current.percDensity,  this.target.percDensity,  medRate);
    this.current.fxDensity    = lerp(this.current.fxDensity,    this.target.fxDensity,    medRate);
    this.current.reverbAmount = lerp(this.current.reverbAmount, this.target.reverbAmount, medRate);
    this.current.delayAmount  = lerp(this.current.delayAmount,  this.target.delayAmount,  medRate);
    this.current.tension      = lerp(this.current.tension,      this.target.tension,      fastRate);
    this.current.surprise     = lerp(this.current.surprise,     this.target.surprise,     fastRate);

    // filterCutoff: exponential interpolation (ears hear log-Hz)
    const lc = Math.log(Math.max(80, this.current.filterCutoff));
    const lt = Math.log(Math.max(80, this.target.filterCutoff));
    this.current.filterCutoff = Math.exp(lerp(lc, lt, slowRate));

    // Discrete flags follow the target immediately (they're booleans — no
    // smoothing needed, the engine gates tracks on them)
    this.current.bassOn = this.target.bassOn;
    this.current.leadOn = this.target.leadOn;
    this.current.acidOn = this.target.acidOn;
    this.current.label = this.target.label;

    // Update section framing
    this.current.sectionBars = this.currentSectionBars;
    this.current.barInSection = this.barInSection;

    // Maybe queue a surprise event
    this.maybeQueueSurprise(bar);

    return this.current;
  }

  /**
   * Called when the radio's energy shifts significantly. Forces a transition
   * consideration on the next tick — if the radio is building, we build; if
   * the radio drops, we drop.
   *
   * `energy` is the new radio energy (0-1). The engine calls this from
   * liveTrack() when it detects a significant change (>0.15 delta from the
   * smoothed history).
   */
  onReferenceEnergyChange(energy: number): void {
    if (!isFinite(energy) || energy <= 0) return;
    const e = clamp(energy, 0, 1);
    // Push to history immediately so the next tick sees the new value
    this.refEnergyHistory.push(e);
    if (this.refEnergyHistory.length > FlowEngine.REF_ENERGY_HISTORY_MAX) {
      this.refEnergyHistory.shift();
    }
    // Mark this bar as a "shift" — the next transition consideration will
    // fire even if we're below minBars (radio energy shifts are high-priority)
    this.lastRefEnergyShiftBar = this.barCount;
  }

  /**
   * Force a transition to a specific archetype. Used by the engine when:
   *   - The style changes (switchWorld may want to reset the flow)
   *   - The user explicitly requests a section change
   *
   * `partial.label` selects the archetype; other fields override the
   * archetype's defaults (e.g., to set a custom section length).
   * `bars` is the planned length of the new section.
   */
  transitionTo(partial: Partial<FlowState> & { label?: string }, bars: number): void {
    const label = partial.label || this.currentArchetype.label;
    const arch = ARCHETYPES[label] || this.currentArchetype;
    this.currentArchetype = arch;
    this.target = this.archetypeToFlowState(arch, bars, 0);
    // Apply overrides
    if (partial.energy !== undefined) this.target.energy = partial.energy;
    if (partial.density !== undefined) this.target.density = partial.density;
    if (partial.bassOn !== undefined) this.target.bassOn = partial.bassOn;
    if (partial.leadOn !== undefined) this.target.leadOn = partial.leadOn;
    if (partial.filterCutoff !== undefined) this.target.filterCutoff = partial.filterCutoff;
    if (partial.reverbAmount !== undefined) this.target.reverbAmount = partial.reverbAmount;
    if (partial.delayAmount !== undefined) this.target.delayAmount = partial.delayAmount;
    if (partial.tension !== undefined) this.target.tension = partial.tension;
    if (partial.surprise !== undefined) this.target.surprise = partial.surprise;
    this.currentSectionBars = Math.max(2, bars);
    this.lastTransitionBar = this.barCount;
    this.barInSection = 0;
  }

  /**
   * Get the current (smoothed) flow state. Identical to the last value
   * returned by tick(). Useful for the engine to read state between ticks.
   */
  getCurrent(): FlowState {
    return this.current;
  }

  /**
   * Pop the next pending surprise event (or null if none). The engine calls
   * this each bar and handles the returned event — triggers a riser, mutes
   * tracks, etc.
   *
   * Once an event is popped, it's marked as "active" and won't be returned
   * again. A new surprise won't be queued until the cooldown elapses.
   */
  maybeSurprise(bar: number): SurpriseEvent | null {
    if (this.pendingSurprise && this.pendingSurprise.startBar <= bar) {
      this.activeSurprise = this.pendingSurprise;
      this.pendingSurprise = null;
      this.lastSurpriseBar = bar;
      return this.activeSurprise;
    }
    // Clear the active surprise once its duration has elapsed
    if (this.activeSurprise && bar >= this.activeSurprise.startBar + this.activeSurprise.durationBars) {
      this.activeSurprise = null;
    }
    return null;
  }

  /**
   * Return the currently-active surprise event (if any). The engine can read
   * this each step to apply the ongoing effect (e.g., keep tracks muted during
   * a dropOut, keep the filter swept during a filterSweep).
   */
  getActiveSurprise(): SurpriseEvent | null {
    return this.activeSurprise;
  }

  // ─── Internal logic ──────────────────────────────────────────────────────

  /**
   * Decide whether to transition this bar. Considers:
   *   - Time since last transition (rising probability from minBars to maxBars)
   *   - Radio energy shift (high-priority — transitions on shift even if early)
   *   - Random chance (so the flow isn't predictable)
   */
  private shouldTransition(bar: number, refEnergy: number, barsSinceTransition: number): boolean {
    // Radio energy shift — high-priority trigger
    const barsSinceShift = bar - this.lastRefEnergyShiftBar;
    if (barsSinceShift <= 1 && barsSinceTransition >= 2) {
      return true;
    }

    // Radio energy divergence — if the radio's energy has drifted far from
    // the current archetype's target, transition to chase it
    if (refEnergy > 0 && Math.abs(refEnergy - this.target.energy) > 0.25 && barsSinceTransition >= 2) {
      return true;
    }

    // Rising probability from minBars to currentSectionBars (linear ramp).
    // At minBars: ~0% chance per bar. At currentSectionBars: ~30% chance.
    // This gives the flow organic variation — sometimes a section ends early
    // (radio-driven or random), sometimes it runs the full planned length.
    const minBars = this.worldProfile.minSectionBars;
    const planned = Math.max(minBars + 1, this.currentSectionBars);
    const progress = clamp((barsSinceTransition - minBars) / Math.max(1, planned - minBars), 0, 1);
    const chance = progress * 0.30;
    return this.rng.chance(chance);
  }

  /**
   * Pick the next archetype and apply it. Uses:
   *   - Musical logic (no DROP→DROP, no BREAK→BREAK)
   *   - Radio energy (chase the radio's level)
   *   - World profile (archetype weights, likelihoods)
   *   - Random chance (so the flow isn't formulaic)
   */
  private transition(bar: number, refEnergy: number): void {
    const prevLabel = this.currentArchetype.label;
    const nextLabel = this.pickNextArchetype(prevLabel, refEnergy);
    const nextArch = ARCHETYPES[nextLabel];

    // Pick section length — world profile's range, biased by archetype.
    // Drops are longer (8-32 bars), builds are shorter (4-16), breaks are
    // short (4-12), grooves are medium (8-24), intros/outros are short.
    const sectionLen = this.pickSectionLength(nextLabel);

    // Apply the new archetype
    this.currentArchetype = nextArch;
    this.target = this.archetypeToFlowState(nextArch, sectionLen, 0);

    // Blend in radio energy if available — bias the target energy toward
    // the radio's current level so we chase it.
    if (refEnergy > 0 && isFinite(refEnergy)) {
      const blend = 0.5; // 50% archetype, 50% radio
      this.target.energy = clamp(
        this.target.energy * (1 - blend) + refEnergy * blend,
        0, 1,
      );
      // Density follows energy loosely
      this.target.density = clamp(
        this.target.density * (1 - blend * 0.5) + refEnergy * blend * 0.5,
        0, 1,
      );
      // If radio is much brighter than our target, open the filter
      if (refEnergy > this.target.energy + 0.15) {
        this.target.filterCutoff = clamp(this.target.filterCutoff * 1.3, 200, 12000);
      } else if (refEnergy < this.target.energy - 0.15) {
        this.target.filterCutoff = clamp(this.target.filterCutoff * 0.7, 200, 12000);
      }
    }

    this.currentSectionBars = sectionLen;
    this.lastTransitionBar = bar;
    this.barInSection = 0;
  }

  /**
   * Pick the next archetype based on musical logic + radio energy + world profile.
   *
   * Musical logic (hard rules):
   *   - DROP → DROP         : FORBIDDEN (boring)
   *   - BREAK → BREAK       : FORBIDDEN (too sparse)
   *   - INTRO → INTRO       : FORBIDDEN (no progress)
   *   - OUTRO → anything but OUTRO : FORBIDDEN (we're winding down)
   *
   * Musical logic (soft preferences):
   *   - After DROP     : VARIATION (most common) or BREAK (common)
   *   - After BUILD    : DROP (most common) or VARIATION
   *   - After BREAK    : BUILD (most common) or GROOVE
   *   - After GROOVE   : BUILD (most common) or BREAK or DROP (surprise)
   *   - After VARIATION: BREAK (most common) or DROP
   *   - After INTRO    : GROOVE (almost always)
   *
   * Radio energy can override the soft preferences — if the radio is at 0.9
   * energy and we just came out of a BREAK, we might skip BUILD and go
   * straight to DROP (chase the radio).
   */
  private pickNextArchetype(prevLabel: string, refEnergy: number): string {
    // OUTRO is terminal — once we're here, stay
    if (prevLabel === 'OUTRO') return 'OUTRO';

    // Define allowed next archetypes per current label (musical logic)
    const allowed: Record<string, string[]> = {
      INTRO:      ['GROOVE', 'BUILD', 'DROP'],  // rarely straight to drop (surprise)
      GROOVE:     ['BUILD', 'BREAK', 'DROP', 'VARIATION'],
      BUILD:      ['DROP', 'VARIATION'],
      DROP:       ['VARIATION', 'BREAK', 'GROOVE'],
      VARIATION:  ['BREAK', 'DROP', 'GROOVE'],
      BREAK:      ['BUILD', 'GROOVE', 'DROP'],
      OUTRO:      ['OUTRO'],
    };

    const candidates = allowed[prevLabel] || ['GROOVE'];
    const profile = this.worldProfile;

    // Weight each candidate
    const weights = candidates.map(label => {
      let w = profile.weights[label as keyof typeof ARCHETYPES] ?? 1.0;

      // Radio energy influence: if the radio is high-energy, boost high-energy archetypes
      if (refEnergy > 0) {
        const arch = ARCHETYPES[label];
        const energyDelta = Math.abs(arch.energy - refEnergy);
        // Closer energy = higher weight (inverse distance)
        const closeness = clamp(1 - energyDelta, 0.1, 1.5);
        w *= closeness;
      }

      // Apply world profile likelihoods
      if (label === 'DROP') w *= profile.dropLikelihood * 2;
      if (label === 'BREAK') w *= profile.breakLikelihood * 2;
      if (label === 'BUILD') w *= profile.buildLikelihood * 2;

      // INTRO→DROP is a surprise — penalize unless surprise rate is high
      if (prevLabel === 'INTRO' && label === 'DROP') {
        w *= 0.2 * profile.surpriseRateMult;
      }

      return Math.max(0.05, w);
    });

    // Weighted random pick
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.rng.next() * total;
    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i];
      if (r <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  /**
   * Pick a section length for the new archetype. World profile sets the range;
   * the archetype biases toward shorter or longer:
   *   - DROP / FINAL DROP : longer (more bars to develop the drop)
   *   - BUILD             : shorter (builds shouldn't overstay)
   *   - BREAK             : short (breaks are punctuation, not paragraphs)
   *   - GROOVE / VARIATION: medium
   *   - INTRO / OUTRO     : short
   */
  private pickSectionLength(label: string): number {
    const profile = this.worldProfile;
    const min = profile.minSectionBars;
    const max = profile.maxSectionBars;

    // Bias multipliers — shift the random pick within [min, max]
    const bias: Record<string, number> = {
      INTRO: 0.3,
      GROOVE: 0.5,
      BUILD: 0.4,
      DROP: 0.75,
      VARIATION: 0.55,
      BREAK: 0.25,
      OUTRO: 0.3,
    };

    const b = bias[label] ?? 0.5;
    // Bias toward the low or high end of the range
    // b < 0.5 → bias low; b > 0.5 → bias high
    const r = this.rng.next();
    // Power curve: r^k. k > 1 biases low, k < 1 biases high.
    const k = b < 0.5 ? 1 / (b * 2 + 0.1) : (1 - b) * 2 + 0.1;
    const biased = Math.pow(r, k);
    const len = Math.round(min + biased * (max - min));
    // Round to a multiple of 4 (musical phrases are usually 4 or 8 bars)
    const rounded = Math.max(4, Math.round(len / 4) * 4);
    return clamp(rounded, min, max);
  }

  /**
   * Build a FlowState from an archetype + section framing.
   */
  private archetypeToFlowState(arch: Archetype, sectionBars: number, barInSection: number): FlowState {
    // Apply world profile's surprise rate multiplier
    const surpriseMult = this.worldProfile?.surpriseRateMult ?? 1.0;
    return {
      energy: arch.energy,
      density: arch.density,
      bassOn: arch.bass,
      leadOn: arch.lead,
      acidOn: arch.acid,
      hatDensity: arch.hatDensity,
      percDensity: arch.percDensity,
      fxDensity: arch.fxDensity,
      label: arch.label,
      filterCutoff: arch.filterCutoff,
      reverbAmount: arch.reverbAmount,
      delayAmount: arch.delayAmount,
      tension: arch.tension,
      surprise: clamp(arch.surprise * surpriseMult, 0, 0.4),
      sectionBars,
      barInSection,
    };
  }

  /**
   * Maybe queue a surprise event for the current bar. Called from tick().
   *
   * Probability is the current FlowState's `surprise` value. The event is
   * queued (not fired immediately) so the engine can pop it via maybeSurprise()
   * on the next bar — this gives the engine a chance to schedule the effect
   * ahead of time (lookahead scheduler).
   *
   * Respects a cooldown so surprises don't fire too often (every 16 bars min).
   * Doesn't queue during INTRO or OUTRO (those are framing sections — surprises
   * belong in the body of the track).
   */
  private maybeQueueSurprise(bar: number): void {
    // Already have a pending surprise — don't queue another
    if (this.pendingSurprise) return;
    // Active surprise is still running — wait for it to finish
    if (this.activeSurprise) return;
    // Cooldown
    if (bar - this.lastSurpriseBar < FlowEngine.SURPRISE_COOLDOWN_BARS) return;
    // No surprises in INTRO or OUTRO
    if (this.currentArchetype.label === 'INTRO' || this.currentArchetype.label === 'OUTRO') return;

    // Probability check
    if (!this.rng.chance(this.current.surprise)) return;

    // Pick a surprise type. Forest and acid-psy get more variety; hypnotic
    // gets only the subtle ones (filterSweep, echoThrow).
    const profile = this.worldProfile;
    let types: SurpriseEvent['type'][];
    if (this.currentArchetype.label === 'BREAK') {
      // Subtle surprises in breaks — don't shatter the calm
      types = ['echoThrow', 'filterSweep'];
    } else if (this.currentArchetype.label === 'DROP') {
      // Dramatic surprises in drops
      types = ['dropOut', 'stutter', 'reverseHit', 'silence', 'filterSweep'];
    } else if (this.currentArchetype.label === 'VARIATION') {
      types = ['echoThrow', 'filterSweep', 'stutter', 'reverseHit'];
    } else if (this.currentArchetype.label === 'BUILD') {
      // Tension-building surprises
      types = ['reverseHit', 'filterSweep', 'stutter'];
    } else {
      types = ['echoThrow', 'filterSweep'];
    }

    // Forest gets more variety (organic unpredictability)
    if (profile.surpriseRateMult > 1.3 && this.rng.chance(0.3)) {
      types = ['filterSweep', 'dropOut', 'echoThrow', 'reverseHit', 'stutter', 'silence'];
    }

    const type = types[Math.floor(this.rng.next() * types.length)] || 'filterSweep';
    const intensity = clamp(0.4 + this.current.energy * 0.5 + this.rng.next() * 0.2, 0.3, 1.0);

    // Duration depends on type:
    //   - silence: very short (1 bar) — dramatic pause
    //   - dropOut: short (1-2 bars) — quick brake
    //   - stutter: short (1 bar) — rapid retrigger
    //   - echoThrow: medium (2-4 bars) — let the echo ring out
    //   - reverseHit: short (1 bar) — single reversed hit
    //   - filterSweep: medium (2-4 bars) — let the sweep develop
    let durationBars: number;
    switch (type) {
      case 'silence':    durationBars = 1; break;
      case 'dropOut':    durationBars = this.rng.int(1, 2); break;
      case 'stutter':    durationBars = 1; break;
      case 'reverseHit': durationBars = 1; break;
      case 'echoThrow':  durationBars = this.rng.int(2, 4); break;
      case 'filterSweep':durationBars = this.rng.int(2, 4); break;
      default:           durationBars = 2;
    }

    // Schedule the surprise for the NEXT bar (gives the engine's lookahead
    // scheduler time to prepare)
    this.pendingSurprise = {
      type,
      startBar: bar + 1,
      durationBars,
      intensity,
    };
  }
}
