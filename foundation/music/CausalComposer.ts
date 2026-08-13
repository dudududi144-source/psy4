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
  private readonly opts: CausalComposerOptions;
  private activeVoices: Set<string> = new Set();

  constructor(opts: CausalComposerOptions) {
    this.opts = opts;
    this.state = createCausalState();
    this.memory = new MusicalMemoryStore();
  }

  /**
   * Compose one bar. Returns the decision + events + updated state.
   *
   * This is the causal loop. No bar-number lookup. No template.
   */
  composeBar(bar: number): CausalBarResult {
    // 1. Advance time-based state (contrast debt, anticipation)
    onBarAdvance(this.state, bar);

    // 2. Infer what should happen
    const activeVoicesArr = Array.from(this.activeVoices);
    const decision = infer(this.state, this.memory, activeVoicesArr);

    // 3. Execute the decision → generate events + update state + memory
    const events = this.executeDecision(decision, bar);

    // 4. Always play the groove (kick + bass) unless breakdown
    if (decision.action !== 'BREAKDOWN') {
      events.push(...this.generateGroove(bar));
    }

    // 4b. Track ongoing material play (lead, hats, etc. play every bar they're active)
    // This is CRITICAL: the motif plays every bar, not just when INTRODUCE_LEAD fires.
    // Without this, expectation/exhaustion never build, and no variation ever fires.
    if (decision.action !== 'BREAKDOWN') {
      if (this.activeVoices.has('lead')) {
        this.memory.onMaterialPlayed('motif-A', bar);
        onMaterialPlayed(this.state, 'motif-A', bar);
      }
    }

    // 5. Snapshot state + memory after
    const stateAfter = snapshotCausalState(this.state);
    const memoryAfter = this.memory.snapshot();

    return {
      bar,
      decision,
      events,
      stateAfter,
      memoryAfter,
    };
  }

  /**
   * Execute a decision: generate events, update state + memory.
   */
  private executeDecision(decision: Decision, bar: number): CausalNoteEvent[] {
    const events: CausalNoteEvent[] = [];
    const action = decision.action;
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
        // Generate a simple motif (root + third + fifth)
        const root = this.opts.rootPc + 60; // octave 4
        const steps = [0, 4, 8, 12];
        const intervals = [0, 4, 7, 4]; // root, third, fifth, third
        for (let i = 0; i < steps.length; i++) {
          events.push({
            at: barStart + steps[i] * stepDur,
            note: root + intervals[i],
            velocity: 0.6,
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
        this.memory.onMaterialTransformed(materialId, bar, 'transpose+2');
        onMaterialVaried(this.state, materialId);
        // Generate varied motif (transposed +2)
        const root = this.opts.rootPc + 60 + 2;
        const steps = [0, 4, 8, 12];
        const intervals = [0, 4, 7, 4];
        for (let i = 0; i < steps.length; i++) {
          events.push({
            at: barStart + steps[i] * stepDur,
            note: root + intervals[i],
            velocity: 0.65,
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
        // Impact on callback
        events.push({ at: barStart, note: 36, velocity: 0.9, duration: 0.3, channel: 'impact' });
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

      case 'NO_CHANGE':
      default:
        // No new action — continue existing state
        break;
    }

    return events;
  }

  /**
   * Generate the groove (kick + bass) for a bar.
   * This is the foundational layer, always present (except in breakdown).
   */
  private generateGroove(bar: number): CausalNoteEvent[] {
    this.activeVoices.add('kick');
    this.activeVoices.add('bass');
    const events: CausalNoteEvent[] = [];
    const beatDur = 60 / this.opts.bpm;
    const stepDur = beatDur / 4;
    const barStart = bar * 4 * beatDur;
    const bassRoot = this.opts.rootPc + 33;

    // Kick on beats 0, 1, 2, 3 (4-on-floor)
    for (let beat = 0; beat < 4; beat++) {
      events.push({ at: barStart + beat * beatDur, note: 36, velocity: 0.9, duration: beatDur * 0.8, channel: 'kick' });
    }

    // Rolling bass: K-b-B-B pattern
    const bassSteps = [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15];
    for (const step of bassSteps) {
      const isAfterKick = step % 4 === 1;
      events.push({ at: barStart + step * stepDur, note: bassRoot, velocity: isAfterKick ? 0.6 : 0.8, duration: stepDur * 0.9, channel: 'bass' });
    }

    // Snare/clap on beats 2 and 4 (backbeat) — only when groove is established
    if (this.state.grooveStability > 0.4) {
      this.activeVoices.add('snare');
      events.push({ at: barStart + beatDur, note: 38, velocity: 0.55, duration: stepDur * 0.5, channel: 'snare' });
      events.push({ at: barStart + 3 * beatDur, note: 38, velocity: 0.55, duration: stepDur * 0.5, channel: 'snare' });
      // Clap layered on snare
      events.push({ at: barStart + beatDur, note: 39, velocity: 0.4, duration: stepDur * 0.3, channel: 'clap' });
      events.push({ at: barStart + 3 * beatDur, note: 39, velocity: 0.4, duration: stepDur * 0.3, channel: 'clap' });
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
