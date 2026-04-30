package rbac

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server/internal/authz"
)

// ValidatePermissionString enforces the four-segment form used by the legacy API.
func ValidatePermissionString(raw string) error {
	s := strings.TrimSpace(raw)
	parts := strings.Split(s, ":")
	if len(parts) != 4 {
		return errors.New("permission must have exactly four segments: scope:area:function:action (wildcards use *)")
	}
	for _, p := range parts {
		if strings.TrimSpace(p) == "" {
			return errors.New("each segment must be non-empty (use * for a wildcard)")
		}
	}
	return nil
}

// UserHasPermission is parity with server/src/repos/rbac.rs::user_has_permission: compares
// granted strings (with catalog expansion) to required using wildcard matching.
func UserHasPermission(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, required string) (bool, error) {
	if err := ValidatePermissionString(required); err != nil {
		return false, err
	}
	grants, err := ListGrantedPermissionStrings(ctx, pool, userID)
	if err != nil {
		return false, err
	}
	return authz.AnyGrantMatch(grants, required), nil
}
