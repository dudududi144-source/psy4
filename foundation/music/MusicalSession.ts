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

    // F15: BREAK — only kick + bass (no hats, no lead)
    const isBreak = arrangementOverride === 'BREAK';
    // F15: DROP — maximum density (all voices, high velocity)
    const isDrop = arrangementOverride === 'DROP';
    // F15: BUILD — gradually increase density
    const isBuild = arrangementOverride === 'BUILD';

    // F9 RULE 3: KICK FIRST — always present, never removed
    this.generateKick(notes, snap, barInPhrase, bar);

    // F9 RULE 4: BASS — interlocked with kick
    this.generateBass(notes, snap, barInPhrase);

    // F15: BREAK — no hats, no lead (just kick + bass)
    if (!isBreak) {
      // F9 RULE 8: HATS — complementary
      this.generateHats(notes, snap, barInPhrase);

      // F9 RULE 8: LEAD — optional, controlled, lower register
      let leadDensity = this.calculateLeadDensity(snap, radio, barInPhrase);
      // F15: DROP — force high lead density
      if (isDrop) leadDensity = Math.max(leadDensity, 0.75);
      // F15: BUILD — ramp density (higher as build progresses)
      if (isBuild) leadDensity = Math.max(leadDensity, 0.3 + (1 - this.buildRemaining / 4) * 0.4);

      if (leadDensity > 0) {
        this.generateLead(notes, snap, motif, barInPhrase, action, leadDensity);
      } else {
        this.lastReason = 'lead resting (groove sufficient)';
      }
    } else {
      this.lastReason = 'BREAK — kick + bass only';
    }

    this.phraseNotes.push(...notes);
    if (barInPhrase === 7) this.evaluatePhrase(bar, snap, action);

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
  // F15 BASS — harmonic movement + rolling articulation
  // Moves through root → fifth → octave → root for harmonic development
  // ═══════════════════════════════════════════════════════════════════════
  private generateBass(notes: ScheduledNote[], ctx: MusicalContextSnapshot, barInPhrase: number): void {
    const octave = 2; // MIDI 33-45 range (low bass)
    const root = degreeToMidi(ctx.rootPc, ctx.scale, 0, octave);
    const fifth = degreeToMidi(ctx.rootPc, ctx.scale, 4, octave);
    const third = degreeToMidi(ctx.rootPc, ctx.scale, 2, octave);
    const octaveUp = degreeToMidi(ctx.rootPc, ctx.scale, 0, octave + 1);
    const style = this.style;
    const section = ctx.sectionName;
    const humanize = (v: number, jitter: number) => Math.max(0.1, Math.min(1, v + (this.rng.next() - 0.5) * jitter));

    // F17.4: LEARNED BASS GRAMMAR — if we have learned from radio, generate
    // bass from the learned interval transitions + rhythm pattern instead
    // of hardcoded beatDegrees. This produces material that REFLECTS what
    // the radio taught, without copying melodies.
    const learnedBass = this.getLearnedBassGrammar();
    if (learnedBass && learnedBass.confidence > 0.25 && section !== 'INTRO') {
      this.generateLearnedBass(notes, ctx, learnedBass, root, fifth, third, octaveUp, humanize, barInPhrase);
      return;
    }

    // F15: Harmonic movement — which degree per beat
    // Beat 0 (bar 0): root. Beat 4: root. Beat 8: fifth (movement). Beat 12: root.
    // During DEVELOPMENT/CLIMAX: more movement (octave, third)
    let beatDegrees: number[]; // degree per beat [0,1,2,3] → [root, root/fifth, fifth/octave, root]
    if (section === 'INTRO' || section === 'RESOLUTION') {
      beatDegrees = [0, 0, 0, 0]; // static root (establishing/resolving)
    } else if (section === 'STATEMENT') {
      beatDegrees = [0, 0, 4, 0]; // root → fifth on beat 3
    } else if (section === 'DEVELOPMENT' || section === 'DEVELOPMENT2') {
      beatDegrees = [0, 4, 0, 2]; // root → fifth → root → third
    } else if (section === 'CONTRAST') {
      beatDegrees = [4, 0, 2, 4]; // more movement
    } else {
      // CLIMAX — most movement
      beatDegrees = [0, 4, 2, 7]; // root → fifth → third → octave
    }

    // F16: Cycle drift — each cycle shifts the bass pattern distinctly
    // This ensures 4 cycles of 64 bars don't produce identical basslines.
    if (this.cycleCount === 1 && section !== 'INTRO' && section !== 'RESOLUTION') {
      // Cycle 1: walk to third on beat 2 (instead of root or fifth)
      beatDegrees = [beatDegrees[0], 2, beatDegrees[2], beatDegrees[3]];
    } else if (this.cycleCount === 2 && section !== 'INTRO' && section !== 'RESOLUTION') {
      // Cycle 2: octave on beat 3, fifth on beat 2
      beatDegrees = [beatDegrees[0], 4, 7, beatDegrees[3]];
    } else if (this.cycleCount >= 3 && section !== 'INTRO' && section !== 'RESOLUTION') {
      // Cycle 3+: full chromatic walk
      beatDegrees = [0, 4, 2, 7];
    }

    // Style modifies the pattern
    if (style === 'DARK') {
      // Sparse — only on beats (no offbeat response)
      for (let beat = 0; beat < 4; beat++) {
        const midi = beatDegrees[beat] === 4 ? fifth : beatDegrees[beat] === 2 ? third : beatDegrees[beat] === 7 ? octaveUp : root;
        notes.push({ step: beat * 4, voice: 'bass', midi, velocity: humanize(0.9, 0.05) });
      }
    } else if (style === 'PROGRESSIVE') {
      // Smooth — root on beats, occasional offbeat
      for (let beat = 0; beat < 4; beat++) {
        const midi = beatDegrees[beat] === 4 ? fifth : beatDegrees[beat] === 2 ? third : beatDegrees[beat] === 7 ? octaveUp : root;
        notes.push({ step: beat * 4, voice: 'bass', midi, velocity: humanize(0.9, 0.05) });
        if (beat % 2 === 1) {
          notes.push({ step: beat * 4 + 2, voice: 'bass', midi, velocity: humanize(0.55, 0.06) });
        }
      }
    } else if (style === 'ACID') {
      // 303-style — 16th-note rolling with filter movement implied
      for (let beat = 0; beat < 4; beat++) {
        const midi = beatDegrees[beat] === 4 ? fifth : beatDegrees[beat] === 2 ? third : beatDegrees[beat] === 7 ? octaveUp : root;
        // Every 16th, with velocity pattern (accent on downbeats)
        for (let sub = 0; sub < 4; sub++) {
          const step = beat * 4 + sub;
          const vel = sub === 0 ? 0.9 : sub === 2 ? 0.6 : 0.4;
          // Skip some for breathing room
          if (sub === 1 || sub === 3) {
            if (this.rng.next() < 0.4) continue;
          }
          notes.push({ step, voice: 'bass', midi, velocity: humanize(vel, 0.08) });
        }
      }
    } else {
      // FULL_ON — rolling 16ths with offbeat response
      for (let beat = 0; beat < 4; beat++) {
        const midi = beatDegrees[beat] === 4 ? fifth : beatDegrees[beat] === 2 ? third : beatDegrees[beat] === 7 ? octaveUp : root;
        notes.push({ step: beat * 4, voice: 'bass', midi, velocity: humanize(0.9, 0.05) });
        notes.push({ step: beat * 4 + 2, voice: 'bass', midi, velocity: humanize(0.6, 0.06) });
      }
    }

    // F15: Phrase-end bass walk (cadence)
    if (barInPhrase === 7) {
      // Replace last beat with a walk: root → fifth → octave (resolving to root next phrase)
      const lastBeatStep = 12;
      const existing = notes.filter(n => n.step >= lastBeatStep && n.voice === 'bass');
      for (const n of existing) {
        const idx = notes.indexOf(n);
        if (idx >= 0) notes.splice(idx, 1);
      }
      notes.push({ step: 12, voice: 'bass', midi: root, velocity: humanize(0.85, 0.05) });
      notes.push({ step: 14, voice: 'bass', midi: fifth, velocity: humanize(0.7, 0.06) });
      notes.push({ step: 15, voice: 'bass', midi: octaveUp, velocity: humanize(0.6, 0.08) });
    }
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
    // F18.3: LEARNED LEAD GENERATION — if we have learned melodic grammar,
    // generate new melodies from learned interval distributions instead of
    // using random motifs. This produces material that REFLECTS what the
    // radio taught, without copying melodies.
    const learnedMelodic = this.getLearnedMelodicGrammar();
    if (learnedMelodic && learnedMelodic.confidence > 0.25 && ctx.sectionName !== 'INTRO') {
      this.generateLearnedLead(notes, ctx, learnedMelodic, barInPhrase, density);
      return;
    }

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
  // F18.3: LEARNED LEAD GENERATION
  // Generates new melodies from learned interval distributions.
  // This is NOT motif transpose — it's sampling from a learned probability
  // model of intervals, contour, and register.
  // ═══════════════════════════════════════════════════════════════════════
  private generateLearnedLead(
    notes: ScheduledNote[], ctx: MusicalContextSnapshot, grammar: MelodicGrammar,
    barInPhrase: number, density: number,
  ): void {
    const section = ctx.sectionName;
    // F18: Start from a scale degree based on learned preference
    const degreePrefs = grammar.degreePreference;
    let currentDegree = 0;

    // Sample initial degree from preference distribution
    let r = this.rng.next();
    for (let d = 0; d < degreePrefs.length; d++) {
      r -= degreePrefs[d];
      if (r <= 0) { currentDegree = d; break; }
    }

    const leadOctave = 3 + (grammar.registerPreference > 0.6 ? 1 : 0); // higher register if learned
    let currentMidi = degreeToMidi(ctx.rootPc, ctx.scale, currentDegree, leadOctave);

    // F18: Generate notes using learned interval histogram
    // The interval histogram has 25 values (indices 0-24, center=12 for 0 semitones)
    const intervalHist = grammar.intervalHistogram;

    for (let step = 0; step < 16; step++) {
      // Decide whether to play at this step (density + rest density)
      const restProb = grammar.restDensity;
      const playProb = density * (1 - restProb);

      if (this.rng.next() < playProb) {
        // Sample an interval from the learned histogram
        let r2 = this.rng.next();
        let intervalIdx = 12; // default: repeat
        for (let i = 0; i < intervalHist.length; i++) {
          r2 -= intervalHist[i];
          if (r2 <= 0) { intervalIdx = i; break; }
        }
        const interval = intervalIdx - 12; // -12 to +12 semitones

        // Apply contour preference (ascending/descending/static)
        let finalInterval = interval;
        if (this.rng.next() < grammar.ascendingProb && interval < 0) finalInterval = -interval;
        if (this.rng.next() < grammar.descendingProb && interval > 0) finalInterval = -interval;
        if (this.rng.next() < grammar.staticProb) finalInterval = 0;

        // Apply interval to current MIDI, clamping to register
        currentMidi = Math.max(48, Math.min(72, currentMidi + finalInterval));

        // Velocity: accent on strong beats, learned register influence
        const isStrongBeat = step % 4 === 0;
        const baseVel = isStrongBeat ? 0.75 : 0.5;
        const vel = Math.max(0.2, Math.min(0.95, baseVel + (this.rng.next() - 0.5) * 0.15));
        notes.push({ step, voice: 'lead', midi: currentMidi, velocity: vel });
      }
    }

    // F18: Phrase-end cadence — resolve toward root
    if (barInPhrase === 7) {
      const rootMidi = degreeToMidi(ctx.rootPc, ctx.scale, 0, leadOctave);
      const lastNote = notes[notes.length - 1];
      if (lastNote && lastNote.voice === 'lead') {
        // Walk toward root in last 2 steps
        notes.push({ step: 14, voice: 'lead', midi: Math.max(48, Math.min(72, rootMidi + 2)), velocity: 0.5 });
        notes.push({ step: 15, voice: 'lead', midi: rootMidi, velocity: 0.6 });
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
    this.observationExtractor.reset();
    this.grammarBuilder.reset();
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
