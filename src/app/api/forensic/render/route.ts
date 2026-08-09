/**
 * POST /api/forensic/render
 *
 * Renders a single world to WAV.
 * Body: { seed, worldId, duration, onlyVoices?, paramOverrides? }
 * Returns: WAV audio file (stereo, 44100Hz, 16-bit)
 */

import { NextRequest, NextResponse } from 'next/server';
import { render, encodeWav, SR } from '@/lib/studio/engine/forensic/offlineRenderer';
import { FORENSIC_WORLDS } from '@/lib/studio/engine/forensic/worlds';
import {
  V_KICK, V_BASS, V_LEAD, V_ACID, V_PAD,
  V_HAT, V_CLAP, V_PERC, V_SHAKER, V_TEXTURE,
  V_RISER, V_IMPACT, V_SWEEP, V_DOWNLIFTER,
} from '@/lib/studio/engine/forensic/voices';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VOICE_MAP: Record<string, number> = {
  kick: V_KICK, bass: V_BASS, lead: V_LEAD, acid: V_ACID, pad: V_PAD,
  hat: V_HAT, clap: V_CLAP, perc: V_PERC, shaker: V_SHAKER, texture: V_TEXTURE,
  riser: V_RISER, impact: V_IMPACT, sweep: V_SWEEP, downlifter: V_DOWNLIFTER,
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      seed = 1234,
      worldId = 'dark-psy',
      duration = 10,
      onlyVoices,
      paramOverrides,
    } = body;

    if (!FORENSIC_WORLDS[worldId]) {
      return NextResponse.json(
        { ok: false, error: `Unknown world: ${worldId}` },
        { status: 400 },
      );
    }

    const onlyVoiceIds = onlyVoices
      ? onlyVoices.map((v: string) => VOICE_MAP[v]).filter((v: number) => v !== undefined)
      : undefined;

    const result = render(seed, worldId, duration, {
      onlyVoices: onlyVoiceIds,
      paramOverrides,
    });

    const wavBuffer = encodeWav(result.samplesL, result.samplesR, SR);

    return new NextResponse(wavBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Disposition': `inline; filename="render_${worldId}_${seed}.wav"`,
        'Content-Length': wavBuffer.byteLength.toString(),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[forensic/render] Error:', err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
