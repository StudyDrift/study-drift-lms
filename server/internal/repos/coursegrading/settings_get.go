package coursegrading

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SettingsResponse is the JSON for GET/PUT `/grading` (Rust `CourseGradingSettingsResponse`, camelCase).
type SettingsResponse struct {
	GradingScale            string                  `json:"gradingScale"`
	AssignmentGroups        []AssignmentGroupPublic `json:"assignmentGroups"`
	SbgEnabled              bool                    `json:"sbgEnabled"`
	SbgProficiencyScaleJSON *json.RawMessage        `json:"sbgProficiencyScaleJson,omitempty"`
	SbgAggregationRule      string                  `json:"sbgAggregationRule"`
}

// AssignmentGroupPublic matches `models/course_grading::AssignmentGroupPublic` (camelCase in JSON).
type AssignmentGroupPublic struct {
	ID                     uuid.UUID `json:"id"`
	SortOrder              int       `json:"sortOrder"`
	Name                   string    `json:"name"`
	WeightPercent          float64   `json:"weightPercent"`
	DropLowest             int       `json:"dropLowest"`
	DropHighest            int       `json:"dropHighest"`
	ReplaceLowestWithFinal bool      `json:"replaceLowestWithFinal"`
}

// GetSettingsForCourseCode loads scale, SBG flags, and assignment groups (Rust `get_settings_for_course_code`).
func GetSettingsForCourseCode(ctx context.Context, pool *pgxpool.Pool, courseCode string) (*SettingsResponse, error) {
	var (
		gradingScale       string
		sbgEnabled         bool
		sbgScaleBytes      []byte
		sbgAggregationRule string
		courseID           uuid.UUID
	)
	err := pool.QueryRow(ctx, `
		SELECT c.id, c.grading_scale, c.sbg_enabled, c.sbg_proficiency_scale_json, c.sbg_aggregation_rule
		FROM course.courses c
		WHERE c.course_code = $1
	`, courseCode).Scan(&courseID, &gradingScale, &sbgEnabled, &sbgScaleBytes, &sbgAggregationRule)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	groups, err := ListAssignmentGroups(ctx, pool, courseID)
	if err != nil {
		return nil, err
	}
	resp := &SettingsResponse{
		GradingScale:       gradingScale,
		AssignmentGroups:   groups,
		SbgEnabled:         sbgEnabled,
		SbgAggregationRule: sbgAggregationRule,
	}
	if len(sbgScaleBytes) > 0 {
		raw := json.RawMessage(append([]byte(nil), sbgScaleBytes...))
		resp.SbgProficiencyScaleJSON = &raw
	}
	return resp, nil
}

// ListAssignmentGroups returns assignment group rows for a course.
func ListAssignmentGroups(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) ([]AssignmentGroupPublic, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, sort_order, name, weight_percent, drop_lowest, drop_highest, replace_lowest_with_final
		FROM course.assignment_groups
		WHERE course_id = $1
		ORDER BY sort_order ASC, name ASC
	`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AssignmentGroupPublic
	for rows.Next() {
		var g AssignmentGroupPublic
		if err := rows.Scan(
			&g.ID, &g.SortOrder, &g.Name, &g.WeightPercent, &g.DropLowest, &g.DropHighest, &g.ReplaceLowestWithFinal,
		); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}
