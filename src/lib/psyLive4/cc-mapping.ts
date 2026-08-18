// src/lib/psyLive4/cc-mapping.ts
// Maps a cutoff frequency in Hz to a psysynth CC74 value (0..1).
//
// psysynth interprets CC74 via ccFactor = 0.25 + cc * 1.5 (range 0.25..1.75).
//   cc=0.30 → 0.70  (darker)
//   cc=0.50 → 1.00  (neutral, ~632 Hz)
//   cc=0.90 → 1.60  (brighter)
//
// Log scale: covers 80 Hz (darkest) to 8000 Hz (brightest), giving the
// learning loop + style banks room to move timbre in BOTH directions.

export function freqHzToCC74(hz: number): number {
  if (!Number.isFinite(hz) || hz <= 0) return 0.5;
  const lo = 80;
  const hi = 8000;
  const t = (Math.log(hz) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
  return Math.max(0.30, Math.min(0.90, 0.30 + t * 0.60));
}
