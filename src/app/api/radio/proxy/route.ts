// src/app/api/radio/proxy/route.ts
// BACKUP: CORS proxy for radio streams that block cross-origin requests.
//
// When a radio stream doesn't send `Access-Control-Allow-Origin` headers,
// the browser's `MediaElementSource` produces silence in the analyser
// (the audio still plays through the <audio> element, but we can't analyze it).
//
// This route proxies the stream through our server, adding CORS headers.
// Usage: /api/radio/proxy?url=https://example.com/stream
//
// The stream is piped through (not buffered) so it works for live streams.

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Streams MUST be in this allowlist (security: prevents open proxy abuse)
const ALLOWED_STREAM_HOSTS = new Set([
  'cast.magicstreams.gr',
  'babaganousha.net',
  'e20.yesstreaming.net',
  'trance.out.airtime.pro',
  'radiorecord.hostingradio.ru',
  'goanight.stream.laut.fm',
  'strm112.1.fm',
  'amoris.sknt.ru',
  'spaceunicorn.radio',
  'streamer.psyradio.org',
]);

export async function GET(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get('url');
  if (!urlParam) {
    return NextResponse.json({ error: 'url parameter required' }, { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(urlParam);
  } catch {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }

  // SECURITY: only proxy allowlisted hosts (prevents open proxy abuse)
  if (!ALLOWED_STREAM_HOSTS.has(targetUrl.hostname)) {
    return NextResponse.json({
      error: 'host not allowed',
      host: targetUrl.hostname,
      allowed: Array.from(ALLOWED_STREAM_HOSTS),
    }, { status: 403 });
  }

  try {
    // Fetch the stream — don't await the full body (it's infinite for live streams)
    const upstream = await fetch(targetUrl.toString(), {
      headers: {
        'User-Agent': 'PsyForge-Pro/1.0 (radio listener)',
        'Accept': 'audio/*',
      },
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({
        error: 'upstream stream failed',
        status: upstream.status,
      }, { status: 502 });
    }

    // Determine content type
    const contentType = upstream.headers.get('content-type') || 'audio/mpeg';

    // Pipe the stream through with CORS headers
    const headers = new Headers({
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Cache-Control': 'no-cache, no-store',
    });

    // Transfer bitrate if available
    const icyBr = upstream.headers.get('icy-br');
    if (icyBr) headers.set('icy-br', icyBr);
    const icyName = upstream.headers.get('icy-name');
    if (icyName) headers.set('icy-name', icyName);

    // Stream the body through (don't buffer — it's live)
    return new NextResponse(upstream.body, {
      status: 200,
      headers,
    });
  } catch (err) {
    console.error('[radio proxy] error:', err);
    return NextResponse.json({
      error: 'proxy failed',
      detail: String(err),
    }, { status: 502 });
  }
}

// Handle CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}
