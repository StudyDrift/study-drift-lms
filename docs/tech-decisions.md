# StudyDrift — technical decisions and architecture

This document records the main technology choices and how the system is structured. It is meant for onboarding and future design discussions; it is not a substitute for reading the code or compose files.

## Product context

**StudyDrift** is the working name for the application. The codebase is organized as a small monorepo with a Rust HTTP API, a browser client, and infrastructure defined in Docker Compose.

## Repository layout


| Path                      | Role                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `server/`                 | Rust backend (HTTP API). Own `Cargo.toml`, `Dockerfile`, `Dockerfile.dev`.                            |
| `clients/web/`            | React single-page app: TypeScript, Vite, Tailwind, Vitest. Own `Dockerfile`, `Dockerfile.dev`.        |
| `docker-compose.yml`      | Shared stack: Postgres, MongoDB, API server, web build context (no published `web` ports; see below). |
| `docker-compose.dev.yml`  | Development overrides: bind mounts, Vite dev server, `cargo-watch`.                                   |
| `docker-compose.prod.yml` | Production-style web: maps host port **3000** to nginx **80**.                                        |


The base compose file intentionally **does not** publish ports for the `web` service. Docker Compose merges `ports` arrays across files by **concatenating** them, which would otherwise expose both the production nginx port and the Vite dev port at once. Splitting `web` ports into `docker-compose.prod.yml` and `docker-compose.dev.yml` avoids duplicate mappings.

## Backend (Rust)


| Decision                         | Rationale                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Rust**                         | Predictable performance, strong typing, and a single binary for deployment.                          |
| **Axum**                         | Async HTTP framework on Tokio with a straightforward router and extractor model.                     |
| **Tokio**                        | De facto async runtime for the ecosystem used by Axum.                                               |
| **tower-http CORS**              | Browser client may run on a different origin/port than the API during development.                   |
| **serde / serde_json**           | JSON request and response bodies.                                                                    |
| **tracing + tracing-subscriber** | Structured logs; level controlled with `RUST_LOG` (e.g. `info` in compose, `debug` in dev override). |
| **sqlx**                         | Async Postgres access, compile-time migrations embedded from `server/migrations/`.                   |
| **Argon2**                       | Password hashing (via `password-hash` / `argon2` crates).                                            |
| **jsonwebtoken**                 | Short-lived JWT access tokens (HS256) returned on login/signup.                                      |


**Layout:** `config`, `db` (pool + migrations runner), `error` (typed errors → JSON), `jwt`, `models` (DTOs), `repos` (SQL), `routes` (thin handlers), `services` (auth logic), `state` (`AppState`), `app` (router assembly).

**Auth API:** `POST /api/v1/auth/login` and `POST /api/v1/auth/signup` persist users in **PostgreSQL**, return `{ access_token, token_type, user }` or `{ error: { code, message } }`. **MongoDB** is still available via `MONGODB_URI` for future features; user accounts live in SQL.

**Migrations:** SQL files under `server/migrations/`. At startup, if `**RUN_MIGRATIONS`** is `true` (default in Compose), the server runs `sqlx::migrate!` against the pool. Set to `false` if you apply migrations out-of-band (e.g. CI deploy job).

**Secrets:** `**JWT_SECRET`** must be set to a long random value in production (Compose ships a placeholder for local use).

**Edition:** Rust 2021 (`edition = "2021"` in `Cargo.toml`) for broad toolchain compatibility.

### Local development (Rust)

Outside Docker, run the server with `cargo run` from `server/`. For automatic rebuilds on save, use **[cargo-watch](https://github.com/watchexec/cargo-watch)**: `cargo install cargo-watch` then `cargo watch -x run` (or `cargo watch -x run --poll` if file events are unreliable on your OS).

## Frontend (`clients/web`)


| Decision            | Rationale                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| **React 19**        | Current UI stack; works with the Vite React plugin.                                                   |
| **TypeScript**      | Type safety and editor support across the client.                                                     |
| **Vite**            | Fast dev server and build; first-class HMR.                                                           |
| **Tailwind CSS v4** | Utility-first styling via `@tailwindcss/vite` and `@import "tailwindcss"` in CSS.                     |
| **Vitest**          | Unit/component tests aligned with the Vite toolchain; `@testing-library/react` for DOM-focused tests. |
| **React Router**    | Client-side routing for login and signup flows.                                                       |


**API base URL:** The client builds API URLs in `src/lib/api.ts`. It uses `import.meta.env.VITE_API_URL` when set, otherwise defaults to `http://localhost:8080`. The production Docker build passes `VITE_API_URL` as a build argument so the static bundle can point at the API host. URL joining is implemented in `**joinApiBase`** so path logic can be unit-tested without environment.

### Local development (frontend)

From `clients/web/`: `npm run dev` (Vite).

### Frontend testing (TDD)


| Piece                                       | Role                                                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Vitest**                                  | Test runner (same config as Vite via `vitest/config`).                                                                                    |
| **@testing-library/react** + **user-event** | Render components and interact like a user.                                                                                               |
| **MSW** (`msw` + `msw/node`)                | Mock HTTP in tests; `**onUnhandledRequest: 'error'`** so any `fetch` without a handler fails fast (drives explicit handlers per feature). |
| `**src/test/setup.ts**`                     | Registers MSW `beforeAll` / `afterEach` / `afterAll`.                                                                                     |
| `**src/test/mocks/handlers.ts**`            | Default happy-path handlers; override in a test with `**server.use(...)**` for errors and edge cases (red → green).                       |
| `**src/test/render.tsx**`                   | `**renderWithRouter**` wraps pages with `MemoryRouter` + `Routes` + `Route` for consistent routing in specs.                              |
| **Coverage**                                | `@vitest/coverage-v8`; `npm run test:coverage` writes text, HTML, and lcov under `coverage/`.                                             |


**Scripts:** `npm run test` runs the suite once (CI-friendly). `**npm run test:watch`** and `**npm run test:tdd**` both start Vitest in **watch** mode for a TDD loop (save → run affected tests). `**npm run test:coverage`** runs once with coverage.

**Convention:** colocate `***.test.ts`** / `***.test.tsx**` next to sources under `src/`.

## Data stores


| Store          | Image / version      | Purpose (intended)                                                                                                                                  |
| -------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PostgreSQL** | `postgres:16-alpine` | Relational data (users, sessions, structured LMS data). Connection string is passed to the server as `DATABASE_URL` in Compose.                     |
| **MongoDB**    | `mongo:7`            | Document-oriented or flexible-schema data as needed. URI is passed as `MONGODB_URI` with `authSource=admin` for the root user created by the image. |


Both databases are included so the stack can evolve without a second migration of infrastructure. The exact split of data between SQL and documents is a product decision; the server does not yet connect drivers for either database.

**Security note:** Compose uses fixed dev credentials (`studydrift` / `studydrift`). Replace with secrets, env files, or a secrets manager before any real deployment.

## Docker and networking

### Base stack (`docker-compose.yml`)

- **postgres** and **mongo** expose standard ports to the host (`5432`, `27017`) for local tools and debugging.
- **server** listens on **8080** in the container and is published to the host as **8080**.
- **web** defines the production Docker build (multi-stage `Dockerfile` → nginx serving static files) but does **not** publish ports in the base file.

### Development (`docker-compose.yml` + `docker-compose.dev.yml`)

- **Server:** `Dockerfile.dev` installs **cargo-watch** and runs `cargo watch -x run --poll`. Bind mount `./server:/app` so edits on the host are visible in the container. `**--poll`** improves reliability when the tree is bind-mounted (e.g. Docker Desktop on macOS).
- **Named volumes:** `server_target`, `server_cargo_registry`, `server_cargo_git` keep build artifacts and Cargo caches off the host bind mount for speed and repeatability.
- **Web:** `Dockerfile.dev` runs `npm ci` and then `npm run dev` with `--host 0.0.0.0` on **5173**. Bind mount `./clients/web:/app` and a **named volume** `web_node_modules:/app/node_modules` so the container’s `node_modules` is not overwritten by the host directory tree.
- **Vite:** `CHOKIDAR_USEPOLLING=true` is set for the `web` service; `vite.config.ts` enables `server.watch.usePolling` when that variable is set, so file changes are detected reliably under Docker bind mounts.

**Dev URLs:** UI at **[http://localhost:5173](http://localhost:5173)**, API at **[http://localhost:8080](http://localhost:8080)**.

### Production-style static web (`docker-compose.yml` + `docker-compose.prod.yml`)

- **Web:** Publishes **3000:80** (host → nginx). The static build is produced in the production `Dockerfile` with `VITE_API_URL` as a build arg (defaulting to `http://localhost:8080` for the browser talking to the API on the host).

**Typical commands:**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build
```

## Cross-cutting concerns

- **CORS:** The API allows cross-origin requests in development; tighten origins when deploying to a known web origin.
- **Observability:** Logging is via `tracing`; no metrics or tracing export is configured yet.
- **Testing:** Frontend uses Vitest + Testing Library + MSW (see **Frontend testing (TDD)** above). The Rust server does not yet have an automated test harness in this repo.

## Future reference (when revisiting)

- Replace stub auth with real persistence (Postgres and/or Mongo as appropriate) and session/JWT strategy.
- Move secrets out of compose files; use `.env` (not committed) or orchestrator secrets.
- Consider a single `docker compose` entrypoint if the team wants a default profile (today, prod vs dev is explicit via the second `-f` file).
- If the API and web are served under one host in production, revisit `VITE_API_URL` and CORS together.

