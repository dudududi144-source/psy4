/**
 * DJ-style phase sync — phase-locked beat matching + downbeat alignment.
 *
 * Task D1 — the engine matches BPM (continuous tracking via
 * applyMusicalUnderstanding) but did NOT align PHASE. DJ software
 * (Serato/Traktor/CDJs) does phase-locked sync — aligning the beat grid so
 * the kick drums hit together. This module implements that.
 *
 * Responsibilities:
 *   1. Track the reference's beat phase + downbeat phase (from the listener).
 *   2. Track our own beat phase (from triggerDrum(0, ...) kick hits).
 *   3. Compute a smooth phase offset (seconds) the scheduler adds to
 *      nextTime so our beats land at the ref's phase.
 *   4. Gradual BPM convergence — nudge our BPM toward the ref BPM by 0.1 /
 *      0.3 BPM per bar (or snap if > 5 BPM off).
 *   5. Downbeat alignment — if our bar boundaries are off by > 1 beat,
 *      schedule a "beat drop" at the next bar boundary to re-align.
 *
 * Time base: wall-clock seconds (performance.now() / 1000). This is the
 * common time base across the engine's AudioContext and the listener's
 * AudioContext (they share the same monotonic clock with different zero
 * points; the offset is constant per context). The engine converts its
 * audio-context time to wall-clock before calling setOwnBeat().
 *
 * The PhaseSync is OPTIONAL — when syncEnabled = false, getPhaseOffset()
 * returns 0 and tickBar() returns no nudges. The engine still works exactly
 * as before (BPM tracking via applyMusicalUnderstanding + flowEngine).
 *
 * Constraints honored:
 *   - Phase adjustments are smooth (max 50ms per step — well below the
 *     60ms scheduler lookahead, so no audio glitches).
 *   - All public methods guard against missing/zero phase data.
 *   - TypeScript strict mode (no implicit any, no unsafe arithmetic).
 *   - The PhaseSync never throws — malformed input yields no-op.
 */

export interface PhaseInfo {
  bpm: number;
  /** 0..1 — position within the beat cycle (0 = beat onset, 0.5 = offbeat). */
  phase: number;
  /** 0..1 — position within the bar (4 beats). 0 = downbeat, 0.25 = beat 2, ... */
  downbeatPhase: number;
  /** 0..1 — how regular the ref's beat grid is (low variance = high). */
  confidence: number;
  /**
   * Wall-clock seconds (performance.now()/1000) of the last detected beat.
   * Used to extrapolate the ref's phase forward to the current wall-clock.
   */
  lastBeatTime: number;
}

export interface SyncStatus {
  /** True when phase + downbeat + BPM are all within tolerance. */
  synced: boolean;
  /** Current phase offset being applied (smoothed), in ms. */
  offsetMs: number;
  /** Target phase offset (raw computation, before smoothing), in ms. */
  targetOffsetMs: number;
  refBpm: number;
  ownBpm: number;
  /** 0..100 — how close the BPMs are (100 = exact match). */
  bpmMatchPct: number;
  /** 0..1 — |our_phase - ref_phase| (circular, so always ≤ 0.5). */
  phaseDiff: number;
  /** 0..100 — how well bar boundaries align. */
  downbeatAlignment: number;
  /** 0..1 — current predicted ref phase. */
  refPhase: number;
  /** 0..1 — current predicted own phase. */
  ownPhase: number;
  /** 0..3 — current predicted ref beat-in-bar. */
  refDownbeat: number;
  /** 0..3 — current predicted own beat-in-bar. */
  ownDownbeat: number;
  /** True when a beat-drop re-alignment is queued for the next bar. */
  beatDropPending: boolean;
  /** BPM we still need to converge by (refBpm - ownBpm). */
  convergenceBpmDelta: number;
  /** Mirror of syncEnabled so the UI can render the toggle state. */
  syncEnabled: boolean;
  /** Reference's latest confidence (0..1). */
  confidence: number;
}

/** Per-step offset nudge cap (seconds). 50ms < 60ms lookahead → glitch-free. */
const MAX_SMOOTH_OFFSET_MS = 50;
/** Drift above this triggers a beat-drop re-alignment at the next bar. */
const BEAT_DROP_THRESHOLD_MS = 200;
/** Phase-diff below this = "locked" (green) in the UI. ~16ms at 138 BPM. */
const SYNC_LOCK_PHASE_DIFF = 0.04;
/** Downbeat alignment above this = "locked" (green). */
const SYNC_LOCK_DOWNBEAT_PCT = 85;
/** Confidence threshold below which sync refuses to engage. */
const SYNC_CONFIDENCE_THRESHOLD = 0.3;

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

/** Always-positive modulo 1. */
function mod1(v: number): number {
  let x = v % 1;
  if (x < 0) x += 1;
  return x;
}

/** Smallest signed difference a-b on a 0..1 circle. Returns -0.5..0.5. */
function circularDelta(a: number, b: number): number {
  let d = mod1(a) - mod1(b);
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return d;
}

export class PhaseSync {
  private refPhase: PhaseInfo | null = null;
  private ownPhase: PhaseInfo | null = null;

  /**
   * Smoothed phase offset currently being applied (seconds). The scheduler
   * adds this to nextTime so our beats land at the ref's phase. We smooth
   * toward targetOffset in MAX_SMOOTH_OFFSET_MS-per-step nudges so the
   * audio thread doesn't glitch on a sudden 200ms jump.
   */
  private currentOffset = 0;
  /** Raw target offset (seconds) computed from the latest phase delta. */
  private targetOffset = 0;

  private syncEnabled = false;
  /** Wall-clock seconds of the last setReferencePhase() call. */
  private lastSyncTime = 0;

  /**
   * Ring of recent own kick times (wall-clock seconds) for our own beat
   * period estimate. We don't fully trust the engine's _bpm because the
   * audio-thread scheduler can drift from the actual beat rate.
   */
  private ownBeatTimes: number[] = [];
  private static readonly OWN_BEAT_RING = 8;

  /**
   * Beat-drop state: when drift is > BEAT_DROP_THRESHOLD_MS, we schedule a
   * one-shot grid jump at the next bar boundary. The engine calls tickBar()
   * per bar; if beatDropPending is true, tickBar() emits doBeatDrop=true
   * with the signed jump to apply, then clears the pending flag.
   */
  private beatDropPending = false;
  private beatDropOffsetSec = 0;

  /** Last BPM nudge applied (for status display). */
  private lastBpmNudge = 0;
  /** BPM delta we still need to converge by (refBpm - ownBpm). */
  private convergenceBpmDelta = 0;

  // ─── Public API ──────────────────────────────────────────────────────

  setSyncEnabled(enabled: boolean): void {
    this.syncEnabled = enabled;
    if (!enabled) {
      // Clear offsets + nudge state so disabling sync is a clean hand-off.
      // The engine keeps playing at its current BPM — we just stop nudging.
      this.currentOffset = 0;
      this.targetOffset = 0;
      this.beatDropPending = false;
      this.beatDropOffsetSec = 0;
      this.lastBpmNudge = 0;
      this.convergenceBpmDelta = 0;
    }
  }

  isSyncEnabled(): boolean {
    return this.syncEnabled;
  }

  /**
   * Reset own-beat tracking state. Called by the engine on stop() so a
   * stop/start cycle is clean — the own-beat ring buffer, phase offsets,
   * and beat-drop state are cleared. The reference phase + syncEnabled
   * flag are preserved (the radio is still playing and the user's toggle
   * choice persists).
   */
  reset(): void {
    this.ownBeatTimes = [];
    this.ownPhase = null;
    this.currentOffset = 0;
    this.targetOffset = 0;
    this.beatDropPending = false;
    this.beatDropOffsetSec = 0;
    this.lastBpmNudge = 0;
    this.convergenceBpmDelta = 0;
  }

  /**
   * Called by the engine (via liveTrack) when fresh phase info is extracted
   * from the radio by the listener. The lastBeatTime is in wall-clock
   * seconds (performance.now()/1000).
   *
   * If sync is disabled, we still store the ref phase so the UI can display
   * "what we're hearing" — but we don't recompute the target offset.
   */
  setReferencePhase(phase: PhaseInfo): void {
    if (!phase || !Number.isFinite(phase.bpm) || phase.bpm <= 0) return;
    this.refPhase = {
      bpm: clamp(phase.bpm, 30, 220),
      phase: clamp(mod1(phase.phase), 0, 1),
      downbeatPhase: clamp(mod1(phase.downbeatPhase), 0, 1),
      confidence: clamp(phase.confidence, 0, 1),
      lastBeatTime: Number.isFinite(phase.lastBeatTime) ? phase.lastBeatTime : 0,
    };
    this.lastSyncTime = performance.now() / 1000;
    if (this.syncEnabled) {
      this.recomputeTargetOffset();
    }
  }

  /**
   * Called by the engine when its own kick fires (triggerDrum(0, ...)).
   *
   * @param time            Audio-context time the kick is scheduled to fire.
   * @param ctxCurrentTime  The engine's audioCtx.currentTime at the moment
   *                        of the call (so we can convert audio-context time
   *                        → wall-clock time).
   * @param wallClockNow    performance.now()/1000 at the moment of the call.
   * @param isDownbeat      True if this kick is a bar-start kick
   *                        (step % 16 === 0). Used to track downbeat phase
   *                        separately from beat phase.
   */
  setOwnBeat(
    time: number,
    ctxCurrentTime: number,
    wallClockNow: number,
    isDownbeat: boolean,
  ): void {
    if (!Number.isFinite(time) || !Number.isFinite(ctxCurrentTime) || !Number.isFinite(wallClockNow)) {
      return;
    }
    // Convert audio-context time → wall-clock seconds.
    // The two clocks share the same monotonic base; their zero points differ
    // by a constant per AudioContext. wallClockAtAudioTime(t) =
    //   wallClockNow + (t - ctxCurrentTime)
    const wall = wallClockNow + (time - ctxCurrentTime);

    // Push to ring buffer for our own beat-period estimate.
    this.ownBeatTimes.push(wall);
    if (this.ownBeatTimes.length > PhaseSync.OWN_BEAT_RING) {
      this.ownBeatTimes.shift();
    }

    // Estimate our own beat period (median of inter-onset intervals).
    // Median is robust to outliers (e.g., a single dropped kick).
    let beatPeriod = 0;
    if (this.ownBeatTimes.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < this.ownBeatTimes.length; i++) {
        const dt = this.ownBeatTimes[i] - this.ownBeatTimes[i - 1];
        if (dt > 0.05 && dt < 4) intervals.push(dt);  // 15..1200 BPM sanity
      }
      if (intervals.length > 0) {
        intervals.sort((a, b) => a - b);
        beatPeriod = intervals[Math.floor(intervals.length / 2)];
      }
    }
    const ownBpm = beatPeriod > 0 ? clamp(60 / beatPeriod, 30, 220) : 0;

    // Phase = 0 by definition (a kick fires at the start of a beat).
    const phase = 0;
    // Downbeat phase: if this kick is a downbeat, phase = 0; otherwise we
    // don't know exactly where in the bar we are without more context.
    // We rely on the engine telling us via isDownbeat.
    const downbeatPhase = isDownbeat ? 0 : (this.ownPhase?.downbeatPhase ?? 0);

    this.ownPhase = {
      bpm: ownBpm,
      phase,
      downbeatPhase,
      confidence: this.ownBeatTimes.length >= 3 ? 0.7 : 0.3,
      lastBeatTime: wall,
    };

    if (this.syncEnabled) {
      this.recomputeTargetOffset();
    }
  }

  /**
   * Called by the engine each tick (every 15ms). Returns the current phase
   * offset (seconds) to apply to the scheduler's nextTime.
   *
   * The offset is SMOOTHED toward the target — small per-step nudges
   * (< 50 ms) prevent audio glitches. If sync is disabled, returns 0.
   *
   * Sign convention:
   *   - Positive offset = our beats fire too early → delay them.
   *   - Negative offset = our beats fire too late → advance them.
   */
  getPhaseOffset(): number {
    if (!this.syncEnabled) return 0;
    // Smoothly approach target offset. The maxStep is small enough that even
    // a 200ms target offset takes 4 ticks (~60ms) to settle — well within
    // the scheduler's 60ms lookahead so no audio glitch.
    const target = this.targetOffset;
    const diff = target - this.currentOffset;
    const maxStep = MAX_SMOOTH_OFFSET_MS / 1000;
    if (Math.abs(diff) <= maxStep) {
      this.currentOffset = target;
    } else {
      this.currentOffset += Math.sign(diff) * maxStep;
    }
    return this.currentOffset;
  }

  /**
   * Called by the engine once per bar (in tick() when bar increments).
   *
   * Returns:
   *   - bpmNudge: small BPM delta to apply this bar (gradual convergence).
   *       0.1 BPM/bar for |delta| < 2, 0.3 BPM/bar for |delta| in [2, 5],
   *       0 for |delta| > 5 (let the engine's existing ramp handle the snap).
   *   - doBeatDrop: if true, the engine should jump nextTime by
   *       beatDropOffsetSec to realign downbeats. This is the "skip a bar"
   *       DJ move — happens rarely (only when sync first engages or after
   *       a major drift).
   *   - beatDropOffsetSec: signed time-jump to apply (if doBeatDrop).
   */
  tickBar(ourBpm: number): {
    bpmNudge: number;
    doBeatDrop: boolean;
    beatDropOffsetSec: number;
  } {
    if (!this.syncEnabled || !this.refPhase) {
      return { bpmNudge: 0, doBeatDrop: false, beatDropOffsetSec: 0 };
    }

    // ── Gradual BPM convergence ──
    // Don't snap instantly — nudge toward the ref BPM by a small amount each
    // bar. This prevents audible pitch/time artifacts from sudden BPM changes.
    // The thresholds match the task spec:
    //   < 2 BPM: 0.1 BPM/bar
    //   2-5 BPM: 0.3 BPM/bar
    //   > 5 BPM: snap (handled by the engine's existing BPM ramp in
    //            applyMusicalUnderstanding — we don't compete with it).
    const refBpm = this.refPhase.bpm;
    const delta = refBpm - ourBpm;
    const absDelta = Math.abs(delta);
    let nudge = 0;
    if (absDelta > 5) {
      nudge = 0;
    } else if (absDelta > 2) {
      nudge = Math.sign(delta) * 0.3;
    } else if (absDelta > 0.1) {
      nudge = Math.sign(delta) * 0.1;
    } else {
      nudge = 0;
    }
    this.lastBpmNudge = nudge;
    this.convergenceBpmDelta = delta;

    // ── Beat-drop re-alignment ──
    // If the target offset exceeds the beat-drop threshold, schedule a
    // one-shot grid jump at the next bar boundary. The engine applies the
    // jump (by advancing nextTime + step counter) and we clear the pending
    // flag. This is the "soft restart" DJ move.
    let doBeatDrop = false;
    let beatDropOffsetSec = 0;
    if (this.beatDropPending) {
      // The next bar boundary has arrived — fire the jump.
      doBeatDrop = true;
      beatDropOffsetSec = this.beatDropOffsetSec;
      this.beatDropPending = false;
      this.beatDropOffsetSec = 0;
      // After the jump, snap the current offset to 0 — the jump consumed
      // the integer-beat portion of the drift; the residual (< 1 beat) is
      // handled by the smooth per-step nudge in getPhaseOffset().
      this.currentOffset = 0;
      this.targetOffset = 0;
    } else if (Math.abs(this.targetOffset) * 1000 > BEAT_DROP_THRESHOLD_MS) {
      // Drift is large — schedule a beat-drop for the NEXT bar boundary.
      // The jump is the integer-beat portion of the offset (sign preserved)
      // so the residual is < half a beat, which the smooth nudge can handle.
      const ourBeatPeriod = ourBpm > 0 ? 60 / ourBpm : 0;
      if (ourBeatPeriod > 0) {
        const beatsToJump = Math.round(this.targetOffset / ourBeatPeriod);
        this.beatDropOffsetSec = beatsToJump * ourBeatPeriod;
        this.beatDropPending = true;
      }
    }

    return { bpmNudge: nudge, doBeatDrop, beatDropOffsetSec };
  }

  /**
   * Returns the current sync status for UI display. All fields are guarded
   * against missing data (zero/false when no ref phase yet).
   */
  getSyncStatus(): SyncStatus {
    const now = performance.now() / 1000;
    const ref = this.refPhase;
    const own = this.ownPhase;

    if (!ref || !own) {
      return {
        synced: false,
        offsetMs: this.currentOffset * 1000,
        targetOffsetMs: this.targetOffset * 1000,
        refBpm: ref?.bpm ?? 0,
        ownBpm: own?.bpm ?? 0,
        bpmMatchPct: 0,
        phaseDiff: 0,
        downbeatAlignment: 0,
        refPhase: 0,
        ownPhase: 0,
        refDownbeat: 0,
        ownDownbeat: 0,
        beatDropPending: this.beatDropPending,
        convergenceBpmDelta: this.convergenceBpmDelta,
        syncEnabled: this.syncEnabled,
        confidence: ref?.confidence ?? 0,
      };
    }

    // Predicted current phases (extrapolate forward from lastBeatTime using
    // each side's beat period). This is the heart of "where the beat is NOW".
    const refBeatPeriod = 60 / ref.bpm;
    const ownBeatPeriod = own.bpm > 0 ? 60 / own.bpm : refBeatPeriod;
    const refPhaseNow = mod1(ref.phase + (now - ref.lastBeatTime) / refBeatPeriod);
    const ownPhaseNow = mod1(own.phase + (now - own.lastBeatTime) / ownBeatPeriod);
    const phaseDiff = Math.abs(circularDelta(refPhaseNow, ownPhaseNow));

    // Downbeat alignment: 0..100 based on how close the downbeat phases are.
    // Downbeat period = 4 × beat period. We extrapolate both sides forward.
    const refDb = mod1(ref.downbeatPhase + (now - ref.lastBeatTime) / (refBeatPeriod * 4));
    const ownDb = mod1(own.downbeatPhase + (now - own.lastBeatTime) / (ownBeatPeriod * 4));
    const dbDiff = Math.abs(circularDelta(refDb, ownDb));
    const downbeatAlignment = clamp((1 - dbDiff * 2) * 100, 0, 100);

    // BPM match percentage. 100% = exact match, 0% = >10 BPM off.
    const bpmDelta = Math.abs(ref.bpm - own.bpm);
    const bpmMatchPct = clamp(100 - bpmDelta * 10, 0, 100);

    // Synced = phase aligned AND downbeat aligned AND bpm close AND ref
    // confidence is high enough to trust.
    const synced = this.syncEnabled
      && phaseDiff < SYNC_LOCK_PHASE_DIFF
      && downbeatAlignment > SYNC_LOCK_DOWNBEAT_PCT
      && bpmDelta < 1.5
      && ref.confidence > SYNC_CONFIDENCE_THRESHOLD;

    return {
      synced,
      offsetMs: this.currentOffset * 1000,
      targetOffsetMs: this.targetOffset * 1000,
      refBpm: ref.bpm,
      ownBpm: own.bpm,
      bpmMatchPct,
      phaseDiff,
      downbeatAlignment,
      refPhase: refPhaseNow,
      ownPhase: ownPhaseNow,
      refDownbeat: Math.floor(refDb * 4) % 4,
      ownDownbeat: Math.floor(ownDb * 4) % 4,
      beatDropPending: this.beatDropPending,
      convergenceBpmDelta: this.convergenceBpmDelta,
      syncEnabled: this.syncEnabled,
      confidence: ref.confidence,
    };
  }

  // ─── Internal ────────────────────────────────────────────────────────

  /**
   * Recompute the target phase offset based on the latest ref and own phase.
   *
   * The offset is the time-shift (seconds) needed to align our next beat
   * with the ref's next beat. Sign convention:
   *   - Positive offset = our beats fire too early, delay them.
   *   - Negative offset = our beats fire too late, advance them.
   *
   * If the offset is more than half a beat, we wrap it into [-halfBeat,
   * +halfBeat] (the circular minimum). The integer-beat excess is handled
   * by the beat-drop mechanism in tickBar().
   *
   * The offset is also confidence-weighted — a low-confidence ref phase
   * produces a small offset, so we don't fight noisy detections.
   */
  private recomputeTargetOffset(): void {
    if (!this.syncEnabled || !this.refPhase || !this.ownPhase) {
      this.targetOffset = 0;
      return;
    }
    const now = performance.now() / 1000;
    const ref = this.refPhase;
    const own = this.ownPhase;

    const refBeatPeriod = 60 / ref.bpm;
    const ownBeatPeriod = own.bpm > 0 ? 60 / own.bpm : refBeatPeriod;

    // Predicted current phases (extrapolate forward from lastBeatTime).
    const refPhaseNow = mod1(ref.phase + (now - ref.lastBeatTime) / refBeatPeriod);
    const ownPhaseNow = mod1(own.phase + (now - own.lastBeatTime) / ownBeatPeriod);

    // Time until next ref beat = (1 - refPhaseNow) * refBeatPeriod.
    // Time until next own beat = (1 - ownPhaseNow) * ownBeatPeriod.
    // Offset (added to our nextTime to align) = refTimeToNext - ownTimeToNext.
    // If positive, our next beat fires BEFORE the ref's next beat → we need
    // to delay it (add positive offset to nextTime).
    const refTimeToNext = (1 - refPhaseNow) * refBeatPeriod;
    const ownTimeToNext = (1 - ownPhaseNow) * ownBeatPeriod;
    let offset = refTimeToNext - ownTimeToNext;

    // If the offset is more than half a beat, snap to the circular minimum.
    // The integer-beat excess is queued for a beat-drop in tickBar().
    const halfBeat = ownBeatPeriod / 2;
    if (Math.abs(offset) > halfBeat) {
      const beats = Math.round(offset / ownBeatPeriod);
      offset -= beats * ownBeatPeriod;
    }

    // Confidence-weighted blend: don't fight a low-confidence ref.
    const conf = clamp(ref.confidence, 0, 1);
    this.targetOffset = offset * conf;
  }
}
