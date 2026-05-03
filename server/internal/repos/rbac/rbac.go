// Package rbac is a minimal port of server/src/repos/rbac.rs.
package rbac

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AssignUserRoleByName links the user to a named app role if the role exists.
func AssignUserRoleByName(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, roleName string) error {
	var roleID string
	err := pool.QueryRow(ctx, `SELECT id::text FROM "user".app_roles WHERE name = $1`, roleName).Scan(&roleID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `
INSERT INTO "user".user_app_roles (user_id, role_id)
VALUES ($1::uuid, $2::uuid)
ON CONFLICT (user_id, role_id) DO NOTHING
`, userID.String(), roleID)
	return err
}

// AssignUserRoleByNameTx links the user to a named app role inside a transaction.
func AssignUserRoleByNameTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, roleName string) error {
	var roleID string
	err := tx.QueryRow(ctx, `SELECT id::text FROM "user".app_roles WHERE name = $1`, roleName).Scan(&roleID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
INSERT INTO "user".user_app_roles (user_id, role_id)
VALUES ($1::uuid, $2::uuid)
ON CONFLICT (user_id, role_id) DO NOTHING
`, userID.String(), roleID)
	return err
}
