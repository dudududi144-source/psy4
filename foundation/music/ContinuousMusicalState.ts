/**
 * ContinuousMusicalState — F19.1: The single canonical musical state.
 *
 * This state PERSISTS across phrase boundaries, section boundaries, and
 * radio observation updates. It is NOT reset when a new phrase starts.
 *
 * The composer reads this state to generate material that is a CONTINUATION
 * of what came before, not a restart.
 *
 * Hierarchy:
 *   tick (200ms)   → spectral features feed into current context
 *   beat            → kick/bass alignment
 *   bar (16 steps)  → rhythmic grammar
 *   phrase (8 bars) → melody/harmony development, candidate generation
 *   section (8 phr) → energy/arrangement
 *   session         → style/sound knowledge
 */

import { type BassGrammar, type RhythmGrammar, type MelodicGrammar, type TimbreProfile } from './LearnedGrammar';

export interface ContinuousMusicalState {
  // TEMPO (continuous, never reset)
  bpm: number;
  bpmConfidence: number;
  beatPhase: number;       // 0-1 within current beat
  barPhase: number;        // 0-1 within current bar
  phrasePhase: number;     // 0-1 within current phrase
  tempoTrend: number;      // -1 (slowing) to +1 (accelerating)
  tempoStability: number;  // 0-1

  // HARMONY (continuous, hysteresis-controlled)
  rootPc: number;          // 0-11
  scaleName: string;
  harmonicConfidence: number;
  pitchClassDistribution: number[]; // 12 values
  harmonicTension: number;          // 0-1
  resolutionTendency: number;       // 0-1 (high = likely resolving soon)

  // RHYTHM (continuous)
  kickProbability: number[];  // 16 steps, 0-1
  bassRhythmProbability: number[]; // 16 steps
  hatDensity: number;
  syncopation: number;
  swing: number;
  rhythmicEntropy: number;

  // BASS STATE (carried across phrases)
  bassLastDegree: number;      // last scale degree played
  bassLastMidi: number;        // last MIDI note
  bassRegister: number;        // octave
  bassContourMomentum: number; // -1 (descending) to +1 (ascending)
  bassConfidence: number;

  // LEAD STATE (carried across phrases — THIS IS THE KEY FIX)
  leadLastMidi: number;        // last MIDI note played
  leadLastDegree: number;      // last scale degree
  leadRegister: number;        // current octave
  leadContourMomentum: number; // -1 to +1
  leadPhraseRole: 'call' | 'response' | 'development' | 'rest' | 'cadence';
  leadConfidence: number;

  // RELATIONAL STATE (F19.2 — bass↔lead, bass↔kick)
  bassKickAlignment: number;     // 0-1 (how aligned bass is with kick)
  leadBassComplement: number;    // 0-1 (how well lead complements bass)
  leadBassRegisterSeparation: number; // semitones between lead and bass register
  leadBassIntervalRelation: number;  // typical interval between lead and bass

  // ENERGY/ARRANGEMENT (continuous)
  energy: number;
  energyTrend: number;     // -1 to +1
  tension: number;
  density: number;

  // RADIO (continuous)
  radioConfidence: number;
  radioActive: boolean;
  learningConfidence: number;

  // PREDICTION (F19.5)
  predictedNextBarDensity: number;
  predictedNextPhraseRole: 'build' | 'release' | 'continue' | 'transition';
  predictionConfidence: number;

  // LEARNED GRAMMARS (references, not copies)
  hasBassGrammar: boolean;
  hasRhythmGrammar: boolean;
  hasMelodicGrammar: boolean;
  hasTimbreProfile: boolean;
  learnedPhraseCount: number;

  // PHRASE CONTINUITY (F19.3)
  phraseIndex: number;
  previousPhraseRole: string;
  phraseContinuityScore: number; // 0-1 (how related current phrase is to previous)
}

/**
 * StateManager — maintains the ContinuousMusicalState.
 *
 * Updated at three rates:
 * - TICK (200ms): spectral features, energy, radio confidence
 * - BAR: rhythm, bass/lead state, relational features
 * - PHRASE: prediction, candidate generation, reward
 */
export class StateManager {
  private state: ContinuousMusicalState;
  private previousPhraseNotes: { voice: string; midi: number | null; step: number }[] = [];

  constructor() {
    this.state = this.createInitialState();
  }

  private createInitialState(): ContinuousMusicalState {
    return {
      bpm: 145,
      bpmConfidence: 0,
      beatPhase: 0,
      barPhase: 0,
      phrasePhase: 0,
      tempoTrend: 0,
      tempoStability: 0.5,
      rootPc: 9, // A
      scaleName: 'phrygian-dominant',
      harmonicConfidence: 0,
      pitchClassDistribution: new Array(12).fill(0),
      harmonicTension: 0.3,
      resolutionTendency: 0.5,
      kickProbability: new Array(16).fill(0.25),
      bassRhythmProbability: new Array(16).fill(0.25),
      hatDensity: 0.4,
      syncopation: 0.3,
      swing: 0,
      rhythmicEntropy: 0.3,
      bassLastDegree: 0,
      bassLastMidi: 45,
      bassRegister: 2,
      bassContourMomentum: 0,
      bassConfidence: 0,
      leadLastMidi: 57,
      leadLastDegree: 0,
      leadRegister: 3,
      leadContourMomentum: 0,
      leadPhraseRole: 'rest',
      leadConfidence: 0,
      bassKickAlignment: 0.5,
      leadBassComplement: 0.5,
      leadBassRegisterSeparation: 12,
      leadBassIntervalRelation: 7,
      energy: 0.5,
      energyTrend: 0,
      tension: 0.3,
      density: 0.5,
      radioConfidence: 0,
      radioActive: false,
      learningConfidence: 0,
      predictedNextBarDensity: 0.5,
      predictedNextPhraseRole: 'continue',
      predictionConfidence: 0,
      hasBassGrammar: false,
      hasRhythmGrammar: false,
      hasMelodicGrammar: false,
      hasTimbreProfile: false,
      learnedPhraseCount: 0,
      phraseIndex: 0,
      previousPhraseRole: 'rest',
      phraseContinuityScore: 0.5,
    };
  }

  getState(): ContinuousMusicalState { return this.state; }

  /** F19.1: Update from tick-level radio observations (200ms) */
  updateFromTick(data: {
    bpm: number;
    energy: number;
    radioConfidence: number;
    radioActive: boolean;
    pitchClassDistribution?: number[];
    kickProbability?: number[];
    spectralCentroid?: number;
  }): void {
    // Smooth BPM update
    if (data.bpm > 60 && data.bpm < 200) {
      const oldBpm = this.state.bpm;
      this.state.bpm += (data.bpm - this.state.bpm) * 0.05;
      this.state.tempoTrend = (this.state.bpm - oldBpm) * 10;
    }
    this.state.radioConfidence = data.radioConfidence;
    this.state.radioActive = data.radioActive;
    this.state.energy = this.state.energy * 0.9 + data.energy * 0.1;

    if (data.pitchClassDistribution) {
      // Smooth update of pitch-class distribution
      for (let i = 0; i < 12; i++) {
        this.state.pitchClassDistribution[i] =
          this.state.pitchClassDistribution[i] * 0.9 + data.pitchClassDistribution[i] * 0.1;
      }
    }
    if (data.kickProbability) {
      for (let i = 0; i < 16; i++) {
        this.state.kickProbability[i] =
          this.state.kickProbability[i] * 0.9 + data.kickProbability[i] * 0.1;
      }
    }
  }

  /** F19.1: Update from bar-level composition (after planBar) */
  updateFromBar(notes: { voice: string; midi: number | null; step: number }[], bar: number): void {
    // Extract bass state from played notes
    const bassNotes = notes.filter(n => n.voice === 'bass' && n.midi !== null);
    if (bassNotes.length > 0) {
      const lastBass = bassNotes[bassNotes.length - 1];
      this.state.bassLastMidi = lastBass.midi!;
      if (this.previousPhraseNotes.length > 0) {
        const prevBass = this.previousPhraseNotes.filter(n => n.voice === 'bass' && n.midi !== null);
        if (prevBass.length > 0) {
          this.state.bassContourMomentum = Math.sign(lastBass.midi! - prevBass[prevBass.length - 1].midi!);
        }
      }
    }

    // Extract lead state
    const leadNotes = notes.filter(n => n.voice === 'lead' && n.midi !== null);
    if (leadNotes.length > 0) {
      const lastLead = leadNotes[leadNotes.length - 1];
      this.state.leadLastMidi = lastLead.midi!;
      if (leadNotes.length > 1) {
        this.state.leadContourMomentum = Math.sign(leadNotes[leadNotes.length - 1].midi! - leadNotes[leadNotes.length - 2].midi!);
      }
    }

    // F19.2: Relational features — bass↔kick alignment
    const kickSteps = new Set(notes.filter(n => n.voice === 'kick').map(n => n.step));
    const bassSteps = new Set(bassNotes.map(n => n.step));
    const alignedSteps = [...bassSteps].filter(s => kickSteps.has(s)).length;
    this.state.bassKickAlignment = bassSteps.size > 0 ? alignedSteps / bassSteps.size : 0.5;

    // F19.2: Lead↔bass complement (register separation)
    if (bassNotes.length > 0 && leadNotes.length > 0) {
      const avgBassMidi = bassNotes.reduce((s, n) => s + n.midi!, 0) / bassNotes.length;
      const avgLeadMidi = leadNotes.reduce((s, n) => s + n.midi!, 0) / leadNotes.length;
      this.state.leadBassRegisterSeparation = Math.abs(avgLeadMidi - avgBassMidi);
      // Good complement: separation > 12 semitones (octave+)
      this.state.leadBassComplement = Math.min(1, this.state.leadBassRegisterSeparation / 24);
    }
  }

  /** F19.3: Update at phrase boundary — carry forward state */
  updateFromPhrase(phraseIndex: number, phraseNotes: { voice: string; midi: number | null; step: number }[], role: string): void {
    this.previousPhraseNotes = [...phraseNotes];
    this.state.phraseIndex = phraseIndex;
    this.state.previousPhraseRole = role;
    // State is NOT reset — bass/lead/harmony state carries forward
  }

  /** F19.5: Update prediction */
  updatePrediction(predicted: {
    nextBarDensity: number;
    nextPhraseRole: 'build' | 'release' | 'continue' | 'transition';
    confidence: number;
  }): void {
    this.state.predictedNextBarDensity = predicted.nextBarDensity;
    this.state.predictedNextPhraseRole = predicted.nextPhraseRole;
    this.state.predictionConfidence = predicted.confidence;
  }

  /** F19.1: Update learned grammar availability */
  updateLearnedState(grammars: {
    bass: BassGrammar | null;
    rhythm: RhythmGrammar | null;
    melodic: MelodicGrammar | null;
    timbre: TimbreProfile | null;
    phraseCount: number;
  }): void {
    this.state.hasBassGrammar = grammars.bass !== null;
    this.state.hasRhythmGrammar = grammars.rhythm !== null;
    this.state.hasMelodicGrammar = grammars.melodic !== null;
    this.state.hasTimbreProfile = grammars.timbre !== null;
    this.state.learnedPhraseCount = grammars.phraseCount;
    this.state.learningConfidence = Math.min(1, grammars.phraseCount / 8);
  }

  /** F19.2: Get relational context for generators */
  getRelationalContext(): {
    bassLastMidi: number;
    bassRegister: number;
    leadLastMidi: number;
    leadRegister: number;
    bassKickAlignment: number;
    leadBassComplement: number;
    leadBassRegisterSeparation: number;
    leadContourMomentum: number;
    bassContourMomentum: number;
  } {
    return {
      bassLastMidi: this.state.bassLastMidi,
      bassRegister: this.state.bassRegister,
      leadLastMidi: this.state.leadLastMidi,
      leadRegister: this.state.leadRegister,
      bassKickAlignment: this.state.bassKickAlignment,
      leadBassComplement: this.state.leadBassComplement,
      leadBassRegisterSeparation: this.state.leadBassRegisterSeparation,
      leadContourMomentum: this.state.leadContourMomentum,
      bassContourMomentum: this.state.bassContourMomentum,
    };
  }

  reset(): void {
    this.state = this.createInitialState();
    this.previousPhraseNotes = [];
  }
}
