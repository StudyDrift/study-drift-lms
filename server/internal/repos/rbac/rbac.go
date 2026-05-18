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

// ProvisioningRoleResult holds the resolved role details from the provisioning map.
type ProvisioningRoleResult struct {
	AppRoleID   uuid.UUID
	AppRoleName string
	AccountType string // "standard" or "parent"
}

// LookupProvisioningRole resolves a provider + external_role to an app role via provisioning_role_map.
// Returns nil when no mapping exists.
func LookupProvisioningRole(ctx context.Context, pool *pgxpool.Pool, provider, externalRole string) (*ProvisioningRoleResult, error) {
	var res ProvisioningRoleResult
	err := pool.QueryRow(ctx, `
SELECT prm.app_role_id, ar.name, prm.account_type
FROM "user".provisioning_role_map prm
JOIN "user".app_roles ar ON ar.id = prm.app_role_id
WHERE prm.provider = $1 AND lower(prm.external_role) = lower($2)
`, provider, externalRole).Scan(&res.AppRoleID, &res.AppRoleName, &res.AccountType)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &res, nil
}

// AssignUserRoleFromProvisioningMap resolves provider+externalRole via provisioning_role_map and assigns the
// resulting app role. Falls back to fallbackRoleName if no mapping exists. Returns the resolved role name.
func AssignUserRoleFromProvisioningMap(
	ctx context.Context, pool *pgxpool.Pool,
	userID uuid.UUID,
	provider, externalRole, fallbackRoleName string,
) (string, error) {
	res, err := LookupProvisioningRole(ctx, pool, provider, externalRole)
	if err != nil {
		return "", err
	}
	if res != nil {
		return res.AppRoleName, AssignUserRoleByName(ctx, pool, userID, res.AppRoleName)
	}
	return fallbackRoleName, AssignUserRoleByName(ctx, pool, userID, fallbackRoleName)
}

// AssignUserRoleFromProvisioningMapTx is the transactional variant of AssignUserRoleFromProvisioningMap.
func AssignUserRoleFromProvisioningMapTx(
	ctx context.Context, tx pgx.Tx,
	userID uuid.UUID,
	provider, externalRole, fallbackRoleName string,
) (string, error) {
	var res ProvisioningRoleResult
	err := tx.QueryRow(ctx, `
SELECT prm.app_role_id, ar.name, prm.account_type
FROM "user".provisioning_role_map prm
JOIN "user".app_roles ar ON ar.id = prm.app_role_id
WHERE prm.provider = $1 AND lower(prm.external_role) = lower($2)
`, provider, externalRole).Scan(&res.AppRoleID, &res.AppRoleName, &res.AccountType)
	if errors.Is(err, pgx.ErrNoRows) {
		return fallbackRoleName, AssignUserRoleByNameTx(ctx, tx, userID, fallbackRoleName)
	}
	if err != nil {
		return "", err
	}
	return res.AppRoleName, AssignUserRoleByNameTx(ctx, tx, userID, res.AppRoleName)
}

// AccountTypeFromProvisioningMap returns the account_type for the given provider+externalRole mapping.
// Returns "standard" when no mapping exists.
func AccountTypeFromProvisioningMap(ctx context.Context, pool *pgxpool.Pool, provider, externalRole string) (string, error) {
	res, err := LookupProvisioningRole(ctx, pool, provider, externalRole)
	if err != nil {
		return "standard", err
	}
	if res != nil {
		return res.AccountType, nil
	}
	return "standard", nil
}
