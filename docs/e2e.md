# End-to-End Test Checklist

This file tracks all features covered (or to be covered) by the Playwright e2e test suite in `e2e/`.

Each item maps to one or more test cases. Check it off (`[x]`) once a test is written and passing.
Items marked `[-]` are skipped — the feature exists in the UI but requires UI interactions or
backend capabilities not yet automatable in the current test infrastructure.

---

## Authentication

- [x] Sign up with email and password → redirected to dashboard
- [x] Log in with valid credentials → redirected to dashboard
- [x] Log in with wrong password → error message shown
- [x] Redirect to `/login` when visiting protected route unauthenticated
- [x] Log out → session cleared, redirected to `/login`
- [x] Forgot password → request email form shown
- [ ] Reset password via token → new password accepted, can log in

---

## Dashboard

- [x] Dashboard loads after login with "My Courses" section visible
- [x] Empty-state shown when user has no enrollments
- [ ] Recently visited course item shown after visiting a module item

---

## Courses List (`/courses`)

- [x] Courses list page loads
- [x] "New Course" button visible to instructor/admin, hidden to student
- [x] Course card shows title, status badge, and last-edited date

---

## Create Course (`/courses/create`)

- [x] Create a blank course → redirected to course detail
- [-] Create a course from a template → syllabus and modules pre-populated
- [x] Validation: empty title shows an error

---

## Course Detail (`/courses/:code`)

- [x] Course detail page loads with hero image area and basic info
- [x] Published/draft badge visible
- [x] Edit course title and description (instructor)

---

## Course Settings (`/courses/:code/settings`)

- [x] Settings page loads
- [x] General settings tab: update title and description saves successfully
- [x] General settings tab: toggle published status
- [x] General settings tab: toggle schedule mode
- [x] General settings tab: change reading theme preset
- [x] Archive course (delete)
- [ ] Grading tab: change grading scheme
- [ ] Enrollments tab: access from settings

---

## Course Modules (`/courses/:code/modules`)

- [x] Modules list page loads
- [x] Create a new module → appears in list
- [-] Reorder modules via drag-and-drop
- [x] Collapse/expand module section (action buttons visible)
- [-] Archive a module → disappears from active list (archive menu not reliably accessible without hover)
- [ ] Delete a module → removed permanently

---

## Course Content Items

- [ ] Add a content page to a module → item appears in list
- [ ] View content page as student
- [ ] Edit content page rich text (instructor) → saved
- [ ] Add external link item → visible in module
- [ ] View external link item page

---

## Assignments

- [ ] View assignment detail page as student
- [ ] Submit a text assignment as student
- [ ] Assignment submission shows confirmation
- [ ] Grade a submission as instructor → score saved
- [ ] Re-grade updates displayed score

---

## Quizzes

- [ ] View quiz introduction page as student
- [ ] Take a quiz and submit answers
- [ ] Auto-graded quiz shows score after submission
- [ ] View correct/incorrect answers after submission (if permitted)
- [ ] Instructor can view all quiz attempts

---

## Gradebook (`/courses/:code/gradebook`)

- [x] Gradebook grid loads with student rows and assignment columns
- [-] Score cell shows entered grade (requires published assignments)
- [-] Filter by student name narrows rows (requires populated gradebook)

---

## My Grades (`/courses/:code/my-grades`)

- [x] My Grades page loads for enrolled student
- [x] Shows assignment scores and overall grade

---

## Syllabus (`/courses/:code/syllabus`)

- [x] Syllabus page loads with sections
- [-] Instructor can edit a syllabus section (no editable area without pre-existing content)
- [x] Student sees "Accept Syllabus" overlay on first visit
- [x] Accepted syllabus no longer shows overlay

---

## Course Feed (`/courses/:code/feed`)

- [x] Feed channel list loads
- [-] Post a message to the general channel (TipTap editor not reliably fillable via `fill`)
- [-] Message appears in feed without page refresh

---

## Discussion Forums (`/courses/:code/discussions`)

- [x] Discussions list page loads
- [x] Create a new discussion forum (via API + verify in UI)
- [-] Create a forum via UI → forum appears in list (no "New forum" button visible for instructor)
- [-] Post a reply to a discussion thread → reply appears (TipTap reply editor not fillable via `fill`)
- [-] Reply appears under parent post

---

## Course Enrollments (`/courses/:code/enrollments`)

- [x] Enrollments page loads with current members
- [x] Invite a user by email → pending enrollment appears
- [-] Change enrollment role via dropdown (role select hidden for non-course-creator teacher role)
- [x] Remove an enrollment → user disappears from list

---

## Course Calendar (`/courses/:code/calendar`)

- [x] Calendar page loads with current month view
- [ ] Assignment due dates appear on calendar

---

## Global Calendar (`/calendar`)

- [x] Global calendar loads
- [ ] Events from enrolled courses appear

---

## Question Bank (`/courses/:code/questions`)

- [x] Question bank page loads
- [x] Search filters visible and functional

---

## Notebook (`/courses/:code/notebook`)

- [x] Notebook page loads for enrolled student
- [ ] Add a note entry

---

## Inbox (`/inbox`)

- [x] Inbox page loads
- [ ] Unread count badge visible in nav when messages exist

---

## Reports (`/reports`)

- [x] Reports page loads for instructor/admin

---

## Settings (`/settings/account`)

- [x] Account settings page loads
- [-] Update display name → saved successfully (display name field not found on account page)
- [x] Change UI theme (light/dark) → preference persists after reload

---

## Admin

- [x] Admin accommodations page loads (`/admin/accommodations`)
- [ ] Platform settings tab visible to global admin only

---

## Navigation

- [x] Sidebar navigation visible after login
- [x] Clicking "Courses" nav item navigates to `/courses`
- [x] Clicking "Inbox" nav item navigates to `/inbox`
- [x] Breadcrumb shows correct course title inside course pages
