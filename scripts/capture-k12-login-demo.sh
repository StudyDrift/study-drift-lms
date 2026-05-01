#!/usr/bin/env bash
# Capture login page with Clever/ClassLink buttons (K-12 SSO demo).
# Requires: clients/web/dist built with VITE_API_URL=http://127.0.0.1:9777, demo server script, Xvfb, ffmpeg, google-chrome.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEMO_PORT="${DEMO_PORT:-9777}"
DISPLAY_NUM="${DISPLAY_NUM:-199}"
export DISPLAY=":${DISPLAY_NUM}"
SHOT="/opt/cursor/artifacts/screenshots/k12-login-clever-classlink.png"
VID="/opt/cursor/artifacts/recordings/k12-login-clever-classlink-demo.mp4"

mkdir -p "$(dirname "$SHOT")" "$(dirname "$VID")"

node "$ROOT/scripts/k12-login-demo-server.mjs" "$DEMO_PORT" &
DEMO_PID=$!
cleanup() {
  kill "$DEMO_PID" 2>/dev/null || true
  kill "$XVFB_PID" 2>/dev/null || true
  kill "$FF_PID" 2>/dev/null || true
  kill "$CHROME_PID" 2>/dev/null || true
}
trap cleanup EXIT

for i in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:${DEMO_PORT}/login" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

Xvfb ":${DISPLAY_NUM}" -screen 0 1280x900x24 &
XVFB_PID=$!
sleep 0.5

ffmpeg -y -nostdin -f x11grab -video_size 1280x900 -draw_mouse 0 -i "${DISPLAY}.0" -t 12 -r 12 -pix_fmt yuv420p "$VID" &
FF_PID=$!

sleep 1
google-chrome --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --window-size=1280,900 \
  --app="http://127.0.0.1:${DEMO_PORT}/login" &
CHROME_PID=$!

sleep 9
kill "$CHROME_PID" 2>/dev/null || true
wait "$FF_PID" 2>/dev/null || true

timeout 25 google-chrome --no-sandbox --disable-gpu --headless=new \
  --window-size=1280,900 \
  --screenshot="$SHOT" \
  "http://127.0.0.1:${DEMO_PORT}/login" || true

ls -la "$SHOT" "$VID"
