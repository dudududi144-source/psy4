import { NextResponse } from 'next/server';
import { validateSystem } from '@/lib/studio/validation/validator';
import { Studio } from '@/lib/studio/render/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Run the closed-loop validator against a fresh studio instance. */
export async function POST() {
  try {
    const studio = new Studio({ bars: 4, sampleRate: 22050, blockSize: 256, seed: 1337, bpm: 138 });
    const report = validateSystem(studio);
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, overall: 'FAIL', checks: [], summary: { total: 0, pass: 0, fail: 0, blocked: 0, notImplemented: 0 } }, { status: 500 });
  }
}
