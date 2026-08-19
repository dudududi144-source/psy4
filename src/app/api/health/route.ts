// src/app/api/health/route.ts
// Health check — verifies LOCAL database (primary) + Turso (optional backup).

import { NextResponse } from 'next/server';
import { ensureLocalSchema, getDBStats } from '@/lib/local-db';
import { isTursoConfigured, ensureSchema } from '@/lib/turso';

export async function GET() {
  try {
    await ensureLocalSchema();
    const stats = await getDBStats();
    const tursoConfigured = isTursoConfigured();
    let tursoConnected = false;
    if (tursoConfigured) {
      try { tursoConnected = await ensureSchema(); } catch { tursoConnected = false; }
    }
    return NextResponse.json({
      status: 'ok',
      local: 'connected',
      learningParams: stats.learningParams,
      patterns: stats.patterns,
      telemetry: stats.telemetry,
      users: stats.users,
      turso: tursoConnected ? 'connected (backup)' : tursoConfigured ? 'configured but unreachable' : 'not configured',
      tursoBackup: tursoConnected,
    });
  } catch (err) {
    return NextResponse.json({
      status: 'error',
      local: 'connection failed',
      error: String(err),
    }, { status: 500 });
  }
}
