/**
 * TransportAdapter — bridges MusicalTransport to the existing PsyLive engine.
 *
 * F1.10 — SCHEDULER INTEGRATION
 *
 * Phase 1 (this gate): Adapter wraps Transport, provides a clean interface
 *   for the existing scheduler to consume. The scheduler reads
 *   transport.snapshot() instead of managing its own nextNoteTime/step/barCount.
 *
 * Phase 2 (this gate, if tests pass): Delete duplicate clock state from psyLive:
 *   - this.step → derived from snapshot.beat
 *   - this.nextNoteTime → derived from snapshot.nextBeatTime
 *   - this.barCount → derived from snapshot.bar
 *   - this.engineBpm → derived from snapshot.bpm
 *   - this.lastScheduledStepKey → replaced by epoch-based dedup
 *
 * The adapter does NOT modify Transport state. It only reads snapshots
 * and translates them into the format the existing scheduler expects.
 */

import { MusicalTransport } from './MusicalTransport';
import type { TransportSnapshot, BeatObservation, TransportSource } from './TransportTypes';

export interface SchedulerClockInfo {
  /** Current BPM (from Transport) */
  bpm: number;
  /** Current beat index (from Transport) */
  beatIndex: number;
  /** Step within the 16-step pattern (0..15) */
  step16: number;
  /** Bar index (from Transport) */
  bar: number;
  /** AudioContext time of the next beat boundary */
  nextBeatTime: number;
  /** Beat duration in seconds */
  beatDuration: number;
  /** 16th-note duration in seconds */
  stepDuration: number;
  /** Whether transport is locked (following radio) */
  locked: boolean;
  /** Current epoch (for dedup) */
  epoch: number;
  /** Current source */
  source: TransportSource;
  /** Confidence (0..1) */
  confidence: number;
}

export class TransportAdapter {
  private transport: MusicalTransport;
  private lastProcessedEpoch: number = -1;
  private lastProcessedBeatIndex: number = -1;

  constructor(transport: MusicalTransport) {
    this.transport = transport;
  }

  /**
   * Get the clock info the scheduler needs.
   * This replaces: nextNoteTime, step, barCount, engineBpm in psyLive.
   */
  getClockInfo(): SchedulerClockInfo {
    const snap = this.transport.snapshot();
    return {
      bpm: snap.bpm,
      beatIndex: snap.beatIndex,
      step16: snap.beatIndex % 16,
      bar: snap.bar,
      nextBeatTime: snap.nextBeatTime,
      beatDuration: snap.beatDuration,
      stepDuration: snap.beatDuration / 4,
      locked: snap.locked,
      epoch: snap.epoch,
      source: snap.source,
      confidence: snap.confidence,
    };
  }

  /**
   * Get predicted beat times for the scheduler's lookahead window.
   * Replaces: pll.predictBeats() in psyLive.
   */
  getUpcomingBeats(horizonSec: number = 0.2): number[] {
    return this.transport.predictBeats(horizonSec);
  }

  /**
   * Feed a beat observation to the transport.
   * Replaces: pll.update() in psyLive.onKick().
   */
  observeBeat(time: number, confidence: number, source: TransportSource = 'radio'): void {
    const obs: BeatObservation = { time, confidence, source };
    this.transport.observeBeat(obs);
  }

  /**
   * Notify transport that radio source was lost.
   * Replaces: pll.reset() in psyLive.disconnectRadio().
   */
  loseRadioSource(): void {
    this.transport.loseSource();
  }

  /**
   * Notify transport that AudioContext was resumed.
   * Call this from the AudioContext 'statechange' event handler.
   */
  onAudioContextResume(): void {
    this.transport.onAudioContextResume();
  }

  /**
   * Check if this is a new epoch (clock was disrupted).
   * Consumers use this to decide whether to re-evaluate their state.
   */
  isNewEpoch(): boolean {
    const snap = this.transport.snapshot();
    return snap.epoch !== this.lastProcessedEpoch;
  }

  /**
   * Mark the current epoch as processed.
   */
  markEpochProcessed(): void {
    this.lastProcessedEpoch = this.transport.snapshot().epoch;
  }

  /**
   * Check if a beat boundary was crossed since the last check.
   * Used by the scheduler to decide when to increment step counters.
   */
  consumeBeatBoundary(): boolean {
    const info = this.getClockInfo();
    if (info.beatIndex !== this.lastProcessedBeatIndex) {
      this.lastProcessedBeatIndex = info.beatIndex;
      return true;
    }
    return false;
  }

  /**
   * Get the underlying transport (for direct access if needed).
   */
  getTransport(): MusicalTransport {
    return this.transport;
  }

  /**
   * Get a raw snapshot.
   */
  snapshot(): TransportSnapshot {
    return this.transport.snapshot();
  }
}
