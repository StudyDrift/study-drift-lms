package notificationprefs

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server/internal/notificationevents"
)

// Row is one notification preference.
type Row struct {
	EventType    string    `json:"eventType"`
	EmailEnabled bool      `json:"emailEnabled"`
	PushEnabled  bool      `json:"pushEnabled"`
	DigestMode   string    `json:"digestMode"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// ListForUser returns stored preferences, seeding defaults for missing event types.
func ListForUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) ([]Row, error) {
	if err := EnsureDefaults(ctx, pool, userID); err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, `
SELECT event_type, email_enabled, push_enabled, digest_mode, updated_at
FROM settings.notification_preferences
WHERE user_id = $1
ORDER BY event_type
`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Row
	for rows.Next() {
		var r Row
		if err := rows.Scan(&r.EventType, &r.EmailEnabled, &r.PushEnabled, &r.DigestMode, &r.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// EnsureDefaults inserts default rows for any missing event types.
func EnsureDefaults(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) error {
	for _, et := range notificationevents.All {
		_, err := pool.Exec(ctx, `
INSERT INTO settings.notification_preferences (user_id, event_type)
VALUES ($1, $2)
ON CONFLICT (user_id, event_type) DO NOTHING
`, userID, et)
		if err != nil {
			return err
		}
	}
	return nil
}

// Preference is the effective preference for one event type.
type Preference struct {
	EmailEnabled bool
	PushEnabled  bool
	DigestMode   string
}

// Get returns preference for one event (defaults if missing).
func Get(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, eventType string) (Preference, error) {
	if err := EnsureDefaults(ctx, pool, userID); err != nil {
		return Preference{}, err
	}
	var p Preference
	err := pool.QueryRow(ctx, `
SELECT email_enabled, push_enabled, digest_mode
FROM settings.notification_preferences
WHERE user_id = $1 AND event_type = $2
`, userID, eventType).Scan(&p.EmailEnabled, &p.PushEnabled, &p.DigestMode)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Preference{EmailEnabled: true, PushEnabled: true, DigestMode: "instant"}, nil
		}
		return Preference{}, err
	}
	return p, nil
}

// UpsertItem updates one preference row.
func UpsertItem(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, eventType string, emailEnabled, pushEnabled *bool, digestMode *string) error {
	if err := EnsureDefaults(ctx, pool, userID); err != nil {
		return err
	}
	_, err := pool.Exec(ctx, `
INSERT INTO settings.notification_preferences (user_id, event_type, email_enabled, push_enabled, digest_mode, updated_at)
VALUES ($1, $2,
  COALESCE($3, true),
  COALESCE($4, true),
  COALESCE($5, 'instant'),
  now())
ON CONFLICT (user_id, event_type) DO UPDATE SET
  email_enabled = COALESCE($3, settings.notification_preferences.email_enabled),
  push_enabled = COALESCE($4, settings.notification_preferences.push_enabled),
  digest_mode = COALESCE($5, settings.notification_preferences.digest_mode),
  updated_at = now()
`, userID, eventType, emailEnabled, pushEnabled, digestMode)
	return err
}

// SetEmailEnabled sets email_enabled for one event (unsubscribe).
func SetEmailEnabled(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, eventType string, enabled bool) error {
	return UpsertItem(ctx, pool, userID, eventType, &enabled, nil, nil)
}
