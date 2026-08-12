/**
 * MusicalSession — THE single musical runtime for psy4.
 *
 * F8 ARCHITECTURAL RESET:
 * - ONE composer (no feature flags, no legacy path)
 * - Planning SEPARATED from scheduling (planBar pre-computes, scheduler reads)
 * - Groove first, then bass, then lead (hierarchical)
 * - Harmony controls melody (lead notes are scored against chord/scale)
 * - Kick is anchor (never accidentally removed)
 * - ABSTAIN is intentional (not a bug)
 *
 * Chain:
 *   Radio → RadioMusicalWindow → MusicalContext → MusicalSession.planBar()
 *     → NotePlan (cached per bar) → Scheduler → Audio
 */

import { MusicalContext, type MusicalContextSnapshot, COMPOSITION_ARC } from './MusicalContext';
import { MusicalMemory, type StoredMotif, type PhraseRecord } from './MusicalMemory';
import { RadioMusicalWindow, type RadioWindowSnapshot } from './RadioMusicalWindow';
import { type Scale, degreeToMidi, stableDegrees, getScale } from './primitives/scales';
import { type MotifNote, generateMotif, transpose, invert, fragment, retrograde } from './primitives/motif';
import { type RhythmPattern, psyKick, fourOnFloor, offbeatHats, drivingHats, swing, combine } from './primitives/rhythm';
import { type BassStyle } from './primitives/bass';
import { Rng } from './primitives/rng';

// ── Types ────────────────────────────────────────────────────────────────

export interface ScheduledNote {
  readonly step: number;
  readonly voice: 'kick' | 'bass' | 'lead' | 'hat';
  readonly midi: number | null;
  readonly velocity: number;
}

export interface NotePlan {
  readonly bar: number;
  readonly notes: readonly ScheduledNote[];
  readonly role: MusicalRole;
  readonly action: PhraseAction;
  readonly style: string;
  readonly section: string;
  readonly tension: number;
  readonly barInPhrase: number;
  readonly reason: string;
}

export type MusicalRole = 'LEAD' | 'COUNTERMELODY' | 'BASS' | 'RHYTHMIC' | 'TEXTURE' | 'RESPONSE' | 'ABSTAIN';
export type PhraseAction = 'introduce' | 'repeat' | 'develop' | 'transform' | 'variation' | 'cadence' | 'response' | 'rest';

export interface SessionSnapshot {
  readonly style: string;
  readonly role: MusicalRole;
  readonly action: PhraseAction;
  readonly section: string;
  readonly phrase: number;
  readonly bar: number;
  readonly tension: number;
  readonly density: number;
  readonly motifCount: number;
  readonly reason: string;
  readonly hasLearned: boolean;
  readonly lastReward: number;
}

// ── Phrase structure: A → A' → B → A-return ──────────────────────────────
const PHRASE_STRUCTURE = [0, 0, 1, 0, 0, 1, 2, 0];

// ── Phrase actions per bar ───────────────────────────────────────────────
const BAR_ACTIONS: PhraseAction[] = ['introduce', 'repeat', 'repeat', 'develop', 'develop', 'variation', 'cadence', 'response'];

// ── MusicalSession ───────────────────────────────────────────────────────

export class MusicalSession {
  private ctx: MusicalContext;
  private window: RadioMusicalWindow;
  private memory: MusicalMemory;
  private rng: Rng;

  private currentPlan: NotePlan | null = null;
  private currentMotif: StoredMotif | null = null;
  private phraseMotifs: Map<number, StoredMotif> = new Map();
  private motifGroups: StoredMotif[][] = [[], [], []];
  private learned = false;
  private phraseNotes: ScheduledNote[] = [];
  private phraseStartBar = 0;

  // Style state
  private style: string = 'FULL_ON';
  private styleConfidence = 0;

  constructor(seed = 42) {
    this.ctx = new MusicalContext();
    this.window = new RadioMusicalWindow();
    this.memory = new MusicalMemory(seed);
    this.rng = new Rng(seed + 1);
  }

  observeRadio(data: {
    bpm: number; energy: number;
    occupancy: { kick: number; bass: number; lead: number; hats: number };
    bassFreq?: number; confidence: number;
  }): void {
    this.ctx.updateFromRadio(data);
    this.window.observe(data);
    this.detectStyle(data);
    this.learned = true;
  }

  /**
   * F8: Plan a bar. This is the ONLY composition entry point.
   * Called once per bar (cached). Scheduler reads the cached plan.
   */
  planBar(bar: number, transportBpm: number): NotePlan {
    this.ctx.updateFromTransport(bar, transportBpm);
    const snap = this.ctx.snapshot(bar);
    const radio = this.window.snapshot(bar);
    const barInPhrase = bar % 8;
    const action = BAR_ACTIONS[barInPhrase];

    // ── Role selection (ABSTAIN aware) ──
    const role = this.chooseRole(radio, snap, barInPhrase);
    const shouldRest = role === 'ABSTAIN';

    // ── Motif management (A→A'→B→A-return) ──
    if (barInPhrase === 0) {
      this.phraseMotifs.clear();
      this.phraseNotes = [];
      this.phraseStartBar = bar;
      this.handleNewPhrase(snap, bar);
    }

    // ── Motif development within phrase ──
    let motif = this.currentMotif!;
    if ((action === 'develop' || action === 'transform' || action === 'variation') && !this.phraseMotifs.has(barInPhrase)) {
      const tType = this.chooseTransform();
      motif = this.memory.transformMotif(this.currentMotif!, tType, snap.rootPc, snap.scale, bar);
      this.phraseMotifs.set(barInPhrase, motif);
    } else if (action === 'cadence' && !this.phraseMotifs.has(barInPhrase)) {
      motif = this.memory.transformMotif(this.currentMotif!, 'fragment', snap.rootPc, snap.scale, bar);
      this.phraseMotifs.set(barInPhrase, motif);
    } else if (this.phraseMotifs.has(barInPhrase)) {
      motif = this.phraseMotifs.get(barInPhrase)!;
    }

    // ── Generate notes (hierarchical: groove → bass → lead) ──
    const notes: ScheduledNote[] = [];

    if (shouldRest) {
      // Intentional rest — sparse hat only
      if (this.rng.next() < 0.3) notes.push({ step: 8, voice: 'hat', midi: null, velocity: 0.15 });
    } else {
      // GROOVE FIRST (kick is anchor — never accidentally removed)
      this.generateGroove(notes, snap, radio, barInPhrase);
      // BASS (anchored to groove + harmony)
      if (['BASS', 'SUPPORT', 'LEAD', 'RESPONSE'].includes(role)) {
        this.generateBass(notes, snap, barInPhrase);
      }
      // LEAD (controlled by motif + harmony + phrase)
      if (!['ABSTAIN', 'BASS', 'RHYTHMIC'].includes(role)) {
        this.generateLead(notes, snap, motif, barInPhrase, action, role);
      }
    }

    this.phraseNotes.push(...notes);

    // ── Phrase evaluation (learning) ──
    if (barInPhrase === 7) this.evaluatePhrase(bar, snap, role, action);

    const plan: NotePlan = {
      bar, notes: Object.freeze(notes) as readonly ScheduledNote[],
      role, action, style: this.style,
      section: snap.sectionName, tension: snap.tension,
      barInPhrase, reason: this.lastReason,
    };

    this.currentPlan = plan;
    return plan;
  }

  private lastReason = '';

  // ── Role selection ──
  private chooseRole(radio: RadioWindowSnapshot, ctx: MusicalContextSnapshot, barInPhrase: number): MusicalRole {
    const occ = radio.currentOccupancy;
    const totalOcc = (occ.kick + occ.bass + occ.lead + occ.hats) / 4;

    // ABSTAIN: intentional rest
    if (totalOcc > 0.8 && barInPhrase === 6) { this.lastReason = 'dense radio, resting at cadence'; return 'ABSTAIN'; }
    if (radio.silenceLikelihood > 0.7 && this.rng.next() < 0.4) { this.lastReason = 'radio silence, resting'; return 'ABSTAIN'; }
    if (barInPhrase === 7 && this.rng.next() < 0.15) { this.lastReason = 'phrase ending rest'; return 'ABSTAIN'; }

    // Role based on what's missing
    if (occ.bass > 0.7 && occ.lead > 0.6) { this.lastReason = 'radio full, texture'; return 'TEXTURE'; }
    if (occ.bass > 0.7) { this.lastReason = 'radio bass high, countermelody'; return 'COUNTERMELODY'; }
    if (occ.lead > 0.6) { this.lastReason = 'radio lead high, bass support'; return 'BASS'; }
    if (occ.kick > 0.7 && occ.hats > 0.5) { this.lastReason = 'radio rhythm full, melodic response'; return 'RESPONSE'; }
    this.lastReason = 'default lead';
    return 'LEAD';
  }

  // ── Groove (kick + hats) ──
  private generateGroove(notes: ScheduledNote[], ctx: MusicalContextSnapshot, radio: RadioWindowSnapshot, barInPhrase: number): void {
    // Kick: anchor — always present (unless ABSTAIN, handled by caller)
    const kickHits = [0, 4, 8, 12]; // four-on-floor
    for (const s of kickHits) {
      if (this.rng.next() < ctx.density) {
        notes.push({ step: s, voice: 'kick', midi: null, velocity: 0.9 });
      }
    }

    // Hats: complement radio
    const hatHits = radio.currentOccupancy.hats > 0.7 ? [2, 6, 10, 14] : [2, 6, 10, 14, 0, 8];
    for (const s of hatHits) {
      const vel = 0.3 + ctx.tension * 0.3;
      notes.push({ step: s, voice: 'hat', midi: null, velocity: vel });
    }

    // Fill at phrase ending
    if (barInPhrase === 7 && this.rng.next() < 0.5) {
      notes.push({ step: 14, voice: 'hat', midi: null, velocity: 0.6 });
      notes.push({ step: 15, voice: 'hat', midi: null, velocity: 0.7 });
    }
  }

  // ── Bass (anchored to groove + harmony) ──
  private generateBass(notes: ScheduledNote[], ctx: MusicalContextSnapshot, barInPhrase: number): void {
    const octave = 2;
    const root = degreeToMidi(ctx.rootPc, ctx.scale, 0, octave);
    const fifth = degreeToMidi(ctx.rootPc, ctx.scale, 4, octave);
    const third = degreeToMidi(ctx.rootPc, ctx.scale, 2, octave);

    // Bass steps interlock with kick (offbeats)
    const bassSteps = [2, 6, 10, 14];
    for (const step of bassSteps) {
      let midi = root;
      if (barInPhrase === 6 && step === bassSteps[0]) midi = fifth; // cadence: fifth
      else if (barInPhrase === 6 && step === bassSteps[bassSteps.length - 1]) midi = root; // resolve
      else if (barInPhrase >= 3 && barInPhrase <= 5 && this.rng.next() < 0.25) midi = this.rng.next() > 0.5 ? fifth : third;
      notes.push({ step, voice: 'bass', midi, velocity: 0.8 });
    }
  }

  // ── Lead (controlled by motif + harmony + phrase) ──
  private generateLead(notes: ScheduledNote[], ctx: MusicalContextSnapshot, motif: StoredMotif, barInPhrase: number, action: PhraseAction, role: MusicalRole): void {
    const registerShift = role === 'COUNTERMELODY' ? 12 : 0;
    const motifStart = barInPhrase * 16;
    const motifNotes = motif.notes.filter(mn => mn.step >= motifStart && mn.step < motifStart + 16);

    if (motifNotes.length > 0) {
      for (const mn of motifNotes) {
        const localStep = mn.step - motifStart;
        if (this.rng.next() < ctx.density) {
          notes.push({ step: localStep, voice: 'lead', midi: mn.midi + registerShift, velocity: mn.velocity * (0.6 + ctx.tension * 0.4) });
        }
      }
    } else {
      // Fill bars without motif notes
      if (action === 'cadence') {
        const deg = this.rng.pick([0, 4]);
        const midi = degreeToMidi(ctx.rootPc, ctx.scale, deg, 5) + registerShift;
        notes.push({ step: 0, voice: 'lead', midi, velocity: 0.6 });
        notes.push({ step: 8, voice: 'lead', midi, velocity: 0.5 });
      } else if (action === 'response' && motif.notes.length > 0) {
        const midi = motif.notes[0].midi + registerShift;
        notes.push({ step: 0, voice: 'lead', midi, velocity: 0.5 });
        if (this.rng.next() < 0.5) notes.push({ step: 4, voice: 'lead', midi, velocity: 0.4 });
      } else if (action === 'repeat' && motif.notes.length > 0) {
        const echoCount = this.rng.int(1, 2);
        for (let i = 0; i < echoCount; i++) {
          const src = this.rng.pick(motif.notes);
          notes.push({ step: this.rng.pick([0, 4, 8, 12]), voice: 'lead', midi: src.midi + registerShift, velocity: 0.35 });
        }
      } else if ((action === 'develop' || action === 'transform' || action === 'variation') && motif.notes.length > 0) {
        const deg = this.rng.pick([-1, 1, 2, -2]);
        const midi = degreeToMidi(ctx.rootPc, ctx.scale, deg, 5) + registerShift;
        notes.push({ step: 0, voice: 'lead', midi, velocity: 0.45 });
        if (this.rng.next() < 0.5) notes.push({ step: 8, voice: 'lead', midi: degreeToMidi(ctx.rootPc, ctx.scale, 0, 5) + registerShift, velocity: 0.35 });
      }
    }
  }

  // ── Phrase management ──
  private handleNewPhrase(ctx: MusicalContextSnapshot, bar: number): void {
    const groupIdx = PHRASE_STRUCTURE[ctx.phraseIndex % 8];
    if (this.motifGroups[groupIdx].length === 0) {
      const notes = generateMotif(ctx.rootPc, ctx.scale, {
        seed: this.rng.int(1, 100000), steps: 32, density: ctx.density,
        glideProb: 0.3 + ctx.novelty * 0.2, responseShift: this.rng.int(1, 3),
      });
      this.currentMotif = this.memory.createMotif(notes, ctx.rootPc, ctx.scaleName, bar);
      this.motifGroups[groupIdx].push(this.currentMotif);
    } else {
      if (ctx.phraseIndex % 8 === 1 || ctx.phraseIndex % 8 === 4) {
        this.currentMotif = this.memory.transformMotif(this.motifGroups[groupIdx][0], 'transpose', ctx.rootPc, ctx.scale, bar);
        this.motifGroups[groupIdx].push(this.currentMotif);
      } else {
        this.currentMotif = this.motifGroups[groupIdx][0];
      }
    }
  }

  private chooseTransform(): string {
    const r = this.rng.next();
    if (r < 0.3) return 'transpose';
    if (r < 0.55) return 'invert';
    if (r < 0.75) return 'fragment';
    if (r < 0.9) return 'retrograde';
    return 'transpose';
  }

  // ── Style detection ──
  private detectStyle(data: { bpm: number; energy: number; occupancy: { kick: number; bass: number; lead: number; hats: number } }): void {
    const { bpm, occupancy } = data;
    let detected = 'FULL_ON';
    if (occupancy.kick > 0.7 && occupancy.bass > 0.6 && occupancy.hats > 0.5 && bpm > 143) detected = 'FULL_ON';
    else if (occupancy.bass > 0.6 && occupancy.hats < 0.3 && bpm < 142) detected = 'DARK';
    else if (occupancy.kick < 0.6 && occupancy.bass > 0.4 && data.energy < 0.6) detected = 'PROGRESSIVE';
    else if (occupancy.lead > 0.5 && occupancy.hats > 0.5) detected = 'ACID';

    if (detected !== this.style) {
      this.styleConfidence = 0.3;
      this.style = detected;
    } else {
      this.styleConfidence = Math.min(1, this.styleConfidence + 0.05);
    }
  }

  // ── Learning ──
  private evaluatePhrase(bar: number, ctx: MusicalContextSnapshot, role: MusicalRole, action: PhraseAction): void {
    const notes = this.phraseNotes;
    const coherence = notes.filter(n => n.voice === 'lead').length > 0 ? 0.5 : 0.3;
    const densityFit = Math.abs(notes.length / 8 - ctx.density * 10) < 5 ? 0.8 : 0.4;
    const novelty = action === 'develop' || action === 'variation' ? 0.7 : 0.5;
    const reward = coherence * 0.3 + densityFit * 0.25 + 0.25 + novelty * 0.2;

    this.memory.recordPhrase({
      phraseIndex: ctx.phraseIndex, bar: this.phraseStartBar,
      motifId: this.currentMotif?.id ?? 'unknown', transform: action,
      section: ctx.sectionName, tension: ctx.tension, density: ctx.density,
      noteCount: notes.length, restRatio: notes.length < 4 ? 0.125 : 0,
      reward, role,
    });
  }

  // ── Public API ──
  getCurrentPlan(): NotePlan | null { return this.currentPlan; }

  snapshot(): SessionSnapshot | null {
    if (!this.currentPlan) return null;
    const mem = this.memory.snapshot();
    return {
      style: this.style, role: this.currentPlan.role, action: this.currentPlan.action,
      section: this.currentPlan.section, phrase: Math.floor(this.currentPlan.bar / 8),
      bar: this.currentPlan.bar, tension: this.currentPlan.tension,
      density: this.ctx.snapshot(this.currentPlan.bar).density,
      motifCount: mem.mediumTermMotifCount, reason: this.currentPlan.reason,
      hasLearned: this.learned, lastReward: mem.lastReward,
    };
  }

  hasLearned(): boolean { return this.learned; }

  reset(): void {
    this.ctx.reset(); this.window.reset(); this.memory.reset();
    this.currentPlan = null; this.currentMotif = null;
    this.phraseMotifs.clear(); this.motifGroups = [[], [], []];
    this.phraseNotes = []; this.learned = false;
    this.rng = new Rng(43); this.style = 'FULL_ON'; this.styleConfidence = 0;
  }
}
