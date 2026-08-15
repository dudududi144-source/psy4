/**
 * RewardTracker — שלב 4.5: Reward loop for self-improvement.
 *
 * עוקב אחרי איך הרדיו מגיב לסאונדים ש-PSY4 מייצר, ומעדכן את ה-reward
 * של entries ב-sound bank.
 *
 * לוגיקה:
 * - כש-PSY4 מחיל recipe מה-bank על role מסוים, רושם את ה-occupancy של הרדיו באותו role
 * - אחרי חלון זמן (3 שניות), מודד את השינוי ב-occupancy
 * - אם ה-occupancy של הרדיו ב-role עלתה → הרדיו "מגיב" ל-PSY4 → reward חיובי
 * - אם ירדה → penalty
 * - עדכן את ה-reward של ה-entry שהיה פעיל
 *
 * הנחת יסוד: אם הרדיו "נרגע" ב-role מסוים אחרי ש-PSY4 התחיל לנגן שם,
 * זה אומר ש-PSY4 משלים את הרדיו טוב → reward חיובי.
 * אם הרדיו התחזק ב-role הזה → התנגשות → penalty.
 *
 * בעצם: ה-reward מודד "האם PSY4 השלים את הרדיו או התנגש איתו".
 */

import { type OnsetRole } from './onsetAnalyzer';
import { SoundBank } from './soundBank';
import { QualityAnalyzer, type QualityMetrics } from './qualityAnalyzer';

interface ActiveTracking {
  entryId: string;
  role: OnsetRole;
  startTime: number;
  startOccupancy: number;
  synthetic: boolean;
  startQuality: number;  // NEW: quality score at start
}

const REWARD_WINDOW_MS = 3000;
const REWARD_DELTA = 0.10;
const MAX_REWARD = 1.0;
const MIN_REWARD = 0.0;

export class RewardTracker {
  private bank: SoundBank;
  private active: Map<string, ActiveTracking> = new Map();
  private occupancyHistory: { time: number; occupancy: { kick: number; bass: number; lead: number; hats: number } }[] = [];
  private syntheticMode = false;
  private qualityAnalyzer: QualityAnalyzer | null = null;
  private analyserL: AnalyserNode | null = null;
  private analyserR: AnalyserNode | null = null;
  private qualityHistory: number[] = [];

  constructor(bank: SoundBank) {
    this.bank = bank;
  }

  /**
   * הגדר את ה-quality analyzer + analysers (נקרא מ-psyLive אחרי audio init).
   */
  setQualityAnalyzer(qa: QualityAnalyzer, analyserL: AnalyserNode, analyserR?: AnalyserNode | null): void {
    this.qualityAnalyzer = qa;
    this.analyserL = analyserL;
    this.analyserR = analyserR || null;
  }

  /**
   * Mark that occupancy is synthetic (derived from PSY4's own output, not radio).
   * In synthetic mode, the reward logic changes: an increase in occupancy means
   * PSY4 is playing MORE (good), not a collision. Steady output = reward.
   */
  setSyntheticMode(synthetic: boolean): void {
    this.syntheticMode = synthetic;
  }

  /**
   * עדכן את היסטוריית ה-occupancy. נקרא כל 100ms מ-detect().
   */
  recordOccupancy(occupancy: { kick: number; bass: number; lead: number; hats: number }): void {
    const now = Date.now();
    this.occupancyHistory.push({ time: now, occupancy: { ...occupancy } });
    // שמור רק 10 שניות אחרונות
    const cutoff = now - 10000;
    while (this.occupancyHistory.length > 0 && this.occupancyHistory[0].time < cutoff) {
      this.occupancyHistory.shift();
    }
    // בדוק אם יש trackings שהגיעו לסוף החלון
    this.checkPendingTrackings(now);
  }

  /**
   * רשום ש-PSY4 החיל recipe על role. מתחיל מדידת reward.
   */
  startTracking(entryId: string, role: OnsetRole, occupancy: { kick: number; bass: number; lead: number; hats: number }): void {
    const roleOcc = this.getRoleOccupancy(role, occupancy);
    // Measure quality at start (if quality analyzer is set)
    let startQuality = 0.5;
    if (this.qualityAnalyzer && this.analyserL) {
      const metrics = this.qualityAnalyzer.measure(this.analyserL, this.analyserR);
      startQuality = this.qualityAnalyzer.compositeScore(metrics);
    }
    this.active.set(entryId, {
      entryId,
      role,
      startTime: Date.now(),
      startOccupancy: roleOcc,
      synthetic: this.syntheticMode,
      startQuality,
    });
    console.log(`[PSY4] שלב 4.5 RewardTracker: start tracking ${role} entry=${entryId} startOcc=${roleOcc.toFixed(2)} startQ=${startQuality.toFixed(2)}${this.syntheticMode ? ' (synthetic)' : ''}`);
  }

  /**
   * בדוק אילו trackings הגיעו לסוף החלון וחשב reward.
   */
  private async checkPendingTrackings(now: number): Promise<void> {
    const completed: ActiveTracking[] = [];
    for (const [id, tracking] of this.active) {
      if (now - tracking.startTime >= REWARD_WINDOW_MS) {
        completed.push(tracking);
        this.active.delete(id);
      }
    }
    for (const tracking of completed) {
      await this.evaluateReward(tracking);
    }
  }

  /**
   * חשב reward ל-tracking שהסתיים.
   */
  private async evaluateReward(tracking: ActiveTracking): Promise<void> {
    if (this.occupancyHistory.length === 0) return;
    const latest = this.occupancyHistory[this.occupancyHistory.length - 1];
    const currentOcc = this.getRoleOccupancy(tracking.role, latest.occupancy);
    const delta = currentOcc - tracking.startOccupancy;

    // Measure quality at end (if quality analyzer is set)
    let endQuality = tracking.startQuality;
    if (this.qualityAnalyzer && this.analyserL) {
      const metrics = this.qualityAnalyzer.measure(this.analyserL, this.analyserR);
      endQuality = this.qualityAnalyzer.compositeScore(metrics);
    }
    const qualityDelta = endQuality - tracking.startQuality;

    let rewardDelta: number;
    if (tracking.synthetic) {
      // SYNTHETIC MODE: reward based on QUALITY (not just occupancy).
      // The quality score (0-1) measures: spectral balance, dynamic range,
      // stereo width, transient sharpness, low-end clarity.
      // Reward logic:
      // - quality > 0.6 → strong reward (+0.10)
      // - quality 0.4-0.6 → moderate reward (+0.05)
      // - quality < 0.3 → penalty (-0.05)
      // - quality improved (delta > 0.1) → bonus (+0.03)
      // - quality degraded (delta < -0.1) → penalty (-0.05)
      // - output dead (occ < threshold) → strong penalty (-0.10)
      const isKick = tracking.role === 'kick';
      const deadThreshold = isKick ? 0.3 : 0.02;

      if (currentOcc < deadThreshold) {
        rewardDelta = -REWARD_DELTA;        // output died
      } else if (endQuality > 0.6) {
        rewardDelta = REWARD_DELTA;          // high quality
      } else if (endQuality > 0.4) {
        rewardDelta = REWARD_DELTA * 0.5;   // OK quality
      } else if (endQuality < 0.3) {
        rewardDelta = -REWARD_DELTA * 0.5;  // poor quality
      } else {
        rewardDelta = REWARD_DELTA * 0.2;   // mediocre
      }

      // Bonus/penalty for quality change
      if (qualityDelta > 0.1) rewardDelta += REWARD_DELTA * 0.3;   // improved
      else if (qualityDelta < -0.1) rewardDelta -= REWARD_DELTA * 0.3;  // degraded
    } else {
      // RADIO MODE: original logic
      if (delta < -0.05) {
        rewardDelta = REWARD_DELTA;
      } else if (delta > 0.05) {
        rewardDelta = -REWARD_DELTA;
      } else {
        rewardDelta = REWARD_DELTA * 0.3;
      }
    }

    // עדכן את ה-reward ב-bank
    try {
      await this.bank.updateReward(tracking.entryId, rewardDelta, false);
      console.log(
        `[PSY4] שלב 4.5 RewardTracker: ${tracking.role} entry=${tracking.entryId} ` +
        `startOcc=${tracking.startOccupancy.toFixed(2)} endOcc=${currentOcc.toFixed(2)} ` +
        `Q=${tracking.startQuality.toFixed(2)}→${endQuality.toFixed(2)} ` +
        `rewardDelta=${rewardDelta >= 0 ? '+' : ''}${rewardDelta.toFixed(3)}${tracking.synthetic ? ' (synthetic)' : ''}`,
      );
    } catch (e) {
      console.warn('[PSY4] שלב 4.5 RewardTracker update failed:', e);
    }
  }

  /**
   * מפה role → occupancy field.
   * hats ב-occupancy = hat role ב-onsetAnalyzer.
   */
  private getRoleOccupancy(role: OnsetRole, occupancy: { kick: number; bass: number; lead: number; hats: number }): number {
    switch (role) {
      case 'kick': return occupancy.kick;
      case 'bass': return occupancy.bass;
      case 'lead': return occupancy.lead;
      case 'hat': return occupancy.hats;
      case 'perc': return (occupancy.kick + occupancy.lead) * 0.3;
      case 'pad': return occupancy.lead * 0.5;
      case 'acid': return occupancy.bass * 0.6;
      case 'clap': return occupancy.hats * 0.4;
      case 'shaker': return occupancy.hats * 0.5;
      case 'texture': return (occupancy.lead + occupancy.hats) * 0.25;
    }
  }

  /**
   * סטטיסטיקות ל-UI/debugging.
   */
  getActiveTrackingCount(): number {
    return this.active.size;
  }

  getHistoryLength(): number {
    return this.occupancyHistory.length;
  }
}
