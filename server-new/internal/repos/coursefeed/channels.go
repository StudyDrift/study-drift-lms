package coursefeed

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ChannelPublic struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	SortOrder int       `json:"sortOrder"`
	CreatedAt time.Time `json:"createdAt"`
}

func ensureDefaultChannel(ctx context.Context, pool *pgxpool.Pool, courseID, createdBy uuid.UUID) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO course.feed_channels (course_id, name, sort_order, created_by_user_id)
		SELECT $1, $2, 0, $3
		WHERE NOT EXISTS (SELECT 1 FROM course.feed_channels WHERE course_id = $1)
	`, courseID, "general", createdBy)
	return err
}

func ListChannels(ctx context.Context, pool *pgxpool.Pool, courseID, viewerID uuid.UUID) ([]ChannelPublic, error) {
	if err := ensureDefaultChannel(ctx, pool, courseID, viewerID); err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, `
		SELECT id, name, sort_order, created_at
		FROM course.feed_channels
		WHERE course_id = $1
		ORDER BY sort_order ASC, created_at ASC
	`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChannelPublic{}
	for rows.Next() {
		var c ChannelPublic
		if err := rows.Scan(&c.ID, &c.Name, &c.SortOrder, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func CreateChannel(ctx context.Context, pool *pgxpool.Pool, courseID, viewerID uuid.UUID, name string) (*ChannelPublic, error) {
	if err := ensureDefaultChannel(ctx, pool, courseID, viewerID); err != nil {
		return nil, err
	}
	var next int
	if err := pool.QueryRow(ctx, `SELECT COALESCE(MAX(sort_order), 0) + 1 FROM course.feed_channels WHERE course_id = $1`, courseID).Scan(&next); err != nil {
		return nil, err
	}
	var c ChannelPublic
	if err := pool.QueryRow(ctx, `
		INSERT INTO course.feed_channels (course_id, name, sort_order, created_by_user_id)
		VALUES ($1, $2, $3, $4)
		RETURNING id, name, sort_order, created_at
	`, courseID, name, next, viewerID).Scan(&c.ID, &c.Name, &c.SortOrder, &c.CreatedAt); err != nil {
		return nil, err
	}
	return &c, nil
}

