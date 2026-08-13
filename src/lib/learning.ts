/**
 * PSY LEARNING — real musical intelligence from radio listening.
 *
 * WHAT WE COLLECT (per detection tick):
 *   - kick timestamps → BPM + stability
 *   - bass freq votes → pitch class distribution
 *   - spectral bands → radio sound profile
 *   - preset×variant×stream combos → effectiveness score
 *
 * WHAT WE DERIVE:
 *   1. Scale detection: from pitch class histogram → match against
 *      known psytrance scales (Phrygian, Minor, Harmonic Minor, etc.)
 *   2. Tempo stability: stddev of recent BPM readings → confidence
 *   3. Radio sound profile: low/mid/high averages → EQ fingerprint
 *   4. Pattern effectiveness: which preset sounds best with this radio?
 *
 * STORAGE:
 *   - localStorage: instant access, last 1000 events
 *   - Turso (via /api/learn): cross-device sync, aggregated stats
 */

// ─── Scales (pitch class sets, 0=C ... 11=B) ──────────────────────────────
export interface ScaleInfo {
  name: string;
  root: number;        // 0-11
  intervals: number[]; // semitone offsets from root
  matchScore: number;  // 0-1, how well histogram fits
}

const SCALE_LIBRARY: { name: string; intervals: number[] }[] = [
  { name: 'Phrygian',        intervals: [0, 1, 3, 5, 7, 8, 10] }, // dark psy favorite
  { name: 'Minor',           intervals: [0, 2, 3, 5, 7, 8, 10] }, // natural minor
  { name: 'Harmonic Minor',  intervals: [0, 2, 3, 5, 7, 8, 11] }, // psytrance lead
  { name: 'Phrygian Dominant', intervals: [0, 1, 4, 5, 7, 8, 10] }, // spanish/middle-east
  { name: 'Dorian',          intervals: [0, 2, 3, 5, 7, 9, 10] }, // modal
  { name: 'Aeolian',         intervals: [0, 2, 3, 5, 7, 8, 10] }, // = minor
  { name: 'Minor Pentatonic', intervals: [0, 3, 5, 7, 10] },     // lead licks
  { name: 'Hungarian Minor', intervals: [0, 2, 3, 6, 7, 8, 11] },// exotic psy
  { name: 'Double Harmonic', intervals: [0, 1, 4, 5, 7, 8, 11] },// eastern
];

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

// ─── Learning data structures ─────────────────────────────────────────────
export interface RadioProfile {
  lowAvg: number;
  midAvg: number;
  highAvg: number;
  samples: number;
}

export interface TempoStats {
  current: number;          // latest BPM
  stable: number;           // smoothed stable BPM
  stddev: number;           // stability (lower = more stable)
  confidence: number;       // 0-1
  history: number[];        // last 50 readings
}

export interface PatternScore {
  presetId: string;
  variant: 'A' | 'B';
  streamId: string;
  score: number;            // 0-100, how well it fit
  samples: number;
}

export interface LearningData {
  // Raw collection
  bpmVotes: Record<number, number>;
  keyVotes: Record<string, number>;
  pitchClassHistogram: number[]; // 12 bins, normalized 0-1
  tempoHistory: number[];        // last 100 BPM readings
  radioProfile: RadioProfile;
  patternScores: PatternScore[];
  energyHistory: { time: number; radio: number; engine: number }[]; // last 200 samples

  // Derived (computed on save)
  detectedScale?: ScaleInfo;
  tempoStats?: TempoStats;

  // Meta
  sessions: number;
  totalKicks: number;
  lastUpdated: number;
  version: number;
}

const EMPTY: LearningData = {
  bpmVotes: {},
  keyVotes: {},
  pitchClassHistogram: new Array(12).fill(0),
  tempoHistory: [],
  radioProfile: { lowAvg: 0, midAvg: 0, highAvg: 0, samples: 0 },
  patternScores: [],
  energyHistory: [],
  sessions: 0,
  totalKicks: 0,
  lastUpdated: 0,
  version: 3,
};

const STORAGE_KEY = 'psy-live-learn-v2';

// ─── Persistence ──────────────────────────────────────────────────────────
export function loadLearning(): LearningData {
  if (typeof window === 'undefined') return { ...EMPTY };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Migrate old data
      const old = localStorage.getItem('psy-live-learn');
      if (old) {
        const parsed = JSON.parse(old);
        const migrated = migrateV1(parsed);
        saveLearning(migrated);
        return migrated;
      }
      return { ...EMPTY };
    }
    const parsed = JSON.parse(raw);
    const data = { ...EMPTY, ...parsed };
    // Clean BPM votes: remove outliers (non-integer or outside 110-170 psytrance range)
    if (data.bpmVotes) {
      const cleaned: Record<number, number> = {};
      for (const [bpmStr, count] of Object.entries(data.bpmVotes)) {
        const bpm = parseFloat(bpmStr);
        if (Number.isInteger(bpm) && bpm >= 110 && bpm <= 170 && (count as number) > 0) {
          cleaned[bpm] = count as number;
        }
      }
      data.bpmVotes = cleaned;
    }
    // Clean tempo history similarly
    if (data.tempoHistory) {
      data.tempoHistory = data.tempoHistory.filter(b => Number.isInteger(b) && b >= 110 && b <= 170);
    }
    return data;
  } catch {
    return { ...EMPTY };
  }
}

export function saveLearning(data: LearningData): void {
  if (typeof window === 'undefined') return;
  try {
    data.lastUpdated = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function migrateV1(old: any): LearningData {
  const hist = new Array(12).fill(0);
  if (old.keyVotes) {
    for (const [note, count] of Object.entries(old.keyVotes)) {
      const pc = noteToPitchClass(note);
      if (pc >= 0) hist[pc] += count as number;
    }
  }
  return {
    ...EMPTY,
    bpmVotes: old.bpmVotes || {},
    keyVotes: old.keyVotes || {},
    pitchClassHistogram: normalize(hist),
    tempoHistory: [],
    totalKicks: Object.values(old.bpmVotes || {}).reduce((a: number, b: any) => a + (b as number), 0),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────
export function noteToPitchClass(note: string): number {
  const base = note.replace(/[0-9]/g, '').replace('#', '#');
  const idx = NOTE_NAMES.indexOf(base);
  return idx;
}

export function pitchClassToName(pc: number): string {
  return NOTE_NAMES[((pc % 12) + 12) % 12];
}

function normalize(arr: number[]): number[] {
  const max = Math.max(...arr, 1);
  return arr.map(v => v / max);
}

// ─── Scale detection (the core intelligence) ──────────────────────────────
export function detectScale(histogram: number[]): ScaleInfo | null {
  if (histogram.length !== 12) return null;
  const total = histogram.reduce((a, b) => a + b, 0);
  if (total < 5) return null; // need enough data

  const normalized = normalize(histogram);
  let best: ScaleInfo | null = null;

  for (let root = 0; root < 12; root++) {
    for (const scale of SCALE_LIBRARY) {
      // Score = sum of histogram values at scale degrees
      // minus penalty for non-scale degrees that have weight
      let inScale = 0;
      let outScale = 0;
      for (let pc = 0; pc < 12; pc++) {
        const offset = ((pc - root) % 12 + 12) % 12;
        if (scale.intervals.includes(offset)) {
          inScale += normalized[pc];
        } else {
          outScale += normalized[pc];
        }
      }
      const score = inScale / (inScale + outScale + 0.001);
      if (!best || score > best.matchScore) {
        best = {
          name: scale.name,
          root,
          intervals: scale.intervals,
          matchScore: score,
        };
      }
    }
  }
  return best;
}

// ─── Tempo stats ──────────────────────────────────────────────────────────
export function computeTempoStats(history: number[]): TempoStats {
  if (history.length === 0) {
    return { current: 0, stable: 0, stddev: 0, confidence: 0, history: [] };
  }
  const recent = history.slice(-50);
  const current = recent[recent.length - 1];
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const variance = recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length;
  const stddev = Math.sqrt(variance);
  // Confidence: high if stddev < 2, low if > 8
  const confidence = Math.max(0, Math.min(1, 1 - stddev / 8));
  return {
    current,
    stable: Math.round(mean),
    stddev: Math.round(stddev * 10) / 10,
    confidence,
    history: recent,
  };
}

// ─── Recording events (called by engine) ──────────────────────────────────
export function recordKick(data: LearningData, bpm: number | null): LearningData {
  const next = { ...data };
  next.totalKicks = (next.totalKicks || 0) + 1;
  if (bpm && bpm > 0) {
    next.bpmVotes[bpm] = (next.bpmVotes[bpm] || 0) + 1;
    next.tempoHistory = [...(next.tempoHistory || []), bpm].slice(-100);
  }
  return next;
}

export function recordBassNote(data: LearningData, freq: number): LearningData {
  const next = { ...data };
  if (freq <= 0) return next;
  const midi = Math.round(12 * Math.log2(freq / 440) + 69);
  const pc = ((midi % 12) + 12) % 12;
  const note = NOTE_NAMES[pc];

  next.keyVotes = { ...next.keyVotes };
  next.keyVotes[note] = (next.keyVotes[note] || 0) + 1;

  next.pitchClassHistogram = [...(next.pitchClassHistogram || new Array(12).fill(0))];
  next.pitchClassHistogram[pc] = (next.pitchClassHistogram[pc] || 0) + 1;

  return next;
}

export function recordRadioBands(data: LearningData, low: number, mid: number, high: number): LearningData {
  const next = { ...data };
  const p = next.radioProfile;
  const n = p.samples;
  // Running average
  next.radioProfile = {
    lowAvg: (p.lowAvg * n + low) / (n + 1),
    midAvg: (p.midAvg * n + mid) / (n + 1),
    highAvg: (p.highAvg * n + high) / (n + 1),
    samples: n + 1,
  };
  return next;
}

// Record energy curve (radio vs engine) for later analysis
export function recordEnergy(data: LearningData, radio: number, engine: number): LearningData {
  const next = { ...data };
  next.energyHistory = [...(next.energyHistory || []), { time: Date.now(), radio, engine }].slice(-200);
  return next;
}

export function recordPatternScore(
  data: LearningData,
  presetId: string,
  variant: 'A' | 'B',
  streamId: string,
  scoreDelta: number,
): LearningData {
  const next = { ...data };
  next.patternScores = [...(next.patternScores || [])];
  const idx = next.patternScores.findIndex(
    p => p.presetId === presetId && p.variant === variant && p.streamId === streamId
  );
  if (idx >= 0) {
    const existing = next.patternScores[idx];
    // EMA update: score moves toward scoreDelta
    next.patternScores[idx] = {
      ...existing,
      score: Math.max(0, Math.min(100, existing.score * 0.9 + scoreDelta * 0.1)),
      samples: existing.samples + 1,
    };
  } else {
    next.patternScores.push({
      presetId, variant, streamId,
      score: 50 + scoreDelta * 0.1,
      samples: 1,
    });
  }
  // Keep only top 50
  next.patternScores.sort((a, b) => b.samples - a.samples);
  next.patternScores = next.patternScores.slice(0, 50);
  return next;
}

// ─── Derive insights (call before save) ───────────────────────────────────
export function deriveInsights(data: LearningData): LearningData {
  const next = { ...data };
  next.detectedScale = detectScale(next.pitchClassHistogram) || undefined;
  next.tempoStats = computeTempoStats(next.tempoHistory);
  return next;
}

// ─── Export for UI ────────────────────────────────────────────────────────
export function getInsights(data: LearningData) {
  const derived = deriveInsights(data);
  const topBpm = Object.entries(derived.bpmVotes).sort((a, b) => b[1] - a[1])[0];
  const topKey = Object.entries(derived.keyVotes).sort((a, b) => b[1] - a[1])[0];
  const bestPattern = [...(derived.patternScores || [])].sort((a, b) => b.score - a.score)[0];

  return {
    scale: derived.detectedScale,
    tempo: derived.tempoStats,
    radioProfile: derived.radioProfile,
    topBpm: topBpm ? parseInt(topBpm[0]) : 0,
    topKey: topKey ? topKey[0] : '—',
    topBpmCount: topBpm ? topBpm[1] : 0,
    topKeyCount: topKey ? topKey[1] : 0,
    totalKicks: derived.totalKicks,
    bestPattern,
    sessions: derived.sessions,
    lastUpdated: derived.lastUpdated,
  };
}

// ─── Original composition generator (uses learned data) ───────────────────
export interface Composition {
  scaleName: string;
  rootPc: number;
  rootMidi: number;
  bpm: number;
  pattern: {
    kick: number[];
    bass: (number | null)[];
    lead: (number | null)[];
    hat: number[];
  };
  reasoning: string[];
}

// ─── Chord progressions per scale type (for real harmony) ──────────────────
const CHORD_PROGRESSIONS: Record<string, number[][]> = {
  // Each progression = array of chords, each chord = [root_degree, third_offset, fifth_offset]
  // In scale degrees (0=root, 1=2nd, 2=3rd, etc.)
  'Minor': [
    [[0, 2, 4], [5, 7, 9], [3, 5, 7], [4, 6, 8]],  // i - iv - VII - III (classic minor)
    [[0, 2, 4], [3, 5, 7], [4, 6, 8], [5, 7, 9]],   // i - iv - v - VI
    [[0, 2, 4], [5, 7, 9], [0, 2, 4], [3, 5, 7]],   // i - VI - i - iv (psytrance)
  ],
  'Phrygian': [
    [[0, 2, 4], [1, 3, 5], [0, 2, 4], [1, 3, 5]],   // i - bII - i - bII (dark psy)
    [[0, 2, 4], [5, 7, 9], [1, 3, 5], [0, 2, 4]],   // i - VI - bII - i
  ],
  'Harmonic Minor': [
    [[0, 2, 4], [4, 6, 8], [5, 7, 9], [3, 5, 7]],   // i - V - VI - iv
  ],
  'default': [
    [[0, 2, 4], [5, 7, 9], [3, 5, 7], [4, 6, 8]],   // i - iv - VII - III
  ],
};

// ─── Rhythm variations (intelligent, not fixed loop) ───────────────────────
const RHYTHM_VARIATIONS = {
  kickPatterns: [
    [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],  // 4-on-floor
    [1,0,0,1, 1,0,0,0, 1,0,0,1, 1,0,0,0],  // gallop
    [1,0,0,0, 1,0,1,0, 1,0,0,0, 1,0,0,0],  // variation
    [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,1,0],  // fill at end
  ],
  bassPatterns: [
    // Each pattern: null=gap, number=scale degree offset
    [null,0,0,0, null,0,0,0, null,0,0,0, null,0,0,3],  // rolling root
    [null,0,null,0, null,0,null,0, null,0,null,0, null,0,5,7],  // offbeat
    [null,0,0,0, null,3,0,0, null,0,0,0, null,5,0,0],  // walking
    [null,0,0,3, null,0,0,5, null,0,0,3, null,0,0,0],  // melodic
  ],
  hatPatterns: [
    [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],  // offbeat
    [0,0,1,0, 0,0,1,1, 0,0,1,0, 0,1,1,0],  // with variation
    [0,1,1,0, 0,0,1,0, 0,1,1,0, 0,0,1,1],  // busier
    [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1],  // 16th rolls
  ],
};

/**
 * Generate an ORIGINAL composition with REAL harmony + intelligent rhythm.
 * Chord progressions derived from detected scale.
 * Rhythm varies every 4 bars (not fixed loop).
 */
export function generateComposition(data: LearningData): Composition | null {
  const insights = getInsights(data);
  if (!insights.scale || !insights.tempo || insights.tempo.stable === 0) return null;

  const scale = insights.scale;
  const tempo = insights.tempo;
  const rootMidi = 33 + scale.root;

  const reasoning: string[] = [];
  reasoning.push(`Detected ${scale.name} in ${pitchClassToName(scale.root)} (${Math.round(scale.matchScore * 100)}% match)`);
  reasoning.push(`Stable tempo ${tempo.stable} BPM (σ=${tempo.stddev}, confidence ${Math.round(tempo.confidence * 100)}%)`);

  // Pick chord progression based on scale type
  const progs = CHORD_PROGRESSIONS[scale.name] || CHORD_PROGRESSIONS.default;
  const progression = progs[Math.floor(Math.random() * progs.length)];
  reasoning.push(`Harmony: ${progression.length}-chord progression in ${scale.name}`);

  // Pick rhythm variation (different each generation)
  const kickIdx = Math.floor(Math.random() * RHYTHM_VARIATIONS.kickPatterns.length);
  const bassIdx = Math.floor(Math.random() * RHYTHM_VARIATIONS.bassPatterns.length);
  const hatIdx = Math.floor(Math.random() * RHYTHM_VARIATIONS.hatPatterns.length);
  const kick = [...RHYTHM_VARIATIONS.kickPatterns[kickIdx]];
  const bassBase = [...RHYTHM_VARIATIONS.bassPatterns[bassIdx]];
  const hat = [...RHYTHM_VARIATIONS.hatPatterns[hatIdx]];

  // Apply chord progression to bass (transpose bass by chord root each 4 steps)
  const bass: (number | null)[] = bassBase.map((v, i) => {
    if (v === null) return null;
    const chordIdx = Math.floor(i / 4) % progression.length;
    const chordRoot = progression[chordIdx][0];
    const scaleDeg = scale.intervals[chordRoot] || scale.intervals[0];
    return scaleDeg - 12 + (v as number); // octave down + variation
  });

  // Generate lead from chord tones (melodic, follows harmony)
  const lead: (number | null)[] = new Array(16).fill(null);
  const leadPositions = [0, 3, 6, 10, 14];
  for (const pos of leadPositions) {
    const chordIdx = Math.floor(pos / 4) % progression.length;
    const chord = progression[chordIdx];
    const toneIdx = Math.floor(Math.random() * chord.length);
    const scaleDeg = scale.intervals[chord[toneIdx]] || scale.intervals[0];
    lead[pos] = scaleDeg + 12;
  }

  return {
    scaleName: scale.name,
    rootPc: scale.root,
    rootMidi,
    bpm: tempo.stable,
    pattern: { kick, bass, lead, hat },
    reasoning,
  };
}

// ─── Get next rhythm variation (for evolving patterns) ─────────────────────
export function getNextRhythmVariation(currentIdx: number): number {
  return (currentIdx + 1) % RHYTHM_VARIATIONS.kickPatterns.length;
}

export function getRhythmPattern(type: 'kick' | 'bass' | 'hat', idx: number): number[] {
  const patterns = RHYTHM_VARIATIONS[`${type}Patterns` as keyof typeof RHYTHM_VARIATIONS];
  return [...patterns[idx % patterns.length]];
}
