/**
 * POST /api/forensic/analyze
 *
 * Runs the full forensic analysis pipeline.
 * Body: { seed?, duration?, worlds?, skipClosedLoop?, skipParamValidation?, skipBassIsolation? }
 * Returns: ForensicReport JSON
 *
 * This is CPU-intensive (renders multiple worlds × multiple tests).
 * Typical duration: 5-15 seconds.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runForensicAnalysis } from '@/lib/studio/engine/forensic/forensicRunner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      seed = 1234,
      duration = 12,
      worlds = ['progressive-psy', 'dark-psy', 'goa', 'acid-psy'],
      skipClosedLoop = false,
      skipParamValidation = false,
      skipBassIsolation = false,
    } = body;

    const report = await runForensicAnalysis({
      seed,
      duration,
      worlds,
      skipClosedLoop,
      skipParamValidation,
      skipBassIsolation,
    });

    return NextResponse.json({
      ok: true,
      report,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[forensic/analyze] Error:', err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
