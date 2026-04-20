#!/bin/sh
# Dev compose mounts ./clients/web over /app but uses a named volume for node_modules.
# That volume does not pick up new packages when package.json / package-lock.json change on the host.
# Compare both to copies stored inside the volume and run npm ci when they drift.
# Also re-run npm ci if a dependency from package.json is missing under node_modules (stale volume).
set -e
cd /app
mkdir -p node_modules

LOCK_STAMP=node_modules/.package-lock.json
PKG_STAMP=node_modules/.package.json

need_ci=0
if [ ! -f "$LOCK_STAMP" ] || ! cmp -s package-lock.json "$LOCK_STAMP"; then
  need_ci=1
fi
if [ ! -f "$PKG_STAMP" ] || ! cmp -s package.json "$PKG_STAMP"; then
  need_ci=1
fi
# Example: named volume had old node_modules while stamps were wrong/out of sync.
if grep -q '"@dnd-kit/core"' package.json 2>/dev/null && [ ! -d node_modules/@dnd-kit/core ]; then
  need_ci=1
fi
if grep -q '"mark.js"' package.json 2>/dev/null && [ ! -d node_modules/mark.js ]; then
  need_ci=1
fi

if [ "$need_ci" = 1 ]; then
  echo "web: syncing node_modules with package.json / package-lock.json (npm ci)..."
  npm ci --ignore-scripts
  cp package-lock.json "$LOCK_STAMP"
  cp package.json "$PKG_STAMP"
fi
exec "$@"
