/**
 * World Differentiator — tests whether different worlds actually produce
 * different audio output.
 *
 * Renders the same seed for multiple worlds, then compares:
 *   - Spectral distance (Euclidean distance between averaged spectra)
 *   - Bass RMS difference
 *   - Spectral centroid difference
 *   - Low-end difference
 *
 * If the differences are negligible, the WORLD SYSTEM HAS FAILED — params
 * are different in code but don't affect the audio.
 */

import { render, downmixToMono, SR } from './offlineRenderer';
import { analyzeAudio, powerSpectrum, hannWindow } from './audioAnalyzer';
import { FORENSIC_WORLDS, FORENSIC_WORLD_IDS } from './worlds';
import type { AudioAnalysis } from './audioAnalyzer';

export interface WorldComparison {
  worldA: string;
  worldB: string;
  spectralDistance: number;    // 0 = identical, higher = more different
  bassRmsDiff: number;         // absolute difference in bass RMS
  centroidDiff: number;        // absolute difference in spectral centroid (Hz)
  lowEndDiff: number;          // absolute difference in low-end RMS
  lufsDiff: number;            // LUFS difference
  bpmDiff: number;             // BPM difference
  verdict: string;             // DIFFERENT / SIMILAR / IDENTICAL
}

export interface WorldDifferentiationReport {
  comparisons: WorldComparison[];
  averageSpectralDistance: number;
  maxSpectralDistance: number;
  minSpectralDistance: number;
  worldSystemFailed: boolean;
  summary: string;
  // Note: per-world analyses are NOT included here to keep JSON serializable.
  // They're stored separately in the ForensicReport.worldAnalyses.
}

/**
 * Compute the average power spectrum of a mono signal.
 */
function averageSpectrum(samples: Float32Array): Float32Array {
  const fftSize = 8192;
  const window = hannWindow(fftSize);
  const hopSize = fftSize / 2;
  const numHops = Math.floor((samples.length - fftSize) / hopSize) + 1;

  const avgMag = new Float32Array(fftSize / 2 + 1);
  const actualHops = Math.max(1, numHops);

  for (let h = 0; h < actualHops; h++) {
    const start = h * hopSize;
    const frame = samples.subarray(start, start + fftSize);
    const padded = new Float32Array(fftSize);
    const len = Math.min(fftSize, frame.length);
    for (let i = 0; i < len; i++) padded[i] = frame[i];
    const mag = powerSpectrum(padded, window);
    for (let i = 0; i < avgMag.length; i++) {
      avgMag[i] += mag[i];
    }
  }
  for (let i = 0; i < avgMag.length; i++) {
    avgMag[i] /= actualHops;
  }
  return avgMag;
}

/**
 * Spectral distance via Euclidean distance between normalized spectra.
 */
function spectralDistance(spec1: Float32Array, spec2: Float32Array): number {
  const n = Math.min(spec1.length, spec2.length);
  // Normalize both spectra
  let max1 = 0, max2 = 0;
  for (let i = 0; i < n; i++) {
    if (spec1[i] > max1) max1 = spec1[i];
    if (spec2[i] > max2) max2 = spec2[i];
  }
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const d = (spec1[i] / (max1 + 1e-12)) - (spec2[i] / (max2 + 1e-12));
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / n);
}

/**
 * Run the world differentiation test.
 * Renders the same seed for all worlds and compares outputs.
 */
export function differentiateWorlds(
  seed: number,
  duration: number = 20,
  worldIds: string[] = FORENSIC_WORLD_IDS,
): WorldDifferentiationReport {
  // Render each world
  const renders: Record<string, { mono: Float32Array; analysis: AudioAnalysis; spectrum: Float32Array }> = {};
  const analyses: Record<string, AudioAnalysis> = {};

  for (const wid of worldIds) {
    const result = render(seed, wid, duration);
    const mono = downmixToMono(result.samplesL, result.samplesR);
    const analysis = analyzeAudio(result.samplesL, result.samplesR, SR);
    const spectrum = averageSpectrum(mono);
    renders[wid] = { mono, analysis, spectrum };
    analyses[wid] = analysis;
  }

  // Compare all pairs
  const comparisons: WorldComparison[] = [];
  for (let i = 0; i < worldIds.length; i++) {
    for (let j = i + 1; j < worldIds.length; j++) {
      const a = worldIds[i];
      const b = worldIds[j];
      const ra = renders[a];
      const rb = renders[b];

      const specDist = spectralDistance(ra.spectrum, rb.spectrum);
      const bassRmsDiff = Math.abs(ra.analysis.lowEnd.bassRms - rb.analysis.lowEnd.bassRms);
      const centroidDiff = Math.abs(ra.analysis.spectrum.centroidHz - rb.analysis.spectrum.centroidHz);
      const lowEndDiff = Math.abs(
        (ra.analysis.lowEnd.kickRms + ra.analysis.lowEnd.bassRms) -
        (rb.analysis.lowEnd.kickRms + rb.analysis.lowEnd.bassRms)
      );
      const lufsDiff = Math.abs(ra.analysis.dynamics.lufs - rb.analysis.dynamics.lufs);
      const bpmDiff = Math.abs(FORENSIC_WORLDS[a].bpm - FORENSIC_WORLDS[b].bpm);

      let verdict = 'DIFFERENT';
      if (specDist < 0.01) verdict = 'IDENTICAL';
      else if (specDist < 0.05) verdict = 'SIMILAR';
      else if (specDist < 0.10) verdict = 'MODERATELY DIFFERENT';

      comparisons.push({
        worldA: a,
        worldB: b,
        spectralDistance: specDist,
        bassRmsDiff,
        centroidDiff,
        lowEndDiff,
        lufsDiff,
        bpmDiff,
        verdict,
      });
    }
  }

  const distances = comparisons.map(c => c.spectralDistance);
  const averageSpectralDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
  const maxSpectralDistance = Math.max(...distances);
  const minSpectralDistance = Math.min(...distances);

  // World system fails if average spectral distance is too small
  const worldSystemFailed = averageSpectralDistance < 0.05;

  let summary: string;
  if (worldSystemFailed) {
    summary = `WORLD SYSTEM FAILED: average spectral distance ${averageSpectralDistance.toFixed(4)} < 0.05 — worlds sound the same`;
  } else if (averageSpectralDistance < 0.10) {
    summary = `WORLD SYSTEM WEAK: average spectral distance ${averageSpectralDistance.toFixed(4)} — worlds are only moderately different`;
  } else {
    summary = `WORLD SYSTEM OK: average spectral distance ${averageSpectralDistance.toFixed(4)} — worlds are differentiated`;
  }

  return {
    comparisons,
    averageSpectralDistance,
    maxSpectralDistance,
    minSpectralDistance,
    worldSystemFailed,
    summary,
  };
}
