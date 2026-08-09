/**
 * Musical Understanding — detects key, scale, BPM, and notes from audio.
 *
 * This is what makes the system "understand" music, not just measure it.
 *
 * Detection pipeline:
 *   1. Chromagram — 12-bin pitch class distribution (C, C#, D, ..., B)
 *   2. Key detection — match chromagram against major/minor/phrygian/dorian profiles
 *   3. BPM detection — already in referenceListener, now feeds back to engine
 *   4. Bass note detection — find the dominant low-frequency pitch
 *   5. Style classification — based on BPM + spectral features
 *
 * The engine uses this to match the radio: same key, same scale, same BPM.
 */

// ─── Scale profiles (Krumhansl-Schmuckler key-finding algorithm) ────────────

// Each profile is a 12-element array representing how strongly each pitch
// class appears in that scale, starting from C.
// Values from Krumhansl & Kessler (1982) — the standard in music information retrieval.

const SCALE_PROFILES: Record<string, number[]> = {
  // Major scale profiles (rotated for each root)
  major:      [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  // Natural minor
  minor:      [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
  // Dorian (common in psytrance)
  dorian:     [6.33, 2.68, 3.52, 5.38, 2.60, 3.63, 2.54, 4.75, 3.98, 2.69, 3.54, 3.17],
  // Phrygian (dark psy, goa)
  phrygian:   [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
  // Phrygian dominant (Goa)
  phrygianDom:[6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
  // Harmonic minor
  harmonicMin:[6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};

// Scale interval patterns (semitone offsets from root)
const SCALE_INTERVALS: Record<string, number[]> = {
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
  phrygianDom:[0, 1, 4, 5, 7, 8, 10],
  harmonicMin:[0, 2, 3, 5, 7, 8, 11],
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export interface KeyDetection {
  root: number;           // 0-11 (C=0, C#=1, ..., B=11)
  rootName: string;       // 'C', 'C#', etc.
  scale: string;          // 'minor', 'dorian', 'phrygian', etc.
  confidence: number;     // 0..1
  chromagram: number[];   // 12-element pitch class distribution
}

export interface BassNoteDetection {
  note: number;           // MIDI note number
  freq: number;           // Hz
  confidence: number;     // 0..1
}

export interface MusicalUnderstanding {
  key: KeyDetection;
  bpm: number;
  bpmConfidence: number;
  bassNote: BassNoteDetection | null;
  style: string;          // 'progressive-psy', 'dark-psy', 'goa', etc.
  styleConfidence: number;
  energy: number;         // 0..1
  timestamp: number;
}

/**
 * Compute chromagram from a power spectrum.
 * Maps FFT bins to 12 pitch classes using log-frequency mapping.
 */
export function computeChromagram(
  powerSpectrum: Float32Array | number[],
  sampleRate: number,
  fftSize: number,
): number[] {
  const chroma = new Array(12).fill(0);
  const binHz = sampleRate / fftSize;

  // Map each FFT bin to a pitch class
  // Only consider bins from ~55Hz (A1) to ~2000Hz (B6)
  const minFreq = 55;
  const maxFreq = 2000;
  const minBin = Math.max(1, Math.floor(minFreq / binHz));
  const maxBin = Math.min(powerSpectrum.length - 1, Math.ceil(maxFreq / binHz));

  let totalEnergy = 0;

  for (let i = minBin; i <= maxBin; i++) {
    const freq = i * binHz;
    if (freq < minFreq) continue;

    // Convert frequency to MIDI note number
    const midi = 69 + 12 * Math.log2(freq / 440);
    // Pitch class (0-11)
    const pitchClass = ((Math.round(midi) % 12) + 12) % 12;

    const energy = powerSpectrum[i];
    chroma[pitchClass] += energy;
    totalEnergy += energy;
  }

  // Normalize
  if (totalEnergy > 0) {
    for (let i = 0; i < 12; i++) {
      chroma[i] /= totalEnergy;
    }
  }

  return chroma;
}

/**
 * Detect musical key from chromagram.
 * Uses correlation with scale profiles (Krumhansl-Schmuckler method).
 */
export function detectKey(chromagram: number[]): KeyDetection {
  let bestRoot = 0;
  let bestScale = 'minor';
  let bestCorrelation = -Infinity;

  // Try each of the 12 possible roots
  for (let root = 0; root < 12; root++) {
    // Rotate chromagram so that 'root' is at position 0
    const rotated = new Array(12);
    for (let i = 0; i < 12; i++) {
      rotated[i] = chromagram[(i + root) % 12];
    }

    // Correlate with each scale profile
    for (const [scaleName, profile] of Object.entries(SCALE_PROFILES)) {
      let correlation = 0;
      let chromaSum = 0;
      let profileSum = 0;
      let chromaSqSum = 0;
      let profileSqSum = 0;

      for (let i = 0; i < 12; i++) {
        correlation += rotated[i] * profile[i];
        chromaSum += rotated[i];
        profileSum += profile[i];
        chromaSqSum += rotated[i] * rotated[i];
        profileSqSum += profile[i] * profile[i];
      }

      // Pearson correlation
      const n = 12;
      const numerator = n * correlation - chromaSum * profileSum;
      const denominator = Math.sqrt(
        (n * chromaSqSum - chromaSum * chromaSum) *
        (n * profileSqSum - profileSum * profileSum)
      );

      const r = denominator > 0 ? numerator / denominator : 0;

      if (r > bestCorrelation) {
        bestCorrelation = r;
        bestRoot = root;
        bestScale = scaleName;
      }
    }
  }

  // Confidence: normalize correlation to 0..1
  const confidence = Math.max(0, Math.min(1, (bestCorrelation + 1) / 2));

  return {
    root: bestRoot,
    rootName: NOTE_NAMES[bestRoot],
    scale: bestScale,
    confidence,
    chromagram,
  };
}

/**
 * Detect the dominant bass note from a power spectrum.
 * Looks for the strongest peak in the 40-250 Hz range.
 */
export function detectBassNote(
  powerSpectrum: Float32Array | number[],
  sampleRate: number,
  fftSize: number,
): BassNoteDetection | null {
  const binHz = sampleRate / fftSize;
  const minBin = Math.max(1, Math.floor(40 / binHz));
  const maxBin = Math.min(powerSpectrum.length - 1, Math.ceil(250 / binHz));

  let maxEnergy = 0;
  let maxBinIdx = -1;

  for (let i = minBin; i <= maxBin; i++) {
    if (powerSpectrum[i] > maxEnergy) {
      maxEnergy = powerSpectrum[i];
      maxBinIdx = i;
    }
  }

  if (maxBinIdx < 0 || maxEnergy < 1e-10) return null;

  const freq = maxBinIdx * binHz;
  const midi = 69 + 12 * Math.log2(freq / 440);

  // Confidence based on how dominant the peak is
  let totalEnergy = 0;
  for (let i = minBin; i <= maxBin; i++) {
    totalEnergy += powerSpectrum[i];
  }
  const confidence = totalEnergy > 0 ? maxEnergy / totalEnergy : 0;

  return {
    note: Math.round(midi),
    freq,
    confidence: Math.min(1, confidence * 3), // scale up
  };
}

/**
 * Classify musical style based on BPM + spectral features.
 */
export function classifyStyle(
  bpm: number,
  spectralCentroid: number,
  subEnergy: number,
  highEnergy: number,
): { style: string; confidence: number } {
  const features = { bpm, centroid: spectralCentroid, sub: subEnergy, high: highEnergy };

  // Style templates (typical ranges)
  const styles: Record<string, { bpm: [number, number]; centroid: number; sub: number; high: number }> = {
    'progressive-psy': { bpm: [124, 134], centroid: 1500, sub: 0.7, high: 0.15 },
    'dark-psy':        { bpm: [145, 156], centroid: 800,  sub: 0.85, high: 0.08 },
    'goa':             { bpm: [134, 146], centroid: 1800, sub: 0.7, high: 0.18 },
    'morning-psy':     { bpm: [138, 146], centroid: 2000, sub: 0.6, high: 0.20 },
    'forest':          { bpm: [144, 156], centroid: 900,  sub: 0.8, high: 0.10 },
    'acid-psy':        { bpm: [136, 148], centroid: 1200, sub: 0.75, high: 0.12 },
    'full-on':         { bpm: [140, 148], centroid: 1600, sub: 0.75, high: 0.15 },
  };

  let bestStyle = 'dark-psy';
  let bestScore = -Infinity;

  for (const [name, template] of Object.entries(styles)) {
    // BPM match (weighted heavily)
    const bpmMatch = features.bpm >= template.bpm[0] && features.bpm <= template.bpm[1] ? 1 : 0;
    const bpmDist = Math.min(
      Math.abs(features.bpm - template.bpm[0]),
      Math.abs(features.bpm - template.bpm[1]),
    );
    const bpmScore = bpmMatch * 3 - bpmDist * 0.1;

    // Spectral match
    const centroidScore = -Math.abs(features.centroid - template.centroid) / 1000;
    const subScore = -Math.abs(features.sub - template.sub) * 2;
    const highScore = -Math.abs(features.high - template.high) * 2;

    const total = bpmScore + centroidScore + subScore + highScore;
    if (total > bestScore) {
      bestScore = total;
      bestStyle = name;
    }
  }

  // Confidence: how far ahead is the best style?
  const confidence = Math.max(0, Math.min(1, (bestScore + 5) / 10));

  return { style: bestStyle, confidence };
}

/**
 * Full musical understanding from audio analysis.
 * Combines key detection, BPM, bass note, and style classification.
 */
export function understandMusic(params: {
  powerSpectrum: Float32Array | number[];
  sampleRate: number;
  fftSize: number;
  bpm: number;
  bpmConfidence: number;
  spectralCentroid: number;
  subEnergy: number;
  highEnergy: number;
  energy: number;
}): MusicalUnderstanding {
  const chromagram = computeChromagram(params.powerSpectrum, params.sampleRate, params.fftSize);
  const key = detectKey(chromagram);
  const bassNote = detectBassNote(params.powerSpectrum, params.sampleRate, params.fftSize);
  const style = classifyStyle(params.bpm, params.spectralCentroid, params.subEnergy, params.highEnergy);

  return {
    key,
    bpm: params.bpm,
    bpmConfidence: params.bpmConfidence,
    bassNote,
    style: style.style,
    styleConfidence: style.confidence,
    energy: params.energy,
    timestamp: Date.now(),
  };
}

/**
 * Convert key detection to engine parameters.
 * Maps root (0-11) to a MIDI root note.
 */
export function keyToRootMidi(key: KeyDetection): number {
  // Map pitch class to a MIDI note in octave 2 (36-47)
  return 36 + key.root;
}

/**
 * Check if a MIDI note belongs to a given scale.
 */
export function noteInScale(midi: number, rootPc: number, scaleName: string): boolean {
  const intervals = SCALE_INTERVALS[scaleName] || SCALE_INTERVALS.minor;
  const pc = ((midi % 12) + 12) % 12;
  const relativePc = ((pc - rootPc) + 12) % 12;
  return intervals.includes(relativePc);
}

/**
 * Get the scale degree of a MIDI note in a given scale.
 * Returns -1 if the note is not in the scale.
 */
export function noteToScaleDegree(midi: number, rootPc: number, scaleName: string): number {
  const intervals = SCALE_INTERVALS[scaleName] || SCALE_INTERVALS.minor;
  const pc = ((midi % 12) + 12) % 12;
  const relativePc = ((pc - rootPc) + 12) % 12;
  const idx = intervals.indexOf(relativePc);
  if (idx < 0) return -1;
  const octave = Math.floor(midi / 12) - Math.floor((36 + rootPc) / 12);
  return idx + octave * intervals.length;
}
