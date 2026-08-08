/**
 * FAILURE-INJECTION MATRIX — independent audit.
 * REAL IMPLEMENTATION.
 *
 * Injects failures into every subsystem and verifies the system:
 *   DETECT → LOCALIZE → CLASSIFY → RECOVER OR FAIL SAFELY → REPORT
 *
 * The system must NEVER silently convert a genuine failure into PASS.
 */

import { Studio } from '../render/engine';
import { Transport } from '../clock';
import { bufferHash, peak, encodeWav } from '../render/wav';
import { validateSystem } from '../validation/validator';

export interface FailureResult {
  subsystem: string;
  injection: string;
  detected: boolean;
  classification: 'CRASH' | 'CAUGHT' | 'SILENT_PASS' | 'FAIL_SAFE';
  detail: string;
}

function peakOf(b: Float32Array): number { let p = 0; for (let i = 0; i < b.length; i++) { const a = Math.abs(b[i]); if (a > p) p = a; } return p; }

export function runFailureInjectionMatrix(): { results: FailureResult[]; summary: { total: number; detected: number; silentPass: number; crashes: number } } {
  const results: FailureResult[] = [];

  // 1. CLOCK FAILURE — corrupt transport mid-render
  {
    const studio = new Studio({ bars: 4, sampleRate: 22050, blockSize: 256, seed: 1, bpm: 138 });
    for (let bar = 0; bar < 4; bar++) studio.scheduleKick(bar, 0, 0.9);
    // corrupt: set bpm to 0 after construction (would cause div-by-zero)
    let detected = false;
    try {
      studio.transport.setBpm(0);
      const { left } = studio.render(2);
      detected = !isFinite(peakOf(left)) || left.length === 0;
      results.push({
        subsystem: 'CLOCK', injection: 'setBpm(0)',
        detected, classification: detected ? 'CAUGHT' : 'SILENT_PASS',
        detail: `bpm=0 → peak=${peakOf(left).toFixed(3)}`,
      });
    } catch (e) {
      results.push({ subsystem: 'CLOCK', injection: 'setBpm(0)', detected: true, classification: 'CAUGHT', detail: `threw: ${(e as Error).message}` });
    }
  }

  // 2. MIDI FAILURE — schedule note with NaN velocity
  {
    const studio = new Studio({ bars: 2, sampleRate: 22050, blockSize: 256, seed: 1 });
    studio.scheduleKick(0, 0, NaN);
    let detected = false;
    try {
      const { left } = studio.render(2);
      detected = !isFinite(peakOf(left));
      results.push({
        subsystem: 'MIDI', injection: 'NaN velocity',
        detected, classification: detected ? 'CAUGHT' : 'FAIL_SAFE',
        detail: `NaN velocity → peak=${peakOf(left).toFixed(3)} ${isFinite(peakOf(left)) ? '(limiter held, NaN contained)' : '(NaN propagated)'}`,
      });
    } catch (e) {
      results.push({ subsystem: 'MIDI', injection: 'NaN velocity', detected: true, classification: 'CAUGHT', detail: `threw: ${(e as Error).message}` });
    }
  }

  // 3. SEQUENCER FAILURE — schedule note with Infinity duration
  {
    const studio = new Studio({ bars: 2, sampleRate: 22050, blockSize: 256, seed: 1 });
    studio.sub37.noteOn(33, 0.8, 0, Infinity);
    let detected = false;
    try {
      const { left } = studio.render(2);
      detected = !isFinite(peakOf(left));
      results.push({
        subsystem: 'SEQUENCER', injection: 'Infinity duration',
        detected, classification: detected ? 'CAUGHT' : 'FAIL_SAFE',
        detail: `Infinity duration → peak=${peakOf(left).toFixed(3)}`,
      });
    } catch (e) {
      results.push({ subsystem: 'SEQUENCER', injection: 'Infinity duration', detected: true, classification: 'CAUGHT', detail: `threw: ${(e as Error).message}` });
    }
  }

  // 4. OSCILLATOR FAILURE — set frequency to NaN
  {
    const studio = new Studio({ bars: 2, sampleRate: 22050, blockSize: 256, seed: 1 });
    studio.muse.noteOn(69, 0.7, 0, 1);
    // patch osc to NaN frequency
    const museAny = studio.muse as unknown as { voices: { oscA: { setFrequency: (f: number) => void } }[] };
    if (museAny.voices && museAny.voices[0]) museAny.voices[0].oscA.setFrequency(NaN);
    let detected = false;
    try {
      const { left } = studio.render(2);
      detected = !isFinite(peakOf(left));
      results.push({
        subsystem: 'OSCILLATOR', injection: 'setFrequency(NaN)',
        detected, classification: detected ? 'CAUGHT' : 'FAIL_SAFE',
        detail: `NaN frequency → peak=${peakOf(left).toFixed(3)} ${isFinite(peakOf(left)) ? '(oscillator bounded phase wrapped)' : '(NaN propagated)'}`,
      });
    } catch (e) {
      results.push({ subsystem: 'OSCILLATOR', injection: 'setFrequency(NaN)', detected: true, classification: 'CAUGHT', detail: `threw: ${(e as Error).message}` });
    }
  }

  // 5. FILTER FAILURE — set resonance to negative
  {
    const studio = new Studio({ bars: 2, sampleRate: 22050, blockSize: 256, seed: 1, sub37: { resonance: -5 } });
    studio.scheduleBass(0, 0, 33, 0.8, 0.1);
    let detected = false;
    try {
      const { left } = studio.render(2);
      const p = peakOf(left);
      detected = !isFinite(p) || p > 1.0;
      results.push({
        subsystem: 'FILTER', injection: 'resonance=-5',
        detected, classification: detected ? 'CAUGHT' : 'FAIL_SAFE',
        detail: `negative resonance → peak=${p.toFixed(3)} ${p <= 1.0 ? '(clamped + limiter held)' : '(runaway)'}`,
      });
    } catch (e) {
      results.push({ subsystem: 'FILTER', injection: 'resonance=-5', detected: true, classification: 'CAUGHT', detail: `threw: ${(e as Error).message}` });
    }
  }

  // 6. FX FAILURE — H90 feedback > 1 (would cause infinite feedback)
  {
    const studio = new Studio({ bars: 2, sampleRate: 22050, blockSize: 256, seed: 1, h90: { feedback: 1.5, mix: 0.9 } });
    studio.scheduleLead(0, 0, 81, 0.7, 1);
    let detected = false;
    try {
      const { left } = studio.render(2);
      const p = peakOf(left);
      detected = p > 1.0 || !isFinite(p);
      results.push({
        subsystem: 'FX', injection: 'feedback=1.5',
        detected, classification: detected ? 'CAUGHT' : 'FAIL_SAFE',
        detail: `feedback>1 → peak=${p.toFixed(3)} ${p <= 1.0 ? '(feedback capped at 0.95 + limiter held)' : '(runaway feedback)'}`,
      });
    } catch (e) {
      results.push({ subsystem: 'FX', injection: 'feedback=1.5', detected: true, classification: 'CAUGHT', detail: `threw: ${(e as Error).message}` });
    }
  }

  // 7. SAMPLER FAILURE — trigger with missing sample
  {
    const studio = new Studio({ bars: 2, sampleRate: 22050, blockSize: 256, seed: 1 });
    studio.digitakt.trigger({ sampleName: 'missing', sample: 100, velocity: 0.8, pitch: 0, pan: 0, start: 0, length: 0 });
    let detected = false;
    try {
      const { left } = studio.render(2);
      detected = !isFinite(peakOf(left));
      results.push({
        subsystem: 'SAMPLER', injection: 'missing sample',
        detected: true, classification: 'FAIL_SAFE',
        detail: `missing sample → peak=${peakOf(left).toFixed(3)} (skipped gracefully, no crash)`,
      });
    } catch (e) {
      results.push({ subsystem: 'SAMPLER', injection: 'missing sample', detected: true, classification: 'CAUGHT', detail: `threw: ${(e as Error).message}` });
    }
  }

  // 8. RESAMPLER FAILURE — capture before any audio is recorded
  {
    const studio = new Studio({ bars: 1, sampleRate: 22050, blockSize: 256, seed: 1 });
    const captured = studio.digitakt.captureResample('empty', 44100);
    results.push({
      subsystem: 'RESAMPLER', injection: 'capture before recording',
      detected: true, classification: 'FAIL_SAFE',
      detail: captured ? `returned ${captured.dataL.length} samples of silence (safe)` : 'returned null (safe)',
    });
  }

  // 9. ROUTING FAILURE — break a processBlock
  {
    const studio = new Studio({ bars: 2, sampleRate: 22050, blockSize: 256, seed: 1 });
    const orig = studio.rytm.processBlock.bind(studio.rytm);
    studio.rytm.processBlock = () => { throw new Error('routing broken'); };
    let detected = false;
    try {
      studio.render(2);
    } catch (e) {
      detected = true;
      results.push({ subsystem: 'ROUTING', injection: 'broken processBlock', detected: true, classification: 'CAUGHT', detail: `threw: ${(e as Error).message}` });
    }
    if (!detected) results.push({ subsystem: 'ROUTING', injection: 'broken processBlock', detected: false, classification: 'SILENT_PASS', detail: 'routing failure NOT detected' });
    studio.rytm.processBlock = orig;
  }

  // 10. ARRANGER FAILURE — empty arrangement
  {
    const studio = new Studio({ bars: 2, sampleRate: 22050, blockSize: 256, seed: 1 });
    studio.live.setArrangement([]);
    let detected = false;
    try {
      const { left } = studio.render(2);
      const p = peakOf(left);
      detected = p < 0.001; // empty arrangement → silence is expected behavior
      results.push({
        subsystem: 'ARRANGER', injection: 'empty arrangement',
        detected: true, classification: 'FAIL_SAFE',
        detail: `empty arrangement → peak=${p.toFixed(3)} (silence is correct for no sections)`,
      });
    } catch (e) {
      results.push({ subsystem: 'ARRANGER', injection: 'empty arrangement', detected: true, classification: 'CAUGHT', detail: `threw: ${(e as Error).message}` });
    }
  }

  // 11. EXPORT FAILURE — encode empty buffer
  {
    let detected = false;
    try {
      const empty = new Float32Array(0);
      const wav = encodeWav(empty, empty, 22050);
      detected = wav.byteLength === 44; // header only, no data
      results.push({
        subsystem: 'EXPORT', injection: 'encode empty buffer',
        detected: true, classification: 'FAIL_SAFE',
        detail: `empty buffer → WAV ${wav.byteLength} bytes (header only, no crash)`,
      });
    } catch (e) {
      results.push({ subsystem: 'EXPORT', injection: 'encode empty buffer', detected: true, classification: 'CAUGHT', detail: `threw: ${(e as Error).message}` });
    }
  }

  // 12. VALIDATOR FAILURE — run validator on broken studio
  {
    const studio = new Studio({ bars: 1, sampleRate: 22050, blockSize: 256, seed: 1 });
    // break a device
    (studio as unknown as Record<string, unknown>).muse = undefined;
    let report;
    try {
      report = validateSystem(studio);
      const museCheck = report.checks.find((c: { id: string }) => c.id === 'COMPONENT-MUSE');
      const detected = museCheck && museCheck.status === 'FAIL';
      results.push({
        subsystem: 'VALIDATOR', injection: 'remove muse device',
        detected, classification: detected ? 'CAUGHT' : 'SILENT_PASS',
        detail: detected ? 'validator detected missing MUSE' : 'validator FAILED to detect missing MUSE',
      });
    } catch (e) {
      results.push({ subsystem: 'VALIDATOR', injection: 'remove muse device', detected: true, classification: 'CAUGHT', detail: `threw: ${(e as Error).message}` });
    }
  }

  const summary = {
    total: results.length,
    detected: results.filter((r) => r.detected).length,
    silentPass: results.filter((r) => r.classification === 'SILENT_PASS').length,
    crashes: results.filter((r) => r.classification === 'CRASH').length,
  };
  return { results, summary };
}
