# {Feature ID} — {Feature Name}

> Implementation plan. Source: [docs/MISSING_FEATURES.md](../MISSING_FEATURES.md) §{section}.

## Metadata

| Field | Value |
|---|---|
| **Feature ID** | {e.g. 1.1} |
| **Section** | {e.g. Adaptive Learning Core} |
| **Severity** | BLOCKER \| MAJOR \| MINOR |
| **Markets** | K12 / HE / SL |
| **Status (today)** | MISSING \| PARTIAL \| THIN |
| **Estimated effort** | XS (≤1d) \| S (1w) \| M (2–4w) \| L (1–2mo) \| XL (>2mo) |
| **Owner (proposed)** | {team / individual} |
| **Depends on** | {list of Feature IDs that must ship first} |
| **Unblocks** | {list of Feature IDs this enables} |

---

## 1. Problem Statement

2–4 sentences. *What is missing today, who is hurt by the gap, and what business outcome does fixing it create?*

## 2. Goals

- Bullet list of 3–5 outcomes the work must achieve.

## 3. Non-Goals

- Explicit out-of-scope items so reviewers do not chase scope creep.

## 4. Personas & User Stories

- **As a {role}**, I want to {action} so that {value}.
- Cover student, instructor, admin, parent (where relevant), and self-learner perspectives.

## 5. Functional Requirements

Numbered, testable, written in MUST / SHOULD / MAY (RFC 2119) form.

- **FR-1.** The system MUST …
- **FR-2.** The system MUST …
- **FR-3.** The system SHOULD …

## 6. Non-Functional Requirements

- **Performance** — p95 latency targets, throughput, payload size limits.
- **Security** — authn/authz model, threat-model notes, encryption.
- **Privacy & Compliance** — FERPA / COPPA / GDPR / WCAG / SOC 2 obligations.
- **Accessibility** — WCAG 2.1 AA conformance for all UI added.
- **Scalability** — expected load, partitioning strategy.
- **Reliability** — availability target, failure modes, idempotency.
- **Observability** — required metrics, log fields, traces, alerts.
- **Maintainability** — coding conventions, owned modules.
- **Internationalization** — strings externalised, tz/locale handled.
- **Backward compatibility** — migration & deprecation policy.

## 7. Acceptance Criteria

Concrete, testable, Given/When/Then format. Each AC SHOULD map to at least one automated test.

- **AC-1.** *Given* … *When* … *Then* …
- **AC-2.** …

## 8. Data Model

- New tables / columns / enums.
- Indexes & constraints.
- Migration file naming convention used by the repo (`server/migrations/NNN_*.sql`).
- Backfill strategy for existing rows.

## 9. API Surface

- New / changed HTTP routes (path, verb, auth scope).
- Request & response shapes (JSON schema or pseudo-TypeScript).
- WebSocket events if applicable.
- Rate-limit / quota considerations.
- OpenAPI documentation requirement.

## 10. UI / UX

- New pages, modified pages, new components.
- Key user flows (numbered).
- Empty / loading / error / offline states.
- Mobile / responsive behaviour.
- Accessibility annotations (focus order, ARIA).
- Copy & i18n keys.

## 11. AI / ML Considerations

(Skip if not AI-touching.)

- Model(s) used, prompts, eval metric, fallback path, PII redaction, cost budget.

## 12. Integration Points

- External services / APIs touched (with versions).
- Internal modules touched (with file paths).
- Webhook / event emissions.

## 13. Dependencies & Sequencing

- Must ship after: {Feature IDs}.
- Must ship before: {Feature IDs}.
- Shared infra needed: object storage, job queue, email, etc.

## 14. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| … | L/M/H | L/M/H | … |

## 15. Rollout Plan

- Feature flag name & default state.
- Migration sequencing (schema → backfill → code → flip flag).
- Dogfood / pilot cohort.
- GA criteria & comms.
- Rollback path.

## 16. Test Plan

- **Unit** — what is covered.
- **Integration** — DB / API / WebSocket scenarios.
- **End-to-end** — Playwright happy paths + edge cases.
- **Security** — authz matrix, abuse cases, OWASP-relevant checks.
- **Accessibility** — automated (axe) + screen-reader scripts.
- **Performance / load** — target tooling and pass criteria.
- **Manual exploratory** — checklists for QA.

## 17. Documentation & Training

- End-user docs (help center).
- Admin / instructor docs.
- API reference updates.
- Internal runbook updates.

## 18. Open Questions

- Numbered list of decisions that still need owners or research.

## 19. References

- Existing files this work touches: `server/src/...`, `clients/web/src/...`.
- External standards: RFCs, IMS Global specs, NIST guidance, etc.
- Related plans: `../{section-folder}/{file}.md`.
