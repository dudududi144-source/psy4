/**
 * HarmonyEngine — professional-grade chord progression + voice leading engine.
 *
 * Replaces PSY4's previous "chordRoot + fifth" pad voicing with:
 *   - 11 chord types (triad, maj7, min7, dom7, min9, maj9, sus2, sus4, dim, aug, min7b5)
 *   - Voice leading: common-tone preservation + smallest-interval motion + parallel-fifth avoidance
 *   - Scale-appropriate progressions per scale (minor, phrygian, dorian, phrygianDominant, harmonicMinor, doubleHarmonic, minorPentatonic)
 *   - Modal interchange: borrow chords from parallel scales (parallel minor ↔ major, etc.)
 *   - Bass inversions for smooth bass motion
 *   - Energy-driven extension selection (triads in breaks → 7ths/9ths in drops)
 *   - Counterpoint support: getAvoidNotes() so the lead can shape itself around the current chord
 *
 * The chord ROOT is found via scaleNote() (scale-correct). The chord INTERVALS are
 * fixed semitone patterns per ChordType (per the task spec). For 'triad' specifically,
 * the quality (maj/min/dim/aug) is derived from the diatonic scale, so triads are
 * always diatonic. For 7th/9th types, the diatonic quality is matched to the closest
 * standard type (e.g. min degree → min7, maj degree → maj7, dim degree → min7b5).
 *
 * This module is pure (no Web Audio). It produces Chord / ChordVoicing objects that
 * psy4EngineV2 schedules via triggerSynth() — one triggerSynth per voicing note.
 */

import { SCALES, scaleNote, SeededRng } from './musicalGrammar';

// ─── Chord Types ────────────────────────────────────────────────────────────

export type ChordType =
  | 'triad' | 'maj7' | 'min7' | 'dom7' | 'min9' | 'maj9'
  | 'sus2' | 'sus4' | 'dim' | 'aug' | 'min7b5';

export interface Chord {
  root: number;        // MIDI note (root in bass register, ~36-48)
  type: ChordType;
  scaleDegree: number; // 0-6 (or 0-7 for extended, wraps modulo scale length)
  inversion: number;   // 0=root, 1=first, 2=second, 3=third (for 7ths)
  notes: number[];     // MIDI notes in root position (4-5 notes for 7th/9th)
}

export interface ChordVoicing {
  notes: number[];     // final MIDI notes to play (voice-led, bass note first/lowest)
  bassNote: number;    // bass note (lowest voice — root or inversion)
}

// ─── Chord Interval Templates (semitones from root) ─────────────────────────
// Per the task spec — these are FIXED interval patterns per ChordType.

const CHORD_INTERVALS: Record<ChordType, number[]> = {
  triad:  [0, 4, 7],            // major triad (overridden for min/dim/aug diatonically)
  maj7:   [0, 4, 7, 11],
  min7:   [0, 3, 7, 10],
  dom7:   [0, 4, 7, 10],
  min9:   [0, 3, 7, 10, 14],
  maj9:   [0, 4, 7, 11, 14],
  sus2:   [0, 2, 7],
  sus4:   [0, 5, 7],
  dim:    [0, 3, 6],
  aug:    [0, 4, 8],
  min7b5: [0, 3, 6, 10],
};

// Diatonic quality categories — used to match extended types to diatonic chords.
type DiatonicQuality = 'maj' | 'min' | 'dim' | 'aug';

// ─── Scale-Specific Progressions ────────────────────────────────────────────
// Each entry is an array of scale-degree templates (degrees 0-6, can repeat).
// These are the "classic" progressions for each scale type used in psytrance.
// Selected from music theory + psytrance convention (e.g. i-VI-III-VII for minor).

const SCALE_PROGRESSIONS: Record<string, number[][]> = {
  minor: [
    [0, 5, 2, 6],          // i - VI - III - VII (classic)
    [0, 3, 6, 2],          // i - iv - VII - III (modal)
    [0, 6, 5, 6],          // i - VII - VI - VII (descending)
    [0, 5, 3, 4],          // i - VI - iv - v
    [0, 3, 4, 0],          // i - iv - v - i (tense resolution)
    [0, 5, 6, 5],          // i - VI - VII - VI
  ],
  phrygian: [
    [0, 1, 0, 6],          // i - bII - i - bVII (dark, goa-classic)
    [0, 5, 2, 6],          // i - bVI - bIII - bVII
    [0, 1, 6, 5],          // i - bII - bVII - bVI
    [0, 6, 5, 1],          // i - bVII - bVI - bII
    [0, 1, 0, 5],          // i - bII - i - bVI
  ],
  harmonicMinor: [
    [0, 3, 4, 0],          // i - iv - V - i (tense, V major = harmonic minor signature)
    [0, 5, 2, 4],          // i - VI - iii - V
    [0, 4, 3, 0],          // i - V - iv - i
    [0, 5, 4, 0],          // i - VI - V - i
    [0, 4, 5, 4],          // i - V - VI - V (dramatic)
  ],
  dorian: [
    [0, 3, 0, 6],          // i - IV - i - VII (uplifting, dorian signature)
    [0, 6, 3, 0],          // i - VII - IV - i
    [0, 3, 6, 3],          // i - IV - VII - IV
    [0, 6, 5, 3],          // i - VII - VI - IV
    [0, 3, 4, 6],          // i - IV - v - VII
  ],
  phrygianDominant: [
    [0, 1, 0, 6],          // i - bII - i - bVII (goa signature)
    [0, 3, 6, 2],          // i - IV - bVII - III
    [0, 1, 6, 5],          // i - bII - bVII - bVI
    [0, 5, 4, 0],          // i - bVI - V - i
    [0, 1, 4, 1],          // i - bII - V - bII (arabic-feel)
  ],
  doubleHarmonic: [
    [0, 1, 0, 4],          // i - bII - i - V
    [0, 5, 4, 0],          // i - bVI - V - i
    [0, 1, 4, 1],          // i - bII - V - bII
    [0, 4, 1, 0],          // i - V - bII - i
    [0, 5, 1, 4],          // i - bVI - bII - V
  ],
  minorPentatonic: [
    [0, 2, 3, 4],          // i - III - IV - V (pentatonic-friendly)
    [0, 4, 3, 0],          // i - V - IV - i
    [0, 3, 4, 2],          // i - IV - V - III
    [0, 2, 4, 3],          // i - III - V - IV
  ],
};

// Default fallback progression when scale isn't recognized
const DEFAULT_PROGRESSION = SCALE_PROGRESSIONS.minor[0];

// ─── Bass / Pad Register Constants ──────────────────────────────────────────
// Bass note of the pad voicing lives here (above the sub-bass track 4 at MIDI 31-43).
const PAD_BASS_LOW = 48;   // C3
const PAD_BASS_HIGH = 59;  // B3
// Upper voices of the pad chord live here.
const PAD_UPPER_CENTER = 64;  // E4 — comfortable mid register
const PAD_UPPER_LOW = 55;   // G3
const PAD_UPPER_HIGH = 79;  // G5

// ─── HarmonyEngine ──────────────────────────────────────────────────────────

export class HarmonyEngine {
  private currentChord: Chord | null = null;
  private previousVoicing: number[] = [];   // upper voices only (no bass)
  private rng: SeededRng;
  private progressionPool: number[][];

  constructor(private root: number, private scale: string) {
    // Deterministic seed per key — same key produces same progression pool ordering.
    const seed = (root * 31 + scale.length * 7 + 13) >>> 0;
    this.rng = new SeededRng(seed);
    this.progressionPool = SCALE_PROGRESSIONS[scale] || SCALE_PROGRESSIONS.minor;
  }

  // ── Diatonic Quality ────────────────────────────────────────────────────
  // Determine the diatonic triad quality for a scale degree (maj/min/dim/aug).
  // Computed by stacking thirds from the scale.

  private diatonicQuality(degree: number): DiatonicQuality {
    const sc = SCALES[this.scale] || SCALES.minor;
    const n = sc.length;
    const idx = ((degree % n) + n) % n;
    const rootInt = sc[idx];
    const thirdIdx = (idx + 2) % n;
    const fifthIdx = (idx + 4) % n;
    const thirdInt = sc[thirdIdx] + (idx + 2 >= n ? 12 : 0) - rootInt;
    const fifthInt = sc[fifthIdx] + (idx + 4 >= n ? 12 : 0) - rootInt;
    if (fifthInt === 6) return 'dim';
    if (fifthInt === 8) return 'aug';
    return thirdInt === 3 ? 'min' : 'maj';
  }

  // ── Build Intervals ─────────────────────────────────────────────────────
  // For 'triad': use diatonic quality (maj/min/dim/aug).
  // For 7th/9th types: use fixed CHORD_INTERVALS.
  // For 'triad'-derived extensions, the diatonic quality is honored by adapting
  // the requested type to the closest standard chord type.

  private buildIntervals(degree: number, type: ChordType): number[] {
    if (type === 'triad') {
      const q = this.diatonicQuality(degree);
      switch (q) {
        case 'maj': return [0, 4, 7];
        case 'min': return [0, 3, 7];
        case 'dim': return [0, 3, 6];
        case 'aug': return [0, 4, 8];
      }
    }
    return CHORD_INTERVALS[type];
  }

  // Adapt a requested chord type to the diatonic quality of the degree.
  // This ensures 7ths/9ths match the scale (e.g. a 'maj7' on a minor degree
  // becomes 'min7'; a 'maj7' on a dim degree becomes 'min7b5').
  private adaptTypeToDiatonic(degree: number, type: ChordType): ChordType {
    if (type === 'triad' || type === 'sus2' || type === 'sus4' ||
        type === 'dim' || type === 'aug' || type === 'dom7' || type === 'min7b5') {
      return type;  // explicit types — use as-is
    }
    const q = this.diatonicQuality(degree);
    // Map (maj/min/dim/aug) × (maj7/min7/maj9/min9) → standard type
    if (type === 'maj7' || type === 'min7') {
      switch (q) {
        case 'maj': return 'maj7';
        case 'min': return 'min7';
        case 'dim': return 'min7b5';
        case 'aug': return 'maj7';  // augmaj7 — use maj7 (close enough; aug is rare)
      }
    }
    if (type === 'maj9' || type === 'min9') {
      switch (q) {
        case 'maj': return 'maj9';
        case 'min': return 'min9';
        case 'dim': return 'min7b5';  // dim9 doesn't standardly exist; fall back to min7b5
        case 'aug': return 'maj9';
      }
    }
    return type;
  }

  // ── getChord ────────────────────────────────────────────────────────────
  // Build a Chord object for a scale degree with the specified type.
  // The root is placed in the bass register (MIDI 36-47) via scaleNote().

  getChord(degree: number, type?: ChordType): Chord {
    const requestedType = type || 'triad';
    const adaptedType = this.adaptTypeToDiatonic(degree, requestedType);
    // Find the scale-degree root MIDI note in bass register.
    let rootMidi = scaleNote(this.root, this.scale, degree);
    while (rootMidi >= PAD_BASS_HIGH) rootMidi -= 12;
    while (rootMidi < PAD_BASS_LOW - 12) rootMidi += 12;
    // Build chord tones (root position)
    const intervals = this.buildIntervals(degree, adaptedType);
    const notes = intervals.map(iv => rootMidi + iv);
    return {
      root: rootMidi,
      type: adaptedType,
      scaleDegree: ((degree % 7) + 7) % 7,
      inversion: 0,
      notes,
    };
  }

  // ── generateProgression ─────────────────────────────────────────────────
  // Generate 4-8 chords appropriate for the current scale.
  // `bars` is the section length in bars; the progression is padded/clamped to 4-8.
  // `energy` drives the extension level (triads in breaks, 7ths/9ths in drops).

  generateProgression(bars: number, energy: number): Chord[] {
    const template = this.rng.pick(this.progressionPool) || DEFAULT_PROGRESSION;
    const ext = this.getExtension(energy);

    // Section length: clamp to 4-8 chords (per task spec).
    const count = clamp(Math.max(4, Math.min(8, bars)), 4, 8);

    const result: Chord[] = [];
    let prevBass = 0;
    for (let i = 0; i < count; i++) {
      const deg = template[i % template.length];

      // 1-in-7 chance of borrowing a chord (modal interchange) for color,
      // but never on the first chord (keep the tonic anchor).
      if (i > 0 && this.rng.chance(0.14)) {
        const borrowed = this.borrowChord();
        borrowed.inversion = this.chooseInversion(prevBass, borrowed.root);
        result.push(borrowed);
        prevBass = this.bassNoteFor(borrowed);
        continue;
      }

      // Most chords use the section's extension; some are triads for contrast.
      const useTriad = this.rng.chance(0.22);
      const chordType = useTriad ? 'triad' : ext;
      const chord = this.getChord(deg, chordType);
      // Choose inversion for smooth bass motion.
      chord.inversion = this.chooseInversion(prevBass, chord.root);
      result.push(chord);
      prevBass = this.bassNoteFor(chord);
    }

    // Reset voice-leading state for a fresh section start.
    this.previousVoicing = [];
    this.currentChord = null;
    return result;
  }

  // ── voiceLead ───────────────────────────────────────────────────────────
  // The KEY method: produce a ChordVoicing for the next chord that minimizes
  // voice movement from the previous voicing.
  //
  // Algorithm:
  //   1. Compute the bass note from the chord's inversion (in bass register).
  //   2. Collect the chord's pitch classes EXCLUDING the bass PC.
  //   3. For each target PC, find the closest previous voice (within an octave).
  //      Common tones stay in the same voice.
  //   4. If we have no previous voicing, place voices in a default mid register.
  //   5. Pad the upper voices to at least 3 (doubling root or 5th if needed).
  //   6. Check for parallel 5ths/octaves with the previous voicing; if found,
  //      shift one voice by an octave.
  //   7. Sort and store as the new previous voicing.

  voiceLead(next: Chord): ChordVoicing {
    const intervals = this.buildIntervals(next.scaleDegree, next.type);

    // 1. Bass note = chord root + inversion interval, in bass register.
    const inv = Math.min(next.inversion, intervals.length - 1);
    const bassInterval = intervals[inv];
    let bassNote = next.root + bassInterval;
    while (bassNote >= PAD_BASS_HIGH) bassNote -= 12;
    while (bassNote < PAD_BASS_LOW) bassNote += 12;
    const bassPC = bassNote % 12;

    // 2. Collect upper-voice pitch classes (excluding the bass PC once).
    const chordPCs = intervals.map(iv => (next.root + iv) % 12);
    const upperPCs: number[] = [];
    let bassHandled = false;
    for (const pc of chordPCs) {
      if (pc === bassPC && !bassHandled) {
        bassHandled = true;
        continue;
      }
      upperPCs.push(pc);
    }

    // 3. Voice-lead the upper voices (or use default placement if first chord).
    let upperNotes: number[];
    if (this.previousVoicing.length >= 3) {
      upperNotes = this.assignVoices(upperPCs, this.previousVoicing);
    } else {
      upperNotes = this.defaultVoicing(upperPCs);
    }

    // 4. Ensure at least 3 upper voices (so total = 4 with bass).
    // Double the topmost note an octave above; if that goes out of range or
    // collides with an existing voice, drop an octave instead. If we can't
    // find a non-colliding slot, leave the voicing at 2 upper voices (a
    // 3-voice chord is still musical — root, 3rd, 5th).
    while (upperNotes.length < 3) {
      const top = upperNotes[upperNotes.length - 1] || PAD_UPPER_CENTER;
      let doubled = top + 12;
      while (doubled > PAD_UPPER_HIGH) doubled -= 12;
      while (doubled < PAD_UPPER_LOW) doubled += 12;
      if (upperNotes.includes(doubled)) {
        // Top+12 collided — try top-12 instead.
        doubled = top - 12;
        while (doubled < PAD_UPPER_LOW) doubled += 12;
        while (doubled > PAD_UPPER_HIGH) doubled -= 12;
      }
      if (upperNotes.includes(doubled)) break;  // give up — 2 upper voices is fine
      upperNotes.push(doubled);
    }

    // 5. Clamp upper voices into a comfortable range (avoid muddy lows / shrill highs).
    upperNotes = upperNotes.map(n => {
      while (n < PAD_UPPER_LOW) n += 12;
      while (n > PAD_UPPER_HIGH) n -= 12;
      return n;
    });

    // 6. Avoid parallel 5ths/octaves with the previous voicing.
    if (this.previousVoicing.length >= 3) {
      upperNotes = this.avoidParallels(this.previousVoicing, upperNotes);
    }

    upperNotes.sort((a, b) => a - b);

    const voicingNotes = [bassNote, ...upperNotes];

    // 7. Update state.
    this.previousVoicing = [...upperNotes];
    this.currentChord = next;

    return { notes: voicingNotes, bassNote };
  }

  // ── assignVoices ────────────────────────────────────────────────────────
  // Greedy nearest-voice matching: for each target pitch class, find the closest
  // unassigned previous voice (within an octave) and place the new note at the
  // nearest octave to that previous voice. Common tones (exact PC match) are
  // matched first and kept in the same voice.

  private assignVoices(targetPCs: number[], prevVoicing: number[]): number[] {
    const prevSorted = [...prevVoicing].sort((a, b) => a - b);
    const assigned: boolean[] = new Array(prevSorted.length).fill(false);
    const result: number[] = [];

    // First pass: exact PC matches (common tones) — pin them in the same voice.
    for (const pc of targetPCs) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < prevSorted.length; i++) {
        if (assigned[i]) continue;
        const prevPC = prevSorted[i] % 12;
        const dist = pc === prevPC ? 0 : Math.min(Math.abs(prevPC - pc), 12 - Math.abs(prevPC - pc));
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        assigned[bestIdx] = true;
        const prevNote = prevSorted[bestIdx];
        // Place the new note at the octave closest to the prev voice.
        let n = prevNote - (prevNote % 12) + pc;
        while (n - prevNote > 6) n -= 12;
        while (prevNote - n > 6) n += 12;
        result.push(n);
      }
    }

    // If we still have unassigned targets (target count > prev count),
    // place them at default positions in the mid register.
    if (result.length < targetPCs.length) {
      const placedPCs = new Set(result.map(n => n % 12));
      for (const pc of targetPCs) {
        if (placedPCs.has(pc) && result.some(n => n % 12 === pc)) continue;
        const defaultN = PAD_UPPER_CENTER - (PAD_UPPER_CENTER % 12) + pc;
        result.push(defaultN);
        placedPCs.add(pc);
      }
    }

    return result;
  }

  // ── defaultVoicing ──────────────────────────────────────────────────────
  // Place pitch classes in a comfortable mid register (around MIDI 64).
  // Used for the first chord of a section when there's no previous voicing.

  private defaultVoicing(pcs: number[]): number[] {
    const result: number[] = [];
    for (const pc of pcs) {
      let n = PAD_UPPER_CENTER - (PAD_UPPER_CENTER % 12) + pc;
      while (n < PAD_UPPER_LOW) n += 12;
      while (n > PAD_UPPER_HIGH) n -= 12;
      result.push(n);
    }
    return result;
  }

  // ── avoidParallels ──────────────────────────────────────────────────────
  // Check each pair of adjacent voices for parallel 5ths (7 semitones) or
  // octaves (0 semitones modulo 12). If found, shift the upper voice by an
  // octave in the direction that minimizes movement from the previous voicing.
  //
  // This is a simplified version of the classical counterpoint rule — strict
  // avoidance is impossible in this 4-voice context, but we catch the worst cases.

  private avoidParallels(prevVoicing: number[], nextVoicing: number[]): number[] {
    const adjusted = [...nextVoicing];
    const nPairs = Math.min(prevVoicing.length - 1, adjusted.length - 1);
    for (let i = 0; i < nPairs; i++) {
      const prevInt = ((prevVoicing[i + 1] - prevVoicing[i]) % 12 + 12) % 12;
      const nextInt = ((adjusted[i + 1] - adjusted[i]) % 12 + 12) % 12;
      // Parallel 5th (7 semitones) or octave (0 semitones) — both voices moving
      // in the same direction would be the strict violation; we soften this and
      // just shift the upper voice any time we see a 5th/octave between the same
      // pair of voices in both chords.
      if ((prevInt === 7 && nextInt === 7) || (prevInt === 0 && nextInt === 0)) {
        const upper = adjusted[i + 1];
        const prevUpper = prevVoicing[i + 1] || upper;
        const upOctave = upper + 12;
        const downOctave = upper - 12;
        const distUp = Math.abs(upOctave - prevUpper);
        const distDown = Math.abs(downOctave - prevUpper);
        const candidate = distUp < distDown ? upOctave : downOctave;
        // Only apply if the shifted note stays in range.
        if (candidate >= PAD_UPPER_LOW && candidate <= PAD_UPPER_HIGH) {
          adjusted[i + 1] = candidate;
        }
      }
    }
    return adjusted;
  }

  // ── getExtension ────────────────────────────────────────────────────────
  // Map section energy (0..1) to a chord extension category.
  //   < 0.3  → triad (clean, sparse breaks)
  //   < 0.5  → sus4 / min7 (gentle color)
  //   < 0.7  → maj7 / min7 (rich 7ths)
  //   >= 0.7 → maj9 / min9 (lush 9ths — drop density)
  // The actual type is adapted to the diatonic quality in getChord().

  getExtension(energy: number): ChordType {
    if (energy < 0.3) return 'triad';
    if (energy < 0.5) return this.rng.chance(0.5) ? 'min7' : 'sus4';
    if (energy < 0.7) return this.rng.chance(0.5) ? 'min7' : 'maj7';
    return this.rng.chance(0.5) ? 'min9' : 'maj9';
  }

  // ── borrowChord ─────────────────────────────────────────────────────────
  // Modal interchange: borrow a chord from a parallel scale (same tonic,
  // different quality). The most common psytrance borrow is "IV major instead
  // of iv minor" (parallel major) or "bVI major from aeolian" (already diatonic
  // in minor, but in dorian it's borrowed).
  //
  // Implementation: pick a diatonic degree and flip its quality (maj ↔ min).
  // This produces a chromatic chord that adds color without leaving the tonic.

  borrowChord(): Chord {
    // Pick a degree that's commonly borrowed (IV, V, VI, VII — not the tonic).
    const borrowDegrees = [3, 4, 5, 6];
    const deg = this.rng.pick(borrowDegrees);
    const diatonicQ = this.diatonicQuality(deg);

    // Flip the quality (parallel minor ↔ major).
    let intervals: number[];
    let type: ChordType;
    switch (diatonicQ) {
      case 'maj':  intervals = [0, 3, 7];   type = 'triad'; break;  // borrowed minor
      case 'min':  intervals = [0, 4, 7];   type = 'triad'; break;  // borrowed major
      case 'dim':  intervals = [0, 3, 6, 10]; type = 'min7b5'; break;  // dim7 from harmonic minor
      case 'aug':  intervals = [0, 4, 8];   type = 'aug'; break;  // keep aug
    }

    let rootMidi = scaleNote(this.root, this.scale, deg);
    while (rootMidi >= PAD_BASS_HIGH) rootMidi -= 12;
    while (rootMidi < PAD_BASS_LOW - 12) rootMidi += 12;
    const notes = intervals.map(iv => rootMidi + iv);
    return {
      root: rootMidi,
      type,
      scaleDegree: ((deg % 7) + 7) % 7,
      inversion: 0,
      notes,
    };
  }

  // ── chooseInversion ─────────────────────────────────────────────────────
  // Pick the inversion (0=root, 1=first, 2=second) that minimizes the bass
  // motion from the previous bass note to the next chord's bass note.
  //
  // Most chords stay in root position (inversion 0); inversions are used when
  // they bring the bass within a 5th of the previous bass.

  chooseInversion(prevBass: number, nextRoot: number): number {
    // Candidate bass notes for inversions 0, 1, 2.
    // (Approximate intervals: 0=root, 4=3rd, 7=5th. For 7th chords, 3rd
    // inversion would be 10, but we limit to 2 to keep things musical.)
    const invIntervals = [0, 4, 7];
    let bestInv = 0;
    let bestDist = Infinity;
    for (let inv = 0; inv < invIntervals.length; inv++) {
      let bass = nextRoot + invIntervals[inv];
      while (bass >= PAD_BASS_HIGH) bass -= 12;
      while (bass < PAD_BASS_LOW) bass += 12;
      // Distance modulo octave (shortest path on the circle of fifths-ish).
      let dist = Math.abs(bass - prevBass);
      if (dist > 6) dist = 12 - dist;
      if (dist < bestDist) {
        bestDist = dist;
        bestInv = inv;
      }
    }
    // Prefer root position when distance is small (avoid gratuitous inversions).
    if (bestInv !== 0 && bestDist > 3 && this.rng.chance(0.6)) {
      // keep bestInv (use the inversion)
    } else if (bestInv !== 0) {
      bestInv = 0;
    }
    return bestInv;
  }

  // ── bassNoteFor ─────────────────────────────────────────────────────────
  // Compute the actual bass note (in bass register) for a chord with inversion.

  private bassNoteFor(chord: Chord): number {
    const intervals = this.buildIntervals(chord.scaleDegree, chord.type);
    const inv = Math.min(chord.inversion, intervals.length - 1);
    let bass = chord.root + intervals[inv];
    while (bass >= PAD_BASS_HIGH) bass -= 12;
    while (bass < PAD_BASS_LOW) bass += 12;
    return bass;
  }

  // ── getAvoidNotes (counterpoint support) ────────────────────────────────
  // Returns pitch classes that the lead should avoid on strong beats (downbeats)
  // to prevent clashing with the current chord. These are notes a half-step
  // above/below a chord tone (avoid notes / passing tones).
  //
  // The lead can call this and reroute its note choices to chord tones or
  // available tensions instead.

  getAvoidNotes(): number[] {
    if (!this.currentChord) return [];
    const avoidPCs: number[] = [];
    const chordPCs = this.currentChord.notes.map(n => n % 12);
    for (const pc of chordPCs) {
      avoidPCs.push((pc + 1) % 12);  // half-step above
      avoidPCs.push((pc - 1 + 12) % 12);  // half-step below
    }
    // Filter out PCs that ARE chord tones (avoid over-restriction).
    return Array.from(new Set(avoidPCs)).filter(pc => !chordPCs.includes(pc));
  }

  // ── getCurrentChord ─────────────────────────────────────────────────────
  // Expose the current chord for counterpoint reference (lead/arp can query).

  getCurrentChord(): Chord | null {
    return this.currentChord;
  }

  // ── isChordTone ─────────────────────────────────────────────────────────
  // Quick check: is the given MIDI note a chord tone of the current chord?
  // Used by the lead to favor chord tones on strong beats.

  isChordTone(midi: number): boolean {
    if (!this.currentChord) return false;
    const pc = midi % 12;
    return this.currentChord.notes.some(n => n % 12 === pc);
  }

  // ── reset ───────────────────────────────────────────────────────────────
  // Reset voice-leading state (e.g. on key change or section reset).

  reset(): void {
    this.previousVoicing = [];
    this.currentChord = null;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : (v > b ? b : v);
}
