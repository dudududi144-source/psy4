/**
 * SynthesisMatcher — שלב 4.2
 *
 * מוצא SynthRecipe אופטימלי שמייצר סאונד דומה ל-SoundDNA יעד.
 *
 * תהליך:
 * 1. מקבל SoundDNA יעד + role
 * 2. בוחר voice class מתאים (KickVoice ל-kick, וכו')
 * 3. מגדיר פרמטרים לאופטימיזציה (לפי voice type)
 * 4. לכל קאנדידט: שולח 'renderVoice' ל-engine node הקיים → מקבל Float32Array → חילוץ features → חישוב distance
 * 5. אופטימיזציה: staged grid search (coarse → fine)
 * 6. מחזיר recipe + matchScore (1 / (1 + distance))
 *
 * ריצה: משתמש ב-engine node הקיים (engineNode) — לא יוצר AudioContext נפרד.
 * ה-rendering קורה ב-message handler של ה-engine processor (לא ב-process loop).
 */

import { type SoundDNA, type SynthRecipe } from '../../foundation/music/SoundDNA';
import { extractSpectralFeatures } from '../../foundation/music/MusicalObservation';
import { type OnsetRole } from './onsetAnalyzer';
import type { Psy4EngineNode } from './studio/engine/engineWorklet';

// ── Voice class per role ──────────────────────────────────────────────────
const ROLE_TO_VOICE: Record<OnsetRole, string> = {
  kick: 'KickVoice',
  bass: 'BassVoice',
  lead: 'LeadVoice',
  hat: 'HatVoice',
  perc: 'PercVoice',
};

// ── Default trigger args per role ─────────────────────────────────────────
const DEFAULT_TRIGGER_ARGS: Record<OnsetRole, object> = {
  kick: { amp: 1.0, fund: 55, decay: 0.2 },
  bass: { freq: 82, dur: 0.2, amp: 0.6, acid: false, params: null },
  lead: { freq: 440, amp: 0.5 },
  hat: { open: false, amp: 0.5 },
  perc: { freq: 200, amp: 0.5 },
};

// ── Parameters to optimize per role ──────────────────────────────────────
// כל פרמטר: שם, טווח, ברירת מחדל
interface OptParam {
  name: string;
  min: number;
  max: number;
  default: number;
}

const OPT_PARAMS: Record<OnsetRole, OptParam[]> = {
  // 4 פרמטרים מרכזיים ל-kick — שומר על grid size קטן (2^4 = 16 coarse)
  kick: [
    { name: 'fund', min: 45, max: 65, default: 55 },
    { name: 'startMult', min: 2.5, max: 5.0, default: 4.0 },
    { name: 'subDecay', min: 0.12, max: 0.28, default: 0.2 },
    { name: 'saturation', min: 1.2, max: 2.3, default: 1.8 },
  ],
  bass: [
    { name: 'subLevel', min: 0.35, max: 0.55, default: 0.45 },
    { name: 'cutoffStart', min: 600, max: 1200, default: 800 },
    { name: 'cutoffEnd', min: 150, max: 300, default: 200 },
    { name: 'cutoffDecay', min: 0.025, max: 0.06, default: 0.04 },
  ],
  lead: [
    { name: 'freq', min: 220, max: 880, default: 440 },
  ],
  hat: [
    // HatVoice — אין פרמטרים רציפים משמעותיים (decay נגזר מ-open/closed)
  ],
  perc: [
    { name: 'freq', min: 120, max: 350, default: 200 },
  ],
};

// ── Render result ─────────────────────────────────────────────────────────
export interface MatchResult {
  recipe: SynthRecipe;
  matchScore: number;     // 0..1 (1 = perfect match)
  distance: number;       // raw distance (lower = better)
  iterations: number;     // כמה קאנדידטים נבדקו
  targetDNA: SoundDNA;
  candidateDNA: SoundDNA; // features של הסאונד המסונטז
}

const RENDER_DURATION = 0.08; // 80ms — מספיק ל-kick/bass/perc transient + decay
const MAX_ITERATIONS = 25;
const TARGET_DISTANCE = 0.25; // matchScore > 0.8

export class SynthesisMatcher {
  private engineNode: Psy4EngineNode | null = null;
  private ready = false;
  // DFT precomputed tables (cached for speed)
  private _cosTable: Float32Array | null = null;
  private _sinTable: Float32Array | null = null;

  /**
   * אתחול — מקבל reference ל-engine node הקיים.
   */
  init(engineNode: Psy4EngineNode): void {
    this.engineNode = engineNode;
    this.ready = true;
    console.log('[PSY4] שלב 4.2 SynthesisMatcher ready (using engine node)');
  }

  /**
   * מרנדר voice בודד עם params נתונים ומחזיר Float32Array.
   * שולח 'renderVoice' ל-engine node וממתין ל-'renderVoiceDone'.
   */
  private renderVoice(
    voiceClass: string,
    params: Record<string, number>,
    triggerArgs: object,
  ): Promise<Float32Array> {
    return new Promise((resolve, reject) => {
      if (!this.engineNode || !this.engineNode.node) {
        reject(new Error('SynthesisMatcher: engine node not set'));
        return;
      }
      const port = this.engineNode.node.port;
      const handler = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type !== 'renderVoiceDone') return;
        port.removeEventListener('message', handler);
        if (msg.error) reject(new Error(msg.error));
        else if (!msg.buffer) reject(new Error('Empty buffer'));
        else resolve(msg.buffer as Float32Array);
      };
      port.addEventListener('message', handler);
      port.postMessage({
        type: 'renderVoice',
        voiceClass,
        params,
        triggerArgs,
        duration: RENDER_DURATION,
      });
    });
  }

  /**
   * חילוץ SoundDNA מ-buffer מרונדר.
   * משתמש באותן פונקציות כמו OnsetAnalyzer כדי לשמור על feature parity.
   */
  private extractFeaturesFromBuffer(buffer: Float32Array, sampleRate: number): SoundDNA {
    // DFT ידני עם טבלאות cos/sin precomputed — FFT size 256 (מהיר יותר)
    const fftSize = 256;
    const n = Math.min(buffer.length, fftSize);
    // Precompute cos/sin tables (cached per instance)
    if (!this._cosTable || this._cosTable.length !== fftSize * fftSize / 2) {
      this._cosTable = new Float32Array(fftSize * fftSize / 2);
      this._sinTable = new Float32Array(fftSize * fftSize / 2);
      for (let k = 0; k < fftSize / 2; k++) {
        for (let i = 0; i < fftSize; i++) {
          const angle = -2 * Math.PI * k * i / fftSize;
          this._cosTable[k * fftSize + i] = Math.cos(angle);
          this._sinTable[k * fftSize + i] = Math.sin(angle);
        }
      }
    }
    // חלון Hann
    const windowed = new Float32Array(fftSize);
    for (let i = 0; i < n; i++) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
      windowed[i] = buffer[i] * w;
    }
    // DFT עם precomputed tables
    const numBins = fftSize / 2;
    const magnitudes = new Float32Array(numBins);
    for (let k = 0; k < numBins; k++) {
      let re = 0, im = 0;
      const cosRow = this._cosTable;
      const sinRow = this._sinTable;
      const offset = k * fftSize;
      for (let i = 0; i < fftSize; i++) {
        re += windowed[i] * cosRow[offset + i];
        im += windowed[i] * sinRow[offset + i];
      }
      magnitudes[k] = Math.sqrt(re * re + im * im) / (fftSize / 2);
    }
    // נרמל ל-0..255
    let maxMag = 0;
    for (let i = 0; i < numBins; i++) if (magnitudes[i] > maxMag) maxMag = magnitudes[i];
    const fd = new Uint8Array(numBins);
    if (maxMag > 0) {
      for (let i = 0; i < numBins; i++) fd[i] = Math.min(255, Math.round(magnitudes[i] / maxMag * 255));
    }
    const spec = extractSpectralFeatures(fd, sampleRate, fftSize);

    // ── Time-domain features ──
    let peak = 0, sumSq = 0;
    for (let i = 0; i < buffer.length; i++) {
      const v = Math.abs(buffer[i]);
      if (v > peak) peak = v;
      sumSq += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sumSq / buffer.length);
    const quarterLen = Math.floor(buffer.length / 4);
    let q1 = 0, q2 = 0, q3 = 0, q4 = 0;
    for (let i = 0; i < quarterLen; i++) q1 += buffer[i] * buffer[i];
    for (let i = quarterLen; i < 2 * quarterLen; i++) q2 += buffer[i] * buffer[i];
    for (let i = 2 * quarterLen; i < 3 * quarterLen; i++) q3 += buffer[i] * buffer[i];
    for (let i = 3 * quarterLen; i < 4 * quarterLen; i++) q4 += buffer[i] * buffer[i];
    const q1Rms = Math.sqrt(q1 / quarterLen);
    const q2Rms = Math.sqrt(q2 / quarterLen);
    const q3Rms = Math.sqrt(q3 / quarterLen);
    const q4Rms = Math.sqrt(q4 / quarterLen);
    const peakRms = Math.max(q1Rms, q2Rms, q3Rms, q4Rms);
    let transientSharpness: number;
    if (peakRms < 1e-6) {
      transientSharpness = 0;
    } else {
      const peakIdx = [q1Rms, q2Rms, q3Rms, q4Rms].indexOf(peakRms);
      transientSharpness = 1.0 - peakIdx * 0.25;
    }
    let decayTime: number;
    if (peakRms < 1e-6) {
      decayTime = 0.1;
    } else {
      const threshold10 = peakRms * 0.316;
      let decayQuarter = 3;
      if (q3Rms < threshold10) decayQuarter = 2;
      if (q2Rms < threshold10) decayQuarter = 1;
      decayTime = (decayQuarter + 1) * (quarterLen / sampleRate);
    }
    const sustainLevel = peakRms > 1e-6 ? Math.min(1, q4Rms / peakRms) : 0;
    const attackTime = 0.001 + (1 - transientSharpness) * 0.02;
    const releaseTime = 0.05 + (1 - transientSharpness) * 0.2;

    const brightness = Math.max(0, Math.min(1, spec.centroid / 8000));
    const noisiness = Math.max(0, Math.min(1, spec.flatness));
    const harmonicity = 1 - noisiness;
    const saturation = Math.max(0, Math.min(1, noisiness * 0.6 + (peak > 0.9 ? 0.3 : 0)));

    return {
      role: 'fx',
      brightness,
      harmonicity,
      noisiness,
      spectralSlope: -0.5 - brightness * 0.3,
      roughness: noisiness * 0.5,
      subEnergy: Math.max(0, Math.min(1, spec.low)),
      bodyEnergy: Math.max(0, Math.min(1, spec.low * 0.7)),
      midEnergy: Math.max(0, Math.min(1, spec.mid)),
      highEnergy: Math.max(0, Math.min(1, spec.high)),
      transientSharpness,
      attackTime,
      decayTime,
      sustainLevel,
      releaseTime,
      saturation,
      distortionCharacter: noisiness,
      filterCutoff: 0,
      filterResonance: 0,
      filterType: 'lowpass',
      filterEnvelopeAmount: 0.3,
      pitchModulation: 0,
      fmAmount: 0,
      detune: 0,
      stereoWidth: 0,
      stereoMotion: 0,
      confidence: Math.min(1, peak * 2),
      usageCount: 0,
      reward: 0.5,
      sourceStyle: '',
      sourceContext: '',
    };
  }

  /**
   * מרחק ספקטרלי בין שני SoundDNA.
   * משתמש במשקלים שונים לפי חשיבות הפיצ'ר.
   */
  private computeDistance(target: SoundDNA, candidate: SoundDNA): number {
    const weights = {
      brightness: 1.5,
      transientSharpness: 1.5,
      subEnergy: 1.2,
      midEnergy: 1.0,
      highEnergy: 1.0,
      noisiness: 0.8,
      harmonicity: 0.8,
      attackTime: 0.8,
      decayTime: 0.8,
      sustainLevel: 0.5,
      saturation: 0.5,
    };
    let sumSq = 0;
    let sumW = 0;
    for (const key of Object.keys(weights) as (keyof typeof weights)[]) {
      const w = weights[key];
      const diff = (target as any)[key] - (candidate as any)[key];
      sumSq += w * diff * diff;
      sumW += w;
    }
    return Math.sqrt(sumSq / sumW);
  }

  /**
   * בניית SynthRecipe מ-params שנמצאו.
   */
  private buildRecipe(role: OnsetRole, params: Record<string, number>): SynthRecipe {
    // נרמל params ל-SynthRecipe fields
    const brightness = (params.fund ?? 55 - 45) / (70 - 45); // heuristic
    return {
      oscType: role === 'kick' ? 'sine' : role === 'bass' ? 'sawtooth' : role === 'lead' ? 'sawtooth' : 'square',
      oscLayers: 1,
      detune: 0,
      fmAmount: 0,
      filterType: 'lowpass',
      filterCutoff: params.cutoffStart ?? 800,
      filterResonance: params.resonance ?? 1,
      filterEnvAmount: 0.5,
      attackTime: 0.001,
      decayTime: params.subDecay ?? params.cutoffDecay ?? 0.2,
      sustainLevel: 0.3,
      releaseTime: 0.1,
      saturationAmount: params.saturation ?? 0.4,
      stereoWidth: 0,
      subLevel: params.subLevel ?? 0.45,
      bodyLevel: params.subLevel ?? 0.45,
      harmonicLevel: params.harmonicLevel ?? 0.55,
    };
  }

  /**
   * match — מוצא recipe אופטימלי ל-SoundDNA יעד.
   * אלגוריתם: staged grid search (coarse 3 values → refine 3 values around best).
   */
  async match(targetDNA: SoundDNA, role: OnsetRole): Promise<MatchResult> {
    if (!this.ready || !this.engineNode) {
      throw new Error('SynthesisMatcher not initialized — call init(engineNode) first');
    }
    const sr = 44100; // ה-engine תמיד רץ ב-44100
    const voiceClass = ROLE_TO_VOICE[role];
    const optParams = OPT_PARAMS[role];
    const triggerArgs = { ...DEFAULT_TRIGGER_ARGS[role] };
    if (optParams.length === 0) {
      // אין פרמטרים לאופטימז — רק render עם defaults
      const buffer = await this.renderVoice(voiceClass, {}, triggerArgs);
      const candidateDNA = this.extractFeaturesFromBuffer(buffer, sr);
      const distance = this.computeDistance(targetDNA, candidateDNA);
      return {
        recipe: this.buildRecipe(role, {}),
        matchScore: 1 / (1 + distance),
        distance,
        iterations: 1,
        targetDNA,
        candidateDNA,
      };
    }

    // ── Stage 1: Coarse grid — 2 values (min/max) per param ──
    // 2^4 = 16 candidates for kick — fast
    const coarseValues: Record<string, number[]> = {};
    for (const p of optParams) {
      coarseValues[p.name] = [p.min, p.max];
    }
    let bestParams: Record<string, number> = {};
    for (const p of optParams) bestParams[p.name] = p.default;
    let bestDistance = Infinity;
    let bestCandidateDNA: SoundDNA | null = null;
    let iterations = 0;

    // Grid search — עובר על כל הקומבינציות
    const gridSearch = (values: Record<string, number[]>, current: Record<string, number>, idx: number) => {
      if (idx >= optParams.length) {
        return [{ ...current }];
      }
      const p = optParams[idx];
      const results: Record<string, number>[] = [];
      for (const v of values[p.name]) {
        current[p.name] = v;
        results.push(...gridSearch(values, current, idx + 1));
      }
      return results;
    };
    const coarseCandidates = gridSearch(coarseValues, {}, 0);
    // אם יותר מ-MAX_ITERATIONS, דגום randomly
    const sampled = coarseCandidates.length > MAX_ITERATIONS
      ? coarseCandidates.filter((_, i) => i % Math.ceil(coarseCandidates.length / MAX_ITERATIONS) === 0).slice(0, MAX_ITERATIONS)
      : coarseCandidates;

    for (const candidate of sampled) {
      iterations++;
      if (iterations > MAX_ITERATIONS) break;
      try {
        const buffer = await this.renderVoice(voiceClass, candidate, { ...triggerArgs });
        if (!buffer || buffer.length === 0) continue;
        const candidateDNA = this.extractFeaturesFromBuffer(buffer, sr);
        const distance = this.computeDistance(targetDNA, candidateDNA);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestParams = { ...candidate };
          bestCandidateDNA = candidateDNA;
        }
        if (bestDistance < TARGET_DISTANCE) break;
      } catch (err) {
        // דלג על קאנדידט שנכשל
        continue;
      }
    }

    // ── Stage 2: Fine grid — 3 values around best (±25% of range) ──
    if (bestCandidateDNA && bestDistance >= TARGET_DISTANCE && iterations < MAX_ITERATIONS) {
      const fineValues: Record<string, number[]> = {};
      for (const p of optParams) {
        const best = bestParams[p.name];
        const range = p.max - p.min;
        const step = range * 0.25;
        fineValues[p.name] = [
          Math.max(p.min, best - step),
          best,
          Math.min(p.max, best + step),
        ];
      }
      const fineCandidates = gridSearch(fineValues, {}, 0);
      for (const candidate of fineCandidates) {
        iterations++;
        if (iterations > MAX_ITERATIONS) break;
        try {
          const buffer = await this.renderVoice(voiceClass, candidate, { ...triggerArgs });
          if (!buffer || buffer.length === 0) continue;
          const candidateDNA = this.extractFeaturesFromBuffer(buffer, sr);
          const distance = this.computeDistance(targetDNA, candidateDNA);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestParams = { ...candidate };
            bestCandidateDNA = candidateDNA;
          }
          if (bestDistance < TARGET_DISTANCE) break;
        } catch {
          continue;
        }
      }
    }

    const matchScore = 1 / (1 + bestDistance);
    const recipe = this.buildRecipe(role, bestParams);
    console.log(
      `[PSY4] שלב 4.2 match(${role}): distance=${bestDistance.toFixed(3)} ` +
      `matchScore=${matchScore.toFixed(3)} iterations=${iterations} ` +
      `params=${JSON.stringify(bestParams)}`,
    );
    return {
      recipe,
      matchScore,
      distance: bestDistance,
      iterations,
      targetDNA,
      candidateDNA: bestCandidateDNA ?? this.extractFeaturesFromBuffer(new Float32Array(RENDER_DURATION * 44100), 44100),
    };
  }

  /**
   * סגירה — מנתק את ה-reference ל-engine node.
   */
  dispose(): void {
    this.engineNode = null;
    this.ready = false;
  }
}
