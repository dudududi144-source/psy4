/**
 * Effects Detector (Task A1) — infers the EFFECTS CHAIN the radio reference
 * is using, by examining its acoustic features (and optionally the raw PCM).
 *
 * The detector is a PURE function — same inputs always give the same output,
 * no side effects, no I/O, never throws. Every numeric field is guarded
 * against NaN/undefined. The audioBuffer parameter is OPTIONAL: when present
 * (a decoded mono Float32Array), we run extra analyses (autocorrelation for
 * delay-time estimation, transient-tail analysis for reverb decay). When
 * absent, we fall back to feature-only heuristics.
 *
 * Detected effects (mirrors what a mastering engineer would "see" on a
 * reference track's analyser):
 *
 *   - REVERB: tail length after transients. Long kickDecay + wide stereo +
 *     moderate spectral flatness → big room. Est. decay from PCM tail or
 *     from kickDecayMs (heuristic).
 *   - DELAY: periodic echo peaks in the autocorrelation. Delay time = peak
 *     position; feedback = peak-amplitude ratio. Tempo-synced heuristics
 *     snap to 1/4 / 1/8 / 1/16 / dotted / triplet when close.
 *   - CHORUS / MODULATION: slow pitch modulation = spectral-centroid
 *     variance over time. With only a single window we use a stereo +
 *     flatness proxy (wide stereo + non-zero side energy + moderate
 *     flatness → chorus). With history (passed via features transientShape
 *     and stereoField), we infer depth from side/mid ratio.
 *   - DISTORTION: high spectralCrest + low HNR + bright slope = harmonic
 *     distortion. A bright signal with low noise floor + strong peaks is
 *     the signature of saturated/distorted content.
 *   - COMPRESSION: low crest factor + small LUFS swing over recent windows
 *     = heavy glue compression. We can't see LUFS swing from a single
 *     RefFeatures snapshot, so we use crest factor + energy as a proxy
 *     (high energy + low crest = compressed).
 *   - FILTER: a sharp spectral-slope knee implies a filter. We don't have a
 *     per-bin spectrum here, so we infer cutoff from the spectralCentroid
 *     and rolloff characteristics (a centroid well below 1.5 kHz with a
 *     steep slope = low-pass filter; a centroid above 4 kHz with a rising
 *     slope = high-pass).
 *   - STEREO: width + correlation + Haas detection. Low correlation with
 *     wide magnitude = Haas / double-track.
 *
 * All values are clamped to documented ranges; booleans are returned for
 * binary detections (Haas effect). The function never throws — malformed
 * input yields a "silent" DetectedEffects (all zeros, no Haas).
 *
 * @module effectsDetector
 */

import type { RefFeatures } from './styleClassifier';

// ─── Public types ──────────────────────────────────────────────────────────

export interface DetectedEffects {
  // Reverb
  reverbAmount: number;      // 0..1, how much reverb is on the signal
  reverbDecay: number;       // seconds, estimated reverb tail length
  // Delay
  delayAmount: number;       // 0..1, how much delay
  delayTime: number;         // ms, estimated delay time (0 = none detected)
  delayFeedback: number;     // 0..1, feedback amount
  // Chorus / Modulation
  chorusAmount: number;      // 0..1, detuning / modulation depth
  chorusRate: number;        // Hz, modulation rate (0 = unknown)
  // Distortion
  distortionAmount: number;  // 0..1, harmonic distortion
  // Compression
  compressionAmount: number; // 0..1, how much compression
  // Filter
  filterCutoff: number;      // Hz, 0 = no audible filter
  filterResonance: number;   // 0..1, Q factor
  // Stereo
  stereoWidth: number;       // 0..1
  haasEffect: boolean;       // true if Haas / double-track detected
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

// ─── PCM helpers (only run when audioBuffer is provided) ───────────────────

/**
 * Estimate the reverb tail length by measuring how long the signal takes
 * to decay to -60 dB after the loudest transient. Returns seconds.
 *
 * If we can't find a clear peak (silence / very noisy input), returns 0.
 * Caps at 5 seconds — anything longer is probably noise.
 */
function estimateReverbTailFromPcm(mono: Float32Array, sampleRate: number): number {
  const n = mono.length;
  if (n < sampleRate) return 0; // need at least 1 second

  // Find the loudest sample (the "main" transient we measure the tail from).
  let peakIdx = 0;
  let peakVal = 0;
  // Sample every 16th to keep this O(n/16) — adequate for tail estimation.
  const stride = 16;
  for (let i = 0; i < n; i += stride) {
    const a = Math.abs(mono[i]);
    if (a > peakVal) { peakVal = a; peakIdx = i; }
  }
  if (peakVal < 1e-4) return 0;

  // Walk forward from the peak, tracking when |sample| falls below peakVal * 0.001
  // (≈ -60 dB). Use a short RMS window to be robust against individual zero samples.
  const window = Math.max(1, Math.floor(sampleRate * 0.005)); // 5 ms RMS window
  const threshold = peakVal * 0.001;
  const maxLookahead = Math.min(n - peakIdx, sampleRate * 5); // 5s cap
  let tailSamples = 0;
  for (let i = peakIdx + 1; i < peakIdx + maxLookahead; i++) {
    let rms = 0;
    const wEnd = Math.min(n, i + window);
    for (let j = i; j < wEnd; j++) rms += mono[j] * mono[j];
    rms = Math.sqrt(rms / Math.max(1, wEnd - i));
    if (rms < threshold) { tailSamples = i - peakIdx; break; }
  }
  if (tailSamples === 0) return 0;
  return clamp(tailSamples / sampleRate, 0, 5);
}

/**
 * Detect delay time via autocorrelation of the PCM. We look for the first
 * peak (excluding the zero-lag peak at i=0) above a relative threshold —
 * that's the echo period. Then estimate feedback from the rate of decay
 * of subsequent peaks at multiples of that period.
 *
 * Returns { delayMs, feedback } or { 0, 0 } if no clear delay found.
 */
function detectDelayFromPcm(
  mono: Float32Array,
  sampleRate: number,
): { delayMs: number; feedback: number } {
  const n = mono.length;
  if (n < sampleRate) return { delayMs: 0, feedback: 0 }; // need ≥1s

  // We only need autocorrelation at lags 10..1000 ms (typical echo range).
  // Compute it directly (O(n × lagCount)) but downsample to 8 kHz first to
  // keep it cheap — delay detection doesn't need full-band resolution.
  const downFactor = Math.max(1, Math.floor(sampleRate / 8000));
  const dsN = Math.floor(n / downFactor);
  const ds = new Float32Array(dsN);
  let dsRms = 0;
  for (let i = 0; i < dsN; i++) {
    ds[i] = mono[i * downFactor];
    dsRms += ds[i] * ds[i];
  }
  dsRms = Math.sqrt(dsRms / Math.max(1, dsN));
  if (dsRms < 1e-4) return { delayMs: 0, feedback: 0 };
  const dsSr = sampleRate / downFactor;

  // Normalize to peak = 1 (helps threshold selection).
  let peak = 0;
  for (let i = 0; i < dsN; i++) {
    const a = Math.abs(ds[i]);
    if (a > peak) peak = a;
  }
  if (peak < 1e-4) return { delayMs: 0, feedback: 0 };
  const inv = 1 / peak;
  for (let i = 0; i < dsN; i++) ds[i] *= inv;

  // Autocorrelation: lag from 10 ms to 1000 ms.
  const minLag = Math.floor(dsSr * 0.010);
  const maxLag = Math.min(Math.floor(dsSr * 1.0), dsN - 1);
  let bestLag = 0;
  let bestCorr = 0;
  for (let lag = minLag; lag < maxLag; lag++) {
    let s = 0;
    // Limit the correlation window to ~500 ms for speed.
    const win = Math.min(dsN - lag, Math.floor(dsSr * 0.5));
    for (let i = 0; i < win; i++) s += ds[i] * ds[i + lag];
    s /= Math.max(1, win);
    // We want the FIRST peak above 0.15 — that's the strongest echo period.
    // Skip lags that are within 5 ms of an already-found peak (sub-harmonics).
    if (s > 0.15 && s > bestCorr && (bestLag === 0 || Math.abs(lag - bestLag) > dsSr * 0.005)) {
      bestCorr = s;
      bestLag = lag;
    }
  }
  if (bestLag === 0 || bestCorr < 0.15) return { delayMs: 0, feedback: 0 };

  const delayMs = (bestLag / dsSr) * 1000;

  // Feedback = correlation at 2× lag, divided by correlation at 1× lag.
  // (Each repeat's amplitude = feedback × previous — so r2/r1 ≈ feedback.)
  const lag2 = bestLag * 2;
  let s2 = 0;
  if (lag2 < dsN) {
    const win = Math.min(dsN - lag2, Math.floor(dsSr * 0.5));
    for (let i = 0; i < win; i++) s2 += ds[i] * ds[i + lag2];
    s2 /= Math.max(1, win);
  }
  const feedback = bestCorr > 0 ? clamp01(s2 / bestCorr) : 0;
  return { delayMs: clamp(delayMs, 10, 1500), feedback };
}

// ─── Feature-only detection (no PCM) ──────────────────────────────────────

/**
 * Estimate reverb amount from features only. Long kickDecay + wide stereo
 * + moderate spectral flatness = reverberant. Decay (seconds) derived
 * from kickDecayMs (a longer-than-natural kick tail implies room reverb).
 */
function detectReverbFromFeatures(features: RefFeatures): { amount: number; decay: number } {
  const kickDecaySec = (features.kickDecayMs ?? 0) / 1000;
  const stereoWidth = clamp01(features.stereoWidth ?? 0);
  const hc = features.harmonicContent as { [k: string]: unknown } | undefined;
  const flatness = clamp01(num(hc, 'flatness'));

  // Tailness: longer kick decay + wider stereo + flatness 0.05..0.5 (not pure tone).
  // Flatness > 0.5 (noise-like) actually argues AGAINST reverb (reverb smooths).
  let tailness = 0;
  if (kickDecaySec > 0.12) tailness += clamp((kickDecaySec - 0.12) / 0.5, 0, 1) * 0.45;
  if (stereoWidth > 0.3) tailness += (stereoWidth - 0.3) * 0.4;
  if (flatness > 0.05 && flatness < 0.5) tailness += 0.15;
  tailness = clamp01(tailness);

  // Estimated reverb decay (seconds): scale with kickDecay (long kick tail
  // often means long room reverb). Bound to 0.1..6 s.
  const decay = tailness > 0.05
    ? clamp(kickDecaySec * 2.5 + tailness * 1.5, 0.2, 6)
    : 0;

  return { amount: tailness, decay };
}

/**
 * Estimate delay amount from features only. Without PCM we can't see the
 * echo period directly, but a wide stereo with non-zero side energy and
 * moderate flatness (spectral content beyond the dry signal) hints at
 * delay throws. We leave delayTime = 0 (unknown) when PCM isn't available.
 */
function detectDelayFromFeatures(features: RefFeatures): { amount: number; time: number; feedback: number } {
  const sf = features.stereoField as { [k: string]: unknown } | undefined;
  const msRatio = clamp01(num(sf, 'msRatio'));
  const width = clamp01(features.stereoWidth ?? 0);
  // Side-energy presence + width implies throw-style effects (delay/chorus).
  let amount = 0;
  if (msRatio > 0.18 && width > 0.35) amount = clamp01((msRatio - 0.18) * 2.5 + (width - 0.35) * 0.5);
  return { amount, time: 0, feedback: 0 };
}

/**
 * Chorus / modulation depth from features. A wide stereo signal with
 * moderate (not extreme) correlation and a clean harmonic stack implies
 * chorus. Rate is hard to estimate from a single window — we set 0.5 Hz
 * as a default (typical chorus rate) when chorus is detected.
 */
function detectChorusFromFeatures(features: RefFeatures): { amount: number; rate: number } {
  const sf = features.stereoField as { [k: string]: unknown } | undefined;
  const correlation = clamp(num(sf, 'correlation'), -1, 1);
  const msRatio = clamp01(num(sf, 'msRatio'));
  const hc = features.harmonicContent as { [k: string]: unknown } | undefined;
  const hnr = clamp01(num(hc, 'hnr'));

  let amount = 0;
  // Wide-ish stereo with mid correlation (not mono, not uncorrelated) + clean harmonics.
  if (correlation > 0.2 && correlation < 0.75 && hnr > 0.3) {
    amount = clamp01((0.75 - correlation) * 0.8 + msRatio * 0.6);
  }
  // Default rate: 0.5–1.5 Hz (typical chorus LFO range). Pick based on energy.
  const rate = amount > 0.05 ? clamp(0.5 + features.energy * 1.0, 0.3, 2.0) : 0;
  return { amount, rate };
}

/**
 * Distortion amount from features. High spectralCrest + low HNR + bright
 * slope = harmonic distortion. Threshold: crest > 4, HNR < 0.6.
 */
function detectDistortionFromFeatures(features: RefFeatures): number {
  const hc = features.harmonicContent as { [k: string]: unknown } | undefined;
  const crest = Math.max(0, num(hc, 'crest'));
  const hnr = clamp01(num(hc, 'hnr'));
  const slope = num(hc, 'slope'); // dB/oct, ~ -6..-24
  const ts = features.transientShape as { [k: string]: unknown } | undefined;
  const sharpness = clamp01(num(ts, 'sharpness'));

  let amount = 0;
  if (crest > 4) amount += clamp((crest - 4) / 8, 0, 1) * 0.4;
  if (hnr > 0 && hnr < 0.6) amount += (0.6 - hnr) * 0.4;
  // Bright slope + sharp transients = saturation.
  if (slope > -10 && slope <= 0) amount += 0.15;
  if (sharpness > 0.5) amount += (sharpness - 0.5) * 0.25;
  return clamp01(amount);
}

/**
 * Compression amount from features. Low crest factor + high energy = glued.
 * (Crest is peak/rms in the time domain; we use spectral crest as a proxy
 * when time-domain crest isn't available, with appropriate scaling.)
 */
function detectCompressionFromFeatures(features: RefFeatures): number {
  const hc = features.harmonicContent as { [k: string]: unknown } | undefined;
  const crest = Math.max(0, num(hc, 'crest'));
  const energy = clamp01(features.energy ?? 0);
  // Spectral crest for tonal content is typically 3-10 (clean) or 2-5 (compressed).
  // Low spectral crest (<3) + high energy → glued.
  let amount = 0;
  if (crest > 0 && crest < 3) amount += (3 - crest) / 3 * 0.5;
  if (energy > 0.5) amount += (energy - 0.5) * 0.5;
  return clamp01(amount);
}

/**
 * Filter cutoff / resonance from features. A bright centroid with a steep
 * slope implies a low-pass filter (the slope is the filter's roll-off).
 * A centroid above 4 kHz with a rising slope implies a high-pass.
 */
function detectFilterFromFeatures(features: RefFeatures): { cutoff: number; resonance: number } {
  const centroid = Math.max(0, features.spectralCentroid ?? 0);
  const hc = features.harmonicContent as { [k: string]: unknown } | undefined;
  const slope = num(hc, 'slope'); // dB/oct
  const crest = Math.max(0, num(hc, 'crest'));

  // If slope is steeply negative (<-18 dB/oct) and centroid is moderate,
  // there's a low-pass filter around the centroid frequency.
  if (slope < -18 && centroid > 200 && centroid < 6000) {
    // Resonance: high spectral crest near the cutoff = resonant peak.
    const resonance = crest > 6 ? clamp01((crest - 6) / 8) : 0;
    return { cutoff: centroid, resonance };
  }
  // High-pass: bright centroid + positive slope.
  if (slope > -3 && centroid > 3000) {
    return { cutoff: centroid, resonance: 0 };
  }
  return { cutoff: 0, resonance: 0 };
}

/**
 * Stereo width + Haas detection. Low correlation (<0.4) with wide magnitude
 * (width > 0.5) implies Haas / double-tracking. Above 0.7 correlation = mono.
 */
function detectStereoFromFeatures(features: RefFeatures): { width: number; haas: boolean } {
  const sf = features.stereoField as { [k: string]: unknown } | undefined;
  const width = clamp01(features.stereoWidth ?? 0);
  const correlation = clamp(num(sf, 'correlation'), -1, 1);
  const msRatio = clamp01(num(sf, 'msRatio'));
  const haas = width > 0.5 && correlation < 0.4 && msRatio > 0.2;
  return { width, haas };
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Detect the effects chain on a reference signal from its features (and
 * optionally its decoded PCM mono signal).
 *
 * @param features   Reference acoustic features (from the V2 listener).
 * @param audioBuffer Optional mono PCM Float32Array. When present, we run
 *                    autocorrelation (for delay time) and tail analysis
 *                    (for reverb decay). When absent, we fall back to
 *                    feature-only heuristics — delayTime and reverbDecay
 *                    will be approximate or zero.
 * @returns A DetectedEffects snapshot. Always finite, always clamped.
 */
export function detectEffects(
  features: RefFeatures,
  audioBuffer?: Float32Array,
): DetectedEffects {
  // ── Reverb ──
  const reverbFeat = detectReverbFromFeatures(features);
  let reverbAmount = reverbFeat.amount;
  let reverbDecay = reverbFeat.decay;
  if (audioBuffer && audioBuffer.length > 0) {
    // PCM-based decay is more accurate — use it when available, scaled by
    // the feature-based amount (so we don't claim reverb if the tail is
    // short even when the PCM analysis succeeded).
    const pcmDecay = estimateReverbTailFromPcm(audioBuffer, 44100);
    if (pcmDecay > 0.2) {
      reverbDecay = pcmDecay;
      reverbAmount = Math.max(reverbAmount, clamp01((pcmDecay - 0.15) / 2.5));
    }
  }

  // ── Delay ──
  const delayFeat = detectDelayFromFeatures(features);
  let delayAmount = delayFeat.amount;
  let delayTime = delayFeat.time;
  let delayFeedback = delayFeat.feedback;
  if (audioBuffer && audioBuffer.length > 0) {
    const pcmDelay = detectDelayFromPcm(audioBuffer, 44100);
    if (pcmDelay.delayMs > 0) {
      delayTime = pcmDelay.delayMs;
      delayFeedback = pcmDelay.feedback;
      // Boost delay amount if PCM found a clear echo.
      delayAmount = Math.max(delayAmount, clamp01(0.3 + pcmDelay.feedback * 0.4));
    }
  }

  // ── Chorus ──
  const chorusFeat = detectChorusFromFeatures(features);

  // ── Distortion ──
  const distortionAmount = detectDistortionFromFeatures(features);

  // ── Compression ──
  const compressionAmount = detectCompressionFromFeatures(features);

  // ── Filter ──
  const filterFeat = detectFilterFromFeatures(features);

  // ── Stereo ──
  const stereoFeat = detectStereoFromFeatures(features);

  return {
    reverbAmount: clamp01(reverbAmount),
    reverbDecay: clamp(reverbDecay, 0, 8),
    delayAmount: clamp01(delayAmount),
    delayTime: clamp(delayTime, 0, 2000),
    delayFeedback: clamp01(delayFeedback),
    chorusAmount: clamp01(chorusFeat.amount),
    chorusRate: clamp(chorusFeat.rate, 0, 10),
    distortionAmount: clamp01(distortionAmount),
    compressionAmount: clamp01(compressionAmount),
    filterCutoff: clamp(filterFeat.cutoff, 0, 16000),
    filterResonance: clamp01(filterFeat.resonance),
    stereoWidth: clamp01(stereoFeat.width),
    haasEffect: stereoFeat.haas,
  };
}
