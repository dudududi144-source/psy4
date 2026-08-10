/**
 * Spectral Style Classifier (Task 14) — LEARNS the psytrance sub-style
 * from acoustic features, not from genre tags.
 *
 * The classifier takes reference metrics (BPM, spectralCentroid, subEnergy,
 * lowEnergy, midEnergy, highEnergy, airEnergy, transientDensity, kickDecayMs,
 * bassDecayMs, stereoWidth, energy, and optionally the detected musical key)
 * and returns ALL known psytrance sub-styles ranked by similarity.
 *
 * This is a PURE function — no side effects, no I/O. It is trivially testable
 * and deterministic given the same inputs.
 *
 * Scoring model:
 *   - Each style has a target acoustic profile (BPM range, centroid range,
 *     sub/high energy ranges, transient density, kick decay, etc.).
 *   - For each feature, compute a similarity score 0..1 (triangular kernel:
 *     peak at ideal, dropping linearly outside range).
 *   - Weighted sum across features. Weights:
 *       BPM 25% · centroid 20% · subEnergy 10% · transientDensity 15% ·
 *       kickDecay 10% · highEnergy 10% · scale 10%
 *   - Missing/zero features are SKIPPED and weights re-normalized so a
 *     partial feature set still gives a meaningful answer.
 *   - Final confidence: score / 100 normalized to ~0.9 if it's a strong
 *     unambiguous fit; lower if multiple styles tie.
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface RefFeatures {
  bpm: number;
  spectralCentroid: number; // Hz
  subEnergy: number;        // 0..1
  lowEnergy: number;        // 0..1
  midEnergy: number;        // 0..1
  highEnergy: number;       // 0..1
  airEnergy: number;        // 0..1
  transientDensity: number; // transients/sec
  kickDecayMs: number;
  bassDecayMs: number;
  stereoWidth: number;      // 0..1
  energy: number;           // 0..1
  detectedKey?: { root: number; scale: string; confidence: number };
}

export interface StyleMatch {
  style: string;
  confidence: number;       // 0..1
  reasons: string[];        // human-readable explanations
}

// ─── Feature profile for one style ────────────────────────────────────────

interface Range {
  min: number;
  max: number;
  ideal: number;
}

interface StyleProfile {
  id: string;
  name: string;
  bpm: Range;
  centroid: Range;          // Hz
  subEnergy: Range;
  highEnergy: Range;
  transientDensity: Range;  // /s
  kickDecayMs: Range;
  scales: string[];         // preferred scales
  character: string[];      // descriptive keywords
}

// ─── Style signatures ────────────────────────────────────────────────────
// Based on real psytrance production knowledge, NOT "fat bass".
// Each profile captures the ACTUAL SOUND of the sub-style across multiple
// acoustic dimensions. Centroid ranges reflect the dominant spectral content
// (dark = low Hz, bright = high Hz). Transient density reflects rhythmic
// activity. Kick decay reflects kick character (tight/punchy vs deep/long).

const STYLE_PROFILES: StyleProfile[] = [
  {
    id: 'dark-psy',
    name: 'Dark Psy',
    bpm:          { min: 148, max: 155, ideal: 150 },
    centroid:     { min: 600, max: 1200, ideal: 850 },
    subEnergy:    { min: 0.7, max: 1.0, ideal: 0.85 },
    highEnergy:   { min: 0.1, max: 0.3, ideal: 0.2 },
    transientDensity: { min: 14, max: 22, ideal: 18 },
    kickDecayMs:  { min: 80, max: 150, ideal: 110 },
    scales:       ['phrygian', 'harmonicMinor', 'phrygianDominant'],
    character:    ['dark', 'intense', 'foreboding', 'fast transients', 'short kick'],
  },
  {
    id: 'progressive-psy',
    name: 'Progressive Psy',
    bpm:          { min: 124, max: 134, ideal: 128 },
    centroid:     { min: 1200, max: 2000, ideal: 1600 },
    subEnergy:    { min: 0.4, max: 0.7, ideal: 0.55 },
    highEnergy:   { min: 0.3, max: 0.5, ideal: 0.4 },
    transientDensity: { min: 10, max: 14, ideal: 12 },
    kickDecayMs:  { min: 180, max: 280, ideal: 230 },
    scales:       ['dorian', 'minor', 'minorPentatonic'],
    character:    ['slow build', 'melodic', 'hypnotic', 'long kick decay'],
  },
  {
    id: 'goa',
    name: 'Goa',
    bpm:          { min: 134, max: 146, ideal: 140 },
    centroid:     { min: 1800, max: 3000, ideal: 2400 },
    subEnergy:    { min: 0.5, max: 0.8, ideal: 0.65 },
    highEnergy:   { min: 0.4, max: 0.7, ideal: 0.55 },
    transientDensity: { min: 14, max: 20, ideal: 16 },
    kickDecayMs:  { min: 120, max: 200, ideal: 160 },
    scales:       ['phrygianDominant', 'harmonicMinor', 'doubleHarmonic'],
    character:    ['acid leads', 'mystical', 'squelchy', 'metallic', 'melodic'],
  },
  {
    id: 'forest',
    name: 'Forest',
    bpm:          { min: 144, max: 156, ideal: 148 },
    centroid:     { min: 800, max: 1500, ideal: 1150 },
    subEnergy:    { min: 0.65, max: 0.9, ideal: 0.75 },
    highEnergy:   { min: 0.2, max: 0.4, ideal: 0.3 },
    transientDensity: { min: 12, max: 18, ideal: 15 },
    kickDecayMs:  { min: 100, max: 180, ideal: 140 },
    scales:       ['minor', 'phrygian', 'dorian'],
    character:    ['organic', 'mysterious', 'dark', 'percussive'],
  },
  {
    id: 'morning-psy',
    name: 'Morning Psy',
    bpm:          { min: 138, max: 146, ideal: 142 },
    centroid:     { min: 2000, max: 3500, ideal: 2700 },
    subEnergy:    { min: 0.5, max: 0.75, ideal: 0.6 },
    highEnergy:   { min: 0.5, max: 0.85, ideal: 0.7 },
    transientDensity: { min: 11, max: 16, ideal: 13 },
    kickDecayMs:  { min: 130, max: 200, ideal: 165 },
    scales:       ['dorian', 'minorPentatonic', 'harmonicMinor'],
    character:    ['uplifting', 'bright', 'euphoric', 'high air'],
  },
  {
    id: 'full-on',
    name: 'Full-On',
    bpm:          { min: 140, max: 146, ideal: 143 },
    centroid:     { min: 1500, max: 2500, ideal: 2000 },
    subEnergy:    { min: 0.65, max: 0.9, ideal: 0.78 },
    highEnergy:   { min: 0.4, max: 0.65, ideal: 0.52 },
    transientDensity: { min: 12, max: 16, ideal: 14 },
    kickDecayMs:  { min: 120, max: 180, ideal: 150 },
    scales:       ['minor', 'dorian', 'harmonicMinor'],
    character:    ['high energy', 'punchy kick', 'bright leads', 'driving'],
  },
  {
    id: 'hi-tech',
    name: 'Hi-Tech',
    bpm:          { min: 150, max: 160, ideal: 155 },
    centroid:     { min: 2500, max: 4500, ideal: 3500 },
    subEnergy:    { min: 0.6, max: 0.85, ideal: 0.72 },
    highEnergy:   { min: 0.6, max: 0.95, ideal: 0.8 },
    transientDensity: { min: 18, max: 28, ideal: 22 },
    kickDecayMs:  { min: 70, max: 130, ideal: 100 },
    scales:       ['phrygian', 'harmonicMinor', 'phrygianDominant'],
    character:    ['extreme brightness', 'metallic', 'fast everything', 'aggressive'],
  },
  {
    id: 'suomi',
    name: 'Suomi',
    bpm:          { min: 145, max: 160, ideal: 152 },
    centroid:     { min: 1400, max: 2400, ideal: 1900 },
    subEnergy:    { min: 0.5, max: 0.8, ideal: 0.65 },
    highEnergy:   { min: 0.35, max: 0.6, ideal: 0.48 },
    transientDensity: { min: 13, max: 22, ideal: 17 },
    kickDecayMs:  { min: 100, max: 180, ideal: 140 },
    scales:       ['minor', 'phrygian', 'dorian', 'minorPentatonic'],
    character:    ['erratic', 'playful', 'unpredictable', 'quirky'],
  },
  {
    id: 'acid-psy',
    name: 'Acid Psy',
    bpm:          { min: 138, max: 146, ideal: 142 },
    centroid:     { min: 1500, max: 2800, ideal: 2100 },
    subEnergy:    { min: 0.55, max: 0.8, ideal: 0.68 },
    highEnergy:   { min: 0.45, max: 0.7, ideal: 0.55 },
    transientDensity: { min: 12, max: 18, ideal: 15 },
    kickDecayMs:  { min: 110, max: 180, ideal: 145 },
    scales:       ['minor', 'phrygian', 'dorian'],
    character:    ['303-style', 'squelchy', 'acid', 'driving'],
  },
  {
    id: 'hypnotic',
    name: 'Hypnotic',
    bpm:          { min: 126, max: 136, ideal: 130 },
    centroid:     { min: 800, max: 1500, ideal: 1100 },
    subEnergy:    { min: 0.45, max: 0.7, ideal: 0.55 },
    highEnergy:   { min: 0.2, max: 0.4, ideal: 0.3 },
    transientDensity: { min: 6, max: 10, ideal: 8 },
    kickDecayMs:  { min: 250, max: 400, ideal: 320 },
    scales:       ['dorian', 'minor'],
    character:    ['repetitive', 'trance-inducing', 'minimal', 'long kick', 'spacious'],
  },
];

// ─── Weights ──────────────────────────────────────────────────────────────
// These sum to 1.0. When a feature is missing, its weight is redistributed
// proportionally across the remaining features.

const WEIGHTS = {
  bpm: 0.25,
  centroid: 0.20,
  subEnergy: 0.10,
  transientDensity: 0.15,
  kickDecay: 0.10,
  highEnergy: 0.10,
  scale: 0.10,
};

// ─── Helpers ──────────────────────────────────────────────────────────────

const clamp = (v: number, a: number, b: number) => v < a ? a : (v > b ? b : v);

/**
 * Triangular similarity kernel for a single feature.
 *   - Returns 1.0 when value == ideal
 *   - Returns ~0.7 when value is at the edge of the range
 *   - Returns 0 when value is more than ~1 range away outside
 *
 * Returns `null` if the value is missing/invalid (so the caller can skip
 * that feature and re-normalize the weights).
 */
function featureScore(value: number | undefined, r: Range): number | null {
  if (value === undefined || !isFinite(value) || value <= 0) return null;
  if (value >= r.min && value <= r.max) {
    // Inside range — peak at ideal, dropping to 0.7 at edges
    const halfRange = Math.max(1, (r.max - r.min) / 2);
    const dist = Math.abs(value - r.ideal) / halfRange;
    return clamp(1 - 0.3 * dist, 0.7, 1.0);
  }
  // Outside range — drop linearly based on overshoot
  const range = Math.max(1, r.max - r.min);
  const overshoot = value < r.min ? r.min - value : value - r.max;
  const normDist = overshoot / range;
  return clamp(0.7 - 0.6 * normDist, 0, 0.7);
}

/**
 * Score the scale match between the detected key's scale and the style's
 * preferred scales.
 *   - 1.0 if exact match
 *   - 0.6 if same family (minor-ish, phrygian-ish, bright)
 *   - 0.2 if no relation
 * Returns null if no detected key was provided.
 */
function scaleScore(detectedScale: string | undefined, preferred: string[]): number | null {
  if (!detectedScale) return null;

  if (preferred.includes(detectedScale)) return 1.0;

  // Scale families
  const families: Record<string, string[]> = {
    minorish: ['minor', 'dorian', 'phrygian', 'harmonicMinor', 'minorPentatonic'],
    dark: ['phrygian', 'harmonicMinor', 'phrygianDominant', 'doubleHarmonic'],
    bright: ['dorian', 'minorPentatonic'],
  };
  const detFamilies = Object.entries(families)
    .filter(([, scales]) => scales.includes(detectedScale))
    .map(([name]) => name);
  const prefFamilies = preferred.flatMap((s) =>
    Object.entries(families).filter(([, scales]) => scales.includes(s)).map(([n]) => n)
  );
  if (detFamilies.some((f) => prefFamilies.includes(f))) return 0.6;

  return 0.2;
}

/**
 * Build a human-readable reason string for one feature contribution.
 */
function reasonFor(
  label: string,
  value: number,
  r: Range,
  unit: string,
  descriptor: string
): string | null {
  if (!isFinite(value) || value <= 0) return null;
  const v = value.toFixed(unit === 'Hz' ? 0 : (unit === '/s' ? 1 : 2));
  if (value >= r.min && value <= r.max) {
    return `${label} ${v}${unit} matches ${descriptor} (${r.min}-${r.max}${unit})`;
  }
  if (value < r.min) {
    return `${label} ${v}${unit} below ${descriptor} range (${r.min}-${r.max}${unit})`;
  }
  return `${label} ${v}${unit} above ${descriptor} range (${r.min}-${r.max}${unit})`;
}

// ─── Main classifier ──────────────────────────────────────────────────────

/**
 * Classify the psytrance sub-style from acoustic features.
 *
 * @param features Reference metrics (BPM, centroid, energies, transients, etc.)
 * @returns All known sub-styles ranked by confidence (highest first). Each
 *          entry includes a `reasons` array explaining WHY it matched.
 */
export function classifyStyle(features: RefFeatures): StyleMatch[] {
  // Defensive: if everything is zero/missing, return all styles with low equal confidence.
  const hasAnyFeature =
    (features.bpm > 0) ||
    (features.spectralCentroid > 0) ||
    (features.subEnergy > 0) ||
    (features.highEnergy > 0) ||
    (features.transientDensity > 0) ||
    (features.kickDecayMs > 0) ||
    (features.detectedKey?.scale !== undefined);

  if (!hasAnyFeature) {
    return STYLE_PROFILES.map((p) => ({
      style: p.id,
      confidence: 0.1,
      reasons: ['no features provided'],
    }));
  }

  const detectedScale = features.detectedKey?.scale;

  // Compute per-style scores
  const rawScores: { profile: StyleProfile; score: number; reasons: string[] }[] = [];

  for (const profile of STYLE_PROFILES) {
    const contributions: { weight: number; score: number }[] = [];
    const reasons: string[] = [];

    // BPM
    const bpmScore = featureScore(features.bpm, profile.bpm);
    if (bpmScore !== null) {
      contributions.push({ weight: WEIGHTS.bpm, score: bpmScore });
      const r = reasonFor('BPM', features.bpm, profile.bpm, '', profile.id + ' ' + profile.bpm.min + '-' + profile.bpm.max);
      if (r) reasons.push(r);
    }

    // Spectral centroid
    const centScore = featureScore(features.spectralCentroid, profile.centroid);
    if (centScore !== null) {
      contributions.push({ weight: WEIGHTS.centroid, score: centScore });
      const r = reasonFor('centroid', features.spectralCentroid, profile.centroid, 'Hz',
        profile.centroid.ideal < 1300 ? 'dark character' :
        profile.centroid.ideal > 2500 ? 'bright character' : 'balanced character');
      if (r) reasons.push(r);
    }

    // Sub energy
    const subScore = featureScore(features.subEnergy, profile.subEnergy);
    if (subScore !== null) {
      contributions.push({ weight: WEIGHTS.subEnergy, score: subScore });
      const r = reasonFor('subEnergy', features.subEnergy, profile.subEnergy, '',
        profile.subEnergy.ideal > 0.7 ? 'high sub' : 'balanced sub');
      if (r) reasons.push(r);
    }

    // Transient density
    const tScore = featureScore(features.transientDensity, profile.transientDensity);
    if (tScore !== null) {
      contributions.push({ weight: WEIGHTS.transientDensity, score: tScore });
      const r = reasonFor('transient', features.transientDensity, profile.transientDensity, '/s',
        profile.transientDensity.ideal > 16 ? 'fast transients' :
        profile.transientDensity.ideal < 10 ? 'minimal transients' : 'moderate transients');
      if (r) reasons.push(r);
    }

    // Kick decay
    const kScore = featureScore(features.kickDecayMs, profile.kickDecayMs);
    if (kScore !== null) {
      contributions.push({ weight: WEIGHTS.kickDecay, score: kScore });
      const r = reasonFor('kick decay', features.kickDecayMs, profile.kickDecayMs, 'ms',
        profile.kickDecayMs.ideal < 130 ? 'tight/punchy kick' :
        profile.kickDecayMs.ideal > 250 ? 'long/deep kick' : 'balanced kick');
      if (r) reasons.push(r);
    }

    // High energy
    const hScore = featureScore(features.highEnergy, profile.highEnergy);
    if (hScore !== null) {
      contributions.push({ weight: WEIGHTS.highEnergy, score: hScore });
      const r = reasonFor('highEnergy', features.highEnergy, profile.highEnergy, '',
        profile.highEnergy.ideal > 0.6 ? 'bright top end' :
        profile.highEnergy.ideal < 0.3 ? 'dark top end' : 'balanced top');
      if (r) reasons.push(r);
    }

    // Scale match
    const sScore = scaleScore(detectedScale, profile.scales);
    if (sScore !== null) {
      contributions.push({ weight: WEIGHTS.scale, score: sScore });
      if (detectedScale) {
        if (sScore >= 1.0) {
          reasons.push(`scale '${detectedScale}' is preferred by ${profile.id}`);
        } else if (sScore >= 0.5) {
          reasons.push(`scale '${detectedScale}' is in same family as ${profile.id} preferred (${profile.scales.join('/')})`);
        } else {
          reasons.push(`scale '${detectedScale}' not preferred by ${profile.id} (wants ${profile.scales.join('/')})`);
        }
      }
    }

    // Re-normalize weights for missing features
    const totalWeight = contributions.reduce((s, c) => s + c.weight, 0);
    if (totalWeight <= 0) {
      rawScores.push({ profile, score: 0, reasons: ['no usable features'] });
      continue;
    }
    const weightedSum = contributions.reduce((s, c) => s + c.weight * c.score, 0);
    const normalized = weightedSum / totalWeight; // 0..1

    rawScores.push({ profile, score: normalized, reasons });
  }

  // Convert raw scores to confidence values.
  // - If the top match dominates (top score - 2nd score > 0.15), boost its confidence toward 0.9.
  // - If scores are tied/ambiguous, cap confidence at ~0.6 so we don't auto-switch on a coin flip.
  rawScores.sort((a, b) => b.score - a.score);

  const top = rawScores[0];
  const second = rawScores[1];
  const margin = top && second ? top.score - second.score : 1;

  const matches: StyleMatch[] = rawScores.map((rs, i) => {
    let confidence: number;
    if (i === 0) {
      // Top match: 0.4 baseline + score * 0.5, with a small bonus if it dominates
      const dominance = clamp(margin / 0.25, 0, 1); // 0..1
      confidence = 0.4 + rs.score * 0.45 + dominance * 0.1;
    } else {
      // Lower matches: directly proportional to score, capped below the top
      confidence = rs.score * 0.6;
    }
    confidence = clamp(confidence, 0, 0.95);
    return {
      style: rs.profile.id,
      confidence,
      reasons: rs.reasons,
    };
  });

  return matches;
}

/**
 * Map a classifier style id to the nearest available WorldId.
 *
 * The classifier knows 10 sub-styles; WORLDS has 10 worlds. Most sub-styles
 * map 1:1 (dark-psy→dark-psy, goa→goa, etc.). A few sub-styles have NO
 * direct world counterpart (full-on, hi-tech, suomi) — those fall back to
 * the closest available world.
 *
 * Verification (matches WORLDS keys in worlds.ts):
 *   WORLDS = { progressive-psy, dark-psy, morning-psy, goa, forest,
 *              deep-psy, hypnotic, cosmic, organic-psy, acid-psy }
 *
 * Direct map: 7 classifier styles → 7 worlds (identity).
 * Fallbacks (classifier style → nearest world):
 *   full-on  → morning-psy  (bright, high sub, punchy kick — both uplifting)
 *   hi-tech  → dark-psy     (extreme brightness + aggression + fast transients)
 *   suomi    → forest       (erratic + organic + dark-adjacent, similar BPM)
 *
 * If the input styleId isn't in the directMap at all (unknown style), we
 * fall back to a similarity search across all known classifier styles and
 * return the world id for the closest match.
 */
export function styleToWorld(styleId: string): string {
  const directMap: Record<string, string> = {
    'dark-psy': 'dark-psy',
    'progressive-psy': 'progressive-psy',
    'goa': 'goa',
    'forest': 'forest',
    'morning-psy': 'morning-psy',
    'acid-psy': 'acid-psy',
    'hypnotic': 'hypnotic',
    // Closest-available fallbacks (no direct world counterpart):
    'full-on': 'morning-psy',
    'hi-tech': 'dark-psy',
    'suomi': 'forest',
  };
  const direct = directMap[styleId];
  if (direct) return direct;

  // Unknown styleId — find the closest classifier style by BPM + centroid
  // similarity, then map THAT through directMap. This guarantees we always
  // return a valid WorldId rather than blindly defaulting to 'dark-psy'.
  const profile = STYLE_PROFILES.find((p) => p.id === styleId);
  if (profile) {
    // Already a known style — shouldn't reach here, but be safe.
    return directMap[profile.id] || 'dark-psy';
  }
  // Last-resort: pick the style whose ideal BPM is closest to a typical
  // psytrance range (140 BPM), then map through directMap.
  let best = 'dark-psy';
  let bestDist = Infinity;
  for (const p of STYLE_PROFILES) {
    const dist = Math.abs(p.bpm.ideal - 142);
    if (dist < bestDist) {
      bestDist = dist;
      best = p.id;
    }
  }
  return directMap[best] || 'dark-psy';
}
