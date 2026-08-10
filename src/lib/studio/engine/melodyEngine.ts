/**
 * MelodyEngine — professional melodic development engine.
 *
 * Replaces the simple EvolvingSequence-based LeadMotif with a real
 * developmental melodic engine. Implements the classical techniques used
 * by Beethoven, Bach, and modern film/game composers:
 *
 *   - Motif generation with SINGABLE contour (steps over leaps, chord-tone
 *     start/end, resolution-after-leap, octave+3rd range).
 *   - Development techniques: transpose, invert, retrograde, fragment,
 *     elongate (augmentation), shorten (diminution), sequence.
 *   - Phrase structure: A A' B A'' (8-bar developmental phrases, not AABA).
 *   - Tension curves (low/medium/high/peak) drive register, density,
 *     duration, leap probability.
 *   - Call-response: lead plays a "call", arp plays a "response" (descending,
 *     ending on a stable tone) during variation sections.
 *
 * Design notes:
 *   - Motifs store scale degrees (integers, can be negative/>7) so they
 *     transpose cleanly across any scale.
 *   - Strong beats (downbeats, beat 3) snap to chord tones from
 *     PROGRESSIONS[scale] — this keeps the lead compatible with Track H1's
 *     harmony engine (no chord clashes on strong beats).
 *   - Weak beats allow passing tones / neighbor tones.
 *   - All randomness is driven by the supplied SeededRng (deterministic).
 *
 * Task ID: M1 (Melody track).
 */

import { SeededRng, scaleNote, PROGRESSIONS } from './musicalGrammar';
import type { HarmonyEngine } from './harmonyEngine';

// ─── Types ────────────────────────────────────────────────────────────────

export interface Motif {
  /** Scale degrees (integers; negative or >7 wrap octaves via scaleNote). */
  notes: number[];
  /** Note durations in 16th-note steps (1 = 16th, 2 = 8th, 4 = quarter...). */
  durations: number[];
  /** Velocities 0..1. */
  velocities: number[];
  /** Per-position rest flag (true = this slot is a rest). */
  rests: boolean[];
}

export type ContourShape = 'arch' | 'descending' | 'ascending' | 'wave';

interface MotifEvent {
  /** Absolute step within the 8-bar phrase (0..127). */
  stepInPhrase: number;
  /** Scale degree at this event. */
  scaleDeg: number;
  /** Velocity 0..1 (already section/energy weighted). */
  velocity: number;
  /** Duration in 16th steps (capped at 4 for synth gate safety). */
  duration: number;
  /** True = this slot is explicitly a rest. */
  isRest: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────

/** Stable scale degrees: 1st (root), 3rd, 5th. Used for phrase endings. */
const STABLE_DEGREES = [0, 2, 4];

/** Chord-tone offsets from a chord root (root, 3rd, 5th). */
const CHORD_TONE_OFFSETS = [0, 2, 4];

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

// ─── MelodyEngine ─────────────────────────────────────────────────────────

export class MelodyEngine {
  /** The current "call" motif — drives phrase A and the response. */
  private currentMotif: Motif;
  /** Previously generated motif — kept for variation source. */
  private previousMotif: Motif | null = null;
  /** Monotonic counter — used to vary tension across phrases. */
  private phraseCount = 0;

  /** Phrase geometry: 8 bars of 16 steps each = 128 16th-note steps. */
  private readonly phraseBars = 8;
  private readonly stepsPerBar = 16;
  private readonly phraseSteps = 128;

  /** Pre-built event table for the lead's current phrase. */
  private phraseEvents: (MotifEvent | null)[] = new Array(128).fill(null);
  /** Pre-built event table for the arp's response (counter-melody). */
  private responseEvents: (MotifEvent | null)[] = new Array(128).fill(null);

  /** Last call motif — used as source for generateResponse(). */
  private lastCallMotif: Motif | null = null;
  /** Cached energy/tension for incremental rebuilds. */
  private lastEnergy = 0.5;
  private lastTension = 0.5;

  /** Track last bar at which we did an incremental evolution. */
  private lastEvolveBar = -1;

  /**
   * Task V2c: linked HarmonyEngine for chord-tone snapping on strong beats.
   *
   * The MelodyEngine generates phrases using the static PROGRESSIONS[scale]
   * table for chord-tone snapping — but the live HarmonyEngine (Task H1)
   * generates a DIFFERENT progression (with voice leading, modal interchange,
   * energy-driven extensions, etc.). So the lead's chord-tone snapping could
   * target a chord that the pad isn't actually playing, causing dissonance.
   *
   * When `harmony` is set, `nextNote()` re-checks the live chord on strong
   * beats (step % 4 === 0) and snaps the note to the nearest chord tone of
   * the LIVE chord. This eliminates the dissonance: the lead always plays a
   * chord tone on strong beats, regardless of which chord the pad is on.
   *
   * `null` (or never called) → no live snapping; the engine uses the static
   * PROGRESSIONS[scale] snapping done at phrase-build time only. This keeps
   * backwards compatibility with pre-V2c callers.
   */
  private harmony: HarmonyEngine | null = null;

  constructor(
    private root: number,
    private scale: string,
    private rng: SeededRng,
  ) {
    this.currentMotif = this.generateMotif(this.lastEnergy, this.lastTension);
    this.buildPhrase(this.lastEnergy, this.lastTension);
  }

  // ─── Key / configuration ────────────────────────────────────────────────

  /**
   * Task V2c: link the live HarmonyEngine so the melody can snap strong-beat
   * notes to the chord tones of the chord the pad is ACTUALLY playing.
   *
   * This should be called after the HarmonyEngine is constructed (which
   * happens in psy4EngineV2.refreshMusicalGenerators()). The link is
   * re-established on every key change because both engines are rebuilt.
   *
   * Pass `null` to disable live chord-tone snapping (revert to the static
   * PROGRESSIONS[scale] snapping done at phrase-build time).
   */
  setHarmonyEngine(harmony: HarmonyEngine | null): void {
    this.harmony = harmony;
  }

  /**
   * Update root + scale (called on key change). Rebuilds the phrase so the
   * lead immediately follows the new tonal center.
   */
  setKey(root: number, scale: string): void {
    this.root = root;
    this.scale = scale;
    this.previousMotif = null;
    this.lastCallMotif = null;
    this.phraseCount = 0;
    this.currentMotif = this.generateMotif(this.lastEnergy, this.lastTension);
    this.buildPhrase(this.lastEnergy, this.lastTension);
  }

  // ─── Motif generation ──────────────────────────────────────────────────

  /**
   * Generate a fresh motif with SINGABLE contour (4-8 notes).
   *
   * Rules:
   *   - Start on a chord tone (1st/3rd/5th).
   *   - Prefer steps (2nds) over leaps (3rds+).
   *   - After a leap, resolve by step in the opposite direction.
   *   - End on a stable tone (1st/3rd/5th).
   *   - Range: within an octave + a 3rd.
   *   - Duration: mix of 8ths/16ths with occasional longer notes.
   *
   * The contour shape is chosen based on `tension`:
   *   - High tension → ascending / wave (build energy)
   *   - Low tension → descending / wave (release)
   *   - Mid → arch (rise then fall)
   */
  generateMotif(energy: number, tension: number): Motif {
    const numNotes = this.rng.int(4, 8);
    const contour = this.pickContour(tension);

    // Octave shift: high tension lifts the whole motif up; low tension drops it.
    const octShift = tension > 0.65 ? 7 : tension < 0.3 ? -7 : 0;
    // Singable range (scale degrees). -3 (low 3rd) to 9 (octave + 3rd).
    const minDeg = -3 + (octShift < 0 ? 0 : 0);
    const maxDeg = 9 + (octShift > 0 ? 7 : 0);

    const notes: number[] = [];
    const durations: number[] = [];
    const velocities: number[] = [];
    const rests: number[] = [];

    // First note: chord tone.
    const startDeg = this.rng.pick(STABLE_DEGREES) + octShift;
    notes.push(startDeg);
    durations.push(this.pickDuration(tension, true));
    velocities.push(this.pickVelocity(energy, tension, true));
    rests.push(0);

    let prevDelta = 0;

    for (let i = 1; i < numNotes; i++) {
      const progress = i / numNotes; // 0..1 through motif
      let delta: number;

      // After a leap (3rd or larger), 75% chance to resolve by step in opposite direction.
      if (Math.abs(prevDelta) >= 2 && this.rng.chance(0.75)) {
        delta = prevDelta > 0 ? -1 : 1;
      } else {
        // Otherwise: prefer steps. Leap probability rises with tension.
        const leapProb = 0.15 + tension * 0.35;
        if (this.rng.chance(leapProb)) {
          // Leap: 3rd, 4th, 5th (up or down).
          delta = this.rng.pick([2, 2, 3, 4, -2, -2, -3, -4]);
        } else {
          // Step: mostly 2nds, occasionally a repeat or skip.
          delta = this.rng.pick([1, 1, 1, -1, -1, -1, 0, 2, -2]);
        }
        // Bias direction by contour shape.
        delta = this.applyContourBias(delta, contour, progress);
      }

      let nextDeg = notes[i - 1] + delta;
      // Clamp to singable range — bounce back if exceeded.
      if (nextDeg < minDeg) nextDeg = notes[i - 1] + 1;
      if (nextDeg > maxDeg) nextDeg = notes[i - 1] - 1;

      notes.push(nextDeg);
      durations.push(this.pickDuration(tension, false));
      velocities.push(this.pickVelocity(energy, tension, false));
      rests.push(0);
      prevDelta = delta;
    }

    // End on a stable tone (1st, 3rd, 5th) — pick nearest stable degree.
    const lastIdx = notes.length - 1;
    notes[lastIdx] = this.nearestStableDegree(notes[lastIdx]);

    // Insert occasional rests (low tension → more rests).
    const restProb = 0.05 + (1 - tension) * 0.2;
    for (let i = 1; i < notes.length; i++) {
      if (this.rng.chance(restProb)) {
        rests[i] = 1; // mark as rest
      }
    }

    return {
      notes,
      durations,
      velocities,
      rests: rests.map((r) => r === 1),
    };
  }

  /** Choose a contour shape based on tension. */
  private pickContour(tension: number): ContourShape {
    if (tension > 0.8) return this.rng.pick<ContourShape>(['ascending', 'wave']);
    if (tension > 0.6) return this.rng.pick<ContourShape>(['ascending', 'arch']);
    if (tension < 0.3) return this.rng.pick<ContourShape>(['descending', 'wave']);
    return this.rng.pick<ContourShape>(['arch', 'wave', 'descending']);
  }

  /**
   * Bias a step direction by the chosen contour.
   * - ascending: prefer up-steps
   * - descending: prefer down-steps
   * - arch: up in first half, down in second half
   * - wave: alternate direction every 2 notes
   */
  private applyContourBias(delta: number, contour: ContourShape, progress: number): number {
    switch (contour) {
      case 'ascending':
        if (delta < 0 && this.rng.chance(0.6)) return Math.abs(delta);
        return delta;
      case 'descending':
        if (delta > 0 && this.rng.chance(0.6)) return -Math.abs(delta);
        return delta;
      case 'arch':
        if (progress < 0.5 && delta < 0 && this.rng.chance(0.6)) return Math.abs(delta);
        if (progress >= 0.5 && delta > 0 && this.rng.chance(0.6)) return -Math.abs(delta);
        return delta;
      case 'wave': {
        const phase = Math.floor(progress * 4) % 2;
        if (phase === 0 && delta < 0 && this.rng.chance(0.5)) return Math.abs(delta);
        if (phase === 1 && delta > 0 && this.rng.chance(0.5)) return -Math.abs(delta);
        return delta;
      }
    }
    return delta;
  }

  /** Pick a duration (in 16th steps) based on tension. */
  private pickDuration(tension: number, isFirst: boolean): number {
    // Low tension → slow notes (4-8). Peak → 16ths only.
    if (tension < 0.3) return this.rng.pick([4, 6, 8]);
    if (tension < 0.6) return this.rng.pick([2, 4, 4]);
    if (tension < 0.8) return this.rng.pick([1, 2, 2]);
    // Peak: mostly 16ths, occasional 8th.
    return this.rng.pick([1, 1, 2]);
  }

  /** Pick a velocity based on energy + whether this is a strong beat. */
  private pickVelocity(energy: number, _tension: number, isStrong: boolean): number {
    const base = isStrong ? 0.7 : 0.5;
    return clamp(base * (0.6 + energy * 0.4), 0.1, 1.0);
  }

  /** Find the nearest stable degree (1st/3rd/5th) to a given scale degree. */
  private nearestStableDegree(deg: number): number {
    let nearest = STABLE_DEGREES[0];
    let nearestDist = Infinity;
    for (const s of STABLE_DEGREES) {
      // Search across octaves (steps of 7 scale degrees).
      for (let oct = -7; oct <= 7; oct += 7) {
        const candidate = s + oct;
        const dist = Math.abs(candidate - deg);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = candidate;
        }
      }
    }
    return nearest;
  }

  /** Find the nearest chord tone (root/3rd/5th of `chordDeg`) to `deg`. */
  private nearestChordTone(deg: number, chordDeg: number): number {
    let nearest = chordDeg;
    let nearestDist = Infinity;
    for (const off of CHORD_TONE_OFFSETS) {
      for (let oct = -7; oct <= 7; oct += 7) {
        const candidate = chordDeg + off + oct;
        const dist = Math.abs(candidate - deg);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = candidate;
        }
      }
    }
    return nearest;
  }

  // ─── Development techniques ─────────────────────────────────────────────

  /** Transpose a motif by N scale degrees (clean — stays in scale). */
  transpose(motif: Motif, scaleSteps: number): Motif {
    return {
      notes: motif.notes.map((n) => n + scaleSteps),
      durations: [...motif.durations],
      velocities: [...motif.velocities],
      rests: [...motif.rests],
    };
  }

  /**
   * Melodic inversion — flip the contour upside-down.
   * First note stays; subsequent deltas are negated.
   */
  invert(motif: Motif): Motif {
    if (motif.notes.length === 0) {
      return { notes: [], durations: [], velocities: [], rests: [] };
    }
    const first = motif.notes[0];
    const invertedNotes = [first];
    for (let i = 1; i < motif.notes.length; i++) {
      const delta = motif.notes[i] - motif.notes[i - 1];
      invertedNotes.push(invertedNotes[i - 1] - delta);
    }
    return {
      notes: invertedNotes,
      durations: [...motif.durations],
      velocities: [...motif.velocities],
      rests: [...motif.rests],
    };
  }

  /** Retrograde — play the motif backwards. */
  retrograde(motif: Motif): Motif {
    return {
      notes: [...motif.notes].reverse(),
      durations: [...motif.durations].reverse(),
      velocities: [...motif.velocities].reverse(),
      rests: [...motif.rests].reverse(),
    };
  }

  /** Fragment — take a sub-range of the motif (a 2-3 note cell). */
  fragment(motif: Motif, startIdx: number, length: number): Motif {
    const end = Math.min(startIdx + length, motif.notes.length);
    const actualStart = Math.max(0, Math.min(startIdx, motif.notes.length - 1));
    return {
      notes: motif.notes.slice(actualStart, end),
      durations: motif.durations.slice(actualStart, end),
      velocities: motif.velocities.slice(actualStart, end),
      rests: motif.rests.slice(actualStart, end),
    };
  }

  /** Elongate (rhythmic augmentation) — multiply durations by `factor`. */
  elongate(motif: Motif, factor: number): Motif {
    return {
      notes: [...motif.notes],
      durations: motif.durations.map((d) => Math.max(1, Math.round(d * factor))),
      velocities: [...motif.velocities],
      rests: [...motif.rests],
    };
  }

  /** Shorten (rhythmic diminution) — divide durations by `factor`. */
  shorten(motif: Motif, factor: number): Motif {
    return this.elongate(motif, 1 / factor);
  }

  /**
   * Sequence — repeat the motif at successively higher/lower scale degrees.
   * The classic melodic development technique (Beethoven, Bach, film composers).
   * Default shift = 2 scale degrees per repeat (up/down a 3rd).
   */
  sequence(motif: Motif, steps: number, direction: 'up' | 'down'): Motif[] {
    const out: Motif[] = [motif];
    const dir = direction === 'up' ? 1 : -1;
    const shiftPerStep = 2;
    for (let i = 1; i < Math.max(1, steps); i++) {
      out.push(this.transpose(motif, dir * shiftPerStep * i));
    }
    return out;
  }

  // ─── Call / Response ────────────────────────────────────────────────────

  /**
   * Generate a "response" motif that answers a "call" motif.
   * The response:
   *   - Inverts the call's contour (call ascending → response descending).
   *   - Ends on the root (most stable tone).
   *   - Shortens durations for a lighter, "answering" feel.
   */
  generateResponse(prevPhrase: Motif): Motif {
    const inverted = this.invert(prevPhrase);
    // Force the response to end on the root (degree 0) — definitive "answer".
    if (inverted.notes.length > 0) {
      inverted.notes[inverted.notes.length - 1] = 0;
    }
    // Lighter rhythm (twice as fast).
    const response = this.shorten(inverted, 2);
    // Slightly lower velocity for the response (counter-melody feel).
    response.velocities = response.velocities.map((v) => clamp(v * 0.8, 0.1, 1.0));
    return response;
  }

  // ─── Phrase structure: A A' B A'' ───────────────────────────────────────

  /**
   * Force a new phrase at section boundaries.
   * Computes internal tension from energy + phraseCount, generates a fresh
   * call motif, and rebuilds the 8-bar developmental phrase.
   */
  newPhrase(energy: number): void {
    this.phraseCount++;
    this.lastEnergy = energy;
    const tension = this.computeTension(energy, this.phraseCount);
    this.lastTension = tension;
    this.previousMotif = this.currentMotif;
    this.currentMotif = this.generateMotif(energy, tension);
    this.buildPhrase(energy, tension);
  }

  /**
   * Tension curves — maps energy (0..1) to melodic behavior.
   *   - Low (0..0.3): slow, low register, consonant, rests.
   *   - Medium (0.3..0.6): mid register, mostly steps.
   *   - High (0.6..0.8): faster, ascending sequences, leaps.
   *   - Peak (0.8..1.0): fastest, highest register, climbing sequences.
   *
   * We add a small periodic variation so consecutive phrases don't all hit
   * the same tension peak even at the same energy level.
   */
  private computeTension(energy: number, phraseCount: number): number {
    const phase = (phraseCount % 4) / 4;
    const variation = 0.12 * Math.sin(2 * Math.PI * phase);
    return clamp(energy + variation, 0, 1);
  }

  /**
   * Build the 8-bar phrase events from the current motif.
   *   - A (bars 0-1): state the motif.
   *   - A' (bars 2-3): variation — transpose up a 3rd OR fragment & repeat.
   *   - B (bars 4-5): contrasting motif (fresh, different contour).
   *   - A'' (bars 6-7): return + development — augment + sequence up.
   */
  private buildPhrase(energy: number, tension: number): void {
    // Clear event tables.
    this.phraseEvents = new Array(this.phraseSteps).fill(null);
    this.responseEvents = new Array(this.phraseSteps).fill(null);

    // A — original motif.
    const sectionA = this.currentMotif;

    // A' — variation: transpose up a 3rd (2 scale degrees) OR fragment+repeat.
    const aPrime = this.rng.chance(0.5)
      ? this.transpose(sectionA, 2)
      : this.repeatFragment(sectionA);

    // B — contrasting motif (fresh, with higher tension for contrast).
    const sectionB = this.generateMotif(energy, clamp(tension + 0.2, 0, 1));

    // A'' — augmented + sequenced up (slower, then sequenced).
    const augmented = this.elongate(sectionA, 2);
    const sequenceChain = this.sequence(augmented, 2, 'up');
    const aDoublePrime = sequenceChain[1] ?? augmented;

    // Place each section at its bar range.
    this.placeMotifInPhrase(sectionA, 0, this.phraseEvents, true);
    this.placeMotifInPhrase(aPrime, 2, this.phraseEvents, true);
    this.placeMotifInPhrase(sectionB, 4, this.phraseEvents, true);
    this.placeMotifInPhrase(aDoublePrime, 6, this.phraseEvents, true);

    // Cache the call motif and build the arp's response.
    this.lastCallMotif = sectionA;
    this.buildResponseEvents(energy, tension);
  }

  /** Repeat a 2-3 note fragment to fill A' — classic motivic development. */
  private repeatFragment(motif: Motif): Motif {
    const fragLen = Math.min(3, motif.notes.length);
    const frag = this.fragment(motif, 0, fragLen);
    // Repeat the fragment 2-3 times to fill the section.
    const repeats = Math.max(2, Math.floor(8 / Math.max(1, frag.notes.length)));
    const notes: number[] = [];
    const durations: number[] = [];
    const velocities: number[] = [];
    const rests: boolean[] = [];
    for (let r = 0; r < repeats; r++) {
      // Optional transpose on each repeat for sequence feel.
      const transpose = r * 1;
      for (let i = 0; i < frag.notes.length; i++) {
        notes.push(frag.notes[i] + transpose);
        durations.push(frag.durations[i]);
        velocities.push(frag.velocities[i]);
        rests.push(frag.rests[i]);
      }
    }
    return { notes, durations, velocities, rests };
  }

  /**
   * Place a motif's events into the phrase event table starting at `startBar`.
   * Snaps strong beats to chord tones (from PROGRESSIONS[scale]) so the lead
   * never clashes with the harmony engine's chord changes.
   */
  private placeMotifInPhrase(
    motif: Motif,
    startBar: number,
    events: (MotifEvent | null)[],
    snapChordTones: boolean,
  ): void {
    const sectionBars = 2;
    const startStep = startBar * this.stepsPerBar;
    const endStep = startStep + sectionBars * this.stepsPerBar;
    const prog = PROGRESSIONS[this.scale] || PROGRESSIONS.minor;
    let curStep = startStep;

    for (let i = 0; i < motif.notes.length; i++) {
      if (curStep >= endStep) break;
      if (curStep >= this.phraseSteps) break;

      const dur = Math.max(1, motif.durations[i]);
      const isRest = motif.rests[i];

      if (!isRest) {
        let deg = motif.notes[i];

        if (snapChordTones) {
          // Determine which bar (in absolute phrase terms) we're in.
          const barWithinPhrase = Math.floor(curStep / this.stepsPerBar);
          const stepWithinBar = curStep % this.stepsPerBar;
          const chordDeg = prog[barWithinPhrase % prog.length];

          if (stepWithinBar === 0) {
            // Downbeat → snap to nearest chord tone.
            deg = this.nearestChordTone(deg, chordDeg);
          } else if (stepWithinBar === 8 && this.rng.chance(0.5)) {
            // Beat 3 → snap to a chord tone (3rd or 5th).
            deg = this.rng.pick([chordDeg + 2, chordDeg + 4]);
          }
          // Otherwise: keep the motif's scale degree (passing/neighbor tone).
        }

        events[curStep] = {
          stepInPhrase: curStep,
          scaleDeg: deg,
          velocity: motif.velocities[i],
          // Cap duration at 4 (quarter note) to avoid synth-gate overflow.
          duration: Math.min(dur, 4),
          isRest: false,
        };
      }

      curStep += dur;
    }
  }

  /**
   * Build the arp's response events from the last call motif.
   * The response plays in bars 4-7 of the phrase (the "answer" portion),
   * typically during VARIATION sections.
   */
  private buildResponseEvents(energy: number, tension: number): void {
    this.responseEvents = new Array(this.phraseSteps).fill(null);
    if (!this.lastCallMotif) return;

    const response = this.generateResponse(this.lastCallMotif);
    // Place the response starting at bar 4 (the B / A'' region).
    // No chord-tone snapping — the response is a counter-melody and can
    // use passing tones freely.
    this.placeMotifInPhrase(response, 4, this.responseEvents, false);
  }

  // ─── Per-step note lookup ───────────────────────────────────────────────

  /**
   * Get the next lead note for the given step/bar/energy.
   * Returns null for rests or steps with no scheduled event.
   *
   * The lead plays at root+12 (one octave above the bass root).
   *
   * Task V2c: if a HarmonyEngine is linked, the note is re-checked on strong
   * beats (step % 4 === 0) against the LIVE chord the pad is playing. If the
   * note's pitch class is NOT a chord tone, it's snapped to the nearest chord
   * tone (preserving the original octave as closely as possible). This
   * eliminates dissonance between the lead and the pad — the lead always
   * plays a chord tone on strong beats, regardless of which chord the pad's
   * progression has reached.
   *
   * On weak beats (step % 4 !== 0), the original note is preserved —
   * passing tones / neighbor tones on weak beats are musically valid (they
   * create tension that resolves on the next strong beat).
   */
  nextNote(
    step: number,
    bar: number,
    energy: number,
  ): { note: number; velocity: number; duration: number } | null {
    const phraseBar = ((bar % this.phraseBars) + this.phraseBars) % this.phraseBars;
    const phraseStep = phraseBar * this.stepsPerBar + (step % this.stepsPerBar);

    const event = this.phraseEvents[phraseStep];
    if (!event || event.isRest) return null;

    let midi = scaleNote(this.root + 12, this.scale, event.scaleDeg);

    // ── Task V2c: melody-harmony synchronization ──
    // On strong beats (every quarter note = step % 4 === 0), snap the note
    // to the nearest chord tone of the LIVE chord (the one the pad is
    // playing right now). This makes the lead harmonize with the pad on
    // every downbeat — no clashing non-chord tones on strong beats.
    if (this.harmony) {
      const isStrongBeat = step % 4 === 0;
      if (isStrongBeat) {
        midi = this.snapToLiveChordTone(midi);
      }
    }

    const vel = clamp(event.velocity * (0.6 + energy * 0.4), 0.1, 1.0);
    return { note: midi, velocity: vel, duration: event.duration };
  }

  /**
   * Task V2c: snap a MIDI note to the nearest chord tone of the live chord.
   *
   * If the note is already a chord tone (any octave), it's returned unchanged.
   * Otherwise, the nearest chord-tone pitch class is found, and the note is
   * shifted to the octave that minimizes movement from the original note
   * (so the melodic contour is preserved as much as possible).
   *
   * If the harmony engine has no current chord (e.g. before the first chord
   * plays, or outside a lead section), the note is returned unchanged — the
   * static PROGRESSIONS[scale] snapping from placeMotifInPhrase still applies.
   */
  private snapToLiveChordTone(midi: number): number {
    if (!this.harmony) return midi;
    const chord = this.harmony.getCurrentChord();
    if (!chord || chord.notes.length === 0) return midi;

    // Pitch classes of the live chord.
    const chordPCs = chord.notes.map(n => ((n % 12) + 12) % 12);
    const midiPC = ((midi % 12) + 12) % 12;

    // Already a chord tone? Leave it alone — preserves melodic identity.
    if (chordPCs.includes(midiPC)) return midi;

    // Find the nearest chord-tone pitch class (chromatic distance, wraparound).
    let nearestPC = chordPCs[0];
    let nearestDist = Infinity;
    for (const pc of chordPCs) {
      const d = Math.min(
        Math.abs(pc - midiPC),
        12 - Math.abs(pc - midiPC),
      );
      if (d < nearestDist) {
        nearestDist = d;
        nearestPC = pc;
      }
    }

    // Place the snapped pitch class at the octave closest to the original
    // note. We pick the octave so the result is within a half-octave of the
    // original — this keeps the melodic contour smooth (no jumps).
    const octaveBase = midi - midiPC; // midi with PC zeroed out
    let snapped = octaveBase + nearestPC;
    // If we wrapped past 0/11, snap may be off by an octave — correct it.
    while (snapped - midi > 6) snapped -= 12;
    while (midi - snapped > 6) snapped += 12;

    // Clamp to a sane lead range (don't snap above MIDI 96 or below 36).
    while (snapped > 96) snapped -= 12;
    while (snapped < 36) snapped += 12;

    return snapped;
  }

  /**
   * Get the next response note for the arp (counter-melody to the lead).
   * Returns null when no response event is scheduled.
   *
   * The arp plays at root+24 (two octaves above the bass root) — brighter
   * register so it sits above the lead as a true counter-melody.
   */
  nextResponseNote(
    step: number,
    bar: number,
    energy: number,
  ): { note: number; velocity: number; duration: number } | null {
    const phraseBar = ((bar % this.phraseBars) + this.phraseBars) % this.phraseBars;
    const phraseStep = phraseBar * this.stepsPerBar + (step % this.stepsPerBar);

    const event = this.responseEvents[phraseStep];
    if (!event || event.isRest) return null;

    const midi = scaleNote(this.root + 24, this.scale, event.scaleDeg);
    const vel = clamp(event.velocity * (0.55 + energy * 0.35), 0.1, 1.0);
    return { note: midi, velocity: vel, duration: event.duration };
  }

  // ─── Incremental evolution ──────────────────────────────────────────────

  /**
   * Per-bar evolution tick. Called from the engine's scheduler every bar.
   * Unlike LeadMotif (which mutated one note at a time), MelodyEngine
   * refreshes the B section (contrasting motif) at intervals — this gives
   * fresh variation without losing the A-section identity.
   *
   * Effective interval shrinks as `evolutionRate` grows (faster evolution
   * for more dynamic worlds like Goa / acid-psy).
   */
  tickEvolution(bar: number, evolutionRate = 0.4, intervalBars = 8): void {
    if (bar <= 0) return;
    if (bar <= this.lastEvolveBar) return;
    const effectiveInterval = Math.max(4, Math.round(intervalBars * (1.2 - evolutionRate)));
    if (bar % effectiveInterval !== 0) return;
    this.lastEvolveBar = bar;
    this.regenerateBSection();
  }

  /** Refresh only the B section (bars 4-5) with a new contrasting motif. */
  private regenerateBSection(): void {
    // Clear B section events.
    for (let s = 4 * this.stepsPerBar; s < 6 * this.stepsPerBar; s++) {
      this.phraseEvents[s] = null;
    }
    const tension = clamp(this.lastTension + 0.15, 0, 1);
    const newB = this.generateMotif(this.lastEnergy, tension);
    this.placeMotifInPhrase(newB, 4, this.phraseEvents, true);
  }

  // ─── Inspection (for debugging / UI) ────────────────────────────────────

  /** Get the current call motif (read-only). */
  getCurrentMotif(): Motif {
    return {
      notes: [...this.currentMotif.notes],
      durations: [...this.currentMotif.durations],
      velocities: [...this.currentMotif.velocities],
      rests: [...this.currentMotif.rests],
    };
  }

  /** Get the previous call motif (if any). */
  getPreviousMotif(): Motif | null {
    if (!this.previousMotif) return null;
    return {
      notes: [...this.previousMotif.notes],
      durations: [...this.previousMotif.durations],
      velocities: [...this.previousMotif.velocities],
      rests: [...this.previousMotif.rests],
    };
  }

  /** Phrase counter — how many phrases have been generated. */
  getPhraseCount(): number {
    return this.phraseCount;
  }
}
