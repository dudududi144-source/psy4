/**
 * GET /api/reference/proxy?stream=<id>&continuous=1
 *
 * Server-side proxy for radio streams. Solves:
 *   1. CORS — browser can't fetch cross-origin streams directly
 *   2. Mixed content — HTTP streams from HTTPS page
 *   3. ICY metadata — strips metadata from the audio bytes
 *
 * Two modes:
 *   - Default (no continuous param): returns ~20 seconds of audio as a
 *     complete response (for decodeAudioData analysis)
 *   - continuous=1: streams the audio indefinitely (for playback)
 */

import { NextRequest } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const STREAM_URLS: Record<string, string> = {
  'hirschmilch': 'http://xfer.hirschmilch.de:8000/psytrance.mp3',
  'psyndora': 'https://cast.magicstreams.gr:9111/stream/1/',
  'babaganousha': 'https://babaganousha.net:8443/stream/1/',
  'psyradio-progressive': 'http://streamer.psyradio.org:8030/;listen.mp3',
  'psy-from-the-sky': 'http://cast.ru.eu.org/psy',
  'space-unicorn': 'https://spaceunicorn.radio/stream',
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const streamId = searchParams.get('stream') || 'babaganousha';
  const continuous = searchParams.get('continuous') === '1';

  const streamUrl = STREAM_URLS[streamId];
  if (!streamUrl) {
    return new Response('Unknown stream', { status: 400 });
  }

  try {
    const upstream = await fetch(streamUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PSY4/1.0)',
        // Don't request ICY metadata — we want clean audio only
        'Accept': 'audio/mpeg, audio/aac, audio/aacp, */*',
      },
    });

    if (!upstream.ok || !upstream.body) {
      return new Response(`Upstream error: ${upstream.status}`, { status: 502 });
    }

    const contentType = upstream.headers.get('content-type') || 'audio/mpeg';
    const icyMetaint = parseInt(upstream.headers.get('icy-metaint') || '0', 10);

    // If ICY metadata is present, we need to strip it
    const hasIcyMetadata = icyMetaint > 0;

    // Continuous mode: stream indefinitely (for audio playback)
    if (continuous) {
      const reader = upstream.body.getReader();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            if (hasIcyMetadata) {
              // Strip ICY metadata while streaming
              let buffer = new Uint8Array(0);
              let audioEnd = 0;
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) {
                  // Append to buffer
                  const newBuf = new Uint8Array(buffer.length + value.length);
                  newBuf.set(buffer);
                  newBuf.set(value, buffer.length);
                  buffer = newBuf;

                  // Process complete blocks (metaint bytes audio + 1 byte len + len*16 bytes metadata)
                  while (buffer.length >= icyMetaint + 1) {
                    // Extract audio block
                    const audioBlock = buffer.subarray(0, icyMetaint);
                    controller.enqueue(audioBlock);
                    // Read metadata length
                    const metaLen = buffer[icyMetaint] * 16;
                    const totalBlock = icyMetaint + 1 + metaLen;
                    if (buffer.length < totalBlock) break;
                    // Remove processed block
                    buffer = buffer.subarray(totalBlock);
                  }
                }
              }
            } else {
              // No ICY metadata — just pass through
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) controller.enqueue(value);
              }
            }
          } catch (e) {
            // stream ended or aborted
          } finally {
            controller.close();
            try { reader.cancel(); } catch {}
          }
        },
        cancel() {
          try { reader.cancel(); } catch {}
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Window mode: collect ~20 seconds of audio (for analysis)
    const targetBytes = 320 * 1024; // ~20s at 128kbps
    let collected = 0;
    const chunks: Uint8Array[] = [];
    const reader = upstream.body.getReader();

    try {
      while (collected < targetBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          collected += value.length;
        }
      }
    } finally {
      reader.cancel();
    }

    // Concatenate chunks
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const rawBytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      rawBytes.set(c, offset);
      offset += c.length;
    }

    // Strip ICY metadata if present
    let audioBytes: Uint8Array;
    if (hasIcyMetadata) {
      audioBytes = stripIcyMetadata(rawBytes, icyMetaint);
    } else {
      audioBytes = rawBytes;
    }

    return new Response(audioBytes, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': audioBytes.length.toString(),
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[proxy] Error:', message);
    return new Response(`Proxy error: ${message}`, { status: 502 });
  }
}

/**
 * Strip ICY metadata from an audio stream.
 * Format: [audio data (metaint bytes)] [1 byte length] [metadata (length*16 bytes)]
 */
function stripIcyMetadata(data: Uint8Array, metaint: number): Uint8Array {
  const result: number[] = [];
  let pos = 0;
  while (pos < data.length) {
    // Copy audio chunk
    const audioEnd = Math.min(pos + metaint, data.length);
    for (let i = pos; i < audioEnd; i++) {
      result.push(data[i]);
    }
    pos = audioEnd;
    // Read metadata length
    if (pos < data.length) {
      const metaLen = data[pos] * 16;
      pos++; // skip length byte
      pos += metaLen; // skip metadata
    }
  }
  return new Uint8Array(result);
}
