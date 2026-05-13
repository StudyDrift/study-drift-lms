#!/usr/bin/env bash
# Start an ephemeral local e2e stack without Docker.
#
# What this does:
#   1. Initialises a fresh PostgreSQL data directory in a temp folder (using the
#      system PostgreSQL binaries — Homebrew, Linux package, etc.).
#   2. Starts that Postgres instance on a private port (5454) so it does not
#      collide with any running development database.
#   3. Starts the Go API server via `go run` pointed at that database.
#   4. Starts the Vite web client in preview/dev mode.
#   5. Runs Playwright tests.
#   6. On exit (pass or fail), kills all spawned processes and removes the
#      temporary Postgres data directory — zero data persists.
#
# Why not SQLite?
#   The Go server uses jackc/pgx v5 throughout (653 call sites across 73+
#   repository files) and the 140+ migration files use PostgreSQL-specific
#   syntax (JSONB, uuid_generate_v4, advisory locks, pg schemas, etc.).
#   Dropping in SQLite would require rewriting every query and every migration
#   file — a multi-week effort.  An ephemeral Postgres cluster achieves the
#   same "nothing persists after the test run" guarantee with zero server
#   changes.
#
# Requirements (non-Docker path):
#   - PostgreSQL binaries installed (Homebrew: `brew install postgresql@16`,
#     Ubuntu: `sudo apt install postgresql`, or Postgres.app on macOS)
#   - Go toolchain (`go run` must work)
#   - Node.js + npm

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PIDS=()
PGDATA_DIR=""
E2E_PG_PORT="${E2E_PG_PORT:-5454}"
E2E_PG_DB="lextures_e2e"
E2E_PG_USER="e2e"

# ── Cleanup ──────────────────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "==> Tearing down local e2e stack…"
  for pid in "${PIDS[@]-}"; do
    kill "$pid" 2>/dev/null || true
  done
  if [[ -n "$PGDATA_DIR" && -d "$PGDATA_DIR" ]]; then
    "$PG_CTL" -D "$PGDATA_DIR" stop -m fast 2>/dev/null || true
    rm -rf "$PGDATA_DIR"
    echo "    Ephemeral Postgres data dir removed."
  fi
}
trap cleanup EXIT

# ── Locate PostgreSQL binaries ────────────────────────────────────────────────
find_pg_bin() {
  local name="$1"
  local candidates=(
    "/opt/homebrew/opt/postgresql@16/bin/$name"
    "/opt/homebrew/opt/postgresql@15/bin/$name"
    "/opt/homebrew/bin/$name"
    "/usr/local/bin/$name"
    "/usr/bin/$name"
  )
  # Also check pg_ctl from pg_config if available
  if command -v pg_config &>/dev/null; then
    candidates+=("$(pg_config --bindir)/$name")
  fi
  for c in "${candidates[@]}"; do
    if [[ -x "$c" ]]; then echo "$c"; return 0; fi
  done
  return 1
}

INITDB=$(find_pg_bin initdb || true)
PG_CTL=$(find_pg_bin pg_ctl || true)
CREATEDB=$(find_pg_bin createdb || true)

if [[ -z "$INITDB" || -z "$PG_CTL" || -z "$CREATEDB" ]]; then
  echo "ERROR: PostgreSQL binaries not found."
  echo ""
  echo "  macOS (Homebrew):  brew install postgresql@16"
  echo "  Ubuntu/Debian:     sudo apt install postgresql"
  echo "  Or run with Docker:  make e2e  (with Docker Desktop running)"
  exit 1
fi

echo "  Using: $PG_CTL"

# ── Ephemeral PostgreSQL ──────────────────────────────────────────────────────
PGDATA_DIR=$(mktemp -d /tmp/lextures-e2e-pgdata.XXXXXX)
echo "==> Initialising ephemeral Postgres in $PGDATA_DIR…"
"$INITDB" -D "$PGDATA_DIR" --username="$E2E_PG_USER" \
  --no-locale --encoding=UTF8 --auth=trust -q

echo "==> Starting Postgres on port $E2E_PG_PORT…"
"$PG_CTL" -D "$PGDATA_DIR" \
  -l "$PGDATA_DIR/pg.log" \
  -o "-p $E2E_PG_PORT -c listen_addresses=localhost" \
  start

# Wait until ready
for i in $(seq 1 20); do
  "$PG_CTL" -D "$PGDATA_DIR" status &>/dev/null && break
  sleep 0.5
  if [[ $i -eq 20 ]]; then echo "ERROR: Postgres did not start."; exit 1; fi
done

"$CREATEDB" -h localhost -p "$E2E_PG_PORT" -U "$E2E_PG_USER" "$E2E_PG_DB"
DATABASE_URL="postgres://$E2E_PG_USER@localhost:$E2E_PG_PORT/$E2E_PG_DB?sslmode=disable"

# ── Go API server ─────────────────────────────────────────────────────────────
echo "==> Starting Go API server (go run)…"
cd "$REPO_ROOT/server"
DATABASE_URL="$DATABASE_URL" \
  JWT_SECRET="e2e-test-secret-local-do-not-use-outside-tests" \
  BOOTSTRAP_ADMIN_EMAIL="admin@e2e.test" \
  RUN_MIGRATIONS="true" \
  COURSE_FILES_ROOT="$REPO_ROOT/data/course-files" \
  PORT="8080" \
  go run ./cmd/server &
PIDS+=($!)
cd "$REPO_ROOT"

echo "==> Waiting for API server (http://localhost:8080/health)…"
for i in $(seq 1 30); do
  curl -sf http://localhost:8080/health &>/dev/null && break
  sleep 2
  if [[ $i -eq 30 ]]; then
    echo "ERROR: API server did not become healthy in time."
    echo "       Check $REPO_ROOT/server logs above for details."
    exit 1
  fi
done

# ── Web client ────────────────────────────────────────────────────────────────
echo "==> Starting web client (Vite dev on port 5173)…"
cd "$REPO_ROOT/clients/web"
VITE_API_URL="http://localhost:8080" npm run dev -- --port 5173 --strictPort &
PIDS+=($!)
cd "$REPO_ROOT"

echo "==> Waiting for web client (http://localhost:5173)…"
for i in $(seq 1 30); do
  curl -sf http://localhost:5173 &>/dev/null && break
  sleep 2
  if [[ $i -eq 30 ]]; then
    echo "ERROR: Web client did not become healthy in time."
    exit 1
  fi
done

# ── Playwright ────────────────────────────────────────────────────────────────
echo "==> Running Playwright tests…"
cd "$REPO_ROOT/e2e"
npm ci --prefer-offline --quiet
npx playwright install --with-deps chromium
E2E_BASE_URL="http://localhost:5173" \
  E2E_API_URL="http://localhost:8080" \
  npx playwright test
