# Missing Features — Priority Backlog

This document tracks features that are absent or incomplete in Lextures, sorted by priority. Observations are based on a scan of the API routes, database models, React pages, and service layer as of April 2025.

---

## P0 — Blocking Core Flows

These gaps mean a basic LMS loop (create → assign → submit → grade) cannot be completed end-to-end today.

### 1. Assignment Submission System
The assignment model fully defines *what* students can submit (text, file upload, URL, access code), but no submission record, submission endpoint, or student-facing submit UI exists. Instructors also have no way to view submitted work.
- DB: `assignment_submissions` table
- API: `POST /courses/:code/assignments/:id/submissions`, `GET` (list for instructor, get own for student)
- UI: student submit form on `CourseModuleAssignmentPage`, instructor submission inbox

### 2. Gradebook Grade Entry
The gradebook grid loads with `initialGrades` always set to empty — there is no endpoint to read or write individual student grades, and no cell-edit-and-save flow. The grid is display-only.
- DB: `course_grades` (student × assignment points earned)
- API: `PUT /courses/:code/gradebook/grades` (bulk upsert), `GET` (populated grid)
- UI: editable cells in `GradebookGrid`, save/discard controls

### 3. Student Grade View
Students have no page to see their own grades. Even if grade entry existed today, there is no student-facing gradebook route or component.
- UI: `/courses/:code/my-grades` page showing earned vs. possible points per assignment and final course percent

### 4. Quiz Submission & Results
The adaptive-quiz endpoint (`POST .../quizzes/:id/adaptive-next`) exists, but there is no stored quiz attempt, no final score, and no results page for students or instructors.
- DB: `quiz_attempts`, `quiz_responses`
- API: `POST .../quizzes/:id/start`, `POST .../quizzes/:id/submit`, `GET .../quizzes/:id/results`
- UI: quiz-taking flow (one question at a time / full page), results summary, instructor response view

---

## P1 — High Value, Soon

### 5. Password Reset / Forgot Password
There is no forgot-password link, reset-token flow, or related API endpoint. Users who lose credentials have no self-service recovery path.

### 6. Course Announcements
Instructors need a lightweight "post to all students" channel distinct from the inbox. No announcement model, feed entry type, or UI panel exists.
- Could be layered onto the existing course feed (`064_course_feed.sql`) with an `announcement` event kind and a dedicated compose UI.

### 7. Discussion Boards
Asynchronous threaded discussion is a table-stakes LMS feature. No discussion model, route, or UI exists.
- DB: `discussion_threads`, `discussion_replies`
- UI: per-module and course-level discussion pages

### 8. Email Notifications
The inbox uses an internal WebSocket channel only. No outbound email is sent for new messages, upcoming due dates, grade posting, or announcements. Users miss critical events when offline.
- Requires an email backend (SMTP / transactional provider) and a notification-preferences model.

### 9. Late Submission Policy Enforcement
The `late_submission_policy` column exists on the assignment model and the value is stored/returned, but nothing reads it to apply deductions. The policy is silently ignored.

---

## P2 — Important, Medium Term

### 10. Student Progress / Completion Tracking
No record of which module items a student has viewed or completed. Instructors cannot see who is behind, and students have no progress indicator.
- DB: `module_item_completions`
- UI: progress bar on course home, per-student table in enrollments view

### 11. Rubrics
Assignments have points and groups but no structured rubric. Instructors cannot define criteria rows with point bands, and graders cannot attach rubric scores to a submission.

### 12. Group / Team Assignments
Enrollment groups exist but assignments cannot be scoped to a group. There is no group-submission model, no group-grade propagation, and no UI for assigning groups to an assignment.

### 13. Peer Review
No facility for routing one student's submission to another for structured feedback. Depends on assignment submissions (P0 above).

### 14. Bulk Grade Import / Export (CSV)
Instructors commonly maintain grades in a spreadsheet. No CSV import/export endpoint or UI exists for the gradebook.

### 15. OAuth / SSO Login
Only email + password signup is supported. No Google, Microsoft, or institutional SAML/OIDC login. Blocks adoption in organizations that mandate SSO.

### 16. Course Catalog / Public Discovery
Students must be manually enrolled. There is no browsable catalog, public course detail page, or self-enrollment from catalog flow.

### 17. Attendance Tracking
No attendance model, session recording, or attendance report. Common requirement for regulated programs.

### 18. File Storage Backend
Course files can be uploaded, but there is no reference to an object-storage backend (S3, R2, MinIO). Large file handling, CDN delivery, and per-course quotas are unaddressed.

---

## P3 — Lower Priority / Future

### 19. Video Conferencing Integration
No Zoom/Teams/Meet link embedding, meeting scheduling, or recording storage.

### 20. LTI Integration
No LTI 1.3 consumer or provider. Blocks use of third-party tools (publisher content, proctoring, e-portfolios) that rely on LTI.

### 21. Plagiarism Detection
No integration with Turnitin, Copyleaks, or similar. Depends on assignment submissions existing first.

### 22. Course Waitlist & Enrollment Capacity
No `max_enrollment` cap on courses, no waitlist queue, no automatic promotion from waitlist to enrolled.

### 23. Certificate / Transcript Generation
No completion certificate, PDF transcript, or credential export. Mentioned as a future area in `docs/ideas.md`.

### 24. Progressive Web App / Offline Mode
No service worker, no offline caching of course content, no install prompt. The app is desktop-web only.

### 25. Multi-language Support (i18n)
All UI strings are hardcoded in English. No i18n framework, locale files, or language selector.

### 26. Accessibility Audit (WCAG 2.1 AA)
No systematic accessibility coverage. TipTap editor, custom gradebook grid, and drag-and-drop reorder all need keyboard and screen-reader testing.

### 27. Webhooks / Event Streaming
No outbound webhook system for grade posted, enrollment created, submission received, etc. Blocks third-party integrations.

### 28. Public API Documentation
No OpenAPI spec, Swagger UI, or developer-facing docs. Limits self-service integration and contribution.

### 29. Admissions Module
Described in `docs/ideas.md` — application requests, student tracking. Not started.

### 30. Degree Audit / Graduation Planner
Described in `docs/ideas.md` — academic catalog, degree requirements, substitutions and waivers. Not started.

### 31. Financial Aid Module
Described in `docs/ideas.md`. Not started.

### 32. Custom Workflow Engine
Described in `docs/ideas.md` — approval chains, onboarding flows (React Flow or n8n). Not started.

---

## Already Implemented (Reference)

The following are **in scope and working** so they are excluded from the backlog above:

- Auth (JWT, signup, login, RBAC roles & permissions)
- Course creation, settings, archiving, catalog ordering
- Module structure (headings, content pages, external links) with drag/drop reorder
- Assignment settings (due date, availability window, points, submission types, access code, assignment groups)
- Adaptive AI quiz generation and delivery
- Syllabus editor with AI section generation and student acceptance tracking
- Gradebook view grid with final-grade computation and assignment group weighting
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
