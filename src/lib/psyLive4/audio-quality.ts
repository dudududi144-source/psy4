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

// Commercial psytrance targets (measured from reference tracks)
export const COMMERCIAL_TARGETS: QualityTargets = {
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
 * Analyze audio from an AnalyserNode and compute quality metrics.
 * This is called from the learning loop every poll tick (250ms).
 */
export function analyzeQuality(analyser: AnalyserNode, sampleRate: number): AudioQualityMetrics {
  const freqData = new Uint8Array(analyser.frequencyBinCount);
  const tdData = new Float32Array(analyser.fftSize);
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

  // ── 5. LOUDNESS: LUFS approximation ──
  const meanSquare = rms * rms;
  const db = 10 * Math.log10(meanSquare || 1e-10);
  const lufs = db - 0.691;
  // Map: -30 LUFS = 0.0, -3 LUFS = 1.0 (wider range for quiet streams)
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
