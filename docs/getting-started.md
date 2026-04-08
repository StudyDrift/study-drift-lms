# Getting started

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose, **or**
- [Rust](https://rustup.rs/), [Node.js](https://nodejs.org/) (current LTS), PostgreSQL, and MongoDB if you run services locally.

## Run with Docker (recommended for development)

From the repository root:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

- **Web (Vite, HMR)**: [http://localhost:5173](http://localhost:5173)
- **API**: [http://localhost:8080](http://localhost:8080)
- **PostgreSQL**: `localhost:5432` · **MongoDB**: `localhost:27017` (defaults match `docker-compose.yml`)

Optional: create a `.env` next to `docker-compose.yml` with `OPEN_ROUTER_API_KEY=...` for AI-related features.

## Production-style web (nginx + static build)

From the repository root:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build
```

The web app is served on [http://localhost:3000](http://localhost:3000) (API still on `8080` from the base compose file).

## Local development without full Docker (outline)

1. Start PostgreSQL and MongoDB (or use only Postgres if you skip Mongo-dependent features).
2. Copy [`server/.env.example`](../server/.env.example) to `server/.env` and set `DATABASE_URL`, `JWT_SECRET`, and optionally `OPENROUTER_API_KEY`.
3. In `server/`: `cargo run` (or `cargo watch -x run` for auto-reload).
4. In `clients/web/`: `npm install` then `npm run dev` (set `VITE_API_URL` if the API is not at `http://localhost:8080`).

For architecture details (Compose port layout, dev vs prod web, testing conventions), see [Technical decisions and architecture](tech-decisions.md).
