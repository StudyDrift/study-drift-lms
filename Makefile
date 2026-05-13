.PHONY: e2e e2e-run e2e-teardown

# Run the full e2e suite using an ephemeral Docker environment.
#
# What happens:
#   1. Builds and starts a fresh stack (Postgres, Go server, web) via docker-compose.e2e.yml.
#      Postgres uses tmpfs — all data is discarded when the containers stop.
#   2. Installs Playwright + its Chromium browser binary if not already present.
#   3. Runs all Playwright tests against http://localhost:5173.
#   4. Always tears down the stack and removes volumes on exit.
#
# Requirements: Docker, Docker Compose v2, Node.js ≥ 18
#
# Note on SQLite: the migration files use PostgreSQL-specific syntax (JSONB, UUIDs,
# advisory locks, etc.) and cannot run on SQLite without a full rewrite. Ephemeral
# Postgres achieves the same "no data persists after the run" goal.
e2e:
	@echo "==> Starting ephemeral e2e services…"
	docker compose -f docker-compose.e2e.yml up -d --build --wait || \
	  (docker compose -f docker-compose.e2e.yml logs && docker compose -f docker-compose.e2e.yml down -v && exit 1)
	@echo "==> Installing Playwright dependencies…"
	cd e2e && npm ci --prefer-offline --quiet
	cd e2e && npx playwright install --with-deps chromium
	@echo "==> Running e2e tests…"
	cd e2e && E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:8080 npx playwright test; \
	  EXIT_CODE=$$?; \
	  cd ..; \
	  docker compose -f docker-compose.e2e.yml down -v; \
	  exit $$EXIT_CODE

# Run Playwright tests against an already-running stack (no Docker management).
# Set E2E_BASE_URL and E2E_API_URL if the stack is not on the default ports.
#
# Example (local dev stack running via docker-compose.dev.yml):
#   make e2e-run
# Or against a custom URL:
#   E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:8080 make e2e-run
e2e-run:
	cd e2e && npm ci --prefer-offline --quiet
	cd e2e && npx playwright install --with-deps chromium
	cd e2e && npx playwright test

# Tear down the e2e stack and remove all ephemeral volumes manually.
e2e-teardown:
	docker compose -f docker-compose.e2e.yml down -v
