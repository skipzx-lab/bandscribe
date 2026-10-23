#!/usr/bin/env bash
# Starts the app at http://localhost:8765 (set PORT to change it)
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8765}"
export PYTHONPATH="$PWD/backend"
open_browser() {
  sleep 2
  if [ "$(uname)" = Darwin ]; then open "http://localhost:$PORT"
  elif command -v xdg-open >/dev/null; then xdg-open "http://localhost:$PORT"
  fi
}
open_browser >/dev/null 2>&1 &
exec .venv/bin/python -m uvicorn bandscribe.server:app --host 127.0.0.1 --port "$PORT"
