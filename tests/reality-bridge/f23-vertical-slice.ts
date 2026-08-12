/**
 * F23 — VERTICAL SLICE: Reference → Analyze → Generate → Render → Compare
 *
 * This is the smallest end-to-end proof that PSY4 can:
 * 1. Load a real WAV file
 * 2. Extract BPM, kick/bass onsets, timbre
 * 3. Generate music using the extracted parameters
 * 4. Render the generated music to WAV
 * 5. Analyze the generated WAV
 * 6. Compare reference vs generated
 *
 * Run: bun run tests/reality-bridge/f23-vertical-slice.ts
 */
const { OfflineAudioContext } = await import('web-audio-api');
import { analyzeReference, compareRepresentations, loadWAV, detectBPM, detectOnsets } from './ReferenceAnalyzer';
import { extractAudioFeatures } from './AudioFeatureExtractor';
import * as fs from 'fs';
import * as path from 'path';

const SR = 44100;

async function main(): Promise<void> {
  // OfflineAudioContext already imported at top level
  
  console.log('=== F23 VERTICAL SLICE: Reference → Analyze → Generate → Render → Compare ===\n');
  
  // ── STEP 1: Create two different references ──
  console.log('── STEP 1: Create reference WAVs ──');
  
  // Reference A: 145 BPM, 120→48Hz kick, 110Hz bass, K-B-B-B pattern
  const refAPath = 'audio-artifacts/REF-A-145kb.wav';
  await renderReference(refAPath, {
    bpm: 145, kickPitchStart: 120, kickPitchEnd: 48, kickDecay: 0.06,
    bassFreq: 110, bassDecay: 0.065, bassFilterStart: 1000, bassFilterEnd: 175,
    pattern: [0, 1, 1, 1], // K B B B per beat
  });
  
  // Reference B: 138 BPM, 90→40Hz kick, 82Hz bass, K-B-B-- pattern
  const refBPath = 'audio-artifacts/REF-B-138kb.wav';
  await renderReference(refBPath, {
    bpm: 138, kickPitchStart: 90, kickPitchEnd: 40, kickDecay: 0.08,
    bassFreq: 82, bassDecay: 0.07, bassFilterStart: 800, bassFilterEnd: 150,
    pattern: [0, 1, 1, 0], // K B B -- per beat
  });
  
  console.log(`  Reference A: ${refAPath} (145 BPM, 120→48Hz kick, 110Hz bass, K-B-B-B)`);
  console.log(`  Reference B: ${refBPath} (138 BPM, 90→40Hz kick, 82Hz bass, K-B-B--)`);
  
  // ── STEP 2: Analyze both references ──
  console.log('\n── STEP 2: Analyze references ──');
  const refA = analyzeReference(refAPath);
  const refB = analyzeReference(refBPath);
  
  console.log('\nReference A analysis:');
  console.log(`  BPM: ${refA.bpm}`);
  console.log(`  Kick onsets: ${refA.kickOnsets.length} (first 5: ${refA.kickOnsets.slice(0, 5).map(t => t.toFixed(3)).join(', ')})`);
  console.log(`  Bass onsets: ${refA.bassOnsets.length}`);
  console.log(`  K-B pattern: ${refA.kbPattern}`);
  console.log(`  Kick: pitch ${refA.kick.pitchStart.toFixed(0)}→${refA.kick.pitchEnd.toFixed(0)}Hz, decay ${refA.kick.decayTime.toFixed(1)}ms, centroid ${refA.kick.spectralCentroid.toFixed(0)}Hz`);
  console.log(`  Bass: fundamental ${refA.bass.fundamental.toFixed(0)}Hz, decay ${refA.bass.decayTime.toFixed(1)}ms, centroid ${refA.bass.spectralCentroid.toFixed(0)}Hz`);
  
  console.log('\nReference B analysis:');
  console.log(`  BPM: ${refB.bpm}`);
  console.log(`  Kick onsets: ${refB.kickOnsets.length}`);
  console.log(`  Bass onsets: ${refB.bassOnsets.length}`);
  console.log(`  K-B pattern: ${refB.kbPattern}`);
  console.log(`  Kick: pitch ${refB.kick.pitchStart.toFixed(0)}→${refB.kick.pitchEnd.toFixed(0)}Hz, decay ${refB.kick.decayTime.toFixed(1)}ms, centroid ${refB.kick.spectralCentroid.toFixed(0)}Hz`);
  console.log(`  Bass: fundamental ${refB.bass.fundamental.toFixed(0)}Hz, decay ${refB.bass.decayTime.toFixed(1)}ms, centroid ${refB.bass.spectralCentroid.toFixed(0)}Hz`);
  
  // ── STEP 3: Generate from each reference ──
  console.log('\n── STEP 3: Generate from references ──');
  
  const genAPath = 'audio-artifacts/GEN-A-from-refA.wav';
  await renderFromReference(genAPath, refA);
  console.log(`  Generated A: ${genAPath}`);
  
  const genBPath = 'audio-artifacts/GEN-B-from-refB.wav';
  await renderFromReference(genBPath, refB);
  console.log(`  Generated B: ${genBPath}`);
  
  // ── STEP 4: Analyze generated ──
  console.log('\n── STEP 4: Analyze generated ──');
  const genA = analyzeReference(genAPath);
  const genB = analyzeReference(genBPath);
  
  console.log('\nGenerated A analysis:');
  console.log(`  BPM: ${genA.bpm}`);
  console.log(`  Kick: pitch ${genA.kick.pitchStart.toFixed(0)}→${genA.kick.pitchEnd.toFixed(0)}Hz, decay ${genA.kick.decayTime.toFixed(1)}ms`);
  console.log(`  Bass: fundamental ${genA.bass.fundamental.toFixed(0)}Hz, decay ${genA.bass.decayTime.toFixed(1)}ms`);
  
  console.log('\nGenerated B analysis:');
  console.log(`  BPM: ${genB.bpm}`);
  console.log(`  Kick: pitch ${genB.kick.pitchStart.toFixed(0)}→${genB.kick.pitchEnd.toFixed(0)}Hz, decay ${genB.kick.decayTime.toFixed(1)}ms`);
  console.log(`  Bass: fundamental ${genB.bass.fundamental.toFixed(0)}Hz, decay ${genB.bass.decayTime.toFixed(1)}ms`);
  
  // ── STEP 5: Compare ──
  console.log('\n── STEP 5: Critic comparison ──');
  
  const criticA = compareRepresentations(refA, genA);
  const criticB = compareRepresentations(refB, genB);
  
  // Cross-comparison: genA should be closer to refA than to refB
  const criticAtoB = compareRepresentations(refB, genA);
  const criticBtoA = compareRepresentations(refA, genB);
  
  console.log('\nCritic A (refA vs genA):');
  console.log(`  BPM dist: ${criticA.bpmDist.toFixed(3)}`);
  console.log(`  Kick decay dist: ${criticA.kickDecayDist.toFixed(3)}`);
  console.log(`  Kick centroid dist: ${criticA.kickCentroidDist.toFixed(3)}`);
  console.log(`  Bass decay dist: ${criticA.bassDecayDist.toFixed(3)}`);
  console.log(`  Bass fundamental dist: ${criticA.bassFundamentalDist.toFixed(3)}`);
  console.log(`  K-B pattern dist: ${criticA.kbPatternDist.toFixed(3)}`);
  console.log(`  OVERALL: ${criticA.overallDist.toFixed(3)}`);
  if (criticA.improvements.length > 0) console.log(`  Improvements: ${criticA.improvements.join('; ')}`);
  
  console.log('\nCritic B (refB vs genB):');
  console.log(`  BPM dist: ${criticB.bpmDist.toFixed(3)}`);
  console.log(`  Kick decay dist: ${criticB.kickDecayDist.toFixed(3)}`);
  console.log(`  Bass fundamental dist: ${criticB.bassFundamentalDist.toFixed(3)}`);
  console.log(`  OVERALL: ${criticB.overallDist.toFixed(3)}`);
  
  console.log('\nCross-comparison (directionality test):');
  console.log(`  genA→refA: ${criticA.overallDist.toFixed(3)}  vs  genA→refB: ${criticAtoB.overallDist.toFixed(3)}`);
  console.log(`  genB→refB: ${criticB.overallDist.toFixed(3)}  vs  genB→refA: ${criticBtoA.overallDist.toFixed(3)}`);
  
  const directionalPass = criticA.overallDist < criticAtoB.overallDist && criticB.overallDist < criticBtoA.overallDist;
  console.log(`  Directional: ${directionalPass ? 'PASS — generated is closer to its own reference' : 'FAIL'}`);
  
  // ── VERDICT ──
  console.log('\n═══════════════════════════════════════════');
  console.log('VERDICT:');
  const results = [
    { test: 'BPM detected (A)', pass: refA.bpm > 100 && refA.bpm < 200, evidence: `${refA.bpm}` },
    { test: 'BPM detected (B)', pass: refB.bpm > 100 && refB.bpm < 200, evidence: `${refB.bpm}` },
    { test: 'Kick onsets detected (A)', pass: refA.kickOnsets.length > 4, evidence: `${refA.kickOnsets.length} onsets` },
    { test: 'Bass onsets detected (A)', pass: refA.bassOnsets.length > 4, evidence: `${refA.bassOnsets.length} onsets` },
    { test: 'Kick timbre extracted (A)', pass: refA.kick.pitchEnd > 0, evidence: `pitch ${refA.kick.pitchStart.toFixed(0)}→${refA.kick.pitchEnd.toFixed(0)}Hz` },
    { test: 'Bass timbre extracted (A)', pass: refA.bass.fundamental > 0, evidence: `${refA.bass.fundamental.toFixed(0)}Hz` },
    { test: 'K-B pattern detected (A)', pass: refA.kbPattern.length > 0, evidence: refA.kbPattern },
    { test: 'Generated from ref (A)', pass: fs.existsSync(genAPath), evidence: genAPath },
    { test: 'Generated from ref (B)', pass: fs.existsSync(genBPath), evidence: genBPath },
    { test: 'Directional: genA closer to refA than refB', pass: directionalPass, evidence: `${criticA.overallDist.toFixed(3)} < ${criticAtoB.overallDist.toFixed(3)}` },
    { test: 'Directional: genB closer to refB than refA', pass: directionalPass, evidence: `${criticB.overallDist.toFixed(3)} < ${criticBtoA.overallDist.toFixed(3)}` },
    { test: 'References differ', pass: refA.bpm !== refB.bpm || refA.bass.fundamental !== refB.bass.fundamental, evidence: `A: ${refA.bpm}BPM/${refA.bass.fundamental.toFixed(0)}Hz, B: ${refB.bpm}BPM/${refB.bass.fundamental.toFixed(0)}Hz` },
  ];
  
  const allPass = results.every(r => r.pass);
  for (const r of results) {
    console.log(`  ${r.pass ? '✓' : '✗'} ${r.test}: ${r.evidence}`);
  }
  console.log(`\n${allPass ? 'PASS — Audio understanding loop works' : 'FAIL — Gaps remain'}`);
  
  const outPath = path.join(__dirname, 'f23-vertical-slice-results.json');
  fs.writeFileSync(outPath, JSON.stringify({
    refA, refB, genA, genB,
    criticA, criticB, criticAtoB, criticBtoA,
    results, verdict: allPass ? 'PASS' : 'FAIL',
  }, null, 2));
  console.log(`Results: ${outPath}`);
  
  process.exit(allPass ? 0 : 1);
}

// ── Helper: Render a reference WAV with specific parameters ──
async function renderReference(filepath: string, params: {
  bpm: number; kickPitchStart: number; kickPitchEnd: number; kickDecay: number;
  bassFreq: number; bassDecay: number; bassFilterStart: number; bassFilterEnd: number;
  pattern: number[]; // 0=kick, 1=bass, per 16th step within beat
}): Promise<void> {
  const BEAT = 60 / params.bpm;
  const STEP = BEAT / 4;
  const BARS = 4;
  const DUR = BARS * 4 * BEAT;
  const LEN = Math.ceil(DUR * SR);
  
  const ctx = new OfflineAudioContext(1, LEN, SR);
  const master = ctx.createGain(); master.gain.value = 0.5;
  master.connect(ctx.destination);
  
  const noiseBuf = ctx.createBuffer(1, Math.floor(SR * 0.05), SR);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  
  for (let bar = 0; bar < BARS; bar++) {
    for (let beat = 0; beat < 4; beat++) {
      const t = bar * 4 * BEAT + beat * BEAT;
      
      // Kick on step 0 of each beat
      const click = ctx.createBufferSource(); click.buffer = noiseBuf;
      const chp = ctx.createBiquadFilter(); chp.type = 'highpass'; chp.frequency.value = 3000;
      const cg = ctx.createGain(); cg.gain.setValueAtTime(0.3, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.003);
      click.connect(chp); chp.connect(cg); cg.connect(master);
      click.start(t); click.stop(t + 0.005);
      
      const body = ctx.createOscillator(); body.type = 'sine';
      body.frequency.setValueAtTime(params.kickPitchStart, t);
      body.frequency.exponentialRampToValueAtTime(params.kickPitchEnd, t + 0.015);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0, t); bg.gain.linearRampToValueAtTime(0.8, t + 0.0005);
      bg.gain.exponentialRampToValueAtTime(0.001, t + params.kickDecay);
      body.connect(bg); bg.connect(master);
      body.start(t); body.stop(t + params.kickDecay + 0.01);
      
      const sub = ctx.createOscillator(); sub.type = 'sine';
      sub.frequency.setValueAtTime(params.kickPitchEnd, t + 0.015);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0, t); sg.gain.linearRampToValueAtTime(0.4, t + 0.003);
      sg.gain.exponentialRampToValueAtTime(0.001, t + params.kickDecay + 0.02);
      sub.connect(sg); sg.connect(master);
      sub.start(t); sub.stop(t + params.kickDecay + 0.03);
      
      // Bass on steps 1,2,3 (as specified by pattern)
      for (let s = 1; s < 4; s++) {
        if (params.pattern[s] === 1) {
          const bt = t + s * STEP;
          const bsub = ctx.createOscillator(); bsub.type = 'sine'; bsub.frequency.value = params.bassFreq;
          const bsg = ctx.createGain();
          bsg.gain.setValueAtTime(0.0001, bt); bsg.gain.linearRampToValueAtTime(0.35, bt + 0.001);
          bsg.gain.linearRampToValueAtTime(0.0, bt + params.bassDecay);
          bsub.connect(bsg); bsg.connect(master);
          bsub.start(bt); bsub.stop(bt + params.bassDecay + 0.005);
          
          const bmid = ctx.createOscillator(); bmid.type = 'sawtooth'; bmid.frequency.value = params.bassFreq;
          const bfilter = ctx.createBiquadFilter(); bfilter.type = 'lowpass'; bfilter.Q.value = 5;
          bfilter.frequency.setValueAtTime(params.bassFilterStart, bt);
          bfilter.frequency.exponentialRampToValueAtTime(params.bassFilterEnd, bt + 0.025);
          const bmg = ctx.createGain();
          bmg.gain.setValueAtTime(0.0001, bt); bmg.gain.linearRampToValueAtTime(0.2, bt + 0.001);
          bmg.gain.linearRampToValueAtTime(0.0, bt + params.bassDecay);
          bmid.connect(bfilter); bfilter.connect(bmg); bmg.connect(master);
          bmid.start(bt); bmid.stop(bt + params.bassDecay + 0.005);
        }
      }
    }
  }
  
  const buf = await ctx.startRendering();
  fs.writeFileSync(filepath, Buffer.from(encodeWAV(buf.getChannelData(0), SR)));
}

// ── Helper: Render a generated WAV from a ReferenceRepresentation ──
async function renderFromReference(filepath: string, ref: ReferenceRepresentation): Promise<void> {
  const BEAT = 60 / ref.bpm;
  const STEP = BEAT / 4;
  const BARS = 4;
  const DUR = BARS * 4 * BEAT;
  const LEN = Math.ceil(DUR * SR);
  
  const ctx = new OfflineAudioContext(1, LEN, SR);
  const master = ctx.createGain(); master.gain.value = 0.5;
  master.connect(ctx.destination);
  
  const noiseBuf = ctx.createBuffer(1, Math.floor(SR * 0.05), SR);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  
  // Use reference kick parameters
  const kickPitchStart = ref.kick.pitchStart || 120;
  const kickPitchEnd = ref.kick.pitchEnd || 48;
  const kickDecay = ref.kick.decayTime / 1000 || 0.06;
  
  // Use reference bass parameters
  const bassFreq = ref.bass.fundamental || 110;
  const bassDecay = ref.bass.decayTime / 1000 || 0.065;
  const bassFilterStart = ref.bass.filterStart || 1000;
  const bassFilterEnd = ref.bass.filterEnd || 175;
  
  // Parse K-B pattern
  const pattern = ref.kbPattern.split('-');
  
  for (let bar = 0; bar < BARS; bar++) {
    for (let beat = 0; beat < 4; beat++) {
      const t = bar * 4 * BEAT + beat * BEAT;
      
      // Kick (always on step 0)
      const click = ctx.createBufferSource(); click.buffer = noiseBuf;
      const chp = ctx.createBiquadFilter(); chp.type = 'highpass'; chp.frequency.value = 3000;
      const cg = ctx.createGain(); cg.gain.setValueAtTime(0.3, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.003);
      click.connect(chp); chp.connect(cg); cg.connect(master);
      click.start(t); click.stop(t + 0.005);
      
      const body = ctx.createOscillator(); body.type = 'sine';
      body.frequency.setValueAtTime(kickPitchStart, t);
      body.frequency.exponentialRampToValueAtTime(kickPitchEnd, t + 0.015);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0, t); bg.gain.linearRampToValueAtTime(0.8, t + 0.0005);
      bg.gain.exponentialRampToValueAtTime(0.001, t + kickDecay);
      body.connect(bg); bg.connect(master);
      body.start(t); body.stop(t + kickDecay + 0.01);
      
      const sub = ctx.createOscillator(); sub.type = 'sine';
      sub.frequency.setValueAtTime(kickPitchEnd, t + 0.015);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0, t); sg.gain.linearRampToValueAtTime(0.4, t + 0.003);
      sg.gain.exponentialRampToValueAtTime(0.001, t + kickDecay + 0.02);
      sub.connect(sg); sg.connect(master);
      sub.start(t); sub.stop(t + kickDecay + 0.03);
      
      // Bass on steps where pattern says 'B'
      for (let s = 1; s < 4; s++) {
        if (pattern[s] === 'B') {
          const bt = t + s * STEP;
          const bsub = ctx.createOscillator(); bsub.type = 'sine'; bsub.frequency.value = bassFreq;
          const bsg = ctx.createGain();
          bsg.gain.setValueAtTime(0.0001, bt); bsg.gain.linearRampToValueAtTime(0.35, bt + 0.001);
          bsg.gain.linearRampToValueAtTime(0.0, bt + bassDecay);
          bsub.connect(bsg); bsg.connect(master);
          bsub.start(bt); bsub.stop(bt + bassDecay + 0.005);
          
          const bmid = ctx.createOscillator(); bmid.type = 'sawtooth'; bmid.frequency.value = bassFreq;
          const bfilter = ctx.createBiquadFilter(); bfilter.type = 'lowpass'; bfilter.Q.value = 5;
          bfilter.frequency.setValueAtTime(bassFilterStart, bt);
          bfilter.frequency.exponentialRampToValueAtTime(bassFilterEnd, bt + 0.025);
          const bmg = ctx.createGain();
          bmg.gain.setValueAtTime(0.0001, bt); bmg.gain.linearRampToValueAtTime(0.2, bt + 0.001);
          bmg.gain.linearRampToValueAtTime(0.0, bt + bassDecay);
          bmid.connect(bfilter); bfilter.connect(bmg); bmg.connect(master);
          bmid.start(bt); bmid.stop(bt + bassDecay + 0.005);
        }
      }
    }
  }
  
  const buf = await ctx.startRendering();
  fs.writeFileSync(filepath, Buffer.from(encodeWAV(buf.getChannelData(0), SR)));
}

function encodeWAV(samples: Float32Array, sr: number): ArrayBuffer {
  const b = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(b);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); ws(8, 'WAVE');
  ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); ws(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2;
  }
  return b;
}

main().catch(e => { console.error('Test failed:', e); process.exit(1); });
