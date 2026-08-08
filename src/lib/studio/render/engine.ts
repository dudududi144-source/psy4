/**
 * STUDIO ENGINE — the complete signal chain (Phase 3).
 * REAL IMPLEMENTATION.
 *
 * Owns all device twins + transport + routing. Renders audio block-by-block:
 *
 *   CLOCK (Transport)
 *     → each synth/drum/sampler device renders its block into its own stereo bus
 *     → Apollo sums all buses → master + FX insert send + resample bus
 *     → H90 processes insert send → insert return
 *     → Apollo adds FX return to master
 *     → Digitakt receives resample bus (resampling host)
 *     → Live applies master chain + records
 *
 * This is the authoritative end-to-end signal path. No stages are skipped.
 */

import { Transport } from '../clock';
import { Rng, hashSeed } from '../rng';
import { MuseDevice, MuseParams, MUSE_DEFAULTS } from '../devices/moog-muse';
import { Sub37Device, Sub37Params, SUB37_DEFAULTS } from '../devices/subsequent37';
import { Prophet6Device, Prophet6Params, PROPHET6_DEFAULTS } from '../devices/prophet6';
import { IridiumDevice, IridiumParams, IRIDIUM_DEFAULTS } from '../devices/waldorf-iridium';
import { RytmDevice, RytmParams, RYTM_DEFAULTS, DrumVoice } from '../devices/analog-rytm';
import { DigitaktDevice } from '../devices/digitakt';
import { H90Device, H90Params, H90_DEFAULTS } from '../devices/eventide-h90';
import { ApolloDevice } from '../devices/apollo-x8p';
import { LiveDevice, ArrangementSection, MasterChainParams } from '../devices/ableton-live';
import { DeviceContext } from '../devices/device';
import { encodeWav, rms, peak } from './wav';

export interface StudioConfig {
  bpm: number;
  sampleRate: number;
  blockSize: number;
  bars: number;
  seed: number;
  master: Partial<MasterChainParams>;
  muse: Partial<MuseParams>;
  sub37: Partial<Sub37Params>;
  prophet6: Partial<Prophet6Params>;
  iridium: Partial<IridiumParams>;
  rytm: Partial<RytmParams>;
  h90: Partial<H90Params>;
}

export const STUDIO_DEFAULTS: StudioConfig = {
  bpm: 138,
  sampleRate: 44100,
  blockSize: 256,
  bars: 16,
  seed: 1337,
  master: {},
  muse: {},
  sub37: {},
  prophet6: {},
  iridium: {},
  rytm: {},
  h90: {},
};

export class Studio {
  config: StudioConfig;
  transport: Transport;
  rng: Rng;
  muse: MuseDevice;
  sub37: Sub37Device;
  prophet6: Prophet6Device;
  iridium: IridiumDevice;
  rytm: RytmDevice;
  digitakt: DigitaktDevice;
  h90: H90Device;
  apollo: ApolloDevice;
  live: LiveDevice;
  /** All devices that produce audio, in channel order for Apollo. */
  audioProducers: { name: string; device: { processBlock: (l: Float32Array, r: Float32Array, ctx: DeviceContext) => void } }[] = [];
  /** Render metrics for validation. */
  metrics: RenderMetrics;
  initialized = false;

  constructor(config: Partial<StudioConfig> = {}) {
    this.config = { ...STUDIO_DEFAULTS, ...config };
    this.transport = new Transport({
      bpm: this.config.bpm,
      sampleRate: this.config.sampleRate,
      ppq: 96,
    });
    this.rng = new Rng(this.config.seed);
    this.muse = new MuseDevice(this.transport, this.config.muse);
    this.sub37 = new Sub37Device(this.transport, this.config.sub37);
    this.prophet6 = new Prophet6Device(this.transport, this.config.prophet6);
    this.iridium = new IridiumDevice(this.transport, this.config.iridium, this.config.seed);
    this.rytm = new RytmDevice(this.transport, this.config.rytm);
    this.digitakt = new DigitaktDevice(this.transport);
    this.h90 = new H90Device(this.transport, this.config.h90);
    this.apollo = new ApolloDevice(this.transport);
    this.live = new LiveDevice(this.transport, this.config.master);
    this.audioProducers = [
      { name: 'Muse', device: this.muse },
      { name: 'Sub37', device: this.sub37 },
      { name: 'Prophet6', device: this.prophet6 },
      { name: 'Iridium', device: this.iridium },
      { name: 'Rytm', device: this.rytm },
      { name: 'Digitakt', device: this.digitakt },
    ];
    this.metrics = { blocksProcessed: 0, samplesRendered: 0, peakMaster: 0, rmsMaster: 0, renderTimeMs: 0, devicePeaks: {} };
  }

  initialize() {
    if (this.initialized) return;
    this.live.logEvent('INFO', 'INITIALIZE', 'Studio initialized', {
      bpm: this.config.bpm, sr: this.config.sampleRate, bars: this.config.bars, seed: this.config.seed,
    });
    this.initialized = true;
  }

  reset() {
    this.transport.reset();
    this.rng = new Rng(this.config.seed);
    this.muse.reset(); this.sub37.reset(); this.prophet6.reset();
    this.iridium.reset(); this.rytm.reset(); this.digitakt.reset();
    this.h90.reset(); this.apollo.reset(); this.live.reset();
    this.metrics = { blocksProcessed: 0, samplesRendered: 0, peakMaster: 0, rmsMaster: 0, renderTimeMs: 0, devicePeaks: {} };
    this.initialized = false;
  }

  /**
   * Render `bars` bars of audio. Returns stereo Float32Arrays (master output).
   * Optional `onBlock` callback for live metering.
   */
  render(bars = this.config.bars, onBlock?: (sample: number) => void): { left: Float32Array; right: Float32Array } {
    this.initialize();
    const t0 = Date.now();
    const totalSamples = this.transport.barsToSamples(bars);
    const bs = this.config.blockSize;
    const sr = this.config.sampleRate;
    const masterLeft = new Float32Array(totalSamples);
    const masterRight = new Float32Array(totalSamples);

    // per-device buses
    const buses = this.audioProducers.map(() => ({ l: new Float32Array(bs), r: new Float32Array(bs) }));

    let blockStart = 0;
    while (blockStart < totalSamples) {
      const blockSize = Math.min(bs, totalSamples - blockStart);
      // clear buses
      for (const b of buses) { b.l.fill(0); b.r.fill(0); }

      // 1. each producer renders into its bus
      const ctx: DeviceContext = { transport: this.transport, blockStart, blockSize };
      for (let d = 0; d < this.audioProducers.length; d++) {
        this.audioProducers[d].device.processBlock(buses[d].l, buses[d].r, ctx);
      }

      // 2. Apollo sums buses → master + FX send + resample bus
      const { masterL, masterR } = this.apollo.sumToMaster(buses, blockSize);

      // 3. H90 receives FX insert send and processes
      this.h90.receiveInsert(this.apollo.insertSendL, this.apollo.insertSendR);
      const fxOut = { l: new Float32Array(blockSize), r: new Float32Array(blockSize) };
      this.h90.processBlock(fxOut.l, fxOut.r, ctx);
      this.apollo.setInsertReturn(fxOut.l, fxOut.r);

      // 4. Digitakt receives resample bus
      this.digitakt.feedResampleBus(this.apollo.resampleBusL, this.apollo.resampleBusR, 0.8);

      // 5. Re-sum with FX return now present
      const finalMix = this.apollo.sumToMaster(buses, blockSize);
      // re-apply H90 (FX return already in apollo)
      this.apollo.setInsertReturn(new Float32Array(blockSize), new Float32Array(blockSize));

      // 6. Live master chain + record
      const mastered = this.live.processMaster(finalMix.masterL, finalMix.masterR);
      masterLeft.set(mastered.l, blockStart);
      masterRight.set(mastered.r, blockStart);
      this.live.record(mastered);

      // 7. advance transport
      this.transport.advanceN(blockSize);
      this.metrics.blocksProcessed++;
      this.metrics.samplesRendered += blockSize;
      if (onBlock) onBlock(blockStart + blockSize);

      blockStart += blockSize;
    }

    this.metrics.peakMaster = peak(masterLeft);
    this.metrics.rmsMaster = rms(masterLeft);
    this.metrics.renderTimeMs = Date.now() - t0;
    this.metrics.devicePeaks = {
      muse: this.muse.peak, sub37: this.sub37.peak, prophet6: this.prophet6.peak,
      iridium: this.iridium.peak, rytm: this.rytm.peak, digitakt: this.digitakt.peak, h90: this.h90.peak,
    };

    this.live.logEvent('INFO', 'RENDER', 'Render complete', this.metrics);
    return { left: masterLeft, right: masterRight };
  }

  /** Render and encode to WAV ArrayBuffer. */
  renderToWav(bars = this.config.bars): { wav: ArrayBuffer; left: Float32Array; right: Float32Array } {
    const { left, right } = this.render(bars);
    const wav = encodeWav(left, right, this.config.sampleRate);
    return { wav, left, right };
  }

  /** Helper: schedule a kick at a given bar + step. */
  scheduleKick(bar: number, step: number, velocity = 0.95) {
    const sample = bar * this.transport.samplesPerBar() + step * this.transport.samplesPerSixteenth();
    this.rytm.trigger('kick', sample, velocity);
  }
  scheduleDrum(voice: DrumVoice, bar: number, step: number, velocity = 0.8, tune = 0) {
    const sample = bar * this.transport.samplesPerBar() + step * this.transport.samplesPerSixteenth();
    this.rytm.trigger(voice, sample, velocity, tune);
  }
  scheduleBass(bar: number, step: number, note: number, velocity = 0.85, duration = 0.12) {
    const sample = bar * this.transport.samplesPerBar() + step * this.transport.samplesPerSixteenth();
    this.sub37.noteOn(note, velocity, sample, duration);
  }
  scheduleLead(bar: number, step: number, note: number, velocity = 0.7, duration = 0.2) {
    const sample = bar * this.transport.samplesPerBar() + step * this.transport.samplesPerSixteenth();
    this.muse.noteOn(note, velocity, sample, duration);
  }
  schedulePad(bar: number, note: number, velocity = 0.5, duration = 4) {
    const sample = bar * this.transport.samplesPerBar();
    this.prophet6.noteOn(note, velocity, sample, duration);
  }
  scheduleTexture(bar: number, note: number, velocity = 0.4, duration = 8) {
    const sample = bar * this.transport.samplesPerBar();
    this.iridium.noteOn(note, velocity, sample, duration);
  }
  scheduleSample(name: string, bar: number, step: number, velocity = 0.8, pitch = 0, pan = 0) {
    const sample = bar * this.transport.samplesPerBar() + step * this.transport.samplesPerSixteenth();
    this.digitakt.trigger({ sampleName: name, sample, velocity, pitch, pan, start: 0, length: 0 });
  }
}

export interface RenderMetrics {
  blocksProcessed: number;
  samplesRendered: number;
  peakMaster: number;
  rmsMaster: number;
  renderTimeMs: number;
  devicePeaks: Record<string, number>;
}
