// src/app/api/telemetry/radio/route.ts
// POST /api/telemetry/radio  → log a radio analysis snapshot

import { NextRequest, NextResponse } from 'next/server';
import { isTursoConfigured, ensureSchema, tursoBatch } from '@/lib/turso';

interface RadioTelemetryPayload {
  streamName: string;
  bpm: number;
  warmth: number;
  brightness: number;
  loudness: number;
  smoothness: number;
  style: string;
  inBreakdown: boolean;
}

export async function POST(req: NextRequest) {
  if (!isTursoConfigured()) {
    return NextResponse.json({ ok: false, reason: 'turso not configured' }, { status: 503 });
  }
  try {
    await ensureSchema();
    const body = (await req.json()) as RadioTelemetryPayload;
    if (!body || typeof body.streamName !== 'string') {
      return NextResponse.json({ ok: false, error: 'streamName required' }, { status: 400 });
    }
    await tursoBatch([
      {
        sql: `INSERT INTO radio_telemetry
                (stream_name, bpm, warmth, brightness, loudness, smoothness, style, in_breakdown, measured_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          body.streamName,
          body.bpm ?? 0,
          body.warmth ?? 0,
          body.brightness ?? 0,
          body.loudness ?? 0,
          body.smoothness ?? 0,
          body.style ?? 'UNKNOWN',
          body.inBreakdown ? 1 : 0,
          Date.now(),
        ],
      },
      {
        sql: 'DELETE FROM radio_telemetry WHERE id NOT IN (SELECT id FROM radio_telemetry ORDER BY measured_at DESC LIMIT 10000)',
        args: [],
      },
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[API /telemetry/radio POST] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
