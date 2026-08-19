// src/lib/psyLive4/types.ts
// Canonical types for the PSY4 rebuild (Layer 3 — HOST).
// Re-exports role definitions from the foundation shim (no circular deps).

export type { SynthRole, MusicalStyle } from '@/lib/psy-foundation-shim/roles';
export { DRUM_ROLES, MELODIC_ROLES } from '@/lib/psy-foundation-shim/roles';
import type { SynthRole, MusicalStyle } from '@/lib/psy-foundation-shim/roles';
import type { MusicalEvent } from '@/lib/psy-foundation-shim/protocol';

// ── NoteEvent ────────────────────────────────────────────────────────────
// This is the composer's output. The host converts each NoteEvent into a
// MusicalEvent ('note' variant) before sending to a device.
//
// CRITICAL: `at` is ALWAYS absolute AudioContext time in seconds.
// Never relative to a bar, beat, or "startTime". This is the structural fix
// for the "engine stops" bug — no bar-index drift.
export interface NoteEvent {
  at: number;        // absolute seconds (AudioContext.currentTime frame)
  role: SynthRole;
  note: number;      // MIDI 0..127 (drums use a convention, e.g. 36=kick)
  velocity: number;  // 0..1
  duration: number;  // seconds; -1 = hold until next note-off
}

// ── ComposeRequest / ComposeResult ──────────────────────────────────────
// The composer is a pure function: (req) → result. No state between calls
// except what's explicitly threaded through `prev` / `next`.
export interface ComposeRequest {
  startTime: number;   // absolute seconds — window start
  duration: number;    // seconds — window length
  bpm: number;
  style: MusicalStyle;
  energy: number;      // 0..1
  seed: number;        // deterministic per session
  prev: ComposerContinuity | null;
  // DEEP GAP A step 2: pattern memory bias — the host passes the top
  // high-reward bar fingerprints so the composer can bias note selection
  // toward notes that sounded good in the past. This is the feedback path
  // from learning → composition.
  preferredNotes?: PreferredNoteSet;
}

/**
 * DEEP GAP A step 2: preferred notes from pattern memory.
 * The host extracts these from the learner's pattern memory (top-N highest-reward
 * bars) and passes them to the composer. The composer slightly biases toward
 * these notes when choosing bass/lead notes.
 *
 * This is a SOFT bias — the composer still generates new patterns, but
 * it slightly prefers notes that worked well in the past. Over time, the
 * engine's composition converges toward patterns that sound good.
 */
export interface PreferredNoteSet {
  bassNotes: Set<number>;     // MIDI notes that were in high-reward bass lines
  leadNotes: Set<number>;     // MIDI notes that were in high-reward lead lines
  avgEnergy: number;          // average energy of high-reward bars (0..1)
}

export interface ComposerContinuity {
  lastBassNote: number;
  barInArrangement: number;
  motifStep: number;
  // PHASE 5.6: EvolvingSequence — mutable motif pattern (semitone offsets).
  // One step mutates by ±2 every 4 bars. Threaded through continuity so the
  // motif evolves across the whole session, not just per compose call.
  motifPattern: number[];
  // PHASE 5.6: counter for mutation timing (every 4 bars)
  barsSinceLastMutation: number;
}

export interface ComposeResult {
  events: NoteEvent[];   // sorted by `at` ascending
  next: ComposerContinuity;
}

export interface Composer {
  compose(req: ComposeRequest): ComposeResult;
}

// ── Host → Device conversion ─────────────────────────────────────────────
// Convert a NoteEvent (host-internal) to a MusicalEvent (foundation contract).
export function toMusicalEvent(e: NoteEvent): MusicalEvent {
  return {
    type: 'note',
    at: e.at,
    note: e.note,
    velocity: e.velocity,
    duration: e.duration,
    channel: e.role,     // SynthRole maps directly to psysynth channel
  } as MusicalEvent;
}
