// Package platformconfig stores optional overrides for env-driven app settings (singleton row).
package platformconfig

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server/internal/config"
)

// Row is the optional DB override layer; nil pointers mean "use environment value".
type Row struct {
	OpenRouterAPIKey *string

	SAMLSSOEnabled      *bool
	SAMLPublicBaseURL   *string
	SAMLSPEntityID      *string
	SAMLSPX509PEM       *string
	SAMLSPPrivateKeyPEM *string

	AnnotationEnabled           *bool
	FeedbackMediaEnabled        *bool
	BlindGradingEnabled         *bool
	ModeratedGradingEnabled     *bool
	OriginalityDetectionEnabled *bool
	OriginalityStubExternal     *bool
	GradePostingPoliciesEnabled *bool
	GradebookCSVEnabled         *bool
	ResubmissionWorkflowEnabled *bool
	LTIEnabled                  *bool
	OneRosterEnabled            *bool
	ScimEnabled                 *bool

	UpdatedAt time.Time
}

// Write is the upsert payload (nil pointer = leave column unchanged).
type Write struct {
	OpenRouterAPIKey *string

	SAMLSSOEnabled      *bool
	SAMLPublicBaseURL   *string
	SAMLSPEntityID      *string
	SAMLSPX509PEM       *string
	SAMLSPPrivateKeyPEM *string

	AnnotationEnabled           *bool
	FeedbackMediaEnabled        *bool
	BlindGradingEnabled         *bool
	ModeratedGradingEnabled     *bool
	OriginalityDetectionEnabled *bool
	OriginalityStubExternal     *bool
	GradePostingPoliciesEnabled *bool
	GradebookCSVEnabled         *bool
	ResubmissionWorkflowEnabled *bool
	LTIEnabled                  *bool
	OneRosterEnabled            *bool
	ScimEnabled                 *bool
}

// Get returns the singleton row or (nil, nil) if missing.
func Get(ctx context.Context, pool *pgxpool.Pool) (*Row, error) {
	var r Row
	err := pool.QueryRow(ctx, `
SELECT
	openrouter_api_key,
	saml_sso_enabled,
	saml_public_base_url,
	saml_sp_entity_id,
	saml_sp_x509_pem,
	saml_sp_private_key_pem,
	annotation_enabled,
	feedback_media_enabled,
	blind_grading_enabled,
	moderated_grading_enabled,
	originality_detection_enabled,
	originality_stub_external,
	grade_posting_policies_enabled,
	gradebook_csv_enabled,
	resubmission_workflow_enabled,
	lti_enabled,
	oneroster_enabled,
	scim_enabled,
	updated_at
FROM settings.platform_app_settings
WHERE id = 1
`).Scan(
		&r.OpenRouterAPIKey,
		&r.SAMLSSOEnabled,
		&r.SAMLPublicBaseURL,
		&r.SAMLSPEntityID,
		&r.SAMLSPX509PEM,
		&r.SAMLSPPrivateKeyPEM,
		&r.AnnotationEnabled,
		&r.FeedbackMediaEnabled,
		&r.BlindGradingEnabled,
		&r.ModeratedGradingEnabled,
		&r.OriginalityDetectionEnabled,
		&r.OriginalityStubExternal,
		&r.GradePostingPoliciesEnabled,
		&r.GradebookCSVEnabled,
		&r.ResubmissionWorkflowEnabled,
		&r.LTIEnabled,
		&r.OneRosterEnabled,
		&r.ScimEnabled,
		&r.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// ClearOpenRouterAPIKey removes the stored OpenRouter override so the environment key is used again.
func ClearOpenRouterAPIKey(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
UPDATE settings.platform_app_settings
SET openrouter_api_key = NULL, updated_at = NOW()
WHERE id = 1
`)
	return err
}

// Upsert applies non-nil fields in w to the singleton row (COALESCE keeps existing values).
func Upsert(ctx context.Context, pool *pgxpool.Pool, w *Write) (*Row, error) {
	_, err := pool.Exec(ctx, `
INSERT INTO settings.platform_app_settings (
	id,
	openrouter_api_key,
	saml_sso_enabled,
	saml_public_base_url,
	saml_sp_entity_id,
	saml_sp_x509_pem,
	saml_sp_private_key_pem,
	annotation_enabled,
	feedback_media_enabled,
	blind_grading_enabled,
	moderated_grading_enabled,
	originality_detection_enabled,
	originality_stub_external,
	grade_posting_policies_enabled,
	gradebook_csv_enabled,
	resubmission_workflow_enabled,
	lti_enabled,
	oneroster_enabled,
	scim_enabled,
	updated_at
) VALUES (
	1,
	$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW()
)
ON CONFLICT (id) DO UPDATE SET
	openrouter_api_key = COALESCE(EXCLUDED.openrouter_api_key, settings.platform_app_settings.openrouter_api_key),
	saml_sso_enabled = COALESCE(EXCLUDED.saml_sso_enabled, settings.platform_app_settings.saml_sso_enabled),
	saml_public_base_url = COALESCE(EXCLUDED.saml_public_base_url, settings.platform_app_settings.saml_public_base_url),
	saml_sp_entity_id = COALESCE(EXCLUDED.saml_sp_entity_id, settings.platform_app_settings.saml_sp_entity_id),
	saml_sp_x509_pem = COALESCE(EXCLUDED.saml_sp_x509_pem, settings.platform_app_settings.saml_sp_x509_pem),
	saml_sp_private_key_pem = COALESCE(EXCLUDED.saml_sp_private_key_pem, settings.platform_app_settings.saml_sp_private_key_pem),
	annotation_enabled = COALESCE(EXCLUDED.annotation_enabled, settings.platform_app_settings.annotation_enabled),
	feedback_media_enabled = COALESCE(EXCLUDED.feedback_media_enabled, settings.platform_app_settings.feedback_media_enabled),
	blind_grading_enabled = COALESCE(EXCLUDED.blind_grading_enabled, settings.platform_app_settings.blind_grading_enabled),
	moderated_grading_enabled = COALESCE(EXCLUDED.moderated_grading_enabled, settings.platform_app_settings.moderated_grading_enabled),
	originality_detection_enabled = COALESCE(EXCLUDED.originality_detection_enabled, settings.platform_app_settings.originality_detection_enabled),
	originality_stub_external = COALESCE(EXCLUDED.originality_stub_external, settings.platform_app_settings.originality_stub_external),
	grade_posting_policies_enabled = COALESCE(EXCLUDED.grade_posting_policies_enabled, settings.platform_app_settings.grade_posting_policies_enabled),
	gradebook_csv_enabled = COALESCE(EXCLUDED.gradebook_csv_enabled, settings.platform_app_settings.gradebook_csv_enabled),
	resubmission_workflow_enabled = COALESCE(EXCLUDED.resubmission_workflow_enabled, settings.platform_app_settings.resubmission_workflow_enabled),
	lti_enabled = COALESCE(EXCLUDED.lti_enabled, settings.platform_app_settings.lti_enabled),
	oneroster_enabled = COALESCE(EXCLUDED.oneroster_enabled, settings.platform_app_settings.oneroster_enabled),
	scim_enabled = COALESCE(EXCLUDED.scim_enabled, settings.platform_app_settings.scim_enabled),
	updated_at = NOW()
`,
		w.OpenRouterAPIKey,
		w.SAMLSSOEnabled,
		w.SAMLPublicBaseURL,
		w.SAMLSPEntityID,
		w.SAMLSPX509PEM,
		w.SAMLSPPrivateKeyPEM,
		w.AnnotationEnabled,
		w.FeedbackMediaEnabled,
		w.BlindGradingEnabled,
		w.ModeratedGradingEnabled,
		w.OriginalityDetectionEnabled,
		w.OriginalityStubExternal,
		w.GradePostingPoliciesEnabled,
		w.GradebookCSVEnabled,
		w.ResubmissionWorkflowEnabled,
		w.LTIEnabled,
		w.OneRosterEnabled,
		w.ScimEnabled,
	)
	if err != nil {
		return nil, err
	}
	return Get(ctx, pool)
}

// Merge applies DB overrides on top of env-backed configuration.
func Merge(env config.Config, db *Row) config.Config {
	if db == nil {
		return env
	}
	out := env
	if db.OpenRouterAPIKey != nil {
		if strings.TrimSpace(*db.OpenRouterAPIKey) != "" {
			out.OpenRouterAPIKey = strings.TrimSpace(*db.OpenRouterAPIKey)
		}
	}
	if db.SAMLSSOEnabled != nil {
		out.SAMLSSOEnabled = *db.SAMLSSOEnabled
	}
	if db.SAMLPublicBaseURL != nil && strings.TrimSpace(*db.SAMLPublicBaseURL) != "" {
		out.SAMLPublicBaseURL = strings.TrimRight(strings.TrimSpace(*db.SAMLPublicBaseURL), "/")
	}
	if db.SAMLSPEntityID != nil && strings.TrimSpace(*db.SAMLSPEntityID) != "" {
		out.SAMLSPEntityID = strings.TrimSpace(*db.SAMLSPEntityID)
	}
	if db.SAMLSPX509PEM != nil && strings.TrimSpace(*db.SAMLSPX509PEM) != "" {
		out.SAMLSPX509PEM = strings.TrimSpace(*db.SAMLSPX509PEM)
	}
	if db.SAMLSPPrivateKeyPEM != nil && strings.TrimSpace(*db.SAMLSPPrivateKeyPEM) != "" {
		out.SAMLSPPrivateKeyPEM = strings.TrimSpace(*db.SAMLSPPrivateKeyPEM)
	}
	if db.AnnotationEnabled != nil {
		out.AnnotationEnabled = *db.AnnotationEnabled
	}
	if db.FeedbackMediaEnabled != nil {
		out.FeedbackMediaEnabled = *db.FeedbackMediaEnabled
	}
	if db.BlindGradingEnabled != nil {
		out.BlindGradingEnabled = *db.BlindGradingEnabled
	}
	if db.ModeratedGradingEnabled != nil {
		out.ModeratedGradingEnabled = *db.ModeratedGradingEnabled
	}
	if db.OriginalityDetectionEnabled != nil {
		out.OriginalityDetectionEnabled = *db.OriginalityDetectionEnabled
	}
	if db.OriginalityStubExternal != nil {
		out.OriginalityStubExternal = *db.OriginalityStubExternal
	}
	if db.GradePostingPoliciesEnabled != nil {
		out.GradePostingPoliciesEnabled = *db.GradePostingPoliciesEnabled
	}
	if db.GradebookCSVEnabled != nil {
		out.GradebookCSVEnabled = *db.GradebookCSVEnabled
	}
	if db.ResubmissionWorkflowEnabled != nil {
		out.ResubmissionWorkflowEnabled = *db.ResubmissionWorkflowEnabled
	}
	if db.LTIEnabled != nil {
		out.LTIEnabled = *db.LTIEnabled
	}
	if db.OneRosterEnabled != nil {
		out.OneRosterEnabled = *db.OneRosterEnabled
	}
	if db.ScimEnabled != nil {
		out.ScimEnabled = *db.ScimEnabled
	}
	return out
}

// Source describes whether the effective value came from the DB row or the environment.
type Source string

const (
	SourceEnvironment Source = "environment"
	SourceDatabase    Source = "database"
)

// Sources indicates which layer won for mergeable fields (for admin transparency).
type Sources struct {
	OpenRouterAPIKey Source

	SAMLSSOEnabled      Source
	SAMLPublicBaseURL   Source
	SAMLSPEntityID      Source
	SAMLSPX509PEM       Source
	SAMLSPPrivateKeyPEM Source

	AnnotationEnabled           Source
	FeedbackMediaEnabled        Source
	BlindGradingEnabled         Source
	ModeratedGradingEnabled     Source
	OriginalityDetectionEnabled Source
	OriginalityStubExternal     Source
	GradePostingPoliciesEnabled Source
	GradebookCSVEnabled         Source
	ResubmissionWorkflowEnabled Source
	LTIEnabled                  Source
	OneRosterEnabled            Source
	ScimEnabled                 Source
}

// ResolveSources compares env vs DB row to label each field.
func ResolveSources(env config.Config, db *Row) Sources {
	var s Sources
	if db == nil {
		return sourcesAllEnvironment(env)
	}
	s.OpenRouterAPIKey = sourceString(env.OpenRouterAPIKey, db.OpenRouterAPIKey)
	s.SAMLSSOEnabled = sourceBool(env.SAMLSSOEnabled, db.SAMLSSOEnabled)
	s.SAMLPublicBaseURL = sourceString(env.SAMLPublicBaseURL, db.SAMLPublicBaseURL)
	s.SAMLSPEntityID = sourceString(env.SAMLSPEntityID, db.SAMLSPEntityID)
	s.SAMLSPX509PEM = sourceString(env.SAMLSPX509PEM, db.SAMLSPX509PEM)
	s.SAMLSPPrivateKeyPEM = sourceString(env.SAMLSPPrivateKeyPEM, db.SAMLSPPrivateKeyPEM)
	s.AnnotationEnabled = sourceBool(env.AnnotationEnabled, db.AnnotationEnabled)
	s.FeedbackMediaEnabled = sourceBool(env.FeedbackMediaEnabled, db.FeedbackMediaEnabled)
	s.BlindGradingEnabled = sourceBool(env.BlindGradingEnabled, db.BlindGradingEnabled)
	s.ModeratedGradingEnabled = sourceBool(env.ModeratedGradingEnabled, db.ModeratedGradingEnabled)
	s.OriginalityDetectionEnabled = sourceBool(env.OriginalityDetectionEnabled, db.OriginalityDetectionEnabled)
	s.OriginalityStubExternal = sourceBool(env.OriginalityStubExternal, db.OriginalityStubExternal)
	s.GradePostingPoliciesEnabled = sourceBool(env.GradePostingPoliciesEnabled, db.GradePostingPoliciesEnabled)
	s.GradebookCSVEnabled = sourceBool(env.GradebookCSVEnabled, db.GradebookCSVEnabled)
	s.ResubmissionWorkflowEnabled = sourceBool(env.ResubmissionWorkflowEnabled, db.ResubmissionWorkflowEnabled)
	s.LTIEnabled = sourceBool(env.LTIEnabled, db.LTIEnabled)
	s.OneRosterEnabled = sourceBool(env.OneRosterEnabled, db.OneRosterEnabled)
	s.ScimEnabled = sourceBool(env.ScimEnabled, db.ScimEnabled)
	return s
}

func sourcesAllEnvironment(env config.Config) Sources {
	_ = env
	return Sources{
		OpenRouterAPIKey:            SourceEnvironment,
		SAMLSSOEnabled:              SourceEnvironment,
		SAMLPublicBaseURL:           SourceEnvironment,
		SAMLSPEntityID:              SourceEnvironment,
		SAMLSPX509PEM:               SourceEnvironment,
		SAMLSPPrivateKeyPEM:         SourceEnvironment,
		AnnotationEnabled:           SourceEnvironment,
		FeedbackMediaEnabled:        SourceEnvironment,
		BlindGradingEnabled:         SourceEnvironment,
		ModeratedGradingEnabled:     SourceEnvironment,
		OriginalityDetectionEnabled: SourceEnvironment,
		OriginalityStubExternal:     SourceEnvironment,
		GradePostingPoliciesEnabled: SourceEnvironment,
		GradebookCSVEnabled:         SourceEnvironment,
		ResubmissionWorkflowEnabled: SourceEnvironment,
		LTIEnabled:                  SourceEnvironment,
		OneRosterEnabled:            SourceEnvironment,
		ScimEnabled:                 SourceEnvironment,
	}
}

func sourceString(envVal string, dbPtr *string) Source {
	if dbPtr != nil {
		if strings.TrimSpace(*dbPtr) != "" {
			return SourceDatabase
		}
	}
	return SourceEnvironment
}

func sourceBool(envVal bool, dbPtr *bool) Source {
	if dbPtr != nil {
		return SourceDatabase
	}
	return SourceEnvironment
}
