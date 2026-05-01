package clever

import (
	"context"
	"database/sql"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FlowStateRow is returned after consuming a Clever OAuth state row.
type FlowStateRow struct {
	CodeVerifier string
	NextPath     *string
}

// DeleteStaleFlowState removes Clever flow rows older than 10 minutes.
func DeleteStaleFlowState(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `DELETE FROM settings.clever_sso_flow_state WHERE created_at < $1`, time.Now().UTC().Add(-10*time.Minute))
	return err
}

// SaveFlowState stores PKCE verifier for a Clever round trip.
func SaveFlowState(ctx context.Context, pool *pgxpool.Pool, state, codeVerifier string, nextPath *string) error {
	_, err := pool.Exec(ctx, `
INSERT INTO settings.clever_sso_flow_state (state, code_verifier, next_path)
VALUES ($1, $2, $3)`,
		state, codeVerifier, nextPath,
	)
	return err
}

// TakeFlowState atomically reads and removes one flow row by state token, or (nil, nil) if none.
func TakeFlowState(ctx context.Context, pool *pgxpool.Pool, state string) (*FlowStateRow, error) {
	row := pool.QueryRow(ctx, `
DELETE FROM settings.clever_sso_flow_state
WHERE state = $1
RETURNING code_verifier, next_path`,
		state,
	)
	var r FlowStateRow
	var next sql.NullString
	if err := row.Scan(&r.CodeVerifier, &next); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if next.Valid {
		s := next.String
		r.NextPath = &s
	}
	return &r, nil
}
