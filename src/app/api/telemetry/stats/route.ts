// src/app/api/telemetry/stats/route.ts
// GET /api/telemetry/stats?hours=24  → aggregate radio_telemetry from LOCAL DB

import { NextRequest, NextResponse } from 'next/server';
import { ensureLocalSchema, getTelemetryStats } from '@/lib/local-db';

export async function GET(req: NextRequest) {
  try {
    await ensureLocalSchema();
    const hours = Number(req.nextUrl.searchParams.get('hours') ?? '24');
    const streamStats = await getTelemetryStats(hours);

    const overall = streamStats.length > 0
      ? {
          avgBpm: streamStats.reduce((s, r) => s + r.avgBpm, 0) / streamStats.length,
          avgWarmth: streamStats.reduce((s, r) => s + r.avgWarmth, 0) / streamStats.length,
          avgBrightness: streamStats.reduce((s, r) => s + r.avgBrightness, 0) / streamStats.length,
          avgLoudness: streamStats.reduce((s, r) => s + r.avgLoudness, 0) / streamStats.length,
          avgSmoothness: streamStats.reduce((s, r) => s + r.avgSmoothness, 0) / streamStats.length,
          totalSamples: streamStats.reduce((s, r) => s + r.samples, 0),
        }
      : null;

    return NextResponse.json({
      ok: true,
      hours,
      streams: streamStats,
      overall,
      source: 'local',
    });
  } catch (err) {
    console.error('[API /telemetry/stats GET] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
