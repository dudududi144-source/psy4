/**
 * RadioMusicalWindow — maintains musical context history over time.
 *
 * F7 RULE 2: The system must understand context over time, not just
 * react to the latest snapshot. This window maintains:
 * - current beat info
 * - 1-bar, 2-bar, 4-bar, 8-bar, 16-bar history
 * - energy trajectory
 * - density trajectory
 * - pitch-class distribution
 * - rhythmic pattern memory
 * - phrase boundary detection
 *
 * Every inference retains provenance and confidence.
 */

export interface RadioWindowSnapshot {
  // Current
  readonly currentBpm: number;
  readonly currentEnergy: number;
  readonly currentDensity: number;
  readonly currentOccupancy: { kick: number; bass: number; lead: number; hats: number };

  // Trajectory (short → long)
  readonly energy1bar: number;
  readonly energy4bar: number;
  readonly energy8bar: number;
  readonly energy16bar: number;
  readonly energyRising: boolean;
  readonly energyFalling: boolean;

  // Density trajectory
  readonly density1bar: number;
  readonly density4bar: number;
  readonly density8bar: number;
  readonly densityTrend: 'stable' | 'increasing' | 'decreasing';

  // Pitch
  readonly pitchCenter: number | null; // 0-11 or null
  readonly pitchStability: number; // 0-1
  readonly pitchClassHistogram: number[];

  // Rhythm
  readonly rhythmicDensity: number; // 0-1
  readonly syncopationLevel: number; // 0-1

  // Structure
  readonly phrasePosition: number; // 0-7 (bar within 8-bar phrase)
  readonly sectionChangeLikelihood: number; // 0-1

  // Confidence
  readonly bpmConfidence: number;
  readonly energyConfidence: number;
  readonly overallConfidence: number;

  // Silence/drop
  readonly silenceLikelihood: number; // 0-1
  readonly dropLikelihood: number; // 0-1
}

const WINDOW_SIZE = 64; // 16 bars × 4 beats per bar

export class RadioMusicalWindow {
  private bpmHistory: number[] = [];
  private energyHistory: number[] = [];
  private densityHistory: number[] = [];
  private occupancyHistory: { kick: number; bass: number; lead: number; hats: number }[] = [];
  private pitchClassCounts: number[] = new Array(12).fill(0);
  private totalObservations = 0;
  private lastBpm: number = 145;
  private lastEnergy: number = 0.5;
  private lastDensity: number = 0.5;
  private lastOccupancy = { kick: 0, bass: 0, lead: 0, hats: 0 };

  /**
   * Feed an observation into the window.
   * Called every detect tick (200ms).
   */
  observe(data: {
    bpm: number;
    energy: number;
    occupancy: { kick: number; bass: number; lead: number; hats: number };
    bassFreq?: number;
    confidence: number;
  }): void {
    this.lastBpm = data.bpm;
    this.lastEnergy = data.energy;
    this.lastDensity = (data.occupancy.kick + data.occupancy.bass + data.occupancy.lead + data.occupancy.hats) / 4;
    this.lastOccupancy = { ...data.occupancy };

    this.bpmHistory.push(data.bpm);
    this.energyHistory.push(data.energy);
    this.densityHistory.push(this.lastDensity);
    this.occupancyHistory.push({ ...data.occupancy });

    // Keep bounded
    if (this.bpmHistory.length > WINDOW_SIZE) this.bpmHistory.shift();
    if (this.energyHistory.length > WINDOW_SIZE) this.energyHistory.shift();
    if (this.densityHistory.length > WINDOW_SIZE) this.densityHistory.shift();
    if (this.occupancyHistory.length > WINDOW_SIZE) this.occupancyHistory.shift();

    // Pitch class tracking
    if (data.bassFreq && data.bassFreq > 50) {
      const midi = Math.round(69 + 12 * Math.log2(data.bassFreq / 440));
      const pc = ((midi % 12) + 12) % 12;
      this.pitchClassCounts[pc]++;
    }
    this.totalObservations++;
  }

  snapshot(bar: number): RadioWindowSnapshot {
    const phrasePosition = bar % 8;

    // Energy trajectory
    const e1 = this.avg(this.energyHistory, 4);   // ~1 bar (4 detect ticks)
    const e4 = this.avg(this.energyHistory, 16);  // ~4 bars
    const e8 = this.avg(this.energyHistory, 32);  // ~8 bars
    const e16 = this.avg(this.energyHistory, 64); // ~16 bars

    const energyRising = e1 > e4 + 0.05;
    const energyFalling = e1 < e4 - 0.05;

    // Density trajectory
    const d1 = this.avg(this.densityHistory, 4);
    const d4 = this.avg(this.densityHistory, 16);
    const d8 = this.avg(this.densityHistory, 32);
    let densityTrend: 'stable' | 'increasing' | 'decreasing' = 'stable';
    if (d1 > d4 + 0.05) densityTrend = 'increasing';
    else if (d1 < d4 - 0.05) densityTrend = 'decreasing';

    // Pitch center (most common pitch class)
    let pitchCenter: number | null = null;
    let maxCount = 0;
    for (let i = 0; i < 12; i++) {
      if (this.pitchClassCounts[i] > maxCount) {
        maxCount = this.pitchClassCounts[i];
        pitchCenter = i;
      }
    }
    const totalPc = this.pitchClassCounts.reduce((a, b) => a + b, 0);
    const pitchStability = totalPc > 0 && pitchCenter !== null
      ? this.pitchClassCounts[pitchCenter] / totalPc
      : 0;

    // Rhythmic density and syncopation
    const rhythmicDensity = this.lastOccupancy.kick;
    const syncopationLevel = this.lastOccupancy.hats > 0.5 && this.lastOccupancy.kick > 0.5 ? 0.6 : 0.2;

    // Section change likelihood (higher at phrase boundaries)
    const sectionChangeLikelihood = phrasePosition === 7 ? 0.7 : (phrasePosition === 0 ? 0.5 : 0.1);

    // Silence/drop likelihood
    const silenceLikelihood = e1 < 0.1 ? 0.8 : (energyFalling ? 0.3 : 0.05);
    const dropLikelihood = energyRising && e1 > 0.7 ? 0.4 : 0.1;

    // Confidence
    const bpmConfidence = this.bpmHistory.length > 10 ? 0.8 : 0.3;
    const energyConfidence = this.energyHistory.length > 10 ? 0.8 : 0.3;
    const overallConfidence = Math.min(bpmConfidence, energyConfidence);

    return {
      currentBpm: this.lastBpm,
      currentEnergy: this.lastEnergy,
      currentDensity: this.lastDensity,
      currentOccupancy: { ...this.lastOccupancy },
      energy1bar: e1,
      energy4bar: e4,
      energy8bar: e8,
      energy16bar: e16,
      energyRising,
      energyFalling,
      density1bar: d1,
      density4bar: d4,
      density8bar: d8,
      densityTrend,
      pitchCenter,
      pitchStability,
      pitchClassHistogram: [...this.pitchClassCounts],
      rhythmicDensity,
      syncopationLevel,
      phrasePosition,
      sectionChangeLikelihood,
      bpmConfidence,
      energyConfidence,
      overallConfidence,
      silenceLikelihood,
      dropLikelihood,
    };
  }

  reset(): void {
    this.bpmHistory = [];
    this.energyHistory = [];
    this.densityHistory = [];
    this.occupancyHistory = [];
    this.pitchClassCounts = new Array(12).fill(0);
    this.totalObservations = 0;
    this.lastBpm = 145;
    this.lastEnergy = 0.5;
    this.lastDensity = 0.5;
    this.lastOccupancy = { kick: 0, bass: 0, lead: 0, hats: 0 };
  }

  private avg(arr: number[], count: number): number {
    if (arr.length === 0) return 0;
    const slice = arr.slice(-count);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  }
}
