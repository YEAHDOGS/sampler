#!/usr/bin/env bash
# DOGS Sampler — dev server launcher (macOS/Linux/WSL).
# Runs `npm run dev` on all interfaces so phones on the LAN can preview.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found — install Node.js first." >&2
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "node_modules missing — installing…"
  npm install
fi

exec npm run dev -- --host --port 5173
