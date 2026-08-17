// VERBATIM SHIM — merged from:
//   psy-foundation/packages/dsp/src/voicePool.ts (Voice interface + VoicePool<V> class)
//   psy-foundation/packages/music/src/rng.ts    (Rng class, mulberry32)
// Do not modify. Replace with:
//   `import { Voice, VoicePool } from '@psy-foundation/dsp'`
//   `import { Rng } from '@psy-foundation/music'`
// when integrated into the canonical workspace.

// ─── voicePool.ts ────────────────────────────────────────────────────────────

/**
 * Voice lifecycle — pooled voice allocation (the pattern from psy5).
 *
 * Voices are pre-allocated and run for the lifetime of the engine. `noteOn`
 * only re-targets AudioParams; no nodes are created or destroyed in the hot
 * path. This eliminates GC-induced audio dropouts.
 *
 * This module provides the abstract pool logic. A concrete voice (synth voice,
 * drum voice, etc.) implements the `Voice` interface.
 */

export interface Voice {
  /** Whether this voice is currently sounding. */
  readonly active: boolean
  /** Trigger the voice with a note + velocity. */
  noteOn(note: number, velocity: number): void
  /** Release the voice (note off). */
  noteOff(): void
  /** Force-stop immediately (panic). */
  panic(): void
}

/**
 * Voice pool — round-robin allocation of pre-created voices.
 *
 * Generic over the voice type. The caller provides a `voiceFactory` that
 * creates a fresh voice on initialization.
 */
export class VoicePool<V extends Voice> {
  private readonly voices: V[]
  private next = 0
  private readonly maxVoices: number

  constructor(voiceFactory: () => V, voiceCount: number) {
    this.voices = Array.from({ length: voiceCount }, () => voiceFactory())
    this.maxVoices = voiceCount
  }

  /** Allocate a voice (round-robin). Steals the oldest if all are active. */
  allocate(): V {
    // Try to find an inactive voice first.
    for (let i = 0; i < this.maxVoices; i++) {
      const idx = (this.next + i) % this.maxVoices
      const v = this.voices[idx]
      if (v && !v.active) {
        this.next = (idx + 1) % this.maxVoices
        return v
      }
    }
    // All active — steal the next in round-robin.
    const stolen = this.voices[this.next]
    if (stolen) stolen.panic()
    const v = this.voices[this.next]
    this.next = (this.next + 1) % this.maxVoices
    return v as V
  }

  /** Trigger a note on an allocated voice. */
  noteOn(note: number, velocity: number): V {
    const v = this.allocate()
    v.noteOn(note, velocity)
    return v
  }

  /** Release all voices (note off on everything). */
  allOff(): void {
    for (const v of this.voices) v.noteOff()
  }

  /** Panic — force-stop all voices. */
  panic(): void {
    for (const v of this.voices) v.panic()
  }

  get size(): number {
    return this.maxVoices
  }

  get activeCount(): number {
    let count = 0
    for (const v of this.voices) if (v.active) count += 1
    return count
  }

  /** Get all voices (for per-voice processing). */
  get all(): readonly V[] {
    return this.voices
  }
}

// ─── rng.ts ──────────────────────────────────────────────────────────────────

/**
 * Deterministic mulberry32 PRNG with convenience sampling helpers.
 * Same seed -> identical sequence across runs and platforms.
 */
export class Rng {
  private state: number
  constructor(seed: number) {
    this.state = seed >>> 0
  }
  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }
  /** Random element of `arr` (must be non-empty). */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Rng.pick: empty array')
    return arr[this.int(0, arr.length - 1)] as T
  }
}
