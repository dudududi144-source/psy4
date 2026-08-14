/**
 * LoopLearner — שלב 5: למידה מלופים (קבצי אודיו).
 *
 * מאפשר העלאת קובץ אודיו (MP3/WAV/OGG) ולמידה ממנו בלופ.
 * הקובץ מתנגן ברקע, ה-onset analyzer מזהה onsets, וה-learning
 * פועל בדיוק כמו עם רדיו — אבל על קובץ שהמשתמש בחר.
 *
 * שימוש: המשתמש מעלה קובץ (למשל לופ שהוריד מ-YouTube),
 * המערכת מנגנת אותו בלולאה, ולומדת ממנו.
 */

import { PsyLive } from './psyLive';

export class LoopLearner {
  private psyLive: PsyLive;
  private audioEl: HTMLAudioElement | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private isActive = false;
  private loopEnabled = true;
  private volume = 0.5;

  constructor(psyLive: PsyLive) {
    this.psyLive = psyLive;
  }

  /**
   * טוען קובץ אודיו ומתחיל לנגן אותו בלולאה.
   * מחבר ל-analyser כדי שה-learning יוכל לזהות onsets.
   */
  async loadFile(file: File): Promise<boolean> {
    const ctx = (this.psyLive as any).ctx as AudioContext;
    if (!ctx) {
      console.error('[PSY4] LoopLearner: no AudioContext');
      return false;
    }

    // נקה קודם
    this.stop();

    // צור URL לקובץ
    const url = URL.createObjectURL(file);
    console.log(`[PSY4] LoopLearner: loading file "${file.name}" (${(file.size / 1024).toFixed(0)}KB)`);

    // צור Audio element
    this.audioEl = new Audio();
    this.audioEl.src = url;
    this.audioEl.loop = this.loopEnabled;
    this.audioEl.crossOrigin = 'anonymous';

    // חבר ל-AudioContext
    try {
      this.sourceNode = ctx.createMediaElementSource(this.audioEl);
      this.gainNode = ctx.createGain();
      this.gainNode.gain.value = this.volume;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.2;

      // source → gain → analyser → destination (שמיעה)
      this.sourceNode.connect(this.gainNode);
      this.gainNode.connect(this.analyser);
      this.analyser.connect(ctx.destination);
    } catch (e) {
      console.error('[PSY4] LoopLearner: failed to connect audio:', e);
      return false;
    }

    // התחל נגינה
    try {
      await this.audioEl.play();
      this.isActive = true;
      console.log(`[PSY4] LoopLearner: playing "${file.name}" in loop mode`);

      // חבר את ה-analyser ל-psyLive כדי שה-learning יפעל
      this.connectToLearning();

      return true;
    } catch (e) {
      console.error('[PSY4] LoopLearner: play() failed:', e);
      return false;
    }
  }

  /**
   * מחבר את ה-analyser של ה-loop ל-psyLive's detection system.
   * מחליף זמנית את ה-radio analyser.
   */
  private connectToLearning(): void {
    const pl = this.psyLive as any;
    // שמור את ה-analyser המקורי
    if (!this.analyser) return;

    // החלף את radioAnalyser ב-loop analyser
    pl.radioAnalyser = this.analyser;
    pl.radioOn = true;
    pl.syncStatus = 'following';

    // ודא ש-buffers מותאמים
    const fftSize = this.analyser.fftSize;
    const binCount = this.analyser.frequencyBinCount;
    if (!pl.radioFreqBuf || pl.radioFreqBuf.length !== binCount) {
      pl.radioFreqBuf = new Uint8Array(binCount);
    }
    if (!pl.radioTdBuf || pl.radioTdBuf.length !== fftSize) {
      pl.radioTdBuf = new Float32Array(fftSize);
    }

    // התחל detection אם לא רץ
    if (!pl.detectTimer) {
      pl.startDetection();
    }
    // התחל exploration
    if (!pl.explorationTimer) {
      pl.startAutoExploration();
    }

    console.log('[PSY4] LoopLearner: connected to learning system');
  }

  /**
   * עצירת הלופ וניתוק.
   */
  stop(): void {
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.src = '';
      this.audioEl = null;
    }
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch {}
      this.sourceNode = null;
    }
    if (this.gainNode) {
      try { this.gainNode.disconnect(); } catch {}
      this.gainNode = null;
    }
    if (this.analyser) {
      try { this.analyser.disconnect(); } catch {}
      this.analyser = null;
    }
    this.isActive = false;
    console.log('[PSY4] LoopLearner: stopped');
  }

  /**
   * קובע עוצמת שמע.
   */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume;
    }
  }

  /**
   * מפעיל/מכבה לולאה.
   */
  setLoop(enabled: boolean): void {
    this.loopEnabled = enabled;
    if (this.audioEl) {
      this.audioEl.loop = enabled;
    }
  }

  /**
   * דילוג למיקום (0..1).
   */
  seek(ratio: number): void {
    if (this.audioEl && this.audioEl.duration) {
      this.audioEl.currentTime = ratio * this.audioEl.duration;
    }
  }

  /**
   * האם פעיל.
   */
  isRunning(): boolean {
    return this.isActive;
  }

  /**
   * מידע על הקובץ הנוכחי.
   */
  getInfo(): { name: string; duration: number; currentTime: number; looping: boolean } | null {
    if (!this.audioEl) return null;
    return {
      name: this.audioEl.src || '',
      duration: this.audioEl.duration || 0,
      currentTime: this.audioEl.currentTime || 0,
      looping: this.audioEl.loop,
    };
  }
}
