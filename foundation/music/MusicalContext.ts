/**
 * MusicalContext — live model of the musical state.
 *
 * F5 RULE 3: Holds the current musical reality inferred from radio observations.
 * This is NOT the Transport (which owns time). This is the MUSICAL state:
 * key, scale, energy, density, tension, phrase position.
 *
 * Updated by the LiveComposer from RadioObservationLayer output.
 * Read by the CompositionPlanner to decide what to play.
 */

import { type Scale, getScale, scalePcs, stableDegrees } from './primitives/scales';

export interface MusicalContextSnapshot {
  // Tonal
  readonly rootPc: number;          // 0-11 (pitch class of tonic)
  readonly scaleName: string;
  readonly scale: Scale;
  readonly scalePcs: number[];      // pitch classes in the scale
  readonly stableDegreesList: number[]; // stable scale degrees

  // Rhythmic
  readonly bpm: number;
  readonly density: number;         // 0-1 (how busy the music should be)
  readonly syncopation: number;     // 0-1 (how syncopated)
  readonly energy: number;          // 0-1
  readonly energySlope: number;     // -1 to 1 (rising/falling)

  // Structural
  readonly bar: number;             // current bar (from Transport)
  readonly phraseIndex: number;     // which 8-bar phrase we're in
  readonly sectionIndex: number;    // which section of the 64-bar arc
  readonly sectionName: string;     // 'INTRO' | 'STATEMENT' | etc.

  // Tension/Novelty
  readonly tension: number;         // 0-1 (current musical tension)
  readonly targetTension: number;   // 0-1 (where tension should go)
  readonly novelty: number;         // 0-1 (how much variation to introduce)

  // Confidence
  readonly confidence: number;      // 0-1 (how confident we are in the context)
  readonly source: 'radio' | 'internal' | 'preset';

  // F6: Radio occupancy (for role selection)
  readonly radioRoles: { kick: number; bass: number; lead: number; hats: number };
}

// 64-bar composition arc (RULE 7)
export interface SectionArc {
  readonly startBar: number;
  readonly endBar: number;
  readonly name: string;
  readonly tension: number;      // target tension for this section
  readonly novelty: number;      // target novelty for this section
  readonly density: number;      // target density for this section
}

export const COMPOSITION_ARC: SectionArc[] = [
  { startBar: 0,  endBar: 8,  name: 'INTRO',       tension: 0.2, novelty: 0.3, density: 0.4 },
  { startBar: 8,  endBar: 16, name: 'STATEMENT',   tension: 0.4, novelty: 0.5, density: 0.6 },
  { startBar: 16, endBar: 24, name: 'DEVELOPMENT', tension: 0.6, novelty: 0.7, density: 0.7 },
  { startBar: 24, endBar: 32, name: 'RESPONSE',    tension: 0.5, novelty: 0.5, density: 0.6 },
  { startBar: 32, endBar: 40, name: 'CONTRAST',    tension: 0.7, novelty: 0.8, density: 0.8 },
  { startBar: 40, endBar: 48, name: 'DEVELOPMENT2',tension: 0.8, novelty: 0.7, density: 0.8 },
  { startBar: 48, endBar: 56, name: 'CLIMAX',      tension: 0.95, novelty: 0.6, density: 0.9 },
  { startBar: 56, endBar: 64, name: 'RESOLUTION',  tension: 0.3, novelty: 0.4, density: 0.5 },
];

export class MusicalContext {
  private rootPc: number = 9; // A
  private scaleName: string = 'phrygian-dominant';
  private bpm: number = 145;
  private density: number = 0.6;
  private syncopation: number = 0.2;
  private energy: number = 0.5;
  private energySlope: number = 0;
  private tension: number = 0.3;
  private targetTension: number = 0.3;
  private novelty: number = 0.4;
  private confidence: number = 0.3;
  private source: 'radio' | 'internal' | 'preset' = 'preset';

  // F6: Radio occupancy for role selection
  private radioRoles = { kick: 0, bass: 0, lead: 0, hats: 0 };

  // Energy history for slope detection
  private energyHistory: number[] = [];

  // F13/R2B: User locks — when true, updateFromRadio skips the property.
  // User-set values must survive radio adaptation.
  private userLocked = {
    style: false,
    energy: false,
    density: false,
    tension: false,
    key: false,
  };

  // F18: Key change hysteresis — requires consistent observations before changing
  private keyChangeVotes: number[] = [];

  /**
   * F13/R2 — Public musical control API.
   * These are the ONLY way the UI should set musical direction.
   * Setting a value locks it (radio adaptation won't overwrite).
   */
  setEnergy(v: number): void {
    this.energy = Math.max(0, Math.min(1, v));
    this.userLocked.energy = true;
  }
  setDensity(v: number): void {
    this.density = Math.max(0, Math.min(1, v));
    this.userLocked.density = true;
  }
  setTension(v: number): void {
    this.tension = Math.max(0, Math.min(1, v));
    this.targetTension = this.tension; // F13: user tension overrides arc target
    this.userLocked.tension = true;
  }
  setKey(rootPc: number, scaleName: string): void {
    this.rootPc = ((Math.round(rootPc) % 12) + 12) % 12;
    this.scaleName = scaleName;
    this.userLocked.key = true;
  }
  unlockEnergy(): void { this.userLocked.energy = false; }
  unlockDensity(): void { this.userLocked.density = false; }
  unlockTension(): void { this.userLocked.tension = false; }
  unlockKey(): void { this.userLocked.key = false; }
  isEnergyLocked(): boolean { return this.userLocked.energy; }
  isDensityLocked(): boolean { return this.userLocked.density; }
  isTensionLocked(): boolean { return this.userLocked.tension; }
  isKeyLocked(): boolean { return this.userLocked.key; }

  /**
   * Update from radio observation data.
   * Called by LiveComposer when radio observations arrive.
   * F13/R2B: Respects user locks — does NOT overwrite locked properties.
   */
  updateFromRadio(data: {
    bpm: number;
    energy: number;
    occupancy: { kick: number; bass: number; lead: number; hats: number };
    bassFreq?: number;
    confidence: number;
  }): void {
    // BPM — smooth update (BPM is never user-locked; Transport owns it)
    if (data.bpm > 60 && data.bpm < 200) {
      this.bpm += (data.bpm - this.bpm) * 0.1;
    }

    // Energy tracking (radio-derived) — skip if user locked
    if (!this.userLocked.energy) {
      this.energyHistory.push(data.energy);
      if (this.energyHistory.length > 16) this.energyHistory.shift();

      if (this.energyHistory.length >= 4) {
        const recent = this.energyHistory.slice(-4).reduce((a, b) => a + b, 0) / 4;
        const older = this.energyHistory.slice(-8, -4).reduce((a, b) => a + b, 0) / Math.min(4, this.energyHistory.length - 4);
        this.energy = recent;
        this.energySlope = recent - older;
      }
    }

    // Density from energy — skip if user locked
    if (!this.userLocked.density) {
      this.density = 0.3 + this.energy * 0.5;
    }

    // F6: Save radio occupancy for role selection
    this.radioRoles = { ...data.occupancy };

    // Syncopation from occupancy patterns
    if (data.occupancy.hats > 0.5 && data.occupancy.kick > 0.5) {
      this.syncopation = 0.5 + Math.random() * 0.2;
    } else {
      this.syncopation = 0.2;
    }

    // F18: Key/scale inference with HYSTERESIS — requires multiple consistent
    // observations before changing key. This prevents the "key jitter" that
    // causes the composition to feel unstable.
    if (!this.userLocked.key && data.bassFreq && data.bassFreq > 50) {
      const midi = Math.round(69 + 12 * Math.log2(data.bassFreq / 440));
      const newRootPc = ((midi % 12) + 12) % 12;

      // F18: Track pitch-class observations for hysteresis
      if (newRootPc !== this.rootPc) {
        this.keyChangeVotes.push(newRootPc);
        if (this.keyChangeVotes.length > 8) this.keyChangeVotes.shift();

        // Only change key if 6+ of the last 8 votes agree on the new key
        const votes = this.keyChangeVotes.filter(v => v === newRootPc).length;
        if (votes >= 6) {
          this.rootPc = newRootPc;
          this.scaleName = 'phrygian-dominant';
          this.keyChangeVotes = []; // reset after change
        }
      } else {
        // Same key — clear votes
        this.keyChangeVotes = [];
      }
    }

    this.confidence = Math.min(1, this.confidence * 0.9 + data.confidence * 0.1);
    this.source = 'radio';
  }

  /**
   * Update from Transport snapshot (bar, phrase, section).
   * Called by LiveComposer every scheduler tick.
   */
  updateFromTransport(bar: number, bpm: number): void {
    // Update section from composition arc
    const sectionIdx = Math.floor((bar % 64) / 8);
    const section = COMPOSITION_ARC[sectionIdx];
    if (section) {
      // F13/R2B: Only set arc targetTension if user hasn't locked tension
      if (!this.userLocked.tension) {
        this.targetTension = section.tension;
      }
      this.novelty = section.novelty;
    }

    // Smooth tension toward target — skip if user locked
    if (!this.userLocked.tension) {
      this.tension += (this.targetTension - this.tension) * 0.05;
    }

    // BPM from Transport (authoritative)
    if (bpm > 60 && bpm < 200) {
      this.bpm = bpm;
    }
  }

  /**
   * Set to internal/preset mode (no radio).
   */
  setInternal(bpm: number, rootPc: number, scaleName: string): void {
    this.bpm = bpm;
    this.rootPc = rootPc;
    this.scaleName = scaleName;
    this.source = 'preset';
    this.confidence = 0.2;
  }

  snapshot(bar: number): MusicalContextSnapshot {
    const scale = getScale(this.scaleName) ?? getScale('phrygian-dominant')!;
    const pcs = scalePcs(this.rootPc, scale);
    const sd = stableDegrees(scale);
    const phraseIndex = Math.floor(bar / 8);
    const sectionIdx = Math.floor((bar % 64) / 8);
    const section = COMPOSITION_ARC[sectionIdx];

    return Object.freeze({
      rootPc: this.rootPc,
      scaleName: this.scaleName,
      scale,
      scalePcs: pcs,
      stableDegreesList: sd,
      bpm: this.bpm,
      density: this.density,
      syncopation: this.syncopation,
      energy: this.energy,
      energySlope: this.energySlope,
      bar,
      phraseIndex,
      sectionIndex: sectionIdx,
      sectionName: section?.name ?? 'UNKNOWN',
      tension: this.tension,
      targetTension: this.targetTension,
      novelty: this.novelty,
      confidence: this.confidence,
      source: this.source,
      radioRoles: { ...this.radioRoles },
    }) as MusicalContextSnapshot;
  }

  reset(): void {
    this.rootPc = 9;
    this.scaleName = 'phrygian-dominant';
    this.bpm = 145;
    this.density = 0.6;
    this.energy = 0.5;
    this.energySlope = 0;
    this.tension = 0.3;
    this.targetTension = 0.3;
    this.novelty = 0.4;
    this.confidence = 0.2;
    this.source = 'preset';
    this.energyHistory = [];
    this.keyChangeVotes = [];
    this.userLocked = { style: false, energy: false, density: false, tension: false, key: false };
  }
}
