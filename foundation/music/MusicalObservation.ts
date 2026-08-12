/**
 * MusicalObservation — F17.2: Musical feature extraction from radio.
 *
 * Extracts musical ABSTRACTIONS (not raw audio, not melodies) from radio
 * observations. These features feed into MusicalMemory for learning.
 *
 * Design principles:
 * 1. Extract FEATURES, not NOTES. Never store/copy radio melodies.
 * 2. Aggregate per-phrase (8 bars), not per-tick (200ms).
 * 3. Every feature has confidence (0-1).
 * 4. Features are musical abstractions usable for grammar learning.
 */

// ── Per-tick observation (collected, then aggregated per phrase) ──────────

export interface RadioTickFeatures {
  readonly timestamp: number;          // AudioContext.currentTime
  readonly bpm: number;                // radio-detected BPM (or transport BPM)
  readonly energy: number;             // 0-1 spectral energy
  readonly occupancy: { kick: number; bass: number; lead: number; hats: number };
  readonly bassFreq: number | null;    // detected bass frequency (Hz)
  readonly pitchClass: number | null;  // 0-11 (from pitch observation)
  readonly pitchConfidence: number;    // 0-1
  readonly spectralCentroid: number;   // Hz (brightness)
  readonly spectralFlatness: number;   // 0-1 (noisiness)
  readonly spectralRolloff: number;    // Hz (where energy concentrates)
  readonly lowEnergy: number;          // 0-1 (sub/bass band)
  readonly midEnergy: number;          // 0-1 (lead/vocal band)
  readonly highEnergy: number;         // 0-1 (hats/air band)
}

// ── Per-phrase aggregated features (the learned unit) ────────────────────

export interface PhraseMusicalFeatures {
  readonly phraseIndex: number;
  readonly bar: number;                // starting bar
  readonly bars: number;               // usually 8

  // TEMPO
  readonly avgBpm: number;
  readonly bpmStability: number;       // 0-1 (1 = perfectly stable)
  readonly tempoDrift: number;         // bpm change over phrase

  // HARMONY
  readonly pitchClassHistogram: number[];  // 12 values, normalized
  readonly dominantPitchClass: number;     // 0-11
  readonly keyConfidence: number;          // 0-1
  readonly bassFundamental: number | null; // Hz
  readonly bassIntervalMovement: number;   // 0-1 (how much bass pitch changed)

  // RHYTHM
  readonly avgKickDensity: number;     // kicks per bar
  readonly avgBassDensity: number;     // bass notes per bar
  readonly avgHatDensity: number;      // hats per bar
  readonly syncopation: number;        // 0-1 (offbeat energy ratio)
  readonly rhythmicEntropy: number;    // 0-1 (pattern diversity)
  readonly kickOnsetPattern: number[]; // 16 steps, 0-1 (avg onset strength)

  // MELODY (abstract — no notes stored)
  readonly melodicActivity: number;    // 0-1 (how much lead/mid energy)
  readonly melodicRegister: number;    // 0-1 (low=0, high=1)
  readonly melodicContour: number[];   // simplified contour (direction changes)
  readonly phraseLength: number;       // estimated phrase length in bars

  // TIMBRE
  readonly avgSpectralCentroid: number; // Hz (brightness)
  readonly avgSpectralFlatness: number; // 0-1 (noisiness)
  readonly avgSpectralRolloff: number;  // Hz
  readonly brightness: number;          // 0-1 (normalized centroid)
  readonly noisiness: number;           // 0-1
  readonly lowMidRatio: number;         // low/mid energy ratio
  readonly midHighRatio: number;        // mid/high energy ratio

  // PERFORMANCE
  readonly avgEnergy: number;           // 0-1
  readonly energySlope: number;         // -1 to 1 (rising/falling)
  readonly energyEnvelope: number[];    // per-bar energy (8 values)
  readonly dynamicRange: number;        // 0-1 (max-min energy)

  // CONFIDENCE
  readonly overallConfidence: number;  // 0-1
  readonly observationCount: number;   // how many ticks contributed
}

// ── Extractor: collects ticks, aggregates per phrase ─────────────────────

export class MusicalObservationExtractor {
  private ticks: RadioTickFeatures[] = [];
  private currentPhraseStartBar = 0;
  private currentPhraseIndex = 0;

  /** Called every detect tick (200ms) with extracted features */
  observe(tick: RadioTickFeatures): void {
    this.ticks.push(tick);
    if (this.ticks.length > 200) this.ticks.shift(); // bounded (~40s at 200ms)
  }

  /** Called at phrase boundaries to produce aggregated features */
  extractPhraseFeatures(phraseIndex: number, startBar: number, bars: number): PhraseMusicalFeatures | null {
    if (this.ticks.length < 4) return null;

    const ticks = this.ticks;
    const n = ticks.length;

    // TEMPO
    const bpms = ticks.map(t => t.bpm).filter(b => b > 60 && b < 200);
    const avgBpm = bpms.length > 0 ? bpms.reduce((a, b) => a + b, 0) / bpms.length : 145;
    const bpmVariance = bpms.length > 1 ? bpms.reduce((s, b) => s + (b - avgBpm) ** 2, 0) / bpms.length : 0;
    const bpmStability = Math.max(0, 1 - Math.sqrt(bpmVariance) / 20);
    const tempoDrift = bpms.length > 1 ? bpms[bpms.length - 1] - bpms[0] : 0;

    // HARMONY — pitch-class histogram
    const pcHist = new Array(12).fill(0);
    let totalPitchWeight = 0;
    for (const t of ticks) {
      if (t.pitchClass !== null && t.pitchConfidence > 0.3) {
        pcHist[t.pitchClass] += t.pitchConfidence;
        totalPitchWeight += t.pitchConfidence;
      }
    }
    if (totalPitchWeight > 0) {
      for (let i = 0; i < 12; i++) pcHist[i] /= totalPitchWeight;
    }
    const dominantPc = pcHist.indexOf(Math.max(...pcHist));
    const keyConfidence = totalPitchWeight > 0 ? Math.min(1, totalPitchWeight / 10) : 0;

    // Bass fundamental + movement
    const bassFreqs = ticks.map(t => t.bassFreq).filter((f): f is number => f !== null && f > 50);
    const bassFundamental = bassFreqs.length > 0 ? bassFreqs.reduce((a, b) => a + b, 0) / bassFreqs.length : null;
    const bassMidiValues = bassFreqs.map(f => Math.round(12 * Math.log2(f / 440) + 69));
    const uniqueBassMidis = new Set(bassMidiValues);
    const bassIntervalMovement = Math.min(1, uniqueBassMidis.size / 6);

    // RHYTHM
    const avgKickDensity = ticks.reduce((s, t) => s + t.occupancy.kick, 0) / n;
    const avgBassDensity = ticks.reduce((s, t) => s + t.occupancy.bass, 0) / n;
    const avgHatDensity = ticks.reduce((s, t) => s + t.occupancy.hats, 0) / n;
    const offbeatEnergy = ticks.reduce((s, t) => s + (t.occupancy.hats + t.occupancy.lead) * 0.5, 0) / n;
    const totalEnergy = ticks.reduce((s, t) => s + t.occupancy.kick + t.occupancy.bass + t.occupancy.lead + t.occupancy.hats, 0) / n;
    const syncopation = totalEnergy > 0 ? offbeatEnergy / totalEnergy : 0;

    // Rhythmic entropy (from kick occupancy variance)
    const kickOccs = ticks.map(t => t.occupancy.kick);
    const kickMean = kickOccs.reduce((a, b) => a + b, 0) / n;
    const kickVar = kickOccs.reduce((s, v) => s + (v - kickMean) ** 2, 0) / n;
    const rhythmicEntropy = Math.min(1, Math.sqrt(kickVar) * 3);

    // Kick onset pattern (16 steps) — approximate from occupancy over time
    const kickOnsetPattern = new Array(16).fill(0);
    const stepSize = Math.max(1, Math.floor(n / 16));
    for (let s = 0; s < 16; s++) {
      let sum = 0, count = 0;
      for (let i = s * stepSize; i < Math.min((s + 1) * stepSize, n); i++) {
        sum += ticks[i].occupancy.kick;
        count++;
      }
      kickOnsetPattern[s] = count > 0 ? sum / count : 0;
    }

    // MELODY (abstract)
    const melodicActivity = ticks.reduce((s, t) => s + t.occupancy.lead, 0) / n;
    const midEnergies = ticks.map(t => t.midEnergy);
    const melodicRegister = midEnergies.length > 0 ? midEnergies.reduce((a, b) => a + b, 0) / midEnergies.length : 0.5;
    // Contour: direction changes in mid-energy
    const melodicContour: number[] = [];
    for (let i = 1; i < midEnergies.length; i++) {
      melodicContour.push(midEnergies[i] > midEnergies[i - 1] ? 1 : -1);
    }
    const phraseLength = bars;

    // TIMBRE
    const centroids = ticks.map(t => t.spectralCentroid).filter(c => c > 0);
    const avgCentroid = centroids.length > 0 ? centroids.reduce((a, b) => a + b, 0) / centroids.length : 2000;
    const flatnesses = ticks.map(t => t.spectralFlatness).filter(f => f >= 0);
    const avgFlatness = flatnesses.length > 0 ? flatnesses.reduce((a, b) => a + b, 0) / flatnesses.length : 0.3;
    const rolloffs = ticks.map(t => t.spectralRolloff).filter(r => r > 0);
    const avgRolloff = rolloffs.length > 0 ? rolloffs.reduce((a, b) => a + b, 0) / rolloffs.length : 4000;
    const brightness = Math.min(1, avgCentroid / 5000);
    const noisiness = avgFlatness;
    const lowMidRatio = ticks.reduce((s, t) => s + (t.midEnergy > 0 ? t.lowEnergy / t.midEnergy : 0), 0) / n;
    const midHighRatio = ticks.reduce((s, t) => s + (t.highEnergy > 0 ? t.midEnergy / t.highEnergy : 0), 0) / n;

    // PERFORMANCE
    const energies = ticks.map(t => t.energy);
    const avgEnergy = energies.reduce((a, b) => a + b, 0) / n;
    const energySlope = energies.length > 4 ? (energies.slice(-4).reduce((a, b) => a + b, 0) / 4) - (energies.slice(0, 4).reduce((a, b) => a + b, 0) / 4) : 0;
    // Energy envelope per bar (8 bars)
    const energyEnvelope: number[] = [];
    const barStepSize = Math.max(1, Math.floor(n / 8));
    for (let b = 0; b < 8; b++) {
      let sum = 0, count = 0;
      for (let i = b * barStepSize; i < Math.min((b + 1) * barStepSize, n); i++) {
        sum += energies[i]; count++;
      }
      energyEnvelope.push(count > 0 ? sum / count : 0);
    }
    const dynamicRange = Math.max(...energies) - Math.min(...energies);

    // CONFIDENCE
    const overallConfidence = Math.min(1, n / 40); // 40 ticks = ~8s of data
    const observationCount = n;

    const features: PhraseMusicalFeatures = {
      phraseIndex, bar: startBar, bars,
      avgBpm, bpmStability, tempoDrift,
      pitchClassHistogram: pcHist, dominantPitchClass: dominantPc, keyConfidence,
      bassFundamental, bassIntervalMovement,
      avgKickDensity, avgBassDensity, avgHatDensity, syncopation, rhythmicEntropy,
      kickOnsetPattern,
      melodicActivity, melodicRegister, melodicContour, phraseLength,
      avgSpectralCentroid: avgCentroid, avgSpectralFlatness: avgFlatness, avgSpectralRolloff: avgRolloff,
      brightness, noisiness, lowMidRatio, midHighRatio,
      avgEnergy, energySlope, energyEnvelope, dynamicRange,
      overallConfidence, observationCount,
    };

    // Clear ticks for next phrase
    this.ticks = [];
    this.currentPhraseIndex = phraseIndex + 1;
    this.currentPhraseStartBar = startBar + bars;

    return features;
  }

  reset(): void {
    this.ticks = [];
    this.currentPhraseStartBar = 0;
    this.currentPhraseIndex = 0;
  }
}

// ── Spectral feature extraction from FFT data ────────────────────────────

/**
 * Extract spectral features from frequency data.
 * Called per-tick with the radio analyser's getByteFrequencyData output.
 */
export function extractSpectralFeatures(
  freqData: Uint8Array,
  sampleRate: number,
  fftSize: number,
): { centroid: number; flatness: number; rolloff: number; low: number; mid: number; high: number } {
  const binHz = sampleRate / fftSize;
  const n = freqData.length;

  let sum = 0, weightedSum = 0, sumSq = 0;
  let lowSum = 0, midSum = 0, highSum = 0;
  let lowCount = 0, midCount = 0, highCount = 0;
  let maxBin = 0, maxVal = 0;

  for (let i = 0; i < n; i++) {
    const v = freqData[i] / 255;
    const freq = i * binHz;
    sum += v;
    weightedSum += v * freq;
    sumSq += v * v;
    if (v > maxVal) { maxVal = v; maxBin = i; }

    if (freq < 250) { lowSum += v; lowCount++; }
    else if (freq < 2500) { midSum += v; midCount++; }
    else { highSum += v; highCount++; }
  }

  // Spectral centroid (brightness)
  const centroid = sum > 0 ? weightedSum / sum : 0;

  // Spectral flatness (noisiness) — geometric mean / arithmetic mean
  // Simplified: 1 - (peak / average) — high when energy is spread (noise), low when concentrated (tone)
  const avg = sum / n;
  const flatness = avg > 0 ? 1 - (maxVal / (avg * 4)) : 0;

  // Spectral rolloff — 85th percentile of energy
  let cumulative = 0;
  let rolloffBin = n - 1;
  const threshold = sum * 0.85;
  for (let i = 0; i < n; i++) {
    cumulative += freqData[i] / 255;
    if (cumulative >= threshold) { rolloffBin = i; break; }
  }
  const rolloff = rolloffBin * binHz;

  const low = lowCount > 0 ? lowSum / lowCount : 0;
  const mid = midCount > 0 ? midSum / midCount : 0;
  const high = highCount > 0 ? highSum / highCount : 0;

  return { centroid, flatness: Math.max(0, Math.min(1, flatness)), rolloff, low, mid, high };
}
