/**
 * OnsetAnalyzer — שלב 4.1: Per-onset sound analysis.
 *
 * מזהה onsets (transient spikes) בזרם הרדיו, ולכל onset מחלץ SoundDNA מלא
 * ומסווג אותו ל-role (kick/bass/lead/hat/perc).
 *
 * אלגוריתם:
 * 1. Onset detection: spectral flux — סכום שינויי אנרגיה חיוביים בין FFT bins עוקבים
 * 2. Cooldown: לפחות 80ms בין onsets (כדי לא לזהות את אותו onset פעמיים)
 * 3. SoundDNA extraction: 30ms אחרי ה-onset, חישוב features מלאים מ-FFT + time-domain
 * 4. Classification: לפי תדר דומיננטי + transient sharpness + centroid
 * 5. Ring buffer: 32 onsets אחרונים per role
 */

import { type SoundDNA } from '../../foundation/music/SoundDNA';
import { extractSpectralFeatures } from '../../foundation/music/MusicalObservation';

export type OnsetRole = 'kick' | 'bass' | 'lead' | 'hat' | 'perc' | 'pad' | 'acid' | 'clap' | 'shaker' | 'texture';

export interface OnsetEvent {
  readonly time: number;          // AudioContext.currentTime של ה-onset
  readonly role: OnsetRole;
  readonly soundDNA: SoundDNA;
  readonly strength: number;      // 0..1 (כמה חזק היה ה-onset)
}

const ROLE_RING_SIZE = 32;
const ONSET_COOLDOWN_SEC = 0.080; // 80ms בין onsets
const SPECTRAL_FLUX_THRESHOLD = 2.5; // יחסי ל-rolling average
const ROLLING_AVG_ALPHA = 0.05;   // EMA smoothing ל-rolling baseline

export class OnsetAnalyzer {
  private ringBuffer: Map<OnsetRole, OnsetEvent[]> = new Map();
  private lastOnsetTime = -1;
  private rollingFlux = 0;        // EMA של spectral flux ל-baseline
  private prevSpectrum: Float32Array | null = null; // FFT קודם לחישוב flux
  private totalOnsets = 0;

  constructor() {
    for (const role of ['kick', 'bass', 'lead', 'hat', 'perc'] as OnsetRole[]) {
      this.ringBuffer.set(role, []);
    }
  }

  /**
   * מעבד חלון FFT אחד. אם זוהה onset, מחזיר OnsetEvent.
   * יחזיר null אם אין onset או ב-cooldown.
   */
  process(
    tdBuf: Float32Array,
    fd: Uint8Array,
    audioTime: number,
    sampleRate: number,
    fftSize: number,
  ): OnsetEvent | null {
    // ── 1. Spectral flux: סכום שינויי אנרגיה חיוביים ──
    const n = fd.length;
    let flux = 0;
    if (this.prevSpectrum) {
      for (let i = 0; i < n; i++) {
        const cur = fd[i] / 255;
        const prev = this.prevSpectrum[i];
        const diff = cur - prev;
        if (diff > 0) flux += diff; // רק עליות (onsets)
      }
    }
    // שמור spectrum נוכחי לחישוב הבא (עותק — fd ישתנה בחלון הבא)
    if (!this.prevSpectrum || this.prevSpectrum.length !== n) {
      this.prevSpectrum = new Float32Array(n);
    }
    for (let i = 0; i < n; i++) this.prevSpectrum[i] = fd[i] / 255;

    // ── 2. עדכן rolling baseline (EMA) ──
    this.rollingFlux = this.rollingFlux * (1 - ROLLING_AVG_ALPHA) + flux * ROLLING_AVG_ALPHA;

    // ── 3. בדוק cooldown ──
    if (this.lastOnsetTime > 0 && audioTime - this.lastOnsetTime < ONSET_COOLDOWN_SEC) {
      return null;
    }

    // ── 4. בדוק threshold: flux הנוכחי חייב להיות גבוה מ-rolling × threshold ──
    // גם צריך להיות מעל מינימום מוחלט (כדי לא לזהות onsets ב-silence)
    const minFlux = 0.5;
    if (flux < minFlux) return null;
    const threshold = Math.max(this.rollingFlux * SPECTRAL_FLUX_THRESHOLD, minFlux * 1.5);
    if (flux < threshold) return null;

    // ── 5. חלץ SoundDNA מהחלון הנוכחי ──
    const soundDNA = this.extractSoundDNA(tdBuf, fd, sampleRate, fftSize);
    const strength = Math.min(1, flux / (threshold * 2));

    // ── 6. סווג role ──
    const role = this.classifyRole(soundDNA);

    // ── 7. צור OnsetEvent ושמור ל-ring buffer ──
    const event: OnsetEvent = {
      time: audioTime,
      role,
      soundDNA,
      strength,
    };
    const ring = this.ringBuffer.get(role)!;
    ring.push(event);
    if (ring.length > ROLE_RING_SIZE) ring.shift();
    this.lastOnsetTime = audioTime;
    this.totalOnsets++;

    return event;
  }

  /**
   * חילוץ SoundDNA מלא מחלון נוכחי.
   * משלב features מ-FFT (ספקטרליים) ומ-time-domain (transient/dynamics).
   */
  private extractSoundDNA(
    tdBuf: Float32Array,
    fd: Uint8Array,
    sampleRate: number,
    fftSize: number,
  ): SoundDNA {
    const spec = extractSpectralFeatures(fd, sampleRate, fftSize);

    // ── ספקטרליים ──
    const brightness = Math.max(0, Math.min(1, spec.centroid / 8000));
    const noisiness = Math.max(0, Math.min(1, spec.flatness));
    const harmonicity = 1 - noisiness;
    const spectralSlope = -0.5 - brightness * 0.3; // heuristic
    const roughness = noisiness * 0.5; // heuristic

    // ── אנרגיה per-band (מ-norm) ──
    const subEnergy = Math.max(0, Math.min(1, spec.low));
    const bodyEnergy = Math.max(0, Math.min(1, spec.low * 0.7));
    const midEnergy = Math.max(0, Math.min(1, spec.mid));
    const highEnergy = Math.max(0, Math.min(1, spec.high));

    // ── Transient מ-time-domain ──
    // חשב peak amplitude ו-RMS
    let peak = 0;
    let sumSq = 0;
    for (let i = 0; i < tdBuf.length; i++) {
      const v = Math.abs(tdBuf[i]);
      if (v > peak) peak = v;
      sumSq += tdBuf[i] * tdBuf[i];
    }
    const rms = Math.sqrt(sumSq / tdBuf.length);
    // transient sharpness = כמה מהר האנרגיה עולה
    // חלק את החלון ל-4 רבעים, חשב RMS per quarter, חשב slope של הרבע הראשון
    const quarterLen = Math.floor(tdBuf.length / 4);
    let q1SumSq = 0, q2SumSq = 0, q3SumSq = 0, q4SumSq = 0;
    for (let i = 0; i < quarterLen; i++) q1SumSq += tdBuf[i] * tdBuf[i];
    for (let i = quarterLen; i < 2 * quarterLen; i++) q2SumSq += tdBuf[i] * tdBuf[i];
    for (let i = 2 * quarterLen; i < 3 * quarterLen; i++) q3SumSq += tdBuf[i] * tdBuf[i];
    for (let i = 3 * quarterLen; i < 4 * quarterLen; i++) q4SumSq += tdBuf[i] * tdBuf[i];
    const q1Rms = Math.sqrt(q1SumSq / quarterLen);
    const q2Rms = Math.sqrt(q2SumSq / quarterLen);
    const q3Rms = Math.sqrt(q3SumSq / quarterLen);
    const q4Rms = Math.sqrt(q4SumSq / quarterLen);
    const peakRms = Math.max(q1Rms, q2Rms, q3Rms, q4Rms);
    // transient sharpness: כמה העלייה לשיא הייתה מהירה (0=איטית, 1=מיידית)
    // אם q1 או q2 הם השיא → sharp (עלייה מהירה)
    // אם q3 או q4 הם השיא → smooth (עלייה איטית)
    let transientSharpness: number;
    if (peakRms < 1e-6) {
      transientSharpness = 0;
    } else {
      const peakIdx = [q1Rms, q2Rms, q3Rms, q4Rms].indexOf(peakRms);
      // peakIdx 0 = הכי חד (1.0), 3 = הכי חלק (0.25)
      transientSharpness = 1.0 - peakIdx * 0.25;
    }
    // attack time: אם transient חד → attack מהיר (~1ms), אחרת איטי
    const attackTime = 0.001 + (1 - transientSharpness) * 0.02;
    // decay: כמה מהר יורד אחרי השיא
    let decayTime: number;
    if (peakRms < 1e-6) {
      decayTime = 0.1;
    } else {
      // מצא את הרבע שבו האנרגיה יורדת ל-10% מהשיא
      const threshold10 = peakRms * 0.316; // sqrt(0.1)
      let decayQuarter = 3; // default: כל החלון
      if (q3Rms < threshold10) decayQuarter = 2;
      if (q2Rms < threshold10) decayQuarter = 1;
      decayTime = (decayQuarter + 1) * (quarterLen / sampleRate);
    }
    const sustainLevel = peakRms > 1e-6 ? Math.min(1, q4Rms / peakRms) : 0;
    const releaseTime = 0.05 + (1 - transientSharpness) * 0.2;

    // ── Saturation/distortion (heuristic מ-noisiness + peak) ──
    const saturation = Math.max(0, Math.min(1, noisiness * 0.6 + (peak > 0.9 ? 0.3 : 0)));
    const distortionCharacter = noisiness;

    // ── Filter (defaults — יוגדרו ב-synthesis matching) ──
    const filterCutoff = 0; // computed later
    const filterResonance = 0;
    const filterType: SoundDNA['filterType'] = 'lowpass';
    const filterEnvelopeAmount = 0.3;

    // ── Pitch/modulation (defaults) ──
    const pitchModulation = 0;
    const fmAmount = 0;
    const detune = 0;

    // ── Stereo (לא זמין — radioAnalyser הוא mono) ──
    const stereoWidth = 0;
    const stereoMotion = 0;

    return {
      role: 'fx', // יוחלף על-ידי classifyRole
      brightness,
      harmonicity,
      noisiness,
      spectralSlope,
      roughness,
      subEnergy,
      bodyEnergy,
      midEnergy,
      highEnergy,
      transientSharpness,
      attackTime,
      decayTime,
      sustainLevel,
      releaseTime,
      saturation,
      distortionCharacter,
      filterCutoff,
      filterResonance,
      filterType,
      filterEnvelopeAmount,
      pitchModulation,
      fmAmount,
      detune,
      stereoWidth,
      stereoMotion,
      confidence: Math.min(1, peak * 2), // confidence מבוסס על peak amplitude
      usageCount: 0,
      reward: 0.5,
      sourceStyle: '',
      sourceContext: '',
    };
  }

  /**
   * סיווג role לפי SoundDNA.
   * כללים:
   * - kick: subEnergy דומיננטי + transientSharpness גבוה + centroid < 300Hz
   * - bass: subEnergy/bodyEnergy דומיננטי + transientSharpness נמוך + centroid 100-400Hz
   * - lead: midEnergy דומיננטי + centroid 500-3000Hz
   * - hat: highEnergy דומיננטי + transientSharpness גבוה מאוד + centroid > 5000Hz
   * - perc: mid+high + transientSharpness גבוה + centroid 2000-5000Hz
   *
   * תיקון: כשהרדיו מנגן מיקס מלא, ה-centroid תמיד גבוה. לכן אם subEnergy גבוה
   * מאוד (>0.7), ה-onset הוא כנראה kick/bass — לא hat — למרות centroid גבוה.
   */
  private classifyRole(dna: SoundDNA): OnsetRole {
    const centroidHz = dna.brightness * 8000;

    // EARLY EXIT: אם subEnergy גבוה מאוד, זה kick או bass — לא hat/perc
    if (dna.subEnergy > 0.7) {
      // kick אם transient חד, bass אם חלק
      return dna.transientSharpness > 0.6 ? 'kick' : 'bass';
    }

    // דירוג per-role — הכי גבוה מנצח
    const scores: Record<OnsetRole, number> = {
      kick: 0,
      bass: 0,
      lead: 0,
      hat: 0,
      perc: 0,
      acid: 0,
      pad: 0,
      clap: 0,
      shaker: 0,
      texture: 0,
    };

    // KICK: sub דומיננטי + sharp transient + low centroid
    scores.kick =
      dna.subEnergy * 1.5 +
      dna.transientSharpness * 0.8 +
      (centroidHz < 300 ? 1.0 : Math.max(0, 1 - (centroidHz - 300) / 500)) * 1.2;

    // BASS: sub+body דומיננטי אבל transient נמוך
    scores.bass =
      (dna.subEnergy + dna.bodyEnergy) * 1.0 +
      (1 - dna.transientSharpness) * 0.6 +
      (centroidHz >= 80 && centroidHz < 500 ? 0.8 : 0);

    // LEAD: mid דומיננטי
    scores.lead =
      dna.midEnergy * 1.5 +
      (centroidHz >= 500 && centroidHz < 3500 ? 0.8 : 0) +
      dna.harmonicity * 0.4;

    // HAT: high דומיננטי + very sharp
    scores.hat =
      dna.highEnergy * 1.8 +
      dna.transientSharpness * 0.6 +
      (centroidHz > 5000 ? 0.8 : 0) +
      dna.noisiness * 0.5;

    // PERC: mid+high + sharp transient
    scores.perc =
      (dna.midEnergy + dna.highEnergy) * 0.8 +
      dna.transientSharpness * 0.8 +
      (centroidHz >= 2000 && centroidHz < 5500 ? 0.8 : 0);

    // בחר את ה-role עם הציון הגבוה ביותר
    let bestRole: OnsetRole = 'perc';
    let bestScore = -1;
    for (const role of ['kick', 'bass', 'lead', 'hat', 'perc'] as OnsetRole[]) {
      if (scores[role] > bestScore) {
        bestScore = scores[role];
        bestRole = role;
      }
    }
    return bestRole;
  }

  // ── Public accessors ──

  getOnsets(role: OnsetRole): OnsetEvent[] {
    return this.ringBuffer.get(role) ?? [];
  }

  getTotalOnsets(): number {
    return this.totalOnsets;
  }

  /** מחזיר את ה-onset האחרון של role מסוים, או null */
  getLatestOnset(role: OnsetRole): OnsetEvent | null {
    const ring = this.ringBuffer.get(role);
    if (!ring || ring.length === 0) return null;
    return ring[ring.length - 1];
  }

  /** מספר onsets per role (ל-UI) */
  getOnsetCounts(): Record<OnsetRole, number> {
    return {
      kick: this.ringBuffer.get('kick')!.length,
      bass: this.ringBuffer.get('bass')!.length,
      lead: this.ringBuffer.get('lead')!.length,
      hat: this.ringBuffer.get('hat')!.length,
      perc: this.ringBuffer.get('perc')!.length,
      acid: this.ringBuffer.get('acid')?.length ?? 0,
      pad: this.ringBuffer.get('pad')?.length ?? 0,
      clap: this.ringBuffer.get('clap')?.length ?? 0,
      shaker: this.ringBuffer.get('shaker')?.length ?? 0,
      texture: this.ringBuffer.get('texture')?.length ?? 0,
    };
  }

  reset(): void {
    for (const role of ['kick', 'bass', 'lead', 'hat', 'perc'] as OnsetRole[]) {
      this.ringBuffer.get(role)!.length = 0;
    }
    this.lastOnsetTime = -1;
    this.rollingFlux = 0;
    this.prevSpectrum = null;
    this.totalOnsets = 0;
  }
}
