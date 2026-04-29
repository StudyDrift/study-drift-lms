// Package welcomecourse creates (or reuses) the default “Getting started with Lextures” course:
// content pages, a short assignment, and a knowledge-check quiz, plus roster and RBAC-aligned grants for staff.
package welcomecourse

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultCourseTitle       = "Getting started with Lextures"
	defaultCourseDescription = "Short tour of Lextures after your first sign-in: navigation, learning activities, and where to get help."
)

// DefaultTitle is the canonical title used to detect an existing welcome course for a user.
func DefaultTitle() string { return defaultCourseTitle }

// Result is returned after a successful hydrate (new or existing).
type Result struct {
	CourseID   uuid.UUID
	CourseCode string
	Created    bool
}

type quizQuestionJSON struct {
	ID                 string          `json:"id"`
	Prompt             string          `json:"prompt"`
	QuestionType       string          `json:"questionType"`
	Choices            []string        `json:"choices"`
	ChoiceIDs          []string        `json:"choiceIds"`
	TypeConfig         json.RawMessage `json:"typeConfig"`
	CorrectChoiceIndex *uint           `json:"correctChoiceIndex"`
	MultipleAnswer     bool            `json:"multipleAnswer"`
	AnswerWithImage    bool            `json:"answerWithImage"`
	Required           bool            `json:"required"`
	Points             int32           `json:"points"`
	EstimatedMinutes   int32           `json:"estimatedMinutes"`
	ConceptIDs         []string        `json:"conceptIds"`
	SrsEligible        bool            `json:"srsEligible"`
}

// Hydrate ensures the welcome course exists for studentUserID and returns its identifiers.
// teacherUserIDs are enrolled as teachers and receive the same per-course permission grants as migrations seed for staff.
func Hydrate(ctx context.Context, pool *pgxpool.Pool, studentUserID uuid.UUID, teacherUserIDs []uuid.UUID) (*Result, error) {
	if studentUserID == uuid.Nil {
		return nil, fmt.Errorf("student user id is required")
	}
	teachers := normalizeTeacherIDs(teacherUserIDs, studentUserID)

	var existingID uuid.UUID
	var existingCode string
	err := pool.QueryRow(ctx, `
SELECT c.id, c.course_code
FROM course.courses c
INNER JOIN course.course_enrollments se
  ON se.course_id = c.id AND se.user_id = $1 AND se.role = 'student'
WHERE c.title = $2
LIMIT 1
`, studentUserID, defaultCourseTitle).Scan(&existingID, &existingCode)
	if err == nil {
		return &Result{CourseID: existingID, CourseCode: existingCode, Created: false}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	const maxCodeAttempts = 8
	primaryTeacher := teachers[0]

	for attempt := 0; attempt < maxCodeAttempts; attempt++ {
		code, gerr := randomCourseCode()
		if gerr != nil {
			return nil, gerr
		}
		tx, berr := pool.BeginTx(ctx, pgx.TxOptions{})
		if berr != nil {
			return nil, berr
		}

		var courseID uuid.UUID
		if ierr := tx.QueryRow(ctx, `
INSERT INTO course.courses (
	course_code, title, description, course_type, created_by_user_id, published
)
VALUES ($1, $2, $3, 'traditional', $4, TRUE)
RETURNING id
`, code, defaultCourseTitle, defaultCourseDescription, primaryTeacher).Scan(&courseID); ierr != nil {
			_ = tx.Rollback(ctx)
			var pgErr *pgconn.PgError
			if errors.As(ierr, &pgErr) && pgErr.Code == "23505" {
				continue
			}
			return nil, ierr
		}

		if _, ierr := tx.Exec(ctx, `
INSERT INTO course.assignment_groups (course_id, sort_order, name, weight_percent)
VALUES ($1, 0, 'Assignments', 100.0)
`, courseID); ierr != nil {
			_ = tx.Rollback(ctx)
			return nil, ierr
		}

		for _, uid := range teachers {
			if _, ierr := tx.Exec(ctx, `
INSERT INTO course.course_enrollments (course_id, user_id, role)
VALUES ($1, $2, 'teacher')
ON CONFLICT (course_id, user_id, role) DO NOTHING
`, courseID, uid); ierr != nil {
				_ = tx.Rollback(ctx)
				return nil, ierr
			}
		}
		if _, ierr := tx.Exec(ctx, `
INSERT INTO course.course_enrollments (course_id, user_id, role)
VALUES ($1, $2, 'student')
ON CONFLICT (course_id, user_id, role) DO NOTHING
`, courseID, studentUserID); ierr != nil {
			_ = tx.Rollback(ctx)
			return nil, ierr
		}

		permPrefix := "course:" + code + ":"
		grantSQL := `INSERT INTO course.user_course_grants (user_id, course_id, permission_string) VALUES ($1, $2, $3) ON CONFLICT (user_id, course_id, permission_string) DO NOTHING`
		for _, uid := range teachers {
			for _, perm := range []string{
				permPrefix + "item:create",
				permPrefix + "items:create",
				permPrefix + "enrollments:read",
				permPrefix + "enrollments:update",
				permPrefix + "gradebook:view",
			} {
				if _, ierr := tx.Exec(ctx, grantSQL, uid, courseID, perm); ierr != nil {
					_ = tx.Rollback(ctx)
					return nil, ierr
				}
			}
		}

		var modID uuid.UUID
		if ierr := tx.QueryRow(ctx, `
INSERT INTO course.course_structure_items (course_id, sort_order, kind, title, parent_id, published)
VALUES ($1, 0, 'module', 'Welcome to Lextures', NULL, TRUE)
RETURNING id
`, courseID).Scan(&modID); ierr != nil {
			_ = tx.Rollback(ctx)
			return nil, ierr
		}

		pageIntro := introPageMarkdown()
		if ierr := insertContentPage(ctx, tx, courseID, modID, 0, "Open Lextures and find your way around", pageIntro); ierr != nil {
			_ = tx.Rollback(ctx)
			return nil, ierr
		}

		pageActivities := activitiesPageMarkdown()
		if ierr := insertContentPage(ctx, tx, courseID, modID, 1, "Assignments, quizzes, and your grades", pageActivities); ierr != nil {
			_ = tx.Rollback(ctx)
			return nil, ierr
		}

		if ierr := insertAssignment(ctx, tx, courseID, modID, 2, "Try a practice check-in", practiceAssignmentMarkdown()); ierr != nil {
			_ = tx.Rollback(ctx)
			return nil, ierr
		}

		qs := []quizQuestionJSON{
			{
				ID:           "welcome-q1",
				Prompt:       "Where do you primarily open a course after signing in to Lextures?",
				QuestionType: "multiple_choice",
				Choices: []string{
					"From the course picker on my home dashboard",
					"Only through an external LMS launch link",
					"In System Settings, under Courses",
					"In the question bank editor",
				},
				ChoiceIDs:          []string{},
				TypeConfig:         json.RawMessage(`{}`),
				CorrectChoiceIndex: uintPtr(0),
				Points:             1,
				Required:           true,
			},
		}
		qBytes, jerr := json.Marshal(qs)
		if jerr != nil {
			_ = tx.Rollback(ctx)
			return nil, jerr
		}
		if ierr := insertQuiz(ctx, tx, courseID, modID, 3, "Quick check: Lextures basics", quickCheckIntroMarkdown(), qBytes); ierr != nil {
			_ = tx.Rollback(ctx)
			return nil, ierr
		}

		if ierr := ensureUserAppRoles(ctx, tx, studentUserID, teachers); ierr != nil {
			_ = tx.Rollback(ctx)
			return nil, ierr
		}

		if cerr := tx.Commit(ctx); cerr != nil {
			return nil, cerr
		}
		return &Result{CourseID: courseID, CourseCode: code, Created: true}, nil
	}
	return nil, fmt.Errorf("failed to allocate unique course code after %d attempts", maxCodeAttempts)
}

const (
	courseCodePrefix = "C-"
	courseCodeRand   = 6
)

func randomCourseCode() (string, error) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, courseCodeRand)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := make([]byte, courseCodeRand)
	for i := range b {
		out[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return courseCodePrefix + string(out), nil
}

// ensureUserAppRoles links baseline global app roles so authorization matches course enrollment intent.
func ensureUserAppRoles(ctx context.Context, tx pgx.Tx, student uuid.UUID, teachers []uuid.UUID) error {
	if _, err := tx.Exec(ctx, `
INSERT INTO "user".user_app_roles (user_id, role_id)
SELECT $1, r.id FROM "user".app_roles r WHERE r.name = 'Student'
ON CONFLICT (user_id, role_id) DO NOTHING
`, student); err != nil {
		return err
	}
	for _, uid := range teachers {
		if _, err := tx.Exec(ctx, `
INSERT INTO "user".user_app_roles (user_id, role_id)
SELECT $1, r.id FROM "user".app_roles r WHERE r.name = 'Teacher'
ON CONFLICT (user_id, role_id) DO NOTHING
`, uid); err != nil {
			return err
		}
	}
	return nil
}

func normalizeTeacherIDs(ids []uuid.UUID, student uuid.UUID) []uuid.UUID {
	seen := make(map[uuid.UUID]struct{})
	var out []uuid.UUID
	for _, id := range ids {
		if id == uuid.Nil {
			continue
		}
		if id == student {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	if len(out) == 0 && student != uuid.Nil {
		// Solo mode: same user teaches and takes the tour.
		return []uuid.UUID{student}
	}
	return out
}

func insertContentPage(ctx context.Context, tx pgx.Tx, courseID, moduleID uuid.UUID, sort int, title, markdown string) error {
	var id uuid.UUID
	q := `
INSERT INTO course.course_structure_items (course_id, sort_order, kind, title, parent_id, published)
VALUES ($1, $2, 'content_page', $3, $4, TRUE)
RETURNING id`
	if err := tx.QueryRow(ctx, q, courseID, sort, title, moduleID).Scan(&id); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO course.module_content_pages (structure_item_id, markdown) VALUES ($1, $2)`, id, markdown)
	return err
}

func insertAssignment(ctx context.Context, tx pgx.Tx, courseID, moduleID uuid.UUID, sort int, title, markdown string) error {
	var id uuid.UUID
	q := `
INSERT INTO course.course_structure_items (course_id, sort_order, kind, title, parent_id, published)
VALUES ($1, $2, 'assignment', $3, $4, TRUE)
RETURNING id`
	if err := tx.QueryRow(ctx, q, courseID, sort, title, moduleID).Scan(&id); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO course.module_assignments (structure_item_id, markdown) VALUES ($1, $2)`, id, markdown)
	return err
}

func insertQuiz(ctx context.Context, tx pgx.Tx, courseID, moduleID uuid.UUID, sort int, title, markdown string, questionsJSON []byte) error {
	var id uuid.UUID
	q := `
INSERT INTO course.course_structure_items (course_id, sort_order, kind, title, parent_id, published)
VALUES ($1, $2, 'quiz', $3, $4, TRUE)
RETURNING id`
	if err := tx.QueryRow(ctx, q, courseID, sort, title, moduleID).Scan(&id); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO course.module_quizzes (structure_item_id, markdown, questions_json) VALUES ($1, $2, $3::jsonb)`, id, markdown, questionsJSON)
	return err
}

func uintPtr(u uint) *uint { return &u }

func introPageMarkdown() string {
	return strings.TrimSpace(`
## You're in the right place

This short course is shown after your first sign-in so you can learn Lextures in context instead of reading a static manual.

### Home and courses

- After you sign in, open **Courses** (or your dashboard) to see everything you are enrolled in.
- Each **course card** opens that course’s outline, syllabus, announcements, and activities.

### Course layout

Inside a course you typically see:

- **Modules** — ordered lessons, readings, videos, assignments, and quizzes.
- **Grades** — scores and feedback your instructors release (names vary by institution).

### Mobile app

If you installed the Lextures mobile app, you are using the same account as the web app. Complete activities the same way; drafts and submissions sync when you are online.

### Need help?

Use **your institution’s help link** or instructor syllabus for local support. Lextures also surfaces context-sensitive help where product teams have wired it in.

When you are ready, go to the next page and try the sample assignment and quiz.
`)
}

func activitiesPageMarkdown() string {
	return strings.TrimSpace(`
## Assignments

**Assignments** ask you to submit work: text, files, or both, depending on how your instructor configured the activity.

1. Open the assignment from the course outline.
2. Read the instructions and rubric (if provided).
3. Compose your answer and attach any required files.
4. Submit before the due date. You may be allowed to resubmit if your instructor turns that on.

## Quizzes

**Quizzes** are auto-graded checks for understanding. Some quizzes shuffle questions or impose a time limit; follow on-screen guidance.

- Select **Submit** when you are finished, not only when the timer ends.
- After submit, review rules determine whether you can see correct answers immediately, after the due date, or never.

## Grades

Open **Grades** from the course menu to see released scores. Some items stay hidden until the instructor posts grades for everyone.

---

Try the practice items in this module to confirm everything works on your device.
`)
}

func practiceAssignmentMarkdown() string {
	return strings.TrimSpace(`
### Practice check-in (not graded)

Reply in a sentence or two:

1. What device are you using right now (web browser vs. mobile app)?
2. What is one goal you have for using Lextures this term?

This item exists only so you can see how assignment submission works. Your instructor may not leave feedback here.
`)
}

func quickCheckIntroMarkdown() string {
	return strings.TrimSpace(`
### Quick knowledge check

One multiple-choice question below. Select the answer that best matches how Lextures is usually used.
`)
}
