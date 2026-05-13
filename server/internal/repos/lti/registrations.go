// LTI 1.3 platform registrations and external tools (settings.lti_*).
package ltidb

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ParentPlatform is a parent LMS that launches Lextures as a tool (Lextures = provider).
type ParentPlatform struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	ClientID         string   `json:"clientId"`
	PlatformISS      string   `json:"platformIss"`
	PlatformJWKSURL  string   `json:"platformJwksUrl"`
	PlatformAuthURL  string   `json:"platformAuthUrl"`
	PlatformTokenURL string   `json:"platformTokenUrl"`
	ToolRedirectURIs []string `json:"toolRedirectUris"`
	DeploymentIds    []string `json:"deploymentIds"`
	Active           bool     `json:"active"`
}

// ExternalTool is a tool registered in Lextures (Lextures = platform) for embedding in courses.
type ExternalTool struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	ClientID        string  `json:"clientId"`
	ToolIssuer      string  `json:"toolIssuer"`
	ToolJWKSURL     string  `json:"toolJwksUrl"`
	ToolOidcAuthURL string  `json:"toolOidcAuthUrl"`
	ToolTokenURL    *string `json:"toolTokenUrl"`
	Active          bool    `json:"active"`
}

// ListAdminRegistrations returns all parent platforms and external tools (admin settings UI).
func ListAdminRegistrations(ctx context.Context, pool *pgxpool.Pool) (parents []ParentPlatform, tools []ExternalTool, err error) {
	if pool == nil {
		return nil, nil, errors.New("db pool is nil")
	}
	rows, err := pool.Query(ctx, `
SELECT id, name, client_id, platform_iss, platform_jwks_url, platform_auth_url, platform_token_url,
		tool_redirect_uris, deployment_ids, active
FROM settings.lti_registrations
ORDER BY created_at ASC
`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var p ParentPlatform
		if err := rows.Scan(&id, &p.Name, &p.ClientID, &p.PlatformISS, &p.PlatformJWKSURL, &p.PlatformAuthURL,
			&p.PlatformTokenURL, &p.ToolRedirectURIs, &p.DeploymentIds, &p.Active); err != nil {
			return nil, nil, err
		}
		p.ID = id.String()
		parents = append(parents, p)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	toolRows, err := pool.Query(ctx, `
SELECT id, name, client_id, tool_issuer, tool_jwks_url, tool_oidc_auth_url, tool_token_url, active
FROM settings.lti_external_tools
ORDER BY created_at ASC
`)
	if err != nil {
		return nil, nil, err
	}
	defer toolRows.Close()
	for toolRows.Next() {
		var id uuid.UUID
		var t ExternalTool
		if err := toolRows.Scan(&id, &t.Name, &t.ClientID, &t.ToolIssuer, &t.ToolJWKSURL, &t.ToolOidcAuthURL, &t.ToolTokenURL, &t.Active); err != nil {
			return nil, nil, err
		}
		t.ID = id.String()
		tools = append(tools, t)
	}
	if err := toolRows.Err(); err != nil {
		return nil, nil, err
	}
	if parents == nil {
		parents = []ParentPlatform{}
	}
	if tools == nil {
		tools = []ExternalTool{}
	}
	return parents, tools, nil
}

// CreateExternalTool inserts a new external tool row.
func CreateExternalTool(ctx context.Context, pool *pgxpool.Pool, name, clientID, issuer, jwksURL, oidcAuth string, tokenURL *string) (*ExternalTool, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	var id uuid.UUID
	var out ExternalTool
	err := pool.QueryRow(ctx, `
INSERT INTO settings.lti_external_tools
	(name, client_id, tool_issuer, tool_jwks_url, tool_oidc_auth_url, tool_token_url, active)
VALUES ($1, $2, $3, $4, $5, $6, true)
RETURNING id, name, client_id, tool_issuer, tool_jwks_url, tool_oidc_auth_url, tool_token_url, active
`, name, clientID, issuer, jwksURL, oidcAuth, tokenURL).Scan(
		&id, &out.Name, &out.ClientID, &out.ToolIssuer, &out.ToolJWKSURL, &out.ToolOidcAuthURL, &out.ToolTokenURL, &out.Active)
	if err != nil {
		return nil, err
	}
	out.ID = id.String()
	return &out, nil
}

// ExternalToolSummary is id and name for course module authoring (LTI link picker).
type ExternalToolSummary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ListActiveExternalToolsForCourse returns active external tools ordered by name.
func ListActiveExternalToolsForCourse(ctx context.Context, pool *pgxpool.Pool) ([]ExternalToolSummary, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	rows, err := pool.Query(ctx, `
SELECT id::text, name
FROM settings.lti_external_tools
WHERE active = true
ORDER BY lower(name) ASC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ExternalToolSummary
	for rows.Next() {
		var s ExternalToolSummary
		if err := rows.Scan(&s.ID, &s.Name); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if out == nil {
		out = []ExternalToolSummary{}
	}
	return out, nil
}
