# Lextures — Architecture Recommendations

This document is a prioritized roadmap for evolving Lextures' architecture toward the four stated goals: **easy to understand**, **scalable**, **easy to deploy**, and **fast and responsive**. Each item is scoped enough to hand to an engineer or small team to investigate and implement.

Legend:
- **P0** — Foundational. Do before feature velocity collapses or scale bites.
- **P1** — High ROI. Start once P0 is underway.
- **P2** — Strategic. Plan now, implement as platform matures.
- **P3** — Polish / long-horizon.

Each item includes: **Problem**, **Recommendation**, **Scope**, **Success criteria**.

---

## Snapshot of Current Architecture

- **Backend**: Rust + Axum 0.8, sqlx against PostgreSQL 16 (MongoDB wired but unused), Tokio runtime. ~58K LOC across 173 files. Routes/Services/Repos/Models four-layer split. JWT + custom RBAC. `tracing` for logs. Two polling background tasks (quiz auto-submit, grade release).
- **Frontend**: React 19 + Vite 8 + TypeScript + Tailwind v4. React Router v7. ~265 `.tsx` files, largest pages 2–3K LOC. Hand-written API client modules, no codegen. 7 Context providers, no global store.
- **Shared contracts**: None. OpenAPI skeleton exists (`utoipa`) but only `/health` is documented. Frontend types hand-maintained.
- **Infra**: Docker Compose (dev / prod / deploy variants), GitHub Actions CI, Terraform-style `iac/` dirs. Local-filesystem file storage. Env-var config.
- **Testing**: ~2 real backend integration tests; frontend has 468 test files but most are scaffolds. No E2E suite.

The codebase is clean and idiomatic, but it is **feature-first, not API-first**, and several design decisions that work at today's scale will break at ~10× load.

---

## P0 — Foundational

### P0.1 — Establish an API Contract Layer (OpenAPI-first)
- **Problem**: Frontend DTOs are hand-maintained in `clients/web/src/lib/*-api.ts`. Backend only documents `/health` via `utoipa`. Every backend change risks silent frontend drift. There is no CI guard.
- **Recommendation**:
  1. Mandate `#[utoipa::path]` annotations on every route handler. Enforce via a CI check that fails when a route in `server/src/routes/**` is not referenced in the OpenAPI spec.
  2. Generate TypeScript types from the running backend on every CI run using the existing `openapi:types` script; commit to `clients/web/src/lib/generated/`.
  3. Introduce a thin typed client wrapper around generated types (consider `openapi-fetch` or `orval`) and migrate hand-written API modules to it incrementally, one feature domain at a time.
  4. Publish the `openapi.json` as a build artifact so mobile/third-party clients can consume it.
- **Scope**: 1 eng, 2–3 weeks for the scaffolding + CI. Migration of existing clients is incremental.
- **Success**: 100% route coverage in OpenAPI; zero hand-maintained request/response types in frontend; CI fails on drift.

### P0.2 — Break Up Monolithic Route and Page Files
- **Problem**: `server/src/routes/courses.rs` is 7,150 LOC and handles creation, modules, structure, enrollments, settings, and imports. On the frontend, `course-module-quiz-page.tsx` (2,752), `course-modules.tsx` (2,214), and `quiz-student-take-panel.tsx` (1,969) mix data fetching, business logic, and rendering. These files are the biggest barrier to onboarding and parallel work.
- **Recommendation**:
  - **Backend**: Split `courses.rs` into `courses/` submodule with `creation.rs`, `modules.rs`, `structure.rs`, `enrollments.rs`, `settings.rs`, `imports.rs`. Apply the same pattern to any route file > 1,500 LOC.
  - **Frontend**: Adopt a consistent page-component split:
    - `pages/*` — route-level orchestration only, <300 LOC.
    - `features/<domain>/` — domain logic, hooks, API calls.
    - `components/<domain>/` — pure presentational components.
  - Add an ESLint rule (`max-lines`) set to 500 for `.tsx` and 800 for route `.rs` files, with a grandfather list that must shrink over time.
- **Scope**: 2 eng, 3–4 weeks. Can be done file-by-file without big-bang refactor.
- **Success**: No single file > 1,000 LOC in `server/src/routes` or `clients/web/src/pages`. Grandfather list empty.

### P0.3 — Auth as Middleware, Not Manual Calls
- **Problem**: `require_permission()` / `assert_permission()` are called manually in every protected handler. Easy to forget, hard to audit, and the four-segment permission string (`scope:area:function:action`) can't express resource ownership (e.g., "student can only see their own grades").
- **Recommendation**:
  1. Implement an Axum `FromRequestParts` extractor `AuthedUser` that verifies JWT and loads role context once per request.
  2. Implement a `Permission<"scope:area:fn:action">` extractor (or a `#[require_permission(...)]` proc macro) that runs RBAC checks declaratively.
  3. Introduce a `ResourceScope` pattern for ownership checks: `OwnsCourse(course_id)`, `OwnsSubmission(submission_id)`, etc. Each resolves the resource and asserts the current user has the right relationship.
  4. Add a CI check (simple grep or clippy lint) that flags handlers which extract `AuthedUser` but declare no permission.
- **Scope**: 1 eng, 2 weeks for the extractor work; incremental migration per route file.
- **Success**: Zero manual `require_permission` calls in handler bodies; all auth logic surfaces in the function signature.

### P0.4 — Shared State Strategy on the Frontend
- **Problem**: Seven unrelated Context providers (permissions, UI density, reduced data, feature help, course feed unread, inbox unread, course nav features) plus per-page `useState` for server data. No caching, no request deduplication, no optimistic updates. This will not survive the planned communications + real-time features.
- **Recommendation**:
  1. Adopt **TanStack Query (React Query)** for all server state. Immediate wins: caching, dedup, background refetch, optimistic mutations. Pair it with the generated OpenAPI client.
  2. Keep Context for true client state (permissions, density), but collapse the feed/inbox/unread providers into a single `NotificationsContext` backed by React Query.
  3. Document the rule: "Server data → React Query. Ephemeral UI state → `useState`. Cross-cutting UI flags → Context." Anything else needs a design review.
- **Scope**: 1 eng, 2–3 weeks for infrastructure; per-page migration after.
- **Success**: No raw `fetch` + `useEffect` + `useState` triplets in new code; existing ones documented and on a burn-down list.

### P0.5 — Database Query Audit (N+1, Indexes, Connection Pool)
- **Problem**: 608 `sqlx::query*` calls across 53 repos with inconsistent batching. No visibility into slow queries. Schema has 108 migrations but no introspection of index coverage. `quiz_attempts` and `submissions` will be the hottest tables; risk is real once a single course has 500+ students.
- **Recommendation**:
  1. Turn on `sqlx` statement logging in a staging environment and run the top 10 user flows (course load, quiz take, gradebook view, module nav). Identify queries that run > N times per request.
  2. Introduce a `DataLoader` pattern for bulk fetching: replace `for x in ids { repo::get(x).await }` with `repo::get_many(&ids).await` using `WHERE id = ANY($1)`.
  3. Add a migration `109_indexes_audit.sql` covering: `course_enrollments(user_id, course_id)`, `quiz_attempts(user_id, quiz_id, status)`, `submissions(assignment_id, user_id)`, `analytics_events(course_id, created_at DESC)`. Verify with `EXPLAIN ANALYZE`.
  4. Add a `pgstatstatements` dashboard (or pg_stat_statements query) to the repo's ops docs.
- **Scope**: 1 eng, 2 weeks.
- **Success**: No endpoint issues > 20 queries; gradebook and module load < 200ms p95 on a 500-student course.

---

## P1 — High ROI

### P1.1 — Introduce a Real Job Queue
- **Problem**: Background work is two polling tasks in `lib.rs` (quiz auto-submit every 30s, grade release every 30s). Adding anything more complex (LTI outcome sync, email send, PDF generation, course imports) will require a real queue.
- **Recommendation**: Adopt **PostgreSQL-backed job queues** (`pgmq`, `sqlxmq`, or a small custom `jobs` table with `FOR UPDATE SKIP LOCKED`). Rationale: no new infra, transactional job enqueue alongside business writes. Reserve Redis for P2 if throughput demands it. Define a `Job` trait with `handle()` and `retry_policy()`; move existing sweepers into it.
- **Scope**: 1 eng, 2 weeks.
- **Success**: No `tokio::spawn` of long-running loops in `lib.rs`; emails, imports, PDF export all routed through the queue with retry + DLQ.

### P1.2 — Structured Logging and Metrics
- **Problem**: `tracing` is on but human-formatted. No request IDs, no metrics, no error aggregation. Debugging a production issue today means SSH + `grep`.
- **Recommendation**:
  1. Switch `tracing_subscriber` to JSON formatting in non-dev builds. Include `request_id`, `user_id`, `course_id` on every span via a Tower middleware.
  2. Add `axum-prometheus` or `metrics` crate; expose `/metrics`. Track: request duration histogram by route, DB query duration, job queue depth/lag, active WebSocket connections.
  3. Wire Sentry (or equivalent) for frontend and backend error aggregation. Cost is low, signal is high.
  4. Document a minimum observability SLO in `docs/OPS.md`.
- **Scope**: 1 eng, 1.5 weeks.
- **Success**: Every production error surfaces in Sentry with a request ID that traces to backend logs.

### P1.3 — File Storage Abstraction (Local → S3-compatible)
- **Problem**: `COURSE_FILES_ROOT` points at a local filesystem path. Cannot horizontally scale backend, cannot run on managed platforms without persistent volumes, cannot CDN.
- **Recommendation**: Introduce a `FileStore` trait with `put`, `get`, `presigned_url`, `delete`. Provide two implementations: `LocalFileStore` (dev) and `S3FileStore` (prod; works with S3, R2, MinIO, GCS). Migrate uploads/imports through the trait. Serve large downloads via presigned URLs, not through the API.
- **Scope**: 1 eng, 2 weeks.
- **Success**: Backend can run stateless behind a load balancer; production uses S3-compatible storage.

### P1.4 — Deployment Simplification
- **Problem**: Four Docker Compose files (`base`, `dev`, `prod`, `deploy`) with overlapping config. Three environments' worth of coupling. New contributors don't know which to run.
- **Recommendation**:
  1. Consolidate to two: `docker-compose.yml` (all envs via profiles: `--profile dev`, `--profile prod`) and optionally a `docker-compose.override.yml` for local-only tweaks.
  2. Publish versioned images to GHCR on main-branch CI (`ghcr.io/<org>/lextures-server:<sha>`, `lextures-web:<sha>`).
  3. Ship a one-command Helm chart or a reference Fly.io / Railway / Render config in `iac/` so self-hosters have a paved road.
  4. Document the 3 supported deploy targets in `docs/DEPLOY.md` with copy-paste commands.
- **Scope**: 1 eng, 2 weeks.
- **Success**: `git clone && docker compose up` works end-to-end; production deploy is < 10 commands.

### P1.5 — E2E Test Harness on Critical Paths
- **Problem**: Zero E2E coverage. 468 frontend test files are mostly scaffolds. Silent UI regressions are inevitable.
- **Recommendation**: Adopt **Playwright** with 8–10 happy-path tests: sign in, create course, import QTI, take quiz, auto-submit, grade submission, release grades, student view. Run in CI against a Docker Compose stack with a seeded DB. Gate merges on the suite.
- **Scope**: 1 eng, 2 weeks to stand up; ongoing maintenance.
- **Success**: Green E2E on every PR; new features land with at least one E2E touch.

### P1.6 — Frontend Performance Baseline
- **Problem**: Monolithic pages ship large JS bundles and re-render aggressively. No measurable performance budget.
- **Recommendation**:
  1. Enforce route-level code splitting — every `pages/*` file is lazy by default.
  2. Set a bundle budget per route in `vite.config.ts` (initial JS < 200KB gzipped for the login and course-student routes; < 400KB for instructor routes). Fail CI on regression.
  3. Add Web Vitals reporting (LCP, INP, CLS) to Sentry.
  4. Audit re-renders with React DevTools Profiler on `course-modules.tsx` and `quiz-student-take-panel.tsx`. Apply `useMemo` / `React.memo` where profiling confirms the win — not preemptively.
- **Scope**: 1 eng, 2 weeks.
- **Success**: LCP < 2.5s p75 on student course page; bundle budgets enforced.

---

## P2 — Strategic

### P2.1 — Multi-Tenancy / Org Scoping
- **Problem**: Schema assumes single tenant. Plan 5.x describes org/workspace/term/section, but no scoping exists yet. Every new table added today will need a `tenant_id` later, and that migration is expensive.
- **Recommendation**: Decide now between **shared-schema with `tenant_id` column** (preferred — easier ops, cheaper at <1K tenants) vs. **schema-per-tenant**. Write an ADR. Add `tenant_id UUID NOT NULL` to all new tables. Add a request-scoped `TenantContext` extractor. Plan a migration for existing tables (backfill a `default` tenant) before adding the first paying customer.
- **Scope**: 2 eng, 4–6 weeks for the migration; decision itself < 1 week.
- **Success**: All queries scoped by `tenant_id` via repo helpers; no cross-tenant data leak possible in code review.

### P2.2 — Real-Time Layer (WebSockets)
- **Problem**: Two `tokio::broadcast` channels (`comm_events`, `feed_events`) exist but no WebSocket endpoints consume them. Frontend polls. Plan 6.x (communication) and 13.x (live features) depend on real-time.
- **Recommendation**: Add an Axum WebSocket endpoint `/ws` with JWT auth on connect. Bridge broadcast channels to per-connection subscriptions. On the frontend, add a `useLiveQuery(key)` hook that invalidates React Query caches on events. Consider `socketioxide` only if you need rooms/namespaces out of the box.
- **Scope**: 1 eng, 3 weeks.
- **Success**: Inbox / feed unread counts update live; no polling intervals < 30s remain.

### P2.3 — Caching Layer
- **Problem**: Only in-memory TTL caches today (LTI JWKS, recommendations). Won't survive multiple backend replicas. Gradebook and course outline are hot reads.
- **Recommendation**: Add Redis as an optional dependency (Compose profile). Introduce a `Cache` trait with `NoopCache` (default), `InMemoryCache`, and `RedisCache` impls. Use it for: course outline, enrollments, RBAC role lookup, LTI JWKS. Invalidate on writes via tagged keys.
- **Scope**: 1 eng, 2 weeks.
- **Success**: p95 on cached endpoints < 50ms; cache hit rate > 80% in production.

### P2.4 — Analytics Pipeline
- **Problem**: `analytics_events` table is defined but has no aggregation strategy. At 1M+ events/day the table will be unusable for direct queries.
- **Recommendation**: Keep `analytics_events` as the write path. Add a periodic job (P1.1 queue) that aggregates into materialized rollup tables (`daily_course_activity`, `weekly_student_engagement`). Consider a read-only replica or ClickHouse only when rollups stop being enough.
- **Scope**: 1 eng, 3 weeks.
- **Success**: Instructor dashboard queries hit rollups, not raw events; analytics p95 < 500ms.

### P2.5 — RBAC Resource Ownership Model
- **Problem**: Permission strings express capability (`course:module:quiz:read`) but not ownership. Today, ownership is checked inline in handlers (inconsistent).
- **Recommendation**: Build on P0.3. Model roles as `(user_id, role_id, scope)` where scope is `global | org:<id> | course:<id> | section:<id>`. Permission checks become `user_has_permission(perm, resource)`. This maps cleanly to Canvas, Moodle, and K-12 role semantics.
- **Scope**: 1 eng, 4 weeks including data migration.
- **Success**: Ownership checks are declarative; every endpoint's authorization is expressible in one line.

---

## P3 — Polish / Long-Horizon

### P3.1 — Design System
Introduce a token-driven design system (CSS variables, `shadcn/ui` or a custom primitive set). Stop hand-rolling buttons/inputs in every page.

### P3.2 — Mobile Client Strategy
Decide between React Native, PWA, or native. Current `docs/MOBILE_DESIGN.md` is aspirational. The API contract layer (P0.1) unblocks this.

### P3.3 — AI Features Boundary
AI code (recommendations, hints, adaptive path) is scattered across services. Extract into a single `ai/` subcrate with a pluggable provider interface. Makes the OpenRouter dependency replaceable.

### P3.4 — Drop Unused Dependencies
MongoDB is wired but unused. Either commit to a use case (media metadata, analytics) or remove it. Same audit for any dead crates.

### P3.5 — Security Hardening
- Rotate `JWT_SECRET` via a key-ID (kid) header so rotation is non-breaking.
- Add rate limiting middleware on auth and submission endpoints.
- Dependency audit in CI (`cargo audit`, `npm audit`) — fail on High/Critical.
- CSP headers on the web app.

### P3.6 — Internal Developer Experience
- Seed script: one command generates a realistic demo course with students, assignments, submissions, grades. Today's onboarding is manual.
- `just` or `make` targets for the 10 most common dev tasks.
- A `CONTRIBUTING.md` describing the four-layer backend split (routes → services → repos → models) and when to add each.

---

## Suggested Rollout

- **Quarter 1**: P0.1 + P0.3 + P0.5 in parallel. P0.2 started opportunistically as files are touched.
- **Quarter 2**: P0.4 complete. P1.1, P1.2, P1.3, P1.5 delivered.
- **Quarter 3**: P1.4, P1.6. P2.1 ADR + schema migration.
- **Quarter 4**: P2.2, P2.3. P2.4 ADR.
- **Ongoing**: P3 items as background polish; no roadmap slot required.

---

## Open Questions for the Team

1. **Tenancy model** (P2.1): shared-schema with `tenant_id`, or schema-per-tenant? This decision affects every new migration.
2. **Real-time protocol** (P2.2): raw WebSocket + custom events, or Server-Sent Events for the read-only cases?
3. **Hosting target**: are we optimizing for self-hosters (Docker Compose, Helm) or a managed offering (Fly/Render/K8s)? Different infra investments.
4. **MongoDB**: commit to a use case or remove?
5. **Acceptable downtime for migrations**: this drives whether P2.1 needs an online-migration strategy.
