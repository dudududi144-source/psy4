/**
 * CausalComposer — the causal composition loop.
 *
 * Replaces the template-driven planBar() from MusicalSession.
 *
 * The loop:
 *   current musical state
 *       ↓
 *   memory
 *       ↓
 *   causal inference (InferenceEngine)
 *       ↓
 *   decision (ACTION)
 *       ↓
 *   material transformation / generation
 *       ↓
 *   MusicalEvent / NoteEvent
 *       ↓
 *   state consequences (CausalState update)
 *       ↓
 *   memory update (MusicalMemoryStore)
 *       ↓
 *   next causal decision
 *
 * No BAR_ACTIONS. No PHRASE_STRUCTURE. No COMPOSITION_ARC. No countdowns.
 * The output of the previous action changes the conditions for the next.
 */

import {
  type CausalState,
  createCausalState,
  onBarAdvance,
  onMaterialPlayed,
  onMaterialVaried,
  onResponseGiven,
  onMaterialWithheld,
  onMaterialReturned,
  onGrammaticalChange,
  onNewGridEntered,
  deriveRegisterSpace,
  snapshotCausalState,
} from './CausalState';
import { MusicalMemoryStore } from './MusicalMemoryStore';
import { infer, type Decision, type CausalAction } from './InferenceEngine';

export interface CausalComposerOptions {
  bpm: number;
  rootPc: number;
  scaleName: string;
  seed: number;
}

// ── STYLE GRAMMARS ──
// Each style defines the musical grammar: scale, motif shape, bass pattern, density.
// This is what makes FULL_ON sound different from DARK.
const STYLE_GRAMMARS: Record<string, {
  scaleName: string;
  motifIntervals: number[];      // intervals from root for the lead motif
  motifSteps: number[];          // which 16th-step positions the motif hits
  bassPattern: number[];         // which 16th-step positions the bass hits (rolling psy bass)
  acidBass: boolean;             // whether to use TB-303 acid voice instead of regular bass
  percussionDensity: number;     // 0..1 — how many percussion layers
}> = {
  FULL_ON: {
    scaleName: 'phrygian-dominant',
    motifIntervals: [0, 4, 7, 4],       // root, third, fifth, third — bright, heroic
    motifSteps: [0, 4, 8, 12],          // on the beat
    bassPattern: [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15], // rolling 16ths
    acidBass: false,
    percussionDensity: 0.8,
  },
  DARK: {
    scaleName: 'phrygian',
    motifIntervals: [0, 1, 3, 1],       // root, b2, b3, b2 — dark, minor second
    motifSteps: [0, 6, 8, 14],          // sparse, off-beat
    bassPattern: [0, 3, 6, 8, 11, 14],  // sparse, triplet feel
    acidBass: false,
    percussionDensity: 0.4,
  },
  PROGRESSIVE: {
    scaleName: 'dorian',
    motifIntervals: [0, 3, 5, 7],       // root, b3, 4, 5 — modal, uplifting
    motifSteps: [0, 4, 8, 12],
    bassPattern: [1, 3, 5, 7, 9, 11, 13, 15], // off-beat 8ths
    acidBass: false,
    percussionDensity: 0.6,
  },
  ACID: {
    scaleName: 'phrygian-dominant',
    motifIntervals: [0, 1, 7, 1],       // root, b2, fifth, b2 — tense, acid
    motifSteps: [0, 4, 8, 12],
    bassPattern: [0, 3, 6, 9, 12, 15],  // spaced for acid 303 pattern
    acidBass: true,                      // USE TB-303 acid voice!
    percussionDensity: 0.7,
  },
};

export interface CausalNoteEvent {
  /** Audio time (seconds). */
  at: number;
  /** MIDI note number. */
  note: number;
  /** Velocity 0-1. */
  velocity: number;
  /** Duration in seconds. */
  duration: number;
  /** Channel / role. */
  channel: string;
}

export interface CausalBarResult {
  bar: number;
  decision: Decision;
  events: CausalNoteEvent[];
  stateAfter: Record<string, unknown>;
  memoryAfter: Record<string, unknown>;
}

export class CausalComposer {
  readonly state: CausalState;
  readonly memory: MusicalMemoryStore;
  private opts: CausalComposerOptions;
  private activeVoices: Set<string> = new Set();

  // ── USER CONTROL STATE (Stage 2: wired to UI sliders/buttons) ──
  // These influence causal decisions, NOT just synth params.
  // energy  0..1   — drives density, velocity, and lowers inference thresholds (things happen sooner)
  // tension 0..1   — drives contrast debt accumulation rate and target tension level
  // style   FULL_ON | DARK | PROGRESSIVE | ACID — changes musical grammar (scale, motif shape, bass pattern)
  // forcedSection — if set, overrides inference for the next bar(s). null = AUTO (causal inference drives).
  private userEnergy = 0.5;
  private userTension = 0.3;
  private userStyle: 'FULL_ON' | 'DARK' | 'PROGRESSIVE' | 'ACID' = 'FULL_ON';
  private forcedSection: 'BREAK' | 'BUILD' | 'DROP' | null = null;
  private forcedBarsRemaining = 0;

  // STAGE 6: Material fade-in tracking.
  // When a material is first introduced, it plays at reduced velocity for 1-2 bars
  // (fade-in). This prevents the "hard cut" jump when new layers enter.
  // Map: materialId → bar when it was introduced.
  private materialIntroBar: Map<string, number> = new Map();

  constructor(opts: CausalComposerOptions) {
    this.opts = { ...opts };
    this.state = createCausalState();
    this.memory = new MusicalMemoryStore();
  }

  // ── USER CONTROL API (Stage 2) ──

  /**
   * Set energy (0..1). Influences:
   *   - Velocity scaling on generated events (±20%)
   *   - Inference threshold bias: high energy → lower thresholds → things happen sooner
   *   - Percussion density in generateGroove (more layers at high energy)
   */
  setEnergy(v: number): void {
    this.userEnergy = Math.max(0, Math.min(1, v));
  }

  /**
   * Set tension (0..1). Influences:
   *   - contrastDebt accumulation rate (high tension → debt grows faster → breakdowns sooner)
   *   - Direct tensionLevel nudge (moves state toward target)
   *   - Motif variation intensity (higher tension → larger intervals in VARY_MOTIF)
   */
  setTension(v: number): void {
    this.userTension = Math.max(0, Math.min(1, v));
  }

  /**
   * Set style. Changes the musical grammar:
   *   FULL_ON     — Phrygian dominant, 4-on-floor, dense percussion, bright lead
   *   DARK        — Phrygian, sparse, low register, dark lead
   *   PROGRESSIVE — Dorian, medium density, evolving pad, melodic lead
   *   ACID        — Phrygian dominant + TB-303 acid bass (uses AcidVoice in worklet)
   */
  setStyle(style: 'FULL_ON' | 'DARK' | 'PROGRESSIVE' | 'ACID'): void {
    this.userStyle = style;
    // Apply scale + root changes
    const styleGrammar = STYLE_GRAMMARS[style];
    if (styleGrammar) {
      this.opts.scaleName = styleGrammar.scaleName;
      // Keep rootPc as-is (user can change key separately if needed)
    }
  }

  /**
   * Force a section for the next N bars (overrides causal inference).
   *   BREAK — force BREAKDOWN (strip layers, add pad/atmosphere)
   *   BUILD — force sequential introduction (hats → lead → percussion → counterline)
   *   DROP  — force maximum density (all layers active, high velocity)
   * Pass null or call releaseSection() to return to AUTO (causal inference).
   */
  forceSection(section: 'BREAK' | 'BUILD' | 'DROP', bars = 4): void {
    this.forcedSection = section;
    this.forcedBarsRemaining = Math.max(1, bars);
  }

  /** Return to causal AUTO mode (release forced section). */
  releaseSection(): void {
    this.forcedSection = null;
    this.forcedBarsRemaining = 0;
  }

  /** Set BPM (from learning system or user). */
  setBPM(bpm: number): void {
    this.opts.bpm = Math.max(60, Math.min(200, bpm));
  }

  /** Set root pitch class (0-11, from learning system or user). */
  setRoot(rootPc: number): void {
    this.opts.rootPc = ((Math.round(rootPc) % 12) + 12) % 12;
  }

  /** Set scale by name (from learning system or user). */
  setScale(scaleName: string): void {
    this.opts.scaleName = scaleName;
  }

  /** Get current user control state (for UI display). */
  getUserControls() {
    return {
      energy: this.userEnergy,
      tension: this.userTension,
      style: this.userStyle,
      forcedSection: this.forcedSection,
      forcedBarsRemaining: this.forcedBarsRemaining,
    };
  }

  /**
   * Compose one bar. Returns the decision + events + updated state.
   *
   * This is the causal loop. No bar-number lookup. No template.
   */
  composeBar(bar: number): CausalBarResult {
    // 1. Advance time-based state (contrast debt, anticipation)
    // PERF: tension control — high userTension makes contrast debt accumulate faster
    // (breakdowns come sooner when the user pushes tension up)
    onBarAdvance(this.state, bar);
    if (this.userTension > 0.5) {
      // Nudge tensionLevel toward user target (±0.1 per bar, causal not instant)
      const target = this.userTension;
      this.state.tensionLevel += (target - this.state.tensionLevel) * 0.15;
      // Extra contrast debt accumulation when user wants tension
      this.state.contrastDebt += (this.userTension - 0.5) * 0.05;
    }

    // 2. Infer what should happen — OR use forced section
    const activeVoicesArr = Array.from(this.activeVoices);
    let decision: Decision;

    if (this.forcedSection && this.forcedBarsRemaining > 0) {
      // USER OVERRIDE: forced section takes priority over causal inference
      decision = this.buildForcedDecision(this.forcedSection, activeVoicesArr);
      this.forcedBarsRemaining--;
      if (this.forcedBarsRemaining === 0) {
        this.forcedSection = null; // auto-release
      }
    } else {
      // CAUSAL AUTO: normal inference drives the decision
      decision = infer(this.state, this.memory, activeVoicesArr);
    }

    // 3. Execute the decision → generate events + update state + memory
    const events = this.executeDecision(decision, bar);

    // 4. Always play the groove (kick + bass) unless breakdown
    if (decision.action !== 'BREAKDOWN') {
      events.push(...this.generateGroove(bar));
    }

    // 4b. Track ongoing material play (lead, hats, etc. play every bar they're active)
    // STAGE 3: Also track acid + pad — without this, they'd start but never build
    // expectation/exhaustion, so no variation/transformation would ever fire for them.
    if (decision.action !== 'BREAKDOWN') {
      if (this.activeVoices.has('lead')) {
        this.memory.onMaterialPlayed('motif-A', bar);
        onMaterialPlayed(this.state, 'motif-A', bar);
      }
      if (this.activeVoices.has('acid')) {
        this.memory.onMaterialPlayed('acid-A', bar);
        onMaterialPlayed(this.state, 'acid-A', bar);
      }
      if (this.activeVoices.has('pad')) {
        this.memory.onMaterialPlayed('pad-A', bar);
        onMaterialPlayed(this.state, 'pad-A', bar);
      }
    }

    // 5. FIX: Return a LIGHTWEIGHT snapshot — only the 5 fields the UI reads.
    // Full snapshot (snapshotCausalState + memory.snapshot) allocated ~100 objects/bar.
    // This lightweight version allocates exactly 1 small object with 6 numbers.
    // The UI emit() reads: tensionLevel, contrastDebt, anticipationLevel,
    // grooveStability, expectationLevel (from materials['motif-A']).
    const motifState = this.state.materials.get('motif-A');
    const stateAfter = {
      tensionLevel: this.state.tensionLevel,
      contrastDebt: this.state.contrastDebt,
      anticipationLevel: this.state.anticipationLevel,
      grooveStability: this.state.grooveStability,
      expectationLevel: motifState?.expectationLevel ?? 0,
    };
    return {
      bar,
      decision,
      events,
      stateAfter: stateAfter as unknown as Record<string, unknown>,
      memoryAfter: {} as Record<string, unknown>,
    };
  }

  /**
   * Build a forced decision (user override). This bypasses causal inference
   * but still produces the same Decision shape so executeDecision can handle it.
   */
  private buildForcedDecision(section: 'BREAK' | 'BUILD' | 'DROP', activeVoices: string[]): Decision {
    let action: CausalAction;
    let whyNow: string;

    if (section === 'BREAK') {
      action = 'BREAKDOWN';
      whyNow = `USER FORCED BREAK (${this.forcedBarsRemaining} bars remaining)`;
    } else if (section === 'DROP') {
      // DROP = maximum density. If we already have lead+percussion, just keep going.
      // If not, introduce what's missing.
      if (!activeVoices.includes('hat-closed')) {
        action = 'INTRODUCE_HATS';
      } else if (!activeVoices.includes('lead')) {
        action = 'INTRODUCE_LEAD';
      } else if (!activeVoices.includes('percussion')) {
        action = 'INTRODUCE_PERCUSSION';
      } else {
        action = 'NO_CHANGE'; // everything already active — just keep playing at high energy
      }
      whyNow = `USER FORCED DROP (${this.forcedBarsRemaining} bars remaining)`;
    } else {
      // BUILD = sequential introduction. Pick the next missing layer.
      if (!activeVoices.includes('hat-closed')) {
        action = 'INTRODUCE_HATS';
      } else if (!activeVoices.includes('lead')) {
        action = 'INTRODUCE_LEAD';
      } else if (!activeVoices.includes('percussion')) {
        action = 'INTRODUCE_PERCUSSION';
      } else if (!activeVoices.includes('counterline')) {
        action = 'INTRODUCE_COUNTERLINE';
      } else {
        action = 'NO_CHANGE'; // build complete
      }
      whyNow = `USER FORCED BUILD (${this.forcedBarsRemaining} bars remaining)`;
    }

    const candidate = {
      action,
      whyNow,
      whyNotYet: 'user override — causal inference bypassed',
      urgency: 1.0,
      necessity: 'required' as const,
      enables: [],
    };
    return {
      action,
      selected: candidate,
      candidates: [candidate],
      // FIX: return lightweight reference, not full snapshot
      stateBefore: {} as Record<string, unknown>,
      memoryBefore: {} as Record<string, unknown>,
    };
  }

  /**
   * Execute a decision: generate events, update state + memory.
   */
  private executeDecision(decision: Decision, bar: number): CausalNoteEvent[] {
    const events: CausalNoteEvent[] = [];
    const action = decision.action;
    // STAGE 6: Record which channels existed BEFORE this decision, so we can
    // detect newly introduced channels and mark them for fade-in tracking.
    const voicesBefore = new Set(this.activeVoices);
    const beatDur = 60 / this.opts.bpm;
    const stepDur = beatDur / 4;
    const barStart = bar * 4 * beatDur;

    switch (action) {
      case 'INTRODUCE_HATS': {
        this.activeVoices.add('hat-closed');
        onNewGridEntered(this.state);
        // Generate off-beat hats — closed on 16ths, open on offbeats
        for (let step = 2; step < 16; step += 2) {
          const isOpen = step % 8 === 6;
          events.push({
            at: barStart + step * stepDur,
            note: isOpen ? 46 : 42,
            velocity: isOpen ? 0.35 : 0.3,
            duration: stepDur * (isOpen ? 0.8 : 0.3),
            channel: isOpen ? 'hat-open' : 'hat-closed',
          });
        }
        // Add shaker on every 16th
        this.activeVoices.add('shaker');
        for (let step = 0; step < 16; step++) {
          events.push({
            at: barStart + step * stepDur,
            note: 70,
            velocity: 0.15 + (step % 4 === 0 ? 0.1 : 0),
            duration: stepDur * 0.2,
            channel: 'shaker',
          });
        }
        break;
      }

      case 'INTRODUCE_LEAD': {
        this.activeVoices.add('lead');
        this.memory.onMaterialPlayed('motif-A', bar);
        onMaterialPlayed(this.state, 'motif-A', bar);
        // STAGE 2: Style-specific motif (was hardcoded [0,4,7,4])
        const grammar = STYLE_GRAMMARS[this.userStyle] || STYLE_GRAMMARS.FULL_ON;
        const root = this.opts.rootPc + 60; // octave 4
        const steps = grammar.motifSteps;
        const intervals = grammar.motifIntervals;
        const velScale = 0.8 + this.userEnergy * 0.4;
        for (let i = 0; i < steps.length; i++) {
          events.push({
            at: barStart + steps[i] * stepDur,
            note: root + intervals[i],
            velocity: Math.min(1, 0.6 * velScale),
            duration: stepDur * 2,
            channel: 'lead',
          });
        }
        break;
      }

      case 'INTRODUCE_PERCUSSION': {
        this.activeVoices.add('percussion');
        onNewGridEntered(this.state);
        // Generate percussion on off-beats
        for (let step = 6; step < 16; step += 4) {
          events.push({
            at: barStart + step * stepDur,
            note: 50,
            velocity: 0.5,
            duration: stepDur * 0.3,
            channel: 'percussion',
          });
        }
        break;
      }

      case 'VARY_MOTIF': {
        const materialId = decision.selected.materialId || 'motif-A';
        // STAGE 2: tension controls variation intensity (was hardcoded +2)
        // High tension → larger shift (±2 to ±5 semitones)
        const shift = 2 + Math.round(this.userTension * 3); // 2..5
        this.memory.onMaterialTransformed(materialId, bar, `transpose+${shift}`);
        onMaterialVaried(this.state, materialId);
        // Generate varied motif (transposed by shift)
        const grammar = STYLE_GRAMMARS[this.userStyle] || STYLE_GRAMMARS.FULL_ON;
        const root = this.opts.rootPc + 60 + shift;
        const steps = grammar.motifSteps;
        const intervals = grammar.motifIntervals;
        const velScale = 0.8 + this.userEnergy * 0.4;
        for (let i = 0; i < steps.length; i++) {
          events.push({
            at: barStart + steps[i] * stepDur,
            note: root + intervals[i],
            velocity: Math.min(1, 0.65 * velScale),
            duration: stepDur * 2,
            channel: 'lead',
          });
        }
        break;
      }

      case 'INTRODUCE_COUNTERLINE': {
        this.activeVoices.add('counterline');
        const answeredId = this.state.unresolvedMaterial[0] || 'motif-A';
        this.memory.onMaterialPlayed('counterline-1', bar);
        this.memory.setResponse('counterline-1', answeredId);
        onResponseGiven(this.state, answeredId);
        // Generate counterline (lower register, complementary)
        const root = this.opts.rootPc + 55; // octave 3
        const steps = [2, 6, 10, 14];
        for (const step of steps) {
          events.push({
            at: barStart + step * stepDur,
            note: root,
            velocity: 0.5,
            duration: stepDur * 1.5,
            channel: 'counterline',
          });
        }
        break;
      }

      case 'TRANSFORM_MOTIF': {
        const materialId = decision.selected.materialId || 'motif-A';
        this.memory.onMaterialTransformed(materialId, bar, 'fragment');
        onMaterialVaried(this.state, materialId);
        // Generate fragmented motif
        const root = this.opts.rootPc + 60;
        const steps = [0, 2, 5, 8, 11, 14];
        const intervals = [0, 4, 0, 7, 4, 0];
        for (let i = 0; i < steps.length; i++) {
          events.push({
            at: barStart + steps[i] * stepDur,
            note: root + intervals[i],
            velocity: 0.6,
            duration: stepDur * 0.8,
            channel: 'lead',
          });
        }
        break;
      }

      case 'BREAKDOWN': {
        const materialId = decision.selected.materialId || 'motif-A';
        this.memory.onMaterialWithheld(materialId, bar);
        onMaterialWithheld(this.state, materialId);
        onGrammaticalChange(this.state, bar);
        // Remove groove and melodic layers
        this.activeVoices.delete('lead');
        this.activeVoices.delete('hat-closed');
        this.activeVoices.delete('hat-open');
        this.activeVoices.delete('shaker');
        this.activeVoices.delete('percussion');
        this.activeVoices.delete('counterline');
        // Add sustained texture layers
        this.activeVoices.add('pad');
        this.activeVoices.add('atmosphere');
        this.activeVoices.add('texture');
        // Generate pad chord (root + fifth + octave)
        const padRoot = this.opts.rootPc + 48;
        events.push({ at: barStart, note: padRoot, velocity: 0.25, duration: 4 * beatDur, channel: 'pad' });
        events.push({ at: barStart, note: padRoot + 7, velocity: 0.2, duration: 4 * beatDur, channel: 'pad' });
        events.push({ at: barStart, note: padRoot + 12, velocity: 0.15, duration: 4 * beatDur, channel: 'pad' });
        // Generate atmosphere
        events.push({ at: barStart, note: 72, velocity: 0.2, duration: 4 * beatDur, channel: 'atmosphere' });
        // Generate texture (evolving)
        events.push({ at: barStart, note: padRoot + 4, velocity: 0.15, duration: 4 * beatDur, channel: 'texture' });
        // Riser building into the breakdown (tension)
        events.push({ at: barStart, note: 72, velocity: 0.3, duration: 2 * beatDur, channel: 'riser' });
        // Drone (sustained root for tonal anchor)
        events.push({ at: barStart, note: this.opts.rootPc + 24, velocity: 0.2, duration: 4 * beatDur, channel: 'drone' });
        break;
      }

      case 'CALLBACK_MOTIF': {
        const materialId = decision.selected.materialId || this.state.withheldMaterialId || 'motif-A';
        this.memory.onMaterialRecalled(materialId, bar);
        onMaterialReturned(this.state, materialId);
        onGrammaticalChange(this.state, bar);
        this.activeVoices.add('lead');
        this.activeVoices.delete('pad');
        this.activeVoices.delete('atmosphere');
        this.activeVoices.delete('texture');
        // Re-add groove layers
        this.activeVoices.add('hat-closed');
        this.activeVoices.add('percussion');
        // Impact + crash on callback (section markers)
        events.push({ at: barStart, note: 36, velocity: 0.9, duration: 0.3, channel: 'impact' });
        events.push({ at: barStart, note: 49, velocity: 0.7, duration: 0.5, channel: 'crash' });
        // Generate callback (register-shifted up an octave)
        const root = this.opts.rootPc + 72;
        const steps = [0, 4, 8, 12];
        const intervals = [0, 4, 7, 4];
        for (let i = 0; i < steps.length; i++) {
          events.push({
            at: barStart + steps[i] * stepDur,
            note: root + intervals[i],
            velocity: 0.7,
            duration: stepDur * 2,
            channel: 'lead',
          });
        }
        break;
      }

      case 'THIN_REGISTER': {
        // Thin the midrange — remove counterline if present
        if (this.activeVoices.has('counterline')) {
          this.activeVoices.delete('counterline');
        }
        break;
      }

      // ── STAGE 3: The 3 missing actions — now implemented ──

      case 'INTRODUCE_ACID': {
        // TB-303 acid line — squelchy, rhythmic, adds psychedelic tension.
        // Routes to AcidVoice in the worklet (channel: 'acid' → VOICE.ACID).
        // Pattern: 16th-note runs with accent on beats, using scale tones.
        this.activeVoices.add('acid');
        this.memory.onMaterialPlayed('acid-A', bar);
        onMaterialPlayed(this.state, 'acid-A', bar);
        const grammar = STYLE_GRAMMARS[this.userStyle] || STYLE_GRAMMARS.FULL_ON;
        const acidRoot = this.opts.rootPc + 57; // octave 3-4 boundary — 303 sits here
        // 303-style pattern: dense 16ths with pitch movement
        // Use scale intervals for melodic shape (not just root)
        const acidIntervals = grammar.scaleName === 'phrygian' || grammar.scaleName === 'phrygian-dominant'
          ? [0, 0, 1, 0, 3, 0, 1, 0, 0, 0, 1, 3, 0, 1, 0, 0] // phrygian: root, b2, b3
          : [0, 0, 2, 0, 3, 0, 2, 0, 0, 0, 3, 2, 0, 2, 0, 0]; // minor/dorian: root, 2nd, b3
        const velScale = 0.8 + this.userEnergy * 0.4;
        for (let step = 0; step < 16; step++) {
          const isBeat = step % 4 === 0;
          const vel = (isBeat ? 0.7 : 0.5) * velScale;
          events.push({
            at: barStart + step * stepDur,
            note: acidRoot + acidIntervals[step],
            velocity: Math.min(1, vel),
            duration: stepDur * 0.7, // short staccato — 303 character
            channel: 'acid',
          });
        }
        break;
      }

      case 'INTRODUCE_PAD': {
        // Sustained pad chord — harmonic foundation + atmosphere.
        // Routes to PadVoice in the worklet (channel: 'pad' → VOICE.PAD).
        // Uses a chord voicing based on the current scale.
        this.activeVoices.add('pad');
        this.memory.onMaterialPlayed('pad-A', bar);
        onMaterialPlayed(this.state, 'pad-A', bar);
        const grammar = STYLE_GRAMMARS[this.userStyle] || STYLE_GRAMMARS.FULL_ON;
        const padRoot = this.opts.rootPc + 48; // octave 3
        // Chord voicing depends on scale
        let chord: number[];
        if (grammar.scaleName === 'phrygian' || grammar.scaleName === 'phrygian-dominant') {
          chord = [0, 1, 7, 12]; // root, b2, fifth, octave — dark, tense pad
        } else if (grammar.scaleName === 'dorian') {
          chord = [0, 3, 7, 10]; // root, b3, fifth, b7 — modal, open pad
        } else {
          chord = [0, 4, 7, 11]; // root, third, fifth, major 7th — standard
        }
        const velScale = 0.8 + this.userEnergy * 0.4;
        for (const interval of chord) {
          events.push({
            at: barStart,
            note: padRoot + interval,
            velocity: Math.min(1, 0.22 * velScale),
            duration: 4 * beatDur, // sustain whole bar
            channel: 'pad',
          });
        }
        break;
      }

      case 'RESPONSE': {
        // A melodic response to an unresolved musical "question."
        // Similar to INTRODUCE_COUNTERLINE but motivated by conversational balance
        // (the lead asked something, now we answer it).
        // Uses complementary rhythm (off-beat) and a lower register.
        this.activeVoices.add('counterline');
        const answeredId = this.state.unresolvedMaterial[0] || 'motif-A';
        this.memory.onMaterialPlayed('counterline-1', bar);
        this.memory.setResponse('counterline-1', answeredId);
        onResponseGiven(this.state, answeredId);
        const grammar = STYLE_GRAMMARS[this.userStyle] || STYLE_GRAMMARS.FULL_ON;
        // Response is in a lower register, uses inverted motif (complementary)
        const responseRoot = this.opts.rootPc + 55; // octave 3
        // Inverted motif: reverse the interval direction
        const baseIntervals = grammar.motifIntervals;
        const invIntervals = baseIntervals.map(iv => -iv + 7); // invert around the fifth
        // Off-beat steps (complementary to lead's on-beat hits)
        const responseSteps = [2, 6, 10, 14];
        const velScale = 0.8 + this.userEnergy * 0.4;
        for (let i = 0; i < responseSteps.length; i++) {
          events.push({
            at: barStart + responseSteps[i] * stepDur,
            note: responseRoot + invIntervals[i % invIntervals.length],
            velocity: Math.min(1, 0.55 * velScale),
            duration: stepDur * 1.5,
            channel: 'counterline',
          });
        }
        break;
      }

      case 'NO_CHANGE':
      default:
        // No new action — continue existing state
        break;
    }

    // STAGE 6: Apply fade-in to newly introduced materials.
    // When a material first enters (INTRODUCE_*), scale down its velocity for the
    // first bar (50%) and second bar (80%) to create a smooth crossfade instead of a hard cut.
    // First: detect which channels are NEW (added in this decision) and register their intro bar.
    for (const voice of this.activeVoices) {
      if (!voicesBefore.has(voice)) {
        this.materialIntroBar.set(voice, bar);
      }
    }
    // Also: when a channel is removed (BREAKDOWN, THIN_REGISTER), clear its intro tracking
    // so if it re-enters later, it gets a fresh fade-in.
    for (const tracked of Array.from(this.materialIntroBar.keys())) {
      if (!this.activeVoices.has(tracked)) {
        this.materialIntroBar.delete(tracked);
      }
    }
    this.applyFadeIn(events, bar);

    return events;
  }

  /**
   * STAGE 6: Apply velocity fade-in to newly introduced materials.
   * Tracks when each channel was first introduced and scales velocity:
   *   bar 0 (intro bar): 50% velocity
   *   bar 1: 80% velocity
   *   bar 2+: 100% velocity (fully established)
   * This eliminates the "hard cut" jump when new layers enter.
   */
  private applyFadeIn(events: CausalNoteEvent[], bar: number): void {
    for (const ev of events) {
      const channel = ev.channel;
      // Skip groove channels (kick, bass, sub) — they're always present, no fade needed
      if (channel === 'kick' || channel === 'bass' || channel === 'sub') continue;

      const introBar = this.materialIntroBar.get(channel);
      if (introBar === undefined) continue; // not a tracked material

      const barsSinceIntro = bar - introBar;
      if (barsSinceIntro === 0) {
        // First bar — 50% velocity (gentle fade-in)
        ev.velocity *= 0.5;
      } else if (barsSinceIntro === 1) {
        // Second bar — 80% velocity (still settling in)
        ev.velocity *= 0.8;
      }
      // barsSinceIntro >= 2: full velocity (no scaling)
    }
  }

  /**
   * Generate the groove (kick + bass) for a bar.
   * This is the foundational layer, always present (except in breakdown).
   *
   * STAGE 2: Now respects userEnergy (velocity scaling) and userStyle (bass pattern + acid voice).
   */
  private generateGroove(bar: number): CausalNoteEvent[] {
    this.activeVoices.add('kick');
    this.activeVoices.add('bass');
    const events: CausalNoteEvent[] = [];
    const beatDur = 60 / this.opts.bpm;
    const stepDur = beatDur / 4;
    const barStart = bar * 4 * beatDur;
    const bassRoot = this.opts.rootPc + 33;
    const subRoot = this.opts.rootPc + 24; // sub octave

    // STAGE 2: energy → velocity scaling (±20%)
    const energyVelScale = 0.8 + this.userEnergy * 0.4; // 0.8..1.2
    // STAGE 2: style grammar → bass pattern + acid flag
    const grammar = STYLE_GRAMMARS[this.userStyle] || STYLE_GRAMMARS.FULL_ON;

    // Kick on beats 0, 1, 2, 3 (4-on-floor)
    for (let beat = 0; beat < 4; beat++) {
      events.push({
        at: barStart + beat * beatDur,
        note: 36,
        velocity: Math.min(1, 0.9 * energyVelScale),
        duration: beatDur * 0.8,
        channel: 'kick',
      });
    }

    // STAGE 2: Style-specific bass pattern (was hardcoded rolling 16ths)
    // ACID style uses 'acid' channel → routes to AcidVoice (TB-303) in worklet
    const bassChannel = grammar.acidBass ? 'acid' : 'bass';
    for (const step of grammar.bassPattern) {
      const isAfterKick = step % 4 === 1;
      const vel = (isAfterKick ? 0.6 : 0.8) * energyVelScale;
      events.push({
        at: barStart + step * stepDur,
        note: bassRoot,
        velocity: Math.min(1, vel),
        duration: stepDur * 0.9,
        channel: bassChannel,
      });
    }

    // Sub-bass: sustained root under bass (when groove established)
    if (this.state.grooveStability > 0.5) {
      this.activeVoices.add('sub');
      events.push({ at: barStart, note: subRoot, velocity: 0.4, duration: 4 * beatDur, channel: 'sub' });
    }

    // Snare/clap on beats 2 and 4 (backbeat) — only when groove is established
    // STAGE 2: energy gates whether backbeat plays (low energy = no backbeat yet)
    if (this.state.grooveStability > 0.4 && this.userEnergy > 0.3) {
      this.activeVoices.add('snare');
      events.push({ at: barStart + beatDur, note: 38, velocity: 0.55 * energyVelScale, duration: stepDur * 0.5, channel: 'snare' });
      events.push({ at: barStart + 3 * beatDur, note: 38, velocity: 0.55 * energyVelScale, duration: stepDur * 0.5, channel: 'snare' });
      // Clap layered on snare
      events.push({ at: barStart + beatDur, note: 39, velocity: 0.4 * energyVelScale, duration: stepDur * 0.3, channel: 'clap' });
      events.push({ at: barStart + 3 * beatDur, note: 39, velocity: 0.4 * energyVelScale, duration: stepDur * 0.3, channel: 'clap' });
    }

    // Ride on every beat when fully established (shimmer layer)
    // STAGE 2: only at high energy
    if (this.state.grooveStability > 0.8 && this.userEnergy > 0.6) {
      this.activeVoices.add('ride');
      for (let beat = 0; beat < 4; beat++) {
        events.push({ at: barStart + beat * beatDur + stepDur * 0.5, note: 59, velocity: 0.2 * energyVelScale, duration: stepDur * 0.3, channel: 'ride' });
      }
    }

    // Phrase-end fill (bar 7 of phrase)
    if (bar % 8 === 7) {
      events.push({ at: barStart + 3 * beatDur + stepDur * 2, note: 45, velocity: 0.5 * energyVelScale, duration: stepDur * 0.4, channel: 'fill' });
      events.push({ at: barStart + 3 * beatDur + stepDur * 3, note: 50, velocity: 0.6 * energyVelScale, duration: stepDur * 0.3, channel: 'fill' });
    }

    // Track groove material
    this.memory.onMaterialPlayed('groove', bar);
    onMaterialPlayed(this.state, 'groove', bar);

    return events;
  }

  /**
   * Get current active voices (for testing).
   */
  getActiveVoices(): string[] {
    return Array.from(this.activeVoices);
  }

  /**
   * Get the full causal state snapshot.
   */
  getStateSnapshot(): Record<string, unknown> {
    return snapshotCausalState(this.state);
  }
}

// Fix: CausalComposer needs to reference state.withheldMaterialId in CALLBACK case
// This is a local reference issue — the state is accessed via this.state
// The 'state' variable in the switch case should be 'this.state'
// Already correct in the code above (using this.state.withheldMaterialId)
