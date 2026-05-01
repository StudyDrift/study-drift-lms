// Package user is the Go port of server/src/repos/user.rs (subset for auth).
package user

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Row is a users table row for authentication and profile in API responses.
type Row struct {
	ID           string
	Email        string
	PasswordHash string
	DisplayName  *string
	FirstName    *string
	LastName     *string
	AvatarURL    *string
	UITheme      string
	Sid          *string
	LoginBlocked bool
	DeactivatedAt *time.Time
}

func strPtr(ns sql.NullString) *string {
	if !ns.Valid {
		return nil
	}
	s := ns.String
	return &s
}

// FindByEmail returns a user by exact email (already normalized) or nil if missing.
func FindByEmail(ctx context.Context, pool *pgxpool.Pool, email string) (*Row, error) {
	const q = `SELECT id::text, email, password_hash, display_name, first_name, last_name, avatar_url, ui_theme, sid,
       login_blocked, deactivated_at
FROM "user".users WHERE email = $1`
	return scanUserRow(ctx, pool, q, email)
}

func scanUserRow(ctx context.Context, pool *pgxpool.Pool, query string, arg any) (*Row, error) {
	var r Row
	var displayName, firstName, lastName, avatar, sid sql.NullString
	var deactivatedAt sql.NullTime
	err := pool.QueryRow(ctx, query, arg).Scan(
		&r.ID, &r.Email, &r.PasswordHash, &displayName, &firstName, &lastName, &avatar, &r.UITheme, &sid,
		&r.LoginBlocked, &deactivatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	r.DisplayName = strPtr(displayName)
	r.FirstName = strPtr(firstName)
	r.LastName = strPtr(lastName)
	r.AvatarURL = strPtr(avatar)
	r.Sid = strPtr(sid)
	if deactivatedAt.Valid {
		t := deactivatedAt.Time
		r.DeactivatedAt = &t
	}
	return &r, nil
}

// FindByID returns a user by primary key or nil.
func FindByID(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (*Row, error) {
	const q = `SELECT id::text, email, password_hash, display_name, first_name, last_name, avatar_url, ui_theme, sid,
       login_blocked, deactivated_at
FROM "user".users WHERE id = $1`
	return scanUserRow(ctx, pool, q, id)
}

// InsertUser creates a new user; email must be normalized. Returns the full row.
func InsertUser(ctx context.Context, pool *pgxpool.Pool, email, passwordHash string, displayName *string) (*Row, error) {
	const q = `INSERT INTO "user".users (email, password_hash, display_name)
VALUES ($1, $2, $3)
RETURNING id::text, email, password_hash, display_name, first_name, last_name, avatar_url, ui_theme, sid,
  login_blocked, deactivated_at`
	var r Row
	var dn, fn, ln, av, sid sql.NullString
	var deactivatedAt sql.NullTime
	err := pool.QueryRow(ctx, q, email, passwordHash, displayName).Scan(
		&r.ID, &r.Email, &r.PasswordHash, &dn, &fn, &ln, &av, &r.UITheme, &sid,
		&r.LoginBlocked, &deactivatedAt,
	)
	if err != nil {
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

// SetPasswordHash updates the user's password hash (Argon2id PHC string).
func SetPasswordHash(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, passwordHash string) error {
	const q = `UPDATE "user".users SET password_hash = $2 WHERE id = $1::uuid`
	tag, err := pool.Exec(ctx, q, userID.String(), passwordHash)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("user: not found for password update")
	}
	return nil
}

// NormalizeEmail trims and lowercases an email (parity with services/auth/credentials.rs).
func NormalizeEmail(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

// FindByEmailCI finds a user by case-insensitive email or nil.
func FindByEmailCI(ctx context.Context, pool *pgxpool.Pool, email string) (*Row, error) {
	em := NormalizeEmail(email)
	if em == "" {
		return nil, nil
	}
	const q = `SELECT id::text, email, password_hash, display_name, first_name, last_name, avatar_url, ui_theme, sid,
       login_blocked, deactivated_at
FROM "user".users WHERE lower(email) = lower($1)`
	return scanUserRow(ctx, pool, q, em)
}
