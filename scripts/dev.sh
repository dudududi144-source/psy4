#!/usr/bin/env bash
# scripts/dev.sh — single dev server entrypoint (Phase 0 consolidation)
# Replaces: start-dev.sh, run-dev.sh, check-dev.sh, watch-dev.sh,
# persistent-dev.sh, supervise-dev.sh
#
# Usage: ./scripts/dev.sh   (or: bun run dev)
#
# NOTE: We do NOT trap SIGTERM/SIGINT. The server should die cleanly when asked.
# If the server OOMs, fix the leak — do not hold it hostage.

set -euo pipefail
cd "$(dirname "$0")/.."

# Reasonable memory ceiling (fix the leak, don't paper over it)
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"

# Use bun if available, else npx
if command -v bun >/dev/null 2>&1; then
  exec bun run dev
else
  exec npx next dev -p 3000
fi
