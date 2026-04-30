// Package samlidp maps the IdP table in server/src/repos/saml.rs (default IdP + upsert).
package samlidp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// IDPRow is a row in settings.saml_idp_configurations.
type IDPRow struct {
	ID                 uuid.UUID
	InstitutionID      *uuid.UUID
	DisplayName        string
	EntityID           string
	SSOURL             string
	SLOURL             *string
	IDPCertPem         string
	AttributeMapping   json.RawMessage
	ForceSAML          bool
}

// GetDefaultIdP returns the first IdP by created_at, or (nil, nil) when the table is empty.
func GetDefaultIdP(ctx context.Context, pool *pgxpool.Pool) (*IDPRow, error) {
	r, err := scanIdP(pool.QueryRow(ctx, `
SELECT
	id, institution_id, display_name, entity_id, sso_url, slo_url,
	idp_cert_pem, attribute_mapping, force_saml
FROM settings.saml_idp_configurations
ORDER BY created_at ASC
LIMIT 1
`))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return r, nil
}

// IdPWrite is the request body for PUT.
type IdPWrite struct {
	InstitutionID    *uuid.UUID
	DisplayName      string
	EntityID         string
	SSOURL           string
	SLOURL           *string
	IDPCertPem       string
	AttributeMapping json.RawMessage
	ForceSAML        bool
}

// UpsertIdP when id is set, updates that row; else updates the first by created_at or inserts.
// Matches server `upsert_idp` behavior.
func UpsertIdP(ctx context.Context, pool *pgxpool.Pool, id *uuid.UUID, w *IdPWrite) (*IDPRow, error) {
	if w == nil {
		return nil, fmt.Errorf("saml: nil write")
	}
	if id != nil {
		r, err := scanIdP(pool.QueryRow(ctx, `
UPDATE settings.saml_idp_configurations
SET
	institution_id = $2,
	display_name = $3,
	entity_id = $4,
	sso_url = $5,
	slo_url = $6,
	idp_cert_pem = $7,
	attribute_mapping = $8,
	force_saml = $9,
	updated_at = NOW()
WHERE id = $1
RETURNING
	id, institution_id, display_name, entity_id, sso_url, slo_url,
	idp_cert_pem, attribute_mapping, force_saml
`, *id, w.InstitutionID, w.DisplayName, w.EntityID, w.SSOURL, w.SLOURL, w.IDPCertPem, w.AttributeMapping, w.ForceSAML))
		if err == nil {
			return r, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}

	var existing uuid.UUID
	err := pool.QueryRow(ctx, `SELECT id FROM settings.saml_idp_configurations ORDER BY created_at ASC LIMIT 1`).Scan(&existing)
	if err == nil {
		return scanIdP(pool.QueryRow(ctx, `
UPDATE settings.saml_idp_configurations
SET
	institution_id = $2,
	display_name = $3,
	entity_id = $4,
	sso_url = $5,
	slo_url = $6,
	idp_cert_pem = $7,
	attribute_mapping = $8,
	force_saml = $9,
	updated_at = NOW()
WHERE id = $1
RETURNING
	id, institution_id, display_name, entity_id, sso_url, slo_url,
	idp_cert_pem, attribute_mapping, force_saml
`, existing, w.InstitutionID, w.DisplayName, w.EntityID, w.SSOURL, w.SLOURL, w.IDPCertPem, w.AttributeMapping, w.ForceSAML))
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	return scanIdP(pool.QueryRow(ctx, `
INSERT INTO settings.saml_idp_configurations
	(institution_id, display_name, entity_id, sso_url, slo_url, idp_cert_pem, attribute_mapping, force_saml)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING
	id, institution_id, display_name, entity_id, sso_url, slo_url,
	idp_cert_pem, attribute_mapping, force_saml
`, w.InstitutionID, w.DisplayName, w.EntityID, w.SSOURL, w.SLOURL, w.IDPCertPem, w.AttributeMapping, w.ForceSAML))
}

func scanIdP(row pgx.Row) (*IDPRow, error) {
	var r IDPRow
	var am []byte
	if err := row.Scan(
		&r.ID, &r.InstitutionID, &r.DisplayName, &r.EntityID, &r.SSOURL, &r.SLOURL, &r.IDPCertPem, &am, &r.ForceSAML,
	); err != nil {
		return nil, err
	}
	if len(am) == 0 {
		am = []byte(`{}`)
	}
	r.AttributeMapping = am
	return &r, nil
}
