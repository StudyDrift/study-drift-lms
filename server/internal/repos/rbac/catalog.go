package rbac

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	modelrbac "github.com/lextures/lextures/server/internal/models/rbac"
)

// IsUniqueViolation reports a Postgres 23505 unique_violation (Rust maps this to "already exists" input errors).
func IsUniqueViolation(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "23505"
}

// ListPermissions returns all permissions ordered by permission_string.
func ListPermissions(ctx context.Context, pool *pgxpool.Pool) ([]modelrbac.Permission, error) {
	rows, err := pool.Query(ctx, `
SELECT id, permission_string, description, created_at
FROM "user".permissions
ORDER BY permission_string ASC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAllPermissions(rows)
}

func scanAllPermissions(rows pgx.Rows) ([]modelrbac.Permission, error) {
	var out []modelrbac.Permission
	for rows.Next() {
		var p modelrbac.Permission
		if err := rows.Scan(&p.ID, &p.PermissionString, &p.Description, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// CreatePermission inserts a permission row.
func CreatePermission(ctx context.Context, pool *pgxpool.Pool, permissionString, description string) (modelrbac.Permission, error) {
	var p modelrbac.Permission
	err := pool.QueryRow(ctx, `
INSERT INTO "user".permissions (permission_string, description)
VALUES ($1, $2)
RETURNING id, permission_string, description, created_at
`, permissionString, description).Scan(&p.ID, &p.PermissionString, &p.Description, &p.CreatedAt)
	if err != nil {
		return modelrbac.Permission{}, err
	}
	return p, nil
}

// PatchPermission updates a permission’s description.
func PatchPermission(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, description string) (*modelrbac.Permission, error) {
	var p modelrbac.Permission
	err := pool.QueryRow(ctx, `
UPDATE "user".permissions
SET description = $2
WHERE id = $1
RETURNING id, permission_string, description, created_at
`, id, description).Scan(&p.ID, &p.PermissionString, &p.Description, &p.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

// DeletePermission removes a permission by id.
func DeletePermission(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (bool, error) {
	tag, err := pool.Exec(ctx, `DELETE FROM "user".permissions WHERE id = $1`, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// ListRolesWithPermissions returns every app role with its permissions (same ordering as Rust).
func ListRolesWithPermissions(ctx context.Context, pool *pgxpool.Pool) ([]modelrbac.RoleWithPermissions, error) {
	roles, err := listAppRoles(ctx, pool)
	if err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, `
SELECT rp.role_id, p.id, p.permission_string, p.description, p.created_at
FROM "user".rbac_role_permissions rp
INNER JOIN "user".permissions p ON p.id = rp.permission_id
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byRole := make(map[uuid.UUID][]modelrbac.Permission)
	for rows.Next() {
		var roleID uuid.UUID
		var perm modelrbac.Permission
		if err := rows.Scan(&roleID, &perm.ID, &perm.PermissionString, &perm.Description, &perm.CreatedAt); err != nil {
			return nil, err
		}
		byRole[roleID] = append(byRole[roleID], perm)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for id := range byRole {
		slice := byRole[id]
		sort.Slice(slice, func(i, j int) bool {
			return slice[i].PermissionString < slice[j].PermissionString
		})
		byRole[id] = slice
	}
	out := make([]modelrbac.RoleWithPermissions, 0, len(roles))
	for _, role := range roles {
		perms := byRole[role.ID]
		if perms == nil {
			perms = []modelrbac.Permission{}
		}
		out = append(out, modelrbac.RoleWithPermissions{AppRole: role, Permissions: perms})
	}
	return out, nil
}

func listAppRoles(ctx context.Context, pool *pgxpool.Pool) ([]modelrbac.AppRole, error) {
	rows, err := pool.Query(ctx, `
SELECT id, name, description, scope, created_at
FROM "user".app_roles
ORDER BY name ASC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []modelrbac.AppRole
	for rows.Next() {
		var r modelrbac.AppRole
		if err := rows.Scan(&r.ID, &r.Name, &r.Description, &r.Scope, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// CreateRole inserts an app role.
func CreateRole(ctx context.Context, pool *pgxpool.Pool, name, description, scope string) (modelrbac.AppRole, error) {
	var r modelrbac.AppRole
	err := pool.QueryRow(ctx, `
INSERT INTO "user".app_roles (name, description, scope)
VALUES ($1, $2, $3)
RETURNING id, name, description, scope, created_at
`, name, description, scope).Scan(&r.ID, &r.Name, &r.Description, &r.Scope, &r.CreatedAt)
	if err != nil {
		return modelrbac.AppRole{}, err
	}
	return r, nil
}

// PatchRole updates an app role.
func PatchRole(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, name, description, scope string) (*modelrbac.AppRole, error) {
	var r modelrbac.AppRole
	err := pool.QueryRow(ctx, `
UPDATE "user".app_roles
SET name = $2, description = $3, scope = $4
WHERE id = $1
RETURNING id, name, description, scope, created_at
`, id, name, description, scope).Scan(&r.ID, &r.Name, &r.Description, &r.Scope, &r.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

// DeleteRole removes a role.
func DeleteRole(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (bool, error) {
	tag, err := pool.Exec(ctx, `DELETE FROM "user".app_roles WHERE id = $1`, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// SetRolePermissions replaces a role’s permission links (deduped, in a transaction).
func SetRolePermissions(ctx context.Context, pool *pgxpool.Pool, roleID uuid.UUID, permissionIDs []uuid.UUID) error {
	uniq := append([]uuid.UUID(nil), permissionIDs...)
	sort.Slice(uniq, func(i, j int) bool { return uniq[i].String() < uniq[j].String() })
	if len(uniq) > 0 {
		w := 1
		for r := 1; r < len(uniq); r++ {
			if uniq[r] != uniq[r-1] {
				uniq[w] = uniq[r]
				w++
			}
		}
		uniq = uniq[:w]
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM "user".rbac_role_permissions WHERE role_id = $1`, roleID); err != nil {
		return err
	}
	for _, pid := range uniq {
		if _, err := tx.Exec(ctx, `
INSERT INTO "user".rbac_role_permissions (role_id, permission_id)
VALUES ($1, $2)
`, roleID, pid); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// RoleExists returns true if an app role id exists.
func RoleExists(ctx context.Context, pool *pgxpool.Pool, roleID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM "user".app_roles WHERE id = $1)`, roleID).Scan(&ok)
	return ok, err
}

// UserExists returns true if a user id exists in public (schema) users — match Rust: schema::USERS
func UserExists(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM "user".users WHERE id = $1)`, userID).Scan(&ok)
	return ok, err
}

// GetRoleWithPermissions returns one role and its permissions (for PUT …/permissions).
func GetRoleWithPermissions(ctx context.Context, pool *pgxpool.Pool, roleID uuid.UUID) (*modelrbac.RoleWithPermissions, error) {
	var r modelrbac.AppRole
	err := pool.QueryRow(ctx, `
SELECT id, name, description, scope, created_at
FROM "user".app_roles
WHERE id = $1
`, roleID).Scan(&r.ID, &r.Name, &r.Description, &r.Scope, &r.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	rows, err := pool.Query(ctx, `
SELECT p.id, p.permission_string, p.description, p.created_at
FROM "user".rbac_role_permissions rp
INNER JOIN "user".permissions p ON p.id = rp.permission_id
WHERE rp.role_id = $1
ORDER BY p.permission_string ASC
`, roleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var perms []modelrbac.Permission
	for rows.Next() {
		var p modelrbac.Permission
		if err := rows.Scan(&p.ID, &p.PermissionString, &p.Description, &p.CreatedAt); err != nil {
			return nil, err
		}
		perms = append(perms, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if perms == nil {
		perms = []modelrbac.Permission{}
	}
	return &modelrbac.RoleWithPermissions{AppRole: r, Permissions: perms}, nil
}

// ListUsersInRole returns users that have the role, ordered by lower(email).
func ListUsersInRole(ctx context.Context, pool *pgxpool.Pool, roleID uuid.UUID) ([]modelrbac.UserBrief, error) {
	rows, err := pool.Query(ctx, `
SELECT u.id, u.email, u.display_name, u.sid
FROM "user".users u
INNER JOIN "user".user_app_roles uar ON uar.user_id = u.id
WHERE uar.role_id = $1
ORDER BY LOWER(u.email) ASC
`, roleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanUserBriefs(rows)
}

// ListUsersEligibleForRole returns users not in the role, with optional q filter, limit 200.
func ListUsersEligibleForRole(ctx context.Context, pool *pgxpool.Pool, roleID uuid.UUID, q *string) ([]modelrbac.UserBrief, error) {
	pattern := "%"
	if q != nil {
		s := strings.TrimSpace(*q)
		if s != "" {
			pattern = "%" + s + "%"
		}
	}
	rows, err := pool.Query(ctx, `
SELECT u.id, u.email, u.display_name, u.sid
FROM "user".users u
WHERE NOT EXISTS (
	SELECT 1 FROM "user".user_app_roles uar
	WHERE uar.user_id = u.id AND uar.role_id = $1
)
AND (
	$2::text = '%'
	OR u.email ILIKE $2
	OR COALESCE(u.display_name, '') ILIKE $2
	OR COALESCE(u.sid, '') ILIKE $2
)
ORDER BY LOWER(u.email) ASC
LIMIT 200
`, roleID, pattern)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanUserBriefs(rows)
}

func scanUserBriefs(rows pgx.Rows) ([]modelrbac.UserBrief, error) {
	var out []modelrbac.UserBrief
	for rows.Next() {
		var b modelrbac.UserBrief
		var dn, sid sql.NullString
		if err := rows.Scan(&b.ID, &b.Email, &dn, &sid); err != nil {
			return nil, err
		}
		if dn.Valid {
			s := dn.String
			b.DisplayName = &s
		}
		if sid.Valid {
			s := sid.String
			b.Sid = &s
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// AddUserToRole links a user to a role.
func AddUserToRole(ctx context.Context, pool *pgxpool.Pool, roleID, userID uuid.UUID) error {
	_, err := pool.Exec(ctx, `
INSERT INTO "user".user_app_roles (user_id, role_id)
VALUES ($1, $2)
ON CONFLICT (user_id, role_id) DO NOTHING
`, userID, roleID)
	return err
}

// RemoveUserFromRole unlinks a user; returns true if a row was deleted.
func RemoveUserFromRole(ctx context.Context, pool *pgxpool.Pool, roleID, userID uuid.UUID) (bool, error) {
	tag, err := pool.Exec(ctx, `DELETE FROM "user".user_app_roles WHERE user_id = $1 AND role_id = $2`, userID, roleID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
