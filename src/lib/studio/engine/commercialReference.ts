/**
 * Commercial Reference Engine — defines what professional psytrance sounds like.
 *
 * PSY3 is NOT the benchmark. PSY3 is a knowledge source (DSP algorithms, techniques).
 * The benchmark is COMMERCIAL PSYTRANCE — professionally produced, released tracks.
 *
 * This module defines target ranges for commercial psytrance based on:
 * - Professional production standards (LUFS, true-peak, spectral balance)
 * - Genre conventions (kick/sub relationship, bass frequency, lead brightness)
 * - Psychoacoustic principles (mono low-end, stereo width above 200Hz)
 * - Mastering standards (streaming loudness, crest factor)
 *
 * These targets are NOT from PSY3 — they are from the real world of commercial
 * psytrance production (Astrix, Infected Mushroom, Vini Vici, Ajja, etc.)
 */

// ─── Commercial Target Ranges ─────────────────────────────────────────────
// Based on professional psytrance production standards.
// These are RANGES, not exact values — different tracks fall within these.

export interface TargetRange {
  min: number;
  ideal: number;
  max: number;
  unit: string;
}

export interface SpectralBalance {
  sub: TargetRange;        // 20-60Hz
  low: TargetRange;        // 60-200Hz
  lowMid: TargetRange;     // 200-800Hz
  mid: TargetRange;        // 800-3000Hz
  highMid: TargetRange;    // 3000-6000Hz
  high: TargetRange;       // 6000-12000Hz
  air: TargetRange;        // 12000-20000Hz
}

// ─── Per-Genre Commercial Targets ─────────────────────────────────────────

export interface GenreTargets {
  id: string;
  name: string;
  bpmRange: [number, number];

  // Loudness targets (streaming-standard)
  lufs: TargetRange;       // Integrated loudness
  truePeak: TargetRange;   // True peak (dBTP)
  crestFactor: TargetRange;// Peak-to-RMS ratio

  // Spectral balance (% of total energy)
  spectral: SpectralBalance;

  // Kick targets
  kick: {
    fundamental: TargetRange;  // Hz (where the kick's sub sits)
    subEnergy: TargetRange;    // % of kick energy in 20-60Hz
    bodyEnergy: TargetRange;   // % in 60-200Hz
    clickEnergy: TargetRange;  // % in 2000-6000Hz
    decay: TargetRange;        // seconds
    subBodyRatio: TargetRange; // sub/body ratio (>1 = sub-dominant)
  };

  // Bass targets
  bass: {
    fundamental: TargetRange;  // Hz (bass note frequency)
    subEnergy: TargetRange;
    bodyEnergy: TargetRange;
    harmonicContent: TargetRange; // % in 200-800Hz
    decay: TargetRange;
    stereoWidth: TargetRange;  // bass should be mono below 120Hz
  };

  // Lead targets
  lead: {
    fundamental: TargetRange;
    brightness: TargetRange;   // spectral centroid
    harshnessLimit: TargetRange; // max energy in 3-6kHz (avoid harshness)
    stereoWidth: TargetRange;
  };

  // Stereo targets
  stereo: {
    lowEndMonoFreq: number;    // Hz — below this, everything mono
    widthBelow200: TargetRange; // 0-1 (0=mono, 1=full stereo)
    widthAbove2000: TargetRange;
    correlationLow: TargetRange; // should be near 1.0 (mono)
    correlationHigh: TargetRange;
  };

  // Dynamic targets
  dynamics: {
    transientDensity: TargetRange; // transients per second
    rmsVariance: TargetRange;      // dynamic range
    sectionContrast: TargetRange;  // dB difference between sections
  };

  // Arrangement targets
  arrangement: {
    introBars: TargetRange;
    buildBars: TargetRange;
    dropBars: TargetRange;
    breakBars: TargetRange;
    totalMinutes: TargetRange;
  };
}

// ─── Commercial Psytrance Genre Targets ───────────────────────────────────
// These are based on professional production standards, NOT PSY3.

export const COMMERCIAL_TARGETS: Record<string, GenreTargets> = {
  'progressive-psy': {
    id: 'progressive-psy',
    name: 'Progressive Psy',
    bpmRange: [125, 138],
    lufs: { min: -12, ideal: -10, max: -8, unit: 'LUFS' },
    truePeak: { min: -2.0, ideal: -1.5, max: -1.0, unit: 'dBTP' },
    crestFactor: { min: 6, ideal: 8, max: 12, unit: 'dB' },
    spectral: {
      sub: { min: 15, ideal: 22, max: 30, unit: '%' },
      low: { min: 10, ideal: 15, max: 20, unit: '%' },
      lowMid: { min: 12, ideal: 18, max: 25, unit: '%' },
      mid: { min: 15, ideal: 20, max: 28, unit: '%' },
      highMid: { min: 8, ideal: 12, max: 18, unit: '%' },
      high: { min: 5, ideal: 8, max: 12, unit: '%' },
      air: { min: 2, ideal: 5, max: 8, unit: '%' },
    },
    kick: {
      fundamental: { min: 48, ideal: 52, max: 56, unit: 'Hz' },
      subEnergy: { min: 70, ideal: 85, max: 95, unit: '%' },
      bodyEnergy: { min: 5, ideal: 12, max: 25, unit: '%' },
      clickEnergy: { min: 0.5, ideal: 2, max: 5, unit: '%' },
      decay: { min: 0.15, ideal: 0.22, max: 0.30, unit: 's' },
      subBodyRatio: { min: 3, ideal: 7, max: 15, unit: 'ratio' },
    },
    bass: {
      fundamental: { min: 65, ideal: 82, max: 110, unit: 'Hz' },
      subEnergy: { min: 40, ideal: 55, max: 70, unit: '%' },
      bodyEnergy: { min: 20, ideal: 30, max: 40, unit: '%' },
      harmonicContent: { min: 5, ideal: 15, max: 25, unit: '%' },
      decay: { min: 0.10, ideal: 0.15, max: 0.20, unit: 's' },
      stereoWidth: { min: 0, ideal: 0.05, max: 0.15, unit: '0-1' },
    },
    lead: {
      fundamental: { min: 330, ideal: 440, max: 660, unit: 'Hz' },
      brightness: { min: 1500, ideal: 2500, max: 4000, unit: 'Hz' },
      harshnessLimit: { min: 5, ideal: 10, max: 15, unit: '%' },
      stereoWidth: { min: 0.3, ideal: 0.5, max: 0.7, unit: '0-1' },
    },
    stereo: {
      lowEndMonoFreq: 120,
      widthBelow200: { min: 0, ideal: 0.05, max: 0.15, unit: '0-1' },
      widthAbove2000: { min: 0.4, ideal: 0.6, max: 0.8, unit: '0-1' },
      correlationLow: { min: 0.8, ideal: 0.95, max: 1.0, unit: '0-1' },
      correlationHigh: { min: 0.0, ideal: 0.3, max: 0.6, unit: '0-1' },
    },
    dynamics: {
      transientDensity: { min: 2, ideal: 4, max: 8, unit: '/s' },
      rmsVariance: { min: 3, ideal: 6, max: 10, unit: 'dB' },
      sectionContrast: { min: 4, ideal: 8, max: 12, unit: 'dB' },
    },
    arrangement: {
      introBars: { min: 16, ideal: 32, max: 64, unit: 'bars' },
      buildBars: { min: 8, ideal: 16, max: 32, unit: 'bars' },
      dropBars: { min: 16, ideal: 32, max: 64, unit: 'bars' },
      breakBars: { min: 8, ideal: 16, max: 32, unit: 'bars' },
      totalMinutes: { min: 5, ideal: 7, max: 9, unit: 'min' },
    },
  },

  'dark-psy': {
    id: 'dark-psy',
    name: 'Dark Psy',
    bpmRange: [145, 160],
    lufs: { min: -11, ideal: -9, max: -7, unit: 'LUFS' },
    truePeak: { min: -1.5, ideal: -1.0, max: -0.5, unit: 'dBTP' },
    crestFactor: { min: 5, ideal: 7, max: 10, unit: 'dB' },
    spectral: {
      sub: { min: 18, ideal: 25, max: 35, unit: '%' },
      low: { min: 8, ideal: 12, max: 18, unit: '%' },
      lowMid: { min: 10, ideal: 15, max: 22, unit: '%' },
      mid: { min: 12, ideal: 18, max: 25, unit: '%' },
      highMid: { min: 8, ideal: 12, max: 18, unit: '%' },
      high: { min: 6, ideal: 10, max: 15, unit: '%' },
      air: { min: 2, ideal: 4, max: 7, unit: '%' },
    },
    kick: {
      fundamental: { min: 45, ideal: 48, max: 52, unit: 'Hz' },
      subEnergy: { min: 75, ideal: 88, max: 95, unit: '%' },
      bodyEnergy: { min: 4, ideal: 10, max: 20, unit: '%' },
      clickEnergy: { min: 0.5, ideal: 1.5, max: 4, unit: '%' },
      decay: { min: 0.12, ideal: 0.18, max: 0.25, unit: 's' },
      subBodyRatio: { min: 4, ideal: 9, max: 18, unit: 'ratio' },
    },
    bass: {
      fundamental: { min: 55, ideal: 73, max: 98, unit: 'Hz' },
      subEnergy: { min: 45, ideal: 60, max: 75, unit: '%' },
      bodyEnergy: { min: 15, ideal: 25, max: 35, unit: '%' },
      harmonicContent: { min: 5, ideal: 12, max: 20, unit: '%' },
      decay: { min: 0.08, ideal: 0.12, max: 0.16, unit: 's' },
      stereoWidth: { min: 0, ideal: 0.03, max: 0.10, unit: '0-1' },
    },
    lead: {
      fundamental: { min: 220, ideal: 330, max: 550, unit: 'Hz' },
      brightness: { min: 1200, ideal: 2000, max: 3500, unit: 'Hz' },
      harshnessLimit: { min: 8, ideal: 12, max: 18, unit: '%' },
      stereoWidth: { min: 0.2, ideal: 0.4, max: 0.6, unit: '0-1' },
    },
    stereo: {
      lowEndMonoFreq: 120,
      widthBelow200: { min: 0, ideal: 0.03, max: 0.10, unit: '0-1' },
      widthAbove2000: { min: 0.3, ideal: 0.5, max: 0.7, unit: '0-1' },
      correlationLow: { min: 0.85, ideal: 0.98, max: 1.0, unit: '0-1' },
      correlationHigh: { min: 0.0, ideal: 0.2, max: 0.5, unit: '0-1' },
    },
    dynamics: {
      transientDensity: { min: 3, ideal: 6, max: 10, unit: '/s' },
      rmsVariance: { min: 2, ideal: 5, max: 8, unit: 'dB' },
      sectionContrast: { min: 3, ideal: 6, max: 10, unit: 'dB' },
    },
    arrangement: {
      introBars: { min: 16, ideal: 32, max: 64, unit: 'bars' },
      buildBars: { min: 8, ideal: 16, max: 32, unit: 'bars' },
      dropBars: { min: 32, ideal: 64, max: 128, unit: 'bars' },
      breakBars: { min: 8, ideal: 16, max: 32, unit: 'bars' },
      totalMinutes: { min: 6, ideal: 8, max: 10, unit: 'min' },
    },
  },

  'goa': {
    id: 'goa',
    name: 'Goa',
    bpmRange: [136, 148],
    lufs: { min: -11, ideal: -9, max: -7, unit: 'LUFS' },
    truePeak: { min: -1.5, ideal: -1.0, max: -0.5, unit: 'dBTP' },
    crestFactor: { min: 5, ideal: 8, max: 11, unit: 'dB' },
    spectral: {
      sub: { min: 16, ideal: 22, max: 30, unit: '%' },
      low: { min: 10, ideal: 14, max: 20, unit: '%' },
      lowMid: { min: 12, ideal: 18, max: 25, unit: '%' },
      mid: { min: 15, ideal: 22, max: 30, unit: '%' },
      highMid: { min: 8, ideal: 12, max: 18, unit: '%' },
      high: { min: 6, ideal: 10, max: 15, unit: '%' },
      air: { min: 3, ideal: 6, max: 10, unit: '%' },
    },
    kick: {
      fundamental: { min: 48, ideal: 52, max: 56, unit: 'Hz' },
      subEnergy: { min: 72, ideal: 85, max: 92, unit: '%' },
      bodyEnergy: { min: 6, ideal: 12, max: 22, unit: '%' },
      clickEnergy: { min: 0.5, ideal: 2, max: 5, unit: '%' },
      decay: { min: 0.14, ideal: 0.20, max: 0.28, unit: 's' },
      subBodyRatio: { min: 3, ideal: 7, max: 14, unit: 'ratio' },
    },
    bass: {
      fundamental: { min: 65, ideal: 87, max: 110, unit: 'Hz' },
      subEnergy: { min: 40, ideal: 55, max: 70, unit: '%' },
      bodyEnergy: { min: 18, ideal: 28, max: 38, unit: '%' },
      harmonicContent: { min: 8, ideal: 18, max: 28, unit: '%' },
      decay: { min: 0.10, ideal: 0.14, max: 0.18, unit: 's' },
      stereoWidth: { min: 0, ideal: 0.05, max: 0.12, unit: '0-1' },
    },
    lead: {
      fundamental: { min: 330, ideal: 440, max: 660, unit: 'Hz' },
      brightness: { min: 1800, ideal: 2800, max: 4500, unit: 'Hz' },
      harshnessLimit: { min: 6, ideal: 10, max: 15, unit: '%' },
      stereoWidth: { min: 0.4, ideal: 0.6, max: 0.8, unit: '0-1' },
    },
    stereo: {
      lowEndMonoFreq: 120,
      widthBelow200: { min: 0, ideal: 0.04, max: 0.12, unit: '0-1' },
      widthAbove2000: { min: 0.5, ideal: 0.7, max: 0.9, unit: '0-1' },
      correlationLow: { min: 0.85, ideal: 0.97, max: 1.0, unit: '0-1' },
      correlationHigh: { min: -0.1, ideal: 0.2, max: 0.5, unit: '0-1' },
    },
    dynamics: {
      transientDensity: { min: 3, ideal: 5, max: 8, unit: '/s' },
      rmsVariance: { min: 3, ideal: 6, max: 9, unit: 'dB' },
      sectionContrast: { min: 4, ideal: 7, max: 11, unit: 'dB' },
    },
    arrangement: {
      introBars: { min: 16, ideal: 32, max: 64, unit: 'bars' },
      buildBars: { min: 8, ideal: 16, max: 32, unit: 'bars' },
      dropBars: { min: 32, ideal: 64, max: 128, unit: 'bars' },
      breakBars: { min: 8, ideal: 16, max: 32, unit: 'bars' },
      totalMinutes: { min: 7, ideal: 9, max: 12, unit: 'min' },
    },
  },

  'forest': {
    id: 'forest',
    name: 'Forest',
    bpmRange: [145, 155],
    lufs: { min: -11, ideal: -9, max: -7, unit: 'LUFS' },
    truePeak: { min: -1.5, ideal: -1.0, max: -0.5, unit: 'dBTP' },
    crestFactor: { min: 5, ideal: 7, max: 10, unit: 'dB' },
    spectral: {
      sub: { min: 17, ideal: 24, max: 32, unit: '%' },
      low: { min: 9, ideal: 13, max: 19, unit: '%' },
      lowMid: { min: 11, ideal: 16, max: 23, unit: '%' },
      mid: { min: 13, ideal: 19, max: 26, unit: '%' },
      highMid: { min: 8, ideal: 12, max: 18, unit: '%' },
      high: { min: 6, ideal: 10, max: 15, unit: '%' },
      air: { min: 2, ideal: 4, max: 7, unit: '%' },
    },
    kick: {
      fundamental: { min: 45, ideal: 48, max: 52, unit: 'Hz' },
      subEnergy: { min: 73, ideal: 86, max: 93, unit: '%' },
      bodyEnergy: { min: 5, ideal: 11, max: 21, unit: '%' },
      clickEnergy: { min: 0.5, ideal: 1.5, max: 4, unit: '%' },
      decay: { min: 0.13, ideal: 0.19, max: 0.26, unit: 's' },
      subBodyRatio: { min: 3, ideal: 8, max: 16, unit: 'ratio' },
    },
    bass: {
      fundamental: { min: 55, ideal: 73, max: 98, unit: 'Hz' },
      subEnergy: { min: 42, ideal: 58, max: 72, unit: '%' },
      bodyEnergy: { min: 16, ideal: 26, max: 36, unit: '%' },
      harmonicContent: { min: 6, ideal: 14, max: 22, unit: '%' },
      decay: { min: 0.09, ideal: 0.13, max: 0.17, unit: 's' },
      stereoWidth: { min: 0, ideal: 0.03, max: 0.10, unit: '0-1' },
    },
    lead: {
      fundamental: { min: 220, ideal: 330, max: 550, unit: 'Hz' },
      brightness: { min: 1400, ideal: 2200, max: 3800, unit: 'Hz' },
      harshnessLimit: { min: 7, ideal: 11, max: 16, unit: '%' },
      stereoWidth: { min: 0.3, ideal: 0.5, max: 0.7, unit: '0-1' },
    },
    stereo: {
      lowEndMonoFreq: 120,
      widthBelow200: { min: 0, ideal: 0.03, max: 0.10, unit: '0-1' },
      widthAbove2000: { min: 0.4, ideal: 0.6, max: 0.8, unit: '0-1' },
      correlationLow: { min: 0.85, ideal: 0.97, max: 1.0, unit: '0-1' },
      correlationHigh: { min: 0.0, ideal: 0.2, max: 0.5, unit: '0-1' },
    },
    dynamics: {
      transientDensity: { min: 3, ideal: 6, max: 9, unit: '/s' },
      rmsVariance: { min: 2, ideal: 5, max: 8, unit: 'dB' },
      sectionContrast: { min: 3, ideal: 6, max: 10, unit: 'dB' },
    },
    arrangement: {
      introBars: { min: 16, ideal: 32, max: 64, unit: 'bars' },
      buildBars: { min: 8, ideal: 16, max: 32, unit: 'bars' },
      dropBars: { min: 32, ideal: 64, max: 128, unit: 'bars' },
      breakBars: { min: 8, ideal: 16, max: 32, unit: 'bars' },
      totalMinutes: { min: 6, ideal: 8, max: 10, unit: 'min' },
    },
  },

  'morning-psy': {
    id: 'morning-psy',
    name: 'Morning Psy',
    bpmRange: [138, 145],
    lufs: { min: -12, ideal: -10, max: -8, unit: 'LUFS' },
    truePeak: { min: -2.0, ideal: -1.5, max: -1.0, unit: 'dBTP' },
    crestFactor: { min: 6, ideal: 9, max: 12, unit: 'dB' },
    spectral: {
      sub: { min: 14, ideal: 20, max: 28, unit: '%' },
      low: { min: 10, ideal: 14, max: 20, unit: '%' },
      lowMid: { min: 12, ideal: 18, max: 25, unit: '%' },
      mid: { min: 16, ideal: 22, max: 30, unit: '%' },
      highMid: { min: 8, ideal: 12, max: 18, unit: '%' },
      high: { min: 6, ideal: 10, max: 15, unit: '%' },
      air: { min: 3, ideal: 6, max: 10, unit: '%' },
    },
    kick: {
      fundamental: { min: 50, ideal: 54, max: 58, unit: 'Hz' },
      subEnergy: { min: 68, ideal: 82, max: 92, unit: '%' },
      bodyEnergy: { min: 6, ideal: 14, max: 26, unit: '%' },
      clickEnergy: { min: 0.5, ideal: 2, max: 5, unit: '%' },
      decay: { min: 0.15, ideal: 0.22, max: 0.30, unit: 's' },
      subBodyRatio: { min: 3, ideal: 6, max: 13, unit: 'ratio' },
    },
    bass: {
      fundamental: { min: 73, ideal: 87, max: 110, unit: 'Hz' },
      subEnergy: { min: 38, ideal: 52, max: 68, unit: '%' },
      bodyEnergy: { min: 20, ideal: 30, max: 40, unit: '%' },
      harmonicContent: { min: 8, ideal: 18, max: 28, unit: '%' },
      decay: { min: 0.10, ideal: 0.15, max: 0.20, unit: 's' },
      stereoWidth: { min: 0, ideal: 0.05, max: 0.15, unit: '0-1' },
    },
    lead: {
      fundamental: { min: 440, ideal: 523, max: 698, unit: 'Hz' },
      brightness: { min: 2000, ideal: 3000, max: 5000, unit: 'Hz' },
      harshnessLimit: { min: 5, ideal: 8, max: 12, unit: '%' },
      stereoWidth: { min: 0.4, ideal: 0.6, max: 0.8, unit: '0-1' },
    },
    stereo: {
      lowEndMonoFreq: 120,
      widthBelow200: { min: 0, ideal: 0.05, max: 0.15, unit: '0-1' },
      widthAbove2000: { min: 0.5, ideal: 0.7, max: 0.9, unit: '0-1' },
      correlationLow: { min: 0.8, ideal: 0.95, max: 1.0, unit: '0-1' },
      correlationHigh: { min: -0.1, ideal: 0.2, max: 0.5, unit: '0-1' },
    },
    dynamics: {
      transientDensity: { min: 2, ideal: 4, max: 7, unit: '/s' },
      rmsVariance: { min: 4, ideal: 7, max: 10, unit: 'dB' },
      sectionContrast: { min: 4, ideal: 8, max: 12, unit: 'dB' },
    },
    arrangement: {
      introBars: { min: 16, ideal: 32, max: 64, unit: 'bars' },
      buildBars: { min: 8, ideal: 16, max: 32, unit: 'bars' },
      dropBars: { min: 16, ideal: 32, max: 64, unit: 'bars' },
      breakBars: { min: 8, ideal: 16, max: 32, unit: 'bars' },
      totalMinutes: { min: 5, ideal: 7, max: 9, unit: 'min' },
    },
  },
};

// ─── Reference Analysis Result ─────────────────────────────────────────────

export interface AnalysisResult {
  metric: string;
  value: number;
  unit: string;
  target: TargetRange;
  score: number;     // 0..1 (1 = ideal, 0 = way off)
  status: 'great' | 'good' | 'warning' | 'bad';
}

/**
 * Score a measured value against a target range.
 * Returns 0..1 score and status.
 */
export function scoreAgainstTarget(value: number, target: TargetRange): { score: number; status: 'great' | 'good' | 'warning' | 'bad' } {
  // Within ideal range = great
  if (value >= target.ideal - (target.ideal - target.min) * 0.3 &&
      value <= target.ideal + (target.max - target.ideal) * 0.3) {
    return { score: 1.0, status: 'great' };
  }
  // Within min/max = good
  if (value >= target.min && value <= target.max) {
    // Score based on distance from ideal
    const distFromIdeal = Math.abs(value - target.ideal);
    const range = (target.max - target.min) / 2;
    return { score: 0.7 + 0.3 * (1 - distFromIdeal / range), status: 'good' };
  }
  // Outside range — calculate how far
  const distOutside = value < target.min ? target.min - value : value - target.max;
  const range = target.max - target.min;
  const score = Math.max(0, 0.5 - (distOutside / range) * 0.5);
  return { score, status: score > 0.25 ? 'warning' : 'bad' };
}

/**
 * Get commercial targets for a genre.
 */
export function getGenreTargets(genreId: string): GenreTargets {
  return COMMERCIAL_TARGETS[genreId] || COMMERCIAL_TARGETS['progressive-psy'];
}

/**
 * Get all available genres.
 */
export function getAvailableGenres(): string[] {
  return Object.keys(COMMERCIAL_TARGETS);
}
