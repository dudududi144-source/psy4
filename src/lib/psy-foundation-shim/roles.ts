// src/lib/psy-foundation-shim/roles.ts
// Role definitions — shared between devices and host.
// This lives in the foundation shim layer so devices don't depend on the host.

export type SynthRole =
  | 'bass' | 'lead' | 'acid' | 'pad' | 'keys'      // melodic → psysynth
  | 'kick' | 'hat' | 'clap' | 'perc' | 'snare';     // drum → worklet

export const DRUM_ROLES: ReadonlySet<SynthRole> = new Set([
  'kick', 'hat', 'clap', 'perc', 'snare',
]);

export const MELODIC_ROLES: ReadonlySet<SynthRole> = new Set([
  'bass', 'lead', 'acid', 'pad', 'keys',
]);

export type MusicalStyle =
  | 'FULL_ON' | 'DARK' | 'PROGRESSIVE' | 'ACID'
  | 'GOA' | 'HI_TECH' | 'FOREST';
