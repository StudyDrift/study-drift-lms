package coursegrading

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AssignmentGroupInput is the JSON body for each group on PUT /grading (Rust `AssignmentGroupInput`).
type AssignmentGroupInput struct {
	ID                     *uuid.UUID `json:"id"`
	Name                   string     `json:"name"`
	SortOrder              int        `json:"sortOrder"`
	WeightPercent          float64    `json:"weightPercent"`
	DropLowest             *int       `json:"dropLowest"`
	DropHighest            *int       `json:"dropHighest"`
	ReplaceLowestWithFinal *bool      `json:"replaceLowestWithFinal"`
}

// PutSbgConfig matches partial SBG updates on PUT /grading.
type PutSbgConfig struct {
	Enabled           *bool
	ScaleJSON         *json.RawMessage // nil outer = unchanged; inner nil = clear column
	AggregationRule   *string
}

// PutError is returned when put_settings cannot complete.
type PutError struct {
	Cause     error
	UnknownID *uuid.UUID
}

func (e *PutError) Error() string {
	if e == nil {
		return ""
	}
	if e.UnknownID != nil {
		return fmt.Sprintf("unknown assignment group id: %s", *e.UnknownID)
	}
	if e.Cause != nil {
		return e.Cause.Error()
	}
	return "put settings failed"
}

func (e *PutError) Unwrap() error { return e.Cause }

// PutSettings updates grading scale, assignment groups, and optional SBG fields (Rust `course_grading::put_settings`).
func PutSettings(ctx context.Context, pool *pgxpool.Pool, courseCode, gradingScale string, groups []AssignmentGroupInput, sbg *PutSbgConfig) (*SettingsResponse, error) {
	var courseID uuid.UUID
	err := pool.QueryRow(ctx, `SELECT id FROM course.courses WHERE course_code = $1`, courseCode).Scan(&courseID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, &PutError{Cause: err}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, &PutError{Cause: err}
	}
	defer func() { _ = tx.Rollback(ctx) }()

	_, err = tx.Exec(ctx, `
		UPDATE course.courses SET grading_scale = $1, updated_at = NOW() WHERE course_code = $2
	`, gradingScale, courseCode)
	if err != nil {
		return nil, &PutError{Cause: err}
	}

	var keptIDs []uuid.UUID
	for _, g := range groups {
		name := trimName(g.Name)
		if name == "" {
			continue
		}
		w := g.WeightPercent
		if w < 0 {
			w = 0
		}
		if w > 100 {
			w = 100
		}
		dl := 0
		if g.DropLowest != nil {
			dl = *g.DropLowest
			if dl < 0 {
				dl = 0
			}
		}
		dh := 0
		if g.DropHighest != nil {
			dh = *g.DropHighest
			if dh < 0 {
				dh = 0
			}
		}
		rpf := false
		if g.ReplaceLowestWithFinal != nil {
			rpf = *g.ReplaceLowestWithFinal
		}

		if g.ID != nil {
			tag, err := tx.Exec(ctx, `
				UPDATE course.assignment_groups
				SET sort_order = $2, name = $3, weight_percent = $4,
				    drop_lowest = $6, drop_highest = $7, replace_lowest_with_final = $8,
				    updated_at = NOW()
				WHERE id = $1 AND course_id = $5
			`, *g.ID, g.SortOrder, name, w, courseID, dl, dh, rpf)
			if err != nil {
				return nil, &PutError{Cause: err}
			}
			if tag.RowsAffected() == 0 {
				id := *g.ID
				return nil, &PutError{UnknownID: &id}
			}
			keptIDs = append(keptIDs, *g.ID)
		} else {
			var newID uuid.UUID
			err := tx.QueryRow(ctx, `
				INSERT INTO course.assignment_groups (course_id, sort_order, name, weight_percent, drop_lowest, drop_highest, replace_lowest_with_final)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
				RETURNING id
			`, courseID, g.SortOrder, name, w, dl, dh, rpf).Scan(&newID)
			if err != nil {
				return nil, &PutError{Cause: err}
			}
			keptIDs = append(keptIDs, newID)
		}
	}

	if len(keptIDs) > 0 {
		_, err = tx.Exec(ctx, `
			DELETE FROM course.assignment_groups
			WHERE course_id = $1 AND NOT (id = ANY($2::uuid[]))
		`, courseID, keptIDs)
	} else {
		_, err = tx.Exec(ctx, `DELETE FROM course.assignment_groups WHERE course_id = $1`, courseID)
	}
	if err != nil {
		return nil, &PutError{Cause: err}
	}

	if sbg != nil && (sbg.Enabled != nil || sbg.ScaleJSON != nil || sbg.AggregationRule != nil) {
		if sbg.Enabled != nil {
			_, err = tx.Exec(ctx, `UPDATE course.courses SET sbg_enabled = $1, updated_at = NOW() WHERE course_code = $2`, *sbg.Enabled, courseCode)
			if err != nil {
				return nil, &PutError{Cause: err}
			}
		}
		if sbg.ScaleJSON != nil {
			var v interface{} = *sbg.ScaleJSON
			if len(*sbg.ScaleJSON) == 0 || string(*sbg.ScaleJSON) == "null" {
				v = nil
			}
			_, err = tx.Exec(ctx, `UPDATE course.courses SET sbg_proficiency_scale_json = $1, updated_at = NOW() WHERE course_code = $2`, v, courseCode)
			if err != nil {
				return nil, &PutError{Cause: err}
			}
		}
		if sbg.AggregationRule != nil {
			_, err = tx.Exec(ctx, `UPDATE course.courses SET sbg_aggregation_rule = $1, updated_at = NOW() WHERE course_code = $2`, *sbg.AggregationRule, courseCode)
			if err != nil {
				return nil, &PutError{Cause: err}
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, &PutError{Cause: err}
	}

	return GetSettingsForCourseCode(ctx, pool, courseCode)
}

func trimName(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t' || s[0] == '\n') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\t' || s[len(s)-1] == '\n') {
		s = s[:len(s)-1]
	}
	return s
}
