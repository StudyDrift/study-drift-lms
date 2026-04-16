# Missing Features — Priority Backlog

This document tracks features that are absent or incomplete in Lextures, sorted by priority. Observations are based on a scan of the API routes, database models, React pages, and service layer as of April 2025.

---

## P0 — Blocking Core Flows

These gaps mean a basic LMS loop (create → assign → submit → grade) cannot be completed end-to-end today.

### 2. Student Grade View

Students have no page to see their own grades. There is no student-facing gradebook route or component.

- UI: `/courses/:code/my-grades` page showing earned vs. possible points per assignment and final course percent

### 3. Quiz Submission & Results

The adaptive-quiz endpoint (`POST .../quizzes/:id/adaptive-next`) exists, but there is no stored quiz attempt, no final score, and no results page for students or instructors.

- DB: `quiz_attempts`, `quiz_responses`
- API: `POST .../quizzes/:id/start`, `POST .../quizzes/:id/submit`, `GET .../quizzes/:id/results`
- UI: quiz-taking flow (one question at a time / full page), results summary, instructor response view

---

## P1 — High Value, Soon

### 4. Password Reset / Forgot Password

There is no forgot-password link, reset-token flow, or related API endpoint. Users who lose credentials have no self-service recovery path.

### 5. Course Announcements

Instructors need a lightweight "post to all students" channel distinct from the inbox. No announcement model, feed entry type, or UI panel exists.

- Could be layered onto the existing course feed (`064_course_feed.sql`) with an `announcement` event kind and a dedicated compose UI.

### 6. Discussion Boards

Asynchronous threaded discussion is a table-stakes LMS feature. No discussion model, route, or UI exists.

- DB: `discussion_threads`, `discussion_replies`
- UI: per-module and course-level discussion pages

### 7. Email Notifications

The inbox uses an internal WebSocket channel only. No outbound email is sent for new messages, upcoming due dates, grade posting, or announcements. Users miss critical events when offline.

- Requires an email backend (SMTP / transactional provider) and a notification-preferences model.

### 8. Late Submission Policy Enforcement

The `late_submission_policy` column exists on the assignment model and the value is stored/returned, but nothing reads it to apply deductions. The policy is silently ignored.

---

## P2 — Important, Medium Term

### 9. Student Progress / Completion Tracking

No record of which module items a student has viewed or completed. Instructors cannot see who is behind, and students have no progress indicator.

- DB: `module_item_completions`
- UI: progress bar on course home, per-student table in enrollments view

### 10. Rubrics

Assignments have points and groups but no structured rubric. Instructors cannot define criteria rows with point bands, and graders cannot attach rubric scores to a submission.

### 11. Group / Team Assignments

Enrollment groups exist but assignments cannot be scoped to a group. There is no group-submission model, no group-grade propagation, and no UI for assigning groups to an assignment.

### 12. Peer Review

No facility for routing one student's submission to another for structured feedback. Depends on assignment submissions (P0 above).

### 13. Bulk Grade Import / Export (CSV)

Instructors commonly maintain grades in a spreadsheet. No CSV import/export endpoint or UI exists for the gradebook.

### 14. OAuth / SSO Login

Only email + password signup is supported. No Google, Microsoft, or institutional SAML/OIDC login. Blocks adoption in organizations that mandate SSO.

### 15. Course Catalog / Public Discovery

Students must be manually enrolled. There is no browsable catalog, public course detail page, or self-enrollment from catalog flow.

### 16. Attendance Tracking

No attendance model, session recording, or attendance report. Common requirement for regulated programs.

### 17. File Storage Backend

Course files can be uploaded, but there is no reference to an object-storage backend (S3, R2, MinIO). Large file handling, CDN delivery, and per-course quotas are unaddressed.

---

## P3 — Lower Priority / Future

### 18. Video Conferencing Integration

No Zoom/Teams/Meet link embedding, meeting scheduling, or recording storage.

### 19. LTI Integration

No LTI 1.3 consumer or provider. Blocks use of third-party tools (publisher content, proctoring, e-portfolios) that rely on LTI.

### 20. Plagiarism Detection

No integration with Turnitin, Copyleaks, or similar. Depends on assignment submissions existing first.

### 21. Course Waitlist & Enrollment Capacity

No `max_enrollment` cap on courses, no waitlist queue, no automatic promotion from waitlist to enrolled.

### 22. Certificate / Transcript Generation

No completion certificate, PDF transcript, or credential export. Mentioned as a future area in `docs/ideas.md`.

### 23. Progressive Web App / Offline Mode

No service worker, no offline caching of course content, no install prompt. The app is desktop-web only.

### 24. Multi-language Support (i18n)

All UI strings are hardcoded in English. No i18n framework, locale files, or language selector.

### 25. Accessibility Audit (WCAG 2.1 AA)

No systematic accessibility coverage. TipTap editor, custom gradebook grid, and drag-and-drop reorder all need keyboard and screen-reader testing.

### 26. Webhooks / Event Streaming

No outbound webhook system for grade posted, enrollment created, submission received, etc. Blocks third-party integrations.

### 27. Public API Documentation

No OpenAPI spec, Swagger UI, or developer-facing docs. Limits self-service integration and contribution.

### 28. Admissions Module

Described in `docs/ideas.md` — application requests, student tracking. Not started.

### 29. Degree Audit / Graduation Planner

Described in `docs/ideas.md` — academic catalog, degree requirements, substitutions and waivers. Not started.

### 30. Financial Aid Module

Described in `docs/ideas.md`. Not started.

### 31. Custom Workflow Engine

Described in `docs/ideas.md` — approval chains, onboarding flows (React Flow or n8n). Not started.

---

## Already Implemented (Reference)

The following are **in scope and working** so they are excluded from the backlog above:

- Auth (JWT, signup, login, RBAC roles & permissions)
- Course creation, settings, archiving, catalog ordering
- Module structure (headings, content pages, external links) with drag/drop reorder
- Assignment settings (due date, availability window, points, submission types, access code, assignment groups)
- Assignment submissions (DB record, submit/list API, student submit UI, instructor inbox)
- Adaptive AI quiz generation and delivery
- Syllabus editor with AI section generation and student acceptance tracking
- Gradebook grid with instructor grade entry (`course_grades`, GET grid includes saved scores, PUT bulk save, save/discard UI), final-grade computation, and assignment group weighting
- Enrollment management with groups/sets
- Per-course and global calendars
- Internal inbox with drafts, starred, trash, and real-time WebSocket notifications
- Course feed
- Course file management (upload/list/delete)
- Student content annotations (markups on pages, assignments, quizzes, syllabus)
- AI avatar generation, notebook RAG, Canvas LMS course import
- Learning activity reports (admin)
- User audit log
- Global search
- Course export/import (JSON)
- Account profile (name, avatar, dark/light theme)
- OpenRouter AI model configuration and system prompt customization