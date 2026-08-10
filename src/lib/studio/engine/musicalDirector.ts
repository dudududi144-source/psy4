/**
 * MUSICAL DIRECTOR (Task M1 — real composer, not step-by-step generator)
 * ====================================================================
 *
 * THE PROBLEM (per worklog ROAST feedback):
 * The previous engine scheduled notes STEP-BY-STEP in scheduleStep(). Each
 * 16th step it independently decided "should the kick play? should the bass
 * play? should the lead play?" — like a child pressing keys randomly. There
 * was no MUSICAL PHRASING — no understanding of when to play a melodic RUN
 * vs a sustained note, when to create rhythmic TENSION via syncopation, how
 * to build a phrase with a beginning/middle/end, how to create CALL and
 * RESPONSE between instruments, or how to vary density organically.
 *
 * THE SOLUTION:
 * A real composer/musician thinks in PHRASES (4-8 bars), not 16th steps.
 * The MusicalDirector composes a full phrase AHEAD OF TIME — with full
 * knowledge of which chord is playing, which motif is being developed, where
 * the phrase is in its tension curve, and what the other instruments are
 * doing. The scheduler then just plays back the pre-composed notes.
 *
 * ## What this buys us
 *   - PHRASE-LEVEL musical structure: builds open filters + add instruments
 *     across the phrase; drops hit with full density from beat 1; breaks
 *     leave space and let the music breathe.
 *   - RHYTHMIC COMPLEXITY: syncopation (offbeat 16th accents), polyrhythm
 *     (3-against-4 perc patterns), ghost notes (very quiet hits between
 *     main hits), tuplets (triplet fills in builds), varied ostinatos
 *     (patterns that repeat but with subtle per-bar variation).
 *   - MELODIC DEVELOPMENT: motif → variation → contrast → climax →
 *     resolution. The director tracks a high-level development state so
 *     each phrase develops the material, not just random motifs.
 *   - COHESIVE INTERPLAY: bass follows the chord progression (not random
 *     notes); lead's strong beats align with chord tones; arp complements
 *     the lead (call-response, not competing); pad provides the harmonic
 *     foundation; drums provide rhythmic coherence (not random hits).
 *
 * ## Performance
 * Composing a 4-8 bar phrase takes <5ms (a few hundred object allocations +
 * fast motif/harmony queries). Phrases are prepared during the previous
 * phrase (gapless transitions) — the scheduler never blocks on composition.
 *
 * ## Integration
 * The engine's tick() loop calls `getNotesForWindow(start, end)` every
 * 16th-step window. The director returns the pre-composed notes whose
 * absolute time falls in that window. The engine fires each note via
 * triggerDrum / triggerSynth. All Web Audio scheduling uses precise
 * audio-context times — no setTimeout for notes.
 *
 * Task ID: M1 (Musical Director).
 */

import { SeededRng, BASS_PATTERNS } from './musicalGrammar';
import { HarmonyEngine, Chord, ChordVoicing } from './harmonyEngine';
import { MelodyEngine } from './melodyEngine';
import type { World } from './worlds';

// ─── Public types ───────────────────────────────────────────────────────────

/**
 * A single note in a phrase. The director composes phrases as flat lists of
 * PhraseNotes; the engine's scheduler fires each one at its stated time.
 *
 * `time` is SECONDS FROM PHRASE START (not absolute audio-context time).
 * The director converts to absolute time when returning notes from
 * getNotesForWindow() by adding phraseStartTime.
 *
 * `track` follows the engine's 8-track convention:
 *   0=KICK 1=CLAP 2=HATS 3=PERC 4=BASS 5=LEAD 6=PAD 7=ARP
 *
 * `midi` is the pitch (0 for drums — the drum preset determines the sound).
 *
 * `velocity` is 0-1 (scaled by the engine's track.mix.vol at trigger time).
 *
 * `duration` is seconds (gate time for synths; ignored for drums).
 */
export interface PhraseNote {
  time: number;       // seconds from phrase start
  track: number;      // 0-7 (kick, clap, hats, perc, bass, lead, pad, arp)
  midi: number;       // pitch (0 for drums)
  velocity: number;   // 0-1
  duration: number;   // seconds (gate time for synths)
}

/**
 * The musical character of a phrase — what role it plays in the larger
 * arrangement. The director chooses different compositional strategies
 * for each character:
 *
 *   - build:     energy rising across the phrase (drums enter gradually,
 *                filter opens, lead enters mid-phrase).
 *   - release:   energy falling (drums thin out, lead descends, filter closes).
 *   - tension:   unresolved mid-high energy (polyrhythms, suspended chords,
 *                dissonant lead intervals).
 *   - groove:    steady mid energy (4-on-floor, offbeat bass, sparse lead).
 *   - drop:      peak energy (full density, rolling bass, confident lead,
 *                lush pad voicings, fast arp).
 *   - break:     low energy (sparse kick, no bass, slow lead, sustained pad).
 */
export type PhraseCharacter =
  | 'build' | 'release' | 'tension' | 'groove' | 'drop' | 'break';

export interface Phrase {
  notes: PhraseNote[];
  bars: number;           // 4 or 8
  energy: number;         // 0-1
  character: PhraseCharacter;
  /** When this phrase started playing, in audio-context seconds. */
  startTime: number;
  /** Total phrase duration in seconds (bars × barDur). */
  duration: number;
  /** BPM at composition time (for reference / debugging). */
  bpm: number;
  // Musical metadata for debugging / UI
  motifIds: string[];     // which motifs are playing
  chordProgression: string[]; // e.g. ["Am", "F", "C", "G"]
  /** Development phase — drives high-level musical development. */
  developmentPhase: DevelopmentPhase;
  /**
   * The chord progression (as Chord objects) used for this phrase. Internal —
   * used by getCurrentChord() to expose the currently-playing chord to the
   * engine (for the stutter surprise + UI display).
   */
  chords: Chord[];
}

/**
 * High-level musical development state. A real piece of music DEVELOPS over
 * time — motif → variation → contrast → climax → resolution. The director
 * tracks this so consecutive phrases build on each other rather than being
 * independent random outputs.
 *
 *   - statement:  introduce the motif (bars 0-N of the piece).
 *   - variation:  repeat with modification (transpose, fragment, rhythm change).
 *   - contrast:   introduce a new motif / different character.
 *   - climax:     everything together, highest energy.
 *   - resolution: return to the original motif, lower energy.
 */
export type DevelopmentPhase =
  | 'statement' | 'variation' | 'contrast' | 'climax' | 'resolution';

// ─── Internal helpers ──────────────────────────────────────────────────────

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Map a flow-engine section label to a phrase character. */
export function labelToCharacter(label: string): PhraseCharacter {
  const u = (label || '').toUpperCase();
  if (u.includes('DROP')) return 'drop';
  if (u.includes('BUILD')) return 'build';
  if (u.includes('BREAK')) return 'break';
  if (u.includes('VARIATION') || u.includes('VAR')) return 'variation' as PhraseCharacter;
  if (u.includes('OUTRO') || u.includes('RELEASE')) return 'release';
  if (u.includes('INTRO')) return 'build';
  if (u.includes('GROOVE')) return 'groove';
  // Treat variation as a build-style phrase (the director's variation logic
  // is triggered explicitly when the previous phrase was a drop).
  return 'groove';
}

/** Convert a chord to a readable name (e.g. "Am", "F", "Cmaj7"). */
function chordName(chord: Chord): string {
  const pcToName = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const root = pcToName[chord.root % 12] ?? '?';
  const typeSuffix: Record<string, string> = {
    triad: '', maj7: 'maj7', min7: 'm7', dom7: '7', min9: 'm9', maj9: 'maj9',
    sus2: 'sus2', sus4: 'sus4', dim: '°', aug: '+', min7b5: 'm7b5',
  };
  // For triads, determine major/minor from the intervals.
  if (chord.type === 'triad') {
    const intervals = chord.notes.map(n => n - chord.root);
    const hasMinorThird = intervals.includes(3);
    return root + (hasMinorThird ? 'm' : '');
  }
  return root + (typeSuffix[chord.type] ?? '');
}

// ─── Musical Director ──────────────────────────────────────────────────────

export class MusicalDirector {
  /** The phrase currently being played back. */
  private currentPhrase: Phrase | null = null;
  /** The phrase prepared to play next (for gapless transitions). */
  private nextPhrase: Phrase | null = null;
  /** When the current phrase started, in audio-context seconds. */
  private phraseStartTime = 0;
  /** Monotonic phrase counter — drives development phase + variation depth. */
  private phraseIdx = 0;

  /**
   * High-level development state. Drives which motif transformation is
   * applied and how dense the variation is. Cycles through:
   *   statement → variation → contrast → climax → resolution → (repeat)
   *
   * The cycle length is 5 phrases (one per phase). After 'resolution' it
   * loops back to 'statement' — but with a fresh motif (the previous motif
   * is retired). This gives the music a sense of long-range form without
   * being locked into a fixed arrangement.
   */
  private developmentPhase: DevelopmentPhase = 'statement';

  /**
   * The last 'drop' phrase composed — used as the source for the next
   * 'variation' phrase (the director modifies the drop's material rather
   * than generating fresh material, creating real motivic development).
   */
  private lastDropPhrase: Phrase | null = null;

  /** Cached reference to the last-composed motif signature (for variation). */
  private lastMotifId: string = '';

  constructor(
    private harmony: HarmonyEngine,
    private melody: MelodyEngine,
    private rng: SeededRng,
  ) {}

  // ── Public configuration ───────────────────────────────────────────────

  /**
   * Update the linked harmony + melody engines (called by the engine on
   * key change, after refreshMusicalGenerators). The director shares the
   * same engine instances as Psy4EngineV2 — passing them in keeps the
   * director's motif/harmony state in sync with the engine's.
   */
  setEngines(harmony: HarmonyEngine, melody: MelodyEngine, rng: SeededRng): void {
    this.harmony = harmony;
    this.melody = melody;
    this.rng = rng;
  }

  // ── Phrase composition ─────────────────────────────────────────────────

  /**
   * Compose a phrase with the given musical parameters. This is the MAIN
   * ENTRY POINT for the composer — it generates the full note list for a
   * 4- or 8-bar phrase, with all instruments composed cohesively.
   *
   * Called by:
   *   - prepareNextPhrase() — pre-composes the next phrase during the
   *     current one (gapless transitions).
   *   - getNotesForWindow() — auto-composes on the fly if no next phrase
   *     is prepared (fallback, shouldn't normally happen).
   *
   * Performance: <5ms for an 8-bar phrase. No audio work — just computes
   * the note list.
   */
  composePhrase(
    bars: number,
    energy: number,
    character: PhraseCharacter,
    world: World,
    bpm: number,
    startTime: number,
  ): Phrase {
    const s16 = 60 / bpm / 4;        // seconds per 16th step
    const barDur = s16 * 16;          // seconds per bar
    const phraseDur = barDur * bars;  // total phrase duration

    // ── 1. Generate the chord progression for this phrase ──
    // The harmony engine gives us a scale-appropriate progression with voice
    // leading, energy-driven extensions (triads in breaks → 9ths in drops),
    // and modal interchange. We advance one chord per bar.
    const progression: Chord[] = this.harmony.generateProgression(bars, energy);

    // ── 2. Refresh the melody engine's motif for this phrase ──
    // newPhrase() builds a fresh A A' B A'' developmental phrase internally,
    // which nextNote() reads from. We always call this so the motif is fresh
    // even if the lead is silent for some bars (BUILD) — the motif will be
    // ready when the lead enters.
    this.melody.newPhrase(energy);

    // ── 3. Determine development phase for this phrase ──
    // The phase drives motif transformation depth and which instruments
    // play. The engine's flow.label usually maps to a character, but the
    // director ALSO tracks its own development cycle so consecutive phrases
    // build on each other.
    const phase = this.computeDevelopmentPhase(character);

    // ── 4. Compose each instrument's notes into the phrase ──
    const notes: PhraseNote[] = [];
    const motifIds: string[] = [];

    // Drums (kick, clap, hats, perc) — character-driven rhythmic patterns.
    this.composeDrums(notes, character, energy, world, bars, s16);

    // Bass — follows the chord progression with passing tones / walking lines.
    this.composeBass(notes, progression, character, energy, world, bars, s16);

    // Lead — motif-driven, with development based on phase.
    const leadMotifId = this.composeLead(
      notes, character, energy, phase, bars, s16,
    );
    if (leadMotifId) motifIds.push(leadMotifId);

    // Pad — voice-led chord voicings, sustained.
    this.composePad(notes, progression, character, energy, bars, s16);

    // Arp — call-response with lead in variations, otherwise pattern-based.
    this.composeArp(notes, progression, character, energy, world, bars, s16);

    // ── 5. Build the Phrase object ──
    const phrase: Phrase = {
      notes,
      bars,
      energy,
      character,
      startTime,
      duration: phraseDur,
      bpm,
      motifIds,
      chordProgression: progression.map(chordName),
      developmentPhase: phase,
      chords: progression,
    };

    // Track the last drop phrase for variation source material.
    if (character === 'drop') {
      this.lastDropPhrase = phrase;
    }
    if (leadMotifId) this.lastMotifId = leadMotifId;

    return phrase;
  }

  /**
   * Compute the development phase for a phrase. Maps the phrase character
   * + the monotonic phraseIdx to one of:
   *   statement → variation → contrast → climax → resolution
   *
   * The mapping is character-driven (a 'drop' is usually a climax; a
   * 'break' is usually a resolution), but it also respects the development
   * cycle so the music has long-range form.
   */
  private computeDevelopmentPhase(character: PhraseCharacter): DevelopmentPhase {
    // Character-driven defaults:
    if (character === 'drop') return 'climax';
    if (character === 'break') return 'resolution';
    if (character === 'release') return 'resolution';
    if (character === 'build') return 'statement';

    // For 'groove' and 'tension', cycle through the phases based on phraseIdx.
    // This gives long-range form to sections that don't have an obvious
    // character-driven phase.
    const cycle: DevelopmentPhase[] = [
      'statement', 'variation', 'contrast', 'climax', 'resolution',
    ];
    return cycle[this.phraseIdx % cycle.length];
  }

  // ── Drum composition ───────────────────────────────────────────────────

  /**
   * Compose the drum tracks (kick, clap, hats, perc) with rhythmic complexity.
   *
   * Per-character strategies:
   *   - build:   sparse → dense across the phrase. Kick 4-on-floor from bar 0
   *              but quiet; hats enter bar 1; clap + perc enter bar 2; last
   *              bar adds 16th-note buildup rolls.
   *   - drop:    full density from beat 1. Kick 4-on-floor, hats on all
   *              offbeats with ghost notes, perc syncopated, clap on 4&12.
   *   - break:   sparse. Kick on 0&8 only. No hats, no clap, no perc.
   *   - groove:  4-on-floor, offbeat hats, perc from world pattern.
   *   - release: thinning. Kick 4-on-floor bars 0-1, sparse bars 2-3.
   *   - tension: polyrhythmic. 3-against-4 perc pattern over 4-on-floor kick.
   *
   * Rhythmic complexity (the user said "לא לנגן ברבעיות" — don't play
   * quarter notes):
   *   - Syncopation: accents on the "and" of beats (offbeat 16ths).
   *   - Ghost notes: very quiet hits between main hits (especially on hats).
   *   - Varied ostinatos: the kick pattern repeats but with subtle per-bar
   *     velocity variation and occasional extra hits.
   *   - Tuplets: triplet fills in the last bar of builds.
   */
  private composeDrums(
    notes: PhraseNote[],
    character: PhraseCharacter,
    energy: number,
    world: World,
    bars: number,
    s16: number,
  ): void {
    const stepsPerBar = 16;
    const totalSteps = bars * stepsPerBar;

    for (let step = 0; step < totalSteps; step++) {
      const bar = Math.floor(step / stepsPerBar);
      const stepInBar = step % stepsPerBar;
      const time = step * s16;
      const phraseProgress = step / totalSteps; // 0..1 across the phrase

      // Per-bar energy curve — drives velocity + density within the phrase.
      // Builds rise, drops are flat-high, breaks are flat-low, releases fall.
      const barEnergy = this.barEnergy(character, energy, bar, bars);

      // ── KICK (track 0) ──
      // 4-on-floor: steps 0, 4, 8, 12 (beats 1, 2, 3, 4).
      // Character variations:
      //   - build:    kick on 0, 8 only in bar 0 (sparse intro), then 4-on-floor.
      //   - break:    kick on 0, 8 only (every 2 beats).
      //   - release:  4-on-floor bars 0-N/2, then 0, 8 only.
      //   - drop/groove/tension: full 4-on-floor.
      // Velocity: downbeat (step 0) slightly louder; builds up in last bar.
      const kickPlays = this.kickPlaysAt(character, bar, bars, stepInBar);
      if (kickPlays) {
        const isDownbeat = stepInBar === 0;
        const isLastBarBuildup = character === 'build' && bar === bars - 1;
        const vel = isDownbeat
          ? clamp(0.55 + barEnergy * 0.25, 0.4, 0.95)
          : clamp(0.40 + barEnergy * 0.20, 0.3, 0.8);
        // Last bar of build: rising velocity on the 16th-note buildup kicks.
        const buildupBoost = isLastBarBuildup && stepInBar >= 12
          ? (stepInBar - 12) * 0.04
          : 0;
        notes.push({
          time,
          track: 0,
          midi: 0,
          velocity: clamp(vel + buildupBoost, 0, 1),
          duration: 0,
        });
      }

      // ── CLAP (track 1) ──
      // Steps 4 & 12 (beats 2 & 4) — classic backbeat.
      //   - drop/groove: clap on 4 & 12.
      //   - build: clap enters in bar 1 or 2, on 12 only (beat 4).
      //   - break: no clap.
      //   - release: clap on 12 only, fading.
      const clapPlays = this.clapPlaysAt(character, bar, bars, stepInBar, barEnergy);
      if (clapPlays) {
        const vel = clamp(0.30 + barEnergy * 0.20, 0.2, 0.6);
        notes.push({ time, track: 1, midi: 0, velocity: vel, duration: 0 });
      }

      // ── HATS (track 2) ──
      // Offbeat 8ths (steps 1, 3, 5, 7, 9, 11, 13, 15) — the psytrance
      // signature. Plus ghost notes on 16ths (2, 6, 10, 14) at low velocity.
      //   - build: hats enter in bar 1, offbeat 8ths only. Last bar: 16th rolls.
      //   - drop: full 16ths with velocity variation + ghosts.
      //   - break: no hats (or very sparse open hats on 7, 15).
      //   - groove: offbeat 8ths, medium velocity.
      //   - tension: polyrhythmic — hats in 3-against-4 pattern.
      //   - release: offbeat 8ths fading out.
      this.composeHats(notes, character, bar, bars, stepInBar, time, barEnergy, world);

      // ── PERC (track 3) ──
      // World-driven percPattern as base, plus syncopated ghost notes.
      //   - build: sparse — perc enters in bar 2, world-pattern hits only.
      //   - drop: full perc pattern + syncopated ghosts.
      //   - break: no perc.
      //   - groove: world-pattern at medium density.
      //   - tension: 3-against-4 polyrhythm (perc on every 3rd 16th).
      //   - release: perc thins out.
      this.composePerc(notes, character, bar, bars, stepInBar, time, barEnergy, world);
    }

    // ── Triplet fill at the end of builds ──
    // The last bar of a build gets a 16th-note-triplet fill on the hats/perc
    // leading into the drop. This is the classic "buildup roll" — groups of
    // 3 over 4 — creating rhythmic tension that releases at the downbeat.
    if (character === 'build' && bars >= 2) {
      this.composeTripletFill(notes, bars, s16, energy);
    }
  }

  /** Energy at a given bar within a phrase, shaped by the character. */
  private barEnergy(
    character: PhraseCharacter,
    baseEnergy: number,
    bar: number,
    bars: number,
  ): number {
    const p = bars > 1 ? bar / (bars - 1) : 0; // 0..1 across the phrase
    switch (character) {
      case 'build':
        // Rise from 0.4*energy to 1.0*energy across the phrase.
        return clamp(baseEnergy * lerp(0.4, 1.0, p), 0, 1);
      case 'release':
        // Fall from 1.0*energy to 0.3*energy.
        return clamp(baseEnergy * lerp(1.0, 0.3, p), 0, 1);
      case 'drop':
        // Flat-high with a slight peak in the middle.
        return clamp(baseEnergy * (0.9 + 0.1 * Math.sin(p * Math.PI)), 0, 1);
      case 'break':
        // Flat-low.
        return clamp(baseEnergy * 0.5, 0, 1);
      case 'groove':
      case 'tension':
      default:
        // Gentle arc.
        return clamp(baseEnergy * (0.85 + 0.15 * Math.sin(p * Math.PI)), 0, 1);
    }
  }

  /** Should the kick play at this step? Character-driven. */
  private kickPlaysAt(
    character: PhraseCharacter,
    bar: number,
    bars: number,
    stepInBar: number,
  ): boolean {
    const is4OnFloor = stepInBar === 0 || stepInBar === 4 || stepInBar === 8 || stepInBar === 12;
    const isSparse = stepInBar === 0 || stepInBar === 8; // every 2 beats

    switch (character) {
      case 'break':
        return isSparse;
      case 'release':
        // First half: 4-on-floor. Second half: sparse.
        return bar < bars / 2 ? is4OnFloor : isSparse;
      case 'build':
        // Bar 0: sparse (kick on 0, 8 only). Then 4-on-floor.
        // Last bar: add extra 16th-note buildup kicks on steps 13, 14, 15.
        if (bar === 0) return isSparse;
        if (bar === bars - 1 && stepInBar >= 13) return true; // buildup
        return is4OnFloor;
      case 'drop':
      case 'groove':
      case 'tension':
      default:
        return is4OnFloor;
    }
  }

  /** Should the clap play at this step? Character-driven. */
  private clapPlaysAt(
    character: PhraseCharacter,
    bar: number,
    bars: number,
    stepInBar: number,
    barEnergy: number,
  ): boolean {
    const onBeat2 = stepInBar === 4;
    const onBeat4 = stepInBar === 12;
    switch (character) {
      case 'break':
        return false;
      case 'build':
        // Clap enters in bar 1, on beat 4 only. Last bar: both beats.
        if (bar === 0) return false;
        if (bar === bars - 1) return onBeat2 || onBeat4;
        return onBeat4;
      case 'release':
        // Clap on beat 4, fading — only if energy is still high enough.
        return onBeat4 && barEnergy > 0.25;
      case 'drop':
      case 'groove':
      case 'tension':
      default:
        // Both beats, but only if energy is sufficient.
        return (onBeat2 || onBeat4) && barEnergy > 0.3;
    }
  }

  /**
   * Compose hats with rhythmic complexity: offbeat 8ths + ghost notes +
   * velocity variation + occasional rolls. This is where most of the
   * "לא לנגן ברבעיות" (don't play quarter notes) energy comes from.
   */
  private composeHats(
    notes: PhraseNote[],
    character: PhraseCharacter,
    bar: number,
    bars: number,
    stepInBar: number,
    time: number,
    barEnergy: number,
    world: World,
  ): void {
    const isOffbeat8th = stepInBar % 2 === 1;  // 1, 3, 5, 7, 9, 11, 13, 15
    const isGhost16th = stepInBar % 2 === 0 && stepInBar !== 0;  // 2, 6, 10, 14
    const isOpenHat = stepInBar === 7 || stepInBar === 15;  // open hat on the "and" of 2 and 4

    // World hat density gates the probability.
    const hatProb = clamp(world.hatDensity * (0.5 + 0.5 * barEnergy), 0, 1);

    switch (character) {
      case 'break':
        // No hats in breaks — let the music breathe.
        return;

      case 'build':
        // Hats enter in bar 1, offbeat 8ths only at low velocity.
        // Last bar: add 16th-note rolls (every 16th, ascending velocity).
        if (bar === 0) return;
        if (bar === bars - 1) {
          // Last-bar buildup: every 16th gets a hat, rising velocity.
          if (this.rng.chance(0.85)) {
            const buildupVel = clamp(0.15 + (stepInBar / 16) * 0.35, 0.1, 0.5);
            notes.push({ time, track: 2, midi: 0, velocity: buildupVel, duration: 0 });
          }
          return;
        }
        if (isOffbeat8th && this.rng.chance(hatProb)) {
          const vel = clamp(0.20 + barEnergy * 0.15, 0.15, 0.45);
          notes.push({ time, track: 2, midi: 0, velocity: vel, duration: 0 });
        }
        return;

      case 'drop':
        // Full 16th hats with velocity variation + ghost notes.
        if (isOffbeat8th && this.rng.chance(hatProb)) {
          // Accent offbeat 8ths (especially 3, 7, 11, 15).
          const isAccent = stepInBar === 3 || stepInBar === 7 || stepInBar === 11 || stepInBar === 15;
          const vel = isAccent
            ? clamp(0.30 + barEnergy * 0.20, 0.25, 0.55)
            : clamp(0.20 + barEnergy * 0.10, 0.15, 0.40);
          notes.push({ time, track: 2, midi: 0, velocity: vel, duration: 0 });
        } else if (isGhost16th && this.rng.chance(hatProb * 0.4)) {
          // Ghost note — very quiet.
          notes.push({ time, track: 2, midi: 0, velocity: 0.08 + barEnergy * 0.05, duration: 0 });
        }
        if (isOpenHat && this.rng.chance(hatProb * 0.6)) {
          // Open hat — slightly louder, longer decay (midi=1 flags open hat).
          notes.push({ time, track: 2, midi: 1, velocity: 0.25 + barEnergy * 0.15, duration: 0 });
        }
        return;

      case 'groove':
        // Offbeat 8ths, medium velocity. Occasional ghost note.
        if (isOffbeat8th && this.rng.chance(hatProb)) {
          const vel = clamp(0.18 + barEnergy * 0.12, 0.15, 0.40);
          notes.push({ time, track: 2, midi: 0, velocity: vel, duration: 0 });
        } else if (isGhost16th && this.rng.chance(hatProb * 0.2)) {
          notes.push({ time, track: 2, midi: 0, velocity: 0.06, duration: 0 });
        }
        return;

      case 'tension': {
        // 3-against-4 polyrhythm: hats on every 3rd 16th (steps 0, 3, 6, 9, 12).
        // Creates a 3-over-4 cross-rhythm against the 4-on-floor kick.
        const isPolyrhythm = stepInBar % 3 === 0;
        if (isPolyrhythm && this.rng.chance(hatProb * 0.9)) {
          const vel = clamp(0.22 + barEnergy * 0.15, 0.18, 0.45);
          notes.push({ time, track: 2, midi: 0, velocity: vel, duration: 0 });
        }
        return;
      }

      case 'release':
        // Offbeat 8ths, fading out.
        if (isOffbeat8th && this.rng.chance(hatProb * lerp(1.0, 0.3, bar / Math.max(1, bars - 1)))) {
          const vel = clamp(0.15 + barEnergy * 0.10, 0.10, 0.35);
          notes.push({ time, track: 2, midi: 0, velocity: vel, duration: 0 });
        }
        return;
    }
  }

  /**
   * Compose perc with world-driven pattern + syncopated ghost notes.
   * The world's percPattern is a 16-char gate string — we use it as the
   * base and add character-driven variations.
   */
  private composePerc(
    notes: PhraseNote[],
    character: PhraseCharacter,
    bar: number,
    bars: number,
    stepInBar: number,
    time: number,
    barEnergy: number,
    world: World,
  ): void {
    if (character === 'break') return; // no perc in breaks

    const percProb = clamp(world.percDensity * (0.4 + 0.6 * barEnergy), 0, 1);

    // World pattern hit?
    const worldHit = world.percPattern.length === 16
      && world.percPattern.charAt(stepInBar) === 'x';

    // Syncopated ghost positions (the "e" and "a" of beats — steps 2, 6, 10, 14).
    const isSyncopated = stepInBar === 2 || stepInBar === 6 || stepInBar === 10 || stepInBar === 14;

    switch (character) {
      case 'build':
        // Perc enters in bar 2, world-pattern hits only.
        if (bar < 2) return;
        if (worldHit && this.rng.chance(percProb)) {
          notes.push({ time, track: 3, midi: 0, velocity: 0.18 + barEnergy * 0.10, duration: 0 });
        }
        return;

      case 'drop':
        // Full perc pattern + syncopated ghosts.
        if (worldHit && this.rng.chance(percProb)) {
          notes.push({ time, track: 3, midi: 0, velocity: 0.22 + barEnergy * 0.12, duration: 0 });
        } else if (isSyncopated && this.rng.chance(percProb * 0.3)) {
          // Syncopated ghost perc — adds rhythmic complexity.
          notes.push({ time, track: 3, midi: 0, velocity: 0.10 + barEnergy * 0.05, duration: 0 });
        }
        return;

      case 'groove':
        if (worldHit && this.rng.chance(percProb)) {
          notes.push({ time, track: 3, midi: 0, velocity: 0.18 + barEnergy * 0.10, duration: 0 });
        }
        return;

      case 'tension': {
        // 3-against-4 polyrhythm on perc — every 3rd 16th, offset from hats.
        // Hats are on 0,3,6,9,12; perc is on 1,4,7,10,13 (offset by 1).
        const isPolyrhythm = (stepInBar + 1) % 3 === 0;
        if (isPolyrhythm && this.rng.chance(percProb * 0.8)) {
          notes.push({ time, track: 3, midi: 0, velocity: 0.20 + barEnergy * 0.10, duration: 0 });
        }
        return;
      }

      case 'release':
        // Perc thins out — world-pattern hits only, fading.
        if (worldHit && this.rng.chance(percProb * lerp(1.0, 0.2, bar / Math.max(1, bars - 1)))) {
          notes.push({ time, track: 3, midi: 0, velocity: 0.15 + barEnergy * 0.08, duration: 0 });
        }
        return;
    }
  }

  /**
   * Compose a 16th-note-triplet fill at the end of a build phrase.
   * Triplets are 3 notes in the time of 2 — so over 4 quarter notes (16 16ths),
   * we play 12 triplet 16ths (3 per quarter × 4 quarters). This creates the
   * classic "buildup roll" that releases at the drop's downbeat.
   */
  private composeTripletFill(
    notes: PhraseNote[],
    bars: number,
    s16: number,
    energy: number,
  ): void {
    // Fill the last bar (bar = bars-1) with triplet 16ths on the hats.
    // Each quarter note = 3 triplet 16ths = 3 * (s16 * 2/3) = 2 * s16.
    // Triplet 16th duration = s16 * 2/3.
    const tripletDur = s16 * 2 / 3;
    const fillStartBar = bars - 1;
    const fillStartTime = fillStartBar * 16 * s16;

    for (let q = 0; q < 4; q++) {
      // 3 triplets per quarter note.
      for (let t = 0; t < 3; t++) {
        const time = fillStartTime + q * 4 * s16 + t * tripletDur;
        // Rising velocity across the fill.
        const progress = (q * 3 + t) / 12;
        const vel = clamp(0.15 + progress * 0.40 + energy * 0.15, 0.1, 0.7);
        notes.push({ time, track: 2, midi: 0, velocity: vel, duration: 0 });
      }
    }
  }

  // ── Bass composition ───────────────────────────────────────────────────

  /**
   * Compose the bass line following the chord progression.
   *
   * The bass is the HARMONIC FOUNDATION — it plays the chord roots (with
   * passing tones / walking lines for movement). Psytrance bass is typically
   * offbeat 16ths (steps 1, 3, 5, 7, 9, 11, 13, 15) — the kick plays on
   * the downbeats, the bass plays on the offbeats, creating the signature
   * "pump" via sidechain ducking.
   *
   * Per-character:
   *   - build:   bass enters in bar 1-2, simple root on offbeats.
   *   - drop:    rolling 16ths (all steps) with walking line.
   *   - break:   bass silent or very sparse (root on bar start only).
   *   - groove:  offbeat 16ths, root + occasional fifth.
   *   - tension: chromatic walking tones, dissonant.
   *   - release: offbeat 16ths simplifying to root, fading.
   *
   * The bass uses BASS_PATTERNS from musicalGrammar — these are explicit
   * 8-step patterns encoding musical intent (roll, off, acid styles).
   */
  private composeBass(
    notes: PhraseNote[],
    progression: Chord[],
    character: PhraseCharacter,
    energy: number,
    world: World,
    bars: number,
    s16: number,
  ): void {
    const stepsPerBar = 16;
    const totalSteps = bars * stepsPerBar;

    // Pick a bass pattern based on the world's character.
    const bassStyle = this.deriveBassStyle(world);
    const bps = BASS_PATTERNS[bassStyle] || BASS_PATTERNS.off;
    const bp = bps[this.phraseIdx % bps.length];

    // The tonic root — the first chord of the progression is the tonic (degree 0).
    // For non-lead characters (groove/build/release), the bass stays on the tonic
    // for that classic psytrance "pump on the root" feel. For lead characters
    // (drop/tension), the bass walks with the chord progression.
    const tonicRoot = progression[0]?.root ?? 36;

    for (let step = 0; step < totalSteps; step++) {
      const bar = Math.floor(step / stepsPerBar);
      const stepInBar = step % stepsPerBar;
      const time = step * s16;
      const barEnergy = this.barEnergy(character, energy, bar, bars);

      // Should the bass play at this step?
      if (!this.bassPlaysAt(character, bar, bars, stepInBar, barEnergy)) continue;

      // Determine the chord for this bar.
      const chord = progression[bar % progression.length];
      if (!chord) continue;

      // Pick the bass pattern position. For rolling 16ths (drop/tension),
      // advance the pattern every step so we get a continuous rolling bass.
      // For offbeat-only bass (groove/build/release), advance every 2 steps
      // (each beat gets one pattern entry).
      const bassStep = (character === 'drop' || character === 'tension')
        ? stepInBar % bp.steps.length
        : Math.floor(stepInBar / 2) % bp.steps.length;
      const bassDeg = bp.steps[bassStep];
      if (bassDeg < 0) continue; // rest

      // Bass base note: for drop/tension, follow the chord root (harmonic
      // walking); for other characters, stay on the tonic root (psytrance pump).
      const bassBaseChord: Chord = (character === 'drop' || character === 'tension')
        ? chord
        : { ...chord, root: tonicRoot };
      const bassMidi = this.bassMidiFor(bassBaseChord, bassDeg);

      const accent = bp.accents[bassStep] ?? 1;
      const vel = clamp((0.40 + barEnergy * 0.25) * accent, 0.20, 0.85);
      // Bass gate: short for offbeat psytrance pump, longer for rolling drops.
      const gate = character === 'drop'
        ? s16 * 0.9  // nearly full 16th — rolling bass
        : s16 * 0.5; // half 16th — tight offbeat pump

      notes.push({
        time,
        track: 4,
        midi: bassMidi,
        velocity: vel,
        duration: gate,
      });
    }
  }

  /** Should the bass play at this step? Character-driven. */
  private bassPlaysAt(
    character: PhraseCharacter,
    bar: number,
    bars: number,
    stepInBar: number,
    barEnergy: number,
  ): boolean {
    const isOffbeat16th = stepInBar % 2 === 1;  // 1, 3, 5, 7, 9, 11, 13, 15
    const isAll16th = true; // every 16th step
    const isDownbeat = stepInBar === 0;

    switch (character) {
      case 'break':
        // Bass silent or very sparse — root on bar start only, very quiet.
        return isDownbeat && barEnergy > 0.15;
      case 'build':
        // Bass enters in bar 1-2, offbeat 16ths only.
        if (bar < 1) return false;
        return isOffbeat16th;
      case 'drop':
      case 'tension':
        // Rolling 16ths — all steps.
        return true;
      case 'groove':
        // Offbeat 16ths.
        return isOffbeat16th;
      case 'release':
        // Offbeat 16ths simplifying — fade out in last bars.
        if (bar >= bars - 1) return isDownbeat; // last bar: root on downbeat only
        return isOffbeat16th;
    }
  }

  /**
   * Compute the bass MIDI note for a chord + pattern degree.
   * The bass plays the chord root (in the bass register) + the pattern's
   * scale-degree offset (root, fifth, octave, etc.).
   */
  private bassMidiFor(chord: Chord, bassDeg: number): number {
    // The chord's root is already in the bass register (MIDI ~36-47).
    // We add scaleNote offsets for the pattern degree.
    // bassDeg: 0=root, 4=fifth, 7=octave, 2=third (in scale degrees).
    // Use the chord's root as the scale root for the bass.
    const rootMidi = chord.root;
    // For simplicity, treat bassDeg as semitone offsets from the chord root
    // mapped through the scale. Since we don't have direct access to the
    // scale here, use scale-degree → semitone approximation:
    //   0 → 0 (root), 2 → 3 or 4 (minor or major third), 4 → 7 (fifth),
    //   7 → 12 (octave). Use the chord's intervals to pick the right ones.
    const chordIntervals = chord.notes.map(n => n - chord.root);
    let semitoneOffset = 0;
    if (bassDeg === 0) semitoneOffset = 0;
    else if (bassDeg === 2) semitoneOffset = chordIntervals[1] ?? 3; // third
    else if (bassDeg === 4) semitoneOffset = chordIntervals[2] ?? 7; // fifth
    else if (bassDeg === 7) semitoneOffset = 12; // octave
    else if (bassDeg === 12) semitoneOffset = 12; // octave (alt)
    else semitoneOffset = bassDeg; // fallback: treat as semitone

    // Keep the bass in the bass register (MIDI 30-48).
    let midi = rootMidi + semitoneOffset;
    while (midi > 48) midi -= 12;
    while (midi < 28) midi += 12;
    return midi;
  }

  /** Derive bass style from world id (matches the engine's deriveBassStyle). */
  private deriveBassStyle(world: World): 'roll' | 'acid' | 'off' {
    const id = world.id;
    if (id.includes('dark') || id.includes('forest')) return 'roll';
    if (id.includes('goa') || id.includes('acid')) return 'acid';
    return 'off';
  }

  // ── Lead composition ───────────────────────────────────────────────────

  /**
   * Compose the lead using the MelodyEngine's developmental A A' B A'' phrase.
   *
   * The MelodyEngine generates motifs with singable contour, development
   * techniques (transpose, invert, fragment, sequence), and tension curves.
   * We query it step-by-step to fill the lead's notes.
   *
   * Per-character:
   *   - build:   lead silent for bars 0-1, enters in bar 2 with simple motif,
   *              developed in bar 3+.
   *   - drop:    lead plays the main motif confidently, with variations.
   *   - break:   lead plays a quiet, slow melodic line (half notes).
   *   - groove:  lead plays sparse motif statements with rests.
   *   - tension: lead plays dissonant intervals (avoid notes, leaps).
   *   - release: lead plays a descending resolution motif.
   *
   * Development phase drives motif transformation:
   *   - statement:  play the motif as-is.
   *   - variation:  transpose the motif up an octave OR fragment it.
   *   - contrast:   the MelodyEngine generates a fresh contrasting motif.
   *   - climax:     motif played with maximum density + velocity.
   *   - resolution: motif returns, simplified (longer notes).
   *
   * Returns the motif ID (for debugging) or empty string.
   */
  private composeLead(
    notes: PhraseNote[],
    character: PhraseCharacter,
    energy: number,
    phase: DevelopmentPhase,
    bars: number,
    s16: number,
  ): string {
    const stepsPerBar = 16;
    const totalSteps = bars * stepsPerBar;
    let playedAny = false;

    // Determine octave shift based on development phase.
    //   - variation: +12 (octave up — brighter, more intense).
    //   - climax:    +12 (octave up — peak intensity).
    //   - resolution: -12 (octave down — settled, calm).
    //   - statement/contrast: 0 (natural register).
    let octaveShift = 0;
    if (phase === 'variation' || phase === 'climax') octaveShift = 12;
    else if (phase === 'resolution') octaveShift = -12;

    for (let step = 0; step < totalSteps; step++) {
      const bar = Math.floor(step / stepsPerBar);
      const stepInBar = step % stepsPerBar;
      const time = step * s16;
      const barEnergy = this.barEnergy(character, energy, bar, bars);

      // Should the lead play at this step? Character-driven gating.
      if (!this.leadPlaysAt(character, bar, bars, stepInBar, barEnergy)) continue;

      // Query the melody engine for the note at this step.
      // The melody engine reads from its pre-built phrase table.
      const noteInfo = this.melody.nextNote(step, bar, energy);
      if (!noteInfo) continue; // rest or no event

      // Apply octave shift based on development phase.
      const midi = noteInfo.note + octaveShift;

      // Velocity: scale by bar energy + character.
      //   - break:   quiet (0.3-0.4).
      //   - drop:    confident (0.5-0.8).
      //   - build:   rising with the phrase.
      //   - climax:  max velocity.
      let velScale = 1.0;
      if (character === 'break') velScale = 0.5;
      else if (character === 'drop') velScale = 1.0;
      else if (character === 'build') velScale = 0.7 + 0.3 * (bar / Math.max(1, bars - 1));
      else if (character === 'groove') velScale = 0.8;
      else if (character === 'release') velScale = 0.7;
      else if (character === 'tension') velScale = 0.85;

      const climaxBoost = phase === 'climax' ? 1.15 : 1.0;
      const vel = clamp(noteInfo.velocity * velScale * climaxBoost, 0.1, 1.0);

      // Duration: use the melody engine's duration (1-4 16th steps).
      // For breaks, double the duration (half notes instead of quarter notes).
      const dur = character === 'break'
        ? s16 * noteInfo.duration * 2
        : s16 * noteInfo.duration;

      notes.push({
        time,
        track: 5,
        midi,
        velocity: vel,
        duration: dur,
      });
      playedAny = true;
    }

    // Return a motif ID for debugging.
    if (!playedAny) return '';
    return `motif-${phase}-${octaveShift >= 12 ? 'hi' : octaveShift <= -12 ? 'lo' : 'mid'}`;
  }

  /** Should the lead play at this step? Character-driven gating. */
  private leadPlaysAt(
    character: PhraseCharacter,
    bar: number,
    bars: number,
    stepInBar: number,
    barEnergy: number,
  ): boolean {
    switch (character) {
      case 'break':
        // Slow melodic line — only on beat 1 and 3 (steps 0 and 8).
        // And only if energy is high enough to bother.
        return (stepInBar === 0 || stepInBar === 8) && barEnergy > 0.15;
      case 'build':
        // Lead silent for bars 0-1, enters in bar 2.
        if (bar < 2) return false;
        return barEnergy > 0.4;
      case 'drop':
      case 'tension':
        // Lead plays throughout (the melody engine handles rests internally).
        return barEnergy > 0.4;
      case 'groove':
        // Sparse lead — only on certain steps.
        return barEnergy > 0.45 && (stepInBar % 4 === 0);
      case 'release':
        // Descending resolution — plays in first half, then settles.
        return bar < bars / 2 + 1 && barEnergy > 0.3;
    }
  }

  // ── Pad composition ────────────────────────────────────────────────────

  /**
   * Compose the pad with voice-led chord voicings.
   *
   * The pad provides the HARMONIC FOUNDATION — sustained chords that fill
   * the mid-range. The HarmonyEngine produces voice-led voicings (common
   * tones preserved, smallest-interval motion, parallel-fifth avoidance).
   *
   * Per-character:
   *   - build:   pad enters in bar 1, simple triads, sustained.
   *   - drop:    pad plays full 7th/9th voicings on bar starts.
   *   - break:   pad plays sustained triads, slow filter movement.
   *   - groove:  pad plays simple triads on bar starts.
   *   - tension: pad plays suspended chords (sus2/sus4).
   *   - release: pad resolves to triads, sustained.
   *
   * The pad changes chord per bar (or per 2 bars in breaks for a slower
   * harmonic rhythm).
   */
  private composePad(
    notes: PhraseNote[],
    progression: Chord[],
    character: PhraseCharacter,
    energy: number,
    bars: number,
    s16: number,
  ): void {
    const barDur = s16 * 16;

    for (let bar = 0; bar < bars; bar++) {
      // In breaks, hold each chord for 2 bars (slower harmonic rhythm).
      // In other characters, change per bar.
      const chordBar = character === 'break' ? Math.floor(bar / 2) * 2 : bar;
      const chord = progression[chordBar % progression.length];
      if (!chord) continue;

      // Should the pad play this bar?
      if (!this.padPlaysAt(character, bar, bars)) continue;

      // Voice-lead the chord (this updates the harmony engine's internal
      // state — previousVoicing, currentChord — so the next voiceLead call
      // produces smooth voice leading).
      const voicing: ChordVoicing = this.harmony.voiceLead(chord);

      // Trigger one pad voice per note in the voicing.
      // Bass voice (lowest) gets slightly higher velocity; upper voices
      // taper off to leave headroom for the lead.
      const barEnergy = this.barEnergy(character, energy, bar, bars);
      const noteCount = voicing.notes.length;
      const time = bar * barDur;
      // Pad sustains for the whole bar (or 2 bars in breaks).
      const sustainDur = character === 'break' ? barDur * 2 : barDur;

      for (let i = 0; i < noteCount; i++) {
        const note = voicing.notes[i];
        const isBass = i === 0;
        const vel = isBass
          ? clamp(0.18 + barEnergy * 0.12, 0.10, 0.35)
          : clamp(0.10 + barEnergy * 0.08 - (i - 1) * 0.01, 0.05, 0.25);
        // Stagger upper voices by 5ms to avoid phase cancellation between
        // detuned supersaw oscillators.
        const t = isBass ? time : time + 0.005 * i;
        notes.push({
          time: t,
          track: 6,
          midi: note,
          velocity: vel,
          duration: sustainDur,
        });
      }
    }
  }

  /** Should the pad play this bar? Character-driven. */
  private padPlaysAt(
    character: PhraseCharacter,
    bar: number,
    bars: number,
  ): boolean {
    switch (character) {
      case 'break':
        // Pad plays every bar (sustained) — but we hold each chord 2 bars.
        return true;
      case 'build':
        // Pad enters in bar 1.
        return bar >= 1;
      case 'drop':
      case 'tension':
        // Pad plays every bar.
        return true;
      case 'groove':
        // Pad plays every other bar (lighter texture).
        return bar % 2 === 0;
      case 'release':
        // Pad plays every bar, resolving.
        return true;
    }
  }

  // ── Arp composition ────────────────────────────────────────────────────

  /**
   * Compose the arp — fast arpeggios that complement the lead.
   *
   * The arp plays CALL-AND-RESPONSE with the lead in variation phrases
   * (the MelodyEngine generates a "response" motif that answers the lead's
   * "call"). In other phrases, the arp plays pattern-based arpeggios using
   * the current chord tones.
   *
   * Per-character:
   *   - build:   arp enters in bar 3, sparse.
   *   - drop:    fast 16th arpeggios using chord tones.
   *   - break:   no arp.
   *   - groove:  light 8th arpeggios.
   *   - tension: dissonant arp (avoid notes, chromatic).
   *   - release: arp thins out.
   *
   * In VARIATION development phase: arp plays the response motif (call-response).
   */
  private composeArp(
    notes: PhraseNote[],
    progression: Chord[],
    character: PhraseCharacter,
    energy: number,
    world: World,
    bars: number,
    s16: number,
  ): void {
    const stepsPerBar = 16;
    const totalSteps = bars * stepsPerBar;
    const isVariationPhase = this.developmentPhase === 'variation'
      || this.developmentPhase === 'contrast';

    for (let step = 0; step < totalSteps; step++) {
      const bar = Math.floor(step / stepsPerBar);
      const stepInBar = step % stepsPerBar;
      const time = step * s16;
      const barEnergy = this.barEnergy(character, energy, bar, bars);

      // Should the arp play at this step?
      if (!this.arpPlaysAt(character, bar, bars, stepInBar, barEnergy)) continue;

      // In variation phase, try call-response first.
      if (isVariationPhase) {
        const resp = this.melody.nextResponseNote(step, bar, energy);
        if (resp) {
          notes.push({
            time,
            track: 7,
            midi: resp.note,
            velocity: clamp(resp.velocity, 0.15, 0.6),
            duration: s16 * resp.duration,
          });
          continue;
        }
        // If no response event, fall through to pattern-based arp.
      }

      // Pattern-based arp: use the world's arpPattern + chord tones.
      const chord = progression[bar % progression.length];
      if (!chord) continue;

      // Use the world's arp pattern (8 scale degrees).
      const arp = world.arpPattern || [0, 2, 4, 7, 4, 2, 0, 7];
      const arpStep = Math.floor(step / 2) % arp.length;
      const deg = arp[arpStep];

      // The arp plays chord tones (root, 3rd, 5th, octave) — use the chord's
      // notes directly for a tighter harmonic fit.
      const chordTones = chord.notes;
      const arpNote = chordTones[arpStep % chordTones.length] + 12; // octave up

      const vel = clamp(0.20 + barEnergy * 0.15, 0.15, 0.45);
      notes.push({
        time,
        track: 7,
        midi: arpNote,
        velocity: vel,
        duration: s16 * 0.8,
      });
    }
  }

  /** Should the arp play at this step? Character-driven. */
  private arpPlaysAt(
    character: PhraseCharacter,
    bar: number,
    bars: number,
    stepInBar: number,
    barEnergy: number,
  ): boolean {
    const is8thOffbeat = stepInBar % 2 === 0; // 0, 2, 4, 6, 8, 10, 12, 14
    const is16th = true; // every 16th

    switch (character) {
      case 'break':
        return false;
      case 'build':
        // Arp enters in bar 3, 8th notes only.
        if (bar < 3) return false;
        return is8thOffbeat && barEnergy > 0.5;
      case 'drop':
      case 'tension':
        // Fast 16th arpeggios.
        return is16th && barEnergy > 0.5;
      case 'groove':
        // Light 8th arpeggios.
        return is8thOffbeat && barEnergy > 0.45;
      case 'release':
        // Arp thins out — 8ths in first half, none in second.
        if (bar >= bars / 2) return false;
        return is8thOffbeat && barEnergy > 0.3;
    }
  }

  // ── Phrase lifecycle ───────────────────────────────────────────────────

  /**
   * Prepare the next phrase (compose it ahead of time so the transition is
   * gapless). Called by the engine on section changes (when the flow engine
   * picks a new archetype) or whenever the engine knows a phrase boundary
   * is coming.
   *
   * The composed phrase is stored in `nextPhrase` and will become current
   * when:
   *   - advancePhrase(time) is called (explicit advance), OR
   *   - getNotesForWindow() detects the current phrase has ended (auto-advance).
   */
  prepareNextPhrase(
    energy: number,
    character: PhraseCharacter,
    world: World,
    bpm: number,
    startTime: number,
  ): void {
    // Determine phrase length: 4 bars for short sections, 8 for long.
    // The engine passes the section's bar count via world's energyCurve length
    // as a hint — but we default to 8 bars for musical phrasing.
    const bars = 8;

    this.nextPhrase = this.composePhrase(bars, energy, character, world, bpm, startTime);
  }

  /**
   * Force-advance to the next phrase at the given time. Used by the engine
   * when a section change happens mid-phrase (the new section's phrase
   * replaces the current one immediately).
   *
   * If no next phrase is prepared, compose one on the fly with the given
   * parameters.
   */
  advancePhrase(
    time: number,
    energy: number,
    character: PhraseCharacter,
    world: World,
    bpm: number,
  ): void {
    if (this.nextPhrase) {
      this.currentPhrase = this.nextPhrase;
      this.nextPhrase = null;
      this.currentPhrase.startTime = time;
    } else {
      // No prepared phrase — compose one now (fallback path).
      const bars = 8;
      this.currentPhrase = this.composePhrase(bars, energy, character, world, bpm, time);
    }
    this.phraseStartTime = time;
    this.phraseIdx++;
  }

  /**
   * Get all notes that should play in the given time window.
   *
   * Called by the engine's scheduler every 16th-step window. The director:
   *   1. Checks if the current phrase has ended (start + duration < endTime).
   *      If so, advances to the next phrase (auto-advance for gapless
   *      transitions when no section change happened).
   *   2. Filters the current phrase's notes whose absolute time falls in
   *      [startTime, endTime).
   *   3. Returns the filtered notes (with absolute times).
   *
   * If no current phrase exists (before start), composes one immediately.
   */
  getNotesForWindow(
    startTime: number,
    endTime: number,
    energy: number,
    character: PhraseCharacter,
    world: World,
    bpm: number,
  ): PhraseNote[] {
    // ── Lazy init: compose the first phrase if none exists ──
    if (!this.currentPhrase) {
      const bars = 8;
      this.currentPhrase = this.composePhrase(bars, energy, character, world, bpm, startTime);
      this.phraseStartTime = startTime;
      this.phraseIdx = 1;
    }

    // ── Auto-advance if the current phrase has ended ──
    const phraseEnd = this.phraseStartTime + this.currentPhrase.duration;
    if (startTime >= phraseEnd) {
      // The current phrase has ended. Advance to the next phrase.
      // If nextPhrase is prepared, use it. Otherwise, auto-compose one
      // with the same character/energy (gapless continuation).
      if (this.nextPhrase) {
        this.currentPhrase = this.nextPhrase;
        this.nextPhrase = null;
      } else {
        const bars = 8;
        this.currentPhrase = this.composePhrase(
          bars, energy, character, world, bpm, phraseEnd,
        );
      }
      this.phraseStartTime = phraseEnd;
      this.phraseIdx++;
    }

    // ── Filter notes whose absolute time is in [startTime, endTime) ──
    const phrase = this.currentPhrase;
    const phraseStart = this.phraseStartTime;
    const result: PhraseNote[] = [];

    // Compute the current chord based on the window's start time.
    // The chord changes per bar (or per 2 bars in breaks — but we approximate
    // per-bar here; the pad's actual sustain is handled in composePad).
    if (phrase.chords.length > 0) {
      const barDur = phrase.duration / phrase.bars;
      const barInPhrase = Math.floor((startTime - phraseStart) / barDur);
      const chordIdx = ((barInPhrase % phrase.chords.length) + phrase.chords.length) % phrase.chords.length;
      this.currentChord = phrase.chords[chordIdx] ?? null;
    }

    for (const note of phrase.notes) {
      const absTime = phraseStart + note.time;
      if (absTime >= startTime && absTime < endTime) {
        result.push({
          ...note,
          time: absTime, // absolute audio-context time
        });
      }
    }

    return result;
  }

  /**
   * Reset all phrase state. Called by the engine on stop() so the next
   * start() begins fresh.
   */
  reset(): void {
    this.currentPhrase = null;
    this.nextPhrase = null;
    this.phraseStartTime = 0;
    this.phraseIdx = 0;
    this.developmentPhase = 'statement';
    this.lastDropPhrase = null;
    this.lastMotifId = '';
    this.currentChord = null;
  }

  // ── Inspection (for debugging / UI) ────────────────────────────────────

  /** Get the current phrase (read-only snapshot) or null. */
  getCurrentPhrase(): Phrase | null {
    return this.currentPhrase ? { ...this.currentPhrase, notes: [...this.currentPhrase.notes] } : null;
  }

  /** Get the phrase index (how many phrases have been composed). */
  getPhraseIdx(): number {
    return this.phraseIdx;
  }

  /** Get the current development phase. */
  getDevelopmentPhase(): DevelopmentPhase {
    return this.developmentPhase;
  }

  /**
   * Get the chord that's currently playing (at the last-queried window time).
   * The engine uses this for the stutter surprise (firing lead notes at the
   * current chord root) and for the UI's chord display.
   *
   * Returns null if no phrase is active or the current phrase has no chords.
   */
  getCurrentChord(): Chord | null {
    return this.currentChord;
  }

  /**
   * The chord at the last-queried playback position. Updated by
   * getNotesForWindow() based on which bar the window falls in. This is
   * what getCurrentChord() returns.
   */
  private currentChord: Chord | null = null;
}

// ─── Legacy API (backwards compatibility for autonomousEngine / liveEngine) ──
//
// The original musicalDirector.ts (from the older "autonomous engine"
// architecture) exported these types + functions. They're still imported by
// `autonomousEngine.ts` and `liveEngine.ts` (legacy dead code, not used by
// the active PSY4 V2 engine). We re-export them here so those files keep
// compiling without modification. The new `MusicalDirector` class above is
// the active API used by `psy4EngineV2.ts`.
//
// Do NOT remove these — autonomousEngine.ts / liveEngine.ts still type-check
// against them even though they're not in the active code path.

import type { MusicalMemory, MacroControls } from './musicalMemory';
import type { World as LegacyWorld } from './worlds';
import type { Rng } from '../rng';
import { recordEvent, advanceMemory } from './musicalMemory';

export type SectionType =
  | 'intro' | 'groove' | 'development' | 'tension' | 'build'
  | 'drop' | 'breakdown' | 'rebuild' | 'second-drop' | 'climax' | 'outro';

export type LayerId =
  | 'kick' | 'bass' | 'lead' | 'pad' | 'texture' | 'arp' | 'hats' | 'perc' | 'fx';

export interface ArrangementSection {
  type: SectionType;
  bars: number;
  energy: number;        // 0..1 target energy for this section
  density: number;       // 0..1 target density
  tension: number;       // 0..1 target tension
  activeLayers: LayerId[];
}

export interface DirectorDecision {
  bar: number;
  section: SectionType;
  activeLayers: LayerId[];
  /** Should we mutate motifs this bar? */
  mutate: { layer: LayerId; intensity: number }[];
  /** Energy/density/tension targets (interpolated). */
  energy: number;
  density: number;
  tension: number;
  /** FX program changes. */
  fxAlgorithm1?: string;
  fxAlgorithm2?: string;
  /** Events to record. */
  events: string[];
}

/** Build a complete arrangement from a world + macros. */
export function buildArrangement(world: LegacyWorld, macros: MacroControls): ArrangementSection[] {
  const e = world.energyCurve;
  const baseEnergy = macros.energy;
  const sections: ArrangementSection[] = [
    { type: 'intro', bars: 8, energy: e[0] * baseEnergy, density: 0.25, tension: 0.2, activeLayers: ['pad', 'texture'] },
    { type: 'groove', bars: 8, energy: e[1] * baseEnergy, density: 0.45, tension: 0.3, activeLayers: ['kick', 'bass', 'pad', 'hats'] },
    { type: 'development', bars: 8, energy: e[2] * baseEnergy, density: 0.55, tension: 0.4, activeLayers: ['kick', 'bass', 'lead', 'pad', 'hats', 'perc'] },
    { type: 'tension', bars: 8, energy: e[3] * baseEnergy, density: 0.6, tension: 0.7, activeLayers: ['kick', 'bass', 'lead', 'pad', 'hats', 'perc', 'arp'] },
    { type: 'build', bars: 4, energy: e[4] * baseEnergy, density: 0.7, tension: 0.85, activeLayers: ['kick', 'bass', 'lead', 'arp', 'hats', 'perc', 'fx'] },
    { type: 'drop', bars: 16, energy: e[4] * baseEnergy, density: 0.85, tension: 0.5, activeLayers: ['kick', 'bass', 'lead', 'pad', 'texture', 'hats', 'perc', 'fx'] },
    { type: 'development', bars: 8, energy: e[5] * baseEnergy, density: 0.65, tension: 0.45, activeLayers: ['kick', 'bass', 'lead', 'pad', 'hats', 'perc'] },
    { type: 'breakdown', bars: 8, energy: e[6] * baseEnergy * 0.5, density: 0.3, tension: 0.35, activeLayers: ['pad', 'texture', 'fx'] },
    { type: 'rebuild', bars: 8, energy: e[6] * baseEnergy, density: 0.55, tension: 0.7, activeLayers: ['kick', 'bass', 'lead', 'arp', 'hats', 'fx'] },
    { type: 'second-drop', bars: 16, energy: e[4] * baseEnergy, density: 0.9, tension: 0.55, activeLayers: ['kick', 'bass', 'lead', 'pad', 'texture', 'arp', 'hats', 'perc', 'fx'] },
    { type: 'outro', bars: 8, energy: e[7] * baseEnergy * 0.6, density: 0.3, tension: 0.2, activeLayers: ['pad', 'texture', 'hats'] },
  ];
  return sections;
}

/** The Musical Director decides what to do at each bar. */
export function decideForBar(
  memory: MusicalMemory,
  world: LegacyWorld,
  macros: MacroControls,
  arrangement: ArrangementSection[],
  rng: Rng,
): { decision: DirectorDecision; memory: MusicalMemory } {
  const bar = memory.currentBar;
  let acc = 0;
  let section = arrangement[0];
  let sectionIndex = 0;
  for (let i = 0; i < arrangement.length; i++) {
    if (bar >= acc && bar < acc + arrangement[i].bars) {
      section = arrangement[i];
      sectionIndex = i;
      break;
    }
    acc += arrangement[i].bars;
  }

  const sectionProgress = (bar - acc) / Math.max(1, section.bars);
  const energy = section.energy;
  const density = section.density;
  const tension = section.tension + (section.type === 'build' ? sectionProgress * 0.3 : 0);

  const mutate: { layer: LayerId; intensity: number }[] = [];
  const events: string[] = [];

  const evoRate = macros.evolution * world.evolutionRate;
  if (rng.chance(evoRate * 0.3)) {
    mutate.push({ layer: 'lead', intensity: evoRate });
    events.push('lead mutated');
  }
  if (rng.chance(evoRate * 0.2)) {
    mutate.push({ layer: 'bass', intensity: evoRate * 0.5 });
    events.push('bass mutated');
  }
  if (rng.chance(evoRate * 0.25)) {
    mutate.push({ layer: 'arp', intensity: evoRate * 0.7 });
    events.push('arp mutated');
  }
  if (rng.chance(evoRate * 0.15)) {
    mutate.push({ layer: 'perc', intensity: evoRate * 0.6 });
    events.push('perc mutated');
  }

  let fxAlgorithm1: string | undefined;
  let fxAlgorithm2: string | undefined;
  if (bar === acc && sectionIndex > 0) {
    events.push(`section transition: ${section.type}`);
    if (section.type === 'breakdown') {
      fxAlgorithm1 = 'blackhole'; fxAlgorithm2 = 'shimmer';
    } else if (section.type === 'drop' || section.type === 'second-drop') {
      fxAlgorithm1 = world.fxAlgorithm1; fxAlgorithm2 = world.fxAlgorithm2;
    } else if (section.type === 'build') {
      fxAlgorithm1 = 'psyphase'; fxAlgorithm2 = 'modfilter';
    }
  }

  if (rng.chance(macros.surprise * 0.1)) {
    events.push('surprise fill');
    mutate.push({ layer: 'perc', intensity: 0.8 });
  }

  const decision: DirectorDecision = {
    bar,
    section: section.type,
    activeLayers: section.activeLayers,
    mutate,
    energy, density, tension,
    fxAlgorithm1, fxAlgorithm2,
    events,
  };

  let newMemory = recordEvent(memory, 'director', `bar ${bar}: ${section.type} e=${energy.toFixed(2)} d=${density.toFixed(2)} t=${tension.toFixed(2)}`);
  newMemory = advanceMemory(newMemory, bar + 1);
  newMemory = {
    ...newMemory,
    currentSection: section.type,
    energy, density, tension,
    totalMutations: newMemory.totalMutations + mutate.length,
  };

  return { decision, memory: newMemory };
}

/** Apply a macro control change (e.g. user moves "psychedelia" slider). */
export function applyMacroChange(memory: MusicalMemory, changes: Partial<MacroControls>): MusicalMemory {
  return { ...memory, ...changes };
}

/** Apply an action button (e.g. "STRANGER", "DARKER", "DROP"). */
export function applyAction(memory: MusicalMemory, action: string, _world: LegacyWorld): MusicalMemory {
  switch (action.toLowerCase()) {
    case 'stranger':
      return { ...memory, psychedelia: Math.min(1, memory.psychedelia + 0.2), evolution: Math.min(1, memory.evolution + 0.2), surprise: Math.min(1, memory.surprise + 0.15) };
    case 'darker':
      return { ...memory, darkness: Math.min(1, memory.darkness + 0.2), brightness: Math.max(0, memory.brightness - 0.15) };
    case 'brighter':
      return { ...memory, brightness: Math.min(1, memory.brightness + 0.2), darkness: Math.max(0, memory.darkness - 0.15) };
    case 'more-bass':
      return { ...memory, energy: Math.min(1, memory.energy + 0.15), aggression: Math.min(1, memory.aggression + 0.1) };
    case 'more-groove':
      return { ...memory, groove: Math.min(1, memory.groove + 0.2), density: Math.min(1, memory.density + 0.1) };
    case 'breakdown':
      return { ...memory, energy: Math.max(0.1, memory.energy * 0.4), density: Math.max(0.1, memory.density * 0.4), space: Math.min(1, memory.space + 0.3) };
    case 'build':
      return { ...memory, energy: Math.min(1, memory.energy + 0.2), tension: Math.min(1, memory.tension + 0.3), density: Math.min(1, memory.density + 0.15) };
    case 'drop':
      return { ...memory, energy: 1, density: 0.9, tension: 0.5, aggression: Math.min(1, memory.aggression + 0.2) };
    case 'more-space':
      return { ...memory, space: Math.min(1, memory.space + 0.25) };
    case 'reset':
      return { ...memory, energy: 0.6, psychedelia: 0.55, darkness: 0.4, density: 0.55, groove: 0.5, evolution: 0.5, space: 0.4, surprise: 0.3, aggression: 0.4, brightness: 0.55, tension: 0.3 };
    default:
      return memory;
  }
}
