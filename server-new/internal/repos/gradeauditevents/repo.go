package gradeauditevents

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func GradeCellID(courseID, assignmentID, studentID uuid.UUID) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte(fmt.Sprintf("%s#%s#%s", courseID, assignmentID, studentID)))
}

type GradeAuditEventRow struct {
	ID             uuid.UUID
	Action         string
	PreviousScore  *float64
	NewScore       *float64
	PreviousStatus *string
	NewStatus      *string
	Reason         *string
	ChangedAt      time.Time
	ChangedBy      *uuid.UUID
}

func Insert(ctx context.Context, tx pgx.Tx, courseID, assignmentID, studentID uuid.UUID, changedBy *uuid.UUID, action string, previousScore, newScore *float64, previousStatus, newStatus, reason *string) error {
	if tx == nil {
		return errors.New("db tx is nil")
	}
	gradeID := GradeCellID(courseID, assignmentID, studentID)
	_, err := tx.Exec(ctx, `
INSERT INTO course.grade_audit_events (
	grade_id, course_id, assignment_id, student_id, changed_by_user_id, action,
	previous_score, new_score, previous_status, new_status, reason, changed_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
`, gradeID, courseID, assignmentID, studentID, changedBy, action, previousScore, newScore, previousStatus, newStatus, reason, time.Now().UTC())
	return err
}

func ListForCell(ctx context.Context, pool *pgxpool.Pool, courseID, assignmentID, studentID uuid.UUID) ([]GradeAuditEventRow, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	rows, err := pool.Query(ctx, `
SELECT id, action, previous_score, new_score, previous_status, new_status, reason, changed_at, changed_by_user_id
FROM course.grade_audit_events
WHERE course_id = $1 AND assignment_id = $2 AND student_id = $3
ORDER BY changed_at ASC, id ASC
`, courseID, assignmentID, studentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []GradeAuditEventRow
	for rows.Next() {
		var r GradeAuditEventRow
		if err := rows.Scan(&r.ID, &r.Action, &r.PreviousScore, &r.NewScore, &r.PreviousStatus, &r.NewStatus, &r.Reason, &r.ChangedAt, &r.ChangedBy); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func ListForStudentInCourse(ctx context.Context, pool *pgxpool.Pool, courseID, studentID uuid.UUID) ([]GradeAuditEventRow, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	rows, err := pool.Query(ctx, `
SELECT id, action, previous_score, new_score, previous_status, new_status, reason, changed_at, changed_by_user_id
FROM course.grade_audit_events
WHERE course_id = $1 AND student_id = $2
ORDER BY changed_at DESC, id DESC
`, courseID, studentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []GradeAuditEventRow
	for rows.Next() {
		var r GradeAuditEventRow
		if err := rows.Scan(&r.ID, &r.Action, &r.PreviousScore, &r.NewScore, &r.PreviousStatus, &r.NewStatus, &r.Reason, &r.ChangedAt, &r.ChangedBy); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func PostedAtForCell(ctx context.Context, pool *pgxpool.Pool, courseID, assignmentID, studentID uuid.UUID) (*time.Time, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	var postedAt *time.Time
	err := pool.QueryRow(ctx, `
SELECT posted_at
FROM course.course_grades
WHERE course_id = $1 AND student_user_id = $2 AND module_item_id = $3
`, courseID, studentID, assignmentID).Scan(&postedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return postedAt, nil
}
