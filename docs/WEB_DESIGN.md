# Lextures — Web Design & UX Review

This document captures the current design and UX choices of the Lextures web client (React + Vite + Tailwind 4, in `clients/web/`), and lays out a **prioritized** list of improvements toward the goal of being the most user-friendly, intuitive, and clean LMS on the market.

Companion docs:

- [docs/design.md](design.md) — visual design system (tokens, palette, typography).
- [docs/MOBILE_DESIGN.md](MOBILE_DESIGN.md) — forward-looking mobile plan.

---

## 1. Current design choices

### 1.1 Visual language

- **Light-first** workspace on `#FFFFFF`; secondary surfaces in cool `#F8F9FA`. Dark mode is a parallel neutral palette, scoped via the `.lms-scope` class so pages don't have to ship per-color overrides.
- **Indigo** primary (`indigo-500/600`), **teal/emerald** for success, **amber** for warnings, **slate** for neutrals. Text stays on `slate-900` (not pure black) for softer contrast.
- **Soft depth**: thin `slate-200` borders, `shadow-sm`, `rounded-2xl` cards, `rounded-xl`+ on inputs/buttons — friendly but non-neumorphic.
- **Typography**: Plus Jakarta Sans, `tracking-tight` on page titles, muted `slate-500/600` for helper text.
- **Iconography**: Lucide line icons, consistent 5×5 sizing, `aria-hidden` on decorative usage.
- **Motion**: custom keyframes for side-nav entry (`0.28s cubic-bezier`) and canvas import chips, and `prefers-reduced-motion` is respected.

### 1.2 App shell

- Fixed **left side nav** (240px desktop; 88vw slide-in sheet on mobile with backdrop + Escape close) + **top bar** + scrollable main column ([app-shell.tsx](clients/web/src/components/layout/app-shell.tsx)).
- The side nav is **context-switching**: root/main → per-course → course-settings → user settings, each a separate `<nav>` cross-faded in place ([side-nav.tsx:89](clients/web/src/components/layout/side-nav.tsx:89)).
- **Top bar** holds the mobile menu toggle, a compact **breadcrumb** trail (course hierarchy, modules, and global pages), a Cmd/Ctrl+K search trigger, a "view-as" role switcher, and the account menu ([top-bar.tsx](clients/web/src/components/layout/top-bar.tsx), [top-bar-breadcrumbs.tsx](clients/web/src/components/layout/top-bar-breadcrumbs.tsx)).
- **Command palette** (Cmd/Ctrl+K) gives keyboard-first, grouped search across actions, courses, people, and pages ([command-palette](clients/web/src/components/command-palette)).

### 1.3 Information architecture

- Top-level: **Dashboard, Courses, Inbox, Calendar, Notebooks, Reports, Settings**.
- Per-course: **Dashboard, Feed, Syllabus, Modules, Grades (student) / Gradebook (teacher), Enrollments, Question Bank, Settings**. Items are feature-flagged via `CourseNavFeaturesProvider`.
- Mobile: the drawer mirrors desktop navigation 1:1 rather than re-architecting, which keeps parity but ignores mobile priorities (see §2).

### 1.4 Content & authoring UX

- **Modules** are a keyboard-accessible dnd-kit tree (arrow/space to move) with per-item visibility, settings, and due-date chips ([course-modules.tsx](clients/web/src/pages/lms/course-modules.tsx)).
- **Quizzes** use a drag-reorderable question list with an inline type dropdown, TipTap + KaTeX prompt editor, preview modal, and granular policies (time, lockdown, attempts, shuffle, partial credit) ([course-module-quiz-page.tsx](clients/web/src/pages/lms/course-module-quiz-page.tsx)).
- **Question bank** covers MC/MS, T/F, short answer, numeric, matching, ordering, hotspot, formula, code, file, audio/video; statuses are Draft → Active → Retired with version history restore.
- **Syllabus / content pages** use a block editor with markdown theme presets and live preview; images are uploaded to the course file store.

### 1.5 Data-heavy views

- **Gradebook** ([gradebook-grid.tsx](clients/web/src/pages/lms/gradebook/gradebook-grid.tsx)) is a sticky-header spreadsheet with frozen student column, in-cell numeric editing with undo/redo, sortable columns, rubric scoring modal, weighted groups, and a read-only mode. This is the most mature surface in the app.
- **Student grades** ([course-my-grades.tsx](clients/web/src/pages/lms/course-my-grades.tsx)) is a simple earned/max/percent list plus weighted final.

### 1.6 Communication

- **Inbox** is a full mail client with folders, search, compose, threading, smart date formatting, optimistic updates, and live sync via WebSocket + polling ([inbox.tsx](clients/web/src/pages/lms/inbox.tsx)).
- **Course feed** is a channel-based discussion with mentions, reactions, pins, edits, and markdown rendering that resolves course-file images ([course-feed-page.tsx](clients/web/src/pages/lms/course-feed-page.tsx)).

### 1.7 Platform concerns

- **Permissions-driven UI** with `usePermissions()`, `<RequirePermission>`, and permission gates in nav/buttons.
- **Error boundary** ([api-error-boundary.tsx](clients/web/src/components/api-error-boundary.tsx)) catches render errors with a retry action; inline errors use rose alert boxes with `role="alert"`.
- **Accessibility foundation**: ~628 ARIA attributes across the code, consistent `aria-hidden` on icons, keyboard handlers on modals and dnd lists, `sr-only` page titles when headers are hidden.
- **Dark mode** is neutral-toned in `.lms-scope` so dark surfaces aren't blue-tinted; `color-scheme` CSS is set.
- **Mobile responsiveness**: mobile-first Tailwind breakpoints, safe-area insets on the nav sheet, `touch-none` drag affordances.

---

## 2. Prioritized improvements

Ordered by **impact on user-friendliness / intuitiveness / perceived polish**, most valuable first. Each item notes the affected surface and what "done" looks like.

### P1 — High-value polish

5. **Quiz-taking focus mode.** When a student opens a timed/locked quiz, collapse the shell (hide side nav, replace top bar with a quiz-specific header showing timer, question X of Y, save state, flag-for-review). Reduces anxiety and accidental clicks. Lockdown mode should visually reinforce that the user is "in" the assessment.
6. **Gradebook polish.**
   - Sticky first-row totals (`Average`, `Median`) for each column.
   - Keyboard cell navigation (arrow keys, Enter, Tab like a spreadsheet) — currently only click-to-edit.
   - Bulk paste (Excel/Sheets rows) into a column.
   - Clearer submit/save indicator — today undo/redo is implicit.
   - Color scale per column (hot-cold) as an optional toggle.
7. **Course create → first-run wizard.** `course-create.tsx` is a bare title/description form. Replace with a 3-step wizard: basics → syllabus template → add first module. Provide 3–5 starter course templates (K-12 semester, higher-ed 15-week, self-paced, bootcamp, onboarding) so teachers don't start from a blank page.
8. **Settings restructure.** `course-settings.tsx` mixes dates, hero image, features, grading, outcomes, export/import, archive, enrollments. Split into sub-routes (`/courses/:code/settings/{general,grading,outcomes,features,import-export,archive}`) so each section has its own URL, scroll position, and save button. The side-nav-course-settings-links.tsx scaffolding is already there — just split the page.
9. **Modules tree density & iconography.** Distinguish item types (assignment/quiz/page/link) with a leading colored icon, due-date state (late/done/missing), and a progress indicator for students. The current list reads as a uniform stack.
10. **Feed & inbox unification of notifications.** Today unread counts live in two separate providers. Add a **Notifications drawer** from the top bar that merges feed mentions, inbox messages, graded assignments, and announcements into one reverse-chronological list, filterable by type.
11. **Breadcrumbed command palette results.** When a result is "Quiz: Midterm," show its parent course/module beneath. Cuts ambiguity on common names.

### P2 — Consistency & trust

12. **Toast system.** Replace ad-hoc inline success/error alerts with a single toast queue (top-right, auto-dismiss, stacks, `role="status"`). Consistent feedback after every mutation (save, delete, publish, grade).
13. **Destructive-action confirmation pattern.** Standardize a `<ConfirmDialog>` with typed confirmation for truly destructive ops (delete course, delete question with history, purge attempts). Today some destructive paths use native `confirm()` and some use bespoke modals.
14. **Accessibility parity sweep.** Gradebook and inbox are strong; question bank, course-create, and some settings forms lack explicit label-to-input associations, error-message IDs via `aria-describedby`, and focus management on modal open/close. Ship a lint rule (`jsx-a11y`) at `error` level for the LMS scope and fix regressions.
15. **Color-blind–safe status vocabulary.** Draft/Active/Retired, Published/Unpublished, Late/Missing, correct/incorrect all rely on hue today. Add a shape/icon or text suffix so hue isn't load-bearing.
16. **Unify date/time display.** Inbox does smart dates; modules use short dates; gradebook uses absolute timestamps. Adopt one helper (`formatRelative`, `formatAbsolute`, `formatRange`) and use it everywhere, with tooltips for the alternate form.
17. **Reduce chrome on read-heavy pages.** Syllabus, content pages, and student notebook views would benefit from a **reading width** (~72ch), larger body type, and an optional "focus" toggle that hides the side nav.
18. **Printable / exportable views.** Gradebook, student grade report, quiz review, and syllabus should have a clean print stylesheet (no nav, no controls, breakable tables). LMS users print and PDF constantly.

### P3 — Next-level intuitive

19. **Global fuzzy "go to"** in the command palette: typing a student name jumps to their gradebook row; typing a question ID opens it in the bank; typing a date opens calendar to that day.
20. **Inline, contextual help.** A small `?` next to each major feature area opens a right-docked help panel with a 20-second GIF, not a link to external docs.
21. **Onboarding for each role.** First login per role (student/teacher/admin) runs a 4-step coach-mark tour over real UI — not a modal wall.
22. **"Last saved" footprint.** Authoring surfaces (quiz, page, syllabus) should always display "Saved 2s ago" with a retry-on-failure pill instead of silent state.
23. **Undo surface at the app level.** A 10-second undo toast after destructive actions (delete module, delete question, archive course) — lowers anxiety and support volume.
24. **Theme density setting.** "Comfortable" vs. "Compact" in user settings for power users with large gradebooks.
25. **Presence indicators.** In feed and gradebook, show who else is viewing/editing via a small avatar stack — especially useful for co-teachers.
26. **Prefers-reduced-data mode.** For student mobile web on metered connections: defer hero images, lazy-load TipTap, skip math rendering until tapped.

---

## 3. Out-of-scope for this doc

- Server API shape, data modeling, and migrations.
- Native apps — see [docs/MOBILE_DESIGN.md](MOBILE_DESIGN.md).
- Individual feature specs — see [docs/plan/](plan/) per-feature markdown.

---

## 4. Definition of "user-friendly" for Lextures

We treat the following as the objective bar. A change is worth doing if it moves one of these meters:

- **Time-to-first-meaningful-click** on login (dashboard must answer "what do I do next?" in < 3 seconds).
- **Zero-dead-end rule**: every page has a clear primary action and a path back up the hierarchy.
- **Hue is never load-bearing** for state.
- **Every mutation acknowledges itself** with a toast or inline confirmation within 150ms.
- **Keyboard-only users can complete any student flow** (sign in → open quiz → submit).
- **Reading surfaces read like a document**, not a dashboard.
