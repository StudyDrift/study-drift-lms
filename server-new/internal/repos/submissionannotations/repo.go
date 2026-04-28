package submissionannotations

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AnnotationRow struct {
	ID          uuid.UUID
	SubmissionID uuid.UUID
	AnnotatorID uuid.UUID
	ClientID    string
	Page        int32
	ToolType    string
	Colour      string
	CoordsJSON  json.RawMessage
	Body        *string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	DeletedAt   *time.Time
}

type AnnotationUpsertWrite struct {
	SubmissionID uuid.UUID
	AnnotatorID  uuid.UUID
	ClientID     string
	Page         int32
	ToolType     string
	Colour       string
	CoordsJSON   json.RawMessage
	Body         *string
}

func ListActiveForSubmission(ctx context.Context, pool *pgxpool.Pool, submissionID uuid.UUID) ([]AnnotationRow, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	rows, err := pool.Query(ctx, `
SELECT id, submission_id, annotator_id, client_id, page, tool_type, colour, coords_json, body, created_at, updated_at, deleted_at
FROM course.submission_annotations
WHERE submission_id = $1 AND deleted_at IS NULL
ORDER BY page ASC, created_at ASC, id ASC
`, submissionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]AnnotationRow, 0)
	for rows.Next() {
		var r AnnotationRow
		if err := rows.Scan(&r.ID, &r.SubmissionID, &r.AnnotatorID, &r.ClientID, &r.Page, &r.ToolType, &r.Colour, &r.CoordsJSON, &r.Body, &r.CreatedAt, &r.UpdatedAt, &r.DeletedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func GetByID(ctx context.Context, pool *pgxpool.Pool, annotationID uuid.UUID) (*AnnotationRow, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	var r AnnotationRow
	err := pool.QueryRow(ctx, `
SELECT id, submission_id, annotator_id, client_id, page, tool_type, colour, coords_json, body, created_at, updated_at, deleted_at
FROM course.submission_annotations
WHERE id = $1
`, annotationID).Scan(&r.ID, &r.SubmissionID, &r.AnnotatorID, &r.ClientID, &r.Page, &r.ToolType, &r.Colour, &r.CoordsJSON, &r.Body, &r.CreatedAt, &r.UpdatedAt, &r.DeletedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func Upsert(ctx context.Context, pool *pgxpool.Pool, w AnnotationUpsertWrite) (*AnnotationRow, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	var r AnnotationRow
	err := pool.QueryRow(ctx, `
INSERT INTO course.submission_annotations (submission_id, annotator_id, client_id, page, tool_type, colour, coords_json, body)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (submission_id, annotator_id, client_id) DO UPDATE
SET page = EXCLUDED.page,
	tool_type = EXCLUDED.tool_type,
	colour = EXCLUDED.colour,
	coords_json = EXCLUDED.coords_json,
	body = EXCLUDED.body,
	deleted_at = NULL,
	updated_at = NOW()
RETURNING id, submission_id, annotator_id, client_id, page, tool_type, colour, coords_json, body, created_at, updated_at, deleted_at
`, w.SubmissionID, w.AnnotatorID, w.ClientID, w.Page, w.ToolType, w.Colour, w.CoordsJSON, w.Body).Scan(
		&r.ID, &r.SubmissionID, &r.AnnotatorID, &r.ClientID, &r.Page, &r.ToolType, &r.Colour, &r.CoordsJSON, &r.Body, &r.CreatedAt, &r.UpdatedAt, &r.DeletedAt,
	)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func PatchBody(ctx context.Context, pool *pgxpool.Pool, annotationID, annotatorID uuid.UUID, body *string) (*AnnotationRow, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	var r AnnotationRow
	err := pool.QueryRow(ctx, `
UPDATE course.submission_annotations
SET body = $3, updated_at = NOW()
WHERE id = $1 AND annotator_id = $2 AND deleted_at IS NULL
RETURNING id, submission_id, annotator_id, client_id, page, tool_type, colour, coords_json, body, created_at, updated_at, deleted_at
`, annotationID, annotatorID, body).Scan(
		&r.ID, &r.SubmissionID, &r.AnnotatorID, &r.ClientID, &r.Page, &r.ToolType, &r.Colour, &r.CoordsJSON, &r.Body, &r.CreatedAt, &r.UpdatedAt, &r.DeletedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func SoftDelete(ctx context.Context, pool *pgxpool.Pool, annotationID uuid.UUID) (bool, error) {
	if pool == nil {
		return false, errors.New("db pool is nil")
	}
	tag, err := pool.Exec(ctx, `
UPDATE course.submission_annotations
SET deleted_at = NOW(), updated_at = NOW()
WHERE id = $1 AND deleted_at IS NULL
`, annotationID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
