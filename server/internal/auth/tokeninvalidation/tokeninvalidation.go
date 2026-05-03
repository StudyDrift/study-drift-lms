// Package tokeninvalidation reads users.token_invalidated_at for JWT validation (plan 4.8).
package tokeninvalidation

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Read returns users.token_invalidated_at or nil when unset.
func Read(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (*time.Time, error) {
	var t *time.Time
	err := pool.QueryRow(ctx, `SELECT token_invalidated_at FROM "user".users WHERE id = $1`, userID).Scan(&t)
	return t, err
}
