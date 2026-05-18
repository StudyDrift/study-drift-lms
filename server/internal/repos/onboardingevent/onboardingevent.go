// Package onboardingevent stores anonymous onboarding funnel events.
// It has no foreign keys and no read path — write-only from the public endpoint.
package onboardingevent

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Event holds one onboarding funnel record. All pointer fields are optional.
type Event struct {
	Program      string
	SchoolName   *string
	IPAddress    *string
	Country      *string
	UserAgent    *string
	Referrer     *string
	Language     *string
	Timezone     *string
	ScreenWidth  *int32
	ScreenHeight *int32
}

// Insert writes a single event row. Callers should ignore errors so that DB
// issues never surface to unauthenticated clients.
func Insert(ctx context.Context, db *pgxpool.Pool, e Event) error {
	_, err := db.Exec(ctx, `
		INSERT INTO onboarding_events
			(program, school_name, ip_address, country, user_agent, referrer, language, timezone, screen_width, screen_height)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, e.Program, e.SchoolName, e.IPAddress, e.Country, e.UserAgent, e.Referrer, e.Language, e.Timezone, e.ScreenWidth, e.ScreenHeight)
	return err
}
