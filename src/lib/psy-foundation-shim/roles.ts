// src/lib/psy-foundation-shim/roles.ts
// Role definitions — shared between devices and host.
// This lives in the foundation shim layer so devices don't depend on the host.
//
// PHASE 2 FIX (double-play bug): the old MELODIC_ROLES set included lead/acid,
// which melodic-device (psysynth) accepted AND lead-device (lead worklet) also
// accepted. The host broadcasts every event to ALL devices, so each lead/acid
// note hit BOTH → ~6dB phantom boost + phase artifacts. Split melodic roles
// into PSYSYNTH_ROLES (→ melodic-device) and WORKLET_MELODIC_ROLES (→ lead-device)
// so each role routes to exactly ONE device. MELODIC_ROLES is kept as the union
// for backward compat (capabilities aggregation) but must NOT be used for
// per-device event filtering.

export type SynthRole =
  | 'bass' | 'pad' | 'keys'             // melodic → psysynth (Web Audio)
  | 'lead' | 'acid'                       // melodic → lead worklet (custom DSP)
  | 'kick' | 'hat' | 'clap' | 'perc' | 'snare';  // drum → drum worklet

// Drums → drum worklet (psy4-engine-v3.js)
export const DRUM_ROLES: ReadonlySet<SynthRole> = new Set([
  'kick', 'hat', 'clap', 'perc', 'snare',
]);

// Phase 2: roles routed to melodic-device (psysynth, native Web Audio).
// lead/acid are EXCLUDED — they go to the lead worklet instead.
export const PSYSYNTH_ROLES: ReadonlySet<SynthRole> = new Set([
  'bass', 'pad', 'keys',
]);

// Phase 2: roles routed to lead-device (psy4-lead-worklet.js, custom DSP).
export const WORKLET_MELODIC_ROLES: ReadonlySet<SynthRole> = new Set([
  'lead', 'acid',
]);

// DEPRECATED: the union of PSYSYNTH_ROLES + WORKLET_MELODIC_ROLES.
// Do NOT use this for per-device event filtering — it causes double-play.
// Kept only for capabilities aggregation / backward compat.
export const MELODIC_ROLES: ReadonlySet<SynthRole> = new Set([
  'bass', 'lead', 'acid', 'pad', 'keys',
]);

export type MusicalStyle =
  | 'FULL_ON' | 'DARK' | 'PROGRESSIVE' | 'ACID'
  | 'GOA' | 'HI_TECH' | 'FOREST';
