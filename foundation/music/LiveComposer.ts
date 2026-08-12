/**
 * LiveComposer — F7 REBUILD
 *
 * F7: The complete live learning loop with:
 * - RadioMusicalWindow (context history)
 * - MusicalMemory (short/medium/long-term with learning)
 * - MusicalIntent (role selection with ABSTAIN)
 * - Phrase structure (A→A'→B→A-return)
 * - Learning feedback (phrase evaluation → reward → memory update)
 *
 * Chain:
 *   Radio → RadioMusicalWindow → MusicalContext → MusicalIntent
 *     → MusicalMemory → CompositionPlanner → NotePlan → Scheduler
 *     → Audio → evaluate → reward → memory update ↺
 */

import { MusicalContext, type MusicalContextSnapshot, COMPOSITION_ARC } from './MusicalContext';
import { MusicalMemory, type StoredMotif, type PhraseRecord } from './MusicalMemory';
import { MusicalIntent, type MusicalDecision, type MusicalRole, type PhraseAction } from './MusicalIntent';
import { RadioMusicalWindow, type RadioWindowSnapshot } from './RadioMusicalWindow';
import { CompositionPlanner, type PhrasePlan } from './CompositionPlanner';
import { type Scale, degreeToMidi, stableDegrees } from './primitives/scales';
import { type MotifNote, generateMotif, transpose, invert, fragment, retrograde } from './primitives/motif';
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
  readonly decision: MusicalDecision;
  readonly barInPhrase: number;
}

export interface LiveComposerSnapshot {
  readonly ctx: MusicalContextSnapshot;
  readonly radio: RadioWindowSnapshot;
  readonly memory: import('./MusicalMemory').MusicalMemorySnapshot;
  readonly decision: MusicalDecision;
  readonly motifCount: number;
  readonly currentSection: string;
  readonly currentPhrase: number;
  readonly tension: number;
  readonly novelty: number;
  readonly planBar: number;
  readonly noteCount: number;
  readonly role: MusicalRole;
  readonly action: PhraseAction;
  readonly hasLearned: boolean;
  readonly lastReward: number;
}

// Phrase structure: A → A' → B → A-return (F7 RULE 4)
// Phrases 0,1 = A (same motif, second is transformed)
// Phrase 2 = B (new motif, contrast)
// Phrase 3 = A-return (callback to phrase 0's motif)
// Phrases 4,5 = A'' B' (development)
// Phrase 6 = Climax (new or transformed)
// Phrase 7 = A-return (final callback)
const PHRASE_STRUCTURE: number[] = [0, 0, 1, 0, 0, 1, 2, 0]; // indices into motif groups

export class LiveComposer {
  private context: MusicalContext;
  private window: RadioMusicalWindow;
  private memory: MusicalMemory;
  private intent: MusicalIntent;
  private planner: CompositionPlanner;
  private rng: Rng;

  private currentPlan: PhrasePlan | null = null;
  private currentNotePlan: NotePlan | null = null;
  private currentMotif: StoredMotif | null = null;
  private phraseMotifs: Map<number, StoredMotif> = new Map(); // barInPhrase → motif
  private learned: boolean = false;

  // F7: Track phrase for evaluation
  private currentPhraseNotes: ScheduledNote[] = [];
  private currentPhraseStartBar: number = 0;

  // F7: Motif groups for A→A'→B→A-return structure
  private motifGroups: StoredMotif[][] = [[], [], []]; // group 0=A, 1=B, 2=C(climax)

  constructor(seed: number = 42) {
    this.context = new MusicalContext();
    this.window = new RadioMusicalWindow();
    this.memory = new MusicalMemory(seed);
    this.intent = new MusicalIntent();
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
    this.window.observe(data);
    this.learned = true;
  }

  planBar(bar: number, transportBpm: number): NotePlan {
    this.context.updateFromTransport(bar, transportBpm);
    const ctx = this.context.snapshot(bar);
    const radio = this.window.snapshot(bar);
    const memSnap = this.memory.snapshot();

    // ── F7: Decide musical intent ──
    const barInPhrase = bar % 8;
    const decision = this.intent.decide(barInPhrase, bar, ctx, radio, memSnap);

    // ── F7: Phrase planning ──
    if (this.planner.needsNewPlan(bar)) {
      this.currentPlan = this.planner.planPhrase(ctx);
      this.phraseMotifs.clear();
      this.currentPhraseNotes = [];
      this.currentPhraseStartBar = bar;

      // F7: A→A'→B→A-return structure
      const phraseIndex = ctx.phraseIndex;
      const structureGroup = PHRASE_STRUCTURE[phraseIndex % 8];

      // Get or create motif for this structure group
      if (this.motifGroups[structureGroup].length === 0) {
        // Create new motif for this group
        const motifNotes = generateMotif(ctx.rootPc, ctx.scale, {
          seed: this.rng.int(1, 100000),
          steps: 32,
          density: ctx.density,
          glideProb: 0.3 + ctx.novelty * 0.2,
          responseShift: this.rng.int(1, 3),
        });
        this.currentMotif = this.memory.createMotif(motifNotes, ctx.rootPc, ctx.scaleName, bar);
        this.motifGroups[structureGroup].push(this.currentMotif);
      } else {
        // Reuse motif from this group (A-return)
        const groupMotifs = this.motifGroups[structureGroup];
        // Use the original (first) motif for A-return, or a transformed version for A'
        if (phraseIndex % 8 === 1 || phraseIndex % 8 === 4) {
          // A' — transform the original
          const original = groupMotifs[0];
          this.currentMotif = this.memory.transformMotif(
            original, 'transpose', ctx.rootPc, ctx.scale, bar
          );
          groupMotifs.push(this.currentMotif);
        } else {
          // A-return — use the original
          this.currentMotif = groupMotifs[0];
        }
      }
    }

    const plan = this.currentPlan!;

    // ── F7: Motif development within phrase ──
    let motifForBar = this.currentMotif!;
    const action = decision.action;

    if ((action === 'develop' || action === 'variation') && !this.phraseMotifs.has(barInPhrase)) {
      const transformType = decision.transformType !== 'none' ? decision.transformType : 'transpose';
      motifForBar = this.memory.transformMotif(
        this.currentMotif, transformType, ctx.rootPc, ctx.scale, bar
      );
      this.phraseMotifs.set(barInPhrase, motifForBar);
    } else if (action === 'cadence' && !this.phraseMotifs.has(barInPhrase)) {
      motifForBar = this.memory.transformMotif(
        this.currentMotif, 'fragment', ctx.rootPc, ctx.scale, bar
      );
      this.phraseMotifs.set(barInPhrase, motifForBar);
    } else if (this.phraseMotifs.has(barInPhrase)) {
      motifForBar = this.phraseMotifs.get(barInPhrase)!;
    }

    // ── Generate notes ──
    const notes: ScheduledNote[] = [];

    // ABSTAIN → minimal or no notes
    if (decision.shouldRest || decision.role === 'ABSTAIN') {
      // Only play a sparse hat or nothing
      if (this.rng.next() < 0.3) {
        notes.push({ step: 8, voice: 'hat', midi: null, velocity: 0.2 });
      }
    } else {
      // Kick
      if (decision.role !== 'ABSTAIN') {
        for (let s = 0; s < 16; s++) {
          if (plan.kickPattern.hits[s] && this.rng.next() < decision.density) {
            notes.push({ step: s, voice: 'kick', midi: null, velocity: 0.9 });
          }
        }
      }

      // Hats
      if (decision.role !== 'ABSTAIN') {
        for (let s = 0; s < 16; s++) {
          if (plan.hatPattern.hits[s]) {
            const vel = (plan.hatPattern.velocities?.[s] ?? 0.5) * (0.6 + ctx.tension * 0.4);
            notes.push({ step: s, voice: 'hat', midi: null, velocity: Math.min(1, vel) });
          }
        }
      }

      // Bass
      if (['BASS', 'SUPPORT', 'LEAD', 'RESPONSE'].includes(decision.role)) {
        const bassNotes = this.generateBass(ctx, plan, barInPhrase, decision);
        notes.push(...bassNotes);
      }

      // Lead
      if (!['ABSTAIN', 'BASS', 'RHYTHMIC'].includes(decision.role)) {
        const leadNotes = this.generateLead(ctx, motifForBar, barInPhrase, action, decision);
        notes.push(...leadNotes);
      }
    }

    // Track notes for phrase evaluation
    this.currentPhraseNotes.push(...notes);

    // ── F7: Evaluate phrase at end ──
    if (barInPhrase === 7) {
      this.evaluatePhrase(bar, ctx, decision);
    }

    const notePlan: NotePlan = {
      bar,
      notes: Object.freeze(notes) as ScheduledNote[],
      phrasePlan: plan,
      ctx,
      decision,
      barInPhrase,
    };

    this.currentNotePlan = notePlan;
    return notePlan;
  }

  /**
   * F7 RULE 12: Evaluate phrase and update memory (learning).
   */
  private evaluatePhrase(bar: number, ctx: MusicalContextSnapshot, decision: MusicalDecision): void {
    const notes = this.currentPhraseNotes;
    const leadNotes = notes.filter(n => n.voice === 'lead' && n.midi !== null);
    const bassNotes = notes.filter(n => n.voice === 'bass' && n.midi !== null);
    const restBars = notes.length < 4 ? 1 : 0;

    // Reward components
    const coherenceScore = leadNotes.length > 0 ? 0.5 : 0.3;
    const densityFit = Math.abs(notes.length / 8 - ctx.density * 10) < 5 ? 0.8 : 0.4;
    const radioFit = decision.radioInfluence > 0.3 ? 0.7 : 0.5;
    const noveltyScore = decision.action === 'develop' || decision.action === 'variation' ? 0.7 : 0.5;

    const reward = (coherenceScore * 0.3 + densityFit * 0.25 + radioFit * 0.25 + noveltyScore * 0.2);

    const record: PhraseRecord = {
      phraseIndex: ctx.phraseIndex,
      bar: this.currentPhraseStartBar,
      motifId: this.currentMotif?.id ?? 'unknown',
      transform: decision.transformType,
      section: ctx.sectionName,
      tension: ctx.tension,
      density: ctx.density,
      noteCount: notes.length,
      restRatio: restBars / 8,
      reward,
      role: decision.role,
    };

    this.memory.recordPhrase(record);
  }

  /**
   * F7 RULE 10: Bass with musical movement.
   */
  private generateBass(ctx: MusicalContextSnapshot, plan: PhrasePlan, barInPhrase: number, decision: MusicalDecision): ScheduledNote[] {
    const notes: ScheduledNote[] = [];
    const octave = 2;
    const rootMidi = degreeToMidi(ctx.rootPc, ctx.scale, 0, octave);
    const fifthMidi = degreeToMidi(ctx.rootPc, ctx.scale, 4, octave);
    const thirdMidi = degreeToMidi(ctx.rootPc, ctx.scale, 2, octave);

    for (const bn of plan.bassPattern) {
      let midi = rootMidi;

      // Bass behavior based on phrase position
      if (barInPhrase === 6) {
        // Cadence: fifth → root
        midi = bn.step === 0 ? fifthMidi : rootMidi;
      } else if (barInPhrase === 7) {
        // Response: root with occasional third
        midi = bn.step === plan.bassPattern.length - 1 ? thirdMidi : rootMidi;
      } else if (barInPhrase >= 3 && barInPhrase <= 5 && this.rng.next() < 0.3) {
        // Development: occasional fifth or third
        midi = this.rng.next() > 0.5 ? fifthMidi : thirdMidi;
      } else if (barInPhrase >= 1 && barInPhrase <= 2 && this.rng.next() < 0.15) {
        // Repeat: sparse passing tone
        midi = thirdMidi;
      }

      notes.push({ step: bn.step, voice: 'bass', midi, velocity: bn.velocity });
    }

    return notes;
  }

  /**
   * F7 RULE 11: Lead with motif identity, contour, development.
   */
  private generateLead(ctx: MusicalContextSnapshot, motif: StoredMotif, barInPhrase: number, action: PhraseAction, decision: MusicalDecision): ScheduledNote[] {
    const notes: ScheduledNote[] = [];
    const registerShift = Math.round(decision.register * 12);
    const motifStart = barInPhrase * 16;

    // Map motif notes to this bar
    const motifNotesInBar = motif.notes.filter(mn => mn.step >= motifStart && mn.step < motifStart + 16);

    if (motifNotesInBar.length > 0) {
      for (const mn of motifNotesInBar) {
        const localStep = mn.step - motifStart;
        if (this.rng.next() < decision.density) {
          notes.push({
            step: localStep,
            voice: 'lead',
            midi: mn.midi + registerShift,
            velocity: mn.velocity * (0.6 + ctx.tension * 0.4),
          });
        }
      }
    } else {
      // F7: Fill bars without motif notes using action-appropriate content
      if (action === 'cadence') {
        // Resolve to stable degree
        const stableDeg = this.rng.pick([0, 4]);
        const midi = degreeToMidi(ctx.rootPc, ctx.scale, stableDeg, 5) + registerShift;
        notes.push({ step: 0, voice: 'lead', midi, velocity: 0.6 });
        notes.push({ step: 8, voice: 'lead', midi, velocity: 0.5 });
      } else if (action === 'response') {
        // Echo the motif's opening
        if (motif.notes.length > 0) {
          const firstNote = motif.notes[0];
          const midi = firstNote.midi + registerShift;
          notes.push({ step: 0, voice: 'lead', midi, velocity: 0.5 });
          if (this.rng.next() < 0.5) {
            notes.push({ step: 4, voice: 'lead', midi, velocity: 0.4 });
          }
        }
      } else if (action === 'repeat') {
        // Sparse echoes
        if (motif.notes.length > 0) {
          const echoCount = this.rng.int(1, 2);
          for (let i = 0; i < echoCount; i++) {
            const srcNote = this.rng.pick(motif.notes);
            const midi = srcNote.midi + registerShift;
            const step = this.rng.pick([0, 4, 8, 12]);
            notes.push({ step, voice: 'lead', midi, velocity: 0.35 });
          }
        }
      } else if (action === 'develop' || action === 'variation') {
        // Transform — play nearby scale degrees
        if (motif.notes.length > 0) {
          const nearbyDegree = this.rng.pick([-1, 1, 2, -2]);
          const midi = degreeToMidi(ctx.rootPc, ctx.scale, nearbyDegree, 5) + registerShift;
          notes.push({ step: 0, voice: 'lead', midi, velocity: 0.45 });
          if (this.rng.next() < 0.5) {
            const midi2 = degreeToMidi(ctx.rootPc, ctx.scale, 0, 5) + registerShift;
            notes.push({ step: 8, voice: 'lead', midi: midi2, velocity: 0.35 });
          }
        }
      }
    }

    return notes;
  }

  getCurrentPlan(): NotePlan | null { return this.currentNotePlan; }

  snapshot(): LiveComposerSnapshot | null {
    if (!this.currentNotePlan) return null;
    const ctx = this.currentNotePlan.ctx;
    const radio = this.window.snapshot(ctx.bar);
    const mem = this.memory.snapshot();
    return {
      ctx,
      radio,
      memory: mem,
      decision: this.currentNotePlan.decision,
      motifCount: mem.mediumTermMotifCount,
      currentSection: ctx.sectionName,
      currentPhrase: ctx.phraseIndex,
      tension: ctx.tension,
      novelty: ctx.novelty,
      planBar: this.currentNotePlan.bar,
      noteCount: this.currentNotePlan.notes.length,
      role: this.currentNotePlan.decision.role,
      action: this.currentNotePlan.decision.action,
      hasLearned: this.learned,
      lastReward: mem.lastReward,
    };
  }

  hasLearned(): boolean { return this.learned; }

  reset(): void {
    this.context.reset();
    this.window.reset();
    this.memory.reset();
    this.intent.reset();
    this.planner.reset();
    this.currentPlan = null;
    this.currentNotePlan = null;
    this.currentMotif = null;
    this.phraseMotifs.clear();
    this.motifGroups = [[], [], []];
    this.currentPhraseNotes = [];
    this.learned = false;
    this.rng = new Rng(43);
  }

  getContext(): MusicalContext { return this.context; }
  getMemory(): MusicalMemory { return this.memory; }
  getWindow(): RadioMusicalWindow { return this.window; }
  getIntent(): MusicalIntent { return this.intent; }
  getPlanner(): CompositionPlanner { return this.planner; }
}
