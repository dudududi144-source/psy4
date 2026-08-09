/**
 * Psytrance Radio Stream Registry
 *
 * PRIORITY 2: Real, legal, verified-live 24/7 psytrance radio streams.
 *
 * These are used as REFERENCE SIGNALS for feature extraction.
 * The system NEVER copies audio from these streams. It only extracts
 * acoustic features (BPM, LUFS, spectral balance, transients, etc.)
 * and builds a rolling ReferenceProfile.
 *
 * All streams verified live via HTTP 200 + audio/mpeg content-type + ICY metadata.
 * Verified: 2025-01.
 *
 * Legal: These are public (icy-pub:1) internet radio stations. We only
 * extract features, never record or redistribute audio.
 */

export interface RadioStream {
  id: string;
  name: string;
  url: string;
  format: 'mp3' | 'aac';
  bitrate: number;
  genre: string;               // primary genre
  worldMapping: string[];      // which PSY4 worlds this fits
  hasMetadata: boolean;        // ICY metadata available
  priority: number;            // 1 = primary, 2 = fallback
  notes?: string;
}

export const RADIO_STREAMS: RadioStream[] = [
  {
    id: 'hirschmilch-psytrance',
    name: 'Hirschmilch Psytrance',
    url: 'http://xfer.hirschmilch.de:8000/psytrance.mp3',
    format: 'mp3',
    bitrate: 128,
    genre: 'Psytrance / Goa',
    worldMapping: ['progressive-psy', 'goa', 'cosmic'],
    hasMetadata: true,
    priority: 1,
    notes: 'Established German station, very stable, has now-playing metadata',
  },
  {
    id: 'psyndora-psytrance',
    name: 'Psyndora Psytrance',
    url: 'https://cast.magicstreams.gr:9111/stream/1/',
    format: 'mp3',
    bitrate: 128,
    genre: 'Psytrance / Progressive / Goa / Full-On',
    worldMapping: ['progressive-psy', 'goa', 'acid-psy', 'morning-psy'],
    hasMetadata: true,
    priority: 1,
    notes: 'HTTPS — works in browser without mixed-content issues',
  },
  {
    id: 'babaganousha',
    name: 'Babaganousha Radio',
    url: 'https://babaganousha.net:8443/stream/1/',
    format: 'mp3',
    bitrate: 128,
    genre: 'Psychedelic / Psytrance / Goa',
    worldMapping: ['goa', 'cosmic', 'progressive-psy'],
    hasMetadata: true,
    priority: 1,
    notes: 'HTTPS — browser-friendly, established station',
  },
  {
    id: 'psyradio-progressive',
    name: 'psyradio.fm Progressive',
    url: 'http://streamer.psyradio.org:8030/;listen.mp3',
    format: 'mp3',
    bitrate: 128,
    genre: 'Progressive Psytrance',
    worldMapping: ['progressive-psy', 'deep-psy', 'hypnotic'],
    hasMetadata: true,
    priority: 2,
    notes: 'Dedicated progressive psytrance channel',
  },
  {
    id: 'psy-from-the-sky',
    name: 'Psy from the Sky',
    url: 'http://cast.ru.eu.org/psy',
    format: 'aac',
    bitrate: 128,
    genre: 'Psytrance / Goa',
    worldMapping: ['goa', 'dark-psy', 'forest'],
    hasMetadata: true,
    priority: 2,
    notes: 'AAC+ — may need MP3 fallback in some browsers',
  },
  {
    id: 'space-unicorn',
    name: 'Space Unicorn Radio',
    url: 'https://spaceunicorn.radio/stream',
    format: 'mp3',
    bitrate: 192,
    genre: 'Trance & PsyTrance',
    worldMapping: ['progressive-psy', 'morning-psy'],
    hasMetadata: false,
    priority: 2,
    notes: 'Higher bitrate, broader genre',
  },
];

/**
 * Get the best stream for a given world.
 * Prefers HTTPS streams (browser-compatible without CORS proxy).
 */
export function getStreamForWorld(worldId: string): RadioStream {
  // Find streams that map to this world
  const matching = RADIO_STREAMS.filter(s => s.worldMapping.includes(worldId));
  if (matching.length === 0) {
    // Fallback: return the highest-priority HTTPS stream
    return RADIO_STREAMS.find(s => s.url.startsWith('https')) || RADIO_STREAMS[0];
  }
  // Prefer HTTPS + priority 1
  const httpsP1 = matching.find(s => s.url.startsWith('https') && s.priority === 1);
  if (httpsP1) return httpsP1;
  const https = matching.find(s => s.url.startsWith('https'));
  if (https) return https;
  const p1 = matching.find(s => s.priority === 1);
  if (p1) return p1;
  return matching[0];
}

/**
 * Get fallback streams (ordered by priority).
 */
export function getFallbackStreams(worldId: string, excludeId?: string): RadioStream[] {
  const matching = RADIO_STREAMS.filter(s =>
    s.worldMapping.includes(worldId) && s.id !== excludeId
  );
  // Sort: HTTPS first, then priority
  return matching.sort((a, b) => {
    const aHttps = a.url.startsWith('https') ? 0 : 1;
    const bHttps = b.url.startsWith('https') ? 0 : 1;
    if (aHttps !== bHttps) return aHttps - bHttps;
    return a.priority - b.priority;
  });
}

export const ALL_STREAMS = RADIO_STREAMS;
