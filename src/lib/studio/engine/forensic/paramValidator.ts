/**
 * Parameter Validator — tests whether each world parameter actually affects
 * the rendered audio output.
 *
 * For each parameter:
 *   1. Render with the parameter at its minimum value
 *   2. Render with the parameter at its maximum value
 *   3. Compare the outputs (spectral distance + RMS difference)
 *   4. If the difference is negligible, flag as DEAD PARAMETER
 *
 * This proves: param changed → rendered waveform changed.
 * If not, the parameter is not wired to the DSP.
 */

import { render, downmixToMono, SR } from './offlineRenderer';
import { powerSpectrum, hannWindow } from './audioAnalyzer';
import { FORENSIC_WORLDS, type Psy4World } from './worlds';
import {
  V_KICK, V_BASS, V_LEAD, V_ACID, V_PAD,
} from './voices';

export interface ParamTestResult {
  paramName: string;
  minValue: number;
  maxValue: number;
  spectralDistance: number;   // 0 = identical
  rmsDifference: number;      // absolute RMS difference
  waveformDifference: number; // average absolute sample difference
  verdict: 'ACTIVE' | 'WEAK' | 'DEAD';
  explanation: string;
}

export interface ParamValidationReport {
  worldId: string;
  results: ParamTestResult[];
  deadParams: string[];
  weakParams: string[];
  activeParams: string[];
  summary: string;
}

/**
 * The world parameters to validate.
 * Each entry defines the parameter name, its min/max test range, and which
 * voices to isolate when testing (so the parameter's effect isn't masked by
 * louder voices like the kick).
 */
const PARAM_TESTS: { name: keyof Psy4World; min: number; max: number; voices?: number[] }[] = [
  { name: 'kickFundamental', min: 40, max: 65, voices: [V_KICK] },
  { name: 'kickDecay', min: 0.10, max: 0.30, voices: [V_KICK] },
  { name: 'bassCutoff', min: 200, max: 800, voices: [V_BASS] },
  { name: 'bassResonance', min: 2, max: 15, voices: [V_BASS] },
  { name: 'leadCutoff', min: 1000, max: 5000, voices: [V_LEAD] },
  { name: 'leadDetune', min: 5, max: 25, voices: [V_LEAD] },
  { name: 'padCutoff', min: 600, max: 2500, voices: [V_PAD] },
  { name: 'duck', min: 0.2, max: 0.7, voices: [V_KICK, V_BASS] },
];

/**
 * Compute spectral distance between two mono signals.
 */
function computeSpectralDistance(samples1: Float32Array, samples2: Float32Array): number {
  const fftSize = 4096;
  const window = hannWindow(fftSize);
  const spec1 = powerSpectrum(samples1.subarray(0, fftSize), window);
  const spec2 = powerSpectrum(samples2.subarray(0, fftSize), window);

  let max1 = 0, max2 = 0;
  for (let i = 0; i < spec1.length; i++) {
    if (spec1[i] > max1) max1 = spec1[i];
    if (spec2[i] > max2) max2 = spec2[i];
  }

  let sumSq = 0;
  for (let i = 0; i < spec1.length; i++) {
    const d = (spec1[i] / (max1 + 1e-12)) - (spec2[i] / (max2 + 1e-12));
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / spec1.length);
}

/**
 * Compute the average absolute sample difference between two signals.
 */
function computeWaveformDifference(samples1: Float32Array, samples2: Float32Array): number {
  const n = Math.min(samples1.length, samples2.length);
  let sumDiff = 0;
  for (let i = 0; i < n; i++) {
    sumDiff += Math.abs(samples1[i] - samples2[i]);
  }
  return sumDiff / n;
}

/**
 * Compute RMS of a signal.
 */
function computeRms(samples: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
  }
  return Math.sqrt(sumSq / samples.length);
}

/**
 * Validate all world parameters for a given world.
 */
export function validateParams(
  worldId: string,
  seed: number = 1234,
  duration: number = 10,
): ParamValidationReport {
  const baseWorld = FORENSIC_WORLDS[worldId];
  const results: ParamTestResult[] = [];

  for (const test of PARAM_TESTS) {
    // Render with min value — isolate the affected voice so the parameter's
    // effect isn't masked by louder voices (e.g., kick masking bass/lead)
    const renderMin = render(seed, worldId, duration, {
      paramOverrides: { [test.name]: test.min } as Partial<Psy4World>,
      onlyVoices: test.voices,
    });
    const monoMin = downmixToMono(renderMin.samplesL, renderMin.samplesR);

    // Render with max value
    const renderMax = render(seed, worldId, duration, {
      paramOverrides: { [test.name]: test.max } as Partial<Psy4World>,
      onlyVoices: test.voices,
    });
    const monoMax = downmixToMono(renderMax.samplesL, renderMax.samplesR);

    // Compare
    const spectralDistance = computeSpectralDistance(monoMin, monoMax);
    const rmsMin = computeRms(monoMin);
    const rmsMax = computeRms(monoMax);
    const rmsDifference = Math.abs(rmsMin - rmsMax);
    const waveformDifference = computeWaveformDifference(monoMin, monoMax);

    let verdict: 'ACTIVE' | 'WEAK' | 'DEAD';
    let explanation: string;

    if (spectralDistance < 0.005 && waveformDifference < 0.001) {
      verdict = 'DEAD';
      explanation = `DEAD PARAMETER: ${test.name} has no measurable effect on output (spectral distance ${spectralDistance.toFixed(4)})`;
    } else if (spectralDistance < 0.02 && waveformDifference < 0.01) {
      verdict = 'WEAK';
      explanation = `WEAK: ${test.name} has minimal effect (spectral distance ${spectralDistance.toFixed(4)}, waveform diff ${waveformDifference.toFixed(4)})`;
    } else {
      verdict = 'ACTIVE';
      explanation = `ACTIVE: ${test.name} changes output (spectral distance ${spectralDistance.toFixed(4)}, waveform diff ${waveformDifference.toFixed(4)})`;
    }

    results.push({
      paramName: test.name,
      minValue: test.min,
      maxValue: test.max,
      spectralDistance,
      rmsDifference,
      waveformDifference,
      verdict,
      explanation,
    });
  }

  const deadParams = results.filter(r => r.verdict === 'DEAD').map(r => r.paramName);
  const weakParams = results.filter(r => r.verdict === 'WEAK').map(r => r.paramName);
  const activeParams = results.filter(r => r.verdict === 'ACTIVE').map(r => r.paramName);

  let summary: string;
  if (deadParams.length > 0) {
    summary = `${deadParams.length} DEAD PARAMETER(S): ${deadParams.join(', ')}`;
  } else if (weakParams.length > 0) {
    summary = `${weakParams.length} WEAK PARAMETER(S): ${weakParams.join(', ')}`;
  } else {
    summary = `All ${activeParams.length} parameters are ACTIVE`;
  }

  return {
    worldId,
    results,
    deadParams,
    weakParams,
    activeParams,
    summary,
  };
}
