/**
 * Repetition Detector — measures musical repetition at 4/8/16-bar and
 * section-level granularity.
 *
 * Compares spectral similarity between segments. If 8-bar similarity > 95%,
 * that's a LOOP WARNING. If sections are too similar, arrangement is
 * structurally repetitive.
 *
 * Uses spectral correlation (normalized cross-correlation of power spectra).
 */

import { powerSpectrum, hannWindow } from './audioAnalyzer';

export interface SegmentSimilarity {
  label: string;
  barRange1: [number, number];
  barRange2: [number, number];
  similarity: number;     // 0..1 (1 = identical spectrum)
  verdict: string;
}

export interface RepetitionReport {
  fourBar: SegmentSimilarity[];
  eightBar: SegmentSimilarity[];
  sixteenBar: SegmentSimilarity[];
  sectionSimilarity: SegmentSimilarity[];
  averageFourBar: number;
  averageEightBar: number;
  averageSixteenBar: number;
  maxEightBar: number;
  loopWarning: boolean;         // true if any 8-bar similarity > 0.95
  arrangementRepetitive: boolean; // true if DROP A ≈ DROP B ≈ FINAL DROP
  summary: string;
}

const SR = 44100;

/**
 * Compute the average power spectrum of a segment of audio.
 */
function segmentSpectrum(samples: Float32Array, start: number, end: number, sr: number): Float32Array {
  const fftSize = 4096;
  const window = hannWindow(fftSize);
  const hopSize = fftSize / 2;
  const numHops = Math.floor((end - start - fftSize) / hopSize) + 1;

  if (numHops <= 0) {
    // Segment too short — pad
    const frame = new Float32Array(fftSize);
    const len = Math.min(fftSize, end - start);
    for (let i = 0; i < len; i++) frame[i] = samples[start + i];
    return powerSpectrum(frame, window);
  }

  const avgMag = new Float32Array(fftSize / 2 + 1);
  for (let h = 0; h < numHops; h++) {
    const frameStart = start + h * hopSize;
    const frame = samples.subarray(frameStart, frameStart + fftSize);
    const mag = powerSpectrum(frame, window);
    for (let i = 0; i < avgMag.length; i++) {
      avgMag[i] += mag[i];
    }
  }
  for (let i = 0; i < avgMag.length; i++) {
    avgMag[i] /= numHops;
  }
  return avgMag;
}

/**
 * Spectral similarity via normalized cross-correlation.
 * 1.0 = identical, 0.0 = uncorrelated.
 */
function spectralSimilarity(spec1: Float32Array, spec2: Float32Array): number {
  const n = Math.min(spec1.length, spec2.length);
  let mean1 = 0, mean2 = 0;
  for (let i = 0; i < n; i++) { mean1 += spec1[i]; mean2 += spec2[i]; }
  mean1 /= n; mean2 /= n;

  let numerator = 0;
  let denom1 = 0;
  let denom2 = 0;
  for (let i = 0; i < n; i++) {
    const d1 = spec1[i] - mean1;
    const d2 = spec2[i] - mean2;
    numerator += d1 * d2;
    denom1 += d1 * d1;
    denom2 += d2 * d2;
  }
  const denom = Math.sqrt(denom1 * denom2);
  return denom > 0 ? numerator / denom : 0;
}

/**
 * Detect repetition in a rendered audio signal.
 * @param samples Mono audio samples
 * @param bpm Beats per minute (to compute bar boundaries)
 * @param sr Sample rate
 */
export function detectRepetition(
  samples: Float32Array,
  bpm: number,
  sr: number = SR,
): RepetitionReport {
  const secondsPerBeat = 60 / bpm;
  const secondsPerBar = secondsPerBeat * 4; // 4/4 time
  const samplesPerBar = Math.floor(secondsPerBar * sr);
  const totalBars = Math.floor(samples.length / samplesPerBar);

  const fourBar: SegmentSimilarity[] = [];
  const eightBar: SegmentSimilarity[] = [];
  const sixteenBar: SegmentSimilarity[] = [];

  // Helper: compare consecutive non-overlapping segments
  const compareSegments = (barSize: number, label: string): SegmentSimilarity[] => {
    const results: SegmentSimilarity[] = [];
    const numSegments = Math.floor(totalBars / barSize);
    for (let i = 0; i < numSegments - 1; i++) {
      const start1 = i * barSize * samplesPerBar;
      const end1 = start1 + barSize * samplesPerBar;
      const start2 = (i + 1) * barSize * samplesPerBar;
      const end2 = start2 + barSize * samplesPerBar;
      if (end2 > samples.length) break;

      const spec1 = segmentSpectrum(samples, start1, end1, sr);
      const spec2 = segmentSpectrum(samples, start2, end2, sr);
      const sim = spectralSimilarity(spec1, spec2);

      let verdict = 'EVOLVING';
      if (sim > 0.98) verdict = 'IDENTICAL';
      else if (sim > 0.95) verdict = 'LOOP WARNING';
      else if (sim > 0.85) verdict = 'HIGHLY SIMILAR';
      else if (sim > 0.70) verdict = 'SIMILAR';

      results.push({
        label: `${label} #${i + 1} vs #${i + 2}`,
        barRange1: [i * barSize, (i + 1) * barSize - 1],
        barRange2: [(i + 1) * barSize, (i + 2) * barSize - 1],
        similarity: sim,
        verdict,
      });
    }
    return results;
  };

  // Compute similarities for each bar size
  const fourBarResults = compareSegments(4, '4-bar');
  const eightBarResults = compareSegments(8, '8-bar');
  const sixteenBarResults = compareSegments(16, '16-bar');

  fourBar.push(...fourBarResults);
  eightBar.push(...eightBarResults);
  sixteenBar.push(...sixteenBarResults);

  const avg = (arr: SegmentSimilarity[]) =>
    arr.length > 0 ? arr.reduce((a, s) => a + s.similarity, 0) / arr.length : 0;

  const averageFourBar = avg(fourBar);
  const averageEightBar = avg(eightBar);
  const averageSixteenBar = avg(sixteenBar);
  const maxEightBar = eightBar.length > 0 ? Math.max(...eightBar.map(s => s.similarity)) : 0;

  const loopWarning = maxEightBar > 0.95;

  // Section similarity — compare drops against each other
  // This requires knowing the arrangement structure. We'll approximate by
  // comparing equal-sized chunks at 25%, 50%, and 75% of the track.
  const sectionSimilarity: SegmentSimilarity[] = [];
  if (totalBars >= 32) {
    const sectionBars = 16;
    const dropAStart = Math.floor(totalBars * 0.35);
    const dropBStart = Math.floor(totalBars * 0.60);
    const finalDropStart = Math.floor(totalBars * 0.80);

    const comparisons: [string, number, number][] = [
      ['DROP A vs DROP B', dropAStart, dropBStart],
      ['DROP A vs FINAL DROP', dropAStart, finalDropStart],
      ['DROP B vs FINAL DROP', dropBStart, finalDropStart],
    ];

    for (const [label, s1, s2] of comparisons) {
      const start1 = s1 * samplesPerBar;
      const end1 = start1 + sectionBars * samplesPerBar;
      const start2 = s2 * samplesPerBar;
      const end2 = start2 + sectionBars * samplesPerBar;
      if (end2 > samples.length) continue;

      const spec1 = segmentSpectrum(samples, start1, end1, sr);
      const spec2 = segmentSpectrum(samples, start2, end2, sr);
      const sim = spectralSimilarity(spec1, spec2);

      let verdict = 'DIFFERENT';
      if (sim > 0.95) verdict = 'STRUCTURALLY IDENTICAL';
      else if (sim > 0.90) verdict = 'HIGHLY REPETITIVE';
      else if (sim > 0.80) verdict = 'REPETITIVE';

      sectionSimilarity.push({
        label,
        barRange1: [s1, s1 + sectionBars - 1],
        barRange2: [s2, s2 + sectionBars - 1],
        similarity: sim,
        verdict,
      });
    }
  }

  const dropSimilarities = sectionSimilarity.filter(s =>
    s.label.includes('DROP')).map(s => s.similarity);
  const arrangementRepetitive = dropSimilarities.length >= 2 &&
    dropSimilarities.every(s => s > 0.90);

  let summary: string;
  if (loopWarning) {
    summary = `LOOP WARNING: 8-bar similarity ${maxEightBar.toFixed(3)} > 0.95 threshold`;
  } else if (arrangementRepetitive) {
    summary = `ARRANGEMENT IS STRUCTURALLY REPETITIVE: drops are too similar`;
  } else if (averageEightBar > 0.85) {
    summary = `High repetition: 8-bar avg ${averageEightBar.toFixed(3)}`;
  } else {
    summary = `Evolving: 8-bar avg ${averageEightBar.toFixed(3)}, max ${maxEightBar.toFixed(3)}`;
  }

  return {
    fourBar, eightBar, sixteenBar, sectionSimilarity,
    averageFourBar, averageEightBar, averageSixteenBar,
    maxEightBar, loopWarning, arrangementRepetitive,
    summary,
  };
}
