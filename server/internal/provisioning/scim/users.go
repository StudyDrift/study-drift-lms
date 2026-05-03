package scim

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server/internal/repos/rbac"
	"github.com/lextures/lextures/server/internal/repos/user"
	"github.com/lextures/lextures/server/internal/service/authservice"
)

// UserResource is the minimal SCIM User JSON body we accept and emit.
type UserResource struct {
	Schemas    []string       `json:"schemas,omitempty"`
	ID         string         `json:"id,omitempty"`
	ExternalID string         `json:"externalId,omitempty"`
	UserName   string         `json:"userName,omitempty"`
	Active     *bool          `json:"active,omitempty"`
	DisplayName string        `json:"displayName,omitempty"`
	Name       *Name          `json:"name,omitempty"`
	Meta       *Meta          `json:"meta,omitempty"`
	Enterprise *EnterpriseExt `json:"urn:ietf:params:scim:schemas:extension:enterprise:2.0:User,omitempty"`
}

type Name struct {
	Formatted  string `json:"formatted,omitempty"`
	GivenName  string `json:"givenName,omitempty"`
	FamilyName string `json:"familyName,omitempty"`
}

type Meta struct {
	ResourceType string `json:"resourceType,omitempty"`
	Created      string `json:"created,omitempty"`
	LastModified string `json:"lastModified,omitempty"`
	Location     string `json:"location,omitempty"`
}

type EnterpriseExt struct {
	Department string `json:"department,omitempty"`
}

type listResponse struct {
	Schemas      []string        `json:"schemas"`
	TotalResults int             `json:"totalResults"`
	StartIndex   int             `json:"startIndex"`
	ItemsPerPage int             `json:"itemsPerPage"`
	Resources    []*UserResource `json:"Resources"`
}

// LogEvent writes provisioning.scim_provisioning_events.
func LogEvent(ctx context.Context, pool *pgxpool.Pool, institutionID uuid.UUID, operation, scimResource string, affectedUser *uuid.UUID, payload any) error {
	var pj []byte
	if payload != nil {
		var err error
		pj, err = json.Marshal(payload)
		if err != nil {
			pj = []byte("{}")
		}
	}
	_, err := pool.Exec(ctx, `
INSERT INTO provisioning.scim_provisioning_events (institution_id, operation, scim_resource, affected_user_id, payload_json)
VALUES ($1, $2, $3, $4, $5)
`, institutionID, operation, scimResource, affectedUser, pj)
	return err
}

func resolveDisplayName(in *UserResource) string {
	if in.DisplayName != "" {
		return strings.TrimSpace(in.DisplayName)
	}
	if in.Name != nil {
		if strings.TrimSpace(in.Name.Formatted) != "" {
			return strings.TrimSpace(in.Name.Formatted)
		}
		g := strings.TrimSpace(in.Name.GivenName)
		f := strings.TrimSpace(in.Name.FamilyName)
		if g != "" || f != "" {
			return strings.TrimSpace(g + " " + f)
		}
	}
	return ""
}

func mapAppRoleName(ext *EnterpriseExt) string {
	if ext == nil {
		return "Student"
	}
	r := strings.TrimSpace(ext.Department)
	if r == "" {
		return "Student"
	}
	// Accept common IdP mappings (case-insensitive).
	switch strings.ToLower(r) {
	case "teacher", "instructor", "faculty", "staff":
		return "Teacher"
	case "student", "learner":
		return "Student"
	default:
		// Try exact catalog match via RBAC helper.
		return r
	}
}

// CreateUser provisions a user bound to institution.
func CreateUser(ctx context.Context, pool *pgxpool.Pool, institutionID uuid.UUID, in *UserResource, baseURL string) (*UserResource, error) {
	email := user.NormalizeEmail(in.UserName)
	if email == "" || !strings.Contains(email, "@") {
		return nil, ErrInvalidValue
	}
	extID := strings.TrimSpace(in.ExternalID)
	active := true
	if in.Active != nil {
		active = *in.Active
	}
	dn := resolveDisplayName(in)
	if dn == "" {
		dn = email
	}
	roleName := mapAppRoleName(in.Enterprise)

	ph, err := authservice.PlaceholderPasswordHash()
	if err != nil {
		return nil, err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if extID != "" {
		var taken bool
		err = tx.QueryRow(ctx, `
SELECT EXISTS (
  SELECT 1 FROM "user".users u
  INNER JOIN provisioning.scim_user_bindings b ON b.user_id = u.id AND b.institution_id = $2
  WHERE u.scim_external_id = $1
)`, extID, institutionID).Scan(&taken)
		if err != nil {
			return nil, err
		}
		if taken {
			return nil, ErrUniqueness
		}
	}

	var emailTaken bool
	err = tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM "user".users WHERE email = $1)`, email).Scan(&emailTaken)
	if err != nil {
		return nil, err
	}
	if emailTaken {
		return nil, ErrUniqueness
	}

	var extSQL any
	if extID == "" {
		extSQL = nil
	} else {
		extSQL = extID
	}

	var uid uuid.UUID
	err = tx.QueryRow(ctx, `
INSERT INTO "user".users (email, password_hash, display_name, scim_external_id)
VALUES ($1, $2, $3, $4)
RETURNING id
`, email, ph, dn, extSQL).Scan(&uid)
	if err != nil {
		var pe *pgconn.PgError
		if errors.As(err, &pe) && pe.Code == "23505" {
			return nil, ErrUniqueness
		}
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
INSERT INTO provisioning.scim_user_bindings (institution_id, user_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING
`, institutionID, uid); err != nil {
		return nil, err
	}

	if err := rbac.AssignUserRoleByNameTx(ctx, tx, uid, roleName); err != nil {
		return nil, err
	}
	var roleCount int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*)::int FROM "user".user_app_roles WHERE user_id = $1`, uid).Scan(&roleCount); err != nil {
		return nil, err
	}
	if roleCount == 0 {
		if err := rbac.AssignUserRoleByNameTx(ctx, tx, uid, "Student"); err != nil {
			return nil, err
		}
	}

	if !active {
		if _, err := tx.Exec(ctx, `
UPDATE "user".users SET
  deactivated_at = COALESCE(deactivated_at, NOW()),
  login_blocked = TRUE,
  jwt_session_version = jwt_session_version + 1
WHERE id = $1
`, uid); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	_ = LogEvent(ctx, pool, institutionID, "create", "User", &uid, map[string]any{"userName": email})
	out := buildUserResource(ctx, pool, uid, institutionID, baseURL)
	return out, nil
}

// ErrUniqueness is HTTP 409 SCIM uniqueness.
var ErrUniqueness = errors.New("scim: uniqueness")

// ErrInvalidValue is HTTP 400 invalidValue.
var ErrInvalidValue = errors.New("scim: invalid value")

// ErrNotFound is HTTP 404.
var ErrNotFound = errors.New("scim: not found")

func findBoundUserID(ctx context.Context, pool *pgxpool.Pool, institutionID uuid.UUID, scimUserID string) (uuid.UUID, error) {
	scimUserID = strings.TrimSpace(scimUserID)
	if scimUserID == "" {
		return uuid.UUID{}, ErrNotFound
	}
	if id, err := uuid.Parse(scimUserID); err == nil {
		var ok bool
		err := pool.QueryRow(ctx, `
SELECT EXISTS (
  SELECT 1 FROM provisioning.scim_user_bindings WHERE institution_id = $1 AND user_id = $2
)`, institutionID, id).Scan(&ok)
		if err != nil {
			return uuid.UUID{}, err
		}
		if !ok {
			return uuid.UUID{}, ErrNotFound
		}
		return id, nil
	}
	var uid uuid.UUID
	err := pool.QueryRow(ctx, `
SELECT u.id FROM "user".users u
INNER JOIN provisioning.scim_user_bindings b ON b.user_id = u.id AND b.institution_id = $1
WHERE u.scim_external_id = $2
`, institutionID, scimUserID).Scan(&uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.UUID{}, ErrNotFound
	}
	return uid, err
}

// GetUser returns SCIM user by id or externalId within institution.
func GetUser(ctx context.Context, pool *pgxpool.Pool, institutionID uuid.UUID, scimUserID, baseURL string) (*UserResource, error) {
	uid, err := findBoundUserID(ctx, pool, institutionID, scimUserID)
	if err != nil {
		return nil, err
	}
	return buildUserResource(ctx, pool, uid, institutionID, baseURL), nil
}

func buildUserResource(ctx context.Context, pool *pgxpool.Pool, userID, institutionID uuid.UUID, baseURL string) *UserResource {
	var email, displayName sql.NullString
	var extID sql.NullString
	var deactivatedAt sql.NullTime
	var blocked bool
	_ = pool.QueryRow(ctx, `
SELECT email, display_name, scim_external_id, deactivated_at, login_blocked
FROM "user".users WHERE id = $1
`, userID).Scan(&email, &displayName, &extID, &deactivatedAt, &blocked)
	active := !deactivatedAt.Valid && !blocked
	em := user.NormalizeEmail(email.String)
	dn := strings.TrimSpace(displayName.String)
	loc := strings.TrimRight(baseURL, "/") + "/scim/v2/Users/" + userID.String()
	meta := &Meta{
		ResourceType: "User",
		Location:     loc,
	}
	res := &UserResource{
		Schemas:     []string{"urn:ietf:params:scim:schemas:core:2.0:User"},
		ID:          userID.String(),
		UserName:    em,
		Active:      &active,
		DisplayName: dn,
		Meta:        meta,
	}
	if extID.Valid && strings.TrimSpace(extID.String) != "" {
		res.ExternalID = strings.TrimSpace(extID.String)
	}
	return res
}

// ReplaceUser full PUT.
func ReplaceUser(ctx context.Context, pool *pgxpool.Pool, institutionID uuid.UUID, scimUserID string, in *UserResource, baseURL string) (*UserResource, error) {
	uid, err := findBoundUserID(ctx, pool, institutionID, scimUserID)
	if err != nil {
		return nil, err
	}
	email := user.NormalizeEmail(in.UserName)
	if email == "" {
		return nil, ErrInvalidValue
	}
	active := true
	if in.Active != nil {
		active = *in.Active
	}
	dn := resolveDisplayName(in)
	if dn == "" {
		dn = email
	}
	extID := strings.TrimSpace(in.ExternalID)

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var conflict bool
	err = tx.QueryRow(ctx, `
SELECT EXISTS (SELECT 1 FROM "user".users WHERE email = $1 AND id <> $2)
`, email, uid).Scan(&conflict)
	if err != nil {
		return nil, err
	}
	if conflict {
		return nil, ErrUniqueness
	}
	if extID != "" {
		err = tx.QueryRow(ctx, `
SELECT EXISTS (SELECT 1 FROM "user".users WHERE scim_external_id = $1 AND id <> $2)
`, extID, uid).Scan(&conflict)
		if err != nil {
			return nil, err
		}
		if conflict {
			return nil, ErrUniqueness
		}
	}

	var extSQL any
	if extID == "" {
		extSQL = nil
	} else {
		extSQL = extID
	}

	_, err = tx.Exec(ctx, `
UPDATE "user".users SET email = $2, display_name = $3, scim_external_id = $4 WHERE id = $1
`, uid, email, dn, extSQL)
	if err != nil {
		var pe *pgconn.PgError
		if errors.As(err, &pe) && pe.Code == "23505" {
			return nil, ErrUniqueness
		}
		return nil, err
	}

	if err := setUserActiveTx(ctx, tx, uid, active); err != nil {
		return nil, err
	}

	roleName := mapAppRoleName(in.Enterprise)
	if err := rbac.AssignUserRoleByNameTx(ctx, tx, uid, roleName); err != nil {
		return nil, err
	}
	var roleCount int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*)::int FROM "user".user_app_roles WHERE user_id = $1`, uid).Scan(&roleCount); err != nil {
		return nil, err
	}
	if roleCount == 0 {
		if err := rbac.AssignUserRoleByNameTx(ctx, tx, uid, "Student"); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	_ = LogEvent(ctx, pool, institutionID, "update", "User", &uid, map[string]any{"userName": email})
	return buildUserResource(ctx, pool, uid, institutionID, baseURL), nil
}

func setUserActiveTx(ctx context.Context, tx pgx.Tx, uid uuid.UUID, active bool) error {
	if active {
		_, err := tx.Exec(ctx, `
UPDATE "user".users SET deactivated_at = NULL, login_blocked = FALSE WHERE id = $1
`, uid)
		return err
	}
	_, err := tx.Exec(ctx, `
UPDATE "user".users SET
  deactivated_at = COALESCE(deactivated_at, NOW()),
  login_blocked = TRUE,
  jwt_session_version = jwt_session_version + 1
WHERE id = $1
`, uid)
	return err
}

// PatchUser applies partial updates (minimal PATCH).
func PatchUser(ctx context.Context, pool *pgxpool.Pool, institutionID uuid.UUID, scimUserID string, raw []byte, baseURL string) (*UserResource, error) {
	uid, err := findBoundUserID(ctx, pool, institutionID, scimUserID)
	if err != nil {
		return nil, err
	}
	var envelope struct {
		Schemas    []string `json:"schemas"`
		Operations []struct {
			OP    string          `json:"op"`
			Path  string          `json:"path"`
			Value json.RawMessage `json:"value"`
		} `json:"Operations"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, ErrInvalidValue
	}
	if len(envelope.Operations) == 0 {
		return buildUserResource(ctx, pool, uid, institutionID, baseURL), nil
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	for _, op := range envelope.Operations {
		switch strings.ToLower(strings.TrimSpace(op.OP)) {
		case "replace":
			p := strings.TrimSpace(op.Path)
			switch {
			case strings.EqualFold(p, "active"):
				var b bool
				if err := json.Unmarshal(op.Value, &b); err != nil {
					return nil, ErrInvalidValue
				}
				if err := setUserActiveTx(ctx, tx, uid, b); err != nil {
					return nil, err
				}
				if !b {
					_ = LogEvent(ctx, pool, institutionID, "deactivate", "User", &uid, map[string]any{"path": "active"})
				}
			case strings.EqualFold(p, "displayName"):
				var s string
				if err := json.Unmarshal(op.Value, &s); err != nil {
					return nil, ErrInvalidValue
				}
				s = strings.TrimSpace(s)
				if s == "" {
					return nil, ErrInvalidValue
				}
				if _, err := tx.Exec(ctx, `UPDATE "user".users SET display_name = $2 WHERE id = $1`, uid, s); err != nil {
					return nil, err
				}
				_ = LogEvent(ctx, pool, institutionID, "update", "User", &uid, map[string]any{"displayName": s})
			case p == "" || strings.EqualFold(p, "name.formatted"):
				// replace whole value object
				var full UserResource
				if err := json.Unmarshal(op.Value, &full); err == nil && full.DisplayName != "" {
					if _, err := tx.Exec(ctx, `UPDATE "user".users SET display_name = $2 WHERE id = $1`, uid, strings.TrimSpace(full.DisplayName)); err != nil {
						return nil, err
					}
				} else if full.Name != nil && strings.TrimSpace(full.Name.Formatted) != "" {
					if _, err := tx.Exec(ctx, `UPDATE "user".users SET display_name = $2 WHERE id = $1`, uid, strings.TrimSpace(full.Name.Formatted)); err != nil {
						return nil, err
					}
				} else {
					return nil, ErrInvalidValue
				}
				_ = LogEvent(ctx, pool, institutionID, "update", "User", &uid, map[string]any{"patch": "display"})
			default:
				return nil, ErrInvalidValue
			}
		default:
			return nil, ErrInvalidValue
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return buildUserResource(ctx, pool, uid, institutionID, baseURL), nil
}

// DeleteUser deactivates (SCIM DELETE semantics = soft offboard).
func DeleteUser(ctx context.Context, pool *pgxpool.Pool, institutionID uuid.UUID, scimUserID string) error {
	uid, err := findBoundUserID(ctx, pool, institutionID, scimUserID)
	if err != nil {
		return err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := setUserActiveTx(ctx, tx, uid, false); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	_ = LogEvent(ctx, pool, institutionID, "delete", "User", &uid, nil)
	return nil
}

// ListUsers returns users for institution; supports filter=userName eq "email".
func ListUsers(ctx context.Context, pool *pgxpool.Pool, institutionID uuid.UUID, filter string, baseURL string) (*listResponse, error) {
	email := ""
	if f := strings.TrimSpace(filter); f != "" {
		const prefix = `userName eq "`
		if strings.HasPrefix(strings.ToLower(f), strings.ToLower(prefix)) && strings.HasSuffix(f, `"`) {
			email = user.NormalizeEmail(f[len(prefix) : len(f)-1])
		}
	}

	var rows pgx.Rows
	var err error
	if email != "" {
		rows, err = pool.Query(ctx, `
SELECT u.id FROM "user".users u
INNER JOIN provisioning.scim_user_bindings b ON b.user_id = u.id AND b.institution_id = $1
WHERE u.email = $2
ORDER BY u.created_at ASC
`, institutionID, email)
	} else {
		rows, err = pool.Query(ctx, `
SELECT u.id FROM "user".users u
INNER JOIN provisioning.scim_user_bindings b ON b.user_id = u.id AND b.institution_id = $1
ORDER BY u.created_at ASC
LIMIT 1000
`, institutionID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	res := make([]*UserResource, 0, len(ids))
	for _, id := range ids {
		res = append(res, buildUserResource(ctx, pool, id, institutionID, baseURL))
	}
	return &listResponse{
		Schemas:      []string{"urn:ietf:params:scim:api:messages:2.0:ListResponse"},
		TotalResults: len(res),
		StartIndex:   1,
		ItemsPerPage: len(res),
		Resources:    res,
	}, nil
}
