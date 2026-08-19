// src/app/api/telemetry/radio/route.ts
// POST /api/telemetry/radio  → log radio analysis to LOCAL DB (+ optional Turso backup)

import { NextRequest, NextResponse } from 'next/server';
import { ensureLocalSchema, addRadioTelemetry } from '@/lib/local-db';

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

// Lazy Turso backup
async function tryTursoTelemetryBackup(body: RadioTelemetryPayload): Promise<void> {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) return;
  try {
    const { isTursoConfigured, ensureSchema, tursoBatch } = await import('@/lib/turso');
    if (!isTursoConfigured()) return;
    await ensureSchema();
    await tursoBatch([{
      sql: `INSERT INTO radio_telemetry
              (stream_name, bpm, warmth, brightness, loudness, smoothness, style, in_breakdown, measured_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        body.streamName, body.bpm ?? 0, body.warmth ?? 0, body.brightness ?? 0,
        body.loudness ?? 0, body.smoothness ?? 0, body.style ?? 'UNKNOWN',
        body.inBreakdown ? 1 : 0, Date.now(),
      ],
    }]);
  } catch (err) {
    console.warn('[API /telemetry/radio POST] Turso backup failed (non-fatal):', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    ensureLocalSchema();
    const body = (await req.json()) as RadioTelemetryPayload;
    if (!body || typeof body.streamName !== 'string') {
      return NextResponse.json({ ok: false, error: 'streamName required' }, { status: 400 });
    }

    // PRIMARY: local SQLite
    addRadioTelemetry(body);

    // OPTIONAL: Turso backup (lazy)
    await tryTursoTelemetryBackup(body);

    return NextResponse.json({ ok: true, source: 'local' });
  } catch (err) {
    console.error('[API /telemetry/radio POST] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
