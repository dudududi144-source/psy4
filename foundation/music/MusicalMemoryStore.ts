/**
 * MusicalMemoryStore — causal musical memory.
 *
 * Tracks material identity and lifecycle across bars/sections.
 * Memory affects future decisions: familiarity, exhaustion, anticipation,
 * callback justification all depend on what the listener has heard.
 *
 * This is NOT an event log. It is a set of material states + relationships
 * that the InferenceEngine reasons over.
 */

export type MaterialLifecycleState =
  | 'introduced'      // played once
  | 'established'     // repeated enough for identity
  | 'repeated'        // played multiple times
  | 'transformed'     // has been varied/fragmented
  | 'withheld'        // removed after establishment
  | 'unresolved'      // asked a question (varied, called)
  | 'exhausted'       // repeated beyond threshold
  | 'recalled'        // returned after withholding
;

/** Thresholds for lifecycle transitions. */
const ESTABLISHED_REPETITIONS = 3;   // after 3 plays, material is "established"
const EXHAUSTED_REPETITIONS = 8;     // after 8 plays, material is "exhausted"

export interface MaterialMemoryEntry {
  /** Unique material identity (e.g., "motif-A", "groove", "counterline-1"). */
  materialId: string;
  /** Current lifecycle state. */
  lifecycleState: MaterialLifecycleState;
  /** How many times played. */
  playCount: number;
  /** First bar played. */
  introducedAtBar: number;
  /** Last bar played. */
  lastPlayedBar: number;
  /** Transformation lineage — if derived, the source materialId. */
  derivedFrom: string | null;
  /** What transform was applied (if any). */
  transformHistory: string[];
  /** Material this one answers (call/response). */
  answersMaterialId: string | null;
  /** Material this one contrasts with. */
  contrastsWithMaterialId: string | null;
  /** Bar withheld (if currently withheld). */
  withheldAtBar: number | null;
}

export class MusicalMemoryStore {
  private readonly materials = new Map<string, MaterialMemoryEntry>();

  /**
   * Register that material was played at a given bar.
   * Updates lifecycle state based on play count.
   */
  onMaterialPlayed(materialId: string, bar: number): MaterialMemoryEntry {
    let entry = this.materials.get(materialId);
    if (!entry) {
      entry = {
        materialId,
        lifecycleState: 'introduced',
        playCount: 0,
        introducedAtBar: bar,
        lastPlayedBar: bar,
        derivedFrom: null,
        transformHistory: [],
        answersMaterialId: null,
        contrastsWithMaterialId: null,
        withheldAtBar: null,
      };
      this.materials.set(materialId, entry);
    }

    entry.playCount += 1;
    entry.lastPlayedBar = bar;

    // Update lifecycle based on play count
    if (entry.lifecycleState === 'introduced' && entry.playCount >= ESTABLISHED_REPETITIONS) {
      entry.lifecycleState = 'established';
    } else if (entry.lifecycleState === 'established' && entry.playCount >= EXHAUSTED_REPETITIONS) {
      entry.lifecycleState = 'exhausted';
    } else if (entry.lifecycleState === 'introduced' && entry.playCount >= 2) {
      entry.lifecycleState = 'repeated';
    } else if (entry.lifecycleState === 'repeated' && entry.playCount >= ESTABLISHED_REPETITIONS) {
      entry.lifecycleState = 'established';
    }

    // If it was withheld and is now playing again, it's recalled
    if (entry.lifecycleState === 'withheld') {
      entry.lifecycleState = 'recalled';
      entry.withheldAtBar = null;
    }

    return entry;
  }

  /**
   * Register that material was varied/transformed.
   */
  onMaterialTransformed(
    materialId: string,
    bar: number,
    transform: string,
    derivedFromId?: string
  ): MaterialMemoryEntry {
    let entry = this.materials.get(materialId);
    if (!entry) {
      // Transforming a material we haven't seen — register it first
      entry = this.onMaterialPlayed(materialId, bar);
    }

    entry.lifecycleState = 'transformed';
    entry.transformHistory.push(transform);
    if (derivedFromId) {
      entry.derivedFrom = derivedFromId;
    }

    // Transformed material is unresolved (asks a question)
    entry.lifecycleState = 'unresolved';

    return entry;
  }

  /**
   * Register that material was withheld (removed for anticipation).
   */
  onMaterialWithheld(materialId: string, bar: number): MaterialMemoryEntry {
    let entry = this.materials.get(materialId);
    if (!entry) {
      // Can't withhold unknown material — create a stub
      entry = this.onMaterialPlayed(materialId, bar);
    }

    entry.lifecycleState = 'withheld';
    entry.withheldAtBar = bar;
    return entry;
  }

  /**
   * Register that material returned (callback/payoff).
   */
  onMaterialRecalled(materialId: string, bar: number): MaterialMemoryEntry {
    let entry = this.materials.get(materialId);
    if (!entry) {
      entry = this.onMaterialPlayed(materialId, bar);
    }

    entry.lifecycleState = 'recalled';
    entry.withheldAtBar = null;
    entry.lastPlayedBar = bar;
    entry.playCount += 1;
    return entry;
  }

  /**
   * Register a response relationship (A answers B).
   */
  setResponse(answerId: string, questionId: string): void {
    const answer = this.materials.get(answerId);
    if (answer) {
      answer.answersMaterialId = questionId;
      // The question is now resolved
      const question = this.materials.get(questionId);
      if (question && question.lifecycleState === 'unresolved') {
        question.lifecycleState = 'established'; // resolved back to established
      }
    }
  }

  /**
   * Register a contrast relationship.
   */
  setContrast(materialA: string, materialB: string): void {
    const a = this.materials.get(materialA);
    if (a) a.contrastsWithMaterialId = materialB;
  }

  /**
   * Query: is material established (ready for variation/callback)?
   * Returns true for any material that has been played enough to have identity,
   * including withheld material (it was established, then removed).
   */
  isEstablished(materialId: string): boolean {
    const entry = this.materials.get(materialId);
    if (!entry) return false;
    return ['established', 'repeated', 'exhausted', 'transformed', 'unresolved', 'recalled', 'withheld']
      .includes(entry.lifecycleState);
  }

  /**
   * Query: is material exhausted (needs transformation)?
   */
  isExhausted(materialId: string): boolean {
    const entry = this.materials.get(materialId);
    return entry?.lifecycleState === 'exhausted';
  }

  /**
   * Query: is material withheld (pending return)?
   */
  isWithheld(materialId: string): boolean {
    const entry = this.materials.get(materialId);
    return entry?.lifecycleState === 'withheld';
  }

  /**
   * Query: is material unresolved (asked a question)?
   */
  isUnresolved(materialId: string): boolean {
    const entry = this.materials.get(materialId);
    return entry?.lifecycleState === 'unresolved';
  }

  /**
   * Query: get all materials in a given lifecycle state.
   */
  getByLifecycle(state: MaterialLifecycleState): MaterialMemoryEntry[] {
    return Array.from(this.materials.values()).filter((e) => e.lifecycleState === state);
  }

  /**
   * Query: get a material entry.
   */
  get(materialId: string): MaterialMemoryEntry | undefined {
    return this.materials.get(materialId);
  }

  /**
   * Get all known material IDs.
   */
  getMaterialIds(): string[] {
    return Array.from(this.materials.keys());
  }

  /**
   * Snapshot for logging/testing.
   */
  snapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [id, entry] of this.materials) {
      result[id] = { ...entry };
    }
    return result;
  }

  /**
   * Reset memory (for testing).
   */
  clear(): void {
    this.materials.clear();
  }
}
