/**
 * LoopLearner — שלב 5: למידה מלופים (קבצי אודיו).
 *
 * מאפשר העלאת קובץ אודיו (MP3/WAV/OGG) ולמידה ממנו בלופ.
 * הקובץ מתנגן ברקע, ה-onset analyzer מזהה onsets, וה-learning
 * פועל בדיוק כמו עם רדיו — אבל על קובץ שהמשתמש בחר.
 *
 * תיקון P0: שומר את ה-radioAnalyser המקורי ומשחזר אותו ב-stop.
 * תיקון P0: מנקה blob URL למניעת דליפת זיכרון.
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
  private blobUrl: string | null = null;

  // תיקון P0: שמירת ה-state המקורי של psyLive לשחזור
  private savedRadioAnalyser: AnalyserNode | null = null;
  private savedRadioOn: boolean = false;
  private savedSyncStatus: string = 'idle';

  constructor(psyLive: PsyLive) {
    this.psyLive = psyLive;
  }

  /**
   * טוען קובץ אודיו ומתחיל לנגן אותו בלולאה.
   */
  async loadFile(file: File): Promise<boolean> {
    const ctx = (this.psyLive as any).ctx as AudioContext;
    if (!ctx) {
      console.error('[PSY4] LoopLearner: no AudioContext');
      return false;
    }

    // נקה קודם
    this.stop();

    // תיקון P0: אם רדיו מחובר, נתק אותו קודם כדי למנוע התנגשות
    const pl = this.psyLive as any;
    if (pl.radioOn) {
      console.log('[PSY4] LoopLearner: disconnecting radio first (avoid conflict)');
      pl.disconnectRadio();
    }

    // צור URL לקובץ (תיקון P0: שמור לניקוי)
    this.blobUrl = URL.createObjectURL(file);
    console.log(`[PSY4] LoopLearner: loading file "${file.name}" (${(file.size / 1024).toFixed(0)}KB)`);

    // צור Audio element
    this.audioEl = new Audio();
    this.audioEl.src = this.blobUrl;
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
      this.cleanup();
      return false;
    }

    // התחל נגינה
    try {
      await this.audioEl.play();
      this.isActive = true;
      console.log(`[PSY4] LoopLearner: playing "${file.name}" in loop mode`);
      this.connectToLearning();
      return true;
    } catch (e: any) {
      if (e && e.name === 'NotSupportedError') {
        console.error(`[PSY4] LoopLearner: file format not supported — "${file.name}" (${file.type})`);
        this.cleanup();
        return false;
      }
      if (e && e.name === 'AbortError') {
        console.warn('[PSY4] LoopLearner: playback aborted');
        this.cleanup();
        return false;
      }
      console.error('[PSY4] LoopLearner: play() failed:', e);
      this.cleanup();
      return false;
    }
  }

  /**
   * מחבר את ה-analyser של ה-loop ל-psyLive's detection system.
   * תיקון P0: שומר את ה-state המקורי לשחזור.
   */
  private connectToLearning(): void {
    const pl = this.psyLive as any;
    if (!this.analyser) return;

    // תיקון P0: שמור את ה-state המקורי לפני דריסה
    this.savedRadioAnalyser = pl.radioAnalyser;
    this.savedRadioOn = pl.radioOn;
    this.savedSyncStatus = pl.syncStatus;

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

    console.log('[PSY4] LoopLearner: connected to learning system (saved original state)');
  }

  /**
   * תיקון P0: משחזר את ה-state המקורי של psyLive.
   */
  private restoreOriginalState(): void {
    const pl = this.psyLive as any;
    // שחזר את ה-analyser המקורי
    pl.radioAnalyser = this.savedRadioAnalyser;
    pl.radioOn = this.savedRadioOn;
    pl.syncStatus = this.savedSyncStatus;

    // אם רדיו לא היה מחובר מקורית, עצור detection
    if (!this.savedRadioOn) {
      pl.radioOn = false;
      pl.syncStatus = 'idle';
      if (pl.detectTimer) {
        pl.stopDetection();
      }
      if (pl.explorationTimer) {
        pl.stopAutoExploration();
      }
    }
    console.log('[PSY4] LoopLearner: restored original state');
  }

  /**
   * ניקוי משאבים פנימי.
   */
  private cleanup(): void {
    if (this.audioEl) {
      try { this.audioEl.pause(); } catch {}
      try { this.audioEl.src = ''; } catch {}
      this.audioEl = null;
    }
    if (this.sourceNode) { try { this.sourceNode.disconnect(); } catch {} this.sourceNode = null; }
    if (this.gainNode) { try { this.gainNode.disconnect(); } catch {} this.gainNode = null; }
    if (this.analyser) { try { this.analyser.disconnect(); } catch {} this.analyser = null; }
    // תיקון P0: נקה blob URL
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    this.isActive = false;
  }

  /**
   * עצירת הלופ וניתוק.
   * תיקון P0: משחזר את ה-state המקורי.
   */
  stop(): void {
    if (this.isActive) {
      this.restoreOriginalState();
    }
    this.cleanup();
    console.log('[PSY4] LoopLearner: stopped');
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume;
    }
  }

  setLoop(enabled: boolean): void {
    this.loopEnabled = enabled;
    if (this.audioEl) {
      this.audioEl.loop = enabled;
    }
  }

  seek(ratio: number): void {
    if (this.audioEl && this.audioEl.duration) {
      this.audioEl.currentTime = ratio * this.audioEl.duration;
    }
  }

  isRunning(): boolean {
    return this.isActive;
  }

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
