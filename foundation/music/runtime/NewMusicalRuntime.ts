/**
 * NewMusicalRuntime — the complete F7 musical decision layer.
 *
 * Replaces the legacy LiveComposer with a proper architecture:
 *
 *   RADIO → RadioMusicalWindow → OpportunityEngine → StyleGrammar
 *     → GrooveEngine → MusicalDirector → NotePlan → Scheduler
 *
 * Uses psy-foundation's CandidateScorer + MotifMemory + MusicalLearning
 * for intelligent, explainable, learning musical decisions.
 */

import { OpportunityEngine, type OpportunityMap } from './OpportunityEngine';
import { StyleController, type StyleGrammarDef, type MusicalStyle } from './StyleGrammar';
import { GrooveEngine, type GroovePlan } from './GrooveEngine';
import { MusicalDirector, type MusicalDecision, type MusicalRole, type PhraseAction } from './MusicalDirector';
import { RadioMusicalWindow, type RadioWindowSnapshot } from '../RadioMusicalWindow';
import { MusicalContext, type MusicalContextSnapshot, COMPOSITION_ARC } from '../MusicalContext';
import { MusicalMemory, type StoredMotif, type PhraseRecord } from '../MusicalMemory';
import { type Scale, degreeToMidi, stableDegrees } from '../primitives/scales';
import { type MotifNote, generateMotif, transpose, invert, fragment, retrograde } from '../primitives/motif';
import { type BassNote, generateBassPattern } from '../primitives/bass';
import { type RhythmPattern } from '../primitives/rhythm';
import { Rng } from '../primitives/rng';

export interface ScheduledNote {
  readonly step: number;
  readonly voice: 'kick' | 'bass' | 'lead' | 'hat';
  readonly midi: number | null;
  readonly velocity: number;
}

export interface NotePlan {
  readonly bar: number;
  readonly notes: ScheduledNote[];
  readonly decision: MusicalDecision;
  readonly groove: GroovePlan;
  readonly opportunity: OpportunityMap;
  readonly style: MusicalStyle;
  readonly barInPhrase: number;
}

export interface NewRuntimeSnapshot {
  readonly style: MusicalStyle;
  readonly styleState: string;
  readonly styleConfidence: number;
  readonly role: MusicalRole;
  readonly action: PhraseAction;
  readonly tension: number;
  readonly density: number;
  readonly opportunitySummary: string;
  readonly grooveStrategy: string;
  readonly bassStrategy: string;
  readonly motifCount: number;
  readonly section: string;
  readonly phrase: number;
  readonly bar: number;
  readonly decisionReason: string;
  readonly radioInfluence: number;
  readonly memoryInfluence: number;
  readonly hasLearned: boolean;
  readonly lastReward: number;
}

// Phrase structure: A → A' → B → A-return
const PHRASE_STRUCTURE = [0, 0, 1, 0, 0, 1, 2, 0];

export class NewMusicalRuntime {
  private context: MusicalContext;
  private window: RadioMusicalWindow;
  private memory: MusicalMemory;
  private opportunity: OpportunityEngine;
  private styleCtrl: StyleController;
  private groove: GrooveEngine;
  private director: MusicalDirector;
  private rng: Rng;

  private currentPlan: NotePlan | null = null;
  private currentMotif: StoredMotif | null = null;
  private phraseMotifs: Map<number, StoredMotif> = new Map();
  private motifGroups: StoredMotif[][] = [[], [], []];
  private learned: boolean = false;
  private currentPhraseNotes: ScheduledNote[] = [];
  private currentPhraseStartBar: number = 0;

  constructor(seed: number = 42) {
    this.context = new MusicalContext();
    this.window = new RadioMusicalWindow();
    this.memory = new MusicalMemory(seed);
    this.opportunity = new OpportunityEngine();
    this.styleCtrl = new StyleController();
    this.groove = new GrooveEngine();
    this.director = new MusicalDirector();
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
    this.styleCtrl.observe({ ...data, bar: this.context.snapshot(0).bar });
    this.learned = true;
  }

  planBar(bar: number, transportBpm: number): NotePlan {
    this.context.updateFromTransport(bar, transportBpm);
    const ctx = this.context.snapshot(bar);
    const radio = this.window.snapshot(bar);
    const grammar = this.styleCtrl.getGrammar();
    const memSnap = this.memory.snapshot();

    // ── Opportunity analysis ──
    const opp = this.opportunity.analyze(radio.currentOccupancy, radio.currentEnergy);

    // ── Groove planning ──
    const barInPhrase = bar % 8;
    const groovePlan = this.groove.planGroove(grammar, radio.currentOccupancy, barInPhrase);

    // ── Musical direction ──
    const decision = this.director.decide(
      barInPhrase, opp, grammar, groovePlan, radio, memSnap.avgReward, bar
    );

    // ── Motif management (A→A'→B→A-return) ──
    if (barInPhrase === 0) {
      this.phraseMotifs.clear();
      this.currentPhraseNotes = [];
      this.currentPhraseStartBar = bar;

      const phraseIndex = ctx.phraseIndex;
      const groupIdx = PHRASE_STRUCTURE[phraseIndex % 8];

      if (this.motifGroups[groupIdx].length === 0) {
        // Create new motif for this group
        const motifNotes = generateMotif(ctx.rootPc, ctx.scale, {
          seed: this.rng.int(1, 100000),
          steps: 32,
          density: ctx.density,
          glideProb: 0.3 + ctx.novelty * 0.2,
          responseShift: this.rng.int(1, 3),
        });
        this.currentMotif = this.memory.createMotif(motifNotes, ctx.rootPc, ctx.scaleName, bar);
        this.motifGroups[groupIdx].push(this.currentMotif);
      } else {
        // A' or A-return
        if (phraseIndex % 8 === 1 || phraseIndex % 8 === 4) {
          // Transformed version
          this.currentMotif = this.memory.transformMotif(
            this.motifGroups[groupIdx][0], 'transpose', ctx.rootPc, ctx.scale, bar
          );
          this.motifGroups[groupIdx].push(this.currentMotif);
        } else {
          // A-return: use original
          this.currentMotif = this.motifGroups[groupIdx][0];
        }
      }
    }

    // ── Motif development within phrase ──
    let motifForBar = this.currentMotif!;
    const action = decision.action;

    if ((action === 'develop' || action === 'transform' || action === 'variation') && !this.phraseMotifs.has(barInPhrase)) {
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

    if (decision.shouldRest || decision.role === 'ABSTAIN') {
      // Intentional rest — minimal or no notes
      if (this.rng.next() < 0.3) {
        notes.push({ step: 8, voice: 'hat', midi: null, velocity: 0.15 });
      }
    } else {
      // Kick (backbone — always present unless ABSTAIN)
      for (let s = 0; s < 16; s++) {
        if (groovePlan.kickPattern.hits[s] && this.rng.next() < decision.density) {
          notes.push({ step: s, voice: 'kick', midi: null, velocity: 0.9 });
        }
      }

      // Hats
      for (let s = 0; s < 16; s++) {
        if (groovePlan.hatPattern.hits[s]) {
          const vel = (groovePlan.hatPattern.velocities?.[s] ?? 0.5) * (0.6 + ctx.tension * 0.4);
          notes.push({ step: s, voice: 'hat', midi: null, velocity: Math.min(1, vel) });
        }
      }

      // Bass
      if (['BASS', 'SUPPORT', 'LEAD', 'RESPONSE'].includes(decision.role)) {
        const bassNotes = this.generateBass(ctx, groovePlan, barInPhrase, decision);
        notes.push(...bassNotes);
      }

      // Lead
      if (!['ABSTAIN', 'BASS', 'RHYTHMIC'].includes(decision.role)) {
        const leadNotes = this.generateLead(ctx, motifForBar, barInPhrase, action, decision, grammar);
        notes.push(...leadNotes);
      }
    }

    this.currentPhraseNotes.push(...notes);

    // ── Phrase evaluation (learning) ──
    if (barInPhrase === 7) {
      this.evaluatePhrase(bar, ctx, decision);
    }

    const plan: NotePlan = {
      bar,
      notes: Object.freeze(notes) as ScheduledNote[],
      decision,
      groove: groovePlan,
      opportunity: opp,
      style: this.styleCtrl.getStyle(),
      barInPhrase,
    };

    this.currentPlan = plan;
    return plan;
  }

  private generateBass(ctx: MusicalContextSnapshot, groove: GroovePlan, barInPhrase: number, decision: MusicalDecision): ScheduledNote[] {
    const notes: ScheduledNote[] = [];
    const octave = 2;
    const rootMidi = degreeToMidi(ctx.rootPc, ctx.scale, 0, octave);
    const fifthMidi = degreeToMidi(ctx.rootPc, ctx.scale, 4, octave);
    const thirdMidi = degreeToMidi(ctx.rootPc, ctx.scale, 2, octave);

    for (const step of groove.bassSteps) {
      let midi = rootMidi;

      if (barInPhrase === 6) {
        // Cadence: fifth → root
        midi = step === groove.bassSteps[0] ? fifthMidi : rootMidi;
      } else if (barInPhrase === 7) {
        // Response: root with occasional third
        midi = step === groove.bassSteps[groove.bassSteps.length - 1] ? thirdMidi : rootMidi;
      } else if (barInPhrase >= 3 && barInPhrase <= 5 && this.rng.next() < 0.25) {
        midi = this.rng.next() > 0.5 ? fifthMidi : thirdMidi;
      }

      notes.push({ step, voice: 'bass', midi, velocity: 0.8 });
    }

    return notes;
  }

  private generateLead(ctx: MusicalContextSnapshot, motif: StoredMotif, barInPhrase: number, action: PhraseAction, decision: MusicalDecision, grammar: StyleGrammarDef): ScheduledNote[] {
    const notes: ScheduledNote[] = [];
    const registerShift = Math.round(decision.register * 12);
    const motifStart = barInPhrase * 16;
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
      // Fill bars without motif notes
      if (action === 'cadence') {
        const stableDeg = this.rng.pick([0, 4]);
        const midi = degreeToMidi(ctx.rootPc, ctx.scale, stableDeg, 5) + registerShift;
        notes.push({ step: 0, voice: 'lead', midi, velocity: 0.6 });
        notes.push({ step: 8, voice: 'lead', midi, velocity: 0.5 });
      } else if (action === 'response') {
        if (motif.notes.length > 0) {
          const firstNote = motif.notes[0];
          const midi = firstNote.midi + registerShift;
          notes.push({ step: 0, voice: 'lead', midi, velocity: 0.5 });
          if (this.rng.next() < 0.5) notes.push({ step: 4, voice: 'lead', midi, velocity: 0.4 });
        }
      } else if (action === 'repeat') {
        if (motif.notes.length > 0) {
          const echoCount = this.rng.int(1, 2);
          for (let i = 0; i < echoCount; i++) {
            const srcNote = this.rng.pick(motif.notes);
            const midi = srcNote.midi + registerShift;
            const step = this.rng.pick([0, 4, 8, 12]);
            notes.push({ step, voice: 'lead', midi, velocity: 0.35 });
          }
        }
      } else if (action === 'develop' || action === 'transform' || action === 'variation') {
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

  private evaluatePhrase(bar: number, ctx: MusicalContextSnapshot, decision: MusicalDecision): void {
    const notes = this.currentPhraseNotes;
    const coherenceScore = notes.filter(n => n.voice === 'lead').length > 0 ? 0.5 : 0.3;
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
      restRatio: notes.length < 4 ? 0.125 : 0,
      reward,
      role: decision.role,
    };
    this.memory.recordPhrase(record);
  }

  getCurrentPlan(): NotePlan | null { return this.currentPlan; }

  snapshot(): NewRuntimeSnapshot | null {
    if (!this.currentPlan) return null;
    const ctx = this.context.snapshot(this.currentPlan.bar);
    const mem = this.memory.snapshot();
    return {
      style: this.styleCtrl.getStyle(),
      styleState: this.styleCtrl.getState(),
      styleConfidence: this.styleCtrl.getConfidence(),
      role: this.currentPlan.decision.role,
      action: this.currentPlan.decision.action,
      tension: ctx.tension,
      density: ctx.density,
      opportunitySummary: this.currentPlan.opportunity.reason,
      grooveStrategy: this.currentPlan.groove.reason,
      bassStrategy: this.currentPlan.decision.bassStrategy,
      motifCount: mem.mediumTermMotifCount,
      section: ctx.sectionName,
      phrase: ctx.phraseIndex,
      bar: this.currentPlan.bar,
      decisionReason: this.currentPlan.decision.reason,
      radioInfluence: this.currentPlan.decision.radioInfluence,
      memoryInfluence: this.currentPlan.decision.memoryInfluence,
      hasLearned: this.learned,
      lastReward: mem.lastReward,
    };
  }

  hasLearned(): boolean { return this.learned; }

  reset(): void {
    this.context.reset();
    this.window.reset();
    this.memory.reset();
    this.styleCtrl.reset();
    this.groove.reset();
    this.director.reset();
    this.currentPlan = null;
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
}
