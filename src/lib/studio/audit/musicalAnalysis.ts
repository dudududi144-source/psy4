/**
 * MUSICAL STRUCTURE ANALYZER — independent audit tool.
 * REAL IMPLEMENTATION. Measures actual musical properties of audio buffers.
 *
 * This does NOT trust labels. It inspects the samples and derives:
 *  - tempo (from onset periodicity)
 *  - beat/bar alignment
 *  - onset density
 *  - kick periodicity (autocorrelation at beat interval)
 *  - bass/kick relationship (spectral + temporal)
 *  - spectral distribution (low/mid/high energy)
 *  - dynamic range
 *  - stereo correlation
 *  - repetition rate
 *  - silence distribution
 *  - section transitions (energy envelope over time)
 *
 * Used by the independent proof runner to verify artifacts actually demonstrate
 * their claimed musical capability — not just "file exists + peak > 0.05".
 */

export interface MusicalAnalysis {
  durationSec: number;
  sampleRate: number;
  samples: number;
  // level metrics
  peak: number;
  rms: number;
  crestFactor: number;       // peak/rms
  dynamicRange: number;      // dB between RMS and peak
  // spectral
  lowEnergy: number;         // 0..1 ratio below 200Hz
  midEnergy: number;         // 0..1 ratio 200-2000Hz
  highEnergy: number;        // 0..1 ratio above 2000Hz
  spectralCentroid: number;  // Hz
  // temporal
  onsetCount: number;
  onsetDensity: number;      // onsets per second
  estimatedTempo: number;    // BPM from onset periodicity
  kickPeriodicity: number;   // 0..1 autocorrelation at beat interval
  bassKickAlignment: number; // 0..1 how well bass sits between kicks (off-beat)
  // stereo
  stereoCorrelation: number; // -1..1
  stereoWidth: number;       // 0..1
  // structure
  silenceRatio: number;      // 0..1 fraction of near-silent windows
  repetitionRate: number;    // 0..1 how repetitive (autocorr of energy envelope)
  sectionCount: number;      // detected energy sections
  sectionTransitions: number[];
  // verdict helpers
  isSilent: boolean;
  isConstant: boolean;
  isNoiseLike: boolean;
  isClipped: boolean;
  hasLowFreqContent: boolean;
  hasDynamicRange: boolean;
}

/** Onset detection via energy difference in windowed blocks. */
export function detectOnsets(buf: Float32Array, threshold = 0.05, windowSize = 128): number[] {
  const onsets: number[] = [];
  let prevEnv = 0;
  for (let i = 0; i < buf.length - windowSize; i += windowSize) {
    let s = 0;
    for (let j = 0; j < windowSize; j++) s += buf[i + j] * buf[i + j];
    const env = Math.sqrt(s / windowSize);
    if (env > threshold && env > prevEnv * 1.4 && env - prevEnv > threshold * 0.3) {
      onsets.push(i);
    }
    prevEnv = env;
  }
  return onsets;
}

/** Estimate tempo via autocorrelation of the onset envelope. */
export function estimateTempo(buf: Float32Array, sr: number): { bpm: number; periodicity: number } {
  const winSize = Math.floor(sr * 0.01); // 10ms windows
  const numWindows = Math.floor(buf.length / winSize);
  if (numWindows < 50) return { bpm: 0, periodicity: 0 };
  const env = new Float32Array(numWindows);
  for (let w = 0; w < numWindows; w++) {
    let s = 0;
    for (let i = 0; i < winSize; i++) s += buf[w * winSize + i] * buf[w * winSize + i];
    env[w] = Math.sqrt(s / winSize);
  }
  // autocorrelate over lag range corresponding to 60-200 BPM
  const minLag = Math.floor((60 / 200) * sr / winSize); // 60 BPM → 0.3s
  const maxLag = Math.floor((60 / 60) * sr / winSize);  // 200 BPM → 0.3s... wait
  // Actually: BPM = 60 / (lag * winSize / sr). For 60 BPM, lag = sr/winSize. For 200 BPM, lag = (60/200)*sr/winSize.
  const lagMin = Math.floor((60 / 200) * sr / winSize);
  const lagMax = Math.floor((60 / 60) * sr / winSize);
  let bestLag = 0;
  let bestCorr = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let c = 0;
    let n = 0;
    for (let i = 0; i < numWindows - lag; i++) {
      c += env[i] * env[i + lag];
      n++;
    }
    c /= Math.max(1, n);
    if (c > bestCorr) { bestCorr = c; bestLag = lag; }
  }
  if (bestLag === 0) return { bpm: 0, periodicity: 0 };
  const bpm = 60 / (bestLag * winSize / sr);
  // periodicity = normalized autocorrelation at best lag
  let meanEnv = 0;
  for (let i = 0; i < numWindows; i++) meanEnv += env[i];
  meanEnv /= numWindows;
  let varEnv = 0;
  for (let i = 0; i < numWindows; i++) varEnv += (env[i] - meanEnv) ** 2;
  varEnv /= numWindows;
  const periodicity = varEnv > 0 ? bestCorr / (varEnv * numWindows) : 0;
  return { bpm: Math.round(bpm * 10) / 10, periodicity: Math.max(0, Math.min(1, periodicity)) };
}

/** Measure kick periodicity at a target BPM. Low-pass filters first to isolate kick.
 *  Uses properly normalized autocorrelation: R(lag) = Σ x[i]·x[i+lag] / Σ x[i]² */
export function kickPeriodicity(buf: Float32Array, sr: number, bpm: number): number {
  const beatSamples = Math.floor((60 / bpm) * sr);
  if (beatSamples <= 0 || buf.length < beatSamples * 4) return 0;
  // LP filter at 150Hz to isolate kick + sub-bass from the full mix
  const t = Math.exp(-2 * Math.PI * 150 / sr);
  const a = 1 - t;
  let prev = 0;
  const low = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    prev = a * buf[i] + t * prev;
    low[i] = prev;
  }
  // Autocorrelation of the RECTIFIED signal (amplitude envelope) at beat lag.
  // We rectify because a kick is a tonal sine — raw autocorrelation at the beat lag
  // suffers phase cancellation. The envelope is always positive and periodic.
  let crossSum = 0;
  let energySum = 0;
  const step = 4; // subsample for speed
  for (let i = 0; i < low.length - beatSamples; i += step) {
    const a = Math.abs(low[i]);
    const b = Math.abs(low[i + beatSamples]);
    crossSum += a * b;
    energySum += a * a;
  }
  if (energySum < 1e-10) return 0;
  return Math.max(0, Math.min(1, crossSum / energySum));
}

/** Bass/kick alignment: do off-beat positions have more low-freq energy than downbeats? */
export function bassKickAlignment(buf: Float32Array, sr: number, bpm: number): number {
  const beatSamples = Math.floor((60 / bpm) * sr);
  const halfBeat = Math.floor(beatSamples / 2);
  if (buf.length < beatSamples * 8) return 0;
  // LP filter to isolate bass
  const t = Math.exp(-2 * Math.PI * 120 / sr);
  const a = 1 - t;
  let prev = 0;
  const low = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    prev = a * buf[i] + t * prev;
    low[i] = prev;
  }
  // measure energy at downbeats vs off-beats
  let downbeatEnergy = 0;
  let offbeatEnergy = 0;
  let dbCount = 0;
  let obCount = 0;
  for (let bar = 0; bar < 8; bar++) {
    for (let beat = 0; beat < 4; beat++) {
      const start = bar * beatSamples * 4 + beat * beatSamples;
      // sample a short window at the beat position
      const winLen = Math.floor(beatSamples * 0.15);
      let e = 0;
      for (let i = 0; i < winLen && start + i < buf.length; i++) e += low[start + i] ** 2;
      e /= winLen;
      if (beat % 1 === 0) { downbeatEnergy += e; dbCount++; }
      // off-beat = half-beat offset
      const offStart = start + halfBeat;
      let oe = 0;
      for (let i = 0; i < winLen && offStart + i < buf.length; i++) oe += low[offStart + i] ** 2;
      oe /= winLen;
      offbeatEnergy += oe;
      obCount++;
    }
  }
  if (dbCount === 0 || obCount === 0) return 0;
  // good psytrance: kick (downbeat) is strong AND bass (offbeat) is present
  const db = downbeatEnergy / dbCount;
  const ob = offbeatEnergy / obCount;
  // alignment = both present, ratio not extreme
  if (db < 1e-6 || ob < 1e-6) return 0;
  const ratio = Math.min(db, ob) / Math.max(db, ob);
  return Math.min(1, ratio * 2);
}

/** Spectral analysis via zero-crossing-rate + multi-band energy. */
export function spectralAnalysis(buf: Float32Array, sr: number): {
  low: number; mid: number; high: number; centroid: number;
} {
  // 3-band split via one-pole filters
  const lowT = Math.exp(-2 * Math.PI * 200 / sr);
  const lowA = 1 - lowT;
  const highT = Math.exp(-2 * Math.PI * 2000 / sr);
  const highA = 1 - highT;
  let lowPrev = 0, highPrev = 0, midPrev = 0;
  let lowE = 0, midE = 0, highE = 0, totalE = 0;
  // spectral centroid via ZCR approximation
  let zeroCrossings = 0;
  let prevSign = 0;
  for (let i = 0; i < buf.length; i++) {
    const s = buf[i];
    lowPrev = lowA * s + lowT * lowPrev;
    highPrev = highA * s + highT * highPrev;
    const midS = s - lowPrev - highPrev;
    lowE += lowPrev * lowPrev;
    midE += midS * midS;
    highE += highPrev * highPrev;
    totalE += s * s;
    const sign = s >= 0 ? 1 : -1;
    if (i > 0 && sign !== prevSign) zeroCrossings++;
    prevSign = sign;
  }
  // ZCR → frequency approximation
  const zcr = zeroCrossings / (buf.length / sr);
  const centroid = zcr / 2; // rough
  if (totalE < 1e-10) return { low: 0, mid: 0, high: 0, centroid: 0 };
  return {
    low: lowE / totalE,
    mid: midE / totalE,
    high: highE / totalE,
    centroid,
  };
}

/** Stereo correlation. */
export function stereoCorrelation(l: Float32Array, r: Float32Array): number {
  const n = Math.min(l.length, r.length);
  if (n === 0) return 0;
  let sumLR = 0, sumL = 0, sumR = 0, sumL2 = 0, sumR2 = 0;
  for (let i = 0; i < n; i++) {
    sumLR += l[i] * r[i];
    sumL += l[i]; sumR += r[i];
    sumL2 += l[i] * l[i]; sumR2 += r[i] * r[i];
  }
  const ml = sumL / n, mr = sumR / n;
  const cov = sumLR / n - ml * mr;
  const sl = Math.sqrt(Math.max(0, sumL2 / n - ml * ml));
  const sr = Math.sqrt(Math.max(0, sumR2 / n - mr * mr));
  if (sl < 1e-9 || sr < 1e-9) return 0;
  return Math.max(-1, Math.min(1, cov / (sl * sr)));
}

/** Section detection via energy envelope segmentation. */
export function detectSections(buf: Float32Array, sr: number): { count: number; transitions: number[] } {
  const winSize = Math.floor(sr * 0.5); // 0.5s windows
  const numWins = Math.floor(buf.length / winSize);
  if (numWins < 4) return { count: 1, transitions: [] };
  const env = new Float32Array(numWins);
  for (let w = 0; w < numWins; w++) {
    let s = 0;
    for (let i = 0; i < winSize; i++) s += buf[w * winSize + i] ** 2;
    env[w] = Math.sqrt(s / winSize);
  }
  // normalize
  let max = 0;
  for (let i = 0; i < numWins; i++) max = Math.max(max, env[i]);
  if (max < 1e-9) return { count: 1, transitions: [] };
  const norm = new Float32Array(numWins);
  for (let i = 0; i < numWins; i++) norm[i] = env[i] / max;
  // find transitions where energy changes by > 30%
  const transitions: number[] = [];
  for (let i = 1; i < numWins; i++) {
    if (Math.abs(norm[i] - norm[i - 1]) > 0.3) {
      transitions.push(Math.floor((i * winSize) / sr * 10) / 10);
    }
  }
  // count distinct sections (group transitions)
  let count = 1;
  for (let i = 1; i < transitions.length; i++) {
    if (transitions[i] - transitions[i - 1] > 1) count++;
  }
  if (transitions.length > 0) count++;
  return { count: Math.max(1, count), transitions: transitions.slice(0, 20) };
}

/** Repetition rate: autocorrelation of energy envelope at bar intervals. */
export function repetitionRate(buf: Float32Array, sr: number, bpm: number): number {
  const barSamples = Math.floor((240 / bpm) * sr);
  if (buf.length < barSamples * 4) return 0;
  const numBars = Math.floor(buf.length / barSamples);
  const barEnergy = new Float32Array(numBars);
  for (let b = 0; b < numBars; b++) {
    let s = 0;
    for (let i = 0; i < barSamples; i++) s += buf[b * barSamples + i] ** 2;
    barEnergy[b] = Math.sqrt(s / barSamples);
  }
  // autocorr at lag 1 and 2 bars
  if (numBars < 4) return 0;
  let c1 = 0, c0 = 0;
  for (let i = 0; i < numBars - 1; i++) { c1 += barEnergy[i] * barEnergy[i + 1]; c0 += barEnergy[i] ** 2; }
  return c0 > 0 ? Math.min(1, c1 / (c0 * 1.2)) : 0;
}

/** Full musical analysis of a stereo buffer. */
export function analyzeMusic(left: Float32Array, right: Float32Array, sr: number, expectedBpm?: number): MusicalAnalysis {
  const n = Math.min(left.length, right.length);
  let peak = 0, sumSq = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(left[i]);
    if (a > peak) peak = a;
    sumSq += left[i] * left[i];
  }
  const rms = Math.sqrt(sumSq / Math.max(1, n));
  const crestFactor = rms > 0 ? peak / rms : 0;
  const dynamicRange = rms > 0 ? 20 * Math.log10(peak / Math.max(rms, 1e-9)) : 0;

  const spec = spectralAnalysis(left, sr);
  const onsets = detectOnsets(left, 0.05, 128);
  const onsetDensity = onsets.length / (n / sr);
  const tempoResult = estimateTempo(left, sr);
  const bpm = expectedBpm ?? tempoResult.bpm;
  const kickPeriod = kickPeriodicity(left, sr, bpm);
  const bassAlign = bassKickAlignment(left, sr, bpm);
  const stereoCorr = stereoCorrelation(left, right);
  const sections = detectSections(left, sr);
  const repRate = repetitionRate(left, sr, bpm);

  // silence ratio
  const winSize = Math.floor(sr * 0.1);
  const numWins = Math.floor(n / winSize);
  let silentWins = 0;
  for (let w = 0; w < numWins; w++) {
    let s = 0;
    for (let i = 0; i < winSize; i++) s += left[w * winSize + i] ** 2;
    if (Math.sqrt(s / winSize) < 0.005) silentWins++;
  }
  const silenceRatio = numWins > 0 ? silentWins / numWins : 1;

  // classify degenerate outputs
  const isSilent = peak < 0.001;
  const isConstant = rms > 0.01 && crestFactor < 1.2; // very low crest = constant-ish
  const isClipped = (() => {
    let clipCount = 0;
    for (let i = 0; i < n; i++) if (Math.abs(left[i]) > 0.999) clipCount++;
    return clipCount > n * 0.05;
  })();
  const isNoiseLike = (() => {
    // noise-like = high ZCR AND flat spectrum (no clear low-freq dominance).
    // A musical signal with high-freq content (e.g. wavetable lead) has high ZCR
    // but STILL has low-freq content from the kick/bass. Only flag as noise if
    // BOTH conditions are met: very high ZCR AND very low low-freq ratio.
    let zc = 0;
    for (let i = 1; i < n; i++) if ((left[i] >= 0) !== (left[i - 1] >= 0)) zc++;
    const zcr = zc / (n / sr);
    return zcr > 7000 && spec.low < 0.12;
  })();

  return {
    durationSec: n / sr,
    sampleRate: sr,
    samples: n,
    peak, rms, crestFactor, dynamicRange,
    lowEnergy: spec.low, midEnergy: spec.mid, highEnergy: spec.high,
    spectralCentroid: spec.centroid,
    onsetCount: onsets.length, onsetDensity,
    estimatedTempo: tempoResult.bpm,
    kickPeriodicity: kickPeriod,
    bassKickAlignment: bassAlign,
    stereoCorrelation: stereoCorr,
    stereoWidth: 1 - Math.abs(stereoCorr),
    silenceRatio,
    repetitionRate: repRate,
    sectionCount: sections.count,
    sectionTransitions: sections.transitions,
    isSilent, isConstant, isNoiseLike, isClipped,
    hasLowFreqContent: spec.low > 0.15,
    hasDynamicRange: dynamicRange > 3,
  };
}

/** Verdict: does this buffer pass musical-structure criteria for a psytrance loop? */
export function verdictPsytranceLoop(a: MusicalAnalysis): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (a.isSilent) reasons.push('SILENT');
  if (a.isConstant) reasons.push('CONSTANT_SIGNAL');
  if (a.isNoiseLike) reasons.push('NOISE_LIKE');
  if (a.isClipped) reasons.push('CLIPPED');
  if (a.peak < 0.1) reasons.push('PEAK_TOO_LOW');
  if (a.rms < 0.02) reasons.push('RMS_TOO_LOW');
  if (!a.hasLowFreqContent) reasons.push('NO_LOW_FREQ_CONTENT');
  if (a.kickPeriodicity < 0.3) reasons.push('KICK_NOT_PERIODIC');
  if (a.onsetDensity < 0.5) reasons.push('ONSET_DENSITY_TOO_LOW');
  if (a.silenceRatio > 0.3) reasons.push('TOO_MUCH_SILENCE');
  // reject sub-audio content (spectral centroid below 80Hz = not real music)
  if (a.spectralCentroid < 80) reasons.push('SPECTRAL_CENTROID_TOO_LOW');
  return { pass: reasons.length === 0, reasons };
}

/** Verdict: does this buffer demonstrate evolving psychedelic material? */
export function verdictEvolving(a: MusicalAnalysis, windowAnalyses: MusicalAnalysis[]): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const base = verdictPsytranceLoop(a);
  if (!base.pass) reasons.push(...base.reasons);
  // evolution: spectral centroid must vary across windows
  if (windowAnalyses.length >= 4) {
    const centroids = windowAnalyses.map((w) => w.spectralCentroid);
    const mean = centroids.reduce((a, b) => a + b, 0) / centroids.length;
    const variance = centroids.reduce((a, c) => a + (c - mean) ** 2, 0) / centroids.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
    if (cv < 0.05) reasons.push('SPECTRAL_STAGNATION');
    // but must NOT be random (repetition should still exist)
    if (a.repetitionRate < 0.2) reasons.push('EXCESSIVE_RANDOMNESS');
  } else {
    reasons.push('INSUFFICIENT_WINDOWS_FOR_EVOLUTION_ANALYSIS');
  }
  return { pass: reasons.length === 0, reasons };
}

/** Verdict: does this buffer demonstrate a multi-section arrangement? */
export function verdictArrangement(a: MusicalAnalysis): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const base = verdictPsytranceLoop(a);
  if (!base.pass) reasons.push(...base.reasons);
  if (a.sectionCount < 3) reasons.push('TOO_FEW_SECTIONS');
  if (a.sectionTransitions.length < 2) reasons.push('TOO_FEW_TRANSITIONS');
  if (a.durationSec < 30) reasons.push('ARRANGEMENT_TOO_SHORT');
  return { pass: reasons.length === 0, reasons };
}
