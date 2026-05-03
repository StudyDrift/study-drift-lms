// Package sessionversion reads and bumps users.jwt_session_version for JWT invalidation.
package sessionversion

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Read returns users.jwt_session_version for API JWT validation.
func Read(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (int64, error) {
	var v int64
	err := pool.QueryRow(ctx, `SELECT jwt_session_version FROM "user".users WHERE id = $1`, userID).Scan(&v)
	return v, err
}

// Bump increments jwt_session_version and returns the new value (invalidates outstanding login JWTs).
func Bump(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (int64, error) {
	var v int64
	err := pool.QueryRow(ctx, `
UPDATE "user".users SET jwt_session_version = jwt_session_version + 1 WHERE id = $1
RETURNING jwt_session_version
`, userID).Scan(&v)
	return v, err
}
