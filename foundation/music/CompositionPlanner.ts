/**
 * CompositionPlanner — plans 8-bar phrases with musical evolution.
 *
 * F5 RULE 6-7: The planner generates a musical plan for each 8-bar phrase.
 * It decides:
 * - Which motif to use (new, reused, or transformed)
 * - Bass pattern style
 * - Rhythmic density and syncopation
 * - Tension/release curve
 * - Call/response structure
 *
 * The plan is consumed by the LiveComposer to generate actual notes.
 */

import { type MusicalContextSnapshot, type SectionArc, COMPOSITION_ARC } from './MusicalContext';
import { type StoredMotif, MusicalMemory } from './MusicalMemory';
import { type Scale } from './primitives/scales';
import { type MotifNote, generateMotif } from './primitives/motif';
import { type BassNote, generateBassPattern, type BassStyle, type TensionCurve, sampleTension } from './primitives/bass';
import { type RhythmPattern, fourOnFloor, offbeatHats, psyKick, drivingHats, backbeat, swing, combine } from './primitives/rhythm';
import { Rng } from './primitives/rng';

// Compatibility type for the planner
type MotifTransformType = 'none' | 'transpose' | 'invert' | 'retrograde' | 'fragment' | 'vary';

export interface PhrasePlan {
  readonly phraseIndex: number;
  readonly startBar: number;
  readonly endBar: number;
  readonly section: SectionArc;

  // Musical content
  readonly motif: StoredMotif;
  readonly bassStyle: BassStyle;
  readonly bassPattern: BassNote[];
  readonly kickPattern: RhythmPattern;
  readonly hatPattern: RhythmPattern;

  // Properties
  readonly tensionCurve: TensionCurve;
  readonly density: number;
  readonly syncopation: number;
  readonly register: number; // 0=low, 1=high

  // Meta
  readonly isTransformed: boolean;
  readonly transformType: MotifTransformType;
}

export class CompositionPlanner {
  private memory: MusicalMemory;
  private currentPlan: PhrasePlan | null = null;
  private lastNewMotifBar: number = -100;
  private lastTransformBar: number = -100;
  private rng: Rng;

  constructor(memory: MusicalMemory, seed: number = 42) {
    this.memory = memory;
    this.rng = new Rng(seed);
  }

  /**
   * Plan the next 8-bar phrase based on the current musical context.
   * F7: The planner now only handles bass/rhythm/tension structure.
   * Motif decisions are handled by the LiveComposer (which uses MusicalMemory).
   */
  planPhrase(ctx: MusicalContextSnapshot): PhrasePlan {
    const phraseIndex = ctx.phraseIndex;
    const startBar = phraseIndex * 8;
    const endBar = startBar + 8;
    const section = COMPOSITION_ARC[ctx.sectionIndex] ?? COMPOSITION_ARC[0];

    // F7: Get the current motif from memory (set by LiveComposer before calling planPhrase)
    const motif = this.memory.getCurrentMotif() ?? {
      id: 'placeholder',
      notes: [],
      rootPc: ctx.rootPc,
      scaleName: ctx.scaleName,
      createdAt: startBar,
      transform: 'none',
      usageCount: 0,
      lastUsedBar: -1,
      reward: 0.5,
      phraseIds: [],
    };

    const isTransformed = motif.transform !== 'none';
    const transformType = (motif.transform as MotifTransformType) || 'none';

    // ── Bass pattern ──
    const bassStyles: BassStyle[] = ['kb3', 'four-on-floor', 'offbeat', 'syncopated'];
    let bassStyle: BassStyle;
    if (section.name === 'INTRO' || section.name === 'RESOLUTION') {
      bassStyle = ctx.energy > 0.5 ? 'offbeat' : 'kb3';
    } else if (section.name === 'CLIMAX') {
      bassStyle = 'syncopated';
    } else {
      bassStyle = bassStyles[this.rng.int(0, 3)];
    }

    const bassPattern = generateBassPattern(ctx.rootPc, ctx.scale, {
      style: bassStyle,
      rootDegree: 0,
      passingProb: 0.2 + ctx.novelty * 0.2,
      octave: 2,
      seed: this.rng.int(1, 100000),
    });

    // ── Rhythm patterns ──
    let kickPattern = psyKick();
    let hatPattern = offbeatHats();

    // Vary rhythm based on section and syncopation
    if (ctx.syncopation > 0.4 || section.name === 'CONTRAST') {
      hatPattern = combine(hatPattern, drivingHats(16));
    }
    if (section.name === 'CLIMAX' || section.name === 'DEVELOPMENT2') {
      hatPattern = combine(hatPattern, drivingHats(16));
    }
    if (ctx.syncopation > 0.5) {
      hatPattern = swing(hatPattern, 0.15);
    }

    // ── Tension curve ──
    const tensionCurves: TensionCurve[] = ['flat', 'build', 'release', 'peak', 'valley'];
    let tensionCurve: TensionCurve;
    if (section.name === 'INTRO') tensionCurve = 'build';
    else if (section.name === 'CLIMAX') tensionCurve = 'peak';
    else if (section.name === 'RESOLUTION') tensionCurve = 'release';
    else if (section.name === 'CONTRAST') tensionCurve = 'valley';
    else tensionCurve = tensionCurves[this.rng.int(0, 4)];

    // ── Register (octave) based on tension ──
    const register = Math.max(0, Math.min(1, ctx.tension));

    const plan: PhrasePlan = {
      phraseIndex,
      startBar,
      endBar,
      section,
      motif,
      bassStyle,
      bassPattern,
      kickPattern,
      hatPattern,
      tensionCurve,
      density: section.density,
      syncopation: ctx.syncopation,
      register,
      isTransformed,
      transformType,
    };

    this.currentPlan = plan;
    return plan;
  }

  getCurrentPlan(): PhrasePlan | null {
    return this.currentPlan;
  }

  /**
   * Check if we need a new plan (every 8 bars).
   */
  needsNewPlan(currentBar: number): boolean {
    if (!this.currentPlan) return true;
    return currentBar >= this.currentPlan.endBar;
  }

  reset(): void {
    this.currentPlan = null;
    this.lastNewMotifBar = -100;
    this.lastTransformBar = -100;
    this.rng = new Rng(42);
  }
}
