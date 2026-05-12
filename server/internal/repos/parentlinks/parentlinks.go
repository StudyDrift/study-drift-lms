// Package parentlinks stores parent–student relationships (plan 5.10).
package parentlinks

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func strPtr(ns sql.NullString) *string {
	if !ns.Valid {
		return nil
	}
	s := ns.String
	return &s
}

// Link is one parent_student_links row.
type Link struct {
	ID             uuid.UUID  `json:"id"`
	OrgID          uuid.UUID  `json:"orgId"`
	ParentUserID   uuid.UUID  `json:"parentUserId"`
	StudentUserID  uuid.UUID  `json:"studentUserId"`
	Relationship   string     `json:"relationship"`
	Status         string     `json:"status"`
	LinkedBy       *uuid.UUID `json:"linkedBy,omitempty"`
	LinkedAt       time.Time  `json:"linkedAt"`
	StudentEmail   string     `json:"studentEmail"`
	StudentDisplay *string    `json:"studentDisplayName,omitempty"`
	ParentEmail    string     `json:"parentEmail"`
	ParentDisplay  *string    `json:"parentDisplayName,omitempty"`
}

const activeStatuses = `('active','pending')`

// ActiveLinkBetween returns the link when parent has an active/pending link to student in org.
func ActiveLinkBetween(ctx context.Context, pool *pgxpool.Pool, orgID, parentID, studentID uuid.UUID) (*Link, error) {
	var l Link
	var linkedBy *uuid.UUID
	var sdn, pdn sql.NullString
	err := pool.QueryRow(ctx, `
SELECT l.id, l.org_id, l.parent_user_id, l.student_user_id, l.relationship, l.status, l.linked_by, l.linked_at,
       su.email, su.display_name, pu.email, pu.display_name
FROM "user".parent_student_links l
INNER JOIN "user".users su ON su.id = l.student_user_id
INNER JOIN "user".users pu ON pu.id = l.parent_user_id
WHERE l.org_id = $1 AND l.parent_user_id = $2 AND l.student_user_id = $3
  AND l.status IN `+activeStatuses+`
`, orgID, parentID, studentID).Scan(
		&l.ID, &l.OrgID, &l.ParentUserID, &l.StudentUserID, &l.Relationship, &l.Status, &linkedBy, &l.LinkedAt,
		&l.StudentEmail, &sdn, &l.ParentEmail, &pdn,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	l.LinkedBy = linkedBy
	l.StudentDisplay = strPtr(sdn)
	l.ParentDisplay = strPtr(pdn)
	return &l, nil
}

// ListChildrenForParent returns active/pending links for a parent in their home org.
func ListChildrenForParent(ctx context.Context, pool *pgxpool.Pool, parentID, orgID uuid.UUID) ([]Link, error) {
	rows, err := pool.Query(ctx, `
SELECT l.id, l.org_id, l.parent_user_id, l.student_user_id, l.relationship, l.status, l.linked_by, l.linked_at,
       su.email, su.display_name, pu.email, pu.display_name
FROM "user".parent_student_links l
INNER JOIN "user".users su ON su.id = l.student_user_id
INNER JOIN "user".users pu ON pu.id = l.parent_user_id
WHERE l.parent_user_id = $1 AND l.org_id = $2 AND l.status IN `+activeStatuses+`
ORDER BY su.display_name NULLS LAST, su.email
`, parentID, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Link
	for rows.Next() {
		var l Link
		var linkedBy *uuid.UUID
		var sdn, pdn sql.NullString
		if err := rows.Scan(
			&l.ID, &l.OrgID, &l.ParentUserID, &l.StudentUserID, &l.Relationship, &l.Status, &linkedBy, &l.LinkedAt,
			&l.StudentEmail, &sdn, &l.ParentEmail, &pdn,
		); err != nil {
			return nil, err
		}
		l.LinkedBy = linkedBy
		l.StudentDisplay = strPtr(sdn)
		l.ParentDisplay = strPtr(pdn)
		out = append(out, l)
	}
	return out, rows.Err()
}

// UpsertActive creates or reactivates a link (org admin path).
func UpsertActive(ctx context.Context, pool *pgxpool.Pool, orgID, parentID, studentID uuid.UUID, relationship string, linkedBy *uuid.UUID) (*Link, error) {
	if relationship == "" {
		relationship = "parent"
	}
	var l Link
	var linkedByOut *uuid.UUID
	err := pool.QueryRow(ctx, `
INSERT INTO "user".parent_student_links (org_id, parent_user_id, student_user_id, relationship, status, linked_by)
VALUES ($1, $2, $3, $4, 'active', $5)
ON CONFLICT (parent_user_id, student_user_id) DO UPDATE SET
  org_id = EXCLUDED.org_id,
  relationship = EXCLUDED.relationship,
  status = 'active',
  linked_by = EXCLUDED.linked_by,
  linked_at = now()
RETURNING id, org_id, parent_user_id, student_user_id, relationship, status, linked_by, linked_at
`, orgID, parentID, studentID, relationship, linkedBy).Scan(
		&l.ID, &l.OrgID, &l.ParentUserID, &l.StudentUserID, &l.Relationship, &l.Status, &linkedByOut, &l.LinkedAt,
	)
	if err != nil {
		return nil, err
	}
	l.LinkedBy = linkedByOut
	var sdn, pdn sql.NullString
	err = pool.QueryRow(ctx, `
SELECT su.email, su.display_name, pu.email, pu.display_name
FROM "user".users su, "user".users pu
WHERE su.id = $1 AND pu.id = $2
`, studentID, parentID).Scan(&l.StudentEmail, &sdn, &l.ParentEmail, &pdn)
	if err != nil {
		return nil, err
	}
	l.StudentDisplay = strPtr(sdn)
	l.ParentDisplay = strPtr(pdn)
	return &l, nil
}

// Revoke sets status to revoked for a link in org.
func Revoke(ctx context.Context, pool *pgxpool.Pool, orgID, linkID uuid.UUID) (bool, error) {
	tag, err := pool.Exec(ctx, `
UPDATE "user".parent_student_links
SET status = 'revoked'
WHERE id = $1 AND org_id = $2 AND status <> 'revoked'
`, linkID, orgID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// ListByOrg returns recent links for admin UI (includes revoked for audit; caller may filter).
func ListByOrg(ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID, limit int) ([]Link, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := pool.Query(ctx, `
SELECT l.id, l.org_id, l.parent_user_id, l.student_user_id, l.relationship, l.status, l.linked_by, l.linked_at,
       su.email, su.display_name, pu.email, pu.display_name
FROM "user".parent_student_links l
INNER JOIN "user".users su ON su.id = l.student_user_id
INNER JOIN "user".users pu ON pu.id = l.parent_user_id
WHERE l.org_id = $1
ORDER BY l.linked_at DESC
LIMIT $2
`, orgID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Link
	for rows.Next() {
		var l Link
		var linkedBy *uuid.UUID
		var sdn, pdn sql.NullString
		if err := rows.Scan(
			&l.ID, &l.OrgID, &l.ParentUserID, &l.StudentUserID, &l.Relationship, &l.Status, &linkedBy, &l.LinkedAt,
			&l.StudentEmail, &sdn, &l.ParentEmail, &pdn,
		); err != nil {
			return nil, err
		}
		l.LinkedBy = linkedBy
		l.StudentDisplay = strPtr(sdn)
		l.ParentDisplay = strPtr(pdn)
		out = append(out, l)
	}
	return out, rows.Err()
}
