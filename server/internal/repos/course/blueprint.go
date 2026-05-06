package course

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BlueprintChildSummary is a course linked to a blueprint parent.
type BlueprintChildSummary struct {
	ID         uuid.UUID
	CourseCode string
	Title      string
	LastSync   *time.Time
}

// SetCourseIsBlueprint updates course.courses.is_blueprint.
func SetCourseIsBlueprint(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, isBlueprint bool) error {
	_, err := pool.Exec(ctx, `
		UPDATE course.courses SET is_blueprint = $2, updated_at = NOW() WHERE id = $1
	`, courseID, isBlueprint)
	return err
}

// SetBlueprintParent sets blueprint_parent_id on a child course.
func SetBlueprintParent(ctx context.Context, pool *pgxpool.Pool, childID, blueprintID uuid.UUID) error {
	_, err := pool.Exec(ctx, `
		UPDATE course.courses SET blueprint_parent_id = $2, updated_at = NOW() WHERE id = $1
	`, childID, blueprintID)
	return err
}

// ClearBlueprintParent clears blueprint_parent_id on a child course.
func ClearBlueprintParent(ctx context.Context, pool *pgxpool.Pool, childID uuid.UUID) error {
	_, err := pool.Exec(ctx, `
		UPDATE course.courses SET blueprint_parent_id = NULL, updated_at = NOW() WHERE id = $1
	`, childID)
	return err
}

// TouchBlueprintLastSync sets blueprint_last_sync_at on a child course.
func TouchBlueprintLastSync(ctx context.Context, pool *pgxpool.Pool, childID uuid.UUID, t time.Time) error {
	_, err := pool.Exec(ctx, `
		UPDATE course.courses SET blueprint_last_sync_at = $2, updated_at = NOW() WHERE id = $1
	`, childID, t.UTC())
	return err
}

// ListBlueprintChildren returns courses linked to the given blueprint course id.
func ListBlueprintChildren(ctx context.Context, pool *pgxpool.Pool, blueprintID uuid.UUID) ([]BlueprintChildSummary, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, course_code, title, blueprint_last_sync_at
		FROM course.courses
		WHERE blueprint_parent_id = $1
		ORDER BY title ASC
	`, blueprintID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BlueprintChildSummary
	for rows.Next() {
		var r BlueprintChildSummary
		var sync pgtype.Timestamptz
		if err := rows.Scan(&r.ID, &r.CourseCode, &r.Title, &sync); err != nil {
			return nil, err
		}
		if sync.Valid {
			t := sync.Time
			r.LastSync = &t
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// InsertBlueprintSyncLog records a blueprint push run.
func InsertBlueprintSyncLog(
	ctx context.Context, pool *pgxpool.Pool,
	blueprintID, triggeredBy uuid.UUID,
	total, success, errCount int,
	detail []map[string]any,
) error {
	detailJSON, err := json.Marshal(detail)
	if err != nil {
		detailJSON = []byte("[]")
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO course.blueprint_sync_logs (
			blueprint_id, triggered_by, children_total, children_success, children_error, log_detail
		) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
	`, blueprintID, triggeredBy, total, success, errCount, detailJSON)
	return err
}

// CourseBlueprintMeta loads blueprint flags for a course id.
type CourseBlueprintMeta struct {
	ID                uuid.UUID
	OrgID             uuid.UUID
	IsBlueprint       bool
	BlueprintParentID *uuid.UUID
}

// GetBlueprintMeta returns org + blueprint columns for a course.
func GetBlueprintMeta(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) (*CourseBlueprintMeta, error) {
	var m CourseBlueprintMeta
	var parent pgtype.UUID
	err := pool.QueryRow(ctx, `
		SELECT id, org_id, is_blueprint, blueprint_parent_id FROM course.courses WHERE id = $1
	`, courseID).Scan(&m.ID, &m.OrgID, &m.IsBlueprint, &parent)
	if err != nil {
		return nil, err
	}
	if parent.Valid {
		u := uuid.UUID(parent.Bytes)
		m.BlueprintParentID = &u
	}
	return &m, nil
}
