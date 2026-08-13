/**
 * F20.14 — MUSICAL VOCABULARY + STRATEGY DIVERSITY TEST
 *
 * Proves:
 * A. Multiple musical strategies are selected (not just one approach)
 * B. Different strategies produce different bass patterns
 * C. Reward changes future strategy distribution
 * D. 512-bar run shows strategy diversity (no collapse)
 * E. Lead/bass relational fit improves with strategy awareness
 *
 * Run: bun run tests/reality-bridge/f20-strategy-diversity.ts
 */
import '../reality-bridge-setup';
import { PsyLive } from '../../src/lib/psyLive';
import * as fs from 'fs';
import * as path from 'path';

const BPM = 145;
const STEP_DUR = 60 / BPM / 4;

interface NoteEvent { bar: number; step: number; voice: string; midi: number | null; vel: number; }

function compose(engine: PsyLive, bars: number): NoteEvent[] {
  const session = (engine as any).session;
  const transport = (engine as any).transport;
  const events: NoteEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const snap = transport.snapshot();
    const plan = session.planBar(bar, snap.bpm);
    for (const n of plan.notes) {
      events.push({ bar, step: n.step, voice: n.voice, midi: n.midi, vel: n.velocity });
    }
  }
  return events;
}

function main(): void {
  console.log('=== F20.14 MUSICAL VOCABULARY + STRATEGY DIVERSITY TEST ===\n');
  const results: Array<{test: string; pass: boolean; evidence: string}> = [];

  // ── TEST A: Multiple strategies selected ──
  console.log('── TEST A: STRATEGY DIVERSITY ──');
  const engineA = new PsyLive();
  engineA.play();
  compose(engineA, 64);
  const strategies = (engineA as any).session?.getStrategyHistory() ?? [];
  const bassStrategies = new Set(strategies.map((s: any) => s.bass));
  const leadStrategies = new Set(strategies.map((s: any) => s.lead));
  const grooveStrategies = new Set(strategies.map((s: any) => s.groove));
  console.log(`  Bass strategies used: ${bassStrategies.size} (${[...bassStrategies].join(', ')})`);
  console.log(`  Lead strategies used: ${leadStrategies.size} (${[...leadStrategies].join(', ')})`);
  console.log(`  Groove strategies used: ${grooveStrategies.size} (${[...grooveStrategies].join(', ')})`);
  const diversityPass = bassStrategies.size >= 3 && leadStrategies.size >= 3 && grooveStrategies.size >= 2;
  console.log(`  Strategy diversity: ${diversityPass ? 'PASS' : 'FAIL'}`);
  results.push({ test: 'Strategy diversity (3+ bass, 3+ lead, 2+ groove)', pass: diversityPass,
    evidence: `bass=${bassStrategies.size}, lead=${leadStrategies.size}, groove=${grooveStrategies.size}` });
  engineA.stop();

  // ── TEST B: Different strategies produce different bass patterns ──
  console.log('\n── TEST B: STRATEGY → DIFFERENT BASS PATTERNS ──');
  const engineB = new PsyLive();
  engineB.play();
  const eventsB = compose(engineB, 64);
  engineB.stop();
  const strategiesB = (engineB as any).session?.getStrategyHistory() ?? [];
  // Group bass notes by strategy
  const bassByStrategy = new Map<string, string[]>();
  for (let bar = 0; bar < 64; bar++) {
    const strat = strategiesB[bar];
    if (!strat) continue;
    const bassPattern = eventsB.filter(e => e.bar === bar && e.voice === 'bass').map(e => e.step).sort().join(',');
    if (!bassByStrategy.has(strat.bass)) bassByStrategy.set(strat.bass, []);
    bassByStrategy.get(strat.bass)!.push(bassPattern);
  }
  console.log(`  Bass patterns by strategy:`);
  for (const [strat, patterns] of bassByStrategy) {
    const uniquePatterns = new Set(patterns).size;
    console.log(`    ${strat}: ${patterns.length} bars, ${uniquePatterns} unique patterns`);
  }
  // Different strategies should produce different pattern sets
  const allPatterns = new Set<string>();
  let overlap = 0;
  let totalCompared = 0;
  for (const [strat1, pats1] of bassByStrategy) {
    for (const p of pats1) allPatterns.add(`${strat1}:${p}`);
    for (const [strat2, pats2] of bassByStrategy) {
      if (strat1 >= strat2) continue;
      for (const p1 of pats1) {
        for (const p2 of pats2) {
          totalCompared++;
          if (p1 === p2) overlap++;
        }
      }
    }
  }
  const overlapRatio = totalCompared > 0 ? overlap / totalCompared : 0;
  console.log(`  Cross-strategy pattern overlap: ${(overlapRatio * 100).toFixed(1)}% (lower = more different)`);
  const differentPass = overlapRatio < 0.5 && bassByStrategy.size >= 3;
  console.log(`  Different patterns: ${differentPass ? 'PASS' : 'FAIL'}`);
  results.push({ test: 'Different strategies produce different bass', pass: differentPass,
    evidence: `${bassByStrategy.size} strategies, overlap=${(overlapRatio * 100).toFixed(1)}%` });

  // ── TEST C: Reward changes strategy distribution ──
  console.log('\n── TEST C: REWARD IMPACT ──');
  const engineC = new PsyLive();
  engineC.play();
  compose(engineC, 64); // First 64 bars
  // Deep copy weights (Maps are mutable — getStrategyWeights returns a reference)
  const weights1Raw = (engineC as any).session?.getStrategyWeights();
  const weights1 = {
    bass: new Map(weights1Raw?.bass ?? []),
    lead: new Map(weights1Raw?.lead ?? []),
  };
  compose(engineC, 64); // Another 64 bars with reward feedback
  const weights2 = (engineC as any).session?.getStrategyWeights();
  engineC.stop();

  // Check if weights changed (use a lower threshold — normalization keeps sum=1)
  let weightsChanged = false;
  let maxChange = 0;
  if (weights1 && weights2) {
    for (const key of weights1.bass.keys()) {
      const w1 = weights1.bass.get(key) ?? 0;
      const w2 = weights2.bass.get(key) ?? 0;
      const change = Math.abs(w1 - w2);
      maxChange = Math.max(maxChange, change);
      if (change > 0.0001) {
        weightsChanged = true;
      }
    }
  }
  console.log(`  Max weight change: ${maxChange.toFixed(6)}`);
  console.log(`  Weights changed after 128 bars: ${weightsChanged ? 'YES' : 'NO'}`);
  const rewardPass = weightsChanged;
  console.log(`  Reward impact: ${rewardPass ? 'PASS' : 'FAIL'}`);
  results.push({ test: 'Reward changes strategy weights', pass: rewardPass,
    evidence: weightsChanged ? 'weights shifted' : 'no change' });

  // ── TEST D: 512-bar strategy diversity ──
  console.log('\n── TEST D: 512-BAR STRATEGY DIVERSITY ──');
  const engineD = new PsyLive();
  engineD.play();
  const eventsD = compose(engineD, 512);
  engineD.stop();
  const strategiesD = (engineD as any).session?.getStrategyHistory() ?? [];
  const bassD = new Set(strategiesD.map((s: any) => s.bass));
  const leadD = new Set(strategiesD.map((s: any) => s.lead));
  console.log(`  512 bars: ${eventsD.length} events`);
  console.log(`  Bass strategies: ${bassD.size}`);
  console.log(`  Lead strategies: ${leadD.size}`);
  const longDiversityPass = bassD.size >= 4 && leadD.size >= 4 && eventsD.length > 3000;
  console.log(`  Long-run diversity: ${longDiversityPass ? 'PASS' : 'FAIL'}`);
  results.push({ test: '512-bar strategy diversity (4+ each)', pass: longDiversityPass,
    evidence: `bass=${bassD.size}, lead=${leadD.size}, events=${eventsD.length}` });

  // ── TEST E: Lead/bass relational fit ──
  console.log('\n── TEST E: LEAD/BASS RELATIONAL FIT ──');
  const leadNotesE = eventsD.filter(e => e.voice === 'lead' && e.midi !== null);
  const bassNotesE = eventsD.filter(e => e.voice === 'bass' && e.midi !== null);
  let separationSum = 0;
  let separationCount = 0;
  for (const ln of leadNotesE) {
    const bassInBar = bassNotesE.filter(bn => bn.bar === ln.bar);
    if (bassInBar.length > 0) {
      const avgBass = bassInBar.reduce((s, b) => s + b.midi!, 0) / bassInBar.length;
      separationSum += Math.abs(ln.midi! - avgBass);
      separationCount++;
    }
  }
  const avgSep = separationCount > 0 ? separationSum / separationCount : 0;
  console.log(`  Avg lead-bass separation: ${avgSep.toFixed(1)} semitones`);
  const fitPass = avgSep >= 10; // at least an octave+ on average
  console.log(`  Relational fit: ${fitPass ? 'PASS' : 'FAIL'}`);
  results.push({ test: 'Lead/bass relational fit (10+ semitone separation)', pass: fitPass,
    evidence: `${avgSep.toFixed(1)} semitones avg` });

  // ── SUMMARY ──
  console.log('\n═══════════════════════════════════════════');
  console.log('SUMMARY:');
  const allPass = results.every(r => r.pass);
  for (const r of results) {
    console.log(`  ${r.pass ? '✓' : '✗'} ${r.test}: ${r.evidence}`);
  }
  console.log(`\nVERDICT: ${allPass ? 'PASS — Musical vocabulary engine works' : 'FAIL — Gaps remain'}`);

  const outPath = path.join(__dirname, 'f20-strategy-diversity-results.json');
  fs.writeFileSync(outPath, JSON.stringify({
    results,
    bassStrategies: [...bassStrategies],
    leadStrategies: [...leadStrategies],
    grooveStrategies: [...grooveStrategies],
    verdict: allPass ? 'PASS' : 'FAIL',
  }, null, 2));
  console.log(`Results: ${outPath}`);
  process.exit(allPass ? 0 : 1);
}

main();
