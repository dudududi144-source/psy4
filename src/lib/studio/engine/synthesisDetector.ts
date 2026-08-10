/**
 * Synthesis Character Detector (Task T1) — a PURE function that takes the
 * extended RefFeatures (harmonic content + transient shape + stereo field)
 * and infers which synthesis mode the engine should engage to SOUND LIKE
 * the radio reference.
 *
 * The four candidate modes mirror the AdvancedSynthVoice (Task S1):
 *   - 'fm'        → metallic / bell / squelchy (inharmonic partials)
 *   - 'supersaw'  → thick, rich, anthemic (dense harmonics, wide stereo)
 *   - 'wavetable' → evolving, morphing (moderate inharmonicity + variance)
 *   - 'classic'   → stable, narrow, tonal (the safe fallback)
 *
 * Detection is intentionally conservative: each rule contributes evidence
 * (0..1) for one or more modes; the mode with the highest aggregate score
 * wins, and `confidence` is the winning score normalized by the total
 * evidence. If no rule fires meaningfully, we fall back to 'classic' with
 * low confidence so the engine's per-world preset selection wins.
 *
 * All metrics are guarded against NaN/undefined — the function never throws
 * and always returns a finite, clamped SynthesisCharacter.
 *
 * @module synthesisDetector
 */

import type { RefFeatures } from './styleClassifier';

// ─── Public types ──────────────────────────────────────────────────────────

export type SynthesisMode = 'fm' | 'supersaw' | 'wavetable' | 'classic';

export interface SynthesisCharacter {
  /** Winning synthesis mode. */
  mode: SynthesisMode;
  /** 0..1 — winning share of total evidence. >0.5 = strong, <0.3 = weak. */
  confidence: number;
  /** Human-readable reasons for the choice (max 4, for UI display). */
  reasons: string[];
  /** 0..8 — FM modulation depth (only meaningful when mode === 'fm'). */
  fmDepth: number;
  /** 0..1 — supersaw detune spread (only meaningful when mode === 'supersaw'). */
  sawSpread: number;
  /** 0..1 — wavetable crossfade position (only meaningful when mode === 'wavetable'). */
  wtPosition: number;
}

// ─── Internal helpers ──────────────────────────────────────────────────────

const clamp01 = (v: number): number => {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : (v > 1 ? 1 : v);
};

const clamp = (v: number, lo: number, hi: number): number => {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : (v > hi ? hi : v);
};

/**
 * Read a numeric field off a possibly-undefined nested object, returning 0
 * for missing / NaN values. This is the only place we touch the optional
 * `harmonicContent` / `transientShape` / `stereoField` sub-objects.
 */
function num(obj: { [k: string]: unknown } | undefined, key: string): number {
  if (!obj) return 0;
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// ─── Detector ──────────────────────────────────────────────────────────────

/**
 * Detect the synthesis character of a reference signal from its features.
 *
 * The detector is a PURE function — same inputs always give the same output,
 * no side effects, no I/O. This makes it trivially testable.
 *
 * Detection logic (each branch contributes evidence 0..1):
 *
 *  - FM: high inharmonicity (>0.3), high spectral crest (>5), metallic.
 *    fmDepth derived from inharmonicity (0.3 → 2, 1.0 → 8).
 *
 *  - SUPERSAW: low inharmonicity (<0.15), high HNR (>0.45), wide stereo
 *    (correlation 0.3..0.7) or wide msRatio (>0.15). sawSpread from width.
 *
 *  - WAVETABLE: moderate inharmonicity (0.1..0.4), moderate-to-high HNR
 *    (0.25..0.6), evolving character inferred from non-zero slope + width.
 *    wtPosition derived from centroid (dark → 0, bright → 1).
 *
 *  - CLASSIC: low inharmonicity, narrow stereo (correlation >0.7), stable
 *    spectrum. This is the safe default and also the fallback when no rule
 *    fires strongly.
 *
 * If features are missing entirely (no harmonicContent), all evidence is 0
 * and we return 'classic' with confidence 0 so the engine falls back to
 * its per-world preset selection.
 */
export function detectSynthesisCharacter(features: RefFeatures): SynthesisCharacter {
  // ── Pull the nested subobjects out safely ──
  const hc = features.harmonicContent as { [k: string]: unknown } | undefined;
  const ts = features.transientShape as { [k: string]: unknown } | undefined;
  const sf = features.stereoField as { [k: string]: unknown } | undefined;

  // If the listener didn't populate harmonic content, we have no basis to
  // pick a mode. Return classic with zero confidence so the engine leaves
  // the per-world preset selection in place.
  if (!hc) {
    return {
      mode: 'classic',
      confidence: 0,
      reasons: ['no harmonic-content features available'],
      fmDepth: 0,
      sawSpread: 0,
      wtPosition: 0.5,
    };
  }

  const flatness      = clamp01(num(hc, 'flatness'));
  const crest         = Math.max(0, num(hc, 'crest'));
  const hnr           = clamp01(num(hc, 'hnr'));
  const inharmonicity = clamp01(num(hc, 'inharmonicity'));
  const slope         = num(hc, 'slope');         // dB/oct, ~ -6..-24
  const sharpness     = clamp01(num(ts, 'sharpness'));
  const correlation   = clamp(num(sf, 'correlation'), -1, 1);
  const msRatio       = clamp01(num(sf, 'msRatio'));
  const width         = clamp01(num(sf, 'width'));
  const centroid      = Math.max(0, features.spectralCentroid || 0);

  const reasons: string[] = [];

  // ── FM evidence ──
  // High inharmonicity is the strongest FM cue (partials at non-integer
  // ratios → bell / metallic / FM sidebands). Spectral crest reinforces
  // (FM spectra have pronounced peaks). Sharp transients add a bit (FM
  // leads often have clicky attacks from the modulator envelope).
  let fmEv = 0;
  if (inharmonicity > 0.30) {
    fmEv += clamp01((inharmonicity - 0.30) / 0.70) * 0.7;
    reasons.push(`inharmonicity ${(inharmonicity * 100).toFixed(0)}% (metallic partials)`);
  }
  if (crest > 5) {
    fmEv += clamp01((crest - 5) / 10) * 0.2;
    reasons.push(`spectral crest ${crest.toFixed(1)} (pronounced peaks)`);
  }
  if (sharpness > 0.6) {
    fmEv += (sharpness - 0.6) * 0.25;
    reasons.push(`sharp transients (clicky attacks)`);
  }
  fmEv = clamp01(fmEv);
  // FM depth: 0.30 inharmonicity → ~2, 1.0 → 8 (linear map).
  const fmDepth = inharmonicity > 0.30
    ? clamp(2 + (inharmonicity - 0.30) * (8 / 0.70), 1, 8)
    : 0;

  // ── Supersaw evidence ──
  // Low inharmonicity + high HNR = clean harmonic stack. Wide stereo
  // (correlation 0.3..0.7 OR msRatio > 0.15) is the supersaw signature.
  // Crest being moderate (not extreme) distinguishes it from a single sine.
  let sawEv = 0;
  if (inharmonicity < 0.15 && hnr > 0.45) {
    sawEv += clamp01((hnr - 0.45) / 0.45) * 0.4;
    reasons.push(`HNR ${(hnr * 100).toFixed(0)}% (clean harmonic stack)`);
  }
  // Wide stereo reinforces supersaw (detuned-oscillator panning).
  if ((correlation > 0.30 && correlation < 0.70) || msRatio > 0.15) {
    sawEv += clamp01(width * 0.5);
    reasons.push(`wide stereo (correlation ${correlation.toFixed(2)}, M/S ${msRatio.toFixed(2)})`);
  }
  // Moderate crest (3..8) suggests multiple detuned peaks rather than one.
  if (crest >= 3 && crest <= 8) {
    sawEv += 0.1;
  }
  sawEv = clamp01(sawEv);
  // sawSpread: scale with stereo width so wide references get more detune.
  const sawSpread = clamp01(0.3 + width * 0.6);

  // ── Wavetable evidence ──
  // Moderate inharmonicity + mid HNR + a non-trivial spectral slope = a
  // spectrum that's neither purely harmonic nor purely inharmonic — the
  // kind of evolving texture wavetables excel at. We don't have direct
  // "spectral variance over time" here (that's a profile-level metric),
  // so we use slope + width as a proxy: bright + wide = morphing high
  // content, dark + narrow = stable low content.
  let wtEv = 0;
  if (inharmonicity >= 0.10 && inharmonicity <= 0.40 && hnr >= 0.25 && hnr <= 0.65) {
    wtEv += 0.4;
    reasons.push(`mid inharmonicity + HNR (evolving spectrum)`);
  }
  if (slope < -10 && slope > -22) {
    wtEv += 0.15;
    reasons.push(`spectral slope ${slope.toFixed(1)} dB/oct (balanced tilt)`);
  }
  if (width > 0.3) {
    wtEv += 0.1;
  }
  wtEv = clamp01(wtEv);
  // wtPosition: bright centroid (>4000 Hz) → 1 (saw/bright wave), dark (<1500) → 0 (sine/warm).
  const wtPosition = centroid > 0
    ? clamp01((Math.log10(centroid) - Math.log10(400)) / (Math.log10(8000) - Math.log10(400)))
    : 0.5;

  // ── Classic evidence ──
  // The safe baseline: low inharmonicity, narrow stereo, stable spectrum.
  // Classic gets a small floor (0.15) so it always wins ties — this
  // prevents thrashing when no mode has strong evidence.
  let classicEv = 0.15;
  if (inharmonicity < 0.15 && hnr > 0.3) {
    classicEv += 0.2;
  }
  if (correlation > 0.7) {
    classicEv += 0.2;
    reasons.push(`narrow stereo (correlation ${correlation.toFixed(2)} = near-mono)`);
  }
  if (slope < -22) {
    classicEv += 0.1;
  }
  classicEv = clamp01(classicEv);

  // ── Pick the winner ──
  const candidates: Array<{ mode: SynthesisMode; ev: number; param: number }> = [
    { mode: 'fm',        ev: fmEv,      param: fmDepth },
    { mode: 'supersaw',  ev: sawEv,     param: sawSpread },
    { mode: 'wavetable', ev: wtEv,      param: wtPosition },
    { mode: 'classic',   ev: classicEv, param: 0 },
  ];
  // Sort by evidence descending — stable enough for our purposes.
  candidates.sort((a, b) => b.ev - a.ev);
  const winner = candidates[0];
  const total = candidates.reduce((s, c) => s + c.ev, 0) || 1;
  const confidence = clamp01(winner.ev / total);

  // Build the result, pulling the appropriate parameter for the winning mode.
  const result: SynthesisCharacter = {
    mode: winner.mode,
    confidence,
    reasons: reasons.slice(0, 4),
    fmDepth: winner.mode === 'fm' ? winner.param : 0,
    sawSpread: winner.mode === 'supersaw' ? winner.param : 0,
    wtPosition: winner.mode === 'wavetable' ? winner.param : 0.5,
  };
  return result;
}
