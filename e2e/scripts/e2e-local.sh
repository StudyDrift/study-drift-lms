#!/usr/bin/env bash
# Run the e2e suite without Docker using an ephemeral local Postgres cluster.
#
# Steps:
#   1. Locate system PostgreSQL binaries (Homebrew, Linux packages, pg_config).
#   2. initdb a fresh data directory in /tmp.
#   3. Start Postgres on a private port (5454) to avoid colliding with any dev DB.
#   4. Start the Go API server via `go run`.
#   5. Start the Vite web client in dev mode.
#   6. Run Playwright tests.
#   7. On exit (pass or fail): kill all processes, stop Postgres, delete the
#      temp data directory -- zero data persists.
#
# Why not SQLite?
#   The Go server uses jackc/pgx v5 with 653 call sites across 73+ repository
#   files, and the 140+ migration files use PostgreSQL-specific syntax (JSONB,
#   uuid_generate_v4, advisory locks, pg schemas, etc.).  Ephemeral Postgres
#   achieves the same "nothing persists" guarantee without touching the server.
#
# Requirements:
#   - PostgreSQL binaries (brew install postgresql@16 / apt install postgresql)
#   - Go toolchain (go run must work from server/)
#   - Node.js + npm

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PIDS=()
PGDATA_DIR=""
E2E_PG_PORT="${E2E_PG_PORT:-5454}"
E2E_PG_DB="lextures_e2e"
E2E_PG_USER="e2e"
# These are intentionally weak secrets used only for the throwaway test cluster.
E2E_JWT_SECRET="e2e-test-secret-local-do-not-use-outside-tests"
E2E_ADMIN_EMAIL="admin@e2e.test"

# Cleanup runs on any exit (pass, fail, or Ctrl-C).
cleanup() {
  echo ""
  echo "==> Tearing down local e2e stack..."
  for pid in "${PIDS[@]-}"; do
    kill "$pid" 2>/dev/null || true
  done
  if [[ -n "${PGDATA_DIR}" && -d "${PGDATA_DIR}" ]]; then
    "${PG_CTL:-pg_ctl}" -D "${PGDATA_DIR}" stop -m fast 2>/dev/null || true
    rm -rf "${PGDATA_DIR}"
    echo "    Ephemeral Postgres data dir removed."
  fi
}
trap cleanup EXIT

# Locate a PostgreSQL binary by searching common installation paths.
find_pg_bin() {
  local name="$1"
  local candidates=(
    "/opt/homebrew/opt/postgresql@16/bin/${name}"
    "/opt/homebrew/opt/postgresql@15/bin/${name}"
    "/opt/homebrew/opt/postgresql@14/bin/${name}"
    "/opt/homebrew/bin/${name}"
    "/usr/local/bin/${name}"
    "/usr/bin/${name}"
  )
  if command -v pg_config &>/dev/null; then
    candidates+=("$(pg_config --bindir)/${name}")
  fi
  for c in "${candidates[@]}"; do
    if [[ -x "${c}" ]]; then echo "${c}"; return 0; fi
  done
  return 1
}

INITDB=$(find_pg_bin initdb || true)
PG_CTL=$(find_pg_bin pg_ctl || true)
CREATEDB=$(find_pg_bin createdb || true)

if [[ -z "${INITDB}" || -z "${PG_CTL}" || -z "${CREATEDB}" ]]; then
  echo "ERROR: PostgreSQL binaries not found."
  echo ""
  echo "  macOS (Homebrew):  brew install postgresql@16"
  echo "  Ubuntu/Debian:     sudo apt install postgresql"
  echo "  Or run with Docker: make e2e  (with Docker Desktop running)"
  exit 1
fi

echo "  pg_ctl: ${PG_CTL}"

# Create a fresh, isolated Postgres cluster in a temp directory.
PGDATA_DIR=$(mktemp -d /tmp/lextures-e2e-pgdata.XXXXXX)
echo "==> Initialising ephemeral Postgres in ${PGDATA_DIR}"
"${INITDB}" -D "${PGDATA_DIR}" \
  --username="${E2E_PG_USER}" \
  --no-locale --encoding=UTF8 --auth=trust -q

echo "==> Starting Postgres on port ${E2E_PG_PORT}"
"${PG_CTL}" -D "${PGDATA_DIR}" \
  -l "${PGDATA_DIR}/pg.log" \
  -o "-p ${E2E_PG_PORT} -c listen_addresses=localhost" \
  start

# Wait until Postgres is accepting connections.
for i in $(seq 1 20); do
  "${PG_CTL}" -D "${PGDATA_DIR}" status &>/dev/null && break
  sleep 0.5
  if [[ "${i}" -eq 20 ]]; then echo "ERROR: Postgres did not start."; exit 1; fi
done

"${CREATEDB}" -h localhost -p "${E2E_PG_PORT}" -U "${E2E_PG_USER}" "${E2E_PG_DB}"
DATABASE_URL="postgres://${E2E_PG_USER}@localhost:${E2E_PG_PORT}/${E2E_PG_DB}?sslmode=disable"

# Start the Go API server.
echo "==> Starting Go API server..."
cd "${REPO_ROOT}/server"
DATABASE_URL="${DATABASE_URL}" \
  JWT_SECRET="${E2E_JWT_SECRET}" \
  BOOTSTRAP_ADMIN_EMAIL="${E2E_ADMIN_EMAIL}" \
  RUN_MIGRATIONS="true" \
  COURSE_FILES_ROOT="${REPO_ROOT}/data/course-files" \
  PORT="8080" \
  go run ./cmd/server &
PIDS+=($!)
cd "${REPO_ROOT}"

echo "==> Waiting for API server at http://localhost:8080/health"
for i in $(seq 1 30); do
  curl -sf http://localhost:8080/health &>/dev/null && break
  sleep 2
  if [[ "${i}" -eq 30 ]]; then
    echo "ERROR: API server did not become healthy. Check output above."
    exit 1
  fi
done
echo "    API server healthy."

# Start the Vite web client.
echo "==> Starting web client on port 5173..."
cd "${REPO_ROOT}/clients/web"
VITE_API_URL="http://localhost:8080" npm run dev -- --port 5173 --strictPort &
PIDS+=($!)
cd "${REPO_ROOT}"

echo "==> Waiting for web client at http://localhost:5173"
for i in $(seq 1 30); do
  curl -sf http://localhost:5173 &>/dev/null && break
  sleep 2
  if [[ "${i}" -eq 30 ]]; then
    echo "ERROR: Web client did not become healthy."
    exit 1
  fi
done
echo "    Web client healthy."

# Run Playwright.
echo "==> Running Playwright tests..."
cd "${REPO_ROOT}/e2e"
npm ci --prefer-offline --quiet
npx playwright install --with-deps chromium
E2E_BASE_URL="http://localhost:5173" \
  E2E_API_URL="http://localhost:8080" \
  npx playwright test
