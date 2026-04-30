package oidc

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FlowStateRow is a row deleted from settings.oidc_flow_state after a successful take.
type FlowStateRow struct {
	Nonce           string
	CodeVerifier    string
	Provider        string
	CustomConfigID  *uuid.UUID
	ForUserID       *uuid.UUID
	NextPath        *string
}

// DeleteStaleFlowState removes flow rows older than 10 minutes.
func DeleteStaleFlowState(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `DELETE FROM settings.oidc_flow_state WHERE created_at < $1`, time.Now().UTC().Add(-10*time.Minute))
	return err
}

// SaveFlowState stores PKCE + CSRF for an OIDC round trip.
func SaveFlowState(
	ctx context.Context, pool *pgxpool.Pool,
	state, nonce, codeVerifier, provider string,
	customConfigID, forUserID *uuid.UUID,
	nextPath *string,
) error {
	_, err := pool.Exec(ctx, `
INSERT INTO settings.oidc_flow_state (state, nonce, code_verifier, provider, custom_config_id, for_user_id, next_path)
VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		state, nonce, codeVerifier, provider, customConfigID, forUserID, nextPath,
	)
	return err
}

// TakeFlowState atomically reads and removes one flow row by state token, or (nil, nil) if none.
func TakeFlowState(ctx context.Context, pool *pgxpool.Pool, state string) (*FlowStateRow, error) {
	row := pool.QueryRow(ctx, `
DELETE FROM settings.oidc_flow_state
WHERE state = $1
RETURNING nonce, code_verifier, provider, custom_config_id::text, for_user_id::text, next_path`,
		state,
	)
	var r FlowStateRow
	var customID, forUser, next sql.NullString
	if err := row.Scan(
		&r.Nonce, &r.CodeVerifier, &r.Provider, &customID, &forUser, &next,
	); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if customID.Valid && customID.String != "" {
		if u, err := uuid.Parse(customID.String); err == nil {
			r.CustomConfigID = &u
		}
	}
	if forUser.Valid && forUser.String != "" {
		if u, err := uuid.Parse(forUser.String); err == nil {
			r.ForUserID = &u
		}
	}
	if next.Valid {
		s := next.String
		r.NextPath = &s
	}
	return &r, nil
}

// DeleteStaleLinkIntents removes expired link-intent rows.
func DeleteStaleLinkIntents(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `DELETE FROM settings.oidc_link_intents WHERE expires_at < NOW()`)
	return err
}
