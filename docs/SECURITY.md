# Security audit — Lextures / StudyDrift

**Scope:** Rust API server (`server/`), React web client (`clients/web/`), Docker / nginx deployment glue.  
**Method:** Static review of authentication, authorization, transport configuration, file handling, WebSockets, outbound HTTP (AI + Canvas import), error handling, and representative client storage / rendering paths. This is not a penetration test and does not replace dependency scanning, threat modeling, or formal review.

---

## Strengths (defense already in place)

- **Passwords:** Argon2 hashing and verification (`server/src/services/auth.rs`).
- **SQL access:** Queries use bound parameters; dynamic SQL fragments observed use fixed schema identifiers (e.g. `schema::COURSES`), not user-controlled SQL text.
- **Course file paths:** `course_code` is normalized to a safe directory segment before joining disk paths (`server/src/repos/course_files.rs`).
- **Feed message bodies:** Client renders markdown images only for strict course-file URL patterns; other image URLs are rejected (`clients/web/src/pages/lms/CourseFeedPage.tsx`).
- **RBAC:** Permission strings are validated to four non-empty segments before checks (`server/src/http_auth.rs`, `server/src/repos/rbac.rs`).
- **Sensitive DB errors:** Generic client message for `sqlx` failures (`server/src/error.rs`).
- **Container runtime user:** Server image runs as `nobody` (`server/Dockerfile`).
- **JWT secret (remediated):** Startup requires `JWT_SECRET` of at least 32 characters unless `ALLOW_INSECURE_JWT=1` is set for local-only use (`server/src/config.rs`).

---

## Ranked recommendations

Issues are ordered **critical → low**. Within a band, prefer fixing misconfiguration and token-handling issues before hardening niceties.

### Critical

1. **WebSocket authentication passes the JWT in the query string**
  **Risk:** Query strings are often written to access logs, proxy logs, `Referer` headers (in some flows), and browser history. Any leak equals bearer-token compromise for mailbox, course feed realtime, and Canvas import sockets.  
   **Evidence:** `server/src/routes/communication.rs` (`WsAuth { token }`), `server/src/routes/course_feed.rs` (`FeedWsAuth`), `server/src/routes/courses.rs` (`CanvasImportWsQuery`); client builds URLs in `clients/web/src/lib/communicationApi.ts` and related feed/canvas helpers.  
   **Remediation:** Prefer `Sec-WebSocket-Protocol` bearer subprotocol, a short-lived single-use WS ticket exchanged over `POST` + `Authorization`, or cookie-based sessions with `HttpOnly` + `SameSite` + CSRF protection for the ticket exchange. Ensure reverse proxies are configured not to log query strings for `/api/*/ws` routes if migration is phased.

### High

1. **Canvas import sends the user-supplied base URL arbitrary HTTPS Bearer traffic**
  **Risk:** Any instructor (or anyone with course-item import permission) can set `canvas_base_url` to a hostname they control. The server then sends the Canvas personal access token in the `Authorization` header to that host — **credential exfiltration** — and may follow redirects (default `reqwest` behavior), widening **SSRF** risk toward internal URLs depending on redirect chains.  
   **Evidence:** `normalize_canvas_base_url` only enforces `https` + hostname (`server/src/services/canvas_course_import.rs`); `canvas_get_json_url` attaches the token (`server/src/services/canvas_course_import.rs`); client created with `Client::builder()` in `server/src/routes/courses.rs` (no redirect policy / IP blocklist visible).  
   **Remediation:** Restrict `canvas_base_url` to an institutional allowlist (e.g. suffix match on `*.instructure.com` and/or env-configured domains). Use `redirect::Policy::limited` or disable redirects; optionally resolve DNS and reject private/link-local/metadata IP ranges before connecting.
2. **CORS allows any origin**
  **Risk:** Today the SPA relies on bearer tokens in `localStorage`, which limits classic cookie CSRF, but `allow_origin(Any)` weakens defense in depth and complicates any future cookie-based auth, native wrappers, or misconfigured subdomains.  
   **Evidence:** `server/src/app.rs` (`CorsLayer::new().allow_origin(Any)`).  
   **Remediation:** Set explicit allowed origins from configuration (per environment). Keep credentials disabled unless you intentionally add cookie auth with tight origin + CSRF design.
3. **No authentication rate limiting or lockout**
  **Risk:** `/api/v1/auth/login` and `/api/v1/auth/signup` are unauthenticated endpoints suitable for credential stuffing and registration spam.  
   **Evidence:** `server/src/routes/auth.rs` — no middleware layer for throttling in `server/src/app.rs`.  
   **Remediation:** Add IP- and account-based limits (reverse proxy, gateway, or Axum middleware), exponential backoff after failures, and optional CAPTCHA or invite-only signup for production deployments.
4. `**/health/ready` exposes database error strings to clients**
  **Risk:** Operational and schema details can aid an attacker mapping the stack or migration state.  
   **Evidence:** `server/src/routes/health.rs` includes `"detail": detail` on failure.  
   **Remediation:** Return a fixed message to the client; log the detailed error server-side only. Restrict this endpoint to internal networks or monitoring systems in production.
5. **Default Docker Compose credentials and exposed database ports**
  **Risk:** Accidental deployment of dev compose files, or a reachable host with default Postgres/Mongo passwords, leads to trivial data compromise. Mongo appears unused by the Rust server but is still bundled with weak defaults.  
   **Evidence:** `docker-compose.yml` (`POSTGRES_PASSWORD`, `JWT_SECRET: change-me-…`, `mongo` service, published `5432` / `27017`).  
   **Remediation:** Remove unused services from default stacks; use secrets management; do not publish DB ports in “production-style” profiles; document that compose files are dev-only unless hardened.

### Medium

1. **Long-lived access JWT (72 hours) with no revocation path**
  **Risk:** Stolen token remains valid for days; no server-side invalidation on password change or “log out everywhere.”  
   **Evidence:** `server/src/jwt.rs` (`Duration::hours(72)`).  
   **Remediation:** Shorten access-token TTL; add refresh tokens with rotation and server-side revocation; or maintain a small denylist / session version in the database checked on each request.
2. **Access token stored in `localStorage`**
  **Risk:** Any XSS on the SPA origin reads the token and calls the API as the victim.  
   **Evidence:** `clients/web/src/lib/auth.ts`.  
   **Remediation:** Prefer `HttpOnly` `Secure` cookies with CSRF tokens for browser clients, or at least pair `localStorage` tokens with strict CSP + aggressive XSS review. Document residual XSS impact for operators.
3. **Course image uploads trust client-declared MIME type without content sniffing**
  **Risk:** Declared `image/png` with non-image bytes could be used for polyglot files or confused downstream tools (less likely to execute in browsers when served with correct `Content-Type`, but still undesirable).  
    **Evidence:** `server/src/services/course_image_upload.rs` (`normalize_image_mime` from multipart `content_type` only; no magic-byte validation).  
    **Remediation:** Verify magic bytes (PNG/JPEG/GIF/WebP signatures) or decode once with a strict image crate and reject on failure.
4. **Public self-service signup**
  **Risk:** Spam accounts, storage abuse, and unsolicited messaging to registered users if messaging is abused.  
    **Evidence:** `server/src/routes/auth.rs` exposes `POST /api/v1/auth/signup`.  
    **Remediation:** Gate signup behind invites, email verification, admin approval, or disable the route in production configuration if not required.
5. **AI failure responses may echo upstream / transport details**
  **Risk:** `AppError::AiGenerationFailed` returns the inner string to clients (`server/src/error.rs`); mapping code often passes through HTTP or parse errors (`server/src/routes/settings.rs`, `server/src/routes/courses.rs`, `server/src/services/*_ai.rs`).  
    **Remediation:** Log full errors server-side; return generic messages to clients (optionally with a correlation id).

### Low

1. **No Content Security Policy (or other security headers) in the SPA shell**
  **Risk:** XSS impact is maximized without CSP framing/navigation restrictions.  
    **Evidence:** `clients/web/index.html` loads Google Fonts and Vite entry only; no meta CSP. `clients/web/nginx.conf` does not set `Content-Security-Policy`, `X-Frame-Options`, or `Strict-Transport-Security`.  
    **Remediation:** Add a strict CSP for the built assets; set `HSTS` when TLS is terminated for real hostnames; consider `X-Content-Type-Options: nosniff`.
2. **Markdown link `href` is not scheme-restricted**
  **Risk:** `javascript:` URLs in user-controlled markdown could execute in some user-agent / React combinations when clicked (`clients/web/src/components/syllabus/SyllabusMarkdownView.tsx` `a` component passes `href` through).  
    **Remediation:** Sanitize `href` to `http`, `https`, `mailto`, and same-origin relative paths; strip or neutralize `javascript:` and data URLs.
3. **Operational hygiene**
  **Remediation:** Run `cargo audit` / `npm audit` in CI; pin base images; enable automated Dependabot-style updates; periodic review of OpenRouter and third-party data processing agreements (student content may be sent to external models per AI routes).

---

## Summary table


| Priority | Count | Themes                                                                                    |
| -------- | ----- | ----------------------------------------------------------------------------------------- |
| Critical | 1     | WebSocket token in URL                                                                    |
| High     | 5     | Canvas URL/token + SSRF; CORS; auth rate limits; health info leak; compose defaults       |
| Medium   | 5     | JWT lifetime + revocation; localStorage; upload validation; open signup; AI error leakage |
| Low      | 3     | CSP / headers; markdown `javascript:` links; dependency & ops hygiene                     |


---

## Next steps

1. Address the remaining **critical** item before any internet-exposed deployment.
2. Tighten **Canvas import** URL policy and HTTP client redirect behavior before treating imports as safe in enterprise networks.
3. Add **automated** checks (config validation, security headers in nginx for prod profiles, audit in CI) so regressions are caught early.

If you want a follow-up pass, the highest-value dynamic work would be: authenticated fuzzing of course-scoped IDs for IDOR, a focused review of `server/src/routes/courses.rs` for any handler that skips `assert_permission`, and a CSP rollout plan tested against TipTap / markdown rendering.