-- Singleton platform application settings (OpenRouter, SAML SP material, feature flags).
-- Values override process environment when set; see internal/repos/platformconfig.
CREATE TABLE IF NOT EXISTS settings.platform_app_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),

    openrouter_api_key TEXT,

    saml_sso_enabled BOOLEAN,
    saml_public_base_url TEXT,
    saml_sp_entity_id TEXT,
    saml_sp_x509_pem TEXT,
    saml_sp_private_key_pem TEXT,

    annotation_enabled BOOLEAN,
    feedback_media_enabled BOOLEAN,
    blind_grading_enabled BOOLEAN,
    moderated_grading_enabled BOOLEAN,
    originality_detection_enabled BOOLEAN,
    originality_stub_external BOOLEAN,
    grade_posting_policies_enabled BOOLEAN,
    gradebook_csv_enabled BOOLEAN,
    resubmission_workflow_enabled BOOLEAN,
    lti_enabled BOOLEAN,
    oneroster_enabled BOOLEAN,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO settings.platform_app_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;
