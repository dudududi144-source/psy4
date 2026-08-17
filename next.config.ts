import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  // FIX B8: removed `typescript.ignoreBuildErrors: true` — was masking real type errors.
  // All 172 TS errors fixed (duplicate getter, private access, null assertions, tuple types).
  // Now tsc --noEmit passes with 0 errors.
  reactStrictMode: false,
  // ADR-009: SharedArrayBuffer support — enables lock-free communication
  // between Web Worker and AudioWorklet (zero-copy, zero-allocation)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ];
  },
};

export default nextConfig;
