// Package systemprompts reads/writes settings.system_prompts (parity with server/src/repos/system_prompts.rs).
package systemprompts

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Row is one system prompt for admin APIs.
type Row struct {
	Key       string
	Label     string
	Content   string
	UpdatedAt time.Time
}

// ListAll returns all prompts ordered by key.
func ListAll(ctx context.Context, pool *pgxpool.Pool) ([]Row, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	rows, err := pool.Query(ctx, `
SELECT key, label, content, updated_at
FROM settings.system_prompts
ORDER BY key ASC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Row
	for rows.Next() {
		var r Row
		if err := rows.Scan(&r.Key, &r.Label, &r.Content, &r.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if out == nil {
		out = []Row{}
	}
	return out, nil
}

// Update sets content, writes an audit row, and returns the updated row.
func Update(ctx context.Context, pool *pgxpool.Pool, key, content string, savedByUserID uuid.UUID) (*Row, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var r Row
	err = tx.QueryRow(ctx, `
UPDATE settings.system_prompts
SET content = $1, updated_at = NOW()
WHERE key = $2
RETURNING key, label, content, updated_at
`, content, key).Scan(&r.Key, &r.Label, &r.Content, &r.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, pgx.ErrNoRows
		}
		return nil, err
	}
	_, err = tx.Exec(ctx, `
INSERT INTO settings.system_prompts_audit (prompt_key, content, saved_by_user_id, saved_at)
VALUES ($1, $2, $3, NOW())
`, key, content, savedByUserID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &r, nil
}
