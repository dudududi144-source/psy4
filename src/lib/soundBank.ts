/**
 * SoundBank — שלב 4.3
 *
 * אחסון ואחזור של SynthRecipes שעברו matching.
 * משתמש ב-IndexedDB ל-persistence (נשמר בין סשנים).
 *
 * Schema: { id, role, soundDNA, recipe, matchScore, reward, usageCount, sourceStyle, createdAt, lastUsed }
 * מקסימום MAX_PER_ROLE entries לכל role — חדש עם matchScore גבוה דורס ישן עם reward נמוך.
 */

import { type SoundDNA, type SynthRecipe } from '../../foundation/music/SoundDNA';
import { type OnsetRole } from './onsetAnalyzer';

export interface SoundBankEntry {
  id: string;
  role: OnsetRole;
  soundDNA: SoundDNA;
  recipe: SynthRecipe;
  // שלב 4.4: ה-params הגולמיים של ה-voice (fund, subDecay, saturation, וכו')
  // נשמרים בנפרד מ-recipe כי SynthRecipe לא כולל את כולם
  voiceParams: Record<string, number>;
  matchScore: number;      // 0..1 (מה-match)
  reward: number;          // 0..1 (מתעדכן על-ידי composer ב-4.5)
  usageCount: number;      // כמה פעמים ה-composer השתמש בו
  sourceStyle: string;     // 'radio', 'unknown-N', וכו'
  createdAt: number;       // timestamp
  lastUsed: number;        // timestamp
}

const DB_NAME = 'psy4-soundbank';
const DB_VERSION = 1;
const STORE_NAME = 'sounds';
const MAX_PER_ROLE = 20;

export class SoundBank {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * פתח את ה-IndexedDB. חייב להיקרא לפני כל פעולה.
   */
  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) { await this.initPromise; return; }
    this.initPromise = this._doInit();
    await this.initPromise;
  }

  private _doInit(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('role', 'role', { unique: false });
          store.createIndex('reward', 'reward', { unique: false });
        }
      };
      req.onsuccess = (e) => {
        this.db = (e.target as IDBOpenDBRequest).result;
        console.log('[PSY4] שלב 4.3 SoundBank ready (IndexedDB)');
        resolve();
      };
      req.onerror = (e) => {
        console.error('[PSY4] SoundBank init failed:', e);
        reject((e.target as IDBOpenDBRequest).error);
      };
    });
  }

  /**
   * הוסף entry ל-bank. אם יש יותר מ-MAX_PER_ROLE, evict את הגרוע ביותר.
   */
  async add(
    role: OnsetRole,
    soundDNA: SoundDNA,
    recipe: SynthRecipe,
    matchScore: number,
    sourceStyle: string,
    voiceParams?: Record<string, number>,
  ): Promise<string> {
    await this.init();
    const id = `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: SoundBankEntry = {
      id,
      role,
      soundDNA,
      recipe,
      voiceParams: voiceParams || {},
      matchScore,
      reward: 0.5, // default — יתעדכן על-ידי composer ב-4.5
      usageCount: 0,
      sourceStyle,
      createdAt: Date.now(),
      lastUsed: 0,
    };
    await this.put(entry);
    // בדוק eviction
    await this.maybeEvict(role);
    console.log(`[PSY4] שלב 4.3 SoundBank.add(${role}): matchScore=${matchScore.toFixed(3)} id=${id} (total: ${await this.count(role)})`);
    return id;
  }

  /**
   * שמור/עדכן entry.
   */
  private async put(entry: SoundBankEntry): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) { reject(new Error('DB not open')); return; }
      const tx = this.db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * עדכן reward + usageCount ל-entry קיים.
   */
  async updateReward(id: string, rewardDelta: number, incrementUsage: boolean): Promise<void> {
    await this.init();
    const entry = await this.getById(id);
    if (!entry) return;
    entry.reward = Math.max(0, Math.min(1, entry.reward + rewardDelta));
    if (incrementUsage) {
      entry.usageCount++;
      entry.lastUsed = Date.now();
    }
    await this.put(entry);
  }

  /**
   * קבל את ה-entry הטוב ביותר ל-role לפי context.
   * שלב 4.5: Preferential retrieval — העדף entries עם reward גבוה.
   * - אם יש entry עם reward > 0.8 ("proven") → החזר אותו תמיד
   * - אחרת, אם יש entries עם אותו sourceStyle → החזר את הטוב ביותר מהם (לפי reward)
   * - אחרת, החזר את ה-entry עם ה-reward הגבוה ביותר
   * מחזיר null אם ה-bank ריק ל-role.
   */
  async get(role: OnsetRole, context?: { style?: string }): Promise<SoundBankEntry | null> {
    await this.init();
    const all = await this.all(role);
    if (all.length === 0) return null;

    // EPSILON-GREEDY: 20% chance to return a RANDOM entry (exploration).
    // Without this, the same "proven" entry is returned every time and the
    // sound never changes. This forces the system to try different sounds.
    if (Math.random() < 0.2) {
      return all[Math.floor(Math.random() * all.length)];
    }

    // 80% — return best entry, but cycle among top proven entries for variety
    const proven = all.filter(e => e.reward > 0.8);
    if (proven.length > 0) {
      // Sort by reward, but pick from top 3 (round-robin style)
      proven.sort((a, b) => b.reward - a.reward);
      const topN = Math.min(3, proven.length);
      return proven[Math.floor(Math.random() * topN)];
    }

    // If there's a context.style, prefer entries with matching sourceStyle
    if (context?.style) {
      const matching = all.filter(e => e.sourceStyle === context.style);
      if (matching.length > 0) {
        matching.sort((a, b) => b.reward - a.reward);
        return matching[0];
      }
    }

    // Otherwise — highest reward
    all.sort((a, b) => b.reward - a.reward);
    return all[0];
  }

  /**
   * קבל את כל ה-entries ל-role.
   */
  async all(role: OnsetRole): Promise<SoundBankEntry[]> {
    await this.init();
    return new Promise((resolve, reject) => {
      if (!this.db) { reject(new Error('DB not open')); return; }
      const tx = this.db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const idx = store.index('role');
      const req = idx.getAll(role);
      req.onsuccess = () => resolve(req.result as SoundBankEntry[]);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * קבל entry לפי ID.
   */
  private async getById(id: string): Promise<SoundBankEntry | null> {
    await this.init();
    return new Promise((resolve, reject) => {
      if (!this.db) { reject(new Error('DB not open')); return; }
      const tx = this.db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * מספר entries ל-role.
   */
  async count(role: OnsetRole): Promise<number> {
    const all = await this.all(role);
    return all.length;
  }

  /**
   * סטטיסטיקות לכל ה-roles (ל-UI).
   */
  async getStats(): Promise<Record<OnsetRole, number>> {
    const roles: OnsetRole[] = ['kick', 'bass', 'lead', 'hat', 'perc', 'acid', 'pad', 'clap', 'shaker', 'texture'];
    const stats: Record<OnsetRole, number> = { kick: 0, bass: 0, lead: 0, hat: 0, perc: 0, acid: 0, pad: 0, clap: 0, shaker: 0, texture: 0 };
    for (const role of roles) {
      stats[role] = await this.count(role);
    }
    return stats;
  }

  /**
   * Eviction — אם יש יותר מ-MAX_PER_ROLE, מחק את הגרוע ביותר.
   * קריטריון: reward נמוך × matchScore נמוך = נמחק ראשון.
   */
  private async maybeEvict(role: OnsetRole): Promise<void> {
    const all = await this.all(role);
    if (all.length <= MAX_PER_ROLE) return;
    // מיין לפי ניקוד משולב: reward * 0.6 + matchScore * 0.4 (הנמוך נמחק)
    all.sort((a, b) => (a.reward * 0.6 + a.matchScore * 0.4) - (b.reward * 0.6 + b.matchScore * 0.4));
    const toEvict = all.slice(0, all.length - MAX_PER_ROLE);
    for (const entry of toEvict) {
      await this.delete(entry.id);
    }
    console.log(`[PSY4] שלב 4.3 SoundBank evict(${role}): removed ${toEvict.length} low-scoring entries`);
  }

  /**
   * Eviction ידני — מחק entries עם reward < minReward.
   */
  async evictLow(role: OnsetRole, minReward: number): Promise<number> {
    const all = await this.all(role);
    const toEvict = all.filter(e => e.reward < minReward);
    for (const entry of toEvict) {
      await this.delete(entry.id);
    }
    return toEvict.length;
  }

  /**
   * מחק entry לפי ID.
   */
  // FIX B8: was private — psyLive needs to call delete() directly (was masked by ignoreBuildErrors)
  async delete(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) { reject(new Error('DB not open')); return; }
      const tx = this.db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * נקה את כל ה-entries ל-role.
   */
  async clearRole(role: OnsetRole): Promise<void> {
    const all = await this.all(role);
    for (const entry of all) {
      await this.delete(entry.id);
    }
  }

  /**
   * נקה את כל ה-bank.
   */
  async clearAll(): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      if (!this.db) { reject(new Error('DB not open')); return; }
      const tx = this.db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}
