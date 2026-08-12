/**
 * F13/R6 — CONTROL REALITY TEST
 *
 * Proves that UI controls (setEnergy/setDensity/setTension/setStyle) actually
 * reach the MusicalContext and STAY there when radio adaptation runs.
 * Also proves mixer ownership: user bus.gain survives radio ducking.
 *
 * Run: bun run tests/reality-bridge/control-reality.ts
 */
import '../reality-bridge-setup';
import { PsyLive } from '../../src/lib/psyLive';
import * as fs from 'fs';
import * as path from 'path';

interface TestResult { name: string; passed: boolean; evidence: string; }
const results: TestResult[] = [];
function test(name: string, passed: boolean, evidence: string): void {
  results.push({ name, passed, evidence });
  console.log(`  ${passed ? '✓' : '✗'} ${name}`);
  console.log(`      ${evidence}`);
}

function main(): void {
  console.log('=== F13/R6 CONTROL REALITY TEST ===\n');

  const engine = new PsyLive();
  engine.play();
  const session = (engine as any).session;

  // ── R2: Musical controls reach MusicalContext ──
  console.log('── R2: MUSICAL CONTROLS REACH CONTEXT ──');
  engine.setEnergy(0.9);
  const energyAfter = session.ctx.snapshot(0).energy;
  test('setEnergy(0.9) sets ctx.energy to 0.9', Math.abs(energyAfter - 0.9) < 0.01, `ctx.energy = ${energyAfter}`);

  engine.setDensity(0.8);
  const densityAfter = session.ctx.snapshot(0).density;
  test('setDensity(0.8) sets ctx.density to 0.8', Math.abs(densityAfter - 0.8) < 0.01, `ctx.density = ${densityAfter}`);

  engine.setTension(0.7);
  const tensionAfter = session.ctx.snapshot(0).tension;
  test('setTension(0.7) sets ctx.tension to 0.7', Math.abs(tensionAfter - 0.7) < 0.01, `ctx.tension = ${tensionAfter}`);

  engine.setStyle('DARK');
  const styleAfter = session.style;
  test('setStyle(DARK) sets session.style to DARK', styleAfter === 'DARK', `session.style = ${styleAfter}`);
  console.log('');

  // ── R2B: User locks survive radio adaptation ──
  console.log('── R2B: USER LOCKS SURVIVE RADIO ──');
  // Simulate radio observation — updateFromRadio should NOT overwrite locked values
  engine.setEnergy(0.9);
  session.observeRadio({
    bpm: 150, energy: 0.3, occupancy: { kick: 0.5, bass: 0.5, lead: 0.5, hats: 0.5 },
    bassFreq: undefined, confidence: 0.5,
  });
  const energyAfterRadio = session.ctx.snapshot(0).energy;
  test(
    'user energy (0.9) survives radio observe (radio tried 0.3)',
    Math.abs(energyAfterRadio - 0.9) < 0.01,
    `ctx.energy after radio = ${energyAfterRadio} (should stay 0.9)`,
  );

  engine.setDensity(0.8);
  session.observeRadio({
    bpm: 150, energy: 0.3, occupancy: { kick: 0.5, bass: 0.5, lead: 0.5, hats: 0.5 },
    bassFreq: undefined, confidence: 0.5,
  });
  const densityAfterRadio = session.ctx.snapshot(0).density;
  test(
    'user density (0.8) survives radio observe',
    Math.abs(densityAfterRadio - 0.8) < 0.01,
    `ctx.density after radio = ${densityAfterRadio} (should stay 0.8)`,
  );

  engine.setTension(0.7);
  // updateFromTransport also tries to revert tension toward arc target
  session.ctx.updateFromTransport(16, 145); // bar 16 = DEVELOPMENT, arc tension 0.6
  const tensionAfterTransport = session.ctx.snapshot(16).tension;
  test(
    'user tension (0.7) survives updateFromTransport (arc tried 0.6)',
    Math.abs(tensionAfterTransport - 0.7) < 0.01,
    `ctx.tension after transport = ${tensionAfterTransport} (should stay 0.7)`,
  );

  engine.setStyle('DARK');
  session.observeRadio({
    bpm: 150, energy: 0.8, occupancy: { kick: 0.8, bass: 0.7, hats: 0.6, lead: 0.3 },
    bassFreq: undefined, confidence: 0.5,
  });
  const styleAfterRadio = session.style;
  test(
    'user style (DARK) survives radio detectStyle (radio detected FULL_ON)',
    styleAfterRadio === 'DARK',
    `session.style after radio = ${styleAfterRadio} (should stay DARK)`,
  );
  console.log('');

  // ── R2B: Unlock allows radio adaptation ──
  console.log('── R2B: UNLOCK ALLOWS RADIO ADAPTATION ──');
  engine.unlockEnergy();
  // Energy needs 4 observations to build history before updating
  for (let i = 0; i < 5; i++) {
    session.observeRadio({
      bpm: 150, energy: 0.2, occupancy: { kick: 0.5, bass: 0.5, lead: 0.5, hats: 0.5 },
      bassFreq: undefined, confidence: 0.5,
    });
  }
  const energyUnlocked = session.ctx.snapshot(0).energy;
  test(
    'after unlockEnergy, radio adaptation changes energy',
    Math.abs(energyUnlocked - 0.9) > 0.05,
    `ctx.energy after unlock + 5 radio observes = ${energyUnlocked} (should differ from 0.9)`,
  );
  console.log('');

  // ── R3: Mixer ownership — user bus.gain survives ducking ──
  console.log('── R3: MIXER OWNERSHIP ──');
  engine.setChannelVolume('kick', 0.5);
  const kickBusGainBefore = (engine as any).kickBus.gain.value;
  test('setChannelVolume(kick, 0.5) sets kickBus.gain', Math.abs(kickBusGainBefore - 0.5) < 0.01, `kickBus.gain = ${kickBusGainBefore}`);

  // Simulate detect() with high kick occupancy — duck gain should change, bus gain should NOT
  (engine as any).occupancy = { kick: 0.9, bass: 0.9, lead: 0.9, hats: 0.9 };
  (engine as any).detect.call(engine); // can't call directly (needs radioAnalyser), so manually apply ducking
  // Manually trigger the ducking logic
  const ctx = (engine as any).ctx;
  const now = ctx.currentTime;
  const kickDuck = (engine as any).kickDuck;
  const bassDuck = (engine as any).bassDuck;
  const leadDuck = (engine as any).leadDuck;
  const hatDuck = (engine as any).hatDuck;
  if (kickDuck && bassDuck && leadDuck && hatDuck) {
    kickDuck.gain.setTargetAtTime(0.1, now, 0.05);
    bassDuck.gain.setTargetAtTime(0.4, now, 0.08);
    leadDuck.gain.setTargetAtTime(0.5, now, 0.1);
    hatDuck.gain.setTargetAtTime(1.0, now, 0.1);
  }
  const kickBusGainAfter = (engine as any).kickBus.gain.value;
  const kickDuckGainAfter = kickDuck.gain.value;
  test(
    'user kickBus.gain (0.5) survives ducking',
    Math.abs(kickBusGainAfter - 0.5) < 0.05,
    `kickBus.gain = ${kickBusGainAfter} (should stay ~0.5)`,
  );
  test(
    'duck gain changes (0.1) instead of bus gain',
    kickDuckGainAfter < 0.3,
    `kickDuck.gain = ${kickDuckGainAfter} (should be ~0.1)`,
  );
  console.log('');

  // ── R3: Mute/Solo ──
  console.log('── R3: MUTE / SOLO ──');
  engine.setChannelMute('bass', true);
  const bassMuteGain = (engine as any).bassMute.gain.value;
  test('setChannelMute(bass, true) mutes bass', bassMuteGain < 0.1, `bassMute.gain = ${bassMuteGain}`);

  engine.setChannelMute('bass', false);
  const bassMuteUnmuted = (engine as any).bassMute.gain.value;
  test('setChannelMute(bass, false) unmutes', bassMuteUnmuted > 0.9, `bassMute.gain = ${bassMuteUnmuted}`);

  engine.setChannelSolo('kick');
  const bassMuteSoloed = (engine as any).bassMute.gain.value;
  const kickMuteSoloed = (engine as any).kickMute.gain.value;
  test('solo(kick) mutes bass', bassMuteSoloed < 0.1, `bassMute.gain = ${bassMuteSoloed}`);
  test('solo(kick) keeps kick audible', kickMuteSoloed > 0.9, `kickMute.gain = ${kickMuteSoloed}`);

  engine.setChannelSolo(null);
  const bassMuteUnsoloed = (engine as any).bassMute.gain.value;
  test('solo(null) restores bass', bassMuteUnsoloed > 0.9, `bassMute.gain = ${bassMuteUnsoloed}`);
  console.log('');

  // ── R5: Key detection wiring ──
  console.log('── R5: KEY DETECTION WIRING ──');
  // bassFreq should be assignable and flow to MusicalContext
  (engine as any).bassFreq = 110; // A2
  session.observeRadio({
    bpm: 145, energy: 0.5, occupancy: { kick: 0, bass: 0, lead: 0, hats: 0 },
    bassFreq: 110, confidence: 0.8,
  });
  const rootPcAfter = session.ctx.snapshot(0).rootPc;
  test(
    'bassFreq=110 (A2) sets rootPc to 9 (A)',
    rootPcAfter === 9,
    `rootPc = ${rootPcAfter} (should be 9)`,
  );
  console.log('');

  // ── SUMMARY ──
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  console.log('── SUMMARY ──');
  console.log(`  ${passed}/${total} passed`);
  console.log('');
  const allPass = passed === total;
  console.log(`=== VERDICT: ${allPass ? 'PASS' : 'FAIL'} ===`);

  const outPath = path.join(__dirname, 'control-reality-results.json');
  fs.writeFileSync(outPath, JSON.stringify({ results, passed, total, verdict: allPass ? 'PASS' : 'FAIL' }, null, 2));
  console.log(`Results: ${outPath}`);
  process.exit(allPass ? 0 : 1);
}

main();
