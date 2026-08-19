// src/app/api/health/route.ts
// Health check — verifies Turso connection + schema.

import { NextResponse } from 'next/server';
import { isTursoConfigured, ensureSchema, tursoExecute } from '@/lib/turso';

export async function GET() {
  if (!isTursoConfigured()) {
    return NextResponse.json({
      status: 'degraded',
      turso: 'not configured (env vars missing)',
      fallback: 'localStorage',
    });
  }
  try {
    await ensureSchema();
    const result = await tursoExecute('SELECT COUNT(*) as count FROM learning_params');
    const count = result.rows[0]?.count ?? 0;
    return NextResponse.json({
      status: 'ok',
      turso: 'connected',
      learningParams: Number(count),
    });
  } catch (err) {
    return NextResponse.json({
      status: 'error',
      turso: 'connection failed',
      error: String(err),
    }, { status: 500 });
  }
}
