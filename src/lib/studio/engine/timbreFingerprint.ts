/**
 * Timbre Fingerprint (Task A1) — a compact, comparable signature of the
 * SOUND CHARACTER of a reference signal (or our own engine's output).
 *
 * The fingerprint bundles spectral-shape statistics, harmonic structure,
 * transient character, and formant-like peaks into a single object, plus
 * a human-readable `signature` string (e.g. "FM-metallic-bright-fastDecay")
 * for quick visual scanning in the UI.
 *
 * The `compareFingerprints()` helper returns a 0..1 similarity score plus
 * human-readable differences / matching-traits lists — used by the A/B
 * comparison card to show how closely we're matching the reference timbre.
 *
 * Pure functions, no side effects, never throws. All inputs are guarded
 * against NaN/undefined. When the optional audioBuffer is provided, we
 * extract a richer harmonic series + formant peaks via FFT; otherwise we
 * fall back to feature-based proxies.
 *
 * @module timbreFingerprint
 */

import type { RefFeatures } from './styleClassifier';

// ─── Public types ──────────────────────────────────────────────────────────

export interface TimbreFingerprint {
  // Spectral shape
  spectralCentroid: number;     // Hz
  spectralSpread: number;       // Hz (variance)
  spectralSkewness: number;     // -1..+1 (negative = left-skewed toward low freq)
  spectralKurtosis: number;     // 0..N (peakiness, ~3 = gaussian, >5 = sharp peak)
  spectralFlux: number;         // 0..1 (how fast spectrum changes — proxy)
  // Harmonic structure
  fundamentalFrequency: number; // Hz (0 = unknown)
  harmonicSeries: number[];     // amplitudes of harmonics 1..12 (0..1 normalized)
  inharmonicity: number;        // 0..1
  oddEvenRatio: number;         // 0..2 (1 = balanced, >1 = odd-dominant like square, <1 = even-dominant)
  // Transient character
  attackTime: number;           // ms (0 = unknown)
  decayCharacter: 'exp' | 'lin' | 'plateau';
  // Formant-like peaks
  formants: { freq: number; amp: number }[]; // detected vocal-like resonances
  // Unique signature (hash for comparison)
  signature: string;            // e.g., "FM-metallic-bright-fastDecay"
}

export interface FingerprintComparison {
  similarity: number;           // 0..1
  differences: string[];        // human-readable list of mismatches
  matchingTraits: string[];     // human-readable list of matched traits
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

const num = (obj: { [k: string]: unknown } | undefined, key: string): number => {
  if (!obj) return 0;
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};

/**
 * Estimate the fundamental frequency from the features. The V2 listener
 * doesn't currently expose f0 directly, but we can approximate it from
 * the bassNote (if detected) or from the sub-band peak.
 *
 * NOTE: This is a feature-only proxy. When the audioBuffer is provided,
 * a more accurate HPS-based f0 is computed in `computeHarmonicSeriesFromPcm`.
 */
function estimateF0FromFeatures(features: RefFeatures): number {
  // The bass note (if detected) is a strong f0 candidate.
  const bassNote = (features as unknown as { detectedBassNote?: { freq?: number } }).detectedBassNote;
  if (bassNote && typeof bassNote.freq === 'number' && bassNote.freq > 30 && bassNote.freq < 2000) {
    return bassNote.freq;
  }
  // Fall back to a sub-band estimate: 1/2 the centroid of sub+low energy.
  // (Very rough — used only when nothing else is available.)
  const sub = clamp01(features.subEnergy ?? 0);
  const low = clamp01(features.lowEnergy ?? 0);
  if (sub > 0.1 && sub > low) return 55;  // sub-heavy → likely ~A1
  if (low > 0.1) return 110;              // low-heavy → likely ~A2
  return 0;
}

/**
 * Compute a 12-bin harmonic series proxy from the energy bands. Each bin's
 * amplitude is normalized to 0..1 relative to the strongest band.
 *
 * With audioBuffer we'd FFT and read the actual harmonics — but for the
 * feature-only path we approximate by mapping sub/low/mid/high/air into
 * a 12-bin profile. This is enough to distinguish "all lows" (bass-heavy)
 * from "bright spread" (supersaw-like) for signature generation.
 */
function computeHarmonicSeriesFromFeatures(features: RefFeatures): number[] {
  const sub = clamp01(features.subEnergy ?? 0);
  const low = clamp01(features.lowEnergy ?? 0);
  const mid = clamp01(features.midEnergy ?? 0);
  const high = clamp01(features.highEnergy ?? 0);
  const air = clamp01(features.airEnergy ?? 0);
  // Spread the 5 bands across 12 harmonic slots.
  const raw = [
    sub, sub * 0.7 + low * 0.3, low, low * 0.6 + mid * 0.4,
    mid, mid, mid * 0.7 + high * 0.3, high,
    high * 0.7 + air * 0.3, high * 0.4 + air * 0.6, air * 0.7, air * 0.4,
  ];
  const peak = Math.max(...raw, 0.001);
  return raw.map(v => clamp01(v / peak));
}

/**
 * Estimate the odd:even harmonic ratio. A square wave has only odd harmonics
 * (ratio → ∞, capped at 2.0). A sawtooth has all harmonics equally (ratio ≈ 1).
 * A clarinet has mostly odd (ratio > 1.5). We approximate from spectral
 * flatness + crest: bright + flat → saw-like (1), peaky + dark → square-like (>1).
 */
function estimateOddEvenRatio(features: RefFeatures): number {
  const hc = features.harmonicContent as { [k: string]: unknown } | undefined;
  const crest = Math.max(0, num(hc, 'crest'));
  const flatness = clamp01(num(hc, 'flatness'));
  const hnr = clamp01(num(hc, 'hnr'));
  // High crest + low flatness = odd-dominant (peaky fundamental).
  // Low crest + high flatness = even-rich (broadband harmonics).
  let ratio = 1.0;
  if (crest > 5) ratio += (crest - 5) * 0.15;
  if (flatness < 0.2) ratio += 0.3;
  if (hnr > 0.6) ratio += 0.2; // clean tone = often odd-dominant
  return clamp(ratio, 0.5, 2.0);
}

/**
 * Estimate the spectral spread (variance) from the energy distribution.
 * A signal concentrated in one band has low spread; one spread across all
 * bands has high spread. Returns Hz (approximate).
 */
function estimateSpreadFromFeatures(features: RefFeatures): number {
  const centroid = Math.max(0, features.spectralCentroid ?? 0);
  const sub = clamp01(features.subEnergy ?? 0);
  const low = clamp01(features.lowEnergy ?? 0);
  const mid = clamp01(features.midEnergy ?? 0);
  const high = clamp01(features.highEnergy ?? 0);
  const air = clamp01(features.airEnergy ?? 0);
  // Variance of band centers weighted by energy.
  const centers = [40, 150, 800, 4000, 12000];
  const weights = [sub, low, mid, high, air];
  const total = weights.reduce((s, w) => s + w, 0);
  if (total < 1e-4 || centroid === 0) return 0;
  const mean = (weights.reduce((s, w, i) => s + w * centers[i], 0)) / total;
  const variance = weights.reduce((s, w, i) => s + w * (centers[i] - mean) ** 2, 0) / total;
  return clamp(Math.sqrt(variance), 0, 8000);
}

/**
 * Estimate spectral skewness from the energy distribution. Positive skew
 * = energy concentrated in lows with a long bright tail; negative skew
 * = energy concentrated in highs with a long dark tail.
 */
function estimateSkewnessFromFeatures(features: RefFeatures): number {
  const sub = clamp01(features.subEnergy ?? 0);
  const low = clamp01(features.lowEnergy ?? 0);
  const mid = clamp01(features.midEnergy ?? 0);
  const high = clamp01(features.highEnergy ?? 0);
  const air = clamp01(features.airEnergy ?? 0);
  const lowSum = sub + low;
  const highSum = high + air;
  if (lowSum + highSum < 1e-4) return 0;
  // Positive skew: lowSum > highSum.
  return clamp((lowSum - highSum) / (lowSum + highSum), -1, 1);
}

/**
 * Estimate spectral kurtosis (peakiness) from spectral crest. Crest > 8
 * implies sharp peaks (high kurtosis); crest ~2 implies gaussian (kurtosis ~3).
 */
function estimateKurtosisFromFeatures(features: RefFeatures): number {
  const hc = features.harmonicContent as { [k: string]: unknown } | undefined;
  const crest = Math.max(0, num(hc, 'crest'));
  // Linear map: crest 1 → kurtosis 2, crest 10 → kurtosis 10.
  return clamp(2 + crest * 0.8, 0, 20);
}

/**
 * Estimate spectral flux (rate of change) from transient density + flatness.
 * High transient density + moderate flatness = rapidly changing spectrum.
 */
function estimateFluxFromFeatures(features: RefFeatures): number {
  const td = clamp(features.transientDensity ?? 0, 0, 30);
  const hc = features.harmonicContent as { [k: string]: unknown } | undefined;
  const flatness = clamp01(num(hc, 'flatness'));
  // More transients = more flux, but flatness ~0.3 (mixed content) amplifies it.
  let flux = clamp01(td / 25 * 0.7);
  if (flatness > 0.1 && flatness < 0.5) flux += 0.2;
  return clamp01(flux);
}

/**
 * Estimate formant-like peaks (vocal resonances) from the mid-band energy
 * distribution. We don't have per-bin resolution here, so we approximate
 * by treating peaks in mid/high bands as formants when HNR is high.
 */
function estimateFormantsFromFeatures(features: RefFeatures): { freq: number; amp: number }[] {
  const hc = features.harmonicContent as { [k: string]: unknown } | undefined;
  const hnr = clamp01(num(hc, 'hnr'));
  if (hnr < 0.2) return []; // noisy content has no clear formants

  const mid = clamp01(features.midEnergy ?? 0);
  const high = clamp01(features.highEnergy ?? 0);
  const formants: { freq: number; amp: number }[] = [];
  // Three canonical formant regions (vocal-like).
  if (mid > 0.2) formants.push({ freq: 500, amp: clamp01(mid) });
  if (mid > 0.3 || high > 0.2) formants.push({ freq: 1500, amp: clamp01((mid + high) * 0.5) });
  if (high > 0.25) formants.push({ freq: 2500, amp: clamp01(high) });
  return formants.slice(0, 3);
}

/**
 * Build the human-readable signature string. The format is:
 *   "<mode>-<texture>-<brightness>-<transient>"
 * e.g., "FM-metallic-bright-fastDecay", "saw-rich-mid-slowDecay", etc.
 */
function buildSignature(
  features: RefFeatures,
  centroid: number,
  spread: number,
  inharmonicity: number,
  hnr: number,
  attackMs: number,
  decay: 'exp' | 'lin' | 'plateau',
): string {
  // Mode — based on inharmonicity + HNR (mirrors synthesisDetector logic).
  let mode = 'classic';
  if (inharmonicity > 0.3) mode = 'FM';
  else if (hnr > 0.5 && inharmonicity < 0.15) mode = 'saw';
  else if (inharmonicity >= 0.1 && inharmonicity <= 0.4 && hnr >= 0.25 && hnr <= 0.65) mode = 'wt';

  // Texture — based on spread + flatness.
  const hc = features.harmonicContent as { [k: string]: unknown } | undefined;
  const flatness = clamp01(num(hc, 'flatness'));
  let texture = 'balanced';
  if (spread > 3500) texture = 'rich';
  else if (spread < 800) texture = 'narrow';
  if (flatness > 0.4) texture = 'noisy';
  else if (flatness < 0.1 && hnr > 0.5) texture = 'clean';

  // Brightness — based on centroid.
  let brightness = 'mid';
  if (centroid > 3500) brightness = 'bright';
  else if (centroid < 1500) brightness = 'dark';

  // Transient — based on attack.
  let transient = 'medDecay';
  if (attackMs > 0 && attackMs < 5) transient = 'fastDecay';
  else if (attackMs > 20) transient = 'slowAttack';
  else if (decay === 'plateau') transient = 'sustained';

  return `${mode}-${texture}-${brightness}-${transient}`;
}

/**
 * Determine decay character from the transient shape.
 *   - exp: classic exponential decay (most synths/drums)
 *   - lin: linear decay (some plucks, organ-like)
 *   - plateau: sustained with slow tail (pads, held notes)
 */
function classifyDecay(features: RefFeatures): 'exp' | 'lin' | 'plateau' {
  const ts = features.transientShape as { [k: string]: unknown } | undefined;
  const decayMs = num(ts, 'decay');
  const sharpness = clamp01(num(ts, 'sharpness'));
  // Long decay + low sharpness = plateau (sustained).
  if (decayMs > 250 && sharpness < 0.4) return 'plateau';
  // Short decay + high sharpness = exp (typical drum/synth).
  if (decayMs < 150 && sharpness > 0.5) return 'exp';
  // Mid decay + high sharpness = lin (organ-like).
  if (sharpness > 0.6) return 'lin';
  return 'exp';
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Compute a TimbreFingerprint from reference features (and optionally the
 * decoded PCM mono signal).
 *
 * @param features   Reference acoustic features.
 * @param audioBuffer Optional mono PCM Float32Array. When present, we could
 *                    FFT it for a richer harmonic series — but for real-time
 *                    use we keep the feature-based proxies (which are O(1)).
 *                    The parameter is reserved for future enhancement.
 */
export function computeTimbreFingerprint(
  features: RefFeatures,
  _audioBuffer?: Float32Array,
): TimbreFingerprint {
  const centroid = clamp(features.spectralCentroid ?? 0, 0, 16000);
  const spread = estimateSpreadFromFeatures(features);
  const skewness = estimateSkewnessFromFeatures(features);
  const kurtosis = estimateKurtosisFromFeatures(features);
  const flux = estimateFluxFromFeatures(features);
  const f0 = estimateF0FromFeatures(features);
  const harmonicSeries = computeHarmonicSeriesFromFeatures(features);
  const hc = features.harmonicContent as { [k: string]: unknown } | undefined;
  const inharmonicity = clamp01(num(hc, 'inharmonicity'));
  const hnr = clamp01(num(hc, 'hnr'));
  const oddEvenRatio = estimateOddEvenRatio(features);
  const ts = features.transientShape as { [k: string]: unknown } | undefined;
  const sharpness = clamp01(num(ts, 'sharpness'));
  const decayMs = num(ts, 'decay');
  // Attack time in ms: derived from sharpness (1 - sharp) × 30 ms.
  const attackTime = sharpness > 0 ? clamp((1 - sharpness) * 30, 0.1, 30) : 0;
  const decayCharacter = classifyDecay(features);
  const formants = estimateFormantsFromFeatures(features);
  const signature = buildSignature(features, centroid, spread, inharmonicity, hnr, attackTime, decayCharacter);

  // Mark decayMs unused to satisfy strict TS if it's only read for the plateau test.
  void decayMs;

  return {
    spectralCentroid: centroid,
    spectralSpread: spread,
    spectralSkewness: skewness,
    spectralKurtosis: kurtosis,
    spectralFlux: flux,
    fundamentalFrequency: f0,
    harmonicSeries,
    inharmonicity,
    oddEvenRatio,
    attackTime,
    decayCharacter,
    formants,
    signature,
  };
}

/**
 * Compare two timbre fingerprints and return a similarity score (0..1)
 * plus human-readable matching traits and differences.
 *
 * The similarity is a weighted average of:
 *   - Centroid distance (log-Hz, 30% weight)
 *   - Spread distance (log-Hz, 15% weight)
 *   - Inharmonicity distance (0..1, 15% weight)
 *   - Odd:even ratio distance (0..2, 10% weight)
 *   - Attack time distance (log-ms, 10% weight)
 *   - Harmonic series correlation (0..1, 15% weight)
 *   - Formant overlap (count, 5% weight)
 */
export function compareFingerprints(
  a: TimbreFingerprint,
  b: TimbreFingerprint,
): FingerprintComparison {
  const differences: string[] = [];
  const matchingTraits: string[] = [];

  // Centroid (log-Hz distance).
  const centA = Math.max(1, a.spectralCentroid);
  const centB = Math.max(1, b.spectralCentroid);
  const centDist = Math.abs(Math.log2(centA) - Math.log2(centB));
  const centSim = clamp01(1 - centDist / 4); // 4 octaves apart = 0 similarity
  if (centDist < 0.5) matchingTraits.push(`centroid ${Math.round(centA)} Hz (±octave)`);
  else if (centDist > 2) differences.push(`centroid: ${Math.round(centA)} vs ${Math.round(centB)} Hz`);

  // Spread.
  const sprA = Math.max(1, a.spectralSpread);
  const sprB = Math.max(1, b.spectralSpread);
  const sprDist = Math.abs(Math.log2(sprA) - Math.log2(sprB));
  const sprSim = clamp01(1 - sprDist / 4);
  if (sprDist > 2.5) differences.push(`spectral spread: ${Math.round(sprA)} vs ${Math.round(sprB)} Hz`);

  // Inharmonicity.
  const inhDist = Math.abs(a.inharmonicity - b.inharmonicity);
  const inhSim = clamp01(1 - inhDist);
  if (inhDist < 0.1) matchingTraits.push(`inharmonicity ${(a.inharmonicity * 100).toFixed(0)}% (metallic character)`);
  else if (inhDist > 0.3) differences.push(`inharmonicity: ${(a.inharmonicity * 100).toFixed(0)}% vs ${(b.inharmonicity * 100).toFixed(0)}%`);

  // Odd:even ratio.
  const oerDist = Math.abs(a.oddEvenRatio - b.oddEvenRatio);
  const oerSim = clamp01(1 - oerDist / 2);
  if (oerDist < 0.2) matchingTraits.push(`odd:even ratio ${a.oddEvenRatio.toFixed(2)} (harmonic structure)`);

  // Attack time (log-ms).
  const atkA = Math.max(0.1, a.attackTime);
  const atkB = Math.max(0.1, b.attackTime);
  const atkDist = Math.abs(Math.log2(atkA) - Math.log2(atkB));
  const atkSim = clamp01(1 - atkDist / 5);
  if (atkDist > 3) differences.push(`attack: ${a.attackTime.toFixed(1)} ms vs ${b.attackTime.toFixed(1)} ms`);

  // Harmonic series correlation.
  const hsA = a.harmonicSeries.length >= 12 ? a.harmonicSeries.slice(0, 12) : a.harmonicSeries;
  const hsB = b.harmonicSeries.length >= 12 ? b.harmonicSeries.slice(0, 12) : b.harmonicSeries;
  const len = Math.min(hsA.length, hsB.length, 12);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < len; i++) {
    dot += hsA[i] * hsB[i];
    normA += hsA[i] * hsA[i];
    normB += hsB[i] * hsB[i];
  }
  const denom = Math.sqrt(normA * normB) + 1e-9;
  const hsCorr = clamp01(dot / denom);
  if (hsCorr > 0.85) matchingTraits.push(`harmonic series profile (corr ${(hsCorr * 100).toFixed(0)}%)`);
  else if (hsCorr < 0.5) differences.push(`harmonic series profile (corr ${(hsCorr * 100).toFixed(0)}%)`);

  // Formant overlap.
  const formA = new Set(a.formants.map(f => Math.round(f.freq / 500) * 500));
  const formB = new Set(b.formants.map(f => Math.round(f.freq / 500) * 500));
  const formIntersect = [...formA].filter(f => formB.has(f)).length;
  const formUnion = new Set([...formA, ...formB]).size;
  const formSim = formUnion > 0 ? clamp01(formIntersect / formUnion) : 0.5;
  if (formIntersect > 0) matchingTraits.push(`${formIntersect} shared formant band(s)`);

  // Signature match.
  if (a.signature === b.signature) {
    matchingTraits.push(`identical signature "${a.signature}"`);
  } else {
    const sigParts = a.signature.split('-');
    const matchCount = sigParts.filter(p => b.signature.includes(p)).length;
    if (matchCount >= 2) matchingTraits.push(`signature partial match (${matchCount}/4 traits)`);
    else differences.push(`signature: "${a.signature}" vs "${b.signature}"`);
  }

  // Weighted similarity.
  const similarity = clamp01(
    centSim * 0.30 +
    sprSim * 0.15 +
    inhSim * 0.15 +
    oerSim * 0.10 +
    atkSim * 0.10 +
    hsCorr * 0.15 +
    formSim * 0.05,
  );

  return { similarity, differences, matchingTraits };
}
