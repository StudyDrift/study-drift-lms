package notificationsinbox

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Row is one in-app notification.
type Row struct {
	ID        uuid.UUID `json:"id"`
	UserID    uuid.UUID `json:"userId"`
	EventType string    `json:"eventType"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	ActionURL string    `json:"actionUrl,omitempty"`
	IsRead    bool      `json:"isRead"`
	CreatedAt time.Time `json:"createdAt"`
}

// Insert creates a new in-app notification and returns its id.
func Insert(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, eventType, title, body, actionURL string) (uuid.UUID, error) {
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
INSERT INTO settings.notifications (user_id, event_type, title, body, action_url)
VALUES ($1, $2, $3, $4, NULLIF($5,''))
RETURNING id
`, userID, eventType, title, body, actionURL).Scan(&id)
	return id, err
}

// List returns paginated notifications for a user, newest first.
func List(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, limit, offset int) ([]Row, error) {
	if limit <= 0 {
		limit = 25
	}
	rows, err := pool.Query(ctx, `
SELECT id, user_id, event_type, title, body, COALESCE(action_url,''), is_read, created_at
FROM settings.notifications
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3
`, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Row
	for rows.Next() {
		var r Row
		if err := rows.Scan(&r.ID, &r.UserID, &r.EventType, &r.Title, &r.Body, &r.ActionURL, &r.IsRead, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// UnreadCount returns the number of unread notifications for a user.
func UnreadCount(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (int, error) {
	var n int
	err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM settings.notifications WHERE user_id=$1 AND is_read=false`, userID).Scan(&n)
	return n, err
}

// MarkRead marks one notification as read.
func MarkRead(ctx context.Context, pool *pgxpool.Pool, id, userID uuid.UUID) error {
	_, err := pool.Exec(ctx, `UPDATE settings.notifications SET is_read=true WHERE id=$1 AND user_id=$2`, id, userID)
	return err
}

// MarkAllRead marks all notifications read for a user.
func MarkAllRead(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) error {
	_, err := pool.Exec(ctx, `UPDATE settings.notifications SET is_read=true WHERE user_id=$1 AND is_read=false`, userID)
	return err
}
