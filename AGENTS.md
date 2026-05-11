# AGENTS.md

## Cursor Cloud specific instructions

### Architecture

Lextures is an LMS (Learning Management System) with two main services:

- **Go API** (`server/`): Go 1.25, Chi router, pgx for PostgreSQL, JWT auth. Runs on port 8080.
- **React SPA** (`clients/web/`): React 19, Vite 8, TypeScript 6, Tailwind CSS v4. Runs on port 5173.
- **PostgreSQL 16**: Primary data store (Docker container, port 5432). Credentials: `studydrift/studydrift`, database `studydrift`.
- **MongoDB 7**: Wired but currently unused by the Go API.

### Starting services

1. **Databases**: `docker compose -f docker-compose.yml up -d postgres mongo` (from repo root)
2. **Go API**: `cd server && go run ./cmd/server` (requires env vars below)
3. **Web frontend**: `cd clients/web && npm run dev -- --host 0.0.0.0 --port 5173`

Required env vars for the Go API (copy from `server/.env.example` to `server/.env`):
- `DATABASE_URL=postgres://studydrift:studydrift@localhost:5432/studydrift?sslmode=disable`
- `JWT_SECRET=change-me-use-at-least-32-characters-for-production`
- `BOOTSTRAP_ADMIN_EMAIL` — optional; if set to your email, the **first** password signup on an empty human user table gets Global Admin. If unset, use `cd server && go run ./cmd/bootstrap-admin -email=you@example.com` after creating an account.
- `RUN_MIGRATIONS=true`
- `PORT=8080`
- `PUBLIC_WEB_ORIGIN=http://localhost:5173`
- `COURSE_FILES_ROOT=data/course-files`

Frontend env: `VITE_API_URL=http://localhost:8080` (set when running `npm run dev`).

### Commands reference

| Task | Command | Working Directory |
|------|---------|-------------------|
| Go build | `go build -o bin/server ./cmd/server` | `server/` |
| Grant Global Admin (CLI) | `go run ./cmd/bootstrap-admin -email=user@example.com` | `server/` (needs `DATABASE_URL`) |
| Go test (short, no DB) | `go test ./... -count=1 -short -timeout=1m` | `server/` |
| Go test (full, needs DB) | `make test` (needs `DATABASE_URL`) | `server/` |
| Go lint | `golangci-lint run ./...` | `server/` |
| Frontend lint | `npx eslint .` | `clients/web/` |
| Frontend typecheck | `npm run typecheck` | `clients/web/` |
| Frontend tests | `npm run test` | `clients/web/` |
| Frontend dev server | `npm run dev` | `clients/web/` |
| Storybook | `npm run storybook` | `clients/web/` |

### Gotchas

- The Go project uses Go 1.25, which requires a recent Go installation (not the Ubuntu default 1.22).
- `golangci-lint` must be built with Go >= 1.25 to lint this project. Use the latest version.
- The password-signup endpoint enforces HIBP (Have I Been Pwned) breach checking. Use long, random passwords for test accounts.
- MongoDB is wired in `docker-compose.yml` but the Go API does not currently connect to it. It is started as a health-check dependency; you can omit it for local-only dev if you run the server directly.
- The pre-commit hook (`.husky/pre-commit`) runs `lint-staged` (ESLint fix) and `tsc -b` from `clients/web/`. This runs automatically on commit if husky is installed.
- Docker daemon must be started manually with `dockerd &>/var/log/dockerd.log &` before using `docker compose` commands in this VM environment.
- The fuse-overlayfs storage driver and iptables-legacy are required for Docker-in-Docker in this environment.
