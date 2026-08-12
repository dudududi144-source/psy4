/**
 * RadioObservationLayer — the SINGLE entry point for all radio analysis.
 *
 * F2 ARCHITECTURE:
 *
 *   Radio audio → AnalyserNode → RadioObservationLayer.process()
 *                                    ├── RadioSignalGate (signal state)
 *                                    ├── BeatObservationEngine (beat detection)
 *                                    │     → RadioBeatObservation
 *                                    │     → transport.observeBeat() (ONLY crossing point)
 *                                    └── PitchObserver (wraps MelodyObserver)
 *                                          → RadioPitchObservation
 *
 * OWNERSHIP RULES:
 * - Radio is an OBSERVATION SOURCE, never a musical clock.
 * - Only { time, confidence, source } crosses into Transport.
 * - No raw audio, FFT, spectral features, or occupancy cross.
 * - Signal state and observation state are SEPARATE.
 *
 * USAGE:
 *   const layer = new RadioObservationLayer(config);
 *   // Once per detect tick:
 *   const snap = layer.process(timeDomain, frequencyData, ctx.currentTime);
 *   // snap.signal.state → 'STABLE_SIGNAL' etc.
 *   // snap.beat → RadioBeatObservation | null
 *   // snap.pitch → RadioPitchObservation | null
 */

import { BeatObservationEngine, type BeatCandidate } from './BeatObservationEngine';
import { MelodyObserver, estimatePitch, spectralFlatness, extractMelodicBand } from '../../src/lib/melodyObserver';
import type {
  RadioObservationConfig,
  RadioObservationSnapshot,
  RadioSignalSnapshot,
  RadioSignalState,
  RadioObservationState,
  RadioBeatObservation,
  RadioPitchObservation,
  RadioTimestamp,
} from './RadioObservationTypes';

export class RadioObservationLayer {
  private config: RadioObservationConfig;
  private beatEngine: BeatObservationEngine;
  private melodyObserver: MelodyObserver;

  // Signal state tracking
  private signalState: RadioSignalState = 'DISCONNECTED';
  private observationState: RadioObservationState = 'NO_SIGNAL';
  private signalPresentSince: number = 0;  // AudioContext time when signal first appeared
  private lastSignificantSampleTime: number = 0;  // AudioContext time
  private lastSnapshot: RadioObservationSnapshot | null = null;

  // Occupancy tracking (for arranger — does NOT cross into Transport)
  private occupancy = { kick: 0, bass: 0, lead: 0, hats: 0 };

  // Bounded ring buffer for recent observations (F2.11 — no unbounded arrays)
  private recentObservations: RadioBeatObservation[] = [];

  constructor(config: RadioObservationConfig) {
    this.config = config;
    this.beatEngine = new BeatObservationEngine(config);
    this.melodyObserver = new MelodyObserver();
  }

  /**
   * Process a frame of radio audio.
   * This is the SINGLE entry point — called once per detect tick.
   *
   * @param timeDomain Float32Array from analyser.getFloatTimeDomainData()
   * @param frequencyData Uint8Array from analyser.getByteFrequencyData()
   * @param audioTime AudioContext.currentTime
   * @returns RadioObservationSnapshot
   */
  process(
    timeDomain: Float32Array,
    frequencyData: Uint8Array,
    audioTime: number,
  ): RadioObservationSnapshot {
    // ── 1. Signal analysis ──
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

    // ── 2. Update signal state (using AudioContext time, NOT Date.now) ──
    if (rms > 1e-4 && nonZeroRatio > 0.05) {
      if (this.lastSignificantSampleTime === 0) {
        this.signalPresentSince = audioTime;
      }
      this.lastSignificantSampleTime = audioTime;
    }

    const signalAgeSec = this.lastSignificantSampleTime > 0
      ? audioTime - this.lastSignificantSampleTime
      : -1;

    this.updateSignalState(rms, nonZeroRatio, signalAgeSec, audioTime, spectralEnergy);

    // ── 3. Band analysis for occupancy ──
    const binHz = this.config.sampleRate / this.config.fftSize;
    const lowEnd = Math.floor(250 / binHz);
    const midEnd = Math.floor(2500 / binHz);

    let lo = 0, mi = 0, hi = 0, loN = 0, miN = 0, hiN = 0;
    for (let i = 0; i < lowEnd && i < frequencyData.length; i += 2) { lo += frequencyData[i]; loN++; }
    for (let i = lowEnd; i < midEnd && i < frequencyData.length; i += 4) { mi += frequencyData[i]; miN++; }
    for (let i = midEnd; i < frequencyData.length; i += 8) { hi += frequencyData[i]; hiN++; }

    const lowEnergy = lo / (Math.max(1, loN) * 255);
    const midEnergy = mi / (Math.max(1, miN) * 255);
    const highEnergy = hi / (Math.max(1, hiN) * 255);

    // Occupancy: which roles is the radio filling?
    const kickTarget = lowEnergy > 0.5 ? lowEnergy : lowEnergy * 0.3;
    const bassTarget = lowEnergy > 0.5 ? lowEnergy : lowEnergy * 0.3;
    const leadTarget = midEnergy > 0.4 ? midEnergy * 0.8 : midEnergy * 0.2;
    const hatsTarget = highEnergy > 0.3 ? highEnergy * 0.7 : highEnergy * 0.2;

    this.occupancy.kick += (kickTarget - this.occupancy.kick) * (kickTarget > this.occupancy.kick ? 0.5 : 0.05);
    this.occupancy.bass += (bassTarget - this.occupancy.bass) * (bassTarget > this.occupancy.bass ? 0.3 : 0.05);
    this.occupancy.lead += (leadTarget - this.occupancy.lead) * (leadTarget > this.occupancy.lead ? 0.3 : 0.05);
    this.occupancy.hats += (hatsTarget - this.occupancy.hats) * (hatsTarget > this.occupancy.hats ? 0.3 : 0.05);

    // ── 4. Beat detection (only if signal present) ──
    let beatObservation: RadioBeatObservation | null = null;

    if (this.signalState === 'SIGNAL_PRESENT' || this.signalState === 'STABLE_SIGNAL') {
      // Sub-bass onset detection
      let sub = 0;
      for (let i = 0; i < 10; i++) sub += frequencyData[i];
      sub /= (10 * 255);

      // Track sub-bass history for onset detection
      if (!this._subBassHistory) this._subBassHistory = [];
      this._subBassHistory.push(sub);
      if (this._subBassHistory.length > 50) this._subBassHistory.shift();

      if (this._subBassHistory.length >= 10) {
        const startIdx = Math.max(0, this._subBassHistory.length - 20);
        let sum = 0, max = 0, count = 0;
        for (let i = startIdx; i < this._subBassHistory.length; i++) {
          const v = this._subBassHistory[i];
          sum += v; if (v > max) max = v; count++;
        }
        const avg = sum / count;
        const threshold = avg + (max - avg) * 0.55;
        const prev = this._subBassHistory[this._subBassHistory.length - 2] || 0;

        // Onset detected: sub-bass crossed threshold
        if (sub > threshold && prev <= threshold) {
          const candidate: BeatCandidate = {
            time: audioTime,
            subBassEnergy: sub,
            localAverage: avg,
            localMax: max,
            spectralEnergy,
          };
          beatObservation = this.beatEngine.processBeat(candidate);
        }
      }

      // Update observation state
      this.updateObservationState(audioTime);
    }

    // ── 5. Pitch observation (only if signal present and not kick-dominant) ──
    let pitchObservation: RadioPitchObservation | null = null;

    if (this.signalState === 'SIGNAL_PRESENT' || this.signalState === 'STABLE_SIGNAL') {
      if (this.occupancy.kick < 0.8) {
        const melodic = extractMelodicBand(frequencyData, this.config.sampleRate, this.config.fftSize);
        if (melodic.energy > 0.15 && melodic.peakValue > 0.3) {
          const flatness = spectralFlatness(frequencyData, this.config.sampleRate, this.config.fftSize);
          if (flatness < 0.5) {
            const pitch = estimatePitch(timeDomain, this.config.sampleRate, 80, 2000);
            if (pitch.frequency > 0 && pitch.confidence > 0.3) {
              const midi = Math.round(69 + 12 * Math.log2(pitch.frequency / 440));
              const exactMidi = 69 + 12 * Math.log2(pitch.frequency / 440);
              const cents = (exactMidi - midi) * 100;
              const pitchClass = ((midi % 12) + 12) % 12;
              const salience = melodic.peakValue / Math.max(0.01, melodic.energy);

              const confidence = Math.min(1,
                pitch.confidence * 0.5 +
                Math.min(1, salience / 3) * 0.3 +
                Math.min(1, melodic.energy * 2) * 0.2
              );

              if (confidence > 0.4) {
                const analysisLatency = this.config.fftSize / this.config.sampleRate / 2;
                const timestamp: RadioTimestamp = {
                  observedAt: audioTime,
                  estimatedAt: audioTime - analysisLatency,
                  predictedAt: audioTime - analysisLatency + 0.4, // ~1 beat at 150 BPM
                };

                pitchObservation = {
                  timestamp,
                  frequency: pitch.frequency,
                  midi,
                  pitchClass,
                  cents,
                  octaveError: 0, // YIN handles this
                  confidence,
                  noteDuration: 0.4, // approx
                  spectralEnergy: melodic.energy,
                  salience,
                };
              }
            }
          }
        }
      }
    }

    // ── 6. Build snapshot ──
    const signalSnapshot: RadioSignalSnapshot = {
      state: this.signalState,
      observationState: this.observationState,
      sampleRate: this.config.sampleRate,
      rms,
      peak,
      spectralEnergy,
      nonZeroRatio,
      signalAgeSec,
      timestamp: audioTime,
      reason: this.getSignalReason(rms, nonZeroRatio, signalAgeSec),
    };

    const snapshot: RadioObservationSnapshot = {
      signal: signalSnapshot,
      beat: beatObservation ?? this.beatEngine.getObservation(),
      pitch: pitchObservation,
      occupancy: { ...this.occupancy },
      timestamp: audioTime,
    };

    this.lastSnapshot = snapshot;
    return snapshot;
  }

  private _subBassHistory: number[] | null = null;

  // ── Signal state machine (F2.4) ──
  private updateSignalState(
    rms: number,
    nonZeroRatio: number,
    signalAgeSec: number,
    audioTime: number,
    _spectralEnergy: number,
  ): void {
    if (this.signalState === 'DISCONNECTED' || this.signalState === 'CONNECTING') {
      // Don't override until connected
      return;
    }

    if (this.signalState === 'ERROR') return;

    // Check for signal loss
    if (signalAgeSec > this.config.lostSignalTimeoutSec) {
      this.signalState = 'LOST';
      this.observationState = 'LOST';
      return;
    }

    // Classify signal level
    if (rms < 1e-5 && nonZeroRatio < 0.02) {
      this.signalState = 'NO_SIGNAL';
      this.observationState = 'NO_SIGNAL';
    } else if (rms < 1e-4 || nonZeroRatio < 0.05) {
      this.signalState = 'WEAK_SIGNAL';
    } else {
      // Signal present — check if stable
      if (this.signalState !== 'STABLE_SIGNAL' && this.signalPresentSince > 0) {
        const durationStable = audioTime - this.signalPresentSince;
        if (durationStable > this.config.stableSignalDurationSec) {
          this.signalState = 'STABLE_SIGNAL';
        } else {
          this.signalState = 'SIGNAL_PRESENT';
        }
      } else if (this.signalState !== 'STABLE_SIGNAL') {
        this.signalState = 'SIGNAL_PRESENT';
      }
    }
  }

  private updateObservationState(audioTime: number): void {
    const beatObs = this.beatEngine.getObservation();

    if (!beatObs) {
      this.observationState = 'SIGNAL_PRESENT';
      return;
    }

    if (this.signalState === 'LOST' || this.signalState === 'NO_SIGNAL') {
      this.observationState = 'LOST';
      return;
    }

    if (this.beatEngine.isDegraded()) {
      this.observationState = 'DEGRADED';
      return;
    }

    if (beatObs.locked && this.signalState === 'STABLE_SIGNAL') {
      this.observationState = 'FOLLOWING';
    } else if (beatObs.observationCount >= 1) {
      this.observationState = 'LOCKING';
    } else {
      this.observationState = 'SIGNAL_PRESENT';
    }
  }

  private getSignalReason(rms: number, nonZeroRatio: number, signalAgeSec: number): string {
    if (this.signalState === 'STABLE_SIGNAL') return `stable signal rms=${rms.toFixed(4)} age=${signalAgeSec.toFixed(1)}s`;
    if (this.signalState === 'SIGNAL_PRESENT') return `signal present rms=${rms.toFixed(4)}`;
    if (this.signalState === 'WEAK_SIGNAL') return `weak signal rms=${rms.toFixed(5)}`;
    if (this.signalState === 'NO_SIGNAL') return `no signal rms=${rms.toFixed(6)}`;
    if (this.signalState === 'LOST') return `signal lost age=${signalAgeSec.toFixed(1)}s`;
    return this.signalState;
  }

  // ── Public API ──

  markConnected(): void {
    this.signalState = 'NO_SIGNAL';
  }

  markConnecting(): void {
    this.signalState = 'CONNECTING';
  }

  markError(): void {
    this.signalState = 'ERROR';
  }

  reset(): void {
    this.signalState = 'DISCONNECTED';
    this.observationState = 'NO_SIGNAL';
    this.signalPresentSince = 0;
    this.lastSignificantSampleTime = 0;
    this.beatEngine.reset();
    this.occupancy = { kick: 0, bass: 0, lead: 0, hats: 0 };
    this._subBassHistory = null;
  }

  getSignalState(): RadioSignalState { return this.signalState; }
  getObservationState(): RadioObservationState { return this.observationState; }
  getBeatEngine(): BeatObservationEngine { return this.beatEngine; }
  getSnapshot(): RadioObservationSnapshot | null { return this.lastSnapshot; }
  getOccupancy() { return { ...this.occupancy }; }
}
