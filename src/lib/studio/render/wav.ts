/**
 * WAV ENCODER — REAL IMPLEMENTATION.
 * Encodes Float32 stereo PCM into a 16-bit PCM WAV file (ArrayBuffer).
 * This is the actual export format of every generated artifact.
 */

export function encodeWav(left: Float32Array, right: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 2;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const numSamples = Math.min(left.length, right.length);
  const dataSize = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  // RIFF header
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  // fmt chunk
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  // data chunk
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM samples (interleaved, clipped to [-1,1], dithered to 16-bit)
  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    let l = left[i]; let r = right[i];
    if (l > 1) l = 1; if (l < -1) l = -1;
    if (r > 1) r = 1; if (r < -1) r = -1;
    // triangular dither
    const dithL = (Math.random() - 0.5) * (1 / 32767);
    const dithR = (Math.random() - 0.5) * (1 / 32767);
    const il = Math.round((l + dithL) * 32767);
    const ir = Math.round((r + dithR) * 32767);
    view.setInt16(off, il, true);
    view.setInt16(off + 2, ir, true);
    off += 4;
  }
  return buffer;
}

/** Compute RMS of a buffer. */
export function rms(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, buf.length));
}

/** Compute peak of a buffer. */
export function peak(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; }
  return p;
}

/** Detect onsets (transients) in a buffer by energy envelope. Returns sample indices. */
export function detectOnsets(buf: Float32Array, threshold = 0.05, windowSize = 64): number[] {
  const onsets: number[] = [];
  let prevEnv = 0;
  for (let i = 0; i < buf.length - windowSize; i += windowSize) {
    let s = 0;
    for (let j = 0; j < windowSize; j++) s += buf[i + j] * buf[i + j];
    const env = Math.sqrt(s / windowSize);
    if (env > threshold && env > prevEnv * 1.5 && env - prevEnv > threshold * 0.5) {
      onsets.push(i);
    }
    prevEnv = env;
  }
  return onsets;
}

/** SHA-256-ish hash of buffer content (for reproducibility checks). */
export function bufferHash(buf: Float32Array): string {
  // FNV-1a 32-bit, sampled for speed
  let h = 2166136261 >>> 0;
  const step = Math.max(1, Math.floor(buf.length / 20000));
  for (let i = 0; i < buf.length; i += step) {
    const v = Math.round(buf[i] * 32767);
    h ^= (v & 0xff);
    h = Math.imul(h, 16777619) >>> 0;
    h ^= ((v >> 8) & 0xff);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
