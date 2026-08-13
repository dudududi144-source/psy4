/**
 * PSY4 Vertical Validation — Master Render Script
 *
 * Renders all 45 WAVs (9 units × 5 variants A/B/C/D/E).
 * Deterministic: seeded, frozen inputs from validation/results/frozen-units.json.
 *
 * Output: validation/renders/{compositionId}-seed{N}-{VARIANT}.wav
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ExperimentalUnit, Variant } from './types.ts';
import { renderVariantA } from './variant-a.ts';
import { renderVariantB, renderVariantC, renderVariantD, renderVariantE } from './variant-bcde.ts';

const RENDERS_DIR = '/home/z/my-project/validation/renders';
const UNITS_PATH = '/home/z/my-project/validation/results/frozen-units.json';

async function main(): Promise<void> {
  // Load frozen units
  const units: ExperimentalUnit[] = JSON.parse(fs.readFileSync(UNITS_PATH, 'utf-8'));
  console.log(`Loaded ${units.length} frozen units from ${UNITS_PATH}`);

  // Ensure renders dir
  fs.mkdirSync(RENDERS_DIR, { recursive: true });

  const variants: Variant[] = ['A', 'B', 'C', 'D', 'E'];
  let count = 0;
  const total = units.length * variants.length;

  for (const unit of units) {
    for (const variant of variants) {
      count++;
      const outPath = path.join(RENDERS_DIR, `${unit.compositionId}-seed${unit.seed}-${variant}.wav`);
      console.log(`[${count}/${total}] ${unit.compositionId} seed=${unit.seed} variant=${variant}...`);

      try {
        if (variant === 'A') await renderVariantA(unit, outPath);
        else if (variant === 'B') await renderVariantB(unit, outPath);
        else if (variant === 'C') await renderVariantC(unit, outPath);
        else if (variant === 'D') await renderVariantD(unit, outPath);
        else if (variant === 'E') await renderVariantE(unit, outPath);
      } catch (e) {
        console.error(`  FAILED: ${(e as Error).message}`);
        console.error((e as Error).stack);
      }
    }
  }

  console.log(`\nDone. ${count} renders attempted. Output in ${RENDERS_DIR}`);
  const files = fs.readdirSync(RENDERS_DIR).filter(f => f.endsWith('.wav'));
  console.log(`WAV files produced: ${files.length}`);
}

main().catch(e => { console.error('Render failed:', e); process.exit(1); });
