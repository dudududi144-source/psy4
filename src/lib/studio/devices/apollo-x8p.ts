/**
 * Universal Audio Apollo x8p twin — "Apollo-V".
 * Audio interface / studio hub: sums all inputs, applies console routing,
 * insert loop to H90, monitoring, and the resampling bus to Digitakt.
 * REAL IMPLEMENTATION (summing + routing + insert loop + master print chain).
 * EXTERNAL HARDWARE REQUIREMENT: real Universal Audio Apollo x8p.
 */

import { Transport } from '../clock';
import { Limiter } from '../dsp/effects';
import { OnePole, DCBlocker } from '../dsp/filter';
import { StereoEngine, StereoProfile } from '../dsp/stereoEngine';
import { SpaceEngine, SpaceType } from '../dsp/spaceEngine';

export interface ChannelStrip {
  name: string;
  /** Gain in dB. */
  gain: number;
  pan: number;
  /** Send level to H90 FX insert. */
  fxSend: number;
  mute: boolean;
  solo: boolean;
  /** Peak meter. */
  peak: number;
}

export class ApolloDevice {
  id = 'apollo';
  name = 'Universal Audio Apollo (Apollo-V)';
  producesAudio = false;
  consumesAudio = true;

  private sr: number;
  /** 8 input channels, each stereo (L/R) buffers per block. */
  channels: (ChannelStrip & { hpFilter: OnePole; width: number; spaceSend: SpaceType })[];
  /** Master limiter (print chain protection). */
  masterLimiter: Limiter;
  private dc: DCBlocker;
  private masterHp: OnePole;
  private stereoEngine: StereoEngine;
  private spaceEngine: SpaceEngine;
  /** Insert send buffers (to H90). */
  insertSendL: Float32Array;
  insertSendR: Float32Array;
  /** Insert return buffers (from H90). */
  insertReturnL: Float32Array;
  insertReturnR: Float32Array;
  /** Resampling bus output (to Digitakt). */
  resampleBusL: Float32Array;
  resampleBusR: Float32Array;
  masterPeak = 0;
  readonly externalHardware = 'Universal Audio Apollo x8p — real Unison preamps + UAD DSP + 8 inputs.';

  constructor(transport: Transport) {
    this.sr = transport.sampleRate;
    // HP filter frequencies per channel — clean up low-end mud
    // Bass (Sub37) gets NO HP — it owns the low end. Drums get minimal HP (30Hz DC removal only).
    const hpFreqs = [80, 20, 100, 120, 30, 80, 40, 20]; // Muse, Sub37, Prophet, Iridium, Rytm, Digitakt, FXReturn, Master
    const rawChannels: (ChannelStrip & { width: number; spaceSend: SpaceType })[] = [
      { name: 'Muse', gain: -7, pan: -0.15, fxSend: 0.25, mute: false, solo: false, peak: 0, width: 0.4, spaceSend: 'plate' },
      { name: 'Sub37', gain: -3, pan: 0, fxSend: 0.05, mute: false, solo: false, peak: 0, width: 0, spaceSend: 'room' },
      { name: 'Prophet6', gain: -10, pan: 0.1, fxSend: 0.35, mute: false, solo: false, peak: 0, width: 0.7, spaceSend: 'hall' },
      { name: 'Iridium', gain: -14, pan: -0.1, fxSend: 0.4, mute: false, solo: false, peak: 0, width: 0.8, spaceSend: 'psy' },
      { name: 'Rytm', gain: -2, pan: 0, fxSend: 0.08, mute: false, solo: false, peak: 0, width: 0.2, spaceSend: 'room' },
      { name: 'Digitakt', gain: -8, pan: 0.08, fxSend: 0.25, mute: false, solo: false, peak: 0, width: 0.5, spaceSend: 'plate' },
      { name: 'FXReturn', gain: -4, pan: 0, fxSend: 0, mute: false, solo: false, peak: 0, width: 0.85, spaceSend: 'psy' },
      { name: 'Master', gain: 0, pan: 0, fxSend: 0, mute: false, solo: false, peak: 0, width: 1, spaceSend: 'room' },
    ];
    this.channels = rawChannels.map((c, i) => {
      const hp = new OnePole(this.sr, 'hp');
      hp.setCutoff(hpFreqs[i] || 40);
      return { ...c, hpFilter: hp };
    });
    this.stereoEngine = new StereoEngine(this.sr, 120);
    this.spaceEngine = new SpaceEngine(this.sr);
    this.masterLimiter = new Limiter(this.sr);
    this.masterLimiter.ceiling = 0.95;
    this.dc = new DCBlocker();
    this.masterHp = new OnePole(this.sr, 'hp');
    this.masterHp.setCutoff(30);
    this.insertSendL = new Float32Array(0);
    this.insertSendR = new Float32Array(0);
    this.insertReturnL = new Float32Array(0);
    this.insertReturnR = new Float32Array(0);
    this.resampleBusL = new Float32Array(0);
    this.resampleBusR = new Float32Array(0);
  }

  /** Mix all channel inputs into a stereo master + build FX send + resample bus. */
  sumToMaster(
    inputs: { l: Float32Array; r: Float32Array }[],
    blockSize: number
  ): { masterL: Float32Array; masterR: Float32Array } {
    const masterL = new Float32Array(blockSize);
    const masterR = new Float32Array(blockSize);
    this.insertSendL = new Float32Array(blockSize);
    this.insertSendR = new Float32Array(blockSize);
    this.resampleBusL = new Float32Array(blockSize);
    this.resampleBusR = new Float32Array(blockSize);

    const anySolo = this.channels.some((c) => c.solo);

    for (let ch = 0; ch < inputs.length; ch++) {
      const strip = this.channels[ch] || this.channels[this.channels.length - 1];
      if (strip.mute) continue;
      if (anySolo && !strip.solo) continue;
      const gainLin = Math.pow(10, strip.gain / 20);
      const inL = inputs[ch].l;
      const inR = inputs[ch].r;
      let chPeak = 0;
      // prepare per-channel buffers for space send
      const chSpaceL = new Float32Array(blockSize);
      const chSpaceR = new Float32Array(blockSize);
      for (let i = 0; i < blockSize; i++) {
        // Apply per-channel HP filter (clean up low-end mud on non-bass channels)
        const l = strip.hpFilter.process(inL[i]) * gainLin;
        const r = strip.hpFilter.process(inR[i]) * gainLin;
        // Apply per-channel stereo width (frequency-aware, mono below 120Hz)
        const [wl, wr] = this.stereoEngine.processWidth(l, r, strip.width);
        // constant-power pan
        const p = (strip.pan + 1) * 0.5;
        const pl = Math.cos(p * Math.PI * 0.5);
        const pr = Math.sin(p * Math.PI * 0.5);
        masterL[i] += wl * pl;
        masterR[i] += wr * pr;
        // FX send (pre-fader-ish)
        this.insertSendL[i] += wl * strip.fxSend;
        this.insertSendR[i] += wr * strip.fxSend;
        // resample bus (post-fader)
        this.resampleBusL[i] += wl * 0.5;
        this.resampleBusR[i] += wr * 0.5;
        // space send (10% of channel signal goes to assigned space)
        chSpaceL[i] = wl * pl * 0.1;
        chSpaceR[i] = wr * pr * 0.1;
        const pk = Math.max(Math.abs(l), Math.abs(r));
        if (pk > chPeak) chPeak = pk;
      }
      strip.peak = chPeak;
      // send to assigned space
      this.spaceEngine.sendTo(strip.spaceSend, chSpaceL, chSpaceR, 1);
    }

    // process space returns and add to master
    const spaceReturn = this.spaceEngine.processReturns(blockSize);
    for (let i = 0; i < blockSize; i++) {
      masterL[i] += spaceReturn.l[i];
      masterR[i] += spaceReturn.r[i];
    }

    // add FX return
    for (let i = 0; i < blockSize; i++) {
      masterL[i] += this.insertReturnL[i] || 0;
      masterR[i] += this.insertReturnR[i] || 0;
    }

    // master HP + DC block + limiter
    let mPeak = 0;
    for (let i = 0; i < blockSize; i++) {
      masterL[i] = this.dc.process(this.masterHp.process(masterL[i]));
      masterR[i] = this.dc.process(this.masterHp.process(masterR[i]));
      const [l, r] = this.masterLimiter.processStereo(masterL[i], masterR[i]);
      masterL[i] = l; masterR[i] = r;
      const p = Math.max(Math.abs(l), Math.abs(r));
      if (p > mPeak) mPeak = p;
    }
    this.masterPeak = Math.max(this.masterPeak, mPeak);
    return { masterL, masterR };
  }

  /** Receive H90 insert return. */
  setInsertReturn(l: Float32Array, r: Float32Array) {
    this.insertReturnL = l; this.insertReturnR = r;
  }

  reset() {
    this.masterLimiter.reset(); this.dc.reset(); this.masterHp.reset();
    this.masterPeak = 0;
    for (const c of this.channels) c.peak = 0;
  }
}
