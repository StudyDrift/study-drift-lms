# Security Issues — Lextures (Go server + React web client)

_Scan date: 2026-05-08. Triggered by the ShinyHunters / Salesloft-Drift breach pattern (stolen tokens used to pivot through SaaS)._

This is an updated, code-grounded review of the **current** repository (Go/chi server + React/Vite client). It supersedes `docs/SECURITY.md`, which still describes the previous Rust/Axum stack and is stale.

The themes that matter for a "ShinyHunters-style" intrusion are: **token theft surfaces**, **integration secrets**, **stored XSS in shared content**, **self-elevating accounts**, and **anything that can be reached without a session**. Findings below are ordered by severity.

---

## CRITICAL

### C1. Default JWT_SECRET committed in `docker-compose.yml`
- **File:** [docker-compose.yml:58](../docker-compose.yml#L58)
- **Detail:** `JWT_SECRET: change-me-in-production-use-a-long-random-string` is hard-coded. `config.Validate()` only requires ≥ 32 chars ([server/internal/config/config.go:269](../server/internal/config/config.go#L269)) — this string is 47 chars, so it passes. Anyone running `docker compose up` with the default file gets a globally-known signing key.
- **Risk:** Forge any user's access JWT (HS256, key known) → full account takeover, including Global Admin. Same risk every time someone copies this file and forgets to override.
- **Fix:**
  1. Remove the literal default from `docker-compose.yml`; require `JWT_SECRET` from `.env` (`JWT_SECRET: ${JWT_SECRET:?required}`).
  2. In `config.Load()` reject any `JWT_SECRET` that matches a known-default list (`change-me*`, `dev-secret-do-not-use*`, etc.) unless `ALLOW_INSECURE_JWT=1`.
  3. Rotate the secret on any environment that has ever booted with the default — invalidate all sessions.

### C2. First signup self-promotes to Global Admin — **fixed (2026-05-11)**
- **File:** [server/internal/service/authservice/credentials.go](../server/internal/service/authservice/credentials.go) (`Signup`), [server/internal/config/config.go](../server/internal/config/config.go) (`BOOTSTRAP_ADMIN_EMAIL`), [server/cmd/bootstrap-admin/main.go](../server/cmd/bootstrap-admin/main.go)
- **Detail (historical):** `Signup` used to assign `Global Admin` whenever the human user count was zero, with no environment gate.
- **Risk (historical):** A stranger hitting a fresh internet-exposed deploy before the operator could seize superuser.
- **Resolution:** Global Admin on first password signup only when `BOOTSTRAP_ADMIN_EMAIL` is set and equals the normalized signup email. Otherwise the first account is a normal Teacher. Operators can run `go run ./cmd/bootstrap-admin -email=…` from `server/` with `DATABASE_URL` to grant Global Admin after the fact.

### C3. Live API keys present in repo-root `.env` — **fixed (2026-05-11)**
- **File:** [.env](../.env) (gitignored, but on developer machines and any tarball/backup that ignores `.gitignore`)
- **Detail (historical):** The reported incident involved real-looking `OPEN_ROUTER_API_KEY` and `GITHUB_TOKEN` values in a local `.env`.
- **Risk (historical):** OpenRouter spend abuse and GitHub PAT pivoting if those materials were copied or exfiltrated.
- **Resolution:** Credentials were rotated/revoked. Keep `.env` out of version control; prefer a vault or secret manager for long-lived local keys. Automated secret scanning in CI/pre-commit remains tracked under **I2** if not already enabled.

---

## HIGH

### H1. Access + refresh tokens stored in `localStorage`
- **Files:** [clients/web/src/lib/auth.ts:14](../clients/web/src/lib/auth.ts#L14), [clients/web/src/lib/session-tokens.ts:13](../clients/web/src/lib/session-tokens.ts#L13)
- **Detail:** Both `studydrift_access_token` and `studydrift_refresh_token` live in `localStorage`, readable by any script in the SPA origin.
- **Risk:** A single XSS anywhere in the app (or in any same-origin asset, see H4 / H5) leaks the refresh token. Refresh tokens have multi-day lifetimes and survive password rotation only if `RevokeAllSessionsForUser` is invoked. This is the dominant pattern Salesloft/Drift attackers used: extract long-lived tokens, replay them out-of-band.
- **Fix:** Issue tokens as `HttpOnly; Secure; SameSite=Lax` cookies scoped to `/api`. Move `authorizedFetch` to `credentials: 'include'`. If you must keep the access token client-readable for compatibility, at minimum keep the **refresh** token server-side only.

### H2. CORS `Access-Control-Allow-Origin: *` and missing security headers
- **File:** [server/internal/httpserver/cors.go:9-11](../server/internal/httpserver/cors.go#L9), [server/internal/httpserver/server.go:59](../server/internal/httpserver/server.go#L59)
- **Detail:** `corsAll` mirrors the legacy "allow everything" middleware. There is **no** `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, or `Referrer-Policy` set on any response (`grep -r` returns nothing). Bearer tokens are not currently auto-attached cross-origin so CSRF impact is contained today, but the moment H1 moves to cookies CSRF becomes immediate.
- **Risk:** Clickjacking of admin pages (`/admin/*`), MIME-sniffing of uploaded files into HTML, no enforcement of script origin, no transport hardening, browsers send full URL referrer to third parties.
- **Fix:**
  1. Replace `corsAll` with an explicit allowlist (`PUBLIC_WEB_ORIGIN` + any tenant subdomains). Echo the request `Origin` only when it matches.
  2. Add a `secureHeaders` middleware in `NewHandler`:
     ```
     Strict-Transport-Security: max-age=31536000; includeSubDomains
     X-Frame-Options: DENY
     X-Content-Type-Options: nosniff
     Referrer-Policy: strict-origin-when-cross-origin
     Content-Security-Policy: default-src 'self'; script-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'
     ```
  3. Drop `Access-Control-Allow-Headers: *` — name the headers you actually allow.

### H3. No rate limiting on password / session endpoints
- **File:** [server/internal/httpserver/server.go:79-99](../server/internal/httpserver/server.go#L79), [server/internal/httpserver/auth.go](../server/internal/httpserver/auth.go)
- **Detail:** `/api/v1/auth/login`, `/auth/signup`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/refresh`, `/auth/mfa/totp/challenge`, `/auth/mfa/backup/challenge` accept unlimited requests. The codebase only rate-limits magic links (`magicLinkRateMax = 3 / 5min`, [magic_link.go:99](../server/internal/service/authservice/magic_link.go#L99)) — and that limit is **per known user**, not per IP, so an attacker enumerating non-existent emails is not throttled at all.
- **Risk:** Credential stuffing, account enumeration via timing/error differences (login hits Argon2 only when the email exists), MFA brute-force (TOTP is 6 digits → 10⁶), reset-token spray.
- **Fix:** Add IP- and account-keyed token-bucket middleware (e.g. `httprate` or a custom Redis bucket):
  - Login: 5 fails / 15 min per IP, 10 / hr per email.
  - Signup: 3 / hr per IP.
  - Forgot-password: 3 / hr per email + 10 / hr per IP.
  - MFA challenge: 5 / 5 min per pending JWT id (`jti`).

### H4. SVG branding upload served same-origin → stored XSS
- **Files:** [server/internal/httpserver/org_branding_http.go:343-363](../server/internal/httpserver/org_branding_http.go#L343), [server/internal/httpserver/org_branding_http.go:455-507](../server/internal/httpserver/org_branding_http.go#L455)
- **Detail:** `sniffImageKind` accepts `image/svg+xml` based on a `<svg` substring; `handleOrgBrandingUpload` writes the bytes verbatim, and `handlePublicOrgBrandAsset` serves them as `Content-Type: image/svg+xml` from the same origin as the SPA (`/api/v1/public/org-branding/...`). No SVG sanitization. SVG can carry `<script>`, `onload=`, foreign-object HTML, etc. Org branding is editable by any org admin or unit admin.
- **Risk:** Any tenant admin can plant a script that runs in-browser at the API origin for every visitor who navigates to the asset URL directly (e.g. via `<iframe>`, manual link, password-reset email logo). Combined with H1, that script can read both tokens out of `localStorage` and exfiltrate them.
- **Fix:** Either:
  1. Reject SVG entirely — keep PNG/JPEG/GIF only.
  2. Or sanitize with `bluemonday`'s SVG profile / `gosec` SVG strip before write, **and** serve with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` + `Content-Disposition: inline`, **and** serve from a separate cookieless origin.

### H5. Course-file content served with DB-controlled MIME, no `nosniff`, no `Content-Disposition`
- **File:** [server/internal/httpserver/course_file_content.go:55-62](../server/internal/httpserver/course_file_content.go#L55)
- **Detail:** Mime type is whatever was stored on insert (`row.MimeType`). The handler sets `Content-Type` and writes bytes; there is no `X-Content-Type-Options: nosniff`, no `Content-Disposition: attachment`, no allowlist. If a file row was created with `mime_type='text/html'` (Canvas import, QTI import, manual SQL, etc.), the file is rendered inline at the API origin → stored XSS.
- **Risk:** Same blast radius as H4. A teacher who can attach a file to a course can hand graders an HTML doc that runs JS in their session.
- **Fix:**
  1. Always send `X-Content-Type-Options: nosniff`.
  2. For anything not in `image/*`/`application/pdf`/`text/plain` allowlist, set `Content-Disposition: attachment; filename="…"`.
  3. Re-derive the content-type from the bytes (Go `http.DetectContentType`) and only trust the DB MIME if it matches the sniffed family.
  4. Long term: serve uploads from a separate non-cookied storage origin.

### H6. Unbounded HTTP request bodies + missing server timeouts
- **Files:** server uses `json.NewDecoder(r.Body).Decode(&b)` and `io.ReadAll(r.Body)` in dozens of handlers (e.g. [auth.go:48](../server/internal/httpserver/auth.go#L48), [auth.go:74](../server/internal/httpserver/auth.go#L74), [admin.go:68](../server/internal/httpserver/admin.go#L68), [rbac_settings.go:82](../server/internal/httpserver/rbac_settings.go#L82), and ~25 more). Only a few handlers (SCIM `1<<20`, originality webhook `4<<20`) wrap with `io.LimitReader`. The HTTP server constructed in [internal/app/app.go:78](../server/internal/app/app.go#L78) sets **no** `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, or `IdleTimeout`.
- **Risk:** Slowloris-style DoS, memory-exhaustion via 5 GB JSON POST, request-smuggling-adjacent oddities. Multipart uploads use `r.ParseMultipartForm(maxOrgBrandUploadBytes)` — fine — but the JSON paths are wide open.
- **Fix:**
  1. Set `srv.ReadHeaderTimeout = 10 * time.Second`, `IdleTimeout = 60 * time.Second`, `WriteTimeout` proportional to your slowest legitimate handler (e.g. 180s for the canvas import WS, separate server).
  2. Add a single `bodyLimitMiddleware(maxBytes)` that wraps `r.Body` in `http.MaxBytesReader`. Default 1 MiB; opt-in larger for known-large endpoints.

### H7. Permission-string wildcards interpreted in the *required* slot, plus user-controlled course code interpolation
- **Files:** [server/internal/authz/authz.go:21-23](../server/internal/authz/authz.go#L21), call sites such as [server/internal/httpserver/course_sections.go:93](../server/internal/httpserver/course_sections.go#L93) (`"course:"+courseCode+":item:create"`), [course_factory_reset.go:30](../server/internal/httpserver/course_factory_reset.go#L30), and ~20 more.
- **Detail:** `segmentMatches` returns true if **either** side is `*`. That means a *required* permission string containing `*` matches **any** grant. Required strings are built by string-concatenating the URL `course_code` path param. Course codes are auto-generated as `C-XXXXXX`, but several flows accept caller-supplied codes (Canvas import maps a Canvas course id; QTI import; LTI runtime). If any code path lets a user influence `courseCode` to be `*`, the caller authorizes themselves against any other course's grant.
  - Today this is partially blunted by `requireCourseAccess` calling `enrollment.UserHasAccess(courseCode, viewer)` first — a literal `*` doesn't match a real row. But the wildcard semantics are an architectural footgun: a future handler that skips that check (or any code that uses an alias / cross-listed code) can be escalated.
- **Fix:**
  1. Tighten `segmentMatches` to allow `*` only on the *granted* side: `g == "*" || g == r`.
  2. Validate `course_code` at the route boundary: `^[A-Za-z0-9_-]{1,32}$`. Reject `*`, `..`, whitespace, anything non-ASCII before it ever reaches a permission string or filesystem segment.

### H8. `course_code` flows into filesystem path with weak sanitization
- **File:** [server/internal/repos/coursefiles/paths.go:9-37](../server/internal/repos/coursefiles/paths.go#L9), used by [course_file_content.go:49](../server/internal/httpserver/course_file_content.go#L49) and `BlobDiskPath`.
- **Detail:** `diskCourseDirSegment` allows `.`, `_`, `-` and replaces unknown chars with `_`. It does **not** reject `..` (two literal dots), nor an all-`.` segment. `BlobDiskPath` then `filepath.Join(root, seg, key)` — `Join` will collapse `..` and traverse one directory above `root`. `filepath.Base(storageKey)` blunts the key half, but the segment half is exposed.
- **Risk:** Theoretical path traversal if any code path lets an attacker pick the course code (cross-listing import, QTI manifest with attacker XML, LTI deep-link mapping). Not exploitable today through the random course-code generator, but defense-in-depth is missing.
- **Fix:** After joining, `filepath.Clean` and assert `strings.HasPrefix(joined+string(filepath.Separator), root+string(filepath.Separator))`. Reject any segment whose `filepath.Clean` is `..` or contains `..` element. Never allow `.` as a sole-character segment.

---

## MEDIUM

### M1. Tokens delivered via URL fragment in SAML callback
- **File:** [server/internal/browsersaml/acs.go:250-273](../server/internal/browsersaml/acs.go#L250)
- **Detail:** `HandleACS` builds `…/saml-callback#access_token=…&refresh_token=…&mfa_pending_token=…` and runs `location.replace` from inline JS. Fragments are not sent to servers, but they sit in browser history, in `window.history.state`, in any extension that reads page URLs, and in DevTools logs.
- **Risk:** Fragment leakage to extensions/host inspection tooling. A second user on the same machine browsing history sees the token URL. Bad enough that auditors flag it independently of XSS.
- **Fix:** Issue a one-time correlation code (random 128-bit) in the fragment, redeem it via `POST /api/v1/auth/saml/exchange` for the actual tokens (set as cookies per H1).

### M2. Open-redirect via protocol-relative URL in `next` / `redirect_to`
- **Files:**
  - [clients/web/src/pages/saml-callback.tsx:18-19](../clients/web/src/pages/saml-callback.tsx#L18) — `nextRaw.startsWith('/')` only.
  - [server/internal/browsersaml/acs.go:265](../server/internal/browsersaml/acs.go#L265) — same `strings.HasPrefix(rs, "/")`.
- **Detail:** `//attacker.example` *also* starts with `/`, but is a protocol-relative URL → browser navigates off-origin. `magicLinkSanitizeRedirect` ([authservice/magic_link.go:264](../server/internal/service/authservice/magic_link.go#L264)) does explicitly reject `//`. The other two sites do not.
- **Risk:** Phish-grade open redirect: user clicks a SAML/login link they trust, ends up on attacker's clone.
- **Fix:** In every redirect-validation site, reject `strings.HasPrefix(s, "//")` *and* parse with `url.Parse` — if the result has a non-empty `Host`, reject.

### M3. JWT signing: HS256 only, no `kid`, no rotation
- **Files:** [server/internal/auth/jwt.go:285-296](../server/internal/auth/jwt.go#L285)
- **Detail:** Single static secret, no `kid` header, all token classes (login, MFA-pending, LTI embed) signed with the same key. Rotating means everyone is logged out simultaneously.
- **Risk:** A leaked or even *suspected* leak forces a global session bounce, which discourages rotation, which extends the breach window.
- **Fix:** Maintain `JWT_SECRETS_JSON` as `{ "kid": "secret" }` map. Sign with the current `kid`; verify accepts current + previous for an overlap window. Optional: switch to RS256/Ed25519 so the verifier can be public.

### M4. Argon2 parameters at rust-`Argon2::default()` (legacy compat)
- **File:** [server/internal/auth/password.go:9-15](../server/internal/auth/password.go#L9)
- **Detail:** `Memory: 19456, Iterations: 2, Parallelism: 1`. These match the previous Rust implementation but are below current OWASP Argon2id recommendations (≥ 47 MiB or t=3 / m=12 MiB / p=1).
- **Risk:** Cheaper offline cracking if the user table is exfiltrated.
- **Fix:** Bump to OWASP profile, benchmark on prod hardware so `HashPassword` takes 250–500 ms. Plan a re-hash on next successful login.

### M5. No replay protection on originality webhook
- **File:** [server/internal/httpserver/webhooks_originality.go:67-75](../server/internal/httpserver/webhooks_originality.go#L67)
- **Detail:** HMAC-SHA256 is verified, but the body has no timestamp / nonce. A captured request can be replayed forever. `MarkDoneByProviderReport` is largely idempotent, but a replayed callback can still resurrect a deleted/superseded report row depending on schema state.
- **Fix:** Require an `X-Originality-Timestamp` header in HMAC input, reject ≥ 5 min skew. Persist `(provider, providerReportId, timestamp)` and reject duplicates.

### M6. No audit logging for failed logins, permission denials, or sensitive admin mutations
- **Files:** [server/internal/service/authservice/credentials.go:136-138](../server/internal/service/authservice/credentials.go#L136), [server/internal/httpserver/admin.go:50](../server/internal/httpserver/admin.go#L50), all `apierr.WriteJSON(..., http.StatusForbidden, ...)` sites.
- **Detail:** Failed credentials return `ErrInvalidCredentials` silently. There is no `slog.Warn` for failed logins, no row in any `audit_events` table, no SIEM-friendly trail for "who tried what." Admin RBAC checks fail without a log line.
- **Risk:** Credential stuffing and privilege probing are invisible. If/when an intrusion happens you cannot reconstruct what the attacker tried first.
- **Fix:** Add structured `slog.Warn("auth.failed_login", "email", email, "ip", ip)`, `slog.Warn("authz.denied", "user", uid, "perm", required, "route", r.URL.Path)`, and a DB-backed audit-log for admin mutations (`POST /admin/*`, RBAC role changes, SCIM token issuance, SAML config edits).

### M7. SCIM and OneRoster bearer-token equality compares unsalted SHA-256
- **Files:** [server/internal/provisioning/scim/bearer.go:21-33](../server/internal/provisioning/scim/bearer.go#L21), `OneRosterBearerFallbackToken` in env config.
- **Detail:** Tokens are 32 random bytes (good entropy), stored as `sha256(token)`. Lookup by hash is fine for high-entropy tokens, but if an attacker dumps the table and one ever leaked through a log/proxy, an offline rainbow check is trivial without a salt.
- **Fix:** Use `argon2id` (or at least `hmac` with a server-side pepper) for stored bearer tokens. Add a `last_used_at` column and alert on tokens unused for > 30 d that suddenly appear.

### M8. KaTeX HTML rendered via `dangerouslySetInnerHTML` without DOMPurify
- **Files:** [clients/web/src/components/math/katex-expression.tsx:51,64](../clients/web/src/components/math/katex-expression.tsx#L51), [editor/math-insert-popover.tsx:187](../clients/web/src/components/editor/math-insert-popover.tsx#L187)
- **Detail:** KaTeX is invoked with `trust: false, strict: 'ignore'`, which is fine *today* — but the rendered HTML is fed to React via `dangerouslySetInnerHTML` with no defense in depth. A future KaTeX CVE or a config slip to `trust: true` is one PR away from stored XSS via student-authored LaTeX.
- **Fix:** Add `dompurify` to the client and run KaTeX output through `DOMPurify.sanitize(html, { USE_PROFILES: { mathMl: true, svg: true, html: true } })`. Add a regression test that injects `<img src=x onerror=alert(1)>` in an answer.

### M9. Hardcoded dev DB credentials in the default `docker-compose.yml`
- **File:** [docker-compose.yml:10-12,26-27](../docker-compose.yml#L10), [docker-compose.dev.yml](../docker-compose.dev.yml)
- **Detail:** `postgres` and `mongo` use `studydrift / studydrift`, both exposed on the host (`5432`, `27017`). On a developer laptop on a coffee-shop wifi this is reachable to anyone on the local network.
- **Risk:** Lateral exfil of test data; if a developer ever copies prod data into local for debugging, that data is on the network.
- **Fix:** Bind ports to `127.0.0.1:5432`/`127.0.0.1:27017`. Generate per-developer credentials in a `.env.local`.

---

## LOW

### L1. SSH 22 open to `0.0.0.0/0` on demo droplet firewall
- **File:** [iac/demo/main.tf:48-53](../iac/demo/main.tf#L48)
- **Detail:** Demo droplet allows SSH from the world. SSH to a personal droplet over the internet is fine if keys-only is enforced by cloud-init, but it's a constant noisy attack surface.
- **Fix:** Replace `0.0.0.0/0` with the office VPN egress / your home IP / a Tailscale-only address. Enable fail2ban via cloud-init.

### L2. Hardcoded developer-machine path in shipped binary
- **File:** [server/internal/httpserver/canvas_agent_debug_log.go:13](../server/internal/httpserver/canvas_agent_debug_log.go#L13)
- **Detail:** `canvasAgentDebugLogPath = "/Users/willdech/Documents/lextures/.cursor/debug-054d1d.log"` — silently no-ops in prod (path doesn't exist) but is a smell that this was meant to be deleted.
- **Fix:** Drop the file behind a `// +build dev` tag, or delete it.

### L3. SSO JIT user creation auto-enrolls "Teacher" role on signup with no admin gate
- **File:** [server/internal/service/authservice/credentials.go:195](../server/internal/service/authservice/credentials.go#L195) (`Signup`) and [server/internal/browsersaml/acs.go:237-243](../server/internal/browsersaml/acs.go#L237) (SAML JIT).
- **Detail:** Anyone who signs up via password gets `Teacher`. SAML JIT may grant `Teacher` based on a single attribute substring (`"teacher"`/`"instructor"`/`"faculty"` anywhere in the value).
- **Risk:** A self-asserted role from an external IdP is honored without an org admin's review. Teacher carries broad permissions in this codebase (course creation, item:create, etc.).
- **Fix:** Default new accounts to `Student`. Require an explicit promotion path — admin click, invite token, or a stricter IdP attribute mapping with exact-match values.

### L4. `getJwtSubject` parses base64 of an unverified JWT in the browser
- **File:** [clients/web/src/lib/auth.ts:41-53](../clients/web/src/lib/auth.ts#L41)
- **Detail:** Decodes the payload without verifying signature. Return value is used for cosmetic purposes only — fine if treated as untrusted, but easy to forget.
- **Fix:** Comment that the result is **not** authenticated and must never be used for authorization decisions on the client.

### L5. Failed login does Argon2 only when email exists → user-enumeration timing oracle
- **File:** [server/internal/service/authservice/credentials.go:120-138](../server/internal/service/authservice/credentials.go#L120)
- **Detail:** If `FindByEmail` returns nil, the handler returns immediately. Otherwise it runs Argon2id (~250 ms today, more after M4). Trivial timing distinguisher for "is this email a user?"
- **Fix:** Always perform an Argon2 verification against a static dummy hash when the email is unknown. (Cost: 1× Argon2 per failed login on unknown emails — same as the throttle bucket H3 enforces.)

### L6. JWT verification accepts no `iss`/`aud`
- **File:** [server/internal/auth/jwt.go:298-326](../server/internal/auth/jwt.go#L298)
- **Detail:** Algorithm is pinned to HS256 (good), but no `iss` or `aud` is set or checked. If you ever issue tokens for a sibling service with the same secret, they will cross-validate.
- **Fix:** Set `iss = "lextures"`, set `aud` per token class (`login`, `mfa_pending`, `lti_embed`), reject mismatches.

### L7. `magicLinkRateMax` is per-user only
- **File:** [server/internal/service/authservice/magic_link.go:28-29,99-105](../server/internal/service/authservice/magic_link.go#L28)
- **Detail:** Three requests per user per 5 minutes, but **no** IP-keyed limit and unknown-email requests skip the count entirely (early return at line 76 before the rate check).
- **Fix:** Add an IP-keyed bucket (e.g. 10 / 15 min) before the email lookup so enumeration attempts are throttled too.

---

## INFORMATIONAL

### I1. Add `gosec`, `staticcheck -checks=SA*`, and `govulncheck` to CI
Two-line additions to GitHub Actions; fail PRs on high-severity findings. Combine with Dependabot for `go.mod` and `package.json`.

### I2. Add `gitleaks` / `trufflehog` pre-commit + CI scan
Catches the next `.env` or token paste before it lands.

### I3. Stop shipping the legacy `docs/SECURITY.md`
It describes a Rust/Axum server, references file paths that no longer exist, and will mislead future readers. Replace it with a pointer to this file once issues here are triaged.

### I4. Add a security regression suite
At minimum:
- POST cross-origin to `/api/v1/courses` from a fake origin → 403 (after H2 fix).
- 11 failed logins / 60 s → throttled (after H3 fix).
- Upload a malicious SVG → either rejected (H4 fix) or stripped of script.
- Upload an HTML course file → rendered as `text/html` only with `Content-Disposition: attachment` (H5 fix).
- Fresh DB: first password signup must NOT become Global Admin unless `BOOTSTRAP_ADMIN_EMAIL` matches that user; a second signup never receives that bootstrap path (C2 fix).

### I5. Document a token-revocation runbook
On suspected token leak (C1, H1, M3), what is the operator command? Today: rotate `JWT_SECRET` and bounce the server (kicks every active session). After M3 lands: bump `kid`. Codify this so it isn't invented mid-incident.

---

## Suggested Fix Order

### Block production launch
1. **C1** Default JWT secret — remove and rotate.
2. ~~**C2** First-signup self-promotion~~ — done (`BOOTSTRAP_ADMIN_EMAIL` + `bootstrap-admin` CLI).
3. ~~**C3** Rotate the leaked-looking keys in repo `.env`~~ — done (rotated/revoked; hygiene ongoing).
4. **H1** Move tokens to `HttpOnly` cookies (or at least the refresh token).
5. **H2** Tighten CORS, add the security-headers middleware.
6. **H3** Auth-endpoint rate limiting.
7. **H4 / H5** SVG + course-file MIME hardening.
8. **H6** Body limits + server timeouts.

### Next sprint
9. **H7** Restrict authz wildcards + validate `course_code` at the boundary.
10. **H8** Defense-in-depth path canonicalization for course files.
11. **M1 / M2** SAML token-via-fragment + `//` open redirect.
12. **M5 / M6** Webhook replay protection + structured audit logs.
13. **M7** Pepper SCIM/OneRoster bearer token storage.
14. **M8** DOMPurify around KaTeX output.

### Following quarter
15. **M3** JWT `kid` + rotation overlap.
16. **M4** Argon2 OWASP profile + transparent rehash.
17. **M9** Bind dev compose ports to localhost.
18. **L1–L7** As capacity allows.

---

## Appendix A — Files referenced

- `docker-compose.yml`, `docker-compose.deploy.yml`
- `.env`, `.gitignore`
- `server/internal/app/app.go`
- `server/internal/auth/{jwt.go,password.go,http.go}`
- `server/internal/authz/authz.go`
- `server/internal/browsersaml/acs.go`
- `server/internal/config/config.go`
- `server/internal/httpserver/{server.go,cors.go,auth.go,admin.go,course_file_content.go,org_branding_http.go,scim_http.go,webhooks_originality.go,canvas_agent_debug_log.go,canvas_import_ws.go,course_sections.go,lms_dashboard.go}`
- `server/internal/provisioning/scim/bearer.go`
- `server/internal/repos/coursefiles/paths.go`
- `server/internal/repos/enrollment/enrollment.go`
- `server/internal/service/authservice/{credentials.go,magic_link.go}`
- `clients/web/src/lib/{auth.ts,session-tokens.ts,api.ts,math.ts}`
- `clients/web/src/components/math/katex-expression.tsx`
- `clients/web/src/components/editor/math-insert-popover.tsx`
- `clients/web/src/pages/saml-callback.tsx`
- `iac/demo/main.tf`
