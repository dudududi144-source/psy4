/**
 * SIGNAL ATTACK SUITE — independent audit.
 * REAL IMPLEMENTATION.
 *
 * Feeds degenerate signals (silence, DC, constant tone, white noise, clipped,
 * repeated-identical, low-energy, single-device-only) through the FULL system
 * and verifies the validator/verdict REJECTS them as invalid musical output.
 *
 * A WAV file existing is NOT proof of a musical artifact. This suite proves the
 * system's rejection criteria actually work.
 */

import { Studio } from '../render/engine';
import { analyzeMusic, verdictPsytranceLoop, MusicalAnalysis } from './musicalAnalysis';
import { encodeWav } from '../render/wav';

export interface SignalAttackResult {
  attack: string;
  description: string;
  peak: number;
  rms: number;
  rejected: boolean;
  rejectionReasons: string[];
  analysis: MusicalAnalysis;
}

const SR = 22050;

function makeBuffer(n: number, fn: (i: number) => number): Float32Array {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = fn(i);
  return b;
}

const ATTACKS: { name: string; desc: string; make: () => Float32Array }[] = [
  { name: 'silence', desc: 'All zeros', make: () => makeBuffer(SR * 8, () => 0) },
  { name: 'dc_offset', desc: 'Constant +0.5 DC', make: () => makeBuffer(SR * 8, () => 0.5) },
  { name: 'constant_tone', desc: 'Constant 440Hz sine at fixed amplitude', make: () => makeBuffer(SR * 8, (i) => 0.3 * Math.sin(2 * Math.PI * 440 * i / SR)) },
  { name: 'white_noise', desc: 'Full-range white noise', make: () => makeBuffer(SR * 8, () => (Math.random() * 2 - 1) * 0.5) },
  { name: 'clipped', desc: 'Hard-clipped square-ish signal', make: () => makeBuffer(SR * 8, (i) => { const s = 0.8 * Math.sin(2 * Math.PI * 100 * i / SR); return s > 0.3 ? 0.99 : s < -0.3 ? -0.99 : s; }) },
  { name: 'repeated_identical', desc: 'Single cycle repeated (pure loop, no evolution)', make: () => {
    const cycleLen = SR; // 1 second
    const cycle = makeBuffer(cycleLen, (i) => 0.3 * (Math.sin(2 * Math.PI * 138 / 60 * i / SR) + 0.3 * Math.sin(2 * Math.PI * 2 * 138 / 60 * i / SR)));
    const b = new Float32Array(SR * 8);
    for (let i = 0; i < b.length; i++) b[i] = cycle[i % cycleLen];
    return b;
  } },
  { name: 'extremely_low_energy', desc: 'Signal at -60dB (audibility threshold)', make: () => makeBuffer(SR * 8, (i) => 0.001 * Math.sin(2 * Math.PI * 100 * i / SR)) },
];

/** Run all signal attacks and verify each is rejected by the musical verdict. */
export function runSignalAttacks(): { results: SignalAttackResult[]; summary: { total: number; rejected: number; accepted: number } } {
  const results: SignalAttackResult[] = [];
  for (const attack of ATTACKS) {
    const buf = attack.make();
    const right = buf.slice();
    const analysis = analyzeMusic(buf, right, SR, 138);
    const verdict = verdictPsytranceLoop(analysis);
    results.push({
      attack: attack.name,
      description: attack.desc,
      peak: analysis.peak,
      rms: analysis.rms,
      rejected: !verdict.pass,
      rejectionReasons: verdict.reasons,
      analysis,
    });
  }
  const summary = {
    total: results.length,
    rejected: results.filter((r) => r.rejected).length,
    accepted: results.filter((r) => !r.rejected).length,
  };
  return { results, summary };
}

/** Single-device-only attack: render with ONLY one device active, verify it's flagged. */
export function runSingleDeviceAttacks(): { device: string; rejected: boolean; reasons: string[]; peak: number }[] {
  const results: { device: string; rejected: boolean; reasons: string[]; peak: number }[] = [];
  
  // For each device, render a loop with ONLY that device scheduled, see if verdict flags it as thin
  const devices = ['muse', 'sub37', 'prophet6', 'iridium', 'rytm'];
  for (const device of devices) {
    const studio = new Studio({ bars: 4, sampleRate: SR, blockSize: 256, seed: 777, bpm: 138 });
    // schedule only this device
    if (device === 'rytm') for (let bar = 0; bar < 4; bar++) for (let b = 0; b < 4; b++) studio.scheduleKick(bar, b * 4, 0.9);
    if (device === 'sub37') for (let bar = 0; bar < 4; bar++) for (let s = 1; s < 16; s += 2) studio.scheduleBass(bar, s, 33, 0.85, 0.1);
    if (device === 'muse') for (let bar = 0; bar < 4; bar++) studio.scheduleLead(bar, 0, 69, 0.7, 0.3);
    if (device === 'prophet6') for (let bar = 0; bar < 4; bar++) studio.schedulePad(bar, 57, 0.4, 4);
    if (device === 'iridium') for (let bar = 0; bar < 4; bar++) studio.scheduleTexture(bar, 69, 0.4, 4);
    const { left, right } = studio.render(4);
    const analysis = analyzeMusic(left, right, SR, 138);
    const verdict = verdictPsytranceLoop(analysis);
    results.push({
      device,
      rejected: !verdict.pass,
      reasons: verdict.reasons,
      peak: analysis.peak,
    });
  }
  return results;
}
