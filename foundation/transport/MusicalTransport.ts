/**
 * MusicalTransport — Single source of truth for musical time.
 *
 * F1 — FOUNDATION LAB / MUSICAL TRANSPORT
 *
 * DESIGN (from TRANSPORT_DESIGN_REVIEW.md):
 *
 * 1. AudioContext.currentTime is the ONLY musical clock.
 *    Date.now(), performance.now(), setInterval() are forbidden for musical decisions.
 *
 * 2. Transport ≠ PLL. BeatPLL is an observer. Transport is a time model.
 *    Transport works in internal/radio/external/manual modes.
 *
 * 3. Anchor-based clock (no float drift):
 *    beatTime = anchorTime + beatIndex * beatDuration
 *    This eliminates accumulation drift. The only drift source is BPM error.
 *
 * 4. Immutable snapshots. Consumers receive TransportSnapshot (readonly).
 *    No consumer can modify bpm, beatTime, phase, or epoch through a snapshot.
 *
 * 5. Epoch increments on every re-anchor/seek/reset.
 *    Consumers compare epoch to detect clock disruptions.
 *
 * 6. Holdover mode: when radio observations stop, transport continues at
 *    last known BPM with decaying confidence. No hard stop.
 *
 * 7. Half/double tempo: tracked as hypotheses. No false certainty.
 *    When ambiguity is high, locked=false or confidence is reduced.
 *
 * 8. Tab suspension: DROP STALE EVENTS policy. When scheduler wakes after
 *    a stall, it computes position from AudioContext time, not from
 *    accumulated counters. Stale events are dropped, not caught up.
 *
 * USAGE:
 *   const transport = new MusicalTransport(() => audioContext.currentTime);
 *   transport.setTempo(145, 'internal');
 *   transport.start();
 *   // ... later, from radio analysis:
 *   transport.observeBeat({ time: audioContext.currentTime, confidence: 0.9, source: 'radio' });
 *   // ... scheduler reads:
 *   const snap = transport.snapshot();
 *   // ... UI reads (60fps):
 *   const uiSnap = transport.snapshot();
 */

import {
  type TransportSource,
  type BeatObservation,
  type TransportSnapshot,
  type TransportListener,
  type TransportSubscription,
  type TempoHypothesis,
  type TransportConfig,
  DEFAULT_TRANSPORT_CONFIG,
} from './TransportTypes';

export class MusicalTransport {
  private readonly config: TransportConfig;
  private readonly nowFn: () => number;

  // ── Anchor-based clock (F1.4 — no float drift) ──
  // beatTime = anchorTime + (beatIndex - anchorBeatIndex) * beatDuration
  private anchorTime: number = 0;
  private anchorBeatIndex: number = 0;

  // ── Tempo ──
  private bpm: number;
  private confidence: number = 0;
  private locked: boolean = false;
  private source: TransportSource = 'internal';

  // ── Epoch (F1.3 — increment on every disruption) ──
  private epoch: number = 0;

  // ── Beat tracking ──
  private beatIndex: number = 0;
  private beatsPerBar: number;
  private lastObsTime: number = 0;
  private lastObsConfidence: number = 0;
  private observationCount: number = 0;

  // ── Holdover (F1.6 — radio loss handling) ──
  private holdoverActive: boolean = false;
  private holdoverStartTime: number = 0;
  private holdoverBpm: number = 0;

  // ── Tempo hypotheses (F1.7 — half/double ambiguity) ──
  private hypotheses: TempoHypothesis[] = [];

  // ── Running state ──
  private running: boolean = false;
  private startTime: number = 0;

  // ── Subscribers (F1.9) ──
  private listeners: Set<TransportListener> = new Set();
  private notifyPending: boolean = false;
  private notifyScheduled: number = 0;

  constructor(
    nowFn: () => number,
    config: Partial<TransportConfig> = {},
  ) {
    this.nowFn = nowFn;
    this.config = { ...DEFAULT_TRANSPORT_CONFIG, ...config };
    this.bpm = this.config.initialBpm;
    this.beatsPerBar = this.config.beatsPerBar;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PUBLIC API — Control
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Start the transport. Sets the initial anchor at the current audio time.
   */
  start(): void {
    if (this.running) return;
    const now = this.nowFn();
    this.running = true;
    this.startTime = now;
    this.anchorTime = now;
    this.anchorBeatIndex = 0;
    this.beatIndex = 0;
    this.epoch++;
    this.notify();
  }

  /**
   * Stop the transport. Position is frozen.
   */
  stop(): void {
    this.running = false;
    this.notify();
  }

  /**
   * Seek to a specific beat index. Re-anchors immediately.
   * F1.3 — increments epoch so consumers can detect the seek.
   */
  seek(beatIndex: number): void {
    const now = this.nowFn();
    this.anchorTime = now;
    this.anchorBeatIndex = beatIndex;
    this.beatIndex = beatIndex;
    this.epoch++;
    this.notify();
  }

  /**
   * Set the tempo explicitly (internal or manual mode).
   * F1.5 — tempo change does NOT reset phase. Only the BPM changes;
   * the anchor is re-computed to preserve the current beat position.
   */
  setTempo(bpm: number, source: TransportSource = 'internal'): void {
    const clamped = Math.max(this.config.minBpm, Math.min(this.config.maxBpm, bpm));
    const now = this.nowFn();

    // Preserve current beat position across tempo change
    // Current beat time = now (approximately, rounded to nearest beat)
    const oldBeatDuration = 60 / this.bpm;
    const beatsSinceAnchor = (now - this.anchorTime) / oldBeatDuration;
    const currentBeatIndex = this.anchorBeatIndex + Math.round(beatsSinceAnchor);

    // Re-anchor at the current beat with the new tempo
    this.anchorTime = now;
    this.anchorBeatIndex = currentBeatIndex;
    this.beatIndex = currentBeatIndex;
    this.bpm = clamped;
    this.source = source;
    this.epoch++;
    this.notify();
  }

  /**
   * Observe a beat from any source (radio analysis, manual tap, external sync).
   * F1.2 — Transport receives observations but does not require them.
   * F1.6 — If observations stop, transport enters holdover.
   */
  observeBeat(obs: BeatObservation): void {
    if (obs.confidence < this.config.lockThreshold * 0.5) return;

    const now = this.nowFn();

    // If this is the first observation, re-anchor
    if (!this.running || this.observationCount === 0) {
      this.anchorTime = obs.time;
      this.anchorBeatIndex = this.beatIndex;
      this.lastObsTime = obs.time;
      this.lastObsConfidence = obs.confidence;
      this.observationCount = 1;
      this.source = obs.source;
      this.holdoverActive = false;
      this.notify();
      return;
    }

    // Compute observed interval from last observation
    const observedInterval = obs.time - this.lastObsTime;
    if (observedInterval <= 0 || observedInterval > 10) {
      // Out-of-order or absurd gap — update lastObsTime but don't process
      this.lastObsTime = obs.time;
      return;
    }

    const beatDuration = 60 / this.bpm;

    // F1.7 — Half/double tempo handling via periodsElapsed
    // Two-candidate approach: pick the one whose observedBpm is closer to current
    const candidate1 = Math.max(1, Math.floor(observedInterval / beatDuration));
    const candidate2 = candidate1 + 1;
    const obsBpm1 = 60 / (observedInterval / candidate1);
    const obsBpm2 = 60 / (observedInterval / candidate2);
    const periodsElapsed = Math.abs(obsBpm1 - this.bpm) <= Math.abs(obsBpm2 - this.bpm)
      ? candidate1 : candidate2;

    const observedPeriod = observedInterval / periodsElapsed;
    const observedBpm = 60 / observedPeriod;

    // Tempo update (single smoothing — F1.5 decision)
    if (observedBpm >= this.config.minBpm && observedBpm <= this.config.maxBpm) {
      const tempoGain = 0.08;
      this.bpm += (observedBpm - this.bpm) * tempoGain;
    }

    // F1.5 — No phase reset on tempo change. Re-anchor only if phase error is large.
    const predictedBeatTime = this.lastObsTime + periodsElapsed * beatDuration;
    const phaseError = obs.time - predictedBeatTime;

    // F1.4 — Re-anchor at bar boundaries if phase error exceeds threshold
    // This prevents long-term drift without causing phase resets on every beat
    const newBeatIndex = this.beatIndex + periodsElapsed;
    const isBarBoundary = newBeatIndex % this.beatsPerBar === 0;

    if (Math.abs(phaseError) > this.config.reanchorThresholdSec && isBarBoundary) {
      // Smooth re-anchor: blend between predicted and observed to avoid
      // jumping to jittered observations. 30% correction per bar boundary.
      const correctedTime = predictedBeatTime + phaseError * 0.3;
      this.anchorTime = correctedTime;
      this.anchorBeatIndex = newBeatIndex;
      this.epoch++;
    } else if (Math.abs(phaseError) > this.config.reanchorThresholdSec * 3) {
      // Large phase error mid-bar — re-anchor immediately (rare, e.g. after seek)
      this.anchorTime = obs.time;
      this.anchorBeatIndex = newBeatIndex;
      this.epoch++;
    }

    this.beatIndex = newBeatIndex;
    this.lastObsTime = obs.time;
    this.lastObsConfidence = obs.confidence;
    this.observationCount++;

    // Exit holdover if we were in it
    if (this.holdoverActive) {
      this.holdoverActive = false;
      this.source = obs.source;
    }

    // Confidence update
    this.confidence = this.confidence * 0.85 + obs.confidence * 0.15;

    // Lock after enough observations
    if (this.observationCount >= this.config.minObservationsForLock && this.confidence > this.config.lockThreshold) {
      this.locked = true;
    }

    // F1.7 — Update tempo hypotheses for half/double ambiguity
    this.updateHypotheses(observedBpm, periodsElapsed);

    this.notify();
  }

  /**
   * Mark that the radio source has disconnected.
   * F1.6 — Transport enters HOLDOVER mode: continues at last known BPM
   * with decaying confidence.
   */
  loseSource(): void {
    const now = this.nowFn();
    this.holdoverActive = true;
    this.holdoverStartTime = now;
    this.holdoverBpm = this.bpm;
    this.source = 'internal';
    this.locked = false;
    this.confidence *= 0.5; // immediate confidence drop
    this.notify();
  }

  /**
   * Reset the transport completely.
   * F1.3 — increments epoch.
   */
  reset(): void {
    const now = this.nowFn();
    this.running = false;
    this.bpm = this.config.initialBpm;
    this.confidence = 0;
    this.locked = false;
    this.source = 'internal';
    this.anchorTime = now;
    this.anchorBeatIndex = 0;
    this.beatIndex = 0;
    this.lastObsTime = 0;
    this.lastObsConfidence = 0;
    this.observationCount = 0;
    this.holdoverActive = false;
    this.hypotheses = [];
    this.epoch++;
    this.notify();
  }

  /**
   * Notify the transport that the AudioContext was resumed after suspension.
   * F1.8 — Re-anchor immediately. Drop stale events (policy: no catch-up).
   */
  onAudioContextResume(): void {
    const now = this.nowFn();
    // Re-anchor at current position to avoid stale-event burst
    const beatDuration = 60 / this.bpm;
    const beatsSinceAnchor = Math.round((now - this.anchorTime) / beatDuration);
    this.anchorTime = now;
    this.anchorBeatIndex += beatsSinceAnchor;
    this.beatIndex = this.anchorBeatIndex;
    this.epoch++;
    this.notify();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PUBLIC API — Read
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get an immutable snapshot of the transport state.
   * F1.3 — This is the ONLY way consumers can read transport state.
   * F1.9 — Snapshot is immutable; consumers cannot modify transport through it.
   *
   * F1.4 — Anchor-based computation (no float drift):
   *   beatTime = anchorTime + (beatIndex - anchorBeatIndex) * beatDuration
   */
  snapshot(): TransportSnapshot {
    const now = this.nowFn();
    const beatDuration = 60 / this.bpm;

    // F1.4 — Compute current position from anchor (no accumulation)
    const beatsSinceAnchor = (now - this.anchorTime) / beatDuration;
    const currentBeatIndex = this.anchorBeatIndex + Math.floor(beatsSinceAnchor);
    const beatIndex = currentBeatIndex >= 0 ? currentBeatIndex : 0;

    const beatTime = this.anchorTime + (beatIndex - this.anchorBeatIndex) * beatDuration;
    const phase = ((beatsSinceAnchor % 1) + 1) % 1;

    const beat = ((beatIndex % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar;
    const bar = Math.floor(beatIndex / this.beatsPerBar);
    const barTime = beatTime - beat * beatDuration;
    const barPhase = (beat + phase) / this.beatsPerBar;

    const nextBeatTime = beatTime + beatDuration;

    // F1.6 — Holdover confidence decay
    let effectiveConfidence = this.confidence;
    if (this.holdoverActive) {
      const holdoverAge = now - this.holdoverStartTime;
      const halfLife = this.config.holdoverHalfLifeSec;
      effectiveConfidence = this.confidence * Math.pow(0.5, holdoverAge / halfLife);
    }

    // F1.9 — Object.freeze ensures runtime immutability
    // (TypeScript readonly is compile-time only; freeze enforces at runtime)
    return Object.freeze({
      timestamp: now,
      bpm: this.bpm,
      confidence: effectiveConfidence,
      locked: this.locked && !this.holdoverActive,
      beatTime,
      barTime,
      beat,
      bar,
      beatIndex,
      phase,
      barPhase,
      source: this.source,
      epoch: this.epoch,
      beatsPerBar: this.beatsPerBar,
      beatDuration,
      nextBeatTime,
    }) as TransportSnapshot;
  }

  /**
   * Get predicted beat times within a horizon.
   * F1.4 — Computed from anchor, not from accumulation.
   */
  predictBeats(horizonSec: number = 0.2): number[] {
    const snap = this.snapshot();
    const result: number[] = [];
    let t = snap.nextBeatTime;
    const maxTime = snap.timestamp + horizonSec;
    while (t < maxTime) {
      if (t > snap.timestamp) result.push(t);
      t += snap.beatDuration;
    }
    return result;
  }

  /**
   * Get current tempo hypotheses (for half/double ambiguity awareness).
   */
  getHypotheses(): TempoHypothesis[] {
    return [...this.hypotheses];
  }

  /**
   * Check if the transport is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PUBLIC API — Subscribers (F1.9)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Subscribe to transport state changes.
   * F1.9 — Listener receives immutable snapshots. Cannot modify transport.
   */
  subscribe(listener: TransportListener): TransportSubscription {
    this.listeners.add(listener);
    return {
      unsubscribe: () => {
        this.listeners.delete(listener);
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PRIVATE — Implementation
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * F1.7 — Update tempo hypotheses for half/double ambiguity.
   * If the observed BPM is close to 2× or 0.5× the current BPM,
   * record it as an alternative hypothesis.
   */
  private updateHypotheses(observedBpm: number, _periodsElapsed: number): void {
    // Check for half/double tempo candidates
    const doubleBpm = this.bpm * 2;
    const halfBpm = this.bpm / 2;

    const isCloseToDouble = Math.abs(observedBpm - doubleBpm) / doubleBpm < 0.05;
    const isCloseToHalf = Math.abs(observedBpm - halfBpm) / halfBpm < 0.05;

    this.hypotheses = this.hypotheses.filter(h => h.bpm !== this.bpm);

    if (isCloseToDouble) {
      const existing = this.hypotheses.find(h => Math.abs(h.bpm - doubleBpm) < 1);
      if (existing) {
        this.hypotheses = this.hypotheses.map(h =>
          h === existing
            ? { ...h, evidence: h.evidence + 1, confidence: Math.min(1, h.confidence + 0.1) }
            : h
        );
      } else {
        this.hypotheses.push({ bpm: doubleBpm, confidence: 0.3, evidence: 1 });
      }
    }

    if (isCloseToHalf) {
      const existing = this.hypotheses.find(h => Math.abs(h.bpm - halfBpm) < 1);
      if (existing) {
        this.hypotheses = this.hypotheses.map(h =>
          h === existing
            ? { ...h, evidence: h.evidence + 1, confidence: Math.min(1, h.confidence + 0.1) }
            : h
        );
      } else {
        this.hypotheses.push({ bpm: halfBpm, confidence: 0.3, evidence: 1 });
      }
    }

    // If any hypothesis has high evidence, reduce our confidence (ambiguity)
    const strongAlt = this.hypotheses.find(h => h.evidence >= 3 && h.confidence > 0.5);
    if (strongAlt) {
      this.confidence *= 0.8; // reduce confidence due to ambiguity
    }

    // Keep only top 3 hypotheses
    this.hypotheses.sort((a, b) => b.confidence - a.confidence);
    this.hypotheses = this.hypotheses.slice(0, 3);
  }

  /**
   * Notify all subscribers. Batched to avoid excessive calls.
   */
  private notify(): void {
    // Immediate notification (no batching for now — can add rAF batching later)
    const snap = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(snap);
      } catch {
        // Listener errors don't affect transport
      }
    }
  }
}
