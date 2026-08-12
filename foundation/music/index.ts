/**
 * foundation/music — Musical Intelligence Layer
 *
 * F8 ARCHITECTURAL RESET:
 * - ONE composer (MusicalSession)
 * - NO feature flags
 * - NO legacy path
 * - Planning separated from scheduling
 *
 * Chain:
 *   Radio → RadioMusicalWindow → MusicalContext → MusicalSession.planBar()
 *     → NotePlan (cached per bar) → Scheduler → Audio
 */

export { MusicalSession } from './MusicalSession';
export type { ScheduledNote, NotePlan, SessionSnapshot } from './MusicalSession';
export { MusicalContext, COMPOSITION_ARC } from './MusicalContext';
export type { MusicalContextSnapshot, SectionArc } from './MusicalContext';
export { MusicalMemory } from './MusicalMemory';
export type { StoredMotif, PhraseRecord, MusicalMemorySnapshot } from './MusicalMemory';
export { RadioMusicalWindow } from './RadioMusicalWindow';
export type { RadioWindowSnapshot } from './RadioMusicalWindow';

// Primitives
export * from './primitives/scales';
export * from './primitives/motif';
// F14/R9: Removed dead primitives (bass, chords, rhythm) — never imported.
export { Rng } from './primitives/rng';
