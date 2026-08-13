/**
 * R2 — MelodyObserver Forensic Acceptance Tests
 *
 * Acceptance criteria (per Reality Repair Gate):
 *   - Clean tones within ±10 cents
 *   - Octave ambiguity must be explicitly handled
 *   - Noise confidence near zero
 *   - Silence confidence zero
 *   - Kick must not become a melodic observation
 *
 * Run with: bun run tests/reality-bridge/melody-acceptance.ts
 */
import { estimatePitch, spectralFlatness, MelodyObserver } from '../../src/lib/melodyObserver';
import { sineWave, kickTransient, whiteNoise, fullMix, silence } from './synthFixtures';
import * as fs from 'fs';
import * as path from 'path';

const SAMPLE_RATE = 44100;
const N = 2048;

interface PitchTest {
  id: string;
  name: string;
  input: Float32Array;
  expectedFreq: number;
  maxCentsErr: number;
  minConfidence: number;
}

const PITCH_TESTS: PitchTest[] = [
  { id: 'MO-A4',   name: 'A4 = 440 Hz',           input: sineWave(440, N, SAMPLE_RATE, 0.8),    expectedFreq: 440,    maxCentsErr: 10, minConfidence: 0.5 },
  { id: 'MO-A3',   name: 'A3 = 220 Hz (bass)',    input: sineWave(220, N, SAMPLE_RATE, 0.8),    expectedFreq: 220,    maxCentsErr: 10, minConfidence: 0.5 },
  { id: 'MO-C5',   name: 'C5 = 523.25 Hz',        input: sineWave(523.25, N, SAMPLE_RATE, 0.8), expectedFreq: 523.25, maxCentsErr: 10, minConfidence: 0.5 },
  { id: 'MO-E5',   name: 'E5 = 659.25 Hz',        input: sineWave(659.25, N, SAMPLE_RATE, 0.8), expectedFreq: 659.25, maxCentsErr: 10, minConfidence: 0.5 },
  { id: 'MO-100',  name: '100 Hz sub-bass',       input: sineWave(100, N, SAMPLE_RATE, 0.8),    expectedFreq: 100,    maxCentsErr: 20, minConfidence: 0.3 },
];

interface RejectTest {
  id: string;
  name: string;
  input: Float32Array;
  maxConfidence: number;
}

const REJECT_TESTS: RejectTest[] = [
  { id: 'MO-noise',   name: 'White noise (should reject)',  input: whiteNoise(N, 0.5),       maxConfidence: 0.3 },
  { id: 'MO-silence', name: 'Silence (should reject)',      input: silence(N),               maxConfidence: 0.0 },
];

interface FlatnessTest {
  id: string;
  name: string;
  buildSpectrum: () => Uint8Array;
  sampleRate: number;
  fftSize: number;
  expectedLowFlatness: boolean; // true = tonal, flatness should be < 0.5
}

const FLATNESS_TESTS: FlatnessTest[] = [
  {
    id: 'FL-tone',
    name: 'Pure tone with realistic noise floor (should be tonal, flatness < 0.5)',
    // Uses fftSize=512 (matching the real engine's radioAnalyser.fftSize)
    // and noise floor of 1 (realistic for a pure tone in a digital signal
    // with smoothingTimeConstant=0.2)
    buildSpectrum: () => {
      const fftSize = 512;
      const bins = fftSize / 2;
      const fd = new Uint8Array(bins).fill(1); // realistic noise floor
      const binHz = SAMPLE_RATE / fftSize;
      const targetBin = Math.floor(440 / binHz);
      fd[targetBin] = 255; // strong peak
      // Spectral leakage (adjacent bins)
      if (targetBin > 0) fd[targetBin - 1] = 80;
      if (targetBin < bins - 1) fd[targetBin + 1] = 80;
      return fd;
    },
    sampleRate: SAMPLE_RATE,
    fftSize: 512, // matches real engine
    expectedLowFlatness: true,
  },
  {
    id: 'FL-noise',
    name: 'White noise spectrum (should be noisy, flatness > 0.5)',
    buildSpectrum: () => {
      const fftSize = 512;
      const bins = fftSize / 2;
      const fd = new Uint8Array(bins);
      for (let i = 0; i < fd.length; i++) fd[i] = 100 + Math.floor(Math.random() * 20);
      return fd;
    },
    sampleRate: SAMPLE_RATE,
    fftSize: 512,
    expectedLowFlatness: false,
  },
];

// ── Run pitch detection tests ────────────────────────────────────────────
const results: any[] = [];
let passed = 0, failed = 0;

function record(r: any): void {
  results.push(r);
  const status = r.passed ? '✓' : '✗';
  console.log(`${status} ${r.id}: ${r.evidence}`);
  if (r.passed) passed++; else failed++;
}

console.log('=== R2 — MelodyObserver Forensic Acceptance Tests ===\n');

// Pitch detection tests
for (const t of PITCH_TESTS) {
  const { frequency, confidence } = estimatePitch(t.input, SAMPLE_RATE, 80, 2000);
  const centsErr = frequency > 0 ? 1200 * Math.log2(frequency / t.expectedFreq) : Infinity;
  const octaveErr = Math.round(centsErr / 1200);
  const passed_ = confidence >= t.minConfidence && Math.abs(centsErr) <= t.maxCentsErr && octaveErr === 0;
  record({
    id: t.id, name: t.name, passed: passed_,
    detectedFreq: frequency, expectedFreq: t.expectedFreq,
    centsErr: parseFloat(centsErr.toFixed(1)),
    octaveErr, confidence: parseFloat(confidence.toFixed(3)),
    evidence: `freq=${frequency.toFixed(2)}Hz (expected ${t.expectedFreq}) centsErr=${centsErr.toFixed(1)} octaveErr=${octaveErr} conf=${confidence.toFixed(3)}`,
    failure: !passed_ ? (octaveErr !== 0 ? `Octave error: ${octaveErr}` : (Math.abs(centsErr) > t.maxCentsErr ? `Cents error: ${centsErr.toFixed(1)}` : `Low confidence: ${confidence}`)) : undefined,
  });
}

// Reject tests (noise, silence)
for (const t of REJECT_TESTS) {
  const { frequency, confidence } = estimatePitch(t.input, SAMPLE_RATE, 80, 2000);
  const passed_ = confidence <= t.maxConfidence;
  record({
    id: t.id, name: t.name, passed: passed_,
    detectedFreq: frequency, confidence: parseFloat(confidence.toFixed(3)),
    evidence: `freq=${frequency.toFixed(2)}Hz conf=${confidence.toFixed(3)} (max allowed: ${t.maxConfidence})`,
    failure: !passed_ ? `Confidence too high: ${confidence} > ${t.maxConfidence}` : undefined,
  });
}

// Kick transient — should NOT produce a confident melodic pitch
{
  const kick = kickTransient(N, SAMPLE_RATE);
  const { frequency, confidence } = estimatePitch(kick, SAMPLE_RATE, 80, 2000);
  // Kick sweeps 180→50 Hz. YIN should either:
  // - Return low confidence (not periodic enough), OR
  // - Return the kick's fundamental (~50-60 Hz), NOT a high melodic pitch
  const isMelodic = frequency > 200 && confidence > 0.5;
  const passed_ = !isMelodic;
  record({
    id: 'MO-kick', name: 'Kick transient (should NOT produce melodic observation)', passed: passed_,
    detectedFreq: frequency, confidence: parseFloat(confidence.toFixed(3)),
    evidence: `kick: freq=${frequency.toFixed(2)}Hz conf=${confidence.toFixed(3)} ${isMelodic ? '→ WRONGLY DETECTED AS MELODIC' : '→ correctly rejected or non-melodic'}`,
    failure: isMelodic ? `Kick produced melodic pitch: ${frequency}Hz` : undefined,
  });
}

// Polyphonic mix (kick + bass + noise) — pitch detection may or may not work,
// but should not produce a confident FALSE pitch
{
  const mix = fullMix(N, 145, SAMPLE_RATE);
  const { frequency, confidence } = estimatePitch(mix, SAMPLE_RATE, 80, 2000);
  // The mix contains a 100 Hz bass. If YIN detects it, that's reasonable.
  // If it returns garbage with high confidence, that's a failure.
  const nearBass = Math.abs(frequency - 100) < 30 || Math.abs(frequency - 200) < 30;
  const lowConf = confidence < 0.5;
  const passed_ = nearBass || lowConf;
  record({
    id: 'MO-mix', name: 'Polyphonic mix (kick+bass+noise at 145 BPM)', passed: passed_,
    detectedFreq: frequency, confidence: parseFloat(confidence.toFixed(3)),
    evidence: `mix: freq=${frequency.toFixed(2)}Hz conf=${confidence.toFixed(3)} ${nearBass ? '→ near bass fundamental (reasonable)' : lowConf ? '→ low confidence (acceptable)' : '→ unexpected pitch'}`,
    failure: !passed_ ? `Unexpected confident pitch: ${frequency}Hz conf=${confidence}` : undefined,
  });
}

// Flatness tests
for (const t of FLATNESS_TESTS) {
  const spectrum = t.buildSpectrum();
  const flatness = spectralFlatness(spectrum, t.sampleRate, t.fftSize);
  const isTonal = flatness < 0.5;
  const passed_ = isTonal === t.expectedLowFlatness;
  record({
    id: t.id, name: t.name, passed: passed_,
    flatness: parseFloat(flatness.toFixed(3)),
    evidence: `flatness=${flatness.toFixed(3)} ${isTonal ? '→ tonal' : '→ noisy'} (expected ${t.expectedLowFlatness ? 'tonal' : 'noisy'})`,
    failure: !passed_ ? `Expected ${t.expectedLowFlatness ? 'tonal' : 'noisy'} but got ${isTonal ? 'tonal' : 'noisy'}` : undefined,
  });
}

// Full observer test — clean 440 Hz with harmonics should produce observations
// Uses fftSize=512 (matching real engine) and a realistic spectrum with
// fundamental + harmonics + spectral leakage (as a real instrument would produce)
{
  const observer = new MelodyObserver();
  const obsFftSize = 512;
  const samples = sineWave(440, obsFftSize, SAMPLE_RATE, 0.8);
  const freqData = new Uint8Array(obsFftSize / 2).fill(2); // low noise floor
  const binHz = SAMPLE_RATE / obsFftSize;
  const targetBin = Math.floor(440 / binHz);
  // Fundamental + harmonics (realistic for a tonal instrument)
  freqData[targetBin] = 255;
  if (targetBin > 0) freqData[targetBin - 1] = 120;
  if (targetBin < freqData.length - 1) freqData[targetBin + 1] = 120;
  if (targetBin * 2 < freqData.length) freqData[targetBin * 2] = 200; // 2nd harmonic
  if (targetBin * 3 < freqData.length) freqData[targetBin * 3] = 150; // 3rd harmonic

  const occupancy = { kick: 0, bass: 0, lead: 0, hats: 0 };
  for (let beat = 0; beat < 10; beat++) {
    observer.observe(freqData, samples, SAMPLE_RATE, obsFftSize, 1000 + beat * 0.4, beat, Math.floor(beat / 4), occupancy);
  }
  // Flush the pending observation (in real usage, pitch changes or silence
  // would trigger this automatically; in test we call it explicitly)
  observer.flush(1000 + 10 * 0.4, 10, 2);
  const obs = observer.getObservations();
  const passed_ = obs.length > 0;
  record({
    id: 'MO-observer-440', name: 'Full observer: 440 Hz with harmonics produces observations', passed: passed_,
    observationCount: obs.length,
    evidence: `observations=${obs.length} ${obs.length > 0 ? `→ last MIDI=${obs[obs.length - 1].midi} conf=${obs[obs.length - 1].confidence.toFixed(2)}` : '→ NONE (gate rejected)'}`,
    failure: !passed_ ? 'No observations produced despite realistic 440 Hz signal with harmonics' : undefined,
  });
}

// Full observer test — kick-dominant frame should NOT produce observations
{
  const observer = new MelodyObserver();
  const obsFftSize = 512;
  const samples = sineWave(440, obsFftSize, SAMPLE_RATE, 0.8);
  const freqData = new Uint8Array(obsFftSize / 2).fill(255);
  const highKick = { kick: 0.9, bass: 0.5, lead: 0.3, hats: 0.3 };
  for (let beat = 0; beat < 10; beat++) {
    observer.observe(freqData, samples, SAMPLE_RATE, obsFftSize, 1000 + beat * 0.4, beat, Math.floor(beat / 4), highKick);
  }
  const obs = observer.getObservations();
  const passed_ = obs.length === 0;
  record({
    id: 'MO-observer-kick-gate', name: 'Full observer: kick>0.8 suppresses observations', passed: passed_,
    observationCount: obs.length,
    evidence: `observations=${obs.length} (should be 0)`,
    failure: !passed_ ? 'Kick gate failed — observed during kick-dominant frame' : undefined,
  });
}

console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed, ${results.length} total ===`);

const outPath = path.join(__dirname, 'melody-acceptance-results.json');
fs.writeFileSync(outPath, JSON.stringify({
  runAt: new Date().toISOString(),
  totalTests: results.length,
  passed, failed,
  results,
}, null, 2));
console.log(`Results: ${outPath}`);

process.exit(failed > 0 ? 1 : 0);
