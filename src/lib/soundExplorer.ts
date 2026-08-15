/**
 * SoundExplorer — שלב 4.4: למידה חכמה של סאונדים.
 *
 * הרעיון: במקום לחכות ל-onsets אקראיים מהרדיו ולהתאים רק אליהם,
 * ה-Explorer סורק את מרחב הפרמטרים של כל voice באופן יזום ורחב,
 * ומשווה כל קאנדידט ל-onset האחרון מהרדיו (היעד ה"חי").
 *
 * תהליך:
 * 1. מקבל role + onset יעד אחרון מהרדיו
 * 2. מחלק את מרחב הפרמטרים ל-grid רחב (יותר נקודות מה-grid search הרגיל)
 * 3. מרנדר כל קאנדידט, מחלץ features, מחשב distance ליעד
 * 4. שומר את N הקאנדידטים הטובים ביותר ל-sound bank (עם matchScore)
 * 5. כך ה-bank נבנה עם סאונדים מגוונים שכולם קרובים ליעד
 *
 * הבדל מ-SynthesisMatcher:
 * - SynthesisMatcher: מוצא recipe אחד אופטימלי (grid search ממוקד)
 * - SoundExplorer: סורק רחב, שומר N קאנדידטים, מגוון את ה-bank
 *
 * שימוש: ריצה אחת ל-30 שניות לכל role פעיל, ברקע.
 */

import { type SoundDNA, type SynthRecipe } from '../../foundation/music/SoundDNA';
import { type OnsetRole } from './onsetAnalyzer';
import { SynthesisMatcher, type MatchResult } from './synthesisMatcher';
import { SoundBank } from './soundBank';

// מפה: role → voice class (עבור שמירה ב-bank)
const ROLE_TO_VOICE: Record<OnsetRole, string> = {
  kick: 'KickVoice',
  bass: 'BassVoice',
  lead: 'LeadVoice',
  hat: 'HatVoice',
  perc: 'PercVoice',
  pad: 'PadVoice',
  acid: 'AcidVoice',
  clap: 'ClapVoice',
  shaker: 'ShakerVoice',
  texture: 'TextureVoice',
};

// פרמטרים לסריקה רחבה — 3 ערכים per פרמטר = 3^4 = 81 קאנדידטים ל-kick
interface ScanParam {
  name: string;
  values: number[];
}

const SCAN_PARAMS: Record<OnsetRole, ScanParam[]> = {
  kick: [
    { name: 'fund', values: [38, 48, 58, 68] },
    { name: 'saturation', values: [1.0, 1.5, 2.0] },
    { name: 'bodyLevel', values: [0.3, 0.6] },
    { name: 'bodyFreq', values: [180, 250] },
    { name: 'tailLevel', values: [0.2, 0.5] },
    { name: 'tailDecay', values: [0.3, 0.6] },
  ],
  bass: [
    { name: 'subLevel', values: [0.30, 0.40, 0.50, 0.60] },
    { name: 'cutoffStart', values: [400, 700, 1000, 1500] },
    { name: 'cutoffEnd', values: [100, 200, 300, 400] },
    { name: 'cutoffDecay', values: [0.02, 0.04, 0.06, 0.08] },
    { name: 'harmonicLevel2', values: [0.1, 0.2, 0.3] },
  ],
  lead: [
    { name: 'freq', values: [220, 330, 440, 660, 880] },
  ],
  hat: [
    { name: 'hatDecay', values: [0.02, 0.04, 0.06, 0.08] },
    { name: 'hatBrightness', values: [0.5, 1.0, 1.5, 2.0] },
  ],
  perc: [
    { name: 'freq', values: [120, 200, 300, 400] },
  ],
  pad: [
    { name: 'padCutoff', values: [400, 600, 800, 1000] },
    { name: 'padAttack', values: [0.2, 0.3, 0.4, 0.5] },
  ],
  acid: [
    { name: 'acidCutoff', values: [1000, 1500, 2000, 2500] },
    { name: 'acidResonance', values: [0.6, 0.7, 0.8, 0.9] },
  ],
  clap: [
    { name: 'clapDecay', values: [0.03, 0.05, 0.07, 0.09] },
  ],
  shaker: [
    { name: 'shakerDecay', values: [0.04, 0.06, 0.08, 0.10] },
  ],
  texture: [
    { name: 'textureType', values: [0, 1] },
  ],
};

const MAX_SCAN_RESULTS = 5; // שמור 5 הקרובים ביותר per role
const DISTANCE_THRESHOLD = 0.6; // רק קאנדידטים עם distance < 0.6 נשמרים (matchScore > 0.625)

export interface ExplorationResult {
  role: OnsetRole;
  scanned: number;       // כמה קאנדידטים נסרקו
  saved: number;         // כמה נשמרו ל-bank
  bestDistance: number;
  bestMatchScore: number;
  duration_ms: number;
}

export class SoundExplorer {
  private matcher: SynthesisMatcher;
  private bank: SoundBank;

  constructor(matcher: SynthesisMatcher, bank: SoundBank) {
    this.matcher = matcher;
    this.bank = bank;
  }

  /**
   * סריקה רחבה של מרחב הפרמטרים עבור role.
   * משווה כל קאנדידט ל-targetDNA (מהרדיו).
   * שומר את N הקרובים ביותר ל-sound bank.
   */
  async explore(
    role: OnsetRole,
    targetDNA: SoundDNA,
    sourceStyle: string,
  ): Promise<ExplorationResult> {
    const t0 = performance.now();
    const scanParams = SCAN_PARAMS[role];
    if (scanParams.length === 0) {
      return {
        role, scanned: 0, saved: 0,
        bestDistance: Infinity, bestMatchScore: 0,
        duration_ms: Math.round(performance.now() - t0),
      };
    }

    // בנה את כל הקומבינציות
    const combos = this.buildCombinations(scanParams, 0, {});
    console.log(`[PSY4] שלב 4.4 SoundExplorer(${role}): scanning ${combos.length} candidates against radio target`);

    const results: { params: Record<string, number>; distance: number; matchScore: number; candidateDNA: SoundDNA }[] = [];

    for (const params of combos) {
      try {
        // השתמש ב-matcher כדי לרנדר ולחלץ features
        // אבל matcher.match עושה optimization משלו — אנחנו רוצים רק render + extract
        // פתרון: קרא ל-renderVoice ישירות דרך ה-matcher
        const buffer = await (this.matcher as any).renderVoice(ROLE_TO_VOICE[role], params, this.getDefaultTriggerArgs(role));
        if (!buffer || buffer.length === 0) continue;
        const candidateDNA = (this.matcher as any).extractFeaturesFromBuffer(buffer, 44100);
        const distance = (this.matcher as any).computeDistance(targetDNA, candidateDNA);
        const matchScore = 1 / (1 + distance);
        results.push({ params, distance, matchScore, candidateDNA });
      } catch {
        continue;
      }
    }

    // מיין לפי distance (הכי נמוך = הכי טוב)
    results.sort((a, b) => a.distance - b.distance);

    // שמור את N הטובים ביותר (עם distance < threshold)
    let saved = 0;
    let bestDistance = results.length > 0 ? results[0].distance : Infinity;
    let bestMatchScore = results.length > 0 ? results[0].matchScore : 0;

    for (let i = 0; i < Math.min(MAX_SCAN_RESULTS, results.length); i++) {
      const r = results[i];
      if (r.distance >= DISTANCE_THRESHOLD) break; // רק קרובים
      // בנה recipe מ-params
      const recipe = this.buildRecipe(role, r.params);
      // שמור ל-bank עם voiceParams הגולמיים
      try {
        await this.bank.add(role, targetDNA, recipe, r.matchScore, sourceStyle, r.params);
        saved++;
      } catch (e) {
        console.warn('[PSY4] SoundExplorer save failed:', e);
      }
    }

    const duration_ms = Math.round(performance.now() - t0);
    console.log(
      `[PSY4] שלב 4.4 SoundExplorer(${role}) done: scanned=${results.length} ` +
      `saved=${saved} bestDistance=${bestDistance.toFixed(3)} ` +
      `bestMatchScore=${bestMatchScore.toFixed(3)} duration=${duration_ms}ms`,
    );

    return {
      role,
      scanned: results.length,
      saved,
      bestDistance,
      bestMatchScore,
      duration_ms,
    };
  }

  private buildCombinations(
    params: ScanParam[],
    idx: number,
    current: Record<string, number>,
  ): Record<string, number>[] {
    if (idx >= params.length) return [{ ...current }];
    const p = params[idx];
    const results: Record<string, number>[] = [];
    for (const v of p.values) {
      current[p.name] = v;
      results.push(...this.buildCombinations(params, idx + 1, current));
    }
    return results;
  }

  private getDefaultTriggerArgs(role: OnsetRole): object {
    switch (role) {
      case 'kick': return { amp: 1.0, fund: 55, decay: 0.2 };
      case 'bass': return { freq: 82, dur: 0.2, amp: 0.6, acid: false, params: null };
      case 'lead': return { freq: 440, amp: 0.5 };
      case 'hat': return { open: false, amp: 0.5 };
      case 'perc': return { freq: 200, amp: 0.5 };
      case 'pad': return { freq: 220, dur: 2.0, amp: 0.3, params: null };
      case 'acid': return { freq: 110, dur: 0.3, amp: 0.6, params: null };
      case 'clap': return { amp: 0.7 };
      case 'shaker': return { amp: 0.5 };
      case 'texture': return { dur: 1.0, amp: 0.3, params: null };
    }
  }

  private buildRecipe(role: OnsetRole, params: Record<string, number>): SynthRecipe {
    return {
      oscType: role === 'kick' ? 'sine' : role === 'bass' ? 'sawtooth' : role === 'lead' ? 'sawtooth' : 'square',
      oscLayers: 1,
      detune: 0,
      fmAmount: 0,
      filterType: 'lowpass',
      filterCutoff: params.cutoffStart ?? 800,
      filterResonance: 1,
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
}
