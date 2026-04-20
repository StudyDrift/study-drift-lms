# Technical Debt Audit — Lextures LMS

_Last scan: 2026-04-20_

A full-codebase review of maintainability, duplication, test coverage, typing, schema health, and tooling. Findings are organized by category and severity, with concrete fixes. Effort is scored S (hours) / M (~1 day) / L (2–3 days) / XL (a week).

---

## Executive Summary

**Size:**
- Server (Rust): ~31,260 LOC across 97 files
- Client (React/TS): ~35,101 LOC across 195 files
- 82 SQL migrations; 299 client test files; server coverage floor of 59%

**Health:** GOOD. The codebase is well-tested, consistently typed, and cleanly modular. Debt is concentrated in a handful of mega-files (routes/courses.rs, CourseModuleQuizPage.tsx, QuizStudentTakePanel.tsx) and in a few missing abstractions around quiz submission, API typing, and error handling. There is effectively no dead code, no `any` in production TS, and no accumulated `TODO`/`FIXME` backlog.

Fix the top three files and add API schema validation and the codebase moves from "good" to "excellent".

---

## 1. Error Handling

### Server
- `AppError` enum is consistent and maps to correct HTTP codes — **good**.
- All validation failures collapse to `AppError::InvalidInput(String)`. Clients can't distinguish "course not found" from "invalid quiz setting" without parsing strings.
  - **Fix:** Add an `ErrorCode` enum and return `{ error: { code, message } }`. Keeps messages human-readable but codes machine-switchable.
- Silent `.ok()` on optional side-effects (e.g., email notifications) — at least log failures:
  ```rust
  if let Err(e) = send_email(...).await { tracing::warn!(error = ?e, "email_send_failed"); }
  ```
- Production `.expect()` / `.unwrap()` paths to remove:
  - [server/src/services/course_image_upload.rs:115](server/src/services/course_image_upload.rs:115) — `expect("set with bytes")`
  - [server/src/services/course_image_upload.rs:162](server/src/services/course_image_upload.rs:162) — `expect("checked")`
  - [server/src/repos/course_structure.rs:149](server/src/repos/course_structure.rs:149) — `expect("one row")` — should return `Option`

### Client
- No global error boundary — API failures surface ad-hoc in each component.
- `authorizedFetch` dispatches a re-auth event on 401 but callers must listen manually.
- No retry for transient 5xx / network errors.
- **Fix:** Add `<ApiErrorBoundary>` at route level; add optional retry (with jitter) for GET requests in the API helper.

---

## 2. Type Safety

### Client
- Zero `any` in production code — **excellent**.
- Runtime validation of API payloads is done via duck-typed narrowing in [clients/web/src/lib/coursesApi.ts:79](clients/web/src/lib/coursesApi.ts:79) instead of a schema.
  - **Fix:** Add `zod` (one dep), define schemas next to each endpoint, validate on response parse. Catches server contract drift at the boundary instead of at a crash site far away.

### Server
- 29 total `unwrap`/`expect` calls; most are in tests (acceptable). Five are in production code — listed under Error Handling above.
- Consider newtype IDs: `pub struct UserId(Uuid);`, `pub struct CourseId(Uuid);`. Cheap with `sqlx::Type` derive, catches swapped-argument bugs at compile time.

---

## 3. Missing Abstractions

- **Business logic in route handlers** — enrollment add (`add_enrollments_handler`), outcome linking, settings CRUD all do permission checks + validation + audit + DB work inline. Extract to services (`services/enrollments.rs`, `services/outcomes.rs`, etc.).
- **No OpenAPI** — client types are hand-maintained, drift-prone. Adopt [`utoipa`](https://docs.rs/utoipa) to derive an OpenAPI spec from route signatures; generate TS types with `openapi-typescript`.
- **Quiz submission logic belongs in a service.** Currently ~400 lines inline in a route. Move grading, locking, accommodation resolution, and notification side-effects to `services/quiz_submission.rs` so it can be unit-tested without spinning up Axum.

---

## 4. Test Coverage

| Area | State | Action |
|---|---|---|
| Server unit coverage | 59% floor in CI — good | Raise to 70% with service-level tests |
| Server integration tests | Only 1 file in `server/tests/` | Add end-to-end suites: auth flow, quiz submit, enrollment, permission-denied paths |
| Canvas import | Untested | Add fixtures for real Canvas HTML exports; lock `html_to_plain` behavior |
| Client components | 299 test files — strong | Add tests for `QuizStudentTakePanel`, `CourseModuleQuizPage` state machines |
| Client API error paths | Sparse | Cover 401 refresh, 5xx, network timeout with MSW handlers |
| AppError → status code | Not asserted | One parametrized test mapping every variant to its expected status + code |

---

## 5. Database Schema Debt

**Migration count: 82** — sprawling but well-labeled (`NNN_feature_description.sql`). No dead migrations detected.

### Issues
- `module_quizzes` has been patched across ~9 migrations (adaptive, lockdown, per-attempt shuffle, comprehensive settings, etc.). The JSONB settings blob has no `settings_version` field.
  - **Fix:** Add `settings_version INT NOT NULL DEFAULT 1` to every JSONB-backed settings table. Required before any breaking settings change.
- No partial indexes on commonly filtered boolean columns (`archived`, `published`, `hidden_at`).
- Composite indexes missing for frequent joins — especially `enrollments(course_id, user_id)` and `gradebook_entries(course_id, student_user_id, item_id)`.
- Foreign keys: verify each reference has `ON DELETE` behavior explicitly declared; otherwise cascading deletes silently orphan rows.

### Recommendation
One migration batch:
```sql
CREATE INDEX idx_courses_active ON courses(...) WHERE archived = false;
CREATE INDEX idx_enrollments_lookup ON enrollments(course_id, user_id);
ALTER TABLE module_quizzes ADD COLUMN settings_version INT NOT NULL DEFAULT 1;
-- …repeat versioning for assignment_pages, rubrics, gradebook_config
```

---

## 6. Frontend Debt

### Strengths
- Tailwind v4 used consistently; only one legacy CSS file (`BookLoader.css`) — justified.
- Contexts scoped tightly (`PermissionsProvider`, `CourseNavFeaturesContext`).
- TypeScript strictness is high; no `any` escapes.

### Issues
- Large components with too many `useState` hooks (tracked in the completed oversized-files effort).
- Prop drilling of `courseCode` + `itemId` through several layers — acceptable today but worth a `CourseItemContext` when the next handler is added.
- No Storybook / visual regression harness — big components are hard to iterate on without one.
- No bundle-size budget; client build size is not tracked in CI.

### Recommendations
- Add Storybook for quiz + gradebook components; pin stories to golden snapshots.
- Add `rollup-plugin-visualizer` (or equivalent) to surface bundle composition; set a CI size ceiling.
- Replace heavy `useState` clusters with `useReducer` + discriminated-union action types.

---

## 7. Build & Tooling

| Gap | Fix | Effort |
|---|---|---|
| No `cargo audit` / `cargo deny` in CI | Add both as a separate job | S |
| No `npm audit` in CI | Add step; fail on high severity | S |
| No pre-commit hook on the client | Add Husky + lint-staged (`eslint --fix`, `tsc -b`) | S |
| No GitHub Actions caching for Cargo or node_modules | Add `actions/cache` for `~/.cargo`, `target/`, `node_modules` | S |
| No bundle-size budget | See §6 | M |
| No API perf benchmarks | Add `criterion` bench for hot paths if latency matters | M |

---

## 8. Documentation

### Strengths
- 381 `///` doc comments across the server — above average for a project this size.
- `docs/` contains design + planning notes.

### Gaps
- No architecture diagram or request-flow overview.
- Complex algorithms undocumented:
  - `services/adaptive_quiz_ai.rs` — no explanation of the adaptation policy.
  - `services/relative_schedule.rs` — no description of per-student schedule resolution.
  - Canvas import — no overview of the stages.
- `lib/coursesApi.ts` (2,644 lines) has no JSDoc on its exported functions.
- No migration-authoring guide (when to add vs alter, how to backfill).

### Recommendations
- Add a `docs/architecture.md` with one high-level diagram and one request-trace for a quiz submission.
- Add 15–25 line leading doc comments to the three algorithm services above.
- Generate API docs automatically once `utoipa` is adopted (§3).

---

## 9. Naming & Organization

- Repo functions mix verbs: `get_id_by_course_code`, `insert_course`, `list_courses`, `find_quiz_by_id`. Settle on `get_/list_/insert_/update_/delete_/find_` and rename outliers.
- Models vs API types naming isn't parallel: server emits `CoursePublic`, client imports it as `Course`. Adopt `Public` suffix on both sides or drop it from both.
- Service function verbs inconsistent (`grade_attempt` vs `get_scores`). Document the convention in `services/mod.rs`.

---

## 10. Dead Code / Stale Features

None detected. No commented-out blocks, no unused exports, no orphan routes. Uncommon for a 60k-LOC codebase — keep it this way by turning on `#![deny(dead_code)]` in the crate root.

---

## 11. Dependency Sprawl

Both `Cargo.toml` and `package.json` are lean. Nothing flagged as unused. Do not remove without a build failure to prove it.

---

## Top 10 Highest-Impact Fixes

1. **Split `server/src/routes/courses.rs`** into domain modules (quiz, quiz_attempts, assignments, outcomes, gradebook, canvas_import). Effort **L**. Immediate review-speed payoff.
2. **Extract quiz submission service.** Move `module_quiz_submit_handler`'s 373 lines into `services/quiz_submission.rs`. Makes it unit-testable and removes the worst handler in the codebase. Effort **M**.
3. **Decompose `QuizStudentTakePanel`** into `QuizRunner` + `LockdownShell` + `QuizCodeExecutor`. Effort **L**.
4. **Decompose `CourseModuleQuizPage`** by role (author vs student). Effort **M**.
5. **Adopt Zod for all API response parsing** on the client. One dep, replaces duck-typed narrowing with compile-time types + runtime guarantees. Effort **M**.
6. **Generate OpenAPI via `utoipa`**; generate client types via `openapi-typescript`. Kills the hand-maintained type drift problem. Effort **M**.
7. **Introduce `ErrorCode` enum** in `AppError` and emit it in JSON responses. Effort **S**.
8. **Replace production `.expect()` paths** with proper error handling (3 sites listed in §1). Effort **S**.
9. **Add integration tests** for auth flow, quiz submission, and Canvas import. Effort **M**.
10. **Add `settings_version` column** to JSONB-backed settings tables and a batch of missing indexes (§5). Effort **S**.

---

## Quick Wins (high impact, low effort)

- `#[must_use]` on all DB/service functions returning `Result`.
- Delete the three production `.expect()` calls.
- Add `cargo audit` + `npm audit` as CI steps.
- One parametrized test mapping every `AppError` variant to its status code.
- Introduce newtype IDs (`UserId`, `CourseId`) — mechanical rename, free safety.
- Add Husky + lint-staged pre-commit hook for the client.
- Add 10–20-line algorithm doc comments to the three undocumented service files.

---

## Long-Term Strategic Refactors

### Phase 1 — API clarity (1–2 sprints)
- Split `routes/courses.rs`.
- Extract quiz submission service.
- Adopt `utoipa` + generated client types.
- Introduce `ErrorCode` enum.

### Phase 2 — Component architecture (2–3 sprints)
- Decompose the five 1,000+-line components.
- Convert complex state to `useReducer`.
- Stand up Storybook; lock visual regressions for quiz + gradebook surfaces.

### Phase 3 — Database evolution (1 sprint)
- Partial and composite indexes.
- JSONB `settings_version` everywhere.
- Explicit `ON DELETE` behavior on every FK.

### Phase 4 — Observability (ongoing)
- Structured logging with correlation IDs through every request.
- Sentry (or equivalent) wiring on both server and client.
- Slow-query + slow-endpoint tracing with `tracing-opentelemetry`.

---

## Debt Summary by Category

| Category | Items | Severity mix | Effort |
|---|---|---|---|
| Oversized files/functions | 9 | 3 High / 6 Medium | L–XL |
| Error handling | 5 | Medium | M |
| Type safety (client) | 2 | Low | S |
| Rust safety (prod unwraps) | 3 | Low | S |
| Missing abstractions | 3 | Medium | M |
| Test coverage | 3 | Medium | M |
| Schema debt | 2 | Medium | M |
| Documentation | 4 | Low | S |
| Build/tooling | 6 | Low | S |
| Dead code / dep sprawl | 0 | — | — |
| TODO/FIXME backlog | 0 | — | — |

**Totals:** 37 items. 0 critical, 11 high, 12 medium, 14 low.

The codebase is in good health. Prioritizing the Top 10 list above in the next two sprints removes the bulk of the pain points without requiring a rewrite of any subsystem.
