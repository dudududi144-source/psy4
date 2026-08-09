/**
 * World DNA — per-world reference targets.
 *
 * PRIORITY 8: "Build different profiles for each World"
 *
 * Each world has a DNA that defines its TARGET characteristics.
 * The optimizer tries to make our engine match these targets.
 *
 * The targets are derived from:
 *   - The genre's typical BPM range
 *   - Typical kick/bass character
 *   - Typical spectral balance
 *   - Typical transient density
 *
 * These are STARTING POINTS — the live reference stream updates them.
 */

export interface WorldDNA {
  worldId: string;
  name: string;
  description: string;

  // Tempo
  bpmRange: [number, number];
  bpmTarget: number;

  // Kick character
  kickFundamentalTarget: number;  // Hz
  kickDecayTarget: number;        // seconds
  kickDecayRange: [number, number];

  // Bass character
  bassDecayTarget: number;        // seconds
  bassDecayRange: [number, number];
  bassCutoffTarget: number;       // Hz
  bassResonanceTarget: number;

  // Lead character
  leadCutoffTarget: number;
  leadDetuneTarget: number;

  // Spectral targets (normalized 0..1, sum ~1)
  spectralTarget: {
    sub: number;    // 20-60 Hz
    low: number;    // 60-250 Hz
    mid: number;    // 250-2000 Hz
    high: number;   // 2000-8000 Hz
    air: number;    // 8000-20000 Hz
  };

  // Transient targets
  transientDensityTarget: number;   // per second
  kickDensityTarget: number;
  hatDensityTarget: number;

  // Stereo
  stereoWidthTarget: number;        // 0..1

  // Energy
  energyTarget: number;             // 0..1

  // Percussion/lead density
  percussionDensity: number;        // 0..1
  leadDensity: number;              // 0..1

  // Reference stream mapping (which radio stream fits this world)
  referenceStreamIds: string[];

  // Energy curve (how energy evolves across the arrangement)
  energyCurve: number[];
}

export const WORLD_DNA: Record<string, WorldDNA> = {
  'progressive-psy': {
    worldId: 'progressive-psy',
    name: 'Progressive Psy',
    description: 'Slow-building, melodic, hypnotic. 124-134 BPM. Dorian/minor.',
    bpmRange: [124, 134],
    bpmTarget: 128,
    kickFundamentalTarget: 50,
    kickDecayTarget: 0.22,
    kickDecayRange: [0.18, 0.28],
    bassDecayTarget: 0.12,
    bassDecayRange: [0.08, 0.16],
    bassCutoffTarget: 400,
    bassResonanceTarget: 3,
    leadCutoffTarget: 3000,
    leadDetuneTarget: 10,
    spectralTarget: { sub: 0.25, low: 0.28, mid: 0.22, high: 0.18, air: 0.07 },
    transientDensityTarget: 5.5,
    kickDensityTarget: 2.0,
    hatDensityTarget: 2.5,
    stereoWidthTarget: 0.45,
    energyTarget: 0.65,
    percussionDensity: 0.3,
    leadDensity: 0.5,
    referenceStreamIds: ['psyradio-progressive', 'psyndora-psytrance', 'hirschmilch-psytrance'],
    energyCurve: [0.3, 0.45, 0.6, 0.75, 0.9, 0.75, 0.6, 0.4],
  },
  'dark-psy': {
    worldId: 'dark-psy',
    name: 'Dark Psy',
    description: 'Fast, intense, foreboding. 145-156 BPM. Phrygian.',
    bpmRange: [145, 156],
    bpmTarget: 150,
    kickFundamentalTarget: 48,
    kickDecayTarget: 0.16,
    kickDecayRange: [0.12, 0.22],
    bassDecayTarget: 0.10,
    bassDecayRange: [0.06, 0.14],
    bassCutoffTarget: 300,
    bassResonanceTarget: 8,
    leadCutoffTarget: 2000,
    leadDetuneTarget: 15,
    spectralTarget: { sub: 0.30, low: 0.30, mid: 0.18, high: 0.15, air: 0.07 },
    transientDensityTarget: 7.5,
    kickDensityTarget: 2.5,
    hatDensityTarget: 4.0,
    stereoWidthTarget: 0.35,
    energyTarget: 0.85,
    percussionDensity: 0.5,
    leadDensity: 0.6,
    referenceStreamIds: ['psy-from-the-sky', 'hirschmilch-psytrance', 'psyndora-psytrance'],
    energyCurve: [0.5, 0.7, 0.85, 0.95, 0.85, 0.95, 0.7, 0.5],
  },
  'goa': {
    worldId: 'goa',
    name: 'Goa',
    description: 'Acidic, melodic, mystical. 134-146 BPM. Phrygian dominant.',
    bpmRange: [134, 146],
    bpmTarget: 140,
    kickFundamentalTarget: 52,
    kickDecayTarget: 0.20,
    kickDecayRange: [0.16, 0.26],
    bassDecayTarget: 0.11,
    bassDecayRange: [0.07, 0.15],
    bassCutoffTarget: 500,
    bassResonanceTarget: 10,
    leadCutoffTarget: 4000,
    leadDetuneTarget: 20,
    spectralTarget: { sub: 0.22, low: 0.25, mid: 0.23, high: 0.22, air: 0.08 },
    transientDensityTarget: 6.5,
    kickDensityTarget: 2.0,
    hatDensityTarget: 3.5,
    stereoWidthTarget: 0.50,
    energyTarget: 0.75,
    percussionDensity: 0.4,
    leadDensity: 0.7,
    referenceStreamIds: ['babaganousha', 'psyndora-psytrance', 'hirschmilch-psytrance'],
    energyCurve: [0.35, 0.5, 0.7, 0.85, 0.95, 0.85, 0.7, 0.5],
  },
  'morning-psy': {
    worldId: 'morning-psy',
    name: 'Morning Psy',
    description: 'Uplifting, bright, euphoric. 138-146 BPM. Dorian.',
    bpmRange: [138, 146],
    bpmTarget: 142,
    kickFundamentalTarget: 54,
    kickDecayTarget: 0.20,
    kickDecayRange: [0.16, 0.26],
    bassDecayTarget: 0.11,
    bassDecayRange: [0.08, 0.15],
    bassCutoffTarget: 550,
    bassResonanceTarget: 4,
    leadCutoffTarget: 3500,
    leadDetuneTarget: 12,
    spectralTarget: { sub: 0.20, low: 0.24, mid: 0.24, high: 0.24, air: 0.08 },
    transientDensityTarget: 6.0,
    kickDensityTarget: 2.0,
    hatDensityTarget: 3.0,
    stereoWidthTarget: 0.55,
    energyTarget: 0.75,
    percussionDensity: 0.35,
    leadDensity: 0.6,
    referenceStreamIds: ['psyndora-psytrance', 'babaganousha', 'hirschmilch-psytrance'],
    energyCurve: [0.4, 0.55, 0.7, 0.85, 0.95, 0.8, 0.65, 0.45],
  },
  'forest': {
    worldId: 'forest',
    name: 'Forest',
    description: 'Organic, deep, mysterious. 144-156 BPM. Minor.',
    bpmRange: [144, 156],
    bpmTarget: 148,
    kickFundamentalTarget: 46,
    kickDecayTarget: 0.18,
    kickDecayRange: [0.14, 0.24],
    bassDecayTarget: 0.10,
    bassDecayRange: [0.06, 0.14],
    bassCutoffTarget: 350,
    bassResonanceTarget: 6,
    leadCutoffTarget: 2200,
    leadDetuneTarget: 14,
    spectralTarget: { sub: 0.28, low: 0.28, mid: 0.20, high: 0.17, air: 0.07 },
    transientDensityTarget: 7.0,
    kickDensityTarget: 2.5,
    hatDensityTarget: 3.5,
    stereoWidthTarget: 0.40,
    energyTarget: 0.80,
    percussionDensity: 0.5,
    leadDensity: 0.5,
    referenceStreamIds: ['psy-from-the-sky', 'hirschmilch-psytrance'],
    energyCurve: [0.4, 0.6, 0.75, 0.9, 0.85, 0.9, 0.65, 0.45],
  },
  'acid-psy': {
    worldId: 'acid-psy',
    name: 'Acid Psy',
    description: '303-style acid lines, squelchy, driving. 136-148 BPM. Minor.',
    bpmRange: [136, 148],
    bpmTarget: 142,
    kickFundamentalTarget: 50,
    kickDecayTarget: 0.19,
    kickDecayRange: [0.15, 0.25],
    bassDecayTarget: 0.11,
    bassDecayRange: [0.07, 0.15],
    bassCutoffTarget: 600,
    bassResonanceTarget: 14,
    leadCutoffTarget: 2500,
    leadDetuneTarget: 18,
    spectralTarget: { sub: 0.22, low: 0.26, mid: 0.25, high: 0.20, air: 0.07 },
    transientDensityTarget: 6.5,
    kickDensityTarget: 2.0,
    hatDensityTarget: 3.5,
    stereoWidthTarget: 0.45,
    energyTarget: 0.80,
    percussionDensity: 0.35,
    leadDensity: 0.7,
    referenceStreamIds: ['psyndora-psytrance', 'babaganousha'],
    energyCurve: [0.45, 0.6, 0.75, 0.9, 0.95, 0.85, 0.7, 0.5],
  },
};

export function getWorldDNA(worldId: string): WorldDNA | null {
  return WORLD_DNA[worldId] || null;
}

export const ALL_WORLD_DNAS = Object.values(WORLD_DNA);
