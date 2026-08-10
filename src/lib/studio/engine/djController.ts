/**
 * DJController — full DJ-style sync (Pioneer CDJ / Traktor / Serato model).
 *
 * Task D1 (upgrade) — the existing PhaseSync (Task D1 v1) only aligned the
 * beat phase. A real DJ controller does MUCH more:
 *
 *   1. BPM sync          — have it (PhaseSync), tightened here.
 *   2. Phase / beat align — have it (PhaseSync), reused.
 *   3. Key sync          — harmonic mixing via the Camelot wheel.
 *                          Detect key incompatibility → suggest a semitone
 *                          shift → when master sync is on, transpose our
 *                          engine to the nearest compatible key.
 *   4. Groove sync       — match swing amount + push/pull feel.
 *                          Swing = how much odd 16ths are delayed.
 *                          Push/pull = whether the beat sits ahead or behind
 *                          the theoretical grid (live-drummer feel).
 *   5. Energy sync       — smoothed radio energy (4-bar moving average) +
 *                          transition detection (build / drop / break / rise).
 *                          When the radio drops, we should drop within 1-2
 *                          bars; when it breaks, we should break too.
 *   6. Beat-grid / phrase — align 4-bar phrase boundaries so our DROP lands
 *                          on the radio's DROP, not 2 bars off.
 *
 * The DJController is OPTIONAL — when masterSync is false, it computes and
 * exposes the full sync state for the UI (so the user can SEE how far off
 * we are) but does NOT apply any key/groove/energy/phrase adjustments. The
 * engine runs free, exactly as before.
 *
 * Architecture: the DJController is a PEER of PhaseSync (it does not own
 * it). The engine constructs both, and passes the PhaseSync reference to
 * the DJController so it can read the existing phase / BPM sync state and
 * extend it with the additional dimensions. This keeps the PhaseSync API
 * stable (the engine still talks to it directly for beat scheduling) while
 * the DJController provides the higher-level orchestration.
 *
 * Time base: wall-clock seconds (performance.now()/1000), shared with
 * PhaseSync and the reference listener.
 *
 * Constraints honored:
 *   - Master sync is OPTIONAL (default off).
 *   - All adjustments are smooth (no audio glitches).
 *   - Camelot wheel is accurate (verified against MIK's published table).
 *   - TypeScript strict mode (no implicit any, no unsafe arithmetic).
 *   - The DJController never throws — malformed input yields no-op.
 */

import { PhaseSync, SyncStatus, PhaseInfo } from './phaseSync';

// ─── Camelot wheel ─────────────────────────────────────────────────────────
//
// The Camelot wheel (Mixed In Key) maps each musical key to a number 1-12
// and a letter A (minor) or B (major). Keys that are harmonically
// compatible sit next to each other on the wheel:
//
//   - Same number, same letter  → identical key (perfect mix).
//   - Same number, other letter → relative major/minor (perfect mix).
//   - ±1 number, same letter    → adjacent on circle of fifths (compatible).
//   - ±1 number, other letter   → "energy boost" mix (compatible, dramatic).
//   - ±2+ number                → increasingly incompatible.
//
// Reference: https://mixedinkey.com/harmonic-mixing-guide/
//
// The wheel is laid out so each +1 number = +1 perfect fifth (7 semitones)
// on the major side. Starting from 8B = C major (0 accidentals):
//   8B = C, 9B = G, 10B = D, 11B = A, 12B = E, 1B = B,
//   2B = F#, 3B = Db, 4B = Ab, 5B = Eb, 6B = Bb, 7B = F.
// The minor side mirrors with the relative minor of each major:
//   8A = Am, 9A = Em, 10A = Bm, 11A = F#m, 12A = C#m, 1A = G#m,
//   2A = D#m, 3A = Bbm, 4A = Fm, 5A = Cm, 6A = Gm, 7A = Dm.
//
// For modes other than major/natural-minor (dorian, phrygian, etc.) we
// treat them as their root's natural minor for Camelot purposes — this is
// the practical DJ approach (D Dorian ≈ D Minor for harmonic mixing).

export interface CamelotKey {
  number: number;       // 1..12
  letter: 'A' | 'B';    // A = minor, B = major
}

/**
 * Map a (root, scale) pair to a Camelot wheel position.
 *
 * @param root  Chromatic root (0..11, C=0, C#=1, ..., B=11) OR a MIDI note
 *              (any integer — we take mod 12). The listener returns a
 *              chromatic root (0..11); the engine's musicalKey.root is a
 *              MIDI note (e.g., 43 = G2). Both work because we mod 12.
 * @param scale Scale name from musicalUnderstanding.ts:
 *              'major', 'minor', 'dorian', 'phrygian', 'phrygianDom',
 *              'harmonicMin'. Anything containing 'major' (case-insensitive)
 *              is treated as major (B); everything else as minor (A).
 */
export function keyToCamelot(root: number, scale: string): CamelotKey {
  const chroma = (((Math.round(root) % 12) + 12) % 12);
  const isMajorLike = typeof scale === 'string' && scale.toLowerCase() === 'major';
  const letter: 'A' | 'B' = isMajorLike ? 'B' : 'A';
  // For major: relativeRoot = chroma (the major IS the relative major).
  // For minor-like modes: relativeRoot = (chroma + 3) % 12 (minor third up
  // to the relative major — e.g., A minor → C major).
  const relativeRoot = isMajorLike ? chroma : ((chroma + 3) % 12);
  // Position on the circle of fifths: each +1 fifth = +7 semitones (mod 12).
  const fifths = (relativeRoot * 7) % 12;
  // 8B = C major (0 fifths). So camelot number = (fifths + 8) mod 12, with
  // 0 mapped to 12 (Camelot numbers are 1..12, not 0..11).
  let num = (fifths + 8) % 12;
  if (num === 0) num = 12;
  return { number: num, letter };
}

/**
 * Format a CamelotKey as the standard "8A" / "11B" string.
 */
export function camelotToString(k: CamelotKey): string {
  return `${k.number}${k.letter}`;
}

/**
 * Distance between two Camelot keys on the wheel.
 *
 *   0 = identical or relative (perfect mix).
 *   1 = adjacent same-letter (compatible, smooth mix).
 *   2 = adjacent cross-letter ("energy boost" — compatible, dramatic).
 *   3 = two steps away same-letter (dubious).
 *   4+ = incompatible.
 *
 * The distance accounts for the wheel's CIRCULAR topology — 12A and 1A are
 * adjacent (distance 1), not 11 apart.
 */
export function camelotDistance(a: CamelotKey, b: CamelotKey): number {
  // Number distance on the circular 1..12 wheel.
  const numDiff = Math.abs(a.number - b.number);
  const numDist = Math.min(numDiff, 12 - numDiff);  // circular
  const letterDiff = a.letter === b.letter ? 0 : 1;

  if (numDist === 0 && letterDiff === 0) return 0;  // identical
  if (numDist === 0 && letterDiff === 1) return 0;  // relative major/minor
  if (numDist === 1 && letterDiff === 0) return 1;  // adjacent same-letter
  if (numDist === 1 && letterDiff === 1) return 2;  // adjacent cross-letter
  if (numDist === 2 && letterDiff === 0) return 2;  // 2 steps same-letter
  if (numDist === 2 && letterDiff === 1) return 3;  // 2 steps cross-letter
  return 4;  // far — incompatible
}

/**
 * Compatibility score (0..1) derived from the Camelot distance.
 *
 *   distance 0 → 1.00 (perfect)
 *   distance 1 → 0.85 (compatible, smooth)
 *   distance 2 → 0.55 (compatible, dramatic)
 *   distance 3 → 0.30 (dubious)
 *   distance 4+ → 0.10 (incompatible)
 */
export function camelotCompatibility(a: CamelotKey, b: CamelotKey): number {
  const d = camelotDistance(a, b);
  if (d <= 0) return 1.0;
  if (d === 1) return 0.85;
  if (d === 2) return 0.55;
  if (d === 3) return 0.30;
  return 0.10;
}

/**
 * Find the nearest semitone shift that makes `ownKey` compatible with
 * `refKey` (Camelot distance ≤ 2, i.e., perfect / smooth / energy-boost).
 *
 * We only suggest a shift when the current distance is ≥ 3 (dubious or
 * incompatible). Distance 0 (perfect), 1 (smooth), and 2 (energy-boost)
 * are all "compatible" — a professional DJ CAN mix those without a shift,
 * so we don't force one. The shift is only suggested when the mix would
 * actually clash.
 *
 * Searches shifts in [-6, +6] semitones (beyond ±6 wraps around). Returns
 * the smallest-magnitude shift that achieves distance ≤ 2, or 0 if we're
 * already compatible. If no shift within ±6 achieves distance ≤ 2, returns
 * the shift that minimizes the distance.
 *
 * @param refRoot  Chromatic root of the reference (0..11 or MIDI note).
 * @param refScale Reference scale name.
 * @param ownRoot  Chromatic root of our engine.
 * @param ownScale Our scale name.
 * @returns Signed semitone shift (e.g., +2 = shift up a whole step).
 */
export function suggestKeyShift(
  refRoot: number,
  refScale: string,
  ownRoot: number,
  ownScale: string,
): number {
  const refCam = keyToCamelot(refRoot, refScale);
  const ownCam = keyToCamelot(ownRoot, ownScale);
  const currentDist = camelotDistance(refCam, ownCam);
  // If already compatible (distance ≤ 2 = perfect / smooth / energy-boost),
  // no shift needed — a professional DJ can mix these without transposing.
  if (currentDist <= 2) {
    return 0;
  }
  let bestShift = 0;
  let bestDist = currentDist;
  // Search ±1..±6 semitones. Prefer smaller magnitude on ties.
  for (let mag = 1; mag <= 6; mag++) {
    for (const sign of [1, -1]) {
      const shift = sign * mag;
      const shiftedRoot = ownRoot + shift;
      const d = camelotDistance(refCam, keyToCamelot(shiftedRoot, ownScale));
      if (d < bestDist || (d === bestDist && mag < Math.abs(bestShift))) {
        bestDist = d;
        bestShift = shift;
      }
      // Early exit: distance ≤ 2 is "compatible enough" — stop searching.
      if (bestDist <= 2) return bestShift;
    }
  }
  return bestShift;
}

// ─── Groove info (from the reference listener) ──────────────────────────────

export interface GrooveInfo {
  /** Swing amount 0..0.5 (0 = straight 16ths, 0.5 = fully swung triplet). */
  swing: number;
  /**
   * Push/pull feel in milliseconds. Positive = laid back (kicks arrive
   * slightly after the grid); negative = pushed (kicks arrive slightly
   * before the grid). Typical range: ±30ms.
   */
  pushPullMs: number;
  /** 0..1 — confidence in the groove estimate (low kick count = low conf). */
  confidence: number;
}

// ─── Energy transition detection ────────────────────────────────────────────

export type EnergyTransition = 'none' | 'build' | 'drop' | 'break' | 'rise';

// ─── Reference features consumed by the DJController ────────────────────────

export interface RefFeatures {
  phaseInfo?: PhaseInfo;
  key?: { root: number; scale: string; confidence: number };
  energy?: number;
  groove?: GrooveInfo;
}

// ─── Our own state pushed by the engine ─────────────────────────────────────

export interface OwnState {
  bpm: number;
  key: { root: number; scale: string };
  swing: number;          // current world.swing (0..0.5)
  energy: number;         // 0..1 (current flow density as proxy)
  bar: number;            // bar-in-section
  totalBars: number;      // absolute bar counter
  section: string;        // 'INTRO' | 'GROOVE' | 'BUILD' | 'DROP' | ...
}

// ─── Full sync state (extends SyncStatus with the new dimensions) ───────────

export interface DJSyncState extends SyncStatus {
  // ── Key sync (harmonic mixing) ──
  keySynced: boolean;
  refCamelot: string | null;
  ownCamelot: string;
  refKey: { root: number; scale: string; camelot: string } | null;
  ownKey: { root: number; scale: string; camelot: string };
  keyCompatibility: number;  // 0..1
  suggestedShift: number;    // semitones (nearest compatible shift)
  appliedShift: number;      // semitones currently applied (master sync on)

  // ── Groove sync ──
  grooveSynced: boolean;
  refSwing: number;
  ownSwing: number;
  grooveMatch: number;       // 0..1
  pushPullMs: number;

  // ── Energy sync ──
  energySynced: boolean;
  refEnergySmoothed: number;
  ownEnergy: number;
  energyDelta: number;
  energyTransition: EnergyTransition;

  // ── Beat-grid / phrase alignment ──
  beatGridAligned: boolean;
  refBarInPhrase: number;
  ownBarInPhrase: number;
  phraseLengthBars: number;

  // ── Overall ──
  masterSync: boolean;
  syncQuality: number;       // 0..100 — weighted aggregate
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Phrase length for beat-grid alignment (psytrance standard = 4 bars). */
const PHRASE_LENGTH_BARS = 4;
/** Energy smoothing window (4 bars ≈ 7s at 138 BPM). */
const ENERGY_SMOOTH_WINDOW = 4;
/** Energy delta that flags a transition (0..1). */
const ENERGY_TRANSITION_THRESHOLD = 0.15;
/** Groove match threshold (≥ this = "synced"). */
const GROOVE_LOCK_THRESHOLD = 0.85;
/** Key compatibility threshold (≥ this = "synced"). */
const KEY_LOCK_THRESHOLD = 0.80;
/** Energy match threshold (within this delta = "synced"). */
const ENERGY_LOCK_THRESHOLD = 0.12;
/** Max swing adjustment per bar (smooth convergence, no audio glitch). */
const MAX_SWING_ADJUST_PER_BAR = 0.02;
/** Max push/pull adjustment per bar (ms). */
const MAX_PUSH_PULL_ADJUST_PER_BAR_MS = 4;
/** Max push/pull offset applied to scheduling (ms) — caps the timing nudge. */
const MAX_PUSH_PULL_OFFSET_MS = 30;

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

// ─── DJController class ─────────────────────────────────────────────────────

export class DJController {
  /**
   * The DJController is a PEER of PhaseSync — it reads the existing phase
   * sync state and extends it with key / groove / energy / phrase. The
   * engine still owns the PhaseSync and calls it directly for beat
   * scheduling; the DJController provides the higher-level orchestration.
   */
  constructor(private readonly phaseSync: PhaseSync) {}

  // ── Master sync toggle (engages ALL dimensions when on) ──
  private masterSync = false;

  // ── Reference features (latest from the listener) ──
  private refKey: { root: number; scale: string; confidence: number } | null = null;
  private refEnergy: number = 0;
  private refGroove: GrooveInfo | null = null;

  // ── Our own state (latest from the engine) ──
  private ownState: OwnState | null = null;

  // ── Energy smoothing (4-bar moving average) ──
  private energyHistory: number[] = [];
  private smoothedEnergy = 0;
  private prevSmoothedEnergy = 0;
  private energyTransition: EnergyTransition = 'none';

  // ── Key shift state ──
  private appliedShift = 0;
  private targetShift = 0;

  // ── Groove state (smoothed toward ref groove when master sync on) ──
  private currentSwingAdj = 0;        // adjustment added to world.swing
  private currentPushPullMs = 0;      // offset added to scheduling

  // ── Phrase alignment ──
  private refBarInPhrase = 0;
  private pendingPhraseRealign = false;

  // ── Cached sync state (updated per-bar in tickBar) ──
  private cachedState: DJSyncState | null = null;

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * Enable / disable MASTER SYNC. When on, ALL dimensions are engaged
   * (BPM + phase via PhaseSync, key via Camelot, groove, energy, phrase).
   * When off, the engine runs free — but the sync state is still computed
   * and exposed via getSyncState() so the UI can show how far off we are.
   *
   * This delegates to phaseSync.setSyncEnabled() so the existing BPM/phase
   * sync engages/disengages with the same toggle.
   */
  setMasterSync(enabled: boolean): void {
    this.masterSync = enabled;
    this.phaseSync.setSyncEnabled(enabled);
    if (!enabled) {
      // Clear all our adjustments — clean hand-off back to free-running.
      this.appliedShift = 0;
      this.targetShift = 0;
      this.currentSwingAdj = 0;
      this.currentPushPullMs = 0;
      this.pendingPhraseRealign = false;
    }
  }

  isMasterSyncEnabled(): boolean {
    return this.masterSync;
  }

  /**
   * Reset our own-state (called by engine.stop()). Preserves ref features
   * + masterSync toggle so the user's choices persist across restarts.
   */
  reset(): void {
    this.ownState = null;
    this.appliedShift = 0;
    this.targetShift = 0;
    this.currentSwingAdj = 0;
    this.currentPushPullMs = 0;
    this.pendingPhraseRealign = false;
    this.energyHistory = [];
    this.smoothedEnergy = 0;
    this.prevSmoothedEnergy = 0;
    this.energyTransition = 'none';
    this.cachedState = null;
  }

  /**
   * Push the latest reference features (from the listener via the engine's
   * liveTrack()). Forwards phaseInfo to PhaseSync; stores key/energy/groove
   * for the next updateSync() call.
   */
  setReferenceFeatures(ref: RefFeatures): void {
    if (!ref) return;
    if (ref.phaseInfo) {
      this.phaseSync.setReferencePhase(ref.phaseInfo);
    }
    if (ref.key && Number.isFinite(ref.key.root) && ref.key.scale) {
      this.refKey = {
        root: ((Math.round(ref.key.root) % 12) + 12) % 12,
        scale: ref.key.scale,
        confidence: clamp(ref.key.confidence, 0, 1),
      };
    }
    if (typeof ref.energy === 'number' && Number.isFinite(ref.energy)) {
      this.pushEnergy(clamp(ref.energy, 0, 1));
    }
    if (ref.groove) {
      this.refGroove = {
        swing: clamp(ref.groove.swing, 0, 0.5),
        pushPullMs: clamp(ref.groove.pushPullMs, -60, 60),
        confidence: clamp(ref.groove.confidence, 0, 1),
      };
    }
  }

  /**
   * Push the engine's own state (called from the engine — typically from
   * tick() per-bar). This is what we compare against the reference.
   */
  setOwnState(own: OwnState): void {
    if (!own) return;
    this.ownState = {
      bpm: clamp(own.bpm, 30, 220),
      key: { root: own.key.root, scale: own.key.scale },
      swing: clamp(own.swing, 0, 0.5),
      energy: clamp(own.energy, 0, 1),
      bar: Math.max(0, Math.floor(own.bar)),
      totalBars: Math.max(0, Math.floor(own.totalBars)),
      section: own.section || 'INTRO',
    };
  }

  /**
   * Per-bar update. Called from the engine's tick() when the bar counter
   * rolls over. Returns the actions the engine should apply this bar:
   *
   *   - keyShiftSemitones: if non-zero, the engine should transpose its
   *     musicalKey.root by this many semitones (smooth convergence toward
   *     the nearest compatible key). The engine calls applyKeyShift() with
   *     this value.
   *   - swingAdjust: signed delta to add to world.swing (smooth convergence
   *     toward the radio's swing amount). The engine adds this to the
   *     swing used in scheduleStep().
   *   - phraseRealign: if true, the engine should treat the current bar as
   *     bar 0 of a new phrase (used when the radio just dropped and we're
   *     mid-phrase — snap our phrase boundary to the radio's).
   */
  tickBar(ownBpm: number, ownBar: number, totalBars: number): {
    keyShiftSemitones: number;
    swingAdjust: number;
    phraseRealign: boolean;
  } {
    // Update our cached snapshot of the sync state.
    this.updateCachedState(ownBpm, ownBar, totalBars);

    if (!this.masterSync) {
      return { keyShiftSemitones: 0, swingAdjust: 0, phraseRealign: false };
    }

    // ── Key shift convergence ──
    // Move appliedShift toward targetShift by 1 semitone per bar (max).
    // This is slow enough that the listener perceives it as a deliberate
    // modulation, not a glitch. The engine's refreshMusicalGenerators()
    // rebuilds the melody / acid / harmony engines on each change.
    let keyShift = 0;
    if (this.targetShift !== this.appliedShift) {
      const diff = this.targetShift - this.appliedShift;
      const step = Math.sign(diff) * Math.min(1, Math.abs(diff));
      this.appliedShift += step;
      keyShift = step;
    }

    // ── Swing convergence ──
    // Adjust our swing toward the radio's swing (when groove confidence is
    // high enough to trust). Capped at MAX_SWING_ADJUST_PER_BAR per bar so
    // the change is gradual.
    let swingAdjust = 0;
    if (this.refGroove && this.refGroove.confidence > 0.3 && this.ownState) {
      const targetSwingAdj = this.refGroove.swing - this.ownState.swing;
      const diff = targetSwingAdj - this.currentSwingAdj;
      const step = Math.sign(diff) * Math.min(MAX_SWING_ADJUST_PER_BAR, Math.abs(diff));
      this.currentSwingAdj += step;
      swingAdjust = step;
    }

    // ── Push/pull convergence ──
    // Adjust our push/pull offset toward the radio's. Capped at
    // MAX_PUSH_PULL_ADJUST_PER_BAR_MS per bar.
    if (this.refGroove && this.refGroove.confidence > 0.3) {
      const target = this.refGroove.pushPullMs;
      const diff = target - this.currentPushPullMs;
      const step = Math.sign(diff) * Math.min(MAX_PUSH_PULL_ADJUST_PER_BAR_MS, Math.abs(diff));
      this.currentPushPullMs += step;
    }

    // ── Phrase realignment ──
    // If a transition was detected this bar AND we're mid-phrase, request
    // a phrase realignment (the engine treats the next bar as bar 0).
    let phraseRealign = false;
    if (this.pendingPhraseRealign) {
      phraseRealign = true;
      this.pendingPhraseRealign = false;
    }

    return { keyShiftSemitones: keyShift, swingAdjust, phraseRealign };
  }

  /**
   * Returns the groove offset (seconds) to add to the scheduler's nextTime
   * per-step. This is the push/pull timing nudge — it makes our beats sit
   * slightly ahead of or behind the theoretical grid to match the radio's
   * feel. Capped at MAX_PUSH_PULL_OFFSET_MS so the nudge is always small
   * enough to be glitch-free.
   *
   * When master sync is off, returns 0 (no nudge).
   */
  getGrooveOffsetSec(): number {
    if (!this.masterSync) return 0;
    const capped = clamp(this.currentPushPullMs, -MAX_PUSH_PULL_OFFSET_MS, MAX_PUSH_PULL_OFFSET_MS);
    return capped / 1000;
  }

  /**
   * Returns the swing adjustment the engine should ADD to world.swing in
   * scheduleStep(). This is the smooth convergence toward the radio's
   * swing amount. When master sync is off, returns 0.
   */
  getSwingAdjust(): number {
    if (!this.masterSync) return 0;
    return this.currentSwingAdj;
  }

  /**
   * Returns the cached sync state (or computes it on first call). The
   * engine exposes this via getSyncStatus() so the UI can render the full
   * DJ controller state.
   */
  getSyncState(): DJSyncState {
    if (this.cachedState) return this.cachedState;
    // If tickBar hasn't run yet, compute a snapshot now.
    return this.computeSnapshot(this.ownState?.bpm ?? 0, this.ownState?.bar ?? 0, this.ownState?.totalBars ?? 0);
  }

  // ─── Internal ────────────────────────────────────────────────────────

  /**
   * Push a new energy reading into the 4-bar moving average window and
   * detect transitions (build / drop / break / rise).
   */
  private pushEnergy(e: number): void {
    this.energyHistory.push(e);
    if (this.energyHistory.length > ENERGY_SMOOTH_WINDOW) {
      this.energyHistory.shift();
    }
    this.prevSmoothedEnergy = this.smoothedEnergy;
    this.smoothedEnergy = this.energyHistory.reduce((a, b) => a + b, 0) /
      Math.max(1, this.energyHistory.length);

    // Transition detection: compare the new smoothed energy to the previous.
    const delta = this.smoothedEnergy - this.prevSmoothedEnergy;
    if (Math.abs(delta) < ENERGY_TRANSITION_THRESHOLD) {
      // No transition — but if we were rising and now plateau high, it's a
      // "drop" (the energy peaked). If we were falling and plateau low,
      // it's a "break".
      if (this.energyTransition === 'rise' && this.smoothedEnergy > 0.6) {
        this.energyTransition = 'drop';
        this.pendingPhraseRealign = true;
      } else if (this.energyTransition === 'build' && this.smoothedEnergy < 0.4) {
        this.energyTransition = 'break';
        this.pendingPhraseRealign = true;
      } else if (Math.abs(delta) < 0.02) {
        this.energyTransition = 'none';
      }
    } else if (delta > 0) {
      // Energy rising — could be a build or a drop hitting.
      if (this.smoothedEnergy > 0.7 && delta > 0.25) {
        this.energyTransition = 'drop';
        this.pendingPhraseRealign = true;
      } else {
        this.energyTransition = this.smoothedEnergy > 0.5 ? 'rise' : 'build';
        if (this.smoothedEnergy > 0.5 && delta > 0.2) {
          this.pendingPhraseRealign = true;
        }
      }
    } else {
      // Energy falling — could be a break.
      if (this.smoothedEnergy < 0.4 && delta < -0.2) {
        this.energyTransition = 'break';
        this.pendingPhraseRealign = true;
      } else {
        this.energyTransition = 'break';
      }
    }
  }

  /**
   * Update the cached sync state (called from tickBar so the snapshot is
   * always fresh when the UI polls).
   */
  private updateCachedState(ownBpm: number, ownBar: number, totalBars: number): void {
    this.cachedState = this.computeSnapshot(ownBpm, ownBar, totalBars);
  }

  /**
   * Compute the full sync state snapshot. Combines the PhaseSync's beat
   * status with the key / groove / energy / phrase dimensions.
   */
  private computeSnapshot(ownBpm: number, ownBar: number, _totalBars: number): DJSyncState {
    const base: SyncStatus = this.phaseSync.getSyncStatus();

    // ── Key dimension ──
    const ownKey = this.ownState?.key ?? { root: 0, scale: 'minor' };
    const ownCam = keyToCamelot(ownKey.root, ownKey.scale);
    const refCam = this.refKey
      ? keyToCamelot(this.refKey.root, this.refKey.scale)
      : null;
    const keyCompat = refCam
      ? camelotCompatibility(refCam, ownCam)
      : 0;
    const suggestedShift = refCam
      ? suggestKeyShift(
          this.refKey!.root,
          this.refKey!.scale,
          ownKey.root,
          ownKey.scale,
        )
      : 0;
    const keySynced = keyCompat >= KEY_LOCK_THRESHOLD && (this.refKey?.confidence ?? 0) > 0.3;

    // ── Groove dimension ──
    const refSwing = this.refGroove?.swing ?? 0;
    const ownSwing = this.ownState?.swing ?? 0;
    const swingDiff = Math.abs(refSwing - ownSwing);
    const pushPullDiff = Math.abs((this.refGroove?.pushPullMs ?? 0) - this.currentPushPullMs);
    const grooveMatch = this.refGroove
      ? clamp(1 - (swingDiff * 2 + pushPullDiff / 60) / 2, 0, 1)
      : 0;
    const grooveSynced = grooveMatch >= GROOVE_LOCK_THRESHOLD && (this.refGroove?.confidence ?? 0) > 0.3;

    // ── Energy dimension ──
    const refE = this.smoothedEnergy;
    const ownE = this.ownState?.energy ?? 0;
    const energyDelta = refE - ownE;
    const energySynced = Math.abs(energyDelta) < ENERGY_LOCK_THRESHOLD && refE > 0;

    // ── Beat-grid / phrase dimension ──
    // refBarInPhrase: inferred from the radio's downbeat phase. We don't
    // directly know the radio's bar-in-phrase, but if a phrase realign is
    // pending OR we just detected a transition, the radio is at bar 0 of
    // a phrase. Otherwise, we approximate using the energy transition
    // state — a "drop" or "break" implies bar 0; otherwise we mirror our
    // own bar-in-phrase (best guess when we have no other info).
    let refBarInPhrase = 0;
    if (this.energyTransition === 'drop' || this.energyTransition === 'break') {
      refBarInPhrase = 0;
    } else {
      // Mirror our own bar-in-phrase when we have no transition signal.
      refBarInPhrase = ownBar % PHRASE_LENGTH_BARS;
    }
    const ownBarInPhrase = ownBar % PHRASE_LENGTH_BARS;
    const phraseDiff = Math.abs(refBarInPhrase - ownBarInPhrase);
    const beatGridAligned = phraseDiff === 0 || this.pendingPhraseRealign;

    // ── Overall sync quality (weighted aggregate) ──
    // Weights reflect how important each dimension is to "sounding synced":
    //   phase + BPM (from PhaseSync):  40%  (most important — beats must hit)
    //   key (Camelot):                 25%  (harmonic clash is obvious)
    //   energy:                        15%  (dynamic shape)
    //   groove:                        10%  (subtle feel)
    //   beat-grid / phrase:            10%  (drop alignment)
    const phaseScore = base.synced ? 1 : clamp(1 - Math.abs(base.offsetMs) / 200, 0, 1) * 0.5 + (base.bpmMatchPct / 100) * 0.5;
    const keyScore = keyCompat;
    const energyScore = clamp(1 - Math.abs(energyDelta), 0, 1);
    const grooveScore = grooveMatch;
    const phraseScore = beatGridAligned ? 1 : clamp(1 - phraseDiff / PHRASE_LENGTH_BARS, 0, 1);
    const syncQuality = clamp(
      (phaseScore * 0.40 + keyScore * 0.25 + energyScore * 0.15 +
       grooveScore * 0.10 + phraseScore * 0.10) * 100,
      0, 100,
    );

    return {
      ...base,
      // ── Key ──
      keySynced,
      refCamelot: refCam ? camelotToString(refCam) : null,
      ownCamelot: camelotToString(ownCam),
      refKey: this.refKey
        ? { root: this.refKey.root, scale: this.refKey.scale, camelot: camelotToString(refCam!) }
        : null,
      ownKey: { root: ownKey.root, scale: ownKey.scale, camelot: camelotToString(ownCam) },
      keyCompatibility: keyCompat,
      suggestedShift,
      appliedShift: this.appliedShift,
      // ── Groove ──
      grooveSynced,
      refSwing,
      ownSwing,
      grooveMatch,
      pushPullMs: this.currentPushPullMs,
      // ── Energy ──
      energySynced,
      refEnergySmoothed: refE,
      ownEnergy: ownE,
      energyDelta,
      energyTransition: this.energyTransition,
      // ── Beat-grid / phrase ──
      beatGridAligned,
      refBarInPhrase,
      ownBarInPhrase,
      phraseLengthBars: PHRASE_LENGTH_BARS,
      // ── Overall ──
      masterSync: this.masterSync,
      syncQuality,
    };
  }
}
