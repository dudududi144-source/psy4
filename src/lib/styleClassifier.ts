/**
 * StyleClassifier — שלב 4.6: Musical style detection from radio features.
 *
 * מחליף את classifyStyle הפרימיטיבי ב-classifier מבוסס distance ל-templates.
 * תומך ב-6 סגנונות ידועים + זיהוי "unknown" לאיסוף סאונדים חדשים.
 *
 * תהליך:
 * 1. אוסף features מהרדיו (BPM, occupancy, spectral centroid/flatness/energy)
 * 2. משווה ל-6 templates באמצעות weighted Euclidean distance
 * 3. אם ה-distance הקרוב ביותר < סף → מזהה את ה-style
 * 4. אם לא → "UNKNOWN" (יאסף כ-sourceStyle: 'unknown-N')
 */

export type RadioStyle =
  | 'fullOn' | 'dark' | 'progressive' | 'acid' | 'forest' | 'hiTech'
  | 'unknown';

export interface StyleFeatures {
  bpm: number;
  occupancy: { kick: number; bass: number; lead: number; hats: number };
  centroid: number;    // Hz (EMA-smoothed)
  flatness: number;    // 0..1 (EMA-smoothed)
  energy: number;      // 0..1 (EMA-smoothed)
  energySlope: number; // -1..1
}

interface StyleTemplate {
  name: RadioStyle;
  bpm: { min: number; max: number; ideal: number };
  kick: { min: number; max: number; ideal: number };
  bass: { min: number; max: number; ideal: number };
  lead: { min: number; max: number; ideal: number };
  hats: { min: number; max: number; ideal: number };
  centroid: { min: number; max: number; ideal: number }; // Hz
  flatness: { min: number; max: number; ideal: number }; // 0..1
  energy: { min: number; max: number; ideal: number };   // 0..1
  description: string;
}

// ── 6 Style Templates ──────────────────────────────────────────────────────
// מבוסס על מאפיינים אופייניים של כל סגנון פסייטראנס:
const STYLE_TEMPLATES: StyleTemplate[] = [
  {
    name: 'fullOn',
    description: 'Full-On: fast, dense, bright — peak-time psytrance',
    bpm: { min: 140, max: 148, ideal: 145 },
    kick: { min: 0.6, max: 1.0, ideal: 0.8 },
    bass: { min: 0.5, max: 1.0, ideal: 0.75 },
    lead: { min: 0.3, max: 0.9, ideal: 0.6 },
    hats: { min: 0.3, max: 0.9, ideal: 0.6 },
    centroid: { min: 2000, max: 6000, ideal: 4000 },
    flatness: { min: 0.2, max: 0.6, ideal: 0.4 },
    energy: { min: 0.5, max: 1.0, ideal: 0.75 },
  },
  {
    name: 'dark',
    description: 'Dark Psy: slow, heavy bass, sparse highs — hypnotic',
    bpm: { min: 130, max: 145, ideal: 138 },
    kick: { min: 0.5, max: 0.9, ideal: 0.7 },
    bass: { min: 0.6, max: 1.0, ideal: 0.85 },
    lead: { min: 0.1, max: 0.5, ideal: 0.3 },
    hats: { min: 0.05, max: 0.35, ideal: 0.2 },
    centroid: { min: 800, max: 2500, ideal: 1500 },
    flatness: { min: 0.1, max: 0.4, ideal: 0.25 },
    energy: { min: 0.4, max: 0.8, ideal: 0.6 },
  },
  {
    name: 'progressive',
    description: 'Progressive: moderate tempo, balanced, steady build',
    bpm: { min: 128, max: 138, ideal: 133 },
    kick: { min: 0.3, max: 0.7, ideal: 0.5 },
    bass: { min: 0.3, max: 0.7, ideal: 0.5 },
    lead: { min: 0.2, max: 0.6, ideal: 0.4 },
    hats: { min: 0.2, max: 0.6, ideal: 0.4 },
    centroid: { min: 1500, max: 4000, ideal: 2500 },
    flatness: { min: 0.2, max: 0.5, ideal: 0.35 },
    energy: { min: 0.3, max: 0.7, ideal: 0.5 },
  },
  {
    name: 'acid',
    description: 'Acid: mid-heavy, resonant 303 squelches, high energy',
    bpm: { min: 135, max: 150, ideal: 142 },
    kick: { min: 0.4, max: 0.8, ideal: 0.6 },
    bass: { min: 0.4, max: 0.8, ideal: 0.6 },
    lead: { min: 0.5, max: 1.0, ideal: 0.75 },
    hats: { min: 0.2, max: 0.6, ideal: 0.4 },
    centroid: { min: 2500, max: 6000, ideal: 4000 },
    flatness: { min: 0.3, max: 0.7, ideal: 0.5 },
    energy: { min: 0.5, max: 0.9, ideal: 0.7 },
  },
  {
    name: 'forest',
    description: 'Forest: fast, organic, mid-range focus, atmospheric',
    bpm: { min: 145, max: 160, ideal: 152 },
    kick: { min: 0.5, max: 0.9, ideal: 0.7 },
    bass: { min: 0.5, max: 0.9, ideal: 0.7 },
    lead: { min: 0.3, max: 0.7, ideal: 0.5 },
    hats: { min: 0.3, max: 0.7, ideal: 0.5 },
    centroid: { min: 1800, max: 4500, ideal: 3000 },
    flatness: { min: 0.3, max: 0.6, ideal: 0.45 },
    energy: { min: 0.4, max: 0.8, ideal: 0.6 },
  },
  {
    name: 'hiTech',
    description: 'Hi-Tech: very fast, aggressive, bright, maximalist',
    bpm: { min: 148, max: 170, ideal: 155 },
    kick: { min: 0.6, max: 1.0, ideal: 0.85 },
    bass: { min: 0.5, max: 1.0, ideal: 0.8 },
    lead: { min: 0.4, max: 1.0, ideal: 0.7 },
    hats: { min: 0.4, max: 1.0, ideal: 0.7 },
    centroid: { min: 3000, max: 7000, ideal: 5000 },
    flatness: { min: 0.4, max: 0.8, ideal: 0.6 },
    energy: { min: 0.6, max: 1.0, ideal: 0.85 },
  },
];

// ── Distance weights per feature ──────────────────────────────────────────
const WEIGHTS = {
  bpm: 1.5,
  kick: 1.0,
  bass: 1.2,
  lead: 0.8,
  hats: 0.8,
  centroid: 1.0,
  flatness: 0.6,
  energy: 0.8,
};

// סף לזיהוי — distance מעל זה אומר "unknown"
const UNKNOWN_THRESHOLD = 2.5;

export interface ClassificationResult {
  style: RadioStyle;
  confidence: number;     // 0..1 (1 = קרוב מאוד ל-template)
  distance: number;       // raw distance (lower = better)
  closestTemplate: RadioStyle | 'unknown';
  unknownIndex?: number;  // אם unknown, איזה מספר
}

export class StyleClassifier {
  private lastStyle: RadioStyle = 'unknown';
  private styleStableSince: number = 0;
  private static readonly STABILITY_DURATION_MS = 5000; // 5s לפני שינוי style
  private unknownCounter: number = 0;
  private lastUnknownTime: number = 0;
  private static readonly UNKNOWN_NEW_INTERVAL_MS = 300000; // 5 דקות בין unknown-N חדשים

  /**
   * מסווג את ה-style הנוכחי מתוך features.
   * משתמש ב-hysteresis — style צריך להיות יציב 5 שניות לפני שינוי.
   */
  classify(features: StyleFeatures): ClassificationResult {
    // חשב distance לכל template
    const distances = STYLE_TEMPLATES.map(tpl => ({
      template: tpl,
      distance: this.computeDistance(features, tpl),
    }));
    distances.sort((a, b) => a.distance - b.distance);
    const closest = distances[0];
    const isUnknown = closest.distance > UNKNOWN_THRESHOLD;
    const detectedStyle: RadioStyle = isUnknown ? 'unknown' : closest.template.name;

    // Hysteresis: רק שנה style אם הוא יציב 5 שניות
    const now = Date.now();
    if (detectedStyle !== this.lastStyle) {
      if (this.styleStableSince === 0) {
        this.styleStableSince = now;
      } else if (now - this.styleStableSince >= StyleClassifier.STABILITY_DURATION_MS) {
        this.lastStyle = detectedStyle;
        this.styleStableSince = 0;
        if (detectedStyle === 'unknown') {
          this.maybeIncrementUnknown(now);
        }
      }
    } else {
      this.styleStableSince = 0;
    }

    // confidence: 1 - (distance / threshold), clamped 0..1
    const confidence = Math.max(0, Math.min(1, 1 - (closest.distance / UNKNOWN_THRESHOLD)));

    return {
      style: this.lastStyle,
      confidence,
      distance: closest.distance,
      closestTemplate: isUnknown ? 'unknown' : closest.template.name,
      unknownIndex: this.lastStyle === 'unknown' ? this.unknownCounter : undefined,
    };
  }

  /**
   * אם עברו 5 דקות מה-unknown האחרון, הגדל את ה-counter.
   */
  private maybeIncrementUnknown(now: number): void {
    if (now - this.lastUnknownTime > StyleClassifier.UNKNOWN_NEW_INTERVAL_MS) {
      this.unknownCounter++;
      this.lastUnknownTime = now;
      console.log(`[PSY4] שלב 4.6 StyleClassifier: new unknown style detected — unknown-${this.unknownCounter}`);
    } else {
      this.lastUnknownTime = now;
    }
  }

  /**
   * weighted Euclidean distance בין features ל-template.
   * כל feature מנורמל ל-0..1 לפי הטווח שלו ב-template.
   */
  private computeDistance(features: StyleFeatures, tpl: StyleTemplate): number {
    let sumSq = 0;
    let sumW = 0;

    // BPM
    const bpmRange = tpl.bpm.max - tpl.bpm.min;
    const bpmDiff = Math.abs(features.bpm - tpl.bpm.ideal) / Math.max(1, bpmRange);
    sumSq += WEIGHTS.bpm * bpmDiff * bpmDiff;
    sumW += WEIGHTS.bpm;

    // Occupancy
    const occFeatures: { val: number; tpl: { min: number; max: number; ideal: number }; weight: number }[] = [
      { val: features.occupancy.kick, tpl: tpl.kick, weight: WEIGHTS.kick },
      { val: features.occupancy.bass, tpl: tpl.bass, weight: WEIGHTS.bass },
      { val: features.occupancy.lead, tpl: tpl.lead, weight: WEIGHTS.lead },
      { val: features.occupancy.hats, tpl: tpl.hats, weight: WEIGHTS.hats },
    ];
    for (const f of occFeatures) {
      const range = f.tpl.max - f.tpl.min;
      const diff = Math.abs(f.val - f.tpl.ideal) / Math.max(0.1, range);
      sumSq += f.weight * diff * diff;
      sumW += f.weight;
    }

    // Spectral
    const centroidRange = tpl.centroid.max - tpl.centroid.min;
    const centroidDiff = Math.abs(features.centroid - tpl.centroid.ideal) / Math.max(1, centroidRange);
    sumSq += WEIGHTS.centroid * centroidDiff * centroidDiff;
    sumW += WEIGHTS.centroid;

    const flatnessRange = tpl.flatness.max - tpl.flatness.min;
    const flatnessDiff = Math.abs(features.flatness - tpl.flatness.ideal) / Math.max(0.1, flatnessRange);
    sumSq += WEIGHTS.flatness * flatnessDiff * flatnessDiff;
    sumW += WEIGHTS.flatness;

    const energyRange = tpl.energy.max - tpl.energy.min;
    const energyDiff = Math.abs(features.energy - tpl.energy.ideal) / Math.max(0.1, energyRange);
    sumSq += WEIGHTS.energy * energyDiff * energyDiff;
    sumW += WEIGHTS.energy;

    return Math.sqrt(sumSq / sumW);
  }

  /**
   * ה-style הנוכחי (לאחר hysteresis).
   */
  getCurrentStyle(): RadioStyle {
    return this.lastStyle;
  }

  /**
   * מספר ה-unknown הנוכחי (ל-sourceStyle).
   */
  getUnknownIndex(): number {
    return this.unknownCounter;
  }

  /**
   * ה-sourceStyle לשמירה ב-bank — אם unknown, מחזיר 'unknown-N'.
   */
  getSourceStyleForBank(): string {
    if (this.lastStyle === 'unknown') {
      return `unknown-${this.unknownCounter}`;
    }
    return this.lastStyle;
  }

  /**
   * רשימת כל ה-templates (ל-UI/debugging).
   */
  getTemplates(): { name: RadioStyle; description: string }[] {
    return STYLE_TEMPLATES.map(t => ({ name: t.name, description: t.description }));
  }

  reset(): void {
    this.lastStyle = 'unknown';
    this.styleStableSince = 0;
    this.unknownCounter = 0;
    this.lastUnknownTime = 0;
  }
}
