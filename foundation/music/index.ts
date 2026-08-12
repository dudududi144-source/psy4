/**
 * foundation/music — Musical Intelligence Layer
 *
 * F5: Live learning loop that connects radio observations to musical output.
 *
 * Chain:
 *   RadioObservationLayer → LiveComposer.observeRadio()
 *   → MusicalContext (key, scale, energy, tension, phrase position)
 *   → CompositionPlanner (8-bar plans with motif/bass/rhythm)
 *   → MotifMemory (extract, store, transform motifs)
 *   → LiveComposer.planBar() → NotePlan → Scheduler
 *
 * The scheduler reads NotePlan instead of hardcoded presets.
 */

export { MusicalContext, COMPOSITION_ARC } from './MusicalContext';
export type { MusicalContextSnapshot, SectionArc } from './MusicalContext';
export { MotifMemory } from './MotifMemory';
export type { StoredMotif, MotifTransformType, MotifMemorySnapshot } from './MotifMemory';
export { CompositionPlanner } from './CompositionPlanner';
export type { PhrasePlan } from './CompositionPlanner';
export { LiveComposer } from './LiveComposer';
export type { ScheduledNote, NotePlan, LiveComposerSnapshot } from './LiveComposer';

// Re-export primitives for convenience
export * from './primitives/scales';
export * from './primitives/motif';
export * from './primitives/rhythm';
export * from './primitives/bass';
export * from './primitives/chords';
export { Rng } from './primitives/rng';
