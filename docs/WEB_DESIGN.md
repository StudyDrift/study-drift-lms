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
- **New course** is a three-step flow (basics → syllabus starter template or blank → optional first module) with five templates for common shapes ([course-create.tsx](clients/web/src/pages/lms/course-create.tsx)).
- Per-course: **Dashboard, Feed, Syllabus, Modules, Grades (student) / Gradebook (teacher), Enrollments, Question Bank, Settings**. Items are feature-flagged via `CourseNavFeaturesProvider`.
- Mobile: the drawer mirrors desktop navigation 1:1 rather than re-architecting, which keeps parity but ignores mobile priorities (see §2).

### 1.4 Content & authoring UX

- **Modules** are a keyboard-accessible dnd-kit tree (arrow/space to move) with per-item visibility, settings, and due-date chips ([course-modules.tsx](clients/web/src/pages/lms/course-modules.tsx)).
- **Quizzes** use a drag-reorderable question list with an inline type dropdown, TipTap + KaTeX prompt editor, preview modal, and granular policies (time, lockdown, attempts, shuffle, partial credit) ([course-module-quiz-page.tsx](clients/web/src/pages/lms/course-module-quiz-page.tsx)).
- **Question bank** covers MC/MS, T/F, short answer, numeric, matching, ordering, hotspot, formula, code, file, audio/video; statuses are Draft → Active → Retired with version history restore.
- **Syllabus / content pages** use a block editor with markdown theme presets and live preview; images are uploaded to the course file store.

### 1.5 Data-heavy views

- **Gradebook** ([gradebook-grid.tsx](clients/web/src/pages/lms/gradebook/gradebook-grid.tsx)) is a sticky-header spreadsheet with frozen student column, a sticky class average/median summary row under the headers, in-cell editing with keyboard navigation (arrows, Tab, Enter, Home/End), bulk paste from spreadsheets, optional per-column heat-map coloring, sortable columns, rubric scoring modal, weighted groups, and a read-only mode. The course page shows save/discard with a “last saved” timestamp. This is the most mature surface in the app.
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

### P3 — Next-level intuitive

16. **Global fuzzy "go to"** in the command palette: typing a student name jumps to their gradebook row; typing a question ID opens it in the bank; typing a date opens calendar to that day.
17. **Inline, contextual help.** A small `?` next to each major feature area opens a right-docked help panel with a 20-second GIF, not a link to external docs.
18. **Onboarding for each role.** First login per role (student/teacher/admin) runs a 4-step coach-mark tour over real UI — not a modal wall.
19. **"Last saved" footprint.** Authoring surfaces (quiz, page, syllabus) should always display "Saved 2s ago" with a retry-on-failure pill instead of silent state.
20. **Undo surface at the app level.** A 10-second undo toast after destructive actions (delete module, delete question, archive course) — lowers anxiety and support volume.
21. **Theme density setting.** "Comfortable" vs. "Compact" in user settings for power users with large gradebooks.
22. **Presence indicators.** In feed and gradebook, show who else is viewing/editing via a small avatar stack — especially useful for co-teachers.
23. **Prefers-reduced-data mode.** For student mobile web on metered connections: defer hero images, lazy-load TipTap, skip math rendering until tapped.

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
