/**
 * MusicAnalyzer — hears MUSIC, not just features.
 *
 * The reference listener extracts ACOUSTIC features (BPM, LUFS, spectral bands).
 * This module extracts MUSICAL features:
 *   - Melodic contour (rising/falling/arch)
 *   - Rhythmic pattern (kick on 1,5,9,13? offbeat hats? syncopation?)
 *   - Chord change detection (harmonic rhythm)
 *   - Section boundaries (intro → groove → drop → break)
 *   - Riser/drop detection (energy builds and releases)
 *   - Key modulation detection
 *
 * This is what separates "matching frequencies" from "matching music".
 *
 * DESIGN
 * ------
 * The reference listener emits a fresh feature window every ~10s. update() is
 * called with that snapshot. Internally we keep bounded rolling histories
 * (default 5-minute window) of the scalar features that drive the detectors,
 * plus an event log (60s retention) of musical events the engine can react to.
 *
 * All time values are wall-clock seconds (via performance.now()/1000 with a
 * Date.now() fallback). The engine reads getRecentEvents(secondsBack) and
 * reacts to anything newer than its last check — typically the events emitted
 * by the most recent update() call.
 *
 * EFFICIENCY
 * ----------
 * update() is O(n) with n ≤ ~30 history samples per axis (5-min window / 10s
 * hop). No allocation in the steady state beyond the rare event push. No
 * per-block work — the analyzer runs ONLY on reference windows.
 *
 * GUARDS
 * ------
 * Every feature is guarded against NaN/undefined/zero. Missing data → the
 * relevant detector no-ops and the previous estimate is retained. The first
 * update() with no prior history returns a conservative default analysis
 * (groove section, static contour, offbeat hats) instead of crashing.
 */

import { SCALES } from './musicalGrammar';

// ─── Public types ───────────────────────────────────────────────────────────

export interface MusicalEvent {
  type:
    | 'chordChange'
    | 'sectionBoundary'
    | 'riserStart'
    | 'dropHit'
    | 'breakStart'
    | 'keyChange'
    | 'melodicPeak'
    | 'rhythmicFill';
  time: number;           // wall-clock seconds (performance.now()/1000)
  confidence: number;     // 0..1
  data?: any;             // type-specific payload (see emit* methods)
}

export interface MelodicContour {
  shape: 'rising' | 'falling' | 'arch' | 'descending' | 'wave' | 'static';
  range: number;          // semitones, peak-to-trough over the analysis window
  direction: number;      // -1..1, net linear direction
}

export interface RhythmicPattern {
  kickPattern: string;    // 16-char gate string ('x' = hit, '.' = rest)
  hatPattern: string;     // 16-char gate string
  syncopation: number;    // 0..1, how offbeat-heavy
  density: number;        // 0..1, hits per bar normalized
}

export interface SectionState {
  label: 'intro' | 'groove' | 'build' | 'drop' | 'variation' | 'break' | 'outro';
  bar: number;            // bar within section (0-based)
  barsInSection: number;  // estimated section length (bars)
  energy: number;         // 0..1 current section energy
  confidence: number;     // 0..1 — rises with history depth
}

export interface MusicalAnalysis {
  events: MusicalEvent[];           // detected events (last 60s, newest last)
  contour: MelodicContour;          // current melodic contour
  rhythm: RhythmicPattern;          // current rhythmic pattern
  section: SectionState;            // current section
  harmonicRhythm: number;           // bars per chord change (running average)
  recentKeyChanges: { time: number; from: string; to: string }[];
}

// ─── Input shape (extended from the spec; all extra fields are optional) ─────

export interface MusicAnalyzerFeatures {
  energy: number;
  spectralCentroid: number;
  transientDensity: number;
  bpm: number;
  subEnergy: number;
  highEnergy: number;
  detectedKey?: { root: number; scale: string; confidence: number };
  // Extended (Task T1 + listener V2) — all optional so older callers no-op:
  spectralFlatness?: number;
  hnr?: number;
  kickDensity?: number;
  hatDensity?: number;
  lowEnergy?: number;
  midEnergy?: number;
  airEnergy?: number;
  rhythmicRegularity?: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Rolling history window (seconds). 5 minutes ≈ 30 reference windows. */
const HISTORY_WINDOW_SEC = 300;

/** Events older than this are pruned from the log. */
const EVENT_RETENTION_SEC = 60;

/** Cooldowns prevent the same detector firing on every update while the
 *  condition persists — we only emit on the TRANSITION. */
const DROP_COOLDOWN_SEC = 30;
const RISER_COOLDOWN_SEC = 30;
const BREAK_COOLDOWN_SEC = 30;
const CHORD_COOLDOWN_SEC = 4;
const KEY_CHANGE_COOLDOWN_SEC = 20;
const SECTION_MIN_BARS = 4;          // don't re-label more often than this
const MELODIC_PEAK_COOLDOWN_SEC = 20;

/** Window over which contour + slope are measured (≈ 4 bars at 140 BPM). */
const SLOPE_WINDOW_SEC = 16;

/**
 * Cooldown for melodic-motif extraction (Task P5). The analyzer updates
 * every ~10s but the centroid only changes meaningfully over a longer
 * window — extracting every 30s avoids learning the same motif repeatedly.
 */
const MOTIF_EXTRACT_COOLDOWN_SEC = 30;

/** Default rhythmic patterns (16-char gate strings, 16th-note resolution). */
const KICK_PATTERNS: Record<string, string> = {
  fourOnFloor: 'x...x...x...x...',
  twoBar:      'x.......x.......',
  halfTime:    'x...............',
  eighth:      'x.x.x.x.x.x.x.x.',
  gallop:      'x.x.x...x.x.x...',
  busy:        'x.xxx.x.xxx.x...',
  none:        '................',
};

const HAT_PATTERNS: Record<string, string> = {
  offbeat: '.x.x.x.x.x.x.x.x',
  steady:  'x.x.x.x.x.x.x.x.',
  busy:    'xxxxxxxxxxxxxxxx',
  sparse:  '..x.....x.....x.',
  triplet: 'x..x..x..x..x..x',
  none:    '................',
};

const DEFAULT_CONTOUR: MelodicContour = {
  shape: 'static',
  range: 0,
  direction: 0,
};

const DEFAULT_RHYTHM: RhythmicPattern = {
  kickPattern: KICK_PATTERNS.fourOnFloor,
  hatPattern: HAT_PATTERNS.offbeat,
  syncopation: 0.3,
  density: 0.5,
};

// ─── MusicAnalyzer ──────────────────────────────────────────────────────────

export class MusicAnalyzer {
  // Bounded rolling histories — pruned to HISTORY_WINDOW_SEC every update.
  private energyHistory: { time: number; value: number }[] = [];
  private spectralHistory: { time: number; centroid: number; value: number }[] = [];
  private flatnessHistory: { time: number; value: number }[] = [];
  private transientHistory: { time: number; value: number }[] = [];
  private highEnergyHistory: { time: number; value: number }[] = [];

  // Detected events (newest last). Pruned to EVENT_RETENTION_SEC.
  private events: MusicalEvent[] = [];

  // Section state — the label flips on transitions; bar accumulates within.
  private section: SectionState = {
    label: 'groove',
    bar: 0,
    barsInSection: 8,
    energy: 0.5,
    confidence: 0,
  };

  // Running estimates returned by the getters.
  private contour: MelodicContour = { ...DEFAULT_CONTOUR };
  private rhythm: RhythmicPattern = { ...DEFAULT_RHYTHM };
  private harmonicRhythm = 4; // bars per chord (default 4 — typical 4-bar harmony)

  // Bar accumulation across updates. update() runs every ~10s, so we convert
  // elapsed wall-clock seconds to elapsed bars via the latest BPM.
  private barCount = 0;
  private lastUpdateTime = 0;
  private sectionStartBar = 0;
  private lastBpm = 140;

  // Cooldown timestamps (wall-clock seconds). Zero = "never fired".
  private lastDropTime = 0;
  private lastRiserTime = 0;
  private lastBreakTime = 0;
  private lastChordTime = 0;
  private lastKeyTime = 0;
  private lastMelodicPeakTime = 0;

  // Chord-change rate tracking (running average → harmonicRhythm).
  private chordChanges = 0;
  private firstChordTime = 0;
  // Cached previous-sample harmonic-content proxies (for delta computation).
  private lastHnr: number | null = null;
  private lastSubEnergy: number | null = null;

  // Key tracking — emit keyChange when root or scale shifts with confidence.
  private lastKey: { root: number; scale: string } | null = null;
  private recentKeyChanges: { time: number; from: string; to: string }[] = [];

  // Whether we've seen at least one drop — disambiguates intro vs outro.
  private hasDroppedOnce = false;

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Called every reference window (~10s) with the latest acoustic features.
   * Updates all rolling histories, runs the detectors, emits new events,
   * and returns the current MusicalAnalysis snapshot.
   */
  update(features: MusicAnalyzerFeatures): MusicalAnalysis {
    const now = this.now();

    // ── 1. Push to histories (guarded against NaN / undefined / zero) ──
    if (typeof features.energy === 'number' && isFinite(features.energy)) {
      this.energyHistory.push({ time: now, value: clamp(features.energy, 0, 1) });
    }
    if (typeof features.spectralCentroid === 'number' && isFinite(features.spectralCentroid) && features.spectralCentroid > 0) {
      const c = features.spectralCentroid;
      this.spectralHistory.push({ time: now, centroid: c, value: c });
    }
    if (typeof features.spectralFlatness === 'number' && isFinite(features.spectralFlatness)) {
      this.flatnessHistory.push({ time: now, value: clamp(features.spectralFlatness, 0, 1) });
    }
    if (typeof features.transientDensity === 'number' && isFinite(features.transientDensity) && features.transientDensity >= 0) {
      this.transientHistory.push({ time: now, value: features.transientDensity });
    }
    if (typeof features.highEnergy === 'number' && isFinite(features.highEnergy)) {
      this.highEnergyHistory.push({ time: now, value: clamp(features.highEnergy, 0, 1) });
    }

    // ── 2. Prune histories ──
    this.pruneHistory(this.energyHistory, now);
    this.pruneSpectralHistory(this.spectralHistory, now);
    this.pruneHistory(this.flatnessHistory, now);
    this.pruneHistory(this.transientHistory, now);
    this.pruneHistory(this.highEnergyHistory, now);
    this.pruneEvents(now);

    // ── 3. Update BPM + accumulate elapsed bars ──
    if (typeof features.bpm === 'number' && isFinite(features.bpm) && features.bpm > 0) {
      this.lastBpm = clamp(features.bpm, 30, 220);
    }
    if (this.lastUpdateTime > 0) {
      const dtSec = Math.max(0, now - this.lastUpdateTime);
      // 4/4 time: 1 bar = 4 beats = (4 * 60 / bpm) seconds.
      const barsPerSec = this.lastBpm / 240;
      this.barCount += dtSec * barsPerSec;
    }
    this.lastUpdateTime = now;

    // ── 4. Run the detectors (each emits events internally) ──
    this.detectSectionAndTransitions(features, now);
    this.detectChordChanges(features, now);
    this.detectKeyChange(features, now);
    this.updateContour(now);
    this.updateRhythm(features);

    // ── 5. Update the section's bar-within-section counter ──
    this.section.bar = Math.max(0, Math.floor(this.barCount - this.sectionStartBar));
    this.section.barsInSection = Math.max(this.section.barsInSection, this.section.bar + 1);

    return this.getAnalysis();
  }

  /** Get events from the last `secondsBack` seconds (newest last). */
  getRecentEvents(secondsBack: number): MusicalEvent[] {
    if (secondsBack <= 0) return [...this.events];
    const cutoff = this.now() - secondsBack;
    return this.events.filter((e) => e.time >= cutoff);
  }

  getCurrentSection(): SectionState {
    return { ...this.section };
  }

  getRhythm(): RhythmicPattern {
    return { ...this.rhythm };
  }

  getContour(): MelodicContour {
    return { ...this.contour };
  }

  // ─── Task P5: melodic motif extraction ────────────────────────────────────

  /**
   * Extract a melodic motif (sequence of scale degrees) from the recent
   * spectral-centroid history. This is the pitch-detection proxy used by
   * the VocabularyLearner — we don't have raw audio, so we approximate
   * "the radio's melody" by tracking the spectral centroid over a ~60s
   * window (6-8 reference samples). Each sample's centroid Hz → MIDI note
   * → quantized scale degree (relative to the engine's musical key).
   *
   * The result is a SHORT motif (4-8 notes of typical 8th-note duration)
   * whose contour mirrors the radio's macro-melodic motion. The
   * MusicalDirector's transformation pipeline (transpose / invert /
   * fragment / sequence) develops it further, so even a coarse contour
   * approximation produces musical material that connects to the radio.
   *
   * Cooldown: 30s. Extracting more often would just produce the same
   * motif repeatedly (the analyzer updates every ~10s but the centroid
   * only changes meaningfully over a longer window).
   *
   * Returns null if:
   *   - The cooldown hasn't elapsed.
   *   - There aren't enough samples (<4) in the window.
   *   - The contour is "static" (centroids all within ±100 Hz — no
   *     meaningful motion to learn).
   *   - The root/scale are invalid.
   */
  extractRecentMelodicMotif(
    root: number,
    scale: string,
  ): { notes: number[]; durations: number[]; velocities: number[] } | null {
    if (!isFinite(root) || root < 0 || root > 127) return null;
    const sc = SCALES[scale] || SCALES.minor;
    const now = this.now();
    if (now - this.lastMotifExtractTime < MOTIF_EXTRACT_COOLDOWN_SEC) return null;

    // Pull the last ~60s of spectral samples (≈ 6 samples at 10s hops).
    const windowSec = 60;
    const cutoff = now - windowSec;
    const pts = this.spectralHistory.filter(p => p.time >= cutoff);
    if (pts.length < 4) return null;

    // Reject static contours (peak-to-trough < 100 Hz = pedal note, not
    // a melodic motif worth learning).
    const centroids = pts.map(p => p.centroid);
    const peak = Math.max(...centroids);
    const trough = Math.min(...centroids);
    if (peak - trough < 100) return null;

    // Convert each centroid → MIDI → scale degree. Sample energy → velocity.
    const notes: number[] = [];
    const durations: number[] = [];
    const velocities: number[] = [];

    for (let i = 0; i < pts.length; i++) {
      const c = pts[i].centroid;
      if (!isFinite(c) || c <= 0) continue;
      // Hz → MIDI (A4=440Hz=69).
      const midi = 12 * Math.log2(c / 440) + 69;
      if (!isFinite(midi) || midi < 12 || midi > 127) continue;
      const deg = this.midiToScaleDegree(midi, root, sc);
      if (!isFinite(deg)) continue;

      // Find the energy sample at (or very near) this time. We search the
      // energy history backwards from the end for a sample within ±1s.
      let energy = 0.5;
      for (let j = this.energyHistory.length - 1; j >= 0; j--) {
        if (Math.abs(this.energyHistory[j].time - pts[i].time) < 2) {
          energy = this.energyHistory[j].value;
          break;
        }
      }
      // Map energy 0..1 → velocity 0.35..0.9.
      const vel = clamp(0.35 + energy * 0.55, 0.25, 0.95);

      // Skip duplicate consecutive degrees (motif shouldn't repeat the
      // same note 6 times — that's a pedal, not a melody). We replace
      // the previous note's duration instead of pushing a new entry.
      if (notes.length > 0 && notes[notes.length - 1] === deg) {
        durations[durations.length - 1] += 2;
        // Keep the louder velocity.
        if (vel > velocities[velocities.length - 1]) {
          velocities[velocities.length - 1] = vel;
        }
        continue;
      }

      notes.push(deg);
      durations.push(2); // 8th note by default (16th-step units)
      velocities.push(vel);
    }

    // Need 4-8 distinct notes for a meaningful motif.
    if (notes.length < 4 || notes.length > 12) {
      this.lastMotifExtractTime = now;
      return null;
    }
    // Trim to first 8 if longer (keeps motifs singable).
    const trimmed = notes.length > 8
      ? {
          notes: notes.slice(0, 8),
          durations: durations.slice(0, 8),
          velocities: velocities.slice(0, 8),
        }
      : { notes, durations, velocities };

    this.lastMotifExtractTime = now;
    return trimmed;
  }

  /**
   * Convert a MIDI note to a scale degree (root-relative integer that may
   * be negative or >7 — wraps octaves via MelodyEngine.scaleNote).
   *
   * Algorithm: precompute all scale pitches over a 7-octave range centered
   * on the root, find the nearest MIDI in that list, return the degree.
   * O(sc.length × 7) per call — trivial.
   */
  private midiToScaleDegree(midi: number, root: number, sc: number[]): number {
    let bestDeg = 0;
    let bestDist = Infinity;
    const n = sc.length;
    for (let octave = -3; octave <= 4; octave++) {
      for (let i = 0; i < n; i++) {
        const candMidi = root + octave * 12 + sc[i];
        const d = Math.abs(candMidi - midi);
        if (d < bestDist) {
          bestDist = d;
          bestDeg = octave * n + i;
        }
      }
    }
    return bestDeg;
  }

  /** Wall-clock seconds of the last motif extraction (cooldown tracker). */
  private lastMotifExtractTime = 0;

  /**
   * Build the full MusicalAnalysis snapshot (used by the engine + UI).
   * The events list is the last 60s (newest last). All fields are
   * defensive copies so callers can't mutate internal state.
   */
  getAnalysis(): MusicalAnalysis {
    return {
      events: this.events.map((e) => ({ ...e })),
      contour: { ...this.contour },
      rhythm: { ...this.rhythm },
      section: { ...this.section },
      harmonicRhythm: this.harmonicRhythm,
      recentKeyChanges: this.recentKeyChanges.map((k) => ({ ...k })),
    };
  }

  // ─── Section detection (Steps 2 + 3) ─────────────────────────────────────

  /**
   * Section detection — the KEY insight is that sections are defined by
   * ENERGY changes, not absolute values. We compute:
   *   - current energy (latest sample)
   *   - short-term slope (over SLOPE_WINDOW_SEC ≈ 4 bars)
   *   - long-term min/max (to detect sustained regions)
   *
   * Then we apply a state machine:
   *   - if rising > 0.02/s AND energy 0.4-0.8 AND prev not build → BUILD, emit riserStart
   *   - if energy > 0.8 AND (prev was build OR energy was < 0.6 recently) → DROP, emit dropHit
   *   - if energy > 0.7 AND prev was drop AND not rising → VARIATION
   *   - if energy < 0.4 AND prev was drop/variation AND falling < -0.02/s → BREAK, emit breakStart
   *   - if energy < 0.4 AND prev not drop/intro AND !hasDroppedOnce → INTRO
   *   - if energy < 0.4 AND prev not outro AND hasDroppedOnce AND not falling → OUTRO
   *   - else (0.4-0.7 stable) → GROOVE
   *
   * Transitions are gated by SECTION_MIN_BARS so we don't flicker.
   */
  private detectSectionAndTransitions(features: MusicAnalyzerFeatures, now: number): void {
    const hist = this.energyHistory;
    if (hist.length === 0) return;

    const currentEnergy = hist[hist.length - 1].value;
    const slope = this.slope(hist, SLOPE_WINDOW_SEC);
    const longWindow = this.valuesInWindow(hist, HISTORY_WINDOW_SEC);
    const recentMax = longWindow.length > 0 ? Math.max(...longWindow) : currentEnergy;
    const recentMin = longWindow.length > 0 ? Math.min(...longWindow) : currentEnergy;
    const shortWindow = this.valuesInWindow(hist, SLOPE_WINDOW_SEC);
    const shortMin = shortWindow.length > 0 ? Math.min(...shortWindow) : currentEnergy;

    const prevLabel = this.section.label;
    const barsInSection = Math.max(0, this.barCount - this.sectionStartBar);

    // Update the section's energy estimate (smoothed).
    this.section.energy = currentEnergy;

    let nextLabel: SectionState['label'] = prevLabel;
    let emittedRiser = false;
    let emittedDrop = false;
    let emittedBreak = false;

    // ── DROP detection: energy crosses 0.8 after being below 0.6 recently ──
    if (
      currentEnergy >= 0.8 &&
      shortMin < 0.6 &&
      now - this.lastDropTime > DROP_COOLDOWN_SEC &&
      prevLabel !== 'drop'
    ) {
      nextLabel = 'drop';
      this.hasDroppedOnce = true;
      this.lastDropTime = now;
      emittedDrop = true;
    }
    // ── BUILD / riser: rising slope + energy 0.4-0.8 + not already in build ──
    else if (
      slope > 0.02 &&
      currentEnergy > 0.4 &&
      currentEnergy < 0.85 &&
      prevLabel !== 'build' &&
      prevLabel !== 'drop' &&
      now - this.lastRiserTime > RISER_COOLDOWN_SEC
    ) {
      nextLabel = 'build';
      this.lastRiserTime = now;
      emittedRiser = true;
    }
    // ── VARIATION: sustained high but no longer peak-rising, after a drop ──
    else if (
      currentEnergy >= 0.65 &&
      currentEnergy < 0.85 &&
      Math.abs(slope) < 0.02 &&
      (prevLabel === 'drop' || prevLabel === 'variation') &&
      barsInSection >= SECTION_MIN_BARS
    ) {
      nextLabel = 'variation';
    }
    // ── BREAK: sudden energy drop after a drop/variation ──
    else if (
      currentEnergy < 0.4 &&
      recentMax > 0.65 &&
      slope < -0.02 &&
      (prevLabel === 'drop' || prevLabel === 'variation' || prevLabel === 'build') &&
      now - this.lastBreakTime > BREAK_COOLDOWN_SEC
    ) {
      nextLabel = 'break';
      this.lastBreakTime = now;
      emittedBreak = true;
    }
    // ── OUTRO: low + not falling + we've dropped at least once ──
    else if (
      currentEnergy < 0.4 &&
      Math.abs(slope) < 0.015 &&
      this.hasDroppedOnce &&
      prevLabel !== 'outro' &&
      barsInSection >= SECTION_MIN_BARS
    ) {
      nextLabel = 'outro';
    }
    // ── INTRO: low + not falling + haven't dropped yet ──
    else if (
      currentEnergy < 0.4 &&
      Math.abs(slope) < 0.015 &&
      !this.hasDroppedOnce &&
      prevLabel !== 'intro' &&
      prevLabel !== 'outro'
    ) {
      nextLabel = 'intro';
    }
    // ── GROOVE: stable mid-energy ──
    else if (
      currentEnergy >= 0.4 &&
      currentEnergy < 0.7 &&
      Math.abs(slope) < 0.02 &&
      prevLabel !== 'groove' &&
      barsInSection >= SECTION_MIN_BARS
    ) {
      nextLabel = 'groove';
    }

    // ── Apply the transition ──
    if (nextLabel !== prevLabel) {
      // Force at least SECTION_MIN_BARS between flips (except for the initial
      // transition into a new label from a fresh start).
      if (barsInSection < SECTION_MIN_BARS && prevLabel !== 'groove' && this.barCount > SECTION_MIN_BARS) {
        // Too soon — suppress the flip but keep computing slopes.
      } else {
        this.section.label = nextLabel;
        this.sectionStartBar = Math.floor(this.barCount);
        this.section.bar = 0;
        this.section.barsInSection = this.estimateSectionLength(nextLabel);
        this.section.confidence = this.historyConfidence();
        this.emit('sectionBoundary', now, this.section.confidence, {
          from: prevLabel,
          to: nextLabel,
          energy: currentEnergy,
          bar: Math.floor(this.barCount),
        });
      }
    } else {
      // Same section — keep confidence fresh.
      this.section.confidence = this.historyConfidence();
    }

    // ── Emit riser / drop / break events (separate from sectionBoundary) ──
    if (emittedRiser) {
      this.emit('riserStart', now, 0.7, {
        fromEnergy: shortMin,
        toEnergy: currentEnergy,
        slopePerSec: slope,
        bar: Math.floor(this.barCount),
      });
    }
    if (emittedDrop) {
      this.emit('dropHit', now, 0.85, {
        energy: currentEnergy,
        recentMax,
        bar: Math.floor(this.barCount),
      });
    }
    if (emittedBreak) {
      this.emit('breakStart', now, 0.75, {
        fromEnergy: recentMax,
        toEnergy: currentEnergy,
        slopePerSec: slope,
        bar: Math.floor(this.barCount),
      });
    }
  }

  /**
   * Estimate a plausible section length (in bars) for the given label.
   * Used as a planning hint; the actual length is open-ended.
   */
  private estimateSectionLength(label: SectionState['label']): number {
    switch (label) {
      case 'intro': return 8;
      case 'groove': return 16;
      case 'build': return 8;
      case 'drop': return 16;
      case 'variation': return 8;
      case 'break': return 8;
      case 'outro': return 8;
      default: return 8;
    }
  }

  // ─── Rhythmic pattern estimation (Step 4) ────────────────────────────────

  /**
   * Estimate the kick + hat gate patterns from transient / kick / hat
   * densities and the BPM. We convert "per second" densities to "per bar"
   * using the 4/4 bar duration (240/BPM seconds), then pick the closest
   * canonical pattern.
   *
   * Syncopation is approximated: if transient density is high but kick
   * density is low, the rhythm is offbeat-heavy → high syncopation. If
   * transient ≈ kick × 2 (typical 4-on-floor + offbeat hats), syncopation
   * is moderate. If everything aligns to the beat grid, syncopation is low.
   */
  private updateRhythm(features: MusicAnalyzerFeatures): void {
    const bpm = this.lastBpm;
    const barSec = 240 / bpm; // 4/4
    const td = typeof features.transientDensity === 'number' ? features.transientDensity : 0;
    const kd = typeof features.kickDensity === 'number' ? features.kickDensity : 0;
    const hd = typeof features.hatDensity === 'number' ? features.hatDensity : 0;
    const reg = typeof features.rhythmicRegularity === 'number' ? features.rhythmicRegularity : 0.5;

    const transientsPerBar = td * barSec;
    const kicksPerBar = kd > 0 ? kd * barSec : this.estimateKicksFromTransient(transientsPerBar, features.highEnergy ?? 0);
    const hatsPerBar = hd > 0 ? hd * barSec : this.estimateHatsFromTransient(transientsPerBar, features.highEnergy ?? 0);

    // ── Kick pattern: pick the closest canonical pattern by hit count ──
    let kickPattern = KICK_PATTERNS.fourOnFloor;
    if (kicksPerBar <= 0.5) kickPattern = KICK_PATTERNS.none;
    else if (kicksPerBar <= 1.5) kickPattern = KICK_PATTERNS.halfTime;
    else if (kicksPerBar <= 2.5) kickPattern = KICK_PATTERNS.twoBar;
    else if (kicksPerBar <= 4.5) kickPattern = KICK_PATTERNS.fourOnFloor;
    else if (kicksPerBar <= 6.5) kickPattern = KICK_PATTERNS.gallop;
    else if (kicksPerBar <= 8.5) kickPattern = KICK_PATTERNS.eighth;
    else kickPattern = KICK_PATTERNS.busy;

    // ── Hat pattern: pick by hat density ──
    let hatPattern = HAT_PATTERNS.offbeat;
    if (hatsPerBar <= 0.5) hatPattern = HAT_PATTERNS.none;
    else if (hatsPerBar <= 3.5) hatPattern = HAT_PATTERNS.sparse;
    else if (hatsPerBar <= 6.5) hatPattern = HAT_PATTERNS.offbeat;
    else if (hatsPerBar <= 9.5) hatPattern = HAT_PATTERNS.steady;
    else if (hatsPerBar <= 14) hatPattern = HAT_PATTERNS.triplet;
    else hatPattern = HAT_PATTERNS.busy;

    // ── Syncopation: high when transients are dense but kicks are sparse ──
    const offbeatRatio = kicksPerBar > 0
      ? clamp((transientsPerBar - kicksPerBar) / Math.max(1, transientsPerBar), 0, 1)
      : transientsPerBar > 6 ? 0.7 : 0.3;
    // Blend with rhythmic regularity (low regularity → high syncopation).
    const syncopation = clamp(0.5 * offbeatRatio + 0.5 * (1 - reg), 0, 1);

    // ── Density: normalize transients/bar to 0..1 (16 = max) ──
    const density = clamp(transientsPerBar / 16, 0, 1);

    this.rhythm = { kickPattern, hatPattern, syncopation, density };
  }

  /**
   * Fallback when the listener doesn't expose kickDensity: estimate kicks/bar
   * from total transient density + highEnergy. 4-on-floor is the most common
   * pattern, so we bias toward 4.
   */
  private estimateKicksFromTransient(transientsPerBar: number, highEnergy: number): number {
    if (transientsPerBar <= 0) return 0;
    // High-energy content usually means hats/percussion on top of kicks.
    // Heuristic: if transients are ~4, all 4 are kicks. If transients are
    // ~8, half are kicks (4 kicks + 4 hats). If transients are ~16, ~25%
    // are kicks (4 kicks + 12 hats/perc).
    const kickRatio = highEnergy > 0.4 ? 0.35 : 0.6;
    const est = transientsPerBar * kickRatio;
    // Snap to nearest canonical value (0, 1, 2, 4, 6, 8, 12) so the pattern
    // picker lands cleanly.
    const snapPoints = [0, 1, 2, 4, 6, 8, 12];
    return snapPoints.reduce((best, p) => (Math.abs(p - est) < Math.abs(best - est) ? p : best), 4);
  }

  private estimateHatsFromTransient(transientsPerBar: number, highEnergy: number): number {
    if (transientsPerBar <= 0) return 0;
    // If high energy is significant, hats are likely present.
    if (highEnergy < 0.1) return 0;
    const est = transientsPerBar * (highEnergy > 0.4 ? 0.5 : 0.3);
    const snapPoints = [0, 2, 4, 6, 8, 12, 16];
    return snapPoints.reduce((best, p) => (Math.abs(p - est) < Math.abs(best - est) ? p : best), 8);
  }

  // ─── Melodic contour detection (Step 5) ──────────────────────────────────

  /**
   * Estimate melodic contour from the spectral centroid history. Spectral
   * centroid is a proxy for "brightness" which tracks melodic register —
   * when the melody moves up, more energy shifts to higher partials and
   * the centroid rises. This is a coarse but well-known approximation.
   *
   * Shapes:
   *   - rising: monotonic increase over the window
   *   - falling: monotonic decrease
   *   - arch: rises then falls (peaked phrase)
   *   - descending: same as falling but stronger slope
   *   - wave: alternating up/down (oscillating phrase)
   *   - static: stable (pedal note)
   *
   * Range = peak-to-trough centroid mapped to semitones via 12*log2(peak/trough).
   */
  private updateContour(now: number): void {
    const hist = this.spectralHistory;
    if (hist.length < 2) {
      this.contour = { ...DEFAULT_CONTOUR };
      return;
    }

    const cutoff = now - SLOPE_WINDOW_SEC;
    const pts = hist.filter((p) => p.time >= cutoff);
    if (pts.length < 2) {
      this.contour = { ...DEFAULT_CONTOUR };
      return;
    }

    const centroids = pts.map((p) => p.centroid);
    const first = centroids[0];
    const last = centroids[centroids.length - 1];
    const peak = Math.max(...centroids);
    const trough = Math.min(...centroids);
    const peakIdx = centroids.indexOf(peak);
    const troughIdx = centroids.indexOf(trough);

    const slopePerSec = (last - first) / Math.max(0.001, pts[pts.length - 1].time - pts[0].time);
    const direction = clamp(slopePerSec / 200, -1, 1); // ±200 Hz/s = saturated

    // Range in semitones (12 * log2(peak/trough)).
    let range = 0;
    if (trough > 0 && peak > trough) {
      range = 12 * Math.log2(peak / trough);
    }

    let shape: MelodicContour['shape'];
    const amplitude = peak - trough;
    if (amplitude < 150) {
      // Very stable centroid → static (pedal note / drone).
      shape = 'static';
    } else if (peakIdx > pts.length * 0.4 && peakIdx < pts.length * 0.7 && troughIdx < pts.length * 0.3) {
      // Peak in the middle, trough at the start → arch.
      shape = 'arch';
    } else if (slopePerSec > 80) {
      shape = 'rising';
    } else if (slopePerSec < -80) {
      shape = slopePerSec < -200 ? 'descending' : 'falling';
    } else if (this.isWave(centroids)) {
      shape = 'wave';
    } else if (slopePerSec > 0) {
      shape = 'rising';
    } else if (slopePerSec < 0) {
      shape = 'falling';
    } else {
      shape = 'static';
    }

    this.contour = { shape, range: clamp(range, 0, 36), direction };

    // ── Emit melodicPeak when we just crossed a local maximum ──
    if (
      peakIdx === centroids.length - 1 &&
      peak > first + 400 &&
      now - this.lastMelodicPeakTime > MELODIC_PEAK_COOLDOWN_SEC
    ) {
      this.lastMelodicPeakTime = now;
      this.emit('melodicPeak', now, 0.6, {
        centroid: peak,
        range,
        bar: Math.floor(this.barCount),
      });
    }
  }

  /**
   * Detect wave shape — alternating sign of consecutive deltas.
   * Returns true if at least half the deltas flip sign.
   */
  private isWave(values: number[]): boolean {
    if (values.length < 4) return false;
    let signChanges = 0;
    let prevSign = 0;
    for (let i = 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      const sign = d > 50 ? 1 : d < -50 ? -1 : 0;
      if (sign !== 0 && prevSign !== 0 && sign !== prevSign) signChanges++;
      if (sign !== 0) prevSign = sign;
    }
    return signChanges >= Math.floor(values.length / 3);
  }

  // ─── Chord change detection (Step 6) ─────────────────────────────────────

  /**
   * Detect chord changes from harmonic-content proxies. We don't have a
   * direct chord detector, but we can detect harmonic CONTENT changes:
   *   - spectralFlatness shifts (timbre changes — often a chord change)
   *   - HNR shifts (more/less harmonicity — a new chord has different
   *     harmonic structure)
   *   - subEnergy shifts (bass note changes — root motion)
   *
   * When the combined delta exceeds a threshold, we emit chordChange and
   * update the running harmonic rhythm (bars per chord change).
   */
  private detectChordChanges(features: MusicAnalyzerFeatures, now: number): void {
    // Build a "harmonic signature" from the available features.
    const flat = typeof features.spectralFlatness === 'number' ? features.spectralFlatness : null;
    const hnr = typeof features.hnr === 'number' ? features.hnr : null;
    const sub = typeof features.subEnergy === 'number' ? features.subEnergy : null;

    // Need at least 2 samples to compute a delta.
    if (flat === null && hnr === null && sub === null) return;

    const lastFlat = this.flatnessHistory.length >= 2
      ? this.flatnessHistory[this.flatnessHistory.length - 2]?.value
      : null;

    // Combined delta — each axis weighted to [0,1].
    let delta = 0;
    let weight = 0;
    if (flat !== null && lastFlat !== null) {
      delta += Math.abs(flat - lastFlat) * 1.5;
      weight += 1.5;
    }
    if (hnr !== null && this.lastHnr !== null) {
      delta += Math.abs(hnr - this.lastHnr) * 2.0;
      weight += 2.0;
    }
    if (sub !== null && this.lastSubEnergy !== null) {
      delta += Math.abs(sub - this.lastSubEnergy) * 1.0;
      weight += 1.0;
    }
    const normalizedDelta = weight > 0 ? delta / weight : 0;

    // Cache the latest values for next-update comparison.
    if (hnr !== null) this.lastHnr = hnr;
    if (sub !== null) this.lastSubEnergy = sub;

    // Threshold: combined normalized delta > 0.15 → likely chord change.
    // Cooldown prevents firing on every update if the harmonic content is
    // noisy.
    if (
      normalizedDelta > 0.15 &&
      now - this.lastChordTime > CHORD_COOLDOWN_SEC
    ) {
      this.lastChordTime = now;
      this.chordChanges++;
      if (this.firstChordTime === 0) this.firstChordTime = now;
      const elapsedBars = this.barCount; // bars since analyzer start
      if (this.chordChanges > 1 && elapsedBars > 0) {
        // Running average: bars per chord change.
        this.harmonicRhythm = clamp(elapsedBars / this.chordChanges, 0.5, 32);
      }
      this.emit('chordChange', now, clamp(normalizedDelta / 0.5, 0.3, 0.95), {
        delta: normalizedDelta,
        bar: Math.floor(this.barCount),
      });
    }
  }

  // ─── Key modulation detection (Step 1, "keyChange" event) ────────────────

  /**
   * Emit a keyChange event when the detected key's root or scale shifts
   * with confidence > 0.4. We only act on confident detections to avoid
   * firing on detector wobble.
   */
  private detectKeyChange(features: MusicAnalyzerFeatures, now: number): void {
    const k = features.detectedKey;
    if (!k || typeof k.root !== 'number' || !k.scale) return;
    if (typeof k.confidence !== 'number' || k.confidence < 0.4) return;

    if (this.lastKey === null) {
      this.lastKey = { root: k.root, scale: k.scale };
      return;
    }

    const rootChanged = this.lastKey.root !== k.root;
    const scaleChanged = this.lastKey.scale !== k.scale;
    if ((!rootChanged && !scaleChanged) || now - this.lastKeyTime < KEY_CHANGE_COOLDOWN_SEC) {
      return;
    }

    const fromName = `${this.noteName(this.lastKey.root)} ${this.lastKey.scale}`;
    const toName = `${this.noteName(k.root)} ${k.scale}`;
    this.lastKeyTime = now;
    this.recentKeyChanges.push({ time: now, from: fromName, to: toName });
    // Prune key changes older than 5 minutes.
    const cutoff = now - 300;
    this.recentKeyChanges = this.recentKeyChanges.filter((kc) => kc.time >= cutoff);
    this.lastKey = { root: k.root, scale: k.scale };
    this.emit('keyChange', now, k.confidence, { from: fromName, to: toName });
  }

  private noteName(root: number): string {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const idx = ((Math.round(root) % 12) + 12) % 12;
    return names[idx];
  }

  // ─── Utilities ───────────────────────────────────────────────────────────

  private now(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now() / 1000;
    }
    return Date.now() / 1000;
  }

  private pruneHistory(hist: { time: number; value: number }[], now: number): void {
    const cutoff = now - HISTORY_WINDOW_SEC;
    while (hist.length > 0 && hist[0].time < cutoff) hist.shift();
  }

  private pruneSpectralHistory(hist: { time: number; centroid: number; value: number }[], now: number): void {
    const cutoff = now - HISTORY_WINDOW_SEC;
    while (hist.length > 0 && hist[0].time < cutoff) hist.shift();
  }

  private pruneEvents(now: number): void {
    const cutoff = now - EVENT_RETENTION_SEC;
    while (this.events.length > 0 && this.events[0].time < cutoff) this.events.shift();
  }

  /**
   * Linear slope (value-units per second) over the most recent `windowSec`
   * of a value history. Returns 0 if there isn't enough data.
   */
  private slope(hist: { time: number; value: number }[], windowSec: number): number {
    if (hist.length < 2) return 0;
    const cutoff = this.now() - windowSec;
    let first: { time: number; value: number } | null = null;
    let last: { time: number; value: number } | null = null;
    for (const p of hist) {
      if (p.time < cutoff) continue;
      if (first === null) first = p;
      last = p;
    }
    if (!first || !last) return 0;
    const dt = last.time - first.time;
    if (dt <= 0) return 0;
    return (last.value - first.value) / dt;
  }

  private valuesInWindow(hist: { time: number; value: number }[], windowSec: number): number[] {
    const cutoff = this.now() - windowSec;
    const out: number[] = [];
    for (const p of hist) {
      if (p.time >= cutoff) out.push(p.value);
    }
    return out;
  }

  /**
   * Confidence rises with history depth. 0 samples → 0, 5+ samples → 0.8.
   */
  private historyConfidence(): number {
    const n = this.energyHistory.length;
    if (n === 0) return 0;
    if (n >= 8) return 0.85;
    return clamp(0.3 + (n - 1) * 0.08, 0.3, 0.85);
  }

  /**
   * Push an event onto the log. The log is bounded by EVENT_RETENTION_SEC
   * (pruned on the next update), so this never grows unboundedly.
   */
  private emit(
    type: MusicalEvent['type'],
    time: number,
    confidence: number,
    data?: any,
  ): void {
    this.events.push({ type, time, confidence: clamp(confidence, 0, 1), data });
  }
}
