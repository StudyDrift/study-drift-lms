package gradingschemes

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// UpsertForCourse updates existing active grading scheme for course, or creates+links one.
func UpsertForCourse(
	ctx context.Context,
	pool *pgxpool.Pool,
	courseID uuid.UUID,
	name string,
	gradingDisplayType string,
	scaleJSON []byte,
) (*Row, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var schemeID *uuid.UUID
	if err := tx.QueryRow(ctx, `
		SELECT grading_scheme_id
		FROM course.courses
		WHERE id = $1
		FOR UPDATE
	`, courseID).Scan(&schemeID); err != nil {
		return nil, err
	}

	var out Row
	var scale []byte
	if schemeID != nil {
		if err := tx.QueryRow(ctx, `
			UPDATE course.grading_schemes
			SET
				name = $2,
				grading_display_type = $3,
				scale_json = $4,
				updated_at = NOW()
			WHERE id = $1
			RETURNING id, course_id, name, grading_display_type, scale_json, created_at, updated_at
		`, *schemeID, name, gradingDisplayType, scaleJSON).Scan(
			&out.ID, &out.CourseID, &out.Name, &out.GradingDisplayType, &scale, &out.CreatedAt, &out.UpdatedAt,
		); err != nil {
			return nil, err
		}
	} else {
		if err := tx.QueryRow(ctx, `
			INSERT INTO course.grading_schemes (course_id, name, grading_display_type, scale_json)
			VALUES ($1, $2, $3, $4)
			RETURNING id, course_id, name, grading_display_type, scale_json, created_at, updated_at
		`, courseID, name, gradingDisplayType, scaleJSON).Scan(
			&out.ID, &out.CourseID, &out.Name, &out.GradingDisplayType, &scale, &out.CreatedAt, &out.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE course.courses
			SET grading_scheme_id = $1, updated_at = NOW()
			WHERE id = $2
		`, out.ID, courseID); err != nil {
			return nil, err
		}
	}
	if len(scale) > 0 {
		raw := json.RawMessage(append([]byte(nil), scale...))
		out.ScaleJSON = &raw
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &out, nil
}

