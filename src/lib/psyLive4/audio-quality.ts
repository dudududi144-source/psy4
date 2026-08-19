// src/lib/psyLive4/audio-quality.ts
// Real audio quality analyzer — measures 7 metrics that determine
// whether the music sounds GOOD (not just loud).
//
// This replaces the old CCLearner reward (which only measured peak dB).
// The learning loop now has a REAL signal to optimize against.

export interface AudioQualityMetrics {
  warmth: number;        // 0..1 — low/mid ratio (bass presence)
  brightness: number;    // 0..1 — spectral centroid (0=dark, 1=bright)
  punch: number;         // 0..1 — crest factor (transient clarity)
  clarity: number;       // 0..1 — spectral flatness (not noise, not pure tone)
  loudness: number;     // 0..1 — LUFS relative to target
  smoothness: number;   // 0..1 — low THD = smooth, high THD = harsh
  balance: number;      // 0..1 — how balanced the spectrum is (no harsh peaks)
  overall: number;      // 0..1 — weighted combination of all metrics
}

export interface QualityTargets {
  warmthMin: number;     // minimum bass presence
  brightnessMin: number;
  brightnessMax: number; // not too bright
  punchMin: number;
  clarityMin: number;
  loudnessMin: number;
  loudnessMax: number;
  smoothnessMin: number;
  balanceMin: number;
}

// Commercial psytrance DEFAULTS (measured from reference tracks).
// These are the immutable defaults — radio updates go through `applyRadioTargets()`
// which writes to a SEPARATE mutable copy (`activeTargets`) so the defaults
// can always be restored on disconnect (roast GAP 3).
export const DEFAULT_TARGETS: QualityTargets = {
  warmthMin: 0.6,       // bass must be present
  brightnessMin: 0.3,   // not too dark
  brightnessMax: 0.7,   // not too bright/harsh
  punchMin: 0.5,        // needs transients
  clarityMin: 0.3,      // not noise
  loudnessMin: 0.4,     // not too quiet
  loudnessMax: 0.9,     // not clipping
  smoothnessMin: 0.5,   // not harsh
  balanceMin: 0.5,      // spectrum should be balanced
};

/**
 * Active targets — what the learning loop actually compares against.
 * Mutated by `applyRadioTargets()` when radio is connected,
 * reset to `DEFAULT_TARGETS` by `restoreDefaultTargets()` on disconnect.
 * This is NOT the export — components import `COMMERCIAL_TARGETS` (the active copy).
 */
export const COMMERCIAL_TARGETS: QualityTargets = { ...DEFAULT_TARGETS };

const MIN_TARGET_SPREAD = 0.20;  // min (Max - Min) to avoid 4% wide windows

/**
 * Apply radio-derived targets to the active target set.
 * Ensures Min ≤ Max with at least MIN_TARGET_SPREAD between them.
 * (roast GAP 3: was `Math.max(0.2, brightness - 0.15)` / `Math.min(0.9, brightness + 0.15)`
 *  → if brightness=0.09, Min=0.20 Max=0.24 → 4% window → forced clamping to noise spike)
 */
export function applyRadioTargets(t: {
  warmth: number; brightness: number; punch: number;
  clarity: number; loudness: number; smoothness: number; balance: number;
}): void {
  // Each pair: [min, max] with ±0.15 around target, but enforced spread
  const clampPair = (center: number, lo: number, hi: number): [number, number] => {
    let mn = Math.max(lo, center - 0.15);
    let mx = Math.min(hi, center + 0.15);
    if (mx - mn < MIN_TARGET_SPREAD) {
      // Spread too narrow — widen around center (clamped to bounds)
      mn = Math.max(lo, center - MIN_TARGET_SPREAD / 2);
      mx = Math.min(hi, center + MIN_TARGET_SPREAD / 2);
      // If still narrow (center near edge), shift the window
      if (mx - mn < MIN_TARGET_SPREAD) {
        if (mn === lo) mx = Math.min(hi, lo + MIN_TARGET_SPREAD);
        else mn = Math.max(lo, hi - MIN_TARGET_SPREAD);
      }
    }
    return [mn, mx];
  };

  const [bMin, bMax] = clampPair(t.brightness, 0.15, 0.85);
  const [lMin, lMax] = clampPair(t.loudness, 0.25, 0.95);

  COMMERCIAL_TARGETS.warmthMin = Math.max(0.3, t.warmth - 0.15);
  COMMERCIAL_TARGETS.brightnessMin = bMin;
  COMMERCIAL_TARGETS.brightnessMax = bMax;
  COMMERCIAL_TARGETS.punchMin = Math.max(0.3, t.punch - 0.15);
  COMMERCIAL_TARGETS.clarityMin = Math.max(0.2, t.clarity - 0.15);
  COMMERCIAL_TARGETS.loudnessMin = lMin;
  COMMERCIAL_TARGETS.loudnessMax = lMax;
  COMMERCIAL_TARGETS.smoothnessMin = Math.max(0.3, t.smoothness - 0.15);
  COMMERCIAL_TARGETS.balanceMin = Math.max(0.3, t.balance - 0.15);
}

/** Restore defaults — called on radio disconnect (roast GAP 3). */
export function restoreDefaultTargets(): void {
  Object.assign(COMMERCIAL_TARGETS, DEFAULT_TARGETS);
}

/**
 * DEEP GAP D: K-weighted LUFS approximation (ITU-R BS.1770-4).
 *
 * The old code used `db - 0.691` which is just raw RMS with a constant offset.
 * Real LUFS applies a K-weighting filter before measuring mean square.
 *
 * K-weighting has 2 stages:
 *   Stage 1 (pre-filter): high-shelf biquad at 1681.42Hz, +4dB boost
 *   Stage 2 (RLB): high-pass biquad at 38.1354Hz
 *
 * After filtering, LUFS = -0.691 + 10 * log10(mean_square)
 *
 * Note: this is an instantaneous measurement (one FFT window ≈ 23ms).
 * True LUFS uses 400ms blocks with gating. For learning-loop purposes,
 * the instantaneous K-weighted measurement is a huge improvement over
 * raw RMS and captures the perceptual loudness much more accurately.
 */
function computeKWeightedLUFS(samples: Float32Array, sampleRate: number): number {
  if (samples.length === 0) return -70;

  // ── Stage 1: Pre-filter (high-shelf biquad) ──
  // ITU-R BS.1770-4 coefficients for 48kHz; we'll compute for arbitrary sample rate
  // F0 = 1681.42Hz, G = 4.0dB (shelf gain)
  // For a high-shelf biquad:
  //   b0 = 10^(G/40) * (cos(ω0) + 1) + (1 - cos(ω0))
  //   b1 = -2 * (10^(G/40) - 1) * (1 - cos(ω0))
  //   ...
  // For simplicity, we use the ITU reference coefficients scaled to sample rate.
  // At 48kHz: b0=1.53512485958, b1=-2.6916961894, b2=1.1983928108
  //           a0=1, a1=-0.8929802854, a2=0.1787001614
  // We compute the omega for the actual sample rate and re-derive coefficients.

  // Stage 1 coefficients (high-shelf at 1681Hz, +4dB)
  const f0s1 = 1681.42;
  const Gs1 = 4.0;
  const A1 = Math.pow(10, Gs1 / 40);
  const w0s1 = 2 * Math.PI * f0s1 / sampleRate;
  const cosW0s1 = Math.cos(w0s1);
  const sinW0s1 = Math.sin(w0s1);
  // High-shelf formula (RBJ Audio EQ Cookbook)
  const alpha1 = sinW0s1 / 2 * Math.sqrt((A1 + 1/A1) * (1/0.707 - 1) + 2);
  const b0s1 = A1 * ((A1 + 1) + (A1 - 1) * cosW0s1 + 2 * Math.sqrt(A1) * alpha1);
  const b1s1 = -2 * A1 * ((A1 - 1) + (A1 + 1) * cosW0s1);
  const b2s1 = A1 * ((A1 + 1) + (A1 - 1) * cosW0s1 - 2 * Math.sqrt(A1) * alpha1);
  const a0s1 = (A1 + 1) - (A1 - 1) * cosW0s1 + 2 * Math.sqrt(A1) * alpha1;
  const a1s1 = 2 * ((A1 - 1) - (A1 + 1) * cosW0s1);
  const a2s1 = (A1 + 1) - (A1 - 1) * cosW0s1 - 2 * Math.sqrt(A1) * alpha1;
  // Normalize
  const nb0s1 = b0s1 / a0s1, nb1s1 = b1s1 / a0s1, nb2s1 = b2s1 / a0s1;
  const na1s1 = a1s1 / a0s1, na2s1 = a2s1 / a0s1;

  // ── Stage 2: RLB filter (high-pass at 38Hz) ──
  const f0s2 = 38.1354;
  const w0s2 = 2 * Math.PI * f0s2 / sampleRate;
  const cosW0s2 = Math.cos(w0s2);
  const sinW0s2 = Math.sin(w0s2);
  const Q2 = 0.5;
  const alpha2 = sinW0s2 / (2 * Q2);
  // High-pass formula (RBJ)
  const b0s2 = (1 + cosW0s2) / 2;
  const b1s2 = -(1 + cosW0s2);
  const b2s2 = (1 + cosW0s2) / 2;
  const a0s2 = 1 + alpha2;
  const a1s2 = -2 * cosW0s2;
  const a2s2 = 1 - alpha2;
  const nb0s2 = b0s2 / a0s2, nb1s2 = b1s2 / a0s2, nb2s2 = b2s2 / a0s2;
  const na1s2 = a1s2 / a0s2, na2s2 = a2s2 / a0s2;

  // Apply both biquads in series (Direct Form I)
  let x1_1 = 0, x2_1 = 0, y1_1 = 0, y2_1 = 0;  // stage 1 state
  let x1_2 = 0, x2_2 = 0, y1_2 = 0, y2_2 = 0;  // stage 2 state

  let meanSquare = 0;
  const n = samples.length;
  for (let i = 0; i < n; i++) {
    const x = samples[i];
    if (!isFinite(x)) { x1_1 = x2_1 = y1_1 = y2_1 = 0; x1_2 = x2_2 = y1_2 = y2_2 = 0; continue; }

    // Stage 1 (high-shelf)
    const y1 = nb0s1 * x + nb1s1 * x1_1 + nb2s1 * x2_1 - na1s1 * y1_1 - na2s1 * y2_1;
    x2_1 = x1_1; x1_1 = x; y2_1 = y1_1; y1_1 = y1;

    // Stage 2 (high-pass)
    const y2 = nb0s2 * y1 + nb1s2 * x1_2 + nb2s2 * x2_2 - na1s2 * y1_2 - na2s2 * y2_2;
    x2_2 = x1_2; x1_2 = y1; y2_2 = y1_2; y1_2 = y2;

    meanSquare += y2 * y2;
  }
  meanSquare /= n;

  if (meanSquare < 1e-12) return -70;  // silence

  // LUFS = -0.691 + 10 * log10(mean_square)
  return -0.691 + 10 * Math.log10(meanSquare);
}

/**
 * DEEP GAP C: Convergence metric — a single 0..1 number showing how close
 * the engine's 7 metrics are to the radio's 7 metrics.
 *
 * 1.0 = engine matches radio perfectly.
 * 0.0 = engine is maximally different from radio.
 *
 * Weighted by the same weights used in `overall` so the metric reflects
 * what the learning loop actually cares about.
 */
export function computeConvergence(
  engine: AudioQualityMetrics,
  radio: { warmth: number; brightness: number; punch: number; clarity: number; loudness: number; smoothness: number; balance: number },
): number {
  // Each metric contributes inversely to its distance, weighted.
  const brightnessDist = Math.abs(engine.brightness - radio.brightness);
  const warmthDist = Math.abs(engine.warmth - radio.warmth);
  const punchDist = Math.abs(engine.punch - radio.punch);
  const clarityDist = Math.abs(engine.clarity - radio.clarity);
  const loudnessDist = Math.abs(engine.loudness - radio.loudness);
  const smoothnessDist = Math.abs(engine.smoothness - radio.smoothness);
  const balanceDist = Math.abs(engine.balance - radio.balance);

  // Weighted convergence (same weights as `overall`)
  const brightnessScore = (1 - brightnessDist) * 0.10;
  const warmthScore = (1 - warmthDist) * 0.15;
  const punchScore = (1 - punchDist) * 0.15;
  const clarityScore = (1 - clarityDist) * 0.15;
  const loudnessScore = (1 - loudnessDist) * 0.15;
  const smoothnessScore = (1 - smoothnessDist) * 0.20;
  const balanceScore = (1 - balanceDist) * 0.10;

  return Math.max(0, Math.min(1, brightnessScore + warmthScore + punchScore + clarityScore + loudnessScore + smoothnessScore + balanceScore));
}

/**
 * Analyze audio from an AnalyserNode and compute quality metrics.
 * This is called from the learning loop every poll tick (250ms).
 *
 * FIX (roast GAP 9): accepts OPTIONAL reusable buffers to avoid
 * allocating 4.5KB per call (was: 5-11 calls/sec × 4.5KB = 25-50KB/sec GC pressure).
 */
export function analyzeQuality(
  analyser: AnalyserNode,
  sampleRate: number,
  freqBuf?: Uint8Array,
  tdBuf?: Float32Array,
): AudioQualityMetrics {
  const freqData = freqBuf ?? new Uint8Array(analyser.frequencyBinCount);
  const tdData = tdBuf ?? new Float32Array(analyser.fftSize);
  analyser.getByteFrequencyData(freqData as Uint8Array<ArrayBuffer>);
  analyser.getFloatTimeDomainData(tdData as Float32Array<ArrayBuffer>);

  const binW = sampleRate / analyser.fftSize;

  // ── 1. WARMTH: low/mid ratio (0-200Hz vs 200-2kHz) ──
  let lowEnergy = 0, lowCount = 0;
  let midEnergy = 0, midCount = 0;
  let highEnergy = 0, highCount = 0;
  for (let i = 0; i < freqData.length; i++) {
    const f = i * binW;
    const v = freqData[i];
    if (f < 200) { lowEnergy += v; lowCount++; }
    else if (f < 2000) { midEnergy += v; midCount++; }
    else if (f < 8000) { highEnergy += v; highCount++; }
  }
  const lowAvg = lowEnergy / (lowCount || 1);
  const midAvg = midEnergy / (midCount || 1);
  const highAvg = highEnergy / (highCount || 1);
  const warmthRaw = lowAvg / (midAvg + 1);  // ratio > 1 = bass heavy
  const warmth = Math.min(1, warmthRaw / 2);  // normalize to 0..1

  // ── 2. BRIGHTNESS: spectral centroid (0=dark, 1=bright) ──
  let centroidSum = 0, totalMag = 0;
  for (let i = 0; i < freqData.length; i++) {
    const f = i * binW;
    const v = freqData[i];
    centroidSum += f * v;
    totalMag += v;
  }
  const centroid = totalMag > 0 ? centroidSum / totalMag : 0;
  // Map: 200Hz = 0.0, 5000Hz = 1.0
  const brightness = Math.max(0, Math.min(1, (centroid - 200) / 4800));

  // ── 3. PUNCH: crest factor (peak/rms in time domain) ──
  let peak = 0, rms = 0;
  for (let i = 0; i < tdData.length; i++) {
    const v = Math.abs(tdData[i]);
    if (v > peak) peak = v;
    rms += tdData[i] * tdData[i];
  }
  rms = Math.sqrt(rms / tdData.length);
  const crestDb = peak > 0 && rms > 0 ? 20 * Math.log10(peak / rms) : 0;
  // Map: 0dB = 0.0 (compressed), 15dB = 1.0 (punchy)
  const punch = Math.max(0, Math.min(1, crestDb / 15));

  // ── 4. CLARITY: spectral flatness (0=pure tone, 1=white noise) ──
  // Geometric mean / arithmetic mean of frequency bins
  let logSum = 0, linSum = 0, validBins = 0;
  for (let i = 1; i < freqData.length; i++) {
    const v = freqData[i] / 255;
    if (v > 0.01) {
      logSum += Math.log(v);
      linSum += v;
      validBins++;
    }
  }
  const flatness = validBins > 0
    ? Math.exp(logSum / validBins) / (linSum / validBins + 0.001)
    : 0;
  // Good clarity = flatness between 0.05 (tonal) and 0.3 (rich)
  // Map: 0.05 = 0.0, 0.2 = 1.0, > 0.5 = 0.0 (noise)
  let clarity;
  if (flatness < 0.02) clarity = 0.2;  // too tonal (boring)
  else if (flatness > 0.4) clarity = 0.1;  // too noisy (harsh)
  else if (flatness >= 0.05 && flatness <= 0.2) clarity = 1.0;  // sweet spot
  else clarity = 0.5;

  // ── 5. LOUDNESS: K-weighted LUFS approximation ──
  // DEEP GAP D: was crude `db - 0.691` (raw RMS with gating bias offset).
  // Real LUFS requires:
  //   1. K-weighting filter (high-shelf +4dB at 1681Hz, high-pass at 38Hz)
  //   2. Gating (absolute -70 LUFS + relative -10 LUFS)
  //   3. 400ms block integration
  //
  // We can't do full 400ms block gating from a single AnalyserNode snapshot
  // (it only gives us one fftSize window ≈ 23ms at 44100/1024). But we CAN
  // apply the K-weighting filter to the time-domain data to get a much more
  // accurate perceived-loudness estimate than raw RMS.
  //
  // K-weighting filter (ITU-R BS.1770-4):
  //   Stage 1: high-shelf biquad (pre-filter) — boosts highs ~4dB
  //   Stage 2: high-pass biquad (RLB) — cuts below 38Hz
  //
  // We apply these as IIR filters on the time-domain samples.
  const lufs = computeKWeightedLUFS(tdData, sampleRate);
  // Map: -30 LUFS = 0.0, -3 LUFS = 1.0 (commercial psytrance is -8 to -10 LUFS)
  const loudness = Math.max(0, Math.min(1, (lufs + 30) / 27));

  // ── 6. SMOOTHNESS: inverse THD (harshness detector) ──
  // High harmonics relative to fundamental = harsh
  // Measure: high energy / total energy
  const totalEnergy = lowEnergy + midEnergy + highEnergy;
  const highRatio = totalEnergy > 0 ? highEnergy / totalEnergy : 0.5;
  // Good smoothness: highRatio between 0.20 and 0.50 (realistic for electronic music)
  // Too low = muddy, too high = harsh
  let smoothness;
  if (highRatio < 0.15) smoothness = 0.3;  // muddy
  else if (highRatio > 0.60) smoothness = 0.2;  // harsh
  else if (highRatio >= 0.25 && highRatio <= 0.50) smoothness = 1.0;  // smooth
  else smoothness = 0.6;

  // ── 7. BALANCE: how even the spectrum is ──
  // Compare low:mid:high — ideal is roughly 3:4:2 (bass heavy but mids dominant)
  const total = lowAvg + midAvg + highAvg + 1;
  const lowPct = lowAvg / total;
  const midPct = midAvg / total;
  const highPct = highAvg / total;
  // Target: 35% low, 45% mid, 20% high
  const lowErr = Math.abs(lowPct - 0.35);
  const midErr = Math.abs(midPct - 0.45);
  const highErr = Math.abs(highPct - 0.20);
  const balance = Math.max(0, 1 - (lowErr + midErr + highErr) * 2);

  // ── OVERALL: weighted combination ──
  const overall =
    warmth * 0.15 +      // bass presence matters
    (1 - Math.abs(brightness - 0.5) * 2) * 0.10 +  // centered brightness
    punch * 0.15 +       // transients matter
    clarity * 0.15 +     // clarity matters
    loudness * 0.15 +     // loudness matters
    smoothness * 0.20 +   // smoothness is MOST important (no harshness)
    balance * 0.10;      // balance matters

  return {
    warmth: Math.max(0, Math.min(1, warmth)),
    brightness: Math.max(0, Math.min(1, brightness)),
    punch: Math.max(0, Math.min(1, punch)),
    clarity: Math.max(0, Math.min(1, clarity)),
    loudness: Math.max(0, Math.min(1, loudness)),
    smoothness: Math.max(0, Math.min(1, smoothness)),
    balance: Math.max(0, Math.min(1, balance)),
    overall: Math.max(0, Math.min(1, overall)),
  };
}

/**
 * Compare metrics to targets and produce actionable feedback.
 * Returns which CC params should change and in what direction.
 */
export interface AdjustmentSuggestion {
  cc: number;
  direction: 'up' | 'down';
  amount: number;  // 0..1 how much to adjust
  reason: string;
}

export function suggestAdjustments(metrics: AudioQualityMetrics, targets: QualityTargets): AdjustmentSuggestion[] {
  const suggestions: AdjustmentSuggestion[] = [];

  // If too harsh (high brightness or low smoothness) → reduce cutoff + drive
  if (metrics.brightness > targets.brightnessMax || metrics.smoothness < targets.smoothnessMin) {
    suggestions.push({ cc: 74, direction: 'down', amount: 0.05, reason: 'reduce harshness' });
    suggestions.push({ cc: 12, direction: 'down', amount: 0.03, reason: 'reduce drive' });
  }

  // If too dark → increase cutoff
  if (metrics.brightness < targets.brightnessMin) {
    suggestions.push({ cc: 74, direction: 'up', amount: 0.05, reason: 'increase brightness' });
  }

  // If too muddy (low warmth + low clarity) → increase cutoff, reduce reverb
  if (metrics.warmth > 0.8 && metrics.clarity < targets.clarityMin) {
    suggestions.push({ cc: 74, direction: 'up', amount: 0.04, reason: 'reduce mud' });
    suggestions.push({ cc: 15, direction: 'down', amount: 0.05, reason: 'reduce reverb mud' });
  }

  // If too quiet → increase volume (via energy macro)
  if (metrics.loudness < targets.loudnessMin) {
    suggestions.push({ cc: 12, direction: 'up', amount: 0.05, reason: 'increase loudness' });
  }

  // If too compressed (low punch) → reduce drive
  if (metrics.punch < targets.punchMin) {
    suggestions.push({ cc: 12, direction: 'down', amount: 0.04, reason: 'restore dynamics' });
  }

  // If too noisy (low smoothness + high brightness) → reduce resonance
  if (metrics.smoothness < 0.4 && metrics.brightness > 0.6) {
    suggestions.push({ cc: 71, direction: 'down', amount: 0.05, reason: 'reduce resonance squeal' });
  }

  return suggestions;
}
