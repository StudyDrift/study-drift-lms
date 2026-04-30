package relativeschedule

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	root "github.com/lextures/lextures/server/internal/relativeschedule"
)

// Context is the enrollment-relative schedule anchor pair (re-exported).
type Context = root.Context

// LoadForUser re-exports `internal/relativeschedule.LoadForUser`.
func LoadForUser(ctx context.Context, pool *pgxpool.Pool, courseID, userID uuid.UUID) (*Context, error) {
	return root.LoadForUser(ctx, pool, courseID, userID)
}
