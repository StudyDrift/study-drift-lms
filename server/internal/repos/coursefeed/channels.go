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

// EnsureGroupDefaultChannel creates a "general" channel for the group if none exists.
func EnsureGroupDefaultChannel(ctx context.Context, pool *pgxpool.Pool, courseID, groupID, createdBy uuid.UUID) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO course.feed_channels (course_id, group_id, name, sort_order, created_by_user_id)
		SELECT $1, $2, $3, 0, $4
		WHERE NOT EXISTS (
			SELECT 1 FROM course.feed_channels WHERE course_id = $1 AND group_id = $2
		)
	`, courseID, groupID, "general", createdBy)
	return err
}

// ListGroupChannels returns all channels for the given group, ensuring a default exists.
func ListGroupChannels(ctx context.Context, pool *pgxpool.Pool, courseID, groupID, viewerID uuid.UUID) ([]ChannelPublic, error) {
	if err := EnsureGroupDefaultChannel(ctx, pool, courseID, groupID, viewerID); err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, `
		SELECT id, name, sort_order, created_at
		FROM course.feed_channels
		WHERE course_id = $1 AND group_id = $2
		ORDER BY sort_order ASC, created_at ASC
	`, courseID, groupID)
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

// CreateGroupChannel creates a new feed channel scoped to the given group.
func CreateGroupChannel(ctx context.Context, pool *pgxpool.Pool, courseID, groupID, viewerID uuid.UUID, name string) (*ChannelPublic, error) {
	if err := EnsureGroupDefaultChannel(ctx, pool, courseID, groupID, viewerID); err != nil {
		return nil, err
	}
	var next int
	if err := pool.QueryRow(ctx, `SELECT COALESCE(MAX(sort_order), 0) + 1 FROM course.feed_channels WHERE course_id = $1 AND group_id = $2`, courseID, groupID).Scan(&next); err != nil {
		return nil, err
	}
	var c ChannelPublic
	if err := pool.QueryRow(ctx, `
		INSERT INTO course.feed_channels (course_id, group_id, name, sort_order, created_by_user_id)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, name, sort_order, created_at
	`, courseID, groupID, name, next, viewerID).Scan(&c.ID, &c.Name, &c.SortOrder, &c.CreatedAt); err != nil {
		return nil, err
	}
	return &c, nil
}

// GroupChannelBelongsToGroup returns true if the channel belongs to both the course and the group.
func GroupChannelBelongsToGroup(ctx context.Context, pool *pgxpool.Pool, courseID, channelID, groupID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM course.feed_channels
			WHERE id = $1 AND course_id = $2 AND group_id = $3
		)
	`, channelID, courseID, groupID).Scan(&ok)
	if err != nil {
		return false, err
	}
	return ok, nil
}
