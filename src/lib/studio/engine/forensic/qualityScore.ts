/**
 * Audio Quality Score — weighted metric-based scoring.
 *
 * Every sub-score is derived from measured metrics. No invented numbers.
 *
 * Categories:
 *   LOW END        — kick/bass fundamental, RMS, overlap
 *   KICK           — fundamental presence, decay, transient strength
 *   BASS           — fundamental presence, decay, RMS level
 *   TRANSIENTS     — attack time, decay time, consistency
 *   SPECTRUM       — band distribution, centroid, flatness
 *   DYNAMICS       — crest factor, dynamic range, LUFS
 *   WORLD IDENTITY — (computed externally via world differentiator)
 *   ARRANGEMENT    — section similarity (from repetition detector)
 *   REPETITION     — 8-bar similarity (from repetition detector)
 */

import type { AudioAnalysis } from './audioAnalyzer';
import type { RepetitionReport } from './repetitionDetector';

export interface SubScore {
  name: string;
  score: number;          // 0..100
  metrics: Record<string, number | string>;
  explanation: string;
}

export interface QualityScore {
  lowEnd: SubScore;
  kick: SubScore;
  bass: SubScore;
  transients: SubScore;
  spectrum: SubScore;
  dynamics: SubScore;
  worldIdentity: SubScore;
  arrangement: SubScore;
  repetition: SubScore;
  total: number;          // 0..100 weighted average
  breakdown: string[];
}

/**
 * Score the low-end (kick + bass relationship).
 * Metrics: kick fundamental, bass fundamental, overlap, sub RMS.
 */
export function scoreLowEnd(analysis: AudioAnalysis): SubScore {
  const le = analysis.lowEnd;
  const metrics = {
    kickFundamental: le.kickFundamental,
    bassFundamental: le.bassFundamental,
    overlap: le.overlap,
    subRms: le.subRms,
    kickRms: le.kickRms,
    bassRms: le.bassRms,
  };

  let score = 0;
  const parts: string[] = [];

  // Kick fundamental in 40-65Hz range (typical psytrance)
  if (le.kickFundamental >= 40 && le.kickFundamental <= 65) {
    score += 25;
    parts.push(`kick fundamental ${le.kickFundamental.toFixed(0)}Hz in range (+25)`);
  } else {
    score += 10;
    parts.push(`kick fundamental ${le.kickFundamental.toFixed(0)}Hz out of range (+10)`);
  }

  // Bass fundamental in 80-150Hz range
  if (le.bassFundamental >= 80 && le.bassFundamental <= 150) {
    score += 25;
    parts.push(`bass fundamental ${le.bassFundamental.toFixed(0)}Hz in range (+25)`);
  } else {
    score += 10;
    parts.push(`bass fundamental ${le.bassFundamental.toFixed(0)}Hz out of range (+10)`);
  }

  // Overlap: lower is better (kick and bass should be separated)
  if (le.overlap < 0.3) {
    score += 25;
    parts.push(`overlap ${le.overlap.toFixed(2)} low — good separation (+25)`);
  } else if (le.overlap < 0.5) {
    score += 15;
    parts.push(`overlap ${le.overlap.toFixed(2)} moderate (+15)`);
  } else {
    score += 5;
    parts.push(`overlap ${le.overlap.toFixed(2)} high — KICK/BASS CONFLICT (+5)`);
  }

  // Sub RMS: should be present but not overwhelming
  if (le.subRms > 0.01 && le.subRms < 0.15) {
    score += 25;
    parts.push(`sub RMS ${le.subRms.toFixed(3)} balanced (+25)`);
  } else if (le.subRms >= 0.15) {
    score += 10;
    parts.push(`sub RMS ${le.subRms.toFixed(3)} too high (+10)`);
  } else {
    score += 5;
    parts.push(`sub RMS ${le.subRms.toFixed(3)} too low (+5)`);
  }

  return {
    name: 'LOW END',
    score: Math.min(100, score),
    metrics,
    explanation: parts.join('; '),
  };
}

/**
 * Score the kick specifically.
 */
export function scoreKick(analysis: AudioAnalysis): SubScore {
  const le = analysis.lowEnd;
  const tr = analysis.transients;
  const metrics = {
    fundamental: le.kickFundamental,
    decay: le.kickDecay,
    rms: le.kickRms,
    transientStrength: tr.transientStrength,
    consistency: tr.consistency,
  };

  let score = 0;
  const parts: string[] = [];

  // Decay: 0.1-0.3s is ideal for psytrance
  if (le.kickDecay >= 0.1 && le.kickDecay <= 0.3) {
    score += 30;
    parts.push(`decay ${le.kickDecay.toFixed(3)}s in range (+30)`);
  } else if (le.kickDecay < 0.1) {
    score += 15;
    parts.push(`decay ${le.kickDecay.toFixed(3)}s too short (+15)`);
  } else {
    score += 10;
    parts.push(`decay ${le.kickDecay.toFixed(3)}s too long (+10)`);
  }

  // Transient strength: higher = punchier
  if (tr.transientStrength > 4) {
    score += 30;
    parts.push(`transient strength ${tr.transientStrength.toFixed(1)} punchy (+30)`);
  } else if (tr.transientStrength > 2) {
    score += 20;
    parts.push(`transient strength ${tr.transientStrength.toFixed(1)} moderate (+20)`);
  } else {
    score += 5;
    parts.push(`transient strength ${tr.transientStrength.toFixed(1)} weak (+5)`);
  }

  // Consistency: higher = more even
  if (tr.consistency > 0.7) {
    score += 25;
    parts.push(`consistency ${tr.consistency.toFixed(2)} even (+25)`);
  } else if (tr.consistency > 0.5) {
    score += 15;
    parts.push(`consistency ${tr.consistency.toFixed(2)} moderate (+15)`);
  } else {
    score += 5;
    parts.push(`consistency ${tr.consistency.toFixed(2)} uneven (+5)`);
  }

  // RMS level: should be present
  if (le.kickRms > 0.05) {
    score += 15;
    parts.push(`kick RMS ${le.kickRms.toFixed(3)} present (+15)`);
  } else {
    score += 5;
    parts.push(`kick RMS ${le.kickRms.toFixed(3)} low (+5)`);
  }

  return {
    name: 'KICK',
    score: Math.min(100, score),
    metrics,
    explanation: parts.join('; '),
  };
}

/**
 * Score the bass specifically.
 */
export function scoreBass(analysis: AudioAnalysis): SubScore {
  const le = analysis.lowEnd;
  const metrics = {
    fundamental: le.bassFundamental,
    decay: le.bassDecay,
    rms: le.bassRms,
  };

  let score = 0;
  const parts: string[] = [];

  // Decay: 0.08-0.15s is ideal for psytrance (short, punchy)
  if (le.bassDecay >= 0.08 && le.bassDecay <= 0.15) {
    score += 35;
    parts.push(`decay ${le.bassDecay.toFixed(3)}s in range (+35)`);
  } else if (le.bassDecay < 0.08) {
    score += 20;
    parts.push(`decay ${le.bassDecay.toFixed(3)}s too short (+20)`);
  } else {
    score += 10;
    parts.push(`decay ${le.bassDecay.toFixed(3)}s too long/sustained (+10)`);
  }

  // RMS level: should be present but not overwhelming
  if (le.bassRms > 0.03 && le.bassRms < 0.2) {
    score += 35;
    parts.push(`bass RMS ${le.bassRms.toFixed(3)} balanced (+35)`);
  } else if (le.bassRms >= 0.2) {
    score += 15;
    parts.push(`bass RMS ${le.bassRms.toFixed(3)} too high (+15)`);
  } else {
    score += 10;
    parts.push(`bass RMS ${le.bassRms.toFixed(3)} too low (+10)`);
  }

  // Fundamental in range
  if (le.bassFundamental >= 80 && le.bassFundamental <= 150) {
    score += 30;
    parts.push(`fundamental ${le.bassFundamental.toFixed(0)}Hz in range (+30)`);
  } else {
    score += 10;
    parts.push(`fundamental ${le.bassFundamental.toFixed(0)}Hz out of range (+10)`);
  }

  return {
    name: 'BASS',
    score: Math.min(100, score),
    metrics,
    explanation: parts.join('; '),
  };
}

/**
 * Score transients.
 */
export function scoreTransients(analysis: AudioAnalysis): SubScore {
  const tr = analysis.transients;
  const metrics = {
    attackTime: tr.attackTime,
    decayTime: tr.decayTime,
    strength: tr.transientStrength,
    consistency: tr.consistency,
    count: tr.count,
  };

  let score = 0;
  const parts: string[] = [];

  // Attack time: <5ms is punchy
  if (tr.attackTime < 0.005) {
    score += 30;
    parts.push(`attack ${(tr.attackTime * 1000).toFixed(1)}ms fast (+30)`);
  } else if (tr.attackTime < 0.015) {
    score += 20;
    parts.push(`attack ${(tr.attackTime * 1000).toFixed(1)}ms moderate (+20)`);
  } else {
    score += 5;
    parts.push(`attack ${(tr.attackTime * 1000).toFixed(1)}ms slow (+5)`);
  }

  // Strength
  if (tr.transientStrength > 4) {
    score += 25;
    parts.push(`strength ${tr.transientStrength.toFixed(1)} strong (+25)`);
  } else if (tr.transientStrength > 2) {
    score += 15;
    parts.push(`strength ${tr.transientStrength.toFixed(1)} moderate (+15)`);
  } else {
    score += 5;
    parts.push(`strength ${tr.transientStrength.toFixed(1)} weak (+5)`);
  }

  // Consistency
  if (tr.consistency > 0.7) {
    score += 25;
    parts.push(`consistency ${tr.consistency.toFixed(2)} even (+25)`);
  } else if (tr.consistency > 0.5) {
    score += 15;
    parts.push(`consistency ${tr.consistency.toFixed(2)} moderate (+15)`);
  } else {
    score += 5;
    parts.push(`consistency ${tr.consistency.toFixed(2)} uneven (+5)`);
  }

  // Count: enough transients for a groove
  if (tr.count > 50) {
    score += 20;
    parts.push(`${tr.count} transients detected (+20)`);
  } else if (tr.count > 20) {
    score += 10;
    parts.push(`${tr.count} transients detected (+10)`);
  } else {
    score += 5;
    parts.push(`${tr.count} transients detected (+5)`);
  }

  return {
    name: 'TRANSIENTS',
    score: Math.min(100, score),
    metrics,
    explanation: parts.join('; '),
  };
}

/**
 * Score spectral balance.
 */
export function scoreSpectrum(analysis: AudioAnalysis): SubScore {
  const sp = analysis.spectrum;
  const metrics = {
    centroid: sp.centroidHz,
    rolloff: sp.rolloff,
    spread: sp.spread,
    flatness: sp.flatness,
    bands: sp.bands.map(b => ({ name: b.name, energyDb: b.energyDb.toFixed(1) })),
  };

  let score = 0;
  const parts: string[] = [];

  // Centroid: 1-4kHz is ideal for psytrance (bright but not harsh)
  if (sp.centroidHz >= 1000 && sp.centroidHz <= 4000) {
    score += 25;
    parts.push(`centroid ${sp.centroidHz.toFixed(0)}Hz in range (+25)`);
  } else if (sp.centroidHz < 1000) {
    score += 10;
    parts.push(`centroid ${sp.centroidHz.toFixed(0)}Hz too dark (+10)`);
  } else {
    score += 10;
    parts.push(`centroid ${sp.centroidHz.toFixed(0)}Hz too bright (+10)`);
  }

  // Flatness: 0.1-0.4 indicates tonal content with some noise (good for music)
  if (sp.flatness >= 0.1 && sp.flatness <= 0.4) {
    score += 25;
    parts.push(`flatness ${sp.flatness.toFixed(3)} musical (+25)`);
  } else if (sp.flatness > 0.4) {
    score += 10;
    parts.push(`flatness ${sp.flatness.toFixed(3)} too noisy (+10)`);
  } else {
    score += 10;
    parts.push(`flatness ${sp.flatness.toFixed(3)} too tonal/sine-like (+10)`);
  }

  // Band distribution: check that no band is dramatically louder than others
  const bandEnergies = sp.bands.map(b => b.energy);
  const maxBand = Math.max(...bandEnergies);
  const minBand = Math.min(...bandEnergies.filter((e, i) => sp.bands[i].name !== '8k-20k')); // exclude airy top
  const bandRatio = maxBand / (minBand + 1e-12);

  if (bandRatio < 100) {
    score += 25;
    parts.push(`band ratio ${bandRatio.toFixed(0)} balanced (+25)`);
  } else if (bandRatio < 1000) {
    score += 15;
    parts.push(`band ratio ${bandRatio.toFixed(0)} moderate (+15)`);
  } else {
    score += 5;
    parts.push(`band ratio ${bandRatio.toFixed(0)} unbalanced (+5)`);
  }

  // Spread: wider = richer
  if (sp.spread > 1000 && sp.spread < 5000) {
    score += 25;
    parts.push(`spread ${sp.spread.toFixed(0)}Hz rich (+25)`);
  } else {
    score += 10;
    parts.push(`spread ${sp.spread.toFixed(0)}Hz narrow (+10)`);
  }

  return {
    name: 'SPECTRUM',
    score: Math.min(100, score),
    metrics,
    explanation: parts.join('; '),
  };
}

/**
 * Score dynamics.
 */
export function scoreDynamics(analysis: AudioAnalysis): SubScore {
  const d = analysis.dynamics;
  const metrics = {
    peak: d.peak,
    peakDb: d.peakDb.toFixed(1),
    rms: d.rms,
    rmsDb: d.rmsDb.toFixed(1),
    lufs: d.lufs.toFixed(1),
    crest: d.crest.toFixed(2),
    crestDb: d.crestDb.toFixed(1),
  };

  let score = 0;
  const parts: string[] = [];

  // LUFS: -14 to -8 is commercial loudness range
  if (d.lufs >= -14 && d.lufs <= -8) {
    score += 30;
    parts.push(`LUFS ${d.lufs.toFixed(1)} commercial range (+30)`);
  } else if (d.lufs >= -18 && d.lufs < -14) {
    score += 20;
    parts.push(`LUFS ${d.lufs.toFixed(1)} quiet (+20)`);
  } else if (d.lufs > -8) {
    score += 10;
    parts.push(`LUFS ${d.lufs.toFixed(1)} too loud/over-compressed (+10)`);
  } else {
    score += 5;
    parts.push(`LUFS ${d.lufs.toFixed(1)} too quiet (+5)`);
  }

  // Crest factor: 4-8 dB is typical for mastered electronic music
  if (d.crestDb >= 4 && d.crestDb <= 8) {
    score += 30;
    parts.push(`crest ${d.crestDb.toFixed(1)}dB commercial (+30)`);
  } else if (d.crestDb > 8) {
    score += 20;
    parts.push(`crest ${d.crestDb.toFixed(1)}dB dynamic (+20)`);
  } else {
    score += 10;
    parts.push(`crest ${d.crestDb.toFixed(1)}dB over-compressed (+10)`);
  }

  // Peak: should be close to 0dBFS (normalized)
  if (d.peak > 0.9 && d.peak <= 1.0) {
    score += 20;
    parts.push(`peak ${d.peakDb.toFixed(1)}dB normalized (+20)`);
  } else if (d.peak > 0.5) {
    score += 10;
    parts.push(`peak ${d.peakDb.toFixed(1)}dB low (+10)`);
  } else {
    score += 5;
    parts.push(`peak ${d.peakDb.toFixed(1)}dB very low (+5)`);
  }

  // Dynamic range: should be reasonable (not crushed)
  if (d.dynamicRange >= 4 && d.dynamicRange <= 12) {
    score += 20;
    parts.push(`DR ${d.dynamicRange.toFixed(1)}dB good (+20)`);
  } else {
    score += 10;
    parts.push(`DR ${d.dynamicRange.toFixed(1)}dB (+10)`);
  }

  return {
    name: 'DYNAMICS',
    score: Math.min(100, score),
    metrics,
    explanation: parts.join('; '),
  };
}

/**
 * Score arrangement (section similarity).
 */
export function scoreArrangement(rep: RepetitionReport): SubScore {
  const metrics = {
    sectionSimilarity: rep.sectionSimilarity.map(s => ({
      label: s.label,
      similarity: s.similarity.toFixed(3),
      verdict: s.verdict,
    })),
    arrangementRepetitive: rep.arrangementRepetitive,
  };

  let score = 0;
  const parts: string[] = [];

  if (rep.arrangementRepetitive) {
    score = 20;
    parts.push('ARRANGEMENT IS STRUCTURALLY REPETITIVE — drops too similar (20)');
  } else {
    // Score based on section similarity — lower is better
    const dropSims = rep.sectionSimilarity
      .filter(s => s.label.includes('DROP'))
      .map(s => s.similarity);
    const avgDropSim = dropSims.length > 0
      ? dropSims.reduce((a, b) => a + b, 0) / dropSims.length
      : 0.5;

    if (avgDropSim < 0.7) {
      score = 90;
      parts.push(`drops are well differentiated, avg similarity ${avgDropSim.toFixed(3)} (90)`);
    } else if (avgDropSim < 0.85) {
      score = 70;
      parts.push(`drops are somewhat differentiated, avg similarity ${avgDropSim.toFixed(3)} (70)`);
    } else if (avgDropSim < 0.90) {
      score = 50;
      parts.push(`drops are repetitive, avg similarity ${avgDropSim.toFixed(3)} (50)`);
    } else {
      score = 30;
      parts.push(`drops are highly repetitive, avg similarity ${avgDropSim.toFixed(3)} (30)`);
    }
  }

  return {
    name: 'ARRANGEMENT',
    score,
    metrics,
    explanation: parts.join('; '),
  };
}

/**
 * Score repetition (8-bar similarity).
 */
export function scoreRepetition(rep: RepetitionReport): SubScore {
  const metrics = {
    avg4bar: rep.averageFourBar.toFixed(3),
    avg8bar: rep.averageEightBar.toFixed(3),
    avg16bar: rep.averageSixteenBar.toFixed(3),
    max8bar: rep.maxEightBar.toFixed(3),
    loopWarning: rep.loopWarning,
  };

  let score = 0;
  const parts: string[] = [];

  if (rep.loopWarning) {
    score = 20;
    parts.push(`LOOP WARNING: max 8-bar similarity ${rep.maxEightBar.toFixed(3)} > 0.95 (20)`);
  } else if (rep.averageEightBar > 0.90) {
    score = 40;
    parts.push(`high repetition, 8-bar avg ${rep.averageEightBar.toFixed(3)} (40)`);
  } else if (rep.averageEightBar > 0.80) {
    score = 65;
    parts.push(`moderate repetition, 8-bar avg ${rep.averageEightBar.toFixed(3)} (65)`);
  } else if (rep.averageEightBar > 0.70) {
    score = 80;
    parts.push(`evolving, 8-bar avg ${rep.averageEightBar.toFixed(3)} (80)`);
  } else {
    score = 90;
    parts.push(`highly evolving, 8-bar avg ${rep.averageEightBar.toFixed(3)} (90)`);
  }

  return {
    name: 'REPETITION',
    score,
    metrics,
    explanation: parts.join('; '),
  };
}

/**
 * Compute the full quality score.
 */
export function computeQualityScore(
  analysis: AudioAnalysis,
  rep: RepetitionReport,
  worldIdentityScore: number = 50,
  worldIdentityMetrics: Record<string, number | string> = {},
  worldIdentityExplanation: string = 'Not computed',
): QualityScore {
  const lowEnd = scoreLowEnd(analysis);
  const kick = scoreKick(analysis);
  const bass = scoreBass(analysis);
  const transients = scoreTransients(analysis);
  const spectrum = scoreSpectrum(analysis);
  const dynamics = scoreDynamics(analysis);
  const arrangement = scoreArrangement(rep);
  const repetition = scoreRepetition(rep);

  const worldIdentity: SubScore = {
    name: 'WORLD IDENTITY',
    score: worldIdentityScore,
    metrics: worldIdentityMetrics,
    explanation: worldIdentityExplanation,
  };

  // Weighted total
  const weights = {
    lowEnd: 0.12,
    kick: 0.12,
    bass: 0.12,
    transients: 0.10,
    spectrum: 0.12,
    dynamics: 0.12,
    worldIdentity: 0.10,
    arrangement: 0.10,
    repetition: 0.10,
  };

  const total = Math.round(
    lowEnd.score * weights.lowEnd +
    kick.score * weights.kick +
    bass.score * weights.bass +
    transients.score * weights.transients +
    spectrum.score * weights.spectrum +
    dynamics.score * weights.dynamics +
    worldIdentity.score * weights.worldIdentity +
    arrangement.score * weights.arrangement +
    repetition.score * weights.repetition
  );

  const breakdown = [
    `LOW END        ${lowEnd.score}/100`,
    `KICK           ${kick.score}/100`,
    `BASS           ${bass.score}/100`,
    `TRANSIENTS     ${transients.score}/100`,
    `SPECTRUM       ${spectrum.score}/100`,
    `DYNAMICS       ${dynamics.score}/100`,
    `WORLD IDENTITY ${worldIdentity.score}/100`,
    `ARRANGEMENT    ${arrangement.score}/100`,
    `REPETITION     ${repetition.score}/100`,
    `TOTAL          ${total}/100`,
  ];

  return {
    lowEnd, kick, bass, transients, spectrum, dynamics,
    worldIdentity, arrangement, repetition,
    total, breakdown,
  };
}
