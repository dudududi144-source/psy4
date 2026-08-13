/**
 * RadioStateGate — explicit radio signal reality gate.
 *
 * Per Reality Bridge §5: NEVER use 'LISTENING' as proof of signal.
 *
 * The previous engine set `syncStatus = 'listening'` immediately after
 * `await radioEl.play()` resolved. That only proves the play() promise
 * resolved — it does NOT prove audio samples are actually flowing.
 *
 * This module defines the explicit state machine:
 *
 *   DISCONNECTED → CONNECTING → CONNECTED_NO_SIGNAL
 *                              ↘ CONNECTED_SIGNAL → PLAYING_SIGNAL
 *                       ↗ (anywhere) → BUFFERING
 *                       ↗ (anywhere) → ERROR
 *
 * It also exposes the measured reality signals:
 *   sampleRate, rms, peak, spectralEnergy, nonZeroSamples, signalAgeMs
 *
 * The classification rule (signal vs no-signal) is deliberately conservative:
 *   - At least 5% of samples in the window must be non-zero (above ±1e-5)
 *   - RMS must exceed 1e-4 (i.e. not just dither noise floor)
 *   - The window must be fresh (signalAgeMs < 2000)
 *
 * If any of those fail, state = CONNECTED_NO_SIGNAL even if the underlying
 * HTMLAudioElement claims it is "playing".
 */

export type RadioState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED_NO_SIGNAL'
  | 'CONNECTED_SIGNAL'
  | 'PLAYING_SIGNAL'
  | 'BUFFERING'
  | 'ERROR';

export interface RadioSignalSnapshot {
  state: RadioState;
  sampleRate: number;
  rms: number;
  peak: number;
  spectralEnergy: number;
  nonZeroSamples: number;        // count
  nonZeroRatio: number;          // 0..1
  totalSamples: number;          // window length
  signalAgeMs: number;           // age of last non-trivial sample
  lastUpdateMs: number;          // Date.now() of last update
  reason: string;                // why this state was chosen
}

export class RadioStateGate {
  private state: RadioState = 'DISCONNECTED';
  private lastSignificantSampleMs: number = 0;
  private lastSnapshot: RadioSignalSnapshot | null = null;

  /** Called when the app starts trying to connect (e.g. radioEl.play() invoked). */
  markConnecting(): void {
    if (this.state === 'DISCONNECTED' || this.state === 'ERROR') {
      this.state = 'CONNECTING';
    }
  }

  /** Called when the MediaElementSource is wired up (regardless of signal). */
  markConnected(sampleRate: number): void {
    if (this.state === 'DISCONNECTED' || this.state === 'CONNECTING' || this.state === 'ERROR') {
      this.state = 'CONNECTED_NO_SIGNAL';
    }
    this.lastSnapshot = {
      state: this.state, sampleRate, rms: 0, peak: 0, spectralEnergy: 0,
      nonZeroSamples: 0, nonZeroRatio: 0, totalSamples: 0,
      signalAgeMs: 0, lastUpdateMs: Date.now(),
      reason: 'connected, awaiting first analyser frame',
    };
  }

  /** Called when HTMLAudioElement reports buffering. */
  markBuffering(): void { this.state = 'BUFFERING'; }

  /** Called on any error. */
  markError(reason: string): void {
    this.state = 'ERROR';
    this.lastSnapshot = {
      state: this.state, sampleRate: 0, rms: 0, peak: 0, spectralEnergy: 0,
      nonZeroSamples: 0, nonZeroRatio: 0, totalSamples: 0,
      signalAgeMs: 0, lastUpdateMs: Date.now(),
      reason: `error: ${reason}`,
    };
  }

  /**
   * Consume a frame of time-domain audio from the analyser.
   * This is the REALITY CHECK — does the analyser actually see samples?
   */
  observe(
    timeDomain: Float32Array,
    frequencyData: Uint8Array,
    sampleRate: number,
  ): RadioSignalSnapshot {
    const N = timeDomain.length;
    let sumSq = 0;
    let peak = 0;
    let nonZero = 0;
    for (let i = 0; i < N; i++) {
      const v = timeDomain[i];
      sumSq += v * v;
      const av = Math.abs(v);
      if (av > peak) peak = av;
      if (av > 1e-5) nonZero++;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, N));
    const nonZeroRatio = nonZero / N;

    let spectralEnergy = 0;
    for (let i = 0; i < frequencyData.length; i++) spectralEnergy += frequencyData[i];
    spectralEnergy /= (frequencyData.length * 255);

    const now = Date.now();
    if (rms > 1e-4 && nonZeroRatio > 0.05) {
      this.lastSignificantSampleMs = now;
    }
    const signalAgeMs = this.lastSignificantSampleMs ? now - this.lastSignificantSampleMs : -1;

    // Classification rules
    let state: RadioState = this.state;
    let reason = '';

    if (this.state === 'ERROR' || this.state === 'DISCONNECTED') {
      // Don't override explicit terminal-ish states
      reason = `preserved ${this.state}`;
    } else if (this.state === 'CONNECTING') {
      // Still connecting — keep CONNECTING until we see real signal
      reason = 'still connecting';
    } else if (rms > 1e-4 && nonZeroRatio > 0.05 && signalAgeMs >= 0 && signalAgeMs < 2000) {
      state = 'PLAYING_SIGNAL';
      reason = `rms=${rms.toFixed(4)} nonZero=${(nonZeroRatio * 100).toFixed(1)}% age=${signalAgeMs}ms`;
    } else if (rms > 1e-5 && nonZeroRatio > 0.02) {
      state = 'CONNECTED_SIGNAL';
      reason = `weak signal rms=${rms.toFixed(4)} nonZero=${(nonZeroRatio * 100).toFixed(1)}%`;
    } else {
      state = 'CONNECTED_NO_SIGNAL';
      reason = `no signal rms=${rms.toFixed(5)} nonZero=${(nonZeroRatio * 100).toFixed(1)}%`;
    }
    this.state = state;

    const snap: RadioSignalSnapshot = {
      state, sampleRate, rms, peak, spectralEnergy,
      nonZeroSamples: nonZero, nonZeroRatio, totalSamples: N,
      signalAgeMs, lastUpdateMs: now, reason,
    };
    this.lastSnapshot = snap;
    return snap;
  }

  /** Reset (e.g. on disconnect). */
  reset(): void {
    this.state = 'DISCONNECTED';
    this.lastSignificantSampleMs = 0;
    this.lastSnapshot = null;
  }

  getState(): RadioState { return this.state; }
  getSnapshot(): RadioSignalSnapshot | null { return this.lastSnapshot; }

  /** True only when actually flowing non-trivial samples. */
  isActuallyPlayingSignal(): boolean {
    return this.state === 'PLAYING_SIGNAL';
  }
}
