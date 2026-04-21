# Lextures — Mobile Design & UX Plan

Lextures does not yet have a native mobile client. This document lays out the **design and UX direction** for the first-party mobile app (iOS + Android), the principles it should follow, and a **prioritized** list of what to build so it lands as the most intuitive, student-friendly LMS on a phone.

Related:

- [docs/plan/07-mobile-offline-cross-platform/7.1-native-mobile-apps.md](plan/07-mobile-offline-cross-platform/7.1-native-mobile-apps.md) — engineering plan for the native apps.
- [docs/plan/07-mobile-offline-cross-platform/7.2-mobile-responsive-review.md](plan/07-mobile-offline-cross-platform/7.2-mobile-responsive-review.md) — responsive-web prerequisite work.
- [docs/design.md](design.md) — visual system source of truth.

---

## 1. Positioning

Mobile is **not a second-class port of the web app**. Students are mobile-first (K-12 phones, self-learners on commutes); the web app is authoring- and admin-first. The mobile app should be **the best way to learn and the best way to stay on top of a class**, not the best way to build one.

Three sentences to steer every design decision:

1. A student should be able to **know what to do next** within **5 seconds** of opening the app.
2. Anything that appears on mobile must work **one-handed**, with the **thumb** reaching it.
3. The app must be **useful offline**; flaky campus Wi-Fi is the norm, not the exception.

---

## 2. Target personas & primary flows

Ordered by frequency of open:

1. **K-12 student** — checks assignments due, opens a quiz, reads an announcement, submits a photo of handwritten work.
2. **Self-learner** — resumes the next lesson on commute, plays an audio/video snippet, takes a short quiz.
3. **Higher-ed student** — checks grades, reads a syllabus, submits an upload, messages an instructor.
4. **Parent (read-only follower)** — sees child's progress, upcoming work, and recent grades.
5. **Instructor (secondary, not primary)** — triages inbox, approves late work, posts an announcement, spot-checks gradebook. No authoring on mobile in v1.

### Top 10 jobs-to-be-done on mobile (v1)

1. See what's due today/this week.
2. Open and take a quiz (including timed).
3. Read a module/content page with math and images.
4. Submit an assignment (photo, file upload, short text).
5. Check my grade in a course.
6. Read and reply to an inbox message.
7. Read and post to the course feed.
8. Get a push when grades post or an announcement drops.
9. Continue where I left off.
10. Work briefly offline, then sync.

Everything else is a stretch for v2+.

---

## 3. Architecture approach

Hybrid-first (Capacitor or React Native WebView bridge) per [7.1](plan/07-mobile-offline-cross-platform/7.1-native-mobile-apps.md), with **native shells** for:

- Authentication (biometric unlock, secure keychain token storage).
- Push notifications (APNs / FCM).
- Camera / files / document scanner (assignment uploads).
- Offline content cache (content pages, last-opened quiz attempt draft).
- App-shell chrome (tab bar, pull-to-refresh, haptics, safe areas, status-bar tint).

The content surfaces (quiz runner, content pages, inbox, feed) render via shared web views **purpose-built for narrow viewports** — not the desktop SPA in a WebView. We do **not** ship the authoring surfaces (modules editor, gradebook, question bank) to mobile v1.

---

## 4. Design language on mobile

Carry over Lextures tokens from [design.md](design.md), with mobile-specific adjustments:

- **One-column layout**. No side nav; a **bottom tab bar** (5 slots): Home, Courses, Inbox, Calendar, Me.
- **Large tap targets** — minimum 44×44 pt, comfortable 48×48 for primary actions.
- **System fonts first** (SF Pro on iOS, Roboto on Android) with Plus Jakarta Sans as an opt-in brand font for marketing/landing screens. On-device fonts are faster and honor user accessibility scaling.
- **Respect Dynamic Type / font scale up to 200%** — no fixed heights on text containers.
- **Full dark mode** driven by system preference, with a manual override in Me → Appearance.
- **Indigo accent** only for primary actions and selection states; not decorative backgrounds.
- **Radius**: `16` on cards, `12` on inputs, `9999` on pill chips. Elevation via `shadow` on iOS, `elevation: 2` on Android, not heavy.
- **Motion**: follow platform norms (iOS spring push, Android fade-through). Respect Reduce Motion by disabling all transitions except opacity.
- **Haptics**: light tap on tab switch, medium on submit/save, error haptic on validation failure — iOS only; Android falls back to short vibration.

### 4.1 Chrome

- **Top app bar**: single-line title, back chevron (or close X on modal flows), one trailing action max. Never two rows of controls.
- **Bottom tab bar**: 5 tabs, Lucide-equivalent line icons, labeled, with an **unread dot** (not a count) except on Inbox/Feed where a count adds value.
- **Floating primary action** only on Courses (add course for teachers) — no FAB elsewhere; it creates ambiguity.
- **Pull-to-refresh** everywhere that shows a list.
- **Bottom sheets** for filters, picker, compose actions — modals only for full-screen flows (quiz, submission, reader).

### 4.2 Reading surfaces

- Default **body size 17pt**, line-height 1.45, measure capped at ~70 characters via horizontal padding.
- Math (KaTeX) must be **pinch-zoomable** and render at source resolution; long equations should horizontal-scroll rather than overflow or shrink.
- Images open to a **lightbox** with pinch, pan, and save-to-device.
- Code blocks use a **horizontal scroll container** with a small "copy" button, never word-wrap.
- A **Reading Mode** toggle hides the app bar on scroll down, reveals on scroll up.

### 4.3 Forms & input

- Native pickers (date/time, dropdown) wherever possible.
- **Inline validation** on blur, not on keypress; error text sits immediately under the field with a color + icon.
- Multi-step flows use a **progress bar in the app bar**, not a separate header block.
- The **keyboard never covers the active input**; scroll the field into view with 16pt margin.

### 4.4 Accessibility

- Full **VoiceOver / TalkBack** labels on every interactive element.
- **Minimum 4.5:1 contrast** for body, 3:1 for large text — and we check dark mode separately.
- **Reduce Motion**, **Reduce Transparency**, **Bold Text**, **Larger Text** all honored.
- **One-handed reach**: primary actions in the lower half of the screen; destructive actions require a bottom-sheet confirm, never a top-bar button.
- **Color is never load-bearing**: status chips always pair a color with an icon or word.

---

## 5. Screen inventory (v1)

### Home
Greeting, **"Due this week"** list grouped by day, **Continue** card (last-opened item), announcements carousel, grade summary chip per active course. A single tap on any due item opens it directly (no drill-down).

### Courses
Card list of enrolled/taught courses (hero image, status chip, unread dot). Tapping opens a **course tab shell** with its own bottom segmented control: Modules, Grades, Feed, People, Info. No nested side nav.

### Module reader
Linear next/previous at the bottom, progress dots at the top, auto-scroll-to-last-read. Quizzes and assignments appear inline with their state (Not started / In progress / Submitted / Graded).

### Quiz runner (full-screen modal)
Persistent timer pill (if timed), question counter, flag-for-review toggle, bottom "Next" CTA. Single-question-per-screen by default; horizontal swipe disabled to prevent accidental skip. End-of-quiz review list with status icons per question. Auto-save on every answer.

### Submission flow
"Take photo / Choose file / Record audio / Record video / Write". Camera opens with a **document-scanner** mode (edge detection, multi-page, auto-crop to B&W). Uploads show a clear queue with per-file progress and a retry button.

### Inbox
Folder chip row (Inbox / Starred / Sent), threaded list, swipe-left to archive, swipe-right to star, long-press for multi-select. Compose is a full-screen sheet with mention auto-complete.

### Feed
Channel picker in the app bar, message list with threaded replies, emoji reactions on long-press. Image attachments go through the same document-scanner/camera sheet as submissions.

### Calendar
Month view with dot markers, tap a day to see a sheet of events, toggle to agenda view.

### Me
Profile header, streak/progress if self-learner, Appearance (light/dark/system, density), Notifications, Accessibility, Sign out, About. Hidden "Instructor tools" section if the account has a teacher role (unlocks the minimal mobile instructor surfaces listed in §7).

---

## 6. Offline behavior

Per [7.3 offline-pwa](plan/07-mobile-offline-cross-platform/7.3-offline-pwa.md):

- **Always cached**: last-opened module, syllabus, current quiz attempt draft, last 30 days of inbox, last 14 days of feed per subscribed channel.
- **Queue-and-send**: submitting an assignment, posting a feed message, replying to inbox — all queued locally with a visible "Pending" chip and a retry on connectivity restore.
- **Read-only chip** appears in the app bar when offline; destructive actions disabled.
- **Sync conflicts** on a long-running quiz attempt: server wins for grading, client keeps a local copy of the user's answers for recovery.

---

## 7. Instructor mobile (v1.5, not v1)

Not a priority for launch, but the design should allow it without a rewrite. Minimum viable instructor surface:

- Post an announcement to a course (text + image).
- Reply to inbox threads.
- Approve/reject a late-submission request.
- See a read-only gradebook summary (averages per assignment) — **no editing**.
- Confirm "needs grading" counts and open the web app with a deep link for actual grading.

Authoring (modules, quizzes, question bank, gradebook editing) stays web-only indefinitely; phones are not the right form factor.

---

## 8. Prioritized build list

Ordered by impact on making Lextures mobile **intuitive and useful** first, and **complete** second.

### P0 — Must ship in v1 (the reason the app exists)

1. **Auth + biometric unlock**. SSO via the existing web OAuth, keychain-stored refresh token, Face ID / fingerprint to unlock on return.
2. **Home dashboard**: due this week, continue, announcements, per-course grade chip. This is the single screen that justifies a download.
3. **Course tab shell**: Modules / Grades / Feed / People / Info. Deep links from push notifications land directly here.
4. **Module reader with math, images, code, and audio/video**. Offline cache of the last-opened item.
5. **Quiz runner**: timed, auto-save, flag-for-review, end-of-quiz summary, result screen. Covers MC/MS, T/F, short answer, numeric, ordering, and matching. File/audio/video question types can wait for v1.1.
6. **Assignment submission** with document scanner, multi-file upload queue, and offline queueing.
7. **Inbox**: read, reply, compose, swipe actions. Full parity with web for reading and replying.
8. **Push notifications** for: grade posted, new announcement, new inbox message, assignment-due-soon (24h / 1h). APNs + FCM. Deep link to the right surface.
9. **Offline mode** basics (item cache, submission queue, "offline" chip).
10. **Accessibility**: VoiceOver/TalkBack labels, Dynamic Type, Reduce Motion — shipped at launch, not retrofitted.

### P1 — Ships in the first 2–3 point releases

11. **Feed read + post + react**.
12. **Calendar month + agenda**.
13. **Continue streak / goals** for self-learners (small, opt-in; do not gamify into anxiety).
14. **Download for offline** on any module item (explicit, with a download chip).
15. **Widgets**: iOS home-screen "Due today" widget; Android equivalent.
16. **Live Activity / ongoing notification** during a timed quiz so students can tab out without panic.
17. **Text size & density settings** in Me → Appearance.
18. **Parent-follower read-only mode** (separate entry point on the login screen).
19. **Reader mode improvements**: pinch zoom for math, horizontal scroll for long equations, copy-button on code.
20. **Language & locale**: match web supported locales; right-to-left support verified (not an afterthought).

### P2 — Polish & power

21. **Search across courses** from the Home bar; same grouping model as the desktop command palette.
22. **Instructor v1.5**: announcements, inbox, late-request approvals, read-only gradebook.
23. **In-app video** with offline download, variable-speed playback, captions, and position resume.
24. **Audio-only mode** for content pages (TTS through the accessibility framework) — brilliant for commutes.
25. **Study timer / focus mode** with Do-Not-Disturb integration during timed quizzes.
26. **Shared-device mode** for K-12 carts: quick account switch, auto-sign-out, no biometric.
27. **MDM support** (Apple School Manager, Google Play EMM) per [7.4](plan/07-mobile-offline-cross-platform/7.4-app-store-presence.md).
28. **Haptic feedback** passes on all primary flows (submit, correct/incorrect feedback if configured, nav transitions).
29. **Crash + performance telemetry** (opt-out respected) to keep the app fast on low-end Android.
30. **App Clip / Instant App** for a guest-preview of a shared content page.

---

## 9. What we explicitly do NOT build for mobile

- Full quiz authoring.
- Question bank management.
- Gradebook editing, rubric scoring, and grade export.
- Course creation and settings (beyond cosmetic: image, description).
- Admin-panel surfaces (org, SSO, SCIM, roles).
- Analytics dashboards with dense tables.
- Virtual classroom / video calling.

Each of these either needs a keyboard, a wide viewport, or dense tabular interaction that phones punish. Tablet layouts may revisit some of these in a later phase.

---

## 10. Definition of "intuitive" for Lextures mobile

A mobile change is worth doing if it moves one of these:

- **Open-to-action time**: under 5 seconds from cold launch to a useful tap.
- **Thumb-only usability**: every core flow completable with the device in one hand.
- **Offline reliability**: no destructive failure when Wi-Fi drops mid-submit.
- **Notification trust**: every push deep-links to the exact item, or we don't send it.
- **Accessibility at parity**: all launch flows pass an Accessibility Inspector / Accessibility Scanner audit.
- **No desktop-shaped UI**: if a control would be at home on a 1280px canvas but not a 390pt one, it does not ship to mobile.
