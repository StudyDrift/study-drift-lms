package user

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// UpdateProfile patches account profile fields for one user.
func UpdateProfile(
	ctx context.Context,
	pool *pgxpool.Pool,
	userID uuid.UUID,
	firstName, lastName, avatarURL, uiTheme *string,
) (*Row, error) {
	const q = `UPDATE "user".users
SET
	first_name = $2,
	last_name = $3,
	avatar_url = $4,
	ui_theme = COALESCE($5, ui_theme)
WHERE id = $1
RETURNING id::text, email, password_hash, display_name, first_name, last_name, avatar_url, ui_theme, sid,
  login_blocked, deactivated_at`
	var r Row
	var dn, fn, ln, av, sid sql.NullString
	var deactivatedAt sql.NullTime
	err := pool.QueryRow(ctx, q, userID, firstName, lastName, avatarURL, uiTheme).Scan(
		&r.ID, &r.Email, &r.PasswordHash, &dn, &fn, &ln, &av, &r.UITheme, &sid,
		&r.LoginBlocked, &deactivatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	r.DisplayName = strPtr(dn)
	r.FirstName = strPtr(fn)
	r.LastName = strPtr(ln)
	r.AvatarURL = strPtr(av)
	r.Sid = strPtr(sid)
	if deactivatedAt.Valid {
		t := deactivatedAt.Time
		r.DeactivatedAt = &t
	}
	return &r, nil
}

