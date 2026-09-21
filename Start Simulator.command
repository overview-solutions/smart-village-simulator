#!/usr/bin/env bash
# Double-click in Finder (macOS) — boots live Village Simulator.
# Vite opens http://127.0.0.1:5176/ (see vite.config.js server.open).
set -euo pipefail
cd "$(dirname "$0")"

# Apple Silicon: prefer Homebrew arm64 Node over nvm Rosetta (x64) builds.
# Mixed arch → wrong @rollup/rollup-darwin-* optional dep → Vite crash.
if [[ "$(uname -m)" == "arm64" ]] && [[ -x /opt/homebrew/bin/node ]] && [[ -x /opt/homebrew/bin/npm ]]; then
  export PATH="/opt/homebrew/bin:$PATH"
  hash -r 2>/dev/null || true
else
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  [[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"
  [[ -x /usr/local/bin/npm ]] && export PATH="/usr/local/bin:$PATH"
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Install Node (Homebrew: brew install node) then retry."
  read -r -p "Press Enter to close…"
  exit 1
fi

if [[ ! -d ../../CIR/yang/locus ]]; then
  echo "Missing CIR/yang/locus (file: dep). Open the GitHub workbench clone, or retarget @circaevum/locus in package.json."
  read -r -p "Press Enter to close…"
  exit 1
fi

NODE_ARCH="$(node -p process.arch)"
case "$NODE_ARCH" in
  arm64) ROLLUP_DIR="node_modules/@rollup/rollup-darwin-arm64" ;;
  x64)   ROLLUP_DIR="node_modules/@rollup/rollup-darwin-x64" ;;
  *)     ROLLUP_DIR="" ;;
esac

need_install=0
if [[ ! -d node_modules/vite ]]; then
  need_install=1
elif [[ -n "$ROLLUP_DIR" && ! -d "$ROLLUP_DIR" ]]; then
  echo "Missing $(basename "$ROLLUP_DIR") for Node arch=$NODE_ARCH — repairing…"
  need_install=1
fi

if [[ "$need_install" -eq 1 ]]; then
  echo "npm install (Node $(node -v) · arch $NODE_ARCH)…"
  rm -rf node_modules
  npm install
  if [[ -n "$ROLLUP_DIR" && ! -d "$ROLLUP_DIR" ]]; then
    echo "Native Rollup still missing — full lock reset…"
    rm -rf node_modules package-lock.json
    npm install
  fi
fi

URL="http://127.0.0.1:5176/"
if curl -sf -o /dev/null --connect-timeout 1 "$URL" 2>/dev/null; then
  echo "Already running → opening $URL"
  open "$URL"
  read -r -p "Press Enter to close this window (server keeps running)…"
  exit 0
fi

echo "Node $(node -v) · npm $(npm -v) · arch $NODE_ARCH"
echo "Starting Village Simulator → $URL"
echo "Leave this window open. Ctrl+C stops the server."
exec npm start
