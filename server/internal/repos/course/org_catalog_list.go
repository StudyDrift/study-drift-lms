package course

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ListPublicInOrg returns all non-archived courses in an organization (catalog metadata).
func ListPublicInOrg(ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID) ([]CoursePublic, error) {
	rows, err := pool.Query(ctx, `
SELECT`+coursePublicSelect+coursePublicFrom+`
WHERE c.org_id = $1 AND c.archived = false
ORDER BY c.title ASC
`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CoursePublic
	for rows.Next() {
		p, err := scanCoursePublicFromRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ListPublicInOrgWithinOrgUnits returns non-archived courses in orgID whose org_unit_id is in allowed (including NULL if allowUnassigned is true).
func ListPublicInOrgWithinOrgUnits(ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID, allowed []uuid.UUID, allowUnassigned bool) ([]CoursePublic, error) {
	if len(allowed) == 0 && !allowUnassigned {
		return []CoursePublic{}, nil
	}
	if len(allowed) == 0 && allowUnassigned {
		rows, err := pool.Query(ctx, `
SELECT`+coursePublicSelect+coursePublicFrom+`
WHERE c.org_id = $1 AND c.archived = false AND c.org_unit_id IS NULL
ORDER BY c.title ASC
`, orgID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		return scanCoursePublicRows(rows)
	}
	if allowUnassigned {
		rows, err := pool.Query(ctx, `
SELECT`+coursePublicSelect+coursePublicFrom+`
WHERE c.org_id = $1 AND c.archived = false
  AND (c.org_unit_id IS NULL OR c.org_unit_id = ANY($2::uuid[]))
ORDER BY c.title ASC
`, orgID, allowed)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		return scanCoursePublicRows(rows)
	}
	rows, err := pool.Query(ctx, `
SELECT`+coursePublicSelect+coursePublicFrom+`
WHERE c.org_id = $1 AND c.archived = false AND c.org_unit_id = ANY($2::uuid[])
ORDER BY c.title ASC
`, orgID, allowed)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCoursePublicRows(rows)
}

func scanCoursePublicRows(rows pgx.Rows) ([]CoursePublic, error) {
	var out []CoursePublic
	for rows.Next() {
		p, err := scanCoursePublicFromRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
