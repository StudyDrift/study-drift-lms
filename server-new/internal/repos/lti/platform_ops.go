// Platform OIDC, nonces, platform accounts, resource links, admin mutations.
package ltidb

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PlatformRegistration is an active parent LMS row (same shape as list load).
type PlatformRegistration = ParentPlatform

// FindPlatformRegistration returns a registration for iss+clientId when active.
func FindPlatformRegistration(ctx context.Context, pool *pgxpool.Pool, iss, clientID string) (*PlatformRegistration, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	var id uuid.UUID
	var p PlatformRegistration
	err := pool.QueryRow(ctx, `
SELECT id, name, client_id, platform_iss, platform_jwks_url, platform_auth_url, platform_token_url,
		tool_redirect_uris, deployment_ids, active
FROM settings.lti_registrations
WHERE platform_iss = $1 AND client_id = $2 AND active = true
`, iss, clientID).Scan(
		&id, &p.Name, &p.ClientID, &p.PlatformISS, &p.PlatformJWKSURL, &p.PlatformAuthURL, &p.PlatformTokenURL,
		&p.ToolRedirectURIs, &p.DeploymentIds, &p.Active,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p.ID = id.String()
	return &p, nil
}

// InsertOIDCState stores a pending OIDC /login round-trip row.
func InsertOIDCState(ctx context.Context, pool *pgxpool.Pool, state, iss, clientID, nonce, target string,
	loginHint, deploymentID, messageHint *string, expiresAt time.Time,
) error {
	if pool == nil {
		return errors.New("db pool is nil")
	}
	_, err := pool.Exec(ctx, `
INSERT INTO settings.lti_oidc_states
	(state, issuer, client_id, nonce, target_link_uri, login_hint, deployment_id, message_hint, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
`, state, iss, clientID, nonce, target, loginHint, deploymentID, messageHint, expiresAt)
	return err
}

// TakeOIDCState deletes a valid OIDC state row and returns its fields.
func TakeOIDCState(ctx context.Context, pool *pgxpool.Pool, state string) (
	issuer, clientID, nonce, target string,
	loginHint, deploymentID, messageHint *string,
	err error,
) {
	if pool == nil {
		return "", "", "", "", nil, nil, nil, errors.New("db pool is nil")
	}
	var lh, did, mh *string
	err = pool.QueryRow(ctx, `
DELETE FROM settings.lti_oidc_states
WHERE state = $1 AND expires_at > NOW()
RETURNING issuer, client_id, nonce, target_link_uri, login_hint, deployment_id, message_hint
`, state).Scan(&issuer, &clientID, &nonce, &target, &lh, &did, &mh)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", "", "", nil, nil, nil, nil
	}
	if err != nil {
		return "", "", "", "", nil, nil, nil, err
	}
	if lh != nil && *lh == "" {
		lh = nil
	}
	if did != nil && *did == "" {
		did = nil
	}
	if mh != nil && *mh == "" {
		mh = nil
	}
	return issuer, clientID, nonce, target, lh, did, mh, nil
}

// TryInsertConsumedNonce returns false if the nonce is still valid (replay), matching Rust lti::try_insert_consumed_nonce.
func TryInsertConsumedNonce(ctx context.Context, pool *pgxpool.Pool, nonce string, exp time.Time) (ok bool, err error) {
	if pool == nil {
		return false, errors.New("db pool is nil")
	}
	_, _ = pool.Exec(ctx, `DELETE FROM settings.lti_nonces WHERE expires_at < NOW()`)
	cmd, err := pool.Exec(ctx, `
INSERT INTO settings.lti_nonces (nonce, expires_at) VALUES ($1, $2)
ON CONFLICT (nonce) DO NOTHING
`, nonce, exp)
	if err != nil {
		return false, err
	}
	if cmd.RowsAffected() > 0 {
		return true, nil
	}
	var ex time.Time
	err = pool.QueryRow(ctx, `SELECT expires_at FROM settings.lti_nonces WHERE nonce = $1`, nonce).Scan(&ex)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			_, err = pool.Exec(ctx, `INSERT INTO settings.lti_nonces (nonce, expires_at) VALUES ($1, $2)`, nonce, exp)
			return err == nil, err
		}
		return false, err
	}
	if ex.After(time.Now().UTC()) {
		return false, nil
	}
	_, _ = pool.Exec(ctx, `DELETE FROM settings.lti_nonces WHERE nonce = $1`, nonce)
	_, err = pool.Exec(ctx, `INSERT INTO settings.lti_nonces (nonce, expires_at) VALUES ($1, $2)`, nonce, exp)
	return err == nil, err
}

// UpsertLtiPlatformAccount links platform subject to a user.
func UpsertLtiPlatformAccount(ctx context.Context, pool *pgxpool.Pool, platformISS, sub string, userID uuid.UUID) error {
	if pool == nil {
		return errors.New("db pool is nil")
	}
	_, err := pool.Exec(ctx, `
INSERT INTO "user".lti_platform_accounts (platform_iss, platform_user_sub, user_id) VALUES ($1, $2, $3)
ON CONFLICT (platform_iss, platform_user_sub) DO NOTHING
`, platformISS, sub, userID)
	return err
}

// FindUserForPlatformSubject returns a linked user_id if present.
func FindUserForPlatformSubject(ctx context.Context, pool *pgxpool.Pool, platformISS, sub string) (*uuid.UUID, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	var uid uuid.UUID
	err := pool.QueryRow(ctx, `SELECT user_id FROM "user".lti_platform_accounts WHERE platform_iss = $1 AND platform_user_sub = $2`,
		platformISS, sub).Scan(&uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &uid, nil
}

// ResourceLink is a course.lti_resource_links row.
type ResourceLink struct {
	ID              uuid.UUID
	CourseID        uuid.UUID
	StructureItemID uuid.UUID
	ExternalToolID  uuid.UUID
	ResourceLinkID   string
	Title            *string
	CustomParamsJSON []byte
	LineItemURL      *string
}

// GetResourceLinkForStructureItem returns a link for embed routes.
func GetResourceLinkForStructureItem(ctx context.Context, pool *pgxpool.Pool, courseID, itemID uuid.UUID) (*ResourceLink, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	var r ResourceLink
	var title *string
	var line *string
	var custom []byte
	err := pool.QueryRow(ctx, `
SELECT id, course_id, structure_item_id, external_tool_id, resource_link_id, title, custom_params, line_item_url
FROM course.lti_resource_links
WHERE course_id = $1 AND structure_item_id = $2
`, courseID, itemID).Scan(
		&r.ID, &r.CourseID, &r.StructureItemID, &r.ExternalToolID, &r.ResourceLinkID, &title, &custom, &line,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	r.Title = title
	r.LineItemURL = line
	if len(custom) > 0 {
		r.CustomParamsJSON = custom
	}
	return &r, nil
}

// FindResourceLinkByLineItemURL returns a row by AGS line item URL.
func FindResourceLinkByLineItemURL(ctx context.Context, pool *pgxpool.Pool, lineItemURL string) (*ResourceLink, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	var r ResourceLink
	var title *string
	var line *string
	var custom []byte
	err := pool.QueryRow(ctx, `
SELECT id, course_id, structure_item_id, external_tool_id, resource_link_id, title, custom_params, line_item_url
FROM course.lti_resource_links
WHERE line_item_url = $1
`, lineItemURL).Scan(
		&r.ID, &r.CourseID, &r.StructureItemID, &r.ExternalToolID, &r.ResourceLinkID, &title, &custom, &line,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	r.Title = title
	r.LineItemURL = line
	if len(custom) > 0 {
		r.CustomParamsJSON = custom
	}
	return &r, nil
}

// ListExternalToolsForScores lists tools for AGS (includes inactive filter in caller).
func ListExternalToolsForScores(ctx context.Context, pool *pgxpool.Pool) ([]ExternalTool, error) {
	_, tools, err := ListAdminRegistrations(ctx, pool)
	return tools, err
}

// InsertPlatformRegistration creates a parent platform registration. Returns new id.
func InsertPlatformRegistration(ctx context.Context, pool *pgxpool.Pool, name, clientID, platformISS, jwksURL, authURL, tokenURL string, redirectURIs, deploymentIDs []string) (uuid.UUID, error) {
	if pool == nil {
		return uuid.UUID{}, errors.New("db pool is nil")
	}
	if redirectURIs == nil {
		redirectURIs = []string{}
	}
	if deploymentIDs == nil {
		deploymentIDs = []string{}
	}
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
INSERT INTO settings.lti_registrations
	(name, client_id, platform_iss, platform_jwks_url, platform_auth_url, platform_token_url, tool_redirect_uris, deployment_ids)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id
`, name, clientID, platformISS, jwksURL, authURL, tokenURL, redirectURIs, deploymentIDs).Scan(&id)
	return id, err
}

// UpdatePlatformRegistrationActive sets active for a parent registration.
func UpdatePlatformRegistrationActive(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, active bool) (bool, error) {
	if pool == nil {
		return false, errors.New("db pool is nil")
	}
	cmd, err := pool.Exec(ctx, `UPDATE settings.lti_registrations SET active = $2 WHERE id = $1`, id, active)
	if err != nil {
		return false, err
	}
	return cmd.RowsAffected() > 0, nil
}

// DeletePlatformRegistration removes a parent registration.
func DeletePlatformRegistration(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (bool, error) {
	if pool == nil {
		return false, errors.New("db pool is nil")
	}
	cmd, err := pool.Exec(ctx, `DELETE FROM settings.lti_registrations WHERE id = $1`, id)
	if err != nil {
		return false, err
	}
	return cmd.RowsAffected() > 0, nil
}

// UpdateExternalToolActive toggles a tool.
func UpdateExternalToolActive(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, active bool) (bool, error) {
	if pool == nil {
		return false, errors.New("db pool is nil")
	}
	cmd, err := pool.Exec(ctx, `UPDATE settings.lti_external_tools SET active = $2 WHERE id = $1`, id, active)
	if err != nil {
		return false, err
	}
	return cmd.RowsAffected() > 0, nil
}

// DeleteExternalTool removes an external tool.
func DeleteExternalTool(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (bool, error) {
	if pool == nil {
		return false, errors.New("db pool is nil")
	}
	cmd, err := pool.Exec(ctx, `DELETE FROM settings.lti_external_tools WHERE id = $1`, id)
	if err != nil {
		return false, err
	}
	return cmd.RowsAffected() > 0, nil
}

// GetExternalToolByID returns one tool.
func GetExternalToolByID(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (*ExternalTool, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	var t ExternalTool
	var uid uuid.UUID
	err := pool.QueryRow(ctx, `
SELECT id, name, client_id, tool_issuer, tool_jwks_url, tool_oidc_auth_url, tool_token_url, active
FROM settings.lti_external_tools
WHERE id = $1
`, id).Scan(
		&uid, &t.Name, &t.ClientID, &t.ToolIssuer, &t.ToolJWKSURL, &t.ToolOidcAuthURL, &t.ToolTokenURL, &t.Active,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	t.ID = uid.String()
	return &t, nil
}

