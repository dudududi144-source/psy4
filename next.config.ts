import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Phase 0: removed `output: "standalone"` — we deploy to Cloudflare Pages
  // via @cloudflare/next-on-pages, not Node standalone.
  reactStrictMode: false,
  // Hide the Next.js dev-tools "N" badge in the bottom-left corner — it
  // looks like an orphan debug indicator on a production-styled UI.
  devIndicators: false,
  // Mark native modules as external — don't let Turbopack try to bundle them.
  // better-sqlite3 is a native C++ addon that shouldn't be processed by the bundler.
  serverExternalPackages: ['better-sqlite3'],
  // Phase 0: REMOVED COOP/COEP headers.
  // ADR-009 claimed SharedArrayBuffer support, but SAB was never implemented.
  // The headers only blocked cross-origin radio streams without enabling anything.
  // Radio CORS is handled by /api/radio/proxy route instead.
};

export default nextConfig;
