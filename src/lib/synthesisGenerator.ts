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
  pad: 'PadVoice',
  acid: 'AcidVoice',
  clap: 'ClapVoice',
  shaker: 'ShakerVoice',
  texture: 'TextureVoice',
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
   * אם ה-bank ריק — יוצר פרמטרים מאפס על בסיס ה-target DNA.
   */
  async generate(role: OnsetRole, targetDNA: SoundDNA): Promise<GenerationResult> {
    const t0 = performance.now();
    const entries = await this.bank.all(role);

    // אם ה-bank ריק — צור פרמטרים מאפס על בסיס ה-target DNA
    if (entries.length === 0) {
      console.log(`[PSY4] שלב 5.2 SynthesisGenerator(${role}): bank empty — generating from scratch using target DNA`);
      let generated = 0;
      for (let i = 0; i < MAX_VARIATIONS_PER_ENTRY; i++) {
        const scratchParams = this.createScratchParams(role, targetDNA, i);
        try {
          const buffer = await (this.matcher as any).renderVoice(
            ROLE_TO_VOICE[role],
            scratchParams,
            this.getDefaultTriggerArgs(role, scratchParams),
          );
          if (!buffer || buffer.length === 0) continue;
          const candidateDNA = (this.matcher as any).extractFeaturesFromBuffer(buffer, 44100);
          const distance = (this.matcher as any).computeDistance(targetDNA, candidateDNA);
          if (distance < DISTANCE_THRESHOLD) {
            const recipe = this.buildRecipe(role, scratchParams);
            const matchScore = 1 / (1 + distance);
            await this.bank.add(role, targetDNA, recipe, matchScore, 'generated', scratchParams);
            generated++;
            console.log(`[PSY4] שלב 5.2 SynthesisGenerator(${role}): created from scratch #${i + 1}, distance=${distance.toFixed(3)}`);
          }
        } catch {
          continue;
        }
      }
      const duration_ms = Math.round(performance.now() - t0);
      console.log(`[PSY4] שלב 5.2 SynthesisGenerator(${role}) from-scratch done: ${generated} variations in ${duration_ms}ms`);
      return { role, generated, duration_ms };
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
   * יוצר פרמטרים מאפס על בסיס ה-target DNA.
   * משתמש ב-DNA characteristics כדי לקבוע ערכי התחלה הגיוניים.
   */
  private createScratchParams(role: OnsetRole, dna: SoundDNA, variantIndex: number): Record<string, number> {
    const jitter = (range: number) => (Math.random() - 0.5) * 2 * range * (variantIndex + 1) / 3;
    switch (role) {
      case 'kick':
        return {
          fund: Math.max(35, Math.min(70, 50 + jitter(10))),
          startMult: Math.max(1.5, Math.min(5.5, 3.0 + jitter(1.5))),
          subDecay: Math.max(0.05, Math.min(0.35, (dna.decayTime || 0.2) + jitter(0.05))),
          saturation: Math.max(0.8, Math.min(2.8, (dna.saturation || 0.7) * 2 + jitter(0.3))),
          pitchDecay: Math.max(0.010, Math.min(0.045, 0.025 + jitter(0.010))),
          midLevel: Math.max(0.2, Math.min(0.8, (dna.midEnergy || 0.3) + jitter(0.15))),
          clickLevel: Math.max(0.2, Math.min(0.8, (dna.transientSharpness || 0.8) + jitter(0.15))),
          waveType: Math.floor(Math.random() * 4),
        };
      case 'bass':
        return {
          subLevel: Math.max(0.25, Math.min(0.70, (dna.subEnergy || 0.5) + jitter(0.1))),
          cutoffStart: Math.max(200, Math.min(2200, (dna.filterCutoff || 800) + jitter(200))),
          cutoffEnd: Math.max(80, Math.min(480, 200 + jitter(100))),
          cutoffDecay: Math.max(0.015, Math.min(0.095, (dna.decayTime || 0.1) * 0.3 + jitter(0.02))),
          harmonicLevel: Math.max(0.3, Math.min(0.8, (dna.harmonicity || 0.5) + jitter(0.15))),
        };
      case 'lead':
        return {
          cutoff: Math.max(1500, Math.min(5500, (dna.filterCutoff || 3000) + jitter(500))),
          detune: Math.max(3, Math.min(28, Math.floor((dna.detune || 10) + jitter(5)))),
          freq: Math.max(220, Math.min(880, 440 + jitter(50))),
        };
      case 'hat':
        return {
          hatDecay: Math.max(0.015, Math.min(0.095, (dna.decayTime || 0.05) + jitter(0.02))),
          hatDecayOpen: Math.max(0.08, Math.min(0.33, 0.2 + jitter(0.08))),
          hatBrightness: Math.max(0.3, Math.min(2.8, (dna.brightness || 0.7) * 2 + jitter(0.5))),
        };
      case 'perc':
        return {
          freq: Math.max(120, Math.min(420, (dna.filterCutoff || 200) + jitter(50))),
        };
      case 'pad':
        return {
          padCutoff: Math.max(300, Math.min(1100, (dna.filterCutoff || 600) + jitter(100))),
          padAttack: Math.max(0.1, Math.min(0.6, 0.3 + jitter(0.1))),
          padDetune: Math.max(3, Math.min(13, Math.floor(7 + jitter(3)))),
          padEvolveRate: Math.max(0.2, Math.min(1.0, 0.5 + jitter(0.2))),
        };
      case 'acid':
        return {
          acidCutoff: Math.max(800, Math.min(2800, (dna.filterCutoff || 1500) + jitter(300))),
          acidResonance: Math.max(0.5, Math.min(0.9, 0.7 + jitter(0.1))),
        };
      case 'clap':
        return {
          clapDecay: Math.max(0.015, Math.min(0.095, (dna.decayTime || 0.05) + jitter(0.02))),
        };
      case 'shaker':
        return {
          shakerDecay: Math.max(0.03, Math.min(0.11, (dna.decayTime || 0.06) + jitter(0.02))),
        };
      case 'texture':
        return {
          textureType: Math.floor(Math.random() * 2),
        };
    }
  }

  /**
   * יוצר וריאציה על-ידי שינוי פרמטרים בטווחים רחבים + mutation types שונים.
   * טווחים הורחבו מ-±5Hz ל-±15Hz (kick fund) וכו' כדי לקבל גיוון אמיתי.
   * נוספו: waveType mutation (kick), detune mutation (lead), hatBrightness mutation.
   */
  private createVariation(base: Record<string, number>, role: OnsetRole): Record<string, number> {
    const variation: Record<string, number> = { ...base };
    if (role === 'kick') {
      if (variation.fund !== undefined) {
        variation.fund = this.varyValue(variation.fund, 15, 35, 70); // ±15Hz (was ±5)
      }
      if (variation.saturation !== undefined) {
        variation.saturation = this.varyValue(variation.saturation, 0.5, 0.8, 2.8); // ±0.5 (was ±0.3)
      }
      if (variation.subDecay !== undefined) {
        variation.subDecay = this.varyValue(variation.subDecay, 0.08, 0.05, 0.35);
      }
      if (variation.startMult !== undefined) {
        variation.startMult = this.varyValue(variation.startMult, 1.5, 1.5, 5.5);
      }
      // NEW: waveType mutation — change waveform type for tonal variation
      if (variation.waveType !== undefined && Math.random() < 0.3) {
        variation.waveType = Math.floor(Math.random() * 4); // 0-3 (sine/tri/sq/saw)
      }
      // NEW: pitchDecay mutation
      if (variation.pitchDecay !== undefined) {
        variation.pitchDecay = this.varyValue(variation.pitchDecay, 0.015, 0.010, 0.045);
      }
    } else if (role === 'bass') {
      if (variation.cutoffStart !== undefined) {
        variation.cutoffStart = this.varyValue(variation.cutoffStart, 500, 200, 2200); // ±500 (was ±200)
      }
      if (variation.cutoffEnd !== undefined) {
        variation.cutoffEnd = this.varyValue(variation.cutoffEnd, 100, 80, 480);
      }
      if (variation.subLevel !== undefined) {
        variation.subLevel = this.varyValue(variation.subLevel, 0.15, 0.25, 0.70);
      }
      if (variation.cutoffDecay !== undefined) {
        variation.cutoffDecay = this.varyValue(variation.cutoffDecay, 0.04, 0.015, 0.095);
      }
    } else if (role === 'lead') {
      if (variation.freq !== undefined) {
        variation.freq = this.varyValue(variation.freq, 100, 220, 880); // ±100 (was ±50)
      }
      if (variation.cutoff !== undefined) {
        variation.cutoff = this.varyValue(variation.cutoff, 800, 1500, 5500); // NEW
      }
      if (variation.detune !== undefined) {
        variation.detune = this.varyValue(variation.detune, 8, 3, 28); // NEW
      }
    } else if (role === 'hat') {
      if (variation.hatDecay !== undefined) {
        variation.hatDecay = this.varyValue(variation.hatDecay, 0.03, 0.015, 0.095); // NEW
      }
      if (variation.hatBrightness !== undefined) {
        variation.hatBrightness = this.varyValue(variation.hatBrightness, 1.0, 0.3, 2.8); // NEW
      }
    } else if (role === 'perc') {
      if (variation.freq !== undefined) {
        variation.freq = this.varyValue(variation.freq, 80, 100, 420); // ±80 (was ±30)
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
      case 'pad': return { freq: 220, dur: 2.0, amp: 0.3, params };
      case 'acid': return { freq: 110, dur: 0.3, amp: 0.6, params };
      case 'clap': return { amp: 0.7 };
      case 'shaker': return { amp: 0.5 };
      case 'texture': return { dur: 1.0, amp: 0.3, params };
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
