// Package passwordpolicy loads and updates institution password policy rows.
package passwordpolicy

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Row is an effective password policy (from DB).
type Row struct {
	InstitutionID   *uuid.UUID
	MinLength       int
	RequireUpper    bool
	RequireLower    bool
	RequireDigit    bool
	RequireSpecial  bool
	CheckHIBP       bool
}

func scanRow(scanner interface {
	Scan(dest ...any) error
}) (Row, error) {
	var r Row
	var inst *uuid.UUID
	err := scanner.Scan(
		&inst,
		&r.MinLength,
		&r.RequireUpper,
		&r.RequireLower,
		&r.RequireDigit,
		&r.RequireSpecial,
		&r.CheckHIBP,
	)
	if err != nil {
		return Row{}, err
	}
	r.InstitutionID = inst
	return r, nil
}

// LoadGlobal returns the single global policy (institution_id IS NULL).
func LoadGlobal(ctx context.Context, pool *pgxpool.Pool) (Row, error) {
	const q = `
SELECT institution_id, min_length, require_upper, require_lower, require_digit, require_special, check_hibp
FROM "user".password_policies WHERE institution_id IS NULL LIMIT 1`
	r, err := scanRow(pool.QueryRow(ctx, q))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Row{}, errors.New("password_policies: missing global row")
		}
		return Row{}, err
	}
	return r, nil
}

// LoadForInstitution returns the policy for an institution, or nil if none.
func LoadForInstitution(ctx context.Context, pool *pgxpool.Pool, institutionID uuid.UUID) (*Row, error) {
	const q = `
SELECT institution_id, min_length, require_upper, require_lower, require_digit, require_special, check_hibp
FROM "user".password_policies WHERE institution_id = $1 LIMIT 1`
	r, err := scanRow(pool.QueryRow(ctx, q, institutionID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

// LoadEffective returns the institution-specific row when present, otherwise the global row.
func LoadEffective(ctx context.Context, pool *pgxpool.Pool, institutionID *uuid.UUID) (Row, error) {
	if institutionID != nil {
		row, err := LoadForInstitution(ctx, pool, *institutionID)
		if err != nil {
			return Row{}, err
		}
		if row != nil {
			return *row, nil
		}
	}
	return LoadGlobal(ctx, pool)
}

// UpsertInstitutionPolicy creates or updates a non-global policy row.
func UpsertInstitutionPolicy(ctx context.Context, pool *pgxpool.Pool, institutionID uuid.UUID, r Row) error {
	const upd = `
UPDATE "user".password_policies SET
  min_length = $2,
  require_upper = $3,
  require_lower = $4,
  require_digit = $5,
  require_special = $6,
  check_hibp = $7,
  updated_at = NOW()
WHERE institution_id = $1`
	tag, err := pool.Exec(ctx, upd,
		institutionID,
		r.MinLength,
		r.RequireUpper,
		r.RequireLower,
		r.RequireDigit,
		r.RequireSpecial,
		r.CheckHIBP,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}
	const ins = `
INSERT INTO "user".password_policies (
  institution_id, min_length, require_upper, require_lower, require_digit, require_special, check_hibp, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`
	_, err = pool.Exec(ctx, ins,
		institutionID,
		r.MinLength,
		r.RequireUpper,
		r.RequireLower,
		r.RequireDigit,
		r.RequireSpecial,
		r.CheckHIBP,
	)
	return err
}

// UpdateGlobalPolicy updates the singleton global row (must exist).
func UpdateGlobalPolicy(ctx context.Context, pool *pgxpool.Pool, r Row) error {
	const q = `
UPDATE "user".password_policies SET
  min_length = $1,
  require_upper = $2,
  require_lower = $3,
  require_digit = $4,
  require_special = $5,
  check_hibp = $6,
  updated_at = NOW()
WHERE institution_id IS NULL`
	tag, err := pool.Exec(ctx, q,
		r.MinLength,
		r.RequireUpper,
		r.RequireLower,
		r.RequireDigit,
		r.RequireSpecial,
		r.CheckHIBP,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("password_policies: global row missing")
	}
	return nil
}

const hibpCacheTTL = 24 * time.Hour

// HIBPCacheGet returns cached range body when fresh.
func HIBPCacheGet(ctx context.Context, pool *pgxpool.Pool, prefix string) (body string, ok bool, err error) {
	const q = `SELECT suffixes, cached_at FROM "user".hibp_prefix_cache WHERE prefix = $1`
	var suffixes string
	var cachedAt time.Time
	e := pool.QueryRow(ctx, q, prefix).Scan(&suffixes, &cachedAt)
	if e != nil {
		if errors.Is(e, pgx.ErrNoRows) {
			return "", false, nil
		}
		return "", false, e
	}
	if time.Since(cachedAt) > hibpCacheTTL {
		return "", false, nil
	}
	return suffixes, true, nil
}

// HIBPCachePut stores the raw HIBP response body for a prefix.
func HIBPCachePut(ctx context.Context, pool *pgxpool.Pool, prefix, suffixes string) error {
	const q = `
INSERT INTO "user".hibp_prefix_cache (prefix, suffixes, cached_at) VALUES ($1, $2, NOW())
ON CONFLICT (prefix) DO UPDATE SET suffixes = EXCLUDED.suffixes, cached_at = NOW()`
	_, err := pool.Exec(ctx, q, prefix, suffixes)
	return err
}
