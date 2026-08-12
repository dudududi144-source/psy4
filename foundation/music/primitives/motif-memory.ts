/**
 * MotifMemory: long-term memory of motifs seen and used.
 *
 * Each entry tracks usage / success / fail counts, age (bars since last use),
 * confidence and salience. The phrase planner and candidate scorer query the
 * memory to decide what to repeat, what to transform, and what to avoid.
 */

import { type Motif, motifSimilarity } from './motif-v2'

export interface MotifMemoryEntry {
  motif: Motif
  /** Bars since last use (max of any gap). */
  age: number
  /** How many times the motif has been used. */
  usageCount: number
  /** How many times it produced a positive outcome. */
  successCount: number
  /** How many times it collided / produced a negative outcome. */
  failCount: number
  /** Learned confidence 0..1 (smoothed success rate). */
  confidence: number
  /** How prominent / important 0..1. */
  salience: number
  /** Bar index of last use (-1 if never). */
  lastUsedBar: number
  /** Roles this motif has filled. */
  roles: string[]
}

export interface IngestOptions {
  salience?: number
  role?: string
  confidence?: number
}

const DEFAULT_SALIENCE = 0.5
const DEFAULT_CONFIDENCE = 0.5
const CONFIDENCE_LEARNING_RATE = 0.3

export class MotifMemory {
  private entries: Map<string, MotifMemoryEntry> = new Map()
  private currentBar = 0

  /** Add a motif to memory (or refresh if already known). */
  ingest(motif: Motif, bar: number, opts: IngestOptions = {}): void {
    this.currentBar = Math.max(this.currentBar, bar)
    const existing = this.entries.get(motif.id)
    if (existing) {
      existing.salience = Math.max(existing.salience, opts.salience ?? existing.salience)
      if (opts.role && !existing.roles.includes(opts.role)) existing.roles.push(opts.role)
      this.entries.set(motif.id, existing)
      return
    }
    const entry: MotifMemoryEntry = {
      motif,
      age: bar,
      usageCount: 0,
      successCount: 0,
      failCount: 0,
      confidence: opts.confidence ?? DEFAULT_CONFIDENCE,
      salience: opts.salience ?? DEFAULT_SALIENCE,
      lastUsedBar: -1,
      roles: opts.role ? [opts.role] : [],
    }
    this.entries.set(motif.id, entry)
  }

  /** Retrieve a single entry by motif id. */
  retrieve(id: string): MotifMemoryEntry | undefined {
    return this.entries.get(id)
  }

  /** Find the `limit` most similar entries to `motif` (excluding exact id match). */
  findSimilar(motif: Motif, limit: number): MotifMemoryEntry[] {
    const scored: { entry: MotifMemoryEntry; sim: number }[] = []
    for (const entry of this.entries.values()) {
      if (entry.motif.id === motif.id) continue
      const sim = motifSimilarity(entry.motif, motif)
      scored.push({ entry, sim })
    }
    scored.sort((a, b) => b.sim - a.sim)
    return scored.slice(0, Math.max(0, limit)).map((s) => s.entry)
  }

  /** Find the `limit` entries that have filled `role`. */
  findByRole(role: string, limit: number): MotifMemoryEntry[] {
    const matches = Array.from(this.entries.values()).filter((e) => e.roles.includes(role))
    matches.sort((a, b) => b.salience - a.salience)
    return matches.slice(0, Math.max(0, limit))
  }

  /** Mark a motif as used at `bar`; updates age, counts and confidence. */
  markUsed(id: string, bar: number, success: boolean): void {
    const entry = this.entries.get(id)
    if (!entry) return
    this.currentBar = Math.max(this.currentBar, bar)
    entry.usageCount += 1
    if (success) entry.successCount += 1
    else entry.failCount += 1
    const total = entry.successCount + entry.failCount
    const rate = total > 0 ? entry.successCount / total : DEFAULT_CONFIDENCE
    // Smoothed update so early observations don't lock the confidence.
    entry.confidence =
      entry.confidence * (1 - CONFIDENCE_LEARNING_RATE) + rate * CONFIDENCE_LEARNING_RATE
    entry.age = Math.max(0, bar - entry.lastUsedBar)
    entry.lastUsedBar = bar
  }

  /** Maximum age across memory (0 if empty). */
  get age(): number {
    let max = 0
    for (const e of this.entries.values()) {
      const a = e.lastUsedBar < 0 ? this.currentBar : this.currentBar - e.lastUsedBar
      if (a > max) max = a
    }
    return max
  }

  /** Number of entries. */
  get size(): number {
    return this.entries.size
  }

  /** Return the `limit` entries with the lowest usageCount (ties broken by age). */
  leastUsed(limit: number): MotifMemoryEntry[] {
    const arr = Array.from(this.entries.values())
    arr.sort((a, b) => a.usageCount - b.usageCount || b.age - a.age)
    return arr.slice(0, Math.max(0, limit))
  }

  /** Return the `limit` entries with the highest confidence. */
  mostSuccessful(limit: number): MotifMemoryEntry[] {
    const arr = Array.from(this.entries.values())
    arr.sort((a, b) => b.confidence - a.confidence)
    return arr.slice(0, Math.max(0, limit))
  }

  /** Serialise all entries (e.g. for snapshotting between sessions). */
  toJSON(): MotifMemoryEntry[] {
    return Array.from(this.entries.values())
  }

  /** Wipe all entries. */
  clear(): void {
    this.entries.clear()
    this.currentBar = 0
  }
}
