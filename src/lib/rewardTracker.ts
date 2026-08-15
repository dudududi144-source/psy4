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

interface ActiveTracking {
  entryId: string;
  role: OnsetRole;
  startTime: number;
  startOccupancy: number;
  synthetic: boolean;  // true when occupancy comes from PSY4's own output (no radio)
}

const REWARD_WINDOW_MS = 3000; // חלון מדידה: 3 שניות אחרי החלת recipe
const REWARD_DELTA = 0.10;     // was 0.05 — too slow to reach "proven" (0.8)
const MAX_REWARD = 1.0;
const MIN_REWARD = 0.0;

export class RewardTracker {
  private bank: SoundBank;
  private active: Map<string, ActiveTracking> = new Map(); // entryId → tracking
  private occupancyHistory: { time: number; occupancy: { kick: number; bass: number; lead: number; hats: number } }[] = [];
  private syntheticMode = false;  // set by psyLive when no radio

  constructor(bank: SoundBank) {
    this.bank = bank;
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
    this.active.set(entryId, {
      entryId,
      role,
      startTime: Date.now(),
      startOccupancy: roleOcc,
      synthetic: this.syntheticMode,
    });
    console.log(`[PSY4] שלב 4.5 RewardTracker: start tracking ${role} entry=${entryId} startOcc=${roleOcc.toFixed(2)}${this.syntheticMode ? ' (synthetic)' : ''}`);
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
    // מצא את ה-occupancy הנוכחי ל-role
    if (this.occupancyHistory.length === 0) return;
    const latest = this.occupancyHistory[this.occupancyHistory.length - 1];
    const currentOcc = this.getRoleOccupancy(tracking.role, latest.occupancy);
    const delta = currentOcc - tracking.startOccupancy;

    let rewardDelta: number;
    if (tracking.synthetic) {
      // SYNTHETIC MODE (no radio): reward based on output health, not collision.
      // - If PSY4 is producing steady output (currentOcc > 0.1) → reward (it's working)
      // - If output dropped to near-zero (currentOcc < 0.05) → penalty (recipe killed the sound)
      // - If output is clipping (currentOcc > 0.9) → small penalty (too hot)
      // This lets reward accumulate when PSY4 plays steadily after a recipe is applied.
      if (currentOcc < 0.05) {
        rewardDelta = -REWARD_DELTA;        // output died — bad recipe
      } else if (currentOcc > 0.9) {
        rewardDelta = -REWARD_DELTA * 0.5;  // clipping — back off
      } else if (currentOcc > 0.1) {
        rewardDelta = REWARD_DELTA * 0.5;   // healthy output — reward
      } else {
        rewardDelta = REWARD_DELTA * 0.2;   // weak but present — small reward
      }
    } else {
      // RADIO MODE: original logic — occupancy drop = PSY4 complementing radio = good
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
        `delta=${delta.toFixed(2)} rewardDelta=${rewardDelta >= 0 ? '+' : ''}${rewardDelta.toFixed(3)}${tracking.synthetic ? ' (synthetic)' : ''}`,
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
      case 'perc': return (occupancy.kick + occupancy.lead) * 0.3; // perc לא נמדד ישירות
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
