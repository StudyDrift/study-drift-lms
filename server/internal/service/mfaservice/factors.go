package mfaservice

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Factor is one enrolled MFA method for /api/me/mfa.
type Factor struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"` // "totp" | "webauthn"
	Label     string `json:"label,omitempty"`
	CreatedAt string `json:"createdAt"`
}

// ListFactors returns enrolled TOTP and WebAuthn credentials for settings UI.
func ListFactors(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) ([]Factor, error) {
	rows, err := pool.Query(ctx, `
SELECT id::text, 'totp', COALESCE(label, ''), created_at FROM "user".mfa_totp_credentials WHERE user_id = $1 AND verified
UNION ALL
SELECT id::text, 'webauthn', COALESCE(display_name, ''), created_at FROM "user".mfa_webauthn_credentials WHERE user_id = $1
ORDER BY created_at
`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Factor
	for rows.Next() {
		var f Factor
		var t time.Time
		if err := rows.Scan(&f.ID, &f.Kind, &f.Label, &t); err != nil {
			return nil, err
		}
		f.CreatedAt = t.UTC().Format(time.RFC3339)
		out = append(out, f)
	}
	return out, rows.Err()
}

// DeleteFactor removes a TOTP or WebAuthn credential by id.
func DeleteFactor(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, factorID uuid.UUID) error {
	tag, err := pool.Exec(ctx, `DELETE FROM "user".mfa_totp_credentials WHERE id = $1 AND user_id = $2`, factorID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		insertAudit(ctx, pool, userID, "totp_removed", map[string]any{"id": factorID.String()})
		return nil
	}
	tag, err = pool.Exec(ctx, `DELETE FROM "user".mfa_webauthn_credentials WHERE id = $1 AND user_id = $2`, factorID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrFactorNotFound
	}
	insertAudit(ctx, pool, userID, "webauthn_removed", map[string]any{"id": factorID.String()})
	return nil
}

// ErrFactorNotFound when delete id does not exist for user.
var ErrFactorNotFound = errors.New("mfa factor not found")
