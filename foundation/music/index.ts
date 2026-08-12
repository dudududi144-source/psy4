/**
 * foundation/music — Musical Intelligence Layer
 *
 * F7: Complete live learning loop with radio-coupled musical intelligence.
 *
 * Chain:
 *   Radio → RadioMusicalWindow → MusicalContext → MusicalIntent
 *     → MusicalMemory → CompositionPlanner → LiveComposer.planBar()
 *     → NotePlan → Scheduler → Audio → evaluate → reward → memory update ↺
 */

export { MusicalContext, COMPOSITION_ARC } from './MusicalContext';
export type { MusicalContextSnapshot, SectionArc } from './MusicalContext';
export { MusicalMemory } from './MusicalMemory';
export type { StoredMotif, PhraseRecord, MusicalMemorySnapshot } from './MusicalMemory';
export { MusicalIntent } from './MusicalIntent';
export type { MusicalDecision, MusicalRole, PhraseAction, MusicalIntentSnapshot } from './MusicalIntent';
export { RadioMusicalWindow } from './RadioMusicalWindow';
export type { RadioWindowSnapshot } from './RadioMusicalWindow';
export { CompositionPlanner } from './CompositionPlanner';
export type { PhrasePlan } from './CompositionPlanner';
export { LiveComposer } from './LiveComposer';
export type { ScheduledNote, NotePlan, LiveComposerSnapshot } from './LiveComposer';

// Re-export primitives
export * from './primitives/scales';
export * from './primitives/motif';
export * from './primitives/rhythm';
export * from './primitives/bass';
export * from './primitives/chords';
export { Rng } from './primitives/rng';
