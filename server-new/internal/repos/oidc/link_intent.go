package oidc

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// InsertLinkIntent stores a short-lived row the browser completes via /auth/oidc/.../login?linkId=.
func InsertLinkIntent(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, provider string, customConfigID *uuid.UUID) (uuid.UUID, error) {
	if pool == nil {
		return uuid.UUID{}, fmt.Errorf("oidc: nil pool")
	}
	id := uuid.New()
	expires := time.Now().UTC().Add(10 * time.Minute)
	_, err := pool.Exec(ctx, `
INSERT INTO settings.oidc_link_intents (id, user_id, provider, custom_config_id, expires_at)
VALUES ($1, $2, $3, $4, $5)
`, id, userID, provider, customConfigID, expires)
	if err != nil {
		return uuid.UUID{}, err
	}
	return id, nil
}

// TakeLinkIntent atomically claims a valid link intent (delete+return) or zero values if missing/expired.
func TakeLinkIntent(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (userID uuid.UUID, provider string, customID *uuid.UUID, ok bool, err error) {
	if pool == nil {
		return uuid.UUID{}, "", nil, false, nil
	}
	var uid uuid.UUID
	var p string
	var cstr sql.NullString
	qerr := pool.QueryRow(ctx, `
DELETE FROM settings.oidc_link_intents
WHERE id = $1 AND expires_at > NOW()
RETURNING user_id, provider, custom_config_id::text`,
		id,
	).Scan(&uid, &p, &cstr)
	if qerr == pgx.ErrNoRows {
		return uuid.UUID{}, "", nil, false, nil
	}
	if qerr != nil {
		return uuid.UUID{}, "", nil, false, qerr
	}
	if cstr.Valid && cstr.String != "" {
		if u, err := uuid.Parse(cstr.String); err == nil {
			customID = &u
		}
	}
	return uid, p, customID, true, nil
}
