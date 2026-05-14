#!/usr/bin/env bash
# Run the e2e suite without Docker using an ephemeral local Postgres cluster.
#
# Usage:
#   ./e2e/scripts/e2e-local.sh              # full suite (cwd: repo root)
#   ./e2e/scripts/e2e-local.sh tests/inbox.spec.ts
#   ./e2e/scripts/e2e-local.sh e2e/tests/inbox.spec.ts   # same; e2e/ prefix is stripped
# Any extra arguments are passed through to `playwright test` (e.g. --headed, --grep).
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

# Declared up-front so `set -u` never trips on `"${PLAYWRIGHT_TEST_ARGS[@]}"` when the
# suite is invoked with no extra args (e.g. `make e2e`) on Bash 3.2 / strict nounset.
declare -a PLAYWRIGHT_TEST_ARGS=()

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PIDS=()
PGDATA_DIR=""
E2E_PG_PORT="${E2E_PG_PORT:-5454}"

# `go run` and `npm run dev` are parents of the real long-lived processes. A plain
# `kill $pid` often stops only the wrapper, leaving the API or Vite child alive.
# Those orphans keep hitting DATABASE_URL (ephemeral Postgres) after teardown.
kill_tree() {
  local pid="$1"
  local children
  children="$(pgrep -P "${pid}" 2>/dev/null || true)"
  for c in ${children}; do
    kill_tree "${c}"
  done
  if kill -0 "${pid}" 2>/dev/null; then
    kill -TERM "${pid}" 2>/dev/null || true
  fi
}

force_kill_tree() {
  local pid="$1"
  local children
  children="$(pgrep -P "${pid}" 2>/dev/null || true)"
  for c in ${children}; do
    force_kill_tree "${c}"
  done
  kill -KILL "${pid}" 2>/dev/null || true
}
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
    kill_tree "${pid}"
  done
  # Let child processes (compiled server, Vite) exit after the wrapper receives SIGTERM.
  sleep 1
  for pid in "${PIDS[@]-}"; do
    if kill -0 "${pid}" 2>/dev/null; then
      force_kill_tree "${pid}"
    fi
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
  --no-locale --encoding=UTF8 --auth=trust \
  > /dev/null

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

# Avoid colliding with a dev API already bound to 8080 (curl would pass while `go run` exited).
E2E_API_PORT="${E2E_API_PORT:-}"
if [[ -z "${E2E_API_PORT}" ]]; then
  if command -v python3 &>/dev/null; then
    E2E_API_PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("", 0)); print(s.getsockname()[1]); s.close()')"
  else
    E2E_API_PORT="8080"
  fi
fi

# Start the Go API server.
echo "==> Starting Go API server on port ${E2E_API_PORT}..."
cd "${REPO_ROOT}/server"
DATABASE_URL="${DATABASE_URL}" \
  JWT_SECRET="${E2E_JWT_SECRET}" \
  BOOTSTRAP_ADMIN_EMAIL="${E2E_ADMIN_EMAIL}" \
  RUN_MIGRATIONS="true" \
  COURSE_FILES_ROOT="${REPO_ROOT}/data/course-files" \
  PORT="${E2E_API_PORT}" \
  go run ./cmd/server &
PIDS+=($!)
cd "${REPO_ROOT}"

echo "==> Waiting for API server at http://localhost:${E2E_API_PORT}/health"
for i in $(seq 1 30); do
  curl -sf "http://localhost:${E2E_API_PORT}/health" &>/dev/null && break
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
VITE_API_URL="http://localhost:${E2E_API_PORT}" npm run dev -- --port 5173 --strictPort &
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

# Run Playwright. Optional args are forwarded to `playwright test` (paths relative to
# e2e/ after cd). Paths given as e2e/tests/... from repo root are normalized.
echo "==> Running Playwright tests..."
cd "${REPO_ROOT}/e2e"
npm ci --prefer-offline --quiet
npx playwright install --with-deps chromium
PLAYWRIGHT_TEST_ARGS=()
for arg in "$@"; do
  if [[ "${arg}" == e2e/* ]]; then
    PLAYWRIGHT_TEST_ARGS+=("${arg#e2e/}")
  else
    PLAYWRIGHT_TEST_ARGS+=("${arg}")
  fi
done
if [[ "${#PLAYWRIGHT_TEST_ARGS[@]}" -gt 0 ]]; then
  E2E_BASE_URL="http://localhost:5173" \
    E2E_API_URL="http://localhost:${E2E_API_PORT}" \
    npx playwright test "${PLAYWRIGHT_TEST_ARGS[@]}"
else
  E2E_BASE_URL="http://localhost:5173" \
    E2E_API_URL="http://localhost:${E2E_API_PORT}" \
    npx playwright test
fi
