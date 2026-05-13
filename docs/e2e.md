# End-to-End Test Checklist

This file tracks all features covered (or to be covered) by the Playwright e2e test suite in `e2e/`.

Each item maps to one or more test cases. Check it off (`[x]`) once a test is written and passing.

---

## Authentication

- [x] Sign up with email and password → redirected to dashboard
- [x] Log in with valid credentials → redirected to dashboard
- [x] Log in with wrong password → error message shown
- [x] Redirect to `/login` when visiting protected route unauthenticated
- [x] Log out → session cleared, redirected to `/login`
- [ ] Forgot password → request email form shown
- [ ] Reset password via token → new password accepted, can log in

---

## Dashboard

- [ ] Dashboard loads after login with "My Courses" section visible
- [ ] Empty-state shown when user has no enrollments
- [ ] Recently visited course item shown after visiting a module item

---

## Courses List (`/courses`)

- [ ] Courses list page loads
- [ ] "New Course" button visible to instructor/admin, hidden to student
- [ ] Course card shows title, status badge, and last-edited date

---

## Create Course (`/courses/create`)

- [ ] Create a blank course → redirected to course detail
- [ ] Create a course from a template → syllabus and modules pre-populated
- [ ] Validation: empty title shows an error

---

## Course Detail (`/courses/:code`)

- [ ] Course detail page loads with hero image area and basic info
- [ ] Published/draft badge visible
- [ ] Edit course title and description (instructor)

---

## Course Settings (`/courses/:code/settings`)

- [ ] Settings page loads
- [ ] General settings tab: update title saves successfully
- [ ] Grading tab: change grading scheme
- [ ] Enrollments tab: access from settings

---

## Course Modules (`/courses/:code/modules`)

- [ ] Modules list page loads
- [ ] Create a new module → appears in list
- [ ] Reorder modules via drag-and-drop
- [ ] Collapse/expand module section
- [ ] Archive a module → disappears from active list
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

- [ ] Gradebook grid loads with student rows and assignment columns
- [ ] Score cell shows entered grade
- [ ] Filter by student name narrows rows

---

## My Grades (`/courses/:code/my-grades`)

- [ ] My Grades page loads for enrolled student
- [ ] Shows assignment scores and overall grade

---

## Syllabus (`/courses/:code/syllabus`)

- [ ] Syllabus page loads with sections
- [ ] Instructor can edit a syllabus section
- [ ] Student sees "Accept Syllabus" overlay on first visit
- [ ] Accepted syllabus no longer shows overlay

---

## Course Feed (`/courses/:code/feed`)

- [ ] Feed channel list loads
- [ ] Post a message to the general channel
- [ ] Message appears in feed without page refresh

---

## Discussion Forums (`/courses/:code/discussions`)

- [ ] Discussions list page loads
- [ ] Create a new discussion forum
- [ ] Post a reply to a discussion thread
- [ ] Reply appears under parent post

---

## Course Enrollments (`/courses/:code/enrollments`)

- [ ] Enrollments page loads with current members
- [ ] Invite a user by email → pending enrollment appears
- [ ] Change enrollment role via dropdown
- [ ] Remove an enrollment → user disappears from list

---

## Course Calendar (`/courses/:code/calendar`)

- [ ] Calendar page loads with current month view
- [ ] Assignment due dates appear on calendar

---

## Global Calendar (`/calendar`)

- [ ] Global calendar loads
- [ ] Events from enrolled courses appear

---

## Question Bank (`/courses/:code/questions`)

- [ ] Question bank page loads
- [ ] Search filters visible and functional

---

## Notebook (`/courses/:code/notebook`)

- [ ] Notebook page loads for enrolled student
- [ ] Add a note entry

---

## Inbox (`/inbox`)

- [ ] Inbox page loads
- [ ] Unread count badge visible in nav when messages exist

---

## Reports (`/reports`)

- [ ] Reports page loads for instructor/admin

---

## Settings (`/settings/account`)

- [ ] Account settings page loads
- [ ] Update display name → saved successfully
- [ ] Change UI theme (light/dark) → preference persists after reload

---

## Admin

- [ ] Admin accommodations page loads (`/admin/accommodations`)
- [ ] Platform settings tab visible to global admin only

---

## Navigation

- [ ] Sidebar navigation visible after login
- [ ] Clicking "Courses" nav item navigates to `/courses`
- [ ] Clicking "Inbox" nav item navigates to `/inbox`
- [ ] Breadcrumb shows correct course title inside course pages
