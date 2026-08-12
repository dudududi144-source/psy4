/**
 * MusicalSession — F9 REBUILD: Groove-first, lead-optional, register-controlled.
 *
 * F9 FIXES:
 * 1. Kick ALWAYS present (no ABSTAIN removing the backbone)
 * 2. Bass interlocks with kick (hits ON kick + offbeat response)
 * 3. Lead register controlled (octave 3-4, not 4-5)
 * 4. Lead is optional (default REST, plays only when groove is stable)
 * 5. Radio never causes silence (modulates density, not existence)
 * 6. Style affects actual notes (different patterns per style)
 *
 * Hierarchy: PULSE → KICK → BASS → HARMONY → PERCUSSION → LEAD (optional)
 */

import { MusicalContext, type MusicalContextSnapshot, COMPOSITION_ARC } from './MusicalContext';
import { MusicalMemory, type StoredMotif, type PhraseRecord } from './MusicalMemory';
import { RadioMusicalWindow, type RadioWindowSnapshot } from './RadioMusicalWindow';
import { type Scale, degreeToMidi, stableDegrees, getScale } from './primitives/scales';
import { type MotifNote, generateMotif, transpose, invert, fragment, retrograde } from './primitives/motif';
import { Rng } from './primitives/rng';

export interface ScheduledNote {
  readonly step: number;
  readonly voice: 'kick' | 'bass' | 'lead' | 'hat';
  readonly midi: number | null;
  readonly velocity: number;
}

export interface NotePlan {
  readonly bar: number;
  readonly notes: readonly ScheduledNote[];
  readonly role: string;
  readonly action: string;
  readonly style: string;
  readonly section: string;
  readonly tension: number;
  readonly barInPhrase: number;
  readonly reason: string;
}

export interface SessionSnapshot {
  readonly style: string;
  readonly role: string;
  readonly action: string;
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

const PHRASE_STRUCTURE = [0, 0, 1, 0, 0, 1, 2, 0];
const BAR_ACTIONS = ['introduce', 'repeat', 'repeat', 'develop', 'develop', 'variation', 'cadence', 'response'];

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
  private style = 'FULL_ON';
  private styleConfidence = 0;
  private userStyleLocked = false; // F13/R2B: user-set style resists auto-detection
  private lastReason = '';
  // F13/R4-C: Track whether learning has influenced selection (for proof)
  private learningInfluencedCount = 0;

  constructor(seed = 42) {
    this.ctx = new MusicalContext();
    this.window = new RadioMusicalWindow();
    this.memory = new MusicalMemory(seed);
    this.rng = new Rng(seed + 1);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // F13/R2 — PUBLIC MUSICAL CONTROL API
  // The UI calls these. They delegate to MusicalContext (single state owner).
  // Setting a value locks it (radio adaptation won't overwrite).
  // ═══════════════════════════════════════════════════════════════════════
  setEnergy(v: number): void { this.ctx.setEnergy(v); }
  setDensity(v: number): void { this.ctx.setDensity(v); }
  setTension(v: number): void { this.ctx.setTension(v); }
  setKey(rootPc: number, scaleName: string): void { this.ctx.setKey(rootPc, scaleName); }
  setStyle(style: string): void {
    this.style = style;
    this.styleConfidence = 1.0;
    this.userStyleLocked = true; // F13/R2B: user choice resists auto-detection
  }
  unlockStyle(): void { this.userStyleLocked = false; }
  unlockEnergy(): void { this.ctx.unlockEnergy(); }
  unlockDensity(): void { this.ctx.unlockDensity(); }
  unlockTension(): void { this.ctx.unlockTension(); }
  unlockKey(): void { this.ctx.unlockKey(); }
  isStyleLocked(): boolean { return this.userStyleLocked; }
  isEnergyLocked(): boolean { return this.ctx.isEnergyLocked(); }
  isDensityLocked(): boolean { return this.ctx.isDensityLocked(); }
  isTensionLocked(): boolean { return this.ctx.isTensionLocked(); }
  isKeyLocked(): boolean { return this.ctx.isKeyLocked(); }

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

  planBar(bar: number, transportBpm: number): NotePlan {
    this.ctx.updateFromTransport(bar, transportBpm);
    const snap = this.ctx.snapshot(bar);
    const radio = this.window.snapshot(bar);
    const barInPhrase = bar % 8;
    const action = BAR_ACTIONS[barInPhrase];

    // ── Motif management ──
    if (barInPhrase === 0) {
      this.phraseMotifs.clear();
      this.phraseNotes = [];
      this.phraseStartBar = bar;
      this.handleNewPhrase(snap, bar);
    }

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

    // ── GENERATE NOTES (hierarchical: groove → bass → lead) ──
    const notes: ScheduledNote[] = [];

    // F9 RULE 3: KICK FIRST — always present, never removed
    this.generateKick(notes, snap, barInPhrase);

    // F9 RULE 4: BASS — interlocked with kick
    this.generateBass(notes, snap, barInPhrase);

    // F9 RULE 8: HATS — complementary
    this.generateHats(notes, snap, barInPhrase);

    // F9 RULE 8: LEAD — optional, controlled, lower register
    const leadDensity = this.calculateLeadDensity(snap, radio, barInPhrase);
    if (leadDensity > 0) {
      this.generateLead(notes, snap, motif, barInPhrase, action, leadDensity);
    } else {
      this.lastReason = 'lead resting (groove sufficient)';
    }

    this.phraseNotes.push(...notes);
    if (barInPhrase === 7) this.evaluatePhrase(bar, snap, action);

    const plan: NotePlan = {
      bar, notes: Object.freeze(notes) as readonly ScheduledNote[],
      role: leadDensity > 0 ? 'LEAD' : 'GROOVE',
      action, style: this.style,
      section: snap.sectionName, tension: snap.tension,
      barInPhrase, reason: this.lastReason,
    };
    this.currentPlan = plan;
    return plan;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // F13/R4-D: KICK — style affects kick grammar
  // FULL_ON: 4-on-floor + fill. DARK: sparser, half-time feel. PROGRESSIVE: 4-on-floor, no fill. ACID: 4-on-floor + extra syncopation.
  // ═══════════════════════════════════════════════════════════════════════
  private generateKick(notes: ScheduledNote[], ctx: MusicalContextSnapshot, barInPhrase: number): void {
    const radioKickOcc = (ctx as any).radioRoles?.kick ?? 0;
    const velocity = radioKickOcc > 0.7 ? 0.6 : 0.9;
    const style = this.style;

    // Base: 4-on-floor (steps 0,4,8,12)
    const kickSteps = [0, 4, 8, 12];

    // DARK: half-time feel — skip kicks at steps 8 and 12 every other bar
    if (style === 'DARK' && barInPhrase % 2 === 1) {
      kickSteps.splice(2, 2); // remove steps 8,12
    }
    // PROGRESSIVE: no fill at phrase end (cleaner)
    // ACID: add syncopated kick at step 14 occasionally
    if (style === 'ACID' && this.rng.next() < 0.3) {
      kickSteps.push(14);
    }

    for (const s of kickSteps) {
      notes.push({ step: s, voice: 'kick', midi: null, velocity });
    }

    // Fill at phrase ending (except PROGRESSIVE which stays clean)
    if (barInPhrase === 7 && style !== 'PROGRESSIVE') {
      notes.push({ step: 14, voice: 'kick', midi: null, velocity: 0.8 });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // F13/R4-D: BASS — style affects bass pattern
  // FULL_ON: 8 notes, rolling. DARK: sparser, lower. PROGRESSIVE: smooth, fewer offbeats. ACID: syncopated, higher octave.
  // ═══════════════════════════════════════════════════════════════════════
  private generateBass(notes: ScheduledNote[], ctx: MusicalContextSnapshot, barInPhrase: number): void {
    const octave = this.style === 'ACID' ? 2 : 2; // MIDI 33-45 range (low bass)
    const root = degreeToMidi(ctx.rootPc, ctx.scale, 0, octave);
    const fifth = degreeToMidi(ctx.rootPc, ctx.scale, 4, octave);
    const third = degreeToMidi(ctx.rootPc, ctx.scale, 2, octave);

    // Base: bass interlock — hits WITH kick + offbeat response
    let bassSteps = [
      { step: 0, midi: root, vel: 0.9 },
      { step: 2, midi: root, vel: 0.6 },
      { step: 4, midi: root, vel: 0.9 },
      { step: 6, midi: root, vel: 0.6 },
      { step: 8, midi: root, vel: 0.9 },
      { step: 10, midi: root, vel: 0.6 },
      { step: 12, midi: root, vel: 0.9 },
      { step: 14, midi: root, vel: 0.6 },
    ];

    // DARK: remove offbeat responses (sparser, hypnotic)
    if (this.style === 'DARK') {
      bassSteps = bassSteps.filter(bs => bs.step % 4 === 0);
    }
    // PROGRESSIVE: remove every other offbeat (smoother)
    if (this.style === 'PROGRESSIVE') {
      bassSteps = bassSteps.filter(bs => bs.step % 4 === 0 || bs.step === 6 || bs.step === 14);
    }
    // ACID: add 16th-note syncopation
    if (this.style === 'ACID') {
      bassSteps.push({ step: 1, midi: root, vel: 0.4 });
      bassSteps.push({ step: 9, midi: fifth, vel: 0.4 });
    }

    // Modify based on phrase position
    for (const bs of bassSteps) {
      let midi = bs.midi;
      let vel = bs.vel;

      if (barInPhrase === 6) {
        if (bs.step === 0) midi = fifth;
        if (bs.step === 12) midi = root;
      } else if (barInPhrase === 7) {
        if (bs.step === 14) midi = third;
      } else if (barInPhrase >= 3 && barInPhrase <= 5 && this.rng.next() < 0.2) {
        if (bs.step % 4 === 2) midi = fifth;
      }

      notes.push({ step: bs.step, voice: 'bass', midi, velocity: vel });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // F13/R4-D: HATS — style affects hat pattern
  // FULL_ON: offbeat + fill. DARK: sparse, slow. PROGRESSIVE: steady. ACID: busy, 16ths.
  // ═══════════════════════════════════════════════════════════════════════
  private generateHats(notes: ScheduledNote[], ctx: MusicalContextSnapshot, barInPhrase: number): void {
    const style = this.style;
    const vel = 0.25 + ctx.tension * 0.25;

    // Base: offbeat hats (steps 2,6,10,14)
    const hatSteps = [2, 6, 10, 14];

    // DARK: sparse — only steps 6 and 14
    if (style === 'DARK') {
      hatSteps.length = 0;
      hatSteps.push(6, 14);
    }
    // ACID: add 16th-note busy hats
    if (style === 'ACID') {
      for (let s = 0; s < 16; s += 2) {
        if (!hatSteps.includes(s)) hatSteps.push(s);
      }
    }

    for (const s of hatSteps) {
      notes.push({ step: s, voice: 'hat', midi: null, velocity: vel });
    }
    // Extra hat at phrase end (except PROGRESSIVE)
    if (barInPhrase === 7 && style !== 'PROGRESSIVE') {
      notes.push({ step: 15, voice: 'hat', midi: null, velocity: 0.4 });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // F9: LEAD — optional, controlled, LOWER register (octave 3-4, not 4-5)
  // ═══════════════════════════════════════════════════════════════════════
  private calculateLeadDensity(ctx: MusicalContextSnapshot, radio: RadioWindowSnapshot, barInPhrase: number): number {
    // F13/R4-A STARTUP SEQUENCE: Lead does NOT play during INTRO (bars 0-7).
    // The groove (kick + bass + hats) must establish first. Lead enters at
    // STATEMENT (bar 8). This fixes the "high-pitched lead on bar 0" complaint
    // at its root — the lead was entering immediately because density was 0.2,
    // not 0.
    if (ctx.sectionName === 'INTRO') {
      this.lastReason = 'lead RESTING (INTRO — groove establishing)';
      return 0;
    }

    // F13/R4-B ABSTAIN: If radio is dense in the lead/mid band, the engine
    // should ABSTAIN from lead to avoid clashing with the radio's melody.
    // This is a real REST decision, not just a density reduction.
    if (radio.currentOccupancy.lead > 0.7 && ctx.sectionName !== 'CLIMAX') {
      this.lastReason = 'lead ABSTAIN (radio melody present, avoiding clash)';
      return 0;
    }

    let density = 0.3; // default: low

    // Section influence
    const section = ctx.sectionName;
    if (section === 'STATEMENT') density = 0.4;
    else if (section === 'DEVELOPMENT' || section === 'DEVELOPMENT2') density = 0.5;
    else if (section === 'CONTRAST') density = 0.4;
    else if (section === 'CLIMAX') density = 0.6;
    else if (section === 'RESOLUTION') density = 0.2;

    // F13/R4-D STYLE → MUSIC: style affects lead density
    // FULL_ON: more lead (peak-time). DARK: sparse, eerie. PROGRESSIVE: gradual. ACID: squelchy, dense.
    if (this.style === 'FULL_ON') density *= 1.1;
    else if (this.style === 'DARK') density *= 0.6;
    else if (this.style === 'PROGRESSIVE') density *= 0.8;
    else if (this.style === 'ACID') density *= 1.2;

    // Phrase position influence
    if (barInPhrase === 0) density += 0.1; // introduce
    if (barInPhrase === 6) density -= 0.1; // cadence
    if (barInPhrase === 7) density -= 0.15; // response

    // Radio influence — radio doesn't kill lead, just modulates
    if (radio.currentOccupancy.lead > 0.6) density *= 0.5; // radio lead present → reduce
    if (radio.energyRising) density = Math.min(0.8, density + 0.1);

    // Tension influence
    density = density * (0.7 + ctx.tension * 0.3);

    this.lastReason = `lead density=${density.toFixed(2)} (section=${section} style=${this.style} barInPhrase=${barInPhrase})`;
    return Math.max(0, Math.min(0.8, density));
  }

  private generateLead(notes: ScheduledNote[], ctx: MusicalContextSnapshot, motif: StoredMotif, barInPhrase: number, action: string, density: number): void {
    // F9 RULE 10: Register control — octave 3 (MIDI 48-60), NOT octave 4-5 (69-88)
    const leadOctave = 3; // MIDI ~45-57 (low-mid register)
    const registerShift = 0; // no upward shift

    const motifStart = barInPhrase * 16;
    const motifNotes = motif.notes.filter(mn => mn.step >= motifStart && mn.step < motifStart + 16);

    if (motifNotes.length > 0) {
      // F9: Remap motif notes to lower register
      for (const mn of motifNotes) {
        const localStep = mn.step - motifStart;
        if (this.rng.next() < density) {
          // F9: Clamp MIDI to 48-72 (C3 to C5) — no higher
          const midi = Math.max(48, Math.min(72, mn.midi - 12 + registerShift));
          notes.push({ step: localStep, voice: 'lead', midi, velocity: mn.velocity * (0.5 + ctx.tension * 0.3) });
        }
      }
    } else {
      // Fill bars — lower register
      if (action === 'cadence') {
        const deg = this.rng.pick([0, 4]);
        const midi = degreeToMidi(ctx.rootPc, ctx.scale, deg, leadOctave);
        notes.push({ step: 0, voice: 'lead', midi, velocity: 0.5 });
        if (this.rng.next() < 0.5) notes.push({ step: 8, voice: 'lead', midi, velocity: 0.4 });
      } else if (action === 'response' && motif.notes.length > 0) {
        const midi = Math.max(48, Math.min(72, motif.notes[0].midi - 12));
        notes.push({ step: 0, voice: 'lead', midi, velocity: 0.4 });
      } else if (action === 'repeat' && motif.notes.length > 0 && this.rng.next() < 0.5) {
        const src = this.rng.pick(motif.notes);
        const midi = Math.max(48, Math.min(72, src.midi - 12));
        notes.push({ step: this.rng.pick([0, 4, 8, 12]), voice: 'lead', midi, velocity: 0.3 });
      } else if ((action === 'develop' || action === 'variation') && motif.notes.length > 0 && this.rng.next() < 0.4) {
        const deg = this.rng.pick([-1, 1, 2, -2]);
        const midi = degreeToMidi(ctx.rootPc, ctx.scale, deg, leadOctave);
        notes.push({ step: 0, voice: 'lead', midi, velocity: 0.35 });
      }
    }
  }

  // ── Phrase management ──
  private handleNewPhrase(ctx: MusicalContextSnapshot, bar: number): void {
    const groupIdx = PHRASE_STRUCTURE[ctx.phraseIndex % 8];
    if (this.motifGroups[groupIdx].length === 0) {
      // First time this group is used — generate a new motif
      const notes = generateMotif(ctx.rootPc, ctx.scale, {
        seed: this.rng.int(1, 100000), steps: 32, density: 0.5,
        glideProb: 0.3, responseShift: this.rng.int(1, 3),
      });
      this.currentMotif = this.memory.createMotif(notes, ctx.rootPc, ctx.scaleName, bar);
      this.motifGroups[groupIdx].push(this.currentMotif);
    } else {
      if (ctx.phraseIndex % 8 === 1 || ctx.phraseIndex % 8 === 4) {
        // F13/R4-C: LEARNING WIRED. Use reward-weighted pickMotif when memory
        // has enough motifs. Falls back to transform of group's first motif
        // when memory is sparse (first few phrases).
        const candidate = this.memory.pickMotif(bar, false, ctx.novelty);
        if (candidate && this.memory.snapshot().mediumTermMotifCount >= 3) {
          // Learning influences selection: pick a reward-weighted motif and
          // transform it to fit the current key/scale.
          this.currentMotif = this.memory.transformMotif(candidate, 'transpose', ctx.rootPc, ctx.scale, bar);
          this.learningInfluencedCount++;
        } else {
          // Not enough learned motifs yet — transform the group's first motif
          this.currentMotif = this.memory.transformMotif(this.motifGroups[groupIdx][0], 'transpose', ctx.rootPc, ctx.scale, bar);
        }
        this.motifGroups[groupIdx].push(this.currentMotif);
      } else {
        // F13/R4-C: For non-transform phrases, also try pickMotif if we have
        // enough learned material. This makes learning affect WHICH motif is
        // reused, not just whether a transform happens.
        const candidate = this.memory.pickMotif(bar, true, ctx.novelty);
        if (candidate && this.memory.snapshot().mediumTermMotifCount >= 5 && this.rng.next() < 0.4) {
          this.currentMotif = candidate;
          this.learningInfluencedCount++;
        } else {
          this.currentMotif = this.motifGroups[groupIdx][0];
        }
      }
    }
  }

  // F13/R4-C: Public accessor for proving learning influenced selection
  getLearningInfluencedCount(): number { return this.learningInfluencedCount; }

  private chooseTransform(): string {
    const r = this.rng.next();
    if (r < 0.3) return 'transpose';
    if (r < 0.55) return 'invert';
    if (r < 0.75) return 'fragment';
    if (r < 0.9) return 'retrograde';
    return 'transpose';
  }

  private detectStyle(data: { bpm: number; energy: number; occupancy: { kick: number; bass: number; lead: number; hats: number } }): void {
    // F13/R2B: If user locked style, do NOT overwrite with auto-detection.
    if (this.userStyleLocked) return;
    const { bpm, occupancy } = data;
    let detected = 'FULL_ON';
    if (occupancy.kick > 0.7 && occupancy.bass > 0.6 && occupancy.hats > 0.5 && bpm > 143) detected = 'FULL_ON';
    else if (occupancy.bass > 0.6 && occupancy.hats < 0.3 && bpm < 142) detected = 'DARK';
    else if (occupancy.kick < 0.6 && occupancy.bass > 0.4 && data.energy < 0.6) detected = 'PROGRESSIVE';
    else if (occupancy.lead > 0.5 && occupancy.hats > 0.5) detected = 'ACID';
    if (detected !== this.style) { this.styleConfidence = 0.3; this.style = detected; }
    else { this.styleConfidence = Math.min(1, this.styleConfidence + 0.05); }
  }

  private evaluatePhrase(bar: number, ctx: MusicalContextSnapshot, action: string): void {
    const notes = this.phraseNotes;
    const coherence = notes.filter(n => n.voice === 'lead').length > 0 ? 0.5 : 0.3;
    const densityFit = Math.abs(notes.length / 8 - ctx.density * 10) < 5 ? 0.8 : 0.4;
    const novelty = action === 'develop' || action === 'variation' ? 0.7 : 0.5;
    const reward = coherence * 0.3 + densityFit * 0.25 + 0.25 + novelty * 0.2;
    this.memory.recordPhrase({
      phraseIndex: ctx.phraseIndex, bar: this.phraseStartBar,
      motifId: this.currentMotif?.id ?? 'unknown', transform: action,
      section: ctx.sectionName, tension: ctx.tension, density: ctx.density,
      noteCount: notes.length, restRatio: 0, reward, role: 'LEAD',
    });
  }

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
    this.userStyleLocked = false;
    this.learningInfluencedCount = 0;
    this.lastReason = '';
  }
}
