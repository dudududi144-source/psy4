import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  // Mark native modules as external — don't let Turbopack try to bundle them.
  // This fixes OOM crashes during route compilation (better-sqlite3 is a native
  // C++ addon that shouldn't be processed by the bundler).
  serverExternalPackages: ['better-sqlite3'],
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
