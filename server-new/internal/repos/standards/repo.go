package standards

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type StandardFrameworkRow struct {
	ID         uuid.UUID
	Code       string
	Name       string
	Version    string
	Publisher  *string
	ArchivedAt *time.Time
	CreatedAt  time.Time
}

type StandardCodeRow struct {
	ID                         uuid.UUID
	FrameworkID                uuid.UUID
	ParentID                   *uuid.UUID
	Code                       string
	ShortCode                  *string
	Description                string
	GradeBand                  *string
	DepthLevel                 int16
	ArchivedAt                 *time.Time
	SupersededByStandardCodeID *uuid.UUID
	CreatedAt                  time.Time
}

func GetLatestFrameworkByCode(ctx context.Context, pool *pgxpool.Pool, code string) (*StandardFrameworkRow, error) {
	var r StandardFrameworkRow
	err := pool.QueryRow(ctx, `
SELECT id, code, name, version, publisher, archived_at, created_at
FROM course.standard_frameworks
WHERE code = $1 AND archived_at IS NULL
ORDER BY created_at DESC
LIMIT 1
`, code).Scan(&r.ID, &r.Code, &r.Name, &r.Version, &r.Publisher, &r.ArchivedAt, &r.CreatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

func GetFrameworkByID(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (*StandardFrameworkRow, error) {
	var r StandardFrameworkRow
	err := pool.QueryRow(ctx, `
SELECT id, code, name, version, publisher, archived_at, created_at
FROM course.standard_frameworks
WHERE id = $1
`, id).Scan(&r.ID, &r.Code, &r.Name, &r.Version, &r.Publisher, &r.ArchivedAt, &r.CreatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

func ListStandardCodes(ctx context.Context, pool *pgxpool.Pool, frameworkID uuid.UUID, gradeBand *string, limit int64) ([]StandardCodeRow, error) {
	rows, err := pool.Query(ctx, `
SELECT id, framework_id, parent_id, code, short_code, description, grade_band, depth_level, archived_at, superseded_by_standard_code_id, created_at
FROM course.standard_codes
WHERE framework_id = $1 AND archived_at IS NULL AND ($2::text IS NULL OR grade_band = $2)
ORDER BY code ASC
LIMIT $3
`, frameworkID, gradeBand, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]StandardCodeRow, 0)
	for rows.Next() {
		var r StandardCodeRow
		if err := rows.Scan(&r.ID, &r.FrameworkID, &r.ParentID, &r.Code, &r.ShortCode, &r.Description, &r.GradeBand, &r.DepthLevel, &r.ArchivedAt, &r.SupersededByStandardCodeID, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetStandardCodeByID returns one code or nil.
func GetStandardCodeByID(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (*StandardCodeRow, error) {
	var r StandardCodeRow
	err := pool.QueryRow(ctx, `
SELECT id, framework_id, parent_id, code, short_code, description, grade_band, depth_level, archived_at, superseded_by_standard_code_id, created_at
FROM course.standard_codes
WHERE id = $1
`, id).Scan(&r.ID, &r.FrameworkID, &r.ParentID, &r.Code, &r.ShortCode, &r.Description, &r.GradeBand, &r.DepthLevel, &r.ArchivedAt, &r.SupersededByStandardCodeID, &r.CreatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

// SearchStandardCodes matches Rust `list_standard_codes` with non-empty search string (ILIKE).
func SearchStandardCodes(ctx context.Context, pool *pgxpool.Pool, frameworkID uuid.UUID, gradeBand *string, q string, limit int64) ([]StandardCodeRow, error) {
	pattern := "%" + strings.TrimSpace(q) + "%"
	rows, err := pool.Query(ctx, `
SELECT id, framework_id, parent_id, code, short_code, description, grade_band, depth_level, archived_at, superseded_by_standard_code_id, created_at
FROM course.standard_codes
WHERE framework_id = $1
  AND archived_at IS NULL
  AND ($2::text IS NULL OR grade_band = $2)
  AND (code ILIKE $3 OR short_code ILIKE $3 OR description ILIKE $3)
ORDER BY code ASC
LIMIT $4
`, frameworkID, gradeBand, pattern, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]StandardCodeRow, 0)
	for rows.Next() {
		var r StandardCodeRow
		if err := rows.Scan(&r.ID, &r.FrameworkID, &r.ParentID, &r.Code, &r.ShortCode, &r.Description, &r.GradeBand, &r.DepthLevel, &r.ArchivedAt, &r.SupersededByStandardCodeID, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
