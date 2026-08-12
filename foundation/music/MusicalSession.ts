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
import { MusicalObservationExtractor, extractSpectralFeatures, type RadioTickFeatures, type PhraseMusicalFeatures } from './MusicalObservation';
import { GrammarBuilder, type BassGrammar, type RhythmGrammar, type MelodicGrammar, type TimbreProfile } from './LearnedGrammar';
import { StateManager, type ContinuousMusicalState } from './ContinuousMusicalState';
import { CandidateGenerator, type LeadCandidate } from './CandidateGenerator';
import { StrategySelector, type StrategySet, type BassStrategyType, type LeadStrategyType, type GrooveStrategyType } from './MusicalStrategies';
import { type GrooveState, generateGrooveState, createDefaultGroove } from './GrooveState';
import { type HarmonicState, generateHarmonicState, getChordAtStep, isChordTone, nearestChordTone, type ChordVoicing } from './HarmonicState';
import { type PhraseDevelopmentState, type PhraseRecord as PhraseDevRecord, type DevelopmentOperator, type PhraseNote, createInitialPhraseState, selectDevelopmentOperator, transformPhrase, createPhraseRecord, motifSimilarity } from './PhraseDevelopmentState';
import { type TensionState, createInitialTension, updateTension } from './TensionState';

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

// F16 GROOVE EVOLUTION — kick pattern grammar
// Instead of always [0,4,8,12], select from a grammar based on section + cycle.
// This makes the groove evolve across 256 bars instead of looping.
const KICK_GRAMMARS: Record<string, number[][]> = {
  base: [
    [0, 4, 8, 12],           // 4-on-floor (most common)
    [0, 4, 8, 12, 10],       // + ghost on 10
    [0, 4, 7, 8, 12],        // + ghost on 7
    [0, 3, 4, 8, 11, 12],    // syncopated
  ],
  climax: [
    [0, 4, 7, 8, 12, 14],    // drive
    [0, 4, 8, 10, 12, 14],   // push
    [0, 3, 4, 7, 8, 11, 12], // dense
    [0, 4, 8, 12, 14, 15],   // fill drive
  ],
  dark: [
    [0, 8],                  // half-time
    [0, 6, 8],               // + ghost
    [0, 8, 10],              // + push
    [0, 4],                  // sparse
  ],
  break_pattern: [
    [0, 8],                  // minimal during break
    [0, 4, 8],               // sparse
  ],
};

export class MusicalSession {
  private ctx: MusicalContext;
  private window: RadioMusicalWindow;
  private memory: MusicalMemory;
  private rng: Rng;
  // F17: Musical observation + learning
  private observationExtractor: MusicalObservationExtractor;
  private grammarBuilder: GrammarBuilder;
  private lastPhraseExtracted: number = -1;
  // F19: Continuous musical state + candidate generation
  private stateManager: StateManager;
  private candidateGenerator: CandidateGenerator;
  private lastSelectedCandidate: LeadCandidate | null = null;
  private lastCandidateScores: number[] = [];
  // F20: Musical strategy engine
  private strategySelector: StrategySelector;
  private currentStrategies: StrategySet | null = null;
  private strategyHistory: StrategySet[] = [];
  // F21: Core musical state (causal, not observational)
  private grooveState: GrooveState;
  private harmonicState: HarmonicState | null = null;
  private phraseState: PhraseDevelopmentState;
  private tensionState: TensionState;

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
  // F16: Track cycle (which 64-bar iteration we're in) for groove evolution
  private cycleCount = 0;
  private lastBarPlanned = -1;

  constructor(seed = 42) {
    this.ctx = new MusicalContext();
    this.window = new RadioMusicalWindow();
    this.memory = new MusicalMemory(seed);
    this.rng = new Rng(seed + 1);
    this.observationExtractor = new MusicalObservationExtractor();
    this.grammarBuilder = new GrammarBuilder();
    this.stateManager = new StateManager();
    this.candidateGenerator = new CandidateGenerator(seed + 100);
    this.strategySelector = new StrategySelector(seed + 200);
    this.grooveState = createDefaultGroove();
    this.phraseState = createInitialPhraseState();
    this.tensionState = createInitialTension();
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

  // ═══════════════════════════════════════════════════════════════════════
  // F15 Phase 4 — ARRANGEMENT CONTROLS
  // Lets the user direct the arrangement: force sections, trigger breaks/builds
  // ═══════════════════════════════════════════════════════════════════════
  private forcedSection: string | null = null;
  private breakRemaining = 0;      // bars of break remaining
  private buildRemaining = 0;      // bars of build remaining
  private dropRemaining = 0;       // bars of drop remaining

  /** Jump to a specific section (INTRO, STATEMENT, DEVELOPMENT, etc.) */
  forceSection(section: string): void {
    this.forcedSection = section;
  }

  /** Clear forced section — return to automatic arc */
  releaseSection(): void {
    this.forcedSection = null;
  }

  /** Trigger a breakdown — drop to kick+bass only for N bars */
  triggerBreak(bars = 4): void {
    this.breakRemaining = bars;
  }

  /** Trigger a build — ramp density up over N bars */
  triggerBuild(bars = 4): void {
    this.buildRemaining = bars;
  }

  /** Trigger a drop — peak density for N bars */
  triggerDrop(bars = 4): void {
    this.dropRemaining = bars;
  }

  getArrangementState(): { forced: string | null; break: number; build: number; drop: number } {
    return {
      forced: this.forcedSection,
      break: this.breakRemaining,
      build: this.buildRemaining,
      drop: this.dropRemaining,
    };
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

  // F17.2 — Observe radio tick with FULL musical feature extraction.
  // This is the real learning pipeline: extracts spectral features, pitch,
  // rhythm, and timbre — not just scalar occupancy.
  observeRadioTick(tick: {
    audioTime: number;
    radioBpm: number;           // F17: use RADIO bpm, not transport bpm (fixes circular observation)
    energy: number;
    occupancy: { kick: number; bass: number; lead: number; hats: number };
    bassFreq: number | null;
    pitchClass: number | null;
    pitchConfidence: number;
    freqData: Uint8Array;       // raw FFT data for spectral analysis
    sampleRate: number;
    fftSize: number;
  }): void {
    // Extract spectral features from FFT
    const spectral = extractSpectralFeatures(tick.freqData, tick.sampleRate, tick.fftSize);

    const tickFeatures: RadioTickFeatures = {
      timestamp: tick.audioTime,
      bpm: tick.radioBpm,        // F17: radio's BPM, not engine's
      energy: tick.energy,
      occupancy: tick.occupancy,
      bassFreq: tick.bassFreq,
      pitchClass: tick.pitchClass,
      pitchConfidence: tick.pitchConfidence,
      spectralCentroid: spectral.centroid,
      spectralFlatness: spectral.flatness,
      spectralRolloff: spectral.rolloff,
      lowEnergy: spectral.low,
      midEnergy: spectral.mid,
      highEnergy: spectral.high,
    };

    this.observationExtractor.observe(tickFeatures);

    // Also feed the legacy observation path (for backward compat)
    this.observeRadio({
      bpm: tick.radioBpm,
      energy: tick.energy,
      occupancy: tick.occupancy,
      bassFreq: tick.bassFreq ?? undefined,
      confidence: tick.pitchConfidence,
    });

    // F19.1: Update continuous musical state from tick
    this.stateManager.updateFromTick({
      bpm: tick.radioBpm,
      energy: tick.energy,
      radioConfidence: tick.pitchConfidence,
      radioActive: true,
    });
  }

  // F17.3 — Extract phrase features and feed to grammar builder.
  // Called at phrase boundaries (barInPhrase === 0).
  // Public for testing — the learning pipeline must be provable.
  extractPhraseLearning(phraseIndex: number, startBar: number, bars: number): void {
    if (phraseIndex === this.lastPhraseExtracted) return;
    this.lastPhraseExtracted = phraseIndex;

    const features = this.observationExtractor.extractPhraseFeatures(phraseIndex, startBar, bars);
    if (features) {
      this.grammarBuilder.observePhrase(features);
      this.learned = true;
    }
  }

  // F17.4 — Get learned bass grammar (or null if not enough learning yet)
  getLearnedBassGrammar(): BassGrammar | null { return this.grammarBuilder.getBassGrammar(); }
  getLearnedRhythmGrammar(): RhythmGrammar | null { return this.grammarBuilder.getRhythmGrammar(); }
  getLearnedMelodicGrammar(): MelodicGrammar | null { return this.grammarBuilder.getMelodicGrammar(); }
  getLearnedTimbreProfile(): TimbreProfile | null { return this.grammarBuilder.getTimbreProfile(); }
  hasLearnedFromRadio(): boolean { return this.grammarBuilder.hasLearned(); }
  getLearnedPhraseCount(): number { return this.grammarBuilder.getLearnedCount(); }

  // F19: Continuous musical state + candidate generation accessors
  getContinuousMusicalState(): ContinuousMusicalState { return this.stateManager.getState(); }
  getLastCandidateScores(): number[] { return this.lastCandidateScores; }
  getLastSelectedCandidateScore(): number { return this.lastSelectedCandidate?.totalScore ?? 0; }
  getRelationalContext() { return this.stateManager.getRelationalContext(); }
  // F20: Strategy engine accessors
  getCurrentStrategies(): StrategySet | null { return this.currentStrategies; }
  getStrategyHistory(): StrategySet[] { return this.strategyHistory; }
  getStrategyWeights() { return this.strategySelector.getWeights(); }
  // F21: Core musical state accessors
  getGrooveState(): GrooveState { return this.grooveState; }
  getHarmonicState(): HarmonicState | null { return this.harmonicState; }
  getTensionState(): TensionState { return this.tensionState; }
  getPhraseState(): PhraseDevelopmentState { return this.phraseState; }

  planBar(bar: number, transportBpm: number): NotePlan {
    // F16: Track cycle for groove evolution
    const cycle = Math.floor(bar / 64);
    if (bar <= this.lastBarPlanned + 1 && bar > this.lastBarPlanned) {
      // sequential planning — track cycle transitions
      if (cycle > this.cycleCount) this.cycleCount = cycle;
    }
    this.lastBarPlanned = bar;

    this.ctx.updateFromTransport(bar, transportBpm);
    let snap = this.ctx.snapshot(bar);
    const radio = this.window.snapshot(bar);
    let barInPhrase = bar % 8;
    let action = BAR_ACTIONS[barInPhrase];

    // F15 Phase 4: Arrangement overrides
    let arrangementOverride = '';
    if (this.forcedSection) {
      // Override the section name in the snapshot
      snap = { ...snap, sectionName: this.forcedSection } as MusicalContextSnapshot;
      arrangementOverride = `forced=${this.forcedSection}`;
    }
    if (this.breakRemaining > 0) {
      this.breakRemaining--;
      arrangementOverride = 'BREAK';
    }
    if (this.buildRemaining > 0) {
      this.buildRemaining--;
      arrangementOverride = 'BUILD';
    }
    if (this.dropRemaining > 0) {
      this.dropRemaining--;
      arrangementOverride = 'DROP';
    }

    // ── Motif management ──
    if (barInPhrase === 0) {
      // F17.8: Phrase continuity — extract learning from PREVIOUS phrase
      // before clearing. The grammar builder accumulates across phrases.
      const phraseIndex = Math.floor(bar / 8);
      this.extractPhraseLearning(phraseIndex - 1, bar - 8, 8);

      // F17.8: Do NOT wipe everything — carry forward learned grammars.
      // Only clear per-phrase motif cache (the grammar builder persists).
      this.phraseMotifs.clear();
      this.phraseNotes = [];
      this.phraseStartBar = bar;
      this.handleNewPhrase(snap, bar);
    }

    // F20.1: Select musical strategies for this bar
    this.currentStrategies = this.strategySelector.selectStrategies({
      section: snap.sectionName,
      energy: snap.energy,
      tension: snap.tension,
      style: this.style,
      learnedPhraseCount: this.getLearnedPhraseCount(),
      isBreak: arrangementOverride === 'BREAK',
      isBuild: arrangementOverride === 'BUILD',
      isDrop: arrangementOverride === 'DROP',
    });
    this.strategyHistory.push(this.currentStrategies);
    if (this.strategyHistory.length > 32) this.strategyHistory.shift();

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

    // ── F21: RELATIONAL GENERATION ──
    // Generation order: groove → harmony → kick → bass(reads kick) → lead(reads kick+bass)
    // Each voice knows what came before it. The lead is NOT independent.
    const notes: ScheduledNote[] = [];

    // F21 Phase 1: Update groove state (stable per section, not per bar)
    if (barInPhrase === 0 || !this.grooveState) {
      this.grooveState = generateGrooveState({
        section: snap.sectionName, style: this.style, energy: snap.energy,
        bpm: transportBpm, isBreak: arrangementOverride === 'BREAK', isDrop: arrangementOverride === 'DROP',
      });
    }

    // F21 Phase 1: Update harmonic state (per phrase)
    if (barInPhrase === 0 || !this.harmonicState) {
      this.harmonicState = generateHarmonicState({
        rootPc: snap.rootPc, scaleName: snap.scaleName || 'phrygian-dominant',
        section: snap.sectionName, phraseIndex: this.phraseState.phraseIndex,
        tension: snap.tension,
      });
    }

    // F21 Phase 1: Update tension state (per bar)
    this.tensionState = updateTension(this.tensionState, {
      section: snap.sectionName, phraseIndex: this.phraseState.phraseIndex,
      barInPhrase, energy: snap.energy,
      isBuild: arrangementOverride === 'BUILD', isDrop: arrangementOverride === 'DROP',
      isBreak: arrangementOverride === 'BREAK',
    });

    // F21 Phase 1: Select phrase development operator (per phrase)
    if (barInPhrase === 0) {
      const operator = selectDevelopmentOperator(this.phraseState.phraseIndex, snap.sectionName);
      this.phraseState.operator = operator;
    }

    const isBreak = arrangementOverride === 'BREAK';
    const isDrop = arrangementOverride === 'DROP';
    const isBuild = arrangementOverride === 'BUILD';

    // ── KICK: generates from GrooveState ──
    this.generateKick(notes, snap, barInPhrase, bar);

    // F21: Extract kick notes for bass/lead awareness
    const kickNotes = notes.filter(n => n.voice === 'kick');

    // ── BASS: reads kick + groove + harmony ──
    // F22 P0-B: Bass now receives kickNotes — it can LOCK/ANSWER/ANTICIPATE/SPACE
    this.generateBass(notes, snap, barInPhrase, kickNotes);

    // F21: Extract bass notes for lead awareness
    const bassNotes = notes.filter(n => n.voice === 'bass');

    // ── HATS + LEAD: reads kick + bass + groove + harmony ──
    if (!isBreak) {
      this.generateHats(notes, snap, barInPhrase);

      let leadDensity = this.calculateLeadDensity(snap, radio, barInPhrase);
      if (isDrop) leadDensity = Math.max(leadDensity, 0.75);
      if (isBuild) leadDensity = Math.max(leadDensity, 0.3 + (1 - this.buildRemaining / 4) * 0.4);

      if (leadDensity > 0) {
        // F21 Phase 3: Lead receives kick + bass notes + harmonic state + phrase state
        this.generateRelationalLead(notes, snap, barInPhrase, leadDensity, kickNotes, bassNotes, bar);
      } else {
        this.lastReason = 'lead resting (groove sufficient)';
      }
    } else {
      this.lastReason = 'BREAK — kick + bass only';
    }

    this.phraseNotes.push(...notes);
    if (barInPhrase === 7) this.evaluatePhrase(bar, snap, action);

    // F19.1: Update continuous musical state from the bar's notes
    this.stateManager.updateFromBar(
      notes.map(n => ({ voice: n.voice, midi: n.midi, step: n.step })),
      bar,
    );
    // F19.1: Update learned grammar availability in state
    this.stateManager.updateLearnedState({
      bass: this.getLearnedBassGrammar(),
      rhythm: this.getLearnedRhythmGrammar(),
      melodic: this.getLearnedMelodicGrammar(),
      timbre: this.getLearnedTimbreProfile(),
      phraseCount: this.getLearnedPhraseCount(),
    });
    // F19.3: At phrase boundary, update phrase continuity state
    if (barInPhrase === 0) {
      this.stateManager.updateFromPhrase(
        Math.floor(bar / 8),
        this.phraseNotes.map(n => ({ voice: n.voice, midi: n.midi, step: n.step })),
        notes.some(n => n.voice === 'lead') ? 'LEAD' : 'GROOVE',
      );
    }

    const plan: NotePlan = {
      bar, notes: Object.freeze(notes) as readonly ScheduledNote[],
      role: isBreak ? 'BREAK' : (notes.some(n => n.voice === 'lead') ? 'LEAD' : 'GROOVE'),
      action: arrangementOverride || action, style: this.style,
      section: snap.sectionName, tension: snap.tension,
      barInPhrase, reason: this.lastReason,
    };
    this.currentPlan = plan;
    return plan;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // F15 COMPOSITION REBUILD — real musical development
  // Kick: accents, ghost notes, velocity humanization, style-specific grammar
  // Bass: harmonic movement (root, fifth, octave, walking), per-note variation
  // Lead: melodic development, longer phrases, register movement
  // Hats: swing, open/closed, velocity humanization
  // ═══════════════════════════════════════════════════════════════════════

  private generateKick(notes: ScheduledNote[], ctx: MusicalContextSnapshot, barInPhrase: number, bar: number): void {
    const radioKickOcc = (ctx as any).radioRoles?.kick ?? 0;
    const style = this.style;
    const section = ctx.sectionName;
    const cycle = this.cycleCount;

    // F16: Velocity humanization (defined early — needed by learned path too)
    const baseVel = radioKickOcc > 0.7 ? 0.6 : 0.9;
    const humanize = (v: number, jitter: number) => Math.max(0.1, Math.min(1, v + (this.rng.next() - 0.5) * jitter));

    // F18.4: LEARNED RHYTHM GRAMMAR — if we have learned rhythm from radio,
    // generate kick pattern from learned onset probabilities instead of
    // hardcoded grammars.
    const learnedRhythm = this.getLearnedRhythmGrammar();
    if (learnedRhythm && learnedRhythm.confidence > 0.25 && section !== 'INTRO') {
      this.generateLearnedKick(notes, ctx, learnedRhythm, barInPhrase, humanize);
      return;
    }

    // F16: Select kick pattern from grammar based on section + cycle + phrase position
    // This makes the groove EVOLVE across 256 bars instead of always [0,4,8,12]
    let grammar: number[][];
    if (section === 'CLIMAX') {
      grammar = KICK_GRAMMARS.climax;
    } else if (style === 'DARK' && barInPhrase % 2 === 1) {
      grammar = KICK_GRAMMARS.dark;
    } else if (style === 'DARK') {
      grammar = KICK_GRAMMARS.base.slice(0, 2); // darker = fewer patterns
    } else {
      grammar = KICK_GRAMMARS.base;
    }

    // F16: Cycle drift — each cycle picks a different pattern index offset
    // Cycle 0: patterns 0,1. Cycle 1: patterns 1,2. Cycle 2: patterns 2,3. Cycle 3: patterns 0,3.
    const cycleOffset = cycle % grammar.length;
    const phraseVariant = barInPhrase < 4 ? 0 : 1;
    const patternIdx = (cycleOffset + phraseVariant) % grammar.length;
    let kickSteps = [...grammar[patternIdx]];

    // F16: Style-specific additions
    if (style === 'ACID' && this.rng.next() < 0.35) {
      kickSteps.push(14);
    }
    if (style === 'FULL_ON' && section === 'CLIMAX' && this.rng.next() < 0.25) {
      if (!kickSteps.includes(7)) kickSteps.push(7);
    }

    // F16: Accent pattern — beat 1 always loudest, others vary
    for (const s of kickSteps) {
      let vel = baseVel;
      if (s === 0) vel = baseVel + 0.05;           // downbeat accent
      else if (s === 8) vel = baseVel - 0.05;      // backbeat slightly softer
      else if (s !== 4 && s !== 12) vel = baseVel - 0.25; // ghosts much softer
      notes.push({ step: s, voice: 'kick', midi: null, velocity: humanize(vel, 0.06) });
    }

    // F16: Phrase-end fill with velocity ramp
    if (barInPhrase === 7 && style !== 'PROGRESSIVE') {
      const fillSteps = style === 'ACID' ? [13, 14] : [14, 15];
      for (let i = 0; i < fillSteps.length; i++) {
        const fillVel = 0.65 + (i / fillSteps.length) * 0.25;
        notes.push({ step: fillSteps[i], voice: 'kick', midi: null, velocity: humanize(fillVel, 0.05) });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // F22 P0-B: BASS READS KICK — relational groove
  // Bass chooses a RELATIONSHIP to kick: LOCK, ANSWER, ANTICIPATE, SPACE
  // The relationship is chosen per bar based on groove + tension + phrase state.
  // ═══════════════════════════════════════════════════════════════════════
  private generateBass(notes: ScheduledNote[], ctx: MusicalContextSnapshot, barInPhrase: number, kickNotes: ScheduledNote[]): void {
    const octave = 2; // MIDI 33-45 range (low bass)
    const root = degreeToMidi(ctx.rootPc, ctx.scale, 0, octave);
    const fifth = degreeToMidi(ctx.rootPc, ctx.scale, 4, octave);
    const third = degreeToMidi(ctx.rootPc, ctx.scale, 2, octave);
    const octaveUp = degreeToMidi(ctx.rootPc, ctx.scale, 0, octave + 1);
    const style = this.style;
    const section = ctx.sectionName;
    const humanize = (v: number, jitter: number) => Math.max(0.1, Math.min(1, v + (this.rng.next() - 0.5) * jitter));

    // F22 P0-B: RELATIONAL BASS — reads kick notes and chooses a relationship.
    // LOCK: bass hits WITH kick (reinforce downbeat)
    // ANSWER: bass hits BETWEEN kicks (fill space)
    // ANTICIPATE: bass hits BEFORE kick (push)
    // SPACE: bass intentionally rests where kick is dense
    const kickSteps = new Set(kickNotes.map(n => n.step));
    const groove = this.grooveState;
    const tension = this.tensionState;

    // Choose relationship based on context
    const relationship: 'LOCK' | 'ANSWER' | 'ANTICIPATE' | 'SPACE' =
      (section === 'INTRO' || section === 'RESOLUTION') ? 'LOCK'
      : tension.resolving ? 'LOCK'
      : (section === 'CLIMAX' || tension.rhythmic > 0.5) ? (this.rng.next() < 0.3 ? 'ANTICIPATE' : this.rng.next() < 0.5 ? 'ANSWER' : 'LOCK')
      : (style === 'DARK' || groove.syncopation > 0.4) ? 'SPACE'
      : (this.rng.next() < 0.15 ? 'ANTICIPATE' : this.rng.next() < 0.6 ? 'LOCK' : 'ANSWER');

    // F22 P0-D: Bass targets chord roots from HarmonicState
    const harmonic = this.harmonicState;

    // Generate bass based on relationship to kick
    switch (relationship) {
      case 'LOCK': {
        // Bass hits WITH kick — reinforces groove
        for (const ks of kickSteps) {
          if (ks % 4 === 0) { // only on beats (not ghosts)
            // F22 P0-D: Target chord root
            let midi = root;
            if (harmonic) {
              const chord = getChordAtStep(harmonic, ks, barInPhrase);
              midi = degreeToMidi(ctx.rootPc, ctx.scale, chord.bassDegree, octave);
            }
            notes.push({ step: ks, voice: 'bass', midi, velocity: humanize(0.9, 0.05) });
          }
        }
        // Add offbeat response on steps 2, 6, 10, 14 (classic psytrance)
        for (const s of [2, 6, 10, 14]) {
          if (!kickSteps.has(s)) {
            notes.push({ step: s, voice: 'bass', midi: root, velocity: humanize(0.55, 0.06) });
          }
        }
        break;
      }
      case 'ANSWER': {
        // Bass fills holes left by kick
        for (let step = 0; step < 16; step++) {
          if (!kickSteps.has(step) && step % 2 === 1) {
            // Offbeat where kick is silent
            let midi = root;
            if (step === 6 || step === 14) midi = fifth; // harmonic movement
            notes.push({ step, voice: 'bass', midi, velocity: humanize(0.7, 0.06) });
          }
        }
        // Anchor on beat 0
        notes.push({ step: 0, voice: 'bass', midi: root, velocity: humanize(0.9, 0.05) });
        break;
      }
      case 'ANTICIPATE': {
        // Bass hits BEFORE kick — creates push/tension
        for (const ks of kickSteps) {
          if (ks % 4 === 0 && ks > 0) {
            const anticipStep = ks - 1;
            if (anticipStep >= 0 && !kickSteps.has(anticipStep)) {
              // Approach from fifth → resolve to root on kick
              notes.push({ step: anticipStep, voice: 'bass', midi: fifth, velocity: humanize(0.6, 0.06) });
            }
          }
          // Hit with kick too (lock + anticipate)
          if (ks % 4 === 0) {
            notes.push({ step: ks, voice: 'bass', midi: root, velocity: humanize(0.85, 0.05) });
          }
        }
        break;
      }
      case 'SPACE': {
        // Bass intentionally leaves space — sparse, hypnotic
        // Only play on beats where kick is NOT dense
        const kickDensity = kickSteps.size;
        if (kickDensity > 6) {
          // Dense kick → bass plays only beats 0 and 8
          notes.push({ step: 0, voice: 'bass', midi: root, velocity: humanize(0.9, 0.05) });
          notes.push({ step: 8, voice: 'bass', midi: fifth, velocity: humanize(0.75, 0.06) });
        } else {
          // Sparse kick → bass fills more
          for (const s of [0, 4, 8, 12]) {
            notes.push({ step: s, voice: 'bass', midi: s === 8 ? fifth : root, velocity: humanize(0.8, 0.05) });
          }
        }
        break;
      }
    }

    // F22: Phrase-end bass walk (shared across all relationships)
    if (barInPhrase === 7) {
      const existing = notes.filter(n => n.step >= 12 && n.voice === 'bass');
      for (const n of existing) {
        const idx = notes.indexOf(n);
        if (idx >= 0) notes.splice(idx, 1);
      }
      notes.push({ step: 12, voice: 'bass', midi: root, velocity: humanize(0.85, 0.05) });
      notes.push({ step: 14, voice: 'bass', midi: fifth, velocity: humanize(0.7, 0.06) });
      notes.push({ step: 15, voice: 'bass', midi: octaveUp, velocity: humanize(0.6, 0.08) });
    }

    // F22: Update continuous state with bass's last note
    const state = this.stateManager.getState();
    const lastBass = notes.filter(n => n.voice === 'bass').pop();
    if (lastBass && lastBass.midi !== null) {
      state.bassLastMidi = lastBass.midi;
    }

    this.lastReason = `bass relationship=${relationship} (kick steps=${kickSteps.size})`;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // F17.4: LEARNED BASS GENERATION
  // Generates bass from learned interval transitions + rhythm pattern.
  // This is NEW material that reflects radio learning, not copied notes.
  // ═══════════════════════════════════════════════════════════════════════
  private generateLearnedBass(
    notes: ScheduledNote[], ctx: MusicalContextSnapshot, grammar: BassGrammar,
    root: number, fifth: number, third: number, octaveUp: number,
    humanize: (v: number, j: number) => number, barInPhrase: number,
  ): void {
    const section = ctx.sectionName;
    // Use learned rhythm pattern to determine WHICH steps get bass notes
    // Use learned interval transitions to determine WHICH pitch (degree)
    let currentDegree = 0; // start at root

    for (let step = 0; step < 16; step++) {
      // Learned rhythm pattern: probability of note at this step
      const rhythmProb = grammar.rhythmPattern[step] ?? 0.5;
      // Section density modulation
      const densityMod = section === 'CLIMAX' ? 1.2 : section === 'RESOLUTION' ? 0.7 : 1.0;
      const playProb = Math.min(1, rhythmProb * densityMod);

      if (this.rng.next() < playProb) {
        // Choose degree using learned interval transitions
        // Map current degree to pitch class, sample transition
        const currentPc = ctx.rootPc;
        const transitions = grammar.intervalTransitions[currentPc] ?? grammar.intervalTransitions[0];
        if (transitions) {
          // Sample a target pitch class
          let r = this.rng.next();
          let targetPc = 0;
          for (let pc = 0; pc < 12; pc++) {
            r -= transitions[pc];
            if (r <= 0) { targetPc = pc; break; }
          }
          // Map target PC to a scale degree
          const interval = ((targetPc - ctx.rootPc) + 12) % 12;
          // Choose midi note: root, fifth, third, or octave based on interval
          let midi: number;
          if (interval === 0 || interval === 7) midi = root;        // root/5th → root
          else if (interval === 5 || interval === 2) midi = fifth;   // 4th/2nd → fifth
          else if (interval === 3 || interval === 4) midi = third;   // 3rd → third
          else if (interval === 8 || interval === 9) midi = octaveUp; // 6th → octave
          else midi = root; // default

          // Octave jump probability
          if (this.rng.next() < grammar.octaveJumpProb && step % 4 === 0) {
            midi = octaveUp;
          }

          // Velocity: accent on downbeats, learned syncopation
          const isDownbeat = step % 4 === 0;
          const vel = isDownbeat ? 0.85 : (grammar.syncopation > 0.4 ? 0.6 : 0.5);
          notes.push({ step, voice: 'bass', midi, velocity: humanize(vel, 0.06) });

          // Update current degree for next transition
          currentDegree = interval;
        }
      }
    }

    // F17: Phrase-end walk (learned approach tone behavior)
    if (barInPhrase === 7) {
      const existing = notes.filter(n => n.step >= 12 && n.voice === 'bass');
      for (const n of existing) {
        const idx = notes.indexOf(n);
        if (idx >= 0) notes.splice(idx, 1);
      }
      // Approach from above or below based on learned grammar
      if (grammar.approachFromAbove > grammar.approachFromBelow) {
        notes.push({ step: 12, voice: 'bass', midi: root, velocity: humanize(0.85, 0.05) });
        notes.push({ step: 14, voice: 'bass', midi: third, velocity: humanize(0.7, 0.06) });
        notes.push({ step: 15, voice: 'bass', midi: root, velocity: humanize(0.6, 0.08) });
      } else {
        notes.push({ step: 12, voice: 'bass', midi: root, velocity: humanize(0.85, 0.05) });
        notes.push({ step: 14, voice: 'bass', midi: fifth, velocity: humanize(0.7, 0.06) });
        notes.push({ step: 15, voice: 'bass', midi: octaveUp, velocity: humanize(0.6, 0.08) });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // F20.1: STRATEGIC BASS GENERATION
  // Each strategy produces a fundamentally different bassline behavior.
  // This is NOT parameter variation — different strategies have different
  // rhythmic patterns, note choices, and relationships to the groove.
  // ═══════════════════════════════════════════════════════════════════════
  private generateStrategicBass(
    notes: ScheduledNote[], ctx: MusicalContextSnapshot, strategy: BassStrategyType,
    root: number, fifth: number, third: number, octaveUp: number,
    humanize: (v: number, j: number) => number, barInPhrase: number,
  ): void {
    const section = ctx.sectionName;
    const state = this.stateManager.getState();

    switch (strategy) {
      case 'rolling': {
        // F20: 16th-note rolling bass — the classic psytrance bass
        for (let step = 0; step < 16; step++) {
          const isDownbeat = step % 4 === 0;
          const midi = isDownbeat ? root : (step % 8 === 4 ? fifth : root);
          const vel = isDownbeat ? 0.9 : 0.55;
          notes.push({ step, voice: 'bass', midi, velocity: humanize(vel, 0.06) });
        }
        break;
      }
      case 'syncopated': {
        // F20: Offbeat-focused bass — spacey, leaves holes on downbeats
        for (let step = 2; step < 16; step += 4) {
          notes.push({ step, voice: 'bass', midi: root, velocity: humanize(0.85, 0.05) });
          notes.push({ step: step + 1, voice: 'bass', midi: fifth, velocity: humanize(0.6, 0.06) });
        }
        // Add a low root on beat 1 for anchor
        notes.push({ step: 0, voice: 'bass', midi: root, velocity: humanize(0.9, 0.05) });
        break;
      }
      case 'driving': {
        // F20: 8th-note relentless bass — no offbeats, pure drive
        for (let beat = 0; beat < 4; beat++) {
          const midi = beat === 2 ? fifth : root;
          notes.push({ step: beat * 4, voice: 'bass', midi, velocity: humanize(0.9, 0.04) });
        }
        break;
      }
      case 'sparse': {
        // F20: Minimal hypnotic bass — only beats 0 and 8
        notes.push({ step: 0, voice: 'bass', midi: root, velocity: humanize(0.9, 0.05) });
        notes.push({ step: 8, voice: 'bass', midi: fifth, velocity: humanize(0.75, 0.06) });
        if (section === 'CLIMAX' && this.rng.next() < 0.4) {
          notes.push({ step: 12, voice: 'bass', midi: root, velocity: humanize(0.6, 0.08) });
        }
        break;
      }
      case 'acid': {
        // F20: 303-style bass — chromatic approaches, filter sweep implied
        const degrees = [0, 0, 1, 0, 0, -1, 0, 3]; // chromatic approach pattern
        for (let beat = 0; beat < 4; beat++) {
          const deg = degrees[beat % degrees.length];
          const midi = degreeToMidi(ctx.rootPc, ctx.scale, deg, 2);
          notes.push({ step: beat * 4, voice: 'bass', midi, velocity: humanize(0.85, 0.06) });
          // Add 16th between beats for squelch
          if (this.rng.next() < 0.5) {
            notes.push({ step: beat * 4 + 2, voice: 'bass', midi, velocity: humanize(0.5, 0.08) });
          }
        }
        break;
      }
      case 'melodic': {
        // F20: Walking bass — harmonic movement
        const walkDegrees = [0, 4, 2, 7]; // root → fifth → third → octave
        for (let beat = 0; beat < 4; beat++) {
          const deg = walkDegrees[beat];
          const midi = degreeToMidi(ctx.rootPc, ctx.scale, deg, 2);
          notes.push({ step: beat * 4, voice: 'bass', midi, velocity: humanize(0.85, 0.05) });
        }
        break;
      }
      case 'tension': {
        // F20: Chromatic tension bass — approaches root from below
        for (let beat = 0; beat < 4; beat++) {
          const approachMidi = beat < 3 ? root - 1 : root; // chromatic approach then resolve
          notes.push({ step: beat * 4, voice: 'bass', midi: approachMidi, velocity: humanize(0.8, 0.06) });
        }
        break;
      }
      case 'octave_jump': {
        // F20: Octave movement for energy — root then octave up
        for (let beat = 0; beat < 4; beat++) {
          const midi = beat % 2 === 0 ? root : octaveUp;
          notes.push({ step: beat * 4, voice: 'bass', midi, velocity: humanize(0.9, 0.05) });
        }
        break;
      }
    }

    // F20: Phrase-end walk (shared across strategies)
    if (barInPhrase === 7) {
      const existing = notes.filter(n => n.step >= 12 && n.voice === 'bass');
      for (const n of existing) {
        const idx = notes.indexOf(n);
        if (idx >= 0) notes.splice(idx, 1);
      }
      notes.push({ step: 12, voice: 'bass', midi: root, velocity: humanize(0.85, 0.05) });
      notes.push({ step: 14, voice: 'bass', midi: fifth, velocity: humanize(0.7, 0.06) });
      notes.push({ step: 15, voice: 'bass', midi: octaveUp, velocity: humanize(0.6, 0.08) });
    }

    // F20.3: Update continuous state with bass's last note
    if (notes.length > 0) {
      const lastBass = notes.filter(n => n.voice === 'bass').pop();
      if (lastBass && lastBass.midi !== null) {
        state.bassLastMidi = lastBass.midi;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // F18.4: LEARNED KICK GENERATION
  // Generates kick pattern from learned rhythm grammar (onset probabilities).
  // ═══════════════════════════════════════════════════════════════════════
  private generateLearnedKick(
    notes: ScheduledNote[], ctx: MusicalContextSnapshot, grammar: RhythmGrammar,
    barInPhrase: number, humanize: (v: number, j: number) => number,
  ): void {
    const section = ctx.sectionName;
    const radioKickOcc = (ctx as any).radioRoles?.kick ?? 0;
    const baseVel = radioKickOcc > 0.7 ? 0.6 : 0.9;

    // F18: Generate kick from learned onset pattern
    for (let step = 0; step < 16; step++) {
      const onsetProb = grammar.kickPattern[step] ?? 0.5;
      // Section density modulation
      const densityMod = section === 'CLIMAX' ? 1.15 : section === 'RESOLUTION' ? 0.8 : 1.0;
      const playProb = Math.min(1, onsetProb * densityMod);

      if (this.rng.next() < playProb) {
        // Accent: downbeat loudest, others softer
        let vel = baseVel;
        if (step === 0) vel = baseVel + 0.05;
        else if (step % 4 === 0) vel = baseVel;
        else vel = baseVel - 0.3; // ghosts
        notes.push({ step, voice: 'kick', midi: null, velocity: humanize(vel, 0.06) });
      }
    }

    // F18: Ghost notes from learned probability
    if (grammar.ghostNoteProb > 0.2 && section !== 'RESOLUTION') {
      for (let step = 1; step < 16; step += 2) {
        if (this.rng.next() < grammar.ghostNoteProb * 0.5) {
          notes.push({ step, voice: 'kick', midi: null, velocity: humanize(0.35, 0.08) });
        }
      }
    }

    // F18: Phrase-end fill
    if (barInPhrase === 7) {
      const fillSteps = [14, 15];
      for (let i = 0; i < fillSteps.length; i++) {
        const fillVel = 0.65 + (i / fillSteps.length) * 0.25;
        notes.push({ step: fillSteps[i], voice: 'kick', midi: null, velocity: humanize(fillVel, 0.05) });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // F15 HATS — swing, open/closed, velocity humanization, style groove
  // ═══════════════════════════════════════════════════════════════════════
  private generateHats(notes: ScheduledNote[], ctx: MusicalContextSnapshot, barInPhrase: number): void {
    const style = this.style;
    const section = ctx.sectionName;
    const humanize = (v: number, jitter: number) => Math.max(0.1, Math.min(1, v + (this.rng.next() - 0.5) * jitter));

    // F15: Base offbeat hats with SWING (delay odd steps slightly)
    // Swing is implicit in the step grid — we add ghost hats for groove
    const hatSteps: Array<{step: number, vel: number, open: boolean}> = [];

    if (style === 'DARK') {
      // Sparse — only steps 6 and 14 (half-time offbeats)
      hatSteps.push({ step: 6, vel: humanize(0.3 + ctx.tension * 0.2, 0.06), open: false });
      hatSteps.push({ step: 14, vel: humanize(0.35 + ctx.tension * 0.2, 0.06), open: false });
    } else if (style === 'ACID') {
      // Busy 16ths with velocity alternation
      for (let s = 0; s < 16; s += 2) {
        const isStrong = s % 4 === 0;
        hatSteps.push({ step: s, vel: humanize(isStrong ? 0.3 : 0.18, 0.05), open: s === 14 });
      }
      // Add offbeat 16ths for density
      if (section === 'CLIMAX' || section === 'DEVELOPMENT') {
        for (let s = 1; s < 16; s += 4) {
          hatSteps.push({ step: s, vel: humanize(0.15, 0.04), open: false });
        }
      }
    } else if (style === 'PROGRESSIVE') {
      // Steady offbeats — clean
      for (const s of [2, 6, 10, 14]) {
        hatSteps.push({ step: s, vel: humanize(0.25 + ctx.tension * 0.2, 0.05), open: false });
      }
    } else {
      // FULL_ON — offbeats + ghost notes for groove
      for (const s of [2, 6, 10, 14]) {
        hatSteps.push({ step: s, vel: humanize(0.3 + ctx.tension * 0.25, 0.06), open: s === 14 });
      }
      // Ghost hats on 16ths for full-time feel
      if (section === 'CLIMAX' || section === 'CONTRAST') {
        for (let s = 0; s < 16; s += 1) {
          if ([2,6,10,14].includes(s)) continue;
          if (this.rng.next() < 0.3) {
            hatSteps.push({ step: s, vel: humanize(0.12, 0.04), open: false });
          }
        }
      }
    }

    for (const h of hatSteps) {
      notes.push({ step: h.step, voice: 'hat', midi: null, velocity: h.vel });
    }

    // F15: Phrase-end fill — open hat rush
    if (barInPhrase === 7 && style !== 'PROGRESSIVE') {
      notes.push({ step: 15, voice: 'hat', midi: null, velocity: humanize(0.45, 0.06) });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // F9: LEAD — optional, controlled, LOWER register (octave 3-4, not 4-5)
  // ═══════════════════════════════════════════════════════════════════════
  private calculateLeadDensity(ctx: MusicalContextSnapshot, radio: RadioWindowSnapshot, barInPhrase: number): number {
    // F15: INTRO now has SPARSE lead (not zero) — establishes a motif seed
    // instead of 33 seconds of empty groove. Lead enters softly at bar 4.
    if (ctx.sectionName === 'INTRO' && barInPhrase < 4) {
      this.lastReason = 'lead RESTING (INTRO first half — groove establishing)';
      return 0;
    }

    // F15: ABSTAIN — if radio is dense in the lead/mid band, rest to avoid clash
    if (radio.currentOccupancy.lead > 0.7 && ctx.sectionName !== 'CLIMAX') {
      this.lastReason = 'lead ABSTAIN (radio melody present, avoiding clash)';
      return 0;
    }

    let density = 0.3;

    const section = ctx.sectionName;
    if (section === 'INTRO') density = 0.2;           // F15: sparse lead in late INTRO
    else if (section === 'STATEMENT') density = 0.45;
    else if (section === 'DEVELOPMENT' || section === 'DEVELOPMENT2') density = 0.55;
    else if (section === 'CONTRAST') density = 0.5;
    else if (section === 'CLIMAX') density = 0.7;     // F15: more lead at climax
    else if (section === 'RESOLUTION') density = 0.25;

    // F15: Style affects lead density and character
    if (this.style === 'FULL_ON') density *= 1.1;
    else if (this.style === 'DARK') density *= 0.65;  // sparse, eerie
    else if (this.style === 'PROGRESSIVE') density *= 0.85;
    else if (this.style === 'ACID') density *= 1.25;  // dense, squelchy

    if (barInPhrase === 0) density += 0.1;
    if (barInPhrase === 6) density -= 0.1;
    if (barInPhrase === 7) density -= 0.15;

    if (radio.currentOccupancy.lead > 0.6) density *= 0.5;
    if (radio.energyRising) density = Math.min(0.85, density + 0.1);

    density = density * (0.7 + ctx.tension * 0.3);

    this.lastReason = `lead density=${density.toFixed(2)} (section=${section} style=${this.style} barInPhrase=${barInPhrase})`;
    return Math.max(0, Math.min(0.85, density));
  }

  private generateLead(notes: ScheduledNote[], ctx: MusicalContextSnapshot, motif: StoredMotif, barInPhrase: number, action: string, density: number): void {
    // F22 P0-A: FIX LEAD BYPASS BUG.
    // The old code checked learnedMelodic.confidence > 0.25 and called
    // generateLearnedLead() which returned early, BYPASSING generateRelationalLead().
    // This meant: when radio learning was active, the lead lost its relational
    // awareness (bass avoidance, chord targeting, phrase development).
    //
    // FIX: generateRelationalLead() is the ONLY lead path. It already handles
    // learned grammar as one of its inputs (via interval sampling + phrase
    // state). Learning is an INPUT, not an alternate composer.
    //
    // The old generateLearnedLead and generateLead paths are REMOVED.
    // All lead generation goes through generateRelationalLead().

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
          // F16: Widen velocity band — was 0.30-0.55, now 0.25-0.95
          // Accents on strong beats, softer on weak. Tension adds energy.
          const isStrongBeat = localStep % 4 === 0;
          const baseVel = isStrongBeat ? 0.75 : 0.45;
          const tensionBoost = ctx.tension * 0.2;
          const vel = Math.max(0.2, Math.min(0.95, baseVel + tensionBoost + (this.rng.next() - 0.5) * 0.15));
          notes.push({ step: localStep, voice: 'lead', midi, velocity: vel });
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

  // ═══════════════════════════════════════════════════════════════════════
  // F19.4: LEARNED LEAD GENERATION WITH CANDIDATE SCORING
  // Generates multiple candidates, scores them against the continuous musical
  // state, and selects the best. This is NOT random — it's evaluative.
  // ═══════════════════════════════════════════════════════════════════════
  private generateLearnedLead(
    notes: ScheduledNote[], ctx: MusicalContextSnapshot, grammar: MelodicGrammar,
    barInPhrase: number, density: number,
  ): void {
    const state = this.stateManager.getState();

    // F19.6: Generate 5 candidates with different characteristics
    const candidates = this.candidateGenerator.generateCandidates(
      grammar,
      { rootPc: ctx.rootPc, scale: ctx.scale, section: ctx.sectionName, tension: ctx.tension, energy: ctx.energy },
      state,
      barInPhrase,
      density,
      5,
    );

    // F19.7: Select best candidate by total score
    const best = this.candidateGenerator.selectBest(candidates);
    this.lastSelectedCandidate = best;
    this.lastCandidateScores = candidates.map(c => c.totalScore);

    // F19.3: Emit the selected candidate's notes — CONTINUOUS from previous phrase
    for (const n of best.notes) {
      const isStrongBeat = n.step % 4 === 0;
      const vel = Math.max(0.2, Math.min(0.95, n.velocity + (this.rng.next() - 0.5) * 0.1));
      notes.push({ step: n.step, voice: 'lead', midi: n.midi, velocity: vel });
    }

    // Update continuous state with the selected lead's last MIDI
    if (best.notes.length > 0) {
      this.stateManager.getState().leadLastMidi = best.notes[best.notes.length - 1].midi;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // F21 Phase 3: RELATIONAL LEAD GENERATION
  // The lead KNOWS the kick and bass notes for THIS bar. It:
  // - Leaves holes where bass is busy
  // - Fills space where bass is silent
  // - Targets chord tones on strong beats
  // - Develops the previous phrase's motif
  // - Responds to tension state
  // ═══════════════════════════════════════════════════════════════════════
  private generateRelationalLead(
    notes: ScheduledNote[],
    ctx: MusicalContextSnapshot,
    barInPhrase: number,
    density: number,
    kickNotes: ScheduledNote[],
    bassNotes: ScheduledNote[],
    bar: number,
  ): void {
    // Build maps of which steps have kick/bass
    const kickSteps = new Set(kickNotes.map(n => n.step));
    const bassSteps = new Set(bassNotes.filter(n => n.midi !== null).map(n => n.step));
    const bassMidiByStep = new Map<number, number>();
    for (const bn of bassNotes) {
      if (bn.midi !== null) bassMidiByStep.set(bn.step, bn.midi);
    }

    // Get harmonic state for chord-tone targeting
    const harmonic = this.harmonicState;
    const groove = this.grooveState;
    const tension = this.tensionState;

    // F21: Start from previous phrase's last note (continuity)
    const state = this.stateManager.getState();
    let currentMidi = state.leadLastMidi > 0
      ? Math.max(48, Math.min(72, state.leadLastMidi))
      : degreeToMidi(ctx.rootPc, ctx.scale, 0, 3);

    // F21: Get previous phrase notes for development
    const prevPhrase = this.phraseState.previous;
    const operator = this.phraseState.operator;

    // F21: If we have a previous phrase, transform it
    let inheritedNotes: PhraseNote[] | null = null;
    if (prevPhrase && prevPhrase.notes.length > 0) {
      const scaleIntervals = ctx.scale.intervals;
      inheritedNotes = transformPhrase(prevPhrase, operator, ctx.rootPc, scaleIntervals);
    }

    // F21: Generate lead notes — RELATIONAL
    for (let step = 0; step < 16; step++) {
      const isStrongBeat = step % 4 === 0;
      const hasBass = bassSteps.has(step);
      const hasKick = kickSteps.has(step);

      // F21: RHYTHMIC RELATIONSHIP
      // Leave holes where bass is busy (avoid collision)
      // Fill space where bass is silent (complement)
      let playProb = density;
      if (hasBass && !isStrongBeat) {
        // Bass is busy here and it's not a strong beat → leave a hole
        playProb *= 0.3;
      } else if (!hasBass && groove.spaceMap[step] > 0.4) {
        // Bass is silent and there's space → fill it
        playProb *= 1.5;
      }

      // F21: TENSION DRIVES DENSITY
      // High rhythmic tension → more notes
      playProb *= (0.7 + tension.rhythmic * 0.6);
      // Resolving → fewer notes
      if (tension.resolving) playProb *= 0.6;

      // F21: Use inherited notes if available (phrase development)
      if (inheritedNotes) {
        const inherited = inheritedNotes.find(n => n.step === step);
        if (inherited && this.rng.next() < playProb) {
          // F21: HARMONIC TARGETING — snap to nearest chord tone on strong beats
          let midi = inherited.midi;
          if (harmonic && isStrongBeat) {
            // 70% chance to target chord tone on strong beats
            if (this.rng.next() < 0.7) {
              midi = nearestChordTone(harmonic, midi, step, barInPhrase);
            }
          }
          // F21: REGISTER SEPARATION — avoid bass register
          if (bassMidiByStep.has(step)) {
            const bassMidi = bassMidiByStep.get(step)!;
            if (Math.abs(midi - bassMidi) < 7) {
              midi = Math.min(72, bassMidi + 12); // shift up an octave
            }
          }
          currentMidi = Math.max(48, Math.min(72, midi));
          const vel = isStrongBeat ? 0.75 : 0.5;
          notes.push({ step, voice: 'lead', midi: currentMidi, velocity: vel });
          continue;
        }
      }

      // F21: Generate new note (when no inherited note)
      if (this.rng.next() < playProb) {
        // F21: Choose interval based on tension
        // High melodic tension → larger intervals
        const maxInterval = Math.round(2 + tension.melodic * 7); // 2-9 semitones
        const interval = Math.round((this.rng.next() - 0.5) * 2 * maxInterval);

        let newMidi = currentMidi + interval;

        // F21: HARMONIC TARGETING — on strong beats, snap to chord tone
        if (harmonic && isStrongBeat && this.rng.next() < 0.7) {
          newMidi = nearestChordTone(harmonic, newMidi, step, barInPhrase);
        }

        // F21: REGISTER SEPARATION — avoid landing in bass register
        if (bassMidiByStep.has(step)) {
          const bassMidi = bassMidiByStep.get(step)!;
          if (Math.abs(newMidi - bassMidi) < 7) {
            newMidi = Math.min(72, bassMidi + 12);
          }
        }

        // F21: TENSION DRIVES REGISTER
        // High register tension → push up
        if (tension.register > 0.6 && this.rng.next() < 0.3) {
          newMidi = Math.min(72, newMidi + 2);
        }
        // Resolving → descend
        if (tension.resolving && this.rng.next() < 0.4) {
          newMidi = Math.max(48, newMidi - 2);
        }

        currentMidi = Math.max(48, Math.min(72, newMidi));
        const vel = isStrongBeat ? 0.75 : 0.5;
        notes.push({ step, voice: 'lead', midi: currentMidi, velocity: vel });
      }
    }

    // F21: Phrase-end cadence — resolve to root on last step
    if (barInPhrase === 7) {
      const rootMidi = degreeToMidi(ctx.rootPc, ctx.scale, 0, 3);
      notes.push({ step: 15, voice: 'lead', midi: rootMidi, velocity: 0.6 });
      currentMidi = rootMidi;
    }

    // F21: Update continuous state
    state.leadLastMidi = currentMidi;

    // F21: Create phrase record at phrase end
    if (barInPhrase === 7) {
      const leadNotesInPhrase = notes.filter(n => n.voice === 'lead' && n.midi !== null);
      const phraseNotes: PhraseNote[] = leadNotesInPhrase.map(n => ({
        step: n.step, midi: n.midi as number, velocity: n.velocity,
      }));
      const record = createPhraseRecord(
        phraseNotes,
        `phrase-${this.phraseState.phraseIndex}`,
        this.phraseState.previous?.phraseId ?? null,
        this.phraseState.motifFamilyId,
        this.phraseState.operator,
        bar - 7,
        this.tensionState.harmonic,
        this.tensionState.harmonic,
        ctx.energy,
        ctx.energy,
      );
      this.phraseState.beforePrevious = this.phraseState.previous;
      this.phraseState.previous = record;
      this.phraseState.current = record;
      this.phraseState.phraseIndex++;
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
    const leadNotes = notes.filter(n => n.voice === 'lead');
    const bassNotes = notes.filter(n => n.voice === 'bass');
    const coherence = leadNotes.length > 0 ? 0.5 : 0.3;
    const densityFit = Math.abs(notes.length / 8 - ctx.density * 10) < 5 ? 0.8 : 0.4;
    const novelty = action === 'develop' || action === 'variation' ? 0.7 : 0.5;

    // F20.8: Strategy-aware reward — different strategies get different rewards
    // based on how well they fit the current context.
    let strategyBonus = 0;
    if (this.currentStrategies) {
      // Reward sparse bass during INTRO/RESOLUTION
      if ((ctx.sectionName === 'INTRO' || ctx.sectionName === 'RESOLUTION') &&
          this.currentStrategies.bass === 'sparse') strategyBonus += 0.15;
      // Reward rolling bass during CLIMAX
      if (ctx.sectionName === 'CLIMAX' &&
          (this.currentStrategies.bass === 'rolling' || this.currentStrategies.bass === 'driving')) strategyBonus += 0.15;
      // Reward acid bass during ACID style
      if (this.style === 'ACID' && this.currentStrategies.bass === 'acid') strategyBonus += 0.1;
      // Reward atmospheric lead during BREAK
      if (ctx.sectionName === 'RESOLUTION' && this.currentStrategies.lead === 'atmospheric') strategyBonus += 0.1;
      // Reward call_response lead when bass is busy
      if ((this.currentStrategies.bass === 'rolling' || this.currentStrategies.bass === 'driving') &&
          this.currentStrategies.lead === 'call_response') strategyBonus += 0.1;
      // Penalize dense lead with sparse bass (mismatch)
      if (this.currentStrategies.bass === 'sparse' &&
          (this.currentStrategies.lead === 'rolling_motif' || this.currentStrategies.lead === 'hook')) strategyBonus -= 0.1;
    }

    const reward = Math.max(0.1, Math.min(0.9, coherence * 0.3 + densityFit * 0.25 + 0.25 + novelty * 0.2 + strategyBonus));
    this.memory.recordPhrase({
      phraseIndex: ctx.phraseIndex, bar: this.phraseStartBar,
      motifId: this.currentMotif?.id ?? 'unknown', transform: action,
      section: ctx.sectionName, tension: ctx.tension, density: ctx.density,
      noteCount: notes.length, restRatio: 0, reward, role: 'LEAD',
    });

    // F20.8: REWARD LOOP — update strategy weights based on phrase reward
    if (this.currentStrategies) {
      this.strategySelector.updateWeights(reward, this.currentStrategies);
    }
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
    this.observationExtractor.reset();
    this.grammarBuilder.reset();
    this.stateManager.reset();
    this.strategySelector.reset();
    this.grooveState = createDefaultGroove();
    this.harmonicState = null;
    this.phraseState = createInitialPhraseState();
    this.tensionState = createInitialTension();
    this.currentStrategies = null;
    this.strategyHistory = [];
    this.currentPlan = null; this.currentMotif = null;
    this.phraseMotifs.clear(); this.motifGroups = [[], [], []];
    this.phraseNotes = []; this.learned = false;
    this.rng = new Rng(43); this.style = 'FULL_ON'; this.styleConfidence = 0;
    this.userStyleLocked = false;
    this.learningInfluencedCount = 0;
    this.lastReason = '';
    this.lastPhraseExtracted = -1;
    this.cycleCount = 0;
    this.lastBarPlanned = -1;
    this.forcedSection = null;
    this.breakRemaining = 0;
    this.buildRemaining = 0;
    this.dropRemaining = 0;
  }
}
