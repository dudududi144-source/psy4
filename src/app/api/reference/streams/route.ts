/**
 * GET /api/reference/streams
 *
 * Returns the list of available reference radio streams.
 */

import { NextResponse } from 'next/server';
import { ALL_STREAMS } from '@/lib/studio/engine/reference/radioStreams';

export const runtime = 'edge';

export async function GET() {
  return NextResponse.json({
    ok: true,
    streams: ALL_STREAMS.map(s => ({
      id: s.id,
      name: s.name,
      url: s.url,
      format: s.format,
      bitrate: s.bitrate,
      genre: s.genre,
      worldMapping: s.worldMapping,
      hasMetadata: s.hasMetadata,
      priority: s.priority,
      notes: s.notes,
    })),
  });
}
