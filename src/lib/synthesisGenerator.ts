/**
 * SynthesisGenerator — שלב 5.2: יצירת וריאציות מקוריות.
 *
 * לוקח entries מה-sound bank ויוצר וריאציות חדשות עליהם.
 * זה לא העתקה — זה יצירה מקורית של סאונדים חדשים שמבוססים על מה שנלמד.
 *
 * אלגוריתם:
 * 1. לוקח entry קיים עם matchScore גבוה
 * 2. משנה פרמטרים ב-±10-20% (fund ±5Hz, saturation ±0.3, cutoffStart ±200Hz)
 * 3. אם הוריאציה עדיין קרובה ליעד (distance < 0.8) — שומר כ-entry חדש
 * 4. sourceStyle = 'generated' (לא 'radio')
 */

import { type SoundDNA, type SynthRecipe } from '../../foundation/music/SoundDNA';
import { type OnsetRole } from './onsetAnalyzer';
import { SoundBank } from './soundBank';
import { SynthesisMatcher } from './synthesisMatcher';

const ROLE_TO_VOICE: Record<OnsetRole, string> = {
  kick: 'KickVoice',
  bass: 'BassVoice',
  lead: 'LeadVoice',
  hat: 'HatVoice',
  perc: 'PercVoice',
};

const VARIATION_RANGE = 0.15; // ±15%
const MAX_VARIATIONS_PER_ENTRY = 3;
const DISTANCE_THRESHOLD = 0.8; // רק וריאציות שעדיין קרובות ליעד

export interface GenerationResult {
  role: OnsetRole;
  generated: number;
  duration_ms: number;
}

export class SynthesisGenerator {
  private matcher: SynthesisMatcher;
  private bank: SoundBank;

  constructor(matcher: SynthesisMatcher, bank: SoundBank) {
    this.matcher = matcher;
    this.bank = bank;
  }

  /**
   * יוצר וריאציות על entries קיימים.
   * לוקח את ה-entry עם ה-reward הגבוה ביותר לכל role ויוצר וריאציות.
   */
  async generate(role: OnsetRole, targetDNA: SoundDNA): Promise<GenerationResult> {
    const t0 = performance.now();
    const entries = await this.bank.all(role);
    if (entries.length === 0) {
      return { role, generated: 0, duration_ms: 0 };
    }

    // בחר את ה-entry הטוב ביותר (reward גבוה + matchScore גבוה)
    entries.sort((a, b) => (b.reward * 0.6 + b.matchScore * 0.4) - (a.reward * 0.6 + a.matchScore * 0.4));
    const best = entries[0];
    const baseParams = best.voiceParams || {};

    let generated = 0;
    for (let i = 0; i < MAX_VARIATIONS_PER_ENTRY; i++) {
      // צור וריאציה
      const variation = this.createVariation(baseParams, role);
      // בדוק את ה-distance ליעד
      try {
        const buffer = await (this.matcher as any).renderVoice(
          ROLE_TO_VOICE[role],
          variation,
          this.getDefaultTriggerArgs(role, variation),
        );
        if (!buffer || buffer.length === 0) continue;
        const candidateDNA = (this.matcher as any).extractFeaturesFromBuffer(buffer, 44100);
        const distance = (this.matcher as any).computeDistance(targetDNA, candidateDNA);
        if (distance < DISTANCE_THRESHOLD) {
          // שמור כ-entry חדש עם sourceStyle='generated'
          const recipe = this.buildRecipe(role, variation);
          const matchScore = 1 / (1 + distance);
          await this.bank.add(role, targetDNA, recipe, matchScore, 'generated', variation);
          generated++;
          console.log(`[PSY4] שלב 5.2 SynthesisGenerator(${role}): created variation ${i + 1}, distance=${distance.toFixed(3)}, params=${JSON.stringify(variation).slice(0, 80)}`);
        }
      } catch {
        continue;
      }
    }

    const duration_ms = Math.round(performance.now() - t0);
    console.log(`[PSY4] שלב 5.2 SynthesisGenerator(${role}) done: generated ${generated} variations in ${duration_ms}ms`);
    return { role, generated, duration_ms };
  }

  /**
   * יוצר וריאציה על-ידי שינוי פרמטרים ב-±VARIATION_RANGE.
   */
  private createVariation(base: Record<string, number>, role: OnsetRole): Record<string, number> {
    const variation: Record<string, number> = { ...base };
    // שנה פרמטרים רלוונטיים לפי role
    if (role === 'kick') {
      if (variation.fund !== undefined) {
        variation.fund = this.varyValue(variation.fund, 5, 40, 70); // ±5Hz
      }
      if (variation.saturation !== undefined) {
        variation.saturation = this.varyValue(variation.saturation, 0.3, 1.0, 2.5);
      }
      if (variation.subDecay !== undefined) {
        variation.subDecay = this.varyValue(variation.subDecay, 0.03, 0.1, 0.3);
      }
      if (variation.startMult !== undefined) {
        variation.startMult = this.varyValue(variation.startMult, 0.5, 2.0, 5.0);
      }
    } else if (role === 'bass') {
      if (variation.cutoffStart !== undefined) {
        variation.cutoffStart = this.varyValue(variation.cutoffStart, 200, 400, 1500);
      }
      if (variation.cutoffEnd !== undefined) {
        variation.cutoffEnd = this.varyValue(variation.cutoffEnd, 50, 100, 400);
      }
      if (variation.subLevel !== undefined) {
        variation.subLevel = this.varyValue(variation.subLevel, 0.1, 0.3, 0.6);
      }
      if (variation.cutoffDecay !== undefined) {
        variation.cutoffDecay = this.varyValue(variation.cutoffDecay, 0.02, 0.02, 0.08);
      }
    } else if (role === 'lead') {
      if (variation.freq !== undefined) {
        variation.freq = this.varyValue(variation.freq, 50, 220, 880);
      }
    } else if (role === 'perc') {
      if (variation.freq !== undefined) {
        variation.freq = this.varyValue(variation.freq, 30, 100, 400);
      }
    }
    return variation;
  }

  /**
   * משנה ערך ב-±range, מגביל ל-min..max.
   */
  private varyValue(value: number, range: number, min: number, max: number): number {
    const delta = (Math.random() - 0.5) * 2 * range;
    return Math.max(min, Math.min(max, value + delta));
  }

  private getDefaultTriggerArgs(role: OnsetRole, params: Record<string, number>): object {
    switch (role) {
      case 'kick': return { amp: 1.0, fund: params.fund ?? 55, decay: params.subDecay ?? 0.2 };
      case 'bass': return { freq: 82, dur: 0.2, amp: 0.6, acid: false, params };
      case 'lead': return { freq: params.freq ?? 440, amp: 0.5 };
      case 'hat': return { open: false, amp: 0.5 };
      case 'perc': return { freq: params.freq ?? 200, amp: 0.5 };
    }
  }

  private buildRecipe(role: OnsetRole, params: Record<string, number>): SynthRecipe {
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
