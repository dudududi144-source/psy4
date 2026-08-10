/**
 * Psytrance Radio Stream Registry
 *
 * Real, legal, verified-live 24/7 psytrance radio streams.
 * Used as REFERENCE SIGNALS for feature extraction — never copied.
 *
 * All streams verified via HTTP 200 + audio content-type.
 * Verified: 2025-08.
 */

export interface RadioStream {
  id: string;
  name: string;
  url: string;
  format: 'mp3' | 'aac';
  bitrate: number;
  genre: string;
  worldMapping: string[];
  hasMetadata: boolean;
  priority: number;
  notes?: string;
}

export const RADIO_STREAMS: RadioStream[] = [
  // ── HTTPS streams (browser-compatible — priority 1) ──
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
    notes: 'HTTPS — broad genre coverage',
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
    notes: 'HTTPS — established station, very stable',
  },
  {
    id: 'psytravel',
    name: 'Psychedelic Travel Radio',
    url: 'https://e20.yesstreaming.net:6148/stream',
    format: 'mp3',
    bitrate: 320,
    genre: 'Forest / Progressive Psytrance',
    worldMapping: ['forest', 'progressive-psy', 'dark-psy'],
    hasMetadata: true,
    priority: 1,
    notes: 'HTTPS 320kbps — high quality',
  },
  {
    id: 'radiozora',
    name: 'RadiOzora Trance',
    url: 'https://trance.out.airtime.pro/trance_a',
    format: 'mp3',
    bitrate: 192,
    genre: 'Darkpsy / Full-On / Progressive',
    worldMapping: ['dark-psy', 'goa', 'progressive-psy'],
    hasMetadata: true,
    priority: 1,
    notes: 'Ozora festival radio — high quality',
  },
  {
    id: 'recordgoa',
    name: 'Record Goa Psy',
    url: 'https://radiorecord.hostingradio.ru/goa96.aacp',
    format: 'aac',
    bitrate: 96,
    genre: 'Goa / Psy Trance',
    worldMapping: ['goa', 'acid-psy'],
    hasMetadata: true,
    priority: 1,
    notes: 'Radio Record Russia — Goa channel',
  },
  {
    id: 'goanight',
    name: 'Goanight',
    url: 'https://goanight.stream.laut.fm/goanight',
    format: 'mp3',
    bitrate: 128,
    genre: 'Goa / Psytrance',
    worldMapping: ['goa', 'cosmic'],
    hasMetadata: true,
    priority: 1,
    notes: 'HTTPS — Goa focused',
  },
  {
    id: '1fm-psytrance',
    name: '1.FM Psytrance',
    url: 'https://strm112.1.fm/psytrance_mobile_mp3',
    format: 'mp3',
    bitrate: 192,
    genre: 'Psytrance / Full-On',
    worldMapping: ['progressive-psy', 'morning-psy', 'acid-psy'],
    hasMetadata: true,
    priority: 1,
    notes: '1.FM network — reliable',
  },
  {
    id: 'amoris-goa',
    name: 'Anima Amoris Goa',
    url: 'https://amoris.sknt.ru/goa.mp3',
    format: 'mp3',
    bitrate: 128,
    genre: 'Goa / Psy Trance',
    worldMapping: ['goa', 'dark-psy', 'forest'],
    hasMetadata: false,
    priority: 1,
    notes: 'HTTPS — Goa/Psy dedicated',
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
  // ── HTTP streams (need proxy — priority 2) ──
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
    notes: 'Dedicated progressive psytrance channel (HTTP — needs proxy)',
  },
];

/**
 * Get the best stream for a given world.
 */
export function getStreamForWorld(worldId: string): RadioStream {
  const matching = RADIO_STREAMS.filter(s => s.worldMapping.includes(worldId));
  if (matching.length === 0) {
    return RADIO_STREAMS.find(s => s.url.startsWith('https')) || RADIO_STREAMS[0];
  }
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
  return matching.sort((a, b) => {
    const aHttps = a.url.startsWith('https') ? 0 : 1;
    const bHttps = b.url.startsWith('https') ? 0 : 1;
    if (aHttps !== bHttps) return aHttps - bHttps;
    return a.priority - b.priority;
  });
}

export const ALL_STREAMS = RADIO_STREAMS;
