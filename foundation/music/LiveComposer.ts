/**
 * LiveComposer — the live learning loop.
 *
 * F5 RULE 2: The learning state MUST influence what the scheduler plays.
 *
 * Chain:
 *   RadioObservationLayer → MusicalContext → CompositionPlanner → MotifMemory
 *     → NotePlan (per bar) → Scheduler
 *
 * The LiveComposer sits between the radio observation layer and the scheduler.
 * It produces a NotePlan for each bar that the scheduler consumes instead of
 * reading from hardcoded presets.
 */

import { MusicalContext, type MusicalContextSnapshot } from './MusicalContext';
import { MotifMemory } from './MotifMemory';
import { CompositionPlanner, type PhrasePlan } from './CompositionPlanner';
import { type Scale, degreeToMidi } from './primitives/scales';
import { type MotifNote } from './primitives/motif';
import { type BassNote } from './primitives/bass';
import { type RhythmPattern } from './primitives/rhythm';
import { Rng } from './primitives/rng';

export interface ScheduledNote {
  readonly step: number;       // 0-15 (step within bar)
  readonly voice: 'kick' | 'bass' | 'lead' | 'hat';
  readonly midi: number | null; // null for drums
  readonly velocity: number;
}

export interface NotePlan {
  readonly bar: number;
  readonly notes: ScheduledNote[];
  readonly phrasePlan: PhrasePlan;
  readonly ctx: MusicalContextSnapshot;
}

export interface LiveComposerSnapshot {
  readonly ctx: MusicalContextSnapshot;
  readonly motifCount: number;
  readonly lastTransform: string;
  readonly currentSection: string;
  readonly currentPhrase: number;
  readonly tension: number;
  readonly novelty: number;
  readonly planBar: number;
  readonly noteCount: number;
}

export class LiveComposer {
  private context: MusicalContext;
  private memory: MotifMemory;
  private planner: CompositionPlanner;
  private currentPlan: PhrasePlan | null = null;
  private currentNotePlan: NotePlan | null = null;
  private rng: Rng;
  private learned: boolean = false;

  constructor(seed: number = 42) {
    this.context = new MusicalContext();
    this.memory = new MotifMemory(seed);
    this.planner = new CompositionPlanner(this.memory, seed);
    this.rng = new Rng(seed);
  }

  /**
   * Feed radio observation data into the musical context.
   * Called when radio observations arrive.
   */
  observeRadio(data: {
    bpm: number;
    energy: number;
    occupancy: { kick: number; bass: number; lead: number; hats: number };
    bassFreq?: number;
    confidence: number;
  }): void {
    this.context.updateFromRadio(data);
    this.learned = true;
  }

  /**
   * Produce a NotePlan for the given bar.
   * Called by the scheduler at each bar boundary.
   */
  planBar(bar: number, transportBpm: number): NotePlan {
    // Update context from transport
    this.context.updateFromTransport(bar, transportBpm);

    // Check if we need a new phrase plan
    if (this.planner.needsNewPlan(bar)) {
      const ctx = this.context.snapshot(bar);
      this.currentPlan = this.planner.planPhrase(ctx);
    }

    const ctx = this.context.snapshot(bar);
    const plan = this.currentPlan!;

    // Generate notes for this bar
    const notes: ScheduledNote[] = [];
    const barInPhrase = bar % 8;
    const tensionAtBar = (t: number) => {
      const phraseProgress = (barInPhrase + t) / 8;
      return 0; // placeholder — actual tension sampling done below
    };

    // ── Kick pattern ──
    for (let s = 0; s < 16; s++) {
      if (plan.kickPattern.hits[s]) {
        // Gate kick by density and occupancy (don't double with radio kick)
        const kickAllowed = ctx.energy < 0.8 || this.rng.next() < ctx.density;
        if (kickAllowed) {
          notes.push({
            step: s,
            voice: 'kick',
            midi: null,
            velocity: plan.kickPattern.velocities?.[s] ?? 0.9,
          });
        }
      }
    }

    // ── Hat pattern ──
    for (let s = 0; s < 16; s++) {
      if (plan.hatPattern.hits[s]) {
        // Vary hat velocity based on tension
        const vel = (plan.hatPattern.velocities?.[s] ?? 0.5) * (0.7 + ctx.tension * 0.3);
        notes.push({
          step: s,
          voice: 'hat',
          midi: null,
          velocity: Math.min(1, vel),
        });
      }
    }

    // ── Bass pattern ──
    // Use the bass pattern but vary notes based on tension
    const bassOctave = 2 + Math.round(ctx.tension * 1.5); // higher octave at high tension
    for (const bn of plan.bassPattern) {
      // Add passing tones based on novelty
      let midi = bn.midi;
      if (this.rng.next() < ctx.novelty * 0.15 && bn.step > 0) {
        // Occasionally shift to a different scale degree
        const shift = this.rng.int(-2, 2);
        midi = degreeToMidi(ctx.rootPc, ctx.scale, shift, bassOctave);
      } else {
        // Recompute with current octave
        const degree = bn.step === 0 ? 0 : Math.round((bn.midi - degreeToMidi(ctx.rootPc, ctx.scale, 0, 2)) / 3);
        midi = degreeToMidi(ctx.rootPc, ctx.scale, Math.max(0, degree), bassOctave);
      }
      notes.push({
        step: bn.step,
        voice: 'bass',
        midi,
        velocity: bn.velocity,
      });
    }

    // ── Lead (motif-based) ──
    // Pick the motif notes for this bar within the phrase
    const motifNotes = plan.motif.notes;
    const notesPerBar = 16; // 16 steps per bar
    const motifStart = barInPhrase * notesPerBar;

    // Map motif notes to this bar's steps
    for (const mn of motifNotes) {
      if (mn.step >= motifStart && mn.step < motifStart + notesPerBar) {
        const localStep = mn.step - motifStart;
        // Gate by density
        if (this.rng.next() < ctx.density) {
          // Adjust register based on tension
          const registerShift = ctx.tension > 0.7 ? 12 : 0; // up an octave at high tension
          notes.push({
            step: localStep,
            voice: 'lead',
            midi: mn.midi + registerShift,
            velocity: mn.velocity * (0.6 + ctx.tension * 0.4),
          });
        }
      }
    }

    // If no lead notes in this bar, occasionally add a rest or a sparse note
    if (notes.filter(n => n.voice === 'lead').length === 0 && ctx.density > 0.5) {
      // Add a single accent note on a strong beat
      if (this.rng.next() < 0.4) {
        const accentStep = [0, 4, 8, 12][this.rng.int(0, 3)];
        const degree = this.rng.pick([0, 2, 4]); // root, 3rd, 5th
        const midi = degreeToMidi(ctx.rootPc, ctx.scale, degree, 5);
        notes.push({
          step: accentStep,
          voice: 'lead',
          midi,
          velocity: 0.5,
        });
      }
    }

    const notePlan: NotePlan = {
      bar,
      notes: Object.freeze(notes) as ScheduledNote[],
      phrasePlan: plan,
      ctx,
    };

    this.currentNotePlan = notePlan;
    return notePlan;
  }

  /**
   * Get the current plan (or null if not started).
   */
  getCurrentPlan(): NotePlan | null {
    return this.currentNotePlan;
  }

  /**
   * Get a debug snapshot for UI/display.
   */
  snapshot(): LiveComposerSnapshot | null {
    if (!this.currentNotePlan) return null;
    const ctx = this.currentNotePlan.ctx;
    const memSnap = this.memory.snapshot();
    return {
      ctx,
      motifCount: memSnap.motifCount,
      lastTransform: memSnap.lastTransform,
      currentSection: ctx.sectionName,
      currentPhrase: ctx.phraseIndex,
      tension: ctx.tension,
      novelty: ctx.novelty,
      planBar: this.currentNotePlan.bar,
      noteCount: this.currentNotePlan.notes.length,
    };
  }

  /**
   * Check if learning has occurred (radio observations received).
   */
  hasLearned(): boolean {
    return this.learned;
  }

  /**
   * Reset to initial state.
   */
  reset(): void {
    this.context.reset();
    this.memory.reset();
    this.planner.reset();
    this.currentPlan = null;
    this.currentNotePlan = null;
    this.rng = new Rng(42);
    this.learned = false;
  }

  // Expose for testing
  getContext(): MusicalContext { return this.context; }
  getMemory(): MotifMemory { return this.memory; }
  getPlanner(): CompositionPlanner { return this.planner; }
}
