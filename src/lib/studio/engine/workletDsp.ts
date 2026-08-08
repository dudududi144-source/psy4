/**
 * Worklet DSP Loader & Factory.
 *
 * Loads /worklets/psy4-dsp.js once and provides typed factory functions
 * for creating AudioWorkletNode instances of each processor.
 *
 * These nodes run REAL sample-accurate DSP in the audio thread:
 *   - Moog filter (4-stage tanh ladder) — replaces BiquadFilter for voices
 *   - Band-limited saw/square (polyBLEP) — replaces aliasing PeriodicWave
 *   - Saturation, Phaser, BusEQ
 *
 * Fallback: if worklets fail to load (old browser), factory functions
 * return null and callers fall back to native nodes.
 */

const WORKLET_URL = '/worklets/psy4-dsp.js';

let loadPromise: Promise<boolean> | null = null;

/**
 * Load the worklet module into an AudioContext. Cached — safe to call
 * multiple times for the same context.
 */
export function ensureWorkletsLoaded(ctx: AudioContext): Promise<boolean> {
  if (!loadPromise) {
    loadPromise = ctx.audioWorklet.addModule(WORKLET_URL).then(() => {
      console.log('[PSY4] AudioWorklet DSP module loaded');
      return true;
    }).catch((e) => {
      console.warn('[PSY4] AudioWorklet load failed, using fallback:', e);
      return false;
    });
  }
  return loadPromise;
}

// ─── Moog Filter Node ──────────────────────────────────────────────────────

export interface MoogFilterNode extends AudioWorkletNode {
  // AudioParams for real-time / scheduled automation
  cutoff: AudioParam;
  resonance: AudioParam;
  drive: AudioParam;
  level: AudioParam;
}

/**
 * Create a real Moog ladder filter (4-stage tanh) as an AudioWorkletNode.
 * Returns null if worklets not loaded — caller should fall back to BiquadFilter.
 *
 * Parameters:
 *   cutoff    — Hz (20..18000), a-rate (supports per-sample sweeps)
 *   resonance — 0..1 (mapped to Moog self-oscillation)
 *   drive     — 0.1..6 (pre-filter saturation)
 *   level     — 0..4 (output gain)
 */
export function createMoogFilter(ctx: AudioContext, opts?: {
  cutoff?: number; resonance?: number; drive?: number; level?: number;
  channelCount?: number;
}): MoogFilterNode | null {
  let node: AudioWorkletNode;
  try {
    node = new AudioWorkletNode(ctx, 'moog-filter', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: opts?.channelCount ?? 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      parameterData: {
        cutoff: opts?.cutoff ?? 1000,
        resonance: opts?.resonance ?? 0.3,
        drive: opts?.drive ?? 1,
        level: opts?.level ?? 1,
      },
    });
  } catch {
    return null;
  }
  const params = node.parameters;
  return Object.assign(node, {
    cutoff: params.get('cutoff')!,
    resonance: params.get('resonance')!,
    drive: params.get('drive')!,
    level: params.get('level')!,
  });
}

// ─── Band-Limited Saw Node ─────────────────────────────────────────────────

export interface BLSawNode extends AudioWorkletNode {
  frequency: AudioParam;
  pulsewidth: AudioParam;
  level: AudioParam;
  /** Reset oscillator phase (for tight note onset). */
  resetPhase(): void;
}

/**
 * Create a band-limited sawtooth oscillator (polyBLEP — no aliasing).
 * Replaces OscillatorNode + PeriodicWave which alias at high frequencies.
 *
 * This is a SOURCE node (0 inputs, 1 output). Use frequency AudioParam
 * to set pitch, and connect a GainNode for the envelope.
 */
export function createBLSaw(ctx: AudioContext, opts?: {
  frequency?: number; level?: number; pulsewidth?: number;
  channelCount?: number;
}): BLSawNode | null {
  let node: AudioWorkletNode;
  try {
    node = new AudioWorkletNode(ctx, 'bl-saw', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      channelCount: opts?.channelCount ?? 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      parameterData: {
        frequency: opts?.frequency ?? 220,
        level: opts?.level ?? 1,
        pulsewidth: opts?.pulsewidth ?? 0,
      },
    });
  } catch {
    return null;
  }
  const params = node.parameters;
  return Object.assign(node, {
    frequency: params.get('frequency')!,
    pulsewidth: params.get('pulsewidth')!,
    level: params.get('level')!,
    resetPhase() {
      try { (node.port as MessagePort).postMessage({ type: 'reset' }); } catch { /* noop */ }
    },
  });
}

// ─── Band-Limited Square Node ──────────────────────────────────────────────

export interface BLSquareNode extends AudioWorkletNode {
  frequency: AudioParam;
  level: AudioParam;
}

export function createBLSquare(ctx: AudioContext, opts?: {
  frequency?: number; level?: number; channelCount?: number;
}): BLSquareNode | null {
  let node: AudioWorkletNode;
  try {
    node = new AudioWorkletNode(ctx, 'bl-square', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      channelCount: opts?.channelCount ?? 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      parameterData: {
        frequency: opts?.frequency ?? 220,
        level: opts?.level ?? 1,
      },
    });
  } catch {
    return null;
  }
  const params = node.parameters;
  return Object.assign(node, {
    frequency: params.get('frequency')!,
    level: params.get('level')!,
  });
}

// ─── Saturation Node ───────────────────────────────────────────────────────

export interface SaturationNode extends AudioWorkletNode {
  drive: AudioParam;
  mix: AudioParam;
  level: AudioParam;
}

/**
 * Create a tanh saturation processor (PSY3 style_master._sat).
 * drive=1, mix=1 = full saturation. For master bus use drive~1.15, mix~0.15.
 */
export function createSaturation(ctx: AudioContext, opts?: {
  drive?: number; mix?: number; level?: number; channelCount?: number;
}): SaturationNode | null {
  let node: AudioWorkletNode;
  try {
    node = new AudioWorkletNode(ctx, 'saturation', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: opts?.channelCount ?? 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      parameterData: {
        drive: opts?.drive ?? 1,
        mix: opts?.mix ?? 1,
        level: opts?.level ?? 1,
      },
    });
  } catch {
    return null;
  }
  const params = node.parameters;
  return Object.assign(node, {
    drive: params.get('drive')!,
    mix: params.get('mix')!,
    level: params.get('level')!,
  });
}

// ─── Phaser Node ───────────────────────────────────────────────────────────

export interface PhaserNode extends AudioWorkletNode {
  rate: AudioParam;
  depth: AudioParam;
  feedback: AudioParam;
  baseFreq: AudioParam;
  mix: AudioParam;
}

export function createPhaser(ctx: AudioContext, opts?: {
  rate?: number; depth?: number; feedback?: number;
  baseFreq?: number; mix?: number; channelCount?: number;
}): PhaserNode | null {
  let node: AudioWorkletNode;
  try {
    node = new AudioWorkletNode(ctx, 'phaser', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: opts?.channelCount ?? 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      parameterData: {
        rate: opts?.rate ?? 0.5,
        depth: opts?.depth ?? 0.4,
        feedback: opts?.feedback ?? 0.3,
        baseFreq: opts?.baseFreq ?? 800,
        mix: opts?.mix ?? 0.5,
      },
    });
  } catch {
    return null;
  }
  const params = node.parameters;
  return Object.assign(node, {
    rate: params.get('rate')!,
    depth: params.get('depth')!,
    feedback: params.get('feedback')!,
    baseFreq: params.get('baseFreq')!,
    mix: params.get('mix')!,
  });
}

// ─── Bus EQ Node ───────────────────────────────────────────────────────────

export interface BusEQNode extends AudioWorkletNode {
  lowGain: AudioParam;
  lowFreq: AudioParam;
  midGain: AudioParam;
  midFreq: AudioParam;
  midQ: AudioParam;
  highGain: AudioParam;
  highFreq: AudioParam;
}

export function createBusEQ(ctx: AudioContext, opts?: {
  lowGain?: number; lowFreq?: number;
  midGain?: number; midFreq?: number; midQ?: number;
  highGain?: number; highFreq?: number;
  channelCount?: number;
}): BusEQNode | null {
  let node: AudioWorkletNode;
  try {
    node = new AudioWorkletNode(ctx, 'bus-eq', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: opts?.channelCount ?? 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      parameterData: {
        lowGain: opts?.lowGain ?? 0,
        lowFreq: opts?.lowFreq ?? 120,
        midGain: opts?.midGain ?? 0,
        midFreq: opts?.midFreq ?? 1000,
        midQ: opts?.midQ ?? 0.7,
        highGain: opts?.highGain ?? 0,
        highFreq: opts?.highFreq ?? 8000,
      },
    });
  } catch {
    return null;
  }
  const params = node.parameters;
  return Object.assign(node, {
    lowGain: params.get('lowGain')!,
    lowFreq: params.get('lowFreq')!,
    midGain: params.get('midGain')!,
    midFreq: params.get('midFreq')!,
    midQ: params.get('midQ')!,
    highGain: params.get('highGain')!,
    highFreq: params.get('highFreq')!,
  });
}
