package samlidp

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// GetIDPByID returns a single IdP row (Rust `get_idp_by_id`).
func GetIDPByID(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (*IDPRow, error) {
	r, err := scanIdP(pool.QueryRow(ctx, `
SELECT
	id, institution_id, display_name, entity_id, sso_url, slo_url,
	idp_cert_pem, attribute_mapping, force_saml
FROM settings.saml_idp_configurations
WHERE id = $1
`, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return r, nil
}

// SaveAuthnState stores the AuthnRequest id for ACS correlation.
func SaveAuthnState(ctx context.Context, pool *pgxpool.Pool, requestID string, idpID uuid.UUID, relayState *string) error {
	_, err := pool.Exec(ctx, `
INSERT INTO settings.saml_authn_request_state (request_id, idp_id, relay_state)
VALUES ($1, $2, $3)
ON CONFLICT (request_id) DO UPDATE SET
	idp_id = EXCLUDED.idp_id,
	relay_state = EXCLUDED.relay_state,
	created_at = NOW()
`, requestID, idpID, relayState)
	return err
}

// TakeAuthnState returns (idp_id, relay_state) and deletes the row.
func TakeAuthnState(ctx context.Context, pool *pgxpool.Pool, requestID string) (idpID uuid.UUID, relayState *string, ok bool, err error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return uuid.UUID{}, nil, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	err = tx.QueryRow(ctx, `
SELECT idp_id, relay_state
FROM settings.saml_authn_request_state
WHERE request_id = $1
`, requestID).Scan(&idpID, &relayState)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.UUID{}, nil, false, nil
	}
	if err != nil {
		return uuid.UUID{}, nil, false, err
	}
	_, err = tx.Exec(ctx, `DELETE FROM settings.saml_authn_request_state WHERE request_id = $1`, requestID)
	if err != nil {
		return uuid.UUID{}, nil, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return uuid.UUID{}, nil, false, err
	}
	return idpID, relayState, true, nil
}

// DeleteStaleAuthnState removes rows older than 2 hours (Rust default behavior).
func DeleteStaleAuthnState(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	tag, err := pool.Exec(ctx, `
DELETE FROM settings.saml_authn_request_state
WHERE created_at < NOW() - INTERVAL '2 hours'
`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// DeleteStaleReplayGuard removes old replay keys.
func DeleteStaleReplayGuard(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	tag, err := pool.Exec(ctx, `
DELETE FROM settings.saml_replay_guard
WHERE created_at < NOW() - INTERVAL '24 hours'
`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// RecordReplay returns false if the correlation_id was already used.
func RecordReplay(ctx context.Context, pool *pgxpool.Pool, correlationID string) (bool, error) {
	_, err := pool.Exec(ctx, `
INSERT INTO settings.saml_replay_guard (correlation_id) VALUES ($1)
`, correlationID)
	if err == nil {
		return true, nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return false, nil
	}
	return false, err
}
