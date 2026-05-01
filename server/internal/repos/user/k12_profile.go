package user

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// UpdateK12ProfileAfterOIDC sets Clever/ClassLink identifiers, COPPA minor flag, and optional names after SSO.
func UpdateK12ProfileAfterOIDC(
	ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID,
	cleverID, classLinkID *string, isMinor bool, givenName, familyName *string, connectedVia string,
) error {
	cv := (*string)(nil)
	if cleverID != nil {
		s := strings.TrimSpace(*cleverID)
		if s != "" {
			cv = &s
		}
	}
	cl := (*string)(nil)
	if classLinkID != nil {
		s := strings.TrimSpace(*classLinkID)
		if s != "" {
			cl = &s
		}
	}
	fn := (*string)(nil)
	if givenName != nil {
		s := strings.TrimSpace(*givenName)
		if s != "" {
			fn = &s
		}
	}
	ln := (*string)(nil)
	if familyName != nil {
		s := strings.TrimSpace(*familyName)
		if s != "" {
			ln = &s
		}
	}
	cvVia := strings.TrimSpace(connectedVia)
	cvViaArg := any(nil)
	if cvVia != "" {
		cvViaArg = cvVia
	}
	_, err := pool.Exec(ctx, `
UPDATE "user".users SET
  clever_id = COALESCE($2, clever_id),
  classlink_id = COALESCE($3, classlink_id),
  is_minor = is_minor OR $4,
  connected_via = COALESCE(connected_via, $5::text),
  first_name = COALESCE($6, first_name),
  last_name = COALESCE($7, last_name)
WHERE id = $1`,
		userID, cv, cl, isMinor, cvViaArg, fn, ln,
	)
	return err
}
