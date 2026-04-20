# Missing Features — Lextures Gap Analysis

A comprehensive inventory of capabilities the Lextures LMS is missing relative to its positioning as the *first truly adaptive learning environment* serving **K–12**, **university/higher-ed**, and **self-learner** markets.

This is a wider, market-segmented complement to `[FEATURES.md](FEATURES.md)`, which tracks an engineering-priority backlog. Items already enumerated there are referenced rather than re-listed.

Generated: 2026-04-17. Snapshot of `main` at `4f17ace`.

---

## How to read this document

- **Severity** — `BLOCKER` (cannot sell to segment without it) · `MAJOR` (RFP-losing gap) · `MINOR` (nice-to-have / parity).
- **Markets** — `K12`, `HE` (higher-ed), `SL` (self-learner).
- **Status** — `MISSING` (no code) · `PARTIAL` (config or schema exists, no E2E flow) · `THIN` (works but incomplete).
- Each section ends with a *Recommended next step* anchored to existing files where useful.

---

## 1. Adaptive Learning Core (the product's stated differentiator)

The product is positioned as adaptive, but only one adaptive surface exists today: a single AI-driven "next question" endpoint inside quizzes (`[server/src/services/adaptive_quiz_ai.rs](server/src/services/adaptive_quiz_ai.rs)`). For an LMS to credibly claim "truly adaptive," the following are missing.


| #    | Gap                                                                                                                                                                                                        | Severity | Markets     | Status  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------- | ------- |
| 1.1  | **Learner model / knowledge state** — no persistent representation of what a student knows, mastery decay, or confidence per concept. Without this, "adaptive" is per-session only.                        | BLOCKER  | K12, HE, SL | MISSING |
| 1.2  | **Skill / concept graph** — no taxonomy of skills, prerequisites, or dependencies. Quizzes generate questions but have no concept tags to update mastery against.                                          | BLOCKER  | K12, HE, SL | MISSING |
| 1.3  | **Standards alignment** — no Common Core / NGSS / state-standard / Bloom's taxonomy mapping per item. K-12 districts cannot adopt without this.                                                            | BLOCKER  | K12         | MISSING |
| 1.4  | **Adaptive *paths* across modules** — adaptivity is locked inside quiz attempts. Course structure (`course_structure_items`) is linear; no "skip if mastered" / "remediate if struggling" branching.       | MAJOR    | K12, HE, SL | MISSING |
| 1.5  | **Spaced repetition / retrieval practice** — no SRS scheduler (SM-2, FSRS). Self-learners specifically expect Anki-class retention behavior.                                                               | MAJOR    | SL, K12     | MISSING |
| 1.6  | **Item Response Theory (IRT) / difficulty calibration** — questions have no difficulty, discrimination, or guessing parameters. Adaptive selection is LLM-eyeballed rather than psychometrically grounded. | MAJOR    | HE, K12     | MISSING |
| 1.7  | **Diagnostic / placement assessments** — no "where should this learner start" flow. Required for self-learners onboarding without an instructor.                                                           | MAJOR    | SL, K12     | MISSING |
| 1.8  | **Recommendations engine** — no "next best content" surface. RAG notebook (`[student_notebook_rag_ai.rs](server/src/services/student_notebook_rag_ai.rs)`) is reactive only.                               | MAJOR    | SL, HE      | MISSING |
| 1.9  | **Hint scaffolding & worked examples** — no progressive hint system on questions or assignments. Adaptive feedback is currently end-of-attempt only.                                                       | MAJOR    | K12, SL     | MISSING |
| 1.10 | **Misconception detection & remediation library** — wrong answers route to nothing; no "you missed this because…" content links.                                                                           | MAJOR    | K12, HE     | MISSING |


**Recommended next step:** introduce a `concepts` table + `concept_assessments` join (item ↔ concept), a `learner_concept_states` mastery table updated by quiz grading, and add concept tags to AI-generated questions in `[quiz_generation_ai.rs](server/src/services/quiz_generation_ai.rs)`. This single foundation unblocks 1.1, 1.2, 1.4, 1.6, 1.8, 1.10.

---

## 2. Assessment & Authoring

The current quiz model stores `questions_json` as a JSONB blob (`[module_quizzes](server/migrations)`). Many assessment types and features assumed in modern LMSs are absent.


| #    | Gap                                                                                                                                                                                                                                                                                    | Severity | Markets     | Status  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------- | ------- |
| 2.1  | **Question bank / item pool** — questions are inline per quiz; no shareable, taggable bank, no random-pull-N-from-pool.                                                                                                                                                                | MAJOR    | K12, HE     | MISSING |
| 2.2  | **Question types** — extended with `matching`, `ordering`, `hotspot`, `numeric`, `formula`, `code`, `file_upload`, `audio_response`, and `video_response` across quiz schema, submission payloads, and grading dispatch (objective grading where configured). | MAJOR    | K12, HE, SL | DONE    |
| 2.3  | **Math rendering & input** — [KaTeX](https://katex.org/) in TipTap (`math_inline` / `math_block`), quiz/preview [`MathPlainText`](clients/web/src/components/math/MathPlainText.tsx), syllabus [`remark-math`+`rehype-katex`](clients/web/src/components/syllabus/SyllabusMarkdownView.tsx), student [`MathKeyboard`](clients/web/src/components/quiz/MathKeyboard.tsx). Flag: `VITE_MATH_RENDERING_ENABLED`. | MAJOR    | K12, HE     | DONE    |
| 2.4  | **Code-execution questions** — no integrated runner (Judge0, Piston, or sandboxed container) for CS courses or coding bootcamps.                                                                                                                                                       | MAJOR    | HE, SL      | MISSING |
| 2.5  | **Surveys & non-graded questionnaires** — no anonymous/ungraded survey type (course feedback, end-of-term evals).                                                                                                                                                                      | MAJOR    | HE, K12     | MISSING |
| 2.6  | **Question versioning & history** — editing a question silently invalidates past attempts; no immutable item versions.                                                                                                                                                                 | MAJOR    | HE          | MISSING |
| 2.7  | **Time limits & auto-submit on timeout** — schema lacks `time_limit_seconds`; UI lacks a server-authoritative timer.                                                                                                                                                                   | MAJOR    | HE, K12     | MISSING |
| 2.8  | **Per-attempt question shuffling & answer shuffling** — not in `delivery` settings.                                                                                                                                                                                                    | MINOR    | HE, K12     | MISSING |
| 2.9  | **Multiple attempts policies** — no "highest / latest / average / first" attempt-grade rule on quizzes.                                                                                                                                                                                | MAJOR    | K12, HE     | THIN    |
| 2.10 | **Lockdown / kiosk / one-question-at-a-time** mode — no enforced single-question delivery, no back-button block.                                                                                                                                                                       | MAJOR    | HE, K12     | MISSING |
| 2.11 | **Accommodations** — no per-student extended-time, alternate-format, or extra-attempts overrides (504 / IEP requirement in K-12, ADA in HE).                                                                                                                                           | BLOCKER  | K12, HE     | MISSING |
| 2.12 | **Learning Tools Interoperability (LTI 1.3)** — no LTI Advantage consumer for embedding publisher tools, nor provider role for being embedded by a parent LMS.                                                                                                                         | BLOCKER  | HE          | MISSING |
| 2.13 | **QTI / Common Cartridge import** — no industry-standard content import (1.2/1.3). Blocks publisher-content adoption.                                                                                                                                                                  | MAJOR    | K12, HE     | MISSING |
| 2.14 | **SCORM / xAPI / cmi5 packages** — no support for self-paced corporate-style courseware (relevant for SL marketplace plays).                                                                                                                                                           | MAJOR    | SL, HE      | MISSING |


---

## 3. Submissions, Grading & Academic Integrity

Assignment submissions are now wired (`[FEATURES.md](FEATURES.md)` confirms), but the surrounding grading workflow is thin.


| #    | Gap                                                                                                                                                                              | Severity | Markets | Status  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- | ------- |
| 3.1  | **Inline document annotation** — no in-browser PDF/Doc annotation (highlight, comment, draw) on student submissions. SpeedGrader-equivalent is the #1 instructor expectation.    | BLOCKER  | K12, HE | MISSING |
| 3.2  | **Audio / video feedback** — no voice/video comment recorder for instructors.                                                                                                    | MAJOR    | K12, HE | MISSING |
| 3.3  | **Anonymous grading / blind grading** — no flag to hide student identity from grader.                                                                                            | MAJOR    | HE      | MISSING |
| 3.4  | **Moderated grading / multiple graders** — no second-grader workflow with reconciliation.                                                                                        | MAJOR    | HE      | MISSING |
| 3.5  | **Plagiarism / AI-content detection** — no Turnitin/Copyleaks/GPTZero/Originality integration. As an AI-first LMS, an *internal* AI-authorship signal would be a differentiator. | BLOCKER  | HE, K12 | MISSING |
| 3.6  | **Grade categories beyond points** — no letter-grade scales with custom cutoffs, no GPA computation, no pass/fail, no complete/incomplete, no narrative-only.                    | MAJOR    | K12, HE | THIN    |
| 3.7  | **Standards-based grading / mastery transcripts** — required by many K-12 districts and competency-based HE programs.                                                            | BLOCKER  | K12     | MISSING |
| 3.8  | **Grade posting policies** — no "hold grades until released," no per-assignment release schedule.                                                                                | MAJOR    | K12, HE | MISSING |
| 3.9  | **Drop lowest N / replace lowest** policies on assignment groups — only flat weighting today.                                                                                    | MAJOR    | HE, K12 | MISSING |
| 3.10 | **Grade-change audit trail** — no per-grade history showing who changed what when. FERPA-significant for HE, often required by K-12 districts.                                   | MAJOR    | K12, HE | MISSING |
| 3.11 | **Bulk grade CSV import/export** — already in `[FEATURES.md](FEATURES.md)` §12.                                                                                                  | MAJOR    | K12, HE | MISSING |
| 3.12 | **Excused / exempt** — no per-student "excused" state distinct from missing.                                                                                                     | MAJOR    | K12, HE | MISSING |
| 3.13 | **Resubmission workflow with instructor request** — no "request revision" loop.                                                                                                  | MINOR    | HE, K12 | MISSING |
| 3.14 | **Originality reports stored with submission** — depends on 3.5.                                                                                                                 | MAJOR    | HE      | MISSING |


---

## 4. Identity, SSO & Provisioning (institutional adoption blocker)

Today: email + password JWT only (`[server/src/services/auth.rs](server/src/services/auth.rs)`).


| #    | Gap                                                                                                             | Severity | Markets     | Status  |
| ---- | --------------------------------------------------------------------------------------------------------------- | -------- | ----------- | ------- |
| 4.1  | **SAML 2.0 SSO** — required by virtually every university IT department.                                        | BLOCKER  | HE, K12     | MISSING |
| 4.2  | **OIDC SSO** (Google Workspace for Education, Microsoft Entra/Azure AD, Apple).                                 | BLOCKER  | K12, HE     | MISSING |
| 4.3  | **OneRoster 1.2 (CSV + REST)** — de facto K-12 roster sync standard.                                            | BLOCKER  | K12         | MISSING |
| 4.4  | **Clever / ClassLink** — primary K-12 SSO and rostering middleware in US districts.                             | BLOCKER  | K12         | MISSING |
| 4.5  | **SCIM 2.0** — automated user provisioning/deprovisioning from IdP.                                             | MAJOR    | HE, K12     | MISSING |
| 4.6  | **MFA / TOTP / WebAuthn / passkeys** — no second-factor on the local password path.                             | MAJOR    | HE, K12, SL | MISSING |
| 4.7  | **Magic-link / passwordless login** — friction-reducer for K-12 students and SL.                                | MAJOR    | K12, SL     | MISSING |
| 4.8  | **JWT refresh & revocation** — current JWTs are 72h with no server-side revocation list; logout is client-only. | MAJOR    | HE, K12     | THIN    |
| 4.9  | **Device & session management UI** — students can't see or terminate active sessions.                           | MINOR    | HE, K12     | MISSING |
| 4.10 | **Password policy & breach detection** — no length/complexity policy, no haveibeenpwned check.                  | MAJOR    | K12, HE     | MISSING |


---

## 5. Multi-tenancy, Org Hierarchy & Roles

The schema is logically partitioned (`course.`, `user.`, `communication.`, `settings.`) but there is no tenant boundary above a course.


| #    | Gap                                                                                                                                                                          | Severity | Markets | Status  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- | ------- |
| 5.1  | **Organization / institution / district entity** — no top-level tenant; every install is effectively single-org. Blocks SaaS multi-tenancy and district-of-schools modeling. | BLOCKER  | K12, HE | MISSING |
| 5.2  | **Sub-accounts / schools / departments** — no school → department → course nesting; required for K-12 districts and HE colleges-within-universities.                         | BLOCKER  | K12, HE | MISSING |
| 5.3  | **Term / academic year / grading period** entities — courses have free-form date ranges, no shared "Spring 2026" term object.                                                | BLOCKER  | K12, HE | MISSING |
| 5.4  | **Sections** distinct from courses — multiple sections of one course sharing content but separate rosters and gradebooks.                                                    | BLOCKER  | HE, K12 | MISSING |
| 5.5  | **Cross-listing** — combining sections into one teaching shell.                                                                                                              | MAJOR    | HE      | MISSING |
| 5.6  | **Course blueprints / templates** — push content from a master to many child courses (district-wide curriculum standardization).                                             | MAJOR    | K12     | MISSING |
| 5.7  | **Org-level branding & domains** — no per-tenant subdomain, logo, color, custom email-from.                                                                                  | MAJOR    | K12, HE | MISSING |
| 5.8  | **Org-level role hierarchy** — current RBAC (`[authz.rs](server/src/authz.rs)`) is course-scoped + global. No "principal of School X can see all courses in School X."       | MAJOR    | K12, HE | THIN    |
| 5.9  | **Designer / TA / Observer / Auditor / Librarian** roles — only owner / instructor / student today.                                                                          | MAJOR    | K12, HE | THIN    |
| 5.10 | **Parent / Guardian** role with read-only child view, observation linking, multi-child switcher.                                                                             | BLOCKER  | K12     | MISSING |


---

## 6. Communication & Collaboration

Inbox + course feed + announcements-via-feed exist. The wider collaborative LMS surface is thin.


| #    | Gap                                                                                                                                                                                             | Severity | Markets     | Status  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------- | ------- |
| 6.1  | **Threaded discussion forums** — referenced in `[FEATURES.md](FEATURES.md)` §5; still missing.                                                                                                  | MAJOR    | K12, HE     | MISSING |
| 6.2  | **Email notifications** — referenced in `[FEATURES.md](FEATURES.md)` §6.                                                                                                                        | BLOCKER  | K12, HE, SL | MISSING |
| 6.3  | **Push notifications** (web + mobile) and per-channel preferences.                                                                                                                              | MAJOR    | K12, HE, SL | MISSING |
| 6.4  | **Synchronous video / virtual classroom** — no BigBlueButton, Jitsi, Zoom, or Meet integration; no recording capture; no breakout rooms.                                                        | BLOCKER  | K12, HE     | MISSING |
| 6.5  | **Collaborative documents** — no shared whiteboard, no live co-editing of student work.                                                                                                         | MAJOR    | K12, HE     | MISSING |
| 6.6  | **Group spaces** — enrollment groups exist but have no group-only feed channel, files area, or assignment workspace.                                                                            | MAJOR    | HE, K12     | THIN    |
| 6.7  | **Office hours / appointment scheduling** — no calendar booking or queue.                                                                                                                       | MAJOR    | HE          | MISSING |
| 6.8  | **In-context help & live chat support** — no embedded support widget.                                                                                                                           | MINOR    | SL, K12     | MISSING |
| 6.9  | **Conversational AI tutor in-context** — RAG notebook exists but no persistent tutor that knows the learner's mastery, current assignment, and recent confusion. Major adaptive differentiator. | MAJOR    | SL, K12, HE | THIN    |
| 6.10 | **Translated / multilingual messaging** — no auto-translate of inbox, feed, or announcements.                                                                                                   | MINOR    | K12, HE     | MISSING |


---

## 7. Mobile, Offline & Cross-Platform


| #   | Gap                                                                                                                                                             | Severity | Markets | Status  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- | ------- |
| 7.1 | **Native mobile apps** (iOS/Android) — none. The web app is desktop-first React; no React Native / Capacitor / Flutter wrapper. K-12 students are mobile-first. | BLOCKER  | K12, SL | MISSING |
| 7.2 | **Mobile-responsive review** — no audited mobile breakpoints; gradebook grid, drag-drop module editor, and TipTap toolbar are not touch-optimized.              | MAJOR    | All     | THIN    |
| 7.3 | **Offline mode / PWA** — listed in `[FEATURES.md](FEATURES.md)` §22. Critical for low-bandwidth K-12 districts and SL on transit.                               | MAJOR    | K12, SL | MISSING |
| 7.4 | **App-store presence** — required for K-12 procurement and SL discovery. Depends on 7.1.                                                                        | MAJOR    | K12, SL | MISSING |
| 7.5 | **Push notification service** — APNs/FCM wiring; depends on 6.3 + 7.1.                                                                                          | MAJOR    | K12, SL | MISSING |


---

## 8. Content, Media & File Handling

Course files are stored on the server's local disk; uploads are not chunked, scanned, or CDN-delivered.


| #    | Gap                                                                                                                                                                | Severity | Markets     | Status  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ----------- | ------- |
| 8.1  | **Object storage backend (S3 / R2 / GCS / MinIO)** — referenced in `[FEATURES.md](FEATURES.md)` §16. Blocking for any production deployment over a single droplet. | BLOCKER  | All         | MISSING |
| 8.2  | **Resumable / chunked uploads** (tus / Uppy) — large media submissions fail today.                                                                                 | MAJOR    | HE, K12     | MISSING |
| 8.3  | **Video transcoding & adaptive streaming** (HLS/DASH) — no pipeline; uploaded videos serve as raw MP4.                                                             | MAJOR    | HE, K12, SL | MISSING |
| 8.4  | **Auto-captioning & transcripts** — required for ADA compliance on any video content.                                                                              | BLOCKER  | HE, K12     | MISSING |
| 8.5  | **Per-course / per-user storage quotas** — none enforced; risk of disk exhaustion.                                                                                 | MAJOR    | K12, HE     | MISSING |
| 8.6  | **Antivirus / malware scanning** on uploads (ClamAV) — none.                                                                                                       | MAJOR    | K12, HE     | MISSING |
| 8.7  | **Image & PDF previewing in-browser** — no thumbnailer, no PDF.js viewer for inline submissions/files.                                                             | MAJOR    | K12, HE     | MISSING |
| 8.8  | **Linked external resources** (Google Drive, OneDrive, Dropbox file pickers).                                                                                      | MAJOR    | HE, K12     | MISSING |
| 8.9  | **Open Educational Resources (OER) library** — no built-in search of OER Commons, OpenStax, MERLOT. Differentiator for SL & cost-conscious districts.              | MAJOR    | K12, HE, SL | MISSING |
| 8.10 | **DRM / watermarking** for licensed publisher content — none.                                                                                                      | MINOR    | HE, K12     | MISSING |
| 8.11 | **MathML / equation editor** — no native equation authoring.                                                                                                       | MAJOR    | K12, HE     | MISSING |
| 8.12 | **Interactive H5P content** — no embed or rendering; common in OER.                                                                                                | MAJOR    | K12, HE, SL | MISSING |


---

## 9. Analytics, Reporting & Insights

`user_audit` tracks navigation events; admin reports surface aggregates (`[routes/reports.rs](server/src/routes/reports.rs)`). Almost no learner-facing or instructor-facing analytics exist.


| #    | Gap                                                                                                                                                        | Severity | Markets | Status  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- | ------- |
| 9.1  | **Per-student progress dashboard** — referenced in `[FEATURES.md](FEATURES.md)` §8. Required for any instructor-of-record relationship.                    | BLOCKER  | K12, HE | MISSING |
| 9.2  | **At-risk / early-warning alerts** — no model flagging students by engagement decline, missed work, or failing trajectory. Major adaptive-LMS expectation. | MAJOR    | K12, HE | MISSING |
| 9.3  | **Mastery / skill heatmap** per learner — depends on §1 (concept graph).                                                                                   | MAJOR    | All     | MISSING |
| 9.4  | **Item analysis** — per-question difficulty, discrimination, distractor analysis, test reliability (KR-20, Cronbach's α).                                  | MAJOR    | HE      | MISSING |
| 9.5  | **Course-level outcomes reporting** — no aggregated outcomes/standards mastery report.                                                                     | BLOCKER  | K12, HE | MISSING |
| 9.6  | **Caliper Analytics / xAPI emission** — no standards-based event stream for institutional warehouses.                                                      | MAJOR    | HE      | MISSING |
| 9.7  | **Engagement metrics** (time-on-task, login frequency, video watch %, page scroll depth).                                                                  | MAJOR    | All     | THIN    |
| 9.8  | **Export to PDF / scheduled email reports** — admin reports are screen-only, not exportable, not scheduled.                                                | MAJOR    | K12, HE | MISSING |
| 9.9  | **Learner self-reflection & study-skills coaching** dashboard.                                                                                             | MAJOR    | SL, HE  | MISSING |
| 9.10 | **Instructor "what's working" signals** — section-level vs. cohort comparison.                                                                             | MINOR    | HE      | MISSING |


---

## 10. Compliance, Privacy & Security

`[SECURITY.md](SECURITY.md)` catalogs the technical security audit. The compliance/regulatory layer is largely absent.


| #     | Gap                                                                                                                                                                                            | Severity | Markets                      | Status  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------- | ------- |
| 10.1  | **FERPA workflow** — no defined data-access roles for "school official with legitimate educational interest," no directory-info opt-out flag, no parent-record-access workflow for K-12.       | BLOCKER  | K12, HE                      | MISSING |
| 10.2  | **COPPA workflow** — no under-13 verifiable parental consent flow, no minor account flag, no data-minimization mode. Hard requirement for K-12 in US.                                          | BLOCKER  | K12                          | MISSING |
| 10.3  | **GDPR / UK GDPR** — no DSAR (data subject access request) export, no right-to-erasure tooling, no consent records, no DPA template.                                                           | BLOCKER  | HE (intl), SL                | MISSING |
| 10.4  | **CCPA/CPRA** — no "do not sell," no privacy-rights request handler.                                                                                                                           | MAJOR    | K12, HE, SL                  | MISSING |
| 10.5  | **Student Data Privacy Consortium / national-DPA template** — no signable DPA artifact for US districts.                                                                                       | MAJOR    | K12                          | MISSING |
| 10.6  | **State-specific** (California SOPIPA, NY Ed Law 2-d, Illinois SOPPA) student-data laws — no policy doc, no parent disclosure feed.                                                            | MAJOR    | K12                          | MISSING |
| 10.7  | **WCAG 2.1 / 2.2 AA conformance** — referenced in `[FEATURES.md](FEATURES.md)` §24. Section 508 (US Federal) and EN 301 549 (EU) tie to this. Procurement-blocking.                            | BLOCKER  | K12, HE                      | MISSING |
| 10.8  | **VPAT** — no published Voluntary Product Accessibility Template; required by US public-sector procurement.                                                                                    | BLOCKER  | K12, HE                      | MISSING |
| 10.9  | **SOC 2 Type II** — no audit, no policies, no evidence collection. Required by HE IT review.                                                                                                   | BLOCKER  | HE                           | MISSING |
| 10.10 | **ISO 27001 / 27701** — same procurement story for non-US institutions.                                                                                                                        | MAJOR    | HE (intl)                    | MISSING |
| 10.11 | **Audit log** — `user_audit` records navigation, not admin actions (role changes, grade overrides, data exports).                                                                              | BLOCKER  | K12, HE                      | THIN    |
| 10.12 | **Data residency** — no per-tenant region pinning; required for EU and state-mandated in-state hosting.                                                                                        | MAJOR    | K12 (some states), HE (intl) | MISSING |
| 10.13 | **Encryption at rest** — depends on infra; not codified or documented. Postgres TDE / disk encryption not configured in `[iac/](iac/)`.                                                        | MAJOR    | All                          | MISSING |
| 10.14 | **PII redaction in logs** — `tracing` output is unfiltered.                                                                                                                                    | MAJOR    | K12, HE                      | MISSING |
| 10.15 | **Backup / restore / RPO-RTO** — no documented backup policy, no automated snapshots in IaC, no tested restore.                                                                                | BLOCKER  | K12, HE                      | MISSING |
| 10.16 | **Bug bounty / responsible disclosure** policy — no `SECURITY.md` at repo root; only audit doc.                                                                                                | MINOR    | All                          | THIN    |
| 10.17 | **AI usage disclosure & data-use controls** — students/parents have no toggle for "do not send my work to LLMs"; no model-card disclosure of OpenRouter routing. Increasingly an RFP question. | BLOCKER  | K12, HE                      | MISSING |


---

## 11. Internationalization & Localization


| #    | Gap                                                                                                          | Severity | Markets                     | Status  |
| ---- | ------------------------------------------------------------------------------------------------------------ | -------- | --------------------------- | ------- |
| 11.1 | **i18n framework** — referenced in `[FEATURES.md](FEATURES.md)` §23. No `react-i18next` / ICU MessageFormat. | BLOCKER  | K12 (non-US), HE (intl), SL | MISSING |
| 11.2 | **RTL language support** — no logical-property CSS audit; Tailwind v4 RTL variants unused.                   | MAJOR    | HE, SL                      | MISSING |
| 11.3 | **Locale-aware dates, numbers, currency** — code uses naive formatters.                                      | MAJOR    | All                         | MISSING |
| 11.4 | **Time zones** — `available_from/until` and `due_at` semantics around tz unclear; no per-user tz setting.    | MAJOR    | All                         | THIN    |
| 11.5 | **Translation memory for course content** — no glossary, no per-course translation workflow.                 | MINOR    | HE, K12                     | MISSING |
| 11.6 | **Reading-level adaptation** for K-12 (Lexile, Flesch-Kincaid) — natural fit for AI rewriting; absent.       | MAJOR    | K12                         | MISSING |


---

## 12. Accessibility (WCAG 2.1 AA — most-cited LMS gap)

Beyond the umbrella item in §10:


| #     | Gap                                                                                                            | Severity | Markets | Status  |
| ----- | -------------------------------------------------------------------------------------------------------------- | -------- | ------- | ------- |
| 12.1  | **Screen-reader audit** of TipTap editor, gradebook grid, dnd-kit drag-drop, command palette — none performed. | BLOCKER  | K12, HE | MISSING |
| 12.2  | **Keyboard navigation** for module reorder, quiz-take, feed — partial / unverified.                            | BLOCKER  | K12, HE | THIN    |
| 12.3  | **Color-contrast compliance** — design tokens not validated against AA ratios.                                 | MAJOR    | All     | MISSING |
| 12.4  | **Captions on uploaded media** — see 8.4.                                                                      | BLOCKER  | K12, HE | MISSING |
| 12.5  | **Alt-text enforcement** in content authoring — no required field, no AI-suggested alt text.                   | MAJOR    | K12, HE | MISSING |
| 12.6  | **Dyslexia-friendly font, line spacing, reading ruler** — no learner-side display options.                     | MAJOR    | K12, SL | MISSING |
| 12.7  | **High-contrast / reduced-motion** — themes only support dark/light; no `prefers-reduced-motion` audit.        | MINOR    | K12, HE | THIN    |
| 12.8  | **Text-to-speech / read-aloud** — required accommodation in many K-12 IEPs.                                    | MAJOR    | K12     | MISSING |
| 12.9  | **Speech-to-text input** for student responses.                                                                | MAJOR    | K12, SL | MISSING |
| 12.10 | **Accommodations engine** tied to IEP/504 plans (extra time, alt format, separate setting) — see 2.11.         | BLOCKER  | K12     | MISSING |


---

## 13. K-12-Specific Gaps


| #     | Gap                                                                                                                  | Severity | Status  |
| ----- | -------------------------------------------------------------------------------------------------------------------- | -------- | ------- |
| 13.1  | **Parent portal** with multi-child view (see 5.10).                                                                  | BLOCKER  | MISSING |
| 13.2  | **Daily attendance** (per-period for secondary, daily for elementary), attendance reports, state-reportable formats. | BLOCKER  | MISSING |
| 13.3  | **Behavior / PBIS tracking** (positive/negative referrals, points).                                                  | MAJOR    | MISSING |
| 13.4  | **Report cards** — district-formatted grade reports, comments banks, narrative reporting.                            | BLOCKER  | MISSING |
| 13.5  | **Standards-based report cards** — see 3.7.                                                                          | BLOCKER  | MISSING |
| 13.6  | **Grade-level scoping** — no grade-level metadata on courses or content.                                             | MAJOR    | MISSING |
| 13.7  | **SIS integration** beyond Clever/OneRoster — PowerSchool, Infinite Campus, Skyward, Aeries direct connectors.       | MAJOR    | MISSING |
| 13.8  | **Library / book-club** features — no read-along, leveled reader integration.                                        | MINOR    | MISSING |
| 13.9  | **Hall pass / classroom-management** signals — increasingly bundled into K-12 LMSs.                                  | MINOR    | MISSING |
| 13.10 | **District-wide announcement & emergency-broadcast** channel.                                                        | MAJOR    | MISSING |
| 13.11 | **Age-appropriate UI mode** (K-2 vs. 3-5 vs. secondary).                                                             | MAJOR    | MISSING |
| 13.12 | **Parent-teacher conference scheduling**.                                                                            | MAJOR    | MISSING |
| 13.13 | **Free/reduced-lunch & demographic flags** with strict access controls (Title I reporting).                          | MAJOR    | MISSING |
| 13.14 | **Web-content filter integration** (GoGuardian, Securly) — typically expected in Chromebook districts.               | MINOR    | MISSING |


---

## 14. Higher-Education-Specific Gaps


| #     | Gap                                                                                                      | Severity | Status  |
| ----- | -------------------------------------------------------------------------------------------------------- | -------- | ------- |
| 14.1  | **SIS integration** — Banner, Workday Student, Colleague, Jenzabar, PeopleSoft. Roster + grade-passback. | BLOCKER  | MISSING |
| 14.2  | **Course catalog & registration** integration — read-only is fine; absent.                               | MAJOR    | MISSING |
| 14.3  | **Drop / add / withdrawal** lifecycle — enrollment state machine has no W/AU/I states.                   | MAJOR    | THIN    |
| 14.4  | **Incomplete grade workflow** with extension dates.                                                      | MAJOR    | MISSING |
| 14.5  | **Final grade roll-up to registrar** (CSV export at minimum).                                            | BLOCKER  | MISSING |
| 14.6  | **Academic-calendar awareness** (drop dates, finals week, no-class days).                                | MAJOR    | MISSING |
| 14.7  | **Course evaluations** (end-of-term feedback) with anonymity and reporting.                              | MAJOR    | MISSING |
| 14.8  | **Plagiarism workflow** — see 3.5.                                                                       | BLOCKER  | MISSING |
| 14.9  | **Proctoring** integration — Honorlock, Respondus, ProctorU, Examity (LTI 1.3 deep link).                | MAJOR    | MISSING |
| 14.10 | **Library / e-reserves** integration — Leganto, Alma, EZproxy.                                           | MAJOR    | MISSING |
| 14.11 | **Bookstore / textbook** linking — Inclusive Access, RedShelf, VitalSource.                              | MAJOR    | MISSING |
| 14.12 | **ePortfolio** / capstone artifact collection.                                                           | MAJOR    | MISSING |
| 14.13 | **Co-curricular transcript / CCR**.                                                                      | MINOR    | MISSING |
| 14.14 | **Advising & degree-planner** hooks (see `[ideas.md](ideas.md)`).                                        | MAJOR    | MISSING |
| 14.15 | **Research / IRB consent** flows for using student data in studies.                                      | MAJOR    | MISSING |
| 14.16 | **Accessibility-services intake** workflow.                                                              | MAJOR    | MISSING |
| 14.17 | **Continuing education (CEU) tracking** with seat-time logging.                                          | MAJOR    | MISSING |
| 14.18 | **Multi-campus / consortium** course sharing.                                                            | MINOR    | MISSING |


---

## 15. Self-Learner-Specific Gaps

The self-learner persona is closer to Coursera / Khan / Brilliant than to a school-driven LMS. Today nothing in the codebase recognizes "no instructor" as a first-class flow.


| #     | Gap                                                                                                                                                                          | Severity | Status  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- |
| 15.1  | **Public course catalog & search** with categories, levels, ratings — see `[FEATURES.md](FEATURES.md)` §14.                                                                  | BLOCKER  | MISSING |
| 15.2  | **Self-paced enrollment with no instructor** — every course currently presumes instructor presence; even adaptive quizzes require an enrollment to a "course" with an owner. | BLOCKER  | THIN    |
| 15.3  | **Subscription / one-time / freemium billing** — no Stripe / payment integration, no entitlement model, no coupons.                                                          | BLOCKER  | MISSING |
| 15.4  | **Course bundles / learning paths / specializations**.                                                                                                                       | MAJOR    | MISSING |
| 15.5  | **Certificates of completion** — see `[FEATURES.md](FEATURES.md)` §21. Verifiable credentials (Open Badges 3.0 / W3C VC) preferred.                                          | BLOCKER  | MISSING |
| 15.6  | **LinkedIn-share** / Open Badges export.                                                                                                                                     | MAJOR    | MISSING |
| 15.7  | **Reviews & ratings** of courses.                                                                                                                                            | MAJOR    | MISSING |
| 15.8  | **Affiliate / referral / instructor revenue share**.                                                                                                                         | MAJOR    | MISSING |
| 15.9  | **Streaks, XP, leaderboards, gamification** — none. Hard requirement for self-learner retention.                                                                             | MAJOR    | MISSING |
| 15.10 | **Daily-goal & study-reminder** scheduling.                                                                                                                                  | MAJOR    | MISSING |
| 15.11 | **Onboarding diagnostic** (see 1.7) and goal capture ("I want to learn calculus by July").                                                                                   | MAJOR    | MISSING |
| 15.12 | **AI study-buddy** / persistent tutor (see 6.9).                                                                                                                             | MAJOR    | MISSING |
| 15.13 | **Community Q&A / help forum** across courses.                                                                                                                               | MAJOR    | MISSING |
| 15.14 | **Author / creator portal** — instructors authoring for revenue need analytics, payouts, content versioning.                                                                 | MAJOR    | MISSING |
| 15.15 | **Discoverability / SEO** — no SSR/SSG, no sitemap, no JSON-LD course schema; SPA hidden behind login.                                                                       | BLOCKER  | MISSING |
| 15.16 | **Free trial / preview lessons** without account.                                                                                                                            | MAJOR    | MISSING |
| 15.17 | **Marketing site / landing pages** are absent from the repo.                                                                                                                 | MAJOR    | MISSING |


---

## 16. Integrations & Extensibility


| #     | Gap                                                                                                                                                                       | Severity | Markets | Status  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- | ------- |
| 16.1  | **Public REST/GraphQL API** with OpenAPI spec, versioning, rate limiting — see `[FEATURES.md](FEATURES.md)` §26.                                                          | MAJOR    | All     | MISSING |
| 16.2  | **Personal & institutional API tokens** with scopes.                                                                                                                      | MAJOR    | All     | MISSING |
| 16.3  | **Outbound webhooks** — see `[FEATURES.md](FEATURES.md)` §25.                                                                                                             | MAJOR    | All     | MISSING |
| 16.4  | **Inbound integrations**: Google Classroom (one-way sync), Google Workspace assignments, Microsoft Teams Education, Canva for Education, Edpuzzle, Khan Academy, Quizlet. | MAJOR    | K12, HE | MISSING |
| 16.5  | **Calendar feeds** — no iCal/CalDAV export of due dates.                                                                                                                  | MAJOR    | All     | MISSING |
| 16.6  | **Slack / Teams / Discord** classroom bots.                                                                                                                               | MINOR    | HE, SL  | MISSING |
| 16.7  | **AI provider abstraction** — locked to OpenRouter; no Anthropic-direct, OpenAI-direct, Bedrock, Vertex paths; no per-tenant key BYOK with audit.                         | MAJOR    | K12, HE | THIN    |
| 16.8  | **Payment provider abstraction** (Stripe + PayPal + iDEAL etc.) — see 15.3.                                                                                               | MAJOR    | SL      | MISSING |
| 16.9  | **Marketplace / plugin system** for third-party apps.                                                                                                                     | MINOR    | All     | MISSING |
| 16.10 | **Zapier / Make.com** connector.                                                                                                                                          | MINOR    | All     | MISSING |


---

## 17. Platform, Performance & Operability

The deployment story is a single DigitalOcean droplet running docker-compose (`[iac/demo/](iac/demo/)`).


| #     | Gap                                                                                                                                                               | Severity | Markets                         | Status  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------- | ------- |
| 17.1  | **Production IaC** — `iac/production/` is empty (`.gitkeep`).                                                                                                     | BLOCKER  | All                             | MISSING |
| 17.2  | **Horizontal scaling** — no load balancer, no stateless app guarantee, no shared session/cache (Redis).                                                           | BLOCKER  | K12, HE                         | MISSING |
| 17.3  | **Background job queue** — no Sidekiq-equivalent (Tokio + Postgres-LISTEN, or Redis/RabbitMQ). Email send, transcoding, AI grading, webhook delivery all need it. | BLOCKER  | All                             | MISSING |
| 17.4  | **Scheduled jobs / cron** — no scheduler for end-of-day grade-posting, late-status sweeps, cleanup.                                                               | MAJOR    | All                             | MISSING |
| 17.5  | **Caching layer** — no HTTP cache headers, no Redis, no CDN config.                                                                                               | MAJOR    | All                             | MISSING |
| 17.6  | **Rate limiting** — flagged in `[SECURITY.md](SECURITY.md)`.                                                                                                      | BLOCKER  | All                             | MISSING |
| 17.7  | **Observability** — `tracing` logs only; no metrics (Prometheus), no traces (OTel), no error reporting (Sentry/Honeybadger), no dashboards.                       | BLOCKER  | All                             | MISSING |
| 17.8  | **Health checks** — `/health/ready` exists but leaks errors and there's no liveness probe spec for orchestration.                                                 | MAJOR    | All                             | THIN    |
| 17.9  | **Blue/green / canary deploys** — single-droplet redeploy is downtime.                                                                                            | MAJOR    | All                             | MISSING |
| 17.10 | **Database migrations rollback** — `sqlx` migrations are forward-only; no documented down-migration strategy.                                                     | MAJOR    | All                             | MISSING |
| 17.11 | **Backup automation & restore drills** — see 10.15.                                                                                                               | BLOCKER  | All                             | MISSING |
| 17.12 | **Multi-region failover** — none.                                                                                                                                 | MAJOR    | HE (intl), K12 (state-mandated) | MISSING |
| 17.13 | **Status page** — none.                                                                                                                                           | MINOR    | All                             | MISSING |
| 17.14 | **Feature flags** — no progressive rollout system.                                                                                                                | MAJOR    | All                             | MISSING |
| 17.15 | **MongoDB usage** — wired in `docker-compose.yml` but unused in Rust server; either commit to it or remove.                                                       | MINOR    | All                             | THIN    |
| 17.16 | **Dependency / SBOM scanning** — no Dependabot, no `cargo-audit` in CI, no `npm audit`.                                                                           | MAJOR    | All                             | MISSING |
| 17.17 | **Secrets management** — env-only; no Vault, no AWS/GCP secret manager wiring.                                                                                    | MAJOR    | All                             | THIN    |
| 17.18 | **Test coverage** is enforced at 59% server-side; no E2E (Playwright) on the React app, no contract tests between client/server.                                  | MAJOR    | All                             | THIN    |
| 17.19 | **Load / chaos testing** — none.                                                                                                                                  | MAJOR    | HE, K12                         | MISSING |


---

## 18. Admin Experience


| #    | Gap                                                                                                                     | Severity | Markets | Status  |
| ---- | ----------------------------------------------------------------------------------------------------------------------- | -------- | ------- | ------- |
| 18.1 | **Admin console** — no central place for an org/district admin to manage users, courses, terms, integrations, branding. | BLOCKER  | K12, HE | MISSING |
| 18.2 | **Bulk user CSV import / merge** — none.                                                                                | BLOCKER  | K12, HE | MISSING |
| 18.3 | **Impersonation / "view as student"** — required for support; absent.                                                   | MAJOR    | K12, HE | MISSING |
| 18.4 | **Org-wide search / cross-course discovery** for admins — current search is user-scoped.                                | MAJOR    | K12, HE | THIN    |
| 18.5 | **Email template editor** with merge fields.                                                                            | MAJOR    | K12, HE | MISSING |
| 18.6 | **Outage / maintenance banner** controls.                                                                               | MINOR    | All     | MISSING |
| 18.7 | **Custom-fields / metadata** on user, course, enrollment for district-specific data.                                    | MAJOR    | K12, HE | MISSING |
| 18.8 | **License / seat management** — no concept of paid seats.                                                               | MAJOR    | All     | MISSING |


---

## 19. AI-Specific Capabilities (your differentiator surface)

Lextures already has more AI surface than incumbents (rubric gen, syllabus gen, adaptive quiz, RAG notebook). To credibly own "AI-native LMS":


| #     | Gap                                                                                                                                                      | Severity | Markets | Status  |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- | ------- |
| 19.1  | **Persistent AI tutor** that remembers a learner across sessions, citing course materials.                                                               | MAJOR    | All     | THIN    |
| 19.2  | **Auto-generated lesson plans, assessments, & differentiation** from a single learning objective.                                                        | MAJOR    | K12     | THIN    |
| 19.3  | **AI-assisted grading** of free-text & file submissions with rubric alignment + instructor approval queue.                                               | MAJOR    | K12, HE | MISSING |
| 19.4  | **AI-detected misconceptions** rolling up to the gradebook (see 1.10).                                                                                   | MAJOR    | All     | MISSING |
| 19.5  | **AI summarization & translation** of any content (lecture videos → notes; English → Spanish).                                                           | MAJOR    | K12, HE | MISSING |
| 19.6  | **Voice / video AI** — speech grading (oral exams, language learning), pronunciation feedback.                                                           | MAJOR    | K12, SL | MISSING |
| 19.7  | **Image / handwriting capture & grading** (math worked solutions photographed by phone).                                                                 | MAJOR    | K12     | MISSING |
| 19.8  | **Teacher copilot in the editor** — present in `[EditorWithPrompt](clients/web/src/components/editor)` but not exposed system-wide as a sidebar copilot. | MAJOR    | K12, HE | THIN    |
| 19.9  | **AI-content provenance** — sign all AI-generated artifacts so academic-integrity tools downstream can recognize them. Differentiator.                   | MAJOR    | HE      | MISSING |
| 19.10 | **Per-tenant model & prompt governance** — district admins approving which models/prompts run on student data.                                           | MAJOR    | K12, HE | THIN    |
| 19.11 | **PII redaction proxy** before any prompt leaves the system — no current safeguard. Privacy-team blocker.                                                | BLOCKER  | K12, HE | MISSING |
| 19.12 | **Citation enforcement** — RAG answers must always cite source material; current notebook has no enforced grounding.                                     | MAJOR    | K12, HE | THIN    |
| 19.13 | **Eval harness** for AI features (regression suite of prompts, golden answers, drift detection).                                                         | MAJOR    | All     | MISSING |
| 19.14 | **Cost & usage controls** (per-student token budgets, alerting, throttling).                                                                             | MAJOR    | K12, HE | MISSING |


---

## 20. Documentation & Trust Surfaces (sales/procurement enablers)


| #    | Gap                                                                                                                                                                          | Severity | Markets | Status  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- | ------- |
| 20.1 | **Public-facing privacy policy & terms** (the `[Privacy.tsx](clients/web/src/pages/)` and `[Terms.tsx](clients/web/src/pages/)` pages exist but are unverified for content). | BLOCKER  | All     | THIN    |
| 20.2 | **Trust center** (sub-processors list, security whitepaper, incident history).                                                                                               | MAJOR    | K12, HE | MISSING |
| 20.3 | **Help center / knowledge base / training videos**.                                                                                                                          | MAJOR    | All     | MISSING |
| 20.4 | **In-product onboarding tours** (Shepherd / Driver.js).                                                                                                                      | MAJOR    | All     | MISSING |
| 20.5 | **Public API reference** — see 16.1.                                                                                                                                         | MAJOR    | All     | MISSING |
| 20.6 | **Changelog / release notes** for end users.                                                                                                                                 | MINOR    | All     | MISSING |
| 20.7 | **Customer-success playbooks / district-rollout guide**.                                                                                                                     | MAJOR    | K12, HE | MISSING |


---

## Summary scoreboard


| Market                | Blocking gaps (count) | The 3 most disqualifying right now                                                                                                                                             |
| --------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **K-12 districts**    | ~30                   | (a) SSO + Clever/OneRoster rostering (4.1–4.4), (b) Parent portal + attendance + report cards (5.10, 13.2, 13.4), (c) FERPA/COPPA + WCAG/VPAT (10.1, 10.2, 10.7, 10.8)         |
| **Universities (HE)** | ~25                   | (a) SAML SSO + SIS integration (4.1, 14.1), (b) LTI 1.3 + plagiarism + proctoring (2.12, 3.5, 14.9), (c) SOC 2 + audit log + accessibility (10.9, 10.11, 10.7)                 |
| **Self-learners**     | ~15                   | (a) Public catalog + payments + certificates (15.1, 15.3, 15.5), (b) Native mobile + offline + push (7.1, 7.3, 6.3), (c) Gamification + AI tutor + diagnostic (15.9, 6.9, 1.7) |


Cross-market foundational gaps that unlock multiple segments at once:

1. **Tenancy/Org/Term/Section model** (§5.1–5.4) — required by K-12 and HE simultaneously.
2. **Concept graph & learner mastery model** (§1.1–1.2) — the only path to substantiating "truly adaptive."
3. **Background job queue + email + object storage + observability** (§17.3, 6.2, 8.1, 17.7) — production-readiness floor for any segment.
4. **SSO (SAML + OIDC + Clever/OneRoster)** (§4.1–4.4) — single largest sales-cycle blocker.
5. **Accessibility + VPAT + audit log** (§10.7, 10.8, 10.11) — public-sector procurement floor.

---

## Recommended sequencing (90-day view)

1. **Foundations (parallel-track):** Org/Term/Section model · Background jobs + email · Object storage · Observability · Audit log · Rate limits.
2. **Adaptive substrate:** concept graph, learner mastery state, IRT-lite difficulty calibration, mastery-aware recommendations.
3. **Identity & rostering:** OIDC (Google + Microsoft), SAML, Clever, OneRoster CSV. Open the K-12 pipeline.
4. **Assessment depth:** LTI 1.3 consumer, math input, time limits, accommodations, anonymous grading. Open the HE pipeline.
5. **Self-learner lane:** public catalog + Stripe + certificates + onboarding diagnostic + streaks. Open the SL pipeline.
6. **Compliance posture:** WCAG audit + VPAT + SOC 2 evidence collection + DSAR/erasure tooling. Unlocks procurement.

---

*Maintainer note:* keep this document and `[FEATURES.md](FEATURES.md)` in sync. `FEATURES.md` is the prioritized engineering backlog (P0–P3 with concrete work items); `MISSING_FEATURES.md` is the wider market-segmented gap analysis used for product/strategy discussions and RFP responses.