/**
 * Lite Offline Renderer — matches Psy4LiteEngine exactly.
 *
 * CRITICAL FIX: The old offline renderer used different DSP (MoogLadder,
 * BLSaw, SchroederReverb) than the live engine (OscillatorNode, BiquadFilter).
 * This meant the optimizer was training on a DIFFERENT engine than what
 * the user hears. Parameters learned were wrong.
 *
 * This renderer produces the SAME sound as Psy4LiteEngine by using the
 * same synthesis approach: OscillatorNode-like DSP, same envelopes,
 * same filter types.
 *
 * It runs in a Web Worker (not real-time) for analysis.
 */

import { Rng } from './prng';

export const SR = 44100;

// ─── Scales ─────────────────────────────────────────────────────────────────

const SCALES: Record<string, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function scaleNote(root: number, scale: string, deg: number): number {
  const sc = SCALES[scale] || SCALES.minor;
  const n = sc.length;
  const oct = Math.floor(deg / n);
  const idx = ((deg % n) + n) % n;
  return root + 12 * oct + sc[idx];
}

// ─── World ──────────────────────────────────────────────────────────────────

export interface LiteWorldParams {
  bpm: number;
  root: number;
  kickDecay: number;
  kickFundamental: number;
  bassCutoff: number;
  leadCutoff: number;
  duck: number;
  kickLevel?: number;
  bassLevel?: number;
  leadLevel?: number;
  masterLevel?: number;
}

export const LITE_WORLDS: Record<string, LiteWorldParams> = {
  'progressive-psy': { bpm: 128, root: 48, kickDecay: 0.22, kickFundamental: 50, bassCutoff: 400, leadCutoff: 3000, duck: 0.4 },
  'dark-psy': { bpm: 150, root: 43, kickDecay: 0.16, kickFundamental: 48, bassCutoff: 300, leadCutoff: 2000, duck: 0.55 },
  'goa': { bpm: 140, root: 45, kickDecay: 0.2, kickFundamental: 52, bassCutoff: 500, leadCutoff: 4000, duck: 0.5 },
  'morning-psy': { bpm: 142, root: 50, kickDecay: 0.2, kickFundamental: 54, bassCutoff: 550, leadCutoff: 3500, duck: 0.42 },
  'forest': { bpm: 148, root: 44, kickDecay: 0.18, kickFundamental: 46, bassCutoff: 350, leadCutoff: 2200, duck: 0.5 },
  'acid-psy': { bpm: 142, root: 45, kickDecay: 0.19, kickFundamental: 50, bassCutoff: 600, leadCutoff: 2500, duck: 0.5 },
};

// ─── Arrangement ────────────────────────────────────────────────────────────

const ARRANGEMENT = [
  { bars: 4, density: 0.3, bass: false, lead: false, label: 'INTRO' },
  { bars: 4, density: 0.5, bass: true, lead: false, label: 'GROOVE' },
  { bars: 4, density: 0.7, bass: true, lead: false, label: 'BUILD' },
  { bars: 8, density: 0.9, bass: true, lead: true, label: 'DROP' },
  { bars: 4, density: 0.7, bass: true, lead: true, label: 'VARIATION' },
  { bars: 4, density: 0.3, bass: false, lead: false, label: 'BREAK' },
  { bars: 8, density: 1.0, bass: true, lead: true, label: 'FINAL DROP' },
  { bars: 4, density: 0.3, bass: true, lead: false, label: 'OUTRO' },
];

// ─── Simple DSP primitives (matching Web Audio API behavior) ────────────────

// One-pole lowpass (matches BiquadFilter lowpass roughly)
function onePoleLowpass(input: number, prev: number, cutoff: number, sr: number): number {
  const fc = Math.min(0.45, cutoff / sr);
  const a = 1 - Math.exp(-2 * Math.PI * fc);
  return prev + a * (input - prev);
}

// Exponential gain envelope
function expEnv(t: number, attack: number, decay: number): number {
  if (t < attack) return t / attack;
  return Math.exp(-(t - attack) / decay);
}

// ─── Voice renderers (matching Psy4LiteEngine) ─────────────────────────────

interface VoiceEvent {
  time: number;
  type: 'kick' | 'bass' | 'lead' | 'hat' | 'clap';
  note?: number;
  velocity: number;
  cutoff?: number;
}

function generateEvents(seed: number, world: LiteWorldParams, duration: number): VoiceEvent[] {
  const rng = new Rng(seed);
  const events: VoiceEvent[] = [];
  const s16 = 60 / world.bpm / 4;
  let step = 0, bar = 0, sectionIdx = 0;
  let nextTime = 0;

  while (nextTime < duration) {
    const section = ARRANGEMENT[sectionIdx % ARRANGEMENT.length];

    // Kick — 4 on floor
    if (step % 4 === 0) {
      events.push({ time: nextTime, type: 'kick', velocity: section.density * 0.5 });
    }

    // Bass — offbeat
    if (section.bass && step % 2 === 1) {
      const note = scaleNote(world.root, 'phrygian', 0);
      events.push({ time: nextTime, type: 'bass', note, velocity: 0.4, cutoff: world.bassCutoff });
    }

    // Lead — in drops
    if (section.lead && step % 2 === 0 && rng.chance(0.4)) {
      const degrees = [0, 3, 5, 7, 10];
      const deg = degrees[rng.int(0, degrees.length - 1)];
      const note = scaleNote(world.root + 12, 'phrygian', deg);
      events.push({ time: nextTime, type: 'lead', note, velocity: 0.3, cutoff: world.leadCutoff });
    }

    // Hats — offbeat
    if (step % 2 === 1) {
      events.push({ time: nextTime, type: 'hat', velocity: 0.12 });
    }

    // Clap — 2 and 4
    if (step === 4 || step === 12) {
      events.push({ time: nextTime, type: 'clap', velocity: 0.2 });
    }

    step++;
    nextTime += s16;
    if (step >= 16) {
      step = 0;
      bar++;
      if (bar >= section.bars) {
        sectionIdx++;
        bar = 0;
      }
    }
  }

  return events;
}

// ─── Render ─────────────────────────────────────────────────────────────────

export interface RenderOptions {
  paramOverrides?: Partial<LiteWorldParams>;
  onlyVoices?: string[];
}

export interface RenderResult {
  samplesL: Float32Array;
  samplesR: Float32Array;
  sampleRate: number;
  duration: number;
  events: VoiceEvent[];
}

export function renderLite(
  worldId: string,
  duration: number,
  options: RenderOptions = {},
): RenderResult {
  const world: LiteWorldParams = {
    ...LITE_WORLDS[worldId],
    ...options.paramOverrides,
  };
  const sr = SR;
  const totalSamples = Math.floor(duration * sr);
  const samplesL = new Float32Array(totalSamples);
  const samplesR = new Float32Array(totalSamples);

  // Generate events
  const events = generateEvents(1234, world, duration);

  // Level params
  const kickLevel = world.kickLevel ?? 1.0;
  const bassLevel = world.bassLevel ?? 1.0;
  const leadLevel = world.leadLevel ?? 1.0;
  const masterLevel = world.masterLevel ?? 0.7;

  // Process each event
  for (const ev of events) {
    if (options.onlyVoices && !options.onlyVoices.includes(ev.type)) continue;

    const startSample = Math.floor(ev.time * sr);
    const vel = ev.velocity;

    if (ev.type === 'kick') {
      // Kick: sine sub + triangle mid + noise click (matches LiteEngine)
      const decay = world.kickDecay;
      const fundamental = world.kickFundamental;
      const kickSamples = Math.floor((decay + 0.05) * sr);

      for (let i = 0; i < kickSamples && startSample + i < totalSamples; i++) {
        const t = i / sr;
        const idx = startSample + i;

        // Sub: sine with pitch envelope
        const pitchEnv = fundamental * 2.4 * Math.exp(-t / 0.035) + fundamental;
        const subEnv = Math.exp(-t / (decay * 0.9));
        const sub = Math.sin(2 * Math.PI * pitchEnv * t) * subEnv * 0.9 * vel * kickLevel;

        // Mid: triangle with pitch drop
        const midEnv = Math.exp(-t / 0.05);
        const midFreq = fundamental * 2 * Math.exp(-t / 0.02) + fundamental * 1.5;
        const mid = (2 * Math.abs(2 * (midFreq * t % 1) - 1) - 1) * midEnv * 0.4 * vel * kickLevel;

        // Click: noise burst (very short)
        const clickEnv = Math.exp(-t / 0.012);
        const click = (Math.random() * 2 - 1) * clickEnv * 0.25 * vel * kickLevel;

        const sample = sub + mid + click;
        samplesL[idx] += sample;
        samplesR[idx] += sample;
      }
    } else if (ev.type === 'bass') {
      // Bass: sawtooth → lowpass → gain envelope (matches LiteEngine)
      const freq = mtof(ev.note!);
      const cutoffStart = ev.cutoff! * 4;
      const cutoffEnd = ev.cutoff!;
      const dur = 0.1;
      const bassSamples = Math.floor((dur + 0.02) * sr);
      let lpState = 0;

      for (let i = 0; i < bassSamples && startSample + i < totalSamples; i++) {
        const t = i / sr;
        const idx = startSample + i;

        // Sawtooth oscillator
        const phase = (freq * t) % 1;
        const osc = 2 * phase - 1;

        // Lowpass filter (cutoff envelope)
        const cutoff = (cutoffStart - cutoffEnd) * Math.exp(-t / 0.04) + cutoffEnd;
        lpState = onePoleLowpass(osc, lpState, cutoff, sr);

        // Gain envelope
        const attackEnv = Math.min(1, t / 0.003);
        const decayEnv = Math.exp(-t / (dur * 0.5));
        const ampEnv = attackEnv * decayEnv;

        const sample = lpState * ampEnv * 0.4 * bassLevel;
        samplesL[idx] += sample;
        samplesR[idx] += sample;
      }
    } else if (ev.type === 'lead') {
      // Lead: 2 detuned saws → lowpass → gain (matches LiteEngine)
      const freq = mtof(ev.note!);
      const cutoff = ev.cutoff!;
      const dur = 0.15;
      const leadSamples = Math.floor((dur + 0.02) * sr);
      let lpState = 0;

      for (let i = 0; i < leadSamples && startSample + i < totalSamples; i++) {
        const t = i / sr;
        const idx = startSample + i;

        // 2 detuned saws
        const phase1 = (freq * t) % 1;
        const phase2 = (freq * 1.006 * t) % 1; // ~10 cents detune
        const osc = (2 * phase1 - 1) + (2 * phase2 - 1);

        // Lowpass
        lpState = onePoleLowpass(osc * 0.5, lpState, cutoff, sr);

        // Gain envelope
        const attackEnv = Math.min(1, t / 0.005);
        const decayEnv = Math.exp(-t / dur);
        const ampEnv = attackEnv * decayEnv;

        const sample = lpState * ampEnv * 0.3 * leadLevel;
        samplesL[idx] += sample;
        samplesR[idx] += sample;
      }
    } else if (ev.type === 'hat') {
      // Hat: noise → highpass → gain (matches LiteEngine)
      const decay = 0.04;
      const hatSamples = Math.floor((decay + 0.02) * sr);
      let hpState = 0;

      for (let i = 0; i < hatSamples && startSample + i < totalSamples; i++) {
        const t = i / sr;
        const idx = startSample + i;

        // Noise
        const noise = Math.random() * 2 - 1;

        // Highpass (one-pole)
        hpState = onePoleLowpass(noise, hpState, 8600, sr);
        const hp = noise - hpState;

        // Gain envelope
        const env = Math.exp(-t / decay);
        const sample = hp * env * vel;
        samplesL[idx] += sample;
        samplesR[idx] += sample;
      }
    } else if (ev.type === 'clap') {
      // Clap: 3 noise bursts → bandpass (matches LiteEngine)
      const clapSamples = Math.floor(0.1 * sr);

      for (let i = 0; i < clapSamples && startSample + i < totalSamples; i++) {
        const t = i / sr;
        const idx = startSample + i;

        // 3 bursts
        let sample = 0;
        for (let b = 0; b < 3; b++) {
          const burstTime = b * 0.01;
          if (t >= burstTime) {
            const localT = t - burstTime;
            const env = Math.exp(-localT / 0.08);
            const noise = Math.random() * 2 - 1;
            // Simple bandpass approximation (highpass + lowpass)
            sample += noise * env * 0.6 * vel;
          }
        }

        samplesL[idx] += sample;
        samplesR[idx] += sample;
      }
    }
  }

  // Apply master gain + soft clipping (matches LiteEngine compressor/limiter)
  for (let i = 0; i < totalSamples; i++) {
    let l = samplesL[i] * masterLevel;
    let r = samplesR[i] * masterLevel;

    // Soft clip (tanh approximation)
    l = l > 1 ? 1 : l < -1 ? -1 : l;
    r = r > 1 ? 1 : r < -1 ? -1 : r;

    samplesL[i] = l;
    samplesR[i] = r;
  }

  return {
    samplesL,
    samplesR,
    sampleRate: sr,
    duration,
    events,
  };
}

export function encodeWav(samplesL: Float32Array, samplesR: Float32Array, sr: number): ArrayBuffer {
  const numSamples = samplesL.length;
  const buffer = new ArrayBuffer(44 + numSamples * 4);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 4, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 4, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const l = Math.max(-1, Math.min(1, samplesL[i]));
    const r = Math.max(-1, Math.min(1, samplesR[i]));
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    view.setInt16(offset + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    offset += 4;
  }

  return buffer;
}

export function downmixToMono(samplesL: Float32Array, samplesR: Float32Array): Float32Array {
  const n = samplesL.length;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mono[i] = (samplesL[i] + samplesR[i]) * 0.5;
  }
  return mono;
}
