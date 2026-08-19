// src/app/api/learning/patterns/route.ts
// GET  /api/learning/patterns?limit=10   → fetch top-N highest-reward patterns
// POST /api/learning/patterns            → push new pattern observations (batch)

import { NextRequest, NextResponse } from 'next/server';
import { isTursoConfigured, ensureSchema, tursoExecute, tursoBatch } from '@/lib/turso';

export async function GET(req: NextRequest) {
  if (!isTursoConfigured()) {
    return NextResponse.json({ ok: false, reason: 'turso not configured' }, { status: 503 });
  }
  try {
    await ensureSchema();
    const limit = Number(req.nextUrl.searchParams.get('limit') ?? '32');
    const result = await tursoExecute(
      'SELECT fingerprint, reward, hits, last_used, created_at FROM pattern_memory ORDER BY reward DESC LIMIT ?',
      [Math.min(100, Math.max(1, limit))]
    );
    const patterns = result.rows.map(r => ({
      fingerprint: String(r.fingerprint ?? ''),
      reward: Number(r.reward ?? 0),
      hits: Number(r.hits ?? 0),
      lastUsed: Number(r.last_used ?? 0),
      createdAt: Number(r.created_at ?? 0),
    }));
    return NextResponse.json({ ok: true, patterns, count: patterns.length });
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
  if (!isTursoConfigured()) {
    return NextResponse.json({ ok: false, reason: 'turso not configured' }, { status: 503 });
  }
  try {
    await ensureSchema();
    const body = await req.json();
    const { patterns } = body as { patterns?: PatternObservation[] };
    if (!Array.isArray(patterns)) {
      return NextResponse.json({ ok: false, error: 'patterns must be an array' }, { status: 400 });
    }
    const now = Date.now();
    const stmts: Array<{ sql: string; args: (string | number | null)[] }> = [];
    for (const p of patterns) {
      if (!p || typeof p.fingerprint !== 'string' || typeof p.reward !== 'number') continue;
      stmts.push({
        sql: `INSERT INTO pattern_memory (fingerprint, reward, hits, last_used, created_at) VALUES (?, ?, 1, ?, ?)
              ON CONFLICT(fingerprint) DO UPDATE SET
                reward = (pattern_memory.reward * 0.7 + excluded.reward * 0.3),
                hits = pattern_memory.hits + 1,
                last_used = excluded.last_used`,
        args: [p.fingerprint, p.reward, now / 1000, now],
      });
    }
    if (stmts.length > 0) {
      // Add prune statement
      stmts.push({
        sql: 'DELETE FROM pattern_memory WHERE fingerprint NOT IN (SELECT fingerprint FROM pattern_memory ORDER BY reward DESC LIMIT 500)',
        args: [],
      });
      await tursoBatch(stmts);
    }
    return NextResponse.json({ ok: true, upserted: stmts.length - 1 });
  } catch (err) {
    console.error('[API /learning/patterns POST] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
