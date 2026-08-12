/**
 * StyleGrammar — defines musical behavior per style.
 *
 * F7 RULE 5: Style is not macro knobs — it's a grammar.
 * Each style defines: kick grammar, bass grammar, rhythmic grammar,
 * melodic density, phrase length, motif reuse, transformation policy,
 * register range, tension curve, section behavior, rest policy, call/response.
 */

export type MusicalStyle = 'FULL_ON' | 'DARK' | 'PROGRESSIVE' | 'ACID';

export interface StyleGrammarDef {
  readonly name: MusicalStyle;

  // Rhythmic
  readonly kickPattern: 'four-on-floor' | 'gallop' | 'syncopated';
  readonly bassStyle: 'kb3' | 'four-on-floor' | 'offbeat' | 'syncopated';
  readonly hatDensity: number; // 0-1
  readonly syncopation: number; // 0-1
  readonly swing: number; // 0-1

  // Melodic
  readonly melodicDensity: number; // 0-1
  readonly phraseLength: number; // bars
  readonly motifReusePolicy: 'high' | 'medium' | 'low';
  readonly transformationRate: number; // 0-1
  readonly registerRange: [number, number]; // MIDI range

  // Tension
  readonly tensionCurve: 'flat' | 'build' | 'peak' | 'valley';
  readonly tensionRange: [number, number];

  // Behavior
  readonly restPolicy: number; // 0-1, probability of resting
  readonly callResponseRate: number; // 0-1
  readonly sectionBehavior: 'aggressive' | 'gradual' | 'hypnotic' | 'sparse';

  // Scale preference
  readonly scalePreference: string[];
}

export const STYLE_GRAMMARS: Record<MusicalStyle, StyleGrammarDef> = {
  FULL_ON: {
    name: 'FULL_ON',
    kickPattern: 'four-on-floor',
    bassStyle: 'kb3',
    hatDensity: 0.8,
    syncopation: 0.3,
    swing: 0,
    melodicDensity: 0.7,
    phraseLength: 8,
    motifReusePolicy: 'medium',
    transformationRate: 0.4,
    registerRange: [60, 96],
    tensionCurve: 'peak',
    tensionRange: [0.3, 0.95],
    restPolicy: 0.1,
    callResponseRate: 0.6,
    sectionBehavior: 'aggressive',
    scalePreference: ['phrygian-dominant', 'harmonic-minor', 'minor'],
  },

  DARK: {
    name: 'DARK',
    kickPattern: 'four-on-floor',
    bassStyle: 'kb3',
    hatDensity: 0.4,
    syncopation: 0.2,
    swing: 0,
    melodicDensity: 0.3,
    phraseLength: 8,
    motifReusePolicy: 'high',
    transformationRate: 0.2,
    registerRange: [48, 84],
    tensionCurve: 'build',
    tensionRange: [0.2, 0.7],
    restPolicy: 0.25,
    callResponseRate: 0.3,
    sectionBehavior: 'hypnotic',
    scalePreference: ['phrygian', 'harmonic-minor', 'minor'],
  },

  PROGRESSIVE: {
    name: 'PROGRESSIVE',
    kickPattern: 'four-on-floor',
    bassStyle: 'offbeat',
    hatDensity: 0.5,
    syncopation: 0.4,
    swing: 0.1,
    melodicDensity: 0.5,
    phraseLength: 8,
    motifReusePolicy: 'high',
    transformationRate: 0.3,
    registerRange: [55, 91],
    tensionCurve: 'build',
    tensionRange: [0.2, 0.8],
    restPolicy: 0.15,
    callResponseRate: 0.5,
    sectionBehavior: 'gradual',
    scalePreference: ['minor', 'dorian', 'phrygian-dominant'],
  },

  ACID: {
    name: 'ACID',
    kickPattern: 'four-on-floor',
    bassStyle: 'syncopated',
    hatDensity: 0.6,
    syncopation: 0.6,
    swing: 0.15,
    melodicDensity: 0.6,
    phraseLength: 8,
    motifReusePolicy: 'high',
    transformationRate: 0.5,
    registerRange: [48, 84],
    tensionCurve: 'flat',
    tensionRange: [0.4, 0.8],
    restPolicy: 0.1,
    callResponseRate: 0.4,
    sectionBehavior: 'aggressive',
    scalePreference: ['minor', 'phrygian', 'dorian'],
  },
};

export class StyleController {
  private candidate: MusicalStyle | null = null;
  private locked: MusicalStyle | null = null;
  private confidence: number = 0;
  private candidateSince: number = 0;
  private transitionState: 'STABLE' | 'TRANSITION' | 'LOCKED' | 'UNCERTAIN' = 'UNCERTAIN';

  /**
   * Update style detection from radio observations.
   */
  observe(data: {
    bpm: number;
    energy: number;
    occupancy: { kick: number; bass: number; lead: number; hats: number };
    bar: number;
  }): void {
    // Detect style from BPM + occupancy patterns
    const { bpm, occupancy, energy } = data;

    let detected: MusicalStyle;
    if (occupancy.kick > 0.7 && occupancy.bass > 0.6 && occupancy.hats > 0.5 && bpm > 143) {
      detected = 'FULL_ON';
    } else if (occupancy.bass > 0.6 && occupancy.hats < 0.3 && bpm < 142) {
      detected = 'DARK';
    } else if (occupancy.kick < 0.6 && occupancy.bass > 0.4 && energy < 0.6) {
      detected = 'PROGRESSIVE';
    } else if (occupancy.lead > 0.5 && occupancy.hats > 0.5) {
      detected = 'ACID';
    } else {
      detected = 'FULL_ON'; // default
    }

    if (detected !== this.candidate) {
      this.candidate = detected;
      this.candidateSince = data.bar;
      this.confidence = 0.3;
    } else {
      this.confidence = Math.min(1, this.confidence + 0.05);
    }

    // Lock style after sustained detection
    if (this.confidence > 0.7 && data.bar - this.candidateSince > 4) {
      if (this.locked !== this.candidate) {
        this.locked = this.candidate;
        this.transitionState = 'LOCKED';
      } else {
        this.transitionState = 'STABLE';
      }
    } else if (this.confidence > 0.4) {
      this.transitionState = 'TRANSITION';
    } else {
      this.transitionState = 'UNCERTAIN';
    }
  }

  getStyle(): MusicalStyle {
    return this.locked ?? this.candidate ?? 'FULL_ON';
  }

  getGrammar(): StyleGrammarDef {
    return STYLE_GRAMMARS[this.getStyle()];
  }

  getState(): string {
    return this.transitionState;
  }

  getConfidence(): number {
    return this.confidence;
  }

  reset(): void {
    this.candidate = null;
    this.locked = null;
    this.confidence = 0;
    this.candidateSince = 0;
    this.transitionState = 'UNCERTAIN';
  }
}
