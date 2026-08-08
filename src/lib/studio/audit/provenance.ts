/**
 * PROVENANCE SYSTEM — every artifact gets a verifiable provenance record.
 * REAL IMPLEMENTATION.
 *
 * A reviewer must be able to determine exactly how an artifact was generated.
 */

import * as crypto from 'crypto';

export interface Provenance {
  artifactId: string;
  artifactName: string;
  fileName: string;
  // configuration
  configHash: string;
  seed: number;
  bpm: number;
  sampleRate: number;
  bars: number;
  key: string;
  scale: string;
  // versions
  engineVersion: string;
  testVersion: string;
  pipelineVersion: string;
  // execution
  timestamp: string;
  renderDurationMs: number;
  audioDurationSec: number;
  // validation
  validationResult: 'PASS' | 'FAIL';
  validationReasons: string[];
  // integrity
  artifactSha256: string;
  audioHash: string;       // FNV hash of audio buffer
  peak: number;
  rms: number;
}

export const ENGINE_VERSION = 'psy4-engine-1.0.0';
export const TEST_VERSION = 'psy4-tests-1.0.0';
export const PIPELINE_VERSION = 'psy4-pipeline-1.0.0';

/** SHA-256 of a WAV ArrayBuffer. */
export function sha256(buf: ArrayBuffer | Buffer): string {
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** FNV-1a hash of a Float32Array (audio content hash). */
export function audioHash(buf: Float32Array): string {
  let h = 2166136261 >>> 0;
  const step = Math.max(1, Math.floor(buf.length / 20000));
  for (let i = 0; i < buf.length; i += step) {
    const v = Math.round(buf[i] * 32767) & 0xffff;
    h = Math.imul(h ^ v, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Build a provenance record for a generated artifact. */
export function buildProvenance(opts: {
  artifactId: string;
  artifactName: string;
  fileName: string;
  seed: number;
  bpm: number;
  sampleRate: number;
  bars: number;
  key: string;
  scale: string;
  renderDurationMs: number;
  audioDurationSec: number;
  wavBuffer: ArrayBuffer;
  left: Float32Array;
  peak: number;
  rms: number;
  validationResult: 'PASS' | 'FAIL';
  validationReasons: string[];
}): Provenance {
  const configString = `${opts.seed}|${opts.bpm}|${opts.sampleRate}|${opts.bars}|${opts.key}|${opts.scale}|${ENGINE_VERSION}`;
  const configHash = crypto.createHash('sha256').update(configString).digest('hex').slice(0, 16);
  return {
    artifactId: opts.artifactId,
    artifactName: opts.artifactName,
    fileName: opts.fileName,
    configHash,
    seed: opts.seed,
    bpm: opts.bpm,
    sampleRate: opts.sampleRate,
    bars: opts.bars,
    key: opts.key,
    scale: opts.scale,
    engineVersion: ENGINE_VERSION,
    testVersion: TEST_VERSION,
    pipelineVersion: PIPELINE_VERSION,
    timestamp: new Date().toISOString(),
    renderDurationMs: opts.renderDurationMs,
    audioDurationSec: opts.audioDurationSec,
    validationResult: opts.validationResult,
    validationReasons: opts.validationReasons,
    artifactSha256: sha256(opts.wavBuffer),
    audioHash: audioHash(opts.left),
    peak: opts.peak,
    rms: opts.rms,
  };
}
