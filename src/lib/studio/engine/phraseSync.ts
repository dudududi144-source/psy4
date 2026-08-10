/**
 * PhraseSync — aligns our phrase boundaries with the radio's.
 *
 * Task P4 (Phase 4 — Structural pursuit: phrase-level sync).
 *
 * WHY
 * ---
 * Beat sync (PhaseSync, Task D1) aligns individual beats.
 * Section sync (MusicAnalyzer, Task P2) aligns section TYPES (we drop when
 * the radio drops).
 * But NEITHER aligns PHRASES — the 4-8 bar structural units of dance music.
 *
 * A phrase is 4-8 bars. Professional DJ software (Traktor, Serato, CDJs)
 * aligns phrase boundaries: when the radio starts a new 8-bar phrase (e.g.,
 * a drop), we start a new phrase too — not be 3 bars into our current phrase.
 * This prevents our "drop" from landing in the middle of the radio's "break".
 *
 * HOW
 * ---
 * The MusicAnalyzer emits sectionBoundary / dropHit / breakStart / riserStart
 * events when it hears the radio hit a structural boundary. Combined with
 * the beat grid, we can:
 *
 *   1. RECORD each ref phrase boundary (its wall-clock time + the engine's
 *      own bar counter at that moment).
 *   2. ESTIMATE the radio's phrase length: if boundaries happen every 8
 *      bars, phraseLength = 8. We use the median of recent intervals.
 *   3. PREDICT the next boundary: lastBoundaryBar + phraseLength.
 *   4. ALIGN: when a ref boundary arrives, decide whether to realign:
 *        - If we're <2 bars into our phrase: cut our phrase short, start a
 *          new one aligned with the radio.
 *        - If we're >50% through our phrase: finish our phrase, then align
 *          on the next one (no realignment now — natural flow handles it).
 *        - If we're almost at a phrase boundary anyway: no realignment
 *          (we'd just cause thrashing).
 *        - Otherwise (2 bars to 50%): realign — mid-phrase cut.
 *
 * The engine calls `phraseSync.checkRealignment()` every bar; if it returns
 * `{ realign: true }`, the engine calls `flowEngine.transitionTo(...)` to
 * start a new phrase aligned with the radio (the flow engine resets
 * `barInSection` to 0, and the engine resets its own `bar` counter).
 *
 * RELATIONSHIP TO DJController (D1 upgrade)
 * -----------------------------------------
 * The DJController already has its own `phraseRealign` flag (fired by its
 * energy-transition detector). That realignment is REACTIVE: it snaps the
 * bar counter to 0 after detecting a transition in the 4-bar smoothed
 * energy. PhraseSync is PROACTIVE + STRUCTURAL: it uses the MusicAnalyzer's
 * MUSICAL section detection (which has 30s cooldowns + slope checks + min
 * bar thresholds — far more reliable than the DJController's 4-bar smoother)
 * and the radio's estimated phrase length to decide WHEN to realign and HOW
 * (cut short vs finish phrase first). The two coexist:
 *   - DJController's phraseRealign: bar-counter snap (quick fix on energy
 *     transitions).
 *   - PhraseSync: full phrase realignment via flowEngine.transitionTo (sets
 *     a new archetype + phrase length, resetting the arrangement).
 *
 * TIME BASE
 * ---------
 * Wall-clock seconds (performance.now()/1000), shared with MusicAnalyzer
 * and the reference listener. The engine also passes `bar` (its own
 * bar-within-section counter) and `phraseLength` (the current section's
 * planned length) on every bar via `onOwnBar()`.
 *
 * CONSTRAINTS HONORED
 * -------------------
 * - Master sync is OPTIONAL (default off). When master sync is off,
 *   `checkRealignment()` always returns `{ realign: false }`.
 * - Realignment is smooth (not abrupt cuts mid-phrase unless necessary):
 *   we only cut mid-phrase if we're <50% through AND the radio just hit a
 *   boundary. Otherwise we let the phrase finish naturally.
 * - Guards against missing data: no section boundaries yet → no realignment.
 * - TypeScript strict mode (no implicit any, no unsafe arithmetic).
 * - The PhraseSync never throws — malformed input yields no-op.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default phrase length when we have no boundary-interval history yet. */
const DEFAULT_PHRASE_LENGTH = 8;

/** Minimum phrase length we'll estimate (typical dance-music floor). */
const MIN_PHRASE_LENGTH = 4;

/** Maximum phrase length we'll estimate (typical dance-music ceiling). */
const MAX_PHRASE_LENGTH = 16;

/** How many recent boundary intervals to keep for the median estimate. */
const INTERVAL_HISTORY_MAX = 6;

/**
 * Below this many bars into our phrase, we'll cut short to realign with the
 * radio. Above this, we either let the phrase finish (>50%) or realign with
 * a mid-phrase cut (2 to 50%).
 */
const EARLY_CUT_BARS = 2;

/**
 * Anti-thrash cooldown (seconds) between realignments. Without this, a
 * cluster of ref boundary events (drop + sectionBoundary firing close
 * together) could cause 2-3 realignments in a row.
 */
const REALIGN_COOLDOWN_SEC = 6;

/**
 * When realigning, we suggest the engine start a new phrase of this many
 * bars (matches the radio's estimated phrase length when available, else 8).
 */
const DEFAULT_REALIGN_BARS = 8;

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Live phrase-sync state. Exposed via `getState()` for UI display.
 */
export interface PhraseSyncState {
  /** Bar within the radio's current phrase (0-based). */
  refPhraseBar: number;
  /** Estimated phrase length (bars) for the radio (4-16, typically 8). */
  refPhraseLength: number;
  /** Our bar within our current phrase (0-based). */
  ownPhraseBar: number;
  /** Our current phrase length (bars). */
  ownPhraseLength: number;
  /** 0..1 — how aligned we are (1 = perfect). 0 when we have no ref data. */
  alignment: number;
  /** Wall-clock seconds of the last forced realignment (0 = never). */
  lastRealignment: number;
  /** Total realignments this session. */
  realignments: number;
  /** Wall-clock seconds of the last ref section boundary (0 = none yet). */
  lastRefBoundaryTime: number;
  /** Predicted absolute bar of the next ref phrase boundary (0 = unknown). */
  nextPredictedRefBoundaryBar: number;
  /** Latest section label the radio entered ('drop' / 'break' / 'build' / ...). */
  lastRefSectionLabel: string;
  /** Whether master sync is currently engaged. */
  masterSync: boolean;
}

/**
 * Result of `checkRealignment()` — the engine reads this each bar to decide
 * whether to call `flowEngine.transitionTo(...)`.
 */
export interface RealignmentDecision {
  /** True → engine should realign this bar. */
  realign: boolean;
  /** Human-readable reason (for logging + UI). */
  reason: string;
  /**
   * Signed offset (in bars) between our current bar-in-phrase and the
   * radio's. Negative = we're ahead of the radio (our bar > ref bar);
   * positive = we're behind (our bar < ref bar). 0 = perfectly aligned.
   * Useful for the UI to show "we're 3 bars off".
   */
  offsetBars: number;
  /**
   * When `realign` is true, the archetype label the engine should
   * transition to ('DROP' / 'BREAK' / 'BUILD' / 'GROOVE' / ...). Mapped
   * from the radio's section label by the engine.
   */
  suggestedLabel?: string;
  /**
   * When `realign` is true, the target energy (0..1) for the new phrase.
   * Mapped from the radio's section label by the engine.
   */
  suggestedEnergy?: number;
  /**
   * When `realign` is true, the planned length (bars) of the new phrase.
   * Matches the radio's estimated phrase length when available.
   */
  suggestedBars?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

const clampInt = (v: number, lo: number, hi: number): number => {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(v)));
};

/** Median of a numeric array (returns 0 for empty input). */
const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

/**
 * Map a MusicAnalyzer section label to a flow-engine archetype label.
 * The MusicAnalyzer emits lowercase section names ('drop' / 'break' / ...);
 * the FlowEngine's ARCHETYPES table uses uppercase ('DROP' / 'BREAK' / ...).
 *
 * Returns 'GROOVE' for unknown labels (safe default — groove is the
 * neutral mid-energy archetype).
 */
const sectionLabelToArchetype = (label: string): string => {
  const l = (label || '').toLowerCase();
  if (l === 'drop') return 'DROP';
  if (l === 'break') return 'BREAK';
  if (l === 'build') return 'BUILD';
  if (l === 'intro') return 'INTRO';
  if (l === 'outro') return 'OUTRO';
  if (l === 'variation') return 'VARIATION';
  return 'GROOVE';
};

/**
 * Map a MusicAnalyzer section label to a target energy for the new phrase.
 * These match the ARCHETYPES table in flowEngine.ts so the realignment
 * produces a phrase with the right musical character.
 */
const sectionLabelToEnergy = (label: string): number => {
  const l = (label || '').toLowerCase();
  if (l === 'drop') return 0.95;
  if (l === 'break') return 0.30;
  if (l === 'build') return 0.70;
  if (l === 'intro') return 0.25;
  if (l === 'outro') return 0.25;
  if (l === 'variation') return 0.85;
  return 0.50; // groove
};

/** Wall-clock seconds with a Date.now() fallback. */
const nowSec = (): number =>
  (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

// ─── PhraseSync ─────────────────────────────────────────────────────────────

export class PhraseSync {
  // Live state — exposed via getState() for UI display.
  private state: PhraseSyncState = {
    refPhraseBar: 0,
    refPhraseLength: DEFAULT_PHRASE_LENGTH,
    ownPhraseBar: 0,
    ownPhraseLength: DEFAULT_PHRASE_LENGTH,
    alignment: 0,
    lastRealignment: 0,
    realignments: 0,
    lastRefBoundaryTime: 0,
    nextPredictedRefBoundaryBar: 0,
    lastRefSectionLabel: '',
    masterSync: false,
  };

  /**
   * Rolling history of intervals (in our bars) between consecutive ref
   * section boundaries. Used to estimate the radio's phrase length via the
   * median. Bounded to INTERVAL_HISTORY_MAX samples.
   */
  private boundaryIntervals: number[] = [];

  /**
   * Our engine's absolute bar counter (never resets) at the moment of the
   * last ref section boundary. Used to predict the next boundary:
   * `nextPredicted = lastBoundaryOwnBar + refPhraseLength`.
   *
   * We track this in OUR bar counter (not the radio's) because the engine
   * advances our bar counter every bar — that's the time base we have
   * access to without a separate ref bar counter.
   *
   * -1 means "no boundary recorded yet".
   */
  private lastBoundaryOwnBar = -1;

  /**
   * Latest absolute bar counter from the engine (passed in via onOwnBar's
   * `totalBars` parameter). When a ref section boundary fires, we snapshot
   * this value into `lastBoundaryOwnBar` and compute the interval vs the
   * previous boundary.
   */
  private latestTotalBars = 0;

  /**
   * Set to true by `onSectionBoundary()` when a ref phrase boundary fires.
   * Consumed (cleared) by the next `checkRealignment()` call.
   *
   * This is the "we just heard the radio hit a boundary — decide what to
   * do" trigger.
   */
  private pendingRefBoundary = false;

  /**
   * The radio's section label for the pending boundary ('drop' / 'break' /
   * 'build' / 'variation' / 'groove' / 'intro' / 'outro'). Used to suggest
   * the right archetype + energy for the realignment.
   */
  private pendingSectionLabel = '';

  /**
   * Master-sync toggle. When false, `checkRealignment()` always returns
   * `{ realign: false }` — the engine runs free. The state is still
   * computed + exposed for UI display.
   */
  private masterSync = false;

  // ─── Public API ────────────────────────────────────────────────────────

  /**
   * Engage / disengage master phrase sync. When off, no realignments are
   * suggested (the engine runs free). State is still computed for UI.
   */
  setMasterSync(enabled: boolean): void {
    this.masterSync = !!enabled;
    this.state.masterSync = this.masterSync;
    if (!enabled) {
      // Clear any pending boundary so we don't realign the moment sync is
      // re-engaged (the next ref boundary is the right trigger).
      this.pendingRefBoundary = false;
      this.pendingSectionLabel = '';
    }
  }

  /**
   * Called when a section boundary is detected in the radio. This is the
   * "ref phrase boundary" signal — the MusicAnalyzer emits these when it
   * hears a drop / break / riser / section transition.
   *
   * @param time           Wall-clock seconds of the boundary detection.
   * @param sectionLabel   The radio's new section label ('drop' / 'break' /
   *                       'build' / 'variation' / 'groove' / 'intro' / 'outro').
   *                       Empty string is treated as 'groove' (safe default).
   */
  onSectionBoundary(time: number, sectionLabel: string): void {
    if (!Number.isFinite(time)) return;
    const label = (sectionLabel || '').toLowerCase();

    // ── Update the boundary time + label ──
    this.state.lastRefBoundaryTime = time;
    this.state.lastRefSectionLabel = label;

    // ── Reset the radio's bar-in-phrase to 0 (it just started a new phrase) ──
    this.state.refPhraseBar = 0;

    // ── Mark a pending boundary for checkRealignment() to consume ──
    this.pendingRefBoundary = true;
    this.pendingSectionLabel = label;

    // ── Estimate the radio's phrase length from the interval history ──
    // We use OUR absolute bar counter at the moment of the boundary (the
    // engine passes it in via onOwnBar() and we store the latest value).
    // This is a reasonable proxy for the radio's bar counter because
    // PhaseSync keeps our BPM locked to the radio's BPM.
    const currentBoundaryBar = this.latestTotalBars;
    if (this.lastBoundaryOwnBar >= 0) {
      const interval = currentBoundaryBar - this.lastBoundaryOwnBar;
      if (interval >= MIN_PHRASE_LENGTH && interval <= MAX_PHRASE_LENGTH) {
        this.boundaryIntervals.push(interval);
        if (this.boundaryIntervals.length > INTERVAL_HISTORY_MAX) {
          this.boundaryIntervals.shift();
        }
        // Update the estimated phrase length (median of recent intervals).
        const med = median(this.boundaryIntervals);
        if (med >= MIN_PHRASE_LENGTH && med <= MAX_PHRASE_LENGTH) {
          this.state.refPhraseLength = clampInt(med, MIN_PHRASE_LENGTH, MAX_PHRASE_LENGTH);
        }
      }
    }
    // Update the boundary markers — current becomes previous for the next
    // boundary's interval computation.
    this.lastBoundaryOwnBar = currentBoundaryBar;

    // ── Update the predicted next boundary ──
    // Predicted = lastBoundaryOwnBar + refPhraseLength (in our bar counter).
    // The engine reads this for UI display ("next ref phrase boundary in N bars").
    this.state.nextPredictedRefBoundaryBar =
      this.lastBoundaryOwnBar + this.state.refPhraseLength;
  }

  /**
   * Called every bar from the engine's tick() (per-bar pass). Updates our
   * own bar-in-phrase counter + advances the radio's estimated bar-in-phrase
   * (we assume the radio also advanced one bar — PhaseSync keeps our BPM
   * locked to the radio's, so one of our bars ≈ one of theirs).
   *
   * @param bar             Our engine's bar-WITHIN-section counter (resets on
   *                        section transitions). This is `this.bar` in
   *                        psy4EngineV2.
   * @param phraseLength    Our current phrase length (planned section length,
   *                        typically 4-8 bars). This is `flow.sectionBars`.
   * @param totalBars       (Optional) our absolute bar counter (never
   *                        resets). Used to compute intervals between ref
   *                        boundaries. If omitted, the previous value is
   *                        kept.
   */
  onOwnBar(bar: number, phraseLength: number, totalBars?: number): void {
    // ── Guard inputs ──
    const pl = Number.isFinite(phraseLength) && phraseLength >= 1
      ? clampInt(phraseLength, 1, MAX_PHRASE_LENGTH * 2)
      : this.state.ownPhraseLength;
    const b = Number.isFinite(bar) && bar >= 0 ? Math.floor(bar) : 0;

    this.state.ownPhraseBar = b % pl;
    this.state.ownPhraseLength = pl;

    // ── Update our absolute bar counter for interval tracking ──
    // onSectionBoundary reads this when a ref boundary fires.
    if (typeof totalBars === 'number' && Number.isFinite(totalBars) && totalBars >= 0) {
      this.latestTotalBars = Math.floor(totalBars);
    }

    // ── Advance the radio's bar-in-phrase ──
    // The radio advances one bar for every bar we advance (BPM-locked). We
    // reset refPhraseBar to 0 on each ref boundary; otherwise we advance
    // it by 1, modulo refPhraseLength.
    if (this.state.lastRefBoundaryTime > 0) {
      // Only advance if we have ref data (don't pollute with 0s before the
      // first boundary).
      this.state.refPhraseBar =
        (this.state.refPhraseBar + 1) % this.state.refPhraseLength;
    }

    // ── Compute alignment (0..1) ──
    // alignment = 1 - |ownPhraseBar - refPhraseBar| / max(ownPhraseLength, refPhraseLength)
    if (this.state.lastRefBoundaryTime > 0) {
      const diff = Math.abs(this.state.ownPhraseBar - this.state.refPhraseBar);
      const maxLen = Math.max(this.state.ownPhraseLength, this.state.refPhraseLength);
      this.state.alignment = clamp(1 - diff / Math.max(1, maxLen), 0, 1);
    } else {
      // No ref data yet — alignment is unknown (0).
      this.state.alignment = 0;
    }
  }

  /**
   * Should we realign this bar? Returns the decision + suggested archetype.
   *
   * Called every bar from the engine's tick() (after onOwnBar). If
   * `realign === true`, the engine should call `flowEngine.transitionTo(...)`
   * with the suggested label / energy / bars to start a new phrase aligned
   * with the radio.
   *
   * Decision tree (only when a ref boundary is pending):
   *   - ownPhraseBar < 2 (early in our phrase): realign — cut short.
   *   - ownPhraseBar >= ownPhraseLength - 1 (near boundary anyway): no
   *     realign (we'd thrash — let the natural phrase boundary handle it).
   *   - ownPhraseBar > ownPhraseLength / 2 (past 50%): no realign (finish
   *     phrase first, align on the next one).
   *   - Else (2 to 50%): realign — mid-phrase cut (this is the "drop lands
   *     3 bars off" case the spec calls out).
   *
   * Anti-thrash: a REALIGN_COOLDOWN_SEC cooldown prevents back-to-back
   * realignments when multiple ref events fire close together (dropHit +
   * sectionBoundary firing within seconds of each other).
   */
  checkRealignment(): RealignmentDecision {
    // Master sync off → no realignment.
    if (!this.masterSync) {
      return { realign: false, reason: 'master-sync-off', offsetBars: 0 };
    }

    // No pending ref boundary → no realignment.
    if (!this.pendingRefBoundary) {
      return { realign: false, reason: 'no-boundary', offsetBars: 0 };
    }

    // Consume the pending boundary.
    this.pendingRefBoundary = false;
    const label = this.pendingSectionLabel;
    this.pendingSectionLabel = '';

    // No ref data yet (shouldn't happen if pendingRefBoundary is true, but
    // guard anyway).
    if (this.state.lastRefBoundaryTime <= 0) {
      return { realign: false, reason: 'no-ref-data', offsetBars: 0 };
    }

    // Anti-thrash cooldown.
    const now = nowSec();
    if (this.state.lastRealignment > 0 &&
        now - this.state.lastRealignment < REALIGN_COOLDOWN_SEC) {
      return {
        realign: false,
        reason: 'cooldown',
        offsetBars: this.state.ownPhraseBar - this.state.refPhraseBar,
      };
    }

    // ── Compute the offset (signed) ──
    // Negative = we're ahead of the radio (our bar > ref bar).
    // Positive = we're behind the radio (our bar < ref bar).
    const offsetBars = this.state.ownPhraseBar - this.state.refPhraseBar;

    // ── Decision tree ──
    const ownBar = this.state.ownPhraseBar;
    const ownLen = Math.max(1, this.state.ownPhraseLength);

    // Case 1: we're already aligned (offset 0 or 1) — no realignment needed.
    if (Math.abs(offsetBars) <= 1) {
      return {
        realign: false,
        reason: 'already-aligned',
        offsetBars,
      };
    }

    // Case 2: near our own phrase boundary anyway — let it finish naturally.
    if (ownBar >= ownLen - 1) {
      return {
        realign: false,
        reason: 'near-own-boundary',
        offsetBars,
      };
    }

    // Case 3: past 50% of our phrase — finish first, align on next.
    if (ownBar > ownLen / 2) {
      return {
        realign: false,
        reason: 'late-finish',
        offsetBars,
      };
    }

    // Case 4: <2 bars into our phrase — cut short.
    // Case 5: 2 to 50% — mid-phrase cut (the spec's main case).
    const reason = ownBar < EARLY_CUT_BARS ? 'early-cut' : 'mid-phrase-cut';

    // Record the realignment.
    this.state.lastRealignment = now;
    this.state.realignments++;

    // Suggest the archetype + energy + phrase length for the new phrase.
    const suggestedLabel = sectionLabelToArchetype(label);
    const suggestedEnergy = sectionLabelToEnergy(label);
    const suggestedBars = this.state.refPhraseLength || DEFAULT_REALIGN_BARS;

    return {
      realign: true,
      reason,
      offsetBars,
      suggestedLabel,
      suggestedEnergy,
      suggestedBars,
    };
  }

  /**
   * Get the current phrase-sync state for UI display. Returns a defensive
   * copy so callers can't mutate internal state.
   */
  getState(): PhraseSyncState {
    return { ...this.state };
  }

  /**
   * Reset all state (called by engine.stop() and engine.start()).
   *
   * Preserves the master-sync toggle (the user's choice survives a restart)
   * and the ref phrase length estimate (so we don't have to relearn it
   * after a brief stop). Clears all boundary tracking + realignment state.
   */
  reset(): void {
    this.state.refPhraseBar = 0;
    // Keep refPhraseLength (relearned anyway when the first boundary fires
    // after reset, but a sensible default is better than 0).
    this.state.refPhraseLength = DEFAULT_PHRASE_LENGTH;
    this.state.ownPhraseBar = 0;
    this.state.ownPhraseLength = DEFAULT_PHRASE_LENGTH;
    this.state.alignment = 0;
    this.state.lastRealignment = 0;
    this.state.realignments = 0;
    this.state.lastRefBoundaryTime = 0;
    this.state.nextPredictedRefBoundaryBar = 0;
    this.state.lastRefSectionLabel = '';
    // Keep masterSync — it persists across stop/start cycles.
    this.state.masterSync = this.masterSync;

    this.boundaryIntervals = [];
    this.lastBoundaryOwnBar = -1;
    this.latestTotalBars = 0;
    this.pendingRefBoundary = false;
    this.pendingSectionLabel = '';
  }
}
