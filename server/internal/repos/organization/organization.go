// Package organization provides tenant root entities (plan 5.1).
package organization

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SeedDefaultOrgID is the well-known default organization (migration 127); all legacy rows backfill to this id.
var SeedDefaultOrgID = uuid.MustParse("a0000000-0000-4000-8000-0000000000a0")

// Row is an organizations table row for APIs.
type Row struct {
	ID          uuid.UUID
	Slug        string
	Name        string
	Status      string
	MaxUsers    *int32
	MaxCourses  *int32
	DataRegion  string
	Metadata    json.RawMessage
	CreatedAt   time.Time
	UpdatedAt   time.Time
	UserCount   int64
	CourseCount int64
}

// ResolveOrgIDForProvisioning returns org id when institutionID matches an organization row, otherwise the seed default.
func ResolveOrgIDForProvisioning(ctx context.Context, pool *pgxpool.Pool, institutionID uuid.UUID) (uuid.UUID, error) {
	if institutionID == uuid.Nil {
		return SeedDefaultOrgID, nil
	}
	var ok bool
	err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tenant.organizations WHERE id = $1 AND status <> 'deleted')`, institutionID).Scan(&ok)
	if err != nil {
		return uuid.UUID{}, err
	}
	if ok {
		return institutionID, nil
	}
	return SeedDefaultOrgID, nil
}

// OrgStatusForUser returns organization status for the user's org_id, or empty if missing.
func OrgStatusForUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (status string, err error) {
	err = pool.QueryRow(ctx, `
SELECT o.status
FROM "user".users u
JOIN tenant.organizations o ON o.id = u.org_id
WHERE u.id = $1
`, userID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return status, nil
}

// OrgSlugForUser returns slug for JWT embedding.
func OrgSlugForUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (slug string, err error) {
	err = pool.QueryRow(ctx, `
SELECT o.slug
FROM "user".users u
JOIN tenant.organizations o ON o.id = u.org_id
WHERE u.id = $1
`, userID).Scan(&slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return slug, err
}

// OrgIDForUser returns the user's org_id.
func OrgIDForUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := pool.QueryRow(ctx, `SELECT org_id FROM "user".users WHERE id = $1`, userID).Scan(&id)
	if err != nil {
		return uuid.UUID{}, err
	}
	return id, nil
}

// InsertAudit appends an organization audit row (best-effort metadata).
func InsertAudit(ctx context.Context, pool *pgxpool.Pool, actorID, orgID uuid.UUID, action string, payload any) error {
	var pj []byte
	if payload != nil {
		var err error
		pj, err = json.Marshal(payload)
		if err != nil {
			pj = []byte("{}")
		}
	} else {
		pj = []byte("{}")
	}
	_, err := pool.Exec(ctx, `
INSERT INTO tenant.organization_audit_events (actor_id, org_id, action, payload)
VALUES ($1, $2, $3, $4)
`, actorID, orgID, action, pj)
	return err
}

// Create inserts a new organization; slug is normalized to lowercase for uniqueness.
func Create(ctx context.Context, pool *pgxpool.Pool, name, slug string, maxUsers, maxCourses *int32, dataRegion string, metadata json.RawMessage) (Row, error) {
	slug = strings.TrimSpace(strings.ToLower(slug))
	name = strings.TrimSpace(name)
	if slug == "" || name == "" {
		return Row{}, errors.New("organization: name and slug required")
	}
	dr := strings.TrimSpace(dataRegion)
	if dr == "" {
		dr = "us-east-1"
	}
	meta := metadata
	if len(meta) == 0 {
		meta = []byte("{}")
	}
	var r Row
	err := pool.QueryRow(ctx, `
INSERT INTO tenant.organizations (slug, name, status, max_users, max_courses, data_region, metadata)
VALUES ($1, $2, 'active', $3, $4, $5, $6::jsonb)
RETURNING id, slug, name, status, max_users, max_courses, data_region, metadata, created_at, updated_at
`, slug, name, maxUsers, maxCourses, dr, string(meta)).Scan(
		&r.ID, &r.Slug, &r.Name, &r.Status, &r.MaxUsers, &r.MaxCourses, &r.DataRegion, &r.Metadata, &r.CreatedAt, &r.UpdatedAt,
	)
	if err != nil {
		var pe *pgconn.PgError
		if errors.As(err, &pe) && pe.Code == "23505" {
			return Row{}, errors.New("organization: slug already in use")
		}
		return Row{}, err
	}
	return r, nil
}

// List returns organizations ordered by name (paginated).
func List(ctx context.Context, pool *pgxpool.Pool, limit, offset int32) ([]Row, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := pool.Query(ctx, `
SELECT o.id, o.slug, o.name, o.status, o.max_users, o.max_courses, o.data_region, o.metadata, o.created_at, o.updated_at,
  (SELECT COUNT(*)::bigint FROM "user".users u WHERE u.org_id = o.id) AS user_count,
  (SELECT COUNT(*)::bigint FROM course.courses c WHERE c.org_id = o.id) AS course_count
FROM tenant.organizations o
WHERE o.status <> 'deleted'
ORDER BY o.name ASC
LIMIT $1 OFFSET $2
`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanOrgRows(rows)
}

// GetByID returns one org or nil if not found / deleted.
func GetByID(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (*Row, error) {
	row := pool.QueryRow(ctx, `
SELECT o.id, o.slug, o.name, o.status, o.max_users, o.max_courses, o.data_region, o.metadata, o.created_at, o.updated_at,
  (SELECT COUNT(*)::bigint FROM "user".users u WHERE u.org_id = o.id) AS user_count,
  (SELECT COUNT(*)::bigint FROM course.courses c WHERE c.org_id = o.id) AS course_count
FROM tenant.organizations o
WHERE o.id = $1 AND o.status <> 'deleted'
`, id)
	r, err := scanOrgRow(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

// Patch updates name, status, quotas, data_region, metadata (non-nil fields only).
func Patch(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, name, status *string, maxUsers, maxCourses *int32, dataRegion *string, metadata *json.RawMessage) (*Row, error) {
	cur, err := GetByID(ctx, pool, id)
	if err != nil {
		return nil, err
	}
	if cur == nil {
		return nil, nil
	}
	n := cur.Name
	if name != nil && strings.TrimSpace(*name) != "" {
		n = strings.TrimSpace(*name)
	}
	st := cur.Status
	if status != nil && strings.TrimSpace(*status) != "" {
		s := strings.TrimSpace(strings.ToLower(*status))
		if s != "active" && s != "suspended" && s != "deleted" {
			return nil, errors.New("organization: invalid status")
		}
		st = s
	}
	mu := cur.MaxUsers
	if maxUsers != nil {
		mu = maxUsers
	}
	mc := cur.MaxCourses
	if maxCourses != nil {
		mc = maxCourses
	}
	dr := cur.DataRegion
	if dataRegion != nil && strings.TrimSpace(*dataRegion) != "" {
		dr = strings.TrimSpace(*dataRegion)
	}
	meta := cur.Metadata
	if metadata != nil {
		meta = *metadata
		if len(meta) == 0 {
			meta = []byte("{}")
		}
	}
	var out Row
	err = pool.QueryRow(ctx, `
UPDATE tenant.organizations
SET name = $2, status = $3, max_users = $4, max_courses = $5, data_region = $6, metadata = $7::jsonb, updated_at = NOW()
WHERE id = $1
RETURNING id, slug, name, status, max_users, max_courses, data_region, metadata, created_at, updated_at
`, id, n, st, mu, mc, dr, string(meta)).Scan(
		&out.ID, &out.Slug, &out.Name, &out.Status, &out.MaxUsers, &out.MaxCourses, &out.DataRegion, &out.Metadata, &out.CreatedAt, &out.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	// refresh counts
	return GetByID(ctx, pool, id)
}

func scanOrgRow(row pgx.Row) (Row, error) {
	var r Row
	var mu, mc sql.NullInt32
	err := row.Scan(&r.ID, &r.Slug, &r.Name, &r.Status, &mu, &mc, &r.DataRegion, &r.Metadata, &r.CreatedAt, &r.UpdatedAt, &r.UserCount, &r.CourseCount)
	if err != nil {
		return Row{}, err
	}
	if mu.Valid {
		v := mu.Int32
		r.MaxUsers = &v
	}
	if mc.Valid {
		v := mc.Int32
		r.MaxCourses = &v
	}
	return r, nil
}

func scanOrgRows(rows pgx.Rows) ([]Row, error) {
	var out []Row
	for rows.Next() {
		r, err := scanOrgRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// OrgStatusForUserTx returns organization status for a user within a transaction.
func OrgStatusForUserTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID) (status string, err error) {
	err = tx.QueryRow(ctx, `
SELECT o.status
FROM "user".users u
INNER JOIN tenant.organizations o ON o.id = u.org_id
WHERE u.id = $1
`, userID).Scan(&status)
	return status, err
}
