package user

import (
	"context"
	"database/sql"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AccommodationSearchRow is one hit for accommodation user search.
type AccommodationSearchRow struct {
	ID          uuid.UUID
	Email       string
	DisplayName *string
	FirstName   *string
	LastName    *string
	Sid         *string
}

// SearchForAccommodationLookup matches server/src/repos/user::search_users_for_accommodation_lookup.
func SearchForAccommodationLookup(ctx context.Context, pool *pgxpool.Pool, q string) ([]AccommodationSearchRow, error) {
	t := strings.TrimSpace(q)
	if t == "" {
		return nil, nil
	}
	if id, err := uuid.Parse(t); err == nil {
		return searchByExactID(ctx, pool, id)
	}
	if len(t) < 2 {
		return nil, nil
	}
	return searchByPattern(ctx, pool, t)
}

func searchByExactID(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) ([]AccommodationSearchRow, error) {
	const q = `SELECT id, email, display_name, first_name, last_name, sid FROM "user".users WHERE id = $1`
	rows, err := pool.Query(ctx, q, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanUserSearchRows(rows)
}

func searchByPattern(ctx context.Context, pool *pgxpool.Pool, t string) ([]AccommodationSearchRow, error) {
	pattern := "%" + t + "%"
	const q = `
SELECT id, email, display_name, first_name, last_name, sid
FROM "user".users
WHERE email ILIKE $1
   OR COALESCE(display_name, '') ILIKE $1
   OR COALESCE(first_name, '') ILIKE $1
   OR COALESCE(last_name, '') ILIKE $1
   OR COALESCE(sid, '') ILIKE $1
ORDER BY LOWER(email) ASC
LIMIT 40`
	rows, err := pool.Query(ctx, q, pattern)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanUserSearchRows(rows)
}

func scanUserSearchRows(rows interface {
	Next() bool
	Scan(dest ...any) error
	Close()
	Err() error
}) ([]AccommodationSearchRow, error) {
	var out []AccommodationSearchRow
	for rows.Next() {
		var r AccommodationSearchRow
		var displayName, firstName, lastName, sid sql.NullString
		if err := rows.Scan(&r.ID, &r.Email, &displayName, &firstName, &lastName, &sid); err != nil {
			return nil, err
		}
		r.DisplayName = strPtr(displayName)
		r.FirstName = strPtr(firstName)
		r.LastName = strPtr(lastName)
		r.Sid = strPtr(sid)
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
