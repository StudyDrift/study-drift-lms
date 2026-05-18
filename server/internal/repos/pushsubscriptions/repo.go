package pushsubscriptions

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Row is one push subscription record.
type Row struct {
	ID         uuid.UUID `json:"id"`
	UserID     uuid.UUID `json:"userId"`
	Endpoint   string    `json:"endpoint"`
	P256DHKey  string    `json:"p256dhKey"`
	AuthSecret string    `json:"authSecret"`
	UserAgent  string    `json:"userAgent,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
}

// Insert stores a new push subscription. Returns the assigned id.
func Insert(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, endpoint, p256dh, auth, ua string) (uuid.UUID, error) {
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
INSERT INTO settings.push_subscriptions (user_id, endpoint, p256dh_key, auth_secret, user_agent)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (user_id, endpoint) DO UPDATE SET
  p256dh_key   = EXCLUDED.p256dh_key,
  auth_secret  = EXCLUDED.auth_secret,
  user_agent   = EXCLUDED.user_agent,
  last_used_at = now()
RETURNING id
`, userID, endpoint, p256dh, auth, ua).Scan(&id)
	return id, err
}

// Delete removes a push subscription by id and owner.
func Delete(ctx context.Context, pool *pgxpool.Pool, id, userID uuid.UUID) error {
	_, err := pool.Exec(ctx, `
DELETE FROM settings.push_subscriptions WHERE id = $1 AND user_id = $2
`, id, userID)
	return err
}

// ListForUser returns all active push subscriptions for a user (max 5 per plan NFR).
func ListForUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) ([]Row, error) {
	rows, err := pool.Query(ctx, `
SELECT id, user_id, endpoint, p256dh_key, auth_secret, COALESCE(user_agent,''), created_at
FROM settings.push_subscriptions
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT 5
`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Row
	for rows.Next() {
		var r Row
		if err := rows.Scan(&r.ID, &r.UserID, &r.Endpoint, &r.P256DHKey, &r.AuthSecret, &r.UserAgent, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ListAllForUser returns all active subscriptions for delivery fan-out.
func ListAllForUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) ([]Row, error) {
	return ListForUser(ctx, pool, userID)
}

// MarkUsed updates last_used_at.
func MarkUsed(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) error {
	_, err := pool.Exec(ctx, `UPDATE settings.push_subscriptions SET last_used_at = now() WHERE id = $1`, id)
	return err
}

// DeleteByEndpoint removes a subscription by endpoint (called on HTTP 410 Gone).
func DeleteByEndpoint(ctx context.Context, pool *pgxpool.Pool, endpoint string) error {
	_, err := pool.Exec(ctx, `DELETE FROM settings.push_subscriptions WHERE endpoint = $1`, endpoint)
	return err
}
