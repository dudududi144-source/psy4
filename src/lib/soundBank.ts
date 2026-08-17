/**
 * PSY4 SoundBank v2 — Minimal, sample-based
 *
 * Stores per-role sample preferences + learned params.
 * Used by psyLive.ts for UI display + factory reset.
 * No more IndexedDB — just localStorage (simpler, more reliable).
 */

export interface SoundBankEntry {
  id: string;
  role: string;
  matchScore: number;
  reward: number;
  usageCount: number;
  sourceStyle: string;
  params: Record<string, number>;
  // Alias for backward compat (psyLive.ts uses voiceParams)
  voiceParams?: Record<string, number>;
  // soundDNA summary (for soundPackage export)
  soundDNA?: any;
  soundDNASummary?: any;
}

export type OnsetRole = 'kick' | 'bass' | 'lead' | 'hat' | 'perc' | 'acid' | 'pad' | 'clap' | 'shaker' | 'texture';

const STORAGE_KEY = 'psy4-soundbank-v2';

export class SoundBank {
  private entries: Map<string, SoundBankEntry> = new Map();
  private loaded = false;

  constructor() {
    // FIX: auto-load on construction so entries survive page reloads
    this.load();
  }

  private load(): void {
    if (this.loaded) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const arr = JSON.parse(stored) as SoundBankEntry[];
        for (const e of arr) this.entries.set(e.id, e);
      }
    } catch { /* ignore */ }
    this.loaded = true;
  }

  private save(): void {
    try {
      const arr = Array.from(this.entries.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch { /* ignore */ }
  }

  async init(): Promise<void> {
    this.load();
  }

  // NOTE: add() is defined below with legacy 6-arg signature for backward compat.
  // Use addWithParams() for the clean v2 API.

  all(role?: string): SoundBankEntry[] {
    this.load();
    const arr = Array.from(this.entries.values());
    return role ? arr.filter(e => e.role === role) : arr;
  }

  async getStats(): Promise<Record<OnsetRole, number>> {
    this.load();
    const stats: Record<OnsetRole, number> = {
      kick: 0, bass: 0, lead: 0, hat: 0, perc: 0,
      acid: 0, pad: 0, clap: 0, shaker: 0, texture: 0,
    };
    for (const entry of this.entries.values()) {
      if (entry.role in stats) stats[entry.role as OnsetRole]++;
    }
    return stats;
  }

  async count(role?: string): Promise<number> {
    this.load();
    return this.all(role).length;
  }

  async clearAll(): Promise<void> {
    this.entries.clear();
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  async delete(id: string): Promise<void> {
    this.load();
    this.entries.delete(id);
    this.save();
  }

  // ── Backward-compat methods (psyLive.ts + rewardTracker use these) ──

  /** Get a single entry by id, or best entry for a role */
  get(idOrRole: string, opts?: { style?: string }): SoundBankEntry | null {
    this.load();
    // If opts provided, treat as role lookup — return best match
    if (opts) {
      const entries = Array.from(this.entries.values())
        .filter(e => e.role === idOrRole);
      if (entries.length === 0) return null;
      // Sort by reward descending, return best
      entries.sort((a, b) => b.reward - a.reward);
      return entries[0];
    }
    // Otherwise treat as id lookup
    return this.entries.get(idOrRole) ?? null;
  }

  /** Clear all entries for a role */
  async clearRole(role: string): Promise<void> {
    this.load();
    const toDelete: string[] = [];
    for (const [id, entry] of this.entries) {
      if (entry.role === role) toDelete.push(id);
    }
    for (const id of toDelete) this.entries.delete(id);
    this.save();
  }

  /**
   * Update reward for an entry.
   * Signature: updateReward(id, rewardDelta, incrementUsage)
   */
  async updateReward(id: string, rewardDelta: number = 0, incrementUsage: boolean = false): Promise<void> {
    this.load();
    const entry = this.entries.get(id);
    if (entry) {
      entry.reward = Math.max(0, Math.min(1, entry.reward + rewardDelta));
      if (incrementUsage) entry.usageCount++;
      this.save();
    }
  }

  /** Add with full params (backward compat for synthesisMatcher/smartExplorer) */
  addWithParams(
    role: string,
    matchScore: number,
    params: Record<string, number>,
    sourceStyle: string = 'unknown',
  ): SoundBankEntry {
    this.load();
    const id = `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: SoundBankEntry = {
      id,
      role,
      matchScore,
      reward: 0.5,
      usageCount: 0,
      sourceStyle,
      params,
      voiceParams: params,
    };
    this.entries.set(id, entry);
    this.save();
    return entry;
  }

  /**
   * Legacy 6-arg add() for backward compat with psyLive/smartExplorer/soundExplorer.
   * Signature: add(role, soundDNA, recipe, matchScore, sourceStyle, voiceParams)
   * soundDNA + recipe are ignored (v2 doesn't use them — sample-based).
   */
  async add(
    role: string,
    _soundDNA: any,
    _recipe: any,
    matchScore: number,
    sourceStyle: string,
    voiceParams: Record<string, number>,
  ): Promise<SoundBankEntry> {
    return this.addWithParams(role, matchScore, voiceParams, sourceStyle);
  }
}
