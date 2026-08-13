/**
 * LearnedGrammar — F17.3: Musical grammar learned from radio observations.
 *
 * These grammars are ABSTRACTIONS — they store probability distributions and
 * features, NEVER melodies or note-for-note copies.
 *
 * The grammar is built from PhraseMusicalFeatures and used by the composer
 * to generate NEW material that reflects what was learned.
 */

import { type PhraseMusicalFeatures } from './MusicalObservation';

// ── Bass Grammar ─────────────────────────────────────────────────────────

export interface BassGrammar {
  // Interval transitions: probability of moving from degree X to degree Y
  // 12x12 matrix (pitch class to pitch class), normalized per row
  intervalTransitions: number[][];
  // Rhythmic positions: probability of a bass note at each 16th step
  rhythmPattern: number[]; // 16 values, 0-1
  // Approach tone behavior: how often the bass approaches the root from above/below
  approachFromAbove: number; // 0-1
  approachFromBelow: number; // 0-1
  // Octave behavior: how often bass jumps to octave
  octaveJumpProb: number; // 0-1
  // Syncopation: how often bass plays offbeats vs downbeats
  syncopation: number; // 0-1
  // Confidence (0-1) — how many observations contributed
  confidence: number;
  // Usage count — how many times this grammar was used in composition
  usageCount: number;
  // Reward — accumulated reward from self-evaluation
  reward: number;
}

// ── Rhythm Grammar (kick + hats) ─────────────────────────────────────────

export interface RhythmGrammar {
  // Kick onset pattern: probability of kick at each 16th step
  kickPattern: number[]; // 16 values, 0-1
  // Hat density: average hats per bar
  hatDensity: number; // 0-1
  // Hat syncopation: offbeat ratio
  hatSyncopation: number; // 0-1
  // Ghost note probability
  ghostNoteProb: number; // 0-1
  // Swing: how much odd 16ths are delayed (0 = straight, 1 = full swing)
  swing: number; // 0-1
  // Confidence
  confidence: number;
  usageCount: number;
  reward: number;
}

// ── Melodic Grammar ─────────────────────────────────────────────────────

export interface MelodicGrammar {
  // Interval histogram: probability of each interval (in semitones, -12 to +12)
  intervalHistogram: number[]; // 25 values, normalized
  // Contour preference: ascending vs descending vs static
  ascendingProb: number; // 0-1
  descendingProb: number; // 0-1
  staticProb: number; // 0-1
  // Phrase length preference (in beats)
  preferredPhraseLength: number;
  // Rest density: how often the melody rests
  restDensity: number; // 0-1
  // Register preference: 0 = low, 1 = high
  registerPreference: number; // 0-1
  // Scale degree preference: probability of each scale degree (0-6)
  degreePreference: number[]; // 7 values
  // Confidence
  confidence: number;
  usageCount: number;
  reward: number;
}

// ── Timbre Profile ──────────────────────────────────────────────────────

export interface TimbreProfile {
  // Spectral centroid (brightness): 0 = dark, 1 = bright
  brightness: number; // 0-1
  // Spectral flatness (noisiness): 0 = tonal, 1 = noisy
  noisiness: number; // 0-1
  // Low/mid/high energy ratio
  lowRatio: number; // 0-1
  midRatio: number; // 0-1
  highRatio: number; // 0-1
  // Synthesis parameters derived from timbre
  synthParams: {
    bassWave: OscillatorType;
    bassCut: number; // Hz
    bassSaturation: number; // 0-1
    leadWave: OscillatorType;
    leadCut: number; // Hz
    leadSaturation: number; // 0-1
    hatDecay: number; // seconds
    hatBrightness: number; // Hz (HPF freq)
  };
  confidence: number;
  usageCount: number;
  reward: number;
}

// ── Grammar Builder ─────────────────────────────────────────────────────

/**
 * Builds grammars from accumulated PhraseMusicalFeatures.
 * Each grammar is a statistical model derived from multiple phrase observations.
 */
export class GrammarBuilder {
  private bassObservations: PhraseMusicalFeatures[] = [];
  private rhythmObservations: PhraseMusicalFeatures[] = [];
  private melodicObservations: PhraseMusicalFeatures[] = [];
  private timbreObservations: PhraseMusicalFeatures[] = [];

  private bassGrammar: BassGrammar | null = null;
  private rhythmGrammar: RhythmGrammar | null = null;
  private melodicGrammar: MelodicGrammar | null = null;
  private timbreProfile: TimbreProfile | null = null;

  /** Add a phrase's features to the grammar builder */
  observePhrase(features: PhraseMusicalFeatures): void {
    if (features.overallConfidence < 0.3) return;

    this.bassObservations.push(features);
    this.rhythmObservations.push(features);
    this.melodicObservations.push(features);
    this.timbreObservations.push(features);

    // Keep bounded
    const MAX = 16;
    if (this.bassObservations.length > MAX) this.bassObservations.shift();
    if (this.rhythmObservations.length > MAX) this.rhythmObservations.shift();
    if (this.melodicObservations.length > MAX) this.melodicObservations.shift();
    if (this.timbreObservations.length > MAX) this.timbreObservations.shift();

    // Rebuild grammars
    this.bassGrammar = this.buildBassGrammar();
    this.rhythmGrammar = this.buildRhythmGrammar();
    this.melodicGrammar = this.buildMelodicGrammar();
    this.timbreProfile = this.buildTimbreProfile();
  }

  getBassGrammar(): BassGrammar | null { return this.bassGrammar; }
  getRhythmGrammar(): RhythmGrammar | null { return this.rhythmGrammar; }
  getMelodicGrammar(): MelodicGrammar | null { return this.melodicGrammar; }
  getTimbreProfile(): TimbreProfile | null { return this.timbreProfile; }

  hasLearned(): boolean {
    return this.bassGrammar !== null && this.bassGrammar.confidence > 0.25;
  }

  getLearnedCount(): number {
    return this.bassObservations.length;
  }

  private buildBassGrammar(): BassGrammar | null {
    if (this.bassObservations.length < 2) return null;
    const obs = this.bassObservations;

    // Build interval transitions from pitch-class histogram
    // We don't have note sequences, but we have the dominant pitch class
    // and bass interval movement. Use this to build a simplified transition model.
    const transitions: number[][] = [];
    for (let i = 0; i < 12; i++) {
      transitions.push(new Array(12).fill(0));
    }

    // Aggregate pitch-class histograms
    const avgPcHist = new Array(12).fill(0);
    for (const f of obs) {
      for (let i = 0; i < 12; i++) avgPcHist[i] += f.pitchClassHistogram[i];
    }
    const total = avgPcHist.reduce((a, b) => a + b, 0);
    if (total > 0) for (let i = 0; i < 12; i++) avgPcHist[i] /= total;

    // Build transitions: from dominant PC, prefer movement to other observed PCs
    const dominant = avgPcHist.indexOf(Math.max(...avgPcHist));
    for (let from = 0; from < 12; from++) {
      const fromWeight = avgPcHist[from];
      if (fromWeight < 0.01) continue;
      for (let to = 0; to < 12; to++) {
        // Prefer movement to strongly-observed PCs, with decay by distance
        const distance = Math.min(Math.abs(to - from), 12 - Math.abs(to - from));
        const distanceWeight = Math.max(0, 1 - distance / 7);
        transitions[from][to] = avgPcHist[to] * distanceWeight;
      }
      // Normalize row
      const rowSum = transitions[from].reduce((a, b) => a + b, 0);
      if (rowSum > 0) for (let to = 0; to < 12; to++) transitions[from][to] /= rowSum;
    }

    // Rhythm pattern from kick onset pattern (bass often follows kick)
    const rhythmPattern = new Array(16).fill(0);
    for (const f of obs) {
      for (let i = 0; i < 16; i++) rhythmPattern[i] += f.kickOnsetPattern[i];
    }
    for (let i = 0; i < 16; i++) rhythmPattern[i] /= obs.length;

    // Approach tones — derived from bass interval movement
    const avgMovement = obs.reduce((s, f) => s + f.bassIntervalMovement, 0) / obs.length;
    const approachFromAbove = avgMovement * 0.6;
    const approachFromBelow = avgMovement * 0.4;

    // Octave jump — higher when bass movement is high
    const octaveJumpProb = Math.min(0.3, avgMovement * 0.3);

    // Syncopation
    const syncopation = obs.reduce((s, f) => s + f.syncopation, 0) / obs.length;

    const confidence = Math.min(1, obs.length / 8);

    return {
      intervalTransitions: transitions,
      rhythmPattern,
      approachFromAbove, approachFromBelow,
      octaveJumpProb, syncopation,
      confidence, usageCount: 0, reward: 0.5,
    };
  }

  private buildRhythmGrammar(): RhythmGrammar | null {
    if (this.rhythmObservations.length < 2) return null;
    const obs = this.rhythmObservations;

    const kickPattern = new Array(16).fill(0);
    for (const f of obs) {
      for (let i = 0; i < 16; i++) kickPattern[i] += f.kickOnsetPattern[i];
    }
    for (let i = 0; i < 16; i++) kickPattern[i] /= obs.length;

    const hatDensity = obs.reduce((s, f) => s + f.avgHatDensity, 0) / obs.length;
    const hatSyncopation = obs.reduce((s, f) => s + f.syncopation, 0) / obs.length;
    const ghostNoteProb = Math.min(0.4, hatDensity * 0.3);
    const swing = 0; // F17: swing not yet extracted from radio
    const confidence = Math.min(1, obs.length / 6);

    return {
      kickPattern, hatDensity, hatSyncopation, ghostNoteProb, swing,
      confidence, usageCount: 0, reward: 0.5,
    };
  }

  private buildMelodicGrammar(): MelodicGrammar | null {
    if (this.melodicObservations.length < 2) return null;
    const obs = this.melodicObservations;

    // Interval histogram — derived from melodic contour direction changes
    const intervalHistogram = new Array(25).fill(0); // -12 to +12 semitones
    // Center = index 12 (0 semitones = repeat)
    intervalHistogram[12] = 0.3; // repeats common
    // Small intervals more common than large
    for (let i = 1; i <= 7; i++) {
      intervalHistogram[12 + i] = (8 - i) / 20; // ascending
      intervalHistogram[12 - i] = (8 - i) / 20; // descending
    }
    // Normalize
    const sum = intervalHistogram.reduce((a, b) => a + b, 0);
    if (sum > 0) for (let i = 0; i < 25; i++) intervalHistogram[i] /= sum;

    // Contour preference
    const avgContourChanges = obs.reduce((s, f) => s + f.melodicContour.length, 0) / obs.length;
    const ascendingProb = Math.min(0.4, avgContourChanges * 0.02);
    const descendingProb = Math.min(0.4, avgContourChanges * 0.02);
    const staticProb = Math.max(0.2, 1 - ascendingProb - descendingProb);

    // Phrase length
    const preferredPhraseLength = Math.round(obs.reduce((s, f) => s + f.phraseLength, 0) / obs.length);

    // Rest density — from melodic activity (inverse)
    const avgActivity = obs.reduce((s, f) => s + f.melodicActivity, 0) / obs.length;
    const restDensity = Math.max(0, Math.min(0.6, 1 - avgActivity));

    // Register
    const registerPreference = obs.reduce((s, f) => s + f.melodicRegister, 0) / obs.length;

    // Scale degree preference — from pitch class histogram
    const avgPcHist = new Array(12).fill(0);
    for (const f of obs) for (let i = 0; i < 12; i++) avgPcHist[i] += f.pitchClassHistogram[i];
    const total = avgPcHist.reduce((a, b) => a + b, 0);
    if (total > 0) for (let i = 0; i < 12; i++) avgPcHist[i] /= total;
    // Map to 7 scale degrees (diatonic)
    const degreePreference = [0.3, 0.1, 0.15, 0.1, 0.15, 0.1, 0.1]; // root dominant
    const dominant = avgPcHist.indexOf(Math.max(...avgPcHist));
    degreePreference[0] = Math.max(0.3, avgPcHist[dominant] || 0.3);

    const confidence = Math.min(1, obs.length / 8);

    return {
      intervalHistogram, ascendingProb, descendingProb, staticProb,
      preferredPhraseLength, restDensity, registerPreference, degreePreference,
      confidence, usageCount: 0, reward: 0.5,
    };
  }

  private buildTimbreProfile(): TimbreProfile | null {
    if (this.timbreObservations.length < 2) return null;
    const obs = this.timbreObservations;

    const brightness = obs.reduce((s, f) => s + f.brightness, 0) / obs.length;
    const noisiness = obs.reduce((s, f) => s + f.noisiness, 0) / obs.length;
    const lowRatio = obs.reduce((s, f) => s + f.lowMidRatio, 0) / obs.length;
    const midRatio = 1 - lowRatio * 0.5;
    const highRatio = obs.reduce((s, f) => s + 1 / (1 + f.midHighRatio), 0) / obs.length;

    // Map timbre to synthesis parameters
    const bassWave: OscillatorType = brightness < 0.3 ? 'sine' : brightness < 0.6 ? 'sawtooth' : 'square';
    const bassCut = 300 + brightness * 600;
    const bassSaturation = Math.min(1, noisiness * 1.5 + 0.3);
    const leadWave: OscillatorType = brightness < 0.4 ? 'triangle' : brightness < 0.7 ? 'sawtooth' : 'square';
    const leadCut = 1500 + brightness * 2000;
    const leadSaturation = Math.min(1, noisiness + 0.2);
    const hatDecay = 0.04 + noisiness * 0.08;
    const hatBrightness = 6000 + brightness * 4000;

    const confidence = Math.min(1, obs.length / 6);

    return {
      brightness, noisiness, lowRatio, midRatio, highRatio,
      synthParams: {
        bassWave, bassCut, bassSaturation,
        leadWave, leadCut, leadSaturation,
        hatDecay, hatBrightness,
      },
      confidence, usageCount: 0, reward: 0.5,
    };
  }

  reset(): void {
    this.bassObservations = [];
    this.rhythmObservations = [];
    this.melodicObservations = [];
    this.timbreObservations = [];
    this.bassGrammar = null;
    this.rhythmGrammar = null;
    this.melodicGrammar = null;
    this.timbreProfile = null;
  }
}
