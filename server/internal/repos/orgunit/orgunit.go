// Package orgunit provides tenant.org_units CRUD and subtree queries (plan 5.2).
package orgunit

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server/internal/repos/orgrolegrant"
)

// ValidUnitTypes for API validation.
var ValidUnitTypes = map[string]struct{}{
	"district": {}, "school": {}, "college": {}, "department": {}, "other": {},
}

// Row is a tenant.org_units row for APIs.
type Row struct {
	ID             uuid.UUID
	OrgID          uuid.UUID
	ParentUnitID   *uuid.UUID
	Name           string
	UnitType       string
	Status         string
	Metadata       []byte
	CreatedAt      time.Time
	UpdatedAt      time.Time
	ChildCourseCnt int64
}

// TreeNode is a nested unit for GET .../tree.
type TreeNode struct {
	ID               string          `json:"id"`
	Name             string          `json:"name"`
	UnitType         string          `json:"unitType"`
	Status           string          `json:"status"`
	Metadata         json.RawMessage `json:"metadata"`
	CreatedAt        string          `json:"createdAt"`
	UpdatedAt        string          `json:"updatedAt"`
	ChildCourseCount int64           `json:"childCourseCount"`
	Children         []TreeNode      `json:"children"`
}

func rowToTreeNode(r Row) TreeNode {
	meta := r.Metadata
	if len(meta) == 0 {
		meta = []byte("{}")
	}
	return TreeNode{
		ID:               r.ID.String(),
		Name:             r.Name,
		UnitType:         r.UnitType,
		Status:           r.Status,
		Metadata:         meta,
		CreatedAt:        r.CreatedAt.UTC().Format(time.RFC3339Nano),
		UpdatedAt:        r.UpdatedAt.UTC().Format(time.RFC3339Nano),
		ChildCourseCount: r.ChildCourseCnt,
		Children:         []TreeNode{},
	}
}

// BuildTree builds a forest from flat rows (parent before child not required).
func BuildTree(rows []Row) []TreeNode {
	byParent := make(map[uuid.UUID][]Row)
	var roots []Row
	for _, r := range rows {
		if r.ParentUnitID == nil {
			roots = append(roots, r)
		} else {
			pid := *r.ParentUnitID
			byParent[pid] = append(byParent[pid], r)
		}
	}
	var build func(Row) TreeNode
	build = func(r Row) TreeNode {
		n := rowToTreeNode(r)
		for _, k := range byParent[r.ID] {
			n.Children = append(n.Children, build(k))
		}
		return n
	}
	out := make([]TreeNode, 0, len(roots))
	for _, r := range roots {
		out = append(out, build(r))
	}
	return out
}

// ListOrgUnitAdminScopes returns org_unit ids the user is scoped to via Org Unit Admin role.
func ListOrgUnitAdminScopes(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := pool.Query(ctx, `
SELECT DISTINCT uor.org_unit_id
FROM "user".user_org_unit_roles uor
INNER JOIN "user".app_roles ar ON ar.id = uor.role_id AND ar.name = 'Org Unit Admin'
WHERE uor.user_id = $1
`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// SubtreeIDs returns unit id and all descendant ids (recursive CTE).
func SubtreeIDs(ctx context.Context, pool *pgxpool.Pool, rootUnitID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := pool.Query(ctx, `
WITH RECURSIVE t AS (
  SELECT id FROM tenant.org_units WHERE id = $1
  UNION ALL
  SELECT c.id FROM tenant.org_units c
  INNER JOIN t ON c.parent_unit_id = t.id
)
SELECT id FROM t
`, rootUnitID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ListSubtreeIDsForUserOrgUnitAdmin returns merged subtree ids for all unit-admin scopes of the user in orgID
// (legacy user_org_unit_roles + plan 5.8 org_role_grants org_unit_admin).
func ListSubtreeIDsForUserOrgUnitAdmin(ctx context.Context, pool *pgxpool.Pool, userID, orgID uuid.UUID) ([]uuid.UUID, error) {
	scopes, err := ListOrgUnitAdminScopes(ctx, pool, userID)
	if err != nil {
		return nil, err
	}
	grantRoots, err := orgrolegrant.ListOrgUnitAdminRootUnitIDs(ctx, pool, userID, orgID)
	if err != nil {
		return nil, err
	}
	scopeSeen := make(map[uuid.UUID]struct{})
	var uniqScopes []uuid.UUID
	for _, id := range scopes {
		if _, ok := scopeSeen[id]; ok {
			continue
		}
		scopeSeen[id] = struct{}{}
		uniqScopes = append(uniqScopes, id)
	}
	for _, id := range grantRoots {
		if _, ok := scopeSeen[id]; ok {
			continue
		}
		scopeSeen[id] = struct{}{}
		uniqScopes = append(uniqScopes, id)
	}
	scopes = uniqScopes
	if len(scopes) == 0 {
		return nil, nil
	}
	seen := make(map[uuid.UUID]struct{})
	var merged []uuid.UUID
	for _, sid := range scopes {
		var scopeOrg uuid.UUID
		err := pool.QueryRow(ctx, `SELECT org_id FROM tenant.org_units WHERE id = $1`, sid).Scan(&scopeOrg)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if scopeOrg != orgID {
			continue
		}
		ids, err := SubtreeIDs(ctx, pool, sid)
		if err != nil {
			return nil, err
		}
		for _, id := range ids {
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			merged = append(merged, id)
		}
	}
	return merged, nil
}

const selectRow = `
SELECT u.id, u.org_id, u.parent_unit_id, u.name, u.unit_type, u.status, u.metadata, u.created_at, u.updated_at,
       COALESCE((
         SELECT COUNT(*)::bigint FROM course.courses c
         WHERE c.org_unit_id = u.id
       ), 0) AS child_course_cnt
FROM tenant.org_units u
`

// ListByOrg returns all units for an org (flat), ordered by parent then name.
func ListByOrg(ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID) ([]Row, error) {
	rows, err := pool.Query(ctx, selectRow+`
WHERE u.org_id = $1
ORDER BY u.parent_unit_id NULLS FIRST, u.name ASC
`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRows(rows)
}

func scanRows(rows pgx.Rows) ([]Row, error) {
	var out []Row
	for rows.Next() {
		var r Row
		var parent *uuid.UUID
		if err := rows.Scan(&r.ID, &r.OrgID, &parent, &r.Name, &r.UnitType, &r.Status, &r.Metadata, &r.CreatedAt, &r.UpdatedAt, &r.ChildCourseCnt); err != nil {
			return nil, err
		}
		r.ParentUnitID = parent
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetByID loads one unit or nil.
func GetByID(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (*Row, error) {
	row := pool.QueryRow(ctx, selectRow+`WHERE u.id = $1`, id)
	var r Row
	var parent *uuid.UUID
	if err := row.Scan(&r.ID, &r.OrgID, &parent, &r.Name, &r.UnitType, &r.Status, &r.Metadata, &r.CreatedAt, &r.UpdatedAt, &r.ChildCourseCnt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	r.ParentUnitID = parent
	return &r, nil
}

// Create inserts a unit; validates parent org match.
func Create(ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID, parentID *uuid.UUID, name, unitType string, metadata []byte) (*Row, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("name required")
	}
	if _, ok := ValidUnitTypes[unitType]; !ok {
		return nil, fmt.Errorf("invalid unit_type")
	}
	if len(metadata) == 0 {
		metadata = []byte("{}")
	}
	if parentID != nil {
		p, err := GetByID(ctx, pool, *parentID)
		if err != nil {
			return nil, err
		}
		if p == nil {
			return nil, fmt.Errorf("parent not found")
		}
		if p.OrgID != orgID {
			return nil, fmt.Errorf("parent org mismatch")
		}
	}
	var r Row
	var parent *uuid.UUID
	err := pool.QueryRow(ctx, `
INSERT INTO tenant.org_units (org_id, parent_unit_id, name, unit_type, status, metadata)
VALUES ($1, $2, $3, $4, 'active', $5::jsonb)
RETURNING id, org_id, parent_unit_id, name, unit_type, status, metadata, created_at, updated_at
`, orgID, parentID, name, unitType, metadata).Scan(
		&r.ID, &r.OrgID, &parent, &r.Name, &r.UnitType, &r.Status, &r.Metadata, &r.CreatedAt, &r.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	r.ParentUnitID = parent
	r.ChildCourseCnt = 0
	return &r, nil
}

// Update patches name, unit_type, status, metadata; optionally reparent (global admin only enforced at handler).
func Update(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, name *string, unitType *string, status *string, metadata *[]byte, parentID **uuid.UUID) (*Row, error) {
	cur, err := GetByID(ctx, pool, id)
	if err != nil {
		return nil, err
	}
	if cur == nil {
		return nil, nil
	}
	n := cur.Name
	ut := cur.UnitType
	st := cur.Status
	meta := cur.Metadata
	parent := cur.ParentUnitID
	if name != nil {
		s := strings.TrimSpace(*name)
		if s == "" {
			return nil, fmt.Errorf("name required")
		}
		n = s
	}
	if unitType != nil {
		if _, ok := ValidUnitTypes[*unitType]; !ok {
			return nil, fmt.Errorf("invalid unit_type")
		}
		ut = *unitType
	}
	if status != nil {
		ss := strings.TrimSpace(*status)
		if ss != "active" && ss != "archived" {
			return nil, fmt.Errorf("invalid status")
		}
		st = ss
	}
	if metadata != nil {
		meta = *metadata
		if len(meta) == 0 {
			meta = []byte("{}")
		}
	}
	if parentID != nil {
		p := *parentID
		if p == nil {
			parent = nil
		} else {
			prow, err := GetByID(ctx, pool, *p)
			if err != nil {
				return nil, err
			}
			if prow == nil {
				return nil, fmt.Errorf("parent not found")
			}
			if prow.OrgID != cur.OrgID {
				return nil, fmt.Errorf("parent org mismatch")
			}
			if *p == id {
				return nil, fmt.Errorf("cannot set parent to self")
			}
			// Prevent cycles: new parent must not be in subtree of id
			desc, err := SubtreeIDs(ctx, pool, id)
			if err != nil {
				return nil, err
			}
			for _, d := range desc {
				if d == *p {
					return nil, fmt.Errorf("cannot move under descendant")
				}
			}
			parent = p
		}
	}
	var outRow Row
	var parentOut *uuid.UUID
	err = pool.QueryRow(ctx, `
UPDATE tenant.org_units
SET name = $2, unit_type = $3, status = $4, metadata = $5::jsonb, parent_unit_id = $6, updated_at = NOW()
WHERE id = $1
RETURNING id, org_id, parent_unit_id, name, unit_type, status, metadata, created_at, updated_at
`, id, n, ut, st, meta, parent).Scan(
		&outRow.ID, &outRow.OrgID, &parentOut, &outRow.Name, &outRow.UnitType, &outRow.Status, &outRow.Metadata, &outRow.CreatedAt, &outRow.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	outRow.ParentUnitID = parentOut
	_ = pool.QueryRow(ctx, `
SELECT COALESCE((SELECT COUNT(*)::bigint FROM course.courses c WHERE c.org_unit_id = $1), 0)
`, id).Scan(&outRow.ChildCourseCnt)
	return &outRow, nil
}

// DeleteBlockedReason returns non-empty message if delete is blocked.
func DeleteBlockedReason(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (string, error) {
	var childUnits int64
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM tenant.org_units WHERE parent_unit_id = $1`, id).Scan(&childUnits); err != nil {
		return "", err
	}
	if childUnits > 0 {
		return fmt.Sprintf("unit has %d child unit(s); remove or reassign them first", childUnits), nil
	}
	var courses int64
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM course.courses WHERE org_unit_id = $1`, id).Scan(&courses); err != nil {
		return "", err
	}
	if courses > 0 {
		return fmt.Sprintf("unit has %d course(s) assigned; reassign or remove courses first", courses), nil
	}
	return "", nil
}

// Delete removes a unit if not blocked.
func Delete(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) error {
	reason, err := DeleteBlockedReason(ctx, pool, id)
	if err != nil {
		return err
	}
	if reason != "" {
		return fmt.Errorf("blocked: %s", reason)
	}
	tag, err := pool.Exec(ctx, `DELETE FROM tenant.org_units WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// AssignOrgUnitAdmin links a user to Org Unit Admin for a specific unit.
func AssignOrgUnitAdmin(ctx context.Context, pool *pgxpool.Pool, userID, unitID uuid.UUID) error {
	var roleID uuid.UUID
	err := pool.QueryRow(ctx, `SELECT id FROM "user".app_roles WHERE name = 'Org Unit Admin' LIMIT 1`).Scan(&roleID)
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `
INSERT INTO "user".user_org_unit_roles (user_id, role_id, org_unit_id)
VALUES ($1, $2, $3)
ON CONFLICT (user_id, role_id, org_unit_id) DO NOTHING
`, userID, roleID, unitID)
	return err
}
