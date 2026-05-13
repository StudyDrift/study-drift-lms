#!/usr/bin/env bash
# Run the e2e suite using an ephemeral Docker stack (postgres on tmpfs).
# All data is destroyed when `docker compose down -v` is called at the end.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

cleanup() {
  echo "==> Tearing down Docker e2e stack…"
  docker compose -f docker-compose.e2e.yml down -v 2>/dev/null || true
}
trap cleanup EXIT

echo "==> Starting ephemeral Docker e2e stack…"
docker compose -f docker-compose.e2e.yml up -d --build --wait || {
  echo "ERROR: docker compose failed to start. Logs:"
  docker compose -f docker-compose.e2e.yml logs --tail=80
  exit 1
}

echo "==> Installing Playwright dependencies…"
cd e2e
npm ci --prefer-offline --quiet
npx playwright install --with-deps chromium

echo "==> Running Playwright tests…"
E2E_BASE_URL="http://localhost:5173" \
  E2E_API_URL="http://localhost:8080" \
  npx playwright test
