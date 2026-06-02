#!/usr/bin/env bash
# Build the Go backend as a Tauri sidecar binary.
#
# Tauri's sidecar convention requires the binary to be named
#   <name>-<rust-target-triple>
# and to live at the path declared by `bundle.externalBin` in tauri.conf.json
# (which is `binaries/cogload-backend` here, relative to src-tauri/).
#
# By default we build for the host architecture only. Pass --all to also
# cross-compile for the other macOS arch (useful for universal release builds).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
OUT_DIR="$REPO_ROOT/frontend/src-tauri/binaries"
NAME="cogload-backend"

mkdir -p "$OUT_DIR"

build_one() {
  local goarch="$1"
  local triple="$2"
  local out="$OUT_DIR/${NAME}-${triple}"

  echo "→ building $NAME for $triple"
  (
    cd "$BACKEND_DIR"
    CGO_ENABLED=1 GOOS=darwin GOARCH="$goarch" \
      go build -trimpath -ldflags="-s -w" -o "$out" ./cmd/cogload
  )
  chmod +x "$out"
  echo "  wrote $out"
}

# Detect host arch by default.
HOST_ARCH="$(uname -m)"
case "$HOST_ARCH" in
  arm64|aarch64) HOST_GOARCH="arm64"; HOST_TRIPLE="aarch64-apple-darwin" ;;
  x86_64)        HOST_GOARCH="amd64"; HOST_TRIPLE="x86_64-apple-darwin" ;;
  *) echo "Unsupported host arch: $HOST_ARCH" >&2; exit 1 ;;
esac

if [[ "${1:-}" == "--all" ]]; then
  build_one "arm64" "aarch64-apple-darwin"
  build_one "amd64" "x86_64-apple-darwin"
else
  build_one "$HOST_GOARCH" "$HOST_TRIPLE"
fi

echo "✓ backend sidecar build complete"
