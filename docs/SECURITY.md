# Security Audit — Lextures LMS

_Last scan: 2026-04-20 (original Rust/Axum stack). Updated paths for Go/chi migration._

This document captures the findings of a full-codebase security review covering authentication, authorization, input validation, XSS/CSRF, secrets handling, transport security, rate limiting, business logic, and dependencies. Issues are grouped by severity with concrete fixes.

---

## Executive Summary

Lextures is a Go (chi) backend + React/TypeScript frontend LMS. The codebase demonstrates generally **good security practices** — parameterized SQL (pgx), Argon2id password hashing, RBAC-based permission checks, and proper JWT expiry. However, several **High severity issues** must be remediated before production: JWT storage in `localStorage`, no CSRF protection, no rate limiting on auth, and missing security headers.

**Overall posture:** MEDIUM. Do not ship to production until all P0/P1 items below are resolved.

### Strengths
- `.env` is gitignored; only `server/.env.example` (placeholders) is tracked.
- Argon2id password hashing (`server/internal/service/authservice/credentials_password.go`)
- Parameterized SQL via pgx everywhere (no string-interpolated user input in queries)
- JWT implementation uses `golang-jwt/jwt` (no OpenSSL surface)
- Reset tokens are SHA-256 hashed before DB storage, one-time use, 1h expiry
- Comprehensive RBAC with explicit permission checks on routes
- TLS via Go's standard `crypto/tls` with modern defaults

### Weaknesses
- JWT stored in `localStorage` (XSS-exposable)
- No CSRF protection; CORS wide open (`Any`)
- No rate limiting on `/auth/login`, `/auth/signup`, `/auth/reset-password`
- No security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options)
- Client-side-only quiz lockdown enforcement
- Potential IDOR on accommodations and quiz results endpoints
- `dangerouslySetInnerHTML` without DOMPurify on KaTeX output

---

## HIGH

### H1. JWT stored in `localStorage`
- **File:** [clients/web/src/lib/auth.ts:14](clients/web/src/lib/auth.ts:14), [clients/web/src/lib/auth.ts:24](clients/web/src/lib/auth.ts:24)
- **Issue:** Access token written to `localStorage`; readable by any script on the page.
- **Risk:** A single XSS anywhere in the app leaks the JWT, enabling full session hijack.
- **Fix:** Issue the token as an `HttpOnly; Secure; SameSite=Strict; Path=/api` cookie from the backend. Remove all `localStorage` token usage. Update `authorizedFetch` to rely on cookie transmission (`credentials: 'include'`).

### H2. No CSRF protection
- **Files:** [server/internal/httpserver/server.go](server/internal/httpserver/server.go), all mutating routes in `server/internal/httpserver/`
- **Issue:** No CSRF token validation and CORS is configured with `allow_origin(Any)` + `allow_headers(Any)`.
- **Risk:** If JWT is moved to a cookie (H1), attacker-origin pages can forge state-changing requests (enrollments, grade edits, quiz submits).
- **Fix:**
  1. Restrict CORS to an explicit allowlist of trusted origins.
  2. Implement double-submit CSRF token: issue a CSRF cookie on login, require matching `X-CSRF-Token` header on all non-GET routes.
  3. Use `SameSite=Strict` on the auth cookie as defense-in-depth.

### H3. Missing security headers
- **File:** [server/internal/httpserver/server.go](server/internal/httpserver/server.go)
- **Issue:** No CSP, HSTS, X-Frame-Options, X-Content-Type-Options, or Referrer-Policy set.
- **Risk:** Clickjacking, MIME sniffing, unrestricted script sources.
- **Fix:** Add a chi middleware that sets response headers:
  ```
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;
  ```

### H4. No rate limiting on auth endpoints
- **File:** [server/internal/httpserver/auth.go](server/internal/httpserver/auth.go)
- **Issue:** `/auth/login`, `/auth/signup`, `/auth/request-password-reset`, `/auth/reset-password` accept unlimited attempts.
- **Risk:** Credential stuffing, brute force, account enumeration, password-reset spam.
- **Fix:** Add a rate limiting chi middleware. Recommended buckets:
  - Login: 5 failures / 15 min per IP, 10 / hr per email
  - Signup: 3 / hr per IP
  - Reset request: 3 / hr per email

### H5. Weak path sanitization for course file uploads
- **File:** [server/internal/repos/coursefiles/paths.go](server/internal/repos/coursefiles/paths.go)
- **Issue:** `DiskCourseDirSegment` replaces unsafe chars but does not reject `..`, multiple dots, or absolute segments pre-sanitization. File storage root relies on this being safe.
- **Risk:** Path traversal to read/write outside `course_files_root`.
- **Fix:** After joining, use `filepath.EvalSymlinks` / `filepath.Abs` and assert the result is still prefixed by `course_files_root`. Reject any segment containing `..`. Use UUIDs (not user-supplied names) for on-disk filenames.

---

## MEDIUM

### M1. IDOR — accommodations by `user_id`
- **File:** [server/internal/httpserver/accommodations.go](server/internal/httpserver/accommodations.go)
- **Issue:** Handler accepts `{user_id}` path param; only verifies caller has `MANAGE_ACCOMMODATIONS_PERM`. No check that the target belongs to a course the caller manages.
- **Risk:** Any user with the permission (e.g., a single-course TA) can read/edit accommodations for every user system-wide.
- **Fix:** Scope the permission check to courses: require `course:<code>:accommodations:manage` and verify the target user is enrolled in one of the caller's managed courses.

### M2. IDOR — quiz results `student_user_id` query param
- **File:** [server/internal/httpserver/module_quiz.go](server/internal/httpserver/module_quiz.go)
- **Issue:** `student_user_id` is trusted once `can_edit` is true; no verification that the student is enrolled in the course being viewed.
- **Risk:** An instructor in course A can enumerate/download attempt data for a student only enrolled in course B.
- **Fix:** After resolving `target_user`, call an `enrollment.UserIsEnrolled(ctx, courseID, targetUser)` check and return `Forbidden` if false.

### M3. Grade tampering via `item:create` permission
- **File:** [server/internal/httpserver/gradebook_grid.go](server/internal/httpserver/gradebook_grid.go) (`GradebookGradesPutHandler`)
- **Issue:** Permission gate is `course_item_create_permission` — the same permission used for creating assignments. A role that is allowed to author items should not implicitly be allowed to overwrite grades.
- **Risk:** Overly broad permission can be abused to change grades.
- **Fix:** Introduce a distinct `course:<code>:gradebook:write` permission and gate grade mutations on it. Log all grade mutations to an audit table (course_id, actor_id, student_id, item_id, old→new, timestamp).

### M4. Quiz lockdown enforced client-side only
- **File:** [server/internal/service/quizlockdown/lockdown.go](server/internal/service/quizlockdown/lockdown.go), [clients/web/src/components/quiz/QuizStudentTakePanel.tsx](clients/web/src/components/quiz/QuizStudentTakePanel.tsx)
- **Issue:** `one_at_a_time` and `kiosk` modes rely on the client hiding questions and disabling navigation. A student with DevTools can submit arbitrary combinations.
- **Risk:** Bypasses intended exam integrity.
- **Fix:** Track server-side attempt state per question (question index, first-seen timestamp, answered flag). Reject submissions that violate the mode's invariants (e.g., answering Q5 before Q4 in `one_at_a_time`).

### M5. XSS surface in KaTeX rendering
- **Files:** [clients/web/src/components/math/KatexExpression.tsx:51](clients/web/src/components/math/KatexExpression.tsx:51), [clients/web/src/components/editor/MathInsertPopover.tsx:176](clients/web/src/components/editor/MathInsertPopover.tsx:176)
- **Issue:** Raw `dangerouslySetInnerHTML` on KaTeX-rendered HTML with no DOMPurify pass. KaTeX with `trust: true` or with a future CVE could emit attacker-controlled HTML from student-authored LaTeX.
- **Risk:** Stored XSS via quiz answers / question content rendered to graders or other students.
- **Fix:** Run all KaTeX output through `DOMPurify.sanitize(html, { USE_PROFILES: { mathMl: true, svg: true, html: true } })`. Confirm KaTeX is called with `trust: false, strict: 'ignore'`.

### M6. Markdown rendered without sanitization
- **File:** [clients/web/src/components/syllabus/SyllabusMarkdownView.tsx](clients/web/src/components/syllabus/SyllabusMarkdownView.tsx)
- **Issue:** `react-markdown` + `rehype-katex` rendered without an explicit `rehype-sanitize` schema. Raw HTML in markdown is disabled by default in react-markdown, but the KaTeX `rehype-raw`/`rehype-katex` pipeline can reintroduce unsafe output if plugins change.
- **Risk:** Any future config that enables raw HTML becomes a stored-XSS vector.
- **Fix:** Pin a `rehype-sanitize` step at the end of the pipeline with a schema that allows KaTeX classes only. Add a regression test that injects `<img src=x onerror=alert(1)>` and asserts it is stripped.

### M7. No failed-login audit logging
- **File:** [server/internal/service/authservice/credentials_password.go](server/internal/service/authservice/credentials_password.go)
- **Issue:** Failed password checks return silently; no structured log emitted.
- **Risk:** Brute force and credential stuffing are undetectable from logs.
- **Fix:** Emit `slog.Warn("failed_login", "email", email, "remote_ip", remoteIP)` on bad password and on unknown-email signup collision. Feed logs into a SIEM for alerting.

### M8. Argon2 default parameters
- **File:** [server/internal/service/authservice/credentials_password.go](server/internal/service/authservice/credentials_password.go)
- **Issue:** Argon2 parameters match the previous Rust implementation defaults — not tuned for current hardware.
- **Risk:** Under-provisioned memory cost leaves hashes cheaper to crack than OWASP current guidance (19 MiB, t=2, p=1).
- **Fix:**
  ```go
  params := &argon2id.Params{
      Memory:      19 * 1024,
      Iterations:  2,
      Parallelism: 1,
      SaltLength:  16,
      KeyLength:   32,
  }
  ```
  Benchmark on the target host and adjust until hashing takes ~250–500 ms.

### M9. No rate limit on quiz submission
- **File:** [server/internal/httpserver/module_quiz.go](server/internal/httpserver/module_quiz.go) (`ModuleQuizSubmitHandler`)
- **Issue:** Unlimited submissions per user per quiz.
- **Risk:** Abuse of adaptive-quiz AI generation (cost), attempt count exhaustion DoS.
- **Fix:** Per (user, item) token bucket — e.g., 1 submission / 5 s, 20 / hour.

### M10. Course-code input accepted with no format validation
- **File:** [server/internal/httpserver/](server/internal/httpserver/) (multiple handlers)
- **Issue:** Course codes flow from URL path into logs, file paths, permission strings without length/charset check.
- **Risk:** Oversize or non-ASCII values pollute logs, permission strings, and filesystem segments.
- **Fix:** Reject anything not matching `^[A-Za-z0-9_-]{1,20}$` at the top of every handler (or in a shared validation helper).

---

## LOW

### L1. CORS `Any`
- **File:** [server/internal/httpserver/cors.go](server/internal/httpserver/cors.go) — handled by H2 above; listed separately for tracking.

### L2. No JWT key rotation strategy
- **File:** [server/internal/auth/jwt.go](server/internal/auth/jwt.go)
- **Issue:** Single static signing key; no key-id (`kid`) in header; rotating the secret invalidates every session.
- **Fix:** Maintain a current + previous key, embed `kid` in JWT header, verify against both during the overlap window. Store secrets in a vault (AWS Secrets Manager, Doppler, HashiCorp Vault).

### L3. Panics / unrecoverable errors in production paths
- **Files:** [server/internal/service/courseimageupload/service.go](server/internal/service/courseimageupload/service.go), [server/internal/repos/coursestructure/](server/internal/repos/coursestructure/)
- **Issue:** Unexpected state panics the goroutine. Not a direct security bug but turns input anomalies into availability incidents.
- **Fix:** Replace panics with proper error returns and a dedicated error variant.

### L4. `fmt.Sprintf` for table names in SQL
- **Files:** various in `server/internal/repos/`
- **Issue:** Not injection (table names are internal constants), but the pattern is dangerous to extend. Future contributors may interpolate untrusted values.
- **Fix:** Use compile-time query constants where possible, or wrap dynamic identifiers through a whitelisting helper.

### L5. No HTTPS enforcement documented
- **Files:** deploy configs
- **Issue:** No reverse-proxy redirect or HSTS policy documented.
- **Fix:** Document the production requirement: terminate TLS at the proxy, force 80→443, set HSTS preload. Add to deployment README.

---

## INFORMATIONAL

### I1. Permission denials lack structured logging
- **File:** [server/internal/apierr/apierr.go](server/internal/apierr/apierr.go)
- **Fix:** Emit `slog.Warn("permission_denied", "user_id", userID, "required_permission", perm, "route", route)` from the `Forbidden` branch. Aids forensics.

### I2. Add `govulncheck` and `npm audit` to CI
- **Fix:** Two-line additions to GitHub Actions. Fail the build on high-severity advisories. Enable Dependabot for both ecosystems.

### I3. Add automated security tests
- CSRF: cross-origin POST from fake origin returns 403.
- Rate limit: 10 failed logins/60s are throttled.
- XSS: stored quiz content with `<img src=x onerror=alert(1)>` is escaped in the rendered DOM.
- IDOR: student A's token cannot read `/api/v1/users/{studentB}/accommodations`.

---

## Priority Fix Order

### P0 — Block production launch
1. Move JWT to `HttpOnly` cookie (**H1**)
2. Implement CSRF + restrict CORS (**H2**)
3. Add security headers (**H3**)
4. Rate-limit auth endpoints (**H4**)
5. Lock down file-upload path handling (**H5**)

### P1 — Next sprint
7. Close accommodations / quiz-results IDOR holes (**M1, M2**)
8. Introduce dedicated gradebook-write permission (**M3**)
9. Enforce quiz lockdown invariants server-side (**M4**)
10. DOMPurify around all KaTeX / markdown render points (**M5, M6**)
11. Failed-login and permission-denial audit logging (**M7, I1**)
12. Rate-limit quiz submission (**M9**)
13. Validate course-code input at the route boundary (**M10**)

### P2 — Following quarter
14. Tune Argon2 parameters (**M8**)
15. JWT key rotation with `kid` (**L2**)
16. Remove production panic paths (**L3**)
17. Document HTTPS/HSTS deployment contract (**L5**)
18. Add `govulncheck` / `npm audit` to CI; enable Dependabot (**I2**)
19. Add automated security regression tests (**I3**)

### P3 — Backlog
20. Refactor `fmt.Sprintf`-based SQL table references (**L4**)

---

## Dependency Posture (2026-04-20, updated for Go migration)

- `alexedwards/argon2id` — current, good
- `golang-jwt/jwt/v5` — current
- `jackc/pgx/v5` — current; parameterized queries in use throughout
- `go-chi/chi/v5` — current
- `golang.org/x/crypto` — current
- Frontend: React 19.2, react-router 7.14, react-markdown + rehype-katex — current
- **Missing on client:** `dompurify`. Add it as part of M5/M6 fix.

Run `govulncheck ./...` and `npm audit` on the current tree before merging the next release.

---

## Testing the Fixes

Every P0/P1 item should land with regression coverage:
- Unit tests where logic lives in a service module
- Integration tests in `server/test/` for end-to-end auth, CSRF, IDOR, and rate-limit behavior
- Component/DOM tests in the client for sanitizer regressions

A staging environment should be scanned with OWASP ZAP (or equivalent) before production cutover.
