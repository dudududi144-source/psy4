/**
 * Uniqueness Detector (Task A1) — identifies distinctive sonic EVENTS in
 * the reference signal that the engine should know about and try to
 * reproduce: risers, impacts, FX sweeps, vocal chops, reverse hits,
 * glitches, and stabs.
 *
 * The detector works on a SHORT HISTORY of RefFeatures snapshots (one per
 * analysis window — the V2 listener produces one every ~10 s). Each event
 * type is identified by a characteristic pattern of feature changes across
 * the history:
 *
 *   - RISER: sustained build — centroid rising, energy rising, over 2-8
 *     consecutive windows.
 *   - IMPACT: sudden transient spike + sub boom — transient density jumps
 *     AND sub energy spikes in one window vs the previous.
 *   - FX SWEEP: filter movement — centroid changing rapidly (>1 octave)
 *     between windows.
 *   - VOCAL CHOP: formant peaks appearing intermittently — high HNR +
 *     mid-band energy spike, only in one window (not sustained).
 *   - REVERSE HIT: reverse-envelope transient — sharpness DROPS while
 *     transient density stays high (reverse hits have slow attacks).
 *   - GLITCH: very short transient burst — transient density very high
 *     (>20/s) in a single window with low overall energy.
 *   - STAB: short pitched chord — high HNR + short decay + high mid energy.
 *
 * The function is PURE: same inputs always give the same output. Never
 * throws — malformed input yields an empty array.
 *
 * @module uniquenessDetector
 */

import type { RefFeatures } from './styleClassifier';

// ─── Public types ──────────────────────────────────────────────────────────

export type UniqueElementType =
  | 'riser'
  | 'impact'
  | 'fx'
  | 'vocalChop'
  | 'reverseHit'
  | 'glitch'
  | 'sweep'
  | 'stab';

export interface UniqueElement {
  type: UniqueElementType;
  timestamp: number;      // ms — when it occurred (relative to the most recent window)
  duration: number;       // ms — estimated duration
  frequency: number;      // Hz — dominant frequency (0 = broadband)
  confidence: number;     // 0..1
  description: string;    // human-readable
}

// ─── Internal helpers ──────────────────────────────────────────────────────

const clamp01 = (v: number): number => {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : (v > 1 ? 1 : v);
};

const num = (obj: { [k: string]: unknown } | undefined, key: string): number => {
  if (!obj) return 0;
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};

/**
 * Compute the dominant frequency of a snapshot — the strongest bin in the
 * energy distribution. Returns 0 if no clear peak.
 */
function dominantFreq(features: RefFeatures): number {
  const sub = clamp01(features.subEnergy ?? 0);
  const low = clamp01(features.lowEnergy ?? 0);
  const mid = clamp01(features.midEnergy ?? 0);
  const high = clamp01(features.highEnergy ?? 0);
  const air = clamp01(features.airEnergy ?? 0);
  const peaks: { f: number; a: number }[] = [
    { f: 40, a: sub },
    { f: 150, a: low },
    { f: 800, a: mid },
    { f: 4000, a: high },
    { f: 12000, a: air },
  ];
  peaks.sort((a, b) => b.a - a.a);
  return peaks[0].a > 0.15 ? peaks[0].f : 0;
}

// ─── Per-event detectors ──────────────────────────────────────────────────

/**
 * Riser: centroid AND energy both rising across the last 2-8 windows.
 * Confidence scales with the number of consecutive rising windows and the
 * magnitude of the rise.
 */
function detectRiser(history: RefFeatures[], now: number): UniqueElement | null {
  if (history.length < 3) return null;
  const recent = history.slice(-6); // up to 6 most recent windows
  let risingCount = 0;
  let centRise = 0;
  let energyRise = 0;
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1];
    const curr = recent[i];
    const dc = (curr.spectralCentroid ?? 0) - (prev.spectralCentroid ?? 0);
    const de = (curr.energy ?? 0) - (prev.energy ?? 0);
    if (dc > 30 && de > 0.02) {
      risingCount++;
      centRise += dc;
      energyRise += de;
    } else {
      break; // riser must be sustained — break on first non-rising window
    }
  }
  if (risingCount < 1) return null;
  const confidence = clamp01(risingCount / 5 + Math.min(1, centRise / 3000) * 0.3);
  if (confidence < 0.15) return null;
  const last = recent[recent.length - 1];
  return {
    type: 'riser',
    timestamp: now,
    duration: risingCount * 10_000, // each window is ~10 s
    frequency: dominantFreq(last),
    confidence,
    description: `Rising build over ${risingCount + 1} windows (+${centRise.toFixed(0)} Hz centroid, +${(energyRise * 100).toFixed(0)}% energy)`,
  };
}

/**
 * Impact: transient density spikes AND sub energy jumps in the latest
 * window vs the previous one.
 */
function detectImpact(history: RefFeatures[], now: number): UniqueElement | null {
  if (history.length < 2) return null;
  const prev = history[history.length - 2];
  const curr = history[history.length - 1];
  const tdDelta = (curr.transientDensity ?? 0) - (prev.transientDensity ?? 0);
  const subDelta = (curr.subEnergy ?? 0) - (prev.subEnergy ?? 0);
  if (tdDelta < 2 || subDelta < 0.1) return null;
  const confidence = clamp01(tdDelta / 8 + subDelta * 2);
  if (confidence < 0.2) return null;
  return {
    type: 'impact',
    timestamp: now,
    duration: 500, // impacts are short
    frequency: dominantFreq(curr) || 60, // sub if no clear peak
    confidence,
    description: `Impact: +${tdDelta.toFixed(1)}/s transients, +${(subDelta * 100).toFixed(0)}% sub energy`,
  };
}

/**
 * FX sweep: centroid changes by >1 octave between consecutive windows
 * (filter movement), WITHOUT a sustained energy rise (which would be a riser).
 */
function detectFxSweep(history: RefFeatures[], now: number): UniqueElement | null {
  if (history.length < 2) return null;
  const prev = history[history.length - 2];
  const curr = history[history.length - 1];
  const centPrev = Math.max(1, prev.spectralCentroid ?? 0);
  const centCurr = Math.max(1, curr.spectralCentroid ?? 0);
  const octaveChange = Math.abs(Math.log2(centCurr / centPrev));
  if (octaveChange < 1) return null;
  // If energy also rose, that's a riser — skip.
  const energyDelta = (curr.energy ?? 0) - (prev.energy ?? 0);
  if (energyDelta > 0.1) return null;
  const confidence = clamp01(octaveChange / 3);
  if (confidence < 0.2) return null;
  const direction = centCurr > centPrev ? 'opening' : 'closing';
  return {
    type: 'fx',
    timestamp: now,
    duration: 10_000, // one window
    frequency: centCurr,
    confidence,
    description: `Filter ${direction}: centroid ${centPrev.toFixed(0)} → ${centCurr.toFixed(0)} Hz (${octaveChange.toFixed(1)} octaves)`,
  };
}

/**
 * Vocal chop: high HNR + mid-band energy spike in a single window, not
 * sustained (energy drops in the next window — but we don't have "next"
 * yet, so we just require high HNR + mid peak + not part of a riser).
 */
function detectVocalChop(history: RefFeatures[], now: number): UniqueElement | null {
  if (history.length < 2) return null;
  const prev = history[history.length - 2];
  const curr = history[history.length - 1];
  const hc = curr.harmonicContent as { [k: string]: unknown } | undefined;
  const hnr = clamp01(num(hc, 'hnr'));
  const prevHnr = clamp01(num(prev.harmonicContent as { [k: string]: unknown } | undefined, 'hnr'));
  const mid = clamp01(curr.midEnergy ?? 0);
  const prevMid = clamp01(prev.midEnergy ?? 0);
  // High HNR + mid-band spike + HNR rising.
  if (hnr < 0.5 || mid < 0.3 || mid < prevMid || hnr <= prevHnr) return null;
  const confidence = clamp01(hnr * 0.5 + (mid - prevMid) * 2);
  if (confidence < 0.25) return null;
  return {
    type: 'vocalChop',
    timestamp: now,
    duration: 1500, // typical chop length
    frequency: 800, // mid-band
    confidence,
    description: `Vocal-like chop: HNR ${(hnr * 100).toFixed(0)}%, mid energy ${(mid * 100).toFixed(0)}%`,
  };
}

/**
 * Reverse hit: sharpness DROPS while transient density stays high (reverse
 * envelopes have slow attacks, so sharpness is low).
 */
function detectReverseHit(history: RefFeatures[], now: number): UniqueElement | null {
  if (history.length < 2) return null;
  const prev = history[history.length - 2];
  const curr = history[history.length - 1];
  const ts = curr.transientShape as { [k: string]: unknown } | undefined;
  const prevTs = prev.transientShape as { [k: string]: unknown } | undefined;
  const sharp = clamp01(num(ts, 'sharpness'));
  const prevSharp = clamp01(num(prevTs, 'sharpness'));
  const td = curr.transientDensity ?? 0;
  // Sharpness drops significantly + transients still present.
  if (sharp > 0.4 || prevSharp - sharp < 0.2 || td < 5) return null;
  const confidence = clamp01((prevSharp - sharp) * 1.5 + td / 20);
  if (confidence < 0.2) return null;
  return {
    type: 'reverseHit',
    timestamp: now,
    duration: 2000,
    frequency: dominantFreq(curr),
    confidence,
    description: `Reverse envelope: sharpness ${prevSharp.toFixed(2)} → ${sharp.toFixed(2)}, transient density ${td.toFixed(1)}/s`,
  };
}

/**
 * Glitch: very high transient density (>20/s) in a single window with
 * relatively low overall energy (so it's not a drop).
 */
function detectGlitch(features: RefFeatures, now: number): UniqueElement | null {
  const td = features.transientDensity ?? 0;
  const energy = clamp01(features.energy ?? 0);
  if (td < 20 || energy > 0.7) return null;
  const confidence = clamp01((td - 20) / 15 + (0.7 - energy) * 0.5);
  if (confidence < 0.25) return null;
  return {
    type: 'glitch',
    timestamp: now,
    duration: 200, // very short
    frequency: dominantFreq(features) || 4000,
    confidence,
    description: `Glitch burst: ${td.toFixed(1)} transients/s, energy ${(energy * 100).toFixed(0)}%`,
  };
}

/**
 * Stab: high HNR + short decay + high mid energy (short pitched chord).
 */
function detectStab(features: RefFeatures, now: number): UniqueElement | null {
  const hc = features.harmonicContent as { [k: string]: unknown } | undefined;
  const ts = features.transientShape as { [k: string]: unknown } | undefined;
  const hnr = clamp01(num(hc, 'hnr'));
  const decay = num(ts, 'decay'); // ms
  const mid = clamp01(features.midEnergy ?? 0);
  if (hnr < 0.5 || decay > 200 || decay < 10 || mid < 0.3) return null;
  const confidence = clamp01(hnr * 0.4 + (200 - decay) / 200 * 0.3 + mid * 0.3);
  if (confidence < 0.25) return null;
  return {
    type: 'stab',
    timestamp: now,
    duration: decay,
    frequency: dominantFreq(features) || 500,
    confidence,
    description: `Stab chord: HNR ${(hnr * 100).toFixed(0)}%, decay ${decay.toFixed(0)} ms, mid ${(mid * 100).toFixed(0)}%`,
  };
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Detect unique sonic elements in the reference signal.
 *
 * @param features The most recent RefFeatures snapshot.
 * @param history  The recent history of RefFeatures snapshots (oldest first).
 *                 Used for rise/sweep/impact/reverse-hit detection (which
 *                 need to compare across windows).
 * @returns An array of detected UniqueElements. Empty when nothing found
 *          or when there isn't enough history.
 */
export function detectUniqueElements(
  features: RefFeatures,
  history: RefFeatures[],
): UniqueElement[] {
  const now = Date.now();
  // Build the augmented history (current snapshot appended).
  const fullHistory = history.length > 0 && history[history.length - 1] === features
    ? history
    : [...history, features];

  const elements: UniqueElement[] = [];

  // Single-window detectors (use just `features`).
  const glitch = detectGlitch(features, now);
  if (glitch) elements.push(glitch);

  const stab = detectStab(features, now);
  if (stab) elements.push(stab);

  // Multi-window detectors (need history).
  const riser = detectRiser(fullHistory, now);
  if (riser) elements.push(riser);

  const impact = detectImpact(fullHistory, now);
  if (impact) elements.push(impact);

  const fx = detectFxSweep(fullHistory, now);
  if (fx) elements.push(fx);

  const vocalChop = detectVocalChop(fullHistory, now);
  if (vocalChop) elements.push(vocalChop);

  const reverseHit = detectReverseHit(fullHistory, now);
  if (reverseHit) elements.push(reverseHit);

  // Sort by confidence descending — most-prominent first.
  elements.sort((a, b) => b.confidence - a.confidence);
  return elements;
}
