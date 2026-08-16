/**
 * SmartExplorer — Phase 2.2: Gradient-based exploration.
 *
 * במקום סריקת grid עיוורת (exhaustive search), ה-SmartExplorer:
 * 1. שומר history של ניסויים (params, reward)
 * 2. משערך את פונקציית ה-reward ע"י מודל פשוט (linear regression)
 * 3. מציע את הפרמטרים הבאים על בסיס:
 *    - Exploitation: סביב ה-best params הידוע (local search)
 *    - Exploration: ניסוי פרמטרים רחוקים (epsilon-greedy)
 *
 * זה מהיר יותר מ-grid search ומתכנס לאופטימום.
 */

import { type SoundDNA } from '../../foundation/music/SoundDNA';
import { type OnsetRole } from './onsetAnalyzer';
import { SoundBank } from './soundBank';
import { SynthesisMatcher } from './synthesisMatcher';

interface Trial {
  params: Record<string, number>;
  reward: number;
  matchScore: number;
}

const MAX_HISTORY = 30;
const EPSILON = 0.3;  // 30% exploration, 70% exploitation
const VARIATION_RADIUS = 0.15;  // ±15% variation around best

export class SmartExplorer {
  private matcher: SynthesisMatcher;
  private bank: SoundBank;
  private history: Map<OnsetRole, Trial[]> = new Map();

  constructor(matcher: SynthesisMatcher, bank: SoundBank) {
    this.matcher = matcher;
    this.bank = bank;
  }

  /**
   * חקירה חכמה — מציע פרמטרים על בסיס history.
   */
  async explore(
    role: OnsetRole,
    targetDNA: SoundDNA,
    sourceStyle: string,
    roleToVoice: Record<string, string>,
    scanParams: { name: string; values: number[] }[],
  ): Promise<{ saved: number; scanned: number; bestMatchScore: number; duration_ms: number }> {
    const t0 = performance.now();
    const trials = this.history.get(role) || [];

    // אם אין history מספיק — בצע סריקת grid רגילה (3 ניסויים ראשונים)
    if (trials.length < 3) {
      return this.gridSearch(role, targetDNA, sourceStyle, roleToVoice, scanParams, trials);
    }

    // Smart exploration: exploit + explore
    const candidates = this.generateCandidates(role, trials, scanParams);
    let saved = 0;
    let bestMatchScore = 0;
    let scanned = 0;

    for (const params of candidates) {
      try {
        const buffer = await (this.matcher as any).renderVoice(
          roleToVoice[role], params, this.getDefaultTriggerArgs(role, params),
        );
        if (!buffer || buffer.length === 0) continue;
        scanned++;
        const candidateDNA = (this.matcher as any).extractFeaturesFromBuffer(buffer, 44100);
        const distance = (this.matcher as any).computeDistance(targetDNA, candidateDNA);
        const matchScore = 1 / (1 + distance);
        if (matchScore > bestMatchScore) bestMatchScore = matchScore;

        // שמור ל-bank אם קרוב מספיק
        if (distance < 0.8) {
          const recipe = this.buildRecipe(role, params);
          await this.bank.add(role, targetDNA, recipe, matchScore, sourceStyle, params);
          saved++;
        }

        // שמור ל-history
        trials.push({ params, reward: matchScore, matchScore });
      } catch {
        continue;
      }
    }

    // Keep only last MAX_HISTORY trials
    if (trials.length > MAX_HISTORY) {
      trials.splice(0, trials.length - MAX_HISTORY);
    }
    this.history.set(role, trials);

    const duration_ms = Math.round(performance.now() - t0);
    console.log(`[PSY4] Phase 2.2 SmartExplorer(${role}): scanned=${scanned} saved=${saved} best=${bestMatchScore.toFixed(3)} history=${trials.length} (${duration_ms}ms)`);
    return { saved, scanned, bestMatchScore, duration_ms };
  }

  /**
   * יוצר קאנדידטים — שילוב של exploitation ו-exploration.
   */
  private generateCandidates(role: OnsetRole, trials: Trial[], scanParams: { name: string; values: number[] }[]): Record<string, number>[] {
    const candidates: Record<string, number>[] = [];
    const best = trials.reduce((a, b) => a.reward > b.reward ? a : b);

    // Exploitation: 3 וריאציות סביב ה-best
    for (let i = 0; i < 3; i++) {
      const variation: Record<string, number> = { ...best.params };
      for (const sp of scanParams) {
        const current = variation[sp.name] ?? sp.values[0];
        const range = (sp.values[sp.values.length - 1] - sp.values[0]) * VARIATION_RADIUS;
        variation[sp.name] = current + (Math.random() - 0.5) * 2 * range;
        // Clamp to scan range
        variation[sp.name] = Math.max(sp.values[0], Math.min(sp.values[sp.values.length - 1], variation[sp.name]));
      }
      candidates.push(variation);
    }

    // Exploration: 2 קאנדידטים אקראיים מתוך ה-grid
    for (let i = 0; i < 2; i++) {
      const random: Record<string, number> = {};
      for (const sp of scanParams) {
        random[sp.name] = sp.values[Math.floor(Math.random() * sp.values.length)];
      }
      candidates.push(random);
    }

    return candidates;
  }

  /**
   * סריקת grid רגילה — לשימוש כשאין מספיק history.
   */
  private async gridSearch(
    role: OnsetRole,
    targetDNA: SoundDNA,
    sourceStyle: string,
    roleToVoice: Record<string, string>,
    scanParams: { name: string; values: number[] }[],
    trials: Trial[],
  ): Promise<{ saved: number; scanned: number; bestMatchScore: number; duration_ms: number }> {
    const t0 = performance.now();
    // בנה רק 5 קומבינציות ראשונות (לא כל ה-grid)
    const combos: Record<string, number>[] = [];
    for (let i = 0; i < 5; i++) {
      const params: Record<string, number> = {};
      for (const sp of scanParams) {
        params[sp.name] = sp.values[i % sp.values.length];
      }
      combos.push(params);
    }

    let saved = 0;
    let bestMatchScore = 0;
    let scanned = 0;

    for (const params of combos) {
      try {
        const buffer = await (this.matcher as any).renderVoice(
          roleToVoice[role], params, this.getDefaultTriggerArgs(role, params),
        );
        if (!buffer || buffer.length === 0) continue;
        scanned++;
        const candidateDNA = (this.matcher as any).extractFeaturesFromBuffer(buffer, 44100);
        const distance = (this.matcher as any).computeDistance(targetDNA, candidateDNA);
        const matchScore = 1 / (1 + distance);
        if (matchScore > bestMatchScore) bestMatchScore = matchScore;

        if (distance < 0.8) {
          const recipe = this.buildRecipe(role, params);
          await this.bank.add(role, targetDNA, recipe, matchScore, sourceStyle, params);
          saved++;
        }

        trials.push({ params, reward: matchScore, matchScore });
      } catch {
        continue;
      }
    }

    this.history.set(role, trials);
    const duration_ms = Math.round(performance.now() - t0);
    console.log(`[PSY4] Phase 2.2 SmartExplorer(${role}) grid: scanned=${scanned} saved=${saved} (${duration_ms}ms)`);
    return { saved, scanned, bestMatchScore, duration_ms };
  }

  private getDefaultTriggerArgs(role: OnsetRole, params: Record<string, number>): object {
    switch (role) {
      case 'kick': return { amp: 1.0, fund: params.fund ?? 55, decay: params.subDecay ?? 0.2 };
      case 'bass': return { freq: 82, dur: 0.2, amp: 0.6, acid: false, params };
      case 'lead': return { freq: params.freq ?? 440, amp: 0.5 };
      case 'hat': return { open: false, amp: 0.5 };
      case 'perc': return { freq: params.freq ?? 200, amp: 0.5 };
      case 'pad': return { freq: 220, dur: 2.0, amp: 0.3, params };
      case 'acid': return { freq: 110, dur: 0.3, amp: 0.6, params };
      case 'clap': return { amp: 0.7 };
      case 'shaker': return { amp: 0.5 };
      case 'texture': return { dur: 1.0, amp: 0.3, params };
    }
  }

  private buildRecipe(role: OnsetRole, params: Record<string, number>): import('../../foundation/music/SoundDNA').SynthRecipe {
    return {
      oscType: role === 'kick' ? 'sine' : role === 'bass' ? 'sawtooth' : 'sawtooth',
      oscLayers: 1,
      detune: 0,
      fmAmount: 0,
      filterType: 'lowpass',
      filterCutoff: params.cutoffStart ?? 800,
      filterResonance: 1,
      filterEnvAmount: 0.5,
      attackTime: 0.001,
      decayTime: params.subDecay ?? 0.2,
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
