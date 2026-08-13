/**
 * CandidateGenerator — F19.4-7: Multi-candidate lead generation + scoring.
 *
 * For each phrase, generates N candidate lead phrases from learned grammar,
 * scores them against the musical state, and selects the best.
 *
 * This is where the system stops being a "one shot generator" and becomes
 * an evaluative musical agent.
 */

import { type MelodicGrammar } from './LearnedGrammar';
import { type ContinuousMusicalState } from './ContinuousMusicalState';
import { type Scale, degreeToMidi } from './primitives/scales';
import { Rng } from './primitives/rng';

export interface LeadCandidate {
  notes: Array<{ step: number; midi: number; velocity: number }>;
  contour: number[];        // direction per note
  intervalHistogram: number[]; // 25 values
  avgRegister: number;
  density: number;
  syncopation: number;
  // Scores
  harmonicFit: number;
  bassComplement: number;
  continuity: number;
  novelty: number;
  styleFit: number;
  energyFit: number;
  totalScore: number;
}

export class CandidateGenerator {
  private rng: Rng;

  constructor(seed: number = 42) {
    this.rng = new Rng(seed);
  }

  /**
   * F19.6: Generate N candidate lead phrases from learned grammar.
   * Each candidate differs in controlled ways.
   */
  generateCandidates(
    grammar: MelodicGrammar,
    ctx: { rootPc: number; scale: Scale; section: string; tension: number; energy: number },
    state: ContinuousMusicalState,
    barInPhrase: number,
    density: number,
    count: number = 5,
  ): LeadCandidate[] {
    const candidates: LeadCandidate[] = [];

    for (let i = 0; i < count; i++) {
      // Each candidate gets a different "character" by varying parameters
      const candidateDensity = Math.max(0.1, Math.min(0.9, density + (i - count / 2) * 0.1));
      const registerShift = i < 2 ? -1 : i > count - 2 ? 1 : 0;
      const syncopationBias = (i / count) * 0.3;

      const candidate = this.generateCandidate(grammar, ctx, state, barInPhrase, candidateDensity, registerShift, syncopationBias);
      candidates.push(candidate);
    }

    // Score all candidates
    for (const c of candidates) {
      this.scoreCandidate(c, ctx, state, grammar);
    }

    return candidates;
  }

  private generateCandidate(
    grammar: MelodicGrammar,
    ctx: { rootPc: number; scale: Scale; section: string; tension: number; energy: number },
    state: ContinuousMusicalState,
    barInPhrase: number,
    density: number,
    registerShift: number,
    syncopationBias: number,
  ): LeadCandidate {
    const notes: Array<{ step: number; midi: number; velocity: number }> = [];
    const contour: number[] = [];

    // F19.4: Start from CONTINUOUS state — inherit last MIDI from previous phrase
    const leadOctave = 3 + (grammar.registerPreference > 0.6 ? 1 : 0) + registerShift;
    let currentMidi = state.leadLastMidi > 0
      ? Math.max(48, Math.min(72, state.leadLastMidi + registerShift * 12))
      : degreeToMidi(ctx.rootPc, ctx.scale, 0, leadOctave);

    const intervalHist = grammar.intervalHistogram;

    for (let step = 0; step < 16; step++) {
      const restProb = grammar.restDensity;
      const playProb = density * (1 - restProb);

      // Syncopation bias — some candidates play more offbeats
      const isOffbeat = step % 2 === 1;
      const adjustedProb = isOffbeat ? playProb * (1 + syncopationBias) : playProb;

      if (this.rng.next() < adjustedProb) {
        // Sample interval from learned histogram
        let r = this.rng.next();
        let intervalIdx = 12;
        for (let j = 0; j < intervalHist.length; j++) {
          r -= intervalHist[j];
          if (r <= 0) { intervalIdx = j; break; }
        }
        let interval = intervalIdx - 12;

        // Apply contour preference
        if (this.rng.next() < grammar.ascendingProb && interval < 0) interval = Math.abs(interval);
        if (this.rng.next() < grammar.descendingProb && interval > 0) interval = -interval;
        if (this.rng.next() < grammar.staticProb) interval = 0;

        // F19: Anti-repeat — if last 3 notes were identical, force a change
        const lastNotes = notes.slice(-3);
        if (lastNotes.length >= 3 && lastNotes.every(n => n.midi === currentMidi)) {
          // Force a step in a random direction
          interval = this.rng.next() > 0.5 ? 2 : -2;
        }

        // F19.4: Constrain to complement bass — avoid landing on same MIDI as bass
        const newMidi = currentMidi + interval;
        currentMidi = Math.max(48, Math.min(72, newMidi));

        // F19.2: If too close to bass register, shift up
        if (Math.abs(currentMidi - state.bassLastMidi) < 7 && currentMidi < state.bassLastMidi + 12) {
          currentMidi = Math.min(72, state.bassLastMidi + 12);
        }

        contour.push(interval > 0 ? 1 : interval < 0 ? -1 : 0);
        const isStrongBeat = step % 4 === 0;
        const vel = isStrongBeat ? 0.75 : 0.5;
        notes.push({ step, midi: currentMidi, velocity: vel });
      }
    }

    // Phrase-end cadence
    if (barInPhrase === 7) {
      const rootMidi = degreeToMidi(ctx.rootPc, ctx.scale, 0, leadOctave);
      notes.push({ step: 15, midi: rootMidi, velocity: 0.6 });
    }

    // Compute candidate features
    const avgRegister = notes.length > 0 ? notes.reduce((s, n) => s + n.midi, 0) / notes.length : 60;
    const candidateDensity = notes.length / 16;
    const offbeatNotes = notes.filter(n => n.step % 2 === 1).length;
    const syncopation = notes.length > 0 ? offbeatNotes / notes.length : 0;
    const intervalHistogram = this.computeIntervalHistogram(notes);

    return {
      notes, contour, intervalHistogram,
      avgRegister, density: candidateDensity, syncopation,
      harmonicFit: 0, bassComplement: 0, continuity: 0, novelty: 0,
      styleFit: 0, energyFit: 0, totalScore: 0,
    };
  }

  private computeIntervalHistogram(notes: Array<{ midi: number }>): number[] {
    const hist = new Array(25).fill(0);
    for (let i = 1; i < notes.length; i++) {
      const interval = notes[i].midi - notes[i - 1].midi;
      const idx = Math.max(0, Math.min(24, interval + 12));
      hist[idx]++;
    }
    const sum = hist.reduce((a, b) => a + b, 0);
    if (sum > 0) for (let i = 0; i < 25; i++) hist[i] /= sum;
    return hist;
  }

  /**
   * F19.7: Score a candidate against the current musical state.
   */
  private scoreCandidate(
    c: LeadCandidate,
    ctx: { rootPc: number; scale: Scale; section: string; tension: number; energy: number },
    state: ContinuousMusicalState,
    grammar: MelodicGrammar,
  ): void {
    // HARMONIC FIT — are notes in scale?
    let inScale = 0;
    for (const n of c.notes) {
      const pc = n.midi % 12;
      // Check if pitch class is in the scale's pitch-class set
      const scalePcs = ctx.scale.intervals.map((iv: number) => (ctx.rootPc + iv) % 12);
      if (scalePcs.includes(pc)) inScale++;
    }
    c.harmonicFit = c.notes.length > 0 ? inScale / c.notes.length : 0.5;

    // BASS COMPLEMENT — register separation from bass
    const sep = Math.abs(c.avgRegister - state.bassLastMidi);
    c.bassComplement = Math.min(1, sep / 24);

    // CONTINUITY — relationship to previous phrase's last note
    const firstNoteMidi = c.notes.length > 0 ? c.notes[0].midi : state.leadLastMidi;
    const intervalFromPrev = Math.abs(firstNoteMidi - state.leadLastMidi);
    c.continuity = Math.max(0, 1 - intervalFromPrev / 12);

    // NOVELTY — not too repetitive (compare to grammar's interval histogram)
    let noveltyDiff = 0;
    for (let i = 0; i < 25; i++) {
      noveltyDiff += Math.abs(c.intervalHistogram[i] - grammar.intervalHistogram[i]);
    }
    c.novelty = Math.min(1, noveltyDiff / 2);

    // STYLE FIT — how close to learned interval distribution
    let styleDiff = 0;
    for (let i = 0; i < 25; i++) {
      styleDiff += Math.abs(c.intervalHistogram[i] - grammar.intervalHistogram[i]);
    }
    c.styleFit = Math.max(0, 1 - styleDiff);

    // ENERGY FIT — density matches section energy
    const expectedDensity = ctx.section === 'CLIMAX' ? 0.6 : ctx.section === 'INTRO' ? 0.2 : 0.4;
    c.energyFit = 1 - Math.abs(c.density - expectedDensity);

    // TOTAL SCORE (weighted)
    c.totalScore =
      c.harmonicFit * 0.25 +
      c.bassComplement * 0.15 +
      c.continuity * 0.20 +
      c.novelty * 0.10 +
      c.styleFit * 0.15 +
      c.energyFit * 0.15;
  }

  /** Select the best candidate by total score */
  selectBest(candidates: LeadCandidate[]): LeadCandidate {
    return candidates.reduce((best, c) => c.totalScore > best.totalScore ? c : best, candidates[0]);
  }
}
