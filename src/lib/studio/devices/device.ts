/**
 * DEVICE BASE — common interface for all digital twins.
 *
 * Every device implements processBlock(), which ADDS its stereo output into
 * the supplied buffers for the current block. The render engine pumps the
 * transport and calls processBlock() on every active device.
 *
 * Boundaries are explicit:
 *  - synth/drum/sampler devices: REAL_IMPLEMENTATION (DSP computes samples)
 *  - control logic mirroring hardware: SIMULATED_HARDWARE_BEHAVIOR
 *  - the physical box: EXTERNAL_HARDWARE_REQUIREMENT (noted in each class)
 */

import { Transport } from '../clock';

export interface DeviceContext {
  transport: Transport;
  /** Absolute sample index of the block start. */
  blockStart: number;
  /** Number of samples in the block. */
  blockSize: number;
}

export abstract class Device {
  abstract id: string;
  abstract name: string;
  /** True if this device produces audio (synth/drum/sampler/FX). */
  abstract producesAudio: boolean;
  /** True if this device consumes audio (FX/hub/master). */
  abstract consumesAudio: boolean;
  /** Current amplitude peak (for validation / meters). */
  peak = 0;

  /** Add this device's stereo contribution to outL/outR. */
  abstract processBlock(outL: Float32Array, outR: Float32Array, ctx: DeviceContext): void;

  /** Reset internal state (for clean reruns / reproducibility). */
  abstract reset(): void;

  /** Schedule a note-on at an absolute sample position. */
  noteOn(_note: number, _velocity: number, _sample: number, _duration = 0) {}
  /** Schedule a note-off. */
  noteOff(_note: number, _sample: number) {}
}

/** Mix stereo src into dst (accumulate). */
export function accumulate(dst: Float32Array, src: Float32Array, gain: number, offset = 0) {
  const n = Math.min(dst.length - offset, src.length);
  for (let i = 0; i < n; i++) dst[offset + i] += src[i] * gain;
}

/** Stereo accumulate with separate L/R gains. */
export function accumulateStereo(
  dstL: Float32Array, dstR: Float32Array,
  srcL: Float32Array, srcR: Float32Array,
  gain: number, offset = 0
) {
  const n = Math.min(dstL.length - offset, srcL.length);
  for (let i = 0; i < n; i++) {
    dstL[offset + i] += srcL[i] * gain;
    dstR[offset + i] += srcR[i] * gain;
  }
}
