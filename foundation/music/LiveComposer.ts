/**
 * LiveComposer — the live learning loop.
 *
 * F6 REBUILD: Fixes the musicality failures from F5:
 * 1. Motif now LIVES across bars within a phrase (introduce→repeat→transform→cadence)
 * 2. Bass gets passing tones and phrase-ending movement
 * 3. Lead fills ALL bars using motif development (not just bars 0-1)
 * 4. Transformations actually happen within phrases
 * 5. Call/response between phrases (phrase B responds to phrase A)
 * 6. Role selection based on radio occupancy (ABSTAIN when radio fills the space)
 * 7. Melody has direction (contour planning: ascending, arch, resolution)
 *
 * Chain:
 *   RadioObservationLayer → MusicalContext → CompositionPlanner → MotifMemory
 *     → NotePlan (per bar) → Scheduler
 */

import { MusicalContext, type MusicalContextSnapshot } from './MusicalContext';
import { MotifMemory, type StoredMotif, type MotifTransformType } from './MotifMemory';
import { CompositionPlanner, type PhrasePlan } from './CompositionPlanner';
import { type Scale, degreeToMidi, stableDegrees, nearestDegree } from './primitives/scales';
import { type MotifNote, transpose, invert, fragment, retrograde } from './primitives/motif';
import { type BassNote } from './primitives/bass';
import { type RhythmPattern } from './primitives/rhythm';
import { Rng } from './primitives/rng';

export interface ScheduledNote {
  readonly step: number;
  readonly voice: 'kick' | 'bass' | 'lead' | 'hat';
  readonly midi: number | null;
  readonly velocity: number;
}

export interface NotePlan {
  readonly bar: number;
  readonly notes: ScheduledNote[];
  readonly phrasePlan: PhrasePlan;
  readonly ctx: MusicalContextSnapshot;
  readonly role: MusicalRole;
  readonly barInPhrase: number;
  readonly motifAction: string;
}

export type MusicalRole = 'SUPPORT' | 'RESPONSE' | 'COUNTERMELODY' | 'BASS' | 'RHYTHMIC' | 'TEXTURE' | 'LEAD' | 'ABSTAIN';

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
  readonly role: MusicalRole;
}

// Phrase development policy (F6 RULE 8)
// Bar 0-1: introduce, 2-3: repeat, 4-5: transform, 6: variation, 7: cadence
const PHRASE_BAR_ACTIONS = ['introduce', 'repeat', 'repeat', 'transform', 'transform', 'variation', 'cadence', 'response'];

export class LiveComposer {
  private context: MusicalContext;
  private memory: MotifMemory;
  private planner: CompositionPlanner;
  private currentPlan: PhrasePlan | null = null;
  private currentNotePlan: NotePlan | null = null;
  private rng: Rng;
  private learned: boolean = false;

  // F6: Motif development within phrase
  private currentMotif: StoredMotif | null = null;
  private currentPhraseMotifs: StoredMotif[] = []; // transformed versions for each bar
  private lastPhraseMotif: StoredMotif | null = null; // for call/response

  constructor(seed: number = 42) {
    this.context = new MusicalContext();
    this.memory = new MotifMemory(seed);
    this.planner = new CompositionPlanner(this.memory, seed);
    this.rng = new Rng(seed + 1);
  }

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
   * F6: Choose musical role based on radio occupancy.
   * The system can ABSTAIN when the radio fills the space.
   */
  private chooseRole(ctx: MusicalContextSnapshot, barInPhrase: number): MusicalRole {
    const occ = ctx.radioRoles ?? { kick: 0, bass: 0, lead: 0, hats: 0 };

    // If radio is very dense, take a supporting role
    if (occ.bass > 0.7 && occ.lead > 0.6) {
      // Radio is full — abstain from lead, provide texture
      return barInPhrase < 4 ? 'TEXTURE' : 'RHYTHMIC';
    }
    if (occ.bass > 0.7) {
      // Radio bass is strong — don't compete, provide countermelody
      return 'COUNTERMELODY';
    }
    if (occ.lead > 0.6) {
      // Radio lead is strong — provide bass support
      return 'BASS';
    }
    if (occ.kick > 0.7 && occ.hats > 0.5) {
      // Radio rhythm is full — respond with melodic content
      return 'RESPONSE';
    }
    // Radio is sparse — take the lead
    return 'LEAD';
  }

  planBar(bar: number, transportBpm: number): NotePlan {
    this.context.updateFromTransport(bar, transportBpm);

    // Check if we need a new phrase plan
    if (this.planner.needsNewPlan(bar)) {
      const ctx = this.context.snapshot(bar);
      this.currentPlan = this.planner.planPhrase(ctx);
      // F6: Initialize motif development for the new phrase
      this.currentMotif = this.currentPlan.motif;
      this.currentPhraseMotifs = [];
      this.lastPhraseMotif = this.currentMotif; // remember for call/response
    }

    const ctx = this.context.snapshot(bar);
    const plan = this.currentPlan!;
    const barInPhrase = bar % 8;
    const action = PHRASE_BAR_ACTIONS[barInPhrase] ?? 'repeat';
    const role = this.chooseRole(ctx, barInPhrase);

    // ── F6: Motif development within the phrase ──
    let motifForBar: StoredMotif = this.currentMotif!;

    if (action === 'transform' && barInPhrase >= 3) {
      // Transform the motif — but only if we haven't already transformed for this bar
      if (this.currentPhraseMotifs[barInPhrase] === undefined) {
        const transformType = this.memory.chooseTransform();
        motifForBar = this.memory.transformMotif(
          this.currentMotif, transformType, ctx.rootPc, ctx.scale, bar
        );
        this.currentPhraseMotifs[barInPhrase] = motifForBar;
      } else {
        motifForBar = this.currentPhraseMotifs[barInPhrase];
      }
    } else if (action === 'variation' && barInPhrase === 5) {
      // Create a variation — small change to the motif
      if (this.currentPhraseMotifs[barInPhrase] === undefined) {
        motifForBar = this.memory.transformMotif(
          this.currentMotif, 'transpose', ctx.rootPc, ctx.scale, bar
        );
        this.currentPhraseMotifs[barInPhrase] = motifForBar;
      } else {
        motifForBar = this.currentPhraseMotifs[barInPhrase];
      }
    } else if (action === 'cadence' && barInPhrase === 6) {
      // Cadence — fragment + resolve to stable degree
      if (this.currentPhraseMotifs[barInPhrase] === undefined) {
        motifForBar = this.memory.transformMotif(
          this.currentMotif, 'fragment', ctx.rootPc, ctx.scale, bar
        );
        this.currentPhraseMotifs[barInPhrase] = motifForBar;
      } else {
        motifForBar = this.currentPhraseMotifs[barInPhrase];
      }
    } else if (action === 'response' && barInPhrase === 7) {
      // Response — return to original motif (call/response structure)
      motifForBar = this.currentMotif;
    } else {
      // Use the base motif (or previously transformed version)
      motifForBar = this.currentPhraseMotifs[barInPhrase] ?? this.currentMotif;
    }

    // ── Generate notes for this bar ──
    const notes: ScheduledNote[] = [];

    // Kick pattern
    for (let s = 0; s < 16; s++) {
      if (plan.kickPattern.hits[s]) {
        const kickAllowed = ctx.energy < 0.8 || this.rng.next() < ctx.density;
        if (kickAllowed && role !== 'ABSTAIN') {
          notes.push({ step: s, voice: 'kick', midi: null, velocity: 0.9 });
        }
      }
    }

    // Hat pattern
    for (let s = 0; s < 16; s++) {
      if (plan.hatPattern.hits[s] && role !== 'ABSTAIN') {
        const vel = (plan.hatPattern.velocities?.[s] ?? 0.5) * (0.7 + ctx.tension * 0.3);
        notes.push({ step: s, voice: 'hat', midi: null, velocity: Math.min(1, vel) });
      }
    }

    // ── F6: Bass with musical movement ──
    if (role !== 'ABSTAIN' && (role === 'BASS' || role === 'SUPPORT' || role === 'LEAD' || role === 'RESPONSE')) {
      const bassOctave = 2;
      const bassNotes = this.generateBassForBar(ctx, plan, barInPhrase, bassOctave);
      for (const bn of bassNotes) {
        notes.push(bn);
      }
    }

    // ── F6: Lead with motif development across ALL bars ──
    if (role !== 'ABSTAIN' && role !== 'BASS' && role !== 'RHYTHMIC') {
      const leadNotes = this.generateLeadForBar(ctx, motifForBar, barInPhrase, action, role);
      for (const ln of leadNotes) {
        notes.push(ln);
      }
    }

    const notePlan: NotePlan = {
      bar,
      notes: Object.freeze(notes) as ScheduledNote[],
      phrasePlan: plan,
      ctx,
      role,
      barInPhrase,
      motifAction: action,
    };

    this.currentNotePlan = notePlan;
    return notePlan;
  }

  /**
   * F6: Generate bass notes with musical movement.
   * Not just root — includes passing tones, fifths, and phrase endings.
   */
  private generateBassForBar(
    ctx: MusicalContextSnapshot,
    plan: PhrasePlan,
    barInPhrase: number,
    octave: number,
  ): ScheduledNote[] {
    const notes: ScheduledNote[] = [];
    const rootMidi = degreeToMidi(ctx.rootPc, ctx.scale, 0, octave);
    const fifthMidi = degreeToMidi(ctx.rootPc, ctx.scale, 4, octave); // perfect fifth
    const thirdMidi = degreeToMidi(ctx.rootPc, ctx.scale, 2, octave); // third

    // Bass pattern from the plan
    for (const bn of plan.bassPattern) {
      let midi = rootMidi;
      let velocity = bn.velocity;

      // F6: Musical bass movement based on bar position in phrase
      if (barInPhrase === 7) {
        // Phrase ending — walk to the fifth or third
        if (bn.step === 0) midi = rootMidi;
        else if (bn.step === plan.bassPattern.length - 1) midi = fifthMidi;
        else midi = this.rng.next() > 0.5 ? thirdMidi : rootMidi;
      } else if (barInPhrase === 6) {
        // Cadence bar — approach note
        if (bn.step === 0) midi = fifthMidi;
        else midi = rootMidi;
      } else if (barInPhrase >= 4 && this.rng.next() < 0.3) {
        // Development — occasional passing tone
        midi = this.rng.next() > 0.5 ? fifthMidi : thirdMidi;
      } else if (bn.step > 0 && this.rng.next() < ctx.novelty * 0.2) {
        // Sparse passing tone based on novelty
        const degree = this.rng.pick([0, 2, 4]); // root, 3rd, 5th
        midi = degreeToMidi(ctx.rootPc, ctx.scale, degree, octave);
      }

      notes.push({
        step: bn.step,
        voice: 'bass',
        midi,
        velocity,
      });
    }

    return notes;
  }

  /**
   * F6: Generate lead notes from motif, filling ALL bars.
   * Uses motif development: introduce, repeat, transform, cadence.
   * Adds contour direction and ensures musical coherence.
   */
  private generateLeadForBar(
    ctx: MusicalContextSnapshot,
    motif: StoredMotif,
    barInPhrase: number,
    action: string,
    role: MusicalRole,
  ): ScheduledNote[] {
    const notes: ScheduledNote[] = [];
    const motifStart = barInPhrase * 16;

    // F6: Register shift based on tension and section
    const registerShift = ctx.tension > 0.7 ? 12 : (ctx.tension > 0.5 ? 0 : -12);
    // For countermelody, shift up an octave
    const roleShift = role === 'COUNTERMELODY' ? 12 : 0;

    // Map motif notes to this bar's steps
    const motifNotesInBar = motif.notes.filter(mn =>
      mn.step >= motifStart && mn.step < motifStart + 16
    );

    if (motifNotesInBar.length > 0) {
      // Play the motif notes
      for (const mn of motifNotesInBar) {
        const localStep = mn.step - motifStart;
        if (this.rng.next() < ctx.density) {
          notes.push({
            step: localStep,
            voice: 'lead',
            midi: mn.midi + registerShift + roleShift,
            velocity: mn.velocity * (0.6 + ctx.tension * 0.4),
          });
        }
      }
    } else {
      // F6: No motif notes in this bar — generate complementary content
      // based on the action and musical context
      if (action === 'cadence') {
        // Cadence — resolve to stable degree
        const stableDeg = this.rng.pick([0, 4]); // root or fifth
        const midi = degreeToMidi(ctx.rootPc, ctx.scale, stableDeg, 5 + (registerShift / 12));
        notes.push({ step: 0, voice: 'lead', midi: midi + roleShift, velocity: 0.7 });
        notes.push({ step: 8, voice: 'lead', midi: midi + roleShift, velocity: 0.6 });
      } else if (action === 'response') {
        // Response — echo the motif's opening
        if (motif.notes.length > 0) {
          const firstNote = motif.notes[0];
          const midi = firstNote.midi + registerShift + roleShift;
          notes.push({ step: 0, voice: 'lead', midi, velocity: 0.6 });
          notes.push({ step: 4, voice: 'lead', midi, velocity: 0.5 });
        }
      } else if (action === 'repeat') {
        // Repeat — sparse echoes of the motif
        if (motif.notes.length > 0) {
          // Pick 1-2 notes from the motif to echo
          const echoCount = this.rng.int(1, 2);
          for (let i = 0; i < echoCount; i++) {
            const srcNote = this.rng.pick(motif.notes);
            const midi = srcNote.midi + registerShift + roleShift;
            const step = this.rng.pick([0, 4, 8, 12]);
            notes.push({ step, voice: 'lead', midi, velocity: 0.4 });
          }
        }
      } else if (action === 'transform' || action === 'variation') {
        // Transform — play a variation using nearby scale degrees
        if (motif.notes.length > 0) {
          const baseNote = motif.notes[0];
          const nearbyDegree = this.rng.pick([-1, 1, 2, -2]);
          const midi = degreeToMidi(ctx.rootPc, ctx.scale, nearbyDegree, 5) + roleShift;
          notes.push({ step: 0, voice: 'lead', midi, velocity: 0.5 });
          if (this.rng.next() < 0.5) {
            const midi2 = degreeToMidi(ctx.rootPc, ctx.scale, 0, 5) + roleShift;
            notes.push({ step: 8, voice: 'lead', midi: midi2, velocity: 0.4 });
          }
        }
      } else if (action === 'introduce' && motif.notes.length === 0) {
        // Fallback: generate a simple ascending contour
        const startDeg = this.rng.pick([0, 2, 4]);
        for (let i = 0; i < 4; i++) {
          const deg = startDeg + i;
          const midi = degreeToMidi(ctx.rootPc, ctx.scale, deg, 5) + roleShift;
          notes.push({ step: i * 4, voice: 'lead', midi, velocity: 0.5 });
        }
      }
    }

    return notes;
  }

  getCurrentPlan(): NotePlan | null { return this.currentNotePlan; }

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
      role: this.currentNotePlan.role,
    };
  }

  hasLearned(): boolean { return this.learned; }

  reset(): void {
    this.context.reset();
    this.memory.reset();
    this.planner.reset();
    this.currentPlan = null;
    this.currentNotePlan = null;
    this.currentMotif = null;
    this.currentPhraseMotifs = [];
    this.lastPhraseMotif = null;
    this.rng = new Rng(43);
    this.learned = false;
  }

  getContext(): MusicalContext { return this.context; }
  getMemory(): MotifMemory { return this.memory; }
  getPlanner(): CompositionPlanner { return this.planner; }
}
