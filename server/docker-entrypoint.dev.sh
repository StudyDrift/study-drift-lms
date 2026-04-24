#!/bin/sh
set -e
# samael's build.rs shells out to `xmlsec1-config` (from libxmlsec1-dev). If you see
# "Failed to get --cflags from xmlsec1-config", rebuild: docker compose -f docker-compose.dev.yml build --no-cache server
if ! command -v xmlsec1-config >/dev/null 2>&1; then
  echo "server: xmlsec1-config not in PATH. Rebuild the server image with-xmlsec:" >&2
  echo "  docker compose -f docker-compose.dev.yml build --no-cache server" >&2
  exit 1
fi
rm -f /app/target/debug/study_drift_server
exec cargo watch -q -x run --poll
