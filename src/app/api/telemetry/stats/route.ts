// src/app/api/telemetry/stats/route.ts
// GET /api/telemetry/stats?hours=24
// Aggregates radio_telemetry data into statistics for offline analysis.
// Answers: "what does commercial psytrance actually sound like, on average?"

import { NextRequest, NextResponse } from 'next/server';
import { isTursoConfigured, ensureSchema, tursoExecute } from '@/lib/turso';

export async function GET(req: NextRequest) {
  if (!isTursoConfigured()) {
    return NextResponse.json({ ok: false, reason: 'turso not configured' }, { status: 503 });
  }
  try {
    await ensureSchema();
    const hours = Number(req.nextUrl.searchParams.get('hours') ?? '24');
    const sinceMs = Date.now() - hours * 3600 * 1000;

    // Aggregate: average warmth, brightness, loudness, smoothness, bpm per stream
    const result = await tursoExecute(
      `SELECT
        stream_name,
        COUNT(*) as samples,
        AVG(bpm) as avg_bpm,
        AVG(warmth) as avg_warmth,
        AVG(brightness) as avg_brightness,
        AVG(loudness) as avg_loudness,
        AVG(smoothness) as avg_smoothness,
        SUM(in_breakdown) as breakdown_count,
        MIN(measured_at) as first_seen,
        MAX(measured_at) as last_seen
      FROM radio_telemetry
      WHERE measured_at > ?
      GROUP BY stream_name
      ORDER BY samples DESC`,
      [sinceMs]
    );

    const streamStats = result.rows.map(r => ({
      streamName: String(r.stream_name ?? ''),
      samples: Number(r.samples ?? 0),
      avgBpm: Number(r.avg_bpm ?? 0),
      avgWarmth: Number(r.avg_warmth ?? 0),
      avgBrightness: Number(r.avg_brightness ?? 0),
      avgLoudness: Number(r.avg_loudness ?? 0),
      avgSmoothness: Number(r.avg_smoothness ?? 0),
      breakdownPct: Number(r.samples ?? 0) > 0
        ? (Number(r.breakdown_count ?? 0) / Number(r.samples)) * 100
        : 0,
      firstSeen: Number(r.first_seen ?? 0),
      lastSeen: Number(r.last_seen ?? 0),
    }));

    // Overall averages across all streams
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
    });
  } catch (err) {
    console.error('[API /telemetry/stats GET] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
