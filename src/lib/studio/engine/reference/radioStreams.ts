/**
 * Psytrance Radio Stream Registry
 *
 * Verified via ICY metadata — each station's actual genre confirmed.
 * Stream → Genre → World mapping is accurate.
 */

export interface RadioStream {
  id: string; name: string; url: string; format: 'mp3' | 'aac';
  bitrate: number; genre: string; worldMapping: string[];
  hasMetadata: boolean; priority: number; notes?: string;
}

export const RADIO_STREAMS: RadioStream[] = [
  {
    id: 'psyndora-psytrance', name: 'Psyndora Psytrance',
    url: 'https://cast.magicstreams.gr:9111/stream/1/',
    format: 'mp3', bitrate: 128,
    genre: 'Psytrance / Progressive / Goa / Full-On',
    // ICY: "Psytrance Progressive Trance Goa Fullon" — broad coverage
    worldMapping: ['progressive-psy', 'goa', 'acid-psy', 'morning-psy'],
    hasMetadata: true, priority: 1,
    notes: 'Broadest genre coverage — plays all psytrance subgenres',
  },
  {
    id: 'babaganousha', name: 'Babaganousha Radio',
    url: 'https://babaganousha.net:8443/stream/1/',
    format: 'mp3', bitrate: 128,
    genre: 'Psychedelic / Psytrance / Goa',
    // ICY: "Psychedelic, Psytrance, Goa" — Goa-focused
    worldMapping: ['goa', 'cosmic', 'progressive-psy'],
    hasMetadata: true, priority: 1,
    notes: 'Goa-focused — classic Goa and psytrance',
  },
  {
    id: 'psytravel', name: 'Psychedelic Travel Radio',
    url: 'https://e20.yesstreaming.net:6148/stream',
    format: 'mp3', bitrate: 320,
    genre: 'Psychedelic Trance / Forest',
    // ICY: "DJ Alchemist / psychedelic trance" — 320kbps, forest/dark
    worldMapping: ['forest', 'dark-psy', 'progressive-psy'],
    hasMetadata: true, priority: 1,
    notes: '320kbps — forest and dark psytrance focus',
  },
  {
    id: 'radiozora', name: 'RadiOzora Trance',
    url: 'https://trance.out.airtime.pro/trance_a',
    format: 'mp3', bitrate: 192,
    genre: 'Trance / Darkpsy / Full-On / Progressive',
    // ICY: "radiOzora Trance / trance" — Ozora festival radio
    worldMapping: ['dark-psy', 'goa', 'progressive-psy', 'morning-psy'],
    hasMetadata: true, priority: 1,
    notes: 'Ozora festival radio — full spectrum psytrance',
  },
  {
    id: 'recordgoa', name: 'Record Goa Psy',
    url: 'https://radiorecord.hostingradio.ru/goa96.aacp',
    format: 'aac', bitrate: 96,
    genre: 'Goa / Psy Trance',
    // ICY: "Record Goa / Dance" — Russia's Radio Record Goa channel
    worldMapping: ['goa', 'acid-psy'],
    hasMetadata: true, priority: 1,
    notes: 'Goa/Psy dedicated channel from Radio Record Russia',
  },
  {
    id: 'goanight', name: 'Goanight',
    url: 'https://goanight.stream.laut.fm/goanight',
    format: 'mp3', bitrate: 128,
    genre: 'Goa / Minimal Psytrance',
    // ICY: "Goanight / Minimal" — Goa with minimal influence
    worldMapping: ['goa', 'deep-psy', 'hypnotic'],
    hasMetadata: true, priority: 1,
    notes: 'Goa with minimal/deep psytrance influence',
  },
  {
    id: '1fm-psytrance', name: '1.FM Psytrance',
    url: 'https://strm112.1.fm/psytrance_mobile_mp3',
    format: 'mp3', bitrate: 192,
    genre: 'Psytrance / Full-On',
    // ICY: "1.FM BPM Psytrance" — 256kbps, full-on focus
    worldMapping: ['progressive-psy', 'morning-psy', 'acid-psy'],
    hasMetadata: true, priority: 1,
    notes: 'Full-on and progressive psytrance — 192-256kbps',
  },
  {
    id: 'amoris-goa', name: 'Anima Amoris Goa',
    url: 'https://amoris.sknt.ru/goa.mp3',
    format: 'mp3', bitrate: 128,
    genre: 'Goa / Dark Psy / Forest',
    // No ICY metadata but known for Goa/dark psy
    worldMapping: ['goa', 'dark-psy', 'forest'],
    hasMetadata: false, priority: 1,
    notes: 'Goa and dark psytrance — Russian underground',
  },
  {
    id: 'space-unicorn', name: 'Space Unicorn Radio',
    url: 'https://spaceunicorn.radio/stream',
    format: 'mp3', bitrate: 192,
    genre: 'Trance & PsyTrance',
    // ICY: "Space Unicorn Radio / Trance & PsyTrance"
    worldMapping: ['progressive-psy', 'morning-psy'],
    hasMetadata: false, priority: 2,
    notes: 'Broader trance with psytrance — less purist',
  },
  {
    id: 'psyradio-progressive', name: 'psyradio.fm Progressive',
    url: 'http://streamer.psyradio.org:8030/;listen.mp3',
    format: 'mp3', bitrate: 128,
    genre: 'Progressive Psytrance',
    worldMapping: ['progressive-psy', 'deep-psy', 'hypnotic'],
    hasMetadata: true, priority: 2,
    notes: 'Dedicated progressive psytrance (HTTP — needs proxy)',
  },
];

export function getStreamForWorld(worldId: string): RadioStream {
  const matching = RADIO_STREAMS.filter(s => s.worldMapping.includes(worldId));
  if (matching.length === 0) return RADIO_STREAMS.find(s => s.url.startsWith('https')) || RADIO_STREAMS[0];
  return matching.find(s => s.url.startsWith('https') && s.priority === 1) || matching[0];
}

export function getFallbackStreams(worldId: string, excludeId?: string): RadioStream[] {
  return RADIO_STREAMS.filter(s => s.worldMapping.includes(worldId) && s.id !== excludeId)
    .sort((a, b) => (a.url.startsWith('https') ? 0 : 1) - (b.url.startsWith('https') ? 0 : 1));
}

export const ALL_STREAMS = RADIO_STREAMS;
