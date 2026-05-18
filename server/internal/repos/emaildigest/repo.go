package emaildigest

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Item is one line in a daily digest.
type Item struct {
	EventType   string
	SummaryLine string
	DetailURL   string
}

// Append adds a digest line for a user.
func Append(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, eventType, summaryLine, detailURL string) error {
	_, err := pool.Exec(ctx, `
INSERT INTO settings.email_digest_items (user_id, event_type, summary_line, detail_url)
VALUES ($1, $2, $3, NULLIF($4, ''))
`, userID, eventType, summaryLine, detailURL)
	return err
}

// ListAndClear returns all digest items for a user since the given time and deletes them.
func ListAndClear(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, since time.Time) ([]Item, error) {
	rows, err := pool.Query(ctx, `
DELETE FROM settings.email_digest_items
WHERE user_id = $1 AND created_at >= $2
RETURNING event_type, summary_line, COALESCE(detail_url, '')
`, userID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Item
	for rows.Next() {
		var it Item
		if err := rows.Scan(&it.EventType, &it.SummaryLine, &it.DetailURL); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// UsersWithDigestItems returns user IDs that have pending digest items.
func UsersWithDigestItems(ctx context.Context, pool *pgxpool.Pool) ([]uuid.UUID, error) {
	rows, err := pool.Query(ctx, `
SELECT DISTINCT user_id FROM settings.email_digest_items
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
