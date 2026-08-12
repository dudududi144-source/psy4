/**
 * Reality Bridge test setup — installs global shims BEFORE psyLive imports.
 *
 * The shimmed modules use `window`, `localStorage`, `AudioContext`, etc.
 * We expose them as globals so the TypeScript files under test can be
 * imported by Bun without a DOM.
 */
import { AudioContextShim, AudioBufferShim, localStorageShim } from './reality-bridge/audioShim';

// Globals required by learning.ts and psyLive.ts
(globalThis as any).AudioContext = AudioContextShim as any;
(globalThis as any).webkitAudioContext = AudioContextShim as any;
(globalThis as any).AudioBuffer = AudioBufferShim as any;
(globalThis as any).window = globalThis;
(globalThis as any).localStorage = localStorageShim;
(globalThis as any).document = {
  createElement: () => ({ getContext: () => null }),
};
(globalThis as any).Audio = class {
  src = '';
  crossOrigin = '';
  async play(): Promise<void> {}
  pause(): void {}
};
export {};
