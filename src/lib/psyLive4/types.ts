// src/lib/psyLive4/types.ts
// Canonical types for the PSY4 rebuild (Layer 3 — HOST).
// These are the ONLY types the scheduler, composer, and host exchange.
// Devices (Layer 2) receive these via the PsyDevice.onEvent contract.

import type { MusicalEvent } from '@/lib/psy-foundation-shim/protocol';

// ── Roles ────────────────────────────────────────────────────────────────
// Single source of truth. SynthRole covers BOTH melodic (psysynth) and
// drum (psy4-engine-v3) roles. The host routes by membership in DRUM_ROLES.
export type SynthRole =
  | 'bass' | 'lead' | 'acid' | 'pad' | 'keys'      // melodic → psysynth
  | 'kick' | 'hat' | 'clap' | 'perc' | 'snare';     // drum → worklet

export const DRUM_ROLES: ReadonlySet<SynthRole> = new Set([
  'kick', 'hat', 'clap', 'perc', 'snare',
]);

export const MELODIC_ROLES: ReadonlySet<SynthRole> = new Set([
  'bass', 'lead', 'acid', 'pad', 'keys',
]);

// ── Styles ───────────────────────────────────────────────────────────────
export type MusicalStyle =
  | 'FULL_ON' | 'DARK' | 'PROGRESSIVE' | 'ACID'
  | 'GOA' | 'HI_TECH' | 'FOREST';

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
}

export interface ComposerContinuity {
  lastBassNote: number;
  barInArrangement: number;
  motifStep: number;
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
