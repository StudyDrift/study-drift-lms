# Lextures API (Go)

This is the new Go-based HTTP service. It **does not** replace the Rust `server/` tree yet; the repo
keeps both so you can audit, compare, and cut traffic over on your own schedule.

## What is implemented

- **Configuration** (`internal/config`) aligned with `server/src/config.rs` (environment variables, defaults, validation).
- **Migrations** (`migrations/`) are the same numbered SQL as the Rust server, embedded via `migrations/embed.go`. The
  migrator in `internal/migrate` is SQLx-aware: if `public._sqlx_migrations` already exists, versions found there
  are marked applied in `lextures_go_migrations` **without re-running** SQL, so a database migrated by the Rust
  service can be picked up by this binary.
- **HTTP** (`internal/httpserver`): liveness, readiness, minimal OpenAPI stub, and broad **HTTP 501** responses
  for API routes not yet implemented in Go. CORS is permissive (match the Axum + tower stack).
- **Docker** / **Make** / **CI** in this directory support local runs and the GitHub Actions `server-go` job.

## What still needs a port

The previous backend is a large surface (`server/src/`, on the order of tens of thousands of lines of Rust). Each
`routes/*.rs` module, repository, and service has to be reimplemented in Go. This module purposefully provides a
small, test-heavy foundation and a **compatible migration + HTTP shell** so that work can proceed in focused PRs.

## Running

```bash
# From repo root (loads server/.env or .env)
cd server-new
cp .env.example .env   # optional: edit for local Postgres
docker compose up --build
```

The API listens on **:8080** and exposes:

- `GET /health` — liveness
- `GET /health/ready` — database + schema check (see Rust `routes::health::ready`)
- `GET /api/openapi.json` — small OpenAPI placeholder
- `GET /api/docs` — static pointer page
- Any other path under `/api/...` or `/auth/...` currently returns **501** until implemented

## Development

```bash
make test        # unit tests + coverage gate
make lint        # golangci-lint when installed
go run ./cmd/lextures-server
```

## Coverage

`make test` enforces a **90% statement minimum** (measured on the same package set) for `internal/config`,
`internal/db`, `internal/migrate`, `internal/httpserver`, and the `migrations` embed package. Tests require
`TEST_DATABASE_URL` (set automatically in GitHub Actions next to the Postgres service). The `internal/app` and
`cmd/lextures-server` entrypoints are not included in the gate so the floor reflects library code quality.
