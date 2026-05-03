package mfaservice

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	webauthnlib "github.com/go-webauthn/webauthn/webauthn"
)

func insertAudit(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, kind string, detail map[string]any) {
	var b []byte
	if detail != nil {
		b, _ = json.Marshal(detail)
	}
	_, _ = pool.Exec(ctx, `
INSERT INTO "user".mfa_audit_events (user_id, event_kind, detail)
VALUES ($1, $2, $3::jsonb)
`, userID, kind, b)
}

func deleteUnverifiedTOTPTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID) error {
	_, err := tx.Exec(ctx, `DELETE FROM "user".mfa_totp_credentials WHERE user_id = $1 AND NOT verified`, userID)
	return err
}

func insertTOTPSecretTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, secret string) (uuid.UUID, error) {
	var id uuid.UUID
	err := tx.QueryRow(ctx, `
INSERT INTO "user".mfa_totp_credentials (user_id, secret, verified)
VALUES ($1, $2, false)
RETURNING id
`, userID, secret).Scan(&id)
	return id, err
}

func getTOTPCred(ctx context.Context, pool *pgxpool.Pool, credID, userID uuid.UUID) (secret string, verified bool, lastPeriod *int64, err error) {
	var lp sql.NullInt64
	err = pool.QueryRow(ctx, `
SELECT secret, verified, last_used_period
FROM "user".mfa_totp_credentials
WHERE id = $1 AND user_id = $2
`, credID, userID).Scan(&secret, &verified, &lp)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil, pgx.ErrNoRows
	}
	if err != nil {
		return "", false, nil, err
	}
	if lp.Valid {
		v := lp.Int64
		lastPeriod = &v
	}
	return secret, verified, lastPeriod, nil
}

func markTOTPUsed(ctx context.Context, pool *pgxpool.Pool, credID uuid.UUID, period int64) error {
	tag, err := pool.Exec(ctx, `
UPDATE "user".mfa_totp_credentials
SET last_used_period = $2, last_used_at = NOW()
WHERE id = $1 AND (last_used_period IS DISTINCT FROM $2)
`, credID, period)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errReplay
	}
	return nil
}

func verifyTOTPCredential(ctx context.Context, exec interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}, credID uuid.UUID) error {
	tag, err := exec.Exec(ctx, `
UPDATE "user".mfa_totp_credentials SET verified = true WHERE id = $1 AND NOT verified
`, credID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("totp credential not found or already verified")
	}
	return nil
}

func replaceBackupCodesTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, hashes []string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM "user".mfa_backup_codes WHERE user_id = $1`, userID); err != nil {
		return err
	}
	for _, h := range hashes {
		if _, err := tx.Exec(ctx, `INSERT INTO "user".mfa_backup_codes (user_id, code_hash) VALUES ($1, $2)`, userID, h); err != nil {
			return err
		}
	}
	return nil
}

func consumeBackupCode(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, codeHash string) (bool, error) {
	tag, err := pool.Exec(ctx, `
UPDATE "user".mfa_backup_codes
SET used_at = NOW()
WHERE id = (
	SELECT id FROM "user".mfa_backup_codes
	WHERE user_id = $1 AND used_at IS NULL AND code_hash = $2
	LIMIT 1
)
`, userID, codeHash)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func insertWebAuthnCredTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, credID, publicKey []byte, signCount uint32, displayName string, aaguid *uuid.UUID) error {
	_, err := tx.Exec(ctx, `
INSERT INTO "user".mfa_webauthn_credentials (user_id, credential_id, public_key_cbor, sign_count, display_name, aaguid)
VALUES ($1, $2, $3, $4, NULLIF(trim($5), ''), $6)
`, userID, credID, publicKey, int64(signCount), displayName, aaguid)
	return err
}

func storeWebAuthnSession(ctx context.Context, pool *pgxpool.Pool, id string, userID uuid.UUID, kind string, data []byte, exp time.Time) error {
	_, err := pool.Exec(ctx, `
INSERT INTO "user".mfa_webauthn_challenges (id, user_id, kind, data, expires_at)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, kind = EXCLUDED.kind, data = EXCLUDED.data, expires_at = EXCLUDED.expires_at
`, id, userID, kind, data, exp)
	return err
}

func loadWebAuthnSession(ctx context.Context, pool *pgxpool.Pool, id string) (userID uuid.UUID, kind string, data []byte, err error) {
	var exp time.Time
	err = pool.QueryRow(ctx, `
SELECT user_id, kind, data, expires_at FROM "user".mfa_webauthn_challenges WHERE id = $1
`, id).Scan(&userID, &kind, &data, &exp)
	if err != nil {
		return uuid.Nil, "", nil, err
	}
	if time.Now().UTC().After(exp) {
		_, _ = pool.Exec(ctx, `DELETE FROM "user".mfa_webauthn_challenges WHERE id = $1`, id)
		return uuid.Nil, "", nil, pgx.ErrNoRows
	}
	return userID, kind, data, nil
}

func deleteWebAuthnSession(ctx context.Context, pool *pgxpool.Pool, id string) {
	_, _ = pool.Exec(ctx, `DELETE FROM "user".mfa_webauthn_challenges WHERE id = $1`, id)
}

func TryConsumeMFAPendingJTI(ctx context.Context, pool *pgxpool.Pool, jti string) (bool, error) {
	h := sha256.Sum256([]byte(jti))
	tag, err := pool.Exec(ctx, `
INSERT INTO "user".mfa_pending_token_use (jti_hash) VALUES ($1)
ON CONFLICT (jti_hash) DO NOTHING
`, h[:])
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func marshalSession(sd *webauthnlib.SessionData) ([]byte, error) {
	return json.Marshal(sd)
}

func unmarshalSession(b []byte) (webauthnlib.SessionData, error) {
	var sd webauthnlib.SessionData
	err := json.Unmarshal(b, &sd)
	return sd, err
}
