// src/app/api/learning/patterns/route.ts
// GET  /api/learning/patterns?limit=10   → fetch top-N patterns from LOCAL DB
// POST /api/learning/patterns            → push pattern observations to LOCAL DB

import { NextRequest, NextResponse } from 'next/server';
import { ensureLocalSchema, getTopPatterns, upsertPattern } from '@/lib/local-db';

function getUserId(req: NextRequest): string {
  return req.headers.get('X-User-Id') || 'anonymous';
}

export async function GET(req: NextRequest) {
  try {
    await ensureLocalSchema();
    const userId = getUserId(req);
    const limit = Number(req.nextUrl.searchParams.get('limit') ?? '32');
    const patterns = await getTopPatterns(userId, limit);
    return NextResponse.json({
      ok: true,
      patterns: patterns.map(p => ({
        fingerprint: p.fingerprint,
        reward: p.reward,
        // hits removed (not in PatternEntry)
        // lastUsed removed
        // createdAt removed
      })),
      count: patterns.length,
      source: 'local',
    });
  } catch (err) {
    console.error('[API /learning/patterns GET] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

interface PatternObservation {
  fingerprint: string;
  reward: number;
}

export async function POST(req: NextRequest) {
  try {
    await ensureLocalSchema();
    const userId = getUserId(req);
    const body = await req.json();
    const { patterns } = body as { patterns?: PatternObservation[] };
    if (!Array.isArray(patterns)) {
      return NextResponse.json({ ok: false, error: 'patterns must be an array' }, { status: 400 });
    }

    let upserted = 0;
    for (const p of patterns) {
      if (!p || typeof p.fingerprint !== 'string' || typeof p.reward !== 'number') continue;
      await upsertPattern(userId, p.fingerprint, p.reward);
      upserted++;
    }

    return NextResponse.json({ ok: true, upserted, source: 'local' });
  } catch (err) {
    console.error('[API /learning/patterns POST] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
