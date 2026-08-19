// src/app/api/learning/patterns/route.ts
// GET  /api/learning/patterns?limit=10   → fetch top-N patterns from LOCAL DB
// POST /api/learning/patterns            → push pattern observations to LOCAL DB
//
// LOCAL-FIRST: local SQLite primary, Turso optional backup.

import { NextRequest, NextResponse } from 'next/server';
import { ensureLocalSchema, getTopPatterns, upsertPattern } from '@/lib/local-db';

function getUserId(req: NextRequest): string {
  return req.headers.get('X-User-Id') || 'anonymous';
}

// Lazy Turso backup
async function tryTursoPatternBackup(userId: string, patterns: Array<{ fingerprint: string; reward: number }>): Promise<void> {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) return;
  try {
    const { isTursoConfigured, ensureSchema, tursoBatch } = await import('@/lib/turso');
    if (!isTursoConfigured()) return;
    await ensureSchema();
    const now = Date.now();
    const stmts = patterns
      .filter(p => p && typeof p.fingerprint === 'string' && typeof p.reward === 'number')
      .map(p => ({
        sql: `INSERT INTO pattern_memory (fingerprint, reward, hits, last_used, created_at, user_id) VALUES (?, ?, 1, ?, ?, ?)
              ON CONFLICT(fingerprint, COALESCE(user_id, 'anonymous')) DO UPDATE SET
                reward = (pattern_memory.reward * 0.7 + excluded.reward * 0.3),
                hits = pattern_memory.hits + 1,
                last_used = excluded.last_used`,
        args: [p.fingerprint, p.reward, now / 1000, now, userId],
      }));
    if (stmts.length > 0) await tursoBatch(stmts);
  } catch (err) {
    console.warn('[API /learning/patterns POST] Turso backup failed (non-fatal):', err);
  }
}

export async function GET(req: NextRequest) {
  try {
    ensureLocalSchema();
    const userId = getUserId(req);
    const limit = Number(req.nextUrl.searchParams.get('limit') ?? '32');
    const patterns = getTopPatterns(userId, limit);
    return NextResponse.json({
      ok: true,
      patterns: patterns.map(p => ({
        fingerprint: p.fingerprint,
        reward: p.reward,
        hits: p.hits,
        lastUsed: p.last_used,
        createdAt: p.created_at,
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
    ensureLocalSchema();
    const userId = getUserId(req);
    const body = await req.json();
    const { patterns } = body as { patterns?: PatternObservation[] };
    if (!Array.isArray(patterns)) {
      return NextResponse.json({ ok: false, error: 'patterns must be an array' }, { status: 400 });
    }

    // PRIMARY: local SQLite
    let upserted = 0;
    for (const p of patterns) {
      if (!p || typeof p.fingerprint !== 'string' || typeof p.reward !== 'number') continue;
      upsertPattern(userId, p.fingerprint, p.reward);
      upserted++;
    }

    // OPTIONAL: Turso backup (lazy)
    if (upserted > 0) {
      await tryTursoPatternBackup(userId, patterns.filter(p => p && typeof p.fingerprint === 'string' && typeof p.reward === 'number'));
    }

    return NextResponse.json({ ok: true, upserted, source: 'local' });
  } catch (err) {
    console.error('[API /learning/patterns POST] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
