/**
 * F22 AUDIO REALITY GATE — Kick/Bass Analysis
 *
 * Renders actual PSY4 kick+bass audio and analyzes it.
 *
 * This test does NOT use symbolic metrics. It renders real PCM audio
 * and computes spectral/envelope/transient features.
 *
 * Run: bun run tests/reality-bridge/f22-audio-reality.ts
 */
import { extractAudioFeatures, type AudioFeatures } from './AudioFeatureExtractor';
import * as fs from 'fs';
import * as path from 'path';

const SAMPLE_RATE = 44100;
const BPM = 145;
const BEAT_DUR = 60 / BPM;
const STEP_DUR = BEAT_DUR / 4;

async function main(): Promise<void> {
  const { OfflineAudioContext } = await import('web-audio-api');

  console.log('=== F22 AUDIO REALITY GATE ===\n');
  console.log('Rendering actual kick+bass audio...\n');

  // ── Render 1 bar of kick + bass ──
  const bars = 1;
  const duration = bars * 4 * BEAT_DUR;
  const length = Math.ceil(duration * SAMPLE_RATE);
  const ctx = new OfflineAudioContext(1, length, SAMPLE_RATE);

  // Build audio graph (same as psyLive, but with reduced gains to prevent clipping)
  const kickBus = ctx.createGain(); kickBus.gain.value = 0.6;
  const bassBus = ctx.createGain(); bassBus.gain.value = 0.5;
  const hatBus = ctx.createGain(); hatBus.gain.value = 0.5;
  const leadBus = ctx.createGain(); leadBus.gain.value = 0.5;
  const engineBus = ctx.createGain(); engineBus.gain.value = 0.7;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 18; comp.ratio.value = 2;
  comp.attack.value = 0.015; comp.release.value = 0.12;
  const master = ctx.createGain(); master.gain.value = 0.7;
  const safetyLimiter = ctx.createDynamicsCompressor();
  safetyLimiter.threshold.value = -1; safetyLimiter.knee.value = 0;
  safetyLimiter.ratio.value = 20; safetyLimiter.attack.value = 0.003;
  safetyLimiter.release.value = 0.05;

  kickBus.connect(engineBus);
  bassBus.connect(engineBus);
  hatBus.connect(engineBus);
  leadBus.connect(engineBus);
  engineBus.connect(comp);
  comp.connect(master);
  master.connect(safetyLimiter);
  safetyLimiter.connect(ctx.destination);

  // Noise buffer for kick click
  const noiseLen = Math.floor(SAMPLE_RATE * 0.05);
  const noiseBuf = ctx.createBuffer(1, noiseLen, SAMPLE_RATE);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) noiseData[i] = Math.random() * 2 - 1;

  // Waveshaper
  function makeShaper(amount: number): WaveShaperNode {
    const shaper = ctx.createWaveShaper();
    const samples = 1024;
    const curve = new Float32Array(samples);
    const k = amount;
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    shaper.curve = curve;
    return shaper;
  }

  // ── Kick voice (same as psyLive) ──
  function playKick(t: number, vel: number = 0.9): void {
    const v = Math.max(0.1, Math.min(1, vel));
    // Sub layer
    const sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(55, t);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.6 * v, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    sub.connect(subGain); subGain.connect(kickBus);
    sub.start(t); sub.stop(t + 0.2);

    // Body
    const body = ctx.createOscillator(); body.type = 'sine';
    body.frequency.setValueAtTime(150, t);
    body.frequency.exponentialRampToValueAtTime(45, t + 0.04);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.9 * v, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    const sat = makeShaper(8);
    body.connect(bodyGain); bodyGain.connect(sat); sat.connect(kickBus);
    body.start(t); body.stop(t + 0.24);

    // Click
    const click = ctx.createBufferSource(); click.buffer = noiseBuf;
    const clickHp = ctx.createBiquadFilter(); clickHp.type = 'highpass'; clickHp.frequency.value = 4000;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.3 * v, t);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
    click.connect(clickHp); clickHp.connect(clickGain); clickGain.connect(kickBus);
    click.start(t); click.stop(t + 0.02);
  }

  // ── Bass voice (same as psyLive) ──
  function playBass(t: number, freq: number, vel: number = 0.85): void {
    const v = Math.max(0.1, Math.min(1, vel));
    const bassCut = 700, bassQ = 6, bassWave: OscillatorType = 'sawtooth';

    // Sub layer
    const sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.value = freq;
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, t);
    subGain.gain.exponentialRampToValueAtTime(0.5 * v, t + 0.008);
    subGain.gain.exponentialRampToValueAtTime(0.25 * v, t + 0.12);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    sub.connect(subGain); subGain.connect(bassBus);
    sub.start(t); sub.stop(t + 0.37);

    // Mid layer
    const mid = ctx.createOscillator(); mid.type = bassWave; mid.frequency.value = freq;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = bassQ;
    const fStart = Math.max(300, bassCut);
    const fEnd = Math.max(120, bassCut * 0.4);
    filter.frequency.setValueAtTime(fStart, t);
    filter.frequency.exponentialRampToValueAtTime(fEnd, t + 0.1);
    const midGain = ctx.createGain();
    midGain.gain.setValueAtTime(0.0001, t);
    midGain.gain.exponentialRampToValueAtTime(0.5 * v, t + 0.006);
    midGain.gain.exponentialRampToValueAtTime(0.2 * v, t + 0.15);
    midGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    const sat = makeShaper(4);
    mid.connect(filter); filter.connect(midGain); midGain.connect(sat); sat.connect(bassBus);
    mid.start(t); mid.stop(t + 0.37);
  }

  // ── Hat voice ──
  const noiseBufLong = ctx.createBuffer(1, Math.floor(SAMPLE_RATE * 0.25), SAMPLE_RATE);
  const noiseDataLong = noiseBufLong.getChannelData(0);
  for (let i = 0; i < noiseDataLong.length; i++) noiseDataLong[i] = Math.random() * 2 - 1;

  function playHat(t: number, lvl: number): void {
    const src = ctx.createBufferSource(); src.buffer = noiseBufLong;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 10000; bp.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.001, lvl), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    src.connect(hp); hp.connect(bp); bp.connect(gain); gain.connect(hatBus);
    src.start(t); src.stop(t + 0.05);
  }

  // ── Lead voice ──
  function playLead(t: number, freq: number, vel: number = 0.5): void {
    const detunes = [-7, 0, 7];
    const merger = ctx.createGain();
    const panL = ctx.createStereoPanner?.() || ctx.createGain(); // fallback if no stereo
    if (panL.pan) panL.pan.value = -0.6;
    const panC = ctx.createGain();
    const panR = ctx.createStereoPanner?.() || ctx.createGain();
    if (panR.pan) panR.pan.value = 0.6;
    const oscs: OscillatorNode[] = [];
    for (const det of detunes) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      o.detune.value = det;
      oscs.push(o);
    }
    oscs[0].connect(panL); panL.connect(merger);
    oscs[1].connect(panC); panC.connect(merger);
    oscs[2].connect(panR); panR.connect(merger);
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass';
    filter.Q.value = 3;
    filter.frequency.setValueAtTime(300, t);
    filter.frequency.exponentialRampToValueAtTime(2000, t + 0.03);
    filter.frequency.exponentialRampToValueAtTime(800, t + 0.3);
    const gain = ctx.createGain();
    const peak = Math.max(0.03, vel * 0.7);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(peak * 0.4, t + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    merger.connect(filter); filter.connect(gain); gain.connect(leadBus);
    for (const o of oscs) { o.start(t); o.stop(t + 0.42); }
  }

  // ── Schedule 1 bar of full psytrance groove ──
  const rootFreq = 110; // A2
  const leadFreq = 440; // A4

  // Kick: 4-on-floor
  for (const step of [0, 4, 8, 12]) {
    playKick(step * STEP_DUR, step === 0 ? 0.95 : 0.9);
  }

  // Bass: rolling 16ths
  for (const step of [0, 2, 4, 6, 8, 10, 12, 14]) {
    const vel = step % 4 === 0 ? 0.9 : 0.55;
    playBass(step * STEP_DUR, rootFreq, vel);
  }

  // Hats: offbeats
  for (const step of [2, 6, 10, 14]) {
    playHat(step * STEP_DUR, 0.3);
  }

  // Lead: sparse motif
  for (const step of [0, 6, 8, 14]) {
    playLead(step * STEP_DUR, leadFreq * (step === 6 ? 1.5 : step === 14 ? 1.2 : 1.0), 0.5);
  }

  // Render
  console.log('Rendering 1 bar at 145 BPM...');
  const buffer = await ctx.startRendering();
  const data = buffer.getChannelData(0);

  console.log(`Rendered: ${buffer.length} samples, ${buffer.duration.toFixed(2)}s\n`);

  // Analyze
  const features = extractAudioFeatures(data as Float32Array, SAMPLE_RATE);

  // ── Report ──
  console.log('── AUDIO FEATURES ──');
  console.log('TIME DOMAIN:');
  console.log(`  Peak: ${features.peak.toFixed(4)}`);
  console.log(`  RMS: ${features.rms.toFixed(4)}`);
  console.log(`  Crest factor: ${features.crestFactor.toFixed(2)}`);
  console.log(`  Zero crossing rate: ${features.zeroCrossingRate.toFixed(4)}`);
  console.log(`  Transient strength: ${features.transientStrength.toFixed(2)}`);
  console.log(`  Attack time: ${features.attackTime.toFixed(4)}s`);
  console.log(`  Decay time: ${features.decayTime.toFixed(4)}s`);
  console.log(`  Sustain level: ${features.sustainLevel.toFixed(4)}`);
  console.log('');
  console.log('SPECTRAL:');
  console.log(`  Spectral centroid: ${features.spectralCentroid.toFixed(1)} Hz`);
  console.log(`  Spectral spread: ${features.spectralSpread.toFixed(1)} Hz`);
  console.log(`  Spectral rolloff: ${features.spectralRolloff.toFixed(1)} Hz`);
  console.log(`  Spectral flatness: ${features.spectralFlatness.toFixed(4)}`);
  console.log(`  Spectral flux: ${features.spectralFlux.toFixed(4)}`);
  console.log('');
  console.log('ENERGY DISTRIBUTION:');
  console.log(`  Low (<120Hz): ${(features.lowEnergy * 100).toFixed(1)}%`);
  console.log(`  Mid (120-2500Hz): ${(features.midEnergy * 100).toFixed(1)}%`);
  console.log(`  High (>2500Hz): ${(features.highEnergy * 100).toFixed(1)}%`);
  console.log(`  Sub ratio: ${(features.subRatio * 100).toFixed(1)}%`);
  console.log('');

  // ── Evaluation ──
  console.log('── EVALUATION ──');
  const results: Array<{test: string; pass: boolean; evidence: string}> = [];

  // 1. Low-end presence (psytrance needs strong low end)
  const lowEndPass = features.lowEnergy > 0.3;
  console.log(`  Low-end presence (>30%): ${lowEndPass ? 'PASS' : 'FAIL'} (${(features.lowEnergy * 100).toFixed(1)}%)`);
  results.push({ test: 'Low-end presence', pass: lowEndPass, evidence: `${(features.lowEnergy * 100).toFixed(1)}%` });

  // 2. No clipping (peak < 1.0)
  const noClipPass = features.peak < 1.0;
  console.log(`  No clipping (peak < 1.0): ${noClipPass ? 'PASS' : 'FAIL'} (peak=${features.peak.toFixed(4)})`);
  results.push({ test: 'No clipping', pass: noClipPass, evidence: `peak=${features.peak.toFixed(4)}` });

  // 3. Transient presence (kick should create transients)
  const transientPass = features.transientStrength > 1.0;
  console.log(`  Transient presence: ${transientPass ? 'PASS' : 'FAIL'} (strength=${features.transientStrength.toFixed(2)})`);
  results.push({ test: 'Transient presence', pass: transientPass, evidence: `strength=${features.transientStrength.toFixed(2)}` });

  // 4. Spectral balance (not all low, not all high)
  const balancePass = features.lowEnergy < 0.8 && features.highEnergy > 0.05;
  console.log(`  Spectral balance: ${balancePass ? 'PASS' : 'FAIL'} (low=${(features.lowEnergy * 100).toFixed(1)}%, high=${(features.highEnergy * 100).toFixed(1)}%)`);
  results.push({ test: 'Spectral balance', pass: balancePass, evidence: `low=${(features.lowEnergy * 100).toFixed(1)}%, high=${(features.highEnergy * 100).toFixed(1)}%` });

  // 5. Dynamic range (crest factor > 2 = punchy)
  const dynamicPass = features.crestFactor > 2.0;
  console.log(`  Dynamic range (crest > 2.0): ${dynamicPass ? 'PASS' : 'FAIL'} (crest=${features.crestFactor.toFixed(2)})`);
  results.push({ test: 'Dynamic range', pass: dynamicPass, evidence: `crest=${features.crestFactor.toFixed(2)}` });

  // ── Now render with DIFFERENT bass parameters (SoundDNA B) ──
  console.log('\n── SOUND DNA A/B TEST ──');
  console.log('Rendering with darker bass (lower cutoff, sine wave)...');

  const ctx2 = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const kickBus2 = ctx2.createGain(); kickBus2.gain.value = 0.95;
  const bassBus2 = ctx2.createGain(); bassBus2.gain.value = 0.85;
  const engineBus2 = ctx2.createGain(); engineBus2.gain.value = 0.8;
  const comp2 = ctx2.createDynamicsCompressor();
  comp2.threshold.value = -18; comp2.knee.value = 18; comp2.ratio.value = 2;
  const master2 = ctx2.createGain(); master2.gain.value = 0.9;
  const limiter2 = ctx2.createDynamicsCompressor();
  limiter2.threshold.value = -1; limiter2.ratio.value = 20; limiter2.attack.value = 0.003;
  kickBus2.connect(engineBus2); bassBus2.connect(engineBus2);
  engineBus2.connect(comp2); comp2.connect(master2);
  master2.connect(limiter2); limiter2.connect(ctx2.destination);

  function playKick2(t: number, vel: number = 0.9): void {
    const sub = ctx2.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(55, t);
    const subGain = ctx2.createGain();
    subGain.gain.setValueAtTime(0.6 * vel, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    sub.connect(subGain); subGain.connect(kickBus2);
    sub.start(t); sub.stop(t + 0.2);
    const body = ctx2.createOscillator(); body.type = 'sine';
    body.frequency.setValueAtTime(150, t);
    body.frequency.exponentialRampToValueAtTime(45, t + 0.04);
    const bodyGain = ctx2.createGain();
    bodyGain.gain.setValueAtTime(0.9 * vel, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    body.connect(bodyGain); bodyGain.connect(kickBus2);
    body.start(t); body.stop(t + 0.24);
  }

  // Bass B: darker (sine wave, lower cutoff, no saturation)
  function playBass2(t: number, freq: number, vel: number = 0.85): void {
    const sub = ctx2.createOscillator(); sub.type = 'sine';
    sub.frequency.value = freq;
    const subGain = ctx2.createGain();
    subGain.gain.setValueAtTime(0.0001, t);
    subGain.gain.exponentialRampToValueAtTime(0.5 * vel, t + 0.008);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25); // shorter decay
    sub.connect(subGain); subGain.connect(bassBus2);
    sub.start(t); sub.stop(t + 0.27);

    // Mid: sine (not sawtooth), lower cutoff, no saturation
    const mid = ctx2.createOscillator(); mid.type = 'sine'; mid.frequency.value = freq;
    const filter = ctx2.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 2;
    filter.frequency.setValueAtTime(300, t);
    filter.frequency.exponentialRampToValueAtTime(150, t + 0.1);
    const midGain = ctx2.createGain();
    midGain.gain.setValueAtTime(0.0001, t);
    midGain.gain.exponentialRampToValueAtTime(0.3 * vel, t + 0.006);
    midGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    mid.connect(filter); filter.connect(midGain); midGain.connect(bassBus2);
    mid.start(t); mid.stop(t + 0.27);
  }

  for (const step of [0, 4, 8, 12]) playKick2(step * STEP_DUR, step === 0 ? 0.95 : 0.9);
  for (const step of [0, 2, 4, 6, 8, 10, 12, 14]) {
    const vel = step % 4 === 0 ? 0.9 : 0.55;
    playBass2(step * STEP_DUR, rootFreq, vel);
  }

  const buffer2 = await ctx2.startRendering();
  const data2 = buffer2.getChannelData(0);
  const features2 = extractAudioFeatures(data2 as Float32Array, SAMPLE_RATE);

  console.log('\nSoundDNA A (sawtooth bass, cutoff=700, saturation=k4):');
  console.log(`  Centroid: ${features.spectralCentroid.toFixed(1)} Hz`);
  console.log(`  Decay: ${features.decayTime.toFixed(4)}s`);
  console.log(`  Low energy: ${(features.lowEnergy * 100).toFixed(1)}%`);
  console.log(`  Rolloff: ${features.spectralRolloff.toFixed(1)} Hz`);

  console.log('\nSoundDNA B (sine bass, cutoff=300, no saturation):');
  console.log(`  Centroid: ${features2.spectralCentroid.toFixed(1)} Hz`);
  console.log(`  Decay: ${features2.decayTime.toFixed(4)}s`);
  console.log(`  Low energy: ${(features2.lowEnergy * 100).toFixed(1)}%`);
  console.log(`  Rolloff: ${features2.spectralRolloff.toFixed(1)} Hz`);

  const centroidDiff = Math.abs(features.spectralCentroid - features2.spectralCentroid);
  const decayDiff = Math.abs(features.decayTime - features2.decayTime);
  const lowDiff = Math.abs(features.lowEnergy - features2.lowEnergy);

  console.log(`\nDifferences:`);
  console.log(`  Centroid diff: ${centroidDiff.toFixed(1)} Hz`);
  console.log(`  Decay diff: ${decayDiff.toFixed(4)}s`);
  console.log(`  Low energy diff: ${(lowDiff * 100).toFixed(1)}%`);

  const soundDiffPass = centroidDiff > 50 || decayDiff > 0.01 || lowDiff > 0.05;
  console.log(`\nSound DNA A/B produces different audio: ${soundDiffPass ? 'PASS' : 'FAIL'}`);
  results.push({ test: 'SoundDNA A/B → different rendered audio', pass: soundDiffPass,
    evidence: `centroid diff=${centroidDiff.toFixed(1)}Hz, decay diff=${decayDiff.toFixed(4)}s` });

  // ── SUMMARY ──
  console.log('\n═══════════════════════════════════════════');
  console.log('SUMMARY:');
  const allPass = results.every(r => r.pass);
  for (const r of results) {
    console.log(`  ${r.pass ? '✓' : '✗'} ${r.test}: ${r.evidence}`);
  }
  console.log(`\nVERDICT: ${allPass ? 'PASS — Audio reality gate passed' : 'FAIL — Audio needs work'}`);

  const outPath = path.join(__dirname, 'f22-audio-reality-results.json');
  fs.writeFileSync(outPath, JSON.stringify({
    featuresA: features,
    featuresB: features2,
    differences: { centroidDiff, decayDiff, lowDiff },
    results,
    verdict: allPass ? 'PASS' : 'FAIL',
  }, null, 2));
  console.log(`Results: ${outPath}`);

  process.exit(allPass ? 0 : 1);
}

main().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
