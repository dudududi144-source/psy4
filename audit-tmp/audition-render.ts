/**
 * AUDIT-A: Render real WAVs from PSY4 synth engine.
 *
 * This script replicates the EXACT voice functions from
 * /home/z/my-project/src/lib/psyLive.ts (lines 481-674) and the
 * full master chain (lines 347-401) so the renders are faithful
 * to what the browser engine produces.
 *
 * No production code is modified. This is a read-only forensic render.
 *
 * Run: bun run audit-tmp/audition-render.ts
 */
import * as fs from 'fs';
import * as path from 'path';

const SAMPLE_RATE = 44100;
const BPM = 145; // matches preset "rolling_bass"
const BEAT_DUR = 60 / BPM;          // 0.4137931s
const STEP_DUR = BEAT_DUR / 4;      // 16th note
const BAR_DUR = 4 * BEAT_DUR;       // 1.6551724s

// rolling_bass preset — variant A (root=33 → freq via mtof)
const ROOT_MIDI = 33;
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const ROOT_FREQ = mtof(ROOT_MIDI);  // ≈ 55.0 Hz

// Pattern from preset rolling_bass:
//   kick: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0]
//   bass: [null,0,0,0, null,0,0,0, null,0,0,0, null,0,0,3]   (degrees rel to root)
//   lead: [null,null,null,null, null,null,12,null, null,null,null,null, 15,null,12,null]
//   hat:  [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,1]
const PAT_KICK: number[] = [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0];
const PAT_BASS: (number | null)[] = [null,0,0,0, null,0,0,0, null,0,0,0, null,0,0,3];
const PAT_LEAD: (number | null)[] = [null,null,null,null, null,null,12,null, null,null,null,null, 15,null,12,null];
const PAT_HAT: number[] = [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,1];

// Variant A synth params (from preset)
const VARIANT_A = {
  bassWave: 'sawtooth' as OscillatorType,
  bassCut: 700, bassQ: 6,
  leadWave: 'sawtooth' as OscillatorType,
  leadCut: 1800, leadQ: 9,
  hatLvl: 0.12, leadLvl: 0.45,
};

// degrees 0..7 → semitone offsets within phrygian-dominant on root 33 (A1)
const SCALE_SEMITONES = [0, 1, 4, 5, 7, 8, 11, 12];
function degreeToMidi(deg: number): number {
  const octave = Math.floor(deg / SCALE_SEMITONES.length);
  const idx = ((deg % SCALE_SEMITONES.length) + SCALE_SEMITONES.length) % SCALE_SEMITONES.length;
  return ROOT_MIDI + 12 * octave + SCALE_SEMITONES[idx];
}

// ── WAV writer (44-byte header + PCM int16) ──
function encodeWAV(samples: Float32Array, sr: number): Buffer {
  const b = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(b);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); ws(8, 'WAVE');
  ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); ws(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2;
  }
  return Buffer.from(b);
}

// ── Engine: holds ctx + buses + voice functions identical to psyLive.ts ──
class AuditionEngine {
  ctx: any;
  kickBus: any; bassBus: any; leadBus: any; hatBus: any;
  engineBus: any; comp: any;
  masterEqLow: any; masterEqMid: any; masterEqHigh: any;
  master: any; safetyLimiter: any; analyser: any;
  delaySend: any; delay: any; delayFb: any;
  reverbSend: any; convolver: any;
  noiseBuf: any;

  constructor(ctx: any) {
    this.ctx = ctx;

    this.kickBus = ctx.createGain(); this.kickBus.gain.value = 0.8;
    this.bassBus = ctx.createGain(); this.bassBus.gain.value = 0.5;
    this.leadBus = ctx.createGain(); this.leadBus.gain.value = 0.5;
    this.hatBus  = ctx.createGain(); this.hatBus.gain.value  = 0.5;

    this.engineBus = ctx.createGain(); this.engineBus.gain.value = 0.8;

    this.masterEqLow = ctx.createBiquadFilter();
    this.masterEqLow.type = 'lowshelf';
    this.masterEqLow.frequency.value = 80;
    this.masterEqLow.gain.value = 2;

    this.masterEqMid = ctx.createBiquadFilter();
    this.masterEqMid.type = 'peaking';
    this.masterEqMid.frequency.value = 350;
    this.masterEqMid.Q.value = 0.8;
    this.masterEqMid.gain.value = -1;

    this.masterEqHigh = ctx.createBiquadFilter();
    this.masterEqHigh.type = 'highshelf';
    this.masterEqHigh.frequency.value = 8000;
    this.masterEqHigh.gain.value = 1.5;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 2;
    this.comp.attack.value = 0.015;
    this.comp.release.value = 0.12;

    this.master = ctx.createGain(); this.master.gain.value = 0.9;

    this.safetyLimiter = ctx.createDynamicsCompressor();
    this.safetyLimiter.threshold.value = -1.0;
    this.safetyLimiter.knee.value = 0;
    this.safetyLimiter.ratio.value = 20;
    this.safetyLimiter.attack.value = 0.003;
    this.safetyLimiter.release.value = 0.05;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;

    this.kickBus.connect(this.engineBus);
    this.bassBus.connect(this.engineBus);
    this.leadBus.connect(this.engineBus);
    this.hatBus.connect(this.engineBus);
    this.engineBus.connect(this.comp);
    this.comp.connect(this.masterEqLow);
    this.masterEqLow.connect(this.masterEqMid);
    this.masterEqMid.connect(this.masterEqHigh);
    this.masterEqHigh.connect(this.master);
    this.master.connect(this.safetyLimiter);
    this.safetyLimiter.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.delaySend = ctx.createGain(); this.delaySend.gain.value = 1.0;
    this.delay = ctx.createDelay(2.0);
    this.delay.delayTime.value = 0.3;
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    this.delayFb = ctx.createGain(); this.delayFb.gain.value = 0.34;
    this.delaySend.connect(this.delay);
    this.delay.connect(wet); wet.connect(this.masterEqLow);
    this.delay.connect(this.delayFb); this.delayFb.connect(this.delay);

    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0;
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this.mkIR(ctx);
    const reverbWet = ctx.createGain(); reverbWet.gain.value = 0.5;
    this.reverbSend.connect(this.convolver);
    this.convolver.connect(reverbWet);
    reverbWet.connect(this.masterEqLow);

    const len = Math.floor(ctx.sampleRate * 0.25);
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;
  }

  private mkIR(ctx: any): any {
    const dur = 1.5;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      d[i] = (Math.random() * 2 - 1) * Math.exp(-3 * t);
    }
    return buf;
  }

  private makeShaper(amount: number): any {
    const shaper = this.ctx.createWaveShaper();
    const samples = 1024;
    const curve = new Float32Array(samples);
    const k = amount;
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    shaper.curve = curve;
    shaper.oversample = '2x';
    return shaper;
  }

  // KICK (psyLive.ts:481-521)
  kick(t: number, velocity = 0.9): void {
    const ctx = this.ctx;
    const v = Math.max(0.1, Math.min(1, velocity));

    if (this.noiseBuf) {
      const click = ctx.createBufferSource(); click.buffer = this.noiseBuf;
      const clickHp = ctx.createBiquadFilter(); clickHp.type = 'highpass'; clickHp.frequency.value = 5000;
      const clickGain = ctx.createGain();
      clickGain.gain.setValueAtTime(0.4 * v, t);
      clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.003);
      click.connect(clickHp); clickHp.connect(clickGain); clickGain.connect(this.kickBus);
      click.start(t); click.stop(t + 0.005);
    }

    const body = ctx.createOscillator(); body.type = 'sine';
    body.frequency.setValueAtTime(120, t);
    body.frequency.exponentialRampToValueAtTime(48, t + 0.015);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0, t);
    bodyGain.gain.linearRampToValueAtTime(0.8 * v, t + 0.0005);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    body.connect(bodyGain); bodyGain.connect(this.kickBus);
    body.start(t); body.stop(t + 0.09);

    const sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(48, t);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0, t);
    subGain.gain.linearRampToValueAtTime(0.5 * v, t + 0.003);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    sub.connect(subGain); subGain.connect(this.kickBus);
    sub.start(t); sub.stop(t + 0.11);
  }

  // HAT (psyLive.ts:523-535)
  hat(t: number, lvl: number, open = false): void {
    const ctx = this.ctx;
    if (!this.noiseBuf) return;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 10000; bp.Q.value = 0.7;
    const gain = ctx.createGain();
    const decay = open ? 0.12 : 0.04;
    gain.gain.setValueAtTime(Math.max(0.001, lvl), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(hp); hp.connect(bp); bp.connect(gain); gain.connect(this.hatBus);
    src.start(t); src.stop(t + decay + 0.01);
  }

  // BASS (psyLive.ts:550-607) — variant A, no learned timbre
  bass(t: number, freq: number, velocity = 0.85): void {
    const ctx = this.ctx;
    const v = Math.max(0.1, Math.min(1, velocity));
    const v_p = VARIANT_A;
    const oscType = v_p.bassWave;
    const cutoff = v_p.bassCut;
    const resonance = v_p.bassQ;

    const sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.value = freq;
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, t);
    subGain.gain.linearRampToValueAtTime(0.4 * v, t + 0.001);
    subGain.gain.linearRampToValueAtTime(0.0, t + 0.065);
    sub.connect(subGain); subGain.connect(this.bassBus);
    sub.start(t); sub.stop(t + 0.07);

    const mid = ctx.createOscillator(); mid.type = oscType; mid.frequency.value = freq;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = resonance;
    const fStart = Math.max(1000, cutoff);
    const fEnd = Math.max(150, cutoff * 0.25);
    filter.frequency.setValueAtTime(fStart, t);
    filter.frequency.exponentialRampToValueAtTime(fEnd, t + 0.025);
    const midGain = ctx.createGain();
    midGain.gain.setValueAtTime(0.0001, t);
    midGain.gain.linearRampToValueAtTime(0.25 * v, t + 0.001);
    midGain.gain.linearRampToValueAtTime(0.0, t + 0.065);
    mid.connect(filter); filter.connect(midGain); midGain.connect(this.bassBus);

    if (this.noiseBuf) {
      const char = ctx.createBufferSource(); char.buffer = this.noiseBuf;
      const charBp = ctx.createBiquadFilter(); charBp.type = 'bandpass';
      charBp.frequency.value = freq * 4; charBp.Q.value = 2;
      const charGain = ctx.createGain();
      charGain.gain.setValueAtTime(0.15 * v, t);
      charGain.gain.exponentialRampToValueAtTime(0.001, t + 0.01);
      char.connect(charBp); charBp.connect(charGain); charGain.connect(this.bassBus);
      char.start(t); char.stop(t + 0.012);
    }

    if (this.delaySend) { const send = ctx.createGain(); send.gain.value = 0.06; midGain.connect(send); send.connect(this.delaySend); }
    mid.start(t); mid.stop(t + 0.07);
  }

  // LEAD (psyLive.ts:609-659) — variant A, no learned timbre
  lead(t: number, freq: number, accent: boolean): void {
    const ctx = this.ctx;
    const v_p = VARIANT_A;
    const leadWave = v_p.leadWave;
    const leadCut = v_p.leadCut;
    const leadSat = 0.2;
    const stereoW = 0.6;

    const peakCut = Math.max(200, leadCut * (accent ? 1.2 : 1));
    const oscs: any[] = [];
    const detunes = [-7, 0, 7];
    for (const det of detunes) {
      const o = ctx.createOscillator();
      o.type = leadWave;
      o.frequency.value = freq;
      o.detune.value = det;
      oscs.push(o);
    }
    const merger = ctx.createGain();
    const panL = ctx.createStereoPanner(); panL.pan.value = -stereoW;
    const panC = ctx.createStereoPanner(); panC.pan.value = 0;
    const panR = ctx.createStereoPanner(); panR.pan.value = stereoW;
    oscs[0].connect(panL); panL.connect(merger);
    oscs[1].connect(panC); panC.connect(merger);
    oscs[2].connect(panR); panR.connect(merger);

    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass';
    filter.Q.value = Math.min(7, v_p.leadQ);
    filter.frequency.setValueAtTime(300, t);
    filter.frequency.exponentialRampToValueAtTime(peakCut, t + 0.03);
    filter.frequency.exponentialRampToValueAtTime(Math.max(400, peakCut * 0.5), t + 0.3);
    const gain = ctx.createGain();
    const peak = Math.max(0.05, v_p.leadLvl * 0.7 * (accent ? 1 : 0.75));
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(peak * 0.4, t + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    const sat = this.makeShaper(Math.round(leadSat * 10));
    merger.connect(filter); filter.connect(gain); gain.connect(sat); sat.connect(this.leadBus);
    if (this.delaySend) { const send = ctx.createGain(); send.gain.value = 0.15; gain.connect(send); send.connect(this.delaySend); }
    if (this.reverbSend) { const rs = ctx.createGain(); rs.gain.value = 0.2; gain.connect(rs); rs.connect(this.reverbSend); }
    for (const o of oscs) { o.start(t); o.stop(t + 0.42); }
  }
}

// ── Render helpers ──
async function renderBars(bars: number, voices: ('kick'|'bass'|'lead'|'hat')[], outPath: string): Promise<void> {
  const duration = bars * BAR_DUR + 0.5;
  const length = Math.ceil(duration * SAMPLE_RATE);
  const ctx = new (await import('web-audio-api')).OfflineAudioContext(1, length, SAMPLE_RATE);
  const eng = new AuditionEngine(ctx);

  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * BAR_DUR;
    for (let step = 0; step < 16; step++) {
      const t = barStart + step * STEP_DUR;
      if (voices.includes('kick') && PAT_KICK[step]) eng.kick(t, step === 0 ? 0.95 : 0.9);
      if (voices.includes('bass')) {
        const deg = PAT_BASS[step];
        if (deg !== null) {
          const midi = degreeToMidi(deg);
          const freq = mtof(midi);
          const vel = step % 4 === 0 ? 0.9 : 0.55;
          eng.bass(t, freq, vel);
        }
      }
      if (voices.includes('hat') && PAT_HAT[step]) eng.hat(t, VARIANT_A.hatLvl, step === 15);
      if (voices.includes('lead')) {
        const deg = PAT_LEAD[step];
        if (deg !== null) {
          const midi = degreeToMidi(deg as number) + 24;
          const freq = mtof(midi);
          const accent = step % 4 === 0;
          eng.lead(t, freq, accent);
        }
      }
    }
  }

  const buffer = await ctx.startRendering();
  const data = buffer.getChannelData(0);
  const wav = encodeWAV(data as Float32Array, SAMPLE_RATE);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, wav);
  console.log(`  Wrote ${outPath}  (${(data.length / SAMPLE_RATE).toFixed(2)}s, ${data.length} samples)`);
}

async function main(): Promise<void> {
  const OUT = '/home/z/my-project/audio-artifacts';
  console.log('=== AUDIT-A RENDER ===');
  console.log(`BPM=${BPM}, SR=${SAMPLE_RATE}, root=${ROOT_MIDI} (${ROOT_FREQ.toFixed(2)}Hz), BAR=${BAR_DUR.toFixed(3)}s`);
  console.log('');

  console.log('A. 4 bars kick only...');
  await renderBars(4, ['kick'], `${OUT}/AUDIT-A-kick.wav`);

  console.log('B. 4 bars bass only...');
  await renderBars(4, ['bass'], `${OUT}/AUDIT-B-bass.wav`);

  console.log('C. 4 bars kick+bass...');
  await renderBars(4, ['kick', 'bass'], `${OUT}/AUDIT-C-kickbass.wav`);

  console.log('D. 4 bars lead only...');
  await renderBars(4, ['lead'], `${OUT}/AUDIT-D-lead.wav`);

  console.log('E. 8 bars full mix...');
  await renderBars(8, ['kick', 'bass', 'lead', 'hat'], `${OUT}/AUDIT-E-8bar.wav`);

  console.log('F. 16 bars full mix...');
  await renderBars(16, ['kick', 'bass', 'lead', 'hat'], `${OUT}/AUDIT-F-16bar.wav`);

  console.log('\nAll renders complete.');
}

main().catch(e => { console.error('Render failed:', e); process.exit(1); });
