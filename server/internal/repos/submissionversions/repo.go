package submissionversions

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SubmissionVersionRow struct {
	ID               uuid.UUID
	VersionNumber    int32
	AttachmentFileID *uuid.UUID
	SubmittedAt      time.Time
}

func ListForStudentItem(ctx context.Context, pool *pgxpool.Pool, courseID, moduleItemID, studentID uuid.UUID) ([]SubmissionVersionRow, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	rows, err := pool.Query(ctx, `
SELECT id, version_number, attachment_file_id, submitted_at
FROM course.submission_versions
WHERE course_id = $1 AND module_item_id = $2 AND student_id = $3
ORDER BY version_number ASC, id ASC
`, courseID, moduleItemID, studentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]SubmissionVersionRow, 0)
	for rows.Next() {
		var r SubmissionVersionRow
		if err := rows.Scan(&r.ID, &r.VersionNumber, &r.AttachmentFileID, &r.SubmittedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func InsertArchived(ctx context.Context, tx pgx.Tx, courseID, moduleItemID, studentID uuid.UUID, versionNumber int32, attachmentFileID *uuid.UUID, submittedAt time.Time) (uuid.UUID, error) {
	if tx == nil {
		return uuid.Nil, errors.New("db tx is nil")
	}
	var id uuid.UUID
	err := tx.QueryRow(ctx, `
INSERT INTO course.submission_versions (course_id, module_item_id, student_id, version_number, attachment_file_id, submitted_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id
`, courseID, moduleItemID, studentID, versionNumber, attachmentFileID, submittedAt).Scan(&id)
	return id, err
}
