/**
 * QualityAnalyzer — מודד איכות אודיו מתוך AnalyserNode.
 *
 * מודד 5 מדדי איכות:
 * 1. spectralBalance — עד כמה הספקטרום מאוזן (לא חזק מדי באף תדר)
 * 2. dynamicRange — טווח דינמי (crest factor)
 * 3. stereoWidth — רוחב סטריאו (M/S)
 * 4. transientSharpness — חדות transients
 * 5. lowEndClarity — ניקיון ה-low end (אין mud)
 *
 * compositeScore: ממוצע משוקלל — משמש ל-reward במקום "יש אודיו"
 */

export interface QualityMetrics {
  spectralBalance: number;   // 0-1, 1=מאוזן
  dynamicRange: number;      // 0-1, 1=דינמי
  stereoWidth: number;       // 0-1, 1=רחב
  transientSharpness: number; // 0-1, 1=חד
  lowEndClarity: number;     // 0-1, 1=נקי
}

export class QualityAnalyzer {
  private freqBuf: Uint8Array;
  private timeBuf: Float32Array;
  private prevPeaks: number[] = [];
  private readonly HISTORY_SIZE = 20;

  constructor(fftSize: number = 512) {
    this.freqBuf = new Uint8Array(fftSize / 2);
    this.timeBuf = new Float32Array(fftSize);
  }

  /**
   * מודד איכות מ-AnalyserNode.
   * מקבל analyser + אופציונלי analyserR (לסטריאו).
   */
  measure(analyserL: AnalyserNode, analyserR?: AnalyserNode | null): QualityMetrics {
    analyserL.getByteFrequencyData(this.freqBuf as Uint8Array<ArrayBuffer>);
    analyserL.getFloatTimeDomainData(this.timeBuf as Float32Array<ArrayBuffer>);

    return {
      spectralBalance: this.spectralBalance(this.freqBuf),
      dynamicRange: this.dynamicRange(this.timeBuf),
      stereoWidth: analyserR ? this.stereoWidth(analyserL, analyserR) : 0.5,
      transientSharpness: this.transientSharpness(this.timeBuf),
      lowEndClarity: this.lowEndClarity(this.freqBuf),
    };
  }

  /**
   * ציון משוקלל 0-1. משמש ל-reward.
   */
  compositeScore(metrics: QualityMetrics): number {
    return (
      metrics.spectralBalance * 0.25 +
      metrics.dynamicRange * 0.20 +
      metrics.stereoWidth * 0.15 +
      metrics.transientSharpness * 0.20 +
      metrics.lowEndClarity * 0.20
    );
  }

  /**
   * איזון ספקטרלי — מודד עד כמה האנרגיה מפוזרת באופן שווה.
   * מחלק ל-6 באנדים, מחשב סטיית תקן, מנרמל.
   * 1 = מאוזן, 0 = חזק מדי בבאנד אחד.
   */
  private spectralBalance(fd: Uint8Array): number {
    const numBands = 6;
    const bandSize = Math.floor(fd.length / numBands);
    const bandEnergies: number[] = [];
    for (let b = 0; b < numBands; b++) {
      let sum = 0;
      for (let i = b * bandSize; i < (b + 1) * bandSize; i++) sum += fd[i];
      bandEnergies.push(sum / bandSize / 255);  // normalize 0-1
    }
    // סטיית תקן — נמוכה = מאוזן
    const mean = bandEnergies.reduce((a, b) => a + b, 0) / numBands;
    const variance = bandEnergies.reduce((a, b) => a + (b - mean) ** 2, 0) / numBands;
    const std = Math.sqrt(variance);
    // נרמול: std 0 = score 1, std 0.3 = score 0
    return Math.max(0, Math.min(1, 1 - std / 0.3));
  }

  /**
   * טווח דינמי — crest factor (peak/RMS).
   * גבוה = דינמי (טוב), נמוך = דחוס (מוגזם).
   */
  private dynamicRange(td: Float32Array): number {
    let peak = 0, sumSq = 0;
    for (let i = 0; i < td.length; i++) {
      const v = td[i];
      const abs = Math.abs(v);
      if (abs > peak) peak = abs;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / td.length);
    if (rms < 0.001) return 0;
    const crest = peak / rms;
    // crest 1 = מקסימלי דחוס, crest 4+ = דינמי
    return Math.max(0, Math.min(1, (crest - 1) / 3));
  }

  /**
   * רוחב סטריאו — יחס side/mid.
   * 0 = mono, 1 = wide.
   */
  private stereoWidth(analyserL: AnalyserNode, analyserR: AnalyserNode): number {
    const bufL = new Float32Array(analyserL.fftSize);
    const bufR = new Float32Array(analyserR.fftSize);
    analyserL.getFloatTimeDomainData(bufL as Float32Array<ArrayBuffer>);
    analyserR.getFloatTimeDomainData(bufR as Float32Array<ArrayBuffer>);
    let midEnergy = 0, sideEnergy = 0;
    const len = Math.min(bufL.length, bufR.length);
    for (let i = 0; i < len; i++) {
      const mid = (bufL[i] + bufR[i]) * 0.5;
      const side = (bufL[i] - bufR[i]) * 0.5;
      midEnergy += mid * mid;
      sideEnergy += side * side;
    }
    if (midEnergy < 0.001) return 0;
    const ratio = Math.sqrt(sideEnergy / midEnergy);
    return Math.max(0, Math.min(1, ratio * 2));
  }

  /**
   * חדות transients — מודד שינויים מהירים ב-amplitude.
   * גבוה = transients חדים (טוב), נמוך = חלק (חסר הגדרה).
   */
  private transientSharpness(td: Float32Array): number {
    // מחשב envelope דרך absolute value
    let totalChange = 0;
    let prevAbs = Math.abs(td[0]);
    for (let i = 1; i < td.length; i++) {
      const abs = Math.abs(td[i]);
      totalChange += Math.abs(abs - prevAbs);
      prevAbs = abs;
    }
    const avgChange = totalChange / td.length;
    // נרמול: avgChange 0.05+ = חד מאוד
    return Math.max(0, Math.min(1, avgChange / 0.05));
  }

  /**
   * ניקיון low end — בודק שאין יותר מדי אנרגיה ב-30-80Hz (mud).
   * 1 = נקי, 0 = muddy.
   */
  private lowEndClarity(fd: Uint8Array): number {
    // bin 0 = 0-86Hz (ב-fftSize 512, sr 44100, binWidth=86)
    // אם bin 0 חזק מאוד יחסית ל-bin 1+2, יש mud
    const subEnergy = fd[0] / 255;
    const bodyEnergy = ((fd[1] || 0) + (fd[2] || 0)) / 2 / 255;
    if (bodyEnergy < 0.01) return 0.5;  // אין מספיק אודיו
    const ratio = subEnergy / bodyEnergy;
    // ratio 1 = מאוזן, ratio 2+ = muddy
    return Math.max(0, Math.min(1, 2 - ratio));
  }
}
