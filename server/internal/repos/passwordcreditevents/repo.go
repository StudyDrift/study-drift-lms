package passwordcreditevents

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// EventKind is stored in password_credential_events.event_kind.
type EventKind string

const (
	KindSignup          EventKind = "signup"
	KindPasswordChange  EventKind = "password_change"
	KindPasswordReset   EventKind = "password_reset"
)

// Insert records a password-related event with HIBP outcome (never stores the password).
func Insert(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, kind EventKind, breachFound, hibpAvailable bool) error {
	const q = `
INSERT INTO "user".password_credential_events (user_id, event_kind, breach_found, hibp_available)
VALUES ($1::uuid, $2, $3, $4)`
	_, err := pool.Exec(ctx, q, userID.String(), string(kind), breachFound, hibpAvailable)
	return err
}

// LatestForUser returns the most recent event for a user and kind, or nil.
func LatestForUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, kind EventKind) (*struct {
	BreachFound   bool
	HIBPAvailable bool
}, error) {
	const q = `
SELECT breach_found, hibp_available
FROM "user".password_credential_events
WHERE user_id = $1::uuid AND event_kind = $2
ORDER BY occurred_at DESC
LIMIT 1`
	var breach, hibp bool
	err := pool.QueryRow(ctx, q, userID.String(), string(kind)).Scan(&breach, &hibp)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &struct {
		BreachFound   bool
		HIBPAvailable bool
	}{BreachFound: breach, HIBPAvailable: hibp}, nil
}
