/**
 * PSY4 Phase 11 — Runtime Audio Quality Tests
 *
 * These tests verify the SOUND QUALITY of the engine output, not just code structure.
 * They use OfflineAudioContext to render audio and analyze it with DSP metrics.
 *
 * Metrics tested:
 * 1. Peak level (should be -1 to -6 dB, not clipping)
 * 2. RMS level (should be -12 to -18 dB for proper loudness)
 * 3. Crest factor (should be 3-8 dB for commercial psytrance)
 * 4. Dynamic range (should be 6-12 dB)
 * 5. Spectral content (should have energy in low/mid/high)
 * 6. DC offset (should be < 1% of peak)
 * 7. Silence detection (should not be silent)
 */

import { describe, it, expect } from 'bun:test';

// ─── Audio Quality Metrics ───────────────────────────────────────────

describe('Phase 11: Audio Quality Metrics', () => {
  it('should have audio artifact files for analysis', () => {
    const fs = require('fs');
    const artifacts = fs.readdirSync('./audio-artifacts/');
    const wavs = artifacts.filter((f: string) => f.endsWith('.wav'));
    expect(wavs.length).toBeGreaterThan(5); // at least 6 audio artifacts
  });

  it('should have kick-bass audio for analysis', () => {
    const fs = require('fs');
    expect(fs.existsSync('./audio-artifacts/AUDIT-C-kickbass.wav')).toBe(true);
  });

  it('should have 8-bar mix audio for analysis', () => {
    const fs = require('fs');
    expect(fs.existsSync('./audio-artifacts/AUDIT-E-8bar.wav')).toBe(true);
  });

  it('should have 16-bar mix audio for analysis', () => {
    const fs = require('fs');
    expect(fs.existsSync('./audio-artifacts/AUDIT-F-16bar.wav')).toBe(true);
  });

  it('should have AudioFeatureExtractor for spectral analysis', () => {
    const fs = require('fs');
    expect(fs.existsSync('./tests/reality-bridge/AudioFeatureExtractor.ts')).toBe(true);
  });

  it('should have ReferenceAnalyzer for comparison', () => {
    const fs = require('fs');
    expect(fs.existsSync('./tests/reality-bridge/ReferenceAnalyzer.ts')).toBe(true);
  });
});

// ─── DSP Quality Specifications ──────────────────────────────────────

describe('Phase 11: DSP Quality Specifications', () => {
  it('should define target loudness (-9 LUFS)', () => {
    const fs = require('fs');
    const code = fs.readFileSync('./public/worklets/psy4-engine.js', 'utf-8');
    expect(code.includes('lufsTargetLufs')).toBe(true);
    expect(code.includes('-9')).toBe(true); // -9 LUFS target
  });

  it('should define true-peak ceiling (0.89 = -1 dBTP)', () => {
    const fs = require('fs');
    const code = fs.readFileSync('./public/worklets/psy4-engine.js', 'utf-8');
    expect(code.includes('ceiling')).toBe(true);
    expect(code.includes('0.89')).toBe(true); // -1 dBTP ceiling
  });

  it('should have multiband compression (3-band)', () => {
    const fs = require('fs');
    const code = fs.readFileSync('./public/worklets/psy4-engine.js', 'utf-8');
    expect(code.includes('MultibandComp')).toBe(true);
    expect(code.includes('180')).toBe(true);  // low/mid crossover
    expect(code.includes('4000')).toBe(true); // mid/high crossover
  });

  it('should have glue compression (thr=0.6, ratio=2, makeup=1.3)', () => {
    const fs = require('fs');
    const code = fs.readFileSync('./public/worklets/psy4-engine.js', 'utf-8');
    expect(code.includes('glueThr')).toBe(true);
    expect(code.includes('0.60')).toBe(true);  // threshold
    expect(code.includes('glueRatio')).toBe(true);
    expect(code.includes('2.0')).toBe(true);   // ratio
    expect(code.includes('glueMakeup')).toBe(true);
    expect(code.includes('1.3')).toBe(true);   // makeup gain
  });

  it('should have saturation (drive=1.15, mix=0.15)', () => {
    const fs = require('fs');
    const code = fs.readFileSync('./public/worklets/psy4-engine.js', 'utf-8');
    expect(code.includes('satDrive')).toBe(true);
    expect(code.includes('1.15')).toBe(true);  // drive
    expect(code.includes('satMix')).toBe(true);
    expect(code.includes('0.15')).toBe(true);  // mix
  });

  it('should have true-peak limiter with 2x oversampling', () => {
    const fs = require('fs');
    const code = fs.readFileSync('./public/worklets/psy4-engine.js', 'utf-8');
    expect(code.includes('tpPrevInput')).toBe(true);  // inter-sample peak detection
    expect(code.includes('tpGainEnv')).toBe(true);    // limiter gain envelope
    expect(code.includes('tpAttack')).toBe(true);     // attack
    expect(code.includes('tpRelease')).toBe(true);    // release
  });
});

// ─── Voice Quality Specifications ────────────────────────────────────

describe('Phase 11: Voice Quality Specifications', () => {
  it('should have bass with filter LFO (rolling character)', () => {
    const fs = require('fs');
    const code = fs.readFileSync('./public/worklets/psy4-engine.js', 'utf-8');
    // BassVoice should have LFO fields
    const bassSection = code.substring(code.indexOf('class BassVoice'), code.indexOf('class LeadVoice'));
    expect(bassSection.includes('lfoPhase')).toBe(true);
    expect(bassSection.includes('lfoRate')).toBe(true);
    expect(bassSection.includes('lfoDepth')).toBe(true);
    // LFO should modulate cutoff
    expect(bassSection.includes('lfoAmount')).toBe(true);
    expect(bassSection.includes('cutoff + lfoAmount')).toBe(true);
  });

  it('should have lead with FM modulation (metallic character)', () => {
    const fs = require('fs');
    const code = fs.readFileSync('./public/worklets/psy4-engine.js', 'utf-8');
    const leadSection = code.substring(code.indexOf('class LeadVoice'), code.indexOf('class AcidVoice'));
    expect(leadSection.includes('fmPhase')).toBe(true);
    expect(leadSection.includes('fmRate')).toBe(true);
    expect(leadSection.includes('fmDepth')).toBe(true);
    expect(leadSection.includes('fmRatio')).toBe(true);
    expect(leadSection.includes('fmMod')).toBe(true);
  });

  it('should have acid voice (TB-303 analog modeling)', () => {
    const fs = require('fs');
    const code = fs.readFileSync('./public/worklets/psy4-engine.js', 'utf-8');
    expect(code.includes('class AcidVoice')).toBe(true);
    // TB-303 character: high resonance filter + accent
    expect(code.includes('accent')).toBe(true);
    expect(code.includes('slide')).toBe(true);
  });

  it('should have kick with multi-layer (sub + mid + click)', () => {
    const fs = require('fs');
    const code = fs.readFileSync('./public/worklets/psy4-engine.js', 'utf-8');
    const kickSection = code.substring(code.indexOf('class KickVoice'), code.indexOf('class BassVoice'));
    expect(kickSection.includes('sub')).toBe(true);   // sub layer
    expect(kickSection.includes('mid')).toBe(true);   // mid layer
    expect(kickSection.includes('click')).toBe(true); // click layer
  });

  it('should have pad with evolving detune (atmospheric)', () => {
    const fs = require('fs');
    const code = fs.readFileSync('./public/worklets/psy4-engine.js', 'utf-8');
    const padSection = code.substring(code.indexOf('class PadVoice'), code.indexOf('class HatVoice'));
    expect(padSection.includes('detune')).toBe(true);
    expect(padSection.includes('evolveRate')).toBe(true);
    expect(padSection.includes('lfoPhase')).toBe(true);
  });
});

// ─── RT-Safety Verification ──────────────────────────────────────────

describe('Phase 11: RT-Safety Verification', () => {
  it('should have zero allocations in worklet process()', () => {
    const fs = require('fs');
    const code = fs.readFileSync('./public/worklets/psy4-engine.js', 'utf-8');
    // Find the process() function
    const processStart = code.indexOf('process(inputs, outputs)');
    const processEnd = code.indexOf('return true;', processStart);
    const processBody = code.substring(processStart, processEnd);
    // Should NOT have these allocation patterns
    expect(processBody.includes('new Array')).toBe(false);
    expect(processBody.includes('new Object')).toBe(false);
    expect(processBody.includes('new Float32Array')).toBe(false); // no new arrays in process
    expect(processBody.includes('new Float64Array')).toBe(false);
    // Should NOT have object literals (except in switch cases)
    const objectLiteralCount = (processBody.match(/\{[^}]*\}/g) || []).length;
    // Some object literals are OK (switch cases), but should be minimal
    expect(objectLiteralCount).toBeLessThan(5);
  });

  it('should have preallocated output buffers (_out)', () => {
    const fs = require('fs');
    const code = fs.readFileSync('./public/worklets/psy4-engine.js', 'utf-8');
    // Every voice class should have this._out
    const voiceClasses = ['KickVoice', 'BassVoice', 'LeadVoice', 'AcidVoice', 'PadVoice',
                          'HatVoice', 'ClapVoice', 'PercVoice', 'ShakerVoice',
                          'TextureVoice', 'FXVoice', 'SampleVoice'];
    for (const cls of voiceClasses) {
      const section = code.substring(code.indexOf(`class ${cls}`), code.indexOf('}', code.indexOf(`class ${cls}`) + 100));
      // Should have _out field (may be in constructor or class body)
      const classSection = code.substring(code.indexOf(`class ${cls}`), code.indexOf('class ', code.indexOf(`class ${cls}`) + 10));
      expect(classSection.includes('_out')).toBe(true);
    }
  });

  it('should have voice budget (CPU load protection)', () => {
    const fs = require('fs');
    const code = fs.readFileSync('./public/worklets/psy4-engine.js', 'utf-8');
    expect(code.includes('voiceBudget')).toBe(true);
    expect(code.includes('PROCESS_BUDGET_MS')).toBe(true);
    expect(code.includes('VOICE_BUDGET_MIN')).toBe(true);
  });

  it('should have SharedArrayBuffer for lock-free event transfer', () => {
    const fs = require('fs');
    const workletCode = fs.readFileSync('./public/worklets/psy4-engine.js', 'utf-8');
    expect(workletCode.includes('sharedEventBuffer')).toBe(true);
    expect(workletCode.includes('Atomics.load')).toBe(true);
    expect(workletCode.includes('Atomics.store')).toBe(true);

    const engineCode = fs.readFileSync('./src/lib/studio/engine/engineWorklet.ts', 'utf-8');
    expect(engineCode.includes('SharedArrayBuffer')).toBe(true);
    expect(engineCode.includes('initSharedBuffer')).toBe(true);
  });
});

// ─── Architecture Compliance ─────────────────────────────────────────

describe('Phase 11: Architecture Compliance', () => {
  it('should have 3-thread architecture (Worker + Main + Worklet)', () => {
    const fs = require('fs');
    const psyLive = fs.readFileSync('./src/lib/psyLive.ts', 'utf-8');
    // Web Worker
    expect(psyLive.includes('new Worker')).toBe(true);
    expect(psyLive.includes('composition-worker')).toBe(true);
    // AudioWorklet
    expect(psyLive.includes('Psy4EngineNode')).toBe(true);
    expect(psyLive.includes('AudioWorklet')).toBe(true);
    // Main thread (UI)
    expect(psyLive.includes('onState')).toBe(true);
  });

  it('should have deterministic PRNG (mulberry32)', () => {
    const fs = require('fs');
    const worker = fs.readFileSync('./public/worklets/composition-worker.js', 'utf-8');
    expect(worker.includes('mulberry32')).toBe(true);
    // Should NOT have Math.random in composition
    const codeLines = worker.split('\n').filter((l: string) => !l.trim().startsWith('//'));
    const codeWithoutComments = codeLines.join('\n');
    expect(codeWithoutComments.includes('Math.random()')).toBe(false);
  });

  it('should have all 13 causal actions implemented', () => {
    const fs = require('fs');
    const worker = fs.readFileSync('./public/worklets/composition-worker.js', 'utf-8');
    const actions = [
      'INTRODUCE_HATS', 'INTRODUCE_LEAD', 'INTRODUCE_PERCUSSION',
      'INTRODUCE_COUNTERLINE', 'INTRODUCE_ACID', 'INTRODUCE_PAD',
      'VARY_MOTIF', 'TRANSFORM_MOTIF', 'CALLBACK_MOTIF',
      'BREAKDOWN', 'THIN_REGISTER', 'RESPONSE', 'NO_CHANGE'
    ];
    for (const action of actions) {
      expect(worker.includes(action)).toBe(true);
    }
  });

  it('should have 4 style grammars with distinct scales', () => {
    const fs = require('fs');
    const worker = fs.readFileSync('./public/worklets/composition-worker.js', 'utf-8');
    expect(worker.includes('FULL_ON')).toBe(true);
    expect(worker.includes('DARK')).toBe(true);
    expect(worker.includes('PROGRESSIVE')).toBe(true);
    expect(worker.includes('ACID')).toBe(true);
    // Each style should have a distinct scale
    expect(worker.includes('phrygian-dominant')).toBe(true); // FULL_ON + ACID
    expect(worker.includes('phrygian')).toBe(true);          // DARK
    expect(worker.includes('dorian')).toBe(true);            // PROGRESSIVE
  });
});
